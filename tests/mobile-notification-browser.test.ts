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
    error?: string;
};

// Regression: 系统通知曾作为独立开关与应用内提醒同时开启。
test("实际设置面板以双语三选一设置驱动现有系统通知调度", async () => {
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
import { setFrontend, getFrontend, platformUtils, sent, cancelled } from "siyuan";
import SettingsPanel from ${source("src/frontend/components/SettingsPanel.svelte")};
import { taskStore } from ${source("src/frontend/stores/task-store.ts")};
import { DEFAULT_SETTINGS } from ${source("src/shared/settings.ts")};
import { configureMobileNotificationRuntime, initMobileNotificationStore, destroyMobileNotificationStore } from ${source("src/frontend/stores/mobile-notification-store.ts")};
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
            const plugin = {
                i18n,
                async loadData() { return {}; },
                async saveData() {},
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
            const input = document.getElementById("setting-reminder-delivery-mode");
            const result = { frontend, locale, disabled: input.disabled,
                label: document.querySelector('label[for="setting-reminder-delivery-mode"]').textContent.trim(),
                description: input.closest(".na-setting-row").textContent.trim() };
            input.value = "system";
            input.dispatchEvent(new Event("change", { bubbles: true }));
            await tick();
            const save = document.querySelector(".na-settings-modern__footer-actions .b3-button--primary");
            await waitFor(() => !save.disabled);
            save.click();
            await waitFor(() => save.disabled && (!supported || sent.length === 1));
            result.saved = settings.reminderSettings.deliveryMode === "system"
                && settings.reminderSettings.enabled === false
                && settings.reminderSettings.systemNotificationEnabled === true;
            result.sent = sent.length;
            input.value = "in-app";
            input.dispatchEvent(new Event("change", { bubbles: true }));
            await tick();
            await waitFor(() => !save.disabled);
            save.click();
            await waitFor(() => save.disabled && (!supported || cancelled.length === 1));
            result.cancelled = cancelled.length;
            destroyMobileNotificationStore();
            configureMobileNotificationRuntime(null);
            taskStore.disposeSync();
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
        assert.equal(result.disabled, false, context);
        assert.equal(result.label, zh ? "提醒方式" : "Reminder method", context);
        assert.ok(
            result.description.includes(zh ? "选择所有提醒的显示方式" : "Choose where all reminders appear"),
            context,
        );
        assert.equal(result.saved, true, context);
        assert.equal(result.sent, supported ? 1 : 0, context);
        assert.equal(result.cancelled, supported ? 1 : 0, context);
    }
});
