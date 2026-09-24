import { REMINDER_MOBILE_PLAN_HORIZON_MS, REMINDER_REVIEW_HOUR } from "../../shared/constants";
import type { TaskCacheEntry, ReminderAbsolute, ReminderRelative } from "../../shared/types";
import type { ReminderSettings } from "../../shared/settings";
import { resolveReminderItems } from "./reminder-utils";

export interface MobileNotificationTrigger {
    readonly blockId: string;
    readonly title: string;
    readonly triggerTimeMs: number;
    readonly kind: "absolute" | "relative" | "review";
    readonly minutesBefore: number;
    readonly baseDateStr: string;
}

export type MobileNotificationPlan = readonly MobileNotificationTrigger[];
export type MobilePlanSnapshot = ReadonlyMap<string, readonly number[]>;

function parseDateToMs(dateStr: string, hour = 0): number {
    const datePart = dateStr.slice(0, 10);
    const [year, month, day] = datePart.split("-").map(Number);
    if (![year, month, day].every(Number.isFinite)) return Number.NaN;
    return new Date(year, month - 1, day, hour, 0, 0, 0).getTime();
}

function isWithinPlanWindow(triggerTimeMs: number, nowMs: number, daysLimitMs: number): boolean {
    return Number.isFinite(triggerTimeMs) && triggerTimeMs > nowMs && triggerTimeMs < nowMs + daysLimitMs;
}

function createTrigger(
    task: TaskCacheEntry,
    triggerTimeMs: number,
    kind: MobileNotificationTrigger["kind"],
    minutesBefore: number,
    baseDateStr: string,
): MobileNotificationTrigger {
    return {
        blockId: task.blockId,
        title: task.title,
        triggerTimeMs,
        kind,
        minutesBefore,
        baseDateStr,
    };
}

/** Calculate every future trigger for one task in the requested planning window. */
export function calculateNotificationTriggers(
    task: TaskCacheEntry,
    nowMs: number,
    daysLimitMs: number = REMINDER_MOBILE_PLAN_HORIZON_MS,
    reminderSettings?: ReminderSettings,
): MobileNotificationTrigger[] {
    if (task.status === "done" || task.status === "someday") return [];

    const triggers: MobileNotificationTrigger[] = [];
    const items = resolveReminderItems(task.reminder, reminderSettings, !!task.due);
    for (const item of items) {
        if (item.type === "absolute") {
            const triggerTimeMs = new Date((item as ReminderAbsolute).time).getTime();
            if (isWithinPlanWindow(triggerTimeMs, nowMs, daysLimitMs)) {
                triggers.push(createTrigger(task, triggerTimeMs, "absolute", 0, item.time));
            }
            continue;
        }

        if (!task.due) continue;
        const relative = item as ReminderRelative;
        const dueTimeMs = task.due.length > 10 ? new Date(task.due).getTime() : parseDateToMs(task.due, 0) + 86_399_000;
        const triggerTimeMs = dueTimeMs - relative.minutes * 60_000;
        if (dueTimeMs > nowMs && isWithinPlanWindow(triggerTimeMs, nowMs, daysLimitMs)) {
            triggers.push(createTrigger(task, triggerTimeMs, "relative", relative.minutes, task.due.slice(0, 10)));
        }
    }

    if (task.reviewDate) {
        const triggerTimeMs = parseDateToMs(task.reviewDate, REMINDER_REVIEW_HOUR);
        if (isWithinPlanWindow(triggerTimeMs, nowMs, daysLimitMs)) {
            triggers.push(createTrigger(task, triggerTimeMs, "review", 0, task.reviewDate));
        }
    }

    return triggers.sort((a, b) => a.triggerTimeMs - b.triggerTimeMs);
}

export function buildPlanSnapshot(
    tasks: readonly TaskCacheEntry[],
    nowMs: number,
    daysLimitMs: number = REMINDER_MOBILE_PLAN_HORIZON_MS,
    reminderSettings?: ReminderSettings,
): MobilePlanSnapshot {
    const snapshot = new Map<string, readonly number[]>();
    for (const task of tasks) {
        const triggerTimes = calculateNotificationTriggers(task, nowMs, daysLimitMs, reminderSettings).map(
            (trigger) => trigger.triggerTimeMs,
        );
        if (triggerTimes.length > 0) snapshot.set(task.blockId, triggerTimes);
    }
    return snapshot;
}

export function isSameTriggerTimes(a: readonly number[], b: readonly number[]): boolean {
    return a.length === b.length && a.every((time, index) => time === b[index]);
}

export function diffPlanSnapshot(
    prev: MobilePlanSnapshot,
    next: MobilePlanSnapshot,
): { toCancel: string[]; toRebuild: string[]; unchanged: string[] } {
    const toCancel: string[] = [];
    const toRebuild: string[] = [];
    const unchanged: string[] = [];
    const blockIds = new Set([...prev.keys(), ...next.keys()]);
    for (const blockId of blockIds) {
        const before = prev.get(blockId);
        const after = next.get(blockId);
        if (!after) {
            if (before) toCancel.push(blockId);
        } else if (!before) {
            toRebuild.push(blockId);
        } else if (isSameTriggerTimes(before, after)) {
            unchanged.push(blockId);
        } else {
            toRebuild.push(blockId);
        }
    }
    return { toCancel, toRebuild, unchanged };
}

export function buildTriggerKey(trigger: MobileNotificationTrigger): string {
    return `${trigger.blockId}|${trigger.triggerTimeMs}|${trigger.kind}`;
}
