import { readFile, mkdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { atomicWrite, readJSON, removeTree } from '../scripts/runtime.mjs';
import { prepareUpdate, allowed } from '../scripts/update.mjs';

const RELEASES='https://api.github.com/repos/Aspksa/Miyuneya/releases/latest';
const BASE='https://github.com/Aspksa/Miyuneya/releases/download/';
const ASSET='miyuneya-update.json';
const LIMIT=15_000_000;
const version=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const sha256=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const newer=(a:string,b:string)=>a.split('.').map(Number).some((n,i)=>n>b.split('.').map(Number)[i]&&a.split('.').slice(0,i).every((v,j)=>Number(v)===Number(b.split('.')[j])));
function ensureVersion(v:unknown):asserts v is string{
  if(typeof v!=='string'||!version.test(v)||v.split('.').some(x=>!Number.isSafeInteger(Number(x))))throw new Error('Недопустимая версия обновления.');
}
const normalizeError=(e:unknown)=>{
  const name=(e as {name?:string})?.name;
  return name==='TimeoutError'?'Истекло время ответа GitHub.':
    name==='AbortError'?'Проверка прервана.':
    'Не удалось связаться с GitHub или проверить пакет.';
};
async function limitedFetch(fetcher:typeof fetch,url:string,max=LIMIT){
  const response=await fetcher(url,{headers:{'Accept':'application/vnd.github+json','User-Agent':'Miyuneya-Update/1'},signal:AbortSignal.timeout(10000)});
  if(!response.ok)return {response,bytes:null};
  const claimed=Number(response.headers.get('content-length')||0);
  if(claimed>max)throw new Error('Пакет обновления превышает безопасный размер.');
  const reader=response.body?.getReader();
  if(!reader)throw new Error('GitHub вернул пустой пакет.');
  const chunks:Uint8Array[]=[];let total=0;
  try{
    while(true){
      const part=await reader.read();
      if(part.done)break;
      total+=part.value.byteLength;
      if(total>max)throw new Error('Пакет обновления превышает безопасный размер.');
      chunks.push(part.value);
    }
  }finally{reader.releaseLock();}
  return {response,bytes:Buffer.concat(chunks.map(x=>Buffer.from(x)),total)};
}
export async function openGithubUpdater(root:string,fetcher:typeof fetch=fetch){
  const area=join(root,'.runtime','updates');
  await mkdir(area,{recursive:true});
  const currentFile=join(area,'current.json');
  const stateFile=join(area,'settings.json');
  const pkg=await readJSON(join(root,'package.json'));
  ensureVersion(pkg.version);
  const saved=await readJSON(stateFile).catch(e=>{if(e.code==='ENOENT'||e instanceof SyntaxError)return {};throw e;});
  let autoCheck=saved?.autoCheck===true,autoDownload=saved?.autoDownload===true;
  let lastCheck=0,latest:null|{version:string;notes:string;url:string;published:string;digest:string|null}=null;
  let lastError='',busy=false;
  async function current(){
    try{
      const file=await readJSON(currentFile);
      ensureVersion(file.version);
      return newer(file.version,pkg.version)?file.version:pkg.version;
    }catch(e){if((e as {code?:string}).code==='ENOENT')return pkg.version;return pkg.version;}
  }
  async function pending(){
    try{const manifest=await readJSON(join(area,'pending','update.json'));ensureVersion(manifest.version);return manifest.version;}
    catch(e){if((e as {code?:string}).code==='ENOENT')return null;return 'повреждён';}
  }
  async function view(){
    return {current:await current(),available:latest?.version||null,
      notes:latest?.notes||'',releaseUrl:latest?.url||'',published:latest?.published||null,
      checkedAt:lastCheck?new Date(lastCheck).toISOString():null,lastError,
      pending:await pending(),autoCheck,autoDownload,busy,
      noRelease:lastCheck>0&&!latest&&!lastError};
  }
  async function check(){
    if(busy)throw Object.assign(new Error('Проверка обновления уже выполняется.'),{status:409});
    busy=true;lastError='';
    try{
      if(process.env.MIYUNEYA_OFFLINE==='1')throw new Error('В автономном режиме проверка GitHub отключена.');
      const {response,bytes}=await limitedFetch(fetcher,RELEASES,100_000);
      if(response.status===404){latest=null;lastCheck=Date.now();return await view();}
      if(!response.ok)throw new Error('GitHub не выдал данные релиза (HTTP '+response.status+').');
      const data=JSON.parse(bytes!.toString('utf8'));
      const tag=data.tag_name;
      if(data.draft||data.prerelease||typeof tag!=='string'||!/^v\d+\.\d+\.\d+$/.test(tag))
        throw new Error('Последний релиз не является стабильным выпуском.');
      const releaseVersion=tag.slice(1);ensureVersion(releaseVersion);
      const matching=(data.assets||[]).find((x:any)=>x?.name===ASSET);
      if(!matching)throw new Error('Релиз не содержит проверенный пакет обновления.');
      if(matching.size>LIMIT)throw new Error('Релиз слишком большой.');
      // Never accept an arbitrary URL from remote metadata.
      const url=BASE+tag+'/'+ASSET;
      const assetDigest=typeof matching.digest==='string'&&/^sha256:[a-f0-9]{64}$/.test(matching.digest)?matching.digest.slice(7):null;
      latest={version:releaseVersion,notes:typeof data.body==='string'?data.body.slice(0,2400):'',
        url,published:typeof data.published_at==='string'?data.published_at:'',digest:assetDigest};
      lastCheck=Date.now();return await view();
    }catch(e){lastError=(e as Error).message||normalizeError(e);throw e;}
    finally{busy=false;}
  }
  async function configure(value:{autoCheck?:unknown;autoDownload?:unknown}){
    if(typeof value?.autoCheck!=='boolean'||typeof value?.autoDownload!=='boolean')
      throw Object.assign(new Error('Укажите правильные настройки обновления.'),{status:400});
    autoCheck=value.autoCheck;autoDownload=value.autoDownload;
    await atomicWrite(stateFile,JSON.stringify({autoCheck,autoDownload}));
    return view();
  }
  async function stage(){
    if(busy)throw Object.assign(new Error('Операция обновления уже выполняется.'),{status:409});
    busy=true;
    const incoming=join(area,'incoming-'+randomUUID());
    try{
      if(process.env.MIYUNEYA_OFFLINE==='1')throw new Error('В автономном режиме загрузка отключена.');
      if(await pending())throw Object.assign(new Error('Обновление уже подготовлено. Перезапустите Miyuneya.'),{status:409});
      if(!latest)throw Object.assign(new Error('Сначала проверьте наличие релиза.'),{status:409});
      const installed=await current();
      if(!newer(latest.version,installed))throw Object.assign(new Error('Новая версия не требуется.'),{status:409});
      const {response,bytes}=await limitedFetch(fetcher,latest.url);
      if(!response.ok)throw new Error('GitHub не выдал пакет обновления (HTTP '+response.status+').');
      if(latest.digest&&sha256(bytes!)!==latest.digest)throw new Error('SHA-256 релиза GitHub не совпадает.');
      const bundle=JSON.parse(bytes!.toString('utf8'));
      if(bundle.schema!==1||bundle.version!==latest.version||!Array.isArray(bundle.files)||
        !bundle.files.length||bundle.files.length>100)throw new Error('Состав пакета обновления не прошёл проверку.');
      await mkdir(incoming);
      const entries: {path:string;sha256:string}[]=[];const seen=new Set<string>();let total=0;
      for(const file of bundle.files){
        if(!file||typeof file.path!=='string'||!allowed.test(file.path)||
          seen.has(file.path)||typeof file.sha256!=='string'||!/^[a-f0-9]{64}$/.test(file.sha256)||
          typeof file.data!=='string'||file.data.length>LIMIT||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data))
          throw new Error('Недопустимый файл пакета обновления.');
        seen.add(file.path);
        const content=Buffer.from(file.data,'base64');
        total+=content.length;
        if(total>10_000_000||sha256(content)!==file.sha256)throw new Error('SHA-256 файла обновления не совпадает.');
        await atomicWrite(join(incoming,file.path),content);
        entries.push({path:file.path,sha256:file.sha256});
      }
      await atomicWrite(join(incoming,'update.json'),JSON.stringify({schema:1,version:bundle.version,files:entries}));
      await prepareUpdate(root,incoming);
      return await view();
    }finally{busy=false;await removeTree(incoming);}
  }
  // Only a visible manual user action can install an already staged update.
  async function checkScheduled(){
    if(!autoCheck||busy||process.env.MIYUNEYA_OFFLINE==='1'||Date.now()-lastCheck<24*3600_000)return;
    try{await check();if(autoDownload&&latest && newer(latest.version,await current())&&!await pending())await stage();}
    catch{/* expose errors only in the update UI */}
  }
  return {view,check,stage,configure,checkScheduled};
}
