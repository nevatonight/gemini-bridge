import {GeminiRunner} from './gemini.mjs';

export async function antigravityAuthStatus(stateRoot,cfg={}){
  const entry=cfg?.geminiEntry||process.env.GEMINI_BRIDGE_AGENT_ENTRY||process.env.GEMINI_BRIDGE_GEMINI_ENTRY||null;
  const runner=new GeminiRunner({stateRoot,geminiEntry:entry,nodePath:cfg?.nodePath||process.execPath});
  await runner.init();
  return await runner.authStatus();
}
export async function hasGeminiCredentials(stateRoot,cfg={}){
  const out=await antigravityAuthStatus(stateRoot,cfg);
  return out.authenticated===true;
}
export function geminiCredentialFile(){return 'Windows Credential Manager (Antigravity CLI)';}
