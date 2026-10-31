/* Local avatar studio: preserved original blobs, derived HiDPI WebP sizes, thumbnails, tabs. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const root=$('kitsune-settings'), avatar=$('kitsune-avatar'), image=avatar?.querySelector('img');
  if(!root || !avatar || !image)return;
  const storage='miyuneya.kitsune.studio.v1',selectedKey='miyuneya.kitsune.selected.v1';
  const defaults={framing:100,vertical:50,trim:true,gold:true,dragEase:true};
  const read=(key,fallback)=>{try{const s=localStorage.getItem(key);return s?JSON.parse(s):fallback}catch{return fallback}};
  const store=(key,val)=>{try{localStorage.setItem(key,JSON.stringify(val))}catch{}};
  const value=read(storage,{});
  let config={...defaults};
  for(const k of ['framing','vertical'])if(Number.isFinite(value[k]))config[k]=Math.max(k==='framing'?100:0,Math.min(k==='framing'?180:100,value[k]));
  for(const k of ['trim','gold','dragEase'])if(typeof value[k]==='boolean')config[k]=value[k];
  let db=null, urls=[],lastSelected=null;
  const thumbnailURLs=new Set();
  function releaseThumbnails(){
    for(const url of thumbnailURLs)URL.revokeObjectURL(url);
    thumbnailURLs.clear();
  }
  const message=$('kitsune-library-message'),diagnostic=$('kitsune-image-diagnostic');
  const grid=$('kitsune-library-grid');
  function notify(text,kind=''){if(message){message.textContent=text;message.dataset.kind=kind}}
  function useURL(blob){const url=URL.createObjectURL(blob);urls.push(url);return url}
  function releaseURLs(){
    for(const url of urls)URL.revokeObjectURL(url);
    urls=[];
  }
  function openDatabase(){
    return new Promise((resolve,reject)=>{
      if(!window.indexedDB)return reject(Error('IndexedDB недоступна'));
      const req=indexedDB.open('miyuneya-avatar-library',1);
      req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('images'))req.result.createObjectStore('images',{keyPath:'id'});};
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
      req.onblocked=()=>reject(Error('База аватаров занята другой вкладкой'));
    });
  }
  function transaction(mode,fn){
    return new Promise((resolve,reject)=>{
      if(!db)return reject(Error('Нет доступа к библиотеке'));
      const tx=db.transaction('images',mode);
      const req=fn(tx.objectStore('images'));
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
      tx.onabort=()=>reject(tx.error);
    });
  }
  const all=()=>transaction('readonly',store=>store.getAll());
  const get=id=>transaction('readonly',store=>store.get(id));
  const put=row=>transaction('readwrite',store=>store.put(row));
  const erase=id=>transaction('readwrite',store=>store.delete(id));
  async function decode(file){
    const url=URL.createObjectURL(file);
    try {
      const img=new Image(); img.decoding='async';
      img.src=url;
      if(img.decode)await img.decode();
      else await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;});
      if(img.naturalWidth<16||img.naturalHeight<16||img.naturalWidth>8192||img.naturalHeight>8192||img.naturalWidth*img.naturalHeight>40000000)
        throw Error('Размеры изображения должны быть от 16 до 8192 пикселей, максимум 40 Мп.');
      return img;
    } finally { URL.revokeObjectURL(url); }
  }
  function bounds(img,trim){
    const original={x:0,y:0,w:img.naturalWidth,h:img.naturalHeight};
    if(!trim)return original;
    const width=Math.min(640,img.naturalWidth),height=Math.max(1,Math.round(img.naturalHeight*width/img.naturalWidth));
    const c=document.createElement('canvas');c.width=width;c.height=height;
    const ctx=c.getContext('2d',{willReadFrequently:true});if(!ctx)return original;
    ctx.drawImage(img,0,0,width,height);
    const a=ctx.getImageData(0,0,width,height).data;
    let l=width,t=height,r=-1,b=-1;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(a[(y*width+x)*4+3]>9){l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);}
    if(r<l)return original;
    const sx=img.naturalWidth/width,sy=img.naturalHeight/height;
    const margin=.018*Math.max(r-l+1,b-t+1);
    const x=Math.max(0,Math.floor((l-margin)*sx)),y=Math.max(0,Math.floor((t-margin)*sy));
    return {x,y,w:Math.min(img.naturalWidth-x,Math.ceil((r-l+1+2*margin)*sx)),h:Math.min(img.naturalHeight-y,Math.ceil((b-t+1+2*margin)*sy))};
  }
  function webp(img,rect,maxSize,quality=.93){
    const scale=Math.min(1,maxSize/Math.max(rect.w,rect.h));
    const w=Math.max(1,Math.round(rect.w*scale)),h=Math.max(1,Math.round(rect.h*scale));
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d',{alpha:true});
    if(!ctx)throw Error('Браузер не поддерживает обработку изображений');
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    ctx.drawImage(img,rect.x,rect.y,rect.w,rect.h,0,0,w,h);
    return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Не удалось сформировать изображение')), 'image/webp', quality));
  }
  async function compose(file,trim){
    if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)||file.size>15_000_000||file.size===0)
      throw Error('Поддерживаются PNG, JPG, WebP и GIF до 15 МБ.');
    const img=await decode(file),rect=bounds(img,trim);
    const variants=[];
    const seenSizes=new Set();
    for(const size of [192,384,768,1536]){
      // Small originals must not produce four identical srcset descriptors.
      const scale=Math.min(1,size/Math.max(rect.w,rect.h));
      const width=Math.max(1,Math.round(rect.w*scale));
      const height=Math.max(1,Math.round(rect.h*scale));
      const dimensions=width+'x'+height;
      if(seenSizes.has(dimensions))continue;
      seenSizes.add(dimensions);
      const blob=await webp(img,rect,size,size<=384?.9:.94);
      variants.push({width,blob});
    }
    return {original:file,preview:variants[0].blob,variants,
      width:img.naturalWidth,height:img.naturalHeight,crop:rect};
  }
  async function showPreview(file,commit){
    try{
      const prepared=await compose(file,config.trim);
      const modal=document.createElement('dialog');modal.className='kitsune-preview-dialog';
      const preview=document.createElement('img');preview.alt='Предпросмотр аватара';
      const previewURL=URL.createObjectURL(prepared.variants[2].blob);
      preview.src=previewURL;
      const info=document.createElement('p');
      info.textContent=file.name+' · '+prepared.width+' × '+prepared.height+' · '+Math.round(file.size/1024)+' КБ · обрезка: '+prepared.crop.w+' × '+prepared.crop.h;
      const buttons=document.createElement('div');buttons.className='kitsune-preview-actions';
      const approve=document.createElement('button');approve.type='button';approve.textContent='Применить образ';
      const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Отмена';
      const heading=document.createElement('h3');heading.textContent='Предпросмотр изображения';
      buttons.append(cancel,approve);modal.append(heading,preview,info,buttons);root.append(modal);
      let settled=false;
      const close=()=>{if(settled)return;settled=true;modal.close();modal.remove();URL.revokeObjectURL(previewURL);};
      cancel.onclick=close;modal.addEventListener('cancel',e=>{e.preventDefault();close()});
      approve.onclick=async()=>{if(settled)return;approve.disabled=true;try{await commit(prepared);close();}catch(e){notify(e?.message||'Не удалось сохранить образ','error');approve.disabled=false;}};
      modal.showModal();
    }catch(e){notify(e?.message||'Файл не удалось открыть','error');}
  }
  function setFraming(){
    avatar.style.setProperty('--kitsune-frame-scale',String(config.framing/100));
    avatar.style.setProperty('--kitsune-frame-y',config.vertical+'%');
    avatar.classList.toggle('kitsune-gold-glow',config.gold);
    avatar.classList.toggle('kitsune-drag-ease',config.dragEase);
    for(const [id,value,out] of [
      ['kitsune-framing',config.framing,'kitsune-framing-output'],
      ['kitsune-vertical',config.vertical,'kitsune-vertical-output']
    ]){
      const el=$(id);if(el)el.value=String(value);
      if($(out))$(out).textContent=value+'%';
    }
    for(const [id,key] of [['kitsune-auto-trim','trim'],['kitsune-gold-glow','gold'],['kitsune-drag-ease','dragEase']])if($(id))$(id).checked=config[key];
    store(storage,config);
  }
  for(const [id,key] of [['kitsune-framing','framing'],['kitsune-vertical','vertical'],['kitsune-auto-trim','trim'],['kitsune-gold-glow','gold'],['kitsune-drag-ease','dragEase']]){
    $(id)?.addEventListener('input',e=>{config[key]=e.target.type==='checkbox'?e.target.checked:Number(e.target.value);setFraming();});
  }
  setFraming();

  const panels=[...root.querySelectorAll('[data-kitsune-panel]')],tabs=[...root.querySelectorAll('[data-kitsune-tab]')];
  function activate(tab){
    for(const p of panels)p.hidden=p.dataset.kitsunePanel!==tab;
    for(const button of tabs){
      const active=button.dataset.kitsuneTab===tab;
      button.setAttribute('aria-selected',String(active));
      button.tabIndex=active?0:-1;
    }
    if(tab==='library')void renderLibrary();
  }
  for(const b of tabs)b.addEventListener('click',()=>activate(b.dataset.kitsuneTab));
  root.addEventListener('keydown',e=>{
    if(e.target.closest('.kitsune-settings-tabs') && ['ArrowLeft','ArrowRight'].includes(e.key)){
      e.preventDefault();const i=tabs.findIndex(x=>x.getAttribute('aria-selected')==='true');
      const next=tabs[(i+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length];
      activate(next.dataset.kitsuneTab);next.focus();
    }
  });
  activate('avatar');

  async function choose(id){
    const row=await get(id);if(!row)throw Error('Образ не найден');
    if(!(row.original instanceof Blob) || !Array.isArray(row.variants)) throw Error('Повреждённая запись образа.');
    // Older library entries may have duplicate width descriptors. De-duplicate
    // on reading as well as at creation so migrated images keep rendering.
    const candidates=new Map();
    for(const v of row.variants){
      if(Number.isSafeInteger(v?.width) && v.width>0 && v.blob instanceof Blob)
        candidates.set(v.width,v.blob);
    }
    if(!candidates.size)throw Error('Нет доступных вариантов изображения.');
    releaseURLs();
    const srcset=[...candidates.entries()].sort((a,b)=>a[0]-b[0])
      .map(([width,blob])=>useURL(blob)+' '+width+'w').join(', ');
    const original=useURL(row.original);
    // Set sizes for actual on-screen avatar width, not the 4K monitor width.
    image.sizes='(max-width: 450px) 160px, 300px';
    image.srcset=srcset;
    image.src=original;
    lastSelected=id;store(selectedKey,id);
    diagnostic.textContent='Оригинал '+row.width+' × '+row.height+' px. Производные файлы до '+Math.max(...row.variants.map(v=>v.width))+' px без искусственного увеличения.';
    await renderLibrary();
  }
  async function renderLibrary(){
    if(!grid||!db)return;
    const rows=await all();
    releaseThumbnails();
    grid.replaceChildren();
    const builtin=document.createElement('button');builtin.type='button';builtin.className='kitsune-library-card';
    const builtImg=document.createElement('img');builtImg.src='/avatars/hayumeri-kitsune.avif';builtImg.alt='';
    const builtLabel=document.createElement('span');builtLabel.textContent='Исходная кицунэ';
    builtin.append(builtImg,builtLabel);
    builtin.setAttribute('aria-pressed',String(!lastSelected));
    builtin.onclick=()=>{releaseURLs();lastSelected=null;store(selectedKey,null);image.removeAttribute('srcset');image.src='/avatars/hayumeri-kitsune.avif';void renderLibrary();};
    grid.append(builtin);
    for(const row of rows.slice(0,20)){
      const b=document.createElement('button');b.type='button';b.className='kitsune-library-card';
      const thumbnail=document.createElement('img');thumbnail.alt='';
      const thumbURL=URL.createObjectURL(row.preview);
      thumbnailURLs.add(thumbURL);
      const releaseThumb=()=>{URL.revokeObjectURL(thumbURL);thumbnailURLs.delete(thumbURL);};
      thumbnail.onload=releaseThumb;
      thumbnail.onerror=releaseThumb;
      thumbnail.src=thumbURL;
      const title=document.createElement('span');title.textContent=row.name.slice(0,40);
      b.append(thumbnail,title);b.setAttribute('aria-pressed',String(lastSelected===row.id));
      b.onclick=()=>void choose(row.id).catch(e=>notify(e.message,'error'));
      const wrapper=document.createElement('div');wrapper.className='kitsune-library-entry';
      const del=document.createElement('button');del.type='button';del.className='kitsune-library-delete';
      del.textContent='Удалить';del.setAttribute('aria-label','Удалить образ '+row.name.slice(0,40));
      del.onclick=async()=>{
        try{
          await erase(row.id);
          if(lastSelected===row.id){
            releaseURLs();lastSelected=null;store(selectedKey,null);
            image.removeAttribute('srcset');image.src='/avatars/hayumeri-kitsune.avif';
          }
          await renderLibrary();notify('Образ удалён из библиотеки.');
        }catch(e){notify(e.message,'error');}
      };
      wrapper.append(b,del);grid.append(wrapper);
    }
  }
  async function add(prepared){
    const entries=await all();
    if(entries.length>=20)throw Error('В библиотеке максимум 20 образов. Удалите лишние перед добавлением.');
    const id=crypto.randomUUID?.() || Date.now()+'-'+Math.random();
    await put({id,name:prepared.original.name||'Аватар',...prepared,added:Date.now()});
    await choose(id);
    notify('Образ добавлен в локальную библиотеку и выбран.');
  }
  const libraryUpload=$('kitsune-library-upload');
  libraryUpload?.addEventListener('change',e=>{
    const file=e.target.files?.[0];e.target.value='';
    if(file)void showPreview(file,add);
  });
  const regularUpload=$('kitsune-image-upload');
  // Capture before the legacy immediate-upload handler: approval is mandatory.
  regularUpload?.addEventListener('change',e=>{
    if(!db)return; // Built-in server upload remains available when IndexedDB is unavailable.
    e.stopImmediatePropagation();
    const file=e.target.files?.[0];e.target.value='';
    if(!file)return;
    void showPreview(file,async prepared=>{
      const response=await fetch('/api/assistant/avatar',{method:'PUT',headers:{'Content-Type':prepared.original.type},body:prepared.original});
      if(!response.ok)throw Error('Локальный сервер отклонил изображение');
      await add(prepared);
      notify('Оригинал сохранён на сервере без сжатия. Библиотека хранит и его, и оптимизированные размеры.');
    });
  },true);
  $('kitsune-image-restore')?.addEventListener('click',()=>{
    releaseURLs();lastSelected=null;store(selectedKey,null);
    image.removeAttribute('srcset');image.src='/avatars/hayumeri-kitsune.avif';void renderLibrary();
  },true);
  async function initialize(){
    try{
      db=await openDatabase();
      const selected=read(selectedKey,null);
      if(typeof selected==='string')await choose(selected);
      else await renderLibrary();
    }catch(e){notify('Библиотека недоступна: '+(e?.message||'Проверьте настройки браузера'),'error');}
  }
  void initialize();
  $('kitsune-settings-reset')?.addEventListener('click',()=>{
    // The reset button promises to restore appearance, including options
    // introduced by the studio (which are stored separately from the chat).
    config={...defaults};
    setFraming();
    notify('Параметры кадрирования и эффектов восстановлены.');
  });
  window.addEventListener('beforeunload',()=>{
    releaseURLs();
    releaseThumbnails();
    db?.close();
  },{once:true});
})();
