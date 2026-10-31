// Dedicated low-privilege cognitive child process. It cannot access project files,
// tokens or Cloud.ru; all inputs are bounded snapshots sent over IPC.
import { createHash } from 'node:crypto';

const words = text => new Set((String(text).toLocaleLowerCase('ru').match(/[\p{L}\p{N}]{3,}/gu)||[]).filter(w=>!STOP.has(w)));
const STOP=new Set(['что','это','как','для','или','она','они','его','еще','уже','есть','будет','было','были','если','при','под','без','мне','нас','свои','свой','всех','через','этот','эти','того','после','между']);
const shared=(a,b)=>{let n=0;for(const w of a)if(b.has(w))n++;return n;};
const valid=item=>item && typeof item.id==='string' && typeof item.text==='string';
const active=(item,now)=>item.status==='active' && (!item.until || Date.parse(item.until)>now);
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
const id=(a,b)=>createHash('sha256').update([a,b].sort().join(':')).digest('hex').slice(0,16);
const negated=text=>/(?:^|\s)(?:не|нет|никогда|без)\s/iu.test(text);
const numbers=text=>(text.match(/\b\d+(?:[.,]\d+)?\b/g)||[]).join(',');

export function analyzeCognitive(snapshot, now=Date.now()) {
  const items=(Array.isArray(snapshot?.items)?snapshot.items:[]).filter(valid).slice(-600);
  const facts=items.filter(x=>x.kind==='fact' && x.status!=='superseded' && (!x.until || Date.parse(x.until)>now));
  const verified=facts.filter(x=>active(x,now));
  const byId=new Map(verified.map(x=>[x.id,x]));
  const direct=new Set();
  for(const x of verified) for(const linked of (x.links||[]))if(byId.has(linked))direct.add(id(x.id,linked));
  for(const edge of (snapshot.edges||[]).slice(-1500))if(byId.has(edge.from)&&byId.has(edge.to))direct.add(id(edge.from,edge.to));
  const tokenMap=new Map(facts.map(x=>[x.id,words(x.text)]));
  const candidates=[],conflicts=[];
  // Bounded per-snapshot pair analysis: no quadratic scan over every old archive row.
  const pool=facts.slice(-240);
  for(let i=0;i<pool.length;i++)for(let j=i+1;j<pool.length;j++){
    const a=pool[i],b=pool[j];
    const ta=tokenMap.get(a.id),tb=tokenMap.get(b.id);
    const common=shared(ta,tb);
    if(!common)continue;
    const overlap=common/Math.max(1,Math.min(ta.size,tb.size));
    if(overlap<0.5 || common<2)continue;
    const k=id(a.id,b.id);
    if(!direct.has(k) && overlap>=0.65 && candidates.length<64) {
      candidates.push({id:k,left:{id:a.id,text:a.text.slice(0,125)},right:{id:b.id,text:b.text.slice(0,125)},reason:'Лексическое совпадение; не доказательство связи',score:Math.round(overlap*100)/100,status:'candidate'});
    }
    if((negated(a.text)!==negated(b.text) || (numbers(a.text)&&numbers(b.text)&&numbers(a.text)!==numbers(b.text))) && conflicts.length<32){
      conflicts.push({id:k,left:{id:a.id,text:a.text.slice(0,125)},right:{id:b.id,text:b.text.slice(0,125)},reason:'Возможное расхождение отрицаний или чисел; нужна проверка',status:'candidate'});
    }
  }
  // Deterministic leave-one-out retrieval proxy over *already recorded* graph
  // links; this measures link recovery, not truth or overall response accuracy.
  const examples=[];
  for(const a of verified.slice(-120)){
    const linked=verified.filter(b=>b.id!==a.id&&direct.has(id(a.id,b.id)));
    if(linked.length) examples.push({a,targets:new Set(linked.map(b=>b.id))});
    if(examples.length>=24)break;
  }
  function score(q,b,mode) {
    const ta=words(q.text),tb=tokenMap.get(b.id)||words(b.text);
    const lexical=shared(ta,tb)/Math.max(1,Math.sqrt(ta.size*tb.size));
    return lexical+(mode==='graph' && direct.has(id(q.id,b.id))?0.6:0);
  }
  function evaluate(mode) {
    let found=0;
    for(const {a,targets} of examples){
      const top=verified.filter(x=>x.id!==a.id).map(b=>({id:b.id,score:score(a,b,mode)})).sort((x,y)=>y.score-x.score||x.id.localeCompare(y.id)).slice(0,3);
      if(top.some(x=>targets.has(x.id)))found++;
    }
    return examples.length ? found/examples.length : 0;
  }
  const lexical=evaluate('lexical'),graph=evaluate('graph');
  // A strategy is permitted only if it improves on known links; never promoted to fact.
  const strategy=examples.length>=3 && graph>lexical ? 'graph' : 'lexical';
  return {
    generatedAt:new Date(now).toISOString(), version:1,
    candidates:candidates.slice(0,48),conflicts:conflicts.slice(0,24),
    metrics:{reviewed:facts.length,verified:verified.length,directLinks:direct.size,
      candidateLinks:candidates.length,potentialConflicts:conflicts.length,
      retrievalExamples:examples.length,lexicalRecallAt3:+lexical.toFixed(3),graphRecallAt3:+graph.toFixed(3)},
    strategy,
  };
}

if (typeof process.send==='function') {
  process.on('message',msg=>{
    if(msg?.type==='stop'){process.exit(0);return;}
    if(msg?.type!=='analyze'||typeof msg.jobId!=='string')return;
    try{
      const result=analyzeCognitive(msg.snapshot);
      process.send?.({type:'result',jobId:msg.jobId,result});
    }catch(e){
      process.send?.({type:'error',jobId:msg.jobId,reason:'Анализ не выполнен.'});
    }
  });
}
