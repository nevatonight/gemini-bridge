import { spawn } from 'node:child_process';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));

export function childExited(child){
  return !child || child.exitCode!==null || child.signalCode!==null;
}

export function spawnManaged(command,args=[],options={}){
  return spawn(command,args,{...options,detached:options.detached??(process.platform!=='win32')});
}

export async function waitForChildExit(child,timeoutMs=3000){
  if(childExited(child))return true;
  const bounded=Math.max(25,Math.min(30000,Number(timeoutMs)||3000));
  return await new Promise(resolve=>{
    let done=false;const finish=v=>{if(done)return;done=true;clearTimeout(timer);child.off?.('close',onExit);child.off?.('exit',onExit);resolve(v);};
    const onExit=()=>finish(true);const timer=setTimeout(()=>finish(childExited(child)),bounded);
    child.once('close',onExit);child.once('exit',onExit);
  });
}

async function signalUnixTree(child,signal){
  let sent=false;
  if(Number.isInteger(child?.pid)&&child.pid>0){try{process.kill(-child.pid,signal);sent=true;}catch{}}
  if(!sent){try{child.kill(signal);sent=true;}catch{}}
  return sent;
}

export async function terminateProcessTree(child,{graceMs=200,timeoutMs=3000}={}){
  if(childExited(child))return {exited:true,alreadyExited:true};
  const pid=Number(child?.pid);if(!Number.isInteger(pid)||pid<=0)throw new Error('PROCESS_TREE_PID_INVALID');
  const total=Math.max(250,Math.min(30000,Number(timeoutMs)||3000));
  if(process.platform==='win32'){
    const killer=spawn('taskkill.exe',['/PID',String(pid),'/T','/F'],{stdio:'ignore',windowsHide:true,shell:false});
    await new Promise(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;resolve();};killer.once('close',finish);killer.once('error',finish);setTimeout(finish,Math.min(5000,total)).unref?.();});
    if(await waitForChildExit(child,total))return {exited:true,alreadyExited:false};
    throw new Error('PROCESS_TREE_TERMINATION_FAILED');
  }
  await signalUnixTree(child,'SIGTERM');
  if(await waitForChildExit(child,Math.min(total,Math.max(25,Number(graceMs)||200))))return {exited:true,alreadyExited:false};
  await signalUnixTree(child,'SIGKILL');
  if(await waitForChildExit(child,Math.max(25,total-Math.max(25,Number(graceMs)||200))))return {exited:true,alreadyExited:false};
  await sleep(10);
  if(childExited(child))return {exited:true,alreadyExited:false};
  throw new Error('PROCESS_TREE_TERMINATION_FAILED');
}
