import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fsp from 'node:fs/promises';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('Phase U: closing a tab deletes its tab-local binding so reused tab IDs cannot inherit a conversation',async()=>{
  const code=await fsp.readFile(path.join(ROOT,'web-extension','background.js'),'utf8');const data={'gb-binding:42':{route:'https://chatgpt.com/c/old',binding:{projectId:'p',threadId:'t'}}};let removedListener=null;
  const chrome={storage:{session:{get:async keys=>Object.fromEntries(keys.filter(k=>k in data).map(k=>[k,data[k]])),set:async obj=>Object.assign(data,obj),remove:async key=>{for(const k of Array.isArray(key)?key:[key])delete data[k];}}},runtime:{onMessage:{addListener(){}}},tabs:{onRemoved:{addListener(fn){removedListener=fn;}}}};
  vm.runInNewContext(code,{importScripts(){},GB_PORT:38473,GB_TOKEN:'a'.repeat(64),chrome,fetch:async()=>{throw new Error('unused')},AbortController,setTimeout,clearTimeout,console});
  assert.equal(typeof removedListener,'function');await removedListener(42,{isWindowClosing:false});assert.equal(data['gb-binding:42'],undefined);
});

test('Phase U: tab cleanup does not expand extension permissions beyond storage',async()=>{const m=JSON.parse(await fsp.readFile(path.join(ROOT,'web-extension','manifest.json'),'utf8'));assert.deepEqual(m.permissions,['storage']);});
