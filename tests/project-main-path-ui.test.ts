import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
    return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("项目回顾可以打开对应项目并将目标选择传递给项目视图", () => {
    const app = source("../src/frontend/components/Workspace.svelte");
    const review = source("../src/frontend/components/ReviewView.svelte");
    const queue = source("../src/frontend/components/ProjectReviewQueue.svelte");
    const projectView = source("../src/frontend/components/ProjectView.svelte");

    assert.match(queue, /onOpenProject: \(project: TaskCacheEntry\) => void/);
    assert.match(queue, /}: Props = \$props\(\)/);
    assert.match(queue, /onclick=\{\(\) => onOpenProject\(project\)\}/);
    assert.match(review, /\{onOpenProject\}/);
    assert.match(app, /function handleOpenProject\(project: TaskCacheEntry\)/);
    assert.match(app, /onOpenProject=\{handleOpenProject\}/);
    assert.match(app, /requestedProjectId=\{projectFocusId\}/);
    assert.match(app, /let reviewManualProjectIds: string\[\] = \$state\(\[\]\)/);
    assert.match(app, /let reviewExpandedProjectId = \$state\(""\)/);
    assert.match(app, /bind:manualProjectIds=\{reviewManualProjectIds\}/);
    assert.match(app, /bind:expandedProjectId=\{reviewExpandedProjectId\}/);
    assert.match(app, /bind:reviewScrollTop/);
    assert.match(review, /manualProjectIds = \$bindable\(\[\]\)/);
    assert.match(review, /expandedProjectId = \$bindable\(""\)/);
    assert.match(review, /reviewScrollTop = \$bindable\(0\)/);
    assert.match(review, /onscroll=\{\(\) => \(reviewScrollTop = reviewScrollElement\?\.scrollTop \|\| 0\)\}/);
    assert.match(queue, /expandedProjectId = \$bindable\(""\)/);
    assert.match(projectView, /requestedProjectId\?: string/);
    assert.match(projectView, /activeProjectId = requestedProjectId/);
    assert.match(projectView, /let requestedProjectFilterBypassId = \$state\(""\)/);
    assert.match(
        projectView,
        /function handleFilterChange\(state: FilterState\) \{\s*requestedProjectFilterBypassId = "";/,
    );
});

test("风险处置入口提供创建下一步行动与统一完成确认", () => {
    const overview = source("../src/frontend/components/project/ProjectOverviewMode.svelte");
    const queue = source("../src/frontend/components/ProjectReviewQueue.svelte");
    const review = source("../src/frontend/components/ReviewView.svelte");

    assert.match(overview, /shouldOfferProjectRiskAction\(item\)/);
    assert.match(overview, /onCreateAction\?\.\(summary\.project\)/);
    assert.match(queue, /shouldOfferProjectRiskAction\(risk\)/);
    assert.match(queue, /onCreateAction\?\.\(project\)/);
    assert.match(queue, /onConfirmCompletion/);
    assert.match(review, /confirmProjectCompletion\(summary/);
});

test("任务详情区分逻辑加入项目、物理移动和取消项目身份", () => {
    const detail = source("../src/frontend/components/TaskDetail.svelte");
    const en = source("../src/i18n/en.json");
    const zh = source("../src/i18n/zh-CN.json");

    assert.match(
        detail,
        /\{#if !isProject\}[\s\S]*?<NaPropertyRow[\s\S]*?label=\{i18n\?\.projectAssignment[\s\S]*?helpText=\{i18n\?\.projectAssignmentHint[\s\S]*?<NaSearchSelect/,
    );
    assert.match(detail, /clearLabel=\{i18n\?\.clearProjectAssignment/);
    assert.match(detail, /i18n\?\.removeProject/);
    for (const translation of [en, zh]) {
        assert.match(translation, /"projectAssignment"/);
        assert.match(translation, /"projectAssignmentHint"/);
        assert.match(translation, /"clearProjectAssignment"/);
        assert.match(translation, /"confirmRemoveProject"/);
    }
    assert.match(zh, /"projectAssignment": "项目或父任务"/);
    assert.match(en, /"projectAssignment": "Project or parent task"/);
});

test("项目层级视图只保留缩进和任务卡片，不显示冗余上级行或操作按钮", () => {
    // Regression: hierarchy cards rendered a parent selector row and four action buttons for every task.
    const hierarchy = source("../src/frontend/components/project/ProjectHierarchyMode.svelte");

    assert.doesNotMatch(hierarchy, /class="na-project-tree__controls"/);
    assert.doesNotMatch(hierarchy, /class="na-project-tree__parent"/);
});

test("移动端项目详情只保留标题栏视图选择并释放画布高度", () => {
    // Regression: project detail used to stack the workspace header, project header, and a second mode switcher.
    const app = source("../src/frontend/components/Workspace.svelte");
    const view = source("../src/frontend/components/ProjectView.svelte");

    assert.match(app, /projectDetailActive = \$state\(false\)/);
    assert.match(app, /activeView === VIEW_BY_PROJECT && projectDetailActive/);
    assert.match(app, /onProjectDetailChange=\{\(active\) => \(projectDetailActive = active\)\}/);
    assert.match(view, /onProjectDetailChange\?\.\(compact && level === "project"\)/);
    assert.match(view, /class="na-select na-project-compact-mode"/);
    assert.doesNotMatch(view, /class="na-project-mobile-modes"/);
    assert.doesNotMatch(view, /handleModeChange\("hierarchy"\)/);
    assert.doesNotMatch(view, /handleModeChange\("gantt"\)/);
    assert.match(view, /\.na-project-workspace--compact\s*\{[\s\S]*?flex:\s*1 1 auto;/);
    assert.match(view, /\.na-project-workspace--compact \.na-project-canvas\s*\{[\s\S]*?min-height:\s*0;/);
});

test("Stage 在项目计划、Next Action 和 Review 共用的任务卡片中可见", () => {
    const card = source("../src/frontend/components/TaskCard.svelte");
    const styles = source("../src/frontend/styles/components.scss");

    assert.match(card, /isStage = \$derived\(!isProject && task\.actionKind === "stage"\)/);
    assert.match(card, /\{#if isStage\}<span class="na-task-card__kind">\{i18n\?\.actionKindStage/);
    assert.match(styles, /\.na-task-card__kind\s*\{/);
});
