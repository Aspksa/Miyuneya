import { mkdir, open, readFile, rename, rm, lstat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { createReadStream } from 'node:fs';
import { inflateRawSync, crc32 } from 'node:zlib';
import { atomicWrite, retryFile } from '../scripts/runtime.mjs';
export const FILE_LIMIT = 64 * 1024 * 1024;
export type DiskFile = { id: string; name: string; folder: string | null; size: number; sha256: string; createdAt: string; updatedAt: string; starred: boolean; trashedAt: string | null };
type Folder = { id: string; name: string };
type Index = { version: 1; revision: number; files: DiskFile[]; folders: Folder[] };
const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });
const idValid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9-]{36}$/.test(v);
const dateValid = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
export function fileName(value: unknown): string {
  if (typeof value !== 'string') throw fail('Укажите имя документа.');
  const name = value.trim().normalize('NFC');
  if (!name || name.length > 180 || /[\x00-\x1f\x7f<>:"/\\|?*]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) || name === '.' || name === '..') throw fail('Имя содержит недопустимые символы или слишком длинное.');
  return name;
}
function validIndex(v): v is Index {
  return v?.version === 1 && Number.isSafeInteger(v.revision) && v.revision >= 0 && Array.isArray(v.files) && v.files.length <= 10000 && Array.isArray(v.folders) && v.folders.length <= 500
    && v.folders.every(f => idValid(f?.id) && (()=>{try{return fileName(f.name)===f.name;}catch{return false;}})())
    && new Set([...v.files,...v.folders].map(x=>x?.id)).size === v.files.length + v.folders.length
    && v.files.every(f => idValid(f?.id) && Number.isSafeInteger(f.size) && f.size >= 0 && f.size <= FILE_LIMIT && /^[a-f0-9]{64}$/.test(f.sha256) && typeof f.starred === 'boolean' && dateValid(f.createdAt) && dateValid(f.updatedAt) && (f.trashedAt === null || dateValid(f.trashedAt)) && (f.folder === null || v.folders.some(d=>d.id===f.folder)) && (()=>{try{return fileName(f.name)===f.name;}catch{return false;}})());
}
// A bounded DOCX reader: only the main document part, no macros, external links or attachments.
async function docxText(handle, size: number) {
  const tail = Buffer.alloc(Math.min(size, 65557)); await handle.read(tail, 0, tail.length, size-tail.length);
  let eocd = -1; for(let p=tail.length-22;p>=0;p--) if(tail.readUInt32LE(p)===0x06054b50 && p+22+tail.readUInt16LE(p+20)===tail.length){eocd=p;break;}
  if(eocd<0 || tail.readUInt16LE(eocd+4) || tail.readUInt16LE(eocd+6)) throw fail('DOCX повреждён или использует неподдерживаемый ZIP.');
  const count=tail.readUInt16LE(eocd+10), length=tail.readUInt32LE(eocd+12), offset=tail.readUInt32LE(eocd+16);
  if(count>5000 || length>2_000_000 || offset+length>size) throw fail('Слишком сложная структура DOCX.');
  const directory=Buffer.alloc(length); await handle.read(directory,0,length,offset);
  let p=0;
  for(let i=0;i<count;i++) {
    if(p+46>length || directory.readUInt32LE(p)!==0x02014b50) throw fail('Структура DOCX повреждена.');
    const flags=directory.readUInt16LE(p+8), method=directory.readUInt16LE(p+10), crc=directory.readUInt32LE(p+16), compressed=directory.readUInt32LE(p+20), plain=directory.readUInt32LE(p+24), names=directory.readUInt16LE(p+28), extra=directory.readUInt16LE(p+30), comment=directory.readUInt16LE(p+32), local=directory.readUInt32LE(p+42);
    if(p+46+names+extra+comment>length) throw fail('Структура DOCX повреждена.');
    const name=directory.subarray(p+46,p+46+names).toString('utf8');p+=46+names+extra+comment;
    if(name!=='word/document.xml')continue;
    if(flags&1 || ![0,8].includes(method) || plain>2_000_000 || compressed>2_000_000 || local+30>size) throw fail('Зашифрованный или слишком большой текст DOCX не поддерживается.');
    const header=Buffer.alloc(30);await handle.read(header,0,30,local);
    if(header.readUInt32LE(0)!==0x04034b50)throw fail('Структура DOCX повреждена.');
    const start=local+30+header.readUInt16LE(26)+header.readUInt16LE(28);if(start+compressed>size)throw fail('Структура DOCX повреждена.');
    const bytes=Buffer.alloc(compressed);await handle.read(bytes,0,compressed,start);
    const xml=method===8?inflateRawSync(bytes,{maxOutputLength:2_000_000}):bytes;
    if(xml.length!==plain || crc32(xml)!==crc)throw fail('Проверка целостности DOCX не пройдена.');
    const text=xml.toString('utf8').replace(/<w:tab\b[^>]*\/>/g,'\t').replace(/<\/w:p>/g,'\n').replace(/<[^>]*>/g,'').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,v)=>{const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};if(entities[v])return entities[v];const n=v[1]?.toLowerCase()==='x'?parseInt(v.slice(2),16):Number(v.slice(1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):'�';});
    return {kind:'text',text:text.slice(0,100000),truncated:text.length>100000,format:'DOCX'};
  }
  throw fail('В DOCX отсутствует основной текст.');
}
export async function openDisk(dataDir: string) {
  const root=join(dataDir,'disk'), blobs=join(root,'blobs'), indexFile=join(root,'index.json');
  let state: Index={version:1,revision:0,files:[],folders:[]};
  try{const saved=JSON.parse(await readFile(indexFile,'utf8'));if(!validIndex(saved))throw fail('Индекс диска повреждён.',503);state=saved;}
  catch(e){if(e.code!=='ENOENT')throw fail('Не удалось прочитать data/disk/index.json. Исходные файлы сохранены; восстановите индекс из копии.',503);}
  let queue=Promise.resolve();
  const enqueue=<T>(fn:()=>Promise<T>):Promise<T>=>{const operation=queue.then(fn);queue=operation.then(()=>{},()=>{});return operation;};
  const view=()=>({...state,fileLimit:FILE_LIMIT});
  async function commit(next: Index){await atomicWrite(indexFile,JSON.stringify(next,null,2));state=next;}
  async function blobPath(id:string){const path=join(blobs,id);const stat=await lstat(path);if(!stat.isFile() || stat.isSymbolicLink())throw fail('Документ недоступен.',404);return path;}
  async function json(req){if(!req.headers['content-type']?.startsWith('application/json'))throw fail('Ожидается JSON.',415);let body='';req.setEncoding('utf8');for await(const part of req){body+=part;if(Buffer.byteLength(body)>10000)throw fail('Слишком большой запрос.',413);}try{return JSON.parse(body);}catch{throw fail('Неверный JSON.');}}
  async function mutate(req, fn:(next:Index,input:any)=>void){const input=await json(req);await enqueue(async()=>{if(!input || input.revision!==state.revision)throw fail('Список диска изменился. Обновите его и повторите действие.',409);const next=structuredClone(state);fn(next,input);next.revision++;await commit(next);});return view();}
  return {
    async handle(req,res,url:URL) {
      const send=(status:number,body:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
      try {
        const path=url.pathname.slice('/api/disk'.length);
        if(path==='' && req.method==='GET')return send(200,view());
        if(path==='/files' && req.method==='POST') {
          if(req.headers['content-type']!=='application/octet-stream')throw fail('Передайте файл двоичным потоком.',415);
          const name=fileName(url.searchParams.get('name'));const folder=url.searchParams.get('folder') || null;
          if(folder!==null && !state.folders.some(f=>f.id===folder))throw fail('Папка не найдена.',404);
          if(Number(req.headers['content-length'])>FILE_LIMIT)throw fail('Файл больше 64 МБ.',413);
          await mkdir(blobs,{recursive:true});const id=randomUUID(), temp=join(blobs,id+'.upload'), target=join(blobs,id);let handle;let installed=false;
          try {
            handle=await open(temp,'wx',0o600);let size=0;const hash=createHash('sha256');
            for await(const part of req){const bytes=Buffer.isBuffer(part)?part:Buffer.from(part);size+=bytes.length;if(size>FILE_LIMIT)throw fail('Файл больше 64 МБ.',413);hash.update(bytes);await handle.writeFile(bytes);}
            await handle.sync();await handle.close();handle=null;
            await enqueue(async()=>{
              if(state.files.length>=10000)throw fail('Достигнут предел 10 000 документов.',409);
              if(folder!==null && !state.folders.some(f=>f.id===folder))throw fail('Папка была удалена во время загрузки.',409);
              const now=new Date().toISOString();const file:DiskFile={id,name,folder,size,sha256:hash.digest('hex'),createdAt:now,updatedAt:now,starred:false,trashedAt:null};
              await retryFile(()=>rename(temp,target));
              try{await commit({...state,revision:state.revision+1,files:[...state.files,file]});installed=true;}
              catch(e){await retryFile(()=>rm(target,{force:true}));throw e;}
            });
          } finally {if(handle)await handle.close();if(!installed)await retryFile(()=>rm(temp,{force:true}));}
          return send(201,view());
        }
        if(path==='/folders' && req.method==='POST')return send(201,await mutate(req,(next,input)=>{const name=fileName(input.name);if(next.folders.length>=500)throw fail('Достигнут предел 500 папок.');if(next.folders.some(f=>f.name.toLocaleLowerCase('ru')===name.toLocaleLowerCase('ru')))throw fail('Такая папка уже есть.');next.folders.push({id:randomUUID(),name});}));
        const folderMatch=path.match(/^\/folders\/([a-f0-9-]{36})$/);
        if(folderMatch && ['PATCH','DELETE'].includes(req.method))return send(200,await mutate(req,(next,input)=>{
          const folder=next.folders.find(f=>f.id===folderMatch[1]);if(!folder)throw fail('Папка не найдена.',404);
          if(req.method==='DELETE'){if(next.files.some(f=>f.folder===folder.id))throw fail('Сначала переместите документы из папки, включая корзину.',409);next.folders=next.folders.filter(f=>f!==folder);}
          else{const name=fileName(input.name);if(next.folders.some(f=>f.id!==folder.id&&f.name.toLowerCase()===name.toLowerCase()))throw fail('Такая папка уже есть.');folder.name=name;}
        }));
        const fileMatch=path.match(/^\/files\/([a-f0-9-]{36})(?:\/(content|preview|inline))?$/);
        if(!fileMatch)throw fail('Раздел диска не найден.',404);
        const id=fileMatch[1];
        if(!fileMatch[2] && req.method==='PATCH')return send(200,await mutate(req,(next,input)=>{
          const file=next.files.find(f=>f.id===id);if(!file)throw fail('Документ не найден.',404);
          if(input.name!==undefined)file.name=fileName(input.name);
          if(input.folder!==undefined){if(input.folder!==null&&!next.folders.some(f=>f.id===input.folder))throw fail('Папка не найдена.',404);file.folder=input.folder;}
          if(input.starred!==undefined){if(typeof input.starred!=='boolean')throw fail('Неверная отметка избранного.');file.starred=input.starred;}
          if(input.trashed!==undefined){if(typeof input.trashed!=='boolean')throw fail('Неверный статус корзины.');file.trashedAt=input.trashed?new Date().toISOString():null;}
          file.updatedAt=new Date().toISOString();
        }));
        const file=state.files.find(f=>f.id===id);if(!file)throw fail('Документ не найден.',404);
        // Stored originals have immutable identifiers; metadata changes never move their bytes.
        if(['content','preview','inline'].includes(fileMatch[2]) && ['GET','HEAD'].includes(req.method)) {
          if(file.trashedAt)throw fail('Восстановите документ из корзины.',409);
          const path=await blobPath(id);
          if(fileMatch[2]==='preview' || fileMatch[2]==='inline') {
            const handle=await open(path,'r');let preview;
            try {
              const head=Buffer.alloc(Math.min(file.size,100004));await handle.read(head,0,head.length,0);
              if(head.subarray(0,5).toString()==='%PDF-')preview={kind:'pdf'};
              else if(head.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))preview={kind:'image',mime:'image/png'};
              else if(head[0]===255&&head[1]===216&&head[2]===255)preview={kind:'image',mime:'image/jpeg'};
              else if(extname(file.name).toLowerCase()==='.docx')preview=await docxText(handle,file.size);
              else if(/\.(txt|md|csv|tsv|json|log|xml|html|css|js|ts|yaml|yml)$/i.test(file.name)) {
                let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(head.subarray(0,Math.min(file.size,100000)),{stream:file.size>100000});}catch{throw fail('Предпросмотр поддерживает текст в UTF-8. Оригинал можно скачать.');}
                preview={kind:'text',text,truncated:file.size>100000,format:extname(file.name).slice(1).toUpperCase()};
              }else preview={kind:'download'};
            } finally {await handle.close();}
            if(fileMatch[2]==='preview')return send(200,preview);
            if(!['pdf','image'].includes(preview.kind))throw fail('Для этого формата доступно только скачивание.',415);
            res.setHeader('Content-Type',preview.kind==='pdf'?'application/pdf':preview.mime);
            res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'self'");
            res.setHeader('Content-Disposition',"inline; filename*=UTF-8''"+encodeURIComponent(file.name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase()));
          }else{res.setHeader('Content-Type','application/octet-stream');res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(file.name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase()));}
          res.setHeader('Content-Length',String(file.size));res.writeHead(200);
          if(req.method==='HEAD')return void res.end();
          await pipeline(createReadStream(path),res);return;
        }
        // Permanent file deletion is deliberately absent: users can always restore the trash.
        throw fail('Метод не поддерживается.',405);
      } catch(e){if(!res.headersSent)send(e.status || (e.code==='ENOENT'?404:500),{error:e.status?e.message:e.code==='ENOENT'?'Оригинал документа не найден. Восстановите папку data/disk из копии.':'Не удалось выполнить операцию диска. Проверьте свободное место и права записи.'});else res.end();}
    },
    async shutdown(){await queue;}
  };
}
