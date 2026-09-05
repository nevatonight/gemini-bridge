import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildSnapshot, computeDiff } from '../src/snapshot.mjs';
import { BridgeCore } from '../src/core.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const FAKE=path.join(ROOT,'tests','fake-gemini.mjs');
async function tmp(prefix='gb-b-'){return await fsp.mkdtemp(path.join(os.tmpdir(),prefix));}
async function workspace(files={}){const d=await tmp(),ws=path.join(d,'w'),snap=path.join(d,'s');await fsp.mkdir(ws,{recursive:true});for(const [rel,data] of Object.entries(files)){const p=path.join(ws,...rel.split('/'));await fsp.mkdir(path.dirname(p),{recursive:true});await fsp.writeFile(p,data);}return {d,ws,snap};}

test('Phase B: service directory exclusions are case-insensitive and Agent output uses same rule',async()=>{
  const {ws,snap}=await workspace({'safe.txt':'ok','.GIT/config':'secret','.GeMiNi/state.txt':'secret'});
  const x=await buildSnapshot(ws,snap);assert.deepEqual(Object.keys(x.manifest.files),['safe.txt']);
  await fsp.mkdir(path.join(x.filesDir,'.GIT'),{recursive:true});await fsp.writeFile(path.join(x.filesDir,'.GIT','evil.txt'),'x');
  await assert.rejects(()=>computeDiff(snap),/SNAPSHOT_OUTPUT_BLOCKED/);
});

test('Phase B: source hardlinks are excluded and Agent-created hardlinks fail closed',async()=>{
  const {d,ws,snap}=await workspace({'safe.txt':'safe'});const outside=path.join(d,'outside.txt');await fsp.writeFile(outside,'linked');
  try{await fsp.link(outside,path.join(ws,'linked.txt'));}catch(e){if(['EPERM','EACCES','ENOTSUP'].includes(e.code))return;throw e;}
  const x=await buildSnapshot(ws,snap);assert.equal(x.manifest.files['linked.txt'],undefined);assert.ok(x.manifest.skipped.some(r=>r.path==='linked.txt'&&r.reason==='hardlink'));
  const source=path.join(x.filesDir,'safe.txt'),link=path.join(x.filesDir,'copy.txt');await fsp.link(source,link);
  await assert.rejects(()=>computeDiff(snap),/SNAPSHOT_HARDLINK_DETECTED/);
});

test('Phase B: invalid UTF-8 is never replacement-decoded before or after Gemini',async()=>{
  const {ws,snap}=await workspace({'safe.txt':'ok'});await fsp.writeFile(path.join(ws,'bad.txt'),Buffer.from([0x66,0x80,0x6f]));
  const x=await buildSnapshot(ws,snap);assert.equal(x.manifest.files['bad.txt'],undefined);assert.ok(x.manifest.skipped.some(r=>r.path==='bad.txt'&&r.reason==='invalid-utf8'));
  await fsp.writeFile(path.join(x.filesDir,'safe.txt'),Buffer.from([0x61,0x80,0x62]));
  await assert.rejects(()=>computeDiff(snap),/SNAPSHOT_INVALID_UTF8_BLOCKED/);
});

test('Phase B: high-confidence credential assignments and URL userinfo are filtered while placeholders survive',async()=>{
  const {ws,snap}=await workspace({
    'json.txt':'{"password":"supersecret123"}',
    'yaml.txt':'password: supersecret123',
    'toml.txt':'db_password = "supersecret123"',
    'aws.txt':'aws_secret_access_key: ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcd',
    'url.txt':'endpoint=https://user:password@example.com/',
    'env1.txt':'password: ${DB_PASSWORD}',
    'env2.txt':'password = %DB_PASSWORD%',
    'env3.txt':'password: <password>',
    'env4.txt':'password: changeme',
    'safe.txt':'ordinary text'
  });
  const x=await buildSnapshot(ws,snap);const kept=Object.keys(x.manifest.files).sort();
  assert.deepEqual(kept,['env1.txt','env2.txt','env3.txt','env4.txt','safe.txt']);
});

test('Phase B: credential filtering is repeated after Agent edits',async()=>{
  const {ws,snap}=await workspace({'safe.txt':'ok'});const x=await buildSnapshot(ws,snap,{mode:'edit'});
  await fsp.writeFile(path.join(x.filesDir,'safe.txt'),'db_password = "supersecret123"');
  await assert.rejects(()=>computeDiff(snap),/SNAPSHOT_SECRET_OUTPUT_BLOCKED/);
});

test('Phase B: Windows-reserved, colon, trailing-dot and trailing-space names are excluded portably',async()=>{
  const {ws,snap}=await workspace({'safe.txt':'ok'});
  for(const name of ['CON','aux.txt','bad:name.txt','trail.','space '])await fsp.writeFile(path.join(ws,name),'x');
  const x=await buildSnapshot(ws,snap);assert.deepEqual(Object.keys(x.manifest.files),['safe.txt']);
  for(const name of ['CON','bad:name.txt','trail.','space '])assert.ok(x.manifest.skipped.some(r=>r.path===name&&r.reason.startsWith('windows-unsafe-')),name);
});

test('Phase B: case-colliding paths fail closed on case-sensitive hosts too',async()=>{
  if(process.platform==='win32')return;
  const {ws,snap}=await workspace({'File.txt':'one','file.txt':'two'});
  await assert.rejects(()=>buildSnapshot(ws,snap),/WINDOWS_PATH_COLLISION/);
});

test('Phase B: Agent cannot transform an original file into a directory',async()=>{
  const {ws,snap}=await workspace({'a.txt':'alpha'});const x=await buildSnapshot(ws,snap,{mode:'edit'});
  await fsp.rm(path.join(x.filesDir,'a.txt'));await fsp.mkdir(path.join(x.filesDir,'a.txt'));await fsp.writeFile(path.join(x.filesDir,'a.txt','child.txt'),'x');
  await assert.rejects(()=>computeDiff(snap),/SNAPSHOT_TYPE_CHANGE_BLOCKED/);
});

test('Phase B: Agent cannot transform an original directory into a file',async()=>{
  const {ws,snap}=await workspace({'dir/a.txt':'alpha'});const x=await buildSnapshot(ws,snap,{mode:'edit'});
  await fsp.rm(path.join(x.filesDir,'dir'),{recursive:true});await fsp.writeFile(path.join(x.filesDir,'dir'),'replacement');
  await assert.rejects(()=>computeDiff(snap),/SNAPSHOT_TYPE_CHANGE_BLOCKED/);
});

test('Phase B: computeDiff rejects unsupported or malformed manifest schema before Apply',async()=>{
  const {ws,snap}=await workspace({'a.txt':'alpha'});await buildSnapshot(ws,snap,{mode:'edit'});const mf=path.join(snap,'manifest.json');
  const good=JSON.parse(await fsp.readFile(mf,'utf8'));await fsp.writeFile(mf,JSON.stringify({...good,version:999}));await assert.rejects(()=>computeDiff(snap),/SNAPSHOT_MANIFEST_VERSION_UNSUPPORTED/);
  await fsp.writeFile(mf,JSON.stringify({...good,files:{'a.txt':{hash:'bad',size:'1'}}}));await assert.rejects(()=>computeDiff(snap),/SNAPSHOT_MANIFEST_INVALID/);
});

test('Phase B: missing referenced project context revision is an integrity failure, never empty context',async()=>{
  const d=await tmp(),state=path.join(d,'state');const core=await new BridgeCore({stateRoot:state,geminiEntry:FAKE}).init();const p=core.createProject('P');
  const th=core.store.createThread(p.id,'manual');const id=crypto.randomUUID();
  core.store.createRun({id,requestId:'missing-context',requestFingerprint:'fp',projectId:p.id,threadId:th.id,mode:'ask',status:'QUEUED',prompt:'x',contextRevision:p.current_context_revision});
  core.store.db.prepare('DELETE FROM context_revisions WHERE project_id=? AND revision=?').run(p.id,p.current_context_revision);
  assert.throws(()=>core.store.getProject(p.id),/CONTEXT_REVISION_MISSING/);
  const r=core.store.getRun(id);assert.throws(()=>core.buildPayload(r),/CONTEXT_REVISION_MISSING/);
});
