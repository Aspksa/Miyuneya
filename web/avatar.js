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
  clearChat.textContent='Новый чат';
  clearChat.title='Начать новый разговор, сохранив предыдущий';
  clearChat.setAttribute('aria-label','Начать новый разговор; предыдущий сохраняется');
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
  // The old browser copy is kept untouched as an emergency migration source.
  const legacyHistory=read(historyKey,[]);
  let history=Array.isArray(legacyHistory)?legacyHistory.filter(m=>m &&
    (m.role==='user'||m.role==='assistant') && typeof m.content==='string'):[];
  const recoveryKey='miyuneya.kitsune.recovery.v3';
  let chatState={conversations:[],selectedId:null,total:0};
  let remoteChats=false, loadingOlder=false, nextBefore=null, showArchived=false, activeMeta=null;
  let userChangedSettings=false, userTouchedChats=false;
  let saveQueue=Promise.resolve(), preferenceQueue=Promise.resolve(), listRequest=0;
  const base='/api/assistant/conversations';
  const conversationId=()=>crypto.randomUUID?.()||'chat-'+Date.now()+'-'+Math.floor(Math.random()*1e8);
  const firstTitle=messages=>(messages.find(m=>m.role==='user')?.content||'Новый разговор').slice(0,90);
  const currentRow=()=>activeMeta?.id===chatState.selectedId?activeMeta:
    chatState.conversations.find(c=>c.id===chatState.selectedId);
  const nowISO=()=>new Date().toISOString();
  function trimVisibleHistory(){
    if(history.length<=240)return;
    const removed=history.length-200;
    history=history.slice(removed);
    nextBefore=(nextBefore??0)+removed;
    updateOlderButton();
  }
  function saveHistory(){
    // Only keep a small extra browser recovery window; disk archive is authoritative.
    if(!write(recoveryKey,history.slice(-40).map(({role,content})=>({role,content}))))
      setStatus('Браузерная резервная копия заполнена. Проверьте доступ к папке проекта.');
  }
  async function requestArchive(url,options){
    const response=await fetch(url,{cache:'no-store',...options});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(data.error||'Ошибка сохранения архива переписки.');
    return data;
  }
  function jsonOptions(method,data){
    return {method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)};
  }
  function queued(task){
    const next=saveQueue.catch(()=>{}).then(task);
    saveQueue=next.catch(()=>{});
    return next;
  }
  function savePersistentPreference(field,value){
    preferenceQueue=preferenceQueue.then(async()=>{
      await requestArchive('/api/assistant/preferences',jsonOptions('PATCH',{[field]:value}));
    }).catch(()=>setStatus('Настройки сохранены в браузере, но не на сервере.'));
    return preferenceQueue;
  }
  window.miyuneyaAvatarPreferences={
    load:()=>requestArchive('/api/assistant/preferences'),
    save:savePersistentPreference
  };

  // Chat controls stay inside the existing floating widget.
  const historyButton=document.createElement('button');
  historyButton.type='button';historyButton.id='kitsune-history';historyButton.textContent='◷';
  historyButton.setAttribute('aria-label','История диалогов');
  historyButton.title='Предыдущие разговоры';historyButton.setAttribute('aria-expanded','false');
  const historyPanel=document.createElement('div');historyPanel.className='kitsune-history-panel';historyPanel.hidden=true;
  const searchHistory=document.createElement('input');searchHistory.type='search';
  searchHistory.placeholder='Поиск по всей переписке';
  searchHistory.setAttribute('aria-label','Поиск по всем сохранённым сообщениям');
  const newButton=document.createElement('button');newButton.type='button';newButton.textContent='+ Новый разговор';
  const archiveToggle=document.createElement('button');archiveToggle.type='button';archiveToggle.textContent='Архив';
  const historyList=document.createElement('div');historyList.className='kitsune-history-list';
  const moreChats=document.createElement('button');moreChats.type='button';moreChats.textContent='Показать ещё';
  const searchMode=document.createElement('select');searchMode.className='kitsune-search-mode';
  for(const [value,label] of [['morphology','Словоформы'],['exact','Точные слова'],['phrase','Точная фраза']]){
    const option=document.createElement('option');option.value=value;option.textContent=label;
    searchMode.append(option);
  }
  const searchSort=document.createElement('select');searchSort.className='kitsune-search-sort';
  for(const [value,label] of [['relevance','По совпадению'],['date','По дате']]){
    const option=document.createElement('option');option.value=value;option.textContent=label;
    searchSort.append(option);
  }
  const searchTypos=document.createElement('label');searchTypos.className='kitsune-search-typos';
  const searchTyposInput=document.createElement('input');searchTyposInput.type='checkbox';
  searchTyposInput.checked=true;searchTypos.append(searchTyposInput,' Учитывать опечатки');
  const searchOptions=document.createElement('div');searchOptions.className='kitsune-search-options';
  searchOptions.append(searchMode,searchSort,searchTypos);
  historyPanel.append(searchHistory,searchOptions,newButton,archiveToggle,historyList,moreChats);
  chatTools.insertBefore(historyButton,clearChat);
  chat.querySelector('.kitsune-chat-header').after(historyPanel);
  const moreMessages=document.createElement('button');moreMessages.type='button';
  moreMessages.className='kitsune-load-older';moreMessages.textContent='Загрузить предыдущие сообщения';
  moreMessages.hidden=true;log.before(moreMessages);
  const closeHistory=()=>{historyPanel.hidden=true;historyButton.setAttribute('aria-expanded','false');};
  function updateOlderButton(){moreMessages.hidden=nextBefore===null||!remoteChats;}
  async function loadConversation(id){
    if(stream){setStatus('Сначала остановите текущий ответ.');return;}
    await saveQueue;
    const page=await requestArchive(base+'/'+encodeURIComponent(id)+'/messages?limit=100');
    await requestArchive(base+'/selection',jsonOptions('PATCH',{id}));
    chatState.selectedId=id;
    activeMeta=page.conversation;
    history=page.messages;
    nextBefore=page.nextBefore;
    updateOlderButton();saveHistory();renderChat();renderConversationList();
  }
  async function fetchConversationList(){
    const ticket=++listRequest;
    const query=new URLSearchParams({offset:'0',limit:'60',q:searchHistory.value,
      archived:showArchived?'1':'0',mode:searchMode.value,sort:searchSort.value,
      typos:searchTyposInput.checked?'1':'0'});
    const data=await requestArchive(base+'?'+query);
    if(ticket!==listRequest)return;
    chatState.conversations=data.conversations;
    chatState.total=data.total;
    renderConversationList();
  }
  async function loadMoreConversations(){
    if(chatState.conversations.length>=chatState.total)return;
    const query=new URLSearchParams({offset:String(chatState.conversations.length),limit:'60',
      q:searchHistory.value,archived:showArchived?'1':'0',
      mode:searchMode.value,sort:searchSort.value,typos:searchTyposInput.checked?'1':'0'});
    const data=await requestArchive(base+'?'+query);
    chatState.conversations.push(...data.conversations);
    chatState.total=data.total;renderConversationList();
  }
  function renderConversationList(){
    if(historyPanel.hidden)return;
    historyList.replaceChildren();
    for(const row of chatState.conversations){
      const wrapper=document.createElement('div');wrapper.className='kitsune-history-entry';
      const select=document.createElement('button');select.type='button';select.textContent=(row.parentId?'↳ ':'')+(row.title||'Без названия');
      select.title=row.title;select.setAttribute('aria-current',String(row.id===chatState.selectedId));
      select.onclick=()=>void loadConversation(row.id).then(closeHistory)
        .catch(e=>setStatus('Не удалось открыть разговор: '+e.message));
      const rename=document.createElement('button');rename.type='button';
      rename.textContent='✎';rename.title='Переименовать';
      rename.onclick=async()=>{
        const title=prompt('Название разговора',row.title);
        if(title===null)return;
        try{
          await requestArchive(base+'/'+encodeURIComponent(row.id),jsonOptions('PATCH',{title:title.slice(0,140)}));
          await fetchConversationList();
        }catch(e){setStatus(e.message);}
      };
      const archive=document.createElement('button');archive.type='button';
      archive.textContent=showArchived?'↶':'↧';archive.title=showArchived?'Вернуть из архива':'Переместить в архив';
      archive.setAttribute('aria-label',archive.title+' — '+row.title);
      archive.onclick=async()=>{
        if(stream){setStatus('Остановите ответ перед переносом в архив.');return;}
        if(!showArchived && !confirm('Переместить разговор в архив? Сообщения сохранятся.'))return;
        try{
          await saveQueue;
          await requestArchive(base+'/'+encodeURIComponent(row.id),jsonOptions('PATCH',{archived:!showArchived}));
          if(row.id===chatState.selectedId){chatState.selectedId=null;activeMeta=null;history=[];nextBefore=null;renderChat();updateOlderButton();}
          await fetchConversationList();
          setStatus(showArchived?'Разговор восстановлен.':'Разговор сохранён в архиве.');
        }catch(e){setStatus(e.message);}
      };
      wrapper.append(select,rename,archive);
      if(row.matchSnippet && searchHistory.value.trim()){
        const snippet=document.createElement('div');snippet.className='kitsune-history-snippet';
        snippet.textContent=row.matchSnippet;wrapper.append(snippet);
      }
      historyList.append(wrapper);
    }
    moreChats.hidden=chatState.conversations.length>=chatState.total;
  }
  historyButton.onclick=()=>{
    historyPanel.hidden=!historyPanel.hidden;
    historyButton.setAttribute('aria-expanded',String(!historyPanel.hidden));
    if(!historyPanel.hidden)void fetchConversationList().catch(e=>setStatus(e.message));
  };
  let searchTimer=null;
  searchHistory.oninput=()=>{
    clearTimeout(searchTimer);
    searchTimer=setTimeout(()=>void fetchConversationList().catch(e=>setStatus(e.message)),250);
  };
  moreChats.onclick=()=>void loadMoreConversations().catch(e=>setStatus(e.message));
  for(const control of [searchMode,searchSort,searchTyposInput]){
    control.addEventListener('change',()=>void fetchConversationList().catch(e=>setStatus(e.message)));
  }
  archiveToggle.onclick=()=>{
    showArchived=!showArchived;
    archiveToggle.textContent=showArchived?'Обычные разговоры':'Архив';
    void fetchConversationList().catch(e=>setStatus(e.message));
  };
  function startNewConversation(){
    if(stream){setStatus('Сначала остановите текущий ответ.');return;}
    userTouchedChats=true;
    chatState.selectedId=null;activeMeta=null;history=[];nextBefore=null;updateOlderButton();
    renderChat();closeHistory();input.focus();
    if(remoteChats)void queued(()=>requestArchive(base+'/selection',jsonOptions('PATCH',{id:null})))
      .catch(e=>setStatus(e.message));
  }
  newButton.onclick=startNewConversation;
  moreMessages.onclick=async()=>{
    if(loadingOlder||nextBefore===null||!chatState.selectedId)return;
    if(stream){setStatus('Сначала остановите ответ, чтобы загрузить предыдущие сообщения.');return;}
    loadingOlder=true;moreMessages.disabled=true;
    try {
      const page=await requestArchive(base+'/'+encodeURIComponent(chatState.selectedId)+
        '/messages?before='+nextBefore+'&limit=100');
      history.unshift(...page.messages);
      nextBefore=page.nextBefore;updateOlderButton();renderChat(true);
    }catch(e){setStatus('Не удалось загрузить старые сообщения: '+e.message);}
    finally{loadingOlder=false;moreMessages.disabled=false;}
  };
  async function ensureConversation(title){
    if(!remoteChats)throw Error('Нет связи с локальным архивом. Сообщение не отправлено во избежание потери.');
    await saveQueue; // finish pending selection changes before creating a new dialog
    let row=currentRow();
    if(row)return row;
    const created=await requestArchive(base,jsonOptions('POST',{title:title.slice(0,140)}));
    row=created.conversation;
    chatState.selectedId=row.id;activeMeta=row;
    chatState.conversations.unshift(row);chatState.total++;
    renderConversationList();
    return row;
  }
  function persistMessage(conversationId,message){
    return queued(async()=>{
      const row=activeMeta?.id===conversationId?activeMeta:chatState.conversations.find(c=>c.id===conversationId);
      const result=await requestArchive(base+'/'+encodeURIComponent(conversationId)+'/messages',
        jsonOptions('POST',{message,expectedCount:row?.messageCount}));
      if(row)Object.assign(row,result.conversation);
      const listed=chatState.conversations.find(c=>c.id===conversationId);
      if(listed&&listed!==row)Object.assign(listed,result.conversation);
      return result;
    });
  }
  async function loadPersistentChats(){
    try {
      const listing=await requestArchive(base+'?limit=60');
      remoteChats=true;
      if(userTouchedChats){
        chatState.conversations=listing.conversations;
        chatState.total=listing.total;
        return;
      }
      // A legacy localStorage history could be from a different port or from
      // unsynced messages. Import once; never delete the browser original.
      const migrationKey='miyuneya.kitsune.migrated.v3';
      if(!read(migrationKey,false) && history.length){
        let hash=2166136261;
        for(const char of JSON.stringify(history))hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;
        const id='browser-'+hash.toString(16);
        const payload={revision:0,selectedId:id,conversations:[{id,title:firstTitle(history),
          createdAt:nowISO(),updatedAt:nowISO(),
          messages:history.map(m=>({role:m.role,content:m.content}))}]};
        await requestArchive(base+'/import',jsonOptions('POST',payload));
        write(migrationKey,true);
      }
      if(userTouchedChats)return;
      const data=await requestArchive(base+'?limit=60');
      chatState={conversations:data.conversations,selectedId:data.selectedId,total:data.total};
      remoteChats=true;
      if(chatState.selectedId){
        const page=await requestArchive(base+'/'+encodeURIComponent(chatState.selectedId)+'/messages?limit=100');
        if(userTouchedChats)return;
        history=page.messages;activeMeta=page.conversation;nextBefore=page.nextBefore;updateOlderButton();
      }else{history=[];activeMeta=null;nextBefore=null;}
      renderChat();saveHistory();renderConversationList();
    }catch(e){
      remoteChats=false;
      setStatus('Архив на диске недоступен. Старые записи браузера не удалены: '+e.message);
    }
  }
  const archiveReady=loadPersistentChats();
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
  function renderChat(preserveScroll=false){
    const previousTop=log.scrollTop,previousHeight=log.scrollHeight;
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
      const name=bubble.querySelector('strong');
      name.textContent=item.role==='assistant'?(item.complete===false?'Миюнэя · ответ прерван':'Миюнэя'):'Вы';
      const body=bubble.querySelector('p');
      if(item.id && remoteChats && chatState.selectedId){
        let fork=bubble.querySelector('.kitsune-fork-message');
        if(!fork){
          fork=document.createElement('button');
          fork.type='button';fork.className='kitsune-fork-message';
          fork.textContent='Ответвить';
          fork.title='Начать новую ветку с этого сообщения, сохранив исходный разговор';
          bubble.append(fork);
        }
        fork.onclick=()=>{
          if(stream){setStatus('Остановите ответ перед ветвлением.');return;}
          const source=chatState.selectedId;
          const title=prompt('Название новой ветки',firstTitle(history)+' — ветка');
          if(title===null)return;
          void (async()=>{
            const created=await requestArchive(base,jsonOptions('POST',{
              parentId:source,forkMessageId:item.id,title:title.slice(0,140)}));
            await loadConversation(created.conversation.id);
            setStatus('Создана ветка. Исходный разговор сохранён.');
          })().catch(e=>setStatus('Ошибка ветвления: '+e.message));
        };
      }
      if(body.dataset.raw!==item.content){
        formatMessage(body,item.content);
        body.dataset.raw=item.content;
      }
    }
    while(log.children.length>history.length)log.lastElementChild.remove();
    log.scrollTop=preserveScroll?previousTop+(log.scrollHeight-previousHeight):log.scrollHeight;
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
    historyPanel.hidden=true;historyButton.setAttribute('aria-expanded','false');
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
    if(stream){setStatus('Остановите ответ перед созданием нового разговора.');return;}
    startNewConversation();
    setStatus('Предыдущий разговор сохранён. Открыт новый.');
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
    if(content.length>20000){setStatus('Слишком длинное сообщение — максимум 20 000 символов.');return;}
    const current=new AbortController();
    stream=current;sendButton.disabled=true;stopButton.hidden=false;
    avatar.classList.add('talking');
    if(streamIndicator)streamIndicator.hidden=false;
    let savedUser=false,reply=null,conversation=null,checkpointChain=Promise.resolve();
    let version=0,lastCheckpointAt=0,checkpointError=null;
    function checkpoint(complete=false){
      if(!reply?.content)return Promise.resolve();
      const copy={...reply,version:++version,complete};
      const job=checkpointChain.then(()=>persistMessage(conversation.id,copy)).then(result=>{
        checkpointError=null;return result;
      });
      checkpointChain=job.catch(e=>{
        checkpointError=e;
        setStatus('Не удалось сохранить часть ответа на диск: '+e.message);
      });
      return job;
    }
    try{
      await archiveReady;
      if(!remoteChats)throw Error('Хранилище переписки недоступно. Отправка остановлена, чтобы не потерять сообщение.');
      if(current.signal.aborted)throw Error('Отправка остановлена.');
      userTouchedChats=true;
      const outgoing=[...history,{role:'user',content}].slice(-40)
        .map(m=>({role:m.role,content:m.content}));
      conversation=await ensureConversation(content);
      const user={id:conversationId(),role:'user',content,createdAt:nowISO(),version:1,complete:true};
      await persistMessage(conversation.id,user);
      savedUser=true;
      history.push(user);input.value='';renderChat();saveHistory();setStatus('');
      reply={id:conversationId(),role:'assistant',content:'',createdAt:nowISO(),version:0,complete:false};
      history.push(reply);renderChat();

      const response=await fetch('/api/assistant/chat',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({messages:outgoing}),signal:current.signal
      });
      if(!response.ok||!response.body){
        const body=await response.json().catch(()=>({}));
        throw Error(typeof body.error==='string'?body.error:'Не удалось получить ответ Cloud.ru.');
      }
      const reader=response.body.getReader(),decoder=new TextDecoder();
      let buffer='',complete=false;
      for(;;){
        const {done,value}=await reader.read();
        if(done)break;
        buffer+=decoder.decode(value,{stream:true});
        let end;
        while((end=buffer.indexOf('\n'))>=0){
          const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);
          if(!line)continue;
          let event;try{event=JSON.parse(line);}catch{continue;}
          if(event.error)throw Error(String(event.error));
          if(typeof event.delta==='string')reply.content+=event.delta;
          if(typeof event.memory==='string')setStatus(event.memory);
          if(event.done)complete=true;
          renderChat();
        }
        if(reply.content && Date.now()-lastCheckpointAt>=1000){
          lastCheckpointAt=Date.now();
          // A bounded number of checkpoints protects streamed text on a crash.
          void checkpoint(false).catch(()=>{});
        }
        if(complete)break;
      }
      if(!complete)throw Error('Ответ прервался до завершения.');
      await checkpointChain;
      if(reply.content)await checkpoint(true);
      trimVisibleHistory();saveHistory();
      if(checkpointError)setStatus('Ответ получен. Проверьте сохранение истории на диск.');
    }catch(error){
      if(!savedUser){
        input.value=content;
        setStatus('Сообщение не отправлено: '+(error?.message||'Ошибка локального архива.'));
      }else{
        await checkpointChain;
        if(reply?.content){
          try{await checkpoint(false);}catch(e){
            setStatus('Часть ответа пока только в браузере: '+e.message);
          }
        }else if(reply){
          history=history.filter(m=>m!==reply);
        }
        if(!checkpointError)setStatus(current.signal.aborted?'Запрос остановлен.':error?.message||'Нет связи с сервером.');
        trimVisibleHistory();saveHistory();renderChat();
      }
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
  // Stream the whole archive directly from the local server, never a browser
  // snapshot. Imports merge and do not delete newer conversations.
  const chatPanel=settings.querySelector('[data-kitsune-panel="chat"]');
  if(chatPanel){
    const actions=document.createElement('div');actions.className='kitsune-history-actions';
    const backup=document.createElement('button');backup.type='button';backup.textContent='Сохранить весь архив';
    backup.onclick=async()=>{
      await saveQueue;
      if(!remoteChats){setStatus('Архив недоступен. Экспорт невозможен.');return;}
      const link=document.createElement('a');
      link.href=base+'/export';link.download='miyuneya-chat-archive.jsonl';
      document.body.append(link);link.click();link.remove();
      setStatus('Экспорт начат. Сохраните скачанный архив вне папки проекта.');
    };
    const restore=document.createElement('label');restore.textContent='Импорт архива';
    const restoreFile=document.createElement('input');restoreFile.type='file';
    restoreFile.accept='.json,.jsonl,application/json,application/x-ndjson';
    restore.append(restoreFile);
    restoreFile.onchange=async()=>{
      const file=restoreFile.files?.[0];restoreFile.value='';
      if(!file)return;
      if(!remoteChats){setStatus('Для восстановления требуется локальный сервер.');return;}
      if(!confirm('Добавить переписку из копии? Существующие разговоры не будут удалены.'))return;
      restoreFile.disabled=true;
      try{
        await saveQueue;
        const type=file.name.toLowerCase().endsWith('.jsonl')?'application/x-ndjson':'application/json';
        const imported=await requestArchive(base+'/import',{method:'POST',headers:{'Content-Type':type},body:file});
        await fetchConversationList();
        setStatus('Импортировано сообщений: '+imported.imported+'. Существующие чаты сохранены.');
      }catch(e){setStatus('Импорт остановлен без удаления имеющихся чатов: '+e.message);}
      finally{restoreFile.disabled=false;}
    };
    actions.append(backup,restore);chatPanel.append(actions);

    // All controls live inside existing chat settings; no separate web section.
    const tools=document.createElement('div');tools.className='kitsune-archive-tools';
    const heading=document.createElement('strong');heading.textContent='Надёжность архива';
    const overview=document.createElement('p');overview.textContent='Загрузка статистики…';
    const refresh=document.createElement('button');refresh.textContent='Обновить сведения';
    const check=document.createElement('button');check.textContent='Проверить целостность';
    const backupNow=document.createElement('button');backupNow.textContent='Создать копию сейчас';
    const reindex=document.createElement('button');reindex.textContent='Восстановить поиск';
    async function refreshArchiveStatus(){
      if(!remoteChats)return;
      const info=await requestArchive('/api/assistant/archive/status');
      const mb=v=>(Number(v)/1048576).toFixed(1)+' МБ';
      const date=info.backupAt?new Date(info.backupAt).toLocaleString('ru-RU'):'ещё нет';
      overview.textContent='Диалогов: '+info.conversations+' · Сообщений: '+info.messages+
        ' · База: '+mb(info.databaseBytes)+' · WAL: '+mb(info.walBytes)+
        ' · Свободных страниц: '+info.unusedPages+' · Вложения: '+info.attachments+
        ' ('+mb(info.attachmentBytes)+') · Копий: '+info.backupCount+' ('+mb(info.backupBytes)+') · Последняя: '+date+
        (info.lastExternalBackup?' · Внешняя копия: '+new Date(info.lastExternalBackup).toLocaleString('ru-RU'):'')+
        (info.warnings.length?' · Внимание: '+info.warnings.join(' / '):' · Всё в порядке');
    }
    refresh.onclick=()=>void refreshArchiveStatus().catch(e=>setStatus(e.message));
    async function runMaintenance(action){
      check.disabled=true;backupNow.disabled=true;reindex.disabled=true;
      try{
        const data=await requestArchive('/api/assistant/archive/'+action,{method:'POST'});
        setStatus(action==='backup'?(data.external?.ok===false?'Локальная копия сохранена. Внешний SSD: '+data.external.error:
          'Резервная копия создана и проверена'+(data.external?.ok?' на двух дисках.':'.')):
          action==='rebuild'?'Поиск восстановлен.':
          data.ok?'Целостность базы подтверждена.':'Обнаружены проблемы с целостностью.');
        await refreshArchiveStatus();
      }catch(e){setStatus('Архив: '+e.message);}
      finally{check.disabled=false;backupNow.disabled=false;reindex.disabled=false;}
    }
    check.onclick=()=>void runMaintenance('check');
    backupNow.onclick=()=>void runMaintenance('backup');
    reindex.onclick=()=>void runMaintenance('rebuild');
    const externalHint=document.createElement('p');
    externalHint.textContent='Независимая копия: укажите существующую папку другого диска (например E:\\Backup). При отключении SSD локальная копия сохраняется.';
    const externalInput=document.createElement('input');externalInput.type='text';
    externalInput.placeholder='E:\\Резервные копии';
    externalInput.setAttribute('aria-label','Папка резервных копий на внешнем SSD');
    externalInput.className='kitsune-external-path';
    const externalSave=document.createElement('button');externalSave.type='button';
    externalSave.textContent='Сохранить внешний диск';
    externalSave.onclick=async()=>{
      externalSave.disabled=true;
      try{
        const value=externalInput.value.trim();
        const cfg=await requestArchive('/api/assistant/archive/external',
          jsonOptions('PUT',{destination:value||null}));
        externalInput.value=cfg.destination||'';
        setStatus(cfg.configured?'Независимое резервирование включено.':'Независимый диск отключён в настройках.');
        await refreshArchiveStatus();
      }catch(e){setStatus('Внешний SSD: '+e.message);}
      finally{externalSave.disabled=false;}
    };
    async function refreshExternal(){
      if(!remoteChats)return;
      const cfg=await requestArchive('/api/assistant/archive/external');
      externalInput.value=cfg.destination||'';
    }
    tools.append(heading,overview,refresh,check,backupNow,reindex,externalHint,externalInput,externalSave);
    const attachmentsBox=document.createElement('div');attachmentsBox.className='kitsune-archive-tools';
    const filesTitle=document.createElement('strong');filesTitle.textContent='Вложения текущего разговора';
    const fileLabel=document.createElement('label');fileLabel.textContent='Добавить файл (до 15 МБ)';
    const fileInput=document.createElement('input');fileInput.type='file';fileLabel.append(fileInput);
    const fileList=document.createElement('div');fileList.className='kitsune-attachments-list';
    async function refreshFiles(){
      fileList.replaceChildren();
      if(!chatState.selectedId){fileList.textContent='Сначала откройте разговор.';return;}
      const result=await requestArchive(base+'/'+encodeURIComponent(chatState.selectedId)+'/attachments');
      for(const file of result.attachments){
        const link=document.createElement('a');
        link.href=base+'/'+encodeURIComponent(chatState.selectedId)+'/attachments/'+encodeURIComponent(file.id);
        link.textContent=file.name+' · '+(file.size/1048576).toFixed(1)+' МБ';
        link.download=file.name;fileList.append(link);
      }
      if(!result.attachments.length)fileList.textContent='Вложений пока нет.';
    }
    fileInput.onchange=async()=>{
      const file=fileInput.files?.[0];fileInput.value='';
      if(!file)return;
      if(!chatState.selectedId){setStatus('Сначала откройте разговор.');return;}
      fileInput.disabled=true;
      try{
        const response=await fetch(base+'/'+encodeURIComponent(chatState.selectedId)+'/attachments',{
          method:'POST',headers:{'Content-Type':file.type||'application/octet-stream',
            'X-File-Name':encodeURIComponent(file.name)},body:file});
        if(!response.ok){
          const data=await response.json().catch(()=>({}));
          throw Error(data.error||'Файл не сохранён.');
        }
        await refreshFiles();setStatus('Вложение сохранено отдельно от текста переписки.');
      }catch(e){setStatus('Ошибка вложения: '+e.message);}
      finally{fileInput.disabled=false;}
    };
    attachmentsBox.append(filesTitle,fileLabel,fileList);
    chatPanel.append(tools,attachmentsBox);
    void archiveReady.then(()=>Promise.all([refreshArchiveStatus(),refreshExternal()])).catch(()=>{});
    openSettings.addEventListener('click',()=>{
      void refreshArchiveStatus().catch(()=>{});
      void refreshFiles().catch(()=>{});
    });

  }
  renderChat();
})();
