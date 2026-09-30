import test from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import type { Plugin } from "siyuan";
import { DEFAULT_SETTINGS } from "../src/shared/settings.ts";
import { taskFactory } from "./helpers/fakes.ts";
import { taskStore, pendingReminderCount } from "../src/frontend/stores/task-store.ts";
import {
    buildDedupKey,
    destroyReminderStore,
    dismissAllReminders,
    dismissReminder,
    initReminderStore,
    notificationQueue,
    rebuildReminderQueue,
    visibleNotifications,
} from "../src/frontend/stores/reminder-store.ts";

test("应用内模式投递卡片，关闭仅处理当前卡片且切换方式清空队列", (context) => {
    context.mock.timers.enable({ apis: ["Date"], now: new Date(2030, 0, 1, 8, 57).getTime() });
    const task = taskFactory("inherited-desktop", { due: "2030-01-02T09:30", reminder: "" });
    const secondTask = taskFactory("inherited-desktop-switch", { due: "2030-01-02T09:30", reminder: "" });
    taskStore.applySettingsUpdate({
        ...DEFAULT_SETTINGS,
        reminderSettings: {
            ...DEFAULT_SETTINGS.reminderSettings,
            deliveryMode: "in-app",
            soundEnabled: false,
            defaultOffsets: [1500],
            useGlobalDefaultReminders: true,
        },
    });
    taskStore.applyUpdate(task);
    taskStore.applyUpdate(secondTask);
    rebuildReminderQueue();
    // Settings/task changes are not a recovery boundary: an already missed
    // trigger is not retroactively delivered.
    assert.equal(
        get(notificationQueue).some((entry) => entry.blockId === task.blockId),
        false,
    );
    // Regression: 应用内提醒曾额外生成与具体提醒事件无关的任务概览卡片。
    assert.equal(
        get(notificationQueue).some((entry) => String(entry.type) === "summary"),
        false,
    );
    const key = buildDedupKey(task.blockId, "2030-01-02", 1500, "due");
    dismissReminder(key);
    assert.equal(
        get(notificationQueue).some((entry) => entry.blockId === task.blockId),
        false,
    );
    assert.equal(
        get(notificationQueue).some((entry) => entry.blockId === secondTask.blockId),
        false,
    );
    taskStore.applySettingsUpdate({
        ...DEFAULT_SETTINGS,
        reminderSettings: {
            ...DEFAULT_SETTINGS.reminderSettings,
            deliveryMode: "system",
            soundEnabled: false,
            defaultOffsets: [1500],
            useGlobalDefaultReminders: true,
        },
    });
    rebuildReminderQueue();
    assert.deepEqual(get(notificationQueue), []);
    taskStore.applySettingsUpdate({
        ...DEFAULT_SETTINGS,
        reminderSettings: {
            ...DEFAULT_SETTINGS.reminderSettings,
            deliveryMode: "in-app",
            soundEnabled: false,
            defaultOffsets: [1500],
            useGlobalDefaultReminders: true,
        },
    });
    rebuildReminderQueue();
    assert.deepEqual(get(notificationQueue), []);
    taskStore.applyRemove(task.blockId);
    taskStore.applyRemove(secondTask.blockId);
    notificationQueue.set([]);
    taskStore.applySettingsUpdate(DEFAULT_SETTINGS);
});

// Regression: 系统通知模式曾同时运行应用内扫描，产生重复且来源不明的提醒。
test("系统通知和不提醒模式不进入应用内队列，也不播放插件音效", async (context) => {
    const now = new Date(2030, 0, 1, 8, 57, 45).getTime();
    context.mock.timers.enable({ apis: ["Date", "setInterval"], now });
    const played: string[] = [];
    class FakeAudio {
        currentTime = 0;
        constructor(readonly url: string) {}
        async play() {
            played.push(this.url);
        }
    }
    const originalAudio = Object.getOwnPropertyDescriptor(globalThis, "Audio");
    Object.defineProperty(globalThis, "Audio", { configurable: true, value: FakeAudio });
    const plugin = {
        i18n: {},
        async loadData() {
            return {};
        },
        async saveData() {},
    } as unknown as Plugin;
    const tasks = [
        taskFactory("absolute", { status: "inbox", reminder: '[{"type":"absolute","time":"2030-01-01T08:58"}]' }),
        taskFactory("review", { status: "inbox", reviewDate: "2030-01-01" }),
        taskFactory("inherited", { status: "inbox", due: "2030-01-01T10:00", reminder: "" }),
    ];
    try {
        taskStore.resetSync();
        taskStore.applySettingsUpdate({
            ...DEFAULT_SETTINGS,
            reminderSettings: {
                ...DEFAULT_SETTINGS.reminderSettings,
                deliveryMode: "system",
                defaultOffsets: [120],
                useGlobalDefaultReminders: true,
            },
        });
        for (const task of tasks) taskStore.applyUpdate(task);
        await initReminderStore(plugin);
        assert.deepEqual(get(notificationQueue), []);
        context.mock.timers.tick(150_000);
        assert.deepEqual(get(notificationQueue), []);
        assert.deepEqual(get(visibleNotifications), []);
        assert.equal(get(pendingReminderCount), 0);
        assert.equal(played.length, 0);

        taskStore.applySettingsUpdate({
            ...DEFAULT_SETTINGS,
            reminderSettings: { ...DEFAULT_SETTINGS.reminderSettings, deliveryMode: "none" },
        });
        rebuildReminderQueue();
        assert.deepEqual(get(notificationQueue), []);
        assert.equal(played.length, 0);
    } finally {
        destroyReminderStore();
        for (const task of tasks) taskStore.applyRemove(task.blockId);
        taskStore.disposeSync();
        taskStore.applySettingsUpdate(DEFAULT_SETTINGS);
        if (originalAudio) Object.defineProperty(globalThis, "Audio", originalAudio);
        else Reflect.deleteProperty(globalThis, "Audio");
    }
});

test("应用内卡片按现有设置播放音效，关闭不写入提醒历史", async (context) => {
    const now = new Date(2030, 0, 1, 8, 57, 45).getTime();
    context.mock.timers.enable({ apis: ["Date", "setInterval"], now });
    const played: string[] = [];
    class FakeAudio {
        currentTime = 0;
        constructor(readonly url: string) {}
        async play() {
            played.push(this.url);
        }
    }
    const originalAudio = Object.getOwnPropertyDescriptor(globalThis, "Audio");
    Object.defineProperty(globalThis, "Audio", { configurable: true, value: FakeAudio });
    let saveCalls = 0;
    const plugin = {
        i18n: {},
        async loadData() {
            return {};
        },
        async saveData() {
            saveCalls++;
        },
    } as unknown as Plugin;
    const task = taskFactory("in-app-sound", {
        status: "inbox",
        reminder: '[{"type":"absolute","time":"2030-01-01T08:58"}]',
    });
    try {
        taskStore.applySettingsUpdate({
            ...DEFAULT_SETTINGS,
            reminderSettings: {
                ...DEFAULT_SETTINGS.reminderSettings,
                deliveryMode: "in-app",
                soundEnabled: true,
                dueSound: "chime",
            },
        });
        taskStore.applyUpdate(task);
        await initReminderStore(plugin);
        assert.deepEqual(get(notificationQueue), []);

        context.mock.timers.tick(30_000);

        assert.equal(get(notificationQueue)[0]?.blockId, task.blockId);
        assert.equal(played.length, 1);
        assert.ok(played[0].endsWith("/chime.wav"));
        const item = get(notificationQueue)[0];
        dismissReminder(buildDedupKey(item.blockId, item.baseDateStr, item.minutesBefore, item.type));
        assert.deepEqual(get(notificationQueue), []);
        assert.ok(saveCalls > 0);
    } finally {
        destroyReminderStore();
        taskStore.applyRemove(task.blockId);
        taskStore.applySettingsUpdate(DEFAULT_SETTINGS);
        if (originalAudio) Object.defineProperty(globalThis, "Audio", originalAudio);
        else Reflect.deleteProperty(globalThis, "Audio");
    }
});

// Regression: 只有上次运行已经保存过的提醒计划才允许在启动时补发；
// 启动后新建任务或保存设置形成的过去触发点不补发。
test("启动恢复补发旧计划，设置和任务变更不补发", async (context) => {
    const now = new Date(2030, 0, 1, 10, 30).getTime();
    context.mock.timers.enable({ apis: ["Date", "setInterval"], now });
    const task = taskFactory("recover-in-app", {
        due: "2030-01-01T11:00",
        reminder: '[{"type":"relative","minutes":120}]',
    });
    const plugin = {
        i18n: {},
        async loadData() {
            return {
                mode: "in-app",
                updatedAtMs: new Date(2030, 0, 1, 8).getTime(),
                events: [
                    {
                        blockId: task.blockId,
                        title: task.title,
                        triggerTime: new Date(2030, 0, 1, 9).getTime(),
                        type: "due",
                        minutesBefore: 120,
                        baseDateStr: "2030-01-01",
                        dueTime: new Date(2030, 0, 1, 11).getTime(),
                    },
                ],
            };
        },
        async saveData() {},
    } as unknown as Plugin;
    try {
        taskStore.applySettingsUpdate({
            ...DEFAULT_SETTINGS,
            reminderSettings: { ...DEFAULT_SETTINGS.reminderSettings, deliveryMode: "in-app", soundEnabled: false },
        });
        taskStore.applyUpdate(task);
        await initReminderStore(plugin);
        assert.deepEqual(
            get(notificationQueue).map((entry) => entry.blockId),
            [task.blockId],
        );

        dismissAllReminders();
        taskStore.applyUpdate({
            ...task,
            blockId: "new-past-task",
            reminder: '[{"type":"absolute","time":"2030-01-01T09:30"}]',
        });
        rebuildReminderQueue();
        assert.deepEqual(get(notificationQueue), []);
    } finally {
        destroyReminderStore();
        taskStore.applyRemove(task.blockId);
        taskStore.applyRemove("new-past-task");
        taskStore.applySettingsUpdate(DEFAULT_SETTINGS);
    }
});

// Regression: 停止期间编辑任务标题后，应用内旧计划不得在恢复时补发。
test("应用内恢复跳过标题已变化的旧计划", async (context) => {
    const now = new Date(2030, 0, 1, 10, 30).getTime();
    context.mock.timers.enable({ apis: ["Date", "setInterval"], now });
    const task = taskFactory("edited-in-app", {
        title: "新标题",
        due: "2030-01-01T11:00",
        reminder: '[{"type":"relative","minutes":120}]',
    });
    const plugin = {
        i18n: {},
        async loadData() {
            return {
                mode: "in-app",
                updatedAtMs: new Date(2030, 0, 1, 8).getTime(),
                events: [
                    {
                        blockId: task.blockId,
                        title: "旧标题",
                        triggerTime: new Date(2030, 0, 1, 9).getTime(),
                        type: "due",
                        minutesBefore: 120,
                        baseDateStr: "2030-01-01",
                        dueTime: new Date(2030, 0, 1, 11).getTime(),
                    },
                ],
            };
        },
        async saveData() {},
    } as unknown as Plugin;
    try {
        taskStore.applySettingsUpdate({
            ...DEFAULT_SETTINGS,
            reminderSettings: { ...DEFAULT_SETTINGS.reminderSettings, deliveryMode: "in-app", soundEnabled: false },
        });
        taskStore.applyUpdate(task);
        await initReminderStore(plugin);
        assert.deepEqual(get(notificationQueue), []);
    } finally {
        destroyReminderStore();
        taskStore.applyRemove(task.blockId);
        taskStore.applySettingsUpdate(DEFAULT_SETTINGS);
    }
});
