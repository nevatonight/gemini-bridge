import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {resolveManagedEntry,probeManagedPrefix,probeEntry} from '../src/managed-gemini-probe.mjs';
import {ensureRuntimeConfig,repairRuntimeConfig,findFreePort} from '../src/runtime-config.mjs';

const ROOT=path.resolve('.');
async function tmp(prefix='gb-l-'){return await fsp.mkdtemp(path.join(os.tmpdir(),prefix));}
async function fakePrefix({root=null,version='0.55.1',bin={gemini:'bundle/gemini.js'},output='0.55.1\r\n',exit=0,makeEntry=true}={}){
  const d=root||await tmp('gb-l-prefix-');const pkg=path.join(d,'node_modules','@google','gemini-cli');await fsp.mkdir(pkg,{recursive:true});
  await fsp.writeFile(path.join(pkg,'package.json'),JSON.stringify({name:'@google/gemini-cli',version,bin}));
  const rel=typeof bin==='string'?bin:bin?.gemini;
  if(makeEntry&&typeof rel==='string'&&!path.isAbsolute(rel)&&!rel.replace(/\\/g,'/').split('/').includes('..')){
    const e=path.join(pkg,...rel.replace(/\\/g,'/').split('/'));await fsp.mkdir(path.dirname(e),{recursive:true});
    await fsp.writeFile(e,`if(process.argv.includes('--version')){process.stdout.write(${JSON.stringify(output)});process.exit(${exit})}process.exit(91);\n`);
  }
  return d;
}
async function waitExit(p,ms=10000){return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>finish(reject,new Error('PROCESS_TIMEOUT')),ms);const finish=(fn,v)=>{clearTimeout(timer);p.removeListener('exit',onExit);p.removeListener('error',onError);fn(v)};const onExit=(code,signal)=>finish(resolve,{code,signal});const onError=e=>finish(reject,e);p.once('exit',onExit);p.once('error',onError);});}

// Exact Windows failure class from 0.4.2: native command stdout must never become a function return value.
test('Phase L: Setup captures winget output and keeps Antigravity path discovery scalar',async()=>{
  const s=await fsp.readFile(path.join(ROOT,'Setup.ps1'),'utf8');
  assert.match(s,/function Invoke-NativeLogged/);
  assert.match(s,/\$lines=@\(& \$exe @arguments 2>&1\);\$code=\$LASTEXITCODE/);
  assert.match(s,/\$r=Invoke-NativeLogged \$winget/);
  assert.match(s,/function Get-AntigravityCandidates/);
  assert.match(s,/function Find-UsableAntigravity/);
  assert.match(s,/\$out\+=@\(\$full\)/);
  assert.doesNotMatch(s,/;\s*& \$winget install/);
});

test('Phase L: Setup enforces one existing path value at Node Antigravity and runtime.json boundaries',async()=>{
  const s=await fsp.readFile(path.join(ROOT,'Setup.ps1'),'utf8');
  assert.match(s,/function Require-SinglePath/);
  assert.match(s,/refusing ambiguous\/native-output-contaminated path/);
  assert.match(s,/\$node=Require-SinglePath \(Ensure-Node\) 'Node executable'/);
  assert.match(s,/\$entry=Require-SinglePath \(Ensure-Antigravity \$node \$oldCfg\) 'Antigravity CLI entry' \$RuntimeBase/);
  assert.match(s,/Assert-RuntimeConfigPaths \$newCfg/);
  assert.match(s,/runtime\.json Antigravity entry/);
  assert.doesNotMatch(s,/Ensure-Gemini|@google\/gemini-cli@/);
});

test('Phase L: real upstream-style bundle/gemini.js metadata resolves in path containing spaces and Unicode',async()=>{
  const parent=await tmp('gb-l-unicode-');const d=path.join(parent,'Space Юникод runtime');await fsp.mkdir(d);
  try{await fakePrefix({root:d,bin:{gemini:'bundle/gemini.js'}});const r=await probeManagedPrefix(process.execPath,d,'0.55.1');assert.equal(r.version,'0.55.1');assert.equal(r.entry,path.join(d,'node_modules','@google','gemini-cli','bundle','gemini.js'));}
  finally{await fsp.rm(parent,{recursive:true,force:true});}
});

test('Phase L: alternate safe dist/index.js bin remains metadata-driven',async()=>{const d=await fakePrefix({bin:{gemini:'dist/index.js'}});try{assert.match(await resolveManagedEntry(d,'0.55.1'),/dist[\\/]index\.js$/);}finally{await fsp.rm(d,{recursive:true,force:true});}});
test('Phase L: string-form npm bin metadata remains supported',async()=>{const d=await fakePrefix({bin:'bundle/gemini.js'});try{assert.match(await resolveManagedEntry(d,'0.55.1'),/bundle[\\/]gemini\.js$/);}finally{await fsp.rm(d,{recursive:true,force:true});}});
test('Phase L: missing gemini bin metadata fails closed',async()=>{const d=await fakePrefix({bin:{other:'x.js'},makeEntry:false});try{await assert.rejects(()=>resolveManagedEntry(d,'0.55.1'),e=>e.code==='GEMINI_PACKAGE_BIN_MISSING');}finally{await fsp.rm(d,{recursive:true,force:true});}});
test('Phase L: absolute npm bin metadata fails closed',async()=>{const d=await fakePrefix({bin:{gemini:path.resolve('/tmp/evil.js')},makeEntry:false});try{await assert.rejects(()=>resolveManagedEntry(d,'0.55.1'),e=>e.code==='GEMINI_PACKAGE_BIN_UNSAFE');}finally{await fsp.rm(d,{recursive:true,force:true});}});
test('Phase L: traversal npm bin metadata fails closed',async()=>{const d=await fakePrefix({bin:{gemini:'../evil.js'},makeEntry:false});try{await assert.rejects(()=>resolveManagedEntry(d,'0.55.1'),e=>e.code==='GEMINI_PACKAGE_BIN_UNSAFE');}finally{await fsp.rm(d,{recursive:true,force:true});}});
test('Phase L: missing declared entry fails closed',async()=>{const d=await fakePrefix({makeEntry:false});try{await assert.rejects(()=>resolveManagedEntry(d,'0.55.1'),e=>e.code==='GEMINI_PACKAGE_BIN_NOT_FOUND');}finally{await fsp.rm(d,{recursive:true,force:true});}});
test('Phase L: declared bin directory fails closed',async()=>{const d=await fakePrefix({makeEntry:false});const e=path.join(d,'node_modules','@google','gemini-cli','bundle','gemini.js');await fsp.mkdir(e,{recursive:true});try{await assert.rejects(()=>resolveManagedEntry(d,'0.55.1'),x=>x.code==='GEMINI_PACKAGE_BIN_NOT_FILE');}finally{await fsp.rm(d,{recursive:true,force:true});}});

test('Phase L: symlinked declared bin fails closed instead of following outside package',async()=>{const d=await fakePrefix({makeEntry:false});const pkg=path.join(d,'node_modules','@google','gemini-cli'),outside=path.join(d,'outside.mjs'),e=path.join(pkg,'bundle','gemini.js');await fsp.mkdir(path.dirname(e),{recursive:true});await fsp.writeFile(outside,"console.log('0.55.1')");try{await fsp.symlink(outside,e);await assert.rejects(()=>resolveManagedEntry(d,'0.55.1'),x=>x.code==='GEMINI_PACKAGE_BIN_SYMLINK'||x.code==='GEMINI_PACKAGE_BIN_REALPATH_ESCAPED');}finally{await fsp.rm(d,{recursive:true,force:true});}});
test('Phase L: package metadata version mismatch fails before CLI execution',async()=>{const d=await fakePrefix({version:'0.55.2'});try{await assert.rejects(()=>probeManagedPrefix(process.execPath,d,'0.55.1'),e=>e.code==='GEMINI_PACKAGE_VERSION_MISMATCH');}finally{await fsp.rm(d,{recursive:true,force:true});}});

test('Phase L: exact version parser accepts CRLF/ANSI but rejects extra stdout noise',async()=>{
  const d=await tmp();try{const good=path.join(d,'good.mjs'),bad=path.join(d,'bad.mjs');await fsp.writeFile(good,"process.stdout.write('\\x1b[32mv0.55.1\\x1b[0m\\r\\n')");await fsp.writeFile(bad,"console.log('npm noise'); console.log('0.55.1')");assert.equal((await probeEntry(process.execPath,good,'0.55.1')).version,'0.55.1');await assert.rejects(()=>probeEntry(process.execPath,bad,'0.55.1'),e=>e.code==='GEMINI_VERSION_OUTPUT_INVALID');}finally{await fsp.rm(d,{recursive:true,force:true});}
});
test('Phase L: version timeout remains bounded',async()=>{const d=await tmp();try{const e=path.join(d,'slow.mjs');await fsp.writeFile(e,"setTimeout(()=>console.log('0.55.1'),2000)");await assert.rejects(()=>probeEntry(process.execPath,e,'0.55.1',{timeoutMs:300}),x=>x.code==='GEMINI_VERSION_TIMEOUT');}finally{await fsp.rm(d,{recursive:true,force:true});}});
test('Phase L: oversized version stdout fails closed',async()=>{const d=await tmp();try{const e=path.join(d,'big.mjs');await fsp.writeFile(e,"process.stdout.write('x'.repeat(70000))");await assert.rejects(()=>probeEntry(process.execPath,e,'0.55.1'),x=>x.code==='GEMINI_VERSION_OUTPUT_TOO_LARGE');}finally{await fsp.rm(d,{recursive:true,force:true});}});
test('Phase L: non-zero version process preserves bounded diagnostic',async()=>{const d=await tmp();try{const e=path.join(d,'bad.mjs');await fsp.writeFile(e,"console.error('windows-startup-detail');process.exit(7)");await assert.rejects(()=>probeEntry(process.execPath,e,'0.55.1'),x=>x.code==='GEMINI_VERSION_EXIT_NONZERO'&&x.detail.includes('windows-startup-detail'));}finally{await fsp.rm(d,{recursive:true,force:true});}});

test('Phase L: runtime config rejects stdout-contaminated relative Node/Gemini paths',async()=>{
  for(const field of ['nodePath','geminiEntry']){const d=await tmp(),state=path.join(d,'state');await fsp.mkdir(state);const port=await findFreePort(40100);const cfg={token:'a'.repeat(64),port,[field]:`added 5 packages in 2m ${path.join(d,'fake.js')}`};await fsp.writeFile(path.join(state,'runtime.json'),JSON.stringify(cfg));try{await assert.rejects(()=>ensureRuntimeConfig(state),new RegExp(field==='nodePath'?'RUNTIME_CONFIG_INVALID_NODE_PATH':'RUNTIME_CONFIG_INVALID_GEMINI_ENTRY'));}finally{await fsp.rm(d,{recursive:true,force:true});}}
});


test('Phase L: setup-runtime repair treats contaminated managed paths as corrupt and regenerates safe base config',async()=>{const d=await tmp(),state=path.join(d,'state');await fsp.mkdir(state);const bad={token:'a'.repeat(64),port:38473,geminiEntry:'added 5 packages in 2m C:\\bad\\gemini.js',nodePath:'noise C:\\Program Files\\nodejs\\node.exe',geminiVersion:'0.55.1'};await fsp.writeFile(path.join(state,'runtime.json'),JSON.stringify(bad));try{const fixed=await repairRuntimeConfig(state);assert.match(fixed.token,/^[a-f0-9]{64}$/);assert.equal(typeof fixed.port,'number');assert.equal(fixed.geminiEntry,undefined);assert.equal(fixed.nodePath,undefined);const names=await fsp.readdir(state);assert.ok(names.some(n=>n.startsWith('runtime.corrupt-')&&n.endsWith('.json')));}finally{await fsp.rm(d,{recursive:true,force:true});}});
test('Phase L: Host persists diagnostic when runtime.json path validation fails before bind',async()=>{
  const d=await tmp(),state=path.join(d,'state');await fsp.mkdir(state);const port=await findFreePort(40200);await fsp.writeFile(path.join(state,'runtime.json'),JSON.stringify({token:'a'.repeat(64),port,geminiEntry:'added 5 packages in 2m C:\\bad\\gemini.js',geminiVersion:'0.55.1'}));
  try{const p=spawn(process.execPath,[path.join(ROOT,'src','host.mjs')],{env:{...process.env,GEMINI_BRIDGE_STATE:state},stdio:'ignore'});const ex=await waitExit(p);assert.equal(ex.code,2);const diag=JSON.parse(await fsp.readFile(path.join(state,'host-startup-error.json'),'utf8'));assert.match(diag.error,/RUNTIME_CONFIG_STARTUP_FAILED:RUNTIME_CONFIG_INVALID_GEMINI_ENTRY/);}finally{await fsp.rm(d,{recursive:true,force:true});}
});

test('Phase L: Host persists explicit bind diagnostic for port race/collision',async()=>{
  const d=await tmp(),state=path.join(d,'state');await fsp.mkdir(state);const holder=net.createServer();await new Promise((resolve,reject)=>{holder.once('error',reject);holder.listen({host:'127.0.0.1',port:0},resolve)});const port=holder.address().port;const entry=path.join(d,'v.mjs');await fsp.writeFile(entry,"console.log('0.55.1')");await fsp.writeFile(path.join(state,'runtime.json'),JSON.stringify({token:'a'.repeat(64),port,geminiEntry:entry,geminiVersion:'0.55.1'}));
  try{const p=spawn(process.execPath,[path.join(ROOT,'src','host.mjs')],{env:{...process.env,GEMINI_BRIDGE_STATE:state},stdio:'ignore'});const ex=await waitExit(p);assert.equal(ex.code,2);const diag=JSON.parse(await fsp.readFile(path.join(state,'host-startup-error.json'),'utf8'));assert.match(diag.error,/HOST_LISTEN_FAILED:EADDRINUSE/);}finally{await new Promise(r=>holder.close(r));await fsp.rm(d,{recursive:true,force:true});}
});
