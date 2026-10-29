import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
const files=(await readdir(join(root,'tests'))).filter(name=>name.endsWith('.test.mjs')).map(name=>join(root,'tests',name));
for(const tz of ['UTC','Asia/Vladivostok']) {
  console.log('\nTimezone: '+tz);
  const child=spawn(process.execPath,['--test',...files],{cwd:root,env:{...process.env,TZ:tz},stdio:'inherit',windowsHide:true});
  const result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve(code));});
  if(result!==0){process.exitCode=result || 1;break;}
}
