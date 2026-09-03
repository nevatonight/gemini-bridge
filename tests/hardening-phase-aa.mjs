import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {loadRuntimeConfig} from '../src/runtime-config.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('Phase AA: read-only runtime loader enforces the same owned-file and completeness contract',async()=>{
  const d=await fsp.mkdtemp(path.join(os.tmpdir(),'gb-aa-')),state=path.join(d,'state'),outside=path.join(d,'outside.json');await fsp.mkdir(state,{recursive:true});
  const valid={token:'a'.repeat(64),port:38473,nodePath:process.execPath,geminiEntry:path.join(d,'g.mjs')};await fsp.writeFile(outside,JSON.stringify(valid));await fsp.symlink(outside,path.join(state,'runtime.json'));
  await assert.rejects(()=>loadRuntimeConfig(state),/RUNTIME_CONFIG_UNSAFE_FILE/);
  await fsp.rm(path.join(state,'runtime.json'));await fsp.writeFile(path.join(state,'runtime.json'),JSON.stringify({token:'a'.repeat(64)}));
  await assert.rejects(()=>loadRuntimeConfig(state),/RUNTIME_CONFIG_INCOMPLETE/);
});

test('Phase AA: interactive auth JS consumes runtime only through the safe runtime-config loader',async()=>{
  const s=await fsp.readFile(path.join(ROOT,'src','auth.mjs'),'utf8');
  assert.match(s,/from ['"]\.\/runtime-config\.mjs['"]/);
  assert.match(s,/loadRuntimeConfig\s*\(\s*root\s*\)/);
  assert.doesNotMatch(s,/readJson\s*\(\s*path\.join\(root,['"]runtime\.json/);
});

test('Phase AA: Windows Auth and Dashboard reject reparse runtime/launcher/lock metadata before trust',async()=>{
  const auth=await fsp.readFile(path.join(ROOT,'Auth-GeminiBridge.ps1'),'utf8');
  const dash=await fsp.readFile(path.join(ROOT,'Launch-Dashboard.ps1'),'utf8');
  assert.match(auth,/Assert-(?:Owned|App).*FileSafe[\s\S]*?ReparsePoint/i);
  assert.ok(auth.indexOf('Assert-AppOwnedFileSafe')<auth.indexOf('Get-Content'),'Auth runtime guard must precede Get-Content');
  assert.match(dash,/Assert-(?:Owned|App).*FileSafe[\s\S]*?ReparsePoint/i);
  assert.match(dash,/Assert-AppOwnedFileSafe[^\n]*\$RuntimeFile/i);
  assert.match(dash,/Assert-AppOwnedFileSafe[^\n]*\$Launcher/i);
  assert.match(dash,/Assert-AppOwnedFileSafe[^\n]*host\.lock\.json/i);
});
