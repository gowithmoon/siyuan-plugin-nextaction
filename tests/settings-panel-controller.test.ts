import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, type PluginSettings } from "../src/shared/settings.ts";
import { SettingsPanelController } from "../src/frontend/controllers/settings-panel-controller.ts";

function controller(): SettingsPanelController {
    return new SettingsPanelController({
        formatError: (error) => (error as Error).message || String(error),
        formatValidationError: (error) => `validation:${error}`,
    });
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((ok) => {
        resolve = ok;
    });
    return { promise, resolve };
}

test("加载当前设置结构并保持任务创建目标", () => {
    const model = controller();
    model.beginLoad();
    const loaded = model.load({
        ...DEFAULT_SETTINGS,
        defaultImportance: 7,
        taskCreationSettings: { ...DEFAULT_SETTINGS.taskCreationSettings, defaultCreateTarget: "daily_note" },
    });
    assert.equal(loaded.defaultImportance, 7);
    assert.equal(loaded.defaultEffort, DEFAULT_SETTINGS.defaultEffort);
    assert.equal(loaded.taskCreationSettings.defaultCreateTarget, "daily_note");
    assert.equal(model.snapshot.loadState, "loaded");
    assert.equal(model.snapshot.dirty, false);
});

test("saved 与 draft 比较驱动脏状态并保留当前页面", () => {
    const model = controller();
    model.load(DEFAULT_SETTINGS);
    model.setPage("ai");
    model.edit({ ...model.snapshot.draft, defaultImportance: 6 });
    assert.equal(model.snapshot.dirty, true);
    assert.equal(model.snapshot.page, "ai");
    model.edit(model.snapshot.saved);
    assert.equal(model.snapshot.dirty, false);
    assert.equal(model.snapshot.page, "ai");
});

test("移动设置从分类进入详情并返回时保留草稿与当前分类", () => {
    const model = controller();
    model.load(DEFAULT_SETTINGS);
    model.edit({ ...model.snapshot.draft, defaultImportance: 8 });
    model.setPage("advanced");
    assert.equal(model.snapshot.categoryDetailOpen, true);
    assert.equal(model.backToCategories(), true);
    assert.equal(model.snapshot.categoryDetailOpen, false);
    assert.equal(model.snapshot.page, "advanced");
    assert.equal(model.snapshot.draft.defaultImportance, 8);
    assert.equal(model.snapshot.dirty, true);
    assert.equal(model.backToCategories(), false);
});

test("持久化成功立即清除脏状态且后处理错误不会重新变脏", async () => {
    const model = controller();
    model.load(DEFAULT_SETTINGS);
    model.edit({ ...model.snapshot.draft, defaultEffort: 7 });
    const saved = await model.save(async (settings) => settings);
    assert.equal(saved?.defaultEffort, 7);
    assert.equal(model.snapshot.dirty, false);
    model.reportPostSaveError("settings saved but refresh failed");
    assert.equal(model.snapshot.dirty, false);
    assert.equal(model.snapshot.saveState, "saved");
    assert.equal(model.snapshot.error, "settings saved but refresh failed");
});

test("持久化失败保留草稿和脏状态", async () => {
    const model = controller();
    model.load(DEFAULT_SETTINGS);
    model.edit({ ...model.snapshot.draft, defaultImportance: 5 });
    assert.equal(
        await model.save(async () => {
            throw new Error("offline");
        }),
        null,
    );
    assert.equal(model.snapshot.dirty, true);
    assert.equal(model.snapshot.draft.defaultImportance, 5);
    assert.equal(model.snapshot.error, "offline");
});

test("保存中关闭等待持久化并复用同一关闭决策", async () => {
    const model = controller();
    model.load(DEFAULT_SETTINGS);
    model.edit({ ...model.snapshot.draft, defaultImportance: 5 });
    const pending = deferred<PluginSettings>();
    const saving = model.save(() => pending.promise);
    const closing = model.requestClose();
    pending.resolve({ ...DEFAULT_SETTINGS, defaultImportance: 5 });
    assert.equal((await saving)?.defaultImportance, 5);
    assert.equal(await closing, "close");
});

test("恢复和维护动作共享确认状态但保持不同语义", async () => {
    const model = controller();
    model.load(DEFAULT_SETTINGS);
    model.requestAction({ id: "reset:all", kind: "draft" });
    assert.deepEqual(model.confirmAction(), { id: "reset:all", kind: "draft" });
    model.requestAction({ id: "maintenance:cache", kind: "maintenance" });
    model.cancelAction();
    assert.equal(model.snapshot.pendingAction, null);

    const operation = deferred<number>();
    const running = model.runMaintenance("cache", () => operation.promise);
    assert.equal(model.snapshot.maintenanceBusy.has("cache"), true);
    assert.equal(model.snapshot.dirty, false);
    operation.resolve(1);
    assert.equal(await running, 1);
    assert.equal(model.snapshot.maintenanceBusy.has("cache"), false);
});
