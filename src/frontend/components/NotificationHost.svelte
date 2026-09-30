<script lang="ts">
    import {
        notificationQueue,
        visibleNotifications,
        dismissReminder,
        dismissAllReminders,
    } from "../stores/reminder-store";
    import NotificationCard from "./NotificationCard.svelte";
    import { REMINDER_MAX_VISIBLE } from "../../shared/constants";
    import type { KernelBridge } from "../kernel-bridge";
    import { formatOperationError } from "../error-format";
    import { taskStore } from "../stores/task-store";
    import {
        actionMoveUndoFeedback,
        completeActionMoveUndo,
        dismissActionMoveUndo,
        failActionMoveUndo,
        markActionMoveUndoWorking,
    } from "../stores/action-move-undo-store";
    import ActionMoveUndoCard from "./ActionMoveUndoCard.svelte";

    interface Props {
        i18n: any;
        bridge?: KernelBridge | undefined;
    }

    let { i18n, bridge = undefined }: Props = $props();

    let hasNotifications = $derived($visibleNotifications.length > 0);
    let overflowCount = $derived(Math.max(0, $notificationQueue.length - REMINDER_MAX_VISIBLE));

    let dismissAllLabel = $derived(i18n?.reminderDismissAll || "全部关闭");

    function handleDismiss(item: {
        blockId: string;
        baseDateStr: string;
        minutesBefore: number;
        type: "due" | "review" | "absolute";
    }) {
        const dedupKey = `${item.blockId}|${item.baseDateStr}|${item.minutesBefore}|${item.type}`;
        dismissReminder(dedupKey);
    }

    function handleDismissAll() {
        dismissAllReminders();
    }

    async function handleActionMoveUndo(): Promise<void> {
        const feedback = $actionMoveUndoFeedback;
        if (!feedback || feedback.status !== "available") return;
        markActionMoveUndoWorking();
        try {
            if (!bridge) throw new Error("Kernel bridge is unavailable");
            const result = await bridge.undoActionMove(feedback.undo.credential);
            taskStore.applyUpdate(result.task);
            completeActionMoveUndo(feedback.undo.credential, result.task);
        } catch (cause: unknown) {
            const detail = formatOperationError(cause, i18n);
            failActionMoveUndo(
                feedback.undo.credential,
                (i18n?.moveActionUndoFailed || "Undo failed: {error}").replace("{error}", detail),
            );
        }
    }

    function handleUndoKeydown(event: KeyboardEvent): void {
        if (
            !$actionMoveUndoFeedback ||
            $actionMoveUndoFeedback.status !== "available" ||
            event.defaultPrevented ||
            event.key.toLowerCase() !== "z" ||
            (!event.ctrlKey && !event.metaKey)
        ) {
            return;
        }
        const target = event.target;
        if (
            target instanceof HTMLElement &&
            (target.isContentEditable || target.matches("input, textarea, select, [role='textbox']"))
        ) {
            return;
        }
        event.preventDefault();
        void handleActionMoveUndo();
    }

    function getMessage(item: { type: "due" | "review" | "absolute"; dueTime: number; triggerTime?: number }): string {
        if (item.type === "review") {
            return i18n?.reminderReviewToday || "今天需回顾";
        }
        if (item.type === "absolute") {
            // Show the fixed time for absolute reminders
            const d = new Date(item.dueTime);
            const month = d.getMonth() + 1;
            const day = d.getDate();
            const h = String(d.getHours()).padStart(2, "0");
            const m = String(d.getMinutes()).padStart(2, "0");
            const diffMs = item.dueTime - Date.now();
            if (diffMs <= 0) {
                return `${month}${i18n?.reminderMonth || "月"}${day}${i18n?.reminderDay || "日"} ${h}:${m}`;
            }
            return `${month}${i18n?.reminderMonth || "月"}${day}${i18n?.reminderDay || "日"} ${h}:${m}`;
        }
        // Calculate actual time remaining until due (or overdue)
        const diffMs = item.dueTime - Date.now();
        if (diffMs <= 0) {
            // Overdue
            const overdueMin = Math.round(Math.abs(diffMs) / 60000);
            if (overdueMin < 60) {
                const template = i18n?.reminderOverdueMinutes || "{n}min overdue";
                return template.replace("{n}", String(overdueMin));
            }
            const overdueH = Math.round(overdueMin / 60);
            if (overdueH < 24) {
                const template = i18n?.reminderOverdueHours || "{n}h overdue";
                return template.replace("{n}", String(overdueH));
            }
            const overdueD = Math.round(overdueH / 24);
            const template = i18n?.reminderOverdueDays || "{n}d overdue";
            return template.replace("{n}", String(overdueD));
        }
        // Still before due
        const remainMin = Math.round(diffMs / 60000);
        if (remainMin < 60) {
            const template = i18n?.reminderDueInMinutes || "Due in {n}min";
            return template.replace("{n}", String(remainMin));
        }
        const remainH = Math.round(remainMin / 60);
        if (remainH < 24) {
            const template = i18n?.reminderDueIn || "Due in {n}h";
            return template.replace("{n}", String(remainH));
        }
        const remainD = Math.round(remainH / 24);
        const template = i18n?.reminderDueInDays || "Due in {n}d";
        return template.replace("{n}", String(remainD));
    }
</script>

<svelte:window onkeydown={handleUndoKeydown} />

{#if hasNotifications || $actionMoveUndoFeedback}
    <div class="nextaction na-notification-host">
        {#if $actionMoveUndoFeedback}
            <ActionMoveUndoCard
                feedback={$actionMoveUndoFeedback}
                {i18n}
                onUndo={() => void handleActionMoveUndo()}
                onDismiss={dismissActionMoveUndo}
            />
        {/if}
        {#each $visibleNotifications as item (item.blockId + "|" + item.baseDateStr + "|" + item.minutesBefore + "|" + item.type)}
            <NotificationCard
                title={item.title}
                type={item.type}
                message={getMessage(item)}
                blockId={item.blockId}
                onDismiss={() => handleDismiss(item)}
                {i18n}
            />
        {/each}
        {#if hasNotifications}
            {#if overflowCount > 0}
                <div class="na-notification-host__overflow">
                    {(i18n?.reminderOverflow || "{count} more reminders").replace("{count}", String(overflowCount))}
                </div>
            {/if}
            <button class="na-notification-host__dismiss-all" onclick={handleDismissAll}>
                {dismissAllLabel}
            </button>
        {/if}
    </div>
{/if}
