import test from "node:test";
import assert from "node:assert/strict";

import {
    getReminderState,
    parseReminderItems,
    resolveReminderItems,
    serializeReminderItems,
} from "../src/frontend/utils/reminder-utils.ts";
import { DEFAULT_REMINDER_SETTINGS } from "../src/shared/settings.ts";
import { validateTaskAttrs } from "../src/kernel/utils.ts";
import { ATTR_REMINDER } from "../src/shared/constants.ts";

test("结构化提醒支持空值、空数组和当前对象数组", () => {
    const items = [
        { type: "relative" as const, minutes: 60 },
        { type: "absolute" as const, time: "2026-08-18T09:30" },
    ];
    assert.deepEqual(parseReminderItems(""), []);
    assert.deepEqual(parseReminderItems("[]"), []);
    assert.deepEqual(parseReminderItems(serializeReminderItems(items)), items);
    assert.equal(validateTaskAttrs({ [ATTR_REMINDER]: JSON.stringify(items) }), null);
});

test("旧 enabled 和数字数组提醒不再被接受", () => {
    // Regression: legacy reminder sentinels and numeric offsets must not be migrated.
    assert.deepEqual(parseReminderItems("enabled"), []);
    assert.deepEqual(parseReminderItems("[60,1440]"), []);
    assert.match(validateTaskAttrs({ [ATTR_REMINDER]: "enabled" }) ?? "", /valid JSON/);
    assert.match(validateTaskAttrs({ [ATTR_REMINDER]: "[60,1440]" }) ?? "", /must be objects/);
});

test("全局默认提醒仅回退空值，明确禁用和非法值不回退", () => {
    const settings = { ...DEFAULT_REMINDER_SETTINGS, useGlobalDefaultReminders: true };
    assert.equal(getReminderState("  "), "inherit");
    // Regression: legacy task snapshots may omit the reminder attribute.
    assert.equal(getReminderState(undefined as never), "inherit");
    assert.equal(getReminderState("[]"), "disabled");
    assert.equal(getReminderState("[60]"), "invalid");
    assert.equal(getReminderState('[{"type":"unknown"}]'), "invalid");
    assert.equal(resolveReminderItems("  ", settings, true).length, settings.defaultOffsets.length);
    assert.deepEqual(resolveReminderItems("[]", settings, true), []);
    assert.deepEqual(resolveReminderItems("not-json", settings, true), []);
    assert.deepEqual(resolveReminderItems('[{"type":"unknown"}]', settings, true), []);
    assert.deepEqual(resolveReminderItems("", { ...settings, useGlobalDefaultReminders: false }, true), []);
    assert.deepEqual(resolveReminderItems("", settings, false), []);
    assert.deepEqual(resolveReminderItems("", undefined, true), []);
    assert.deepEqual(resolveReminderItems("", { ...settings, defaultOffsets: [] }, true), []);
});

test("任务级自定义提醒优先于全局默认", () => {
    const settings = { ...DEFAULT_REMINDER_SETTINGS, useGlobalDefaultReminders: true };
    assert.deepEqual(resolveReminderItems(JSON.stringify([{ type: "relative", minutes: 30 }]), settings, true), [
        { type: "relative", minutes: 30 },
    ]);
});
