<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { parseNaturalDate } from "../../shared/natural-date";
    import { portal } from "../utils/portal";
    import { getCurrentUiZIndex } from "../utils/layer";
    import NaIcon from "./NaIcon.svelte";

    export let value: string = ""; // "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" or ""
    export let placeholder: string = "";
    export let disabled: boolean = false;
    export let defaultTime: string = ""; // "HH:mm" e.g. "09:00" or "23:59"
    export let requireTime: boolean = false; // if true, time selection is mandatory
    export let fixedDropdown: boolean = false; // if true, use position:fixed for dropdown (for Dialog containers)
    export let i18n: any = null;

    export let onChange: (value: string) => void = () => {};

    let open = false;
    let viewYear: number;
    let viewMonth: number; // 0-11
    let containerEl: HTMLElement;
    let dropdownEl: HTMLElement;
    let hoverDate: string = "";
    let timeMode: boolean = false;
    let selectedHour: number = 0;
    let selectedMinute: number = 0;
    let hourListEl: HTMLElement;
    let minuteListEl: HTMLElement;
    let hourSnapTimer: ReturnType<typeof setTimeout> | null = null;
    let minuteSnapTimer: ReturnType<typeof setTimeout> | null = null;
    let isSnappingHour = false;
    let isSnappingMinute = false;
    let inputEl: HTMLInputElement;
    let inputText = "";
    let inputError = "";
    let inputFocused = false;
    let syncedValue: string | null = null;

    $: weekdays = i18n?.dpWeekdays ? i18n.dpWeekdays.split(",") : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    $: todayLabel = i18n?.dpToday || "Today";
    $: okLabel = i18n?.dpOk || "OK";
    $: clearLabel = i18n?.dpClear || "Clear";
    $: dateOnlyLabel = i18n?.dpDateOnly || "Date Only";
    $: setTimeLabel = i18n?.dpSetTime || "Set Time";
    $: hourLabel = i18n?.dpHour || "H";
    $: minuteLabel = i18n?.dpMinute || "Min";
    $: previousMonthLabel = i18n?.dpPreviousMonth || "Previous month";
    $: nextMonthLabel = i18n?.dpNextMonth || "Next month";
    const HOURS = Array.from({ length: 24 }, (_, i) => i);
    const MINUTES = Array.from({ length: 60 }, (_, i) => i);
    const ITEM_H = 22;
    const SNAP_DELAY = 80;

    $: today = getToday();
    $: if (!inputFocused && value !== syncedValue) syncInputFromValue();
    $: calendarDays = buildCalendarDays(viewYear, viewMonth);
    $: datePart = value ? value.split("T")[0] : "";

    function getToday(): string {
        const d = new Date();
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    function pad(n: number): string {
        return n < 10 ? `0${n}` : `${n}`;
    }

    function formatDateTimeDisplay(iso: string): string {
        if (!iso) return "";
        const hasTime = iso.includes("T");
        if (hasTime) {
            const [dateStr, timeStr] = iso.split("T");
            const parts = dateStr.split("-");
            if (parts.length !== 3) return iso;
            return `${parts[0]}/${parts[1]}/${parts[2]} ${timeStr}`;
        }
        const parts = iso.split("-");
        if (parts.length !== 3) return iso;
        return `${parts[0]}/${parts[1]}/${parts[2]}`;
    }

    function syncInputFromValue() {
        syncedValue = value;
        inputText = value ? formatDateTimeDisplay(value) : "";
        inputError = "";
    }

    function applyValue(nextValue: string, emitChange: boolean) {
        value = nextValue;
        syncInputFromValue();
        if (emitChange) onChange(nextValue);
    }

    function handleTextInput(event: Event) {
        inputText = (event.currentTarget as HTMLInputElement).value;
        inputError = "";
    }

    function commitNaturalInput() {
        const raw = inputText.trim();
        const currentDisplay = value ? formatDateTimeDisplay(value) : "";
        if (raw === currentDisplay) {
            inputError = "";
            return;
        }
        if (!raw) {
            applyValue("", true);
            return;
        }
        const parsed = parseNaturalDate(raw, { requireTime, defaultTime });
        if (!parsed) {
            inputError = i18n?.dpNaturalDateInvalid || "Could not recognize this date.";
            return;
        }
        applyValue(parsed.value, true);
        initViewModel();
        initTimeFromValue();
    }

    function handleInputBlur() {
        inputFocused = false;
        commitNaturalInput();
    }

    function handleInputKeydown(event: KeyboardEvent) {
        if (event.key !== "Enter" || event.isComposing) return;
        event.preventDefault();
        commitNaturalInput();
    }

    function parseDate(iso: string): { year: number; month: number; day: number } | null {
        const dateStr = iso.split("T")[0];
        const parts = dateStr.split("-");
        if (parts.length !== 3) return null;
        return { year: parseInt(parts[0]), month: parseInt(parts[1]), day: parseInt(parts[2]) };
    }

    function parseTime(iso: string): { hour: number; minute: number } {
        if (!iso.includes("T")) return { hour: 0, minute: 0 };
        const timeStr = iso.split("T")[1];
        if (!timeStr) return { hour: 0, minute: 0 };
        const parts = timeStr.split(":");
        return { hour: parseInt(parts[0]) || 0, minute: parseInt(parts[1]) || 0 };
    }

    function clampMinute(m: number): number {
        return Math.max(0, Math.min(59, m));
    }

    function buildCalendarDays(year: number, month: number): { date: string; day: number; inMonth: boolean }[] {
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const daysInPrevMonth = new Date(year, month, 0).getDate();

        const days: { date: string; day: number; inMonth: boolean }[] = [];

        for (let i = firstDay - 1; i >= 0; i--) {
            const d = daysInPrevMonth - i;
            const m = month === 0 ? 12 : month;
            const y = month === 0 ? year - 1 : year;
            days.push({ date: `${y}-${pad(m)}-${pad(d)}`, day: d, inMonth: false });
        }

        for (let d = 1; d <= daysInMonth; d++) {
            days.push({ date: `${year}-${pad(month + 1)}-${pad(d)}`, day: d, inMonth: true });
        }

        const remaining = 42 - days.length;
        for (let d = 1; d <= remaining; d++) {
            const m = month === 11 ? 1 : month + 2;
            const y = month === 11 ? year + 1 : year;
            days.push({ date: `${y}-${pad(m)}-${pad(d)}`, day: d, inMonth: false });
        }

        return days;
    }

    function initViewModel() {
        const dateStr = value ? value.split("T")[0] : "";
        if (dateStr) {
            const parsed = parseDate(dateStr);
            if (parsed) {
                viewYear = parsed.year;
                viewMonth = parsed.month - 1;
                return;
            }
        }
        const now = new Date();
        viewYear = now.getFullYear();
        viewMonth = now.getMonth();
    }

    function initTimeFromValue() {
        if (value && value.includes("T")) {
            const t = parseTime(value);
            selectedHour = t.hour;
            selectedMinute = clampMinute(t.minute);
            timeMode = true;
        } else {
            if (requireTime) {
                const dt = defaultTime || "09:00";
                const parts = dt.split(":");
                selectedHour = parseInt(parts[0]) || 0;
                selectedMinute = clampMinute(parseInt(parts[1]) || 0);
                timeMode = true;
            } else {
                selectedHour = 0;
                selectedMinute = 0;
                timeMode = false;
            }
        }
    }

    let dropdownStyle = "";

    function updateDropdownPosition() {
        if (!fixedDropdown || !open || !containerEl) return;
        const rect = containerEl.getBoundingClientRect();
        const viewportGap = 8;
        const dropdownWidth = 228;
        const maxViewportHeight = Math.max(0, window.innerHeight - viewportGap * 2);
        const dropdownHeight = Math.min(dropdownEl?.offsetHeight || 286, maxViewportHeight);
        const spaceBelow = window.innerHeight - rect.bottom - viewportGap;
        const spaceAbove = rect.top - viewportGap;
        const openAbove = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;
        const left = Math.max(viewportGap, Math.min(rect.left, window.innerWidth - dropdownWidth - viewportGap));
        const top = openAbove
            ? Math.max(viewportGap, rect.top - dropdownHeight - 4)
            : Math.min(rect.bottom + 4, window.innerHeight - dropdownHeight - viewportGap);
        dropdownStyle = `position:fixed;z-index:${getCurrentUiZIndex()};left:${left}px;top:${Math.max(viewportGap, top)}px;width:${dropdownWidth}px;max-height:${maxViewportHeight}px;overflow-y:auto;`;
    }

    function toggleOpen() {
        if (disabled) return;
        if (!open) {
            initViewModel();
            initTimeFromValue();
            if (timeMode || requireTime) scrollToSelected();
        }
        open = !open;
        if (open && fixedDropdown) {
            // Use requestAnimationFrame to ensure DOM is ready
            requestAnimationFrame(() => updateDropdownPosition());
        }
    }

    function selectDay(date: string) {
        if (timeMode || requireTime) {
            const nextValue = `${date}T${pad(selectedHour)}:${pad(selectedMinute)}`;
            applyValue(nextValue, false);
            const parsed = parseDate(date);
            if (parsed) {
                viewYear = parsed.year;
                viewMonth = parsed.month - 1;
            }
        } else {
            applyValue(date, false);
            open = false;
            onChange(date);
        }
    }

    function selectToday() {
        if (timeMode) {
            const nextValue = `${today}T${pad(selectedHour)}:${pad(selectedMinute)}`;
            applyValue(nextValue, false);
            initViewModel();
        } else {
            applyValue(today, false);
            initViewModel();
            open = false;
            onChange(today);
        }
    }

    function toggleTimeMode() {
        if (requireTime) return; // cannot disable time when required
        timeMode = !timeMode;
        if (timeMode) {
            if (!value || !value.includes("T")) {
                const dt = defaultTime || "00:00";
                const parts = dt.split(":");
                selectedHour = parseInt(parts[0]) || 0;
                selectedMinute = clampMinute(parseInt(parts[1]) || 0);
            }
            scrollToSelected();
        } else {
            const nextValue = value && value.includes("T") ? value.split("T")[0] : value;
            if (value && value.includes("T")) {
                applyValue(nextValue, false);
            }
            open = false;
            onChange(nextValue);
        }
    }

    function confirmDateTime() {
        let nextValue = value;
        if (timeMode || requireTime) {
            const d = value ? value.split("T")[0] : today;
            nextValue = `${d}T${pad(selectedHour)}:${pad(selectedMinute)}`;
            applyValue(nextValue, false);
        }
        open = false;
        onChange(nextValue);
    }

    function clearValue() {
        applyValue("", false);
        timeMode = false;
        open = false;
        onChange("");
    }

    function onHourClick(h: number) {
        selectedHour = h;
        if (hourListEl) hourListEl.scrollTop = HOURS.indexOf(h) * ITEM_H;
    }

    function onMinuteClick(m: number) {
        selectedMinute = m;
        if (minuteListEl) minuteListEl.scrollTop = MINUTES.indexOf(m) * ITEM_H;
    }

    function snapAfterScroll(el: HTMLElement, isHour: boolean) {
        if (!el) return;
        const maxIdx = isHour ? 23 : 59;
        const idx = Math.round(el.scrollTop / ITEM_H);
        const clamped = Math.max(0, Math.min(maxIdx, idx));
        const targetTop = clamped * ITEM_H;
        if (Math.abs(el.scrollTop - targetTop) < 1) return;
        if (isHour) isSnappingHour = true;
        else isSnappingMinute = true;
        el.scrollTo({ top: targetTop, behavior: "smooth" });
        const onEnd = () => {
            el.removeEventListener("scroll", onEnd);
            el.removeEventListener("touchend", onEnd);
            if (isHour) isSnappingHour = false;
            else isSnappingMinute = false;
        };
        el.addEventListener("scroll", onEnd);
        el.addEventListener("touchend", onEnd);
    }

    function handleHourScroll() {
        if (!hourListEl || isSnappingHour) return;
        const idx = Math.round(hourListEl.scrollTop / ITEM_H);
        const clamped = Math.max(0, Math.min(23, idx));
        if (clamped !== selectedHour) selectedHour = clamped;
        if (hourSnapTimer) clearTimeout(hourSnapTimer);
        hourSnapTimer = setTimeout(() => snapAfterScroll(hourListEl, true), SNAP_DELAY);
    }

    function handleMinuteScroll() {
        if (!minuteListEl || isSnappingMinute) return;
        const idx = Math.round(minuteListEl.scrollTop / ITEM_H);
        const clamped = Math.max(0, Math.min(MINUTES.length - 1, idx));
        if (MINUTES[clamped] !== selectedMinute) selectedMinute = MINUTES[clamped];
        if (minuteSnapTimer) clearTimeout(minuteSnapTimer);
        minuteSnapTimer = setTimeout(() => snapAfterScroll(minuteListEl, false), SNAP_DELAY);
    }

    function scrollToSelected() {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (hourListEl) hourListEl.scrollTop = HOURS.indexOf(selectedHour) * ITEM_H;
                if (minuteListEl) minuteListEl.scrollTop = MINUTES.indexOf(selectedMinute) * ITEM_H;
            });
        });
    }

    function prevMonth() {
        if (viewMonth === 0) {
            viewMonth = 11;
            viewYear--;
        } else {
            viewMonth--;
        }
    }

    function nextMonth() {
        if (viewMonth === 11) {
            viewMonth = 0;
            viewYear++;
        } else {
            viewMonth++;
        }
    }

    function handleClickOutside(e: MouseEvent) {
        const target = e.target as Node;
        if (containerEl?.contains(target) || dropdownEl?.contains(target)) return;
        open = false;
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape" && open) {
            open = false;
            e.preventDefault();
            e.stopPropagation();
        } else if (e.key === "Escape" && e.target === inputEl) {
            syncInputFromValue();
            e.preventDefault();
            e.stopPropagation();
        }
    }

    function handleViewportChange() {
        if (open && fixedDropdown) requestAnimationFrame(updateDropdownPosition);
    }

    onMount(() => {
        initViewModel();
        document.addEventListener("scroll", handleViewportChange, true);
    });

    onDestroy(() => {
        document.removeEventListener("scroll", handleViewportChange, true);
    });
</script>

<svelte:window onclick={handleClickOutside} onkeydowncapture={handleKeydown} onresize={handleViewportChange} />

<div class="na-date-picker" bind:this={containerEl}>
    <div
        class="na-date-picker__control"
        class:na-date-picker__control--open={open}
        class:na-date-picker__control--invalid={!!inputError}
        class:na-date-picker__control--disabled={disabled}
    >
        <input
            bind:this={inputEl}
            class="na-date-picker__input"
            type="text"
            value={inputText}
            placeholder={placeholder || i18n?.dpNaturalDatePlaceholder || "Date or natural language"}
            {disabled}
            aria-invalid={inputError ? "true" : "false"}
            oninput={handleTextInput}
            onfocus={() => (inputFocused = true)}
            onblur={handleInputBlur}
            onkeydown={handleInputKeydown}
        />
        <button
            type="button"
            class="na-date-picker__calendar-button b3-tooltips b3-tooltips__n"
            onmousedown={(event) => event.preventDefault()}
            onclick={() => {
                commitNaturalInput();
                toggleOpen();
            }}
            aria-expanded={open}
            aria-controls="na-date-picker-calendar"
            aria-haspopup="grid"
            aria-label={i18n?.dpOpenCalendar || "Open calendar"}
            {disabled}
        >
            <NaIcon symbol={value && value.includes("T") ? "iconClock" : "iconCalendar"} size={14} />
        </button>
    </div>
    {#if inputError}<div class="na-date-picker__error" role="alert">{inputError}</div>{/if}

    {#if open}
        <div
            use:portal={fixedDropdown}
            bind:this={dropdownEl}
            class="na-date-picker__dropdown"
            class:na-date-picker__dropdown--fixed={fixedDropdown}
            style={fixedDropdown ? dropdownStyle : ""}
            id="na-date-picker-calendar"
            role="application"
            tabindex="-1"
            aria-label={i18n?.dueDate || "Calendar"}
        >
            <!-- Calendar -->
            <div class="na-date-picker__header">
                <button
                    type="button"
                    class="na-date-picker__nav na-date-picker__nav--previous b3-tooltips b3-tooltips__n"
                    onclick={prevMonth}
                    aria-label={previousMonthLabel}
                >
                    <NaIcon symbol="iconRight" size={12} />
                </button>
                <span class="na-date-picker__month-year"
                    >{i18n?.dpYearMonth
                        ? i18n.dpYearMonth.replace("{y}", String(viewYear)).replace("{m}", String(viewMonth + 1))
                        : `${viewYear}/${viewMonth + 1}`}</span
                >
                <button
                    type="button"
                    class="na-date-picker__nav b3-tooltips b3-tooltips__n"
                    onclick={nextMonth}
                    aria-label={nextMonthLabel}
                >
                    <NaIcon symbol="iconRight" size={12} />
                </button>
            </div>

            <div class="na-date-picker__weekdays">
                {#each weekdays as day}
                    <span class="na-date-picker__weekday">{day}</span>
                {/each}
            </div>

            <div class="na-date-picker__days">
                {#each calendarDays as cell}
                    <button
                        type="button"
                        class="na-date-picker__day"
                        class:na-date-picker__day--selected={cell.date === datePart}
                        class:na-date-picker__day--today={cell.date === today}
                        class:na-date-picker__day--outside={!cell.inMonth}
                        onclick={() => selectDay(cell.date)}
                        onmouseenter={() => (hoverDate = cell.date)}
                        onmouseleave={() => (hoverDate = "")}
                        {disabled}
                    >
                        {cell.day}
                    </button>
                {/each}
            </div>

            <!-- Time section: stacked below calendar, same width -->
            {#if timeMode || requireTime}
                <div class="na-date-picker__time-section">
                    <div class="na-date-picker__time-row">
                        <div class="na-date-picker__time-col">
                            <span class="na-date-picker__time-label">{hourLabel}</span>
                            <div class="na-date-picker__time-scroll" bind:this={hourListEl} onscroll={handleHourScroll}>
                                <div class="na-date-picker__time-pad"></div>
                                {#each HOURS as h}
                                    <button
                                        type="button"
                                        class="na-date-picker__time-item"
                                        class:na-date-picker__time-item--active={h === selectedHour}
                                        onclick={(event) => {
                                            event.stopPropagation();
                                            onHourClick(h);
                                        }}
                                    >
                                        {pad(h)}
                                    </button>
                                {/each}
                                <div class="na-date-picker__time-pad"></div>
                            </div>
                        </div>
                        <span class="na-date-picker__time-sep">:</span>
                        <div class="na-date-picker__time-col">
                            <span class="na-date-picker__time-label">{minuteLabel}</span>
                            <div
                                class="na-date-picker__time-scroll"
                                bind:this={minuteListEl}
                                onscroll={handleMinuteScroll}
                            >
                                <div class="na-date-picker__time-pad"></div>
                                {#each MINUTES as m}
                                    <button
                                        type="button"
                                        class="na-date-picker__time-item"
                                        class:na-date-picker__time-item--active={m === selectedMinute}
                                        onclick={(event) => {
                                            event.stopPropagation();
                                            onMinuteClick(m);
                                        }}
                                    >
                                        {pad(m)}
                                    </button>
                                {/each}
                                <div class="na-date-picker__time-pad"></div>
                            </div>
                        </div>
                    </div>
                </div>
            {/if}

            <!-- Footer -->
            <div class="na-date-picker__footer">
                <button
                    type="button"
                    class="na-date-picker__time-toggle"
                    onclick={toggleTimeMode}
                    disabled={requireTime}
                >
                    <NaIcon symbol="iconClock" size={11} />
                    <span>{timeMode ? dateOnlyLabel : setTimeLabel}</span>
                </button>
                <div class="na-date-picker__footer-actions">
                    <button type="button" class="na-date-picker__action" onclick={selectToday}>{todayLabel}</button>
                    {#if timeMode || requireTime}
                        <button
                            type="button"
                            class="na-date-picker__action na-date-picker__action--primary"
                            onclick={confirmDateTime}>{okLabel}</button
                        >
                    {/if}
                    <button
                        type="button"
                        class="na-date-picker__action na-date-picker__action--danger"
                        onclick={clearValue}>{clearLabel}</button
                    >
                </div>
            </div>
        </div>
    {/if}
</div>

<style lang="scss">
    .na-date-picker {
        position: relative;
        width: 100%;
    }

    /* ── Input trigger ── */
    .na-date-picker__control {
        display: flex;
        align-items: center;
        height: var(--na-control-height);
        background: var(--b3-theme-background);
        border: 1px solid var(--na-color-divider);
        border-radius: var(--na-radius-md);
        overflow: hidden;
        transition: border-color 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .na-date-picker__control:hover {
        border-color: var(--b3-theme-primary-light);
    }
    .na-date-picker__control:focus-within,
    .na-date-picker__control--open {
        border-color: var(--b3-theme-primary);
    }
    .na-date-picker__control:focus-within {
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--b3-theme-primary) 28%, transparent);
    }
    .na-date-picker__control--invalid {
        border-color: var(--b3-theme-error);
    }
    .na-date-picker__control--disabled {
        opacity: 0.35;
        cursor: not-allowed;
    }

    .na-date-picker__input {
        flex: 1;
        min-width: 0;
        height: 100%;
        padding: 0 0 0 var(--na-space-md);
        border: 0;
        outline: 0;
        color: var(--b3-theme-on-background);
        background: transparent;
        font: inherit;
        font-size: var(--na-font-size-md);
    }
    .na-date-picker__input::placeholder {
        color: var(--na-text-secondary);
    }
    .na-date-picker__control .na-date-picker__input:focus-visible,
    .na-date-picker__control .na-date-picker__calendar-button:focus-visible {
        outline: none;
    }
    .na-date-picker__calendar-button {
        display: grid;
        place-items: center;
        align-self: stretch;
        flex: 0 0 calc(var(--na-control-height) - 2px);
        padding: 0;
        border: 0;
        color: var(--na-text-secondary);
        background: transparent;
        cursor: pointer;
    }
    .na-date-picker__calendar-button:hover {
        color: var(--na-text-interactive);
    }
    .na-date-picker__calendar-button:disabled {
        cursor: not-allowed;
    }
    .na-date-picker__error {
        margin-top: 4px;
        color: var(--na-text-danger);
        font-size: var(--na-font-size-xs);
        line-height: 1.4;
    }

    /* ── Dropdown ── */
    .na-date-picker__dropdown {
        position: absolute;
        z-index: 20;
        left: 0;
        width: 228px;
        background: var(--b3-theme-surface);
        border: 1px solid var(--na-color-divider);
        border-radius: var(--na-radius-lg);
        box-shadow: var(--na-shadow-dialog);
        margin-top: 4px;
        padding: var(--na-space-sm);
        animation: na-dp-fade 0.15s ease-out;
    }

    .na-date-picker__dropdown--fixed {
        position: fixed;
        margin-top: 0;
    }

    @keyframes na-dp-fade {
        from {
            opacity: 0;
            transform: translateY(-4px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    /* ── Calendar header ── */
    .na-date-picker__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 2px 0 var(--na-space-xs);
    }

    .na-date-picker__nav {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        padding: 0;
        border: none;
        background: none;
        color: var(--na-text-secondary);
        cursor: pointer;
        border-radius: var(--na-radius-sm);
        transition:
            background 0.15s,
            color 0.15s;
    }
    .na-date-picker__nav:hover {
        background: var(--b3-theme-surface-light);
        color: var(--b3-theme-on-background);
    }
    .na-date-picker__nav--previous :global(.na-icon) {
        transform: rotate(180deg);
    }

    .na-date-picker__month-year {
        font-size: var(--na-font-size-md);
        font-weight: 500;
        color: var(--b3-theme-on-background);
    }

    /* ── Weekdays ── */
    .na-date-picker__weekdays {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        margin-bottom: 2px;
    }
    .na-date-picker__weekday {
        text-align: center;
        font-size: var(--na-font-size-xs);
        color: var(--na-text-secondary);
        padding: 2px 0;
        font-weight: 500;
    }

    /* ── Day grid ── */
    .na-date-picker__days {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 1px;
    }
    .na-date-picker__day {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 26px;
        margin: 0 auto;
        padding: 0;
        border: none;
        background: none;
        color: var(--b3-theme-on-background);
        font-size: var(--na-font-size-sm);
        cursor: pointer;
        border-radius: var(--na-radius-sm);
        transition:
            background 0.1s,
            color 0.1s;
        position: relative;
    }
    .na-date-picker__day:hover {
        background: var(--b3-theme-surface-light);
    }
    .na-date-picker__day--outside {
        color: var(--na-text-secondary);
    }
    .na-date-picker__day--today {
        font-weight: 600;
    }
    .na-date-picker__day--today::after {
        content: "";
        position: absolute;
        bottom: 2px;
        left: 50%;
        transform: translateX(-50%);
        width: 4px;
        height: 2px;
        border-radius: 1px;
        background: var(--b3-theme-primary);
    }
    .na-date-picker__day--selected {
        background: var(--na-accent-surface);
        color: var(--na-text-interactive);
        font-weight: 600;
        box-shadow: inset 0 0 0 1px var(--b3-theme-primary);
    }
    .na-date-picker__day--selected.na-date-picker__day--today::after {
        background: var(--na-text-interactive);
    }
    .na-date-picker__day--selected:hover {
        background: var(--na-accent-surface-hover);
        color: var(--na-text-interactive);
    }
    .na-date-picker__day--outside.na-date-picker__day--selected {
        opacity: 1;
        color: var(--na-text-interactive);
    }

    /* ── Time section: below calendar, same width, Ant Design style ── */
    .na-date-picker__time-section {
        margin-top: var(--na-space-xs);
        padding-top: var(--na-space-xs);
        border-top: 1px solid var(--na-color-divider);
    }

    .na-date-picker__time-row {
        display: flex;
        align-items: flex-start;
        justify-content: center;
        gap: 4px;
    }

    .na-date-picker__time-col {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
    }

    .na-date-picker__time-label {
        font-size: 10px;
        color: var(--na-text-secondary);
        font-weight: 500;
        margin-bottom: 2px;
    }

    .na-date-picker__time-scroll {
        width: 100%;
        height: calc(3 * 22px); /* 66px — 3 visible items */
        overflow-y: auto;
        overscroll-behavior-y: contain;
        will-change: scroll-position;
        border: 1px solid var(--na-color-divider);
        border-radius: var(--na-radius-md);
        background: var(--b3-theme-background);

        &::-webkit-scrollbar {
            width: 0;
            display: none;
        }
    }

    .na-date-picker__time-pad {
        height: 22px;
        flex-shrink: 0;
    }

    .na-date-picker__time-item {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 22px;
        width: 100%;
        padding: 0;
        border: none;
        background: none;
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-sm);
        font-variant-numeric: tabular-nums;
        cursor: pointer;
        border-radius: 2px;

        &:hover {
            background: var(--b3-theme-surface-light);
        }
    }

    .na-date-picker__time-item--active {
        color: var(--na-text-interactive);
        font-weight: 600;
        background: var(--b3-theme-primary-lightest);
    }

    .na-date-picker__time-sep {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 14px;
        font-size: var(--na-font-size-md);
        font-weight: 600;
        color: var(--b3-theme-on-background);
        padding-top: 14px; /* offset for label */
        flex-shrink: 0;
    }

    /* ── Footer ── */
    .na-date-picker__footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-top: var(--na-space-xs);
        margin-top: var(--na-space-xs);
        border-top: 1px solid var(--na-color-divider);
    }

    .na-date-picker__time-toggle {
        display: flex;
        align-items: center;
        gap: 3px;
        padding: 3px 6px;
        border: none;
        background: none;
        color: var(--na-text-interactive);
        font-size: var(--na-font-size-xs);
        cursor: pointer;
        border-radius: var(--na-radius-sm);
        transition: background 0.15s;

        &:hover {
            background: var(--b3-theme-primary-lightest);
        }
    }

    .na-date-picker__footer-actions {
        display: flex;
        align-items: center;
        gap: 2px;
    }

    .na-date-picker__action {
        padding: 3px 8px;
        border: none;
        background: none;
        color: var(--na-text-interactive);
        font-size: var(--na-font-size-sm);
        font-weight: 500;
        cursor: pointer;
        border-radius: var(--na-radius-sm);
        transition: background 0.15s;
    }
    .na-date-picker__action:hover {
        background: var(--b3-theme-primary-lightest);
    }

    .na-date-picker__action--primary {
        background: var(--na-accent-surface);
        color: var(--na-text-interactive);
        border: 1px solid var(--b3-theme-primary);
        border-radius: var(--na-radius-md);
        padding: 3px 10px;
    }
    .na-date-picker__action--primary:hover {
        background: var(--na-accent-surface-hover);
        color: var(--na-text-interactive);
    }

    .na-date-picker__action--danger {
        color: var(--na-text-danger);
    }
    .na-date-picker__action--danger:hover {
        background: color-mix(in srgb, var(--b3-theme-error) 8%, var(--b3-theme-surface));
    }

    /* Mobile pickers behave as a bottom sheet when rendered through the
       fixed portal. Keeping this here makes the control usable from task
       detail, create-task and custom-field forms without duplicating logic. */
    @media (max-width: 600px) {
        .na-date-picker__dropdown--fixed {
            left: 0 !important;
            top: auto !important;
            bottom: 0 !important;
            width: 100% !important;
            max-height: min(86dvh, 620px) !important;
            overflow-y: auto;
            padding: 18px 16px calc(16px + env(safe-area-inset-bottom));
            border: 0;
            border-top: 1px solid var(--na-color-divider);
            border-radius: 16px 16px 0 0;
            box-shadow: 0 -8px 28px color-mix(in srgb, #000 18%, transparent);
            background: var(--b3-theme-surface);
        }
        .na-date-picker__dropdown--fixed::before {
            content: "";
            display: block;
            width: 36px;
            height: 4px;
            margin: -9px auto 12px;
            border-radius: 999px;
            background: var(--na-color-divider);
        }
        .na-date-picker__day,
        .na-date-picker__action,
        .na-date-picker__nav {
            min-height: 40px;
        }
    }
</style>
