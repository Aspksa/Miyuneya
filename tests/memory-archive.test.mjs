import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTemp } from './helpers/lifecycle.mjs';
import { openMemoryArchive } from '../server/memory-archive.ts';
import { emptyMemory, openMemory, LIMITS } from '../server/memory.ts';

const at='2026-10-31T09:00:00.000Z';
const fact=(i, pinned=false)=>({
  id:'fact-'+i,kind:'fact',text:i===1?'Особый архивный журнал':('История архивтема '+i),
  weight:0.6,hits:1,created:at,seen:at,pinned,source:'user',links:[],category:'work',
  until:null,origin:null,status:'active',evidence:[]
});
const episode=i=>({id:'episode-'+i,date:at,topic:'Хроника '+i,outcome:'Событие '+i,links:[],
  consolidated:true,score:null,weak:''});
const edge=i=>({from:'from-'+i,to:'to-'+i,type:'related',created:at});
const options={ask:async()=>'',available:()=>false,workspace:()=>null,tickMs:10_000_000};

test('SQLite cold tier archives overflow without dropping records and survives reopening',async t=>{
 const root=await mkdtemp(join(tmpdir(),'miyuneya-archive-'));
 t.after(()=>removeTemp(root));
 let archive=await openMemoryArchive(root);
 const memory=emptyMemory();
 memory.items=Array.from({length:720},(_,i)=>fact(i,i===0));
 memory.episodes=Array.from({length:435},(_,i)=>episode(i));
 memory.edges=Array.from({length:1580},(_,i)=>edge(i));
 archive.compact(memory,LIMITS,Date.parse(at));
 assert.equal(memory.items.length,600);
 assert.ok(memory.items.some(x=>x.id==='fact-0'),'pinned user fact remains hot');
 assert.equal(memory.episodes.length,400);
 assert.equal(memory.edges.length,1500);
 const summary=archive.stats();
 assert.deepEqual(summary.archived,{facts:120,episodes:35,edges:80});
 assert.ok(archive.search('Особый архивный журнал').some(x=>x.id==='fact-1'));
 assert.match(archive.recall('Особый архивный журнал'),/Особый архивный журнал/);
 archive.close();
 archive=await openMemoryArchive(root);
 assert.deepEqual(archive.stats().archived,summary.archived);
 archive.compact(memory,LIMITS);
 assert.deepEqual(archive.stats().archived,summary.archived,'old rows survive next hot-tier snapshot');
 assert.ok(archive.forget('Особый архивный журнал').includes('Особый архивный журнал'));
 assert.ok(!archive.search('Особый архивный журнал').length);
 archive.clear();
 assert.equal(archive.stats().archived.facts,0);
 archive.close();
});

test('Legacy JSON overflow migrates to SQLite; recall, explicit forgetting and reset work',async t=>{
 const root=await mkdtemp(join(tmpdir(),'miyuneya-migrate-'));
 t.after(()=>removeTemp(root));
 await mkdir(root,{recursive:true});
 const original=emptyMemory();
 original.items=Array.from({length:615},(_,i)=>fact(i,i===0));
 original.episodes=Array.from({length:405},(_,i)=>episode(i));
 original.edges=Array.from({length:1520},(_,i)=>edge(i));
 await writeFile(join(root,'memory.json'),JSON.stringify(original));
 let memory=await openMemory(root,options);
 assert.equal(memory.view().items.length,600);
 assert.equal(memory.view().archive.archived.facts,15);
 assert.equal(memory.view().archive.archived.episodes,5);
 assert.equal(memory.view().archive.archived.edges,20);
 assert.equal(JSON.parse(await readFile(join(root,'memory.json'),'utf8')).items.length,600);
 assert.ok(memory.archiveSearch('Особый архивный журнал').some(x=>x.id==='fact-1'));
 assert.match(await memory.context('Особый архивный журнал'),/Особый архивный журнал/);
 const removed=await memory.forget('Особый архивный журнал');
 assert.ok(removed.some(x=>x.includes('Особый архивный журнал')));
 assert.equal(memory.archiveSearch('Особый архивный журнал').length,0);
 await memory.shutdown();
 memory=await openMemory(root,options);
 assert.equal(memory.archiveSearch('Особый архивный журнал').length,0);
 await memory.reset();
 assert.equal(memory.view().archive.archived.facts,0);
 await memory.shutdown();
});
