import { Worker } from 'node:worker_threads';
import type { ChatQuery, ChatMeta } from './chat-sqlite.ts';

export type ChatSearchQuery=ChatQuery & {
  mode?:'morphology'|'exact'|'phrase';
  typos?:boolean;
  sort?:'relevance'|'date';
};
type Raw=Record<string,any>;
export function searchInWorker(path:string,input:ChatSearchQuery):Promise<{
  schema:number;revision:number;selectedId:string|null;
  conversations:(ChatMeta & {matchSnippet?:string;relevance?:number})[];
  total:number;elapsedMs:number;
}>{
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('../scripts/chat-search-worker.mjs',import.meta.url),{
      workerData:{path,input},
    });
    let settled=false;
    const timer=setTimeout(()=>{
      worker.terminate().catch(()=>{});
      finish(Error('Поиск выполняется слишком долго. Уточните запрос.'));
    },15000);
    timer.unref?.();
    function finish(err?:Error,data?:Raw){
      if(settled)return;
      settled=true;clearTimeout(timer);
      if(err)reject(err);else resolve(data as ReturnType<typeof transform>);
    }
    function transform(data:Raw){
      return {
        schema:3,revision:0,selectedId:null,total:Number(data.total||0),
        elapsedMs:Number(data.elapsedMs||0),
        conversations:(data.rows||[]).map((r:Raw)=>({
          id:r.id,title:r.title,createdAt:r.created_at,updatedAt:r.updated_at,
          messageCount:Number(r.message_count),archived:!!r.archived,
          ...(r.parent_id?{parentId:r.parent_id,forkMessageId:r.fork_message_id}:{}),
          ...(r.excerpt?{matchSnippet:r.excerpt}:{}),
          ...(r.rank!==undefined&&r.rank!==null?{relevance:Number(r.rank)}:{})
        }))
      };
    }
    worker.once('message',(data:Raw)=>{
      if(data.error)return finish(Error(data.error));
      finish(undefined,transform(data));
    });
    worker.once('error',e=>finish(e));
    worker.once('exit',code=>{if(!settled)finish(Error('Поисковый процесс завершился с кодом '+code));});
  });
}
