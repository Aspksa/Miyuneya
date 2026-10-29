import { mkdtemp, mkdir, cp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { removeTree, readJSON, localRequest } from '../../scripts/runtime.mjs';
export { removeTree as removeTemp };
const resources=new Map();
export function own(root,cleanup){resources.get(root)?.push(cleanup);}
export async function fixture(t, name='Рабочий стол ! & ^ (проект) % #') {
  const parent=await mkdtemp(join(tmpdir(),'Miyuneya-test-'));
  const root=join(parent,name);await mkdir(root);
  for(const path of ['scripts','server','src','web','dist','package.json','Miyuneya.bat']) await cp(new URL('../../'+path,import.meta.url),join(root,path),{recursive:true});
  resources.set(root,[]);
  t.after(async()=>{for(const cleanup of resources.get(root).toReversed())await cleanup();await removeTree(parent);resources.delete(root);});return root;
}
export function launch(executable,args,options={}) {
  const process=spawn(executable,args,{stdio:['ignore','pipe','pipe'],windowsHide:true,...options});
  let output='';let errors='';let ended=false;
  const closed=new Promise(resolve=>{process.once('close',(code,signal)=>{ended=true;resolve({code,signal});});});
  process.stdout?.setEncoding('utf8');process.stderr?.setEncoding('utf8');
  process.stdout?.on('data',c=>{output+=c;});process.stderr?.on('data',c=>{errors+=c;});
  process.on('error',e=>{errors+=e.code;});
  return {process,closed,get ended(){return ended;},get output(){return output;},get errors(){return errors;}};
}
export async function deadline(promise,ms=20000) {
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Deadline exceeded')),ms);})]);}
  finally{clearTimeout(timer);}
}
export async function waitReady(root,child,ms=20000) {
  const limit=Date.now()+ms;
  while(Date.now()<limit) {
    if(child.ended)throw new Error('Launcher exited before readiness: '+child.output+' '+child.errors);
    try {
      const pointer=await readJSON(join(root,'.runtime','server.json'));
      const result=await localRequest(pointer.port,'/__miyuneya/health',{timeout:500});
      const health=JSON.parse(result.body);
      if(result.status===200 && health.ready && health.app==='Miyuneya' && health.launchId===pointer.launchId)return pointer;
    }catch(e){if(!['ENOENT','ECONNREFUSED','ECONNRESET'].includes(e.code) && !(e instanceof SyntaxError) && e.message!=='Local health timeout')throw e;}
    await delay(40); // Poll a real readiness condition, not a cleanup sleep.
  }
  throw new Error('Launcher readiness timed out: '+child.output+' '+child.errors);
}
export async function stop(root,child) {
  if(child.ended)return;
  try {
    const pointer=await readJSON(join(root,'.runtime','server.json'));
    await localRequest(pointer.port,'/__miyuneya/shutdown',{method:'POST',headers:{'X-Miyuneya-Session':pointer.launchId}});
    await deadline(child.closed,20000);
  } catch(e) {
    if(!child.ended) {
      if(process.platform==='win32') {
        const killer=launch(join(process.env.SystemRoot,'System32','taskkill.exe'),['/PID',String(child.process.pid),'/T','/F']);await killer.closed;
      } else child.process.kill();
      await deadline(child.closed,10000);
    }
    throw e;
  }
}
export function nodeLaunch(root,env={}) {const child=launch(process.execPath,[join(root,'scripts','start.mjs')],{cwd:tmpdir(),env:{...process.env,...env}});own(root,()=>stop(root,child));return child;}
export function batLaunch(root,env={},shellExecute=false) {
  const testEnv={...process.env,MIYUNEYA_BAT_TEST:join(root,'Miyuneya.bat'),MIYUNEYA_NO_OPEN:'1',MIYUNEYA_NO_PAUSE:'1',MIYUNEYA_NODE:process.execPath,...env};
  for(const key of Object.keys(testEnv))if(testEnv[key]===undefined)delete testEnv[key];
  let child;
  if(shellExecute)child=launch(join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-Command','$p = Start-Process -FilePath $env:MIYUNEYA_BAT_TEST -WorkingDirectory $env:TEMP -PassThru -Wait; exit $p.ExitCode'],{cwd:tmpdir(),env:testEnv});
  else child=launch(process.env.ComSpec || join(process.env.SystemRoot,'System32','cmd.exe'),['/d','/v:off','/s','/c','""%MIYUNEYA_BAT_TEST%""'],{cwd:tmpdir(),env:testEnv,windowsVerbatimArguments:true});
  own(root,()=>stop(root,child));return child;
}
