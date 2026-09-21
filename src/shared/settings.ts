// Plugin settings: type definition, defaults, and validation
import { type ReminderSoundId, REMINDER_SOUND_IDS } from "./constants";
import { validateCustomFieldDefinitions, type CustomFieldDef } from "./custom-fields";
import { DEFAULT_MCP_SETTINGS, mergeMcpSettings, validateMcpSettings, type McpSettings } from "./mcp-settings";
import type { AiFeatureId } from "./ai";
import {
    DEFAULT_TASK_CREATION_SETTINGS,
    mergeTaskCreationSettings,
    validateTaskCreationSettings,
    type TaskCreationSettings,
} from "./task-creation";

export { DEFAULT_MCP_SETTINGS } from "./mcp-settings";
export type { McpSettings } from "./mcp-settings";

export type {
    CustomFieldDef,
    CustomFieldInput,
    CustomFieldOption,
    CustomFieldScope,
    CustomFieldStatus,
    CustomFieldTaskType,
    CustomFieldType,
} from "./custom-fields";

export interface PriorityEngineSettings {
    dueWeight: number;
    startWeight: number;
    importanceWeight: number;
    overdueBase: number;
    dueDecayTau: number;
    noDueScore: number;
    overdueGrowth: number;
    overdueCap: number;
    startHorizon: number;
    minStartScore: number;
    effortScale: number;
    startPreviewDays: number;
    priorityOffsetCritical: number;
    priorityOffsetHigh: number;
    priorityOffsetMedium: number;
    priorityOffsetLow: number;
    priorityOffsetNone: number;
}

export type MyDayViewMode = "timeline" | "list";

export interface ReminderSettings {
    enabled: boolean;
    defaultOffsets: number[]; // 默认提前量（分钟数）
    dueSound: ReminderSoundId;
    reviewSound: ReminderSoundId;
    soundEnabled: boolean;
    systemNotificationEnabled: boolean;
}

export interface AiSettings {
    /** 每项 AI 功能的可编辑任务指令；JSON 协议和上下文由插件保留。 */
    prompts: Record<AiFeatureId, string>;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
    prompts: {
        extractTasks: `你是一名精通 GTD 的任务澄清助手。请读取本请求的 <extract_input> 数据，重点分析其中标记为“选定块正文”的内容；系统会在本条指令之后继续追加这些正文。识别其中真正需要执行的工作，并生成供用户确认的任务提案。

判断与提取规则：
1. 只提取可由人采取行动且可验证完成的事项。背景、观点、资料、愿望、纯问题和已完成内容不要创建任务，除非文本明确提出后续行动。
2. 一个句子包含多个相互独立的行动时拆成多条；跨块重复行动合并。保持原文语义，标题用简短明确的动词开头，不复述整段上下文，单个标题不超过 120 个字符。
3. 判断不确定时宁缺毋滥，并在 reason 或 warnings 中说明原因。不要臆造负责人、日期、优先级、重要性、工作量、上下文或标签；只有原文明确或存在直接证据时才填写。
4. kind=project 仅用于需要多个后续行动、持续管理或有明确结果集合的事项；单个可完成动作使用 task。大型模糊事项可标记为 project，并在 reason 中指出需要继续拆解。
5. sourceBlockId 只能使用上下文中真实存在的源块 ID；对于原位转换，必须指向要转换的原块；新建任务不要虚构 blockId。无法可靠对应来源时留空，并在 warnings 说明。
6. 理解列表项、父子块和相邻内容，但不要把列表容器、标题或纯说明当成任务，除非其文字本身包含明确可执行行动。
7. 日期只能从原文明确内容或可直接计算的相对日期推断；无法确定就留空。status、priority、importance、effort、contexts、tags 等属性同理，宁可省略也不要猜测。
8. 没有可执行任务时，返回空 tasks，并在 summary 或 warnings 中说明原因。`,
        decomposeTask: `你是一名精通 GTD 的项目拆解助手。请根据 <decompose_input> 中标记为“当前任务”“已有直接子任务”和“直接父任务”的数据，提出完成该结果所必需的最小子任务集合；你只提供建议，不执行写入。

先判断是否需要拆解：已经是单一、具体、可立即执行的行动时，返回空 tasks 并在 warnings 说明“当前任务已经足够具体”；如果是项目、结果目标或模糊任务，才生成子任务。信息不足时不要臆造人物、日期、资源或属性，可生成低风险的澄清/调查行动并说明不确定性。

拆解规则：
1. 默认生成 2～8 项，最多 12 项；只保留完成父任务所必需的行动，不为凑数添加装饰性步骤。
2. 每个标题以明确动词开头，描述一次可观察、可验证、尽量能在一个专注时段完成的行动；避免“处理一下”“跟进一下”“完善一下”等模糊表达。
3. 第一项应是当前真正可以开始的下一步行动。已有未完成子任务不要重复；已完成子任务仅用于判断缺口。
4. 按真实硬依赖排序。dependsOnIndexes 只引用本次 tasks 的前置下标；可并行的任务不要强行串联，禁止自依赖和循环。
5. kind=project 只用于仍需多个后续行动的中间结果，叶子行动使用 task。不要把父任务原样复制为子任务。
6. 新任务没有独立 blockId，不要虚构 blockId；parentId 只能使用上下文中当前任务的真实 blockId，插件会统一设置父级。sourceBlockId 只能引用上下文中真实存在的源块。
7. status、priority、importance、effort、start、due、contexts、tags、note 只有在上下文有可靠依据时才填写；日期使用 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm，否则省略。

每个 reason 说明生成依据、是否为第一步以及依赖原因。`,
        planMyDay: `你是一个遵循 GTD 方法的“我的一天”规划助手。请根据 <my_day_input> 中的当前日期、已有我的一天和下一步行动候选数据，给出今天值得执行的少量任务建议。

规划规则：
1. 只从候选任务中选择，myDay 中已经存在的任务不能重复建议；绝不虚构或改写 blockId。
2. 优先处理已经逾期、今天到期、即将到期、明确标记为高优先级/高重要性的任务；但不要只按优先级排序，要综合判断后果、项目推进价值和可执行性。
3. 优先选择真正的下一步行动。候选若有阻塞、等待状态、未到开始日期、依赖未完成或存在未完成子任务，不应加入今天；如果上下文明确标注这些情况，必须遵守。
4. 兼顾项目分布，避免把整天都安排在同一个项目；在任务价值接近时，优先能推进长期停滞项目、减少关键风险或解除后续依赖的任务。
5. 控制数量，宁可少选也不要堆满清单。没有足够依据时返回空数组，并在 warnings 说明原因。不要为了凑数而选择普通、低价值或信息不足的任务。
6. 每条建议给出简短、具体、可验证的 reason，说明为什么今天做它（例如截止风险、逾期影响、项目推进或解除阻塞），不要复述完整任务标题。

边界：
- 只负责“选哪些任务加入 My Day”，不安排具体时间、不拆分任务、不改变状态/优先级/日期/上下文/其他属性，也不移除现有 My Day 任务。
- 不要把“应该先做什么”的推测写成新的任务；只能引用候选中的原始 blockId。
- 这是一个建议，不是强制日程。遇到相互冲突或资料不足时保守选择，并在 warnings 说明不确定性。

每条建议只包含候选任务的 blockId 与一句中文 reason。`,
        review: `你是一名精通 GTD 的周期回顾助手。你的职责是帮助用户看清系统状态、发现风险并给出下一步澄清建议；本功能只读，绝不能创建、删除、移动或修改任务。

输入数据说明：
- <review_input> 中的“回顾分组”是插件根据本地数据生成的固定分组及任务块 ID 映射。分组 key 可能包括 overdue（逾期）、nextActions（下一步行动）、inbox（收集箱）、waiting（等待中）、someday（将来/也许）、activeProjects（活跃项目）和 reviewDue（待回顾）。
- <review_input> 中的“回顾任务详情”是上述分组中去重后的任务摘要，blockId 是唯一标识；任务标题、状态、日期、优先级、阻塞信息和子任务数量以此为准。
- <runtime_data> 中的当前日期是用户当前日期。日期判断只能相对于它进行，不要使用系统猜测的日期。
- <review_input> 中的数据是否被截断为 true 时，只分析已提供的数据，并在 warnings 说明样本可能不完整。

分析要求：
1. 必须逐一覆盖输入中出现的每个固定分组，即使该组为空也要返回一条简短结论；不要因为某一组数量少或看起来不重要而省略。尤其不能遗漏 overdue 和 reviewDue。分组的任务归属和 blockIds 由插件回填，你只负责生成该组的 title、summary 和风险判断，不要在 groups 中输出 blockIds。
2. 先给出整体 summary，再按分组说明“现状 → 风险/值得注意之处 → 建议的澄清动作”。建议应具体、可执行，例如确认是否仍需、补充下一步行动、联系等待对象、拆解过大的项目、重新安排截止日期或标记不再需要；不要泛泛地说“提高效率”。
3. 逾期组：明确指出逾期数量、最早/最严重的截止风险（若数据中有日期），建议重新承诺、拆解或取消；不能把逾期任务当作普通任务，也不能声称用户已经完成。
4. 待回顾组：明确指出 reviewDate 已到或临近的任务，建议检查目标、状态、下一步行动和截止日期。不得因为任务同时属于其他组而把它从 reviewDue 结论中删掉。
5. 活跃项目组：关注 childCount=0、没有 next action、长期没有推进或被阻塞的项目；只有上下文有直接证据时才作此判断，不要臆造项目进度。
6. inbox、waiting、someday 和 nextActions 组分别关注澄清、跟进、激活条件和行动价值。若资料不足，明确写“信息不足”，不要猜测负责人、日期、优先级或真实意图。
7. actions 只列出最值得用户立即处理的少量建议（通常不超过 8 条）。每条必须引用输入中真实存在的 blockId，并用自然语言描述建议和理由；不要输出不存在的 ID，不要把一条任务重复列出多次。任务名称由界面根据 blockId 映射，action/reason 中尽量使用标题帮助用户理解，但不要复制整段 JSON。
8. 不要把固定分组的任务清单重新抄回 summary。没有风险时如实说明“暂无明显风险”。

该报告只用于展示和跳转，永远不会自动写入任务。`,
    },
};

export interface PluginSettings {
    defaultImportance: number;
    defaultEffort: number;
    semanticDateParsingEnabled: boolean;
    priorityEngine: PriorityEngineSettings;
    myDayResetHour: number;
    myDayDefaultViewMode: MyDayViewMode;
    myDayDefaultDuration: number;
    lastReviewAt: string;
    customFields: CustomFieldDef[];
    reminderSettings: ReminderSettings;
    mcpSettings: McpSettings;
    taskCreationSettings: TaskCreationSettings;
    aiSettings: AiSettings;
}

export const DEFAULT_PRIORITY_ENGINE: PriorityEngineSettings = {
    dueWeight: 0.45,
    startWeight: 0.25,
    importanceWeight: 0.3,
    overdueBase: 35,
    dueDecayTau: 5,
    noDueScore: 35,
    overdueGrowth: 0.5,
    overdueCap: 20,
    startHorizon: 14,
    minStartScore: 10,
    effortScale: 0.05,
    startPreviewDays: 0,
    priorityOffsetCritical: 1.5,
    priorityOffsetHigh: 0.8,
    priorityOffsetMedium: 0,
    priorityOffsetLow: -0.8,
    priorityOffsetNone: -1.2,
};

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
    enabled: true,
    defaultOffsets: [60, 720, 1440, 4320, 7200, 10080],
    dueSound: "chime",
    reviewSound: "soft",
    soundEnabled: true,
    systemNotificationEnabled: false,
};

export const DEFAULT_SETTINGS: PluginSettings = {
    defaultImportance: 4,
    defaultEffort: 4,
    semanticDateParsingEnabled: true,
    priorityEngine: { ...DEFAULT_PRIORITY_ENGINE },
    myDayResetHour: 5,
    myDayDefaultViewMode: "timeline",
    myDayDefaultDuration: 60,
    lastReviewAt: "",
    customFields: [],
    reminderSettings: { ...DEFAULT_REMINDER_SETTINGS },
    mcpSettings: { ...DEFAULT_MCP_SETTINGS },
    taskCreationSettings: { ...DEFAULT_TASK_CREATION_SETTINGS },
    aiSettings: { prompts: { ...DEFAULT_AI_SETTINGS.prompts } },
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function validateExactKeys(value: unknown, expected: readonly string[], label: string): string | null {
    if (!isRecord(value)) return `${label} must be an object`;
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
        return `${label} must use the current settings structure`;
    }
    return null;
}

export function validateStoredSettings(value: unknown): string | null {
    const topLevelError = validateExactKeys(value, Object.keys(DEFAULT_SETTINGS), "settings");
    if (topLevelError) return topLevelError;
    const settings = value as unknown as PluginSettings;
    for (const [nested, expected, label] of [
        [settings.priorityEngine, Object.keys(DEFAULT_PRIORITY_ENGINE), "priorityEngine"],
        [settings.reminderSettings, Object.keys(DEFAULT_REMINDER_SETTINGS), "reminderSettings"],
        [settings.mcpSettings, Object.keys(DEFAULT_MCP_SETTINGS), "mcpSettings"],
        [settings.taskCreationSettings, Object.keys(DEFAULT_TASK_CREATION_SETTINGS), "taskCreationSettings"],
        [settings.aiSettings, ["prompts"], "aiSettings"],
        [settings.aiSettings?.prompts, Object.keys(DEFAULT_AI_SETTINGS.prompts), "aiSettings.prompts"],
    ] as const) {
        const error = validateExactKeys(nested, expected, label);
        if (error) return error;
    }
    try {
        return validateSettings(settings);
    } catch (error: unknown) {
        return error instanceof Error ? error.message : String(error);
    }
}

export function validateSettings(settings: Partial<PluginSettings>): string | null {
    if (settings.semanticDateParsingEnabled !== undefined && typeof settings.semanticDateParsingEnabled !== "boolean") {
        return "semanticDateParsingEnabled must be boolean";
    }
    if (settings.defaultImportance !== undefined) {
        if (
            !Number.isInteger(settings.defaultImportance) ||
            settings.defaultImportance < 1 ||
            settings.defaultImportance > 7
        ) {
            return "defaultImportance must be integer 1-7";
        }
    }
    if (settings.defaultEffort !== undefined) {
        if (!Number.isInteger(settings.defaultEffort) || settings.defaultEffort < 1 || settings.defaultEffort > 7) {
            return "defaultEffort must be integer 1-7";
        }
    }
    if (settings.lastReviewAt !== undefined) {
        if (
            typeof settings.lastReviewAt !== "string" ||
            (settings.lastReviewAt !== "" && Number.isNaN(Date.parse(settings.lastReviewAt)))
        ) {
            return "lastReviewAt must be empty or a valid date-time string";
        }
    }
    const pe = settings.priorityEngine;
    if (pe) {
        const weightSum = (pe.dueWeight ?? 0) + (pe.startWeight ?? 0) + (pe.importanceWeight ?? 0);
        if (Math.abs(weightSum - 1.0) > 0.01) {
            return "dueWeight + startWeight + importanceWeight must equal 1.0";
        }
        if (pe.dueDecayTau !== undefined && (pe.dueDecayTau < 1 || pe.dueDecayTau > 30)) {
            return "dueDecayTau must be 1-30";
        }
        if (pe.startHorizon !== undefined && (pe.startHorizon < 1 || pe.startHorizon > 60)) {
            return "startHorizon must be 1-60";
        }
        if (pe.effortScale !== undefined && (pe.effortScale < 0 || pe.effortScale > 0.5)) {
            return "effortScale must be 0-0.5";
        }
        if (
            pe.startPreviewDays !== undefined &&
            (!Number.isInteger(pe.startPreviewDays) || pe.startPreviewDays < 0 || pe.startPreviewDays > 14)
        ) {
            return "startPreviewDays must be integer 0-14";
        }
    }
    if (settings.myDayResetHour !== undefined) {
        if (!Number.isInteger(settings.myDayResetHour) || settings.myDayResetHour < 0 || settings.myDayResetHour > 23) {
            return "myDayResetHour must be integer 0-23";
        }
    }
    if (settings.myDayDefaultViewMode !== undefined) {
        if (settings.myDayDefaultViewMode !== "timeline" && settings.myDayDefaultViewMode !== "list") {
            return "myDayDefaultViewMode must be 'timeline' or 'list'";
        }
    }
    if (settings.myDayDefaultDuration !== undefined) {
        if (
            !Number.isInteger(settings.myDayDefaultDuration) ||
            settings.myDayDefaultDuration < 15 ||
            settings.myDayDefaultDuration > 480
        ) {
            return "myDayDefaultDuration must be integer 15-480";
        }
    }
    if (settings.customFields) {
        const error = validateCustomFieldDefinitions(settings.customFields);
        if (error) return error;
    }
    const rs = settings.reminderSettings;
    if (rs) {
        if (rs.enabled !== undefined && typeof rs.enabled !== "boolean") {
            return "reminderSettings.enabled must be boolean";
        }
        if (rs.defaultOffsets !== undefined) {
            if (!Array.isArray(rs.defaultOffsets)) {
                return "reminderSettings.defaultOffsets must be an array";
            }
            if (rs.defaultOffsets.length > 10) {
                return "reminderSettings.defaultOffsets must have at most 10 items";
            }
            for (const v of rs.defaultOffsets) {
                if (!Number.isInteger(v) || v < 1 || v > 20160) {
                    return "reminderSettings.defaultOffsets items must be positive integers <= 20160 (14 days)";
                }
            }
            const unique = new Set(rs.defaultOffsets);
            if (unique.size !== rs.defaultOffsets.length) {
                return "reminderSettings.defaultOffsets must not contain duplicates";
            }
        }
        if (rs.dueSound !== undefined && (REMINDER_SOUND_IDS as readonly string[]).indexOf(rs.dueSound) === -1) {
            return "reminderSettings.dueSound must be one of: " + REMINDER_SOUND_IDS.join(", ");
        }
        if (rs.reviewSound !== undefined && (REMINDER_SOUND_IDS as readonly string[]).indexOf(rs.reviewSound) === -1) {
            return "reminderSettings.reviewSound must be one of: " + REMINDER_SOUND_IDS.join(", ");
        }
        if (rs.soundEnabled !== undefined && typeof rs.soundEnabled !== "boolean") {
            return "reminderSettings.soundEnabled must be boolean";
        }
        if (rs.systemNotificationEnabled !== undefined && typeof rs.systemNotificationEnabled !== "boolean") {
            return "reminderSettings.systemNotificationEnabled must be boolean";
        }
    }
    const mcpError = validateMcpSettings(settings.mcpSettings);
    if (mcpError) return mcpError;
    const taskCreationError = validateTaskCreationSettings(settings.taskCreationSettings);
    if (taskCreationError) return taskCreationError;
    const ai = settings.aiSettings;
    if (ai !== undefined) {
        if (!ai.prompts || typeof ai.prompts !== "object" || Array.isArray(ai.prompts)) {
            return "aiSettings.prompts must be an object";
        }
        for (const feature of ["extractTasks", "decomposeTask", "planMyDay", "review"] as const) {
            const prompt = ai.prompts[feature];
            if (prompt === undefined) continue;
            if (typeof prompt !== "string") return `aiSettings.prompts.${feature} must be a string`;
            if (prompt.length > 12000) return `aiSettings.prompts.${feature} must be <= 12000 characters`;
        }
    }
    return null;
}

export function mergeSettings(base: PluginSettings, override: Partial<PluginSettings>): PluginSettings {
    const incomingPrompts: Partial<Record<AiFeatureId, string>> = override.aiSettings?.prompts ?? {};
    const mergedPrompts = { ...base.aiSettings.prompts, ...incomingPrompts };
    return {
        defaultImportance: override.defaultImportance ?? base.defaultImportance,
        defaultEffort: override.defaultEffort ?? base.defaultEffort,
        semanticDateParsingEnabled: override.semanticDateParsingEnabled ?? base.semanticDateParsingEnabled,
        priorityEngine: {
            ...base.priorityEngine,
            ...(override.priorityEngine ?? {}),
        },
        myDayResetHour: override.myDayResetHour ?? base.myDayResetHour,
        myDayDefaultViewMode: override.myDayDefaultViewMode ?? base.myDayDefaultViewMode,
        myDayDefaultDuration: override.myDayDefaultDuration ?? base.myDayDefaultDuration,
        lastReviewAt: override.lastReviewAt ?? base.lastReviewAt,
        customFields: (override.customFields ?? base.customFields).map((field) => ({
            ...field,
            scope:
                field.scope.mode === "projectTree"
                    ? { ...field.scope, projectIds: [...field.scope.projectIds] }
                    : { ...field.scope },
            ...(field.options ? { options: field.options.map((option) => ({ ...option })) } : {}),
        })),
        reminderSettings: {
            ...base.reminderSettings,
            ...(override.reminderSettings ?? {}),
        },
        mcpSettings: mergeMcpSettings(base.mcpSettings || DEFAULT_MCP_SETTINGS, override.mcpSettings),
        taskCreationSettings: mergeTaskCreationSettings(
            base.taskCreationSettings || DEFAULT_TASK_CREATION_SETTINGS,
            override.taskCreationSettings,
        ),
        aiSettings: {
            ...base.aiSettings,
            ...(override.aiSettings ?? {}),
            prompts: mergedPrompts,
        },
    };
}
