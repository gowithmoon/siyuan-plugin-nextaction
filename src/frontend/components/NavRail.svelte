<script lang="ts">
    import { getViewDirectory } from "../view-directory";
    import { onMount } from "svelte";
    import { VIEW_NEXT_ACTION, VIEW_REVIEW } from "../constants";
    import { taskStore } from "../stores/task-store";
    import NaIcon from "../ui/NaIcon.svelte";
    import NaNavItem from "../ui/NaNavItem.svelte";
    import NaTooltip from "../ui/NaTooltip.svelte";

    interface Props {
        activeView?: string;
        onSwitchView: (view: string) => void;
        onRefresh: () => void;
        i18n: any;
    }

    let { activeView = VIEW_NEXT_ACTION, onSwitchView, onRefresh, i18n }: Props = $props();

    let navGroups = $derived(getViewDirectory(i18n));

    let refreshDone = $state(false);
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let railEl: HTMLElement | undefined = $state();
    let compact = $state(false);
    let veryNarrow = $state(false);

    onMount(() => {
        const root = railEl?.closest<HTMLElement>(".na-app");
        if (!root) return;

        const updateLayout = () => {
            const width = root.getBoundingClientRect().width;
            compact = width < 720;
            veryNarrow = width < 360;
        };

        updateLayout();
        const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateLayout) : null;
        observer?.observe(root);
        return () => observer?.disconnect();
    });

    function handleRefresh() {
        if (refreshDone) return;
        onRefresh();
        refreshDone = true;
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
            refreshDone = false;
        }, 1200);
    }
</script>

<nav
    class="na-nav-rail"
    class:na-nav-rail--compact={compact}
    class:na-nav-rail--very-narrow={veryNarrow}
    bind:this={railEl}
>
    {#each navGroups as group}
        <div class="na-nav-rail__group" aria-label={group.label}>
            <div class="na-nav-rail__group-label">{group.label}</div>
            {#each group.items as item}
                <NaNavItem
                    label={item.label}
                    icon={item.icon}
                    collapsed={compact}
                    active={activeView === item.view}
                    tooltip={item.label}
                    badge={item.view === VIEW_REVIEW ? $taskStore.reviewDueCount : ""}
                    onclick={() => onSwitchView(item.view)}
                />
            {/each}
        </div>
    {/each}
    <div class="na-nav-rail__spacer"></div>
    <div class="na-nav-rail__footer">
        <NaTooltip
            text={refreshDone ? i18n?.refreshed || "Refreshed" : i18n?.refreshTasks || "Refresh Tasks"}
            position="right"
            followCursor={false}
            block
            disabled={!compact}
        >
            <button
                class="na-nav-rail__action-btn"
                class:is-done={refreshDone}
                onclick={handleRefresh}
                aria-label={refreshDone ? i18n?.refreshed || "Refreshed" : i18n?.refreshTasks || "Refresh Tasks"}
            >
                {#if refreshDone}
                    <NaIcon symbol="iconCheck" size={13} />
                    <span class="na-nav-rail__action-label">{i18n?.refreshed || "Refreshed"}</span>
                {:else}
                    <NaIcon symbol="iconRefresh" size={13} />
                    <span class="na-nav-rail__action-label">{i18n?.refreshTasks || "Refresh Tasks"}</span>
                {/if}
            </button>
        </NaTooltip>
    </div>
</nav>
