// Generated from src/main.ts by npm run build.
import { emptyWorkspace, validateWorkspace, combineEntries, defaultLook } from './model.js';
import { formatNoteDate } from './calendar.js';
import { mountAssistant, avatarUrl } from './assistant.js';
                                                                        
                                                      

                                 
const icons                         = {
  notes: '<rect x="5" y="3" width="15" height="18" rx="2"/><path d="M9 8h7M9 12h7M9 16h4M3 7h3M3 12h3M3 17h3"/>',
  tasks: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="m8 8 1 1 2-2m2 2h3m-8 5 1 1 2-2m2 2h3"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M4 12h16m-5-5 5 5-5 5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  export: '<path d="M12 15V3m-4 4 4-4 4 4M5 13v7h14v-7"/>',
};
const icon = (name        ) => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.notes}</svg>`;
const escape = (value        ) => value.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c] ));
const newId = () => Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8, '0')).join('');
const app = document.querySelector                ('#app') ;
const editor = document.querySelector                   ('#editor') ;
let data            = emptyWorkspace();
let revision = 0;
let page       = getPage();
let query = '';
let filter              = 'all';
let saving = false;
let saveError = '';
let fatal = false;
let editing                                         = { kind: 'note' };
let toastTimer                               ;
let ai                  = { configured: false, keyHint: '', model: '' };
let aiModels                  = null;
let aiBusy = false;
let assistant                                               ;
const pageNames                      = { notes:'Заметки и задачи', settings:'Настройки' };
// Old #home and #tasks links land on the shared list.
function getPage()       { return location.hash.slice(1) === 'settings' ? 'settings' : 'notes'; }
function toast(message        ) {
  const el = document.querySelector                ('#toast') ;
  el.textContent = message; el.classList.add('visible'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 3500);
}
function applyTheme() {
  const dark = data.settings.theme === 'dark' || (data.settings.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
const shortDate = formatNoteDate;
function empty(title        , description        , kind                 , label        ) {
  return `<div class="empty">${icon(kind === 'note' ? 'notes' : 'tasks')}<h3>${title}</h3><p>${description}</p><button class="button quiet" data-new="${kind}">${icon('plus')}${label}</button></div>`;
}
function noteRow(n                            ) {
  return `<div class="task-row note-entry">${icon('notes')}<button class="note-open" data-edit="${escape(n.id)}"><b>${escape(n.title)}</b>${n.body?`<p>${escape(n.body)}</p>`:''}</button><small>${shortDate(n.updatedAt)}</small><button class="icon-button" data-delete-note="${escape(n.id)}" aria-label="Удалить заметку ${escape(n.title)}">×</button></div>`;
}
function taskRow(t                            ) {
  return `<div class="task-row ${t.done ? 'done' : ''}"><label><input type="checkbox" data-toggle="${escape(t.id)}" ${t.done ? 'checked' : ''} ${saving ? 'disabled' : ''}><span>${escape(t.title)}</span></label><small>${shortDate(t.createdAt)}</small><button class="icon-button" data-delete-task="${escape(t.id)}" aria-label="Удалить задачу ${escape(t.title)}">×</button></div>`;
}
function notes() {
  const rows = combineEntries(data, query, filter).map(e => e.kind === 'note' ? noteRow(e.item) : taskRow(e.item)).join('');
  const blank = query ? empty('Ничего не найдено', 'Попробуйте другой поисковый запрос.', filter === 'notes' ? 'note' : 'task', filter === 'notes' ? 'Создать заметку' : 'Добавить задачу')
    : filter === 'notes' ? empty('Заметок пока нет', 'Сохраните идею, ссылку или наблюдение.', 'note', 'Создать заметку')
    : filter === 'done' ? empty('Выполненных задач пока нет', 'Отмеченные задачи появятся здесь.', 'task', 'Добавить задачу')
    : empty('Здесь пока пусто', 'Добавьте заметку или задачу.', 'task', 'Добавить задачу');
  return `<div class="page-heading"><h1>Заметки и задачи</h1><div class="heading-actions"><button class="button" data-new="note">${icon('plus')}Заметка</button><button class="button primary" data-new="task">${icon('plus')}Задача</button></div></div><div class="task-controls" aria-label="Фильтр">${([['all','Всё'],['notes','Заметки'],['active','Задачи'],['done','Выполнено']]                          ).map(([key,label]) => `<button data-filter="${key}" class="${filter===key?'active':''}" aria-pressed="${filter===key}">${label}</button>`).join('')}</div><div class="panel">${rows || blank}</div>`;
}
const look = ()                => data.settings.assistant || defaultLook();
function aiCard() {
  const models = aiModels ? [...new Set([ai.model, ...aiModels])] : null;
  const modelField = models
    ? `<select id="ai-model" ${aiBusy?'disabled':''}>${models.map(m=>`<option value="${escape(m)}" ${m===ai.model?'selected':''}>${escape(m)}</option>`).join('')}</select>`
    : `<input id="ai-model" value="${escape(ai.model)}" maxlength="200" autocomplete="off" spellcheck="false" placeholder="например, openai/gpt-oss-120b" ${aiBusy?'disabled':''}>`;
  return `<section class="settings-card ai-card"><h2>Помощница и cloud.ru</h2><p>Миюнэя отвечает в чате через модели cloud.ru Foundation Models. Ключ хранится только на этом компьютере в <code>data/assistant.json</code>, не попадает в браузер и резервные копии; запросы к cloud.ru отправляет локальный сервер.</p><div class="ai-status ${ai.configured?'on':''}"><i class="dot"></i>${ai.configured?`Подключено · ключ ${escape(ai.keyHint)}`:'Ключ не сохранён'}</div><form id="ai-form" autocomplete="off"><label class="field">API-ключ cloud.ru<input id="ai-key" type="password" maxlength="512" autocomplete="new-password" spellcheck="false" placeholder="${ai.configured?'Сохранён. Введите новый, чтобы заменить':'Вставьте ключ из личного кабинета cloud.ru'}" ${aiBusy?'disabled':''}></label><label class="field">Модель${modelField}</label><div class="ai-actions"><button class="button primary" type="submit" ${aiBusy?'disabled':''}>Сохранить</button><button class="button" type="button" data-ai-models ${aiBusy||!ai.configured?'disabled':''}>${aiModels?'Обновить список моделей':'Загрузить список моделей'}</button>${ai.configured?`<button class="button quiet danger" type="button" data-ai-forget ${aiBusy?'disabled':''}>Удалить ключ</button>`:''}</div></form><div class="ai-look"><span class="face"><img src="${avatarUrl(look().avatar)}" alt="" decoding="async"></span><label class="switch"><input type="checkbox" id="ai-avatar-visible" ${look().hidden?'':'checked'}><span>Показывать аватар на экране</span></label></div><p class="ai-hint">Перетаскивайте аватар мышью куда удобно. Левая кнопка открывает чат, правая — меню с выбором из четырёх образов, размером и отражением.</p></section>`;
}
function settings() {
  return `<div class="page-heading"><div><span class="eyebrow">УДОБНО ИМЕННО ВАМ</span><h1>Настройки пространства</h1></div></div><p class="page-description">Немного личного — и всё на своих местах.</p><div class="settings-layout"><div><section class="settings-card"><h2>Оформление</h2><p>Спокойная палитра, в которой легко сосредоточиться.</p><div class="themes">${[['light','Светлая'],['dark','Тёмная'],['auto','Как в системе']].map(([key,label])=>`<button class="theme-option ${data.settings.theme===key?'active':''}" data-theme="${key}" aria-pressed="${data.settings.theme===key}">${label}</button>`).join('')}</div></section><section class="settings-card"><h2>Ваши данные</h2><p>Заметки, задачи и настройки сохраняются в папке data рядом с проектом. Скачайте копию перед переносом или восстановите её из JSON-файла.</p><button class="button" data-export>${icon('export')}Экспортировать</button> <label class="button file-label">Восстановить копию<input type="file" id="import-file" accept=".json,application/json"></label></section>${aiCard()}</div><aside><section class="settings-card"><span class="version">MIYUNEYA / 0.2.0</span><h2>Место для вашего мира</h2><p>Первая версия личного пространства. Работает на вашем компьютере и доступна без интернета после подготовки Node.js.</p><div class="tech-list"><span>TypeScript</span><span>Node.js</span><span>HTML</span><span>CSS</span></div></section><section class="settings-card"><h2>Дальше — вместе</h2><p>Сейчас доступны заметки и задачи в одном списке, настройки и помощница с чатом через cloud.ru. Граф знаний можно добавить следующим этапом.</p><a class="text-link" href="https://github.com/Aspksa/Miyuneya" target="_blank" rel="noopener noreferrer">Репозиторий проекта ${icon('arrow')}</a></section></aside></div>`;
}
function render(focus = false) {
  applyTheme();
  const count = data.notes.length + data.tasks.filter(t => !t.done).length;
  app.innerHTML = `<div class="shell"><aside class="sidebar" id="sidebar"><a class="brand" href="#notes"><img src="/favicon.svg" alt="" width="37" height="37">Miyuneya</a><p class="brand-caption">ВАШ ТИХИЙ МИР</p><p class="nav-label">ПРОСТРАНСТВО</p><nav class="nav" aria-label="Основная навигация"><a href="#notes" class="${page==='notes'?'active':''}" ${page==='notes'?'aria-current="page"':''}>${icon('notes')}${pageNames.notes}<span class="count">${count}</span></a></nav><div class="sidebar-bottom"><nav class="nav" aria-label="Параметры"><a href="#settings" class="${page==='settings'?'active':''}" ${page==='settings'?'aria-current="page"':''}>${icon('settings')}Настройки</a></nav></div></aside><div class="workspace"><header class="topbar"><button class="icon-button mobile-menu" aria-label="Открыть меню" aria-expanded="false" aria-controls="sidebar" data-menu>${icon('menu')}</button><div class="breadcrumb"><span>Пространство</span><span>/</span>${pageNames[page]}</div><label class="search">${icon('search')}<input id="search" aria-label="Поиск по заметкам и задачам" placeholder="Найти в своём пространстве" value="${escape(query)}" maxlength="200"><kbd>/</kbd></label><span class="top-status"><i class="dot"></i>${saveError?'Есть несохранённые изменения':saving?'Сохранение…':'На вашем компьютере'}</span><button class="icon-button" data-cycle-theme aria-label="Переключить тему">${icon('sun')}</button></header><main id="content" tabindex="-1">${saveError?`<div class="save-error" role="alert">${escape(saveError)} <button class="button" data-export>Скачать свою копию</button><button class="button" data-retry>Повторить сохранение</button></div>`:''}${({notes,settings})[page]()}</main></div></div>`;
  if (focus) document.querySelector             ('#content')?.focus();
}
async function save() {
  if (saving || fatal) { if (fatal) toast('Не удалось загрузить исходные данные. Перезапустите приложение.'); return false; }
  saving = true;
  try {
    const response = await fetch('/api/workspace', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({revision, data}) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Не удалось сохранить данные.');
    revision = result.revision; saveError = ''; return true;
  } catch (e) { saveError = (e         ).message || 'Сервер недоступен. Проверьте окно запуска и сохраните резервную копию.'; toast('Изменения пока не сохранены'); return false; }
  finally { saving = false; render(); }
}
function showEditor(kind                 , id         ) {
  if (saving) { toast('Дождитесь завершения сохранения.'); return; }
  if (fatal) { toast('Сначала восстановите подключение к серверу.'); return; }
  editing = {kind,id};
  const note = id ? data.notes.find(n=>n.id===id) : undefined;
  document.querySelector('#editor-heading') .textContent = kind==='task'?'Новая задача':note?'Редактировать заметку':'Новая заметка';
  const title = document.querySelector                  ('#entry-title') ;
  const body = document.querySelector                     ('#entry-body') ;
  title.value = note?.title || ''; body.value = note?.body || ''; body.hidden = kind==='task';
  editor.showModal(); title.focus();
}
function download() {
  const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href=url; a.download=`Miyuneya-backup-${new Date().toISOString().slice(0,10)}.json`; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000); toast('Резервная копия подготовлена');
}
async function confirmDelete(title        ) {
  const dialog = document.querySelector                   ('#confirm') ;
  document.querySelector('#confirm-title') .textContent=title;
  dialog.returnValue='cancel'; dialog.showModal();
  return new Promise         (resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='delete'),{once:true}));
}
app.addEventListener('click', async event => {
  const target=(event.target               ).closest             ('button,a,label');
  if (!target) return;
  if (target.dataset.new) return showEditor(target.dataset.new                 );
  if (target.dataset.edit) return showEditor('note',target.dataset.edit);
  if (target.hasAttribute('data-export')) return download();
  if (saving || fatal) return;
  if (target.hasAttribute('data-retry')) return void await save();
  if (target.dataset.deleteNote && await confirmDelete('Удалить заметку?')) { data.notes=data.notes.filter(n=>n.id!==target.dataset.deleteNote); if(await save()) toast('Заметка удалена'); }
  if (target.dataset.deleteTask && await confirmDelete('Удалить задачу?')) { data.tasks=data.tasks.filter(t=>t.id!==target.dataset.deleteTask); if(await save()) toast('Задача удалена'); }
  if (target.dataset.filter) { filter=target.dataset.filter               ; render(); }
  if (target.dataset.theme) { data.settings.theme=target.dataset.theme                                  ; applyTheme(); await save(); }
  if (target.hasAttribute('data-cycle-theme')) { data.settings.theme=document.documentElement.dataset.theme==='dark'?'light':'dark'; applyTheme(); await save(); }
  if (target.hasAttribute('data-ai-models')) return void await loadModels(true);
  if (target.hasAttribute('data-ai-forget') && await confirmDelete('Удалить ключ cloud.ru?')) { if(await saveAi({apiKey:null})) { aiModels=null; toast('Ключ удалён'); } }
  if (target.hasAttribute('data-menu')) { const isOpen=document.querySelector('#sidebar') .classList.toggle('open'); target.setAttribute('aria-expanded',String(isOpen)); }
});
app.addEventListener('input', event => {
  const input=event.target                    ;
  if (input.id==='search') {
    query=input.value; const caret=input.selectionStart;
    if(page==='settings') { page='notes'; history.replaceState(null,'','#notes'); }
    render(); const search=document.querySelector                  ('#search') ; search.focus(); search.setSelectionRange(caret,caret);
  }
});
app.addEventListener('change', async event => {
  const input=event.target                    ;
  if (input.dataset.toggle) {
    if (saving) return;
    const task=data.tasks.find(t=>t.id===input.dataset.toggle); if(task) {task.done=input.checked; await save();}
  }
  if (input.id==='ai-avatar-visible') return updateLook({hidden:!input.checked});
  if (input.id==='import-file' && input.files?.[0]) {
    try {
      if(input.files[0].size>2_000_000) throw new Error('Копия больше 2 МБ.');
      const imported=JSON.parse(await input.files[0].text());
      if(!validateWorkspace(imported)) throw new Error('Это не резервная копия Miyuneya.');
      if(saving) throw new Error('Дождитесь завершения сохранения.');
      if(!await confirmDelete('Заменить данные резервной копией?')) return;
      data=imported; if(await save()) toast('Резервная копия восстановлена');
    } catch(e) { toast((e         ).message); }
    finally { input.value=''; }
  }
});
app.addEventListener('submit', async event => {
  if ((event.target               ).id!=='ai-form') return;
  event.preventDefault();
  const key=document.querySelector                  ('#ai-key') .value.trim();
  const model=document.querySelector                                    ('#ai-model') .value.trim();
  if(!key && !ai.configured) return toast('Вставьте API-ключ cloud.ru');
  const change                                      = {};
  if(key) change.apiKey=key;
  if(model) change.model=model;
  if(await saveAi(change)) { toast('Подключение cloud.ru сохранено'); if(key || !aiModels) await loadModels(false,true); }
});
async function aiRequest(path        , init              ) {
  const response=await fetch(path,init); const result=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(result.error || 'Сервер вернул ошибку.');
  return result;
}
async function saveAi(change                                            ) {
  if(aiBusy) return false;
  aiBusy=true; render();
  try { ai=await aiRequest('/api/assistant',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(change)}); return true; }
  catch(e) { toast(e instanceof TypeError?'Сервер недоступен.':(e         ).message); return false; }
  finally { aiBusy=false; render(); assistant?.refresh(); }
}
// loud: the user pressed the button; afterSave: a fresh key was just stored; otherwise stay quiet.
async function loadModels(loud         , afterSave = false) {
  if(aiBusy || !ai.configured) return;
  aiBusy=true; render();
  try { aiModels=(await aiRequest('/api/assistant/models')).models; if(loud) toast(aiModels .length?`Доступно моделей: ${aiModels .length}`:'cloud.ru не вернул список моделей'); }
  catch(e) { if(loud) toast(e instanceof TypeError?'Сервер недоступен.':(e         ).message); else if(afterSave) toast('Ключ сохранён, но список моделей не загрузился: '+(e         ).message); }
  finally { aiBusy=false; render(); }
}
function updateLook(change                        ) {
  data.settings.assistant={...look(),...change};
  assistant?.refresh();
  if(page==='settings') render();
  void save();
}
document.querySelector('#editor-form') .addEventListener('submit', async event=>{
  event.preventDefault(); if(saving) return;
  const title=document.querySelector                  ('#entry-title') .value.trim();
  const body=document.querySelector                     ('#entry-body') .value;
  if(!title) return toast('Введите название');
  if(editing.kind==='note') {
    const existing=data.notes.find(n=>n.id===editing.id);
    if(existing) Object.assign(existing,{title,body,updatedAt:new Date().toISOString()});
    else data.notes.push({id:newId(),title,body,updatedAt:new Date().toISOString()});
  } else data.tasks.push({id:newId(),title,done:false,createdAt:new Date().toISOString()});
  editor.close(); if(await save()) toast(editing.kind==='note'?'Заметка сохранена':'Задача добавлена');
});
for(const id of ['close-editor','cancel-editor']) document.querySelector('#'+id) .addEventListener('click',()=>editor.close());
window.addEventListener('hashchange',()=>{page=getPage();query='';render(true);window.scrollTo(0,0);if(page==='settings' && ai.configured && !aiModels) void loadModels(false);});
window.addEventListener('beforeunload', event=>{ if(saving || saveError) {event.preventDefault();event.returnValue='';} });
document.addEventListener('keydown',event=>{
  const target=event.target               ;
  if(event.key==='/' && !target.closest('input,textarea,select,dialog')) {event.preventDefault();document.querySelector                  ('#search')?.focus();}
  if(event.key==='Escape') {document.querySelector('#sidebar')?.classList.remove('open');document.querySelector('[data-menu]')?.setAttribute('aria-expanded','false');}
});
try {
  const response=await fetch('/api/workspace'); if(!response.ok) throw new Error('Сервер вернул ошибку.');
  const saved=await response.json();
  if(!validateWorkspace(saved.data) || !Number.isSafeInteger(saved.revision)) throw new Error('Неверный формат данных сервера.');
  data=saved.data;revision=saved.revision;
} catch(e) { fatal=true; saveError='Не удалось загрузить данные. Проверьте окно Miyuneya.bat и обновите страницу. '+(e         ).message; }
try { ai=await aiRequest('/api/assistant'); } catch {}
render();
assistant=mountAssistant({ look, update:updateLook, status:()=>ai, toast });
if(page==='settings' && ai.configured) void loadModels(false);
