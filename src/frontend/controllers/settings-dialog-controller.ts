import { get } from "svelte/store";
import { Dialog } from "siyuan";
import type { PluginSettings } from "../../shared/settings";
import type { I18nStrings } from "../../shared/i18n";
import type { KernelBridge } from "../kernel-bridge";
import { notifyInfo, notifyOperationError } from "../notify";
import { taskStore } from "../stores/task-store";
import { mountSvelteComponentAsync, type AsyncSvelteComponentMount } from "../svelte-mount";

export class SettingsDialogController {
    private dialog?: Dialog;

    constructor(
        private readonly bridge: KernelBridge,
        private readonly i18n: I18nStrings,
    ) {}

    open(): void {
        if (this.dialog) return;
        let mounted: AsyncSvelteComponentMount<{ requestClose(): Promise<void> }> | null = null;
        const dialog = new Dialog({
            title: "",
            content: `<div id="naSettingsPanel" class="nextaction"></div>`,
            width: "min(840px, calc(100vw - 24px))",
            height: "min(620px, calc(100vh - 24px))",
            disableClose: true,
            hideCloseIcon: true,
            destroyCallback: () => {
                void mounted?.dispose();
                if (this.dialog === dialog) this.dialog = undefined;
            },
        });
        this.dialog = dialog;
        dialog.element.querySelector(".b3-dialog__header")?.remove();
        const container = dialog.element.querySelector("#naSettingsPanel") as HTMLElement | null;
        if (!container) {
            dialog.destroy();
            return;
        }
        const dialogContainer = dialog.element.querySelector(".b3-dialog__container") as HTMLElement | null;
        const dialogContent = dialog.element.querySelector(".b3-dialog__content") as HTMLElement | null;
        if (dialogContainer) dialogContainer.style.overflow = "hidden";
        if (dialogContent) {
            dialogContent.style.display = "flex";
            dialogContent.style.minHeight = "0";
            dialogContent.style.overflow = "hidden";
        }
        container.style.cssText += "height:100%;min-height:0;overflow:hidden;flex:1;";

        mounted = mountSvelteComponentAsync(() => import("../components/SettingsPanel.svelte"), {
            target: container,
            props: {
                bridge: this.bridge,
                i18n: this.i18n,
                onSave: async (settings: PluginSettings) => {
                    taskStore.applySettingsUpdate(settings);
                    try {
                        await this.bridge.recalcAllOrders();
                    } finally {
                        await taskStore.loadTasks();
                    }
                    const refreshError = get(taskStore).error;
                    if (refreshError) throw new Error(refreshError);
                    notifyInfo(this.i18n.settingsSaved || "Settings saved");
                },
                onClose: () => dialog.destroy(),
            },
        }) as AsyncSvelteComponentMount<{ requestClose(): Promise<void> }>;
        void mounted.ready
            .then((component) => {
                if (!component) return;
                dialog.element.querySelector(".b3-dialog__scrim")?.addEventListener(
                    "click",
                    (event) => {
                        event.preventDefault();
                        event.stopImmediatePropagation();
                        void component.requestClose();
                    },
                    { capture: true },
                );
            })
            .catch((error: unknown) => {
                dialog.destroy();
                notifyOperationError(error, this.i18n);
            });
    }

    dispose(): void {
        this.dialog?.destroy();
        this.dialog = undefined;
    }
}
