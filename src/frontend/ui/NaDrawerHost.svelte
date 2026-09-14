<script lang="ts">
    import type { Snippet } from "svelte";

    export let open = false;
    export let label: string;
    export let onRequestClose: (reason: "backdrop" | "escape") => void = () => {};
    export let children: Snippet;

    function handleKeydown(event: KeyboardEvent) {
        if (!open || event.key !== "Escape" || event.defaultPrevented) return;
        const dialogs = (window as any).siyuan?.dialogs;
        if (Array.isArray(dialogs) && dialogs.length > 0) return;
        event.preventDefault();
        onRequestClose("escape");
    }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
    <button
        class="na-drawer-host__backdrop"
        aria-label={label}
        aria-hidden="true"
        tabindex="-1"
        onclick={() => onRequestClose("backdrop")}
    ></button>
{/if}
<div
    class="na-drawer-host"
    class:na-drawer-host--open={open}
    role="dialog"
    aria-modal="true"
    aria-label={label}
    aria-hidden={!open}
    tabindex="-1"
>
    {@render children()}
</div>

<style lang="scss">
    .na-drawer-host {
        position: absolute;
        inset: 0 0 0 auto;
        z-index: 21;
        width: min(440px, 100%);
        height: 100%;
        max-width: 100%;
        min-height: 0;
        box-sizing: border-box;
        overflow: hidden;
        border-left: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);
        box-shadow: var(--b3-dialog-shadow);
        transform: translateX(100%);
        transition: transform 180ms cubic-bezier(0.4, 0, 0.2, 1);
        pointer-events: none;
    }
    .na-drawer-host--open {
        transform: translateX(0);
        pointer-events: auto;
    }
    .na-drawer-host__backdrop {
        position: absolute;
        inset: 0;
        z-index: 20;
        padding: 0;
        border: 0;
        background: var(--na-color-overlay-bg);
    }
    @media (max-width: 520px) {
        .na-drawer-host {
            width: 100%;
            border-left: 0;
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .na-drawer-host {
            transition: none;
        }
    }
</style>
