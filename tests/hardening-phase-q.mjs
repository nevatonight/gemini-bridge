import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolveManagedEntry} from '../src/managed-gemini-probe.mjs';
import {ensureRuntimeConfig} from '../src/runtime-config.mjs';
import {BridgeCore} from '../src/core.mjs';
import {processIdentitySync, readJson} from '../src/utils.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const HOST=path.join(ROOT,'src','host.mjs');
const FAKE=path.join(ROOT,'tests','fake-gemini.mjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function tmp(prefix='gb-q-'){return await fsp.mkdtemp(path.join(os.tmpdir(),prefix));}
async function writePkg(prefix,bin='dist/cli.mjs'){
  const pkg=path.join(prefix,'node_modules','@google','gemini-cli');await fsp.mkdir(path.join(pkg,'dist'),{recursive:true});
  await fsp.writeFile(path.join(pkg,'package.json'),JSON.stringify({version:'0.55.1',bin:{gemini:bin}}));
  await fsp.writeFile(path.join(pkg,'dist','cli.mjs'),'console.log("0.55.1")');return pkg;
}
async function waitExit(p,ms=3000){if(p.exitCode!==null)return p.exitCode;return await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('exit timeout')),ms);p.once('exit',c=>{clearTimeout(t);resolve(c);});});}
async function kill(p){if(!p||p.exitCode!==null)return;try{p.kill('SIGTERM');}catch{};try{await waitExit(p,700);}catch{try{p.kill('SIGKILL');}catch{};await waitExit(p,700).catch(()=>{});}}
async function req(cfg,method,url,body={}){return await new Promise((resolve,reject)=>{const data=Buffer.from(JSON.stringify(body));const r=http.request({host:'127.0.0.1',port:cfg.port,path:url,method,headers:{'X-Gemini-Bridge-Token':cfg.token,'Content-Type':'application/json','Content-Length':data.length},timeout:1500},res=>{const cs=[];res.on('data',c=>cs.push(c));res.on('end',()=>{let b=null;try{b=JSON.parse(Buffer.concat(cs).toString())}catch{};resolve({status:res.statusCode,body:b});});});r.on('error',reject);r.on('timeout',()=>r.destroy(new Error('timeout')));r.end(data);});}
async function waitReady(cfg,p,ms=2500){const end=Date.now()+ms;while(Date.now()<end&&p.exitCode===null){try{const r=await req(cfg,'GET','/v1/health',{});if(r.status===200)return r.body;}catch{}await sleep(25);}return null;}

// All of these tests are expected to fail against the sealed 0.4.4 package.
test('Phase Q: managed Gemini rejects a direct symlink entry',async()=>{
  const d=await tmp(),prefix=path.join(d,'runtime'),pkg=await writePkg(prefix),outside=path.join(d,'outside.mjs');await fsp.writeFile(outside,'x');await fsp.rm(path.join(pkg,'dist','cli.mjs'));await fsp.symlink(outside,path.join(pkg,'dist','cli.mjs'));
  await assert.rejects(()=>resolveManagedEntry(prefix,'0.55.1'),/SYMLINK|REALPATH_ESCAPED/);
});

test('Phase Q: managed Gemini rejects package parent symlink escape from runtime root',async()=>{
  const d=await tmp(),prefix=path.join(d,'runtime'),outside=path.join(d,'outside','gemini-cli');await fsp.mkdir(path.join(prefix,'node_modules','@google'),{recursive:true});await fsp.mkdir(path.join(outside,'dist'),{recursive:true});await fsp.writeFile(path.join(outside,'package.json'),JSON.stringify({version:'0.55.1',bin:{gemini:'dist/cli.mjs'}}));await fsp.writeFile(path.join(outside,'dist','cli.mjs'),'x');await fsp.symlink(outside,path.join(prefix,'node_modules','@google','gemini-cli'),'dir');
  await assert.rejects(()=>resolveManagedEntry(prefix,'0.55.1'),/REALPATH_ESCAPED|SYMLINK/);
});

test('Phase Q: runtime init contender never returns an incomplete runtime.json',async()=>{
  const d=await tmp(),state=path.join(d,'state');await fsp.mkdir(state,{recursive:true});const lock=path.join(state,'runtime.init.lock'),file=path.join(state,'runtime.json');
  await fsp.writeFile(lock,JSON.stringify({pid:process.pid,processIdentity:processIdentitySync(process.pid),nonce:'held'}));
  const pending=ensureRuntimeConfig(state);await sleep(80);await fsp.writeFile(file,JSON.stringify({token:'a'.repeat(64)}));await fsp.rm(lock);
  await assert.rejects(()=>pending,/RUNTIME_CONFIG_INCOMPLETE/);
});

async function makeUnknown(mode){const d=await tmp(),state=path.join(d,'state'),ws=path.join(d,'ws');await fsp.mkdir(ws,{recursive:true});const core=await new BridgeCore({stateRoot:state,geminiEntry:FAKE}).init();const p=core.createProject('P');await core.updateProject(p.id,{workspace:ws});const th=core.createThread(p.id,'T');const id=`unknown-${mode}-${Date.now()}`;const child=spawn(process.execPath,['-e','setTimeout(()=>{},10000)'],{stdio:'ignore'});const status=mode==='edit'?'RECOVERY_IDENTITY_UNKNOWN':'ORPHAN_IDENTITY_UNKNOWN';core.store.createRun({id,requestId:id,requestFingerprint:'fp',projectId:p.id,threadId:th.id,mode,status,prompt:'x',contextRevision:core.store.getProject(p.id).current_context_revision,workspaceRoot:p.workspace,workspaceId:p.workspace_id,snapshotDir:mode==='edit'?path.join(state,'run-data','x','snapshot'):null,manifestPath:null});core.store.patchRun(id,{pid:child.pid,process_identity:null});return {core,p,id,child};}

test('Phase Q: legacy unknown orphan becomes FAILED only after recorded PID disappears',async()=>{const e=await makeUnknown('ask');try{assert.equal(e.core.getRun(e.id).status,'ORPHAN_IDENTITY_UNKNOWN');e.child.kill('SIGKILL');await waitExit(e.child);assert.equal(e.core.getRun(e.id).status,'FAILED');}finally{await kill(e.child);e.core.store.db.close();}});

test('Phase Q: legacy unknown edit becomes RECOVERY_REQUIRED after recorded PID disappears',async()=>{const e=await makeUnknown('edit');try{assert.equal(e.core.getRun(e.id).status,'RECOVERY_IDENTITY_UNKNOWN');e.child.kill('SIGKILL');await waitExit(e.child);assert.equal(e.core.getRun(e.id).status,'RECOVERY_REQUIRED');}finally{await kill(e.child);e.core.store.db.close();}});

test('Phase Q: upgrade readiness refreshes dead unknown-identity records instead of permanent deadlock',async()=>{const e=await makeUnknown('ask');try{e.core.setMaintenance(true);assert.equal(e.core.upgradeReadiness().ok,false);e.child.kill('SIGKILL');await waitExit(e.child);const r=e.core.upgradeReadiness();assert.equal(r.unfinished.some(x=>x.id===e.id),false);assert.equal(r.ok,true);}finally{await kill(e.child);e.core.store.db.close();}});

test('Phase Q: Setup root-bound path proof follows real filesystem path and fail-closes missing state on upgrade',async()=>{const s=await fsp.readFile(path.join(ROOT,'Setup.ps1'),'utf8');assert.match(s,/Resolve-Path[\s\S]{0,600}(managed runtime|mustBeUnder|escaped)/i);assert.match(s,/HadProgramBefore[\s\S]{0,800}bridge\.sqlite[\s\S]{0,300}(Fail|missing|repair)/i);});

async function hostLockCase(identity){const d=await tmp(),state=path.join(d,'state'),cfg=await ensureRuntimeConfig(state);cfg.geminiEntry=FAKE;cfg.geminiVersion='0.55.1';await fsp.writeFile(path.join(state,'runtime.json'),JSON.stringify(cfg));const old={pid:process.pid,processIdentity:identity,instanceId:'b'.repeat(32),launchNonce:null,startedAt:new Date().toISOString()};await fsp.writeFile(path.join(state,'host.lock.json'),JSON.stringify(old));const p=spawn(process.execPath,[HOST],{env:{...process.env,GEMINI_BRIDGE_STATE:state},stdio:'ignore'});return {state,cfg,old,p};}

test('Phase Q: Host startup refuses a verified-live existing owner lock without overwriting it',async()=>{const e=await hostLockCase(processIdentitySync(process.pid));try{const h=await waitReady(e.cfg,e.p,900);assert.equal(h,null);assert.equal(await waitExit(e.p,2500),2);assert.deepEqual(await readJson(path.join(e.state,'host.lock.json'),null),e.old);}finally{await kill(e.p);}});

test('Phase Q: Host startup refuses an ambiguously-live legacy owner lock',async()=>{const e=await hostLockCase(null);try{const h=await waitReady(e.cfg,e.p,900);assert.equal(h,null);assert.equal(await waitExit(e.p,2500),2);assert.deepEqual(await readJson(path.join(e.state,'host.lock.json'),null),e.old);}finally{await kill(e.p);}});

test('Phase Q: accepted shutdown makes maintenance admission irreversible',async()=>{const d=await tmp(),state=path.join(d,'state'),cfg=await ensureRuntimeConfig(state);cfg.geminiEntry=FAKE;cfg.geminiVersion='0.55.1';await fsp.writeFile(path.join(state,'runtime.json'),JSON.stringify(cfg));const p=spawn(process.execPath,[HOST],{env:{...process.env,GEMINI_BRIDGE_STATE:state},stdio:'ignore'});try{assert.ok(await waitReady(cfg,p,2500));assert.equal((await req(cfg,'POST','/v1/shutdown',{})).status,200);let reopen=null;try{reopen=await req(cfg,'POST','/v1/maintenance',{enabled:false});}catch{};assert.ok(!reopen||reopen.status>=400||reopen.body?.maintenance!==false,'maintenance reopened after shutdown admission');await waitExit(p,4000);}finally{await kill(p);}});

test('Phase Q: shutdownActive attempts cancellation of every active run before reporting failure',async()=>{const d=await tmp(),core=await new BridgeCore({stateRoot:path.join(d,'state'),geminiEntry:FAKE}).init();const called=[];core.active.set('one',{cancel:async()=>{called.push('one');throw new Error('first failed')}});core.active.set('two',{cancel:async()=>{called.push('two');core.active.delete('two')}});core.cancelRun=async id=>await core.active.get(id)?.cancel();await assert.rejects(()=>core.shutdownActive({timeoutMs:120}),/SHUTDOWN|first failed/);assert.deepEqual(called,['one','two']);core.active.clear();core.store.db.close();});
