import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {GeminiRunner} from '../src/gemini.mjs';

const ROOT=path.resolve('.');
async function tmp(){return await fsp.mkdtemp(path.join(os.tmpdir(),'gb-aj-'));}
async function authFake(dir){
  const file=path.join(dir,'agy-auth-fake');
  const source=`#!/usr/bin/env node\nimport fsp from 'node:fs/promises';import path from 'node:path';\nconst args=process.argv.slice(2);if(args.includes('--version')){console.log('1.2.3');process.exit(0)}if(args[0]==='models'){process.exit(7)}\nprocess.stdout.write('Browser opened. Paste authorization code: ');let input='';for await(const c of process.stdin){input+=c;if(input.includes('\\n'))break;}\nawait fsp.writeFile(path.join(process.cwd(),'.auth-received'),input.trim());process.exit(input.trim()?0:9);\n`;
  await fsp.writeFile(file,source);await fsp.chmod(file,0o755);return file;
}

async function wait(fn,timeout=2500){const end=Date.now()+timeout;while(Date.now()<end){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,20));}return null;}

test('Phase AJ: Bridge-owned auth process accepts the one-time Google code over child stdin',async()=>{
  const d=await tmp();try{const entry=await authFake(d),state=path.join(d,'state'),r=await new GeminiRunner({stateRoot:state,geminiEntry:entry}).init();const out=await r.launchInteractiveAuth();assert.equal(out.method,'bridge-code');assert.equal(out.requiresCode,true);assert.equal(r.authSessionStatus().status,'awaiting-code');await r.submitInteractiveAuthCode('test-one-time-code_123');assert.equal(r.authSessionStatus().status,'verifying');assert.equal(await wait(async()=>{try{return await fsp.readFile(path.join(state,'auth-empty','.auth-received'),'utf8')}catch{return null}}),'test-one-time-code_123');assert.ok(await wait(()=>r.authSessionStatus().status==='complete'));}finally{await fsp.rm(d,{recursive:true,force:true});}
});

test('Phase AJ: auth codes are bounded, single-submit, and never returned by session status',async()=>{
  const d=await tmp();let r=null;try{const entry=await authFake(d);r=await new GeminiRunner({stateRoot:path.join(d,'state'),geminiEntry:entry}).init();await r.launchInteractiveAuth();await assert.rejects(()=>r.submitInteractiveAuthCode('short'),/AUTH_CODE_INVALID/);const secret='another-one-time-code_456';await r.submitInteractiveAuthCode(secret);assert.doesNotMatch(JSON.stringify(r.authSessionStatus()),new RegExp(secret));await assert.rejects(()=>r.submitInteractiveAuthCode(secret),/AUTH_CODE_ALREADY_SUBMITTED|AUTH_SESSION_NOT_ACTIVE/);}finally{await r?.cancelInteractiveAuth?.().catch(()=>{});await fsp.rm(d,{recursive:true,force:true});}
});

test('Phase AJ: cancelling auth terminates the Bridge-owned child and clears writable session',async()=>{
  const d=await tmp();try{const entry=await authFake(d),r=await new GeminiRunner({stateRoot:path.join(d,'state'),geminiEntry:entry}).init();await r.launchInteractiveAuth();assert.equal((await r.cancelInteractiveAuth()).cancelled,true);assert.equal(r.authSessionStatus().status,'cancelled');await assert.rejects(()=>r.submitInteractiveAuthCode('valid-enough-code'),/AUTH_SESSION_NOT_ACTIVE/);}finally{await fsp.rm(d,{recursive:true,force:true});}
});

test('Phase AJ: Host exposes token-gated start/code/session/cancel auth routes',async()=>{const s=await fsp.readFile(path.join(ROOT,'src/host.mjs'),'utf8');const gate=s.indexOf('if(!auth(req))');for(const route of ["/v1/auth/start","/v1/auth/code","/v1/auth/session","/v1/auth/cancel"])assert.ok(s.indexOf(route)>gate,route);assert.match(s,/submitInteractiveAuthCode/);assert.match(s,/cancelInteractiveAuth/);});

test('Phase AJ: Dashboard owns the OAuth code handoff instead of sending the user to a terminal',async()=>{const html=await fsp.readFile(path.join(ROOT,'ui/index.html'),'utf8'),js=await fsp.readFile(path.join(ROOT,'ui/app.js'),'utf8');assert.match(html,/id="authDialog"/);assert.match(html,/id="authCode"/);assert.match(html,/id="submitAuthCode"/);assert.match(js,/api\('\/v1\/auth\/code'/);assert.match(js,/authCode\.value=''/);assert.doesNotMatch(js,/Gemini Bridge · Google sign-in/);});

test('Phase AJ: production auth implementation does not persist or log the submitted code',async()=>{const s=await fsp.readFile(path.join(ROOT,'src/gemini.mjs'),'utf8');const block=s.slice(s.indexOf('async submitInteractiveAuthCode'),s.indexOf('async run({mode'));assert.doesNotMatch(block,/writeFile|writeJson|console\.|appendBounded/);assert.match(block,/p\.stdin\.write/);});
