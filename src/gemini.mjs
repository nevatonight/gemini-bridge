import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureDir, ensureOwnedDir, parseJsonLinesChunk, finalJsonLine, redactError, writeJson } from './utils.mjs';
import { GEMINI_VERSION_PROBE_TIMEOUT_MS, parseExactGeminiVersionOutput } from './version-policy.mjs';
import { spawnManaged, terminateProcessTree, childExited } from './process-control.mjs';

const READ_TOOLS=['list_directory','read_file','read_many_files','glob','grep_search'];
const EDIT_TOOLS=[...READ_TOOLS,'write_file','replace'];
const MAX_OUTPUT=4*1024*1024,MAX_RAW_STDOUT=32*1024*1024,MAX_STDERR=256*1024;

export function bridgeEnv(base,home,settingsPath){
  const keep=['PATH','Path','PATHEXT','SYSTEMROOT','SystemRoot','WINDIR','TEMP','TMP','TMPDIR','COMSPEC','APPDATA','LOCALAPPDATA','USERPROFILE','HOME','LANG','LC_ALL','TERM','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','HTTPS_PROXY','HTTP_PROXY','NO_PROXY'];
  const env={}; for(const k of keep) if(base[k]!==undefined) env[k]=base[k];
  env.GEMINI_CLI_HOME=home; env.GEMINI_CLI_SYSTEM_SETTINGS_PATH=settingsPath; env.GEMINI_CLI_SURFACE='gemini-bridge';
  return env;
}
function appendBounded(current,chunk,max){
  const next=current+String(chunk);const b=Buffer.from(next,'utf8');if(b.length<=max)return next;
  return b.subarray(b.length-max).toString('utf8');
}
export class GeminiRunner{
  constructor({stateRoot,geminiEntry=null,nodePath=process.execPath}={}){ this.stateRoot=stateRoot;this.geminiEntry=geminiEntry||process.env.GEMINI_BRIDGE_GEMINI_ENTRY||null;this.nodePath=nodePath;this.contextFileName=`.gemini-bridge-no-context-${crypto.randomBytes(12).toString('hex')}.md`; }
  async init(){ await ensureOwnedDir(this.stateRoot,path.join(this.stateRoot,'gemini-home','.gemini')); await ensureOwnedDir(this.stateRoot,path.join(this.stateRoot,'policies')); return this; }
  async settings(mode){
    const tools=mode==='ask'?[]:(mode==='review'?READ_TOOLS:EDIT_TOOLS);
    const policyRoot=path.join(this.stateRoot,'policies');await ensureOwnedDir(this.stateRoot,policyRoot);const file=path.join(policyRoot,`${mode}.json`);
    const obj={general:{enableAutoUpdate:false,enableAutoUpdateNotification:false},context:{fileName:this.contextFileName,includeDirectoryTree:true},tools:{core:tools},security:{disableYoloMode:true,disableAlwaysAllow:true,environmentVariableRedaction:{enabled:true}},advanced:{ignoreLocalEnv:true},skills:{enabled:false},hooksConfig:{enabled:false},admin:{secureModeEnabled:true,extensions:{enabled:false},mcp:{enabled:false},skills:{enabled:false}}};
    // Persistent policy is never authoritative: rewrite it from current code
    // for every invocation so an old/tampered broader policy cannot survive.
    await writeJson(file,obj); return file;
  }
  resolveCommand(){
    if(this.geminiEntry) return {cmd:this.nodePath,args:[this.geminiEntry]};
    if(process.platform!=='win32') return {cmd:'gemini',args:[]};
    return {cmd:process.env.COMSPEC||'cmd.exe',args:['/d','/s','/c','gemini']};
  }
  async version({timeoutMs=GEMINI_VERSION_PROBE_TIMEOUT_MS}={}){
    const settings=await this.settings('ask');const home=path.join(this.stateRoot,'gemini-home');await ensureOwnedDir(this.stateRoot,path.join(home,'.gemini'));const c=this.resolveCommand();const env=bridgeEnv(process.env,home,settings);
    return await new Promise((resolve,reject)=>{
      const p=spawnManaged(c.cmd,[...c.args,'--version'],{env,stdio:['ignore','pipe','pipe'],windowsHide:true,shell:false});let out='',err='',settled=false,timedOut=false;
      let timer=null;const finish=(fn,v)=>{if(settled)return;settled=true;if(timer)clearTimeout(timer);fn(v);};
      timer=setTimeout(()=>{timedOut=true;(async()=>{try{await terminateProcessTree(p);}catch(e){return finish(reject,new Error(`GEMINI_VERSION_TIMEOUT_TERMINATION_FAILED:${redactError(e)}`));}finish(reject,new Error('GEMINI_VERSION_TIMEOUT'));})();},Math.max(250,Math.min(30000,Number(timeoutMs)||5000)));
      p.stdout.on('data',b=>{out+=b.toString('utf8');if(Buffer.byteLength(out,'utf8')>65536){terminateProcessTree(p).catch(()=>{});finish(reject,new Error('GEMINI_VERSION_OUTPUT_TOO_LARGE'));}});
      p.stderr.on('data',b=>{err=appendBounded(err,b.toString('utf8'),65536);});
      p.once('error',e=>finish(reject,new Error(`GEMINI_CLI_NOT_AVAILABLE:${redactError(e)}`)));
      p.once('close',code=>{if(settled)return;if(timedOut)return finish(reject,new Error('GEMINI_VERSION_TIMEOUT'));if(code===0){const v=parseExactGeminiVersionOutput(out);if(!v)return finish(reject,new Error('GEMINI_VERSION_OUTPUT_INVALID'));return finish(resolve,v);}finish(reject,new Error(`GEMINI_VERSION_EXIT_${code}:${err.trim().slice(-2000)}`));});
    });
  }
  async run({mode='ask',cwd,payload,onPartial=()=>{},onProcess=()=>{}}){
    const settings=await this.settings(mode); const home=path.join(this.stateRoot,'gemini-home'); await ensureOwnedDir(this.stateRoot,path.join(home,'.gemini')); const c=this.resolveCommand();
    const args=[...c.args,'--skip-trust','-p','Read the complete task and context from stdin. Follow it exactly.','--output-format','stream-json'];
    if(mode==='edit') args.push('--approval-mode','auto_edit');
    const env=bridgeEnv(process.env,home,settings);
    const p=spawnManaged(c.cmd,args,{cwd,env,stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false});
    let finalText='',partial='',stderr='',model=null,rawStdout=0,sawResult=false,protocolError=null,terminalError=null,spawnError=null;const diagnostics=[];
    const state={buf:''};
    const failProtocol=e=>{if(!protocolError)protocolError=e instanceof Error?e:new Error(String(e));terminateProcessTree(p).catch(()=>{});};
    const handle=obj=>{
      if(!obj||typeof obj!=='object'||Array.isArray(obj))throw new Error('GEMINI_PROTOCOL_INVALID_EVENT');
      if(obj.type==='init'&&obj.model) model=String(obj.model);
      if(obj.type==='message' && (obj.role==='assistant'||obj.role==='model')){
        const text=String(obj.content??obj.text??'');
        if(text){if(Buffer.byteLength(partial,'utf8')+Buffer.byteLength(text,'utf8')>MAX_OUTPUT)throw new Error('GEMINI_OUTPUT_TOO_LARGE');partial+=text;onPartial(partial);}
      }
      if(obj.type==='result'){
        sawResult=true;const status=String(obj.status??'').toLowerCase();
        if(['error','failed','failure','cancelled','canceled'].includes(status)||obj.error){terminalError=new Error(`GEMINI_RESULT_ERROR:${redactError(obj.error?.message||obj.error||status||'error')}`);}
        if(obj.response!==undefined||obj.result!==undefined||obj.text!==undefined){finalText=String(obj.response ?? obj.result ?? obj.text ?? '');if(Buffer.byteLength(finalText,'utf8')>MAX_OUTPUT)throw new Error('GEMINI_OUTPUT_TOO_LARGE');}
      }
      if(obj.type==='error'){const d=redactError(obj.message||obj.error||'Gemini diagnostic');if(diagnostics.length<32)diagnostics.push(d);}
    };
    p.stdout.on('data',b=>{
      if(protocolError)return;rawStdout+=b.length;if(rawStdout>MAX_RAW_STDOUT){failProtocol(new Error('GEMINI_RAW_STDOUT_TOO_LARGE'));return;}
      try{parseJsonLinesChunk(state,b.toString('utf8'),handle);}catch(e){failProtocol(e);}
    });
    p.stderr.on('data',b=>{stderr=appendBounded(stderr,b.toString('utf8'),MAX_STDERR);});
    p.stdin.on('error',e=>{if(e?.code!=='EPIPE')stderr=appendBounded(stderr,`stdin:${redactError(e)}\n`,MAX_STDERR);});
    p.once('error',e=>{spawnError=e;});

    try{
      // No prompt/side effect is sent until the owner has durably persisted
      // PID + exact process identity. If persistence fails, kill this child.
      await onProcess(p);
    }catch(e){
      await terminateProcessTree(p);throw e;
    }
    if(!childExited(p)){try{p.stdin.end(payload);}catch(e){if(e?.code!=='EPIPE')throw e;}}

    const code=await new Promise(resolve=>{if(p.exitCode!==null)return resolve(p.exitCode);p.once('close',resolve);});
    if(!protocolError){try{finalJsonLine(state,handle);}catch(e){protocolError=e;}}
    if(spawnError)throw new Error(`GEMINI_SPAWN_FAILED:${redactError(spawnError)}`);
    if(protocolError)throw protocolError;
    if(code!==0)throw new Error(`GEMINI_EXIT_${code}:${stderr.trim().slice(-2000)}`);
    if(!sawResult)throw new Error('GEMINI_PROTOCOL_MISSING_RESULT');
    if(terminalError)throw terminalError;
    return {text:finalText||partial,model,stderr:stderr.trim(),diagnostics};
  }
}
