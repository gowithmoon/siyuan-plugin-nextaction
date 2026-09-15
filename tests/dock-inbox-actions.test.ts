import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
    return readFileSync(new URL(path, import.meta.url), "utf8");
}

const dockInboxSource = source("../src/frontend/components/DockInbox.svelte");
const dockSidebarSource = source("../src/frontend/components/DockSidebar.svelte");
const taskCardSource = source("../src/frontend/components/TaskCard.svelte");

test("侧边栏收集箱为开始按钮接入状态更新", () => {
    assert.match(dockSidebarSource, /<DockInbox[\s\S]*?\{bridge\}/);
    assert.match(dockInboxSource, /bridge: KernelBridge/);
    assert.match(dockInboxSource, /}: Props = \$props\(\)/);
    assert.match(dockInboxSource, /bridge\.updateTask\(task\.blockId, \{ "na-status": "todo" \}\)/);
    assert.match(dockInboxSource, /taskStore\.applyUpdate\(updated\)/);
    assert.match(dockInboxSource, /onActivate=\{handleClarify\}/);
});

test("任务卡片只在存在处理器时显示开始或激活按钮", () => {
    assert.match(taskCardSource, /\{#if isInbox && onActivate\}/);
    assert.match(taskCardSource, /\{#if isSomeday && onActivate\}/);
});
