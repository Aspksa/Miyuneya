import { emptyWorkspace, validateWorkspace, searchNotes } from './model.js';
import { formatNoteDate, formatToday } from './calendar.js';
import type { Workspace } from './model.js';

type Page = 'home' | 'notes' | 'tasks' | 'settings';
const icons: Record<string, string> = {
  home: '<path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/>',
  notes: '<rect x="5" y="3" width="15" height="18" rx="2"/><path d="M9 8h7M9 12h7M9 16h4M3 7h3M3 12h3M3 17h3"/>',
  tasks: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="m8 8 1 1 2-2m2 2h3m-8 5 1 1 2-2m2 2h3"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M4 12h16m-5-5 5 5-5 5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  export: '<path d="M12 15V3m-4 4 4-4 4 4M5 13v7h14v-7"/>',
};
const icon = (name: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.notes}</svg>`;
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));
const newId = () => Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8, '0')).join('');
const app = document.querySelector<HTMLDivElement>('#app')!;
const editor = document.querySelector<HTMLDialogElement>('#editor')!;
let data: Workspace = emptyWorkspace();
let revision = 0;
let page: Page = getPage();
let query = '';
let taskFilter = 'active';
let saving = false;
let saveError = '';
let fatal = false;
let editing: { kind: 'note' | 'task'; id?: string } = { kind: 'note' };
let toastTimer: ReturnType<typeof setTimeout>;
const pageNames: Record<Page,string> = { home:'Главная', notes:'Заметки', tasks:'Задачи', settings:'Настройки' };
function getPage(): Page { const value = location.hash.slice(1); return ['home','notes','tasks','settings'].includes(value) ? value as Page : 'home'; }
function toast(message: string) {
  const el = document.querySelector<HTMLDivElement>('#toast')!;
  el.textContent = message; el.classList.add('visible'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 3500);
}
function applyTheme() {
  const dark = data.settings.theme === 'dark' || (data.settings.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
const shortDate = formatNoteDate;
function empty(title: string, description: string, kind: 'note' | 'task', label: string) {
  return `<div class="empty">${icon(kind === 'note' ? 'notes' : 'tasks')}<h3>${title}</h3><p>${description}</p><button class="button quiet" data-new="${kind}">${icon('plus')}${label}</button></div>`;
}
function noteRows() {
  return searchNotes(data.notes, query).slice(0,3).map(n => `<button class="note-row" data-edit="${escape(n.id)}"><b>${escape(n.title)}</b><p>${escape(n.body || 'Добавьте свои мысли в эту заметку.')}</p><small>${shortDate(n.updatedAt)}</small></button>`).join('') || empty('Место для ваших мыслей', 'Сохраните первую идею, полезную ссылку или наблюдение.', 'note', 'Создать заметку');
}
function taskRows(limit?: number) {
  const tasks = data.tasks.filter(t => t.title.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')) && (page === 'home' ? !t.done : taskFilter === 'all' || t.done === (taskFilter === 'done')));
  return (limit ? tasks.slice(0,limit) : tasks).map(t => `<div class="task-row ${t.done ? 'done' : ''}"><label><input type="checkbox" data-toggle="${escape(t.id)}" ${t.done ? 'checked' : ''} ${saving ? 'disabled' : ''}><span>${escape(t.title)}</span></label><button class="icon-button" data-delete-task="${escape(t.id)}" aria-label="Удалить задачу ${escape(t.title)}">×</button></div>`).join('') || empty(query ? 'Ничего не найдено' : taskFilter === 'done' && page !== 'home' ? 'Выполненных задач пока нет' : 'Освободите мысли для важного', query ? 'Попробуйте другой поисковый запрос.' : 'Добавьте небольшое дело — начните с одного шага.', 'task', 'Добавить задачу');
}
function home() {
  const pending = data.tasks.filter(t => !t.done).length;
  return `<div class="page-heading"><div><span class="eyebrow">ВАШЕ ЛИЧНОЕ ПРОСТРАНСТВО</span><h1>Добро пожаловать, ${escape(data.settings.name || 'Хозяин')}</h1></div><span class="date">${formatToday()}</span></div>
  <section class="hero"><div class="hero-text"><span class="eyebrow">✦ МЫСЛИ · ЗНАНИЯ · ВДОХНОВЕНИЕ</span><h2>Всё важное.<br>В <em>одном пространстве.</em></h2><p>Здесь ваши идеи обретают форму, а большие планы начинаются с маленьких шагов.</p><div class="hero-actions"><button class="button primary" data-new="note">${icon('plus')}Новая заметка</button><a class="button quiet" href="#tasks">Мои задачи ${icon('arrow')}</a></div></div><img class="hero-art" src="/fox.svg" alt="Золотая лисица отдыхает под луной" width="600" height="430"></section>
  <div class="stats"><a class="stat" href="#notes"><span class="stat-icon">${icon('notes')}</span><div><div class="stat-number">${data.notes.length}</div><div class="stat-label">Сохранено заметок</div></div></a><a class="stat" href="#tasks"><span class="stat-icon">${icon('tasks')}</span><div><div class="stat-number">${pending}</div><div class="stat-label">Задач в фокусе</div></div></a><button class="stat" data-show-done><span class="stat-icon">${icon('check')}</span><div><div class="stat-number">${data.tasks.length-pending}</div><div class="stat-label">Завершено дел</div></div></button></div>
  <div class="columns"><section><div class="section-head"><h2>Последние заметки</h2><a class="text-link" href="#notes">Все заметки ${icon('arrow')}</a></div><div class="panel">${noteRows()}</div></section><section><div class="section-head"><h2>Сейчас в фокусе</h2><button class="text-link" data-new="task">${icon('plus')}Добавить</button></div><div class="panel">${taskRows(4)}</div></section></div>`;
}
function notes() {
  const filtered = searchNotes(data.notes, query);
  return `<div class="page-heading"><div><span class="eyebrow">МЫСЛИ, К КОТОРЫМ ХОЧЕТСЯ ВЕРНУТЬСЯ</span><h1>Заметки <span class="date">/ ${data.notes.length}</span></h1></div><button class="button primary" data-new="note">${icon('plus')}Новая заметка</button></div><p class="page-description">Идеи, наблюдения и всё, что хочется сохранить рядом.</p><div class="note-grid">${filtered.map(n => `<article class="note-card"><div class="card-top">${icon('notes')}<button class="icon-button" data-delete-note="${escape(n.id)}" aria-label="Удалить заметку ${escape(n.title)}">×</button></div><h2>${escape(n.title)}</h2><p>${escape(n.body || 'Пока без текста.')}</p><div class="card-actions"><span>${shortDate(n.updatedAt)}</span><button class="text-link" data-edit="${escape(n.id)}">Открыть ${icon('arrow')}</button></div></article>`).join('') || empty(query ? 'Ничего не найдено' : 'Ваша первая страница', query ? 'Измените запрос или создайте новую заметку.' : 'Для большой идеи иногда достаточно одной строки.', 'note', 'Создать заметку')}</div>`;
}
function tasks() {
  return `<div class="page-heading"><div><span class="eyebrow">ОДИН ШАГ ЗА ДРУГИМ</span><h1>Мои задачи</h1></div><button class="button primary" data-new="task">${icon('plus')}Добавить задачу</button></div><p class="page-description">Меньше держать в голове. Больше внимания тому, что важно.</p><div class="task-controls" aria-label="Фильтр задач">${[['active','В фокусе'],['done','Выполнено'],['all','Все задачи']].map(([key,label]) => `<button data-filter="${key}" class="${taskFilter===key?'active':''}" aria-pressed="${taskFilter===key}">${label}</button>`).join('')}</div><div class="panel">${taskRows()}</div>`;
}
function settings() {
  return `<div class="page-heading"><div><span class="eyebrow">УДОБНО ИМЕННО ВАМ</span><h1>Настройки пространства</h1></div></div><p class="page-description">Немного личного — и всё на своих местах.</p><div class="settings-layout"><div><section class="settings-card"><h2>Как к вам обращаться?</h2><p>Это имя будет встречать вас на главной странице.</p><form id="name-form"><label class="field">Обращение<input name="name" maxlength="80" value="${escape(data.settings.name)}" placeholder="Хозяин" required></label><button class="button primary">Сохранить</button></form></section><section class="settings-card"><h2>Оформление</h2><p>Спокойная палитра, в которой легко сосредоточиться.</p><div class="themes">${[['light','Светлая'],['dark','Тёмная'],['auto','Как в системе']].map(([key,label])=>`<button class="theme-option ${data.settings.theme===key?'active':''}" data-theme="${key}" aria-pressed="${data.settings.theme===key}">${label}</button>`).join('')}</div></section><section class="settings-card"><h2>Ваши данные</h2><p>Заметки, задачи и настройки сохраняются в папке data рядом с проектом. Скачайте копию перед переносом или восстановите её из JSON-файла.</p><button class="button" data-export>${icon('export')}Экспортировать</button> <label class="button file-label">Восстановить копию<input type="file" id="import-file" accept=".json,application/json"></label></section></div><aside><section class="settings-card"><span class="version">MIYUNEYA / 0.2.0</span><h2>Место для вашего мира</h2><p>Первая версия личного пространства. Работает на вашем компьютере и доступна без интернета после подготовки Node.js.</p><div class="tech-list"><span>TypeScript</span><span>Node.js</span><span>HTML</span><span>CSS</span></div></section><section class="settings-card"><h2>Дальше — вместе</h2><p>Сейчас доступны заметки, задачи и настройки. Подключение ИИ и граф знаний можно добавить следующим этапом.</p><a class="text-link" href="https://github.com/Aspksa/Miyuneya" target="_blank" rel="noopener noreferrer">Репозиторий проекта ${icon('arrow')}</a></section></aside></div>`;
}
function render(focus = false) {
  applyTheme();
  const active = data.tasks.filter(t => !t.done).length;
  app.innerHTML = `<div class="shell"><aside class="sidebar" id="sidebar"><a class="brand" href="#home"><img src="/favicon.svg" alt="" width="37" height="37">Miyuneya</a><p class="brand-caption">ВАШ ТИХИЙ МИР</p><p class="nav-label">ПРОСТРАНСТВО</p><nav class="nav" aria-label="Основная навигация">${(['home','notes','tasks'] as Page[]).map(p=>`<a href="#${p}" class="${page===p?'active':''}" ${page===p?'aria-current="page"':''}>${icon(p)}${pageNames[p]}${p==='home'?'':`<span class="count">${p==='notes'?data.notes.length:active}</span>`}</a>`).join('')}</nav><div class="sidebar-bottom"><nav class="nav" aria-label="Параметры"><a href="#settings" class="${page==='settings'?'active':''}" ${page==='settings'?'aria-current="page"':''}>${icon('settings')}Настройки</a></nav><p class="sidebar-note"><span>Маленькие шаги.</span>Большие возможности.</p><div class="owner"><span class="owner-icon">✦</span><div><b>${escape(data.settings.name || 'Хозяин')}</b><small>Личное пространство</small></div></div></div></aside><div class="workspace"><header class="topbar"><button class="icon-button mobile-menu" aria-label="Открыть меню" aria-expanded="false" aria-controls="sidebar" data-menu>${icon('menu')}</button><div class="breadcrumb"><span>Пространство</span><span>/</span>${pageNames[page]}</div><label class="search">${icon('search')}<input id="search" aria-label="Поиск по заметкам и задачам" placeholder="Найти в своём пространстве" value="${escape(query)}" maxlength="200"><kbd>/</kbd></label><span class="top-status"><i class="dot"></i>${saveError?'Есть несохранённые изменения':saving?'Сохранение…':'На вашем компьютере'}</span><button class="icon-button" data-cycle-theme aria-label="Переключить тему">${icon('sun')}</button></header><main id="content" tabindex="-1">${saveError?`<div class="save-error" role="alert">${escape(saveError)} <button class="button" data-export>Скачать свою копию</button><button class="button" data-retry>Повторить сохранение</button></div>`:''}${({home,notes,tasks,settings})[page]()}<footer class="footer"><span><b class="spark">✦</b>Создано для ваших идей</span><span>Miyuneya · v0.2.0</span></footer></main></div></div>`;
  if (focus) document.querySelector<HTMLElement>('#content')?.focus();
}
async function save() {
  if (saving || fatal) { if (fatal) toast('Не удалось загрузить исходные данные. Перезапустите приложение.'); return false; }
  saving = true;
  try {
    const response = await fetch('/api/workspace', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({revision, data}) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Не удалось сохранить данные.');
    revision = result.revision; saveError = ''; return true;
  } catch (e) { saveError = (e as Error).message || 'Сервер недоступен. Проверьте окно запуска и сохраните резервную копию.'; toast('Изменения пока не сохранены'); return false; }
  finally { saving = false; render(); }
}
function showEditor(kind: 'note' | 'task', id?: string) {
  if (saving) { toast('Дождитесь завершения сохранения.'); return; }
  if (fatal) { toast('Сначала восстановите подключение к серверу.'); return; }
  editing = {kind,id};
  const note = id ? data.notes.find(n=>n.id===id) : undefined;
  document.querySelector('#editor-heading')!.textContent = kind==='task'?'Новая задача':note?'Редактировать заметку':'Новая заметка';
  const title = document.querySelector<HTMLInputElement>('#entry-title')!;
  const body = document.querySelector<HTMLTextAreaElement>('#entry-body')!;
  title.value = note?.title || ''; body.value = note?.body || ''; body.hidden = kind==='task';
  editor.showModal(); title.focus();
}
function download() {
  const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href=url; a.download=`Miyuneya-backup-${new Date().toISOString().slice(0,10)}.json`; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000); toast('Резервная копия подготовлена');
}
async function confirmDelete(title: string) {
  const dialog = document.querySelector<HTMLDialogElement>('#confirm')!;
  document.querySelector('#confirm-title')!.textContent=title;
  dialog.returnValue='cancel'; dialog.showModal();
  return new Promise<boolean>(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='delete'),{once:true}));
}
app.addEventListener('click', async event => {
  const target=(event.target as HTMLElement).closest<HTMLElement>('button,a,label');
  if (!target) return;
  if (target.dataset.new) return showEditor(target.dataset.new as 'note'|'task');
  if (target.dataset.edit) return showEditor('note',target.dataset.edit);
  if (target.hasAttribute('data-export')) return download();
  if (saving || fatal) return;
  if (target.hasAttribute('data-retry')) return void await save();
  if (target.dataset.deleteNote && await confirmDelete('Удалить заметку?')) { data.notes=data.notes.filter(n=>n.id!==target.dataset.deleteNote); if(await save()) toast('Заметка удалена'); }
  if (target.dataset.deleteTask && await confirmDelete('Удалить задачу?')) { data.tasks=data.tasks.filter(t=>t.id!==target.dataset.deleteTask); if(await save()) toast('Задача удалена'); }
  if (target.dataset.filter) { taskFilter=target.dataset.filter; render(); }
  if (target.hasAttribute('data-show-done')) { taskFilter='done'; if(page==='tasks') render(); else location.hash='tasks'; }
  if (target.dataset.theme) { data.settings.theme=target.dataset.theme as Workspace['settings']['theme']; applyTheme(); await save(); }
  if (target.hasAttribute('data-cycle-theme')) { data.settings.theme=document.documentElement.dataset.theme==='dark'?'light':'dark'; applyTheme(); await save(); }
  if (target.hasAttribute('data-menu')) { const isOpen=document.querySelector('#sidebar')!.classList.toggle('open'); target.setAttribute('aria-expanded',String(isOpen)); }
});
app.addEventListener('input', event => {
  const input=event.target as HTMLInputElement;
  if (input.id==='search') {
    query=input.value; const caret=input.selectionStart;
    if(page==='settings') { page='notes'; history.replaceState(null,'','#notes'); }
    render(); const search=document.querySelector<HTMLInputElement>('#search')!; search.focus(); search.setSelectionRange(caret,caret);
  }
});
app.addEventListener('change', async event => {
  const input=event.target as HTMLInputElement;
  if (input.dataset.toggle) {
    if (saving) return;
    const task=data.tasks.find(t=>t.id===input.dataset.toggle); if(task) {task.done=input.checked; await save();}
  }
  if (input.id==='import-file' && input.files?.[0]) {
    try {
      if(input.files[0].size>2_000_000) throw new Error('Копия больше 2 МБ.');
      const imported=JSON.parse(await input.files[0].text());
      if(!validateWorkspace(imported)) throw new Error('Это не резервная копия Miyuneya.');
      if(saving) throw new Error('Дождитесь завершения сохранения.');
      if(!await confirmDelete('Заменить данные резервной копией?')) return;
      data=imported; if(await save()) toast('Резервная копия восстановлена');
    } catch(e) { toast((e as Error).message); }
    finally { input.value=''; }
  }
});
app.addEventListener('submit', async event => {
  if ((event.target as HTMLElement).id!=='name-form') return;
  event.preventDefault(); if(saving) return;
  const name=String(new FormData(event.target as HTMLFormElement).get('name') || '').trim();
  if(!name) return toast('Введите обращение');
  data.settings.name=name; if(await save()) toast('Обращение сохранено');
});
document.querySelector('#editor-form')!.addEventListener('submit', async event=>{
  event.preventDefault(); if(saving) return;
  const title=document.querySelector<HTMLInputElement>('#entry-title')!.value.trim();
  const body=document.querySelector<HTMLTextAreaElement>('#entry-body')!.value;
  if(!title) return toast('Введите название');
  if(editing.kind==='note') {
    const existing=data.notes.find(n=>n.id===editing.id);
    if(existing) Object.assign(existing,{title,body,updatedAt:new Date().toISOString()});
    else data.notes.push({id:newId(),title,body,updatedAt:new Date().toISOString()});
  } else data.tasks.push({id:newId(),title,done:false,createdAt:new Date().toISOString()});
  editor.close(); if(await save()) toast(editing.kind==='note'?'Заметка сохранена':'Задача добавлена');
});
for(const id of ['close-editor','cancel-editor']) document.querySelector('#'+id)!.addEventListener('click',()=>editor.close());
window.addEventListener('hashchange',()=>{page=getPage();query='';render(true);window.scrollTo(0,0);});
window.addEventListener('beforeunload', event=>{ if(saving || saveError) {event.preventDefault();event.returnValue='';} });
document.addEventListener('keydown',event=>{
  const target=event.target as HTMLElement;
  if(event.key==='/' && !target.closest('input,textarea,select,dialog')) {event.preventDefault();document.querySelector<HTMLInputElement>('#search')?.focus();}
  if(event.key==='Escape') {document.querySelector('#sidebar')?.classList.remove('open');document.querySelector('[data-menu]')?.setAttribute('aria-expanded','false');}
});
try {
  const response=await fetch('/api/workspace'); if(!response.ok) throw new Error('Сервер вернул ошибку.');
  const saved=await response.json();
  if(!validateWorkspace(saved.data) || !Number.isSafeInteger(saved.revision)) throw new Error('Неверный формат данных сервера.');
  data=saved.data;revision=saved.revision;
} catch(e) { fatal=true; saveError='Не удалось загрузить данные. Проверьте окно Miyuneya.bat и обновите страницу. '+(e as Error).message; }
render();
