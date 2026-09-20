import {
    type TaskCacheEntry,
    type StatisticsResult,
    type StatisticsSummary,
    StatisticsDistribution,
    StatisticsContextItem,
    StatisticsProjectStatus,
    type ReviewData,
    type CompletedTasksPage,
    type MyDayState,
} from "../shared/types";
import { McpToolError, getErrorMessage } from "./mcp-tool-error";
import { paginateCompletedTasks, type CompletedTasksPageOptions } from "../shared/task-pagination";
import {
    ATTR_TASK,
    ATTR_STATUS,
    ATTR_PRIORITY,
    ATTR_IMPORTANCE,
    ATTR_EFFORT,
    ATTR_DUE,
    ATTR_START,
    ATTR_CONTEXT,
    ATTR_PARENT,
    ATTR_DEPENDS,
    ATTR_DEP_MODE,
    ATTR_SEQUENTIAL,
    ATTR_REPEAT,
    ATTR_REPEAT_STATE,
    ATTR_SORT,
    ATTR_COMPLETED,
    ATTR_NOTE,
    ATTR_CREATED,
    ATTR_TAGS,
    ATTR_REVIEW_INTERVAL,
    ATTR_REVIEW_DATE,
    ATTR_REMINDER,
    RPC_ERROR_INVALID_PARAMS,
    RPC_ERROR_TASK_NOT_FOUND,
    RPC_ERROR_CIRCULAR_REF,
    RPC_ERROR_DEP_CYCLE,
    RPC_ERROR_PROJECT_REQUIRES_DOCUMENT,
    ALL_STATUSES,
    ATTR_EXT_PREFIX,
    ATTR_OUTCOME,
    ATTR_DOD,
    ATTR_KIND,
    ACTION_KIND_ACTION,
    TASK_WARNING_PROJECT_REOPENED,
} from "../shared/constants";
import { type CacheManager } from "./cache-manager";
import { attrToNumber, numberToAttr, validateTaskAttrs, cleanSlashFromTitle } from "./utils";
import { assertBlockId } from "../shared/block-id";
import { sql } from "../shared/sql";
import type { SiyuanApiPort } from "./siyuan-api";
import { isNextActionCandidate, sortTasks } from "./priority-engine";
import {
    advanceRepeatState,
    createRepeatState,
    normalizeRepeatRule,
    parseRepeatRule,
    parseRepeatState,
    type RepeatRuleV2,
    type RepeatStateV1,
} from "./repeat-engine";
import type { PluginSettings } from "../shared/settings";
import {
    encodeCustomFieldValue,
    isCustomFieldApplicable,
    validateCustomFieldDefinition,
    type CustomFieldDef,
} from "../shared/custom-fields";
import { parseTaskTitleDates } from "../shared/natural-date";
import { isTaskDueOverdue, isTaskReviewDue, localDateString } from "../shared/review";
import type { ConfirmedTaskChanges, TaskRepository } from "./task-repository";
import type { TaskRuntimeState } from "./task-runtime-state";
import type { TaskCustomFieldService } from "./task-custom-field-service";
import { addLocalDays } from "./task-date-utils";
import type { TaskRelationshipService } from "./task-relationship-service";
import { escapeMarkdownText, extractInsertedBlockMeta } from "./mcp-utils";
import type { TaskIdentityResolver, ResolveTaskEvidence, ResolvedTaskTarget } from "./task-identity-resolver";
import { isNativeTaskStructure } from "../shared/task-identity";
import { isProjectTask } from "../shared/project-domain";

function localActionDate(date: Date = new Date()): string {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function codedError(message: string, code: number): Error & { code: number } {
    const error = new Error(message) as Error & { code: number };
    error.code = code;
    return error;
}

function replaceRootBlockSubtype(dom: string, nodeType: "NodeList" | "NodeListItem", subtype: "t" | "u"): string {
    const openingTag = dom.match(/^\s*<[^>]+>/)?.[0] || "";
    if (!openingTag || !new RegExp(`data-type=["']${nodeType}["']`, "i").test(openingTag)) return "";
    const updatedTag = /data-subtype=(["'])[^"']*\1/i.test(openingTag)
        ? openingTag.replace(/data-subtype=(["'])[^"']*\1/i, `data-subtype="${subtype}"`)
        : openingTag.replace(/>$/, ` data-subtype="${subtype}">`);
    return updatedTag + dom.slice(openingTag.length);
}

export interface ConvertToTaskOptions {
    /** Typed evidence for a just-inserted block whose SQL index may still lag. */
    evidence?: ResolveTaskEvidence;
    parentIdHint?: string;
}

export interface MyDayTaskPort {
    updateSettings(settings: PluginSettings): void;
    getState(): Promise<MyDayState>;
    addTask(blockId: string): Promise<MyDayState>;
    removeTask(blockId: string): Promise<MyDayState>;
    reorderTask(blockId: string, afterId?: string): Promise<MyDayState>;
    setSchedule(blockId: string, start: number | null, end: number | null): Promise<MyDayState>;
    removeSchedule(blockId: string): Promise<MyDayState>;
    markTaskCompleted(blockId: string, completedAt: number): Promise<MyDayState>;
    clearTaskCompleted(blockId: string): Promise<MyDayState>;
}

export class TaskLifecycleService {
    private cacheManager: CacheManager;
    private repository: TaskRepository;
    private myDayManager: MyDayTaskPort;
    constructor(
        cacheManager: CacheManager,
        repository: TaskRepository,
        myDayManager: MyDayTaskPort,
        private readonly api: SiyuanApiPort,
        private readonly runtime: TaskRuntimeState,
        private readonly customFields: TaskCustomFieldService,
        private readonly relationships: TaskRelationshipService,
        private readonly identities: TaskIdentityResolver,
    ) {
        this.cacheManager = cacheManager;
        this.repository = repository;
        this.myDayManager = myDayManager;
    }

    private get settings(): PluginSettings {
        return this.runtime.getSettings();
    }

    setIsReady(val: boolean): void {
        this.runtime.setReady(val);
    }

    assertReady(): void {
        this.runtime.assertReady();
    }

    private async reopenCompletedDirectProject(entry: TaskCacheEntry, changes: ConfirmedTaskChanges): Promise<boolean> {
        const project = entry.parentId ? this.cacheManager.get(entry.parentId) : undefined;
        if (entry.status === "done" || project?.status !== "done" || !isProjectTask(project)) return false;

        await changes.upsertAttrs({
            blockId: project.blockId,
            attrs: { [ATTR_STATUS]: "doing" },
            existing: project,
        });
        try {
            await this.myDayManager.clearTaskCompleted(project.blockId);
        } catch (error: unknown) {
            void this.api.log(
                "warn",
                `reopenCompletedDirectProject: failed to clear Project completion in My Day: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
        return true;
    }

    private async getBlockType(blockId: string, waitForIndex = false): Promise<string> {
        const attempts = waitForIndex ? 20 : 1;
        for (let attempt = 0; attempt < attempts; attempt++) {
            const rows = await this.api.query<{ type?: string }>(
                sql`SELECT type FROM blocks WHERE id = ${blockId} LIMIT 1`,
            );
            const blockType = rows?.[0]?.type || "";
            if (blockType || attempt === attempts - 1) return blockType;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return "";
    }

    private buildDefaultAttrs(title: string, status: string, taskType?: string): Record<string, string> {
        const attrs: Record<string, string> = {
            [ATTR_STATUS]: status,
            [ATTR_PRIORITY]: "medium",
            [ATTR_IMPORTANCE]: numberToAttr(this.settings.defaultImportance),
            [ATTR_EFFORT]: numberToAttr(this.settings.defaultEffort),
            [ATTR_CREATED]: new Date().toISOString().slice(0, 19),
        };
        if (taskType) attrs[ATTR_TASK] = taskType;
        if (taskType !== "2") attrs[ATTR_KIND] = ACTION_KIND_ACTION;
        if (this.settings.semanticDateParsingEnabled) {
            const parsedDates = parseTaskTitleDates(title, new Date());
            if (parsedDates.start) attrs[ATTR_START] = parsedDates.start.value;
            if (parsedDates.due) attrs[ATTR_DUE] = parsedDates.due.value;
        }
        return attrs;
    }

    private async getBlockDom(blockId: string, nodeType: "NodeList" | "NodeListItem"): Promise<string> {
        const result = await this.api.request<{ dom?: string }>("/api/block/getBlockDOM", { id: blockId });
        const dom = result?.dom || "";
        if (!replaceRootBlockSubtype(dom, nodeType, "u")) {
            throw new Error(`${nodeType} DOM unavailable: ${blockId}`);
        }
        return dom;
    }

    private async updateBlockDom(blockId: string, dom: string): Promise<void> {
        await this.api.request("/api/block/updateBlock", {
            id: blockId,
            dataType: "dom",
            data: dom,
            lockType: false,
        });
    }

    private async convertNativeTaskToUnorderedItem(blockId: string): Promise<void> {
        const rows = await this.api.query<{
            subtype?: string;
            parent_id?: string;
            parent_type?: string;
            parent_subtype?: string;
        }>(sql`
            SELECT item.subtype,
                   item.parent_id,
                   parent.type AS parent_type,
                   parent.subtype AS parent_subtype
              FROM blocks item
              LEFT JOIN blocks parent ON parent.id = item.parent_id
             WHERE item.id = ${blockId}
             LIMIT 1
        `);
        const structure = rows?.[0];
        const parentListId = structure?.parent_id || "";
        const parentOwnsTaskIdentity =
            structure?.parent_type === "l" && structure.parent_subtype === "t" && !!parentListId;

        const originalDom = await this.getBlockDom(blockId, "NodeListItem");
        const unorderedDom = replaceRootBlockSubtype(originalDom, "NodeListItem", "u")
            .replace(/\sdata-task=(["'])[^"']*\1/i, "")
            .replace(/\sprotyle-task--done\b/g, "")
            .replace(/protyle-action--task\b/g, "")
            .replace(/#icon(?:Uncheck|Check)/g, "#iconDot");
        if (unorderedDom !== originalDom) await this.updateBlockDom(blockId, unorderedDom);

        if (!parentOwnsTaskIdentity) {
            if (unorderedDom === originalDom) {
                throw new Error(`Native task list item could not be converted to an unordered item: ${blockId}`);
            }
            return;
        }

        const siblings = await this.api.request<Array<{ id?: string; type?: string }>>("/api/block/getChildBlocks", {
            id: parentListId,
        });
        for (const sibling of siblings || []) {
            if (!sibling.id || sibling.id === blockId || sibling.type !== "i") continue;
            const siblingDom = await this.getBlockDom(sibling.id, "NodeListItem");
            const taskDom = replaceRootBlockSubtype(siblingDom, "NodeListItem", "t");
            if (taskDom !== siblingDom) await this.updateBlockDom(sibling.id, taskDom);
        }

        const parentDom = await this.getBlockDom(parentListId, "NodeList");
        const unorderedListDom = replaceRootBlockSubtype(parentDom, "NodeList", "u");
        if (unorderedListDom === parentDom) {
            throw new Error(`Native task list could not be converted to an unordered list: ${parentListId}`);
        }
        await this.updateBlockDom(parentListId, unorderedListDom);
    }

    private fillMissingDefaults(
        existingAttrs: Record<string, string>,
        defaults: Record<string, string>,
    ): Record<string, string> {
        const result: Record<string, string> = {};
        for (const [key, value] of Object.entries(defaults)) {
            if (!existingAttrs[key]) result[key] = value;
        }
        return result;
    }

    // ---- Write operations ----

    async convertToTask(
        blockId: string,
        cleanTitle?: string,
        taskType: string = "1",
        options: ConvertToTaskOptions = {},
    ): Promise<TaskCacheEntry> {
        blockId = assertBlockId(blockId);
        if (options.parentIdHint) assertBlockId(options.parentIdHint, "parentIdHint");
        if (options.evidence) {
            assertBlockId(options.evidence.blockId, "evidence.blockId");
            if (options.evidence.kind === "inserted-native") {
                if (options.evidence.contentBlockId) {
                    assertBlockId(options.evidence.contentBlockId, "evidence.contentBlockId");
                }
                if (options.evidence.parentId) assertBlockId(options.evidence.parentId, "evidence.parentId");
            }
        }
        this.runtime.assertReady();
        if (taskType !== "1" && taskType !== "2") {
            throw codedError("Invalid task type: " + taskType, RPC_ERROR_INVALID_PARAMS);
        }
        const requestedTaskType = taskType as "1" | "2";
        let resolved: ResolvedTaskTarget = await this.identities.resolveTarget({
            blockId,
            taskType: requestedTaskType,
            mode: "conversion",
            parentIdHint: options.parentIdHint,
            evidence: options.evidence,
            readAttrs: (blockIds) => this.repository.batchGetBlockAttrs(blockIds),
        });
        if (requestedTaskType === "2" && resolved.kind !== "convert-text" && resolved.identity.effectiveParentId) {
            throw codedError("Project cannot be child of another task", RPC_ERROR_INVALID_PARAMS);
        }
        let title = cleanTitle || (resolved.kind === "convert-text" ? resolved.title : resolved.identity.title);

        let convertedRootId = "";
        let originalConversionMarkdown = "";
        return this.repository.withConfirmedChanges(async (changes) => {
            try {
                if (resolved.kind === "convert-text") {
                    const originalBlockId = resolved.blockId;
                    const originalTitle = resolved.title;
                    const originalBlock = await this.api.request<{ kramdown?: string }>("/api/block/getBlockKramdown", {
                        id: originalBlockId,
                    });
                    originalConversionMarkdown =
                        typeof originalBlock?.kramdown === "string"
                            ? originalBlock.kramdown
                            : escapeMarkdownText(originalTitle);
                    title = cleanTitle || title || (await this.fetchBlockTitle(originalBlockId));
                    convertedRootId = originalBlockId;
                    const result = await this.api.request<unknown[]>("/api/block/updateBlock", {
                        id: originalBlockId,
                        dataType: "markdown",
                        data: `- [ ] ${escapeMarkdownText(title)}`,
                        lockType: false,
                    });
                    const meta = extractInsertedBlockMeta(result);
                    if (!meta.id || meta.nodeType !== "NodeListItem") {
                        throw new Error("SiYuan did not return the converted native task item");
                    }
                    convertedRootId = meta.rootId || originalBlockId;
                    resolved = await this.identities.resolveTarget({
                        blockId: meta.id,
                        taskType: "1",
                        mode: "conversion",
                        parentIdHint: resolved.structuralParentId || options.parentIdHint,
                        evidence: {
                            kind: "inserted-native",
                            blockId: meta.id,
                            contentBlockId: meta.contentBlockId,
                            parentId: meta.parentId,
                            title,
                        },
                        readAttrs: (blockIds) => this.repository.batchGetBlockAttrs(blockIds),
                    });
                }

                if (resolved.kind === "convert-text") throw new Error("Task target conversion did not resolve");
                const identity = resolved.identity;
                blockId = identity.blockId;
                const existingAttrs = await this.repository.getBlockAttrs(blockId);
                const isNative = identity.identificationSource === "native";
                const contentBlockId = identity.contentBlockId || "";
                if (isNative && !title && contentBlockId) title = await this.fetchBlockTitle(contentBlockId);
                if (!isNative && !title) title = await this.fetchBlockTitle(blockId);

                const defaultStatus = identity.defaultStatus === "todo" ? "inbox" : identity.defaultStatus;
                const defaults = this.buildDefaultAttrs(title, defaultStatus, isNative ? undefined : taskType);
                const missingDefaults = this.fillMissingDefaults(existingAttrs, defaults);
                if (!existingAttrs[ATTR_PARENT] && options.parentIdHint && identity.effectiveParentId) {
                    missingDefaults[ATTR_PARENT] = identity.effectiveParentId;
                }
                if (!existingAttrs[ATTR_PARENT] && identity.structuralParentId) {
                    const siblings = this.cacheManager.getByParent(identity.structuralParentId);
                    const maxSort = siblings.reduce((max, sibling) => Math.max(max, sibling.sort), -1);
                    missingDefaults[ATTR_SORT] = String(maxSort < 0 ? 0 : maxSort + 10000);
                }
                if (isNative && existingAttrs[ATTR_TASK]) missingDefaults[ATTR_TASK] = "";
                if (!isNative && existingAttrs[ATTR_TASK] !== taskType) missingDefaults[ATTR_TASK] = taskType;

                const currentEntry = await changes.upsertAttrs({
                    blockId,
                    attrs: missingDefaults,
                    existing: this.cacheManager.get(blockId),
                    freshIdentity: identity,
                    observations: [{ kind: "renamed", title }],
                });
                const projectReopened = await this.reopenCompletedDirectProject(currentEntry, changes);
                return projectReopened ? { ...currentEntry, _warning: TASK_WARNING_PROJECT_REOPENED } : currentEntry;
            } catch (error: unknown) {
                if (convertedRootId) {
                    try {
                        await this.api.request("/api/block/updateBlock", {
                            id: convertedRootId,
                            dataType: "markdown",
                            data: originalConversionMarkdown,
                            lockType: false,
                        });
                    } catch (rollbackError: unknown) {
                        throw new McpToolError(
                            "PARTIAL_SUCCESS",
                            `Task conversion failed and its rollback also failed: ${getErrorMessage(rollbackError)}`,
                        );
                    }
                }
                throw error;
            }
        });
    }

    async convertToTaskWithChildren(
        blockId: string,
        cleanTitle?: string,
        taskType: string = "1",
    ): Promise<{ converted: number; skipped: number }> {
        blockId = assertBlockId(blockId);
        this.runtime.assertReady();

        if (taskType !== "1" && taskType !== "2") {
            throw codedError("Invalid task type: " + taskType, RPC_ERROR_INVALID_PARAMS);
        }

        // This endpoint converts a subtree into ordinary tasks. Projects have
        // a separate single-document conversion path and must not be created
        // implicitly on descendant paragraph blocks.
        if (taskType === "2") {
            throw codedError("errProjectRequiresDocument", RPC_ERROR_PROJECT_REQUIRES_DOCUMENT);
        }

        // When the target is a paragraph/heading inside a list item, start from
        // that list item so the recursive query also reaches nested lists.
        const startRow = await this.api.query<{ type?: string; parent_id?: string }>(
            sql`SELECT type, parent_id FROM blocks WHERE id = ${blockId} LIMIT 1`,
        );
        const startType = startRow?.[0]?.type || "";
        const startParentId = startRow?.[0]?.parent_id || "";
        let startId = blockId;
        if ((startType === "p" || startType === "h") && startParentId) {
            const parentRow = await this.api.query<{ type?: string }>(
                sql`SELECT type FROM blocks WHERE id = ${startParentId} LIMIT 1`,
            );
            if (parentRow?.[0]?.type === "i") startId = startParentId;
        }

        const rows = await this.api.query<{
            id: string;
            parent_id: string;
            type: string;
            subtype: string;
            sort: number;
        }>(sql`WITH RECURSIVE selected(id, parent_id, type, subtype, sort) AS (
                SELECT id, parent_id, type, subtype, sort FROM blocks WHERE id = ${startId}
                UNION ALL
                SELECT b.id, b.parent_id, b.type, b.subtype, b.sort
                  FROM blocks b INNER JOIN selected s ON b.parent_id = s.id
            ) SELECT id, parent_id, type, subtype, sort FROM selected ORDER BY sort, id`);
        if (!rows?.length) return { converted: 0, skipped: 0 };

        const byId = new Map(rows.map((row) => [row.id, row]));
        const nativeItems = rows.filter((row) => {
            const parent = byId.get(row.parent_id);
            return isNativeTaskStructure({
                type: row.type,
                subtype: row.subtype,
                parentType: parent?.type,
                parentSubtype: parent?.subtype,
            });
        });
        const nativeTextChildren = new Set(
            nativeItems.flatMap((row) =>
                rows
                    .filter(
                        (candidate) =>
                            candidate.parent_id === row.id && (candidate.type === "p" || candidate.type === "h"),
                    )
                    .map((child) => child.id),
            ),
        );
        let converted = 0;
        let skipped = 0;

        for (const row of rows) {
            if (nativeItems.includes(row)) {
                skipped++;
                continue;
            }
            if ((row.type !== "p" && row.type !== "h") || nativeTextChildren.has(row.id)) continue;
            await this.convertToTask(row.id, row.id === blockId ? cleanTitle : undefined, "1");
            converted++;
        }

        return { converted, skipped };
    }

    async removeTask(blockId: string): Promise<void> {
        blockId = assertBlockId(blockId);
        this.runtime.assertReady();

        const entry = this.cacheManager.get(blockId);
        if (!entry) {
            throw codedError("Task not found: " + blockId, RPC_ERROR_TASK_NOT_FOUND);
        }

        if (isProjectTask(entry)) {
            await this.repository.withConfirmedChanges(async (changes) => {
                await this.relationships.clearDirectProjectParents(blockId, changes);
                await changes.upsertAttrs({
                    blockId: entry.attrHostId,
                    attrs: { [ATTR_TASK]: "" },
                    existing: entry,
                    observations: [{ kind: "task-type-confirmed", taskType: "1" }],
                });
                try {
                    await this.myDayManager.removeTask(blockId);
                } catch (error: unknown) {
                    void this.api.log(
                        "warn",
                        `removeTask: failed to remove Project from MyDay: ${error instanceof Error ? error.message : String(error)}`,
                    );
                }
                changes.deleteEntry(blockId);
            });
            return;
        }

        await this.repository.withConfirmedChanges(async (changes) => {
            // Re-point child tasks' na-parent to this entry's parentId
            const grandParentId = entry.parentId;
            for (let i = 0; i < entry.childIds.length; i++) {
                const childId = entry.childIds[i];
                try {
                    const childEntry = this.cacheManager.get(childId);
                    if (childEntry) {
                        await changes.upsertAttrs({
                            blockId: childId,
                            attrs: { [ATTR_PARENT]: grandParentId || "" },
                            existing: childEntry,
                        });
                    }
                } catch (_error: unknown) {
                    // Continue with other children even if one fails
                }
            }

            if (entry.identificationSource === "native") {
                await this.convertNativeTaskToUnorderedItem(blockId);
            }

            // Clear all na-* attributes on the authoritative attribute host.
            const clearAttrs: Record<string, string> = {};
            clearAttrs[ATTR_TASK] = "";
            clearAttrs[ATTR_STATUS] = "";
            clearAttrs[ATTR_PRIORITY] = "";
            clearAttrs[ATTR_IMPORTANCE] = "";
            clearAttrs[ATTR_EFFORT] = "";
            clearAttrs[ATTR_DUE] = "";
            clearAttrs[ATTR_START] = "";
            clearAttrs[ATTR_CONTEXT] = "";
            clearAttrs[ATTR_PARENT] = "";
            clearAttrs[ATTR_DEPENDS] = "";
            clearAttrs[ATTR_DEP_MODE] = "";
            clearAttrs[ATTR_SEQUENTIAL] = "";
            clearAttrs[ATTR_REPEAT] = "";
            clearAttrs[ATTR_REPEAT_STATE] = "";
            clearAttrs[ATTR_SORT] = "";
            clearAttrs[ATTR_COMPLETED] = "";
            clearAttrs[ATTR_NOTE] = "";
            clearAttrs[ATTR_CREATED] = "";
            clearAttrs[ATTR_TAGS] = "";
            clearAttrs[ATTR_REVIEW_INTERVAL] = "";
            clearAttrs[ATTR_REVIEW_DATE] = "";
            clearAttrs[ATTR_REMINDER] = "";
            clearAttrs[ATTR_OUTCOME] = "";
            clearAttrs[ATTR_DOD] = "";
            clearAttrs[ATTR_KIND] = "";

            // Clear custom extension fields
            if (entry.customFields) {
                for (const fieldKey of Object.keys(entry.customFields)) {
                    clearAttrs[ATTR_EXT_PREFIX + fieldKey] = "";
                }
            }

            await changes.upsertAttrs({ blockId: entry.attrHostId, attrs: clearAttrs, existing: entry });

            // Remove from My Day if present
            try {
                await this.myDayManager.removeTask(blockId);
            } catch (error: unknown) {
                void this.api.log(
                    "warn",
                    `removeTask: failed to remove from MyDay: ${error instanceof Error ? error.message : String(error)}`,
                );
            }

            changes.deleteEntry(blockId);
        });
    }

    async updateTask(blockId: string, rawAttrs: Record<string, string>): Promise<TaskCacheEntry> {
        blockId = assertBlockId(blockId);

        // Normalize na-* keys to custom-na-* for convenience
        const attrs: Record<string, string> = {};
        for (const key of Object.keys(rawAttrs)) {
            if (key.startsWith("na-") && !key.startsWith("custom-")) {
                attrs["custom-" + key] = rawAttrs[key];
            } else {
                attrs[key] = rawAttrs[key];
            }
        }
        const validationError = validateTaskAttrs(attrs);
        if (validationError) {
            throw codedError(validationError, RPC_ERROR_INVALID_PARAMS);
        }

        if (
            attrs[ATTR_TASK] !== undefined &&
            attrs[ATTR_TASK] !== "" &&
            attrs[ATTR_TASK] !== "1" &&
            attrs[ATTR_TASK] !== "2"
        ) {
            throw codedError("Invalid task type: " + attrs[ATTR_TASK], RPC_ERROR_INVALID_PARAMS);
        }

        this.runtime.assertReady();
        let cachedTask = this.cacheManager.get(blockId);
        let resolvedUncached: Exclude<ResolvedTaskTarget, { kind: "convert-text" }> | null = null;
        let resolvedExisting: Exclude<ResolvedTaskTarget, { kind: "convert-text" }> | null = null;
        // The editor can issue a write before the incremental cache catches up.
        // In that window an existing task is still a valid update target even
        // though it is not present in the cache yet. Read the authoritative
        // attributes before rejecting the block based on the eventually-
        // consistent SQL type index.
        if (!cachedTask || attrs[ATTR_TASK] === "2" || attrs[ATTR_PARENT] === "") {
            const resolved = await this.identities.resolveTarget({
                blockId,
                taskType: attrs[ATTR_TASK] === "2" ? "2" : "1",
                mode: "existing",
                readAttrs: (blockIds) => this.repository.batchGetBlockAttrs(blockIds),
            });
            if (resolved.kind === "convert-text" || resolved.identity.blockId !== blockId) {
                throw codedError("Task not found: " + blockId, RPC_ERROR_TASK_NOT_FOUND);
            }
            resolvedExisting = resolved;
            if (!cachedTask) resolvedUncached = resolved;
            if (!cachedTask && resolved.identity.identificationSource === "native") {
                await this.cacheManager.rebuild((blockIds) => this.repository.batchGetBlockAttrs(blockIds));
                this.repository.reconcileAllDerivedState();
                cachedTask = this.cacheManager.get(blockId);
            }
        }

        if (attrs[ATTR_PARENT] !== undefined || attrs[ATTR_TASK] !== undefined) {
            const identity = cachedTask
                ? cachedTask
                : resolvedExisting
                  ? {
                        blockId: resolvedExisting.identity.blockId,
                        identificationSource: resolvedExisting.identity.identificationSource,
                        taskType: resolvedExisting.identity.taskType,
                    }
                  : null;
            if (!identity) throw codedError("Task not found: " + blockId, RPC_ERROR_TASK_NOT_FOUND);
            await this.relationships.validateParentChange(
                identity,
                attrs[ATTR_PARENT] ?? cachedTask?.parentId ?? resolvedExisting?.identity.effectiveParentId ?? "",
                attrs[ATTR_TASK] || identity.taskType,
            );
        }

        const effectiveTaskType =
            attrs[ATTR_TASK] || cachedTask?.taskType || resolvedExisting?.identity.taskType || "1";
        if (effectiveTaskType === "2" && attrs[ATTR_KIND] !== undefined && attrs[ATTR_KIND] !== "") {
            throw codedError("custom-na-kind only applies to an ordinary Action", RPC_ERROR_INVALID_PARAMS);
        }
        if (attrs[ATTR_TASK] === "2") attrs[ATTR_KIND] = "";

        // Validate status if provided
        if (attrs[ATTR_STATUS] !== undefined) {
            const statusVal = attrs[ATTR_STATUS];
            let statusValid = false;
            for (let i = 0; i < ALL_STATUSES.length; i++) {
                if (ALL_STATUSES[i] === statusVal) {
                    statusValid = true;
                    break;
                }
            }
            if (!statusValid) {
                throw codedError("Invalid status: " + statusVal, RPC_ERROR_INVALID_PARAMS);
            }
        }

        const customAttrError = this.customFields.validateAttrs(blockId, attrs);
        if (customAttrError) {
            throw codedError(customAttrError, RPC_ERROR_INVALID_PARAMS);
        }

        // 依赖环路检测
        const dependsAttr = attrs[ATTR_DEPENDS];
        if (dependsAttr !== undefined && this.relationships.detectDependencyCycle(blockId, dependsAttr)) {
            throw codedError("Dependency cycle detected", RPC_ERROR_DEP_CYCLE);
        }
        // 依赖不能指向父/祖宗任务
        if (dependsAttr !== undefined && this.relationships.detectDependencyOnAncestor(blockId, dependsAttr)) {
            throw codedError("Cannot depend on ancestor task", RPC_ERROR_DEP_CYCLE);
        }
        // 顺序约束矛盾检测（警告，不阻止）
        const hasSequentialConflict =
            dependsAttr !== undefined && this.relationships.checkSequentialConflict(blockId, dependsAttr);

        // 开始/截止时间校验：截止时间必须 >= 开始时间
        const dueAttr = attrs[ATTR_DUE];
        const startAttr = attrs[ATTR_START];
        if (dueAttr !== undefined || startAttr !== undefined) {
            const existing = this.cacheManager.get(blockId);
            const effectiveStart = startAttr !== undefined ? startAttr : existing?.start || "";
            const effectiveDue = dueAttr !== undefined ? dueAttr : existing?.due || "";
            if (effectiveStart && effectiveDue) {
                const startDate = new Date(effectiveStart.includes("T") ? effectiveStart : effectiveStart + "T00:00");
                const dueDate = new Date(effectiveDue.includes("T") ? effectiveDue : effectiveDue + "T23:59");
                if (dueDate < startDate) {
                    throw codedError("Due date must not be earlier than start date", RPC_ERROR_INVALID_PARAMS);
                }
            }
        }

        // na-repeat 写入验证
        const repeatAttr = attrs[ATTR_REPEAT];
        if (repeatAttr !== undefined && repeatAttr !== "") {
            if (!parseRepeatRule(repeatAttr)) {
                throw codedError("Invalid repeat rule", RPC_ERROR_INVALID_PARAMS);
            }
        } else if (repeatAttr === "") {
            attrs[ATTR_REPEAT_STATE] = "";
        }

        return this.repository.withConfirmedChanges(async (changes) => {
            const previousEntry = this.cacheManager.get(blockId);
            const uncachedAttrs = resolvedUncached?.attrs;
            const uncachedIdentity = resolvedUncached?.identity;
            const hasPreviousState = !!previousEntry || !!resolvedUncached;
            const previousIdentificationSource =
                previousEntry?.identificationSource ?? uncachedIdentity?.identificationSource;
            const previousTitle = previousEntry?.title ?? uncachedIdentity?.title ?? "";
            const previousStatus =
                previousEntry?.status ?? uncachedAttrs?.[ATTR_STATUS] ?? uncachedIdentity?.defaultStatus ?? "inbox";
            const previousParentId = previousEntry?.parentId ?? uncachedIdentity?.effectiveParentId ?? "";
            const previousSort = previousEntry?.sort ?? attrToNumber(uncachedAttrs?.[ATTR_SORT], -1);
            const previousRepeat = previousEntry?.repeat ?? uncachedAttrs?.[ATTR_REPEAT] ?? "";
            const previousRepeatState = previousEntry?.repeatState ?? uncachedAttrs?.[ATTR_REPEAT_STATE] ?? "";
            const previousStart = previousEntry?.start ?? uncachedAttrs?.[ATTR_START] ?? "";
            const previousDue = previousEntry?.due ?? uncachedAttrs?.[ATTR_DUE] ?? "";
            const previousCompleted = previousEntry?.completed ?? uncachedAttrs?.[ATTR_COMPLETED] ?? "";
            const leavingProjectIdentity =
                previousIdentificationSource === "document" &&
                (previousEntry?.taskType ?? uncachedAttrs?.[ATTR_TASK]) === "2" &&
                attrs[ATTR_TASK] !== undefined &&
                attrs[ATTR_TASK] !== "2";
            const authoritativeOldAttrs = await this.repository.getBlockAttrs(blockId);
            if (previousIdentificationSource === "native") {
                const defaults = this.buildDefaultAttrs(previousTitle, previousStatus);
                const requestedAttrs = { ...attrs };
                Object.assign(attrs, this.fillMissingDefaults(authoritativeOldAttrs, defaults), requestedAttrs);
                if (!authoritativeOldAttrs[ATTR_SORT] && previousSort >= 0 && attrs[ATTR_SORT] === undefined) {
                    attrs[ATTR_SORT] = String(previousSort);
                }
                if (authoritativeOldAttrs[ATTR_TASK]) attrs[ATTR_TASK] = "";
                else delete attrs[ATTR_TASK];
            }
            let preparedRepeat: { rule: RepeatRuleV2; state: RepeatStateV1 } | null = null;
            if (attrs[ATTR_STATUS] === "done" && hasPreviousState && previousStatus !== "done") {
                const effectiveRepeat = repeatAttr !== undefined ? repeatAttr : previousRepeat;
                if (effectiveRepeat) {
                    const rule = parseRepeatRule(effectiveRepeat);
                    if (!rule) {
                        throw codedError("Invalid repeat rule", RPC_ERROR_INVALID_PARAMS);
                    }
                    const effectiveStart = attrs[ATTR_START] !== undefined ? attrs[ATTR_START] : previousStart;
                    const effectiveDue = attrs[ATTR_DUE] !== undefined ? attrs[ATTR_DUE] : previousDue;
                    const state =
                        parseRepeatState(previousRepeatState) || createRepeatState(rule, effectiveStart, effectiveDue);
                    if (!state) {
                        throw codedError("Repeat task requires a start or due date", RPC_ERROR_INVALID_PARAMS);
                    }
                    preparedRepeat = { rule, state };
                }
            }

            let currentEntry = await changes.upsertAttrs({
                blockId,
                attrs,
                existing: previousEntry,
                freshIdentity: resolvedExisting?.identity ?? uncachedIdentity,
                observations:
                    attrs[ATTR_TASK] !== undefined
                        ? [
                              {
                                  kind: "task-type-confirmed",
                                  taskType: attrs[ATTR_TASK] === "2" ? "2" : "1",
                              },
                          ]
                        : undefined,
            });

            if (leavingProjectIdentity) {
                await this.relationships.clearDirectProjectParents(blockId, changes);
            }

            // 自动追加完成时间：status 变为 done 时（不是已经是 done）
            if (attrs[ATTR_STATUS] === "done" && hasPreviousState && previousStatus !== "done") {
                const completedAt = Date.now();
                const now = new Date(completedAt).toISOString().slice(0, 19); // YYYY-MM-DDTHH:mm:ss UTC
                const newCompleted = previousCompleted ? previousCompleted + "|" + now : now;
                currentEntry = await changes.upsertAttrs({
                    blockId,
                    attrs: { [ATTR_COMPLETED]: newCompleted },
                    existing: currentEntry,
                });
                try {
                    await this.myDayManager.markTaskCompleted(blockId, completedAt);
                } catch (error: unknown) {
                    void this.api.log(
                        "warn",
                        `updateTask: failed to mark My Day completion: ${error instanceof Error ? error.message : String(error)}`,
                    );
                }
            } else if (attrs[ATTR_STATUS] !== undefined && attrs[ATTR_STATUS] !== "done") {
                try {
                    await this.myDayManager.clearTaskCompleted(blockId);
                } catch (error: unknown) {
                    void this.api.log(
                        "warn",
                        `updateTask: failed to clear My Day completion: ${error instanceof Error ? error.message : String(error)}`,
                    );
                }
            }

            // Fill missing title
            if (!currentEntry.title) {
                currentEntry = { ...currentEntry, title: await this.fetchBlockTitle(blockId) };
                changes.upsertEntry(currentEntry);
            }

            // 循环/重复任务：完成当前发生后推进轻量状态，不生成新块。
            if (preparedRepeat) {
                const advanced = advanceRepeatState(
                    preparedRepeat.rule,
                    preparedRepeat.state,
                    localActionDate(),
                    "complete",
                );
                const repeatAttrs: Record<string, string> = {
                    [ATTR_REPEAT_STATE]: JSON.stringify(advanced.state),
                };

                if (!advanced.ended && advanced.state.status === "active") {
                    repeatAttrs[ATTR_STATUS] = "todo";
                    if (advanced.state.currentDue) repeatAttrs[ATTR_DUE] = advanced.state.currentDue;
                    if (advanced.state.currentStart) repeatAttrs[ATTR_START] = advanced.state.currentStart;
                }

                currentEntry = await changes.upsertAttrs({
                    blockId,
                    attrs: repeatAttrs,
                    existing: currentEntry,
                });
            }

            // 回顾日期推算：status 变为 done 且有 review-interval 时，自动推算下次 review-date
            if (attrs[ATTR_STATUS] === "done" && currentEntry.reviewInterval > 0) {
                const td3 = new Date();
                const today = `${td3.getFullYear()}-${String(td3.getMonth() + 1).padStart(2, "0")}-${String(td3.getDate()).padStart(2, "0")}`;
                const nextReviewDate = addLocalDays(today, currentEntry.reviewInterval);
                currentEntry = await changes.upsertAttrs({
                    blockId,
                    attrs: { [ATTR_REVIEW_DATE]: nextReviewDate },
                    existing: currentEntry,
                });
            }
            const projectReopened = await this.reopenCompletedDirectProject(currentEntry, changes);
            if (projectReopened) {
                return { ...currentEntry, _warning: TASK_WARNING_PROJECT_REOPENED };
            }
            if (hasSequentialConflict) {
                return { ...currentEntry, _warning: "sequentialConflict" };
            }
            return currentEntry;
        });
    }

    async updateTaskTitle(blockId: string, rawTitle: string): Promise<TaskCacheEntry> {
        blockId = assertBlockId(blockId);
        const title = typeof rawTitle === "string" ? rawTitle.replace(/[\r\n]+/g, " ").trim() : "";
        if (!title || title.length > 512) {
            throw codedError("title must contain 1-512 characters", RPC_ERROR_INVALID_PARAMS);
        }
        this.runtime.assertReady();
        const existing = this.cacheManager.get(blockId);
        if (!existing) {
            throw codedError("Task not found: " + blockId, RPC_ERROR_TASK_NOT_FOUND);
        }
        return this.repository.withConfirmedChanges(async (changes) => {
            let baseEntry = existing;
            if (existing.identificationSource === "native") {
                const resolved = existing.contentBlockId
                    ? null
                    : await this.identities.resolveTarget({
                          blockId,
                          taskType: "1",
                          mode: "existing",
                          readAttrs: (blockIds) => this.repository.batchGetBlockAttrs(blockIds),
                      });
                const contentBlockId =
                    existing.contentBlockId ||
                    (resolved && resolved.kind !== "convert-text" ? resolved.identity.contentBlockId : "");
                if (!contentBlockId) {
                    throw codedError("Native task text block not found", RPC_ERROR_TASK_NOT_FOUND);
                }
                const markdown = escapeMarkdownText(title);
                await this.api.request("/api/block/updateBlock", {
                    id: contentBlockId,
                    dataType: "markdown",
                    data: markdown,
                    lockType: true,
                });
                baseEntry = { ...(await changes.upsertAttrs({ blockId, attrs: {}, existing })), contentBlockId };
            } else {
                const blockType = await this.getBlockType(blockId, true);
                if (blockType !== "d") {
                    throw codedError("Only document tasks can be renamed directly", RPC_ERROR_INVALID_PARAMS);
                }
                await this.api.request("/api/filetree/renameDocByID", { id: blockId, title });
            }
            const updated = { ...baseEntry, title };
            changes.upsertEntry(updated);
            return updated;
        });
    }

    async rebuildCache(): Promise<void> {
        const previousProjectIds = this.cacheManager
            .getAll()
            .filter(isProjectTask)
            .map((entry) => entry.blockId);
        await this.cacheManager.rebuild((blockIds) => this.repository.batchGetBlockAttrs(blockIds));
        const removedProjectIds = previousProjectIds.filter((blockId) => {
            const current = this.cacheManager.get(blockId);
            return !current || !isProjectTask(current);
        });
        await this.clearInvalidProjectParents([...removedProjectIds, ...this.findOrphanParentIds()]);
        this.repository.reconcileAllDerivedState();
    }

    private findOrphanParentIds(): string[] {
        const tasks = this.cacheManager.getAll();
        const taskIds = new Set(tasks.map((entry) => entry.blockId));
        return [
            ...new Set(tasks.map((entry) => entry.parentId).filter((parentId) => parentId && !taskIds.has(parentId))),
        ];
    }

    private async clearInvalidProjectParents(parentIds: string[]): Promise<void> {
        const uniqueParentIds = [...new Set(parentIds.filter(Boolean))];
        if (uniqueParentIds.length > 0) {
            await this.repository.withConfirmedChanges(async (changes) => {
                for (const parentId of uniqueParentIds) {
                    await this.relationships.clearDirectProjectParents(parentId, changes);
                }
            });
        }
    }

    async loadCache(): Promise<void> {
        await this.cacheManager.loadAll((blockIds) => this.repository.batchGetBlockAttrs(blockIds));
        await this.clearInvalidProjectParents(this.findOrphanParentIds());
        this.repository.reconcileAllDerivedState();
    }

    updateSettings(partial: Partial<PluginSettings>): PluginSettings {
        return this.runtime.updateSettings(partial);
    }

    getSettings(): PluginSettings {
        return this.runtime.getSettings();
    }

    async getMyDay(): Promise<MyDayState> {
        this.runtime.assertReady();
        return this.myDayManager.getState();
    }

    async addTaskToMyDay(blockId: string): Promise<MyDayState> {
        blockId = assertBlockId(blockId);
        this.runtime.assertReady();
        const entry = this.cacheManager.get(blockId);
        if (entry?.identificationSource === "native" && !entry.created) {
            await this.repository.withConfirmedChanges(async (changes) => {
                await changes.upsertAttrs({ blockId, attrs: {}, existing: entry });
            });
        }
        return this.myDayManager.addTask(blockId);
    }

    async removeTaskFromMyDay(blockId: string): Promise<MyDayState> {
        blockId = assertBlockId(blockId);
        this.runtime.assertReady();
        return this.myDayManager.removeTask(blockId);
    }

    async reorderMyDayTask(blockId: string, afterId?: string): Promise<MyDayState> {
        blockId = assertBlockId(blockId);
        if (afterId) assertBlockId(afterId, "afterId");
        this.runtime.assertReady();
        return this.myDayManager.reorderTask(blockId, afterId);
    }

    async setMyDaySchedule(blockId: string, start: number | null, end: number | null): Promise<MyDayState> {
        blockId = assertBlockId(blockId);
        this.runtime.assertReady();
        return this.myDayManager.setSchedule(blockId, start, end);
    }

    async removeMyDaySchedule(blockId: string): Promise<MyDayState> {
        blockId = assertBlockId(blockId);
        this.runtime.assertReady();
        return this.myDayManager.removeSchedule(blockId);
    }

    private async fetchBlockTitle(blockId: string): Promise<string> {
        try {
            const rows = await this.api.query<{ content: string }>(
                sql`SELECT content FROM blocks WHERE id = ${blockId}`,
            );
            if (rows && rows.length > 0 && rows[0].content) {
                let title = rows[0].content.substring(0, 100);
                // Strip slash command text that may not have been synced yet
                title = cleanSlashFromTitle(title);
                return title;
            }
        } catch (_error: unknown) {
            // Ignore
        }
        return "";
    }
}
