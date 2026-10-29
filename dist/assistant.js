// Generated from src/assistant.ts by npm run build.
                                                

// Floating avatar with a chat window. Appearance is saved in the workspace by the host;
// screen position, chat geometry and history are per-browser conveniences in localStorage.
                                                                                                                                                         
                                        
                             
                                  
                                               
                            
                                           
                               
                                                 
                                                               
                                                        
                                                   
                        
  
// Short-term memory: the oldest turns of a long dialog fold into a summary that travels with every request.
                                               
                                                                               
                                                                                                      
                                                                            
                                                           

const sizes                                        = { s: 120, m: 170, l: 240 };
const sizeNames                                    = [['s', 'Маленький'], ['m', 'Средний'], ['l', 'Большой']];
const MARGIN = 12;
const SNAP = 48;
const MIN_W = 340;
const MIN_H = 380;
const HISTORY_LIMIT = 60;
const UPLOAD_LIMIT = 15_000_000;
const KEEP_RECENT = 12;
const COMPACT_AFTER = 24;
export const newDialogId = () => Array.from(crypto.getRandomValues(new Uint32Array(3)), n => n.toString(16).padStart(8, '0')).join('');
const validDialog = (value         )                  => typeof value === 'string' && /^[a-z0-9-]{8,64}$/.test(value);
export const avatarUrl = (n        ) => `/avatars/avatar${n}.png`;
export function avatarSrc(look               , status                 ) {
  if (look.avatar === 5 && status.customAvatar) return `/api/assistant/avatar?v=${status.customAvatar}`;
  return avatarUrl(look.avatar === 5 ? 1 : look.avatar);
}

// The model marks requested entries with <task> and <note> tags; the user sees confirmations instead.
export function visibleText(raw        ) {
  let text = raw.replace(/<task>[\s\S]*?<\/task>/g, '').replace(/<note\b[^>]*>[\s\S]*?<\/note>/g, '');
  const open = text.search(/<(task|note)\b/);
  if (open >= 0) text = text.slice(0, open);
  // Hide a tag that is still arriving, such as a trailing "<no".
  text = text.replace(/<(t(a(s(k)?)?)?|n(o(t(e)?)?)?)?$/, '');
  return text.replace(/\n{3,}/g, '\n\n').trim();
}
export function parseActions(raw        ) {
  const tasks = [...raw.matchAll(/<task>([\s\S]*?)<\/task>/g)].map(m => m[1].trim()).filter(Boolean);
  const notes = [...raw.matchAll(/<note\b(?:\s+title\s*=\s*"([^"]*)")?[^>]*>([\s\S]*?)<\/note>/g)]
    .map(m => ({ title: (m[1] || '').trim(), body: m[2].trim() })).filter(n => n.title || n.body);
  return { tasks, notes };
}
export const noteTitle = (text        ) => (text.split('\n').find(line => line.trim()) || 'Заметка из чата').replace(/^[#*\s-]+/, '').slice(0, 80).trim() || 'Заметка из чата';

function stored   (key        , fallback   )    {
  try { const value = localStorage.getItem('miyuneya.' + key); return value ? JSON.parse(value)      : fallback; } catch { return fallback; }
}
function remember(key        , value         ) {
  try { localStorage.setItem('miyuneya.' + key, JSON.stringify(value)); } catch {}
}
function forget(key        ) {
  try { localStorage.removeItem('miyuneya.' + key); } catch {}
}
const clamp = (value        , min        , max        ) => Math.min(Math.max(value, min), Math.max(min, max));
const finite = (...values           ) => values.every(v => typeof v === 'number' && Number.isFinite(v));
function element                                       (tag   , className = '', text = '') {
  const el = document.createElement(tag); if (className) el.className = className; if (text) el.textContent = text; return el;
}
function button(label        , className        , onClick            ) {
  const el = element('button', className, label); el.type = 'button'; el.addEventListener('click', onClick); return el;
}

export function mountAssistant(host               ) {
  const avatar = element('button', 'assistant-avatar');
  avatar.type = 'button';
  avatar.setAttribute('aria-label', 'Помощница Миюнэя. Нажмите, чтобы открыть чат; правая кнопка мыши открывает меню');
  avatar.setAttribute('aria-haspopup', 'menu');
  const float = element('span', 'avatar-float');
  const figure = element('img');
  figure.alt = ''; figure.draggable = false; figure.decoding = 'async';
  float.append(figure); avatar.append(float);
  figure.addEventListener('animationend', () => avatar.classList.remove('poke'));

  const menu = element('div', 'assistant-menu');
  menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Настройки аватара'); menu.hidden = true;

  const upload = element('input');
  upload.type = 'file'; upload.accept = 'image/png,image/jpeg,image/webp,image/gif'; upload.hidden = true;

  const chat = element('section', 'assistant-chat');
  chat.setAttribute('role', 'dialog'); chat.setAttribute('aria-label', 'Чат с Миюнэей'); chat.hidden = true;
  chat.innerHTML = '<header class="chat-head"><span class="face"><img alt="" draggable="false"></span><div class="chat-title"><b>Миюнэя</b><small></small></div><button type="button" class="chat-tool" data-chat-clear>Очистить</button><button type="button" class="icon-button" data-chat-close aria-label="Закрыть чат">×</button></header><div class="chat-log" aria-live="polite"></div><form class="chat-form"><textarea rows="3" maxlength="20000" aria-label="Сообщение" placeholder="Напишите сообщение… Enter — отправить, Shift+Enter — новая строка"></textarea><button class="button primary" type="submit">Отправить</button></form>'
    + ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'].map(dir => `<i class="chat-resize ${dir}" data-resize="${dir}" aria-hidden="true"></i>`).join('');
  const log = chat.querySelector                ('.chat-log') ;
  const form = chat.querySelector                 ('.chat-form') ;
  const input = chat.querySelector                     ('textarea') ;
  const sendButton = form.querySelector                   ('button') ;
  const head = chat.querySelector             ('.chat-head') ;
  document.body.append(avatar, chat, menu, upload);

  let history            = (stored           ('chat', []) || []).filter(m => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string').slice(-HISTORY_LIMIT);
  let position = stored                 ('avatar-position', null);
  let frame = stored             ('chat-frame', null);
  let streaming                                                                                   = null;
  let dialog = stored        ('chat-dialog', '');
  if (!validDialog(dialog)) { dialog = newDialogId(); remember('chat-dialog', dialog); }
  let summary = stored         ('chat-summary', { text: '', count: 0 });
  if (typeof summary?.text !== 'string' || !Number.isSafeInteger(summary.count) || summary.count < 0) summary = { text: '', count: 0 };
  summary.count = Math.min(summary.count, history.length);
  let compacting = false;
  let error = '';
  let shownSrc = '';

  const size = () => Math.min(sizes[host.look().size], Math.round(innerHeight * .45), Math.round(innerWidth * .45));
  function place() {
    const look = host.look(); const px = size();
    if (!position || !finite(position.x, position.y)) position = { x: innerWidth - px - 28, y: innerHeight - px - 20 };
    const x = position.right ? innerWidth - px : position.x, y = position.bottom ? innerHeight - px : position.y;
    position = { ...position, x: clamp(x, 0, innerWidth - px), y: clamp(y, 0, innerHeight - px) };
    avatar.style.left = position.x + 'px'; avatar.style.top = position.y + 'px';
    avatar.style.width = avatar.style.height = px + 'px';
    avatar.style.setProperty('--rest-opacity', String(look.opacity));
    avatar.hidden = look.hidden;
    avatar.classList.toggle('mirror', look.mirror);
    avatar.classList.toggle('still', !look.animate);
    const src = avatarSrc(look, host.status());
    if (shownSrc !== src) { figure.src = src; head.querySelector('img') .src = src; shownSrc = src; }
  }
  // Stick to a nearby screen edge and stay there when the window is resized.
  function snap() {
    if (!host.look().snap || !position) return;
    const px = size(); const next           = { x: position.x, y: position.y };
    if (position.x < SNAP) next.x = 0; else if (innerWidth - px - position.x < SNAP) next.right = true;
    if (position.y < SNAP) next.y = 0; else if (innerHeight - px - position.y < SNAP) next.bottom = true;
    avatar.classList.add('snapping'); setTimeout(() => avatar.classList.remove('snapping'), 260);
    position = next; place();
  }
  function defaultFrame()       {
    const w = Math.min(500, innerWidth - MARGIN * 2), h = Math.min(660, innerHeight - MARGIN * 2), px = size();
    const p = position || { x: innerWidth, y: innerHeight };
    const x = p.x - w - 16 >= MARGIN ? p.x - w - 16 : p.x + px + 16;
    return { x, y: p.y + px - h, w, h };
  }
  function fitFrame(rect      )       {
    const w = clamp(rect.w, Math.min(MIN_W, innerWidth - MARGIN * 2), innerWidth - MARGIN * 2);
    const h = clamp(rect.h, Math.min(MIN_H, innerHeight - MARGIN * 2), innerHeight - MARGIN * 2);
    return { w, h, x: clamp(rect.x, MARGIN, innerWidth - w - MARGIN), y: clamp(rect.y, MARGIN, innerHeight - h - MARGIN) };
  }
  function placeChat() {
    const rect = fitFrame(frame && finite(frame.x, frame.y, frame.w, frame.h) ? frame : defaultFrame());
    chat.style.left = rect.x + 'px'; chat.style.top = rect.y + 'px'; chat.style.width = rect.w + 'px'; chat.style.height = rect.h + 'px';
    return rect;
  }

  const saveHistory = () => {
    const extra = history.length - HISTORY_LIMIT;
    if (extra > 0) { history = history.slice(extra); summary = { ...summary, count: Math.max(0, summary.count - extra) }; remember('chat-summary', summary); }
    remember('chat', history.map(({ role, content, actions, stopped }) => ({ role, content, actions, stopped })));
  };
  const plain = (list           ) => list.map(({ role, content }) => ({ role, content: role === 'assistant' ? visibleText(content) || content : content })).filter(m => m.content.trim());
  // Folds everything but the latest turns into the running summary once the dialog grows long.
  async function compact() {
    if (compacting || !host.memory().enabled || history.length - summary.count <= COMPACT_AFTER) return;
    compacting = true;
    const id = dialog; const boundary = history[history.length - KEEP_RECENT - 1];
    try {
      const response = await fetch('/api/assistant/compact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ summary: summary.text, messages: plain(history.slice(summary.count, history.indexOf(boundary) + 1)) }) });
      const result = await response.json().catch(() => ({}));
      const at = history.indexOf(boundary);
      if (response.ok && typeof result.summary === 'string' && id === dialog && at >= 0) { summary = { text: result.summary, count: at + 1 }; remember('chat-summary', summary); }
    } catch {} finally { compacting = false; }
  }
  // Implicit feedback for the memory: what the user did with an answer says how good it was.
  function signal(kind                                   , text = '') {
    const mode = host.memory();
    if (!mode.enabled || mode.private) return;
    void fetch('/api/memory/signal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dialog, kind, text: text.slice(0, 120) }) }).catch(() => {});
  }
  // A cleared chat is a finished dialog: the server turns it into an episode and new facts.
  function endDialog() {
    if (history.some(m => m.role === 'user') && host.memory().enabled && !host.memory().private)
      void fetch('/api/memory/close', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dialog }) }).then(() => host.memoryChanged(), () => {});
    dialog = newDialogId(); remember('chat-dialog', dialog);
    summary = { text: '', count: 0 }; forget('chat-summary');
  }
  function actionChip(action        ) {
    const chip = element('div', 'chat-action' + (action.undone ? ' undone' : ''));
    chip.append(element('span', '', `${action.undone ? 'Отменено' : '✓'} ${action.kind === 'task' ? 'Задача' : 'Заметка'}: ${action.title}`));
    if (!action.undone) chip.append(button('Отменить', 'chat-link', async () => {
      if(!await host.remove(action.kind, action.id))return; action.undone = true; signal('undo', action.title); saveHistory(); renderChat();
    }));
    return chip;
  }
  function bubble(message         ) {
    const item = element('div', 'chat-message ' + message.role);
    const text = element('p', '', message.role === 'assistant' ? visibleText(message.content) : message.content);
    item.append(text);
    if (message.role === 'assistant' && message !== streaming?.message) {
      if (message.stopped) item.append(element('small', 'chat-stopped', 'Ответ остановлен'));
      for (const action of message.actions || []) item.append(actionChip(action));
      const shown = visibleText(message.content);
      if (shown) {
        const tools = element('div', 'chat-tools');
        tools.append(button('Копировать', 'chat-link', async () => {
          try { await navigator.clipboard.writeText(shown); host.toast('Ответ скопирован'); signal('copy'); } catch { host.toast('Не удалось скопировать'); }
        }), button('В заметку', 'chat-link', async () => { if (await host.addNote(noteTitle(shown), shown)) { host.toast('Ответ сохранён в заметки'); signal('save'); } }));
        item.append(tools);
      }
    }
    return { item, text };
  }
  function renderChat() {
    const status = host.status();
    const mode = host.memory();
    chat.querySelector('.chat-title small') .textContent = status.configured ? 'cloud.ru · ' + status.model + (!mode.enabled ? ' · без памяти' : mode.private ? ' · приватно' : '') : 'cloud.ru не подключён';
    log.replaceChildren();
    if (!status.configured) {
      const note = element('div', 'chat-note');
      note.append(element('p', '', 'Чтобы я могла отвечать, подключите cloud.ru: сохраните API-ключ и выберите модель.'));
      const link = element('a', 'button', 'Открыть настройки пространства'); link.href = '#settings';
      note.append(link); log.append(note);
    } else if (!history.length) log.append(element('div', 'chat-note', status.context
      ? 'Здравствуйте! Я Миюнэя. Вижу ваши заметки и задачи: спросите, что запланировано, найдите запись или попросите добавить задачу.'
      : 'Здравствуйте! Я Миюнэя. Спросите о чём угодно. Доступ к заметкам и задачам можно включить в настройках пространства.'));
    for (const message of history) {
      const { item, text } = bubble(message);
      if (message === streaming?.message) {
        streaming.text = text;
        if (!visibleText(message.content)) { item.classList.add('typing'); text.textContent = 'Миюнэя печатает…'; }
      }
      log.append(item);
    }
    if (error) log.append(element('div', 'chat-message error', error));
    sendButton.textContent = streaming ? 'Стоп' : 'Отправить';
    sendButton.classList.toggle('stop', !!streaming);
    log.scrollTop = log.scrollHeight;
  }
  function showDelta() {
    if (!streaming?.text) return;
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    const shown = visibleText(streaming.message.content);
    streaming.text.parentElement .classList.toggle('typing', !shown);
    streaming.text.textContent = shown || 'Миюнэя печатает…';
    if (nearBottom) log.scrollTop = log.scrollHeight;
  }
  function openChat() {
    closeMenu();
    chat.hidden = false; placeChat(); renderChat(); input.focus();
  }
  function closeChat() { chat.hidden = true; avatar.focus(); }
  const toggleChat = () => chat.hidden ? openChat() : closeChat();

  async function applyActions(message         ) {
    const { tasks, notes } = parseActions(message.content);
    const actions           = [];
    for (const title of tasks) { const id = await host.addTask(title); if (id) actions.push({ kind: 'task', id, title: title.slice(0, 200) }); }
    for (const note of notes) {
      const title = note.title || noteTitle(note.body);
      const id = await host.addNote(title, note.body); if (id) actions.push({ kind: 'note', id, title: title.slice(0, 200) });
    }
    if (actions.length) { message.actions = actions; host.toast(actions.length === 1 ? (actions[0].kind === 'task' ? 'Задача добавлена' : 'Заметка сохранена') : `Добавлено записей: ${actions.length}`); }
  }
  async function send() {
    const text = input.value.trim();
    if (!text || streaming) return;
    if (!host.status().configured) { error = ''; renderChat(); host.toast('Сначала подключите cloud.ru в настройках'); return; }
    history.push({ role: 'user', content: text }); input.value = ''; error = '';
    const outgoing = history.slice(summary.count).slice(-40).map(({ role, content }) => ({ role, content })).filter(m => m.content);
    const message          = { role: 'assistant', content: '' };
    const current = streaming = { message, abort: new AbortController() };
    history.push(message); saveHistory(); avatar.classList.add('talking'); renderChat();
    try {
      const response = await fetch('/api/assistant/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: outgoing, dialog, summary: summary.text || undefined }), signal: current.abort.signal });
      if (!response.ok || !response.body) throw new Error((await response.json().catch(() => ({}))).error || 'Не удалось получить ответ.');
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '', finished = false;
      while (!finished) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.error) throw new Error(event.error);
          if (typeof event.delta === 'string') { message.content += event.delta; showDelta(); }
          if (typeof event.memory === 'string') { host.toast(event.memory); host.memoryChanged(); }
          if (event.done) finished = true;
        }
      }
      if (!finished) throw new Error('Ответ оборвался. Попробуйте ещё раз.');
      await applyActions(message);
      void compact();
    } catch (e) {
      if (current.abort.signal.aborted) { message.stopped = true; signal('stop'); }
      else error = e instanceof TypeError ? 'Локальный сервер недоступен. Проверьте окно Miyuneya.bat.' : (e         ).message;
      if (!visibleText(message.content) && !message.stopped) history = history.filter(m => m !== message);
    } finally {
      streaming = null; avatar.classList.remove('talking');
      saveHistory(); if (!chat.hidden) renderChat();
    }
  }
  form.addEventListener('submit', event => { event.preventDefault(); if (streaming) streaming.abort.abort(); else void send(); });
  input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void send(); } });
  chat.addEventListener('click', event => {
    const target = (event.target               ).closest             ('button,a');
    if (!target) return;
    if (target.hasAttribute('data-chat-close')) closeChat();
    if (target.hasAttribute('data-chat-clear')) { streaming?.abort.abort(); endDialog(); history = []; error = ''; forget('chat'); renderChat(); input.focus(); }
  });
  chat.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); closeChat(); } });

  // Shared pointer drag: calls move with the offset from the press point.
  function track(event              , target             , move                                  , done                          ) {
    const startX = event.clientX, startY = event.clientY; let moved = false;
    target.setPointerCapture(event.pointerId);
    const onMove = (e              ) => {
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      moved = true; move(dx, dy);
    };
    const onEnd = () => {
      target.removeEventListener('pointermove', onMove); target.removeEventListener('pointerup', onEnd); target.removeEventListener('pointercancel', onEnd);
      document.body.classList.remove('assistant-dragging'); done(moved);
    };
    document.body.classList.add('assistant-dragging');
    target.addEventListener('pointermove', onMove); target.addEventListener('pointerup', onEnd); target.addEventListener('pointercancel', onEnd);
  }

  let suppressClick = false;
  avatar.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    closeMenu();
    const start = { x: position .x, y: position .y };
    track(event, avatar, (dx, dy) => { avatar.classList.add('dragging'); position = { x: start.x + dx, y: start.y + dy }; place(); }, moved => {
      avatar.classList.remove('dragging');
      suppressClick = moved;
      if (moved) { snap(); remember('avatar-position', position); }
    });
  });
  avatar.addEventListener('click', () => {
    if (suppressClick) { suppressClick = false; return; }
    avatar.classList.remove('poke'); void avatar.offsetWidth; avatar.classList.add('poke');
    toggleChat();
  });
  avatar.addEventListener('keydown', event => {
    const step = event.shiftKey ? 40 : 10;
    const moves                                   = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const delta = moves[event.key];
    if (!delta) return;
    event.preventDefault();
    position = { x: position .x + delta[0], y: position .y + delta[1] }; place(); remember('avatar-position', position);
  });
  avatar.addEventListener('contextmenu', event => {
    event.preventDefault();
    const rect = avatar.getBoundingClientRect();
    const fromKeyboard = event.button !== 2 && event.clientX === 0 && event.clientY === 0;
    openMenu(fromKeyboard ? rect.left : event.clientX, fromKeyboard ? rect.top : event.clientY);
  });

  head.addEventListener('pointerdown', event => {
    if (event.button !== 0 || (event.target               ).closest('button')) return;
    const start = placeChat();
    track(event, head, (dx, dy) => { frame = fitFrame({ ...start, x: start.x + dx, y: start.y + dy }); placeChat(); }, moved => { if (moved) remember('chat-frame', frame); });
  });
  chat.addEventListener('pointerdown', event => {
    const handle = (event.target               ).closest             ('[data-resize]');
    if (!handle || event.button !== 0) return;
    event.preventDefault();
    const dir = handle.dataset.resize ; const start = placeChat();
    const right = start.x + start.w, bottom = start.y + start.h;
    track(event, handle, (dx, dy) => {
      let { x, y, w, h } = start;
      if (dir.includes('e')) w = clamp(start.w + dx, MIN_W, innerWidth - MARGIN - start.x);
      if (dir.includes('s')) h = clamp(start.h + dy, MIN_H, innerHeight - MARGIN - start.y);
      if (dir.includes('w')) { x = clamp(start.x + dx, MARGIN, right - MIN_W); w = right - x; }
      if (dir.includes('n')) { y = clamp(start.y + dy, MARGIN, bottom - MIN_H); h = bottom - y; }
      frame = { x, y, w, h }; placeChat();
    }, moved => { if (moved) remember('chat-frame', frame); });
  });

  async function uploadAvatar(file      ) {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return host.toast('Выберите изображение PNG, JPEG, WebP или GIF');
    if (file.size > UPLOAD_LIMIT) return host.toast('Изображение больше 15 МБ');
    try {
      const response = await fetch('/api/assistant/avatar', { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Не удалось загрузить изображение.');
      host.setStatus(result); host.update({ avatar: 5 }); host.toast('Свой образ загружен');
    } catch (e) { host.toast(e instanceof TypeError ? 'Сервер недоступен.' : (e         ).message); }
  }
  async function removeAvatar() {
    try {
      const response = await fetch('/api/assistant/avatar', { method: 'DELETE' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Не удалось удалить изображение.');
      host.setStatus(result);
      if (host.look().avatar === 5) host.update({ avatar: 1 }); else place();
      host.toast('Свой образ удалён');
    } catch (e) { host.toast(e instanceof TypeError ? 'Сервер недоступен.' : (e         ).message); }
  }
  upload.addEventListener('change', () => { const file = upload.files?.[0]; upload.value = ''; if (file) void uploadAvatar(file); });

  function renderMenu() {
    const look = host.look(); const status = host.status();
    const item = (attrs        , label        , role = 'menuitem', checked          ) => `<button type="button" role="${role}" ${checked === undefined ? '' : `aria-checked="${checked}"`} ${attrs}>${label}</button>`;
    const tile = (n        , src        ) => `<button type="button" role="menuitemradio" aria-checked="${look.avatar === n}" aria-label="${n === 5 ? 'Свой образ' : 'Аватар ' + n}" data-menu-avatar="${n}"><img src="${src}" alt="" draggable="false" decoding="async"></button>`;
    menu.innerHTML = item('data-menu-chat', chat.hidden ? 'Открыть чат' : 'Закрыть чат')
      + '<p class="menu-label">Аватар</p><div class="menu-avatars" role="group" aria-label="Выбор аватара">'
      + [1, 2, 3, 4].map(n => tile(n, avatarUrl(n))).join('')
      + (status.customAvatar ? tile(5, avatarSrc({ ...look, avatar: 5 }, status)) : '<button type="button" role="menuitem" class="add" aria-label="Загрузить свой образ" data-menu-upload>+</button>')
      + '</div><p class="menu-label">Размер</p><div class="menu-sizes" role="group" aria-label="Размер аватара">'
      + sizeNames.map(([key, label]) => item(`data-menu-size="${key}"`, label, 'menuitemradio', look.size === key)).join('')
      + `</div><label class="menu-range"><span>Прозрачность в покое</span><input type="range" min="20" max="100" step="5" value="${Math.round(look.opacity * 100)}" aria-label="Непрозрачность аватара в процентах" data-menu-opacity></label>`
      + '<hr>' + item('data-menu-animate', 'Анимация', 'menuitemcheckbox', look.animate)
      + item('data-menu-snap', 'Прилипать к краям экрана', 'menuitemcheckbox', look.snap)
      + item('data-menu-mirror', 'Отразить по горизонтали', 'menuitemcheckbox', look.mirror)
      + item('data-menu-reset', 'Вернуть в угол экрана')
      + '<hr>' + item('data-menu-upload', status.customAvatar ? 'Заменить свой образ…' : 'Загрузить свой образ…')
      + (status.customAvatar ? item('data-menu-remove', 'Удалить свой образ') : '')
      + item('data-menu-settings', 'Подключение cloud.ru…')
      + '<hr>' + item('data-menu-hide', 'Скрыть аватар');
  }
  function openMenu(x        , y        ) {
    renderMenu(); menu.hidden = false;
    const rect = menu.getBoundingClientRect();
    menu.style.left = clamp(x, 8, innerWidth - rect.width - 8) + 'px';
    menu.style.top = clamp(y, 8, innerHeight - rect.height - 8) + 'px';
    menu.querySelector             ('[aria-checked="true"]')?.focus();
  }
  function closeMenu() { if (!menu.hidden) menu.hidden = true; }
  menu.addEventListener('click', event => {
    const target = (event.target               ).closest             ('button');
    if (!target) return;
    if (target.hasAttribute('data-menu-chat')) { closeMenu(); toggleChat(); return; }
    if (target.hasAttribute('data-menu-upload')) { closeMenu(); upload.click(); return; }
    if (target.hasAttribute('data-menu-remove')) { closeMenu(); void removeAvatar(); return; }
    if (target.dataset.menuAvatar) host.update({ avatar: Number(target.dataset.menuAvatar)                            });
    if (target.dataset.menuSize) host.update({ size: target.dataset.menuSize                          });
    if (target.hasAttribute('data-menu-mirror')) host.update({ mirror: !host.look().mirror });
    if (target.hasAttribute('data-menu-animate')) host.update({ animate: !host.look().animate });
    if (target.hasAttribute('data-menu-snap')) { host.update({ snap: !host.look().snap }); if (host.look().snap) { snap(); remember('avatar-position', position); } }
    if (target.hasAttribute('data-menu-reset')) { position = null; forget('avatar-position'); frame = null; forget('chat-frame'); place(); if (!chat.hidden) placeChat(); closeMenu(); return; }
    if (target.hasAttribute('data-menu-settings')) { closeMenu(); location.hash = 'settings'; return; }
    if (target.hasAttribute('data-menu-hide')) { closeMenu(); chat.hidden = true; host.update({ hidden: true }); host.toast('Аватар скрыт. Вернуть его можно в настройках пространства.'); return; }
    // Re-render with the new checks and keep focus on the same item.
    const same = [...target.attributes].filter(a => a.name.startsWith('data-menu')).map(a => `[${a.name}="${a.value}"]`).join('');
    renderMenu();
    menu.querySelector             (same)?.focus();
  });
  menu.addEventListener('input', event => {
    const range = event.target                    ;
    if (range.hasAttribute('data-menu-opacity')) avatar.style.setProperty('--rest-opacity', String(Number(range.value) / 100));
  });
  menu.addEventListener('change', event => {
    const range = event.target                    ;
    if (range.hasAttribute('data-menu-opacity')) host.update({ opacity: clamp(Number(range.value) / 100, 0.2, 1) });
  });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeMenu(); avatar.focus(); return; }
    if ((event.target               ).matches('input') && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) return;
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const items = [...menu.querySelectorAll             ('button,input')];
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
    items[(items.indexOf(document.activeElement               ) + step + items.length) % items.length]?.focus();
  });
  document.addEventListener('pointerdown', event => { if (!menu.hidden && !menu.contains(event.target        )) closeMenu(); });
  addEventListener('blur', closeMenu);
  addEventListener('resize', () => { closeMenu(); place(); if (!chat.hidden) placeChat(); });

  place();
  return {
    draft(text        ) { openChat();input.value=text.slice(0,20000);input.focus(); },
    // Called by the host after appearance or the cloud.ru connection changes.
    refresh() { place(); if (!chat.hidden) { if (host.look().hidden) chat.hidden = true; else if (!streaming) renderChat(); } },
  };
}
