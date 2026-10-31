import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTemp } from './helpers/lifecycle.mjs';
import { buildCognitiveSnapshot, cognitiveContext } from '../server/cognitive.ts';
import { emptyMemory, upsert, forget, normalizeMemory, openMemory } from '../server/memory.ts';

const at = '2026-10-31T08:00:00.000Z';
const now = Date.parse(at);
function seeded(){
  const m=emptyMemory();
  const a=upsert(m,'fact','Планирует поездку в Японию',{source:'user',now:at}).item;
  const b=upsert(m,'fact','Изучает японский язык',{source:'user',now:at}).item;
  a.links.push(b.id);
  m.topics.push({id:'travel-topic',title:'Планы поездки',area:'plans',
    summary:'Поездка',facts:[a.id,b.id],created:at,updated:at});
  m.episodes.push({id:'travel-dialog',topic:'Обсуждение Японии',outcome:'Решили готовиться',
    links:[a.id,b.id],consolidated:true,date:at,score:null,weak:''});
  return {m,a,b};
}
test('Cognition derives bounded associations with provenance, never fabricates facts',()=>{
  const {m,a,b}=seeded();
  const before=m.items.length;
  const view=buildCognitiveSnapshot(m,now);
  assert.equal(m.items.length,before);
  assert.equal(view.summary.active,2);
  assert.equal(view.summary.withEvidence,2);
  assert.equal(view.summary.contested,0);
  assert.ok(view.associations.length>=2);
  assert.ok(view.associations.some(x=>x.kind==='direct'&&x.state==='recorded'));
  assert.ok(view.associations.some(x=>x.kind==='episode'&&x.source.id==='travel-dialog'));
  assert.ok(view.associations.some(x=>x.kind==='topic'&&x.source.id==='travel-topic'));
  for(const row of view.associations){
    assert.deepEqual([row.left.id,row.right.id].sort(),[a.id,b.id].sort());
    assert.equal(row.state,'recorded');
  }
  assert.equal(new Set(view.associations.map(x=>x.id)).size,view.associations.length);
  assert.equal(view.questions.length,0);
});
test('Recall is triggered by relevant context, not by unrelated questions or empty search',()=>{
  const {m}=seeded();
  const hit=cognitiveContext(m,'Когда готовимся к поездке в Японию?',now);
  assert.match(hit,/Японию/);
  assert.match(hit,/язык/);
  assert.match(hit,/не доказывает причинность/i);
  assert.equal(cognitiveContext(m,'Сколько стоит ремонт холодильника?',now),'');
  assert.equal(cognitiveContext(m,'',now),'');
  m.settings.enabled=false;
  assert.equal(cognitiveContext(m,'Поездка в Японию?',now),'');
});
test('Unverified or contested memories are visible as candidates but never recalled as truth',()=>{
  const {m,a}=seeded();
  const uncertain=upsert(m,'fact','Предполагает что поездка будет завтра',{now:at,source:'thought'}).item;
  uncertain.status='inferred';
  a.links.push(uncertain.id);
  const conflict=upsert(m,'fact','Япония никогда не планировалась',{now:at,source:'dialog'}).item;
  conflict.status='contested';
  m.questions.push({id:'q1',kind:'conflict',text:'Поездка была отменена?',entity:null,facts:[a.id,conflict.id],created:at,asked:0,lastAsked:null});
  const view=buildCognitiveSnapshot(m,now);
  assert.equal(view.summary.inferred,1);
  assert.equal(view.summary.contested,1);
  assert.ok(view.uncertainties.some(x=>x.id===uncertain.id&&x.reason==='inferred'));
  assert.ok(view.uncertainties.some(x=>x.id===conflict.id&&x.reason==='contested'));
  assert.ok(view.associations.some(x=>x.state==='candidate'));
  assert.equal(view.questions[0].kind,'conflict');
  assert.doesNotMatch(cognitiveContext(m,'Поездка в Японию?',now),/будет завтра/);
  assert.doesNotMatch(cognitiveContext(m,'Поездка в Японию?',now),/никогда не планировалась/);
});
test('Expiry and user forgetting invalidate derived associations immediately, without snapshots to clean',()=>{
  const {m,a,b}=seeded();
  b.until='2026-10-01';
  assert.equal(buildCognitiveSnapshot(m,now).associations.length,0);
  assert.equal(buildCognitiveSnapshot(m,now).summary.expired,1);
  b.until=null;
  forget(m,'Поездка в Японию',at);
  const view=buildCognitiveSnapshot(m,now);
  assert.ok(!view.associations.some(x=>x.left.id===a.id||x.right.id===a.id));
  assert.doesNotMatch(cognitiveContext(m,'Поездка в Японию',now),/Японию/);
});
test('Older version 1 memories still normalize and export without a cognitive DB migration',()=>{
  const {m}=seeded();
  const clean=normalizeMemory(JSON.parse(JSON.stringify(m)),at);
  assert.deepEqual(buildCognitiveSnapshot(clean,now).summary,buildCognitiveSnapshot(m,now).summary);
  assert.equal('cognitive' in clean,false);
  const empty=buildCognitiveSnapshot(emptyMemory(),now);
  assert.equal(empty.associations.length,0);
  assert.equal(empty.summary.withEvidence,0);
});
test('Open memory exposes cognitive view and adds relevant cognitive context to the next answer',async t=>{
  const root=await mkdtemp(join(tmpdir(),'Miyuneya cognitive '));
  let engine;
  t.after(async()=>{await engine?.shutdown();await removeTemp(root);});
  const {m}=seeded();
  await mkdir(join(root,'data'));
  await writeFile(join(root,'data','memory.json'),JSON.stringify(m));
  engine=await openMemory(join(root,'data'),{
    ask:async()=>'{ }',available:()=>false,workspace:()=>null,tickMs:60_000
  });

  const view=engine.view(now);
  assert.ok(view.cognitive?.associations.length>=2);
  assert.equal(view.cognitive.summary.active,2);
  const recall=await engine.context('Что с поездкой в Японию?');
  assert.match(recall,/Когнитивная память/);
  assert.match(recall,/не доказывает причинность/i);
  await engine.settings({enabled:false});
  assert.equal((await engine.context('Япония')),'');
});
test('Safe update allowlist accepts the cognitive server module',async()=>{
  const update=await readFile(new URL('../scripts/update.mjs',import.meta.url),'utf8');
  assert.match(update,/memory\|memory-archive\|cognitive\|cognitive-daemon\|cognitive-jobs\|cognitive-notebook\|cognitive-curiosity\|cognitive-learning\|recall/);
});

test('UI presents cognitive tab under Knowledge, sources, uncertainty and local search safely',async()=>{
  const ui=await readFile(new URL('../src/memory.ts',import.meta.url),'utf8');
  const styles=await readFile(new URL('../web/workspace-layout.css',import.meta.url),'utf8');
  assert.match(ui,/\['cognitive', 'Когнитивная'\]/);
  assert.match(ui,/\['known', 'Знания', \['cognitive'/);
  assert.match(ui,/data-cognitive-search/);
  assert.match(ui,/escape\(a\.source\.title\)/);
  assert.match(ui,/data-memory-goto/);
  assert.match(styles,/\.cognitive-metrics/);
  assert.match(styles,/\.cognitive-pair\[hidden\]/);
  assert.doesNotMatch(ui,/innerHTML\s*=\s*(?:view\.cognitive|a\.left\.text)/);
});
