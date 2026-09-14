<script lang="ts">
    import NaPageHost from "./NaPageHost.svelte";
    import { useWorkspace } from "../workspace-context";
    import { DEFAULT_FILTER_STATE } from "../utils/filter";
    import { onDestroy } from "svelte";
    import NaButton from "./NaButton.svelte";
    import NaChip from "./NaChip.svelte";
    import NaFilterDropdown from "./NaFilterDropdown.svelte";
    import NaSearchInput from "./NaSearchInput.svelte";
    import NaSortSelect from "./NaSortSelect.svelte";
    import { PRIORITY_LIST, STATUS_LIST, PRIORITY_COLORS } from "../constants";
    import { toI18nKey } from "../utils";
    import type { CustomFieldDef } from "../../shared/custom-fields";
    import type { FilterState, CustomFieldFilter } from "../utils/filter";

    export let expanded = false;
    const workspace = useWorkspace();
    let filterOpen = false;
    let draft: FilterState;
    $: compact = !!workspace?.compact && !expanded;
    $: count =
        filterState.contexts.length +
        filterState.tags.length +
        filterState.priorities.length +
        filterState.statuses.length +
        (filterState.customFieldFilters?.length || 0);
    export let contexts: string[] = [];
    export let tags: string[] = [];
    export let customFields: CustomFieldDef[] = [];
    export let filterState: FilterState;
    export let showStatus = false;
    export let showPriority = true;
    export let statusValues: readonly string[] = STATUS_LIST;
    export let sortOptions: { value: string; label: string }[] | undefined = undefined;
    export let searchPlaceholder = "";
    export let showSearch = true;
    export let i18n: any;
    export let showClear = false;
    export let clearLabel = "";
    export let onClear: (() => void) | undefined = undefined;

    export let onChange: (filterState: FilterState) => void = () => {};
    let searchText = filterState.searchText;
    $: if (!debounceTimer) searchText = filterState.searchText;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let customFieldKey = "";
    let customFieldOperator: CustomFieldFilter["operator"] = "contains";
    let customFieldValue = "";

    $: contextOptions = contexts.map((value) => ({ value, label: value }));
    $: tagOptions = tags.map((value) => ({ value, label: value }));
    $: priorityOptions = PRIORITY_LIST.map((value) => ({
        value,
        label: i18n?.[toI18nKey("priority", value)] || value,
        color: PRIORITY_COLORS[value],
    }));
    $: statusOptions = statusValues.map((value) => ({ value, label: i18n?.[toI18nKey("status", value)] || value }));
    $: activeFields = customFields.filter((field) => field.status === "active");
    $: computedSortOptions = sortOptions || [
        { value: "order", label: i18n?.sortByOrder || "Priority score" },
        { value: "due", label: i18n?.sortByDue || "Due date" },
        { value: "importance", label: i18n?.sortByImportance || "Importance" },
        { value: "priority", label: i18n?.sortByPriority || "Manual priority" },
        ...activeFields.map((field) => ({ value: `custom:${field.key}`, label: `${field.label} ↕` })),
    ];

    function change(next: FilterState) {
        onChange(next);
    }
    function onSearchInput(nextSearchText: string) {
        searchText = nextSearchText;
        if (expanded) {
            change({ ...filterState, searchText });
            return;
        }
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            change({ ...filterState, searchText });
        }, 300);
    }
    function addCustomFieldFilter() {
        if (!customFieldKey) return;
        const next = [
            ...(filterState.customFieldFilters || []),
            {
                key: customFieldKey,
                operator: customFieldOperator,
                ...(customFieldOperator === "empty" || customFieldOperator === "notEmpty"
                    ? {}
                    : { value: customFieldValue }),
            },
        ];
        change({ ...filterState, customFieldFilters: next });
        customFieldValue = "";
    }
    function removeCustomFieldFilter(index: number) {
        change({
            ...filterState,
            customFieldFilters: (filterState.customFieldFilters || []).filter((_, itemIndex) => itemIndex !== index),
        });
    }

    onDestroy(() => {
        if (debounceTimer) {
            clearTimeout(debounceTimer);
            onChange({ ...filterState, searchText });
        }
    });
</script>

<div class="na-task-filter-bar">
    {#if showSearch}<div class="na-task-filter-bar__search">
            <NaSearchInput
                value={searchText}
                compact
                placeholder={searchPlaceholder || i18n?.searchPlaceholder || "Search..."}
                ariaLabel={searchPlaceholder || i18n?.searchPlaceholder || "Search..."}
                onInput={onSearchInput}
            />
        </div>{/if}
    {#if compact}
        <NaButton
            size="sm"
            onclick={() => {
                if (debounceTimer) {
                    clearTimeout(debounceTimer);
                    debounceTimer = null;
                    change({ ...filterState, searchText });
                }
                draft = JSON.parse(JSON.stringify({ ...filterState, searchText }));
                filterOpen = true;
            }}>{i18n.filterAndSort}{count ? ` (${count})` : ""}</NaButton
        >
    {:else}
        <div class="na-task-filter-bar__filters">
            <div style="--na-filter-active-color: var(--na-filter-context)">
                <NaFilterDropdown
                    label={i18n?.context || "Context"}
                    options={contextOptions}
                    selected={filterState.contexts}
                    {i18n}
                    onChange={(selected) => change({ ...filterState, contexts: selected })}
                />
            </div>
            <div style="--na-filter-active-color: var(--na-filter-tag)">
                <NaFilterDropdown
                    label={i18n?.tag || "Tag"}
                    options={tagOptions}
                    selected={filterState.tags}
                    {i18n}
                    onChange={(selected) => change({ ...filterState, tags: selected })}
                />
            </div>
            {#if showPriority}<div style="--na-filter-active-color: var(--na-filter-priority)">
                    <NaFilterDropdown
                        label={i18n?.priority || "Priority"}
                        options={priorityOptions}
                        selected={filterState.priorities}
                        {i18n}
                        onChange={(selected) => change({ ...filterState, priorities: selected })}
                    />
                </div>{/if}
            {#if showStatus}<div style="--na-filter-active-color: var(--na-filter-status)">
                    <NaFilterDropdown
                        label={i18n?.status || "Status"}
                        options={statusOptions}
                        selected={filterState.statuses}
                        {i18n}
                        onChange={(selected) => change({ ...filterState, statuses: selected })}
                    />
                </div>{/if}
            {#if activeFields.length > 0}
                <div class="na-task-filter-bar__custom">
                    <select
                        class="na-select na-select--sm"
                        bind:value={customFieldKey}
                        aria-label={i18n?.customFieldFilter || "Custom field"}
                        ><option value="">{i18n?.customFieldFilter || "Custom field"}</option
                        >{#each activeFields as field}<option value={field.key}>{field.label}</option>{/each}</select
                    >
                    <select
                        class="na-select na-select--sm"
                        bind:value={customFieldOperator}
                        aria-label={i18n?.customFieldOperator || "Operator"}
                        ><option value="contains">{i18n?.contains || "contains"}</option><option value="equals"
                            >{i18n?.equals || "equals"}</option
                        ><option value="notEmpty">{i18n?.notEmpty || "has value"}</option><option value="empty"
                            >{i18n?.empty || "is empty"}</option
                        ></select
                    >
                    {#if customFieldOperator !== "empty" && customFieldOperator !== "notEmpty"}<input
                            class="na-input"
                            value={customFieldValue}
                            oninput={(event) => (customFieldValue = event.currentTarget.value)}
                            placeholder={i18n?.customFieldFilterValue || "Value"}
                            onkeydown={(event) => event.key === "Enter" && addCustomFieldFilter()}
                        />{/if}
                    <NaButton size="sm" onclick={addCustomFieldFilter}>{i18n?.add || "+"}</NaButton>
                </div>
                {#each filterState.customFieldFilters || [] as filter, index}
                    <NaChip
                        label={`${activeFields.find((field) => field.key === filter.key)?.label || filter.key} ${filter.operator === "empty" ? "∅" : filter.operator === "notEmpty" ? "✓" : `= ${filter.value || ""}`}`}
                        onClose={() => removeCustomFieldFilter(index)}
                        {i18n}
                    />
                {/each}
            {/if}
            <NaSortSelect
                options={computedSortOptions}
                selected={filterState.sortBy}
                ascending={filterState.sortAsc}
                {i18n}
                onChange={(value, ascending) => change({ ...filterState, sortBy: value, sortAsc: ascending })}
            />
            {#if showClear && onClear}
                <NaButton size="sm" variant="text" onclick={onClear}
                    >{clearLabel || i18n?.clearFilters || "Clear filters"}</NaButton
                >
            {/if}
        </div>
    {/if}
</div>
{#if filterOpen}
    <NaPageHost title={i18n.filterAndSort} backLabel={i18n.cancel} mode="sheet" onBack={() => (filterOpen = false)}>
        {#snippet actions()}<NaButton
                variant="primary"
                onclick={() => {
                    onChange(draft);
                    filterOpen = false;
                }}>{i18n.apply}</NaButton
            >{/snippet}
        <div class="na-filter-page">
            <svelte:self
                {contexts}
                {tags}
                {customFields}
                filterState={draft}
                {showStatus}
                {showPriority}
                {statusValues}
                {sortOptions}
                {i18n}
                expanded
                showSearch={false}
                onChange={(value: FilterState) => (draft = value)}
            />
            <NaButton onclick={() => (draft = JSON.parse(JSON.stringify(DEFAULT_FILTER_STATE)))}
                >{i18n.clearFilters}</NaButton
            >
        </div>
    </NaPageHost>
{/if}

<style lang="scss">
    .na-filter-page {
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 14px;
        background: color-mix(in srgb, var(--b3-theme-background) 88%, var(--b3-theme-primary) 12%);
        min-height: 100%;
        box-sizing: border-box;
    }
    .na-filter-page::before {
        content: "";
        display: block;
        width: 34px;
        height: 4px;
        border-radius: 99px;
        background: var(--b3-border-color);
        margin: -6px auto 2px;
        opacity: 0.8;
    }
    .na-filter-page :global(.na-task-filter-bar__filters) {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        align-items: start;
        overflow: visible;
        width: 100%;
        max-width: 100%;
        gap: 12px;
        margin: 0;
        flex-basis: auto !important;
        flex-wrap: unset !important;
    }
    .na-filter-page :global(.na-task-filter-bar__filters > div) {
        min-width: 0;
        width: auto !important;
    }
    .na-filter-page :global(.na-filter-dropdown__trigger) {
        width: 100%;
        justify-content: space-between;
        min-height: 44px;
        padding-inline: 12px;
        border-radius: 10px;
        background: var(--b3-theme-surface);
        box-shadow: var(--na-shadow-sm);
    }
    .na-filter-page :global(.na-sort-select) {
        grid-column: 1 / -1;
        width: 100%;
        justify-content: stretch;
    }
    .na-filter-page :global(.na-sort-select__trigger) {
        flex: 1;
        min-height: 44px;
        border-radius: 10px 0 0 10px;
    }
    .na-filter-page :global(.na-sort-select__dir-btn) {
        height: 44px;
        width: 44px;
        border-radius: 0 10px 10px 0;
    }
    .na-filter-page :global(.na-task-filter-bar__custom) {
        grid-column: 1 / -1;
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        grid-template-rows: auto auto;
        width: 100%;
        padding: 10px;
        border: 1px solid var(--na-color-divider);
        border-radius: 12px;
        background: color-mix(in srgb, var(--b3-theme-surface) 84%, transparent);
        box-sizing: border-box;
        gap: 8px;
    }
    .na-filter-page :global(.na-task-filter-bar__custom > .na-select) {
        width: 100% !important;
        max-width: none;
        min-width: 0;
        height: 40px;
    }
    .na-filter-page :global(.na-task-filter-bar__custom > .na-input) {
        grid-column: 1 / -1;
        width: 100% !important;
        box-sizing: border-box;
        height: 40px;
    }
    .na-filter-page :global(.na-task-filter-bar__custom > .na-button) {
        grid-column: 1 / -1;
        width: 100% !important;
        min-height: 40px;
    }
    .na-filter-page :global(.na-task-filter-bar__filters > .na-chip) {
        grid-column: 1 / -1;
    }
    .na-filter-page :global(.na-task-filter-bar__custom .na-input) {
        width: auto;
        min-width: 0;
    }
    .na-filter-page :global(.na-task-filter-bar__custom .na-button) {
        min-height: 44px;
        border-radius: 10px;
    }
    .na-filter-page > :global(.na-button) {
        width: 100%;
        min-height: 44px;
        border-radius: 10px;
    }
    @media (max-width: 360px) {
        .na-filter-page {
            padding: 12px;
        }
    }
    .na-task-filter-bar {
        display: flex;
        align-items: center;
        gap: var(--na-space-sm);
        padding: var(--na-space-md) var(--na-space-lg);
        border-bottom: 1px solid var(--na-color-divider);
        background: var(--b3-theme-surface);
        flex-wrap: wrap;
    }
    .na-task-filter-bar__search {
        flex: 1 1 180px;
        min-width: 120px;
    }
    .na-task-filter-bar__search :global(.na-search-input) {
        width: 100%;
    }
    .na-task-filter-bar__filters {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: var(--na-space-sm);
        min-width: 0;
        margin-left: auto;
        flex-wrap: wrap;
    }
    .na-task-filter-bar__custom {
        display: inline-flex;
        align-items: center;
        gap: var(--na-space-xs);
    }
    .na-task-filter-bar__custom .na-select {
        width: auto;
        max-width: 130px;
    }
    .na-task-filter-bar__custom .na-input {
        width: 96px;
        height: var(--na-control-height-sm);
    }
    @container nextaction-app (max-width: 520px) {
        .na-task-filter-bar {
            padding-inline: var(--na-space-md);
        }
        .na-task-filter-bar__search,
        .na-task-filter-bar__filters {
            flex-basis: 100%;
            margin-left: 0;
            justify-content: flex-start;
        }
        .na-task-filter-bar__filters {
            flex-wrap: nowrap;
            overflow-x: auto;
            padding-bottom: 1px;
        }
    }
</style>
