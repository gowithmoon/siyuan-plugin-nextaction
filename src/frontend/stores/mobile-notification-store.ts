import { get } from "svelte/store";
import type { Plugin } from "siyuan";
import {
    REMINDER_MOBILE_CHANNEL,
    REMINDER_MOBILE_DATA_PATH,
    REMINDER_MOBILE_PLAN_HORIZON_MS,
} from "../../shared/constants";
import type { TaskCacheEntry } from "../../shared/types";
import type { ReminderSettings } from "../../shared/settings";
import { Mutex } from "../../shared/mutex";
import { taskStore } from "./task-store";
import type { TaskCollectionChanges } from "./task-sync-reducer";
import {
    buildPlanSnapshot,
    calculateNotificationTriggers,
    diffPlanSnapshot,
    type MobileNotificationTrigger,
    type MobilePlanSnapshot,
} from "../utils/mobile-notification-planner";

type FrontendKind = "mobile" | "desktop" | "desktop-window" | "browser-desktop" | "browser-mobile";

export interface MobileNotificationRuntime {
    getFrontend: () => FrontendKind;
    platformUtils: {
        sendNotification: (options: {
            title?: string;
            body?: string;
            delayInSeconds?: number;
            channel?: string;
        }) => Promise<number>;
        cancelNotification: (id: number) => void | Promise<void>;
    };
}

interface MobileNotificationStorage {
    readonly [deviceId: string]: Record<string, number[]>;
}

interface SiyuanWindow {
    siyuan?: {
        config?: { system?: { id?: string } };
    };
}

let pluginRef: Plugin | null = null;
let storage: MobileNotificationStorage = {};
let currentPlanSnapshot: Map<string, readonly number[]> = new Map();
const registeredContents = new Map<string, string>();
let initialized = false;
let initialization: Promise<void> | null = null;
let lifecycleGeneration = 0;
let runtimeOverride: MobileNotificationRuntime | null = null;
const storageMutex = new Mutex();

/**
 * Test and embedding seam for the platform boundary. The production entrypoint
 * injects SiYuan's statically imported CommonJS API; dynamic import("siyuan")
 * cannot resolve the host-provided module from the plugin bundle.
 */
export function configureMobileNotificationRuntime(runtime: MobileNotificationRuntime | null): void {
    runtimeOverride = runtime;
}

async function getPlatformRuntime(): Promise<MobileNotificationRuntime> {
    if (!runtimeOverride) throw new Error("SiYuan platform runtime is not configured");
    return runtimeOverride;
}

export function shouldScheduleSystemNotification(runtime: MobileNotificationRuntime | null = runtimeOverride): boolean {
    return !!runtime && supportsSystemNotifications(runtime.getFrontend());
}

export function supportsSystemNotifications(frontend: string): boolean {
    return frontend === "mobile" || frontend === "desktop" || frontend === "desktop-window";
}

export function isMobileApp(runtime: MobileNotificationRuntime | null = runtimeOverride): boolean {
    return runtime?.getFrontend() === "mobile";
}

function getDeviceId(): string {
    const maybeWindow = (globalThis as typeof globalThis & { window?: SiyuanWindow }).window;
    return maybeWindow?.siyuan?.config?.system?.id || "default";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeStorage(value: unknown): MobileNotificationStorage {
    if (!isRecord(value)) return {};
    const result: Record<string, Record<string, number[]>> = {};
    for (const [deviceId, rawDeviceStorage] of Object.entries(value)) {
        if (!isRecord(rawDeviceStorage)) continue;
        const deviceStorage: Record<string, number[]> = {};
        for (const [blockId, rawIds] of Object.entries(rawDeviceStorage)) {
            if (!Array.isArray(rawIds)) continue;
            const ids = rawIds.filter((id): id is number => typeof id === "number" && Number.isFinite(id));
            if (ids.length > 0) deviceStorage[blockId] = ids;
        }
        if (Object.keys(deviceStorage).length > 0) result[deviceId] = deviceStorage;
    }
    return result;
}

async function loadStorageUnlocked(): Promise<MobileNotificationStorage> {
    if (!pluginRef) return {};
    try {
        return normalizeStorage(await pluginRef.loadData(REMINDER_MOBILE_DATA_PATH));
    } catch {
        return {};
    }
}

async function saveStorageUnlocked(): Promise<void> {
    if (!pluginRef) return;
    try {
        await pluginRef.saveData(REMINDER_MOBILE_DATA_PATH, storage);
    } catch (error) {
        console.error("[NextAction] save mobile notification storage failed:", error);
    }
}

function isCurrentGeneration(generation: number): boolean {
    return generation === lifecycleGeneration && pluginRef !== null;
}

async function withStorageLock(operation: (generation: number) => Promise<void>): Promise<void> {
    const generation = lifecycleGeneration;
    const lock = await storageMutex.acquire().promise;
    try {
        if (generation === lifecycleGeneration) await operation(generation);
    } finally {
        lock.release();
    }
}

function currentDeviceStorage(): Record<string, number[]> {
    const deviceId = getDeviceId();
    const current = storage[deviceId];
    if (current) return current;
    const created: Record<string, number[]> = {};
    storage = { ...storage, [deviceId]: created };
    return created;
}

function removeCurrentDeviceStorage(): void {
    const deviceId = getDeviceId();
    if (!storage[deviceId]) return;
    const next = { ...storage };
    delete next[deviceId];
    storage = next;
}

async function cancelNotificationId(id: number): Promise<void> {
    try {
        const runtime = await getPlatformRuntime();
        if (!shouldScheduleSystemNotification(runtime)) return;
        await runtime.platformUtils.cancelNotification(id);
    } catch {
        // A stale native notification ID must never block cleanup of other IDs.
    }
}

function notificationContent(task: TaskCacheEntry, nowMs: number): string {
    return JSON.stringify(
        calculateNotificationTriggers(task, nowMs, REMINDER_MOBILE_PLAN_HORIZON_MS).map((trigger) => [
            trigger.title,
            trigger.kind,
            buildNotificationTitle(trigger),
            buildNotificationBody(trigger),
        ]),
    );
}

function fillNotificationTemplate(template: string, values: Record<string, string>): string {
    return Object.entries(values).reduce((result, [key, value]) => result.split(`{${key}}`).join(value), template);
}

function formatLocalTime(timestampMs: number): string {
    const date = new Date(timestampMs);
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatLocalDateTime(timestampMs: number, i18n: Record<string, string>): string {
    const date = new Date(timestampMs);
    const time = formatLocalTime(timestampMs);
    const template = i18n.reminderSystemNotificationDateTime || "{month}/{day} {time}";
    return fillNotificationTemplate(template, {
        month: String(date.getMonth() + 1),
        day: String(date.getDate()),
        time,
    });
}

function formatOffsetUnit(value: number, unit: "minutes" | "hours" | "days", i18n: Record<string, string>): string {
    const configuredUnit =
        i18n[
            unit === "minutes"
                ? "reminderOffsetMinutes"
                : unit === "hours"
                  ? "reminderOffsetHours"
                  : "reminderOffsetDays"
        ];
    if (configuredUnit === "分钟" || configuredUnit === "小时" || configuredUnit === "天") {
        return `${value}${configuredUnit}`;
    }
    const englishUnit = configuredUnit || unit;
    const singularUnit = value === 1 ? englishUnit.replace(/s$/, "") : englishUnit;
    return `${value} ${singularUnit}`;
}

function formatReminderOffset(minutes: number, i18n: Record<string, string>): string {
    const totalMinutes = Math.max(0, Math.floor(minutes));
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const remainingMinutes = totalMinutes % 60;
    const parts: string[] = [];
    if (days > 0) parts.push(formatOffsetUnit(days, "days", i18n));
    if (hours > 0) parts.push(formatOffsetUnit(hours, "hours", i18n));
    if (remainingMinutes > 0 || parts.length === 0) parts.push(formatOffsetUnit(remainingMinutes, "minutes", i18n));
    return parts.join(i18n.reminderOffsetDays === "天" ? "" : " ");
}

function notificationTaskTitle(trigger: MobileNotificationTrigger, i18n: Record<string, string>): string {
    return trigger.title.trim() || i18n.untitled || "Untitled";
}

function buildNotificationTitle(trigger: MobileNotificationTrigger): string {
    const i18n = pluginRef?.i18n || {};
    if (trigger.kind === "review") {
        return i18n.reminderSystemNotificationTitleReview || "NextAction · Review";
    }
    if (trigger.kind === "absolute") {
        return i18n.reminderSystemNotificationTitleAbsolute || "NextAction · Scheduled reminder";
    }
    return i18n.reminderSystemNotificationTitleRelative || "NextAction · Task reminder";
}

function buildNotificationBody(trigger: MobileNotificationTrigger): string {
    const i18n = pluginRef?.i18n || {};
    const task = notificationTaskTitle(trigger, i18n);
    if (trigger.kind === "review") {
        const template = i18n.reminderSystemNotificationBodyReview || "{task}\nReview today";
        const body = fillNotificationTemplate(template, { task });
        return body.includes(task) ? body : `${task}\n${body}`;
    }
    const dueTimeMs = trigger.triggerTimeMs + trigger.minutesBefore * 60_000;
    const values = {
        task,
        offset: formatReminderOffset(trigger.minutesBefore, i18n),
        dateTime: formatLocalDateTime(dueTimeMs, i18n),
        time: formatLocalTime(dueTimeMs),
    };
    const template =
        trigger.kind === "absolute"
            ? i18n.reminderSystemNotificationBodyAbsolute || "{task}\nScheduled for {dateTime}"
            : i18n.reminderSystemNotificationBodyRelative ||
              i18n.reminderSystemNotificationBody ||
              "{task}\nDue in {offset} · {dateTime}";
    const body = fillNotificationTemplate(template, values);
    return body.includes(task) ? body : `${task}\n${body}`;
}

async function sendNotificationForTrigger(
    trigger: MobileNotificationTrigger,
    generation: number,
): Promise<number | null> {
    const settings = get(taskStore).settings?.reminderSettings;
    if (!isCurrentGeneration(generation) || !settings?.systemNotificationEnabled) return null;

    try {
        const runtime = await getPlatformRuntime();
        if (!isCurrentGeneration(generation) || !shouldScheduleSystemNotification(runtime)) return null;
        const id = await runtime.platformUtils.sendNotification({
            title: buildNotificationTitle(trigger),
            body: buildNotificationBody(trigger),
            delayInSeconds: Math.max(0, Math.floor((trigger.triggerTimeMs - Date.now()) / 1000)),
            channel: REMINDER_MOBILE_CHANNEL,
        });
        if (!isCurrentGeneration(generation)) {
            if (id >= 0) await runtime.platformUtils.cancelNotification(id);
            return null;
        }
        return id >= 0 ? id : null;
    } catch (error) {
        console.error("[NextAction] send mobile notification failed:", error);
        return null;
    }
}

async function canScheduleSystemNotification(): Promise<boolean> {
    if (!get(taskStore).settings?.reminderSettings?.systemNotificationEnabled) return false;
    const runtime = await getPlatformRuntime().catch(() => null);
    return !!runtime && shouldScheduleSystemNotification(runtime);
}

async function cancelBlockUnlocked(blockId: string, generation: number): Promise<void> {
    if (!isCurrentGeneration(generation)) return;
    const deviceStorage = currentDeviceStorage();
    const ids = deviceStorage[blockId];
    if (!ids) return;
    await Promise.all(ids.map((id) => cancelNotificationId(id)));
    if (!isCurrentGeneration(generation)) return;
    delete deviceStorage[blockId];
    registeredContents.delete(blockId);
    await saveStorageUnlocked();
    if (!isCurrentGeneration(generation)) return;
    currentPlanSnapshot = new Map([...currentPlanSnapshot].filter(([id]) => id !== blockId));
}

async function scheduleTaskUnlocked(task: TaskCacheEntry, nowMs: number, generation: number): Promise<void> {
    await cancelBlockUnlocked(task.blockId, generation);
    if (!isCurrentGeneration(generation)) return;
    const triggers = calculateNotificationTriggers(task, nowMs, REMINDER_MOBILE_PLAN_HORIZON_MS);
    const ids: number[] = [];
    const successfulTriggerTimes: number[] = [];
    for (const trigger of triggers) {
        const id = await sendNotificationForTrigger(trigger, generation);
        if (!isCurrentGeneration(generation)) {
            await Promise.all(ids.map((registeredId) => cancelNotificationId(registeredId)));
            return;
        }
        if (id !== null) {
            ids.push(id);
            successfulTriggerTimes.push(trigger.triggerTimeMs);
        }
    }
    if (!isCurrentGeneration(generation)) return;
    const deviceStorage = currentDeviceStorage();
    if (ids.length > 0) {
        deviceStorage[task.blockId] = ids;
    } else {
        delete deviceStorage[task.blockId];
    }
    await saveStorageUnlocked();
    if (!isCurrentGeneration(generation)) return;
    currentPlanSnapshot = new Map(currentPlanSnapshot);
    if (successfulTriggerTimes.length > 0) {
        currentPlanSnapshot.set(task.blockId, successfulTriggerTimes);
        registeredContents.set(task.blockId, notificationContent(task, nowMs));
    } else {
        currentPlanSnapshot.delete(task.blockId);
        registeredContents.delete(task.blockId);
    }
}

async function cancelCurrentDeviceUnlocked(generation: number): Promise<void> {
    if (!isCurrentGeneration(generation)) return;
    const deviceStorage = currentDeviceStorage();
    const ids = Object.values(deviceStorage).flat();
    await Promise.all(ids.map((id) => cancelNotificationId(id)));
    if (!isCurrentGeneration(generation)) return;
    removeCurrentDeviceStorage();
    await saveStorageUnlocked();
    if (!isCurrentGeneration(generation)) return;
    currentPlanSnapshot = new Map();
    registeredContents.clear();
}

export async function initMobileNotificationStore(
    plugin: Plugin,
    canInitialize: () => boolean = () => true,
): Promise<boolean> {
    if (pluginRef === plugin && initialized) return true;
    if (pluginRef === plugin && initialization) {
        await initialization;
        return initialized;
    }
    const generation = ++lifecycleGeneration;
    pluginRef = plugin;
    initialization = withStorageLock(async () => {
        const loaded = await loadStorageUnlocked();
        if (!isCurrentGeneration(generation)) return;
        storage = loaded;
        const runtime = await getPlatformRuntime().catch(() => null);
        if (!isCurrentGeneration(generation)) return;
        if (!canInitialize()) return;
        if (runtime && shouldScheduleSystemNotification(runtime)) {
            await cancelCurrentDeviceUnlocked(generation);
        }
        if (!isCurrentGeneration(generation)) return;
        initialized = true;
    });
    await initialization;
    if (generation === lifecycleGeneration) initialization = null;
    return generation === lifecycleGeneration && initialized;
}

export function destroyMobileNotificationStore(): void {
    lifecycleGeneration++;
    pluginRef = null;
    storage = {};
    currentPlanSnapshot = new Map();
    registeredContents.clear();
    initialized = false;
    initialization = null;
}

export async function scheduleMobileNotifications(task: TaskCacheEntry, nowMs = Date.now()): Promise<void> {
    if (!initialized) return;
    await withStorageLock(async (generation) => {
        if (!(await canScheduleSystemNotification()) || !isCurrentGeneration(generation)) return;
        await scheduleTaskUnlocked(task, nowMs, generation);
    });
}

export async function cancelMobileNotifications(blockId: string): Promise<void> {
    if (!initialized) return;
    await withStorageLock(async (generation) => {
        await cancelBlockUnlocked(blockId, generation);
    });
}

export async function updateMobileNotifications(
    newTask: TaskCacheEntry,
    oldTask?: TaskCacheEntry,
    nowMs = Date.now(),
): Promise<void> {
    if (!initialized) return;
    if (
        oldTask &&
        oldTask.due === newTask.due &&
        oldTask.reviewDate === newTask.reviewDate &&
        oldTask.reminder === newTask.reminder &&
        oldTask.status === newTask.status &&
        oldTask.title === newTask.title
    ) {
        return;
    }
    await withStorageLock(async (generation) => {
        if (newTask.status === "done" || newTask.status === "someday") {
            await cancelBlockUnlocked(newTask.blockId, generation);
        } else if (await canScheduleSystemNotification()) {
            await scheduleTaskUnlocked(newTask, nowMs, generation);
        }
    });
}

/** Consume committed changes without loading or writing tasks. */
export async function onTasksChangedV2(
    changes: TaskCollectionChanges,
    previous: ReadonlyMap<string, TaskCacheEntry>,
    nowMs = Date.now(),
): Promise<void> {
    const results = await Promise.allSettled([
        ...changes.deletedBlockIds.map((blockId) => cancelMobileNotifications(blockId)),
        ...changes.upserts.map((task) => updateMobileNotifications(task, previous.get(task.blockId), nowMs)),
    ]);
    for (const result of results) {
        if (result.status === "rejected") {
            console.error("[NextAction] update mobile notifications failed:", result.reason);
        }
    }
}

export async function rebuildAllMobileNotifications(
    tasks: readonly TaskCacheEntry[],
    nowMs = Date.now(),
): Promise<void> {
    if (!initialized) return;
    await withStorageLock(async (generation) => {
        if (!(await canScheduleSystemNotification()) || !isCurrentGeneration(generation)) return;
        const next = buildPlanSnapshot(tasks, nowMs, REMINDER_MOBILE_PLAN_HORIZON_MS);
        const diff = diffPlanSnapshot(currentPlanSnapshot, next);
        const taskById = new Map(tasks.map((task) => [task.blockId, task]));
        diff.unchanged = diff.unchanged.filter((blockId) => {
            const task = taskById.get(blockId)!;
            if (registeredContents.get(blockId) === notificationContent(task, nowMs)) return true;
            diff.toRebuild.push(blockId);
            return false;
        });
        for (const blockId of diff.toCancel) await cancelBlockUnlocked(blockId, generation);
        for (const blockId of diff.toRebuild) {
            const task = taskById.get(blockId);
            if (task) await scheduleTaskUnlocked(task, nowMs, generation);
        }
        if (!isCurrentGeneration(generation)) return;
        const registeredPlan = new Map<string, readonly number[]>();
        for (const blockId of diff.unchanged) {
            const times = next.get(blockId);
            if (times) registeredPlan.set(blockId, times);
        }
        for (const blockId of diff.toRebuild) {
            const times = currentPlanSnapshot.get(blockId);
            if (times) registeredPlan.set(blockId, times);
        }
        currentPlanSnapshot = registeredPlan;
    });
}

export async function cancelAllMobileNotifications(): Promise<void> {
    if (!initialized) return;
    await withStorageLock(async (generation) => {
        await cancelCurrentDeviceUnlocked(generation);
    });
}

/** Apply notification changes only after settings persistence and task refresh succeed. */
export async function applyMobileNotificationSettings(
    previous: ReminderSettings,
    next: ReminderSettings,
    tasks: readonly TaskCacheEntry[],
    nowMs = Date.now(),
): Promise<void> {
    if (previous.systemNotificationEnabled && !next.systemNotificationEnabled) {
        await cancelAllMobileNotifications();
    } else if (
        next.systemNotificationEnabled &&
        (!previous.systemNotificationEnabled ||
            previous.defaultOffsets.length !== next.defaultOffsets.length ||
            previous.defaultOffsets.some((offset, index) => offset !== next.defaultOffsets[index]))
    ) {
        await rebuildAllMobileNotifications(tasks, nowMs);
    }
}
