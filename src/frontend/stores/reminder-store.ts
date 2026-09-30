// src/frontend/stores/reminder-store.ts
// Reminder core scanning & dismissal logic

import { writable, derived, get } from "svelte/store";
import { taskStore, tasksWithDueOrReview, pendingReminderCount } from "./task-store";
import {
    REMINDER_SCAN_INTERVAL_MS,
    REMINDER_REVIEW_HOUR,
    REMINDER_MAX_VISIBLE,
    type ReminderSoundId,
} from "../../shared/constants";
import type {
    ReminderEntry,
    TaskCacheEntry,
    ReminderItem,
    ReminderRelative,
    ReminderAbsolute,
} from "../../shared/types";
import type { Plugin } from "siyuan";
import { playSound } from "../utils/audio-player";
import { resolveReminderItems } from "../utils/reminder-utils";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Notification queue — consumed by NotificationHost UI */
export const notificationQueue = writable<ReminderEntry[]>([]);

/** Visible slice of the notification queue (capped by REMINDER_MAX_VISIBLE) */
export const visibleNotifications = derived(notificationQueue, ($q) => $q.slice(0, REMINDER_MAX_VISIBLE));

/** Reminder events already shown during the current plugin lifetime. */
const deliveredKeys = new Set<string>();

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

/** Rebuild pending in-app reminders after a settings change. */
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
    type: "due" | "review" | "absolute",
): string {
    return `${blockId}|${baseDateStr}|${minutesBefore}|${type}`;
}

// ---------------------------------------------------------------------------
// Core scan
// ---------------------------------------------------------------------------

function scanReminders(playNewSound = true): void {
    const settings = get(taskStore).settings;
    const reminderSettings = settings?.reminderSettings;
    if (reminderSettings?.deliveryMode !== "in-app") return;

    const now = Date.now();
    const candidates = get(tasksWithDueOrReview);
    const currentQueue = get(notificationQueue);
    const queuedBlockIds = new Set(currentQueue.map((r) => r.blockId));
    const queuedDedupKeys = new Set<string>(
        currentQueue.map((r) => buildDedupKey(r.blockId, r.baseDateStr, r.minutesBefore, r.type)),
    );
    const newEntries: ReminderEntry[] = [];

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
                    if (deliveredKeys.has(dedupKey)) continue;
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
                if (deliveredKeys.has(dedupKey)) continue;
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
                });
            }
        }

        // ---- Review date reminders ----
        if (entry.reviewDate && entry.status !== "done" && entry.status !== "someday") {
            const reviewMs = parseDateToMs(entry.reviewDate, REMINDER_REVIEW_HOUR);
            const baseDateStr = entry.reviewDate;
            const dedupKey = buildDedupKey(entry.blockId, baseDateStr, 0, "review");

            if (reviewMs <= now && !deliveredKeys.has(dedupKey) && !queuedDedupKeys.has(dedupKey)) {
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
                deliveredKeys.add(key);
            }
        }
        return [...queue, ...added];
    });

    const updatedQueue = get(notificationQueue);
    pendingReminderCount.set(updatedQueue.length);

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
    notificationQueue.update((queue) =>
        queue.filter((r) => buildDedupKey(r.blockId, r.baseDateStr, r.minutesBefore, r.type) !== dedupKey),
    );

    const currentQueue = get(notificationQueue);
    pendingReminderCount.set(currentQueue.length);
}

export function dismissAllReminders(): void {
    notificationQueue.set([]);
    pendingReminderCount.set(0);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function initReminderStore(_plugin: Plugin): Promise<void> {
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
    deliveredKeys.clear();
    notificationQueue.set([]);
    pendingReminderCount.set(0);
}
