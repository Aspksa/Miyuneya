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
import { emptyMemory, upsert, upsertEntity, applyReflection, applySleep, answer, ask, findGaps, normalizeMemory, sleepInput, reflectInput } from '../server/memory.ts';
import { memoryContext } from '../server/recall.ts';
import { growth, levelOf } from '../server/growth.ts';

const dialog=(text='Помоги с планом')=>({id:'dialog-0001',messages:[{role:'user',content:text}],summary:'',updatedAt:'2026-10-29T10:00:00.000Z',failures:0,signals:[]});

test('Self-review scores the dialog and turns a weak spot into a skill rule', () => {
  const memory=emptyMemory();const now='2026-10-29T10:00:00.000Z';
  applyReflection(memory,{episode:{topic:'План на неделю'},review:{score:3.4,good:'дала структуру',weak:'слишком длинный ответ',lesson:'Сначала давать короткий ответ, детали по просьбе'}},dialog(),new Set(),now);
  const episode=memory.episodes[0];
  assert.deepEqual([episode.score,episode.weak],[3,'слишком длинный ответ']);
  const lesson=memory.items.find(i=>i.kind==='rule');
  assert.equal(lesson.source,'review');assert.deepEqual(lesson.links,[episode.id]);
  assert.match(memory.journal.map(j=>j.text).join('\n'),/Самооценка 3\/5 · слабое место: слишком длинный ответ/);
  // The same weak spot again confirms the skill instead of adding a copy.
  applyReflection(memory,{episode:{topic:'Ещё план'},review:{score:9,lesson:'Сначала давать короткий ответ, детали по просьбе'}},dialog(),new Set(),now);
  assert.equal(memory.items.filter(i=>i.kind==='rule').length,1);assert.equal(memory.items[0].hits,2);assert.equal(memory.episodes[1].score,5);
  // The sleep sees the reviews and an episode without one stays unscored.
  assert.match(sleepInput(memory),/самооценка 3\/5, слабое место: слишком длинный ответ/);
  applyReflection(memory,{episode:{topic:'Без оценки'},review:{weak:'что-то'}},dialog(),new Set(),now);
  assert.equal(memory.episodes[2].score,null);
  assert.equal(normalizeMemory(JSON.parse(JSON.stringify(memory))).episodes[0].score,3);
});

test('Sleep rolls facts up into topics and an understanding, and survives merges', () => {
  const memory=emptyMemory();const now=Date.parse('2026-10-29T10:00:00.000Z');const at=new Date(now).toISOString();
  const a=upsert(memory,'fact','Работает дизайнером',{now:at,category:'work'}).item;
  const b=upsert(memory,'fact','Работает в студии интерфейсов',{now:at,category:'work'}).item;
  const c=upsert(memory,'fact','Бегает по утрам',{now:at,category:'health'}).item;
  applySleep(memory,{merge:[{ids:[a.id,b.id],text:'Работает дизайнером в студии интерфейсов'}],
    topics:[{title:'Работа дизайнером',area:'work',summary:'Дизайнер в студии.',facts:[a.id,b.id]},{title:'Спорт',area:'health',summary:'Бегает.',facts:[c.id,'чужой']},{title:'Пустая'}],
    understanding:'Творческий человек, ценит утро и порядок.'},now);
  const merged=memory.items.find(i=>i.text.startsWith('Работает дизайнером в студии'));
  assert.equal(memory.topics.length,2);
  assert.deepEqual(memory.topics[0].facts,[merged.id]);assert.deepEqual(memory.topics[1].facts,[c.id]);
  assert.equal(memory.understanding.text,'Творческий человек, ценит утро и порядок.');
  // Updating by id keeps one topic; a fact moves to the topic that claims it.
  const sport=memory.topics[1];
  applySleep(memory,{topics:[{id:sport.id,summary:'Бегает по утрам три раза в неделю.',facts:[c.id]},{title:'Утро',area:'health',facts:[c.id]}]},now);
  assert.ok(memory.topics.some(t=>t.title==='Утро'&&t.facts.includes(c.id)));
  // A topic that lost its facts but still has a summary stays.
  assert.deepEqual([sport.summary,sport.facts],['Бегает по утрам три раза в неделю.',[]]);assert.ok(memory.topics.includes(sport));
  assert.match(sleepInput(memory),/Общее понимание пользователя:\nТворческий человек/);
  const restored=normalizeMemory(JSON.parse(JSON.stringify(memory)));
  assert.deepEqual(restored.topics.map(t=>t.title),memory.topics.map(t=>t.title));assert.equal(restored.understanding.text,memory.understanding.text);
});

test('Questions cover gaps and contradictions, and answers become memory', () => {
  const memory=emptyMemory();const at='2026-10-29T10:00:00.000Z';
  upsertEntity(memory,'Проект Х','project','',at);upsertEntity(memory,'Катя','person','коллега',at);
  findGaps(memory,at);
  assert.deepEqual(memory.questions.map(q=>q.text),['Вы упоминали «Проект Х». Что это для вас?']);
  findGaps(memory,at);assert.equal(memory.questions.length,1);
  const gap=memory.questions[0];
  const fact=answer(memory,gap.id,'Мой стартап про погоду',at);
  assert.equal(fact.text,'Проект Х: Мой стартап про погоду');assert.equal(fact.source,'user');
  assert.equal(memory.entities[0].about,'Мой стартап про погоду');assert.equal(memory.questions.length,0);
  assert.ok(memory.edges.some(e=>e.from===fact.id&&e.to===memory.entities[0].id&&e.type==='about'));

  const morning=upsert(memory,'fact','Работает по утрам',{now:at}).item;const evening=upsert(memory,'fact','Работает по вечерам',{now:at}).item;
  applySleep(memory,{conflicts:[{ids:[morning.id,evening.id],question:'Вы работаете утром или вечером?'},{ids:[morning.id],question:'Один факт — не противоречие'}]},Date.parse(at));
  const conflict=memory.questions.find(q=>q.kind==='conflict');
  assert.deepEqual(conflict.facts,[morning.id,evening.id]);assert.equal(memory.questions.filter(q=>q.kind==='conflict').length,1);
  assert.match(reflectInput(memory,dialog(),null),new RegExp(`\\[${conflict.id}\\] Вы работаете утром или вечером\\?`));
  // The answer outweighs both contradicting facts.
  const before=morning.weight;
  applyReflection(memory,{answers:[{question:conflict.id,text:'Сейчас работает по вечерам'}],questions:['Как зовут вашу кошку?','Как зовут вашу кошку?']},dialog(),new Set(),at);
  assert.ok(memory.items.find(i=>i.id===morning.id).weight<before);
  assert.ok(memory.items.find(i=>i.id===evening.id).weight>before,'the fact the answer agrees with is confirmed');
  assert.deepEqual(memory.questions.map(q=>q.text),['Как зовут вашу кошку?']);
  // A contradiction whose facts are gone is no longer asked.
  ask(memory,'conflict','Старое противоречие?',{facts:['aaaaaaaaaaaa','bbbbbbbbbbbb']},at);
  applySleep(memory,{},Date.parse(at));
  assert.ok(!memory.questions.some(q=>q.text==='Старое противоречие?'));
});

test('Growth counts levels, the week, self-review quality and skills by area', () => {
  assert.deepEqual(levelOf(0),{level:1,floor:0,next:200});assert.deepEqual(levelOf(250),{level:2,floor:200,next:600});
  const memory=emptyMemory();const now=Date.parse('2026-10-29T10:00:00.000Z');const at=new Date(now).toISOString();const old=new Date(now-20*86_400_000).toISOString();
  upsert(memory,'fact','Работает дизайнером',{now:at,category:'work'});
  const known=upsert(memory,'fact','Любит макеты',{now:old,category:'work'}).item;known.hits=3;known.seen=at;known.weight=0.9;
  upsert(memory,'fact','Бегает',{now:old,category:'health'}).item.weight=0.9;
  upsert(memory,'rule','Отвечать коротко',{now:at,source:'review'});
  memory.topics.push({id:'t1',title:'Работа',area:'work',summary:'',facts:[known.id],created:at,updated:at});
  memory.episodes.push({id:'e1',date:at,topic:'А',outcome:'',links:[],consolidated:false,score:4,weak:''},{id:'e2',date:at,topic:'Б',outcome:'',links:[],consolidated:false,score:5,weak:''},
    {id:'e3',date:new Date(now-10*86_400_000).toISOString(),topic:'В',outcome:'',links:[],consolidated:true,score:3,weak:''});
  const g=growth(memory,now);
  assert.equal(g.week.facts,1);assert.equal(g.week.rules,1);assert.equal(g.week.lessons,1);assert.equal(g.week.episodes,2);assert.equal(g.week.topics,1);
  assert.deepEqual(g.quality,{average:4.5,reviewed:2,previous:3});
  assert.deepEqual(g.skills.map(s=>s.area),['work','health']);
  const work=g.skills[0];assert.equal(work.facts,2);assert.equal(work.points,10+18+15);assert.equal(work.week,10+4+15);assert.deepEqual(work.topics,[{id:'t1',title:'Работа'}]);
  assert.equal(g.xp,10+18+10+12+15+15);assert.equal(g.level,1);assert.equal(g.name,'Знакомство');
});

test('Recall starts from the understanding and topics and carries one open question', () => {
  const memory=emptyMemory();const now=Date.parse('2026-10-29T10:00:00.000Z');const at=new Date(now).toISOString();
  memory.understanding={text:'Дизайнер, ценит краткость.',updated:at};
  const inTopic=upsert(memory,'fact','Делает приложение для бега',{now:at}).item;
  for(const w of ['лыжи','театр','гитара','шахматы','музей','велосипед','рыбалка','вязание','астрономия','керамика','фотография','плавание','поэзия','садоводство']) upsert(memory,'fact',`Интересуется темой ${w}`,{now:at});
  memory.topics.push({id:'t1',title:'Утренние пробежки',area:'health',summary:'Бегает утром и пишет трекер пробежек',facts:[inTopic.id],created:at,updated:at});
  const context=memoryContext(memory,'Как лучше бегать утром?',new Map(),now,{question:'Как зовут вашу кошку?'});
  assert.ok(context.indexOf('Дизайнер, ценит краткость.')<context.indexOf('Темы его жизни'));
  assert.match(context,/- Утренние пробежки \(здоровье\): \[сводка модели\] Бегает утром/);
  assert.match(context,/Что ты знаешь[^\n]*\n- \[непроверенное предположение\] Делает приложение для бега/);
  assert.match(context,/мягко спроси пользователя: «Как зовут вашу кошку\?»/);
  assert.doesNotMatch(memoryContext(memory,'Привет',new Map(),now),/спроси/);
});

test('Memory over HTTP answers questions, edits topics and asks once a day', async t => {
  const root=await mkdtemp(join(tmpdir(),'Miyuneya рост '));
  const seen=[];
  const fake=createServer(async(req,res)=>{
    let body='';for await(const c of req)body+=c;
    const json=JSON.parse(body||'{}');seen.push(json);
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.end(`data: ${JSON.stringify({choices:[{delta:{content:'Хорошо.'}}]})}\n\ndata: [DONE]\n\n`);
  });
  fake.listen(0,'127.0.0.1');await once(fake,'listening');
  let server;
  t.after(async()=>{await server?.shutdown();fake.close();await removeTemp(root);});
  const memory=emptyMemory();const at=new Date().toISOString();
  upsertEntity(memory,'Луна','thing','',at);findGaps(memory,at);
  memory.topics.push({id:'t1',title:'Работа',area:'work',summary:'Пока мало',facts:[],created:at,updated:at});
  memory.understanding={text:'Пока знаю немного.',updated:at};
  await mkdir(join(root,'data'));
  await writeFile(join(root,'data','workspace.json'),JSON.stringify({revision:0,data:emptyWorkspace()}));
  await writeFile(join(root,'data','memory.json'),JSON.stringify(memory));
  await writeFile(join(root,'data','assistant.json'),JSON.stringify({apiKey:'good-key-123',model:'zeta/model',embedModel:''}));
  server=await createApp(root,'test',false,{cloudUrl:`http://127.0.0.1:${fake.address().port}/v1`});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${server.address().port}`;
  const call=(path,method,body)=>fetch(url+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  let view=await (await fetch(url+'/api/memory')).json();
  assert.equal(view.growth.level,1);assert.equal(view.questions.length,1);assert.equal(view.topics[0].title,'Работа');

  // The question goes into one answer, then waits a day.
  const chat=text=>call('/api/assistant/chat','POST',{messages:[{role:'user',content:text}],dialog:'dialog-0001'}).then(r=>r.text());
  await chat('Расскажи что-нибудь');
  assert.match(seen.at(-1).messages[0].content,/мягко спроси пользователя: «Вы упоминали «Луна»\. Что это для вас\?»/);
  await chat('И ещё что-нибудь');
  assert.doesNotMatch(seen.at(-1).messages[0].content,/мягко спроси/);
  assert.match(seen.at(-1).messages[0].content,/Твоё общее понимание пользователя:\n\[Сводка модели, может быть устаревшей\] Пока знаю немного\./);

  const question=view.questions[0];
  assert.equal((await call('/api/memory/answer','POST',{id:question.id,text:''})).status,400);
  assert.equal((await call('/api/memory/answer','POST',{id:'nope',text:'что-то'})).status,404);
  view=await (await call('/api/memory/answer','POST',{id:question.id,text:'Так зовут мою собаку'})).json();
  assert.equal(view.questions.length,0);assert.ok(view.items.some(i=>i.text==='Луна: Так зовут мою собаку'));
  assert.equal(view.entities.find(e=>e.name==='Луна').about,'Так зовут мою собаку');

  view=await (await call('/api/memory/items/t1','PATCH',{title:'Работа и карьера',summary:'Дизайнер',category:'work'})).json();
  assert.deepEqual([view.topics[0].title,view.topics[0].summary],['Работа и карьера','Дизайнер']);
  assert.equal((await call('/api/memory/items/t1','PATCH',{title:'x'.repeat(81)})).status,400);
  view=await (await call('/api/memory/items/understanding','PATCH',{text:'Любит собак.'})).json();assert.equal(view.understanding.text,'Любит собак.');
  view=await (await call('/api/memory/items/understanding','DELETE')).json();assert.equal(view.understanding,null);
  assert.equal((await call('/api/memory/items/understanding','DELETE')).status,404);
  view=await (await call('/api/memory/items/t1','DELETE')).json();assert.equal(view.topics.length,0);
});
