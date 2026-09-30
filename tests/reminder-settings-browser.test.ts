import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

type ReminderSettingsResult = {
    options?: string[];
    initial?: string;
    soundSettingsVisibleInitially?: boolean;
    soundSettingsHiddenForSystem?: boolean;
    reloaded?: string;
    soundSettingsHiddenForNone?: boolean;
    soundSettingsRestoredForInApp?: boolean;
    hiddenWhenNone?: boolean;
    restoredLabel?: string;
    preservedReminder?: string;
    error?: string;
};

test("提醒方式三选一可保存，并按不提醒模式隐藏任务提醒设置", async () => {
    // Regression: 两个独立开关让用户无法判断提醒最终会从哪个通道出现。
    const source = (path: string) => JSON.stringify(resolve(path));
    const result = await runSvelteBrowserTest<ReminderSettingsResult>({
        fixtureName: "reminder-delivery-mode",
        files: {
            "siyuan.js": `
export function getFrontend() { return "desktop"; }
export class Dialog {}
export class Menu { addItem() {} addSeparator() {} open() {} }
export function confirm(_title, _message, yes) { yes(); }
export function openTab() {}
export function showMessage() {}
export const platformUtils = { async sendNotification() { return 1; }, cancelNotification() {} };
`,
            "main.js": `
import { mount, unmount, tick } from "svelte";
import SettingsPanel from ${source("src/frontend/components/SettingsPanel.svelte")};
import TaskDetail from ${source("src/frontend/components/TaskDetail.svelte")};
import { taskStore } from ${source("src/frontend/stores/task-store.ts")};
import { configureMobileNotificationRuntime } from ${source("src/frontend/stores/mobile-notification-store.ts")};
import { DEFAULT_SETTINGS } from ${source("src/shared/settings.ts")};
import en from ${source("src/i18n/en.json")};

const target = document.getElementById("app");
configureMobileNotificationRuntime({
    getFrontend: () => "desktop",
    platformUtils: { async sendNotification() { return 1; }, cancelNotification() {} },
});
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
async function settled() { await pause(); await tick(); }
async function waitFor(predicate, label) {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (predicate()) return;
        await settled();
    }
    throw new Error("UI did not settle: " + label);
}
let settings = structuredClone(DEFAULT_SETTINGS);
const bridge = {
    async getSettings() { return structuredClone(settings); },
    async updateSettings(value) { settings = structuredClone(value); return structuredClone(value); },
    async getCustomFieldDiagnostics() { return { fields: [] }; },
    async getMcpStatus() { return null; },
    async listMcpTargetNotebooks() { return []; },
};
const panelProps = { bridge, i18n: en, onSave(value) { taskStore.applySettingsUpdate(value); }, onClose() {} };
const deliverySelect = () => document.getElementById("setting-reminder-delivery-mode");
const soundSettingsVisible = () =>
    [
        "setting-reminder-due-sound",
        "setting-reminder-review-sound",
        "setting-reminder-sound-enabled",
    ].every((id) => document.getElementById(id) !== null);
const selected = () => deliverySelect()?.selectedOptions[0]?.textContent.trim();
const choose = (value) => {
    const select = deliverySelect();
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
};
const save = async () => {
    const button = document.querySelector(".na-settings-modern__footer-actions .b3-button--primary");
    await waitFor(() => !button.disabled, "save enabled");
    button.click();
    await waitFor(() => button.disabled, "save completed");
};

async function run() {
    let panel = mount(SettingsPanel, { target, props: panelProps });
    await waitFor(() => deliverySelect(), "selector visible");
    await settled();
    const options = [...deliverySelect().options].map((option) => option.textContent.trim());
    const initial = selected();
    const soundSettingsVisibleInitially = soundSettingsVisible();
    choose("system");
    await waitFor(
        () => selected() === "System notifications",
        "selection changed from " + selected(),
    );
    await settled();
    const soundSettingsHiddenForSystem = !soundSettingsVisible();
    await save();
    await unmount(panel);
    target.replaceChildren();

    panel = mount(SettingsPanel, { target, props: panelProps });
    await waitFor(() => selected() === "System notifications", "saved selection reloaded");
    const reloaded = selected();
    choose("in-app");
    await waitFor(() => selected() === "In-app reminders", "in-app selected");
    await settled();
    const soundSettingsRestoredForInApp = soundSettingsVisible();
    choose("none");
    await waitFor(() => selected() === "No reminders", "none selected");
    await settled();
    const soundSettingsHiddenForNone = !soundSettingsVisible();
    await save();
    await unmount(panel);
    target.replaceChildren();

    const task = {
    blockId: "20260901090000-remindr", identificationSource: "native", contentBlockId: "20260901090000-remindr",
    attrHostId: "20260901090000-remindr", parentId: "", status: "todo", priority: "none",
    importance: 4, effort: 4, due: "2026-10-01", start: "", context: "", taskType: "1", order: 0, childIds: [],
    title: "Reminder visibility", depends: "", depMode: "all", sequential: false, repeat: "", repeatState: "",
    sort: 0, completed: "", note: "", outcome: "", dod: "", actionKind: "action", created: "",
    tags: "", blocked: false, blockedReason: "", reviewInterval: 0, reviewDate: "",
    reminder: '[{"type":"relative","minutes":30}]', customFields: {},
    };
    taskStore.applySettingsUpdate(settings);
    const taskBridge = { getTask: async () => task, updateTask: async () => task, removeTask: async () => {} };
    const detail = mount(TaskDetail, { target, props: { task, bridge: taskBridge, i18n: en, showJumpToBlock: false } });
    await settled();
    const reminderRow = () => document.querySelector('[role="group"][aria-label="Reminders"]');
    const hiddenWhenNone = reminderRow() === null;
    settings = { ...settings, reminderSettings: { ...settings.reminderSettings, deliveryMode: "in-app" } };
    taskStore.applySettingsUpdate(settings);
    await settled();
    const restoredLabel = reminderRow()?.querySelector(".na-task-detail__setting-action")?.textContent.trim();
    await unmount(detail);

    window.__NA_BROWSER_RESULT__({
        options, initial, soundSettingsVisibleInitially, soundSettingsHiddenForSystem,
        reloaded, soundSettingsHiddenForNone, soundSettingsRestoredForInApp,
        hiddenWhenNone, restoredLabel,
        preservedReminder: task.reminder,
    });
}
run().catch((error) => window.__NA_BROWSER_RESULT__({ error: String(error?.stack || error) }));
`,
        },
    });

    assert.equal(result.error, undefined, result.error || "浏览器行为执行失败");
    assert.deepEqual(result.options, ["In-app reminders", "System notifications", "No reminders"]);
    assert.equal(result.initial, "In-app reminders");
    assert.equal(result.soundSettingsVisibleInitially, true);
    assert.equal(result.soundSettingsHiddenForSystem, true);
    assert.equal(result.reloaded, "System notifications");
    assert.equal(result.soundSettingsHiddenForNone, true);
    assert.equal(result.soundSettingsRestoredForInApp, true);
    assert.equal(result.hiddenWhenNone, true);
    assert.equal(result.restoredLabel, "Reminder configured");
    assert.equal(result.preservedReminder, '[{"type":"relative","minutes":30}]');
});
