<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { useWorkspaceTasks, useWorkspace } from "../workspace-context";
    const taskStore = useWorkspaceTasks();
    const workspace = useWorkspace();
    const compact = workspace?.compact ?? false;
    let addSelection = $state("");
    async function searchAdd(query: string) {
        if (!query.trim()) return [];
        const ids = new Set(myDayEntries.map((entry) => entry.blockId));
        return $taskStore.allTasks
            .filter(
                (task) =>
                    !ids.has(task.blockId) &&
                    task.status !== "done" &&
                    task.status !== "someday" &&
                    task.title.toLowerCase().includes(query.toLowerCase()),
            )
            .slice(0, 10)
            .map((task) => ({ id: task.blockId, label: task.title }));
    }
    async function addToDay(value: string | string[]) {
        if (typeof value !== "string" || !value) return;
        try {
            taskStore.applyMyDayUpdate(await bridge.addTaskToMyDay(value));
            addSelection = "";
        } catch (error) {
            notifyOperationError(error, i18n);
        }
    }
    onDestroy(() => workspace?.session.remember("myDayMode", viewMode));
    import { VIEW_MY_DAY } from "../constants";
    import {
        DEFAULT_MY_DAY_RESET_HOUR,
        DEFAULT_MY_DAY_VIEW_MODE,
        DEFAULT_MY_DAY_DURATION,
    } from "../../shared/constants";
    import { applyFilters, DEFAULT_FILTER_STATE } from "../utils/filter";
    import type { FilterState } from "../utils/filter";
    import TaskCard from "./TaskCard.svelte";
    import NaSearchSelect from "../ui/NaSearchSelect.svelte";
    import NaAccordion from "../ui/NaAccordion.svelte";
    import NaIconButton from "../ui/NaIconButton.svelte";
    import { notifyOperationError } from "../notify";
    import NaButton from "../ui/NaButton.svelte";
    import NaMetricStrip from "../ui/NaMetricStrip.svelte";
    import NaSegmentControl from "../ui/NaSegmentControl.svelte";
    import NaTaskFilterBar from "../ui/NaTaskFilterBar.svelte";
    import NaTaskList from "../ui/NaTaskList.svelte";
    import NaToolbar from "../ui/NaToolbar.svelte";
    import NaViewShell from "../ui/NaViewShell.svelte";
    import TimelineView from "./timeline/TimelineView.svelte";
    import type { TaskCacheEntry } from "../../shared/types";
    import type { KernelBridge } from "../kernel-bridge";
    import { isMyDayEntryDone } from "../../shared/my-day";
    import { runAiPlanMyDay } from "../ai/ai-feature-service";

    interface Props {
        bridge: KernelBridge;
        onEdit: (task: TaskCacheEntry) => void;
        onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
        onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
        i18n: any;
        selectedTaskId?: string;
        onSelectTask?: ((task: TaskCacheEntry) => void) | undefined;
    }

    let {
        bridge,
        onEdit,
        onStatusClick,
        onContextMenu,
        i18n,
        selectedTaskId = "",
        onSelectTask = undefined,
    }: Props = $props();

    type ViewMode = "timeline" | "list";
    let viewMode: ViewMode = $state(
        workspace?.session.read("myDayMode", $taskStore.settings?.myDayDefaultViewMode ?? DEFAULT_MY_DAY_VIEW_MODE) ??
            DEFAULT_MY_DAY_VIEW_MODE,
    );

    let filterState = $derived($taskStore.filterByView[VIEW_MY_DAY] || DEFAULT_FILTER_STATE);
    let resetHour = $derived($taskStore.settings?.myDayResetHour ?? DEFAULT_MY_DAY_RESET_HOUR);
    let defaultDuration = $derived($taskStore.settings?.myDayDefaultDuration ?? DEFAULT_MY_DAY_DURATION);
    let myDayEntries = $derived($taskStore.myDayState?.tasks ?? []);
    let myDayEntryMap = $derived(new Map(myDayEntries.map((entry) => [entry.blockId, entry])));
    let scheduledCount = $derived(
        myDayEntries.filter((entry) => entry.scheduleStart !== null && entry.scheduleEnd !== null).length,
    );
    let unscheduledCount = $derived(myDayEntries.length - scheduledCount);
    let plannedMinutes = $derived(
        myDayEntries.reduce((sum, entry) => {
            if (entry.scheduleStart === null || entry.scheduleEnd === null) return sum;
            return sum + Math.max(0, entry.scheduleEnd - entry.scheduleStart);
        }, 0),
    );

    let myDayTasks = $derived(
        (() => {
            const state = $taskStore.myDayState;
            if (!state) return [];
            const taskMap = new Map<string, TaskCacheEntry>();
            for (const t of $taskStore.allTasks) {
                taskMap.set(t.blockId, t);
            }
            const result: TaskCacheEntry[] = [];
            for (const entry of state.tasks) {
                const task = taskMap.get(entry.blockId);
                if (task) result.push(task);
            }
            return result;
        })(),
    );

    let filteredTasks = $derived(applyFilters(myDayTasks, filterState, $taskStore.settings.customFields));

    let myDaySortOptions = $derived([
        { value: "order", label: i18n?.sortByOrder || "Comprehensive" },
        { value: "due", label: i18n?.sortByDue || "Due date" },
        { value: "importance", label: i18n?.sortByImportance || "Importance" },
    ]);

    function handleFilterChange(state: FilterState) {
        taskStore.setFilterState(VIEW_MY_DAY, state);
    }

    function handleViewModeChange(value: string) {
        viewMode = value as ViewMode;
    }

    function formatMinutes(minutes: number): string {
        if (minutes <= 0) return "0m";
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        if (hours === 0) return `${mins}m`;
        if (mins === 0) return `${hours}h`;
        return `${hours}h ${mins}m`;
    }

    onMount(() => {
        taskStore.loadMyDay();
    });

    let summaryItems = $derived([
        { value: myDayEntries.length, label: i18n?.myDayTotalShort || "Total" },
        { value: scheduledCount, label: i18n?.myDayScheduledShort || "Scheduled", tone: "success" as const },
        { value: unscheduledCount, label: i18n?.myDayUnscheduledShort || "Unscheduled", tone: "warning" as const },
        { value: formatMinutes(plannedMinutes), label: i18n?.myDayPlannedTime || "Planned", tone: "primary" as const },
    ]);
</script>

<div class="na-view na-view--myday">
    <NaViewShell
        loading={viewMode === "list" && $taskStore.loading}
        empty={viewMode === "list" && filteredTasks.length === 0}
        emptyText={i18n?.noMyDayTasks || "No tasks planned for today."}
        emptyAction={{ label: i18n?.aiPlanMyDay || "自动规划", onClick: runAiPlanMyDay }}
        hint={i18n?.viewHintMyDay}
        scrollMode="none"
    >
        {#snippet toolbar()}
            <NaToolbar>
            {#if compact}<div class="na-myday-add">
                    <NaSearchSelect
                        bind:selected={addSelection}
                        searchFn={searchAdd}
                        placeholder={i18n.dockSearchAddTask}
                        emptyText={i18n.dockSearchHint}
                        noMatchText={i18n.noMatches}
                        onChange={addToDay}
                    />
                </div>{/if}
                {#if !workspace?.touch}<NaMetricStrip items={summaryItems} />{/if}
                <div class="na-toolbar__actions-content">
                    <NaButton size="sm" icon="iconSparkles" onclick={runAiPlanMyDay}
                        >{i18n?.aiPlanMyDay || "自动规划"}</NaButton
                    >
                    <NaSegmentControl
                        size="sm"
                        options={[
                            { value: "timeline", label: i18n?.timelineMode || "Timeline" },
                            { value: "list", label: i18n?.listMode || "List" },
                        ]}
                        value={viewMode}
                        label={i18n?.settingMyDayDefaultViewMode || "Default View Mode"}
                        onChange={handleViewModeChange}
                    />
                </div>
            </NaToolbar>
            {#if viewMode === "list"}<NaTaskFilterBar
                    contexts={$taskStore.contexts}
                    tags={$taskStore.tags}
                    customFields={$taskStore.settings.customFields}
                    {filterState}
                    showStatus={true}
                    showPriority={true}
                    sortOptions={myDaySortOptions}
                    {i18n}
                    onChange={handleFilterChange}
                />{/if}
        {/snippet}
        {#if viewMode === "timeline"}
            <TimelineView {bridge} {i18n} {resetHour} {defaultDuration} {onContextMenu} />
        {:else}
            <NaTaskList>
                {#each filteredTasks as task (task.blockId)}
                    <TaskCard
                        {task}
                        completedOverride={isMyDayEntryDone(myDayEntryMap.get(task.blockId), task.status)}
                        selected={task.blockId === selectedTaskId}
                        onSelect={onSelectTask}
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
    .na-myday-add {
        padding: 8px 12px;
    }
    .na-myday-schedule-row {
        display: flex;
        align-items: center;
        padding: 4px 12px;
    }
    .na-myday-schedule-row button {
        flex: 1;
        text-align: start;
        min-height: 44px;
        border: 0;
        background: transparent;
        color: var(--na-text-primary);
        font: inherit;
    }

    .na-view--myday {
        --na-myday-panel-bg: var(--b3-theme-surface);
        --na-myday-panel-border: var(--na-task-card-border, var(--b3-border-color));
        --na-myday-panel-soft-bg: var(--na-task-card-child-bg, var(--b3-theme-surface-light));
        container-name: myday-view;
        container-type: inline-size;
        background: var(--b3-theme-surface);
    }
</style>
