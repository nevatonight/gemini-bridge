import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { GeminiRunner } from '../src/gemini.mjs';
import { probeEntry } from '../src/managed-gemini-probe.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function tmp(prefix='gb-pn-'){return await fsp.mkdtemp(path.join(os.tmpdir(),prefix));}
async function script(body){const d=await tmp(),file=path.join(d,'fake.mjs');await fsp.writeFile(file,body);return {d,file};}
async function runnerFor(file){const d=await tmp(),state=path.join(d,'state'),cwd=path.join(d,'cwd');await fsp.mkdir(cwd,{recursive:true});const runner=await new GeminiRunner({stateRoot:state,geminiEntry:file,nodePath:process.execPath}).init();return {d,state,cwd,runner};}

// Native version output is a protocol value, not free-form console text.
test('Phase N: Host version probe rejects extra stdout noise around an otherwise correct version',async()=>{
  const s=await script("if(process.argv.includes('--version')){console.log('noise');console.log('0.55.1');process.exit(0)}\n");const e=await runnerFor(s.file);
  await assert.rejects(()=>e.runner.version(),/GEMINI_VERSION_OUTPUT_INVALID|GEMINI_VERSION_MISMATCH/);
});

test('Phase N: installer version timeout preserves TIMEOUT as the primary cause',async()=>{
  const s=await script("if(process.argv.includes('--version'))setTimeout(()=>{},5000);\n");
  await assert.rejects(()=>probeEntry(process.execPath,s.file,'0.55.1',{timeoutMs:300}),e=>e.code==='GEMINI_VERSION_TIMEOUT');
});

test('Phase N: installer oversize version output preserves OUTPUT_TOO_LARGE as the primary cause',async()=>{
  const s=await script("if(process.argv.includes('--version'))process.stdout.write('x'.repeat(200000));\n");
  await assert.rejects(()=>probeEntry(process.execPath,s.file,'0.55.1'),e=>e.code==='GEMINI_VERSION_OUTPUT_TOO_LARGE');
});

test('Phase N: intermediate stream error diagnostic does not override a successful final result',async()=>{
  const s=await script("console.log(JSON.stringify({type:'error',severity:'warning',message:'recoverable warning'}));console.log(JSON.stringify({type:'result',status:'success',response:'done'}));\n");const e=await runnerFor(s.file);
  const out=await e.runner.run({mode:'ask',cwd:e.cwd,payload:'x'});assert.equal(out.text,'done');assert.match(out.diagnostics.join(' '),/recoverable warning/);
});

test('Phase N: terminal result failure remains fail-closed even after ordinary stream messages',async()=>{
  const s=await script("console.log(JSON.stringify({type:'message',role:'assistant',content:'partial'}));console.log(JSON.stringify({type:'result',status:'error',error:{message:'terminal'}}));\n");const e=await runnerFor(s.file);
  await assert.rejects(()=>e.runner.run({mode:'ask',cwd:e.cwd,payload:'x'}),/GEMINI_RESULT_ERROR/);
});

test('Phase N: realistic 20 MiB raw tool transcript is accepted when final output is small',async()=>{
  const s=await script("console.log(JSON.stringify({type:'tool_result',payload:'x'.repeat(20*1024*1024)}));console.log(JSON.stringify({type:'result',status:'success',response:'ok'}));\n");const e=await runnerFor(s.file);
  const out=await e.runner.run({mode:'review',cwd:e.cwd,payload:'x'});assert.equal(out.text,'ok');
});

test('Phase N: runaway raw transcript beyond 32 MiB still fails closed',async()=>{
  const s=await script("console.log(JSON.stringify({type:'tool_result',payload:'x'.repeat(34*1024*1024)}));console.log(JSON.stringify({type:'result',status:'success',response:'ok'}));\n");const e=await runnerFor(s.file);
  await assert.rejects(()=>e.runner.run({mode:'review',cwd:e.cwd,payload:'x'}),/GEMINI_RAW_STDOUT_TOO_LARGE/);
});

test('Phase N: Gemini invocation explicitly skips mutable Folder Trust for Bridge-owned cwd',async()=>{
  const s=await script("if(!process.argv.includes('--skip-trust'))process.exit(23);console.log(JSON.stringify({type:'result',status:'success',response:'trusted-by-bridge'}));\n");const e=await runnerFor(s.file);
  const out=await e.runner.run({mode:'edit',cwd:e.cwd,payload:'x'});assert.equal(out.text,'trusted-by-bridge');
});

test('Phase N: process-tree termination has one authoritative implementation and Core has no taskkill path',async()=>{
  const core=await fsp.readFile(path.join(ROOT,'src','core.mjs'),'utf8'),gemini=await fsp.readFile(path.join(ROOT,'src','gemini.mjs'),'utf8'),probe=await fsp.readFile(path.join(ROOT,'src','managed-gemini-probe.mjs'),'utf8');
  await fsp.access(path.join(ROOT,'src','process-control.mjs'));
  assert.doesNotMatch(core,/taskkill\.exe/);assert.doesNotMatch(gemini,/taskkill\.exe/);assert.doesNotMatch(probe,/\.kill\(\)/);
  assert.match(core,/process-control\.mjs/);assert.match(gemini,/process-control\.mjs/);assert.match(probe,/process-control\.mjs/);
});
