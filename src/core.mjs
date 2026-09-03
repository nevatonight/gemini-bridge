import fsp from 'node:fs/promises';
import path from 'node:path';
import { Store } from './store.mjs';
import { GeminiRunner } from './gemini.mjs';
import { buildSnapshot, computeDiff, applySnapshot, reconcileApply, discardSnapshot, diffSummary, previewSnapshot } from './snapshot.mjs';
import { stateRoot as defaultStateRoot, ensureDir, ensureOwnedDir, uuid, fingerprint, assertId, safeRunDirName, canonicalWorkspace, workspaceIdentity, redactError, sha256, processIdentity, processMatchesIdentity, isPidAlive, APP_VERSION } from './utils.mjs';
import { terminateProcessTree, childExited } from './process-control.mjs';

const ACTIVE_STATUSES=['QUEUED','RUNNING','ORPHAN_PROCESS_ALIVE','ORPHAN_IDENTITY_UNKNOWN','WAITING_APPLY','RECOVERY_REQUIRED','RECOVERY_PROCESS_ALIVE','RECOVERY_IDENTITY_UNKNOWN','APPLYING','APPLY_RECOVERY_REQUIRED','APPLY_CONFLICT'];

export class BridgeCore{
  constructor({stateRoot=defaultStateRoot(),geminiEntry=null,maxGeminiProcesses=3,expectedGeminiVersion=null}={}){
    this.stateRoot=stateRoot;this.store=new Store(stateRoot);this.gemini=new GeminiRunner({stateRoot,geminiEntry});this.expectedGeminiVersion=expectedGeminiVersion===undefined?null:expectedGeminiVersion;
    this.threadLocks=new Set();this.workspaceLocks=new Set();this.managementLocks=new Set();this.active=new Map();this.processSlots=new Set();this.maxGeminiProcesses=Math.max(1,Math.min(16,Number(maxGeminiProcesses)||3));this.runtimeStatus={ok:false,version:null,error:'RUNTIME_NOT_VERIFIED',verifiedAt:null};this.runtimeVerifyPromise=null;this.maintenance=false;this.started=false;
  }
  async init(){
    await ensureDir(this.stateRoot);await this.store.init();await this.gemini.init();this.store.markInterruptedOnStartup();
    // Best-effort GC retries cleanup that may have been interrupted after a terminal state.
    for(const r of this.store.listTerminalRuns()){await this.cleanupRunArtifacts(r);}
    this.started=true;return this;
  }
  listProjects(){return this.store.listProjects();}
  createProject(name){if(String(name||'').length>120)throw new Error('PROJECT_NAME_TOO_LONG');return this.store.createProject(name);}
  async updateProject(id,patch){
    assertId(id,'project_id'); const current=this.store.getProject(id);if(!current)throw new Error('PROJECT_NOT_FOUND');const p={};
    if(patch.name!==undefined){if(String(patch.name).length>120)throw new Error('PROJECT_NAME_TOO_LONG');p.name=String(patch.name);}
    if(patch.context!==undefined){const c=String(patch.context);if(Buffer.byteLength(c,'utf8')>120000)throw new Error('PROJECT_CONTEXT_TOO_LARGE');p.context=c;}
    if(patch.workspace!==undefined){
      let nextWorkspace=null,nextWorkspaceId=null;
      if(patch.workspace){nextWorkspace=await canonicalWorkspace(String(patch.workspace));nextWorkspaceId=workspaceIdentity(nextWorkspace);}
      const changed=(nextWorkspaceId||null)!==(current.workspace_id||null);
      if(changed&&this.store.findPendingByProject(id))throw new Error('PENDING_AGENT_CHANGES');
      p.workspace=nextWorkspace;p.workspaceId=nextWorkspaceId;
    }
    return this.store.updateProject(id,p);
  }
  listThreads(projectId){assertId(projectId,'project_id');return this.store.listThreads(projectId);}
  createThread(projectId,title){assertId(projectId,'project_id');return this.store.createThread(projectId,String(title||'New Gemini thread'));}
  turns(threadId,limit=100){assertId(threadId,'thread_id');return this.store.listTurns(threadId,limit);}
  conversation(threadId,limit=100){
    assertId(threadId,'thread_id');const n=Math.max(1,Math.min(500,Number(limit)||100));
    const turns=this.store.listTurns(threadId,n);const successfulRunIds=new Set(turns.map(t=>t.run_id));
    const items=turns.map((t,index)=>({kind:'message',id:t.id,runId:t.run_id,role:t.role,content:t.content,createdAt:t.created_at,_order:index}));
    const failures=this.store.listThreadRuns(threadId,['FAILED','CANCELLED'],n);
    for(const r of failures){if(successfulRunIds.has(r.id))continue;items.push({kind:'failed-run',runId:r.id,projectId:r.project_id,threadId:r.thread_id,mode:r.mode,status:r.status,prompt:r.prompt,error:r.error||null,createdAt:r.created_at,updatedAt:r.updated_at,_order:items.length+100000});}
    items.sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||''))||(a._order-b._order));
    for(const x of items)delete x._order;return {items};
  }
  publicRun(r){
    if(!r)return null;let result=null;try{result=r.result_json?JSON.parse(r.result_json):null;}catch{}
    return {id:r.id,requestId:r.request_id,projectId:r.project_id,threadId:r.thread_id,mode:r.mode,status:r.status,resultText:r.result_text||'',partialText:r.partial_text||'',error:r.error||null,recoveryPid:['ORPHAN_PROCESS_ALIVE','RECOVERY_PROCESS_ALIVE'].includes(r.status)?Number(r.pid)||null:null,createdAt:r.created_at,updatedAt:r.updated_at,workspace:r.workspace_root||null,result};
  }
  refreshRecoveredProcess(r){
    if(!r)return r;
    if(r.status==='ORPHAN_PROCESS_ALIVE'&&(!r.pid||!processMatchesIdentity(Number(r.pid),r.process_identity)))return this.store.transitionRun(r.id,'ORPHAN_PROCESS_ALIVE','FAILED',{error:'Verified previous Gemini process has exited or PID was reused',pid:null,process_identity:null});
    if(r.status==='RECOVERY_PROCESS_ALIVE'&&(!r.pid||!processMatchesIdentity(Number(r.pid),r.process_identity)))return this.store.transitionRun(r.id,'RECOVERY_PROCESS_ALIVE','RECOVERY_REQUIRED',{error:'Verified previous Gemini process exited or PID was reused; snapshot is ready for reconciliation',pid:null,process_identity:null});
    if(r.status==='ORPHAN_IDENTITY_UNKNOWN'&&r.pid&&!isPidAlive(Number(r.pid)))return this.store.transitionRun(r.id,'ORPHAN_IDENTITY_UNKNOWN','FAILED',{error:'Legacy Gemini process PID is no longer alive; run can safely leave orphan recovery',pid:null,process_identity:null});
    if(r.status==='RECOVERY_IDENTITY_UNKNOWN'&&r.pid&&!isPidAlive(Number(r.pid)))return this.store.transitionRun(r.id,'RECOVERY_IDENTITY_UNKNOWN','RECOVERY_REQUIRED',{error:'Legacy Gemini process PID is no longer alive; snapshot is ready for reconciliation',pid:null,process_identity:null});
    return r;
  }
  getRun(id){assertId(id,'run_id');return this.publicRun(this.refreshRecoveredProcess(this.store.getRun(id)));}
  listPending(projectId){assertId(projectId,'project_id');return this.store.listRuns(projectId,ACTIVE_STATUSES).map(r=>this.refreshRecoveredProcess(r)).filter(r=>ACTIVE_STATUSES.includes(r.status)).map(r=>this.publicRun(r));}
  acquire(run){
    const tk=`t:${run.thread_id}`; if(this.threadLocks.has(tk)) throw new Error('THREAD_BUSY');
    const wk=run.workspace_id?`w:${run.workspace_id}`:null; if(wk&&this.workspaceLocks.has(wk)) throw new Error('WORKSPACE_BUSY');
    this.threadLocks.add(tk);if(wk)this.workspaceLocks.add(wk);return {tk,wk};
  }
  release(l){if(!l)return;this.threadLocks.delete(l.tk);if(l.wk)this.workspaceLocks.delete(l.wk);}
  acquireManagement(run,operation='management'){
    if(this.maintenance)throw new Error('HOST_MAINTENANCE');
    const mk=`m:${run.id}`;if(this.managementLocks.has(mk))throw new Error('RUN_OPERATION_BUSY');
    const wk=run.workspace_id?`w:${run.workspace_id}`:null;if(wk&&this.workspaceLocks.has(wk))throw new Error('WORKSPACE_BUSY');
    this.managementLocks.add(mk);if(wk)this.workspaceLocks.add(wk);return {mk,wk,operation:String(operation||'management')};
  }
  releaseManagement(l){if(!l)return;this.managementLocks.delete(l.mk);if(l.wk)this.workspaceLocks.delete(l.wk);}
  async startRun({projectId,threadId=null,mode='ask',prompt,requestId}){
    assertId(projectId,'project_id');assertId(requestId,'request_id');if(threadId)assertId(threadId,'thread_id');
    if(!['ask','review','edit'].includes(mode))throw new Error('INVALID_MODE');
    const q=String(prompt||'').trim();if(!q)throw new Error('EMPTY_PROMPT');if(Buffer.byteLength(q,'utf8')>160000)throw new Error('PROMPT_TOO_LARGE');
    const reqFp=fingerprint({projectId,threadId:threadId||null,mode,prompt:q});
    const old=this.store.findRunByRequest(requestId);
    if(old){if(old.request_fingerprint!==reqFp)throw new Error('IDEMPOTENCY_KEY_REUSE');return {reused:true,run:this.publicRun(old)};}
    if(this.maintenance)throw new Error('HOST_MAINTENANCE');
    if(this.processSlots.size>=this.maxGeminiProcesses)throw new Error('GEMINI_BUSY');
    const project=this.store.getProject(projectId);if(!project)throw new Error('PROJECT_NOT_FOUND');
    let th=threadId?this.store.getThread(threadId):null;
    if(threadId&&(!th||th.project_id!==projectId))throw new Error('THREAD_NOT_FOUND');
    if(threadId){const blocker=this.store.findBlockingByThread(threadId);if(blocker){const fresh=this.refreshRecoveredProcess(blocker);if(['QUEUED','RUNNING','ORPHAN_PROCESS_ALIVE','ORPHAN_IDENTITY_UNKNOWN','RECOVERY_PROCESS_ALIVE','RECOVERY_IDENTITY_UNKNOWN','APPLYING'].includes(fresh.status))throw new Error('THREAD_BUSY');}}
    if(mode!=='ask'&&!project.workspace)throw new Error('WORKSPACE_REQUIRED');
    if(threadId&&this.threadLocks.has(`t:${threadId}`))throw new Error('THREAD_BUSY');
    if(mode!=='ask'&&project.workspace_id&&this.workspaceLocks.has(`w:${project.workspace_id}`))throw new Error('WORKSPACE_BUSY');
    if(mode!=='ask'&&project.workspace_id&&this.store.findPendingByWorkspace(project.workspace_id))throw new Error('PENDING_AGENT_CHANGES');
    if(!th) th=this.store.createThread(projectId,q.slice(0,80));
    const lockCandidate={thread_id:th.id,workspace_id:mode==='ask'?null:project.workspace_id};
    const locks=this.acquire(lockCandidate);
    const runId=uuid();let run;
    try{run=this.store.createRun({id:runId,requestId,requestFingerprint:reqFp,projectId,threadId:th.id,mode,status:'QUEUED',prompt:q,contextRevision:project.current_context_revision,workspaceRoot:project.workspace,workspaceId:project.workspace_id});this.processSlots.add(runId);}
    catch(e){this.release(locks);throw e;}
    this.executeRun(runId,locks).catch(()=>{});
    return {reused:false,run:this.publicRun(this.store.getRun(runId))};
  }
  buildPayload(run){
    const MAX_PACKAGE=300000;const ctxRow=this.store.getContext(run.project_id,run.context_revision);if(!ctxRow)throw new Error('CONTEXT_REVISION_MISSING');const ctx=ctxRow.content;
    const modeText=run.mode==='ask'?'No local workspace is available.':run.mode==='review'?'The workspace is a sanitized read-only snapshot. Analyze it but do not claim access to excluded files.':'Edit only the sanitized snapshot using the available file tools. Do not attempt shell commands. Make the requested edits directly in the snapshot and then summarize what you changed.';
    const fixed=[`MODE: ${run.mode.toUpperCase()}`,modeText,ctx?`PROJECT CONTEXT (may be a model/user summary; explicit current task wins):\n${ctx}`:'PROJECT CONTEXT: none',`CURRENT USER REQUEST:\n${run.prompt}`];
    const fixedText=fixed.join('\n\n---\n\n');const fixedBytes=Buffer.byteLength(fixedText,'utf8');if(fixedBytes>MAX_PACKAGE-4000)throw new Error('CONTEXT_PACKAGE_TOO_LARGE');
    const historyBudget=Math.max(0,Math.min(80000,MAX_PACKAGE-fixedBytes-4000));const history=this.store.contextTurns(run.thread_id,historyBudget);const hist=history.map(t=>`${t.role==='user'?'USER':'GEMINI'}:\n${t.content}`).join('\n\n');
    const sections=[fixed[0],fixed[1],fixed[2],hist?`RECENT SUCCESSFUL GEMINI HISTORY:\n${hist}`:'RECENT SUCCESSFUL GEMINI HISTORY: omitted for context budget',fixed[3]];
    const payload=sections.join('\n\n---\n\n');if(Buffer.byteLength(payload,'utf8')>MAX_PACKAGE)throw new Error('CONTEXT_PACKAGE_TOO_LARGE');return payload;
  }

  async executeRun(runId,locks){
    let proc=null;let cancelled=false;let partial='';let lastPersist=0;const aborter=new AbortController();
    const control={cancel:async()=>{cancelled=true;aborter.abort();if(proc&&!childExited(proc))await terminateProcessTree(proc);}};this.active.set(runId,control);
    try{
      let run=this.store.transitionRun(runId,'QUEUED','RUNNING');
      let cwd;let snapshot=null;
      if(run.mode==='ask'){
        cwd=path.join(this.stateRoot,'run-data',safeRunDirName(run.request_id),'empty');await ensureOwnedDir(this.stateRoot,cwd);
      } else {
        const sd=path.join(this.stateRoot,'run-data',safeRunDirName(run.request_id),'snapshot');snapshot=await buildSnapshot(run.workspace_root,sd,{mode:run.mode,signal:aborter.signal,ownedRoot:this.stateRoot});cwd=snapshot.filesDir;run=this.store.patchRun(runId,{snapshot_dir:sd,manifest_path:snapshot.manifestPath});
      }
      if(cancelled)throw new Error('CANCELLED');const payload=this.buildPayload(run);if(cancelled)throw new Error('CANCELLED');
      const result=await this.gemini.run({mode:run.mode,cwd,payload,onProcess:async p=>{proc=p;const identity=await processIdentity(p.pid);if(!identity)throw new Error('PROCESS_IDENTITY_UNAVAILABLE');this.store.patchRun(runId,{pid:p.pid,process_identity:identity});},onPartial:text=>{partial=text;const n=Date.now();if(n-lastPersist>300){lastPersist=n;this.store.patchRun(runId,{partial_text:text.slice(-200000)});}}});
      if(cancelled)throw new Error('CANCELLED');
      const text=String(result.text||'').trim();
      if(run.mode==='edit'){
        const diff=await computeDiff(run.snapshot_dir);const info={model:result.model||null,diffSummary:diffSummary(diff),changes:diff.changes};
        if(diff.changes.length){this.store.completeRunWithTurns(runId,'RUNNING','WAITING_APPLY',{result_text:text,result_json:JSON.stringify(info),partial_text:null,error:null,pid:null,process_identity:null},run.prompt,text);}
        else{this.store.completeRunWithTurns(runId,'RUNNING','COMPLETED',{result_text:text,result_json:JSON.stringify(info),partial_text:null,error:null,pid:null,process_identity:null},run.prompt,text);await discardSnapshot(this.store.getRun(runId));}
      } else {
        this.store.completeRunWithTurns(runId,'RUNNING','COMPLETED',{result_text:text,result_json:JSON.stringify({model:result.model||null}),partial_text:null,error:null,pid:null,process_identity:null},run.prompt,text);
      }
    }catch(e){
      const cur=this.store.getRun(runId);if(!cur)return;
      if(['COMPLETED','WAITING_APPLY','APPLIED','DISCARDED'].includes(cur.status))return;
      const msg=redactError(e);
      if(cancelled||msg==='CANCELLED'){
        if(cur.mode==='edit'&&cur.snapshot_dir){
          try{const d=await computeDiff(cur.snapshot_dir);if(d.changes.length){this.store.transitionRun(runId,cur.status,'RECOVERY_REQUIRED',{error:'Cancelled after partial edits',pid:null,process_identity:null});return;}}catch{}
        }
        this.store.transitionRun(runId,cur.status,'CANCELLED',{error:'Cancelled',pid:null,process_identity:null});
      }else{
        if(cur.mode==='edit'&&cur.snapshot_dir){
          try{const d=await computeDiff(cur.snapshot_dir);if(d.changes.length){this.store.transitionRun(runId,cur.status,'RECOVERY_REQUIRED',{error:msg,pid:null,process_identity:null});return;}}catch(diffErr){await discardSnapshot(cur).catch(()=>{});}
        }
        this.store.transitionRun(runId,cur.status,'FAILED',{error:msg,pid:null,process_identity:null});
      }
    }finally{this.active.delete(runId);this.processSlots.delete(runId);this.release(locks);await this.cleanupRunArtifacts(this.store.getRun(runId));}
  }
  async cancelRun(id){
    const r=this.store.getRun(id);if(!r)throw new Error('RUN_NOT_FOUND');const a=this.active.get(id);
    if(a){await a.cancel();return this.publicRun(this.store.getRun(id));}
    if(r.status==='QUEUED'){this.store.transitionRun(id,'QUEUED','CANCELLED',{error:'Cancelled'});return this.getRun(id);}
    if(['RUNNING','APPLYING'].includes(r.status))throw new Error('RUN_OWNED_BY_ANOTHER_HOST');
    return this.publicRun(r);
  }
  async normalizeRecoveryRun(id,r){
    if(r.status==='RECOVERY_IDENTITY_UNKNOWN')throw new Error('RECOVERY_PROCESS_IDENTITY_UNKNOWN');
    if(r.status==='RECOVERY_PROCESS_ALIVE'){
      if(r.pid&&processMatchesIdentity(Number(r.pid),r.process_identity)) throw new Error('RECOVERY_PROCESS_STILL_ALIVE');
      r=this.store.transitionRun(id,'RECOVERY_PROCESS_ALIVE','RECOVERY_REQUIRED',{pid:null,process_identity:null,error:'Verified previous Gemini process exited or PID was reused; snapshot is ready for reconciliation'});
    }
    return r;
  }
  async reconcileRecoveryState(id,r){
    r=await this.normalizeRecoveryRun(id,r);
    const rec=await reconcileApply(r);
    if(rec.changes.length===0){
      if(['RECOVERY_REQUIRED','APPLY_RECOVERY_REQUIRED','APPLY_CONFLICT'].includes(r.status)){
        r=this.store.transitionRun(id,r.status,'FAILED',{error:'Interrupted Agent produced no recoverable changes',pid:null,process_identity:null});
        await this.cleanupRunArtifacts(r);
        return {run:this.publicRun(r),reconciliation:rec};
      }
      return {run:this.publicRun(r),reconciliation:rec};
    }
    if(rec.conflicts.length){
      if(r.status!=='APPLY_CONFLICT') r=this.store.transitionRun(id,r.status,'APPLY_CONFLICT',{error:`${rec.conflicts.length} live-file conflict(s)`});
      return {run:this.publicRun(r),reconciliation:rec};
    }
    if(rec.pending===0){
      if(r.status!=='APPLIED') r=this.store.transitionRun(id,r.status,'APPLIED',{error:null,pid:null,process_identity:null});
      await this.cleanupRunArtifacts(r);
      return {run:this.publicRun(r),reconciliation:rec};
    }
    if(r.status!=='WAITING_APPLY') r=this.store.transitionRun(id,r.status,'WAITING_APPLY',{error:null,pid:null,process_identity:null});
    return {run:this.publicRun(r),reconciliation:rec};
  }
  async previewRun(id){
    let r=this.store.getRun(id);if(!r)throw new Error('RUN_NOT_FOUND');if(r.mode!=='edit'||!r.snapshot_dir)throw new Error('NOT_AGENT_RUN');
    r=await this.normalizeRecoveryRun(id,r);if(!['WAITING_APPLY','RECOVERY_REQUIRED','APPLY_CONFLICT','APPLY_RECOVERY_REQUIRED'].includes(r.status))throw new Error(`RUN_NOT_PREVIEWABLE:${r.status}`);
    return {run:this.publicRun(r),preview:await previewSnapshot(r)};
  }
  async applyRun(id){
    let r=this.store.getRun(id);if(!r)throw new Error('RUN_NOT_FOUND');if(r.mode!=='edit')throw new Error('NOT_AGENT_RUN');
    const mgmt=this.acquireManagement(r,'apply');
    try{
      r=await this.normalizeRecoveryRun(id,r);
      if(['APPLY_RECOVERY_REQUIRED','APPLY_CONFLICT','RECOVERY_REQUIRED'].includes(r.status)){
        const normalized=await this.reconcileRecoveryState(id,r);
        r=this.store.getRun(id);
        if(r.status!=='WAITING_APPLY') return normalized;
      }
      if(r.status!=='WAITING_APPLY')throw new Error(`RUN_NOT_APPLICABLE:${r.status}`);
      r=this.store.transitionRun(id,'WAITING_APPLY','APPLYING');
      try{
        const out=await applySnapshot(r);
        if(out.ok){r=this.store.transitionRun(id,'APPLYING','APPLIED',{error:null,pid:null,process_identity:null});await this.cleanupRunArtifacts(r);return {run:this.publicRun(r),reconciliation:out.reconciliation};}
        r=this.store.transitionRun(id,'APPLYING','APPLY_CONFLICT',{error:`${out.conflicts.length} live-file conflict(s)`,pid:null,process_identity:null});return {run:this.publicRun(r),reconciliation:out.reconciliation};
      }catch(e){const msg=redactError(e);if(msg.includes('WORKSPACE_IDENTITY_CHANGED')||msg.includes('WORKSPACE_MISSING_OR_INACCESSIBLE'))r=this.store.transitionRun(id,'APPLYING','APPLY_CONFLICT',{error:`PREAPPLY_${msg}`,pid:null,process_identity:null});else r=this.store.transitionRun(id,'APPLYING','APPLY_RECOVERY_REQUIRED',{error:msg,pid:null,process_identity:null});return {run:this.publicRun(r),reconciliation:await reconcileApply(r).catch(()=>null)};}
    }finally{this.releaseManagement(mgmt);}
  }
  async reconcileRun(id){
    let r=this.store.getRun(id);if(!r)throw new Error('RUN_NOT_FOUND');if(r.mode!=='edit'||!r.snapshot_dir)throw new Error('NOT_RECONCILABLE');
    const mgmt=this.acquireManagement(r,'reconcile');
    try{
      r=this.store.getRun(id);
      if(!['RECOVERY_PROCESS_ALIVE','RECOVERY_IDENTITY_UNKNOWN','RECOVERY_REQUIRED','APPLY_RECOVERY_REQUIRED','APPLY_CONFLICT','WAITING_APPLY'].includes(r.status)) throw new Error(`RUN_NOT_RECONCILABLE:${r.status}`);
      return await this.reconcileRecoveryState(id,r);
    }finally{this.releaseManagement(mgmt);}
  }
  async discardRun(id){
    let r=this.store.getRun(id);if(!r)throw new Error('RUN_NOT_FOUND');
    const mgmt=this.acquireManagement(r,'discard');
    try{
      r=this.store.getRun(id);r=await this.normalizeRecoveryRun(id,r);
      if(!['WAITING_APPLY','RECOVERY_REQUIRED','APPLY_CONFLICT'].includes(r.status))throw new Error(`RUN_NOT_DISCARDABLE:${r.status}`);
      if(r.status==='APPLY_CONFLICT'&&!String(r.error||'').startsWith('PREAPPLY_')){const rec=await reconcileApply(r);if(rec.applied>0)throw new Error('PARTIAL_APPLY_CANNOT_DISCARD');}
      await discardSnapshot(r);r=this.store.transitionRun(id,r.status,'DISCARDED',{error:null,pid:null,process_identity:null});await this.cleanupRunArtifacts(r);return this.publicRun(r);
    }finally{this.releaseManagement(mgmt);}
  }
  handoff(projectId,threadId=null){
    const p=this.store.getProject(projectId);if(!p)throw new Error('PROJECT_NOT_FOUND');let turns=[];if(threadId){const th=this.store.getThread(threadId);if(!th||th.project_id!==projectId)throw new Error('THREAD_NOT_FOUND');turns=this.store.listTurns(threadId,12);}
    const pending=this.store.listRuns(projectId,['WAITING_APPLY','RECOVERY_REQUIRED','RECOVERY_PROCESS_ALIVE','RECOVERY_IDENTITY_UNKNOWN','APPLY_RECOVERY_REQUIRED','APPLY_CONFLICT']);
    const lines=[`# Gemini Bridge handoff — ${p.name}`,'',`Project context revision: ${p.current_context_revision}`,p.context||'(no project context)','', '## Recent completed conversation'];
    for(const t of turns)lines.push(`\n${t.role==='user'?'User':'Gemini'}:\n${t.content}`);
    lines.push('\n## Pending local Agent state');
    if(!pending.length)lines.push('No pending Agent changes.');
    for(const r of pending){let j={};try{j=JSON.parse(r.result_json||'{}')}catch{};lines.push(`- Run ${r.id}: ${r.status}${j.diffSummary?`\n${j.diffSummary}`:''}`);}
    lines.push('\nImportant: only runs with status APPLIED have been copied into the live workspace.');return lines.join('\n');
  }
  async cleanupRunArtifacts(run){
    if(!run)return false;const keep=run.mode==='edit'&&['WAITING_APPLY','RECOVERY_REQUIRED','RECOVERY_PROCESS_ALIVE','APPLYING','APPLY_RECOVERY_REQUIRED','APPLY_CONFLICT'].includes(run.status);if(keep)return false;
    // Terminal-run GC may encounter a stage left by a crash after the live
    // side effect. Clean it only through the journal proof; if that proof is
    // missing/corrupt or the stage hash changed, leave all artifacts intact.
    if(run.snapshot_dir){try{await discardSnapshot(run);}catch{return false;}}
    const base=path.join(this.stateRoot,'run-data',safeRunDirName(run.request_id));await fsp.rm(base,{recursive:true,force:true}).catch(()=>{});return true;
  }
  async verifyRuntime(){
    if(this.runtimeStatus.verifiedAt)return this.runtimeStatus;if(this.runtimeVerifyPromise)return await this.runtimeVerifyPromise;
    this.runtimeVerifyPromise=(async()=>{try{const version=await this.gemini.version();if(this.expectedGeminiVersion!==null){const expected=String(this.expectedGeminiVersion),normalize=v=>v.replace(/^v(?=\d)/,'');if(normalize(version)!==normalize(expected))throw new Error('GEMINI_VERSION_MISMATCH');}this.runtimeStatus={ok:true,version,error:null,verifiedAt:new Date().toISOString()};}catch(e){this.runtimeStatus={ok:false,version:null,error:redactError(e),verifiedAt:new Date().toISOString()};}return this.runtimeStatus;})();
    return await this.runtimeVerifyPromise;
  }
  async shutdownActive({timeoutMs=5000}={}){
    // Close the admission gate before draining. Operations that already own a
    // management lock are allowed to reach their durable boundary; new ones
    // fail closed in acquireManagement().
    this.maintenance=true;
    const cancelErrors=[];for(const id of [...this.active.keys()]){try{await this.cancelRun(id);}catch(e){if(!String(e?.message||e).includes('RUN_NOT_FOUND'))cancelErrors.push(e);}}
    const end=Date.now()+Math.max(250,Math.min(30000,Number(timeoutMs)||5000));
    while((this.active.size>0||this.processSlots.size>0||this.managementLocks.size>0)&&Date.now()<end)await new Promise(r=>setTimeout(r,20));
    if(this.active.size>0||this.processSlots.size>0||this.managementLocks.size>0)throw new Error('RUN_SHUTDOWN_TIMEOUT');
    if(cancelErrors.length)throw new Error(`RUN_SHUTDOWN_CANCEL_FAILED:${cancelErrors.map(e=>redactError(e)).join(' | ')}`);
    return true;
  }
  setMaintenance(enabled){this.maintenance=Boolean(enabled);return this.upgradeReadiness();}
  upgradeReadiness(){const unfinished=this.store.listUnfinished().map(r=>this.refreshRecoveredProcess(r)).filter(r=>!['COMPLETED','APPLIED','DISCARDED','FAILED','CANCELLED'].includes(r.status)).map(r=>({id:r.id,status:r.status,mode:r.mode,projectId:r.project_id}));const managementOperations=this.managementLocks.size;return {ok:this.maintenance&&unfinished.length===0&&this.active.size===0&&this.processSlots.size===0&&managementOperations===0,maintenance:this.maintenance,unfinished,activeRuns:this.active.size,processSlots:this.processSlots.size,managementOperations};}
  async health(){const g=this.runtimeStatus;return {ok:Boolean(g.ok),version:APP_VERSION,maintenance:this.maintenance,gemini:{version:g.version,error:g.error,verifiedAt:g.verifiedAt},activeRuns:this.active.size,processSlots:this.processSlots.size,maxGeminiProcesses:this.maxGeminiProcesses};}
}
