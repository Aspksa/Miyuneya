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
  const minimizeButton = document.getElementById('kitsune-minimize');
  const expandButton = document.getElementById('kitsune-expand');
  const streamIndicator = document.getElementById('kitsune-stream-indicator');
  const sendButton = document.getElementById('kitsune-send');
  const stopButton = document.getElementById('kitsune-stop');
  const settingsBackdrop = document.getElementById('kitsune-settings-backdrop');
  const settingsClose = document.getElementById('kitsune-settings-close');
  const reset = document.getElementById('kitsune-settings-reset');
  const clearChat = document.getElementById('kitsune-clear');
  const chatTools = chat.querySelector('.kitsune-chat-tools');
  const openSettings = document.getElementById('kitsune-chat-settings');
  const status = document.getElementById('kitsune-chat-status');
  const sizeInput = document.getElementById('kitsune-avatar-size');
  const opacityInput = document.getElementById('kitsune-avatar-opacity');
  const glowInput = document.getElementById('kitsune-glow');
  const animationInput = document.getElementById('kitsune-animations');
  const fontInput = document.getElementById('kitsune-chat-font');
  const widthInput = document.getElementById('kitsune-chat-width');
  const heightInput = document.getElementById('kitsune-chat-height');
  const widthValue = document.getElementById('kitsune-chat-width-output');
  const heightValue = document.getElementById('kitsune-chat-height-output');
  const imageInput = document.getElementById('kitsune-image-upload');
  const imageRestore = document.getElementById('kitsune-image-restore');
  const image = avatar.querySelector('img');
  const imageStatus = document.getElementById('kitsune-settings-message');
  const avatarSizeValue = document.getElementById('kitsune-size-output');
  const opacityValue = document.getElementById('kitsune-opacity-output');

  const defaults = { size: 180, opacity: 100, glow: true, animations: true, font: 15, width: 410, height: 550 };
  const settingsKey = 'miyuneya.kitsune.settings.v1';
  const avatarKey = 'miyuneya.kitsune.position.v1';
  const chatKey = 'miyuneya.kitsune.chat-position.v1';
  const historyKey = 'miyuneya.kitsune.history.v1';
  const customImageKey = 'miyuneya.kitsune.custom-image.v1';
  const originalImageSrc = image.getAttribute('src');
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
    if(Number.isInteger(storedSettings.width)&&storedSettings.width>=320&&storedSettings.width<=800)config.width=storedSettings.width;
    if(Number.isInteger(storedSettings.height)&&storedSettings.height>=350&&storedSettings.height<=900)config.height=storedSettings.height;
  }

  const savedAvatar=read(avatarKey,null),savedChat=read(chatKey,null);
  let avatarPos=validPosition(savedAvatar)?savedAvatar:null;
  let chatPos=validPosition(savedChat)?savedChat:null;
  let suppressClick=false, stream=null, settingsReturnFocus=null;
  let history=read(historyKey,[]);
  if(!Array.isArray(history)) history=[];
  history=history.filter(m=>m && (m.role==='user'||m.role==='assistant') && typeof m.content==='string' && m.content.length<=20000);
  // The browser copy is retained as a recovery source until server migration succeeds.
  let chatState={revision:0,conversations:[],selectedId:null};
  let remoteChats=false, saveQueue=Promise.resolve(), preferenceQueue=Promise.resolve();
  let userChangedSettings=false, userTouchedChats=false;
  const conversationId=()=>crypto.randomUUID?.()||'chat-'+Date.now()+'-'+Math.floor(Math.random()*1e6);
  const firstTitle=messages=>(messages.find(m=>m.role==='user')?.content||'Новый разговор').slice(0,90);
  function activeConversation(){return chatState.conversations.find(row=>row.id===chatState.selectedId);}
  function saveHistory(){
    // Never erase the legacy browser copy: users can still recover after a failed disk write.
    if(!write(historyKey,history))setStatus('История не помещается в браузере; проверьте сохранение на сервере.');
    if(!remoteChats)return;
    if(!activeConversation() && !history.length){persistChatState();return;}
    let row=activeConversation();
    if(!row){
      row={id:conversationId(),title:firstTitle(history),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),messages:[]};
      chatState.conversations.push(row);chatState.selectedId=row.id;
    }
    row.messages=history.map(m=>({role:m.role,content:m.content}));
    if(row.title==='Новый разговор' && history.some(m=>m.role==='user'))row.title=firstTitle(history);
    row.updatedAt=new Date().toISOString();
    persistChatState();
    renderConversationList();
  }
  function persistChatState(){
    const snapshot=structuredClone(chatState);
    saveQueue=saveQueue.then(async()=>{
      const response=await fetch('/api/assistant/conversations',{method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...snapshot,revision:chatState.revision})});
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw Error(body.error||'Не удалось сохранить переписку.');
      chatState.revision=body.revision;
    }).catch(error=>setStatus('История осталась в браузере. Сервер: '+error.message));
  }
  // Appearance is synchronized separately and cannot overwrite chat messages.
  function savePersistentPreference(field,value){
    preferenceQueue=preferenceQueue.then(async()=>{
      const response=await fetch('/api/assistant/preferences',{method:'PATCH',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({[field]:value})});
      if(!response.ok)throw Error('Ошибка сохранения настроек');
    }).catch(()=>setStatus('Настройки сохранены в браузере, но не на сервере.'));
    return preferenceQueue;
  }
  window.miyuneyaAvatarPreferences={
    load:async()=>{const response=await fetch('/api/assistant/preferences',{cache:'no-store'});if(!response.ok)throw Error('Настройки недоступны');return response.json();},
    save:savePersistentPreference
  };
  const historyButton=document.createElement('button');
  historyButton.type='button';historyButton.id='kitsune-history';historyButton.textContent='◷';historyButton.setAttribute('aria-label','История диалогов');
  historyButton.title='Предыдущие разговоры';historyButton.setAttribute('aria-expanded','false');
  const historyPanel=document.createElement('div');historyPanel.className='kitsune-history-panel';historyPanel.hidden=true;
  const searchHistory=document.createElement('input');searchHistory.type='search';searchHistory.placeholder='Поиск по разговорам';
  searchHistory.setAttribute('aria-label','Поиск по истории');
  const newButton=document.createElement('button');newButton.type='button';newButton.textContent='+ Новый разговор';
  const historyList=document.createElement('div');historyList.className='kitsune-history-list';
  historyPanel.append(searchHistory,newButton,historyList);
  chatTools.insertBefore(historyButton,clearChat);chat.querySelector('.kitsune-chat-header').after(historyPanel);
  function renderConversationList(){
    if(historyPanel.hidden)return;
    historyList.replaceChildren();
    const query=searchHistory.value.toLocaleLowerCase('ru');
    for(const row of [...chatState.conversations].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))
      .filter(r=>(r.title+' '+r.messages.map(m=>m.content).join(' ')).toLocaleLowerCase('ru').includes(query))){
      const wrapper=document.createElement('div');wrapper.className='kitsune-history-entry';
      const select=document.createElement('button');select.type='button';select.textContent=row.title||'Без названия';
      select.title=row.title;select.setAttribute('aria-current',String(row.id===chatState.selectedId));
      select.onclick=()=>{
        if(stream){setStatus('Остановите ответ перед переключением диалога.');return;}
        chatState.selectedId=row.id;history=row.messages.map(m=>({...m}));
        write(historyKey,history);renderChat();saveHistory();renderConversationList();
        historyPanel.hidden=true;historyButton.setAttribute('aria-expanded','false');
      };
      const rename=document.createElement('button');rename.type='button';rename.textContent='✎';rename.title='Переименовать';
      rename.onclick=()=>{
        const name=prompt('Название разговора',row.title);
        if(name===null)return;
        row.title=name.trim().slice(0,140)||'Без названия';
        saveHistory();renderConversationList();
      };
      const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.title='Удалить диалог';
      remove.onclick=()=>{
        if(stream){setStatus('Остановите ответ перед удалением.');return;}
        if(!confirm('Удалить разговор «'+row.title+'»?'))return;
        chatState.conversations=chatState.conversations.filter(x=>x.id!==row.id);
        if(chatState.selectedId===row.id){
          chatState.selectedId=chatState.conversations[0]?.id||null;
          history=activeConversation()?.messages.map(m=>({...m}))||[];
          renderChat();
        }
        saveHistory();renderConversationList();
      };
      wrapper.append(select,rename,remove);historyList.append(wrapper);
    }
  }
  historyButton.onclick=()=>{historyPanel.hidden=!historyPanel.hidden;historyButton.setAttribute('aria-expanded',String(!historyPanel.hidden));renderConversationList();};
  searchHistory.oninput=renderConversationList;
  newButton.onclick=()=>{
    if(stream){setStatus('Остановите ответ перед созданием диалога.');return;}
    userTouchedChats=true;chatState.selectedId=null;history=[];renderChat();saveHistory();
    historyPanel.hidden=true;historyButton.setAttribute('aria-expanded','false');
    input.focus();
  };
  async function loadPersistentChats(){
    try{
      const response=await fetch('/api/assistant/conversations',{cache:'no-store'});
      if(!response.ok)throw Error('Сервер недоступен');
      const storedState=await response.json();
      if(userTouchedChats){setStatus('Диалог изменён во время загрузки истории. Текущие сообщения сохранены в браузере. Перезагрузите страницу после отправки ответа.');return;}
      chatState=storedState;
      const legacy=history.map(m=>({...m}));
      const stored=read('miyuneya.kitsune.migrated.v2',false);
      remoteChats=true;
      if(!stored && legacy.length){
        // Stable hash prevents importing the same legacy conversation on every launch.
        let hash=2166136261;
        for(const char of JSON.stringify(legacy)){hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;}
        const id='legacy-'+hash.toString(16);
        if(!chatState.conversations.some(x=>x.id===id)){
          chatState.conversations.push({id,title:firstTitle(legacy),createdAt:new Date().toISOString(),
            updatedAt:new Date().toISOString(),messages:legacy});
          chatState.selectedId=id;
          const response=await fetch('/api/assistant/conversations',{method:'PUT',
            headers:{'Content-Type':'application/json'},body:JSON.stringify(chatState)});
          const result=await response.json().catch(()=>({}));
          if(!response.ok)throw Error(result.error||'Не удалось перенести старую переписку.');
          chatState=result;
        }
        write('miyuneya.kitsune.migrated.v2',true);
      }
      history=activeConversation()?.messages.map(m=>({...m}))||[];
      renderChat();renderConversationList();
    }catch(error){
      remoteChats=false;
      setStatus('Работаем с резервной копией истории в браузере: '+error.message);
    }
  }
  void loadPersistentChats();
  void window.miyuneyaAvatarPreferences.load().then(prefs=>{
    if(userChangedSettings||!prefs?.avatar||typeof prefs.avatar!=='object')return;
    const candidate=prefs.avatar;
    for(const [key,min,max] of [['size',100,300],['opacity',50,100],['font',13,20],
      ['width',320,800],['height',350,900]]){
      if(Number.isInteger(candidate[key])&&candidate[key]>=min&&candidate[key]<=max)config[key]=candidate[key];
    }
    for(const key of ['glow','animations'])if(typeof candidate[key]==='boolean')config[key]=candidate[key];
    applySettings();
  }).catch(()=>{});


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
    chat.style.width='min('+config.width+'px, calc(100vw - 20px))';
    chat.style.height='min('+config.height+'px, calc(100dvh - 24px))';
    sizeInput.value=String(config.size);
    opacityInput.value=String(config.opacity);
    glowInput.checked=config.glow;
    animationInput.checked=config.animations;
    fontInput.value=String(config.font);
    widthInput.value=String(config.width);
    heightInput.value=String(config.height);
    widthValue.textContent=config.width+' px';
    heightValue.textContent=config.height+' px';
    avatarSizeValue.textContent=config.size+' px';
    opacityValue.textContent=config.opacity+'%';
    placeAvatar();
    placeChat();
  }
  function placeAvatar(){
    const size=avatar.getBoundingClientRect().width || Math.min(config.size,innerWidth-20,innerHeight-20);
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
      const railWidth=Math.min(76,innerWidth*.13);
      const available=Math.max(10,innerWidth-width-railWidth-10);
      const avatarCenter=(avatarPos?.x||32)+config.size/2;
      const side=avatarCenter>innerWidth/2?(avatarPos?.x||32)-width-15:(avatarPos?.x||32)+config.size+15;
      chatPos={x:clamp(side,10,available),
        y:clamp((avatarPos?.y||20)-Math.max(24,height/4),10,Math.max(10,innerHeight-height-10))};
    }
    chatPos={x:clamp(chatPos.x,10,Math.max(10,innerWidth-width-10)),y:clamp(chatPos.y,10,Math.max(10,innerHeight-height-10))};
    chat.style.left=chatPos.x+'px';
    chat.style.top=chatPos.y+'px';
  }
  // Reuse message elements while streaming: no full chat flicker on each token.
  function formatMessage(body,value) {
    body.replaceChildren();
    const blocks=String(value).split(/(```[a-zA-Z0-9+#.-]*\n[\s\S]*?```)/g);
    const lexer=/\/\/[^\n]*|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:const|let|var|function|async|await|export|import|return|type|interface|class|if|else|for|while|def|lambda|print|from|try|except|None|True|False|new|throw|public|private|fn|match|impl|struct)\b|\b\d+(?:\.\d+)?\b/g;
    for(const block of blocks){
      if(!block.startsWith('```') || !block.endsWith('```')) {
        body.append(document.createTextNode(block));continue;
      }
      const first=block.indexOf('\n'),language=block.slice(3,first).trim().slice(0,25);
      const text=block.slice(first+1,-3);
      const pre=document.createElement('pre');pre.className='kitsune-code';
      const header=document.createElement('span');header.className='kitsune-code-header';header.textContent=language||'Код';
      const code=document.createElement('code');let pos=0;
      for(const m of text.matchAll(lexer)){
        if(m.index>pos)code.append(document.createTextNode(text.slice(pos,m.index)));
        const piece=document.createElement('span'),t=m[0];
        piece.className=/^(?:\/\/|#)/.test(t)?'kitsune-token-comment':/^(?:"|')/.test(t)?'kitsune-token-string':/^\d/.test(t)?'kitsune-token-number':'kitsune-token-keyword';
        piece.textContent=t;code.append(piece);pos=m.index+t.length;
      }
      code.append(document.createTextNode(text.slice(pos)));pre.append(header,code);body.append(pre);
    }
  }
  function renderChat(){
    for(let i=0;i<history.length;i++){
      const item=history[i];
      let bubble=log.children[i];
      if(!bubble||bubble.dataset.role!==item.role){
        // A cleared/edited conversation may invalidate existing nodes.
        while(log.children.length>i)log.lastElementChild.remove();
        bubble=document.createElement('div');bubble.className='kitsune-bubble '+item.role;
        bubble.dataset.role=item.role;
        const name=document.createElement('strong');name.textContent=item.role==='assistant'?'Миюнэя':'Вы';
        const body=document.createElement('p');bubble.append(name,body);log.append(bubble);
      }
      const body=bubble.querySelector('p');
      if(body.dataset.raw!==item.content){
        formatMessage(body,item.content);
        body.dataset.raw=item.content;
      }
    }
    while(log.children.length>history.length)log.lastElementChild.remove();
    log.scrollTop=log.scrollHeight;
  }
  function openChat(){
    chat.classList.remove('mini');
    chat.hidden=false;avatar.setAttribute('aria-expanded','true');
    placeChat();renderChat();input.focus();
  }
  function closeChat(){
    chat.classList.remove('mini');
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
      if(handle===avatar) {
        // Cancelled drags and pointer-capture loss must not eat a later click.
        suppressClick=moved && event.type==='pointerup';
        if(suppressClick) setTimeout(()=>{suppressClick=false;},0);
      }
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
  minimizeButton?.addEventListener('click',()=>{
    chat.classList.add('mini');
    const maxX=Math.max(10,innerWidth-180),maxY=Math.max(10,innerHeight-60);
    chatPos={x:clamp((avatarPos?.x||20)+Math.min(config.size,150)+8,10,maxX),
      y:clamp((avatarPos?.y||20)+20,10,maxY)};
    placeChat();
    expandButton.focus();
  });
  expandButton?.addEventListener('click',()=>{
    chat.classList.remove('mini');applySettings();placeChat();input.focus();
  });
  settingsClose.addEventListener('click',closeSettingsDialog);
  settingsBackdrop.addEventListener('click',closeSettingsDialog);
  settings.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();closeSettingsDialog();return;}
    if(event.key!=='Tab')return;
    const nodes=[...settings.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')].filter(node=>node.getClientRects().length && !node.closest('[hidden]'));
    const i=nodes.indexOf(document.activeElement),next=event.shiftKey?(i<=0?nodes.length-1:i-1):(i<0||i===nodes.length-1?0:i+1);
    event.preventDefault();nodes[next]?.focus();
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!settings.hidden){event.preventDefault();closeSettingsDialog();}
    else if(event.key==='Escape'&&!chat.hidden){event.preventDefault();closeChat();}
  });
  for(const [node,field,transform] of [
    [sizeInput,'size',Number],[opacityInput,'opacity',Number],[fontInput,'font',Number],
    [widthInput,'width',Number],[heightInput,'height',Number],
    [glowInput,'glow',()=>glowInput.checked],[animationInput,'animations',()=>animationInput.checked]
  ]){
    node.addEventListener('input',()=>{userChangedSettings=true;config[field]=transform(node.value);applySettings();write(settingsKey,config);void savePersistentPreference('avatar',config);});
    node.addEventListener('change',()=>{userChangedSettings=true;config[field]=transform(node.value);applySettings();write(settingsKey,config);void savePersistentPreference('avatar',config);});
  }
  reset.addEventListener('click',()=>{
    config={...defaults};avatarPos=null;chatPos=null;
    userChangedSettings=true;applySettings();write(settingsKey,config);void savePersistentPreference('avatar',config);write(avatarKey,avatarPos);write(chatKey,chatPos);
  });
  // Custom full-resolution images reuse the existing, validated local avatar
  // upload API. The repository's supplied fox illustration remains the fallback.
  function imageMessage(text){imageStatus.textContent=text;imageStatus.hidden=!text;}
  async function syncCustomImage(){
    if(read(customImageKey,false)!==true)return;
    try{
      const response=await fetch('/api/assistant',{cache:'no-store'});
      if(!response.ok)return;
      const status=await response.json();
      if(Number.isSafeInteger(status.customAvatar)&&status.customAvatar>0 && !read('miyuneya.kitsune.selected.v1',null))
        image.src='/api/assistant/avatar?v='+status.customAvatar;
    }catch{}
  }
  imageInput.addEventListener('change',async()=>{
    const file=imageInput.files?.[0];
    if(!file)return;
    const allowed=['image/png','image/jpeg','image/webp','image/gif'];
    if(!allowed.includes(file.type)||file.size>15000000||file.size===0){
      imageMessage('Выберите PNG, JPEG, WebP или GIF размером до 15 МБ.');
      imageInput.value='';
      return;
    }
    imageInput.disabled=true;
    imageMessage('Сохраняем изображение без потери качества…');
    try{
      const response=await fetch('/api/assistant/avatar',{
        method:'PUT',headers:{'Content-Type':file.type},body:file
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error||'Не удалось загрузить изображение.');
      write(customImageKey,true);
      image.src='/api/assistant/avatar?v='+encodeURIComponent(result.customAvatar||Date.now());
      imageMessage('Изображение сохранено локально в исходном качестве.');
    }catch(error){imageMessage(error?.message||'Не удалось сохранить аватар.');}
    finally{imageInput.disabled=false;imageInput.value='';}
  });
  imageRestore.addEventListener('click',()=>{
    write(customImageKey,false);
    image.src=originalImageSrc;
    imageMessage('Исходная кицунэ восстановлена. Ранее загруженные файлы на сервере не удалялись.');
  });
  void syncCustomImage();

  clearChat.addEventListener('click',()=>{
    if(stream)stream.abort();
    userTouchedChats=true;history=[];saveHistory();renderChat();setStatus('Сообщения текущего разговора очищены.');
  });
  stopButton.addEventListener('click',()=>stream?.abort());
  window.addEventListener('resize',()=>{placeAvatar();placeChat();});
  // Native CSS resize should survive next reload without snapping back.
  let sizing=false;
  if(window.ResizeObserver){
    const observer=new ResizeObserver(entries=>{
      if(sizing||chat.hidden||chat.classList.contains('mini'))return;
      const rect=entries[0]?.contentRect;
      if(!rect||rect.width<310||rect.height<200)return;
      // CSS min() contracts the chat to fit a small viewport; this is NOT
      // a user resize. Preserve the chosen desktop dimensions across zoom
      // and window-size changes. Native drag resize writes pixel values.
      const changedWidth=/^[0-9]+(?:[.][0-9]+)?px$/.test(chat.style.width);
      const changedHeight=/^[0-9]+(?:[.][0-9]+)?px$/.test(chat.style.height);
      if(!changedWidth && !changedHeight)return;
      const width=Math.round(rect.width),height=Math.round(rect.height);
      if((changedWidth && Math.abs(config.width-width)>12) ||
         (changedHeight && Math.abs(config.height-height)>12)){
        if(changedWidth)config.width=clamp(Math.round(width/10)*10,320,800);
        if(changedHeight)config.height=clamp(Math.round(height/10)*10,350,900);
        widthInput.value=String(config.width);
        heightInput.value=String(config.height);
        widthValue.textContent=config.width+' px';heightValue.textContent=config.height+' px';
        write(settingsKey,config);
      }
    });
    observer.observe(chat);
  }

  if(window.MutationObserver){
    const observer=new MutationObserver(()=>{avatar.classList.toggle('no-motion',!preferredMotion());});
    observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-motion']});
  }

  async function send(){
    const content=input.value.trim();
    if(!content||stream)return;
    userTouchedChats=true;
    if(content.length>20000){setStatus('Слишком длинное сообщение — максимум 20 000 символов.');return;}
    const outgoing=[...history,{role:'user',content}].slice(-40).map(m=>({role:m.role,content:m.content}));
    history.push({role:'user',content});input.value='';renderChat();saveHistory();setStatus('');
    const current=new AbortController();stream=current;
    sendButton.disabled=true;stopButton.hidden=false;avatar.classList.add('talking');
    if(streamIndicator)streamIndicator.hidden=false;
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
      if(streamIndicator)streamIndicator.hidden=true;
    }
  }
  form.addEventListener('submit',event=>{event.preventDefault();void send();});
  input.addEventListener('keydown',event=>{
    if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();void send();}
  });
  // Chat backup is explicit. It does not include Cloud.ru secrets or personal documents.
  const chatPanel=settings.querySelector('[data-kitsune-panel="chat"]');
  if(chatPanel){
    const actions=document.createElement('div');actions.className='kitsune-history-actions';
    const backup=document.createElement('button');backup.type='button';backup.textContent='Сохранить историю';
    backup.onclick=async()=>{
      await saveQueue;
      const payload=remoteChats?chatState:{revision:0,selectedId:null,conversations:[{
        id:conversationId(),title:firstTitle(history),createdAt:new Date().toISOString(),
        updatedAt:new Date().toISOString(),messages:history}]};
      const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download='miyuneya-chat-backup.json';link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
    const restore=document.createElement('label');restore.textContent='Восстановить историю';
    const restoreFile=document.createElement('input');restoreFile.type='file';restoreFile.accept='.json,application/json';
    restore.append(restoreFile);
    restoreFile.onchange=async()=>{
      const file=restoreFile.files?.[0];restoreFile.value='';
      if(!file)return;
      if(!remoteChats){setStatus('Для восстановления требуется доступный локальный сервер.');return;}
      if(file.size>8_000_000){setStatus('Копия истории больше 8 МБ.');return;}
      try{
        const data=JSON.parse(await file.text());
        if(!Array.isArray(data.conversations)||!confirm('Заменить историю чатов содержимым резервной копии?'))return;
        await saveQueue;
        const response=await fetch('/api/assistant/conversations',{method:'PUT',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({...data,revision:chatState.revision})});
        const restored=await response.json().catch(()=>({}));
        if(!response.ok)throw Error(restored.error||'Неверная резервная копия.');
        chatState=restored;history=activeConversation()?.messages.map(m=>({...m}))||[];
        write(historyKey,history);renderChat();renderConversationList();setStatus('История восстановлена.');
      }catch(error){setStatus('Восстановление не выполнено: '+error.message);}
    };
    actions.append(backup,restore);chatPanel.append(actions);
  }
  renderChat();
})();
