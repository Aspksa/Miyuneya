import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { removeTemp } from './helpers/lifecycle.mjs';
import { createApp } from '../server/app.ts';
import { emptyWorkspace } from '../src/model.ts';
import { emptyMemory, normalizeMemory, similarity, upsert, strength, decay, parseCommand, commandKind, forget, memoryContext, parseJson, applyReflection, applySleep, unseen, fingerprint } from '../server/memory.ts';

const DAY=86_400_000;
const at=iso=>new Date(iso).getTime();

test('Facts are deduplicated, reinforced and fade with time unless pinned', () => {
  const memory=emptyMemory();
  assert.ok(similarity('Любит минимализм в интерфейсе','любит минимализм интерфейса')>=0.6);
  assert.ok(similarity('Работает по утрам','Любит кошек')<0.2);
  const first=upsert(memory,'fact','Любит минимализм в интерфейсе',{now:'2026-01-01T00:00:00Z'});
  assert.equal(first.created,true);
  const again=upsert(memory,'fact','любит минимализм интерфейса',{now:'2026-01-02T00:00:00Z'});
  assert.equal(again.created,false);assert.equal(memory.items.length,1);assert.equal(memory.items[0].hits,2);assert.ok(memory.items[0].weight>0.5);
  upsert(memory,'fact','Любит кошек',{now:'2026-01-01T00:00:00Z'});
  upsert(memory,'rule','Отвечать по-русски',{pinned:true,now:'2026-01-01T00:00:00Z'});
  const cats=memory.items.find(i=>i.text==='Любит кошек');
  assert.ok(strength(cats,at('2026-01-31T00:00:00Z'))<strength(cats,at('2026-01-02T00:00:00Z')));
  assert.ok(Math.abs(strength(cats,at('2026-01-31T00:00:00Z'))-0.25)<0.01);
  // Two confirmations double the half-life.
  assert.ok(strength(memory.items[0],at('2026-02-01T00:00:00Z'))>strength(cats,at('2026-02-01T00:00:00Z')));
  decay(memory,at('2026-06-01T00:00:00Z'));
  assert.deepEqual(memory.items.map(i=>i.text),['Отвечать по-русски']);
  assert.match(memory.journal.at(-1).text,/Забыла/);
});

test('Chat commands remember and forget', () => {
  assert.deepEqual(parseCommand('Запомни, что я работаю по утрам.'),{kind:'remember',text:'я работаю по утрам'});
  assert.deepEqual(parseCommand('Миюнэя, забудь про кофе'),{kind:'forget',text:'кофе'});
  assert.deepEqual(parseCommand('запомни: отвечай коротко'),{kind:'remember',text:'отвечай коротко'});
  assert.equal(parseCommand('Что ты запомнила?'),null);
  assert.equal(commandKind('отвечай коротко'),'rule');assert.equal(commandKind('я работаю по утрам'),'fact');
  const memory=emptyMemory();
  upsert(memory,'fact','Пьёт кофе без сахара');upsert(memory,'fact','Работает по утрам');
  assert.deepEqual(forget(memory,'кофе'),['Пьёт кофе без сахара']);
  assert.deepEqual(memory.items.map(i=>i.text),['Работает по утрам']);
  assert.deepEqual(forget(memory,'дельфины'),[]);
});

test('Recall picks rules always, facts and episodes by topic, and follows links', () => {
  const memory=emptyMemory();
  const now='2026-10-29T10:00:00Z';
  upsert(memory,'rule','Задачи формулировать коротко',{now});
  const calendar=upsert(memory,'fact','Планирует вести календарь со сроками',{now,links:['n1']}).item;
  upsert(memory,'fact','Любит зелёный чай',{now});
  memory.episodes.push({id:'e1',date:now,topic:'Обсуждали календарь',outcome:'Решили добавить сроки',links:[calendar.id],consolidated:false});
  const titles=new Map([['n1',{kind:'note',title:'План календаря'}]]);
  const context=memoryContext(memory,'Что там с календарём?',titles,at(now));
  assert.match(context,/Задачи формулировать коротко/);
  assert.match(context,/календарь со сроками \(связано: заметка «План календаря»\)/);
  assert.match(context,/Обсуждали календарь — Решили добавить сроки/);
  assert.ok(context.indexOf('календарь со сроками')<context.indexOf('зелёный чай'));
  memory.settings.enabled=false;
  assert.equal(memoryContext(memory,'календарь',titles),'');
  assert.equal(memoryContext(emptyMemory(),'что угодно'),'');
});

test('Reflection records an episode and turns corrections into rules', () => {
  const memory=emptyMemory();
  const wrong=upsert(memory,'fact','Живёт в Москве').item;
  const dialog={id:'dialog-0001',messages:[],summary:'',updatedAt:'2026-10-29T10:00:00Z',failures:0};
  const result=parseJson('```json\n'+JSON.stringify({
    episode:{topic:'Календарь и сроки',outcome:'Решили добавить сроки',links:['n1','missing']},
    facts:[{text:'Живёт во Владивостоке',conflicts:wrong.id}],
    rules:[{text:'Задачи формулировать коротко'}],
    weaken:['unknown'],
  })+'\n```');
  assert.ok(applyReflection(memory,result,dialog,new Set(['n1']))>=3);
  assert.equal(memory.episodes.length,1);assert.deepEqual(memory.episodes[0].links,['n1']);
  assert.ok(memory.items.find(i=>i.id===wrong.id).weight<0.3);
  const fact=memory.items.find(i=>i.text==='Живёт во Владивостоке');
  assert.deepEqual(fact.links,[memory.episodes[0].id]);
  assert.equal(memory.items.find(i=>i.kind==='rule').text,'Задачи формулировать коротко');
  assert.equal(applyReflection(memory,null,dialog,new Set()),0);
  assert.equal(parseJson('без json'),null);
});

test('Sleep merges duplicates, keeps pinned records and turns repeated episodes into rules', () => {
  const memory=emptyMemory();
  const now='2026-10-29T03:00:00.000Z';
  const a=upsert(memory,'fact','Любит короткие ответы',{now}).item;
  const b=upsert(memory,'fact','Предпочитает лаконичность',{now}).item;
  const pinned=upsert(memory,'fact','Зовут Аспкса',{now,pinned:true}).item;
  const stale=upsert(memory,'fact','Ищет новый ноутбук',{now}).item;
  const linker=upsert(memory,'fact','Пишет заметки вечером',{now,links:[a.id]}).item;
  for(const n of [1,2,3]) memory.episodes.push({id:'e'+n,date:now,topic:'Просили короткие задачи',outcome:'',links:[],consolidated:false});
  applySleep(memory,{
    merge:[{ids:[a.id,b.id],text:'Любит короткие, лаконичные ответы'}],
    remove:[{id:pinned.id,reason:'устарело'},{id:stale.id,reason:'устарело'}],
    update:[{id:pinned.id,text:'Другое имя'}],
    rules:[{text:'Задачи формулировать коротко',episodes:['e1','e2','e3']},{text:'Выдуманное',episodes:['e1']}],
    insights:[{text:'Ценит краткость',episodes:['e1','e2']}],
    summary:'Объединила два факта',
  },at(now));
  const texts=memory.items.map(i=>i.text);
  assert.ok(texts.includes('Любит короткие, лаконичные ответы'));assert.ok(!texts.includes('Любит короткие ответы'));
  assert.ok(texts.includes('Зовут Аспкса'));assert.ok(!texts.includes('Ищет новый ноутбук'));assert.ok(!texts.includes('Выдуманное'));
  const merged=memory.items.find(i=>i.text==='Любит короткие, лаконичные ответы');
  assert.equal(merged.hits,2);assert.deepEqual(memory.items.find(i=>i.id===linker.id).links,[merged.id]);
  const rule=memory.items.find(i=>i.kind==='rule');
  assert.equal(rule.text,'Задачи формулировать коротко');assert.deepEqual(rule.links,['e1','e2','e3']);assert.equal(rule.source,'sleep');
  assert.ok(memory.episodes.every(e=>e.consolidated));assert.equal(memory.lastSleep,now);
  assert.equal(memory.journal.at(-1).text,'Сон: Объединила два факта');
});

test('Stored memory is normalized and continued dialogs are not analysed twice', () => {
  const memory=normalizeMemory({version:1,settings:{private:true},items:[{id:'a',kind:'fact',text:' Любит  чай ',weight:5},{id:'a',kind:'fact',text:'дубль'},{id:'b',kind:'note',text:'x'},{id:'c',kind:'rule',text:''}],episodes:[{id:'e',topic:'Тема',date:'bad'}],dialogs:[{id:'bad id',messages:[]}],lastSleep:'nope'});
  assert.deepEqual(memory.items.map(i=>[i.id,i.text,i.weight]),[['a','Любит чай',1]]);
  assert.equal(memory.settings.private,true);assert.equal(memory.settings.enabled,true);
  assert.equal(memory.episodes.length,1);assert.equal(memory.dialogs.length,0);assert.equal(memory.lastSleep,null);
  assert.throws(()=>normalizeMemory({version:2}));
  const messages=[{role:'user',content:'а'},{role:'assistant',content:'б'},{role:'user',content:'в'}];
  assert.deepEqual(unseen(messages,fingerprint(messages.slice(0,2))),[messages[2]]);
  assert.deepEqual(unseen(messages,'other'),messages);
});

test('Memory over HTTP: commands, recall, reflection, sleep, private mode and controls', async t => {
  const root=await mkdtemp(join(tmpdir(),'Miyuneya память '));
  const seen=[];
  let reflection={episode:{topic:'Обсуждали календарь',outcome:'Решили добавить сроки',links:['n1']},facts:[{text:'Работает по утрам',links:['n1']}],rules:[{text:'Отвечать коротко'}]};
  const fake=createServer(async(req,res)=>{
    let body='';for await(const c of req)body+=c;
    const json=JSON.parse(body||'{}');seen.push(json);
    const system=json.messages?.[0]?.content||'';
    res.setHeader('Content-Type','application/json');
    const reply=content=>res.end(JSON.stringify({choices:[{message:{role:'assistant',content}}]}));
    if(system.includes('Разбери законченный разговор'))return reply(JSON.stringify(reflection));
    if(system.includes('«сон»')){const id=/\[(\w+)\] Работает по утрам/.exec(json.messages[1].content)?.[1];return reply(JSON.stringify({update:[{id,text:'Работает по утрам, с 7 до 11'}],summary:'Уточнила распорядок'}));}
    if(system.includes('сжимаешь начало разговора'))return reply('Говорили о календаре.');
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.end(`data: ${JSON.stringify({choices:[{delta:{content:'Хорошо!'}}]})}\n\ndata: [DONE]\n\n`);
  });
  fake.listen(0,'127.0.0.1');await once(fake,'listening');
  let server;
  t.after(async()=>{await server?.shutdown();fake.close();await removeTemp(root);});
  const seeded=emptyWorkspace();seeded.notes.push({id:'n1',title:'План календаря',body:'',updatedAt:'2026-10-01T10:00:00Z'});
  await mkdir(join(root,'data'));await writeFile(join(root,'data','workspace.json'),JSON.stringify({revision:0,data:seeded}));
  await writeFile(join(root,'data','assistant.json'),JSON.stringify({apiKey:'good-key-123',model:'zeta/model'}));
  const start=async(extra={})=>{server=await createApp(root,'test',false,{cloudUrl:`http://127.0.0.1:${fake.address().port}/v1`,...extra});server.listen(0,'127.0.0.1');await once(server,'listening');return `http://127.0.0.1:${server.address().port}`;};
  let url=await start();
  const call=(path,method,body)=>fetch(url+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const lines=async response=>(await response.text()).trim().split('\n').map(line=>JSON.parse(line));
  const chat=(content,extra={})=>call('/api/assistant/chat','POST',{messages:[{role:'user',content}],dialog:'dialog-0001',...extra}).then(lines);

  let view=await (await fetch(url+'/api/memory')).json();
  assert.equal(view.enabled,true);assert.equal(view.available,true);assert.deepEqual(view.items,[]);

  assert.deepEqual(await chat('Запомни, что я люблю зелёный чай'),[{memory:'Запомнила: я люблю зелёный чай'},{delta:'Хорошо!'},{done:true,model:'zeta/model'}]);
  assert.match(seen.at(-1).messages[0].content,/сохранила в долговременную память: «я люблю зелёный чай»/);
  view=await (await fetch(url+'/api/memory')).json();
  assert.equal(view.items[0].text,'я люблю зелёный чай');assert.equal(view.items[0].pinned,true);assert.equal(view.pending,1);

  await chat('Какой чай мне купить?',{summary:'Раньше говорили о покупках.'});
  assert.match(seen.at(-1).messages[0].content,/я люблю зелёный чай/);assert.match(seen.at(-1).messages[0].content,/Раньше говорили о покупках/);

  // Closing the dialog runs the reflection: an episode, a linked fact and a rule from it.
  view=await (await call('/api/memory/close','POST',{dialog:'dialog-0001'})).json();
  assert.equal(view.pending,0);assert.equal(view.episodes[0].topic,'Обсуждали календарь');assert.deepEqual(view.episodes[0].links,['n1']);
  const reflected=seen.at(-1).messages[1].content;
  assert.match(reflected,/\[n1\] заметка: План календаря/);assert.match(reflected,/Пользователь: Какой чай мне купить\?/);
  assert.ok(view.items.some(i=>i.kind==='rule'&&i.text==='Отвечать коротко'));
  const morning=view.items.find(i=>i.text==='Работает по утрам');assert.deepEqual(morning.links,['n1',view.episodes[0].id]);
  // Continuing the same dialog later only sends the new turns to the next reflection.
  await call('/api/assistant/chat','POST',{dialog:'dialog-0001',messages:[{role:'user',content:'Какой чай мне купить?'},{role:'assistant',content:'Хорошо!'},{role:'user',content:'А к нему что-нибудь сладкое?'}]}).then(lines);
  reflection={episode:null,facts:[],rules:[]};
  await call('/api/memory/close','POST',{dialog:'dialog-0001'});
  assert.doesNotMatch(seen.at(-1).messages[1].content,/Какой чай мне купить/);assert.match(seen.at(-1).messages[1].content,/сладкое/);

  view=await (await call('/api/memory/sleep','POST')).json();
  assert.ok(view.items.some(i=>i.text==='Работает по утрам, с 7 до 11'));assert.ok(view.lastSleep);
  assert.equal(view.newEpisodes,0);assert.equal(view.journal[0].text,'Сон: Уточнила распорядок');

  // Private mode answers with memory but records nothing.
  assert.equal((await (await call('/api/memory','PUT',{private:true})).json()).private,true);
  await chat('Секретный разговор',{dialog:'dialog-0002'});
  assert.equal((await (await fetch(url+'/api/memory')).json()).pending,0);
  await call('/api/memory','PUT',{private:false,enabled:false});
  await chat('Что ты обо мне знаешь?');
  assert.doesNotMatch(seen.at(-1).messages[0].content,/зелёный чай/);
  await chat('Запомни, что это не сохранится');
  assert.ok(!(await (await fetch(url+'/api/memory')).json()).items.some(i=>i.text.includes('не сохранится')));
  await call('/api/memory','PUT',{enabled:true});
  assert.equal((await call('/api/memory','PUT',{enabled:'yes'})).status,400);

  view=await (await call('/api/memory/items','POST',{kind:'rule',text:'Называть меня по имени'})).json();
  const rule=view.items.find(i=>i.text==='Называть меня по имени');assert.equal(rule.pinned,true);
  assert.equal((await call('/api/memory/items','POST',{kind:'note',text:'x'})).status,400);
  view=await (await call('/api/memory/items/'+rule.id,'PATCH',{text:'Обращаться по имени',pinned:false})).json();
  assert.equal(view.items.find(i=>i.id===rule.id).text,'Обращаться по имени');
  assert.equal((await call('/api/memory/items/'+view.episodes[0].id,'PATCH',{outcome:'Сроки добавлены'})).status,200);
  assert.equal((await call('/api/memory/items/nope','DELETE')).status,404);
  view=await (await call('/api/memory/items/'+rule.id,'DELETE')).json();
  assert.ok(!view.items.some(i=>i.id===rule.id));

  const exported=await fetch(url+'/api/memory/export');
  assert.match(exported.headers.get('content-disposition'),/attachment; filename="Miyuneya-memory-/);
  const dump=await exported.json();assert.ok(dump.items.length>0);assert.equal(dump.dialogs,undefined);assert.ok(!JSON.stringify(dump).includes('good-key'));

  const compact=await (await call('/api/assistant/compact','POST',{messages:[{role:'user',content:'Про календарь'},{role:'assistant',content:'Да'}]})).json();
  assert.deepEqual(compact,{summary:'Говорили о календаре.'});
  assert.equal((await fetch(url+'/api/memory',{method:'DELETE',headers:{Origin:'https://evil.example'}})).status,403);

  const file=JSON.parse(await readFile(join(root,'data','memory.json'),'utf8'));
  assert.ok(file.items.some(i=>i.text==='я люблю зелёный чай'));
  assert.ok(!JSON.stringify(await (await fetch(url+'/api/workspace')).json()).includes('зелёный чай'));
  view=await (await call('/api/memory','DELETE')).json();
  assert.deepEqual([view.items,view.episodes,view.journal],[[],[],[]]);assert.equal(view.enabled,true);
  await server.shutdown();

  // A quiet dialog is reflected on by the background timer.
  reflection={episode:{topic:'Утренний разговор',outcome:''},facts:[],rules:[]};
  url=await start({memoryIdleMs:30,memoryTickMs:20});
  await chat('Доброе утро, давай спланируем день',{dialog:'dialog-0003'});
  for(let i=0;i<100 && !(await (await fetch(url+'/api/memory')).json()).episodes.length;i++) await new Promise(r=>setTimeout(r,20));
  assert.equal((await (await fetch(url+'/api/memory')).json()).episodes[0].topic,'Утренний разговор');
  await server.shutdown();

  await writeFile(join(root,'data','memory.json'),'BROKEN');
  url=await start();
  assert.deepEqual((await (await fetch(url+'/api/memory')).json()).items,[]);
  const broken=(await readdir(join(root,'data'))).find(name=>name.startsWith('memory.broken-'));
  assert.equal(await readFile(join(root,'data',broken),'utf8'),'BROKEN');
});
