import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ensureRuntimeConfig} from '../src/runtime-config.mjs';
import {readJson} from '../src/utils.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const HOST=path.join(ROOT,'src','host.mjs');
const FAKE=path.join(ROOT,'tests','fake-gemini.mjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function tmp(prefix='gb-po-'){return await fsp.mkdtemp(path.join(os.tmpdir(),prefix));}
async function req(cfg,p='/v1/health'){
  return await new Promise((resolve,reject)=>{const r=http.request({host:'127.0.0.1',port:cfg.port,path:p,method:'GET',headers:{'X-Gemini-Bridge-Token':cfg.token},timeout:1500},res=>{const cs=[];res.on('data',c=>cs.push(c));res.on('end',()=>{let body=null;try{body=JSON.parse(Buffer.concat(cs).toString())}catch{};resolve({status:res.statusCode,body});});});r.once('timeout',()=>r.destroy(new Error('timeout')));r.once('error',reject);r.end();});
}
async function waitHealth(cfg,p,ms=5000){const end=Date.now()+ms;while(Date.now()<end&&p.exitCode===null){try{const r=await req(cfg);if(r.status===200&&r.body?.ok)return r.body;}catch{}await sleep(25);}return null;}
async function waitExit(p,ms=3000){if(p.exitCode!==null)return p.exitCode;return await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('exit timeout')),ms);p.once('exit',c=>{clearTimeout(t);resolve(c);});});}
async function kill(p){if(!p||p.exitCode!==null)return;try{p.kill('SIGTERM');}catch{};try{await waitExit(p,800);}catch{try{p.kill('SIGKILL');}catch{};await waitExit(p,800).catch(()=>{});}}

// Candidate identity is the proof that Setup is talking to the Host it just launched.
test('Phase O: health exposes exact Host instance, PID/process identity and Setup launch nonce',async()=>{
  const d=await tmp(),state=path.join(d,'state'),cfg=await ensureRuntimeConfig(state);cfg.geminiEntry=FAKE;cfg.geminiVersion='0.55.1';await fsp.writeFile(path.join(state,'runtime.json'),JSON.stringify(cfg));
  const nonce='a'.repeat(32);const p=spawn(process.execPath,[HOST],{env:{...process.env,GEMINI_BRIDGE_STATE:state,GEMINI_BRIDGE_LAUNCH_NONCE:nonce},stdio:'ignore'});
  try{const h=await waitHealth(cfg,p);assert.ok(h);assert.equal(h.version,'0.4.7');assert.match(h.host?.instanceId||'',/^[a-f0-9]{32}$/);assert.equal(h.host?.pid,p.pid);assert.match(h.host?.processIdentity||'',/^[a-z0-9_-]+:.+/i);assert.equal(h.host?.launchNonce,nonce);const lock=await readJson(path.join(state,'host.lock.json'),null);assert.equal(lock.instanceId,h.host.instanceId);assert.equal(lock.pid,h.host.pid);assert.equal(lock.processIdentity,h.host.processIdentity);assert.equal(lock.launchNonce,nonce);}finally{try{const c=await req(cfg,'/v1/health');if(c.status===200){await new Promise((resolve)=>{const r=http.request({host:'127.0.0.1',port:cfg.port,path:'/v1/shutdown',method:'POST',headers:{'X-Gemini-Bridge-Token':cfg.token,'Content-Type':'application/json','Content-Length':'2'}},res=>{res.resume();res.on('end',resolve)});r.on('error',resolve);r.end('{}');});}}catch{}await kill(p);}
});

test('Phase O: malformed externally supplied launch nonce fails closed before Host becomes ready',async()=>{
  const d=await tmp(),state=path.join(d,'state'),cfg=await ensureRuntimeConfig(state);cfg.geminiEntry=FAKE;cfg.geminiVersion='0.55.1';await fsp.writeFile(path.join(state,'runtime.json'),JSON.stringify(cfg));
  const p=spawn(process.execPath,[HOST],{env:{...process.env,GEMINI_BRIDGE_STATE:state,GEMINI_BRIDGE_LAUNCH_NONCE:'bad nonce'},stdio:'ignore'});
  try{assert.equal(await waitExit(p,1800),2);const e=await readJson(path.join(state,'host-startup-error.json'),null);assert.match(e?.error||'',/HOST_LAUNCH_NONCE_INVALID/);}finally{await kill(p);}
});

test('Phase O: Setup Node policy accepts only Node 22.13+ within 22.x and Node 24.x',async()=>{
  const pkg=JSON.parse(await fsp.readFile(path.join(ROOT,'package.json'),'utf8'));const setup=await fsp.readFile(path.join(ROOT,'Setup.ps1'),'utf8');
  assert.equal(pkg.engines.node,'>=22.13.0 <23 || >=24 <25');
  assert.match(setup,/major[^\r\n]*-eq 22[\s\S]{0,250}minor[^\r\n]*-ge 13/i);assert.match(setup,/major[^\r\n]*-eq 24/i);assert.doesNotMatch(setup,/-gt 22/);
});

test('Phase O: Setup generates a UTF-8-BOM PowerShell hidden launcher instead of ASCII VBS',async()=>{
  const s=await fsp.readFile(path.join(ROOT,'Setup.ps1'),'utf8');assert.match(s,/Start-Host-Hidden\.ps1/);assert.match(s,/UTF8Encoding\(\$true\)/);assert.match(s,/ProcessStartInfo/);assert.match(s,/UseShellExecute\s*=\s*`?\$false/);assert.match(s,/CreateNoWindow\s*=\s*`?\$true/);assert.doesNotMatch(s,/Start-Host-Hidden\.vbs[\s\S]{0,300}wscript\.exe/i);
});

test('Phase O: Setup candidate gate verifies program version, instance, nonce, PID and process identity before commit',async()=>{
  const s=await fsp.readFile(path.join(ROOT,'Setup.ps1'),'utf8');assert.match(s,/CandidateLaunchNonce/);assert.match(s,/\$h\.version[\s\S]{0,200}\$Version/);assert.match(s,/\$h\.host\.instanceId/);assert.match(s,/\$h\.host\.launchNonce/);assert.match(s,/\$h\.host\.pid/);assert.match(s,/\$h\.host\.processIdentity/);const verify=s.indexOf('Verify-NewHost');const commit=s.lastIndexOf('Commit-Release');assert.ok(verify>=0&&commit>verify);
});

test('Phase O: Setup shutdown and rollback require exact process-exit proof and fail closed on ambiguous live candidate',async()=>{
  const s=await fsp.readFile(path.join(ROOT,'Setup.ps1'),'utf8');assert.match(s,/Wait-ExactProcessExit/);assert.match(s,/processIdentity/);assert.match(s,/ROLLBACK_CANDIDATE_OWNERSHIP_AMBIGUOUS|candidate[^\r\n]*ambiguous/i);assert.match(s,/Rollback-Release/);
});

test('Phase O: credential presence is a file-level check, not gemini-home directory existence',async()=>{
  const mod=await import('../src/auth-state.mjs');const d=await tmp(),state=path.join(d,'state');await fsp.mkdir(path.join(state,'gemini-home','.gemini'),{recursive:true});assert.equal(await mod.hasGeminiCredentials(state),false);await fsp.writeFile(path.join(state,'gemini-home','.gemini','settings.json'),'{}');assert.equal(await mod.hasGeminiCredentials(state),false);await fsp.writeFile(path.join(state,'gemini-home','.gemini','oauth_creds.json'),JSON.stringify({access_token:'expired-is-still-presence',expiry_date:1}));assert.equal(await mod.hasGeminiCredentials(state),true);
});

test('Phase O: Setup shows six high-level stages and gates Dashboard on post-auth credential presence',async()=>{
  const s=await fsp.readFile(path.join(ROOT,'Setup.ps1'),'utf8');for(let i=1;i<=6;i++)assert.match(s,new RegExp(`Stage\\s+${i}\\b`));assert.match(s,/auth-status/);assert.doesNotMatch(s,/Test-Path \(Join-Path \$StateRoot 'gemini-home'\)/);assert.match(s,/Authentication[^\r\n]*(incomplete|cancelled)|sign-in[^\r\n]*(incomplete|cancelled)/i);assert.match(s,/Launch-Dashboard[^\r\n]*credentials|credentials[\s\S]{0,300}Launch-Dashboard/i);
});

test('Phase O: Auth wrapper verifies local credential presence after interactive Gemini returns',async()=>{
  const s=await fsp.readFile(path.join(ROOT,'Auth-GeminiBridge.ps1'),'utf8');assert.match(s,/auth-status/);assert.match(s,/oauth|credential/i);assert.match(s,/GEMINI_BRIDGE_STATE/);
});

test('Phase O: Dashboard launcher starts Host when absent and rejects stale/wrong release before opening UI',async()=>{
  const s=await fsp.readFile(path.join(ROOT,'Launch-Dashboard.ps1'),'utf8');assert.match(s,/Start-Host-Hidden\.ps1/);assert.match(s,/\/v1\/health/);assert.match(s,/programVersion/);assert.match(s,/processIdentity/);assert.match(s,/Setup\/Repair/);const verify=Math.max(s.indexOf('/v1/health'),s.indexOf('programVersion'));const open=s.indexOf('Start-Process');assert.ok(verify>=0&&open>verify);
});

test('Phase O: Uninstall uses PowerShell launcher and exact process identity rather than startedAt tolerance',async()=>{
  const s=await fsp.readFile(path.join(ROOT,'Uninstall.ps1'),'utf8');assert.match(s,/Start-Host-Hidden\.ps1/);assert.match(s,/processIdentity/);assert.match(s,/Wait-ExactProcessExit/);assert.doesNotMatch(s,/TotalSeconds\) -le 30/);assert.doesNotMatch(s,/wscript\.exe/);
});
