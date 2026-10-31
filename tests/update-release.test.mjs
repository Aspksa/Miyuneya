import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fixture, nodeLaunch, waitReady, stop } from './helpers/lifecycle.mjs';
import { atomicWrite } from '../scripts/runtime.mjs';
import { prepareUpdate, updateManager, allowed } from '../scripts/update.mjs';
import { openGithubUpdater } from '../server/update-service.ts';
const hash=s=>createHash('sha256').update(s).digest('hex');
function mockRelease(version,files,opts={}){
  const bundle=Buffer.from(JSON.stringify({schema:1,version,files:Object.entries(files).map(([path,bytes])=>({
    path,sha256:hash(bytes),data:Buffer.from(bytes).toString('base64')}))}));
  const meta={tag_name:'v'+version,draft:false,prerelease:false,body:'## Что нового\nУлучшена проверка обновлений.',
    published_at:'2026-10-31T10:00:00Z',
    assets:[{name:'miyuneya-update.json',size:bundle.length,browser_download_url:'https://untrusted.invalid/never'}]};
  let count=0;
  const get=async url=>{
    count++;
    if(url.includes('/releases/latest'))return new Response(JSON.stringify({...meta,...opts}),{status:200,headers:{'Content-Type':'application/json'}});
    if(url==='https://github.com/Aspksa/Miyuneya/releases/download/v'+version+'/miyuneya-update.json')
      return new Response(bundle,{status:200,headers:{'Content-Type':'application/octet-stream'}});
    return new Response('unknown',{status:404});
  };
  return {get,count:()=>count};
}
test('Release discovery uses exact GitHub URL, compares versions and safely stages checked files',async t=>{
  const root=await fixture(t);
  const updated=(await readFile(join(root,'web','style.css'),'utf8'))+'\n/* secure release */\n';
  const mock=mockRelease('0.6.1',{'web/style.css':updated});
  const service=await openGithubUpdater(root,mock.get);
  const initial=await service.view();
  assert.equal(initial.current,'0.6.0');
  assert.equal(initial.available,null);
  const latest=await service.check();
  assert.equal(latest.available,'0.6.1');
  assert.equal(latest.notes.includes('Что нового'),true);
  assert.match(latest.releaseUrl,/^https:\/\/github\.com\/Aspksa\/Miyuneya\/releases\/download\/v0\.6\.1/);
  const staged=await service.stage();
  assert.equal(staged.pending,'0.6.1');
  assert.equal(await readFile(join(root,'.runtime','updates','pending','web','style.css'),'utf8'),updated);
  assert.equal(await readFile(join(root,'web','style.css'),'utf8')===updated,false,
    'running source stays unchanged until managed restart');
  await assert.rejects(service.stage(),/уже подготовлено/);
  const logger={log:async()=>{}};
  const tx=await updateManager(root,logger);
  assert.equal(tx.applied,true);
  assert.equal(await readFile(join(root,'web','style.css'),'utf8'),updated);
  await tx.commit();
  assert.equal((await service.view()).current,'0.6.1');
  assert.equal((await service.view()).pending,null);
});
test('Invalid signatures, missing releases, path injection and unsupported downgrade fail safely',async t=>{
  const root=await fixture(t);
  const absent=await openGithubUpdater(root,async()=>new Response('not found',{status:404}));
  assert.equal((await absent.check()).noRelease,true);
  const invalid=mockRelease('0.6.1',{'data/assistant.json':'ATTACK'});
  const service=await openGithubUpdater(root,invalid.get);
  await service.check();
  await assert.rejects(service.stage(),/Недопустимый файл/);
  assert.equal((await service.view()).pending,null);
  assert.equal((await service.view()).current,'0.6.0');
  const older=mockRelease('0.5.0',{'web/style.css':'older'});
  const downgrade=await openGithubUpdater(root,older.get);
  await downgrade.check();
  await assert.rejects(downgrade.stage(),/Новая версия не требуется/);
  assert.equal(allowed.test('server/update-service.ts'),true);
  assert.equal(allowed.test('web/avatars/hayumeri-kitsune.avif'),true);
  assert.equal(allowed.test('Miyuneya.bat'),false);
  assert.equal(allowed.test('scripts/start.mjs'),false);
  assert.equal(allowed.test('data/chat.sqlite'),false);
});
test('GitHub-provided asset digest is checked and corrupt optional preferences never prevent startup',async t=>{
  const root=await fixture(t);
  const preferences=join(root,'.runtime','updates','settings.json');
  await mkdir(join(root,'.runtime','updates'),{recursive:true});
  await writeFile(preferences,'{ broken settings JSON');
  const corrupted=mockRelease('0.6.1',{'web/style.css':'/* authenticated */'},{
    assets:[{name:'miyuneya-update.json',size:500,digest:'sha256:'+'0'.repeat(64)}]
  });
  const manager=await openGithubUpdater(root,corrupted.get);
  assert.equal((await manager.view()).autoCheck,false);
  await manager.check();
  await assert.rejects(manager.stage(),/SHA-256 релиза GitHub не совпадает/);
  assert.equal((await manager.view()).pending,null);
});

test('Check preferences persist; automatic staging occurs only with explicit opt-in',async t=>{
  const root=await fixture(t);
  const mock=mockRelease('0.6.1',{'web/style.css':'/* staged */'});
  let service=await openGithubUpdater(root,mock.get);
  await service.configure({autoCheck:true,autoDownload:false});
  await service.checkScheduled();
  assert.equal((await service.view()).pending,null);
  assert.equal(mock.count(),1);
  await service.configure({autoCheck:true,autoDownload:true});
  service=await openGithubUpdater(root,mock.get);
  await service.checkScheduled();
  assert.equal((await service.view()).pending,'0.6.1');
  const before=mock.count();
  await service.checkScheduled();
  assert.equal(mock.count(),before,'scheduled checks are rate-limited');
});
test('Update REST API never restarts a process without the persistent BAT supervisor',async t=>{
  const root=await fixture(t);
  const {createApp}=await import('../server/app.ts');
  const instance='updates-api';
  const server=await createApp(root,instance,false);
  t.after(()=>server.shutdown());
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port;
  const get=await fetch(base+'/api/updates',{headers:{Host:'127.0.0.1:'+server.address().port}});
  assert.equal(get.status,200);
  assert.equal((await get.json()).current,'0.6.0');
  const post=async body=>fetch(base+'/api/updates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const restart=await post({action:'restart'});
  assert.equal(restart.status,409);
  const wrong=await post({action:'install-all-silently'});
  assert.equal(wrong.status,400);
});
test('Managed restart applies staged release, confirms local readiness and keeps user data',async t=>{
  const root=await fixture(t);
  const old=await readFile(join(root,'web','style.css'),'utf8');
  const child=nodeLaunch(root,{MIYUNEYA_OFFLINE:'1'});
  t.after(()=>stop(root,child));
  const ptr=await waitReady(root,child,30000);
  const dataFile=join(root,'data','workspace.json');
  const before=await readFile(dataFile,'utf8');
  const candidate=join(root,'.runtime','test-update');await mkdir(candidate);
  const updated=old+'\n/* restart verified */\n';
  await atomicWrite(join(candidate,'web','style.css'),updated);
  await atomicWrite(join(candidate,'update.json'),JSON.stringify({schema:1,version:'0.6.1',files:[
    {path:'web/style.css',sha256:hash(updated)}]}));
  await prepareUpdate(root,candidate);
  const base='http://127.0.0.1:'+ptr.port;
  const response=await fetch(base+'/api/updates',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:'restart'})});
  assert.equal(response.status,202);
  const start=Date.now();
  let next=null;
  while(Date.now()-start<30000){
    try{
      const state=await (await fetch(base+'/api/updates')).json();
      if(state.current==='0.6.1'&&!state.pending){next=state;break;}
    }catch{}
    await new Promise(r=>setTimeout(r,120));
  }
  assert.ok(next,'must restart on original port with the new verified version');
  assert.equal(await readFile(join(root,'web','style.css'),'utf8'),updated);
  assert.equal(await readFile(dataFile,'utf8'),before);
  assert.equal(child.ended,false,'supervising BAT process persists across upgrade');
});
