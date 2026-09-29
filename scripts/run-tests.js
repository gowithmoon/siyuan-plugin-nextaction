import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const mode = process.argv[2] || "unit";
if (mode !== "unit" && mode !== "browser") {
    console.error(`Unknown test mode: ${mode}`);
    process.exit(2);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = resolve(repoRoot, "tests");
const forwardedArgs = process.argv.slice(3).filter((argument) => argument !== "--");
const testFiles = readdirSync(testRoot)
    .filter((file) => file.endsWith(".test.ts"))
    .filter((file) => {
        const source = readFileSync(resolve(testRoot, file), "utf8");
        // Keep older browser suites out of the default run even when their filename predates the suffix.
        const isBrowserTest =
            file.endsWith("-browser.test.ts") ||
            source.includes("runSvelteBrowserTest") ||
            source.includes("findBrowserExecutable") ||
            source.includes("runBrowser(");
        return isBrowserTest ? mode === "browser" : mode === "unit";
    })
    .sort()
    .map((file) => resolve(testRoot, file));

const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", "--test-concurrency=4", ...forwardedArgs, ...testFiles],
    {
        cwd: repoRoot,
        stdio: "inherit",
    },
);

if (result.error) {
    console.error(result.error);
    process.exit(1);
}
process.exit(result.status ?? 1);
