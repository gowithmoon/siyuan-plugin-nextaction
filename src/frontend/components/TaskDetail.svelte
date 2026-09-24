<script lang="ts">
    import NaButton from "../ui/NaButton.svelte";
    import NaPageHost from "../ui/NaPageHost.svelte";
    let actionsOpen = $state(false);
    import { confirm } from "siyuan";
    import { onDestroy, untrack } from "svelte";
    import type { TaskActionKind, TaskCacheEntry } from "../../shared/types";
    import type { I18nStrings } from "../../shared/i18n";
    import type { CustomFieldDef } from "../../shared/settings";
    import { encodeCustomFieldValue, isCustomFieldApplicable } from "../../shared/custom-fields";
    import { isProjectTask, normalizeActionKindForProjectScope } from "../../shared/project-domain";
    import { parseRepeatState } from "../../shared/repeat";
    import type { KernelBridge } from "../kernel-bridge";
    import { PRIORITY_LIST, STATUS_LIST } from "../constants";
    import {
        createTaskDetailTaskSource,
        projectMembershipGraph,
        taskChildrenByParent,
        taskDependentsByDependency,
        taskStore,
    } from "../stores/task-store";
    import { formatRpcError, notifyError, notifyInfo } from "../notify";
    import { jumpToBlock as jump, taskWriteWarningMessage } from "../utils";
    import { priorityI18nKey, statusI18nKey, translateKey } from "../i18n";
    import { getReminderState } from "../utils/reminder-utils";
    import { runAiDecomposeTask } from "../ai/ai-feature-service";
    import { openReminderSettingsDialog, openRepeatRuleDialog } from "../dialogs/task-property-dialogs";
    import { isTaskDateRangeValid, taskDetailDraftKey, type TaskDetailDraft } from "../utils/task-detail-draft";
    import {
        TaskDetailSession,
        TaskDetailTransitionQueue,
        taskDetailDraftToAttrs,
        type TaskDetailSessionSnapshot,
        type TaskDetailSaveState,
        type TaskDetailTransition,
    } from "../controllers/task-detail-controller";
    import NaCustomFieldInput from "../ui/NaCustomFieldInput.svelte";
    import NaDatePicker from "../ui/NaDatePicker.svelte";
    import NaDialogShell from "../ui/NaDialogShell.svelte";
    import NaDotRating from "../ui/NaDotRating.svelte";
    import NaIconButton from "../ui/NaIconButton.svelte";
    import NaInlineNotice from "../ui/NaInlineNotice.svelte";
    import NaPropertyRow from "../ui/NaPropertyRow.svelte";
    import NaPropertySection from "../ui/NaPropertySection.svelte";
    import NaSearchSelect from "../ui/NaSearchSelect.svelte";
    import NaSegmentControl from "../ui/NaSegmentControl.svelte";
    import NaTaskLinkList from "../ui/NaTaskLinkList.svelte";
    import NaToggle from "../ui/NaToggle.svelte";

    interface Props {
        task: TaskCacheEntry;
        bridge: KernelBridge;
        i18n: I18nStrings;
        onClose?: (() => void) | undefined;
        onConfirmDiscard?: ((confirmDiscard: () => void, cancelClose: () => void) => void) | undefined;
        onCreateChild?: ((task: TaskCacheEntry) => void) | undefined;
        onTaskChange?: ((task: TaskCacheEntry) => void) | undefined;
        showJumpToBlock?: boolean;
        dialogMode?: boolean;
        presentation?: "drawer" | "dialog" | "page";
    }

    let {
        task = $bindable(),
        bridge,
        i18n,
        onClose = undefined,
        onConfirmDiscard = undefined,
        onCreateChild = undefined,
        onTaskChange = undefined,
        showJumpToBlock = true,
        dialogMode = false,
        presentation = undefined,
    }: Props = $props();

    let status = $state("todo");
    let priority = $state("none");
    let importance = $state(4);
    let effort = $state(4);
    let due = $state("");
    let start = $state("");
    let note = $state("");
    let outcome = $state("");
    let dod = $state("");
    let actionKind: TaskActionKind = $state("action");
    let contexts: string[] = $state([]);
    let taskTags: string[] = $state([]);
    let parentId = $state("");
    let depends: string[] = $state([]);
    let depMode = $state("all");
    let sequentialEnabled = $state(false);
    let repeatEnabled = $state(false);
    let taskType = $state("1");
    let reviewInterval = $state(0);
    let reviewDate = $state("");
    let reviewIntervalMode = $state("0");
    let reviewIntervalCustom = $state("");
    let customFieldValues: Record<string, string> = $state({});
    let saveState = $state<TaskDetailSaveState>("idle");
    let saveError = $state("");
    let depError = $state("");
    let customFieldError = $state("");
    let repeatDateError = $state("");
    let operationBusy = $state(false);
    let repeatDateNoticeTaskId = "";
    let repeatDateErrorTimer: ReturnType<typeof setTimeout> | null = null;
    let shellElement: HTMLDivElement | undefined = $state();
    let appliedSessionTask: TaskCacheEntry | null = null;
    let removedHandled = false;
    const transitionQueue = new TaskDetailTransitionQueue();

    let allTasks = $derived($taskStore.allTasks || []);
    let allContexts = $derived($taskStore.contexts || []);
    let allTags = $derived($taskStore.tags || []);
    let taskMap = $derived(new Map(allTasks.map((entry) => [entry.blockId, entry])));
    let blockedByTasks = $derived(
        [
            ...($taskDependentsByDependency.get(task.blockId) || []),
            ...(task.parentId && taskMap.get(task.parentId) ? [taskMap.get(task.parentId)!] : []),
            ...($taskChildrenByParent.get(task.parentId) || []),
        ]
            .filter(
                (entry, index, entries) =>
                    entry.blockId !== task.blockId &&
                    entries.findIndex((item) => item.blockId === entry.blockId) === index,
            )
            .filter((entry) => entry.status !== "done")
            .map((entry) => {
                const reasons: string[] = [];
                if (entry.depends.split("|").filter(Boolean).includes(task.blockId))
                    reasons.push(i18n?.blockedByDependency || "Dependency");
                if (task.parentId && entry.blockId === task.parentId)
                    reasons.push(i18n?.blockedByChildren || "Blocked by subtasks");
                const parent = entry.parentId ? taskMap.get(entry.parentId) : undefined;
                if (
                    parent?.sequential &&
                    task.parentId === entry.parentId &&
                    task.sort < entry.sort &&
                    task.status !== "done"
                ) {
                    reasons.push(i18n?.blockedBySequence || "Blocked by sequence");
                }
                return {
                    blockId: entry.blockId,
                    title: entry.title || i18n?.untitled || "(untitled)",
                    status: entry.status,
                    reason: reasons.join(", "),
                };
            })
            .filter((entry) => Boolean(entry.reason)),
    );
    let parentLabel = $derived(parentId ? taskMap.get(parentId)?.title || i18n?.untitled || "(untitled)" : "");
    let depLabels = $derived(
        Object.fromEntries(depends.map((id) => [id, taskMap.get(id)?.title || i18n?.untitled || "(untitled)"])),
    );
    let childTasks = $derived(
        allTasks
            .filter((entry) => entry.parentId === task.blockId)
            .map((entry) => ({
                blockId: entry.blockId,
                title: entry.title || i18n?.untitled || "(untitled)",
                status: entry.status,
            })),
    );
    let customFieldDefs = $derived(
        (($taskStore.settings.customFields || []) as CustomFieldDef[]).filter((field) =>
            isCustomFieldApplicable(field, task, $projectMembershipGraph),
        ),
    );
    let isInMyDay = $derived(!!$taskStore.myDayState?.tasks.some((entry) => entry.blockId === task.blockId));
    let reminderState = $derived(getReminderState(task.reminder));
    let reminderStatusLabel = $derived(
        reminderState === "custom"
            ? i18n?.reminderConfigured || "Custom reminders"
            : reminderState === "disabled"
              ? i18n?.reminderDisabled || "Reminders disabled"
              : reminderState === "inherit" &&
                  !!task.due &&
                  $taskStore.settings?.reminderSettings?.useGlobalDefaultReminders
                ? i18n?.reminderInherited || "Inherited default reminders"
                : i18n?.notConfigured || "Not configured",
    );
    let repeatRuntimeState = $derived(parseRepeatState(task.repeatState));
    let repeatStatus = $derived(repeatRuntimeState?.status || (task.repeat ? "active" : ""));
    let dateError = $derived(getDateError(start, due));
    let noticeMessage = $derived(dateError || depError || customFieldError || saveError || repeatDateError);
    let noticeTone = $derived(
        (dateError || depError || customFieldError || saveError ? "error" : repeatDateError ? "warning" : "info") as
            "error" | "warning" | "info",
    );
    let statusLabel = $derived(
        saveState === "saving"
            ? i18n?.saving || "Saving..."
            : saveState === "pending"
              ? i18n?.savePending || "Pending"
              : saveState === "saved"
                ? i18n?.saved || "Saved"
                : saveState === "error"
                  ? i18n?.saveFailed || "Save failed"
                  : translateKey(i18n, statusI18nKey(status), status),
    );
    let statusTone = $derived(
        (saveState === "error" ? "error" : saveState === "pending" ? "warning" : "default") as
            "error" | "warning" | "default",
    );
    let relationSummary = $derived(
        [
            childTasks.length ? (i18n?.subtaskCount || "{n} subtasks").replace("{n}", String(childTasks.length)) : "",
            depends.length ? (i18n?.dependencyCount || "{n} dependencies").replace("{n}", String(depends.length)) : "",
            blockedByTasks.length
                ? (i18n?.blockedTaskCount || "{n} blocked tasks").replace("{n}", String(blockedByTasks.length))
                : "",
        ]
            .filter(Boolean)
            .join(" · ") ||
            i18n?.notConfigured ||
            "Not configured",
    );
    let reviewSummary = $derived(
        reviewInterval > 0
            ? (i18n?.reviewEveryDays || "Every {n} days").replace("{n}", String(reviewInterval))
            : i18n?.reviewIntervalNone || "None",
    );
    let taskTypeOptions = $derived([
        { value: "1", label: i18n?.task || "Task" },
        { value: "2", label: i18n?.project || "Project" },
    ]);
    let actionKindOptions = $derived([
        { value: "action", label: i18n?.actionKindAction || "Action" },
        { value: "stage", label: i18n?.actionKindStage || "Stage" },
    ]);
    let isProject = $derived(isProjectTask({ identificationSource: task.identificationSource, taskType }));
    let hasProjectScope = $derived(!isProject && Boolean($projectMembershipGraph.node(parentId)?.projectId));
    let aiDecomposeLabel = $derived(
        isProject
            ? i18n?.aiDecomposeProject || "Break down project with AI"
            : i18n?.aiDecomposeTask || "Break down with AI",
    );
    let removeLabel = $derived(isProject ? i18n?.removeProject || "Remove project" : i18n?.removeTask || "Remove task");
    let removeConfirmMessage = $derived(
        isProject
            ? i18n?.confirmRemoveProject ||
                  "This keeps the document and project fields, removes its Project identity, and clears direct Action assignments. Continue?"
            : i18n?.confirmRemoveTask || "This will clear all task attributes. This action cannot be undone.",
    );
    let headerSubtitle = $derived(
        [
            task.created ? formatCreated(task.created) : "",
            task.blocked && !isProject
                ? task.blockedReason === "children"
                    ? i18n?.blockedByChildren || "Blocked by subtasks"
                    : task.blockedReason === "sequential"
                      ? i18n?.blockedBySequence || "Blocked by sequence"
                      : i18n?.blockedByDependency || "Blocked by dependency"
                : "",
        ]
            .filter(Boolean)
            .join(" · "),
    );

    function buildDraft(): TaskDetailDraft {
        return {
            status,
            priority,
            importance,
            effort,
            due,
            start,
            note,
            outcome,
            dod,
            actionKind: isProject ? "" : normalizeActionKindForProjectScope(actionKind, hasProjectScope),
            contexts,
            taskTags,
            parentId,
            depends,
            depMode,
            sequentialEnabled,
            taskType,
            reviewInterval,
            reviewDate,
            customFieldValues,
        };
    }

    function applySessionSnapshot(snapshot: TaskDetailSessionSnapshot) {
        if (snapshot.availability === "removed" && !removedHandled) {
            removedHandled = true;
            if (snapshot.removalReason === "external") {
                notifyError(i18n?.errItemNotFound || i18n?.errTaskNotFound || "Project or task not found");
            }
            onClose?.();
            return;
        }
        const incomingKey = taskDetailDraftKey(snapshot.draft);
        if (incomingKey !== taskDetailDraftKey(buildDraft())) {
            const draft = snapshot.draft;
            status = draft.status;
            priority = draft.priority;
            importance = draft.importance;
            effort = draft.effort;
            due = draft.due;
            start = draft.start;
            note = draft.note;
            outcome = draft.outcome;
            dod = draft.dod;
            actionKind = draft.actionKind === "stage" ? "stage" : "action";
            contexts = [...draft.contexts];
            taskTags = [...draft.taskTags];
            parentId = draft.parentId;
            depends = [...draft.depends];
            depMode = draft.depMode;
            sequentialEnabled = draft.sequentialEnabled;
            taskType = draft.taskType;
            reviewInterval = draft.reviewInterval;
            reviewDate = draft.reviewDate;
            reviewIntervalMode =
                reviewInterval === 0
                    ? "0"
                    : [7, 14, 30, 60, 90].includes(reviewInterval)
                      ? String(reviewInterval)
                      : "custom";
            reviewIntervalCustom = reviewIntervalMode === "custom" ? String(reviewInterval) : "";
            customFieldValues = { ...draft.customFieldValues };
        }
        if (appliedSessionTask !== snapshot.task) {
            appliedSessionTask = snapshot.task;
            task = snapshot.task;
            onTaskChange?.(snapshot.task);
            repeatEnabled = !!snapshot.task.repeat;
            depError = "";
            customFieldError = "";
            repeatDateError = "";
        }
        saveState = snapshot.saveState;
        saveError = snapshot.saveError;
    }

    class CustomFieldDraftError extends Error {}

    const session = untrack(
        () =>
            new TaskDetailSession(task, {
                source: createTaskDetailTaskSource((blockId) => bridge.getTask(blockId)),
                save: async (blockId, draft) => {
                    const customAttrs: Record<string, string> = {};
                    for (const def of customFieldDefs) {
                        try {
                            customAttrs["na-ext-" + def.key] = encodeCustomFieldValue(
                                def,
                                draft.customFieldValues[def.key] || "",
                            );
                        } catch {
                            throw new CustomFieldDraftError(`${def.label}: ${getCustomFieldValidationError(def)}`);
                        }
                    }
                    const updated = await bridge.updateTask(blockId, taskDetailDraftToAttrs(draft, customAttrs));
                    const warningMessage = taskWriteWarningMessage(updated._warning, i18n);
                    if (warningMessage) notifyInfo(warningMessage);
                    return updated;
                },
                remove: (blockId) => bridge.removeTask(blockId),
                formatError: (error) =>
                    error instanceof CustomFieldDraftError ? error.message : formatRpcError(error, i18n),
                missingTaskMessage: i18n?.errItemNotFound || i18n?.errTaskNotFound || "Project or task not found",
            }),
    );
    const unsubscribeSession = session.subscribe(applySessionSnapshot);

    function getDateError(startValue: string, dueValue: string): string {
        if (!startValue || !dueValue) return "";
        return isTaskDateRangeValid(startValue, dueValue)
            ? ""
            : i18n?.dueBeforeStart || "Due date must not be earlier than start date";
    }

    function handleChange() {
        depError = "";
        customFieldError = "";
        saveError = "";
        session.edit(buildDraft());
    }

    function handleActionKindChange(value: string) {
        actionKind = value === "stage" ? "stage" : "action";
        handleChange();
    }

    function handleParentChange(selected: string | string[]) {
        parentId = typeof selected === "string" ? selected : "";
        actionKind = normalizeActionKindForProjectScope(
            actionKind,
            Boolean($projectMembershipGraph.node(parentId)?.projectId),
        );
        handleChange();
    }

    export async function flushPendingSave(): Promise<boolean> {
        return session.flush();
    }

    async function requestTransition(target: TaskDetailTransition): Promise<boolean> {
        return transitionQueue.run(target, async (queuedTarget) => {
            const decision = await session.transition(queuedTarget);
            if (decision === "applied") return true;
            if (decision === "blocked") return false;
            return new Promise<boolean>((resolve) => {
                const confirmDiscard = () => {
                    void session.confirmTransition().then((result) => resolve(result === "applied"));
                };
                const cancelTransition = () => {
                    session.cancelTransition();
                    resolve(false);
                };
                if (onConfirmDiscard) {
                    onConfirmDiscard(confirmDiscard, cancelTransition);
                } else {
                    confirm(
                        i18n?.unsavedChangesTitle || "Unsaved changes",
                        i18n?.unsavedChangesMessage || "Discard unsaved changes?",
                        confirmDiscard,
                        cancelTransition,
                    );
                }
            });
        });
    }

    export async function openTask(blockId: string): Promise<boolean> {
        return requestTransition({ type: "task", blockId });
    }

    export async function requestClose(): Promise<boolean> {
        const closed = await requestTransition({ type: "close" });
        if (closed) onClose?.();
        return closed;
    }

    async function openReminders() {
        if (!(await flushPendingSave())) return;
        openReminderSettingsDialog(task, bridge, i18n, { onSave: applyExternalUpdate });
    }

    async function handleOpenTask(blockId: string) {
        await openTask(blockId);
    }

    async function handleJumpToBlock(blockId: string) {
        if (dialogMode && !(await requestTransition({ type: "close" }))) return;
        if (!dialogMode && !(await flushPendingSave())) return;
        await jump(blockId);
        if (dialogMode) onClose?.();
    }

    async function openRepeatSettings() {
        if (!start && !due) {
            repeatDateError = i18n?.repeatNeedsDate || "Set a start or due date first";
            if (repeatDateErrorTimer) clearTimeout(repeatDateErrorTimer);
            repeatDateErrorTimer = setTimeout(() => {
                repeatDateError = "";
                repeatDateErrorTimer = null;
            }, 4200);
            return;
        }
        if (repeatDateErrorTimer) {
            clearTimeout(repeatDateErrorTimer);
            repeatDateErrorTimer = null;
        }
        repeatDateError = "";
        if (!(await flushPendingSave())) return;
        openRepeatRuleDialog({ ...task, start, due }, bridge, i18n, { onSave: applyExternalUpdate });
    }

    function applyExternalUpdate(updated: TaskCacheEntry) {
        session.receiveAuthoritativeTask(updated);
    }

    async function handleRepeatToggle(nextEnabled: boolean) {
        if (nextEnabled && !repeatEnabled) {
            await openRepeatSettings();
            return;
        }
        if (!nextEnabled && repeatEnabled) {
            if (!(await flushPendingSave())) return;
            operationBusy = true;
            try {
                const updated = await bridge.updateTask(task.blockId, { "na-repeat": "" });
                applyExternalUpdate(updated);
            } catch (error: any) {
                session.reportError(formatRpcError(error, i18n));
            } finally {
                operationBusy = false;
            }
        }
    }

    async function handleRepeatPauseToggle() {
        if (!(await flushPendingSave())) return;
        operationBusy = true;
        try {
            applyExternalUpdate(await bridge.setRepeatPaused(task.blockId, repeatStatus !== "paused"));
        } catch (error: any) {
            session.reportError(formatRpcError(error, i18n));
        } finally {
            operationBusy = false;
        }
    }

    async function handleRepeatSkip() {
        if (!(await flushPendingSave())) return;
        operationBusy = true;
        try {
            applyExternalUpdate(await bridge.skipRepeatOccurrence(task.blockId));
        } catch (error: any) {
            session.reportError(formatRpcError(error, i18n));
        } finally {
            operationBusy = false;
        }
    }

    async function toggleMyDay(checked: boolean) {
        operationBusy = true;
        try {
            const state = checked
                ? await bridge.addTaskToMyDay(task.blockId)
                : await bridge.removeTaskFromMyDay(task.blockId);
            taskStore.applyMyDayUpdate(state);
        } catch (error: any) {
            session.reportError(formatRpcError(error, i18n));
        } finally {
            operationBusy = false;
        }
    }

    async function searchParentTasks(query: string) {
        return allTasks
            .filter((entry) => entry.status !== "done" && entry.blockId !== task.blockId)
            .filter((entry) => !query || entry.title.toLowerCase().includes(query.toLowerCase()))
            .slice(0, 8)
            .map((entry) => ({ id: entry.blockId, label: entry.title || i18n?.untitled || "(untitled)" }));
    }

    async function searchDepTasks(query: string) {
        const ancestorIds = new Set<string>();
        let current = task.parentId;
        let depth = 0;
        while (current && depth < 20) {
            ancestorIds.add(current);
            current = taskMap.get(current)?.parentId || "";
            depth++;
        }
        return allTasks
            .filter(
                (entry) => entry.status !== "done" && entry.blockId !== task.blockId && !ancestorIds.has(entry.blockId),
            )
            .filter((entry) => !query || entry.title.toLowerCase().includes(query.toLowerCase()))
            .slice(0, 8)
            .map((entry) => ({ id: entry.blockId, label: entry.title || i18n?.untitled || "(untitled)" }));
    }

    function handleDateChange() {
        if (repeatDateErrorTimer) {
            clearTimeout(repeatDateErrorTimer);
            repeatDateErrorTimer = null;
        }
        repeatDateError = "";
        if (repeatEnabled && repeatDateNoticeTaskId !== task.blockId) {
            repeatDateNoticeTaskId = task.blockId;
            notifyInfo(i18n?.repeatDateCurrentOnly || "This date change only affects the current occurrence.");
        }
        handleChange();
    }

    function handleReviewIntervalChange() {
        if (reviewIntervalMode === "0") {
            reviewInterval = 0;
            reviewDate = "";
        } else if (reviewIntervalMode === "custom") {
            return;
        } else {
            reviewInterval = Number(reviewIntervalMode);
            reviewDate = addDays(localDateStr(), reviewInterval);
        }
        handleChange();
    }

    function handleReviewIntervalCustomChange() {
        const days = Number(reviewIntervalCustom);
        if (days < 1 || days > 365) return;
        reviewInterval = days;
        reviewDate = addDays(localDateStr(), days);
        handleChange();
    }

    function localDateStr() {
        const value = new Date();
        return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
    }

    function addDays(date: string, days: number) {
        const value = new Date(date + "T00:00:00");
        value.setDate(value.getDate() + days);
        return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
    }

    function getCustomFieldValidationError(def: CustomFieldDef) {
        if (def.type === "number") return i18n?.customFieldInvalidNumber || "Enter a valid number";
        if (def.type === "date") return i18n?.customFieldInvalidDate || "Enter a valid date";
        if (def.type === "datetime") return i18n?.customFieldInvalidDatetime || "Enter a valid date and time";
        if (def.type === "singleSelect" || def.type === "multiSelect")
            return i18n?.customFieldInvalidSelection || "Invalid selection";
        if (def.type === "url") return i18n?.customFieldInvalidLink || "Invalid link";
        if (def.type === "textarea") return i18n?.customFieldTextareaTooLong || "Long text is too long";
        if (def.type === "text") return i18n?.customFieldTextTooLong || "Text is too long";
        return i18n?.customFieldInvalidValue || "Invalid value";
    }

    function openCustomFieldLink(raw: string) {
        try {
            const value = raw.trim();
            const url = new URL(value);
            if (url.protocol === "siyuan:" && value.startsWith("siyuan://blocks/")) {
                jump(value.slice("siyuan://blocks/".length).split(/[/?#]/)[0]);
            } else if (url.protocol === "http:" || url.protocol === "https:") {
                window.open(url.toString(), "_blank", "noopener,noreferrer");
            } else {
                throw new Error("unsupported protocol");
            }
        } catch {
            session.reportError(i18n?.customFieldInvalidLink || "Invalid link");
        }
    }

    function handleRemove() {
        confirm(removeLabel, removeConfirmMessage, async () => {
            operationBusy = true;
            await session.removeCurrent();
            operationBusy = false;
        });
    }

    function handleWindowKeydown(event: KeyboardEvent) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            flushPendingSave();
            return;
        }
        if (!dialogMode || event.key !== "Escape" || event.defaultPrevented) return;
        const dialogs = (window as any).siyuan?.dialogs;
        const ownDialog = shellElement?.closest(".b3-dialog");
        const topDialog =
            Array.isArray(dialogs) && dialogs.length > 0
                ? dialogs[dialogs.length - 1]?.element?.querySelector(".b3-dialog")
                : null;
        if (topDialog && ownDialog !== topDialog) return;
        event.preventDefault();
        requestClose();
    }

    function formatCreated(created: string) {
        const value = new Date(created + "Z");
        return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")} ${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
    }

    onDestroy(() => {
        if (repeatDateErrorTimer) clearTimeout(repeatDateErrorTimer);
        unsubscribeSession();
        session.dispose({ bestEffort: true });
    });
</script>

{#if actionsOpen}
    <NaPageHost title={i18n.taskActions} backLabel={i18n.back} onBack={() => (actionsOpen = false)}>
        <div class="na-task-detail__page-actions">
            <NaButton
                onclick={() => {
                    actionsOpen = false;
                    onCreateChild?.(task);
                }}>{i18n.createChildTask}</NaButton
            >
            {#if showJumpToBlock}<NaButton
                    onclick={() => {
                        actionsOpen = false;
                        void handleJumpToBlock(task.contentBlockId || task.blockId);
                    }}>{i18n.jumpToBlock}</NaButton
                >{/if}
            <NaButton
                onclick={() => {
                    actionsOpen = false;
                    runAiDecomposeTask(task);
                }}>{aiDecomposeLabel}</NaButton
            >
            <NaButton
                disabled={operationBusy || saveState === "saving"}
                onclick={() => {
                    actionsOpen = false;
                    handleRemove();
                }}>{removeLabel}</NaButton
            >
        </div>
    </NaPageHost>
{/if}

<svelte:window onkeydown={handleWindowKeydown} />

<NaDialogShell
    bind:element={shellElement}
    variant={presentation || (dialogMode ? "dialog" : "drawer")}
    title={task.title || i18n?.untitled || "(untitled)"}
    subtitle={headerSubtitle}
    closeLabel={presentation === "page" ? i18n.back : i18n.close}
    status={statusLabel}
    {statusTone}
    showFooter={false}
    onClose={requestClose}
>
    {#snippet headerActions()}
        {#if presentation === "page"}
            <NaIconButton symbol="iconMore" label={i18n.taskActions} onclick={() => (actionsOpen = true)} />
        {:else}
            <div class="na-task-detail__header-actions">
                <NaIconButton
                    symbol="iconAdd"
                    label={i18n?.createChildTask || "Create child task"}
                    size={14}
                    onclick={() => onCreateChild?.(task)}
                />
                {#if showJumpToBlock}<NaIconButton
                        symbol="iconOpenWindow"
                        label={i18n?.jumpToBlock || "Jump to block"}
                        size={14}
                        onclick={() => handleJumpToBlock(task.contentBlockId || task.blockId)}
                    />{/if}
                <NaIconButton
                    symbol="iconSparkles"
                    label={aiDecomposeLabel}
                    size={14}
                    onclick={() => runAiDecomposeTask(task)}
                />
                <NaIconButton
                    symbol="iconTrashcan"
                    label={removeLabel}
                    size={14}
                    tone="danger"
                    disabled={operationBusy || saveState === "saving"}
                    onclick={handleRemove}
                />
            </div>
        {/if}
    {/snippet}

    {#if noticeMessage}
        <div class="na-task-detail__notice"><NaInlineNotice message={noticeMessage} tone={noticeTone} /></div>
    {/if}

    {#if isProject}
        <NaPropertySection
            title={i18n?.detailGroupProjectDefinition || "Project definition"}
            helpText={i18n?.projectDefinitionSourceHint ||
                "These properties control the project; document content remains free-form notes."}
        >
            <NaPropertyRow
                label={i18n?.outcome || "Outcome"}
                helpText={i18n?.outcomeHint || "The result this project is meant to create"}
                forId="na-project-outcome"
                stacked={true}
            >
                <input
                    id="na-project-outcome"
                    class="b3-text-field fn__block"
                    type="text"
                    maxlength="500"
                    placeholder={i18n?.outcomePlaceholder || "Describe the result in one sentence"}
                    bind:value={outcome}
                    oninput={handleChange}
                />
            </NaPropertyRow>
            <NaPropertyRow
                label={i18n?.definitionOfDone || "Definition of Done"}
                helpText={i18n?.dodHint || "Conditions to check before confirming completion"}
                forId="na-project-dod"
                stacked={true}
            >
                <textarea
                    id="na-project-dod"
                    class="b3-text-field fn__block"
                    rows="4"
                    maxlength="4000"
                    placeholder={i18n?.dodPlaceholder || "Describe the conditions that mean the outcome is achieved"}
                    bind:value={dod}
                    oninput={handleChange}
                ></textarea>
            </NaPropertyRow>
        </NaPropertySection>
    {/if}

    <NaPropertySection title={i18n?.detailGroupBasics || i18n?.detailGroupNotes || "Core properties"}>
        <NaPropertyRow label={i18n?.status || "Status"}>
            <select class="b3-select fn__block" bind:value={status} onchange={handleChange}>
                {#each STATUS_LIST as item}<option value={item}>{translateKey(i18n, statusI18nKey(item), item)}</option
                    >{/each}
            </select>
        </NaPropertyRow>
        {#if hasProjectScope}
            <NaPropertyRow
                label={i18n?.actionKind || "Action kind"}
                helpText={i18n?.actionKindHint || "Stages use the same status, dates, and execution rules as Actions"}
            >
                <NaSegmentControl
                    options={actionKindOptions}
                    value={actionKind || "action"}
                    label={i18n?.actionKind || "Action kind"}
                    onChange={handleActionKindChange}
                />
            </NaPropertyRow>
        {/if}
        <NaPropertyRow
            label={i18n?.taskType || "Item type"}
            helpText={i18n?.taskTypeHint || "Choose a task or project; projects add outcome and completion criteria"}
        >
            <NaSegmentControl
                options={taskTypeOptions}
                bind:value={taskType}
                label={i18n?.taskType || "Task type"}
                onChange={(value) => {
                    taskType = value;
                    handleChange();
                }}
            />
        </NaPropertyRow>
        <NaPropertyRow
            label={i18n?.priority || "Priority"}
            helpText={i18n?.priorityHint || "Urgency that combines with importance in automatic ranking"}
        >
            <select class="b3-select fn__block" bind:value={priority} onchange={handleChange}>
                {#each PRIORITY_LIST as item}<option value={item}
                        >{translateKey(i18n, priorityI18nKey(item), item)}</option
                    >{/each}
            </select>
        </NaPropertyRow>
        <NaPropertyRow
            label={i18n?.importance || "Importance"}
            helpText={i18n?.importanceHint || "Task value; higher values raise automatic ranking"}
            ><NaDotRating
                count={7}
                value={importance}
                onChange={(value) => {
                    importance = value;
                    handleChange();
                }}
            /></NaPropertyRow
        >
        <NaPropertyRow
            label={i18n?.effort || "Effort"}
            helpText={i18n?.effortHint || "Expected work; higher values reduce automatic ranking"}
            ><NaDotRating
                count={7}
                value={effort}
                onChange={(value) => {
                    effort = value;
                    handleChange();
                }}
            /></NaPropertyRow
        >
        <NaPropertyRow label={i18n?.note || "Note"} stacked={true}
            ><textarea class="b3-text-field fn__block" rows="3" bind:value={note} oninput={handleChange}
            ></textarea></NaPropertyRow
        >
    </NaPropertySection>

    <NaPropertySection title={i18n?.detailGroupTiming || "Schedule"}>
        <NaPropertyRow label={i18n?.startTime || i18n?.startDate || "Start"}
            ><NaDatePicker
                bind:value={start}
                defaultTime="00:00"
                fixedDropdown={true}
                {i18n}
                onChange={(value) => {
                    start = value;
                    handleDateChange();
                }}
            /></NaPropertyRow
        >
        <NaPropertyRow label={i18n?.dueTime || i18n?.dueDate || "Due"}
            ><NaDatePicker
                bind:value={due}
                defaultTime="23:59"
                fixedDropdown={true}
                {i18n}
                onChange={(value) => {
                    due = value;
                    handleDateChange();
                }}
            /></NaPropertyRow
        >
        <NaPropertyRow
            label={i18n?.myDay || "My Day"}
            helpText={i18n?.myDayHint || "Adds the task to today's plan without changing status or dates"}
            ><NaToggle
                checked={isInMyDay}
                disabled={operationBusy}
                label={i18n?.myDay || "My Day"}
                onChange={toggleMyDay}
            /></NaPropertyRow
        >
        <NaPropertyRow
            label={i18n?.reminder || "Reminders"}
            helpText={i18n?.reminderHint || "Schedule notifications at a fixed time or before the due date"}
        >
            <button
                type="button"
                class="b3-button b3-button--text na-task-detail__setting-action"
                onclick={openReminders}
            >
                {reminderStatusLabel}
            </button>
        </NaPropertyRow>
        <NaPropertyRow
            label={i18n?.repeat || "Repeat"}
            helpText={i18n?.repeatHint || "On completion, advance this task without creating a new SiYuan block"}
        >
            <div class="na-task-detail__repeat-control">
                <NaToggle
                    checked={repeatEnabled}
                    disabled={operationBusy}
                    label={i18n?.repeat || "Repeat"}
                    onChange={handleRepeatToggle}
                />
                {#if repeatEnabled}
                    {#if repeatStatus !== "ended"}<button
                            type="button"
                            class="b3-button"
                            disabled={operationBusy}
                            onclick={handleRepeatPauseToggle}
                            >{repeatStatus === "paused"
                                ? i18n?.repeatResume || "Resume"
                                : i18n?.repeatPause || "Pause"}</button
                        >{/if}
                    {#if repeatStatus === "active"}<button
                            type="button"
                            class="b3-button"
                            disabled={operationBusy}
                            onclick={handleRepeatSkip}>{i18n?.repeatSkipOccurrence || "Skip"}</button
                        >{/if}
                    <button
                        type="button"
                        class="b3-button b3-button--text"
                        disabled={operationBusy}
                        onclick={openRepeatSettings}>{i18n?.repeatConfigure || "Configure"}</button
                    >
                {/if}
            </div>
        </NaPropertyRow>
    </NaPropertySection>

    <NaPropertySection title={i18n?.detailGroupOrganization || "Organization"}>
        {#if !isProject}
            <NaPropertyRow
                label={i18n?.projectAssignment || i18n?.parentItem || "Join project or set parent task"}
                helpText={i18n?.projectAssignmentHint ||
                    "Changes logical assignment only; the SiYuan block stays in place"}
            >
                <NaSearchSelect
                    multi={false}
                    bind:selected={parentId}
                    bind:selectedLabel={parentLabel}
                    searchFn={searchParentTasks}
                    placeholder={i18n?.searchParentItem || "Search projects and tasks"}
                    emptyText={i18n?.noOptions || "No options"}
                    noMatchText={i18n?.noMatches || "No matches"}
                    loadingText={i18n?.loadingMore || "Loading"}
                    clearLabel={i18n?.clearProjectAssignment || "Clear project or parent assignment"}
                    removeLabel={i18n?.clearProjectAssignment || "Clear project or parent assignment"}
                    fixedDropdown={true}
                    onChange={handleParentChange}
                />
            </NaPropertyRow>
        {/if}
        <NaPropertyRow
            label={i18n?.context || "Context"}
            helpText={i18n?.contextHint || "The place, tool, or situation needed to do the task"}
        >
            <NaSearchSelect
                multi={true}
                allowCreate={true}
                bind:selected={contexts}
                allOptions={allContexts}
                placeholder={i18n?.addContext || "Add context"}
                emptyText={i18n?.noOptions || "No options"}
                noMatchText={i18n?.noMatches || "No matches"}
                loadingText={i18n?.loadingMore || "Loading"}
                clearLabel={i18n?.clearSelection || "Clear selection"}
                removeLabel={i18n?.removeSelection || "Remove selection"}
                fixedDropdown={true}
                onChange={(selected) => {
                    contexts = Array.isArray(selected) ? selected : [];
                    handleChange();
                }}
            />
        </NaPropertyRow>
        <NaPropertyRow label={i18n?.tag || "Tags"}>
            <NaSearchSelect
                multi={true}
                allowCreate={true}
                bind:selected={taskTags}
                allOptions={allTags}
                placeholder={i18n?.addTag || "Add tag"}
                emptyText={i18n?.noOptions || "No options"}
                noMatchText={i18n?.noMatches || "No matches"}
                loadingText={i18n?.loadingMore || "Loading"}
                clearLabel={i18n?.clearSelection || "Clear selection"}
                removeLabel={i18n?.removeSelection || "Remove selection"}
                fixedDropdown={true}
                onChange={(selected) => {
                    taskTags = Array.isArray(selected) ? selected : [];
                    handleChange();
                }}
            />
        </NaPropertyRow>
    </NaPropertySection>

    <NaPropertySection
        title={isProject
            ? i18n?.projectRelations || "Project relations"
            : i18n?.taskRelations || i18n?.detailGroupDependencies || "Task relations"}
        collapsible={true}
        open={false}
        summary={relationSummary}
    >
        <NaPropertyRow label={i18n?.subtasks || "Subtasks"} stacked={true}>
            <NaTaskLinkList
                items={childTasks}
                emptyText={i18n?.noSubtasks || "No subtasks"}
                openLabel={i18n?.jumpToBlock || "Jump to block"}
                onOpen={handleJumpToBlock}
                onSelect={handleOpenTask}
            />
        </NaPropertyRow>
        <NaPropertyRow label={i18n?.dependencies || "Depends on"}>
            <NaSearchSelect
                multi={true}
                bind:selected={depends}
                searchFn={searchDepTasks}
                initialLabels={depLabels}
                placeholder={i18n?.searchDepTask || "Search tasks"}
                emptyText={i18n?.noOptions || "No options"}
                noMatchText={i18n?.noMatches || "No matches"}
                loadingText={i18n?.loadingMore || "Loading"}
                clearLabel={i18n?.clearSelection || "Clear selection"}
                removeLabel={i18n?.removeSelection || "Remove selection"}
                fixedDropdown={true}
                onChange={(selected) => {
                    depends = Array.isArray(selected) ? selected : [];
                    handleChange();
                }}
            />
        </NaPropertyRow>
        <NaPropertyRow label={i18n?.blockedTasks || "Blocked tasks"} stacked={true}>
            <NaTaskLinkList
                items={blockedByTasks}
                emptyText={i18n?.noBlockedTasks || "No unfinished tasks are blocked by this task"}
                openLabel={i18n?.jumpToBlock || "Jump to block"}
                onOpen={handleJumpToBlock}
                onSelect={handleOpenTask}
            />
        </NaPropertyRow>
        <NaPropertyRow
            label={i18n?.depMode || "Dependency mode"}
            helpText={i18n?.depModeHint || "Unblock after all dependencies finish, or after any one finishes"}
        >
            <select class="b3-select fn__block" bind:value={depMode} onchange={handleChange}
                ><option value="all">{i18n?.depModeAll || "All must complete"}</option><option value="any"
                    >{i18n?.depModeAny || "Any can complete"}</option
                ></select
            >
        </NaPropertyRow>
        <NaPropertyRow
            label={i18n?.sequential || "Sequential"}
            helpText={i18n?.sequentialHint || "Run child tasks in order; earlier unfinished items block later ones"}
            ><NaToggle
                bind:checked={sequentialEnabled}
                label={i18n?.sequential || "Sequential"}
                onChange={(checked) => {
                    sequentialEnabled = checked;
                    handleChange();
                }}
            /></NaPropertyRow
        >
    </NaPropertySection>

    <NaPropertySection
        title={i18n?.detailGroupReview || "Review"}
        collapsible={true}
        open={false}
        summary={reviewSummary}
    >
        <NaPropertyRow
            label={i18n?.reviewInterval || "Review interval"}
            helpText={i18n?.reviewIntervalHint || "Schedule the next review this many days after each review"}
        >
            <div class="na-task-detail__review-control">
                <select class="b3-select" bind:value={reviewIntervalMode} onchange={handleReviewIntervalChange}>
                    <option value="0">{i18n?.reviewIntervalNone || "None"}</option>
                    {#each [7, 14, 30, 60, 90] as days}<option value={String(days)}
                            >{days} {i18n?.days || "days"}</option
                        >{/each}
                    <option value="custom">{i18n?.reviewIntervalCustom || "Custom"}</option>
                </select>
                {#if reviewIntervalMode === "custom"}<input
                        class="b3-text-field"
                        type="number"
                        min="1"
                        max="365"
                        bind:value={reviewIntervalCustom}
                        onchange={handleReviewIntervalCustomChange}
                    />{/if}
            </div>
        </NaPropertyRow>
        {#if reviewInterval > 0}<NaPropertyRow label={i18n?.reviewDate || "Next review"}
                ><NaDatePicker
                    value={reviewDate}
                    fixedDropdown={true}
                    {i18n}
                    onChange={(value) => {
                        reviewDate = value;
                        handleChange();
                    }}
                /></NaPropertyRow
            >{/if}
    </NaPropertySection>

    {#if customFieldDefs.length > 0}
        <NaPropertySection title={i18n?.customFields || "Custom fields"}>
            {#each customFieldDefs as def (def.key)}
                <NaPropertyRow label={def.label} helpText={def.description}>
                    <NaCustomFieldInput
                        {def}
                        value={customFieldValues[def.key] || ""}
                        {i18n}
                        fixedDropdown={true}
                        onChange={(value) => {
                            customFieldValues = { ...customFieldValues, [def.key]: value };
                            handleChange();
                        }}
                        onOpen={openCustomFieldLink}
                    />
                </NaPropertyRow>
            {/each}
        </NaPropertySection>
    {/if}
</NaDialogShell>

<style lang="scss">
    .na-task-detail__page-actions {
        display: grid;
        gap: 8px;
        padding: 12px;
    }
    .na-task-detail__header-actions {
        display: flex;
        align-items: center;
        gap: 2px;
    }
    .na-task-detail__notice {
        position: sticky;
        top: 0;
        z-index: 5;
        padding: 8px 16px;
        border-bottom: 1px solid var(--b3-border-color);
        background: color-mix(in srgb, var(--b3-theme-surface) 94%, transparent);
        box-shadow: 0 6px 18px color-mix(in srgb, var(--b3-theme-on-surface) 10%, transparent);
        backdrop-filter: blur(8px);
    }
    .na-task-detail__setting-action {
        min-width: 104px;
        justify-content: center;
    }
    .na-task-detail__repeat-control {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        flex-wrap: wrap;
        gap: 6px;
        width: 100%;
    }
    .na-task-detail__review-control {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
    }
    .na-task-detail__review-control .b3-select {
        min-width: 0;
        flex: 1;
    }
    .na-task-detail__review-control .b3-text-field {
        width: 72px;
        flex: 0 0 72px;
    }
    :global(.na-task-dialog-container) {
        width: min(520px, calc(100vw - 24px)) !important;
        height: min(720px, calc(100vh - 24px));
        max-height: calc(100vh - 24px);
        overflow: hidden;
    }
    :global(.na-task-dialog-container > .b3-dialog__body),
    :global(.na-task-dialog-content) {
        width: 100%;
        height: 100%;
        min-height: 0;
        overflow: hidden;
    }
    :global(.na-task-detail__repeat-control .b3-button) {
        min-height: var(--na-control-height-sm);
        padding: 2px 7px;
        font-size: var(--na-font-size-sm);
    }
    :global(.na-property-row__control > .na-date-picker),
    :global(.na-property-row__control > .na-search-select),
    :global(.na-property-row__control > .na-custom-field-input) {
        width: 100%;
    }
    @media (max-width: 520px) {
        .na-task-detail__repeat-control {
            justify-content: flex-start;
        }
        :global(.na-task-dialog-container) {
            width: calc(100vw - 12px) !important;
            height: calc(100vh - 12px);
            max-height: calc(100vh - 12px);
        }
    }
</style>
