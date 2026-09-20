import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build, type Alias } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { chromium } from "playwright-core";
import svelteConfig from "../../svelte.config.js";
import { frontendInlineDynamicImports, frontendViteAliases } from "../../vite.shared.ts";
import { findBrowserExecutable, removeBrowserFixture, runBrowser } from "./browser.ts";

const svelteRoot = resolve("node_modules/svelte");
const sveltePublicAliases: Alias[] = [
    { find: /^svelte$/, replacement: join(svelteRoot, "src/index-client.js") },
    { find: /^svelte\/store$/, replacement: join(svelteRoot, "src/store/index-client.js") },
    { find: /^svelte\/transition$/, replacement: join(svelteRoot, "src/transition/index.js") },
];

const defaultIndexHtml = `<!doctype html>
<html>
    <body>
        <div id="app"></div>
        <script>
            window.__NA_BROWSER_RESULT__ = (value) => {
                const result = document.createElement("pre");
                result.id = "browser-result";
                result.textContent = "na-json:" + encodeURIComponent(JSON.stringify(value));
                document.body.appendChild(result);
            };
        </script>
        <script type="module" src="./main.js"></script>
    </body>
</html>`;

// Browser fixtures are expensive; serialise them so concurrent node:test workers
// do not starve Chromium and turn healthy tests into timeout failures.
let browserTestQueue: Promise<void> = Promise.resolve();

export type SvelteBrowserTestOptions = {
    fixtureName: string;
    files?: Record<string, string>;
    aliases?: Alias[] | ((fixtureRoot: string) => Alias[]);
    browserArgs?: string[];
    browserExecutable?: string;
    indexHtml?: string;
    prepareFixture?: (fixtureRoot: string) => void;
    timeout?: number;
    virtualTimeBudget?: number;
    realTime?: boolean;
};

function fixturePrefix(name: string): string {
    const safeName = name.replace(/[^a-zA-Z0-9-]+/g, "-");
    return `nextaction-${safeName}-`;
}

function writeFixtureFiles(fixtureRoot: string, files: Record<string, string>): void {
    const fixtureFiles = {
        "package.json": '{"private":true,"type":"module"}',
        "index.html": defaultIndexHtml,
        ...files,
    };
    for (const [relativePath, contents] of Object.entries(fixtureFiles)) {
        const target = join(fixtureRoot, relativePath);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, contents);
    }
    // Resolve Svelte through the package's public export map. This keeps
    // browser fixtures independent from private runtime aliases while
    // still allowing the compiler's generated runtime imports to resolve.
    mkdirSync(join(fixtureRoot, "node_modules"), { recursive: true });
    symlinkSync(
        resolve("node_modules/svelte"),
        join(fixtureRoot, "node_modules/svelte"),
        process.platform === "win32" ? "junction" : "dir",
    );
}

function browserArgs(fixtureRoot: string, options: SvelteBrowserTestOptions): string[] {
    return [
        "--headless=new",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "--allow-file-access-from-files",
        "--disable-web-security",
        "--no-first-run",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        `--virtual-time-budget=${options.virtualTimeBudget ?? 1_000}`,
        `--user-data-dir=${join(fixtureRoot, "browser-profile")}`,
        ...(options.browserArgs ?? []),
        "--dump-dom",
        pathToFileURL(join(fixtureRoot, "dist", "index.html")).href,
    ];
}

export async function runSvelteBrowserTest<Result = Record<string, unknown>>(
    options: SvelteBrowserTestOptions,
): Promise<Result> {
    const previous = browserTestQueue;
    let release!: () => void;
    browserTestQueue = new Promise<void>((resolve) => {
        release = resolve;
    });
    await previous;

    const fixtureRoot = mkdtempSync(join(tmpdir(), fixturePrefix(options.fixtureName)));
    try {
        writeFixtureFiles(fixtureRoot, {
            ...(options.indexHtml ? { "index.html": options.indexHtml } : {}),
            ...(options.files ?? {}),
        });
        options.prepareFixture?.(fixtureRoot);
        const aliases = typeof options.aliases === "function" ? options.aliases(fixtureRoot) : options.aliases;
        const fixtureAliases: Alias[] = existsSync(join(fixtureRoot, "siyuan.js"))
            ? [{ find: "siyuan", replacement: join(fixtureRoot, "siyuan.js") }]
            : [];
        await build({
            root: fixtureRoot,
            base: "./",
            configFile: false,
            logLevel: "silent",
            resolve: {
                conditions: ["browser", "module", "import"],
                alias: [
                    ...Object.entries(frontendViteAliases).map(([find, replacement]) => ({ find, replacement })),
                    ...fixtureAliases,
                    ...(aliases ?? []),
                    ...sveltePublicAliases,
                ],
            },
            plugins: [svelte(svelteConfig as Parameters<typeof svelte>[0])],
            css: {
                preprocessorOptions: {
                    scss: {
                        api: "modern-compiler",
                    },
                },
            },
            build: {
                outDir: "dist",
                rollupOptions: { output: { inlineDynamicImports: frontendInlineDynamicImports } },
            },
        });

        if (options.realTime) {
            const timeout = options.timeout ?? 20_000;
            const browser = await chromium.launch({
                executablePath: options.browserExecutable ?? findBrowserExecutable(),
                headless: true,
                timeout,
                args: ["--allow-file-access-from-files", "--disable-web-security", ...(options.browserArgs ?? [])],
            });
            try {
                const page = await browser.newPage({ viewport: null });
                await page.goto(pathToFileURL(join(fixtureRoot, "dist", "index.html")).href, { timeout });
                const result = page.locator("#browser-result");
                await result.waitFor({ state: "attached", timeout });
                const payload = (await result.textContent())!;
                return JSON.parse(payload.startsWith("na-json:") ? decodeURIComponent(payload.slice(8)) : payload);
            } finally {
                await browser.close();
            }
        }

        const rendered = await runBrowser(
            options.browserExecutable ?? findBrowserExecutable(),
            browserArgs(fixtureRoot, options),
            { encoding: "utf8", timeout: options.timeout ?? 20_000 },
        );
        assert.equal(rendered.status, 0, rendered.stderr || rendered.error?.message || "浏览器执行失败");
        const match = rendered.stdout.match(/<pre id="browser-result">([^<]+)<\/pre>/);
        assert.ok(
            match,
            `浏览器未输出行为结果（status=${rendered.status}, signal=${rendered.signal}）：${rendered.stderr.slice(0, 1_000)}\n${rendered.stdout.slice(0, 2_000)}`,
        );
        const payload = match[1];
        if (payload.startsWith("na-json:")) {
            return JSON.parse(decodeURIComponent(payload.slice("na-json:".length))) as Result;
        }
        return JSON.parse(payload.replace(/&quot;/g, '"').replace(/&amp;/g, "&")) as Result;
    } finally {
        removeBrowserFixture(fixtureRoot);
        release();
    }
}
