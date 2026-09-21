import test from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import type { KernelBridge } from "../src/frontend/kernel-bridge.ts";
import { createTaskStore } from "../src/frontend/stores/task-store.ts";
import {
    buildTaskCollection,
    isTaskChangeSetV2,
    isTaskSnapshotV2,
    normalizeTaskSnapshotV2,
    reduceTaskChanges,
} from "../src/frontend/stores/task-sync-reducer.ts";
import type { TaskSnapshotV2 } from "../src/shared/types.ts";
import { taskFactory } from "./helpers/fakes.ts";

const PROJECT = "20260816120000-project";
const TASK_A = "20260816120001-taskaaa";
const TASK_B = "20260816120002-taskbbb";

function snapshot(streamId: string, revision: number, tasks = [taskFactory(TASK_A)]): TaskSnapshotV2 {
    return { schema: 2, streamId, revision, tasks };
}

function tick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

test("纯 reducer 每批统一更新任务及全部聚合值", () => {
    const current = buildTaskCollection([
        taskFactory(PROJECT, { taskType: "2" }),
        taskFactory(TASK_A, { parentId: PROJECT }),
        taskFactory(TASK_B, { parentId: PROJECT, status: "done" }),
    ]);
    const reduction = reduceTaskChanges(current, {
        upserts: [taskFactory(TASK_A, { parentId: PROJECT, status: "done", context: "work|home", tags: "phase-four" })],
        deletedBlockIds: [TASK_B],
    });

    assert.deepEqual(reduction.collection.allTasks.find((task) => task.blockId === PROJECT)?.childIds, [TASK_A]);
    assert.deepEqual(reduction.collection.contexts, ["work", "home"]);
    assert.deepEqual(reduction.collection.tags, ["phase-four"]);
    assert.equal(reduction.collection.doneCount, 1);
    assert.deepEqual(
        reduction.collection.projectReminders.map((task) => task.blockId),
        [PROJECT],
    );
    assert.equal(reduction.completedChanged, true);
});

// Regression: 增量新建或移动子任务后，父任务关系不能等待下一次全量快照才更新。
test("增量任务关系立即重算父级 childIds", () => {
    const current = buildTaskCollection([taskFactory(PROJECT, { taskType: "2" }), taskFactory(TASK_A)]);
    const created = taskFactory(TASK_B, { parentId: PROJECT });
    const createdReduction = reduceTaskChanges(current, { upserts: [created], deletedBlockIds: [] });
    assert.deepEqual(createdReduction.collection.allTasks.find((task) => task.blockId === PROJECT)?.childIds, [TASK_B]);

    const moved = reduceTaskChanges(createdReduction.collection, {
        upserts: [taskFactory(TASK_B, { parentId: TASK_A })],
        deletedBlockIds: [],
    });
    assert.deepEqual(moved.collection.allTasks.find((task) => task.blockId === PROJECT)?.childIds, []);
    assert.deepEqual(moved.collection.allTasks.find((task) => task.blockId === TASK_A)?.childIds, [TASK_B]);

    const removed = reduceTaskChanges(moved.collection, { upserts: [], deletedBlockIds: [TASK_B] });
    assert.deepEqual(removed.collection.allTasks.find((task) => task.blockId === TASK_A)?.childIds, []);
});

// Regression: 单个任务增量不能为每个任务重复扫描完整任务集合。
test("增量任务关系以线性次数读取 parentId", () => {
    const taskCount = 200;
    const taskIds = Array.from({ length: taskCount }, (_, index) => `20260821000000-${String(index).padStart(7, "0")}`);
    let parentIdReads = 0;
    const tasks = taskIds.map((blockId, index) => {
        const parentId = index === 0 ? "" : taskIds[0];
        const task = taskFactory(blockId, { parentId, taskType: index === 0 ? "2" : "1" });
        Object.defineProperty(task, "parentId", {
            configurable: true,
            enumerable: true,
            get: () => {
                parentIdReads++;
                return parentId;
            },
        });
        return task;
    });
    const current = buildTaskCollection(tasks);
    parentIdReads = 0;

    reduceTaskChanges(current, {
        upserts: [taskFactory(taskIds[1], { parentId: taskIds[0], status: "doing" })],
        deletedBlockIds: [],
    });

    assert.ok(parentIdReads <= taskCount * 2, `expected linear parentId reads, got ${parentIdReads}`);
});

test("V2 snapshot 与 delta 校验拒绝缺字段、重复和交叉 ID", () => {
    assert.equal(isTaskSnapshotV2(snapshot("stream-a", 0)), true);
    assert.equal(isTaskSnapshotV2({ ...snapshot("stream-a", 0), tasks: [{ blockId: TASK_A }] }), false);
    assert.equal(
        isTaskSnapshotV2({
            ...snapshot("stream-a", 0),
            tasks: [taskFactory(TASK_A, { actionKind: "milestone" as "stage" })],
        }),
        false,
    );
    assert.equal(
        isTaskChangeSetV2({
            schema: 2,
            type: "delta",
            streamId: "stream-a",
            fromRevision: 0,
            revision: 1,
            upserts: [taskFactory(TASK_A)],
            deletedBlockIds: [TASK_A],
        }),
        false,
    );
});

test("旧内核快照缺少原生身份字段时归一化为文档任务", () => {
    const current = taskFactory(TASK_A);
    const { identificationSource: _source, attrHostId: _host, ...legacyTask } = current;
    const normalized = normalizeTaskSnapshotV2({ schema: 2, streamId: "legacy", revision: 0, tasks: [legacyTask] });
    assert.equal(normalized?.tasks[0].identificationSource, "document");
    assert.equal(normalized?.tasks[0].attrHostId, TASK_A);
    assert.equal(isTaskSnapshotV2({ schema: 2, streamId: "legacy", revision: 0, tasks: [legacyTask] }), true);
});

test("旧内核快照缺少新增可选字段时仍保持 V2 同步", () => {
    // Regression: a valid kernel snapshot must not fall back repeatedly when
    // only fields introduced after the initial V2 payload are absent.
    const current = taskFactory(TASK_A);
    const {
        identificationSource: _source,
        attrHostId: _host,
        contentBlockId: _content,
        reviewInterval: _reviewInterval,
        reviewDate: _reviewDate,
        reminder: _reminder,
        outcome: _outcome,
        dod: _dod,
        actionKind: _actionKind,
        ...olderTask
    } = current;
    const normalized = normalizeTaskSnapshotV2({
        schema: 2,
        streamId: "older-kernel",
        revision: 0,
        tasks: [olderTask],
    });
    assert.equal(normalized?.tasks[0].identificationSource, "document");
    assert.equal(normalized?.tasks[0].reviewInterval, 0);
    assert.equal(normalized?.tasks[0].reminder, "");
    assert.equal(normalized?.tasks[0].outcome, "");
    assert.equal(normalized?.tasks[0].dod, "");
    assert.equal(normalized?.tasks[0].actionKind, "action");
});

test("snapshot 握手期间缓存并按 revision 重放 V2 通知", async () => {
    let resolveSnapshot!: (value: TaskSnapshotV2) => void;
    const pendingSnapshot = new Promise<TaskSnapshotV2>((resolve) => {
        resolveSnapshot = resolve;
    });
    let getAllCalls = 0;
    const bridge = {
        getTaskSnapshotV2: () => pendingSnapshot,
        getAllTasks: async () => {
            getAllCalls++;
            return [];
        },
    } as unknown as KernelBridge;
    const store = createTaskStore();
    store.setBridge(bridge);

    const loading = store.loadTasks();
    store.applyChangeSetV2({
        schema: 2,
        type: "delta",
        streamId: "stream-a",
        fromRevision: 0,
        revision: 1,
        upserts: [taskFactory(TASK_A, { priority: "critical" })],
        deletedBlockIds: [],
    });
    resolveSnapshot(snapshot("stream-a", 0));
    await loading;

    assert.equal(get(store).allTasks[0].priority, "critical");
    assert.equal(getAllCalls, 0);
    store.disposeSync();
});

// Regression: 实时详情在首个任务快照完成前不能把“集合尚未加载”误判为任务已删除。
test("任务观察器等待首个快照，并转发 V2 更新与明确删除", async () => {
    const bridge = {
        getTaskSnapshotV2: async () => snapshot("stream-a", 0, [taskFactory(TASK_A, { title: "Initial" })]),
    } as unknown as KernelBridge;
    const store = createTaskStore();
    const events: Array<string | null> = [];
    const unsubscribe = store.observeTask(TASK_A, (entry) => events.push(entry?.title || null));
    assert.deepEqual(events, []);

    store.setBridge(bridge);
    await store.loadTasks();
    store.applyChangeSetV2({
        schema: 2,
        type: "delta",
        streamId: "stream-a",
        fromRevision: 0,
        revision: 1,
        upserts: [taskFactory(TASK_A, { title: "Updated" })],
        deletedBlockIds: [],
    });
    store.applyChangeSetV2({
        schema: 2,
        type: "delta",
        streamId: "stream-a",
        fromRevision: 1,
        revision: 2,
        upserts: [],
        deletedBlockIds: [TASK_A],
    });

    assert.deepEqual(events, ["Initial", "Updated", null]);
    unsubscribe();
    store.disposeSync();
});

test("权威快照恢复会向任务观察器报告缺失任务", async () => {
    const snapshots = [snapshot("stream-a", 0, [taskFactory(TASK_A)]), snapshot("stream-b", 1, [taskFactory(TASK_B)])];
    let snapshotCalls = 0;
    const bridge = {
        getTaskSnapshotV2: async () => snapshots[Math.min(snapshotCalls++, snapshots.length - 1)],
    } as unknown as KernelBridge;
    const store = createTaskStore();
    store.setBridge(bridge);
    await store.loadTasks();
    const events: Array<string | null> = [];
    const unsubscribe = store.observeTask(TASK_A, (entry) => events.push(entry?.blockId || null));

    store.resetSync();
    await store.loadTasks();
    assert.deepEqual(events, [TASK_A, null]);

    unsubscribe();
    store.disposeSync();
});

test("revision 缺口触发 snapshot 恢复且过期通知被忽略", async () => {
    const snapshots = [
        snapshot("stream-a", 0, [taskFactory(TASK_A)]),
        snapshot("stream-a", 4, [taskFactory(TASK_B, { title: "Recovered" })]),
    ];
    let snapshotCalls = 0;
    const bridge = {
        getTaskSnapshotV2: async () => snapshots[Math.min(snapshotCalls++, snapshots.length - 1)],
        getAllTasks: async () => {
            throw new Error("V2 must not call getAllTasks");
        },
    } as unknown as KernelBridge;
    const store = createTaskStore();
    store.setBridge(bridge);
    await store.loadTasks();

    store.applyChangeSetV2({
        schema: 2,
        type: "delta",
        streamId: "stream-a",
        fromRevision: 2,
        revision: 3,
        upserts: [taskFactory(TASK_A, { title: "Gap" })],
        deletedBlockIds: [],
    });
    await tick();
    await tick();
    assert.deepEqual(
        get(store).allTasks.map((task) => task.blockId),
        [TASK_B],
    );
    assert.equal(snapshotCalls, 2);

    store.applyChangeSetV2({
        schema: 2,
        type: "delta",
        streamId: "stream-a",
        fromRevision: 3,
        revision: 4,
        upserts: [taskFactory(TASK_A)],
        deletedBlockIds: [],
    });
    await tick();
    assert.equal(snapshotCalls, 2);
    store.disposeSync();
});

test("reset、stream 变化和非法载荷都通过 V2 snapshot 恢复", async () => {
    const snapshots = [
        snapshot("stream-a", 0, [taskFactory(TASK_A)]),
        snapshot("stream-b", 2, [taskFactory(TASK_B, { title: "After reset" })]),
        snapshot("stream-c", 5, [taskFactory(TASK_A, { title: "After corruption" })]),
    ];
    let snapshotCalls = 0;
    const bridge = {
        getTaskSnapshotV2: async () => snapshots[Math.min(snapshotCalls++, snapshots.length - 1)],
        getAllTasks: async () => {
            throw new Error("V2 recovery must not call getAllTasks");
        },
    } as unknown as KernelBridge;
    const store = createTaskStore();
    store.setBridge(bridge);
    await store.loadTasks();

    store.applyChangeSetV2({ schema: 2, type: "reset", streamId: "stream-a", revision: 1 });
    await tick();
    await tick();
    assert.equal(get(store).allTasks[0].title, "After reset");

    store.applyChangeSetV2({
        schema: 2,
        type: "delta",
        streamId: "stream-b",
        fromRevision: 2,
        revision: 3,
        upserts: [{ blockId: TASK_A }],
        deletedBlockIds: [],
    });
    await tick();
    await tick();
    assert.equal(get(store).allTasks[0].title, "After corruption");
    assert.equal(snapshotCalls, 3);
    store.disposeSync();
});

test("V2 snapshot 获取失败时保留现有集合并暴露错误", async () => {
    const bridge = {
        getTaskSnapshotV2: async () => {
            throw new Error("snapshot unavailable");
        },
    } as unknown as KernelBridge;
    const store = createTaskStore();
    store.setBridge(bridge);
    await store.loadTasks();

    assert.deepEqual(get(store).allTasks, []);
    assert.equal(get(store).error, "snapshot unavailable");
    store.disposeSync();
});

test("V2 快照字段不兼容时降级到任务查询而不阻塞任务面板", async () => {
    const legacyTask = taskFactory(TASK_A, { title: "Legacy native task" });
    const bridge = {
        getTaskSnapshotV2: async () => ({ schema: 2, streamId: "bad", revision: 0, tasks: [{ blockId: TASK_A }] }),
        getAllTasks: async () => [legacyTask],
    } as unknown as KernelBridge;
    const store = createTaskStore();
    store.setBridge(bridge);
    await store.loadTasks();
    assert.deepEqual(
        get(store).allTasks.map((task) => task.title),
        ["Legacy native task"],
    );
    assert.equal(get(store).error, null);
    store.disposeSync();
});

test("内核重连清空旧 stream 并从新快照继续连续增量", async () => {
    const snapshots = [snapshot("stream-a", 0, [taskFactory(TASK_A)]), snapshot("stream-b", 1, [taskFactory(TASK_B)])];
    let snapshotCalls = 0;
    const bridge = {
        getTaskSnapshotV2: async () => snapshots[Math.min(snapshotCalls++, snapshots.length - 1)],
    } as unknown as KernelBridge;
    const store = createTaskStore();
    store.setBridge(bridge);
    await store.loadTasks();

    store.resetSync();
    store.applyChangeSetV2({
        schema: 2,
        type: "delta",
        streamId: "stream-b",
        fromRevision: 1,
        revision: 2,
        upserts: [taskFactory(TASK_B, { priority: "critical" })],
        deletedBlockIds: [],
    });
    await tick();
    await tick();

    assert.deepEqual(
        get(store).allTasks.map((task) => task.blockId),
        [TASK_B],
    );
    assert.equal(get(store).allTasks[0].priority, "critical");
    assert.equal(snapshotCalls, 2);
    store.disposeSync();
});

// Regression: 通知消费者必须在 delta 提交后拿到旧任务，重复 revision 不得重复发送。
test("任务变更观察器只接收已提交 delta，并保留旧任务快照", async () => {
    const original = taskFactory(TASK_A, { due: "2030-01-01T10:00" });
    const store = createTaskStore();
    store.setBridge({ getTaskSnapshotV2: async () => snapshot("stream-a", 0, [original]) } as KernelBridge);
    await store.loadTasks();
    const received: string[] = [];
    const unsubscribe = store.observeCommittedChanges((changes, previous) => {
        assert.equal(store.getTask(TASK_A)?.due, "2030-01-01T11:00");
        assert.equal(previous.get(TASK_A)?.due, "2030-01-01T10:00");
        received.push(...changes.upserts.map((task) => task.blockId), ...changes.deletedBlockIds);
    });
    const delta = {
        schema: 2,
        type: "delta",
        streamId: "stream-a",
        fromRevision: 0,
        revision: 1,
        upserts: [{ ...original, due: "2030-01-01T11:00" }],
        deletedBlockIds: [TASK_B],
    };
    store.applyChangeSetV2(delta);
    store.applyChangeSetV2(delta);
    assert.deepEqual(received, [TASK_A, TASK_B]);
    unsubscribe();
    store.applyUpdate(original);
    assert.deepEqual(received, [TASK_A, TASK_B]);
    store.disposeSync();
});
