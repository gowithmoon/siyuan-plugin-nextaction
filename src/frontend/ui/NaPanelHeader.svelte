<script lang="ts">
    import type { Snippet } from "svelte";
    import NaIcon from "./NaIcon.svelte";

    export let eyebrow = "";
    export let title = "";
    export let description = "";
    export let icon = "";
    export let compact = false;
    export let actions: Snippet | undefined = undefined;
    export let leading: Snippet | undefined = undefined;
</script>

<header class="na-panel-header" class:na-panel-header--compact={compact}>
    <div class="na-panel-header__copy">
        {#if leading}{@render leading()}{/if}
        {#if icon}
            <span class="na-panel-header__icon"><NaIcon symbol={icon} size={compact ? 15 : 17} /></span>
        {/if}
        <div class="na-panel-header__text">
            {#if eyebrow}<span class="na-panel-header__eyebrow">{eyebrow}</span>{/if}
            <h1>{title}</h1>
            {#if description}<p>{description}</p>{/if}
        </div>
    </div>
    {#if actions}<div class="na-panel-header__actions">{@render actions()}</div>{/if}
</header>

<style lang="scss">
    .na-panel-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        min-width: 0;
        padding: 15px 18px 13px;
        border-bottom: 1px solid var(--b3-border-color);
        background: var(--na-color-panel-header);
    }

    .na-panel-header--compact {
        align-items: center;
        padding: 9px 12px;
    }

    .na-panel-header__copy,
    .na-panel-header__actions {
        display: flex;
        align-items: center;
        min-width: 0;
    }

    .na-panel-header__copy {
        gap: 9px;
    }
    .na-panel-header__actions {
        flex: 0 0 auto;
        gap: 6px;
    }

    .na-panel-header__icon {
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        flex: 0 0 28px;
        border-radius: var(--b3-border-radius);
        color: var(--na-text-interactive);
        background: var(--b3-theme-primary-lightest);
    }

    .na-panel-header__text {
        min-width: 0;
    }

    .na-panel-header__eyebrow {
        display: block;
        margin-bottom: 2px;
        color: var(--na-text-interactive);
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0;
        line-height: 12px;
        text-transform: uppercase;
    }

    h1 {
        margin: 0;
        overflow: hidden;
        color: var(--na-text-primary);
        font-size: 14px;
        font-weight: 600;
        line-height: 20px;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    p {
        margin: 2px 0 0;
        overflow: hidden;
        color: var(--na-text-secondary);
        font-size: 11px;
        line-height: 16px;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .na-panel-header--compact h1 {
        font-size: 12px;
        line-height: 17px;
    }
    .na-panel-header--compact p {
        display: none;
    }
    .na-panel-header--compact .na-panel-header__icon {
        width: 24px;
        height: 24px;
        flex-basis: 24px;
    }

    @media (max-width: 520px) {
        .na-panel-header {
            padding: 13px 14px 11px;
        }
        .na-panel-header__actions {
            gap: 3px;
        }
    }
</style>
