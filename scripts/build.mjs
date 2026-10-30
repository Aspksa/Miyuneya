import { stripTypeScriptTypes } from 'node:module';
import { readFile, mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { atomicWrite, readJSON } from './runtime.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const assets=['blank.html','blank.css','blank.js','index.html','style.css','fox.svg','favicon.svg',...[1,2,3,4].map(n=>`avatars/avatar${n}.png`)];
export async function ensureBuild(root, check = false) {
  const pkg = await readJSON(join(root,'package.json'));
  if (Object.keys(pkg.dependencies || {}).length || Object.keys(pkg.devDependencies || {}).length || pkg.workspaces) throw new Error('Изменился набор зависимостей. Эта версия запуска поддерживает проект без внешних пакетов; установка не выполнена.');
  // The intentionally empty homepage is served directly from web/ without extra build tooling.
  // It still must exist before the launcher reports the build as ready.
  let homepage;
  try { homepage=await readFile(join(root,'web','blank.html'),'utf8'); }
  catch(e) {
    if(e.code==='ENOENT') throw new Error('Не найден web/blank.html. Восстановите пустую главную страницу из репозитория.');
    throw e;
  }
  if(!homepage.trim()) throw new Error('web/blank.html пуст как файл. Восстановите HTML-основу пустой страницы.');
  const modules=(await readdir(join(root,'src'))).filter(name=>/^[a-zA-Z0-9_-]+\.ts$/.test(name)).map(name=>name.slice(0,-3)).sort();
  if(!modules.includes('main')||modules.length>100)throw new Error('Не найден основной модуль или превышен предел модулей сборки.');
  const inputs={}; const outputs={};
  for (const name of modules) inputs[`src/${name}.ts`]=await readFile(join(root,'src',name+'.ts'));
  for (const name of assets) inputs[`web/${name}`]=await readFile(join(root,'web',name));
  const fingerprint=hash(JSON.stringify(Object.entries(inputs).map(([name,bytes])=>[name,hash(bytes)])));
  let cached;
  try { cached=await readJSON(join(root,'dist','.build.json')); } catch(e) {if(e.code!=='ENOENT' && !(e instanceof SyntaxError)) throw e;}
  if(cached?.fingerprint===fingerprint && cached.schema===1) {
    let intact=true;
    for(const name of [...assets,...modules.map(name=>name+'.js')]) {
      try {if(hash(await readFile(join(root,'dist',name)))!==cached.outputs?.[name]) intact=false;} catch(e) {if(e.code==='ENOENT') intact=false;else throw e;}
    }
    if(intact) return false;
  }
  if(check) throw new Error('Сборка отсутствует, повреждена или устарела: выполните npm run build.');
  for(const name of modules) {
    let code='// Generated from src/'+name+'.ts by npm run build.\n'+stripTypeScriptTypes(inputs[`src/${name}.ts`].toString('utf8'),{mode:'strip'});
    code=code.replace(/[ \t]+$/gm,'');
    code=code.replace(/(from\s+['"]\.{1,2}\/[^'"]+)\.ts(['"])/g,'$1.js$2');
    const syntax=spawnSync(process.execPath,['--check','--input-type=module'],{input:code,encoding:'utf8',timeout:10000,windowsHide:true});
    if(syntax.status!==0) throw new Error('Ошибка синтаксиса в src/'+name+'.ts; исходники сохранены.');
    outputs[name+'.js']=Buffer.from(code);
  }
  for(const name of assets) {if(inputs[`web/${name}`].length===0) throw new Error('Пустой обязательный файл web/'+name);outputs[name]=inputs[`web/${name}`];}
  await mkdir(join(root,'dist','avatars'),{recursive:true});
  for(const [name,bytes] of Object.entries(outputs)) await atomicWrite(join(root,'dist',name),bytes);
  await atomicWrite(join(root,'dist','.build.json'),JSON.stringify({schema:1,fingerprint,outputs:Object.fromEntries(Object.entries(outputs).map(([name,bytes])=>[name,hash(bytes)]))},null,2));
  return true;
}
if(process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1])) {
  await ensureBuild(fileURLToPath(new URL('..',import.meta.url)),process.argv.includes('--check'));
  console.log(process.argv.includes('--check')?'Целостность сборки проверена.':'Сборка готова.');
}
