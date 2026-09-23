import type * as kernel from "siyuan/kernel";
import { setSiyuan } from "./kernel/utils";
import { Mutex } from "./kernel/mutex";
import { CacheManager } from "./kernel/cache-manager";
import { SyncEngine } from "./kernel/sync-engine";
import { TaskService } from "./kernel/task-service";
import { TaskRepository } from "./kernel/task-repository";
import { registerRpcMethods } from "./kernel/rpc-server";
import { MyDayManager } from "./kernel/my-day-manager";
import {
    DEFAULT_SETTINGS,
    mergeSettings,
    normalizeSettings,
    validateSettings,
    type PluginSettings,
} from "./shared/settings";
import { McpToolExecutor } from "./kernel/mcp-tool-executor";
import { McpCapabilityManager } from "./kernel/mcp-capability-manager";
import { AiProposalService } from "./kernel/ai-proposal-service";
import type { ReviewData } from "./shared/types";
import { ProductionSiyuanApi } from "./kernel/siyuan-api";
import { TaskIdentityResolver } from "./kernel/task-identity-resolver";
import { RpcContractError } from "./shared/rpc-methods";
import { TaskTargetResolver } from "./kernel/task-target-resolver";
import { TaskCreationService } from "./kernel/task-creation-service";
import { ProjectSupportService, SiyuanProjectSupportQueryPort } from "./kernel/project-support-service";
import { ActionMoveService } from "./kernel/action-move-service";
import { SiyuanActionSourcePort } from "./kernel/action-source-port";
import { SiyuanActionMoveStructurePort } from "./kernel/action-move-structure-port";
import { ProjectBoardPreferenceManager } from "./kernel/project-board-preference-manager";
import { ProjectBoardMoveService } from "./kernel/project-board-move-service";

class NextActionKernelPlugin {
    private readonly siyuan: kernel.ISiyuan = siyuan;
    private cacheManager!: CacheManager;
    private mutex!: Mutex;
    private syncEngine!: SyncEngine;
    private taskService!: TaskService;
    private mcpToolExecutor!: McpToolExecutor;
    private mcpCapabilityManager!: McpCapabilityManager;
    private taskTargetResolver!: TaskTargetResolver;
    private taskCreationService!: TaskCreationService;
    private projectBoardPreferenceManager!: ProjectBoardPreferenceManager;
    private isReady = false;

    constructor() {
        this.siyuan.plugin.lifecycle.onload = this.onload.bind(this);
        this.siyuan.plugin.lifecycle.onrunning = this.onrunning.bind(this);
        this.siyuan.plugin.lifecycle.onunload = this.onunload.bind(this);
    }

    private async onload(): Promise<void> {
        const { logger, plugin } = this.siyuan;
        await logger.info("onload: NextAction kernel plugin loaded");

        setSiyuan(this.siyuan);
        const api = new ProductionSiyuanApi(this.siyuan);
        const taskIdentities = new TaskIdentityResolver(api);
        this.mutex = new Mutex();
        this.cacheManager = new CacheManager(api, taskIdentities);
        this.syncEngine = new SyncEngine(api, this.cacheManager);
        const myDayManager = new MyDayManager(this.siyuan, { ...DEFAULT_SETTINGS });
        this.projectBoardPreferenceManager = new ProjectBoardPreferenceManager(this.siyuan);
        await this.projectBoardPreferenceManager.load();
        const taskRepository = new TaskRepository(
            api,
            this.cacheManager,
            this.mutex,
            this.syncEngine,
            DEFAULT_SETTINGS,
        );
        this.taskService = new TaskService(this.cacheManager, taskRepository, myDayManager, api, taskIdentities);
        const loadedSettings = await this.loadSettings();
        try {
            this.taskService.updateSettings(loadedSettings);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            await logger.warn("onload: saved settings invalid, using defaults: " + message);
            this.taskService.updateSettings(DEFAULT_SETTINGS);
        }
        this.taskTargetResolver = new TaskTargetResolver(api, () => this.taskService.getSettings());
        this.taskCreationService = new TaskCreationService(this.taskService, api, this.taskTargetResolver, () =>
            this.taskService.getSettings(),
        );
        this.mcpToolExecutor = new McpToolExecutor(
            this.siyuan,
            this.taskService,
            this.taskService.getSettings(),
            api,
            this.taskTargetResolver,
            this.taskCreationService,
            () => this.mcpCapabilityManager.getStatus(),
        );
        this.mcpCapabilityManager = new McpCapabilityManager(
            this.siyuan,
            this.mcpToolExecutor,
            this.taskService.getSettings(),
        );
        const createTask = async (
            input: Parameters<TaskCreationService["create"]>[0],
            options?: Parameters<TaskCreationService["create"]>[2],
        ) => {
            const outcome = await this.taskCreationService.create(
                input,
                this.mcpToolExecutor.applyTaskProperties.bind(this.mcpToolExecutor),
                options,
            );
            return this.mcpToolExecutor.adaptTaskCreationOutcome(outcome);
        };
        const convertTask = async (input: Record<string, unknown>) => {
            const outcome = await this.taskCreationService.convertExisting(
                input,
                this.mcpToolExecutor.applyTaskProperties.bind(this.mcpToolExecutor),
            );
            return this.mcpToolExecutor.adaptConvertedTaskOutcome(outcome);
        };
        const actionSourcePort = new SiyuanActionSourcePort(api);
        const aiProposalService = new AiProposalService(this.taskService, createTask, convertTask, actionSourcePort);
        const projectSupportService = new ProjectSupportService(new SiyuanProjectSupportQueryPort(api));
        const actionMoveService = new ActionMoveService(
            this.cacheManager,
            taskRepository,
            taskIdentities,
            new SiyuanActionMoveStructurePort(api),
        );
        const projectBoardMoveService = new ProjectBoardMoveService(this.cacheManager, this.taskService);

        registerRpcMethods(this.taskService, {
            updateSettings: this.updateSettings.bind(this),
            completeReview: this.completeReview.bind(this),
            getMcpStatus: () => this.mcpCapabilityManager.getStatus(),
            listMcpTargetNotebooks: () => this.taskTargetResolver.listNotebooks(),
            listMcpTargetDocuments: (notebookId, path) => this.taskTargetResolver.listDocuments(notebookId, path),
            searchMcpTargetDocuments: (query) => this.taskTargetResolver.searchDocuments(query),
            resolveMcpDocumentTarget: (value) => this.taskTargetResolver.resolveDocument(value),
            resolveChildTarget: (value) => this.taskTargetResolver.resolveChildTarget(value),
            createTask,
            aiProposalService,
            getProjectSupport: async (projectId) => {
                this.taskService.assertReady();
                return projectSupportService.load(this.taskService.getTask(projectId));
            },
            previewActionMove: (input) => {
                this.taskService.assertReady();
                return actionMoveService.preview(input);
            },
            moveActionToProject: (input) => {
                this.taskService.assertReady();
                return actionMoveService.move(input);
            },
            moveProjectBoardTask: (input) => {
                this.taskService.assertReady();
                return projectBoardMoveService.move(input);
            },
            undoActionMove: (input) => {
                this.taskService.assertReady();
                return actionMoveService.undo(input);
            },
            getTaskSnapshotV2: () => this.syncEngine.getTaskSnapshotV2(),
            broadcastTaskReset: () => this.syncEngine.broadcastReset(),
            getProjectBoardPreferences: () => this.projectBoardPreferenceManager.get(),
            updateProjectBoardPreference: (projectId, preference) =>
                this.projectBoardPreferenceManager.update(projectId, preference),
        });
        await this.mcpCapabilityManager.reconcile(this.taskService.getSettings());

        void this.taskService
            .loadCache()
            .then(async () => {
                const mismatches = await this.cacheManager.verifyIntegrity();
                if (mismatches > 0) {
                    await logger.warn(
                        "onload: cache integrity check found " + mismatches + " mismatches, rebuilding...",
                    );
                    await this.taskService.rebuildCache();
                    this.syncEngine.broadcastReset();
                }
                this.isReady = true;
                await myDayManager.load();
                this.taskService.setIsReady(true);
                await logger.info("onload: cache loaded, task service ready");
            })
            .catch(async (error: unknown) => {
                await logger.error("onload: failed to load cache: " + String(error));
            });
    }

    private async onrunning(): Promise<void> {
        const { logger } = this.siyuan;
        await logger.info("onrunning: kernel plugin running");
    }

    private async onunload(): Promise<void> {
        const { logger } = this.siyuan;
        this.syncEngine.stop();
        this.isReady = false;
        this.taskService.setIsReady(false);
        await this.mcpCapabilityManager?.unload();
        await logger.info("onunload: NextAction kernel plugin unloaded");
    }

    private async loadSettings(): Promise<PluginSettings> {
        try {
            const data = await this.siyuan.storage.get("settings.json");
            const saved = (await data.json()) as unknown;
            return normalizeSettings(saved);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            await this.siyuan.logger.warn("loadSettings: unreadable saved settings, using defaults: " + message);
        }
        return mergeSettings(DEFAULT_SETTINGS, {});
    }

    private async updateSettings(partial: Partial<PluginSettings>): Promise<PluginSettings> {
        const current = this.taskService.getSettings();
        const next = mergeSettings(current, partial);
        const validationError = validateSettings(next);
        if (validationError) throw new RpcContractError(validationError);
        await this.taskTargetResolver.validateSettings(next);
        await this.siyuan.storage.put("settings.json", JSON.stringify(next));
        const applied = this.taskService.updateSettings(next);
        await this.mcpCapabilityManager.reconcile(applied);
        return applied;
    }

    private async completeReview(): Promise<ReviewData> {
        const applied = await this.updateSettings({ lastReviewAt: new Date().toISOString() });
        return this.taskService.getReviewData();
    }
}

new NextActionKernelPlugin();
