import * as siyuan from "siyuan";
import type { KernelBridge } from "../kernel-bridge";
import type { TaskCacheEntry } from "../../shared/types";
import createTaskDialogStyles from "./create-task-dialog.scss?inline";
import { mountSvelteComponentAsync, type AsyncSvelteComponentMount } from "../svelte-mount";
import { isMobileCreateTaskFrontend } from "./create-task-routing";

type FrontendGetter = () => string;

function getCurrentFrontend(): string {
    const sdk = siyuan as typeof siyuan & { getFrontend?: FrontendGetter };
    const globalSiyuan = (globalThis as typeof globalThis & { siyuan?: { getFrontend?: FrontendGetter } }).siyuan;
    return sdk.getFrontend?.() ?? globalSiyuan?.getFrontend?.() ?? "desktop";
}

export interface OpenCreateTaskDialogOptions {
    bridge: KernelBridge;
    i18n: any;
    parentTask?: TaskCacheEntry | null;
    initialActionKind?: "action" | "stage";
    onCreated?: (task: TaskCacheEntry) => void;
}

export async function openCreateTaskDialog(options: OpenCreateTaskDialogOptions): Promise<void> {
    const frontend = getCurrentFrontend();
    if (isMobileCreateTaskFrontend(frontend)) {
        const host = document.createElement("div");
        const pageRoot = document.activeElement?.closest<HTMLElement>(".na-app");
        host.className = `nextaction na-mobile-create-task-root${pageRoot ? "" : " na-app"}`;
        (pageRoot || document.body).appendChild(host);
        let mounted: AsyncSvelteComponentMount<object> | null = null;
        let closed = false;
        const close = async () => {
            if (closed) return;
            closed = true;
            await mounted?.dispose();
            host.remove();
        };
        mounted = mountSvelteComponentAsync(() => import("../components/MobileCreateTaskHost.svelte"), {
            target: host,
            props: { ...options, onClose: close },
        });
        try {
            await mounted.ready;
        } catch (error) {
            await close();
            throw error;
        }
        return;
    }
    let mounted: AsyncSvelteComponentMount<object> | null = null;
    const dialog = new siyuan.Dialog({
        title:
            options.initialActionKind === "stage"
                ? options.i18n?.createStage || "Create Stage"
                : options.parentTask
                  ? options.i18n?.createChildTask || "Create child task"
                  : options.i18n?.createTask || "Create task",
        content: '<div class="nextaction na-create-task-host"></div>',
        width: "640px",
        destroyCallback: () => {
            void mounted?.dispose();
        },
    });
    dialog.element.classList.add("nextaction", "na-create-task-dialog");
    dialog.element.querySelector(".b3-dialog")?.classList.add("nextaction", "na-create-task-dialog");
    const style = document.createElement("style");
    style.dataset.naCreateTaskDialog = "true";
    style.textContent = createTaskDialogStyles;
    dialog.element.appendChild(style);
    const host = dialog.element.querySelector<HTMLElement>(".na-create-task-host");
    if (!host) {
        dialog.destroy();
        throw new Error(options.i18n?.createDialogUnavailable || "Task creation dialog is unavailable");
    }
    mounted = mountSvelteComponentAsync(() => import("../components/CreateTaskDialog.svelte"), {
        target: host,
        props: {
            bridge: options.bridge,
            i18n: options.i18n,
            dialog,
            parentTask: options.parentTask || null,
            initialActionKind: options.initialActionKind || "action",
            onCreated: options.onCreated,
        },
    });
    await mounted.ready;
}
