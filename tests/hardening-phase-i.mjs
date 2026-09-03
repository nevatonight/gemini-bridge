import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {BridgeCore} from '../src/core.mjs';
import {Store} from '../src/store.mjs';
import {buildSnapshot} from '../src/snapshot.mjs';
import {offlineStateCheck} from '../src/offline-check.mjs';
import {ensureRuntimeConfig} from '../src/runtime-config.mjs';
import {readJson} from '../src/utils.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const HOST=path.join(ROOT,'src','host.mjs');
const FAKE=path.join(ROOT,'tests','fake-gemini.mjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function tmp(prefix='gb-phase-i-'){return await fsp.mkdtemp(path.join(os.tmpdir(),prefix));}
function alive(pid){if(!pid)return false;try{process.kill(pid,0);return true;}catch{return false;}}
async function waitExit(p,ms=7000){if(p.exitCode!==null)return p.exitCode;return await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error(`child ${p.pid} exit timeout`)),ms);p.once('exit',c=>{clearTimeout(t);resolve(c);});});}
async function killChild(p){if(!p||p.exitCode!==null)return;try{p.kill('SIGTERM');}catch{};try{await waitExit(p,1200);}catch{try{p.kill('SIGKILL');}catch{};await waitExit(p,1200).catch(()=>{});}}
function spawnHost(state){return spawn(process.execPath,[HOST],{env:{...process.env,GEMINI_BRIDGE_STATE:state,GEMINI_BRIDGE_GEMINI_ENTRY:FAKE},stdio:['ignore','pipe','pipe']});}
async function req(cfg,method,url,body=null){return await new Promise((resolve,reject)=>{const data=body===null?null:Buffer.from(JSON.stringify(body));const r=http.request({host:'127.0.0.1',port:cfg.port,path:url,method,headers:{Host:`127.0.0.1:${cfg.port}`,'X-Gemini-Bridge-Token':cfg.token,...(data?{'Content-Type':'application/json','Content-Length':data.length}:{})},timeout:2500},res=>{const cs=[];res.on('data',c=>cs.push(c));res.on('end',()=>{let parsed=null;try{parsed=JSON.parse(Buffer.concat(cs).toString())}catch{}resolve({status:res.statusCode,body:parsed});});});r.once('timeout',()=>r.destroy(new Error('http timeout')));r.once('error',reject);r.end(data||undefined);});}
async function waitReady(state,p,ms=6000){const end=Date.now()+ms;while(Date.now()<end&&p.exitCode===null){const cfg=await readJson(path.join(state,'runtime.json'),null);if(cfg){try{const h=await req(cfg,'GET','/v1/health');if(h.status===200&&h.body?.ok)return cfg;}catch{}}await sleep(25);}throw new Error('Host not ready');}

// Host lifecycle: shutdown must join terminal persistence before SQLite closes.
test('Phase I: Host shutdown cancels an active Gemini run, waits for terminal persistence, and leaves no owned child alive',{timeout:15000},async()=>{
  const d=await tmp('gb-shutdown-active-'),state=path.join(d,'state'),host=spawnHost(state);let cfg;try{cfg=await waitReady(state,host);const p=(await req(cfg,'POST','/v1/projects',{name:'P'})).body.project;const started=(await req(cfg,'POST','/v1/runs',{projectId:p.id,mode:'ask',prompt:'TEST_SLEEP 5000',requestId:'shutdown-active'})).body.run;let pid=null;for(let i=0;i<120;i++){const dbFile=path.join(state,'bridge.sqlite');if(fs.existsSync(dbFile)){const db=new DatabaseSync(dbFile,{readOnly:true});try{const r=db.prepare('SELECT status,pid FROM runs WHERE id=?').get(started.id);if(r?.status==='RUNNING'&&r.pid){pid=Number(r.pid);break;}}finally{db.close();}}await sleep(25);}assert.ok(pid&&alive(pid),'expected a live owned Gemini child before shutdown');assert.equal((await req(cfg,'POST','/v1/shutdown',{})).status,200);assert.equal(await waitExit(host,7000),0);for(let i=0;i<40&&alive(pid);i++)await sleep(25);assert.equal(alive(pid),false);const store=await new Store(state).init();try{const r=store.getRun(started.id);assert.equal(r.status,'CANCELLED');assert.equal(r.pid,null);assert.equal(r.process_identity,null);assert.equal(store.listTurns(r.thread_id).length,0);}finally{store.db.close();}}
  finally{await killChild(host);}
});

test('Phase I: SQLite READONLY write failure leaves project state unchanged and surfaces the primary storage error',async()=>{
  const root=await tmp('gb-readonly-'),store=await new Store(root).init();const p=store.createProject('Before');store.updateProject(p.id,{context:'before'});const before=store.getProject(p.id);store.db.exec('PRAGMA query_only=ON');let error;try{store.updateProject(p.id,{name:'After',context:'after'});}catch(e){error=e;}assert.ok(error);assert.match(String(error?.message||error),/readonly|read-only/i);store.db.exec('PRAGMA query_only=OFF');const after=store.getProject(p.id);assert.equal(after.name,before.name);assert.equal(after.context,before.context);assert.equal(after.current_context_revision,before.current_context_revision);store.db.close();
});

test('Phase I: offline upgrade check rejects a readable SQLite file with incomplete schema without mutating it',async()=>{
  const root=await tmp('gb-schema-incomplete-'),file=path.join(root,'bridge.sqlite');const db=new DatabaseSync(file);db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY)');db.close();const before=await fsp.readFile(file);const out=await offlineStateCheck(root);const after=await fsp.readFile(file);assert.equal(out.ok,false);assert.equal(out.error,'STATE_SCHEMA_INCOMPLETE');assert.ok(out.missing.includes('runs'));assert.deepEqual(after,before);
});

test('Phase I: recovery with external conflict becomes APPLY_CONFLICT without overwriting the live file',async()=>{
  const d=await tmp('gb-recovery-conflict-'),state=path.join(d,'state'),ws=path.join(d,'ws');await fsp.mkdir(ws);await fsp.writeFile(path.join(ws,'a.txt'),'base');const core=await new BridgeCore({stateRoot:state,geminiEntry:FAKE}).init();const p=core.createProject('P');await core.updateProject(p.id,{workspace:ws});const project=core.store.getProject(p.id),th=core.createThread(p.id,'T'),id=crypto.randomUUID(),sd=path.join(state,'run-data','recovery-conflict','snapshot'),snap=await buildSnapshot(ws,sd,{mode:'edit'});await fsp.writeFile(path.join(snap.filesDir,'a.txt'),'agent');core.store.createRun({id,requestId:'recovery-conflict',requestFingerprint:'fp',projectId:p.id,threadId:th.id,mode:'edit',status:'RECOVERY_REQUIRED',prompt:'x',contextRevision:project.current_context_revision,workspaceRoot:project.workspace,workspaceId:project.workspace_id,snapshotDir:sd,manifestPath:snap.manifestPath});await fsp.writeFile(path.join(ws,'a.txt'),'external');const rec=await core.reconcileRun(id);assert.equal(rec.run.status,'APPLY_CONFLICT');assert.equal(rec.reconciliation.conflicts.length,1);assert.equal(await fsp.readFile(path.join(ws,'a.txt'),'utf8'),'external');core.store.db.close();
});

test('Phase I: runtime config rejects malformed configured Gemini version metadata instead of coercing it',async()=>{
  for(const bad of ['',{},'bad version','x'.repeat(129),'\n0.55.1']){const d=await tmp('gb-version-meta-'),state=path.join(d,'state');await fsp.mkdir(state);await fsp.writeFile(path.join(state,'runtime.json'),JSON.stringify({token:'a'.repeat(64),port:38473,geminiVersion:bad}));await assert.rejects(()=>ensureRuntimeConfig(state),/RUNTIME_CONFIG_INVALID_GEMINI_VERSION/);}
});

test('Phase I: extension is provider-isolated to chatgpt.com UI plus loopback Bridge and does not intercept the native composer',async()=>{
  const manifest=JSON.parse(await fsp.readFile(path.join(ROOT,'web-extension','manifest.json'),'utf8')),bg=await fsp.readFile(path.join(ROOT,'web-extension','background.js'),'utf8'),content=await fsp.readFile(path.join(ROOT,'web-extension','content.js'),'utf8');assert.deepEqual(manifest.content_scripts?.[0]?.matches,['https://chatgpt.com/*']);assert.deepEqual(manifest.host_permissions,['http://127.0.0.1/*']);assert.match(bg,/const BASE=`http:\/\/127\.0\.0\.1:/);assert.doesNotMatch(bg,/https?:\/\/(?:api\.)?openai\.com|chatgpt\.com/i);assert.doesNotMatch(content,/document\.querySelector|document\.querySelectorAll|contenteditable/i);assert.match(content,/attachShadow\(\{mode:'closed'\}\)/);assert.doesNotMatch(content,/https?:\/\/(?:api\.)?openai\.com/i);
});
