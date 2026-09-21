import type { Plugin } from "siyuan";
import NotificationHost from "../components/NotificationHost.svelte";
import { initAiFeatureService } from "../ai/ai-feature-service";
import { KernelBridge } from "../kernel-bridge";
import { notifyInfo } from "../notify";
import { destroyReminderStore, initReminderStore } from "../stores/reminder-store";
import { MobileNotificationLifecycle } from "./mobile-notification-lifecycle";
import { taskStore } from "../stores/task-store";
import { asI18nStrings } from "../../shared/i18n";
import type { MyDayState } from "../../shared/types";
import { mountSvelteComponent, type SvelteComponentMount } from "../svelte-mount";

const TASK_CALIBRATION_INTERVAL_MS = 5 * 60 * 1000;

export class FrontendRuntime {
    private bridge?: KernelBridge;
    private notificationHost?: SvelteComponentMount<object>;
    private calibrationTimer: ReturnType<typeof setInterval> | null = null;
    private disposed = false;
    private generation = 0;
    private readonly mobileNotifications: MobileNotificationLifecycle;
    private readonly tasksChangedV2Handler = (...params: unknown[]) => {
        taskStore.applyChangeSetV2(params[0]);
    };
    private readonly myDayChangedHandler = (...params: unknown[]) => {
        taskStore.applyMyDayUpdate(params[0] as MyDayState);
    };
    private readonly kernelStateHandler = async (event: unknown) => {
        const detail = (event as { detail?: { code?: number } })?.detail;
        if (this.disposed || detail?.code !== 2) return;
        notifyInfo(`${this.plugin.i18n.pluginName} ready`);
        taskStore.resetSync();
        await this.loadTaskStoreState();
    };

    constructor(
        private readonly plugin: Plugin,
        private readonly getCurrentDocumentId: () => string,
    ) {
        this.mobileNotifications = new MobileNotificationLifecycle(plugin);
    }

    start(): KernelBridge {
        if (this.bridge) return this.bridge;
        this.disposed = false;
        const bridge = new KernelBridge(this.plugin);
        this.bridge = bridge;
        taskStore.setBridge(bridge);
        taskStore.resetSync();
        this.mobileNotifications.start();
        initAiFeatureService({
            bridge,
            i18n: asI18nStrings(this.plugin.i18n),
            getCurrentDocumentId: this.getCurrentDocumentId,
        });
        void initReminderStore(this.plugin);
        this.notificationHost = mountSvelteComponent(NotificationHost, {
            target: document.body,
            props: { i18n: this.plugin.i18n, bridge },
        });
        this.plugin.eventBus.on("kernel-plugin-state-change", this.kernelStateHandler);
        this.plugin.kernel.rpc.bind("tasksChangedV2", this.tasksChangedV2Handler);
        this.plugin.kernel.rpc.bind("myDayChanged", this.myDayChangedHandler);
        this.calibrationTimer = setInterval(() => {
            if (document.visibilityState === "visible") void taskStore.loadTasks();
        }, TASK_CALIBRATION_INTERVAL_MS);
        void this.loadTaskStoreState();
        return bridge;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.generation++;
        if (this.bridge) {
            this.plugin.kernel.rpc.unbind("tasksChangedV2", this.tasksChangedV2Handler);
            this.plugin.kernel.rpc.unbind("myDayChanged", this.myDayChangedHandler);
        }
        if (this.calibrationTimer) clearInterval(this.calibrationTimer);
        this.calibrationTimer = null;
        taskStore.disposeSync();
        this.plugin.eventBus.off("kernel-plugin-state-change", this.kernelStateHandler);
        destroyReminderStore();
        this.mobileNotifications.dispose();
        void this.notificationHost?.dispose();
        this.notificationHost = undefined;
        this.bridge = undefined;
    }

    private async loadTaskStoreState(): Promise<void> {
        const generation = this.generation;
        await taskStore.loadSettings();
        if (this.disposed || generation !== this.generation) return;
        await taskStore.loadTasks();
        if (!this.disposed && generation === this.generation) await this.mobileNotifications.reconcile();
    }

    handleDataChanged(reason?: string): void {
        if (!this.disposed) void this.mobileNotifications.handleDataChanged(reason);
    }
}
