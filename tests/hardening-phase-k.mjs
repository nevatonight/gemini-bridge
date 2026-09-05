import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {probeEntry} from '../src/managed-gemini-probe.mjs';
import {GeminiRunner} from '../src/gemini.mjs';
import {GEMINI_VERSION_PROBE_TIMEOUT_MS} from '../src/version-policy.mjs';
import {findFreePort} from '../src/runtime-config.mjs';

async function tmp(){return await fsp.mkdtemp(path.join(os.tmpdir(),'gb-k-'));}

async function waitExit(p,ms=10000){return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>finish(reject,new Error('PROCESS_TIMEOUT')),ms);const finish=(fn,v)=>{clearTimeout(timer);p.removeListener('exit',onExit);p.removeListener('error',onError);fn(v)};const onExit=(code,signal)=>finish(resolve,{code,signal});const onError=e=>finish(reject,e);p.once('exit',onExit);p.once('error',onError);});}

test('installer and Host share the same bounded version-probe policy', async()=>{
  assert.equal(GEMINI_VERSION_PROBE_TIMEOUT_MS,15000);
  const dir=await tmp();
  try{
    const entry=path.join(dir,'slow.mjs');
    await fsp.writeFile(entry,"if(process.argv.includes('--version'))setTimeout(()=>console.log('0.55.1'),250);\n");
    const pre=await probeEntry(process.execPath,entry,'0.55.1');
    assert.equal(pre.version,'0.55.1');
    const r=new GeminiRunner({stateRoot:path.join(dir,'state'),geminiEntry:entry,nodePath:process.execPath});await r.init();
    assert.equal(await r.version(),'0.55.1');
    const probeSrc=await fsp.readFile(path.resolve('src/managed-gemini-probe.mjs'),'utf8');
    const runnerSrc=await fsp.readFile(path.resolve('src/gemini.mjs'),'utf8');
    assert.match(probeSrc,/timeoutMs=GEMINI_VERSION_PROBE_TIMEOUT_MS/);
    assert.match(runnerSrc,/timeoutMs=GEMINI_VERSION_PROBE_TIMEOUT_MS/);
  }finally{await fsp.rm(dir,{recursive:true,force:true});}
});

test('Host runtime version normalization strips ANSI like installer probe', async()=>{
  const dir=await tmp();
  try{
    const entry=path.join(dir,'ansi.mjs');
    await fsp.writeFile(entry,"if(process.argv.includes('--version'))process.stdout.write('\\u001b[32m0.55.1\\u001b[0m\\r\\n');\n");
    const pre=await probeEntry(process.execPath,entry,'0.55.1');assert.equal(pre.version,'0.55.1');
    const r=new GeminiRunner({stateRoot:path.join(dir,'state'),geminiEntry:entry,nodePath:process.execPath});await r.init();assert.equal(await r.version(),'0.55.1');
  }finally{await fsp.rm(dir,{recursive:true,force:true});}
});

test('Host persists bounded startup diagnostic on runtime mismatch', async()=>{
  const dir=await tmp();
  try{
    const state=path.join(dir,'state');await fsp.mkdir(state,{recursive:true});
    const entry=path.join(dir,'bad.mjs');await fsp.writeFile(entry,"if(process.argv.includes('--version'))console.log('9.9.9');\n");
    const port=await findFreePort(39000);
    await fsp.writeFile(path.join(state,'runtime.json'),JSON.stringify({token:'a'.repeat(64),port,geminiEntry:entry,geminiVersion:'0.55.1'}));
    const p=spawn(process.execPath,[path.resolve('src/host.mjs')],{cwd:path.resolve('.'),env:{...process.env,GEMINI_BRIDGE_STATE:state},stdio:'ignore'});
    const ex=await waitExit(p,10000);assert.equal(ex.code,2);
    const diag=JSON.parse(await fsp.readFile(path.join(state,'host-startup-error.json'),'utf8'));
    assert.match(diag.error,/GEMINI_RUNTIME_NOT_READY:GEMINI_VERSION_MISMATCH/);
  }finally{await fsp.rm(dir,{recursive:true,force:true});}
});

test('Setup waits 30 seconds and reports Host startup diagnostic', async()=>{
  const s=await fsp.readFile(path.resolve('Setup.ps1'),'utf8');
  assert.match(s,/\$i -lt 300/);
  assert.match(s,/host-startup-error\.json/);
  assert.match(s,/Start-BridgeHost\(\[string\]\$node\\?\)\{Remove-Item[\s\S]*host-startup-error\.json/);
  assert.match(s,/New Host failed runtime health verification/);
  assert.match(s,/No startup diagnostic was produced/);
});
