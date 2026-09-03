import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import http from 'node:http';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {BridgeCore} from '../src/core.mjs';
import {buildSnapshot} from '../src/snapshot.mjs';
import {readJson} from '../src/utils.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const HOST=path.join(ROOT,'src','host.mjs');
const FAKE=path.join(ROOT,'tests','fake-gemini.mjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function tmp(prefix='gb-stress-'){return await fsp.mkdtemp(path.join(os.tmpdir(),prefix));}
async function wait(core,id,timeout=8000){const end=Date.now()+timeout;while(Date.now()<end){const r=core.getRun(id);if(['COMPLETED','FAILED','CANCELLED','WAITING_APPLY','RECOVERY_REQUIRED'].includes(r.status))return r;await sleep(15);}throw new Error(`run timeout:${core.getRun(id)?.status}`);}
async function makeCore(){const d=await tmp(),state=path.join(d,'state');const core=await new BridgeCore({stateRoot:state,geminiEntry:FAKE,maxGeminiProcesses:4}).init();const p=core.createProject('P');return {d,state,core,p};}
function spawnHost(state){return spawn(process.execPath,[HOST],{env:{...process.env,GEMINI_BRIDGE_STATE:state,GEMINI_BRIDGE_GEMINI_ENTRY:FAKE},stdio:'ignore'});}
async function waitExit(p,ms=5000){if(p.exitCode!==null)return p.exitCode;return await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('exit timeout')),ms);p.once('exit',c=>{clearTimeout(t);resolve(c);});});}
async function killChild(p){if(!p||p.exitCode!==null)return;try{p.kill('SIGTERM');}catch{};try{await waitExit(p,1000);}catch{try{p.kill('SIGKILL');}catch{};}}
async function req(cfg,method,url,raw=null,headers={}){return await new Promise((resolve,reject)=>{const data=raw===null?null:Buffer.from(raw);const h={'X-Gemini-Bridge-Token':cfg.token,...headers};if(data){h['Content-Type']='application/json';h['Content-Length']=data.length;}const r=http.request({host:'127.0.0.1',port:cfg.port,path:url,method,headers:h,timeout:3000},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{const text=Buffer.concat(chunks).toString();let body=null;try{body=JSON.parse(text);}catch{}resolve({status:res.statusCode,body,text});});});r.once('timeout',()=>r.destroy(new Error('http timeout')));r.once('error',reject);r.end(data||undefined);});}
async function waitReady(state,p,ms=8000){const end=Date.now()+ms;while(Date.now()<end){const cfg=await readJson(path.join(state,'runtime.json'),null);if(cfg){try{const h=await req(cfg,'GET','/v1/health');if(h.status===200&&h.body?.ok)return cfg;}catch{}}if(p.exitCode!==null)break;await sleep(25);}throw new Error('host not ready');}
async function stopHost(cfg,p){try{await req(cfg,'POST','/v1/shutdown','{}');}catch{};await waitExit(p,2500).catch(()=>killChild(p));}

test('Stress/fuzz: 50 simultaneous identical request IDs create exactly one run and one Gemini execution',{timeout:15000},async()=>{
  const e=await makeCore();let executions=0;const original=e.core.gemini.run.bind(e.core.gemini);e.core.gemini.run=async opts=>{executions++;return await original(opts);};
  const requestId=`same-${crypto.randomUUID()}`;const calls=Array.from({length:50},()=>e.core.startRun({projectId:e.p.id,mode:'ask',prompt:'TEST_SLEEP 200',requestId}));const results=await Promise.all(calls);
  const ids=new Set(results.map(x=>x.run.id));assert.equal(ids.size,1);assert.equal(results.filter(x=>x.reused===false).length,1);assert.equal(results.filter(x=>x.reused===true).length,49);
  const run=await wait(e.core,results[0].run.id);assert.equal(run.status,'COMPLETED');assert.equal(executions,1);assert.equal(e.core.store.db.prepare('SELECT COUNT(*) n FROM runs WHERE request_id=?').get(requestId).n,1);
});

test('Stress/fuzz: same idempotency key with a different payload is rejected without re-execution',async()=>{
  const e=await makeCore();let executions=0;const original=e.core.gemini.run.bind(e.core.gemini);e.core.gemini.run=async opts=>{executions++;return await original(opts);};const requestId=`reuse-${crypto.randomUUID()}`;
  const first=await e.core.startRun({projectId:e.p.id,mode:'ask',prompt:'first',requestId});await assert.rejects(()=>e.core.startRun({projectId:e.p.id,mode:'ask',prompt:'different',requestId}),/IDEMPOTENCY_KEY_REUSE/);assert.equal((await wait(e.core,first.run.id)).status,'COMPLETED');assert.equal(executions,1);
});

test('Stress/fuzz: malformed and wrong-type HTTP bodies fail closed across writable endpoints',{timeout:12000},async()=>{
  const d=await tmp('gb-http-fuzz-'),state=path.join(d,'state'),p=spawnHost(state);let cfg;try{cfg=await waitReady(state,p);const create=await req(cfg,'POST','/v1/projects',JSON.stringify({name:'P'}));assert.equal(create.status,201);const projectId=create.body.project.id;
    const cases=[
      ['/v1/projects','null'],['/v1/projects','[]'],['/v1/projects','"x"'],['/v1/projects','{'],['/v1/projects',JSON.stringify({name:1})],['/v1/projects',JSON.stringify({name:false})],['/v1/projects',JSON.stringify({extra:1})],
      ['/v1/maintenance',JSON.stringify({enabled:'true'})],['/v1/maintenance',JSON.stringify({enabled:1})],['/v1/maintenance',JSON.stringify({})],['/v1/maintenance',JSON.stringify({enabled:false,x:1})],
      ['/v1/runs',JSON.stringify({projectId,mode:'ask',prompt:'x',requestId:{}})],['/v1/runs',JSON.stringify({projectId,mode:1,prompt:'x',requestId:'r1'})],['/v1/runs',JSON.stringify({projectId,mode:'shell',prompt:'x',requestId:'r2'})],['/v1/runs',JSON.stringify({projectId,mode:'ask',prompt:[],requestId:'r3'})],['/v1/runs',JSON.stringify({projectId,mode:'ask',prompt:'x',requestId:'r4',extra:true})],
      ['/v1/handoff',JSON.stringify({projectId:1})],['/v1/handoff',JSON.stringify({projectId,threadId:123})],['/v1/handoff',JSON.stringify({projectId,extra:true})]
    ];
    for(const [url,raw] of cases){const r=await req(cfg,'POST',url,raw);assert.ok(r.status>=400&&r.status<500,`${url} ${raw} => ${r.status} ${r.text}`);}
    const health=await req(cfg,'GET','/v1/health');assert.equal(health.status,200);assert.equal(health.body.ok,true);
  }finally{if(cfg)await stopHost(cfg,p);else await killChild(p);}
});

test('Stress/fuzz: snapshot aborts before traversal when already cancelled',async()=>{
  const d=await tmp(),ws=path.join(d,'w'),snap=path.join(d,'snap');await fsp.mkdir(ws);await fsp.writeFile(path.join(ws,'a.txt'),'a');const c=new AbortController();c.abort();await assert.rejects(()=>buildSnapshot(ws,snap,{signal:c.signal}),/CANCELLED/);assert.equal(await fsp.stat(ws).then(s=>s.isDirectory()),true);
});

test('Stress/fuzz: snapshot exact max-file boundary is included and one byte over is excluded',async()=>{
  const d=await tmp(),ws=path.join(d,'w');await fsp.mkdir(ws);const exact='a'.repeat(3*1024*1024);await fsp.writeFile(path.join(ws,'exact.txt'),exact);await fsp.writeFile(path.join(ws,'over.txt'),exact+'b');const out=await buildSnapshot(ws,path.join(d,'snap'));
  assert.equal(out.manifest.files['exact.txt'].size,3*1024*1024);assert.equal(Object.prototype.hasOwnProperty.call(out.manifest.files,'over.txt'),false);assert.ok(out.manifest.skipped.some(x=>x.path==='over.txt'&&x.reason==='file-too-large'));
});

test('Stress/fuzz: snapshot max-depth boundary accepts depth 24 and rejects depth 25',async()=>{
  const d=await tmp('gb-depth-'),ws=path.join(d,'w');await fsp.mkdir(ws);let cur=ws;for(let i=1;i<=24;i++){cur=path.join(cur,`d${String(i).padStart(2,'0')}`);await fsp.mkdir(cur);}await fsp.writeFile(path.join(cur,'ok.txt'),'ok');const exact=await buildSnapshot(ws,path.join(d,'snap-exact'));assert.ok(exact.manifest.files[[...Array(24)].map((_,i)=>`d${String(i+1).padStart(2,'0')}`).join('/')+'/ok.txt']);
  const d25=path.join(cur,'d25');await fsp.mkdir(d25);await fsp.writeFile(path.join(d25,'too-deep.txt'),'x');await assert.rejects(()=>buildSnapshot(ws,path.join(d,'snap-over')),/WORKSPACE_TOO_DEEP/);
});

test('Stress/fuzz: snapshot entry-count boundary accepts 12000 entries and rejects 12001',{timeout:60000},async()=>{
  const d=await tmp('gb-entries-'),ws=path.join(d,'w');await fsp.mkdir(ws);const total=12000,batch=300;
  for(let start=0;start<total;start+=batch){await Promise.all(Array.from({length:Math.min(batch,total-start)},(_,j)=>fsp.mkdir(path.join(ws,`e${String(start+j).padStart(5,'0')}`))));}
  const exact=await buildSnapshot(ws,path.join(d,'snap-exact'));assert.equal(exact.manifest.stats.entries,total);assert.equal(exact.manifest.directories.length,total);
  await fsp.mkdir(path.join(ws,'zzzzz-extra'));await assert.rejects(()=>buildSnapshot(ws,path.join(d,'snap-over')),/WORKSPACE_TOO_MANY_ENTRIES/);
});

test('Stress/fuzz: snapshot total-byte boundary accepts exactly 80 MiB and rejects one byte over',{timeout:60000},async()=>{
  const d=await tmp('gb-bytes-'),ws=path.join(d,'w');await fsp.mkdir(ws);const three=Buffer.alloc(3*1024*1024,0x61),two=Buffer.alloc(2*1024*1024,0x62);
  for(let i=0;i<26;i++)await fsp.writeFile(path.join(ws,`f${String(i).padStart(2,'0')}.txt`),three);await fsp.writeFile(path.join(ws,'f26.txt'),two);
  const exact=await buildSnapshot(ws,path.join(d,'snap-exact'));assert.equal(exact.manifest.stats.bytes,80*1024*1024);
  await fsp.writeFile(path.join(ws,'extra-one-byte.txt'),'x');await assert.rejects(()=>buildSnapshot(ws,path.join(d,'snap-over')),/WORKSPACE_SNAPSHOT_TOO_LARGE/);
});
