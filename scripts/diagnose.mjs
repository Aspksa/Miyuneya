import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureBuild } from './build.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
async function run(executable,args,env={}) {
  const child=spawn(executable,args,{cwd:root,env:{...process.env,...env},stdio:'inherit',windowsHide:true});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  if(code!==0)throw new Error('Диагностика завершилась с кодом '+code);
}
try {
  console.log('Node.js '+process.versions.node+' / '+process.platform+' / '+process.arch);
  await ensureBuild(root,true);console.log('Исходники и файлы сайта: целостность подтверждена. Внешние зависимости и Python не требуются.');
  if(process.platform==='win32') await run(join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'scripts','bootstrap.ps1'),'-ProbeOnly'],{MIYUNEYA_NODE:process.execPath,MIYUNEYA_OFFLINE:'1'});
  if(process.argv.includes('--full')) await run(process.execPath,[join(root,'scripts','test.mjs')]);
  console.log('Диагностика завершена. Системные настройки не изменены; загрузки не выполнялись.');
} catch(e){console.error(e.message);process.exitCode=1;}
