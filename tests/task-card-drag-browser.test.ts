import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";
import { taskFactory } from "./helpers/fakes";
import { SIYUAN_DROP_BLOCK_REF } from "../src/shared/constants";

// Regression: 拖拽后的正文点击不能绕过根卡片保护触发编辑，默认卡片仍不启用原生拖拽。
test("任务卡片显式启用块引用拖拽并抑制拖拽期间的正文点击", async () => {
    const source = (path: string) => JSON.stringify(resolve(path));
    const task = taskFactory("20260920120000-abcdefg", { contentBlockId: "20260920120001-abcdefg" });
    const result = await runSvelteBrowserTest({
        fixtureName: "task-card-drag",
        files: {
            "siyuan.js":
                "export class Dialog {} export class Menu {} export function confirm() {} export function openTab() {} export function showMessage() {}",
            "Harness.svelte": `<script>
import TaskCard from ${source("src/frontend/components/TaskCard.svelte")};
import i18n from ${source("src/i18n/zh-CN.json")};
const task = ${JSON.stringify(task)};
const noop = () => {};
const onEdit = () => { window.edits++; };
</script>
<div id="enabled"><TaskCard {task} {i18n} {onEdit} onStatusClick={noop} onContextMenu={noop} blockRefDragEnabled={true} /></div>
<div id="default"><TaskCard {task} {i18n} {onEdit} onStatusClick={noop} onContextMenu={noop} /></div>`,
            "main.js": `import { mount, tick } from 'svelte';
import Harness from './Harness.svelte';
window.edits = 0;
window.siyuan = { config: { system: { workspaceDir: '/workspace/siyuan' } } };
mount(Harness, { target: document.querySelector('#app') });
void (async () => {
    await tick();
    const card = document.querySelector('#enabled .na-task-card');
    const body = card.querySelector('.na-task-card__body');
    const transfer = new DataTransfer();
    const start = new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer });
    card.dispatchEvent(start);
    body.click();
    const editsDuringDrag = window.edits;
    card.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
    body.click();
    const editsAtDragEnd = window.edits;
    await new Promise(resolve => setTimeout(resolve, 20));
    body.click();
    delete window.siyuan;
    const invalid = new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() });
    card.dispatchEvent(invalid);
    window.__NA_BROWSER_RESULT__({
        enabled: card.draggable,
        defaultEnabled: document.querySelector('#default .na-task-card').draggable,
        payload: JSON.parse(transfer.getData(${JSON.stringify(SIYUAN_DROP_BLOCK_REF)})),
        types: [...transfer.types],
        startCancelled: start.defaultPrevented,
        invalidCancelled: invalid.defaultPrevented,
        editsDuringDrag, editsAtDragEnd, editsAfterDrag: window.edits,
    });
})().catch(error => window.__NA_BROWSER_RESULT__({ error: String(error.stack || error) }));`,
        },
    });
    assert.deepEqual(result, {
        enabled: true,
        defaultEnabled: false,
        payload: { ids: [task.blockId], workspaceDir: "/workspace/siyuan" },
        types: [SIYUAN_DROP_BLOCK_REF],
        startCancelled: false,
        invalidCancelled: false,
        editsDuringDrag: 0,
        editsAtDragEnd: 0,
        editsAfterDrag: 1,
    });
});
