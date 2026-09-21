import type { Plugin } from "siyuan";
import { get } from "svelte/store";
import type { TaskCacheEntry } from "../../shared/types";
import { taskStore } from "../stores/task-store";
import {
    destroyMobileNotificationStore,
    initMobileNotificationStore,
    onTasksChangedV2,
    rebuildAllMobileNotifications,
} from "../stores/mobile-notification-store";

/** Coordinates committed task data with the lifetime of native notification scheduling. */
export class MobileNotificationLifecycle {
    private active = false;
    private initialized = false;
    private generation = 0;
    private pending: Promise<void> = Promise.resolve();
    private unsubscribeChanges?: () => void;
    private unsubscribeSnapshots?: () => void;
    private readonly syncEndHandler = () => {
        void this.reconcile();
    };

    constructor(private readonly plugin: Plugin) {}

    start(): void {
        if (this.active) return;
        this.active = true;
        this.plugin.eventBus.on("sync-end", this.syncEndHandler);
        this.unsubscribeChanges = taskStore.observeCommittedChanges((changes, previous) => {
            // Before initialization the first authoritative rebuild includes these changes.
            if (!this.initialized) return;
            void this.enqueue(() => onTasksChangedV2(changes, previous));
        });
        this.unsubscribeSnapshots = taskStore.observeSnapshots(() => {
            void this.reconcile();
        });
    }

    handleDataChanged(reason?: string): Promise<void> {
        // SiYuan 1.2.x invokes this hook without a reason; newer callers may supply one.
        if (reason !== undefined && reason !== "sync" && reason !== "overwrite") return Promise.resolve();
        return this.reconcile();
    }

    reconcile(): Promise<void> {
        return this.enqueue(async () => {
            if (!taskStore.isReady()) return;
            const generation = this.generation;
            let initialTasks: readonly TaskCacheEntry[] | undefined;
            if (!this.initialized) {
                const ready = await initMobileNotificationStore(this.plugin, () => {
                    if (!taskStore.isReady()) return false;
                    initialTasks = get(taskStore).allTasks;
                    return true;
                });
                if (!this.active || generation !== this.generation) return;
                this.initialized = ready;
                if (!ready) return;
            }
            // Once old IDs are cancelled, finish replacing them even if a later load fails.
            // Successful newer snapshots enqueue their own reconciliation.
            const tasks = taskStore.isReady() ? get(taskStore).allTasks : initialTasks;
            if (tasks) await rebuildAllMobileNotifications(tasks);
        });
    }

    dispose(): void {
        if (!this.active) return;
        this.active = false;
        this.generation++;
        this.plugin.eventBus.off("sync-end", this.syncEndHandler);
        this.unsubscribeChanges?.();
        this.unsubscribeSnapshots?.();
        this.unsubscribeChanges = undefined;
        this.unsubscribeSnapshots = undefined;
        destroyMobileNotificationStore();
        this.initialized = false;
    }

    private enqueue(operation: () => Promise<void>): Promise<void> {
        if (!this.active) return Promise.resolve();
        const generation = this.generation;
        this.pending = this.pending
            .then(async () => {
                if (this.active && generation === this.generation) await operation();
            })
            .catch((error: unknown) => {
                console.error("[NextAction] reconcile mobile notifications failed:", error);
            });
        return this.pending;
    }
}
