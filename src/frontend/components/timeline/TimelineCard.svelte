<script lang="ts">
    import { onDestroy } from "svelte";
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
    import NaIconButton from "../../ui/NaIconButton.svelte";
    import NaDragHandle from "../../ui/NaDragHandle.svelte";

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

    let dragMode: DragMode = $state("none");
    let pointerId: number = -1;
    let originClientY: number = 0;
    let originStart: number = 0;
    let originEnd: number = 0;
    let previewStart: number = $state(0);
    let previewEnd: number = $state(0);
    let originClientX: number = 0;
    let previewOffsetX: number = $state(0);
    let isDragging: boolean = $state(false);
    let cardElement: HTMLDivElement;
    let toolsOpen = $state(false);
    let toolsAbove = $state(false);
    let toolsLeft = $state(0);
    let saving = $state(false);
    let timeline: HTMLElement | null = null;
    let captureElement: HTMLElement | null = null;
    let previousOverflow = "";
    let originScroll = 0;
    let currentY = 0;
    let frame = 0;
    let suppressClickUntil = 0;
    let pressTimer: ReturnType<typeof setTimeout> | null = null;
    let press: { id: number; x: number; y: number } | null = null;
    let pressTimeline: HTMLElement | null = null;
    let contextOpenedForPress = false;

    function clearPress() {
        if (pressTimer !== null) clearTimeout(pressTimer);
        pressTimer = null;
        press = null;
        pressTimeline?.removeEventListener("scroll", clearPress);
        pressTimeline = null;
    }

    function beginPress(event: PointerEvent) {
        if (
            event.pointerType !== "touch" ||
            !event.isPrimary ||
            saving ||
            (event.target as HTMLElement).closest("button, .na-timeline-card__tools")
        )
            return;
        const rect = cardElement.getBoundingClientRect();
        if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
        )
            return;
        clearPress();
        contextOpenedForPress = false;
        press = { id: event.pointerId, x: event.clientX, y: event.clientY };
        pressTimeline = cardElement.closest<HTMLElement>(".na-timeline-column");
        pressTimeline?.addEventListener("scroll", clearPress);
        pressTimer = setTimeout(() => {
            if (!press) return;
            const { x, y } = press;
            clearPress();
            openTouchContextMenu(new MouseEvent("contextmenu", { clientX: x, clientY: y }));
        }, 450);
    }

    function openTouchContextMenu(event: MouseEvent) {
        clearPress();
        if (contextOpenedForPress) return;
        contextOpenedForPress = true;
        suppressClickUntil = Date.now() + 700;
        toolsOpen = false;
        onContextMenu(task, event);
    }

    function releaseGesture() {
        dragMode = "none";
        cancelAnimationFrame(frame);
        frame = 0;
        if (timeline) {
            timeline.removeEventListener("scroll", updatePreview);
            if (workspace?.touch) timeline.style.overflowY = previousOverflow;
        }
        timeline = null;
        const element = captureElement;
        captureElement = null;
        if (element?.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
        pointerId = -1;
    }

    function cancelGesture() {
        clearPress();
        releaseGesture();
        isDragging = false;
    }
    onDestroy(cancelGesture);

    function toggleTools(event: MouseEvent) {
        event.stopPropagation();
        const rect = cardElement.getBoundingClientRect();
        const bounds = cardElement.closest(".na-timeline-column")!.getBoundingClientRect();
        toolsAbove = rect.bottom + 110 > bounds.bottom;
        toolsLeft = Math.max(bounds.left + 4 - rect.left, Math.min(0, bounds.right - 292 - rect.left));
        toolsOpen = !toolsOpen;
    }
    function closeToolsOutside(event: PointerEvent) {
        if (dragMode === "none" && !cardElement?.contains(event.target as Node)) toolsOpen = false;
    }
    function openSchedule(event: MouseEvent) {
        event.stopPropagation();
        if (Date.now() < suppressClickUntil || saving) return;
        toolsOpen = false;
        workspace?.openSchedule?.(task);
    }

    let duration = $derived((entry.scheduleEnd ?? 0) - (entry.scheduleStart ?? 0));
    let cardTop = $derived(minuteToPixel(entry.scheduleStart ?? 0));
    let cardHeight = $derived(minuteToPixel(duration));
    let cardWidth = $derived(laneCount > 0 ? containerWidth / laneCount - 4 : containerWidth);
    let cardLeft = $derived(leftOffset + laneIndex * (containerWidth / laneCount));
    let timeLabel = $derived(
        minuteToTimeLabel(isDragging || saving ? previewStart : (entry.scheduleStart ?? 0), resetHour),
    );
    let endTimeLabel = $derived(
        minuteToTimeLabel(isDragging || saving ? previewEnd : (entry.scheduleEnd ?? 0), resetHour),
    );
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

    let displayTop = $derived(isDragging || saving ? minuteToPixel(previewStart) : cardTop);
    let displayHeight = $derived(isDragging || saving ? minuteToPixel(previewEnd - previewStart) : cardHeight);
    let displayLeft = $derived(isDragging ? Math.max(0, cardLeft + 2 + previewOffsetX) : cardLeft + 2);
    let isRemoving = $derived(isDragging && previewOffsetX < -150);

    function handlePointerDown(e: PointerEvent, mode: DragMode) {
        clearPress();
        if (dragMode !== "none" || saving || (e.pointerType !== "touch" && e.button !== 0)) return;
        if (e.pointerType === "touch" && !e.isPrimary) return;
        e.stopPropagation();
        e.preventDefault();
        dragMode = mode;
        pointerId = e.pointerId;
        originClientY = currentY = e.clientY;
        originClientX = e.clientX;
        originStart = entry.scheduleStart ?? 0;
        originEnd = entry.scheduleEnd ?? 0;
        previewStart = originStart;
        previewEnd = originEnd;
        previewOffsetX = 0;
        isDragging = false;
        timeline = cardElement.closest<HTMLElement>(".na-timeline-column");
        originScroll = timeline?.scrollTop ?? 0;
        if (timeline) {
            previousOverflow = timeline.style.overflowY;
            if (workspace?.touch) timeline.style.overflowY = "hidden";
            timeline.addEventListener("scroll", updatePreview);
        }
        captureElement = e.currentTarget as HTMLElement;
        try {
            captureElement.setPointerCapture(e.pointerId);
        } catch {
            // Synthetic browser test events do not create an active pointer.
            if (e.isTrusted) cancelGesture();
        }
    }

    function updatePreview() {
        if (!isDragging || dragMode === "none") return;
        const dm =
            (currentY - originClientY + (timeline?.scrollTop ?? originScroll) - originScroll) / PIXELS_PER_MINUTE;
        if (dragMode === "move") {
            previewStart = Math.max(0, Math.min(DAY_MINUTES - (originEnd - originStart), snapMinute(originStart + dm)));
            previewEnd = previewStart + originEnd - originStart;
        } else if (dragMode === "resize-start") {
            previewStart = Math.max(
                0,
                originEnd - 720,
                Math.min(originEnd - MIN_SCHEDULE_DURATION, snapMinute(originStart + dm)),
            );
            previewEnd = originEnd;
        } else {
            previewEnd = Math.min(
                DAY_MINUTES,
                originStart + 720,
                Math.max(originStart + MIN_SCHEDULE_DURATION, snapMinute(originEnd + dm)),
            );
            previewStart = originStart;
        }
    }

    function autoScroll() {
        frame = 0;
        if (!timeline || !isDragging || dragMode === "none" || !workspace?.touch) return;
        const rect = timeline.getBoundingClientRect();
        const edge = 48;
        const speed =
            currentY < rect.top + edge
                ? -Math.min(10, (rect.top + edge - currentY) / 5)
                : currentY > rect.bottom - edge
                  ? Math.min(10, (currentY - rect.bottom + edge) / 5)
                  : 0;
        if (speed) {
            timeline.scrollTop += speed;
            updatePreview();
        }
        frame = requestAnimationFrame(autoScroll);
    }

    function handlePointerMove(e: PointerEvent) {
        if (press?.id === e.pointerId && Math.hypot(e.clientX - press.x, e.clientY - press.y) > CLICK_THRESHOLD_PX)
            clearPress();
        if (dragMode === "none" || e.pointerId !== pointerId) return;
        currentY = e.clientY;
        if (
            Math.abs(currentY - originClientY) > CLICK_THRESHOLD_PX ||
            (dragMode === "move" && Math.abs(e.clientX - originClientX) > CLICK_THRESHOLD_PX)
        )
            isDragging = true;
        if (!isDragging) return;
        e.preventDefault();
        suppressClickUntil = Date.now() + 400;
        previewOffsetX = workspace?.touch || dragMode !== "move" ? 0 : e.clientX - originClientX;
        updatePreview();
        if (workspace?.touch && !frame) frame = requestAnimationFrame(autoScroll);
    }

    async function handlePointerUp(e: PointerEvent) {
        if (press?.id === e.pointerId) clearPress();
        if (workspace?.touch && contextOpenedForPress) suppressClickUntil = Date.now() + 700;
        if (dragMode === "none" || e.pointerId !== pointerId) return;
        const currentMode = dragMode;
        const moved = isDragging;
        updatePreview();
        releaseGesture();
        if (!moved) {
            if (!workspace?.touch && currentMode === "move") openQuickMenu(e);
            return;
        }
        isDragging = false;
        suppressClickUntil = Date.now() + 400;
        const overUnscheduled =
            !workspace?.touch &&
            currentMode === "move" &&
            !!document.elementFromPoint(e.clientX, e.clientY)?.closest(".na-unscheduled");
        if (!overUnscheduled && previewStart === originStart && previewEnd === originEnd) return;
        saving = true;
        try {
            const state = overUnscheduled
                ? await bridge.removeMyDaySchedule(entry.blockId)
                : await bridge.setMyDaySchedule(entry.blockId, previewStart, previewEnd);
            taskStore.applyMyDayUpdate(state);
        } catch (error) {
            notifyError(formatRpcError(error, i18n));
        } finally {
            saving = false;
        }
    }

    function handlePointerCancel(e: PointerEvent) {
        if (press?.id === e.pointerId) clearPress();
        if (e.pointerId === pointerId) cancelGesture();
    }

    function handleCardKeydown(event: KeyboardEvent): void {
        if (event.target !== event.currentTarget) return;
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
        event.stopPropagation();
        if (workspace?.touch) {
            if ((event.target as HTMLElement).closest("button, .na-timeline-card__tools") || dragMode !== "none")
                return;
            openTouchContextMenu(event);
            return;
        }
        onContextMenu(task, event);
    }

    function openQuickMenu(event: MouseEvent) {
        showTaskQuickMenu(
            task,
            event.clientX,
            event.clientY,
            bridge,
            i18n,
            {
                onScheduleRemoved: (newState: MyDayState) => taskStore.applyMyDayUpdate(newState),
                onTaskUpdated: (updated: TaskCacheEntry) => taskStore.applyUpdate(updated),
                onRemovedFromMyDay: (newState: MyDayState) => taskStore.applyMyDayUpdate(newState),
            },
            isDone,
        );
    }

    function handleResizePointerDown(event: PointerEvent, mode: "resize-start" | "resize-end"): void {
        event.stopPropagation();
        handlePointerDown(event, mode);
    }
</script>

<svelte:window onpointerdown={closeToolsOutside} onblur={cancelGesture} />

<div
    bind:this={cardElement}
    class="na-timeline-card {priorityClass}"
    class:na-timeline-card--selected={toolsOpen}
    aria-busy={saving}
    aria-label={`${task.title}, ${timeLabel} – ${endTimeLabel}`}
    class:na-timeline-card--touch={workspace?.touch}
    onclick={(event) => {
        if (workspace?.touch) {
            event.preventDefault();
            const rect = cardElement.getBoundingClientRect();
            if (
                event.detail > 0 &&
                (event.clientX < rect.left ||
                    event.clientX > rect.right ||
                    event.clientY < rect.top ||
                    event.clientY > rect.bottom)
            )
                return;
            if (
                Date.now() < suppressClickUntil ||
                (event.target as HTMLElement).closest("button, .na-timeline-card__tools")
            )
                return;
            workspace.openTask?.(task);
        }
    }}
    class:na-timeline-card--dragging={isDragging}
    class:na-timeline-card--removing={isRemoving}
    class:na-timeline-card--compact={isCompact}
    class:na-timeline-card--minimal={isMinimal}
    class:na-timeline-card--done={isDone}
    style="top: {displayTop}px; height: {displayHeight}px; left: {displayLeft}px; width: {cardWidth}px; --na-timeline-card-accent: {priorityColor};"
    role="button"
    tabindex="0"
    onpointerdown={(e) => {
        if (workspace?.touch) beginPress(e);
        else handlePointerDown(e, "move");
    }}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onpointercancel={handlePointerCancel}
    onlostpointercapture={handlePointerCancel}
    oncontextmenu={handleContextMenu}
    onkeydown={handleCardKeydown}
>
    {#if workspace?.touch}
        <div class="na-timeline-card__edit">
            <NaIconButton
                symbol="iconCalendar"
                label={i18n.scheduleTask}
                compact
                active={toolsOpen}
                disabled={saving}
                onclick={toggleTools}
            />
        </div>
        {#if toolsOpen}
            <div
                class="na-timeline-card__tools"
                class:na-timeline-card__tools--above={toolsAbove}
                style={`left: ${toolsLeft}px`}
            >
                <div class="na-timeline-card__tools-time" aria-live="polite">{timeLabel} – {endTimeLabel}</div>
                <div class="na-timeline-card__tools-row">
                    <NaDragHandle
                        label={i18n.scheduleStart}
                        disabled={saving}
                        active={isDragging && dragMode === "resize-start"}
                        onpointerdown={(e) => handlePointerDown(e, "resize-start")}
                        onclick={openSchedule}
                    />
                    <NaDragHandle
                        label={i18n.timelineMove}
                        disabled={saving}
                        active={isDragging && dragMode === "move"}
                        onpointerdown={(e) => handlePointerDown(e, "move")}
                        onclick={openSchedule}
                    />
                    <NaDragHandle
                        label={i18n.timelineEnd}
                        disabled={saving}
                        active={isDragging && dragMode === "resize-end"}
                        onpointerdown={(e) => handlePointerDown(e, "resize-end")}
                        onclick={openSchedule}
                    />
                    <NaIconButton
                        symbol="iconClose"
                        label={i18n.close}
                        onclick={(e) => {
                            e.stopPropagation();
                            toolsOpen = false;
                        }}
                    />
                </div>
            </div>
        {/if}
    {:else}
        <div
            class="na-timeline-card__handle na-timeline-card__handle--top"
            role="separator"
            onpointerdown={(event) => handleResizePointerDown(event, "resize-start")}
        ></div>
    {/if}

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

    {#if !workspace?.touch}<div
            class="na-timeline-card__handle na-timeline-card__handle--bottom"
            role="separator"
            onpointerdown={(event) => handleResizePointerDown(event, "resize-end")}
        ></div>{/if}
</div>

<style lang="scss">
    .na-timeline-card.na-timeline-card--touch {
        touch-action: pan-y;
        overflow: visible;
        cursor: pointer;
        .na-timeline-card__content {
            max-height: 100%;
            box-sizing: border-box;
            padding-right: 28px;
        }
    }
    .na-timeline-card.na-timeline-card--selected {
        z-index: 25;
    }
    .na-timeline-card__edit {
        position: absolute;
        right: 0;
        top: 0;
        bottom: 0;
        overflow: hidden;
        width: 26px;
    }
    .na-timeline-card__tools {
        position: absolute;
        top: calc(100% + 4px);
        width: min(284px, calc(100vw - 24px));
        padding: 4px;
        border: 1px solid var(--b3-border-color);
        border-radius: 8px;
        background: var(--b3-theme-surface);
        box-shadow: var(--na-shadow-dialog);
        cursor: default;
    }
    .na-timeline-card__tools--above {
        top: auto;
        bottom: calc(100% + 4px);
    }
    .na-timeline-card__tools-row {
        display: flex;
        align-items: center;
        gap: 4px;
    }
    .na-timeline-card__tools-time {
        padding: 4px;
        text-align: center;
        font-size: 12px;
        font-variant-numeric: tabular-nums;
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
