import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

const source = (path: string) => JSON.stringify(resolve(path));

test("移动时间轴：仅长按空白排期、独立手柄和滚动期间持续调整", async () => {
    // Regression: 未排期面板挤占时间轴，短卡片手柄重叠，滚动导致调整丢失或时间不跟随。
    const result = await runSvelteBrowserTest<any>({
        fixtureName: "mobile-timeline",
        browserArgs: ["--window-size=390,844"],
        virtualTimeBudget: 12000,
        files: {
            "siyuan.js": `export class Menu{addItem(){}addSeparator(){}open(){}} export function showMessage(){window.errors++;} export function openTab(){} export function confirm(){}`,
            "Harness.svelte": `<script>
import {provideWorkspace} from ${source("src/frontend/workspace-context.ts")};
import {taskStore} from ${source("src/frontend/stores/task-store.ts")};
import TimelineView from ${source("src/frontend/components/timeline/TimelineView.svelte")};
import i18n from ${source("src/i18n/zh-CN.json")};
import ${source("src/index.scss")};
window.writes=[];window.adds=[];window.opens=0;window.editors=0;window.errors=0;window.contexts=[];
const task=(blockId,title,status='todo')=>({blockId,title,status,taskType:'1',priority:'high',importance:6,effort:2,childIds:[],customFields:{},parentId:'',context:'',tags:'',repeat:'',repeatState:'',reviewInterval:0,blocked:false});
for(const t of [task('a','已排期'),task('b','未排期'),task('c','新增任务'),task('d','已完成','done'),task('e','将来也许','someday')]) taskStore.applyUpdate(t);
const entry=(blockId,start,end)=>({blockId,scheduleStart:start,scheduleEnd:end,addedAt:1,order:0});
let day={schema:1,dayKey:'2026-09-19',updatedAt:1,tasks:[entry('a',300,360),entry('b',null,null)]};
window.reset=(start=300,end=360)=>{day={...day,tasks:[entry('a',start,end),entry('b',null,null)]};taskStore.applyMyDayUpdate(day);};
window.reset();
window.adjacent=()=>{day={...day,tasks:[entry('a',300,315),entry('b',315,330)]};taskStore.applyMyDayUpdate(day);};
const bridge={getCompletedTasksPage:async()=>({tasks:[],total:0}),addTaskToMyDay:async(id)=>{window.adds.push(id);day={...day,tasks:[...day.tasks,entry(id,null,null)]};return day;},setMyDaySchedule:async(id,start,end)=>{window.writes.push([id,start,end]);if(window.fail)throw new Error('save failed');day={...day,tasks:day.tasks.map(e=>e.blockId===id?{...e,scheduleStart:start,scheduleEnd:end}:e)};return day;}};
const workspace=provideWorkspace('mobile-dock',bridge);
workspace.openTask=()=>window.opens++;workspace.openSchedule=()=>window.editors++;
let visible=$state(true);window.hide=()=>visible=false;
</script>
<div class="nextaction na-app na-workspace--touch" style="width:360px;height:680px;position:relative;display:flex;flex-direction:column">
<div id="other" class="na-timeline-column" style="height:1px;flex:none;overflow-y:auto"></div>
{#if visible}<TimelineView {bridge} {i18n} defaultDuration={45} onContextMenu={(task,event)=>window.contexts.push([task.blockId,event.clientX,event.clientY])} />{/if}
</div>`,
            "main.js": `import {mount,tick} from 'svelte';import Harness from './Harness.svelte';
mount(Harness,{target:document.getElementById('app')});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{try{
await pause(200);await tick();const out={};
const col=document.querySelector('.na-timeline-view .na-timeline-column');const body=col.querySelector('.na-timeline-column__body');
const card=()=>col.querySelector('.na-timeline-card');const sheet=()=>document.querySelector('.na-option-picker');
const emit=(el,type,x,y,id=1)=>el.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'touch',pointerId:id,isPrimary:true,button:0,clientX:x,clientY:y}));
async function reset(start=300,end=360){window.reset(start,end);await tick();col.scrollTop=240;await pause(20);}
async function blank(minute=420,long=false){col.scrollTop=240;await pause(20);const r=col.getBoundingClientRect(),x=r.left+80,y=r.top+minute*1.2-col.scrollTop;emit(body,'pointerdown',x,y);if(long)await pause(470);emit(body,'pointerup',x,y);await tick();}
async function close(){document.querySelector('.na-page-host__header button')?.click();await tick();}
const root=document.querySelector('.na-app');
const rootScrolls=[];root.addEventListener('scroll',()=>rootScrolls.push(root.scrollTop));
const originalColumn=col;
out.noPanel=!document.querySelector('.na-unscheduled');out.ratio=col.clientHeight/document.querySelector('.na-timeline-view').clientHeight;
await blank();body.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));await pause(470);out.tapNoPicker=!sheet();await close();
await blank(420,true);await pause(220);sheet().querySelector('input').focus();await pause(60);out.openScrolls=[root.scrollTop,col.scrollTop,...rootScrolls];out.sameColumn=originalColumn===document.querySelector('.na-timeline-view .na-timeline-column');out.options=[...sheet().querySelectorAll('button')].map(e=>e.textContent.trim());out.time=document.querySelector('.na-page-host h2').textContent;
sheet().querySelector('button').dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));await tick();out.noOpeningClickWrite=window.writes.length===0;
sheet().querySelector('button').click();await tick();await pause(10);out.existing=window.writes.at(-1);out.existingAdds=window.adds.length;
await blank(480,true);out.longPress=!!sheet();const search=sheet().querySelector('input');search.value='新增';search.dispatchEvent(new Event('input',{bubbles:true}));await tick();out.searchCount=sheet().querySelectorAll('button').length;
window.fail=true;sheet().querySelector('button').click();await pause(20);out.failureKeepsPicker=!!sheet();out.failureUnlocks=!sheet().querySelector('button').disabled;window.fail=false;sheet().querySelector('button').click();await pause(20);out.newTask=window.writes.at(-1);out.newAdds=window.adds.length;
await reset();let r=col.getBoundingClientRect(),x=r.left+80,y=r.top+240;
emit(body,'pointerdown',x,y);emit(body,'pointermove',x,y+30);await pause(470);emit(body,'pointerup',x,y+30);await tick();out.scrollNoPicker=!sheet();
emit(body,'pointerdown',x,y);col.dispatchEvent(new Event('scroll'));await pause(470);emit(body,'pointerup',x,y);out.scrollCancelsLongPress=!sheet();
emit(body,'pointerdown',x,y);emit(body,'pointercancel',x,y);await pause(470);out.cancelNoPicker=!sheet();
emit(body,'pointerdown',r.left+20,y);await pause(470);emit(body,'pointerup',r.left+20,y);await tick();out.gutterNoPicker=!sheet();
const line=col.querySelector('.na-timeline-slot');emit(line,'pointerdown',x,y);await pause(470);emit(line,'pointerup',x,y);await tick();out.tickNoPicker=!sheet();
card().click();await tick();out.openCount=window.opens;out.cardNoPicker=!sheet();
const cr=card().getBoundingClientRect();const cx=cr.x+40,cy=cr.y+20;
emit(card(),'pointerdown',cx,cy);await pause(480);emit(card(),'pointerup',cx,cy);
card().dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1,clientX:cx,clientY:cy}));
card().dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:cx,clientY:cy}));
await tick();out.longPressContexts=window.contexts.length;out.longPressNoDetail=window.opens===out.openCount;
const firstContextCount=window.contexts.length;
for(const interrupt of ['move','pointercancel','scroll']){
 emit(card(),'pointerdown',cx,cy);
 if(interrupt==='move')emit(card(),'pointermove',cx,cy+20);
 else if(interrupt==='scroll')col.dispatchEvent(new Event('scroll'));
 else emit(card(),interrupt,cx,cy);
 await pause(470);emit(card(),'pointerup',cx,cy);
}
out.interruptedNoContext=window.contexts.length===firstContextCount;
emit(card(),'pointerdown',cx,cy);await pause(470);emit(card(),'pointerup',cx,cy);out.repeatContext=window.contexts.length===firstContextCount+1;
emit(card(),'pointerdown',cx,cy);card().dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:cx,clientY:cy}));await pause(470);emit(card(),'pointerup',cx,cy);out.nativeContextOnce=window.contexts.length===firstContextCount+2;
out.pcContent=!!card().querySelector('.na-timeline-card__content');out.cardRadius=getComputedStyle(card()).borderRadius;
emit(card(),'pointerdown',r.left+80,r.top+280);await pause(470);emit(card(),'pointerup',r.left+80,r.top+280);await tick();out.retargetedBlank=!!sheet();await close();
const prior=window.writes.length;const bodyRect=card().getBoundingClientRect();const bx=bodyRect.x+50,by=bodyRect.y+20;emit(card(),'pointerdown',bx,by);emit(card(),'pointermove',bx,by+60);emit(card(),'pointerup',bx,by+60);out.bodyNoDrag=window.writes.length===prior;
async function handle(index){if(!card().querySelector('.na-drag-handle')){card().querySelector('.na-timeline-card__edit button').click();await tick();}return card().querySelectorAll('.na-drag-handle')[index];}
let h=await handle(1);out.handles=[...card().querySelectorAll('.na-drag-handle')].map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,touch:getComputedStyle(el).touchAction}));out.handleNoPicker=!sheet();
r=h.getBoundingClientRect();x=r.x+r.width/2;y=r.y+r.height/2;
emit(h,'pointerdown',x,y);out.locked=col.style.overflowY==='hidden';out.otherUnlocked=document.getElementById('other').style.overflowY==='auto';
emit(h,'pointermove',x,y+36);col.scrollTop+=72;col.dispatchEvent(new Event('scroll'));await tick();out.scrollPreview=parseFloat(card().style.top);out.stillDragging=card().classList.contains('na-timeline-card--dragging');
const count=window.writes.length;emit(h,'pointerup',x,y+36);emit(h,'pointerup',x,y+36);await pause(20);out.moved=window.writes.at(-1);out.singleWrite=window.writes.length===count+1;out.unlocked=col.style.overflowY==='';
await reset();h=await handle(0);r=h.getBoundingClientRect();x=r.x+20;y=r.y+20;emit(h,'pointerdown',x,y);emit(h,'pointermove',x,y-36);emit(h,'pointerup',x,y-36);await pause(10);out.startResize=window.writes.at(-1);
await reset();h=await handle(2);r=h.getBoundingClientRect();x=r.x+20;y=r.y+20;emit(h,'pointerdown',x,y);emit(h,'pointermove',x,y+36);emit(h,'pointerup',x,y+36);await pause(10);out.endResize=window.writes.at(-1);
for(const event of ['pointercancel','lostpointercapture']){await reset();h=await handle(1);r=h.getBoundingClientRect();const n=window.writes.length;emit(h,'pointerdown',r.x+20,r.y+20);emit(h,'pointermove',r.x+20,r.y+60);emit(h,event,r.x+20,r.y+60);out[event]=col.style.overflowY===''&&!card().classList.contains('na-timeline-card--dragging')&&window.writes.length===n;}
await reset();h=await handle(1);r=h.getBoundingClientRect();emit(h,'pointerdown',r.x+20,r.y+20);emit(h,'pointermove',r.x+20,r.y+56);window.fail=true;emit(h,'pointerup',r.x+20,r.y+56);await pause(10);out.failedDrag=col.style.overflowY===''&&parseFloat(card().style.top)===360;out.errorCount=window.errors;window.fail=false;
await reset(300,315);h=await handle(1);out.shortTitle=card().querySelector('.na-timeline-card__name').textContent;out.shortHandleHeight=h.getBoundingClientRect().height;
window.adjacent();await tick();out.adjacentHandles=[...card().querySelectorAll('.na-drag-handle')].every(el=>{const rect=el.getBoundingClientRect();return el.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));});
await pause(450);h.click();await tick();out.editorOpened=window.editors===1;
h=await handle(1);r=h.getBoundingClientRect();emit(h,'pointerdown',r.x+20,r.y+20);emit(h,'pointermove',r.x+20,r.y+56);window.hide();await tick();out.destroyUnlock=col.style.overflowY==='';
window.__NA_BROWSER_RESULT__(out);
}catch(error){window.__NA_BROWSER_RESULT__({error:String(error),stack:error.stack});}})();`,
        },
    });
    assert.equal(result.error, undefined, result.stack);
    // Regression: 轻触时间轴空白处容易误开选择器，必须仅由长按触发，松手后也不能延迟弹出。
    assert.equal(result.tapNoPicker, true);
    assert.equal(result.scrollCancelsLongPress, true);
    // Regression: 长按时间轴空白处打开选任务浮层，不得滚动背景或重建时间轴。
    assert.equal(result.sameColumn, true);
    assert.equal(result.openScrolls[0], 0, JSON.stringify(result.openScrolls));
    assert.equal(result.openScrolls[1], 240, JSON.stringify(result.openScrolls));
    assert.ok(
        result.openScrolls.slice(2).every((value: number) => value === 0),
        JSON.stringify(result.openScrolls),
    );
    // Regression: 移动卡片长按应只触发一次与 PC 相同的右键菜单，松手不打开详情。
    assert.equal(result.longPressContexts, 1);
    assert.equal(result.longPressNoDetail, true);
    assert.equal(result.interruptedNoContext, true);
    assert.equal(result.repeatContext, true);
    assert.equal(result.nativeContextOnce, true);
    assert.equal(result.pcContent, true);
    assert.equal(result.cardRadius, "8px");
    for (const key of [
        "noPanel",
        "longPress",
        "failureKeepsPicker",
        "failureUnlocks",
        "scrollNoPicker",
        "cancelNoPicker",
        "gutterNoPicker",
        "tickNoPicker",
        "cardNoPicker",
        "bodyNoDrag",
        "handleNoPicker",
        "locked",
        "otherUnlocked",
        "stillDragging",
        "singleWrite",
        "unlocked",
        "pointercancel",
        "lostpointercapture",
        "failedDrag",
        "editorOpened",
        "destroyUnlock",
    ]) {
        assert.equal(result[key], true, `${key}: ${JSON.stringify(result)}`);
    }
    assert.ok(result.ratio > 0.94, JSON.stringify(result));
    assert.deepEqual(result.options, ["未排期", "新增任务"]);
    assert.ok(result.time.includes("12:00 - 12:45"));
    assert.deepEqual(result.existing, ["b", 420, 465]);
    assert.equal(result.existingAdds, 0);
    assert.deepEqual(result.newTask, ["c", 480, 525]);
    assert.equal(result.newAdds, 1);
    assert.equal(result.searchCount, 1);
    assert.equal(result.openCount, 1);
    for (const h of result.handles) {
        assert.ok(h.width >= 44 && h.height >= 44);
        assert.equal(h.touch, "none");
    }
    assert.equal(result.scrollPreview, 468);
    assert.deepEqual(result.moved, ["a", 390, 450]);
    assert.deepEqual(result.startResize, ["a", 270, 360]);
    assert.deepEqual(result.endResize, ["a", 300, 390]);
    assert.equal(result.errorCount, 1);
    assert.ok(result.shortTitle.includes("已排期"));
    assert.ok(result.shortHandleHeight >= 44);
    assert.equal(result.adjacentHandles, true);
    // Regression: 打开选择器的触摸尾随 click 不得自动选中任务。
    assert.equal(result.noOpeningClickWrite, true);
    assert.equal(result.retargetedBlank, true, "Regression: 浏览器将空白处触摸重定向到附近卡片时仍按实际坐标排期");
});
