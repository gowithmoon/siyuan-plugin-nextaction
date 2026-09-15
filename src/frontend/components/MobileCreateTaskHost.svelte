<script lang="ts">
    import type { KernelBridge } from "../kernel-bridge";
    import type { TaskCacheEntry } from "../../shared/types";
    import type { I18nStrings } from "../../shared/i18n";
    import { provideWorkspace } from "../workspace-context";
    import NaPageHost from "../ui/NaPageHost.svelte";
    import CreateTaskDialog from "./CreateTaskDialog.svelte";
    import { untrack } from "svelte";

    interface Props {
        bridge: KernelBridge;
        i18n: I18nStrings;
        parentTask?: TaskCacheEntry | null;
        initialActionKind?: "action" | "stage";
        onCreated?: (task: TaskCacheEntry) => void;
        onClose: () => Promise<void> | void;
    }
    let { bridge, i18n, parentTask = null, initialActionKind = "action", onCreated, onClose }: Props = $props();
    provideWorkspace(
        "mobile-dock",
        untrack(() => bridge),
    );
    let createComponent: CreateTaskDialog | null = $state(null);
    const title = $derived(
        initialActionKind === "stage" ? i18n.createStage : parentTask ? i18n.createChildTask : i18n.createTask,
    );
    async function created(task: TaskCacheEntry) {
        onCreated?.(task);
        await onClose();
    }
</script>

<NaPageHost {title} backLabel={i18n.cancel} onBack={() => createComponent?.requestClose()}>
    <CreateTaskDialog
        bind:this={createComponent}
        {bridge}
        {i18n}
        {parentTask}
        {initialActionKind}
        onCreated={created}
        onCancel={onClose}
    />
</NaPageHost>
