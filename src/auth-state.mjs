import fsp from 'node:fs/promises';
import path from 'node:path';

const MAX_CREDENTIAL_BYTES=1024*1024;
export function geminiCredentialFile(stateRoot){return path.join(stateRoot,'gemini-home','.gemini','oauth_creds.json');}
export async function hasGeminiCredentials(stateRoot){
  const file=geminiCredentialFile(stateRoot);let st;try{st=await fsp.lstat(file);}catch{return false;}
  if(!st.isFile()||st.isSymbolicLink()||st.size<2||st.size>MAX_CREDENTIAL_BYTES)return false;
  try{
    const value=JSON.parse(await fsp.readFile(file,'utf8'));
    if(!value||typeof value!=='object'||Array.isArray(value))return false;
    return ['access_token','refresh_token','id_token'].some(k=>typeof value[k]==='string'&&value[k].length>0);
  }catch{return false;}
}
