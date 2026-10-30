// Generated from src/disk.ts by npm run build.




const esc=(s       )=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] ));
export const bytes=(n       )=>n<1024?`${n} Б`:n<1048576?`${(n/1024).toFixed(1)} КБ`:`${(n/1048576).toFixed(1)} МБ`;
const documents=(n       )=>`${n} ${n%10===1&&n%100!==11?'документ':n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?'документа':'документов'}`;
const extension=(name       )=>name.includes('.')?name.split('.').pop() .toUpperCase().slice(0,7):'ФАЙЛ';
export function createDisk(host     ){
  let state           =null,view='all',query='',sort='new',limit=50,busy=false,progress='',error='',loading                   =null;const picked=new Set        ();
  try{const v=JSON.parse(localStorage.getItem('Miyuneya.disk.view')||'{}');if(typeof v.view==='string')view=v.view;if(['new','name','size'].includes(v.sort))sort=v.sort;}catch{}
  const remember=()=>{try{localStorage.setItem('Miyuneya.disk.view',JSON.stringify({view,sort}));}catch{}};
  function path(id       ){const parts         =[];let f=state?.folders.find(f=>f.id===id);for(let i=0;f&&i<20;i++){parts.unshift(f.name);f=state?.folders.find(x=>x.id===f .parent);}return parts.join(' / ');}
  function depth(id       ){return path(id).split(' / ').length-1;}

  const dialog=document.createElement('dialog');dialog.className='disk-dialog';dialog.setAttribute('aria-label','Документ');document.body.append(dialog);
  let shown               =null; // Metadata dialog state is independent of the reading panel.
  let previewFile               =null,previewText='';let previewAbort                     =null;
  const folderOptions=(selected            )=>`<option value="">Без папки</option>`+(state?.folders||[]).map(f=>`<option value="${f.id}" ${f.id===selected?'selected':''}>${esc(path(f.id))}</option>`).join('');
  function close(){dialog.close();dialog.innerHTML='';shown=null;}
  async function request(path       ,options            ={}){const response=await fetch('/api/disk'+path,options);const result=await response.json();if(!response.ok)throw new Error(result.error || 'Диск недоступен.');return result;}
  async function load(){if(loading)return loading;loading=(async()=>{try{state=await request('');if(!['all','starred','trash'].includes(view)&&!state .folders.some(f=>f.id===view))view='all';error='';}catch(e){error=(e         ).message;}finally{loading=null;host.render();}})();return loading;}
  async function change(path       ,input       ,method='PATCH'){
    if(busy)return false;busy=true;error='';host.render();
    try{state=await request(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:state?.revision,...input})});picked.clear();return true;}
    catch(e){error=(e         ).message;host.toast(error);return false;}
    finally{busy=false;host.render();}
  }
  function selected(){return state?.files.filter(f=>view==='trash'?!!f.trashedAt:!f.trashedAt && (view==='all' || view==='starred'&&f.starred || f.folder===view)).filter(f=>f.name.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'))).sort((a,b)=>sort==='name'?a.name.localeCompare(b.name,'ru'):sort==='size'?b.size-a.size:b.createdAt.localeCompare(a.createdAt)) || [];}
  function ancestors(id       ){const rows         =[];let f=state?.folders.find(f=>f.id===id);for(let i=0;f&&i<20;i++){rows.unshift(f);f=state?.folders.find(p=>p.id===f .parent);}return rows;}
  function html(q       ){query=q;const files=selected();const live=state?.files.filter(f=>!f.trashedAt)||[];const folder=state?.folders.find(f=>f.id===view);
    const row=(f          )=>`<article class="disk-file"><input type="checkbox" data-disk-pick="${f.id}" aria-label="Выбрать ${esc(f.name)}" ${picked.has(f.id)?'checked':''} ${busy?'disabled':''}><span class="file-badge ${extension(f.name)==='PDF'?'pdf':''}">${esc(extension(f.name))}</span><button class="file-title" data-disk="preview" data-id="${f.id}" ${f.trashedAt?'disabled':''}><b>${esc(f.name)}</b><small>${bytes(f.size)} · ${new Date(f.createdAt).toLocaleDateString('ru-RU')} · ${esc((f.folder?path(f.folder):'') || 'Без папки')}</small></button><div class="file-actions">${f.trashedAt?`<button class="button" data-disk="restore" data-id="${f.id}" ${busy?'disabled':''}>Восстановить</button>`:`<button class="icon-button file-star ${f.starred?'starred':''}" data-disk="star" data-id="${f.id}" aria-label="${f.starred?'Убрать из избранного':'В избранное'}" aria-pressed="${f.starred}" ${busy?'disabled':''}>☆</button><a class="button quiet" href="/api/disk/files/${f.id}/content" download>Скачать</a><button class="icon-button" data-disk="manage" data-id="${f.id}" aria-label="Параметры документа ${esc(f.name)}">⋯</button>`}</div></article>`;
    return `<div class="page-heading"><div><span class="eyebrow">ВАШИ ДОКУМЕНТЫ РЯДОМ</span><h1>Диск</h1></div><div class="heading-actions"><button class="button" data-disk="new-folder" ${busy?'disabled':''}>+ Папка</button><label class="button primary ${busy?'disabled':''}">+ Загрузить<input class="disk-input" type="file" multiple data-disk-upload ${busy?'disabled':''}></label></div></div><p class="page-description">${documents(live.length)} · ${bytes(live.reduce((s,f)=>s+f.size,0))} · хранятся на этом компьютере</p>${error?`<div class="save-error" role="alert">${esc(error)} <button class="button" data-disk="refresh">Обновить список</button></div>`:''}${busy?`<div class="disk-progress" role="status">${esc(progress || 'Сохранение изменений…')}</div>`:''}<div class="disk-layout"><aside class="disk-folders" aria-label="Папки документов">${[['all','Все документы'],['starred','Избранное'],['trash','Корзина'],...(state?.folders||[]).slice().sort((a,b)=>path(a.id).localeCompare(path(b.id),'ru')).map(f=>[f.id,f.name])].map(([id,label])=>`<button data-disk="view" data-view="${id}" class="folder-depth-${Math.min(10,depth(id))} ${view===id?'active':''}" aria-current="${view===id?'page':'false'}">${id==='starred'?'☆':id==='trash'?'♲':id==='all'?'▤':'▱'} ${esc(label)}</button>`).join('')}<p>До 64 МБ на файл.<br>Документы не отправляются в cloud.ru автоматически.</p></aside><section class="disk-content"><div class="section-head"><h2>${esc(folder?.name || (view==='trash'?'Корзина':view==='starred'?'Избранное':'Все документы'))} <span class="disk-count">${files.length}</span></h2><label class="disk-sort">Порядок <select data-disk-sort aria-label="Порядок документов"><option value="new" ${sort==='new'?'selected':''}>Сначала новые</option><option value="name" ${sort==='name'?'selected':''}>По имени</option><option value="size" ${sort==='size'?'selected':''}>По размеру</option></select></label>${folder?'<button class="text-link" data-disk="edit-folder">Изменить папку</button>':''}${state?.canUndo?'<button class="button" data-disk="undo">↶ Отменить действие диска</button>':''}</div>${folder?`<nav class="folder-breadcrumbs" aria-label="Путь папки"><button data-disk="view" data-view="all">Диск</button>${ancestors(folder.id).map(f=>`<span>/</span><button data-disk="view" data-view="${f.id}">${esc(f.name)}</button>`).join('')}</nav>`:''}${['starred','trash'].includes(view)?'':`<div class="subfolders">${(state?.folders||[]).filter(f=>(f.parent||null)===(folder?.id||null)).map(f=>`<button class="button" data-disk="view" data-view="${f.id}">▱ ${esc(f.name)}</button>`).join('')}</div>`}<div class="disk-bulk"><button class="button quiet" data-disk="pick-all">Выбрать ${Math.min(files.length,500)}</button><span>${picked.size?'Выбрано: '+picked.size:''}</span>${picked.size?`<select data-disk-bulk-folder aria-label="Папка для выбранных документов">${folderOptions(null)}</select><button class="button" data-disk="bulk-move">Переместить</button><button class="button" data-disk="bulk-star">В избранное</button><button class="button" data-disk="bulk-trash">${view==='trash'?'Восстановить':'В корзину'}</button><button class="button quiet" data-disk="clear-pick">Снять выделение</button>`:''}</div>${view!=='trash'?`<label class="drop-zone" data-disk-drop>Перетащите документы сюда <span>или нажмите, чтобы выбрать · PDF, DOCX, таблицы, текст и другие файлы</span><input class="disk-input" type="file" multiple data-disk-upload ${busy?'disabled':''}></label>`:'<p class="page-description">Файлы в корзине сохранены. Их можно восстановить; автоматического удаления нет.</p>'}<div class="panel disk-list">${!state&&!error?'<div class="empty">Загружаем документы…</div>':files.length?files.slice(0,limit).map(row).join(''):`<div class="empty"><h3>${query?'Ничего не найдено':view==='trash'?'Корзина пуста':'Документов пока нет'}</h3><p>${query?'Попробуйте другое название.':'Загрузите нужные файлы — они останутся рядом с проектом.'}</p></div>`}</div>${files.length>limit?'<button class="button disk-more" data-disk="more">Показать ещё 50</button>':''}</section></div>`;
  }
  async function upload(files                ){if(busy||!files.length)return;busy=true;error='';let completed=0;const failures         =[];const warnings         =[];const target=state?.folders.some(f=>f.id===view)?view:null;
    try{for(const file of Array.from(files)){
      progress=`Загрузка ${completed+failures.length+1} из ${files.length}: ${file.name}`;host.render();
      try{if(file.size>64*1024*1024)throw new Error('больше 64 МБ');state=await request('/files?name='+encodeURIComponent(file.name)+(target?'&folder='+target:''),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});if(state?.warning)warnings.push(state.warning);completed++;}
      catch(e){failures.push(`${file.name}: ${(e         ).message}`);}
    }}finally{busy=false;progress='';error=[...failures,...warnings].join('; ');await host.sync();host.toast(`Загружено: ${completed}${failures.length?`. Не удалось: ${failures.length}`:''}`);host.render();}
  }
  function form(title       ,body       ,action       ){dialog.innerHTML=`<form data-disk-form="${action}"><div class="dialog-top"><span class="eyebrow">ДИСК MIYUNEYA</span><button type="button" class="icon-button" data-disk-close aria-label="Закрыть">×</button></div><h2>${esc(title)}</h2>${body}<p class="disk-dialog-error" role="alert"></p><div class="dialog-actions"><button type="button" class="button quiet" data-disk-close>Отмена</button><button type="submit" class="button primary">Сохранить</button></div></form>`;if(!dialog.open)dialog.showModal();dialog.querySelector                  ('input')?.focus();}
  async function showPreview(file          ){previewFile=file;previewText='';previewAbort?.abort();const controller=new AbortController();previewAbort=controller;
    const tail=`<div class="dialog-actions"><a class="button" href="/api/disk/files/${file.id}/content" download>Скачать оригинал</a></div>`;
    const update=host.panel(file.id,file.name,'<p>Открываем документ…</p>'+tail);
    try{const result=await request('/files/'+file.id+'/preview',{signal:controller.signal});if(controller.signal.aborted||previewFile?.id!==file.id)return;let body='';
      if(result.kind==='text'){previewText=result.text;body=`${result.truncated?'<p class="preview-warning">Показан начальный фрагмент. Полный текст доступен в оригинале.</p>':''}<pre tabindex="0">${esc(result.text || '(Документ пуст)')}</pre><div class="preview-tools"><button class="button" data-disk-preview-note>В заметку</button><button class="button" data-disk-preview-chat>Подготовить для чата</button></div><p class="disk-hint">Подстановка в чат без отправки.</p>`;}
      else if(result.kind==='pdf')body=`<iframe class="pdf-preview" src="/api/disk/files/${file.id}/inline" title="Предпросмотр PDF ${esc(file.name)}"></iframe>`;
      else if(result.kind==='image')body=`<img class="document-image" src="/api/disk/files/${file.id}/inline" alt="${esc(file.name)}">`;
      else body='<p>Для этого формата доступно скачивание оригинала.</p>';
      update(body+tail);
    }catch(e){if(!controller.signal.aborted)update('<p role="alert">'+esc((e         ).message)+'</p>'+tail);}
  }
  async function click(target            ){const action=target.dataset.disk;if(!action)return;
    if(action==='view'){view=target.dataset.view ;limit=50;picked.clear();remember();host.render();return;}
    if(busy&&['pick-all','clear-pick','undo','bulk-move','bulk-star','bulk-trash'].includes(action)){host.toast('Дождитесь завершения операции.');return;}
    if(action==='pick-all'){selected().slice(0,500).forEach(f=>picked.add(f.id));host.render();return;}
    if(action==='clear-pick'){picked.clear();host.render();return;}
    if(action==='undo'){await change('/undo',{},'POST');return;}
    if(action.startsWith('bulk-')){const folder=(document.querySelector('[data-disk-bulk-folder]')                     )?.value||null;await change('/files/batch',{ids:[...picked],...(action==='bulk-move'?{folder}:action==='bulk-star'?{starred:true}:{trashed:view!=='trash'})});return;}
    if(action==='more'){limit+=50;host.render();return;}
    if(action==='refresh'){await load();return;}
    const file=state?.files.find(f=>f.id===target.dataset.id);
    if(action==='preview'&&file)return showPreview(file);
    if(busy){host.toast('Дождитесь завершения операции.');return;}
    if(action==='star'&&file){await change('/files/'+file.id,{starred:!file.starred});return;}
    if(action==='restore'&&file){if(await change('/files/'+file.id,{trashed:false}))host.toast('Документ восстановлен');return;}
    if(action==='new-folder'){shown=null;form('Новая папка',`<label class="field">Название<input name="name" maxlength="180" required placeholder="Например, Работа"></label><label class="field">Родительская папка<select name="parent">${folderOptions(state?.folders.some(f=>f.id===view)?view:null)}</select></label>`,'folder');return;}
    if(action==='edit-folder'){const folder=state?.folders.find(f=>f.id===view);if(folder)form('Папка',`<label class="field">Название<input name="name" value="${esc(folder.name)}" maxlength="180" required></label><label class="field">Родительская папка<select name="parent">${folderOptions(folder.parent||null)}</select></label><button type="button" class="button danger" data-disk-delete-folder>Удалить пустую папку</button>`,'edit-folder');return;}
    if(action==='manage'&&file){shown=file;form('Параметры документа',`<label class="field">Название<input name="name" value="${esc(file.name)}" maxlength="180" required></label><label class="field">Папка<select name="folder">${folderOptions(file.folder)}</select></label><p class="file-checksum">SHA-256: ${file.sha256}</p><button type="button" class="button danger" data-disk-trash>В корзину</button><p>В корзине оригинал остаётся доступен для восстановления.</p>`,'file');}
  }
  dialog.addEventListener('click',async e=>{const target=(e.target               ).closest             ('button');if(!target)return;
    if(target.hasAttribute('data-disk-close'))return close();
    if(target.hasAttribute('data-disk-trash')&&shown){if(await change('/files/'+shown.id,{trashed:true})){close();host.toast('Документ перемещён в корзину');}}
    if(target.hasAttribute('data-disk-delete-folder')){if(await change('/folders/'+view,{},'DELETE')){view='all';close();host.render();}}
  });
  document.addEventListener('click',async e=>{const target=(e.target               ).closest             ('button');if(!target||dialog.contains(target)||!previewFile)return;
    if(target.hasAttribute('data-disk-preview-note')){target.setAttribute('disabled','');const id=await host.addNote(previewFile.name.replace(/\.[^.]+$/,''),previewText);host.toast(id?'Текст сохранён в заметку':'Не удалось сохранить заметку');target.removeAttribute('disabled');}
    if(target.hasAttribute('data-disk-preview-chat'))host.draft(`Документ «${previewFile.name}»:\n\n${previewText.slice(0,20000)}`);
  });
  dialog.addEventListener('submit',async e=>{e.preventDefault();const formEl=e.target                   ;const formData=new FormData(formEl),action=formEl.dataset.diskForm;let ok=false;
    if(action==='folder')ok=await change('/folders',{name:formData.get('name'),parent:formData.get('parent')||null},'POST');
    if(action==='edit-folder')ok=await change('/folders/'+view,{name:formData.get('name'),parent:formData.get('parent')||null});
    if(action==='file'&&shown)ok=await change('/files/'+shown.id,{name:formData.get('name'),folder:formData.get('folder') || null});
    if(ok)close();else{const area=dialog.querySelector('.disk-dialog-error');if(area)area.textContent=error;}
  });
  dialog.addEventListener('cancel',()=>{shown=null;dialog.innerHTML='';});
  return {html,load,click,upload,viewPrefs:()=>({diskView:view,diskSort:sort}),setView(next       ,order        ){view=['all','starred','trash'].includes(next)||!state||state.folders.some(f=>f.id===next)?next:'all';if(order&&['new','name','size'].includes(order))sort=order;picked.clear();limit=50;remember();},files:()=>state?.files||[],folders:()=>state?.folders||[],async preview(id       ){if(!state)await load();const f=state?.files.find(f=>f.id===id&&!f.trashedAt);if(f)await showPreview(f);else host.toast('Документ недоступен: проверьте корзину диска.');},pick(id       ,value        ){if(value&&picked.size>=500)return host.toast('Можно выбрать до 500 документов.');if(value)picked.add(id);else picked.delete(id);host.render();},searchHtml(q       ){const files=state?.files.filter(f=>!f.trashedAt&&f.name.toLocaleLowerCase('ru').includes(q.trim().toLocaleLowerCase('ru')))||[];return files.slice(0,50).map(f=>`<button class="search-document" data-disk="preview" data-id="${f.id}"><b>${esc(f.name)}</b><small>${esc(f.folder?path(f.folder):'Корень диска')} · ${bytes(f.size)}</small></button>`).join('')||(state?'<p class="page-description">Документов с таким названием нет.</p>':'<p>Загружаем список документов…</p>');},busy:()=>busy,sort(value       ){sort=['new','name','size'].includes(value)?value:'new';remember();host.render();},loaded:()=>!!state};
}
