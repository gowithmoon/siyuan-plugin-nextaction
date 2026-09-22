import { getAllEditor, Menu, confirm, type IEventBusMap, type IProtyle, type Plugin } from "siyuan";
import { get } from "svelte/store";
import type { KernelBridge } from "../kernel-bridge";
import type { I18nStrings } from "../../shared/i18n";
import type { TaskCacheEntry } from "../../shared/types";
import { taskStore } from "../stores/task-store";
import { notifyError, notifyInfo, notifyOperationError } from "../notify";
import { normalizePriority, PRIORITY_LIST } from "../constants";
import { priorityI18nKey, statusI18nKey, translateKey } from "../i18n";
import { runAiDecomposeTask, runAiExtractTasks } from "../ai/ai-feature-service";
import { openReminderSettingsDialog } from "../dialogs/task-property-dialogs";
import { openCreateTaskDialog } from "../dialogs/create-task-dialog";
import { openTaskDetailDialog as openSharedTaskDetailDialog } from "../dialogs/task-detail-dialog";
import {
    closestTaskTarget,
    containsNativeTaskTarget,
    indexNativeTaskTargets,
    scanNativeTaskTargets,
} from "./editor-task-dom";
import type { TaskCommandController } from "./task-command-controller";
import { isProjectTask } from "../../shared/project-domain";
import { taskWriteWarningMessage } from "../utils";
import { syncDocumentTitleLayout } from "./document-title-layout";

export class EditorTaskIntegration {
    private blockIconHandler: ((event: CustomEvent<IEventBusMap["click-blockicon"]>) => void) | null = null;
    private editorTitleIconHandler: ((event: CustomEvent<IEventBusMap["click-editortitleicon"]>) => void) | null = null;
    private loadedProtyleHandler: ((event: CustomEvent<IEventBusMap["loaded-protyle-static"]>) => void) | null = null;
    private loadedProtyleDynamicHandler: ((event: CustomEvent<IEventBusMap["loaded-protyle-dynamic"]>) => void) | null =
        null;
    private nativeTaskObserver: MutationObserver | null = null;
    private nativeTaskRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    private taskStoreUnsubscribe: (() => void) | null = null;
    private documentTitleLayoutObserver: ResizeObserver | null = null;
    private documentThemeObserver: MutationObserver | null = null;
    private started = false;

    constructor(
        private readonly plugin: Plugin,
        private readonly i18n: I18nStrings,
        private readonly getBridge: () => KernelBridge,
        private readonly commands: TaskCommandController,
    ) {}

    private openCreateChildDialog = (parentTask: TaskCacheEntry) => {
        openCreateTaskDialog({
            bridge: this.getBridge(),
            i18n: this.i18n,
            parentTask,
            onCreated: (createdTask) => {
                taskStore.applyUpdate(createdTask);
            },
        }).catch((error) => notifyOperationError(error, this.plugin.i18n));
    };

    private sourceTitle(blockElement: HTMLElement): string {
        const editable = blockElement.querySelector<HTMLElement>('[contenteditable="true"]');
        const title = (editable?.textContent || blockElement.textContent || "").replace(/\s+/g, " ").trim();
        return title.slice(0, 512) || this.plugin.i18n.untitled || "(untitled)";
    }

    /**
     * Handle clicks on the ::before status checkbox in the editor.
     * Detects clicks in the left 20px area of a task block, opens a
     * status selection menu.
     */
    private handleEditorStatusClick = (event: MouseEvent | PointerEvent) => {
        const target = event.target as HTMLElement;
        const nativeAction = target.closest(".protyle-action--task") as HTMLElement | null;
        const taskTarget = closestTaskTarget(nativeAction || target);
        if (!taskTarget || (taskTarget.identificationSource === "native" && !nativeAction)) return;
        const taskBlock = taskTarget.taskElement;
        const isNative = taskTarget.identificationSource === "native";

        if (!isNative) {
            if (event.type !== "click") return;
            const rect = taskBlock.getBoundingClientRect();
            if (event.clientX > rect.left + 22 || event.clientX < rect.left) return;
        }

        event.stopPropagation();
        event.preventDefault();
        if (event.type !== "click") return;

        void this.openEditorTaskMenu(taskBlock, taskTarget.blockId, event, isNative);
    };

    private handleDocumentTaskStatusClick = (event: MouseEvent): void => {
        const action = event.currentTarget as HTMLElement;
        const blockId = action.dataset.taskBlockId;
        if (!blockId) return;
        event.preventDefault();
        event.stopPropagation();
        const taskBlock = action.closest(".protyle-title") as HTMLElement | null;
        if (taskBlock) void this.openEditorTaskMenu(taskBlock, blockId, event, false);
    };

    private handleDocumentTaskStatusKeydown = (event: KeyboardEvent): void => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const action = event.currentTarget as HTMLElement;
        const blockId = action.dataset.taskBlockId;
        const taskBlock = action.closest(".protyle-title") as HTMLElement | null;
        if (!blockId || !taskBlock) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = action.getBoundingClientRect();
        void this.openEditorTaskMenu(
            taskBlock,
            blockId,
            new MouseEvent("click", { clientX: rect.left, clientY: rect.bottom }),
            false,
        );
    };

    private syncDocumentTaskTitleLayout(title: HTMLElement): void {
        syncDocumentTitleLayout(title);
    }

    private syncDocumentTaskTitleActions(tasks: TaskCacheEntry[], targetProtyle?: IProtyle): void {
        const tasksById = new Map(
            tasks.filter((task) => task.identificationSource === "document").map((task) => [task.blockId, task]),
        );
        const protyles = targetProtyle ? [targetProtyle] : getAllEditor().map((editor) => editor.protyle);
        for (const protyle of protyles) {
            const title = protyle.title?.element;
            const blockId = protyle.block?.rootID || "";
            if (!title || !blockId) continue;
            const existing = title.querySelector<HTMLElement>(".na-document-task-status");
            const task = tasksById.get(blockId);
            if (!task) {
                existing?.remove();
                title.classList.remove("na-document-task-title");
                title.style.removeProperty("--nextaction-document-task-leading-offset");
                continue;
            }
            title.classList.add("na-document-task-title");
            this.syncDocumentTaskTitleLayout(title);
            this.documentTitleLayoutObserver?.observe(title);
            const action = (existing || document.createElement("button")) as HTMLButtonElement;
            action.classList.add("na-document-task-status", "na-status-checkbox");
            action.type = "button";
            action.tabIndex = 0;
            action.dataset.taskBlockId = blockId;
            action.setAttribute("aria-haspopup", "menu");
            action.setAttribute("aria-label", this.plugin.i18n.status || "Status");
            action.title = this.plugin.i18n.status || "Status";
            for (const className of Array.from(action.classList) as string[]) {
                if (className.startsWith("na-status-checkbox--")) action.classList.remove(className);
            }
            action.classList.add(`na-status-checkbox--${task.status}`);
            if (!existing) {
                action.addEventListener("click", this.handleDocumentTaskStatusClick);
                action.addEventListener("keydown", this.handleDocumentTaskStatusKeydown);
                action.addEventListener("pointerdown", (event: PointerEvent) => event.stopPropagation());
                title.append(action);
            }
        }
    }

    private handleEditorStatusKeydown = (event: KeyboardEvent) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const action = (event.target as HTMLElement).closest(".protyle-action--task") as HTMLElement | null;
        const taskTarget = action ? closestTaskTarget(action) : null;
        if (!action || !taskTarget || taskTarget.identificationSource !== "native") return;
        event.preventDefault();
        event.stopPropagation();
        const rect = action.getBoundingClientRect();
        void this.openEditorTaskMenu(
            taskTarget.taskElement,
            taskTarget.blockId,
            new MouseEvent("click", { clientX: rect.left, clientY: rect.bottom }),
            true,
        );
    };

    private decorateNativeTaskActions(root: ParentNode): void {
        const tasksById = new Map(get(taskStore).allTasks.map((task) => [task.blockId, task]));
        for (const taskTarget of scanNativeTaskTargets(root)) {
            const task = tasksById.get(taskTarget.blockId);
            for (const action of taskTarget.ownedActions) {
                action.setAttribute("role", "button");
                action.setAttribute("tabindex", "0");
                action.setAttribute("aria-haspopup", "menu");
                action.setAttribute("aria-label", this.plugin.i18n.taskStatus || "Task status");
                const status = task?.status || taskTarget.taskElement.getAttribute("custom-na-status") || "inbox";
                this.applyNativeTaskStatusVisual(taskTarget.taskElement, action, status);
            }
        }
    }

    private applyNativeTaskStatusVisual(taskBlock: HTMLElement, action: HTMLElement, status: string): void {
        const statusClassPrefix = "na-status-checkbox--";
        for (const className of Array.from(action.classList)) {
            if (className.startsWith(statusClassPrefix)) action.classList.remove(className);
        }
        action.classList.add("na-status-checkbox", `${statusClassPrefix}${status}`);
        taskBlock.dataset.naStatus = status;
        taskBlock.setAttribute("custom-na-status", status);
    }

    private syncNativeTaskDomState(tasks: TaskCacheEntry[]): void {
        const targetsById = indexNativeTaskTargets(document);
        for (const task of tasks) {
            if (task.identificationSource !== "native") continue;
            targetsById.get(task.blockId)?.forEach((target) => {
                target.taskElement.dataset.naStatus = task.status;
                target.taskElement.setAttribute("custom-na-status", task.status);
                target.ownedActions.forEach((action) =>
                    this.applyNativeTaskStatusVisual(target.taskElement, action, task.status),
                );
            });
        }
    }

    private async openEditorTaskMenu(
        taskBlock: HTMLElement,
        blockId: string,
        event: MouseEvent | PointerEvent,
        isNative: boolean,
    ): Promise<void> {
        let task = get(taskStore).allTasks.find((item) => item.blockId === blockId);
        if (isNative && !task) {
            try {
                await this.getBridge().rebuildCache();
                await taskStore.loadTasks();
                task = get(taskStore).allTasks.find((item) => item.blockId === blockId);
            } catch (error) {
                notifyOperationError(error, this.plugin.i18n);
                return;
            }
        }
        const currentStatus =
            task?.status || taskBlock.getAttribute("custom-na-status") || (isNative ? "inbox" : "todo");
        const currentPriority = normalizePriority(task?.priority || taskBlock.getAttribute("custom-na-priority"));
        const isProject = !!task && isProjectTask(task);

        const menu = new Menu("na-editor-status");

        // Status section
        for (const s of ["inbox", "todo", "doing", "waiting", "someday", "done"]) {
            const i18nKey = statusI18nKey(s);
            menu.addItem({
                icon: s === currentStatus ? "iconSelect" : "",
                label: translateKey(this.i18n, i18nKey, s),
                click: async () => {
                    try {
                        const updated = await this.getBridge().updateTask(blockId, { "na-status": s });
                        taskStore.applyUpdate(updated);
                        const warningMessage = taskWriteWarningMessage(updated._warning, this.i18n);
                        if (warningMessage) notifyInfo(warningMessage);
                    } catch (e) {
                        notifyOperationError(e, this.plugin.i18n);
                    }
                },
            });
        }

        menu.addSeparator();

        menu.addItem({
            icon: "iconSparkles",
            label: this.plugin.i18n.ai || "AI",
            type: "submenu",
            submenu: [
                {
                    icon: "iconSparkles",
                    label: isProject
                        ? this.plugin.i18n.aiDecomposeProject || "AI 拆解项目"
                        : this.plugin.i18n.aiDecomposeTask || "AI 拆解任务",
                    click: async () => {
                        const currentTask = get(taskStore).allTasks.find((item) => item.blockId === blockId);
                        if (currentTask) await runAiDecomposeTask(currentTask);
                    },
                },
            ],
        });

        menu.addSeparator();

        // Priority submenu
        menu.addItem({
            icon: "iconSort",
            label: this.plugin.i18n.priority || "Priority",
            type: "submenu",
            submenu: PRIORITY_LIST.map((p) => ({
                icon: p === currentPriority ? "iconSelect" : "",
                label: translateKey(this.i18n, priorityI18nKey(p), p),
                click: async () => {
                    try {
                        const updated = await this.getBridge().updateTask(blockId, { "na-priority": p });
                        taskStore.applyUpdate(updated);
                    } catch (e) {
                        notifyOperationError(e, this.plugin.i18n);
                    }
                },
            })),
        });

        menu.addSeparator();

        // My Day toggle
        const storeState = get(taskStore);
        const isInMyDay = storeState.myDayState?.tasks.some((t) => t.blockId === blockId) ?? false;
        menu.addItem({
            icon: isInMyDay ? "iconClose" : "iconBookmark",
            label: isInMyDay
                ? this.plugin.i18n.removeFromMyDay || "Remove from My Day"
                : this.plugin.i18n.addToMyDay || "Add to My Day",
            click: async () => {
                try {
                    const myDayState = isInMyDay
                        ? await this.getBridge().removeTaskFromMyDay(blockId)
                        : await this.getBridge().addTaskToMyDay(blockId);
                    taskStore.applyMyDayUpdate(myDayState);
                } catch (e) {
                    notifyOperationError(e, this.plugin.i18n);
                }
            },
        });
        menu.addSeparator();

        // Reminder
        menu.addItem({
            icon: "iconClock",
            label: this.plugin.i18n.reminderAddReminder || "添加提醒",
            click: () => {
                this.openReminderDialog(blockId);
            },
        });

        menu.addSeparator();

        // Task properties
        menu.addItem({
            icon: "iconEdit",
            label: isProject
                ? this.plugin.i18n.projectProperties || "Project Properties"
                : this.plugin.i18n.taskProperties || "Task Properties",
            click: () => {
                void this.openTaskDetailDialog(blockId);
            },
        });

        // Remove task
        menu.addItem({
            icon: "iconTrashcan",
            label: isProject
                ? this.plugin.i18n.removeProject || "Remove Project"
                : this.plugin.i18n.removeTask || "Remove Task",
            click: async () => {
                confirm(
                    isProject
                        ? this.plugin.i18n.removeProject || "Remove Project"
                        : this.plugin.i18n.removeTask || "Remove Task",
                    isProject
                        ? this.plugin.i18n.confirmRemoveProject ||
                              "This keeps the document and project fields, removes its Project identity, and clears direct Action assignments. Continue?"
                        : this.plugin.i18n.confirmRemoveTask ||
                              "This will clear all task attributes. This action cannot be undone.",
                    async () => {
                        try {
                            await this.getBridge().removeTask(blockId);
                            taskStore.applyRemove(blockId);
                        } catch (e) {
                            notifyOperationError(e, this.plugin.i18n);
                        }
                    },
                );
            },
        });

        menu.open({ x: event.clientX, y: event.clientY });
    }

    private resolveTaskBlock(
        element: HTMLElement,
    ): { element: HTMLElement; blockId: string; isNative: boolean } | null {
        const target = closestTaskTarget(element);
        return target
            ? {
                  element: target.taskElement,
                  blockId: target.blockId,
                  isNative: target.identificationSource === "native",
              }
            : null;
    }

    private addNativeTaskManagementItems(
        menu: { addItem: (options: Parameters<Menu["addItem"]>[0]) => unknown },
        blockId: string,
    ): void {
        const state = get(taskStore);
        const isInMyDay = state.myDayState?.tasks.some((task) => task.blockId === blockId) ?? false;
        menu.addItem({
            icon: isInMyDay ? "iconClose" : "iconBookmark",
            label: isInMyDay
                ? this.plugin.i18n.removeFromMyDay || "Remove from My Day"
                : this.plugin.i18n.addToMyDay || "Add to My Day",
            click: async () => {
                try {
                    const myDayState = isInMyDay
                        ? await this.getBridge().removeTaskFromMyDay(blockId)
                        : await this.getBridge().addTaskToMyDay(blockId);
                    taskStore.applyMyDayUpdate(myDayState);
                } catch (error) {
                    notifyOperationError(error, this.plugin.i18n);
                }
            },
        });
        menu.addItem({
            icon: "iconClock",
            label: this.plugin.i18n.reminderAddReminder || "添加提醒",
            click: () => this.openReminderDialog(blockId),
        });
        menu.addItem({
            icon: "iconEdit",
            label: this.plugin.i18n.taskProperties || "Task Properties",
            click: () => void this.openTaskDetailDialog(blockId),
        });
        menu.addItem({
            icon: "iconTrashcan",
            label: this.plugin.i18n.removeTask || "Remove Task",
            click: () => {
                confirm(
                    this.plugin.i18n.removeTask || "Remove Task",
                    this.plugin.i18n.confirmRemoveTask ||
                        "This will convert the native task to a regular list item and clear NextAction fields.",
                    async () => {
                        try {
                            await this.getBridge().removeTask(blockId);
                            taskStore.applyRemove(blockId);
                        } catch (error) {
                            notifyOperationError(error, this.plugin.i18n);
                        }
                    },
                );
            },
        });
    }

    private scheduleNativeTaskRefresh(): void {
        if (this.nativeTaskRefreshTimer) clearTimeout(this.nativeTaskRefreshTimer);
        this.nativeTaskRefreshTimer = setTimeout(() => {
            this.nativeTaskRefreshTimer = null;
            void this.getBridge()
                .rebuildCache()
                .then(() => taskStore.loadTasks())
                .catch((error) => console.warn("[NextAction] native task discovery refresh failed", error));
        }, 250);
    }

    /**
     * Open a reminder settings dialog for the given task.
     * Used from the editor status icon menu.
     */
    private openReminderDialog(blockId: string) {
        const storeState = get(taskStore);
        const task = storeState.allTasks.find((t) => t.blockId === blockId);
        if (!task) return;

        openReminderSettingsDialog(task, this.getBridge(), this.i18n, {
            onSave: (updated) => taskStore.applyUpdate(updated),
        });
    }

    /**
     * Open a dialog with the TaskDetail component for the given block.
     * Used from the editor status icon menu.
     */
    private async openTaskDetailDialog(blockId: string) {
        await openSharedTaskDetailDialog({
            blockId,
            bridge: this.getBridge(),
            i18n: this.i18n,
            onCreateChild: this.openCreateChildDialog,
        });
    }

    start(): void {
        if (this.started) return;
        this.started = true;
        // Block icon menu
        this.blockIconHandler = ({ detail }) => {
            const blockElements = detail.blockElements || [];
            const resolvedTask = blockElements.length === 1 ? this.resolveTaskBlock(blockElements[0]) : null;
            const taskBlock = !!resolvedTask;
            const resolvedTaskEntry = resolvedTask
                ? get(taskStore).allTasks.find((task) => task.blockId === resolvedTask.blockId)
                : undefined;
            const isProjectBlock = !!resolvedTaskEntry && isProjectTask(resolvedTaskEntry);
            detail.menu.addItem({
                icon: "iconSparkles",
                label: `[NextAction] ${this.plugin.i18n.ai || "AI"}`,
                type: "submenu",
                submenu: [
                    {
                        icon: "iconSparkles",
                        label: this.plugin.i18n.aiExtractTasks || "AI 提取任务",
                        click: async () =>
                            runAiExtractTasks(
                                blockElements
                                    .map((element: HTMLElement) => element.dataset.nodeId)
                                    .filter((id): id is string => Boolean(id)),
                            ),
                    },
                    ...(taskBlock
                        ? [
                              {
                                  icon: "iconSplitLR",
                                  label: isProjectBlock
                                      ? this.plugin.i18n.aiDecomposeProject || "AI 拆解项目"
                                      : this.plugin.i18n.aiDecomposeTask || "AI 拆解任务",
                                  click: async () => {
                                      const task = get(taskStore).allTasks.find(
                                          (item) => item.blockId === resolvedTask?.blockId,
                                      );
                                      if (task) await runAiDecomposeTask(task);
                                  },
                              },
                          ]
                        : []),
                ],
            });
            detail.menu.addItem({
                icon: "iconNextAction",
                label: `[NextAction] ${this.plugin.i18n.convertToTask}`,
                click: async () => {
                    for (const blockElement of detail.blockElements) {
                        const blockId = this.resolveTaskBlock(blockElement)?.blockId || blockElement.dataset.nodeId;
                        if (blockId) {
                            try {
                                await this.commands.doConvertToTask(blockId);
                            } catch (e) {
                                notifyOperationError(e, this.plugin.i18n);
                            }
                        }
                    }
                    void taskStore.loadTasks();
                },
            });
            detail.menu.addItem({
                icon: "iconFolder",
                label: `[NextAction] ${this.plugin.i18n.convertToProject}`,
                click: async () => {
                    for (const blockElement of detail.blockElements) {
                        const blockId = blockElement.dataset.nodeId;
                        if (blockId) {
                            try {
                                await this.commands.doConvertToTask(blockId, undefined, "2");
                            } catch (e) {
                                notifyOperationError(e, this.plugin.i18n);
                            }
                        }
                    }
                    void taskStore.loadTasks();
                },
            });
            detail.menu.addItem({
                icon: "iconDown",
                label: `[NextAction] ${this.plugin.i18n.convertToTaskWithChildren}`,
                click: async () => {
                    for (const blockElement of detail.blockElements) {
                        const blockId = blockElement.dataset.nodeId;
                        if (blockId) {
                            try {
                                const result = await this.commands.doConvertToTaskWithChildren(blockId);
                                const msg = this.plugin.i18n.convertToTaskWithChildrenResult
                                    .replace("{converted}", String(result.converted))
                                    .replace("{skipped}", String(result.skipped));
                                notifyInfo(msg);
                            } catch (e) {
                                notifyOperationError(e, this.plugin.i18n);
                            }
                        }
                    }
                    void taskStore.loadTasks();
                },
            });
            if (resolvedTask?.isNative) {
                detail.menu.addSeparator();
                this.addNativeTaskManagementItems(detail.menu, resolvedTask.blockId);
            }
        };
        this.plugin.eventBus.on("click-blockicon", this.blockIconHandler);

        // Document title icon menu
        this.editorTitleIconHandler = ({ detail }) => {
            const docId = detail.data?.id;
            if (!docId) return;
            detail.menu.addItem({
                icon: "iconSparkles",
                label: `[NextAction] ${this.plugin.i18n.aiExtractTasks || "AI 提取任务"}`,
                click: async () => runAiExtractTasks([docId]),
            });
            detail.menu.addItem({
                icon: "iconNextAction",
                label: `[NextAction] ${this.plugin.i18n.convertToTask}`,
                click: async () => {
                    try {
                        await this.commands.doConvertToTask(docId);
                        void taskStore.loadTasks();
                    } catch (e) {
                        notifyOperationError(e, this.plugin.i18n);
                    }
                },
            });
            detail.menu.addItem({
                icon: "iconFolder",
                label: `[NextAction] ${this.plugin.i18n.convertToProject}`,
                click: async () => {
                    try {
                        await this.commands.doConvertToTask(docId, undefined, "2");
                        void taskStore.loadTasks();
                    } catch (e) {
                        notifyOperationError(e, this.plugin.i18n);
                    }
                },
            });
            detail.menu.addItem({
                icon: "iconDown",
                label: `[NextAction] ${this.plugin.i18n.convertToTaskWithChildren}`,
                click: async () => {
                    try {
                        const result = await this.commands.doConvertToTaskWithChildren(docId);
                        const msg = this.plugin.i18n.convertToTaskWithChildrenResult
                            .replace("{converted}", String(result.converted))
                            .replace("{skipped}", String(result.skipped));
                        notifyInfo(msg);
                        void taskStore.loadTasks();
                    } catch (e) {
                        notifyOperationError(e, this.plugin.i18n);
                    }
                },
            });
        };
        this.plugin.eventBus.on("click-editortitleicon", this.editorTitleIconHandler);

        this.loadedProtyleHandler = ({ detail }) =>
            this.syncDocumentTaskTitleActions(get(taskStore).allTasks, detail.protyle);
        this.loadedProtyleDynamicHandler = ({ detail }) =>
            this.syncDocumentTaskTitleActions(get(taskStore).allTasks, detail.protyle);
        this.plugin.eventBus.on("loaded-protyle-static", this.loadedProtyleHandler);
        this.plugin.eventBus.on("loaded-protyle-dynamic", this.loadedProtyleDynamicHandler);

        // Capture native checkbox input before SiYuan toggles its binary marker.
        document.addEventListener("pointerdown", this.handleEditorStatusClick, true);
        document.addEventListener("mousedown", this.handleEditorStatusClick, true);
        document.addEventListener("click", this.handleEditorStatusClick, true);
        document.addEventListener("keydown", this.handleEditorStatusKeydown, true);
        this.decorateNativeTaskActions(document);
        if (typeof ResizeObserver !== "undefined") {
            this.documentTitleLayoutObserver = new ResizeObserver((entries) => {
                entries.forEach((entry) => this.syncDocumentTaskTitleLayout(entry.target as HTMLElement));
            });
        }
        this.documentThemeObserver = new MutationObserver(() => {
            this.syncDocumentTaskTitleActions(get(taskStore).allTasks);
        });
        this.documentThemeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["class", "style"],
        });
        if (document.body) {
            this.documentThemeObserver.observe(document.body, {
                attributes: true,
                attributeFilter: ["class", "style"],
            });
        }
        this.taskStoreUnsubscribe = taskStore.subscribe((state) => {
            this.syncNativeTaskDomState(state.allTasks);
            this.syncDocumentTaskTitleActions(state.allTasks);
        });
        this.nativeTaskObserver = new MutationObserver((mutations) => {
            let hasDocumentTitle = false;
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (!(node instanceof Element)) continue;
                    this.decorateNativeTaskActions(node);
                    if (node.matches(".protyle-title") || node.querySelector(".protyle-title")) hasDocumentTitle = true;
                }
            }
            if (hasDocumentTitle) this.syncDocumentTaskTitleActions(get(taskStore).allTasks);
            const hasNativeTask = mutations.some((mutation) =>
                [...mutation.addedNodes].some((node) => node instanceof Element && containsNativeTaskTarget(node)),
            );
            if (hasNativeTask) this.scheduleNativeTaskRefresh();
        });
        this.nativeTaskObserver.observe(document.body, { childList: true, subtree: true });
        this.syncDocumentTaskTitleActions(get(taskStore).allTasks);
    }

    dispose(): void {
        if (!this.started) return;
        this.started = false;
        document.removeEventListener("pointerdown", this.handleEditorStatusClick, true);
        document.removeEventListener("mousedown", this.handleEditorStatusClick, true);
        document.removeEventListener("click", this.handleEditorStatusClick, true);
        document.removeEventListener("keydown", this.handleEditorStatusKeydown, true);
        this.nativeTaskObserver?.disconnect();
        this.nativeTaskObserver = null;
        this.documentTitleLayoutObserver?.disconnect();
        this.documentTitleLayoutObserver = null;
        this.documentThemeObserver?.disconnect();
        this.documentThemeObserver = null;
        this.taskStoreUnsubscribe?.();
        this.taskStoreUnsubscribe = null;
        if (this.nativeTaskRefreshTimer) clearTimeout(this.nativeTaskRefreshTimer);
        this.nativeTaskRefreshTimer = null;
        if (this.blockIconHandler) this.plugin.eventBus.off("click-blockicon", this.blockIconHandler);
        if (this.editorTitleIconHandler) this.plugin.eventBus.off("click-editortitleicon", this.editorTitleIconHandler);
        if (this.loadedProtyleHandler) this.plugin.eventBus.off("loaded-protyle-static", this.loadedProtyleHandler);
        if (this.loadedProtyleDynamicHandler)
            this.plugin.eventBus.off("loaded-protyle-dynamic", this.loadedProtyleDynamicHandler);
        for (const title of document.querySelectorAll<HTMLElement>(".protyle-title.na-document-task-title")) {
            title.querySelector(".na-document-task-status")?.remove();
            title.classList.remove("na-document-task-title");
            title.style.removeProperty("--nextaction-document-task-leading-offset");
        }
        this.blockIconHandler = null;
        this.editorTitleIconHandler = null;
        this.loadedProtyleHandler = null;
        this.loadedProtyleDynamicHandler = null;
    }
}
