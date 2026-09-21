import test from "node:test";
import assert from "node:assert/strict";
import { taskFactory } from "./helpers/fakes.ts";
import {
    buildPlanSnapshot,
    buildTriggerKey,
    calculateNotificationTriggers,
    diffPlanSnapshot,
    isSameTriggerTimes,
} from "../src/frontend/utils/mobile-notification-planner.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

function localDateMs(date: string, hour: number, minute = 0): number {
    const [year, month, day] = date.split("-").map(Number);
    return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

function localDateString(nowMs = Date.now()): string {
    const date = new Date(nowMs);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

test("absolute 提醒只保留未来且在计划窗口内的触发点", () => {
    const now = localDateMs("2030-01-01", 8);
    const task = taskFactory("absolute-task", {
        reminder: JSON.stringify([{ type: "absolute", time: "2030-01-01T10:00" }]),
    });
    const [trigger] = calculateNotificationTriggers(task, now, DAY_MS);
    assert.equal(trigger.kind, "absolute");
    assert.equal(trigger.triggerTimeMs, localDateMs("2030-01-01", 10));
    assert.equal(calculateNotificationTriggers(task, localDateMs("2030-01-01", 11), DAY_MS).length, 0);
    assert.equal(
        calculateNotificationTriggers(
            taskFactory("horizon", {
                reminder: JSON.stringify([{ type: "absolute", time: "2030-01-02T08:00" }]),
            }),
            now,
            DAY_MS,
        ).length,
        0,
    );
});

test("relative 精确 due 使用提前分钟数计算触发点", () => {
    const due = "2030-01-02T12:00";
    const now = localDateMs("2030-01-01", 9);
    const [trigger] = calculateNotificationTriggers(
        taskFactory("relative-task", {
            due,
            reminder: JSON.stringify([{ type: "relative", minutes: 60 }]),
        }),
        now,
        2 * DAY_MS,
    );
    assert.equal(trigger.kind, "relative");
    assert.equal(trigger.triggerTimeMs, localDateMs("2030-01-02", 11));
    assert.equal(trigger.minutesBefore, 60);
    assert.equal(trigger.baseDateStr, "2030-01-02");
});

test("relative 纯日期 due 按当天 23:59:59 解释", () => {
    const now = localDateMs("2030-01-01", 9);
    const dueMs = localDateMs("2030-01-02", 0) + 86_399_000;
    const [trigger] = calculateNotificationTriggers(
        taskFactory("date-task", {
            due: "2030-01-02",
            reminder: JSON.stringify([{ type: "relative", minutes: 60 }]),
        }),
        now,
        2 * DAY_MS,
    );
    assert.equal(trigger.triggerTimeMs, dueMs - 60 * 60_000);
    assert.equal(
        calculateNotificationTriggers(
            taskFactory("expired", {
                due: "2029-12-31",
                reminder: JSON.stringify([{ type: "relative", minutes: 60 }]),
            }),
            now,
            2 * DAY_MS,
        ).length,
        0,
    );
});

test("review 使用固定的本地 09:00，并跳过已过时间", () => {
    const today = localDateString(localDateMs("2030-01-02", 8));
    const task = taskFactory("review-task", { reviewDate: today });
    const [trigger] = calculateNotificationTriggers(task, localDateMs("2030-01-02", 8), DAY_MS);
    assert.equal(trigger.kind, "review");
    assert.equal(trigger.triggerTimeMs, localDateMs("2030-01-02", 9));
    assert.equal(calculateNotificationTriggers(task, localDateMs("2030-01-02", 10), DAY_MS).length, 0);
});

test("done、someday 和没有提醒来源的任务不生成触发点", () => {
    const now = localDateMs("2030-01-01", 8);
    const reminder = JSON.stringify([{ type: "absolute", time: "2030-01-01T10:00" }]);
    assert.equal(
        calculateNotificationTriggers(taskFactory("done", { status: "done", reminder }), now, DAY_MS).length,
        0,
    );
    assert.equal(
        calculateNotificationTriggers(taskFactory("someday", { status: "someday", reminder }), now, DAY_MS).length,
        0,
    );
    assert.equal(calculateNotificationTriggers(taskFactory("empty"), now, DAY_MS).length, 0);
});

test("同一任务的多个提醒项全部保留并按触发时间排序", () => {
    const task = taskFactory("many", {
        due: "2030-01-02T12:00",
        reminder: JSON.stringify([
            { type: "relative", minutes: 60 },
            { type: "absolute", time: "2030-01-02T08:00" },
            { type: "relative", minutes: 120 },
        ]),
    });
    const triggers = calculateNotificationTriggers(task, localDateMs("2030-01-01", 8), 2 * DAY_MS);
    assert.deepEqual(
        triggers.map((trigger) => [trigger.kind, trigger.triggerTimeMs]),
        [
            ["absolute", localDateMs("2030-01-02", 8)],
            ["relative", localDateMs("2030-01-02", 10)],
            ["relative", localDateMs("2030-01-02", 11)],
        ],
    );
});

test("计划快照和 diff 区分新增、删除、变化和未变化任务", () => {
    const now = localDateMs("2030-01-01", 8);
    const first = buildPlanSnapshot(
        [
            taskFactory("same", { reminder: JSON.stringify([{ type: "absolute", time: "2030-01-01T10:00" }]) }),
            taskFactory("removed", { reminder: JSON.stringify([{ type: "absolute", time: "2030-01-01T11:00" }]) }),
        ],
        now,
        DAY_MS,
    );
    const second = buildPlanSnapshot(
        [
            taskFactory("same", { reminder: JSON.stringify([{ type: "absolute", time: "2030-01-01T10:00" }]) }),
            taskFactory("changed", { reminder: JSON.stringify([{ type: "absolute", time: "2030-01-01T12:00" }]) }),
        ],
        now,
        DAY_MS,
    );
    const previous = new Map(first);
    previous.set("changed", [localDateMs("2030-01-01", 9)]);
    assert.deepEqual(diffPlanSnapshot(previous, second), {
        toCancel: ["removed"],
        toRebuild: ["changed"],
        unchanged: ["same"],
    });
});

test("触发时间比较和稳定触发键遵循长度、顺序及 kind", () => {
    assert.equal(isSameTriggerTimes([1, 2], [1, 2]), true);
    assert.equal(isSameTriggerTimes([1, 2], [1]), false);
    assert.equal(isSameTriggerTimes([1, 2], [2, 1]), false);
    const trigger = {
        blockId: "task",
        title: "Task",
        triggerTimeMs: 123,
        kind: "relative" as const,
        minutesBefore: 60,
        baseDateStr: "2030-01-01",
    };
    assert.equal(buildTriggerKey(trigger), "task|123|relative");
    assert.notEqual(buildTriggerKey(trigger), buildTriggerKey({ ...trigger, triggerTimeMs: 124 }));
});
