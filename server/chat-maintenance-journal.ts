// Bounded, privacy-preserving maintenance journal. Never store paths,
// message bodies, API keys, SQL statements or untrusted exception strings.
import { appendFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { retryFile } from '../scripts/runtime.mjs';

const OPERATIONS=new Set(['startup','check','optimize','checkpoint','backup','external-backup','search-rebuild','schedule','update-preflight']);
const RESULTS=new Set(['ok','failed','skipped','busy','warning']);
export type MaintenanceOperation='startup'|'check'|'optimize'|'checkpoint'|'backup'|'external-backup'|'search-rebuild'|'schedule'|'update-preflight';
export type MaintenanceResult='ok'|'failed'|'skipped'|'busy'|'warning';
export type MaintenanceEvent={time:string;operation:MaintenanceOperation;result:MaintenanceResult;durationMs:number;code:string};
const MAX_BYTES=512*1024;
export function openChatMaintenanceJournal(dataDir:string){
  const folder=join(dataDir,'chat-backups');
  const file=join(folder,'maintenance-events.jsonl');
  let chain=Promise.resolve();
  function write(operation:MaintenanceOperation,result:MaintenanceResult,code='none',durationMs=0){
    if(!OPERATIONS.has(operation)||!RESULTS.has(result))throw Error('Invalid maintenance journal event');
    const event:MaintenanceEvent={time:new Date().toISOString(),operation,result,
      durationMs:Math.max(0,Math.min(86_400_000,Math.round(durationMs))),
      code:/^[a-z0-9-]{1,50}$/.test(code)?code:'internal-error'};
    const job=chain.then(async()=>{
      await mkdir(folder,{recursive:true});
      const size=await stat(file).then(x=>x.size).catch(e=>{
        if((e as NodeJS.ErrnoException).code==='ENOENT')return 0;
        throw e;
      });
      if(size>MAX_BYTES){
        // Windows rename cannot replace an existing target. Retain the latest
        // complete generation and rotate only this bounded diagnostics log.
        await retryFile(()=>rm(file+'.previous',{force:true}));
        await retryFile(()=>rename(file,file+'.previous'));
      }
      await appendFile(file,JSON.stringify(event)+'\n',{encoding:'utf8',mode:0o600});
    });
    chain=job.catch(()=>{});
    return job;
  }
  async function recent(limit=35){
    await chain;
    const safe=Math.max(1,Math.min(100,Number.isSafeInteger(limit)?limit:35));
    const raw=await readFile(file,'utf8').catch(e=>{
      if((e as NodeJS.ErrnoException).code==='ENOENT')return '';
      throw e;
    });
    return raw.split('\n').filter(Boolean).slice(-safe).flatMap(line=>{
      try{
        const entry=JSON.parse(line) as MaintenanceEvent;
        if(!OPERATIONS.has(entry.operation)||!RESULTS.has(entry.result))return [];
        return [entry];
      }catch{return [];}
    });
  }
  return {path:file,write,recent,shutdown:()=>chain};
}
