import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fsp from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const text=rel=>fsp.readFile(path.join(ROOT,rel),'utf8');

test('Phase AD: Dashboard has persistent RU/EN i18n with Russian locale default and document lang sync',async()=>{
  const s=await text('ui/app.js');assert.match(s,/I18N|translations|dictionary/i);assert.match(s,/\bru\s*:/);assert.match(s,/\ben\s*:/);assert.match(s,/navigator\.language|navigator\.languages/);assert.match(s,/localStorage/);assert.match(s,/gb-lang/);assert.match(s,/document\.documentElement\.lang/);
});

test('Phase AD: main user-facing concepts have Russian translations rather than literal engineering labels',async()=>{
  const s=await text('ui/app.js');for(const phrase of ['Спросить','Анализ проекта','Изменить файлы','Настройки проекта','Новый проект','Новый диалог','Отправить','Технические подробности','Добавить панель в ChatGPT'])assert.match(s,new RegExp(phrase));
});

test('Phase AD: first-use UI hides empty thread/pending machinery and provides an explicit empty state',async()=>{
  const h=await text('ui/index.html'),css=await text('ui/styles.css');assert.match(h,/id="threadSection"[^>]*hidden/);assert.match(h,/id="pendingSection"[^>]*hidden/);assert.match(h,/id="emptyState"/);assert.match(h,/id="modeHelp"/);assert.match(css,/\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/i,'author CSS must not override hidden state');
});

test('Phase AD: project creation uses a product dialog instead of window.prompt',async()=>{
  const h=await text('ui/index.html'),s=await text('ui/app.js');assert.match(h,/id="newProjectDialog"/);assert.match(h,/id="newProjectName"/);assert.doesNotMatch(s,/window\.prompt\(['"]Project name/);assert.match(s,/newProjectDialog/);
});

test('Phase AD: chat layout uses a readable centered conversation column and integrated composer',async()=>{
  const h=await text('ui/index.html'),css=await text('ui/styles.css');assert.match(h,/conversation-column/);assert.match(h,/composer/);assert.match(css,/\.conversation-column[\s\S]{0,300}max-width\s*:/);assert.match(css,/\.composer[\s\S]{0,400}border-radius/);
});

test('Phase AD: health separates Bridge runtime from Google credential presence',async()=>{
  const host=await text('src/host.mjs'),ui=await text('ui/app.js');assert.match(host,/authStatusCached/);assert.match(host,/core\.gemini\.authStatus/);assert.match(host,/provider:'antigravity'/);assert.match(host,/credentialsPresent/);assert.match(ui,/authStatus/);assert.match(ui,/credentialsPresent/);assert.match(ui,/Google/);
});

test('Phase AD: modes are prominent segmented choices with localized explanatory copy',async()=>{
  const h=await text('ui/index.html'),css=await text('ui/styles.css'),s=await text('ui/app.js');assert.match(h,/mode-segment/);assert.match(css,/\.mode-segment/);assert.match(s,/modeDescriptions|modeHelp/);for(const mode of ['ask','review','edit'])assert.match(s,new RegExp(`${mode}.*(?:title|description)|(?:title|description).*${mode}`,'i'));
});

test('Phase AD: localized failed-run card keeps Retry and raw technical diagnostics in both languages',async()=>{
  const s=await text('ui/app.js');assert.match(s,/Повторить/);assert.match(s,/Retry/);assert.match(s,/Технические подробности/);assert.match(s,/Technical details/);assert.match(s,/info\.technical|technical/);
});
