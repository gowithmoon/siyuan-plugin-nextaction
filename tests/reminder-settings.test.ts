import test from "node:test";
import assert from "node:assert/strict";
import {
    DEFAULT_SETTINGS,
    mergeSettings,
    normalizeSettings,
    validateSettings,
    type ReminderDeliveryMode,
} from "../src/shared/settings.ts";

test("提醒方式默认使用应用内提醒并接受三个互斥值", () => {
    // Regression: 两个独立开关允许应用内提醒和系统通知同时启用。
    assert.equal(DEFAULT_SETTINGS.reminderSettings.deliveryMode, "in-app");

    for (const deliveryMode of ["in-app", "system", "none"] satisfies ReminderDeliveryMode[]) {
        const normalized = normalizeSettings({
            ...DEFAULT_SETTINGS,
            reminderSettings: { ...DEFAULT_SETTINGS.reminderSettings, deliveryMode },
        });
        assert.equal(normalized.reminderSettings.deliveryMode, deliveryMode);
        assert.equal(validateSettings({ reminderSettings: { deliveryMode } as never }), null);
    }
});

test("非法提醒方式不会进入已保存设置", () => {
    const normalized = normalizeSettings({
        ...DEFAULT_SETTINGS,
        reminderSettings: { ...DEFAULT_SETTINGS.reminderSettings, deliveryMode: "both" },
    });

    assert.equal(normalized.reminderSettings.deliveryMode, "in-app");
    assert.equal(
        validateSettings({ reminderSettings: { deliveryMode: "both" } as never }),
        "reminderSettings.deliveryMode must be 'in-app', 'system', or 'none'",
    );
});

test("提醒设置只保存单一投递方式，不保留旧双开关", () => {
    // Regression: 旧投递布尔值即使由 deliveryMode 派生，仍会继续污染设置契约。
    const normalized = normalizeSettings({
        ...DEFAULT_SETTINGS,
        reminderSettings: {
            ...DEFAULT_SETTINGS.reminderSettings,
            deliveryMode: "system",
            enabled: true,
            systemNotificationEnabled: false,
        },
    });
    assert.equal(normalized.reminderSettings.deliveryMode, "system");
    assert.equal("enabled" in normalized.reminderSettings, false);
    assert.equal("systemNotificationEnabled" in normalized.reminderSettings, false);

    const disabled = mergeSettings(DEFAULT_SETTINGS, {
        reminderSettings: {
            ...DEFAULT_SETTINGS.reminderSettings,
            deliveryMode: "none",
            enabled: true,
            systemNotificationEnabled: true,
        } as never,
    });
    assert.equal(disabled.reminderSettings.deliveryMode, "none");
    assert.equal("enabled" in disabled.reminderSettings, false);
    assert.equal("systemNotificationEnabled" in disabled.reminderSettings, false);

    const withoutMigration = normalizeSettings({
        ...DEFAULT_SETTINGS,
        reminderSettings: {
            ...DEFAULT_SETTINGS.reminderSettings,
            deliveryMode: undefined,
            enabled: false,
            systemNotificationEnabled: true,
        },
    });
    assert.equal(withoutMigration.reminderSettings.deliveryMode, "in-app");
    assert.equal("enabled" in withoutMigration.reminderSettings, false);
    assert.equal("systemNotificationEnabled" in withoutMigration.reminderSettings, false);
});
