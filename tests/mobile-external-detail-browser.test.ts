import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

const source = (path: string) => JSON.stringify(resolve(path));
for (const frontend of ["mobile", "browser-mobile"]) {
    test(`${frontend} 外部详情与子任务创建共享页面栈`, async () => {
        // Regression: 外部详情曾使用桌面 Dialog，且移动宿主重复页头、嵌套创建无法恢复详情。
        const result = await runSvelteBrowserTest<Record<string, unknown>>({
            fixtureName: "mobile-external-detail",
            virtualTimeBudget: 4000,
            files: {
                "siyuan.js": `export const getFrontend=()=> '${frontend}';export class Dialog{constructor(){throw new Error('unexpected desktop dialog');}}export class Menu{}export function showMessage(){}export function openTab(){}export function confirm(_t,_m,yes){yes();}`,
                "main.js": `import {tick} from 'svelte';
import {openTaskDetailDialog} from ${source("src/frontend/dialogs/task-detail-dialog.ts")};
import {openCreateTaskDialog} from ${source("src/frontend/dialogs/create-task-dialog.ts")};
import {taskStore} from ${source("src/frontend/stores/task-store.ts")};
import {DEFAULT_SETTINGS} from ${source("src/shared/settings.ts")};
import i18n from ${source("src/i18n/zh-CN.json")};
import ${source("src/index.scss")};
const task={blockId:'20260910120000-actionx',identificationSource:'native',contentBlockId:'20260910120000-actionx',attrHostId:'20260910120000-actionx',title:'外部任务',taskType:'1',status:'todo',priority:'medium',importance:4,effort:4,childIds:[],customFields:{},parentId:'',context:'',tags:'',repeat:'',repeatState:'',reviewInterval:0,blocked:false,start:'',due:'',depends:'',depMode:'all',note:'',outcome:'',dod:'',actionKind:'action',created:'',completed:'',sort:0,order:0};
taskStore.applySettingsUpdate(DEFAULT_SETTINGS);
const bridge={getTask:async()=>task,listMcpTargetNotebooks:async()=>[],getCompletedTasksPage:async()=>({tasks:[],total:0})};
const pause=()=>new Promise(r=>setTimeout(r,80));
const pages=()=>[...document.querySelectorAll('.na-page-host')];
(async()=>{try{const out={};let childPromise;
await openTaskDetailDialog({blockId:task.blockId,bridge,i18n,onCreateChild:parentTask=>{out.parentId=parentTask.blockId;childPromise=openCreateTaskDialog({bridge,i18n,parentTask});}});await pause();await tick();
const root=document.querySelector('.na-mobile-task-detail-root');out.opened=!!root;out.initialPages=pages().length;out.headerCount=root.querySelectorAll('.na-dialog-header').length;
const actions=root.querySelector('button[aria-label="'+i18n.taskActions+'"]');actions.focus();actions.click();await tick();await pause();
const child=[...document.querySelectorAll('.na-task-detail__page-actions button')].find(b=>b.textContent.includes(i18n.createChildTask));child.focus();child.click();await childPromise;await pause();await tick();
const createRoot=document.querySelector('.na-mobile-create-task-root');const detailPage=pages()[0];out.sharedRoot=createRoot.closest('.na-app')===root;out.nestedPages=pages().length;out.detailInert=detailPage.inert;
const top=pages().at(-1);top.focus();top.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await pause();await tick();out.afterChild=pages().length;out.restored=!detailPage.inert;out.createRemoved=!document.querySelector('.na-mobile-create-task-root');
detailPage.focus();detailPage.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await pause();await tick();out.closed=pages().length===0&&!document.querySelector('.na-mobile-task-detail-root');window.__NA_BROWSER_RESULT__(out);
}catch(error){window.__NA_BROWSER_RESULT__({error:String(error),stack:error.stack,html:document.body.innerHTML.slice(0,700)});}})();`,
            },
        });
        assert.equal(result.error, undefined, JSON.stringify(result));
        assert.equal(result.opened, true);
        assert.equal(result.initialPages, 1);
        assert.equal(result.headerCount, 1);
        assert.equal(result.parentId, "20260910120000-actionx");
        assert.equal(result.sharedRoot, true);
        assert.equal(result.nestedPages, 2);
        assert.equal(result.detailInert, true);
        assert.equal(result.afterChild, 1);
        assert.equal(result.restored, true);
        assert.equal(result.createRemoved, true);
        assert.equal(result.closed, true);
    });
}
