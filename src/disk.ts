type FileEntry = {id:string;name:string;folder:string|null;size:number;sha256:string;createdAt:string;updatedAt:string;starred:boolean;trashedAt:string|null};
type Folder={id:string;name:string};
type State={revision:number;files:FileEntry[];folders:Folder[];fileLimit:number};
type Host={render():void;toast(text:string):void;addNote(title:string,body:string):Promise<string|null>;draft(text:string):void};
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const bytes=(n:number)=>n<1024?`${n} Б`:n<1048576?`${(n/1024).toFixed(1)} КБ`:`${(n/1048576).toFixed(1)} МБ`;
const documents=(n:number)=>`${n} ${n%10===1&&n%100!==11?'документ':n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?'документа':'документов'}`;
const extension=(name:string)=>name.includes('.')?name.split('.').pop()!.toUpperCase().slice(0,7):'ФАЙЛ';
export function createDisk(host:Host){
  let state:State|null=null,view='all',query='',sort='new',limit=50,busy=false,progress='',error='';
  const dialog=document.createElement('dialog');dialog.className='disk-dialog';dialog.setAttribute('aria-label','Документ');document.body.append(dialog);
  let shown:FileEntry|null=null,previewText='';let previewAbort:AbortController|null=null;
  const folderOptions=(selected:string|null)=>`<option value="">Без папки</option>`+(state?.folders||[]).map(f=>`<option value="${f.id}" ${f.id===selected?'selected':''}>${esc(f.name)}</option>`).join('');
  function close(){previewAbort?.abort();dialog.close();dialog.innerHTML='';shown=null;previewText='';}
  async function request(path:string,options:RequestInit={}){const response=await fetch('/api/disk'+path,options);const result=await response.json();if(!response.ok)throw new Error(result.error || 'Диск недоступен.');return result;}
  async function load(){try{state=await request('');error='';}catch(e){error=(e as Error).message;}host.render();}
  async function change(path:string,input:object,method='PATCH'){
    if(busy)return false;busy=true;error='';host.render();
    try{state=await request(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:state?.revision,...input})});return true;}
    catch(e){error=(e as Error).message;host.toast(error);return false;}
    finally{busy=false;host.render();}
  }
  function selected(){return state?.files.filter(f=>view==='trash'?!!f.trashedAt:!f.trashedAt && (view==='all' || view==='starred'&&f.starred || f.folder===view)).filter(f=>f.name.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'))).sort((a,b)=>sort==='name'?a.name.localeCompare(b.name,'ru'):sort==='size'?b.size-a.size:b.createdAt.localeCompare(a.createdAt)) || [];}
  function html(q:string){query=q;const files=selected();const live=state?.files.filter(f=>!f.trashedAt)||[];const folder=state?.folders.find(f=>f.id===view);
    const row=(f:FileEntry)=>`<article class="disk-file"><span class="file-badge ${extension(f.name)==='PDF'?'pdf':''}">${esc(extension(f.name))}</span><button class="file-title" data-disk="preview" data-id="${f.id}" ${f.trashedAt?'disabled':''}><b>${esc(f.name)}</b><small>${bytes(f.size)} · ${new Date(f.createdAt).toLocaleDateString('ru-RU')} · ${esc(state?.folders.find(d=>d.id===f.folder)?.name || 'Без папки')}</small></button><div class="file-actions">${f.trashedAt?`<button class="button" data-disk="restore" data-id="${f.id}" ${busy?'disabled':''}>Восстановить</button>`:`<button class="icon-button file-star ${f.starred?'starred':''}" data-disk="star" data-id="${f.id}" aria-label="${f.starred?'Убрать из избранного':'В избранное'}" aria-pressed="${f.starred}" ${busy?'disabled':''}>☆</button><a class="button quiet" href="/api/disk/files/${f.id}/content" download>Скачать</a><button class="icon-button" data-disk="manage" data-id="${f.id}" aria-label="Параметры документа ${esc(f.name)}">⋯</button>`}</div></article>`;
    return `<div class="page-heading"><div><span class="eyebrow">ВАШИ ДОКУМЕНТЫ РЯДОМ</span><h1>Диск</h1></div><div class="heading-actions"><button class="button" data-disk="new-folder" ${busy?'disabled':''}>+ Папка</button><label class="button primary ${busy?'disabled':''}">+ Загрузить<input class="disk-input" type="file" multiple data-disk-upload ${busy?'disabled':''}></label></div></div><p class="page-description">${documents(live.length)} · ${bytes(live.reduce((s,f)=>s+f.size,0))} · хранятся на этом компьютере</p>${error?`<div class="save-error" role="alert">${esc(error)} <button class="button" data-disk="refresh">Обновить список</button></div>`:''}${busy?`<div class="disk-progress" role="status">${esc(progress || 'Сохранение изменений…')}</div>`:''}<div class="disk-layout"><aside class="disk-folders" aria-label="Папки документов">${[['all','Все документы'],['starred','Избранное'],['trash','Корзина'],...(state?.folders||[]).map(f=>[f.id,f.name])].map(([id,label])=>`<button data-disk="view" data-view="${id}" class="${view===id?'active':''}" aria-current="${view===id?'page':'false'}">${id==='starred'?'☆':id==='trash'?'♲':id==='all'?'▤':'▱'} ${esc(label)}</button>`).join('')}<p>До 64 МБ на файл.<br>Документы не отправляются в cloud.ru автоматически.</p></aside><section class="disk-content"><div class="section-head"><h2>${esc(folder?.name || (view==='trash'?'Корзина':view==='starred'?'Избранное':'Все документы'))} <span class="disk-count">${files.length}</span></h2><label class="disk-sort">Порядок <select data-disk-sort aria-label="Порядок документов"><option value="new" ${sort==='new'?'selected':''}>Сначала новые</option><option value="name" ${sort==='name'?'selected':''}>По имени</option><option value="size" ${sort==='size'?'selected':''}>По размеру</option></select></label>${folder?'<button class="text-link" data-disk="edit-folder">Изменить папку</button>':''}</div>${view!=='trash'?`<label class="drop-zone" data-disk-drop>Перетащите документы сюда <span>или нажмите, чтобы выбрать · PDF, DOCX, таблицы, текст и другие файлы</span><input class="disk-input" type="file" multiple data-disk-upload ${busy?'disabled':''}></label>`:'<p class="page-description">Файлы в корзине сохранены. Их можно восстановить; автоматического удаления нет.</p>'}<div class="panel disk-list">${!state&&!error?'<div class="empty">Загружаем документы…</div>':files.length?files.slice(0,limit).map(row).join(''):`<div class="empty"><h3>${query?'Ничего не найдено':view==='trash'?'Корзина пуста':'Документов пока нет'}</h3><p>${query?'Попробуйте другое название.':'Загрузите нужные файлы — они останутся рядом с проектом.'}</p></div>`}</div>${files.length>limit?'<button class="button disk-more" data-disk="more">Показать ещё 50</button>':''}</section></div>`;
  }
  async function upload(files:FileList|File[]){if(busy||!files.length)return;busy=true;error='';let completed=0;const failures:string[]=[];const target=state?.folders.some(f=>f.id===view)?view:null;
    try{for(const file of Array.from(files)){
      progress=`Загрузка ${completed+failures.length+1} из ${files.length}: ${file.name}`;host.render();
      try{if(file.size>64*1024*1024)throw new Error('больше 64 МБ');state=await request('/files?name='+encodeURIComponent(file.name)+(target?'&folder='+target:''),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});completed++;}
      catch(e){failures.push(`${file.name}: ${(e as Error).message}`);}
    }}finally{busy=false;progress='';if(failures.length)error=failures.join('; ');host.toast(`Загружено: ${completed}${failures.length?`. Не удалось: ${failures.length}`:''}`);host.render();}
  }
  function form(title:string,body:string,action:string){previewAbort?.abort();dialog.innerHTML=`<form data-disk-form="${action}"><div class="dialog-top"><span class="eyebrow">ДИСК MIYUNEYA</span><button type="button" class="icon-button" data-disk-close aria-label="Закрыть">×</button></div><h2>${esc(title)}</h2>${body}<p class="disk-dialog-error" role="alert"></p><div class="dialog-actions"><button type="button" class="button quiet" data-disk-close>Отмена</button><button type="submit" class="button primary">Сохранить</button></div></form>`;if(!dialog.open)dialog.showModal();dialog.querySelector<HTMLInputElement>('input')?.focus();}
  async function showPreview(file:FileEntry){shown=file;previewText='';previewAbort?.abort();const controller=new AbortController();previewAbort=controller;
    dialog.innerHTML=`<div class="dialog-top"><span class="eyebrow">ДОКУМЕНТ</span><button class="icon-button" data-disk-close aria-label="Закрыть">×</button></div><h2 class="preview-title">${esc(file.name)}</h2><p>${bytes(file.size)} · оригинал сохранён без изменений</p><div id="disk-preview" class="document-preview"><p>Открываем документ…</p></div><div class="dialog-actions"><a class="button" href="/api/disk/files/${file.id}/content" download>Скачать оригинал</a></div>`;if(!dialog.open)dialog.showModal();
    try{const result=await request('/files/'+file.id+'/preview',{signal:controller.signal});if(controller.signal.aborted||shown?.id!==file.id)return;const area=dialog.querySelector('#disk-preview')!;
      if(result.kind==='text'){previewText=result.text;area.innerHTML=`${result.truncated?'<p class="preview-warning">Показан начальный фрагмент. Полный текст доступен в оригинальном файле.</p>':''}<pre tabindex="0">${esc(result.text || '(Документ пуст)')}</pre><div class="preview-tools"><button class="button" data-disk-preview-note>В заметку</button><button class="button" data-disk-preview-chat>Подготовить для чата</button></div><p class="disk-hint">В чат будет подставлен текст для проверки. Отправка — только после вашего нажатия.</p>`;}
      else if(result.kind==='pdf')area.innerHTML=`<iframe class="pdf-preview" src="/api/disk/files/${file.id}/inline" title="Предпросмотр PDF ${esc(file.name)}"></iframe>`;
      else if(result.kind==='image')area.innerHTML=`<img class="document-image" src="/api/disk/files/${file.id}/inline" alt="${esc(file.name)}">`;
      else area.innerHTML='<p>Для этого формата доступно хранение и скачивание оригинала. Текстовый просмотр поддерживает DOCX и UTF-8, PDF открывается средствами браузера.</p>';
    }catch(e){if(!controller.signal.aborted)dialog.querySelector('#disk-preview')!.textContent=(e as Error).message;}
  }
  async function click(target:HTMLElement){const action=target.dataset.disk;if(!action)return;
    if(action==='view'){view=target.dataset.view!;limit=50;host.render();return;}
    if(action==='more'){limit+=50;host.render();return;}
    if(action==='refresh'){await load();return;}
    const file=state?.files.find(f=>f.id===target.dataset.id);
    if(action==='preview'&&file)return showPreview(file);
    if(busy){host.toast('Дождитесь завершения операции.');return;}
    if(action==='star'&&file){await change('/files/'+file.id,{starred:!file.starred});return;}
    if(action==='restore'&&file){if(await change('/files/'+file.id,{trashed:false}))host.toast('Документ восстановлен');return;}
    if(action==='new-folder'){shown=null;form('Новая папка','<label class="field">Название<input name="name" maxlength="180" required placeholder="Например, Работа"></label>','folder');return;}
    if(action==='edit-folder'){const folder=state?.folders.find(f=>f.id===view);if(folder)form('Папка',`<label class="field">Название<input name="name" value="${esc(folder.name)}" maxlength="180" required></label><button type="button" class="button danger" data-disk-delete-folder>Удалить пустую папку</button>`,'edit-folder');return;}
    if(action==='manage'&&file){shown=file;form('Параметры документа',`<label class="field">Название<input name="name" value="${esc(file.name)}" maxlength="180" required></label><label class="field">Папка<select name="folder">${folderOptions(file.folder)}</select></label><p class="file-checksum">SHA-256: ${file.sha256}</p><button type="button" class="button danger" data-disk-trash>В корзину</button><p>В корзине оригинал остаётся доступен для восстановления.</p>`,'file');}
  }
  dialog.addEventListener('click',async e=>{const target=(e.target as HTMLElement).closest<HTMLElement>('button');if(!target)return;
    if(target.hasAttribute('data-disk-close'))return close();
    if(target.hasAttribute('data-disk-trash')&&shown){if(await change('/files/'+shown.id,{trashed:true})){close();host.toast('Документ перемещён в корзину');}}
    if(target.hasAttribute('data-disk-delete-folder')){if(await change('/folders/'+view,{},'DELETE')){view='all';close();host.render();}}
    if(target.hasAttribute('data-disk-preview-note')&&shown){target.setAttribute('disabled','');const id=await host.addNote(shown.name.replace(/\.[^.]+$/,''),previewText);if(id)host.toast('Текст документа сохранён в заметки');else host.toast('Заметка пока не сохранена. Проверьте сообщение об ошибке.');target.removeAttribute('disabled');}
    if(target.hasAttribute('data-disk-preview-chat')&&shown){host.draft(`Документ «${shown.name}»:\n\n${previewText.slice(0,20000)}${previewText.length>20000?'\n\n[Фрагмент документа]':''}`);close();}
  });
  dialog.addEventListener('submit',async e=>{e.preventDefault();const formEl=e.target as HTMLFormElement;const formData=new FormData(formEl),action=formEl.dataset.diskForm;let ok=false;
    if(action==='folder')ok=await change('/folders',{name:formData.get('name')},'POST');
    if(action==='edit-folder')ok=await change('/folders/'+view,{name:formData.get('name')});
    if(action==='file'&&shown)ok=await change('/files/'+shown.id,{name:formData.get('name'),folder:formData.get('folder') || null});
    if(ok)close();else{const area=dialog.querySelector('.disk-dialog-error');if(area)area.textContent=error;}
  });
  dialog.addEventListener('cancel',()=>{previewAbort?.abort();shown=null;});
  return {html,load,click,upload,busy:()=>busy,sort(value:string){sort=['new','name','size'].includes(value)?value:'new';host.render();},loaded:()=>!!state};
}
