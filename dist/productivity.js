// Generated from src/productivity.ts by npm run build.

import { localDateKey } from './calendar.js';

export const repeatDate=(value       ,unit                     ,interval       ,anchor        )=>{
  const [y,m,d]=value.split('-').map(Number);const next=unit==='month'?new Date(y,m-1+interval,Math.min(anchor || d,new Date(y,m+interval,0).getDate()),12):new Date(y,m-1,d+interval*(unit==='week'?7:1),12);
  return localDateKey(next);
};
export function editedRepeat(task               ,dueDate       ,unit                        ,interval       )                {
  if(!unit)return undefined;
  const unchanged=(task?.dueDate||'')===dueDate&&task?.repeat?.unit===unit&&task.repeat.interval===interval;
  return {unit,interval,anchorDay:unchanged?task?.repeat?.anchorDay:(dueDate?Number(dueDate.slice(-2)):undefined)};
}
// Merge server normalization while retaining only fields actually edited during the request.
export function mergeCanonicalTasks(sent       ,local       ,canonical       )        {
  const result=structuredClone(local),before=new Map(sent.map(t=>[t.id,t])),current=new Map(result.map(t=>[t.id,t]));
  for(const server of canonical){const base=before.get(server.id),task=current.get(server.id);
    if(!base){if(!task)result.push(structuredClone(server));continue;}
    if(!task)continue; // A local deletion must stay deleted.
    for(const key of new Set([...Object.keys(base),...Object.keys(server)]                  )){
      if(JSON.stringify(task[key])!==JSON.stringify(base[key]))continue;
      if(Object.hasOwn(server,key))Object.assign(task,{[key]:structuredClone(server[key])});else delete task[key];
    }
  }
  return result;
}
export function taskBlockers(tasks       ,task     ){return tasks.filter(t=>(task.dependsOn || []).includes(t.id)&&!t.done || t.parentId===task.id&&!t.done);}
export function validTaskGraph(tasks       ) {
  const map=new Map(tasks.map(t=>[t.id,t]));const visiting=new Set        (),done=new Set        ();
  const visit=(id       ,depth=0)        =>{if(depth>100||visiting.has(id))return false;if(done.has(id))return true;const t=map.get(id);if(!t)return false;visiting.add(id);
    for(const next of [...(t.dependsOn || []),...tasks.filter(c=>c.parentId===id).map(c=>c.id)])if(!visit(next,depth+1))return false;
    visiting.delete(id);done.add(id);return true;};
  return tasks.every(t=>(!t.parentId||map.has(t.parentId)) && (!t.parentId||!t.repeat) && (t.dependsOn || []).every(id=>map.has(id)&&id!==t.id) && visit(t.id));
}
// Completion is validated on the server. Each completed occurrence produces at most one successor.
export function reconcileTasks(previous          ,next          ,newId           ,now=new Date()) {
  const before=new Map(previous.tasks.map(t=>[t.id,t]));
  for(const task of next.tasks)if(!task.done&&before.get(task.id)?.done){let parent=task.parentId;for(let depth=0;parent&&depth<100;depth++){const ancestor=next.tasks.find(t=>t.id===parent);if(!ancestor)break;ancestor.done=false;delete ancestor.completedAt;parent=ancestor.parentId;}}
  for(const task of [...next.tasks]) {
    const prior=before.get(task.id);if(!task.done||prior?.done)continue;
    const blocked=taskBlockers(next.tasks,task);if(blocked.length)throw new Error('Сначала завершите: '+blocked.map(t=>t.title).slice(0,3).join(', '));
    if(!task.repeat || task.parentId || next.tasks.some(t=>t.repeatOf===task.id))continue;
    if(next.tasks.length>=5000)throw new Error('Нет места для следующего повторения: достигнут предел задач.');
    const today=localDateKey(now),anchor=task.repeat.anchorDay || Number((task.dueDate || today).slice(-2));
    let due=task.dueDate || today;
    for(let i=0;i<40000;i++){due=repeatDate(due,task.repeat.unit,task.repeat.interval,anchor);if(due>today)break;}
    if(due<=today||due.length!==10)throw new Error('Не удалось вычислить следующий срок.');
    const stamp=now.toISOString(),id=newId();
    const fresh     ={...task,id,done:false,createdAt:stamp,updatedAt:stamp,dueDate:due,repeat:{...task.repeat,anchorDay:anchor},repeatOf:task.id,seriesId:task.seriesId || task.id};delete fresh.completedAt;
    next.tasks.push(fresh);
    // Recurring parent checklists start fresh, retaining their hierarchy and internal dependencies.
    const descendants       =[];const parents=new Set([task.id]);
    for(let depth=0;depth<100;depth++){const children=next.tasks.filter(t=>t.parentId&&parents.has(t.parentId)&&!descendants.includes(t)&&t.id!==id);if(!children.length)break;descendants.push(...children);children.forEach(t=>parents.add(t.id));}
    if(next.tasks.length+descendants.length>5000)throw new Error('Нет места для подзадач следующего повторения.');
    const ids=new Map([[task.id,id],...descendants.map(t=>[t.id,newId()]                   )]);
    for(const child of descendants){const copy     ={...child,id:ids.get(child.id) ,parentId:ids.get(child.parentId ) ,done:false,createdAt:stamp,updatedAt:stamp,dependsOn:(child.dependsOn || []).map(x=>ids.get(x)||x)};delete copy.completedAt;if(copy.dueDate&&task.dueDate){const parts=(s       )=>s.split('-').map(Number);const [ay,am,ad]=parts(task.dueDate),[by,bm,bd]=parts(due);const days=Math.round((Date.UTC(by,bm-1,bd)-Date.UTC(ay,am-1,ad))/86400000);copy.dueDate=repeatDate(copy.dueDate,'day',days);}next.tasks.push(copy);}
  }
}

export function matchesTask(task     ,filter           ,group='',now=new Date()) {
  const today=localDateKey(now),week=localDateKey(new Date(now.getFullYear(),now.getMonth(),now.getDate()+7));
  return (!group||task.group===group) && (filter==='done'?task.done:filter==='today'?!task.done&&task.dueDate===today:filter==='overdue'?!task.done&&!!task.dueDate&&task.dueDate<today:filter==='week'?!task.done&&!!task.dueDate&&task.dueDate>=today&&task.dueDate<=week:filter==='active'?!task.done:true);
}
