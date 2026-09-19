<script lang="ts">
    import { onMount } from "svelte";
    import { useWorkspace } from "../../workspace-context";
    import NaOptionPicker from "../../ui/NaOptionPicker.svelte";
    import { PIXELS_PER_MINUTE, TIMELINE_SLOT_MINUTES, DAY_MINUTES, MY_DAY_DRAG_TYPE } from "../../../shared/constants";
    import type { MyDayTaskEntry, TaskCacheEntry, MyDayState } from "../../../shared/types";
    import type { KernelBridge } from "../../kernel-bridge";
    import { taskStore } from "../../stores/task-store";
    import { notifyError, formatRpcError } from "../../notify";
    import {
        minuteToPixel,
        pixelToSnappedMinute,
        computeLaneLayouts,
        generateTimelineSlots,
        minuteToTimeLabel,
        getCurrentMinuteOffset,
    } from "./timeline-utils";
    import TimelineCard from "./TimelineCard.svelte";
    import TimelineNeedle from "./TimelineNeedle.svelte";

    interface Props {
        scheduledEntries?: MyDayTaskEntry[];
        taskMap: Map<string, TaskCacheEntry>;
        resetHour?: number;
        defaultDuration?: number;
        bridge: KernelBridge;
        i18n: any;
        onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
    }

    let {
        scheduledEntries = [],
        taskMap,
        resetHour = 5,
        defaultDuration = 60,
        bridge,
        i18n,
        onContextMenu,
    }: Props = $props();
    const workspace = useWorkspace();

    let containerEl: HTMLElement | null = $state(null);
    let containerWidth: number = $state(300);
    const LABEL_AREA_WIDTH = 48;
    let isDragOver: boolean = $state(false);
    let dragPreviewStart: number | null = $state(null);
    let dragPreviewEnd: number | null = $state(null);
    let addMinute: number | null = $state(null);
    let addBusy = $state(false);
    let addError = $state("");
    let addTimer: ReturnType<typeof setTimeout> | null = null;
    let addPointer: { id: number; x: number; y: number } | null = null;

    let totalHeight = $derived(DAY_MINUTES * PIXELS_PER_MINUTE);
    let laneLayouts = $derived(computeLaneLayouts(scheduledEntries));
    let slots = $derived(generateTimelineSlots(resetHour, TIMELINE_SLOT_MINUTES));

    let addOptions = $derived.by(() => {
        const entries = new Map(($taskStore.myDayState?.tasks ?? []).map((entry) => [entry.blockId, entry]));
        return $taskStore.allTasks
            .filter((task) => {
                const entry = entries.get(task.blockId);
                return (
                    task.status !== "done" &&
                    task.status !== "someday" &&
                    !entry?.completedAt &&
                    (!entry || entry.scheduleStart === null || entry.scheduleEnd === null)
                );
            })
            .sort((a, b) => Number(entries.has(b.blockId)) - Number(entries.has(a.blockId)))
            .map((task) => ({ id: task.blockId, label: task.title || i18n.untitled }));
    });

    async function addTaskAtMinute(value: string | string[]) {
        const blockId = typeof value === "string" ? value : "";
        if (!blockId || addMinute === null || addBusy) return;
        const start = addMinute;
        addBusy = true;
        addError = "";
        try {
            if (!$taskStore.myDayState?.tasks.some((entry) => entry.blockId === blockId)) {
                taskStore.applyMyDayUpdate(await bridge.addTaskToMyDay(blockId));
            }
            const state = await bridge.setMyDaySchedule(blockId, start, Math.min(DAY_MINUTES, start + defaultDuration));
            taskStore.applyMyDayUpdate(state);
            addMinute = null;
        } catch (err: any) {
            addError = formatRpcError(err, i18n);
        } finally {
            addBusy = false;
        }
    }

    function clearAddGesture() {
        if (addTimer) clearTimeout(addTimer);
        addTimer = null;
        addPointer = null;
    }

    function openAddAt(clientY: number) {
        if (!containerEl || !workspace?.touch) return;
        const rect = containerEl.getBoundingClientRect();
        const offset = clientY - rect.top + containerEl.scrollTop;
        addMinute = Math.max(0, Math.min(DAY_MINUTES - defaultDuration, pixelToSnappedMinute(offset)));
        addError = "";
    }

    function handleBlankPointerDown(event: PointerEvent) {
        const target = event.target as HTMLElement;
        const card = target.closest(".na-timeline-card")?.getBoundingClientRect();
        // Mobile browsers can retarget a tap in empty space to a nearby clickable card.
        const hitsCard =
            card &&
            event.clientX >= card.left &&
            event.clientX <= card.right &&
            event.clientY >= card.top &&
            event.clientY <= card.bottom;
        if (
            !workspace?.touch ||
            !containerEl ||
            addBusy ||
            (!event.isPrimary && event.pointerType === "touch") ||
            (event.pointerType !== "touch" && event.button !== 0) ||
            hitsCard ||
            target.closest(".na-timeline-slot, .na-timeline-card__tools, button") ||
            event.clientX < containerEl.getBoundingClientRect().left + LABEL_AREA_WIDTH
        )
            return;
        clearAddGesture();
        addPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
        addTimer = setTimeout(() => {
            if (addPointer) openAddAt(addPointer.y);
            clearAddGesture();
        }, 450);
    }

    function handleBlankPointerMove(event: PointerEvent) {
        if (!addPointer || event.pointerId !== addPointer.id) return;
        if (Math.hypot(event.clientX - addPointer.x, event.clientY - addPointer.y) > 10) clearAddGesture();
    }

    function handleBlankPointerUp(event: PointerEvent) {
        if (!addPointer || event.pointerId !== addPointer.id) return;
        clearAddGesture();
    }

    function handleDragOver(e: DragEvent) {
        e.preventDefault();
        if (!e.dataTransfer?.types.includes(MY_DAY_DRAG_TYPE)) return;
        e.dataTransfer.dropEffect = "move";
        isDragOver = true;

        if (containerEl && e.clientY !== 0) {
            const rect = containerEl.getBoundingClientRect();
            const offsetY = e.clientY - rect.top + containerEl.scrollTop;
            const snapped = pixelToSnappedMinute(offsetY);
            dragPreviewStart = Math.max(0, Math.min(DAY_MINUTES - defaultDuration, snapped));
            dragPreviewEnd = dragPreviewStart + defaultDuration;
        }

        if (containerEl) {
            const rect = containerEl.getBoundingClientRect();
            const edgeZone = 40;
            if (e.clientY - rect.top < edgeZone) {
                containerEl.scrollTop -= 10;
            } else if (rect.bottom - e.clientY < edgeZone) {
                containerEl.scrollTop += 10;
            }
        }
    }

    function handleDragLeave() {
        isDragOver = false;
        dragPreviewStart = null;
        dragPreviewEnd = null;
    }

    async function handleDrop(e: DragEvent) {
        e.preventDefault();
        isDragOver = false;
        if (!e.dataTransfer?.types.includes(MY_DAY_DRAG_TYPE)) return;

        const blockId = e.dataTransfer.getData(MY_DAY_DRAG_TYPE);
        if (!blockId || dragPreviewStart === null) return;

        try {
            const newState = await bridge.setMyDaySchedule(blockId, dragPreviewStart, dragPreviewEnd!);
            taskStore.applyMyDayUpdate(newState);
        } catch (err: any) {
            console.error("[NextAction] setMyDaySchedule failed:", err);
            notifyError(formatRpcError(err, i18n));
        }
        dragPreviewStart = null;
        dragPreviewEnd = null;
    }

    function scrollToCurrentTime() {
        if (!containerEl) return;
        const currentOffset = getCurrentMinuteOffset(resetHour);
        const targetTop = minuteToPixel(currentOffset) - containerEl.clientHeight / 2;
        containerEl.scrollTop = Math.max(0, targetTop);
    }

    onMount(() => {
        const initialScroll = setTimeout(scrollToCurrentTime, 100);
        if (containerEl) {
            const resizeObserver = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    containerWidth = entry.contentRect.width - LABEL_AREA_WIDTH;
                }
            });
            resizeObserver.observe(containerEl);
            return () => {
                resizeObserver.disconnect();
                clearTimeout(initialScroll);
                clearAddGesture();
            };
        }
    });
</script>

<div
    class="na-timeline-column"
    bind:this={containerEl}
    role="region"
    aria-label={i18n?.timelineMode || "Timeline"}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
    onpointerdown={handleBlankPointerDown}
    onpointermove={handleBlankPointerMove}
    onpointerup={handleBlankPointerUp}
    onpointercancel={clearAddGesture}
    onscroll={clearAddGesture}
    oncontextmenu={(event) => {
        if (workspace?.touch) event.preventDefault();
    }}
>
    <div class="na-timeline-column__body" style="height: {totalHeight}px; position: relative;">
        {#each slots as slot (slot.minute)}
            <div
                class="na-timeline-slot"
                class:na-timeline-slot--major={slot.isMajor}
                style="top: {minuteToPixel(slot.minute)}px"
            >
                {#if slot.isMajor}
                    <span class="na-timeline-slot__label">{slot.label}</span>
                {/if}
            </div>
        {/each}

        {#if isDragOver && dragPreviewStart !== null && dragPreviewEnd !== null}
            <div
                class="na-timeline-preview"
                style="top: {minuteToPixel(dragPreviewStart)}px; height: {minuteToPixel(
                    dragPreviewEnd - dragPreviewStart,
                )}px;"
            >
                <span class="na-timeline-preview__time">
                    {minuteToTimeLabel(dragPreviewStart, resetHour)} - {minuteToTimeLabel(dragPreviewEnd, resetHour)}
                </span>
            </div>
        {/if}

        {#each scheduledEntries as entry (entry.blockId)}
            {@const task = taskMap.get(entry.blockId)}
            {@const layout = laneLayouts.get(entry.blockId)}
            {#if task && layout}
                <TimelineCard
                    {entry}
                    {task}
                    {resetHour}
                    laneIndex={layout.laneIndex}
                    laneCount={layout.laneCount}
                    {containerWidth}
                    leftOffset={LABEL_AREA_WIDTH}
                    {bridge}
                    {i18n}
                    {taskMap}
                    {onContextMenu}
                />
            {/if}
        {/each}

        <TimelineNeedle {resetHour} containerHeight={totalHeight} />
    </div>
</div>

{#if addMinute !== null}
    <NaOptionPicker
        title={`${i18n.scheduleTask} ${minuteToTimeLabel(addMinute, resetHour)} - ${minuteToTimeLabel(addMinute + defaultDuration, resetHour)}`}
        options={addOptions}
        searchLabel={i18n.dockSearchAddTask}
        emptyText={i18n.noMatches}
        closeLabel={i18n.cancel}
        busy={addBusy}
        error={addError}
        onSelect={addTaskAtMinute}
        onClose={() => {
            if (!addBusy) addMinute = null;
        }}
    />
{/if}

<style lang="scss">
    .na-timeline-column {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        position: relative;
        background: var(--b3-theme-background);
    }

    .na-timeline-column__body {
        position: relative;
    }

    .na-timeline-slot {
        position: absolute;
        left: 48px;
        right: 0;
        height: 1px;
        background: var(--na-task-card-meta-border, var(--b3-border-color));

        &--major {
            background: var(--na-myday-panel-border, var(--b3-border-color));
        }
    }

    .na-timeline-slot__label {
        position: absolute;
        right: calc(100% + 6px);
        top: -7px;
        width: 40px;
        text-align: right;
        font-size: 11px;
        color: var(--na-text-secondary);
        pointer-events: none;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
    }

    .na-timeline-preview {
        position: absolute;
        left: 52px;
        right: 4px;
        background: var(--na-color-info-bg);
        border: 1px dashed var(--b3-theme-primary);
        border-radius: 8px;
        z-index: 15;
        pointer-events: none;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: inset 3px 0 0 var(--b3-theme-primary);
    }

    .na-timeline-preview__time {
        font-size: 11px;
        color: var(--na-text-interactive);
        font-weight: 650;
        padding: 2px 8px;
        border-radius: var(--na-radius-pill);
        background: var(--b3-theme-surface);
        border: 1px solid var(--na-task-card-meta-border, var(--b3-border-color));
    }
</style>
