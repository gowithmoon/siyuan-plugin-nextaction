import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

type Result = {
    frontend: string;
    locale: string;
    disabled: boolean;
    label: string;
    description: string;
    saved: boolean;
    sent: number;
    cancelled: number;
    toast: string;
    dismissed: boolean;
    toastAfterRestart: boolean;
    error?: string;
};

// Regression: 浏览器禁用原生通知后仍须能保存设置、显示 Toast 并持久化已读状态。
test("实际设置面板双语开关、保存和 Toast 与原生通知互不干扰", async () => {
    const source = (path: string) => JSON.stringify(resolve(path));
    const results = await runSvelteBrowserTest<Result[]>({
        fixtureName: "system-notification-acceptance",
        realTime: true,
        timeout: 30_000,
        files: {
            "siyuan.js": `
export let frontend = "browser-desktop";
export function setFrontend(value) { frontend = value; }
export function getFrontend() { return frontend; }
export const sent = [];
export const cancelled = [];
export const platformUtils = {
    async sendNotification(options) { sent.push(options); return sent.length; },
    cancelNotification(id) { cancelled.push(id); },
};
export class Dialog {}
export class Menu { addItem() {} addSeparator() {} open() {} }
export function confirm(_title, _message, yes) { yes(); }
export function openTab() {}
export function showMessage() {}
`,
            "main.js": `
import { mount, unmount, tick } from "svelte";
import { get } from "svelte/store";
import { setFrontend, getFrontend, platformUtils, sent, cancelled } from "siyuan";
import SettingsPanel from ${source("src/frontend/components/SettingsPanel.svelte")};
import NotificationHost from ${source("src/frontend/components/NotificationHost.svelte")};
import { taskStore } from ${source("src/frontend/stores/task-store.ts")};
import { DEFAULT_SETTINGS } from ${source("src/shared/settings.ts")};
import { configureMobileNotificationRuntime, initMobileNotificationStore, destroyMobileNotificationStore } from ${source("src/frontend/stores/mobile-notification-store.ts")};
import { initReminderStore, destroyReminderStore, notificationQueue } from ${source("src/frontend/stores/reminder-store.ts")};
import en from ${source("src/i18n/en.json")};
import zh from ${source("src/i18n/zh-CN.json")};

const pause = () => new Promise(resolve => setTimeout(resolve, 0));
async function settled() { await pause(); await tick(); }
async function waitFor(predicate) {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (predicate()) return;
        await settled();
    }
    throw new Error("界面未完成加载或保存");
}
async function run() {
    const results = [];
    for (const frontend of ["browser-desktop", "browser-mobile", "desktop", "desktop-window", "mobile"]) {
        for (const [locale, i18n] of [["en", en], ["zh-CN", zh]]) {
            setFrontend(frontend);
            configureMobileNotificationRuntime({ getFrontend, platformUtils });
            sent.length = 0;
            cancelled.length = 0;
            const supported = !frontend.startsWith("browser");
            let settings = structuredClone(DEFAULT_SETTINGS);
            settings.reminderSettings.soundEnabled = false;
            taskStore.applySettingsUpdate(settings);
            const now = Date.now();
            const tasks = [
                { blockId: "future", title: "未来任务", due: new Date(now + 120_000).toISOString() },
                { blockId: "toast", title: "页面提醒任务", due: new Date(now + 30_000).toISOString() },
            ].map(task => ({ ...task, status: "todo", priority: "medium", taskType: "1", parentId: "", childIds: [],
                reminder: '[{"type":"relative","minutes":1}]', reviewDate: "", start: "" }));
            taskStore.resetSync();
            taskStore.setBridge({ getTaskSnapshotV2: async () => ({ schema: 2, streamId: "test", revision: 0, tasks }) });
            await taskStore.loadTasks();
            const data = {};
            const plugin = {
                i18n,
                async loadData(path) { return structuredClone(data[path] || {}); },
                async saveData(path, value) { data[path] = structuredClone(value); },
            };
            await initMobileNotificationStore(plugin);
            const bridge = {
                async getSettings() { return settings; },
                async updateSettings(value) { settings = value; return value; },
                async getCustomFieldDiagnostics() { return { fields: [] }; },
                async getMcpStatus() { return null; },
                async listMcpTargetNotebooks() { return []; },
            };
            const panel = mount(SettingsPanel, { target: document.getElementById("app"), props: {
                bridge, i18n, onSave(value) { taskStore.applySettingsUpdate(value); }, onClose() {},
            } });
            await settled();
            const input = document.getElementById("setting-reminder-system-notification");
            const result = { frontend, locale, disabled: input.disabled,
                label: document.querySelector('label[for="setting-reminder-system-notification"]').textContent.trim(),
                description: input.closest(".na-setting-row").textContent.trim() };
            input.click();
            if (!supported) document.getElementById("setting-reminder-sound-enabled").click();
            await tick();
            const save = document.querySelector(".na-settings-modern__footer-actions .b3-button--primary");
            await waitFor(() => !save.disabled);
            save.click();
            await waitFor(() => save.disabled && (supported ? sent.length === 1 : settings.reminderSettings.soundEnabled));
            result.saved = settings.reminderSettings.systemNotificationEnabled === supported;
            result.sent = sent.length;
            // 再次保存关闭原生通知；浏览器保留禁用开关，不调平台。
            if (supported) {
                input.click();
                await tick();
                await waitFor(() => !save.disabled);
                save.click();
                await waitFor(() => cancelled.length === 1);
            }
            result.cancelled = cancelled.length;
            // 关闭音效只为了真实浏览器不依赖自动播放许可，音频边界另有行为测试。
            taskStore.applySettingsUpdate({ ...settings, reminderSettings: { ...settings.reminderSettings, soundEnabled: false } });
            const host = mount(NotificationHost, { target: document.getElementById("app"), props: { i18n } });
            await initReminderStore(plugin);
            await tick();
            result.toast = document.querySelector(".na-notification-card__title")?.textContent.trim();
            document.querySelector(".na-notification-host__dismiss-all").click();
            await settled();
            result.dismissed = Object.keys(data["dismissed-reminders.json"] || {}).some(key => key.startsWith("toast|"));
            destroyReminderStore();
            await initReminderStore(plugin);
            result.toastAfterRestart = get(notificationQueue).some(item => item.blockId === "toast");
            destroyReminderStore();
            destroyMobileNotificationStore();
            configureMobileNotificationRuntime(null);
            taskStore.disposeSync();
            await unmount(host);
            await unmount(panel);
            results.push(result);
        }
    }
    window.__NA_BROWSER_RESULT__(results);
}
run().catch(error => window.__NA_BROWSER_RESULT__([{ error: String(error.stack || error) }]));
`,
        },
    });
    assert.equal(results[0]?.error, undefined, results[0]?.error || "浏览器行为执行失败");
    assert.equal(results.length, 10);
    for (const result of results) {
        const supported = !result.frontend.startsWith("browser");
        const zh = result.locale === "zh-CN";
        const context = `${result.frontend}/${result.locale}`;
        assert.equal(result.disabled, !supported, context);
        assert.equal(result.label, zh ? "系统通知" : "System Notifications", context);
        assert.ok(
            result.description.includes(
                supported
                    ? zh
                        ? "在移动 App 和桌面 App 调度原生系统通知"
                        : "Use native OS notifications"
                    : zh
                      ? "当前环境不支持系统通知"
                      : "System notifications are not supported in this environment",
            ),
            context,
        );
        assert.equal(result.saved, true, context);
        assert.equal(result.sent, supported ? 1 : 0, context);
        assert.equal(result.cancelled, supported ? 1 : 0, context);
        assert.equal(result.toast, "页面提醒任务", context);
        assert.equal(result.dismissed, true, context);
        assert.equal(result.toastAfterRestart, false, context);
    }
});
