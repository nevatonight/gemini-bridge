import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {GeminiRunner} from '../src/gemini.mjs';
import {probeAntigravityEntry,compareSemver} from '../src/managed-antigravity-probe.mjs';
import {repairRuntimeConfig,ensureRuntimeConfig} from '../src/runtime-config.mjs';

const ROOT=path.resolve('.');
const text=rel=>fsp.readFile(path.join(ROOT,rel),'utf8');
const json=async rel=>JSON.parse(await text(rel));
async function tmp(){return fsp.mkdtemp(path.join(os.tmpdir(),'gb-top50-'));}
async function fakeAgy(dir){
  const file=path.join(dir,process.platform==='win32'?'agy-fake.cmd':'agy-fake');
  if(process.platform==='win32')throw new Error('fakeAgy helper is intended for POSIX CI');
  const source=`#!/usr/bin/env node
import fsp from 'node:fs/promises';import path from 'node:path';
const args=process.argv.slice(2);
if(args.includes('--version')){console.log('1.2.3');process.exit(0)}
if(args[0]==='models'){try{await fsp.access(process.argv[1]+'.unauth');console.error('authentication required');process.exit(7)}catch{}console.log('gemini-test');process.exit(0)}
let input='';for await(const c of process.stdin)input+=c;
await fsp.writeFile(path.join(process.cwd(),'.top50-log.json'),JSON.stringify({args,input,home:process.env.HOME,userprofile:process.env.USERPROFILE,autoUpdate:process.env.AGY_CLI_DISABLE_AUTO_UPDATE}));
console.log(JSON.stringify({event:'init',init:{model:'agy-test'}}));
console.log(JSON.stringify({event:'step_update',step_update:{text_delta:'partial'}}));
console.log(JSON.stringify({event:'result',result:{status:'SUCCESS',response:'final'}}));
`;
  await fsp.writeFile(file,source);await fsp.chmod(file,0o755);return file;
}

// Setup / upgrade / rollback: 1-18

test('Top50 #01 legacy runtime without provider cannot be dereferenced directly under StrictMode',async()=>{const s=await text('Setup.ps1');assert.match(s,/Get-OptionalProperty \$oldCfg 'provider'/);assert.doesNotMatch(s,/\$oldCfg\.provider/);});
test('Top50 #02 legacy runtime without geminiEntry cannot be dereferenced directly',async()=>{const s=await text('Setup.ps1');assert.match(s,/Get-OptionalProperty \$oldCfg 'geminiEntry'/);assert.doesNotMatch(s,/\$oldCfg\.geminiEntry/);});
test('Top50 #03 legacy runtime without geminiVersion cannot be dereferenced directly',async()=>{const s=await text('Setup.ps1');assert.match(s,/Get-OptionalProperty \$oldCfg 'geminiVersion'/);assert.doesNotMatch(s,/\$oldCfg\.geminiVersion/);});
test('Top50 #04 missing programVersion fails with controlled guard, not property-access crash',async()=>{const s=await text('Setup.ps1');assert.match(s,/Get-OptionalProperty \$cfg 'programVersion'/);assert.match(s,/programVersion is missing; refusing destructive upgrade/);});
test('Top50 #05 three-part historical version remains accepted',async()=>{const s=await text('Setup.ps1');assert.ok(s.includes("'^\\d+(?:\\.\\d+){2,3}$'"));});
test('Top50 #06 four-part current version remains accepted',async()=>{const s=await text('Setup.ps1');assert.ok(s.includes("'^\\d+(?:\\.\\d+){2,3}$'"));assert.match(s,/\[version\]\$value/);});
test('Top50 #07 downgrade protection is still active',async()=>{const s=await text('Setup.ps1');assert.match(s,/Refusing downgrade from Gemini Bridge/);assert.match(s,/\$installedVersion -gt \$targetVersion/);});
test('Top50 #08 upgrade still enters maintenance before offline mutation',async()=>{const s=await text('Setup.ps1');const a=s.indexOf('Enter-MaintenanceIfRunning'),b=s.lastIndexOf('Invoke-OfflineStateCheck');assert.ok(a>=0&&b>a);});
test('Top50 #09 unfinished work still blocks upgrade',async()=>{const s=await text('Setup.ps1');assert.match(s,/\/v1\/upgrade-readiness/);assert.match(s,/Upgrade blocked/);});
test('Top50 #10 live host ownership is proven before shutdown',async()=>{const s=await text('Setup.ps1');assert.match(s,/Get-AuthenticatedHostOwner/);assert.match(s,/Wait-ExactProcessExit/);});
test('Top50 #11 ambiguous host lock remains fail-closed',async()=>{const s=await text('Setup.ps1');assert.match(s,/live or ambiguously identified Gemini Bridge Host process/);});
test('Top50 #12 legacy lock missing processIdentity no longer StrictMode-crashes and Setup never assigns PowerShell readonly $Host',async()=>{const s=await text('Setup.ps1');assert.match(s,/Get-OptionalProperty \$lock 'processIdentity'/);assert.doesNotMatch(s,/\$host\s*=/i);});
test('Top50 #13 state backup is performed before program staging',async()=>{const s=await text('Setup.ps1');const a=s.lastIndexOf('Backup-State'),b=s.lastIndexOf('Stage-Release');assert.ok(a>=0&&b>a);});
test('Top50 #14 failed setup restores program/state/extension/launcher',async()=>{const s=await text('Setup.ps1');for(const x of ['Restore-Program','Restore-State','Restore-Extension','Restore-Launcher'])assert.match(s,new RegExp(x));});
test('Top50 #15 rollback of legacy runtime missing nodePath no longer StrictMode-crashes',async()=>{const s=await text('Setup.ps1');assert.match(s,/Get-OptionalProperty \$restored 'nodePath'/);assert.doesNotMatch(s,/\$restored\.nodePath/);});
test('Top50 #16 first-install failure removes newly staged program',async()=>{const s=await text('Setup.ps1');assert.match(s,/elseif\(-not \$script:HadProgramBefore -and \(Test-Path \$InstallRoot\)\)/);});
test('Top50 #17 Setup and Uninstall share one mutex',async()=>{const [a,b]=await Promise.all([text('Setup.ps1'),text('Uninstall.ps1')]);assert.match(a,/Local\\GeminiBridge\.SetupUninstall/);assert.match(b,/Local\\GeminiBridge\.SetupUninstall/);});
test('Top50 #18 Uninstall legacy lock optional fields are guarded and PowerShell readonly $Host is untouched',async()=>{const s=await text('Uninstall.ps1');assert.match(s,/Get-OptionalProperty \$lock 'pid'/);assert.match(s,/Get-OptionalProperty \$lock 'processIdentity'/);assert.doesNotMatch(s,/\$host\s*=/i);});

// Managed Antigravity/runtime: 19-35

test('Top50 #19 both official Antigravity Windows installer URLs are pinned in Setup',async()=>{const s=await text('Setup.ps1');assert.match(s,/https:\/\/antigravity\.google\/cli\/install\.cmd/);assert.match(s,/https:\/\/antigravity\.google\/cli\/install\.ps1/);});
test('Top50 #20 installer customization flags are passed explicitly to both transports',async()=>{const s=await text('Setup.ps1');assert.match(s,/Invoke-CmdScriptLogged \$cmdFile @\('--skip-path','--skip-aliases'\)/);assert.match(s,/'-File',\$psFile,'--skip-path','--skip-aliases'/);});
test('Top50 #21 local Antigravity discovery includes official user-local path',async()=>{assert.match(await text('Setup.ps1'),/LOCALAPPDATA 'agy\\bin\\agy\.exe'/);});
test('Top50 #22 minimum Antigravity version gate remains present',async()=>{assert.match(await text('Setup.ps1'),/\$MinimumAntigravityVersion='1\.1\.20'/);assert.equal(compareSemver('1.1.20','1.1.20'),0);});
test('Top50 #23 too-old Antigravity is rejected by executable probe',async()=>{const d=await tmp();try{const e=await fakeAgy(d);await assert.rejects(()=>probeAntigravityEntry(e,{minimum:'2.0.0'}),x=>x.code==='ANTIGRAVITY_VERSION_TOO_OLD');}finally{await fsp.rm(d,{recursive:true,force:true});}});
test('Top50 #24 managed Antigravity copy is exact-version reprobed',async()=>{const s=await text('Setup.ps1');assert.match(s,/Invoke-AntigravityEntryProbe \$node \$entry \$sourceVersion/);});
test('Top50 #25 managed runtime entry must stay beneath RuntimeBase',async()=>{const s=await text('Setup.ps1');assert.match(s,/Require-SinglePath \$entryValue 'runtime\.json Antigravity entry' \$RuntimeBase/);});
test('Top50 #26 runtime provider is written as antigravity',async()=>{assert.match(await text('Setup.ps1'),/NotePropertyName provider -NotePropertyValue 'antigravity'/);});
test('Top50 #27 programVersion is atomically refreshed in runtime config',async()=>{assert.match(await text('Setup.ps1'),/NotePropertyName programVersion -NotePropertyValue \$Version/);});
test('Top50 #28 runtime config repair preserves valid token semantics',async()=>{const d=await tmp();try{const st=path.join(d,'state');await fsp.mkdir(st);const token='a'.repeat(64);await fsp.writeFile(path.join(st,'runtime.json'),JSON.stringify({token,port:38473}));const out=await repairRuntimeConfig(st);assert.equal(out.token,token);}finally{await fsp.rm(d,{recursive:true,force:true});}});
test('Top50 #29 runtime config rejects unknown providers',async()=>{const d=await tmp();try{const st=path.join(d,'state');await fsp.mkdir(st);await fsp.writeFile(path.join(st,'runtime.json'),JSON.stringify({token:'a'.repeat(64),port:38473,provider:'evil'}));await assert.rejects(()=>ensureRuntimeConfig(st),/RUNTIME_CONFIG_INVALID_PROVIDER/);}finally{await fsp.rm(d,{recursive:true,force:true});}});
test('Top50 #30 Antigravity self-update is disabled in child environment',async()=>{const s=await text('src/gemini.mjs');assert.match(s,/AGY_CLI_DISABLE_AUTO_UPDATE='true'/);});
test('Top50 #31 Ask mode uses default execution mode, not plan',async()=>{const d=await tmp();try{const e=await fakeAgy(d),cwd=path.join(d,'cwd');await fsp.mkdir(cwd);const r=await new GeminiRunner({stateRoot:path.join(d,'state'),geminiEntry:e}).init();await r.run({mode:'ask',cwd,payload:'hello'});const x=JSON.parse(await fsp.readFile(path.join(cwd,'.top50-log.json'),'utf8'));const i=x.args.indexOf('--mode');assert.ok(i>=0);assert.equal(x.args[i+1],'default');}finally{await fsp.rm(d,{recursive:true,force:true});}});
test('Top50 #32 Review mode stays plan/read-only',async()=>{const d=await tmp();try{const e=await fakeAgy(d),cwd=path.join(d,'cwd');await fsp.mkdir(cwd);const r=await new GeminiRunner({stateRoot:path.join(d,'state'),geminiEntry:e}).init();await r.run({mode:'review',cwd,payload:'hello'});const x=JSON.parse(await fsp.readFile(path.join(cwd,'.top50-log.json'),'utf8'));const i=x.args.indexOf('--mode');assert.equal(x.args[i+1],'plan');const settings=JSON.parse(await fsp.readFile(path.join(d,'state','antigravity-home','.gemini','antigravity-cli','settings.json'),'utf8'));assert.ok(settings.permissions.deny.includes('write_file(*)'));}finally{await fsp.rm(d,{recursive:true,force:true});}});
test('Top50 #33 Agent Edit stays accept-edits only inside snapshot',async()=>{const d=await tmp();try{const e=await fakeAgy(d),cwd=path.join(d,'cwd');await fsp.mkdir(cwd);const r=await new GeminiRunner({stateRoot:path.join(d,'state'),geminiEntry:e}).init();await r.run({mode:'edit',cwd,payload:'hello'});const x=JSON.parse(await fsp.readFile(path.join(cwd,'.top50-log.json'),'utf8'));const i=x.args.indexOf('--mode');assert.equal(x.args[i+1],'accept-edits');}finally{await fsp.rm(d,{recursive:true,force:true});}});
test('Top50 #34 Antigravity transport keeps stream-json input/output pair',async()=>{const s=await text('src/gemini.mjs');assert.match(s,/--input-format','stream-json','--output-format','stream-json'/);});
test('Top50 #35 stream-json user event shape remains canonical',async()=>{const s=await text('src/gemini.mjs');assert.match(s,/JSON\.stringify\(\{event:'user',message:\{content:String\(payload\)\}\}\)/);});

// Safety / auth / UI / release integrity: 36-50

test('Top50 #36 shell execution is explicitly denied',async()=>{const d=await tmp();try{const e=await fakeAgy(d),r=await new GeminiRunner({stateRoot:path.join(d,'state'),geminiEntry:e}).init();const j=JSON.parse(await fsp.readFile(await r.settings('edit'),'utf8'));assert.ok(j.permissions.deny.includes('command(*)'));}finally{await fsp.rm(d,{recursive:true,force:true});}});
test('Top50 #37 web read and execute are explicitly denied',async()=>{const d=await tmp();try{const e=await fakeAgy(d),r=await new GeminiRunner({stateRoot:path.join(d,'state'),geminiEntry:e}).init();const j=JSON.parse(await fsp.readFile(await r.settings('edit'),'utf8'));assert.ok(j.permissions.deny.includes('read_url(*)'));assert.ok(j.permissions.deny.includes('execute_url(*)'));}finally{await fsp.rm(d,{recursive:true,force:true});}});
test('Top50 #38 MCP and unsandboxed escape are explicitly denied',async()=>{const d=await tmp();try{const e=await fakeAgy(d),r=await new GeminiRunner({stateRoot:path.join(d,'state'),geminiEntry:e}).init();const j=JSON.parse(await fsp.readFile(await r.settings('edit'),'utf8'));assert.ok(j.permissions.deny.includes('mcp(*)'));assert.ok(j.permissions.deny.includes('unsandboxed(*)'));}finally{await fsp.rm(d,{recursive:true,force:true});}});
test('Top50 #39 non-workspace access remains disabled',async()=>{const d=await tmp();try{const e=await fakeAgy(d),r=await new GeminiRunner({stateRoot:path.join(d,'state'),geminiEntry:e}).init();const j=JSON.parse(await fsp.readFile(await r.settings('edit'),'utf8'));assert.equal(j.allowNonWorkspaceAccess,false);}finally{await fsp.rm(d,{recursive:true,force:true});}});
test('Top50 #40 dangerously-skip-permissions is never passed',async()=>{assert.doesNotMatch(await text('src/gemini.mjs'),/dangerously-skip-permissions/);});
test('Top50 #41 auth status uses provider-backed models probe',async()=>{const s=await text('src/gemini.mjs');assert.match(s,/\[\.\.\.c\.args,'models'\]/);});
test('Top50 #42 authentication-required text maps to signed-out state',async()=>{const d=await tmp();try{const e=await fakeAgy(d),r=await new GeminiRunner({stateRoot:path.join(d,'state'),geminiEntry:e}).init();await fsp.writeFile(e+'.unauth','1');const x=await r.authStatus({timeoutMs:5000});assert.equal(x.authenticated,false);assert.equal(x.error,'AUTH_REQUIRED');}finally{await fsp.rm(d,{recursive:true,force:true});}});
test('Top50 #43 Dashboard button starts auth through Host API',async()=>{const s=await text('ui/app.js');assert.match(s,/api\('\/v1\/auth\/start',\{method:'POST'/);assert.match(s,/\$\('authHelp'\)\.onclick=\(\)=>startGoogleAuth\(\)/);});
test('Top50 #44 Dashboard polls auth status after launch',async()=>{const s=await text('ui/app.js');assert.match(s,/api\('\/v1\/auth\/status'/);assert.match(s,/setInterval\(pollGoogleAuth,2000\)/);});
test('Top50 #45 no user-facing flow requires the obsolete sign-in shortcut',async()=>{const ui=await text('ui/app.js'),setup=await text('Setup.ps1');assert.doesNotMatch(ui,/Gemini Bridge Sign-in/);assert.match(setup,/Remove-Item \(Join-Path \$Desktop 'Gemini Bridge Sign-in\.lnk'\)/);});
test('Top50 #46 Host auth routes remain token-protected',async()=>{const s=await text('src/host.mjs');assert.match(s,/if\(!auth\(req\)\).*HOST_INITIALIZING/);assert.match(s,/\/v1\/auth\/start/);assert.match(s,/\/v1\/auth\/status/);});
test('Top50 #47 extension pairing token is generated outside immutable install tree',async()=>{const s=await text('Setup.ps1');assert.match(s,/\$MutableExtension=Join-Path \$BaseRoot 'web-extension'/);assert.match(s,/const GB_TOKEN/);});
test('Top50 #48 release manifest remains exhaustive contract',async()=>{const s=await text('Setup.ps1');assert.match(s,/Verify-ReleaseManifest/);assert.match(s,/Release manifest is not exhaustive/);});
test('Top50 #49 version metadata is consistent for 0.4.8.8',async()=>{const pkg=await json('package.json'),man=await json('web-extension/manifest.json'),u=await text('src/utils.mjs'),setup=await text('Setup.ps1');assert.equal(pkg.version,'0.4.8.8');assert.equal(man.version,'0.4.8.8');assert.match(u,/APP_VERSION = '0\.4\.8\.8'/);assert.match(setup,/\$Version='0\.4\.8\.8'/);});
test('Top50 #50 current runtime/provider is strict-health verified before commit',async()=>{const s=await text('Setup.ps1');const verify=s.lastIndexOf('Verify-NewHost $newCfg'),commit=s.lastIndexOf('Commit-Release');assert.ok(verify>=0&&commit>verify);assert.match(s,/h\.gemini\.version/);assert.match(s,/CandidateLaunchNonce/);});
