import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {GEMINI_VERSION_PROBE_TIMEOUT_MS,parseExactGeminiVersionOutput} from './version-policy.mjs';
import {terminateProcessTree} from './process-control.mjs';

function fail(code,detail=''){const e=new Error(code);e.code=code;e.detail=String(detail||'').slice(-2000);throw e;}
export function compareSemver(actual,minimum){
  const a=String(actual).replace(/^v/,'').split(/[+-]/)[0].split('.').map(Number),b=String(minimum).replace(/^v/,'').split(/[+-]/)[0].split('.').map(Number);
  if(a.length!==3||b.length!==3||a.some(Number.isNaN)||b.some(Number.isNaN))return null;
  for(let i=0;i<3;i++){if(a[i]>b[i])return 1;if(a[i]<b[i])return -1;}return 0;
}
export async function probeAntigravityEntry(entry,{minimum='1.1.20',expected=null,timeoutMs=GEMINI_VERSION_PROBE_TIMEOUT_MS}={}){
  if(typeof entry!=='string'||!path.isAbsolute(entry))fail('ANTIGRAVITY_ENTRY_INVALID');
  const out=await new Promise((resolve,reject)=>{
    const p=spawn(entry,['--version'],{stdio:['ignore','pipe','pipe'],windowsHide:true,shell:false});let stdout='',stderr='',settled=false;let timer;
    const finish=(fn,v)=>{if(settled)return;settled=true;clearTimeout(timer);fn(v)};
    timer=setTimeout(()=>{terminateProcessTree(p).catch(()=>{}).finally(()=>finish(reject,Object.assign(new Error('ANTIGRAVITY_VERSION_TIMEOUT'),{code:'ANTIGRAVITY_VERSION_TIMEOUT'})));},timeoutMs);
    p.stdout.on('data',b=>{stdout+=b;if(Buffer.byteLength(stdout)>65536){terminateProcessTree(p).catch(()=>{});finish(reject,Object.assign(new Error('ANTIGRAVITY_VERSION_OUTPUT_TOO_LARGE'),{code:'ANTIGRAVITY_VERSION_OUTPUT_TOO_LARGE'}));}});
    p.stderr.on('data',b=>{stderr=(stderr+b).slice(-65536)});
    p.once('error',e=>finish(reject,Object.assign(new Error('ANTIGRAVITY_NOT_AVAILABLE'),{code:'ANTIGRAVITY_NOT_AVAILABLE',detail:String(e.message||e)})));
    p.once('close',code=>{if(settled)return;if(code!==0)return finish(reject,Object.assign(new Error('ANTIGRAVITY_VERSION_EXIT_NONZERO'),{code:'ANTIGRAVITY_VERSION_EXIT_NONZERO',detail:stderr.slice(-2000)}));const version=parseExactGeminiVersionOutput(stdout);if(!version)return finish(reject,Object.assign(new Error('ANTIGRAVITY_VERSION_OUTPUT_INVALID'),{code:'ANTIGRAVITY_VERSION_OUTPUT_INVALID',detail:stdout.slice(-2000)}));finish(resolve,version);});
  });
  if(expected&&out.replace(/^v/,'')!==String(expected).replace(/^v/,''))fail('ANTIGRAVITY_VERSION_MISMATCH',`expected ${expected}, actual ${out}`);
  const cmp=compareSemver(out,minimum);if(cmp===null||cmp<0)fail('ANTIGRAVITY_VERSION_TOO_OLD',`minimum ${minimum}, actual ${out}`);
  return {ok:true,entry,version:out};
}

if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url))){
  const args=process.argv.slice(2),entry=args[args.indexOf('--entry')+1],expected=args.includes('--expected')?args[args.indexOf('--expected')+1]:null,minimum=args.includes('--minimum')?args[args.indexOf('--minimum')+1]:'1.1.20';
  try{console.log(JSON.stringify(await probeAntigravityEntry(entry,{expected,minimum})));}catch(e){console.log(JSON.stringify({ok:false,error:e.code||e.message,detail:e.detail||e.message}));process.exitCode=1;}
}
