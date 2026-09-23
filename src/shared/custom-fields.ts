import type { TaskCacheEntry } from "./types";
import { isProjectTask } from "./project-domain";
import type { ProjectMembershipGraph } from "./project-membership-graph";

export const CUSTOM_FIELD_TYPES = [
    "text",
    "textarea",
    "number",
    "boolean",
    "date",
    "datetime",
    "singleSelect",
    "multiSelect",
    "url",
] as const;

export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];
export type CustomFieldStatus = "active" | "archived";
export type CustomFieldTaskType = "task" | "project";

export type CustomFieldScope =
    { mode: "all" } | { mode: "task" } | { mode: "project" } | { mode: "projectTree"; projectIds: string[] };

export interface CustomFieldOption {
    id: string;
    label: string;
    status: CustomFieldStatus;
}

export interface CustomFieldDef {
    version: 2;
    id: string;
    key: string;
    label: string;
    description: string;
    type: CustomFieldType;
    status: CustomFieldStatus;
    scope: CustomFieldScope;
    showOnCard: boolean;
    options?: CustomFieldOption[];
}

export type CustomFieldInput = string | number | boolean | string[] | null;

export const RESERVED_CUSTOM_FIELD_KEYS = new Set(["outcome", "dod", "kind"]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function isCustomFieldType(value: unknown): value is CustomFieldType {
    return typeof value === "string" && (CUSTOM_FIELD_TYPES as readonly string[]).includes(value);
}

export function isValidCustomFieldKey(key: string): boolean {
    return /^[a-z][a-z0-9-]*$/.test(key);
}

export function normalizeCustomFieldKey(key: string): string {
    return key.trim().toLowerCase();
}

function stableId(seed: string): string {
    const safe = seed
        .replace(/[^a-z0-9-]/gi, "-")
        .toLowerCase()
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    return `legacy-${safe || "field"}`;
}

function optionId(label: string, index: number): string {
    return `option-${index + 1}-${stableId(label).slice(7) || "value"}`;
}

function normalizeOptions(raw: unknown): CustomFieldOption[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const seen = new Set<string>();
    const result: CustomFieldOption[] = [];
    for (let index = 0; index < raw.length; index++) {
        const item = raw[index];
        const source = isRecord(item) ? item : null;
        const label =
            typeof item === "string" ? item.trim() : typeof source?.label === "string" ? source.label.trim() : "";
        if (!label) continue;
        const requestedId = typeof source?.id === "string" ? source.id : optionId(label, index);
        const id = requestedId || optionId(label, index);
        if (seen.has(id)) continue;
        seen.add(id);
        result.push({
            id,
            label,
            status: source?.status === "archived" ? "archived" : "active",
        });
    }
    return result;
}

function normalizeScope(scope: unknown): CustomFieldScope {
    if (!isRecord(scope)) return { mode: "all" };
    if (scope.mode === "task" || scope.mode === "project") return { mode: scope.mode };
    if (scope.mode === "projectTree") {
        return {
            mode: "projectTree",
            projectIds: Array.isArray(scope.projectIds)
                ? scope.projectIds.filter((id): id is string => typeof id === "string" && !!id)
                : [],
        };
    }
    return { mode: "all" };
}

export function normalizeCustomFieldDefs(raw: unknown): CustomFieldDef[] {
    if (!Array.isArray(raw)) return [];
    const result: CustomFieldDef[] = [];
    const seenKeys = new Set<string>();
    const seenIds = new Set<string>();

    for (const item of raw) {
        if (!isRecord(item) || item.version !== 2) continue;
        const id = typeof item.id === "string" ? item.id : "";
        const key = typeof item.key === "string" ? item.key : "";
        if (!id || !key || !isValidCustomFieldKey(key) || seenIds.has(id) || seenKeys.has(key)) continue;
        if (!isCustomFieldType(item.type)) continue;
        if (item.options !== undefined && !Array.isArray(item.options)) continue;

        const normalized: CustomFieldDef = {
            version: 2,
            id,
            key,
            label: typeof item.label === "string" && item.label.trim() ? item.label : key,
            description: typeof item.description === "string" ? item.description : "",
            type: item.type,
            status: item.status === "archived" ? "archived" : "active",
            scope: normalizeScope(item.scope),
            showOnCard: typeof item.showOnCard === "boolean" ? item.showOnCard : true,
            ...(item.options !== undefined ? { options: normalizeOptions(item.options) || [] } : {}),
        };
        if (validateCustomFieldDefinition(normalized)) continue;
        seenIds.add(id);
        seenKeys.add(key);
        result.push(normalized);
    }
    return result;
}

export function validateCustomFieldDefinition(field: CustomFieldDef): string | null {
    if (!isRecord(field) || field.version !== 2) return "custom field version must be 2";
    const allowedKeys = new Set([
        "version",
        "id",
        "key",
        "label",
        "description",
        "type",
        "status",
        "scope",
        "showOnCard",
        "options",
    ]);
    if (Object.keys(field).some((key) => !allowedKeys.has(key))) return "custom field contains unknown properties";
    if (typeof field.id !== "string" || !field.id) return "custom field id must not be empty";
    if (typeof field.key !== "string") return "custom field key must be a string";
    if (!isValidCustomFieldKey(field.key)) return "custom field key must use lowercase letters, digits and hyphens";
    if (RESERVED_CUSTOM_FIELD_KEYS.has(field.key)) return `custom field key is reserved: ${field.key}`;
    if (typeof field.label !== "string" || field.label.trim().length === 0)
        return "custom field label must not be empty";
    if (typeof field.description !== "string") return "custom field description must be a string";
    if (!isCustomFieldType(field.type)) return "custom field type is invalid";
    if (field.status !== "active" && field.status !== "archived") return "custom field status is invalid";
    if (typeof field.showOnCard !== "boolean") return "custom field showOnCard must be boolean";
    if (!isRecord(field.scope)) return "custom field scope is invalid";
    if (!["all", "task", "project", "projectTree"].includes(String(field.scope.mode)))
        return "custom field scope is invalid";
    if (
        field.scope.mode === "projectTree" &&
        (!Array.isArray(field.scope.projectIds) ||
            field.scope.projectIds.some((id: unknown) => typeof id !== "string" || !id))
    ) {
        return "projectTree scope contains an invalid project id";
    }
    const scopeKeys = Object.keys(field.scope);
    if (
        (field.scope.mode === "projectTree" &&
            (scopeKeys.length !== 2 || !scopeKeys.includes("mode") || !scopeKeys.includes("projectIds"))) ||
        (field.scope.mode !== "projectTree" && (scopeKeys.length !== 1 || scopeKeys[0] !== "mode"))
    ) {
        return "custom field scope contains unknown properties";
    }
    if (field.options !== undefined && !Array.isArray(field.options)) return "custom field options must be an array";
    if (field.options) {
        const optionIds = new Set<string>();
        for (const option of field.options) {
            if (
                !isRecord(option) ||
                Object.keys(option).length !== 3 ||
                !Object.prototype.hasOwnProperty.call(option, "id") ||
                !Object.prototype.hasOwnProperty.call(option, "label") ||
                !Object.prototype.hasOwnProperty.call(option, "status") ||
                typeof option.id !== "string" ||
                !option.id ||
                typeof option.label !== "string" ||
                !option.label.trim() ||
                (option.status !== "active" && option.status !== "archived") ||
                optionIds.has(option.id)
            ) {
                return "custom field options must have unique ids, labels and valid statuses";
            }
            optionIds.add(option.id);
        }
    }
    if (field.type === "singleSelect" || field.type === "multiSelect") {
        if (!field.options || field.options.length === 0) return "select custom fields require at least one option";
    }
    return null;
}

export function validateCustomFieldDefinitions(fields: unknown): string | null {
    if (!Array.isArray(fields)) return "customFields must be an array";
    const keys = new Set<string>();
    const ids = new Set<string>();
    for (const field of fields) {
        const error = validateCustomFieldDefinition(field);
        if (error) return error;
        if (keys.has(field.key)) return `custom field key must be unique: ${field.key}`;
        if (ids.has(field.id)) return `custom field id must be unique: ${field.id}`;
        keys.add(field.key);
        ids.add(field.id);
    }
    return null;
}

function isDate(value: string, datetime: boolean): boolean {
    return datetime ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) : /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function encodeCustomFieldValue(field: CustomFieldDef, input: CustomFieldInput): string {
    if (input === null || input === undefined || input === "") return "";
    switch (field.type) {
        case "number": {
            const value = typeof input === "number" ? input : Number(input);
            if (!Number.isFinite(value)) throw new Error("number custom field requires a finite number");
            return String(value);
        }
        case "boolean":
            return input === true || input === "1" || input === "true" ? "1" : "0";
        case "date":
            if (!isDate(String(input), false)) throw new Error("date custom field requires YYYY-MM-DD");
            return String(input);
        case "datetime":
            if (!isDate(String(input), true)) throw new Error("datetime custom field requires YYYY-MM-DDTHH:mm");
            return String(input);
        case "singleSelect": {
            const value = String(input);
            if (!field.options?.some((option) => option.id === value))
                throw new Error("singleSelect value is not a valid option");
            return value;
        }
        case "multiSelect": {
            const values = Array.isArray(input) ? input.map(String) : JSON.parse(String(input));
            if (!Array.isArray(values) || values.some((value) => !field.options?.some((option) => option.id === value)))
                throw new Error("multiSelect value contains an invalid option");
            return JSON.stringify([...new Set(values)]);
        }
        case "url": {
            const value = String(input).trim();
            const url = new URL(value);
            if (
                !["http:", "https:", "siyuan:"].includes(url.protocol) ||
                (url.protocol === "siyuan:" && !value.startsWith("siyuan://blocks/"))
            )
                throw new Error("url custom field only supports http(s) and siyuan block links");
            return value;
        }
        case "textarea":
            if (String(input).length > 4000) throw new Error("textarea custom field is limited to 4000 characters");
            return String(input).trim();
        case "text":
        default:
            if (String(input).length > 500) throw new Error("text custom field is limited to 500 characters");
            return String(input).trim();
    }
}

export function decodeCustomFieldValue(field: CustomFieldDef, raw: string | undefined): CustomFieldInput {
    if (!raw) return null;
    switch (field.type) {
        case "number":
            return Number(raw);
        case "boolean":
            return raw === "1" || raw === "true";
        case "multiSelect":
            try {
                return JSON.parse(raw);
            } catch {
                return [];
            }
        default:
            return raw;
    }
}

export function formatCustomFieldValue(field: CustomFieldDef, raw: string | undefined): string {
    const value = decodeCustomFieldValue(field, raw);
    if (value === null || value === "") return "";
    if (field.type === "boolean") return value ? "Yes" : "No";
    if (field.type === "singleSelect")
        return field.options?.find((option) => option.id === value)?.label || String(value);
    if (field.type === "multiSelect")
        return (value as string[])
            .map((id) => field.options?.find((option) => option.id === id)?.label || id)
            .join(", ");
    return String(value);
}

export function isCustomFieldApplicable(
    field: CustomFieldDef,
    task: TaskCacheEntry,
    membership?: ProjectMembershipGraph,
): boolean {
    if (field.status !== "active") return false;
    if (field.scope.mode === "all") return true;
    if (field.scope.mode === "task") return !isProjectTask(task);
    if (field.scope.mode === "project") return isProjectTask(task);
    const projectId = membership?.node(task.blockId)?.projectId || "";
    return Boolean(projectId && field.scope.projectIds.includes(projectId));
}
