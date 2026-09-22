import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import type { TaskSnapshotV2 } from "../src/shared/types.ts";
import type { Plugin } from "siyuan";
import type { KernelBridge } from "../src/frontend/kernel-bridge.ts";
import { DEFAULT_SETTINGS } from "../src/shared/settings.ts";
import { taskStore } from "../src/frontend/stores/task-store.ts";
import {
    configureMobileNotificationRuntime,
    destroyMobileNotificationStore,
} from "../src/frontend/stores/mobile-notification-store.ts";
import { MobileNotificationLifecycle } from "../src/frontend/controllers/mobile-notification-lifecycle.ts";
import { taskFactory } from "./helpers/fakes.ts";

const settings = {
    ...DEFAULT_SETTINGS,
    reminderSettings: { ...DEFAULT_SETTINGS.reminderSettings, systemNotificationEnabled: true },
};
function task(id = "task-a") {
    return taskFactory(id, {
        reminder: JSON.stringify([
            { type: "absolute", time: new Date(Date.now() + 86400000).toISOString().slice(0, 16) },
        ]),
    });
}
function harness() {
    const events = new Map<string, () => void>();
    const sent: string[] = [];
    const cancelled: number[] = [];
    let persisted: unknown = { default: { old: [42] } };
    let nextId = 100;
    configureMobileNotificationRuntime({
        getFrontend: () => "mobile",
        platformUtils: {
            async sendNotification(options) {
                sent.push(String(options.body || "").split("\n", 1)[0]);
                return nextId++;
            },
            cancelNotification(id) {
                cancelled.push(id);
            },
        },
    });
    const plugin = {
        i18n: {},
        eventBus: {
            on(name: string, handler: () => void) {
                events.set(name, handler);
            },
            off(name: string, handler: () => void) {
                if (events.get(name) === handler) events.delete(name);
            },
        },
        async loadData() {
            return persisted;
        },
        async saveData(_path: string, value: unknown) {
            persisted = structuredClone(value);
        },
    } as unknown as Plugin;
    const lifecycle = new MobileNotificationLifecycle(plugin);
    lifecycle.start();
    return { lifecycle, events, sent, cancelled, readStorage: () => persisted };
}
afterEach(() => {
    taskStore.disposeSync();
    destroyMobileNotificationStore();
    configureMobileNotificationRuntime(null);
});

// Regression: 启动的临时空集合或失败加载不得取消持久化通知。
test("等待设置及权威快照后才清理重启 ID，加载失败保留旧通知", async () => {
    taskStore.resetSync();
    let fail = true;
    taskStore.setBridge({
        getSettings: async () => settings,
        getTaskSnapshotV2: async () => {
            if (fail) throw new Error("离线");
            return { schema: 2, streamId: "a", revision: 0, tasks: [task()] };
        },
    } as unknown as KernelBridge);
    const h = harness();
    try {
        await h.lifecycle.reconcile();
        assert.deepEqual(h.cancelled, []);
        await taskStore.loadSettings();
        await taskStore.loadTasks();
        await h.lifecycle.reconcile();
        assert.deepEqual(h.cancelled, []);
        fail = false;
        await taskStore.loadTasks();
        await h.lifecycle.reconcile();
        assert.deepEqual(h.cancelled, [42]);
        assert.equal(h.sent.length, 1);
        await h.lifecycle.reconcile();
        assert.equal(h.sent.length, 1);
    } finally {
        h.lifecycle.dispose();
    }
});

async function loadTasks(tasks = [task()]) {
    taskStore.resetSync();
    taskStore.setBridge({
        getSettings: async () => settings,
        getTaskSnapshotV2: async () => ({ schema: 2, streamId: "a", revision: 0, tasks }),
    } as unknown as KernelBridge);
    await taskStore.loadSettings();
    await taskStore.loadTasks();
}
function tick() {
    return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

// Regression: 真实提交路径必须直接维护通知，不能依赖下一次全量校准。
test("已提交 V2 增量更新通知，重复 revision 和无关字段不调平台", async () => {
    const original = task();
    await loadTasks([original]);
    const h = harness();
    try {
        await h.lifecycle.reconcile();
        const delta = {
            schema: 2,
            type: "delta",
            streamId: "a",
            fromRevision: 0,
            revision: 1,
            upserts: [{ ...original, title: "更新标题" }, task("new-task")],
            deletedBlockIds: [],
        };
        taskStore.applyChangeSetV2(delta);
        await tick();
        assert.deepEqual(h.sent, ["Task", "更新标题", "Task"]);
        assert.deepEqual(h.cancelled, [42, 100]);
        taskStore.applyChangeSetV2(delta);
        taskStore.applyChangeSetV2({
            ...delta,
            fromRevision: 1,
            revision: 2,
            upserts: [{ ...delta.upserts[0], priority: "high" }],
        });
        await tick();
        assert.equal(h.sent.length, 3);
        taskStore.applyChangeSetV2({
            ...delta,
            fromRevision: 2,
            revision: 3,
            upserts: [],
            deletedBlockIds: ["task-a", "new-task", "unknown"],
        });
        await tick();
        assert.deepEqual(h.cancelled, [42, 100, 101, 102]);
    } finally {
        h.lifecycle.dispose();
    }
});

// Regression: sync-end 与数据回调必须保持幂等，卸载后的回调必须失效。
test("同步与数据回调校准当前集合，过滤原因，销毁解绑", async () => {
    await loadTasks();
    const h = harness();
    try {
        await h.lifecycle.reconcile();
        const before = h.readStorage();
        h.events.get("sync-end")?.();
        await h.lifecycle.handleDataChanged("sync");
        await h.lifecycle.handleDataChanged("overwrite");
        await h.lifecycle.handleDataChanged();
        assert.deepEqual(h.readStorage(), before);
        assert.equal(h.sent.length, 1);
        // A full snapshot may remove tasks without emitting a per-task delta.
        taskStore.resetSync();
        taskStore.setBridge({
            getTaskSnapshotV2: async () => ({ schema: 2, streamId: "b", revision: 0, tasks: [] }),
        } as unknown as KernelBridge);
        await taskStore.loadTasks();
        await h.lifecycle.handleDataChanged("overwrite");
        assert.deepEqual(h.cancelled, [42, 100]);
        h.lifecycle.dispose();
        assert.equal(h.events.has("sync-end"), false);
        taskStore.applyUpdate(task("after-dispose"));
        await h.lifecycle.handleDataChanged("sync");
        await tick();
        assert.equal(h.sent.length, 1);
    } finally {
        h.lifecycle.dispose();
    }
});

// Regression: 设置加载失败不能把默认关闭开关当作权威设置并清空原生通知。
test("设置加载失败时保持未初始化，恢复后才能重建", async () => {
    taskStore.resetSync();
    taskStore.setBridge({
        getSettings: async () => {
            throw new Error("设置不可用");
        },
        getTaskSnapshotV2: async () => ({ schema: 2, streamId: "a", revision: 0, tasks: [task()] }),
    } as unknown as KernelBridge);
    const h = harness();
    try {
        await taskStore.loadSettings();
        await taskStore.loadTasks();
        await h.lifecycle.handleDataChanged("sync");
        assert.deepEqual(h.cancelled, []);
        await loadTasks();
        await h.lifecycle.reconcile();
        assert.deepEqual(h.cancelled, [42]);
        assert.equal(h.sent.length, 1);
    } finally {
        h.lifecycle.dispose();
    }
});

// Regression: 同步事件与过期加载结果都不能把尚未完成的新快照当作空计划。
test("同步事件等待在途快照，旧加载返回不触发初始化", async () => {
    taskStore.resetSync();
    let resolveSnapshot!: (value: TaskSnapshotV2) => void;
    let call = 0;
    taskStore.setBridge({
        getSettings: async () => settings,
        getTaskSnapshotV2: async () => {
            if (++call === 1) return { schema: 2, streamId: "old", revision: 0, tasks: [] };
            return new Promise((resolve) => {
                resolveSnapshot = resolve;
            });
        },
    } as unknown as KernelBridge);
    const h = harness();
    try {
        await taskStore.loadSettings();
        const old = taskStore.loadTasks();
        const current = taskStore.loadTasks();
        await old;
        h.events.get("sync-end")?.();
        await h.lifecycle.handleDataChanged("overwrite");
        assert.deepEqual(h.cancelled, []);
        resolveSnapshot({ schema: 2, streamId: "new", revision: 0, tasks: [task()] });
        await current;
        await h.lifecycle.reconcile();
        assert.deepEqual(h.cancelled, [42]);
        assert.equal(h.sent.length, 1);
    } finally {
        h.lifecycle.dispose();
    }
});

// Regression: 只有支持的数据原因和 sync-end 可以重试未成功的计划。
test("sync-end 与允许的数据原因触发平台重试，其他原因不触发", async () => {
    await loadTasks();
    const h = harness();
    let attempts = 0;
    configureMobileNotificationRuntime({
        getFrontend: () => "mobile",
        platformUtils: {
            async sendNotification() {
                attempts++;
                return -1;
            },
            cancelNotification() {},
        },
    });
    try {
        await h.lifecycle.reconcile();
        assert.equal(attempts, 1);
        await h.lifecycle.handleDataChanged("other");
        assert.equal(attempts, 1);
        h.events.get("sync-end")?.();
        await tick();
        assert.equal(attempts, 2);
        await h.lifecycle.handleDataChanged("sync");
        assert.equal(attempts, 3);
        await h.lifecycle.handleDataChanged("overwrite");
        assert.equal(attempts, 4);
        await h.lifecycle.handleDataChanged();
        assert.equal(attempts, 5);
    } finally {
        h.lifecycle.dispose();
    }
});

// Regression: 加载持久化记录时卸载后，迟到回调不得重新注册事件或通知。
test("持久化初始化期间卸载，后续事件与加载结果都不再调度", async () => {
    await loadTasks();
    const events = new Map<string, () => void>();
    let resolveStorage!: (value: unknown) => void;
    let started!: () => void;
    const loading = new Promise<void>((resolve) => {
        started = resolve;
    });
    const calls: string[] = [];
    configureMobileNotificationRuntime({
        getFrontend: () => "mobile",
        platformUtils: {
            async sendNotification() {
                calls.push("send");
                return 1;
            },
            cancelNotification() {
                calls.push("cancel");
            },
        },
    });
    const lifecycle = new MobileNotificationLifecycle({
        i18n: {},
        eventBus: {
            on(name: string, fn: () => void) {
                events.set(name, fn);
            },
            off(name: string) {
                events.delete(name);
            },
        },
        loadData() {
            started();
            return new Promise((resolve) => {
                resolveStorage = resolve;
            });
        },
        async saveData() {
            calls.push("save");
        },
    } as unknown as Plugin);
    lifecycle.start();
    const pending = lifecycle.reconcile();
    await loading;
    const staleHandler = events.get("sync-end")!;
    lifecycle.dispose();
    resolveStorage({ default: { old: [42] } });
    await pending;
    staleHandler();
    await lifecycle.handleDataChanged("overwrite");
    assert.deepEqual(calls, []);
    assert.equal(events.size, 0);
});

// Regression: 通知持久化读取期间任务重载失败，不能取消原有有效通知。
test("初始化等待期间任务加载失败保留旧通知，成功恢复后重新初始化", async () => {
    await loadTasks();
    let resolveStorage!: (value: unknown) => void;
    let started!: () => void;
    const loading = new Promise<void>((resolve) => {
        started = resolve;
    });
    const calls: string[] = [];
    let loads = 0;
    configureMobileNotificationRuntime({
        getFrontend: () => "mobile",
        platformUtils: {
            async sendNotification() {
                calls.push("send");
                return 1;
            },
            cancelNotification(id) {
                calls.push(`cancel:${id}`);
            },
        },
    });
    const lifecycle = new MobileNotificationLifecycle({
        i18n: {},
        eventBus: { on() {}, off() {} },
        loadData() {
            if (++loads > 1) return Promise.resolve({ default: { old: [42] } });
            started();
            return new Promise((resolve) => {
                resolveStorage = resolve;
            });
        },
        async saveData() {},
    } as unknown as Plugin);
    lifecycle.start();
    try {
        const pending = lifecycle.reconcile();
        await loading;
        taskStore.setBridge({
            getTaskSnapshotV2: async () => {
                throw new Error("重新加载失败");
            },
        } as unknown as KernelBridge);
        await taskStore.loadTasks();
        resolveStorage({ default: { old: [42] } });
        await pending;
        assert.deepEqual(calls, []);
        await loadTasks();
        await lifecycle.reconcile();
        assert.deepEqual(calls, ["cancel:42", "send"]);
    } finally {
        lifecycle.dispose();
    }
});

// Regression: 原生取消一旦开始，任务重载失败也必须用已确认快照补齐通知。
test("首次取消期间任务加载失败，仍按清理前权威快照完成注册", async () => {
    await loadTasks();
    let releaseCancel!: () => void;
    let started!: () => void;
    const cancelling = new Promise<void>((resolve) => {
        started = resolve;
    });
    const calls: string[] = [];
    configureMobileNotificationRuntime({
        getFrontend: () => "mobile",
        platformUtils: {
            async sendNotification() {
                calls.push("send");
                return 1;
            },
            cancelNotification(id) {
                calls.push(`cancel:${id}`);
                started();
                return new Promise<void>((resolve) => {
                    releaseCancel = resolve;
                });
            },
        },
    });
    const lifecycle = new MobileNotificationLifecycle({
        i18n: {},
        eventBus: { on() {}, off() {} },
        async loadData() {
            return { default: { old: [42] } };
        },
        async saveData() {},
    } as unknown as Plugin);
    lifecycle.start();
    try {
        const pending = lifecycle.reconcile();
        await cancelling;
        taskStore.setBridge({
            getTaskSnapshotV2: async () => {
                throw new Error("取消期间加载失败");
            },
        } as unknown as KernelBridge);
        await taskStore.loadTasks();
        releaseCancel();
        await pending;
        assert.deepEqual(calls, ["cancel:42", "send"]);
    } finally {
        lifecycle.dispose();
    }
});
