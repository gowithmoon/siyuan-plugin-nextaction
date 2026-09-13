<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { portal } from "../utils/portal";
    import { getCurrentUiZIndex } from "../utils/layer";
    import NaIcon from "./NaIcon.svelte";

    export let placeholder = "";
    export let multi = false;
    export let selected: string | string[] = multi ? [] : "";
    export let selectedLabel: string = "";
    export let searchFn: (query: string) => Promise<{ id: string; label: string }[]> = () => Promise.resolve([]);
    export let allOptions: string[] = [];
    export let allowCreate: boolean = false;
    export let initialLabels: Record<string, string> = {};
    export let emptyText: string = "No options";
    export let noMatchText: string = "No matches";
    export let loadingText: string = "Loading...";
    export let clearLabel: string = "Clear selection";
    export let removeLabel: string = "Remove selection";
    export let fixedDropdown: boolean = false;
    export let disabled: boolean = false;

    export let onChange: (selected: string | string[]) => void = () => {};

    let input = "";
    let results: { id: string; label: string }[] = [];
    let dropdownOpen = false;
    let searching = false;
    let searchTimer: ReturnType<typeof setTimeout> | null = null;
    let containerEl: HTMLElement;
    let dropdownEl: HTMLElement;
    let inputEl: HTMLInputElement | undefined;
    let dropdownStyle = `position:fixed;z-index:${getCurrentUiZIndex()};visibility:hidden;`;
    let _prevInitialLabels: Record<string, string> = initialLabels;
    let labelMap: Map<string, string> = new Map(Object.entries(initialLabels));
    $: if (initialLabels !== _prevInitialLabels) {
        _prevInitialLabels = initialLabels;
        const merged = new Map(labelMap);
        for (const [k, v] of Object.entries(initialLabels)) {
            merged.set(k, v);
        }
        labelMap = merged;
    }
    let isClicking = false;
    let previousDisabled = disabled;

    $: if (disabled !== previousDisabled) {
        previousDisabled = disabled;
        if (disabled) {
            dropdownOpen = false;
            isClicking = false;
            if (searchTimer) {
                clearTimeout(searchTimer);
                searchTimer = null;
            }
        }
    }

    $: selectedArray = Array.isArray(selected) ? (selected as string[]) : selected ? [selected] : [];
    $: availableOptions = allOptions.filter((o) => !selectedArray.includes(o));
    $: filteredOptions = input.trim()
        ? availableOptions.filter((o) => o.toLowerCase().includes(input.trim().toLowerCase())).slice(0, 8)
        : availableOptions.slice(0, 8);
    $: filteredResults = results.filter((r) => !selectedArray.includes(r.id));
    $: hasDropdownContent = filteredResults.length > 0 || filteredOptions.length > 0;

    function updateDropdownPosition() {
        if (!fixedDropdown || !dropdownOpen || !containerEl || typeof window === "undefined") return;

        const rect = containerEl.getBoundingClientRect();
        const viewportGap = 8;
        const dropdownGap = 4;
        const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - viewportGap - dropdownGap);
        const spaceAbove = Math.max(0, rect.top - viewportGap - dropdownGap);
        const openAbove = spaceBelow < 200 && spaceAbove > spaceBelow;
        const availableHeight = openAbove ? spaceAbove : spaceBelow;
        const maxHeight = Math.max(0, Math.min(200, availableHeight));
        const width = Math.min(rect.width, window.innerWidth - viewportGap * 2);
        const left = Math.max(viewportGap, Math.min(rect.left, window.innerWidth - width - viewportGap));
        const verticalPosition = openAbove
            ? `bottom:${Math.max(viewportGap, window.innerHeight - rect.top + dropdownGap)}px;`
            : `top:${Math.max(viewportGap, rect.bottom + dropdownGap)}px;`;

        dropdownStyle = `position:fixed;z-index:${getCurrentUiZIndex()};visibility:visible;left:${left}px;${verticalPosition}width:${width}px;max-height:${maxHeight}px;`;
    }

    function scheduleDropdownPosition() {
        if (!fixedDropdown || typeof requestAnimationFrame === "undefined") return;
        requestAnimationFrame(updateDropdownPosition);
    }

    function openDropdown() {
        if (disabled) return;
        if (hasDropdownContent) {
            // Cached results available — open immediately, no flicker
            dropdownOpen = true;
            scheduleDropdownPosition();
        }
        // Always refresh; doSearch will open dropdown when results arrive
        doSearch();
    }

    function handleBoxMousedown() {
        if (disabled) return;
        isClicking = true;
    }

    function handleBoxClick() {
        if (disabled) return;
        if (dropdownOpen) {
            dropdownOpen = false;
        } else {
            openDropdown();
        }
        if (inputEl) {
            inputEl.focus();
        }
        setTimeout(() => {
            isClicking = false;
        }, 0);
    }

    function clearAndReopen() {
        if (disabled) return;
        selected = "";
        selectedLabel = "";
        results = [];
        input = "";
        onChange(selected);
        // Focus input after Svelte updates the DOM (input becomes visible)
        setTimeout(() => {
            if (inputEl) inputEl.focus();
            openDropdown();
        }, 0);
    }

    async function doSearch() {
        if (disabled) return;
        searching = true;
        try {
            if (searchFn) {
                results = await searchFn(input.trim() || "");
                for (const r of results) {
                    labelMap.set(r.id, r.label);
                }
            } else {
                results = [];
            }
            // Open (or keep open) now that we have results
            if (disabled) {
                dropdownOpen = false;
            } else if (hasDropdownContent || allowCreate) {
                dropdownOpen = true;
                scheduleDropdownPosition();
            } else if (allOptions.length === 0) {
                // No searchFn and no allOptions — still show dropdown with "No options"
                dropdownOpen = true;
                scheduleDropdownPosition();
            } else {
                dropdownOpen = false;
            }
        } catch (e) {
            results = [];
            dropdownOpen = false;
        } finally {
            searching = false;
        }
    }

    function onInputChange(event: Event) {
        if (disabled) return;
        input = (event.currentTarget as HTMLInputElement).value;
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(doSearch, 200);
    }

    function selectItem(item: { id: string; label: string }) {
        if (disabled) return;
        if (multi) {
            const arr = [...selectedArray];
            if (!arr.includes(item.id)) {
                arr.push(item.id);
                selected = arr;
            }
        } else {
            selected = item.id;
            selectedLabel = item.label;
        }
        input = "";
        dropdownOpen = false;
        results = [];
        onChange(selected);
    }

    function selectOption(option: string) {
        selectItem({ id: option, label: option });
    }

    function removeItem(id: string) {
        if (disabled) return;
        if (multi) {
            selected = selectedArray.filter((x) => x !== id);
        } else {
            selected = "";
            selectedLabel = "";
        }
        onChange(selected);
    }

    function onKeydown(e: KeyboardEvent) {
        if (disabled) return;
        if (e.key === "Enter") {
            e.preventDefault();
            if (filteredResults.length > 0) {
                selectItem(filteredResults[0]);
            } else if (allowCreate && input.trim() && multi && !selectedArray.includes(input.trim())) {
                selectItem({ id: input.trim(), label: input.trim() });
            }
        } else if (e.key === "Backspace" && !input && multi && selectedArray.length > 0) {
            removeItem(selectedArray[selectedArray.length - 1]);
        } else if (e.key === "Escape") {
            if (dropdownOpen) {
                dropdownOpen = false;
                e.preventDefault();
                e.stopPropagation();
            }
        }
    }

    function closeDropdown(e: MouseEvent) {
        if (containerEl && !containerEl.contains(e.target as Node)) {
            dropdownOpen = false;
        }
    }

    function handleViewportChange() {
        if (dropdownOpen) scheduleDropdownPosition();
    }

    onMount(() => {
        document.addEventListener("scroll", handleViewportChange, true);
    });

    onDestroy(() => {
        if (searchTimer) clearTimeout(searchTimer);
        document.removeEventListener("scroll", handleViewportChange, true);
    });
</script>

<svelte:window onclick={closeDropdown} onresize={handleViewportChange} />

<div class="na-search-select" bind:this={containerEl}>
    <div
        class="na-search-select__box"
        class:na-search-select__box--multi={multi}
        class:na-search-select__box--disabled={disabled}
        role="combobox"
        aria-controls="na-search-select-options"
        aria-expanded={dropdownOpen}
        aria-disabled={disabled}
        tabindex={disabled ? -1 : 0}
        onmousedown={handleBoxMousedown}
        onclick={handleBoxClick}
        onkeydown={(event) => {
            if (event.key === "Enter" || event.key === " ") handleBoxClick();
        }}
    >
        {#if !multi && selected}
            <span class="na-search-select__selected">{selectedLabel || String(selected)}</span>
            <button
                type="button"
                class="na-search-select__clear b3-tooltips b3-tooltips__n"
                onclick={(event) => {
                    event.stopPropagation();
                    clearAndReopen();
                }}
                aria-label={clearLabel}
                {disabled}
            >
                <NaIcon symbol="iconCloseRound" size={10} />
            </button>
        {:else}
            <span class="na-search-select__content" class:na-search-select__content--multi={multi}>
                {#if multi && selectedArray.length > 0}
                    {#each selectedArray as item}
                        <span class="na-search-select__chip">
                            {labelMap.get(item) || item}
                            <button
                                type="button"
                                class="na-search-select__chip-remove b3-tooltips b3-tooltips__n"
                                onclick={(event) => {
                                    event.stopPropagation();
                                    removeItem(item);
                                }}
                                aria-label={`${removeLabel}: ${labelMap.get(item) || item}`}
                                {disabled}
                            >
                                <NaIcon symbol="iconCloseRound" size={8} />
                            </button>
                        </span>
                    {/each}
                {/if}
                <input
                    type="text"
                    {disabled}
                    bind:this={inputEl}
                    value={input}
                    oninput={onInputChange}
                    onkeydown={onKeydown}
                    onfocus={() => {
                        if (isClicking) return;
                        if (!dropdownOpen) {
                            openDropdown();
                        }
                    }}
                    placeholder={selectedArray.length ? "" : placeholder}
                    class="na-search-select__input"
                />
            </span>
        {/if}
    </div>
    {#if dropdownOpen}
        <div
            use:portal={fixedDropdown}
            bind:this={dropdownEl}
            class="na-search-select__dropdown"
            class:na-search-select__dropdown--fixed={fixedDropdown}
            style={fixedDropdown ? dropdownStyle : ""}
            id="na-search-select-options"
            role="listbox"
            tabindex="-1"
            onclick={(event) => event.stopPropagation()}
            onkeydown={(event) => event.stopPropagation()}
        >
            {#each filteredResults as item}
                <button type="button" class="na-search-select__option" onclick={() => selectItem(item)}>
                    {item.label}
                </button>
            {/each}
            {#each filteredOptions as option}
                <button type="button" class="na-search-select__option" onclick={() => selectOption(option)}>
                    {option}
                </button>
            {/each}
            {#if allowCreate && multi && input.trim() && !selectedArray.includes(input.trim()) && !filteredOptions.includes(input.trim()) && filteredResults.length === 0}
                <button
                    type="button"
                    class="na-search-select__option na-search-select__option--create"
                    onclick={() => selectItem({ id: input.trim(), label: input.trim() })}
                >
                    + {input.trim()}
                </button>
            {/if}
            {#if filteredResults.length === 0 && filteredOptions.length === 0}
                <div class="na-search-select__empty">
                    {#if searching}
                        {loadingText}
                    {:else if input.trim()}
                        {noMatchText}
                    {:else}
                        {emptyText}
                    {/if}
                </div>
            {/if}
        </div>
    {/if}
</div>

<style lang="scss">
    .na-search-select {
        position: relative;
        width: 100%;
    }

    .na-search-select__box {
        display: flex;
        align-items: center;
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
        background: var(--b3-theme-background);
        border: 1px solid var(--na-color-divider);
        border-radius: 8px;
        height: 30px;
        padding: 0 8px;
        transition: border-color 0.15s;
        cursor: pointer;

        &:focus-within {
            border-color: var(--b3-theme-primary);
        }
    }

    .na-search-select__box--multi {
        height: auto;
        min-height: 30px;
    }

    .na-search-select__box--disabled {
        cursor: not-allowed;
        opacity: 0.48;
    }

    .na-search-select__selected {
        flex: 1;
        font-size: 12px;
        color: var(--b3-theme-on-background);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .na-search-select__clear {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        padding: 0;
        border: none;
        background: none;
        color: var(--na-text-secondary);
        cursor: pointer;
        border-radius: 50%;
        flex-shrink: 0;
        transition:
            color 0.15s,
            background 0.15s;

        &:hover {
            color: var(--b3-theme-on-background);
            background: var(--b3-theme-surface-light);
        }
    }

    .na-search-select__content {
        display: flex;
        align-items: center;
        flex: 1 1 auto;
        min-width: 0;
        height: 100%;
    }

    .na-search-select__content--multi {
        flex-wrap: wrap;
        gap: 3px;
        height: auto;
        padding: 3px 0;
        overflow: hidden;
    }

    .na-search-select__chip {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        padding: 1px 6px;
        background: var(--b3-theme-surface-light);
        border-radius: 4px;
        font-size: 12px;
        color: var(--b3-theme-on-background);
        white-space: nowrap;
        max-width: 120px;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .na-search-select__chip-remove {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 12px;
        height: 12px;
        padding: 0;
        border: none;
        background: none;
        color: var(--na-text-secondary);
        cursor: pointer;
        border-radius: 50%;
        flex-shrink: 0;

        &:hover {
            color: var(--b3-theme-on-background);
        }
    }

    .na-search-select__input {
        border: none !important;
        background: none !important;
        outline: none !important;
        padding: 0 !important;
        margin: 0 !important;
        font-size: 12px !important;
        color: var(--b3-theme-on-background);
        flex: 1;
        min-width: 40px;
        height: 100%;
        cursor: text;

        &::placeholder {
            color: var(--na-text-secondary);
        }
    }

    .na-search-select__content--multi .na-search-select__input {
        flex: 1 1 80px;
        height: 22px;
    }

    .na-search-select__dropdown {
        position: absolute;
        z-index: 10;
        left: 0;
        right: 0;
        background: var(--b3-theme-surface);
        border: 1px solid var(--na-color-divider);
        border-radius: 8px;
        max-height: 200px;
        overflow-y: auto;
        overflow-x: hidden;
        box-shadow: var(--b3-dialog-shadow);
        margin-top: 4px;
        padding: 4px;
        box-sizing: border-box;
    }

    .na-search-select__dropdown--fixed {
        position: fixed;
        right: auto;
        margin-top: 0;
        z-index: 10;
    }

    .na-search-select__option {
        display: block;
        width: 100%;
        min-height: 30px;
        box-sizing: border-box;
        margin: 0;
        padding: 6px 8px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        font: inherit;
        font-size: 12px;
        line-height: 1.4;
        text-align: left;
        white-space: normal;
        overflow-wrap: anywhere;
        color: var(--b3-theme-on-background);
        cursor: pointer;
        transition:
            background-color 0.1s,
            color 0.1s;

        &:hover,
        &:focus-visible {
            outline: 0;
            background: var(--b3-list-hover);
        }
    }

    .na-search-select__option--create {
        color: var(--na-text-interactive);
        font-weight: 500;
    }

    .na-search-select__empty {
        padding: 8px 12px;
        font-size: 11px;
        color: var(--na-text-secondary);
        text-align: center;
    }

    @media (max-width: 600px) {
        .na-search-select__dropdown--fixed {
            left: 0 !important;
            top: auto !important;
            bottom: 0 !important;
            width: 100% !important;
            max-height: min(72dvh, 520px) !important;
            padding: 18px 12px calc(12px + env(safe-area-inset-bottom));
            border: 0;
            border-top: 1px solid var(--na-color-divider);
            border-radius: 16px 16px 0 0;
            box-shadow: 0 -8px 28px color-mix(in srgb, #000 18%, transparent);
            background: var(--b3-theme-surface);
        }
        .na-search-select__dropdown--fixed::before {
            content: "";
            display: block;
            width: 36px;
            height: 4px;
            margin: -9px auto 12px;
            border-radius: 999px;
            background: var(--na-color-divider);
        }
        .na-search-select__option {
            min-height: 48px;
            padding: 10px 12px;
            font-size: 14px;
        }
    }
</style>
