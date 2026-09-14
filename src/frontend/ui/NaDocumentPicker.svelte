<script context="module" lang="ts">
    export interface DocumentSelection {
        id: string;
        title: string;
        notebookId: string;
        notebookName: string;
        path: string;
        icon: string;
    }
</script>

<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import type { KernelBridge } from "../kernel-bridge";
    import { portal } from "../utils/portal";
    import { getCurrentUiZIndex } from "../utils/layer";
    import NaIcon from "./NaIcon.svelte";
    import NaIconButton from "./NaIconButton.svelte";
    import NaSearchInput from "./NaSearchInput.svelte";

    type DocumentItem = {
        id: string;
        title: string;
        notebookId: string;
        notebookName?: string;
        path: string;
        icon: string;
        hasChildren: boolean;
    };

    export let bridge: KernelBridge;
    export let i18n: any;
    export let value: DocumentSelection | null = null;
    export let disabled = false;
    export let fixedDropdown = false;

    export let onChange: (selection: DocumentSelection | null) => void = () => {};
    let query = "";
    let results: DocumentItem[] = [];
    let loading = false;
    let searched = false;
    let error = "";
    let searchTimer: ReturnType<typeof setTimeout> | null = null;
    let searchVersion = 0;
    let containerEl: HTMLDivElement;
    let dropdownEl: HTMLDivElement;
    let resizeObserver: ResizeObserver | null = null;
    let dropdownStyle = `position:fixed;z-index:${getCurrentUiZIndex()};visibility:hidden;`;

    function updateDropdownPosition() {
        if (!fixedDropdown || !query.trim() || !containerEl || typeof window === "undefined") return;
        const rect = containerEl.getBoundingClientRect();
        const viewportGap = 8;
        const dropdownGap = 4;
        const desiredHeight = Math.min(dropdownEl?.scrollHeight || 190, 240);
        const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - viewportGap - dropdownGap);
        const spaceAbove = Math.max(0, rect.top - viewportGap - dropdownGap);
        const openAbove = spaceBelow < desiredHeight && spaceAbove > spaceBelow;
        const availableHeight = openAbove ? spaceAbove : spaceBelow;
        const maxHeight = Math.max(0, Math.min(240, availableHeight));
        const width = Math.min(rect.width, window.innerWidth - viewportGap * 2);
        const left = Math.max(viewportGap, Math.min(rect.left, window.innerWidth - width - viewportGap));
        const verticalPosition = openAbove
            ? `bottom:${Math.max(viewportGap, window.innerHeight - rect.top + dropdownGap)}px;`
            : `top:${Math.max(viewportGap, rect.bottom + dropdownGap)}px;`;
        dropdownStyle = `position:fixed;z-index:${getCurrentUiZIndex()};visibility:visible;left:${left}px;${verticalPosition}width:${width}px;max-height:${maxHeight}px;`;
    }

    function scheduleDropdownPosition() {
        if (fixedDropdown && typeof requestAnimationFrame !== "undefined")
            requestAnimationFrame(updateDropdownPosition);
    }

    function handleViewportChange() {
        if (query.trim()) scheduleDropdownPosition();
    }

    onMount(() => {
        document.addEventListener("scroll", handleViewportChange, true);
        if (typeof ResizeObserver !== "undefined") {
            resizeObserver = new ResizeObserver(handleViewportChange);
            resizeObserver.observe(containerEl);
        }
    });

    onDestroy(() => {
        if (searchTimer) clearTimeout(searchTimer);
        searchVersion++;
        document.removeEventListener("scroll", handleViewportChange, true);
        resizeObserver?.disconnect();
    });

    function scheduleSearch(nextQuery: string) {
        query = nextQuery;
        if (searchTimer) clearTimeout(searchTimer);
        const keyword = query.trim();
        const version = ++searchVersion;
        error = "";
        if (!keyword) {
            results = [];
            searched = false;
            loading = false;
            return;
        }
        loading = true;
        searched = false;
        scheduleDropdownPosition();
        searchTimer = setTimeout(async () => {
            try {
                const next = await bridge.searchMcpTargetDocuments(keyword);
                if (version !== searchVersion) return;
                results = next;
                searched = true;
            } catch (cause: any) {
                if (version !== searchVersion) return;
                results = [];
                searched = true;
                error = cause?.message || String(cause);
            } finally {
                if (version === searchVersion) {
                    loading = false;
                    scheduleDropdownPosition();
                }
            }
        }, 220);
    }

    async function choose(item: DocumentItem) {
        loading = true;
        error = "";
        try {
            const resolved = await bridge.resolveMcpDocumentTarget(item.id);
            value = {
                id: item.id,
                title: resolved.title || item.title || i18n?.untitled || "Untitled",
                notebookId: item.notebookId,
                notebookName: item.notebookName || "",
                path: resolved.path || item.path || "",
                icon: item.icon || "",
            };
            query = "";
            results = [];
            searched = false;
            onChange(value);
        } catch (cause: any) {
            value = null;
            error = cause?.message || String(cause);
        } finally {
            loading = false;
        }
    }

    function clearSelection() {
        value = null;
        query = "";
        results = [];
        searched = false;
        error = "";
        onChange(null);
    }
</script>

<svelte:window onresize={handleViewportChange} />

<div bind:this={containerEl} class="na-document-picker" class:na-document-picker--disabled={disabled}>
    {#if value}
        <div class="na-document-picker__selected">
            <span class="na-document-picker__icon"><NaIcon symbol="iconFile" size={14} /></span>
            <span class="na-document-picker__selected-copy">
                <strong>{value.title || i18n?.untitled || "Untitled"}</strong>
                <small>{[value.notebookName, value.path].filter(Boolean).join(" · ")}</small>
            </span>
            <NaIconButton
                symbol="iconClose"
                label={i18n?.clearSelection || "Clear selection"}
                compact
                {disabled}
                onclick={clearSelection}
            />
        </div>
    {/if}

    <NaSearchInput
        value={query}
        {disabled}
        placeholder={i18n?.createSearchDocuments || "Search documents"}
        ariaLabel={i18n?.createSearchDocuments || "Search documents"}
        onInput={scheduleSearch}
    />

    {#if query.trim()}
        <div
            use:portal={fixedDropdown}
            bind:this={dropdownEl}
            class="na-document-picker__results"
            class:na-document-picker__results--fixed={fixedDropdown}
            style={fixedDropdown ? dropdownStyle : ""}
            aria-busy={loading}
            aria-live="polite"
            role="listbox"
            tabindex="-1"
            onclick={(event) => event.stopPropagation()}
            onkeydown={(event) => event.stopPropagation()}
        >
            {#if loading}
                <div class="na-document-picker__state">{i18n?.loading || "Loading..."}</div>
            {:else if error}
                <div class="na-document-picker__state na-document-picker__state--error" role="alert">{error}</div>
            {:else if searched && results.length === 0}
                <div class="na-document-picker__state">{i18n?.createNoDocuments || "No documents found"}</div>
            {:else}
                {#each results as document (document.id)}
                    <button
                        type="button"
                        class="na-document-picker__result"
                        {disabled}
                        onclick={() => choose(document)}
                    >
                        <span class="na-document-picker__icon"><NaIcon symbol="iconFile" size={14} /></span>
                        <span>
                            <strong>{document.title || i18n?.untitled || "Untitled"}</strong>
                            <small>{[document.notebookName, document.path].filter(Boolean).join(" · ")}</small>
                        </span>
                    </button>
                {/each}
            {/if}
        </div>
    {/if}
</div>

<style lang="scss">
    .na-document-picker {
        display: grid;
        gap: 7px;
        min-width: 0;
    }
    .na-document-picker--disabled {
        opacity: 0.52;
    }
    .na-document-picker__selected {
        display: grid;
        grid-template-columns: 28px minmax(0, 1fr) 28px;
        align-items: center;
        gap: 7px;
        min-height: 38px;
        padding: 5px 7px;
        box-sizing: border-box;
        border: 1px solid var(--na-color-divider);
        border-radius: var(--na-radius-sm);
        background: var(--b3-theme-background);
    }
    .na-document-picker__selected-copy,
    .na-document-picker__result > span:last-child {
        min-width: 0;
    }
    .na-document-picker__selected strong,
    .na-document-picker__selected small,
    .na-document-picker__result strong,
    .na-document-picker__result small {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .na-document-picker__selected strong,
    .na-document-picker__result strong {
        color: var(--na-text-primary);
        font-size: var(--na-font-size-md);
        font-weight: 500;
    }
    .na-document-picker__selected small,
    .na-document-picker__result small {
        margin-top: 1px;
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-xs);
    }
    .na-document-picker__icon {
        display: grid;
        place-items: center;
        width: 26px;
        height: 26px;
        border-radius: var(--na-radius-sm);
        color: var(--na-text-secondary);
        background: var(--b3-theme-surface);
    }
    .na-document-picker__results {
        max-height: 190px;
        overflow-y: auto;
        border: 1px solid var(--na-color-divider);
        border-radius: var(--na-radius-sm);
        background: var(--b3-theme-background);
    }
    .na-document-picker__results--fixed {
        box-sizing: border-box;
        box-shadow: var(--na-shadow-md);
    }
    .na-document-picker__result {
        display: grid;
        grid-template-columns: 28px minmax(0, 1fr);
        align-items: center;
        gap: 7px;
        width: 100%;
        min-width: 0;
        min-height: 40px;
        padding: 6px 8px;
        border: 0;
        border-bottom: 1px solid var(--na-color-divider);
        color: inherit;
        background: transparent;
        text-align: left;
        cursor: pointer;
    }
    .na-document-picker__result:last-child {
        border-bottom: 0;
    }
    .na-document-picker__result:hover,
    .na-document-picker__result:focus-visible {
        outline: 0;
        background: var(--b3-list-hover);
    }
    .na-document-picker__state {
        display: grid;
        place-items: center;
        min-height: 48px;
        padding: 8px 10px;
        color: var(--na-text-secondary);
        font-size: var(--na-font-size-sm);
        text-align: center;
    }
    .na-document-picker__state--error {
        color: var(--na-color-error);
    }

    @media (max-width: 600px) {
        .na-document-picker__results--fixed {
            left: 0 !important;
            top: auto !important;
            bottom: 0 !important;
            width: 100% !important;
            max-height: min(72dvh, 520px) !important;
            padding: 18px 12px calc(12px + env(safe-area-inset-bottom));
            border: 0;
            border-top: 1px solid var(--na-color-divider);
            border-radius: 16px 16px 0 0;
            box-shadow: 0 -8px 28px color-mix(in srgb, var(--b3-theme-on-background) 18%, transparent);
            background: var(--b3-theme-surface);
        }
        .na-document-picker__results--fixed::before {
            content: "";
            display: block;
            width: 36px;
            height: 4px;
            margin: -9px auto 12px;
            border-radius: 999px;
            background: var(--na-color-divider);
        }
        .na-document-picker__result {
            min-height: 52px;
            padding: 8px 10px;
        }
    }
</style>
