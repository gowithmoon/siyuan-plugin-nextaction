import type { TaskCacheEntry } from "../../shared/types";
import type { ProjectTreeModel, ProjectTreeRow } from "./project-tree";
import { isProjectTask } from "../../shared/project-domain";

export const GANTT_ROW_HEIGHT = 48;
export const GANTT_MOBILE_ROW_HEIGHT = 64;

export type GanttScaleName = "day" | "week" | "month";
export type GanttBarKind = "bar" | "deadline" | "open" | "rollup";
export type GanttEdgeType = "dependency" | "sequential";

export interface GanttRange {
    startDate: string;
    endDate: string;
    totalDays: number;
    scale: GanttScaleName;
    pixelsPerDay: number;
}

export interface GanttBarGeometry {
    taskId: string;
    kind: GanttBarKind;
    x: number;
    width: number;
    startDate: string;
    endDate: string;
    durationDays: number;
    invalidRange: boolean;
    targetX?: number;
    targetDate?: string;
    targetLate?: boolean;
}

export interface GanttAxisSegment {
    key: string;
    label: string;
    x: number;
    width: number;
    alternate?: boolean;
    weekend?: boolean;
}

export interface GanttAxis {
    primary: GanttAxisSegment[];
    secondary: GanttAxisSegment[];
}

export interface GanttEdge {
    id: string;
    type: GanttEdgeType;
    path: string;
}

const DAY_MS = 86400000;

function pad2(value: number): string {
    return String(value).padStart(2, "0");
}

export function datePart(value: string): string {
    return value ? value.slice(0, 10) : "";
}

export function calendarDayNumber(value: string): number | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart(value));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return Math.floor(date.getTime() / DAY_MS);
}

export function calendarDateFromDay(dayNumber: number): string {
    const date = new Date(dayNumber * DAY_MS);
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function localCalendarDate(date = new Date()): string {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function dayDifference(value: string, base: string): number | null {
    const valueDay = calendarDayNumber(value);
    const baseDay = calendarDayNumber(base);
    return valueDay === null || baseDay === null ? null : valueDay - baseDay;
}

function weekday(dayNumber: number): number {
    return new Date(dayNumber * DAY_MS).getUTCDay();
}

function monthStart(dayNumber: number): number {
    const date = new Date(dayNumber * DAY_MS);
    return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / DAY_MS);
}

function monthEnd(dayNumber: number): number {
    const date = new Date(dayNumber * DAY_MS);
    return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0) / DAY_MS);
}

function chooseScale(totalDays: number): { scale: GanttScaleName; pixelsPerDay: number } {
    if (totalDays <= 60) return { scale: "day", pixelsPerDay: 24 };
    if (totalDays <= 180) return { scale: "week", pixelsPerDay: 10 };
    return { scale: "month", pixelsPerDay: 3 };
}

function chooseScaleForDensity(pixelsPerDay: number): GanttScaleName {
    if (pixelsPerDay >= 24) return "day";
    if (pixelsPerDay >= 5) return "week";
    return "month";
}

export function calculateGanttRange(tasks: TaskCacheEntry[]): GanttRange | null {
    const dates = tasks
        .flatMap((task) => [calendarDayNumber(task.start || ""), calendarDayNumber(task.due || "")])
        .filter((value): value is number => value !== null);
    if (dates.length === 0) return null;

    const rawStart = Math.min(...dates);
    const rawEnd = Math.max(...dates);
    const chosen = chooseScale(rawEnd - rawStart + 1);
    let startDay = rawStart;
    let endDay = rawEnd;
    if (chosen.scale === "day") {
        startDay -= 2;
        endDay += 2;
    } else if (chosen.scale === "week") {
        const startWeekday = weekday(startDay) || 7;
        const endWeekday = weekday(endDay) || 7;
        startDay -= startWeekday - 1;
        endDay += 7 - endWeekday;
    } else {
        startDay = monthStart(startDay);
        endDay = monthEnd(endDay);
    }

    return {
        startDate: calendarDateFromDay(startDay),
        endDate: calendarDateFromDay(endDay),
        totalDays: endDay - startDay + 1,
        scale: chosen.scale,
        pixelsPerDay: chosen.pixelsPerDay,
    };
}

export function fitGanttRange(range: GanttRange, availableWidth: number): GanttRange {
    if (availableWidth <= 0) return range;
    const width = Math.max(1, Math.floor(availableWidth) - 2);
    let startDay = calendarDayNumber(range.startDate);
    let endDay = calendarDayNumber(range.endDate);
    if (startDay === null || endDay === null) return range;

    let totalDays = endDay - startDay + 1;
    let scale = chooseScaleForDensity(width / totalDays);
    if (scale === "week") {
        const startWeekday = weekday(startDay) || 7;
        const endWeekday = weekday(endDay) || 7;
        startDay -= startWeekday - 1;
        endDay += 7 - endWeekday;
    } else if (scale === "month") {
        startDay = monthStart(startDay);
        endDay = monthEnd(endDay);
    }

    totalDays = endDay - startDay + 1;
    let pixelsPerDay = width / totalDays;
    if (scale === "week" && pixelsPerDay < 5) {
        scale = "month";
        startDay = monthStart(startDay);
        endDay = monthEnd(endDay);
        totalDays = endDay - startDay + 1;
        pixelsPerDay = width / totalDays;
    }

    if (scale === "day" && pixelsPerDay > 48) {
        const targetDays = Math.ceil(width / 48);
        const extraDays = Math.max(0, targetDays - totalDays);
        startDay -= Math.floor(extraDays / 2);
        endDay += Math.ceil(extraDays / 2);
        totalDays = endDay - startDay + 1;
        pixelsPerDay = width / totalDays;
    }

    pixelsPerDay = Math.max(scale === "month" ? 1.5 : 5, pixelsPerDay);
    return {
        startDate: calendarDateFromDay(startDay),
        endDate: calendarDateFromDay(endDay),
        totalDays,
        scale,
        pixelsPerDay,
    };
}

export function dateToPixel(value: string, range: GanttRange): number | null {
    const difference = dayDifference(value, range.startDate);
    return difference === null ? null : difference * range.pixelsPerDay;
}

type Span = {
    startDay: number;
    endDay: number;
    explicitKind: Exclude<GanttBarKind, "rollup">;
    invalidRange: boolean;
};

export function calculateGanttGeometries(
    tasks: TaskCacheEntry[],
    model: Pick<ProjectTreeModel, "includedIds" | "includedTasks" | "childrenByParent">,
    range: GanttRange,
): Map<string, GanttBarGeometry> {
    const taskById = new Map(tasks.map((task) => [task.blockId, task]));
    const scheduledIds = new Set(model.includedTasks.map((task) => task.blockId));
    const spanCache = new Map<string, Span | null>();

    const resolveSpan = (taskId: string, visiting = new Set<string>()): Span | null => {
        if (spanCache.has(taskId)) return spanCache.get(taskId) || null;
        if (visiting.has(taskId) || !model.includedIds.has(taskId)) return null;
        const task = taskById.get(taskId);
        if (!task) return null;
        const nextVisiting = new Set(visiting).add(taskId);
        const startDay = scheduledIds.has(taskId) ? calendarDayNumber(task.start || "") : null;
        const dueDay = scheduledIds.has(taskId) ? calendarDayNumber(task.due || "") : null;
        let explicit: Span | null = null;
        if (startDay !== null && dueDay !== null) {
            explicit = {
                startDay: Math.min(startDay, dueDay),
                endDay: Math.max(startDay, dueDay),
                explicitKind: "bar",
                invalidRange: startDay > dueDay,
            };
        } else if (dueDay !== null) {
            explicit = { startDay: dueDay, endDay: dueDay, explicitKind: "deadline", invalidRange: false };
        } else if (startDay !== null) {
            explicit = { startDay, endDay: startDay, explicitKind: "open", invalidRange: false };
        }

        const childSpans = (model.childrenByParent.get(taskId) || [])
            .filter((child) => model.includedIds.has(child.blockId))
            .map((child) => resolveSpan(child.blockId, nextVisiting))
            .filter((span): span is Span => Boolean(span));
        if (!explicit && childSpans.length === 0) {
            spanCache.set(taskId, null);
            return null;
        }

        const hasIncludedChildren = childSpans.length > 0;
        const spans =
            isProjectTask(task) && hasIncludedChildren ? childSpans : explicit ? [explicit, ...childSpans] : childSpans;
        const resolved: Span = {
            startDay: Math.min(...spans.map((span) => span.startDay)),
            endDay: Math.max(...spans.map((span) => span.endDay)),
            explicitKind: hasIncludedChildren ? "bar" : explicit?.explicitKind || "bar",
            invalidRange: Boolean(explicit?.invalidRange || childSpans.some((span) => span.invalidRange)),
        };
        spanCache.set(taskId, resolved);
        return resolved;
    };

    const geometries = new Map<string, GanttBarGeometry>();
    const rangeStart = calendarDayNumber(range.startDate) || 0;
    for (const task of tasks) {
        if (!scheduledIds.has(task.blockId)) continue;
        const span = resolveSpan(task.blockId);
        if (!span) continue;
        const hasIncludedChildren = (model.childrenByParent.get(task.blockId) || []).some(
            (child) => model.includedIds.has(child.blockId) && resolveSpan(child.blockId),
        );
        const kind: GanttBarKind = hasIncludedChildren ? "rollup" : span.explicitKind;
        const startOffset = span.startDay - rangeStart;
        const durationDays = span.endDay - span.startDay + 1;
        const x = kind === "deadline" ? (startOffset + 0.5) * range.pixelsPerDay : startOffset * range.pixelsPerDay;
        const width =
            kind === "deadline"
                ? 0
                : kind === "open"
                  ? Math.max(34, range.pixelsPerDay * 1.5)
                  : Math.max(range.pixelsPerDay, durationDays * range.pixelsPerDay);
        const projectDueDay = isProjectTask(task) && kind === "rollup" ? calendarDayNumber(task.due || "") : null;
        geometries.set(task.blockId, {
            taskId: task.blockId,
            kind,
            x,
            width,
            startDate: calendarDateFromDay(span.startDay),
            endDate: calendarDateFromDay(span.endDay),
            durationDays,
            invalidRange: span.invalidRange,
            ...(projectDueDay === null
                ? {}
                : {
                      targetX: (projectDueDay - rangeStart + 0.5) * range.pixelsPerDay,
                      targetDate: calendarDateFromDay(projectDueDay),
                      targetLate: projectDueDay < span.endDay,
                  }),
        });
    }
    return geometries;
}

function segmentLabel(date: string, scale: GanttScaleName, primary: boolean): string {
    const [year, month, day] = date.split("-");
    if (primary) return scale === "month" ? year : `${year}-${month}`;
    if (scale === "day") return String(Number(day));
    if (scale === "week") return `${Number(month)}/${Number(day)}`;
    return month;
}

export function buildGanttAxis(range: GanttRange): GanttAxis {
    const startDay = calendarDayNumber(range.startDate) || 0;
    const endDay = calendarDayNumber(range.endDate) || startDay;
    const primary: GanttAxisSegment[] = [];
    const secondary: GanttAxisSegment[] = [];

    const addGrouped = (
        target: GanttAxisSegment[],
        keyFor: (dayNumber: number) => string,
        labelFor: (dayNumber: number) => string,
        alternate = false,
    ) => {
        let groupStart = startDay;
        let currentKey = keyFor(startDay);
        let groupIndex = 0;
        for (let day = startDay + 1; day <= endDay + 1; day++) {
            const nextKey = day <= endDay ? keyFor(day) : "__end__";
            if (nextKey === currentKey) continue;
            const date = calendarDateFromDay(groupStart);
            target.push({
                key: `${currentKey}-${groupStart}`,
                label: labelFor(groupStart),
                x: (groupStart - startDay) * range.pixelsPerDay,
                width: (day - groupStart) * range.pixelsPerDay,
                alternate: alternate && groupIndex % 2 === 1,
            });
            groupStart = day;
            currentKey = nextKey;
            groupIndex++;
        }
    };

    addGrouped(
        primary,
        (day) => {
            const date = calendarDateFromDay(day);
            return range.scale === "month" ? date.slice(0, 4) : date.slice(0, 7);
        },
        (day) => segmentLabel(calendarDateFromDay(day), range.scale, true),
    );

    if (range.scale === "day") {
        for (let day = startDay; day <= endDay; day++) {
            const date = calendarDateFromDay(day);
            const dayOfWeek = weekday(day);
            secondary.push({
                key: date,
                label: segmentLabel(date, range.scale, false),
                x: (day - startDay) * range.pixelsPerDay,
                width: range.pixelsPerDay,
                weekend: dayOfWeek === 0 || dayOfWeek === 6,
            });
        }
    } else if (range.scale === "week") {
        addGrouped(
            secondary,
            (day) => {
                const dayOfWeek = weekday(day) || 7;
                return String(day - (dayOfWeek - 1));
            },
            (day) => segmentLabel(calendarDateFromDay(day), range.scale, false),
            true,
        );
    } else {
        addGrouped(
            secondary,
            (day) => calendarDateFromDay(day).slice(0, 7),
            (day) => segmentLabel(calendarDateFromDay(day), range.scale, false),
            true,
        );
    }

    return { primary, secondary };
}

function geometryStart(geometry: GanttBarGeometry): number {
    return geometry.x;
}

function geometryEnd(geometry: GanttBarGeometry): number {
    return geometry.kind === "deadline" ? geometry.x : geometry.x + geometry.width;
}

function edgePath(sourceX: number, sourceY: number, targetX: number, targetY: number): string {
    const turnX = targetX >= sourceX + 16 ? sourceX + 8 : Math.max(sourceX, targetX) + 12;
    return `M ${sourceX} ${sourceY} H ${turnX} V ${targetY} H ${targetX}`;
}

export function calculateGanttEdges(
    rows: ProjectTreeRow[],
    allProjectTasks: TaskCacheEntry[],
    geometries: ReadonlyMap<string, GanttBarGeometry>,
    rowHeight = GANTT_ROW_HEIGHT,
): GanttEdge[] {
    const rowIndex = new Map(rows.map((row, index) => [row.task.blockId, index]));
    const visibleTaskById = new Map(rows.map((row) => [row.task.blockId, row.task]));
    const edges: GanttEdge[] = [];
    const edgeKeys = new Set<string>();

    const addEdge = (sourceId: string, targetId: string, type: GanttEdgeType) => {
        const key = `${sourceId}->${targetId}`;
        if (edgeKeys.has(key)) return;
        const sourceGeometry = geometries.get(sourceId);
        const targetGeometry = geometries.get(targetId);
        const sourceRow = rowIndex.get(sourceId);
        const targetRow = rowIndex.get(targetId);
        if (!sourceGeometry || !targetGeometry || sourceRow === undefined || targetRow === undefined) return;
        edgeKeys.add(key);
        edges.push({
            id: `${type}-${key}`,
            type,
            path: edgePath(
                geometryEnd(sourceGeometry),
                sourceRow * rowHeight + rowHeight / 2,
                geometryStart(targetGeometry),
                targetRow * rowHeight + rowHeight / 2,
            ),
        });
    };

    for (const row of rows) {
        for (const dependencyId of row.task.depends.split("|").filter(Boolean)) {
            if (visibleTaskById.has(dependencyId)) addEdge(dependencyId, row.task.blockId, "dependency");
        }
    }

    for (const parent of allProjectTasks) {
        if (!parent.sequential) continue;
        const siblings = allProjectTasks
            .filter((task) => task.parentId === parent.blockId || parent.childIds?.includes(task.blockId))
            .filter((task, index, items) => items.findIndex((item) => item.blockId === task.blockId) === index)
            .sort((a, b) => (a.sort !== b.sort ? a.sort - b.sort : a.blockId.localeCompare(b.blockId)));
        for (let index = 1; index < siblings.length; index++) {
            const source = siblings[index - 1];
            const target = siblings[index];
            if (!visibleTaskById.has(source.blockId) || !visibleTaskById.has(target.blockId)) continue;
            if (edgeKeys.has(`${source.blockId}->${target.blockId}`)) continue;
            addEdge(source.blockId, target.blockId, "sequential");
        }
    }

    return edges;
}
