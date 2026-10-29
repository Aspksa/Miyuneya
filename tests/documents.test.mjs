import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { once } from 'node:events';
import { crc32, deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fixture, own } from './helpers/lifecycle.mjs';
import { createApp, workspaceContext } from '../server/app.ts';
import { emptyWorkspace, validateWorkspace, combineEntries, validLocalDate } from '../src/model.ts';
import { emptyMemory, changedNotes, notesForSleep, normalizeMemory, openMemory } from '../server/memory.ts';
import { localDateKey } from '../src/calendar.ts';
function zipDocx(text){
  const name=Buffer.from('word/document.xml'),xml=Buffer.from(`<w:document><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`),compressed=deflateRawSync(xml),crc=crc32(xml);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(xml.length,22);local.writeUInt16LE(name.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(xml.length,24);central.writeUInt16LE(name.length,28);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+compressed.length,16);
  return Buffer.concat([local,name,compressed,central,name,end]);
}
async function app(t){const root=await fixture(t);const server=await createApp(root,'documents');server.listen(0,'127.0.0.1');await once(server,'listening');own(root,()=>server.shutdown());const base=`http://127.0.0.1:${server.address().port}`;let state;
  const list=async()=>{const r=await fetch(base+'/api/disk');assert.equal(r.status,200);return state=await r.json();};
  const upload=(name,body,folder='')=>fetch(base+'/api/disk/files?name='+encodeURIComponent(name)+(folder?'&folder='+folder:''),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body});
  const mutate=async(path,data,method='PATCH')=>{const r=await fetch(base+'/api/disk'+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:state.revision,...data})});const result=await r.json();if(r.ok)state=result;return {status:r.status,data:result};};
  await list();return {root,server,base,list,upload,mutate,get state(){return state;}};
}
test('Disk streams exact original bytes, isolates files from workspace and rejects unsafe paths',async t=>{
  const a=await app(t);const body=Buffer.from('Документ 🦊 <script>alert(1)</script>');
  const uploaded=await a.upload('План & заметки.txt',body);assert.equal(uploaded.status,201);const state=await uploaded.json();const file=state.files[0];
  assert.equal(file.sha256,createHash('sha256').update(body).digest('hex'));assert.equal(file.size,body.length);
  const download=await fetch(a.base+`/api/disk/files/${file.id}/content`);assert.match(download.headers.get('content-disposition'),/^attachment/);assert.deepEqual(Buffer.from(await download.arrayBuffer()),body);
  const preview=await (await fetch(a.base+`/api/disk/files/${file.id}/preview`)).json();assert.equal(preview.kind,'text');assert.equal(preview.text,body.toString());
  assert.equal((await a.upload('../workspace.json','evil')).status,400);assert.equal((await a.upload('CON.txt','evil')).status,400);
  assert.equal((await fetch(a.base+'/data/disk/index.json')).status,404);
  const workspace=await (await fetch(a.base+'/api/workspace')).json();assert.equal(workspace.data.notes.length,0);
  const forbidden=await fetch(a.base+'/api/disk',{headers:{Origin:'https://foreign.example'}});assert.equal(forbidden.status,403);
});
test('Disk folders, rename, favorites, move, trash and restore persist across restart',async t=>{
  const a=await app(t);assert.equal((await a.mutate('/folders',{name:'Работа'},'POST')).status,201);const folder=a.state.folders[0];
  const r=await a.upload('Файл.txt','Сохранить',folder.id);assert.equal(r.status,201);await r.json();await a.list();const file=a.state.files[0];
  assert.equal((await a.mutate('/files/'+file.id,{name:'Новый.txt',starred:true,folder:null})).status,200);
  assert.equal((await a.mutate('/folders/'+folder.id,{name:'Личное'})).status,200);
  assert.equal((await a.mutate('/files/'+file.id,{trashed:true})).status,200);assert.equal((await fetch(a.base+`/api/disk/files/${file.id}/content`)).status,409);
  assert.equal((await a.mutate('/files/'+file.id,{trashed:false})).status,200);
  assert.equal((await a.mutate('/folders/'+folder.id,{},'DELETE')).status,200);
  const stale=await fetch(a.base+'/api/disk/files/'+file.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:0,name:'stale.txt'})});assert.equal(stale.status,409);
  assert.equal((await fetch(a.base+'/api/disk/files/'+file.id,{method:'DELETE'})).status,405);
  await a.server.shutdown();const next=await createApp(a.root,'restart');next.listen(0,'127.0.0.1');await once(next,'listening');own(a.root,()=>next.shutdown());
  const restored=await (await fetch(`http://127.0.0.1:${next.address().port}/api/disk`)).json();assert.equal(restored.files[0].name,'Новый.txt');assert.equal(restored.files[0].starred,true);
});
test('DOCX text extraction validates ZIP and PDF preview requires real file magic',async t=>{
  const a=await app(t);const docx=await a.upload('Договор.docx',zipDocx('Текст &amp; условия'));const id=(await docx.json()).files.at(-1).id;
  const extracted=await (await fetch(a.base+`/api/disk/files/${id}/preview`)).json();assert.equal(extracted.text.trim(),'Текст & условия');assert.equal(extracted.format,'DOCX');
  const fake=await a.upload('fake.pdf',Buffer.from('<html>evil</html>'));const fakeId=(await fake.json()).files.at(-1).id;
  assert.equal((await (await fetch(a.base+`/api/disk/files/${fakeId}/preview`)).json()).kind,'download');assert.equal((await fetch(a.base+`/api/disk/files/${fakeId}/inline`)).status,415);
  const pdf=await a.upload('real.pdf','%PDF-1.4\nmock PDF');const pdfId=(await pdf.json()).files.at(-1).id;
  const inline=await fetch(a.base+`/api/disk/files/${pdfId}/inline`);assert.equal(inline.headers.get('content-type'),'application/pdf');await inline.arrayBuffer();
  const broken=await a.upload('bad.docx','not a ZIP');const badId=(await broken.json()).files.at(-1).id;assert.equal((await fetch(a.base+`/api/disk/files/${badId}/preview`)).status,400);
});
test('Corrupt disk index cannot erase originals or block notes and tasks',async t=>{
  const a=await app(t);const r=await a.upload('copy.txt','original');await r.json();await a.server.shutdown();
  const file=join(a.root,'data','disk','index.json');await writeFile(file,'BROKEN');
  const next=await createApp(a.root,'disk-corrupt');next.listen(0,'127.0.0.1');await once(next,'listening');own(a.root,()=>next.shutdown());const base=`http://127.0.0.1:${next.address().port}`;
  assert.equal((await fetch(base+'/api/disk')).status,503);assert.equal((await fetch(base+'/api/workspace')).status,200);assert.equal(await readFile(file,'utf8'),'BROKEN');assert.equal((await readdir(join(a.root,'data','disk','blobs'))).length,1);
});
test('Task details, dates and priorities remain compatible with existing data; pinned notes sort first',()=>{
  const data=emptyWorkspace();data.tasks.push({id:'t',title:'Работа',details:'Проверить договор',dueDate:'2026-10-30',priority:'high',done:false,createdAt:'2026-10-28T00:00:00Z'});
  data.notes.push({id:'n',title:'Важное',body:'Содержание',pinned:true,updatedAt:'2026-01-01T00:00:00Z'});assert.ok(validateWorkspace(data));assert.equal(combineEntries(data,'')[0].item.id,'n');assert.equal(combineEntries(data,'договор')[0].item.id,'t');
  assert.equal(validLocalDate('2026-02-30'),false);assert.equal(validLocalDate('2028-02-29'),true);data.tasks[0].dueDate='2026-02-30';assert.equal(validateWorkspace(data),false);
  const now=new Date(2026,9,30,0,30);assert.equal(localDateKey(now),'2026-10-30');
});
test('Query context can find a matching fragment after the beginning of a long note',()=>{
  const data=emptyWorkspace();data.notes.push({id:'n',title:'Договор',body:'А'.repeat(5000)+' УникальныйАртикул = 12345',updatedAt:'2026-10-29T00:00:00Z'});
  assert.match(workspaceContext(data,new Date(),30000,'Где УникальныйАртикул?'),/УникальныйАртикул = 12345/);
});
test('Memory processes all changed notes over several batches, including after restart',async t=>{
  const a=await app(t);await a.server.shutdown();const workspace=emptyWorkspace();
  for(let i=0;i<35;i++)workspace.notes.push({id:'n'+i,title:'Заметка '+i,body:'Факт '+i,updatedAt:`2026-10-29T12:${String(i).padStart(2,'0')}:00.000Z`});
  const memory=await openMemory(join(a.root,'data'),{ask:async()=>'{"note_facts":[]}',available:()=>true,workspace:()=>workspace,idleMs:1e12,tickMs:1e9});own(a.root,()=>memory.shutdown());
  await memory.sleepNow();assert.equal(Object.keys(memory.data.noteVersions).length,30);assert.equal(changedNotes(memory.data,workspace).length,5);
  await memory.sleepNow();assert.equal(Object.keys(memory.data.noteVersions).length,35);assert.equal(changedNotes(memory.data,workspace).length,0);
  const loaded=normalizeMemory(JSON.parse(await readFile(join(a.root,'data','memory.json'),'utf8')));assert.equal(changedNotes(loaded,workspace).length,0);
});
