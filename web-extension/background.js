importScripts('config.js');
const BASE=`http://127.0.0.1:${GB_PORT}`;
const GB_FETCH_TIMEOUT_MS=10000;

async function api(path,{method='GET',body=null}={}){
  const headers={'X-Gemini-Bridge-Token':GB_TOKEN};if(body!==null)headers['Content-Type']='application/json';
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),GB_FETCH_TIMEOUT_MS);
  try{
    const r=await fetch(BASE+path,{method,headers,body:body===null?undefined:JSON.stringify(body),cache:'no-store',signal:controller.signal});
    const data=await r.json().catch(()=>({error:`HTTP_${r.status}`}));
    if(r.status===401)throw new Error('PAIRING_REQUIRED: run Gemini Bridge Setup/Repair, then Reload this unpacked extension in Chrome/Edge.');
    if(!r.ok)throw new Error(data.error||`HTTP_${r.status}`);return data;
  }catch(e){if(e?.name==='AbortError')throw new Error('BRIDGE_TIMEOUT: local Gemini Bridge Host did not respond in time.');throw e;}
  finally{clearTimeout(timer);}
}

function bindingKey(sender){const tabId=sender.tab?.id;if(!Number.isInteger(tabId)||tabId<0)throw new Error('TAB_ID_UNAVAILABLE');return `gb-binding:${tabId}`;}
function safeRoute(route){const s=String(route||'');if(!s||s.length>4096)throw new Error('INVALID_BINDING_ROUTE');return s;}
function safeBinding(value){if(!value||typeof value!=='object')throw new Error('INVALID_BINDING');const projectId=String(value.projectId||'');const threadId=value.threadId==null?null:String(value.threadId);if(!/^[A-Za-z0-9._:-]{1,128}$/.test(projectId))throw new Error('INVALID_BINDING_PROJECT');if(threadId!==null&&!/^[A-Za-z0-9._:-]{1,128}$/.test(threadId))throw new Error('INVALID_BINDING_THREAD');return {projectId,threadId};}
async function getBinding(sender,route){const key=bindingKey(sender),wanted=safeRoute(route);const data=await chrome.storage.session.get([key]);const rec=data[key];return rec?.route===wanted?rec.binding:null;}
async function setBinding(sender,route,value){const key=bindingKey(sender),record={route:safeRoute(route),binding:safeBinding(value)};await chrome.storage.session.set({[key]:record});return record.binding;}

function preferenceStorageKey(key){if(key==='language')return 'gb-lang';throw new Error('INVALID_PREFERENCE');}
async function getPreference(key){const storageKey=preferenceStorageKey(key);const data=await chrome.storage.local.get([storageKey]);const value=data[storageKey];return value==='ru'||value==='en'?value:null;}
async function setPreference(key,value){const storageKey=preferenceStorageKey(key);if(key==='language'&&value!=='ru'&&value!=='en')throw new Error('INVALID_PREFERENCE_VALUE');await chrome.storage.local.set({[storageKey]:value});return value;}

chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
  if(msg?.kind==='gb-api'){
    api(msg.path,msg.options||{}).then(data=>reply({ok:true,data})).catch(e=>reply({ok:false,error:String(e.message||e)}));return true;
  }
  if(msg?.kind==='gb-binding-get'){
    getBinding(sender,msg.route).then(data=>reply({ok:true,data})).catch(e=>reply({ok:false,error:String(e.message||e)}));return true;
  }
  if(msg?.kind==='gb-binding-set'){
    setBinding(sender,msg.route,msg.value).then(data=>reply({ok:true,data})).catch(e=>reply({ok:false,error:String(e.message||e)}));return true;
  }
  if(msg?.kind==='gb-pref-get'){
    getPreference(msg.key).then(data=>reply({ok:true,data})).catch(e=>reply({ok:false,error:String(e.message||e)}));return true;
  }
  if(msg?.kind==='gb-pref-set'){
    setPreference(msg.key,msg.value).then(data=>reply({ok:true,data})).catch(e=>reply({ok:false,error:String(e.message||e)}));return true;
  }
});

// Tab IDs can be reused by the browser. Remove tab-local Bridge binding when
// the owning tab closes so a later tab cannot inherit the previous route state.
chrome.tabs.onRemoved.addListener(tabId=>{
  if(!Number.isInteger(tabId)||tabId<0)return;
  Promise.resolve(chrome.storage.session.remove(`gb-binding:${tabId}`)).catch(()=>{});
});
