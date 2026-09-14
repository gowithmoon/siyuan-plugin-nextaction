import test from "node:test";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { runSvelteBrowserTest } from "./helpers/svelte-browser.ts";

const source = (path: string) => JSON.stringify(resolve(path));

for (const width of [320, 360, 390, 430]) {
    test(`筛选窗口在 ${width}px 铺满宽度，双列及自定义属性不重叠`, async () => {
        // Regression: 移动端工具条的 50% 宽度限制使筛选窗口只占左半边，字段控件被挤压。
        const result = await runSvelteBrowserTest<Record<string, unknown>>({
            fixtureName: "filter-sheet-layout",
            browserArgs: [
                "--window-size=600,1400",
                `--force-device-scale-factor=${600 / width}`,
                `--screenshot=${join(tmpdir(), `nextaction-filter-sheet-${width}.png`)}`,
            ],
            virtualTimeBudget: 3000,
            files: {
                "siyuan.js": "export class Menu {} export function openTab() {} export function showMessage() {}",
                "Harness.svelte": `<script>
import Filter from ${source("src/frontend/ui/NaTaskFilterBar.svelte")};
import {provideWorkspace} from ${source("src/frontend/workspace-context.ts")};
import {DEFAULT_FILTER_STATE} from ${source("src/frontend/utils/filter.ts")};
import i18n from ${source("src/i18n/zh-CN.json")};
import ${source("src/index.scss")};
provideWorkspace('mobile-dock', {});
let filters = {...DEFAULT_FILTER_STATE, searchText:'保留外部搜索'};
const fields=[{version:2,id:'customer',key:'customer',label:'客户名称与项目归属',description:'',type:'text',status:'active',scope:{mode:'all'},showOnCard:true}];
</script>
<main class="nextaction na-app na-dock na-workspace--compact na-workspace--touch" style="width:${width}px;height:740px">
<Filter {i18n} filterState={filters} contexts={['办公室','外出']} tags={['工作','家庭']} customFields={fields} showStatus onChange={value=>{filters=value;window.applied=value;}} />
</main>
<style>
:global(body){margin:0}
:global(#browser-result){display:none}
:global(:root){--b3-theme-background:#fff;--b3-theme-surface:#f5f6f8;--b3-theme-surface-light:#eceff2;--b3-theme-on-background:#202124;--b3-theme-on-surface:#454950;--b3-theme-primary:#3565b5;--b3-theme-primary-light:#dbe6f8;--b3-border-color:#d5d9df;--b3-font-family:Arial,sans-serif;--b3-border-radius:6px}
</style>`,
                "main.js": `import {mount,tick} from 'svelte';import Harness from './Harness.svelte';
mount(Harness,{target:document.querySelector('#app')});
const pause=async()=>{await tick();await new Promise(r=>setTimeout(r,80));};
const box=e=>e.getBoundingClientRect();
const overlaps=(a,b)=>Math.min(a.right,b.right)>Math.max(a.left,b.left)+1&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+1;
(async()=>{
await pause();document.querySelector('.na-task-filter-bar .na-button').click();await pause();
const page=document.querySelector('.na-filter-page');
const grid=page.querySelector('.na-task-filter-bar__filters');
const triggers=[...page.querySelectorAll('.na-filter-dropdown__trigger')];
const rects=triggers.map(box),bounds=box(grid),bar=box(page.querySelector('.na-task-filter-bar'));
const custom=page.querySelector('.na-task-filter-bar__custom');
const controls=[...custom.querySelectorAll('select,input,button')];
const c=controls.map(box),cb=box(custom);
const out={
 fullWidth:Math.abs(bounds.width-bar.width)<2,
 twoColumns:Math.abs(rects[0].top-rects[1].top)<2 && rects[1].left>=rects[0].right,
 noDuplicateSearch:page.querySelectorAll('input[type=search]').length===0,
 noOverlap:c.every((a,i)=>c.slice(i+1).every(b=>!overlaps(a,b))),
 contained:c.every(a=>a.left>=cb.left && a.right<=cb.right+1),
 addFullWidth:c[3].width>=cb.width-24,
 noHorizontalOverflow:page.scrollWidth<=page.clientWidth,
};
const [field,operator,value,add]=controls;
field.value='customer';field.dispatchEvent(new Event('change',{bubbles:true}));
value.value='示例客户';value.dispatchEvent(new Event('input',{bubbles:true}));await pause();add.click();await pause();
document.querySelector('.na-page-host__header .na-button').click();await pause();
out.customApplied=window.applied?.customFieldFilters?.[0]?.value==='示例客户';
out.searchPreserved=window.applied?.searchText==='保留外部搜索';
document.querySelector('.na-task-filter-bar .na-button').click();await pause();
window.__NA_BROWSER_RESULT__(out);
})().catch(e=>window.__NA_BROWSER_RESULT__({error:String(e.stack)}));`,
            },
        });
        assert.deepEqual(result, {
            fullWidth: true,
            twoColumns: true,
            noDuplicateSearch: true,
            noOverlap: true,
            contained: true,
            addFullWidth: true,
            noHorizontalOverflow: true,
            customApplied: true,
            searchPreserved: true,
        });
    });
}
