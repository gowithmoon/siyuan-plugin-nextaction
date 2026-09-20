import { Menu, confirm } from "siyuan";
import type { TaskCacheEntry } from "../../shared/types";
import { type KernelBridge } from "../kernel-bridge";
import { normalizePriority, STATUS_LIST, PRIORITY_LIST } from "../constants";
import { taskWriteWarningMessage, toI18nKey } from "../utils";
import { notifyError, notifyInfo, formatRpcError } from "../notify";
import { parseRepeatState } from "../../shared/repeat";
import { runAiDecomposeTask } from "../ai/ai-feature-service";
import { isProjectTask } from "../../shared/project-domain";

interface ContextMenuCallbacks {
    onUpdated: (updatedEntry: TaskCacheEntry) => void;
    onRemoved: (blockId: string) => void;
    onEdit?: (task: TaskCacheEntry) => void;
    onCreateChild?: (task: TaskCacheEntry) => void;
    onMyDayToggle?: (blockId: string, inMyDay: boolean) => void;
    onScheduleEdit?: (task: TaskCacheEntry) => void;
    onReminderEdit?: (blockId: string) => void;
    onProjectBoardMove?: (
        task: TaskCacheEntry,
        groupBy: "status" | "priority" | "importance",
        value: string | number,
        position?: "top" | "bottom",
    ) => Promise<void>;
}

export function showTaskContextMenu(
    task: TaskCacheEntry,
    event: MouseEvent,
    bridge: KernelBridge,
    i18n: any,
    callbacks: ContextMenuCallbacks,
    currentView?: string,
    inMyDay?: boolean,
): void {
    const menu = new Menu("na-task-context");
    const isProject = isProjectTask(task);
    if (callbacks.onScheduleEdit)
        menu.addItem({ icon: "iconCalendar", label: i18n.scheduleTask, click: () => callbacks.onScheduleEdit?.(task) });

    for (const s of STATUS_LIST) {
        const i18nKey = toI18nKey("status", s);
        menu.addItem({
            icon: s === task.status ? "iconSelect" : "",
            label: i18n?.[i18nKey] || s,
            click: async () => {
                try {
                    const updated = await bridge.updateTask(task.blockId, { "na-status": s });
                    callbacks.onUpdated(updated);
                    const warningMessage = taskWriteWarningMessage(updated._warning, i18n);
                    if (warningMessage) notifyInfo(warningMessage);
                } catch (e: any) {
                    console.error("[NextAction] updateTask (status) failed:", e);
                    notifyError(formatRpcError(e, i18n));
                }
            },
        });
    }

    menu.addSeparator();

    if (callbacks.onProjectBoardMove && !isProject) {
        menu.addItem({
            icon: "iconMove",
            label: i18n?.projectBoardMove || "Move on project board",
            type: "submenu",
            submenu: STATUS_LIST.map((status) => ({
                icon: status === task.status ? "iconSelect" : "",
                label: i18n?.[toI18nKey("status", status)] || status,
                click: () => callbacks.onProjectBoardMove!(task, "status", status, "bottom"),
            })),
        });
        menu.addItem({
            label: i18n?.projectBoardMoveTop || "Move to top",
            click: () => callbacks.onProjectBoardMove!(task, "status", task.status, "top"),
        });
        menu.addItem({
            label: i18n?.projectBoardMoveBottom || "Move to bottom",
            click: () => callbacks.onProjectBoardMove!(task, "status", task.status, "bottom"),
        });
        menu.addSeparator();
    }

    menu.addItem({
        icon: "iconSort",
        label: i18n?.priority || "Priority",
        type: "submenu",
        submenu: PRIORITY_LIST.map((p) => ({
            icon: p === normalizePriority(task.priority) ? "iconSelect" : "",
            label: i18n?.[toI18nKey("priority", p)] || p,
            click: async () => {
                try {
                    if (callbacks.onProjectBoardMove) {
                        await callbacks.onProjectBoardMove(task, "priority", p, "bottom");
                    } else {
                        const updated = await bridge.updateTask(task.blockId, { "na-priority": p });
                        callbacks.onUpdated(updated);
                    }
                } catch (e: any) {
                    console.error("[NextAction] updateTask (priority) failed:", e);
                    notifyError(formatRpcError(e, i18n));
                }
            },
        })),
    });

    if (callbacks.onProjectBoardMove && !isProject) {
        menu.addItem({
            icon: "iconRating",
            label: i18n?.importance || "Importance",
            type: "submenu",
            submenu: [1, 2, 3, 4, 5, 6, 7].map((value) => ({
                icon: value === (task.importance ?? 4) ? "iconSelect" : "",
                label: (i18n?.importanceLevel || "Importance {value}").replace("{value}", String(value)),
                click: () => callbacks.onProjectBoardMove!(task, "importance", value, "bottom"),
            })),
        });
    }

    menu.addSeparator();

    if (callbacks.onMyDayToggle) {
        const isInMyDay = inMyDay ?? false;
        menu.addItem({
            icon: isInMyDay ? "iconClose" : "iconBookmark",
            label: isInMyDay ? i18n?.removeFromMyDay || "Remove from My Day" : i18n?.addToMyDay || "Add to My Day",
            click: async () => {
                callbacks.onMyDayToggle!(task.blockId, isInMyDay);
            },
        });

        menu.addSeparator();
    }

    if (task.repeat) {
        const repeatState = parseRepeatState(task.repeatState);
        const repeatStatus = repeatState?.status || "active";

        if (repeatStatus === "active") {
            menu.addItem({
                label: i18n?.repeatSkipOccurrence || "跳过本次",
                click: async () => {
                    try {
                        const updated = await bridge.skipRepeatOccurrence(task.blockId);
                        callbacks.onUpdated(updated);
                        notifyInfo(i18n?.repeatOccurrenceSkipped || "已跳到下一次");
                    } catch (e: any) {
                        notifyError(formatRpcError(e, i18n));
                    }
                },
            });
        }

        if (repeatStatus !== "ended") {
            menu.addItem({
                label: repeatStatus === "paused" ? i18n?.repeatResume || "Resume" : i18n?.repeatPause || "Pause",
                click: async () => {
                    try {
                        const updated = await bridge.setRepeatPaused(task.blockId, repeatStatus !== "paused");
                        callbacks.onUpdated(updated);
                    } catch (e: any) {
                        notifyError(formatRpcError(e, i18n));
                    }
                },
            });
        }

        menu.addSeparator();
    }

    if (callbacks.onEdit) {
        menu.addItem({
            icon: "iconEdit",
            label: isProject
                ? i18n?.projectProperties || "Project Properties"
                : i18n?.taskProperties || "Task Properties",
            click: () => {
                callbacks.onEdit!(task);
            },
        });

        menu.addSeparator();
    }

    if (callbacks.onCreateChild) {
        menu.addItem({
            icon: "iconAdd",
            label: i18n?.createChildTask || "Create child task",
            click: () => callbacks.onCreateChild!(task),
        });
        menu.addSeparator();
    }

    menu.addItem({
        icon: "iconSparkles",
        label: isProject
            ? i18n?.aiDecomposeProject || "Break down project with AI"
            : i18n?.aiDecomposeTask || "Break down with AI",
        click: async () => runAiDecomposeTask(task),
    });

    menu.addSeparator();

    menu.addItem({
        icon: "iconClock",
        label: i18n?.reminderAddReminder || "添加提醒",
        click: () => {
            if (callbacks.onReminderEdit) {
                callbacks.onReminderEdit(task.blockId);
            }
        },
    });

    menu.addSeparator();

    menu.addItem({
        icon: "iconTrashcan",
        label: isProject ? i18n?.removeProject || "Remove Project" : i18n?.removeTask || "Remove Task",
        click: async () => {
            confirm(
                isProject ? i18n?.removeProject || "Remove Project" : i18n?.removeTask || "Remove Task",
                isProject
                    ? i18n?.confirmRemoveProject ||
                          "This keeps the document and project fields, removes its Project identity, and clears direct Action assignments. Continue?"
                    : i18n?.confirmRemoveTask || "This will clear all task attributes. This action cannot be undone.",
                async () => {
                    try {
                        await bridge.removeTask(task.blockId);
                        callbacks.onRemoved(task.blockId);
                    } catch (e: any) {
                        console.error("[NextAction] removeTask failed:", e);
                        notifyError(formatRpcError(e, i18n));
                    }
                },
            );
        },
    });

    menu.open({ x: event.clientX, y: event.clientY });
}
