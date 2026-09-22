import test from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import type { Plugin } from "siyuan";
import type { KernelBridge } from "../src/frontend/kernel-bridge.ts";
import { DEFAULT_SETTINGS } from "../src/shared/settings.ts";
import { taskFactory } from "./helpers/fakes.ts";
import { taskStore, pendingReminderCount } from "../src/frontend/stores/task-store.ts";
import {
    buildDedupKey,
    destroyReminderStore,
    dismissReminder,
    initReminderStore,
    notificationQueue,
    visibleNotifications,
} from "../src/frontend/stores/reminder-store.ts";
import {
    configureMobileNotificationRuntime,
    destroyMobileNotificationStore,
    initMobileNotificationStore,
    rebuildAllMobileNotifications,
} from "../src/frontend/stores/mobile-notification-store.ts";

// Regression: 原生提前注册不能干扰 30 秒 Toast 扫描、音效选择和已读去重。
test("原生通知共存时扫描仍每 30 秒入队，播放对应音效且重启不重复已读提醒", async (context) => {
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
    const data: Record<string, unknown> = {};
    const plugin = {
        i18n: {
            reminderSystemNotificationTitleRelative: "NextAction · 任务提醒",
            reminderSystemNotificationTitleAbsolute: "NextAction · 定时提醒",
            reminderSystemNotificationTitleReview: "NextAction · 回顾提醒",
            reminderSystemNotificationBodyRelative: "{task}\n{offset}后到期 · {dateTime}",
            reminderSystemNotificationBodyAbsolute: "{task}\n已到设定的提醒时间 · {dateTime}",
            reminderSystemNotificationBodyReview: "{task}\n今天需要回顾",
            reminderSystemNotificationDateTime: "{month}月{day}日 {time}",
            reminderOffsetMinutes: "分钟",
            reminderOffsetHours: "小时",
            reminderOffsetDays: "天",
        },
        async loadData(path: string) {
            return structuredClone(data[path] || {});
        },
        async saveData(path: string, value: unknown) {
            data[path] = structuredClone(value);
        },
    } as unknown as Plugin;
    const tasks = [
        taskFactory("absolute", { status: "inbox", reminder: '[{"type":"absolute","time":"2030-01-01T08:58"}]' }),
        taskFactory("review", { status: "inbox", reviewDate: "2030-01-01" }),
    ];
    let nativeSends = 0;
    configureMobileNotificationRuntime({
        getFrontend: () => "desktop",
        platformUtils: {
            async sendNotification() {
                return ++nativeSends;
            },
            cancelNotification() {},
        },
    });
    try {
        taskStore.resetSync();
        taskStore.applySettingsUpdate({
            ...DEFAULT_SETTINGS,
            reminderSettings: { ...DEFAULT_SETTINGS.reminderSettings, systemNotificationEnabled: true },
        });
        taskStore.setBridge({
            getTaskSnapshotV2: async () => ({ schema: 2, streamId: "reminders", revision: 0, tasks }),
        } as unknown as KernelBridge);
        await taskStore.loadTasks();
        await initMobileNotificationStore(plugin);
        await rebuildAllMobileNotifications(tasks);
        assert.equal(nativeSends, 2);
        await initReminderStore(plugin);
        assert.deepEqual(get(notificationQueue), []);
        context.mock.timers.tick(29_999);
        assert.deepEqual(get(notificationQueue), []);
        context.mock.timers.tick(1);
        assert.deepEqual(
            get(visibleNotifications).map((item) => item.blockId),
            ["absolute"],
        );
        assert.equal(get(pendingReminderCount), 1);
        assert.equal(played.length, 1);
        assert.ok(played[0].endsWith("/chime.wav"));
        const item = get(notificationQueue)[0];
        const key = buildDedupKey(item.blockId, item.baseDateStr, item.minutesBefore, item.type);
        dismissReminder(key);
        assert.equal(get(pendingReminderCount), 0);
        assert.ok((data["dismissed-reminders.json"] as Record<string, number>)[key]);
        context.mock.timers.tick(120_000);
        assert.deepEqual(
            get(notificationQueue).map((entry) => entry.blockId),
            ["review"],
        );
        assert.equal(played.length, 2);
        assert.ok(played[1].endsWith("/soft.wav"));
        assert.equal(nativeSends, 2, "轮询不能再次注册原生通知");
        destroyReminderStore();
        await initReminderStore(plugin);
        assert.deepEqual(
            get(notificationQueue).map((entry) => entry.blockId),
            ["review"],
        );
        const count = played.length;
        destroyReminderStore();
        context.mock.timers.tick(30_000);
        assert.equal(played.length, count, "销毁必须停止扫描");
        assert.deepEqual(get(notificationQueue), []);
    } finally {
        destroyReminderStore();
        destroyMobileNotificationStore();
        configureMobileNotificationRuntime(null);
        taskStore.disposeSync();
        taskStore.applySettingsUpdate(DEFAULT_SETTINGS);
        if (originalAudio) Object.defineProperty(globalThis, "Audio", originalAudio);
        else Reflect.deleteProperty(globalThis, "Audio");
    }
});
