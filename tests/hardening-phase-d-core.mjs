import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { BridgeCore } from '../src/core.mjs';
import { workspaceIdentity } from '../src/utils.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const FAKE=path.join(ROOT,'tests','fake-gemini.mjs');
async function tmp(prefix='gb-dc-'){return await fsp.mkdtemp(path.join(os.tmpdir(),prefix));}
async function makeCore({workspace=true,maxGeminiProcesses=3,files=2}={}){const d=await tmp(),state=path.join(d,'state'),ws=path.join(d,'w');if(workspace){await fsp.mkdir(ws,{recursive:true});for(let i=0;i<files;i++)await fsp.writeFile(path.join(ws,`f${i}.txt`),`v${i}`);}const core=await new BridgeCore({stateRoot:state,geminiEntry:FAKE,maxGeminiProcesses}).init();const p=core.createProject('P');await core.updateProject(p.id,{context:'ctx',...(workspace?{workspace:ws}:{})});return {d,state,ws,core,p:core.store.getProject(p.id)};}
async function wait(core,id,pred=r=>['COMPLETED','FAILED','CANCELLED','WAITING_APPLY','RECOVERY_REQUIRED'].includes(r.status),timeout=8000){const end=Date.now()+timeout;while(Date.now()<end){const r=core.getRun(id);if(pred(r))return r;await new Promise(r=>setTimeout(r,15));}throw new Error(`timeout:${core.getRun(id)?.status}`);}

test('Phase D Core: handoff refuses a thread owned by another project before reading its turns',async()=>{
  const e=await makeCore({workspace:false});const b=e.core.createProject('B');const th=e.core.createThread(b.id,'B thread');
  assert.throws(()=>e.core.handoff(e.p.id,th.id),/THREAD_NOT_FOUND/);
});

test('Phase D Core: project name/workspace/context revision update is one SQLite transaction',async()=>{
  const e=await makeCore();const before=e.core.store.getProject(e.p.id);e.core.store.db.exec(`CREATE TRIGGER fail_context BEFORE INSERT ON context_revisions WHEN NEW.source='FAIL' BEGIN SELECT RAISE(ABORT,'fault'); END;`);
  assert.throws(()=>e.core.store.updateProject(e.p.id,{name:'changed',workspace:'/tmp/changed',workspaceId:'wid',context:'changed context',source:'FAIL'}),/fault/);
  const after=e.core.store.getProject(e.p.id);assert.equal(after.name,before.name);assert.equal(after.workspace,before.workspace);assert.equal(after.workspace_id,before.workspace_id);assert.equal(after.current_context_revision,before.current_context_revision);assert.equal(after.context,before.context);
});

test('Phase D Core: successful run state and both conversation turns commit atomically',async()=>{
  const e=await makeCore({workspace:false});const th=e.core.createThread(e.p.id,'t'),id=crypto.randomUUID();e.core.store.createRun({id,requestId:'atomic-turns',requestFingerprint:'fp',projectId:e.p.id,threadId:th.id,mode:'ask',status:'RUNNING',prompt:'u',contextRevision:e.p.current_context_revision});
  e.core.store.db.exec(`CREATE TRIGGER fail_assistant BEFORE INSERT ON turns WHEN NEW.role='assistant' BEGIN SELECT RAISE(ABORT,'turn-fault'); END;`);
  assert.throws(()=>e.core.store.completeRunWithTurns(id,'RUNNING','COMPLETED',{result_text:'a',partial_text:null},'u','a'),/turn-fault/);
  const r=e.core.store.getRun(id);assert.equal(r.status,'RUNNING');assert.equal(r.result_text,null);assert.equal(e.core.store.listTurns(th.id).length,0);
});

test('Phase D Core: partial_text is transient and cleared by successful atomic persistence',async()=>{
  const e=await makeCore({workspace:false});const o=await e.core.startRun({projectId:e.p.id,mode:'ask',prompt:'TEST_SLEEP 400',requestId:'partial-clear'});const r=await wait(e.core,o.run.id);assert.equal(r.status,'COMPLETED');assert.equal(e.core.store.getRun(r.id).partial_text,null);assert.equal(e.core.turns(r.threadId).length,2);
});

test('Phase D Core: global process gate blocks new runs but never blocks idempotent retry',async()=>{
  const e=await makeCore({workspace:false,maxGeminiProcesses:2});const a=await e.core.startRun({projectId:e.p.id,mode:'ask',prompt:'TEST_SLEEP 900',requestId:'slot-a'});const b=await e.core.startRun({projectId:e.p.id,mode:'ask',prompt:'TEST_SLEEP 900',requestId:'slot-b'});
  await assert.rejects(()=>e.core.startRun({projectId:e.p.id,mode:'ask',prompt:'new',requestId:'slot-c'}),/GEMINI_BUSY/);
  const retry=await e.core.startRun({projectId:e.p.id,mode:'ask',prompt:'TEST_SLEEP 900',requestId:'slot-a'});assert.equal(retry.reused,true);assert.equal(retry.run.id,a.run.id);
  await Promise.all([wait(e.core,a.run.id),wait(e.core,b.run.id)]);
});

test('Phase D Core: Review is blocked while same workspace has pending Agent changes but Ask remains available',async()=>{
  const e=await makeCore();const edit=await e.core.startRun({projectId:e.p.id,mode:'edit',prompt:'TEST_EDIT f0.txt => agent',requestId:'pending-edit'});const er=await wait(e.core,edit.run.id);assert.equal(er.status,'WAITING_APPLY');
  await assert.rejects(()=>e.core.startRun({projectId:e.p.id,mode:'review',prompt:'review',requestId:'blocked-review'}),/PENDING_AGENT_CHANGES/);
  const ask=await e.core.startRun({projectId:e.p.id,mode:'ask',prompt:'hello',requestId:'ask-ok'});assert.equal((await wait(e.core,ask.run.id)).status,'COMPLETED');await e.core.discardRun(er.id);
});

test('Phase D Core: cancel during snapshot traversal aborts cooperatively and Gemini is never spawned',async()=>{
  const e=await makeCore({files:3500});let spawned=0;e.core.gemini.run=async()=>{spawned++;return {text:'should-not-run',model:'x'};};
  const o=await e.core.startRun({projectId:e.p.id,mode:'review',prompt:'review',requestId:'cancel-scan'});await e.core.cancelRun(o.run.id);const r=await wait(e.core,o.run.id);assert.equal(r.status,'CANCELLED');assert.equal(spawned,0);
});
