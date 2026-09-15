import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function source(path: string): string {
    return readFileSync(new URL(path, import.meta.url), "utf8");
}

const listViews = [
    "AllTasksView.svelte",
    "InboxView.svelte",
    "NextActionView.svelte",
    "SomedayView.svelte",
    "WaitingView.svelte",
];

test("五个任务列表视图统一使用公共视图、筛选和列表骨架", () => {
    for (const file of listViews) {
        const view = source(`../src/frontend/components/${file}`);
        assert.match(view, /NaViewShell/, file);
        assert.match(view, /NaTaskFilterBar/, file);
        assert.match(view, /NaTaskList/, file);
        assert.doesNotMatch(view, /SearchFilterBar|na-search-filter-bar/, file);
    }

    const projectView = source("../src/frontend/components/ProjectView.svelte");
    assert.match(projectView, /NaViewShell/);
    assert.match(projectView, /NaTaskFilterBar/);
    for (const mode of [
        "ProjectOverviewMode",
        "ProjectHierarchyMode",
        "ProjectBoardMode",
        "ProjectPlanMode",
        "GanttView",
    ]) {
        assert.match(projectView, new RegExp(mode), mode);
    }

    const taskList = source("../src/frontend/ui/NaTaskList.svelte");
    assert.match(taskList, /}: Props = \$props\(\)/);
    assert.doesNotMatch(taskList, /export let/);
});

test("我的一天、回顾、统计和提醒视图使用对应的 Na 公共组件", () => {
    const myDay = source("../src/frontend/components/MyDayView.svelte");
    assert.match(myDay, /NaViewShell/);
    assert.match(myDay, /NaToolbar/);
    assert.match(myDay, /NaMetricStrip/);
    assert.match(myDay, /NaSegmentControl/);

    const review = source("../src/frontend/components/ReviewView.svelte");
    const reviewDue = source("../src/frontend/components/ReviewDueList.svelte");
    assert.match(review, /NaViewShell/);
    assert.match(review, /NaToolbar/);
    assert.match(review, /NaButton/);
    assert.match(reviewDue, /NaAccordion/);

    const statistics = source("../src/frontend/components/StatisticsView.svelte");
    assert.match(statistics, /NaMetricStrip/);
    assert.match(statistics, /NaProgressBar/);

    const reminder = source("../src/frontend/components/ReminderView.svelte");
    assert.match(reminder, /NaBadge/);
    assert.match(reminder, /NaIconButton/);
    assert.match(reminder, /reminderOverdueMinutes/);
});

test("桌面 Dock 保留三段式专用视图，完整面板继续使用共享视图", () => {
    const workspace = source("../src/frontend/components/Workspace.svelte");
    for (const name of ["NextActionView", "InboxView", "MyDayView"]) assert.ok(workspace.includes(`<${name}`));
    const dock = source("../src/frontend/components/DockSidebar.svelte");
    for (const name of ["DockNextAction", "DockInbox", "DockMyDay"]) {
        assert.match(dock, new RegExp(`<${name}`));
        assert.equal(existsSync(new URL(`../src/frontend/components/${name}.svelte`, import.meta.url)), true);
    }
    assert.doesNotMatch(dock, /<Workspace/);
});

test("公共筛选栏由 props 驱动并通过 typed callback 返回完整状态", () => {
    const filterBar = source("../src/frontend/ui/NaTaskFilterBar.svelte");
    assert.match(filterBar, /export let customFields/);
    assert.match(filterBar, /export let onChange: \(filterState: FilterState\) => void/);
    assert.match(filterBar, /onChange\(next\)/);
    assert.doesNotMatch(filterBar, /taskStore/);
});

test("公共搜索框使用明确的新值事件并把焦点环绘制在圆角外壳", () => {
    const searchInput = source("../src/frontend/ui/NaSearchInput.svelte");
    assert.match(searchInput, /export let onInput: \(value: string\) => void/);
    assert.match(searchInput, /value = \(event\.currentTarget as HTMLInputElement\)\.value;/);
    assert.match(searchInput, /onInput\(value\)/);
    assert.match(searchInput, /\.na-search-input:focus-within\s*\{[\s\S]*box-shadow:/);
    assert.match(searchInput, /\.na-search-input \.na-search-input__control:focus-visible\s*\{\s*outline: none;/);
});

test("任务筛选搜索以本地输入为准且不会被旧 store 值反向覆盖", () => {
    const filterBar = source("../src/frontend/ui/NaTaskFilterBar.svelte");
    assert.match(filterBar, /onInput=\{onSearchInput\}/);
    assert.match(filterBar, /function onSearchInput\(nextSearchText: string\) \{\s*searchText = nextSearchText;/);
    assert.match(filterBar, /\}, 300\);/);
    assert.doesNotMatch(filterBar, /\$:\s*if \(filterState\.searchText !== searchText/);
    assert.doesNotMatch(filterBar, /<NaSearchInput bind:value=\{searchText\}/);
});

test("公共按钮、工具栏和折叠区覆盖加载、操作插槽及合法交互结构", () => {
    const button = source("../src/frontend/ui/NaButton.svelte");
    assert.match(button, /disabled=\{disabled \|\| loading\}/);
    assert.match(button, /"button" \| "submit" \| "reset"/);
    assert.match(button, /<NaSpinner/);
    const spinner = source("../src/frontend/ui/NaSpinner.svelte");
    assert.match(spinner, /prefers-reduced-motion/);

    const toolbar = source("../src/frontend/ui/NaToolbar.svelte");
    assert.match(toolbar, /export let actions: Snippet \| undefined/);
    assert.match(toolbar, /\{@render actions\(\)\}/);

    const accordion = source("../src/frontend/ui/NaAccordion.svelte");
    assert.match(accordion, /class="na-accordion__header"/);
    assert.match(accordion, /class="na-accordion__action"/);
    const triggerStart = accordion.indexOf('<button type="button" class="na-accordion__trigger"');
    const triggerEnd = accordion.indexOf("</button>", triggerStart);
    assert.doesNotMatch(accordion.slice(triggerStart, triggerEnd), /\{@render action\(\)\}/);
});

test("旧筛选栏和未接入的 Dock 提醒组件已删除", () => {
    assert.equal(existsSync(new URL("../src/frontend/components/SearchFilterBar.svelte", import.meta.url)), false);
    assert.equal(existsSync(new URL("../src/frontend/components/DockReminder.svelte", import.meta.url)), false);
    const styles = [
        "../src/frontend/styles/app-shell.scss",
        "../src/frontend/styles/components.scss",
        "../src/frontend/styles/host-integration.scss",
    ]
        .map(source)
        .join("\n");
    assert.doesNotMatch(styles, /na-search-filter-bar|na-view__list|na-project-reminders/);
});
