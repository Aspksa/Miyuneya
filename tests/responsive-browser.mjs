import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const browsers = [process.env.CHROME_BIN, 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].filter(Boolean);
const chrome = browsers.find(exe => {
  try { return spawnSync(exe, ['--version'], {timeout:3000,stdio:'ignore'}).status===0; }
  catch { return false; }
});

async function debuggerPort(profile) {
  for (let n=0;n<100;n++) {
    try {
      const data=await readFile(join(profile,'DevToolsActivePort'),'utf8');
      const port=Number(data.split('\n')[0]);
      if (Number.isInteger(port)&&port>0) return port;
    } catch {}
    await pause(100);
  }
  throw new Error('Headless Chrome did not create its debugging endpoint.');
}
async function connect(url) {
  const socket=new WebSocket(url);
  await new Promise((resolve,reject)=>{
    socket.addEventListener('open',resolve,{once:true});
    socket.addEventListener('error',reject,{once:true});
  });
  let sequence=0;
  const pending=new Map();
  socket.addEventListener('message',event=>{
    const msg=JSON.parse(String(event.data));
    if (!msg.id) return;
    const entry=pending.get(msg.id);
    if(!entry)return;
    pending.delete(msg.id);
    msg.error?entry.reject(new Error(msg.error.message)):entry.resolve(msg.result);
  });
  return {
    send(method,params={}){
      return new Promise((resolve,reject)=>{
        const id=++sequence;
        pending.set(id,{resolve,reject});
        socket.send(JSON.stringify({id,method,params}));
      });
    },
    close(){socket.close();}
  };
}
const viewports = [
  [320,568],[360,640],[375,812],[540,320],[700,480],[701,500],
  [768,600],[1024,768],[1366,768],[1920,1080],[2560,1440],[3840,2160]
];

test('Real Chromium layout: 320px to 4K, short windows and appearance scale 90–120%',{timeout:120000},async t=>{
  assert.ok(chrome,'Chrome/Chromium not installed: responsive UI test must not silently skip.');
  const profile=await mkdtemp(join(tmpdir(),'miyuneya-viewport-'));
  const browser=spawn(chrome,[
    '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    '--no-proxy-server','--no-first-run','--no-default-browser-check',
    '--remote-allow-origins=*','--remote-debugging-port=0',
    '--user-data-dir='+profile,'about:blank'
  ],{stdio:'ignore'});
  let cd;
  t.after(async()=>{
    try{cd?.close();}catch{}
    try{browser.kill('SIGKILL');}catch{}
    await rm(profile,{recursive:true,force:true,maxRetries:4,retryDelay:150});
  });
  const port=await debuggerPort(profile);
  const targets=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  const page=targets.find(target=>target.type==='page');
  assert.ok(page?.webSocketDebuggerUrl,'Missing Chrome page target.');
  cd=await connect(page.webSocketDebuggerUrl);
  await cd.send('Page.enable');
  await cd.send('Runtime.enable');
  const source=await readFile(join(root,'web','blank.html'),'utf8');
  const stylesheet=await readFile(join(root,'web','blank.css'),'utf8');
  const script=await readFile(join(root,'web','blank.js'),'utf8');
  assert.ok(source.includes('<link rel="stylesheet" href="/blank.css">'));
  assert.ok(source.includes('<script type="module" src="/blank.js"></script>'));
  // The complete real DOM and real stylesheet are rendered without external network.
  const documentHTML=source.replace('<link rel="stylesheet" href="/blank.css">','<style>'+stylesheet+'</style>')
    .replace('<script type="module" src="/blank.js"></script>','');
  const frame=await cd.send('Page.getFrameTree');
  await cd.send('Page.setDocumentContent',{frameId:frame.frameTree.frame.id,html:documentHTML});
  async function evalJS(expression) {
    const response=await cd.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(response.exceptionDetails)throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result?.value;
  }
  assert.equal(await evalJS('document.readyState'),'complete');
  await evalJS(script);
  await evalJS('document.getElementById("settings-toggle").click()');
  assert.equal(await evalJS('document.getElementById("settings-panel").hidden'),false);

  let checks=0;
  for (const mode of ['regular','wide']) {
    for (const [field,value] of [['railWidth',mode],['iconSize',mode==='wide'?'large':'regular'],['fontSize',mode==='wide'?'large':'regular']]) {
      await evalJS(`(()=>{const c=document.querySelector('[data-setting="${field}"]');c.value="${value}";c.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
    }
  for (const scale of [90,100,120]) {
    await evalJS(`(()=>{const input=document.querySelector('[data-setting="scale"]');input.value="${scale}";input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
    for(const [width,height] of viewports) {
      await cd.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      const result=await evalJS(`(()=>{
        const panel=document.getElementById('settings-panel');
        const rail=document.querySelector('.right-rail');
        const close=document.getElementById('settings-close');
        const bounds=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
        return {viewport:[innerWidth,innerHeight],scrollWidth:document.documentElement.scrollWidth,
          panel:bounds(panel),rail:bounds(rail),close:bounds(close),hasScroll:panel.scrollHeight>panel.clientHeight};
      })()`);
      const label=`${width}×${height} at ${scale}% (${mode})`;
      assert.deepEqual(result.viewport,[width,height],label);
      assert.ok(result.scrollWidth<=width+1,'Horizontal page overflow: '+label+' '+JSON.stringify(result));
      assert.ok(result.panel.left>=-1 && result.panel.right<=width+1,'Settings clipped horizontally: '+label+' '+JSON.stringify(result));
      assert.ok(result.panel.top>=-1 && result.panel.bottom<=height+1,'Settings clipped vertically: '+label+' '+JSON.stringify(result));
      assert.ok(result.rail.left>=-1 && result.rail.right<=width+1,'Right menu clipped: '+label);
      assert.ok(result.close.left>=result.panel.left-1 && result.close.right<=result.panel.right+1,'Close button clipped: '+label);
      await evalJS('document.getElementById("settings-panel").scrollTop=document.getElementById("settings-panel").scrollHeight');
      const footer=await evalJS(`(()=>{const p=document.getElementById('settings-panel').getBoundingClientRect();const r=document.getElementById('appearance-reset').getBoundingClientRect();return {top:r.top,bottom:r.bottom,paneTop:p.top,paneBottom:p.bottom};})()`);
      assert.ok(footer.top>=footer.paneTop-1 && footer.bottom<=footer.paneBottom+1,
        'Reset button cannot be reached by scrolling: '+label+' '+JSON.stringify(footer));
      checks++;
    }
  }
  }
  await evalJS('document.getElementById("settings-close").click()');
  assert.equal(await evalJS('document.getElementById("settings-panel").hidden'),true);
  console.log('Chromium responsive geometry checks passed: '+checks+' viewports.');
});
