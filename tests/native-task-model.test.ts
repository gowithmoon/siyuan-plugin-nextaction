import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { CacheManager } from "../src/kernel/cache-manager.ts";
import { Mutex } from "../src/kernel/mutex.ts";
import { TaskRepository } from "../src/kernel/task-repository.ts";
import { TaskService } from "../src/kernel/task-service.ts";
import { TaskIdentityResolver } from "../src/kernel/task-identity-resolver.ts";
import { TaskCreationService } from "../src/kernel/task-creation-service.ts";
import { TaskTargetResolver } from "../src/kernel/task-target-resolver.ts";
import { DEFAULT_SETTINGS } from "../src/shared/settings.ts";
import { ATTR_PARENT, ATTR_STATUS, ATTR_TASK, RPC_ERROR_PROJECT_REQUIRES_DOCUMENT } from "../src/shared/constants.ts";
import { isNativeTaskStructure } from "../src/shared/task-identity.ts";
import { FakeMyDayTaskPort, FakeSiyuanApi, FakeTaskChangePublisher, taskFactory } from "./helpers/fakes.ts";

const TASK_ID = "20260818120000-taskitm";
const TEXT_ID = "20260818120001-tasktxt";

function setupNativeTask(markdown = "- [ ] Native task") {
    const api = new FakeSiyuanApi();
    api.addBlock(TASK_ID, "i", "Native task", "notebook", "/Native", { subtype: "t", markdown });
    api.addBlock(TEXT_ID, "p", "Native task", "notebook", "/Native", { parentId: TASK_ID });
    const cache = new CacheManager(api);
    cache.set(
        taskFactory(TASK_ID, {
            identificationSource: "native",
            attrHostId: TASK_ID,
            contentBlockId: TEXT_ID,
            status: markdown.includes("[ ]") ? "inbox" : "done",
        }),
    );
    const repository = new TaskRepository(api, cache, new Mutex(), new FakeTaskChangePublisher(), DEFAULT_SETTINGS);
    const service = new TaskService(cache, repository, new FakeMyDayTaskPort(), api);
    service.setIsReady(true);
    return { api, cache, service };
}

test("缓存双路发现文档任务与无属性原生任务", async () => {
    // Regression: native task list items must not depend on custom-na-task to enter the cache.
    const statements: string[] = [];
    let page = 0;
    const api = {
        query: async (statement: string) => {
            statements.push(statement);
            if (page++ > 0) return [];
            return [
                {
                    id: "20260818110000-project",
                    parent_id: "",
                    content_block_id: "",
                    title_content: "Project",
                    markdown: "",
                    structural_parent_id: "",
                    source: "document",
                    sort: 0,
                    updated: "20260818110000",
                },
                {
                    id: "20260818110001-nativea",
                    parent_id: "20260818110010-listaaa",
                    content_block_id: "20260818110002-textaaa",
                    title_content: "Unchecked",
                    markdown: "* [ ] Unchecked",
                    structural_parent_id: "",
                    source: "native",
                    sort: 20,
                    updated: "20260818110001",
                },
                {
                    id: "20260818110003-nativeb",
                    parent_id: "20260818110011-listbbb",
                    content_block_id: "20260818110004-textbbb",
                    title_content: "Checked",
                    markdown: "* [X] Checked",
                    structural_parent_id: "20260818110001-nativea",
                    source: "native",
                    sort: 30,
                    updated: "20260818110003",
                },
            ];
        },
        log: () => {},
    } as unknown as FakeSiyuanApi;
    const cache = new CacheManager(api);
    let batchReads = 0;
    await cache.loadAll(async () => {
        batchReads++;
        return {
            "20260818110000-project": { [ATTR_TASK]: "2", [ATTR_STATUS]: "todo" },
            "20260818110001-nativea": {},
            "20260818110003-nativeb": {},
        };
    });

    assert.equal(cache.get("20260818110000-project")?.identificationSource, "document");
    assert.equal(cache.get("20260818110001-nativea")?.status, "inbox");
    assert.equal(cache.get("20260818110003-nativeb")?.status, "done");
    assert.equal(cache.get("20260818110003-nativeb")?.parentId, "20260818110001-nativea");
    assert.equal(cache.get("20260818110001-nativea")?.contentBlockId, "20260818110002-textaaa");
    assert.match(statements[0], /b\.type = 'd'/);
    assert.match(statements[0], /task\.type = 'i'/);
    assert.match(statements[0], /task\.subtype = 't'/);
    assert.match(statements[0], /task_list\.subtype = 't'/);
    assert.equal(batchReads, 1);
});

test("缓存识别跨普通列表容器嵌套的原生子任务", async () => {
    // Regression: 普通段落和无序列表夹在两个任务之间时，孙任务曾被错误识别为根任务。
    const db = new DatabaseSync(":memory:");
    db.exec(`
        CREATE TABLE blocks (
            id TEXT PRIMARY KEY,
            parent_id TEXT NOT NULL,
            type TEXT NOT NULL,
            subtype TEXT NOT NULL,
            content TEXT NOT NULL,
            markdown TEXT NOT NULL,
            sort INTEGER NOT NULL,
            updated TEXT NOT NULL
        );
        CREATE TABLE attributes (
            block_id TEXT NOT NULL,
            name TEXT NOT NULL,
            value TEXT
        );
    `);
    const insert = db.prepare(
        "INSERT INTO blocks (id, parent_id, type, subtype, content, markdown, sort, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const outsideTaskId = "20260823130000-hiddenx";
    const documentId = "20260823130001-docroot";
    const parentTaskId = "20260823130653-ph774ex";
    const childTaskId = "20260823130705-swrypcg";
    const rows = [
        [outsideTaskId, "", "i", "t", "Outside", "- [ ] Outside", 0, "0"],
        [documentId, outsideTaskId, "d", "", "Document", "Document", 1, "1"],
        ["20260823130650-ify71an", documentId, "l", "t", "", "", 2, "2"],
        [parentTaskId, "20260823130650-ify71an", "i", "t", "Parent", "- [ ] Parent", 3, "3"],
        ["20260823130653-parentp", parentTaskId, "p", "", "Parent", "Parent", 4, "4"],
        ["20260823130659-l9lds9z", parentTaskId, "l", "u", "", "", 5, "5"],
        ["20260823130704-mkdueow", "20260823130659-l9lds9z", "i", "u", "Container", "- Container", 6, "6"],
        ["20260823130704-contain", "20260823130704-mkdueow", "p", "", "Container", "Container", 7, "7"],
        ["20260823130706-wufqpsz", "20260823130704-mkdueow", "l", "t", "", "", 8, "8"],
        [childTaskId, "20260823130706-wufqpsz", "i", "t", "Child", "- [ ] Child", 9, "9"],
        ["20260823130705-childpp", childTaskId, "p", "", "Child", "Child", 10, "10"],
    ] as const;
    for (const row of rows) insert.run(...row);

    const api = {
        query: async <T>(statement: string) => db.prepare(statement).all() as T[],
        log: () => {},
    } as unknown as FakeSiyuanApi;
    const cache = new CacheManager(api);

    try {
        await cache.loadAll(async () => ({}));
        assert.equal(cache.get(parentTaskId)?.parentId, "");
        assert.equal(cache.get(childTaskId)?.parentId, parentTaskId);
    } finally {
        db.close();
    }
});

test("普通任务创建返回 NodeListItem ID 并把默认属性写在列表项", async () => {
    // Regression: all creation callers must share the native task-list insertion path.
    const api = new FakeSiyuanApi();
    const documentId = "20260818115000-targetd";
    api.addBlock(documentId, "d", "Inbox", "notebook", "/Inbox");
    api.notebooks.push({ id: "notebook", name: "Notebook" });
    const cache = new CacheManager(api);
    const repository = new TaskRepository(api, cache, new Mutex(), new FakeTaskChangePublisher(), DEFAULT_SETTINGS);
    const service = new TaskService(cache, repository, new FakeMyDayTaskPort(), api);
    service.setIsReady(true);
    const settings = {
        ...DEFAULT_SETTINGS,
        taskCreationSettings: {
            ...DEFAULT_SETTINGS.taskCreationSettings,
            inboxDocumentId: documentId,
        },
    };
    const targets = new TaskTargetResolver(api, () => settings);
    const creation = new TaskCreationService(service, api, targets, () => settings);

    const outcome = await creation.create({
        title: "Created natively",
        destination: { type: "document", format: "paragraph", documentId },
    });

    assert.equal(outcome.task.identificationSource, "native");
    assert.equal(api.blocks.get(outcome.task.blockId)?.type, "i");
    assert.equal(api.blocks.get(outcome.task.blockId)?.subtype, "t");
    assert.ok(outcome.task.contentBlockId);
    assert.equal(api.blocks.get(outcome.task.blockId)?.attrs[ATTR_STATUS], "inbox");
    assert.equal(api.blocks.get(outcome.task.blockId)?.attrs[ATTR_TASK], undefined);
    assert.match(
        String(
            api.requests.find((request) => request.path === "/api/block/appendBlock")?.body &&
                (api.requests.find((request) => request.path === "/api/block/appendBlock")!.body as { data: string })
                    .data,
        ),
        /^- \[ \] Created natively$/,
    );
});

test("文档任务和文档项目继续使用 custom-na-task 且保持原块 ID", async () => {
    // Regression: native-task convergence must not change document task/project identity.
    const api = new FakeSiyuanApi();
    const documentId = "20260818115500-doctask";
    api.addBlock(documentId, "d", "Document task");
    const cache = new CacheManager(api);
    const repository = new TaskRepository(api, cache, new Mutex(), new FakeTaskChangePublisher(), DEFAULT_SETTINGS);
    const service = new TaskService(cache, repository, new FakeMyDayTaskPort(), api);
    service.setIsReady(true);

    const task = await service.convertToTask(documentId, undefined, "1");
    assert.equal(task.blockId, documentId);
    assert.equal(task.identificationSource, "document");
    assert.equal(api.blocks.get(documentId)?.attrs[ATTR_TASK], "1");

    const project = await service.convertToTask(documentId, undefined, "2");
    assert.equal(project.blockId, documentId);
    assert.equal(project.taskType, "2");
    assert.equal(api.blocks.get(documentId)?.attrs[ATTR_TASK], "2");
});

test("段落和标题转换为原生任务，递归转换跳过已有原生任务", async () => {
    // Regression: legacy paragraph/heading identities must be replaced by native task items.
    const api = new FakeSiyuanApi();
    const rootId = "20260818116000-rootdoc";
    const paragraphId = "20260818116001-paragra";
    const headingId = "20260818116002-heading";
    const nativeId = "20260818116003-nativei";
    const nativeTextId = "20260818116004-nativet";
    api.addBlock(rootId, "d", "Document");
    api.addBlock(paragraphId, "p", "Paragraph", "notebook", "/Document", { parentId: rootId });
    api.addBlock(headingId, "h", "Heading", "notebook", "/Document", { parentId: rootId });
    api.addBlock(nativeId, "i", "Existing", "notebook", "/Document", {
        subtype: "t",
        parentId: rootId,
        markdown: "- [ ] Existing",
    });
    api.addBlock(nativeTextId, "p", "Existing", "notebook", "/Document", { parentId: nativeId });
    const cache = new CacheManager(api);
    const repository = new TaskRepository(api, cache, new Mutex(), new FakeTaskChangePublisher(), DEFAULT_SETTINGS);
    const service = new TaskService(cache, repository, new FakeMyDayTaskPort(), api);
    service.setIsReady(true);

    const result = await service.convertToTaskWithChildren(rootId);
    assert.deepEqual(result, { converted: 2, skipped: 1 });
    assert.equal(api.blocks.get(paragraphId)?.type, "l");
    assert.equal(api.blocks.get(headingId)?.type, "l");
    assert.equal(api.blocks.get(nativeId)?.subtype, "t");
    assert.equal(cache.get(nativeId), undefined);
    assert.equal(cache.getAll().filter((task) => task.identificationSource === "native").length, 2);

    await assert.rejects(service.convertToTask(paragraphId, undefined, "2"), /errProjectRequiresDocument/);
});

test("无序列表上从父文本块触发含子项转换，父与子文本块都转为任务", async () => {
    // Regression: CTE 起点是文本块时，子树递归覆盖不到嵌套子列表的文本块。
    const api = new FakeSiyuanApi();
    const documentId = "20260920120000-docroot";
    const outerListId = "20260920120001-outlist";
    const outerItemId = "20260920120002-outitem";
    const parentTextId = "20260920120003-partxtx";
    const innerListId = "20260920120004-innlist";
    const innerItemId = "20260920120005-innitem";
    const childTextId = "20260920120006-chltxtx";
    api.addBlock(documentId, "d", "Document");
    api.addBlock(outerListId, "l", "", "notebook", "/Document", {
        parentId: documentId,
        subtype: "u",
    });
    api.addBlock(outerItemId, "i", "Parent", "notebook", "/Document", {
        parentId: outerListId,
        subtype: "u",
    });
    api.addBlock(parentTextId, "p", "Parent", "notebook", "/Document", { parentId: outerItemId });
    api.addBlock(innerListId, "l", "", "notebook", "/Document", {
        parentId: outerItemId,
        subtype: "u",
    });
    api.addBlock(innerItemId, "i", "Child", "notebook", "/Document", {
        parentId: innerListId,
        subtype: "u",
    });
    api.addBlock(childTextId, "p", "Child", "notebook", "/Document", { parentId: innerItemId });
    const cache = new CacheManager(api);
    const repository = new TaskRepository(api, cache, new Mutex(), new FakeTaskChangePublisher(), DEFAULT_SETTINGS);
    const service = new TaskService(cache, repository, new FakeMyDayTaskPort(), api);
    service.setIsReady(true);

    const result = await service.convertToTaskWithChildren(parentTextId);
    assert.deepEqual(result, { converted: 2, skipped: 0 });
    assert.equal(api.blocks.get(parentTextId)?.type, "l");
    assert.equal(api.blocks.get(parentTextId)?.subtype, "t");
    assert.equal(api.blocks.get(childTextId)?.type, "l");
    assert.equal(api.blocks.get(childTextId)?.subtype, "t");

    const nativeTasks = cache.getAll().filter((task) => task.identificationSource === "native");
    assert.equal(nativeTasks.length, 2);
    const parentTask = nativeTasks.find((task) => task.title === "Parent");
    const childTask = nativeTasks.find((task) => task.title === "Child");
    assert.ok(parentTask && childTask);
});

test("已有原生任务再次转换保持 ID 并补齐缺失属性", async () => {
    // Regression: convert-to-task on a native task is a no-op, not a nested task conversion.
    const { api, service } = setupNativeTask("- [X] Existing task");
    const result = await service.convertToTask(TASK_ID);
    assert.equal(result.blockId, TASK_ID);
    assert.equal(result.status, "done");
    assert.equal(api.blocks.get(TASK_ID)?.attrs[ATTR_STATUS], "done");
    assert.equal(api.blocks.get(TASK_ID)?.attrs[ATTR_TASK], undefined);
});

test("任务标记位于直属列表时，转换、未缓存更新和递归跳过使用同一身份", async () => {
    // Regression: task-list-owned items were accepted by cache loading but rejected by single-target operations.
    const api = new FakeSiyuanApi();
    const documentId = "20260823150000-docroot";
    const taskListId = "20260823150001-tasklst";
    const parentItemId = "20260823150002-parenti";
    const parentTextId = "20260823150003-parentp";
    const ordinaryListId = "20260823150004-ordlist";
    const ordinaryItemId = "20260823150005-orditem";
    const childTaskListId = "20260823150006-childls";
    const childItemId = "20260823150007-childit";
    const childTextId = "20260823150008-childtx";
    api.addBlock(documentId, "d", "Document");
    api.addBlock(taskListId, "l", "", "notebook", "/Document", { parentId: documentId, subtype: "t" });
    api.addBlock(parentItemId, "i", "Parent", "notebook", "/Document", {
        parentId: taskListId,
        subtype: "u",
        markdown: "- [ ] Parent",
    });
    api.addBlock(parentTextId, "p", "Parent", "notebook", "/Document", { parentId: parentItemId });
    api.addBlock(ordinaryListId, "l", "", "notebook", "/Document", {
        parentId: parentItemId,
        subtype: "u",
    });
    api.addBlock(ordinaryItemId, "i", "Container", "notebook", "/Document", {
        parentId: ordinaryListId,
        subtype: "u",
    });
    api.addBlock(childTaskListId, "l", "", "notebook", "/Document", {
        parentId: ordinaryItemId,
        subtype: "t",
    });
    api.addBlock(childItemId, "i", "Child", "notebook", "/Document", {
        parentId: childTaskListId,
        subtype: "u",
        markdown: "- [ ] Child",
    });
    api.addBlock(childTextId, "p", "Child", "notebook", "/Document", { parentId: childItemId });
    const cache = new CacheManager(api);
    const repository = new TaskRepository(api, cache, new Mutex(), new FakeTaskChangePublisher(), DEFAULT_SETTINGS);
    const service = new TaskService(cache, repository, new FakeMyDayTaskPort(), api);
    service.setIsReady(true);

    const updated = await service.updateTask(childItemId, { [ATTR_STATUS]: "doing" });
    assert.equal(updated.blockId, childItemId);
    assert.equal(updated.identificationSource, "native");
    assert.equal(updated.contentBlockId, childTextId);
    assert.equal(updated.parentId, parentItemId);
    assert.equal(api.blocks.get(childItemId)?.attrs[ATTR_PARENT], undefined);
    // Regression: default persistence (for example My Day) must not turn a structural parent into an explicit override.
    await service.addTaskToMyDay(childItemId);
    assert.equal(api.blocks.get(childItemId)?.attrs[ATTR_PARENT], undefined);

    const explicitParentId = "20260823150009-explict";
    api.addBlock(explicitParentId, "d", "Explicit parent");
    api.blocks.get(explicitParentId)!.attrs[ATTR_TASK] = "1";
    const explicitlyParented = await service.updateTask(childItemId, { [ATTR_PARENT]: explicitParentId });
    assert.equal(explicitlyParented.parentId, explicitParentId);
    const structurallyParented = await service.updateTask(childItemId, { [ATTR_PARENT]: "" });
    assert.equal(structurallyParented.parentId, parentItemId);
    assert.equal(api.blocks.get(childItemId)?.attrs[ATTR_PARENT], "");

    const parent = await service.convertToTask(parentItemId);
    assert.equal(parent.blockId, parentItemId);
    assert.equal(parent.identificationSource, "native");

    const recursive = await service.convertToTaskWithChildren(documentId);
    assert.deepEqual(recursive, { converted: 0, skipped: 2 });
});

test("损坏的祖先环不会把原生任务自身识别为结构父任务", async () => {
    // Regression: the starting task must be part of cycle detection, not a parent candidate.
    const api = new FakeSiyuanApi();
    const taskId = "20260823151000-cycletk";
    const listId = "20260823151001-cyclels";
    api.addBlock(taskId, "i", "Cyclic task", "notebook", "/Cycle", {
        parentId: listId,
        subtype: "t",
        markdown: "- [ ] Cyclic task",
    });
    api.addBlock(listId, "l", "", "notebook", "/Cycle", { parentId: taskId, subtype: "u" });
    const identities = new TaskIdentityResolver(api);

    const resolved = await identities.resolveTarget({
        blockId: taskId,
        taskType: "1",
        mode: "conversion",
        readAttrs: (blockIds) => api.batchGetBlockAttrs(blockIds),
    });

    assert.notEqual(resolved.kind, "convert-text");
    if (resolved.kind === "convert-text") return;
    assert.equal(resolved.identity.structuralParentId, "");
    assert.equal(resolved.identity.effectiveParentId, "");
});

test("移除由直属任务列表标记的单个任务后不会再次满足原生任务身份", async () => {
    // Regression: demoting only the list item leaves the task-marked parent list rediscoverable.
    const api = new FakeSiyuanApi();
    const documentId = "20260823152000-docroot";
    const taskListId = "20260823152001-tasklst";
    const itemId = "20260823152002-taskitm";
    const textId = "20260823152003-tasktxt";
    const siblingId = "20260823152004-sibling";
    const siblingTextId = "20260823152005-sibtxt";
    api.addBlock(documentId, "d", "Document");
    api.addBlock(taskListId, "l", "", "notebook", "/Document", { parentId: documentId, subtype: "t" });
    api.addBlock(itemId, "i", "Task", "notebook", "/Document", {
        parentId: taskListId,
        subtype: "u",
        markdown: "- [ ] Task",
    });
    api.addBlock(textId, "p", "Task", "notebook", "/Document", { parentId: itemId });
    api.addBlock(siblingId, "i", "Sibling", "notebook", "/Document", {
        parentId: taskListId,
        subtype: "u",
        markdown: "- [ ] Sibling",
    });
    api.addBlock(siblingTextId, "p", "Sibling", "notebook", "/Document", { parentId: siblingId });
    const cache = new CacheManager(api);
    const repository = new TaskRepository(api, cache, new Mutex(), new FakeTaskChangePublisher(), DEFAULT_SETTINGS);
    const service = new TaskService(cache, repository, new FakeMyDayTaskPort(), api);
    service.setIsReady(true);
    await service.convertToTask(itemId);

    await service.removeTask(itemId);

    const item = api.blocks.get(itemId)!;
    const parentList = api.blocks.get(taskListId)!;
    const sibling = api.blocks.get(siblingId)!;
    assert.equal(parentList.subtype, "u");
    assert.equal(sibling.subtype, "t");
    assert.equal(
        isNativeTaskStructure({
            type: sibling.type,
            subtype: sibling.subtype,
            parentType: parentList.type,
            parentSubtype: parentList.subtype,
        }),
        true,
    );
    assert.equal(
        isNativeTaskStructure({
            type: item.type,
            subtype: item.subtype,
            parentType: parentList.type,
            parentSubtype: parentList.subtype,
        }),
        false,
    );
});

test("原生任务不能更新为项目", async () => {
    // Regression: projects remain document-only even when the native task is already cached.
    const { service } = setupNativeTask();
    await assert.rejects(service.updateTask(TASK_ID, { [ATTR_TASK]: "2" }), (error: unknown) => {
        return (
            error instanceof Error && (error as Error & { code?: number }).code === RPC_ERROR_PROJECT_REQUIRES_DOCUMENT
        );
    });
});

test("六态业务状态投影为原生任务二态 marker", async () => {
    // Regression: editor status changes must keep custom-na-status and the native marker consistent.
    const { api, service } = setupNativeTask();
    for (const status of ["inbox", "todo", "doing", "waiting", "someday", "done"]) {
        const updated = await service.updateTask(TASK_ID, { [ATTR_STATUS]: status });
        assert.equal(updated.status, status);
        assert.equal(/\[X\]/.test(api.blocks.get(TASK_ID)!.markdown), status === "done");
        assert.equal(api.blocks.get(TASK_ID)?.attrs[ATTR_TASK], undefined);
    }
});

test("无属性原生任务首次加入 My Day 时持久化默认业务属性", async () => {
    // Regression: non-attribute actions must still cross the first-modification persistence boundary.
    const { api, service } = setupNativeTask();
    await service.addTaskToMyDay(TASK_ID);
    assert.equal(api.blocks.get(TASK_ID)?.attrs[ATTR_STATUS], "inbox");
    assert.ok(api.blocks.get(TASK_ID)?.attrs["custom-na-created"]);
    assert.equal(api.blocks.get(TASK_ID)?.attrs[ATTR_TASK], undefined);
});

test("marker 写入失败时不写任务属性", async () => {
    // Regression: a failed native marker write must stop before attribute persistence.
    const { api, service } = setupNativeTask();
    api.failPaths.add("/api/block/updateTaskListItemMarker");
    await assert.rejects(service.updateTask(TASK_ID, { [ATTR_STATUS]: "done" }));
    assert.equal(api.blocks.get(TASK_ID)?.attrs[ATTR_STATUS], undefined);
    assert.match(api.blocks.get(TASK_ID)!.markdown, /\[ \]/);
});

test("属性写入失败时回滚原生 marker", async () => {
    // Regression: a successful marker projection must be undone if custom-na attrs fail.
    const { api, cache, service } = setupNativeTask();
    api.failPaths.add("/api/attr/setBlockAttrs");
    await assert.rejects(service.updateTask(TASK_ID, { [ATTR_STATUS]: "done" }));
    assert.match(api.blocks.get(TASK_ID)!.markdown, /\[ \]/);
    assert.equal(cache.get(TASK_ID)?.status, "inbox");
});

test("属性已落盘但权威回读失败时同时回滚属性与 marker", async () => {
    // Regression: getBlockAttrs failure after setBlockAttrs must not leave a split native state.
    const { api, service } = setupNativeTask();
    api.failAtRequest.set("/api/attr/getBlockAttrs", 3);
    await assert.rejects(service.updateTask(TASK_ID, { [ATTR_STATUS]: "done" }));
    assert.equal(api.blocks.get(TASK_ID)?.attrs[ATTR_STATUS], "");
    assert.match(api.blocks.get(TASK_ID)!.markdown, /\[ \]/);
});

test("原生任务标题只更新直接文本子块，移除后保留内容并转普通列表项", async () => {
    // Regression: renaming or removing a native task must not replace the whole list-item subtree.
    const { api, cache, service } = setupNativeTask();
    const nestedListId = "20260818120002-nestedl";
    api.addBlock(nestedListId, "l", "", "notebook", "/Native", { parentId: TASK_ID, subtype: "u" });
    const renamed = await service.updateTaskTitle(TASK_ID, "Renamed task");
    assert.equal(renamed.title, "Renamed task");
    assert.equal(api.blocks.get(TEXT_ID)?.content, "Renamed task");
    assert.equal(api.blocks.get(nestedListId)?.parentId, TASK_ID);

    await service.removeTask(TASK_ID);
    assert.equal(api.blocks.get(TASK_ID)?.subtype, "u");
    assert.equal(api.blocks.get(TEXT_ID)?.content, "Renamed task");
    assert.equal(api.blocks.get(nestedListId)?.parentId, TASK_ID);
    assert.equal(cache.get(TASK_ID), undefined);
});

test("属性父关系覆盖原生嵌套结构提示", async () => {
    // Regression: structural nesting is only an initial hint and must not replace custom-na-parent.
    let page = 0;
    const explicitParent = "20260818130000-explicit";
    const api = {
        query: async () => {
            if (page++ > 0) return [];
            return [
                {
                    id: TASK_ID,
                    parent_id: "20260818130001-listaaa",
                    content_block_id: TEXT_ID,
                    title_content: "Native task",
                    markdown: "- [ ] Native task",
                    structural_parent_id: "20260818130002-structu",
                    source: "native",
                    sort: 10,
                    updated: "20260818130003",
                },
            ];
        },
        log: () => {},
    } as unknown as FakeSiyuanApi;
    const cache = new CacheManager(api);
    await cache.loadAll(async () => ({ [TASK_ID]: { [ATTR_PARENT]: explicitParent } }));
    assert.equal(cache.get(TASK_ID)?.parentId, explicitParent);
});

test("空父任务属性回退到结构父任务，缺少文字块仍进入缓存", async () => {
    // Regression: an empty manual parent is not a request to detach a structurally nested task.
    let page = 0;
    const api = {
        query: async () => {
            if (page++ > 0) return [];
            return [
                {
                    id: TASK_ID,
                    parent_id: "20260818130001-listaaa",
                    content_block_id: "",
                    title_content: "",
                    markdown: "- [ ] Broken task",
                    structural_parent_id: "20260818130002-structu",
                    source: "native",
                    sort: 10,
                    updated: "20260818130003",
                },
            ];
        },
        log: () => {},
    } as unknown as FakeSiyuanApi;
    const cache = new CacheManager(api);
    await cache.loadAll(async () => ({ [TASK_ID]: { [ATTR_PARENT]: "" } }));

    assert.equal(cache.get(TASK_ID)?.parentId, "20260818130002-structu");
    assert.equal(cache.get(TASK_ID)?.contentBlockId, undefined);
});

test("缺少文字块的原生任务只在重命名时返回既有未找到错误", async () => {
    // Regression: malformed native tasks remain visible even though title editing cannot proceed.
    const api = new FakeSiyuanApi();
    api.addBlock(TASK_ID, "i", "Broken", "notebook", "/Broken", {
        subtype: "t",
        markdown: "- [ ] Broken",
    });
    const cache = new CacheManager(api);
    cache.set(
        taskFactory(TASK_ID, {
            identificationSource: "native",
            attrHostId: TASK_ID,
            contentBlockId: undefined,
        }),
    );
    const repository = new TaskRepository(api, cache, new Mutex(), new FakeTaskChangePublisher(), DEFAULT_SETTINGS);
    const service = new TaskService(cache, repository, new FakeMyDayTaskPort(), api);
    service.setIsReady(true);

    await assert.rejects(service.updateTaskTitle(TASK_ID, "Renamed"), (error: unknown) => {
        return error instanceof Error && (error as Error & { code?: number }).code === -32002;
    });
    assert.ok(cache.get(TASK_ID));
});
