import { backup, DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { join, basename, isAbsolute, parse } from 'node:path';
import { mkdir, readFile, rm, readdir, rename, stat, statfs, copyFile, realpath, cp, opendir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { atomicWrite } from '../scripts/runtime.mjs';
import type { openSqliteChatArchive } from './chat-sqlite.ts';
import { ensureSpace } from './chat-db-safety.ts';
import { openChatMaintenanceJournal } from './chat-maintenance-journal.ts';
type Store=Awaited<ReturnType<typeof openSqliteChatArchive>>;
type Row=Record<string,any>;
const now=()=>new Date().toISOString();
const validId=(x:unknown):x is string=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(x);
const fail=(message:string,status=400)=>Object.assign(new Error(message),{status});
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const fileDigest=async(path:string)=>digest(await readFile(path));

export function openChatMaintenance(store:Store,dataDir:string,{automatic=true}={}) {
  const db=store.db,root=join(dataDir,'chat-backups'),blobRoot=join(store.home,'attachments');
  let stopped=false,active:Promise<unknown>|null=null,scheduledJob:Promise<void>|null=null;
  const journal=openChatMaintenanceJournal(dataDir);
  const event=(name:Parameters<typeof journal.write>[0],result:Parameters<typeof journal.write>[1],code='none',durationMs=0)=>{
    void journal.write(name,result,code,durationMs).catch(()=>{});
  };
  let nextRunAt:string|null=null;
  const interval=()=>{const value=Number(store.getSetting('maintenanceIntervalMinutes')||30);
    return [15,30,60].includes(value)?value:30;};
  let timer:ReturnType<typeof setTimeout>|undefined;
  const warnings=store.warnings;
  const workers=new Set<Worker>();
  function background(action:'check'|'rebuild'|'optimize'|'checkpoint'|'preflight'):Promise<Row>{
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
    if(store.isImporting())throw fail('Импорт чата ещё выполняется.',423);
    const started=performance.now();
    const result=await background('rebuild');
    event('search-rebuild',result.ok?'ok':'failed',result.ok?'none':'fts-error',performance.now()-started);
    if(!result.ok)throw fail('Не удалось восстановить FTS5.',503);
    store.setSetting('ftsRebuilt',now());
    return {ok:true};
  }
  async function postUpdatePreflight(){
    if(store.isImporting())return {ok:false,busy:true};
    const started=performance.now();
    const result=await background('preflight').catch(()=>({ok:false}));
    event('update-preflight',result.ok?'ok':'failed',result.ok?'none':'sqlite-preflight',performance.now()-started);
    return {ok:!!result.ok,schemaVersion:result.schemaVersion??null,
      ftsHealthy:result.ftsHealthy===true,foreignKeyIssues:result.foreignKeyIssues??null};
  }
  function maintenanceConfiguration(){
    return {intervalMinutes:interval(),nextRunAt,enabled:automatic};
  }
  function configureMaintenance(minutes:number){
    if(!Number.isSafeInteger(minutes)||![15,30,60].includes(minutes))
      throw fail('Доступные интервалы обслуживания: 15, 30 или 60 минут.');
    store.write('maintenance-config',()=>store.setSetting('maintenanceIntervalMinutes',String(minutes)));
    event('schedule','ok','interval-updated');
    if(automatic){
      if(timer)clearTimeout(timer);
      schedule(minutes*60_000);
    }
    return maintenanceConfiguration();
  }
  async function maintenanceLog(limit=35){
    return {schedule:maintenanceConfiguration(),events:await journal.recent(limit)};
  }
  async function saveAttachment(conversationId:string,bytes:Buffer,type:string,fileName:string,messageId?:string){
    store.getConversation(conversationId);
    if(!bytes.length||bytes.length>15_000_000)throw fail('Размер вложения должен быть от 1 байта до 15 МБ.',413);
    if(!/^[a-z0-9+.-]+\/[a-z0-9+.-]+$/i.test(type)||type.length>100)throw fail('Неверный тип вложения.');
    const name=basename(String(fileName||'файл')).replace(/[\x00-\x1f]/g,'').slice(0,180)||'файл';
    if(messageId&&!store.visible(conversationId,messageId))throw fail('Сообщение для вложения не найдено.',404);
    await ensureSpace(store.home,bytes.length*2,'сохранение вложения');
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
  async function configureExternal(destination:string|null){
    if(destination===null||destination===''){
      store.write('backup-config',()=>store.setSetting('externalBackupPath',''));
      return {configured:false,destination:null};
    }
    if(typeof destination!=='string'||destination.length>512||!isAbsolute(destination))
      throw fail('Укажите абсолютный путь к папке на другом физическом диске.');
    const target=await realpath(destination).catch(()=>{throw fail('Диск резервного хранения не подключён или папка отсутствует.',404);});
    const targetStat=await stat(target);
    if(!targetStat.isDirectory())throw fail('Указан путь к файлу вместо папки.');
    const main=await realpath(store.home);
    if(process.platform==='win32'){
      if(parse(target).root.toLowerCase()===parse(main).root.toLowerCase())
        throw fail('Для независимых копий выберите другой диск Windows.');
      if(target.startsWith('\\'))throw fail('Укажите локальный внешний SSD, а не сетевой путь.');
    }else if(targetStat.dev===(await stat(main)).dev)
      throw fail('Резервный путь должен находиться на другой файловой системе.');
    await ensureSpace(target,128*1024*1024,'копирование на внешний SSD');
    const path=join(target,'Miyuneya-chat-backups');
    await mkdir(path,{recursive:true});
    store.write('backup-config',()=>store.setSetting('externalBackupPath',path));
    return {configured:true,destination:path};
  }
  function externalConfiguration(){
    const path=store.getSetting('externalBackupPath');
    return {configured:!!path,destination:path||null};
  }
  async function inspectAttachments(max=200){
    if(store.isImporting())throw fail('Импорт чата ещё выполняется.',423);
    const after=store.getSetting('attachmentScanCursor');
    const query='SELECT id,conversation_id,message_id,byte_size FROM attachments WHERE id>? ORDER BY id LIMIT ?';
    let rows=db.prepare(query).all(after,max) as Row[];
    if(!rows.length)rows=db.prepare(query).all('',max) as Row[];
    const issues:string[]=[];
    let inspected=0;
    for(const row of rows){
      const file=join(blobRoot,row.id+'.blob');
      const size=await stat(file).catch(()=>null);
      if(!size||size.size!==Number(row.byte_size))issues.push('Отсутствует или повреждён файл '+row.id);
      if(row.message_id && !store.visible(row.conversation_id,row.message_id))
        issues.push('Вложение связано с отсутствующим сообщением '+row.id);
      if(issues.length>=15)break;
      // Yield to HTTP events on low-end SSDs.
      if(++inspected%25===0)await new Promise(resolve=>setImmediate(resolve));
    }
    if(!issues.length&&rows.length)
      store.setSetting('attachmentScanCursor',rows[rows.length-1].id);
    // Also find ORPHANED blobs, e.g. when a crash occurs after atomic
    // file rename but before the INSERT into attachments commits.
    // The bounded scan resumes over successive checks; no auto-deletion.
    const skip=Math.min(1_000_000,Number(store.getSetting('orphanScanOffset')||0));
    let position=0,found=0,reachedEnd=true;
    const folder=await opendir(blobRoot).catch(e=>{
      if((e as NodeJS.ErrnoException).code==='ENOENT')return null;
      throw e;
    });
    if(folder){
      const known=db.prepare('SELECT 1 AS yes FROM attachments WHERE id=?');
      for await(const file of folder){
        if(file.isDirectory())continue;
        if(position++<skip)continue;
        if(file.name.endsWith('.blob')&&!known.get(file.name.slice(0,-5)))
          issues.push('Незарегистрированное вложение: '+file.name);
        else if(file.name.endsWith('.tmp'))
          issues.push('Незавершённый временный файл вложения: '+file.name);
        if(++found%25===0)await new Promise(resolve=>setImmediate(resolve));
        if(found>=max||issues.length>=15){reachedEnd=false;break;}
      }
    }
    if(!issues.length)
      store.setSetting('orphanScanOffset',reachedEnd?'0':String(position));
    return issues;
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
          if(sample.prepare('PRAGMA foreign_key_check').all().length)
            issues.push('Обнаружены нарушения внешних ключей в резервной копии');
          const actual=sample.prepare('SELECT id,sha256,byte_size FROM attachments').all() as Row[];
          const declared=new Map<string,Row>();
          for(const x of doc.attachments){
            if(declared.has(x.id))issues.push('Дублированная запись вложения в манифесте: '+x.id);
            declared.set(x.id,x);
          }
          if(actual.length!==doc.attachments.length)
            issues.push('Манифест резервной копии не соответствует количеству вложений базы');
          for(const row of actual){
            const expected=declared.get(row.id);
            if(!expected||expected.sha256!==row.sha256||Number(expected.size)!==Number(row.byte_size))
              issues.push('Манифест не содержит корректную запись вложения: '+row.id);
          }
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
  async function retryExternalBackup(){
    const destination=store.getSetting('externalBackupPath');
    if(!destination)return {skipped:true};
    const source=await latestBackup();
    if(!source)return {skipped:true};
    const suffix=basename(source),target=join(destination,suffix);
    const existing=await stat(target).catch(()=>null);
    if(existing){
      const verified=await verifyBackup(target);
      if(verified.ok){
        store.setSetting('lastExternalBackup',store.getSetting('lastBackup')||now());
        return {ok:true,directory:target,existing:true};
      }
      warnings.push('Предыдущая внешняя копия повреждена: '+suffix+'. Не перезаписана.');
      return {ok:false,error:'Обнаружена повреждённая внешняя копия, которая не будет перезаписана.'};
    }
    const pending=join(destination,'pending-retry-'+randomUUID());
    try{
      const localSize=await stat(join(source,'archive.sqlite'));
      await ensureSpace(destination,localSize.size*2,'восстановление внешней копии');
      await cp(source,pending,{recursive:true,force:false,errorOnExist:true});
      const check=await verifyBackup(pending);
      if(!check.ok)throw Error(check.issues.join('; '));
      await rename(pending,target);
      store.setSetting('lastExternalBackup',store.getSetting('lastBackup')||now());
      return {ok:true,directory:target};
    }catch(e){
      await rm(pending,{recursive:true,force:true}).catch(()=>{});
      warnings.push('Внешняя копия пока не готова: '+(e as Error).message);
      return {ok:false,error:(e as Error).message};
    }
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
      const destination=store.getSetting('externalBackupPath');
      let external:{ok:boolean;directory?:string;error?:string}|null=null;
      if(destination){
        const externalPending=join(destination,'pending-'+suffix);
        try{
          await ensureSpace(destination,bytes*1.2,'независимая копия на внешнем SSD');
          await cp(finalDir,externalPending,{recursive:true,force:false,errorOnExist:true});
          const other=await verifyBackup(externalPending);
          if(!other.ok)throw Error('Внешняя копия не прошла проверку SHA-256: '+other.issues.join('; '));
          const finalExternal=join(destination,suffix);
          await rename(externalPending,finalExternal);
          store.setSetting('lastExternalBackup',now());
          external={ok:true,directory:finalExternal};
        }catch(e){
          await rm(externalPending,{recursive:true,force:true}).catch(()=>{});
          external={ok:false,error:(e as Error).message};
          warnings.push('Внешний SSD: '+external.error+'. Локальная копия сохранена.');
        }
      }
      return {ok:true,directory:finalDir,external,attachments:rows.length,
        durationMs:Math.round(performance.now()-started)};
    }catch(e){
      await rm(pendingDir,{recursive:true,force:true}).catch(()=>{});
      warnings.push('Резервное копирование не выполнено: '+(e as Error).message);
      return {ok:false,error:(e as Error).message};
    }
  }
  function backupNow(){
    if(store.isImporting())return Promise.resolve({ok:false,error:'Дождитесь завершения импорта переписки.'});
    if(active)return Promise.resolve({ok:false,error:'Проверка или резервирование уже выполняется.'});
    const started=performance.now();
    const job=performBackup().then(result=>{
      event('backup',result.ok?'ok':'failed',result.ok?'none':'backup-failed',performance.now()-started);
      if(result.external)event('external-backup',result.external.ok?'ok':'warning',
        result.external.ok?'none':'external-unavailable');
      return result;
    });
    active=job;
    void job.finally(()=>{if(active===job)active=null;});
    return job;
  }
  async function check(){
    if(store.isImporting())return {ok:false,busy:true,details:'Импорт переписки ещё выполняется.'};
    const started=performance.now();
    const result=await background('check');
    event('check',result.ok?'ok':'failed',result.ok?'none':'integrity-error',performance.now()-started);
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
      // Orphaned temp/blob files are a warning, not a reason to stop
      // backing up unrelated valid messages.
      const missing=attachmentIssues.filter(x=>!x.startsWith('Незарегистрированное вложение:')
        &&!x.startsWith('Незавершённый временный файл'));
      if(missing.length)return {...result,ok:false,attachmentIssues};
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
      const freePages=Number((db.prepare('PRAGMA freelist_count').get() as Row).freelist_count);
      return {conversations:chatCount,messages,attachments:Number(files.n),
        attachmentBytes:Number(files.bytes),databaseBytes:pages*pageSize,
        unusedPages:freePages};
    });
    const [dbFile,walFile,shmFile]=await Promise.all([
      stat(store.path).catch(()=>null),
      stat(store.path+'-wal').catch(()=>null),
      stat(store.path+'-shm').catch(()=>null),
    ]);
    const dbFileBytes=dbFile?.size||0,walBytes=walFile?.size||0,shmBytes=shmFile?.size||0;
    const disk=await statfs(store.home).catch(()=>null);
    const freeBytes=disk?Number(disk.bavail)*Number(disk.bsize):null;
    const backupAt=store.getSetting('lastBackup')||null;
    if(warnings.length>100)warnings.splice(0,warnings.length-100);
    const alerts=[...new Set(warnings)].slice(-20);
    if(freeBytes!==null&&freeBytes<512*1024*1024)alerts.push('На диске осталось менее 512 МБ.');
    if(info.messages&&(!backupAt||Date.now()-Date.parse(backupAt)>48*3600_000))
      alerts.push('Нет свежей проверенной резервной копии за последние 48 часов.');
    const old=store.getSetting('growthBaseline');
    try{
      const previous=JSON.parse(old||'null');
      if(previous&&previous.bytes>0&&dbFileBytes>previous.bytes*1.75
        &&info.messages<=previous.messages*1.1+15)
        alerts.push('SQLite резко вырос без сопоставимого увеличения количества сообщений.');
    }catch{alerts.push('Не удалось прочитать контрольную статистику роста SQLite.');}
    const externalPath=store.getSetting('externalBackupPath')||null;
    if(externalPath&&!store.getSetting('lastExternalBackup'))
      alerts.push('Внешний SSD подключён к резервированию, но проверенной внешней копии ещё нет.');
    const slow=[...store.timings].map(([name,v])=>({
      name,calls:v.count,averageMs:Math.round(v.sum/v.count*100)/100,maxMs:Math.round(v.max*100)/100
    })).sort((a,b)=>b.maxMs-a.maxMs).slice(0,12);
    if(slow.some(x=>x.name==='save'&&x.maxMs>500))
      alerts.push('Запись сообщений выполнялась дольше 500 мс. Проверьте состояние диска.');
    if(walBytes>=256*1024*1024)
      alerts.push('SQLite WAL занимает более 256 МБ. Проверьте длительные читающие операции.');
    return {...info,freeBytes,backupAt,dbFileBytes,walBytes,shmBytes,
      externalBackupPath:externalPath,lastExternalBackup:store.getSetting('lastExternalBackup')||null,
      backupCount:Number(store.getSetting('backupCount')||0),
      backupBytes:Number(store.getSetting('backupBytes')||0),
      readOnly:store.readOnly(),wal:true,
      warnings:alerts,operations:slow,backupRunning:!!active};
  }
  // Long-running readers may prevent complete WAL checkpointing. Only use
  // PASSIVE (never TRUNCATE) while a conversation can be streamed.
  async function inspectWal(){
    if(store.isImporting()||stopped)return {ok:false,busy:true};
    const bytes=(await stat(store.path+'-wal').catch(()=>null))?.size||0;
    if(bytes<32*1024*1024)return {ok:true,skipped:true,walBytes:bytes};
    const started=performance.now();
    const result=await background('checkpoint').catch(()=>({ok:false}));
    event('checkpoint',result.ok?'ok':'warning',result.ok?'passive':'checkpoint-failed',performance.now()-started);
    const after=(await stat(store.path+'-wal').catch(()=>null))?.size||0;
    if(result.busy||after>=256*1024*1024)
      warnings.push('WAL ещё занят активным читателем или превышает 256 МБ: это не повод удалять файлы SQLite.');
    return {...result,walBytes:after};
  }
  async function maintain(){
    if(stopped||active||scheduledJob||store.isImporting())return;
    // Self-test, optimization, backup and WAL check have separate cadences,
    // but share one non-overlapping scheduler.
    const task=(async()=>{
      try{
        const lastCheck=store.getSetting('lastCheck');
        if(!lastCheck||Date.now()-Date.parse(lastCheck)>24*3600_000){
          const checked=await check();
          if(!checked.ok){event('schedule','warning','integrity-not-ready');return;}
          const current=await statistics();
          store.setSetting('growthBaseline',JSON.stringify({
            bytes:current.dbFileBytes,messages:current.messages,at:now()
          }));
          const started=performance.now();
          const optimized=await background('optimize');
          event('optimize',optimized.ok?'ok':'warning',optimized.ok?'none':'optimizer-failed',performance.now()-started);
          if(!optimized.ok)warnings.push('Не удалось обновить статистику индексов SQLite.');
        }
        await inspectWal();
        const last=store.getSetting('lastBackup');
        if(!last||Date.now()-Date.parse(last)>24*3600_000)await backupNow();
        const external=store.getSetting('externalBackupPath');
        const recent=store.getSetting('lastExternalBackup');
        if(external&&(!recent||Date.parse(recent)<Date.parse(store.getSetting('lastBackup')||now()))){
          const copy=await retryExternalBackup();
          event('external-backup',copy.ok?'ok':'warning',copy.ok?'none':'external-unavailable');
        }
        event('schedule','ok');
      }catch{
        warnings.push('Очередная операция обслуживания не завершилась. Проверьте журнал.');
        event('schedule','failed','maintenance-error');
      }
    })();
    scheduledJob=task;
    try{await task;}finally{scheduledJob=null;}
  }
  function schedule(delay:number){
    if(stopped)return;
    nextRunAt=new Date(Date.now()+delay).toISOString();
    timer=setTimeout(async()=>{
      nextRunAt=null;
      await maintain();
      if(!stopped)schedule(interval()*60_000);
    },delay);
    timer.unref?.();
  }
  if(automatic)schedule(12000);
  return {
    saveAttachment,listAttachments,attachment,backupNow,verifyBackup,latestBackup,check,statistics,
    reindex,configureExternal,externalConfiguration,inspectAttachments,retryExternalBackup,
    postUpdatePreflight,maintenanceLog,maintenanceConfiguration,configureMaintenance,inspectWal,
    runMaintenance:maintain,
    shutdown:async()=>{stopped=true;nextRunAt=null;if(timer)clearTimeout(timer);
      await Promise.allSettled([...workers].map(worker=>worker.terminate()));
      if(scheduledJob)await scheduledJob;
      if(active)await active;
      await journal.shutdown();
    }
  };
}
