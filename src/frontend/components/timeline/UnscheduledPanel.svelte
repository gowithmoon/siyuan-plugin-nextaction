<script lang="ts">
    import { useWorkspace } from "../../workspace-context";
    import NaIconButton from "../../ui/NaIconButton.svelte";
    const workspace = useWorkspace();
    import { normalizePriority, PRIORITY_COLORS } from "../../constants";
    import { MY_DAY_DRAG_TYPE } from "../../../shared/constants";
    import type { MyDayTaskEntry, TaskCacheEntry, MyDayState } from "../../../shared/types";
    import type { KernelBridge } from "../../kernel-bridge";
    import { showTaskQuickMenu } from "./TaskQuickMenu";
    import { taskStore } from "../../stores/task-store";
    import { isMyDayEntryDone } from "../../../shared/my-day";
    import { pixelToSnappedMinute } from "./timeline-utils";
    import { DAY_MINUTES } from "../../../shared/constants";
    import { notifyError, formatRpcError } from "../../notify";

    interface Props {
        unscheduledEntries?: MyDayTaskEntry[];
        taskMap: Map<string, TaskCacheEntry>;
        bridge: KernelBridge;
        i18n: any;
        isDropTarget?: boolean;
        horizontal?: boolean;
        onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
        onDragOver?: (event: DragEvent) => void;
        onDragLeave?: (event: DragEvent) => void;
        onDrop?: (event: DragEvent) => void | Promise<void>;
    }

    let {
        unscheduledEntries = [],
        taskMap,
        bridge,
        i18n,
        isDropTarget = false,
        horizontal = false,
        onContextMenu,
        onDragOver = () => {},
        onDragLeave = () => {},
        onDrop = () => {},
    }: Props = $props();
    let touchDrag: { blockId: string; pointerId: number; startX: number; startY: number; dragging: boolean } | null = null;
    function touchDown(e: PointerEvent, blockId: string) {
        if (!workspace?.touch || e.pointerType !== "touch") return;
        touchDrag = { blockId, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, dragging: false };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    function touchMove(e: PointerEvent) {
        if (!touchDrag || e.pointerId !== touchDrag.pointerId) return;
        if (Math.hypot(e.clientX - touchDrag.startX, e.clientY - touchDrag.startY) > 10) touchDrag.dragging = true;
        if (touchDrag.dragging) e.preventDefault();
    }
    async function touchUp(e: PointerEvent) {
        if (!touchDrag || e.pointerId !== touchDrag.pointerId) return;
        const drag = touchDrag; touchDrag = null;
        if (!drag.dragging) return;
        e.preventDefault();
        const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>(".na-timeline-column");
        if (!target) return;
        const rect = target.getBoundingClientRect();
        const minute = Math.max(0, Math.min(DAY_MINUTES - 60, pixelToSnappedMinute(e.clientY - rect.top + target.scrollTop)));
        try {
            const newState = await bridge.setMyDaySchedule(drag.blockId, minute, minute + 60);
            taskStore.applyMyDayUpdate(newState);
        } catch (err: any) { notifyError(formatRpcError(err, i18n)); }
    }

    function handleDragStart(e: DragEvent, blockId: string) {
        if (!e.dataTransfer) return;
        e.dataTransfer.setData(MY_DAY_DRAG_TYPE, blockId);
        e.dataTransfer.effectAllowed = "move";
    }

    function handleDragOver(e: DragEvent) {
        e.preventDefault();
        if (e.dataTransfer) {
            if (e.dataTransfer.types.includes(MY_DAY_DRAG_TYPE)) {
                e.dataTransfer.dropEffect = "move";
            }
        }
        onDragOver(e);
    }

    function handleDrop(e: DragEvent) {
        e.preventDefault();
        void onDrop(e);
    }

    function handleClick(e: MouseEvent, task: TaskCacheEntry, entry: MyDayTaskEntry) {
        if (workspace?.touch) {
            workspace.openTask?.(task);
            return;
        }
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
            isMyDayEntryDone(entry, task.status),
        );
    }

    function handleCardKeydown(event: KeyboardEvent, task: TaskCacheEntry, entry: MyDayTaskEntry): void {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleClick(new MouseEvent("click"), task, entry);
        }
    }

    function handleContextMenu(task: TaskCacheEntry, event: MouseEvent): void {
        event.preventDefault();
        onContextMenu(task, event);
    }

    function parseLocalDateOnly(value: string): Date {
        const datePart = value.split("T")[0];
        const [year, month, day] = datePart.split("-").map(Number);
        return new Date(year, month - 1, day);
    }

    function formatDue(due: string | null | undefined): string {
        if (!due) return "";
        const hasTime = due.includes("T");
        const d = parseLocalDateOnly(due);
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
        const timeStr = hasTime ? due.split("T")[1] : "";
        if (diff < 0) return i18n?.overdue || "Overdue";
        if (diff === 0) return timeStr ? `${i18n?.dueToday || "Today"} ${timeStr}` : i18n?.dueToday || "Today";
        if (diff === 1)
            return timeStr ? `${i18n?.dueTomorrow || "Tomorrow"} ${timeStr}` : i18n?.dueTomorrow || "Tomorrow";
        const datePart = due.split("T")[0].slice(5);
        return timeStr ? `${datePart} ${timeStr}` : datePart;
    }

    function isOverdue(due: string | null | undefined): boolean {
        if (!due) return false;
        if (due.includes("T")) {
            return new Date(due) < new Date();
        }
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        return parseLocalDateOnly(due) < today;
    }
</script>

<div
    class="na-unscheduled"
    role="region"
    aria-label={i18n?.unscheduled || "Unscheduled"}
    class:na-unscheduled--drop-target={isDropTarget}
    class:na-unscheduled--horizontal={horizontal}
    ondragover={handleDragOver}
    ondragleave={onDragLeave}
    ondrop={handleDrop}
>
    <div class="na-unscheduled__header">
        <span>{i18n?.unscheduled || "Unscheduled"}</span>
        <span class="na-unscheduled__count">{unscheduledEntries.length}</span>
    </div>
    {#if unscheduledEntries.length === 0}
        <div class="na-unscheduled__empty">
            {i18n?.noUnscheduled || "All tasks scheduled"}
        </div>
    {:else}
        <div class="na-unscheduled__list">
            {#each unscheduledEntries as entry (entry.blockId)}
                {@const task = taskMap.get(entry.blockId)}
                {#if task}
                    {@const displayPriority = normalizePriority(task.priority)}
                    {@const priorityColor = PRIORITY_COLORS[displayPriority] || "var(--b3-theme-primary)"}
                    {@const priorityClass = `na-unscheduled-card--priority-${displayPriority}`}
                    <div
                        class="na-unscheduled-card {priorityClass}"
                        class:na-unscheduled-card--done={isMyDayEntryDone(entry, task.status)}
                        style="--na-unscheduled-card-accent: {priorityColor};"
                        draggable={!workspace?.touch}
                        role="button"
                        tabindex="0"
                        ondragstart={(e) => handleDragStart(e, entry.blockId)}
                        onclick={(e) => handleClick(e, task, entry)}
                        onkeydown={(event) => handleCardKeydown(event, task, entry)}
                        oncontextmenu={(event) => handleContextMenu(task, event)}
                        onpointerdown={(event) => touchDown(event, entry.blockId)}
                        onpointermove={touchMove}
                        onpointerup={touchUp}
                    >
                        <span class="na-unscheduled-card__accent"></span>
                        <div class="na-unscheduled-card__name">{task.title}</div>
                        {#if workspace?.compact}<NaIconButton
                                symbol="iconCalendar"
                                label={i18n.scheduleTask}
                                onclick={(event) => {
                                    event.stopPropagation();
                                    workspace.openSchedule?.(task);
                                }}
                            />{/if}
                        <div class="na-unscheduled-card__meta">
                            {#if task.context}
                                <span class="na-unscheduled-card__context">@{task.context.split("|")[0].trim()}</span>
                            {/if}
                            {#if task.due}
                                <span
                                    class="na-unscheduled-card__due"
                                    class:na-unscheduled-card__due--overdue={isOverdue(task.due)}
                                >
                                    {formatDue(task.due)}
                                </span>
                            {/if}
                        </div>
                    </div>
                {/if}
            {/each}
        </div>
    {/if}
</div>

<style lang="scss">
    .na-unscheduled {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--na-myday-panel-bg, var(--b3-theme-surface));
        transition:
            background 0.2s,
            border-color 0.2s;
    }

    .na-unscheduled--drop-target {
        background: var(--na-color-info-bg);
    }

    .na-unscheduled__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 10px;
        font-size: 12px;
        font-weight: 700;
        color: var(--na-text-primary);
        border-bottom: 1px solid var(--na-myday-panel-border, var(--b3-border-color));
    }

    .na-unscheduled__count {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 20px;
        height: 18px;
        padding: 0 6px;
        border-radius: var(--na-radius-pill);
        color: var(--na-text-secondary);
        background: var(--na-task-card-meta-bg, var(--b3-theme-surface-light));
        border: 1px solid var(--na-task-card-meta-border, var(--b3-border-color));
        font-size: 10px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
    }

    .na-unscheduled__empty {
        padding: 12px 10px;
        font-size: 11px;
        color: var(--na-text-secondary);
        text-align: center;
    }

    .na-unscheduled__list {
        flex: 1;
        overflow-y: auto;
        padding: 8px;
    }

    .na-unscheduled--horizontal .na-unscheduled__list {
        display: grid;
        grid-auto-flow: column;
        grid-auto-columns: minmax(180px, 240px);
        align-content: start;
        gap: 7px;
        overflow-x: auto;
        overflow-y: hidden;
    }

    .na-unscheduled--horizontal .na-unscheduled-card {
        margin-bottom: 0;
    }

    .na-unscheduled-card {
        display: grid;
        grid-template-columns: 3px minmax(0, 1fr);
        gap: 2px 8px;
        padding: 8px 9px 8px 0;
        margin-bottom: 7px;
        border: 1px solid var(--na-task-card-border, var(--b3-border-color));
        border-radius: 8px;
        background-color: var(--b3-theme-surface);
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

        &[draggable="true"] {
            cursor: grab;
        }

        &[draggable="true"]:active {
            cursor: grabbing;
        }
    }

    .na-unscheduled-card--priority-critical {
        background-color: var(--na-priority-bg-critical);
    }
    .na-unscheduled-card--priority-high {
        background-color: var(--na-priority-bg-high);
    }
    .na-unscheduled-card--priority-medium {
        background-color: var(--na-priority-bg-medium);
    }
    .na-unscheduled-card--priority-low {
        background-color: var(--na-myday-panel-soft-bg, var(--b3-theme-surface-light));
    }
    .na-unscheduled-card--priority-veryLow,
    .na-unscheduled-card--priority-none {
        background-color: var(--b3-theme-surface);
    }

    .na-unscheduled-card--done {
        background-color: var(--na-myday-panel-soft-bg, var(--b3-theme-surface-light));

        .na-unscheduled-card__name {
            text-decoration: line-through;
        }

        .na-unscheduled-card__meta {
            color: var(--na-text-secondary);
        }
    }

    .na-unscheduled-card__accent {
        grid-row: 1 / span 2;
        width: 3px;
        min-height: 100%;
        border-radius: var(--na-radius-pill);
        background: var(--na-unscheduled-card-accent, var(--b3-theme-primary));
    }

    .na-unscheduled-card__name {
        min-width: 0;
        font-size: 12px;
        font-weight: 650;
        color: var(--b3-theme-on-background);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .na-unscheduled-card__meta {
        display: flex;
        gap: 5px;
        align-items: center;
        flex-wrap: wrap;
        min-width: 0;
    }

    .na-unscheduled-card__context,
    .na-unscheduled-card__due {
        display: inline-flex;
        align-items: center;
        min-height: 16px;
        padding: 1px 6px;
        border-radius: var(--na-radius-pill);
        background: var(--na-task-card-meta-bg, var(--b3-theme-surface-light));
        border: 1px solid var(--na-task-card-meta-border, var(--b3-border-color));
        font-size: 10px;
        line-height: 1.25;
    }

    .na-unscheduled-card__context {
        color: var(--na-text-primary);
    }

    .na-unscheduled-card__due {
        color: var(--na-text-secondary);

        &--overdue {
            color: var(--na-danger);
            background: var(--na-color-error-bg);
            border-color: var(--na-color-error-border);
        }
    }
</style>
