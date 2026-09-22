import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

test("Neo 标题输入框竖线与文档任务状态图标保持间距并垂直居中", async () => {
    // Regression: Neo draws its leading marker on .protyle-title__input::before;
    // the document status button must not overlap that marker or sit below the title.
    const neoCss = `
        .protyle-title { position: relative; width: 760px; height: 53.76px; padding-left: 2px; }
        .protyle-title__input { position: relative; display: block; box-sizing: border-box; height: 100%;
            padding: 0 4px 0 2px; font-size: 38.4px; line-height: 53.76px; }
        .protyle-title__input::before { content: ""; position: absolute; left: 11.52px; top: 50%;
            width: 11.52px; height: 34.56px; transform: translate(-50%, -50%); background: #888; }
    `;
    const result = await runSvelteBrowserTest<{
        statusLeft: number;
        markerRight: number;
        gap: number;
        statusCenter: number;
        titleCenter: number;
        offset: string;
    }>({
        fixtureName: "document-title-layout-neo",
        aliases: [
            { find: "@layout", replacement: resolve("src/frontend/controllers/document-title-layout.ts") },
            { find: "@host-styles", replacement: resolve("src/frontend/styles/host-integration.scss") },
        ],
        files: {
            "main.js": `
                import { syncDocumentTitleLayout } from "@layout";
                import "@host-styles";
                const style = document.createElement("style");
                style.textContent = ${JSON.stringify(neoCss)};
                document.head.append(style);
                const title = document.createElement("div");
                title.className = "protyle-title na-document-task-title";
                const input = document.createElement("div");
                input.className = "protyle-title__input";
                input.textContent = "测试项目P";
                title.append(input);
                const status = document.createElement("button");
                status.className = "na-document-task-status";
                title.append(status);
                document.body.append(title);
                syncDocumentTitleLayout(title);
                const titleRect = title.getBoundingClientRect();
                const statusRect = status.getBoundingClientRect();
                const markerStyle = getComputedStyle(input, "::before");
                const inputRect = input.getBoundingClientRect();
                const markerLeft = inputRect.left + parseFloat(markerStyle.left) - parseFloat(markerStyle.width) / 2;
                const markerRight = markerLeft + parseFloat(markerStyle.width);
                window.__NA_BROWSER_RESULT__({
                    statusLeft: statusRect.left,
                    markerRight,
                    gap: statusRect.left - markerRight,
                    statusCenter: statusRect.top + statusRect.height / 2,
                    titleCenter: titleRect.top + titleRect.height / 2,
                    offset: title.style.getPropertyValue("--nextaction-document-task-leading-offset"),
                });
            `,
        },
    });

    assert.ok(result.gap >= 5, `状态图标与 Neo 竖线间距不足: ${result.gap}px`);
    assert.ok(Math.abs(result.statusCenter - result.titleCenter) < 0.5, "状态图标应与标题垂直居中");
    assert.notEqual(result.offset, "0px");
});
