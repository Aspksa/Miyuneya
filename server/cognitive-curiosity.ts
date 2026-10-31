import { createHash } from 'node:crypto';
import type { Memory, MemoryItem, Question } from './memory.ts';
import { expired } from './recall.ts';

export type CognitiveInquiry = {
  key:string; kind:Question['kind']; text:string; refs:string[];
};
// Avoid unprompted requests for credentials, sensitive personal details, or
// unsupported claims. These questions only ask the owner to clarify two
// recorded, attributed facts. They are not independent conclusions.
const sensitive=/(парол|логин|токен|секрет|api.?key|ключ доступа|пин.?код|паспорт|диагноз|болезн|здоров|лекарств|банк|карта|сч[её]т|адрес проживания)/iu;
const eligible=(x:MemoryItem|undefined)=>!!x && x.kind==='fact' && x.status==='active' &&
  !expired(x) && x.category!=='health' && x.category!=='personal' && x.category!=='people' &&
  !sensitive.test(x.text) &&
  (x.source==='user'||x.evidence?.some(e=>e.role==='user'||e.role==='note')===true);
const brief=(text:string)=>text.replace(/\s+/g,' ').trim().slice(0,90);
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');

export function suggestCognitiveInquiries(
  growth:{conflicts?:unknown[];temporal?:unknown[]}|undefined,
  memory:Memory,
  lookup:(id:string)=>MemoryItem|undefined=(id)=>memory.items.find(x=>x.id===id),
):CognitiveInquiry[]{
  if(!growth || !memory.settings.enabled || memory.settings.private)return [];
  const result:CognitiveInquiry[]=[];
  const taken=new Set<string>();
  const candidates=[
    ...(Array.isArray(growth.conflicts)?growth.conflicts.slice(0,12).map(x=>({kind:'conflict' as const,x})):[]),
    ...(Array.isArray(growth.temporal)?growth.temporal.slice(0,12).map(x=>({kind:'gap' as const,x})):[]),
  ];
  for(const {kind,x} of candidates){
    const entry=x as any;
    const refs=kind==='conflict'?[entry?.left?.id,entry?.right?.id]:entry?.ids;
    if(!Array.isArray(refs)||refs.length!==2||refs.some(id=>typeof id!=='string'))continue;
    const unique=[...new Set(refs)].sort();
    if(unique.length!==2)continue;
    const [a,b]=unique.map(lookup);
    if(!eligible(a)||!eligible(b))continue;
    const key=hash(JSON.stringify([kind,unique,
      ...[a,b].map(i=>hash(i!.text+'\n'+i!.seen))]));
    if(taken.has(key))continue;
    taken.add(key);
    const text=kind==='conflict'
      ? `В памяти есть две записи: «${brief(a!.text)}» и «${brief(b!.text)}». Они действительно противоречат друг другу или относятся к разным ситуациям?`
      : `В записях «${brief(a!.text)}» и «${brief(b!.text)}» указаны разные периоды. Оба сведения актуальны для своих дат?`;
    result.push({key,kind,text:text.slice(0,300),refs:unique});
    if(result.length>=4)break;
  }
  return result;
}

/** A user reply is evidence about the user's clarification, not a model-
 * inferred verdict on the two records; do not silently rewrite either. */
export const isUsefulClarification=(text:string)=>{
  const answer=text.replace(/\s+/g,' ').trim();
  return answer.length>=3 && !/^(?:не знаю|не помню|потом|пропустить|не уверен(?:а)?|не могу сказать|без ответа|да|нет)[.!?\s]*$/iu.test(answer);
};
