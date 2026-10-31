import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { openSqliteChatArchive } from '../server/chat-sqlite.ts';
import { openChatMaintenance } from '../server/chat-maintenance.ts';

const at='2026-10-31T11:00:00.000Z';
const later='2026-10-31T12:00:00.000Z';
const msg=(id,content='Текст',version=1)=>({id,role:'user',content,createdAt:at,version,complete:true});
const temp=async(t)=>{
  const root=await mkdtemp(join(tmpdir(),'miyuneya-audit-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  return root;
};
const backup=(conversations)=>({revision:0,selectedId:null,conversations});
const chat=(id,text,extra={})=>({id,title:'Исторический '+id,createdAt:at,updatedAt:later,
  archived:false,messages:[{role:'user',content:text}],...extra});
const stream=(items)=>Readable.from(items.map(line=>Buffer.from(line)));
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('Старый JSON полностью проверяется перед первой записью, а существующие сообщения не исчезают',async t=>{
  const root=await temp(t),store=await openSqliteChatArchive(root);
  store.create({id:'original'});store.saveMessage('original',msg('fresh','Уже сохранено'));
  assert.throws(()=>store.importLegacy(backup([
    chat('new-one','Безопасный'),chat('bad','Плохой',{messages:[{role:'admin',content:'Подмена'}]})
  ])),/Некорректное сообщение/);
  assert.equal(store.list().total,1);
  assert.equal(store.page('original').messages[0].content,'Уже сохранено');
  assert.equal(store.db.prepare("SELECT name FROM sqlite_master WHERE name='conversations'").get().name,'conversations');
  await store.shutdown();
});

test('Даже поздний конфликт при импорте старой копии откатывает все новые разговоры',async t=>{
  const root=await temp(t),store=await openSqliteChatArchive(root);
  const first=backup([chat('existing','Исходный текст')]);
  assert.deepEqual(store.importLegacy(first),{imported:1,conversations:1});
  assert.throws(()=>store.importLegacy(backup([
    chat('would-appear','Не должен появиться'),chat('existing','Текст изменён')
  ])),/Конфликт сообщения/);
  assert.equal(store.list().total,1);
  assert.equal(store.page('existing').messages[0].content,'Исходный текст');
  assert.equal(store.page('existing').total,1);
  assert.deepEqual(store.importLegacy(first),{imported:0,conversations:1});
  await store.shutdown();
});

test('Статус архива и исходные даты возвращаются после старого JSON импорта',async t=>{
  const root=await temp(t),store=await openSqliteChatArchive(root);
  const archived=chat('buried','Переписка 2020 года',{archived:true,
    messages:[{role:'user',content:'Переписка 2020 года',createdAt:later}]});
  const result=store.importLegacy(backup([archived]));
  assert.equal(result.imported,1);
  assert.equal(store.list().total,0);
  assert.equal(store.list({archived:true}).total,1);
  const page=store.page('buried');
  assert.equal(page.conversation.createdAt,at);
  assert.equal(page.conversation.updatedAt,later);
  assert.equal(page.messages[0].createdAt,later);
  await store.shutdown();
});

test('Длительный JSONL импорт временно отклоняет параллельную запись и чтение, после COMMIT всё работает',async t=>{
  const sourceRoot=await temp(t),targetRoot=await temp(t);
  const source=await openSqliteChatArchive(sourceRoot);
  source.create({id:'long'});
  for(let i=0;i<350;i++)source.saveMessage('long',msg('long-'+i,'Страница '+i+': '+('А'.repeat(450))));
  const lines=[];for await(const line of source.exportLines())lines.push(line);
  const target=await openSqliteChatArchive(targetRoot);
  target.create({id:'existing'});target.saveMessage('existing',msg('existing-message','Не потерять'));
  const task=target.importStream(stream(lines),'application/x-ndjson');
  let finished=false;
  void task.then(()=>{finished=true;},()=>{finished=true;});
  let blocked=false;
  for(let i=0;i<500&&!blocked&&!finished;i++){
    // Poll across actual I/O turns; a tight setImmediate loop may finish
    // before the source stream has even completed its first pass.
    await new Promise(resolve=>setTimeout(resolve,2));
    if(target.isImporting()){
      blocked=true;
      assert.throws(()=>target.create({id:'racing'}),/импорт/);
      assert.throws(()=>target.saveMessage('existing',msg('racing','Нельзя потерять')),/импорт/);
      assert.throws(()=>target.page('long'),/импорт/);
    }
  }
  const result=await task;
  assert.equal(result.imported,350);
  assert.equal(target.page('existing').total,1);
  assert.equal(target.page('long').total,350);
  assert.equal(target.isImporting(),false);
  target.saveMessage('existing',msg('after','После завершения'));
  assert.equal(target.page('existing').total,2);
  assert.equal(blocked,true,'Длительная транзакция импорта должна изолировать остальные запросы');
  await target.shutdown();await source.shutdown();
});

test('Долгий экспорт не меняется от новых сообщений: создаёт согласованный снимок и удаляет временный файл',async t=>{
  const root=await temp(t),restoredDir=await temp(t),store=await openSqliteChatArchive(root);
  store.create({id:'snapshot'});store.saveMessage('snapshot',msg('first','Было в момент старта'));
  const iterator=store.exportLines();
  const first=await iterator.next();
  assert.equal(first.done,false);
  store.saveMessage('snapshot',msg('second','Появилось после старта'));
  const lines=[first.value];
  for await(const line of iterator)lines.push(line);
  const restored=await openSqliteChatArchive(restoredDir);
  const count=await restored.importStream(stream(lines),'application/x-ndjson');
  assert.equal(count.imported,1);
  assert.equal(restored.page('snapshot').total,1);
  assert.equal(store.page('snapshot').total,2);
  assert.equal((await readdir(join(root,'chats'))).filter(x=>x.startsWith('export-')).length,0);
  await restored.shutdown();await store.shutdown();
});

test('Незавершённый экспорт очищает временный SQLite снимок',async t=>{
  const root=await temp(t),store=await openSqliteChatArchive(root);
  store.create({id:'abort'});store.saveMessage('abort',msg('first','Исходный'));
  const iterator=store.exportLines();
  assert.equal((await iterator.next()).done,false);
  assert.ok((await readdir(join(root,'chats'))).some(x=>x.startsWith('export-')));
  await iterator.return();
  assert.equal((await readdir(join(root,'chats'))).filter(x=>x.startsWith('export-')).length,0);
  await store.shutdown();
});

test('Проверка резервной копии не принимает манифест, из которого удалили учтённое вложение',async t=>{
  const root=await temp(t),store=await openSqliteChatArchive(root);
  const maintenance=openChatMaintenance(store,root,{automatic:false});
  store.create({id:'with-attachment'});
  store.saveMessage('with-attachment',msg('message','С вложением'));
  await maintenance.saveAttachment('with-attachment',Buffer.from('image'),'application/octet-stream','photo.dat','message');
  const snapshot=await maintenance.backupNow();
  assert.equal(snapshot.ok,true,JSON.stringify(snapshot));
  assert.equal((await maintenance.verifyBackup(snapshot.directory)).ok,true);
  const manifestFile=join(snapshot.directory,'manifest.json');
  const doc=JSON.parse(await readFile(manifestFile,'utf8'));
  doc.attachments=[];
  await writeFile(manifestFile,JSON.stringify(doc));
  const result=await maintenance.verifyBackup(snapshot.directory);
  assert.equal(result.ok,false);
  assert.ok(result.issues.some(x=>x.includes('Манифест')));
  await maintenance.shutdown();await store.shutdown();
});

test('Фоновая проверка обнаруживает вложение без записи SQLite после сбоя файловой операции',async t=>{
  const root=await temp(t),store=await openSqliteChatArchive(root);
  const maintenance=openChatMaintenance(store,root,{automatic:false});
  await mkdir(join(root,'chats','attachments'),{recursive:true});
  await writeFile(join(root,'chats','attachments','orphan-a.blob'),'лишние данные');
  assert.ok((await maintenance.inspectAttachments()).some(text=>text.includes('Незарегистрированное вложение')));
  await maintenance.shutdown();await store.shutdown();
});

test('Проверка бэкапа и автоматическая копия не вмешиваются в активную транзакцию импорта',async t=>{
  const root=await temp(t),store=await openSqliteChatArchive(root);
  const maintenance=openChatMaintenance(store,root,{automatic:false});
  const original=backup([chat('foo','Правильный текст')]);
  assert.deepEqual(store.importLegacy(original),{imported:1,conversations:1});
  const current=await maintenance.check();
  assert.equal(current.ok,true);
  await maintenance.shutdown();await store.shutdown();
});
