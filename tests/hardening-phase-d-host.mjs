import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {ensureRuntimeConfig} from '../src/runtime-config.mjs';
import {readJson} from '../src/utils.mjs';
import {GeminiRunner} from '../src/gemini.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const HOST=path.join(ROOT,'src','host.mjs');
const FAKE=path.join(ROOT,'tests','fake-gemini.mjs');
const RUNTIME_URL=pathToFileURL(path.join(ROOT,'src','runtime-config.mjs')).href;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function tmp(prefix='gb-d-host-'){return await fsp.mkdtemp(path.join(os.tmpdir(),prefix));}
function alive(pid){if(!pid)return false;try{process.kill(pid,0);return true;}catch{return false;}}
async function waitExit(p,ms=7000){
  if(p.exitCode!==null)return p.exitCode;
  return await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error(`child ${p.pid} exit timeout`)),ms);p.once('exit',c=>{clearTimeout(t);resolve(c);});});
}
async function killChild(p){if(!p||p.exitCode!==null)return;try{p.kill('SIGTERM');}catch{};try{await waitExit(p,1200);}catch{try{p.kill('SIGKILL');}catch{};await waitExit(p,1200).catch(()=>{});}}
function spawnHost(state,entry=FAKE,stdio='ignore'){
  return spawn(process.execPath,[HOST],{env:{...process.env,GEMINI_BRIDGE_STATE:state,GEMINI_BRIDGE_GEMINI_ENTRY:entry},stdio});
}
async function req(cfg,method,url,body=null,{token=cfg.token,headers={}}={}){
  return await new Promise((resolve,reject)=>{
    const data=body===null?null:Buffer.from(typeof body==='string'?body:JSON.stringify(body));
    const h={...headers};if(token!==null)h['X-Gemini-Bridge-Token']=token;if(data){h['Content-Type']='application/json';h['Content-Length']=data.length;}
    const r=http.request({host:'127.0.0.1',port:cfg.port,path:url,method,headers:h,timeout:3000},res=>{const cs=[];res.on('data',c=>cs.push(c));res.on('end',()=>{const text=Buffer.concat(cs).toString();let parsed=null;try{parsed=JSON.parse(text);}catch{}resolve({status:res.statusCode,text,body:parsed,headers:res.headers});});});
    r.once('timeout',()=>r.destroy(new Error('http timeout')));r.once('error',reject);if(data)r.end(data);else r.end();
  });
}
async function waitReady(state,children=[],ms=8000){
  const end=Date.now()+ms;let cfg=null,last='';
  while(Date.now()<end){
    cfg=await readJson(path.join(state,'runtime.json'),null);
    if(cfg){try{const h=await req(cfg,'GET','/v1/health');if(h.status===200&&h.body?.ok)return cfg;last=`HTTP ${h.status}`;}catch(e){last=e.message;}}
    if(children.length&&children.every(p=>p.exitCode!==null))break;await sleep(25);
  }
  throw new Error(`Host never ready: ${last}; exits=${children.map(p=>p.exitCode).join(',')}`);
}
async function stopHost(cfg,p){try{await req(cfg,'POST','/v1/shutdown',{});}catch{};await waitExit(p,3000).catch(()=>killChild(p));}
async function spawnCapture(args,{env=process.env,timeout=8000}={}){
  const p=spawn(process.execPath,args,{env,stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);
  let code;try{code=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error(`child ${p.pid} close timeout`)),timeout);p.once('close',c=>{clearTimeout(t);resolve(c);});});}catch(e){await killChild(p);throw e;}return {code,out,err};
}

test('Phase D Host: concurrent first runtime initialization publishes exactly one token and port',{timeout:30000},async()=>{
  const d=await tmp('gb-runtime-race-'),state=path.join(d,'state');await fsp.mkdir(state,{recursive:true});
  const code=`import {ensureRuntimeConfig} from ${JSON.stringify(RUNTIME_URL)}; const c=await ensureRuntimeConfig(process.argv[1]); console.log(JSON.stringify(c));`;
  const jobs=Array.from({length:24},()=>spawnCapture(['--input-type=module','-e',code,state],{timeout:12000}));
  const rs=await Promise.all(jobs);assert.ok(rs.every(r=>r.code===0),rs.map(r=>r.err).join('\n'));
  const configs=rs.map(r=>JSON.parse(r.out.trim()));assert.equal(new Set(configs.map(c=>c.token)).size,1);assert.equal(new Set(configs.map(c=>c.port)).size,1);
  assert.deepEqual(await readJson(path.join(state,'runtime.json'),null),configs[0]);assert.equal(fs.existsSync(path.join(state,'runtime.init.lock')),false);
});

test('Phase D Host: stale init lock is removed only after owner identity is unprovable',async()=>{
  const d=await tmp('gb-runtime-stale-'),state=path.join(d,'state');await fsp.mkdir(state,{recursive:true});const lock=path.join(state,'runtime.init.lock');
  await fsp.writeFile(lock,JSON.stringify({pid:99999999,processIdentity:'definitely-not-real',nonce:'old'}));const old=new Date(Date.now()-30000);await fsp.utimes(lock,old,old);
  const cfg=await ensureRuntimeConfig(state);assert.match(cfg.token,/^[a-f0-9]{64}$/);assert.equal(fs.existsSync(lock),false);
});

test('Phase D Host: losing port bind exits before SQLite/Core is opened',async()=>{
  const d=await tmp('gb-bind-first-'),state=path.join(d,'state');await fsp.mkdir(state,{recursive:true});const blocker=net.createServer();await new Promise((r,j)=>{blocker.once('error',j);blocker.listen(0,'127.0.0.1',r);});
  const port=blocker.address().port,token='a'.repeat(64);await fsp.writeFile(path.join(state,'runtime.json'),JSON.stringify({token,port}));const p=spawnHost(state);
  try{assert.equal(await waitExit(p,5000),2);assert.equal(fs.existsSync(path.join(state,'bridge.sqlite')),false);assert.equal(fs.existsSync(path.join(state,'host.lock.json')),false);}finally{await killChild(p);await new Promise(r=>blocker.close(r));}
});

test('Phase D Host: Host header and browser Origin are fail-closed while expected local origin works',async()=>{
  const d=await tmp(),state=path.join(d,'state');const p=spawnHost(state);let cfg;try{cfg=await waitReady(state,[p]);
    const badHost=await req(cfg,'GET','/ui/',null,{token:null,headers:{Host:'evil.example'}});assert.equal(badHost.status,403);
    const badOrigin=await req(cfg,'GET','/v1/health',null,{headers:{Origin:'https://evil.example'}});assert.equal(badOrigin.status,403);
    const local=await req(cfg,'GET','/v1/health',null,{headers:{Origin:`http://127.0.0.1:${cfg.port}`}});assert.equal(local.status,200);assert.equal(local.body.ok,true);
  }finally{if(cfg)await stopHost(cfg,p);else await killChild(p);}
});

test('Phase D Host: dashboard HTML contains no token and launcher transfers token only through URL fragment',async()=>{
  const d=await tmp(),state=path.join(d,'state');const p=spawnHost(state);let cfg;try{cfg=await waitReady(state,[p]);const page=await req(cfg,'GET','/ui/',null,{token:null});assert.equal(page.status,200);assert.doesNotMatch(page.text,new RegExp(cfg.token));assert.doesNotMatch(page.text,/__GB_TOKEN__|<meta[^>]+gb-token/i);
    const app=(await req(cfg,'GET','/ui/app.js',null,{token:null})).text;assert.match(app,/location\.hash/);assert.match(app,/sessionStorage\.setItem\('gb-token'/);assert.match(app,/history\.replaceState/);assert.doesNotMatch(app,/localStorage\.(?:setItem|getItem)\(['"]gb-token/);assert.match(app,/localStorage\.(?:setItem|getItem)\(['"]gb-lang/);
    const launcher=await fsp.readFile(path.join(ROOT,'Launch-Dashboard.ps1'),'utf8');assert.match(launcher,/runtime\.json/);assert.match(launcher,/#token=/);assert.doesNotMatch(launcher,/\.url/i);
  }finally{if(cfg)await stopHost(cfg,p);else await killChild(p);}
});

test('Phase D Host: malformed HTTP body types and unknown fields are rejected instead of coerced',async()=>{
  const d=await tmp(),state=path.join(d,'state');const p=spawnHost(state);let cfg;try{cfg=await waitReady(state,[p]);
    assert.equal((await req(cfg,'POST','/v1/projects',[])).status,400);assert.equal((await req(cfg,'POST','/v1/projects',{name:{x:1}})).status,400);assert.equal((await req(cfg,'POST','/v1/projects',{name:'ok',extra:true})).status,400);
    assert.equal((await req(cfg,'POST','/v1/runs',{projectId:{},mode:'ask',prompt:'x',requestId:'r'})).status,400);assert.equal((await req(cfg,'GET','/v1/threads/abc/turns?limit=0')).status,400);assert.equal((await req(cfg,'GET','/v1/threads/abc/turns?limit=501')).status,400);
  }finally{if(cfg)await stopHost(cfg,p);else await killChild(p);}
});

test('Phase D Host: one winning Host performs one runtime probe; repeated health polling performs none',{timeout:30000},async()=>{
  const d=await tmp('gb-probe-once-'),state=path.join(d,'state'),marker=path.join(d,'probes.txt'),wrapper=path.join(d,'probe.mjs');
  await fsp.writeFile(wrapper,`import fsp from 'node:fs/promises';\nif(process.argv.includes('--version')){await fsp.appendFile(${JSON.stringify(marker)},'probe\\n');console.log('0.55.1');process.exit(0);}\nprocess.exit(91);\n`);
  const ps=Array.from({length:20},()=>spawnHost(state,wrapper));let cfg;try{cfg=await waitReady(state,ps,12000);await sleep(800);const alivePs=ps.filter(p=>p.exitCode===null);assert.equal(alivePs.length,1);for(const p of ps.filter(x=>x.exitCode!==null))assert.equal(p.exitCode,2);
    for(let i=0;i<40;i++){const h=await req(cfg,'GET','/v1/health');assert.equal(h.status,200);assert.equal(h.body.ok,true);}const lines=(await fsp.readFile(marker,'utf8')).trim().split(/\r?\n/).filter(Boolean);assert.equal(lines.length,1);
    await stopHost(cfg,alivePs[0]);
  }finally{for(const p of ps)await killChild(p);}
});

test('Phase D Host: async version timeout does not block event loop and child is terminated',{timeout:10000},async()=>{
  const d=await tmp('gb-version-timeout-'),state=path.join(d,'state'),pidFile=path.join(d,'pid'),wrapper=path.join(d,'slow.mjs');await fsp.writeFile(wrapper,`import fsp from 'node:fs/promises';await fsp.writeFile(${JSON.stringify(pidFile)},String(process.pid));if(process.argv.includes('--version'))await new Promise(r=>setTimeout(r,5000));\n`);
  const g=await new GeminiRunner({stateRoot:state,geminiEntry:wrapper}).init();let tick=false;setTimeout(()=>tick=true,30);const started=Date.now();await assert.rejects(()=>g.version({timeoutMs:300}),/GEMINI_VERSION_TIMEOUT/);const elapsed=Date.now()-started;assert.equal(tick,true);assert.ok(elapsed>=250&&elapsed<2000,`elapsed ${elapsed}`);
  const pid=Number(await fsp.readFile(pidFile,'utf8'));for(let i=0;i<20&&alive(pid);i++)await sleep(25);assert.equal(alive(pid),false);
});

test('Phase D Host: repeated dual-start stress leaves exactly one owner each round',{timeout:60000},async()=>{
  for(let round=0;round<20;round++){
    const d=await tmp(`gb-dual-${round}-`),state=path.join(d,'state'),a=spawnHost(state),b=spawnHost(state);let cfg;try{cfg=await waitReady(state,[a,b],8000);await sleep(150);const living=[a,b].filter(p=>p.exitCode===null),dead=[a,b].filter(p=>p.exitCode!==null);assert.equal(living.length,1,`round ${round}`);assert.equal(dead.length,1,`round ${round}`);assert.equal(dead[0].exitCode,2,`round ${round}`);await stopHost(cfg,living[0]);}finally{await killChild(a);await killChild(b);}
  }
});
