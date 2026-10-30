import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { fixture, nodeLaunch, waitReady, stop, removeTemp, deadline, own } from './helpers/lifecycle.mjs';
import { ensureBuild } from '../scripts/build.mjs';
import { retryFile, healthy, atomicWrite } from '../scripts/runtime.mjs';
import { createApp } from '../server/app.ts';
import { emptyWorkspace } from '../src/model.ts';
import { prepareUpdate } from '../scripts/update.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

test('Default homepage has only the right settings rail; original workspace and APIs are preserved',async t=>{
  const root=await fixture(t);
  const child=nodeLaunch(root,{MIYUNEYA_OFFLINE:'1'});
  const pointer=await waitReady(root,child);
  const base=`http://127.0.0.1:${pointer.port}`;
  const home=await fetch(base+'/');
  assert.equal(home.status,200);
  assert.match(home.headers.get('content-type'),/^text\/html/);
  const html=await home.text();
  assert.equal(html,await readFile(join(root,'dist','blank.html'),'utf8'));
  assert.match(html,/<title><\/title>/);
  assert.match(html,/<main[^>]*id="work-area"[^>]*>/);
  assert.match(html,/<section[^>]*id="brain-workspace"[^>]*hidden>/);
  assert.match(html,/<a[^>]*id="brain-nav-link"[^>]*aria-label="Мозги Hayumeri"/);
  assert.match(html,/<h1 id="brain-heading">Мозги Hayumeri<\/h1>/);
  assert.match(html,/<nav[^>]*class="right-rail"/);
  assert.match(html,/<svg\b/);
  assert.match(html,/id="settings-toggle"/);
  assert.match(html,/id="settings-panel"[^>]*role="dialog"/);
  assert.match(html,/name="appearance" data-setting="theme" value="light"/);
  assert.match(html,/name="appearance" data-setting="theme" value="dark"/);
  for (const filename of ['blank.css','blank.js','avatar.css','avatar.js']) {
    const asset=await fetch(base+'/'+filename);
    assert.equal(asset.status,200);
    assert.equal(await asset.text(),await readFile(join(root,'web',filename),'utf8'));
  }
  assert.match(html,/<title><\/title>/,'Blank homepage retains unnamed document title');
  assert.match(html,/id="kitsune-avatar"/);
  assert.match(html,/id="kitsune-settings"[^>]*role="dialog"/);
  const image=await fetch(base+'/avatars/hayumeri-kitsune.avif');
  assert.equal(image.status,200);
  assert.match(image.headers.get('content-type'),/image\/avif/);
  const received=Buffer.from(await image.arrayBuffer());
  assert.deepEqual(received,await readFile(join(root,'web','avatars','hayumeri-kitsune.avif')));

  const head=await fetch(base+'/',{method:'HEAD'});
  assert.equal(head.status,200);
  assert.equal(await head.text(),'');
  const original=await fetch(base+'/workspace');
  assert.equal(original.status,200);
  assert.match(await original.text(),/<title>Miyuneya/);
  assert.equal((await fetch(base+'/index.html')).status,200);
  const workspace=await fetch(base+'/api/workspace');
  assert.equal(workspace.status,200);
  assert.equal((await workspace.json()).revision,0);
});

test('Theme settings survive a BAT-style server restart without altering notes',async t=>{
  const root=await fixture(t);
  const first=nodeLaunch(root,{MIYUNEYA_OFFLINE:'1'});
  const one=await waitReady(root,first);
  const base=`http://127.0.0.1:${one.port}`;
  const seed=emptyWorkspace();
  seed.notes.push({id:'saved-note',title:'Сохранить',body:'Не менять данные',updatedAt:new Date().toISOString()});
  const saved=await fetch(base+'/api/workspace',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:0,data:seed})});
  assert.equal(saved.status,200);
  assert.equal((await fetch(base+'/api/site/theme')).status,200);
  const bad=await fetch(base+'/api/site/theme',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({theme:'invalid'})});
  assert.equal(bad.status,400);
  const result=await fetch(base+'/api/site/theme',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({theme:'dark'})});
  assert.equal(result.status,200);
  assert.equal((await result.json()).theme,'dark');
  const firstData=await (await fetch(base+'/api/workspace')).json();
  assert.equal(firstData.data.settings.theme,'dark');
  assert.deepEqual(firstData.data.notes,seed.notes);
  await stop(root,first);
  const second=nodeLaunch(root,{MIYUNEYA_OFFLINE:'1'});
  const two=await waitReady(root,second);
  assert.equal((await (await fetch(`http://127.0.0.1:${two.port}/api/site/theme`)).json()).theme,'dark');
  const persisted=JSON.parse(await readFile(join(root,'data','workspace.json'),'utf8'));
  assert.deepEqual(persisted.data.notes,seed.notes);
  await stop(root,second);
});

test('Appearance API persists all options, rejects invalid requests and preserves notes',async t=>{
  const root=await fixture(t);
  const first=nodeLaunch(root,{MIYUNEYA_OFFLINE:'1'});
  const one=await waitReady(root,first);
  const base=`http://127.0.0.1:${one.port}`;
  const existing=emptyWorkspace();
  existing.notes.push({id:'keep',title:'Важно',body:'Исходная заметка',updatedAt:new Date().toISOString()});
  assert.equal((await fetch(base+'/api/workspace',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:0,data:existing})})).status,200);
  const current=(await (await fetch(base+'/api/site/appearance')).json()).appearance;
  assert.equal(current.theme,'light');
  const desired={...current,theme:'auto',accent:'#599a94',railWidth:'wide',iconSize:'large',
    railOpacity:80,font:'georgia',fontSize:'large',radius:'large',density:'compact',
    motion:false,background:'#131827',scale:110,contrast:true};
  const put=value=>fetch(base+'/api/site/appearance',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({appearance:value})});
  assert.equal((await put({...desired,scale:999})).status,400);
  assert.equal((await put({...desired,accent:'evil'})).status,400);
  assert.equal((await put(desired)).status,200);
  assert.deepEqual((await (await fetch(base+'/api/site/appearance')).json()).appearance,desired);
  const currentData=await (await fetch(base+'/api/workspace')).json();
  assert.equal(currentData.data.settings.theme,'auto');
  assert.deepEqual(currentData.data.notes,existing.notes);
  await stop(root,first);
  const second=nodeLaunch(root,{MIYUNEYA_OFFLINE:'1'});
  const two=await waitReady(root,second);
  assert.deepEqual((await (await fetch(`http://127.0.0.1:${two.port}/api/site/appearance`)).json()).appearance,desired);
  const persisted=JSON.parse(await readFile(join(root,'data','workspace.json'),'utf8'));
  assert.deepEqual(persisted.data.notes,existing.notes);
  await stop(root,second);
});

test('A missing blank homepage fails the preflight check with a specific cause',async t=>{
  const root=await fixture(t);
  await rm(join(root,'web','blank.html'));
  await assert.rejects(ensureBuild(root),/web\/blank\.html/);
});

test('BAT is ASCII without BOM, CRLF, delayed expansion off and has one entry point', async()=>{
  const bytes=await readFile(new URL('../Miyuneya.bat',import.meta.url));
  assert.ok([...bytes].every(b=>b<128));assert.equal(bytes.toString().replaceAll('\r\n','').includes('\n'),false);
  assert.match(bytes.toString(),/setlocal DisableDelayedExpansion/);assert.match(bytes.toString(),/%~dp0scripts\\bootstrap\.ps1/);
  assert.doesNotMatch(bytes.toString(),/%\*|shell:|pushd/);
});
test('Build repairs missing and damaged outputs offline and ignores incomplete irrelevant node_modules',async t=>{
  const root=await fixture(t);await ensureBuild(root);
  await mkdir(join(root,'node_modules','vite'),{recursive:true});
  await writeFile(join(root,'dist','main.js'),'BROKEN');await rm(join(root,'dist','style.css'));
  await assert.rejects(ensureBuild(root,true),/повреждена/);
  assert.equal(await ensureBuild(root),true);assert.equal(await ensureBuild(root,true),false);
  const child=nodeLaunch(root,{MIYUNEYA_OFFLINE:'1',HTTP_PROXY:'http://127.0.0.1:9',HTTPS_PROXY:'http://127.0.0.1:9',PYTHON:'missing-python',PYTHONHOME:'broken-python'});t.after(()=>stop(root,child));
  await waitReady(root,child);
  assert.equal(await readFile(join(root,'dist','style.css'),'utf8'),await readFile(join(root,'web','style.css'),'utf8'));
});
test('New undeclared dependency topology fails visibly instead of trusting node_modules',async t=>{
  const root=await fixture(t);const pkg=JSON.parse(await readFile(join(root,'package.json')));pkg.dependencies={missing:'1.0.0'};await writeFile(join(root,'package.json'),JSON.stringify(pkg));
  await assert.rejects(ensureBuild(root),/набор зависимостей/);
});
test('Occupied foreign port and stale false health cannot hijack startup',async t=>{
  const root=await fixture(t);
  const foreign=createServer((req,res)=>{res.statusCode=500;res.end(JSON.stringify({app:'Miyuneya',ready:true,instance:'foreign',launchId:'foreign'}));});
  foreign.listen(0,'127.0.0.1');await once(foreign,'listening');t.after(()=>new Promise(r=>foreign.close(r)));
  const port=foreign.address().port;await atomicWrite(join(root,'.runtime','server.json'),JSON.stringify({port,launchId:'foreign'}));
  assert.equal(await healthy({port,launchId:'foreign'},'foreign'),false);
  const child=nodeLaunch(root,{PORT:String(port)});t.after(()=>stop(root,child));
  const pointer=await waitReady(root,child);assert.notEqual(pointer.port,port);assert.ok(foreign.listening);
});
test('Concurrent launches share one writer and preserve saved user data',async t=>{
  const root=await fixture(t);const a=nodeLaunch(root);const b=nodeLaunch(root);
  t.after(async()=>{if(!a.ended)await stop(root,a);if(!b.ended)await stop(root,b);});
  const pointer=await waitReady(root,{get ended(){return a.ended&&b.ended;},get output(){return a.output+b.output;},get errors(){return a.errors+b.errors;}});
  const url=`http://127.0.0.1:${pointer.port}`;
  const data=emptyWorkspace();data.notes.push({id:'n',title:'Сохранить',body:'Пользовательские данные',updatedAt:'2026-10-29T00:00:00.000Z'});
  const response=await fetch(url+'/api/workspace',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:0,data})});assert.equal(response.status,200);await response.arrayBuffer();
  const snapshot=await readFile(join(root,'data','workspace.json'),'utf8');
  await Promise.race([a.closed,b.closed]);
  const owner=a.ended?b:a;const reused=a.ended?a:b;
  assert.equal((await reused.closed).code,0);assert.match(reused.output,/уже запущена/);
  await stop(root,owner);assert.equal(await readFile(join(root,'data','workspace.json'),'utf8'),snapshot);
  const c=nodeLaunch(root,{MIYUNEYA_OFFLINE:'1'});t.after(()=>stop(root,c));await waitReady(root,c);assert.equal(await readFile(join(root,'data','workspace.json'),'utf8'),snapshot);
});
test('Graceful shutdown waits for an in-flight UTF-8 body and its atomic write',async t=>{
  const root=await fixture(t);const server=await createApp(root,'drain');server.listen(0,'127.0.0.1');await once(server,'listening');own(root,()=>server.shutdown());
  const data=emptyWorkspace();data.notes.push({id:'n',title:'Лиса',body:'Сохрани 🦊',updatedAt:'2026-10-29T00:00:00.000Z'});
  const bytes=Buffer.from(JSON.stringify({revision:0,data}));
  const received=once(server,'request');
  const req=request({hostname:'127.0.0.1',port:server.address().port,path:'/api/workspace',method:'PUT',agent:false,headers:{'Content-Type':'application/json','Content-Length':bytes.length}});
  const response=new Promise((resolve,reject)=>{req.on('response',res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);});
  req.write(bytes.subarray(0,bytes.length-2));await received;
  let drained=false;const shutdown=server.shutdown().then(()=>{drained=true;});
  await Promise.resolve();assert.equal(drained,false);req.end(bytes.subarray(bytes.length-2));
  assert.equal(await response,200);await shutdown;
  assert.equal(JSON.parse(await readFile(join(root,'data','workspace.json'))).data.notes[0].body,'Сохрани 🦊');
});
test('Cleanup retries transient Windows locks and reports persistent failure',async()=>{
  let calls=0;assert.equal(await retryFile(async()=>{if(++calls<3)throw Object.assign(new Error('locked'),{code:'EBUSY'});return 'done';}), 'done');assert.equal(calls,3);
  calls=0;await assert.rejects(retryFile(async()=>{calls++;throw Object.assign(new Error('locked'),{code:'EPERM'});},2),{code:'EPERM'});assert.equal(calls,2);
});
async function candidate(root,files) {
  const dir=join(root,'.runtime','candidate');await mkdir(dir,{recursive:true});const list=[];
  for(const [path,content] of Object.entries(files)){await atomicWrite(join(dir,path),content);list.push({path,sha256:hash(content)});}
  await atomicWrite(join(dir,'update.json'),JSON.stringify({schema:1,version:'0.2.1',files:list}));return dir;
}
test('Broken pending update is quarantined; failed first boot rolls back without touching data',async t=>{
  const root=await fixture(t);const original=await readFile(join(root,'server','app.ts'),'utf8');
  const stored=JSON.stringify({revision:3,data:emptyWorkspace()});await atomicWrite(join(root,'data','workspace.json'),stored);
  const dir=await candidate(root,{'server/app.ts':'throw new Error("FAILED_CANDIDATE");'});await prepareUpdate(root,dir);
  const child=nodeLaunch(root);t.after(()=>stop(root,child));await waitReady(root,child);
  assert.equal(await readFile(join(root,'server','app.ts'),'utf8'),original);assert.match(child.errors,/предыдущие файлы восстановлены/);assert.equal(await readFile(join(root,'data','workspace.json'),'utf8'),stored);
  await stop(root,child);
  const pending=join(root,'.runtime','updates','pending');await mkdir(pending);await writeFile(join(pending,'update.json'),'broken');
  const next=nodeLaunch(root);t.after(()=>stop(root,next));await waitReady(root,next);
  assert.ok((await readdir(join(root,'.runtime','updates'))).some(n=>n.startsWith('rejected-')));
});
test('Update rejects attempts to write user data and commits only after real health',async t=>{
  const root=await fixture(t);const bad=await candidate(root,{'data/workspace.json':'{}'});await assert.rejects(prepareUpdate(root,bad),/Недопустимый/);
  await removeTemp(bad);const css=(await readFile(join(root,'web','style.css'),'utf8'))+'\n/* verified update */\n';
  const good=await candidate(root,{'web/style.css':css});await prepareUpdate(root,good);
  const child=nodeLaunch(root);t.after(()=>stop(root,child));await waitReady(root,child);
  assert.equal(await readFile(join(root,'web','style.css'),'utf8'),css);await stop(root,child);
  assert.ok((await readdir(join(root,'.runtime','updates'))).some(n=>n.startsWith('installed-')));
});

test('A second staged update cannot overwrite the first pending update',async t=>{
  const root=await fixture(t);
  const first=await candidate(root,{'web/style.css':'/* first staged version */'});
  await prepareUpdate(root,first);
  const pending=join(root,'.runtime','updates','pending','web','style.css');
  const original=await readFile(pending,'utf8');
  const second=await candidate(root,{'web/style.css':'/* second staged version */'});
  await assert.rejects(prepareUpdate(root,second));
  assert.equal(await readFile(pending,'utf8'),original);
});

test('Diagnostics never persist keys, environment values or note bodies',async t=>{
  const root=await fixture(t);const secret='TEST_ONLY_SECRET_NOT_A_REAL_KEY';
  const stored={revision:1,data:emptyWorkspace()};stored.data.notes.push({id:'private',title:'Приватно',body:secret,updatedAt:'2026-10-29T00:00:00.000Z'});
  await atomicWrite(join(root,'data','workspace.json'),JSON.stringify(stored));
  const child=nodeLaunch(root,{CLOUD_RU_API_KEY:secret,OPENAI_API_KEY:secret});await waitReady(root,child);await stop(root,child);
  const log=await readFile(join(root,'.runtime','logs','startup.log'),'utf8');assert.equal(log.includes(secret),false);assert.equal(log.includes('CLOUD_RU_API_KEY'),false);
});

test('A running 0.1.0 instance is reused instead of starting a second data writer',async t=>{
  const root=await fixture(t);const instance=createHash('sha256').update(await realpath(root)).digest('hex').slice(0,24);
  const legacy=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({app:'Miyuneya',instance}));});
  legacy.listen(0,'127.0.0.1');await once(legacy,'listening');own(root,()=>new Promise(r=>legacy.close(r)));
  const pointer=JSON.stringify({port:legacy.address().port,pid:process.pid});await atomicWrite(join(root,'.runtime','server.json'),pointer);
  const child=nodeLaunch(root);assert.equal((await deadline(child.closed)).code,0);assert.match(child.errors,/предыдущая версия/);assert.match(child.output,/уже запущена/);
  assert.equal(await readFile(join(root,'.runtime','server.json'),'utf8'),pointer);assert.ok(legacy.listening);
});
