import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../src/store.mjs';
import {offlineStateCheck} from '../src/offline-check.mjs';
async function tmp(prefix='gb-t-'){return await fsp.mkdtemp(path.join(os.tmpdir(),prefix));}
async function validState(){const root=await tmp();const store=await new Store(root).init();const p=store.createProject('P');const th=store.createThread(p.id,'T');store.db.close();return {root,p,th,file:path.join(root,'bridge.sqlite')};}

test('Phase T: offline upgrade rejects tables that exist but are missing required columns',async()=>{const root=await tmp(),file=path.join(root,'bridge.sqlite');const db=new DatabaseSync(file);db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY);CREATE TABLE context_revisions(project_id TEXT,revision INTEGER);CREATE TABLE threads(id TEXT);CREATE TABLE runs(id TEXT,status TEXT);CREATE TABLE turns(id TEXT);CREATE TABLE settings(key TEXT);`);db.close();const r=await offlineStateCheck(root);assert.equal(r.ok,false);assert.match(r.error,/SCHEMA.*COLUMN|COLUMN.*MISSING/i);});

test('Phase T: offline upgrade rejects dangling SQLite foreign keys',async()=>{const e=await validState();const db=new DatabaseSync(e.file);db.exec('PRAGMA foreign_keys=OFF');db.prepare("INSERT INTO threads(id,project_id,title,created_at,updated_at) VALUES('dangling','missing','x','x','x')").run();db.close();const r=await offlineStateCheck(e.root);assert.equal(r.ok,false);assert.match(r.error,/FOREIGN_KEY/i);});

test('Phase T: Host Store startup rejects existing FK-corrupt state',async()=>{const e=await validState();const db=new DatabaseSync(e.file);db.exec('PRAGMA foreign_keys=OFF');db.prepare("INSERT INTO threads(id,project_id,title,created_at,updated_at) VALUES('dangling','missing','x','x','x')").run();db.close();await assert.rejects(()=>new Store(e.root).init(),/FOREIGN_KEY/i);});

test('Phase T: project row and initial context revision are one atomic transaction',async()=>{const root=await tmp(),store=await new Store(root).init();store.db.exec("CREATE TRIGGER fail_initial_context BEFORE INSERT ON context_revisions BEGIN SELECT RAISE(ABORT,'simulated context fault'); END;");await assert.rejects(async()=>store.createProject('Half'));const n=store.db.prepare('SELECT COUNT(*) n FROM projects').get().n;assert.equal(n,0);store.db.close();});

test('Phase T: semantic integrity rejects run bound to a thread from another project',async()=>{const root=await tmp(),store=await new Store(root).init(),p1=store.createProject('P1'),p2=store.createProject('P2'),th2=store.createThread(p2.id,'T2');store.createRun({id:'cross',requestId:'cross',requestFingerprint:'fp',projectId:p1.id,threadId:th2.id,mode:'ask',status:'COMPLETED',prompt:'x',contextRevision:p1.current_context_revision});store.db.close();const r=await offlineStateCheck(root);assert.equal(r.ok,false);assert.match(r.error,/SEMANTIC|STATE_RELATION/i);});

test('Phase T: semantic integrity rejects workspace/workspace_id half-pairs',async()=>{const e=await validState();const db=new DatabaseSync(e.file);db.prepare('UPDATE projects SET workspace=?, workspace_id=NULL WHERE id=?').run('/tmp/example',e.p.id);db.close();const r=await offlineStateCheck(e.root);assert.equal(r.ok,false);assert.match(r.error,/SEMANTIC|WORKSPACE/i);});

test('Phase T: Store and offline check reject symlinked bridge.sqlite outside state root',async()=>{const d=await tmp(),outside=path.join(d,'outside'),state=path.join(d,'state');await fsp.mkdir(outside);await fsp.mkdir(state);const s=await new Store(outside).init();s.createProject('outside');s.db.close();await fsp.symlink(path.join(outside,'bridge.sqlite'),path.join(state,'bridge.sqlite'));const r=await offlineStateCheck(state);assert.equal(r.ok,false);assert.match(r.error,/UNSAFE|SYMLINK|REPARSE/i);await assert.rejects(()=>new Store(state).init(),/UNSAFE|SYMLINK|REPARSE/i);});
