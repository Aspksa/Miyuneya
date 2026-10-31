import { fork, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite } from '../scripts/runtime.mjs';
import type { Memory } from './memory.ts';
import { openCognitiveJobs } from './cognitive-jobs.ts';

type Insight = {
  version: number; generatedAt: string; strategy: 'lexical' | 'graph';
  candidates: {id:string;left:{id:string;text:string};right:{id:string;text:string};reason:string;score?:number;status:string}[];
  conflicts: {id:string;left:{id:string;text:string};right:{id:string;text:string};reason:string;status:string}[];
  growth?: {reviewed:number;grounded:number;archiveReviewed:number;branches:unknown[];paths:unknown[];
    sourceChecks:unknown[];ambiguities:unknown[];candidateLinks:unknown[];conflicts:unknown[];
    temporal:unknown[];feedback:unknown;evaluation:{examples:number;lexical:number;graph:number;holdout:boolean}};
  metrics: {reviewed:number;verified:number;directLinks:number;candidateLinks:number;potentialConflicts:number;
    retrievalExamples:number;lexicalRecallAt3:number;graphRecallAt3:number};
};
type State = {version:1;completed:string;pending:string|null;runs:number;failures:number;lastError:string;
  archiveOffset:number;lastArchiveAt:number;lastEvaluationAt:number;
  result:Insight|null};
const blank=():State=>({version:1,completed:'',pending:null,runs:0,failures:0,lastError:'',
  archiveOffset:0,lastArchiveAt:0,lastEvaluationAt:0,result:null});
const childFile=fileURLToPath(new URL('../scripts/cognitive-worker.mjs',import.meta.url));
const checksum=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function snapshot(memory:Memory){
  return {
    items:memory.items.slice(-600).map(x=>({id:x.id,kind:x.kind,text:x.text,status:x.status,
      until:x.until,category:x.category,source:x.source,evidence:x.evidence?.slice(0,6).map(e=>({source:e.source,quote:e.quote,role:e.role})),links:x.links.slice(0,30)})),
    edges:memory.edges.slice(-1500).map(x=>({from:x.from,to:x.to,type:x.type})),
    entities:memory.entities.slice(-300).map(x=>({id:x.id,name:x.name,aliases:x.aliases})),
    mistakes:memory.mistakes.slice(-50).map(x=>({kind:x.kind,text:x.text})),
    history:(memory.history||[]).slice(-50).map(x=>({reason:x.reason})),
  };
}
function validResult(x:any):x is Insight {
  return x?.version===1 && ['lexical','graph'].includes(x.strategy) &&
    Array.isArray(x.candidates)&&x.candidates.length<=48&&
    Array.isArray(x.conflicts)&&x.conflicts.length<=24 &&
    (!x.growth || (Array.isArray(x.growth.branches)&&x.growth.branches.length<=12 &&
      Array.isArray(x.growth.paths)&&x.growth.paths.length<=10 &&
      x.growth.evaluation?.examples<=24)) &&
    typeof x.metrics?.reviewed==='number' && typeof x.generatedAt==='string';
}

/** Parent owns all user data. Child only sees bounded copies for read-only analysis.
 * The queue is durable by fingerprint and replayed from the current memory after restart.
 */
export async function openCognitiveDaemon(dataDir:string,getMemory:()=>Memory,
  getArchivePage?: (offset:number,limit:number)=>{total:number;offset:number;items:Memory['items']},
  isIdle:()=>boolean=()=>true,
  sweepMs=60_000) {
  const file=join(dataDir,'cognitive-daemon.json');
  let state:State=blank();
  try {
    const saved=JSON.parse(await readFile(file,'utf8'));
    if(saved?.version===1 && typeof saved.completed==='string' && Number.isSafeInteger(saved.runs) &&
       (saved.pending===null||typeof saved.pending==='string') && (saved.result===null||validResult(saved.result)))
      state={...blank(),...saved};
    else throw Error('invalid');
  }catch(e){
    if((e as NodeJS.ErrnoException).code!=='ENOENT') {
      await rename(file,join(dataDir,'cognitive-daemon.broken-'+Date.now()+'.json')).catch(()=>{});
    }
  }
  const jobs=openCognitiveJobs(dataDir);
  let child:ChildProcess|null=null;
  let pendingSnapshot:ReturnType<typeof snapshot>|null=null;
  let timer:ReturnType<typeof setTimeout>|null=null;
  let running=false,closed=false,generation=0;
  let writes=Promise.resolve();
  const exiting:Promise<void>[]=[];
  let lastActivity=Date.now(),nextRetry=0;
  const enabled=()=>{const m=getMemory();return !closed && m.settings.enabled && !m.settings.private;};
  const save=()=>{const copy=structuredClone(state);const operation=writes.then(()=>atomicWrite(file,JSON.stringify(copy)));
    writes=operation.catch(()=>{});return operation;};
  const terminate=()=>{
    if(!child)return;
    const proc=child;child=null;
    // Windows locks a child's current working directory until the process
    // has actually exited. Wait for that exit before cleanup of temporary data.
    const waited=new Promise<void>(resolve=>{
      if(proc.exitCode!==null || proc.signalCode!==null){resolve();return;}
      const timeout=setTimeout(resolve,3000);
      proc.once('exit',()=>{clearTimeout(timeout);resolve();});
    });
    exiting.push(waited);
    proc.kill();
  };
  const exited=async()=>{await Promise.all(exiting.splice(0));};
  const schedule=(delay=300)=>{
    if(closed||!jobs.overview().queued||!enabled())return;
    if(timer)clearTimeout(timer);
    timer=setTimeout(()=>{timer=null;void processQueue();},delay);
    timer.unref?.();
  };
  const send=async(jobId:string,data:ReturnType<typeof snapshot>)=>{
    if(!child){
      // windowsHide is supported at runtime, but omitted from older
      // @types/node ForkOptions bundled by the CI typechecker.
      child=fork(childFile,[],{cwd:dataDir,execArgv:['--max-old-space-size=96'],windowsHide:true,
        stdio:['ignore','ignore','ignore','ipc']} as Parameters<typeof fork>[2]);
      const started=child;
      child.on('exit',()=>{if(child===started)child=null;});
      child.on('error',()=>{if(child===started)child=null;});
      // Background analytics must not keep a finished test or a closing app alive.
      child.unref();
    }
    const proc=child;
    if(!proc?.connected)throw Error('Фоновый процесс недоступен');
    return new Promise<Insight>((resolve,reject)=>{
      let finished=false;
      const finish=(error?:Error,result?:Insight)=>{
        if(finished)return;finished=true;
        clearTimeout(timeout);
        proc.off('message',onMessage);proc.off('exit',onExit);proc.off('error',onError);
        error?reject(error):resolve(result!);
      };
      const onMessage=(msg:any)=>{
        if(msg?.jobId!==jobId)return;
        if(msg.type==='result' && validResult(msg.result) && JSON.stringify(msg.result).length<=150_000)finish(undefined,msg.result);
        else finish(Error('Неправильный результат когнитивного анализа'));
      };
      const onError=()=>finish(Error('Ошибка фонового процесса'));
      const onExit=()=>finish(Error('Фоновый процесс неожиданно завершился'));
      const timeout=setTimeout(()=>{terminate();finish(Error('Превышено время когнитивного анализа'));},15_000);
      proc.on('message',onMessage);proc.once('exit',onExit);proc.once('error',onError);
      proc.send({type:'analyze',jobId,snapshot:data},err=>{if(err)finish(Error('Не удалось передать задание'))});
    });
  };
  async function processQueue(){
    if(closed||running||!enabled())return;
    const task=jobs.take();
    if(!task){
      const next=jobs.overview().next;
      if(next!==null)schedule(Math.max(300,next-Date.now()));
      return;
    }
    running=true;
    const token=generation;
    const base=snapshot(getMemory());
    const page=task.kind==='archive' ? getArchivePage?.(state.archiveOffset,48) : null;
    const data=page ? {...base,archive:page.items.map(x=>({id:x.id,kind:x.kind,text:x.text,
      status:x.status,until:x.until,category:x.category,source:x.source,
      evidence:x.evidence?.slice(0,6).map(e=>({source:e.source,quote:e.quote,role:e.role})),
      links:x.links.slice(0,30)}))} : base;
    // A stale change job must not replace a newer version of memory.
    if(task.kind==='changes' && task.fingerprint!==checksum(base)){
      jobs.finish(task);running=false;enqueue();schedule();return;
    }
    state.pending=task.fingerprint;
    try{
      const result=await send(task.fingerprint,data);
      if(token!==generation||!enabled())return;
      jobs.finish(task);
      jobs.record(task,result.metrics,'shadow');
      const recent=jobs.history('changes').filter(x=>x.examples>=8);
      const improved=recent.length>=2 && recent.slice(0,2).every(x=>x.graph>=x.lexical+0.05);
      result.strategy=improved ? 'graph' : 'lexical';
      if(task.kind==='archive' && page){
        state.archiveOffset=page.offset+page.items.length>=page.total?0:page.offset+page.items.length;
        state.lastArchiveAt=Date.now();
      }
      if(task.kind==='evaluation')state.lastEvaluationAt=Date.now();
      state={...state,completed:task.kind==='changes'?task.fingerprint:state.completed,
        pending:null,runs:state.runs+1,failures:0,lastError:'',result};
      await save();
    }catch{
      if(token!==generation||closed)return;
      jobs.retry(task);
      state.failures=Math.min(100,state.failures+1);
      state.lastError='Фоновый анализ не завершён, повтор будет выполнен с задержкой.';
      await save();
      terminate();
    }finally{
      running=false;
      const next=jobs.overview().next;
      if(next!==null&&!closed&&enabled())schedule(Math.max(300,next-Date.now()));
    }
  }
  function enqueue(){
    if(!enabled())return;
    const data=snapshot(getMemory());
    const enough=data.items.filter(x=>x.kind==='fact').length>=2;
    if(!enough && !(getArchivePage?.(0,1).total)){
      if(state.pending||state.result)void clear().catch(()=>{});
      return;
    }
    const fingerprint=checksum(data);
    if(fingerprint===state.completed && !jobs.pending().some(x=>x.kind==='changes'))return;
    jobs.enqueue('changes',fingerprint,10);
    pendingSnapshot=data;
    state.pending=fingerprint;
    void save().catch(()=>{});
    schedule();
  }
  function recurring(){
    if(!enabled()||!isIdle()||running||jobs.overview().queued)return;
    const now=Date.now();
    if(getArchivePage&&now-state.lastArchiveAt>10*60_000){
      const page=getArchivePage(state.archiveOffset,48);
      if(page.total&&page.items.length){
        const fingerprint=checksum({kind:'archive',offset:page.offset,ids:page.items.map(x=>x.id),
          base:checksum(snapshot(getMemory()))});
        jobs.enqueue('archive',fingerprint,3);
        state.pending=fingerprint;
        void save().catch(()=>{});schedule(1000);return;
      }
    }
    if(now-state.lastEvaluationAt>=24*60*60_000){
      const fingerprint=checksum({kind:'evaluation',base:checksum(snapshot(getMemory())),
        day:Math.floor(now/(24*60*60_000))});
      jobs.enqueue('evaluation',fingerprint,1);
      state.pending=fingerprint;
      void save().catch(()=>{});schedule(1000);
    }
  }
  const recurringTimer=setInterval(recurring,Math.max(50,sweepMs));
  recurringTimer.unref();
  async function clear() {
    generation++;
    if(timer){clearTimeout(timer);timer=null;}
    terminate();
    await exited();
    jobs.clear();
    pendingSnapshot=null;
    state=blank();
    await save();
  }
  // No pending private snapshots may be processed after an explicit mode change.
  async function modeChanged() {
    if(!enabled())await clear();
    else enqueue();
  }
  const overview=()=>({
    state:!enabled()?'paused':running?'working':jobs.overview().queued?'queued':'idle',
    pending:jobs.overview().queued>0,runs:state.runs,failures:state.failures,
    lastError:state.lastError,result:enabled()?state.result:null,
  });
  const strategy=()=>enabled() && !jobs.overview().queued ? state.result?.strategy||'lexical' : 'lexical';
  // On startup a pending fingerprint is replayed by re-snapshotting live data.
  if(enabled()){enqueue();schedule();}
  else if(state.pending||state.result||jobs.overview().queued)await clear();
  async function shutdown(){
    closed=true;
    generation++;
    if(timer)clearTimeout(timer);
    clearInterval(recurringTimer);
    terminate();
    await exited();
    // A not-yet-completed request remains in SQLite for recovery on next startup.
    await writes;
    jobs.close();
  }
  return {enqueue,clear,modeChanged,overview,strategy,shutdown};
}
