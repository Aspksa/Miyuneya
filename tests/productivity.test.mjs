import { setTimeout as pause } from 'node:timers/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, own } from './helpers/lifecycle.mjs';
import { emptyWorkspace, validateWorkspace } from '../src/model.ts';
import { reconcileTasks,repeatDate,matchesTask,taskBlockers } from '../src/productivity.ts';
import { createApp } from '../server/app.ts';
const at='2026-10-30T00:00:00.000Z';
const task=(id,fields={})=>({id,title:'Задача '+id,done:false,createdAt:at,...fields});
async function app(t){const root=await fixture(t);let server;
  async function start(){server=await createApp(root,'productivity');server.listen(0,'127.0.0.1');await once(server,'listening');}
  await start();own(root,()=>server.shutdown());
  const request=async(path,method='GET',body)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}`+path,{method,...(body!==undefined?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});return{status:response.status,data:await response.json()};};
  return{root,request,async restart(){await server.shutdown();await start();},async upload(name,body='Текст протокола'){const response=await fetch(`http://127.0.0.1:${server.address().port}/api/disk/files?name=`+encodeURIComponent(name),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body});return{status:response.status,data:await response.json()};}};
}

test('Task graph validates parent/dependency cycles, groups, repeats and linked materials without breaking old data',()=>{
  const data=emptyWorkspace();data.tasks=[task('a'),task('b',{parentId:'a',group:'Работа',dependsOn:[],attachments:[{kind:'file',id:'file'},{kind:'note',id:'note'}]})];
  assert.equal(validateWorkspace(data),true);
  data.tasks[1].dependsOn=['a'];assert.equal(validateWorkspace(data),false,'child after its parent would deadlock');
  data.tasks[1].dependsOn=['missing'];assert.equal(validateWorkspace(data),false);
  data.tasks[1].dependsOn=[];data.tasks[0].parentId='b';assert.equal(validateWorkspace(data),false);
  delete data.tasks[0].parentId;data.tasks[1].repeat={unit:'day',interval:1};assert.equal(validateWorkspace(data),false,'repeating root copies its children');
  delete data.tasks[1].repeat;data.tasks[0].repeat={unit:'month',interval:0};assert.equal(validateWorkspace(data),false);
  data.tasks[0].repeat.interval=1;assert.equal(validateWorkspace(data),true);
});

test('Recurrence has one successor, preserves month anchors and recreates a checked hierarchy with shifted dates',()=>{
  const previous=emptyWorkspace();previous.tasks=[task('a',{dueDate:'2026-01-31',repeat:{unit:'month',interval:1},group:'Работа'}),task('b',{parentId:'a',done:true,dueDate:'2026-01-30'}),task('c',{parentId:'a',dependsOn:['b'],done:true})];
  const next=structuredClone(previous);next.tasks[0].done=true;let n=0;reconcileTasks(previous,next,()=>`new${n++}`,new Date(2026,0,31,12));
  const fresh=next.tasks.find(t=>t.repeatOf==='a');assert.equal(fresh.dueDate,'2026-02-28');assert.equal(fresh.group,'Работа');
  const children=next.tasks.filter(t=>t.parentId===fresh.id);assert.equal(children.length,2);assert.ok(children.every(t=>!t.done));assert.equal(children[0].dueDate,'2026-02-27');assert.deepEqual(children[1].dependsOn,[children[0].id]);
  reconcileTasks(previous,next,()=>`extra${n++}`,new Date(2026,0,31));assert.equal(next.tasks.filter(t=>t.repeatOf==='a').length,1);
  assert.equal(repeatDate('2026-02-28','month',1,31),'2026-03-31');assert.equal(validateWorkspace(next),true);
});

test('Completion blocks unfinished prerequisites; reopening a child reopens its ancestors',()=>{
  const before=emptyWorkspace();before.tasks=[task('a'),task('b',{parentId:'a'}),task('c',{dependsOn:['a']})];
  assert.deepEqual(taskBlockers(before.tasks,before.tasks[0]).map(t=>t.id),['b']);
  const next=structuredClone(before);next.tasks[0].done=true;assert.throws(()=>reconcileTasks(before,next,()=>''),/Сначала/);
  before.tasks[0].done=true;before.tasks[1].done=true;const reopened=structuredClone(before);reopened.tasks[1].done=false;reconcileTasks(before,reopened,()=>'',new Date());assert.equal(reopened.tasks[0].done,false);
});

test('Saved task conditions use local calendar dates and groups in both time zones',()=>{
  const now=new Date(2026,9,30,1);assert.equal(matchesTask(task('a',{dueDate:'2026-10-30',group:'Работа'}),'today','Работа',now),true);
  assert.equal(matchesTask(task('a',{dueDate:'2026-10-29'}),'overdue','',now),true);assert.equal(matchesTask(task('a',{dueDate:'2026-11-20'}),'week','',now),false);
  assert.equal(matchesTask(task('a',{done:true,dueDate:'2026-10-29'}),'overdue','',now),false);
});

test('HTTP task completion returns the canonical successor and revision conflicts never create duplicates',async t=>{
  const a=await app(t);let state=(await a.request('/api/workspace')).data;
  state.data.tasks=[task('repeat',{dueDate:'2026-01-31',repeat:{unit:'month',interval:1}})];state=(await a.request('/api/workspace','PUT',state)).data;
  const old=structuredClone(state);state.data.tasks[0].done=true;const response=await a.request('/api/workspace','PUT',state);assert.equal(response.status,200);assert.equal(response.data.data.tasks.length,2);
  assert.equal((await a.request('/api/workspace','PUT',old)).status,409);await a.restart();const saved=(await a.request('/api/workspace')).data;assert.equal(saved.data.tasks.length,2);
});

test('Nested folders enforce sibling names, reject cycles and protect descendants; bulk changes undo atomically',async t=>{
  const a=await app(t);let state=(await a.request('/api/disk')).data;
  const mutate=async(path,data,method='PATCH')=>{const r=await a.request('/api/disk'+path,method,{revision:state.revision,...data});if(r.status<300)state=r.data;return r;};
  await mutate('/folders',{name:'Работа'},'POST');const parent=state.folders[0].id;
  await mutate('/folders',{name:'Протоколы',parent},'POST');const child=state.folders[1].id;
  await mutate('/folders',{name:'Протоколы'},'POST');assert.equal(state.folders.length,3,'same name is valid in different parents');
  assert.equal((await mutate('/folders/'+parent,{parent:child})).status,400);
  assert.equal((await mutate('/folders/'+parent,{},'DELETE')).status,409);
  state=(await a.upload('первый.txt')).data;state=(await a.upload('второй.txt')).data;const ids=state.files.map(f=>f.id);
  await mutate('/files/batch',{ids,folder:child,starred:true});assert.ok(state.files.every(f=>f.folder===child&&f.starred));assert.equal(state.canUndo,true);
  await mutate('/undo',{},'POST');assert.ok(state.files.every(f=>f.folder===null&&!f.starred));assert.equal(state.canUndo,false);
  assert.equal((await mutate('/files/batch',{ids:[ids[0],'00000000-0000-0000-0000-000000000000'],trashed:true})).status,404);
  assert.ok(state.files.every(f=>!f.trashedAt),'a partially invalid batch changes nothing');
  await mutate('/files/batch',{ids,trashed:true});await mutate('/files/batch',{ids,trashed:false});await a.restart();state=(await a.request('/api/disk')).data;assert.ok(state.files.every(f=>!f.trashedAt));assert.equal(state.folders.find(f=>f.id===child).parent,parent);
});

test('Workflow routes a new file and creates template notes/tasks once, including recovery after interrupted acknowledgement',async t=>{
  const a=await app(t);let disk=(await a.request('/api/disk')).data;disk=(await a.request('/api/disk/folders','POST',{revision:disk.revision,name:'Протоколы'})).data;
  let workflows=(await a.request('/api/workflows')).data;
  const rule={id:'protocol',name:'Протокол → материалы',enabled:true,extension:'txt',contains:'протокол',targetFolder:disk.folders[0].id,noteTitle:'Встреча: {name}',noteBody:'Источник: {name}\n{text}',tasks:['Проверить {name}','Согласовать документы'],group:'Работа'};
  workflows=(await a.request('/api/workflows','PUT',{revision:workflows.revision,rules:[rule]})).data;
  const upload=await a.upload('Протокол встречи.txt','Решено подготовить комплект документов.');assert.equal(upload.status,201);assert.equal(upload.data.files[0].folder,rule.targetFolder);
  let workspace=(await a.request('/api/workspace')).data;assert.equal(workspace.data.notes.length,1);assert.match(workspace.data.notes[0].body,/Решено подготовить/);assert.equal(workspace.data.tasks.length,2);assert.equal(workspace.data.tasks[0].attachments[0].id,upload.data.files[0].id);
  workflows=(await a.request('/api/workflows')).data;assert.equal(workflows.jobs[0].status,'done');
  // Simulate a crash after workspace commit and before the journal acknowledges success.
  await a.restart();const path=join(a.root,'data','workflows.json');const raw=JSON.parse(await readFile(path,'utf8'));raw.jobs[0].status='pending';await writeFile(path,JSON.stringify(raw));await a.restart();
  workspace=(await a.request('/api/workspace')).data;assert.equal(workspace.data.notes.length,1);assert.equal(workspace.data.tasks.length,2);let recovered;const deadline=Date.now()+5000;do{recovered=(await a.request('/api/workflows')).data.jobs[0].status;if(recovered==='done')break;await pause(15);}while(Date.now()<deadline);assert.equal(recovered,'done','wait for the actual durable acknowledgement');
});

test('Workflow failure keeps the original upload, records the cause and supports an explicit retry',async t=>{
  const a=await app(t);let rules=(await a.request('/api/workflows')).data;
  const rule={id:'text-only',name:'Из текста',enabled:true,extension:'bin',contains:'',noteTitle:'{name}',noteBody:'{text}',tasks:[],group:''};
  assert.equal((await a.request('/api/workflows','PUT',{revision:rules.revision,rules:[rule]})).status,200);
  const upload=await a.upload('unsupported.bin','Оригинал');assert.equal(upload.status,201);assert.match(upload.data.warning,/сохранён/);
  rules=(await a.request('/api/workflows')).data;assert.equal(rules.jobs[0].status,'failed');assert.match(rules.jobs[0].error,/UTF-8/);assert.equal((await a.request('/api/workspace')).data.data.notes.length,0);
  const retry=await a.request('/api/workflows','POST',{id:rules.jobs[0].id});assert.equal(retry.data.jobs[0].status,'failed');assert.equal((await a.request('/api/disk')).data.files.length,1);
  assert.equal((await a.request('/api/workflows','PUT',{revision:0,rules:[]})).status,409);
});

test('Disabled rules do not process files and a corrupt workflow file cannot block notes or originals',async t=>{
  const a=await app(t);let state=(await a.request('/api/workflows')).data;const rule={id:'disabled',name:'Отключено',enabled:false,extension:'txt',contains:'',noteTitle:'{name}',noteBody:'{text}',tasks:[],group:''};
  await a.request('/api/workflows','PUT',{revision:state.revision,rules:[rule]});await a.upload('plain.txt');assert.equal((await a.request('/api/workspace')).data.data.notes.length,0);
  await writeFile(join(a.root,'data','workflows.json'),'broken');await a.restart();assert.equal((await a.request('/api/workflows')).status,503);assert.equal((await a.request('/api/workspace')).status,200);
  const upload=await a.upload('preserved.txt');assert.equal(upload.status,201);assert.match(upload.data.warning,/сохранён/);assert.equal(await readFile(join(a.root,'data','workflows.json'),'utf8'),'broken');
});
