import { emptyWorkspace, validateWorkspace, combineEntries, defaultLook } from './model.js';
import { formatNoteDate } from './calendar.js';
import { mountAssistant, avatarSrc } from './assistant.js';
import { accents, radii, scales, accentName, loadAppearance, saveAppearance, applyAppearance, defaultAppearance } from './appearance.js';
import type { Appearance, Radius, Scale } from './appearance.js';
import type { Workspace, EntryFilter, AssistantLook } from './model.js';
import type { AssistantStatus, EntryKind } from './assistant.js';

type Page = 'notes' | 'settings';
const icons: Record<string, string> = {
  notes: '<rect x="5" y="3" width="15" height="18" rx="2"/><path d="M9 8h7M9 12h7M9 16h4M3 7h3M3 12h3M3 17h3"/>',
  tasks: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="m8 8 1 1 2-2m2 2h3m-8 5 1 1 2-2m2 2h3"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M4 12h16m-5-5 5 5-5 5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  export: '<path d="M12 15V3m-4 4 4-4 4 4M5 13v7h14v-7"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
  auto: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16Z" class="fill-solid"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.9 1.4-1.9-.5-1.2.3-2.4 1.6-2.4H17a4 4 0 0 0 4-4c0-5.2-4-9.7-9-9.7Z" class="fill"/><circle cx="7.5" cy="11" r="1.3" class="fill-solid"/><circle cx="10" cy="7" r="1.3" class="fill-solid"/><circle cx="14.5" cy="7" r="1.3" class="fill-solid"/>',
  // Two-tone navigation marks: a soft filled body with crisp strokes on top.
  navNotes: '<path d="M6.5 3.5h8l4 4v11a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z" class="fill"/><path d="M14.5 3.5v4h4"/><path d="M8 11h6M8 14.5h3.5"/><path d="m12.5 18 1.6 1.6L18 15.7" class="accent-stroke"/>',
  navSettings: '<path d="M12 3.2 14 5l2.6-.4.9 2.5 2.3 1.3-.6 2.6 1.3 2.3-1.9 1.8-.1 2.7-2.6.5-1.6 2.1L12 19.4l-2.4 1.2L8 18.5l-2.6-.5-.1-2.7-1.9-1.8L4.7 11l-.6-2.6 2.3-1.3.9-2.5L10 5Z" class="fill"/><circle cx="12" cy="12" r="3.2"/>',
};
const icon = (name: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.notes}</svg>`;
const navIcon = (name: string) => `<span class="nav-icon">${icon(name)}</span>`;
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));
const newId = () => Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8, '0')).join('');
const app = document.querySelector<HTMLDivElement>('#app')!;
const editor = document.querySelector<HTMLDialogElement>('#editor')!;
let data: Workspace = emptyWorkspace();
let revision = 0;
let page: Page = getPage();
let query = '';
let filter: EntryFilter = 'all';
let saving = false;
let saveError = '';
let fatal = false;
let editing: { kind: 'note' | 'task'; id?: string } = { kind: 'note' };
let toastTimer: ReturnType<typeof setTimeout>;
let ai: AssistantStatus = { configured: false, keyHint: '', model: '', context: true, customAvatar: null };
let saveAgain = false;
let appearance: Appearance = loadAppearance();
let aiModels: string[] | null = null;
let aiBusy = false;
let assistant: ReturnType<typeof mountAssistant> | undefined;
const pageNames: Record<Page,string> = { notes:'Заметки и задачи', settings:'Настройки' };
// Old #home and #tasks links land on the shared list.
function getPage(): Page { return location.hash.slice(1) === 'settings' ? 'settings' : 'notes'; }
function toast(message: string) {
  const el = document.querySelector<HTMLDivElement>('#toast')!;
  el.textContent = message; el.classList.add('visible'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 3500);
}
function applyTheme() {
  const dark = data.settings.theme === 'dark' || (data.settings.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  applyAppearance(appearance, dark);
}
function setAppearance(change: Partial<Appearance>) {
  appearance = { ...appearance, ...change }; saveAppearance(appearance); applyTheme(); render();
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
const shortDate = formatNoteDate;
function empty(title: string, description: string, kind: 'note' | 'task', label: string) {
  return `<div class="empty">${icon(kind === 'note' ? 'notes' : 'tasks')}<h3>${title}</h3><p>${description}</p><button class="button quiet" data-new="${kind}">${icon('plus')}${label}</button></div>`;
}
function noteRow(n: Workspace['notes'][number]) {
  return `<div class="task-row note-entry">${icon('notes')}<button class="note-open" data-edit="${escape(n.id)}"><b>${escape(n.title)}</b>${n.body?`<p>${escape(n.body)}</p>`:''}</button><small>${shortDate(n.updatedAt)}</small><button class="icon-button" data-delete-note="${escape(n.id)}" aria-label="Удалить заметку ${escape(n.title)}">×</button></div>`;
}
function taskRow(t: Workspace['tasks'][number]) {
  return `<div class="task-row ${t.done ? 'done' : ''}"><label><input type="checkbox" data-toggle="${escape(t.id)}" ${t.done ? 'checked' : ''} ${saving ? 'disabled' : ''}><span>${escape(t.title)}</span></label><small>${shortDate(t.createdAt)}</small><button class="icon-button" data-delete-task="${escape(t.id)}" aria-label="Удалить задачу ${escape(t.title)}">×</button></div>`;
}
function notes() {
  const rows = combineEntries(data, query, filter).map(e => e.kind === 'note' ? noteRow(e.item) : taskRow(e.item)).join('');
  const blank = query ? empty('Ничего не найдено', 'Попробуйте другой поисковый запрос.', filter === 'notes' ? 'note' : 'task', filter === 'notes' ? 'Создать заметку' : 'Добавить задачу')
    : filter === 'notes' ? empty('Заметок пока нет', 'Сохраните идею, ссылку или наблюдение.', 'note', 'Создать заметку')
    : filter === 'done' ? empty('Выполненных задач пока нет', 'Отмеченные задачи появятся здесь.', 'task', 'Добавить задачу')
    : empty('Здесь пока пусто', 'Добавьте заметку или задачу.', 'task', 'Добавить задачу');
  return `<div class="page-heading"><h1>Заметки и задачи</h1><div class="heading-actions"><button class="button" data-new="note">${icon('plus')}Заметка</button><button class="button primary" data-new="task">${icon('plus')}Задача</button></div></div><div class="task-controls" aria-label="Фильтр">${([['all','Всё'],['notes','Заметки'],['active','Задачи'],['done','Выполнено']] as [EntryFilter,string][]).map(([key,label]) => `<button data-filter="${key}" class="${filter===key?'active':''}" aria-pressed="${filter===key}">${label}</button>`).join('')}</div><div class="panel">${rows || blank}</div>`;
}
const look = (): Required<AssistantLook> => ({ ...defaultLook(), ...data.settings.assistant });
function aiCard() {
  const models = aiModels ? [...new Set([ai.model, ...aiModels])] : null;
  const modelField = models
    ? `<select id="ai-model" ${aiBusy?'disabled':''}>${models.map(m=>`<option value="${escape(m)}" ${m===ai.model?'selected':''}>${escape(m)}</option>`).join('')}</select>`
    : `<input id="ai-model" value="${escape(ai.model)}" maxlength="200" autocomplete="off" spellcheck="false" placeholder="например, openai/gpt-oss-120b" ${aiBusy?'disabled':''}>`;
  return `<section class="settings-card ai-card"><h2>Помощница и cloud.ru</h2><p>Миюнэя отвечает в чате через модели cloud.ru Foundation Models. Ключ хранится только на этом компьютере в <code>data/assistant.json</code>, не попадает в браузер и резервные копии; запросы к cloud.ru отправляет локальный сервер.</p><div class="ai-status ${ai.configured?'on':''}"><i class="dot"></i>${ai.configured?`Подключено · ключ ${escape(ai.keyHint)}`:'Ключ не сохранён'}</div><form id="ai-form" autocomplete="off"><label class="field">API-ключ cloud.ru<input id="ai-key" type="password" maxlength="512" autocomplete="new-password" spellcheck="false" placeholder="${ai.configured?'Сохранён. Введите новый, чтобы заменить':'Вставьте ключ из личного кабинета cloud.ru'}" ${aiBusy?'disabled':''}></label><label class="field">Модель${modelField}</label><div class="ai-actions"><button class="button primary" type="submit" ${aiBusy?'disabled':''}>Сохранить</button><button class="button" type="button" data-ai-models ${aiBusy||!ai.configured?'disabled':''}>${aiModels?'Обновить список моделей':'Загрузить список моделей'}</button>${ai.configured?`<button class="button quiet danger" type="button" data-ai-forget ${aiBusy?'disabled':''}>Удалить ключ</button>`:''}</div></form><label class="switch ai-context"><input type="checkbox" id="ai-context" ${ai.context?'checked':''} ${aiBusy?'disabled':''}><span>Помощница видит заметки и задачи. Они отправляются в cloud.ru вместе с вопросом, чтобы она могла найти запись, напомнить о делах и добавить задачу.</span></label><div class="ai-look"><span class="face"><img src="${avatarSrc(look(),ai)}" alt="" decoding="async"></span><label class="switch"><input type="checkbox" id="ai-avatar-visible" ${look().hidden?'':'checked'}><span>Показывать аватар на экране</span></label></div><p class="ai-hint">Перетаскивайте аватар мышью куда удобно. Левая кнопка открывает чат, правая — меню: образ (можно загрузить свой), размер, прозрачность, анимация и прилипание к краям.</p></section>`;
}
function appearanceCard() {
  const custom = accentName(appearance.accent) === 'Свой';
  const group = (title: string, hint: string, body: string, extra = '') => `<div class="look-group"><div class="look-label"><b>${title}</b>${extra}<span>${hint}</span></div>${body}</div>`;
  const option = (attr: string, key: string, selected: boolean, preview: string, label: string) => `<button type="button" class="look-option ${selected?'active':''}" ${attr}="${key}" aria-pressed="${selected}">${preview}<span>${label}</span></button>`;
  return `<section class="settings-card look-card"><div class="card-head"><h2>${icon('palette')}Внешний вид</h2><button type="button" class="text-link" data-appearance-reset>Сбросить</button></div><p>Тема, цвет, скругления и размер интерфейса. Всё меняется сразу. Тема сохраняется в пространстве, остальное — в этом браузере.</p>`
    + group('Тема', 'Светлая, тёмная или как в системе', `<div class="look-options">${([['light','Светлая','sun'],['dark','Тёмная','moon'],['auto','Как в системе','auto']] as const).map(([key,label,name])=>option('data-theme',key,data.settings.theme===key,`<span class="theme-preview ${key}">${icon(name)}</span>`,label)).join('')}</div>`)
    + group('Акцентный цвет', 'Цвет кнопок, отметок и аватара. «Свой» открывает палитру.', `<div class="swatches" role="radiogroup" aria-label="Акцентный цвет">${accents.map(([name,hex])=>`<button type="button" class="swatch" role="radio" aria-checked="${appearance.accent===hex}" aria-label="${name}" title="${name}" data-accent="${hex}" data-swatch="${hex}"></button>`).join('')}<label class="swatch custom" title="Свой цвет" aria-checked="${custom}" ${custom?`data-swatch="${appearance.accent}"`:''}><input type="color" id="accent-custom" value="${appearance.accent}" aria-label="Свой цвет"></label></div>`, `<em class="accent-name"><i data-swatch="${appearance.accent}"></i>${escape(accentName(appearance.accent))}</em>`)
    + group('Скругление', 'Углы карточек и кнопок', `<div class="look-options">${radii.map(([key,label])=>option('data-radius',key,appearance.radius===key,`<span class="radius-preview ${key}"></span>`,label)).join('')}</div>`)
    + group('Масштаб', 'Размер текста и элементов всего приложения', `<div class="look-options">${scales.map(([key,label])=>option('data-scale',key,appearance.scale===key,`<span class="scale-preview ${key}">Aa</span>`,label)).join('')}</div>`)
    + `</section>`;
}
function settings() {
  return `<div class="page-heading"><div><span class="eyebrow">УДОБНО ИМЕННО ВАМ</span><h1>Настройки пространства</h1></div></div><p class="page-description">Немного личного — и всё на своих местах.</p><div class="settings-layout"><div>${appearanceCard()}<section class="settings-card"><h2>Ваши данные</h2><p>Заметки, задачи и настройки сохраняются в папке data рядом с проектом. Скачайте копию перед переносом или восстановите её из JSON-файла.</p><button class="button" data-export>${icon('export')}Экспортировать</button> <label class="button file-label">Восстановить копию<input type="file" id="import-file" accept=".json,application/json"></label></section>${aiCard()}</div><aside><section class="settings-card"><span class="version">MIYUNEYA / 0.2.0</span><h2>Место для вашего мира</h2><p>Первая версия личного пространства. Работает на вашем компьютере и доступна без интернета после подготовки Node.js.</p><div class="tech-list"><span>TypeScript</span><span>Node.js</span><span>HTML</span><span>CSS</span></div></section><section class="settings-card"><h2>Дальше — вместе</h2><p>Сейчас доступны заметки и задачи в одном списке, настройки и помощница с чатом через cloud.ru. Граф знаний можно добавить следующим этапом.</p><a class="text-link" href="https://github.com/Aspksa/Miyuneya" target="_blank" rel="noopener noreferrer">Репозиторий проекта ${icon('arrow')}</a></section></aside></div>`;
}
function render(focus = false) {
  applyTheme();
  const count = data.notes.length + data.tasks.filter(t => !t.done).length;
  app.innerHTML = `<div class="shell"><aside class="sidebar" id="sidebar"><a class="brand" href="#notes"><img src="/favicon.svg" alt="" width="37" height="37">Miyuneya</a><p class="brand-caption">ВАШ ТИХИЙ МИР</p><p class="nav-label">ПРОСТРАНСТВО</p><nav class="nav" aria-label="Основная навигация"><a href="#notes" class="${page==='notes'?'active':''}" ${page==='notes'?'aria-current="page"':''}>${navIcon('navNotes')}<span class="nav-text">${pageNames.notes}</span><span class="count">${count}</span></a></nav><div class="sidebar-bottom"><nav class="nav" aria-label="Параметры"><a href="#settings" class="${page==='settings'?'active':''}" ${page==='settings'?'aria-current="page"':''}>${navIcon('navSettings')}<span class="nav-text">Настройки</span></a></nav></div></aside><div class="workspace"><header class="topbar"><button class="icon-button mobile-menu" aria-label="Открыть меню" aria-expanded="false" aria-controls="sidebar" data-menu>${icon('menu')}</button><div class="breadcrumb"><span>Пространство</span><span>/</span>${pageNames[page]}</div><label class="search">${icon('search')}<input id="search" aria-label="Поиск по заметкам и задачам" placeholder="Найти в своём пространстве" value="${escape(query)}" maxlength="200"><kbd>/</kbd></label><span class="top-status"><i class="dot"></i>${saveError?'Есть несохранённые изменения':saving?'Сохранение…':'На вашем компьютере'}</span><button class="icon-button" data-cycle-theme aria-label="Переключить тему">${icon('sun')}</button></header><main id="content" tabindex="-1">${saveError?`<div class="save-error" role="alert">${escape(saveError)} <button class="button" data-export>Скачать свою копию</button><button class="button" data-retry>Повторить сохранение</button></div>`:''}${({notes,settings})[page]()}</main></div></div>`;
  for (const el of app.querySelectorAll<HTMLElement>('[data-swatch]')) el.style.setProperty('--swatch', el.dataset.swatch!);
  if (focus) document.querySelector<HTMLElement>('#content')?.focus();
}
// A change made while another save is in flight is sent right after it instead of being dropped.
function persist() { if (saving) saveAgain = true; else void save(); }
async function save() {
  if (saving || fatal) { if (fatal) toast('Не удалось загрузить исходные данные. Перезапустите приложение.'); return false; }
  saving = true;
  try {
    const response = await fetch('/api/workspace', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({revision, data}) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Не удалось сохранить данные.');
    revision = result.revision; saveError = ''; return true;
  } catch (e) { saveError = (e as Error).message || 'Сервер недоступен. Проверьте окно запуска и сохраните резервную копию.'; toast('Изменения пока не сохранены'); return false; }
  finally { saving = false; render(); if (saveAgain) { saveAgain = false; void save(); } }
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
  if (target.dataset.accent) return setAppearance({accent:target.dataset.accent});
  if (target.dataset.radius) return setAppearance({radius:target.dataset.radius as Radius});
  if (target.dataset.scale) return setAppearance({scale:target.dataset.scale as Scale});
  if (target.hasAttribute('data-appearance-reset')) { appearance=defaultAppearance(); saveAppearance(appearance); applyTheme(); render(); toast('Оформление сброшено'); return; }
  if (saving || fatal) return;
  if (target.hasAttribute('data-retry')) return void await save();
  if (target.dataset.deleteNote && await confirmDelete('Удалить заметку?')) { data.notes=data.notes.filter(n=>n.id!==target.dataset.deleteNote); if(await save()) toast('Заметка удалена'); }
  if (target.dataset.deleteTask && await confirmDelete('Удалить задачу?')) { data.tasks=data.tasks.filter(t=>t.id!==target.dataset.deleteTask); if(await save()) toast('Задача удалена'); }
  if (target.dataset.filter) { filter=target.dataset.filter as EntryFilter; render(); }
  if (target.dataset.theme) { data.settings.theme=target.dataset.theme as Workspace['settings']['theme']; applyTheme(); await save(); }
  if (target.hasAttribute('data-cycle-theme')) { data.settings.theme=document.documentElement.dataset.theme==='dark'?'light':'dark'; applyTheme(); await save(); }
  if (target.hasAttribute('data-ai-models')) return void await loadModels(true);
  if (target.hasAttribute('data-ai-forget') && await confirmDelete('Удалить ключ cloud.ru?')) { if(await saveAi({apiKey:null})) { aiModels=null; toast('Ключ удалён'); } }
  if (target.hasAttribute('data-menu')) { const isOpen=document.querySelector('#sidebar')!.classList.toggle('open'); target.setAttribute('aria-expanded',String(isOpen)); }
});
app.addEventListener('input', event => {
  const input=event.target as HTMLInputElement;
  // Live preview while the palette is open; the choice is stored on change.
  if (input.id==='accent-custom') { applyAppearance({...appearance,accent:input.value},document.documentElement.dataset.theme==='dark'); return; }
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
  if (input.id==='accent-custom') return setAppearance({accent:input.value.toLowerCase()});
  if (input.id==='ai-avatar-visible') return updateLook({hidden:!input.checked});
  if (input.id==='ai-context') { if(await saveAi({context:input.checked})) toast(input.checked?'Помощница видит заметки и задачи':'Доступ к заметкам и задачам выключен'); return; }
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
  if ((event.target as HTMLElement).id!=='ai-form') return;
  event.preventDefault();
  const key=document.querySelector<HTMLInputElement>('#ai-key')!.value.trim();
  const model=document.querySelector<HTMLInputElement|HTMLSelectElement>('#ai-model')!.value.trim();
  if(!key && !ai.configured) return toast('Вставьте API-ключ cloud.ru');
  const change: { apiKey?: string; model?: string } = {};
  if(key) change.apiKey=key;
  if(model) change.model=model;
  if(await saveAi(change)) { toast('Подключение cloud.ru сохранено'); if(key || !aiModels) await loadModels(false,true); }
});
async function aiRequest(path: string, init?: RequestInit) {
  const response=await fetch(path,init); const result=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(result.error || 'Сервер вернул ошибку.');
  return result;
}
async function saveAi(change: { apiKey?: string | null; model?: string; context?: boolean }) {
  if(aiBusy) return false;
  aiBusy=true; render();
  try { ai=await aiRequest('/api/assistant',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(change)}); return true; }
  catch(e) { toast(e instanceof TypeError?'Сервер недоступен.':(e as Error).message); return false; }
  finally { aiBusy=false; render(); assistant?.refresh(); }
}
// loud: the user pressed the button; afterSave: a fresh key was just stored; otherwise stay quiet.
async function loadModels(loud: boolean, afterSave = false) {
  if(aiBusy || !ai.configured) return;
  aiBusy=true; render();
  try { aiModels=(await aiRequest('/api/assistant/models')).models; if(loud) toast(aiModels!.length?`Доступно моделей: ${aiModels!.length}`:'cloud.ru не вернул список моделей'); }
  catch(e) { if(loud) toast(e instanceof TypeError?'Сервер недоступен.':(e as Error).message); else if(afterSave) toast('Ключ сохранён, но список моделей не загрузился: '+(e as Error).message); }
  finally { aiBusy=false; render(); }
}
function updateLook(change: Partial<AssistantLook>) {
  data.settings.assistant={...look(),...change};
  assistant?.refresh();
  if(page==='settings') render();
  persist();
}
// Entries the assistant creates from the chat. Limits match validateWorkspace.
function addTask(title: string) {
  if (fatal || data.tasks.length>=5000) { toast('Не удалось добавить задачу'); return null; }
  const id=newId(); data.tasks.push({id,title:title.trim().slice(0,200) || 'Задача',done:false,createdAt:new Date().toISOString()});
  render(); persist(); return id;
}
function addNote(title: string, body: string) {
  if (fatal || data.notes.length>=5000) { toast('Не удалось сохранить заметку'); return null; }
  const id=newId(); data.notes.push({id,title:title.trim().slice(0,200) || 'Заметка',body:body.slice(0,100000),updatedAt:new Date().toISOString()});
  render(); persist(); return id;
}
function removeEntry(kind: EntryKind, id: string) {
  const before=data.notes.length+data.tasks.length;
  if (kind==='task') data.tasks=data.tasks.filter(t=>t.id!==id); else data.notes=data.notes.filter(n=>n.id!==id);
  const changed=before!==data.notes.length+data.tasks.length;
  if (changed) { render(); persist(); }
  return changed;
}
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
window.addEventListener('hashchange',()=>{page=getPage();query='';render(true);window.scrollTo(0,0);if(page==='settings' && ai.configured && !aiModels) void loadModels(false);});
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
try { ai=await aiRequest('/api/assistant'); } catch {}
render();
assistant=mountAssistant({ look, update:updateLook, status:()=>ai, setStatus:value=>{ai=value;if(page==='settings')render();}, toast, addTask, addNote, remove:removeEntry });
if(page==='settings' && ai.configured) void loadModels(false);
