// Slow integrity, graph consistency and optimization run outside the HTTP
// thread. Source files, message bodies and Cloud.ru credentials are not logged.
import { workerData, parentPort } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
let db;
try {
  const { path, action } = workerData || {};
  if (typeof path !== 'string' || !['check', 'rebuild', 'optimize', 'checkpoint', 'preflight'].includes(action))
    throw new Error('Неверная фоновая операция.');
  db = new DatabaseSync(path,{timeout:7000});
  if(action==='preflight'){
    // This endpoint is used BEFORE committing a staged program update.
    // It must not modify the user's DB schema, messages or attachments.
    const version=Number(db.prepare('PRAGMA user_version').get().user_version);
    const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
    const required=['conversations','messages','settings','attachments','message_fts'];
    const missing=required.filter(name=>!tables.has(name));
    const quick=db.prepare('PRAGMA quick_check(1)').get().quick_check;
    const foreign=db.prepare('PRAGMA foreign_key_check').all().length;
    let fts=true;
    try{db.prepare("INSERT INTO message_fts(message_fts,rank) VALUES('integrity-check',1)").run();}
    catch{fts=false;}
    const ok=version===4&&!missing.length&&quick==='ok'&&!foreign&&fts;
    parentPort?.postMessage({ok,schemaVersion:version,missingTables:missing.length,
      foreignKeyIssues:foreign,ftsHealthy:fts,details:quick==='ok'?'ok':'integrity-failed'});
  }else if(action==='checkpoint'){
    // PASSIVE is non-destructive and never waits for a long-lived reader.
    const row=db.prepare('PRAGMA wal_checkpoint(PASSIVE)').get();
    parentPort?.postMessage({ok:true,busy:Number(row.busy),walFrames:Number(row.log),
      checkpointedFrames:Number(row.checkpointed)});
  }else if(action==='check') {
    const integrity=String(db.prepare('PRAGMA quick_check(1)').get().quick_check);
    const foreign=db.prepare('PRAGMA foreign_key_check').all().slice(0,20)
      .map(row=>({table:String(row.table),rowid:Number(row.rowid)}));
    let ftsHealthy=true;
    try{db.prepare("INSERT INTO message_fts(message_fts,rank) VALUES('integrity-check',1)").run();}
    catch{ftsHealthy=false;}
    const issues=[];
    // Validate all fork points without copying the original conversation.
    const chats=db.prepare('SELECT id,parent_id,fork_message_id,inherited_count,message_count FROM conversations').all();
    const map=new Map(chats.map(row=>[row.id,row]));
    const completed=new Set();
    const follow=(id,visiting=new Set())=>{
      if(completed.has(id))return;
      if(visiting.has(id)){issues.push('Обнаружен цикл ветвлений.');return;}
      const c=map.get(id);if(!c)return;
      visiting.add(id);
      if(c.parent_id){
        const parent=map.get(c.parent_id);
        if(!parent){issues.push('Не найден родитель ветки '+id);}
        else{
          follow(parent.id,visiting);
          if(c.inherited_count>parent.message_count||c.inherited_count<1)
            issues.push('Некорректная граница ветки '+id);
          const fork=db.prepare('SELECT id FROM messages WHERE id=?').get(c.fork_message_id);
          if(!fork)issues.push('Не найдено исходное сообщение ветки '+id);
        }
      }else if(c.inherited_count!==0||c.fork_message_id)
        issues.push('Некорректная исходная ветка '+id);
      const local=db.prepare('SELECT COUNT(*) n,MIN(sequence) first,MAX(sequence) last FROM messages WHERE conversation_id=?').get(id);
      if(Number(local.n)+Number(c.inherited_count)!==Number(c.message_count)||
        (local.n&&Number(local.first)!==Number(c.inherited_count)+1)||
        (local.n&&Number(local.last)!==Number(c.message_count)))
        issues.push('Нарушена последовательность сообщений '+id);
      visiting.delete(id);completed.add(id);
    };
    for(const c of chats){
      follow(c.id);
      if(issues.length>=50)break;
    }
    // Parent references must point to an existing record (logical branches
    // may legitimately reference messages in their ancestors).
    const missingParents=db.prepare('SELECT COUNT(*) n FROM messages m WHERE m.parent_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM messages p WHERE p.id=m.parent_message_id)').get().n;
    if(missingParents)issues.push('Отсутствуют родительские сообщения: '+missingParents);
    const ok=integrity==='ok'&&!foreign.length&&!issues.length;
    parentPort?.postMessage({ok,ftsHealthy,details:integrity,foreignKeys:foreign,graphIssues:issues});
  }else if(action==='rebuild'){
    db.exec('BEGIN IMMEDIATE');
    try{
      db.prepare("INSERT INTO message_fts(message_fts) VALUES('rebuild')").run();
      db.exec('COMMIT');
      parentPort?.postMessage({ok:true});
    }catch(e){db.exec('ROLLBACK');throw e;}
  }else{
    db.exec('PRAGMA optimize=0x10002;');
    parentPort?.postMessage({ok:true});
  }
}catch(e) {
  parentPort?.postMessage({ok:false,error:e instanceof Error?e.message:'Фоновая проверка завершилась с ошибкой.'});
}finally { db?.close(); }
