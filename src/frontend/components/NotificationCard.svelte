<script lang="ts">
    import { fly } from "svelte/transition";
    import { jumpToBlock } from "../utils";

    interface Props {
        title: string;
        type: "due" | "review" | "absolute";
        message: string;
        blockId: string;
        onDismiss: () => void;
        i18n: any;
    }

    let { title, type, message, blockId, onDismiss, i18n }: Props = $props();

    let typeLabel = $derived(
        type === "due"
            ? i18n?.reminderDue || "截止提醒"
            : type === "review"
              ? i18n?.reminderReview || "回顾提醒"
              : i18n?.reminderTypeAbsolute || "Fixed Time",
    );
    let dismissTitle = $derived(i18n?.reminderDismiss || "关闭");

    function handleClick() {
        jumpToBlock(blockId);
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            jumpToBlock(blockId);
        }
    }
</script>

<div class="na-notification-card" transition:fly={{ x: 200, duration: 250 }}>
    <div class="na-notification-card__header">
        <span class="na-notification-card__type na-notification-card__type--{type}">
            {typeLabel}
        </span>
        <button
            class="na-notification-card__close b3-tooltips b3-tooltips__w"
            onclick={onDismiss}
            aria-label={dismissTitle}
        >
            <svg
                viewBox="0 0 16 16"
                width="12"
                height="12"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
            >
                <line x1="4" y1="4" x2="12" y2="12" /><line x1="12" y1="4" x2="4" y2="12" />
            </svg>
        </button>
    </div>
    <div class="na-notification-card__title" onclick={handleClick} onkeydown={handleKeydown} role="button" tabindex="0">
        {title}
    </div>
    <div class="na-notification-card__message">{message}</div>
</div>
