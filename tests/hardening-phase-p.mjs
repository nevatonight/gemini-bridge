import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {BridgeCore} from '../src/core.mjs';
import {canonicalWorkspace} from '../src/utils.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const FAKE=path.join(ROOT,'tests','fake-gemini.mjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function tmp(prefix='gb-p-'){return await fsp.mkdtemp(path.join(os.tmpdir(),prefix));}
async function fixture(){const d=await tmp(),state=path.join(d,'state'),ws=path.join(d,'workspace');await fsp.mkdir(ws);await fsp.writeFile(path.join(ws,'a.txt'),'alpha');const core=await new BridgeCore({stateRoot:state,geminiEntry:FAKE}).init();const p=core.createProject('P');await core.updateProject(p.id,{workspace:ws});return {d,state,ws,core,p:core.store.getProject(p.id)};}
async function wait(core,id,timeout=6000){const end=Date.now()+timeout;while(Date.now()<end){const r=core.getRun(id);if(!['QUEUED','RUNNING'].includes(r.status))return r;await sleep(20);}throw new Error(`timeout:${core.getRun(id)?.status}`);}
async function text(rel){return await fsp.readFile(path.join(ROOT,rel),'utf8');}

test('Phase P: independent Ask is not blocked by an active Review workspace lock',async()=>{
  const e=await fixture();const review=await e.core.startRun({projectId:e.p.id,mode:'review',prompt:'TEST_SLEEP 700',requestId:'review-lock'});
  const ask=await e.core.startRun({projectId:e.p.id,mode:'ask',prompt:'hello',requestId:'ask-during-review'});assert.equal((await wait(e.core,ask.run.id)).status,'COMPLETED');await e.core.cancelRun(review.run.id);await wait(e.core,review.run.id);
});

test('Phase P: independent Ask is not blocked by an active Agent workspace lock',async()=>{
  const e=await fixture();const edit=await e.core.startRun({projectId:e.p.id,mode:'edit',prompt:'TEST_SLEEP 700\nTEST_EDIT a.txt => changed',requestId:'edit-lock'});
  const ask=await e.core.startRun({projectId:e.p.id,mode:'ask',prompt:'hello',requestId:'ask-during-edit'});assert.equal((await wait(e.core,ask.run.id)).status,'COMPLETED');await e.core.cancelRun(edit.run.id);await wait(e.core,edit.run.id);
});

test('Phase P: canonical workspace accepts Windows Copy-as-path style surrounding quotes',async()=>{
  const d=await tmp('gb quoted workspace ');const quoted=`"${d}"`;assert.equal(await canonicalWorkspace(quoted),await fsp.realpath(d));
});

test('Phase P: first-use extension auto-binds the sole starter project but manual switching remains explicit',async()=>{
  const c=await text('web-extension/content.js');assert.match(c,/ensureStarterBinding/);assert.match(c,/projects\.length\s*===\s*0/);assert.match(c,/name:\s*['"]My project['"]/);assert.match(c,/projects\.length\s*===\s*1/);assert.match(c,/Use here/);assert.doesNotMatch(c,/Bind page/);
});

test('Phase P: Dashboard and extension preflight Review\/Agent workspace before creating a run',async()=>{
  for(const rel of ['ui/app.js','web-extension/content.js']){const s=await text(rel);assert.match(s,/preflightWorkspace/);assert.match(s,/WORKSPACE_REQUIRED/);assert.match(s,/Review and Agent Edit need a local workspace/i);}
});

test('Phase P: expected errors are mapped to actionable text while unknown diagnostics remain visible',async()=>{
  for(const rel of ['ui/app.js','web-extension/content.js']){const s=await text(rel);assert.match(s,/friendlyError/);for(const code of ['WORKSPACE_BUSY','THREAD_BUSY','PENDING_AGENT_CHANGES','HOST_MAINTENANCE','WORKSPACE_REQUIRED'])assert.match(s,new RegExp(code));assert.match(s,/String\(raw/);}
});

test('Phase P: management outcomes explain Apply\/Reconcile\/Discard and conflict never implies overwrite',async()=>{
  for(const rel of ['ui/app.js','web-extension/content.js']){const s=await text(rel);assert.match(s,/managementOutcome/);assert.match(s,/nothing was overwritten/i);assert.match(s,/Reconcile/);assert.match(s,/applied to the live workspace/i);assert.match(s,/snapshot was discarded/i);}
});

test('Phase P: localhost networking is bounded and polling cannot overlap or regress stale state',async()=>{
  const bg=await text('web-extension/background.js'),dash=await text('ui/app.js'),content=await text('web-extension/content.js');assert.match(bg,/AbortController/);assert.match(bg,/GB_FETCH_TIMEOUT_MS/);assert.match(dash,/AbortController/);assert.match(dash,/pollInFlight/);assert.match(dash,/pollGeneration/);assert.match(content,/pollInFlight/);assert.match(content,/pollGeneration/);
});

test('Phase P: ChatGPT binding is tab-local in extension storage and never URL-shared or exposed to page world',async()=>{
  const bg=await text('web-extension/background.js'),c=await text('web-extension/content.js');assert.match(bg,/sender\.tab\?\.id/);assert.match(bg,/chrome\.storage\.session/);assert.match(bg,/gb-binding:/);assert.match(c,/gb-binding-get/);assert.match(c,/gb-binding-set/);assert.doesNotMatch(c,/gb-bind:/);assert.doesNotMatch(c,/sessionStorage|localStorage/);
});
