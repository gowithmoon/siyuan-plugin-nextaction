import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    closestTaskTarget,
    containsNativeTaskTarget,
    indexNativeTaskTargets,
} from "../src/frontend/controllers/editor-task-dom.ts";

const source = readFileSync(new URL("../src/frontend/styles/host-integration.scss", import.meta.url), "utf8");
const integration = readFileSync(
    new URL("../src/frontend/controllers/editor-task-integration.ts", import.meta.url),
    "utf8",
);
test("文档任务目标不拥有正文状态操作按钮", () => {
    // Regression: document-level status actions must be attached to the title, not regular blocks.
    const documentTask = {
        dataset: { nodeId: "document-task" },
        matches: (selector: string) => selector === "[data-node-id][custom-na-task]",
        closest: () => null,
        querySelectorAll: () => [],
    } as unknown as HTMLElement;

    const target = closestTaskTarget(documentTask);
    assert.deepEqual(target?.ownedActions, []);
    assert.equal(target?.identificationSource, "document");
});

test("原生任务 checkbox 使用六态样式并在 capture 阶段阻止 SiYuan 二态切换", () => {
    // Regression: native checkbox clicks must always open NextAction's status menu.
    assert.match(source, /\[data-type="NodeListItem"\]\[data-subtype="t"\]/);
    assert.match(source, /\[data-type="NodeList"\]\[data-subtype="t"\] > \[data-type="NodeListItem"\]/);
    assert.match(source, /position:\s*absolute/);
    assert.match(source, /left:\s*8px/);
    assert.match(source, /top:\s*calc\(\(1\.625em \+ 8px - 18px\) \/ 2\)/);
    assert.match(source, /> svg \{[\s\S]*display:\s*none\s*!important[\s\S]*visibility:\s*hidden\s*!important/);
    assert.match(source, /na-status-checkbox--inbox::after/);
    assert.match(source, /&::before,[\s\S]*&::after\s*\{\s*content:\s*none\s*!important/);
    assert.match(source, /\.protyle-action--task\.na-status-checkbox/);
    assert.match(integration, /na-status-checkbox/);
    assert.match(integration, /classList\.add\("na-status-checkbox", `\$\{statusClassPrefix\}\$\{status\}`\)/);
    assert.match(integration, /document\.addEventListener\("pointerdown", this\.handleEditorStatusClick, true\)/);
    assert.match(integration, /document\.addEventListener\("mousedown", this\.handleEditorStatusClick, true\)/);
    assert.match(integration, /document\.addEventListener\("click", this\.handleEditorStatusClick, true\)/);
    assert.match(integration, /event\.stopPropagation\(\);[\s\S]*event\.preventDefault\(\)/);
    assert.match(integration, /if \(event\.type !== "click"\) return/);
});

// Regression: 父任务状态同步不能覆盖嵌套子任务自己的六态图标。
test("原生任务状态同步仅处理归属于当前列表项的按钮", () => {
    let parentTask!: HTMLElement;
    let childTask!: HTMLElement;
    const parentAction = {
        closest: () => parentTask,
    } as unknown as HTMLElement;
    const childAction = {
        closest: () => childTask,
    } as unknown as HTMLElement;
    parentTask = {
        dataset: { nodeId: "parent-task" },
        querySelectorAll: () => [parentAction, childAction],
    } as unknown as HTMLElement;
    childTask = {
        dataset: { nodeId: "child-task" },
        querySelectorAll: () => [childAction],
    } as unknown as HTMLElement;
    const appliedStatuses = new Map<HTMLElement, string>();

    const childTarget = closestTaskTarget(childAction);
    const parentTarget = closestTaskTarget(parentAction);
    assert.ok(childTarget);
    assert.ok(parentTarget);
    for (const action of childTarget.ownedActions) appliedStatuses.set(action, "doing");
    for (const action of parentTarget.ownedActions) appliedStatuses.set(action, "waiting");

    assert.equal(appliedStatuses.get(parentAction), "waiting");
    assert.equal(appliedStatuses.get(childAction), "doing");
});

// Regression: 任务标记位于直属列表时，列表项仍是编辑器中的正式任务目标。
test("编辑器识别由任务列表拥有的列表项", () => {
    let taskItem!: HTMLElement;
    const action = {
        closest: (selector: string) => (selector.includes('NodeList"][data-subtype="t"]') ? taskItem : null),
    } as unknown as HTMLElement;
    taskItem = {
        dataset: { nodeId: "task-list-owned-item" },
        querySelectorAll: () => [action],
    } as unknown as HTMLElement;

    const target = closestTaskTarget(action);
    assert.equal(target?.blockId, "task-list-owned-item");
    assert.equal(target?.identificationSource, "native");
    assert.deepEqual(target?.ownedActions, [action]);
});

test("文档任务不将正文普通块识别为文档级任务", () => {
    // Regression: clicking a block icon inside a document task must keep SiYuan's normal block menu.
    const documentTask = { dataset: { nodeId: "document-task" } } as unknown as HTMLElement;
    const ordinaryBlock = {
        closest: (selector: string) => (selector.includes("NodeList") ? null : documentTask),
        matches: () => false,
    } as unknown as HTMLElement;

    assert.equal(closestTaskTarget(ordinaryBlock), null);
});

test("文档任务自身仍可作为文档级任务目标", () => {
    // Regression: the document task status entry must retain access to the task menu.
    const documentTask = {
        dataset: { nodeId: "document-task" },
        matches: (selector: string) => selector === "[data-node-id][custom-na-task]",
        closest: () => null,
    } as unknown as HTMLElement;

    const target = closestTaskTarget(documentTask);
    assert.equal(target?.blockId, "document-task");
    assert.equal(target?.identificationSource, "document");
});

test("编辑器状态同步只扫描一次原生任务 DOM", () => {
    // Regression: syncing N cached tasks must not rescan every native task subtree N times.
    assert.match(integration, /indexNativeTaskTargets\(document\)/);
    assert.doesNotMatch(integration, /findNativeTaskTargetsById\(document/);
});

test("编辑器仅在新增节点自身包含原生任务时重建缓存", () => {
    // Regression: adding an inline descendant inside an existing task must not rebuild the kernel cache.
    assert.match(integration, /containsNativeTaskTarget\(node\)/);
    assert.doesNotMatch(integration, /scanNativeTaskTargets\(node\)\.length > 0/);
});

test("原生任务 DOM 索引单次遍历且新增节点检测不向祖先扩散", () => {
    // Regression: indexing must remain one-pass, and inline descendants must not inherit an ancestor task match.
    const originalElement = Object.getOwnPropertyDescriptor(globalThis, "Element");
    class FakeElement {
        dataset: Record<string, string> = {};
        matchesResult = false;
        closestResult: FakeElement | null = null;
        queryResult: FakeElement | null = null;
        queryResults: FakeElement[] = [];
        queryCount = 0;

        matches(): boolean {
            return this.matchesResult;
        }
        closest(): FakeElement | null {
            return this.closestResult;
        }
        querySelector(): FakeElement | null {
            return this.queryResult;
        }
        querySelectorAll(): FakeElement[] {
            this.queryCount++;
            return this.queryResults;
        }
    }
    Object.defineProperty(globalThis, "Element", { configurable: true, value: FakeElement });

    try {
        const root = new FakeElement();
        const task = new FakeElement();
        const action = new FakeElement();
        task.dataset.nodeId = "20260823153000-domtask";
        task.queryResults = [action];
        action.closestResult = task;
        root.queryResults = [task];

        const targets = indexNativeTaskTargets(root as unknown as ParentNode);
        assert.equal(root.queryCount, 1);
        assert.equal(targets.get(task.dataset.nodeId)?.[0]?.taskElement, task);

        const inlineDescendant = new FakeElement();
        inlineDescendant.closestResult = task;
        assert.equal(containsNativeTaskTarget(inlineDescendant as unknown as ParentNode), false);

        const insertedWrapper = new FakeElement();
        insertedWrapper.queryResult = task;
        assert.equal(containsNativeTaskTarget(insertedWrapper as unknown as ParentNode), true);
    } finally {
        if (originalElement) Object.defineProperty(globalThis, "Element", originalElement);
        else delete (globalThis as { Element?: unknown }).Element;
    }
});
