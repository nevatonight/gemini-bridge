import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fsp from 'node:fs/promises';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const text=rel=>fsp.readFile(path.join(ROOT,rel),'utf8');

test('Phase AE: extension language preference is isolated in chrome.storage.local and accepts only ru/en',async()=>{
  const code=await text('web-extension/background.js');
  const session={},local={};let listener=null,removedListener=null;
  const area=data=>({get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in data).map(k=>[k,data[k]])),set:async obj=>Object.assign(data,obj),remove:async key=>{for(const k of Array.isArray(key)?key:[key])delete data[k];}});
  const chrome={storage:{session:area(session),local:area(local)},runtime:{onMessage:{addListener(fn){listener=fn;}}},tabs:{onRemoved:{addListener(fn){removedListener=fn;}}}};
  vm.runInNewContext(code,{importScripts(){},GB_PORT:38473,GB_TOKEN:'a'.repeat(64),chrome,fetch:async()=>{throw new Error('unused')},AbortController,setTimeout,clearTimeout,console});
  assert.equal(typeof listener,'function');assert.equal(typeof removedListener,'function');
  const send=msg=>new Promise(resolve=>{const async=listener(msg,{tab:{id:7}},r=>resolve(r));assert.equal(async,true);});
  const setRu=await send({kind:'gb-pref-set',key:'language',value:'ru'});assert.equal(setRu.ok,true);assert.equal(setRu.data,'ru');
  const getRu=await send({kind:'gb-pref-get',key:'language'});assert.equal(getRu.ok,true);assert.equal(getRu.data,'ru');
  assert.equal(local['gb-lang'],'ru');
  const bad=await send({kind:'gb-pref-set',key:'language',value:'xx'});assert.equal(bad.ok,false);
});

test('Phase AE: ChatGPT panel has persistent RU/EN i18n with Russian-browser default and explicit switcher',async()=>{
  const c=await text('web-extension/content.js');
  assert.match(c,/const I18N\s*=\s*\{/);assert.match(c,/ru\s*:\s*\{/);assert.match(c,/en\s*:\s*\{/);
  assert.match(c,/navigator\.languages|navigator\.language/);assert.match(c,/gb-pref-get/);assert.match(c,/gb-pref-set/);
  assert.match(c,/class=["'][^"']*language/);assert.match(c,/value=["']ru["']/);assert.match(c,/value=["']en["']/);
});

test('Phase AE: primary extension actions have human Russian labels rather than developer terminology',async()=>{
  const c=await text('web-extension/content.js');
  for(const s of ['Спросить','Анализ проекта','Изменить файлы','Новый проект','Новый диалог','Настройки проекта','Отправить','Использовать здесь','Технические подробности'])assert.ok(c.includes(s),s);
});

test('Phase AE: extension reloads durable conversation history and renders failed attempts with Retry and raw diagnostics',async()=>{
  const c=await text('web-extension/content.js');
  assert.match(c,/\/conversation\?limit=100/);assert.doesNotMatch(c,/\/turns\?limit=100/);
  assert.match(c,/failed-run/);assert.match(c,/renderFailed|error-card|failure-card/i);
  assert.match(c,/Retry|Повторить/);assert.match(c,/technical|Технические подробности/);
  assert.match(c,/item\.error|x\.error|entry\.error/);
});

test('Phase AE: failed-run Retry preserves prompt mode and thread while creating a fresh attempt id',async()=>{
  const c=await text('web-extension/content.js');
  assert.match(c,/retryFailed|retryRun|retryAttempt/);
  assert.match(c,/prompt[^\n]{0,180}(mode|thread)|(?:mode|thread)[^\n]{0,180}prompt/);
  assert.match(c,/crypto\.randomUUID\(\)/);
  assert.match(c,/requestId/);
});

test('Phase AE: project creation uses an in-panel dialog instead of a browser prompt',async()=>{
  const c=await text('web-extension/content.js');
  assert.match(c,/newProjectDialog|projectDialog/);assert.match(c,/createProject/);
  const start=c.indexOf("$('.newp').onclick");
  if(start>=0){const frag=c.slice(start,start+900);assert.doesNotMatch(frag,/window\.prompt\(/);}
});

test('Phase AE: empty thread and pending sections are hidden instead of showing dead controls',async()=>{
  const c=await text('web-extension/content.js');
  assert.match(c,/threadSection/);assert.match(c,/pendingSection/);assert.match(c,/classList\.(?:add|toggle)\(['"]hidden/);
});

test('Phase AE: localization does not weaken closed Shadow DOM, tab-local binding, token isolation, or permissions',async()=>{
  const c=await text('web-extension/content.js'),bg=await text('web-extension/background.js'),m=JSON.parse(await text('web-extension/manifest.json'));
  assert.match(c,/attachShadow\(\{mode:['"]closed['"]\}\)/);
  assert.doesNotMatch(c,/GB_TOKEN|sessionStorage|localStorage/);
  assert.match(bg,/chrome\.storage\.session/);assert.match(bg,/gb-binding:/);assert.match(bg,/chrome\.storage\.local/);
  assert.deepEqual(m.permissions,['storage']);
});
