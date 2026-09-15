<script lang="ts">
    import { onMount } from "svelte";
    import { taskStore } from "../stores/task-store";
    import { KernelBridge } from "../kernel-bridge";
    import { DEFAULT_MY_DAY_RESET_HOUR, DEFAULT_MY_DAY_DURATION, MY_DAY_DRAG_TYPE } from "../../shared/constants";
    import TaskCard from "./TaskCard.svelte";
    import NaIconButton from "../ui/NaIconButton.svelte";
    import NaSearchSelect from "../ui/NaSearchSelect.svelte";
    import NaSegmentControl from "../ui/NaSegmentControl.svelte";
    import NaTaskList from "../ui/NaTaskList.svelte";
    import NaToolbar from "../ui/NaToolbar.svelte";
    import NaViewShell from "../ui/NaViewShell.svelte";
    import TimelineColumn from "./timeline/TimelineColumn.svelte";
    import { normalizePriority } from "../constants";
    import type { TaskCacheEntry, MyDayTaskEntry, MyDayState } from "../../shared/types";
    import { isMyDayEntryDone } from "../../shared/my-day";
    import { runAiPlanMyDay } from "../ai/ai-feature-service";

    interface Props {
        bridge: KernelBridge;
        onEdit: (task: TaskCacheEntry) => void;
        onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
        onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
        i18n: any;
    }

    let { bridge, onEdit, onStatusClick, onContextMenu, i18n }: Props = $props();

    type ViewMode = "timeline" | "list";
    let viewMode: ViewMode = $state($taskStore.settings?.myDayDefaultViewMode === "list" ? "list" : "timeline");
    let selectedTaskId = $state("");

    let resetHour = $derived($taskStore.settings?.myDayResetHour ?? DEFAULT_MY_DAY_RESET_HOUR);
    let defaultDuration = $derived($taskStore.settings?.myDayDefaultDuration ?? DEFAULT_MY_DAY_DURATION);

    let myDayState = $derived($taskStore.myDayState);
    let allTasks = $derived($taskStore.allTasks);
    let taskMap = $derived(
        new Map<string, TaskCacheEntry>(allTasks.map((t) => [t.blockId, t] as [string, TaskCacheEntry])),
    );
    let myDayEntryMap = $derived(new Map((myDayState?.tasks ?? []).map((entry) => [entry.blockId, entry])));

    let myDayTasks = $derived(
        (() => {
            const state = myDayState;
            if (!state) return [];
            const result: TaskCacheEntry[] = [];
            for (const entry of state.tasks) {
                const task = taskMap.get(entry.blockId);
                if (task) result.push(task);
            }
            return result;
        })(),
    );

    let myDayBlockIds = $derived(new Set((myDayState?.tasks || []).map((t) => t.blockId)));

    let unscheduledEntries = $derived(
        (myDayState?.tasks ?? []).filter((e) => e.scheduleStart === null || e.scheduleEnd === null),
    );
    let scheduledEntries = $derived(
        (myDayState?.tasks ?? []).filter((e) => e.scheduleStart !== null && e.scheduleEnd !== null),
    );

    function handleContextMenu(task: TaskCacheEntry, event: MouseEvent): void {
        event.preventDefault();
        onContextMenu(task, event);
    }

    async function searchTasksForAdd(query: string): Promise<{ id: string; label: string }[]> {
        if (!query.trim()) return [];
        const q = query.toLowerCase();
        return $taskStore.allTasks
            .filter(
                (t) =>
                    t.status !== "done" &&
                    t.status !== "someday" &&
                    !myDayBlockIds.has(t.blockId) &&
                    (t.title.toLowerCase().includes(q) ||
                        (t.tags && t.tags.replace(/\|/g, ", ").toLowerCase().includes(q))),
            )
            .slice(0, 10)
            .map((t) => ({ id: t.blockId, label: t.title || i18n?.untitled || "(untitled)" }));
    }

    async function handleSearchChange(selected: string | string[]) {
        const blockId = typeof selected === "string" ? selected : "";
        if (!blockId) return;
        selectedTaskId = "";
        try {
            const myDayState = await bridge.addTaskToMyDay(blockId);
            taskStore.applyMyDayUpdate(myDayState);
        } catch (e: any) {
            console.error("[NextAction] addTaskToMyDay failed:", e);
        }
    }

    function handleViewModeChange(value: string) {
        viewMode = value as ViewMode;
    }

    function handleDragStart(e: DragEvent, blockId: string) {
        if (!e.dataTransfer) return;
        e.dataTransfer.setData(MY_DAY_DRAG_TYPE, blockId);
        e.dataTransfer.effectAllowed = "move";
    }

    function handleUnscheduledClick(event: MouseEvent, task: TaskCacheEntry): void {
        if ((event.target as HTMLElement | null)?.closest("button")) return;
        onEdit(task);
    }

    async function handleRemoveFromMyDay(blockId: string) {
        try {
            const newState = await bridge.removeTaskFromMyDay(blockId);
            taskStore.applyMyDayUpdate(newState);
        } catch (e: any) {
            console.error("[NextAction] removeFromMyDay failed:", e);
        }
    }

    onMount(() => {
        taskStore.loadMyDay();
    });
</script>

<div class="na-dock-myday">
    <NaViewShell
        loading={viewMode === "list" && $taskStore.loading}
        empty={viewMode === "list" && myDayTasks.length === 0}
        emptyText={i18n?.noMyDayTasks || "No tasks planned for today."}
        emptyAction={{ label: i18n?.aiPlanMyDay || "自动规划", onClick: runAiPlanMyDay }}
        scrollMode="none"
    >
        {#snippet toolbar()}
            <NaToolbar compact>
                <NaIconButton symbol="iconSparkles" label={i18n?.aiPlanMyDay || "自动规划"} onclick={runAiPlanMyDay} />
                <div class="na-dock-myday__add">
                    <NaSearchSelect
                        placeholder={i18n?.dockSearchAddTask || "搜索添加任务…"}
                        emptyText={i18n?.dockSearchHint || "输入关键词搜索任务"}
                        noMatchText={i18n?.noMatches || "无匹配结果"}
                        loadingText={i18n?.loadingMore || "加载中…"}
                        clearLabel={i18n?.clearSelection || "清除选择"}
                        removeLabel={i18n?.removeSelection || "移除选择"}
                        searchFn={searchTasksForAdd}
                        bind:selected={selectedTaskId}
                        onChange={handleSearchChange}
                    />
                </div>
                {#snippet actions()}<NaSegmentControl
                        size="sm"
                        options={[
                            { value: "timeline", label: i18n?.timelineMode || "时间线" },
                            { value: "list", label: i18n?.listMode || "列表" },
                        ]}
                        value={viewMode}
                        label={i18n?.settingMyDayDefaultViewMode || "Default View Mode"}
                        onChange={handleViewModeChange}
                    />{/snippet}
            </NaToolbar>
        {/snippet}

        {#if viewMode === "timeline"}
            <div class="na-dock-myday__timeline">
                {#if unscheduledEntries.length > 0}
                    <div class="na-dock-myday__unscheduled">
                        <div class="na-dock-myday__unscheduled-header">
                            <span>{i18n?.unscheduled || "Unscheduled"}</span>
                            <span class="na-dock-myday__unscheduled-count">{unscheduledEntries.length}</span>
                        </div>
                        {#each unscheduledEntries as entry (entry.blockId)}
                            {@const task = taskMap.get(entry.blockId)}
                            {#if task}
                                <div
                                    class="na-dock-myday__unscheduled-item"
                                    class:na-dock-myday__unscheduled-item--done={isMyDayEntryDone(entry, task.status)}
                                    class:na-dock-myday__unscheduled-item--critical={normalizePriority(
                                        task.priority,
                                    ) === "critical"}
                                    class:na-dock-myday__unscheduled-item--high={normalizePriority(task.priority) ===
                                        "high"}
                                    class:na-dock-myday__unscheduled-item--medium={normalizePriority(task.priority) ===
                                        "medium"}
                                    class:na-dock-myday__unscheduled-item--low={normalizePriority(task.priority) ===
                                        "low"}
                                    class:na-dock-myday__unscheduled-item--none={normalizePriority(task.priority) ===
                                        "none"}
                                    draggable="true"
                                    role="button"
                                    tabindex="0"
                                    ondragstart={(e) => handleDragStart(e, entry.blockId)}
                                    onclick={(event) => handleUnscheduledClick(event, task)}
                                    onkeydown={(event) => {
                                        if (event.key === "Enter" || event.key === " ") onEdit(task);
                                    }}
                                    oncontextmenu={(event) => handleContextMenu(task, event)}
                                >
                                    <span class="na-dock-myday__unscheduled-accent"></span>
                                    <span class="na-dock-myday__unscheduled-name"
                                        >{task.title || i18n?.untitled || "(untitled)"}</span
                                    >
                                    <span
                                        ><NaIconButton
                                            compact
                                            symbol="iconClose"
                                            label={i18n?.removeFromMyDay || "Remove from My Day"}
                                            tone="danger"
                                            onclick={() => handleRemoveFromMyDay(entry.blockId)}
                                        /></span
                                    >
                                </div>
                            {/if}
                        {/each}
                    </div>
                {/if}
                <div class="na-dock-myday__timeline-col">
                    <TimelineColumn
                        {scheduledEntries}
                        {taskMap}
                        {resetHour}
                        {defaultDuration}
                        {bridge}
                        {i18n}
                        {onContextMenu}
                    />
                </div>
            </div>
        {:else}
            <NaTaskList density="compact">
                {#each myDayTasks as task (task.blockId)}
                    <TaskCard
                        {task}
                        completedOverride={isMyDayEntryDone(myDayEntryMap.get(task.blockId), task.status)}
                        {onEdit}
                        {onStatusClick}
                        {onContextMenu}
                        {i18n}
                    />
                {/each}
            </NaTaskList>
        {/if}
    </NaViewShell>
</div>

<style lang="scss">
    .na-dock-myday {
        --na-dock-myday-panel-bg: var(--b3-theme-surface);
        --na-dock-myday-panel-border: var(--na-task-card-border, var(--b3-border-color));
        --na-dock-myday-panel-soft-bg: var(--na-task-card-child-bg, var(--b3-theme-surface-light));
        --na-myday-panel-bg: var(--na-dock-myday-panel-bg);
        --na-myday-panel-border: var(--na-dock-myday-panel-border);
        --na-myday-panel-soft-bg: var(--na-dock-myday-panel-soft-bg);
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--b3-theme-background);
    }

    .na-dock-myday__add {
        position: relative;
        flex: 1;
        min-width: 0;
    }

    :global(.na-toolbar .na-segment-control) {
        flex: 0 0 auto;
    }

    .na-dock-myday__timeline {
        position: relative;
        z-index: 1;
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: 0;
        gap: 8px;
        padding: 8px;
    }

    .na-dock-myday__unscheduled {
        flex-shrink: 0;
        padding: 8px;
        border: 1px solid var(--na-dock-myday-panel-border);
        border-radius: 8px;
        background: var(--na-dock-myday-panel-bg);
        max-height: 120px;
        overflow-y: auto;
    }

    .na-dock-myday__unscheduled-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 7px;
        color: var(--na-text-primary);
        font-size: 11px;
        font-weight: 700;
    }

    .na-dock-myday__unscheduled-count {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 20px;
        height: 18px;
        padding: 0 6px;
        border-radius: var(--na-radius-pill);
        color: var(--na-text-secondary);
        background: var(--na-task-card-meta-bg);
        border: 1px solid var(--na-task-card-meta-border);
        font-size: 10px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
    }

    .na-dock-myday__unscheduled-item {
        display: grid;
        grid-template-columns: 3px minmax(0, 1fr) 20px;
        align-items: center;
        gap: 7px;
        padding: 6px 7px 6px 0;
        margin-bottom: 6px;
        border: 1px solid var(--na-task-card-border, var(--b3-border-color));
        border-radius: 8px;
        background: var(--b3-theme-surface);
        box-shadow: var(--na-shadow-sm);
        cursor: grab;
        transition:
            background 0.15s,
            border-color 0.15s,
            box-shadow 0.15s,
            transform 0.15s;

        &:hover {
            background: var(--b3-theme-surface-light);
            border-color: var(--b3-theme-primary-light);
            box-shadow: var(--na-shadow-hover);
            transform: translateY(-1px);
        }

        &[draggable="true"]:active {
            cursor: grabbing;
        }
    }

    .na-dock-myday__unscheduled-item--done {
        background: var(--na-dock-myday-panel-soft-bg);

        .na-dock-myday__unscheduled-name {
            text-decoration: line-through;
        }
    }

    .na-dock-myday__unscheduled-accent {
        width: 3px;
        height: 100%;
        min-height: 20px;
        border-radius: var(--na-radius-pill);
        background: var(--na-dock-myday-unscheduled-accent, var(--b3-theme-primary));
    }

    .na-dock-myday__unscheduled-item--critical {
        --na-dock-myday-unscheduled-accent: var(--na-priority-critical);
    }
    .na-dock-myday__unscheduled-item--high {
        --na-dock-myday-unscheduled-accent: var(--na-priority-high);
    }
    .na-dock-myday__unscheduled-item--medium {
        --na-dock-myday-unscheduled-accent: var(--na-priority-medium);
    }
    .na-dock-myday__unscheduled-item--low,
    .na-dock-myday__unscheduled-item--none {
        --na-dock-myday-unscheduled-accent: var(--na-priority-low);
    }

    .na-dock-myday__unscheduled-name {
        font-size: 12px;
        font-weight: 650;
        color: var(--b3-theme-on-background);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
    }

    .na-dock-myday__timeline-col {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        border: 1px solid var(--na-dock-myday-panel-border);
        border-radius: 8px;
        overflow: hidden;
        background: var(--na-dock-myday-panel-bg);
    }

    :global(.na-task-list--compact .na-task-card__stats) {
        display: none;
    }
    :global(.na-task-list--compact .na-task-card__actions) {
        opacity: 1;
    }

    @container na-dock (max-width: 260px) {
        :global(.na-toolbar) {
            flex-wrap: wrap;
            padding: 7px 8px;
        }
        .na-dock-myday__add {
            order: 3;
            flex: 1 0 100%;
        }
        :global(.na-toolbar .na-segment-control) {
            margin-left: auto;
        }
        .na-dock-myday__timeline {
            padding: 6px;
            gap: 6px;
        }
        .na-dock-myday__unscheduled {
            padding: 6px;
        }
    }
</style>
