import { get, writable } from "svelte/store";
import { STATUS_LIST, type ViewType } from "../constants";
import { DEFAULT_FILTER_STATE, type FilterState } from "../utils/filter";

// Views that remain directly reachable from the mobile bottom navigation.
// Keep this list in the same order as the five-item mobile navigation (the
// fifth item is the catalog button rendered by CompactNavigation).
export const QUICK_VIEWS: ViewType[] = ["nextAction", "myDay", "inbox", "all"];
type Location = { activeView: ViewType; catalog: boolean };

export function createWorkspaceSession() {
    const state = writable({
        activeView: "nextAction" as ViewType,
        catalog: false,
        filterByView: {
            all: {
                ...DEFAULT_FILTER_STATE,
                statuses: STATUS_LIST.filter((status) => status !== "inbox" && status !== "done"),
            },
        } as Record<string, FilterState>,
        canBack: false,
    });
    let history: Location[] = [];
    let otherLocation: Location = { activeView: "nextAction", catalog: true };
    let otherHistory: Location[] = [];
    const memory = new Map<string, unknown>();
    function navigate(location: Location) {
        state.update((s) => ({ ...s, ...location, canBack: history.length > 0 }));
    }
    return {
        subscribe: state.subscribe,
        openCatalog() {
            const current = get(state);
            if (!QUICK_VIEWS.includes(current.activeView) && !current.catalog) {
                otherLocation = { activeView: current.activeView, catalog: false };
                otherHistory = [...history];
            }
            history = [];
            navigate({ activeView: current.activeView, catalog: true });
        },
        resumeCatalog() {
            const current = get(state);
            if (!QUICK_VIEWS.includes(current.activeView) || current.catalog) return;
            history = [...otherHistory];
            navigate(otherLocation);
        },
        openView(view: ViewType, nested = false) {
            const current = get(state);
            if (nested) history.push({ activeView: current.activeView, catalog: current.catalog });
            else if (QUICK_VIEWS.includes(view)) {
                if (!QUICK_VIEWS.includes(current.activeView) || current.catalog) {
                    otherLocation = { activeView: current.activeView, catalog: current.catalog };
                    otherHistory = [...history];
                }
                history = [];
            } else history = [{ activeView: view, catalog: true }];
            navigate({ activeView: view, catalog: false });
        },
        back() {
            const previous = history.pop();
            if (previous) navigate(previous);
        },
        setFilterState(view: string, filter: FilterState) {
            state.update((s) => ({
                ...s,
                filterByView: { ...s.filterByView, [view]: JSON.parse(JSON.stringify(filter)) as FilterState },
            }));
        },
        read<T>(key: string, fallback: T): T {
            return (memory.get(key) as T | undefined) ?? fallback;
        },
        remember<T>(key: string, value: T) {
            memory.set(key, value);
        },
        getFilter(view: string): FilterState {
            return get(state).filterByView[view] ?? DEFAULT_FILTER_STATE;
        },
    };
}

export type WorkspaceSession = ReturnType<typeof createWorkspaceSession>;
