// Deterministic, read-only cognitive growth. All inferred relations are proposals,
// not factual claims. No network, no paid models, no autonomous source modifications.
import { createHash } from 'node:crypto';

const STOP=new Set(['это','того','этот','эти','для','или','будет','была','были','было','что','чтобы','как','они','она','его','них','здесь','есть','также','самый','когда','после','перед','свои','свой','нужно','можно','через','между','такой','таких','всего','один','одна','всегда','только','работает','проект','проекта','проекте']);
const ending=/(иями|остью|скими|скими|ками|ями|ами|ого|ему|иях|ция|ций|иях|овы|ыми|ыми|ами|ыми|ыми|ем|ам|ой|ов|ев|ое|ая|ый|ий|ые|ых|их|ую|ей|ие|ть|ты|ти|ом|ах|ях|а|я|е|и|ы|у|ю|о)$/u;
function normalize(word){
  const w=word.toLocaleLowerCase('ru').replaceAll('ё','е');
  return w.length>5 ? w.replace(ending,'') : w;
}
const words=text=>[...new Set((String(text).match(/[\p{L}\p{N}]{3,}/gu)||[]).map(normalize).filter(x=>x.length>=3&&!STOP.has(x)))];
const trigrams=text=>{
  const raw=String(text).toLocaleLowerCase('ru').replaceAll('ё','е').replace(/[^\p{L}\p{N}]+/gu,' ');
  const parts=raw.trim().split(/\s+/).filter(x=>x.length>=5);
  const grams=new Set();
  for(const p of parts.slice(0,40))for(let i=0;i<=p.length-3;i++)grams.add(p.slice(i,i+3));
  return grams;
};
const setScore=(a,b)=>{if(!a.size||!b.size)return 0;let n=0;for(const v of a)if(b.has(v))n++;return n/Math.sqrt(a.size*b.size)};
const hash=text=>createHash('sha256').update(text).digest('hex');
const pair=(a,b)=>[a,b].sort().join(':');
const year=text=>(String(text).match(/\b(?:19|20)\d{2}\b/g)||[]);
const compact=x=>({id:x.id,text:x.text.slice(0,125)});
const isCurrent=(x,now)=>x?.kind==='fact' && typeof x.id==='string' && typeof x.text==='string'
  && x.status!=='superseded' && (!x.until || Date.parse(x.until)>now);
const evidenceOf=x=>(Array.isArray(x.evidence)?x.evidence:[]).filter(e=>e &&
  typeof e.source==='string'&&typeof e.quote==='string'&&e.quote.trim().length>3);
const isRecorded=x=>x.status==='active' && (x.source==='user'||evidenceOf(x).some(e=>e.role==='user'||e.role==='note'));
function sources(x) {
  const evidence=evidenceOf(x),normalized=new Map();
  for(const e of evidence) {
    const quote=hash(e.quote.replace(/\s+/g,' ').trim().toLocaleLowerCase('ru')).slice(0,16);
    if(e.role==='assistant' || x.source==='thought')continue;
    normalized.set(quote,{source:e.source,quoteHash:quote});
  }
  return [...normalized.values()];
}
function buildLinkGraph(facts,edges){
  const current=new Set(facts.map(x=>x.id));
  const links=new Map(facts.map(x=>[x.id,new Set()]));
  const attach=(a,b)=>{if(a===b||!current.has(a)||!current.has(b))return;
    links.get(a).add(b);links.get(b).add(a)};
  for(const item of facts)for(const b of (item.links||[]).slice(0,30))attach(item.id,b);
  for(const edge of edges.slice(-1500))attach(edge.from,edge.to);
  return links;
}
function paths(graph,facts){
  const byId=new Map(facts.map(x=>[x.id,x])),found=[];
  for(const root of facts.slice(-80)){
    const visited=new Set([root.id]),queue=[[root.id]];
    while(queue.length&&found.length<10){
      const path=queue.shift();
      if(path.length>=4)continue;
      for(const next of (graph.get(path.at(-1))||[])) {
        if(visited.has(next))continue;visited.add(next);
        const p=[...path,next];queue.push(p);
        if(p.length===3 || p.length===4) {
          const first=byId.get(p[0]),last=byId.get(next);
          if(first&&last&&!graph.get(first.id).has(last.id)&&found.length<10)
            found.push({ids:p,description:'Путь через подтверждённые ассоциации (не причинная связь)',from:compact(first),to:compact(last),status:'candidate'});
        }
      }
    }
    if(found.length>=10)break;
  }
  return found;
}

function evaluation(facts,graph,tokens,grams) {
  // All held-out pairs are excluded in BOTH directions from the algorithm
  // during scoring. Never use the tested target edge as a predictor.
  const unique=[];
  for(const [a,neighbors] of graph)for(const b of neighbors)if(a<b)unique.push([a,b]);
  unique.sort((a,b)=>pair(...a).localeCompare(pair(...b)));
  const hold=unique.filter(x=>Number.parseInt(hash(pair(...x)).slice(0,6),16)%4===0).slice(0,24);
  const train=new Map([...graph].map(([id,s])=>[id,new Set(s)]));
  for(const [a,b] of hold){train.get(a).delete(b);train.get(b).delete(a)}
  const byId=new Map(facts.map(x=>[x.id,x]));
  const semantic=(a,b)=>{
    const lexical=setScore(tokens.get(a)||new Set(),tokens.get(b)||new Set());
    const morphological=setScore(grams.get(a)||new Set(),grams.get(b)||new Set());
    return lexical*0.7+morphological*0.3;
  };
  const score=(a,b,mode)=>{
    const sim=semantic(a,b);
    if(mode==='lexical')return setScore(tokens.get(a)||new Set(),tokens.get(b)||new Set());
    // Only the graph remaining after holdout is available for inference.
    const seen=train.get(a)||new Set();
    const neighbors=train.get(b)||new Set();
    let overlap=0;
    for(const x of seen)if(neighbors.has(x)){overlap++;if(overlap>=2)break}
    return sim+Math.min(0.24,overlap*0.12);
  };
  let lexicalHits=0,graphHits=0,used=0;
  for(const [a,b] of hold){
    if(!byId.has(a)||!byId.has(b))continue;
    used++;
    for(const mode of ['lexical','graph']){
      const best=facts.filter(x=>x.id!==a)
        .map(x=>({id:x.id,s:score(a,x.id,mode)}))
        .sort((x,y)=>y.s-x.s||x.id.localeCompare(y.id)).slice(0,3);
      if(best.some(x=>x.id===b)){if(mode==='lexical')lexicalHits++;else graphHits++}
    }
  }
  return {examples:used,lexical:used?lexicalHits/used:0,graph:used?graphHits/used:0,
    holdout:true,meaning:'Recall@3 на скрытых связях графа; не качество ответов LLM'};
}

export function analyzeGrowth(snapshot,now=Date.now()){
  const base=(Array.isArray(snapshot?.items)?snapshot.items:[]).slice(-600);
  const archive=(Array.isArray(snapshot?.archive)?snapshot.archive:[]).slice(0,80);
  const all=[...new Map([...base,...archive].filter(x=>x?.id&&typeof x.text==='string')
    .map(x=>[x.id,x])).values()];
  const facts=all.filter(x=>isCurrent(x,now)).slice(-680);
  const current=facts.filter(isRecorded);
  const graph=buildLinkGraph(current,Array.isArray(snapshot?.edges)?snapshot.edges:[]);
  const tokens=new Map(facts.map(x=>[x.id,new Set(words(x.text))]));
  const grams=new Map(facts.map(x=>[x.id,trigrams(x.text)]));
  const checks=[],ambiguities=[],candidateLinks=[],conflicts=[],temporal=[];
  for(const x of facts){
    const provenance=sources(x);
    if(provenance.length===0 && x.source!=='user' && checks.length<32)
      checks.push({id:x.id,reason:'Нет независимого подтверждённого первоисточника',status:'needs-source'});
    if(evidenceOf(x).length>provenance.length && checks.length<32)
      checks.push({id:x.id,reason:'Несколько цитат могут происходить из одного текста; не считать независимыми',status:'needs-source'});
  }
  const entityNames=new Map();
  for(const entity of (snapshot.entities||[]).slice(-300)){
    for(const alias of [entity.name,...(entity.aliases||[])]){
      if(typeof alias!=='string')continue;
      const key=alias.toLocaleLowerCase('ru').trim();
      if(key.length<3)continue;
      const ids=entityNames.get(key)||new Set();ids.add(entity.id);entityNames.set(key,ids);
    }
  }
  for(const [name,ids] of entityNames)if(ids.size>1&&ambiguities.length<16)
    ambiguities.push({name,ids:[...ids].slice(0,5),reason:'Неоднозначный объект — объединение запрещено'});
  const pool=facts.slice(-260);
  for(let i=0;i<pool.length;i++)for(let j=i+1;j<pool.length;j++){
    const a=pool[i],b=pool[j];
    const lexical=setScore(tokens.get(a.id),tokens.get(b.id));
    const morph=setScore(grams.get(a.id),grams.get(b.id));
    const similarity=lexical*0.75+morph*0.25;
    if(similarity<0.43)continue;
    const yearsA=year(a.text),yearsB=year(b.text);
    const mismatchedYears=yearsA.length&&yearsB.length&&yearsA.some(y=>!yearsB.includes(y));
    const key=pair(a.id,b.id);
    if(mismatchedYears && similarity>0.49 && temporal.length<16)
      temporal.push({ids:[a.id,b.id],years:[...new Set([...yearsA,...yearsB])],
        reason:'Похожие утверждения относятся к разным годам; проверить изменение со временем'});
    if(!mismatchedYears && graph.has(a.id)&&!graph.get(a.id).has(b.id) &&
       similarity>=0.62 && candidateLinks.length<48)
      candidateLinks.push({id:hash(key).slice(0,16),left:compact(a),right:compact(b),
        reason:'Сходство словоформ и контекста; не доказательство',score:+similarity.toFixed(3),status:'candidate'});
    // No automatic contradictions across different years, people or weakly similar subjects.
    if(!mismatchedYears && similarity>=0.6 && conflicts.length<24){
      const negA=/(?:^|\s)(?:нет|не|никогда|без)\s/iu.test(a.text);
      const negB=/(?:^|\s)(?:нет|не|никогда|без)\s/iu.test(b.text);
      if(negA!==negB && setScore(tokens.get(a.id),tokens.get(b.id))>=0.56)
        conflicts.push({id:hash(key).slice(0,16),left:compact(a),right:compact(b),
          reason:'Возможное отрицание того же утверждения; проверить время и контекст',status:'candidate'});
    }
  }
  // Explainable topic suggestions: grouping by explicit category and shared
  // term, with minimum support; no automatic topic/fact creation.
  const proposals=[];
  const categories=[...new Set(current.map(x=>x.category).filter(Boolean))];
  for(const category of categories){
    const subset=current.filter(x=>x.category===category);
    if(subset.length<3)continue;
    const frequency=new Map();
    for(const x of subset)for(const w of tokens.get(x.id)||[])frequency.set(w,(frequency.get(w)||0)+1);
    const tops=[...frequency].filter(([,n])=>n>=3).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,4);
    for(const [term,n] of tops)if(proposals.length<12)
      proposals.push({title:term,category,records:n,status:'candidate',
        reason:'Повторяющаяся тема в подтверждённых записях'});
  }
  const mistakes=(snapshot.mistakes||[]).slice(-50),history=(snapshot.history||[]).slice(-50);
  const feedback={corrected:history.filter(x=>x.reason?.includes('пользовател')).length,
    memoryMistakes:mistakes.filter(x=>x.kind==='memory').length,
    retrievalMisses:Number.isSafeInteger(snapshot.retrievalMisses)?snapshot.retrievalMisses:0};
  const test=evaluation(current,graph,tokens,grams);
  return {
    branches:proposals,paths:paths(graph,current),sourceChecks:checks,ambiguities,
    candidateLinks,conflicts,temporal,feedback,
    evaluation:test,archiveReviewed:archive.length,
    reviewed:facts.length,grounded:current.length
  };
}
