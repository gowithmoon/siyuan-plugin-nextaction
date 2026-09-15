import * as siyuan from "siyuan";
import { confirm, Dialog } from "siyuan";
import type { TaskCacheEntry } from "../../shared/types";
import type { I18nStrings } from "../../shared/i18n";
import type { KernelBridge } from "../kernel-bridge";
import { notifyError, notifyOperationError } from "../notify";
import { taskStore } from "../stores/task-store";
import { mountSvelteComponentAsync, type AsyncSvelteComponentMount } from "../svelte-mount";
import { isMobileCreateTaskFrontend } from "./create-task-routing";

export interface TaskDetailDialogOptions {
    blockId: string;
    bridge: KernelBridge;
    i18n: I18nStrings;
    onCreateChild?: (task: TaskCacheEntry) => void;
}

async function resolveTask(options: TaskDetailDialogOptions): Promise<TaskCacheEntry | null> {
    let task = await options.bridge.getTask(options.blockId);
    if (task) return task;
    await options.bridge.rebuildCache();
    await taskStore.loadTasks();
    task = await options.bridge.getTask(options.blockId);
    return task;
}

export async function openTaskDetailDialog(options: TaskDetailDialogOptions): Promise<void> {
    let task: TaskCacheEntry | null;
    try {
        task = await resolveTask(options);
    } catch (error: unknown) {
        notifyOperationError(error, options.i18n);
        return;
    }
    if (!task) {
        notifyError(options.i18n?.errItemNotFound || options.i18n?.errTaskNotFound || "Project or task not found");
        return;
    }
    taskStore.applyUpdate(task);

    const frontend =
        (siyuan as typeof siyuan & { getFrontend?: () => string }).getFrontend?.() ??
        (globalThis as typeof globalThis & { siyuan?: { getFrontend?: () => string } }).siyuan?.getFrontend?.() ??
        "desktop";
    if (isMobileCreateTaskFrontend(frontend)) {
        const host = document.createElement("div");
        host.className = "nextaction na-mobile-task-detail-root";
        const pageRoot = document.activeElement?.closest<HTMLElement>(".na-app");
        if (!pageRoot) host.classList.add("na-app");
        (pageRoot || document.body).appendChild(host);
        let mounted: AsyncSvelteComponentMount<object> | null = null;
        let closed = false;
        const close = async () => {
            if (closed) return;
            closed = true;
            await mounted?.dispose();
            host.remove();
        };
        mounted = mountSvelteComponentAsync(() => import("../components/MobileTaskDetailHost.svelte"), {
            target: host,
            props: {
                task,
                bridge: options.bridge,
                i18n: options.i18n,
                onClose: close,
                onCreateChild: options.onCreateChild,
            },
        });
        try {
            await mounted.ready;
        } catch (error: unknown) {
            await close();
            notifyOperationError(error, options.i18n);
        }
        return;
    }

    let detail: AsyncSvelteComponentMount<{ requestClose(): Promise<boolean> }> | null = null;
    const dialog = new Dialog({
        title: "",
        content: `<div class="nextaction na-task-dialog-content"></div>`,
        width: "min(520px, calc(100vw - 24px))",
        height: "min(720px, calc(100vh - 24px))",
        disableClose: true,
        hideCloseIcon: true,
        destroyCallback: () => {
            void detail?.dispose();
            detail = null;
        },
    });

    const container = dialog.element.querySelector(".na-task-dialog-content");
    if (!container) {
        dialog.destroy();
        return;
    }
    dialog.element.querySelector(".b3-dialog__header")?.remove();
    dialog.element.querySelector<HTMLElement>(".b3-dialog__container")?.classList.add("na-task-dialog-container");
    dialog.element.querySelector(".b3-dialog__scrim")?.addEventListener("click", () => {
        void detail?.instance?.requestClose();
    });

    try {
        detail = mountSvelteComponentAsync(() => import("../components/TaskDetail.svelte"), {
            target: container as HTMLElement,
            props: {
                task,
                bridge: options.bridge,
                i18n: options.i18n,
                dialogMode: true,
                onCreateChild: options.onCreateChild,
                onClose: () => dialog.destroy(),
                onConfirmDiscard: (confirmDiscard: () => void, cancelClose: () => void) => {
                    confirm(
                        options.i18n?.unsavedChangesTitle || "Unsaved changes",
                        options.i18n?.unsavedChangesMessage || "Discard unsaved changes?",
                        confirmDiscard,
                        cancelClose,
                    );
                },
            },
        }) as AsyncSvelteComponentMount<{ requestClose(): Promise<boolean> }>;
        await detail.ready;
    } catch (error: unknown) {
        dialog.destroy();
        notifyOperationError(error, options.i18n);
    }
}
