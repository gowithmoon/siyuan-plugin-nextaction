import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_SETTINGS, mergeSettings, normalizeSettings, validateSettings } from "../src/shared/settings.ts";
import { taskDetailDraftKey, type TaskDetailDraft } from "../src/frontend/utils/task-detail-draft.ts";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("任务详情的抽屉与独立 Dialog 共享保存和关闭契约", () => {
    const detail = source("../src/frontend/components/TaskDetail.svelte");
    const session = source("../src/frontend/controllers/task-detail-controller.ts");
    const app = source("../src/frontend/components/Workspace.svelte");
    const editor = source("../src/frontend/controllers/editor-task-integration.ts");
    const dialog = source("../src/frontend/dialogs/task-detail-dialog.ts");

    assert.match(app, /<TaskDetail[\s\S]*bind:this=\{detailComponent\}/);
    assert.match(editor, /openSharedTaskDetailDialog\(\{/);
    assert.match(dialog, /mountSvelteComponentAsync\([\s\S]*dialogMode: true/);
    assert.match(app, /detailComponent\.requestClose\(\)/);
    assert.match(dialog, /detail\?\.instance\?\.requestClose\(\)/);
    assert.match(detail, /new TaskDetailSession\(task/);
    assert.match(session, /options\.debounceMs \?\? 500/);
    assert.match(detail, /event\.key\.toLowerCase\(\) === "s"/);
    assert.match(detail, /export async function requestClose\(\)/);
    assert.match(detail, /onConfirmDiscard/);
    assert.match(detail, /onDestroy\(\(\) =>/);
    assert.doesNotMatch(app, /taskAfterClose/);
    assert.match(app, /viewAfterClose/);
});

test("任务详情草稿签名覆盖全部可编辑字段", () => {
    const draft: TaskDetailDraft = {
        status: "todo",
        priority: "high",
        importance: 6,
        effort: 3,
        due: "2026-08-20",
        start: "2026-08-17",
        note: "note",
        outcome: "Outcome",
        dod: "Definition of done",
        actionKind: "stage",
        contexts: ["home"],
        taskTags: ["phase-five"],
        parentId: "project",
        depends: ["dependency"],
        depMode: "all",
        sequentialEnabled: true,
        taskType: "1",
        reviewInterval: 7,
        reviewDate: "2026-08-23",
        customFieldValues: { owner: "me" },
    };
    const baseline = taskDetailDraftKey(draft);

    for (const key of Object.keys(draft) as Array<keyof TaskDetailDraft>) {
        const changed = structuredClone(draft);
        if (key === "contexts") changed.contexts = ["office"];
        else if (key === "taskTags") changed.taskTags = ["changed"];
        else if (key === "depends") changed.depends = ["other"];
        else if (key === "customFieldValues") changed.customFieldValues = { owner: "other" };
        else if (key === "importance" || key === "effort" || key === "reviewInterval") changed[key] += 1;
        else if (key === "sequentialEnabled") changed[key] = !changed[key];
        else changed[key] = `${changed[key]}-changed`;
        assert.notEqual(taskDetailDraftKey(changed), baseline, `${key} 必须参与草稿脏状态判断`);
    }
});

test("项目看板写入保持 NextActionApp 单一适配边界", () => {
    const view = source("../src/frontend/components/ProjectView.svelte");
    const app = source("../src/frontend/components/Workspace.svelte");

    assert.match(view, /onTaskUpdate/);
    assert.match(view, /onTaskReorder/);
    assert.doesNotMatch(view, /KernelBridge|bridge\.updateTask|bridge\.reorderTask/);
    assert.match(app, /await bridge\.updateTask\(task\.blockId, attrs\)[\s\S]*taskStore\.applyUpdate\(updated\)/);
    assert.match(
        app,
        /await bridge\.reorderTask\(blockId, parentId, afterId\)[\s\S]*taskStore\.applyUpdate\(updated\)/,
    );
    assert.match(app, /onTaskUpdate=\{handleProjectTaskUpdate\}/);
    assert.match(app, /onTaskReorder=\{handleProjectTaskReorder\}/);
});

test("当前设置部分更新保留默认值、任务创建目标和用户 AI 提示词", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
        defaultImportance: 7,
        taskCreationSettings: {
            ...DEFAULT_SETTINGS.taskCreationSettings,
            defaultCreateTarget: "daily_note",
        },
        aiSettings: {
            prompts: {
                ...DEFAULT_SETTINGS.aiSettings.prompts,
                review: "保留我的自定义回顾提示词",
            },
        },
    });

    assert.equal(merged.defaultImportance, 7);
    assert.equal(merged.defaultEffort, DEFAULT_SETTINGS.defaultEffort);
    assert.equal(merged.taskCreationSettings.defaultCreateTarget, "daily_note");
    assert.equal(merged.aiSettings.prompts.review, "保留我的自定义回顾提示词");
});

test("旧版持久化设置逐字段归一化并保留自定义字段", () => {
    const customField = {
        version: 2 as const,
        id: "owner-field",
        key: "owner",
        label: "委托给",
        description: "",
        type: "text" as const,
        status: "active" as const,
        scope: { mode: "all" as const },
        showOnCard: true,
    };
    // Regression: 新增提醒设置导致完整 settings 被拒绝后，下一次保存会清空 customFields。
    const normalized = normalizeSettings({
        ...DEFAULT_SETTINGS,
        customFields: [customField],
        reminderSettings: {
            enabled: true,
            defaultOffsets: [60, 720],
            dueSound: "chime",
            reviewSound: "soft",
            soundEnabled: true,
        },
        mcpSettings: { enabled: true, allowWrite: false, defaultCreateTarget: "daily_note" },
        taskCreationSettings: { inboxDocumentId: "" },
        priorityEngine: { ...DEFAULT_SETTINGS.priorityEngine, overdueBase: 42, dueDecayTau: 99 },
        defaultImportance: 99,
        aiSettings: { prompts: { review: 12 } },
    });

    assert.deepEqual(normalized.customFields, [customField]);
    assert.equal(
        normalized.reminderSettings.systemNotificationEnabled,
        DEFAULT_SETTINGS.reminderSettings.systemNotificationEnabled,
    );
    assert.equal(normalized.taskCreationSettings.defaultCreateTarget, "daily_note");
    assert.equal(normalized.defaultImportance, DEFAULT_SETTINGS.defaultImportance);
    assert.equal(normalized.priorityEngine.overdueBase, 42);
    assert.equal(normalized.priorityEngine.dueDecayTau, DEFAULT_SETTINGS.priorityEngine.dueDecayTau);
    assert.equal(normalized.aiSettings.prompts.review, DEFAULT_SETTINGS.aiSettings.prompts.review);
    assert.equal(validateSettings(normalized), null);
    assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
});

test("设置保存链当前由面板持久化、宿主执行后处理", () => {
    const panel = source("../src/frontend/components/SettingsPanel.svelte");
    const host = source("../src/frontend/controllers/settings-dialog-controller.ts");

    assert.match(panel, /controller\.save\(\(settings\) => bridge\.updateSettings\(settings\)\)/);
    assert.match(panel, /await controller\.refreshAfterSave\(onSave/);
    assert.match(panel, /settingsSavedRefreshFailed/);
    assert.match(host, /await this\.bridge\.recalcAllOrders\(\)/);
    assert.match(host, /taskStore\.applySettingsUpdate\(settings\)/);
    assert.match(host, /finally \{[\s\S]*?taskStore\.loadTasks\(\)/);
    assert.match(host, /\.b3-dialog__scrim/);
    assert.match(panel, /event\.key !== "Escape"/);
    assert.match(panel, /export async function requestClose\(\)/);
});
