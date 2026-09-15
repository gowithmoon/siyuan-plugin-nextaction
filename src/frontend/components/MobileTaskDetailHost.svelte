<script lang="ts">
    import type { KernelBridge } from "../kernel-bridge";
    import type { TaskCacheEntry } from "../../shared/types";
    import type { I18nStrings } from "../../shared/i18n";
    import { provideWorkspace } from "../workspace-context";
    import { untrack } from "svelte";
    import NaPageHost from "../ui/NaPageHost.svelte";
    import TaskDetail from "./TaskDetail.svelte";

    interface Props {
        task: TaskCacheEntry;
        bridge: KernelBridge;
        i18n: I18nStrings;
        onClose: () => Promise<void> | void;
        onCreateChild?: (task: TaskCacheEntry) => void;
    }
    let { task, bridge, i18n, onClose, onCreateChild }: Props = $props();
    provideWorkspace(
        "mobile-dock",
        untrack(() => bridge),
    );
    let detail: TaskDetail | null = $state(null);
    const title = $derived(task.title || i18n.untitled);
</script>

<NaPageHost {title} backLabel={i18n.cancel} onBack={() => detail?.requestClose()} chrome={false}>
    <TaskDetail
        bind:this={detail}
        bind:task
        {bridge}
        {i18n}
        presentation="page"
        dialogMode={false}
        {onCreateChild}
        {onClose}
    />
</NaPageHost>
