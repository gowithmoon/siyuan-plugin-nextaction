import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const zh = JSON.parse(readFileSync(new URL("../src/i18n/zh-CN.json", import.meta.url), "utf8"));
const en = JSON.parse(readFileSync(new URL("../src/i18n/en.json", import.meta.url), "utf8"));

test("中英文翻译键集合完全一致", () => {
    assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
});

test("前端直接引用的 i18n 键均存在", () => {
    const frontendRoot = fileURLToPath(new URL("../src/frontend/", import.meta.url));
    const missing = new Set<string>();
    for (const relativePath of readdirSync(frontendRoot, { recursive: true }) as string[]) {
        if (![".ts", ".svelte"].includes(extname(relativePath))) continue;
        const source = readFileSync(join(frontendRoot, relativePath), "utf8");
        for (const match of source.matchAll(/i18n\?\.([A-Za-z0-9_]+)/g)) {
            if (!(match[1] in en) || !(match[1] in zh)) missing.add(match[1]);
        }
    }
    assert.deepEqual([...missing].sort(), []);
});

test("翻译资源不存在零引用键", () => {
    // Regression: obsolete UI translations must be removed together with their callers.
    const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
    const sources: string[] = [];
    for (const relativePath of readdirSync(sourceRoot, { recursive: true }) as string[]) {
        if (![".ts", ".svelte"].includes(extname(relativePath))) continue;
        sources.push(readFileSync(join(sourceRoot, relativePath), "utf8"));
    }
    const combined = sources.join("\n");
    const unused = Object.keys(en).filter((key) => !new RegExp("\\b" + key + "\\b").test(combined));
    assert.deepEqual(unused, []);
});

test("AI、提醒和共享控件的新增文案提供双语翻译", () => {
    const expected = {
        aiReviewOverdue: ["Overdue", "逾期"],
        aiReviewNextActions: ["Next Actions", "下一步行动"],
        aiReviewInbox: ["Inbox", "收件箱"],
        aiReviewWaiting: ["Waiting", "等待中"],
        aiReviewSomeday: ["Someday/Maybe", "将来/也许"],
        aiReviewProjects: ["Active Projects", "活跃项目"],
        aiReviewDue: ["Review Due", "待回顾"],
        done: ["Done", "完成"],
        aiProposalEyebrow: ["AI Proposal · Task Extraction", "AI 建议 · 任务提取"],
        aiProposalKindProject: ["Project", "项目"],
        aiProposalKindTask: ["Task", "任务"],
        aiReviewEyebrow: ["NEXTACTION / REVIEW", "NEXTACTION / REVIEW"],
        reminderOverflow: ["{count} more reminders", "还有 {count} 条提醒"],
        errAiRawResponse: ["AI response cannot be used", "AI 返回内容无法使用"],
        errAiDialogHost: [
            "AI result window cannot be opened. Reload the plugin and try again.",
            "AI 结果窗口无法打开，请重新加载插件后再试",
        ],
        urlPlaceholder: ["URL", "URL"],
        openLink: ["Open link", "打开链接"],
        removeLabel: ["Remove", "移除"],
        modifiedLabel: ["Modified", "已修改"],
        add: ["Add", "添加"],
        customFieldOperator: ["Operator", "运算符"],
    } as const;
    for (const [key, [expectedEn, expectedZh]] of Object.entries(expected)) {
        assert.equal(en[key], expectedEn, `en.${key}`);
        assert.equal(zh[key], expectedZh, `zh.${key}`);
    }
});

test("用户可见文案通过 i18n 获取且 fallback 与英文翻译一致", () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
    const proposal = read("../src/frontend/components/AiProposalDialog.svelte");
    const review = read("../src/frontend/components/AiReviewDialog.svelte");
    const notificationHost = read("../src/frontend/components/NotificationHost.svelte");
    const aiSettings = read("../src/frontend/components/settings/AiSettingsPage.svelte");
    const aiService = read("../src/frontend/ai/ai-feature-service.ts");
    const accordion = read("../src/frontend/ui/NaAccordion.svelte");
    const linkInput = read("../src/frontend/ui/NaLinkInput.svelte");
    const chip = read("../src/frontend/ui/NaChip.svelte");
    const notificationCard = read("../src/frontend/components/NotificationCard.svelte");
    const contextMenu = read("../src/frontend/components/task-context-menu.ts");
    const taskDetail = read("../src/frontend/components/TaskDetail.svelte");
    const projectView = read("../src/frontend/components/ProjectView.svelte");

    for (const key of ["aiProposalEyebrow", "aiProposalKindProject", "aiProposalKindTask"]) {
        assert.match(proposal, new RegExp(`i18n\\?\\.${key}`));
    }
    assert.match(review, /i18n\?\.aiReviewEyebrow/);
    assert.match(notificationHost, /i18n\?\.reminderOverflow/);
    assert.match(aiSettings, /\{\{block:blockID\}\}/);
    assert.doesNotMatch(aiSettings, /\{\{block:块ID\}\}/);
    assert.match(aiService, /i18n\?\.errAiRawResponse/);
    assert.match(aiService, /i18n\?\.errAiDialogHost/);
    assert.match(accordion, /i18n\?\.modifiedLabel/);
    assert.match(linkInput, /i18n\?\.urlPlaceholder/);
    assert.match(linkInput, /i18n\?\.openLink/);
    assert.match(chip, /i18n\?\.removeLabel/);

    for (const source of [
        notificationHost,
        notificationCard,
        contextMenu,
        taskDetail,
        projectView,
        aiService,
        review,
    ]) {
        assert.doesNotMatch(
            source,
            /AI 拆解项目|AI 拆解任务|恢复重复|暂停重复|固定提醒|已逾期\{n\}|\{n\}(?:分钟|小时|天)后到期|只读建议/,
        );
    }
});
