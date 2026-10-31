import { mkdir, readdir, readFile, lstat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { allowed } from './update.mjs';
import { atomicWrite, readJSON } from './runtime.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const pkg=await readJSON(join(root,'package.json'));
if(!/^\d+\.\d+\.\d+$/.test(pkg.version))throw new Error('Неверная версия package.json');
const files=[];
let total=0;
async function scan(folder){
  for(const entry of (await readdir(join(root,folder),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    const relative=folder+'/'+entry.name;
    if(entry.isSymbolicLink())throw new Error('Символические ссылки запрещены при публикации: '+relative);
    if(entry.isDirectory()){await scan(relative);continue;}
    if(!entry.isFile()||!allowed.test(relative))continue;
    const bytes=await readFile(join(root,relative));total+=bytes.length;
    if(total>16_000_000)throw new Error('Пакет превышает 16 МБ исходных файлов');
    files.push({path:relative,sha256:sha(bytes),data:bytes.toString('base64')});
  }
}
for(const dir of ['src','server','web','scripts'])await scan(dir);
if(files.length===0||files.length>100)throw new Error('Неверное количество файлов релиза: '+files.length);
for(const essential of ['server/app.ts','server/update-service.ts','web/blank.html','web/blank.js','src/main.ts'])
  if(!files.some(x=>x.path===essential))throw new Error('Нет обязательного файла: '+essential);
const payload=JSON.stringify({schema:1,version:pkg.version,files});
const output=join(root,'artifacts','miyuneya-update.json');
await mkdir(dirname(output),{recursive:true});
await atomicWrite(output,payload);
console.log('Пакет для GitHub Release: '+files.length+' файлов, '+total+' байт данных, версия '+pkg.version);
