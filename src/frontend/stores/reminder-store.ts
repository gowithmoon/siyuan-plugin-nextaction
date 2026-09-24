// src/frontend/stores/reminder-store.ts
// Reminder core scanning & dismissal logic

import { writable, derived, get } from "svelte/store";
import { taskStore, tasksWithDueOrReview, pendingReminderCount } from "./task-store";
import {
    REMINDER_SCAN_INTERVAL_MS,
    REMINDER_REVIEW_HOUR,
    REMINDER_MAX_VISIBLE,
    REMINDER_DISMISSED_TTL_MS,
    REMINDER_DATA_PATH,
    type ReminderSoundId,
} from "../../shared/constants";
import type {
    ReminderEntry,
    DismissedRecord,
    TaskCacheEntry,
    ReminderItem,
    ReminderRelative,
    ReminderAbsolute,
    ReminderSummaryData,
} from "../../shared/types";
import type { Plugin } from "siyuan";
import { playSound } from "../utils/audio-player";
import { resolveReminderItems } from "../utils/reminder-utils";
import { isNextActionCandidate } from "../utils/filter";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Notification queue — consumed by NotificationHost UI */
export const notificationQueue = writable<ReminderEntry[]>([]);

/** Visible slice of the notification queue (capped by REMINDER_MAX_VISIBLE) */
export const visibleNotifications = derived(notificationQueue, ($q) =>
    $q.filter((r) => !r.dismissed).slice(0, REMINDER_MAX_VISIBLE),
);

/** Dismissed dedup-keys persisted via Plugin.saveData */
let dismissed: DismissedRecord = {};

/** Plugin reference — set during init */
let pluginRef: Plugin | null = null;

/** Handle for the 30 s scan timer */
let scanTimer: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get the effective reminder items for a task.
 * Parses the raw reminder attribute into ReminderItem[].
 */
function getEffectiveReminders(entry: TaskCacheEntry): ReminderItem[] {
    return resolveReminderItems(entry.reminder, get(taskStore).settings?.reminderSettings, !!entry.due);
}

/** Rebuild pending desktop reminders after a settings change. Dismissal history is retained. */
export function rebuildReminderQueue(): void {
    notificationQueue.set([]);
    pendingReminderCount.set(0);
    scanReminders(false);
}

/**
 * Convert a date string (YYYY-MM-DD or YYYY-MM-DDTHH:mm) and an hour
 * into a millisecond timestamp for that day at the given hour.
 */
function parseDateToMs(dateStr: string, hour: number = 0): number {
    // dateStr may be YYYY-MM-DD or YYYY-MM-DDTHH:mm(:ss)
    const datePart = dateStr.slice(0, 10); // YYYY-MM-DD
    const [y, m, d] = datePart.split("-").map(Number);
    return new Date(y, m - 1, d, hour, 0, 0, 0).getTime();
}

/**
 * Build a dedup key that uniquely identifies a reminder trigger.
 * Includes baseDateStr so recurring tasks on different dates
 * produce different keys.
 */
export function buildDedupKey(
    blockId: string,
    baseDateStr: string,
    minutesBefore: number,
    type: "due" | "review" | "absolute" | "summary",
): string {
    return `${blockId}|${baseDateStr}|${minutesBefore}|${type}`;
}

/**
 * Get today's date as a local YYYY-MM-DD string (avoids UTC offset from toISOString).
 */
function localDateStr(): string {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

/**
 * Check if a task's due date is before now (overdue).
 */
function isOverdue(entry: TaskCacheEntry): boolean {
    if (!entry.due || entry.status === "done" || entry.status === "someday") return false;
    if (entry.due.length <= 10) {
        // 纯日期格式：使用字符串比较，截止日当天不算逾期
        const todayStr = localDateStr();
        return entry.due.slice(0, 10) < todayStr;
    }
    // 日期时间格式：精确比较
    const dueTimeMs = new Date(entry.due).getTime();
    return dueTimeMs < Date.now();
}

/**
 * Check if a task's due date is today.
 */
function isDueToday(entry: TaskCacheEntry): boolean {
    if (!entry.due || entry.status === "done" || entry.status === "someday") return false;
    const todayStr = localDateStr();
    return entry.due.slice(0, 10) === todayStr;
}

/**
 * Check if a task's start date is today (Tickler activation).
 */
function isStartingToday(entry: TaskCacheEntry): boolean {
    if (!entry.start || entry.status === "done") return false;
    const todayStr = localDateStr();
    return entry.start.slice(0, 10) === todayStr;
}

// ---------------------------------------------------------------------------
// Dismissed persistence
// ---------------------------------------------------------------------------

/** Remove entries older than TTL */
function cleanupExpiredDismissed(record: DismissedRecord): DismissedRecord {
    const cutoff = Date.now() - REMINDER_DISMISSED_TTL_MS;
    const cleaned: DismissedRecord = {};
    const keys = Object.keys(record);
    for (const key of keys) {
        const ts = record[key];
        if (ts >= cutoff) {
            cleaned[key] = ts;
        }
    }
    return cleaned;
}

async function loadDismissed(): Promise<void> {
    if (!pluginRef) return;
    try {
        const data = await pluginRef.loadData(REMINDER_DATA_PATH);
        if (data && typeof data === "object") {
            dismissed = cleanupExpiredDismissed(data as DismissedRecord);
        } else {
            dismissed = {};
        }
    } catch {
        dismissed = {};
    }
}

async function saveDismissed(): Promise<void> {
    if (!pluginRef) return;
    try {
        await pluginRef.saveData(REMINDER_DATA_PATH, dismissed);
    } catch (e) {
        console.error("[NextAction] saveDismissed failed:", e);
    }
}

// ---------------------------------------------------------------------------
// Summary computation
// ---------------------------------------------------------------------------

/**
 * Compute summary statistics from all tasks for the overview card.
 */
function computeSummary(): ReminderSummaryData {
    const allTasks = get(taskStore).allTasks;
    const startPreviewDays = get(taskStore).settings?.priorityEngine?.startPreviewDays ?? 0;

    let overdue = 0;
    let dueToday = 0;
    let startingToday = 0;
    let nextAction = 0;
    let waiting = 0;

    for (const entry of allTasks) {
        if (entry.status === "done") continue;
        if (isOverdue(entry)) overdue++;
        if (isDueToday(entry)) dueToday++;
        if (isStartingToday(entry)) startingToday++;
        if (isNextActionCandidate(entry, startPreviewDays)) nextAction++;
        if (entry.status === "waiting") waiting++;
    }

    return { overdue, dueToday, startingToday, nextAction, waiting };
}

/**
 * Check if a summary entry should be shown.
 * Only show when there is something actionable to report.
 */
function hasActionableItems(summary: ReminderSummaryData): boolean {
    return (
        summary.overdue > 0 ||
        summary.dueToday > 0 ||
        summary.startingToday > 0 ||
        summary.nextAction > 0 ||
        summary.waiting > 0
    );
}

// ---------------------------------------------------------------------------
// Core scan
// ---------------------------------------------------------------------------

function scanReminders(playNewSound = true): void {
    const settings = get(taskStore).settings;
    const reminderSettings = settings?.reminderSettings;
    if (!reminderSettings?.enabled) return;

    const now = Date.now();
    const candidates = get(tasksWithDueOrReview);
    const currentQueue = get(notificationQueue);
    const queuedBlockIds = new Set(currentQueue.map((r) => r.blockId));
    const queuedDedupKeys = new Set<string>(
        currentQueue.map((r) => buildDedupKey(r.blockId, r.baseDateStr, r.minutesBefore, r.type)),
    );
    const newEntries: ReminderEntry[] = [];

    // ---- Summary card ----
    // Use a fixed blockId for the summary entry so we can dedup it
    const SUMMARY_BLOCK_ID = "__summary__";
    const summaryAlreadyQueued = queuedBlockIds.has(SUMMARY_BLOCK_ID);
    const todayStr = localDateStr();
    const summaryDedupKey = buildDedupKey(SUMMARY_BLOCK_ID, todayStr, 0, "summary");

    if (summaryAlreadyQueued) {
        // Update existing summary with fresh counts (reflects newly overdue tasks)
        const freshSummary = computeSummary();
        notificationQueue.update((queue) =>
            queue.map((r) => {
                if (r.blockId === SUMMARY_BLOCK_ID && !r.dismissed) {
                    return { ...r, summary: freshSummary };
                }
                return r;
            }),
        );
    } else if (!dismissed[summaryDedupKey]) {
        const summary = computeSummary();
        if (hasActionableItems(summary)) {
            newEntries.push({
                blockId: SUMMARY_BLOCK_ID,
                title: "",
                triggerTime: now,
                type: "summary",
                minutesBefore: 0,
                baseDateStr: todayStr,
                dueTime: now,
                dismissed: false,
                summary,
            });
            queuedBlockIds.add(SUMMARY_BLOCK_ID);
            queuedDedupKeys.add(summaryDedupKey);
        }
    }

    // ---- Individual reminders ----
    for (const entry of candidates) {
        if (queuedBlockIds.has(entry.blockId)) continue;

        // ---- Absolute time reminders ----
        {
            const items = getEffectiveReminders(entry);
            const absoluteItems = items.filter((i) => i.type === "absolute") as ReminderAbsolute[];
            if (absoluteItems.length > 0) {
                for (const item of absoluteItems) {
                    const triggerTime = new Date(item.time).getTime();
                    if (triggerTime > now) continue;

                    const dedupKey = buildDedupKey(entry.blockId, item.time, 0, "absolute");
                    if (dismissed[dedupKey]) continue;
                    if (queuedDedupKeys.has(dedupKey)) continue;

                    const current = get(taskStore).allTasks.find((t) => t.blockId === entry.blockId);
                    if (!current || current.status === "done") continue;

                    newEntries.push({
                        blockId: entry.blockId,
                        title: entry.title,
                        triggerTime,
                        type: "absolute",
                        minutesBefore: 0,
                        baseDateStr: item.time,
                        dueTime: triggerTime,
                        dismissed: false,
                    });
                    queuedBlockIds.add(entry.blockId);
                    queuedDedupKeys.add(dedupKey);
                }
            }
        }

        // ---- Relative reminders: trigger at dueTime - minutes ----
        // Only fire when trigger time has passed BUT due time has NOT yet passed.
        // Overdue tasks are covered by the summary card, not individual alerts.
        {
            const items = getEffectiveReminders(entry);
            const relativeItems = items.filter((i) => i.type === "relative") as ReminderRelative[];
            for (const item of relativeItems) {
                if (queuedBlockIds.has(entry.blockId)) continue;
                if (!entry.due) continue;

                // Calculate the trigger time
                let dueTimeMs: number;
                if (entry.due.length > 10) {
                    dueTimeMs = new Date(entry.due).getTime();
                } else {
                    // Pure date: due time is end of day (23:59:59)
                    dueTimeMs = parseDateToMs(entry.due, 0) + 86399000;
                }
                const triggerTime = dueTimeMs - item.minutes * 60000;

                if (triggerTime > now) continue; // not yet time to remind
                if (dueTimeMs <= now) continue; // already overdue → summary card handles this

                const baseDateStr = entry.due.slice(0, 10);
                const dedupKey = buildDedupKey(entry.blockId, baseDateStr, item.minutes, "due");
                if (dismissed[dedupKey]) continue;
                if (queuedDedupKeys.has(dedupKey)) continue;

                queuedDedupKeys.add(dedupKey);
                queuedBlockIds.add(entry.blockId);
                newEntries.push({
                    blockId: entry.blockId,
                    title: entry.title,
                    type: "due" as const,
                    dueTime: dueTimeMs,
                    triggerTime,
                    minutesBefore: item.minutes,
                    baseDateStr,
                    dismissed: false,
                    summary: undefined,
                });
            }
        }

        // ---- Review date reminders ----
        if (entry.reviewDate && entry.status !== "done" && entry.status !== "someday") {
            const reviewMs = parseDateToMs(entry.reviewDate, REMINDER_REVIEW_HOUR);
            const baseDateStr = entry.reviewDate;
            const dedupKey = buildDedupKey(entry.blockId, baseDateStr, 0, "review");

            if (reviewMs <= now && !dismissed[dedupKey] && !queuedDedupKeys.has(dedupKey)) {
                const current = get(taskStore).allTasks.find((t) => t.blockId === entry.blockId);
                if (!current || current.status === "done") continue;

                newEntries.push({
                    blockId: entry.blockId,
                    title: entry.title,
                    triggerTime: reviewMs,
                    type: "review",
                    minutesBefore: 0,
                    baseDateStr,
                    dueTime: reviewMs,
                    dismissed: false,
                });
                queuedBlockIds.add(entry.blockId);
                queuedDedupKeys.add(dedupKey);
            }
        }
    }

    if (newEntries.length === 0) return;

    notificationQueue.update((queue) => {
        const existing = new Set(queue.map((r) => buildDedupKey(r.blockId, r.baseDateStr, r.minutesBefore, r.type)));
        const added: ReminderEntry[] = [];
        for (const e of newEntries) {
            const key = buildDedupKey(e.blockId, e.baseDateStr, e.minutesBefore, e.type);
            if (!existing.has(key)) {
                added.push(e);
                existing.add(key);
            }
        }
        return [...queue, ...added];
    });

    const updatedQueue = get(notificationQueue);
    const undismissed = updatedQueue.filter((r) => !r.dismissed);
    pendingReminderCount.set(undismissed.length);

    if (playNewSound && reminderSettings.soundEnabled) {
        const firstNew = newEntries[0];
        const soundId: ReminderSoundId =
            firstNew.type === "review" ? reminderSettings.reviewSound || "soft" : reminderSettings.dueSound || "chime";
        playSound(soundId).catch(() => {
            /* silent fallback */
        });
    }
}

// ---------------------------------------------------------------------------
// User actions
// ---------------------------------------------------------------------------

export function dismissReminder(dedupKey: string): void {
    dismissed[dedupKey] = Date.now();

    notificationQueue.update((queue) =>
        queue.map((r) => {
            const key = buildDedupKey(r.blockId, r.baseDateStr, r.minutesBefore, r.type);
            if (key === dedupKey) return { ...r, dismissed: true };
            return r;
        }),
    );

    // Also remove dismissed entries from the queue entirely to keep it clean
    notificationQueue.update((queue) => queue.filter((r) => !r.dismissed));

    const currentQueue = get(notificationQueue);
    pendingReminderCount.set(currentQueue.filter((r) => !r.dismissed).length);
    void saveDismissed();
}

export function dismissAllReminders(): void {
    const now = Date.now();
    const queue = get(notificationQueue);
    for (const r of queue) {
        if (!r.dismissed) {
            const key = buildDedupKey(r.blockId, r.baseDateStr, r.minutesBefore, r.type);
            dismissed[key] = now;
        }
    }
    void saveDismissed();

    notificationQueue.update((q) => q.map((r) => ({ ...r, dismissed: true })));
    pendingReminderCount.set(0);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function initReminderStore(plugin: Plugin): Promise<void> {
    pluginRef = plugin;

    // Load and clean up dismissed records using TTL
    await loadDismissed();

    // Initial scan (covers catch-up for missed reminders)
    try {
        scanReminders();
    } catch (e) {
        console.error("[NextAction] initial reminder scan failed:", e);
    }

    // Periodic scan
    scanTimer = setInterval(() => {
        try {
            scanReminders();
        } catch (e) {
            console.error("[NextAction] reminder scan failed:", e);
        }
    }, REMINDER_SCAN_INTERVAL_MS);
}

export function destroyReminderStore(): void {
    if (scanTimer !== null) {
        clearInterval(scanTimer);
        scanTimer = null;
    }
    pluginRef = null;
    notificationQueue.set([]);
    pendingReminderCount.set(0);
}
