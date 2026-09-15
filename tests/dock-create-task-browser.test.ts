import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

test("窄面板提供创建任务入口并打开现有创建对话框", async () => {
    const result = await runSvelteBrowserTest<{
        buttonLabel: string | null;
        desktopDock: boolean;
        mobileNavigationAbsent: boolean;
        tabCount: number;
        createDialogVisible: boolean;
        detailDialogVisible: boolean;
        createCalls: number;
        noHorizontalOverflow: boolean;
        documentLocations: string[];
        paragraphLocations: string[];
        projectFormatHidden: boolean;
        formatBeforeLocation: boolean;
    }>({
        fixtureName: "dock-create-task-entry",
        browserArgs: ["--window-size=390,844"],
        virtualTimeBudget: 2_000,
        prepareFixture(fixtureRoot) {
            const dockPath = resolve("src/frontend/components/DockSidebar.svelte").replace(/\\/g, "/");
            const taskStorePath = resolve("src/frontend/stores/task-store.ts").replace(/\\/g, "/");
            writeFileSync(
                join(fixtureRoot, "siyuan.js"),
                `export let latestDialog;
export class Dialog {
    constructor(options) {
        this.options = options;
        this.element = document.createElement("div");
        this.element.innerHTML = '<div class="b3-dialog__scrim"></div><div class="b3-dialog__container"><div class="b3-dialog__header"></div>' + options.content + '</div>';
        document.body.appendChild(this.element);
        latestDialog = this;
    }
    destroy() {
        this.options.destroyCallback?.();
        this.element.remove();
    }
}
export class Menu {}
export function confirm() {}
export function openTab() {}
export function showMessage() {}
`,
            );
            writeFileSync(
                join(fixtureRoot, "Harness.svelte"),
                `<script>
import DockSidebar from ${JSON.stringify(dockPath)};
import { taskStore } from ${JSON.stringify(taskStorePath)};
taskStore.applySettingsUpdate({ taskCreationSettings: { defaultCreateTarget: "inbox", inboxDocumentId: "", dailyNoteNotebookId: "", recentTargets: [], presets: [] } });
const i18n = new Proxy({
    pluginName: "NextAction", nextAction: "Next Actions", myDay: "My Day", inbox: "Inbox",
    createTask: "Create task", task: "Task", project: "Project", taskType: "Task type",
}, { get: (target, key) => target[key] || String(key) });
const createdTask = {
    blockId: "20260907120000-docktask", identificationSource: "native", contentBlockId: "20260907120000-docktask",
    attrHostId: "20260907120000-docktask", parentId: "", status: "inbox", priority: "medium", importance: 4,
    effort: 4, due: "", start: "", context: "", taskType: "1", order: 0, childIds: [], title: "Dock task",
    depends: "", depMode: "all", sequential: false, repeat: "", repeatState: "", sort: 0, completed: "",
    note: "", outcome: "", dod: "", actionKind: "action", created: "", tags: "", blocked: false,
    blockedReason: "", reviewInterval: 0, reviewDate: "", reminder: "", customFields: {},
};
let createCalls = 0;
const bridge = {
    listMcpTargetNotebooks: async () => [],
    createTask: async () => {
        createCalls += 1;
        window.__NA_CREATE_CALLS__ = createCalls;
        return { task: { id: createdTask.blockId, title: createdTask.title }, destination: {}, warnings: [] };
    },
    getTask: async () => createdTask,
};
</script>
<main><DockSidebar {bridge} {i18n} /></main>
<style>
:global(html), :global(body), :global(#app), main { width: 100%; height: 100%; margin: 0; }
</style>
`,
            );
            writeFileSync(
                join(fixtureRoot, "main.js"),
                `import { mount, tick } from "svelte";
import Harness from "./Harness.svelte";
mount(Harness, { target: document.querySelector("#app") });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        void (async () => {
    await tick();
    // Regression: 移动端 Workspace 导航曾错误替换 PC Dock 的三段式面板。
    const dockRoot = document.querySelector(".na-dock");
    const desktopDock = Boolean(dockRoot);
    const mobileNavigationAbsent = !document.querySelector(".na-compact-nav, .na-view-directory");
    const tabCount = document.querySelectorAll(".na-segment-control__option").length;
    const button = document.querySelector('button[aria-label="Create task"]');
    button?.click();
    await wait(120);
    // Regression: 写入形式应先于位置，文档任务和项目应提供思源默认位置。
    const save = document.querySelector(".na-create-task__save-grid");
    const formatControl = save.querySelector('[role="radiogroup"]');
    const location = save.querySelector("select");
    const formatBeforeLocation = Boolean(formatControl.compareDocumentPosition(location) & Node.DOCUMENT_POSITION_FOLLOWING);
    const paragraphLocations = Array.from(location.options, (option) => option.value);
    formatControl.querySelectorAll("button")[1].click();
    await tick();
    const documentLocations = Array.from(location.options, (option) => option.value);
    document.querySelector('button[aria-label="Project"]').click();
    await tick();
    const projectFormatHidden = !save.querySelector('[role="radiogroup"]') && location.options[0].value === "siyuan_default";
    document.querySelector('button[aria-label="Task"]').click();
    await tick();
    save.querySelector('[role="radiogroup"] button').click();
    await tick();
    const title = document.querySelector('input[aria-label="Create task"]');
    title.value = "Dock task";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await wait(300);
    const dock = document.querySelector(".na-dock");
    window.__NA_BROWSER_RESULT__({
        buttonLabel: button?.getAttribute("aria-label") || null,
        desktopDock,
        mobileNavigationAbsent,
        tabCount,
        createDialogVisible: Boolean(document.querySelector(".na-create-task")),
        detailDialogVisible: Boolean(document.querySelector(".na-task-dialog-content")),
        createCalls: window.__NA_CREATE_CALLS__ || 0,
        noHorizontalOverflow: dock ? dock.scrollWidth <= dock.clientWidth : false,
        documentLocations,
        paragraphLocations,
        projectFormatHidden,
        formatBeforeLocation,
    });
})().catch((error) => window.__NA_BROWSER_RESULT__({ error: String(error?.stack || error) }));`,
            );
        },
    });

    assert.deepEqual(result, {
        buttonLabel: "Create task",
        desktopDock: true,
        mobileNavigationAbsent: true,
        tabCount: 3,
        createDialogVisible: false,
        detailDialogVisible: true,
        createCalls: 1,
        noHorizontalOverflow: true,
        documentLocations: ["siyuan_default", "inbox", "daily_note", "document"],
        paragraphLocations: ["inbox", "daily_note", "document"],
        projectFormatHidden: true,
        formatBeforeLocation: true,
    });
});
