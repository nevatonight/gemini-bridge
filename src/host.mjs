import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { BridgeCore } from './core.mjs';
import { stateRoot, ensureDir, readJson, writeJson, noStoreHeaders, redactError, processIdentitySync, processMatchesIdentity, isPidAlive, APP_VERSION } from './utils.mjs';
import { ensureRuntimeConfig } from './runtime-config.mjs';

const root=stateRoot();await ensureDir(root);const lockPath=path.join(root,'host.lock.json'),startupErrorPath=path.join(root,'host-startup-error.json');
const launchNonceRaw=process.env.GEMINI_BRIDGE_LAUNCH_NONCE;let launchNonce=null;
if(launchNonceRaw!==undefined&&launchNonceRaw!==''){if(!/^[a-f0-9]{32}$/.test(String(launchNonceRaw))){const error='HOST_LAUNCH_NONCE_INVALID';await writeJson(startupErrorPath,{at:new Date().toISOString(),error}).catch(()=>{});console.error(`Bridge Host launch identity failed: ${error}`);process.exit(2);}launchNonce=String(launchNonceRaw);}
let cfg;
try{cfg=await ensureRuntimeConfig(root);}catch(e){const startupError=`RUNTIME_CONFIG_STARTUP_FAILED:${redactError(e)}`;await writeJson(startupErrorPath,{at:new Date().toISOString(),error:startupError}).catch(()=>{});console.error(`Bridge Host runtime config failed: ${startupError}`);process.exit(2);}
let authCache={at:0,value:{authenticated:null,error:null}},lastAuthLaunchAt=0;
async function authStatusCached(force=false){const now=Date.now();if(!force&&now-authCache.at<10000)return authCache.value;const value=await core.gemini.authStatus().catch(e=>({authenticated:null,error:redactError(e)}));authCache={at:now,value};return value;}
const hostInstanceId=crypto.randomBytes(16).toString('hex');const hostProcessIdentity=processIdentitySync(process.pid);if(!hostProcessIdentity){const error='HOST_PROCESS_IDENTITY_UNAVAILABLE';await writeJson(startupErrorPath,{at:new Date().toISOString(),error}).catch(()=>{});console.error(`Bridge Host launch identity failed: ${error}`);process.exit(2);}const MAX_BODY=1024*1024;let core=null,ready=false,shutting=false,shutdownRequested=false;
const uiRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','ui');

function json(res,status,obj){const data=Buffer.from(JSON.stringify(obj));res.writeHead(status,noStoreHeaders({'Content-Type':'application/json; charset=utf-8','Content-Length':data.length,'X-Content-Type-Options':'nosniff'}));res.end(data);}
function allowedHost(req){const h=String(req.headers.host||'').toLowerCase();return h===`127.0.0.1:${cfg.port}`||h===`localhost:${cfg.port}`;}
function allowedOrigin(req){const raw=req.headers.origin;if(raw===undefined)return true;try{const u=new URL(String(raw));if((u.protocol==='http:'&&(u.hostname==='127.0.0.1'||u.hostname==='localhost')&&Number(u.port)===Number(cfg.port)))return true;if(['chrome-extension:','moz-extension:','edge-extension:'].includes(u.protocol)&&/^[a-z0-9-]{8,128}$/i.test(u.hostname))return true;return false;}catch{return false;}}
function auth(req){const token=String(req.headers['x-gemini-bridge-token']||'');if(!/^[a-f0-9]{64}$/.test(token)||token.length!==String(cfg.token).length)return false;try{return crypto.timingSafeEqual(Buffer.from(token),Buffer.from(String(cfg.token)));}catch{return false;}}
function parts(url){return new URL(url,'http://127.0.0.1').pathname.split('/').filter(Boolean);}
function statusForError(e){const m=String(e?.message||e);if(m.includes('HOST_MAINTENANCE'))return 503;if(m.includes('NOT_FOUND'))return 404;if(m.includes('UNAUTHORIZED'))return 401;if(m.includes('HOST_NOT_ALLOWED')||m.includes('ORIGIN_NOT_ALLOWED'))return 403;if(m.includes('BUSY')||m.includes('CONFLICT')||m.includes('IDEMPOTENCY')||m.includes('TRANSITION')||m.includes('APPLICABLE')||m.includes('DISCARDABLE')||m.includes('PENDING_AGENT'))return 409;if(m.includes('INVALID')||m.includes('REQUIRED')||m.includes('TOO_')||m.includes('EMPTY')||m.includes('PROMPT')||m.includes('SCHEMA'))return 400;return 500;}
async function serveUi(res,name,type){const data=await fsp.readFile(path.join(uiRoot,name));res.writeHead(200,noStoreHeaders({'Content-Type':type,'Content-Length':data.length,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",'Referrer-Policy':'no-referrer'}));res.end(data);}
async function body(req){
  const declared=req.headers['content-length'];if(declared!==undefined&&(!/^\d+$/.test(String(declared))||Number(declared)>MAX_BODY))throw new Error('REQUEST_TOO_LARGE');
  let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>MAX_BODY)throw new Error('REQUEST_TOO_LARGE');chunks.push(c);}if(!chunks.length)return{};
  let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('INVALID_JSON');}if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('INVALID_BODY_OBJECT');return value;
}
function validate(obj,spec){
  for(const k of Object.keys(obj))if(!Object.prototype.hasOwnProperty.call(spec,k))throw new Error(`SCHEMA_UNKNOWN_FIELD:${k}`);
  for(const [k,r] of Object.entries(spec)){
    const present=Object.prototype.hasOwnProperty.call(obj,k);if(!present){if(r.required)throw new Error(`SCHEMA_REQUIRED:${k}`);continue;}const v=obj[k];
    if(v===null&&r.nullable)continue;if(r.type==='string'){if(typeof v!=='string')throw new Error(`SCHEMA_TYPE:${k}`);if(r.min!==undefined&&v.length<r.min)throw new Error(`SCHEMA_MIN:${k}`);if(r.max!==undefined&&v.length>r.max)throw new Error(`SCHEMA_MAX:${k}`);if(r.maxBytes!==undefined&&Buffer.byteLength(v,'utf8')>r.maxBytes)throw new Error(`SCHEMA_MAX:${k}`);if(r.enum&&!r.enum.includes(v))throw new Error(`SCHEMA_ENUM:${k}`);}else if(r.type==='number'){if(typeof v!=='number'||!Number.isFinite(v))throw new Error(`SCHEMA_TYPE:${k}`);}else if(r.type==='boolean'){if(typeof v!=='boolean')throw new Error(`SCHEMA_TYPE:${k}`);}
  }return obj;
}
function emptyBody(b){return validate(b,{});}

const server=http.createServer({maxHeaderSize:16*1024},async(req,res)=>{
  try{
    if(!allowedHost(req))throw new Error('HOST_NOT_ALLOWED');if(!allowedOrigin(req))throw new Error('ORIGIN_NOT_ALLOWED');
    const u=new URL(req.url,'http://127.0.0.1'),p=parts(req.url);
    if(req.method==='GET'&&(u.pathname==='/ui'||u.pathname==='/ui/'))return await serveUi(res,'index.html','text/html; charset=utf-8');
    if(req.method==='GET'&&u.pathname==='/ui/app.js')return await serveUi(res,'app.js','text/javascript; charset=utf-8');
    if(req.method==='GET'&&u.pathname==='/ui/styles.css')return await serveUi(res,'styles.css','text/css; charset=utf-8');
    if(!auth(req))return json(res,401,{error:'UNAUTHORIZED'});if(!ready||!core)return json(res,503,{error:'HOST_INITIALIZING'});
    if(req.method==='GET'&&u.pathname==='/v1/health'){const health=await core.health();const a=await authStatusCached();return json(res,200,{...health,auth:{credentialsPresent:a.authenticated,error:a.error,provider:'antigravity'},host:{instanceId:hostInstanceId,pid:process.pid,processIdentity:hostProcessIdentity,launchNonce}});}
    if(req.method==='POST'&&u.pathname==='/v1/auth/start'){emptyBody(await body(req));const now=Date.now();if(now-lastAuthLaunchAt<8000)return json(res,202,{started:false,alreadyStarting:true,provider:'antigravity',session:core.gemini.authSessionStatus()});lastAuthLaunchAt=now;try{const out=await core.gemini.launchInteractiveAuth();authCache={at:0,value:{authenticated:null,error:null}};return json(res,202,{...out,provider:'antigravity'});}catch(e){lastAuthLaunchAt=0;throw e;}}
    if(req.method==='POST'&&u.pathname==='/v1/auth/code'){const b=validate(await body(req),{code:{type:'string',required:true,min:8,max:4096,maxBytes:4096}});const out=await core.gemini.submitInteractiveAuthCode(b.code);authCache={at:0,value:{authenticated:null,error:null}};return json(res,202,{...out,provider:'antigravity'});}
    if(req.method==='POST'&&u.pathname==='/v1/auth/cancel'){emptyBody(await body(req));const out=await core.gemini.cancelInteractiveAuth();return json(res,200,{...out,provider:'antigravity'});}
    if(req.method==='GET'&&u.pathname==='/v1/auth/session')return json(res,200,{...core.gemini.authSessionStatus(),provider:'antigravity'});
    if(req.method==='GET'&&u.pathname==='/v1/auth/status'){const a=await authStatusCached(true);return json(res,200,{...a,provider:'antigravity'});}
    if(req.method==='GET'&&u.pathname==='/v1/upgrade-readiness')return json(res,200,core.upgradeReadiness());
    if(req.method==='POST'&&u.pathname==='/v1/maintenance'){const b=validate(await body(req),{enabled:{type:'boolean',required:true}});if(shutdownRequested&&!b.enabled)throw new Error('HOST_SHUTDOWN_REQUESTED');return json(res,200,core.setMaintenance(b.enabled));}
    if(req.method==='GET'&&u.pathname==='/v1/projects')return json(res,200,{projects:core.listProjects()});
    if(req.method==='POST'&&u.pathname==='/v1/projects'){const b=validate(await body(req),{name:{type:'string',max:120}});return json(res,201,{project:core.createProject(b.name)});}
    if(req.method==='PATCH'&&p.length===3&&p[0]==='v1'&&p[1]==='projects'&&p[2]){const b=validate(await body(req),{name:{type:'string',max:120},workspace:{type:'string',max:32768},context:{type:'string',maxBytes:120000}});return json(res,200,{project:await core.updateProject(p[2],b)});}
    if(req.method==='GET'&&p.length===4&&p[0]==='v1'&&p[1]==='projects'&&p[2]&&p[3]==='threads')return json(res,200,{threads:core.listThreads(p[2])});
    if(req.method==='POST'&&p.length===4&&p[0]==='v1'&&p[1]==='projects'&&p[2]&&p[3]==='threads'){const b=validate(await body(req),{title:{type:'string',max:100}});return json(res,201,{thread:core.createThread(p[2],b.title)});}
    if(req.method==='GET'&&p.length===4&&p[0]==='v1'&&p[1]==='projects'&&p[2]&&p[3]==='pending')return json(res,200,{runs:core.listPending(p[2])});
    if(req.method==='GET'&&p.length===4&&p[0]==='v1'&&p[1]==='threads'&&p[2]&&p[3]==='turns'){const raw=u.searchParams.get('limit');let limit=100;if(raw!==null){if(!/^\d+$/.test(raw)||Number(raw)<1||Number(raw)>500)throw new Error('INVALID_LIMIT');limit=Number(raw);}return json(res,200,{turns:core.turns(p[2],limit)});}
    if(req.method==='GET'&&p.length===4&&p[0]==='v1'&&p[1]==='threads'&&p[2]&&p[3]==='conversation'){const raw=u.searchParams.get('limit');let limit=100;if(raw!==null){if(!/^\d+$/.test(raw)||Number(raw)<1||Number(raw)>500)throw new Error('INVALID_LIMIT');limit=Number(raw);}return json(res,200,core.conversation(p[2],limit));}
    if(req.method==='POST'&&u.pathname==='/v1/runs'){const b=validate(await body(req),{projectId:{type:'string',required:true,max:128},threadId:{type:'string',nullable:true,max:128},mode:{type:'string',required:true,enum:['ask','review','edit']},prompt:{type:'string',required:true,maxBytes:160000},requestId:{type:'string',required:true,max:128}});const out=await core.startRun(b);return json(res,out.reused?200:202,out);}
    if(req.method==='GET'&&p[0]==='v1'&&p[1]==='runs'&&p[2]&&p.length===3){const r=core.getRun(p[2]);if(!r)throw new Error('RUN_NOT_FOUND');return json(res,200,{run:r});}
    if(req.method==='GET'&&p.length===4&&p[0]==='v1'&&p[1]==='runs'&&p[2]&&p[3]==='preview')return json(res,200,await core.previewRun(p[2]));
    if(req.method==='POST'&&p.length===4&&p[0]==='v1'&&p[1]==='runs'&&p[2]&&p[3]==='cancel'){emptyBody(await body(req));return json(res,200,{run:await core.cancelRun(p[2])});}
    if(req.method==='POST'&&p.length===4&&p[0]==='v1'&&p[1]==='runs'&&p[2]&&p[3]==='apply'){emptyBody(await body(req));return json(res,200,await core.applyRun(p[2]));}
    if(req.method==='POST'&&p.length===4&&p[0]==='v1'&&p[1]==='runs'&&p[2]&&p[3]==='discard'){emptyBody(await body(req));return json(res,200,{run:await core.discardRun(p[2])});}
    if(req.method==='POST'&&p.length===4&&p[0]==='v1'&&p[1]==='runs'&&p[2]&&p[3]==='reconcile'){emptyBody(await body(req));return json(res,200,await core.reconcileRun(p[2]));}
    if(req.method==='POST'&&u.pathname==='/v1/handoff'){const b=validate(await body(req),{projectId:{type:'string',required:true,max:128},threadId:{type:'string',nullable:true,max:128}});return json(res,200,{text:core.handoff(b.projectId,b.threadId||null)});}
    if(req.method==='POST'&&u.pathname==='/v1/shutdown'){emptyBody(await body(req));shutdownRequested=true;core.setMaintenance(true);json(res,200,{ok:true});setTimeout(()=>shutdown('api'),25);return;}
    return json(res,404,{error:'NOT_FOUND'});
  }catch(e){return json(res,statusForError(e),{error:redactError(e)});}
});
server.maxHeadersCount=64;server.headersTimeout=5000;server.requestTimeout=10000;server.keepAliveTimeout=3000;server.maxConnections=100;
server.on('clientError',(_e,socket)=>{try{socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')}catch{}});

async function assertNoLiveOwnerLock(){
  const old=await readJson(lockPath,null);if(!old?.pid)return;const pid=Number(old.pid);if(!Number.isInteger(pid)||pid<=0||!isPidAlive(pid))return;
  const identity=typeof old.processIdentity==='string'?old.processIdentity:'';const supported=process.platform==='win32'?/^win32:\d+$/.test(identity):process.platform==='linux'?/^linux:\d+$/.test(identity):identity.startsWith(`${process.platform}:`);
  if(!identity||!supported||processMatchesIdentity(pid,identity))throw new Error('HOST_OWNER_LOCK_LIVE_OR_AMBIGUOUS');
}
async function bind(){return await new Promise((resolve,reject)=>{const onError=e=>{server.off('listening',onListen);reject(e);};const onListen=()=>{server.off('error',onError);resolve();};server.once('error',onError);server.once('listening',onListen);server.listen(cfg.port,'127.0.0.1');});}
async function releaseHostLock(){try{const cur=await readJson(lockPath,null);if(cur?.instanceId===hostInstanceId&&Number(cur.pid)===process.pid)await fsp.rm(lockPath,{force:true});}catch{}}
async function shutdown(_reason,exitCode=0){shutdownRequested=true;if(shutting)return;shutting=true;let finalExit=exitCode;if(core){core.setMaintenance(true);try{await core.gemini.cancelInteractiveAuth?.();}catch{}try{await core.shutdownActive({timeoutMs:5000});}catch(e){console.error(`Bridge Host active-run shutdown failed: ${redactError(e)}`);if(finalExit===0)finalExit=1;}}await new Promise(resolve=>{const t=setTimeout(()=>{try{server.closeAllConnections?.();}catch{}resolve();},2000);server.close(()=>{clearTimeout(t);resolve();});});try{core?.store?.db?.close();}catch{}await releaseHostLock();process.exit(finalExit);}

try{await assertNoLiveOwnerLock();await bind();}catch(e){const startupError=`HOST_LISTEN_FAILED:${redactError(e?.code||e?.message||e)}`;await writeJson(startupErrorPath,{at:new Date().toISOString(),error:startupError}).catch(()=>{});console.error(`Bridge Host listen failed: ${startupError}`);process.exit(2);}
try{
  await writeJson(lockPath,{pid:process.pid,processIdentity:hostProcessIdentity,instanceId:hostInstanceId,launchNonce,startedAt:new Date().toISOString()});
  core=await new BridgeCore({stateRoot:root,geminiEntry:cfg.geminiEntry||null,expectedGeminiVersion:cfg.geminiVersion??null}).init();const runtime=await core.verifyRuntime();if(!runtime.ok)throw new Error(`GEMINI_RUNTIME_NOT_READY:${runtime.error}`);ready=true;await fsp.rm(startupErrorPath,{force:true}).catch(()=>{});console.log(`Gemini Bridge Host v${APP_VERSION} listening on 127.0.0.1:${cfg.port}`);
}catch(e){const startupError=redactError(e);await writeJson(startupErrorPath,{at:new Date().toISOString(),error:startupError}).catch(()=>{});console.error(`Bridge Host initialization failed: ${startupError}`);await shutdown('init-failure',2);}
process.on('SIGINT',()=>shutdown('SIGINT'));process.on('SIGTERM',()=>shutdown('SIGTERM'));process.on('uncaughtException',async e=>{console.error(e);await shutdown('uncaughtException',1);});
