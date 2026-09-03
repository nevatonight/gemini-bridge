import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ensureRuntimeConfig} from '../src/runtime-config.mjs';
import {BridgeCore} from '../src/core.mjs';
import {assertId,readJson,writeJson} from '../src/utils.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const HOST=path.join(ROOT,'src','host.mjs');
const FAKE=path.join(ROOT,'tests','fake-gemini.mjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function tmp(prefix='gb-phase-h-'){return await fsp.mkdtemp(path.join(os.tmpdir(),prefix));}
async function waitExit(p,ms=6000){if(p.exitCode!==null)return p.exitCode;return await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error(`child ${p.pid} exit timeout`)),ms);p.once('exit',c=>{clearTimeout(t);resolve(c);});});}
async function killChild(p){if(!p||p.exitCode!==null)return;try{p.kill('SIGTERM');}catch{};try{await waitExit(p,1000);}catch{try{p.kill('SIGKILL');}catch{};await waitExit(p,1000).catch(()=>{});}}
function spawnHost(state,stdio='ignore'){return spawn(process.execPath,[HOST],{env:{...process.env,GEMINI_BRIDGE_STATE:state},stdio});}
async function req(cfg,method,url,body=null){return await new Promise((resolve,reject)=>{const data=body===null?null:Buffer.from(JSON.stringify(body));const r=http.request({host:'127.0.0.1',port:cfg.port,path:url,method,headers:{Host:`127.0.0.1:${cfg.port}`,'X-Gemini-Bridge-Token':cfg.token,...(data?{'Content-Type':'application/json','Content-Length':data.length}:{})},timeout:2000},res=>{const cs=[];res.on('data',c=>cs.push(c));res.on('end',()=>{let parsed=null;try{parsed=JSON.parse(Buffer.concat(cs).toString())}catch{}resolve({status:res.statusCode,body:parsed});});});r.once('timeout',()=>r.destroy(new Error('http timeout')));r.once('error',reject);r.end(data||undefined);});}
async function prepareVersionedState(actualVersion,expectedVersion,{legacy=false}={}){const d=await tmp('gb-version-policy-'),state=path.join(d,'state');const cfg=await ensureRuntimeConfig(state);const entry=path.join(d,'version-wrapper.mjs');await fsp.writeFile(entry,`if(process.argv.includes('--version')){console.log(${JSON.stringify(actualVersion)});process.exit(0)}process.exit(91);\n`);cfg.geminiEntry=entry;if(!legacy)cfg.geminiVersion=expectedVersion;await writeJson(path.join(state,'runtime.json'),cfg);return {d,state,cfg};}
async function waitHealth(cfg,p,ms=5000){const end=Date.now()+ms;while(Date.now()<end&&p.exitCode===null){try{const h=await req(cfg,'GET','/v1/health');if(h.status===200&&h.body?.ok)return h.body;}catch{}await sleep(25);}return null;}

// Lost transient-tree P1: expected runtime version must be checked by the actual Host startup path.
test('Phase H: Host accepts a configured Gemini runtime when bounded --version matches the pinned version',async()=>{
  const {state,cfg}=await prepareVersionedState('0.55.1','0.55.1');const p=spawnHost(state);try{const h=await waitHealth(cfg,p);assert.ok(h);assert.equal(h.gemini.version,'0.55.1');await req(cfg,'POST','/v1/shutdown',{});assert.equal(await waitExit(p),0);}finally{await killChild(p);}
});

test('Phase H: Host version comparison accepts one conventional leading v consistently with Setup pin verification',async()=>{
  const {state,cfg}=await prepareVersionedState('v0.55.1','0.55.1');const p=spawnHost(state);try{const h=await waitHealth(cfg,p);assert.ok(h);assert.equal(h.gemini.version,'v0.55.1');await req(cfg,'POST','/v1/shutdown',{});assert.equal(await waitExit(p),0);}finally{await killChild(p);}
});

test('Phase H: Host fails closed when actual Gemini --version differs from runtime.json.geminiVersion',async()=>{
  const {state}=await prepareVersionedState('0.55.0','0.55.1');const p=spawnHost(state,['ignore','pipe','pipe']);let err='';p.stderr.on('data',b=>err+=b);try{assert.equal(await waitExit(p),2);assert.match(err,/GEMINI_VERSION_MISMATCH/);}finally{await killChild(p);}
});

test('Phase H: legacy runtime config without geminiVersion remains compatible but still requires a successful bounded version probe',async()=>{
  const {state,cfg}=await prepareVersionedState('0.55.1','ignored',{legacy:true});const p=spawnHost(state);try{const h=await waitHealth(cfg,p);assert.ok(h);assert.equal(h.gemini.version,'0.55.1');await req(cfg,'POST','/v1/shutdown',{});assert.equal(await waitExit(p),0);}finally{await killChild(p);}
});

test('Phase H: runtime pairing token accepts exactly 64 lowercase hex and rejects malformed boundary/content variants',async()=>{
  for(const token of ['a'.repeat(64),'0123456789abcdef'.repeat(4)]){const d=await tmp();await fsp.mkdir(path.join(d,'state'));await fsp.writeFile(path.join(d,'state','runtime.json'),JSON.stringify({token,port:38473}));assert.equal((await ensureRuntimeConfig(path.join(d,'state'))).token,token);}
  for(const token of ['a'.repeat(63),'a'.repeat(65),'A'.repeat(64),'g'.repeat(64),'a'.repeat(63)+'-']){const d=await tmp();await fsp.mkdir(path.join(d,'state'));await fsp.writeFile(path.join(d,'state','runtime.json'),JSON.stringify({token,port:38473}));await assert.rejects(()=>ensureRuntimeConfig(path.join(d,'state')),/RUNTIME_CONFIG_INVALID_TOKEN/);}
});

test('Phase H: runtime port accepts 1024 and 65535 and rejects values immediately outside the allowed range',async()=>{
  for(const port of [1024,65535]){const d=await tmp();await fsp.mkdir(path.join(d,'state'));await fsp.writeFile(path.join(d,'state','runtime.json'),JSON.stringify({token:'a'.repeat(64),port}));assert.equal((await ensureRuntimeConfig(path.join(d,'state'))).port,port);}
  for(const port of [1023,65536]){const d=await tmp();await fsp.mkdir(path.join(d,'state'));await fsp.writeFile(path.join(d,'state','runtime.json'),JSON.stringify({token:'a'.repeat(64),port}));await assert.rejects(()=>ensureRuntimeConfig(path.join(d,'state')),/RUNTIME_CONFIG_INVALID_PORT/);}
});

test('Phase H: Core/project/thread/request ID validator accepts exact 1 and 128 character boundaries and rejects over-limit IDs',async()=>{
  for(const id of ['a','Z'.repeat(128),'0'.repeat(128)])assert.equal(assertId(id,'id'),id);
  assert.throws(()=>assertId('x'.repeat(129),'id'),/INVALID_ID/);
  const d=await tmp(),state=path.join(d,'state');const core=await new BridgeCore({stateRoot:state,geminiEntry:FAKE}).init();const project=core.createProject('P');
  assert.deepEqual(core.listThreads('p'),[]);assert.deepEqual(core.listThreads('p'.repeat(128)),[]);assert.throws(()=>core.listThreads('p'.repeat(129)),/INVALID_PROJECT_ID/);
  assert.equal(core.getRun('r'),null);assert.equal(core.getRun('r'.repeat(128)),null);assert.throws(()=>core.getRun('r'.repeat(129)),/INVALID_RUN_ID/);
  await assert.rejects(()=>core.startRun({projectId:project.id,mode:'ask',prompt:'x',requestId:'q'.repeat(129)}),/INVALID_REQUEST_ID/);
  core.store.db.close();
});

test('Phase H: project context accepts exactly 120000 UTF-8 bytes and rejects one byte over',async()=>{
  const d=await tmp(),state=path.join(d,'state');const core=await new BridgeCore({stateRoot:state,geminiEntry:FAKE}).init();const p=core.createProject('P');const exact='é'.repeat(60000);assert.equal(Buffer.byteLength(exact,'utf8'),120000);const saved=await core.updateProject(p.id,{context:exact});assert.equal(Buffer.byteLength(core.store.getContext(p.id,saved.current_context_revision).content,'utf8'),120000);await assert.rejects(()=>core.updateProject(p.id,{context:exact+'x'}),/PROJECT_CONTEXT_TOO_LARGE/);core.store.db.close();
});
