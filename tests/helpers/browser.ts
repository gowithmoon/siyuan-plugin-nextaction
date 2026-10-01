import assert from "node:assert/strict";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";

export type BrowserResult = {
    status: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
    error?: Error;
};

type RunBrowserOptions = { timeout?: number; encoding?: BufferEncoding };

export function browserViewportArgs(width: number, height: number): string[] {
    assert.ok(Number.isFinite(width) && width > 0, "浏览器视口宽度必须为正数");
    assert.ok(Number.isFinite(height) && height > 0, "浏览器视口高度必须为正数");

    const windowWidth = Math.max(500, width);
    const scale = windowWidth / width;
    return [
        `--window-size=${windowWidth},${Math.ceil(height * scale)}`,
        `--force-device-scale-factor=${scale.toFixed(6)}`,
    ];
}

function killProcessTree(pid: number | undefined, fallback: () => void): Promise<void> {
    if (!pid) return Promise.resolve();

    if (process.platform === "win32") {
        return new Promise((resolve) => {
            const finish = () => {
                try {
                    fallback();
                } catch {
                    // The process may have exited while taskkill was running.
                }
                resolve();
            };
            const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
                stdio: "ignore",
                windowsHide: true,
            });
            killer.once("close", finish);
            killer.once("error", finish);
        });
    }

    try {
        process.kill(-pid, "SIGKILL");
    } catch {
        // The process may have exited between the timeout and this call.
        try {
            fallback();
        } catch {
            // Ignore a second race with process exit.
        }
    }
    return Promise.resolve();
}

export function runBrowser(
    executable: string,
    args: string[],
    { timeout = 20_000, encoding = "utf8" }: RunBrowserOptions = {},
): Promise<BrowserResult> {
    return new Promise((resolve) => {
        const child = spawn(executable, args, {
            detached: process.platform !== "win32",
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        let termination: Promise<void> | undefined;
        let settled = false;
        const timer = setTimeout(() => {
            timedOut = true;
            termination = killProcessTree(child.pid, () => child.kill("SIGKILL"));
        }, timeout);

        child.stdout?.setEncoding(encoding);
        child.stderr?.setEncoding(encoding);
        child.stdout?.on("data", (chunk: string) => {
            stdout += chunk;
        });
        child.stderr?.on("data", (chunk: string) => {
            stderr += chunk;
        });

        const finish = (status: number | null, signal: NodeJS.Signals | null, error?: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({
                status: timedOut ? null : status,
                signal,
                stdout,
                stderr,
                ...(timedOut ? { error: new Error(`浏览器进程超过 ${timeout}ms 未结束`) } : error ? { error } : {}),
            });
        };

        child.once("error", (error) => {
            if (termination) {
                void termination.then(() => finish(null, null));
                return;
            }
            finish(null, null, error);
        });
        child.once("close", (status, signal) => {
            if (termination) {
                void termination.then(() => finish(status, signal));
                return;
            }
            finish(status, signal);
        });
    });
}

export function removeBrowserFixture(fixtureRoot: string): void {
    rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
}

export function findBrowserExecutable(): string {
    const playwrightCaches = [
        process.env.XDG_CACHE_HOME ? join(process.env.XDG_CACHE_HOME, "ms-playwright") : undefined,
        process.env.HOME ? join(process.env.HOME, ".cache", "ms-playwright") : undefined,
        process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "ms-playwright") : undefined,
        process.env.USERPROFILE ? join(process.env.USERPROFILE, "AppData", "Local", "ms-playwright") : undefined,
    ].filter(
        (candidate, index, candidates): candidate is string =>
            Boolean(candidate) && candidates.indexOf(candidate) === index,
    );
    const cached = playwrightCaches.flatMap((playwrightCache) =>
        existsSync(playwrightCache)
            ? readdirSync(playwrightCache)
                  .filter((entry) => entry.startsWith("chromium_headless_shell-") || entry.startsWith("chromium-"))
                  .sort()
                  .reverse()
                  .flatMap((entry) => [
                      join(playwrightCache, entry, "chrome-headless-shell-linux64", "chrome-headless-shell"),
                      join(playwrightCache, entry, "chrome-linux64", "chrome"),
                      join(playwrightCache, entry, "chrome-headless-shell-win64", "chrome-headless-shell.exe"),
                      join(playwrightCache, entry, "chrome-win", "chrome.exe"),
                  ])
            : [],
    );
    const candidates = [
        process.env.NA_LAYOUT_BROWSER,
        ...cached,
        process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : undefined,
        process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined,
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
    ].filter((candidate): candidate is string => Boolean(candidate));
    const executable = candidates.find((candidate) => existsSync(candidate));
    assert.ok(executable, "未找到浏览器；可通过 NA_LAYOUT_BROWSER 指定 Chrome/Edge 路径");
    return executable;
}
