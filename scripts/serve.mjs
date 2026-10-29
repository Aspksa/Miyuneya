import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.ts';
const root=fileURLToPath(new URL('..',import.meta.url));
let app;
let shutting;
let initializing=Promise.resolve();
let initialized=false;
async function stop() {
  if(shutting) return shutting;
  shutting=(async()=>{
    await initializing.catch(()=>{});
    await app?.shutdown();
    if(process.connected) process.disconnect();
  })();
  return shutting;
}
process.on('SIGINT',()=>stop().catch(()=>{process.exitCode=44;}));
process.on('SIGTERM',()=>stop().catch(()=>{process.exitCode=44;}));
process.on('disconnect',()=>stop().catch(()=>{process.exitCode=44;}));
process.on('message',message=>{
  if(message?.type==='shutdown') return void stop().catch(()=>{process.exitCode=44;});
  if(message?.type!=='init' || initialized) return;
  initialized=true;
  initializing=(async()=>{
    app=await createApp(root,message.instance,message.preview,{launchId:message.launchId,onShutdown:()=>{if(process.connected) process.send({type:'stop-requested'});}});
    await new Promise((resolve,reject)=>{app.once('error',reject);app.listen(message.port,message.host,resolve);});
    if(process.connected) process.send({type:'ready',port:app.address().port});
  })();
  initializing.catch(async e=>{
    if(process.connected) process.send({type:'failed',code:e.code || 'SERVER_START_FAILED'});
    process.exitCode=40;
    await stop();
  });
});
