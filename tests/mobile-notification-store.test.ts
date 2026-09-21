import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { DEFAULT_SETTINGS, mergeSettings } from "../src/shared/settings.ts";
import type { TaskCacheEntry } from "../src/shared/types.ts";
import { taskFactory } from "./helpers/fakes.ts";
import {
    cancelAllMobileNotifications,
    cancelMobileNotifications,
    configureMobileNotificationRuntime,
    destroyMobileNotificationStore,
    initMobileNotificationStore,
    rebuildAllMobileNotifications,
    scheduleMobileNotifications,
    supportsSystemNotifications,
    updateMobileNotifications,
    type MobileNotificationRuntime,
} from "../src/frontend/stores/mobile-notification-store.ts";
import { taskStore } from "../src/frontend/stores/task-store.ts";

type FakePlugin = {
    i18n: Record<string, string>;
    loadData: (path: string) => Promise<unknown>;
    saveData: (path: string, value: unknown) => Promise<void>;
};

const NOW = new Date(2030, 0, 1, 8, 0, 0, 0).getTime();

function futureTask(blockId: string, hour: number): TaskCacheEntry {
    return taskFactory(blockId, {
        reminder: JSON.stringify([{ type: "absolute", time: `2030-01-01T${String(hour).padStart(2, "0")}:00` }]),
    });
}

function createHarness(frontend: MobileNotificationRuntime["getFrontend"] = () => "mobile") {
    let persisted: unknown = {};
    const sent: Array<{ id: number; options: Record<string, unknown> }> = [];
    const cancelled: number[] = [];
    const savedPaths: string[] = [];
    const plugin: FakePlugin = {
        i18n: {
            reminderSystemNotificationBody: "Due at {time}",
            reminderSystemNotificationBodyReview: "Review today",
        },
        async loadData() {
            return persisted;
        },
        async saveData(path, value) {
            savedPaths.push(path);
            persisted = JSON.parse(JSON.stringify(value));
        },
    };
    let nextId = 1;
    configureMobileNotificationRuntime({
        getFrontend: frontend,
        platformUtils: {
            async sendNotification(options) {
                const id = nextId++;
                sent.push({ id, options });
                return id;
            },
            cancelNotification(id) {
                cancelled.push(id);
            },
        },
    });
    return {
        plugin: plugin as never,
        sent,
        cancelled,
        savedPaths,
        readStorage: () => persisted,
        setStorage: (value: unknown) => {
            persisted = value;
        },
    };
}

beforeEach(() => {
    taskStore.applySettingsUpdate(
        mergeSettings(DEFAULT_SETTINGS, {
            reminderSettings: { ...DEFAULT_SETTINGS.reminderSettings, systemNotificationEnabled: true },
        }),
    );
    (globalThis as unknown as { window?: unknown }).window = {
        siyuan: { config: { system: { id: "device-a" } } },
    };
});

afterEach(() => {
    destroyMobileNotificationStore();
    configureMobileNotificationRuntime(null);
    taskStore.applySettingsUpdate(DEFAULT_SETTINGS);
    delete (globalThis as unknown as { window?: unknown }).window;
});

test("支持的平台调度通知并按设备持久化 ID", async () => {
    const harness = createHarness();
    await initMobileNotificationStore(harness.plugin);
    await scheduleMobileNotifications(futureTask("task-a", 10), NOW);

    assert.equal(harness.sent.length, 1);
    assert.equal(harness.sent[0].options.channel, "NextAction Reminders");
    assert.equal(harness.sent[0].options.body, "Due at 10:00");
    assert.deepEqual(harness.readStorage(), { "device-a": { "task-a": [1] } });
});

test("浏览器端和平台 -1 都静默跳过原生通知", async () => {
    const browser = createHarness(() => "browser-desktop");
    await initMobileNotificationStore(browser.plugin);
    await scheduleMobileNotifications(futureTask("browser-task", 10), NOW);
    assert.equal(browser.sent.length, 0);

    destroyMobileNotificationStore();
    const unsupported = createHarness();
    unsupported.sent.length = 0;
    configureMobileNotificationRuntime({
        getFrontend: () => "mobile",
        platformUtils: {
            async sendNotification() {
                unsupported.sent.push({ id: -1, options: {} });
                return -1;
            },
            cancelNotification() {},
        },
    });
    await initMobileNotificationStore(unsupported.plugin);
    await scheduleMobileNotifications(futureTask("unsupported-task", 10), NOW);
    assert.equal(unsupported.sent.length, 1);
    assert.deepEqual(unsupported.readStorage(), { "device-a": {} });
});

test("取消任务通知会取消全部 ID 并移除当前设备映射", async () => {
    const harness = createHarness();
    harness.setStorage({ "device-a": { "task-a": [41, 42] } });
    await initMobileNotificationStore(harness.plugin);
    assert.deepEqual(harness.cancelled, [41, 42]);

    harness.setStorage({ "device-a": { "task-a": [41, 42] } });
    await scheduleMobileNotifications(futureTask("task-a", 10), NOW);
    harness.cancelled.length = 0;
    await cancelMobileNotifications("task-a");
    assert.deepEqual(harness.cancelled, [1]);
    assert.deepEqual(harness.readStorage(), { "device-a": {} });
});

test("提醒字段未变化时跳过更新，变化或完成时取消并重建", async () => {
    const harness = createHarness();
    const original = futureTask("task-a", 10);
    await initMobileNotificationStore(harness.plugin);
    await scheduleMobileNotifications(original, NOW);
    harness.sent.length = 0;
    harness.cancelled.length = 0;

    await updateMobileNotifications({ ...original, title: original.title }, original, NOW);
    assert.equal(harness.sent.length, 0);
    assert.equal(harness.cancelled.length, 0);

    await updateMobileNotifications(futureTask("task-a", 11), original, NOW);
    assert.deepEqual(harness.cancelled, [1]);
    assert.equal(harness.sent.length, 1);

    harness.sent.length = 0;
    harness.cancelled.length = 0;
    await updateMobileNotifications({ ...original, status: "done" }, original, NOW);
    assert.deepEqual(harness.cancelled, [2]);
    assert.equal(harness.sent.length, 0);
});

test("全量重建基于快照 diff 保持幂等，并保护并发持久化更新", async () => {
    const harness = createHarness();
    await initMobileNotificationStore(harness.plugin);
    const tasks = [futureTask("task-a", 10), futureTask("task-b", 11), futureTask("task-c", 12)];
    await rebuildAllMobileNotifications(tasks, NOW);
    assert.equal(harness.sent.length, 3);
    harness.sent.length = 0;
    harness.cancelled.length = 0;
    await rebuildAllMobileNotifications(tasks, NOW);
    assert.equal(harness.sent.length, 0);
    assert.equal(harness.cancelled.length, 0);

    await Promise.all([
        scheduleMobileNotifications(futureTask("concurrent-a", 10), NOW),
        scheduleMobileNotifications(futureTask("concurrent-b", 11), NOW),
    ]);
    const bucket = (harness.readStorage() as Record<string, Record<string, number[]>>)["device-a"];
    assert.deepEqual(Object.keys(bucket).sort(), ["concurrent-a", "concurrent-b", "task-a", "task-b", "task-c"]);
});

test("部分原生通知注册失败时只缓存成功触发点并允许下次重试", async () => {
    const harness = createHarness();
    let calls = 0;
    configureMobileNotificationRuntime({
        getFrontend: () => "mobile",
        platformUtils: {
            async sendNotification(options) {
                calls++;
                harness.sent.push({ id: calls, options });
                return calls === 2 ? -1 : calls;
            },
            cancelNotification(id) {
                harness.cancelled.push(id);
            },
        },
    });
    await initMobileNotificationStore(harness.plugin);
    const task = taskFactory("partial", {
        reminder: JSON.stringify([
            { type: "absolute", time: "2030-01-01T10:00" },
            { type: "absolute", time: "2030-01-01T11:00" },
        ]),
    });
    await rebuildAllMobileNotifications([task], NOW);
    await rebuildAllMobileNotifications([task], NOW);
    assert.equal(calls, 4);
});

test("取消不存在的任务没有副作用，cancelAll 只清空当前设备", async () => {
    const harness = createHarness();
    await initMobileNotificationStore(harness.plugin);
    await cancelMobileNotifications("missing");
    assert.deepEqual(harness.cancelled, []);
    await scheduleMobileNotifications(futureTask("task-a", 10), NOW);
    harness.cancelled.length = 0;
    await cancelAllMobileNotifications();
    assert.deepEqual(harness.cancelled, [1]);
    assert.deepEqual(harness.readStorage(), {});
});

test("默认系统通知开关关闭且非法值被设置校验拒绝", async () => {
    assert.equal(DEFAULT_SETTINGS.reminderSettings.systemNotificationEnabled, false);
    const { validateSettings } = await import("../src/shared/settings.ts");
    assert.equal(
        validateSettings({ reminderSettings: { systemNotificationEnabled: "yes" } as never }),
        "reminderSettings.systemNotificationEnabled must be boolean",
    );
});

test("保存系统通知开关后重建完整集合，关闭后只清理系统通知文件", async () => {
    // Regression: settings changes must update native notifications only after saving.
    const { applyMobileNotificationSettings } = await import("../src/frontend/stores/mobile-notification-store.ts");
    const harness = createHarness();
    await initMobileNotificationStore(harness.plugin);
    const off = DEFAULT_SETTINGS.reminderSettings;
    const on = { ...off, systemNotificationEnabled: true };
    const tasks = [futureTask("task-a", 10), futureTask("task-b", 11)];
    await applyMobileNotificationSettings(off, on, tasks, NOW);
    assert.equal(harness.sent.length, 2);
    taskStore.applySettingsUpdate(DEFAULT_SETTINGS);
    await applyMobileNotificationSettings(on, off, tasks, NOW);
    assert.deepEqual(harness.cancelled, [1, 2]);
    assert.deepEqual(harness.readStorage(), {});
    assert.ok(harness.savedPaths.every((path) => path === "mobile-notifications.json"));
});

test("修改全局提前量重新校准任务集合，无关设置不触碰已注册通知", async () => {
    const { applyMobileNotificationSettings } = await import("../src/frontend/stores/mobile-notification-store.ts");
    const harness = createHarness();
    await initMobileNotificationStore(harness.plugin);
    const on = get(taskStore).settings.reminderSettings;
    await rebuildAllMobileNotifications([futureTask("task-a", 10), futureTask("removed-task", 11)], NOW);
    await applyMobileNotificationSettings(on, { ...on, soundEnabled: false }, [], NOW);
    assert.deepEqual(harness.cancelled, []);
    await applyMobileNotificationSettings(on, { ...on, defaultOffsets: [30] }, [futureTask("task-a", 10)], NOW);
    assert.deepEqual(harness.cancelled, [2]);
    assert.equal(harness.sent.length, 2);
});

test("浏览器保存系统通知设置不影响平台通知或页面内提醒文件", async () => {
    // Regression: browser settings must not invoke the native notification API.
    const { applyMobileNotificationSettings } = await import("../src/frontend/stores/mobile-notification-store.ts");
    for (const frontend of ["browser-desktop", "browser-mobile"] as const) {
        destroyMobileNotificationStore();
        const harness = createHarness(() => frontend);
        await initMobileNotificationStore(harness.plugin);
        await applyMobileNotificationSettings(
            DEFAULT_SETTINGS.reminderSettings,
            get(taskStore).settings.reminderSettings,
            [futureTask("browser-task", 10)],
            NOW,
        );
        assert.deepEqual(harness.sent, []);
        assert.deepEqual(harness.cancelled, []);
        assert.deepEqual(harness.savedPaths, []);
    }
});

test("设置开关与调度共享移动和桌面 App 能力边界", () => {
    for (const frontend of ["mobile", "desktop", "desktop-window"]) {
        assert.equal(supportsSystemNotifications(frontend), true);
    }
    for (const frontend of ["browser-mobile", "browser-desktop", "unknown"]) {
        assert.equal(supportsSystemNotifications(frontend), false);
    }
});

test("初始化加载尚未完成时销毁，不得在返回后重新启用调度", async () => {
    // Regression: disposing the runtime while storage loads must not revive the notification store.
    const harness = createHarness();
    let resolveStorage!: (value: unknown) => void;
    const loading = new Promise<unknown>((resolve) => {
        resolveStorage = resolve;
    });
    const plugin = { ...(harness.plugin as FakePlugin), loadData: () => loading };
    const initializing = initMobileNotificationStore(plugin as never);
    await Promise.resolve();
    destroyMobileNotificationStore();
    resolveStorage({});
    await initializing;
    await scheduleMobileNotifications(futureTask("late-task", 10), NOW);
    assert.deepEqual(harness.sent, []);
    assert.deepEqual(harness.savedPaths, []);
});
