import { existsSync, readFileSync, readdirSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const GLOBAL_STYLE_FILES = [
    "src/frontend/styles/app-shell.scss",
    "src/frontend/styles/components.scss",
    "src/frontend/styles/host-integration.scss",
];
const readGlobalStyles = () => GLOBAL_STYLE_FILES.map(read).join("\n");

const TASK_THEME_FILES = [
    ...GLOBAL_STYLE_FILES,
    "src/frontend/components/NavRail.svelte",
    "src/frontend/components/AllTasksView.svelte",
    "src/frontend/components/InboxView.svelte",
    "src/frontend/components/NextActionView.svelte",
    "src/frontend/components/MyDayView.svelte",
    "src/frontend/components/ProjectView.svelte",
    "src/frontend/components/SomedayView.svelte",
    "src/frontend/components/WaitingView.svelte",
    "src/frontend/components/ReviewView.svelte",
    "src/frontend/components/ReviewGuide.svelte",
    "src/frontend/components/ReviewDueList.svelte",
    "src/frontend/components/StatisticsView.svelte",
    "src/frontend/components/DockSidebar.svelte",
    "src/frontend/components/TaskCard.svelte",
    "src/frontend/components/timeline/TimelineView.svelte",
    "src/frontend/components/timeline/TimelineColumn.svelte",
    "src/frontend/components/timeline/TimelineCard.svelte",
    "src/frontend/components/timeline/TimelineNeedle.svelte",
    "src/frontend/components/timeline/UnscheduledPanel.svelte",
];

function listStyleSources(root) {
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
        const path = `${root}/${entry.name}`;
        if (entry.isDirectory()) return listStyleSources(path);
        return /\.(?:svelte|scss|css)$/.test(entry.name) ? [path] : [];
    });
}

const checks = [
    {
        name: "theme tokens expose accessible text roles and accent surfaces",
        run() {
            const tokens = read("src/frontend/ui/tokens.scss");
            return [
                "--na-text-primary:",
                "--na-text-secondary:",
                "--na-text-interactive:",
                "--na-text-danger:",
                "--na-accent-surface:",
                "--na-accent-surface-hover:",
            ].every((needle) => tokens.includes(needle));
        },
    },
    {
        name: "visible text does not bypass accessible semantic tokens",
        run() {
            const unsafeTextColor =
                /^\s*color\s*:\s*var\(--(?:b3-theme-on-surface(?:-light)?|b3-theme-primary|b3-theme-error|b3-theme-on-primary|na-accent|na-color-someday)\)/m;
            return listStyleSources("src/frontend").every((path) => !unsafeTextColor.test(read(path)));
        },
    },
    {
        name: "dock My Day provides the shared timeline theme variables",
        run() {
            const dockMyDay =
                read("src/frontend/components/timeline/TimelineView.svelte") +
                read("src/frontend/components/MyDayView.svelte") +
                read("src/frontend/styles/workspace.scss");
            return ["--na-myday-panel-bg:", "--na-myday-panel-border:", "--na-myday-panel-soft-bg:"].every((needle) =>
                dockMyDay.includes(needle),
            );
        },
    },
    {
        name: "notification styles use global SiYuan colors for accent states",
        run() {
            const styles = read("src/frontend/styles/host-integration.scss");
            const notificationBlock = styles.slice(styles.indexOf(".na-notification-host"));
            return !notificationBlock.includes("var(--na-accent");
        },
    },
    {
        name: "shared select arrow is theme-colored rather than fixed #aaa",
        run() {
            const primitives = read("src/frontend/ui/primitives.scss");
            return !primitives.includes("stroke='%23aaa'");
        },
    },
    {
        name: "filter active states use soft theme tokens instead of solid active color",
        run() {
            const dropdown = read("src/frontend/ui/NaFilterDropdown.svelte");
            return (
                [
                    "--na-filter-active-bg",
                    "--na-filter-active-bg-hover",
                    "--na-filter-active-border",
                    "--na-filter-active-fg",
                ].every((needle) => dropdown.includes(needle)) &&
                !dropdown.includes("background: var(--na-filter-active-color")
            );
        },
    },
    {
        name: "sort dropdown active states reuse filter active tokens",
        run() {
            const sortSelect = read("src/frontend/ui/NaSortSelect.svelte");
            return (
                [
                    "--na-filter-active-bg",
                    "--na-filter-active-bg-hover",
                    "--na-filter-active-border",
                    "--na-filter-active-fg",
                ].every((needle) => sortSelect.includes(needle)) && !sortSelect.includes("rgba(79, 195, 247")
            );
        },
    },
    {
        name: "modern settings pages rely on SiYuan theme variables",
        run() {
            const files = [
                "src/frontend/components/settings/GeneralSettingsPage.svelte",
                "src/frontend/components/settings/CustomFieldsSettingsPage.svelte",
                "src/frontend/components/settings/AiSettingsPage.svelte",
                "src/frontend/components/settings/McpSettingsPage.svelte",
                "src/frontend/components/settings/AdvancedSettingsPage.svelte",
            ];
            return files.every((path) => {
                const source = read(path);
                return (
                    source.includes("var(--b3-") &&
                    !/#(?:fff(?:fff)?|000(?:000)?)\b/i.test(source) &&
                    !/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\.1\s*\)/i.test(source)
                );
            });
        },
    },
    {
        name: "public Na UI layer uses SiYuan colors only",
        run() {
            const files = readdirSync("src/frontend/ui").filter(
                (name) => name.endsWith(".svelte") || name.endsWith(".scss"),
            );
            return files.every((name) => {
                const source = read(`src/frontend/ui/${name}`);
                return !/(?:#[0-9a-f]{3,8}\b|rgba?\s*\()/i.test(source);
            });
        },
    },
    {
        name: "public Svelte components use the Na prefix",
        run() {
            return readdirSync("src/frontend/ui")
                .filter((name) => name.endsWith(".svelte"))
                .every((name) => name.startsWith("Na"));
        },
    },
    {
        name: "task property panel and dialog hosts use theme-derived colors only",
        run() {
            const files = [
                "src/frontend/components/TaskDetail.svelte",
                "src/frontend/components/Workspace.svelte",
                "src/frontend/components/DockSidebar.svelte",
                "src/frontend/dialogs/task-property-dialogs.ts",
            ];
            return files.every((path) => {
                const source = read(path);
                return !/(?:#[0-9a-f]{3,8}\b|rgba?\s*\(|hsla?\s*\()/i.test(source);
            });
        },
    },
    {
        name: "task views, dock and timeline use theme-derived colors only",
        run() {
            return TASK_THEME_FILES.every((path) => !/(?:#[0-9a-f]{3,8}\b|rgba?\s*\(|hsla?\s*\()/i.test(read(path)));
        },
    },
    {
        name: "Na theme token references are defined",
        run() {
            const sources = [...listStyleSources("src/frontend"), "src/index.scss"];
            const definitions = new Set();
            for (const path of sources) {
                for (const match of read(path).matchAll(/(--na-[\w-]+)\s*:/g)) definitions.add(match[1]);
            }
            return [
                ...new Set([...TASK_THEME_FILES, ...sources.filter((path) => path.startsWith("src/frontend/ui/"))]),
            ].every((path) =>
                [...read(path).matchAll(/var\(\s*(--na-[\w-]+)/g)].every((match) => definitions.has(match[1])),
            );
        },
    },
    {
        name: "legacy task detail and popup visual layers were removed",
        run() {
            const styles = readGlobalStyles();
            return (
                !styles.includes(".na-detail__") &&
                !styles.includes(".na-reminder-popup") &&
                !styles.includes(".na-app__detail-pane") &&
                !existsSync("src/frontend/components/ReminderPopup.svelte") &&
                !existsSync("src/frontend/components/RepeatRuleDialog.svelte")
            );
        },
    },
];

let failed = 0;

for (const check of checks) {
    if (check.run()) {
        console.log(`PASS ${check.name}`);
    } else {
        failed += 1;
        console.error(`FAIL ${check.name}`);
    }
}

process.exitCode = failed === 0 ? 0 : 1;
