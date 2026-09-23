import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
    decodeCustomFieldValue,
    encodeCustomFieldValue,
    isCustomFieldApplicable,
    normalizeCustomFieldDefs,
    validateCustomFieldDefinition,
    validateCustomFieldDefinitions,
    type CustomFieldDef,
} from "../src/shared/custom-fields.ts";
import { createProjectMembershipGraph } from "../src/shared/project-membership-graph.ts";

function field(type: CustomFieldDef["type"], extra: Partial<CustomFieldDef> = {}): CustomFieldDef {
    return {
        version: 2,
        id: `field-${type}`,
        key: `test-${type}`,
        label: type,
        description: "",
        type,
        status: "active",
        scope: { mode: "all" },
        showOnCard: true,
        ...extra,
    };
}

test("自定义字段只接受完整 V2 定义", () => {
    assert.equal(validateCustomFieldDefinition(field("text")), null);
    assert.match(validateCustomFieldDefinition({ key: "delegatedTo", type: "text" } as any) ?? "", /version/);
    assert.match(
        validateCustomFieldDefinition({ ...field("text"), legacyKey: "delegatedTo" } as any) ?? "",
        /unknown properties/,
    );
});

test("持久化字段归一化保留合法字段并丢弃不兼容定义", () => {
    const valid = field("text", { id: "owner-field", key: "owner", label: "委托给" });
    const legacyMetadata = { ...valid, legacyKey: "delegatedTo", migrationIssue: "legacy-key-normalized" };
    assert.deepEqual(normalizeCustomFieldDefs([]), []);
    assert.deepEqual(normalizeCustomFieldDefs(null), []);
    const result = normalizeCustomFieldDefs([
        legacyMetadata,
        { ...valid, id: "old-version", key: "old", version: 1 },
        null,
        { ...valid, id: "duplicate-key" },
        { ...valid, id: "owner-field", key: "second-owner" },
        { ...valid, id: "select-without-options", key: "invalid-select", type: "singleSelect", options: [] },
    ]);

    assert.equal(result.length, 1);
    assert.deepEqual(result[0], valid);
});

test("九种字段类型使用稳定的字符串存储格式", () => {
    assert.equal(encodeCustomFieldValue(field("number"), 12.5), "12.5");
    assert.equal(encodeCustomFieldValue(field("boolean"), true), "1");
    assert.equal(encodeCustomFieldValue(field("date"), "2026-08-01"), "2026-08-01");
    assert.equal(encodeCustomFieldValue(field("datetime"), "2026-08-01T09:30"), "2026-08-01T09:30");
    const select = field("singleSelect", { options: [{ id: "home", label: "Home", status: "active" }] });
    assert.equal(encodeCustomFieldValue(select, "home"), "home");
    const multi = field("multiSelect", {
        options: [
            { id: "home", label: "Home", status: "active" },
            { id: "work", label: "Work", status: "active" },
        ],
    });
    assert.equal(encodeCustomFieldValue(multi, ["home", "work", "home"]), '["home","work"]');
    assert.deepEqual(decodeCustomFieldValue(multi, '["home"]'), ["home"]);
});

test("非法值和不安全链接被拒绝", () => {
    assert.throws(() => encodeCustomFieldValue(field("date"), "2026/08/01"));
    assert.throws(() => encodeCustomFieldValue(field("url"), "javascript:alert(1)"));
    assert.throws(() => encodeCustomFieldValue(field("text"), "x".repeat(501)));
});

test("项目树范围覆盖项目本身和全部后代", () => {
    const project = { blockId: "p", parentId: "", taskType: "2", identificationSource: "document" } as any;
    const child = { blockId: "c", parentId: "p", taskType: "1", identificationSource: "document" } as any;
    const grandChild = { blockId: "g", parentId: "c", taskType: "1", identificationSource: "document" } as any;
    const membership = createProjectMembershipGraph([project, child, grandChild]);
    const scoped = field("text", { scope: { mode: "projectTree", projectIds: ["p"] } });
    assert.equal(isCustomFieldApplicable(scoped, project, membership), true);
    assert.equal(isCustomFieldApplicable(scoped, grandChild, membership), true);
    assert.equal(
        isCustomFieldApplicable(scoped, { blockId: "x", parentId: "", taskType: "1" } as any, membership),
        false,
    );
});

test("字段定义校验拒绝大写、下划线和重复 Key", () => {
    const invalid = field("text", { key: "Bad_Key" });
    assert.match(validateCustomFieldDefinitions([invalid]) ?? "", /lowercase/);
    assert.match(
        validateCustomFieldDefinitions([field("text"), field("text", { id: "other", key: "test-text" })]) ?? "",
        /unique/,
    );
});

test("核心 Project 字段名不能被 custom-na-ext 自定义字段占用", () => {
    // Regression: extension fields with core names could make public task data ambiguous.
    for (const key of ["outcome", "dod", "kind"]) {
        assert.match(validateCustomFieldDefinition(field("text", { key })) ?? "", /reserved/);
    }
});

test("孤立字段清理只接受诊断接口返回的裸字段键", () => {
    const source = readFileSync(new URL("../src/kernel/task-custom-field-service.ts", import.meta.url), "utf8");
    const purgeMethod = source.match(/async purgeOrphanCustomField[\s\S]*?\n    \}/)?.[0] || "";
    assert.match(purgeMethod, /key\.startsWith\(ATTR_EXT_PREFIX\).*raw custom field key/);
    assert.doesNotMatch(purgeMethod, /key\.slice\(ATTR_EXT_PREFIX\.length\)/);
});
