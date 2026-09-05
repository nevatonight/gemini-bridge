import fsp from 'node:fs/promises';

export const REQUIRED_SCHEMA={
  projects:['id','name','workspace','workspace_id','current_context_revision','created_at','updated_at'],
  context_revisions:['project_id','revision','content','hash','source','created_at'],
  threads:['id','project_id','title','created_at','updated_at'],
  runs:['id','request_id','request_fingerprint','project_id','thread_id','mode','status','prompt','context_revision','workspace_root','workspace_id','snapshot_dir','manifest_path','result_text','result_json','partial_text','error','pid','process_identity','created_at','updated_at'],
  turns:['id','project_id','thread_id','run_id','role','content','context_revision','created_at'],
  settings:['key','value']
};
function result(error,detail={}){return {ok:false,error,...detail};}
export async function safeStateDbFile(file,{allowMissing=true}={}){
  let st;try{st=await fsp.lstat(file);}catch(e){if(e?.code==='ENOENT'&&allowMissing)return {ok:true,exists:false};throw e;}
  if(st.isSymbolicLink()||!st.isFile()||Number(st.nlink||1)>1)return result('STATE_DB_UNSAFE_LINK',{exists:true});
  return {ok:true,exists:true};
}
export function inspectStateDb(db){
  const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>String(r.name)));
  const missingTables=Object.keys(REQUIRED_SCHEMA).filter(t=>!tables.has(t));if(missingTables.length)return result('STATE_SCHEMA_INCOMPLETE',{missing:missingTables});
  const missingColumns={};for(const [table,required] of Object.entries(REQUIRED_SCHEMA)){const cols=new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(r=>String(r.name)));const miss=required.filter(c=>!cols.has(c));if(miss.length)missingColumns[table]=miss;}
  if(Object.keys(missingColumns).length)return result('STATE_SCHEMA_COLUMNS_MISSING',{missingColumns});
  const fk=db.prepare('PRAGMA foreign_key_check').all();if(fk.length)return result('STATE_FOREIGN_KEY_VIOLATION',{details:fk.slice(0,20)});
  const checks=[
    ['STATE_SEMANTIC_CONTEXT_MISSING',`SELECT p.id FROM projects p LEFT JOIN context_revisions c ON c.project_id=p.id AND c.revision=p.current_context_revision WHERE p.current_context_revision<1 OR c.project_id IS NULL LIMIT 1`],
    ['STATE_SEMANTIC_RUN_THREAD_PROJECT',`SELECT r.id FROM runs r JOIN threads t ON t.id=r.thread_id WHERE t.project_id<>r.project_id LIMIT 1`],
    ['STATE_SEMANTIC_RUN_CONTEXT',`SELECT r.id FROM runs r LEFT JOIN context_revisions c ON c.project_id=r.project_id AND c.revision=r.context_revision WHERE c.project_id IS NULL LIMIT 1`],
    ['STATE_SEMANTIC_TURN_RELATION',`SELECT x.id FROM turns x JOIN runs r ON r.id=x.run_id WHERE x.project_id<>r.project_id OR x.thread_id<>r.thread_id OR x.context_revision<>r.context_revision LIMIT 1`],
    ['STATE_SEMANTIC_PROJECT_WORKSPACE',`SELECT id FROM projects WHERE (workspace IS NULL)<>(workspace_id IS NULL) LIMIT 1`],
    ['STATE_SEMANTIC_RUN_WORKSPACE',`SELECT id FROM runs WHERE (workspace_root IS NULL)<>(workspace_id IS NULL) LIMIT 1`]
  ];
  for(const [error,sql] of checks){const row=db.prepare(sql).get();if(row)return result(error,{id:String(row.id||'')});}
  return {ok:true};
}
export function assertStateDbIntegrity(db){const r=inspectStateDb(db);if(!r.ok){const e=new Error(r.error);e.code=r.error;e.detail=r;throw e;}return true;}
