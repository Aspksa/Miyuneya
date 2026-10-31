import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,mkdir,rm,utimes,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {openSqliteChatArchive} from '../server/chat-sqlite.ts';
import {openChatMaintenance} from '../server/chat-maintenance.ts';
import {ensureSpace} from '../server/chat-db-safety.ts';

const date='2026-10-31T08:12:00.000Z';
const message=(id,content)=>({id,role:'user',content,createdAt:date,version:1,complete:true});
const fixture=async t=>{
  const directory=await mkdtemp(join(tmpdir(),'miyuneya-db-advanced-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  return directory;
};
test('Новая SQLite v4, WAL, оптимизированные индексы и точное чтение после сбоя записи',async t=>{
  const root=await fixture(t),store=await openSqliteChatArchive(root);
  assert.equal(store.db.prepare('PRAGMA user_version').get().user_version,4);
  assert.equal(store.db.prepare('PRAGMA synchronous').get().synchronous,2);
  const explain=store.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM messages WHERE conversation_id=? AND created_at>? ORDER BY created_at DESC').all('a',date);
  assert.ok(explain.some(row=>String(row.detail).includes('messages_conversation_created')),JSON.stringify(explain));
  store.create({id:'a'});
  assert.throws(()=>store.saveMessage('a',{...message('bad','wrong'),version:0},0),/сообщение/);
  assert.equal(store.page('a').total,0);
  store.saveMessage('a',message('good','Сохранено'),0);
  assert.throws(()=>store.saveMessage('a',message('other','Не записывать'),0),/вкладка/);
  assert.equal(store.page('a').total,1);
  await store.shutdown();
  const reopened=await openSqliteChatArchive(root);
  assert.equal(reopened.page('a').messages[0].content,'Сохранено');
  await reopened.shutdown();
});
test('Запрет второго писателя; осиротевшая блокировка восстанавливается безопасно',async t=>{
  const root=await fixture(t),store=await openSqliteChatArchive(root);
  await assert.rejects(openSqliteChatArchive(root),/другим работающим экземпляром/);
  await store.shutdown();
  const lock=join(root,'chats','archive.sqlite.writer.lock');
  await writeFile(lock,JSON.stringify({pid:999999999,token:'dead',createdAt:date}));
  await utimes(lock,new Date('2025-01-01'),new Date('2025-01-01'));
  const recovered=await openSqliteChatArchive(root);
  recovered.create({id:'recovered'});
  await recovered.shutdown();
  assert.equal((await stat(lock).catch(()=>null)),null);
});
test('Переход SQLite v3 на v4 создаёт рабочую проверенную копию старой базы',async t=>{
  const root=await fixture(t);
  const store=await openSqliteChatArchive(root);
  store.create({id:'migration'});store.saveMessage('migration',message('original','Нельзя потерять'));
  store.db.exec('PRAGMA user_version=3');
  await store.shutdown();
  const upgraded=await openSqliteChatArchive(root);
  assert.equal(upgraded.page('migration').messages[0].content,'Нельзя потерять');
  assert.equal(upgraded.db.prepare('PRAGMA user_version').get().user_version,4);
  const snapshots=await readdir(join(root,'chats','migrations'));
  assert.ok(snapshots.some(name=>name.startsWith('before-v4-')));
  await upgraded.shutdown();
});
test('Индексированный поиск знает русские формы, фразы, даты и наследование веток',async t=>{
  const root=await fixture(t),store=await openSqliteChatArchive(root);
  store.create({id:'original',title:'Документация'});
  store.saveMessage('original',message('first','Путевые листы автомобиля и водители'));
  store.saveMessage('original',message('second','Ремонт двигателя'));
  store.create({id:'fork',parentId:'original',forkMessageId:'first',title:'Ветка'});
  store.saveMessage('fork',message('fork-answer','Замена масла'));
  store.create({id:'another',title:'Финансы'});
  store.saveMessage('another',message('other','Счёт и документы'));
  const morphology=await store.searchAdvanced({query:'путевым листам'});
  assert.equal(morphology.total,2,JSON.stringify(morphology));
  assert.deepEqual(new Set(morphology.conversations.map(c=>c.id)),new Set(['original','fork']));
  assert.ok(morphology.conversations.some(c=>c.matchSnippet?.includes('‹')));
  const phrase=await store.searchAdvanced({query:'Путевые листы',mode:'phrase'});
  assert.equal(phrase.total,2);
  const phraseMiss=await store.searchAdvanced({query:'листы путевые',mode:'phrase'});
  assert.equal(phraseMiss.total,0);
  const phraseStop=await store.searchAdvanced({query:'путевые и листы',mode:'phrase'});
  assert.equal(phraseStop.total,0);
  const exact=await store.searchAdvanced({query:'документы',mode:'exact',sort:'date'});
  assert.equal(exact.total,1);
  const absent=await store.searchAdvanced({query:'Ремонт двигателя'});
  assert.deepEqual(absent.conversations.map(c=>c.id),['original']);
  await store.shutdown();
});
test('Опечатки ищутся только по близким словам и не создают новые записи',async t=>{
  const root=await fixture(t),store=await openSqliteChatArchive(root);
  store.create({id:'typos'});
  store.saveMessage('typos',message('content','Автомобиль с водителем'));
  assert.equal((await store.searchAdvanced({query:'автомбиль',mode:'exact'})).total,0);
  const result=await store.searchAdvanced({query:'автомбиль',mode:'exact',typos:true});
  assert.equal(result.total,1,JSON.stringify(result));
  assert.equal(result.conversations[0].id,'typos');
  assert.equal(store.page('typos').total,1);
  await store.shutdown();
});
test('Индексы, страничный кэш и метрики не меняют оригинальные сообщения',async t=>{
  const root=await fixture(t),store=await openSqliteChatArchive(root);
  store.create({id:'cache'});
  for(let i=0;i<170;i++)store.saveMessage('cache',message('cache-'+i,'Текст '+i));
  const first=store.page('cache',undefined,100);
  first.messages[0].content='Подмена в браузере';
  assert.notEqual(store.page('cache',undefined,100).messages[0].content,'Подмена в браузере');
  const older=store.page('cache',70,50);
  assert.equal(older.messages.length,50);
  assert.equal(older.nextBefore,20);
  store.saveMessage('cache',message('latest','Новая запись'));
  assert.equal(store.page('cache').total,171);
  assert.ok(store.timings.get('page').count>=4);
  await store.shutdown();
});
test('Проверка графа находит некорректные ветки и нарушения внешних ключей',async t=>{
  const root=await fixture(t),store=await openSqliteChatArchive(root);
  const maint=openChatMaintenance(store,root,{automatic:false});
  store.create({id:'owner'});store.saveMessage('owner',message('owner-1','Первая запись'));
  store.create({id:'child',parentId:'owner',forkMessageId:'owner-1'});
  assert.equal((await maint.check()).ok,true);
  store.db.exec('PRAGMA foreign_keys=OFF');
  store.db.prepare('UPDATE conversations SET parent_id=? WHERE id=?').run('absent','child');
  store.db.exec('PRAGMA foreign_keys=ON');
  const failed=await maint.check();
  assert.equal(failed.ok,false);
  assert.ok(failed.foreignKeys.length||failed.graphIssues.length);
  assert.equal(store.readOnly(),true);
  assert.throws(()=>store.saveMessage('owner',message('no-write','После ошибки')),/только чтения/);
  await maint.shutdown();await store.shutdown();
});
test('Проверка вложений обнаруживает пропавшие файлы и неверные ссылки',async t=>{
  const root=await fixture(t),store=await openSqliteChatArchive(root);
  const maint=openChatMaintenance(store,root,{automatic:false});
  store.create({id:'files'});store.saveMessage('files',message('doc','Важный файл'));
  const saved=await maint.saveAttachment('files',Buffer.from('data'),'text/plain','Тест.txt','doc');
  assert.deepEqual(await maint.inspectAttachments(),[]);
  await rm(join(root,'chats','attachments',saved.id+'.blob'));
  assert.ok((await maint.inspectAttachments()).some(x=>x.includes('файл')));
  await maint.shutdown();await store.shutdown();
});
test('Файловая система проверяется до записи; внешняя копия не может остаться на том же диске',async t=>{
  const root=await fixture(t),store=await openSqliteChatArchive(root);
  const maint=openChatMaintenance(store,root,{automatic:false});
  await assert.rejects(ensureSpace(join(root,'chats'),Number.MAX_SAFE_INTEGER,'тест'),/Недостаточно места/);
  await assert.rejects(maint.configureExternal(root),/другой диск|другой файловой системе/);
  await assert.rejects(maint.configureExternal('несуществующая папка'),/абсолютный путь/);
  assert.deepEqual(maint.externalConfiguration(),{configured:false,destination:null});
  await maint.shutdown();await store.shutdown();
});
test('Отчёт SQLite показывает WAL и аномалии роста без раскрытия текста сообщений',async t=>{
  const root=await fixture(t),store=await openSqliteChatArchive(root);
  const maint=openChatMaintenance(store,root,{automatic:false});
  store.create({id:'stats'});store.saveMessage('stats',message('large','Текст отчёта'));
  store.setSetting('growthBaseline',JSON.stringify({bytes:1,messages:1}));
  const stats=await maint.statistics();
  assert.ok(Number.isSafeInteger(stats.walBytes));
  assert.ok(Number.isSafeInteger(stats.dbFileBytes));
  assert.ok(stats.warnings.some(w=>w.includes('резко вырос')));
  assert.ok(!JSON.stringify(stats).includes('Текст отчёта'));
  await maint.shutdown();await store.shutdown();
});

test('Аварийное завершение процесса: WAL и запись пользователя восстанавливаются при новом запуске',async t=>{
  const root=await fixture(t);
  const moduleUrl=new URL('../server/chat-sqlite.ts',import.meta.url).href;
  const script="const {openSqliteChatArchive}=await import("+JSON.stringify(moduleUrl)+");"+
    "const s=await openSqliteChatArchive("+JSON.stringify(root)+");"+
    "s.create({id:'crash'});s.saveMessage('crash',{id:'durable',role:'user',content:'Сохранено до аварии',"+
    "createdAt:'2026-10-31T08:12:00.000Z',version:1,complete:true});process.exit(0);";
  const proc=spawn(process.execPath,['--input-type=module','-e',script],{
    stdio:['ignore','pipe','pipe'],windowsHide:true});
  let output='';
  proc.stderr.on('data',chunk=>{output+=chunk.toString();});
  const code=await new Promise((resolve,reject)=>{
    proc.once('error',reject);proc.once('exit',resolve);
  });
  assert.equal(code,0,output);
  const restored=await openSqliteChatArchive(root);
  assert.equal(restored.page('crash').messages[0].content,'Сохранено до аварии');
  await restored.shutdown();
});
