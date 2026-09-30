import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

// Regression: 移动端看板曾分页显示单列，设置直接写入且横向滑动会误打开任务。
test("移动端看板横滑、列内滚动和设置页保持可用", async () => {
    const source = (path: string) => JSON.stringify(resolve(path).replace(/\\/g, "/"));
    const result = await runSvelteBrowserTest<{
        error?: string;
        initial: {
            columnCount: number;
            horizontalOverflow: boolean;
            snap: string;
            cardsOverflow: string;
            parentTouchAction: string;
            boardTouchAction: string;
            cardsTouchAction: string;
            pagerAbsent: boolean;
            controlsAbsent: boolean;
            innerScroll: boolean;
            emptyColumn: boolean;
        };
        beforeCancel: { writes: unknown[]; selected: string[] };
        afterCancel: { writes: unknown[]; selected: string[]; settingsClosed: boolean };
        afterApply: { writes: unknown[]; selected: string[] };
        settingsClosed: boolean;
        longHeaderLines: number;
    }>({
        fixtureName: "project-board-mobile",
        browserArgs: ["--window-size=390,844"],
        virtualTimeBudget: 5_000,
        prepareFixture(fixtureRoot) {
            const base = `
export class Menu {}
export function openTab() {}
export function showMessage() {}
`;
            const harness = `<script>
import ProjectBoardMode from ${source("src/frontend/components/project/ProjectBoardMode.svelte")};
import { provideWorkspace } from ${source("src/frontend/workspace-context.ts")};
import ${source("src/frontend/ui/tokens.scss")};
import ${source("src/frontend/ui/primitives.scss")};
import ${source("src/frontend/styles/app-shell.scss")};
import ${source("src/frontend/styles/workspace.scss")};

const projectId = "20260930120000-project";
const base = { identificationSource: "native", contentBlockId: "", attrHostId: "", parentId: projectId,
    status: "todo", priority: "medium", importance: 4, effort: 4, due: "", start: "", context: "", taskType: "1",
    order: 0, childIds: [], depends: "", depMode: "all", sequential: false, repeat: "", repeatState: "", sort: 0,
    completed: "", note: "", outcome: "", dod: "", actionKind: "action", created: "", tags: "", blocked: false,
    blockedReason: "", reviewInterval: 0, reviewDate: "", reminder: "", customFields: {} };
const project = { ...base, blockId: projectId, attrHostId: projectId, parentId: "", identificationSource: "document",
    taskType: "2", actionKind: "", title: "Mobile board", childIds: [] };
const action = { ...base, blockId: "action", title: "Swipe me", status: "doing" };
const extraActions = Array.from({ length: 24 }, (_, index) => ({ ...base, blockId: "action-" + index, title: "Action " + index, status: "doing", sort: index + 2 }));
const stage = { ...base, blockId: "stage", title: "A very long stage name that should wrap to two lines at most",
    actionKind: "stage", childIds: [], sort: 1 };
project.childIds = [action.blockId, ...extraActions.map((task) => task.blockId), stage.blockId];
const actions = [action, ...extraActions];
const tasks = [project, ...actions, stage];
let preference = { groupBy: "status", sortBy: "order", sortAsc: false, narrowColumnIndex: 0 };
let writes = [];
let selected = [];
const bridge = { getCompletedTasksPage: async () => ({ tasks: [], total: 0 }) };
provideWorkspace("mobile-dock", bridge);
const i18n = new Proxy({ projectBoardSettings: "Board settings", projectBoardGroupBy: "Group by", projectBoardStage: "Stage",
    projectBoardUnassignedStage: "Unassigned stage", sortBy: "Sort by", sortByOrder: "Manual order", sortByDue: "Due date",
    sortByImportance: "Importance", sortByPriority: "Priority", projectBoardSortDirection: "Sort direction",
    sortDesc: "Descending", sortAsc: "Ascending", status: "Status", priority: "Priority", importance: "Importance",
    priorityMedium: "medium", projectDropHere: "Drop tasks here", cancel: "Cancel", apply: "Apply", untitled: "Untitled",
    taskActions: "Task actions", back: "Back" }, { get: (target, key) => target[key] || String(key) });
const updatePreference = (next) => { writes = [...writes, next]; preference = next; };
const noop = () => {};
</script>
<main class="nextaction na-app na-workspace--compact na-workspace--touch" style="width:390px;height:844px">
<div class="na-app__list">
<ProjectBoardMode projectId={projectId} tasks={[...actions, stage]} projectTasks={tasks} {i18n} {preference}
    onPreferenceChange={updatePreference} onSelectTask={(task) => selected = [...selected, task.blockId]}
    onEdit={noop} onStatusClick={noop} onContextMenu={noop}
    onMoveTask={async () => ({ status: "success", task: action, reordered: false })} />
</div>
</main>
<div id="state" data-writes={JSON.stringify(writes)} data-selected={JSON.stringify(selected)}></div>`;
            const main = `import { mount, tick } from "svelte";
import Harness from "./Harness.svelte";
mount(Harness, { target: document.querySelector("#app") });
const pause = async (ms = 40) => { await tick(); await new Promise((resolve) => setTimeout(resolve, ms)); };
const state = () => ({ writes: JSON.parse(document.querySelector("#state").dataset.writes || "[]"), selected: JSON.parse(document.querySelector("#state").dataset.selected || "[]") });
const setValue = (id, value) => { const select = document.querySelector(id); select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); };
void (async () => {
    await pause();
    const board = document.querySelector(".na-project-board__columns");
    const card = document.querySelector(".na-project-board__card");
    const scrollableCards = [...document.querySelectorAll(".na-project-board__cards")].find(
        (node) => node.scrollHeight > node.clientHeight,
    );
    if (scrollableCards) {
        scrollableCards.scrollTop = 40;
        board.scrollLeft = board.clientWidth;
    }
    const initial = { columnCount: document.querySelectorAll(".na-project-board__column").length,
        horizontalOverflow: board.scrollWidth > board.clientWidth, snap: getComputedStyle(board).scrollSnapType,
        cardsOverflow: getComputedStyle(document.querySelector(".na-project-board__cards")).overflowY,
        parentTouchAction: getComputedStyle(document.querySelector(".na-app__list")).touchAction,
        boardTouchAction: getComputedStyle(board).touchAction,
        cardsTouchAction: getComputedStyle(document.querySelector(".na-project-board__cards")).touchAction,
        pagerAbsent: !document.querySelector(".na-project-board__pager"),
        controlsAbsent: !document.querySelector("#na-project-board-group-by"),
        innerScroll: Boolean(scrollableCards && scrollableCards.scrollTop > 0 && board.scrollLeft > 0),
        emptyColumn: [...document.querySelectorAll(".na-project-board__empty")].some((node) => node.textContent.includes("Drop tasks")) };
    document.querySelector('[aria-label="Board settings"]').click(); await pause();
    setValue("#na-project-board-settings-group-by", "stage"); setValue("#na-project-board-settings-sort", "due"); await pause();
    const beforeCancel = state(); document.querySelector('[aria-label="Cancel"]').click(); await pause();
    const afterCancel = { ...state(), settingsClosed: !document.querySelector("#na-project-board-settings-group-by") };
    document.querySelector('[aria-label="Board settings"]').click(); await pause();
    setValue("#na-project-board-settings-group-by", "stage"); setValue("#na-project-board-settings-sort", "due");
    document.querySelector(".na-page-host__header .na-button").click(); await pause();
    const headers = [...document.querySelectorAll(".na-project-board__column > header span:first-child")];
    const longHeader = headers.find((node) => node.textContent.includes("long stage"));
    const longHeaderLines = longHeader ? Math.round(longHeader.getBoundingClientRect().height / parseFloat(getComputedStyle(longHeader).lineHeight)) : 0;
    card.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch", clientX: 100, clientY: 100 }));
    card.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "touch", clientX: 220, clientY: 104 }));
    card.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch", clientX: 220, clientY: 104 }));
    card.dispatchEvent(new MouseEvent("click", { bubbles: true })); await pause();
    window.__NA_BROWSER_RESULT__({ initial, beforeCancel, afterCancel, afterApply: state(), settingsClosed: !document.querySelector("#na-project-board-settings-group-by"),
        longHeaderLines });
})().catch((error) => window.__NA_BROWSER_RESULT__({ error: String(error?.stack || error) }));`;
            writeFileSync(resolve(fixtureRoot, "siyuan.js"), base);
            writeFileSync(resolve(fixtureRoot, "Harness.svelte"), harness);
            writeFileSync(resolve(fixtureRoot, "main.js"), main);
        },
    });
    assert.equal(result.error, undefined);
    assert.deepEqual(result.initial, {
        columnCount: 6,
        horizontalOverflow: true,
        snap: "x mandatory",
        cardsOverflow: "auto",
        parentTouchAction: "pan-x pan-y",
        boardTouchAction: "pan-x",
        cardsTouchAction: "pan-y",
        pagerAbsent: true,
        controlsAbsent: true,
        innerScroll: true,
        emptyColumn: true,
    });
    assert.deepEqual(result.beforeCancel, { writes: [], selected: [] });
    assert.deepEqual(result.afterCancel, { writes: [], selected: [], settingsClosed: true });
    assert.deepEqual(result.afterApply.writes, [
        { groupBy: "stage", sortBy: "due", sortAsc: false, narrowColumnIndex: 0 },
    ]);
    assert.equal(result.settingsClosed, true);
    assert.equal(result.longHeaderLines <= 2, true);
    assert.deepEqual(result.afterApply.selected, []);
});
