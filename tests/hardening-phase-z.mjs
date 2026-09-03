import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import {GeminiRunner} from '../src/gemini.mjs';
import {buildSnapshot} from '../src/snapshot.mjs';
import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function tmp(){return await fsp.mkdtemp(path.join(os.tmpdir(),'gb-z-'));}

test('Phase Z: Gemini home and policy directories may not redirect writes through symlink/reparse children',async()=>{
  const d=await tmp(),state=path.join(d,'state'),outside=path.join(d,'outside');await fsp.mkdir(state,{recursive:true});await fsp.mkdir(outside,{recursive:true});
  await fsp.symlink(outside,path.join(state,'gemini-home'),'dir');
  const r=new GeminiRunner({stateRoot:state,geminiEntry:path.join(ROOT,'tests','fake-gemini.mjs')});
  await assert.rejects(()=>r.init(),/STATE_DIR_UNSAFE/);
  assert.deepEqual(await fsp.readdir(outside),[],'Gemini init must not create .gemini outside state root');
  await fsp.rm(path.join(state,'gemini-home'));await fsp.mkdir(path.join(state,'gemini-home'),{recursive:true});await fsp.symlink(outside,path.join(state,'policies'),'dir');
  await assert.rejects(()=>r.init(),/STATE_DIR_UNSAFE/);
  assert.deepEqual(await fsp.readdir(outside),[],'policy init must not write outside state root');
});

test('Phase Z: snapshot destination refuses run-data symlink/reparse escape from state root',async()=>{
  const d=await tmp(),state=path.join(d,'state'),outside=path.join(d,'outside'),ws=path.join(d,'ws');await fsp.mkdir(state,{recursive:true});await fsp.mkdir(outside,{recursive:true});await fsp.mkdir(ws,{recursive:true});await fsp.writeFile(path.join(ws,'a.txt'),'hello');
  await fsp.symlink(outside,path.join(state,'run-data'),'dir');
  await assert.rejects(()=>buildSnapshot(ws,path.join(state,'run-data','abc','snapshot'),{mode:'edit',ownedRoot:state}),/STATE_DIR_UNSAFE/);
  assert.deepEqual(await fsp.readdir(outside),[],'snapshot must not be created outside state root');
});

test('Phase Z: interactive auth empty cwd is created through the owned-state directory guard',async()=>{
  const s=await fsp.readFile(path.join(ROOT,'src','auth.mjs'),'utf8');
  assert.match(s,/ensureOwnedDir\s*\(\s*root\s*,\s*cwd\s*\)/);
});
