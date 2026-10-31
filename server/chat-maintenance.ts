import { backup, DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { join, basename, isAbsolute, parse } from 'node:path';
import { mkdir, readFile, rm, readdir, rename, stat, statfs, copyFile, realpath, cp } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { atomicWrite } from '../scripts/runtime.mjs';
import type { openSqliteChatArchive } from './chat-sqlite.ts';
import { ensureSpace } from './chat-db-safety.ts';
type Store=Awaited<ReturnType<typeof openSqliteChatArchive>>;
type Row=Record<string,any>;
const now=()=>new Date().toISOString();
const validId=(x:unknown):x is string=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(x);
const fail=(message:string,status=400)=>Object.assign(new Error(message),{status});
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const fileDigest=async(path:string)=>digest(await readFile(path));

export function openChatMaintenance(store:Store,dataDir:string,{automatic=true}={}) {
  const db=store.db,root=join(dataDir,'chat-backups'),blobRoot=join(store.home,'attachments');
  let stopped=false,active:Promise<unknown>|null=null;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const warnings=store.warnings;
  const workers=new Set<Worker>();
  function background(action:'check'|'rebuild'|'optimize'):Promise<Row>{
    if(stopped)throw fail('Архив закрывается.',503);
    return new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('../scripts/chat-archive-worker.mjs',import.meta.url),{
        workerData:{path:store.path,action}
      });
      workers.add(worker);let ended=false;
      const finish=(err?:Error,data?:Row)=>{
        if(ended)return;ended=true;workers.delete(worker);
        if(err)reject(err);else resolve(data||{});
      };
      worker.once('message',data=>finish(undefined,data));
      worker.once('error',e=>finish(e));
      worker.once('exit',code=>{if(!ended)finish(Error('Фоновая операция завершилась с кодом '+code));});
    });
  }
  async function reindex(){
    const result=await background('rebuild');
    if(!result.ok)throw fail(result.error||'Не удалось восстановить FTS5.',503);
    store.setSetting('ftsRebuilt',now());
    return {ok:true};
  }
  async function saveAttachment(conversationId:string,bytes:Buffer,type:string,fileName:string,messageId?:string){
    store.getConversation(conversationId);
    if(!bytes.length||bytes.length>15_000_000)throw fail('Размер вложения должен быть от 1 байта до 15 МБ.',413);
    if(!/^[a-z0-9+.-]+\/[a-z0-9+.-]+$/i.test(type)||type.length>100)throw fail('Неверный тип вложения.');
    const name=basename(String(fileName||'файл')).replace(/[\x00-\x1f]/g,'').slice(0,180)||'файл';
    if(messageId&&!store.visible(conversationId,messageId))throw fail('Сообщение для вложения не найдено.',404);
    await ensureSpace(blobRoot===store.home?store.home:store.home,bytes.length*2,'сохранение вложения');
    const id=randomUUID(),sha256=digest(bytes),date=now();
    const file=join(blobRoot,id+'.blob');
    await mkdir(blobRoot,{recursive:true});
    await atomicWrite(file,bytes);
    try{
      return store.write('attachment-write',()=>{
        db.prepare('INSERT INTO attachments(id,conversation_id,message_id,file_name,media_type,byte_size,sha256,created_at) VALUES(?,?,?,?,?,?,?,?)')
          .run(id,conversationId,messageId||null,name,type,bytes.length,sha256,date);
        return {id,conversationId,messageId:messageId||null,name,type,size:bytes.length,sha256,createdAt:date};
      });
    }catch(e){await rm(file,{force:true}).catch(()=>{});throw e;}
  }
  function listAttachments(conversationId:string){
    store.getConversation(conversationId);
    return store.timed('attachment-list',()=>db.prepare('SELECT id,conversation_id AS conversationId,message_id AS messageId,file_name AS name,media_type AS type,byte_size AS size,sha256,created_at AS createdAt FROM attachments WHERE conversation_id=? ORDER BY created_at DESC LIMIT 500')
      .all(conversationId));
  }
  async function attachment(conversationId:string,id:string){
    store.getConversation(conversationId);
    if(!validId(id))throw fail('Неверное вложение.');
    const meta=db.prepare('SELECT id,conversation_id AS conversationId,message_id AS messageId,file_name AS name,media_type AS type,byte_size AS size,sha256,created_at AS createdAt FROM attachments WHERE id=? AND conversation_id=?')
      .get(id,conversationId) as Row|undefined;
    if(!meta)return null;
    const bytes=await readFile(join(blobRoot,id+'.blob'));
    if(bytes.length!==meta.size||digest(bytes)!==meta.sha256){
      warnings.push('Повреждено вложение: '+id);
      throw fail('Контрольная сумма вложения не совпадает.',503);
    }
    return {meta,bytes};
  }
  async function verifyBackup(dir:string){
    const issues:string[]=[];
    const input=await readFile(join(dir,'manifest.json'),'utf8').catch(()=>null);
    if(!input)return {ok:false,issues:['Отсутствует manifest.json']};
    let doc:Row;
    try{doc=JSON.parse(input);}catch{return {ok:false,issues:['Повреждён manifest.json']};}
    if(doc.version!==1||!Array.isArray(doc.attachments)||!doc.database?.sha256)
      return {ok:false,issues:['Неподдерживаемый формат резервной копии']};
    const saved=join(dir,'archive.sqlite');
    if(await fileDigest(saved).catch(()=>null)!==doc.database.sha256)
      issues.push('Не совпадает SHA-256 базы данных');
    for(const row of doc.attachments){
      if(!validId(row.id)||await fileDigest(join(dir,'attachments',row.id+'.blob')).catch(()=>null)!==row.sha256)
        issues.push('Повреждён файл вложения: '+row.id);
    }
    if(!issues.length){
      try{
        const sample=new DatabaseSync(saved,{readOnly:true});
        try{
          if((sample.prepare('PRAGMA quick_check(1)').get() as Row).quick_check!=='ok')
            issues.push('SQLite quick_check резервной копии не пройден');
        }finally{sample.close();}
      }catch{issues.push('SQLite файл копии не открывается');}
    }
    return {ok:issues.length===0,issues};
  }
  async function latestBackup(){
    let folders:string[];
    try{folders=(await readdir(root)).filter(x=>/^\d{4}-\d\d-\d\dT/.test(x)).sort().reverse();}
    catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}
    return folders[0]?join(root,folders[0]):null;
  }
  async function performBackup(){
    const started=performance.now();
    const suffix=now().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8);
    const pendingDir=join(root,'pending-'+suffix),finalDir=join(root,suffix);
    await mkdir(pendingDir,{recursive:true});
    try{
      await ensureSpace(root,(await stat(store.path)).size*1.5+Number((db.prepare('SELECT COALESCE(SUM(byte_size),0) AS bytes FROM attachments').get() as Row).bytes),'резервное копирование архива');
      const copy=join(pendingDir,'archive.sqlite');
      await backup(db,copy,{rate:64});
      const saved=new DatabaseSync(copy,{readOnly:true});
      let rows:Row[];
      try{rows=saved.prepare('SELECT id,byte_size AS size,sha256 FROM attachments ORDER BY id').all() as Row[];}
      finally{saved.close();}
      const info={version:1,createdAt:now(),database:{sha256:await fileDigest(copy),size:(await stat(copy)).size},
        attachments:[] as Row[]};
      if(rows.length)await mkdir(join(pendingDir,'attachments'),{recursive:true});
      for(const item of rows){
        if(stopped)throw Error('Приложение останавливается');
        const target=join(pendingDir,'attachments',item.id+'.blob');
        await copyFile(join(blobRoot,item.id+'.blob'),target);
        if(await fileDigest(target)!==item.sha256)throw Error('Вложение изменилось или повреждено.');
        info.attachments.push({id:item.id,sha256:item.sha256,size:item.size});
        // A short voluntary yield keeps backups from monopolizing slow USB SSDs.
        if(info.attachments.length%8===0)await new Promise(resolve=>setTimeout(resolve,25));
      }
      await atomicWrite(join(pendingDir,'manifest.json'),JSON.stringify(info,null,2));
      const verified=await verifyBackup(pendingDir);
      if(!verified.ok)throw Error(verified.issues.join('; '));
      await rename(pendingDir,finalDir);
      const bytes=info.database.size+info.attachments.reduce((sum,item)=>sum+Number(item.size||0),0);
      store.setSetting('backupCount',String(Number(store.getSetting('backupCount')||0)+1));
      store.setSetting('backupBytes',String(Number(store.getSetting('backupBytes')||0)+bytes));
      store.setSetting('lastBackup',info.createdAt);
      return {ok:true,directory:finalDir,attachments:rows.length,
        durationMs:Math.round(performance.now()-started)};
    }catch(e){
      await rm(pendingDir,{recursive:true,force:true}).catch(()=>{});
      warnings.push('Резервное копирование не выполнено: '+(e as Error).message);
      return {ok:false,error:(e as Error).message};
    }
  }
  function backupNow(){
    if(active)return Promise.resolve({ok:false,error:'Проверка или резервирование уже выполняется.'});
    const job=performBackup();
    active=job;
    void job.finally(()=>{if(active===job)active=null;});
    return job;
  }
  async function check(){
    const result=await background('check');
    if(!result.ok){
      store.lockWrites('SQLite не прошёл проверку целостности. Записи остановлены.');
      return result;
    }
    if(!result.ftsHealthy){
      await reindex();
      store.setSetting('lastCheck',now());
      return {...result,ftsHealthy:true,repaired:true};
    }
    const attachmentIssues=await inspectAttachments(200);
    if(attachmentIssues.length){
      warnings.push('Проблемы вложений: '+attachmentIssues.join('; '));
      return {...result,ok:false,attachmentIssues};
    }
    store.setSetting('lastCheck',now());
    const last=await latestBackup();
    const backupResult=last?await verifyBackup(last):null;
    if(backupResult&&!backupResult.ok)warnings.push('Последняя резервная копия повреждена: '+backupResult.issues.join('; '));
    return {...result,backup:backupResult};
  }
  async function statistics(){
    const info=store.timed('statistics',()=>{
      const chatCount=Number((db.prepare('SELECT COUNT(*) n FROM conversations').get() as Row).n);
      const messages=Number((db.prepare('SELECT COUNT(*) n FROM messages').get() as Row).n);
      const files=db.prepare('SELECT COUNT(*) n,COALESCE(SUM(byte_size),0) bytes FROM attachments').get() as Row;
      const pages=Number((db.prepare('PRAGMA page_count').get() as Row).page_count);
      const pageSize=Number((db.prepare('PRAGMA page_size').get() as Row).page_size);
      return {conversations:chatCount,messages,attachments:Number(files.n),
        attachmentBytes:Number(files.bytes),databaseBytes:pages*pageSize};
    });
    const disk=await statfs(store.home).catch(()=>null);
    const freeBytes=disk?Number(disk.bavail)*Number(disk.bsize):null;
    const backupAt=store.getSetting('lastBackup')||null;
    const alerts=[...new Set(warnings)];
    if(freeBytes!==null&&freeBytes<512*1024*1024)alerts.push('На диске осталось менее 512 МБ.');
    if(info.messages&&(!backupAt||Date.now()-Date.parse(backupAt)>48*3600_000))
      alerts.push('Нет свежей проверенной резервной копии за последние 48 часов.');
    const slow=[...store.timings].map(([name,v])=>({
      name,calls:v.count,averageMs:Math.round(v.sum/v.count*100)/100,maxMs:Math.round(v.max*100)/100
    })).sort((a,b)=>b.maxMs-a.maxMs).slice(0,12);
    if(slow.some(x=>x.name==='save'&&x.maxMs>500))
      alerts.push('Запись сообщений выполнялась дольше 500 мс. Проверьте состояние диска.');
    return {...info,freeBytes,backupAt,
      backupCount:Number(store.getSetting('backupCount')||0),
      backupBytes:Number(store.getSetting('backupBytes')||0),
      readOnly:store.readOnly(),wal:true,
      warnings:alerts,operations:slow,backupRunning:!!active};
  }
  async function maintain(){
    if(stopped||active)return;
    const lastCheck=store.getSetting('lastCheck');
    try{
      if(!lastCheck||Date.now()-Date.parse(lastCheck)>24*3600_000)await check();
      const last=store.getSetting('lastBackup');
      if(!last||Date.now()-Date.parse(last)>24*3600_000)await backupNow();
    }catch(e){warnings.push('Проверка архивов не завершилась: '+(e as Error).message);}
  }
  function schedule(delay:number){
    if(stopped)return;
    timer=setTimeout(async()=>{await maintain();if(!stopped)schedule(30*60_000);},delay);
    timer.unref?.();
  }
  if(automatic)schedule(12000);
  return {
    saveAttachment,listAttachments,attachment,backupNow,verifyBackup,latestBackup,check,statistics,
    reindex,
    shutdown:async()=>{stopped=true;if(timer)clearTimeout(timer);
      await Promise.allSettled([...workers].map(worker=>worker.terminate()));
      if(active)await active;}
  };
}
