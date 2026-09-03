import path from 'node:path';
import { spawn } from 'node:child_process';
import { stateRoot, ensureDir, ensureOwnedDir } from './utils.mjs';
import { loadRuntimeConfig } from './runtime-config.mjs';
import { GeminiRunner, bridgeEnv } from './gemini.mjs';

const root=stateRoot(),cfg=await loadRuntimeConfig(root);
if(!cfg||typeof cfg.nodePath!=='string'||typeof cfg.geminiEntry!=='string')throw new Error('RUNTIME_CONFIG_MISSING_MANAGED_GEMINI');
const runner=new GeminiRunner({stateRoot:root,geminiEntry:cfg.geminiEntry,nodePath:cfg.nodePath});await runner.init();
const settings=await runner.settings('ask'),home=path.join(root,'gemini-home'),cwd=path.join(root,'auth-empty');await ensureOwnedDir(root,cwd);
const env=bridgeEnv(process.env,home,settings),cmd=runner.resolveCommand();
const child=spawn(cmd.cmd,[...cmd.args,'--skip-trust'],{cwd,env,stdio:'inherit',windowsHide:false,shell:false});
const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(c,s)=>resolve(c??(s?1:0)));});process.exitCode=code;
