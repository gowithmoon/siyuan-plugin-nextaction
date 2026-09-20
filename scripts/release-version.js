import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { finalizeUnreleased } from "./changelog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

function run(projectDirectory, command, args, options = {}) {
    execFileSync(command, args, {
        cwd: projectDirectory,
        stdio: "inherit",
        shell: shouldUseShell(command),
        ...options,
    });
}

function output(projectDirectory, command, args) {
    return execFileSync(command, args, {
        cwd: projectDirectory,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        shell: shouldUseShell(command),
    }).trim();
}

function shouldUseShell(command) {
    return process.platform === "win32" && command === "pnpm";
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertCleanWorktree(commandOutput) {
    const status = commandOutput("git", ["status", "--porcelain"]);
    if (status) {
        throw new Error("Working tree is not clean. Commit or stash changes before creating a release.");
    }
}

function assertMainBranch(commandOutput) {
    const branch = commandOutput("git", ["branch", "--show-current"]);
    if (branch !== "main") {
        throw new Error(`Release commits must be prepared on main; current branch is ${branch || "detached HEAD"}.`);
    }
    return branch;
}

function parseVersion(version) {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/.exec(version);
    if (!match) {
        throw new Error(`Unsupported version format: ${version}`);
    }
    return match.slice(1, 4).map(Number);
}

export function nextVersion(current, bump) {
    const [major, minor, patch] = parseVersion(current);
    switch (bump) {
        case "current":
            return current;
        case "major":
            return `${major + 1}.0.0`;
        case "minor":
            return `${major}.${minor + 1}.0`;
        case "patch":
            return `${major}.${minor}.${patch + 1}`;
        default:
            if (/^\d+\.\d+\.\d+(?:-.+)?$/.test(bump)) {
                return bump;
            }
            throw new Error(
                "Usage: pnpm run release:current | release:patch | release:minor | release:major | release:version -- <x.y.z>",
            );
    }
}

function replaceVersion(filePath, version) {
    const text = fs.readFileSync(filePath, "utf8");
    const updated = text.replace(/"version"\s*:\s*"[^"]+"/, `"version": "${version}"`);
    fs.writeFileSync(filePath, updated);
}

function finalizeChangelog(changelogPath, version, now) {
    const changelog = fs.readFileSync(changelogPath, "utf8");
    const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
        .map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, "0")))
        .join("-");
    return finalizeUnreleased(changelog, version, date);
}

export function prepareRelease(releaseArg, options = {}) {
    if (!releaseArg) {
        throw new Error("Missing release version. Use patch, minor, major, or an explicit x.y.z version.");
    }

    const projectDirectory = options.projectRoot || projectRoot;
    const runCommand = options.runCommand || ((command, args) => run(projectDirectory, command, args));
    const commandOutput = options.commandOutput || ((command, args) => output(projectDirectory, command, args));
    const now = options.now || new Date();
    const packageJsonPath = path.join(projectDirectory, "package.json");
    const pluginJsonPath = path.join(projectDirectory, "plugin.json");
    const changelogPath = path.join(projectDirectory, "CHANGELOG.md");

    assertCleanWorktree(commandOutput);
    const branch = assertMainBranch(commandOutput);

    runCommand("git", ["fetch", "origin", "main", "--tags"]);
    const head = commandOutput("git", ["rev-parse", "HEAD"]);
    const remoteMain = commandOutput("git", ["rev-parse", "refs/remotes/origin/main"]);
    if (head !== remoteMain) {
        throw new Error("Local main is not synchronized with origin/main. Run git pull --ff-only origin main first.");
    }

    const pkg = readJson(packageJsonPath);
    const plugin = readJson(pluginJsonPath);
    if (pkg.version !== plugin.version) {
        throw new Error(`Version mismatch: package.json=${pkg.version}, plugin.json=${plugin.version}`);
    }

    const version = nextVersion(pkg.version, releaseArg);
    const tag = `v${version}`;
    const finalizedChangelog = finalizeChangelog(changelogPath, version, now);

    const shouldCommitVersion = version !== pkg.version;
    if (shouldCommitVersion) {
        replaceVersion(packageJsonPath, version);
        replaceVersion(pluginJsonPath, version);
    }
    fs.writeFileSync(changelogPath, finalizedChangelog);

    runCommand("pnpm", ["run", "release:package"]);

    runCommand("git", ["add", "package.json", "plugin.json", "CHANGELOG.md"]);
    runCommand("git", ["commit", "-m", `chore: release ${tag}`]);

    console.log(`Release commit prepared on ${branch}: ${tag}`);
    console.log("Push main and wait for the Quality workflow to pass.");
    console.log("Then run: pnpm run release:publish");

    return { branch, tag, version };
}

function isDirectExecution() {
    if (!process.argv[1]) return false;
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
    try {
        prepareRelease(process.argv[2]);
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    }
}
