import { open, readFile, rm, stat, statfs } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const error=(message:string,status=503)=>Object.assign(new Error(message),{status});
function live(pid:number){
  if(!Number.isSafeInteger(pid)||pid<1)return false;
  try{process.kill(pid,0);return true;}
  catch(e){return (e as NodeJS.ErrnoException).code==='EPERM';}
}
export async function acquireDatabaseWriter(file:string){
  const token=randomUUID();
  const lockPath=file+'.writer.lock';
  for(let attempt=0;attempt<16;attempt++){
    try{
      const handle=await open(lockPath,'wx',0o600);
      try{
        await handle.writeFile(JSON.stringify({pid:process.pid,token,createdAt:new Date().toISOString()}));
        await handle.sync();
      }finally{await handle.close();}
      return async()=>{
        try{
          const value=JSON.parse(await readFile(lockPath,'utf8'));
          if(value.token===token)await rm(lockPath,{force:true});
        }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
      };
    }catch(e){
      if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
      // A newly created but still unwritten lock is not stale. Also prevent
      // PID reuse from immediately stealing active locks.
      const snapshot=await readFile(lockPath,'utf8').catch(()=>null);
      const info=await stat(lockPath).catch(()=>null);
      if(!snapshot||!info||Date.now()-info.mtimeMs<1500){
        await new Promise(resolve=>setTimeout(resolve,250));continue;
      }
      let candidate:{pid?:number;token?:string}|null=null;
      try{candidate=JSON.parse(snapshot);}catch{}
      if(candidate?.pid&&live(candidate.pid))
        throw error('SQLite уже используется другим работающим экземпляром Miyuneya.');
      // Re-check the exact lock contents before reclaiming an abandoned file.
      // No live process is allowed to be displaced.
      if(await readFile(lockPath,'utf8').catch(()=>null)!==snapshot)continue;
      await rm(lockPath,{force:true});
    }
  }
  throw error('Не удалось захватить блокировку SQLite. Проверьте запущенные экземпляры.');
}
export async function ensureSpace(directory:string,bytes:number,operation:string){
  const usage=await statfs(directory).catch(()=>null);
  if(!usage)return; // Unknown disks: SQLite/fs errors still fail safely.
  const available=Number(usage.bavail)*Number(usage.bsize);
  if(Number.isFinite(available)&&available<Math.max(64*1024*1024,bytes+32*1024*1024))
    throw error('Недостаточно места для операции «'+operation+'». Освободите место на диске.',507);
}
