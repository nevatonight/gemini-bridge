import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { GeminiRunner } from '../src/gemini.mjs';
import { BridgeCore } from '../src/core.mjs';
import { buildSnapshot } from '../src/snapshot.mjs';
import { processIdentitySync, processMatchesIdentity, isPidAlive } from '../src/utils.mjs';
import { spawn } from 'node:child_process';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const FAKE=path.join(ROOT,'tests','fake-gemini.mjs');
async function tmp(prefix='gb-c-'){return await fsp.mkdtemp(path.join(os.tmpdir(),prefix));}
async function runner(){const d=await tmp(),state=path.join(d,'state'),cwd=path.join(d,'cwd');await fsp.mkdir(cwd,{recursive:true});return {d,state,cwd,r:await new GeminiRunner({stateRoot:state,geminiEntry:FAKE}).init()};}
async function coreEnv(){const d=await tmp(),state=path.join(d,'state'),ws=path.join(d,'w');await fsp.mkdir(ws,{recursive:true});await fsp.writeFile(path.join(ws,'a.txt'),'alpha');const core=await new BridgeCore({stateRoot:state,geminiEntry:FAKE}).init();const p=core.createProject('P');await core.updateProject(p.id,{workspace:ws,context:'ctx'});return {d,state,ws,core,p:core.store.getProject(p.id)};}
async function waitRun(core,id,pred=r=>['COMPLETED','FAILED','CANCELLED','WAITING_APPLY','RECOVERY_REQUIRED'].includes(r.status),timeout=7000){const end=Date.now()+timeout;while(Date.now()<end){const r=core.getRun(id);if(pred(r))return r;await new Promise(r=>setTimeout(r,20));}throw new Error(`timeout:${core.getRun(id)?.status}`);}

async function direct(payload){const e=await runner();return {e,promise:e.r.run({mode:'ask',cwd:e.cwd,payload})};}

test('Phase C: malformed stream-json line is a protocol failure',async()=>{
  const {promise}=await direct('TEST_MALFORMED_JSONL');await assert.rejects(()=>promise,/GEMINI_PROTOCOL_INVALID_JSON/);
});

test('Phase C: exit 0 without terminal result is rejected',async()=>{
  const {promise}=await direct('TEST_NO_RESULT');await assert.rejects(()=>promise,/GEMINI_PROTOCOL_MISSING_RESULT/);
});

test('Phase C: terminal result error fails even when process exits 0',async()=>{
  const {promise}=await direct('TEST_RESULT_ERROR');await assert.rejects(()=>promise,/GEMINI_RESULT_ERROR:terminal failure/);
});

test('Phase C: raw stdout and stderr have independent hard memory bounds',async()=>{
  const a=await direct(`TEST_RAW_BYTES ${33*1024*1024}`);await assert.rejects(()=>a.promise,/GEMINI_RAW_STDOUT_TOO_LARGE/);
  const b=await direct(`TEST_STDERR_BYTES ${600*1024}`);const out=await b.promise;assert.equal(out.text,'ok');assert.ok(Buffer.byteLength(out.stderr,'utf8')<=256*1024);
});

test('Phase C: active run persists PID plus exact start identity and clears both at terminal persistence',async()=>{
  const e=await coreEnv();const started=await e.core.startRun({projectId:e.p.id,mode:'ask',prompt:'TEST_SLEEP 700',requestId:'identity-live'});
  let raw=null;for(let i=0;i<100;i++){raw=e.core.store.getRun(started.run.id);if(raw?.pid&&raw?.process_identity)break;await new Promise(r=>setTimeout(r,10));}
  assert.ok(raw?.pid);assert.ok(raw?.process_identity);assert.equal(processMatchesIdentity(Number(raw.pid),raw.process_identity),true);
  const done=await waitRun(e.core,started.run.id);assert.equal(done.status,'COMPLETED');raw=e.core.store.getRun(done.id);assert.equal(raw.pid,null);assert.equal(raw.process_identity,null);
});

test('Phase C: reused/mismatched live PID is never killed and does not block edit reconciliation as the old Gemini',async()=>{
  const e=await coreEnv();const th=e.core.createThread(e.p.id,'recovery');const sd=path.join(e.state,'run-data','reuse','snapshot');const snap=await buildSnapshot(e.ws,sd,{mode:'edit'});await fsp.writeFile(path.join(snap.filesDir,'a.txt'),'agent');
  const child=spawn(process.execPath,['-e','setTimeout(()=>{},10000)'],{stdio:'ignore'});const id=crypto.randomUUID();
  e.core.store.createRun({id,requestId:'reuse-pid',requestFingerprint:'fp',projectId:e.p.id,threadId:th.id,mode:'edit',status:'RUNNING',prompt:'x',contextRevision:e.p.current_context_revision,workspaceRoot:e.ws,workspaceId:e.p.workspace_id,snapshotDir:sd,manifestPath:snap.manifestPath});
  e.core.store.patchRun(id,{pid:child.pid,process_identity:'definitely-not-this-process'});e.core.store.db.close();
  const core2=await new BridgeCore({stateRoot:e.state,geminiEntry:FAKE}).init();assert.equal(core2.getRun(id).status,'RECOVERY_REQUIRED');assert.equal(isPidAlive(child.pid),true);
  await core2.discardRun(id);child.kill('SIGKILL');await new Promise(r=>child.once('exit',r));
});

test('Phase C: legacy PID without start identity fails closed for manual recovery and is never killed',async()=>{
  const e=await coreEnv();const th=e.core.createThread(e.p.id,'legacy');const sd=path.join(e.state,'run-data','legacy','snapshot');const snap=await buildSnapshot(e.ws,sd,{mode:'edit'});await fsp.writeFile(path.join(snap.filesDir,'a.txt'),'agent');
  const child=spawn(process.execPath,['-e','setTimeout(()=>{},10000)'],{stdio:'ignore'});const id=crypto.randomUUID();
  e.core.store.createRun({id,requestId:'legacy-pid',requestFingerprint:'fp',projectId:e.p.id,threadId:th.id,mode:'edit',status:'RUNNING',prompt:'x',contextRevision:e.p.current_context_revision,workspaceRoot:e.ws,workspaceId:e.p.workspace_id,snapshotDir:sd,manifestPath:snap.manifestPath});e.core.store.patchRun(id,{pid:child.pid});e.core.store.db.close();
  const core2=await new BridgeCore({stateRoot:e.state,geminiEntry:FAKE}).init();assert.equal(core2.getRun(id).status,'RECOVERY_IDENTITY_UNKNOWN');await assert.rejects(()=>core2.reconcileRun(id),/RECOVERY_PROCESS_IDENTITY_UNKNOWN/);assert.equal(isPidAlive(child.pid),true);
  child.kill('SIGKILL');await new Promise(r=>child.once('exit',r));
});

test('Phase C: failure persisting spawned process ownership kills child before sending prompt',async()=>{
  const e=await runner();let pid=null;
  await assert.rejects(()=>e.r.run({mode:'ask',cwd:e.cwd,payload:'TEST_SLEEP 5000',onProcess:async p=>{pid=p.pid;throw new Error('SIMULATED_PROCESS_PERSIST_FAILURE');}}),/SIMULATED_PROCESS_PERSIST_FAILURE/);
  assert.ok(pid);for(let i=0;i<50&&isPidAlive(pid);i++)await new Promise(r=>setTimeout(r,20));assert.equal(isPidAlive(pid),false);
});

test('Phase C: tampered persistent Gemini policy is replaced by current-code policy before use',async()=>{
  const e=await runner();const file=path.join(e.state,'policies','edit.json');await fsp.mkdir(path.dirname(file),{recursive:true});await fsp.writeFile(file,JSON.stringify({tools:{core:['shell','write_file']},security:{disableYoloMode:false}}));
  const actual=JSON.parse(await fsp.readFile(await e.r.settings('edit'),'utf8'));assert.ok(actual.tools.core.includes('write_file'));assert.ok(!actual.tools.core.includes('shell'));assert.equal(actual.security.disableYoloMode,true);
  const ask=JSON.parse(await fsp.readFile(await e.r.settings('ask'),'utf8'));assert.deepEqual(ask.tools.core,[]);
});
