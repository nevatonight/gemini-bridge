import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const APP_VERSION = '0.4.7';
export const TERMINAL_RUNS = new Set(['COMPLETED','APPLIED','DISCARDED','FAILED','CANCELLED']);

export function nowIso(){ return new Date().toISOString(); }
export function uuid(){ return crypto.randomUUID(); }
export function sha256(data){ return crypto.createHash('sha256').update(data).digest('hex'); }
export function stableJson(value){
  if(value === null || typeof value !== 'object') return JSON.stringify(value);
  if(Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stableJson(value[k])).join(',') + '}';
}
export function fingerprint(value){ return sha256(stableJson(value)); }
export function assertId(value, name='id'){
  if(typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw new Error(`INVALID_${name.toUpperCase()}`);
  return value;
}
export function safeRunDirName(requestId){ return sha256(String(requestId)); }
export function normalizeRel(rel){
  if(typeof rel !== 'string' || !rel) throw new Error('INVALID_RELATIVE_PATH');
  const s = rel.replaceAll('\\','/');
  if(s.startsWith('/') || /^[A-Za-z]:\//.test(s) || s.includes('\0')) throw new Error('PATH_ESCAPE');
  const n = path.posix.normalize(s);
  if(n === '..' || n.startsWith('../') || n === '.') throw new Error('PATH_ESCAPE');
  return n;
}
export function within(root, target){
  const r = path.resolve(root);
  const t = path.resolve(target);
  const rel = path.relative(r,t);
  return rel === '' || (!rel.startsWith('..'+path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
export async function ensureDir(dir){ await fsp.mkdir(dir,{recursive:true}); }
export async function ensureOwnedDir(root,target){
  const r=path.resolve(root),t=path.resolve(target);
  if(!within(r,t))throw new Error('STATE_DIR_UNSAFE');
  await fsp.mkdir(r,{recursive:true});
  let rst=await fsp.lstat(r);if(rst.isSymbolicLink()||!rst.isDirectory())throw new Error('STATE_DIR_UNSAFE');
  if(t===r)return t;
  let cur=r;
  for(const seg of path.relative(r,t).split(path.sep).filter(Boolean)){
    cur=path.join(cur,seg);
    try{await fsp.mkdir(cur);}catch(e){if(e?.code!=='EEXIST')throw e;}
    const st=await fsp.lstat(cur);if(st.isSymbolicLink()||!st.isDirectory())throw new Error('STATE_DIR_UNSAFE');
  }
  return t;
}
export async function exists(p){ try{ await fsp.access(p); return true; }catch{return false;} }
export async function fileHash(p){ try{ const st=await fsp.lstat(p); if(!st.isFile() || st.isSymbolicLink()) return null; return sha256(await fsp.readFile(p)); }catch{return null;} }
export async function atomicWrite(file, data){
  await ensureDir(path.dirname(file));
  const tmp = `${file}.gbtmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  await fsp.writeFile(tmp,data);
  try{ await fsp.rename(tmp,file); }
  catch(e){await fsp.unlink(tmp).catch(()=>{});throw e;}
}
export async function readJson(file, fallback=null){ try{const t=await fsp.readFile(file,'utf8');return JSON.parse(t.replace(/^\uFEFF/,''));}catch{return fallback;} }
export async function writeJson(file, value){ await atomicWrite(file, JSON.stringify(value,null,2)); }
export function stateRoot(){
  if(process.env.GEMINI_BRIDGE_STATE) return path.resolve(process.env.GEMINI_BRIDGE_STATE);
  if(process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || process.env.USERPROFILE || '.', 'GeminiBridge','state-v3');
  return path.join(process.env.HOME || '/tmp','.gemini-bridge','state-v3');
}
export function installRoot(){ return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); }
export function redactError(e){ return String(e?.message || e || 'Unknown error').slice(0,2000); }
export function parseJsonLinesChunk(state, chunk, onObject){
  state.buf += chunk;
  let i;
  while((i=state.buf.indexOf('\n'))>=0){
    const line=state.buf.slice(0,i).trim(); state.buf=state.buf.slice(i+1);
    if(!line)continue;
    let obj;try{obj=JSON.parse(line);}catch{throw new Error('GEMINI_PROTOCOL_INVALID_JSON');}
    onObject(obj);
  }
}
export function finalJsonLine(state,onObject){
  const line=state.buf.trim();state.buf='';if(!line)return;
  let obj;try{obj=JSON.parse(line);}catch{throw new Error('GEMINI_PROTOCOL_INVALID_JSON');}
  onObject(obj);
}
export function noStoreHeaders(extra={}){ return {'Cache-Control':'no-store','Pragma':'no-cache',...extra}; }
export function isPidAlive(pid){
  if(!Number.isInteger(pid) || pid<=0) return false;
  try{ process.kill(pid,0); return true; }catch{return false;}
}
export function processIdentitySync(pid){
  if(!Number.isInteger(pid)||pid<=0||!isPidAlive(pid))return null;
  try{
    if(process.platform==='linux'){
      const raw=fs.readFileSync(`/proc/${pid}/stat`,'utf8');const end=raw.lastIndexOf(')');if(end<0)return null;
      const rest=raw.slice(end+1).trim().split(/\s+/);const start=rest[19];return start?`linux:${start}`:null;
    }
    if(process.platform==='win32'){
      const ps=process.env.SystemRoot?path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'):'powershell.exe';
      const script=`$p=Get-Process -Id ${pid} -ErrorAction Stop; [Console]::Write($p.StartTime.ToUniversalTime().Ticks)`;
      const out=execFileSync(ps,['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',timeout:3000,windowsHide:true,stdio:['ignore','pipe','ignore']}).trim();
      return /^\d+$/.test(out)?`win32:${out}`:null;
    }
    const out=execFileSync('ps',['-o','lstart=','-p',String(pid)],{encoding:'utf8',timeout:3000,stdio:['ignore','pipe','ignore']}).trim();
    return out?`${process.platform}:${out}`:null;
  }catch{return null;}
}
export async function processIdentity(pid){ return processIdentitySync(pid); }
export function processMatchesIdentity(pid,identity){ return typeof identity==='string'&&identity.length>0&&processIdentitySync(pid)===identity; }
export async function canonicalWorkspace(workspace){
  if(!workspace) return null;
  let raw=String(workspace).trim();
  if(raw.length>=2&&((raw.startsWith('\"')&&raw.endsWith('\"'))||(raw.startsWith("'")&&raw.endsWith("'")))) raw=raw.slice(1,-1).trim();
  if(!raw) throw new Error('WORKSPACE_REQUIRED');
  const abs=path.resolve(raw);
  const real=await fsp.realpath(abs);
  const st=await fsp.stat(real);
  if(!st.isDirectory()) throw new Error('WORKSPACE_NOT_DIRECTORY');
  return real;
}
export function workspaceIdentity(canonical){ return sha256(process.platform==='win32'?canonical.toLowerCase():canonical); }
export async function copyTextToClipboardHint(){ return null; }
