import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ensureDir, nowIso, uuid, sha256, processMatchesIdentity } from './utils.mjs';
import { safeStateDbFile, assertStateDbIntegrity } from './state-integrity.mjs';

export class Store {
  constructor(root){ this.root=root; this.db=null; }
  async init(){
    await ensureDir(this.root);const dbFile=path.join(this.root,'bridge.sqlite');const safety=await safeStateDbFile(dbFile,{allowMissing:true});if(!safety.ok)throw new Error(safety.error);
    this.db = new DatabaseSync(dbFile);
    try{
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;`);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects(
        id TEXT PRIMARY KEY, name TEXT NOT NULL, workspace TEXT, workspace_id TEXT,
        current_context_revision INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS context_revisions(
        project_id TEXT NOT NULL, revision INTEGER NOT NULL, content TEXT NOT NULL, hash TEXT NOT NULL,
        source TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY(project_id,revision), FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS threads(
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS runs(
        id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, request_fingerprint TEXT NOT NULL,
        project_id TEXT NOT NULL, thread_id TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL,
        prompt TEXT NOT NULL, context_revision INTEGER NOT NULL, workspace_root TEXT, workspace_id TEXT,
        snapshot_dir TEXT, manifest_path TEXT, result_text TEXT, result_json TEXT, partial_text TEXT,
        error TEXT, pid INTEGER, process_identity TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS runs_project_status ON runs(project_id,status);
      CREATE INDEX IF NOT EXISTS runs_thread_status ON runs(thread_id,status);
      CREATE TABLE IF NOT EXISTS turns(
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, thread_id TEXT NOT NULL, run_id TEXT NOT NULL,
        role TEXT NOT NULL, content TEXT NOT NULL, context_revision INTEGER NOT NULL, created_at TEXT NOT NULL,
        FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS turns_thread_created ON turns(thread_id,created_at);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    const runCols=new Set(this.db.prepare('PRAGMA table_info(runs)').all().map(r=>r.name));
    if(!runCols.has('process_identity'))this.db.exec('ALTER TABLE runs ADD COLUMN process_identity TEXT');
    assertStateDbIntegrity(this.db);return this;
    }catch(e){try{this.db?.close();}catch{}this.db=null;throw e;}
  }
  tx(fn){ this.db.exec('BEGIN IMMEDIATE'); try{const r=fn();this.db.exec('COMMIT');return r;}catch(e){try{this.db.exec('ROLLBACK');}catch{}throw e;} }
  getSetting(key){ return this.db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value ?? null; }
  setSetting(key,value){ this.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,String(value)); }
  projectFromRow(row){
    if(!row)return row;
    if(Number(row.current_context_revision)>0 && row.context_revision_found===null) throw new Error('CONTEXT_REVISION_MISSING');
    const {context_revision_found,...out}=row;out.context=out.context??'';return out;
  }
  listProjects(){ return this.db.prepare(`SELECT p.*, c.content context, c.revision context_revision_found FROM projects p LEFT JOIN context_revisions c ON c.project_id=p.id AND c.revision=p.current_context_revision ORDER BY p.updated_at DESC`).all().map(r=>this.projectFromRow(r)); }
  getProject(id){ return this.projectFromRow(this.db.prepare(`SELECT p.*, c.content context, c.revision context_revision_found FROM projects p LEFT JOIN context_revisions c ON c.project_id=p.id AND c.revision=p.current_context_revision WHERE p.id=?`).get(id)); }
  createProject(name){
    return this.tx(()=>{const id=uuid(),t=nowIso(),text='';
      this.db.prepare('INSERT INTO projects(id,name,current_context_revision,created_at,updated_at) VALUES(?,?,?,?,?)').run(id,String(name||'').trim()||'Project',1,t,t);
      this.db.prepare('INSERT INTO context_revisions(project_id,revision,content,hash,source,created_at) VALUES(?,?,?,?,?,?)').run(id,1,text,sha256(text),'USER',t);
      return this.getProject(id);
    });
  }
  updateProject(id,{name,workspace,workspaceId,context,source='USER'}={}){
    return this.tx(()=>{
      const p=this.getProject(id); if(!p) throw new Error('PROJECT_NOT_FOUND');const t=nowIso();
      let nextName=p.name,nextWorkspace=p.workspace,nextWorkspaceId=p.workspace_id,nextRevision=Number(p.current_context_revision);
      if(name!==undefined)nextName=String(name).trim()||p.name;
      if(workspace!==undefined){nextWorkspace=workspace||null;nextWorkspaceId=workspaceId||null;}
      if(context!==undefined && String(context)!==p.context){
        nextRevision+=1;const text=String(context);
        this.db.prepare('INSERT INTO context_revisions(project_id,revision,content,hash,source,created_at) VALUES(?,?,?,?,?,?)').run(id,nextRevision,text,sha256(text),source,t);
      }
      this.db.prepare('UPDATE projects SET name=?,workspace=?,workspace_id=?,current_context_revision=?,updated_at=? WHERE id=?').run(nextName,nextWorkspace,nextWorkspaceId,nextRevision,t,id);
      return this.getProject(id);
    });
  }
  addContextRevision(projectId,content,source='USER'){
    return this.tx(()=>{
      const row=this.db.prepare('SELECT current_context_revision FROM projects WHERE id=?').get(projectId); if(!row) throw new Error('PROJECT_NOT_FOUND');
      const rev=Number(row.current_context_revision)+1, t=nowIso(), text=String(content||'');
      this.db.prepare('INSERT INTO context_revisions(project_id,revision,content,hash,source,created_at) VALUES(?,?,?,?,?,?)').run(projectId,rev,text,sha256(text),source,t);
      this.db.prepare('UPDATE projects SET current_context_revision=?,updated_at=? WHERE id=?').run(rev,t,projectId);
      return rev;
    });
  }
  getContext(projectId,revision){ return this.db.prepare('SELECT * FROM context_revisions WHERE project_id=? AND revision=?').get(projectId,revision); }
  listThreads(projectId){ return this.db.prepare('SELECT * FROM threads WHERE project_id=? ORDER BY updated_at DESC').all(projectId); }
  getThread(id){ return this.db.prepare('SELECT * FROM threads WHERE id=?').get(id); }
  createThread(projectId,title='New Gemini thread'){
    if(!this.getProject(projectId)) throw new Error('PROJECT_NOT_FOUND');
    const id=uuid(),t=nowIso();this.db.prepare('INSERT INTO threads(id,project_id,title,created_at,updated_at) VALUES(?,?,?,?,?)').run(id,projectId,title.slice(0,100),t,t);return this.getThread(id);
  }
  touchThread(id){ this.db.prepare('UPDATE threads SET updated_at=? WHERE id=?').run(nowIso(),id); }
  findRunByRequest(requestId){ return this.db.prepare('SELECT * FROM runs WHERE request_id=?').get(requestId); }
  getRun(id){ return this.db.prepare('SELECT * FROM runs WHERE id=?').get(id); }
  createRun(r){
    const t=nowIso();
    this.db.prepare(`INSERT INTO runs(id,request_id,request_fingerprint,project_id,thread_id,mode,status,prompt,context_revision,workspace_root,workspace_id,snapshot_dir,manifest_path,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(r.id,r.requestId,r.requestFingerprint,r.projectId,r.threadId,r.mode,r.status,r.prompt,r.contextRevision,r.workspaceRoot||null,r.workspaceId||null,r.snapshotDir||null,r.manifestPath||null,t,t);
    return this.getRun(r.id);
  }
  transitionRun(id,fromStatuses,toStatus,patch={}){
    const allowed=Array.isArray(fromStatuses)?fromStatuses:[fromStatuses];
    return this.tx(()=>{
      const r=this.getRun(id); if(!r) throw new Error('RUN_NOT_FOUND');
      if(!allowed.includes(r.status)) throw new Error(`INVALID_RUN_TRANSITION:${r.status}->${toStatus}`);
      const cols=['result_text','result_json','partial_text','error','pid','process_identity','snapshot_dir','manifest_path'];
      const sets=['status=?','updated_at=?']; const vals=[toStatus,nowIso()];
      for(const c of cols){if(Object.prototype.hasOwnProperty.call(patch,c)){sets.push(`${c}=?`);vals.push(patch[c]);}}
      vals.push(id,r.status);
      const out=this.db.prepare(`UPDATE runs SET ${sets.join(',')} WHERE id=? AND status=?`).run(...vals);
      if(Number(out.changes)!==1) throw new Error('RUN_STATE_RACE');
      return this.getRun(id);
    });
  }
  patchRun(id,patch={}){
    const cols=['result_text','result_json','partial_text','error','pid','process_identity','snapshot_dir','manifest_path'];const sets=['updated_at=?'];const vals=[nowIso()];
    for(const c of cols){if(Object.prototype.hasOwnProperty.call(patch,c)){sets.push(`${c}=?`);vals.push(patch[c]);}}
    vals.push(id);this.db.prepare(`UPDATE runs SET ${sets.join(',')} WHERE id=?`).run(...vals);return this.getRun(id);
  }
  completeRunWithTurns(runId,fromStatuses,toStatus,patch,userText,assistantText){
    const allowed=Array.isArray(fromStatuses)?fromStatuses:[fromStatuses];
    return this.tx(()=>{
      const r=this.getRun(runId);if(!r)throw new Error('RUN_NOT_FOUND');if(!allowed.includes(r.status))throw new Error(`INVALID_RUN_TRANSITION:${r.status}->${toStatus}`);
      const cols=['result_text','result_json','partial_text','error','pid','process_identity','snapshot_dir','manifest_path'];const sets=['status=?','updated_at=?'];const vals=[toStatus,nowIso()];
      for(const c of cols)if(Object.prototype.hasOwnProperty.call(patch||{},c)){sets.push(`${c}=?`);vals.push(patch[c]);}
      vals.push(runId,r.status);const out=this.db.prepare(`UPDATE runs SET ${sets.join(',')} WHERE id=? AND status=?`).run(...vals);if(Number(out.changes)!==1)throw new Error('RUN_STATE_RACE');
      const t=nowIso();const ins=this.db.prepare('INSERT INTO turns(id,project_id,thread_id,run_id,role,content,context_revision,created_at) VALUES(?,?,?,?,?,?,?,?)');
      ins.run(uuid(),r.project_id,r.thread_id,r.id,'user',userText,r.context_revision,t);ins.run(uuid(),r.project_id,r.thread_id,r.id,'assistant',assistantText,r.context_revision,t);
      this.db.prepare('UPDATE threads SET updated_at=? WHERE id=?').run(t,r.thread_id);
      return this.getRun(runId);
    });
  }
  completeTurns(runId,userText,assistantText){
    return this.tx(()=>{
      const r=this.getRun(runId); if(!r) throw new Error('RUN_NOT_FOUND'); const t=nowIso();
      this.db.prepare('INSERT INTO turns(id,project_id,thread_id,run_id,role,content,context_revision,created_at) VALUES(?,?,?,?,?,?,?,?)').run(uuid(),r.project_id,r.thread_id,r.id,'user',userText,r.context_revision,t);
      this.db.prepare('INSERT INTO turns(id,project_id,thread_id,run_id,role,content,context_revision,created_at) VALUES(?,?,?,?,?,?,?,?)').run(uuid(),r.project_id,r.thread_id,r.id,'assistant',assistantText,r.context_revision,t);
      this.touchThread(r.thread_id);
    });
  }
  listTurns(threadId,limit=100){ return this.db.prepare('SELECT * FROM turns WHERE thread_id=? ORDER BY created_at DESC, rowid DESC LIMIT ?').all(threadId,Math.max(1,Math.min(500,Number(limit)||100))).reverse(); }
  contextTurns(threadId,maxBytes=80000){
    const rows=this.listTurns(threadId,100); const picked=[]; let bytes=0;
    for(let i=rows.length-1;i>=0;i--){const b=Buffer.byteLength(rows[i].content,'utf8')+100;if(bytes+b>maxBytes)break;picked.unshift(rows[i]);bytes+=b;} return picked;
  }
  listRuns(projectId,statuses=[]){
    if(statuses.length){const qs=statuses.map(()=>'?').join(',');return this.db.prepare(`SELECT * FROM runs WHERE project_id=? AND status IN (${qs}) ORDER BY created_at DESC`).all(projectId,...statuses);}
    return this.db.prepare('SELECT * FROM runs WHERE project_id=? ORDER BY created_at DESC LIMIT 200').all(projectId);
  }
  listThreadRuns(threadId,statuses=[],limit=100){
    const n=Math.max(1,Math.min(500,Number(limit)||100));
    let rows;if(statuses.length){const qs=statuses.map(()=>'?').join(',');rows=this.db.prepare(`SELECT * FROM runs WHERE thread_id=? AND status IN (${qs}) ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(threadId,...statuses,n);}
    else rows=this.db.prepare('SELECT * FROM runs WHERE thread_id=? ORDER BY created_at DESC, rowid DESC LIMIT ?').all(threadId,n);
    return rows.reverse();
  }
  findPendingByWorkspace(workspaceId){ return this.db.prepare(`SELECT * FROM runs WHERE workspace_id=? AND mode='edit' AND status IN ('QUEUED','RUNNING','WAITING_APPLY','RECOVERY_REQUIRED','RECOVERY_PROCESS_ALIVE','RECOVERY_IDENTITY_UNKNOWN','APPLYING','APPLY_RECOVERY_REQUIRED','APPLY_CONFLICT') ORDER BY created_at DESC LIMIT 1`).get(workspaceId); }
  findPendingByProject(projectId){ return this.db.prepare(`SELECT * FROM runs WHERE project_id=? AND mode='edit' AND status IN ('QUEUED','RUNNING','WAITING_APPLY','RECOVERY_REQUIRED','RECOVERY_PROCESS_ALIVE','RECOVERY_IDENTITY_UNKNOWN','APPLYING','APPLY_RECOVERY_REQUIRED','APPLY_CONFLICT') ORDER BY created_at DESC LIMIT 1`).get(projectId); }
  findBlockingByThread(threadId){ return this.db.prepare(`SELECT * FROM runs WHERE thread_id=? AND status IN ('QUEUED','RUNNING','ORPHAN_PROCESS_ALIVE','ORPHAN_IDENTITY_UNKNOWN','RECOVERY_PROCESS_ALIVE','RECOVERY_IDENTITY_UNKNOWN','APPLYING') ORDER BY created_at DESC LIMIT 1`).get(threadId); }
  listRunning(){ return this.db.prepare(`SELECT * FROM runs WHERE status IN ('QUEUED','RUNNING','APPLYING')`).all(); }
  listUnfinished(){ return this.db.prepare(`SELECT * FROM runs WHERE status NOT IN ('COMPLETED','APPLIED','DISCARDED','FAILED','CANCELLED') ORDER BY created_at ASC`).all(); }
  listTerminalRuns(){ return this.db.prepare(`SELECT * FROM runs WHERE status IN ('COMPLETED','APPLIED','DISCARDED','FAILED','CANCELLED') ORDER BY updated_at DESC`).all(); }
  markInterruptedOnStartup(){
    const rows=this.listRunning();
    for(const r of rows){
      if(r.status==='APPLYING') this.transitionRun(r.id,'APPLYING','APPLY_RECOVERY_REQUIRED',{error:'Host restarted during Apply'});
      else if(r.pid && !r.process_identity){
        if(r.mode==='edit'&&r.snapshot_dir)this.transitionRun(r.id,[r.status],'RECOVERY_IDENTITY_UNKNOWN',{error:'Legacy/corrupt run has a PID but no process identity; automatic recovery is blocked'});
        else this.transitionRun(r.id,[r.status],'ORPHAN_IDENTITY_UNKNOWN',{error:'Legacy/corrupt run has a PID but no process identity; Bridge will not act on that PID'});
      }
      else if(r.pid && processMatchesIdentity(Number(r.pid),r.process_identity)){
        if(r.mode==='edit'&&r.snapshot_dir)this.transitionRun(r.id,[r.status],'RECOVERY_PROCESS_ALIVE',{error:'Verified previous Gemini process is still running; recovery is blocked until it exits'});
        else this.transitionRun(r.id,[r.status],'ORPHAN_PROCESS_ALIVE',{error:'Verified previous Gemini process is still running'});
      }
      else if(r.mode==='edit' && r.snapshot_dir) this.transitionRun(r.id,[r.status],'RECOVERY_REQUIRED',{error:'Host restarted during Agent run',pid:null,process_identity:null});
      else this.transitionRun(r.id,[r.status],'FAILED',{error:'Host restarted during run',pid:null,process_identity:null});
    }
    return rows.length;
  }
}
