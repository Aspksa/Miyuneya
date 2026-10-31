import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { removeTemp } from './helpers/lifecycle.mjs';
import { createApp } from '../server/app.ts';
import { emptyWorkspace } from '../src/model.ts';
import { emptyMemory, upsert, applyThinking, thinkInput, normalizeMemory, openMemory, INTENSITY } from '../server/memory.ts';
import { memoryContext } from '../server/recall.ts';

const now=Date.parse('2026-10-29T15:00:00.000Z');const at=new Date(now).toISOString();

test('Thinking keeps new thoughts, questions, contradictions and skills', () => {
  const memory=emptyMemory();
  const morning=upsert(memory,'fact','Работает по утрам',{now:at}).item;const evening=upsert(memory,'fact','Работает по вечерам',{now:at}).item;
  memory.understanding={text:'Ценит тишину.',updated:at};
  const added=applyThinking(memory,{thoughts:[
    {kind:'hypothesis',text:'Кажется, по вечерам ему легче думать о планах.',links:[morning.id,'чужой']},
    {kind:'magic',text:'Стоит предложить вечерний обзор задач.'},
    {kind:'idea',text:'Кажется, по вечерам ему легче думать о планах!'},{text:''}],
    questions:['Как вы любите отдыхать?'],conflicts:[{ids:[morning.id,evening.id],question:'Так утром или вечером?'}],
    skills:[{text:'Предлагать вечерний обзор задач коротким списком'}],summary:'Думала о его ритме'},now);
  assert.deepEqual(added.map(t=>t.kind),['hypothesis','reflection']);
  assert.deepEqual(added[0].links,[morning.id]);assert.equal(added[0].seen,false);
  assert.deepEqual(memory.questions.map(q=>q.kind),['gap','conflict']);
  assert.equal(memory.items.find(i=>i.kind==='rule').source,'thought');
  assert.equal(memory.thinks.length,1);
  assert.match(memory.journal.at(-1).text,/Размышляла: Думала о его ритме/);
  // A repeated thought is not kept twice, and the past thoughts go into the next cycle.
  assert.equal(applyThinking(memory,{thoughts:[{kind:'idea',text:'Кажется, по вечерам ему легче думать о планах.'}]},now+1000).length,0);
  const input=thinkInput(memory,null,now);
  assert.match(input,/Общее понимание пользователя:\nЦенит тишину\./);
  assert.match(input,/Твои прошлые размышления \(не повторяй их\):\n- Кажется, по вечерам/);
  assert.equal(applyThinking(memory,null,now).length,0);assert.equal(memory.thinks.length,3,'a failed or empty cycle still counts');
  const restored=normalizeMemory(JSON.parse(JSON.stringify(memory)));
  assert.deepEqual([restored.thoughts.length,restored.thinks.length,restored.settings.thinking,restored.settings.intensity],[2,3,true,'normal']);
  assert.equal(restored.items.find(i=>i.kind==='rule').source,'thought','a skill keeps its origin after a restart');
  assert.equal(normalizeMemory({version:1,settings:{thinking:false,intensity:'turbo'}}).settings.intensity,'normal');
  assert.deepEqual(Object.values(INTENSITY).map(i=>i.perDay),[2,4,8]);
  // Unseen thoughts reach the next answer so she can share one.
  assert.match(memoryContext(memory,'Привет',new Map(),now,{thoughts:[added[0].text]}),/Пока пользователя не было, ты размышляла[^\n]*\n- Кажется, по вечерам/);
});

test('Memory over HTTP thinks while the user is away, within the daily limit', async t => {
  const root=await mkdtemp(join(tmpdir(),'Miyuneya мысли '));
  const seen=[];let n=0;
  const fake=createServer(async(req,res)=>{
    let body='';for await(const c of req)body+=c;
    const json=JSON.parse(body||'{}');seen.push(json);
    const system=json.messages?.[0]?.content||'';
    if(system.includes('спокойная минута')){n++;res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify({thoughts:[{kind:'idea',text:`Мысль номер ${n}: ${['предложить план недели','спросить про отпуск','собрать список книг'][n-1]||'ещё'}`}],summary:'думала'})}}]}));}
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.end(`data: ${JSON.stringify({choices:[{delta:{content:'Хорошо.'}}]})}\n\ndata: [DONE]\n\n`);
  });
  fake.listen(0,'127.0.0.1');await once(fake,'listening');
  let server;
  t.after(async()=>{await server?.shutdown();fake.close();await removeTemp(root);});
  const memory=emptyMemory();memory.settings.intensity='low';
  for(const text of ['Любит чай','Работает дизайнером','Живёт во Владивостоке']) upsert(memory,'fact',text);
  await mkdir(join(root,'data'));
  await writeFile(join(root,'data','workspace.json'),JSON.stringify({revision:0,data:emptyWorkspace()}));
  await writeFile(join(root,'data','memory.json'),JSON.stringify(memory));
  await writeFile(join(root,'data','assistant.json'),JSON.stringify({apiKey:'good-key-123',model:'zeta/model',embedModel:''}));
  server=await createApp(root,'test',false,{cloudUrl:`http://127.0.0.1:${fake.address().port}/v1`,memoryTickMs:20,memoryThinkIdleMs:50});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${server.address().port}`;
  const call=(path,method,body)=>fetch(url+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const memoryView=async()=>(await fetch(url+'/api/memory')).json();
  let view;
  for(let i=0;i<100;i++){view=await memoryView();if(view.thoughts.length)break;await new Promise(r=>setTimeout(r,20));}
  assert.equal(view.thoughts.length,1);assert.equal(view.thoughts[0].seen,false);
  assert.deepEqual([view.thinking.today,view.thinking.perDay,view.thinking.intensity],[1,2,'low']);
  // The pause between thoughts holds: no second automatic cycle right away.
  await new Promise(r=>setTimeout(r,200));
  assert.equal((await memoryView()).thoughts.length,1);
  view=await (await call('/api/memory/think','POST')).json();assert.equal(view.thoughts.length,2);
  const over=await call('/api/memory/think','POST');assert.equal(over.status,429);assert.match((await over.json()).error,/лимит/);
  assert.equal(n,2);

  assert.equal((await call('/api/memory','PUT',{intensity:'turbo'})).status,400);
  view=await (await call('/api/memory','PUT',{intensity:'high',thinking:false})).json();
  assert.deepEqual([view.thinking.enabled,view.thinking.intensity,view.thinking.perDay],[false,'high',8]);

  // The next answer may share what she thought about, and then the thoughts are no longer new.
  await call('/api/assistant/chat','POST',{messages:[{role:'user',content:'Привет!'}],dialog:'dialog-0001'}).then(r=>r.text());
  assert.match(seen.at(-1).messages[0].content,/Пока пользователя не было, ты размышляла[\s\S]*Мысль номер 2/);
  view=await memoryView();assert.ok(view.thoughts.every(t=>t.seen));
  view=await (await call('/api/memory/items/'+view.thoughts[0].id,'DELETE')).json();assert.equal(view.thoughts.length,1);
  view=await (await call('/api/memory/thoughts/seen','POST')).json();assert.equal(view.thoughts.length,1);
});

test('Thinking waits after a start, keeps the limit for queued requests and respects the settings', async t => {
  const root=await mkdtemp(join(tmpdir(),'Miyuneya очередь '));
  let store;
  t.after(async()=>{await store?.shutdown();await removeTemp(root);});
  const memory=emptyMemory();memory.settings.intensity='low';
  for(const text of ['Любит чай','Работает дизайнером','Живёт во Владивостоке']) upsert(memory,'fact',text);
  await writeFile(join(root,'memory.json'),JSON.stringify(memory));
  let calls=0;
  store=await openMemory(root,{available:()=>true,workspace:()=>null,tickMs:3_600_000,thinkIdleMs:60_000,
    ask:async()=>{calls++;await new Promise(r=>setTimeout(r,20));return JSON.stringify({thoughts:[{kind:'idea',text:`Мысль ${calls}: ${['план недели','отпуск','книги'][calls-1]}`}]});}});
  // Opening the app means the user is here, so the first tick does not start thinking.
  await store.tick();assert.equal(calls,0);
  await store.tick(Date.now()+61_000);assert.equal(calls,1);
  // Two requests queued together get one remaining slot between them.
  const results=await Promise.allSettled([store.thinkNow(),store.thinkNow()]);
  assert.deepEqual(results.map(r=>r.status),['fulfilled','rejected']);
  assert.equal(results[1].reason.status,429);assert.equal(calls,2);
  await store.settings({intensity:'high',private:true});
  await assert.rejects(store.thinkNow(),e=>e.status===409);
  await store.settings({private:false,thinking:false});
  await assert.rejects(store.thinkNow(),e=>e.status===409);
  assert.equal(calls,2);
});
