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
import { emptyMemory, upsert, addCause, addGoal, nextSteps, stepDone, goalTree, predict, check, mistake, applyThinking, applyReflection, applySleep, thinkInput, reflectInput, normalizeMemory } from '../server/memory.ts';
import { memoryContext } from '../server/recall.ts';
import { growth } from '../server/growth.ts';
import { calculate, exactCalcs, complexity, parseGoal, readPlan, reasoningBlock, runCalc, parseDate } from '../server/logic.ts';

// Thursday, 29 October 2026, in the machine's own time zone.
const now=new Date(2026,9,29,15,0).getTime();const at=new Date(now).toISOString();
const dialog={id:'dialog-0001',messages:[{role:'user',content:'Посчитай бюджет'}],summary:'',updatedAt:at,failures:0,signals:[]};

test('Code counts sums, percents and dates exactly', () => {
  assert.equal(calculate('2+2*2'),6);assert.equal(calculate('(1 200,5 + 300) * 2'),3001);
  assert.equal(calculate('1000 + 15%'),1150);assert.equal(calculate('1000 - 10%'),900);assert.equal(calculate('2^10'),1024);
  assert.equal(calculate('7 x 8'),56);assert.equal(calculate('3х4'),12);
  for (const bad of ['1/0','abc','2+','(1+2','']) assert.equal(calculate(bad),null,bad);
  assert.deepEqual(exactCalcs('Сколько будет 1200*3 + 450?',now),['1200*3 + 450 = 4 050']);
  assert.deepEqual(exactCalcs('сумма 3 500 + 1 250 + 980',now),['3 500 + 1 250 + 980 = 5 730']);
  assert.deepEqual(exactCalcs('15% от 2400 это сколько?',now),['15% от 2400 = 360']);
  assert.deepEqual(exactCalcs('Сколько дней до 31 декабря?',now),['От 29 октября 2026 (четверг) до 31 декабря 2026 (четверг): 63 дня (≈ 9 нед.)']);
  assert.deepEqual(exactCalcs('Сколько рабочих дней между 1 ноября и 30 ноября?',now)[1],'Из них рабочих (пн–пт): 21');
  assert.deepEqual(exactCalcs('Что будет через 45 дней?',now),['Сегодня 29 октября 2026 (четверг); через 45 дн. будет 13 декабря 2026 (воскресенье)']);
  assert.deepEqual(exactCalcs('Какой день недели 8 марта?',now),['2027-03-08 — понедельник']);
  // Dates, times, phone numbers and ranges are not arithmetic.
  assert.deepEqual(exactCalcs('Встреча 2026-11-03 в 10:30, телефон +7 914 123-45-67, отпуск 10-15 ноября',now),[]);
  assert.equal(runCalc({op:'add',date:'2026-10-29',days:100},now),'29 октября 2026 (четверг) + 100 дней = 6 февраля 2027 (суббота)');
  assert.equal(runCalc({op:'math',expr:'process.exit()'},now),null);
  // A dotted number with a unit is a quantity, and tiny results never round to zero.
  assert.deepEqual(exactCalcs('Сколько дней в 1.5 недели?',now),[]);
  assert.match(exactCalcs('Сколько дней до 31.12?',now)[0],/: 63 дня/);
  assert.equal(runCalc({op:'math',expr:'1/10000000'},now),'1/10000000 = 1e-7');
  assert.deepEqual(exactCalcs('Посчитай 0.0001 * 0.0001',now),['0.0001 * 0.0001 = 1e-8']);
  assert.equal(parseDate('31.02',now),null);assert.equal(parseDate('1 мая',now).getFullYear(),2027);
});

test('Complex questions get a plan, hypotheses and the numbers from code', () => {
  assert.equal(complexity('Привет! Как дела?').complex,false);
  assert.equal(complexity('Почему я так устаю по вечерам?').complex,true);
  assert.equal(complexity('Что лучше выбрать: японский или английский, если у меня 5 часов в неделю?').complex,true);
  assert.equal(parseGoal('Разложи мою цель «выучить японский до N4» на шаги'),'выучить японский до N4');
  assert.equal(parseGoal('разбей на шаги ремонт кухни'),'ремонт кухни');
  assert.equal(parseGoal('Спланируй цель: переезд в Москву'),'переезд в Москву');
  assert.equal(parseGoal('составь план ответа'),null);assert.equal(parseGoal('Какая у тебя цель?'),null);
  const plan=readPlan({steps:['Вспомнить, когда он устаёт','Связать со сном'],hypotheses:[{text:'Поздно ложится',confidence:60},{text:'Много встреч',confidence:0.4}],calc:[{op:'math',expr:'7*8'},{op:'days',from:'2026-10-29',to:'2026-11-08'},{op:'rm -rf'}],check:'Не путать усталость с ленью'},now);
  assert.deepEqual(plan.hypotheses.map(h=>h.confidence),[60,40]);
  assert.deepEqual(plan.lines,['7*8 = 56','От 29 октября 2026 (четверг) до 8 ноября 2026 (воскресенье): 10 дней']);
  const block=reasoningBlock(true,plan,['1+1 = 2']);
  assert.match(block,/Подумай по шагам/);assert.match(block,/2–3 гипотезы с уверенностью в процентах/);
  assert.match(block,/скрытый план[^\n]*\n1\. Вспомнить/);assert.match(block,/- Поздно ложится — 60%/);
  assert.match(block,/Точные расчёты, сделанные кодом[^\n]*\n- 1\+1 = 2\n- 7\*8 = 56/);
  assert.equal(reasoningBlock(false,null,[]),'');
  assert.equal(readPlan(null),null);assert.equal(readPlan({steps:[]}),null);
});

test('Causes, goals, predictions and the errors journal live in memory', () => {
  const memory=emptyMemory();
  const c=addCause(memory,'Поздние встречи','Тяжёлое утро',70,['e1'],at);
  assert.equal(addCause(memory,'Поздние встречи по работе','Тяжёлое утро на следующий день',60,['e2'],at),c);
  assert.deepEqual([c.hits,c.confidence,c.evidence],[2,75,['e1','e2']]);
  const goal=addGoal(memory,'Переезд',[{id:'s1',text:'Найти квартиру'},{id:'s2',text:'Посмотреть объявления',parent:'s1'},{id:'s3',text:'Собрать вещи',after:['s1','s9']},{id:'s4',text:'Перевезти',after:['s3','s4']},{text:''}],at);
  assert.equal(goal.steps.length,4);
  const [find,look,pack,move]=goal.steps;
  assert.equal(look.parent,find.id);assert.deepEqual(pack.after,[find.id]);assert.deepEqual(move.after,[pack.id],'no self or unknown dependencies');
  assert.deepEqual(nextSteps(goal).map(s=>s.text),['Посмотреть объявления'],'a step with open smaller steps waits');
  stepDone(memory,goal,look.id,true,at);stepDone(memory,goal,find.id,true,at);
  assert.deepEqual(nextSteps(goal).map(s=>s.text),['Собрать вещи']);
  assert.match(goalTree(goal),/^- \[готово\] Найти квартиру\n  - \[готово\] Посмотреть объявления\n- Собрать вещи \(после: Найти квартиру\)/);
  for (const s of goal.steps) stepDone(memory,goal,s.id,true,at);
  assert.ok(goal.done);stepDone(memory,goal,move.id,false,at);assert.equal(goal.done,null);
  // A child after its own parent, or after a step that waits for that parent, would deadlock: such a dependency is dropped.
  const knot=addGoal(memory,'Узел',[{id:'p',text:'Большой шаг'},{id:'q',text:'После большого',after:['p']},{id:'c',text:'Часть большого',parent:'p',after:['p']},{id:'d',text:'Ещё часть',parent:'p',after:['q']}],at);
  assert.deepEqual(knot.steps.map(s=>s.after.length),[0,1,0,0]);
  assert.deepEqual(nextSteps(knot).map(s=>s.text),['Часть большого','Ещё часть']);
  memory.goals=memory.goals.filter(g=>g!==knot);
  assert.equal(addGoal(memory,'Переезд',[{text:'Заново'}],at),goal,'the same open goal is planned again, not twice');
  // A prediction that fails becomes an error with a rule.
  const p=predict(memory,{text:'В пятницу он попросит план выходных',kind:'habit',confidence:70,due:'2026-10-30'},at);
  assert.equal(predict(memory,{text:'В пятницу он попросит план выходных'},at),null);
  assert.ok(check(memory,p.id,'wrong','Не попросил','Не делать прогноз по одной неделе',at));
  assert.equal(check(memory,p.id,'right'),false,'checked once');
  const m=memory.mistakes[0];
  assert.equal(m.kind,'prediction');assert.equal(memory.items.find(i=>i.id===m.rule).source,'logic');
  assert.ok(check(memory,predict(memory,{text:'Он выберет горы',kind:'cause',confidence:80},at).id,'right','',''));
  assert.equal(mistake(memory,{kind:'calc',text:'Сложила суммы неверно',fix:'Суммы считать кодом'},null,at).kind,'calc');
  const l=growth(memory,now).logic;
  assert.deepEqual([l.predictions.checked,l.predictions.right,l.predictions.accuracy,l.conclusions.right,l.conclusions.total,l.conclusions.share,l.corrections,l.fixed],[2,1,50,2,3,67,2,2]);
  assert.deepEqual(l.kinds,[{kind:'cause',checked:1,right:1},{kind:'habit',checked:1,right:0}]);
  // Everything survives a restart; a hand-made loop in a goal is cut.
  const raw=JSON.parse(JSON.stringify(memory));
  raw.goals[0].steps.push({id:'loop',text:'Петля',parent:'loop',after:['loop']});raw.goals[0].steps[0].after=['loop'];
  const restored=normalizeMemory(raw);
  assert.deepEqual([restored.causes.length,restored.goals[0].steps.length,restored.predictions.length,restored.mistakes.length],[1,2,2,2]);
  assert.deepEqual(restored.goals[0].steps.map(s=>[s.parent,s.after]),[[null,[]],[null,[]]]);
  assert.equal(restored.items.find(i=>i.id===m.rule).source,'logic');
  // Recall brings matching causes and the next steps of goals into the answer.
  stepDone(memory,goal,goal.steps[0].id,false,at);
  const context=memoryContext(memory,'Почему у меня тяжёлое утро после встреч?',new Map(),now);
  assert.match(context,/Причины и следствия из жизни пользователя[^\n]*\n- Поздние встречи → Тяжёлое утро \(уверенность 75%\)/);
  assert.match(context,/Цели пользователя[^\n]*\n- Переезд: сделано 0 из 1; можно сейчас: Заново/);
});

test('Thinking trains logic; reflection and sleep feed it', () => {
  const memory=emptyMemory();
  const fact=upsert(memory,'fact','Работает по вечерам',{now:at}).item;
  const old=predict(memory,{text:'Он перенесёт созвон на вечер',kind:'pattern',confidence:60,due:'2026-10-28'},at);
  const input=thinkInput(memory,null,now);
  assert.match(input,new RegExp(`\\[${old.id}\\] Он перенесёт созвон на вечер \\(pattern, 60%, сделан 29 октября, срок прошёл — проверь\\)`));
  assert.match(input,/Точность твоих рассуждений по типам: прогнозов ещё не проверяли/);
  // An overdue prediction stays on the list however many newer ones there are.
  for (let i=0;i<20;i++) predict(memory,{text:`Новый прогноз номер ${i} про отдельную тему ${'абвгдежзиклмнопрстуф'[i]}`,due:'2026-11-10'},new Date(now+i*1000).toISOString());
  assert.match(thinkInput(memory,null,now),new RegExp(`\\[${old.id}\\]`));
  memory.predictions=memory.predictions.filter(p=>p===old);
  applyThinking(memory,{thoughts:[],checks:[{id:old.id,outcome:'right',note:'перенёс'}],predictions:[{text:'Вечером он спросит про задачи',kind:'habit',confidence:65,due:'2026-11-02'},{text:'',kind:'cause'}],
    causes:[{cause:'Работает по вечерам',effect:'Утром отвечает позже',confidence:60,evidence:[fact.id,'чужой']}]},now);
  assert.equal(memory.predictions.find(p=>p.id===old.id).outcome,'right');
  assert.equal(memory.predictions.filter(p=>!p.outcome).length,1);
  assert.deepEqual(memory.causes[0].evidence,[fact.id]);
  assert.match(thinkInput(memory,null,now),/закономерность \(pattern\): 1 из 1, 100%/);
  const open=memory.predictions.find(p=>!p.outcome);
  const goal=addGoal(memory,'Выучить японский',[{id:'s1',text:'Хирагана'}],at);
  assert.match(reflectInput(memory,dialog,null),new RegExp(`Твои непроверенные прогнозы:\\n\\[${open.id}\\]`));
  assert.match(reflectInput(memory,dialog,null),/Цели пользователя:\n\[\w+\] Выучить японский: \[\w+\] Хирагана/);
  applyReflection(memory,{episode:{topic:'Бюджет'},logic_errors:[{kind:'calc',text:'Неверно сложила расходы',fix:'Суммы проверять кодом'}],checks:[{id:open.id,outcome:'wrong',note:'не спросил'}],
    causes:[{cause:'Большие траты',effect:'Тревога',confidence:55}],goals:[{title:'Накопить на отпуск',steps:[{id:'s1',text:'Завести копилку'},{id:'s2',text:'Посчитать бюджет'}]}],steps_done:[{goal:goal.id,step:goal.steps[0].id}]},dialog,new Set(),at);
  assert.deepEqual(memory.mistakes.map(m=>m.kind).sort(),['calc','prediction']);
  assert.ok(memory.items.some(i=>i.kind==='rule'&&i.source==='logic'&&i.text==='Суммы проверять кодом'));
  assert.equal(memory.causes.at(-1).evidence[0],memory.episodes[0].id);
  assert.ok(goal.done);assert.equal(memory.goals.length,2);
  // Talking about a known goal again does not wipe its progress; an explicit replanning keeps what is done.
  const trip=memory.goals.find(g=>g.title==='Накопить на отпуск');stepDone(memory,trip,trip.steps[0].id,true,at);
  applyReflection(memory,{goals:[{title:'Накопить на отпуск',steps:[{id:'s1',text:'Совсем другой план'}]}]},dialog,new Set(),at);
  assert.deepEqual(trip.steps.map(s=>[s.text,!!s.done]),[['Завести копилку',true],['Посчитать бюджет',false]]);
  addGoal(memory,'Накопить на отпуск',[{id:'a',text:'Завести копилку'},{id:'b',text:'Откладывать 10%'}],at);
  assert.deepEqual(trip.steps.map(s=>[s.text,!!s.done]),[['Завести копилку',true],['Откладывать 10%',false]]);
  applySleep(memory,{causes:[{cause:'Большие траты',effect:'Тревога',confidence:70,evidence:[memory.episodes[0].id]},{cause:'Без доказательств',effect:'Не сохраняется',evidence:['нет']}]},now);
  assert.deepEqual([memory.causes.length,memory.causes.at(-1).hits],[2,2]);
});

test('Chat routes hard questions to the stronger model with a plan and exact numbers', async t => {
  const root=await mkdtemp(join(tmpdir(),'Miyuneya логика '));
  const seen=[];
  const fake=createServer(async(req,res)=>{
    let body='';for await(const c of req)body+=c;
    const json=JSON.parse(body||'{}');seen.push(json);
    const system=json.messages?.[0]?.content||'';
    const reply=content=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',content}}]}));};
    if(system.includes('планировщик рассуждений')) return reply(JSON.stringify({steps:['Сравнить стоимость','Учесть бюджет'],hypotheses:[{text:'Выгоднее первый',confidence:70}],calc:[{op:'math',expr:'12000*3'}],check:'Не забыть доставку'}));
    if(system.includes('модуль планирования')) return reply(JSON.stringify({title:/Цель пользователя: ремонт ванной/i.test(json.messages[1].content)?'Ремонт ванной':'Ремонт кухни',steps:[{id:'s1',text:'Замерить кухню'},{id:'s2',text:'Выбрать мебель',after:['s1']}]}));
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.end(`data: ${JSON.stringify({choices:[{delta:{content:'Готово.'}}]})}\n\ndata: [DONE]\n\n`);
  });
  fake.listen(0,'127.0.0.1');await once(fake,'listening');
  let server;
  t.after(async()=>{await server?.shutdown();fake.close();await removeTemp(root);});
  await mkdir(join(root,'data'));
  await writeFile(join(root,'data','workspace.json'),JSON.stringify({revision:0,data:emptyWorkspace()}));
  await writeFile(join(root,'data','assistant.json'),JSON.stringify({apiKey:'good-key-123',model:'fast/model',embedModel:''}));
  const saved=emptyMemory();const guess=predict(saved,{text:'Он выберет кухню подешевле',kind:'plan',confidence:60});
  await writeFile(join(root,'data','memory.json'),JSON.stringify(saved));
  server=await createApp(root,'test',false,{cloudUrl:`http://127.0.0.1:${fake.address().port}/v1`,memoryTickMs:3_600_000});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${server.address().port}`;
  const call=(path,method,body)=>fetch(url+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const chat=async content=>(await call('/api/assistant/chat','POST',{messages:[{role:'user',content}]})).text();

  assert.equal((await call('/api/assistant','PUT',{smartModel:'bad model'})).status,400);
  assert.equal((await (await call('/api/assistant','PUT',{smartModel:'smart/model'})).json()).smartModel,'smart/model');
  // A simple question goes straight to the fast model.
  let lines=(await chat('Привет!')).trim().split('\n').map(l=>JSON.parse(l));
  assert.equal(seen.length,1);assert.equal(seen[0].model,'fast/model');assert.doesNotMatch(seen[0].messages[0].content,/Подумай по шагам/);
  assert.deepEqual(lines.at(-1),{done:true,model:'fast/model'});
  // A hard one is planned first, then answered by the stronger model with the plan and the code's numbers.
  lines=(await chat('Что лучше выбрать: кухню за 12000*3 или за 40 000 рублей, и почему?')).trim().split('\n').map(l=>JSON.parse(l));
  const [planner,answer]=seen.slice(1);
  assert.equal(planner.model,'smart/model');assert.equal(planner.stream,false);assert.match(planner.messages[1].content,/Что лучше выбрать/);
  assert.equal(answer.model,'smart/model');
  const system=answer.messages[0].content;
  assert.match(system,/скрытый план[^\n]*\n1\. Сравнить стоимость\n2\. Учесть бюджет/);
  assert.match(system,/- Выгоднее первый — 70%/);assert.match(system,/Проверь перед ответом: Не забыть доставку/);
  assert.match(system,/Точные расчёты, сделанные кодом[^\n]*\n- 12000\*3 = 36 000/);
  assert.deepEqual(lines.at(-1),{done:true,model:'smart/model',reasoning:true,planned:true,exact:1});
  // «Разложи цель …» builds a tree of steps before the answer.
  lines=(await chat('Разложи цель ремонт кухни на шаги')).trim().split('\n').map(l=>JSON.parse(l));
  assert.deepEqual(lines[0],{memory:'Цель разложена на шаги: Ремонт кухни'});
  assert.match(seen.at(-1).messages[0].content,/разложила цель «Ремонт кухни»[^\n]*\n- Замерить кухню\n- Выбрать мебель \(после: Замерить кухню\)/);
  let view=await (await fetch(url+'/api/memory')).json();
  const goal=view.goals[0];
  assert.deepEqual([goal.title,goal.steps.length,goal.next.length],['Ремонт кухни',2,1]);
  view=await (await call('/api/memory/items/'+goal.id,'PATCH',{step:goal.steps[0].id,done:true})).json();
  assert.deepEqual(view.goals[0].next,[goal.steps[1].id]);
  assert.equal((await call('/api/memory/items/'+goal.id,'PATCH',{step:'нет-такого',done:true})).status,404);
  assert.equal((await call('/api/memory/goals','POST',{title:''})).status,400);
  view=await (await call('/api/memory/goals','POST',{title:'Ремонт ванной'})).json();assert.equal(view.goals.length,2);
  // The user may mark a prediction; a failed one goes to the errors journal.
  assert.equal((await call('/api/memory/items/'+guess.id,'PATCH',{result:'maybe'})).status,400);
  view=await (await call('/api/memory/items/'+guess.id,'PATCH',{result:'wrong'})).json();
  assert.deepEqual([view.predictions[0].outcome,view.predictions[0].note,view.mistakes.length,view.growth.logic.predictions.accuracy],['wrong','отметил пользователь',1,0]);
  assert.equal((await call('/api/memory/items/'+guess.id,'PATCH',{result:'right'})).status,404);
  view=await (await call('/api/memory/items/'+view.mistakes[0].id,'DELETE')).json();assert.equal(view.mistakes.length,0);
});
