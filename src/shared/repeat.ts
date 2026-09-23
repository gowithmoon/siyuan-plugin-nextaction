export type RepeatFrequency = "day" | "week" | "month" | "year";
export type RepeatBasis = "schedule" | "completion";
export type RepeatOverflow = "lastDay" | "skip";
export type RepeatMissedPolicy = "nextFuture" | "catchUp";
export type RepeatStatus = "active" | "paused" | "ended";
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type RepeatMonthlyPattern =
    | { type: "dayOfMonth"; day: number }
    | { type: "lastDay" }
    | { type: "nthWeekday"; nth: 1 | 2 | 3 | 4 | -1; weekday: IsoWeekday };

export type RepeatEnd = { type: "never" } | { type: "count"; count: number } | { type: "date"; date: string };

export interface RepeatRuleV2 {
    version: 2;
    frequency: RepeatFrequency;
    interval: number;
    basis: RepeatBasis;
    weekdays?: IsoWeekday[];
    monthly?: RepeatMonthlyPattern;
    overflow: RepeatOverflow;
    missedPolicy: RepeatMissedPolicy;
    end: RepeatEnd;
}

export interface RepeatStateV1 {
    version: 1;
    anchorStart: string;
    anchorDue: string;
    currentStart: string;
    currentDue: string;
    processed: number;
    status: RepeatStatus;
}

export interface RepeatAdvanceResult {
    state: RepeatStateV1;
    ended: boolean;
}

export interface RepeatOccurrencePreview {
    start: string;
    due: string;
}

interface LegacyRepeatRule {
    freq?: unknown;
    interval?: unknown;
    from?: unknown;
}

const FREQUENCIES: RepeatFrequency[] = ["day", "week", "month", "year"];
const BASES: RepeatBasis[] = ["schedule", "completion"];
const OVERFLOWS: RepeatOverflow[] = ["lastDay", "skip"];
const MISSED_POLICIES: RepeatMissedPolicy[] = ["nextFuture", "catchUp"];
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SEARCH_DAYS = 7 * 1000 + 14;
const MAX_ADVANCE_STEPS = 20000;

function isRecord(value: unknown): value is Record<string, any> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function isDateValue(value: unknown): value is string {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(value)) return false;
    const parsed = parseDateValue(value);
    return !Number.isNaN(parsed.getTime()) && formatDatePart(parsed) === value.slice(0, 10);
}

function normalizeEnd(value: unknown): RepeatEnd | null {
    if (value === undefined) return { type: "never" };
    if (!isRecord(value)) return null;
    if (value.type === "never") return { type: "never" };
    if (value.type === "count" && Number.isInteger(value.count) && value.count >= 1 && value.count <= 99999) {
        return { type: "count", count: value.count };
    }
    if (value.type === "date" && isDateValue(value.date) && !value.date.includes("T")) {
        return { type: "date", date: value.date };
    }
    return null;
}

function normalizeMonthly(value: unknown): RepeatMonthlyPattern | null | undefined {
    if (value === undefined) return undefined;
    if (!isRecord(value)) return null;
    if (value.type === "lastDay") return { type: "lastDay" };
    if (value.type === "dayOfMonth" && Number.isInteger(value.day) && value.day >= 1 && value.day <= 31) {
        return { type: "dayOfMonth", day: value.day };
    }
    if (
        value.type === "nthWeekday" &&
        [1, 2, 3, 4, -1].includes(value.nth) &&
        Number.isInteger(value.weekday) &&
        value.weekday >= 1 &&
        value.weekday <= 7
    ) {
        return { type: "nthWeekday", nth: value.nth, weekday: value.weekday } as RepeatMonthlyPattern;
    }
    return null;
}

export function normalizeRepeatRule(value: unknown): RepeatRuleV2 | null {
    if (!isRecord(value)) return null;

    const legacy = value as LegacyRepeatRule;
    const frequency = value.version === 2 ? value.frequency : legacy.freq;
    const basis =
        value.version === 2 ? (value.basis ?? "schedule") : legacy.from === "complete" ? "completion" : "schedule";
    const interval = value.interval;

    if (!FREQUENCIES.includes(frequency as RepeatFrequency)) return null;
    if (!Number.isInteger(interval) || interval < 1 || interval > 999) return null;
    if (!BASES.includes(basis as RepeatBasis)) return null;

    const overflow = value.version === 2 ? (value.overflow ?? "lastDay") : "lastDay";
    const missedPolicy = value.version === 2 ? (value.missedPolicy ?? "nextFuture") : "nextFuture";
    if (!OVERFLOWS.includes(overflow)) return null;
    if (!MISSED_POLICIES.includes(missedPolicy)) return null;

    let weekdays: IsoWeekday[] | undefined;
    if (frequency !== "week" && value.weekdays !== undefined) return null;
    if (value.weekdays !== undefined) {
        if (!Array.isArray(value.weekdays) || value.weekdays.length === 0) return null;
        const unique = [...new Set(value.weekdays)].sort((a, b) => a - b);
        if (unique.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) return null;
        weekdays = unique as IsoWeekday[];
    }

    if (frequency !== "month" && value.monthly !== undefined) return null;
    const monthly = normalizeMonthly(value.monthly);
    if (monthly === null) return null;
    const end = normalizeEnd(value.end);
    if (!end) return null;

    const result: RepeatRuleV2 = {
        version: 2,
        frequency: frequency as RepeatFrequency,
        interval,
        basis: basis as RepeatBasis,
        overflow,
        missedPolicy,
        end,
    };
    if (weekdays) result.weekdays = weekdays;
    if (monthly) result.monthly = monthly;
    return result;
}

export function parseRepeatRule(json: string): RepeatRuleV2 | null {
    try {
        return normalizeRepeatRule(JSON.parse(json));
    } catch {
        return null;
    }
}

export function normalizeRepeatState(value: unknown): RepeatStateV1 | null {
    if (!isRecord(value) || value.version !== 1) return null;
    if (!["active", "paused", "ended"].includes(value.status)) return null;
    if (!Number.isInteger(value.processed) || value.processed < 0) return null;
    for (const key of ["anchorStart", "anchorDue", "currentStart", "currentDue"] as const) {
        if (value[key] !== "" && !isDateValue(value[key])) return null;
    }
    if (!value.currentStart && !value.currentDue) return null;
    return {
        version: 1,
        anchorStart: value.anchorStart,
        anchorDue: value.anchorDue,
        currentStart: value.currentStart,
        currentDue: value.currentDue,
        processed: value.processed,
        status: value.status,
    };
}

export function parseRepeatState(json: string): RepeatStateV1 | null {
    try {
        return normalizeRepeatState(JSON.parse(json));
    } catch {
        return null;
    }
}

export function createRepeatState(_rule: RepeatRuleV2, start: string, due: string): RepeatStateV1 | null {
    if ((!start && !due) || (start && !isDateValue(start)) || (due && !isDateValue(due))) return null;
    return {
        version: 1,
        anchorStart: start,
        anchorDue: due,
        currentStart: start,
        currentDue: due,
        processed: 0,
        status: "active",
    };
}

function parseDateValue(value: string): Date {
    const [datePart, timePart] = value.split("T");
    const [year, month, day] = datePart.split("-").map(Number);
    const [hour, minute] = timePart ? timePart.split(":").map(Number) : [0, 0];
    return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function pad(value: number): string {
    return String(value).padStart(2, "0");
}

function formatDatePart(date: Date): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatLike(date: Date, template: string): string {
    const datePart = formatDatePart(date);
    if (!template.includes("T")) return datePart;
    return `${datePart}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function addDays(value: string, days: number): string {
    const date = parseDateValue(value);
    date.setDate(date.getDate() + days);
    return formatLike(date, value);
}

function addMilliseconds(value: string, milliseconds: number): string {
    const date = parseDateValue(value);
    date.setTime(date.getTime() + milliseconds);
    return formatLike(date, value);
}

function startOfIsoWeek(date: Date): Date {
    const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const isoDay = copy.getDay() === 0 ? 7 : copy.getDay();
    copy.setDate(copy.getDate() - isoDay + 1);
    return copy;
}

function calendarDayNumber(date: Date): number {
    return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}

function isoWeekday(date: Date): IsoWeekday {
    return (date.getDay() === 0 ? 7 : date.getDay()) as IsoWeekday;
}

function daysInMonth(year: number, monthIndex: number): number {
    return new Date(year, monthIndex + 1, 0).getDate();
}

function makeMonthOccurrence(
    year: number,
    monthIndex: number,
    template: string,
    pattern: RepeatMonthlyPattern,
    overflow: RepeatOverflow,
): string | null {
    const source = parseDateValue(template);
    let day: number;
    const lastDay = daysInMonth(year, monthIndex);

    if (pattern.type === "lastDay") {
        day = lastDay;
    } else if (pattern.type === "dayOfMonth") {
        if (pattern.day > lastDay && overflow === "skip") return null;
        day = Math.min(pattern.day, lastDay);
    } else if (pattern.nth === -1) {
        const last = new Date(year, monthIndex, lastDay, source.getHours(), source.getMinutes());
        const distance = (isoWeekday(last) - pattern.weekday + 7) % 7;
        day = lastDay - distance;
    } else {
        const first = new Date(year, monthIndex, 1, source.getHours(), source.getMinutes());
        const distance = (pattern.weekday - isoWeekday(first) + 7) % 7;
        day = 1 + distance + (pattern.nth - 1) * 7;
        if (day > lastDay) return null;
    }

    const result = new Date(year, monthIndex, day, source.getHours(), source.getMinutes());
    return formatLike(result, template);
}

function getNextScheduled(current: string, rule: RepeatRuleV2, anchor: string): string {
    if (rule.frequency === "day") return addDays(current, rule.interval);

    if (rule.frequency === "week") {
        if (!rule.weekdays?.length) return addDays(current, rule.interval * 7);
        const anchorWeek = startOfIsoWeek(parseDateValue(anchor));
        for (let offset = 1; offset <= MAX_SEARCH_DAYS; offset++) {
            const candidate = addDays(current, offset);
            const candidateDate = parseDateValue(candidate);
            if (!rule.weekdays.includes(isoWeekday(candidateDate))) continue;
            const candidateWeek = startOfIsoWeek(candidateDate);
            const diffWeeks = Math.floor((calendarDayNumber(candidateWeek) - calendarDayNumber(anchorWeek)) / 7);
            if (diffWeeks >= 0 && diffWeeks % rule.interval === 0) return candidate;
        }
        throw new Error("Unable to find next weekly occurrence");
    }

    if (rule.frequency === "month") {
        const currentDate = parseDateValue(current);
        const anchorDate = parseDateValue(anchor);
        const pattern = rule.monthly ?? { type: "dayOfMonth", day: anchorDate.getDate() };
        for (let step = 1; step <= 1200; step++) {
            const absoluteMonth = currentDate.getFullYear() * 12 + currentDate.getMonth() + rule.interval * step;
            const year = Math.floor(absoluteMonth / 12);
            const monthIndex = absoluteMonth % 12;
            const result = makeMonthOccurrence(year, monthIndex, anchor, pattern, rule.overflow);
            if (result) return result;
        }
        throw new Error("Unable to find next monthly occurrence");
    }

    const currentDate = parseDateValue(current);
    const anchorDate = parseDateValue(anchor);
    for (let step = 1; step <= 1000; step++) {
        const year = currentDate.getFullYear() + rule.interval * step;
        const monthIndex = anchorDate.getMonth();
        const targetDay = anchorDate.getDate();
        const lastDay = daysInMonth(year, monthIndex);
        if (targetDay > lastDay && rule.overflow === "skip") continue;
        const result = new Date(
            year,
            monthIndex,
            Math.min(targetDay, lastDay),
            anchorDate.getHours(),
            anchorDate.getMinutes(),
        );
        return formatLike(result, anchor);
    }
    throw new Error("Unable to find next yearly occurrence");
}

function withActionDateAndTemplateTime(actionDate: string, template: string): string {
    const datePart = actionDate.slice(0, 10);
    return template.includes("T") ? `${datePart}T${template.split("T")[1]}` : datePart;
}

function isAfter(left: string, right: string): boolean {
    return parseDateValue(left).getTime() > parseDateValue(right).getTime();
}

function endState(state: RepeatStateV1, processed: number): RepeatAdvanceResult {
    return {
        state: { ...state, processed, status: "ended" },
        ended: true,
    };
}

export function advanceRepeatState(
    rule: RepeatRuleV2,
    state: RepeatStateV1,
    actionDate: string,
    _action: "complete" | "skip",
): RepeatAdvanceResult {
    if (state.status === "ended") return { state, ended: true };
    if (!isDateValue(actionDate)) throw new Error("Invalid repeat action date");

    const processed = state.processed + 1;
    if (rule.end.type === "count" && processed >= rule.end.count) return endState(state, processed);

    const driverIsDue = !!state.currentDue;
    const currentDriver = driverIsDue ? state.currentDue : state.currentStart;
    const anchorDriver = driverIsDue ? state.anchorDue : state.anchorStart;
    let nextDriver: string;

    if (rule.basis === "completion") {
        const completionBase = withActionDateAndTemplateTime(actionDate, currentDriver);
        nextDriver = getNextScheduled(completionBase, rule, completionBase);
    } else {
        nextDriver = getNextScheduled(currentDriver, rule, anchorDriver || currentDriver);
        if (rule.missedPolicy === "nextFuture") {
            let steps = 0;
            while (!isAfter(nextDriver, actionDate)) {
                nextDriver = getNextScheduled(nextDriver, rule, anchorDriver || currentDriver);
                steps++;
                if (steps > MAX_ADVANCE_STEPS) throw new Error("Unable to advance repeat rule into the future");
            }
        }
    }

    if (rule.end.type === "date" && nextDriver.slice(0, 10) > rule.end.date) {
        return endState(state, processed);
    }

    let currentStart = "";
    let currentDue = "";
    if (driverIsDue) {
        currentDue = nextDriver;
        if (state.currentStart) {
            if (rule.basis === "completion") {
                const lead = parseDateValue(state.currentDue).getTime() - parseDateValue(state.currentStart).getTime();
                let nextStart = addMilliseconds(nextDriver, -lead);
                if (parseDateValue(nextStart).getTime() < parseDateValue(actionDate).getTime()) {
                    nextStart = formatLike(parseDateValue(actionDate), state.currentStart);
                }
                currentStart = nextStart;
            } else {
                const shift = parseDateValue(nextDriver).getTime() - parseDateValue(state.currentDue).getTime();
                currentStart = addMilliseconds(state.currentStart, shift);
            }
        }
    } else {
        currentStart = nextDriver;
    }

    return {
        state: {
            ...state,
            currentStart,
            currentDue,
            processed,
            status: state.status === "paused" ? "paused" : "active",
        },
        ended: false,
    };
}

export function previewRepeatOccurrences(
    rule: RepeatRuleV2,
    start: string,
    due: string,
    count = 5,
): RepeatOccurrencePreview[] {
    if (count < 1) return [];
    let state = createRepeatState(rule, start, due);
    if (!state) return [];

    const result: RepeatOccurrencePreview[] = [];
    while (result.length < count) {
        const driver = state.currentDue || state.currentStart;
        const advanced = advanceRepeatState(rule, state, driver, "complete");
        if (advanced.ended) break;
        state = advanced.state;
        result.push({ start: state.currentStart, due: state.currentDue });
    }
    return result;
}
