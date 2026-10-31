/* Avatar presence, visibility and UI persistence separated from chat transport.
   Only browser presentation state lives here; conversation truth stays in SQLite. */
(() => {
  'use strict';
  const activities={
    idle:'Готова к диалогу',composing:'Вы набираете сообщение',
    answering:'Отвечает',offline:'Нет подключения',error:'Ошибка соединения',
    paused:'Анимация приостановлена'
  };
  const modes=new Set(['auto','low','off']);
  function mount({avatar,chat,input,settings,config,save}){
    const key=()=> 'miyuneya.kitsune.ui.'+(innerWidth<=700?'mobile':'desktop')+'.v1';
    function restore(){
      try{
        const state=JSON.parse(localStorage.getItem(key())||'null');
        return state&&typeof state==='object'?
          {open:state.open===true,mini:state.mini===true}:null;
      }catch{return null;}
    }
    function remember(){
      try{localStorage.setItem(key(),JSON.stringify({
        open:!chat.hidden,mini:chat.classList.contains('mini')
      }));}catch{}
    }
    let state='idle';
    const currentText=chat.querySelector('.kitsune-chat-title small');
    if(currentText){
      const dot=document.createElement('i');dot.className='kitsune-presence-dot';
      dot.setAttribute('aria-hidden','true');currentText.prepend(dot);
      function announce(value){
        dot.dataset.state=value;currentText.lastChild?.nodeType===3 &&
          (currentText.lastChild.textContent=' · '+activities[value]);
      }
      announce(state);
      window.addEventListener('miyuneya-avatar-state',event=>{
        if(event.detail?.state)announce(event.detail.state);
      });
    }
    function setActivity(next){
      if(!Object.hasOwn(activities,next))next='idle';
      state=next;avatar.dataset.activity=next;
      window.dispatchEvent(new CustomEvent('miyuneya-avatar-state',{detail:{state:next}}));
    }
    const panel=settings.querySelector('[data-kitsune-panel="effects"]');
    const label=document.createElement('label');
    label.className='kitsune-new-control';
    const title=document.createElement('span');title.textContent='Нагрузка анимации';
    const levels=document.createElement('select');levels.id='kitsune-motion-level';
    for(const [id,name] of [['auto','Автоматически'],['low','Экономно'],['off','Выключено']]){
      const option=document.createElement('option');option.value=id;option.textContent=name;
      levels.append(option);
    }
    label.append(title,levels);
    const info=document.createElement('p');info.className='kitsune-help';
    info.textContent='При скрытой вкладке, экономии трафика и системном ограничении движения анимация автоматически приостанавливается.';
    if(panel){panel.append(label,info);}
    const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const network=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
    function updateMotion(){
      const hidden=document.hidden||Boolean(reduced?.matches)||Boolean(network?.saveData);
      const mode=modes.has(config.motionLevel)?config.motionLevel:'auto';
      const off=hidden||mode==='off'||config.animations===false;
      avatar.dataset.motionLevel=off?'off':mode==='low'?'low':'auto';
      avatar.dataset.visibility=hidden?'paused':'visible';
    }
    levels.value=modes.has(config.motionLevel)?config.motionLevel:'auto';
    levels.onchange=()=>{
      config.motionLevel=levels.value;save();updateMotion();
    };
    document.addEventListener('visibilitychange',updateMotion);
    reduced?.addEventListener?.('change',updateMotion);
    network?.addEventListener?.('change',updateMotion);
    input.addEventListener('focus',()=>{if(state==='idle')setActivity('composing');});
    input.addEventListener('blur',()=>{if(state==='composing')setActivity('idle');});
    window.addEventListener('offline',()=>setActivity('offline'));
    window.addEventListener('online',()=>{
      if(state==='offline')setActivity('idle');
    });
    const ready=()=>{
      avatar.classList.add('kitsune-ready');
      window.setTimeout(()=>avatar.classList.remove('kitsune-ready'),450);
    };
    if(document.readyState==='complete')requestAnimationFrame(ready);
    else window.addEventListener('load',ready,{once:true});
    setActivity(navigator.onLine===false?'offline':'idle');
    updateMotion();
    return {restore,remember,setActivity,updateMotion};
  }
  window.MiyuneyaAvatarState=Object.freeze({mount});
})();
