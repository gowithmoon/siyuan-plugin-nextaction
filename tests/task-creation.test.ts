import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isMobileCreateTaskFrontend } from "../src/frontend/dialogs/create-task-routing";

import {
    DEFAULT_TASK_CREATION_SETTINGS,
    mergeTaskCreationSettings,
    validateTaskCreationSettings,
} from "../src/shared/task-creation.ts";

function source(path: string): string {
    return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("任务创建设置限制最近目标并保留命名预设", () => {
    const recentTargets = [0, 1, 2, 3].map((index) => ({
        type: "document" as const,
        format: "paragraph" as const,
        documentId: `20260808120${index}00-abcdefg`,
        documentTitle: `文档 ${index}`,
    }));
    const settings = mergeTaskCreationSettings(DEFAULT_TASK_CREATION_SETTINGS, {
        recentTargets,
        presets: [{ id: "work", name: "工作", target: recentTargets[0] }],
    });

    assert.equal(settings.recentTargets.length, 3);
    assert.equal(settings.presets[0].name, "工作");
});

test("任务创建设置拒绝非法目标和重复预设 ID", () => {
    assert.match(
        validateTaskCreationSettings({ recentTargets: [{ type: "nowhere", format: "paragraph" } as any] }) ?? "",
        /invalid target/,
    );
    assert.match(
        validateTaskCreationSettings({ recentTargets: [{ type: "inbox", format: "list" } as any] }) ?? "",
        /invalid target/,
    );
    assert.match(
        validateTaskCreationSettings({
            presets: [
                { id: "same", name: "A", target: { type: "inbox", format: "paragraph" } },
                { id: "same", name: "B", target: { type: "inbox", format: "document" } },
            ],
        }) ?? "",
        /unique/,
    );
});

test("面板创建与 MCP 共用 createTask 内核入口和 canonical 返回值", () => {
    const kernel = source("../src/kernel.ts");
    const rpc = source("../src/kernel/rpc-server.ts");
    const contract = source("../src/shared/rpc-methods.ts");
    const bridge = source("../src/frontend/kernel-bridge.ts");
    const dialog = source("../src/frontend/components/CreateTaskDialog.svelte");
    const dialogHost = source("../src/frontend/dialogs/create-task-dialog.ts");

    assert.match(kernel, /createTask,\s*\n\s*aiProposalService/);
    assert.match(kernel, /this\.taskCreationService\.create/);
    assert.match(contract, /createTask:\s*defineRpc/);
    assert.match(rpc, /createTask:\s*\(input\)\s*=>\s*\(hooks\.createTask/);
    assert.match(rpc, /for \(const method of RPC_METHOD_NAMES\)/);
    assert.match(bridge, /createTask\(input:\s*CreateTaskInput\)/);
    assert.match(dialog, /bridge\.createTask\(input\)/);
    assert.match(dialog, /bridge\.getTask\(id\)/);
    assert.match(dialogHost, /create-task-dialog\.scss\?inline/);
    assert.match(dialogHost, /style\.textContent = createTaskDialogStyles/);
});

test("移动端外部创建入口使用共享全屏宿主并保持回调关闭顺序", () => {
    // Regression: 移动端编辑器入口曾始终创建固定宽度 Dialog，绕过页面栈与草稿关闭保护。
    assert.equal(isMobileCreateTaskFrontend("mobile"), true);
    assert.equal(isMobileCreateTaskFrontend("browser-mobile"), true);
    assert.equal(isMobileCreateTaskFrontend("desktop"), false);
    const mobileHost = source("../src/frontend/components/MobileCreateTaskHost.svelte");
    const dialogHost = source("../src/frontend/dialogs/create-task-dialog.ts");
    assert.match(dialogHost, /MobileCreateTaskHost\.svelte/);
    assert.match(mobileHost, /provideWorkspace\(\s*"mobile-dock"/);
    assert.match(mobileHost, /createComponent\?\.requestClose\(\)/);
    assert.match(mobileHost, /onCreated\?\.\(task\);\s*await onClose\(\)/);
});

test("任务创建支持原生任务块与文档块", () => {
    const manager = source("../src/kernel/task-creation-service.ts") + source("../src/kernel/mcp-tool-executor.ts");
    const cache = source("../src/kernel/cache-manager.ts");

    assert.match(manager, /format:\s*\{\s*type:\s*"string",\s*enum:\s*\[\.\.\.CREATE_TASK_FORMATS\]/);
    assert.match(manager, /destination\.format === undefined[\s\S]*\? "paragraph"/);
    assert.match(manager, /kind === "2" \|\| format === "document"/);
    assert.match(manager, /block destinations always use paragraph format/);
    assert.doesNotMatch(manager, /format === "list"/);
    assert.match(manager, /insertedMeta = await this\.targets\.resolveInsertedTaskBlock\(insertedMeta\)/);
    assert.match(cache, /b\.type = 'd'/);
    assert.match(cache, /task\.type = 'i'/);
    assert.match(cache, /task\.subtype = 't'/);
});

test("文档创建通过文档接口回滚", () => {
    const manager = source("../src/kernel/task-creation-service.ts") + source("../src/kernel/task-target-resolver.ts");

    assert.match(manager, /createChildDocument\(title, destination\)/);
    assert.match(manager, /\/api\/filetree\/createDocWithMd/);
    assert.match(manager, /projects require a document destination/);
    assert.match(manager, /\/api\/filetree\/removeDocByID/);
});

test("默认创建位置来自任务创建设置而不是 MCP 设置", () => {
    const manager = source("../src/kernel/task-creation-service.ts");
    const dialog = source("../src/frontend/components/CreateTaskDialog.svelte");
    const settings = source("../src/frontend/components/SettingsPanel.svelte");
    const general = source("../src/frontend/components/settings/GeneralSettingsPage.svelte");
    const mcp = source("../src/frontend/components/settings/McpSettingsPage.svelte");
    const sharedSettings = source("../src/shared/settings.ts");

    assert.match(manager, /settings\.taskCreationSettings\.defaultCreateTarget/);
    assert.match(dialog, /initialSettings\.taskCreationSettings\.defaultCreateTarget/);
    assert.match(settings, /taskCreationSettings:\s*\{[\s\S]*defaultCreateTarget: taskCreationDefaultCreateTarget/);
    assert.match(general, /settingTaskCreationDefaultTarget/);
    assert.doesNotMatch(mcp, /settingMcpCreateTarget|mcpDefaultCreateTarget/);
    assert.doesNotMatch(sharedSettings, /legacyMcp|migratedTaskCreation|Older versions stored/);
});

test("文档选择器只使用思源搜索接口且不暴露 ID 输入", () => {
    const manager = source("../src/kernel/task-target-resolver.ts");
    const picker = source("../src/frontend/ui/NaDocumentPicker.svelte");
    const dialog = source("../src/frontend/components/CreateTaskDialog.svelte");
    const settings = source("../src/frontend/components/SettingsPanel.svelte");
    const general = source("../src/frontend/components/settings/GeneralSettingsPage.svelte");

    assert.match(manager, /\/api\/filetree\/searchDocs/);
    assert.match(manager, /\/api\/filetree\/getIDsByHPath/);
    assert.match(manager, /extractDocumentIdFromPath\(result\.path\)/);
    assert.match(picker, /searchMcpTargetDocuments/);
    assert.doesNotMatch(picker, /listMcpTargetDocuments|createCurrentDocument|openChildren|breadcrumbs/);
    assert.match(dialog, /NaDocumentPicker/);
    assert.match(general, /NaDocumentPicker/);
    assert.match(settings, /inboxDocumentId: taskCreationInboxDocumentId\.trim\(\)/);
    assert.doesNotMatch(general, /placeholder=.*202\d{11}|siyuan:\/\/blocks\/|onUseCurrentDocument/);
    assert.doesNotMatch(dialog, /preset|recentTargets|NaDotRating/);
    assert.doesNotMatch(dialog, /placeholder=.*202\d{11}|siyuan:\/\/blocks/);
});

test("创建面板突出标题和常用属性并折叠低频字段", () => {
    const dialog = source("../src/frontend/components/CreateTaskDialog.svelte");
    const dialogHost = source("../src/frontend/dialogs/create-task-dialog.ts");
    const dialogStyles = source("../src/frontend/dialogs/create-task-dialog.scss");

    assert.match(dialog, /class="na-create-task__composer"/);
    assert.match(dialog, /<NaAccordion[\s\S]*createMoreProperties/);
    assert.match(dialog, /bind:open=\{morePropertiesOpen\}/);
    assert.match(dialog, /<NaDocumentPicker[\s\S]*fixedDropdown/);
    assert.doesNotMatch(dialog, /addToMyDay|createSchedule|scheduleStart|scheduleEnd/);
    assert.match(dialogHost, /width:\s*"640px"/);
    assert.match(dialogStyles, /width:\s*min\(640px,/);
});

test("面板提供全局和上下文创建入口", () => {
    const app = source("../src/frontend/components/Workspace.svelte");
    const project = source("../src/frontend/components/ProjectView.svelte");
    const detail = source("../src/frontend/components/TaskDetail.svelte");
    const dialog = source("../src/frontend/components/CreateTaskDialog.svelte");

    assert.match(app, /openCreateTaskDialog/);
    assert.match(app, /variant="primary" icon="iconAdd"/);
    assert.match(project, /onCreateChild/);
    assert.match(detail, /createChildTask/);
    assert.match(dialog, /parentTask \? \{ parentId: parentTask\.blockId \}/);
});
