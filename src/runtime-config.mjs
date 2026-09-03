import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import { ensureDir, readJson, writeJson, exists, processIdentitySync, processMatchesIdentity } from './utils.mjs';

const INIT_LOCK='runtime.init.lock';
async function assertOwnedRegularFile(file,code='RUNTIME_CONFIG_UNSAFE_FILE'){
  let st;
  try{st=await fsp.lstat(file);}catch(e){if(e?.code==='ENOENT')return false;throw e;}
  if(st.isSymbolicLink()||!st.isFile())throw new Error(code);
  return true;
}
async function readOwnedRuntimeText(file){
  let before;
  try{before=await fsp.lstat(file);}catch(e){if(e?.code==='ENOENT')throw new Error('RUNTIME_CONFIG_CORRUPT');throw e;}
  if(before.isSymbolicLink()||!before.isFile())throw new Error('RUNTIME_CONFIG_UNSAFE_FILE');
  const h=await fsp.open(file,'r');
  try{
    const opened=await h.stat();
    const after=await fsp.lstat(file);
    if(after.isSymbolicLink()||!after.isFile()||opened.dev!==after.dev||opened.ino!==after.ino||before.dev!==after.dev||before.ino!==after.ino)throw new Error('RUNTIME_CONFIG_UNSAFE_FILE');
    return await h.readFile({encoding:'utf8'});
  }finally{await h.close();}
}
async function readRuntimeConfigFile(file){
  const text=await readOwnedRuntimeText(file);
  try{return JSON.parse(text.replace(/^\uFEFF/,''));}catch{throw new Error('RUNTIME_CONFIG_CORRUPT');}
}

function validConfig(cfg){return Boolean(cfg&&typeof cfg==='object'&&!Array.isArray(cfg)&&/^[a-f0-9]{64}$/.test(String(cfg.token||''))&&Number.isInteger(Number(cfg.port))&&Number(cfg.port)>=1024&&Number(cfg.port)<=65535);}
function validateExisting(cfg){
  if(!cfg||typeof cfg!=='object'||Array.isArray(cfg))throw new Error('RUNTIME_CONFIG_CORRUPT');
  if(cfg.token!==undefined&&!/^[a-f0-9]{64}$/.test(String(cfg.token)))throw new Error('RUNTIME_CONFIG_INVALID_TOKEN');
  if(cfg.port!==undefined&&(!Number.isInteger(Number(cfg.port))||Number(cfg.port)<1024||Number(cfg.port)>65535))throw new Error('RUNTIME_CONFIG_INVALID_PORT');
  if(cfg.geminiVersion!==undefined&&(typeof cfg.geminiVersion!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(cfg.geminiVersion)))throw new Error('RUNTIME_CONFIG_INVALID_GEMINI_VERSION');
  for(const [key,code] of [['nodePath','RUNTIME_CONFIG_INVALID_NODE_PATH'],['geminiEntry','RUNTIME_CONFIG_INVALID_GEMINI_ENTRY']]){
    if(cfg[key]===undefined)continue;const v=cfg[key];
    if(typeof v!=='string'||v.length<1||v.length>32768||/[\0\r\n]/.test(v)||!path.isAbsolute(v))throw new Error(code);
  }
  return cfg;
}
export async function portFree(port){return await new Promise(resolve=>{const s=net.createServer();s.unref();s.once('error',()=>resolve(false));s.listen({host:'127.0.0.1',port},()=>s.close(()=>resolve(true)));});}
export async function findFreePort(preferred=38473){
  const first=Number.isInteger(Number(preferred))?Number(preferred):38473;
  if(first>=1024&&first<=65535&&await portFree(first))return first;
  for(let p=38473;p<=38573;p++){if(p!==first&&await portFree(p))return p;}
  throw new Error('NO_FREE_LOCAL_PORT');
}
async function acquireInitLock(stateRoot){
  const lock=path.join(stateRoot,INIT_LOCK);const nonce=crypto.randomBytes(16).toString('hex');
  for(let i=0;i<400;i++){
    try{
      const h=await fsp.open(lock,'wx');const owner={pid:process.pid,processIdentity:processIdentitySync(process.pid),nonce,createdAt:new Date().toISOString()};
      try{await h.writeFile(JSON.stringify(owner));await h.sync();}finally{await h.close();}
      return async()=>{try{const cur=await readJson(lock,null);if(cur?.nonce===nonce&&Number(cur.pid)===process.pid)await fsp.rm(lock,{force:true});}catch{}};
    }catch(e){
      if(e?.code!=='EEXIST')throw e;
      const st=await fsp.stat(lock).catch(()=>null),owner=await readJson(lock,null);
      const stale=st&&Date.now()-st.mtimeMs>10000&&(!owner?.pid||!owner?.processIdentity||!processMatchesIdentity(Number(owner.pid),owner.processIdentity));
      if(stale){const again=await fsp.stat(lock).catch(()=>null);if(again&&again.ino===st.ino&&again.dev===st.dev)await fsp.rm(lock,{force:true}).catch(()=>{});continue;}
      await new Promise(r=>setTimeout(r,25));
    }
  }
  throw new Error('RUNTIME_CONFIG_INIT_BUSY');
}

export async function loadRuntimeConfig(stateRoot){
  const file=path.join(stateRoot,'runtime.json');
  if(!await assertOwnedRegularFile(file))throw new Error('RUNTIME_CONFIG_MISSING');
  const cfg=await readRuntimeConfigFile(file);validateExisting(cfg);
  if(!cfg.token||cfg.port===undefined)throw new Error('RUNTIME_CONFIG_INCOMPLETE');
  return cfg;
}

export async function ensureRuntimeConfig(stateRoot){
  await ensureDir(stateRoot);const file=path.join(stateRoot,'runtime.json');
  if(await assertOwnedRegularFile(file)){const cfg=await readRuntimeConfigFile(file);validateExisting(cfg);if(!cfg.token||cfg.port===undefined)throw new Error('RUNTIME_CONFIG_INCOMPLETE');return cfg;}
  const release=await acquireInitLock(stateRoot);
  try{
    if(await assertOwnedRegularFile(file)){const cfg=await readRuntimeConfigFile(file);validateExisting(cfg);if(!cfg.token||cfg.port===undefined)throw new Error('RUNTIME_CONFIG_INCOMPLETE');return cfg;}
    const cfg={token:crypto.randomBytes(32).toString('hex'),port:await findFreePort(38473)};await writeJson(file,cfg);return cfg;
  }finally{await release();}
}

export async function repairRuntimeConfig(stateRoot){
  await ensureDir(stateRoot);const file=path.join(stateRoot,'runtime.json');const release=await acquireInitLock(stateRoot);
  try{
    let cfg=null,corrupt=false;
    if(await assertOwnedRegularFile(file)){
      let raw='';
      try{raw=await readOwnedRuntimeText(file);try{cfg=JSON.parse(raw.replace(/^\uFEFF/,''));}catch{throw new Error('RUNTIME_CONFIG_CORRUPT');}validateExisting(cfg);}
      catch(e){
        if(e?.message==='RUNTIME_CONFIG_UNSAFE_FILE')throw e;
        corrupt=true;const backup=path.join(stateRoot,`runtime.corrupt-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`);
        if(raw)await fsp.writeFile(backup,raw,{flag:'wx'}).catch(()=>{});cfg=null;
      }
    }
    if(!cfg)cfg={token:crypto.randomBytes(32).toString('hex')};if(!cfg.token)cfg.token=crypto.randomBytes(32).toString('hex');cfg.port=await findFreePort(cfg.port===undefined?38473:Number(cfg.port));await writeJson(file,cfg);return {...cfg,repaired:corrupt};
  }finally{await release();}
}
