import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
            reminderSystemNotificationTitleRelative: "NextAction · Task reminder",
            reminderSystemNotificationTitleAbsolute: "NextAction · Scheduled reminder",
            reminderSystemNotificationTitleReview: "NextAction · Review",
            reminderSystemNotificationBodyRelative: "{task}\nDue in {offset} · {dateTime}",
            reminderSystemNotificationBodyAbsolute: "{task}\nScheduled for {dateTime}",
            reminderSystemNotificationBodyReview: "{task}\nReview today",
            reminderSystemNotificationDateTime: "{month}/{day} {time}",
            reminderOffsetMinutes: "minutes",
            reminderOffsetHours: "hours",
            reminderOffsetDays: "days",
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
    assert.equal(harness.sent[0].options.title, "NextAction · Scheduled reminder");
    assert.equal(harness.sent[0].options.body, "Task\nScheduled for 1/1 10:00");
    assert.deepEqual(harness.readStorage(), { "device-a": { "task-a": [1] } });
});

// Regression: 提前提醒正文曾把触发时刻写成到期时刻，中英文均应展示真实截止时间。
test("双语正文区分提前提醒的截止时间、绝对提醒和回顾", async (context) => {
    context.mock.timers.enable({ apis: ["Date"], now: NOW });
    for (const [locale, expected] of [
        [
            "en",
            [
                "Task\nDue in 1 hour · 1/1 10:00",
                "Task\nDue in 1 hour · 1/1 23:59",
                "Task\nScheduled for 1/1 11:00",
                "Task\nReview today",
            ],
        ],
        [
            "zh-CN",
            [
                "Task\n1小时后到期 · 1月1日 10:00",
                "Task\n1小时后到期 · 1月1日 23:59",
                "Task\n已到设定的提醒时间 · 1月1日 11:00",
                "Task\n今天需要回顾",
            ],
        ],
    ] as const) {
        destroyMobileNotificationStore();
        const h = createHarness(() => "desktop");
        const plugin: FakePlugin = h.plugin;
        plugin.i18n = JSON.parse(readFileSync(new URL(`../src/i18n/${locale}.json`, import.meta.url), "utf8"));
        await initMobileNotificationStore(h.plugin);
        await rebuildAllMobileNotifications(
            [
                taskFactory("due", { due: "2030-01-01T10:00", reminder: '[{"type":"relative","minutes":60}]' }),
                taskFactory("date", { due: "2030-01-01", reminder: '[{"type":"relative","minutes":60}]' }),
                futureTask("absolute", 11),
                taskFactory("review", { reviewDate: "2030-01-01" }),
            ],
            NOW,
        );
        assert.deepEqual(
            h.sent.map(({ options }) => options.body),
            expected,
            locale,
        );
        assert.deepEqual(
            h.sent.map(({ options }) => options.title),
            locale === "en"
                ? [
                      "NextAction · Task reminder",
                      "NextAction · Task reminder",
                      "NextAction · Scheduled reminder",
                      "NextAction · Review",
                  ]
                : ["NextAction · 任务提醒", "NextAction · 任务提醒", "NextAction · 定时提醒", "NextAction · 回顾提醒"],
            locale,
        );
        assert.deepEqual(
            h.sent.map(({ options }) => options.delayInSeconds),
            [3600, 53999, 10800, 3600],
        );
    }
});

test("提前量正文使用可读的天、小时和复合时长", async (context) => {
    context.mock.timers.enable({ apis: ["Date"], now: NOW });
    const h = createHarness(() => "desktop");
    const plugin = h.plugin as FakePlugin;
    plugin.i18n = JSON.parse(readFileSync(new URL("../src/i18n/en.json", import.meta.url), "utf8"));
    await initMobileNotificationStore(h.plugin);
    await rebuildAllMobileNotifications(
        [
            taskFactory("days", { due: "2030-01-04T10:00", reminder: '[{"type":"relative","minutes":4320}]' }),
            taskFactory("hours", { due: "2030-01-01T20:30", reminder: '[{"type":"relative","minutes":720}]' }),
            taskFactory("mixed", { due: "2030-01-01T10:30", reminder: '[{"type":"relative","minutes":90}]' }),
        ],
        NOW,
    );
    assert.deepEqual(
        h.sent.map(({ options }) => options.body),
        [
            "Task\nDue in 3 days · 1/4 10:00",
            "Task\nDue in 12 hours · 1/1 20:30",
            "Task\nDue in 1 hour 30 minutes · 1/1 10:30",
        ],
    );
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

test("全局默认提醒开关变化时重建移动端任务通知", async () => {
    const { applyMobileNotificationSettings } = await import("../src/frontend/stores/mobile-notification-store.ts");
    const harness = createHarness();
    await initMobileNotificationStore(harness.plugin);
    const off = { ...get(taskStore).settings.reminderSettings, useGlobalDefaultReminders: false };
    const on = { ...off, useGlobalDefaultReminders: true };
    const task = taskFactory("inherited-mobile", { due: "2030-01-03T12:00", reminder: "" });

    await applyMobileNotificationSettings(off, on, [task], NOW);
    assert.ok(harness.sent.some(({ options }) => String(options.body).includes("Due in 1 hour")));
    await applyMobileNotificationSettings(on, off, [task], NOW);
    assert.ok(harness.cancelled.length > 0);
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

// Regression: 批量任务增量必须独立取消、更新和新增，通知异常不能阻断其他任务。
test("批量 delta 更新到期、标题、完成和删除，并隔离平台异常", async () => {
    const { onTasksChangedV2 } = await import("../src/frontend/stores/mobile-notification-store.ts");
    const harness = createHarness();
    await initMobileNotificationStore(harness.plugin);
    const due = taskFactory("due", { due: "2030-01-01T11:00", reminder: '[{"type":"relative","minutes":60}]' });
    const original = [
        due,
        futureTask("title", 10),
        futureTask("done", 10),
        futureTask("deleted", 10),
        futureTask("same", 10),
    ];
    await rebuildAllMobileNotifications(original, NOW);
    harness.sent.length = 0;
    await onTasksChangedV2(
        {
            upserts: [
                { ...due, due: "2030-01-01T12:00" },
                { ...original[1], title: "新标题" },
                { ...original[2], status: "done" },
                { ...original[4], priority: "high" },
                futureTask("new", 11),
            ],
            deletedBlockIds: ["deleted", "unknown"],
        },
        new Map(original.map((task) => [task.blockId, task])),
        NOW,
    );
    assert.deepEqual(harness.cancelled.sort(), [1, 2, 3, 4]);
    assert.equal(harness.sent.length, 3);
    assert.ok(harness.sent.some((item) => String(item.options.body).startsWith("新标题\n")));
    assert.deepEqual(Object.keys((harness.readStorage() as Record<string, object>)["device-a"]).sort(), [
        "due",
        "new",
        "same",
        "title",
    ]);
});

// Regression: 卸载期间尚未完成的原生发送不得复活，排队任务不得继续注册。
test("销毁阻止在途及排队任务写回，并取消迟到的通知 ID", async () => {
    const harness = createHarness();
    let resolveSend!: (id: number) => void;
    let started!: () => void;
    const sending = new Promise<void>((resolve) => {
        started = resolve;
    });
    let calls = 0;
    configureMobileNotificationRuntime({
        getFrontend: () => "mobile",
        platformUtils: {
            sendNotification() {
                calls++;
                started();
                return new Promise<number>((resolve) => {
                    resolveSend = resolve;
                });
            },
            cancelNotification(id) {
                harness.cancelled.push(id);
            },
        },
    });
    await initMobileNotificationStore(harness.plugin);
    const first = scheduleMobileNotifications(futureTask("in-flight", 10), NOW);
    const queued = scheduleMobileNotifications(futureTask("queued", 11), NOW);
    await sending;
    const saves = harness.savedPaths.length;
    destroyMobileNotificationStore();
    resolveSend(99);
    await Promise.all([first, queued]);
    assert.equal(calls, 1);
    assert.deepEqual(harness.cancelled, [99]);
    assert.equal(harness.savedPaths.length, saves);
});

// Regression: 同步快照只修改标题时，时间 diff 不能留下旧标题。
test("全量校准更新同一触发时间的标题并保持后续幂等", async () => {
    const h = createHarness();
    await initMobileNotificationStore(h.plugin);
    const original = futureTask("title-sync", 10);
    await rebuildAllMobileNotifications([original], NOW);
    await rebuildAllMobileNotifications([{ ...original, title: "同步后的标题" }], NOW);
    assert.deepEqual(h.cancelled, [1]);
    assert.equal(h.sent[1]?.options.title, "NextAction · Scheduled reminder");
    assert.match(String(h.sent[1]?.options.body), /^同步后的标题\n/);
    await rebuildAllMobileNotifications([{ ...original, title: "同步后的标题" }], NOW);
    assert.equal(h.sent.length, 2);
});

// Regression: 单个通知 API 失败不能阻止批次内其他任务完成清理和注册。
test("批量发送与取消 API 异常隔离，Someday 和空计划清理旧通知", async () => {
    const { onTasksChangedV2 } = await import("../src/frontend/stores/mobile-notification-store.ts");
    const h = createHarness();
    await initMobileNotificationStore(h.plugin);
    const original = [futureTask("someday", 10), futureTask("empty", 10)];
    await rebuildAllMobileNotifications(original, NOW);
    configureMobileNotificationRuntime({
        getFrontend: () => "mobile",
        platformUtils: {
            async sendNotification(options) {
                if (String(options.body).startsWith("失败\n")) throw new Error("原生发送失败");
                h.sent.push({ id: 9, options });
                return 9;
            },
            cancelNotification(id) {
                h.cancelled.push(id);
                if (id === 1) throw new Error("失效 ID");
            },
        },
    });
    await onTasksChangedV2(
        {
            upserts: [
                { ...original[0], status: "someday" },
                { ...original[1], reminder: "[]" },
                { ...futureTask("failed", 11), title: "失败" },
                futureTask("success", 11),
            ],
            deletedBlockIds: [],
        },
        new Map(original.map((task) => [task.blockId, task])),
        NOW,
    );
    assert.deepEqual(h.cancelled, [1, 2]);
    assert.deepEqual(h.readStorage(), { "device-a": { success: [9] } });
    await onTasksChangedV2(
        { upserts: [original[0]], deletedBlockIds: [] },
        new Map([["someday", { ...original[0], status: "someday" }]]),
        NOW,
    );
    assert.equal(h.sent.length, 4);
});

// Regression: 浏览器增量包含完成和删除时，也不能调用原生平台 API。
test("浏览器批量增量没有平台调用", async () => {
    const { onTasksChangedV2 } = await import("../src/frontend/stores/mobile-notification-store.ts");
    for (const frontend of ["browser-desktop", "browser-mobile"] as const) {
        destroyMobileNotificationStore();
        const h = createHarness(() => frontend);
        h.setStorage({ "device-a": { old: [42] } });
        await initMobileNotificationStore(h.plugin);
        await onTasksChangedV2(
            {
                upserts: [futureTask("new", 10), { ...futureTask("old", 10), status: "done" }],
                deletedBlockIds: ["old"],
            },
            new Map(),
            NOW,
        );
        assert.deepEqual(h.sent, []);
        assert.deepEqual(h.cancelled, []);
    }
});

// Regression: 重启时失效 ID 的取消异常不能阻断新计划，重复初始化不能重复取消。
test("重启取消失败仍重建，重复初始化保持幂等且保留其他设备", async () => {
    const h = createHarness();
    h.setStorage({ "device-a": { old: [41, 42] }, "device-b": { remote: [88] } });
    const operations: string[] = [];
    configureMobileNotificationRuntime({
        getFrontend: () => "mobile",
        platformUtils: {
            async sendNotification() {
                operations.push("send");
                return 99;
            },
            cancelNotification(id) {
                operations.push(`cancel:${id}`);
                if (id === 41) throw new Error("旧 ID 已失效");
            },
        },
    });
    await initMobileNotificationStore(h.plugin);
    await rebuildAllMobileNotifications([futureTask("current", 10)], NOW);
    await initMobileNotificationStore(h.plugin);
    await rebuildAllMobileNotifications([futureTask("current", 10)], NOW);
    assert.deepEqual(operations, ["cancel:41", "cancel:42", "send"]);
    assert.deepEqual(h.readStorage(), { "device-a": { current: [99] }, "device-b": { remote: [88] } });
});
