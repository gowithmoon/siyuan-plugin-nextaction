<script lang="ts">
    import { useWorkspaceScroll } from "../workspace-scroll";
    const rememberScroll = useWorkspaceScroll();
    import { onMount, onDestroy, untrack } from "svelte";
    import { VIEW_BY_PROJECT } from "../constants";
    import { DEFAULT_FILTER_STATE, hasActiveTaskFilters } from "../utils/filter";
    import type { FilterState } from "../utils/filter";
    import GanttView from "./GanttView.svelte";
    import ProjectOverviewMode from "./project/ProjectOverviewMode.svelte";
    import ProjectHierarchyMode from "./project/ProjectHierarchyMode.svelte";
    import ProjectBoardMode from "./project/ProjectBoardMode.svelte";
    import ProjectPlanMode from "./project/ProjectPlanMode.svelte";
    import ProjectCompletionPanel from "./project/ProjectCompletionPanel.svelte";
    import ProjectDefinitionEditor from "./project/ProjectDefinitionEditor.svelte";
    import ProjectStagePlan from "./project/ProjectStagePlan.svelte";
    import ProjectCompactFilters from "./project/ProjectCompactFilters.svelte";
    import NaPageHost from "../ui/NaPageHost.svelte";
    import NaAccordion from "../ui/NaAccordion.svelte";
    import NaIconButton from "../ui/NaIconButton.svelte";
    import NaBadge from "../ui/NaBadge.svelte";
    import NaButton from "../ui/NaButton.svelte";
    import NaMetricStrip from "../ui/NaMetricStrip.svelte";
    import NaProgressBar from "../ui/NaProgressBar.svelte";
    import NaSegmentControl from "../ui/NaSegmentControl.svelte";
    import NaTaskFilterBar from "../ui/NaTaskFilterBar.svelte";
    import NaToggle from "../ui/NaToggle.svelte";
    import NaToolbar from "../ui/NaToolbar.svelte";
    import NaViewShell from "../ui/NaViewShell.svelte";
    import type {
        ProjectControlRisk,
        ProjectRisk,
        ProjectSummary,
        ProjectSupportData,
        TaskCacheEntry,
    } from "../../shared/types";
    import type { I18nStrings } from "../../shared/i18n";
    import { jumpToBlock } from "../utils";
    import { projectRiskI18nKey, statusI18nKey, translateKey } from "../i18n";
    import { useWorkspaceTasks, useWorkspace } from "../workspace-context";
    const taskStore = useWorkspaceTasks();
    const workspace = useWorkspace();
    const compact = workspace?.compact ?? false;
    const mobile = workspace?.touch ?? false;
    const saved = workspace?.session.read<Record<string, any>>("projects", {}) || {};
    let level = $state<"list" | "project" | "risks">(saved.level || "list");
    let returnLevel: "list" | "risks" = saved.returnLevel || "list";
    let returnToSource = saved.returnToSource || false;
    let filtersOpen = $state(false);
    let actionMenuOpen = $state(false);
    let projectModes: Record<string, ProjectViewMode> = saved.projectModes || {};
    export function back(): boolean {
        if (actionMenuOpen) {
            actionMenuOpen = false;
            return true;
        }
        if (filtersOpen) {
            filtersOpen = false;
            return true;
        }
        if (!compact || level === "list") return false;
        if (level === "project" && returnToSource) {
            returnToSource = false;
            workspace?.session.back();
            return true;
        }
        level = level === "project" ? returnLevel : "list";
        return true;
    }
    onDestroy(() =>
        workspace?.session.remember("projects", {
            level,
            returnLevel,
            returnToSource,
            activeProjectId,
            mode,
            projectModes,
            collapsedByProject,
            showCompleted,
            riskFilter,
            dateFilter,
            actionFilter,
            ganttSortMode,
        }),
    );
    import { runAiDecomposeTask, runAiExtractTasks } from "../ai/ai-feature-service";
    import type { ProjectDefinitionControllerRegistry } from "../controllers/project-definition-controller";
    import type { ProjectTreeSortMode } from "../utils/project-tree";
    import {
        createDefaultProjectBoardPreferences,
        getProjectBoardPreference,
        normalizeProjectBoardPreferences,
        withProjectBoardPreference,
        type ProjectBoardPreference,
        type ProjectBoardPreferences,
    } from "../../shared/project-board-preferences";
    import {
        buildProjectViewModel,
        buildProjectViewControl,
        confirmProjectCompletion,
        shouldShowProjectCompletionPanel,
        type ProjectActionFilter,
        type ProjectDateFilter,
        type ProjectRiskFilter,
        type ProjectViewMode,
    } from "../utils/project-view-state";
    import type { ProjectBoardMoveInput, ProjectBoardMoveResult } from "../../shared/project-board-move";

    interface Props {
        onEdit: (task: TaskCacheEntry) => void;
        onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
        onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
        i18n: I18nStrings;
        selectedTaskId?: string;
        selectedTaskOverride?: TaskCacheEntry | null;
        requestedProjectId?: string;
        onProjectRequestApplied?: () => void;
        onSelectTask?: ((task: TaskCacheEntry) => void) | undefined;
        onTaskUpdate?: ((task: TaskCacheEntry, attrs: Record<string, string>) => Promise<TaskCacheEntry>) | undefined;
        onTaskRename?: ((task: TaskCacheEntry, title: string) => Promise<TaskCacheEntry>) | undefined;
        onTaskReorder?: ((blockId: string, parentId: string, afterId?: string) => Promise<void>) | undefined;
        onProjectBoardMove: (input: ProjectBoardMoveInput) => Promise<ProjectBoardMoveResult>;
        onCreateChild?: ((task: TaskCacheEntry) => void) | undefined;
        onCreateStage?: ((project: TaskCacheEntry) => void) | undefined;
        onMoveAction?: ((task: TaskCacheEntry, project: TaskCacheEntry) => void) | undefined;
        loadProjectSupport: (projectId: string) => Promise<ProjectSupportData>;
        projectDefinitionControllerRegistry: ProjectDefinitionControllerRegistry;
        bridge?:
            | {
                  getProjectBoardPreferences: () => Promise<ProjectBoardPreferences>;
                  updateProjectBoardPreference: (
                      projectId: string,
                      preference: ProjectBoardPreference,
                  ) => Promise<ProjectBoardPreferences>;
              }
            | undefined;
    }

    let {
        onEdit,
        onStatusClick,
        onContextMenu,
        i18n,
        selectedTaskId = "",
        selectedTaskOverride = null,
        requestedProjectId = "",
        onProjectRequestApplied = undefined,
        onSelectTask = undefined,
        onTaskUpdate = undefined,
        onTaskRename = undefined,
        onTaskReorder = undefined,
        onProjectBoardMove,
        onCreateChild = undefined,
        onCreateStage = undefined,
        onMoveAction = undefined,
        loadProjectSupport,
        projectDefinitionControllerRegistry,
        bridge = undefined,
    }: Props = $props();

    type RiskItem = { summary: ProjectSummary; risk: ProjectControlRisk };

    let mode: ProjectViewMode = $state(saved.mode || "overview");
    let activeProjectId = $state(saved.activeProjectId || "");
    let appliedRequestedProjectId = $state("");
    let appliedSelectedTaskId = $state(untrack(() => selectedTaskId));
    let requestedProjectFilterBypassId = $state("");
    let preferActiveProject = $state(false);
    let collapsedByProject: Record<string, string[]> = $state(saved.collapsedByProject || {});
    let collapsedIds: Set<string> = $state(new Set());
    let showCompleted = $state(saved.showCompleted ?? false);
    let riskFilter: ProjectRiskFilter = $state(saved.riskFilter ?? "all");
    let dateFilter: ProjectDateFilter = $state(saved.dateFilter ?? "all");
    let actionFilter: ProjectActionFilter = $state(saved.actionFilter ?? "all");
    let ganttSortMode: ProjectTreeSortMode = $state(saved.ganttSortMode ?? "timeline");
    let riskItems: RiskItem[] = $state([]);
    let boardPreferences: ProjectBoardPreferences = $state(createDefaultProjectBoardPreferences());
    let boardPreferenceSaveQueue: Promise<unknown> = Promise.resolve();
    const dirtyBoardPreferenceProjects = new Set<string>();

    onMount(() => {
        if (!bridge) return;
        void bridge
            .getProjectBoardPreferences()
            .then((value) => {
                const loaded = normalizeProjectBoardPreferences(value);
                for (const projectId of dirtyBoardPreferenceProjects) {
                    const local = boardPreferences.projects[projectId];
                    if (local) loaded.projects[projectId] = local;
                }
                boardPreferences = loaded;
            })
            .catch((error) => console.warn("[NextAction] board preferences load failed:", error));
    });

    $effect(() => {
        if (requestedProjectId && requestedProjectId !== appliedRequestedProjectId) {
            activeProjectId = requestedProjectId;
            returnToSource = true;
            if (compact) level = "project";
            preferActiveProject = true;
            requestedProjectFilterBypassId = requestedProjectId;
            appliedRequestedProjectId = requestedProjectId;
            onProjectRequestApplied?.();
        }
    });

    $effect(() => {
        if (selectedTaskId !== appliedSelectedTaskId) {
            appliedSelectedTaskId = selectedTaskId;
            preferActiveProject = false;
        }
    });

    let filterState = $derived($taskStore.filterByView[VIEW_BY_PROJECT] || DEFAULT_FILTER_STATE);
    let viewState = $derived({
        mode,
        activeProjectId,
        filterBypassProjectId: requestedProjectFilterBypassId,
        selectedTaskId,
        selectedTaskOverride,
        preferActiveProject,
        showCompleted,
        riskFilter,
        dateFilter,
        actionFilter,
        filterState,
        collapsedByProject,
        ganttSortMode,
        startPreviewDays: $taskStore.settings.priorityEngine.startPreviewDays,
    });
    let projectControl = $derived(buildProjectViewControl($taskStore.allTasks, viewState));
    let viewModel = $derived(buildProjectViewModel(projectControl, $taskStore.settings.customFields, viewState));
    let resolvedActiveProjectId = $derived(viewModel.activeProjectId);
    let summaries = $derived(viewModel.summaries);
    let visibleSummaries = $derived(viewModel.visibleSummaries);
    let selectedSummary = $derived(viewModel.selectedSummary);
    $effect(() => {
        if (
            compact &&
            level === "project" &&
            activeProjectId &&
            !$taskStore.loading &&
            !$taskStore.allTasks.some((task) => task.blockId === activeProjectId && task.taskType === "2")
        ) {
            activeProjectId = "";
            level = "list";
        }
    });
    let selectedProject = $derived(viewModel.selectedProject);
    $effect(() => {
        riskItems = viewModel.riskItems;
    });
    let projectTreeModel = $derived(viewModel.projectTreeModel);
    $effect(() => {
        collapsedIds = new Set(collapsedByProject[resolvedActiveProjectId] || []);
    });
    let boardTasks = $derived(viewModel.boardTasks);
    let planGroups = $derived(viewModel.planGroups);
    let activeProjectsCount = $derived(viewModel.metrics.activeProjects);
    let attentionCount = $derived(viewModel.metrics.attention);
    let overdueCount = $derived(viewModel.metrics.overdue);
    let dueSoonCount = $derived(viewModel.metrics.dueSoon);
    let noActionCount = $derived(viewModel.metrics.noAction);
    let taskFiltersActive = $derived(hasActiveTaskFilters(filterState));
    let projectFiltersActive = $derived(riskFilter !== "all" || dateFilter !== "all" || actionFilter !== "all");
    let anyFiltersActive = $derived(taskFiltersActive || projectFiltersActive);

    function statusLabel(status: string): string {
        return translateKey(i18n, statusI18nKey(status), status);
    }

    function statusTone(status: string): "neutral" | "primary" | "info" | "success" | "warning" | "danger" {
        if (status === "done") return "success";
        if (status === "doing") return "primary";
        if (status === "waiting") return "warning";
        if (status === "someday") return "neutral";
        return "info";
    }

    function riskLabel(kind: ProjectRisk["kind"]): string {
        return translateKey(i18n, projectRiskI18nKey(kind), kind);
    }

    function handleFilterChange(state: FilterState) {
        requestedProjectFilterBypassId = "";
        taskStore.setFilterState(VIEW_BY_PROJECT, state);
    }

    function clearAllFilters() {
        requestedProjectFilterBypassId = "";
        riskFilter = "all";
        dateFilter = "all";
        actionFilter = "all";
        taskStore.setFilterState(VIEW_BY_PROJECT, { ...DEFAULT_FILTER_STATE });
    }

    function handleModeChange(value: string) {
        mode = value as ProjectViewMode;
        if (resolvedActiveProjectId) projectModes[resolvedActiveProjectId] = mode;
    }

    function selectProject(summary: ProjectSummary) {
        requestedProjectFilterBypassId = "";
        activeProjectId = summary.project.blockId;
        returnToSource = false;
        preferActiveProject = true;
        if (compact) {
            returnLevel = level === "risks" ? "risks" : "list";
            level = "project";
            mode = projectModes[activeProjectId] || "overview";
        }
    }

    function workItemCount(summary: ProjectSummary): number {
        return summary.doneCount + summary.openCount;
    }

    function toggleCollapse(blockId: string) {
        const next = new Set(collapsedIds);
        if (next.has(blockId)) next.delete(blockId);
        else next.add(blockId);
        collapsedIds = next;
        const projectId = resolvedActiveProjectId;
        if (projectId) collapsedByProject = { ...collapsedByProject, [projectId]: [...next] };
    }

    function handleBoardPreferenceChange(preference: ProjectBoardPreference) {
        const projectId = selectedSummary?.project.blockId || resolvedActiveProjectId;
        if (!projectId) return;
        dirtyBoardPreferenceProjects.add(projectId);
        boardPreferences = withProjectBoardPreference(boardPreferences, projectId, preference);
        if (!bridge) return;
        // Keep persistence off the interaction path while preserving write order.
        boardPreferenceSaveQueue = boardPreferenceSaveQueue
            .catch(() => undefined)
            .then(() => bridge!.updateProjectBoardPreference(projectId, preference))
            .catch((error) => console.warn("[NextAction] board preference save failed:", error));
    }
</script>

<NaViewShell
    loading={$taskStore.loading && summaries.length === 0}
    empty={visibleSummaries.length === 0 && (!compact || level === "list")}
    emptyText={$taskStore.error || i18n?.noResults || i18n?.noProjects || "No projects yet"}
    emptyAction={anyFiltersActive
        ? { label: i18n?.clearFilters || "Clear filters", onClick: clearAllFilters }
        : undefined}
    hint={mobile ? "" : i18n?.viewHintProject}
    scrollMode={compact ? "none" : "content"}
>
    {#snippet toolbar()}
        {#if compact}
            <div class="na-project-compact-toolbar">
                {#if level !== "list"}<NaIconButton symbol="iconLeft" label={i18n.back} onclick={back} />{/if}
                {#if level === "project"}
                    {#if mobile}
                        <span class="na-project-compact-title">{selectedSummary?.project.title || i18n.untitled}</span>
                    {:else}
                        <select
                            class="na-select"
                            aria-label={i18n.projectViewMode}
                            value={mode}
                            onchange={(event) => handleModeChange(event.currentTarget.value)}
                        >
                            <option value="overview">{i18n.projectViewOverview}</option><option value="hierarchy"
                                >{i18n.projectViewHierarchy}</option
                            ><option value="board">{i18n.projectViewBoard}</option><option value="plan"
                                >{i18n.projectViewPlan}</option
                            ><option value="gantt">{i18n.projectViewGantt}</option>
                        </select>
                    {/if}
                    <NaIconButton
                        symbol="iconAdd"
                        label={i18n.createChildTask}
                        disabled={!selectedSummary}
                        onclick={() => selectedSummary && onCreateChild?.(selectedSummary.project)}
                    />
                    <NaIconButton symbol="iconMore" label={i18n.taskActions} onclick={() => (actionMenuOpen = true)} />
                {:else}
                    <span
                        >{level === "risks"
                            ? i18n.projectRiskQueue
                            : `${visibleSummaries.length} ${i18n.projectList}`}</span
                    >
                    {#if level === "list"}<NaButton size="sm" onclick={() => (level = "risks")}
                            >{i18n.projectRiskQueue} {riskItems.length}</NaButton
                        >{/if}
                {/if}
                {#if !mobile}<NaIconButton
                        symbol="iconFilter"
                        label={i18n.filterAndSort}
                        onclick={() => (filtersOpen = true)}
                    />{:else if level !== "project"}<NaIconButton
                        symbol="iconMore"
                        label={i18n.projectFilterRisk}
                        onclick={() => (filtersOpen = true)}
                    />{/if}
            </div>
            {#if mobile && level === "project"}
                <div class="na-project-mobile-modes">
                    <NaSegmentControl
                        stretch
                        value={mode}
                        label={i18n.projectViewMode}
                        options={[
                            { value: "overview", label: i18n.projectViewOverview },
                            { value: "board", label: i18n.projectViewBoard },
                            { value: "plan", label: i18n.projectViewPlan },
                        ]}
                        onChange={handleModeChange}
                    />
                    {#if mode === "hierarchy" || mode === "gantt"}<span class="na-project-mobile-modes__secondary"
                            >{mode === "hierarchy" ? i18n.projectViewHierarchy : i18n.projectViewGantt}</span
                        >{/if}
                </div>
            {/if}
            {#if level === "list"}<NaTaskFilterBar
                    contexts={$taskStore.contexts}
                    tags={$taskStore.tags}
                    customFields={$taskStore.settings.customFields}
                    {filterState}
                    showStatus
                    {i18n}
                    onChange={handleFilterChange}
                />{/if}
        {:else}
            <NaToolbar compact>
                <NaMetricStrip
                    items={[
                        { value: activeProjectsCount, label: i18n?.projectMetricActive || "Active", tone: "info" },
                        {
                            value: attentionCount,
                            label: i18n?.projectMetricAttention || "Attention",
                            tone: attentionCount > 0 ? "warning" : "success",
                        },
                        {
                            value: overdueCount,
                            label: i18n?.projectMetricOverdue || "Overdue",
                            tone: overdueCount > 0 ? "danger" : "success",
                        },
                        { value: dueSoonCount, label: i18n?.projectMetricDueSoon || "7 days", tone: "primary" },
                        {
                            value: noActionCount,
                            label: i18n?.projectMetricNoAction || "No next action",
                            tone: noActionCount > 0 ? "warning" : "success",
                        },
                    ]}
                />
                <div class="na-toolbar__actions-content">
                    <NaButton
                        size="sm"
                        icon="iconAdd"
                        disabled={!selectedSummary}
                        onclick={() => selectedSummary && onCreateChild?.(selectedSummary.project)}
                        >{i18n?.createChildTask || "Create child task"}</NaButton
                    >
                    <NaButton
                        size="sm"
                        icon="iconSparkles"
                        disabled={!selectedSummary}
                        onclick={() => selectedSummary && runAiDecomposeTask(selectedSummary.project)}
                        >{i18n?.aiDecomposeProject || "Break down project with AI"}</NaButton
                    >
                </div>
            </NaToolbar>
            <div class="na-project-toolbar">
                <div class="na-project-toolbar__view-switcher">
                    <NaSegmentControl
                        size="sm"
                        value={mode}
                        label={i18n?.projectViewMode || "Project view"}
                        options={[
                            { value: "overview", label: i18n?.projectViewOverview || "Overview" },
                            { value: "hierarchy", label: i18n?.projectViewHierarchy || "Hierarchy" },
                            { value: "board", label: i18n?.projectViewBoard || "Board" },
                            { value: "plan", label: i18n?.projectViewPlan || "Plan" },
                            { value: "gantt", label: i18n?.projectViewGantt || "Gantt" },
                        ]}
                        onChange={handleModeChange}
                    />
                </div>
                {#if mode !== "board"}<div class="na-project-toolbar__completed">
                        <NaToggle
                            checked={showCompleted}
                            label={i18n?.projectShowCompleted || "Show completed"}
                            showText
                            onChange={(checked) => (showCompleted = checked)}
                        />
                    </div>{/if}
                <select
                    class="na-select na-select--sm na-project-toolbar__select"
                    bind:value={riskFilter}
                    aria-label={i18n?.projectFilterRisk || "Risk filter"}
                >
                    <option value="all">{i18n?.projectFilterAllRisks || "All risks"}</option>
                    <option value="attention">{i18n?.projectHealthAttention || "Attention"}</option>
                    <option value="blocked">{i18n?.projectHealthBlocked || "Blocked"}</option>
                </select>
                <select
                    class="na-select na-select--sm na-project-toolbar__select"
                    bind:value={dateFilter}
                    aria-label={i18n?.projectFilterDate || "Date filter"}
                >
                    <option value="all">{i18n?.projectFilterAllDates || "All dates"}</option>
                    <option value="overdue">{i18n?.projectRiskOverdue || "Overdue"}</option>
                    <option value="week">{i18n?.projectMetricDueSoon || "Due in 7 days"}</option>
                </select>
                <select
                    class="na-select na-select--sm na-project-toolbar__select"
                    bind:value={actionFilter}
                    aria-label={i18n?.projectFilterAction || "Next action filter"}
                >
                    <option value="all">{i18n?.projectFilterAllActions || "All actions"}</option>
                    <option value="missing">{i18n?.projectRiskNoNextAction || "No next action"}</option>
                    <option value="available">{i18n?.projectNextActions || "Next actions"}</option>
                </select>
                <span class="na-project-toolbar__hint"
                    >{i18n?.projectControlHint || "Select a project to inspect its momentum and risks"}</span
                >
            </div>
            <NaTaskFilterBar
                contexts={$taskStore.contexts}
                tags={$taskStore.tags}
                customFields={$taskStore.settings.customFields}
                {filterState}
                showStatus={true}
                searchPlaceholder={i18n?.searchProjectsAndTasks || "Search projects and tasks..."}
                {i18n}
                onChange={handleFilterChange}
                showClear={taskFiltersActive}
                clearLabel={i18n?.clearFilters || "Clear filters"}
                onClear={clearAllFilters}
            />
        {/if}
    {/snippet}

    <div
        class="na-project-workspace"
        class:na-project-workspace--compact={compact}
        class:na-project-workspace--focus={mode !== "overview"}
    >
        {#if !compact || level === "list"}
            <aside class="na-project-index" aria-label={i18n?.projectList || "Project list"}>
                {#if !mobile}<div class="na-project-index__header">
                        <span>{i18n?.projectList || "Projects"}</span>
                        <span class="na-project-index__count">{visibleSummaries.length}</span>
                    </div>
                {/if}
                <div class="na-project-index__scroll" use:rememberScroll={"index"}>
                    {#each visibleSummaries as summary (summary.project.blockId)}
                        <button
                            type="button"
                            class="na-project-index__item"
                            class:active={summary.project.blockId === resolvedActiveProjectId}
                            aria-current={summary.project.blockId === resolvedActiveProjectId ? "true" : undefined}
                            onclick={() => selectProject(summary)}
                        >
                            <span class="na-project-index__item-accent na-project-index__item-accent--{summary.health}"
                            ></span>
                            <span class="na-project-index__item-copy">
                                <strong>{summary.project.title || i18n?.untitled || "(untitled)"}</strong>
                                <span
                                    >{summary.doneCount}/{workItemCount(summary)} · {summary.nextActions.length}
                                    {i18n?.projectNextShort || "next"}</span
                                >
                            </span>
                            <NaBadge
                                text={statusLabel(summary.project.status)}
                                tone={statusTone(summary.project.status)}
                            />
                        </button>
                    {/each}
                </div>
            </aside>
        {/if}

        {#if !compact || level === "project"}
            <section
                class="na-project-canvas"
                use:rememberScroll={`project:${resolvedActiveProjectId}:${mode}`}
                class:na-project-canvas--gantt={mode === "gantt"}
            >
                {#if selectedSummary}
                    {#if !mobile}<div class="na-project-canvas__header">
                            <div class="na-project-canvas__title">
                                <span class="na-project-canvas__kicker">{i18n?.project || "Project"}</span>
                                <h2>{selectedSummary.project.title || i18n?.untitled || "(untitled)"}</h2>
                                <span
                                    >{selectedSummary.openCount}
                                    {i18n?.projectOpenTasks || "open tasks"} · {selectedSummary.risks.length}
                                    {i18n?.projectRisks || "risks"}</span
                                >
                            </div>
                            <div class="na-project-canvas__actions">
                                <NaBadge
                                    text={statusLabel(selectedSummary.project.status)}
                                    tone={statusTone(selectedSummary.project.status)}
                                />
                                <NaButton size="sm" onclick={() => onEdit(selectedSummary.project)}
                                    >{i18n?.editProject || "Edit project"}</NaButton
                                >
                            </div>
                        </div>
                    {/if}
                    {#snippet projectProgress()}
                        <NaProgressBar
                            percent={selectedSummary.progress}
                            label={`${selectedSummary.doneCount}/${workItemCount(selectedSummary)} ${i18n?.completedTasks || "completed"}`}
                        />
                    {/snippet}
                    {#if mode !== "board" && (!mobile || mode === "overview")}
                        <div class="na-project-canvas__progress">{@render projectProgress()}</div>
                    {/if}
                    {#if shouldShowProjectCompletionPanel(selectedSummary)}
                        <ProjectCompletionPanel
                            summary={selectedSummary}
                            {i18n}
                            {onSelectTask}
                            onConfirm={onTaskUpdate
                                ? () => confirmProjectCompletion(selectedSummary, onTaskUpdate)
                                : undefined}
                        />
                    {/if}

                    {#if mode === "overview"}
                        <ProjectOverviewMode
                            summary={selectedSummary}
                            risks={selectedProject?.risks || []}
                            {selectedTaskId}
                            {i18n}
                            {onSelectTask}
                            {onEdit}
                            {onStatusClick}
                            {onContextMenu}
                            {loadProjectSupport}
                            onOpenProjectSupport={jumpToBlock}
                            onCreateAction={onCreateChild}
                            onAiExtractAction={(sourceBlockId, projectId) =>
                                runAiExtractTasks([sourceBlockId], { projectId })}
                        />
                        {#snippet definitionContent()}
                            <ProjectDefinitionEditor
                                project={selectedSummary.project}
                                {i18n}
                                onSave={onTaskUpdate}
                                controllerRegistry={projectDefinitionControllerRegistry}
                            />
                        {/snippet}
                        {#snippet stageContent()}
                            {#if projectTreeModel}
                                <ProjectStagePlan
                                    project={selectedSummary.project}
                                    model={projectTreeModel}
                                    {selectedTaskId}
                                    {i18n}
                                    {onSelectTask}
                                    onCreateStage={onCreateStage
                                        ? () => onCreateStage?.(selectedSummary.project)
                                        : undefined}
                                    onRenameTask={onTaskRename}
                                    {onTaskUpdate}
                                    {onTaskReorder}
                                    {onMoveAction}
                                />
                            {/if}
                        {/snippet}
                        {#if compact}
                            <NaAccordion title={i18n.projectDetails} open={false}
                                >{@render definitionContent()}</NaAccordion
                            >
                            <NaAccordion title={i18n.projectStagePlan} open={false}
                                >{@render stageContent()}</NaAccordion
                            >
                        {:else}{@render definitionContent()}{@render stageContent()}{/if}
                    {:else if mode === "hierarchy" && projectTreeModel}
                        <ProjectHierarchyMode
                            project={selectedSummary.project}
                            model={projectTreeModel}
                            {selectedTaskId}
                            {i18n}
                            {onSelectTask}
                            {onEdit}
                            {onStatusClick}
                            {onContextMenu}
                            onToggleCollapse={toggleCollapse}
                            {onTaskRename}
                            {onTaskReorder}
                        />
                    {:else if mode === "board"}
                        <ProjectBoardMode
                            progress={mobile ? undefined : projectProgress}
                            projectId={selectedSummary.project.blockId}
                            tasks={boardTasks}
                            projectTasks={[selectedSummary.project, ...selectedSummary.descendants]}
                            {selectedTaskId}
                            {i18n}
                            {onSelectTask}
                            {onEdit}
                            {onStatusClick}
                            {onContextMenu}
                            onMoveTask={onProjectBoardMove}
                            customFields={$taskStore.settings.customFields}
                            preference={getProjectBoardPreference(boardPreferences, resolvedActiveProjectId)}
                            onPreferenceChange={handleBoardPreferenceChange}
                        />
                    {:else if mode === "plan"}
                        <ProjectPlanMode
                            groups={planGroups}
                            {selectedTaskId}
                            {i18n}
                            {onSelectTask}
                            {onEdit}
                            {onStatusClick}
                            {onContextMenu}
                        />
                    {:else if mode === "gantt" && projectTreeModel}
                        <GanttView
                            model={projectTreeModel}
                            projectTasks={[selectedSummary.project, ...selectedSummary.descendants]}
                            {selectedTaskId}
                            {i18n}
                            sortMode={ganttSortMode}
                            onSortModeChange={(value) => (ganttSortMode = value)}
                            onToggleCollapse={toggleCollapse}
                            {onSelectTask}
                            {onEdit}
                            {onContextMenu}
                        />
                    {/if}
                {:else}
                    <div class="na-project-empty">
                        <strong>{i18n?.projectSelectTitle || "Select a project"}</strong><span
                            >{i18n?.projectSelectHint || "Choose a project to inspect its progress and risks."}</span
                        >
                    </div>
                {/if}
            </section>
        {/if}

        {#if (!compact && mode === "overview") || (compact && level === "risks")}
            <aside class="na-project-risk-rail" use:rememberScroll={"risks"}>
                <div class="na-project-risk-rail__header">
                    <span>{i18n?.projectRiskQueue || "Risk queue"}</span><span>{riskItems.length}</span>
                </div>
                {#each compact ? riskItems : riskItems.slice(0, 10) as item (item.risk.kind + item.risk.taskId)}
                    <button
                        type="button"
                        class="na-project-risk-rail__item"
                        onclick={() => {
                            selectProject(item.summary);
                            onSelectTask?.(item.risk.target);
                        }}
                    >
                        <span class="na-project-risk__marker na-project-risk__marker--{item.risk.severity}"></span>
                        <span
                            ><strong>{riskLabel(item.risk.kind)}</strong><small
                                >{item.risk.target.title || i18n?.untitled || "(untitled)"}</small
                            ><em>{item.summary.project.title || i18n?.untitled || "(untitled)"}</em></span
                        >
                    </button>
                {/each}
                {#if riskItems.length === 0}<p class="na-project-muted">
                        {i18n?.projectNoRisks || "No obvious risks"}
                    </p>{/if}
            </aside>
        {/if}
    </div>
</NaViewShell>
{#if actionMenuOpen && selectedSummary}
    <NaPageHost title={i18n.taskActions} backLabel={i18n.back} onBack={() => (actionMenuOpen = false)}>
        <div class="na-page-stack na-project-actions">
            {#if mobile}
                <NaButton
                    onclick={() => {
                        handleModeChange("hierarchy");
                        actionMenuOpen = false;
                    }}>{i18n.projectViewHierarchy}</NaButton
                >
                <NaButton
                    onclick={() => {
                        handleModeChange("gantt");
                        actionMenuOpen = false;
                    }}>{i18n.projectViewGantt}</NaButton
                >
                <NaButton
                    onclick={() => {
                        actionMenuOpen = false;
                        filtersOpen = true;
                    }}>{i18n.filterAndSort}</NaButton
                >
                <NaButton
                    onclick={(event) => {
                        actionMenuOpen = false;
                        onStatusClick(selectedSummary!.project, event);
                    }}>{i18n.status}</NaButton
                >
            {/if}
            <NaButton
                onclick={() => {
                    actionMenuOpen = false;
                    onEdit(selectedSummary!.project);
                }}>{i18n.editProject}</NaButton
            >
            <NaButton
                onclick={() => {
                    actionMenuOpen = false;
                    onCreateStage?.(selectedSummary!.project);
                }}>{i18n.createStage}</NaButton
            >
            <NaButton
                onclick={() => {
                    actionMenuOpen = false;
                    runAiDecomposeTask(selectedSummary!.project);
                }}>{i18n.aiDecomposeProject}</NaButton
            >
        </div>
    </NaPageHost>
{/if}
{#if filtersOpen}
    <ProjectCompactFilters
        {i18n}
        {showCompleted}
        {riskFilter}
        {dateFilter}
        {actionFilter}
        onClose={() => (filtersOpen = false)}
        onApply={(value) => {
            showCompleted = value.showCompleted;
            riskFilter = value.riskFilter;
            dateFilter = value.dateFilter;
            actionFilter = value.actionFilter;
            filtersOpen = false;
        }}
    />
{/if}

<style lang="scss">
    .na-project-compact-toolbar {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px;
    }
    .na-project-compact-toolbar > span,
    .na-project-compact-toolbar > select {
        flex: 1;
        min-width: 0;
    }
    .na-project-compact-title {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 600;
    }
    .na-project-mobile-modes {
        padding: 0 8px 8px;
        min-width: 0;
    }
    .na-project-mobile-modes :global(.na-segment-control__option) {
        min-height: 44px;
        padding: 4px 8px;
    }
    .na-project-mobile-modes__secondary {
        display: block;
        padding-top: 4px;
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-sm);
    }
    .na-project-workspace--compact .na-project-index {
        display: flex;
        flex-direction: column;
    }
    .na-project-workspace--compact .na-project-index__scroll {
        flex: 1;
        min-height: 0;
        overscroll-behavior: contain;
    }
    .na-project-actions {
        padding: 12px;
    }
    .na-project-workspace--compact {
        display: flex !important;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
        height: 100%;
    }
    .na-project-workspace--compact .na-project-index {
        width: 100%;
        min-width: 0;
        height: 100%;
        max-height: none;
        border: 0;
    }
    .na-project-workspace--compact .na-project-canvas {
        min-width: 0;
        width: 100%;
        padding: 12px;
        box-sizing: border-box;
    }
    .na-project-workspace--compact .na-project-risk-rail {
        display: flex;
        width: 100%;
        flex-direction: column;
        padding: 12px;
        box-sizing: border-box;
    }

    .na-project-toolbar {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px 10px;
        padding: 8px 12px;
    }
    .na-project-toolbar__view-switcher {
        max-width: 100%;
        overflow-x: auto;
        scrollbar-width: thin;
    }
    .na-project-toolbar__view-switcher :global(.na-segment-control) {
        width: max-content;
    }
    .na-project-toolbar__completed {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-xs);
        cursor: pointer;
        white-space: nowrap;
    }
    .na-project-toolbar__select {
        width: auto;
        min-width: 86px;
    }
    .na-project-toolbar__hint {
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-xs);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .na-project-workspace {
        display: grid;
        --na-project-index-width: clamp(160px, 18%, 200px);
        grid-template-columns: var(--na-project-index-width) minmax(0, 1fr) minmax(180px, 22%);
        min-height: 0;
        height: 100%;
        overflow: hidden;
        background: var(--b3-theme-background);
    }
    :global(.na-toolbar__main):has(:global(> .na-toolbar__actions-content)) {
        flex-wrap: wrap;
    }
    .na-toolbar__actions-content {
        flex-shrink: 0;
    }
    .na-project-workspace--focus {
        grid-template-columns: var(--na-project-index-width) minmax(0, 1fr);
    }
    .na-project-index,
    .na-project-risk-rail {
        min-width: 0;
        border-right: 1px solid var(--na-color-divider);
        background: color-mix(in srgb, var(--b3-theme-surface) 82%, var(--b3-theme-background));
    }
    .na-project-risk-rail {
        border-right: 0;
        border-left: 1px solid var(--na-color-divider);
    }
    .na-project-index__header,
    .na-project-risk-rail__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 11px 12px 8px;
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-xs);
        font-weight: 700;
        letter-spacing: 0;
        text-transform: uppercase;
    }
    .na-project-index__count,
    .na-project-risk-rail__header > span:last-child {
        color: var(--na-text-interactive);
        font-variant-numeric: tabular-nums;
    }
    .na-project-index__scroll,
    .na-project-risk-rail {
        overflow: auto;
    }
    .na-project-index__item,
    .na-project-risk-rail__item {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        padding: 9px 10px;
        border: 0;
        border-top: 1px solid color-mix(in srgb, var(--na-color-divider) 65%, transparent);
        color: var(--na-text-primary);
        background: transparent;
        text-align: left;
        cursor: pointer;
    }
    .na-project-index__item:hover,
    .na-project-index__item.active,
    .na-project-risk-rail__item:hover {
        background: var(--na-color-hover-bg);
    }
    .na-project-index__item.active {
        box-shadow: inset 3px 0 var(--na-accent);
    }
    .na-project-index__item-accent {
        flex: 0 0 5px;
        height: 30px;
        border-radius: 2px;
        background: var(--na-color-info);
    }
    .na-project-index__item-accent--attention {
        background: var(--na-color-warning);
    }
    .na-project-index__item-accent--blocked {
        background: var(--na-color-error);
    }
    .na-project-index__item-accent--complete {
        background: var(--na-color-success);
    }
    .na-project-index__item-copy {
        display: flex;
        flex: 1;
        flex-direction: column;
        min-width: 0;
        gap: 2px;
    }
    .na-project-index__item-copy strong,
    .na-project-risk-rail__item strong,
    .na-project-risk-rail__item small,
    .na-project-risk-rail__item em {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .na-project-index__item-copy strong {
        font-size: var(--na-font-size-md);
        font-weight: 600;
        letter-spacing: 0;
    }
    .na-project-index__item-copy span {
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-xs);
    }
    .na-project-canvas {
        display: flex;
        min-width: 0;
        min-height: 0;
        flex-direction: column;
        overflow: auto;
        padding: 14px;
    }
    .na-project-canvas--gantt {
        overflow: hidden;
    }
    .na-project-canvas__header {
        display: flex;
        justify-content: space-between;
        gap: 14px;
        margin-bottom: 8px;
    }
    .na-project-canvas__title {
        min-width: 0;
    }
    .na-project-canvas__kicker {
        color: var(--na-text-interactive);
        font-size: var(--na-font-size-xs);
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
    }
    .na-project-canvas h2 {
        margin: 2px 0;
        font-size: 18px;
        line-height: 24px;
        font-weight: 650;
        letter-spacing: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .na-project-canvas__title > span:last-child {
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-sm);
    }
    .na-project-canvas__actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 0 0 auto;
    }
    .na-project-canvas__progress {
        margin-bottom: 14px;
    }
    .na-project-risk-rail__item {
        border: 0;
        background: transparent;
    }
    .na-project-risk-rail__item > span:last-child {
        display: flex;
        flex-direction: column;
        min-width: 0;
        gap: 2px;
    }
    .na-project-risk-rail__item strong {
        font-size: var(--na-font-size-sm);
        font-weight: 650;
    }
    .na-project-risk-rail__item small {
        color: var(--na-text-primary);
        font-size: var(--na-font-size-sm);
    }
    .na-project-risk-rail__item em {
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-xs);
        font-style: normal;
    }
    .na-project-risk__marker {
        display: inline-block;
        flex: 0 0 7px;
        width: 7px;
        height: 7px;
        margin-top: 4px;
        border-radius: 50%;
        background: var(--na-color-info);
    }
    .na-project-risk__marker--high {
        background: var(--na-color-error);
    }
    .na-project-risk__marker--medium {
        background: var(--na-color-warning);
    }
    .na-project-risk__marker--low {
        background: var(--na-color-info);
    }
    .na-project-muted {
        margin: 4px 0;
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-sm);
    }
    .na-project-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 280px;
        gap: 6px;
        color: var(--na-text-secondary);
        text-align: center;
    }
    .na-project-empty strong {
        color: var(--na-text-primary);
        font-size: var(--na-font-size-lg);
    }
    @container nextaction-app (max-width: 880px) {
        .na-project-workspace {
            grid-template-columns: var(--na-project-index-width) minmax(0, 1fr);
        }
        .na-project-risk-rail {
            display: none;
        }
        .na-project-toolbar__hint {
            display: none;
        }
    }
    @container nextaction-app (max-width: 780px) {
        .na-project-workspace {
            display: flex;
            flex-direction: column;
            overflow: auto;
        }
        .na-project-index {
            max-height: 190px;
            border-right: 0;
            border-bottom: 1px solid var(--na-color-divider);
        }
        .na-project-canvas {
            overflow: visible;
            padding: 10px;
        }
        .na-project-canvas--gantt {
            min-height: 420px;
            overflow: hidden;
        }
    }
</style>
