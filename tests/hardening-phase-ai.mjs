import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const setup=()=>fsp.readFile(path.join(ROOT,'Setup.ps1'),'utf8');

function functionBlocks(ps){
  const out=[];const re=/^function\s+([A-Za-z0-9_-]+)\b/gmi;let m;
  while((m=re.exec(ps))){
    const brace=ps.indexOf('{',m.index);if(brace<0)continue;let depth=0,end=brace;
    for(let i=brace;i<ps.length;i++){if(ps[i]==='{')depth++;else if(ps[i]==='}'&&--depth===0){end=i+1;break;}}
    out.push({name:m[1],head:ps.slice(m.index,brace),body:ps.slice(brace,end)});
  }
  return out;
}

function localDefinitions(block){
  const defs=new Set();
  for(const m of block.head.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g))defs.add(m[1].toLowerCase());
  for(const m of block.body.matchAll(/(?<![:\w])\$([A-Za-z_][A-Za-z0-9_]*)\s*(?:=|\+=|-=|\+\+|--)/g))defs.add(m[1].toLowerCase());
  return defs;
}

test('Phase AI: release root is explicitly script-scoped',async()=>{
  const s=await setup();
  assert.match(s,/\$script:ReleaseRoot=Split-Path -Parent \$MyInvocation\.MyCommand\.Path/);
  assert.doesNotMatch(s,/(?<!:)\$Source\b/i);
});

test('Phase AI: managed Antigravity probe resolves helper from immutable release root',async()=>{
  const s=await setup();
  const part=s.slice(s.indexOf('function Invoke-AntigravityEntryProbe'),s.indexOf('function Get-AntigravityCandidates'));
  assert.match(part,/Join-Path \$script:ReleaseRoot 'src\\managed-antigravity-probe\.mjs'/);
  assert.doesNotMatch(part,/Join-Path \$(?:source|externalEntry|entry) 'src\\managed-antigravity-probe\.mjs'/i);
});

test('Phase AI: external agy source and release root are distinct variables',async()=>{
  const s=await setup();
  const part=s.slice(s.indexOf('function Ensure-Antigravity'),s.indexOf('function Write-RuntimeConfig'));
  assert.match(part,/\$externalEntry=\[string\]\$usable\.entry/);
  assert.match(part,/Copy-FileWithRetry \$externalEntry \$entry/);
  assert.doesNotMatch(part,/(?<!:)\$source\b/i);
});

test('Phase AI: copy helper does not introduce caller-scope Source shadowing',async()=>{
  const s=await setup();
  const part=s.slice(s.indexOf('function Copy-FileWithRetry'),s.indexOf('function Assert-DownloadedInstaller'));
  assert.match(part,/\[string\]\$sourceFile/);
  assert.match(part,/Copy-Item -LiteralPath \$sourceFile/);
  assert.doesNotMatch(part,/\[string\]\$source[,)]/i);
});

test('Phase AI: all release-root consumers use explicit script scope',async()=>{
  const s=await setup();
  for(const needle of [
    "Join-Path $script:ReleaseRoot 'src\\cli.mjs'",
    "Get-ChildItem -LiteralPath $script:ReleaseRoot -Force",
    "Join-Path $script:ReleaseRoot 'src\\managed-antigravity-probe.mjs'",
    'Verify-ReleaseManifest $script:ReleaseRoot|Out-Null'
  ])assert.ok(s.includes(needle),`missing ${needle}`);
});

test('Phase AI: function locals cannot shadow critical script-owned roots',async()=>{
  const s=await setup();
  const protectedNames=new Set(['releaseroot','installroot','baseroot','stateroot','runtimebase','mutableextension','backuproot','launcherroot','startup','desktop','version','minimumantigravityversion']);
  const collisions=[];
  for(const b of functionBlocks(s))for(const n of localDefinitions(b))if(protectedNames.has(n))collisions.push(`${b.name}:${n}`);
  assert.deepEqual(collisions,[]);
});

test('Phase AI: existing user-local agy is copied, never deleted or overwritten',async()=>{
  const s=await setup();
  const part=s.slice(s.indexOf('function Get-AntigravityCandidates'),s.indexOf('function Write-RuntimeConfig'));
  assert.match(part,/LOCALAPPDATA 'agy\\bin\\agy\.exe'/);
  assert.match(part,/Copy-FileWithRetry \$externalEntry \$entry/);
  assert.doesNotMatch(part,/Remove-Item[^\n]*agy\\bin\\agy\.exe/i);
  assert.doesNotMatch(part,/Copy-Item[^\n]*-Destination[^\n]*agy\\bin\\agy\.exe/i);
});

test('Phase AI: managed agy remains exact-version reprobed after copy',async()=>{
  const s=await setup();
  assert.match(s,/\$managed=Invoke-AntigravityEntryProbe \$node \$entry \$sourceVersion/);
  assert.match(s,/Managed Antigravity copy failed exact version verification/);
});

test('Phase AI: external Antigravity probing tolerates transient self-update locks',async()=>{
  const s=await setup();
  const part=s.slice(s.indexOf('function Find-UsableAntigravity'),s.indexOf('function Ensure-Antigravity'));
  assert.match(part,/\[int\]\$attempts=3/);
  assert.match(part,/for\(\$i=0;\$i -lt \$attempts;\$i\+\+\)/);
  assert.match(part,/Start-Sleep -Milliseconds \(250\*\(\$i\+1\)\)/);
});

test('Phase AI: managed copy retries if user-local agy self-updates between probe and copy',async()=>{
  const s=await setup();
  const part=s.slice(s.indexOf('function Ensure-Antigravity'),s.indexOf('function Write-RuntimeConfig'));
  assert.match(part,/for\(\$copyAttempt=0;\$copyAttempt -lt 3;\$copyAttempt\+\+\)/);
  assert.match(part,/\$sourceVersion=\[string\]\$sourceProbe\.version/);
  assert.match(part,/Invoke-AntigravityEntryProbe \$node \$entry \$sourceVersion/);
  assert.match(part,/Remove-Item -LiteralPath \$dir -Recurse -Force/);
});

test('Phase AI: AgentVersion is committed only after managed exact-version probe succeeds',async()=>{
  const s=await setup();
  const part=s.slice(s.indexOf('function Ensure-Antigravity'),s.indexOf('function Write-RuntimeConfig'));
  assert.match(part,/if\(\$managed -and \$managed\.ok -eq \$true\)\{\$script:AgentVersion=\[string\]\$managed\.version;return/);
  assert.doesNotMatch(part,/\$script:AgentVersion=\[string\]\$sourceProbe\.version/);
});

test('Phase AI: a usable existing user-local agy bypasses the network installer path',async()=>{
  const s=await setup();
  const part=s.slice(s.indexOf('function Ensure-Antigravity'),s.indexOf('function Write-RuntimeConfig'));
  assert.match(part,/\$usable=Find-UsableAntigravity \$node\s+if\(-not \$usable\)\{Invoke-OfficialAntigravityInstaller;\$usable=Find-UsableAntigravity \$node 5\}/s);
});
