import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureDir, ensureOwnedDir, sha256, writeJson, readJson, normalizeRel, within, fileHash, atomicWrite, exists } from './utils.mjs';

const MANIFEST_VERSION = 3;
const SKIP_DIRS = new Set(['.git','.gemini','node_modules','vendor','.idea','.vs','.cache','.next','.nuxt','dist','build','coverage','tmp','temp','__pycache__','.pytest_cache','.mypy_cache','.gradle']);
const SENSITIVE_NAMES = [
  /^\.env(?:\.|$)/i,/^wp-config\.php$/i,/^GEMINI(?:\.[^.]+)?\.md$/i,/^\.npmrc$/i,/^\.pypirc$/i,/^\.netrc$/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i,/credentials?(?:\..+)?$/i,/secrets?(?:\..+)?$/i,
  /service[-_]?account.*\.json$/i,/firebase.*\.json$/i,/\.pem$/i,/\.key$/i,/\.p12$/i,/\.pfx$/i,/\.jks$/i,/\.keystore$/i,
  /^\.gb-stage-[a-f0-9]{32}$/i
];
const HIGH_CONF_SECRET = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bsk-proj-[A-Za-z0-9_-]{20,}\b/,
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/,
  /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/
];
const CREDENTIAL_KEY = /(?:password|passwd|db[_-]?password|secret|client[_-]?secret|api[_-]?key|access[_-]?token|auth[_-]?token|aws[_-]?secret[_-]?access[_-]?key)/i;
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const MAX_DEPTH=24, MAX_ENTRIES=12000, MAX_TOTAL=80*1024*1024, MAX_FILE=3*1024*1024, MAX_REL=320;
const UTF8_FATAL = new TextDecoder('utf-8',{fatal:true});

function sensitiveName(name){ return SENSITIVE_NAMES.some(r=>r.test(name)); }
function excludedDir(name){ return SKIP_DIRS.has(String(name).toLowerCase()); }
function decodeUtf8(buf){ try{return UTF8_FATAL.decode(buf);}catch{throw new Error('INVALID_UTF8');} }
function looksBinary(buf){ const n=Math.min(buf.length,8192); for(let i=0;i<n;i++) if(buf[i]===0) return true; return false; }
function containsHighSecret(text){ return HIGH_CONF_SECRET.some(r=>r.test(text)); }
function placeholderCredential(raw){
  const v=String(raw??'').trim().replace(/[;,]$/,'').trim();
  const unquoted=(v.length>=2&&((v[0]==='"'&&v.at(-1)==='"')||(v[0]==="'"&&v.at(-1)==="'")))?v.slice(1,-1).trim():v;
  if(!unquoted) return true;
  if(/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(unquoted)||/^%[A-Za-z_][A-Za-z0-9_]*%$/.test(unquoted)||/^<[^>]+>$/.test(unquoted)||/^\{\{[^}]+\}\}$/.test(unquoted)) return true;
  if(/^(?:process\.env\.|env\(|os\.environ|System\.getenv|ENV\[)/i.test(unquoted)) return true;
  if(/^(?:null|none|true|false|undefined|example|sample|changeme|change_me|replace_me|placeholder|your[_-]?(?:password|secret|token|key)|x{4,}|\*{4,})$/i.test(unquoted)) return true;
  if(/(?:^|[_-])(example|sample|changeme|replace[_-]?me|placeholder)(?:$|[_-])/i.test(unquoted)) return true;
  return false;
}
function containsCredentialAssignment(text){
  // Valid JSON gets structural handling so compact JSON does not depend on
  // punctuation heuristics and environment placeholders remain intact.
  try{
    const value=JSON.parse(String(text));
    const stack=[value];
    while(stack.length){
      const cur=stack.pop();
      if(Array.isArray(cur)){stack.push(...cur);continue;}
      if(!cur||typeof cur!=='object')continue;
      for(const [key,val] of Object.entries(cur)){
        if(CREDENTIAL_KEY.test(key) && typeof val==='string' && !placeholderCredential(val) && val.trim().length>=8)return true;
        if(val&&typeof val==='object')stack.push(val);
      }
    }
  }catch{}
  for(const m of String(text).matchAll(/\bhttps?:\/\/[^\s\/:@]+:([^\s\/@]+)@/gi)) if(!placeholderCredential(m[1])) return true;
  for(const line of String(text).split(/\r?\n/)){
    if(!CREDENTIAL_KEY.test(line)) continue;
    const m=line.match(/^\s*["']?([A-Za-z0-9_.-]*(?:password|passwd|secret|token|api[_-]?key)[A-Za-z0-9_.-]*)["']?\s*[:=]\s*(.+?)\s*$/i);
    if(!m) continue;
    let value=m[2].trim().replace(/,\s*$/,'').replace(/\s+#.*$/,'').trim();
    if(placeholderCredential(value)) continue;
    const plain=(value.length>=2&&((value[0]==='"'&&value.at(-1)==='"')||(value[0]==="'"&&value.at(-1)==="'")))?value.slice(1,-1):value;
    if(plain.trim().length>=8) return true;
  }
  return false;
}
function safeRel(rel){ return normalizeRel(rel); }
function portablePathError(rel){
  for(const seg of rel.replaceAll('\\','/').split('/')){
    if(!seg) return 'empty-segment';
    if(seg.includes(':')) return 'colon';
    if(/[ .]$/.test(seg)) return 'trailing-dot-space';
    if(WINDOWS_RESERVED.test(seg)) return 'reserved-name';
  }
  return null;
}
function portableKey(rel){ return rel.normalize('NFC').toLowerCase(); }
function forbiddenRel(rel){
  const parts=rel.replaceAll('\\','/').split('/');
  return parts.some(excludedDir)||sensitiveName(parts.at(-1)||'')||Boolean(portablePathError(rel));
}
function registerPortable(seen,rel,kind){
  const key=portableKey(rel);const prev=seen.get(key);
  if(prev && (prev.rel!==rel || prev.kind!==kind)) throw new Error(`WINDOWS_PATH_COLLISION:${prev.rel}:${rel}`);
  seen.set(key,{rel,kind});
}
function assertManifest(manifest){
  if(!manifest || typeof manifest!=='object' || Array.isArray(manifest)) throw new Error('SNAPSHOT_MANIFEST_INVALID');
  if(manifest.version!==MANIFEST_VERSION) throw new Error('SNAPSHOT_MANIFEST_VERSION_UNSUPPORTED');
  if(typeof manifest.source!=='string'||!manifest.source) throw new Error('SNAPSHOT_MANIFEST_INVALID');
  if(!manifest.sourceIdentity||typeof manifest.sourceIdentity!=='object') throw new Error('SNAPSHOT_MANIFEST_INVALID');
  if(!manifest.files||typeof manifest.files!=='object'||Array.isArray(manifest.files)) throw new Error('SNAPSHOT_MANIFEST_INVALID');
  if(!Array.isArray(manifest.directories)) throw new Error('SNAPSHOT_MANIFEST_INVALID');
  const seen=new Map();
  for(const rel of manifest.directories){
    if(typeof rel!=='string'||safeRel(rel)!==rel||portablePathError(rel)) throw new Error('SNAPSHOT_MANIFEST_INVALID');
    registerPortable(seen,rel,'dir');
  }
  for(const [rel,row] of Object.entries(manifest.files)){
    if(safeRel(rel)!==rel||portablePathError(rel)||!row||typeof row!=='object'||!/^[a-f0-9]{64}$/.test(row.hash)||!Number.isSafeInteger(row.size)||row.size<0) throw new Error('SNAPSHOT_MANIFEST_INVALID');
    registerPortable(seen,rel,'file');
  }
  return manifest;
}

export async function buildSnapshot(workspace,snapshotDir,{mode='review',signal=null,ownedRoot=null}={}){
  const checkCancel=()=>{if(signal?.aborted)throw new Error('CANCELLED');};
  checkCancel();
  const source=await fsp.realpath(workspace); const sourceLstat=await fsp.lstat(source);if(sourceLstat.isSymbolicLink()||!sourceLstat.isDirectory())throw new Error('WORKSPACE_NOT_DIRECTORY');const sourceStat=await fsp.stat(source); if(ownedRoot)await ensureOwnedDir(ownedRoot,snapshotDir);else await ensureDir(snapshotDir);
  const filesDir=path.join(snapshotDir,'files'); if(ownedRoot)await ensureOwnedDir(ownedRoot,filesDir);else await ensureDir(filesDir);
  const manifest={version:MANIFEST_VERSION,source,sourceIdentity:{dev:String(sourceStat.dev??0),ino:String(sourceStat.ino??0),birthtimeMs:Math.trunc(Number(sourceStat.birthtimeMs||0))},mode,createdAt:new Date().toISOString(),files:{},directories:[],skipped:[],stats:{entries:0,files:0,bytes:0}};
  const seen=new Map();
  async function proveDirectory(abs,expected=null){
    let lst,real;try{lst=await fsp.lstat(abs);real=await fsp.realpath(abs);}catch{throw new Error('WORKSPACE_DIR_CHANGED_DURING_SNAPSHOT');}
    if(lst.isSymbolicLink()||!lst.isDirectory()||!within(source,real))throw new Error('WORKSPACE_DIR_CHANGED_DURING_SNAPSHOT');
    if(expected){
      if(Number(expected.dev??0)!==0&&Number(lst.dev??0)!==Number(expected.dev??0))throw new Error('WORKSPACE_DIR_CHANGED_DURING_SNAPSHOT');
      if(Number(expected.ino??0)!==0&&Number(lst.ino??0)!==Number(expected.ino??0))throw new Error('WORKSPACE_DIR_CHANGED_DURING_SNAPSHOT');
    }
    return lst;
  }
  async function walk(abs,rel='',depth=0,expected=null){
    checkCancel();if(depth>MAX_DEPTH) throw new Error('WORKSPACE_TOO_DEEP');
    const before=await proveDirectory(abs,expected);const ents=await fsp.readdir(abs,{withFileTypes:true});await proveDirectory(abs,before);
    for(const ent of ents){
      checkCancel();manifest.stats.entries++; if(manifest.stats.entries>MAX_ENTRIES) throw new Error('WORKSPACE_TOO_MANY_ENTRIES');
      const childRel=safeRel(rel?`${rel}/${ent.name}`:ent.name); if(childRel.length>MAX_REL){manifest.skipped.push({path:childRel,reason:'path-too-long'});continue;}
      const pathReason=portablePathError(childRel);if(pathReason){manifest.skipped.push({path:childRel,reason:`windows-unsafe-${pathReason}`});continue;}
      registerPortable(seen,childRel,ent.isDirectory()?'dir':'file');
      const child=path.join(abs,ent.name); const lst=await fsp.lstat(child);
      if(lst.isSymbolicLink()){manifest.skipped.push({path:childRel,reason:'symlink-or-junction'});continue;}
      if(excludedDir(ent.name)){manifest.skipped.push({path:childRel,reason:'excluded-path'});continue;}
      if(lst.isDirectory()){
        manifest.directories.push(childRel);await walk(child,childRel,depth+1,lst); continue;
      }
      if(!lst.isFile()) continue;
      if(sensitiveName(ent.name)){manifest.skipped.push({path:childRel,reason:'sensitive-name'});continue;}
      if(Number(lst.nlink)>1){manifest.skipped.push({path:childRel,reason:'hardlink'});continue;}
      if(lst.size>MAX_FILE){manifest.skipped.push({path:childRel,reason:'file-too-large'});continue;}
      let fh;let buf;try{fh=await fsp.open(child,'r');const fst=await fh.stat();if(!fst.isFile())throw new Error('WORKSPACE_FILE_CHANGED_DURING_SNAPSHOT');if(Number(fst.nlink)>1){manifest.skipped.push({path:childRel,reason:'hardlink'});continue;}if(String(lst.dev??0)!=='0'&&String(fst.dev??0)!==String(lst.dev??0))throw new Error('WORKSPACE_FILE_CHANGED_DURING_SNAPSHOT');if(String(lst.ino??0)!=='0'&&String(fst.ino??0)!==String(lst.ino??0))throw new Error('WORKSPACE_FILE_CHANGED_DURING_SNAPSHOT');let realChild;try{realChild=await fsp.realpath(child);}catch{throw new Error('WORKSPACE_FILE_CHANGED_DURING_SNAPSHOT');}if(!within(source,realChild))throw new Error('WORKSPACE_PATH_CHANGED_DURING_SNAPSHOT');buf=await fh.readFile();}finally{await fh?.close().catch(()=>{});}
      checkCancel();if(looksBinary(buf)){manifest.skipped.push({path:childRel,reason:'binary'});continue;}
      let text;try{text=decodeUtf8(buf);}catch{manifest.skipped.push({path:childRel,reason:'invalid-utf8'});continue;}
      if(containsHighSecret(text)||containsCredentialAssignment(text)){manifest.skipped.push({path:childRel,reason:'secret-signature'});continue;}
      manifest.stats.bytes+=buf.length; if(manifest.stats.bytes>MAX_TOTAL) throw new Error('WORKSPACE_SNAPSHOT_TOO_LARGE');
      const out=path.join(filesDir,...childRel.split('/')); if(!within(filesDir,out)) throw new Error('PATH_ESCAPE');
      await ensureDir(path.dirname(out)); await fsp.writeFile(out,buf);
      manifest.files[childRel]={hash:sha256(buf),size:buf.length}; manifest.stats.files++;
    }
  }
  await walk(source);checkCancel();
  const mf=path.join(snapshotDir,'manifest.json'); await writeJson(mf,manifest);
  return {snapshotDir,filesDir,manifestPath:mf,manifest};
}

async function enumerateSnapshotFiles(filesDir,manifest){
  const out={};let entries=0,total=0;const seen=new Map();const originalDirs=new Set(manifest.directories);
  async function walk(abs,rel='',depth=0){
    if(depth>MAX_DEPTH)throw new Error('SNAPSHOT_OUTPUT_TOO_DEEP');
    const ents=await fsp.readdir(abs,{withFileTypes:true}).catch(()=>[]);
    for(const ent of ents){
      entries++;if(entries>MAX_ENTRIES)throw new Error('SNAPSHOT_OUTPUT_TOO_MANY_ENTRIES');
      const cr=safeRel(rel?`${rel}/${ent.name}`:ent.name);if(cr.length>MAX_REL)throw new Error(`SNAPSHOT_OUTPUT_PATH_TOO_LONG:${cr.slice(0,80)}`);if(portablePathError(cr))throw new Error(`SNAPSHOT_OUTPUT_WINDOWS_PATH_BLOCKED:${cr}`);
      const p=path.join(abs,ent.name);const st=await fsp.lstat(p);const kind=st.isDirectory()?'dir':'file';registerPortable(seen,cr,kind);
      if(st.isSymbolicLink()) throw new Error(`SNAPSHOT_SYMLINK_DETECTED:${cr}`);
      if(forbiddenRel(cr)) throw new Error(`SNAPSHOT_OUTPUT_BLOCKED:${cr}`);
      if(Number(st.nlink)>1 && st.isFile()) throw new Error(`SNAPSHOT_HARDLINK_DETECTED:${cr}`);
      if(st.isDirectory()){
        if(Object.prototype.hasOwnProperty.call(manifest.files,cr)) throw new Error(`SNAPSHOT_TYPE_CHANGE_BLOCKED:${cr}`);
        await walk(p,cr,depth+1);continue;
      }
      if(st.isFile()){
        if(originalDirs.has(cr)) throw new Error(`SNAPSHOT_TYPE_CHANGE_BLOCKED:${cr}`);
        if(st.size>MAX_FILE)throw new Error(`SNAPSHOT_OUTPUT_FILE_TOO_LARGE:${cr}`);const b=await fsp.readFile(p);if(looksBinary(b))throw new Error(`SNAPSHOT_BINARY_OUTPUT_BLOCKED:${cr}`);
        let text;try{text=decodeUtf8(b);}catch{throw new Error(`SNAPSHOT_INVALID_UTF8_BLOCKED:${cr}`);}
        if(containsHighSecret(text)||containsCredentialAssignment(text))throw new Error(`SNAPSHOT_SECRET_OUTPUT_BLOCKED:${cr}`);total+=b.length;if(total>MAX_TOTAL)throw new Error('SNAPSHOT_OUTPUT_TOO_LARGE');out[cr]={hash:sha256(b),size:b.length};
      }
    }
  }
  await walk(filesDir); return out;
}

export async function computeDiff(snapshotDir){
  const manifest=assertManifest(await readJson(path.join(snapshotDir,'manifest.json'))); 
  const filesDir=path.join(snapshotDir,'files'); const current=await enumerateSnapshotFiles(filesDir,manifest); const changes=[];
  for(const [rel,before] of Object.entries(manifest.files)){
    const after=current[rel];
    if(!after) changes.push({path:rel,type:'delete',beforeHash:before.hash,afterHash:null});
    else if(after.hash!==before.hash) changes.push({path:rel,type:'update',beforeHash:before.hash,afterHash:after.hash});
  }
  for(const [rel,after] of Object.entries(current)) if(!manifest.files[rel]) changes.push({path:rel,type:'add',beforeHash:null,afterHash:after.hash});
  changes.sort((a,b)=>a.path.localeCompare(b.path));
  return {manifest,current,changes};
}

async function assertSafeLivePath(root,rel,{allowMissing=true}={}){
  rel=safeRel(rel);if(portablePathError(rel))throw new Error(`LIVE_WINDOWS_PATH_UNSAFE:${rel}`); const target=path.join(root,...rel.split('/')); if(!within(root,target)) throw new Error('PATH_ESCAPE');
  let cur=root;const parts=rel.split('/');
  for(let i=0;i<parts.length-1;i++){
    cur=path.join(cur,parts[i]);
    try{const st=await fsp.lstat(cur);if(st.isSymbolicLink() || !st.isDirectory()) throw new Error(`LIVE_PATH_UNSAFE:${rel}`);}catch(e){if(e.code==='ENOENT'&&allowMissing)break;throw e;}
  }
  try{const st=await fsp.lstat(target); if(st.isSymbolicLink()) throw new Error(`LIVE_PATH_UNSAFE:${rel}`);}catch(e){if(e.code!=='ENOENT')throw e;}
  return target;
}

async function liveFileState(target){
  try{const st=await fsp.lstat(target);if(st.isSymbolicLink()||!st.isFile())return {exists:true,hash:null,regular:false,mode:st.mode};return {exists:true,hash:sha256(await fsp.readFile(target)),regular:true,mode:st.mode};}
  catch(e){if(e.code==='ENOENT')return {exists:false,hash:null,regular:false,mode:null};throw e;}
}

async function assertWorkspaceIdentity(run,manifest){
  const root=run.workspace_root;if(!root)throw new Error('WORKSPACE_REQUIRED');
  let lst,real,st;
  try{lst=await fsp.lstat(root);if(lst.isSymbolicLink()||!lst.isDirectory())throw new Error('WORKSPACE_IDENTITY_CHANGED');real=await fsp.realpath(root);st=await fsp.stat(real);}catch(e){if(e?.message==='WORKSPACE_IDENTITY_CHANGED')throw e;throw new Error('WORKSPACE_MISSING_OR_INACCESSIBLE');}
  const a=process.platform==='win32'?String(real).toLowerCase():String(real);const b=process.platform==='win32'?String(manifest.source).toLowerCase():String(manifest.source);if(a!==b)throw new Error('WORKSPACE_IDENTITY_CHANGED');
  const id=manifest.sourceIdentity||{};const checks=[];if(id.dev&&id.dev!=='0')checks.push(String(st.dev??0)===id.dev);if(id.ino&&id.ino!=='0')checks.push(String(st.ino??0)===id.ino);if(Number(id.birthtimeMs)>0)checks.push(Math.trunc(Number(st.birthtimeMs||0))===Number(id.birthtimeMs));if(checks.length&&checks.some(x=>!x))throw new Error('WORKSPACE_IDENTITY_CHANGED');
  return real;
}

const APPLY_JOURNAL_VERSION=1;
function applyJournalFile(run){if(!run?.snapshot_dir)throw new Error('RUN_HAS_NO_SNAPSHOT');return path.join(run.snapshot_dir,'apply-journal.json');}
function stagePathFor(target,nonce){return path.join(path.dirname(target),`.gb-stage-${nonce}`);}
async function writeApplyJournal(run,journal){
  await writeJson(applyJournalFile(run),journal);
}
async function readApplyJournal(run){
  const file=applyJournalFile(run);let raw;
  try{raw=await fsp.readFile(file,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}
  let j;try{j=JSON.parse(raw.replace(/^\uFEFF/,''));}catch{throw new Error('APPLY_JOURNAL_CORRUPT');}
  if(!j||typeof j!=='object'||Array.isArray(j)||j.version!==APPLY_JOURNAL_VERSION||j.runId!==run.id||!Array.isArray(j.entries))throw new Error('APPLY_JOURNAL_INVALID');
  const seen=new Set();
  for(const e of j.entries){
    if(!e||typeof e!=='object'||typeof e.path!=='string'||safeRel(e.path)!==e.path||seen.has(e.path)||!['add','update','delete'].includes(e.type))throw new Error('APPLY_JOURNAL_INVALID');
    seen.add(e.path);
    if(e.type==='delete'){
      if(e.stagePath!==null||e.nonce!==null||e.afterHash!==null)throw new Error('APPLY_JOURNAL_INVALID');
    }else{
      if(typeof e.nonce!=='string'||!/^([a-f0-9]{32})$/.test(e.nonce)||typeof e.stagePath!=='string'||!/^[a-f0-9]{64}$/.test(e.afterHash||''))throw new Error('APPLY_JOURNAL_INVALID');
      const target=path.join(run.workspace_root,...e.path.split('/'));const expected=stagePathFor(target,e.nonce);
      if(path.resolve(e.stagePath)!==path.resolve(expected)||!within(run.workspace_root,e.stagePath))throw new Error('APPLY_JOURNAL_STAGE_PATH_INVALID');
    }
    if(e.beforeHash!==null&&!/^[a-f0-9]{64}$/.test(e.beforeHash||''))throw new Error('APPLY_JOURNAL_INVALID');
  }
  return j;
}
async function safeRemoveRecordedStage(run,e){
  if(!e.stagePath)return false;
  const target=await assertSafeLivePath(run.workspace_root,e.path);const expected=stagePathFor(target,e.nonce);
  if(path.resolve(expected)!==path.resolve(e.stagePath))throw new Error('APPLY_JOURNAL_STAGE_PATH_INVALID');
  let st;try{st=await fsp.lstat(e.stagePath);}catch(err){if(err.code==='ENOENT')return false;throw err;}
  if(st.isSymbolicLink()||!st.isFile())throw new Error(`APPLY_STAGE_UNSAFE:${e.path}`);
  const h=await fileHash(e.stagePath);if(h!==e.afterHash)throw new Error(`APPLY_STAGE_HASH_MISMATCH:${e.path}`);
  await fsp.unlink(e.stagePath);return true;
}
async function cleanupApplyJournal(run,expectedChanges=null){
  const j=await readApplyJournal(run);if(!j)return false;
  const changeMap=expectedChanges?new Map(expectedChanges.map(c=>[c.path,c])):null;
  for(const e of j.entries){
    if(changeMap){const ch=changeMap.get(e.path);if(!ch||ch.type!==e.type||ch.beforeHash!==e.beforeHash||ch.afterHash!==e.afterHash)throw new Error(`APPLY_JOURNAL_CHANGE_MISMATCH:${e.path}`);}
    await safeRemoveRecordedStage(run,e);
  }
  await fsp.unlink(applyJournalFile(run)).catch(err=>{if(err.code!=='ENOENT')throw err;});
  return true;
}
async function createStage(run,ch,target,data,mode=null){
  const nonce=crypto.randomBytes(16).toString('hex');const stagePath=stagePathFor(target,nonce);
  const entry={path:ch.path,type:ch.type,beforeHash:ch.beforeHash,afterHash:ch.afterHash,nonce,stagePath};
  await writeApplyJournal(run,{version:APPLY_JOURNAL_VERSION,runId:run.id,createdAt:new Date().toISOString(),entries:[entry]});
  return {entry,stagePath};
}
async function writeStage(stagePath,data,mode=null){
  let fh;try{
    fh=await fsp.open(stagePath,'wx',0o666);await fh.writeFile(data);if(mode!==null)await fh.chmod(mode&0o7777);await fh.sync();
  }finally{await fh?.close().catch(()=>{});}
}
async function fireApplyHook(options,phase,ctx){if(typeof options?.onPhase==='function')await options.onPhase(phase,ctx);}
async function conflictResult(run){const after=await reconcileApply(run);return {ok:false,reconciliation:after,conflicts:after.conflicts};}

export async function reconcileApply(run){
  const root=run.workspace_root; if(!root || !run.snapshot_dir) throw new Error('RUN_HAS_NO_SNAPSHOT');
  const {manifest,changes}=await computeDiff(run.snapshot_dir); await assertWorkspaceIdentity(run,manifest);
  // A journal is trusted only after its run id, change hashes, deterministic
  // stage path and stage content all validate. Unknown content is never deleted.
  await cleanupApplyJournal(run,changes);
  const states=[];
  for(const ch of changes){
    const target=await assertSafeLivePath(root,ch.path); const live=await liveFileState(target);
    let state;
    if(ch.type==='add') state=!live.exists?'pending':(live.regular&&live.hash===ch.afterHash?'applied':'conflict');
    else if(ch.type==='delete') state=!live.exists?'applied':(live.regular&&live.hash===ch.beforeHash?'pending':'conflict');
    else state=live.regular&&live.hash===ch.beforeHash?'pending':(live.regular&&live.hash===ch.afterHash?'applied':'conflict');
    states.push({...ch,state});
  }
  return {changes:states,applied:states.filter(x=>x.state==='applied').length,pending:states.filter(x=>x.state==='pending').length,conflicts:states.filter(x=>x.state==='conflict')};
}

export async function applySnapshot(run,options={}){
  const root=run.workspace_root; const snapshotDir=run.snapshot_dir; const filesDir=path.join(snapshotDir,'files');
  const rec=await reconcileApply(run); if(rec.conflicts.length) return {ok:false,conflicts:rec.conflicts,reconciliation:rec};
  for(const ch of rec.changes.filter(x=>x.state==='pending')){
    let target=await assertSafeLivePath(root,ch.path);await ensureDir(path.dirname(target));target=await assertSafeLivePath(root,ch.path);
    if(ch.type==='delete'){
      const entry={path:ch.path,type:'delete',beforeHash:ch.beforeHash,afterHash:null,nonce:null,stagePath:null};
      await writeApplyJournal(run,{version:APPLY_JOURNAL_VERSION,runId:run.id,createdAt:new Date().toISOString(),entries:[entry]});
      await fireApplyHook(options,'after-journal',{run,ch,target,entry});
      target=await assertSafeLivePath(root,ch.path);
      await fireApplyHook(options,'before-final-check',{run,ch,target,entry});
      if(await fileHash(target)!==ch.beforeHash){await cleanupApplyJournal(run,[ch]);return await conflictResult(run);}
      await fsp.unlink(target);await fireApplyHook(options,'after-delete-unlink',{run,ch,target,entry});
      await cleanupApplyJournal(run,[ch]);continue;
    }
    const source=path.join(filesDir,...ch.path.split('/')); if(!within(filesDir,source)) throw new Error('PATH_ESCAPE');
    const data=await fsp.readFile(source); if(sha256(data)!==ch.afterHash) throw new Error(`SNAPSHOT_CHANGED_DURING_APPLY:${ch.path}`);
    let preserveMode=null;
    if(ch.type==='update'){
      const st=await fsp.lstat(target);if(st.isSymbolicLink()||!st.isFile())return await conflictResult(run);preserveMode=st.mode;
    }
    const {entry,stagePath}=await createStage(run,ch,target,data,preserveMode);
    await fireApplyHook(options,'after-journal',{run,ch,target,entry,stagePath});
    // Re-check the parent chain after the journal hook so a concurrent
    // directory->symlink substitution cannot redirect the stage write.
    target=await assertSafeLivePath(root,ch.path);if(path.resolve(stagePathFor(target,entry.nonce))!==path.resolve(stagePath))throw new Error(`APPLY_STAGE_PARENT_CHANGED:${ch.path}`);
    await writeStage(stagePath,data,preserveMode);if(await fileHash(stagePath)!==ch.afterHash)throw new Error(`APPLY_STAGE_HASH_MISMATCH:${ch.path}`);
    await fireApplyHook(options,'after-stage-write',{run,ch,target,entry,stagePath});
    if(ch.type==='add'){
      try{await fsp.link(stagePath,target);}catch(e){if(e.code==='EEXIST'){await cleanupApplyJournal(run,[ch]);return await conflictResult(run);}throw e;}
      await fireApplyHook(options,'after-add-link',{run,ch,target,entry,stagePath});
      if(await fileHash(target)!==ch.afterHash)throw new Error(`APPLY_POSTWRITE_MISMATCH:${ch.path}`);
    }else{
      await fireApplyHook(options,'before-final-check',{run,ch,target,entry,stagePath});
      target=await assertSafeLivePath(root,ch.path);if(await fileHash(target)!==ch.beforeHash){await cleanupApplyJournal(run,[ch]);return await conflictResult(run);}
      await fsp.rename(stagePath,target);await fireApplyHook(options,'after-update-rename',{run,ch,target,entry,stagePath});
      if(await fileHash(target)!==ch.afterHash)throw new Error(`APPLY_POSTWRITE_MISMATCH:${ch.path}`);
    }
    await cleanupApplyJournal(run,[ch]);
  }
  const after=await reconcileApply(run); return {ok:after.conflicts.length===0&&after.pending===0,reconciliation:after,conflicts:after.conflicts};
}

export async function previewSnapshot(run,{maxTotal=220000,maxPerFile=30000,maxFiles=60}={}){
  const rec=await reconcileApply(run);const filesDir=path.join(run.snapshot_dir,'files');let used=0;const items=[];
  for(const ch of rec.changes.slice(0,maxFiles)){
    const item={path:ch.path,type:ch.type,state:ch.state,before:null,after:null,truncated:false};
    if(ch.type!=='add'){try{const t=await assertSafeLivePath(run.workspace_root,ch.path);const b=await fsp.readFile(t);item.before=decodeUtf8(b);}catch{item.before=null;}}
    if(ch.type!=='delete'){try{const a=path.join(filesDir,...ch.path.split('/'));const b=await fsp.readFile(a);item.after=decodeUtf8(b);}catch{item.after=null;}}
    for(const k of ['before','after'])if(item[k]!==null){const b=Buffer.byteLength(item[k],'utf8');if(b>maxPerFile){item[k]=Buffer.from(item[k],'utf8').subarray(0,maxPerFile).toString('utf8')+'\n…[truncated]';item.truncated=true;}used+=Buffer.byteLength(item[k],'utf8');}
    if(used>maxTotal){item.after='…[preview budget reached]';item.truncated=true;items.push(item);break;}items.push(item);
  }
  return {items,totalChanges:rec.changes.length,truncated:rec.changes.length>items.length||used>maxTotal,conflicts:rec.conflicts.length};
}

export async function discardSnapshot(run){ if(!run.snapshot_dir)return; await cleanupApplyJournal(run); await fsp.rm(run.snapshot_dir,{recursive:true,force:true}); }

export function diffSummary(diff){
  if(!diff?.changes?.length) return 'No file changes.';
  return diff.changes.map(x=>`${x.type.toUpperCase()} ${x.path}`).join('\n');
}
