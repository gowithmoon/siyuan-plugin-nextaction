export type TaskBlockedReason = "" | "inbox" | "someday" | "children" | "dependency" | "sequential";
export type TaskActionKind = "" | "action" | "stage";

export interface TaskCacheEntry {
    blockId: string;
    identificationSource: "document" | "native";
    contentBlockId?: string;
    attrHostId: string;
    parentId: string;
    status: string;
    priority: string;
    importance: number;
    effort: number;
    due: string;
    start: string;
    context: string;
    taskType: string;
    order: number;
    childIds: string[];
    title: string;
    depends: string; // na-depends 原始值
    depMode: string; // na-dep-mode，默认 "all"
    sequential: boolean; // na-sequential === "1"
    repeat: string; // na-repeat 原始值
    repeatState: string; // na-repeat-state 原始值
    sort: number; // na-sort 转数字，默认 -1（表示未设置）
    completed: string; // na-completed 原始值
    note: string; // na-note 原始值
    outcome: string; // na-outcome，Project 的单行预期结果
    dod: string; // na-dod，Project 的多行完成判定
    actionKind: TaskActionKind; // Project 为空；Project 祖先链内的普通任务为 action/stage
    created: string; // na-created 原始值 (YYYY-MM-DDTHH:mm:ss)
    updated?: string; // 思源块更新时间，用于稳定的完成任务排序回退
    tags: string; // na-tags 原始值（管道符分隔）
    blocked: boolean; // 由内核 isBlocked 计算
    blockedReason: TaskBlockedReason;
    reviewInterval: number; // 0 = 不回顾
    reviewDate: string; // 空字符串 = 无，YYYY-MM-DD
    reminder: string; // na-reminder 原始值，空字符串 = 继承全局提醒设置（启用默认提醒时使用全局默认），"[]" = 禁用
    customFields: Record<string, string>; // 自定义字段值 {key: value}
    /** Non-fatal write warning returned after the authoritative state is stored. */
    _warning?: "sequentialConflict" | "projectReopened";
}

export interface CompletedTasksPage {
    items: TaskCacheEntry[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
}

export type ProjectHealth = "onTrack" | "attention" | "blocked" | "complete";

export type ProjectRiskKind = "overdue" | "dueSoon" | "blocked" | "noNextAction" | "empty" | "waiting";

export interface ProjectRisk {
    kind: ProjectRiskKind;
    taskId: string;
    severity: "high" | "medium" | "low";
}

export interface ProjectProgress {
    done: number;
    total: number;
    percent: number;
}

export interface ProjectSummary {
    project: TaskCacheEntry;
    descendants: TaskCacheEntry[];
    leafActions: TaskCacheEntry[];
    subtreeProgress: Record<string, ProjectProgress>;
    empty: boolean;
    clarificationNeeded: boolean;
    completionCandidate: boolean;
    incompleteNonLeafActions: TaskCacheEntry[];
    openCount: number;
    doneCount: number;
    progress: number;
    nextActions: TaskCacheEntry[];
    overdueTasks: TaskCacheEntry[];
    blockedTasks: TaskCacheEntry[];
    waitingTasks: TaskCacheEntry[];
    risks: ProjectRisk[];
    health: ProjectHealth;
}

export interface ProjectControlRisk extends ProjectRisk {
    projectId: string;
    targetKind: "project" | "action";
    target: TaskCacheEntry;
}

export interface ProjectControlProject {
    summary: ProjectSummary;
    risks: ProjectControlRisk[];
}

export interface ProjectControlSelection {
    projectId: string;
    taskId: string;
}

export interface ProjectControlState {
    tasks: TaskCacheEntry[];
    projects: ProjectControlProject[];
    risks: ProjectControlRisk[];
    selection: ProjectControlSelection;
    selectedProject: ProjectControlProject | null;
    selectedTask: TaskCacheEntry | null;
}

export type ProjectSupportDirection = "forward" | "backlink";

export interface ProjectSupportItem {
    blockId: string;
    documentId: string;
    title: string;
    kind: "block" | "document";
    blockType: string;
    directions: ProjectSupportDirection[];
}

export interface ProjectSupportData {
    projectId: string;
    items: ProjectSupportItem[];
}

export type ProjectReviewTrigger = "schedule" | "risk" | "completionCandidate" | "manual";
export type ProjectReviewSchedule = "none" | "due" | "overdue";

export interface ProjectReviewItem {
    summary: ProjectSummary;
    risks: ProjectControlRisk[];
    triggers: ProjectReviewTrigger[];
    schedule: ProjectReviewSchedule;
}

export interface ReminderRelative {
    type: "relative";
    minutes: number;
}

export interface ReminderAbsolute {
    type: "absolute";
    time: string; // "YYYY-MM-DDTHH:mm"
}

export type ReminderItem = ReminderRelative | ReminderAbsolute;

export interface ReminderSummaryData {
    overdue: number; // 已逾期任务数
    dueToday: number; // 今日到期任务数
    startingToday: number; // 今日开始任务数（start date 为今天）
    nextAction: number; // 下一步行动任务数
    waiting: number; // 等待中任务数
}

export interface ReminderEntry {
    blockId: string;
    title: string;
    triggerTime: number; // 实际触发时间戳（ms）
    type: "due" | "review" | "absolute" | "summary"; // 截止提醒 or 回顾提醒 or 固定时间提醒 or 汇总
    minutesBefore: number; // 提前了多少分钟（review 类型固定为 0）
    baseDateStr: string; // 触发基准日期字符串（due 的日期 or reviewDate）
    dueTime: number; // 截止时间戳（ms），用于计算实际剩余/逾期
    dismissed: boolean; // 用户是否已处理
    summary?: ReminderSummaryData; // type=summary 时的统计数据
}

export interface DismissedRecord {
    [dedupKey: string]: number; // 去重键 → dismissed 时间戳
}

export interface TaskSnapshotV2 {
    schema: 2;
    streamId: string;
    revision: number;
    tasks: TaskCacheEntry[];
}

export interface TaskDeltaChangeSetV2 {
    schema: 2;
    type: "delta";
    streamId: string;
    fromRevision: number;
    revision: number;
    upserts: TaskCacheEntry[];
    deletedBlockIds: string[];
}

export interface TaskResetChangeSetV2 {
    schema: 2;
    type: "reset";
    streamId: string;
    revision: number;
}

export type TaskChangeSetV2 = TaskDeltaChangeSetV2 | TaskResetChangeSetV2;

export interface StatisticsSummary {
    total: number;
    open: number; // 未完成任务数（status ≠ done）
    nextAction: number; // 下一步行动候选数
    someday: number; // 将来/也许任务数
    overdue: number; // 逾期未完成任务数（due < today 且 status ≠ done）
    completedInPeriod: number;
    completionRate: number; // 完成率 0-100
}

export interface StatisticsDistribution {
    key: string;
    count: number;
    percent: number;
}

export interface StatisticsContextItem {
    context: string;
    count: number;
}

export interface StatisticsProjectStatus {
    status: string; // "inbox" | "todo" | "doing" | "waiting" | "someday" | "done"
    count: number;
    percent: number;
}

export interface StatisticsResult {
    summary: StatisticsSummary;
    statusDistribution: StatisticsDistribution[];
    priorityDistribution: StatisticsDistribution[];
    contextDistribution: StatisticsContextItem[];
    projectStatus: StatisticsProjectStatus[];
}

export interface MyDayTaskEntry {
    blockId: string;
    addedAt: number;
    scheduleStart: number | null;
    scheduleEnd: number | null;
    order: number;
    completedAt?: number;
}

export interface MyDayState {
    schema: 1;
    dayKey: string;
    tasks: MyDayTaskEntry[];
    updatedAt: number;
}

export interface ReviewData {
    lastReviewAt: string;
    overdueTasks: TaskCacheEntry[];
    nextActions: TaskCacheEntry[];
    inboxTasks: TaskCacheEntry[];
    waitingTasks: TaskCacheEntry[];
    somedayTasks: TaskCacheEntry[];
    reviewDueTasks: TaskCacheEntry[];
    projectReviews: ProjectReviewItem[];
    reviewableProjects: ProjectSummary[];
}

export type { PluginSettings, PriorityEngineSettings } from "./settings";
