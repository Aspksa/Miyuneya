import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { removeTemp } from './helpers/lifecycle.mjs';
import { openCognitiveNotebook } from '../server/cognitive-notebook.ts';
import { openMemory, emptyMemory, upsert } from '../server/memory.ts';

const hashA='a'.repeat(64),hashB='b'.repeat(64);
function records(){
  return [
    {id:'f1',kind:'fact',text:'Транспорт доставляет пассажиров утром',status:'active',
      category:'work',source:'user',until:null,evidence:[],links:[]},
    {id:'f2',kind:'fact',text:'Транспорт ремонтируют механики вечером',status:'active',
      category:'work',source:'user',until:null,evidence:[],links:[]},
    {id:'f3',kind:'fact',text:'Транспорт хранится в гараже автопарка',status:'active',
      category:'work',source:'user',until:null,evidence:[],links:[]},
  ];
}
const growth={
  branches:[{title:'транспорт',category:'work',ids:['f1','f2','f3'],status:'candidate'}],
  candidateLinks:[{left:{id:'f1',text:'a'},right:{id:'f2',text:'b'},status:'candidate'}],
  paths:[],temporal:[]
};
test('Self-written memory grows, deduplicates, persists and recalls only observed source-backed topics',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'Miyuneya notebook '));
  const map=new Map(records().map(x=>[x.id,x]));
  let store=openCognitiveNotebook(dir,id=>map.get(id));
  t.after(async()=>{store.close();await removeTemp(dir);});
  assert.equal(store.learn(growth,'changes:'+hashA),2);
  const first=store.overview();
  assert.equal(first.total,2);
  assert.equal(first.observed,1);
  assert.equal(first.hypotheses,1);
  assert.match(store.context('Что с транспортом?'),/Автоматически организованная когнитивная память/);
  assert.match(store.context('транспорт'),/Транспорт доставляет пассажиров/);
  assert.doesNotMatch(store.context('транспорт'),/Возможная смысловая связь/);
  assert.equal(store.learn(growth,'changes:'+hashA),0);
  store.close();
  store=openCognitiveNotebook(dir,id=>map.get(id));
  assert.equal(store.overview().total,2,'SQLite survives restart');
  assert.equal(store.learn(growth,'changes:'+hashB),2);
  const byKind=store.overview().latest;
  assert.ok(byKind.every(x=>x.observations===2),'repeat analysis is not counted as independent evidence');
  assert.equal(store.learn(growth,'changes:'+hashB),0);
});
test('Forgetting, source expiry and private reset invalidate all dependent derived notes',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'Miyuneya notebook forget '));
  const map=new Map(records().map(x=>[x.id,x]));
  const store=openCognitiveNotebook(dir,id=>map.get(id));
  t.after(async()=>{store.close();await removeTemp(dir);});
  store.learn(growth,'changes:'+hashA);
  map.delete('f2');
  store.eraseSource('f2');
  assert.equal(store.overview().total,0);
  assert.equal(store.context('транспорт'),'');
  map.set('f2',records()[1]);
  store.learn(growth,'changes:'+hashB);
  assert.equal(store.overview().total,2);
  map.get('f1').status='inferred';
  assert.equal(store.reconcile(),1,'topic loses its three grounded source records');
  assert.equal(store.overview().total,0,'hypothesis also loses enough source records');
  store.clear();
  assert.equal(store.overview().total,0);
});
test('Assistant-generated hypotheses cannot become trusted memory even after repeated analysis',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'Miyuneya notebook evidence '));
  const map=new Map(records().map(x=>[x.id,x]));
  map.get('f2').source='thought';
  map.get('f2').status='inferred';
  const store=openCognitiveNotebook(dir,id=>map.get(id));
  t.after(async()=>{store.close();await removeTemp(dir);});
  assert.equal(store.learn(growth,'changes:'+hashA),0);
  assert.equal(store.learn(growth,'changes:'+hashB),0);
  assert.equal(store.overview().total,0);
});
test('Main memory app gradually appends its own topic structures while keeping user facts unchanged',async t=>{
  const root=await mkdtemp(join(tmpdir(),'Miyuneya self writing '));
  const memory=emptyMemory();
  const input=[
    'Транспорт доставляет пассажиров из гаража',
    'Транспорт использует расписание рейсов',
    'Транспорт проходит плановый технический осмотр',
    'Транспорт хранит запасные колёса',
  ];
  for(const phrase of input)upsert(memory,'fact',phrase,{source:'user',category:'work'});
  await mkdir(join(root,'data'));
  await writeFile(join(root,'data','memory.json'),JSON.stringify(memory));
  let engine;
  t.after(async()=>{await engine?.shutdown();await removeTemp(root);});
  engine=await openMemory(join(root,'data'),{ask:async()=>'{}',available:()=>false,workspace:()=>null,tickMs:60_000});
  const start=Date.now();
  let view;
  do{
    view=engine.view();
    if(view.cognitiveAutonomy?.notebook?.topics>=1)break;
    await delay(80);
  }while(Date.now()-start<9000);
  assert.ok(view.cognitiveAutonomy?.notebook?.topics>=1,'worker should automatically persist source-backed topic');
  const recall=await engine.context('транспорт');
  assert.match(recall,/Автоматически организованная когнитивная память/);
  assert.equal(engine.view().items.length,memory.items.length);
  await engine.settings({private:true});
  assert.equal(engine.view().cognitiveAutonomy.notebook,null);
  assert.doesNotMatch(await engine.context('транспорт'),/Автоматически организованная когнитивная память/);
});
