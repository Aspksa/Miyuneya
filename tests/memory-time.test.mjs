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
import { emptyMemory, upsert, applyReflection, applySleep, parseReminder, remind, promise, normalizeMemory, reflectInput, sleepInput, ask, answer } from '../server/memory.ts';
import { memoryContext, timeRange, reminderDue } from '../server/recall.ts';

// Thursday, 29 October 2026, in the machine's own time zone.
const now=new Date(2026,9,29,15,0).getTime();
const local=(d,h=0)=>new Date(2026,9,d,h).getTime();
const dialog=(at=new Date(now).toISOString())=>({id:'dialog-0001',messages:[{role:'user',content:'Привет'}],summary:'',updatedAt:at,failures:0,signals:[]});

test('Time words become date ranges', () => {
  const range=text=>{const r=timeRange(text,now);return r&&[r.from,r.to,r.label];};
  assert.deepEqual(range('Что мы обсуждали вчера?'),[local(28),local(29),'вчера']);
  assert.deepEqual(range('позавчера'),[local(27),local(28),'позавчера']);
  assert.deepEqual(range('А в прошлый вторник?'),[local(27),local(28),'в прошлый вторник']);
  assert.deepEqual(range('что было в четверг'),[local(22),local(23),'в четверг']);
  assert.deepEqual(range('Что я говорил на прошлой неделе?'),[local(19),local(26),'на прошлой неделе']);
  assert.deepEqual(range('на этой неделе'),[local(26),now+1,'на этой неделе']);
  assert.deepEqual(range('три дня назад'),[local(25),local(28),'три дня назад']);
  assert.deepEqual(range('в прошлом месяце'),[new Date(2026,8,1).getTime(),local(1),'в прошлом месяце']);
  assert.equal(timeRange('Привет, как дела?',now),null);
  assert.equal(timeRange('Вторник — хороший день',now),null);
});

test('Recall answers «when» questions from the dated memory', () => {
  const memory=emptyMemory();
  memory.episodes.push({id:'e1',date:new Date(local(27,11)).toISOString(),topic:'Обсуждали отпуск',outcome:'Решили ехать в горы',links:[],consolidated:true,score:null,weak:''},
    {id:'e2',date:new Date(local(10,11)).toISOString(),topic:'Выбирали ноутбук',outcome:'',links:[],consolidated:true,score:null,weak:''});
  upsert(memory,'fact','Любит горы',{now:new Date(local(27,12)).toISOString()});
  promise(memory,'Подобрать маршрут',null,'e1',new Date(local(27,12)).toISOString());
  const context=memoryContext(memory,'О чём мы говорили во вторник?',new Map(),now);
  assert.match(context,/Сегодня четверг, 29 октября 2026 г\.; пользователь спрашивает про время «во вторник» \(27 октября\)/);
  assert.match(context,/Что было в это время:\n- 27 октября, разговор: Обсуждали отпуск — Решили ехать в горы\n- 27 октября узнала: Любит горы\n- 27 октября ты пообещала: Подобрать маршрут/);
  assert.doesNotMatch(context.split('Что было')[1].split('\n\n')[0],/ноутбук/);
  assert.match(memoryContext(memory,'Что было вчера?',new Map(),now),/В памяти нет записей за это время/);
  // Time words come from the newest message only.
  assert.match(memoryContext(memory,'Что мы обсуждали вчера?\nА во вторник?',new Map(),now,{latest:'А во вторник?'}),/про время «во вторник»/);
  // A long period is cut to the budget instead of disappearing.
  for(let i=0;i<8;i++) memory.episodes.push({id:'x'+i,date:new Date(local(26,9+i)).toISOString(),topic:'Т'.repeat(200),outcome:'И'.repeat(600),links:[],consolidated:true,score:null,weak:''});
  const long=memoryContext(memory,'Что было на этой неделе?',new Map(),now);
  assert.match(long,/Что было в это время:\n- 26 октября, разговор: Т+/);assert.ok(long.length<=6400);
});

test('Reminders are set from the chat and fire when the talk turns to their topic', () => {
  assert.deepEqual(parseReminder('Напомни, когда заговорим о поездке, что нужно купить адаптер'),{about:'поездке',text:'нужно купить адаптер'});
  assert.deepEqual(parseReminder('напомни мне когда будем обсуждать отпуск — забронировать отель'),{about:'отпуск',text:'забронировать отель'});
  assert.deepEqual(parseReminder('Когда заговорим о Кате, напомни про её день рождения'),{about:'Кате',text:'её день рождения'});
  assert.equal(parseReminder('Напомни купить хлеб'),null);
  // Words that begin like «о», «об» or «про» stay whole.
  assert.deepEqual(parseReminder('Когда заговорим о поездке, напомни проверить билеты'),{about:'поездке',text:'проверить билеты'});
  assert.deepEqual(parseReminder('Напомни, когда заговорим о поездке, оплатить отель'),{about:'поездке',text:'оплатить отель'});
  assert.deepEqual(parseReminder('Напомни, когда заговорим о поездке, об отеле'),{about:'поездке',text:'отеле'});
  const memory=emptyMemory();
  const said='Когда заговорим о Кате, напомни про её день рождения';
  const reminder=remind(memory,'Кате','её день рождения',said);
  assert.equal(remind(memory,'Кате','её день рождения'),null);
  // Not in the message that set it, even though the topic is there.
  assert.ok(!reminderDue(reminder,said,0.9));
  assert.ok(!reminderDue(reminder,said+'\nКак дела?',0.9));
  assert.ok(reminderDue(reminder,'Катя сегодня звонила',null));
  assert.ok(reminderDue({about:'поездке',said:''},'Скоро поездка в Японию',null));
  assert.ok(reminderDue({about:'путешествие',said:''},'Летим в Токио',0.7),'by meaning');
  assert.ok(!reminderDue({about:'путешествие',said:''},'Что на ужин?',0.1));
  assert.match(memoryContext(memory,'Катя сегодня звонила',new Map(),now),/Ты обещала напомнить, когда речь зайдёт о «Кате»\. Напомни сейчас[^\n]*«её день рождения»/);
  assert.doesNotMatch(memoryContext(memory,'Что на ужин?',new Map(),now),/обещала напомнить/);
  assert.equal(normalizeMemory(JSON.parse(JSON.stringify(memory))).reminders[0].said,said);
});

test('Promises and provenance come from reflection and sleep', () => {
  const memory=emptyMemory();const at=new Date(now).toISOString();
  applyReflection(memory,{episode:{topic:'План поездки'},facts:[{text:'Едет в Японию весной',category:'plans'}],
    promises:[{text:'Найти недорогие билеты',due:'2026-11-05'},{text:'Найти недорогие билеты'},{text:''}],reminders:[{about:'бюджет',text:'Учесть стоимость виз'}]},dialog(at),new Set(),at);
  const episode=memory.episodes[0];
  assert.equal(memory.items[0].origin,episode.id);
  assert.equal(memory.promises.length,1);assert.deepEqual([memory.promises[0].due,memory.promises[0].episode],['2026-11-05',episode.id]);
  assert.equal(memory.reminders[0].about,'бюджет');
  assert.match(reflectInput(memory,dialog(at),null),new RegExp(`Твои открытые обещания:\\n\\[${memory.promises[0].id}\\] Найти недорогие билеты`));
  assert.match(memoryContext(memory,'привет',new Map(),now),/Твои открытые обещания пользователю[^\n]*\n- Найти недорогие билеты \(обещала 29 октября; срок до 5 ноября\)/);
  applyReflection(memory,{kept:[memory.promises[0].id]},dialog(at),new Set(),at);
  assert.equal(memory.promises[0].done,at);
  assert.doesNotMatch(memoryContext(memory,'привет',new Map(),now),/открытые обещания/);
  // The sleep closes promises too, and notes and insights keep their source.
  promise(memory,'Проверить расписание поездов',null,null,at);
  assert.match(sleepInput(memory),/Твои открытые обещания:\n\[\w+\] 29 октября: Проверить расписание поездов/);
  applySleep(memory,{kept:[memory.promises[1].id],note_facts:[{text:'Учит японский',note:'n1'}]},now,new Set(['n1']));
  assert.ok(memory.promises[1].done);
  assert.equal(memory.items.find(i=>i.text==='Учит японский').origin,'n1');
  const q=ask(memory,'gap','Кто такой Кэндзи?',{},at);
  applyReflection(memory,{episode:{topic:'Про Кэндзи'},answers:[{question:q.id,text:'Кэндзи — учитель японского'}]},dialog(at),new Set(),at);
  assert.equal(memory.items.find(i=>i.text.startsWith('Кэндзи')).origin,memory.episodes.at(-1).id);
  assert.equal(normalizeMemory(JSON.parse(JSON.stringify(memory))).items[0].origin,episode.id);
  assert.ok(answer);
});

test('Memory over HTTP sets a reminder in chat, fires it later and tracks promises', async t => {
  const root=await mkdtemp(join(tmpdir(),'Miyuneya время '));
  const seen=[];let broken=false;
  const fake=createServer(async(req,res)=>{
    let body='';for await(const c of req)body+=c;
    seen.push(JSON.parse(body||'{}'));
    if(broken){res.writeHead(500,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:{message:'упало'}}));}
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.end(`data: ${JSON.stringify({choices:[{delta:{content:'Хорошо.'}}]})}\n\ndata: [DONE]\n\n`);
  });
  fake.listen(0,'127.0.0.1');await once(fake,'listening');
  let server;
  t.after(async()=>{await server?.shutdown();fake.close();await removeTemp(root);});
  const memory=emptyMemory();promise(memory,'Проверить курс иены',null,null,new Date().toISOString());
  await mkdir(join(root,'data'));
  await writeFile(join(root,'data','workspace.json'),JSON.stringify({revision:0,data:emptyWorkspace()}));
  await writeFile(join(root,'data','memory.json'),JSON.stringify(memory));
  await writeFile(join(root,'data','assistant.json'),JSON.stringify({apiKey:'good-key-123',model:'zeta/model',embedModel:''}));
  server=await createApp(root,'test',false,{cloudUrl:`http://127.0.0.1:${fake.address().port}/v1`});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${server.address().port}`;
  const call=(path,method,body)=>fetch(url+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const chat=messages=>call('/api/assistant/chat','POST',{messages,dialog:'dialog-0001'}).then(r=>r.text()).then(text=>text.trim().split('\n').map(l=>JSON.parse(l)));
  const set='Напомни, когда заговорим о поездке, что нужно купить адаптер';
  const first=await chat([{role:'user',content:set}]);
  assert.ok(first.some(l=>l.memory==='Напомню, когда речь зайдёт о «поездке»'));
  let system=seen.at(-1).messages[0].content;
  assert.match(system,/Ты только что поставила напоминание/);assert.doesNotMatch(system,/Напомни сейчас/);
  assert.match(system,/Твои открытые обещания пользователю[^\n]*\n- Проверить курс иены/);
  await chat([{role:'user',content:set},{role:'assistant',content:'Хорошо.'},{role:'user',content:'Какая погода?'}]);
  assert.doesNotMatch(seen.at(-1).messages[0].content,/Напомни сейчас/);
  // A failed answer does not use up the reminder.
  broken=true;await chat([{role:'user',content:'Давай обсудим поездку в Японию'}]);broken=false;
  assert.match(seen.at(-1).messages[0].content,/Напомни сейчас/);
  assert.equal((await (await fetch(url+'/api/memory')).json()).reminders[0].fired,null);
  await chat([{role:'user',content:'Давай обсудим поездку в Японию'}]);
  assert.match(seen.at(-1).messages[0].content,/когда речь зайдёт о «поездке»\. Напомни сейчас[^\n]*«нужно купить адаптер»/);
  let view=await (await fetch(url+'/api/memory')).json();
  assert.ok(view.reminders[0].fired);
  await chat([{role:'user',content:'Ещё про поездку'}]);
  assert.doesNotMatch(seen.at(-1).messages[0].content,/Напомни сейчас/,'a reminder fires once');

  assert.equal((await call('/api/memory/reminders','POST',{about:'',text:'x'})).status,400);
  view=await (await call('/api/memory/reminders','POST',{about:'бюджет',text:'Сверить счета'})).json();
  assert.equal(view.reminders[0].about,'бюджет');
  view=await (await call('/api/memory/items/'+view.reminders.at(-1).id,'PATCH',{text:'нужно купить адаптер'})).json();
  assert.equal(view.reminders.find(x=>x.about==='поездке').fired,null,'editing re-arms it');
  const kept=view.promises[0];
  assert.equal((await call('/api/memory/items/'+kept.id,'PATCH',{done:'да'})).status,400);
  view=await (await call('/api/memory/items/'+kept.id,'PATCH',{done:true})).json();assert.ok(view.promises[0].done);
  view=await (await call('/api/memory/items/'+kept.id,'PATCH',{done:false,until:'2026-12-01'})).json();assert.deepEqual([view.promises[0].done,view.promises[0].due],[null,'2026-12-01']);
  view=await (await call('/api/memory/items/'+kept.id,'DELETE')).json();assert.equal(view.promises.length,0);
});
