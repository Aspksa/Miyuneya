import { mountWorkbench } from './workbench.js';
import { matchesTask,taskBlockers,editedRepeat,mergeCanonicalTasks } from './productivity.js';
import type { ViewFilter } from './productivity.js';
import { createDisk } from './disk.js';
import { emptyWorkspace, validateWorkspace, combineEntries, defaultLook, validLocalDate } from './model.js';
import { formatNoteDate, formatDueDate, localDateKey } from './calendar.js';
import { avatarSrc } from './assistant.js';
import { mountMemory, brainIcon } from './memory.js';
import type { MemoryView } from './memory.js';
import { accents, radii, scales, accentName, loadAppearance, saveAppearance, applyAppearance, defaultAppearance } from './appearance.js';
import type { Appearance, Radius, Scale } from './appearance.js';
import type { Workspace, EntryFilter, AssistantLook } from './model.js';
import type { AssistantStatus, EntryKind } from './assistant.js';

type Page = 'notes' | 'disk' | 'settings';
const icons: Record<string, string> = {
  home: '<path d="m3 11 9-8 9 8v9h-6v-6H9v6H3z"/>',
  disk: '<path d="M3 7h7l2 2h9v11H3z"/><path d="M3 7V4h7l2 3"/>',
  notes: '<rect x="5" y="3" width="15" height="18" rx="2"/><path d="M9 8h7M9 12h7M9 16h4M3 7h3M3 12h3M3 17h3"/>',
  tasks: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="m8 8 1 1 2-2m2 2h3m-8 5 1 1 2-2m2 2h3"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  star: '<path d="m12 4.3 2.3 4.9 5.2.7-3.8 3.7.9 5.3-4.6-2.5-4.6 2.5.9-5.3L4.5 9.9l5.2-.7Z"/>',
  arrow: '<path d="M4 12h16m-5-5 5 5-5 5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  export: '<path d="M12 15V3m-4 4 4-4 4 4M5 13v7h14v-7"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
  auto: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16Z" class="fill-solid"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.9 1.4-1.9-.5-1.2.3-2.4 1.6-2.4H17a4 4 0 0 0 4-4c0-5.2-4-9.7-9-9.7Z" class="fill"/><circle cx="7.5" cy="11" r="1.3" class="fill-solid"/><circle cx="10" cy="7" r="1.3" class="fill-solid"/><circle cx="14.5" cy="7" r="1.3" class="fill-solid"/>',
  brain: brainIcon,
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
let filter:ViewFilter='all';let group='';let committedData='';let restoring=false;let workbench:ReturnType<typeof mountWorkbench>;
let saving = false;
let saveError = '';
let fatal = false;
let editing: { kind: 'note' | 'task'; id?: string } = { kind: 'note' };
let toastTimer: ReturnType<typeof setTimeout>;
let ai: AssistantStatus = { configured: false, keyHint: '', model: '', smartModel: '', embedModel: '', context: true, customAvatar: null };
let saveAgain = false;
let savingPromise: Promise<boolean> | null = null;
const disk = createDisk({render:()=>{if(page!=='settings')render();},toast,addNote,draft:text=>{assistant?.draft(text);},panel:(id,name,body)=>workbench.filePanel(id,name,body),sync:reloadWorkspace});
let appearance: Appearance = loadAppearance();
let aiModels: string[] | null = null;
let aiBusy = false;
let assistant: { draft(text: string): void; refresh(): void } | undefined;
let memoryMode = { enabled: true, private: false };
const pageNames: Record<Page,string> = { notes:'Заметки и задачи', disk:'Диск', settings:'Настройки' };
// The existing workbench is the single source of truth for sidebar + panel geometry.
const sidebarCollapsed=()=>workbench?.prefs().collapsed===true;

// Old #home and #tasks links land on the shared list.
function getPage(): Page { const hash = location.hash.slice(1); return hash === 'settings' || hash === 'disk' ? hash : 'notes'; }
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
  return `<div class="task-row note-entry">${icon('notes')}<button class="note-open" data-edit="${escape(n.id)}"><b>${escape(n.title)}</b>${n.body?`<p>${escape(n.body.slice(0,220))}</p>`:''}</button><button class="icon-button note-pin ${n.pinned?'pinned':''}" data-pin-note="${escape(n.id)}" aria-label="${n.pinned?'Открепить':'Закрепить'} заметку" aria-pressed="${!!n.pinned}">${icon('star')}</button><small>${shortDate(n.updatedAt)}</small><button class="icon-button" data-delete-note="${escape(n.id)}" aria-label="Удалить заметку ${escape(n.title)}">×</button></div>`;
}
function taskRow(t: Workspace['tasks'][number]) {
  const overdue=!t.done && t.dueDate && t.dueDate<localDateKey();
  return `<div class="task-row ${t.done?'done':''}"><input type="checkbox" data-toggle="${escape(t.id)}" aria-label="Выполнить: ${escape(t.title)}" ${t.done?'checked':''} ${saving?'disabled':''}><button class="task-open" data-edit-task="${escape(t.id)}"><b>${escape(t.title)}</b>${t.details?`<p>${escape(t.details.slice(0,200))}</p>`:''}<span class="task-meta">${t.dueDate?`<span class="meta-due ${overdue?'overdue':''}">${overdue?'Просрочено · ':''}${escape(formatDueDate(t.dueDate))}</span>`:''}${t.priority==='high'?'<span class="meta-flag">Высокий</span>':''}${t.group?`<span class="meta-group">${escape(t.group)}</span>`:''}${data.tasks.some(c=>c.parentId===t.id)?`<span class="meta-quiet">Чек-лист ${data.tasks.filter(c=>c.parentId===t.id&&c.done).length}/${data.tasks.filter(c=>c.parentId===t.id).length}</span>`:''}${t.parentId?`<span class="meta-quiet">↳ ${escape(data.tasks.find(p=>p.id===t.parentId)?.title.slice(0,40)||'Подзадача')}</span>`:''}${t.repeat?'<span class="meta-quiet">↻ Повторяется</span>':''}${taskBlockers(data.tasks,t).length&&!t.done?'<span class="meta-quiet">Ждёт другие задачи</span>':''}</span></button><button class="icon-button" data-delete-task="${escape(t.id)}" aria-label="Удалить задачу ${escape(t.title)}">×</button></div>`;
}
function notes() {
  const baseFilter=['today','overdue','week'].includes(filter)?'active':filter;
  const rows = combineEntries(data, query, baseFilter as EntryFilter).filter(e=>e.kind==='note'?!group:matchesTask(e.item,filter,group)).map(e => e.kind === 'note' ? noteRow(e.item) : taskRow(e.item)).join('');
  const blank = query ? empty('Ничего не найдено', 'Попробуйте другой поисковый запрос.', filter === 'notes' ? 'note' : 'task', filter === 'notes' ? 'Создать заметку' : 'Добавить задачу')
    : filter === 'notes' ? empty('Заметок пока нет', 'Сохраните идею, ссылку или наблюдение.', 'note', 'Создать заметку')
    : filter === 'done' ? empty('Выполненных задач пока нет', 'Отмеченные задачи появятся здесь.', 'task', 'Добавить задачу')
    : empty('Здесь пока пусто', 'Добавьте заметку или задачу.', 'task', 'Добавить задачу');
  return `<div class="page-heading"><h1>Заметки и задачи</h1><div class="heading-actions"><button class="button" data-new="note">${icon('plus')}Заметка</button><button class="button primary" data-new="task">${icon('plus')}Задача</button></div></div><div class="task-controls" aria-label="Фильтр">${([['all','Всё'],['notes','Заметки'],['active','Задачи'],['done','Выполнено'],['today','Сегодня'],['overdue','Просрочено'],['week','На неделю']] as [ViewFilter,string][]).map(([key,label]) => `<button data-filter="${key}" class="${filter===key?'active':''}" aria-pressed="${filter===key}">${label}</button>`).join('')}<label class="group-filter">Группа <select data-task-group-filter aria-label="Фильтр по группе"><option value="">Все группы</option>${[...new Set(data.tasks.map(t=>t.group).filter(Boolean))].sort().map(g=>`<option value="${escape(g!)}" ${g===group?'selected':''}>${escape(g!)}</option>`).join('')}</select></label></div><div class="panel">${rows || blank}</div>${query?`<section class="global-documents"><h2>Документы · поиск по названию</h2>${disk.searchHtml(query)}</section>`:''}`;
}
const look = (): Required<AssistantLook> => ({ ...defaultLook(), ...data.settings.assistant });
function aiCard() {
  const models = aiModels ? [...new Set([ai.model, ...aiModels])] : null;
  const modelField = models
    ? `<select id="ai-model" ${aiBusy?'disabled':''}>${models.map(m=>`<option value="${escape(m)}" ${m===ai.model?'selected':''}>${escape(m)}</option>`).join('')}</select>`
    : `<input id="ai-model" value="${escape(ai.model)}" maxlength="200" autocomplete="off" spellcheck="false" placeholder="например, openai/gpt-oss-120b" ${aiBusy?'disabled':''}>`;
  return `<section class="settings-card ai-card"><h2>Помощница и cloud.ru</h2><p>Миюнэя отвечает в чате через модели cloud.ru Foundation Models. Ключ хранится только на этом компьютере в <code>data/assistant.json</code>, не попадает в браузер и резервные копии; запросы к cloud.ru отправляет локальный сервер.</p><div class="ai-status ${ai.configured?'on':''}"><i class="dot"></i>${ai.configured?`Подключено · ключ ${escape(ai.keyHint)}`:'Ключ не сохранён'}</div><form id="ai-form" autocomplete="off"><label class="field">API-ключ cloud.ru<input id="ai-key" type="password" maxlength="512" autocomplete="new-password" spellcheck="false" placeholder="${ai.configured?'Сохранён. Введите новый, чтобы заменить':'Вставьте ключ из личного кабинета cloud.ru'}" ${aiBusy?'disabled':''}></label><label class="field">Модель для обычных вопросов${modelField}</label><label class="field">Модель для сложных вопросов<input id="ai-smart" list="ai-models-list" value="${escape(ai.smartModel)}" maxlength="200" autocomplete="off" spellcheck="false" placeholder="самая сильная модель; пусто — та же" ${aiBusy?'disabled':''}>${models?`<datalist id="ai-models-list">${models.map(m=>`<option value="${escape(m)}"></option>`).join('')}</datalist>`:''}<small class="field-hint">Ей достаются вопросы, где нужно рассуждать, сравнивать и считать, а ещё планы целей, сон памяти и размышления. Простые вопросы остаются быстрой модели.</small></label><label class="field">Модель для поиска по смыслу<input id="ai-embed" value="${escape(ai.embedModel)}" maxlength="200" autocomplete="off" spellcheck="false" placeholder="например, BAAI/bge-m3; пусто — искать только по словам" ${aiBusy?'disabled':''}></label><div class="ai-actions"><button class="button primary" type="submit" ${aiBusy?'disabled':''}>Сохранить</button><button class="button" type="button" data-ai-models ${aiBusy||!ai.configured?'disabled':''}>${aiModels?'Обновить список моделей':'Загрузить список моделей'}</button>${ai.configured?`<button class="button quiet danger" type="button" data-ai-forget ${aiBusy?'disabled':''}>Удалить ключ</button>`:''}</div></form><label class="switch ai-context"><input type="checkbox" id="ai-context" ${ai.context?'checked':''} ${aiBusy?'disabled':''}><span>Помощница видит заметки и задачи. Они отправляются в cloud.ru вместе с вопросом, чтобы она могла найти запись, напомнить о делах и добавить задачу.</span></label><div class="ai-look"><span class="face"><img src="${avatarSrc(look(),ai)}" alt="" decoding="async"></span><label class="switch"><input type="checkbox" id="ai-avatar-visible" ${look().hidden?'':'checked'}><span>Показывать аватар на экране</span></label></div><p class="ai-hint">Перетаскивайте аватар мышью куда удобно. Левая кнопка открывает чат, правая — меню: образ (можно загрузить свой), размер, прозрачность, анимация и прилипание к краям.</p></section>`;
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
  return `<div class="page-heading"><div><span class="eyebrow">УДОБНО ИМЕННО ВАМ</span><h1>Настройки пространства</h1></div></div><p class="page-description">Немного личного — и всё на своих местах.</p><div class="settings-layout"><div>${appearanceCard()}<section class="settings-card"><h2>Ваши данные</h2><p>Заметки, задачи и настройки сохраняются в папке data рядом с проектом. JSON-копия содержит заметки, задачи и настройки. Документы хранятся отдельно в data/disk: для их резервной копии скопируйте эту папку при остановленном приложении.</p><button class="button" data-export>${icon('export')}Экспортировать</button> <label class="button file-label">Восстановить копию<input type="file" id="import-file" accept=".json,application/json"></label></section>${aiCard()}${workbench.automationCard()}</div><aside><section class="settings-card"><span class="version">MIYUNEYA / 0.5.1</span><h2>Место для вашего мира</h2><p>Личное пространство для заметок, задач и документов. Работает на вашем компьютере и доступна без интернета после подготовки Node.js.</p><div class="tech-list"><span>TypeScript</span><span>Node.js</span><span>HTML</span><span>CSS</span></div></section><section class="settings-card"><h2>Дальше — вместе</h2><p>Доступны заметки, задачи, диск документов, настройки и помощница с чатом через cloud.ru и собственной памятью: значок мозга вверху справа.</p><a class="text-link" href="https://github.com/Aspksa/Miyuneya" target="_blank" rel="noopener noreferrer">Репозиторий проекта ${icon('arrow')}</a></section></aside></div>`;
}
function render(focus = false) {
  applyTheme();
  const count = data.notes.length + data.tasks.filter(t => !t.done).length;
  app.innerHTML = `<div class="shell ${sidebarCollapsed()?'miyu-nav-compact':''}"><aside class="sidebar" id="sidebar"><button class="miyu-nav-collapse" type="button" data-collapse-nav aria-pressed="${sidebarCollapsed()}" aria-label="${sidebarCollapsed()?'Развернуть боковое меню':'Свернуть боковое меню'}"><span class="miyu-collapse-icon">☰</span><span>Свернуть меню</span></button><nav class="nav" aria-label="Основная навигация"><a href="/" title="Главная Miyuneya" data-tip="Главная">${navIcon('home')}<span class="nav-text">Главная</span></a><a href="/#brains" title="Мозги Hayumeri" data-tip="Мозги Hayumeri">${navIcon('brain')}<span class="nav-text">Мозги Hayumeri</span></a><a href="#notes" data-tip="${pageNames.notes}" class="${page==='notes'?'active':''}" ${page==='notes'?'aria-current="page"':''}>${navIcon('navNotes')}<span class="nav-text">${pageNames.notes}</span>${count?`<span class="count" aria-label="записей: ${count}">${count}</span>`:''}</a><a href="#disk" data-tip="Диск документов" class="${page==='disk'?'active':''}" ${page==='disk'?'aria-current="page"':''}>${navIcon('disk')}<span class="nav-text">Диск документов</span></a></nav><div class="sidebar-bottom"><nav class="nav" aria-label="Параметры"><a href="#settings" data-tip="${pageNames.settings}" class="${page==='settings'?'active':''}" ${page==='settings'?'aria-current="page"':''}>${navIcon('navSettings')}<span class="nav-text">${pageNames.settings}</span></a></nav></div></aside><div class="workspace"><header class="topbar"><button class="icon-button mobile-menu" aria-label="Открыть меню" aria-expanded="false" aria-controls="sidebar" data-menu>${icon('menu')}</button><div class="breadcrumb"><span>Пространство</span><span>/</span>${pageNames[page]}</div><label class="search">${icon('search')}<input id="search" aria-label="Общий поиск по пространству" placeholder="Заметки, задачи и документы" value="${escape(query)}" maxlength="200"><kbd>/</kbd></label><span class="top-status"><i class="dot"></i>${saveError?'Есть несохранённые изменения':saving?'Сохранение…':'На вашем компьютере'}</span><button class="icon-button" data-cycle-theme aria-label="Переключить тему">${icon('sun')}</button><button class="icon-button memory-toggle ${memoryMode.private?'private':''} ${memoryMode.enabled?'':'off'}" data-memory-toggle aria-label="Память помощницы" title="Память Миюнэи" aria-haspopup="dialog" aria-expanded="${memoryPanel.isOpen()}">${icon('brain')}</button></header><main id="content" tabindex="-1">${saveError?`<div class="save-error" role="alert">${escape(saveError)} <button class="button" data-export>Скачать свою копию</button><button class="button" data-retry>Повторить сохранение</button></div>`:''}${workbench.toolbar()}${page!=='settings'?workbench.recent():''}${page==='disk'?disk.html(query):({notes,settings})[page]()}</main></div></div>`;
  for (const el of app.querySelectorAll<HTMLElement>('[data-swatch]')) el.style.setProperty('--swatch', el.dataset.swatch!);
  workbench.refresh();workbench.rememberView(page);
  if (focus) document.querySelector<HTMLElement>('#content')?.focus();
}
// A change made while another save is in flight is sent right after it instead of being dropped.
function persist(): Promise<boolean> {
  if(fatal)return Promise.resolve(false);
  saveAgain=true;
  if(!savingPromise)savingPromise=flush();
  return savingPromise;
}
function save(){return persist();}
async function flush(): Promise<boolean> {
  saving=true;
  try{
    while(saveAgain){
      saveAgain=false;
      const sent=JSON.stringify(data);const before=committedData;
      const response=await fetch('/api/workspace',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,data})});
      const result=await response.json();if(!response.ok)throw new Error(result.error || 'Не удалось сохранить данные.');
      revision=result.revision;saveError='';
      if(JSON.stringify(data)===sent)data=result.data;else data.tasks=mergeCanonicalTasks(JSON.parse(sent).tasks,data.tasks,result.data.tasks);
      committedData=JSON.stringify(result.data);if(before&&before!==committedData&&!restoring)workbench.recordUndo(before,revision);
    }
    return true;
  }catch(e){saveAgain=false;saveError=(e as Error).message || 'Сервер недоступен.';toast('Изменения пока не сохранены');return false;}
  finally{saving=false;savingPromise=null;render();}
}

function showEditor(kind: 'note' | 'task', id?: string,parent?:string) {
  if (saving) { toast('Дождитесь завершения сохранения.'); return; }
  if (fatal) { toast('Сначала восстановите подключение к серверу.'); return; }
  editing = {kind,id};
  const note = id ? (kind==='note'?data.notes:data.tasks).find(n=>n.id===id) : undefined;
  document.querySelector('#editor-heading')!.textContent = kind==='task'?(note?'Редактировать задачу':'Новая задача'):note?'Редактировать заметку':'Новая заметка';
  const title = document.querySelector<HTMLInputElement>('#entry-title')!;
  const body = document.querySelector<HTMLTextAreaElement>('#entry-body')!;
  title.value = note?.title || ''; body.value = note?(kind==='note'?(note as Workspace['notes'][number]).body:(note as Workspace['tasks'][number]).details || ''):''; body.hidden=false;body.setAttribute('aria-label',kind==='task'?'Описание задачи':'Текст заметки'); body.maxLength=kind==='task'?10000:100000; body.placeholder=kind==='task'?'Описание задачи…':'Здесь может начаться что-то важное…';
  const task=kind==='task'?note as Workspace['tasks'][number] | undefined:undefined;
  document.querySelector<HTMLElement>('#task-fields')!.hidden=kind!=='task';
  document.querySelector<HTMLInputElement>('#task-due')!.value=task?.dueDate || '';document.querySelector<HTMLSelectElement>('#task-priority')!.value=task?.priority || 'normal';
  if(kind==='task'){
    document.querySelector<HTMLInputElement>('#task-group')!.value=task?.group||(parent?data.tasks.find(t=>t.id===parent)?.group:group)||'';
    document.querySelector<HTMLSelectElement>('#task-parent')!.innerHTML='<option value="">Основная задача</option>'+data.tasks.filter(t=>t.id!==id).map(t=>`<option value="${escape(t.id)}" ${t.id===(task?.parentId||parent)?'selected':''}>${escape(t.title)}</option>`).join('');
    document.querySelector<HTMLSelectElement>('#task-depends')!.innerHTML=data.tasks.filter(t=>t.id!==id).map(t=>`<option value="${escape(t.id)}" ${task?.dependsOn?.includes(t.id)?'selected':''}>${escape(t.title)}${t.done?' ✓':''}</option>`).join('');
    document.querySelector<HTMLSelectElement>('#task-repeat')!.value=task?.repeat?.unit||'';document.querySelector<HTMLInputElement>('#task-interval')!.value=String(task?.repeat?.interval||1);
    document.querySelector<HTMLSelectElement>('#task-materials')!.innerHTML=[...data.notes.map(n=>({kind:'note',id:n.id,title:'Заметка · '+n.title})),...disk.files().filter(f=>!f.trashedAt).map(f=>({kind:'file',id:f.id,title:'Документ · '+f.name}))].map(a=>`<option value="${a.kind}:${escape(a.id)}" ${task?.attachments?.some(x=>x.kind===a.kind&&x.id===a.id)?'selected':''}>${escape(a.title)}</option>`).join('');
  }
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
  const diskTarget=(event.target as HTMLElement).closest<HTMLElement>('[data-disk]');if(diskTarget)return void disk.click(diskTarget);
  if (target.dataset.new) return showEditor(target.dataset.new as 'note'|'task');
  if(target.dataset.editTask)return workbench.open('task',target.dataset.editTask);
  if (target.dataset.edit) return workbench.open('note',target.dataset.edit);
  if (target.hasAttribute('data-export')) return download();
  if (target.hasAttribute('data-memory-toggle')) return memoryPanel.toggle();
  if (target.dataset.accent) return setAppearance({accent:target.dataset.accent});
  if (target.dataset.radius) return setAppearance({radius:target.dataset.radius as Radius});
  if (target.dataset.scale) return setAppearance({scale:target.dataset.scale as Scale});
  if (target.hasAttribute('data-appearance-reset')) { appearance=defaultAppearance(); saveAppearance(appearance); applyTheme(); render(); toast('Оформление сброшено'); return; }
  if (saving || fatal) return;
  if(target.dataset.pinNote){const note=data.notes.find(n=>n.id===target.dataset.pinNote);if(note){note.pinned=!note.pinned;await save();}return;}
  if (target.hasAttribute('data-retry')) return void await save();
  if (target.dataset.deleteNote && await confirmDelete('Удалить заметку?')) { data.notes=data.notes.filter(n=>n.id!==target.dataset.deleteNote);for(const t of data.tasks)t.attachments=t.attachments?.filter(a=>a.kind!=='note'||a.id!==target.dataset.deleteNote); if(await save()) toast('Заметка удалена'); }
  if (target.dataset.deleteTask && await confirmDelete('Удалить задачу?')) { data.tasks=data.tasks.filter(t=>t.id!==target.dataset.deleteTask);for(const t of data.tasks){if(t.parentId===target.dataset.deleteTask)delete t.parentId;t.dependsOn=t.dependsOn?.filter(id=>id!==target.dataset.deleteTask);} if(await save()) toast('Задача удалена'); }
  if (target.dataset.filter) { filter=target.dataset.filter as ViewFilter; render(); }
  if (target.dataset.theme) { data.settings.theme=target.dataset.theme as Workspace['settings']['theme']; applyTheme(); await save(); }
  if (target.hasAttribute('data-cycle-theme')) { data.settings.theme=document.documentElement.dataset.theme==='dark'?'light':'dark'; applyTheme(); await save(); }
  if (target.hasAttribute('data-ai-models')) return void await loadModels(true);
  if (target.hasAttribute('data-ai-forget') && await confirmDelete('Удалить ключ cloud.ru?')) { if(await saveAi({apiKey:null})) { aiModels=null; toast('Ключ удалён'); } }
  if (target.hasAttribute('data-collapse-nav')) { workbench.toggleSidebar(); return; }
  if (target.hasAttribute('data-menu')) { const isOpen=document.querySelector('#sidebar')!.classList.toggle('open'); target.setAttribute('aria-expanded',String(isOpen)); }
});
app.addEventListener('input', event => {
  const input=event.target as HTMLInputElement;
  // Live preview while the palette is open; the choice is stored on change.
  if (input.id==='accent-custom') { applyAppearance({...appearance,accent:input.value},document.documentElement.dataset.theme==='dark'); return; }
  if (input.id==='search') {
    const wasSearching=!!query.trim();query=input.value; const caret=input.selectionStart;if(!wasSearching&&query.trim()){filter='all';group='';}
    if(page!=='notes') { page='notes'; history.replaceState(null,'','#notes'); }
    if(!disk.loaded())void disk.load();
    render(); const search=document.querySelector<HTMLInputElement>('#search')!; search.focus(); search.setSelectionRange(caret,caret);
  }
});
app.addEventListener('change', async event => {
  const input=event.target as HTMLInputElement;
  if(input.dataset.diskPick){disk.pick(input.dataset.diskPick,input.checked);return;}
  if(input.hasAttribute('data-disk-upload') && input.files){void disk.upload(input.files);return;}
  if(input.hasAttribute('data-disk-sort')){disk.sort(input.value);return;}
  if(input.hasAttribute('data-task-group-filter')){group=input.value;render();return;}
  if(input.dataset.toggle){await toggleTask(input.dataset.toggle,input.checked);return;}
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
  const form=event.target as HTMLFormElement;
  if (form.id!=='ai-form') return;
  event.preventDefault();
  const key=document.querySelector<HTMLInputElement>('#ai-key')!.value.trim();
  const model=document.querySelector<HTMLInputElement|HTMLSelectElement>('#ai-model')!.value.trim();
  if(!key && !ai.configured) return toast('Вставьте API-ключ cloud.ru');
  const embedModel=document.querySelector<HTMLInputElement>('#ai-embed')!.value.trim();
  const smartModel=document.querySelector<HTMLInputElement>('#ai-smart')!.value.trim();
  const change: { apiKey?: string; model?: string; smartModel?: string; embedModel?: string } = { embedModel, smartModel };
  if(key) change.apiKey=key;
  if(model) change.model=model;
  if(await saveAi(change)) { toast('Подключение cloud.ru сохранено'); if(key || !aiModels) await loadModels(false,true); }
});
async function aiRequest(path: string, init?: RequestInit) {
  const response=await fetch(path,init); const result=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(result.error || 'Сервер вернул ошибку.');
  return result;
}
async function saveAi(change: { apiKey?: string | null; model?: string; smartModel?: string; embedModel?: string; context?: boolean }) {
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
async function addTask(title: string) {
  if (fatal || data.tasks.length>=5000) { toast('Не удалось добавить задачу'); return null; }
  const id=newId(); data.tasks.push({id,title:title.trim().slice(0,200) || 'Задача',done:false,createdAt:new Date().toISOString()});
  render(); return await persist()?id:null;
}
async function addNote(title: string, body: string) {
  if (fatal || data.notes.length>=5000) { toast('Не удалось сохранить заметку'); return null; }
  const id=newId(); data.notes.push({id,title:title.trim().slice(0,200) || 'Заметка',body:body.slice(0,100000),updatedAt:new Date().toISOString()});
  render(); return await persist()?id:null;
}
async function removeEntry(kind: EntryKind, id: string) {
  const before=data.notes.length+data.tasks.length;
  if (kind==='task') {data.tasks=data.tasks.filter(t=>t.id!==id);for(const t of data.tasks){if(t.parentId===id)delete t.parentId;t.dependsOn=t.dependsOn?.filter(dep=>dep!==id);}} else data.notes=data.notes.filter(n=>n.id!==id);
  const changed=before!==data.notes.length+data.tasks.length;
  if (changed) { render(); return await persist(); }
  return false;
}
document.querySelector('#editor-form')!.addEventListener('submit', async event=>{
  event.preventDefault(); if(saving) return;
  const title=document.querySelector<HTMLInputElement>('#entry-title')!.value.trim();
  const body=document.querySelector<HTMLTextAreaElement>('#entry-body')!.value;
  if(!title) return toast('Введите название');
  if(!editing.id && (editing.kind==='note'?data.notes.length:data.tasks.length)>=5000)return toast('Достигнут предел записей. Сохраните копию и удалите ненужные записи.');
  if(editing.kind==='note') {
    const existing=data.notes.find(n=>n.id===editing.id);
    if(existing) Object.assign(existing,{title,body,updatedAt:new Date().toISOString()});
    else data.notes.push({id:newId(),title,body,updatedAt:new Date().toISOString()});
  } else {
    const dueDate=document.querySelector<HTMLInputElement>('#task-due')!.value;
    if(dueDate && !validLocalDate(dueDate))return toast('Проверьте срок задачи');
    const priority=document.querySelector<HTMLSelectElement>('#task-priority')!.value as 'low'|'normal'|'high';
    const existing=data.tasks.find(t=>t.id===editing.id);
    const parentId=document.querySelector<HTMLSelectElement>('#task-parent')!.value||undefined;
    const dependsOn=[...document.querySelector<HTMLSelectElement>('#task-depends')!.selectedOptions].map(o=>o.value);
    const unit=document.querySelector<HTMLSelectElement>('#task-repeat')!.value as 'day'|'week'|'month';const interval=Number(document.querySelector<HTMLInputElement>('#task-interval')!.value);
    if(unit&&parentId)return toast('Повторение задаётся для основной задачи. Её подзадачи будут скопированы автоматически.');
    if(unit&&(!Number.isInteger(interval)||interval<1||interval>365))return toast('Интервал повторения — целое число от 1 до 365.');
    const attachments=[...document.querySelector<HTMLSelectElement>('#task-materials')!.selectedOptions].map(o=>{const split=o.value.indexOf(':');const kind=o.value.slice(0,split),id=o.value.slice(split+1);return{kind:kind as 'note'|'file',id};});
    const fields={title,details:body.slice(0,10000),dueDate,priority,parentId,dependsOn,group:document.querySelector<HTMLInputElement>('#task-group')!.value.trim(),attachments,repeat:editedRepeat(existing,dueDate,unit,interval),updatedAt:new Date().toISOString()};
    const candidate=structuredClone(data);const changed=existing?candidate.tasks.find(t=>t.id===existing.id):null;if(changed)Object.assign(changed,fields);else candidate.tasks.push({id:newId(),done:false,createdAt:new Date().toISOString(),...fields});
    if(!validateWorkspace(candidate))return toast('Проверьте зависимости и родителя: циклы и отсутствующие задачи недопустимы.');data=candidate;
  }
  editor.close(); if(await save()) toast(editing.kind==='note'?'Заметка сохранена':editing.id?'Задача сохранена':'Задача добавлена');
});
for(const id of ['close-editor','cancel-editor']) document.querySelector('#'+id)!.addEventListener('click',()=>editor.close());
window.addEventListener('resize',()=>{app.querySelector('.shell')?.classList.toggle('miyu-nav-compact',sidebarCollapsed());});
window.addEventListener('hashchange',()=>{page=getPage();render(true);window.scrollTo(0,0);if(page==='disk'&&!disk.loaded())void disk.load();if(page==='settings'){void workbench.loadWorkflows();if(ai.configured&&!aiModels)void loadModels(false);}if(location.hash==='#diary') openDiary();});
window.addEventListener('beforeunload', event=>{ if(saving || saveError || disk.busy()) {event.preventDefault();event.returnValue='';} });
document.addEventListener('keydown',event=>{
  const target=event.target as HTMLElement;
  if(event.key==='/' && !target.closest('input,textarea,select,dialog')) {event.preventDefault();document.querySelector<HTMLInputElement>('#search')?.focus();}
  if(event.key==='Escape') {document.querySelector('#sidebar')?.classList.remove('open');document.querySelector('[data-menu]')?.setAttribute('aria-expanded','false');}
});
function memoryChanged(view: MemoryView) {
  memoryMode={enabled:view.enabled,private:view.private};
  const button=document.querySelector('[data-memory-toggle]');
  button?.classList.toggle('private',view.private); button?.classList.toggle('off',!view.enabled);
  assistant?.refresh();
}
const memoryPanel=mountMemory({ toast, confirm:confirmDelete, changed:memoryChanged,
  entry:id=>{ const note=data.notes.find(n=>n.id===id); if(note) return {kind:'note',title:note.title}; const task=data.tasks.find(t=>t.id===id); return task?{kind:'task',title:task.title}:null; },
  openNote:id=>{ if(page!=='notes') location.hash='notes'; if(data.notes.some(n=>n.id===id)) showEditor('note',id); } });
workbench=mountWorkbench({data:()=>data,revision:()=>revision,render:()=>render(),toast,current:()=>({query,filter,group,page,...disk.viewPrefs()}),filters:v=>{query=v.query;filter=v.filter;group=v.group;page=v.page==='disk'?'disk':'notes';if(page==='disk')disk.setView(v.diskView||'all',v.diskSort);history.replaceState(null,'','#'+page);render();},edit:showEditor,file:id=>void disk.preview(id),toggle:toggleTask,diskFiles:()=>disk.files(),diskFolders:()=>disk.folders(),sync:reloadWorkspace,restore:async snapshot=>{
  if(saving||saveError)return false;const r=await fetch('/api/workspace');const current=await r.json();if(current.revision!==revision){toast('Данные изменились в другой вкладке. Отмена не выполнена.');return false;}data=JSON.parse(snapshot);restoring=true;try{const ok=await save();if(ok)toast('Действие отменено');return ok;}finally{restoring=false;}
}});
const remembered=workbench.prefs();if(!location.hash){page=remembered.page as Page;history.replaceState(null,'','#'+page);}query=remembered.query;filter=remembered.filter as ViewFilter;group=remembered.group;
async function toggleTask(id:string,done:boolean){if(saving||fatal)return;const task=data.tasks.find(t=>t.id===id);if(!task)return;const blocked=taskBlockers(data.tasks,task);if(done&&blocked.length){toast('Сначала завершите: '+blocked.slice(0,3).map(t=>t.title).join(', '));render();return;}task.done=done;if(done)task.completedAt=new Date().toISOString();else delete task.completedAt;task.updatedAt=new Date().toISOString();await save();}
async function reloadWorkspace(){if(saving||saveError||fatal)return;try{const r=await fetch('/api/workspace');const next=await r.json();if(!r.ok||!validateWorkspace(next.data))return;data=next.data;revision=next.revision;committedData=JSON.stringify(data);render();}catch{toast('Файл сохранён, но список записей пока не обновился.');}}
// The diary now lives in the memory menu; old #diary links open it there.
function openDiary() { history.replaceState(null,'','#notes'); memoryPanel.open('diary'); }
try {
  const response=await fetch('/api/workspace'); if(!response.ok) throw new Error('Сервер вернул ошибку.');
  const saved=await response.json();
  if(!validateWorkspace(saved.data) || !Number.isSafeInteger(saved.revision)) throw new Error('Неверный формат данных сервера.');
  data=saved.data;revision=saved.revision;committedData=JSON.stringify(data);
} catch(e) { fatal=true; saveError='Не удалось загрузить данные. Проверьте окно Miyuneya.bat и обновите страницу. '+(e as Error).message; }
try { ai=await aiRequest('/api/assistant'); } catch {}
render();
void disk.load().then(()=>workbench.reopen());
if(page==='settings')void workbench.loadWorkflows();
// The shared movable kitsune (loaded by index.html on this route) owns the
// avatar and chat. Do not mount the legacy widget a second time. Keep the
// draft/refresh bridge used by the disk and other workspace modules.
assistant={
  draft(text) {
    const bubble=document.getElementById('kitsune-avatar');
    const panel=document.getElementById('kitsune-chat');
    const field=document.getElementById('kitsune-message');
    if(!bubble||!panel||!(field instanceof HTMLTextAreaElement)) { toast('Чат пока недоступен. Перезагрузите страницу.'); return; }
    if(panel.hidden)bubble.click();
    field.value=text.slice(0,20000);
    field.focus();
  },
  refresh() { /* Shared avatar reads local settings directly. */ }
};
void memoryPanel.load();
if(page==='settings' && ai.configured) void loadModels(false);
if(location.hash==='#diary') openDiary();

app.addEventListener('dragover',event=>{if((event.target as HTMLElement).closest('[data-disk-drop]')){event.preventDefault();}});
app.addEventListener('drop',event=>{if((event.target as HTMLElement).closest('[data-disk-drop]')){event.preventDefault();if(event.dataTransfer?.files)void disk.upload(event.dataTransfer.files);}});
