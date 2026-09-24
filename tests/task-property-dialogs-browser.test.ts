import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

test("Regression: Svelte 5 属性弹窗保存、失败恢复和重试可用", async () => {
    // Regression: 移除兼容模式后，重复保存和提醒输入调用不存在的 $set，RPC 无法执行。
    const controller = resolve("src/frontend/dialogs/task-property-dialogs.ts");
    const result = await runSvelteBrowserTest<{ checks: boolean[]; error?: string }>({
        fixtureName: "task-property-dialogs-save",
        files: {
            "siyuan.js": `
export const confirm = (_title, _message, callback) => callback();
export const showMessage = () => {};
export class Dialog {
    constructor(options) {
        this.options = options;
        this.element = document.createElement("div");
        this.element.innerHTML = '<div class="b3-dialog"><div class="b3-dialog__container">' + options.content + '</div></div>';
        document.body.append(this.element);
    }
    destroy() { this.options.destroyCallback(); this.element.remove(); }
}
`,
            "main.js": `
import { tick } from "svelte";
import { openRepeatRuleDialog, openReminderSettingsDialog } from ${JSON.stringify(controller)};

const checks = [];
const task = { blockId: "20260908120000-abcdefg", title: "回归任务", due: "2026-09-09", start: "", repeat: "", reminder: "" };
const i18n = { save: "保存", saving: "保存中", reminderNoDueDate: "请先设置截止日期" };
const settle = async () => { await tick(); await Promise.resolve(); await tick(); };
const text = () => document.body.textContent;
let pending;
let calls = 0;
let saves = 0;
const writes = [];
const bridge = {
    setRepeatRule() { calls++; return new Promise((resolve, reject) => { pending = { resolve, reject }; }); },
    updateTask(_blockId, attrs) { calls++; writes.push(attrs); return new Promise((resolve, reject) => { pending = { resolve, reject }; }); },
};
const saveButton = () => document.querySelector(".b3-button--primary");
(async () => {
try {
    openRepeatRuleDialog(task, bridge, i18n, { onSave: () => saves++ });
    await settle();
    saveButton().click();
    await settle();
    checks.push(calls === 1 && saveButton().disabled && text().includes("保存中"));
    pending.reject(new Error("保存失败"));
    await settle();
    checks.push(!saveButton().disabled && text().includes("保存失败"));
    saveButton().click();
    await settle();
    checks.push(!text().includes("保存失败"));
    pending.resolve(task);
    await settle();
    checks.push(saves === 1 && !document.querySelector(".b3-dialog"));

    openReminderSettingsDialog(task, bridge, i18n, { onSave: () => saves++ });
    await settle();
    const add = () => document.querySelector(".na-reminder-editor__presets input");
    add().click();
    await settle();
    checks.push(calls === 3 && add().disabled && text().includes("保存中"));
    pending.reject(new Error("提醒失败"));
    await settle();
    checks.push(!add().disabled && text().includes("提醒失败") && !document.querySelector(".na-reminder-editor__item"));
    add().click();
    await settle();
    pending.resolve({ ...task, reminder: JSON.stringify([{ type: "relative", minutes: 30 }]), due: "" });
    await settle();
    checks.push(saves === 2 && !text().includes("提醒失败") && text().includes("请先设置截止日期"));
    checks.push(document.querySelectorAll(".na-reminder-editor__item").length === 1);
    document.querySelector(".na-reminder-editor__item button").click();
    await settle();
    pending.resolve({ ...task, reminder: "" });
    await settle();
    checks.push(saves === 3 && !document.querySelector(".na-reminder-editor__item") && !text().includes("保存中"));
    const modeButton = (label) => Array.from(document.querySelectorAll("button")).find((button) => button.textContent.includes(label));
    modeButton("Disable reminders").click();
    await settle();
    checks.push(calls === 6 && writes.at(-1)["na-reminder"] === "[]");
    pending.resolve({ ...task, reminder: "[]" });
    await settle();
    modeButton("Restore inherited reminders").click();
    await settle();
    checks.push(calls === 7 && writes.at(-1)["na-reminder"] === "");
    pending.resolve({ ...task, reminder: "" });
    await settle();
    checks.push(text().includes("No reminders"));

    const invalidTask = { ...task, reminder: "not-json" };
    openReminderSettingsDialog(invalidTask, bridge, i18n);
    await settle();
    const restoreInvalid = modeButton("Restore inherited reminders");
    checks.push(!!restoreInvalid);
    if (restoreInvalid) {
        restoreInvalid.click();
        await settle();
        checks.push(calls === 8 && writes.at(-1)["na-reminder"] === "");
        pending.resolve({ ...invalidTask, reminder: "" });
        await settle();
    } else {
        checks.push(false);
    }
    window.__NA_BROWSER_RESULT__({ checks });
} catch (error) { window.__NA_BROWSER_RESULT__({ checks, error: String(error) }); }
})();
`,
        },
    });
    assert.equal(result.error, undefined);
    assert.deepEqual(result.checks, Array(14).fill(true), JSON.stringify(result));
});
