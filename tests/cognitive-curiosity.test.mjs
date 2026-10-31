import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { removeTemp } from './helpers/lifecycle.mjs';
import { suggestCognitiveInquiries, isUsefulClarification } from '../server/cognitive-curiosity.ts';
import { emptyMemory, upsert, ask, answer, normalizeMemory, openMemory } from '../server/memory.ts';
import { openCognitiveNotebook } from '../server/cognitive-notebook.ts';

function seed(){
  const m=emptyMemory();
  const a=upsert(m,'fact','Водители получают путевые листы на рейс ежедневно',
    {source:'user',category:'work'}).item;
  const b=upsert(m,'fact','Водители не получают путевые листы на рейс ежедневно',
    {source:'user',category:'work'}).item;
  a.status='active';b.status='active';
  return {m,a,b};
}
function growth(a,b){return {conflicts:[{left:{id:a.id,text:a.text},right:{id:b.id,text:b.text}}],
  temporal:[]};}
async function until(probe,timeout=20000){
  const before=Date.now();
  while(Date.now()-before<timeout){const x=probe();if(x)return x;await delay(80);}
  throw Error('Когнитивный процесс не сформировал проверяемый вопрос');
}
test('Curiosity candidates are attributed to two real facts, with no fabricated answers',()=>{
  const {m,a,b}=seed();
  const proposed=suggestCognitiveInquiries(growth(a,b),m);
  assert.equal(proposed.length,1);
  assert.equal(proposed[0].kind,'conflict');
  assert.deepEqual(proposed[0].refs,[a.id,b.id].sort());
  assert.match(proposed[0].text,/действительно противоречат/);
  assert.match(proposed[0].key,/^[a-f0-9]{64}$/);
  assert.equal(m.questions.length,0,'analysis itself never inserts unverified facts or questions');
  m.settings.private=true;
  assert.deepEqual(suggestCognitiveInquiries(growth(a,b),m),[]);
  m.settings.private=false;
  a.category='health';
  assert.deepEqual(suggestCognitiveInquiries(growth(a,b),m),[]);
});

test('Owner answers create attributed, contextual memory without rewriting source facts',()=>{
  const {m,a,b}=seed();
  const x=suggestCognitiveInquiries(growth(a,b),m)[0];
  const q=ask(m,x.kind,x.text,{facts:x.refs,cognitiveKey:x.key});
  assert.ok(q);
  const before=[a.text,b.text];
  assert.equal(answer(m,q.id,'Да','2026-10-31T10:00:00Z','dialog'),null,
    'a model reflection cannot confirm autonomous curiosity');
  assert.equal(m.questions.length,1);
  const added=answer(m,q.id,'Да','2026-10-31T10:00:00Z','user');
  assert.ok(added);
  assert.match(added.text,/Уточнение пользователя к вопросу/);
  assert.match(added.text,/«Да»/);
  assert.ok(added.evidence.some(e=>e.role==='user'&&e.quote==='Да'));
  assert.ok(added.links.includes(a.id)&&added.links.includes(b.id));
  assert.deepEqual([a.text,b.text],before);
  assert.equal(m.questions.length,0);
  const normalized=normalizeMemory(JSON.parse(JSON.stringify(m)));
  assert.ok(normalized.items.some(i=>i.id===added.id));
  assert.equal(isUsefulClarification('не знаю'),false);
  assert.equal(isUsefulClarification('потом'),false);
  assert.equal(isUsefulClarification('нет'),true);
});

test('Curiosity registry survives restart, keeps asked question fingerprint, and records decisions',async t=>{
  const root=await mkdtemp(join(tmpdir(),'Miyuneya curiosity log '));
  const {m}=seed();
  let store=openCognitiveNotebook(root,id=>m.items.find(x=>x.id===id));
  t.after(async()=>{store.close();await removeTemp(root);});
  const q=suggestCognitiveInquiries(growth(m.items[0],m.items[1]),m)[0];
  assert.ok(q);
  assert.equal(store.rememberInquiry(q.key,'question-1'),true);
  assert.equal(store.rememberInquiry(q.key,'question-1'),false);
  assert.equal(store.wasAsked(q.key),true);
  assert.ok(store.lastInquiryAt()>0);
  store.close();store=openCognitiveNotebook(root,id=>m.items.find(x=>x.id===id));
  assert.equal(store.wasAsked(q.key),true);
  store.settleInquiry('question-1','answered');
  assert.deepEqual(store.curiosityOverview(),{open:0,answered:1,dismissed:0});
  store.clear();
  assert.deepEqual(store.curiosityOverview(),{open:0,answered:0,dismissed:0});
});

test('Autonomous worker asks at most one distinct question, learns confirmed answer and preserves after restart',async t=>{
  const root=await mkdtemp(join(tmpdir(),'Miyuneya autonomous curiosity '));
  await mkdir(join(root,'data'));
  const {m,a,b}=seed();
  await writeFile(join(root,'data','memory.json'),JSON.stringify(m));
  let engine=await openMemory(join(root,'data'),{
    ask:async()=>'{}',available:()=>false,workspace:()=>null,tickMs:60_000
  });
  t.after(async()=>{await engine?.shutdown();await removeTemp(root);});
  const question=await until(()=>engine.view().questions.find(q=>q.cognitiveKey));
  assert.ok(question.facts.includes(a.id)&&question.facts.includes(b.id));
  await until(()=>engine.view().cognitiveAutonomy.curiosity?.open===1);
  const existing=engine.view().items.filter(x=>x.id===a.id||x.id===b.id).map(x=>x.text);
  assert.equal(await engine.answer(question.id,'Нет, это разные ситуации'),true);
  assert.equal(engine.view().cognitiveAutonomy.curiosity.answered,1);
  assert.ok(engine.view().items.some(x=>x.text.includes('Нет, это разные ситуации')));
  assert.deepEqual(engine.view().items.filter(x=>x.id===a.id||x.id===b.id).map(x=>x.text),existing);
  await engine.shutdown();
  engine=await openMemory(join(root,'data'),{
    ask:async()=>'{}',available:()=>false,workspace:()=>null,tickMs:60_000
  });
  assert.equal(engine.view().cognitiveAutonomy.curiosity.answered,1);
  await delay(800);
  assert.ok(!engine.view().questions.some(q=>q.cognitiveKey),
    'confirmed clarification must not get re-asked after restart');
  await engine.settings({private:true});
  assert.equal(engine.view().cognitiveAutonomy.curiosity,null);
});

test('Owner can dismiss a background question without a re-ask loop',async t=>{
  const root=await mkdtemp(join(tmpdir(),'Miyuneya curiosity dismiss '));
  await mkdir(join(root,'data'));
  const {m}=seed();
  await writeFile(join(root,'data','memory.json'),JSON.stringify(m));
  const engine=await openMemory(join(root,'data'),{
    ask:async()=>'{}',available:()=>false,workspace:()=>null,tickMs:60_000
  });
  t.after(async()=>{await engine.shutdown();await removeTemp(root);});
  const q=await until(()=>engine.view().questions.find(q=>q.cognitiveKey));
  assert.equal(await engine.remove(q.id),true);
  assert.equal(engine.view().cognitiveAutonomy.curiosity.dismissed,1);
  await delay(800);
  assert.equal(engine.view().questions.filter(q=>q.cognitiveKey).length,0);
  assert.equal(engine.view().items.length,2);
});

test('Sensitive-mode switch and editing a premise remove outdated autonomous questions',async t=>{
  const root=await mkdtemp(join(tmpdir(),'Miyuneya curiosity safety '));
  await mkdir(join(root,'data'));
  const {m,a}=seed();
  await writeFile(join(root,'data','memory.json'),JSON.stringify(m));
  const engine=await openMemory(join(root,'data'),{
    ask:async()=>'{}',available:()=>false,workspace:()=>null,tickMs:60_000
  });
  t.after(async()=>{await engine.shutdown();await removeTemp(root);});
  await until(()=>engine.view().questions.find(q=>q.cognitiveKey));
  assert.equal(await engine.edit(a.id,{text:'Водители получают специальные документы по внутреннему регламенту'}),true);
  assert.equal(engine.view().questions.filter(q=>q.cognitiveKey).length,0);
  await engine.settings({private:true});
  assert.equal(engine.view().questions.filter(q=>q.cognitiveKey).length,0);
  assert.equal(engine.view().cognitiveAutonomy.curiosity,null);
});
