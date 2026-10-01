import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

// Regression: 移动端甘特曾按任务行数定高，任务少时下方留白，任务多时又无法在图内滚动。
test("移动端甘特填充剩余高度、使用高行并把低频控制收进设置", async () => {
    const source = (path: string) => JSON.stringify(resolve(path).replace(/\\/g, "/"));
    const result = await runSvelteBrowserTest<{
        heightRatio: number;
        rowHeight: number;
        verticalOverflow: boolean;
        horizontalOverflow: boolean;
        stickyOutline: string;
        stickyAxis: string;
        settingsCancelKeepsNames: boolean;
        settingsApplyHidesNames: boolean;
        endPadding: number;
    }>({
        fixtureName: "project-gantt-mobile",
        browserArgs: ["--window-size=390,844"],
        virtualTimeBudget: 5_000,
        prepareFixture(fixtureRoot) {
            const base = `export class Menu {} export function openTab() {} export function showMessage() {}`;
            const harness = `<script>
import GanttView from ${source("src/frontend/components/GanttView.svelte")};
import { provideWorkspace } from ${source("src/frontend/workspace-context.ts")};
import ${source("src/frontend/ui/tokens.scss")};
import ${source("src/frontend/ui/primitives.scss")};
import ${source("src/frontend/styles/app-shell.scss")};
import ${source("src/frontend/styles/workspace.scss")};
const base = { identificationSource: "document", contentBlockId: "", attrHostId: "", parentId: "project", status: "todo", priority: "medium", importance: 4, effort: 4, due: "", start: "", context: "", taskType: "1", order: 0, childIds: [], depends: "", depMode: "all", sequential: false, repeat: "", repeatState: "", sort: 0, completed: "", note: "", outcome: "", dod: "", actionKind: "action", created: "", tags: "", blocked: false, blockedReason: "", reviewInterval: 0, reviewDate: "", reminder: "", customFields: {} };
const project = { ...base, blockId: "project", parentId: "", taskType: "2", title: "Mobile Gantt", childIds: [] };
const actions = Array.from({ length: 14 }, (_, index) => ({ ...base, blockId: "task-" + index, title: "A very long task title " + index + " that should wrap", start: "2026-09-" + String(index + 1).padStart(2, "0"), due: "2026-09-" + String(index + 2).padStart(2, "0"), sort: index, parentId: "project" }));
project.childIds = actions.map((task) => task.blockId);
const tasks = [project, ...actions];
const model = { rows: [project, ...actions].map((task, index) => ({ task, depth: index ? 1 : 0, hasChildren: index === 0, childCount: index === 0 ? actions.length : 0 })), includedTasks: tasks, includedIds: new Set(tasks.map((task) => task.blockId)), taskById: new Map(tasks.map((task) => [task.blockId, task])), childrenByParent: new Map([["project", actions]]), parentByChild: new Map(actions.map((task) => [task.blockId, "project"])) };
provideWorkspace("mobile-dock", { getCompletedTasksPage: async () => ({ tasks: [], total: 0 }) });
const i18n = new Proxy({ projectViewGantt: "Gantt", ganttSettings: "Gantt settings", ganttToggleNames: "Show task names", ganttSortLabel: "Gantt order", ganttSortTimeline: "Time", ganttSortManual: "Manual", ganttScheduled: "Scheduled", ganttUnscheduled: "Unscheduled", ganttScaleDay: "Day", ganttScaleWeek: "Week", ganttScaleMonth: "Month", cancel: "Cancel", apply: "Apply", untitled: "Untitled", back: "Back" }, { get: (target, key) => target[key] || String(key) });
</script>
<main class="nextaction na-app na-workspace--compact na-workspace--touch" style="width:390px;height:844px"><GanttView {model} projectTasks={tasks} {i18n} sortMode="timeline" onSortModeChange={() => {}} onToggleCollapse={() => {}} onSelectTask={() => {}} onEdit={() => {}} onContextMenu={() => {}} /></main>`;
            const main = `import { mount, tick } from "svelte"; import Harness from "./Harness.svelte"; mount(Harness, { target: document.querySelector("#app") }); const pause = async (ms = 60) => { await tick(); await new Promise((resolve) => setTimeout(resolve, ms)); }; void (async () => { await pause(); const root = document.querySelector(".na-gantt"); const viewport = document.querySelector(".na-gantt__viewport"); const outline = document.querySelector(".na-gantt__outline"); const axis = document.querySelector(".na-gantt__axis"); const row = document.querySelector(".na-gantt__outline-row"); viewport.scrollTop = 120; viewport.scrollLeft = 80; await pause(); const initial = { heightRatio: root.getBoundingClientRect().height / document.querySelector("main").getBoundingClientRect().height, rowHeight: row.getBoundingClientRect().height, verticalOverflow: viewport.scrollHeight > viewport.clientHeight, horizontalOverflow: viewport.scrollWidth > viewport.clientWidth, stickyOutline: getComputedStyle(outline).position, stickyAxis: getComputedStyle(axis).position }; document.querySelector('[aria-label="Gantt settings"]').click(); await pause(); document.querySelector('[aria-label="Show task names"]').click(); document.querySelector('[aria-label="Cancel"]').click(); await pause(); const settingsCancelKeepsNames = getComputedStyle(document.querySelector(".na-gantt__outline")).visibility !== "hidden"; document.querySelector('[aria-label="Gantt settings"]').click(); await pause(); document.querySelector('[aria-label="Show task names"]').click(); document.querySelector(".na-page-host__header .na-button").click(); await pause(); const settingsApplyHidesNames = getComputedStyle(document.querySelector(".na-gantt__outline")).visibility === "hidden"; window.__NA_BROWSER_RESULT__({ ...initial, settingsCancelKeepsNames, settingsApplyHidesNames, endPadding: viewport.scrollWidth - viewport.clientWidth }); })().catch((error) => window.__NA_BROWSER_RESULT__({ error: String(error?.stack || error) }));`;
            writeFileSync(resolve(fixtureRoot, "siyuan.js"), base);
            writeFileSync(resolve(fixtureRoot, "Harness.svelte"), harness);
            writeFileSync(resolve(fixtureRoot, "main.js"), main);
        },
    });
    assert.equal(result.heightRatio >= 0.7, true);
    assert.equal(result.rowHeight, 64);
    assert.equal(result.verticalOverflow, true);
    assert.equal(result.horizontalOverflow, true);
    assert.equal(result.stickyOutline, "sticky");
    assert.equal(result.stickyAxis, "sticky");
    assert.equal(result.settingsCancelKeepsNames, true);
    assert.equal(result.settingsApplyHidesNames, true);
    assert.equal(result.endPadding > 0, true);
});
