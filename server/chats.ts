import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite } from '../scripts/runtime.mjs';

// Versioned local chat archive. Neither cloud credentials nor browser-origin
// identifiers are included; errors never overwrite damaged user data.
type Message = { role: 'user' | 'assistant'; content: string };
type Dialog = { id: string; title: string; createdAt: string; updatedAt: string; messages: Message[] };
type Archive = { version: 1; revision: number; activeId: string | null; dialogs: Dialog[] };
const empty = (): Archive => ({version:1, revision:0, activeId:null, dialogs:[]});
const validId = (v: unknown): v is string => typeof v==='string' && /^[a-z0-9-]{8,64}$/i.test(v);
const validDate = (v: unknown): v is string => typeof v==='string' && Number.isFinite(Date.parse(v));
const validMessage = (m: any): m is Message => m && (m.role==='user'||m.role==='assistant') && typeof m.content==='string' && m.content.length<=20000;
export function validArchive(v: any): v is Archive {
  if(!v || v.version!==1 || !Number.isSafeInteger(v.revision) || v.revision<0 || !Array.isArray(v.dialogs) || v.dialogs.length>60) return false;
  const ids=new Set<string>();
  let size=0;
  for(const d of v.dialogs){
    if(!validId(d?.id) || ids.has(d.id) || typeof d.title!=='string' || !d.title.trim() || d.title.length>120 || !validDate(d.createdAt) || !validDate(d.updatedAt) || !Array.isArray(d.messages) || d.messages.length>400 || !d.messages.every(validMessage))return false;
    ids.add(d.id);
    size+=d.title.length+d.messages.reduce((n:number,m:Message)=>n+m.content.length,0);
    if(size>800000)return false;
  }
  return (v.activeId===null && v.dialogs.length===0) || (validId(v.activeId) && ids.has(v.activeId));
}
export async function openChats(dataDir: string) {
  const dir=join(dataDir,'chats'), file=join(dir,'index.json');
  let state=empty(); let queue=Promise.resolve();
  try {
    const saved=JSON.parse(await readFile(file,'utf8'));
    if(!validArchive(saved))throw new Error('Неверная структура архива');
    state=saved;
  }catch(e) {
    if((e as NodeJS.ErrnoException).code!=='ENOENT')throw new Error('Архив чатов повреждён. Сохраните data/chats/index.json и восстановите его из копии.',{cause:e});
  }
  const snapshot=():Archive=>structuredClone(state);
  const replace=(incoming: any):Promise<Archive>=>{
    const job=queue.then(async()=>{
      if(!validArchive(incoming))throw Object.assign(new Error('Недопустимый архив чатов.'),{status:400});
      if(incoming.revision!==state.revision)throw Object.assign(new Error('История изменена в другой вкладке. Обновите страницу.'),{status:409});
      const next:Archive={...structuredClone(incoming),revision:state.revision+1};
      await mkdir(dir,{recursive:true});
      await atomicWrite(file,JSON.stringify(next));
      state=next;
      return snapshot();
    });
    queue=job.then(()=>{},()=>{});
    return job;
  };
  return {snapshot,replace,shutdown:async()=>{await queue;}};
}
