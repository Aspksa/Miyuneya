import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { removeTemp } from './helpers/lifecycle.mjs';
import { emptyMemory, openMemory, upsert, addCause, predict, check, applyThinking, applyReflection, applySleep, normalizeMemory, sleepBatch, changedNotes, forget, memoryContext } from '../server/memory.ts';
import { compatible, strictDate, evidence, reviewAnswer, memoryResult, digest } from '../server/integrity.ts';
import { today, expired } from '../server/recall.ts';
import { logic } from '../server/growth.ts';
import { parseDate, isoDate, exactCalcs, complexity } from '../server/logic.ts';
import { createApp } from '../server/app.ts';
import { emptyWorkspace } from '../src/model.ts';
const at='2026-10-30T00:00:00.000Z';
const note=(id,body)=>({id,title:'Документ '+id,body,updatedAt:at});
async function store(t,options={}) {
  const root=await mkdtemp(join(tmpdir(),'Miyuneya-integrity-'));
  const m=await openMemory(root,{ask:async()=>'{"note_facts":[]}',available:()=>true,workspace:()=>null,tickMs:1e9,...options});
  t.after(async()=>{await m.shutdown();await removeTemp(root);});return {m,root};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('Negations and changed numbers stay distinct; explicit changes retain history across restart',()=>{
  const m=emptyMemory();const old=upsert(m,'fact','Пользователь любит кофе',{source:'user',now:at}).item;
  upsert(m,'fact','Пользователь не любит кофе',{source:'user',now:at});
  assert.equal(m.items.length,2);assert.equal(old.status,'superseded');assert.equal(old.hits,1);
  assert.equal(m.history[0].before,'Пользователь любит кофе');
  const a=upsert(m,'fact','Бюджет покупки 5000 рублей').item;upsert(m,'fact','Бюджет покупки 9000 рублей');
  assert.equal(a.status,'contested');assert.ok(m.questions.some(q=>q.kind==='conflict'));
  assert.equal(normalizeMemory(JSON.parse(JSON.stringify(m))).history.length,1);
  assert.doesNotMatch(memoryContext(m,'кофе'),/- Пользователь любит кофе/);
});

test('Evidence accepts exact source/version/quote and rejects fabricated quotes or assistant claims',()=>{
  const sources=[{source:'note-1',version:'v1',text:'Пользователь работает архитектором.',at,role:'note'}];
  const value=[{source:'note-1',version:'v1',quote:'работает архитектором'}];
  assert.equal(evidence(value,sources).length,1);
  assert.equal(evidence([{...value[0],version:'v2'}],sources).length,0);
  assert.equal(evidence([{...value[0],quote:'работает врачом'}],sources).length,0);
  assert.equal(evidence(value,[{...sources[0],role:'assistant'}]).length,0);
  const m=emptyMemory(),dialog={id:'dialog-source',messages:[{role:'user',content:'Пользователь работает архитектором.'}],updatedAt:at,signals:[],summary:'',failures:0};
  applyReflection(m,{facts:[{text:'Пользователь работает архитектором',evidence:[{source:'dialog-source-0',quote:'Пользователь работает архитектором.'}]}]},dialog,new Set(),at);
  assert.equal(m.items[0].evidence[0].role,'user');assert.equal(m.items[0].status,'active');
  assert.equal(normalizeMemory(JSON.parse(JSON.stringify(m))).items[0].evidence.length,1);
});

test('Unrelated quotes, model weakening and sleep merges cannot silently rewrite user-confirmed facts',()=>{
  const m=emptyMemory(),old=upsert(m,'fact','Пользователь любит кофе',{source:'user',pinned:true}).item;
  const other=upsert(m,'fact','Пользователь любит чай',{source:'user'}).item;
  const dialog={id:'dialog-correction',messages:[{role:'user',content:'Пользователь любит кофе'}],summary:'',signals:[],updatedAt:at,failures:0};
  applyReflection(m,{facts:[{text:'Пользователь не любит кофе',conflicts:old.id,evidence:[{source:'dialog-correction-0',quote:'Пользователь любит кофе'}]}],weaken:[old.id]},dialog,new Set(),at);
  assert.equal(old.pinned,true);assert.equal(old.status,'active','an unverified candidate cannot demote a user-confirmed fact');
  assert.equal(m.history?.length||0,0,'an unsupported correction cannot replace the old version');
  applySleep(m,{merge:[{ids:[old.id,other.id],text:'Пользователь любит крепкие напитки'}]});
  assert.ok(m.items.includes(old));assert.ok(m.items.includes(other));
});

test('Pinning is explicit confirmation and chat started before a privacy change is not recorded',async t=>{
  const {m}=await store(t);const rule=upsert(m.data,'rule','Задачи формулировать коротко',{source:'thought'}).item;
  assert.doesNotMatch(await m.context('задачи'),/\n- Задачи формулировать коротко/);
  await m.edit(rule.id,{pinned:true});assert.match(await m.context('задачи'),/\n- Задачи формулировать коротко/);
  assert.equal(rule.evidence[0].role,'user');
  const generation=m.generation;await m.settings({private:true});await m.settings({private:false});
  await m.record('dialog-old-chat',[{role:'user',content:'Личная информация из старого запроса'}],'',generation);
  assert.equal(m.data.dialogs.length,0);
});

test('Malformed JSON/schema never acknowledges notes or discards dialogs, including after three failures',async t=>{
  let response='broken';const workspace={notes:[note('n1','Заметка')],tasks:[]};
  const {m}=await store(t,{ask:async()=>response,workspace:()=>workspace});
  await m.record('dialog-failure',[{role:'user',content:'Важная информация для повторной обработки'}],'');
  for(let i=0;i<3;i++)await assert.rejects(m.close('dialog-failure'),/JSON/);
  assert.equal(m.data.dialogs.length,1);assert.equal(m.data.marks.length,0);
  response='{"note_facts":"wrong type"}';await assert.rejects(m.sleepNow(),/схема/);
  assert.equal(changedNotes(m.data,workspace).length,1);assert.equal(m.data.lastSleep,null);
  assert.equal(Object.keys(m.data.noteProgress||{}).length,0);
  response='{"facts":[]}';await m.close('dialog-failure');assert.equal(m.data.dialogs.length,0);
  for(const bad of [null,[],{},true,{facts:'oops'}])assert.throws(()=>memoryResult(bad,'reflect'));
});

test('Long notes are fully covered with persisted fragment progress and content hashes, even with full memory',async t=>{
  const workspace={notes:[note('long','а'.repeat(99970)+' КОНЕЦ_ДОКУМЕНТА')],tasks:[]};let inputs=[];
  const {m,root}=await store(t,{workspace:()=>workspace,ask:async(s,input)=>{inputs.push(input);return '{"note_facts":[]}';}});
  m.data.items=Array.from({length:600},(_,i)=>({id:'f'+i,kind:'fact',text:('Длинная запись '+i).padEnd(400,'я'),weight:0.5,hits:1,created:at,seen:at,pinned:false,source:'dialog',links:[],category:'other',until:null,origin:null}));
  const batch=sleepBatch(m.data,workspace);assert.ok(batch.input.length<=80000);assert.ok(batch.input.includes('[long]'));
  await m.sleepNow();assert.ok(m.data.noteProgress.long.offset>0);assert.equal(m.data.noteVersions.long,undefined);
  const restored=normalizeMemory(JSON.parse(await readFile(join(root,'memory.json'),'utf8')));
  assert.equal(restored.noteProgress.long.offset,m.data.noteProgress.long.offset);
  for(let i=0;i<30&&changedNotes(m.data,workspace).length;i++)await m.sleepNow();
  assert.equal(changedNotes(m.data,workspace).length,0);assert.ok(inputs.some(s=>s.includes('КОНЕЦ_ДОКУМЕНТА')));
  workspace.notes[0].body+=' ИЗМЕНЕНО';assert.equal(changedNotes(m.data,workspace).length,1,'same timestamp does not hide an edit');
});

test('Editing a note during analysis does not acknowledge its newer content',async t=>{
  const gate=deferred(),started=deferred(),workspace={notes:[note('n','Первая версия')],tasks:[]};
  const {m}=await store(t,{workspace:()=>workspace,ask:async()=>{started.resolve();return gate.promise;}});
  const work=m.sleepNow();await started.promise;workspace.notes[0].body='Новая версия';gate.resolve('{"note_facts":[]}');await work;
  assert.equal(changedNotes(m.data,workspace).length,1);assert.equal(m.data.noteVersions.n,undefined);
});

for(const action of ['private','disabled','reset','forget'])test('In-flight reflection cannot repopulate memory after '+action,async t=>{
  const gate=deferred(),started=deferred();const {m}=await store(t,{ask:async()=>{started.resolve();return gate.promise;}});
  await m.record('dialog-race',[{role:'user',content:'Пользователь живёт в Артёме'}],'');
  const work=m.close('dialog-race');const rejected=assert.rejects(work,/отменена/);await started.promise;
  if(action==='private')await m.settings({private:true});else if(action==='disabled')await m.settings({enabled:false});else if(action==='reset')await m.reset();else await m.forget('Артём');
  gate.resolve('{"facts":[{"text":"Пользователь живёт в Артёме"}]}');await rejected;assert.equal(m.data.items.length,0);
});

test('Forget invalidates derived knowledge and hashed suppression stops automatic re-learning',()=>{
  const m=emptyMemory();const fact=upsert(m,'fact','Пользователь живёт в Артёме',{source:'user'}).item;
  upsert(m,'fact','Работа находится рядом с домом',{links:[fact.id]});upsert(m,'fact','Любит чай');
  m.understanding={text:'Живёт в Артёме',updated:at};m.topics=[{id:'t',title:'Дом',area:'personal',summary:'Живёт в Артёме',facts:[fact.id],created:at,updated:at}];
  forget(m,'Артём');assert.equal(m.understanding,null);assert.equal(m.topics.length,0);assert.equal(m.items.length,1);
  assert.equal(upsert(m,'fact','Пользователь живёт в Артёме'),null);assert.doesNotMatch(memoryContext(m,'Где я живу?'),/Артём/);
  assert.doesNotMatch(JSON.stringify(m),/Артём/);assert.ok(normalizeMemory(m).forgotten.length);
});

test('Repetition does not inflate causal certainty; model checks require a new user quote',()=>{
  const m=emptyMemory();const c=addCause(m,'Поздние встречи','Тяжёлое утро',50,['e1']);for(let i=0;i<10;i++)addCause(m,c.cause,c.effect,99,['e1']);
  assert.equal(c.hits,1);assert.equal(c.confidence,50);assert.equal(logic(m).conclusions.total,0);
  const p=predict(m,{text:'Пользователь купил ноутбук',confidence:80},at);
  applyThinking(m,{checks:[{id:p.id,outcome:'right'}]});assert.equal(p.outcome,null);
  const proof={source:'user-event',version:'v1',quote:'Пользователь купил ноутбук',at,role:'user'};
  assert.equal(check(m,p.id,'right','', '',at,[proof]),true);assert.equal(logic(m).predictions.accuracy,100);
  const old=normalizeMemory({...emptyMemory(),predictions:[{...p,verification:undefined}]});assert.equal(logic(old).predictions.checked,0,'legacy self-ratings are not verified outcomes');
  assert.equal(logic(m).quality.independent,false);assert.equal(logic(m).quality.brier,0.04);
});

test('Local midnight, impossible dates, month boundaries and short reasoning requests',()=>{
  const now=new Date(2026,9,30,1).getTime();assert.equal(today(now),'2026-10-30');assert.equal(expired({until:'2026-10-29'},now),true);
  for(const bad of ['2026-02-31','2026-13-01','2026-00-01','2026-01-00']){assert.equal(strictDate(bad),false);assert.equal(parseDate(bad,now),null);}
  assert.equal(strictDate('2028-02-29'),true);assert.equal(isoDate(parseDate('1.12.2026',now)),'2026-12-01');
  assert.match(exactCalcs('Что будет через 1 месяц?',new Date(2026,0,31).getTime())[0],/28 февраля/);
  assert.equal(complexity('Почему я устаю?').complex,true);
});

test('Answer verification fails closed on unknown, changed versions, contradictions and uncovered claims',()=>{
  const draft='Пользователь любит чай.',source={source:'n',version:'v1',text:draft,quote:'',role:'note',at};
  const result={claims:[{text:draft,verdict:'supported',evidence:[{source:'n',version:'v1',quote:draft}]}]};
  assert.equal(reviewAnswer(draft,result,[source],true).status,'supported');
  assert.notEqual(reviewAnswer(draft,result,[{...source,version:'v2'}],true).status,'supported');
  assert.notEqual(reviewAnswer('Пользователь не любит чай.',{claims:[{...result.claims[0],text:'Пользователь не любит чай.'}]},[source],true).status,'supported');
  assert.notEqual(reviewAnswer(draft,null,[source],true).status,'supported');
  assert.notEqual(reviewAnswer(draft+' Выдуманное утверждение.'.repeat(20),result,[source],true).status,'supported');
  assert.notEqual(reviewAnswer(draft+' Он врач.',result,[source],true).status,'supported');
});

test('HTTP checks the complete personal answer before emitting it and refuses unsupported claims',async t=>{
  const root=await mkdtemp(join(tmpdir(),'Miyuneya-answer-review-'));let answer='Пользователь работает врачом.',approve=false,seen=[];
  const fake=createServer(async(req,res)=>{let text='';for await(const b of req)text+=b;const input=JSON.parse(text);seen.push(input);
    const system=input.messages[0].content;let content;
    if(system.includes('проверяешь черновик')){const task=JSON.parse(input.messages[1].content);const source=task.sources.find(s=>s.text==='Пользователь работает архитектором.');content=JSON.stringify({claims:[{text:answer,verdict:approve?'supported':'unknown',evidence:source?[{source:source.source,version:source.version,quote:source.text}]:[]}]});}
    else content=answer;
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content}}]}));
  });fake.listen(0,'127.0.0.1');await once(fake,'listening');
  await mkdir(join(root,'data'));await writeFile(join(root,'data','assistant.json'),JSON.stringify({apiKey:'test-key-only',model:'test/model',embedModel:''}));
  const memory=emptyMemory();upsert(memory,'fact','Пользователь работает архитектором.',{source:'user'});await writeFile(join(root,'data','memory.json'),JSON.stringify(memory));
  const app=await createApp(root,'test',false,{cloudUrl:`http://127.0.0.1:${fake.address().port}/v1`,memoryTickMs:1e9});app.listen(0,'127.0.0.1');await once(app,'listening');
  t.after(async()=>{await app.shutdown();await new Promise(r=>fake.close(r));await removeTemp(root);});
  const ask=async()=>{const r=await fetch(`http://127.0.0.1:${app.address().port}/api/assistant/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'Кем я работаю?'}]})});return r.text();};
  let output=await ask();assert.doesNotMatch(output,/работает врачом/);assert.match(output,/Не могу подтвердить/);assert.match(output,/"verification":"blocked"/);
  approve=true;answer='Пользователь работает архитектором.';output=await ask();assert.match(output,/работает архитектором/);assert.match(output,/"verification":"supported"/);
  assert.ok(seen.filter(s=>s.messages[0].content.includes('проверяешь черновик')).length===2);
});

test('Evidence-backed confirmation learns from a longer reply without trusting unrelated or assistant quotes',()=>{
  const m=emptyMemory(),fact=upsert(m,'fact','Любит чай',{source:'dialog',now:at}).item;
  const dialog={id:'dialog-confirm',messages:[{role:'user',content:'Да, всё верно: любит чай, особенно зелёный.'},{role:'assistant',content:'Любит чай'}],updatedAt:at,signals:[],summary:'',failures:0};
  applyReflection(m,{confirm:[{id:fact.id,evidence:[{source:'dialog-confirm-0',quote:'любит чай'}]}]},dialog,new Set(),at);
  assert.equal(fact.hits,2);assert.ok(fact.weight>0.5);assert.equal(fact.status,'active');assert.equal(fact.evidence.length,1);

  const other=upsert(m,'fact','Работает дизайнером',{source:'dialog',now:at}).item;
  applyReflection(m,{confirm:[{id:other.id,evidence:[{source:'dialog-confirm-0',quote:'особенно зелёный'},{source:'dialog-confirm-1',quote:'Работает дизайнером'}]}]},dialog,new Set(),at);
  assert.equal(other.hits,1);assert.equal(other.status,'inferred');assert.equal(other.evidence.length,0);

  const legacy=upsert(m,'fact','Пользователь любит кофе',{source:'dialog',now:at}).item;
  const exact={...dialog,id:'dialog-legacy',messages:[{role:'user',content:'Пользователь любит кофе'}]};
  applyReflection(m,{confirm:[legacy.id]},exact,new Set(),at);assert.equal(legacy.hits,2,'legacy id-only confirmations remain compatible');
});

test('A user correction activates a review lesson; self-review alone stays a candidate',()=>{
  const m=emptyMemory();
  const correction={id:'dialog-feedback',messages:[{role:'user',content:'Не надо так подробно. Отвечай короче, пожалуйста.'},{role:'assistant',content:'Конечно, буду отвечать короче.'}],updatedAt:at,signals:[],summary:'',failures:0};
  const review={score:3,weak:'Слишком подробные ответы',lesson:'Отвечать коротко, подробности давать только по запросу',evidence:[{source:'dialog-feedback-0',quote:'Отвечай короче, пожалуйста.'}]};
  applyReflection(m,{episode:{topic:'Стиль ответов'},review},correction,new Set(),at);
  const rule=m.items.find(i=>i.kind==='rule');
  assert.equal(rule.status,'active');assert.equal(rule.source,'review');assert.equal(rule.evidence[0].role,'user');
  assert.match(memoryContext(m,'Как отвечать?'),/Отвечать коротко, подробности давать только по запросу/);

  const second={...correction,id:'dialog-feedback-2'};
  applyReflection(m,{episode:{topic:'Ещё ответ'},review:{...review,evidence:[{source:'dialog-feedback-2-0',quote:'Отвечай короче, пожалуйста.'}]}},second,new Set(),at);
  assert.equal(m.items.filter(i=>i.kind==='rule').length,1);assert.equal(rule.hits,2);assert.equal(rule.evidence.length,2);

  for(const [id,text,quote] of [['dialog-self-review','Спасибо, всё понятно.','Спасибо, всё понятно.'],['dialog-unrelated','Сегодня солнечно.','Сегодня солнечно.']]){
    const candidate=emptyMemory(),dialog={id,messages:[{role:'user',content:text}],updatedAt:at,signals:[],summary:'',failures:0};
    applyReflection(candidate,{review:{score:4,weak:'Нужна краткость',lesson:'Отвечать коротко',evidence:[{source:id+'-0',quote}]}},dialog,new Set(),at);
    const item=candidate.items.find(i=>i.kind==='rule');assert.equal(item.status,'inferred');assert.equal(item.evidence.length,0);
    assert.doesNotMatch(memoryContext(candidate,'Как отвечать?'),/Подтверждённые пожелания пользователя/);
  }
});

test('Memory schema accepts evidence-backed and legacy confirmations but rejects malformed entries',()=>{
  assert.ok(memoryResult({confirm:['fact-1']},'reflect'));
  assert.ok(memoryResult({confirm:[{id:'fact-1',evidence:[]}]},'reflect'));
  for(const entry of [null,{},[],{id:1}])assert.throws(()=>memoryResult({confirm:[entry]},'reflect'),/схема/);
});

test('Review feedback keywords do not activate an unrelated or unspecified lesson',()=>{
  for(const quote of ['Сегодня нужно купить молоко.','Нужно отвечать.']){
    const m=emptyMemory(),dialog={id:'dialog-'+m.items.length+'-'+quote.length,messages:[{role:'user',content:quote}],updatedAt:at,signals:[],summary:'',failures:0};
    applyReflection(m,{review:{score:3,weak:'Слишком подробные ответы',lesson:'Отвечать коротко',evidence:[{source:dialog.id+'-0',quote}]}},dialog,new Set(),at);
    const rule=m.items.find(i=>i.kind==='rule');assert.equal(rule.status,'inferred');assert.equal(rule.evidence.length,0);
    assert.doesNotMatch(memoryContext(m,'Как отвечать?'),/Подтверждённые пожелания пользователя/);
  }
});

test('A confirmation fragment cannot discard surrounding negation',()=>{
  const m=emptyMemory(),fact=upsert(m,'fact','Любит чай',{source:'dialog',now:at}).item;
  const dialog={id:'dialog-negated-confirm',messages:[{role:'user',content:'Не любит чай.'}],updatedAt:at,signals:[],summary:'',failures:0};
  applyReflection(m,{confirm:[{id:fact.id,evidence:[{source:'dialog-negated-confirm-0',quote:'любит чай'}]}]},dialog,new Set(),at);
  assert.equal(fact.hits,1);assert.equal(fact.weight,0.5);assert.equal(fact.status,'inferred');assert.equal(fact.evidence.length,0);
});

test('Repeated confirmation entries reinforce a record only once per reflection',()=>{
  const m=emptyMemory(),fact=upsert(m,'fact','Любит кофе',{source:'dialog',now:at}).item;
  const dialog={id:'dialog-duplicate-confirm',messages:[{role:'user',content:'Да, любит кофе.'}],updatedAt:at,signals:[],summary:'',failures:0};
  const entry={id:fact.id,evidence:[{source:'dialog-duplicate-confirm-0',quote:'любит кофе'}]};
  applyReflection(m,{confirm:Array(30).fill(entry)},dialog,new Set(),at);
  assert.equal(fact.hits,2);assert.equal(fact.evidence.length,1);

  const legacy=upsert(m,'fact','Пользователь любит какао',{source:'dialog',now:at}).item;
  const exact={...dialog,id:'dialog-duplicate-legacy',messages:[{role:'user',content:'Пользователь любит какао'}]};
  applyReflection(m,{confirm:Array(30).fill(legacy.id)},exact,new Set(),at);assert.equal(legacy.hits,2);
});
