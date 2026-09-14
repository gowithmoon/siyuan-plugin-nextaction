<script lang="ts">
    import type { I18nStrings } from "../../shared/i18n";
    import { taskStore, pendingReminderCount } from "../stores/task-store";
    import { getViewDirectory } from "../view-directory";
    import { QUICK_VIEWS } from "../controllers/workspace-session";
    import NaIcon from "../ui/NaIcon.svelte";
    interface Props {
        i18n: I18nStrings;
        activeView: string;
        catalog: boolean;
        bottom?: boolean;
        directoryOnly?: boolean;
        onSwitch: (view: string) => void;
        onCatalog: () => void;
    }
    let { i18n, activeView, catalog, bottom = false, directoryOnly = false, onSwitch, onCatalog }: Props = $props();
    let groups = $derived(getViewDirectory(i18n, $taskStore.settings?.reminderSettings?.enabled !== false));
    let quick = $derived(QUICK_VIEWS.map((id) => groups.flatMap((g) => g.items).find((v) => v.view === id)!));
</script>

{#if directoryOnly}
    <nav class="na-view-directory" aria-label={i18n.allViews}>
        {#each groups as group}
            <section>
                <h2>{group.label}</h2>
                {#each group.items as item}
                    <button type="button" onclick={() => onSwitch(item.view)}>
                        <NaIcon symbol={item.icon} size={18} /><span>{item.label}</span>
                        {#if item.view === "review" && $taskStore.reviewDueCount}<small
                                >{$taskStore.reviewDueCount}</small
                            >{/if}
                        {#if item.view === "reminder" && $pendingReminderCount}<small>{$pendingReminderCount}</small
                            >{/if}
                        <NaIcon symbol="iconRight" size={12} />
                    </button>
                {/each}
            </section>
        {/each}
    </nav>
{:else}
    <nav class="na-compact-nav" class:na-compact-nav--bottom={bottom} aria-label={i18n.taskPanel}>
        {#each quick as item}
            <button
                type="button"
                aria-label={item.label}
                class:active={!catalog && activeView === item.view}
                aria-current={!catalog && activeView === item.view ? "page" : undefined}
                onclick={() => onSwitch(item.view)}
            >
                {#if bottom}<NaIcon symbol={item.icon} size={20} />{/if}<span>{item.label}</span>
            </button>
        {/each}
        {#if !bottom}<button
                type="button"
                class:active={catalog || !QUICK_VIEWS.some((view) => view === activeView)}
                aria-current={catalog || !QUICK_VIEWS.some((view) => view === activeView) ? "page" : undefined}
                onclick={onCatalog}
                ><NaIcon symbol="iconList" size={bottom ? 20 : 16} /><span>{i18n.allViews}</span></button
            >{/if}
        {#if bottom}<button
                type="button"
                class:active={catalog || !QUICK_VIEWS.some((view) => view === activeView)}
                aria-current={catalog || !QUICK_VIEWS.some((view) => view === activeView) ? "page" : undefined}
                onclick={onCatalog}><NaIcon symbol="iconList" size={20} /><span>{i18n.allViews}</span></button
            >{/if}
    </nav>
{/if}

<style lang="scss">
    .na-compact-nav {
        display: flex;
        flex: none;
        border-bottom: 1px solid var(--b3-border-color);
        padding: 4px;
        background: var(--b3-theme-surface);
    }
    .na-compact-nav button {
        flex: 1;
        min-width: 0;
        min-height: 30px;
        border: 0;
        padding: 4px;
        color: var(--na-text-secondary);
        background: transparent;
        font: inherit;
        cursor: pointer;
    }
    .na-compact-nav button.active {
        color: var(--na-text-interactive);
        background: var(--na-accent-surface);
        border-radius: var(--b3-border-radius);
    }
    .na-compact-nav--bottom {
        border-top: 1px solid var(--b3-border-color);
        border-bottom: 0;
        padding: 4px 4px max(4px, env(safe-area-inset-bottom));
    }
    .na-compact-nav--bottom button {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        min-height: 52px;
        font-size: 12px;
    }
    .na-view-directory {
        overflow-y: auto;
        height: 100%;
        box-sizing: border-box;
        padding: 12px;
    }
    .na-view-directory h2 {
        margin: 16px 0 8px;
        font-size: inherit;
        color: var(--na-text-secondary);
    }
    .na-view-directory button {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-height: 44px;
        border: 0;
        border-bottom: 1px solid var(--b3-border-color);
        background: transparent;
        color: var(--na-text-primary);
        font: inherit;
        text-align: start;
        cursor: pointer;
    }
    .na-view-directory button span {
        flex: 1;
    }
    button:hover {
        background: var(--b3-list-hover);
    }
</style>
