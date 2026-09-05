import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {GeminiRunner} from '../src/gemini.mjs';
import {probeAntigravityEntry,compareSemver} from '../src/managed-antigravity-probe.mjs';

const ROOT=path.resolve('.');
async function tmp(){return await fsp.mkdtemp(path.join(os.tmpdir(),'gb-ah-'));}
async function directFake(dir){
  const file=path.join(dir,'agy-fake');
  const source=`#!/usr/bin/env node
import fsp from 'node:fs/promises';
import path from 'node:path';
const args=process.argv.slice(2);
if(args.includes('--version')){console.log('1.2.3');process.exit(0)}
if(args[0]==='models'){process.exit(process.env.TEST_AUTH==='no'?7:0)}
let input='';for await(const c of process.stdin)input+=c;
const log=path.join(process.cwd(),'.agy-test-log.json');await fsp.writeFile(log,JSON.stringify({args,input,home:process.env.HOME,userprofile:process.env.USERPROFILE,autoUpdate:process.env.AGY_CLI_DISABLE_AUTO_UPDATE}));
console.log(JSON.stringify({event:'init',init:{model:'agy-test'}}));
console.log(JSON.stringify({event:'step_update',step_update:{text_delta:'partial'}}));
console.log(JSON.stringify({event:'result',result:{status:'SUCCESS',response:'final'}}));
`;
  await fsp.writeFile(file,source);await fsp.chmod(file,0o755);return file;
}

test('Phase AH: managed Antigravity probe enforces minimum and exact version',async()=>{
  const d=await tmp();try{const entry=await directFake(d);assert.equal(compareSemver('1.2.3','1.1.20'),1);assert.equal((await probeAntigravityEntry(entry,{minimum:'1.1.20',expected:'1.2.3'})).version,'1.2.3');await assert.rejects(()=>probeAntigravityEntry(entry,{minimum:'2.0.0'}),e=>e.code==='ANTIGRAVITY_VERSION_TOO_OLD');await assert.rejects(()=>probeAntigravityEntry(entry,{expected:'1.2.4'}),e=>e.code==='ANTIGRAVITY_VERSION_MISMATCH');}finally{await fsp.rm(d,{recursive:true,force:true});}
});

test('Phase AH: Antigravity headless transport uses stream-json and safe modes',async()=>{
  const d=await tmp();
  try{
    const entry=await directFake(d),state=path.join(d,'state'),cwd=path.join(d,'cwd');
    await fsp.mkdir(cwd);
    const log=path.join(cwd,'.agy-test-log.json');
    const r=await new GeminiRunner({stateRoot:state,geminiEntry:entry}).init();
    const review=await r.run({mode:'review',cwd,payload:'hello'});
    assert.equal(review.text,'final');
    let x=JSON.parse(await fsp.readFile(log,'utf8'));
    assert.deepEqual(x.args.slice(0,4),['--input-format','stream-json','--output-format','stream-json']);
    assert.ok(x.args.includes('plan'));
    assert.equal(JSON.parse(x.input.trim()).event,'user');
    assert.equal(JSON.parse(x.input.trim()).message.content,'hello');
    assert.equal(x.home,x.userprofile);assert.equal(x.autoUpdate,'true');
    await r.run({mode:'edit',cwd,payload:'edit'});
    x=JSON.parse(await fsp.readFile(log,'utf8'));
    assert.ok(x.args.includes('accept-edits'));
  }finally{await fsp.rm(d,{recursive:true,force:true});}
});

test('Phase AH: Antigravity policies deny shell/network/MCP and preserve mode write boundaries',async()=>{
  const d=await tmp();try{const entry=await directFake(d),r=await new GeminiRunner({stateRoot:path.join(d,'state'),geminiEntry:entry}).init();for(const [mode,mustDenyWrite] of [['ask',true],['review',true],['edit',false]]){const file=await r.settings(mode);const j=JSON.parse(await fsp.readFile(file,'utf8'));assert.equal(j.allowNonWorkspaceAccess,false);for(const x of ['command(*)','read_url(*)','execute_url(*)','mcp(*)','unsandboxed(*)'])assert.ok(j.permissions.deny.includes(x));assert.equal(j.permissions.deny.includes('write_file(*)'),mustDenyWrite);} }finally{await fsp.rm(d,{recursive:true,force:true});}
});

test('Phase AH: Host exposes authenticated fixed auth start/status routes',async()=>{const s=await fsp.readFile(path.join(ROOT,'src/host.mjs'),'utf8');assert.match(s,/if\(!auth\(req\)\).*HOST_INITIALIZING/);assert.match(s,/POST'&&u\.pathname==='\/v1\/auth\/start'/);assert.match(s,/GET'&&u\.pathname==='\/v1\/auth\/status'/);assert.match(s,/launchInteractiveAuth/);assert.match(s,/provider:'antigravity'/);});

test('Phase AH: Dashboard starts Google auth directly and no longer tells users to use a shortcut',async()=>{const s=await fsp.readFile(path.join(ROOT,'ui/app.js'),'utf8');assert.match(s,/api\('\/v1\/auth\/start',\{method:'POST'/);assert.match(s,/api\('\/v1\/auth\/status'/);assert.match(s,/startGoogleAuth/);assert.doesNotMatch(s,/Gemini Bridge Sign-in/);});

test('Phase AH: Setup migrates to managed Antigravity and removes separate sign-in shortcut',async()=>{const s=await fsp.readFile(path.join(ROOT,'Setup.ps1'),'utf8');assert.match(s,/\$MinimumAntigravityVersion='1\.1\.20'/);assert.match(s,/https:\/\/antigravity\.google\/cli\/install\.ps1/);assert.match(s,/Ensure-Antigravity/);assert.match(s,/Copy-FileWithRetry \$externalEntry \$entry/);assert.match(s,/provider -NotePropertyValue 'antigravity'/);assert.doesNotMatch(s,/@google\/gemini-cli@/);assert.match(s,/Remove-Item \(Join-Path \$Desktop 'Gemini Bridge Sign-in\.lnk'\)/);const stage6=s.slice(s.indexOf("Stage 6 'Dashboard and Google sign-in readiness'"));assert.doesNotMatch(stage6,/Auth-GeminiBridge\.cmd/);assert.match(stage6,/Launch-Dashboard\.cmd/);});

test('Phase AH: Setup accepts legacy three-part and current four-part Gemini Bridge versions',async()=>{
  const s=await fsp.readFile(path.join(ROOT,'Setup.ps1'),'utf8');
  assert.match(s,/function Parse-AppVersion/);
  assert.ok(s.includes("'^\\d+(?:\\.\\d+){2,3}$'"));
  assert.match(s,/\$installedVersion=Parse-AppVersion \$installed 'Installed'/);
  assert.match(s,/\$targetVersion=Parse-AppVersion \$Version 'Target'/);
  assert.doesNotMatch(s,/\^\\d\+\\\.\\d\+\\\.\\d\+\\$/);
});

