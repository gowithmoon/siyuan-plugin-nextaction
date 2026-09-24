<script lang="ts">
    import type { ReminderAbsolute, ReminderItem, ReminderRelative } from "../../shared/types";
    import type { ReminderState } from "../utils/reminder-utils";
    import { REMINDER_MAX_PER_TASK } from "../../shared/constants";
    import { formatOffset, formatReminderDescription } from "../utils/reminder-utils";
    import NaDatePicker from "./NaDatePicker.svelte";
    import NaDialogShell from "./NaDialogShell.svelte";
    import NaIcon from "./NaIcon.svelte";
    import NaIconButton from "./NaIconButton.svelte";
    import NaInlineNotice from "./NaInlineNotice.svelte";
    import NaPropertyRow from "./NaPropertyRow.svelte";
    import NaPropertySection from "./NaPropertySection.svelte";

    export let items: ReminderItem[] = [];
    export let due = "";
    export let defaultOffsets: number[] = [];
    export let i18n: any;
    export let saving = false;
    export let error = "";
    export let reminderState: ReminderState = "inherit";
    export let globalDefaultEnabled = false;

    export let onChange: (items: ReminderItem[]) => void = () => {};
    export let onModeChange: (mode: ReminderState) => void = () => {};
    export let onClose: () => void = () => {};
    let showAbsolute = false;
    let absoluteTime = "";
    let offsetValue = 30;
    let offsetUnit = "minutes";

    $: selectedOffsets = new Set(
        items.filter((item) => item.type === "relative").map((item) => (item as ReminderRelative).minutes),
    );
    $: isFull = items.length >= REMINDER_MAX_PER_TASK;

    export function patchProps(patch: {
        saving?: boolean;
        error?: string;
        items?: ReminderItem[];
        due?: string;
        reminderState?: ReminderState;
    }) {
        if (patch.saving !== undefined) saving = patch.saving;
        if (patch.error !== undefined) error = patch.error;
        if (patch.items !== undefined) items = patch.items;
        if (patch.due !== undefined) due = patch.due;
        if (patch.reminderState !== undefined) reminderState = patch.reminderState;
    }

    function update(next: ReminderItem[]) {
        items = next;
        if (next.length > 0) reminderState = "custom";
        else reminderState = "inherit";
        onChange(next);
    }

    function setMode(mode: "inherit" | "disabled") {
        reminderState = mode;
        items = [];
        onModeChange(mode);
    }

    function sort(itemsToSort: ReminderItem[]) {
        return [...itemsToSort].sort((a, b) => {
            if (a.type === "relative" && b.type === "relative") return a.minutes - b.minutes;
            if (a.type === "absolute" && b.type === "absolute") return a.time.localeCompare(b.time);
            return a.type === "relative" ? -1 : 1;
        });
    }

    function removeItem(index: number) {
        update(items.filter((_, itemIndex) => itemIndex !== index));
    }

    function addAbsolute() {
        if (!absoluteTime || isFull || items.some((item) => item.type === "absolute" && item.time === absoluteTime))
            return;
        update(sort([...items, { type: "absolute", time: absoluteTime } as ReminderAbsolute]));
        absoluteTime = "";
        showAbsolute = false;
    }

    function toggleOffset(minutes: number) {
        if (selectedOffsets.has(minutes)) {
            update(items.filter((item) => !(item.type === "relative" && item.minutes === minutes)));
        } else if (!isFull) {
            update(sort([...items, { type: "relative", minutes } as ReminderRelative]));
        }
    }

    function addCustomOffset() {
        let minutes = Number(offsetValue);
        if (offsetUnit === "hours") minutes *= 60;
        if (offsetUnit === "days") minutes *= 1440;
        if (minutes < 1 || minutes > 20160 || isFull || selectedOffsets.has(minutes)) return;
        update(sort([...items, { type: "relative", minutes } as ReminderRelative]));
    }
</script>

<NaDialogShell
    variant="dialog"
    title={i18n?.reminderPopupTitle || "Reminder settings"}
    subtitle={`${items.length}/${REMINDER_MAX_PER_TASK}`}
    closeLabel={i18n?.close || "Close"}
    status={saving ? i18n?.saving || "Saving..." : ""}
    {onClose}
>
    {#snippet notice()}
        {#if error}<NaInlineNotice message={error} tone="error" />{/if}
    {/snippet}

    <NaPropertySection title={i18n?.reminderCurrent || i18n?.reminderPopupTitle || "Reminders"}>
        {#if reminderState === "inherit" && globalDefaultEnabled && due}
            <NaInlineNotice
                message={i18n?.reminderInheritGlobal ||
                    "Global default reminders enabled - this task will use default offsets"}
                tone="info"
            />
        {:else if reminderState === "disabled"}
            <NaInlineNotice message={i18n?.reminderDisabled || "Reminders are disabled for this task"} tone="warning" />
        {:else if reminderState === "invalid"}
            <NaInlineNotice message={i18n?.reminderInvalid || "This reminder value is invalid"} tone="warning" />
        {/if}
        {#if items.length === 0}
            <div class="na-reminder-editor__empty">{i18n?.reminderEmptyList || "No reminders"}</div>
        {:else}
            <div class="na-reminder-editor__list">
                {#each items as item, index}
                    <div class="na-reminder-editor__item">
                        <NaIcon symbol={item.type === "absolute" ? "iconCalendar" : "iconClock"} size={14} />
                        <span>{formatReminderDescription(item, i18n)}</span>
                        <NaIconButton
                            symbol="iconTrashcan"
                            label={i18n?.reminderRemoveOffset || "Remove"}
                            size={13}
                            tone="danger"
                            disabled={saving}
                            onclick={() => removeItem(index)}
                        />
                    </div>
                {/each}
            </div>
        {/if}
        <div class="na-reminder-editor__mode-actions">
            {#if reminderState === "disabled"}
                <button
                    type="button"
                    class="b3-button b3-button--text"
                    disabled={saving}
                    onclick={() => setMode("inherit")}
                    >{i18n?.reminderRestoreInherit || "Restore inherited reminders"}</button
                >
            {:else}
                <button
                    type="button"
                    class="b3-button b3-button--text"
                    disabled={saving}
                    onclick={() => setMode("disabled")}>{i18n?.reminderDisable || "Disable reminders"}</button
                >
            {/if}
        </div>
    </NaPropertySection>

    <NaPropertySection title={i18n?.reminderAbsolute || "Absolute reminder"}>
        <NaPropertyRow
            label={i18n?.reminderAddAbsolute || "Add"}
            helpText={i18n?.reminderAbsoluteHint || "Remind at a specific date and time, independent of the due date"}
            stacked={showAbsolute}
        >
            {#if showAbsolute}
                <div class="na-reminder-editor__absolute">
                    <NaDatePicker
                        bind:value={absoluteTime}
                        placeholder={i18n?.reminderAddAbsoluteDate || "Select date and time"}
                        defaultTime="09:00"
                        requireTime={true}
                        fixedDropdown={true}
                        {i18n}
                    />
                    <button
                        type="button"
                        class="b3-button b3-button--text"
                        disabled={!absoluteTime || isFull || saving}
                        onclick={addAbsolute}>{i18n?.apply || "Apply"}</button
                    >
                </div>
            {:else}
                <button
                    type="button"
                    class="b3-button b3-button--text"
                    disabled={isFull || saving}
                    onclick={() => (showAbsolute = true)}>{i18n?.reminderAddAbsolute || "Add"}</button
                >
            {/if}
        </NaPropertyRow>
    </NaPropertySection>

    <NaPropertySection title={i18n?.reminderRelativeSection || "Before due date"}>
        {#if !due}
            <NaInlineNotice message={i18n?.reminderNoDueDate || "Set a due date first"} tone="warning" />
        {:else}
            <div class="na-reminder-editor__presets">
                {#each defaultOffsets as offset}
                    <label>
                        <input
                            class="b3-switch"
                            type="checkbox"
                            checked={selectedOffsets.has(offset)}
                            disabled={saving || (isFull && !selectedOffsets.has(offset))}
                            onchange={() => toggleOffset(offset)}
                        />
                        <span>{formatOffset(offset, i18n)}</span>
                    </label>
                {/each}
            </div>
            <NaPropertyRow
                label={i18n?.reminderCustomOffset || i18n?.reminderAddOffset || "Custom offset"}
                helpText={i18n?.reminderCustomOffsetHint || "Remind 1 minute to 14 days before the due date"}
            >
                <div class="na-reminder-editor__offset">
                    <input
                        class="b3-text-field"
                        type="number"
                        min="1"
                        bind:value={offsetValue}
                        disabled={isFull || saving}
                    />
                    <select class="b3-select" bind:value={offsetUnit} disabled={isFull || saving}>
                        <option value="minutes">{i18n?.reminderOffsetMinutes || "Minutes"}</option>
                        <option value="hours">{i18n?.reminderOffsetHours || "Hours"}</option>
                        <option value="days">{i18n?.reminderOffsetDays || "Days"}</option>
                    </select>
                    <button
                        type="button"
                        class="b3-button b3-button--text"
                        disabled={isFull || saving}
                        onclick={addCustomOffset}>{i18n?.apply || "Apply"}</button
                    >
                </div>
            </NaPropertyRow>
        {/if}
    </NaPropertySection>

    {#snippet footerEnd()}
        <div>
            <button type="button" class="b3-button" onclick={onClose}>{i18n?.close || "Close"}</button>
        </div>
    {/snippet}
</NaDialogShell>

<style lang="scss">
    :global(.na-reminder-dialog-container) {
        max-width: calc(100vw - 24px);
        max-height: calc(100vh - 24px);
        overflow: hidden;
    }
    :global(.na-reminder-dialog-container > .b3-dialog__body),
    :global(.na-property-dialog-target) {
        width: 100%;
        height: 100%;
        min-height: 0;
        overflow: hidden;
    }
    .na-reminder-editor__empty {
        padding: 18px 0;
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-md);
        text-align: center;
    }
    .na-reminder-editor__list {
        display: flex;
        flex-direction: column;
    }
    .na-reminder-editor__item {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 36px;
        border-bottom: 1px solid var(--b3-border-color);
        color: var(--na-text-primary);
        font-size: var(--na-font-size-md);
    }
    .na-reminder-editor__item:last-child {
        border-bottom: 0;
    }
    .na-reminder-editor__item > span {
        min-width: 0;
        flex: 1;
    }
    .na-reminder-editor__item :global(.na-icon) {
        color: var(--na-text-secondary);
    }
    .na-reminder-editor__absolute,
    .na-reminder-editor__offset {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        min-width: 0;
    }
    .na-reminder-editor__absolute :global(.na-date-picker) {
        min-width: 0;
        flex: 1;
    }
    .na-reminder-editor__offset .b3-text-field {
        width: 64px;
    }
    .na-reminder-editor__offset .b3-select {
        min-width: 88px;
        flex: 1;
    }
    .na-reminder-editor__presets {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 2px 12px;
        padding: 8px 0;
    }
    .na-reminder-editor__presets label {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 30px;
        color: var(--na-text-primary);
        font-size: var(--na-font-size-md);
    }
    @media (max-width: 360px) {
        .na-reminder-editor__presets {
            grid-template-columns: 1fr;
        }
    }
</style>
