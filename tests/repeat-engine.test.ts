import test from "node:test";
import assert from "node:assert/strict";

import {
    advanceRepeatState,
    createRepeatState,
    parseRepeatRule,
    normalizeRepeatRule,
    previewRepeatOccurrences,
    type RepeatRuleV2,
} from "../src/shared/repeat.ts";

function rule(partial: Partial<RepeatRuleV2> = {}): RepeatRuleV2 {
    return {
        version: 2,
        frequency: "day",
        interval: 1,
        basis: "schedule",
        overflow: "lastDay",
        missedPolicy: "nextFuture",
        end: { type: "never" },
        ...partial,
    };
}

test("兼容旧格式重复规则并补齐 V2 默认值", () => {
    assert.deepEqual(normalizeRepeatRule({ freq: "week", interval: 2, from: "complete" }), {
        version: 2,
        frequency: "week",
        interval: 2,
        basis: "completion",
        overflow: "lastDay",
        missedPolicy: "nextFuture",
        end: { type: "never" },
    });
    assert.equal(normalizeRepeatRule({ freq: "hour", interval: 2 }), null);
    assert.deepEqual(parseRepeatRule('{"freq":"week","interval":2}'), {
        version: 2,
        frequency: "week",
        interval: 2,
        basis: "schedule",
        overflow: "lastDay",
        missedPolicy: "nextFuture",
        end: { type: "never" },
    });
    assert.equal(parseRepeatRule("not json"), null);
    assert.deepEqual(normalizeRepeatRule({ version: 2, frequency: "week", interval: 2, basis: "completion" }), {
        version: 2,
        frequency: "week",
        interval: 2,
        basis: "completion",
        overflow: "lastDay",
        missedPolicy: "nextFuture",
        end: { type: "never" },
    });
});

test("拒绝无效频率、间隔、星期和结束条件", () => {
    assert.equal(normalizeRepeatRule({ version: 2, frequency: "hour", interval: 1 }), null);
    assert.equal(normalizeRepeatRule({ version: 2, frequency: "day", interval: 0 }), null);
    assert.equal(normalizeRepeatRule({ version: 2, frequency: "week", interval: 1, weekdays: [0, 8] }), null);
    assert.equal(normalizeRepeatRule({ version: 2, frequency: "day", interval: 1, weekdays: [1] }), null);
    assert.equal(
        normalizeRepeatRule({ version: 2, frequency: "week", interval: 1, monthly: { type: "lastDay" } }),
        null,
    );
    assert.equal(
        normalizeRepeatRule({
            version: 2,
            frequency: "day",
            interval: 1,
            end: { type: "count", count: 0 },
        }),
        null,
    );
});

test("月末按锚点计算，不会从二月漂移到三月二十八日", () => {
    const repeatRule = rule({ frequency: "month" });
    const initial = createRepeatState(repeatRule, "", "2026-01-31");
    assert.ok(initial);

    const february = advanceRepeatState(repeatRule, initial!, "2026-01-31T12:00", "complete");
    assert.equal(february.state.currentDue, "2026-02-28");
    assert.equal(february.ended, false);

    const march = advanceRepeatState(repeatRule, february.state, "2026-02-28T12:00", "complete");
    assert.equal(march.state.currentDue, "2026-03-31");
});

test("每周可选择多个星期，并支持跨周间隔", () => {
    const repeatRule = rule({ frequency: "week", interval: 2, weekdays: [1, 3, 5] });
    const initial = createRepeatState(repeatRule, "", "2026-07-01"); // 周三
    assert.ok(initial);

    const friday = advanceRepeatState(repeatRule, initial!, "2026-07-01T09:00", "complete");
    assert.equal(friday.state.currentDue, "2026-07-03");

    const nextCycle = advanceRepeatState(repeatRule, friday.state, "2026-07-03T09:00", "complete");
    assert.equal(nextCycle.state.currentDue, "2026-07-13");
});

test("支持每月第 N 个和最后一个星期几", () => {
    const thirdFriday = rule({
        frequency: "month",
        monthly: { type: "nthWeekday", nth: 3, weekday: 5 },
    });
    const lastMonday = rule({
        frequency: "month",
        monthly: { type: "nthWeekday", nth: -1, weekday: 1 },
    });

    const thirdState = createRepeatState(thirdFriday, "", "2026-01-16")!;
    const lastState = createRepeatState(lastMonday, "", "2026-01-26")!;
    assert.equal(advanceRepeatState(thirdFriday, thirdState, "2026-01-16", "complete").state.currentDue, "2026-02-20");
    assert.equal(advanceRepeatState(lastMonday, lastState, "2026-01-26", "complete").state.currentDue, "2026-02-23");
});

test("固定计划默认跳到未来最近一次，也可逐期补做", () => {
    const skipMissed = rule({ frequency: "day", missedPolicy: "nextFuture" });
    const catchUp = rule({ frequency: "day", missedPolicy: "catchUp" });
    const initial = createRepeatState(skipMissed, "", "2026-07-01")!;

    assert.equal(
        advanceRepeatState(skipMissed, initial, "2026-07-05T10:00", "complete").state.currentDue,
        "2026-07-06",
    );
    assert.equal(advanceRepeatState(catchUp, initial, "2026-07-05T10:00", "complete").state.currentDue, "2026-07-02");
});

test("完成日模式保留开始截止窗口，开始日不得早于完成日", () => {
    const repeatRule = rule({ frequency: "week", basis: "completion" });
    const initial = createRepeatState(repeatRule, "2026-07-08T09:00", "2026-07-10T17:00")!;
    const next = advanceRepeatState(repeatRule, initial, "2026-07-12T11:30", "complete");

    assert.equal(next.state.currentDue, "2026-07-19T17:00");
    assert.equal(next.state.currentStart, "2026-07-17T09:00");
});

test("跳过会消耗次数但不会被视为完成，达到次数后结束", () => {
    const repeatRule = rule({ frequency: "day", end: { type: "count", count: 2 } });
    const initial = createRepeatState(repeatRule, "", "2026-07-01")!;
    const skipped = advanceRepeatState(repeatRule, initial, "2026-07-01", "skip");
    assert.equal(skipped.state.processed, 1);
    assert.equal(skipped.ended, false);

    const completed = advanceRepeatState(repeatRule, skipped.state, "2026-07-02", "complete");
    assert.equal(completed.state.processed, 2);
    assert.equal(completed.state.status, "ended");
    assert.equal(completed.ended, true);
});

test("结束日期包含当天，超出后结束系列", () => {
    const repeatRule = rule({ frequency: "day", end: { type: "date", date: "2026-07-03" } });
    const initial = createRepeatState(repeatRule, "", "2026-07-02")!;
    const third = advanceRepeatState(repeatRule, initial, "2026-07-02", "complete");
    assert.equal(third.state.currentDue, "2026-07-03");
    assert.equal(third.ended, false);

    const ended = advanceRepeatState(repeatRule, third.state, "2026-07-03", "complete");
    assert.equal(ended.ended, true);
    assert.equal(ended.state.status, "ended");
});

test("预览返回当前发生之后的五次日期", () => {
    const repeatRule = rule({ frequency: "week", weekdays: [1, 5] });
    const preview = previewRepeatOccurrences(repeatRule, "2026-07-27", "2026-07-27", 5);

    assert.equal(preview.length, 5);
    assert.deepEqual(
        preview.map((item) => item.due),
        ["2026-07-31", "2026-08-03", "2026-08-07", "2026-08-10", "2026-08-14"],
    );
});

test("每天预设的预览按天推进，而不是沿用周规则", () => {
    const repeatRule = rule({ frequency: "day", interval: 1 });
    const preview = previewRepeatOccurrences(repeatRule, "2026-07-27", "2026-07-27", 3);
    assert.deepEqual(
        preview.map((item) => item.due),
        ["2026-07-28", "2026-07-29", "2026-07-30"],
    );
});

test("年度重复支持闰日并保留时间部分", () => {
    const repeatRule = rule({ frequency: "year", overflow: "lastDay" });
    const initial = createRepeatState(repeatRule, "2024-02-29T09:00", "2024-02-29T17:30")!;

    const next = advanceRepeatState(repeatRule, initial, "2024-02-29T18:00", "complete");
    assert.equal(next.state.currentStart, "2025-02-28T09:00");
    assert.equal(next.state.currentDue, "2025-02-28T17:30");
});
