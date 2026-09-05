import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.mjs';
import { BridgeCore } from '../src/core.mjs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

async function tmp(prefix='gb-g-'){return await fsp.mkdtemp(path.join(os.tmpdir(),prefix));}
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const FAKE=path.join(ROOT,'tests','fake-gemini.mjs');
async function makeStore(){const root=await tmp();const store=await new Store(root).init();return {root,store};}
function projectState(store,id){const p=store.getProject(id);return {name:p.name,workspace:p.workspace,workspace_id:p.workspace_id,current_context_revision:p.current_context_revision,context:p.context};}

test('Phase G SQLite fault: SQLITE_FULL preserves the primary error and project update remains atomic',async()=>{
  const {store}=await makeStore();
  const p=store.createProject('Before');
  store.updateProject(p.id,{context:'before-context'});
  const before=projectState(store,p.id);
  store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const pages=Number(store.db.prepare('PRAGMA page_count').get().page_count);
  store.db.exec(`PRAGMA max_page_count=${pages}`);
  let error;
  try{
    store.updateProject(p.id,{name:'After',workspace:'/should-not-stick',workspaceId:'wid-after',context:'X'.repeat(2*1024*1024)});
  }catch(e){error=e;}
  assert.ok(error,'expected SQLITE_FULL');
  assert.match(String(error?.message||error),/database or disk is full/i);
  assert.doesNotMatch(String(error?.message||error),/cannot rollback|no transaction is active/i);
  assert.deepEqual(projectState(store,p.id),before);
});

test('Phase G SQLite fault: SQLITE_BUSY surfaces the lock error and leaves project state unchanged',async()=>{
  const {root,store}=await makeStore();
  const p=store.createProject('Before');
  store.updateProject(p.id,{context:'before-context'});
  const before=projectState(store,p.id);
  store.db.exec('PRAGMA busy_timeout=25');
  const other=new DatabaseSync(path.join(root,'bridge.sqlite'));
  try{
    other.exec('PRAGMA busy_timeout=25; BEGIN IMMEDIATE;');
    let error;
    try{store.updateProject(p.id,{name:'After',context:'after-context'});}catch(e){error=e;}
    assert.ok(error,'expected SQLITE_BUSY');
    assert.match(String(error?.message||error),/database is locked/i);
    assert.deepEqual(projectState(store,p.id),before);
  }finally{
    try{other.exec('ROLLBACK');}catch{}
    other.close();
  }
});


test('Phase G SQLite fault: SQLITE_FULL during run finalization leaves run RUNNING and persists no partial turns',async()=>{
  const {store}=await makeStore();const p=store.createProject('P'),th=store.createThread(p.id,'T'),id=crypto.randomUUID();
  store.createRun({id,requestId:`full-final-${id}`,requestFingerprint:'fp',projectId:p.id,threadId:th.id,mode:'ask',status:'RUNNING',prompt:'user',contextRevision:store.getProject(p.id).current_context_revision});
  store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');const pages=Number(store.db.prepare('PRAGMA page_count').get().page_count);store.db.exec(`PRAGMA max_page_count=${pages}`);
  let error;try{store.completeRunWithTurns(id,'RUNNING','COMPLETED',{result_text:'done',partial_text:null},'user','A'.repeat(2*1024*1024));}catch(e){error=e;}
  assert.ok(error);assert.match(String(error?.message||error),/database or disk is full/i);assert.equal(store.getRun(id).status,'RUNNING');assert.equal(store.getRun(id).result_text,null);assert.equal(store.listTurns(th.id).length,0);
});

test('Phase G storage fault: corrupt SQLite database fails closed and is never silently replaced',async()=>{
  const root=await tmp(),file=path.join(root,'bridge.sqlite'),garbage=crypto.randomBytes(4096);await fsp.writeFile(file,garbage);const before=crypto.createHash('sha256').update(garbage).digest('hex');
  const store=new Store(root);await assert.rejects(()=>store.init(),/database|file is not a database|malformed/i);const afterBuf=await fsp.readFile(file);const after=crypto.createHash('sha256').update(afterBuf).digest('hex');assert.equal(after,before);assert.deepEqual(afterBuf,garbage);
});

test('Phase G startup GC: pending WAITING_APPLY snapshot data is preserved across Core restart',async()=>{
  const root=await tmp(),store=await new Store(root).init(),p=store.createProject('P'),th=store.createThread(p.id,'T'),id=crypto.randomUUID(),snap=path.join(root,'run-data','pending','snapshot');await fsp.mkdir(snap,{recursive:true});await fsp.writeFile(path.join(snap,'KEEP.txt'),'pending-agent-data');
  store.createRun({id,requestId:`pending-${id}`,requestFingerprint:'fp',projectId:p.id,threadId:th.id,mode:'edit',status:'WAITING_APPLY',prompt:'edit',contextRevision:store.getProject(p.id).current_context_revision,workspaceRoot:path.join(root,'workspace'),workspaceId:'wid',snapshotDir:snap,manifestPath:path.join(snap,'manifest.json')});store.db.close();
  const core=await new BridgeCore({stateRoot:root,geminiEntry:FAKE}).init();assert.equal(core.store.getRun(id).status,'WAITING_APPLY');assert.equal(await fsp.readFile(path.join(snap,'KEEP.txt'),'utf8'),'pending-agent-data');core.store.db.close();
});
