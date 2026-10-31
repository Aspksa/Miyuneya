import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { openSqliteChatArchive } from '../server/chat-sqlite.ts';
import { openChatMaintenance } from '../server/chat-maintenance.ts';
const at='2026-10-31T12:00:00.000Z';
const msg=(id,content='Привет',version=1,complete=true,parentMessageId=undefined)=>({
  id,role:'user',content,createdAt:at,version,complete,parentMessageId
});
async function temporary(t){
  const root=await mkdtemp(join(tmpdir(),'miyuneya-sqlite-'));
  t.after(()=>rm(root,{force:true,recursive:true}));
  return root;
}
test('SQLite WAL, глобальные ID, версионные записи и реальное сохранение после перезапуска',async t=>{
  const root=await temporary(t),db=await openSqliteChatArchive(root);
  assert.equal((db.db.prepare('PRAGMA journal_mode').get()).journal_mode,'wal');
  assert.equal((db.db.prepare('PRAGMA synchronous').get()).synchronous,2);
  const c=db.create({id:'chat-1',title:'Русские сообщения'});
  assert.equal(c.conversation.messageCount,0);
  db.saveMessage('chat-1',msg('global-id','Первая запись'),0);
  db.saveMessage('chat-1',msg('global-id','Первая запись обновлена',2),1);
  assert.equal(db.page('chat-1').total,1);
  assert.equal(db.page('chat-1').messages[0].content,'Первая запись обновлена');
  db.create({id:'chat-2'});
  assert.throws(()=>db.saveMessage('chat-2',msg('global-id','Переиспользовать ID'),0),/constraint|UNIQUE|занят/i);
  assert.throws(()=>db.saveMessage('chat-1',msg('global-id','Старая версия',1),1),/ничего/); // never silently rewrite newer content
  assert.equal(db.page('chat-1').messages[0].content,'Первая запись обновлена');
  await db.shutdown();
  const again=await openSqliteChatArchive(root);
  assert.equal(again.page('chat-1').messages[0].content,'Первая запись обновлена');
  assert.equal(again.list().total,2);
  await again.shutdown();
});
test('FTS5 индексирует русский язык, даты и большие списки без чтения JSON в JS',async t=>{
  const root=await temporary(t),db=await openSqliteChatArchive(root);
  for(let i=0;i<112;i++){
    const id='c-'+i;db.create({id,title:'Разговор '+i});
    db.saveMessage(id,msg('m-'+i,i===97?'Путевые листы автомобиля':'Обычный диалог '+i),0);
  }
  const first=db.list();
  assert.equal(first.total,112);
  assert.equal(first.conversations.length,60);
  assert.equal(db.list({offset:60}).conversations.length,52);
  assert.equal(db.search({query:'Путевые листы'}).total,1);
  assert.equal(db.search({query:'Путевые листы'}).conversations[0].id,'c-97');
  assert.equal(db.quickCheck().ftsHealthy,true);
  db.db.exec("INSERT INTO message_fts(message_fts) VALUES('delete-all')");
  assert.equal(db.quickCheck().ftsHealthy,false);
  assert.deepEqual(db.rebuildSearch(),{ok:true});
  assert.equal(db.quickCheck().ftsHealthy,true);
  await db.shutdown();
});
test('Ветвление связывает сообщения и наследует историю без копирования',async t=>{
  const root=await temporary(t),db=await openSqliteChatArchive(root);
  db.create({id:'source',title:'Исходный чат'});
  db.saveMessage('source',msg('one','Первый'));
  db.saveMessage('source',msg('two','Второй'),1);
  db.saveMessage('source',msg('three','Третий'),2);
  const branch=db.create({id:'fork',title:'Ветка',parentId:'source',forkMessageId:'two'});
  assert.equal(branch.conversation.messageCount,2);
  assert.equal(branch.conversation.parentId,'source');
  assert.equal(db.page('fork').messages.map(m=>m.content).join('|'),'Первый|Второй');
  db.saveMessage('fork',msg('fork-1','Альтернативный ответ'),2);
  assert.equal(db.page('fork').messages[2].parentMessageId,'two');
  assert.equal(db.page('source').messages.length,3);
  assert.equal((db.db.prepare('SELECT COUNT(*) AS n FROM messages').get()).n,4);
  const nested=db.create({id:'nested',parentId:'fork',forkMessageId:'fork-1'});
  assert.equal(nested.conversation.messageCount,3);
  assert.equal(db.page('nested').messages[2].content,'Альтернативный ответ');
  assert.throws(()=>db.create({parentId:'source',forkMessageId:'missing'}),/не найдено/);
  await db.shutdown();
});
test('Отдельные вложения подтверждаются SHA-256 и не встраиваются в таблицу сообщений',async t=>{
  const root=await temporary(t),db=await openSqliteChatArchive(root);
  const m=openChatMaintenance(db,root,{automatic:false});
  db.create({id:'files'});db.saveMessage('files',msg('file-msg'));
  const bytes=Buffer.from('Проверка вложения','utf8');
  const saved=await m.saveAttachment('files',bytes,'text/plain','Проверка.txt','file-msg');
  assert.equal(saved.size,bytes.length);
  assert.equal(m.listAttachments('files').length,1);
  assert.deepEqual((await m.attachment('files',saved.id)).bytes,bytes);
  assert.equal(db.page('files').messages[0].content,'Привет');
  await writeFile(join(root,'chats','attachments',saved.id+'.blob'),'corrupt');
  await assert.rejects(m.attachment('files',saved.id),/Контрольная сумма/);
  await m.shutdown();await db.shutdown();
});
test('Создание ежедневной копии в WAL проверяет базу и вложения, повреждение обнаруживается',async t=>{
  const root=await temporary(t),db=await openSqliteChatArchive(root);
  const maintenance=openChatMaintenance(db,root,{automatic:false});
  db.create({id:'backup'});db.saveMessage('backup',msg('backup-msg','Долговременная история'));
  const photo=await maintenance.saveAttachment('backup',Buffer.from('blob-data'),'application/octet-stream','photo.bin');
  const saved=await maintenance.backupNow();
  assert.equal(saved.ok,true,JSON.stringify(saved));
  assert.equal((await maintenance.verifyBackup(saved.directory)).ok,true);
  assert.equal((await maintenance.statistics()).messages,1);
  assert.equal((await maintenance.statistics()).attachments,1);
  assert.equal((await maintenance.statistics()).backupAt!==null,true);
  const copy=new DatabaseSync(join(saved.directory,'archive.sqlite'),{readOnly:true});
  assert.equal((copy.prepare('SELECT content FROM messages').get()).content,'Долговременная история');
  copy.close();
  await writeFile(join(saved.directory,'attachments',photo.id+'.blob'),'bad');
  assert.equal((await maintenance.verifyBackup(saved.directory)).ok,false);
  await maintenance.shutdown();await db.shutdown();
});
test('Миграция JSON v2 в SQLite сохраняет старый исходный файл неизменным',async t=>{
  const root=await temporary(t),home=join(root,'chats');
  await mkdir(home,{recursive:true});
  const history={schema:2,revision:5,selectedId:'legacy-a',conversations:[{
    id:'legacy-a',title:'Исторический',createdAt:at,updatedAt:at,messageCount:2,archived:false
  }]};
  await mkdir(join(home,'conversations','legacy-a'),{recursive:true});
  await writeFile(join(home,'manifest.json'),JSON.stringify(history));
  await writeFile(join(home,'conversations','legacy-a','meta.json'),JSON.stringify(history.conversations[0]));
  for(const [i,content] of ['Самая первая','Самая вторая'].entries()){
    const id='legacy-'+String(i+1).padStart(12,'0');
    await writeFile(join(home,'conversations','legacy-a',String(i+1).padStart(12,'0')+'_'+id+'.json'),
      JSON.stringify({id,role:'user',content,createdAt:at,version:1,complete:true}));
  }
  const before=await readFile(join(home,'manifest.json'),'utf8');
  const db=await openSqliteChatArchive(root);
  assert.equal(db.page('legacy-a').total,2);
  assert.equal(db.page('legacy-a').messages[0].content,'Самая первая');
  assert.equal(await readFile(join(home,'manifest.json'),'utf8'),before);
  await db.shutdown();
  const reopened=await openSqliteChatArchive(root);
  assert.equal(reopened.page('legacy-a').total,2);
  await reopened.shutdown();
});
test('JSONL контрольная SHA256 защищает от обрыва и допускает идемпотентное восстановление',async t=>{
  const a=await temporary(t),b=await temporary(t);
  const source=await openSqliteChatArchive(a);
  source.create({id:'export'});source.saveMessage('export',msg('export-msg','Кириллица и документы'));
  const lines=[];for await(const line of source.exportLines())lines.push(line);
  const target=await openSqliteChatArchive(b);
  await assert.rejects(target.importStream(Readable.from(lines.slice(0,-1).map(Buffer.from)),
    'application/x-ndjson'),/оборвана/);
  assert.equal(target.list().total,0);
  const result=await target.importStream(Readable.from(lines.map(Buffer.from)),'application/x-ndjson');
  assert.equal(result.imported,1);assert.equal(target.page('export').messages[0].content,'Кириллица и документы');
  const duplicate=await target.importStream(Readable.from(lines.map(Buffer.from)),'application/x-ndjson');
  assert.equal(duplicate.imported,1);assert.equal(target.page('export').total,1);
  await target.shutdown();await source.shutdown();
});
test('Статистика доступна без сканирования сообщений и показывает предупреждения',async t=>{
  const root=await temporary(t),db=await openSqliteChatArchive(root);
  const m=openChatMaintenance(db,root,{automatic:false});
  db.create({id:'metrics'});db.saveMessage('metrics',msg('metric-msg'));
  const status=await m.statistics();
  assert.equal(status.messages,1);assert.equal(status.wal,true);
  assert.ok(status.operations.some(x=>x.name==='save'));
  assert.ok(status.warnings.some(x=>x.includes('резервной копии')));
  await m.shutdown();await db.shutdown();
});
