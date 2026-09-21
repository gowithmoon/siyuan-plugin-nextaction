import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { buildBlockRefDragData, writeTaskDragDataTransfer } from "../src/frontend/utils/drag-payload";
import { MY_DAY_DRAG_TYPE, SIYUAN_DROP_BLOCK_REF } from "../src/shared/constants";
import { taskFactory } from "./helpers/fakes";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
});

function setWorkspaceDir(workspaceDir: unknown): void {
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: { siyuan: { config: { system: { workspaceDir } } } },
    });
}

function createDataTransfer() {
    const data = new Map<string, string>();
    const transfer = {
        setData: (mime: string, value: string) => {
            data.set(mime, value);
        },
        effectAllowed: "none",
    };
    return { data, transfer: transfer as DataTransfer };
}

for (const identificationSource of ["native", "document"] as const) {
    test(`块引用使用 ${identificationSource} 任务自身的块 ID`, () => {
        // Regression: 原生任务的文字子块不能代替任务身份，文档任务同样引用自身。
        setWorkspaceDir("/workspace/siyuan");
        const task = taskFactory("20260920120000-abcdefg", {
            identificationSource,
            contentBlockId: "20260920120001-abcdefg",
        });
        assert.deepEqual(buildBlockRefDragData(task), {
            ids: [task.blockId],
            workspaceDir: "/workspace/siyuan",
        });
    });
}

test("缺失或非法的工作区与块 ID 不生成块引用载荷", () => {
    Reflect.deleteProperty(globalThis, "window");
    assert.equal(buildBlockRefDragData(taskFactory("task")), null);
    for (const dir of [undefined, null, "", 42]) {
        setWorkspaceDir(dir);
        assert.equal(buildBlockRefDragData(taskFactory("task")), null);
    }
    setWorkspaceDir("/workspace/siyuan");
    assert.equal(buildBlockRefDragData(taskFactory("")), null);
    assert.equal(buildBlockRefDragData(taskFactory(42 as unknown as string)), null);
});

test("拖拽同时写入思源块引用和我的一天排程载荷，不写纯文本", () => {
    // Regression: 只有排程 MIME 或纯文本时，拖入笔记无法插入动态块引用。
    setWorkspaceDir("/workspace/siyuan");
    const task = taskFactory("20260920120000-abcdefg");
    const { data, transfer } = createDataTransfer();
    assert.equal(
        writeTaskDragDataTransfer(transfer, task, {
            extraMimes: { [MY_DAY_DRAG_TYPE]: task.blockId },
        }),
        true,
    );
    assert.deepEqual(
        [...data],
        [
            [SIYUAN_DROP_BLOCK_REF, JSON.stringify({ ids: [task.blockId], workspaceDir: "/workspace/siyuan" })],
            [MY_DAY_DRAG_TYPE, task.blockId],
        ],
    );
    assert.equal(transfer.effectAllowed, "copyMove");
});

test("普通卡片仅写入块引用载荷", () => {
    setWorkspaceDir("/workspace/siyuan");
    const { data, transfer } = createDataTransfer();
    assert.equal(writeTaskDragDataTransfer(transfer, taskFactory("task")), true);
    assert.deepEqual([...data.keys()], [SIYUAN_DROP_BLOCK_REF]);
});

test("工作区缺失时返回失败但保留已有排程能力", () => {
    // Regression: 块引用降级不能使未排程项的面板内排程失效。
    setWorkspaceDir(undefined);
    const { data, transfer } = createDataTransfer();
    assert.equal(
        writeTaskDragDataTransfer(transfer, taskFactory("task"), {
            extraMimes: { [MY_DAY_DRAG_TYPE]: "task" },
        }),
        false,
    );
    assert.deepEqual([...data], [[MY_DAY_DRAG_TYPE, "task"]]);
    assert.equal(transfer.effectAllowed, "copyMove");
    const empty = createDataTransfer();
    assert.equal(writeTaskDragDataTransfer(empty.transfer, taskFactory("task")), false);
    assert.equal(empty.data.size, 0);
});
