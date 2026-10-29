import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { removeTemp, fixture, nodeLaunch, waitReady, stop } from './helpers/lifecycle.mjs';
import { createApp } from '../server/app.ts';
import { emptyWorkspace, validateWorkspace, searchNotes, combineEntries } from '../src/model.ts';

test('Validation and Russian full-text search', () => {
  const data=emptyWorkspace(); assert.ok(validateWorkspace(data));
  data.notes.push({id:'n1',title:'Транспорт',body:'Проверить путевые листы',updatedAt:new Date().toISOString()});
  assert.equal(searchNotes(data.notes,'ПУТЕВЫЕ').length,1);
  assert.equal(searchNotes(data.notes,'missing').length,0);
  assert.ok(validateWorkspace(data));
  assert.equal(validateWorkspace({...data,notes:[...data.notes,...data.notes]}),false);
  assert.equal(validateWorkspace({...data,settings:{theme:'bad',name:'X'}}),false);
  assert.equal(validateWorkspace({...data,tasks:[{id:'t',title:'X',done:'yes',createdAt:'bad'}]}),false);
});

test('Notes and tasks share one list', () => {
  const data=emptyWorkspace();
  data.notes.push({id:'n1',title:'Идея',body:'Купить лампу',updatedAt:'2026-10-02T10:00:00Z'});
  data.tasks.push({id:'t1',title:'Позвонить',done:false,createdAt:'2026-10-03T10:00:00Z'},{id:'t2',title:'Лампа',done:true,createdAt:'2026-10-05T10:00:00Z'});
  assert.deepEqual(combineEntries(data,'').map(e=>e.item.id),['t1','n1','t2']);
  assert.deepEqual(combineEntries(data,'ЛАМП').map(e=>e.item.id),['n1','t2']);
  assert.deepEqual(combineEntries(data,'','notes').map(e=>e.item.id),['n1']);
  assert.deepEqual(combineEntries(data,'','active').map(e=>e.item.id),['t1']);
  assert.deepEqual(combineEntries(data,'','done').map(e=>e.item.id),['t2']);
});

test('HTTP storage, revision conflicts, restart, allowlist and origin checks', async t => {
  const root=await mkdtemp(join(tmpdir(),'Miyuneya данные '));
  await mkdir(join(root,'dist')); await writeFile(join(root,'dist','index.html'),'<html lang="ru">Miyuneya</html>');
  let server;
  t.after(async()=>{await server?.shutdown();await removeTemp(root);});
  async function start(){server=await createApp(root,'test');server.listen(0,'127.0.0.1');await once(server,'listening');return `http://127.0.0.1:${server.address().port}`;}
  let url=await start();
  const get=await fetch(url+'/api/workspace'); const initial=await get.json(); assert.equal(initial.revision,0);
  assert.equal((await fetch(url)).status,200);
  assert.equal((await fetch(url+'/data/workspace.json')).status,404);
  assert.equal((await fetch(url+'/__proto__')).status,404);
  assert.equal((await fetch(url+'/api/workspace',{headers:{Origin:'https://evil.example'}})).status,403);
  const wrongHost=await new Promise((resolve,reject)=>{const req=request(url,{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
  assert.equal(wrongHost,403);
  assert.equal((await fetch(url,{method:'HEAD'})).status,200);
  assert.match(get.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  const data=emptyWorkspace();
  data.notes.push({id:'n',title:'Лиса & <script>',body:'Белый снег 🦊',updatedAt:new Date().toISOString()});
  const put=(revision,value=data)=>fetch(url+'/api/workspace',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,data:value})});
  assert.equal((await put(0)).status,200);
  assert.equal((await put(0)).status,409);
  assert.equal((await put(1,{broken:true})).status,400);
  assert.equal((await fetch(url+'/api/workspace',{method:'PUT',body:'{}'})).status,415);
  assert.equal((await fetch(url+'/api/workspace',{method:'PUT',headers:{'Content-Type':'application/json'},body:'{'})).status,400);
  const race=await Promise.all([put(1),put(1)]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
  const saved=JSON.parse(await readFile(join(root,'data','workspace.json'),'utf8'));
  assert.equal(saved.revision,2);assert.equal(saved.data.notes[0].body,'Белый снег 🦊');
  await server.shutdown();
  url=await start();assert.deepEqual((await (await fetch(url+'/api/workspace')).json()),saved);
  await server.shutdown();
  await writeFile(join(root,'data','workspace.json'),'BROKEN');
  await assert.rejects(createApp(root,'test'),/данные не перезаписаны/);
  assert.equal(await readFile(join(root,'data','workspace.json'),'utf8'),'BROKEN');
});

test('Launcher works from another cwd in a Cyrillic path and reuses an active server', async t=>{
  const root=await fixture(t);
  const child=nodeLaunch(root);
  t.after(()=>stop(root,child));
  const ready=await waitReady(root,child);
  const url=`http://127.0.0.1:${ready.port}`;
  assert.equal((await fetch(url)).status,200);
  const second=nodeLaunch(root);
  assert.equal((await second.closed).code,0);assert.match(second.output,/уже запущена/);assert.ok(second.output.includes(url));
});

test('Avatar appearance is optional and validated', () => {
  const data=emptyWorkspace();
  assert.ok(validateWorkspace({...data,settings:{...data.settings,assistant:{avatar:3,size:'l',mirror:true,hidden:false}}}));
  assert.ok(validateWorkspace({...data,settings:{...data.settings,assistant:{avatar:5,size:'s',mirror:false,hidden:false,animate:false,snap:true,opacity:.4}}}));
  assert.equal(validateWorkspace({...data,settings:{...data.settings,assistant:{avatar:1,size:'s',mirror:false,hidden:false,opacity:0}}}),false);
  assert.equal(validateWorkspace({...data,settings:{...data.settings,assistant:{avatar:6,size:'l',mirror:true,hidden:false}}}),false);
  assert.equal(validateWorkspace({...data,settings:{...data.settings,assistant:{avatar:1,size:'xl',mirror:false,hidden:false}}}),false);
});

test('cloud.ru assistant keeps the key on the server and proxies chat', async t => {
  const root=await mkdtemp(join(tmpdir(),'Miyuneya помощница '));
  await mkdir(join(root,'dist','avatars'),{recursive:true});
  await writeFile(join(root,'dist','avatars','avatar2.png'),Buffer.from([0x89,0x50,0x4e,0x47]));
  const seen=[];
  const { createServer } = await import('node:http');
  const fake=createServer(async(req,res)=>{
    let body='';for await(const c of req)body+=c;
    seen.push({path:req.url,auth:req.headers.authorization,body:body?JSON.parse(body):null});
    res.setHeader('Content-Type','application/json');
    if(req.headers.authorization!=='Bearer good-key-123'){res.statusCode=401;return res.end(JSON.stringify({error:{message:'bad key good-key-wrong'}}));}
    if(req.url==='/v1/models')return res.end(JSON.stringify({data:[{id:'zeta/model'},{id:'openai/gpt-oss-120b'},{id:'bad id'}]}));
    if(seen.at(-1).body?.messages?.at(-1)?.content==='json'){return res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'Целиком'}}]}));}
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    for(const part of ['Привет,',' я лиса!',' <task>Купить корм</task>']){res.write(`data: ${JSON.stringify({choices:[{delta:{content:part}}]})}\n\n`);await new Promise(r=>setTimeout(r,5));}
    res.end('data: [DONE]\n\n');
  });
  fake.listen(0,'127.0.0.1');await once(fake,'listening');
  let server;
  t.after(async()=>{await server?.shutdown();fake.close();await removeTemp(root);});
  const seeded=emptyWorkspace();seeded.notes.push({id:'n1',title:'Секретный рецепт',body:'Блины',updatedAt:'2026-10-01T10:00:00Z'});
  await mkdir(join(root,'data'));await writeFile(join(root,'data','workspace.json'),JSON.stringify({revision:0,data:seeded}));
  server=await createApp(root,'test',false,{cloudUrl:`http://127.0.0.1:${fake.address().port}/v1/`});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${server.address().port}`;
  const json=(path,method,body)=>fetch(url+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const image=await fetch(url+'/avatars/avatar2.png');
  assert.equal(image.headers.get('content-type'),'image/png');assert.equal((await image.arrayBuffer()).byteLength,4);
  assert.deepEqual(await (await fetch(url+'/api/assistant')).json(),{configured:false,keyHint:'',model:'openai/gpt-oss-120b',smartModel:'',embedModel:'BAAI/bge-m3',context:true,customAvatar:null});
  assert.equal((await json('/api/assistant/chat','POST',{messages:[{role:'user',content:'Привет'}]})).status,409);
  assert.equal((await json('/api/assistant','PUT',{apiKey:'short'})).status,400);
  assert.equal((await json('/api/assistant','PUT',{model:'плохая модель'})).status,400);
  assert.equal((await json('/api/assistant','PUT',null)).status,400);
  let saved=await (await json('/api/assistant','PUT',{apiKey:'good-key-wrong'})).json();
  assert.equal(saved.configured,true);assert.equal(saved.keyHint,'••••rong');assert.ok(!JSON.stringify(saved).includes('good-key'));
  const rejected=await json('/api/assistant/chat','POST',{messages:[{role:'user',content:'Привет'}]});
  assert.equal(rejected.status,502);const rejectedBody=await rejected.json();
  assert.match(rejectedBody.error,/не принял ключ/);assert.ok(!rejectedBody.error.includes('good-key-wrong'));
  saved=await (await json('/api/assistant','PUT',{apiKey:'good-key-123',model:'zeta/model'})).json();
  assert.deepEqual(saved,{configured:true,keyHint:'••••-123',model:'zeta/model',smartModel:'',embedModel:'BAAI/bge-m3',context:true,customAvatar:null});
  assert.deepEqual(await (await fetch(url+'/api/assistant/models')).json(),{models:['openai/gpt-oss-120b','zeta/model']});
  assert.equal((await json('/api/assistant/chat','POST',{messages:[{role:'system',content:'x'}]})).status,400);
  assert.equal((await json('/api/assistant/chat','POST',{messages:[{role:'user',content:'Привет'},{role:'assistant',content:'Да?'}]})).status,400);
  const lines=async response=>(await response.text()).trim().split('\n').map(line=>JSON.parse(line));
  const chat=await json('/api/assistant/chat','POST',{messages:[{role:'user',content:'Привет'}]});
  assert.equal(chat.status,200);assert.match(chat.headers.get('content-type'),/ndjson/);
  assert.deepEqual(await lines(chat),[{delta:'Привет,'},{delta:' я лиса!'},{delta:' <task>Купить корм</task>'},{done:true,model:'zeta/model'}]);
  const sent=seen.at(-1);
  assert.equal(sent.path,'/v1/chat/completions');assert.equal(sent.auth,'Bearer good-key-123');assert.equal(sent.body.model,'zeta/model');
  assert.equal(sent.body.stream,true);assert.equal(sent.body.messages[0].role,'system');assert.deepEqual(sent.body.messages.at(-1),{role:'user',content:'Привет'});
  assert.match(sent.body.messages[0].content,/Секретный рецепт/);assert.match(sent.body.messages[0].content,/<task>/);
  assert.deepEqual(await lines(await json('/api/assistant/chat','POST',{messages:[{role:'user',content:'json'}]})),[{delta:'Целиком'},{done:true,model:'zeta/model'}]);
  assert.equal((await (await json('/api/assistant','PUT',{context:false})).json()).context,false);
  await lines(await json('/api/assistant/chat','POST',{messages:[{role:'user',content:'Привет'}]}));
  assert.doesNotMatch(seen.at(-1).body.messages[0].content,/Секретный рецепт/);
  const png=Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.alloc(32,7)]);
  assert.equal((await fetch(url+'/api/assistant/avatar',{method:'PUT',headers:{'Content-Type':'image/png'},body:Buffer.from('not an image at all')})).status,415);
  assert.equal((await fetch(url+'/api/assistant/avatar',{method:'PUT',headers:{'Content-Type':'text/plain'},body:png})).status,415);
  const uploaded=await (await fetch(url+'/api/assistant/avatar',{method:'PUT',headers:{'Content-Type':'image/png'},body:png})).json();
  assert.ok(uploaded.customAvatar>0);
  const custom=await fetch(url+'/api/assistant/avatar');
  assert.equal(custom.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await custom.arrayBuffer()),png);
  assert.equal((await fetch(url+'/api/assistant/chat',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},body:'{}'})).status,403);
  const file=JSON.parse(await readFile(join(root,'data','assistant.json'),'utf8'));
  assert.equal(file.apiKey,'good-key-123');assert.equal(file.model,'zeta/model');assert.equal(file.context,false);assert.equal(file.avatar.type,'image/png');
  assert.ok(!JSON.stringify(await (await fetch(url+'/api/workspace')).json()).includes('good-key'));
  await server.shutdown();
  server=await createApp(root,'test',false,{cloudUrl:'http://127.0.0.1:9/v1'});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const again=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await (await fetch(again+'/api/assistant')).json()).keyHint,'••••-123');
  assert.equal((await fetch(again+'/api/assistant',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:null})})).status,200);
  assert.equal((await (await fetch(again+'/api/assistant')).json()).configured,false);
  assert.equal((await fetch(again+'/api/assistant/avatar')).status,200);
  assert.equal((await (await fetch(again+'/api/assistant/avatar',{method:'DELETE'})).json()).customAvatar,null);
  assert.equal((await fetch(again+'/api/assistant/avatar')).status,404);
  await assert.rejects(readFile(join(root,'data','avatar-custom.png')));
});

test('Chat helpers hide action tags and build the model context', async () => {
  const { visibleText, parseActions, noteTitle } = await import('../src/assistant.ts');
  const { workspaceContext } = await import('../server/app.ts');
  const raw='Готово!\n<task>Купить корм</task>\n<note title="Идея">Сад на балконе</note>';
  assert.equal(visibleText(raw),'Готово!');
  assert.equal(visibleText('Пишу <no'),'Пишу');assert.equal(visibleText('Пишу <task>Куп'),'Пишу');
  assert.deepEqual(parseActions(raw),{tasks:['Купить корм'],notes:[{title:'Идея',body:'Сад на балконе'}]});
  assert.equal(noteTitle('\n## Итоги встречи\nтекст'),'Итоги встречи');
  const data=emptyWorkspace();
  data.tasks.push({id:'t1',title:'Позвонить маме',done:false,createdAt:'2026-10-03T10:00:00Z'});
  data.notes.push({id:'n1',title:'Длинная',body:'x'.repeat(5000),updatedAt:'2026-10-02T10:00:00Z'});
  const context=workspaceContext(data,new Date('2026-10-29T10:00:00Z'));
  assert.match(context,/Позвонить маме/);assert.match(context,/### Длинная/);assert.ok(context.length<2000);
  assert.match(workspaceContext(data,new Date(),200),/не все записи/);
});

test('Appearance offers 30 distinct accents and readable button text', async () => {
  const { accents, normalizeAppearance, accentPalette, luminance, defaultAppearance } = await import('../src/appearance.ts');
  assert.equal(accents.length,30);
  assert.equal(new Set(accents.map(a=>a[0])).size,30);assert.equal(new Set(accents.map(a=>a[1])).size,30);
  for(const name of ['Золото','Сакура','Нефрит','Фиалка'])assert.ok(accents.some(a=>a[0]===name));
  assert.deepEqual(normalizeAppearance({accent:'#ABCDEF',radius:'round',scale:'huge'}),{accent:'#abcdef',radius:'round',scale:'normal'});
  assert.deepEqual(normalizeAppearance('broken'),defaultAppearance());
  const contrast=(a,b)=>{const [x,y]=[luminance(a),luminance(b)].sort((p,q)=>q-p);return (x+.05)/(y+.05);};
  for(const [,hex] of accents) for(const dark of [false,true]) {
    const p=accentPalette(hex,dark);
    assert.ok(contrast(p.accent,p.on)>=4.5,`${hex} ${dark}`);
  }
  assert.equal(accentPalette('#986f24',false).on,'#ffffff');assert.equal(accentPalette('#986f24',true).on,'#221e14');
});
