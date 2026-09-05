import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import { buildSnapshot, applySnapshot, reconcileApply, discardSnapshot } from '../src/snapshot.mjs';
import { BridgeCore } from '../src/core.mjs';

async function tmp(prefix='gb-pe-'){return await fsp.mkdtemp(path.join(os.tmpdir(),prefix));}
async function exists(p){try{await fsp.lstat(p);return true;}catch{return false;}}
async function fixture({initial={'a.txt':'before'},change='update',rel='a.txt',after='after'}={}){
  const d=await tmp(),ws=path.join(d,'workspace'),snap=path.join(d,'snapshot');await fsp.mkdir(ws,{recursive:true});
  for(const [name,text] of Object.entries(initial)){const f=path.join(ws,...name.split('/'));await fsp.mkdir(path.dirname(f),{recursive:true});await fsp.writeFile(f,text);}
  const built=await buildSnapshot(ws,snap,{mode:'edit'});const sf=path.join(built.filesDir,...rel.split('/'));await fsp.mkdir(path.dirname(sf),{recursive:true});
  if(change==='update'||change==='add')await fsp.writeFile(sf,after);else if(change==='delete')await fsp.unlink(sf);
  return {d,ws,snap,run:{id:crypto.randomUUID(),workspace_root:ws,snapshot_dir:snap,mode:'edit',status:'WAITING_APPLY',request_id:crypto.randomUUID()},rel,target:path.join(ws,...rel.split('/'))};
}
async function journalOf(e){return JSON.parse(await fsp.readFile(path.join(e.snap,'apply-journal.json'),'utf8'));}
async function crashAt(e,phase,extra=null){return await assert.rejects(()=>applySnapshot(e.run,{onPhase:async(p,ctx)=>{if(p===phase){if(extra)await extra(ctx);throw new Error(`SIMULATED_CRASH:${phase}`);}}}),new RegExp(`SIMULATED_CRASH:${phase}`));}

// Journal must exist before a live stage is ever created.
test('Phase E: crash after journal but before stage leaves live file untouched and reconciles to pending',async()=>{
  const e=await fixture();await crashAt(e,'after-journal');const j=await journalOf(e);assert.equal(j.runId,e.run.id);assert.equal(j.entries.length,1);assert.equal(await exists(j.entries[0].stagePath),false);assert.equal(await fsp.readFile(e.target,'utf8'),'before');
  const rec=await reconcileApply(e.run);assert.equal(rec.pending,1);assert.equal(rec.conflicts.length,0);assert.equal(await exists(path.join(e.snap,'apply-journal.json')),false);
});

test('Phase E: crash after stage write cleans only the proven stage and keeps live baseline pending',async()=>{
  const e=await fixture();await crashAt(e,'after-stage-write');const j=await journalOf(e),stage=j.entries[0].stagePath;assert.equal(await fsp.readFile(stage,'utf8'),'after');assert.equal(await fsp.readFile(e.target,'utf8'),'before');
  const rec=await reconcileApply(e.run);assert.equal(rec.pending,1);assert.equal(await exists(stage),false);assert.equal(await exists(path.join(e.snap,'apply-journal.json')),false);
});

test('Phase E: crash after no-clobber add link is recognized as already applied and owned stage is cleaned',async()=>{
  const e=await fixture({initial:{},change:'add',rel:'new.txt',after:'agent'});await crashAt(e,'after-add-link');const j=await journalOf(e),stage=j.entries[0].stagePath;assert.equal(await fsp.readFile(e.target,'utf8'),'agent');assert.equal(await exists(stage),true);
  const rec=await reconcileApply(e.run);assert.equal(rec.pending,0);assert.equal(rec.applied,1);assert.equal(await exists(stage),false);assert.equal(await fsp.readFile(e.target,'utf8'),'agent');
});

test('Phase E: crash after update rename is recognized as applied even though stage path is already gone',async()=>{
  const e=await fixture();await crashAt(e,'after-update-rename');const j=await journalOf(e),stage=j.entries[0].stagePath;assert.equal(await exists(stage),false);assert.equal(await fsp.readFile(e.target,'utf8'),'after');
  const rec=await reconcileApply(e.run);assert.equal(rec.pending,0);assert.equal(rec.applied,1);assert.equal(await exists(path.join(e.snap,'apply-journal.json')),false);
});

test('Phase E: add uses no-clobber semantics when a user file appears after stage write',async()=>{
  const e=await fixture({initial:{},change:'add',rel:'new.txt',after:'agent'});const out=await applySnapshot(e.run,{onPhase:async(p)=>{if(p==='after-stage-write')await fsp.writeFile(e.target,'user-created');}});
  assert.equal(out.ok,false);assert.equal(out.conflicts.length,1);assert.equal(await fsp.readFile(e.target,'utf8'),'user-created');assert.equal(await exists(path.join(e.snap,'apply-journal.json')),false);
});

test('Phase E: update rechecks baseline immediately before replace and preserves a last-second user edit',async()=>{
  const e=await fixture();const out=await applySnapshot(e.run,{onPhase:async(p)=>{if(p==='before-final-check')await fsp.writeFile(e.target,'user-last-second');}});
  assert.equal(out.ok,false);assert.equal(out.conflicts.length,1);assert.equal(await fsp.readFile(e.target,'utf8'),'user-last-second');assert.equal(await exists(path.join(e.snap,'apply-journal.json')),false);
});

test('Phase E: delete rechecks baseline immediately before unlink and preserves a last-second user edit',async()=>{
  const e=await fixture({change:'delete'});const out=await applySnapshot(e.run,{onPhase:async(p)=>{if(p==='before-final-check')await fsp.writeFile(e.target,'user-last-second');}});
  assert.equal(out.ok,false);assert.equal(out.conflicts.length,1);assert.equal(await fsp.readFile(e.target,'utf8'),'user-last-second');assert.equal(await exists(path.join(e.snap,'apply-journal.json')),false);
});

test('Phase E: foreign content at a recorded stage path blocks Recovery and Discard and is never deleted',async()=>{
  const e=await fixture();let stage;await crashAt(e,'after-stage-write',async()=>{const j=await journalOf(e);stage=j.entries[0].stagePath;await fsp.writeFile(stage,'FOREIGN-CONTENT');});
  await assert.rejects(()=>reconcileApply(e.run),/APPLY_STAGE_HASH_MISMATCH/);await assert.rejects(()=>discardSnapshot(e.run),/APPLY_STAGE_HASH_MISMATCH/);assert.equal(await fsp.readFile(stage,'utf8'),'FOREIGN-CONTENT');assert.equal(await exists(e.snap),true);assert.equal(await fsp.readFile(e.target,'utf8'),'before');
});

test('Phase E: Discard removes a cryptographically attributable pending stage before deleting snapshot data',async()=>{
  const e=await fixture();await crashAt(e,'after-stage-write');const j=await journalOf(e),stage=j.entries[0].stagePath;await discardSnapshot(e.run);assert.equal(await exists(stage),false);assert.equal(await exists(e.snap),false);assert.equal(await fsp.readFile(e.target,'utf8'),'before');
});

test('Phase E: parent directory replaced with symlink after journal cannot redirect stage write outside workspace',async t=>{
  if(process.platform==='win32')return t.skip('Windows junction/reparse behavior requires real Windows E2E');
  const e=await fixture({initial:{'dir/a.txt':'before'},change:'update',rel:'dir/a.txt',after:'after'}),outside=path.join(e.d,'outside');await fsp.mkdir(outside);let stage;
  await assert.rejects(()=>applySnapshot(e.run,{onPhase:async(p)=>{if(p!=='after-journal')return;const j=await journalOf(e);stage=j.entries[0].stagePath;await fsp.rename(path.join(e.ws,'dir'),path.join(e.ws,'dir-original'));await fsp.symlink(outside,path.join(e.ws,'dir'),'dir');}}),/LIVE_PATH_UNSAFE/);
  assert.equal((await fsp.readdir(outside)).length,0);assert.equal(await exists(stage),false);
});

test('Phase E: update preserves executable/file mode where the platform exposes POSIX mode bits',async t=>{
  if(process.platform==='win32')return t.skip('POSIX mode bits are not meaningful on Windows');const e=await fixture();await fsp.chmod(e.target,0o751);const out=await applySnapshot(e.run);assert.equal(out.ok,true);const st=await fsp.stat(e.target);assert.equal(st.mode&0o777,0o751);assert.equal(await fsp.readFile(e.target,'utf8'),'after');
});

test('Phase E: an existing directory at an Agent add path is a conflict, never treated as missing',async()=>{
  const e=await fixture({initial:{},change:'add',rel:'new.txt',after:'agent'});await fsp.mkdir(e.target);const rec=await reconcileApply(e.run);assert.equal(rec.conflicts.length,1);assert.equal(rec.pending,0);const out=await applySnapshot(e.run);assert.equal(out.ok,false);assert.equal(await (await fsp.stat(e.target)).isDirectory(),true);
});

test('Phase E: reserved stage artifacts in a workspace are excluded from future snapshots',async()=>{
  const d=await tmp(),ws=path.join(d,'w'),snap=path.join(d,'s');await fsp.mkdir(ws);const name=`.gb-stage-${'a'.repeat(32)}`;await fsp.writeFile(path.join(ws,name),'must-not-leak');const built=await buildSnapshot(ws,snap,{mode:'review'});assert.equal(Object.hasOwn(built.manifest.files,name),false);assert.ok(built.manifest.skipped.some(x=>x.path===name));
});

test('Phase E: terminal startup-GC cleanup removes only proven stage artifacts and preserves foreign collisions',async()=>{
  const e=await fixture();await crashAt(e,'after-stage-write');const j=await journalOf(e),stage=j.entries[0].stagePath;const core=Object.create(BridgeCore.prototype);core.stateRoot=path.join(e.d,'state');const terminal={...e.run,status:'APPLIED'};assert.equal(await core.cleanupRunArtifacts(terminal),true);assert.equal(await exists(stage),false);assert.equal(await exists(e.snap),false);
  const f=await fixture();let foreign;await crashAt(f,'after-stage-write',async()=>{const jj=await journalOf(f);foreign=jj.entries[0].stagePath;await fsp.writeFile(foreign,'FOREIGN');});const core2=Object.create(BridgeCore.prototype);core2.stateRoot=path.join(f.d,'state');assert.equal(await core2.cleanupRunArtifacts({...f.run,status:'APPLIED'}),false);assert.equal(await fsp.readFile(foreign,'utf8'),'FOREIGN');assert.equal(await exists(f.snap),true);
});

test('Phase E: crash after delete unlink is recovered as already applied and stale journal is cleared',async()=>{
  const e=await fixture({change:'delete'});await crashAt(e,'after-delete-unlink');assert.equal(await exists(e.target),false);assert.equal(await exists(path.join(e.snap,'apply-journal.json')),true);const rec=await reconcileApply(e.run);assert.equal(rec.applied,1);assert.equal(rec.pending,0);assert.equal(await exists(path.join(e.snap,'apply-journal.json')),false);
});

test('Phase E: an unexpected pre-existing file at the newly journaled stage path is never clobbered or cleaned',async()=>{
  const e=await fixture();let collision;await assert.rejects(()=>applySnapshot(e.run,{onPhase:async(p)=>{if(p!=='after-journal')return;const j=await journalOf(e);collision=j.entries[0].stagePath;await fsp.writeFile(collision,'EXTERNAL-STAGE-COLLISION');}}),/EEXIST/);assert.equal(await fsp.readFile(collision,'utf8'),'EXTERNAL-STAGE-COLLISION');await assert.rejects(()=>reconcileApply(e.run),/APPLY_STAGE_HASH_MISMATCH/);assert.equal(await fsp.readFile(collision,'utf8'),'EXTERNAL-STAGE-COLLISION');
});
