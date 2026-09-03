import http from 'node:http';
import { stateRoot, readJson } from './utils.mjs';
import { ensureRuntimeConfig, repairRuntimeConfig } from './runtime-config.mjs';
import path from 'node:path';
import { offlineStateCheck } from './offline-check.mjs';
import { hasGeminiCredentials, geminiCredentialFile } from './auth-state.mjs';

const cmd=process.argv[2]||'help';const root=stateRoot();
async function request(method,p,body=null){const cfg=await ensureRuntimeConfig(root);return await new Promise((resolve,reject)=>{const data=body?Buffer.from(JSON.stringify(body)):null;const r=http.request({host:'127.0.0.1',port:cfg.port,path:p,method,headers:{'X-Gemini-Bridge-Token':cfg.token,...(data?{'Content-Type':'application/json','Content-Length':data.length}:{})}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{let j={};try{j=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{};if(res.statusCode>=400)reject(new Error(j.error||`HTTP_${res.statusCode}`));else resolve(j);});});r.on('error',reject);if(data)r.write(data);r.end();});}
if(cmd==='init'){console.log(JSON.stringify(await ensureRuntimeConfig(root)));}
else if(cmd==='setup-runtime'){console.log(JSON.stringify(await repairRuntimeConfig(root)));}
else if(cmd==='health'){try{console.log(JSON.stringify(await request('GET','/v1/health'),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
else if(cmd==='shutdown'){try{console.log(JSON.stringify(await request('POST','/v1/shutdown',{}),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
else if(cmd==='offline-check'){const out=await offlineStateCheck(root);console.log(JSON.stringify(out));if(!out.ok)process.exitCode=2;}
else if(cmd==='auth-status'){const present=await hasGeminiCredentials(root);console.log(JSON.stringify({present,file:geminiCredentialFile(root)}));}
else{console.log('Gemini Bridge CLI: init | setup-runtime | health | shutdown | offline-check | auth-status');}
