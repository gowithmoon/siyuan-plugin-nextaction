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
let initialized = false;
let lifecycleGeneration = 0;
let runtimeOverride: MobileNotificationRuntime | null = null;
let runtimePromise: Promise<MobileNotificationRuntime> | null = null;
const storageMutex = new Mutex();

/** Test and embedding seam for the platform boundary. Production callers leave this unset. */
export function configureMobileNotificationRuntime(runtime: MobileNotificationRuntime | null): void {
    runtimeOverride = runtime;
    runtimePromise = null;
}

async function getPlatformRuntime(): Promise<MobileNotificationRuntime> {
    if (runtimeOverride) return runtimeOverride;
    if (!runtimePromise) {
        runtimePromise = import("siyuan").then((siyuan) => ({
            getFrontend: siyuan.getFrontend,
            platformUtils: siyuan.platformUtils,
        }));
    }
    return runtimePromise;
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

async function withStorageLock<T>(operation: () => Promise<T>): Promise<T> {
    const handle = storageMutex.acquire();
    const lock = await handle.promise;
    try {
        return await operation();
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
        await runtime.platformUtils.cancelNotification(id);
    } catch {
        // A stale native notification ID must never block cleanup of other IDs.
    }
}

function formatLocalTime(timestampMs: number): string {
    const date = new Date(timestampMs);
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function buildNotificationBody(trigger: MobileNotificationTrigger): string {
    const i18n = pluginRef?.i18n || {};
    if (trigger.kind === "review") {
        return i18n.reminderSystemNotificationBodyReview || "";
    }
    return (i18n.reminderSystemNotificationBody || "").replace("{time}", formatLocalTime(trigger.triggerTimeMs));
}

async function sendNotificationForTrigger(trigger: MobileNotificationTrigger): Promise<number | null> {
    const settings = get(taskStore).settings?.reminderSettings;
    if (!settings?.systemNotificationEnabled) return null;

    try {
        const runtime = await getPlatformRuntime();
        if (!shouldScheduleSystemNotification(runtime)) return null;
        const id = await runtime.platformUtils.sendNotification({
            title: trigger.title,
            body: buildNotificationBody(trigger),
            delayInSeconds: Math.max(0, Math.floor((trigger.triggerTimeMs - Date.now()) / 1000)),
            channel: REMINDER_MOBILE_CHANNEL,
        });
        return id >= 0 ? id : null;
    } catch {
        return null;
    }
}

async function canScheduleSystemNotification(): Promise<boolean> {
    if (!get(taskStore).settings?.reminderSettings?.systemNotificationEnabled) return false;
    const runtime = await getPlatformRuntime().catch(() => null);
    return !!runtime && shouldScheduleSystemNotification(runtime);
}

async function cancelBlockUnlocked(blockId: string): Promise<void> {
    const deviceStorage = currentDeviceStorage();
    const ids = deviceStorage[blockId];
    if (!ids) return;
    await Promise.all(ids.map((id) => cancelNotificationId(id)));
    delete deviceStorage[blockId];
    await saveStorageUnlocked();
    currentPlanSnapshot = new Map([...currentPlanSnapshot].filter(([id]) => id !== blockId));
}

async function scheduleTaskUnlocked(task: TaskCacheEntry, nowMs: number): Promise<void> {
    await cancelBlockUnlocked(task.blockId);
    const triggers = calculateNotificationTriggers(task, nowMs, REMINDER_MOBILE_PLAN_HORIZON_MS);
    const ids: number[] = [];
    const successfulTriggerTimes: number[] = [];
    for (const trigger of triggers) {
        const id = await sendNotificationForTrigger(trigger);
        if (id !== null) {
            ids.push(id);
            successfulTriggerTimes.push(trigger.triggerTimeMs);
        }
    }
    const deviceStorage = currentDeviceStorage();
    if (ids.length > 0) {
        deviceStorage[task.blockId] = ids;
    } else {
        delete deviceStorage[task.blockId];
    }
    await saveStorageUnlocked();
    currentPlanSnapshot = new Map(currentPlanSnapshot);
    if (successfulTriggerTimes.length > 0) {
        currentPlanSnapshot.set(task.blockId, successfulTriggerTimes);
    } else {
        currentPlanSnapshot.delete(task.blockId);
    }
}

async function cancelCurrentDeviceUnlocked(): Promise<void> {
    const deviceStorage = currentDeviceStorage();
    const ids = Object.values(deviceStorage).flat();
    await Promise.all(ids.map((id) => cancelNotificationId(id)));
    removeCurrentDeviceStorage();
    await saveStorageUnlocked();
    currentPlanSnapshot = new Map();
}

export async function initMobileNotificationStore(plugin: Plugin): Promise<void> {
    const generation = ++lifecycleGeneration;
    await withStorageLock(async () => {
        if (generation !== lifecycleGeneration) return;
        pluginRef = plugin;
        const loaded = await loadStorageUnlocked();
        if (generation !== lifecycleGeneration) return;
        storage = loaded;
        const runtime = await getPlatformRuntime().catch(() => null);
        if (generation !== lifecycleGeneration) return;
        if (runtime && shouldScheduleSystemNotification(runtime)) {
            await cancelCurrentDeviceUnlocked();
        }
        if (generation !== lifecycleGeneration) return;
        initialized = true;
    });
}

export function destroyMobileNotificationStore(): void {
    lifecycleGeneration++;
    pluginRef = null;
    storage = {};
    currentPlanSnapshot = new Map();
    initialized = false;
}

export async function scheduleMobileNotifications(task: TaskCacheEntry, nowMs = Date.now()): Promise<void> {
    if (!initialized) return;
    if (!(await canScheduleSystemNotification())) return;
    await withStorageLock(async () => {
        await scheduleTaskUnlocked(task, nowMs);
    });
}

export async function cancelMobileNotifications(blockId: string): Promise<void> {
    if (!initialized) return;
    await withStorageLock(async () => {
        await cancelBlockUnlocked(blockId);
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
    if (newTask.status !== "done" && newTask.status !== "someday" && !(await canScheduleSystemNotification())) {
        return;
    }
    await withStorageLock(async () => {
        if (newTask.status === "done" || newTask.status === "someday") {
            await cancelBlockUnlocked(newTask.blockId);
        } else {
            await scheduleTaskUnlocked(newTask, nowMs);
        }
    });
}

export async function rebuildAllMobileNotifications(
    tasks: readonly TaskCacheEntry[],
    nowMs = Date.now(),
): Promise<void> {
    if (!initialized) return;
    const runtime = await getPlatformRuntime().catch(() => null);
    if (
        !runtime ||
        !shouldScheduleSystemNotification(runtime) ||
        !get(taskStore).settings?.reminderSettings?.systemNotificationEnabled
    ) {
        return;
    }

    await withStorageLock(async () => {
        const next = buildPlanSnapshot(tasks, nowMs, REMINDER_MOBILE_PLAN_HORIZON_MS);
        const diff = diffPlanSnapshot(currentPlanSnapshot, next);
        const taskById = new Map(tasks.map((task) => [task.blockId, task]));
        for (const blockId of diff.toCancel) await cancelBlockUnlocked(blockId);
        for (const blockId of diff.toRebuild) {
            const task = taskById.get(blockId);
            if (task) await scheduleTaskUnlocked(task, nowMs);
        }
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
    await withStorageLock(async () => {
        await cancelCurrentDeviceUnlocked();
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
