import {stateRoot} from './utils.mjs';
import {loadRuntimeConfig} from './runtime-config.mjs';
import {GeminiRunner} from './gemini.mjs';

const root=stateRoot(),cfg=await loadRuntimeConfig(root);
if(!cfg||typeof cfg.geminiEntry!=='string')throw new Error('RUNTIME_CONFIG_MISSING_MANAGED_ANTIGRAVITY');
const runner=new GeminiRunner({stateRoot:root,geminiEntry:cfg.geminiEntry,nodePath:cfg.nodePath||process.execPath});
await runner.init();
const out=await runner.launchInteractiveAuth();
console.log(JSON.stringify(out));
