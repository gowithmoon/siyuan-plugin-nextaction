// src/frontend/stores/reminder-store.ts
// Reminder core scanning & dismissal logic

import { writable, derived, get } from "svelte/store";
import { taskStore, tasksWithDueOrReview, pendingReminderCount } from "./task-store";
import {
    REMINDER_SCAN_INTERVAL_MS,
    REMINDER_REVIEW_HOUR,
    REMINDER_MAX_VISIBLE,
    REMINDER_IN_APP_DATA_PATH,
    type ReminderSoundId,
} from "../../shared/constants";
import type { ReminderEntry, TaskCacheEntry, ReminderItem } from "../../shared/types";
import type { Plugin } from "siyuan";
import { playSound } from "../utils/audio-player";
import { resolveReminderItems } from "../utils/reminder-utils";

export const notificationQueue = writable<ReminderEntry[]>([]);
export const visibleNotifications = derived(notificationQueue, ($q) => $q.slice(0, REMINDER_MAX_VISIBLE));
const deliveredKeys = new Set<string>();
let scanTimer: ReturnType<typeof setInterval> | null = null;
let pluginRef: Plugin | null = null;
let scanWatermarkMs = 0;
let previousPlan: StoredReminderPlan | null = null;
let unsubscribeTaskChanges: (() => void) | null = null;
let unsubscribeTaskSnapshots: (() => void) | null = null;

interface StoredReminderPlan {
    mode: "in-app" | "system" | "none";
    updatedAtMs: number;
    events: ReminderEntry[];
}

function getEffectiveReminders(entry: TaskCacheEntry): ReminderItem[] {
    return resolveReminderItems(entry.reminder, get(taskStore).settings?.reminderSettings, !!entry.due);
}

function parseDateToMs(dateStr: string, hour = 0): number {
    const datePart = dateStr.slice(0, 10);
    const [year, month, day] = datePart.split("-").map(Number);
    return new Date(year, month - 1, day, hour, 0, 0, 0).getTime();
}

export function buildDedupKey(
    blockId: string,
    baseDateStr: string,
    minutesBefore: number,
    type: "due" | "review" | "absolute",
): string {
    return `${blockId}|${baseDateStr}|${minutesBefore}|${type}`;
}

function reminderEventKey(entry: Pick<ReminderEntry, "blockId" | "baseDateStr" | "minutesBefore" | "type">): string {
    return buildDedupKey(entry.blockId, entry.baseDateStr, entry.minutesBefore, entry.type);
}

function parseStoredPlan(value: unknown): StoredReminderPlan | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const raw = value as Record<string, unknown>;
    if (raw.mode !== "in-app" && raw.mode !== "system" && raw.mode !== "none") return null;
    if (typeof raw.updatedAtMs !== "number" || !Number.isFinite(raw.updatedAtMs)) return null;
    if (!Array.isArray(raw.events)) return null;
    const events = raw.events.filter((event): event is ReminderEntry => {
        if (!event || typeof event !== "object") return false;
        const item = event as Partial<ReminderEntry>;
        return (
            typeof item.blockId === "string" &&
            typeof item.title === "string" &&
            Number.isFinite(item.triggerTime) &&
            (item.type === "due" || item.type === "review" || item.type === "absolute") &&
            Number.isFinite(item.minutesBefore) &&
            typeof item.baseDateStr === "string" &&
            Number.isFinite(item.dueTime)
        );
    });
    return { mode: raw.mode, updatedAtMs: raw.updatedAtMs, events };
}

async function loadReminderPlan(): Promise<void> {
    previousPlan = null;
    if (!pluginRef) return;
    try {
        previousPlan = parseStoredPlan(await pluginRef.loadData(REMINDER_IN_APP_DATA_PATH));
    } catch {
        previousPlan = null;
    }
}

function collectReminderEntries(entry: TaskCacheEntry): ReminderEntry[] {
    const result: ReminderEntry[] = [];
    for (const item of getEffectiveReminders(entry)) {
        if (item.type === "absolute") {
            const triggerTime = new Date(item.time).getTime();
            if (Number.isFinite(triggerTime)) {
                result.push({
                    blockId: entry.blockId,
                    title: entry.title,
                    triggerTime,
                    type: "absolute",
                    minutesBefore: 0,
                    baseDateStr: item.time,
                    dueTime: triggerTime,
                });
            }
            continue;
        }
        if (!entry.due) continue;
        const dueTime = entry.due.length > 10 ? new Date(entry.due).getTime() : parseDateToMs(entry.due) + 86399000;
        const triggerTime = dueTime - item.minutes * 60000;
        if (Number.isFinite(dueTime) && Number.isFinite(triggerTime)) {
            result.push({
                blockId: entry.blockId,
                title: entry.title,
                triggerTime,
                type: "due",
                minutesBefore: item.minutes,
                baseDateStr: entry.due.slice(0, 10),
                dueTime,
            });
        }
    }
    if (entry.reviewDate && entry.status !== "done" && entry.status !== "someday") {
        const triggerTime = parseDateToMs(entry.reviewDate, REMINDER_REVIEW_HOUR);
        if (Number.isFinite(triggerTime)) {
            result.push({
                blockId: entry.blockId,
                title: entry.title,
                triggerTime,
                type: "review",
                minutesBefore: 0,
                baseDateStr: entry.reviewDate,
                dueTime: triggerTime,
            });
        }
    }
    return result.sort((a, b) => a.triggerTime - b.triggerTime);
}

function currentFuturePlan(nowMs: number): ReminderEntry[] {
    const events: ReminderEntry[] = [];
    for (const task of get(tasksWithDueOrReview)) {
        for (const event of collectReminderEntries(task)) {
            if (event.triggerTime <= nowMs) continue;
            if (event.type === "due" && event.dueTime <= nowMs) continue;
            events.push(event);
        }
    }
    return events;
}

async function persistReminderPlan(): Promise<void> {
    const plugin = pluginRef;
    if (!plugin) return;
    try {
        await plugin.saveData(REMINDER_IN_APP_DATA_PATH, buildStoredReminderPlan());
    } catch {
        // Persistence is best effort; in-app notifications remain usable for this session.
    }
}

function buildStoredReminderPlan(nowMs = Date.now()): StoredReminderPlan {
    const mode = get(taskStore).settings.reminderSettings.deliveryMode;
    return {
        mode,
        updatedAtMs: nowMs,
        events: mode === "in-app" ? currentFuturePlan(nowMs) : [],
    };
}

function scanReminders(playNewSound = true, mode: "recovery" | "normal" = "normal", now = Date.now()): void {
    const reminderSettings = get(taskStore).settings?.reminderSettings;
    if (reminderSettings?.deliveryMode !== "in-app") return;

    const candidates = get(tasksWithDueOrReview);
    const currentQueue = get(notificationQueue);
    const queuedBlockIds = new Set(currentQueue.map((r) => r.blockId));
    const queuedDedupKeys = new Set(currentQueue.map(reminderEventKey));
    const newEntries: ReminderEntry[] = [];
    const recoveryEvents = new Map(
        previousPlan?.mode === "in-app"
            ? previousPlan.events
                  .filter((event) => event.triggerTime > previousPlan!.updatedAtMs && event.triggerTime <= now)
                  .map((event) => [reminderEventKey(event), event] as const)
            : [],
    );

    for (const task of candidates) {
        if (queuedBlockIds.has(task.blockId)) continue;
        const entries = collectReminderEntries(task).filter((event) => {
            if (event.triggerTime > now) return false;
            if (event.type === "due" && event.dueTime <= now) return false;
            if (mode === "recovery") {
                const previous = recoveryEvents.get(reminderEventKey(event));
                // A title edit changes what the user would see; do not replay the old plan.
                return previous?.title === event.title;
            }
            return event.triggerTime > scanWatermarkMs;
        });
        const candidate = entries[entries.length - 1];
        if (!candidate) continue;
        const key = reminderEventKey(candidate);
        if (deliveredKeys.has(key) || queuedDedupKeys.has(key)) continue;
        newEntries.push(candidate);
        queuedBlockIds.add(task.blockId);
        queuedDedupKeys.add(key);
    }

    scanWatermarkMs = Math.max(scanWatermarkMs, now);
    if (newEntries.length === 0) return;
    notificationQueue.update((queue) => {
        const existing = new Set(queue.map(reminderEventKey));
        const added: ReminderEntry[] = [];
        for (const entry of newEntries) {
            const key = reminderEventKey(entry);
            if (existing.has(key)) continue;
            existing.add(key);
            deliveredKeys.add(key);
            added.push(entry);
        }
        return [...queue, ...added];
    });
    pendingReminderCount.set(get(notificationQueue).length);
    if (playNewSound && reminderSettings.soundEnabled) {
        const firstNew = newEntries[0];
        const soundId: ReminderSoundId =
            firstNew.type === "review" ? reminderSettings.reviewSound || "soft" : reminderSettings.dueSound || "chime";
        playSound(soundId).catch(() => {
            /* silent fallback */
        });
    }
}

export function rebuildReminderQueue(): void {
    notificationQueue.set([]);
    pendingReminderCount.set(0);
    // Settings changes are not a recovery boundary: never catch up an event
    // that became overdue because the reminder definition just changed.
    scanWatermarkMs = Date.now();
    scanReminders(false, "normal");
    void persistReminderPlan();
}

export function dismissReminder(dedupKey: string): void {
    notificationQueue.update((queue) => queue.filter((entry) => reminderEventKey(entry) !== dedupKey));
    pendingReminderCount.set(get(notificationQueue).length);
}

export function dismissAllReminders(): void {
    notificationQueue.set([]);
    pendingReminderCount.set(0);
}

export async function initReminderStore(plugin: Plugin): Promise<void> {
    destroyReminderStore();
    pluginRef = plugin;
    scanWatermarkMs = Date.now();
    await loadReminderPlan();
    try {
        scanReminders(false, "recovery", Date.now());
    } catch (error) {
        console.error("[NextAction] initial reminder scan failed:", error);
    }
    previousPlan = null;
    void persistReminderPlan();
    unsubscribeTaskChanges = taskStore.observeCommittedChanges(() => {
        scanWatermarkMs = Date.now();
        void persistReminderPlan();
    });
    unsubscribeTaskSnapshots = taskStore.observeSnapshots(() => {
        scanWatermarkMs = Date.now();
        void persistReminderPlan();
    });
    scanTimer = setInterval(() => {
        try {
            scanReminders();
            if (get(notificationQueue).length > 0) void persistReminderPlan();
        } catch (error) {
            console.error("[NextAction] reminder scan failed:", error);
        }
    }, REMINDER_SCAN_INTERVAL_MS);
}

export function destroyReminderStore(): void {
    const plugin = pluginRef;
    if (plugin) {
        try {
            scanReminders(false, "normal");
        } catch {
            /* best effort before teardown */
        }
        void plugin.saveData(REMINDER_IN_APP_DATA_PATH, buildStoredReminderPlan()).catch(() => {
            /* best effort during teardown */
        });
    }
    pluginRef = null;
    unsubscribeTaskChanges?.();
    unsubscribeTaskSnapshots?.();
    unsubscribeTaskChanges = null;
    unsubscribeTaskSnapshots = null;
    previousPlan = null;
    if (scanTimer !== null) {
        clearInterval(scanTimer);
        scanTimer = null;
    }
    deliveredKeys.clear();
    notificationQueue.set([]);
    pendingReminderCount.set(0);
}
