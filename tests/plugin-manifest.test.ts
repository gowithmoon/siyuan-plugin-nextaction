import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));

test("插件清单声明支持桌面端、原生移动端与 Web 前端", () => {
    assert.deepEqual(manifest.frontends, ["desktop", "desktop-window", "mobile", "browser-desktop", "browser-mobile"]);
});

test("插件清单声明桌面、原生移动端与 Docker 后端可加载内核插件", () => {
    const supportedBackends = ["windows", "linux", "darwin", "ios", "android", "harmony", "docker"];

    assert.deepEqual(manifest.backends, supportedBackends);
    assert.deepEqual(manifest.kernels, supportedBackends);
});

test("插件清单要求提供 Agent capability API 的思源版本", () => {
    assert.equal(manifest.minAppVersion, "3.8.0");
});
