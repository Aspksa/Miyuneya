import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { removeTemp } from './helpers/lifecycle.mjs';
import { openCognitiveLearning } from '../server/cognitive-learning.ts';
import { emptyMemory, upsert, openMemory } from '../server/memory.ts';

const sha=n=>n.repeat(64);
function make(){
  const m=emptyMemory();
  const valid=upsert(m,'fact','Водители оформляют путевые листы для рейса',{source:'user',category:'work'}).item;
  const conflict=upsert(m,'fact','Водители не оформляют путевые листы для рейса',{source:'user',category:'work'}).item;
  conflict.status='active';
  const weak=upsert(m,'fact','Непроверенная стоимость технического ремонта',{source:'dialog',category:'work'}).item;
  weak.status='active';
  return {m,valid,conflict,weak};
}
const growth=(a,b,c)=>({
  sourceChecks:[{id:c.id,reason:'Нет первоисточника'}],
  conflicts:[{left:{id:a.id},right:{id:b.id}}],
  temporal:[{ids:[a.id,b.id]}],
  candidateLinks:[{left:{id:a.id},right:{id:b.id}}],
});
test('Study agenda prioritizes missing evidence, preserves provenance and never creates facts',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'Miyuneya study planner '));
  const {m,valid,conflict,weak}=make();
  let store=openCognitiveLearning(dir,id=>m.items.find(x=>x.id===id));
  t.after(async()=>{store.close();await removeTemp(dir);});
  const before=JSON.stringify(m);
  assert.equal(store.update(growth(valid,conflict,weak)),4);
  const focus=store.focus();
  assert.deepEqual(focus.map(x=>x.kind),['missing-source','conflict','temporal','association']);
  assert.deepEqual(focus.map(x=>x.priority),[90,85,65,25]);
  assert.equal(JSON.stringify(m),before,'local investigations must not modify factual records');
  store.close();
  store=openCognitiveLearning(dir,id=>m.items.find(x=>x.id===id));
  assert.equal(store.focus().length,4,'restart must not erase learned investigation priorities');
  assert.equal(store.update(growth(valid,conflict,weak)),4,'repeated analysis never inserts duplicate priorities');
  assert.equal(store.focus().length,4);
  weak.evidence=[{source:'verified-note',version:'v1',quote:weak.text,role:'note',at:new Date().toISOString()}];
  store.update(growth(valid,conflict,weak));
  assert.ok(!store.focus().some(x=>x.kind==='missing-source'),'source-backed claim no longer needs original source');
  assert.ok(store.overview().resolved>=1);
  valid.text='Изменённое значение';
  assert.ok(!store.focus().some(x=>x.refs.includes(valid.id)),'stale source versions cannot influence focus');
});
test('Low confidence, health and credentials cannot become autonomous study subjects',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'Miyuneya planner privacy '));
  const {m,valid,conflict,weak}=make();
  const store=openCognitiveLearning(dir,id=>m.items.find(x=>x.id===id));
  t.after(async()=>{store.close();await removeTemp(dir);});
  weak.category='health';
  conflict.text='Мой API KEY abcdef12345678';
  assert.equal(store.update(growth(valid,conflict,weak)),0);
  assert.equal(store.focus().length,0);
});
test('Answer verification dashboard counts actual verdicts, not invented accuracy',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'Miyuneya answer audits '));
  const store=openCognitiveLearning(dir,()=>undefined);
  t.after(async()=>{store.close();await removeTemp(dir);});
  assert.equal(store.recordAnswer(sha('a'),'supported'),true);
  assert.equal(store.recordAnswer(sha('a'),'blocked'),false,'duplicate answer fingerprint has one verdict');
  assert.equal(store.recordAnswer(sha('b'),'blocked'),true);
  assert.equal(store.recordAnswer(sha('c'),'uncertain'),true);
  assert.equal(store.recordAnswer(sha('d'),'unverified'),true);
  let q=store.overview().quality;
  assert.equal(q.total,4);
  assert.equal(q.checked,3);
  assert.equal(q.supportRate,null,'do not report percentages for tiny samples');
  assert.equal(q.unverified,1);
  assert.equal(q.trend,'insufficient');
  assert.equal(store.feedback(sha('a')),true);
  assert.equal(store.feedback(sha('a')),false);
  assert.equal(store.overview().quality.userUndos,1);
  for(let i=0;i<8;i++)store.recordAnswer(i.toString(16).padStart(64,'0'),'supported');
  q=store.overview().quality;
  assert.ok(q.checked>=5);
  assert.ok(q.supportRate!==null);
  assert.match(q.caveat,/не истинная точность/);
  store.clear();
  assert.equal(store.overview().quality.total,0);
});
test('Memory integrates autonomous study priorities, real outcomes and privacy cleanup',async t=>{
  const root=await mkdtemp(join(tmpdir(),'Miyuneya background studies '));
  await mkdir(join(root,'data'));
  const {m,weak}=make();
  await writeFile(join(root,'data','memory.json'),JSON.stringify(m));
  let engine=await openMemory(join(root,'data'),{ask:async()=>'{}',available:()=>false,workspace:()=>null,tickMs:60_000});
  t.after(async()=>{await engine.shutdown();await removeTemp(root);});
  const start=Date.now();
  while(Date.now()-start<10000 && !engine.view().cognitiveAutonomy.learning?.focus.some(x=>x.kind==='missing-source'))await delay(80);
  let learning=engine.view().cognitiveAutonomy.learning;
  assert.ok(learning.focus.some(x=>x.kind==='missing-source'));
  assert.equal(engine.recordAnswerQuality(sha('a'),'supported'),true);
  assert.equal(engine.recordAnswerQuality(sha('a'),'supported'),false);
  assert.equal(engine.recordAnswerQuality(sha('b'),'unverified'),true);
  learning=engine.view().cognitiveAutonomy.learning;
  assert.equal(learning.quality.total,2);
  assert.equal(learning.quality.checked,1);
  await engine.shutdown();
  engine=await openMemory(join(root,'data'),{ask:async()=>'{}',available:()=>false,workspace:()=>null,tickMs:60_000});
  assert.equal(engine.view().cognitiveAutonomy.learning.quality.total,2);
  assert.equal(engine.view().cognitiveAutonomy.learning.focus[0].kind,'missing-source');
  await engine.settings({private:true});
  assert.equal(engine.view().cognitiveAutonomy.learning,null);
  await engine.settings({private:false});
  assert.equal(engine.view().cognitiveAutonomy.learning.quality.total,0);
  assert.equal(engine.view().cognitiveAutonomy.learning.focus.length,0);
});
test('UI and chat capture source-check outcomes but never present them as accuracy',async()=>{
  const {readFile}=await import('node:fs/promises');
  const ui=await readFile(new URL('../src/memory.ts',import.meta.url),'utf8');
  const app=await readFile(new URL('../server/app.ts',import.meta.url),'utf8');
  assert.match(ui,/Что изучать дальше/);
  assert.match(ui,/Это не оценка фактической истинности/);
  assert.match(app,/memory\.recordAnswerQuality\(/);
  assert.match(app,/reviewed\?\.status\|\|'unverified'/);
});
