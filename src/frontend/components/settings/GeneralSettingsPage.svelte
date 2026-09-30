<script lang="ts">
    import type { MyDayViewMode, ReminderDeliveryMode } from "../../../shared/settings";
    import type { CreateTaskDefaultTarget } from "../../../shared/task-creation";
    import type { ReminderSoundId } from "../../../shared/constants";
    import type { I18nStrings } from "../../../shared/i18n";
    import type { KernelBridge } from "../../kernel-bridge";
    import NaDocumentPicker from "../../ui/NaDocumentPicker.svelte";
    import NaButton from "../../ui/NaButton.svelte";
    import NaDotRating from "../../ui/NaDotRating.svelte";
    import NaIcon from "../../ui/NaIcon.svelte";
    import NaSettingRow from "../../ui/NaSettingRow.svelte";
    import NaSection from "../../ui/NaSection.svelte";

    type DocumentSelection = {
        id: string;
        title: string;
        notebookId: string;
        notebookName: string;
        path: string;
        icon: string;
    };

    interface Props {
        bridge: KernelBridge;
        i18n: I18nStrings;
        taskCreationDefaultCreateTarget: CreateTaskDefaultTarget;
        taskCreationInboxDocument: DocumentSelection | null;
        taskCreationDailyNoteNotebookId: string;
        taskCreationNotebooks?: Array<{ id: string; name: string; icon: string }>;
        defaultImportance: number;
        defaultEffort: number;
        semanticDateParsingEnabled: boolean;
        myDayResetHour: number;
        myDayDefaultViewMode: MyDayViewMode;
        myDayDefaultDuration: number;
        reminderDeliveryMode: ReminderDeliveryMode;
        reminderDefaultOffsets: number[];
        reminderDueSound: ReminderSoundId;
        reminderReviewSound: ReminderSoundId;
        reminderSoundEnabled: boolean;
        reminderUseGlobalDefault: boolean;
        systemNotificationsAvailable: boolean;
        testingSystemNotification: boolean;
        newOffsetValue: number;
        newOffsetUnit: "minutes" | "hours" | "days";
        soundIds: readonly ReminderSoundId[];
        getSoundLabel: (soundId: ReminderSoundId) => string;
        getUnitLabel: (unit: "minutes" | "hours" | "days") => string;
        minutesToDisplay: (minutes: number) => { value: number; unit: "minutes" | "hours" | "days" };
        onAddOffset: () => void;
        onRemoveOffset: (minutes: number) => void;
        onPreviewSound: (soundId: ReminderSoundId) => void;
        onTestSystemNotification: () => void;
        onTaskCreationDocumentChange: (document: DocumentSelection | null) => void;
        onResetTaskCreation: () => void;
        onResetDefaults: () => void;
        onResetMyDay: () => void;
        onResetReminder: () => void;
    }

    let {
        bridge,
        i18n,
        taskCreationDefaultCreateTarget = $bindable(),
        taskCreationInboxDocument = $bindable(),
        taskCreationDailyNoteNotebookId = $bindable(),
        taskCreationNotebooks = [],
        defaultImportance = $bindable(),
        defaultEffort = $bindable(),
        semanticDateParsingEnabled = $bindable(),
        myDayResetHour = $bindable(),
        myDayDefaultViewMode = $bindable(),
        myDayDefaultDuration = $bindable(),
        reminderDeliveryMode = $bindable(),
        reminderDefaultOffsets = $bindable(),
        reminderDueSound = $bindable(),
        reminderReviewSound = $bindable(),
        reminderSoundEnabled = $bindable(),
        reminderUseGlobalDefault = $bindable(),
        systemNotificationsAvailable,
        testingSystemNotification,
        newOffsetValue = $bindable(),
        newOffsetUnit = $bindable(),
        soundIds,
        getSoundLabel,
        getUnitLabel,
        minutesToDisplay,
        onAddOffset,
        onRemoveOffset,
        onPreviewSound,
        onTestSystemNotification,
        onTaskCreationDocumentChange,
        onResetTaskCreation,
        onResetDefaults,
        onResetMyDay,
        onResetReminder,
    }: Props = $props();
    let remindersDisabled = $derived(reminderDeliveryMode === "none");
</script>

<div class="na-page-stack na-settings-general">
    <NaSection
        icon="iconInbox"
        title={i18n?.settingTaskCreation || "Task creation"}
        description={i18n?.settingTaskCreationDesc || "Choose where newly created tasks are stored by default"}
        actionLabel={i18n?.settingResetSection || i18n?.settingReset || "Reset"}
        onAction={onResetTaskCreation}
    >
        <NaSettingRow
            forId="setting-task-creation-target"
            title={i18n?.settingTaskCreationDefaultTarget || "Default storage location"}
            description={i18n?.settingTaskCreationDefaultTargetDesc ||
                "Used by the task dialog and MCP when no location is specified"}
        >
            <select id="setting-task-creation-target" class="b3-select" bind:value={taskCreationDefaultCreateTarget}>
                <option value="inbox">{i18n?.settingTaskCreationTargetInbox || "Configured inbox document"}</option>
                <option value="daily_note">{i18n?.settingTaskCreationTargetDailyNote || "Today's daily note"}</option>
            </select>
        </NaSettingRow>
        {#if taskCreationDefaultCreateTarget === "inbox"}
            <NaSettingRow
                title={i18n?.settingTaskCreationInboxDocument || "Inbox document"}
                description={i18n?.settingTaskCreationInboxDocumentDesc ||
                    "Text blocks and document blocks will be created under this document"}
            >
                <NaDocumentPicker
                    {bridge}
                    {i18n}
                    bind:value={taskCreationInboxDocument}
                    fixedDropdown
                    onChange={(selection) => {
                        taskCreationInboxDocument = selection;
                        onTaskCreationDocumentChange(selection);
                    }}
                />
            </NaSettingRow>
        {:else}
            <NaSettingRow
                forId="setting-task-creation-daily-notebook"
                title={i18n?.settingTaskCreationDailyNoteNotebook || "Daily note notebook"}
                description={i18n?.settingTaskCreationDailyNoteNotebookDesc ||
                    "The current daily note in this notebook is used as the parent location"}
            >
                <select
                    id="setting-task-creation-daily-notebook"
                    class="b3-select"
                    bind:value={taskCreationDailyNoteNotebookId}
                >
                    <option value="">{i18n?.settingTaskCreationSelectNotebook || "Select a notebook"}</option>
                    {#each taskCreationNotebooks as notebook}<option value={notebook.id}>{notebook.name}</option>{/each}
                </select>
            </NaSettingRow>
        {/if}
    </NaSection>

    <NaSection
        icon="iconCheck"
        title={i18n?.settingDefaults || "Task defaults"}
        description={i18n?.settingDefaultsDesc || "Initial attributes when creating a task"}
        actionLabel={i18n?.settingResetSection || i18n?.settingReset || "Reset"}
        onAction={onResetDefaults}
    >
        <NaSettingRow
            title={i18n?.settingDefaultImportance || "Default importance"}
            description={i18n?.settingDefaultImportanceDesc || "Importance value for new tasks (1-7)"}
        >
            <NaDotRating count={7} bind:value={defaultImportance} color="var(--na-color-importance)" />
        </NaSettingRow>
        <NaSettingRow
            title={i18n?.settingDefaultEffort || "Default effort"}
            description={i18n?.settingDefaultEffortDesc || "Effort value for new tasks (1-7)"}
        >
            <NaDotRating count={7} bind:value={defaultEffort} color="var(--na-color-effort)" />
        </NaSettingRow>
        <NaSettingRow
            forId="setting-semantic-date-parsing"
            title={i18n?.settingSemanticDateParsing || "Parse dates from task titles"}
            description={i18n?.settingSemanticDateParsingDesc ||
                "Fill empty start and due dates when a block is first converted"}
        >
            <input
                id="setting-semantic-date-parsing"
                class="b3-switch"
                type="checkbox"
                bind:checked={semanticDateParsingEnabled}
            />
        </NaSettingRow>
    </NaSection>

    <NaSection
        icon="iconCalendar"
        title={i18n?.settingMyDay || "My Day"}
        description={i18n?.settingMyDayDesc || "Settings for the daily task planning view"}
        actionLabel={i18n?.settingResetSection || i18n?.settingReset || "Reset"}
        onAction={onResetMyDay}
    >
        <NaSettingRow
            forId="setting-myday-reset-hour"
            title={i18n?.settingMyDayResetHour || "Daily reset hour"}
            description={i18n?.settingMyDayResetHourDesc || "Before this hour still counts as the previous day (0-23)"}
        >
            <div class="na-settings-general__inline-control">
                <input
                    id="setting-myday-reset-hour"
                    class="b3-text-field na-settings-general__number"
                    type="number"
                    min={0}
                    max={23}
                    step={1}
                    bind:value={myDayResetHour}
                />
                <span>:00</span>
            </div>
        </NaSettingRow>
        <NaSettingRow
            title={i18n?.settingMyDayDefaultViewMode || "Default view mode"}
            description={i18n?.settingMyDayDefaultViewModeDesc || "Initial view when opening My Day"}
        >
            <div
                class="na-settings-general__segmented"
                aria-label={i18n?.settingMyDayDefaultViewMode || "Default view mode"}
            >
                <label class:active={myDayDefaultViewMode === "timeline"}>
                    <input type="radio" value="timeline" bind:group={myDayDefaultViewMode} />
                    <span>{i18n?.settingMyDayDefaultViewModeTimeline || "Timeline"}</span>
                </label>
                <label class:active={myDayDefaultViewMode === "list"}>
                    <input type="radio" value="list" bind:group={myDayDefaultViewMode} />
                    <span>{i18n?.settingMyDayDefaultViewModeList || "List"}</span>
                </label>
            </div>
        </NaSettingRow>
        <NaSettingRow
            forId="setting-myday-duration"
            title={i18n?.settingMyDayDefaultDuration || "Default schedule duration"}
            description={i18n?.settingMyDayDefaultDurationDesc ||
                "Default duration when dropping a task onto the timeline"}
        >
            <div class="na-settings-general__inline-control">
                <input
                    id="setting-myday-duration"
                    class="b3-text-field na-settings-general__number"
                    type="number"
                    min={15}
                    max={480}
                    step={15}
                    bind:value={myDayDefaultDuration}
                />
                <span>{i18n?.settingMinutes || "min"}</span>
            </div>
        </NaSettingRow>
    </NaSection>

    <NaSection
        icon="iconClock"
        title={i18n?.reminder || "Reminders"}
        description={i18n?.reminderSettingEnabledDesc || "Show notifications before due dates and on review dates"}
        actionLabel={i18n?.settingResetSection || i18n?.settingReset || "Reset"}
        onAction={onResetReminder}
    >
        <NaSettingRow
            forId="setting-reminder-delivery-mode"
            title={i18n.reminderDeliveryMode}
            description={i18n.reminderDeliveryModeDesc}
        >
            <select id="setting-reminder-delivery-mode" class="b3-select" bind:value={reminderDeliveryMode}>
                <option value="in-app">{i18n.reminderDeliveryModeInApp}</option>
                <option value="system">
                    {systemNotificationsAvailable
                        ? i18n.reminderDeliveryModeSystem
                        : i18n.reminderDeliveryModeSystemUnavailable}
                </option>
                <option value="none">{i18n.reminderDeliveryModeNone}</option>
            </select>
        </NaSettingRow>
        {#if reminderDeliveryMode === "system"}
            <NaSettingRow
                title={i18n.reminderSystemNotificationTest}
                description={i18n.reminderSystemNotificationTestDesc}
            >
                {#if systemNotificationsAvailable}
                    <NaButton
                        id="setting-reminder-test-system-notification"
                        size="sm"
                        loading={testingSystemNotification}
                        onclick={onTestSystemNotification}
                    >
                        {i18n.reminderSystemNotificationTest}
                    </NaButton>
                {:else}
                    <span class="na-settings-general__notification-unavailable" role="status">
                        {i18n.reminderSystemNotificationUnavailable}
                    </span>
                {/if}
            </NaSettingRow>
        {/if}
        <NaSettingRow
            disabled={remindersDisabled}
            forId="setting-reminder-use-global-default"
            title={i18n?.reminderSettingUseGlobalDefault || "Default reminders"}
            description={i18n?.reminderSettingUseGlobalDefaultDesc ||
                "Remind tasks with due dates but no per-task reminder using the default offsets above"}
        >
            <input
                id="setting-reminder-use-global-default"
                class="b3-switch"
                type="checkbox"
                bind:checked={reminderUseGlobalDefault}
                disabled={remindersDisabled}
            />
        </NaSettingRow>
        <NaSettingRow
            stacked={true}
            disabled={remindersDisabled}
            title={i18n?.reminderSettingDefaultOffsets || "Default advance times"}
            description={i18n?.reminderSettingDefaultOffsetsDesc ||
                "Advance times offered when configuring task reminders"}
        >
            <div class="na-settings-general__offset-editor">
                <div class="na-settings-general__offset-list">
                    {#each reminderDefaultOffsets as offset}
                        {@const display = minutesToDisplay(offset)}
                        <span class="na-settings-general__offset-chip">
                            <strong>{display.value}</strong>
                            <span>{getUnitLabel(display.unit)}</span>
                            <button
                                type="button"
                                class="b3-tooltips b3-tooltips__n"
                                onclick={() => onRemoveOffset(offset)}
                                disabled={remindersDisabled}
                                aria-label={i18n?.reminderRemoveOffset || "Remove"}
                            >
                                <NaIcon symbol="iconCloseRound" size={13} />
                            </button>
                        </span>
                    {:else}
                        <span class="na-settings-general__empty"
                            >{i18n?.reminderNoPending || "No advance times configured"}</span
                        >
                    {/each}
                </div>
                <div class="na-settings-general__offset-add">
                    <input
                        class="b3-text-field na-settings-general__number"
                        type="number"
                        min={1}
                        bind:value={newOffsetValue}
                        disabled={remindersDisabled}
                    />
                    <select class="b3-select" bind:value={newOffsetUnit} disabled={remindersDisabled}>
                        <option value="minutes">{i18n?.reminderOffsetMinutes || "minutes"}</option>
                        <option value="hours">{i18n?.reminderOffsetHours || "hours"}</option>
                        <option value="days">{i18n?.reminderOffsetDays || "days"}</option>
                    </select>
                    <button type="button" class="b3-button" onclick={onAddOffset} disabled={remindersDisabled}>
                        <NaIcon symbol="iconAdd" size={14} />
                        {i18n?.reminderAddOffset || "Add"}
                    </button>
                </div>
            </div>
        </NaSettingRow>
        {#if reminderDeliveryMode === "in-app"}
            <NaSettingRow
                forId="setting-reminder-due-sound"
                title={i18n?.reminderSettingDueSound || "Due reminder sound"}
            >
                <div class="na-settings-general__sound-control">
                    <select id="setting-reminder-due-sound" class="b3-select" bind:value={reminderDueSound}>
                        {#each soundIds as soundId}<option value={soundId}>{getSoundLabel(soundId)}</option>{/each}
                    </select>
                    <button
                        type="button"
                        class="b3-button b3-button--text b3-tooltips b3-tooltips__n"
                        onclick={() => onPreviewSound(reminderDueSound)}
                        aria-label={i18n?.reminderSoundPreview || "Preview"}
                    >
                        <NaIcon symbol="iconPlay" size={14} />
                    </button>
                </div>
            </NaSettingRow>
            <NaSettingRow
                forId="setting-reminder-review-sound"
                title={i18n?.reminderSettingReviewSound || "Review reminder sound"}
            >
                <div class="na-settings-general__sound-control">
                    <select id="setting-reminder-review-sound" class="b3-select" bind:value={reminderReviewSound}>
                        {#each soundIds as soundId}<option value={soundId}>{getSoundLabel(soundId)}</option>{/each}
                    </select>
                    <button
                        type="button"
                        class="b3-button b3-button--text b3-tooltips b3-tooltips__n"
                        onclick={() => onPreviewSound(reminderReviewSound)}
                        aria-label={i18n?.reminderSoundPreview || "Preview"}
                    >
                        <NaIcon symbol="iconPlay" size={14} />
                    </button>
                </div>
            </NaSettingRow>
            <NaSettingRow
                forId="setting-reminder-sound-enabled"
                title={i18n?.reminderSettingSoundEnabled || "Play reminder sounds"}
                description={i18n?.reminderSettingSoundEnabledDesc || "Play a sound when a reminder appears"}
            >
                <input
                    id="setting-reminder-sound-enabled"
                    class="b3-switch"
                    type="checkbox"
                    bind:checked={reminderSoundEnabled}
                />
            </NaSettingRow>
        {/if}
    </NaSection>
</div>

<style lang="scss">
    .na-settings-general__inline-control,
    .na-settings-general__sound-control,
    .na-settings-general__offset-add {
        display: flex;
        align-items: center;
        gap: 7px;
        color: var(--na-text-secondary);
        font-size: 12px;
    }

    :global(.na-settings-general__number) {
        width: 82px;
    }

    .na-settings-general__segmented {
        display: inline-flex;
        padding: 2px;
        border: 1px solid var(--b3-border-color);
        border-radius: var(--b3-border-radius);
        background: var(--b3-theme-background);

        label {
            position: relative;
            padding: 4px 10px;
            border-radius: calc(var(--b3-border-radius) - 2px);
            color: var(--na-text-secondary);
            cursor: pointer;
            font-size: 12px;

            &.active {
                color: var(--na-text-interactive);
                background: var(--b3-theme-primary-lightest);
            }
        }

        input {
            position: absolute;
            opacity: 0;
            pointer-events: none;
        }
    }

    .na-settings-general__offset-editor {
        width: 100%;
    }

    .na-settings-general__offset-list {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        min-height: 27px;
    }

    .na-settings-general__offset-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 5px 3px 9px;
        border: 1px solid var(--b3-border-color);
        border-radius: 999px;
        color: var(--na-text-secondary);
        background: var(--b3-theme-background);
        font-size: 11px;

        strong {
            color: var(--na-text-primary);
            font-weight: 600;
        }

        button {
            display: grid;
            place-items: center;
            width: 20px;
            height: 20px;
            padding: 0;
            border: 0;
            border-radius: 50%;
            color: var(--na-text-secondary);
            background: transparent;
            cursor: pointer;

            &:hover:not(:disabled) {
                color: var(--na-text-danger);
                background: var(--b3-theme-error-lightest);
            }
        }
    }

    .na-settings-general__offset-add {
        margin-top: 9px;
    }

    .na-settings-general__sound-control :global(.b3-select) {
        min-width: 128px;
    }

    .na-settings-general__empty {
        color: var(--na-text-secondary);
        font-size: 11px;
        font-style: italic;
    }

    .na-settings-general__notification-unavailable {
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-sm);
    }
</style>
