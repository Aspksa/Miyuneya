import { open, readFile, mkdir, rename, rm, link } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { request } from 'node:http';

export async function retryFile(action, attempts = 6) {
  for (let attempt = 0; ; attempt++) {
    try { return await action(); }
    catch (e) {
      if (!['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY'].includes(e.code) || attempt >= attempts - 1) throw e;
      await delay(Math.min(30 * 2 ** attempt, 500));
    }
  }
}
export async function removeTree(path) { await retryFile(() => rm(path, {recursive:true, force:true})); }
export async function atomicWrite(path, content) {
  await mkdir(dirname(path), {recursive:true});
  const temp = path + '.' + randomUUID() + '.tmp';
  let handle;
  try {
    handle = await open(temp, 'wx', 0o600); await handle.writeFile(content); await handle.sync(); await handle.close(); handle = null;
    await retryFile(() => rename(temp, path));
  } finally { if (handle) await handle.close(); await retryFile(() => rm(temp, {force:true})); }
}
export async function readJSON(path) { return JSON.parse(await readFile(path, 'utf8')); }
export function localRequest(port, path, { method = 'GET', headers = {}, timeout = 2000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({hostname:'127.0.0.1',port,path,method,headers,timeout,agent:false}, res => {
      let body = ''; res.setEncoding('utf8');
      res.on('data',chunk=>{ body += chunk; if(body.length > 1_000_000) req.destroy(new Error('Response too large')); });
      res.on('end',()=>resolve({status:res.statusCode,body,headers:res.headers})); res.on('error',reject);
    });
    req.on('timeout',()=>req.destroy(new Error('Local health timeout'))); req.on('error',reject); req.end();
  });
}
export async function healthy(pointer, instance) {
  if (!pointer || !Number.isInteger(pointer.port) || pointer.port < 1 || pointer.port > 65535 || typeof pointer.launchId !== 'string') return false;
  try {
    const response = await localRequest(pointer.port, '/__miyuneya/health');
    const body = JSON.parse(response.body);
    return response.status === 200 && body.app === 'Miyuneya' && body.instance === instance && body.launchId === pointer.launchId && body.ready === true;
  } catch { return false; }
}
export async function acquireLock(instance) {
  if(process.platform !== 'win32') {
    // Linux uses a fully written hard-linked lock and the OS process birth identity.
    // PID alone is insufficient after a crash or PID reuse.
    const birth=async pid=>{
      try {const stat=await readFile('/proc/'+pid+'/stat','utf8');return stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];}
      catch(e){if(e.code!=='ENOENT')throw e;try{process.kill(Number(pid),0);return 'alive';}catch(probe){if(probe.code==='ESRCH')return null;throw probe;}}
    };
    const stamp=await birth(process.pid);
    if(!stamp)throw new Error('Process birth identity unavailable on this platform');
    const lock=join(tmpdir(),'miyuneya-'+instance+'.lock');
    const temp=lock+'.'+randomUUID();const token=randomUUID();
    await atomicWrite(temp,JSON.stringify({pid:process.pid,birth:stamp,token}));
    try {
      for(let attempt=0;attempt<3;attempt++) {
        try {await link(temp,lock);return async()=>{const owner=await readJSON(lock);if(owner.token!==token)throw new Error('Lock ownership changed');await rm(lock);};}
        catch(e){
          if(e.code!=='EEXIST')throw e;
          let owner;try{owner=await readJSON(lock);}catch(readError){if(readError.code==='ENOENT')continue;throw readError;}
          if(await birth(owner.pid)===owner.birth)return null;
          await rm(lock,{force:true});
        }
      }
      throw new Error('Could not acquire instance lock');
    } finally {await rm(temp,{force:true});}
  }
  // Windows named pipes are owned by the process and disappear automatically on exit.
  const server=createServer(socket=>socket.end());
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen('\\\\.\\pipe\\miyuneya-'+instance,resolve);});}
  catch(e){if(e.code==='EADDRINUSE')return null;throw e;}
  return async()=>{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));};
}
export async function makeLogger(root) {
  const directory = join(root,'.runtime','logs'); await mkdir(directory,{recursive:true});
  const path = join(directory,'startup.log');
  try { const s=await readFile(path); if(s.length>250000) await retryFile(()=>rename(path,path+'.previous')); } catch(e) { if(e.code!=='ENOENT') throw e; }
  const handle=await open(path,'a',0o600);
  let pending=Promise.resolve();
  return {
    path,
    log(stage, event, code=0) {
      // No environment, command arguments, HTTP payloads or exception text.
      const line=JSON.stringify({time:new Date().toISOString(),stage,event,code})+'\n';
      pending=pending.then(()=>handle.write(line)); return pending;
    },
    async close(){try{await pending;}finally{await handle.close();}}
  };
}
