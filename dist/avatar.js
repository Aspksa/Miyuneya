/* Movable Hayumeri kitsune — no third-party libraries or remote scripts. */
(() => {
  'use strict';
  const avatar = document.getElementById('kitsune-avatar');
  const chat = document.getElementById('kitsune-chat');
  const settings = document.getElementById('kitsune-settings');
  if (!avatar || !chat || !settings) return;
  const form = document.getElementById('kitsune-chat-form');
  const input = document.getElementById('kitsune-message');
  const log = document.getElementById('kitsune-log');
  const chatHeader = document.getElementById('kitsune-chat-header');
  const sendButton = document.getElementById('kitsune-send');
  const stopButton = document.getElementById('kitsune-stop');
  const settingsBackdrop = document.getElementById('kitsune-settings-backdrop');
  const settingsClose = document.getElementById('kitsune-settings-close');
  const reset = document.getElementById('kitsune-settings-reset');
  const clearChat = document.getElementById('kitsune-clear');
  const openSettings = document.getElementById('kitsune-chat-settings');
  const status = document.getElementById('kitsune-chat-status');
  const sizeInput = document.getElementById('kitsune-avatar-size');
  const opacityInput = document.getElementById('kitsune-avatar-opacity');
  const glowInput = document.getElementById('kitsune-glow');
  const animationInput = document.getElementById('kitsune-animations');
  const fontInput = document.getElementById('kitsune-chat-font');
  const avatarSizeValue = document.getElementById('kitsune-size-output');
  const opacityValue = document.getElementById('kitsune-opacity-output');

  const defaults = { size: 180, opacity: 100, glow: true, animations: true, font: 15 };
  const settingsKey = 'miyuneya.kitsune.settings.v1';
  const avatarKey = 'miyuneya.kitsune.position.v1';
  const chatKey = 'miyuneya.kitsune.chat-position.v1';
  const historyKey = 'miyuneya.kitsune.history.v1';
  const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
  const read=(key,fallback)=>{
    try {const v=localStorage.getItem(key);return v===null?fallback:JSON.parse(v);} catch {return fallback;}
  };
  const write=(key,value)=>{
    try {localStorage.setItem(key,JSON.stringify(value));return true;}
    catch {return false;}
  };
  const validPosition=value=>value && Number.isFinite(value.x) && Number.isFinite(value.y);
  const storedSettings=read(settingsKey,null);
  let config={...defaults};
  if(storedSettings && typeof storedSettings==='object'){
    if(Number.isInteger(storedSettings.size) && storedSettings.size>=100 && storedSettings.size<=300) config.size=storedSettings.size;
    if(Number.isInteger(storedSettings.opacity) && storedSettings.opacity>=50 && storedSettings.opacity<=100)config.opacity=storedSettings.opacity;
    if(typeof storedSettings.glow==='boolean')config.glow=storedSettings.glow;
    if(typeof storedSettings.animations==='boolean')config.animations=storedSettings.animations;
    if(Number.isInteger(storedSettings.font)&&storedSettings.font>=13&&storedSettings.font<=20)config.font=storedSettings.font;
  }

  const savedAvatar=read(avatarKey,null),savedChat=read(chatKey,null);
  let avatarPos=validPosition(savedAvatar)?savedAvatar:null;
  let chatPos=validPosition(savedChat)?savedChat:null;
  let suppressClick=false, stream=null, settingsReturnFocus=null;
  let history=read(historyKey,[]);
  if(!Array.isArray(history)) history=[];
  history=history.filter(m=>m && (m.role==='user'||m.role==='assistant') && typeof m.content==='string' && m.content.length<=20000);
  const saveHistory=()=>{
    if(!write(historyKey,history))setStatus('История не помещается в локальное хранилище. Сохраните важные сообщения отдельно.');
  };

  function setStatus(message=''){status.textContent=message;status.hidden=!message;}
  function preferredMotion(){
    return config.animations && document.documentElement.dataset.motion!=='off'
      && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }
  function applySettings(){
    avatar.style.setProperty('--kitsune-size',config.size+'px');
    avatar.style.setProperty('--kitsune-alpha',String(config.opacity/100));
    avatar.classList.toggle('no-glow',!config.glow);
    avatar.classList.toggle('no-motion',!preferredMotion());
    chat.style.setProperty('--kitsune-font',config.font+'px');
    sizeInput.value=String(config.size);
    opacityInput.value=String(config.opacity);
    glowInput.checked=config.glow;
    animationInput.checked=config.animations;
    fontInput.value=String(config.font);
    avatarSizeValue.textContent=config.size+' px';
    opacityValue.textContent=config.opacity+'%';
    placeAvatar();
    placeChat();
  }
  function placeAvatar(){
    const size=avatar.getBoundingClientRect().width || Math.min(config.size,innerWidth-20);
    const safeW=Math.max(10,innerWidth-size-10),safeH=Math.max(10,innerHeight-size-10);
    if(!avatarPos)avatarPos={x:Math.min(32,safeW),y:safeH};
    avatarPos={x:clamp(avatarPos.x,10,safeW),y:clamp(avatarPos.y,10,safeH)};
    avatar.style.left=avatarPos.x+'px';
    avatar.style.top=avatarPos.y+'px';
  }
  function placeChat(){
    const r=chat.getBoundingClientRect();
    const width=r.width||400,height=r.height||540;
    if(!chatPos){
      chatPos={x:clamp((avatarPos?.x||32)+Math.min(config.size,160)+8,10,Math.max(10,innerWidth-width-10)),
        y:clamp((avatarPos?.y||20)-80,10,Math.max(10,innerHeight-height-10))};
    }
    chatPos={x:clamp(chatPos.x,10,Math.max(10,innerWidth-width-10)),y:clamp(chatPos.y,10,Math.max(10,innerHeight-height-10))};
    chat.style.left=chatPos.x+'px';
    chat.style.top=chatPos.y+'px';
  }
  function renderChat(){
    log.replaceChildren();
    for(const item of history){
      const message=document.createElement('div');
      message.className='kitsune-bubble '+item.role;
      const name=document.createElement('strong');
      name.textContent=item.role==='assistant'?'Миюнэя':'Вы';
      const body=document.createElement('p');
      body.textContent=item.content;
      message.append(name,body);log.append(message);
    }
    log.scrollTop=log.scrollHeight;
  }
  function openChat(){
    chat.hidden=false;avatar.setAttribute('aria-expanded','true');
    placeChat();renderChat();input.focus();
  }
  function closeChat(){
    chat.hidden=true;avatar.setAttribute('aria-expanded','false');
    avatar.focus({preventScroll:true});
  }
  function openSettingsDialog(){
    settingsReturnFocus=document.activeElement;
    settingsBackdrop.hidden=false;settings.hidden=false;
    applySettings();settingsClose.focus();
  }
  function closeSettingsDialog(){
    settings.hidden=true;settingsBackdrop.hidden=true;
    (settingsReturnFocus?.isConnected?settingsReturnFocus:avatar).focus({preventScroll:true});
  }

  function draggable(target,handle,getPosition,setPosition,onSave){
    let pointer=null;
    handle.addEventListener('pointerdown',event=>{
      if(event.button!==0 || (handle!==avatar && event.target.closest('button,input,textarea,select')))return;
      pointer={id:event.pointerId,x:event.clientX,y:event.clientY,pos:{...getPosition()},moved:false};
      handle.setPointerCapture?.(event.pointerId);
    });
    handle.addEventListener('pointermove',event=>{
      if(!pointer || event.pointerId!==pointer.id)return;
      const dx=event.clientX-pointer.x,dy=event.clientY-pointer.y;
      if(!pointer.moved && Math.hypot(dx,dy)<6)return;
      pointer.moved=true;
      setPosition({x:pointer.pos.x+dx,y:pointer.pos.y+dy});
    });
    function end(event){
      if(!pointer||event.pointerId!==pointer.id)return;
      const moved=pointer.moved;pointer=null;
      if(handle===avatar)suppressClick=moved;
      if(moved)onSave();
    }
    handle.addEventListener('pointerup',end);
    handle.addEventListener('pointercancel',end);
  }
  applySettings();
  draggable(avatar,avatar,()=>avatarPos,p=>{avatarPos=p;placeAvatar();},()=>write(avatarKey,avatarPos));
  draggable(chat,chatHeader,()=>chatPos,p=>{chatPos=p;placeChat();},()=>write(chatKey,chatPos));
  avatar.addEventListener('click',()=>{
    if(suppressClick){suppressClick=false;return;}
    chat.hidden?openChat():closeChat();
  });
  avatar.addEventListener('contextmenu',event=>{event.preventDefault();openSettingsDialog();});
  avatar.addEventListener('keydown',event=>{
    const delta={ArrowLeft:[-10,0],ArrowRight:[10,0],ArrowUp:[0,-10],ArrowDown:[0,10]}[event.key];
    if(!delta)return;
    event.preventDefault();
    const step=event.shiftKey?4:1;
    avatarPos={x:avatarPos.x+delta[0]*step,y:avatarPos.y+delta[1]*step};
    placeAvatar();write(avatarKey,avatarPos);
  });
  document.getElementById('kitsune-chat-close').addEventListener('click',closeChat);
  openSettings.addEventListener('click',openSettingsDialog);
  document.getElementById('kitsune-avatar-settings-shortcut').addEventListener('click',openSettingsDialog);
  settingsClose.addEventListener('click',closeSettingsDialog);
  settingsBackdrop.addEventListener('click',closeSettingsDialog);
  settings.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();closeSettingsDialog();return;}
    if(event.key!=='Tab')return;
    const nodes=[...settings.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')];
    const i=nodes.indexOf(document.activeElement),next=event.shiftKey?(i<=0?nodes.length-1:i-1):(i<0||i===nodes.length-1?0:i+1);
    event.preventDefault();nodes[next]?.focus();
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!settings.hidden){event.preventDefault();closeSettingsDialog();}
    else if(event.key==='Escape'&&!chat.hidden){event.preventDefault();closeChat();}
  });
  for(const [node,field,transform] of [
    [sizeInput,'size',Number],[opacityInput,'opacity',Number],[fontInput,'font',Number],
    [glowInput,'glow',()=>glowInput.checked],[animationInput,'animations',()=>animationInput.checked]
  ]){
    node.addEventListener('input',()=>{config[field]=transform(node.value);applySettings();write(settingsKey,config);});
    node.addEventListener('change',()=>{config[field]=transform(node.value);applySettings();write(settingsKey,config);});
  }
  reset.addEventListener('click',()=>{
    config={...defaults};avatarPos=null;chatPos=null;
    applySettings();write(settingsKey,config);write(avatarKey,avatarPos);write(chatKey,chatPos);
  });
  clearChat.addEventListener('click',()=>{
    if(stream)stream.abort();
    history=[];saveHistory();renderChat();setStatus('История очищена в этом браузере.');
  });
  stopButton.addEventListener('click',()=>stream?.abort());
  window.addEventListener('resize',()=>{placeAvatar();placeChat();});
  if(window.MutationObserver){
    const observer=new MutationObserver(()=>{avatar.classList.toggle('no-motion',!preferredMotion());});
    observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-motion']});
  }

  async function send(){
    const content=input.value.trim();
    if(!content||stream)return;
    if(content.length>20000){setStatus('Слишком длинное сообщение — максимум 20 000 символов.');return;}
    const outgoing=[...history,{role:'user',content}].slice(-40).map(m=>({role:m.role,content:m.content}));
    history.push({role:'user',content});input.value='';renderChat();saveHistory();setStatus('');
    const current=new AbortController();stream=current;
    sendButton.disabled=true;stopButton.hidden=false;avatar.classList.add('talking');
    const reply={role:'assistant',content:''};history.push(reply);renderChat();
    let complete=false;
    try{
      const response=await fetch('/api/assistant/chat',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({messages:outgoing}),signal:current.signal
      });
      if(!response.ok||!response.body){
        const body=await response.json().catch(()=>({}));
        throw new Error(typeof body.error==='string'?body.error:'Не удалось получить ответ Cloud.ru.');
      }
      const reader=response.body.getReader(),decoder=new TextDecoder();
      let buffer='';
      for(;;){
        const {done,value}=await reader.read();
        if(done)break;
        buffer+=decoder.decode(value,{stream:true});
        let end;
        while((end=buffer.indexOf('\n'))>=0){
          const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);
          if(!line)continue;
          let event;try{event=JSON.parse(line);}catch{continue;}
          if(event.error)throw new Error(String(event.error));
          if(typeof event.delta==='string')reply.content+=event.delta;
          if(typeof event.memory==='string')setStatus(event.memory);
          if(event.done)complete=true;
          renderChat();
        }
        if(complete)break;
      }
      if(!complete)throw new Error('Ответ прервался до завершения.');
      saveHistory();
    }catch(error){
      if(!reply.content)history=history.filter(m=>m!==reply);
      setStatus(current.signal.aborted?'Запрос остановлен.':error?.message||'Нет связи с сервером.');
      saveHistory();renderChat();
    }finally{
      stream=null;sendButton.disabled=false;stopButton.hidden=true;
      avatar.classList.remove('talking');
    }
  }
  form.addEventListener('submit',event=>{event.preventDefault();void send();});
  input.addEventListener('keydown',event=>{
    if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();void send();}
  });
  renderChat();
})();
