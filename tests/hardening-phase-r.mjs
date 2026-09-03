import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ensureRuntimeConfig} from '../src/runtime-config.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const HOST=path.join(ROOT,'src','host.mjs'),FAKE=path.join(ROOT,'tests','fake-gemini.mjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function tmp(){return await fsp.mkdtemp(path.join(os.tmpdir(),'gb-r-'));}
async function req(cfg,method,url,body=null){return await new Promise((resolve,reject)=>{const data=body===null?null:Buffer.from(JSON.stringify(body));const h={'X-Gemini-Bridge-Token':cfg.token};if(data){h['Content-Type']='application/json';h['Content-Length']=data.length;}const r=http.request({host:'127.0.0.1',port:cfg.port,path:url,method,headers:h,timeout:1500},res=>{const cs=[];res.on('data',c=>cs.push(c));res.on('end',()=>{let b=null;try{b=JSON.parse(Buffer.concat(cs).toString())}catch{};resolve({status:res.statusCode,body:b});});});r.on('error',reject);r.on('timeout',()=>r.destroy(new Error('timeout')));if(data)r.end(data);else r.end();});}
async function wait(cfg,p){for(let i=0;i<100&&p.exitCode===null;i++){try{const r=await req(cfg,'GET','/v1/health');if(r.status===200)return true;}catch{}await sleep(25);}return false;}
async function kill(cfg,p){try{await req(cfg,'POST','/v1/shutdown',{});}catch{};for(let i=0;i<80&&p.exitCode===null;i++)await sleep(25);if(p.exitCode===null)try{p.kill('SIGKILL')}catch{}}
function beforeFirstAwait(src,startNeedle,endNeedle){const a=src.indexOf(startNeedle);assert.ok(a>=0,`missing ${startNeedle}`);const end=endNeedle?src.indexOf(endNeedle,a+startNeedle.length):src.length;const frag=src.slice(a,end>0?end:src.length);const firstAwait=frag.indexOf('await');const gate=frag.indexOf('send.disabled=true');assert.ok(firstAwait>=0,'handler has no await');assert.ok(gate>=0&&gate<firstAwait,'Send gate is not closed before first await');}

test('Phase R: resource routes reject extra path segments instead of overmatching handlers',async()=>{const d=await tmp(),state=path.join(d,'state'),cfg=await ensureRuntimeConfig(state);cfg.geminiEntry=FAKE;cfg.geminiVersion='0.55.1';await fsp.writeFile(path.join(state,'runtime.json'),JSON.stringify(cfg));const p=spawn(process.execPath,[HOST],{env:{...process.env,GEMINI_BRIDGE_STATE:state},stdio:'ignore'});try{assert.equal(await wait(cfg,p),true);const pr=(await req(cfg,'POST','/v1/projects',{name:'P'})).body.project;const cases=[['PATCH',`/v1/projects/${pr.id}/extra`,{}],['GET',`/v1/projects/${pr.id}/threads/extra`,null],['POST',`/v1/projects/${pr.id}/threads/extra`,{title:'T'}],['GET',`/v1/projects/${pr.id}/pending/extra`,null],['GET','/v1/threads/nope/turns/extra?limit=2',null],['GET','/v1/threads/nope/conversation/extra?limit=2',null],['GET','/v1/runs/nope/preview/extra',null],['POST','/v1/runs/nope/cancel/extra',{}],['POST','/v1/runs/nope/apply/extra',{}],['POST','/v1/runs/nope/discard/extra',{}],['POST','/v1/runs/nope/reconcile/extra',{}]];for(const [m,u,b] of cases){const r=await req(cfg,m,u,b);assert.equal(r.status,404,`${m} ${u} -> ${r.status} ${JSON.stringify(r.body)}`);assert.equal(r.body?.error,'NOT_FOUND',`${m} ${u} reached a real handler`);}}finally{await kill(cfg,p);}});

test('Phase R: Dashboard closes Send gate before any asynchronous preflight',async()=>{const s=await fsp.readFile(path.join(ROOT,'ui','app.js'),'utf8');beforeFirstAwait(s,'async function submitPrompt','send.onclick=');});

test('Phase R: extension closes Send gate before any asynchronous binding/preflight',async()=>{const s=await fsp.readFile(path.join(ROOT,'web-extension','content.js'),'utf8');beforeFirstAwait(s,'async function doSend','fab.onclick=');});

test('Phase R: unchanged uncertain retry reuses one request id in Dashboard and extension',async()=>{for(const rel of ['ui/app.js','web-extension/content.js']){const s=await fsp.readFile(path.join(ROOT,rel),'utf8');assert.match(s,/pendingSubmission|pendingRequest|submissionKey/i,`${rel} lacks retry state`);assert.match(s,/requestId[\s\S]{0,500}(reuse|pending|submission)|(?:reuse|pending|submission)[\s\S]{0,500}requestId/i,`${rel} lacks request-id reuse`);assert.ok((s.match(/crypto\.randomUUID\(\)/g)||[]).length>=1);}});
