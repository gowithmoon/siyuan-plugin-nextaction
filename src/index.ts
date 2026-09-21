import { Plugin, getFrontend, platformUtils } from "siyuan";
import "./index.scss";
import { configureDocumentNavigation } from "./frontend/controllers/document-navigation";
import { configureDocumentNavigationForApp } from "./frontend/controllers/siyuan-document-navigation";
import type { KernelBridge } from "./frontend/kernel-bridge";
import { SettingsDialogController } from "./frontend/controllers/settings-dialog-controller";
import { PanelHostRegistrar } from "./frontend/controllers/panel-host-registrar";
import { FrontendRuntime } from "./frontend/controllers/frontend-runtime";
import { TaskCommandController } from "./frontend/controllers/task-command-controller";
import { EditorTaskIntegration } from "./frontend/controllers/editor-task-integration";
import { asI18nStrings } from "./shared/i18n";
import { configureMobileNotificationRuntime } from "./frontend/stores/mobile-notification-store";

export default class NextActionPlugin extends Plugin {
    private bridge!: KernelBridge;
    private isMobile: boolean = false;
    private settingsDialog?: SettingsDialogController;
    private panelHosts?: PanelHostRegistrar;
    private runtime?: FrontendRuntime;
    private taskCommands?: TaskCommandController;
    private editorIntegration?: EditorTaskIntegration;

    onload() {
        configureMobileNotificationRuntime({
            getFrontend,
            platformUtils,
        });
        configureDocumentNavigationForApp(this.app);
        this.isMobile = getFrontend() === "mobile" || getFrontend() === "browser-mobile";

        this.panelHosts = new PanelHostRegistrar(this, asI18nStrings(this.i18n), this.isMobile, () => this.bridge);
        this.panelHosts.register();

        this.taskCommands = new TaskCommandController(
            this,
            this.isMobile,
            () => this.bridge,
            () => this.panelHosts?.openTaskPanel(),
        );
        this.taskCommands.registerSlashCommands();
    }

    onLayoutReady() {
        this.runtime = new FrontendRuntime(this, () => this.taskCommands?.getCurrentDocumentId() || "");
        this.bridge = this.runtime.start();

        this.editorIntegration = new EditorTaskIntegration(
            this,
            asI18nStrings(this.i18n),
            () => this.bridge,
            this.taskCommands!,
        );
        this.editorIntegration.start();

        this.taskCommands?.registerCommands();
    }

    onDataChanged(reason?: string): void {
        super.onDataChanged?.();
        this.runtime?.handleDataChanged(reason);
    }

    onunload() {
        configureMobileNotificationRuntime(null);
        configureDocumentNavigation(undefined);
        this.editorIntegration?.dispose();
        this.editorIntegration = undefined;
        this.runtime?.dispose();
        this.runtime = undefined;
        this.settingsDialog?.dispose();
        this.settingsDialog = undefined;
        this.panelHosts?.dispose();
        this.panelHosts = undefined;
        this.taskCommands?.dispose();
        this.taskCommands = undefined;
    }

    openSetting(): void {
        if (!this.settingsDialog)
            this.settingsDialog = new SettingsDialogController(this.bridge, asI18nStrings(this.i18n));
        this.settingsDialog.open();
    }
}
