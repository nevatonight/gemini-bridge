import fsp from 'node:fs/promises';
import path from 'node:path';
import { GEMINI_VERSION_PROBE_TIMEOUT_MS, parseExactGeminiVersionOutput } from './version-policy.mjs';
import { spawnManaged, terminateProcessTree } from './process-control.mjs';

const MAX_STDOUT=64*1024,MAX_STDERR=64*1024;
const VERSION_RE=/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;
function fail(code,detail=''){const e=new Error(code);e.code=code;e.detail=String(detail||'');throw e;}
function inside(root,target){const r=path.resolve(root),t=path.resolve(target);return t===r||t.startsWith(r+path.sep);}
function coded(code,detail=''){const e=new Error(code);e.code=code;e.detail=String(detail||'');return e;}

export async function resolveManagedEntry(prefix,expected){
  if(!VERSION_RE.test(String(expected||'')))fail('GEMINI_EXPECTED_VERSION_INVALID');
  const packageDir=path.join(path.resolve(prefix),'node_modules','@google','gemini-cli'),packageFile=path.join(packageDir,'package.json');
  let pkg;try{pkg=JSON.parse(await fsp.readFile(packageFile,'utf8'));}catch(e){fail('GEMINI_PACKAGE_METADATA_UNREADABLE',e?.message);}
  if(String(pkg?.version||'')!==expected)fail('GEMINI_PACKAGE_VERSION_MISMATCH',`expected=${expected} actual=${String(pkg?.version||'')}`);
  let rel=typeof pkg?.bin==='string'?pkg.bin:pkg?.bin?.gemini;if(typeof rel!=='string'||!rel.trim())fail('GEMINI_PACKAGE_BIN_MISSING');rel=rel.replace(/\\/g,'/');
  if(path.posix.isAbsolute(rel)||rel.split('/').includes('..'))fail('GEMINI_PACKAGE_BIN_UNSAFE',rel);
  const entry=path.resolve(packageDir,...rel.split('/'));if(!inside(packageDir,entry))fail('GEMINI_PACKAGE_BIN_ESCAPED',rel);
  let prefixReal,packageReal,entryReal,lst;try{prefixReal=await fsp.realpath(path.resolve(prefix));packageReal=await fsp.realpath(packageDir);entryReal=await fsp.realpath(entry);lst=await fsp.lstat(entry);}catch(e){fail('GEMINI_PACKAGE_BIN_NOT_FOUND',e?.message);}
  if(!inside(prefixReal,packageReal))fail('GEMINI_PACKAGE_REALPATH_ESCAPED',packageReal);if(lst.isSymbolicLink())fail('GEMINI_PACKAGE_BIN_SYMLINK');if(!lst.isFile())fail('GEMINI_PACKAGE_BIN_NOT_FILE');if(!inside(packageReal,entryReal))fail('GEMINI_PACKAGE_BIN_REALPATH_ESCAPED',rel);return entry;
}

export async function probeEntry(nodePath,entry,expected,{timeoutMs=GEMINI_VERSION_PROBE_TIMEOUT_MS}={}){
  if(!VERSION_RE.test(String(expected||'')))fail('GEMINI_EXPECTED_VERSION_INVALID');let st;try{st=await fsp.stat(entry);}catch(e){fail('GEMINI_ENTRY_NOT_FOUND',e?.message);}if(!st.isFile())fail('GEMINI_ENTRY_NOT_FILE');
  return await new Promise((resolve,reject)=>{
    const p=spawnManaged(nodePath,[entry,'--version'],{stdio:['ignore','pipe','pipe'],windowsHide:true,shell:false});let out='',err='',settled=false,primary=null;
    const finish=(fn,v)=>{if(settled)return;settled=true;clearTimeout(timer);fn(v);};
    const abort=e=>{if(primary)return;primary=e;clearTimeout(timer);(async()=>{try{await terminateProcessTree(p,{timeoutMs:3000});}catch(te){e.detail=`${e.detail?e.detail+'; ':''}termination=${te?.message||te}`;}finish(reject,e);})();};
    const timer=setTimeout(()=>abort(coded('GEMINI_VERSION_TIMEOUT')),Math.max(250,Math.min(30000,Number(timeoutMs)||10000)));
    p.stdout.on('data',b=>{if(primary)return;out+=b.toString('utf8');if(Buffer.byteLength(out)>MAX_STDOUT)abort(coded('GEMINI_VERSION_OUTPUT_TOO_LARGE'));});
    p.stderr.on('data',b=>{err=(err+b.toString('utf8')).slice(-MAX_STDERR);});
    p.once('error',e=>{if(!primary)finish(reject,coded('GEMINI_VERSION_SPAWN_FAILED',e?.message||String(e)));});
    p.once('close',code=>{if(primary||settled)return;const actual=parseExactGeminiVersionOutput(out);if(code!==0)return finish(reject,coded('GEMINI_VERSION_EXIT_NONZERO',`exit=${code} stderr=${err.trim().slice(-2000)}`));if(!actual)return finish(reject,coded('GEMINI_VERSION_OUTPUT_INVALID',`stdout=${JSON.stringify(out.slice(0,2000))}`));if(actual.replace(/^v/,'')!==expected)return finish(reject,coded('GEMINI_VERSION_MISMATCH',`expected=${expected} actual=${JSON.stringify(actual)}`));finish(resolve,{version:actual.replace(/^v/,''),rawVersion:actual});});
  });
}
export async function probeManagedPrefix(nodePath,prefix,expected,opts={}){const entry=await resolveManagedEntry(prefix,expected);const v=await probeEntry(nodePath,entry,expected,opts);return {ok:true,entry,...v};}
async function main(){const a=process.argv.slice(2),get=n=>{const i=a.indexOf(n);return i>=0?a[i+1]:null;};const expected=get('--expected'),prefix=get('--prefix'),entry=get('--entry');try{let r;if(prefix)r=await probeManagedPrefix(process.execPath,prefix,expected);else if(entry)r={ok:true,entry,...await probeEntry(process.execPath,entry,expected)};else fail('GEMINI_PROBE_TARGET_MISSING');process.stdout.write(JSON.stringify(r)+'\n');}catch(e){process.stdout.write(JSON.stringify({ok:false,error:e?.code||e?.message||'GEMINI_PROBE_FAILED',detail:String(e?.detail||'').slice(0,4000)})+'\n');process.exitCode=1;}}
if(import.meta.url===`file://${process.argv[1]?.replace(/\\/g,'/')}`||process.argv[1]?.endsWith('managed-gemini-probe.mjs'))main();
