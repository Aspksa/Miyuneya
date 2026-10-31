// Independent background maintenance: heavy integrity and FTS scans must not
// block Miyuneya's HTTP/streaming thread or the animated chat.
import { workerData, parentPort } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
let db;
try {
  const { path, action } = workerData || {};
  if (typeof path !== 'string' || !['check', 'rebuild'].includes(action))
    throw new Error('Неверная фоновая операция.');
  db = new DatabaseSync(path,{timeout:5000});
  if(action==='check') {
    const integrity=String(db.prepare('PRAGMA quick_check(1)').get().quick_check);
    let ftsHealthy=true;
    try{db.prepare("INSERT INTO message_fts(message_fts,rank) VALUES('integrity-check',1)").run();}
    catch{ftsHealthy=false;}
    parentPort?.postMessage({ok:integrity==='ok',ftsHealthy,details:integrity});
  }else{
    db.exec('BEGIN IMMEDIATE');
    try{
      db.prepare("INSERT INTO message_fts(message_fts) VALUES('rebuild')").run();
      db.exec('COMMIT');
      parentPort?.postMessage({ok:true});
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
}catch(e) {
  parentPort?.postMessage({ok:false,error:e instanceof Error?e.message:'Фоновая проверка завершилась с ошибкой.'});
}finally {
  db?.close();
}
