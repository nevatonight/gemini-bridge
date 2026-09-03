import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {BridgeCore} from '../src/core.mjs';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {ensureRuntimeConfig} from '../src/runtime-config.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const FAKE=path.join(ROOT,'tests','fake-gemini.mjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function tmp(){return await fsp.mkdtemp(path.join(os.tmpdir(),'gb-ac-'));}
async function wait(core,id,timeout=6000){const end=Date.now()+timeout;while(Date.now()<end){const r=core.getRun(id);if(!['QUEUED','RUNNING'].includes(r.status))return r;await sleep(20);}throw new Error(`timeout:${core.getRun(id)?.status}`);}
async function fixture(){const d=await tmp(),state=path.join(d,'state');const core=await new BridgeCore({stateRoot:state,geminiEntry:FAKE}).init();const p=core.createProject('P');return {d,state,core,p};}

async function text(rel){return await fsp.readFile(path.join(ROOT,rel),'utf8');}

test('Phase AC: failed Ask remains in conversation history after core reopen without entering model turns',async()=>{
  const e=await fixture();
  const started=await e.core.startRun({projectId:e.p.id,mode:'ask',prompt:'TEST_FAIL real first ask',requestId:'ac-fail-1'});
  const failed=await wait(e.core,started.run.id);assert.equal(failed.status,'FAILED');
  const first=e.core.conversation(failed.threadId,100);
  const item=first.items.find(x=>x.kind==='failed-run');
  assert.equal(item?.runId,failed.id);assert.equal(item?.prompt,'TEST_FAIL real first ask');assert.equal(item?.mode,'ask');assert.equal(item?.status,'FAILED');assert.match(item?.error||'',/GEMINI_EXIT_/);
  assert.equal(e.core.turns(failed.threadId,100).length,0,'failed attempt must not become successful Gemini context');
  e.core.store.db.close();
  const reopened=await new BridgeCore({stateRoot:e.state,geminiEntry:FAKE}).init();
  const again=reopened.conversation(failed.threadId,100);assert.ok(again.items.some(x=>x.kind==='failed-run'&&x.runId===failed.id&&x.prompt==='TEST_FAIL real first ask'));
  reopened.store.db.close();await fsp.rm(e.d,{recursive:true,force:true});
});

test('Phase AC: successful turns are not duplicated by run history and later failure is represented once',async()=>{
  const e=await fixture();
  const ok=await e.core.startRun({projectId:e.p.id,mode:'ask',prompt:'hello',requestId:'ac-ok'});const okDone=await wait(e.core,ok.run.id);assert.equal(okDone.status,'COMPLETED');
  const bad=await e.core.startRun({projectId:e.p.id,threadId:okDone.threadId,mode:'ask',prompt:'TEST_FAIL later',requestId:'ac-bad'});const badDone=await wait(e.core,bad.run.id);assert.equal(badDone.status,'FAILED');
  const h=e.core.conversation(okDone.threadId,100);assert.equal(h.items.filter(x=>x.kind==='message').length,2);assert.equal(h.items.filter(x=>x.kind==='failed-run').length,1);assert.equal(h.items.filter(x=>x.runId===okDone.id).length,2);assert.equal(h.items.filter(x=>x.runId===badDone.id).length,1);
  e.core.store.db.close();await fsp.rm(e.d,{recursive:true,force:true});
});

test('Phase AC: Dashboard reloads durable conversation failures and exposes Retry plus technical details',async()=>{
  const s=await text('ui/app.js');
  assert.match(s,/loadConversation/);assert.match(s,/\/conversation\?limit=/);assert.match(s,/failed-run/);assert.match(s,/retry/i);assert.match(s,/technical|details/i);assert.match(s,/prompt/);assert.match(s,/mode/);
  assert.doesNotMatch(s,/function loadTurns|async function loadTurns/,'Dashboard must not fall back to successful-only turns for rendered history');
  assert.match(s,/loadThreads[\s\S]{0,800}loadConversation/,'thread reload must restore durable conversation history');
});

test('Phase AC: provider/auth/network failures have actionable categories while preserving raw diagnostics',async()=>{
  const s=await text('ui/app.js');assert.match(s,/classifyError|errorInfo/);for(const p of ['GEMINI_EXIT_','GEMINI_RESULT_ERROR','GEMINI_PROTOCOL','GEMINI_CLI_NOT_AVAILABLE'])assert.match(s,new RegExp(p));assert.match(s,/auth|OAuth|Google/i);assert.match(s,/quota|rate|429/i);assert.match(s,/network|ECONN|ETIMEDOUT/i);assert.match(s,/technical|raw|detail/i);
});


test('Phase AC: authenticated Host conversation endpoint returns a failed attempt after terminal refresh',async()=>{
  const d=await tmp(),state=path.join(d,'state'),cfg=await ensureRuntimeConfig(state);cfg.geminiEntry=FAKE;cfg.geminiVersion='0.55.1';await fsp.writeFile(path.join(state,'runtime.json'),JSON.stringify(cfg));
  const host=spawn(process.execPath,[path.join(ROOT,'src','host.mjs')],{env:{...process.env,GEMINI_BRIDGE_STATE:state},stdio:'ignore'});
  const req=(method,url,body=null)=>new Promise((resolve,reject)=>{const data=body===null?null:Buffer.from(JSON.stringify(body));const headers={'X-Gemini-Bridge-Token':cfg.token};if(data){headers['Content-Type']='application/json';headers['Content-Length']=data.length;}const r=http.request({host:'127.0.0.1',port:cfg.port,path:url,method,headers,timeout:1500},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{let parsed={};try{parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{}resolve({status:res.statusCode,body:parsed});});});r.on('error',reject);r.on('timeout',()=>r.destroy(new Error('timeout')));if(data)r.end(data);else r.end();});
  try{
    let ready=false;for(let i=0;i<100;i++){try{if((await req('GET','/v1/health')).status===200){ready=true;break;}}catch{}await sleep(25);}assert.equal(ready,true);
    const pr=(await req('POST','/v1/projects',{name:'P'})).body.project;const started=(await req('POST','/v1/runs',{projectId:pr.id,threadId:null,mode:'ask',prompt:'TEST_FAIL via HTTP',requestId:'ac-http-fail'})).body.run;
    let terminal=null;for(let i=0;i<150;i++){const rr=(await req('GET',`/v1/runs/${started.id}`)).body.run;if(!['QUEUED','RUNNING'].includes(rr.status)){terminal=rr;break;}await sleep(20);}assert.equal(terminal?.status,'FAILED');
    const conv=await req('GET',`/v1/threads/${terminal.threadId}/conversation?limit=100`);assert.equal(conv.status,200);assert.ok(conv.body.items.some(x=>x.kind==='failed-run'&&x.prompt==='TEST_FAIL via HTTP'&&x.status==='FAILED'));
  }finally{try{await req('POST','/v1/shutdown',{});}catch{}for(let i=0;i<80&&host.exitCode===null;i++)await sleep(25);if(host.exitCode===null)host.kill('SIGKILL');await fsp.rm(d,{recursive:true,force:true});}
});
