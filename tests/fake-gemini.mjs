import fsp from 'node:fs/promises';
import path from 'node:path';

const args=process.argv.slice(2);
if(args.includes('--version')){console.log('0.55.1');process.exit(0);}
let input='';for await(const c of process.stdin)input+=c;
const settingsPath=process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH;let settings={};try{settings=JSON.parse(await fsp.readFile(settingsPath,'utf8'))}catch{}
const tools=settings?.tools?.core||[];
const emit=o=>process.stdout.write(JSON.stringify(o)+'\n');
emit({type:'init',model:'fake-gemini'});
const sleep=input.match(/TEST_SLEEP\s+(\d+)/);if(sleep)await new Promise(r=>setTimeout(r,Number(sleep[1])));
if(input.includes('TEST_FAIL')){process.stderr.write('fake failure');process.exit(1);}
if(input.includes('TEST_EARLY_EXIT')){process.exit(42);}
if(input.includes('TEST_MALFORMED_JSONL')){process.stdout.write('{not-json\n');process.exit(0);}
if(input.includes('TEST_NO_RESULT')){emit({type:'message',role:'assistant',content:'partial-only'});process.exit(0);}
if(input.includes('TEST_RESULT_ERROR')){emit({type:'result',status:'error',error:{message:'terminal failure'}});process.exit(0);}
const stderrBytes=input.match(/TEST_STDERR_BYTES\s+(\d+)/);if(stderrBytes){await new Promise((resolve,reject)=>process.stderr.write('E'.repeat(Number(stderrBytes[1])),e=>e?reject(e):resolve()));emit({type:'result',status:'success',response:'ok'});process.exit(0);}
const rawBytes=input.match(/TEST_RAW_BYTES\s+(\d+)/);if(rawBytes){await new Promise((resolve,reject)=>process.stdout.write(JSON.stringify({type:'noise',padding:'Z'.repeat(Number(rawBytes[1]))})+'\n',e=>e?reject(e):resolve()));emit({type:'result',status:'success',response:'ok'});process.exit(0);}
const big=input.match(/TEST_BIG_OUTPUT\s+(\d+)/);if(big){const text='X'.repeat(Number(big[1]));await new Promise((resolve,reject)=>process.stdout.write(JSON.stringify({type:'message',role:'assistant',content:text})+'\n',e=>e?reject(e):resolve()));await new Promise((resolve,reject)=>process.stdout.write(JSON.stringify({type:'result',status:'success'})+'\n',e=>e?reject(e):resolve()));process.exit(0);}
const bigResult=input.match(/TEST_BIG_RESULT\s+(\d+)/);if(bigResult){const text='R'.repeat(Number(bigResult[1]));await new Promise((resolve,reject)=>process.stdout.write(JSON.stringify({type:'result',response:text})+'\n',e=>e?reject(e):resolve()));process.exit(0);}
if(input.includes('TEST_STDIN_LENGTH')){const text=`STDIN_LENGTH=${Buffer.byteLength(input,'utf8')}`;emit({type:'message',role:'assistant',content:text});emit({type:'result',response:text});process.exit(0);}
let response='OK';
const read=input.match(/TEST_READ\s+([^\s]+)/);
if(read){
  if(!tools.includes('read_file')){response='READ_TOOL_DISABLED';}
  else{try{response=await fsp.readFile(path.resolve(process.cwd(),read[1]),'utf8')}catch(e){response=`READ_ERROR:${e.code||e.message}`;}}
}
const edit=input.match(/TEST_EDIT\s+([^\s]+)\s*=>\s*([^\n\r]+)/);
if(edit){
  if(!tools.includes('write_file'))response='WRITE_TOOL_DISABLED';
  else{const p=path.resolve(process.cwd(),edit[1]);await fsp.mkdir(path.dirname(p),{recursive:true});await fsp.writeFile(p,edit[2],'utf8');response=`EDITED ${edit[1]}`;}
}
const add=input.match(/TEST_ADD\s+([^\s]+)\s*=>\s*([^\n\r]+)/);
if(add&&tools.includes('write_file')){const p=path.resolve(process.cwd(),add[1]);await fsp.mkdir(path.dirname(p),{recursive:true});await fsp.writeFile(p,add[2],'utf8');response+=` ADDED ${add[1]}`;}
const del=input.match(/TEST_DELETE\s+([^\s]+)/);
if(del&&tools.includes('write_file')){await fsp.rm(path.resolve(process.cwd(),del[1]),{force:true});response+=` DELETED ${del[1]}`;}
const expose=input.includes('TEST_REPORT_TOOLS');if(expose)response=JSON.stringify(tools);
emit({type:'message',role:'assistant',content:response});emit({type:'result',response});
