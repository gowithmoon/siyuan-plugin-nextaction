import type { TaskCacheEntry } from "../../shared/types";
import { SIYUAN_DROP_BLOCK_REF } from "../../shared/constants";

export function buildBlockRefDragData(task: TaskCacheEntry): { ids: string[]; workspaceDir: string } | null {
    const runtime = globalThis as typeof globalThis & {
        window?: { siyuan?: { config?: { system?: { workspaceDir?: unknown } } } };
    };
    const workspaceDir = runtime.window?.siyuan?.config?.system?.workspaceDir;
    if (typeof workspaceDir !== "string" || !workspaceDir) return null;
    const blockId = task?.blockId;
    if (typeof blockId !== "string" || !blockId) return null;
    // 始终引用任务自身，原生任务不能使用文字子块作为引用目标。
    return { ids: [blockId], workspaceDir };
}

export function writeTaskDragDataTransfer(
    dataTransfer: DataTransfer,
    task: TaskCacheEntry,
    options?: { extraMimes?: Record<string, string> },
): boolean {
    const dragData = buildBlockRefDragData(task);
    if (dragData) {
        dataTransfer.setData(SIYUAN_DROP_BLOCK_REF, JSON.stringify(dragData));
    }
    if (options?.extraMimes) {
        for (const [mime, value] of Object.entries(options.extraMimes)) {
            dataTransfer.setData(mime, value);
        }
    }
    dataTransfer.effectAllowed = "copyMove";
    return dragData !== null;
}
