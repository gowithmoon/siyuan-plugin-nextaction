import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { runBrowser } from "./helpers/browser.ts";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

// Regression: 浏览器超时后曾遗留子进程并锁住临时 profile，导致后续清理报 EBUSY。
test("浏览器超时会终止整个进程树并返回超时结果", async () => {
    const startedAt = Date.now();
    const result = await runBrowser(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeout: 100 });

    assert.equal(result.status, null);
    assert.ok(Date.now() - startedAt < 5_000, `超时浏览器进程未及时结束：${Date.now() - startedAt}ms`);
});

test("共享 Svelte 浏览器 Harness 使用生产兼容配置渲染并返回行为结果", async () => {
    const result = await runSvelteBrowserTest<{ text: string; calls: string[] }>({
        fixtureName: "shared-harness-success",
        files: {
            "Fixture.svelte":
                "<script>let { message, onSelect } = $props();</script><button onclick={() => onSelect(message)}>{message}</button>",
            "main.js": `import Fixture from "./Fixture.svelte";
import { mount } from "svelte";
const calls = [];
mount(Fixture, { target: document.querySelector("#app"), props: { message: "ready", onSelect: (value) => calls.push(value) } });
document.querySelector("button")?.click();
window.__NA_BROWSER_RESULT__({ text: document.querySelector("button")?.textContent, calls });`,
        },
    });

    assert.deepEqual(result, { text: "ready", calls: ["ready"] });
});

test("真实时间浏览器等待异步结果并推进渲染帧", async () => {
    // Regression: 虚拟计时器与渲染帧不同步，导致滚动事件打断模拟长按。
    const result = await runSvelteBrowserTest<{ frames: number }>({
        fixtureName: "shared-harness-real-time",
        realTime: true,
        files: {
            "main.js": `setTimeout(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => window.__NA_BROWSER_RESULT__({ frames: 2 })));
}, 50);`,
        },
    });
    assert.deepEqual(result, { frames: 2 });
});

// Regression: 构建失败时临时 fixture 曾绕过 finally，遗留在系统临时目录中。
test("共享 Svelte 浏览器 Harness 在构建失败后清理 fixture", async () => {
    const fixtureName = `shared-harness-failure-${process.pid}`;
    const matchingFixtures = () =>
        readdirSync(tmpdir()).filter((entry) => entry.startsWith(`nextaction-${fixtureName}-`));

    assert.deepEqual(matchingFixtures(), []);
    await assert.rejects(
        runSvelteBrowserTest({
            fixtureName,
            files: {
                "Fixture.svelte": "{#if}",
                "main.js": 'import "./Fixture.svelte";',
            },
        }),
    );
    assert.deepEqual(matchingFixtures(), []);
});

// Regression: Chromium 启动失败时 fixture、构建产物和 browser profile 也必须清理。
test("共享 Svelte 浏览器 Harness 在浏览器失败后清理全部临时产物", async () => {
    const fixtureName = `shared-harness-browser-failure-${process.pid}`;
    const matchingFixtures = () =>
        readdirSync(tmpdir()).filter((entry) => entry.startsWith(`nextaction-${fixtureName}-`));

    assert.deepEqual(matchingFixtures(), []);
    await assert.rejects(
        runSvelteBrowserTest({
            fixtureName,
            browserExecutable: process.execPath,
            files: {
                "Fixture.svelte": "<p>ready</p>",
                "main.js": 'import "./Fixture.svelte";',
            },
        }),
    );
    assert.deepEqual(matchingFixtures(), []);
});
