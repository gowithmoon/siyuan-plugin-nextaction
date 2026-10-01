import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

const source = (path: string) => JSON.stringify(resolve(path));

for (const [width, height, mobile, dark] of [
    [360, 640, true, false],
    [360, 800, true, false],
    [390, 844, true, true],
    [844, 390, true, false],
] as const)
    test(`紧凑工作区 ${width}×${height} ${mobile ? "手机" : "桌面 Dock"} ${dark ? "深色" : "浅色"}`, async () => {
        // Regression: 移动 Dock 只能通过桌面式完整面板访问项目，缺少触摸导航与整页编辑。
        // Regression: 旧紧凑看板样式覆盖横向网格，横屏内容区不足可用高度的 70%。
        const result = await runSvelteBrowserTest<Record<string, unknown>>({
            fixtureName: "compact-workspace",
            browserArgs: [
                `--window-size=500,${Math.ceil((height * 500) / width)}`,
                `--force-device-scale-factor=${(500 / width).toFixed(6)}`,
                `--screenshot=${join(tmpdir(), `nextaction-${width}.png`)}`,
            ],
            virtualTimeBudget: 8000,
            files: {
                "siyuan.js": `export class Dialog { constructor() { throw new Error('mobile must not open a task dialog'); } }
export class Menu { addItem() {} addSeparator() {} open() {} }
export function confirm(_title, _message, yes) { yes(); }
export function openTab() {} export function showMessage() {}`,
                "Harness.svelte": `<script>
import MobileDockHost from ${source(`src/frontend/components/${mobile ? "MobileDockHost" : "DockSidebar"}.svelte`)};
import { taskStore } from ${source("src/frontend/stores/task-store.ts")};
import { DEFAULT_SETTINGS } from ${source("src/shared/settings.ts")};
import i18n from ${source("src/i18n/zh-CN.json")};
import ${source("src/index.scss")};
const base = { identificationSource:'native', contentBlockId:'', attrHostId:'', parentId:'', status:'todo', priority:'medium', importance:4, effort:4, due:'', start:'', context:'', taskType:'1', order:0, childIds:[], depends:'', depMode:'all', sequential:false, repeat:'', repeatState:'', sort:0, completed:'', note:'', outcome:'', dod:'', actionKind:'action', created:'', tags:'', blocked:false, blockedReason:'', reviewInterval:0, reviewDate:'', reminder:'', customFields:{} };
const project={...base,blockId:'20260910120000-project',attrHostId:'20260910120000-project',title:'季度计划 Project Alpha 的超长中英文项目标题',taskType:'2',identificationSource:'document',childIds:[]};
const action={...base,blockId:'20260910120000-actionx',attrHostId:'20260910120000-actionx',title:'整理项目资料与跨团队交付清单',parentId:project.blockId,start:'2026-09-10',due:'2026-09-20'};
const stage={...base,blockId:'20260910120000-stagexx',attrHostId:'20260910120000-stagexx',title:'准备阶段',parentId:project.blockId,actionKind:'stage',childIds:['20260910120000-deep001'],sort:100};
const deepOne={...base,blockId:'20260910120000-deep001',attrHostId:'20260910120000-deep001',title:'深层任务一',parentId:stage.blockId,childIds:['20260910120000-deep002'],sort:100};
const deepTwo={...base,blockId:'20260910120000-deep002',attrHostId:'20260910120000-deep002',title:'Deep nested task with a long bilingual title 深层任务二',parentId:deepOne.blockId,childIds:['20260910120000-deep003'],sort:100};
const deepThree={...base,blockId:'20260910120000-deep003',attrHostId:'20260910120000-deep003',title:'深层任务三',parentId:deepTwo.blockId,sort:100};
const extraActions=Array.from({length:18},(_,index)=>({...base,blockId:'20260910120000-extra'+String(index).padStart(2,'0'),attrHostId:'20260910120000-extra'+String(index).padStart(2,'0'),title:'Project action '+index,parentId:project.blockId,status:'doing',start:'2026-09-'+String(1+(index%20)).padStart(2,'0'),due:'2026-10-'+String(1+(index%20)).padStart(2,'0'),sort:200+index}));
const inbox={...base,blockId:'20260910120000-inboxxx',attrHostId:'20260910120000-inboxxx',title:'收集的想法',status:'inbox'};
project.childIds=[action.blockId,stage.blockId,...extraActions.map(task=>task.blockId)];
const tasks=[project,action,stage,deepOne,deepTwo,deepThree,...extraActions,inbox];
taskStore.applySettingsUpdate(DEFAULT_SETTINGS);
for (const task of tasks) taskStore.applyUpdate(task);
const day = {date:'2026-09-10',tasks:[{blockId:tasks[1].blockId,addedAt:1,scheduleStart:60,scheduleEnd:120,order:0}],updatedAt:1};
taskStore.applyMyDayUpdate(day);
window.fixtureTasks = tasks;
window.scheduleWrites = [];
window.createdCalls = 0;
window.createdReadCalls = 0;
window.boardMoves = [];
window.hierarchyMoves = [];
const bridge = {
 getTask:async(id)=>{if(id==='20260910120000-created' && window.createdReadCalls++===0) throw new Error('read unavailable'); return tasks.find(t=>t.blockId===id);},
 moveProjectBoardTask:async(input)=>{window.boardMoves.push(input);return {status:'success',task:tasks.find(task=>task.blockId===input.taskId),reordered:true};},
 getProjectBoardPreferences:async()=>({version:1,projects:{}}),
 updateProjectBoardPreference:async()=>({version:1,projects:{}}),
 getProjectSupport:async(projectId)=>({projectId,items:[]}),
 listMcpTargetNotebooks:async()=>[],
 getMyDay:async()=>day,
 setMyDaySchedule:async(id,start,end)=>{window.scheduleWrites.push({id,start,end});return {...day,tasks:day.tasks.map(entry=>entry.blockId===id?{...entry,scheduleStart:start,scheduleEnd:end}:entry)};},
 updateTask:async(id,attrs)=>{ const task=tasks.find(t=>t.blockId===id); const updated={...task}; for (const [key,value] of Object.entries(attrs)) { if (key==='na-status') updated.status=value; } return updated; },
 reorderTask:async(id,parentId,afterId)=>{window.hierarchyMoves.push({id,parentId,afterId});const task=tasks.find(entry=>entry.blockId===id);const siblings=tasks.filter(entry=>entry.parentId===parentId&&entry.blockId!==id).sort((left,right)=>left.sort-right.sort||left.blockId.localeCompare(right.blockId));const index=afterId?siblings.findIndex(entry=>entry.blockId===afterId)+1:0;const previous=siblings[index-1]?.sort??-100;const next=siblings[index]?.sort??previous+200;const updated={...task,parentId,sort:previous+(next-previous)/2};Object.assign(task,updated);return updated;},
 createTask:async(input)=>{window.createdCalls++; const task={...base,blockId:'20260910120000-created',attrHostId:'20260910120000-created',title:input.title,status:'inbox'};tasks.push(task);return {task:{id:task.blockId,title:task.title},warnings:[],destination:{}};},
};
</script>
<main><MobileDockHost {bridge} {i18n} /></main>
<style>
:global(html),:global(body),:global(#app),main { margin:0; width:100%; height:100%; }
:global(#browser-result) { display:none; }
${dark ? `:global(:root) { --b3-theme-background:#202124 !important; --b3-theme-surface:#292b2e !important; --b3-theme-on-background:#e4e5e8 !important; --b3-theme-on-surface:#c6c9cf !important; }` : ""}
:global(:root) { --b3-theme-background:#fff; --b3-theme-surface:#f5f6f8; --b3-theme-surface-light:#eceff2; --b3-theme-on-background:#202124; --b3-theme-on-surface:#454950; --b3-theme-on-surface-light:#62666d; --b3-theme-primary:#3565b5; --b3-theme-primary-light:#dbe6f8; --b3-theme-primary-lightest:#eaf0fa; --b3-border-color:#d5d9df; --b3-font-family:Arial,sans-serif; --b3-border-radius:6px; --b3-list-hover:#eaf0fa; --b3-card-info-color:#3465aa; --b3-card-warning-color:#8c6400; --b3-card-success-color:#257347; --b3-card-error-color:#ac3333; --b3-select-background:#fff; }
</style>`,
                "main.js": `import {mount,tick} from 'svelte'; import Harness from './Harness.svelte';
const errors=[]; window.addEventListener('error',event=>errors.push(event.message)); window.addEventListener('unhandledrejection',event=>errors.push(String(event.reason)));
mount(Harness,{target:document.querySelector('#app')});
const pause=async(ms=80)=>{await tick();await new Promise(r=>setTimeout(r,ms));};
const click=(label,root=document)=>{const button=[...root.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')||b.textContent.trim())===label);if(!button)throw Error('Missing '+label);button.click();};
(async()=>{
 await pause();
 const out={hasDesktopRail:!!document.querySelector('.na-nav-rail'),themeBackground:getComputedStyle(document.documentElement).getPropertyValue('--b3-theme-background').trim()};
  const nav=()=>document.querySelector('${mobile ? ".na-compact-nav--bottom" : ".na-compact-nav"}');
 const catalog=()=>click('全部视图',${mobile ? 'document.querySelector(".na-compact-nav--bottom")' : "document"});
 // Regression: 移动端“全部任务”和“全部视图”曾共用图标，且视图面板顶部出现来源不明的“项目”快捷入口。
 const navIcon=(label)=>nav().querySelector('button[aria-label="'+label+'"] use')?.getAttribute('href');
 out.allTasksNavigationIcon=navIcon('全部任务');
 out.allViewsNavigationIcon=nav().querySelector('button:last-child use')?.getAttribute('href');
 click('全部任务',nav());await pause();
 out.allTasksHeader=document.querySelector('.na-workspace__header h1')?.textContent;
 catalog(); await pause();
 out.projectShortcutAbsent=![...document.querySelectorAll('.na-mobile-view-picker__sheet button')].some(button=>button.textContent.trim()==='项目');
 out.catalogCount=document.querySelectorAll('.na-view-directory button').length;
 click('项目视图',document.querySelector('.na-view-directory'));await pause();
 out.startsWithProjectList=!!document.querySelector('.na-project-index')&&!document.querySelector('.na-project-canvas');
 document.querySelector('.na-project-index__item').click();await pause();
 out.projectDrilldown=!!document.querySelector('.na-project-canvas')&&!document.querySelector('.na-project-index');
 out.projectHeaderOnly=!document.querySelector('.na-workspace__header')&&!!document.querySelector('.na-project-compact-toolbar');
 const projectTitle=document.querySelector('.na-project-compact-title');out.projectTitleSingleLine=projectTitle.textContent.includes('Project Alpha')&&getComputedStyle(projectTitle).whiteSpace==='nowrap';
 click('任务操作',document.querySelector('.na-project-compact-toolbar'));await pause();
 const projectActions=document.querySelector('.na-page-host');
 out.repeatedProjectViewsAbsent=![...projectActions.querySelectorAll('button')].some(button=>/层级|甘特/.test(button.textContent));
 click('返回',projectActions);await pause();
 const mode=document.querySelector('.na-project-compact-toolbar select');
 const chooseMode=(value)=>{mode.value=value;mode.dispatchEvent(new Event('change',{bubbles:true}));};
 out.modes=[...mode.options].map(o=>o.value);
 out.modesFit=true;
 const surfaces={overview:'.na-project-overview',hierarchy:'.na-project-tree',board:'.na-project-board',plan:'.na-project-plan',gantt:'.na-gantt'};
 out.modeSurfaces=[];
 for(const value of out.modes) {chooseMode(value);await pause();const panel=document.querySelector('.na-app');out.modesFit&&=panel.scrollWidth<=panel.clientWidth;out.modeSurfaces.push(Boolean(document.querySelector(surfaces[value])));}

 chooseMode('hierarchy');await pause();
 const treeRows=()=>[...document.querySelectorAll('.na-project-tree__row')];
 out.deepHierarchy=Math.max(...treeRows().map(row=>Number(row.getAttribute('aria-level'))))>=5;
 const firstTreeRow=treeRows()[0];firstTreeRow.focus();firstTreeRow.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));await pause();
 out.hierarchyKeyboardFocus=document.activeElement===treeRows()[1]&&getComputedStyle(document.activeElement).outlineStyle!=='none';
 const stageRow=treeRows().find(row=>row.textContent.includes('准备阶段'));
 const collapse=stageRow.querySelector('.na-task-card__actions button');const expandedCount=treeRows().length;collapse.click();await pause();const collapsedCount=treeRows().length;stageRow.querySelector('.na-task-card__actions button').click();await pause();
 out.hierarchyCollapse=collapsedCount<expandedCount&&treeRows().length===expandedCount;
 const movableRow=treeRows().find(row=>row.textContent.includes('Project action 0'));const beforeMove=treeRows().map(row=>row.textContent);movableRow.querySelector('.na-task-card__actions button').click();await pause();click('下移',document.querySelector('.na-page-host'));await pause();const afterMove=treeRows().map(row=>row.textContent);out.hierarchyMove=window.hierarchyMoves.length===1&&afterMove.indexOf(beforeMove.find(title=>title.includes('Project action 0')))>afterMove.indexOf(beforeMove.find(title=>title.includes('Project action 1')));click('返回',document.querySelector('.na-page-host'));await pause();

 chooseMode('board');await pause();
 const board=document.querySelector('.na-project-board__columns');const boardCards=[...document.querySelectorAll('.na-project-board__cards')];const boardScrollable=boardCards.find(node=>node.scrollHeight>node.clientHeight);
 board.scrollLeft=board.clientWidth;if(boardScrollable)boardScrollable.scrollTop=40;await pause();
 out.boardColumns=document.querySelectorAll('.na-project-board__column').length;
 out.boardScroll=board.scrollWidth>board.clientWidth&&board.scrollLeft>0&&Boolean(boardScrollable&&boardScrollable.scrollTop>0);
 const boardCanvas=document.querySelector('.na-project-canvas');const boardHeightRatio=board.getBoundingClientRect().height/boardCanvas.getBoundingClientRect().height;out.boardFillsHeight=boardHeightRatio>=0.7;
 out.boardPagerAbsent=!document.querySelector('.na-project-board__pager');
 document.querySelector('.na-project-board__header button').click();await pause();
 const grouping=document.querySelector('#na-project-board-settings-group-by');grouping.value='stage';grouping.dispatchEvent(new Event('change',{bubbles:true}));await pause();click('应用',document.querySelector('.na-page-host'));await pause();
 const card=document.querySelector('.na-project-board__card');
 if(!card) throw Error('stage board has no action');
 click('任务操作',card);await pause();
 const destination=document.querySelector('.na-page-host select');const option=[...destination.options].find(option=>option.textContent==='准备阶段');destination.value=option.value;destination.dispatchEvent(new Event('change',{bubbles:true}));await pause();
 click('应用',document.querySelector('.na-page-host'));await pause();
 out.stageMove=window.boardMoves.length===1 && window.boardMoves[0].groupBy==='stage' && window.boardMoves[0].value==='20260910120000-stagexx';

 chooseMode('gantt');await pause();
 const gantt=document.querySelector('.na-gantt');const ganttViewport=document.querySelector('.na-gantt__viewport');const canvas=document.querySelector('.na-project-canvas');
 out.ganttLongTitle=[...document.querySelectorAll('.na-gantt-bar')].some(node=>node.getAttribute('aria-label')?.includes('整理项目资料与跨团队交付清单'));
 out.ganttUnscheduled=Boolean(document.querySelector('.na-gantt__unscheduled-label'));
 ganttViewport.scrollLeft=120;ganttViewport.scrollTop=96;ganttViewport.dispatchEvent(new Event('scroll'));await pause();const savedGantt={left:ganttViewport.scrollLeft,top:ganttViewport.scrollTop};
 const ganttHeightRatio=gantt.getBoundingClientRect().height/canvas.getBoundingClientRect().height;const ganttBottomGap=canvas.getBoundingClientRect().bottom-gantt.getBoundingClientRect().bottom;out.ganttFillsHeight=ganttHeightRatio>=0.7;
 out.ganttBottomAligned=ganttBottomGap<=8;
 chooseMode('plan');await pause();chooseMode('gantt');await pause();const restoredGantt=document.querySelector('.na-gantt__viewport');
 out.ganttScrollRestored=restoredGantt.scrollLeft===savedGantt.left&&restoredGantt.scrollTop===savedGantt.top;
 chooseMode('board');await pause();

 click('我的一天',nav());await pause();
 out.myDayHasAdd=!!document.querySelector('.na-myday-add');
 click('时间线');await pause();
 ${mobile ? `const timeline=document.querySelector('.na-timeline-card'); if(timeline) { timeline.dispatchEvent(new PointerEvent('pointerdown',{pointerType:'touch',clientY:80,bubbles:true}));document.dispatchEvent(new PointerEvent('pointermove',{pointerType:'touch',clientY:180,bubbles:true}));document.dispatchEvent(new PointerEvent('pointerup',{pointerType:'touch',clientY:180,bubbles:true})); } await pause();out.touchDoesNotWrite=!!timeline && window.scheduleWrites.length===0;` : ""}

 // 排期行属于列表模式；时间线触摸行为验证后切换到列表继续编辑排期。
 const listMode=[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='列表');
 if(listMode) { listMode.click(); await pause(); }

 const scheduleList=[...document.querySelectorAll('.na-accordion__trigger')].find(button=>button.textContent.includes('已排期任务')) || document.querySelector('.na-accordion__trigger');
 if(!scheduleList) throw Error('Missing My Day schedule accordion');
 scheduleList.click();await pause();
 const scheduleRow=document.querySelector('.na-myday-schedule-row');
 if(!scheduleRow) throw Error('Missing My Day schedule row');
 click('安排时间',scheduleRow);await pause();
 const time=document.querySelector('.na-schedule-editor input[type="time"]');time.value='07:30';time.dispatchEvent(new Event('input',{bubbles:true}));
 const duration=document.querySelector('.na-schedule-editor input[type="number"]');duration.value='45';duration.dispatchEvent(new Event('input',{bubbles:true}));
 document.querySelector('.na-schedule-editor').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await pause();
 out.scheduleEdited=window.scheduleWrites.length===1 && window.scheduleWrites[0].start===150 && window.scheduleWrites[0].end===195;
 catalog();await pause();
 ${!mobile ? `click('项目视图',document.querySelector('.na-view-directory'));await pause();` : ""}
 out.projectModeRestored=document.querySelector('.na-project-compact-toolbar select')?.value;
 document.querySelector('.na-project-compact-toolbar button').click();await pause();
 out.backToProjectList=!!document.querySelector('.na-project-index');
 out.workspaceHeaderRestored=!!document.querySelector('.na-workspace__header');
 click('下一步行动',nav());await pause();
 const filters=()=>[...document.querySelectorAll('.na-task-filter-bar button')].find(button=>button.textContent.includes('筛选与排序'));
 filters().click();await pause();
 const selectPriority=async()=>{const panel=document.querySelector('.na-page-host');const trigger=[...panel.querySelectorAll('.na-filter-dropdown__trigger')].find(button=>button.textContent.includes('优先级'));trigger.click();await pause();const input=panel.querySelector('.na-filter-dropdown__panel input');input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));await pause();};
 await selectPriority();
 click('取消',document.querySelector('.na-page-host'));await pause();
 out.filterCancelled=document.querySelectorAll('.na-task-card').length>0;
 filters().click();await pause();await selectPriority();
 click('应用',document.querySelector('.na-page-host'));await pause();
 out.filterApplied=document.querySelectorAll('.na-task-card').length===0;
 filters().click();await pause();click('清除筛选',document.querySelector('.na-page-host'));await pause();click('应用',document.querySelector('.na-page-host'));await pause();
 ${
     mobile
         ? `document.querySelector('.na-task-card__title').click();await pause();
 out.pageDetail=!!document.querySelector('.na-dialog-shell--page');
 out.backgroundInert=document.querySelector('.na-app__center').inert;
 click('返回',document.querySelector('.na-page-host'));await pause();
 out.detailReturned=!document.querySelector('.na-page-host');
 click('新建任务',document.querySelector('.na-workspace__header'));await pause();
 out.pageCreate=!!document.querySelector('.na-page-host .na-create-task');
 const input=document.querySelector('.na-create-task__title');input.value='手机新任务';input.dispatchEvent(new Event('input',{bubbles:true}));
 document.querySelector('.na-create-task').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await pause(150);
 out.readFailureRetained=!!document.querySelector('.na-create-task__error') && window.createdCalls===1;
 click('重试',document.querySelector('.na-page-host'));await pause();
 out.createdDetail=document.querySelector('.na-dialog-shell--page h2')?.textContent;
 click('返回',document.querySelector('.na-page-host'));await pause();
 out.createdOnce=window.createdCalls===1;
 `
         : ""
 }
 out.noOverflow=document.querySelector('.na-app').scrollWidth<=document.querySelector('.na-app').clientWidth;
 out.errors=errors;window.__NA_BROWSER_RESULT__(out);
})().catch(error=>window.__NA_BROWSER_RESULT__({error:String(error.stack),pages:[...document.querySelectorAll('.na-page-host')].map(n=>({html:n.innerHTML.slice(0,2500),inert:n.inert})),errors}));`,
            },
        });
        assert.deepEqual(result, {
            hasDesktopRail: false,
            themeBackground: dark ? "#202124" : "#fff",
            allTasksNavigationIcon: "#iconList",
            allViewsNavigationIcon: "#iconLayoutGrid",
            allTasksHeader: "全部任务",
            projectShortcutAbsent: true,
            catalogCount: 9,
            startsWithProjectList: true,
            projectDrilldown: true,
            projectHeaderOnly: true,
            projectTitleSingleLine: true,
            repeatedProjectViewsAbsent: true,
            modes: ["overview", "hierarchy", "board", "plan", "gantt"],
            modesFit: true,
            modeSurfaces: [true, true, true, true, true],
            deepHierarchy: true,
            hierarchyKeyboardFocus: true,
            hierarchyCollapse: true,
            hierarchyMove: true,
            boardColumns: 6,
            boardScroll: true,
            boardFillsHeight: true,
            boardPagerAbsent: true,
            stageMove: true,
            ganttFillsHeight: true,
            ganttBottomAligned: true,
            ganttScrollRestored: true,
            ganttLongTitle: true,
            ganttUnscheduled: true,
            scheduleEdited: true,
            myDayHasAdd: true,
            projectModeRestored: "board",
            backToProjectList: true,
            workspaceHeaderRestored: true,
            filterCancelled: true,
            filterApplied: true,
            ...(mobile
                ? {
                      touchDoesNotWrite: true,
                      pageDetail: true,
                      backgroundInert: true,
                      detailReturned: true,
                      pageCreate: true,
                      createdDetail: "手机新任务",
                      createdOnce: true,
                      readFailureRetained: true,
                  }
                : {}),
            noOverflow: true,
            errors: [],
        });
    });
