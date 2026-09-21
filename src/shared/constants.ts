export const TASK_TYPE_TASK = "1";
export const TASK_TYPE_PROJECT = "2";

export const STATUS_INBOX = "inbox";
export const STATUS_TODO = "todo";
export const STATUS_DOING = "doing";
export const STATUS_WAITING = "waiting";
export const STATUS_SOMEDAY = "someday";
export const STATUS_DONE = "done";
export const ALL_STATUSES = [
    STATUS_INBOX,
    STATUS_TODO,
    STATUS_DOING,
    STATUS_WAITING,
    STATUS_SOMEDAY,
    STATUS_DONE,
] as const;

export const PRIORITY_CRITICAL = "critical";
export const PRIORITY_HIGH = "high";
export const PRIORITY_MEDIUM = "medium";
export const PRIORITY_LOW = "low";
export const PRIORITY_VERY_LOW = "veryLow";
export const PRIORITY_NONE = "none";

export const PRIORITY_WEIGHTS: Record<string, number> = {
    [PRIORITY_CRITICAL]: 5,
    [PRIORITY_HIGH]: 4,
    [PRIORITY_MEDIUM]: 3,
    [PRIORITY_LOW]: 2,
    [PRIORITY_VERY_LOW]: 1,
    [PRIORITY_NONE]: 1,
};

export const ATTR_PREFIX = "custom-na-";
export const ATTR_EXT_PREFIX = "custom-na-ext-";
export const ATTR_TASK = "custom-na-task";
export const ATTR_STATUS = "custom-na-status";
export const ATTR_PRIORITY = "custom-na-priority";
export const ATTR_DUE = "custom-na-due";
export const ATTR_START = "custom-na-start";
export const ATTR_CONTEXT = "custom-na-context";
export const ATTR_EFFORT = "custom-na-effort";
export const ATTR_IMPORTANCE = "custom-na-importance";
export const ATTR_PARENT = "custom-na-parent";
export const ATTR_DEPENDS = "custom-na-depends";
export const ATTR_DEP_MODE = "custom-na-dep-mode";
export const ATTR_SEQUENTIAL = "custom-na-sequential";
export const ATTR_REPEAT = "custom-na-repeat";
export const ATTR_REPEAT_STATE = "custom-na-repeat-state";
export const ATTR_SORT = "custom-na-sort";
export const ATTR_COMPLETED = "custom-na-completed";
export const ATTR_NOTE = "custom-na-note";
export const ATTR_CREATED = "custom-na-created";
export const ATTR_TAGS = "custom-na-tags";
export const ATTR_REVIEW_INTERVAL = "custom-na-review-interval";
export const ATTR_REVIEW_DATE = "custom-na-review-date";
export const ATTR_REMINDER = "custom-na-reminder";
export const ATTR_OUTCOME = "custom-na-outcome";
export const ATTR_DOD = "custom-na-dod";
export const ATTR_KIND = "custom-na-kind";
export const ACTION_KIND_ACTION = "action";
export const ACTION_KIND_STAGE = "stage";
export const TASK_WARNING_PROJECT_REOPENED = "projectReopened";
export const REMINDER_MAX_PER_TASK = 7;
export const REMINDER_DATA_PATH = "dismissed-reminders.json";

// 提醒扫描间隔（毫秒）
export const REMINDER_SCAN_INTERVAL_MS = 30000;

// 回顾提醒触发时间（小时，24小时制）
export const REMINDER_REVIEW_HOUR = 9;

// 通知浮层最大显示数量
export const REMINDER_MAX_VISIBLE = 5;

// dismissed 记录 TTL（毫秒，7天）
export const REMINDER_DISMISSED_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// 可用音效 ID 列表
export const REMINDER_SOUND_IDS = ["chime", "soft", "bell", "ping", "gentle"] as const;
export type ReminderSoundId = (typeof REMINDER_SOUND_IDS)[number];

export const DEFAULT_IMPORTANCE = 4;
export const DEFAULT_EFFORT = 4;

export const RPC_ERROR_INVALID_PARAMS = -32001;
export const RPC_ERROR_TASK_NOT_FOUND = -32002;
export const RPC_ERROR_CIRCULAR_REF = -32003;
export const RPC_ERROR_NOT_READY = -32005;
export const RPC_ERROR_TIMEOUT = -32006;
export const RPC_ERROR_DEP_CYCLE = -32007;
export const RPC_ERROR_NOT_TEXT_BLOCK = -32008;
export const RPC_ERROR_PROJECT_REQUIRES_DOCUMENT = -32009;
export const RPC_ERROR_ACTION_MOVE_NOT_MOVED = -32010;
export const RPC_ERROR_ACTION_MOVE_RECOVERED = -32011;
export const RPC_ERROR_ACTION_MOVE_RECOVERY_FAILED = -32012;
export const RPC_ERROR_ACTION_MOVE_TARGET_CHANGED = -32013;
export const RPC_ERROR_ACTION_MOVE_UNDO_INVALID = -32014;
export const RPC_ERROR_ACTION_MOVE_UNDO_UNSAFE = -32015;
export const RPC_ERROR_PROJECT_BOARD_MOVE_INVALID_TARGET = -32016;
export const RPC_ERROR_INTERNAL = -32000;

export const BROADCAST_DEBOUNCE_MS = 100;
export const WRITE_LOCK_TIMEOUT_MS = 10000;

export const MY_DAY_DATA_PATH = "my-day-v1.json";
export const DEFAULT_MY_DAY_RESET_HOUR = 5;
export const DEFAULT_MY_DAY_VIEW_MODE = "timeline";
export const DEFAULT_MY_DAY_DURATION = 60;

export const TIMELINE_SLOT_MINUTES = 30;
export const DRAG_SNAP_MINUTES = 15;
export const DEFAULT_SCHEDULE_DURATION = 60;
export const MIN_SCHEDULE_DURATION = 15;
export const MAX_SCHEDULE_DURATION = 720;
export const PIXELS_PER_MINUTE = 1.2;
export const UNSCHEDULED_PANEL_WIDTH = 220;
export const RESPONSIVE_BREAKPOINT = 500;
export const SIYUAN_DROP_BLOCK_REF = "application/siyuan-block-ref";
export const MY_DAY_DRAG_TYPE = "application/x-na-my-day-task";
export const RESIZE_HANDLE_HEIGHT = 6;
export const CLICK_THRESHOLD_PX = 5;
export const REVIEW_INTERVAL_PRESETS = [7, 14, 30, 60, 90] as const;

export const DAY_MINUTES = 1440;
