import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {resolveManagedEntry,probeManagedPrefix,probeEntry} from '../src/managed-gemini-probe.mjs';

async function tmp(){return fsp.mkdtemp(path.join(os.tmpdir(),'gb-phase-j-'));}
async function fakePackage({version='0.55.1',bin={gemini:'dist/index.js'},output='0.55.1',exit=0}={}){
  const d=await tmp(),pkg=path.join(d,'node_modules','@google','gemini-cli');await fsp.mkdir(pkg,{recursive:true});
  await fsp.writeFile(path.join(pkg,'package.json'),JSON.stringify({name:'@google/gemini-cli',version,bin}));
  const rel=typeof bin==='string'?bin:bin.gemini;
  if(rel&&!rel.includes('..')&&!path.isAbsolute(rel)){const e=path.join(pkg,...rel.replace(/\\/g,'/').split('/'));await fsp.mkdir(path.dirname(e),{recursive:true});await fsp.writeFile(e,`if(process.argv.includes('--version')){process.stdout.write(${JSON.stringify(output)});process.exit(${exit})}process.exit(91);\n`);}
  return d;
}
function runCli(args){return new Promise((resolve,reject)=>{const p=spawn(process.execPath,[new URL('../src/managed-gemini-probe.mjs',import.meta.url).pathname,...args],{stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('close',code=>resolve({code,out,err}));});}

test('Phase J: resolves npm-declared dist bin instead of assuming a hard-coded entry path',async()=>{const d=await fakePackage();assert.equal(await resolveManagedEntry(d,'0.55.1'),path.join(d,'node_modules','@google','gemini-cli','dist','index.js'));});
test('Phase J: accepts bundled npm entrypoint declared by package metadata',async()=>{const d=await fakePackage({bin:{gemini:'bundle/gemini.js'}});const r=await probeManagedPrefix(process.execPath,d,'0.55.1');assert.equal(r.version,'0.55.1');assert.match(r.entry,/bundle[\\/]gemini\.js$/);});
test('Phase J: supports string-form package bin metadata',async()=>{const d=await fakePackage({bin:'bundle/gemini.js'});assert.match(await resolveManagedEntry(d,'0.55.1'),/bundle[\\/]gemini\.js$/);});
test('Phase J: rejects package metadata version drift even when CLI output claims expected version',async()=>{const d=await fakePackage({version:'0.56.0'});await assert.rejects(()=>probeManagedPrefix(process.execPath,d,'0.55.1'),e=>e.code==='GEMINI_PACKAGE_VERSION_MISMATCH');});
test('Phase J: rejects unsafe npm bin traversal',async()=>{const d=await fakePackage({bin:{gemini:'../evil.js'}});await assert.rejects(()=>resolveManagedEntry(d,'0.55.1'),e=>e.code==='GEMINI_PACKAGE_BIN_UNSAFE');});
test('Phase J: exact version probe accepts optional v prefix and ANSI wrapping only',async()=>{const d=await tmp(),e=path.join(d,'v.mjs');await fsp.writeFile(e,"console.log('\\x1b[32mv0.55.1\\x1b[0m')");const r=await probeEntry(process.execPath,e,'0.55.1');assert.equal(r.version,'0.55.1');});
test('Phase J: exact version probe rejects mismatched real output',async()=>{const d=await tmp(),e=path.join(d,'v.mjs');await fsp.writeFile(e,"console.log('0.56.0')");await assert.rejects(()=>probeEntry(process.execPath,e,'0.55.1'),x=>x.code==='GEMINI_VERSION_MISMATCH');});
test('Phase J: exact version probe rejects non-zero CLI with bounded diagnostic',async()=>{const d=await tmp(),e=path.join(d,'v.mjs');await fsp.writeFile(e,"console.error('real-startup-failure');process.exit(7)");await assert.rejects(()=>probeEntry(process.execPath,e,'0.55.1'),x=>x.code==='GEMINI_VERSION_EXIT_NONZERO'&&x.detail.includes('real-startup-failure'));});
test('Phase J: probe CLI returns structured diagnostic rather than opaque boolean failure',async()=>{const d=await fakePackage({output:'0.56.0'});const r=await runCli(['--prefix',d,'--expected','0.55.1']);assert.equal(r.code,1);const j=JSON.parse(r.out);assert.equal(j.ok,false);assert.equal(j.error,'GEMINI_VERSION_MISMATCH');assert.match(j.detail,/actual/);});
