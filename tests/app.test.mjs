import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { createApp } from '../server/app.ts';
import { emptyWorkspace, validateWorkspace, searchNotes } from '../src/model.ts';

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

test('HTTP storage, revision conflicts, restart, allowlist and origin checks', async t => {
  const root=await mkdtemp(join(tmpdir(),'Miyuneya данные '));
  await mkdir(join(root,'dist')); await writeFile(join(root,'dist','index.html'),'<html lang="ru">Miyuneya</html>');
  let server;
  t.after(async()=>{server?.closeAllConnections();if(server?.listening) await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});});
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
  server.closeAllConnections();await new Promise(r=>server.close(r));
  url=await start();assert.deepEqual((await (await fetch(url+'/api/workspace')).json()),saved);
  server.closeAllConnections();await new Promise(r=>server.close(r));
  await writeFile(join(root,'data','workspace.json'),'BROKEN');
  await assert.rejects(createApp(root,'test'),/данные не перезаписаны/);
  assert.equal(await readFile(join(root,'data','workspace.json'),'utf8'),'BROKEN');
});

test('Launcher works from another cwd in a Cyrillic path and reuses an active server', async t=>{
  const parent=await mkdtemp(join(tmpdir(),'Miyuneya launch '));
  const root=join(parent,'Рабочий стол проект');await mkdir(root);
  for(const dir of ['scripts','server','src','dist']) await cp(new URL('../'+dir,import.meta.url),join(root,dir),{recursive:true});
  await cp(new URL('../package.json',import.meta.url),join(root,'package.json'));
  const child=spawn(process.execPath,[join(root,'scripts','start.mjs')],{cwd:tmpdir(),stdio:['ignore','pipe','pipe']});
  let out='';let errors='';child.stderr.on('data',c=>{errors+=c;});
  t.after(async()=>{
    child.kill();if(child.exitCode===null) await once(child,'exit');
    await rm(parent,{recursive:true,force:true});
  });
  const url=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Launcher timeout: '+errors)),10000);
    child.stdout.on('data',chunk=>{out+=chunk;const match=out.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});
    child.once('exit',code=>{clearTimeout(timer);reject(new Error('Launcher exited: '+code+' '+errors));});
  });
  assert.equal((await fetch(url)).status,200);
  const second=spawn(process.execPath,[join(root,'scripts','start.mjs')],{cwd:tmpdir(),stdio:['ignore','pipe','pipe']});
  let output='';second.stdout.on('data',c=>{output+=c;});
  const [code]=await once(second,'exit');assert.equal(code,0);assert.match(output,/уже запущена/);assert.ok(output.includes(url));
});
