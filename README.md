<div align="center">

# NextAction

### Tasks scatter across your notes — once they pile up, you can no longer tell which to do first.

[![version](https://img.shields.io/badge/version-0.8.2-blue)](https://github.com/litcu/siyuan-plugin-nextaction/releases) [![license](https://img.shields.io/badge/license-PolyForm%20Noncommercial-green)](https://github.com/litcu/siyuan-plugin-nextaction/blob/main/LICENSE)

[中文文档](./README.zh-CN.md)

</div>

---

> [!IMPORTANT]
> **What it touches:** Writes `custom-na-*` task attributes onto SiYuan blocks. The kernel bundle runs inside the SiYuan kernel process.
> **Does it exfiltrate?** No telemetry to the plugin author. AI features (opt-in) send task snapshots to whatever AI provider you configured in SiYuan, through SiYuan's own `/api/ai` endpoint — the plugin never calls third-party servers directly.
> **Reversibility:** Disable the plugin in **Settings → Marketplace → Downloaded**. Remove task attributes from any block via its status circle menu → **Remove Task**. Block content is preserved.

**Install:** Settings → Marketplace → search "NextAction" → install

---

## The Problem

Your SiYuan notebooks already hold the tasks — project notes, meeting actions, running lists. What they do not give you is the answer to "what do I do next?" Tasks scatter across documents, and once the list gets long enough, picking the next one becomes guesswork.

NextAction turns any block into a task with a due date, importance, and effort, then filters for what you can act on now and sorts it for you. The tasks stay in SiYuan. There is no second system to sync.

---

## See It Work

Type one slash command on any block:

```
/ntask
```

That block is now a task. A status circle appears beside it, and the task lands in **Inbox**. On desktop or browser-desktop, use the top-bar button to open the full NextAction tab; the 300 px dock remains a compact entry. Switch to **Next Actions** to see what you can do now, sorted by computed priority.

<!-- screenshot -->

---

## Install

**Marketplace (recommended):** Settings → Marketplace → search "NextAction" → install.

<details>
<summary><b>Manual install</b> — for offline or pre-release builds</summary>

Download the `siyuan-plugin-nextaction` folder from a [release](https://github.com/litcu/siyuan-plugin-nextaction/releases), place it under your workspace's `data/plugins/` directory, then enable it from **Settings → Marketplace → Downloaded**.

</details>

| Concern | Answer |
|---------|--------|
| What it touches | `custom-na-*` attributes on SiYuan blocks; runs a bundle in the SiYuan kernel process |
| Network calls | Only when you use an AI feature — routed through SiYuan's own `/api/ai` to your configured provider. No telemetry to the plugin author. |
| Compatibility | SiYuan 3.8.0 or newer; native mobile frontends are outside the current support scope |
| Disable | Settings → Marketplace → Downloaded → toggle off |
| Uninstall | Same menu → uninstall. Block content is preserved; only task attributes are removed. |

---

## Getting Started

1. Type `/ntask` (or `/zrw`) in any document to convert the current block into a task.
2. Click the status circle beside the block to set status, priority, or open task details.
3. Open the full panel from the top bar on desktop/browser-desktop, or use all views directly in the dock on browser-mobile. **Next Actions** shows what you can do now; **Inbox** holds unprocessed captures.

That is enough to start. Importance, review intervals, reminders, dependencies, and custom fields can wait until your task list needs them.

### Panel entry points

- **Desktop and browser-desktop:** the top-bar button opens the complete workspace in a tab. The right-side dock keeps three frequent views at the top and provides every page through All views. Task details open in a SiYuan dialog.
- **Browser-mobile:** the dock has four bottom destinations: Next Actions, My Day, Inbox, and All views. It starts in Next Actions and opens task details and creation as full pages with back navigation. Select a project before choosing Overview, Hierarchy, Board, Plan, or Gantt. Boards show one column at a time; Gantt scrolls horizontally inside the chart. Edit schedules with start time and duration without dragging.
- **Native iOS/Android:** the current plugin manifest does not declare a native mobile backend. Native mobile support is therefore outside the documented support and validation scope.

Panels share task data while keeping their navigation, filters, pagination, and browsing positions separate for the lifetime of each host. Closing the host or refreshing resets them.

<details>
<summary><b>Capture commands</b> — more ways to create tasks and projects</summary>

- `/ntask` or `/zrw` — convert the current block into a task (starts in **Inbox**).
- `/nproject` or `/zxm` — convert the current block into a project.
- `/ntaskchildren` or `/zrwz` — batch-convert a list or document subtree.
- Right-click a block icon or document title icon → **Convert to Task**.
- Native SiYuan task list items are supported directly; their list-item identity is preserved when you create, convert, update, or complete them.

</details>

---

## How It Works

NextAction follows the GTD rhythm: capture first, clarify later, organize into the right list, review regularly, and work from a short list of what is available now. Tasks live as ordinary SiYuan blocks with `custom-na-*` attributes; the plugin reads them through the SiYuan API, computes a priority score, and filters the views.

<details>
<summary><b>The GTD flow in NextAction</b></summary>

**Capture** — Type `/ntask` to turn a block into a task. New tasks start in **Inbox**. Inbox items do not need to be perfect — capture first, decide what they mean later.

**Clarify** — Process Inbox items one by one:

- Actionable → **To Do** or **In Progress**
- Not for now → **Someday/Maybe**
- Waiting on someone → **Waiting**
- No longer matters → remove the task attributes

When a task needs more context, open its details and add due date, start date, importance, effort, context, tags, and notes.

**Organize** — Statuses map to GTD lists:

| Status | Visual | Best for |
|--------|--------|----------|
| Inbox | Light blue circle + down arrow | Captured, not clarified yet |
| To Do | Gray hollow circle | Clarified, not started |
| In Progress | Blue half-filled circle | Currently being worked on |
| Waiting | Orange dashed circle | Waiting on people, feedback, or conditions |
| Someday/Maybe | Gold circle + three dots | Maybe later |
| Done | Green solid circle + white check | Finished |

Priority has five levels: Critical (red) > High (orange) > Medium (blue) > Low (gray) > None.

Tasks nest. A project can contain tasks, and a task can contain subtasks. A parent with unfinished children will not appear in **Next Actions** as if it were ready to do.

**Reflect** — **Review** shows a GTD-style checklist and tasks due for review. Any task can have a review interval so it comes back when it needs attention.

**Engage** — **Next Actions** shows only tasks you can work on now. Completed, waiting, blocked parent, and pre-start-date tasks are filtered out. For daily planning, **My Day** lets you pick from Next Actions and drag them onto a timeline.

</details>

<details>
<summary><b>How priority is calculated</b></summary>

NextAction computes a score from importance, effort, due-date urgency, and manual priority. Higher scores appear earlier in **Next Actions**.

You do not have to sort every task by hand. Filling in importance, effort, and due date is usually enough to get a useful order. Tasks before their start date stay out of **Next Actions** so they do not distract too early.

Priority parameters (due date weight, start date, importance, decay, growth, lookahead) are adjustable in **Settings → Priority Parameters**.

</details>

---

## Views

| View | What it is for |
|------|----------------|
| Next Actions | Available tasks, sorted by computed score |
| All Tasks | Tree view of unfinished tasks, with search, filters, and drag sorting |
| Projects | Project definitions, plans, child tasks, progress, risks, and review |
| Inbox | Inbox tasks waiting to be clarified |
| My Day | Today's plan, in list or timeline mode |
| Someday/Maybe | Shelved tasks that can be reactivated |
| Waiting | Tasks blocked by people or outside conditions |
| Review | GTD checklist and tasks due for review |
| Statistics | Completion and distribution overview |
| Reminders | Pending reminders in one place |

## Task Attributes

| Category | Fields |
|----------|--------|
| Basics | Title, status, priority |
| Dates | Due date, start date (minute-level precision) |
| Priority params | Importance (1-7), effort (1-7) |
| Organization | Context (`@`), tags, parent task, project |
| Dependencies | Dependent tasks, dependency mode (all/any), sequential execution |
| Recurrence | Frequency (daily/weekly/biweekly/monthly/yearly), interval, anchor |
| Review | Review interval, next review date |
| Reminders | Before-due reminders, fixed-time reminders |
| Custom | User-defined fields |
| Notes | Free-text notes |

## Working With Tasks in the Editor

After a block becomes a task, a status circle appears on its left:

- **Click the circle** to change status, set priority, add to My Day, add reminders, view attributes, or remove the task.
- **Left-click the circle in the panel** to open the status menu.
- **Right-click a task card in the panel** for quick status, priority, My Day, reminder, and remove actions.
- **Click the task title** to open the full detail editor.
- **Drag task cards** in All Tasks to adjust order.

<details>
<summary><b>Settings</b> — five sections</summary>

1. **General**: task defaults, My Day, reminders.
2. **Custom fields**: extend task attributes.
3. **Built-in AI**: customize built-in AI prompts.
4. **MCP**: expose task tools to AI clients.
5. **Advanced**: priority engine and maintenance.

</details>

---

## FAQ

**Does it sync with a separate task server?**
No. Tasks are ordinary SiYuan blocks with `custom-na-*` attributes. Everything lives in your SiYuan workspace — there is no external account or sync layer.

**What happens to my blocks if I uninstall?**
Block content is preserved. Only the task attributes are removed. You can also remove task attributes from a single block via its status circle menu without uninstalling.

**Do AI features send my data somewhere?**
Only when you explicitly trigger an AI feature (extract tasks, decompose, plan My Day, review). The plugin calls SiYuan's own `/api/ai` endpoint, which routes to whatever AI provider you configured in SiYuan. The plugin never contacts third-party servers directly and sends nothing to the plugin author.

---

## Contributing

```bash
pnpm install
pnpm run dev              # Watch mode: kernel + app in parallel
pnpm run build            # Production build
pnpm run release          # Build and deploy to local plugin directory
pnpm run release:package  # Build package.zip for marketplace/GitHub release
pnpm run test:integration:kernel  # Optional: test against a local SiYuan kernel
pnpm run test:integration:mcp     # Optional: test MCP integration
```

Before using `pnpm run release`, copy `.env.example` to the ignored `.env.local` file and set
`SIYUAN_PLUGINS_DIR` to the absolute path of the workspace's `data/plugins` directory. A system environment variable
with the same name takes precedence, which is useful when temporarily deploying to another workspace.

This repository uses lightweight trunk-based development. Push small, low-risk changes directly to `main` after `pnpm run check` passes locally. Use a short-lived branch and pull request for larger features or high-risk changes involving data writes, RPC, synchronization, or broad UI work, then squash-merge after Quality passes. Deleting or force-pushing `main` is blocked; fix a failed post-push check with a follow-up commit or revert instead of rewriting remote history.

<details>
<summary><b>Releasing a new version</b></summary>

Releases are driven by Git tags. Before releasing, switch to a local `main` that is synchronized with `origin/main`, add at least one bullet under the appropriate category in the `[Unreleased]` section of [CHANGELOG.md](./CHANGELOG.md), then commit and push that changelog update. Empty categories are omitted from the GitHub Release notes.

```bash
pnpm run release:patch
pnpm run release:minor
pnpm run release:major
pnpm run release:current
pnpm run release:version -- 1.2.3
```

These commands must run on a local `main` that exactly matches `origin/main`. They validate and finalize the changelog, update `package.json` and `plugin.json` when needed, build the release package, and create the release commit. They do not push the commit or create a tag. Push `main` manually and wait for the Quality workflow to pass.

After Quality passes, confirm that local `main` is synchronized with the remote and publish the tag:

```bash
git switch main
git pull --ff-only origin main
pnpm run release:publish
```

`release:publish` verifies that the worktree is clean, the current branch is `main`, local `main` exactly matches `origin/main`, both version files agree, and the matching changelog section exists. It then creates and pushes only the `vX.Y.Z` tag. GitHub Actions builds `package.zip`, uses that version's changelog section as the GitHub Release notes, and appends a link to the complete diff from the previous tag.

</details>

## License

PolyForm Noncommercial License 1.0.0. You may use, modify, and share this plugin for noncommercial purposes. You may not sell it, package it as a paid product, publish it as a paid listing, or monetize this plugin or derivative versions. See [LICENSE](./LICENSE).
