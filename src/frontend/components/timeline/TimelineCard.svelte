<script lang="ts">
    import { useWorkspace } from "../../workspace-context";
    const workspace = useWorkspace();
    import {
        PIXELS_PER_MINUTE,
        MIN_SCHEDULE_DURATION,
        CLICK_THRESHOLD_PX,
        DAY_MINUTES,
    } from "../../../shared/constants";
    import type { MyDayTaskEntry, TaskCacheEntry, MyDayState } from "../../../shared/types";
    import type { KernelBridge } from "../../kernel-bridge";
    import { normalizePriority, PRIORITY_COLORS } from "../../constants";
    import { minuteToTimeLabel, minuteToPixel, snapMinute } from "./timeline-utils";
    import { showTaskQuickMenu } from "./TaskQuickMenu";
    import { notifyError, formatRpcError } from "../../notify";
    import { taskStore } from "../../stores/task-store";
    import { isMyDayEntryDone } from "../../../shared/my-day";

    interface Props {
        entry: MyDayTaskEntry;
        task: TaskCacheEntry;
        resetHour?: number;
        laneIndex?: number;
        laneCount?: number;
        containerWidth?: number;
        leftOffset?: number;
        bridge: KernelBridge;
        i18n: any;
        taskMap: Map<string, TaskCacheEntry>;
        onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
    }

    let {
        entry,
        task,
        resetHour = 5,
        laneIndex = 0,
        laneCount = 1,
        containerWidth = 0,
        leftOffset = 48,
        bridge,
        i18n,
        taskMap,
        onContextMenu,
    }: Props = $props();

    type DragMode = "none" | "move" | "resize-start" | "resize-end";

    let dragMode: DragMode = "none";
    let pointerId: number = -1;
    let originClientY: number = 0;
    let originStart: number = 0;
    let originEnd: number = 0;
    let previewStart: number = $state(0);
    let previewEnd: number = $state(0);
    let originClientX: number = 0;
    let previewOffsetX: number = $state(0);
    let isDragging: boolean = $state(false);
    let suppressClick = false;

    let duration = $derived((entry.scheduleEnd ?? 0) - (entry.scheduleStart ?? 0));
    let cardTop = $derived(minuteToPixel(entry.scheduleStart ?? 0));
    let cardHeight = $derived(minuteToPixel(duration));
    let cardWidth = $derived(laneCount > 0 ? containerWidth / laneCount - 4 : containerWidth);
    let cardLeft = $derived(leftOffset + laneIndex * (containerWidth / laneCount));
    let timeLabel = $derived(minuteToTimeLabel(entry.scheduleStart ?? 0, resetHour));
    let endTimeLabel = $derived(minuteToTimeLabel(entry.scheduleEnd ?? 0, resetHour));
    let displayPriority = $derived(normalizePriority(task.priority));
    let priorityColor = $derived(PRIORITY_COLORS[displayPriority] || "var(--b3-theme-primary)");
    let priorityClass = $derived(`na-timeline-card--priority-${displayPriority}`);
    let parentTitle = $derived(task.parentId ? (taskMap.get(task.parentId)?.title ?? "") : "");
    let tags = $derived(task.tags ? task.tags.split("|").filter(Boolean) : []);
    let isDone = $derived(isMyDayEntryDone(entry, task.status));

    // 卡片较短时隐藏次要信息
    let isCompact = $derived(cardHeight < 44);
    let isMinimal = $derived(cardHeight < 28);

    function formatDue(due: string | null | undefined): string {
        if (!due) return "";
        if (due.includes("T")) {
            const [datePart, timePart] = due.split("T");
            return `${datePart.slice(5)} ${timePart}`;
        }
        return due.slice(5);
    }

    let displayTop = $derived(isDragging ? minuteToPixel(previewStart) : cardTop);
    let displayHeight = $derived(isDragging ? minuteToPixel(previewEnd - previewStart) : cardHeight);
    let displayLeft = $derived(isDragging ? Math.max(0, cardLeft + 2 + previewOffsetX) : cardLeft + 2);
    let isRemoving = $derived(isDragging && previewOffsetX < -150);

    function handlePointerDown(e: PointerEvent, mode: DragMode) {
        if (e.pointerType !== "touch" && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        dragMode = mode;
        pointerId = e.pointerId;
        originClientY = e.clientY;
        originClientX = e.clientX;
        originStart = entry.scheduleStart ?? 0;
        originEnd = entry.scheduleEnd ?? 0;
        previewStart = originStart;
        previewEnd = originEnd;
        previewOffsetX = 0;
        isDragging = false;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }

    function handlePointerMove(e: PointerEvent) {
        if (dragMode === "none") return;
        const dy = e.clientY - originClientY;
        const dm = dy / PIXELS_PER_MINUTE;

        if (Math.abs(dy) > CLICK_THRESHOLD_PX || isDragging) {
            isDragging = true;
        }

        if (!isDragging) return;

        if (dragMode === "move") {
            const newStart = snapMinute(originStart + dm);
            const clampedStart = Math.max(0, Math.min(DAY_MINUTES - duration, newStart));
            previewStart = clampedStart;
            previewEnd = clampedStart + duration;
            previewOffsetX = e.clientX - originClientX;
        } else if (dragMode === "resize-start") {
            const newStart = snapMinute(originStart + dm);
            const maxStart = originEnd - MIN_SCHEDULE_DURATION;
            previewStart = Math.max(0, Math.min(maxStart, newStart));
            previewEnd = originEnd;
        } else if (dragMode === "resize-end") {
            const newEnd = snapMinute(originEnd + dm);
            const minEnd = originStart + MIN_SCHEDULE_DURATION;
            previewEnd = Math.min(DAY_MINUTES, Math.max(minEnd, newEnd));
            previewStart = originStart;
        }
    }

    function handlePointerUp(e: PointerEvent) {
        if (dragMode === "none") return;
        const currentMode = dragMode;
        dragMode = "none";

        if (!isDragging && workspace?.touch) {
            isDragging = false;
            return;
        }
        if (!isDragging) {
            showTaskQuickMenu(
                task,
                e.clientX,
                e.clientY,
                bridge,
                i18n,
                {
                    onScheduleRemoved: (newState: MyDayState) => {
                        taskStore.applyMyDayUpdate(newState);
                    },
                    onTaskUpdated: (updated: TaskCacheEntry) => {
                        taskStore.applyUpdate(updated);
                    },
                    onRemovedFromMyDay: (newState: MyDayState) => {
                        taskStore.applyMyDayUpdate(newState);
                    },
                },
                isDone,
            );
            isDragging = false;
            return;
        }

        suppressClick = true;
        isDragging = false;

        const elUnderPointer = document.elementFromPoint(e.clientX, e.clientY);
        const isOverUnscheduled = !!elUnderPointer?.closest(".na-unscheduled");

        if (isOverUnscheduled && currentMode === "move") {
            bridge
                .removeMyDaySchedule(entry.blockId)
                .then((newState) => taskStore.applyMyDayUpdate(newState))
                .catch((err) => notifyError(formatRpcError(err, i18n)));
        } else if (previewStart !== originStart || previewEnd !== originEnd) {
            bridge
                .setMyDaySchedule(entry.blockId, previewStart, previewEnd)
                .then((newState) => taskStore.applyMyDayUpdate(newState))
                .catch((err) => notifyError(formatRpcError(err, i18n)));
        }
    }

    function handleCardKeydown(event: KeyboardEvent): void {
        if (workspace?.touch && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            workspace.openTask?.(task);
            return;
        }
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            onContextMenu(task, new MouseEvent("contextmenu"));
        }
    }

    function handleContextMenu(event: MouseEvent): void {
        event.preventDefault();
        onContextMenu(task, event);
    }

    function openQuickMenu(event: MouseEvent) {
        showTaskQuickMenu(task, event.clientX, event.clientY, bridge, i18n, {
            onScheduleRemoved: (newState: MyDayState) => taskStore.applyMyDayUpdate(newState),
            onTaskUpdated: (updated: TaskCacheEntry) => taskStore.applyUpdate(updated),
            onRemovedFromMyDay: (newState: MyDayState) => taskStore.applyMyDayUpdate(newState),
        }, isDone);
    }

    function handleResizePointerDown(event: PointerEvent, mode: "resize-start" | "resize-end"): void {
        event.stopPropagation();
        handlePointerDown(event, mode);
    }
</script>

<div
    class="na-timeline-card {priorityClass}"
    class:na-timeline-card--touch={workspace?.touch}
    onclick={(event) => {
        if (suppressClick) { suppressClick = false; return; }
        if (workspace?.touch) openQuickMenu(event);
    }}
    ondblclick={(event) => {
        if (!workspace?.touch) return;
        event.preventDefault();
        workspace.openTask?.(task);
    }}
    class:na-timeline-card--dragging={isDragging}
    class:na-timeline-card--removing={isRemoving}
    class:na-timeline-card--compact={isCompact}
    class:na-timeline-card--minimal={isMinimal}
    class:na-timeline-card--done={isDone}
    style="top: {displayTop}px; height: {displayHeight}px; left: {displayLeft}px; width: {cardWidth}px; --na-timeline-card-accent: {priorityColor};"
    role="button"
    tabindex="0"
    onpointerdown={(e) => handlePointerDown(e, "move")}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    oncontextmenu={handleContextMenu}
    onkeydown={handleCardKeydown}
>
    <div
        class="na-timeline-card__handle na-timeline-card__handle--top"
        role="separator"
        onpointerdown={(event) => handleResizePointerDown(event, "resize-start")}
    ></div>

    <div class="na-timeline-card__content">
        {#if !isMinimal}
            <div class="na-timeline-card__header">
                {#if parentTitle}
                    <span class="na-timeline-card__parent">{parentTitle}</span>
                    <span class="na-timeline-card__sep">/</span>
                {/if}
                <span class="na-timeline-card__time">{timeLabel} - {endTimeLabel}</span>
            </div>
        {/if}
        <span class="na-timeline-card__name">
            {#if isMinimal}{timeLabel}
            {/if}{task.title}
        </span>
        {#if !isCompact}
            <div class="na-timeline-card__footer">
                {#if task.context}
                    <span class="na-timeline-card__chip na-timeline-card__chip--context"
                        >@{task.context.split("|")[0].trim()}</span
                    >
                {/if}
                {#each tags as tag}
                    <span class="na-timeline-card__chip">#{tag}</span>
                {/each}
                {#if task.due}
                    <span class="na-timeline-card__chip na-timeline-card__chip--due">{formatDue(task.due)}</span>
                {/if}
            </div>
        {/if}
    </div>

    <div
        class="na-timeline-card__handle na-timeline-card__handle--bottom"
        role="separator"
        onpointerdown={(event) => handleResizePointerDown(event, "resize-end")}
    ></div>
</div>

<style lang="scss">
    .na-timeline-card--touch {
        touch-action: none !important;
    }
    .na-timeline-card--touch .na-timeline-card__handle {
        display: none;
    }

    .na-timeline-card {
        position: absolute;
        border-radius: 8px;
        border: 1px solid var(--na-task-card-border, var(--b3-border-color));
        background-color: var(--na-timeline-card-bg, var(--b3-theme-surface));
        box-shadow:
            inset 3px 0 0 var(--na-timeline-card-accent, var(--b3-theme-primary)),
            var(--na-shadow-sm);
        cursor: grab;
        user-select: none;
        touch-action: none;
        overflow: hidden;
        z-index: 12;
        transition:
            background 0.15s,
            border-color 0.15s,
            box-shadow 0.15s,
            opacity 0.15s,
            transform 0.15s;

        &:hover {
            background: var(--b3-theme-surface-light);
            border-color: var(--b3-theme-primary-light);
            box-shadow:
                inset 3px 0 0 var(--na-timeline-card-accent, var(--b3-theme-primary)),
                var(--na-shadow-hover);
        }
    }

    // ===== 优先级背景 =====
    .na-timeline-card--priority-critical {
        --na-timeline-card-bg: var(--na-priority-bg-critical);
    }

    .na-timeline-card--priority-high {
        --na-timeline-card-bg: var(--na-priority-bg-high);
    }

    .na-timeline-card--priority-medium {
        --na-timeline-card-bg: var(--na-priority-bg-medium);
    }

    .na-timeline-card--priority-low {
        --na-timeline-card-bg: var(--na-priority-bg-low);
    }

    .na-timeline-card--priority-veryLow,
    .na-timeline-card--priority-none {
        --na-timeline-card-bg: var(--b3-theme-surface);
    }

    // ===== 拖拽状态 =====
    .na-timeline-card--dragging {
        z-index: 20;
        box-shadow:
            inset 3px 0 0 var(--na-timeline-card-accent, var(--b3-theme-primary)),
            var(--na-shadow-dialog);
        opacity: 0.9;
    }

    .na-timeline-card--removing {
        opacity: 0.45;
        transform: scale(0.96);
    }

    .na-timeline-card--done {
        background-color: var(--na-myday-panel-soft-bg, var(--b3-theme-surface-light));

        .na-timeline-card__name {
            text-decoration: line-through;
        }

        .na-timeline-card__chip,
        .na-timeline-card__time,
        .na-timeline-card__parent,
        .na-timeline-card__sep {
            color: var(--na-text-secondary);
        }
    }

    // ===== 紧凑/极简模式 =====
    .na-timeline-card--compact .na-timeline-card__content {
        padding: 3px 7px 3px 9px;
        gap: 0;
    }

    .na-timeline-card--minimal .na-timeline-card__content {
        padding: 2px 7px 2px 9px;
        gap: 0;
    }

    // ===== Resize 手柄 =====
    .na-timeline-card__handle {
        position: absolute;
        left: 0;
        right: 0;
        height: 5px;
        cursor: ns-resize;
        z-index: 2;

        &--top {
            top: 0;
        }
        &--bottom {
            bottom: 0;
        }

        &:hover {
            background: var(--na-color-info-bg);
        }
    }

    // ===== 内容区 =====
    .na-timeline-card__content {
        display: flex;
        flex-direction: column;
        gap: 3px;
        padding: 6px 8px 5px 10px;
        overflow: hidden;
        pointer-events: none;
    }

    // ===== 顶部：父任务 + 时间 =====
    .na-timeline-card__header {
        display: flex;
        align-items: baseline;
        gap: 4px;
        overflow: hidden;
        line-height: 1.3;
    }

    .na-timeline-card__parent {
        font-size: 10px;
        color: var(--na-card-text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex-shrink: 1;
        min-width: 0;
    }

    .na-timeline-card__sep {
        font-size: 10px;
        color: var(--na-card-text-secondary);
        margin: 0 1px;
        flex-shrink: 0;
    }

    .na-timeline-card__time {
        display: inline-flex;
        align-items: center;
        min-height: 15px;
        padding: 0 5px;
        border-radius: var(--na-radius-pill);
        background: var(--na-task-card-meta-bg, var(--b3-theme-surface-light));
        border: 1px solid var(--na-task-card-meta-border, var(--b3-border-color));
        font-size: 10px;
        font-weight: 650;
        color: var(--na-text-secondary);
        font-variant-numeric: tabular-nums;
        flex-shrink: 0;
    }

    // ===== 中间：任务标题 =====
    .na-timeline-card__name {
        font-size: 12px;
        font-weight: 650;
        color: var(--b3-theme-on-background);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        line-height: 1.35;
    }

    .na-timeline-card--minimal .na-timeline-card__name {
        font-size: 11px;
        line-height: 1.3;
    }

    // ===== 底部：上下文/标签/日期 =====
    .na-timeline-card__footer {
        display: flex;
        gap: 3px;
        align-items: center;
        flex-wrap: wrap;
        overflow: hidden;
        margin-top: 1px;
    }

    .na-timeline-card__chip {
        font-size: 9px;
        color: var(--na-text-secondary);
        white-space: nowrap;
        padding: 0 5px;
        border-radius: var(--na-radius-pill);
        background: var(--na-task-card-meta-bg, var(--b3-theme-surface-light));
        border: 1px solid var(--na-task-card-meta-border, var(--b3-border-color));
        line-height: 1.5;

        &--context {
            color: var(--na-priority-medium);
            background: var(--na-color-info-bg);
            border-color: var(--na-color-info-border);
        }

        &--due {
            color: var(--na-priority-high);
            background: var(--na-color-warning-bg);
            border-color: var(--na-color-warning-border);
        }
    }
</style>
