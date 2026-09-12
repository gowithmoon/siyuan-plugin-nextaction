<script lang="ts">
    import { useWorkspace } from "../../workspace-context";
    import NaAccordion from "../../ui/NaAccordion.svelte";
    const compact = useWorkspace()?.compact ?? false;
    import { onMount } from "svelte";
    import { RESPONSIVE_BREAKPOINT, MY_DAY_DRAG_TYPE } from "../../../shared/constants";
    import type { MyDayTaskEntry, TaskCacheEntry, MyDayState } from "../../../shared/types";
    import type { KernelBridge } from "../../kernel-bridge";
    import { taskStore } from "../../stores/task-store";
    import UnscheduledPanel from "./UnscheduledPanel.svelte";
    import TimelineColumn from "./TimelineColumn.svelte";

    interface Props {
        bridge: KernelBridge;
        i18n: any;
        resetHour?: number;
        defaultDuration?: number;
        onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
    }

    let { bridge, i18n, resetHour = 5, defaultDuration = 60, onContextMenu }: Props = $props();

    let containerWidth: number = 600;
    let containerEl: HTMLElement | null = $state(null);
    let isNarrow: boolean = $state(false);
    let dropTargetActive: boolean = $state(false);

    let myDayState = $derived($taskStore.myDayState);
    let allTasks = $derived($taskStore.allTasks);
    let taskMap = $derived(
        new Map<string, TaskCacheEntry>(allTasks.map((t) => [t.blockId, t] as [string, TaskCacheEntry])),
    );

    let unscheduledEntries = $derived(
        (myDayState?.tasks ?? []).filter((e) => e.scheduleStart === null || e.scheduleEnd === null),
    );
    let scheduledEntries = $derived(
        (myDayState?.tasks ?? []).filter((e) => e.scheduleStart !== null && e.scheduleEnd !== null),
    );

    function handleDragOver(e: DragEvent) {
        if (!e.dataTransfer?.types.includes(MY_DAY_DRAG_TYPE)) return;
        e.preventDefault();
        dropTargetActive = true;
    }

    function handleDragLeave() {
        dropTargetActive = false;
    }

    async function handleDropOnUnscheduled(e: DragEvent) {
        e.preventDefault();
        dropTargetActive = false;
        if (!e.dataTransfer?.types.includes(MY_DAY_DRAG_TYPE)) return;
        const blockId = e.dataTransfer.getData(MY_DAY_DRAG_TYPE);
        if (!blockId) return;
        try {
            const newState = await bridge.removeMyDaySchedule(blockId);
            taskStore.applyMyDayUpdate(newState);
        } catch (err: any) {
            console.error("[NextAction] removeMyDaySchedule failed:", err);
        }
    }

    onMount(() => {
        if (containerEl) {
            const observer = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    containerWidth = entry.contentRect.width;
                    isNarrow = containerWidth < RESPONSIVE_BREAKPOINT;
                }
            });
            observer.observe(containerEl);
            return () => observer.disconnect();
        }
    });
</script>

<div
    class="na-timeline-view"
    class:na-timeline-view--narrow={compact || isNarrow}
    class:na-timeline-view--compact={compact}
    bind:this={containerEl}
>
    {#if compact || isNarrow}
        <div class="na-timeline-view__top">
            {#snippet unscheduledContent()}
                <UnscheduledPanel
                    {unscheduledEntries}
                    {taskMap}
                    {bridge}
                    {i18n}
                    {onContextMenu}
                    horizontal={!compact}
                    isDropTarget={dropTargetActive}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDropOnUnscheduled}
                />
            {/snippet}
            {#if compact}<NaAccordion title={i18n.unscheduled} count={unscheduledEntries.length} open={true}
                    >{@render unscheduledContent()}</NaAccordion
                >{:else}{@render unscheduledContent()}{/if}
        </div>
        <div class="na-timeline-view__bottom">
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
    {:else}
        <div class="na-timeline-view__left">
            <UnscheduledPanel
                {unscheduledEntries}
                {taskMap}
                {bridge}
                {i18n}
                {onContextMenu}
                isDropTarget={dropTargetActive}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDropOnUnscheduled}
            />
        </div>
        <div class="na-timeline-view__right">
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
    {/if}
</div>

<style lang="scss">
    .na-timeline-view {
        display: flex;
        height: 100%;
        overflow: hidden;
        gap: 10px;
        padding: 10px;
        background: transparent;
    }

    .na-timeline-view--narrow {
        flex-direction: column;
    }

    .na-timeline-view--compact .na-timeline-view__top {
        height: auto;
        max-height: 40%;
        overflow-y: auto;
    }
    .na-timeline-view__left {
        width: 236px;
        flex-shrink: 0;
        height: 100%;
        border: 1px solid var(--na-myday-panel-border, var(--b3-border-color));
        border-radius: 8px;
        overflow: hidden;
        background: var(--na-myday-panel-bg, var(--b3-theme-surface));
    }

    .na-timeline-view__right {
        flex: 1;
        min-width: 0;
        height: 100%;
        display: flex;
        flex-direction: column;
        border: 1px solid var(--na-myday-panel-border, var(--b3-border-color));
        border-radius: 8px;
        overflow: hidden;
        background: var(--na-myday-panel-bg, var(--b3-theme-surface));
    }

    .na-timeline-view__top {
        width: 100%;
        height: 148px;
        flex-shrink: 0;
        border: 1px solid var(--na-myday-panel-border, var(--b3-border-color));
        border-radius: 8px;
        overflow: hidden;
        background: var(--na-myday-panel-bg, var(--b3-theme-surface));
    }

    .na-timeline-view__bottom {
        width: 100%;
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        border: 1px solid var(--na-myday-panel-border, var(--b3-border-color));
        border-radius: 8px;
        overflow: hidden;
        background: var(--na-myday-panel-bg, var(--b3-theme-surface));
    }
</style>
