import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureOwnedDir, parseJsonLinesChunk, finalJsonLine, redactError, writeJson } from './utils.mjs';
import { GEMINI_VERSION_PROBE_TIMEOUT_MS, parseExactGeminiVersionOutput } from './version-policy.mjs';
import { spawnManaged, terminateProcessTree, childExited } from './process-control.mjs';

const READ_TOOLS=['list_directory','read_file','read_many_files','glob','grep_search'];
const EDIT_TOOLS=[...READ_TOOLS,'write_file','replace'];
const MAX_OUTPUT=4*1024*1024,MAX_RAW_STDOUT=32*1024*1024,MAX_STDERR=256*1024;
const AUTH_RE=/(?:authentication required|sign[ -]?in|log[ -]?in|oauth|credential|unauthenticated)/i;

export function bridgeEnv(base,home,legacySettingsPath=null){
  const keep=['PATH','Path','PATHEXT','SYSTEMROOT','SystemRoot','WINDIR','TEMP','TMP','TMPDIR','COMSPEC','APPDATA','LOCALAPPDATA','LANG','LC_ALL','TERM','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','HTTPS_PROXY','HTTP_PROXY','NO_PROXY'];
  const env={};for(const k of keep)if(base[k]!==undefined)env[k]=base[k];
  env.HOME=home;env.USERPROFILE=home;env.GEMINI_BRIDGE_PROVIDER='antigravity';env.AGY_CLI_DISABLE_AUTO_UPDATE='true';if(legacySettingsPath){env.GEMINI_CLI_HOME=home;env.GEMINI_CLI_SYSTEM_SETTINGS_PATH=legacySettingsPath;env.GEMINI_CLI_SURFACE='gemini-bridge';}
  return env;
}
function appendBounded(current,chunk,max){const next=current+String(chunk),b=Buffer.from(next,'utf8');return b.length<=max?next:b.subarray(b.length-max).toString('utf8');}
function legacySettings(mode,contextFileName){
  const tools=mode==='ask'?[]:(mode==='review'?READ_TOOLS:EDIT_TOOLS);
  return {general:{enableAutoUpdate:false,enableAutoUpdateNotification:false},context:{fileName:contextFileName,includeDirectoryTree:true},tools:{core:tools},security:{disableYoloMode:true,disableAlwaysAllow:true,environmentVariableRedaction:{enabled:true}},advanced:{ignoreLocalEnv:true},skills:{enabled:false},hooksConfig:{enabled:false},admin:{secureModeEnabled:true,extensions:{enabled:false},mcp:{enabled:false},skills:{enabled:false}}};
}
function antigravitySettings(mode){
  const deny=['command(*)','read_url(*)','execute_url(*)','mcp(*)','unsandboxed(*)'];
  if(mode==='ask')deny.push('read_file(*)','write_file(*)');
  if(mode==='review')deny.push('write_file(*)');
  return {colorScheme:'terminal',altScreenMode:'never',toolPermission:'request-review',artifactReviewPolicy:mode==='edit'?'always-proceed':'asks-for-review',allowNonWorkspaceAccess:false,enableTerminalSandbox:false,enableTelemetry:false,notifications:false,showTips:false,showFeedbackSurvey:false,permissions:{allow:[],ask:[],deny}};
}

export class GeminiRunner{
  constructor({stateRoot,geminiEntry=null,nodePath=process.execPath}={}){this.stateRoot=stateRoot;this.geminiEntry=geminiEntry||process.env.GEMINI_BRIDGE_AGENT_ENTRY||process.env.GEMINI_BRIDGE_GEMINI_ENTRY||null;this.nodePath=nodePath;this.profileHome=path.join(stateRoot,'antigravity-home');this.contextFileName=`.gemini-bridge-no-context-${crypto.randomBytes(12).toString('hex')}.md`;this.authProcess=null;this.authTimer=null;this.authState={status:'idle',startedAt:null,codeSubmitted:false,error:null};}
  async init(){await ensureOwnedDir(this.stateRoot,path.join(this.profileHome,'.gemini','antigravity-cli'));return this;}
  async settings(mode,{legacy=null}={}){if(legacy===null)legacy=this.resolveCommand().legacyNodeEntry;const dir=path.join(this.profileHome,'.gemini','antigravity-cli');await ensureOwnedDir(this.stateRoot,dir);const file=path.join(dir,'settings.json');await writeJson(file,legacy?legacySettings(mode,this.contextFileName):antigravitySettings(mode));return file;}
  resolveCommand(){
    if(this.geminiEntry){const ext=path.extname(this.geminiEntry).toLowerCase();if(ext==='.js'||ext==='.mjs'||ext==='.cjs')return {cmd:this.nodePath,args:[this.geminiEntry],legacyNodeEntry:true};return {cmd:this.geminiEntry,args:[],legacyNodeEntry:false};}
    if(process.platform!=='win32')return {cmd:'agy',args:[],legacyNodeEntry:false};
    const local=process.env.LOCALAPPDATA?path.join(process.env.LOCALAPPDATA,'agy','bin','agy.exe'):null;if(local)return {cmd:local,args:[],legacyNodeEntry:false};
    return {cmd:'agy.exe',args:[],legacyNodeEntry:false};
  }
  async version({timeoutMs=GEMINI_VERSION_PROBE_TIMEOUT_MS}={}){
    const c=this.resolveCommand(),settings=await this.settings('ask',{legacy:c.legacyNodeEntry}),env=bridgeEnv(process.env,this.profileHome,c.legacyNodeEntry?settings:null);
    return await new Promise((resolve,reject)=>{const p=spawnManaged(c.cmd,[...c.args,'--version'],{env,stdio:['ignore','pipe','pipe'],windowsHide:true,shell:false});let out='',err='',settled=false,timedOut=false,timer=null;const finish=(fn,v)=>{if(settled)return;settled=true;if(timer)clearTimeout(timer);fn(v)};timer=setTimeout(()=>{timedOut=true;(async()=>{try{await terminateProcessTree(p);}catch(e){return finish(reject,new Error(`GEMINI_VERSION_TIMEOUT_TERMINATION_FAILED:${redactError(e)}`));}finish(reject,new Error('GEMINI_VERSION_TIMEOUT'));})();},Math.max(250,Math.min(30000,Number(timeoutMs)||5000)));p.stdout.on('data',b=>{out+=b.toString('utf8');if(Buffer.byteLength(out,'utf8')>65536){terminateProcessTree(p).catch(()=>{});finish(reject,new Error('GEMINI_VERSION_OUTPUT_TOO_LARGE'));}});p.stderr.on('data',b=>{err=appendBounded(err,b.toString('utf8'),65536)});p.once('error',e=>finish(reject,new Error(`GEMINI_CLI_NOT_AVAILABLE:${redactError(e)}`)));p.once('close',code=>{if(settled)return;if(timedOut)return finish(reject,new Error('GEMINI_VERSION_TIMEOUT'));if(code===0){const v=parseExactGeminiVersionOutput(out);if(!v)return finish(reject,new Error('GEMINI_VERSION_OUTPUT_INVALID'));return finish(resolve,v);}finish(reject,new Error(`GEMINI_VERSION_EXIT_${code}:${err.trim().slice(-2000)}`));});});
  }
  async authStatus({timeoutMs=15000}={}){
    const c=this.resolveCommand(),settings=await this.settings('ask',{legacy:c.legacyNodeEntry}),env=bridgeEnv(process.env,this.profileHome,c.legacyNodeEntry?settings:null);
    return await new Promise(resolve=>{let out='',err='',settled=false;const p=spawnManaged(c.cmd,[...c.args,'models'],{env,stdio:['ignore','pipe','pipe'],windowsHide:true,shell:false});const done=v=>{if(settled)return;settled=true;clearTimeout(timer);resolve(v)};const timer=setTimeout(()=>{terminateProcessTree(p).catch(()=>{}).finally(()=>done({authenticated:null,error:'AUTH_STATUS_TIMEOUT'}));},timeoutMs);p.stdout.on('data',b=>out=appendBounded(out,b,65536));p.stderr.on('data',b=>err=appendBounded(err,b,65536));p.once('error',e=>done({authenticated:null,error:`AUTH_STATUS_FAILED:${redactError(e)}`}));p.once('close',code=>{const text=`${out}\n${err}`;if(code===0)return done({authenticated:true,error:null});if(AUTH_RE.test(text))return done({authenticated:false,error:'AUTH_REQUIRED'});return done({authenticated:null,error:`AUTH_STATUS_EXIT_${code}:${redactError(text).slice(-1000)}`});});});
  }
  authSessionStatus(){return {...this.authState};}
  async cancelInteractiveAuth(){
    const p=this.authProcess;if(!p||childExited(p)){this.authProcess=null;if(this.authTimer){clearTimeout(this.authTimer);this.authTimer=null;}if(this.authState.status!=='complete')this.authState={status:'idle',startedAt:null,codeSubmitted:false,error:null};return {cancelled:false};}
    try{await terminateProcessTree(p);}finally{this.authProcess=null;if(this.authTimer){clearTimeout(this.authTimer);this.authTimer=null;}this.authState={status:'cancelled',startedAt:this.authState.startedAt,codeSubmitted:this.authState.codeSubmitted,error:null};}
    return {cancelled:true};
  }
  async launchInteractiveAuth(){
    const existing=this.authProcess;if(existing&&!childExited(existing))return {started:false,alreadyStarting:true,method:'bridge-code',requiresCode:true,session:this.authSessionStatus()};
    const c=this.resolveCommand();await this.settings('ask',{legacy:c.legacyNodeEntry});const env=bridgeEnv(process.env,this.profileHome,c.legacyNodeEntry?path.join(this.profileHome,'.gemini','antigravity-cli','settings.json'):null),cwd=path.join(this.stateRoot,'auth-empty');await ensureOwnedDir(this.stateRoot,cwd);
    const p=spawnManaged(c.cmd,c.args,{cwd,env,stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false,detached:false});this.authProcess=p;this.authState={status:'awaiting-code',startedAt:new Date().toISOString(),codeSubmitted:false,error:null};
    const drain=stream=>stream?.on('data',()=>{});drain(p.stdout);drain(p.stderr);
    p.stdin?.on('error',()=>{if(this.authProcess===p&&!childExited(p))this.authState={...this.authState,status:'failed',error:'AUTH_STDIN_FAILED'};});
    p.once('error',()=>{if(this.authProcess===p){this.authProcess=null;if(this.authTimer){clearTimeout(this.authTimer);this.authTimer=null;}this.authState={...this.authState,status:'failed',error:'AUTH_PROCESS_START_FAILED'};}});
    p.once('close',code=>{if(this.authProcess!==p)return;this.authProcess=null;if(this.authTimer){clearTimeout(this.authTimer);this.authTimer=null;}this.authState={...this.authState,status:code===0?'complete':'failed',error:code===0?null:`AUTH_PROCESS_EXIT_${code}`};});
    this.authTimer=setTimeout(()=>{if(this.authProcess===p&&!childExited(p)){terminateProcessTree(p).catch(()=>{}).finally(()=>{if(this.authProcess===p){this.authProcess=null;this.authState={...this.authState,status:'expired',error:'AUTH_SESSION_TIMEOUT'};}});}},5*60*1000);this.authTimer.unref?.();
    return {started:true,method:'bridge-code',requiresCode:true,session:this.authSessionStatus()};
  }
  async submitInteractiveAuthCode(code){
    const p=this.authProcess;if(!p||childExited(p))throw new Error('AUTH_SESSION_NOT_ACTIVE');if(this.authState.codeSubmitted)throw new Error('AUTH_CODE_ALREADY_SUBMITTED');
    const value=String(code??'').trim();if(value.length<8||Buffer.byteLength(value,'utf8')>4096||/[\r\n\0]/.test(value))throw new Error('AUTH_CODE_INVALID');
    if(!p.stdin||p.stdin.destroyed||!p.stdin.writable)throw new Error('AUTH_STDIN_NOT_AVAILABLE');
    await new Promise((resolve,reject)=>p.stdin.write(`${value}\n`,'utf8',e=>e?reject(new Error('AUTH_STDIN_FAILED')):resolve()));
    this.authState={...this.authState,status:'verifying',codeSubmitted:true,error:null};return {accepted:true,session:this.authSessionStatus()};
  }
  async run({mode='ask',cwd,payload,onPartial=()=>{},onProcess=()=>{}}){
    const c=this.resolveCommand(),settings=await this.settings(mode,{legacy:c.legacyNodeEntry}),env=bridgeEnv(process.env,this.profileHome,c.legacyNodeEntry?settings:null);
    const args=c.legacyNodeEntry?[...c.args,'--skip-trust','-p','Read the complete task and context from stdin. Follow it exactly.','--output-format','stream-json',...(mode==='edit'?['--approval-mode','auto_edit']:[])]:[...c.args,'--input-format','stream-json','--output-format','stream-json','--print-timeout','10m','--mode',mode==='edit'?'accept-edits':mode==='review'?'plan':'default'];
    const p=spawnManaged(c.cmd,args,{cwd,env,stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false});let finalText='',partial='',stderr='',model=null,rawStdout=0,sawResult=false,protocolError=null,terminalError=null,spawnError=null;const diagnostics=[],state={buf:''};
    const failProtocol=e=>{if(!protocolError)protocolError=e instanceof Error?e:new Error(String(e));terminateProcessTree(p).catch(()=>{})};
    const handle=obj=>{
      if(!obj||typeof obj!=='object'||Array.isArray(obj))throw new Error('GEMINI_PROTOCOL_INVALID_EVENT');
      // Antigravity current protocol. Legacy Gemini fake events remain accepted by tests/upgrades.
      const event=String(obj.event||obj.type||'');
      if(event==='init'){model=String(obj.init?.model||obj.model||model||'')||null;return;}
      if(event==='step_update'){
        const step=obj.step_update||{};const text=String(step.text_delta||'');if(text){if(Buffer.byteLength(partial,'utf8')+Buffer.byteLength(text,'utf8')>MAX_OUTPUT)throw new Error('GEMINI_OUTPUT_TOO_LARGE');partial+=text;onPartial(partial);}return;
      }
      if(event==='message'&&(obj.role==='assistant'||obj.role==='model')){const text=String(obj.content??obj.text??'');if(text){if(Buffer.byteLength(partial,'utf8')+Buffer.byteLength(text,'utf8')>MAX_OUTPUT)throw new Error('GEMINI_OUTPUT_TOO_LARGE');partial+=text;onPartial(partial);}return;}
      if(event==='result'){
        sawResult=true;const result=obj.result&&typeof obj.result==='object'?obj.result:obj,status=String(result.status??'').toUpperCase();if(['ERROR','FAILED','FAILURE','CANCELED','CANCELLED','INTERRUPTED','INVALID','WAITING'].includes(status)||result.error)terminalError=new Error(`GEMINI_RESULT_ERROR:${redactError(result.error?.message||result.error||status||'error')}`);if(result.response!==undefined||result.text!==undefined){finalText=String(result.response??result.text??'');if(Buffer.byteLength(finalText,'utf8')>MAX_OUTPUT)throw new Error('GEMINI_OUTPUT_TOO_LARGE');}return;
      }
      if(event==='error'){const d=redactError(obj.message||obj.error||'Antigravity diagnostic');if(diagnostics.length<32)diagnostics.push(d);}
    };
    p.stdout.on('data',b=>{if(protocolError)return;rawStdout+=b.length;if(rawStdout>MAX_RAW_STDOUT)return failProtocol(new Error('GEMINI_RAW_STDOUT_TOO_LARGE'));try{parseJsonLinesChunk(state,b.toString('utf8'),handle)}catch(e){failProtocol(e)}});p.stderr.on('data',b=>stderr=appendBounded(stderr,b.toString('utf8'),MAX_STDERR));p.stdin.on('error',e=>{if(e?.code!=='EPIPE')stderr=appendBounded(stderr,`stdin:${redactError(e)}\n`,MAX_STDERR)});p.once('error',e=>spawnError=e);
    try{await onProcess(p)}catch(e){await terminateProcessTree(p);throw e;}
    if(!childExited(p)){const input=c.legacyNodeEntry?String(payload):JSON.stringify({event:'user',message:{content:String(payload)}})+'\n';try{p.stdin.end(input)}catch(e){if(e?.code!=='EPIPE')throw e;}}
    const code=await new Promise(resolve=>{if(p.exitCode!==null)return resolve(p.exitCode);p.once('close',resolve)});if(!protocolError){try{finalJsonLine(state,handle)}catch(e){protocolError=e}}if(spawnError)throw new Error(`GEMINI_SPAWN_FAILED:${redactError(spawnError)}`);if(protocolError)throw protocolError;if(code!==0)throw new Error(`GEMINI_EXIT_${code}:${stderr.trim().slice(-2000)}`);if(!sawResult)throw new Error('GEMINI_PROTOCOL_MISSING_RESULT');if(terminalError)throw terminalError;return {text:finalText||partial,model,stderr:stderr.trim(),diagnostics};
  }
}
