import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fsp from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('Phase W: version probe has bounded settlement even when process-tree termination itself fails',async()=>{
  const s=await fsp.readFile(path.join(ROOT,'src','gemini.mjs'),'utf8');
  const block=s.slice(s.indexOf('async version('),s.indexOf('async run('));
  assert.match(block,/terminateProcessTree[\s\S]{0,500}(GEMINI_VERSION_TIMEOUT|finish\(reject)/);
  assert.match(block,/catch[\s\S]{0,300}GEMINI_VERSION_[A-Z_]*TERMINATION|GEMINI_VERSION_TIMEOUT_TERMINATION_FAILED/);
});

test('Phase W: snapshot re-proves directory/file realpath confinement before consuming workspace data',async()=>{
  const s=await fsp.readFile(path.join(ROOT,'src','snapshot.mjs'),'utf8');
  assert.match(s,/WORKSPACE_DIR_CHANGED_DURING_SNAPSHOT|WORKSPACE_PATH_CHANGED_DURING_SNAPSHOT/);
  assert.match(s,/async function proveDirectory\(abs,expected=null\)/);
  assert.match(s,/real=await fsp\.realpath\(abs\)/);
  assert.match(s,/!within\(source,real\)/);
  const walkStart=s.indexOf("async function walk(abs,rel='',depth=0,expected=null)");
  const walkEnd=s.indexOf('await walk(source)',walkStart);
  const walkBlock=s.slice(walkStart,walkEnd);
  const proofBefore=walkBlock.indexOf('before=await proveDirectory(abs,expected)');
  const readDir=walkBlock.indexOf('readdir(abs');
  const proofAfter=walkBlock.indexOf('await proveDirectory(abs,before)');
  assert.ok(proofBefore>=0 && readDir>proofBefore && proofAfter>readDir,'directory identity must be proved before and after readdir');
  const fileRead=s.slice(s.indexOf("fh=await fsp.open(child,'r')"),s.indexOf('checkCancel();if(looksBinary',s.indexOf("fh=await fsp.open(child,'r')")));
  assert.match(fileRead,/realpath\(child\)/);
  assert.match(fileRead,/within\(source/);
  assert.ok(fileRead.indexOf('realpath(child)') < fileRead.indexOf('fh.readFile()'),'realpath confinement proof must precede file content read');
});

test('Phase W: HTTP server has bounded body/header/request/connection resources',async()=>{
  const s=await fsp.readFile(path.join(ROOT,'src','host.mjs'),'utf8');
  assert.match(s,/MAX_BODY\s*=\s*1024\*1024/);
  assert.match(s,/createServer\(\{maxHeaderSize:/);
  assert.match(s,/server\.headersTimeout\s*=\s*\d+/);
  assert.match(s,/server\.requestTimeout\s*=\s*\d+/);
  assert.match(s,/server\.maxConnections\s*=\s*\d+/);
});
