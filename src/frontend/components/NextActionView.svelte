<script lang="ts">
    import { useWorkspaceTasks } from "../workspace-context";
    const taskStore = useWorkspaceTasks();
    import { VIEW_NEXT_ACTION } from "../constants";
    import { applyFilters, DEFAULT_FILTER_STATE, isNextActionCandidate } from "../utils/filter";
    import type { FilterState } from "../utils/filter";
    import TaskCard from "./TaskCard.svelte";
    import NaAccordion from "../ui/NaAccordion.svelte";
    import NaTaskFilterBar from "../ui/NaTaskFilterBar.svelte";
    import NaTaskList from "../ui/NaTaskList.svelte";
    import NaViewShell from "../ui/NaViewShell.svelte";
    import type { TaskCacheEntry } from "../../shared/types";

    interface Props {
        onEdit: (task: TaskCacheEntry) => void;
        onStatusClick: (task: TaskCacheEntry, event: MouseEvent) => void;
        onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
        i18n: any;
        selectedTaskId?: string;
        onSelectTask?: ((task: TaskCacheEntry) => void) | undefined;
    }

    let { onEdit, onStatusClick, onContextMenu, i18n, selectedTaskId = "", onSelectTask = undefined }: Props = $props();

    let filterState = $derived($taskStore.filterByView[VIEW_NEXT_ACTION] || DEFAULT_FILTER_STATE);
    let nextActionTasks = $derived(
        $taskStore.allTasks.filter((t) =>
            isNextActionCandidate(t, $taskStore.settings.priorityEngine.startPreviewDays),
        ),
    );
    let filteredTasks = $derived(applyFilters(nextActionTasks, filterState, $taskStore.settings.customFields));

    function handleFilterChange(state: FilterState) {
        taskStore.setFilterState(VIEW_NEXT_ACTION, state);
    }
</script>

<NaViewShell
    loading={$taskStore.loading}
    empty={filteredTasks.length === 0 && (!$taskStore.projectReminders || $taskStore.projectReminders.length === 0)}
    emptyText={$taskStore.error || i18n?.noResults || i18n?.noTasks || "No tasks yet"}
    hint={i18n?.viewHintNextAction}
>
    {#snippet toolbar()}<NaTaskFilterBar
            contexts={$taskStore.contexts}
            tags={$taskStore.tags}
            customFields={$taskStore.settings.customFields}
            {filterState}
            showStatus={false}
            {i18n}
            onChange={handleFilterChange}
        />{/snippet}
    <NaTaskList>
        {#each filteredTasks as task (task.blockId)}
            <TaskCard
                blockRefDragEnabled={true}
                {task}
                selected={task.blockId === selectedTaskId}
                onSelect={onSelectTask}
                {onEdit}
                {onStatusClick}
                {onContextMenu}
                {i18n}
            />
        {/each}

        {#if $taskStore.projectReminders && $taskStore.projectReminders.length > 0}
            <NaAccordion
                title={i18n?.projectReminders || "Projects to Close"}
                count={$taskStore.projectReminders.length}
                open={true}
                variant="plain"
            >
                {#each $taskStore.projectReminders as project (project.blockId)}
                    <TaskCard
                        blockRefDragEnabled={true}
                        task={project}
                        {onEdit}
                        {onStatusClick}
                        {onContextMenu}
                        {i18n}
                    />
                {/each}
            </NaAccordion>
        {/if}
    </NaTaskList>
</NaViewShell>
