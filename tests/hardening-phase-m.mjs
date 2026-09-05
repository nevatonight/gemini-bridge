import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { BridgeCore } from '../src/core.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const FAKE=path.join(ROOT,'tests','fake-gemini.mjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function tmp(prefix='gb-pm-'){return await fsp.mkdtemp(path.join(os.tmpdir(),prefix));}
async function makeEditCore(){
  const d=await tmp(),state=path.join(d,'state'),ws=path.join(d,'workspace');
  await fsp.mkdir(ws,{recursive:true});await fsp.writeFile(path.join(ws,'a.txt'),'before');
  const core=await new BridgeCore({stateRoot:state,geminiEntry:FAKE}).init();
  const p=core.createProject('P');await core.updateProject(p.id,{workspace:ws});
  const out=await core.startRun({projectId:p.id,mode:'edit',prompt:'TEST_EDIT a.txt => after',requestId:'edit-'+Math.random()});
  const end=Date.now()+5000;let run;
  while(Date.now()<end){run=core.getRun(out.run.id);if(run.status==='WAITING_APPLY')break;await sleep(15);}
  assert.equal(run?.status,'WAITING_APPLY');
  return {d,state,ws,core,run};
}

for(const operation of ['apply','reconcile','discard']){
  test(`Phase M: maintenance blocks new ${operation} management action`,async()=>{
    const e=await makeEditCore();e.core.setMaintenance(true);
    const fn=operation==='apply'?()=>e.core.applyRun(e.run.id):operation==='reconcile'?()=>e.core.reconcileRun(e.run.id):()=>e.core.discardRun(e.run.id);
    await assert.rejects(fn,/HOST_MAINTENANCE/);
    assert.equal(e.core.getRun(e.run.id).status,'WAITING_APPLY');
  });
}

test('Phase M: upgrade readiness remains false while a management lock is active',async()=>{
  const e=await makeEditCore();
  const raw=e.core.store.getRun(e.run.id);const lock=e.core.acquireManagement(raw,'apply');e.core.setMaintenance(true);
  try{
    const r=e.core.upgradeReadiness();assert.equal(r.ok,false);assert.equal(r.managementOperations,1);
  }finally{e.core.releaseManagement(lock);}
});

for(const operation of ['apply','reconcile','discard']){
  test(`Phase M: direct shutdown waits for an already-started ${operation} operation`,async()=>{
    const e=await makeEditCore();const raw=e.core.store.getRun(e.run.id);const lock=e.core.acquireManagement(raw,operation);
    let settled=false;const stopping=e.core.shutdownActive({timeoutMs:1000}).then(()=>{settled=true;});
    await sleep(80);assert.equal(settled,false,'shutdown returned while management operation was still active');
    e.core.releaseManagement(lock);await stopping;assert.equal(settled,true);
  });
}

test('Phase M: host shutdown route establishes maintenance before asynchronous shutdown starts',async()=>{
  const host=await fsp.readFile(path.join(ROOT,'src','host.mjs'),'utf8');
  const route=host.slice(host.indexOf("u.pathname==='/v1/shutdown'"),host.indexOf("return json(res,404"));
  const maintenance=route.indexOf('setMaintenance(true)');
  const response=route.indexOf('json(res,200');
  const asyncShutdown=route.indexOf("shutdown('api')");
  assert.ok(maintenance>=0&&response>maintenance&&asyncShutdown>response,'shutdown route must close the maintenance gate before acknowledging shutdown');
});
