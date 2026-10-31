import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openChats } from '../server/chats.ts';

const temp=async fn=>{
  const dir=await mkdtemp(join(tmpdir(),'miyuneya-chats-'));
  try { await fn(dir); } finally { await rm(dir,{recursive:true,force:true}); }
};
const make=(messages=[])=>({version:1,revision:0,activeId:'dialog-12345',dialogs:[{id:'dialog-12345',title:'Первый разговор',createdAt:'2026-10-31T00:00:00.000Z',updatedAt:'2026-10-31T00:00:00.000Z',messages}]});
test('chat archive persists conversations and survives server restart',async()=>temp(async dir=>{
  const store=await openChats(dir);
  assert.deepEqual(store.snapshot(),{version:1,revision:0,activeId:null,dialogs:[]});
  const saved=await store.replace(make([{role:'user',content:'Привет, Миюнэя'}]));
  assert.equal(saved.revision,1);
  const restarted=await openChats(dir);
  assert.deepEqual(restarted.snapshot(),saved);
  assert.match(await readFile(join(dir,'chats','index.json'),'utf8'),/Привет, Миюнэя/);
}));
test('chat revision mismatch never overwrites newer messages',async()=>temp(async dir=>{
  const store=await openChats(dir);
  const old=make([{role:'user',content:'старое'}]);
  await store.replace(old);
  await assert.rejects(()=>store.replace(old),error=>error.status===409);
  assert.equal(store.snapshot().dialogs[0].messages[0].content,'старое');
}));
test('invalid archive is rejected without modifying existing data',async()=>temp(async dir=>{
  const store=await openChats(dir);
  const current=await store.replace(make([{role:'assistant',content:'Ответ'}]));
  const invalid={...current,dialogs:[{...current.dialogs[0],messages:[{role:'system',content:'подмена'}]}]};
  await assert.rejects(()=>store.replace(invalid),error=>error.status===400);
  assert.deepEqual(store.snapshot(),current);
}));
test('damaged archive is not silently replaced',async()=>temp(async dir=>{
  await mkdir(join(dir,'chats'),{recursive:true});
  await writeFile(join(dir,'chats','index.json'),'{broken', 'utf8');
  await assert.rejects(()=>openChats(dir),/Архив чатов повреждён/);
  assert.equal(await readFile(join(dir,'chats','index.json'),'utf8'),'{broken');
}));
