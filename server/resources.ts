import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
type Budget={calls:number;bytes:number;deadline:number};
const error=(message:string)=>Object.assign(new Error(message),{status:429});
// In-memory counters contain sizes/codes only, never prompts or credentials. No automatic retries.
export function resources(config:{calls?:number;bytes?:number;windowMs?:number;concurrent?:number;now?:()=>number}={}){
  const now=config.now||Date.now,windowMs=config.windowMs??900000,limit=config.calls??120,bytes=config.bytes??4000000,concurrent=config.concurrent??3;
  const local=new AsyncLocalStorage<Budget>();let recent:{at:number;bytes:number}[]=[],active=0,failures=0,retryAt=0;
  let epoch=0;const cache=new Map<string,{at:number;value:string}>();const stats={calls:0,rejected:0,cacheHits:0,failures:0};
  return{
    run<T>(work:()=>Promise<T>){return local.run({calls:0,bytes:0,deadline:now()+180000},work);},
    reserve(size:number){recent=recent.filter(r=>now()-r.at<windowMs);const budget=local.getStore();
      if(!Number.isSafeInteger(size)||size<0||now()<retryAt||active>=concurrent||recent.length>=limit||recent.reduce((n,r)=>n+r.bytes,0)+size>bytes||(budget&&(budget.calls>=6||budget.bytes+size>1000000||now()>=budget.deadline))){stats.rejected++;throw error(now()<retryAt?'Сервис модели временно недоступен: повторите позже.':'Достигнут предел запросов или объёма данных. Повторите позже.');}
      if(budget){budget.calls++;budget.bytes+=size;}recent.push({at:now(),bytes:size});active++;stats.calls++;let finished=false;
      return{deadline:Math.min(now()+180000,budget?.deadline??Infinity),finish(success:boolean){if(finished)return;finished=true;active--;if(success){failures=0;}else{stats.failures++;if(++failures>=3)retryAt=now()+60000;}}};
    },
    cached(key:string,work:()=>Promise<string>,enabled=true){const generation=epoch,hashed=createHash('sha256').update(key).digest('hex'),old=cache.get(hashed);if(enabled&&old&&now()-old.at<120000){stats.cacheHits++;return Promise.resolve(old.value);}return work().then(value=>{if(enabled&&generation===epoch){cache.set(hashed,{at:now(),value});while(cache.size>30)cache.delete(cache.keys().next().value!);}return value;});},
    clear(){epoch++;cache.clear();failures=0;retryAt=0;},view(){return{...stats,active,retryAt};}
  };
}
export async function limitedText(response:Response,limit=1000000){const reader=response.body?.getReader();if(!reader)return '';let size=0;const chunks:Uint8Array[]=[];try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw Object.assign(new Error('Модель превысила допустимый размер ответа.'),{status:502});chunks.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}return Buffer.concat(chunks).toString('utf8');}
