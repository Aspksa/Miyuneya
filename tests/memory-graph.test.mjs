import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { removeTemp } from './helpers/lifecycle.mjs';
import { createApp } from '../server/app.ts';
import { emptyWorkspace } from '../src/model.ts';
import { emptyMemory, upsert, upsertEntity, addEdge, applyReflection, applySleep, decay, reflectInput, sleepInput, normalizeMemory } from '../server/memory.ts';
import { memoryContext, cosine, expired } from '../server/recall.ts';
import { buildGraph, layoutGraph } from '../src/memory.ts';

// A stand-in for an embedding model: a few concepts with synonyms, so meaning matches where words do not.
const concepts=[['кофе','напит','чай','выпит'],['кален','срок','распис','план'],['кошк','кот','питом']];
export const embedText=text=>{const t=text.toLocaleLowerCase('ru');return [...concepts.map(words=>words.some(w=>t.includes(w))?1:0),0.05];};

test('Recall finds facts by meaning, skips expired ones and follows the graph', () => {
  const memory=emptyMemory();const now='2026-10-29T10:00:00.000Z';
  const coffee=upsert(memory,'fact','Пьёт кофе без сахара',{now,category:'tastes'}).item;
  for(let i=0;i<20;i++) upsert(memory,'fact',`Посторонний факт номер ${i} про разное ${'абвгдежзик'[i%10]}${i}`,{now});
  upsert(memory,'fact','Уезжает в отпуск',{now,until:'2026-10-01'});
  const project=upsertEntity(memory,'Миюнея','project','Личное пространство заметок',now);
  const plan=upsert(memory,'fact','Хочет добавить сроки к задачам',{now,category:'plans'}).item;
  addEdge(memory,plan.id,project.id,'about',now);addEdge(memory,'task1',project.id,'part_of',now);
  const titles=new Map([['task1',{kind:'task',title:'Добавить календарь'}]]);
  const vector=text=>embedText(text);
  const context=memoryContext(memory,'Что мне выпить из напитков?',titles,Date.parse(now),{query:embedText('Что мне выпить из напитков?'),vector});
  assert.match(context,/Пьёт кофе без сахара/);
  assert.ok(context.indexOf('кофе')<context.indexOf('Посторонний'));
  assert.doesNotMatch(context,/Уезжает в отпуск/);
  assert.ok(expired({until:'2026-10-01'},Date.parse(now)));assert.ok(!expired({until:null}));
  const graph=memoryContext(memory,'Как дела с проектом Миюнея?',titles,Date.parse(now));
  assert.match(graph,/Люди, проекты и темы[\s\S]*Миюнея \(проект\): Личное пространство заметок/);
  assert.match(graph,/«Хочет добавить сроки к задачам» → про → Миюнея/);
  assert.match(graph,/задача «Добавить календарь» → часть → Миюнея/);
  assert.equal(cosine([1,0],[1,0]),1);assert.equal(cosine([1,0],[0,1]),0);assert.equal(cosine([],[]),0);
  assert.ok(coffee.category==='tastes');
});

test('Reflection builds entities, categories, deadlines and typed relations', () => {
  const memory=emptyMemory();
  const dialog={id:'dialog-0001',messages:[{role:'user',content:'Катя поможет с календарём'}],summary:'',updatedAt:'2026-10-29T10:00:00Z',failures:0,signals:['Отменил созданную тобой запись «Купить хлеб»']};
  assert.match(reflectInput(memory,dialog,null),/Сигналы поведения пользователя:\n- Отменил созданную тобой запись «Купить хлеб»/);
  applyReflection(memory,{
    episode:{topic:'Календарь с Катей',outcome:'Катя поможет'},
    entities:[{name:'Катя',type:'person',about:'коллега по работе'},{name:'Календарь',type:'project'}],
    facts:[{text:'Работает вместе с Катей',category:'people',about:['Катя']},{text:'Уезжает в командировку',category:'work',until:'2026-11-15'},{text:'Плохая дата',until:'завтра'}],
    relations:[{from:'Календарь',to:'episode',type:'decided_in'},{from:'Катя',to:'Календарь',type:'part_of'},{from:'Никто',to:'Катя',type:'blocks'}],
  },dialog,new Set());
  const katya=memory.entities.find(e=>e.name==='Катя');
  assert.equal(katya.type,'person');assert.equal(memory.entities.length,2);
  const work=memory.items.find(i=>i.text==='Работает вместе с Катей');
  assert.equal(work.category,'people');assert.ok(memory.edges.some(e=>e.from===work.id&&e.to===katya.id&&e.type==='about'));
  assert.equal(memory.items.find(i=>i.text==='Уезжает в командировку').until,'2026-11-15');
  assert.equal(memory.items.find(i=>i.text==='Плохая дата').until,null);
  const episode=memory.episodes[0];const calendar=memory.entities.find(e=>e.name==='Календарь');
  assert.ok(memory.edges.some(e=>e.from===calendar.id&&e.to===episode.id&&e.type==='decided_in'));
  assert.equal(memory.edges.filter(e=>e.type==='blocks').length,0);
  // The same name never makes a second node, and a new spelling becomes an alias.
  upsertEntity(memory,'катя','person','');upsertEntity(memory,'Катя Иванова','person','');
  assert.equal(memory.entities.filter(e=>e.type==='person').length,2);
  assert.ok(!addEdge(memory,work.id,katya.id,'about'));
});

test('Sleep learns from notes, writes the diary and archives dated facts for historical recall', () => {
  const memory=emptyMemory();const now=Date.parse('2026-10-29T03:00:00Z');
  upsert(memory,'fact','Летит в Сочи',{until:'2026-10-20',now:'2026-10-01T00:00:00Z'});
  const workspace=emptyWorkspace();
  workspace.notes.push({id:'n1',title:'Цели на год',body:'Выучить японский',updatedAt:'2026-10-28T10:00:00Z'},{id:'n2',title:'Старое',body:'',updatedAt:'2026-01-01T00:00:00Z'});
  memory.notesSeen='2026-06-01T00:00:00Z';
  const input=sleepInput(memory,workspace,now);
  assert.match(input,/\[n1\] Цели на год\nВыучить японский/);assert.doesNotMatch(input,/Старое/);
  applySleep(memory,{note_facts:[{text:'Учит японский язык',note:'n1',category:'plans'},{text:'Выдумка',note:'nope'}],entities:[{name:'Японский язык',type:'topic'}],relations:[{from:'Японский язык',to:'n1',type:'about'}],diary:'Сегодня я узнала, что вы учите японский.'},now,new Set(['n1']));
  const fact=memory.items.find(i=>i.text==='Учит японский язык');
  assert.equal(fact.source,'note');assert.deepEqual(fact.links,['n1']);assert.equal(fact.category,'plans');
  assert.ok(!memory.items.some(i=>i.text==='Выдумка'));assert.ok(memory.items.some(i=>i.text==='Летит в Сочи'),'retain the source for historical questions');
  assert.doesNotMatch(memoryContext(memory,'Сочи',new Map(),now),/Летит в Сочи/);
  assert.match(memoryContext(memory,'Сочи по состоянию на 2026-10-10',new Map(),now),/Летит в Сочи/);
  assert.equal(memory.diary[0].text,'Сегодня я узнала, что вы учите японский.');
  assert.ok(memory.edges.some(e=>e.to==='n1'&&e.type==='about'));
  const restored=normalizeMemory(JSON.parse(JSON.stringify(memory)));
  assert.deepEqual([restored.entities.length,restored.edges.length,restored.diary.length,restored.items.find(i=>i.text==='Учит японский язык').category],[1,1,1,'plans']);
  decay(memory,now);assert.equal(memory.entities.length,1);
});

test('The knowledge map keeps connected records and lays them out deterministically', () => {
  const view={items:[{id:'f1',kind:'fact',text:'Любит кофе',links:['n1']},{id:'f2',kind:'fact',text:'Одинокий факт',links:[]}],episodes:[{id:'e1',date:'2026-10-29T10:00:00Z',topic:'Кофе',outcome:'',links:['f1']}],
    entities:[{id:'p1',name:'Катя',type:'person',about:'',aliases:[],degree:1}],edges:[{from:'f1',to:'p1',type:'about'},{from:'f1',to:'gone',type:'related'}]};
  const entry=id=>id==='n1'?{kind:'note',title:'Кофейни'}:null;
  const graph=buildGraph(view,entry);
  assert.deepEqual(graph.nodes.map(n=>n.id).sort(),['e1','f1','n1','p1']);
  assert.equal(graph.edges.length,3);
  const a=layoutGraph(buildGraph(view,entry)),b=layoutGraph(buildGraph(view,entry));
  assert.deepEqual(a.nodes.map(n=>[n.x,n.y]),b.nodes.map(n=>[n.x,n.y]));
  for(const n of a.nodes){assert.ok(n.x>=30&&n.x<=610);assert.ok(n.y>=20&&n.y<=416);}
  const [f1,p1]=['f1','p1'].map(id=>a.nodes.find(n=>n.id===id));
  assert.ok(Math.hypot(f1.x-p1.x,f1.y-p1.y)<400);
});

test('Memory over HTTP searches by meaning, records signals and learns from notes', async t => {
  const root=await mkdtemp(join(tmpdir(),'Miyuneya граф '));
  const seen=[];let embeddings=true;
  const fake=createServer(async(req,res)=>{
    let body='';for await(const c of req)body+=c;
    const json=JSON.parse(body||'{}');seen.push({path:req.url,json});
    res.setHeader('Content-Type','application/json');
    if(req.url==='/v1/embeddings'){
      if(!embeddings){res.statusCode=404;return res.end(JSON.stringify({error:{message:'model not found'}}));}
      return res.end(JSON.stringify({data:json.input.map((text,index)=>({index,embedding:embedText(text)})).reverse()}));
    }
    const system=json.messages?.[0]?.content||'';
    const reply=content=>res.end(JSON.stringify({choices:[{message:{role:'assistant',content}}]}));
    if(system.includes('Разбери законченный разговор'))return reply(JSON.stringify({episode:{topic:'Про напитки'},facts:[],rules:[{text:'Предлагать один вариант'}]}));
    if(system.includes('«сон»'))return reply(JSON.stringify({note_facts:[{text:'Собирается в Японию',note:'n1',category:'plans'}],diary:'Я узнала про поездку в Японию.',summary:'Прочитала заметки'}));
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.end(`data: ${JSON.stringify({choices:[{delta:{content:'Конечно!'}}]})}\n\ndata: [DONE]\n\n`);
  });
  fake.listen(0,'127.0.0.1');await once(fake,'listening');
  let server;
  t.after(async()=>{await server?.shutdown();fake.close();await removeTemp(root);});
  const seeded=emptyWorkspace();seeded.notes.push({id:'n1',title:'Поездка',body:'Хочу в Японию весной',updatedAt:new Date().toISOString()});
  await mkdir(join(root,'data'));await writeFile(join(root,'data','workspace.json'),JSON.stringify({revision:0,data:seeded}));
  await writeFile(join(root,'data','assistant.json'),JSON.stringify({apiKey:'good-key-123',model:'zeta/model',embedModel:'test/embed'}));
  server=await createApp(root,'test',false,{cloudUrl:`http://127.0.0.1:${fake.address().port}/v1`});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${server.address().port}`;
  const call=(path,method,body)=>fetch(url+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const lines=async response=>(await response.text()).trim().split('\n').map(line=>JSON.parse(line));
  const memoryView=async()=>(await fetch(url+'/api/memory')).json();
  const until=async check=>{let v;for(let i=0;i<100;i++){v=await memoryView();if(check(v))return;await new Promise(r=>setTimeout(r,20));}assert.fail('timeout '+JSON.stringify({indexed:v.indexed,search:v.search,err:v.searchError,paths:seen.map(s=>s.path)}));};
  assert.equal((await (await fetch(url+'/api/assistant')).json()).embedModel,'test/embed');

  await call('/api/memory/items','POST',{kind:'fact',text:'Пьёт кофе без сахара',category:'tastes'});
  const words=['лыжи','театр','гитара','шахматы','музей','велосипед','рыбалка','вязание','астрономия','керамика','фотография','плавание','поэзия','садоводство','оригами'];
  for(const w of words) await call('/api/memory/items','POST',{kind:'fact',text:`Интересуется темой ${w}`});
  await until(v=>v.indexed>=16);
  assert.equal((await memoryView()).search,'meaning');
  const vectors=JSON.parse(await readFile(join(root,'data','memory-vectors.json'),'utf8'));assert.equal(vectors.model,'test/embed');

  const chat=(messages,dialog='dialog-0001')=>call('/api/assistant/chat','POST',{messages,dialog}).then(lines);
  await chat([{role:'user',content:'Посоветуй напиток'}]);
  const system=seen.findLast(s=>s.path==='/v1/chat/completions').json.messages[0].content;
  assert.match(system,/Что ты знаешь[^\n]*\n- Пьёт кофе без сахара/);

  // Implicit feedback: a repeated question and an undone entry reach the reflection.
  await chat([{role:'user',content:'Посоветуй напиток'},{role:'assistant',content:'Конечно!'},{role:'user',content:'Посоветуй напиток!'}]);
  assert.deepEqual(await (await call('/api/memory/signal','POST',{dialog:'dialog-0001',kind:'undo',text:'Купить чай'})).json(),{ok:true});
  assert.equal((await call('/api/memory/signal','POST',{dialog:'dialog-0001',kind:'hack'})).status,400);
  await call('/api/memory/close','POST',{dialog:'dialog-0001'});
  const reflected=seen.findLast(s=>s.json.messages?.[0]?.content.includes('Разбери законченный')).json.messages[1].content;
  assert.match(reflected,/Переспросил почти то же самое: «Посоветуй напиток!»/);assert.match(reflected,/Отменил созданную тобой запись «Купить чай»/);

  let view=await (await call('/api/memory/sleep','POST')).json();
  const sleepInputText=seen.findLast(s=>s.json.messages?.[0]?.content.includes('«сон»')).json.messages[1].content;
  assert.match(sleepInputText,/\[n1\] Поездка\nХочу в Японию весной/);
  assert.equal(view.diary[0].text,'Я узнала про поездку в Японию.');
  const japan=view.items.find(i=>i.text==='Собирается в Японию');assert.equal(japan.source,'note');assert.deepEqual(japan.links,['n1']);
  // Notes already read are not sent to the next sleep.
  await call('/api/memory/sleep','POST');
  assert.doesNotMatch(seen.findLast(s=>s.json.messages?.[0]?.content.includes('«сон»'))?.json.messages[1].content||'',/Хочу в Японию/);

  view=await (await call('/api/memory/items/'+japan.id,'PATCH',{category:'work',until:'2027-04-01'})).json();
  assert.deepEqual([view.items.find(i=>i.id===japan.id).category,view.items.find(i=>i.id===japan.id).until],['work','2027-04-01']);
  assert.equal((await call('/api/memory/items/'+japan.id,'PATCH',{until:'когда-нибудь'})).status,400);
  view=await (await call('/api/memory/items/'+japan.id,'PATCH',{until:null})).json();assert.equal(view.items.find(i=>i.id===japan.id).until,null);
  view=await (await call('/api/memory/unlink','POST',{from:japan.id,to:'n1'})).json();
  assert.deepEqual(view.items.find(i=>i.id===japan.id).links,[]);
  assert.equal((await call('/api/memory/unlink','POST',{from:japan.id,to:'n1'})).status,404);
  const entry=view.diary[0];
  view=await (await call('/api/memory/items/'+entry.id,'PATCH',{text:'Исправленная запись'})).json();assert.equal(view.diary[0].text,'Исправленная запись');
  view=await (await call('/api/memory/items/'+entry.id,'DELETE')).json();assert.ok(!view.diary.some(d=>d.id===entry.id));

  // Without an embedding model the memory keeps working on words and says why.
  await server.shutdown();embeddings=false;
  await writeFile(join(root,'data','memory-vectors.json'),'{}');
  server=await createApp(root,'test',false,{cloudUrl:`http://127.0.0.1:${fake.address().port}/v1`});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const again=`http://127.0.0.1:${server.address().port}`;
  await fetch(again+'/api/memory/items',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'fact',text:'Любит горы'})});
  let failed;for(let i=0;i<100&&!(failed=(await (await fetch(again+'/api/memory')).json())).searchError;i++) await new Promise(r=>setTimeout(r,20));
  assert.equal(failed.search,'words');assert.match(failed.searchError,/не нашёл модель/);
  const answer=await (await fetch(again+'/api/assistant/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'Куда поехать в горы?'}]})})).text();
  assert.match(answer,/Конечно!/);
  assert.match(seen.findLast(s=>s.path==='/v1/chat/completions').json.messages[0].content,/Любит горы/);
});
