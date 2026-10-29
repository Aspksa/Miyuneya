import type { AssistantLook } from './model.js';

// Floating avatar with a chat window. Appearance is saved in the workspace by the host;
// screen position, chat geometry and history are per-browser conveniences in localStorage.
export type AssistantStatus = { configured: boolean; keyHint: string; model: string };
export type AssistantHost = {
  look(): AssistantLook;
  update(change: Partial<AssistantLook>): void;
  status(): AssistantStatus;
  toast(message: string): void;
};
type Message = { role: 'user' | 'assistant'; content: string };
type Point = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

const sizes: Record<AssistantLook['size'], number> = { s: 120, m: 170, l: 240 };
const sizeNames: [AssistantLook['size'], string][] = [['s', 'Маленький'], ['m', 'Средний'], ['l', 'Большой']];
const MARGIN = 12;
const MIN_W = 340;
const MIN_H = 380;
const HISTORY_LIMIT = 60;
export const avatarUrl = (n: number) => `/avatars/avatar${n}.png`;

function stored<T>(key: string, fallback: T): T {
  try { const value = localStorage.getItem('miyuneya.' + key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}
function remember(key: string, value: unknown) {
  try { localStorage.setItem('miyuneya.' + key, JSON.stringify(value)); } catch {}
}
function forget(key: string) {
  try { localStorage.removeItem('miyuneya.' + key); } catch {}
}
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));
const finite = (...values: unknown[]) => values.every(v => typeof v === 'number' && Number.isFinite(v));
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const el = document.createElement(tag); if (className) el.className = className; if (text) el.textContent = text; return el;
}

export function mountAssistant(host: AssistantHost) {
  const avatar = element('button', 'assistant-avatar');
  avatar.type = 'button';
  avatar.setAttribute('aria-label', 'Помощница Миюнэя. Нажмите, чтобы открыть чат; правая кнопка мыши открывает меню');
  avatar.setAttribute('aria-haspopup', 'menu');
  const figure = element('img');
  figure.alt = ''; figure.draggable = false; figure.decoding = 'async';
  avatar.append(figure);

  const menu = element('div', 'assistant-menu');
  menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Настройки аватара'); menu.hidden = true;

  const chat = element('section', 'assistant-chat');
  chat.setAttribute('role', 'dialog'); chat.setAttribute('aria-label', 'Чат с Миюнэей'); chat.hidden = true;
  chat.innerHTML = '<header class="chat-head"><span class="face"><img alt="" draggable="false"></span><div class="chat-title"><b>Миюнэя</b><small></small></div><button type="button" class="chat-tool" data-chat-clear>Очистить</button><button type="button" class="icon-button" data-chat-close aria-label="Закрыть чат">×</button></header><div class="chat-log" aria-live="polite"></div><form class="chat-form"><textarea rows="3" maxlength="20000" aria-label="Сообщение" placeholder="Напишите сообщение… Enter — отправить, Shift+Enter — новая строка"></textarea><button class="button primary" type="submit">Отправить</button></form>'
    + ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'].map(dir => `<i class="chat-resize ${dir}" data-resize="${dir}" aria-hidden="true"></i>`).join('');
  const log = chat.querySelector<HTMLDivElement>('.chat-log')!;
  const form = chat.querySelector<HTMLFormElement>('.chat-form')!;
  const input = chat.querySelector<HTMLTextAreaElement>('textarea')!;
  const sendButton = form.querySelector<HTMLButtonElement>('button')!;
  const head = chat.querySelector<HTMLElement>('.chat-head')!;
  document.body.append(avatar, chat, menu);

  let history: Message[] = (stored<Message[]>('chat', []) || []).filter(m => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string').slice(-HISTORY_LIMIT);
  let position = stored<Point | null>('avatar-position', null);
  let frame = stored<Rect | null>('chat-frame', null);
  let pending = false;
  let error = '';
  let shownSrc = '';

  const size = () => Math.min(sizes[host.look().size], Math.round(innerHeight * .45), Math.round(innerWidth * .45));
  function place() {
    const look = host.look(); const px = size();
    if (!position || !finite(position.x, position.y)) position = { x: innerWidth - px - 28, y: innerHeight - px - 20 };
    position = { x: clamp(position.x, 0, innerWidth - px), y: clamp(position.y, 0, innerHeight - px) };
    avatar.style.left = position.x + 'px'; avatar.style.top = position.y + 'px';
    avatar.style.width = avatar.style.height = px + 'px';
    avatar.hidden = look.hidden;
    avatar.classList.toggle('mirror', look.mirror);
    const src = avatarUrl(look.avatar);
    if (shownSrc !== src) { figure.src = src; head.querySelector('img')!.src = src; shownSrc = src; }
  }
  function defaultFrame(): Rect {
    const w = Math.min(500, innerWidth - MARGIN * 2), h = Math.min(660, innerHeight - MARGIN * 2), px = size();
    const p = position || { x: innerWidth, y: innerHeight };
    const x = p.x - w - 16 >= MARGIN ? p.x - w - 16 : p.x + px + 16;
    return { x, y: p.y + px - h, w, h };
  }
  function fitFrame(rect: Rect): Rect {
    const w = clamp(rect.w, Math.min(MIN_W, innerWidth - MARGIN * 2), innerWidth - MARGIN * 2);
    const h = clamp(rect.h, Math.min(MIN_H, innerHeight - MARGIN * 2), innerHeight - MARGIN * 2);
    return { w, h, x: clamp(rect.x, MARGIN, innerWidth - w - MARGIN), y: clamp(rect.y, MARGIN, innerHeight - h - MARGIN) };
  }
  function placeChat() {
    const rect = fitFrame(frame && finite(frame.x, frame.y, frame.w, frame.h) ? frame : defaultFrame());
    chat.style.left = rect.x + 'px'; chat.style.top = rect.y + 'px'; chat.style.width = rect.w + 'px'; chat.style.height = rect.h + 'px';
    return rect;
  }

  function bubble(role: string, text: string) {
    const item = element('div', 'chat-message ' + role);
    item.append(element('p', '', text));
    return item;
  }
  function renderChat() {
    const status = host.status();
    chat.querySelector('.chat-title small')!.textContent = status.configured ? 'cloud.ru · ' + status.model : 'cloud.ru не подключён';
    log.replaceChildren();
    if (!status.configured) {
      const note = element('div', 'chat-note');
      note.append(element('p', '', 'Чтобы я могла отвечать, подключите cloud.ru: сохраните API-ключ и выберите модель.'));
      const link = element('a', 'button', 'Открыть настройки пространства'); link.href = '#settings';
      note.append(link); log.append(note);
    } else if (!history.length) log.append(element('div', 'chat-note', 'Здравствуйте! Я Миюнэя. Спросите о чём угодно — помогу разобраться с мыслями, заметками и делами.'));
    for (const m of history) log.append(bubble(m.role, m.content));
    if (pending) log.append(bubble('assistant typing', 'Миюнэя печатает…'));
    if (error) log.append(bubble('error', error));
    sendButton.disabled = pending;
    log.scrollTop = log.scrollHeight;
  }
  function openChat() {
    closeMenu();
    chat.hidden = false; placeChat(); renderChat(); input.focus();
  }
  function closeChat() { chat.hidden = true; avatar.focus(); }
  const toggleChat = () => chat.hidden ? openChat() : closeChat();

  async function send() {
    const text = input.value.trim();
    if (!text || pending) return;
    if (!host.status().configured) { error = ''; renderChat(); host.toast('Сначала подключите cloud.ru в настройках'); return; }
    history.push({ role: 'user', content: text }); input.value = ''; pending = true; error = '';
    history = history.slice(-HISTORY_LIMIT); remember('chat', history); renderChat();
    try {
      const response = await fetch('/api/assistant/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: history.slice(-40) }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Не удалось получить ответ.');
      history.push({ role: 'assistant', content: result.reply });
      history = history.slice(-HISTORY_LIMIT); remember('chat', history);
    } catch (e) {
      error = e instanceof TypeError ? 'Локальный сервер недоступен. Проверьте окно Miyuneya.bat.' : (e as Error).message;
    } finally { pending = false; if (!chat.hidden) renderChat(); }
  }
  form.addEventListener('submit', event => { event.preventDefault(); void send(); });
  input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void send(); } });
  chat.addEventListener('click', event => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('button,a');
    if (!target) return;
    if (target.hasAttribute('data-chat-close')) closeChat();
    if (target.hasAttribute('data-chat-clear')) { history = []; error = ''; forget('chat'); renderChat(); input.focus(); }
  });
  chat.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); closeChat(); } });

  // Shared pointer drag: calls move with the offset from the press point.
  function track(event: PointerEvent, target: HTMLElement, move: (dx: number, dy: number) => void, done: (moved: boolean) => void) {
    const startX = event.clientX, startY = event.clientY; let moved = false;
    target.setPointerCapture(event.pointerId);
    const onMove = (e: PointerEvent) => {
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
    const start = { ...position! };
    avatar.classList.add('dragging');
    track(event, avatar, (dx, dy) => { position = { x: start.x + dx, y: start.y + dy }; place(); }, moved => {
      avatar.classList.remove('dragging');
      suppressClick = moved;
      if (moved) remember('avatar-position', position);
    });
  });
  avatar.addEventListener('click', () => { if (suppressClick) { suppressClick = false; return; } toggleChat(); });
  avatar.addEventListener('keydown', event => {
    const step = event.shiftKey ? 40 : 10;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const delta = moves[event.key];
    if (!delta) return;
    event.preventDefault();
    position = { x: position!.x + delta[0], y: position!.y + delta[1] }; place(); remember('avatar-position', position);
  });
  avatar.addEventListener('contextmenu', event => {
    event.preventDefault();
    const rect = avatar.getBoundingClientRect();
    const fromKeyboard = event.button !== 2 && event.clientX === 0 && event.clientY === 0;
    openMenu(fromKeyboard ? rect.left : event.clientX, fromKeyboard ? rect.top : event.clientY);
  });

  head.addEventListener('pointerdown', event => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    const start = placeChat();
    track(event, head, (dx, dy) => { frame = fitFrame({ ...start, x: start.x + dx, y: start.y + dy }); placeChat(); }, moved => { if (moved) remember('chat-frame', frame); });
  });
  chat.addEventListener('pointerdown', event => {
    const handle = (event.target as HTMLElement).closest<HTMLElement>('[data-resize]');
    if (!handle || event.button !== 0) return;
    event.preventDefault();
    const dir = handle.dataset.resize!; const start = placeChat();
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

  function renderMenu() {
    const look = host.look();
    const item = (attrs: string, label: string, role = 'menuitem', checked?: boolean) => `<button type="button" role="${role}" ${checked === undefined ? '' : `aria-checked="${checked}"`} ${attrs}>${label}</button>`;
    menu.innerHTML = item('data-menu-chat', chat.hidden ? 'Открыть чат' : 'Закрыть чат')
      + '<p class="menu-label">Аватар</p><div class="menu-avatars" role="group" aria-label="Выбор аватара">'
      + [1, 2, 3, 4].map(n => `<button type="button" role="menuitemradio" aria-checked="${look.avatar === n}" aria-label="Аватар ${n}" data-menu-avatar="${n}"><img src="${avatarUrl(n)}" alt="" draggable="false" decoding="async"></button>`).join('')
      + '</div><p class="menu-label">Размер</p><div class="menu-sizes" role="group" aria-label="Размер аватара">'
      + sizeNames.map(([key, label]) => item(`data-menu-size="${key}"`, label, 'menuitemradio', look.size === key)).join('')
      + '</div><hr>' + item('data-menu-mirror', 'Отразить по горизонтали', 'menuitemcheckbox', look.mirror)
      + item('data-menu-reset', 'Вернуть в угол экрана')
      + item('data-menu-settings', 'Подключение cloud.ru…')
      + '<hr>' + item('data-menu-hide', 'Скрыть аватар');
  }
  function openMenu(x: number, y: number) {
    renderMenu(); menu.hidden = false;
    const rect = menu.getBoundingClientRect();
    menu.style.left = clamp(x, 8, innerWidth - rect.width - 8) + 'px';
    menu.style.top = clamp(y, 8, innerHeight - rect.height - 8) + 'px';
    menu.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }
  function closeMenu() { if (!menu.hidden) menu.hidden = true; }
  menu.addEventListener('click', event => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('button');
    if (!target) return;
    if (target.hasAttribute('data-menu-chat')) { closeMenu(); toggleChat(); return; }
    if (target.dataset.menuAvatar) host.update({ avatar: Number(target.dataset.menuAvatar) as AssistantLook['avatar'] });
    if (target.dataset.menuSize) host.update({ size: target.dataset.menuSize as AssistantLook['size'] });
    if (target.hasAttribute('data-menu-mirror')) host.update({ mirror: !host.look().mirror });
    if (target.hasAttribute('data-menu-reset')) { position = null; forget('avatar-position'); frame = null; forget('chat-frame'); place(); if (!chat.hidden) placeChat(); closeMenu(); return; }
    if (target.hasAttribute('data-menu-settings')) { closeMenu(); location.hash = 'settings'; return; }
    if (target.hasAttribute('data-menu-hide')) { closeMenu(); chat.hidden = true; host.update({ hidden: true }); host.toast('Аватар скрыт. Вернуть его можно в настройках пространства.'); return; }
    // Re-render with the new checks and keep focus on the same item.
    const same = [...target.attributes].filter(a => a.name.startsWith('data-menu')).map(a => `[${a.name}="${a.value}"]`).join('');
    renderMenu();
    menu.querySelector<HTMLElement>(same)?.focus();
  });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeMenu(); avatar.focus(); return; }
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const items = [...menu.querySelectorAll<HTMLElement>('button')];
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
    items[(items.indexOf(document.activeElement as HTMLElement) + step + items.length) % items.length]?.focus();
  });
  document.addEventListener('pointerdown', event => { if (!menu.hidden && !menu.contains(event.target as Node)) closeMenu(); });
  addEventListener('blur', closeMenu);
  addEventListener('resize', () => { closeMenu(); place(); if (!chat.hidden) placeChat(); });

  place();
  return {
    // Called by the host after appearance or the cloud.ru connection changes.
    refresh() { place(); if (!chat.hidden) { if (host.look().hidden) chat.hidden = true; else renderChat(); } },
  };
}
