import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

type ChildMenuResult = {
    labels: string[];
    labelsWithoutCallback: string[];
    callCount: number;
    receivedOriginalTask: boolean;
};

// Regression: 右键菜单缺失新增子任务入口。
test("任务右键菜单按回调显示新建子任务，并将原任务传给创建入口", async () => {
    const result = await runSvelteBrowserTest<ChildMenuResult>({
        fixtureName: "task-context-menu-child",
        prepareFixture(fixtureRoot) {
            const contextMenuPath = resolve("src/frontend/components/task-context-menu.ts").replace(/\\/g, "/");
            writeFileSync(
                join(fixtureRoot, "siyuan.js"),
                `export const menus = [];
export class Menu {
    constructor() { this.items = []; menus.push(this); }
    addItem(item) { this.items.push(item); }
    addSeparator() {}
    open() {}
}
export class Dialog {}
export function confirm() {}
export function getAllEditor() { return []; }
export async function openTab() {}
export function showMessage() {}
`,
            );
            writeFileSync(
                join(fixtureRoot, "main.js"),
                `import { menus } from "siyuan";
import { showTaskContextMenu } from ${JSON.stringify(contextMenuPath)};

const task = {
    blockId: "20260825191000-task001", status: "todo", priority: "medium", repeat: "", repeatState: "",
    taskType: "1", parentId: "", title: "父任务", childIds: [],
};
const callbacks = { onUpdated() {}, onRemoved() {}, onEdit() {} };
let callCount = 0;
let receivedOriginalTask = false;
showTaskContextMenu(task, new MouseEvent("contextmenu"), {}, {}, {
    ...callbacks,
    onCreateChild(parentTask) {
        callCount += 1;
        receivedOriginalTask = parentTask === task;
    },
});
const items = menus.at(-1).items;
items.find((item) => item.label === "Create child task")?.click();
showTaskContextMenu(task, new MouseEvent("contextmenu"), {}, {}, callbacks);
window.__NA_BROWSER_RESULT__({
    labels: items.map((item) => item.label),
    labelsWithoutCallback: menus.at(-1).items.map((item) => item.label),
    callCount,
    receivedOriginalTask,
});
`,
            );
        },
    });

    const childIndex = result.labels.indexOf("Create child task");
    const propertiesIndex = result.labels.indexOf("Task Properties");
    const aiIndex = result.labels.indexOf("Break down with AI");
    assert.ok(childIndex >= 0);
    assert.equal(result.labelsWithoutCallback.includes("Create child task"), false);
    assert.equal(result.callCount, 1);
    assert.equal(result.receivedOriginalTask, true);
    assert.ok(propertiesIndex >= 0 && propertiesIndex < childIndex);
    assert.ok(aiIndex > childIndex);
});
