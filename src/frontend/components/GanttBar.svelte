<script lang="ts">
    import type { TaskCacheEntry } from "../../shared/types";
    import { normalizePriority, PRIORITY_COLORS } from "../constants";
    import NaTooltip from "../ui/NaTooltip.svelte";
    import { localCalendarDate, type GanttBarGeometry } from "../utils/gantt";

    interface Props {
        task: TaskCacheEntry;
        geometry: GanttBarGeometry;
        selected?: boolean;
        i18n: any;
        onSelect?: ((task: TaskCacheEntry) => void) | undefined;
        onEdit: (task: TaskCacheEntry) => void;
        onContextMenu: (task: TaskCacheEntry, event: MouseEvent) => void;
    }

    let { task, geometry, selected = false, i18n, onSelect = undefined, onEdit, onContextMenu }: Props = $props();

    function getStatusColor(entry: TaskCacheEntry): string {
        if (entry.status === "inbox") return "var(--na-color-inbox)";
        if (entry.status === "doing") return "var(--na-color-doing)";
        if (entry.status === "waiting") return "var(--na-color-waiting)";
        if (entry.status === "someday") return "var(--na-color-someday)";
        if (entry.status === "done") return "var(--na-color-done)";
        return "var(--na-color-info)";
    }

    function replaceAll(template: string, values: Record<string, string>): string {
        return Object.entries(values).reduce((result, [key, value]) => result.replace(`{${key}}`, value), template);
    }

    function buildTooltipText(): string {
        let schedule = "";
        if (geometry.kind === "deadline") {
            schedule = `${i18n?.ganttDeadline || "Deadline"}: ${geometry.endDate}`;
        } else if (geometry.kind === "open") {
            schedule = replaceAll(i18n?.ganttOpenEnded || "Starts {start}, no due date", { start: geometry.startDate });
        } else {
            schedule = replaceAll(i18n?.ganttDateRange || "{start} – {due} · {days} days", {
                start: geometry.startDate,
                due: geometry.endDate,
                days: String(geometry.durationDays),
            });
            if (geometry.kind === "rollup") schedule = `${i18n?.ganttSummary || "Summary"}: ${schedule}`;
        }
        if (geometry.targetDate)
            schedule += ` · ${i18n?.ganttProjectDeadline || "Project deadline"}: ${geometry.targetDate}`;
        if (geometry.invalidRange) schedule += ` · ${i18n?.ganttInvalidRange || "Start is after due date"}`;
        if (dependencyCount > 0) {
            const dependencyText = (i18n?.dependencyCount || "{n} dependencies").replace(
                "{n}",
                String(dependencyCount),
            );
            schedule += ` · ${dependencyText}`;
        }
        return schedule;
    }

    function handleClick(event: MouseEvent): void {
        event.stopPropagation();
        onSelect?.(task);
    }

    function handleDoubleClick(event: MouseEvent): void {
        event.stopPropagation();
        onEdit(task);
    }

    function handleContextMenu(event: MouseEvent): void {
        event.preventDefault();
        onContextMenu(task, event);
    }
    let priorityColor = $derived(PRIORITY_COLORS[normalizePriority(task.priority)] || "var(--na-priority-medium)");
    let statusColor = $derived(getStatusColor(task));
    let isDone = $derived(task.status === "done");
    let isClarify = $derived(task.blocked && task.blockedReason === "inbox");
    let isHardBlocked = $derived(task.blocked && task.blockedReason !== "inbox" && task.blockedReason !== "someday");
    let isOverdue = $derived(!isDone && Boolean(task.due) && task.due.slice(0, 10) < localCalendarDate());
    let dependencyCount = $derived(task.depends.split("|").filter(Boolean).length);
    let showInsideLabel = $derived(geometry.kind === "bar" && geometry.width >= 84);
    let showInsideDate = $derived(geometry.kind === "bar" && geometry.width >= 148);
    let showOutsideLabel = $derived(geometry.kind !== "rollup" && !showInsideLabel);
    let anchorLeft = $derived(geometry.kind === "deadline" ? geometry.x - 10 : geometry.x);
    let anchorWidth = $derived(geometry.kind === "deadline" ? 20 : Math.max(22, geometry.width));
    let targetOffset = $derived(geometry.targetX === undefined ? null : geometry.targetX - anchorLeft);
    let targetBufferLeft = $derived(targetOffset === null ? 0 : Math.min(anchorWidth, targetOffset));
    let targetBufferWidth = $derived(targetOffset === null ? 0 : Math.abs(targetOffset - anchorWidth));
    let outsideLabel = $derived(
        geometry.kind === "deadline"
            ? `${geometry.endDate.slice(5)} · ${task.title || i18n?.untitled || "Untitled"}`
            : geometry.kind === "open"
              ? `${geometry.startDate.slice(5)} → · ${task.title || i18n?.untitled || "Untitled"}`
              : task.title || i18n?.untitled || "Untitled",
    );
    let tooltipText = $derived(buildTooltipText());
</script>

<div
    class="na-gantt-bar-anchor"
    class:na-gantt-bar-anchor--selected={selected}
    class:na-gantt-bar-anchor--done={isDone}
    class:na-gantt-bar-anchor--blocked={isHardBlocked}
    class:na-gantt-bar-anchor--clarify={isClarify}
    class:na-gantt-bar-anchor--overdue={isOverdue}
    class:na-gantt-bar-anchor--invalid={geometry.invalidRange}
    class:na-gantt-bar-anchor--deadline={geometry.kind === "deadline"}
    class:na-gantt-bar-anchor--open={geometry.kind === "open"}
    class:na-gantt-bar-anchor--rollup={geometry.kind === "rollup"}
    style="left: {anchorLeft}px; width: {anchorWidth}px; --na-gantt-bar-color: {statusColor}; --na-gantt-priority-color: {priorityColor};"
>
    <NaTooltip text={tooltipText} block followCursor={false}>
        <button
            type="button"
            class="na-gantt-bar"
            aria-label={`${task.title || i18n?.untitled || "Untitled"} · ${tooltipText}`}
            aria-pressed={selected}
            onclick={handleClick}
            ondblclick={handleDoubleClick}
            oncontextmenu={handleContextMenu}
        >
            <span class="na-gantt-bar__visual">
                {#if showInsideLabel}
                    <span class="na-gantt-bar__label na-gantt-bar__label--inside"
                        >{task.title || i18n?.untitled || "Untitled"}</span
                    >
                    {#if showInsideDate}<span class="na-gantt-bar__date">{geometry.endDate.slice(5)}</span>{/if}
                {/if}
            </span>
            {#if showOutsideLabel}
                <span class="na-gantt-bar__label na-gantt-bar__label--outside">{outsideLabel}</span>
            {/if}
        </button>
    </NaTooltip>
    {#if targetOffset !== null && geometry.targetDate}
        {#if targetBufferWidth > 1}
            <span
                class="na-gantt-bar__buffer"
                class:na-gantt-bar__buffer--late={geometry.targetLate}
                style="left: {targetBufferLeft}px; width: {targetBufferWidth}px"
                aria-hidden="true"
            ></span>
        {/if}
        <span
            class="na-gantt-bar__target"
            class:na-gantt-bar__target--late={geometry.targetLate}
            style="left: {targetOffset - 5}px"
            aria-hidden="true"
        ></span>
        <span
            class="na-gantt-bar__target-label"
            class:na-gantt-bar__target-label--late={geometry.targetLate}
            style="left: {targetOffset - 39}px"
            aria-hidden="true">{geometry.targetDate.slice(5)}</span
        >
    {/if}
</div>

<style lang="scss">
    .na-gantt-bar-anchor {
        position: absolute;
        top: calc((var(--na-gantt-row-height, 48px) - 26px) / 2);
        height: 26px;
        z-index: 2;
        min-width: 0;
    }

    .na-gantt-bar-anchor :global(.na-tooltip),
    .na-gantt-bar-anchor :global(.na-tooltip--block) {
        width: 100%;
        height: 100%;
    }

    .na-gantt-bar {
        position: relative;
        display: block;
        width: 100%;
        height: 100%;
        padding: 0;
        border: 0;
        overflow: visible;
        color: var(--na-text-primary);
        background: transparent;
        text-align: left;
        cursor: pointer;
    }

    .na-gantt-bar:focus-visible {
        outline: 2px solid var(--na-accent);
        outline-offset: 2px;
        border-radius: var(--na-radius-sm);
    }

    .na-gantt-bar__visual {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        min-width: 0;
        border: 1px solid color-mix(in srgb, var(--na-gantt-bar-color) 64%, var(--na-color-divider));
        border-radius: 7px;
        background: color-mix(in srgb, var(--na-gantt-bar-color) 24%, var(--b3-theme-surface));
        box-shadow:
            inset 0 1px color-mix(in srgb, var(--b3-theme-surface) 18%, transparent),
            0 2px 5px color-mix(in srgb, var(--b3-theme-on-background) 10%, transparent);
    }

    .na-gantt-bar__visual::before {
        content: "";
        position: absolute;
        inset: -1px auto -1px -1px;
        width: 5px;
        border-radius: 7px 0 0 7px;
        background: var(--na-gantt-priority-color);
    }

    .na-gantt-bar__label {
        font-size: var(--na-font-size-sm);
        font-weight: 680;
        line-height: 20px;
        white-space: nowrap;
    }

    .na-gantt-bar__label--inside {
        display: block;
        flex: 1;
        min-width: 0;
        padding: 0 10px;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .na-gantt-bar__date {
        flex: 0 0 auto;
        margin-right: 6px;
        padding-left: 7px;
        border-left: 1px solid color-mix(in srgb, var(--na-gantt-bar-color) 28%, transparent);
        color: var(--na-text-primary);
        font-size: var(--na-font-size-xs);
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        line-height: 14px;
    }

    .na-gantt-bar__label--outside {
        position: absolute;
        top: 4px;
        left: calc(100% + 7px);
        width: max-content;
        max-width: none;
        overflow: visible;
        color: var(--na-text-primary);
        font-variant-numeric: tabular-nums;
        text-overflow: clip;
        pointer-events: none;
    }

    .na-gantt-bar-anchor--blocked .na-gantt-bar__visual,
    .na-gantt-bar-anchor--invalid .na-gantt-bar__visual {
        background-color: color-mix(in srgb, var(--na-color-blocked) 14%, var(--b3-theme-surface));
        background-image: repeating-linear-gradient(
            135deg,
            transparent 0,
            transparent 4px,
            color-mix(in srgb, var(--na-color-blocked) 22%, transparent) 4px,
            color-mix(in srgb, var(--na-color-blocked) 22%, transparent) 6px
        );
    }

    .na-gantt-bar-anchor--clarify .na-gantt-bar__visual {
        border-color: var(--na-color-warning-border);
        border-style: dashed;
        background: var(--na-color-warning-bg);
        box-shadow: none;
    }

    .na-gantt-bar-anchor--clarify .na-gantt-bar__visual::before {
        background: var(--na-color-warning);
    }

    .na-gantt-bar-anchor--overdue .na-gantt-bar__visual,
    .na-gantt-bar-anchor--invalid .na-gantt-bar__visual {
        border-color: var(--na-color-error);
    }

    .na-gantt-bar-anchor--done {
        filter: saturate(0.72);
    }

    .na-gantt-bar-anchor--done .na-gantt-bar__label {
        text-decoration: line-through;
    }

    .na-gantt-bar-anchor--selected .na-gantt-bar__visual {
        box-shadow:
            0 0 0 2px var(--na-accent),
            var(--na-shadow-sm);
    }

    .na-gantt-bar-anchor--deadline .na-gantt-bar__visual {
        inset: 4px;
        border-radius: 2px;
        background: var(--na-gantt-priority-color);
        outline: 2px solid var(--b3-theme-surface);
        box-shadow: 0 1px 3px color-mix(in srgb, var(--b3-theme-on-background) 18%, transparent);
        transform: rotate(45deg);
    }

    .na-gantt-bar-anchor--deadline .na-gantt-bar__visual::before {
        display: none;
    }

    .na-gantt-bar-anchor--deadline .na-gantt-bar__label--outside {
        left: calc(100% + 3px);
    }

    .na-gantt-bar-anchor--open .na-gantt-bar__visual {
        border-right-style: dashed;
        background: linear-gradient(
            90deg,
            color-mix(in srgb, var(--na-gantt-bar-color) 24%, var(--b3-theme-surface)) 0%,
            color-mix(in srgb, var(--na-gantt-bar-color) 14%, var(--b3-theme-surface)) 72%,
            transparent 100%
        );
    }

    .na-gantt-bar-anchor--rollup {
        top: calc((var(--na-gantt-row-height, 48px) - 28px) / 2);
        height: 28px;
    }

    .na-gantt-bar-anchor--rollup .na-gantt-bar__visual {
        inset: 11px 0 13px;
        overflow: visible;
        border: 0;
        border-radius: var(--na-radius-pill);
        background: color-mix(in srgb, var(--na-gantt-bar-color) 82%, var(--b3-theme-surface));
        box-shadow: 0 2px 5px color-mix(in srgb, var(--b3-theme-on-background) 16%, transparent);
    }

    .na-gantt-bar-anchor--rollup .na-gantt-bar__visual::before,
    .na-gantt-bar-anchor--rollup .na-gantt-bar__visual::after {
        content: "";
        position: absolute;
        top: 0;
        width: 2px;
        height: 9px;
        border: 0;
        border-radius: 0 0 var(--na-radius-sm) var(--na-radius-sm);
        background: color-mix(in srgb, var(--na-gantt-bar-color) 78%, var(--b3-theme-surface));
    }

    .na-gantt-bar-anchor--rollup .na-gantt-bar__visual::before {
        left: 0;
    }
    .na-gantt-bar-anchor--rollup .na-gantt-bar__visual::after {
        right: 0;
    }

    .na-gantt-bar-anchor--deadline.na-gantt-bar-anchor--selected .na-gantt-bar__visual {
        box-shadow:
            0 0 0 2px var(--b3-theme-background),
            0 0 0 4px var(--na-accent);
    }

    .na-gantt-bar-anchor--rollup.na-gantt-bar-anchor--selected .na-gantt-bar__visual {
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--na-accent) 32%, transparent);
    }

    .na-gantt-bar__buffer {
        position: absolute;
        top: 10px;
        z-index: -1;
        height: 0;
        border-top: 1px dashed color-mix(in srgb, var(--na-accent) 48%, var(--na-color-divider));
        pointer-events: none;
    }

    .na-gantt-bar__buffer--late {
        border-color: color-mix(in srgb, var(--na-color-error) 62%, var(--na-color-divider));
    }

    .na-gantt-bar__target {
        position: absolute;
        top: 6px;
        z-index: 3;
        width: 10px;
        height: 10px;
        border: 2px solid var(--na-accent);
        background: var(--b3-theme-surface);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--b3-theme-surface) 82%, transparent);
        pointer-events: none;
        transform: rotate(45deg);
    }

    .na-gantt-bar__target--late {
        border-color: var(--na-color-error);
    }

    .na-gantt-bar__target-label {
        position: absolute;
        top: -5px;
        z-index: 3;
        width: 34px;
        color: var(--na-text-interactive);
        font-size: var(--na-font-size-xs);
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        line-height: 12px;
        text-align: right;
        pointer-events: none;
    }

    .na-gantt-bar__target-label--late {
        color: var(--na-color-error);
    }
</style>
