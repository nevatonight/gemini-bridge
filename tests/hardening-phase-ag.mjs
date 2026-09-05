import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fsp from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const text=rel=>fsp.readFile(path.join(ROOT,rel),'utf8');

test('Phase AG: sidebar follows Project History Gemini status Settings hierarchy',async()=>{
  const h=await text('ui/index.html');
  const project=h.indexOf('data-i18n="project"'),history=h.indexOf('data-i18n="history"'),status=h.indexOf('data-i18n="geminiStatus"'),settings=h.indexOf('data-i18n="settings"');
  assert.ok(project>=0&&history>project&&status>history&&settings>status);
});

test('Phase AG: Agent Edit pending workflow lives in conversation area with explicit review guidance',async()=>{
  const h=await text('ui/index.html');
  assert.match(h,/id="messages"[\s\S]*id="pendingSection"[\s\S]*class="composer"/);
  assert.match(h,/agentWorkflowHelp/);
});

test('Phase AG: composer auto-expands, preserves Ctrl or Cmd Enter, and has attachment foundation without fake controls',async()=>{
  const h=await text('ui/index.html'),s=await text('ui/app.js');
  assert.match(h,/id="composerAttachments"[^>]*hidden/);
  assert.match(h,/id="prompt" rows="1"/);assert.match(h,/id="composerMode"/);
  assert.match(s,/function resizePrompt/);assert.match(s,/composerMode\.textContent/);
  assert.match(s,/addEventListener\('input',resizePrompt\)/);
  assert.match(s,/e\.ctrlKey\|\|e\.metaKey/);
});

test('Phase AG: onboarding transitions to clean chat chrome after first conversation activity',async()=>{
  const s=await text('ui/app.js'),css=await text('ui/styles.css');
  assert.match(s,/gb-chat-started/);
  assert.match(css,/\.gb-chat-started \.empty-state/);
});

test('Phase AG: failed terminal label is action-oriented rather than bare Failed',async()=>{
  const s=await text('ui/app.js');
  assert.match(s,/runFailed:'Needs attention'/);
  assert.doesNotMatch(s,/runFailed:'Failed'/);
});

test('Phase AG: Agent Edit exposes progress steps and obvious Preview Apply Reconcile Discard actions',async()=>{
  const s=await text('ui/app.js'),css=await text('ui/styles.css');
  for(const token of ['agentStepEdit','agentStepReview','agentStepApply','agentStepFinish'])assert.match(s,new RegExp(token));assert.match(s,/function renderAgentProgress\(/);
  for(const action of ["t('preview')","t('apply')","t('reconcile')","t('discard')"])assert.ok(s.includes(action),action);
  assert.match(css,/\.agent-progress/);assert.match(css,/\.primary-action/);assert.match(css,/\.danger-action/);
});

test('Phase AG: dashboard error UX has Retry Reconnect Google Details and actionable timeout mapping',async()=>{
  const s=await text('ui/app.js');
  assert.match(s,/reconnectGoogle:'Reconnect Google'/);assert.match(s,/technicalDetails:'Technical details'/);assert.match(s,/retry:'Retry'/);
  assert.match(s,/BRIDGE_TIMEOUT:'errTimeout'/);assert.match(s,/addTransientError/);
});

test('Phase AG: onboarding transition is visual and removed from keyboard accessibility after chat starts',async()=>{
  const s=await text('ui/app.js'),h=await text('ui/index.html'),css=await text('ui/styles.css');
  assert.match(h,/id="emptyState"[^>]*aria-hidden="false"/);
  assert.match(s,/emptyState\.inert=started/);assert.match(s,/aria-hidden/);
  assert.match(css,/visibility:hidden/);
});

test('Phase AG: ChatGPT panel mirrors action-oriented failures, Google reconnect, Agent progress and composer auto-expand',async()=>{
  const c=await text('web-extension/content.js');
  assert.match(c,/FAILED:'Needs attention'/);assert.doesNotMatch(c,/FAILED:'Failed'/);
  assert.match(c,/reconnectGoogle:'Reconnect Google'/);assert.match(c,/reconnectHint/);
  assert.match(c,/renderProgress/);assert.match(c,/agent-progress/);
  assert.match(c,/function resizePrompt/);assert.match(c,/addEventListener\('input',resizePrompt\)/);
});
