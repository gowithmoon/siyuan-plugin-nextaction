import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

const source = (path: string) => JSON.stringify(resolve(path));
for (const host of ["mobile-dock", "desktop-dock", "desktop-tab"]) {
    test(`${host} 卡片属性与时间线手柄真实浏览器回归`, async () => {
        // Regression: touch 属性仍依赖 Tooltip，时间线手柄隐藏且双击打开两次。
        const result = await runSvelteBrowserTest<any>({
            fixtureName: "mobile-card-interactions",
            browserArgs: ["--window-size=500,900"],
            virtualTimeBudget: 5000,
            files: {
                "siyuan.js": `export class Menu { addItem(){} addSeparator(){} open(){window.menus++;} } export function showMessage(){window.errors++;} export function openTab(){} export function confirm(){}`,
                "Harness.svelte": `<script>
import { provideWorkspace } from ${source("src/frontend/workspace-context.ts")};
import { taskStore } from ${source("src/frontend/stores/task-store.ts")};
import TimelineColumn from ${source("src/frontend/components/timeline/TimelineColumn.svelte")};
import TaskCard from ${source("src/frontend/components/TaskCard.svelte")};
import i18n from ${source("src/i18n/zh-CN.json")};
import ${source("src/index.scss")};
const base={blockId:'20260910120000-actionx',title:'测试任务',taskType:'1',status:'todo',priority:'high',importance:6,effort:2,childIds:[],customFields:{},parentId:'',context:'',tags:'',repeat:'',repeatState:'',reviewInterval:0,blocked:false};
const fallback={...base,blockId:'20260910120000-fallbac',priority:null,importance:null,effort:undefined};
window.opens=0;window.menus=0;window.errors=0;window.writes=[];window.removes=[];
const day=(start,end,adjacent=false)=>({date:'2026-09-10',updatedAt:1,tasks:[{blockId:base.blockId,scheduleStart:start,scheduleEnd:end,addedAt:1,order:0},...(adjacent?[{blockId:fallback.blockId,scheduleStart:end,scheduleEnd:end+15,addedAt:1,order:1}]:[])]});
window.reset=(start,end,adjacent=false)=>taskStore.applyMyDayUpdate(day(start,end,adjacent));
window.reset(60,120);
const bridge={getCompletedTasksPage:async()=>({tasks:[],total:0}),setMyDaySchedule:async(id,start,end)=>{window.writes.push([id,start,end]);if(window.failWrite)throw new Error('write failed');return day(start,end);},removeMyDaySchedule:async(id)=>{window.removes.push(id);return day(null,null);}};
const workspace=provideWorkspace('${host}',bridge); workspace.openTask=()=>window.opens++;
const entries=$derived($taskStore.myDayState?.tasks??[]);
window.readDay=()=>{let value;const stop=taskStore.subscribe(s=>value=s.myDayState);stop();return value;};
</script>
<div class="na-app {workspace.compact ? 'na-workspace--compact' : ''} {workspace.touch ? 'na-workspace--touch' : ''}" style="width:360px;height:700px;flex-direction:column">
<div id="properties"><TaskCard task={base} {i18n} onEdit={()=>{}} onStatusClick={()=>{}} onContextMenu={()=>{}}/><TaskCard task={fallback} {i18n} onEdit={()=>{}} onStatusClick={()=>{}} onContextMenu={()=>{}}/></div>
<div style="height:440px;flex:none;display:flex;width:100%"><TimelineColumn scheduledEntries={entries} taskMap={new Map([[base.blockId,base],[fallback.blockId,fallback]])} {bridge} {i18n} onContextMenu={()=>{}}/></div>
<div class="na-unscheduled" style="height:50px">未排程</div>
</div>`,
                "main.js": `import {mount,tick} from 'svelte';import Harness from './Harness.svelte';
mount(Harness,{target:document.getElementById('app')});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{try{
await pause(600);await tick();
const touch=${host === "mobile-dock"}; const out={};
out.properties=[...document.querySelectorAll('#properties .na-task-card')].map(card=>['.na-task-card__priority','.na-task-card__stat-item--importance','.na-task-card__stat-item--effort'].map(sel=>{const el=card.querySelector(sel); const r=el.getBoundingClientRect();return {text:el.textContent.trim(),tooltip:!!el.closest('.na-tooltip'),visible:r.width>0&&r.height>0,color:getComputedStyle(el).color};}));
const displayCard=document.querySelector('.na-timeline-card');
const content=displayCard.querySelector('.na-timeline-card__content');
const title=displayCard.querySelector('.na-timeline-card__name');
const time=displayCard.querySelector('.na-timeline-card__time');
out.sharedDisplay={content:!!content,header:!!displayCard.querySelector('.na-timeline-card__header'),footer:!!displayCard.querySelector('.na-timeline-card__footer'),radius:getComputedStyle(displayCard).borderRadius,titleFont:getComputedStyle(title).fontSize,timeFont:time&&getComputedStyle(time).fontSize,time:time?.textContent.trim()};
if(touch){window.__NA_BROWSER_RESULT__(out);return;}
const column=document.querySelector('.na-timeline-column');
const card=()=>column.querySelector('.na-timeline-card');
async function reset(start=60,end=120,adj=false){window.reset(start,end,adj);await tick();column.scrollTop=Math.max(0,start*1.2-60);await tick();}
await reset();
const emit=(target,type,x,y,id=1)=>target.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:id,pointerType:touch?'touch':'mouse',button:0,clientX:x,clientY:y}));
function tap(){const el=card(),r=el.getBoundingClientRect();emit(el,'pointerdown',r.x+r.width/2,r.y+r.height/2);emit(el,'pointerup',r.x+r.width/2,r.y+r.height/2);}
const top=card().querySelector('.na-timeline-card__handle--top');
out.style={overflow:getComputedStyle(card()).overflow,handleHeight:getComputedStyle(top).height,pseudo:getComputedStyle(top,'::before').height};
tap();await pause(50);tap();card().dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));out.doubleOpens=window.opens;
async function drag(direction,delta,start=60,end=120){await reset(start,end);const el=card(),r=el.getBoundingClientRect();const x=r.x+r.width*(direction==='top'?.25:.75);const y=direction==='top'?r.top+(touch?-10:2):r.bottom+(touch?10:-2);const hit=document.elementFromPoint(x,y);out.hits??=[];out.hits.push(hit?.classList.contains('na-timeline-card__handle--'+direction));emit(hit,'pointerdown',x,y);emit(hit,'pointermove',x,y+delta);await tick();const preview=[parseFloat(el.style.top),parseFloat(el.style.height)];emit(hit,'pointerup',x,y+delta);await tick();await pause(10);return {write:window.writes.at(-1)?.slice(1),preview,state:window.readDay().tasks[0]};}
out.start=await drag('top',-37);out.end=await drag('bottom',37);out.minStart=await drag('top',300);out.minEnd=await drag('bottom',-300);out.dayStart=await drag('top',-200,15,75);out.dayEnd=await drag('bottom',200,1350,1410);
await reset();await pause(330);tap();await drag('bottom',18);tap();out.afterDragOpens=window.opens;
await reset(60,75,true);const cards=[...column.querySelectorAll('.na-timeline-card')];out.adjacent=[];
if(touch){for(const el of cards){const r=el.getBoundingClientRect();for(const dir of ['top','bottom']){const x=r.x+r.width*(dir==='top'?.25:.75),y=dir==='top'?r.top-10:r.bottom+10;out.adjacent.push(document.elementFromPoint(x,y)===el.querySelector('.na-timeline-card__handle--'+dir));}}}
await reset();let el=card(),r=el.getBoundingClientRect();const writesBefore=window.writes.length;emit(el,'pointerdown',r.x+100,r.y+30);emit(el,'pointermove',r.x+100,r.y+65,2);emit(el,'pointercancel',r.x+100,r.y+65);out.cancelNoWrite=window.writes.length===writesBefore;
await reset();el=card();r=el.getBoundingClientRect();emit(el,'pointerdown',r.x+100,r.y+30);emit(el,'pointermove',r.x+100,r.y+66);emit(el,'pointerup',r.x+100,r.y+66);await tick();await pause(10);out.move=window.writes.at(-1).slice(1);
window.failWrite=true;await drag('bottom',18);out.errors=window.errors;window.failWrite=false;
await reset();el=card();r=el.getBoundingClientRect();const target=document.querySelector('.na-unscheduled').getBoundingClientRect();emit(el,'pointerdown',r.x+100,r.y+30);emit(el,'pointermove',target.x+20,target.y+20);emit(el,'pointerup',target.x+20,target.y+20);await pause(10);out.removed=window.removes.length;
window.__NA_BROWSER_RESULT__(out);
}catch(error){window.__NA_BROWSER_RESULT__({error:String(error),stack:error.stack});}})();`,
            },
        });
        assert.equal(result.error, undefined, result.stack);
        assert.deepEqual(
            result.properties.map((items: any[]) => items.map((item) => item.text)),
            [
                ["高", "6", "2"],
                ["中", "4", "4"],
            ],
        );
        for (const items of result.properties)
            for (const item of items) {
                if (host === "mobile-dock") assert.equal(item.visible, true, JSON.stringify(result));
                assert.equal(item.tooltip, host !== "mobile-dock");
            }
        // Regression: 移动我的一天卡片与 PC 共用相同内容层级和展示样式。
        assert.deepEqual(result.sharedDisplay, {
            content: true,
            header: true,
            footer: true,
            radius: "8px",
            titleFont: "12px",
            timeFont: "10px",
            time: "06:00 - 07:00",
        });
        if (host === "mobile-dock") return; // 移动时间轴行为由 mobile-timeline-browser.test.ts 覆盖。
        assert.equal(result.style.overflow, host === "mobile-dock" ? "visible" : "hidden");
        assert.equal(result.style.handleHeight, "5px");
        assert.equal(result.doubleOpens, host === "mobile-dock" ? 1 : 0);
        assert.equal(result.afterDragOpens, result.doubleOpens);
        assert.ok(result.hits.every(Boolean), JSON.stringify(result.hits));
        assert.ok(result.adjacent.every(Boolean), JSON.stringify(result.adjacent));
        for (const [name, expected] of Object.entries({
            start: [30, 120],
            end: [60, 150],
            minStart: [105, 120],
            minEnd: [60, 75],
            dayStart: [0, 75],
            dayEnd: [1350, 1440],
        })) {
            assert.deepEqual(result[name].write, expected, name);
            assert.deepEqual(result[name].preview, [expected[0] * 1.2, (expected[1] - expected[0]) * 1.2], name);
            assert.deepEqual([result[name].state.scheduleStart, result[name].state.scheduleEnd], expected, name);
        }
        assert.deepEqual(result.move, [90, 150]);
        assert.equal(result.cancelNoWrite, true);
        assert.equal(result.errors, 1);
        assert.equal(result.removed, 1);
    });
}
