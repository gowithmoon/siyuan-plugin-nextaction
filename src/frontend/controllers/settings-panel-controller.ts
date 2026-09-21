import { DEFAULT_SETTINGS, mergeSettings, validateSettings, type PluginSettings } from "../../shared/settings";

export type SettingsPage = "general" | "customFields" | "ai" | "mcp" | "advanced";
export type SettingsLoadState = "idle" | "loading" | "loaded" | "error";
export type SettingsSaveState = "idle" | "saving" | "saved" | "error";
export type SettingsCloseDecision = "close" | "confirm-discard";
export type SettingsActionKind = "draft" | "maintenance";

export interface SettingsAction {
    id: string;
    kind: SettingsActionKind;
}

export interface SettingsPanelControllerSnapshot {
    saved: PluginSettings;
    draft: PluginSettings;
    dirty: boolean;
    page: SettingsPage;
    categoryDetailOpen: boolean;
    loadState: SettingsLoadState;
    saveState: SettingsSaveState;
    postSavePending: boolean;
    error: string;
    pendingAction: SettingsAction | null;
    maintenanceBusy: ReadonlySet<string>;
    closeRequested: boolean;
}

export interface SettingsPanelControllerOptions {
    formatError(error: unknown): string;
    formatValidationError(error: string): string;
}

function cloneSettings(settings: PluginSettings): PluginSettings {
    return mergeSettings(DEFAULT_SETTINGS, settings);
}

function settingsEqual(left: PluginSettings, right: PluginSettings): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

export class SettingsPanelController {
    private state: SettingsPanelControllerSnapshot;
    private activeSave: Promise<PluginSettings | null> | null = null;
    private discarded = false;
    private appliedSettings = cloneSettings(DEFAULT_SETTINGS);

    constructor(private readonly options: SettingsPanelControllerOptions) {
        const defaults = cloneSettings(DEFAULT_SETTINGS);
        this.state = {
            saved: defaults,
            draft: cloneSettings(defaults),
            dirty: false,
            page: "general",
            categoryDetailOpen: false,
            loadState: "idle",
            saveState: "idle",
            postSavePending: false,
            error: "",
            pendingAction: null,
            maintenanceBusy: new Set(),
            closeRequested: false,
        };
    }

    get snapshot(): SettingsPanelControllerSnapshot {
        return this.state;
    }

    beginLoad(): void {
        this.patch({ loadState: "loading", error: "" });
    }

    load(raw: Partial<PluginSettings> | null | undefined): PluginSettings {
        const settings = mergeSettings(DEFAULT_SETTINGS, raw || {});
        this.appliedSettings = cloneSettings(settings);
        this.state = {
            ...this.state,
            saved: cloneSettings(settings),
            draft: cloneSettings(settings),
            dirty: false,
            loadState: "loaded",
            saveState: "idle",
            postSavePending: false,
            error: "",
            closeRequested: false,
        };
        return settings;
    }

    loadFailed(error: unknown): void {
        this.patch({ loadState: "error", error: this.options.formatError(error) });
    }

    edit(draft: PluginSettings): void {
        if (this.state.loadState !== "loaded") return;
        const next = cloneSettings(draft);
        this.patch({
            draft: next,
            dirty: !settingsEqual(next, this.state.saved),
            saveState: this.state.saveState === "saving" ? "saving" : "idle",
            error: "",
            closeRequested: false,
        });
    }

    setPage(page: SettingsPage): void {
        this.patch({ page, categoryDetailOpen: true });
    }

    backToCategories(): boolean {
        if (!this.state.categoryDetailOpen) return false;
        this.patch({ categoryDetailOpen: false });
        return true;
    }

    async save(persist: (settings: PluginSettings) => Promise<PluginSettings>): Promise<PluginSettings | null> {
        if (this.activeSave) return this.activeSave;
        const validationError = validateSettings(this.state.draft);
        if (validationError) {
            this.patch({ saveState: "error", error: this.options.formatValidationError(validationError) });
            return null;
        }
        const savingDraft = cloneSettings(this.state.draft);
        const savePromise = (async () => {
            this.patch({ saveState: "saving", error: "" });
            try {
                const authoritative = cloneSettings(await persist(savingDraft));
                this.state = {
                    ...this.state,
                    saved: authoritative,
                    draft: cloneSettings(authoritative),
                    dirty: false,
                    saveState: "saved",
                    postSavePending: true,
                    error: "",
                };
                return authoritative;
            } catch (error: unknown) {
                this.patch({ saveState: "error", error: this.options.formatError(error) });
                return null;
            }
        })();
        this.activeSave = savePromise;
        const result = await savePromise;
        if (this.activeSave === savePromise) this.activeSave = null;
        return result;
    }

    async refreshAfterSave(
        refresh: (settings: PluginSettings) => void | Promise<void>,
        apply: (previous: PluginSettings, next: PluginSettings) => Promise<void>,
    ): Promise<void> {
        const saved = cloneSettings(this.state.saved);
        await refresh(saved);
        await apply(this.appliedSettings, saved);
        this.appliedSettings = saved;
        this.patch({ postSavePending: false });
    }

    reportPostSaveError(message: string): void {
        this.patch({ saveState: "saved", error: message });
    }

    reportError(message: string): void {
        this.patch({ error: message });
    }

    clearError(): void {
        this.patch({ error: "" });
    }

    requestAction(action: SettingsAction): SettingsAction {
        this.patch({ pendingAction: action });
        return action;
    }

    confirmAction(): SettingsAction | null {
        const action = this.state.pendingAction;
        this.patch({ pendingAction: null });
        return action;
    }

    cancelAction(): void {
        this.patch({ pendingAction: null });
    }

    async runMaintenance<T>(id: string, operation: () => Promise<T>): Promise<T> {
        const maintenanceBusy = new Set(this.state.maintenanceBusy).add(id);
        this.patch({ maintenanceBusy, error: "" });
        try {
            return await operation();
        } catch (error: unknown) {
            this.patch({ error: this.options.formatError(error) });
            throw error;
        } finally {
            const nextBusy = new Set(this.state.maintenanceBusy);
            nextBusy.delete(id);
            this.patch({ maintenanceBusy: nextBusy });
        }
    }

    async requestClose(): Promise<SettingsCloseDecision> {
        this.patch({ closeRequested: true });
        if (this.activeSave) await this.activeSave;
        if (!this.state.dirty) {
            this.patch({ closeRequested: false });
            return "close";
        }
        return "confirm-discard";
    }

    confirmDiscard(): SettingsCloseDecision {
        this.discarded = true;
        this.patch({ closeRequested: false });
        return "close";
    }

    cancelClose(): void {
        this.patch({ closeRequested: false });
    }

    private patch(patch: Partial<SettingsPanelControllerSnapshot>): void {
        this.state = { ...this.state, ...patch };
    }
}
