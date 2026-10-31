import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { openSqliteChatArchive } from '../server/chat-sqlite.ts';
import { openChatMaintenance } from '../server/chat-maintenance.ts';
import { fixture, nodeLaunch, waitReady, stop } from './helpers/lifecycle.mjs';
import { prepareUpdate } from '../scripts/update.mjs';

const stamp='2026-10-31T12:00:00.000Z';
const message=(id,content,date=stamp)=>({id,role:'user',content,createdAt:date,version:1,complete:true});
async function fresh(t){
  const root=await mkdtemp(join(tmpdir(),'Miyuneya-operations-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  return root;
}
test('Навигация по истории: сообщение, дата, точка ветвления и пропавшая запись',async t=>{
  const root=await fresh(t),db=await openSqliteChatArchive(root);
  db.create({id:'source'});
  for(let i=0;i<130;i++)
    db.saveMessage('source',message('m-'+i,'Документ '+i,
      i<70?'2026-01-01T00:00:00.000Z':'2026-08-10T00:00:00.000Z'));
  db.create({id:'branch',parentId:'source',forkMessageId:'m-80'});
  db.saveMessage('branch',message('answer','Ответ ветки','2026-10-20T00:00:00.000Z'));
  const found=db.locate('branch',{messageId:'m-75'});
  assert.equal(found.targetMessageId,'m-75');
  assert.ok(found.messages.some(m=>m.id==='m-75'));
  assert.equal(found.conversation.parentId,'source');
  assert.throws(()=>db.locate('branch',{messageId:'m-100'}),/не найдено/);
  const date=db.locate('branch',{date:'2026-08-10'});
  assert.equal(date.targetMessageId,'m-70');
  const today=db.locate('branch',{date:'2026-10-20'});
  assert.equal(today.targetMessageId,'answer');
  assert.throws(()=>db.locate('branch',{date:'2027-01-01'}),/нет/);
  assert.throws(()=>db.locate('branch',{date:'9999-99-99'}),/формате/);
  await db.shutdown();
});
test('Расписание обслуживания, журнал без переписки и безопасная проверка обновления',async t=>{
  const root=await fresh(t),db=await openSqliteChatArchive(root),worker= openChatMaintenance(db,root,{automatic:false});
  db.create({id:'private'});
  db.saveMessage('private',message('secret','PRIVATE_BODY_NO_LOG_345619'));
  assert.equal(worker.configureMaintenance(15).intervalMinutes,15);
  assert.throws(()=>worker.configureMaintenance(1),/15, 30 или 60/);
  const preflight=await worker.postUpdatePreflight();
  assert.equal(preflight.ok,true,JSON.stringify(preflight));
  assert.equal(preflight.schemaVersion,4);
  const checked=await worker.check();
  assert.equal(checked.ok,true);
  const wal=await worker.inspectWal();
  assert.equal(wal.ok,true);
  const backup=await worker.backupNow();
  assert.equal(backup.ok,true,JSON.stringify(backup));
  const status=await worker.maintenanceLog();
  assert.ok(status.events.some(e=>e.operation==='check'));
  assert.ok(status.events.some(e=>e.operation==='backup'));
  assert.ok(status.events.some(e=>e.operation==='update-preflight'));
  assert.ok(status.events.every(e=>/^[a-z0-9-]{1,50}$/.test(e.code)));
  const file=await readFile(join(root,'chat-backups','maintenance-events.jsonl'),'utf8');
  assert.equal(file.includes('PRIVATE_BODY_NO_LOG_345619'),false);
  assert.equal(file.includes('SELECT '),false);
  await worker.shutdown();await db.shutdown();
});
test('Поиск, записи и резервирование одновременно не искажают сохранённые сообщения',async t=>{
  const root=await fresh(t),db=await openSqliteChatArchive(root),worker=openChatMaintenance(db,root,{automatic:false});
  db.create({id:'load'});
  for(let i=0;i<140;i++)db.saveMessage('load',message('msg-'+i,'Водитель '+i+' · документы'));
  const pending=[
    db.searchAdvanced({query:'водитель',limit:60}),
    db.searchAdvanced({query:'документы',limit:20}),
    worker.backupNow()
  ];
  for(let i=140;i<175;i++)db.saveMessage('load',message('msg-'+i,'Водитель '+i+' · документы'));
  const [find,found,copy]=await Promise.all(pending);
  assert.equal(find.total,1);
  assert.equal(found.total,1);
  assert.equal(copy.ok,true,JSON.stringify(copy));
  assert.equal(db.page('load').total,175);
  const previous=await worker.verifyBackup(copy.directory);
  assert.equal(previous.ok,true);
  assert.ok((await stat(join(copy.directory,'archive.sqlite'))).size>0);
  await worker.shutdown();await db.shutdown();
});
test('Откат обновления: приложение не принимает релиз с неработающей SQLite preflight', {timeout:110000},async t=>{
  const root=await fixture(t,'Миюнэя обновления & русский путь (2026)');
  const file=join(root,'scripts','chat-archive-worker.mjs');
  const original=await readFile(file,'utf8');
  const damaged=original.replace('const ok=version===4&&!missing.length&&quick===\\'ok\\'&&!foreign&&fts;',
    'const ok=false;');
  assert.notEqual(damaged,original,'Preflight fixture must mutate exact condition');
  const folder=join(root,'.runtime','candidate');await mkdir(folder,{recursive:true});
  await mkdir(join(folder,'scripts'),{recursive:true});
  await writeFile(join(folder,'scripts','chat-archive-worker.mjs'),damaged);
  const sha256=createHash('sha256').update(damaged).digest('hex');
  await writeFile(join(folder,'update.json'),JSON.stringify({schema:1,version:'0.5.2',
    files:[{path:'scripts/chat-archive-worker.mjs',sha256}]}));
  await prepareUpdate(root,folder);
  const child=nodeLaunch(root,{MIYUNEYA_OFFLINE:'1',PYTHON:'absent-python'});
  const pointer=await waitReady(root,child,70000);
  assert.ok(pointer.port>0);
  assert.equal(await readFile(file,'utf8'),original);
  assert.match(child.errors,/предыдущие файлы восстановлены/);
  assert.ok((await readdir(join(root,'.runtime','updates'))).some(x=>x.startsWith('rejected-')));
  await stop(root,child);
});
