import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { realpath, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { atomicWrite, readJSON, healthy, localRequest, acquireLock, makeLogger, retryFile } from './runtime.mjs';
import { ensureBuild } from './build.mjs';
import { updateManager } from './update.mjs';
const [major,minor]=process.versions.node.split('.').map(Number);
if(major<22 || (major===22 && minor<18)) {console.error('Нужен рабочий Node.js 22.18 или новее. Запустите Miyuneya.bat для подготовки среды.');process.exit(20);}
const root=await realpath(fileURLToPath(new URL('..',import.meta.url)));
const identity=process.platform==='win32'?root.toLowerCase():root;
const instance=createHash('sha256').update(identity).digest('hex').slice(0,24);
const pointerFile=join(root,'.runtime','server.json');
const preview=process.argv.includes('--preview');
const option=name=>{const index=process.argv.indexOf(name);return index<0?undefined:process.argv[index+1];};
const open=process.argv.includes('--open') && process.env.MIYUNEYA_NO_OPEN!=='1';
let stage='lock';let logger;let release;let child;let stopping=false;let restartRequested=false;
let transaction;
function show(url,reused=false) {console.log(`\n✦ Miyuneya · ${reused?'уже запущена':'готова'}\n${url}\n\nДанные: папка data рядом с проектом.\nОстановить сервер можно клавишами Ctrl+C.\n`);}
function openBrowser(url) {
  if(!open) return;
  const executable=process.platform==='win32'?join(process.env.SystemRoot || 'C:\\Windows','explorer.exe'):process.platform==='darwin'?'open':'xdg-open';
  const browser=spawn(executable,[url],{detached:true,stdio:'ignore',windowsHide:true});
  browser.on('error',()=>console.warn('Браузер не открылся. Откройте адрес выше вручную.'));browser.unref();
}
async function stopChild(processState) {
  if(!processState || processState.ended) return;
  if(processState.process.connected) processState.process.send({type:'shutdown'},()=>{});
  const deadline=setTimeout(()=>{processState.forced=true;processState.process.kill();},15000);
  try {await processState.closed;} finally {clearTimeout(deadline);}
  if(processState.forced) throw Object.assign(new Error('Shutdown deadline exceeded'),{code:'SHUTDOWN_TIMEOUT'});
}
function requestStop() {stopping=true;if(child) stopChild(child).catch(()=>{process.exitCode=44;});}
function requestRestart() {if(stopping||restartRequested)return;restartRequested=true;if(child)stopChild(child).catch(()=>{process.exitCode=44;});}
process.on('SIGINT',requestStop);process.on('SIGTERM',requestStop);
async function runServer(portHint=0) {
  const launchId=randomUUID();
  const port=preview?Number(option('--port') || process.env.PORT || 5173):portHint;
  const host=preview?(option('--host') || '127.0.0.1'):'127.0.0.1';
  if(!Number.isInteger(port)||port<0||port>65535)throw Object.assign(new Error('Invalid preview port'),{code:'INVALID_PORT'});
  const proc=spawn(process.execPath,[join(root,'scripts','serve.mjs')],{cwd:root,stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
  const state={process:proc,ended:false,forced:false,closed:null};
  state.closed=new Promise(resolve=>{proc.once('close',(code,signal)=>{state.ended=true;resolve({code,signal});});});
  proc.stdout.resume();proc.stderr.resume(); // Never write arbitrary child output or user data into diagnostics.
  proc.on('message',message=>{if(message?.type==='stop-requested') requestStop();if(message?.type==='update-restart-requested')requestRestart();});
  child=state;
  try {
    const ready=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Object.assign(new Error('Startup timeout'),{code:'START_TIMEOUT'})),12000);
      const finish=(error,message)=>{clearTimeout(timer);proc.removeListener('message',onMessage);proc.removeListener('error',onError);error?reject(error):resolve(message);};
      const onError=e=>finish(e);
      const onMessage=message=>{if(message?.type==='ready')finish(null,message);if(message?.type==='failed')finish(Object.assign(new Error('Server failed'),{code:message.code}));};
      proc.on('message',onMessage);proc.once('error',onError);
      state.closed.then(({code})=>finish(Object.assign(new Error('Server exited'),{code:'SERVER_EXIT_'+code})));
      proc.send({type:'init',instance,launchId,port,host,preview},e=>{if(e)finish(e);});
    });
    const pointer={port:ready.port,instance,launchId,pid:proc.pid};
    stage='health';
    if(!await healthy(pointer,instance)) throw Object.assign(new Error('Invalid health response'),{code:'HEALTH_FAILED'});
    for(const path of ['/','/blank.css','/blank.js','/main.js','/model.js','/calendar.js','/assistant.js','/appearance.js','/memory.js','/disk.js','/style.css','/fox.svg','/favicon.svg']) {
      const response=await localRequest(pointer.port,path);
      if(response.status!==200 || !response.body.length) throw Object.assign(new Error('Asset readiness failed'),{code:'ASSET_NOT_READY'});
    }
    return {state,pointer};
  } catch(e){await stopChild(state);child=null;throw e;}
}
async function legacyInstance() {
  let saved;try{saved=await readJSON(pointerFile);}catch(e){if(e.code==='ENOENT' || e instanceof SyntaxError)return null;throw e;}
  if(saved.launchId || !Number.isInteger(saved.port) || saved.port<1 || saved.port>65535)return null;
  try{
    const response=await localRequest(saved.port,'/__miyuneya/health');const body=JSON.parse(response.body);
    const legacy=createHash('sha256').update(root).digest('hex').slice(0,24);
    if(response.status===200 && body.app==='Miyuneya' && (body.instance===legacy || body.instance===instance))return saved;
  }catch{}
  return null;
}
async function main() {
  // The original 0.1.0 launcher used a file lock. Never start a second writer beside it.
  const legacy=await legacyInstance();
  if(legacy){const url=`http://127.0.0.1:${legacy.port}`;console.warn('Работает предыдущая версия Miyuneya. Закройте её окно и снова запустите BAT, чтобы применить обновлённый запуск.');show(url,true);openBrowser(url);return;}
  if(process.platform==='win32' && root.startsWith('\\\\')) throw Object.assign(new Error('UNC path unsupported'),{code:'UNC_NOT_SUPPORTED'});
  release=await acquireLock(instance);
  if(!release) {
    const deadline=Date.now()+30000;
    do {
      try {const pointer=await readJSON(pointerFile);if(await healthy(pointer,instance)){const url=`http://127.0.0.1:${pointer.port}`;show(url,true);openBrowser(url);return;}}catch(e){if(e.code!=='ENOENT' && !(e instanceof SyntaxError))throw e;}
      if(stopping)return;
      await delay(150);
    } while(Date.now()<deadline);
    throw Object.assign(new Error('Another startup did not become healthy'),{code:'INSTANCE_NOT_READY'});
  }
  logger=await makeLogger(root);await logger.log('runtime','node-ready');
  let portHint=0;
  while(!stopping){
  stage='update';transaction=await updateManager(root,logger);
  let ready;
  try {
    stage='build';const rebuilt=await ensureBuild(root);await logger.log('build',rebuilt?'repaired':'intact');
    if(stopping)return;
    stage='server';ready=await runServer(portHint);
    // The quick HTTP health check is insufficient after changing code:
    // validate the actual SQLite schema, FK links, FTS and integrity BEFORE
    // marking an update installed. On failure, stop this candidate first.
    if(transaction.applied){
      stage='health';
      const verified=await localRequest(ready.pointer.port,'/__miyuneya/post-update-check',{
        method:'POST',headers:{'X-Miyuneya-Session':ready.pointer.launchId},
        timeout:25000
      });
      let status={};
      try{status=JSON.parse(verified.body);}catch{}
      if(verified.status!==200 || status.ok!==true || status.schemaVersion!==4)
        throw Object.assign(new Error('Post-update SQLite preflight failed'),{code:'UPDATE_PREFLIGHT_FAILED'});
      await logger.log('update','sqlite-preflight-ok');
    }
  } catch(e) {
    if(ready?.state){await stopChild(ready.state);child=null;ready=undefined;}
    if(!transaction.applied)throw e;
    await logger.log(stage,'candidate-failed',40);await transaction.rollback();transaction.applied=false;
    stage='build';await ensureBuild(root);stage='server';ready=await runServer(portHint);
  }
  if(stopping){await stopChild(ready.state);return;}
  await atomicWrite(pointerFile,JSON.stringify(ready.pointer));
  if(transaction.applied)await transaction.commit();
  await logger.log('health','ready');
  const url=`http://127.0.0.1:${ready.pointer.port}`;show(url);openBrowser(url);
  const result=await ready.state.closed;child=null;
  if(restartRequested && !stopping){
    restartRequested=false;
    portHint=ready.pointer.port; // Reuse the same loopback URL so the browser reconnects.
    await logger.log('update','restarting');
    await retryFile(()=>rm(pointerFile,{force:true}));
    continue;
  }
  if(!stopping && result.code!==0)throw Object.assign(new Error('Unexpected server exit'),{code:'SERVER_EXIT_'+result.code});
  await logger.log('shutdown','writes-drained');
  break;
  }
}
try {await main();}
catch(e) {
  const code=stage==='build'?30:stage==='health'?41:stage==='update'?50:stage==='lock'?24:40;
  process.exitCode=code;
  const reason=typeof e.code==='string' && /^[A-Z0-9_]+$/.test(e.code)?e.code:'STAGE_FAILED';
  console.error(`Ошибка Miyuneya: этап ${stage}, причина ${reason}, код завершения ${code}.`);
  const actions={lock:'Закройте зависшее окно именно этой копии Miyuneya и повторите запуск. UNC-пути не поддерживаются.',build:'Проверьте файлы src и web и права записи. Повторно распакуйте код проекта, сохранив папку data.',server:'Проверьте целостность кода и data/workspace.json. Не удаляйте пользовательские данные.',health:'Сервер не подтвердил готовность. Повторите запуск; подробности этапа записаны в журнал.',update:'Сохраните .runtime/updates: там находятся журнал и резервная копия для восстановления.'};
  console.error(actions[stage] || 'Проверьте права записи в папку проекта.');
  if(logger)await logger.log(stage,reason,code);
}
finally {
  const cleanupErrors=[];
  try{await stopChild(child);}catch(e){cleanupErrors.push(e);}
  if(release) {
    try{const pointer=await readJSON(pointerFile);if(pointer.instance===instance)await retryFile(()=>rm(pointerFile,{force:true}));}catch(e){if(e.code!=='ENOENT' && !(e instanceof SyntaxError))cleanupErrors.push(e);}
    try{await release();}catch(e){cleanupErrors.push(e);}
  }
  try{await logger?.close();}catch(e){cleanupErrors.push(e);}
  if(cleanupErrors.length){console.error('Не удалось завершить очистку Miyuneya; проверьте права записи и журнал.');process.exitCode=44;}
  process.removeListener('SIGINT',requestStop);process.removeListener('SIGTERM',requestStop);
}
