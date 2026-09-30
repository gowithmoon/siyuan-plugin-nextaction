import { PROJECT_BOARD_STATUSES } from "../shared/project-board";

export const PRIORITY_COLORS: Record<string, string> = {
    critical: "var(--na-priority-critical)",
    high: "var(--na-priority-high)",
    medium: "var(--na-priority-medium)",
    low: "var(--na-priority-low)",
    veryLow: "var(--na-priority-very-low)",
    none: "var(--na-priority-very-low)",
};

export function normalizePriority(priority: string | null | undefined): string {
    if (!priority) return "medium";
    if (priority === "none") return "veryLow";
    return priority;
}

export const VIEW_INBOX = "inbox";
export const VIEW_SOMEDAY = "someday";
export const VIEW_WAITING = "waiting";
export const VIEW_MY_DAY = "myDay";
export const VIEW_NEXT_ACTION = "nextAction";
export const VIEW_ALL_TASKS = "all";
export const VIEW_BY_PROJECT = "byProject";
export const VIEW_STATISTICS = "statistics";
export const VIEW_REVIEW = "review";
export type ViewType =
    | typeof VIEW_INBOX
    | typeof VIEW_NEXT_ACTION
    | typeof VIEW_ALL_TASKS
    | typeof VIEW_BY_PROJECT
    | typeof VIEW_SOMEDAY
    | typeof VIEW_WAITING
    | typeof VIEW_MY_DAY
    | typeof VIEW_STATISTICS
    | typeof VIEW_REVIEW;

export const STATUS_LIST = PROJECT_BOARD_STATUSES;
export const PRIORITY_LIST = ["critical", "high", "medium", "low", "veryLow"] as const;
