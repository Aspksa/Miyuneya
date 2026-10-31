import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { removeTemp } from './helpers/lifecycle.mjs';
import { analyzeCognitive } from '../scripts/cognitive-worker.mjs';
import { openCognitiveDaemon } from '../server/cognitive-daemon.ts';
import { emptyMemory, upsert } from '../server/memory.ts';

function sample(){
  const memory=emptyMemory();
  const a=upsert(memory,'fact','Поездка в Японию запланирована на 2027 год',{source:'user'}).item;
  const b=upsert(memory,'fact','Поездка в Японию запланирована на 2028 год',{source:'user'}).item;
  const c=upsert(memory,'fact','Не запланирована поездка в Японию на 2027 год',{source:'user'}).item;
  const d=upsert(memory,'fact','Изучение японского языка для поездки в Японию',{source:'user'}).item;
  const e=upsert(memory,'fact','Путешествие в Японию и японский язык',{source:'user'}).item;
  a.links.push(d.id); d.links.push(e.id); b.links.push(e.id);
  return {memory,a,b,c,d,e};
}
async function settled(fn,predicate,timeout=9000){
  const start=Date.now();
  while(Date.now()-start<timeout){
    const state=fn();
    if(predicate(state))return state;
    await delay(80);
  }
  throw Error('Когнитивный процесс не завершил работу за установленный тестовый предел');
}
test('Background analysis only proposes associations and conflicts; never modifies facts',()=>{
  const {memory}=sample(),before=JSON.stringify(memory);
  const result=analyzeCognitive(memory,Date.now());
  assert.equal(JSON.stringify(memory),before);
  assert.ok(result.metrics.reviewed>=4);
  assert.ok(result.metrics.directLinks>=2);
  assert.ok(result.candidates.every(a=>a.status==='candidate'));
  assert.ok(result.conflicts.every(a=>a.status==='candidate'));
  assert.ok(result.metrics.potentialConflicts>=1);
  assert.ok(['graph','lexical'].includes(result.strategy));
  assert.ok(result.metrics.lexicalRecallAt3>=0&&result.metrics.graphRecallAt3<=1);
});

test('Unverified knowledge is not used as independent confirmation',()=>{
  const {memory}=sample();
  const unconfirmed=upsert(memory,'fact','Поездка в Японию была отменена',{source:'thought'}).item;
  unconfirmed.status='inferred';
  const bad=upsert(memory,'fact','Поездка в Японию точно подтверждена',{source:'dialog'}).item;
  bad.status='active';bad.evidence=[];
  const result=analyzeCognitive(memory);
  assert.equal(result.metrics.verified,memory.items.length-2);
});

test('Independent process has durable queue, survives restart and pauses immediately for privacy',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'Miyuneya автономная память '));
  t.after(()=>removeTemp(dir));
  const {memory}=sample();
  let daemon=await openCognitiveDaemon(dir,()=>memory);
  t.after(async()=>{await daemon?.shutdown();});
  let done=await settled(()=>daemon.overview(),r=>r.runs>=1&&!r.pending);
  assert.ok(done.result);
  assert.ok(done.result.metrics.reviewed>=4);
  const file=join(dir,'cognitive-daemon.json');
  assert.equal(JSON.parse(await readFile(file,'utf8')).version,1);
  assert.equal(daemon.strategy(),done.result.strategy);
  await daemon.shutdown();
  daemon=await openCognitiveDaemon(dir,()=>memory);
  assert.equal(daemon.overview().runs,1,'same snapshot is not recomputed after restart');
  upsert(memory,'fact','Новое подтвержденное знание о японских поездках',{source:'user'});
  daemon.enqueue();
  done=await settled(()=>daemon.overview(),r=>r.runs>=2&&!r.pending);
  assert.equal(done.result.metrics.verified,memory.items.length);
  memory.settings.private=true;
  await daemon.modeChanged();
  assert.equal(daemon.overview().state,'paused');
  assert.equal(daemon.overview().result,null);
  assert.equal(JSON.parse(await readFile(file,'utf8')).result,null);
  memory.settings.private=false;
  await daemon.modeChanged();
  done=await settled(()=>daemon.overview(),r=>r.runs>=1&&!r.pending);
  assert.ok(done.result);
  await daemon.shutdown();
});

test('Batched updates keep only newest fingerprint without changing source memory',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'Miyuneya очередь когнитивная '));
  t.after(()=>removeTemp(dir));
  const {memory}=sample(),original=memory.items[0].text;
  let daemon=await openCognitiveDaemon(dir,()=>memory);
  t.after(async()=>daemon.shutdown());
  for(let i=0;i<8;i++){
    upsert(memory,'fact','Дополнительное направление исследования номер '+i+' для Японии',{source:'user'});
    daemon.enqueue();
  }
  const result=await settled(()=>daemon.overview(),r=>r.runs>=1&&!r.pending);
  assert.equal(result.result.metrics.reviewed,memory.items.length);
  assert.equal(memory.items[0].text,original);
  assert.ok(result.runs<=2,'coalesced updates avoid one process per fact');
});
