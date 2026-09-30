<script lang="ts">
    import type { Snippet } from "svelte";
    import NaIcon from "./NaIcon.svelte";
    import NaSpinner from "./NaSpinner.svelte";

    export let variant: "default" | "primary" | "danger" | "text" = "default";
    export let size: "md" | "sm" = "md";
    export let icon = "";
    export let disabled = false;
    export let loading = false;
    export let type: "button" | "submit" | "reset" = "button";
    export let ariaLabel = "";
    export let ariaPressed: boolean | undefined = undefined;
    export let id = "";
    export let children: Snippet;
    export let onclick: (event: MouseEvent) => void = () => {};
</script>

<button
    id={id || undefined}
    {type}
    class="na-button"
    class:na-button--primary={variant === "primary"}
    class:na-button--danger={variant === "danger"}
    class:na-button--text={variant === "text"}
    class:na-button--sm={size === "sm"}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    aria-label={ariaLabel || undefined}
    aria-pressed={ariaPressed}
    {onclick}
>
    {#if loading}<NaSpinner />{:else if icon}<NaIcon symbol={icon} size={size === "sm" ? 13 : 14} />{/if}
    <span>{@render children()}</span>
</button>

<style lang="scss">
    .na-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--na-space-xs);
        min-width: 0;
        height: var(--na-control-height);
        padding: 0 var(--na-space-lg);
        border: 1px solid var(--na-color-divider);
        border-radius: var(--na-radius-md);
        color: var(--b3-theme-on-background);
        background: var(--b3-theme-surface);
        font: 500 var(--na-font-size-md)/1 var(--b3-font-family);
        cursor: pointer;
        white-space: nowrap;
        transition:
            background-color 0.15s,
            border-color 0.15s,
            color 0.15s,
            opacity 0.15s;

        &:hover:not(:disabled) {
            background: var(--b3-theme-surface-light);
            border-color: var(--b3-theme-primary-light);
        }
        &:active:not(:disabled) {
            transform: translateY(1px);
        }
        &:focus-visible {
            outline: 2px solid var(--b3-theme-primary);
            outline-offset: 2px;
        }
        &:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
    }

    .na-button--sm {
        height: var(--na-control-height-sm);
        padding-inline: var(--na-space-md);
        font-size: var(--na-font-size-sm);
        border-radius: var(--na-radius-sm);
    }
    .na-button--primary {
        color: var(--na-text-interactive);
        background: var(--na-accent-surface);
        border-color: var(--b3-theme-primary);
    }
    .na-button--primary:hover:not(:disabled) {
        color: var(--na-text-interactive);
        background: var(--na-accent-surface-hover);
        border-color: var(--b3-theme-primary);
    }
    .na-button--danger {
        color: var(--na-text-danger);
        background: transparent;
        border-color: var(--na-color-error-border);
    }
    .na-button--danger:hover:not(:disabled) {
        color: var(--na-text-danger);
        background: var(--na-color-error-bg);
        border-color: var(--na-color-error);
    }
    .na-button--text {
        border-color: transparent;
        background: transparent;
        color: var(--na-text-interactive);
    }
    .na-button--text:hover:not(:disabled) {
        background: var(--b3-theme-primary-lightest);
        border-color: transparent;
    }
</style>
