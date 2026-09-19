<script lang="ts">
    interface Props {
        label: string;
        disabled?: boolean;
        active?: boolean;
        onpointerdown: (event: PointerEvent) => void;
        onclick: (event: MouseEvent) => void;
    }
    let { label, disabled = false, active = false, onpointerdown, onclick }: Props = $props();
</script>

<button
    type="button"
    class="na-drag-handle"
    class:na-drag-handle--active={active}
    aria-label={label}
    {disabled}
    {onpointerdown}
    {onclick}
>
    <span aria-hidden="true">⠿</span>{label}
</button>

<style>
    .na-drag-handle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        min-width: 44px;
        min-height: 44px;
        padding: 4px 8px;
        border: 1px solid var(--b3-border-color);
        border-radius: var(--na-radius-md);
        color: var(--na-text-primary);
        background: var(--b3-theme-surface);
        font: inherit;
        font-size: 12px;
        white-space: nowrap;
        flex: 1;
        cursor: ns-resize;
        touch-action: none;
        user-select: none;
    }
    .na-drag-handle--active,
    .na-drag-handle:active {
        background: var(--na-accent-surface);
        border-color: var(--b3-theme-primary);
    }
    .na-drag-handle:focus-visible {
        outline: 2px solid var(--b3-theme-primary);
        outline-offset: 1px;
    }
    .na-drag-handle:disabled {
        opacity: 0.5;
        cursor: wait;
    }
</style>
