import { readFile, lstat, mkdir, rename } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { atomicWrite, readJSON, removeTree, retryFile } from './runtime.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const allowed = /^(?:src\/[a-zA-Z0-9_-]+\.ts|server\/(?:app|memory|recall|growth|logic|disk)\.ts|web\/(?:index\.html|style\.css|fox\.svg|favicon\.svg|avatars\/avatar[1-4]\.png))$/;
async function plainPath(root,relative,missing=false) {
  const pieces=relative.split('/');
  for(let i=1;i<=pieces.length;i++) {
    try {const stat=await lstat(join(root,...pieces.slice(0,i)));if(stat.isSymbolicLink()) throw new Error('Символические ссылки в обновлении запрещены.');}
    catch(e){if(missing && e.code==='ENOENT') return;throw e;}
  }
}
async function verify(folder) {
  const manifest=await readJSON(join(folder,'update.json'));
  if(manifest.schema!==1 || typeof manifest.version!=='string' || !/^\d+\.\d+\.\d+$/.test(manifest.version) || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length>100) throw new Error('Неверный манифест обновления.');
  const seen=new Set();let total=0;
  for(const entry of manifest.files) {
    if(!entry || typeof entry.path!=='string' || !allowed.test(entry.path) || seen.has(entry.path) || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Недопустимый файл обновления.');
    seen.add(entry.path);await plainPath(folder,entry.path);
    const bytes=await readFile(join(folder,entry.path));total+=bytes.length;
    if(total>10_000_000 || hash(bytes)!==entry.sha256) throw new Error('Проверка SHA-256 обновления не пройдена.');
  }
  return manifest;
}
export async function prepareUpdate(root,source) {
  const folder=resolve(source);await plainPath(folder,'update.json');
  const manifest=await verify(folder);
  const area=join(root,'.runtime','updates');await mkdir(area,{recursive:true});
  const temporary=join(area,'prepare-'+randomUUID());await mkdir(temporary);
  try {
    for(const entry of manifest.files) await atomicWrite(join(temporary,entry.path),await readFile(join(folder,entry.path)));
    await atomicWrite(join(temporary,'update.json'),JSON.stringify(manifest));await verify(temporary);
    // Directory rename refuses to replace an already prepared update.
    await rename(temporary,join(area,'pending'));
  } catch(e){await removeTree(temporary);throw e;}
}
export async function updateManager(root,logger) {
  const area=join(root,'.runtime','updates');const pending=join(area,'pending');const transaction=join(area,'transaction.json');
  await mkdir(area,{recursive:true});
  async function quarantine() {
    try { await retryFile(()=>rename(pending,join(area,'rejected-'+randomUUID()))); }
    catch(e){if(e.code!=='ENOENT') throw e;}
  }
  async function rollback() {
    let journal;try {journal=await readJSON(transaction);} catch(e){if(e.code==='ENOENT')return false;throw e;}
    if(!Array.isArray(journal.files) || !/^backup-[a-f0-9-]+$/.test(journal.backup)) throw new Error('Повреждён журнал отката. Сохраните .runtime/updates и восстановите файлы из резервной копии.');
    for(const entry of journal.files) {
      if(!allowed.test(entry.path) || typeof entry.existed!=='boolean') throw new Error('Повреждён список отката.');
      await plainPath(root,entry.path,true);
      if(entry.existed) await atomicWrite(join(root,entry.path),await readFile(join(area,journal.backup,entry.path)));
      else await removeTree(join(root,entry.path));
    }
    await quarantine();
    await removeTree(transaction);
    await logger.log('update','rolled-back');
    console.warn('Обновление отменено; предыдущие файлы восстановлены. Пользовательские данные сохранены.');
    return true;
  }
  await rollback(); // A crash before first successful health must not leave a half-installed version.
  let manifest;
  try {manifest=await verify(pending);}
  catch(e){if(e.code==='ENOENT'){try{await lstat(pending);}catch(missing){if(missing.code==='ENOENT')return {applied:false,commit:async()=>{},rollback};throw missing;}}await quarantine();await logger.log('update','rejected',50);console.warn('Повреждённое подготовленное обновление отложено. Запускается текущая версия.');return {applied:false,commit:async()=>{},rollback};}
  const backup='backup-'+randomUUID();const files=[];
  try {
    // Finish all backups before recording the transaction or changing any project file.
    for(const entry of manifest.files) {
      await plainPath(root,entry.path,true);
      try {await atomicWrite(join(area,backup,entry.path),await readFile(join(root,entry.path)));files.push({path:entry.path,existed:true});}
      catch(e){if(e.code!=='ENOENT')throw e;files.push({path:entry.path,existed:false});}
    }
    await atomicWrite(transaction,JSON.stringify({schema:1,backup,files,version:manifest.version}));
    // Reverify staged bytes immediately before every replacement.
    for(const entry of manifest.files) {
      const bytes=await readFile(join(pending,entry.path));if(hash(bytes)!==entry.sha256)throw new Error('Подготовленное обновление изменилось.');
      await atomicWrite(join(root,entry.path),bytes);
    }
    await logger.log('update','applied');
  } catch(e) {await rollback();return {applied:false,commit:async()=>{},rollback};}
  return {
    applied:true, rollback,
    async commit() {
      // Move pending out of the active path first. If interrupted, the journal still triggers rollback.
      await rename(pending,join(area,'installed-'+randomUUID()));
      await removeTree(transaction);
      await logger.log('update','first-health-passed');
    }
  };
}
if(process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1])) {
  if(process.argv[2]!=='prepare' || !process.argv[3]) {console.error('Использование: node scripts/update.mjs prepare <папка проверенного обновления>');process.exitCode=2;}
  else {await prepareUpdate(fileURLToPath(new URL('..',import.meta.url)),process.argv[3]);console.log('Обновление проверено и подготовлено. Закройте Miyuneya и запустите основной BAT.');}
}
