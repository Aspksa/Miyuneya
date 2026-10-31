import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
  for (let n=0;n<300;n++) {
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
  [768,600],[1024,768],[1366,768],[1920,1080],[2560,1440],[3840,2160],
  [3440,1440],[3840,1080],[5120,2880]
];

test('Real Chromium layout: 320px to 4K, short windows and appearance scale 90–120%',{timeout:120000},async t=>{
  assert.ok(chrome,'Chrome/Chromium not installed: responsive UI test must not silently skip.');
  const profile=await mkdtemp(join(tmpdir(),'miyuneya-viewport-'));
  const browser=spawn(chrome,[
    '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    '--no-proxy-server','--no-first-run','--no-default-browser-check',
    '--remote-allow-origins=*','--remote-debugging-port=0',
    '--user-data-dir='+profile,'about:blank'
  ],{stdio:['ignore','ignore','pipe']});
  let browserErrors='';
  browser.stderr?.on('data',chunk=>{browserErrors=(browserErrors+String(chunk)).slice(-2400);});
  let cd;
  t.after(async()=>{
    try{cd?.close();}catch{}
    try{browser.kill('SIGKILL');}catch{}
    await rm(profile,{recursive:true,force:true,maxRetries:4,retryDelay:150});
  });
  const port=await debuggerPort(profile).catch(e=>{throw new Error(e.message+'; Chromium stderr: '+browserErrors);});
  const targets=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  const page=targets.find(target=>target.type==='page');
  assert.ok(page?.webSocketDebuggerUrl,'Missing Chrome page target.');
  cd=await connect(page.webSocketDebuggerUrl);
  await cd.send('Page.enable');
  await cd.send('Runtime.enable');
  // Stable screenshots: CSS transitions must not create temporary low contrast.
  await cd.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const source=await readFile(join(root,'web','blank.html'),'utf8');
  const stylesheet=await readFile(join(root,'web','blank.css'),'utf8');
  const script=await readFile(join(root,'web','blank.js'),'utf8');
  const avatarStyles=await readFile(join(root,'web','avatar.css'),'utf8');
  const avatarScript=await readFile(join(root,'web','avatar.js'),'utf8');
  const studioScript=await readFile(join(root,'web','avatar-studio.js'),'utf8');
  const avatarBytes=await readFile(join(root,'web','avatars','avatar1.png'));
  assert.ok(source.includes('<link rel="stylesheet" href="/blank.css">'));
  assert.ok(source.includes('<script type="module" src="/blank.js"></script>'));
  // The complete real DOM and real stylesheet are rendered without external network.
  const documentHTML=source.replace('<link rel="stylesheet" href="/blank.css">','<style>'+stylesheet+'</style>')
    .replace('<script type="module" src="/blank.js"></script>','')
    .replace('<link rel="stylesheet" href="/avatar.css">','<style>'+avatarStyles+'</style>')
    .replace('<script defer src="/avatar.js"></script>','')
    .replace('<script defer src="/avatar-studio.js"></script>','')
    .replace('src="/avatars/avatar1.png"','src="data:image/png;base64,'+avatarBytes.toString('base64')+'"');
  const frame=await cd.send('Page.getFrameTree');
  await cd.send('Page.setDocumentContent',{frameId:frame.frameTree.frame.id,html:documentHTML});
  async function evalJS(expression) {
    const response=await cd.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(response.exceptionDetails)throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result?.value;
  }
  assert.equal(await evalJS('document.readyState'),'complete');
  await evalJS(script);
  await evalJS(avatarScript);
  await evalJS(studioScript);
  const brainInitially=await evalJS(`(()=>{
    const node=document.getElementById('brain-nav-link');
    const rail=document.querySelector('.right-rail').getBoundingClientRect();
    const icon=node.getBoundingClientRect();
    const gear=document.getElementById('settings-toggle').getBoundingClientRect();
    return {
      hidden:document.getElementById('brain-workspace').hidden,
      label:node.getAttribute('aria-label'),
      pathCount:node.querySelectorAll('path').length,
      neurons:node.querySelectorAll('.brain-neuron').length,
      top:icon.top,railTop:rail.top,gearTop:gear.top,
      motion:getComputedStyle(node.querySelector('.brain-neuron')).animationName
    };
  })()`);
  assert.equal(brainInitially.hidden,true,'Homepage must stay empty');
  assert.equal(brainInitially.label,'Мозги Hayumeri');
  assert.ok(brainInitially.pathCount>=9,'Brain must be a real vector, not an image');
  assert.equal(brainInitially.neurons,9,'Expected nine neuron nodes');
  assert.ok(brainInitially.top >= brainInitially.railTop && brainInitially.top < brainInitially.gearTop,
    'Brain icon must sit at the top, above the settings gear');
  assert.equal(brainInitially.motion,'none','System reduce-motion must disable pulsing');
  await evalJS('document.getElementById("brain-nav-link").click()');
  await evalJS('new Promise(resolve=>setTimeout(resolve,40))');
  assert.equal(await evalJS('document.getElementById("brain-workspace").hidden'),false);
  assert.equal(await evalJS('document.getElementById("brain-nav-link").getAttribute("aria-current")'),'page');
  assert.equal(await evalJS('document.title'),'Мозги Hayumeri');
  await evalJS('document.querySelector(".brain-back-link").click()');
  await evalJS('new Promise(resolve=>setTimeout(resolve,40))');
  assert.equal(await evalJS('document.getElementById("brain-workspace").hidden'),true);
  assert.equal(await evalJS('document.title'),'');
  await evalJS('document.querySelector("#kitsune-avatar img").decode()');
  const kitsuneInitial=await evalJS(`(()=>{
    const avatar=document.getElementById('kitsune-avatar');
    const image=avatar.querySelector('img');
    const chat=document.getElementById('kitsune-chat');
    return {imageNatural:image.naturalWidth,chatHidden:chat.hidden,settingsHidden:document.getElementById('kitsune-settings').hidden,
      bounds:avatar.getBoundingClientRect().toJSON()};
  })()`);
  assert.equal(kitsuneInitial.imageNatural,1254,'Full-resolution local PNG must decode correctly');
  assert.equal(kitsuneInitial.chatHidden,true);
  assert.equal(kitsuneInitial.settingsHidden,true);
  await evalJS('document.getElementById("kitsune-avatar").click()');
  assert.equal(await evalJS('document.getElementById("kitsune-chat").hidden'),false,'Left click opens real chat');
  await evalJS('document.getElementById("kitsune-minimize").click()');
  assert.equal(await evalJS('document.getElementById("kitsune-chat").classList.contains("mini")'),true);
  await evalJS('document.getElementById("kitsune-expand").click()');
  assert.equal(await evalJS('document.getElementById("kitsune-chat").classList.contains("mini")'),false);
  await evalJS('document.getElementById("kitsune-avatar").click()');
  assert.equal(await evalJS('document.getElementById("kitsune-chat").hidden'),true);
  await evalJS(`(()=>{
    const avatar=document.getElementById('kitsune-avatar');
    avatar.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}));
    return true;
  })()`);
  const modal=await evalJS(`(()=>{
    const el=document.getElementById('kitsune-settings'),r=el.getBoundingClientRect();
    return {hidden:el.hidden,centerX:r.left+r.width/2,centerY:r.top+r.height/2,width:innerWidth,height:innerHeight};
  })()`);
  assert.equal(modal.hidden,false,'Right click opens centered avatar and chat settings');
  assert.equal(await evalJS('document.querySelectorAll("[data-kitsune-tab]").length'),4);
  await evalJS('document.querySelector("[data-kitsune-tab=library]").click()');
  assert.equal(await evalJS('document.querySelector("[data-kitsune-panel=library]").hidden'),false);
  assert.equal(await evalJS('document.querySelector("[data-kitsune-panel=avatar]").hidden'),true);
  await evalJS('document.querySelector("[data-kitsune-tab=avatar]").click()');
  assert.equal(await evalJS('document.querySelector("[data-kitsune-panel=avatar]").hidden'),false);
  await evalJS(`(()=>{
    const scale=document.getElementById('kitsune-framing');
    scale.value='140';scale.dispatchEvent(new Event('input',{bubbles:true}));
    const vertical=document.getElementById('kitsune-vertical');
    vertical.value='65';vertical.dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  })()`);
  const crop=await evalJS(`(()=>{
    const frame=document.querySelector('.kitsune-image-viewport');
    const image=frame.querySelector('img');
    return {overflow:getComputedStyle(frame).overflow,
      width:frame.getBoundingClientRect().width,imageWidth:image.getBoundingClientRect().width,
      shift:getComputedStyle(image).translate};
  })()`);
  assert.equal(crop.overflow,'hidden','Framing must clip image to visible window');
  assert.ok(crop.imageWidth>crop.width,'Framing 140% must enlarge content inside clipped viewport');
  assert.notEqual(crop.shift,'none','Vertical framing needs a real transform');
  // At phone width and high DPR, the centered settings must remain inside
  // the viewport and its action controls must stay reachable.
  await cd.send('Emulation.setDeviceMetricsOverride',{width:320,height:480,deviceScaleFactor:2,mobile:false});
  const smallSettings=await evalJS(`(()=>{
    const dlg=document.getElementById('kitsune-settings'),r=dlg.getBoundingClientRect();
    const tabs=[...dlg.querySelectorAll('.kitsune-tab')].map(el=>{
      const b=el.getBoundingClientRect();
      return {left:b.left,right:b.right,top:b.top,bottom:b.bottom};
    });
    const footer=document.getElementById('kitsune-settings-reset');
    dlg.scrollTop=dlg.scrollHeight;
    const f=footer.getBoundingClientRect();
    return {viewport:[innerWidth,innerHeight],panel:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},
      tabs,footer:{top:f.top,bottom:f.bottom},pageScroll:document.documentElement.scrollWidth};
  })()`);
  assert.deepEqual(smallSettings.viewport,[320,480]);
  assert.ok(smallSettings.panel.left>=-1 && smallSettings.panel.right<=321 && smallSettings.panel.top>=-1 && smallSettings.panel.bottom<=481,
    'Avatar settings must fit 320px mobile DPR2: '+JSON.stringify(smallSettings));
  assert.ok(smallSettings.tabs.every(t=>t.left>=smallSettings.panel.left-1&&t.right<=smallSettings.panel.right+1),
    'All avatar tabs must stay inside mobile settings');
  assert.ok(smallSettings.footer.top>=smallSettings.panel.top-1 && smallSettings.footer.bottom<=smallSettings.panel.bottom+1,
    'Reset action must remain reachable on mobile');
  assert.ok(smallSettings.pageScroll<=321,'No horizontal overflow on mobile');
  const designArtifacts=join(root,'artifacts','ui-screenshots');
  await mkdir(designArtifacts,{recursive:true});
  const mobileCapture=await cd.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
  await writeFile(join(designArtifacts,'Avatar-settings-320-DPR2.png'),Buffer.from(mobileCapture.data,'base64'));
  await cd.send('Emulation.setDeviceMetricsOverride',{width:800,height:600,deviceScaleFactor:1,mobile:false});



  assert.ok(Math.abs(modal.centerX-modal.width/2)<2,'Settings horizontally centered');
  assert.ok(Math.abs(modal.centerY-modal.height/2)<2,'Settings vertically centered');
  await cd.send('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1.75,mobile:false});
  const hi=await evalJS(`(()=>{
    const r=document.getElementById('kitsune-settings').getBoundingClientRect();
    return {dpr:devicePixelRatio,top:r.top,bottom:r.bottom,left:r.left,right:r.right};
  })()`);
  assert.equal(hi.dpr,1.75,'Windows 175% DPI must be testable');
  assert.ok(hi.top>=0&&hi.bottom<=768&&hi.left>=0&&hi.right<=1366,'Settings must fit on 1366x768');
  const desktopCapture=await cd.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
  await writeFile(join(designArtifacts,'Avatar-settings-1366-DPR175.png'),Buffer.from(desktopCapture.data,'base64'));
  await cd.send('Emulation.setDeviceMetricsOverride',{width:800,height:600,deviceScaleFactor:1,mobile:false});

  await evalJS(`(()=>{
    const size=document.getElementById('kitsune-avatar-size');
    size.value='230';size.dispatchEvent(new Event('input',{bubbles:true}));
    const width=document.getElementById('kitsune-chat-width');
    width.value='500';width.dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  })()`);
  assert.equal(await evalJS('document.getElementById("kitsune-avatar").getBoundingClientRect().width'),230);
  assert.match(await evalJS('document.getElementById("kitsune-chat").style.width'),/500px/);
  // Browser window shrink must not silently overwrite a 500px saved chat size.
  await evalJS('document.getElementById("kitsune-avatar").click()');
  await cd.send('Emulation.setDeviceMetricsOverride',{width:320,height:540,deviceScaleFactor:2,mobile:false});
  await evalJS('new Promise(resolve=>setTimeout(resolve,120))');
  const narrowChat=await evalJS(`(()=>{
    const chat=document.getElementById('kitsune-chat');
    const b=chat.getBoundingClientRect();
    const savedWidth=Number(document.getElementById('kitsune-chat-width').value);
    const avatar=document.getElementById('kitsune-avatar').getBoundingClientRect();
    return {savedWidth,visibleWidth:b.width,avatarBottom:avatar.bottom,
      viewportHeight:innerHeight,scroll:document.documentElement.scrollWidth};
  })()`);
  assert.equal(narrowChat.savedWidth,500,'Viewport shrink must not be persisted as a manual resize');
  assert.ok(narrowChat.visibleWidth<=321 && narrowChat.visibleWidth>=318,'Mobile chat must use available width without overflow');
  assert.ok(narrowChat.avatarBottom<=narrowChat.viewportHeight+1,'Avatar must stay on screen');
  assert.ok(await evalJS('document.getElementById("kitsune-avatar").getBoundingClientRect().width<=72'),'Mobile avatar must shrink and not cover notes');
  assert.ok(narrowChat.scroll<=321,'Chat must not cause page overflow');
  const chatCapture=await cd.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
  await writeFile(join(designArtifacts,'Avatar-chat-320-DPR2.png'),Buffer.from(chatCapture.data,'base64'));
  await cd.send('Emulation.setDeviceMetricsOverride',{width:800,height:600,deviceScaleFactor:1,mobile:false});
  await evalJS('document.getElementById("kitsune-chat-close").click()');

  await evalJS('document.getElementById("kitsune-settings-close").click()');
  assert.equal(await evalJS('document.getElementById("kitsune-settings").hidden'),true);
  // Disable snapping for the free-drag regression, then test edge snapping separately.
  await evalJS(`(()=>{
    const snap=document.getElementById('kitsune-snap');
    snap.checked=false;snap.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  // Mouse dragging must move the avatar and NOT activate chat.
  const beforeDrag=await evalJS(`(()=>{
    const r=document.getElementById('kitsune-avatar').getBoundingClientRect();
    return {left:r.left,top:r.top,x:r.left+r.width/2,y:r.top+r.height/2};
  })()`);
  await cd.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:beforeDrag.x,y:beforeDrag.y});
  await cd.send('Input.dispatchMouseEvent',{type:'mousePressed',x:beforeDrag.x,y:beforeDrag.y,button:'left',clickCount:1});
  await cd.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:beforeDrag.x+30,y:beforeDrag.y-30,button:'left',buttons:1});
  await cd.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:beforeDrag.x+30,y:beforeDrag.y-30,button:'left',clickCount:1});
  const afterDrag=await evalJS(`(()=>{
    const r=document.getElementById('kitsune-avatar').getBoundingClientRect();
    return {left:r.left,top:r.top,chatHidden:document.getElementById('kitsune-chat').hidden};
  })()`);
  assert.ok(afterDrag.left>=beforeDrag.left+20,'Dragging moves avatar horizontally');
  assert.ok(afterDrag.top<=beforeDrag.top-20,'Dragging moves avatar vertically');
  assert.equal(afterDrag.chatHidden,true,'Dragging must not open chat');
  await evalJS('document.getElementById("kitsune-avatar").click()');
  assert.equal(await evalJS('document.getElementById("kitsune-chat").hidden'),false);
  const headerBefore=await evalJS(`(()=>{
    const p=document.getElementById('kitsune-chat').getBoundingClientRect();
    const h=document.getElementById('kitsune-chat-header').getBoundingClientRect();
    return {left:p.left,top:p.top,x:h.left+45,y:h.top+16};
  })()`);
  await cd.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:headerBefore.x,y:headerBefore.y});
  await cd.send('Input.dispatchMouseEvent',{type:'mousePressed',x:headerBefore.x,y:headerBefore.y,button:'left',clickCount:1});
  await cd.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:headerBefore.x+26,y:headerBefore.y+16,button:'left',buttons:1});
  await cd.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:headerBefore.x+26,y:headerBefore.y+16,button:'left',clickCount:1});
  const chatAfter=await evalJS(`(()=>{
    const r=document.getElementById('kitsune-chat').getBoundingClientRect();
    return {left:r.left,top:r.top};
  })()`);
  assert.ok(chatAfter.left>=headerBefore.left+15,'Chat moves by dragging the header');
  await evalJS(`(()=>{
    const control=document.getElementById('kitsune-chat-mode-quick');
    control.value='dock';control.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  assert.equal(await evalJS("document.getElementById('kitsune-chat').classList.contains('mode-dock')"),true);
  await evalJS(`(()=>{
    const control=document.getElementById('kitsune-chat-mode-quick');
    control.value='full';control.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  assert.equal(await evalJS("document.getElementById('kitsune-chat').classList.contains('mode-full')"),true);
  await evalJS(`(()=>{
    const control=document.getElementById('kitsune-chat-mode-quick');
    control.value='floating';control.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  assert.equal(await evalJS("document.getElementById('kitsune-chat').classList.contains('mode-floating')"),true);
  await evalJS('document.getElementById("kitsune-chat-close").click()');
  await evalJS('document.getElementById("kitsune-settings-reset").click()');
  const studioReset=await evalJS(`(()=>({
    framing:document.getElementById('kitsune-framing').value,
    vertical:document.getElementById('kitsune-vertical').value,
    gold:document.getElementById('kitsune-gold-glow').checked
  }))()`);
  assert.equal(studioReset.framing,'100','Reset must restore studio framing');
  assert.equal(studioReset.vertical,'50','Reset must restore vertical framing');
  assert.equal(studioReset.gold,true,'Reset must restore golden effect');

  assert.equal(await evalJS('document.getElementById("cloud-key").type'),'password');
  assert.equal(await evalJS('document.getElementById("cloud-key").value'),'');
  assert.equal(await evalJS('document.getElementById("cloud-panel") !== null'),true);
  assert.equal(await evalJS('document.getElementById("cloud-model").value'),'openai/gpt-oss-120b');
  const icons=await evalJS(`(()=>({
    total:document.querySelectorAll('svg.setting-icon use').length,
    noIcon:[...document.querySelectorAll('.setting-group legend,.setting-row-name,.setting-check-name,.cloud-label-name,.cloud-actions button,.cloud-forget,.reset-button')].filter(el=>!el.querySelector('svg use')).map(el=>el.textContent.trim())
  }))()`);
  assert.ok(icons.total>=24,'Expected vector icons for each setting');
  assert.deepEqual(icons.noIcon,[],'All settings and action buttons must have a vector icon');

  // Browser-level integration: simulate the already-covered local API, prove
  // that saving a key does NOT claim connection before verification.
  await evalJS('new Promise(resolve => setTimeout(resolve, 30))');
  await evalJS(`(() => {
    window.__cloudStub = { key: '', model: 'openai/gpt-oss-120b' };
    window.fetch = async (path,opts={}) => {
      const state = window.__cloudStub;
      if (path === '/api/assistant') {
        if (opts.method === 'PUT') {
          const value=JSON.parse(opts.body);
          if (value.apiKey === null) state.key='';
          else if (value.apiKey) state.key=value.apiKey;
          if (value.model) state.model=value.model;
        }
        return {ok:true,json:async()=>({configured:!!state.key,keyHint:state.key?'••••'+state.key.slice(-4):'',model:state.model})};
      }
      if (path === '/api/assistant/verify') {
        return {ok:true,json:async()=>({
          status:state.key==='good-key-123' && state.model==='zeta/model'?'connected':'model-unavailable',
          message:state.key==='good-key-123' && state.model==='zeta/model'?'Модель доступна':'Модель отсутствует'
        })};
      }
      if(path==='/api/assistant/test')return {ok:true,json:async()=>({status:'working',message:'Генерация подтверждена'})};
      if(path==='/api/assistant/models')return {ok:true,json:async()=>({models:['zeta/model','other/model']})};
      return {ok:true,json:async()=>({appearance:null})};
    };
    return true;
  })()`);
  await evalJS(`(() => {
    document.getElementById('cloud-key').value='good-key-123';
    document.getElementById('cloud-model').value='zeta/model';
    document.getElementById('cloud-form').dispatchEvent(new Event('submit',{cancelable:true}));
    return true;
  })()`);
  await evalJS('new Promise(resolve => setTimeout(resolve, 50))');
  assert.equal(await evalJS('document.getElementById("cloud-status").dataset.state'),'unchecked');
  assert.equal(await evalJS('document.getElementById("cloud-key").value'),'');
  await evalJS('document.getElementById("cloud-verify").click()');
  await evalJS('new Promise(resolve => setTimeout(resolve, 40))');
  assert.equal(await evalJS('document.getElementById("cloud-status").dataset.state'),'connected');
  await evalJS('document.getElementById("cloud-test").click()');
  await evalJS('new Promise(resolve => setTimeout(resolve, 40))');
  assert.equal(await evalJS('document.getElementById("cloud-status").dataset.state'),'working');

  await evalJS('document.getElementById("cloud-refresh").click()');
  await evalJS('new Promise(resolve => setTimeout(resolve, 40))');
  assert.equal(await evalJS('document.getElementById("cloud-model-list").options.length'),2);
  await evalJS('document.getElementById("cloud-remove").click()');
  await evalJS('new Promise(resolve => setTimeout(resolve, 40))');
  assert.equal(await evalJS('document.getElementById("cloud-status").dataset.state'),'not-configured');
  assert.equal(await evalJS('document.getElementById("cloud-key").value'),'');
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
  // Capture real raster output as reviewable CI artifacts at monitor sizes
  // and Windows-style DPR scaling. No screenshots are treated as design
  // baselines until approved; tests assert geometry, text contrast and SVGs.
  const folder=join(root,'artifacts','ui-screenshots');
  await mkdir(folder,{recursive:true});
  const samples=[
    ['FullHD',1920,1080,1],
    ['FullHD-125',1920,1080,1.25],
    ['FullHD-150',1920,1080,1.5],
    ['FullHD-200',1920,1080,2],
    ['QHD',2560,1440,1],
    ['4K',3840,2160,1],
    ['5K',5120,2880,1]
  ];
  let screenshots=0;
  for (const [name,width,height,dpr] of samples) {
    await cd.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:dpr,mobile:false});
    const themedHashes=[];
    for (const theme of ['light','dark']) {
      await evalJS(`(()=>{const c=document.querySelector('[data-setting="theme"][value="${theme}"]');c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
      await evalJS('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      const metrics=await evalJS(`(()=>{
        const panel=document.getElementById('settings-panel');
        const rail=document.querySelector('.right-rail');
        const r=panel.getBoundingClientRect();
        const cs=getComputedStyle(panel), title=getComputedStyle(document.getElementById('settings-heading'));
        const sr=getComputedStyle(rail);
        const rgb=v=>(v.match(/[\\d.]+/g)||[]).slice(0,3).map(Number);
        const brightness=v=>{const x=rgb(v).map(c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});return .2126*x[0]+.7152*x[1]+.0722*x[2];};
        const [light,dark]=[brightness(title.color),brightness(cs.backgroundColor)].sort((a,b)=>b-a);
        return {dpr:devicePixelRatio,width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,
          x:r.left,right:r.right,bottom:r.bottom,contrast:(light+.05)/(dark+.05),
          svg:document.querySelectorAll('svg').length,bitmaps:document.querySelectorAll('img,canvas').length,
          railWidth:rail.getBoundingClientRect().width};
      })()`);
      assert.equal(metrics.dpr,dpr,`Incorrect emulated DPR: ${name}`);
      assert.equal(metrics.width,width);
      assert.equal(metrics.height,height);
      assert.ok(metrics.scroll<=width+1,`Horizontal overflow: ${name}/${theme}`);
      assert.ok(metrics.x>=-1 && metrics.right<=width+1 && metrics.bottom<=height+1,
        `Clipped settings: ${name}/${theme}`);
      assert.ok(metrics.contrast>=4.5,`Low text contrast: ${name}/${theme} ${metrics.contrast}`);
      assert.ok(metrics.svg>=3 && metrics.bitmaps===2,`Two deliberate image assets (avatar + live preview): ${name}`);
      assert.ok(metrics.railWidth>=50 && metrics.railWidth<=117);
      const capture=await cd.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
      const bytes=Buffer.from(capture.data,'base64');
      assert.ok(bytes.length>1000,`Empty screenshot: ${name}/${theme}`);
      await writeFile(join(folder,`${name}-${theme}.png`),bytes);
      themedHashes.push(createHash('sha256').update(bytes).digest('hex'));
      screenshots++;
    }
    assert.notEqual(themedHashes[0],themedHashes[1],`Themes render identically: ${name}`);
  }
  await cd.send('Emulation.clearDeviceMetricsOverride');
  console.log('HiDPI screenshots saved: '+screenshots+' (FullHD/125–200%, QHD, 4K, 5K).');
  await evalJS('document.getElementById("settings-close").click()');
  assert.equal(await evalJS('document.getElementById("settings-panel").hidden'),true);

  // Rebuild the real DOM to test a delayed settings response. Previously the
  // initial GET could erase a key the user had typed before it completed.
  await cd.send('Page.setDocumentContent',{frameId:frame.frameTree.frame.id,html:documentHTML});
  await evalJS(`(() => {
    window.__resolveCloudLoad = null;
    window.fetch = (path,options={}) => {
      if (path==='/api/assistant' && !options.method)
        return new Promise(resolve => { window.__resolveCloudLoad=resolve; });
      if (path==='/api/site/appearance')
        return Promise.resolve({ok:true,json:async()=>({appearance:null})});
      if (path==='/api/assistant' && options.method==='PUT') {
        const body=JSON.parse(options.body);
        return Promise.resolve({ok:true,json:async()=>({configured:!!body.apiKey,keyHint:'••••'+body.apiKey.slice(-4),model:body.model})});
      }
      return Promise.resolve({ok:false,json:async()=>({error:'not mocked'})});
    };
    return true;
  })()`);
  await evalJS(script);
  await evalJS(`(() => {
    const key=document.getElementById('cloud-key');
    key.value='typed-while-loading-key';
    key.dispatchEvent(new Event('input',{bubbles:true}));
    const model=document.getElementById('cloud-model');
    model.value='new/model';
    model.dispatchEvent(new Event('input',{bubbles:true}));
    window.__resolveCloudLoad({ok:true,json:async()=>({
      configured:false,keyHint:'',model:'openai/gpt-oss-120b'
    })});
    return true;
  })()`);
  await evalJS('new Promise(resolve=>setTimeout(resolve,30))');
  assert.equal(await evalJS('document.getElementById("cloud-key").value'),'typed-while-loading-key');
  assert.equal(await evalJS('document.getElementById("cloud-model").value'),'new/model');
  assert.equal(await evalJS('document.getElementById("cloud-status").dataset.state'),'unchecked');
  await evalJS('document.getElementById("cloud-form").dispatchEvent(new Event("submit",{cancelable:true}))');
  await evalJS('new Promise(resolve=>setTimeout(resolve,30))');
  assert.equal(await evalJS('document.getElementById("cloud-key").value'),'');
  assert.equal(await evalJS('document.getElementById("cloud-model").value'),'new/model');
  assert.ok((await evalJS('document.getElementById("cloud-key-hint").textContent')).includes('••••-key'));

  console.log('Chromium responsive geometry checks passed: '+checks+' viewports; late Cloud.ru GET preserves draft.');
});
