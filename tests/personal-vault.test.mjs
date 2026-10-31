import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { openChatArchive } from '../server/chat-archive.ts';
import { openPersonalVault } from '../server/personal-vault.ts';

async function temp(t) {
  const root=await mkdtemp(join(tmpdir(),'miyuneya-chat-longterm-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  return root;
}
const timestamp='2026-10-31T00:00:00.000Z';
const message=(id,role='user',content='Текст',version=1,complete=true)=>
  ({id,role,content,createdAt:timestamp,version,complete});

test('Постоянный чат: отдельные файлы, страницы истории и восстановление после перезапуска',async t=>{
  const root=await temp(t),archive=await openChatArchive(root);
  await archive.create({id:'conversation-1',title:'Первый разговор'});
  for(let i=0;i<205;i++){
    const id='msg-'+i;
    await archive.saveMessage('conversation-1',message(id,i%2?'assistant':'user','Данные '+i),i);
  }
  let page=await archive.page('conversation-1',undefined,100);
  assert.equal(page.total,205);
  assert.equal(page.messages.length,100);
  assert.equal(page.nextBefore,105);
  assert.equal(page.messages[0].content,'Данные 105');
  assert.equal((await archive.search({query:'Данные 2'})).total,1);
  assert.equal((await archive.search({query:'Данные 2'})).conversations[0].id,'conversation-1');
  page=await archive.page('conversation-1',page.nextBefore,100);
  assert.equal(page.messages[0].content,'Данные 5');
  assert.equal(page.nextBefore,5);
  page=await archive.page('conversation-1',page.nextBefore,100);
  assert.equal(page.messages[0].content,'Данные 0');
  assert.equal(page.nextBefore,null);
  const reopened=await openChatArchive(root);
  assert.equal(reopened.list().conversations[0].messageCount,205);
  assert.equal((await reopened.page('conversation-1',205,1)).messages[0].content,'Данные 204');
});

test('Контрольные сохранения стрима сохраняют частичный ответ, не дублируя сообщения',async t=>{
  const root=await temp(t),archive=await openChatArchive(root);
  await archive.create({id:'stream'});
  await archive.saveMessage('stream',message('user','user','Вопрос'),0);
  await archive.saveMessage('stream',message('reply','assistant','Начало',1,false),1);
  await archive.saveMessage('stream',message('reply','assistant','Начало ответа',2,false),2);
  const afterCrash=await openChatArchive(root);
  assert.equal((await afterCrash.page('stream')).messages[1].content,'Начало ответа');
  assert.equal((await afterCrash.page('stream')).messages[1].complete,false);
  await afterCrash.saveMessage('stream',message('reply','assistant','Начало ответа. Конец.',3,true),2);
  assert.equal((await afterCrash.page('stream')).total,2);
  const final=(await afterCrash.page('stream')).messages[1];
  assert.equal(final.complete,true);
  assert.equal(final.content,'Начало ответа. Конец.');
  await assert.rejects(afterCrash.saveMessage('stream',message('new','user','Конфликт'),1),
    e=>e.status===409);
  await assert.rejects(afterCrash.saveMessage('stream',message('reply','user','Подмена',4,true),2),
    e=>e.status===409);
  assert.equal((await openChatArchive(root)).list().conversations[0].messageCount,2);
});

test('Архивирование обратимо: старые сообщения не удаляются и экспортируются',async t=>{
  const root=await temp(t),archive=await openChatArchive(root);
  await archive.create({id:'old',title:'Не стирать'});
  await archive.saveMessage('old',message('one','user','Очень важное'),0);
  await archive.modify('old',{archived:true});
  assert.equal(archive.list().total,0);
  assert.equal(archive.list({archived:true}).total,1);
  assert.equal((await archive.page('old')).messages[0].content,'Очень важное');
  await assert.rejects(archive.saveMessage('old',message('two','user','Тест')),e=>e.status===409);
  await archive.modify('old',{archived:false});
  assert.equal(archive.list().total,1);
  const exportContent=[];
  for await(const line of archive.exportLines())exportContent.push(line);
  const restoreRoot=await temp(t),restored=await openChatArchive(restoreRoot);
  const result=await restored.importStream(Readable.from(exportContent.map(line=>Buffer.from(line))),
    'application/x-ndjson');
  assert.equal(result.imported,1);
  assert.equal((await restored.page('old')).messages[0].content,'Очень важное');
  const again=await restored.importStream(Readable.from(exportContent.map(line=>Buffer.from(line))),
    'application/x-ndjson');
  assert.equal(again.imported,1);
  assert.equal((await restored.page('old')).total,1); // repeated import is idempotent
  await assert.rejects(restored.importStream(
    Readable.from(exportContent.slice(0,-1).map(line=>Buffer.from(line))),'application/x-ndjson'),
    /контрольная запись/);
  const tampered=exportContent.map(line=>line.replace('Очень важное','Подменённое содержимое'));
  await assert.rejects(restored.importStream(
    Readable.from(tampered.map(line=>Buffer.from(line))),'application/x-ndjson'),
    /Импорт не может заменить/);
  assert.equal((await restored.page('old')).messages[0].content,'Очень важное');
});

test('Переносит старый index.json без удаления оригинала, даже после прерванного обновления',async t=>{
  const root=await temp(t);
  const home=join(root,'chats');
  await mkdir(home,{recursive:true});
  const legacy={revision:12,selectedId:'old-chat',conversations:[
    {id:'old-chat',title:'Историческая переписка',createdAt:timestamp,updatedAt:timestamp,
      messages:[{role:'user',content:'Ничего не терять'},{role:'assistant',content:'Сохранено'}]}
  ]};
  const original=JSON.stringify(legacy);
  await writeFile(join(home,'index.json'),original);
  const migrated=await openChatArchive(root);
  assert.equal(migrated.list().selectedId,'old-chat');
  assert.equal((await migrated.page('old-chat')).messages.length,2);
  assert.equal(await readFile(join(home,'index.json'),'utf8'),original);
  const manifest=join(home,'manifest.json');
  const record=JSON.parse(await readFile(manifest,'utf8'));
  record.conversations[0].messageCount=1;
  await writeFile(manifest,JSON.stringify(record));
  const recovered=await openChatArchive(root);
  assert.equal(recovered.list().conversations[0].messageCount,2);
  assert.equal((await recovered.page('old-chat')).messages[1].content,'Сохранено');
  assert.equal(await readFile(join(home,'index.json'),'utf8'),original);
});

test('Повреждение архива блокирует перезапись исходников',async t=>{
  const root=await temp(t),archive=await openChatArchive(root);
  await archive.create({id:'important'});
  await archive.saveMessage('important',message('message','user','Важные данные'));
  const file=join(root,'chats','manifest.json');
  await writeFile(file,'{bad-json');
  await assert.rejects(openChatArchive(root),/Повреждён архив/);
  assert.equal(await readFile(file,'utf8'),'{bad-json');
  const files=await readdir(join(root,'chats','conversations','important'));
  assert.ok(files.some(name=>name.endsWith('_message.json')));
});

test('Число разговоров не ограничено сотней; страницы остаются компактными',async t=>{
  const root=await temp(t),archive=await openChatArchive(root);
  for(let i=0;i<105;i++)await archive.create({id:'chat-'+i,title:'Разговор '+i});
  const first=archive.list();
  assert.equal(first.total,105);
  assert.equal(first.conversations.length,60);
  assert.equal(archive.list({offset:60,limit:60}).conversations.length,45);
  assert.equal((await openChatArchive(root)).list().total,105);
});

test('Старая браузерная JSON-копия импортируется без перезаписи новой переписки',async t=>{
  const root=await temp(t),archive=await openChatArchive(root);
  await archive.create({id:'newer'});
  await archive.saveMessage('newer',message('fresh','user','После резервной копии'),0);
  const backup={revision:0,selectedId:'older',conversations:[
    {id:'older',title:'Резервная копия',createdAt:timestamp,updatedAt:timestamp,
      messages:[{role:'user',content:'До копии'}]}
  ]};
  const bytes=Buffer.from(JSON.stringify(backup));
  const split=bytes.indexOf(Buffer.from('До копии'))+1;
  const result=await archive.importStream(Readable.from([bytes.subarray(0,split),bytes.subarray(split)]),'application/json');
  assert.equal(result.imported,1);
  assert.equal(archive.list().total,2);
  assert.equal((await archive.page('newer')).messages[0].content,'После резервной копии');
  assert.equal((await archive.page('older')).messages[0].content,'До копии');
});

test('Настройки образов остаются совместимы с отдельным хранилищем',async t=>{
  const root=await temp(t),vault=await openPersonalVault(root);
  await vault.patchPreferences({avatar:{size:180,glow:true}});
  await vault.patchPreferences({selectedAvatar:'fox'});
  assert.deepEqual((await openPersonalVault(root)).preferences(),
    {avatar:{size:180,glow:true},selectedAvatar:'fox'});
  await assert.rejects(vault.patchPreferences({apiKey:'secret'}),e=>e.status===400);
  assert.doesNotMatch(await readFile(join(root,'ui-preferences.json'),'utf8'),/secret/);
});
