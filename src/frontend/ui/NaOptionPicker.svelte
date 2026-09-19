<script lang="ts">
    import NaPageHost from "./NaPageHost.svelte";
    import NaSearchInput from "./NaSearchInput.svelte";
    import NaInlineNotice from "./NaInlineNotice.svelte";

    interface Props {
        title: string;
        options: { id: string; label: string }[];
        searchLabel: string;
        emptyText: string;
        closeLabel: string;
        busy?: boolean;
        error?: string;
        onSelect: (id: string) => void;
        onClose: () => void;
    }
    let {
        title,
        options,
        searchLabel,
        emptyText,
        closeLabel,
        busy = false,
        error = "",
        onSelect,
        onClose,
    }: Props = $props();
    let query = $state("");
    let pressedOption: string | null = null;
    let filtered = $derived(
        options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase())),
    );
</script>

<NaPageHost {title} mode="sheet" backLabel={closeLabel} onBack={onClose}>
    <div class="na-option-picker" aria-busy={busy}>
        <div class="na-option-picker__search">
            <NaSearchInput bind:value={query} placeholder={searchLabel} disabled={busy} />
            {#if error}<NaInlineNotice message={error} tone="error" />{/if}
        </div>
        {#each filtered as option (option.id)}
            <button
                type="button"
                class="na-option-picker__option"
                disabled={busy}
                onpointerdown={() => (pressedOption = option.id)}
                onpointercancel={() => (pressedOption = null)}
                onclick={(event) => {
                    // Ignore the compatibility click from the gesture that just opened this sheet.
                    if (event.detail > 0 && pressedOption !== option.id) return;
                    pressedOption = null;
                    onSelect(option.id);
                }}>{option.label}</button
            >
        {:else}
            <div class="na-option-picker__empty" role="status">{emptyText}</div>
        {/each}
    </div>
</NaPageHost>

<style lang="scss">
    .na-option-picker {
        padding: 0 12px 12px;
    }
    .na-option-picker__search {
        position: sticky;
        top: 0;
        padding: 8px 0;
        background: var(--b3-theme-background);
        --na-control-height: 44px;
    }
    .na-option-picker__option {
        display: block;
        width: 100%;
        min-height: 48px;
        padding: 12px 8px;
        border: 0;
        border-bottom: 1px solid var(--b3-border-color);
        background: transparent;
        color: var(--na-text-primary);
        font: inherit;
        text-align: start;
        overflow-wrap: anywhere;
        cursor: pointer;
        &:hover,
        &:focus-visible {
            background: var(--b3-list-hover);
        }
        &:disabled {
            opacity: 0.5;
            cursor: wait;
        }
    }
    .na-option-picker__empty {
        padding: 24px 8px;
        color: var(--na-text-secondary);
    }
</style>
