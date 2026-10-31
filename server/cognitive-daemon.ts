import { fork, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite } from '../scripts/runtime.mjs';
import type { Memory } from './memory.ts';

type Insight = {
  version: number; generatedAt: string; strategy: 'lexical' | 'graph';
  candidates: {id:string;left:{id:string;text:string};right:{id:string;text:string};reason:string;score?:number;status:string}[];
  conflicts: {id:string;left:{id:string;text:string};right:{id:string;text:string};reason:string;status:string}[];
  metrics: {reviewed:number;verified:number;directLinks:number;candidateLinks:number;potentialConflicts:number;
    retrievalExamples:number;lexicalRecallAt3:number;graphRecallAt3:number};
};
type State = {version:1;completed:string;pending:string|null;runs:number;failures:number;lastError:string;
  result:Insight|null};
const blank=():State=>({version:1,completed:'',pending:null,runs:0,failures:0,lastError:'',result:null});
const childFile=fileURLToPath(new URL('../scripts/cognitive-worker.mjs',import.meta.url));
const checksum=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function snapshot(memory:Memory){
  return {
    items:memory.items.slice(-600).map(x=>({id:x.id,kind:x.kind,text:x.text,status:x.status,
      until:x.until,source:x.source,evidence:x.evidence?.slice(0,6).map(e=>({source:e.source,quote:e.quote})),links:x.links.slice(0,30)})),
    edges:memory.edges.slice(-1500).map(x=>({from:x.from,to:x.to,type:x.type})),
  };
}
function validResult(x:any):x is Insight {
  return x?.version===1 && ['lexical','graph'].includes(x.strategy) &&
    Array.isArray(x.candidates)&&x.candidates.length<=48&&
    Array.isArray(x.conflicts)&&x.conflicts.length<=24 &&
    typeof x.metrics?.reviewed==='number' && typeof x.generatedAt==='string';
}

/** Parent owns all user data. Child only sees bounded copies for read-only analysis.
 * The queue is durable by fingerprint and replayed from the current memory after restart.
 */
export async function openCognitiveDaemon(dataDir:string, getMemory:()=>Memory) {
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
    if(closed||!state.pending||!enabled())return;
    if(timer)clearTimeout(timer);
    timer=setTimeout(()=>{timer=null;void processQueue();},delay);
    timer.unref?.();
  };
  const send=async(jobId:string,data:ReturnType<typeof snapshot>)=>{
    if(!child){
      // windowsHide is supported at runtime, but omitted from older
      // @types/node ForkOptions bundled by the CI typechecker.
      child=fork(childFile,[],{cwd:dataDir,execArgv:[],windowsHide:true,
        stdio:['ignore','ignore','ignore','ipc']} as Parameters<typeof fork>[2]);
      const started=child;
      child.on('exit',()=>{if(child===started)child=null;});
      child.on('error',()=>{if(child===started)child=null;});
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
    if(closed||running||!state.pending||!enabled())return;
    if(Date.now()<nextRetry){schedule(nextRetry-Date.now());return;}
    running=true;
    const token=generation;
    const data=pendingSnapshot||snapshot(getMemory());
    const fingerprint=checksum(data);
    // The queued memory was superseded while the process was paused.
    if(state.pending!==fingerprint){state.pending=fingerprint;await save();}
    try{
      const result=await send(fingerprint,data);
      if(token!==generation || !enabled() || state.pending!==fingerprint)return;
      state={...state,completed:fingerprint,pending:null,runs:state.runs+1,
        failures:0,lastError:'',result};
      await save();
    }catch{
      if(token!==generation||closed)return;
      state.failures=Math.min(100,state.failures+1);
      state.lastError='Не удалось обработать изменения, будет повтор.';
      nextRetry=Date.now()+Math.min(60_000,1000*2**Math.min(5,state.failures));
      await save();
      terminate();
    }finally{
      running=false;
      if(!closed&&state.pending&&enabled())schedule(Math.max(300,nextRetry-Date.now()));
    }
  }
  function enqueue() {
    if(!enabled())return;
    const data=snapshot(getMemory()),fingerprint=checksum(data);
    if(fingerprint===state.completed && !state.pending)return;
    if(state.pending===fingerprint)return;
    pendingSnapshot=data;
    state.pending=fingerprint;
    void save().catch(()=>{});
    schedule();
  }
  async function clear() {
    generation++;
    if(timer){clearTimeout(timer);timer=null;}
    terminate();
    await exited();
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
    state:!enabled()?'paused':state.pending?running?'working':'queued':'idle',
    pending:!!state.pending,runs:state.runs,failures:state.failures,
    lastError:state.lastError,result:enabled()?state.result:null,
  });
  const strategy=()=>enabled() && !state.pending ? state.result?.strategy||'lexical' : 'lexical';
  // On startup a pending fingerprint is replayed by re-snapshotting live data.
  if(enabled())enqueue();
  else if(state.pending||state.result)await clear();
  async function shutdown(){
    closed=true;
    generation++;
    if(timer)clearTimeout(timer);
    terminate();
    await exited();
    // A not-yet-completed request remains in the file for replay on next startup.
    await writes;
  }
  return {enqueue,clear,modeChanged,overview,strategy,shutdown};
}
