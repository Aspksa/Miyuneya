// Repeatable SQLite load benchmark: all test data lives in a temporary
// directory and is deleted on completion. NEVER point it at data/chats.
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {openSqliteChatArchive} from '../server/chat-sqlite.ts';

const readCount=()=>{
  const raw=process.argv.find(x=>x.startsWith('--messages='));
  const n=raw?Number(raw.slice('--messages='.length)):10000;
  if(!Number.isSafeInteger(n)||n<100||n>1_000_000)
    throw Error('Используйте --messages=10000, 100000 или 1000000 (100–1000000).');
  if(n>10000&&!process.argv.includes('--confirm-large'))
    throw Error('Для 100000+ сообщений укажите --confirm-large: испытание может долго нагружать SSD.');
  return n;
};
const count=readCount();
const root=await mkdtemp(join(tmpdir(),'Miyuneya-BENCH-'));
let db;
try{
  db=await openSqliteChatArchive(root);
  const conversation='performance';
  db.create({id:conversation,title:'Синтетический тест производительности'});
  const body='Документы транспорта, путевой лист, ремонт, водитель, учёт '+('данные '.repeat(12));
  const start=performance.now();
  for(let i=0;i<count;i++){
    db.saveMessage(conversation,{
      id:'perf-'+i,role:i%2?'assistant':'user',
      content:body+i,createdAt:'2026-10-31T12:00:00.000Z',
      version:1,complete:true
    },i);
    if((i+1)%10000===0)
      process.stderr.write('Проверено сообщений: '+(i+1)+'/'+count+'\n');
  }
  const writeMs=performance.now()-start;
  const pageStart=performance.now();
  const last=db.page(conversation,undefined,100);
  const older=db.page(conversation,Math.max(1,Math.floor(count/2)),100);
  const pageMs=performance.now()-pageStart;
  const findStart=performance.now();
  const match=await db.searchAdvanced({query:'путевой лист',limit:10});
  const searchMs=performance.now()-findStart;
  const file=(await stat(db.path)).size;
  const result={
    requestedMessages:count,writtenMessages:db.page(conversation).total,
    writeMs:Math.round(writeMs),messagesPerSecond:Math.round(count*1000/writeMs),
    pageMs:Math.round(pageMs*100)/100,searchMs:Math.round(searchMs*100)/100,
    dbBytes:file,ramRssBytes:process.memoryUsage().rss,
    searchMatches:match.total,latestPage:last.messages.length,
    middlePage:older.messages.length,sqliteVersion:Number(db.db.prepare('PRAGMA user_version').get().user_version),
    synthetic:true
  };
  console.log(JSON.stringify(result,null,2));
  if(result.writtenMessages!==count||result.searchMatches!==1||older.messages.length!==100)
    process.exitCode=1;
}finally{
  await db?.shutdown();
  await rm(root,{recursive:true,force:true});
}
