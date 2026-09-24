import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

// Regression: Svelte 5 下 bind 与 change/input 的先后顺序曾让任务详情把旧控件值写入 RPC。
test("任务详情把所有刚选定的可编辑值写入同一次保存载荷", async () => {
    const result = await runSvelteBrowserTest({
        fixtureName: "task-detail-fresh-values",
        browserArgs: ["--window-size=390,844"],
        virtualTimeBudget: 4_000,
        prepareFixture(fixtureRoot) {
            const componentPath = resolve("src/frontend/components/TaskDetail.svelte").replace(/\\/g, "/");
            const taskStorePath = resolve("src/frontend/stores/task-store.ts").replace(/\\/g, "/");
            const settingsPath = resolve("src/shared/settings.ts").replace(/\\/g, "/");
            writeFileSync(
                join(fixtureRoot, "siyuan.js"),
                [
                    "export class Dialog {}",
                    "export class Menu {}",
                    "export function confirm() {}",
                    "export function openTab() {}",
                    "export function showMessage() {}",
                ].join("\n"),
            );
            writeFileSync(
                join(fixtureRoot, "Harness.svelte"),
                `<script>
import TaskDetail from ${JSON.stringify(componentPath)};
import { taskStore } from ${JSON.stringify(taskStorePath)};
import { DEFAULT_SETTINGS } from ${JSON.stringify(settingsPath)};

const task = {
    blockId: "20260901090000-taskxxx", identificationSource: "native", contentBlockId: "20260901090000-taskxxx",
    attrHostId: "20260901090000-taskxxx", parentId: "", status: "todo", priority: "none",
    importance: 4, effort: 4, due: "", start: "", context: "", taskType: "1", order: 0, childIds: [],
    title: "Fresh values", depends: "", depMode: "all", sequential: false, repeat: "", repeatState: "",
    sort: 0, completed: "", note: "", outcome: "", dod: "", actionKind: "action", created: "",
    tags: "", blocked: false, blockedReason: "", reviewInterval: 0, reviewDate: "", reminder: "",
    customFields: { score: "old" },
};
const customField = {
    version: 2, id: "field-score", key: "score", label: "Score", description: "",
    type: "text", status: "active", scope: { mode: "all" }, showOnCard: false,
};
taskStore.applySettingsUpdate({ ...DEFAULT_SETTINGS, customFields: [customField] });
taskStore.applyUpdate(task);

let writes = [];
let detail;
let flushResult = false;
const updatedFrom = (attrs) => ({
    ...task,
    status: attrs["na-status"], priority: attrs["na-priority"],
    importance: Number(attrs["na-importance"]), effort: Number(attrs["na-effort"]),
    start: attrs["na-start"], due: attrs["na-due"], taskType: attrs["na-task"],
    depends: attrs["na-depends"], depMode: attrs["na-dep-mode"], sequential: attrs["na-sequential"] === "1",
    actionKind: attrs["na-kind"], customFields: { score: attrs["na-ext-score"] },
});
const bridge = {
    getTask: async () => task,
    updateTask: async (_blockId, attrs) => {
        writes = [...writes, attrs];
        return updatedFrom(attrs);
    },
    removeTask: async () => {},
};
const i18n = new Proxy({
    status: "Status", priority: "Priority", importance: "Importance", effort: "Effort",
    taskType: "Item type", task: "Task", project: "Project", startTime: "Start", dueTime: "Due",
    taskRelations: "Task relations", depMode: "Dependency mode", sequential: "Sequential",
    customFields: "Custom fields", close: "Close",
}, { get: (target, key) => target[key] || String(key) });

async function flush() {
    flushResult = await detail.flushPendingSave();
}
</script>

<button id="flush" onclick={flush}>Flush</button>
<div id="state" data-writes={JSON.stringify(writes)} data-flushed={String(flushResult)}></div>
<TaskDetail bind:this={detail} {task} {bridge} {i18n} showJumpToBlock={false} />`,
            );
            writeFileSync(
                join(fixtureRoot, "main.js"),
                `import { mount } from "svelte";
import Harness from "./Harness.svelte";
mount(Harness, { target: document.querySelector("#app") });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const group = (label) => document.querySelector('[role="group"][aria-label="' + label + '"]');
const change = (element, value, eventName = "change") => {
    element.value = value;
    element.dispatchEvent(new Event(eventName, { bubbles: true }));
};
const finish = (value) => window.__NA_BROWSER_RESULT__(value);

void (async () => {
    await wait(80);
    change(group("Status").querySelector("select"), "doing");
    change(group("Priority").querySelector("select"), "high");
    group("Importance").querySelector('button[aria-label="6"]').click();
    group("Effort").querySelector('button[aria-label="2"]').click();

    const start = group("Start").querySelector("input");
    change(start, "2026-09-02", "input");
    start.dispatchEvent(new Event("blur", { bubbles: true }));
    const due = group("Due").querySelector("input");
    change(due, "2026-09-03", "input");
    due.dispatchEvent(new Event("blur", { bubbles: true }));

    [...document.querySelectorAll(".na-property-section__trigger")]
        .find((button) => button.textContent.includes("Task relations")).click();
    await wait(0);
    change(group("Dependency mode").querySelector("select"), "any");
    group("Sequential").querySelector('[role="switch"]').click();

    change(group("Score").querySelector("input"), "fresh", "input");
    group("Item type").querySelector('button[aria-label="Project"]').click();
    await wait(0);
    document.querySelector("#flush").click();
    await wait(80);

    const state = document.querySelector("#state");
    const writes = JSON.parse(state.dataset.writes || "[]");
    finish({
        viewportWidth: window.innerWidth,
        flushResult: state.dataset.flushed,
        writeCount: writes.length,
        attrs: writes.at(-1),
        dom: {
            status: group("Status").querySelector("select").value,
            priority: group("Priority").querySelector("select").value,
            importance: group("Importance").querySelectorAll('[aria-checked="true"]').length,
            effort: group("Effort").querySelectorAll('[aria-checked="true"]').length,
        },
    });
})().catch((error) => finish({ error: String(error?.stack || error) }));`,
            );
        },
    });

    const viewportWidth = (result as { viewportWidth: number }).viewportWidth;
    assert.ok(viewportWidth >= 390 && viewportWidth <= 500);
    assert.deepEqual(
        { ...result, viewportWidth: 390 },
        {
            viewportWidth: 390,
            flushResult: "true",
            writeCount: 1,
            attrs: {
                "na-status": "doing",
                "na-priority": "high",
                "na-importance": "6",
                "na-effort": "2",
                "na-due": "2026-09-03",
                "na-start": "2026-09-02",
                "na-context": "",
                "na-tags": "",
                "na-parent": "",
                "na-task": "2",
                "na-depends": "",
                "na-dep-mode": "any",
                "na-sequential": "1",
                "na-note": "",
                "na-outcome": "",
                "na-dod": "",
                "na-kind": "",
                "na-review-interval": "",
                "na-review-date": "",
                "na-ext-score": "fresh",
            },
            dom: { status: "doing", priority: "high", importance: 6, effort: 2 },
        },
    );
});

test("任务详情显示提醒继承、自定义和任务级禁用状态", async () => {
    // Regression: 任务详情此前无法保护全局继承、自定义和任务级禁用状态的显示映射。
    const result = await runSvelteBrowserTest({
        fixtureName: "task-detail-reminder-status",
        virtualTimeBudget: 3_000,
        prepareFixture(fixtureRoot) {
            const componentPath = resolve("src/frontend/components/TaskDetail.svelte").replace(/\\/g, "/");
            const taskStorePath = resolve("src/frontend/stores/task-store.ts").replace(/\\/g, "/");
            const settingsPath = resolve("src/shared/settings.ts").replace(/\\/g, "/");
            writeFileSync(
                join(fixtureRoot, "siyuan.js"),
                [
                    "export class Dialog {}",
                    "export class Menu {}",
                    "export function confirm() {}",
                    "export function openTab() {}",
                    "export function showMessage() {}",
                ].join("\n"),
            );
            writeFileSync(
                join(fixtureRoot, "Harness.svelte"),
                `<script>
import TaskDetail from ${JSON.stringify(componentPath)};
import { taskStore } from ${JSON.stringify(taskStorePath)};
import { DEFAULT_SETTINGS } from ${JSON.stringify(settingsPath)};

let task = $state({
    blockId: "20260901090000-remindr", identificationSource: "native", contentBlockId: "20260901090000-remindr",
    attrHostId: "20260901090000-remindr", parentId: "", status: "todo", priority: "none",
    importance: 4, effort: 4, due: "2026-09-09", start: "", context: "", taskType: "1", order: 0, childIds: [],
    title: "Reminder status", depends: "", depMode: "all", sequential: false, repeat: "", repeatState: "",
    sort: 0, completed: "", note: "", outcome: "", dod: "", actionKind: "action", created: "",
    tags: "", blocked: false, blockedReason: "", reviewInterval: 0, reviewDate: "", reminder: "",
    customFields: {},
});
taskStore.applySettingsUpdate(DEFAULT_SETTINGS);
const i18n = new Proxy({
    reminder: "Reminders", reminderInherited: "Inherited default reminders", reminderConfigured: "Custom reminders",
    reminderDisabled: "Reminders disabled", notConfigured: "Not configured",
}, { get: (target, key) => target[key] || String(key) });
const bridge = {
    getTask: async () => task,
    updateTask: async (_blockId, attrs) => ({ ...task, reminder: attrs["custom-na-reminder"] }),
    removeTask: async () => {},
};
window.setReminderValue = (reminder) => { task = { ...task, reminder }; };
window.setGlobalDefault = (enabled) => taskStore.applySettingsUpdate({
    ...DEFAULT_SETTINGS,
    reminderSettings: { ...DEFAULT_SETTINGS.reminderSettings, useGlobalDefaultReminders: enabled },
});
</script>
<TaskDetail bind:task {bridge} {i18n} showJumpToBlock={false} />`,
            );
            writeFileSync(
                join(fixtureRoot, "main.js"),
                `import { mount } from "svelte";
import Harness from "./Harness.svelte";
mount(Harness, { target: document.querySelector("#app") });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const status = () => document.querySelector(".na-task-detail__setting-action").textContent.trim();
const finish = (value) => window.__NA_BROWSER_RESULT__(value);
void (async () => {
    await wait(80);
    const labels = [status()];
    window.setGlobalDefault(true);
    await wait(20);
    labels.push(status());
    window.setReminderValue(JSON.stringify([{ type: "relative", minutes: 30 }]));
    await wait(20);
    labels.push(status());
    window.setReminderValue("[]");
    await wait(20);
    labels.push(status());
    window.setReminderValue("");
    window.setGlobalDefault(false);
    await wait(20);
    labels.push(status());
    finish(labels);
})().catch((error) => finish({ error: String(error?.stack || error) }));`,
            );
        },
    });

    assert.deepEqual(result, [
        "Not configured",
        "Inherited default reminders",
        "Custom reminders",
        "Reminders disabled",
        "Not configured",
    ]);
});
