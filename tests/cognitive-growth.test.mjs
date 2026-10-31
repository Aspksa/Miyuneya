import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTemp } from './helpers/lifecycle.mjs';
import { analyzeGrowth } from '../scripts/cognitive-growth.mjs';
import { openCognitiveJobs } from '../server/cognitive-jobs.ts';

const mk=(id,text,overrides={})=>({
  id,kind:'fact',text,source:'user',status:'active',category:'work',
  links:[],evidence:[],until:null,...overrides,
});
test('Growth suggests thematic branches without altering actual memory',()=>{
  const items=[
    mk('a','Водители оформляют путевые листы для транспорта'),
    mk('b','Путевые листы проверяют водители транспорта'),
    mk('c','Ремонт транспорта выполняют водители автопарка'),
    mk('d','Транспорт автопарка проходит ремонт у механиков')
  ];
  const before=JSON.stringify(items);
  const result=analyzeGrowth({items,edges:[]});
  assert.equal(JSON.stringify(items),before);
  assert.ok(result.branches.length>0);
  assert.ok(result.branches.every(x=>x.status==='candidate'));
  assert.ok(result.candidateLinks.every(x=>x.status==='candidate'));
  assert.equal(result.evaluation.holdout,true);
});

test('Detects ambiguous entity names but never merges them',()=>{
  const items=[mk('a','Московский транспорт и водители'),mk('b','Водители автобусов Москвы')];
  const result=analyzeGrowth({items,edges:[],entities:[
    {id:'company',name:'Сокол',aliases:['Транспорт']},
    {id:'person',name:'Сокол',aliases:['Александр']},
  ]});
  assert.equal(result.ambiguities[0].name,'сокол');
  assert.deepEqual(result.ambiguities[0].ids,['company','person']);
});

test('A new year is treated as a temporal difference, not an automatic contradiction',()=>{
  const items=[mk('a','Расход топлива автомобилей в 2025 году составил 15 литров'),
    mk('b','Расход топлива автомобилей в 2026 году составил 20 литров')];
  const g=analyzeGrowth({items,edges:[]});
  assert.ok(g.temporal.length>0);
  assert.equal(g.conflicts.length,0);
});

test('Assistant-only claims, unverified notes and copied evidence are not independent facts',()=>{
  const items=[
    mk('a','Проверена стоимость горючего 100 рублей',{source:'thought',status:'inferred'}),
    mk('b','Стоимость горючего составляет 100 рублей',{source:'dialog',evidence:[
      {source:'source-1',quote:'Стоимость горючего составляет 100 рублей',role:'assistant'},
      {source:'source-2',quote:'Стоимость горючего составляет 100 рублей',role:'assistant'},
    ]}),
    mk('c','Стоимость топлива для автобуса 120 рублей',{source:'user'}),
  ];
  const g=analyzeGrowth({items,edges:[]});
  assert.equal(g.grounded,1);
  assert.ok(g.sourceChecks.some(x=>x.id==='a'));
  assert.ok(g.sourceChecks.some(x=>x.id==='b'));
});

test('Archive batch is analyzed without promoting its entries to verified facts',()=>{
  const base=[mk('a','Отчёт по перевозке пассажиров и автобусов'),mk('b','Водители автобусов составляют отчёт')];
  const old=[mk('old','Старый отчёт по автобусным перевозкам',{status:'inferred',source:'thought'})];
  const g=analyzeGrowth({items:base,archive:old,edges:[]});
  assert.equal(g.archiveReviewed,1);
  assert.equal(g.grounded,2);
  assert.ok(g.reviewed>=3);
});

test('SQLite queue coalesces by type, recovers crashes, backs off and stores bounded audit history',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'Miyuneya growth queue '));
  let q=openCognitiveJobs(dir);
  t.after(async()=>{q.close();await removeTemp(dir)});
  const a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64);
  q.enqueue('archive',a,2);
  q.enqueue('changes',b,10);
  q.enqueue('changes',c,10);
  assert.equal(q.overview().queued,2);
  let job=q.take();
  assert.equal(job.kind,'changes');
  assert.equal(job.fingerprint,c);
  q.close();
  q=openCognitiveJobs(dir);
  job=q.take();
  assert.equal(job.kind,'changes','running jobs recover to queued');
  q.retry(job,Date.now());
  assert.equal(q.take()?.kind,'archive');
  const stats=q.overview();
  assert.ok(stats.queued>=1);
  q.clear();
  assert.equal(q.overview().queued,0);
});

test('Hidden graph links are evaluated without leaking the answer into scoring',()=>{
  const items=[];
  for(let i=0;i<32;i++)
    items.push(mk('r'+i,'Автобус номер '+i+' перевозит пассажиров по маршруту '+(i%4)));
  for(let i=0;i<31;i++)items[i].links=[items[i+1].id];
  const g=analyzeGrowth({items,edges:[]});
  assert.ok(g.evaluation.examples>0);
  assert.ok(g.evaluation.lexical>=0&&g.evaluation.lexical<=1);
  assert.ok(g.evaluation.graph>=0&&g.evaluation.graph<=1);
  assert.match(g.evaluation.meaning,/не качество ответов/);
});
