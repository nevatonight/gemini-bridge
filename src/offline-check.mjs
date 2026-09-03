import path from 'node:path';
import fsp from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { safeStateDbFile, inspectStateDb } from './state-integrity.mjs';

const TERMINAL=['COMPLETED','APPLIED','DISCARDED','FAILED','CANCELLED'];
export async function offlineStateCheck(stateRoot){
  const file=path.join(stateRoot,'bridge.sqlite');const safety=await safeStateDbFile(file,{allowMissing:true});if(!safety.ok)return {ok:false,exists:true,error:safety.error};if(!safety.exists)return {ok:true,exists:false,unfinished:0};
  let db;try{
    db=new DatabaseSync(file,{readOnly:true});db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=2000;');
    const qc=db.prepare('PRAGMA quick_check').all().map(r=>String(Object.values(r)[0]||''));if(qc.length!==1||qc[0]!=='ok')return {ok:false,exists:true,error:'SQLITE_QUICK_CHECK_FAILED',details:qc.slice(0,20)};
    const integrity=inspectStateDb(db);if(!integrity.ok)return {ok:false,exists:true,...integrity};
    const marks=TERMINAL.map(()=>'?').join(',');const row=db.prepare(`SELECT COUNT(*) count FROM runs WHERE status NOT IN (${marks})`).get(...TERMINAL);const unfinished=Number(row?.count||0);
    return {ok:unfinished===0,exists:true,unfinished,...(unfinished?{error:'UNFINISHED_WORK'}:{})};
  }catch(e){return {ok:false,exists:true,error:`STATE_READ_FAILED:${String(e?.message||e).slice(0,500)}`};}
  finally{try{db?.close();}catch{}}
}
