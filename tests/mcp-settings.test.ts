import test from "node:test";
import assert from "node:assert/strict";

import { RPC_ERROR_INVALID_PARAMS } from "../src/shared/constants.ts";
import { DEFAULT_MCP_SETTINGS, mergeMcpSettings, validateMcpSettings } from "../src/shared/mcp-settings.ts";
import { DEFAULT_SETTINGS, mergeSettings } from "../src/shared/settings.ts";
import { TaskTargetResolver } from "../src/kernel/task-target-resolver.ts";
import { errorToRpcError } from "../src/kernel/utils.ts";
import type { SiyuanApiPort } from "../src/kernel/siyuan-api.ts";

test("MCP 当前默认值关闭工具和写权限", () => {
    const merged = mergeMcpSettings(DEFAULT_MCP_SETTINGS, undefined);

    assert.deepEqual(merged, DEFAULT_MCP_SETTINGS);
    assert.equal(merged.enabled, false);
    assert.equal(merged.allowWrite, false);
});

test("MCP 设置只合并当前布尔权限", () => {
    const base = mergeMcpSettings(DEFAULT_MCP_SETTINGS, { allowWrite: true });
    const merged = mergeMcpSettings(base, { enabled: true });

    assert.equal(merged.enabled, true);
    assert.equal(merged.allowWrite, true);
    assert.deepEqual(Object.keys(merged).sort(), ["allowWrite", "enabled"]);
});

test("MCP 设置写入校验拒绝未知字段和非布尔权限", () => {
    assert.match(validateMcpSettings({ defaultCreateTarget: "inbox" } as any) ?? "", /unknown properties/);
    assert.match(validateMcpSettings({ allowWrite: "yes" as any }) ?? "", /allowWrite/);
});

test("启用 MCP 写入但未配置创建目标时返回可操作的 RPC 错误", async () => {
    const settings = mergeSettings(DEFAULT_SETTINGS, {
        mcpSettings: { enabled: true, allowWrite: true },
    });
    const resolver = new TaskTargetResolver({} as SiyuanApiPort, () => settings);

    // Regression: MCP 写入设置校验错误曾被 RPC 层隐藏为 Internal error。
    await assert.rejects(
        () => resolver.validateSettings(settings),
        (error: unknown) => {
            assert.deepEqual(errorToRpcError(error), {
                _rpcError: {
                    code: RPC_ERROR_INVALID_PARAMS,
                    message: "MCP inbox document is required",
                },
            });
            return true;
        },
    );
});
