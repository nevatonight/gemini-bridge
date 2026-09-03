import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import crypto from 'node:crypto';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BridgeCore } from '../src/core.mjs';
import { Store } from '../src/store.mjs';
import { offlineStateCheck } from '../src/offline-check.mjs';
import { ensureRuntimeConfig } from '../src/runtime-config.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),FAKE=path.join(ROOT,'tests','fake-gemini.mjs');
async function tmp(prefix='gb-pf-'){return await fsp.mkdtemp(path.join(os.tmpdir(),prefix));}
async function wait(core,id,timeout=8000){const end=Date.now()+timeout;while(Date.now()<end){const r=core.getRun(id);if(['COMPLETED','FAILED','CANCELLED','WAITING_APPLY','RECOVERY_REQUIRED'].includes(r.status))return r;await new Promise(r=>setTimeout(r,15));}throw new Error('timeout');}
async function httpReq(cfg,method,url,body=null){return await new Promise((resolve,reject)=>{const data=body===null?null:Buffer.from(JSON.stringify(body)),req=http.request({host:'127.0.0.1',port:cfg.port,path:url,method,headers:{'Host':`127.0.0.1:${cfg.port}`,'X-Gemini-Bridge-Token':cfg.token,...(data?{'Content-Type':'application/json','Content-Length':data.length}:{})}},res=>{const cs=[];res.on('data',c=>cs.push(c));res.on('end',()=>{let j={};try{j=JSON.parse(Buffer.concat(cs).toString())}catch{};resolve({status:res.statusCode,body:j});});});req.on('error',reject);if(data)req.write(data);req.end();});}
async function startHost(){const d=await tmp(),state=path.join(d,'state');const cfg=await ensureRuntimeConfig(state);const p=spawn(process.execPath,[path.join(ROOT,'src','host.mjs')],{env:{...process.env,GEMINI_BRIDGE_STATE:state,GEMINI_BRIDGE_GEMINI_ENTRY:FAKE},stdio:['ignore','pipe','pipe']});for(let i=0;i<120;i++){try{const h=await httpReq(cfg,'GET','/v1/health');if(h.status===200)return {d,state,cfg,p};}catch{}await new Promise(r=>setTimeout(r,25));}p.kill('SIGKILL');throw new Error('host startup timeout');}

 test('Phase F: maintenance blocks new runs only after idempotency lookup and readiness becomes true after work drains',async()=>{
  const d=await tmp(),state=path.join(d,'state'),core=await new BridgeCore({stateRoot:state,geminiEntry:FAKE}).init(),p=core.createProject('P');const o=await core.startRun({projectId:p.id,mode:'ask',prompt:'TEST_SLEEP 450',requestId:'maint-existing'});let r=core.setMaintenance(true);assert.equal(r.ok,false);assert.ok(r.unfinished.length>=1);
  const retry=await core.startRun({projectId:p.id,mode:'ask',prompt:'TEST_SLEEP 450',requestId:'maint-existing'});assert.equal(retry.reused,true);assert.equal(retry.run.id,o.run.id);await assert.rejects(()=>core.startRun({projectId:p.id,mode:'ask',prompt:'new',requestId:'maint-new'}),/HOST_MAINTENANCE/);await wait(core,o.run.id);r=core.upgradeReadiness();assert.equal(r.ok,true);assert.equal(r.unfinished.length,0);
});

test('Phase F: offline state check is read-only, refuses unfinished work, and does not create a missing DB',async()=>{
  const d=await tmp(),state=path.join(d,'state');await fsp.mkdir(state);const missing=await offlineStateCheck(state);assert.deepEqual(missing,{ok:true,exists:false,unfinished:0});assert.equal(fs.existsSync(path.join(state,'bridge.sqlite')),false);
  const store=await new Store(state).init(),p=store.createProject('P'),th=store.createThread(p.id,'T'),id=crypto.randomUUID();store.createRun({id,requestId:'unfinished',requestFingerprint:'fp',projectId:p.id,threadId:th.id,mode:'ask',status:'QUEUED',prompt:'x',contextRevision:p.current_context_revision});store.db.close();const dbFile=path.join(state,'bridge.sqlite'),before=await fsp.readFile(dbFile);const no=await offlineStateCheck(state);const after=await fsp.readFile(dbFile);assert.equal(no.ok,false);assert.equal(no.error,'UNFINISHED_WORK');assert.deepEqual(after,before);
  const store2=await new Store(state).init();store2.transitionRun(id,'QUEUED','CANCELLED',{error:'test'});store2.db.close();const yes=await offlineStateCheck(state);assert.equal(yes.ok,true);assert.equal(yes.unfinished,0);
});

test('Phase F: offline check fails closed on corrupt SQLite instead of repairing or replacing it',async()=>{const d=await tmp(),state=path.join(d,'state');await fsp.mkdir(state);const file=path.join(state,'bridge.sqlite');await fsp.writeFile(file,'not sqlite');const before=await fsp.readFile(file);const out=await offlineStateCheck(state);assert.equal(out.ok,false);assert.match(out.error,/STATE_READ_FAILED|SQLITE_QUICK_CHECK_FAILED/);assert.deepEqual(await fsp.readFile(file),before);});

test('Phase F: authenticated Host maintenance/readiness endpoint blocks new work and shutdown stays available',async()=>{const h=await startHost();const cp=await httpReq(h.cfg,'POST','/v1/projects',{name:'P'});assert.equal(cp.status,201);const m=await httpReq(h.cfg,'POST','/v1/maintenance',{enabled:true});assert.equal(m.status,200);assert.equal(m.body.maintenance,true);assert.equal(m.body.ok,true);const run=await httpReq(h.cfg,'POST','/v1/runs',{projectId:cp.body.project.id,mode:'ask',prompt:'x',requestId:crypto.randomUUID()});assert.equal(run.status,503);assert.match(run.body.error,/HOST_MAINTENANCE/);const ready=await httpReq(h.cfg,'GET','/v1/upgrade-readiness');assert.equal(ready.body.ok,true);const stop=await httpReq(h.cfg,'POST','/v1/shutdown',{});assert.equal(stop.status,200);await new Promise(r=>h.p.once('exit',r));});

test('Phase F: Google auth reuses current Ask policy and sanitized Bridge environment instead of inheriting PowerShell environment wholesale',async()=>{
  const auth=await fsp.readFile(path.join(ROOT,'src','auth.mjs'),'utf8'),runner=await fsp.readFile(path.join(ROOT,'src','gemini.mjs'),'utf8'),ps=await fsp.readFile(path.join(ROOT,'Auth-GeminiBridge.ps1'),'utf8');assert.match(auth,/settings\('ask'\)/);assert.match(auth,/bridgeEnv\(process\.env/);assert.match(auth,/shell:false/);assert.match(auth,/auth-empty/);assert.match(runner,/const keep=\['PATH'[\s\S]*'NO_PROXY'\]/);assert.doesNotMatch(ps,/\$env:GEMINI_CLI_HOME|\$env:GEMINI_CLI_SYSTEM_SETTINGS_PATH/);
});

test('Phase F: Setup upgrade order is manifest -> maintenance -> shutdown -> offline check -> backup -> stage -> runtime -> strict health -> commit',async()=>{
  const s=await fsp.readFile(path.join(ROOT,'Setup.ps1'),'utf8'),main=s.slice(s.indexOf('$oldCfg=$null'));const marks=['Verify-ReleaseManifest $Source','Enter-MaintenanceIfRunning','Stop-AuthenticatedHost','Invoke-OfflineStateCheck','Backup-State','Stage-Release','Ensure-Gemini','Verify-NewHost','Commit-Release','Finalize-Release'];let prev=-1;for(const m of marks){const i=main.indexOf(m);assert.ok(i>prev,`${m} order`);prev=i;}assert.match(s,/if\(-not \$script:Committed\)\{try\{Rollback-Release/);assert.match(s,/Upgrade was already committed; cleanup\/retention failure did not roll back/);
});

test('Phase F: release manifest verification is exhaustive and staging copies hidden files with unique nonce directories',async()=>{
  const s=await fsp.readFile(path.join(ROOT,'Setup.ps1'),'utf8');assert.match(s,/Get-FileHash -Algorithm SHA256/);assert.match(s,/Unlisted release file/);assert.match(s,/Release manifest is not exhaustive/);assert.match(s,/Get-ChildItem -LiteralPath \$Source -Force/);assert.match(s,/\.staging-'\+\$nonce/);assert.doesNotMatch(s,/\$InstallRoot\+'\.new'/);
});

test('Phase F: Gemini CLI is exact-pinned, app-local, version-probed, and new repair installs use unique sibling directories',async()=>{
  const s=await fsp.readFile(path.join(ROOT,'Setup.ps1'),'utf8');assert.match(s,/\$GeminiVersion='0\.55\.1'/);assert.match(s,/@google\/gemini-cli@\{0\}/);const probe=await fsp.readFile(path.join(ROOT,'src','managed-gemini-probe.mjs'),'utf8');assert.match(probe,/--version/);assert.match(s,/gemini-'\+\$GeminiVersion\+'-'\+\[guid\]::NewGuid/);assert.doesNotMatch(s,/npm\s+install\s+-g|Find-GeminiEntry/);
});

test('Phase F: rollback restores state even without an old program directory and restores mutable extension/runtime references',async()=>{
  const s=await fsp.readFile(path.join(ROOT,'Setup.ps1'),'utf8');const rb=s.slice(s.indexOf('function Rollback-Release'),s.indexOf('function Commit-Release'));assert.match(rb,/Restore-Program;Restore-State;Restore-Extension/);assert.match(s,/Remove-Item -LiteralPath \$dst[\s\S]*Copy-Item -LiteralPath \(Join-Path \$script:StateBackupDir \$n\)/);assert.match(s,/\$script:NewRuntimeDir/);
});

test('Phase F: pairing token is kept out of immutable install tree and Desktop artifacts',async()=>{
  const s=await fsp.readFile(path.join(ROOT,'Setup.ps1'),'utf8'),launcher=await fsp.readFile(path.join(ROOT,'Launch-Dashboard.ps1'),'utf8');assert.match(s,/\$MutableExtension=Join-Path \$BaseRoot 'web-extension'/);assert.match(s,/Install-MutableExtension/);assert.doesNotMatch(s,/Join-Path \$InstallRoot 'web-extension\\config\.js'/);assert.match(s,/Gemini Bridge\.lnk'\) \(Join-Path \$InstallRoot 'Launch-Dashboard\.cmd'/);assert.doesNotMatch(s,/Set-Content \(Join-Path \$Desktop 'Gemini Bridge\.url'/);assert.match(launcher,/#token=\{1\}/);
});

test('Phase F: Setup and Uninstall share one Windows named mutex and abandoned ownership is recoverable',async()=>{for(const rel of ['Setup.ps1','Uninstall.ps1']){const s=await fsp.readFile(path.join(ROOT,rel),'utf8');assert.match(s,/Local\\GeminiBridge\.SetupUninstall/);assert.match(s,/AbandonedMutexException/);assert.match(s,/ReleaseMutex/);}});

test('Phase F: Uninstall enters maintenance, proves authenticated Host stopped, then verifies program folder is physically gone',async()=>{
  const s=await fsp.readFile(path.join(ROOT,'Uninstall.ps1'),'utf8'),main=s.slice(s.indexOf('$cfg=$null'));const a=main.indexOf('Enter-UninstallMaintenance'),b=main.indexOf('Stop-And-Prove'),c=main.indexOf('Remove-Item -LiteralPath $Install -Recurse -Force'),d=main.indexOf('if(Test-Path $Install)',c+1);assert.ok(a>=0&&b>a&&c>b&&d>c);assert.match(s,/Authenticated Host still responds after shutdown/);assert.match(s,/Lock-MatchesLiveHost/);assert.match(s,/UNINSTALL ABORTED/);
});

test('Phase F: dashboard and extension do not render phantom YOU messages when run creation fails',async()=>{
  const ui=await fsp.readFile(path.join(ROOT,'ui','app.js'),'utf8'),ext=await fsp.readFile(path.join(ROOT,'web-extension','content.js'),'utf8');const us=ui.slice(ui.indexOf('async function submitPrompt'),ui.indexOf('send.onclick=')),es=ext.slice(ext.indexOf('async function doSend'),ext.indexOf('fab.onclick='));assert.ok(us.indexOf("api('/v1/runs'")>=0&&us.indexOf("api('/v1/runs'")<us.indexOf("add(t('you')"));assert.ok(es.indexOf("api('/v1/runs'")>=0&&es.indexOf("api('/v1/runs'")<es.indexOf("addMsg(t('you')"));
});

test('Phase F: client recovery actions mirror Core discardable states and clipboard denial has visible manual fallback',async()=>{
  const ui=await fsp.readFile(path.join(ROOT,'ui','app.js'),'utf8'),ext=await fsp.readFile(path.join(ROOT,'web-extension','content.js'),'utf8');for(const x of [ui,ext]){assert.match(x,/\['WAITING_APPLY','RECOVERY_REQUIRED','APPLY_CONFLICT'\]\.includes\(x\.status\)/);assert.match(x,/Clipboard access was blocked/);assert.match(x,/window\.prompt/);}assert.match(ext,/location\.pathname\+location\.search/);assert.match(ext,/route!==routeKey\(\)/);
});

test('Phase F: unpacked extension returns explicit repair/reload diagnostics on pairing rotation',async()=>{const bg=await fsp.readFile(path.join(ROOT,'web-extension','background.js'),'utf8');assert.match(bg,/PAIRING_REQUIRED/);assert.match(bg,/Setup\/Repair/);assert.match(bg,/Reload this unpacked extension/);});

test('Phase F: 0.4.7 version metadata is consistent across Core/package/docs/extension',async()=>{const pkg=JSON.parse(await fsp.readFile(path.join(ROOT,'package.json'),'utf8')),man=JSON.parse(await fsp.readFile(path.join(ROOT,'web-extension','manifest.json'),'utf8')),utils=await fsp.readFile(path.join(ROOT,'src','utils.mjs'),'utf8'),readme=await fsp.readFile(path.join(ROOT,'README.md'),'utf8');assert.equal(pkg.version,'0.4.7');assert.equal(man.version,'0.4.7');assert.match(utils,/APP_VERSION = '0\.4\.7'/);assert.match(readme,/Gemini Bridge 0\.4\.7/);});


test('Phase F: failed first install rollback removes newly staged program/extension and known staging artifacts',async()=>{
  const s=await fsp.readFile(path.join(ROOT,'Setup.ps1'),'utf8');assert.match(s,/\$script:HadProgramBefore=Test-Path \$InstallRoot/);assert.match(s,/elseif\(-not \$script:HadProgramBefore[\s\S]*Remove-Item -LiteralPath \$InstallRoot/);assert.match(s,/\$script:HadExtensionBefore=Test-Path \$MutableExtension/);assert.match(s,/elseif\(-not \$script:HadExtensionBefore[\s\S]*Remove-Item -LiteralPath \$MutableExtension/);assert.match(s,/\$script:ProgramStageDir/);assert.match(s,/\$script:ExtensionStageDir/);
});

test('Phase F: Setup fails closed on live or ambiguous Host lock when authenticated API is unavailable',async()=>{
  const s=await fsp.readFile(path.join(ROOT,'Setup.ps1'),'utf8'),main=s.slice(s.indexOf('$oldCfg=$null'));const a=main.indexOf('Enter-MaintenanceIfRunning'),b=main.indexOf('Lock-MatchesOrAmbiguousLiveHost'),c=main.indexOf('Stop-AuthenticatedHost'),d=main.indexOf('Invoke-OfflineStateCheck');assert.ok(a>=0&&b>a&&c>b&&d>c);assert.match(s,/processIdentity/);assert.ok(s.includes("$identity -match '^win32:(\\d+)$'"));assert.match(s,/legacy\/unknown identity is ambiguous/);assert.match(s,/Setup will not modify program\/state under an unverified live Host/);
});

test('Phase F: persistent shortcuts are ancillary and mutate only after strict new-Host health plus core commit',async()=>{
  const s=await fsp.readFile(path.join(ROOT,'Setup.ps1'),'utf8'),main=s.slice(s.indexOf('$oldCfg=$null'));const start=s.slice(s.indexOf('function Start-BridgeHost'),s.indexOf('function Verify-NewHost'));assert.doesNotMatch(start,/Shortcut \(/);const health=main.indexOf('Verify-NewHost'),commit=main.indexOf('Commit-Release'),shortcuts=main.indexOf('Install-Shortcuts');assert.ok(health>=0&&commit>health&&shortcuts>commit);assert.match(main,/try\{Install-Shortcuts\}catch\{Warn/);
});

test('Phase F: runtime config metadata mutation uses explicit PowerShell Add-Member property arguments',async()=>{
  const s=await fsp.readFile(path.join(ROOT,'Setup.ps1'),'utf8');for(const n of ['nodePath','geminiEntry','geminiVersion','programVersion'])assert.ok(s.includes(`Add-Member -InputObject $cfg -NotePropertyName ${n} -NotePropertyValue`));
});

test('Phase F: runtime retention keeps current managed Gemini runtime plus at most one previous sibling',async()=>{
  const s=await fsp.readFile(path.join(ROOT,'Setup.ps1'),'utf8'),r=s.slice(s.indexOf('function Invoke-Retention'),s.indexOf('$oldCfg=$null'));assert.match(r,/\$currentDir/);assert.match(r,/\$keep.Count -ge 2/);assert.match(r,/if\(\$keep -notcontains \$d.FullName\)\{Remove-Item/);
});


test('Phase F: rollback restarts the prior Host only when Setup actually stopped it',async()=>{
  const s=await fsp.readFile(path.join(ROOT,'Setup.ps1'),'utf8'),stop=s.slice(s.indexOf('function Stop-AuthenticatedHost'),s.indexOf('function Invoke-OfflineStateCheck')),rb=s.slice(s.indexOf('function Rollback-Release'),s.indexOf('function Commit-Release'));assert.match(stop,/RestartOldHostOnRollback=\$true/);assert.match(rb,/if\(\$script:RestartOldHostOnRollback\)/);assert.doesNotMatch(rb,/Restore-Extension;if\(\$script:NewRuntimeDir\)[\s\S]*;\$restored=Read-RuntimeSafe/);
});

test('Phase F: Uninstall proves state/ownership before deletion and proves mutable token copy is removed',async()=>{
  const s=await fsp.readFile(path.join(ROOT,'Uninstall.ps1'),'utf8'),main=s.slice(s.indexOf('$cfg=$null'));const gate=main.indexOf('if(Test-Path $Install){'),stateGuard=main.indexOf("if(-not (Test-Path $State))"),dbGuard=main.indexOf("Join-Path $State 'bridge.sqlite'"),ext=main.indexOf('Remove-Item -LiteralPath $MutableExtension -Recurse -Force'),program=main.indexOf('Remove-Item -LiteralPath $Install -Recurse -Force');assert.ok(gate>=0&&stateGuard>gate&&dbGuard>stateGuard&&ext>dbGuard&&program>ext);assert.match(s,/unfinished work and Host ownership cannot be verified/);assert.match(s,/if\(Test-Path \$MutableExtension\)\{Fail 'Mutable browser-extension folder still exists/);
});

test('Phase F: clients never instruct the user to kill a process based only on a recovery PID',async()=>{
  for(const rel of [path.join('ui','app.js'),path.join('web-extension','content.js')]){const s=await fsp.readFile(path.join(ROOT,rel),'utf8');assert.doesNotMatch(s,/End it in Task Manager/);assert.match(s,/do not terminate a process based on PID alone/);}
});
