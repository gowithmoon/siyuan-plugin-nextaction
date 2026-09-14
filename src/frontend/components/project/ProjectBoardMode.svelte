<script lang="ts">
    import NaPageHost from "../../ui/NaPageHost.svelte";
    import NaButton from "../../ui/NaButton.svelte";
    import NaInlineNotice from "../../ui/NaInlineNotice.svelte";
    import { formatOperationError } from "../../error-format";
    import { useWorkspace } from "../../workspace-context";
    import { onDestroy, onMount, untrack } from "svelte";
    import type { Snippet } from "svelte";
    import type { TaskCacheEntry } from "../../../shared/types";
    import type { I18nStrings } from "../../../shared/i18n";
    import type { CustomFieldDef } from "../../../shared/settings";
    import {
        DEFAULT_PROJECT_BOARD_PREFERENCE,
        type ProjectBoardPreference,
        type ProjectBoardSortBy,
    } from "../../../shared/project-board-preferences";
    import {
        buildProjectBoardColumns,
        PROJECT_BOARD_UNASSIGNED_STAGE,
        type ProjectBoardColumn,
        type ProjectBoardGroupBy,
    } from "../../../shared/project-board";
    import type { ProjectBoardMoveInput, ProjectBoardMoveResult } from "../../../shared/project-board-move";
    import { sortProjectBoardTasks } from "../../utils/project-board-sort";
    import { priorityI18nKey, statusI18nKey, translateKey } from "../../i18n";
    import TaskCard from "../TaskCard.svelte";
    import NaIconButton from "../../ui/NaIconButton.svelte";

    interface Props {
        projectId: string;
        tasks: TaskCacheEntry[];
        projectTasks?: TaskCacheEntry[];
        selectedTaskId?: string;
        i18n: I18nStrings;
        progress?: Snippet;
        onSelectTask?: ((task: TaskCacheEntry) => void) | undefined;
        onEdit: (task: TaskCacheEntry) => void;
        onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
        onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
        onMoveTask: (input: ProjectBoardMoveInput) => Promise<ProjectBoardMoveResult>;
        customFields?: CustomFieldDef[];
        preference?: ProjectBoardPreference;
        onPreferenceChange?: ((preference: ProjectBoardPreference) => void) | undefined;
    }

    let {
        projectId,
        tasks,
        projectTasks = tasks,
        selectedTaskId = "",
        i18n,
        progress,
        onSelectTask = undefined,
        onEdit,
        onStatusClick,
        onContextMenu,
        onMoveTask,
        customFields = [],
        preference = { ...DEFAULT_PROJECT_BOARD_PREFERENCE },
        onPreferenceChange = undefined,
    }: Props = $props();

    const workspace = useWorkspace();
    const compact = workspace?.compact ?? false;
    const touch = workspace?.touch ?? false;
    let arrangingTask = $state<TaskCacheEntry | null>(null);
    let targetColumnKey = $state("");
    let movePosition = $state("bottom");
    let moveError = $state("");
    function openActions(task: TaskCacheEntry, event: MouseEvent) {
        if (!compact) {
            onContextMenu(task, event);
            return;
        }
        arrangingTask = task;
        targetColumnKey =
            columns.find((column) => column.tasks.some((item) => item.blockId === task.blockId))?.key ||
            columns[0]?.key ||
            "";
        movePosition = "bottom";
        moveError = "";
    }
    async function moveWithoutDragging() {
        const column = columns.find((item) => item.key === targetColumnKey);
        if (busy || !column || !arrangingTask) return;
        busy = true;
        moveError = "";
        try {
            const first = column.tasks.find((item) => item.blockId !== arrangingTask?.blockId);
            await onMoveTask({
                taskId: arrangingTask.blockId,
                projectId,
                groupBy,
                value: column.value,
                sortBy,
                visibleTaskIds: tasks.map((item) => item.blockId),
                ...(sortBy === "order" && movePosition === "top" && first
                    ? { afterId: first.blockId, afterParentId: first.parentId }
                    : {}),
            });
            arrangingTask = null;
        } catch (cause) {
            moveError = formatOperationError(cause, i18n);
        } finally {
            busy = false;
        }
    }
    let draggingTask: TaskCacheEntry | null = null;
    let dropColumnKey = $state("");
    let busy = $state(false);
    let boardElement: HTMLDivElement | undefined = $state();
    let resizeObserver: ResizeObserver | null = null;
    let boardWidth = $state(1024);
    let narrowColumnIndex = $state(
        untrack(
            () =>
                workspace?.session.read(`boardColumn:${projectId}`, preference.narrowColumnIndex) ??
                preference.narrowColumnIndex,
        ),
    );
    onDestroy(() => workspace?.session.remember(`boardColumn:${projectId}`, narrowColumnIndex));
    let groupBy = $state<ProjectBoardGroupBy>(untrack(() => preference.groupBy));
    let sortBy = $state<ProjectBoardSortBy>(untrack(() => preference.sortBy));
    let sortAsc = $state(untrack(() => preference.sortAsc));

    function persistPreference() {
        onPreferenceChange?.({
            groupBy,
            sortBy,
            sortAsc,
            narrowColumnIndex: compact ? preference.narrowColumnIndex : narrowColumnIndex,
        });
    }

    function handleGroupByChange(event: Event) {
        groupBy = (event.currentTarget as HTMLSelectElement).value as ProjectBoardGroupBy;
        narrowColumnIndex = 0;
        persistPreference();
    }

    function handleSortChange(event: Event) {
        sortBy = (event.currentTarget as HTMLSelectElement).value as ProjectBoardSortBy;
        persistPreference();
    }

    function handleSortDirectionChange() {
        sortAsc = !sortAsc;
        persistPreference();
    }

    function groupLabel(group: ProjectBoardGroupBy): string {
        if (group === "status") return i18n?.status || "Status";
        if (group === "priority") return i18n?.priority || "Priority";
        if (group === "importance") return i18n?.importance || "Importance";
        return i18n?.projectBoardStage || "Stage";
    }

    function columnLabel(column: ProjectBoardColumn): string {
        if (column.groupBy === "status") return translateKey(i18n, statusI18nKey(column.label), column.label);
        if (column.groupBy === "priority") return translateKey(i18n, priorityI18nKey(column.label), column.label);
        if (column.groupBy === "importance") return `${i18n?.importance || "Importance"} ${column.label}`;
        if (column.key === PROJECT_BOARD_UNASSIGNED_STAGE) {
            return i18n?.projectBoardUnassignedStage || "Unassigned stage";
        }
        return column.label || i18n?.untitled || "Untitled";
    }

    function handleDragStart(task: TaskCacheEntry, event: DragEvent) {
        draggingTask = task;
        event.dataTransfer?.setData("text/plain", task.blockId);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    }

    function resetDrag() {
        draggingTask = null;
        dropColumnKey = "";
    }

    function handleDragOver(columnKey: string, event: DragEvent): void {
        event.preventDefault();
        dropColumnKey = columnKey;
    }

    function handleColumnDrop(column: ProjectBoardColumn, event: DragEvent): void {
        event.preventDefault();
        void handleDrop(column);
    }

    function handleCardDrop(column: ProjectBoardColumn, task: TaskCacheEntry, event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
        void handleDrop(column, task.blockId, task.parentId);
    }

    async function handleDrop(column: ProjectBoardColumn, afterId = "", afterParentId = "") {
        if (!draggingTask || busy) return;
        busy = true;
        try {
            await onMoveTask({
                taskId: draggingTask.blockId,
                projectId,
                groupBy,
                value: column.value,
                sortBy,
                visibleTaskIds: tasks.map((item) => item.blockId),
                ...(sortBy === "order"
                    ? {
                          afterId: afterId || undefined,
                          afterParentId: afterParentId || undefined,
                      }
                    : {}),
            });
        } catch (error) {
            console.error("[NextAction] project board drop failed:", error);
        } finally {
            busy = false;
            resetDrag();
        }
    }

    onMount(() => {
        if (!boardElement) return;
        const measure = () => {
            if (boardElement) boardWidth = boardElement.clientWidth;
        };
        measure();
        if (typeof ResizeObserver !== "undefined") {
            resizeObserver = new ResizeObserver(measure);
            resizeObserver.observe(boardElement);
        }
    });

    onDestroy(() => resizeObserver?.disconnect());
    $effect(() => {
        if (preference.groupBy !== groupBy) groupBy = preference.groupBy;
    });
    $effect(() => {
        if (preference.sortBy !== sortBy) sortBy = preference.sortBy;
    });
    $effect(() => {
        if (preference.sortAsc !== sortAsc) sortAsc = preference.sortAsc;
    });
    $effect(() => {
        if (!compact && preference.narrowColumnIndex !== narrowColumnIndex)
            narrowColumnIndex = preference.narrowColumnIndex;
    });
    let orderedTasks = $derived(sortProjectBoardTasks(tasks, sortBy, sortAsc, customFields));
    let columns = $derived(buildProjectBoardColumns(orderedTasks, groupBy, projectTasks));
    let narrow = $derived(compact || boardWidth <= 780);
    $effect(() => {
        const clamped = Math.max(0, Math.min(narrowColumnIndex, Math.max(0, columns.length - 1)));
        if (clamped !== narrowColumnIndex) {
            narrowColumnIndex = clamped;
            if (!compact) persistPreference();
        }
    });
    let visibleColumns = $derived(narrow ? [columns[narrowColumnIndex]] : columns);
</script>

<div class="na-project-board" aria-busy={busy} bind:this={boardElement}>
    <div class="na-project-board__header">
        {#if progress}
            <div class="na-project-board__progress">{@render progress()}</div>
        {/if}
        <div class="na-project-board__toolbar">
            <div class="na-project-board__control">
                <label for="na-project-board-group-by">{i18n?.projectBoardGroupBy || "Group by"}</label>
                <select
                    id="na-project-board-group-by"
                    class="na-select na-select--sm"
                    onchange={handleGroupByChange}
                    value={groupBy}
                >
                    <option value="status">{groupLabel("status")}</option>
                    <option value="stage">{groupLabel("stage")}</option>
                    <option value="priority">{groupLabel("priority")}</option>
                    <option value="importance">{groupLabel("importance")}</option>
                </select>
            </div>
            <div class="na-project-board__control">
                <label for="na-project-board-sort">{i18n?.sortBy || "Sort by"}</label>
                <select
                    id="na-project-board-sort"
                    class="na-select na-select--sm"
                    onchange={handleSortChange}
                    value={sortBy}
                >
                    <option value="order">{i18n?.sortByOrder || "Manual order"}</option>
                    <option value="due">{i18n?.sortByDue || "Due date"}</option>
                    <option value="importance">{i18n?.sortByImportance || "Importance"}</option>
                    <option value="priority">{i18n?.sortByPriority || "Priority"}</option>
                    {#each customFields.filter((field) => field.status === "active") as field (field.key)}
                        <option value={`custom:${field.key}`}>{field.label}</option>
                    {/each}
                </select>
                <NaIconButton
                    compact
                    symbol={sortAsc ? "iconUp" : "iconDown"}
                    label={`${i18n?.projectBoardSortDirection || "Sort direction"}: ${sortAsc ? i18n?.sortAsc || "Ascending" : i18n?.sortDesc || "Descending"}`}
                    active={sortAsc}
                    onclick={handleSortDirectionChange}
                />
            </div>
        </div>
    </div>
    {#if narrow}
        <div class="na-project-board__pager na-project-board__pager--narrow">
            <NaIconButton
                symbol="iconLeft"
                label={i18n?.previousPage || "Previous"}
                disabled={narrowColumnIndex === 0}
                onclick={() => {
                    narrowColumnIndex -= 1;
                    if (!compact) persistPreference();
                }}
            />
            <select
                class="na-select"
                aria-label={i18n.projectViewBoard}
                value={narrowColumnIndex}
                onchange={(event) => {
                    narrowColumnIndex = Number(event.currentTarget.value);
                    if (!compact) persistPreference();
                }}
            >
                {#each columns as column, index}<option value={index}
                        >{columnLabel(column)} ({column.tasks.length})</option
                    >{/each}
            </select>
            <NaIconButton
                symbol="iconRight"
                label={i18n?.nextPage || "Next"}
                disabled={narrowColumnIndex === columns.length - 1}
                onclick={() => {
                    narrowColumnIndex += 1;
                    if (!compact) persistPreference();
                }}
            />
        </div>
    {/if}
    <div
        class="na-project-board__columns"
        class:na-project-board__columns--narrow={narrow}
        style={`--na-project-board-column-count: ${columns.length}`}
    >
        {#each visibleColumns as column (column.key)}
            <section
                class="na-project-board__column"
                role="list"
                class:drop-active={dropColumnKey === column.key}
                ondragover={(event) => handleDragOver(column.key, event)}
                ondragleave={() => (dropColumnKey = "")}
                ondrop={(event) => handleColumnDrop(column, event)}
            >
                <header><span>{columnLabel(column)}</span><span>{column.tasks.length}</span></header>
                <div class="na-project-board__cards">
                    {#each column.tasks as task (task.blockId)}
                        <div
                            class="na-project-board__card"
                            role="listitem"
                            draggable={!busy && !touch}
                            ondragstart={(event) => handleDragStart(task, event)}
                            ondragend={resetDrag}
                            ondragover={(event) => handleDragOver(column.key, event)}
                            ondrop={(event) => handleCardDrop(column, task, event)}
                        >
                            <TaskCard
                                {task}
                                selected={task.blockId === selectedTaskId}
                                onSelect={onSelectTask}
                                {onEdit}
                                {onStatusClick}
                                onContextMenu={openActions}
                                {i18n}
                                isRoot={false}
                            />
                        </div>
                    {/each}
                    {#if column.tasks.length === 0}<p class="na-project-board__empty">
                            {i18n?.projectDropHere || "Drop tasks here"}
                        </p>{/if}
                </div>
            </section>
        {/each}
    </div>
</div>

{#if arrangingTask}
    <NaPageHost
        title={arrangingTask.title}
        backLabel={i18n.back}
        onBack={() => {
            if (!busy) arrangingTask = null;
        }}
    >
        <div class="na-project-board__move">
            <label
                >{i18n.projectBoardMove}
                <select class="na-select" bind:value={targetColumnKey} disabled={busy}>
                    {#each columns as column}<option value={column.key}>{columnLabel(column)}</option>{/each}
                </select>
            </label>
            {#if sortBy === "order"}<select
                    class="na-select"
                    bind:value={movePosition}
                    disabled={busy}
                    aria-label={i18n.projectBoardGroupBy}
                >
                    <option value="bottom">{i18n.projectBoardMoveBottom}</option><option value="top"
                        >{i18n.projectBoardMoveTop}</option
                    >
                </select>{/if}
            {#if moveError}<NaInlineNotice message={moveError} tone="error" />{/if}
            <NaButton variant="primary" loading={busy} onclick={moveWithoutDragging}>{i18n.apply}</NaButton>
            <NaButton
                disabled={busy}
                onclick={(event) => {
                    const task = arrangingTask!;
                    arrangingTask = null;
                    onContextMenu(task, event);
                }}>{i18n.taskActions}</NaButton
            >
        </div>
    </NaPageHost>
{/if}

<style lang="scss">
    .na-project-board__move {
        display: grid;
        gap: 12px;
        padding: 12px;
    }
    .na-project-board__move label {
        display: grid;
        gap: 8px;
    }
    .na-project-board {
        flex: 1 1 auto;
        min-height: 0;
        min-width: 900px;
    }
    .na-project-board__header {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--na-space-sm) var(--na-space-lg);
        margin-bottom: var(--na-space-sm);
    }
    .na-project-board__progress {
        flex: 1 1 200px;
        min-width: 0;
    }
    .na-project-board__toolbar {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--na-space-xs) var(--na-space-lg);
        max-width: 100%;
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-sm);
    }
    .na-project-board__toolbar label {
        white-space: nowrap;
    }
    .na-project-board__control {
        display: inline-flex;
        align-items: center;
        gap: var(--na-space-xs);
        min-width: 0;
        max-width: 100%;
    }
    .na-project-board__control select {
        width: auto;
        min-width: 0;
        max-width: 160px;
        text-overflow: ellipsis;
    }
    .na-project-board__columns {
        display: grid;
        grid-template-columns: repeat(var(--na-project-board-column-count, 6), minmax(150px, 1fr));
        gap: 8px;
        align-items: stretch;
        min-width: max-content;
        overflow-x: auto;
    }
    .na-project-board__pager {
        display: none;
    }
    .na-project-board__column {
        min-height: 260px;
        height: 100%;
        border: 1px solid var(--na-color-divider);
        background: color-mix(in srgb, var(--b3-theme-surface) 78%, var(--b3-theme-background));
        transition:
            border-color 0.15s,
            background-color 0.15s;
    }
    .na-project-board__column.drop-active {
        border-color: var(--na-accent);
        background: var(--na-color-selected-bg);
    }
    .na-project-board__column > header {
        display: flex;
        justify-content: space-between;
        padding: 9px 10px;
        border-bottom: 1px solid var(--na-color-divider);
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-xs);
        font-weight: 700;
        text-transform: uppercase;
    }
    .na-project-board__cards {
        display: flex;
        flex-direction: column;
        gap: 5px;
        padding: 6px;
        min-height: 220px;
    }
    .na-project-board__card {
        cursor: grab;
    }
    .na-project-board__card:active {
        cursor: grabbing;
    }
    .na-project-board__empty {
        margin: 14px 6px;
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-xs);
        text-align: center;
    }
    .na-project-board__columns--narrow {
        grid-template-columns: minmax(0, 1fr);
        min-width: 0;
        overflow-x: hidden;
    }
    .na-project-board__pager--narrow {
        display: grid;
        grid-template-columns: 44px minmax(0, 1fr) 44px;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
    }
    @container nextaction-app (max-width: 780px) {
        .na-project-board {
            min-width: 0;
        }
        .na-project-board__columns,
        .na-project-board__columns--narrow {
            grid-template-columns: minmax(0, 1fr);
            min-width: 0;
            overflow-x: hidden;
        }
        .na-project-board__pager {
            display: grid;
            grid-template-columns: 44px minmax(0, 1fr) 44px;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
            color: var(--na-text-secondary);
            font-size: var(--na-font-size-sm);
            font-weight: 600;
            text-align: center;
        }
        .na-project-board__pager > select {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
    }
</style>
