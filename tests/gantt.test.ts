import test from "node:test";
import assert from "node:assert/strict";
import type { TaskCacheEntry } from "../src/shared/types.ts";
import type { ProjectTreeRow } from "../src/frontend/utils/project-tree.ts";
import {
    buildGanttAxis,
    calculateGanttEdges,
    calculateGanttGeometries,
    calculateGanttRange,
    calendarDayNumber,
    dateToPixel,
    fitGanttRange,
} from "../src/frontend/utils/gantt.ts";

function task(blockId: string, overrides: Partial<TaskCacheEntry> = {}): TaskCacheEntry {
    return {
        blockId,
        identificationSource: "document",
        attrHostId: blockId,
        parentId: "",
        status: "todo",
        priority: "medium",
        importance: 4,
        effort: 4,
        due: "",
        start: "",
        context: "",
        taskType: "1",
        order: 0,
        childIds: [],
        title: blockId,
        depends: "",
        depMode: "all",
        sequential: false,
        repeat: "",
        repeatState: "",
        sort: 0,
        completed: "",
        note: "",
        outcome: "",
        dod: "",
        actionKind: "action",
        created: "",
        tags: "",
        blocked: false,
        blockedReason: "",
        reviewInterval: 0,
        reviewDate: "",
        reminder: "",
        customFields: {},
        ...overrides,
    };
}

function rows(tasks: TaskCacheEntry[]): ProjectTreeRow[] {
    return tasks.map((entry) => ({ task: entry, depth: 0, hasChildren: false, childCount: 0 }));
}

test("甘特日期使用严格自然日并拒绝无效日期", () => {
    assert.equal(calendarDayNumber("2026-03-08T12:30"), calendarDayNumber("2026-03-08"));
    assert.equal(calendarDayNumber("2026-02-30"), null);
    assert.equal(calendarDayNumber("not-a-date"), null);
});

test("短项目使用日尺度且不会为了今天扩展远期空白", () => {
    const range = calculateGanttRange([task("future", { start: "2030-01-10", due: "2030-01-12" })]);
    assert.ok(range);
    assert.equal(range.scale, "day");
    assert.equal(range.startDate, "2030-01-08");
    assert.equal(range.endDate, "2030-01-14");
    assert.equal(dateToPixel(range.startDate, range), 0);
});

test("项目跨度自动选择周和月尺度并生成双层轴", () => {
    const weekly = calculateGanttRange([task("w", { start: "2026-01-01", due: "2026-04-01" })]);
    const monthly = calculateGanttRange([task("m", { start: "2026-01-01", due: "2026-12-31" })]);
    assert.equal(weekly?.scale, "week");
    assert.equal(monthly?.scale, "month");
    assert.ok(weekly && buildGanttAxis(weekly).secondary.length > 0);
    assert.ok(monthly && buildGanttAxis(monthly).primary.length > 0);
});

test("短范围可扩展到可用时间轴宽度", () => {
    const range = calculateGanttRange([task("a", { due: "2026-08-15" })]);
    assert.ok(range);
    const fitted = fitGanttRange(range, 700);
    assert.ok(fitted.pixelsPerDay >= range.pixelsPerDay);
    assert.equal(Math.round(fitted.pixelsPerDay * fitted.totalDays), 698);
});

test("时间尺度随容器密度在日周月之间切换", () => {
    const range = calculateGanttRange([task("span", { start: "2026-08-15", due: "2026-09-30" })]);
    assert.ok(range);
    const day = fitGanttRange(range, 1600);
    const week = fitGanttRange(range, 1000);
    const month = fitGanttRange(range, 220);
    assert.equal(day.scale, "day");
    assert.equal(week.scale, "week");
    assert.equal(month.scale, "month");
});

test("常见宽屏范围自适应到可用宽度且不产生水平溢出", () => {
    const range = calculateGanttRange([task("span", { start: "2026-08-15", due: "2026-09-30" })]);
    assert.ok(range);
    const fitted = fitGanttRange(range, 1000);
    assert.equal(fitted.scale, "week");
    assert.ok(fitted.totalDays * fitted.pixelsPerDay <= 998.001);
    assert.ok(fitted.totalDays * fitted.pixelsPerDay >= 997.999);
});

test("极长范围保持可读的最小月尺度并允许必要滚动", () => {
    const range = calculateGanttRange([task("long", { start: "2020-01-01", due: "2030-12-31" })]);
    assert.ok(range);
    const fitted = fitGanttRange(range, 600);
    assert.equal(fitted.scale, "month");
    assert.equal(fitted.pixelsPerDay, 1.5);
    assert.ok(fitted.totalDays * fitted.pixelsPerDay > 600);
});

test("任务几何区分区间、截止点、开放式起始和错误范围", () => {
    const items = [
        task("bar", { start: "2026-08-01", due: "2026-08-03" }),
        task("deadline", { due: "2026-08-04" }),
        task("open", { start: "2026-08-05" }),
        task("invalid", { start: "2026-08-10", due: "2026-08-08" }),
    ];
    const range = calculateGanttRange(items);
    assert.ok(range);
    const model = {
        includedIds: new Set(items.map((entry) => entry.blockId)),
        includedTasks: items,
        childrenByParent: new Map(),
    };
    const geometries = calculateGanttGeometries(items, model, range);
    assert.equal(geometries.get("bar")?.kind, "bar");
    assert.equal(geometries.get("bar")?.durationDays, 3);
    assert.equal(geometries.get("deadline")?.kind, "deadline");
    assert.equal(geometries.get("open")?.kind, "open");
    assert.equal(geometries.get("invalid")?.invalidRange, true);
    assert.ok((geometries.get("invalid")?.width || 0) > 0);
});

test("父任务汇总合并自身与后代日期范围", () => {
    const parent = task("parent", { start: "2026-08-01", childIds: ["child"] });
    const child = task("child", { parentId: "parent", due: "2026-08-10" });
    const items = [parent, child];
    const range = calculateGanttRange(items);
    assert.ok(range);
    const model = {
        includedIds: new Set(["parent", "child"]),
        includedTasks: items,
        childrenByParent: new Map([["parent", [child]]]),
    };
    const geometry = calculateGanttGeometries(items, model, range).get("parent");
    assert.equal(geometry?.kind, "rollup");
    assert.equal(geometry?.startDate, "2026-08-01");
    assert.equal(geometry?.endDate, "2026-08-10");
});

test("项目汇总仅覆盖子任务排期并单独标记项目截止日", () => {
    const project = task("project", { taskType: "2", due: "2026-12-15", childIds: ["child"] });
    const child = task("child", { parentId: "project", start: "2026-08-15", due: "2026-10-30" });
    const items = [project, child];
    const range = calculateGanttRange(items);
    assert.ok(range);
    const model = {
        includedIds: new Set(items.map((entry) => entry.blockId)),
        includedTasks: items,
        childrenByParent: new Map([["project", [child]]]),
    };
    const geometry = calculateGanttGeometries(items, model, range).get("project");
    assert.equal(geometry?.kind, "rollup");
    assert.equal(geometry?.startDate, "2026-08-15");
    assert.equal(geometry?.endDate, "2026-10-30");
    assert.equal(geometry?.targetDate, "2026-12-15");
    assert.equal(geometry?.targetLate, false);
    assert.ok((geometry?.targetX || 0) > (geometry?.x || 0) + (geometry?.width || 0));
});

test("项目截止日早于子任务结束时标记计划逾期", () => {
    const project = task("project", { taskType: "2", due: "2026-09-30", childIds: ["child"] });
    const child = task("child", { parentId: "project", start: "2026-08-15", due: "2026-10-30" });
    const items = [project, child];
    const range = calculateGanttRange(items);
    assert.ok(range);
    const geometry = calculateGanttGeometries(
        items,
        {
            includedIds: new Set(items.map((entry) => entry.blockId)),
            includedTasks: items,
            childrenByParent: new Map([["project", [child]]]),
        },
        range,
    ).get("project");
    assert.equal(geometry?.targetLate, true);
});

test("依赖箭头只连接可见端点并让显式依赖覆盖顺序链", () => {
    const parent = task("parent", { sequential: true, childIds: ["a", "b", "c"] });
    const a = task("a", { parentId: "parent", start: "2026-08-01", due: "2026-08-02", sort: 1 });
    const b = task("b", { parentId: "parent", start: "2026-08-03", due: "2026-08-04", depends: "a", sort: 2 });
    const c = task("c", { parentId: "parent", start: "2026-08-05", due: "2026-08-06", sort: 3 });
    const items = [parent, a, b, c];
    const range = calculateGanttRange(items);
    assert.ok(range);
    const model = {
        includedIds: new Set(items.map((entry) => entry.blockId)),
        includedTasks: items,
        childrenByParent: new Map([["parent", [a, b, c]]]),
    };
    const geometries = calculateGanttGeometries(items, model, range);
    const edges = calculateGanttEdges(rows([a, b, c]), items, geometries);
    assert.equal(edges.filter((edge) => edge.id.includes("a->b")).length, 1);
    assert.equal(edges.find((edge) => edge.id.includes("a->b"))?.type, "dependency");
    assert.equal(edges.find((edge) => edge.id.includes("b->c"))?.type, "sequential");
    assert.equal(calculateGanttEdges(rows([a, c]), items, geometries).length, 0);
});

test("移动端行高作为依赖线几何输入保持任务中心对齐", () => {
    // Regression: 甘特移动端行高提升后，依赖线仍按 48px 计算，导致箭头偏离任务条中心。
    const a = task("a", { start: "2026-08-01", due: "2026-08-02", depends: "" });
    const b = task("b", { start: "2026-08-03", due: "2026-08-04", depends: "a" });
    const items = [a, b];
    const range = calculateGanttRange(items);
    assert.ok(range);
    const model = {
        includedIds: new Set(items.map((entry) => entry.blockId)),
        includedTasks: items,
        childrenByParent: new Map(),
    };
    const geometries = calculateGanttGeometries(items, model, range);
    const edge = calculateGanttEdges(rows(items), items, geometries, 64)[0];
    assert.match(edge.path, /V 96 /);
});
