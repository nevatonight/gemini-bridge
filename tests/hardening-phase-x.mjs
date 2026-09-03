import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {ensureRuntimeConfig,repairRuntimeConfig} from '../src/runtime-config.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function tmp(){return await fsp.mkdtemp(path.join(os.tmpdir(),'gb-x-'));}

test('Phase X: runtime.json must be an owned regular file, never a symlink/reparse redirect',async()=>{
  const d=await tmp(),state=path.join(d,'state'),outside=path.join(d,'outside.json');
  await fsp.mkdir(state,{recursive:true});
  const original=JSON.stringify({token:'a'.repeat(64),port:38473,nodePath:process.execPath,geminiEntry:path.join(d,'fake.mjs')});
  await fsp.writeFile(outside,original);
  await fsp.symlink(outside,path.join(state,'runtime.json'));
  await assert.rejects(()=>ensureRuntimeConfig(state),/RUNTIME_CONFIG_UNSAFE_FILE/);
  await assert.rejects(()=>repairRuntimeConfig(state),/RUNTIME_CONFIG_UNSAFE_FILE/);
  assert.equal(await fsp.readFile(outside,'utf8'),original,'outside runtime target must remain unchanged');
});

test('Phase X: Setup fail-closes on reparse app-owned roots before destructive upgrade work',async()=>{
  const s=await fsp.readFile(path.join(ROOT,'Setup.ps1'),'utf8');
  assert.match(s,/function Assert-(?:Owned|App).*?(?:Reparse|Safe)/is);
  const helper=(s.match(/function Assert-(?:Owned|App)[\s\S]*?\n\}/i)||[''])[0];
  assert.match(helper,/ReparsePoint|LinkType/i);
  for(const needle of ['$BaseRoot','$StateRoot','$InstallRoot','$MutableExtension']){
    const escaped=needle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    assert.match(s,new RegExp(`Assert-(?:Owned|App)[^\\n]*${escaped}`,'i'),`${needle} is not guarded`);
  }
  const stage2=s.slice(s.indexOf("Stage 2 'Quiesce"),s.indexOf("Stage 3 'Install",s.indexOf("Stage 2 'Quiesce")));
  assert.match(stage2,/Assert-(?:Owned|App)/i,'owned-root guard must run before backup/upgrade mutation');
});

test('Phase X: Uninstall refuses reparse app-owned roots before recursive deletion',async()=>{
  const s=await fsp.readFile(path.join(ROOT,'Uninstall.ps1'),'utf8');
  assert.match(s,/function Assert-(?:Owned|App).*?(?:Reparse|Safe)/is);
  const firstRemove=s.indexOf('Remove-Item');
  const firstGuard=s.search(/Assert-(?:Owned|App)/i);
  assert.ok(firstGuard>=0&&firstGuard<firstRemove,'reparse guard must precede recursive/unconditional deletion paths');
  for(const name of ['$Base','$State','$Install','$MutableExtension']){
    const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    assert.match(s,new RegExp(`Assert-(?:Owned|App)[^\\n]*${escaped}`,'i'),`${name} is not guarded`);
  }
});
