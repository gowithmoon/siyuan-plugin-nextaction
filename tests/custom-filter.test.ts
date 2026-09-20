import test from "node:test";
import assert from "node:assert/strict";

import {
    applyFilters,
    DEFAULT_FILTER_STATE,
    sortTasksBy,
    type CustomFieldFilter,
    type FilterState,
} from "../src/frontend/utils/filter";
import type { CustomFieldDef } from "../src/shared/custom-fields";
import type { TaskCacheEntry } from "../src/shared/types";
import { taskFactory } from "./helpers/fakes";

function fieldDef(partial: Partial<CustomFieldDef> = {}): CustomFieldDef {
    return {
        version: 2,
        id: "f1",
        key: "f1",
        label: "Field 1",
        description: "",
        type: "text",
        status: "active",
        scope: { mode: "all" },
        showOnCard: true,
        ...partial,
    };
}

function taskWithFields(blockId: string, customFields: Record<string, string>): TaskCacheEntry {
    return taskFactory(blockId, { customFields });
}

function filterState(overrides: Partial<FilterState>): FilterState {
    return { ...DEFAULT_FILTER_STATE, ...overrides };
}

function customFieldState(...customFieldFilters: CustomFieldFilter[]): FilterState {
    return filterState({ customFieldFilters });
}

function blockIds(tasks: TaskCacheEntry[]): string[] {
    return tasks.map((task) => task.blockId);
}

test("按 order 降序排列任务", () => {
    // Regression: Dock 侧边栏未排序导致新建任务沉底
    const tasks = [
        taskFactory("low-order", { order: 1 }),
        taskFactory("high-order", { order: 3 }),
        taskFactory("mid-order", { order: 2 }),
    ];

    assert.deepEqual(blockIds(sortTasksBy(tasks, "order", false, [])), ["high-order", "mid-order", "low-order"]);
});

test("order 排序按 due、effectiveImportance 和 blockId 依次决胜", () => {
    const tasks = [
        taskFactory("same-id-b", { order: 1, due: "2026-01-02", importance: 4 }),
        taskFactory("same-id-a", { order: 1, due: "2026-01-02", importance: 4 }),
        taskFactory("priority-high", { order: 1, due: "2026-01-02", importance: 4, priority: "high" }),
        taskFactory("lower-importance", { order: 1, due: "2026-01-02", importance: 3 }),
        taskFactory("higher-importance", { order: 1, due: "2026-01-02", importance: 5 }),
        taskFactory("due-late", { order: 1, due: "2026-01-03", importance: 8 }),
        taskFactory("due-early", { order: 1, due: "2026-01-01", importance: 1 }),
    ];

    assert.deepEqual(blockIds(sortTasksBy(tasks, "order", false, [])), [
        "due-early",
        "higher-importance",
        "priority-high",
        "same-id-a",
        "same-id-b",
        "lower-importance",
        "due-late",
    ]);
});

test("自定义字段 equals 过滤只保留值相等的任务", () => {
    const tasks = [taskWithFields("matching", { f1: "Alpha" }), taskWithFields("different", { f1: "Beta" })];

    const result = applyFilters(tasks, customFieldState({ key: "f1", operator: "equals", value: "alpha" }), [
        fieldDef(),
    ]);

    assert.deepEqual(blockIds(result), ["matching"]);
});

test("自定义字段 contains 过滤按部分文本匹配", () => {
    const tasks = [taskWithFields("matching", { f1: "Alpha Beta" }), taskWithFields("different", { f1: "Gamma" })];

    const result = applyFilters(tasks, customFieldState({ key: "f1", operator: "contains", value: "ha be" }), [
        fieldDef(),
    ]);

    assert.deepEqual(blockIds(result), ["matching"]);
});

test("自定义字段 empty 过滤保留缺失值和空值任务", () => {
    const tasks = [
        taskWithFields("missing", {}),
        taskWithFields("empty", { f1: "" }),
        taskWithFields("filled", { f1: "Alpha" }),
    ];

    const result = applyFilters(tasks, customFieldState({ key: "f1", operator: "empty" }), [fieldDef()]);

    assert.deepEqual(blockIds(result), ["empty", "missing"]);
});

test("自定义字段 notEmpty 过滤只保留非空值任务", () => {
    const tasks = [
        taskWithFields("missing", {}),
        taskWithFields("empty", { f1: "" }),
        taskWithFields("filled", { f1: "Alpha" }),
    ];

    const result = applyFilters(tasks, customFieldState({ key: "f1", operator: "notEmpty" }), [fieldDef()]);

    assert.deepEqual(blockIds(result), ["filled"]);
});

test("多个自定义字段过滤条件按 AND 组合", () => {
    const fields = [fieldDef(), fieldDef({ id: "f2", key: "f2", label: "Field 2" })];
    const tasks = [
        taskWithFields("both", { f1: "Alpha", f2: "Beta" }),
        taskWithFields("first-only", { f1: "Alpha", f2: "Other" }),
        taskWithFields("second-only", { f1: "Other", f2: "Beta" }),
    ];

    const result = applyFilters(
        tasks,
        customFieldState(
            { key: "f1", operator: "equals", value: "Alpha" },
            { key: "f2", operator: "equals", value: "Beta" },
        ),
        fields,
    );

    assert.deepEqual(blockIds(result), ["both"]);
});

test("搜索文本会匹配格式化后的自定义字段值", () => {
    const field = fieldDef({
        type: "singleSelect",
        options: [{ id: "option-1", label: "Needle Label", status: "active" }],
    });
    const tasks = [
        taskWithFields("matching", { f1: "option-1" }),
        taskWithFields("different", { f1: "unknown-option" }),
    ];

    const result = applyFilters(tasks, filterState({ searchText: "needle" }), [field]);

    assert.deepEqual(blockIds(result), ["matching"]);
});

test("自定义字段排序将空值排在末尾", () => {
    const tasks = [
        taskWithFields("empty", {}),
        taskWithFields("beta", { f1: "Beta" }),
        taskWithFields("alpha", { f1: "Alpha" }),
    ];

    assert.deepEqual(blockIds(sortTasksBy(tasks, "custom:f1", true, [fieldDef()])), ["alpha", "beta", "empty"]);
    assert.deepEqual(blockIds(sortTasksBy(tasks, "custom:f1", false, [fieldDef()])), ["beta", "alpha", "empty"]);
});

test("数字类型自定义字段按数值排序", () => {
    const tasks = [
        taskWithFields("negative-two", { f1: "-2" }),
        taskWithFields("negative-ten", { f1: "-10" }),
        taskWithFields("positive-one", { f1: "1" }),
    ];

    const result = sortTasksBy(tasks, "custom:f1", true, [fieldDef({ type: "number" })]);

    assert.deepEqual(blockIds(result), ["negative-ten", "negative-two", "positive-one"]);
});

test("字符串类型自定义字段使用自然顺序排序", () => {
    const tasks = [
        taskWithFields("item-ten", { f1: "Item 10" }),
        taskWithFields("item-two", { f1: "item 2" }),
        taskWithFields("item-one", { f1: "Item 1" }),
    ];

    const result = sortTasksBy(tasks, "custom:f1", true, [fieldDef()]);

    assert.deepEqual(blockIds(result), ["item-one", "item-two", "item-ten"]);
});
