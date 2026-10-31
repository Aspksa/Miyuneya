import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, batLaunch, waitReady, stop } from './helpers/lifecycle.mjs';

if(process.platform==='win32'){
  const cleanPath=join(process.env.SystemRoot,'System32')+';'+process.env.SystemRoot;
  test('Windows: переносимая версия запускается без администратора и без Python из OneDrive/кириллицы', {timeout:85000},async t=>{
    const root=await fixture(t,'OneDrive - Миюнэя & архивы (работа) ! ^ # %');
    const env={MIYUNEYA_OFFLINE:'1',MIYUNEYA_NO_OPEN:'1',
      PYTHON:'C:\\MissingPython\\python.exe',PYTHONHOME:'C:\\MissingPython',
      PATH:cleanPath};
    const child=batLaunch(root,env);const pointer=await waitReady(root,child,50000);
    const base='http://127.0.0.1:'+pointer.port;
    const create=await fetch(base+'/api/assistant/conversations',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({id:'portable-chat',title:'Проверка кириллицы и пробелов'})
    });
    assert.equal(create.status,201);
    const saved=await fetch(base+'/api/assistant/conversations/portable-chat/messages',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({message:{id:'portable-note',role:'user',
        content:'Данные не зависят от пути OneDrive и установки Python',
        createdAt:'2026-10-31T12:00:00.000Z',version:1,complete:true}})
    });
    assert.equal(saved.status,200,await saved.text());
    await stop(root,child);
    const again=batLaunch(root,env);const restarted=await waitReady(root,again,50000);
    const response=await fetch('http://127.0.0.1:'+restarted.port+
      '/api/assistant/conversations/portable-chat/messages');
    assert.equal(response.status,200);
    const archive=await response.json();
    assert.equal(archive.messages[0].content,'Данные не зависят от пути OneDrive и установки Python');
    assert.ok((await readdir(join(root,'data','chats'))).includes('archive.sqlite'));
    await stop(root,again);
    assert.equal((await readFile(join(root,'Miyuneya.bat'),'utf8')).includes('DisableDelayedExpansion'),true);
  });
  test('Windows: офлайн-запуск без portable Node сохраняет файлы и возвращает понятный отказ',{timeout:30000},async t=>{
    const root=await fixture(t,'OneDrive - Миюнэя офлайн');
    const executable=batLaunch(root,{MIYUNEYA_NODE:undefined,MIYUNEYA_OFFLINE:'1',PATH:cleanPath});
    const finished=await executable.closed;
    assert.equal(finished.code,20);
    assert.match(executable.errors,/Supported Node|Miyuneya failed|node/i);
    assert.ok((await readdir(root)).includes('Miyuneya.bat'));
  });
}
