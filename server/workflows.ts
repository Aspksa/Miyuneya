import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite } from '../scripts/runtime.mjs';
export type Rule={id:string;name:string;enabled:boolean;extension:string;contains:string;sourceFolder?:string|null;targetFolder?:string|null;noteTitle:string;noteBody:string;tasks:string[];group:string};
type Job={id:string;file:string;name:string;rule:Rule;status:'pending'|'done'|'failed'|'cancelled';error?:string;at:string};
type State={version:1;revision:number;rules:Rule[];jobs:Job[]};
type Options={file(id:string):{name:string;folder:string|null}|undefined;folders():{id:string}[];text(id:string):Promise<string>;route(id:string,folder:string|null):Promise<void>;apply(id:string,note:{title:string;body:string}|null,tasks:string[],group:string,file:string):Promise<void>};
const text=(v:unknown,max:number)=>typeof v==='string'&&v.length<=max;
function validRule(r:any):r is Rule{return !!r&&text(r.id,100)&&/^[\w-]+$/.test(r.id)&&text(r.name,80)&&!!r.name.trim()&&typeof r.enabled==='boolean'&&text(r.extension,20)&&(r.extension===''||/^\.?[a-zA-Z0-9]+$/.test(r.extension))&&text(r.contains,80)&&text(r.noteTitle,200)&&text(r.noteBody,2000)&&Array.isArray(r.tasks)&&r.tasks.length<=20&&r.tasks.every(t=>text(t,200)&&!!t.trim())&&text(r.group,80)&&(r.sourceFolder===undefined||r.sourceFolder===null||text(r.sourceFolder,100))&&(r.targetFolder===undefined||r.targetFolder===null||text(r.targetFolder,100));}
export async function openWorkflows(dataDir:string,options:Options){
  const path=join(dataDir,'workflows.json');let state:State={version:1,revision:0,rules:[],jobs:[]};
  try{const raw=JSON.parse(await readFile(path,'utf8'));if(raw.version!==1||(!Number.isSafeInteger(raw.revision)||raw.revision<0)||!Array.isArray(raw.rules)||raw.rules.length>30||!raw.rules.every(validRule)||new Set(raw.rules.map(r=>r.id)).size!==raw.rules.length||!Array.isArray(raw.jobs)||raw.jobs.length>1000||new Set(raw.jobs.map(j=>j?.id)).size!==raw.jobs.length||!raw.jobs.every(j=>j&&text(j.id,200)&&text(j.file,100)&&text(j.name,180)&&validRule(j.rule)&&['pending','done','failed','cancelled'].includes(j.status)&&text(j.at,50)&&(j.error===undefined||text(j.error,300))))throw new Error('format');state=raw;}
  catch(e){if(e.code!=='ENOENT')throw new Error('Не удалось прочитать data/workflows.json. Файл сохранён; восстановите его из копии.');}
  let queue=Promise.resolve();const enqueue=<T>(fn:()=>Promise<T>)=>{const p=queue.then(fn);queue=p.then(()=>{},()=>{});return p;};
  const commit=async(next:State)=>{await atomicWrite(path,JSON.stringify(next,null,2));state=next;};
  const view=()=>structuredClone(state);
  async function process(job:Job){
    if(!state.rules.some(r=>r.id===job.rule.id&&r.enabled)){await update(job.id,{status:'cancelled',error:'Правило выключено или удалено.'});return;}
    try{
      const file=options.file(job.file);if(!file)throw new Error('Оригинал документа недоступен.');
      const rule=job.rule;
      if(rule.targetFolder!==undefined)await options.route(job.file,rule.targetFolder);
      const needsText=!!rule.noteTitle&&(rule.noteBody.includes('{text}')||rule.noteTitle.includes('{text}'))||rule.tasks.some(t=>t.includes('{text}'));const body=needsText?await options.text(job.file):'';
      const replace=(v:string)=>v.replace(/\{(name|text|date)\}/g,(_,key)=>key==='name'?file.name:key==='text'?body:new Date(job.at).toLocaleDateString('ru-RU'));
      const note=rule.noteTitle?{title:replace(rule.noteTitle).slice(0,200),body:replace(rule.noteBody)}:null;
      if(note&&note.body.length>100000)throw new Error('Текст заметки превышает 100 000 символов.');
      await options.apply(job.id,note,rule.tasks.map(replace).map(t=>t.slice(0,200)),rule.group,job.file);
      await update(job.id,{status:'done',error:undefined});
    }catch(e){await update(job.id,{status:'failed',error:String(e.message).slice(0,300)});}
  }
  async function update(id:string,change:Partial<Job>){const next=structuredClone(state);Object.assign(next.jobs.find(j=>j.id===id)!,change);next.revision++;await commit(next);}
  return {
    view,
    async configure(revision:number,rules:Rule[]){return enqueue(async()=>{if(revision!==state.revision)throw new Error('Правила изменились: обновите список.');if(!Array.isArray(rules)||rules.length>30||!rules.every(validRule)||new Set(rules.map(r=>r.id)).size!==rules.length)throw new Error('Неверные правила автоматизации.');
      for(const r of rules)if(r.enabled&&r.targetFolder===undefined&&!r.noteTitle&&!r.tasks.length)throw new Error('У включённого правила должно быть действие.');
      for(const rule of rules)for(const folder of [rule.sourceFolder,rule.targetFolder])if(folder&&!options.folders().some(f=>f.id===folder))throw new Error('Папка правила не найдена.');
      await commit({...state,revision:state.revision+1,rules:structuredClone(rules)});return view();});},
    async uploaded(file:{id:string;name:string;folder:string|null}){return enqueue(async()=>{
      const rules=state.rules.filter(r=>r.enabled&&(!r.extension||file.name.toLowerCase().endsWith('.'+r.extension.replace(/^\./,'').toLowerCase()))&&file.name.toLocaleLowerCase('ru').includes(r.contains.toLocaleLowerCase('ru'))&&(r.sourceFolder===undefined||r.sourceFolder===file.folder));
      const added=rules.filter(rule=>!state.jobs.some(j=>j.id===rule.id+'-'+file.id)).map(rule=>({id:rule.id+'-'+file.id,file:file.id,name:file.name,rule:structuredClone(rule),status:'pending' as const,at:new Date().toISOString()}));
      if(!added.length)return;
      if(state.jobs.filter(j=>j.status==='pending'||j.status==='failed').length+added.length>500)throw new Error('Очередь автоматизации заполнена.');
      const jobs=[...state.jobs,...added];
      while(jobs.length>1000){const at=jobs.findIndex(j=>j.status==='done'||j.status==='cancelled');if(at<0)throw new Error('Очередь заполнена.');jobs.splice(at,1);}
      // Every matching rule must survive interruption, including rules not started yet.
      await commit({...state,revision:state.revision+1,jobs});
      for(const job of added)await process(job);
    });},
    async retry(id:string){return enqueue(async()=>{const job=state.jobs.find(j=>j.id===id);if(!job||job.status!=='failed')throw new Error('Задание не требует повтора.');await update(id,{status:'pending',error:undefined});await process(state.jobs.find(j=>j.id===id)!);return view();});},
    async resume(){return enqueue(async()=>{for(const job of [...state.jobs].filter(j=>j.status==='pending'))await process(job);});},
    async shutdown(){await queue;}
  };
}
