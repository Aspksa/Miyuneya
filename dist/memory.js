// Generated from src/memory.ts by npm run build.
// The memory menu behind the brain icon: what Miyuneya knows, the rules she follows, past dialogs and her journal.
// Everything lives on the local server in data/memory.json; this panel only shows and edits it.
                                                                                                                                                                                                                       
                                                                                                                               
                                                                     
                                                                                                                                                                                                                                                                
                          
                               
                                           
                                                                     
                             
                                  
  
                                                   

export const brainIcon = '<path d="M12 5.4C11.3 4.1 9.6 3.6 8.4 4.3 7 3.9 5.5 5 5.5 6.6 4.1 7.2 3.6 8.9 4.3 10.2c-1 1-.9 2.8.3 3.6-.3 1.6.8 3.1 2.4 3.2.4 1.6 2.2 2.5 3.7 1.8.4.5.8.7 1.3.7Z" class="fill"/><path d="M12 5.4C11.3 4.1 9.6 3.6 8.4 4.3 7 3.9 5.5 5 5.5 6.6 4.1 7.2 3.6 8.9 4.3 10.2c-1 1-.9 2.8.3 3.6-.3 1.6.8 3.1 2.4 3.2.4 1.6 2.2 2.5 3.7 1.8.4.5.8.7 1.3.7Z" class="fill" transform="matrix(-1 0 0 1 24 0)"/><path d="M12 5.4v14.1M12 9.2c-1.3 0-2.2-.8-2.3-2M9.6 12.3c-1.4-.4-2.8.2-3.4 1.4M12 15.6c-1.2 0-2.2-.7-2.5-1.8M12 9.2c1.3 0 2.2-.8 2.3-2M14.4 12.3c1.4-.4 2.8.2 3.4 1.4M12 15.6c1.2 0 2.2-.7 2.5-1.8M6.7 8.9c.6.5 1.4.7 2.1.5M17.3 8.9c-.6.5-1.4.7-2.1.5" class="accent-stroke"/>';
const tabs                  = [['fact', 'Факты'], ['rule', 'Правила'], ['episode', 'Эпизоды'], ['journal', 'Журнал']];
const sources                                           = { user: 'от вас', dialog: 'из разговора', sleep: 'после сна' };
const journalNames                         = { learned: 'Узнала', rule: 'Правило', reinforced: 'Подтвердилось', weakened: 'Сомнение', merged: 'Объединила', forgot: 'Забыла', episode: 'Эпизод', sleep: 'Сон', edited: 'Правка' };
const escape = (value        ) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ));
const when = (date        , time = false) => new Date(date).toLocaleString('ru-RU', time ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'long' });
export const strengthLabel = (item                                             ) => item.pinned ? 'закреплено' : item.strength >= 0.7 ? 'уверена' : item.strength >= 0.4 ? 'помню' : 'гаснет';

export function mountMemory(host            ) {
  const panel = document.createElement('section');
  panel.className = 'memory-panel'; panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Память Миюнэи');
  document.body.append(panel);
  let view                    = null;
  let tab      = 'fact';
  let editing = '';
  let busy = false;
  let poll                                           ;

  async function request(path        , init                                   ) {
    const response = await fetch('/api/memory' + path, init?.json === undefined ? init : { ...init, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.json) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Не удалось обновить память.');
    view = result              ; host.changed(view);
    return view;
  }
  async function act(path        , init                                   , done         ) {
    if (busy) return false;
    busy = true; render();
    try { await request(path, init); if (done) host.toast(done); return true; }
    catch (e) { host.toast(e instanceof TypeError ? 'Сервер недоступен.' : (e         ).message); return false; }
    finally { busy = false; render(); }
  }
  function linkChips(links          ) {
    const chips = links.map(id => {
      const entry = host.entry(id);
      if (entry) return entry.kind === 'note' ? `<button type="button" class="memory-link" data-memory-note="${escape(id)}">Заметка «${escape(entry.title)}»</button>` : `<span class="memory-link">Задача «${escape(entry.title)}»</span>`;
      const item = view?.items.find(i => i.id === id);
      if (item) return `<button type="button" class="memory-link" data-memory-goto="${escape(id)}" data-tab="${item.kind}">${item.kind === 'rule' ? 'Правило' : 'Факт'}: ${escape(item.text.length > 40 ? item.text.slice(0, 40) + '…' : item.text)}</button>`;
      const episode = view?.episodes.find(e => e.id === id);
      return episode ? `<button type="button" class="memory-link" data-memory-goto="${escape(id)}" data-tab="episode">Разговор ${when(episode.date)}</button>` : '';
    }).filter(Boolean);
    return chips.length ? `<div class="memory-links">${chips.join('')}</div>` : '';
  }
  function itemRow(item                ) {
    const id = escape(item.id);
    const body = editing === item.id
      ? `<form class="memory-edit" data-memory-save="${id}"><textarea name="text" maxlength="400" rows="3" aria-label="Текст записи">${escape(item.text)}</textarea><div><button class="button primary" type="submit">Сохранить</button><button class="button quiet" type="button" data-memory-cancel>Отмена</button></div></form>`
      : `<p>${escape(item.text)}</p>`;
    return `<article class="memory-item ${item.pinned ? 'pinned' : ''}" id="memory-${id}">${body}<div class="memory-meta"><span class="meter" data-strength="${item.pinned ? 1 : item.strength}" title="Сила памяти ${Math.round(item.strength * 100)}%"><i></i></span><span>${strengthLabel(item)} · подтверждений ${item.hits} · ${sources[item.source]} · ${when(item.seen)}</span></div>${linkChips(item.links)}<div class="memory-actions"><button type="button" class="chat-link" data-memory-edit="${id}">Изменить</button><button type="button" class="chat-link" data-memory-pin="${id}" aria-pressed="${item.pinned}">${item.pinned ? 'Открепить' : 'Закрепить'}</button><button type="button" class="chat-link danger" data-memory-delete="${id}">Удалить</button></div></article>`;
  }
  function episodeRow(e             ) {
    const id = escape(e.id);
    const body = editing === e.id
      ? `<form class="memory-edit" data-memory-save="${id}"><input name="topic" maxlength="200" value="${escape(e.topic)}" aria-label="Тема"><textarea name="outcome" maxlength="600" rows="3" aria-label="Итог">${escape(e.outcome)}</textarea><div><button class="button primary" type="submit">Сохранить</button><button class="button quiet" type="button" data-memory-cancel>Отмена</button></div></form>`
      : `<p><b>${escape(e.topic)}</b>${e.outcome ? '<br>' + escape(e.outcome) : ''}</p>`;
    return `<article class="memory-item" id="memory-${id}">${body}<div class="memory-meta"><span>${when(e.date, true)}${e.consolidated ? '' : ' · <em>ещё не осмыслен во сне</em>'}</span></div>${linkChips(e.links)}<div class="memory-actions"><button type="button" class="chat-link" data-memory-edit="${id}">Изменить</button><button type="button" class="chat-link danger" data-memory-delete="${id}">Удалить</button></div></article>`;
  }
  function listHtml() {
    if (!view) return '<p class="memory-empty">Загружаю память…</p>';
    if (tab === 'journal') return view.journal.length ? view.journal.map(j => `<div class="memory-journal"><small>${when(j.at, true)}</small><b>${journalNames[j.kind] || 'Запись'}</b><span>${escape(j.text)}</span></div>`).join('') : '<p class="memory-empty">Здесь появится история: что Миюнэя узнала, объединила и забыла.</p>';
    if (tab === 'episode') return view.episodes.length ? view.episodes.map(episodeRow).join('') : '<p class="memory-empty">Эпизодов пока нет. После разговора Миюнэя запишет, о чём он был и чем закончился.</p>';
    const items = view.items.filter(i => i.kind === tab);
    return items.length ? items.map(itemRow).join('') : `<p class="memory-empty">${tab === 'fact' ? 'Фактов пока нет. Миюнэя запоминает ваши предпочтения и обстоятельства из разговоров, или скажите ей «запомни, что…».' : 'Правил пока нет. Они появляются из ваших просьб и поправок, например «отвечай короче».'}</p>`;
  }
  function statusLine() {
    if (!view) return '';
    if (!view.enabled) return 'Память выключена: Миюнэя ничего не вспоминает и не запоминает';
    if (view.busy) return view.busy === 'sleep' ? 'Сейчас сон: перечитываю эпизоды и навожу порядок…' : 'Разбираю недавний разговор…';
    if (!view.available) return 'Подключите cloud.ru, чтобы память пополнялась сама';
    return `Сон: ${view.lastSleep ? when(view.lastSleep, true) : 'ещё не было'} · новых эпизодов ${view.newEpisodes}${view.private ? ' · приватный режим' : ''}`;
  }
  function render() {
    if (panel.hidden) return;
    const count = (t     ) => !view ? '' : t === 'journal' ? '' : String(t === 'episode' ? view.episodes.length : view.items.filter(i => i.kind === t).length);
    const scroll = panel.querySelector('.memory-list')?.scrollTop || 0;
    const off = !view || busy ? 'disabled' : '';
    panel.innerHTML = `<header class="memory-head"><span class="memory-mark"><svg viewBox="0 0 24 24" aria-hidden="true">${brainIcon}</svg></span><div><b>Память Миюнэи</b><small>${escape(statusLine())}</small></div><button type="button" class="icon-button" data-memory-close aria-label="Закрыть память">×</button></header>`
      + `<div class="memory-switches"><label class="switch"><input type="checkbox" data-memory-enabled ${view?.enabled ? 'checked' : ''} ${off}><span>Память включена</span></label><label class="switch"><input type="checkbox" data-memory-private ${view?.private ? 'checked' : ''} ${off || (view?.enabled ? '' : 'disabled')}><span>Приватный режим: новые разговоры не запоминаются</span></label></div>`
      + `<div class="memory-tabs" role="tablist">${tabs.map(([key, label]) => `<button type="button" role="tab" aria-selected="${tab === key}" class="${tab === key ? 'active' : ''}" data-memory-tab="${key}">${label}${count(key) ? ` <small>${count(key)}</small>` : ''}</button>`).join('')}</div>`
      + `<div class="memory-list" role="tabpanel">${listHtml()}</div>`
      + (tab === 'fact' || tab === 'rule' ? `<form class="memory-add"><input name="text" maxlength="400" autocomplete="off" placeholder="${tab === 'fact' ? 'Добавить факт, например «работает по утрам»' : 'Добавить правило, например «задачи писать коротко»'}" aria-label="Новая запись" ${off}><button class="button" type="submit" ${off}>Добавить</button></form>` : '')
      + `<footer class="memory-foot"><button type="button" class="button" data-memory-sleep ${off || (view?.available && view.enabled ? '' : 'disabled')}>Уснуть сейчас</button><a class="button" href="/api/memory/export" download>Экспорт</a><button type="button" class="button quiet danger" data-memory-reset ${off}>Сбросить</button></footer>`;
    for (const meter of panel.querySelectorAll             ('[data-strength]')) meter.style.setProperty('--strength', String(Math.max(0.04, Number(meter.dataset.strength))));
    const list = panel.querySelector('.memory-list'); if (list) list.scrollTop = scroll;
    clearTimeout(poll);
    if (view?.busy) poll = setTimeout(() => void refresh(), 3000);
  }
  async function refresh() {
    try { await request(''); } catch {}
    render();
  }
  function open() { panel.hidden = false; render(); void refresh(); panel.querySelector             ('[data-memory-close]')?.focus(); sync(); }
  function close() { if (panel.hidden) return; panel.hidden = true; editing = ''; clearTimeout(poll); sync(); document.querySelector             ('[data-memory-toggle]')?.focus(); }
  const sync = () => document.querySelector('[data-memory-toggle]')?.setAttribute('aria-expanded', String(!panel.hidden));

  panel.addEventListener('click', async event => {
    const target = (event.target               ).closest             ('button');
    if (!target) return;
    const d = target.dataset;
    if (target.hasAttribute('data-memory-close')) return close();
    if (d.memoryTab) { tab = d.memoryTab       ; editing = ''; render(); panel.querySelector('.memory-list') .scrollTop = 0; return; }
    if (d.memoryEdit) { editing = d.memoryEdit; render(); panel.querySelector             ('.memory-edit textarea, .memory-edit input')?.focus(); return; }
    if (target.hasAttribute('data-memory-cancel')) { editing = ''; render(); return; }
    if (d.memoryNote) { close(); host.openNote(d.memoryNote); return; }
    if (d.memoryGoto) {
      tab = d.tab       ; editing = ''; render();
      const row = panel.querySelector             ('#memory-' + CSS.escape(d.memoryGoto));
      row?.scrollIntoView({ block: 'nearest' }); row?.classList.add('flash');
      return;
    }
    if (d.memoryPin) { const item = view?.items.find(i => i.id === d.memoryPin); if (item) await act('/items/' + item.id, { method: 'PATCH', json: { pinned: !item.pinned } }, item.pinned ? 'Запись откреплена' : 'Закреплено: эта запись не будет забыта'); return; }
    if (d.memoryDelete && await host.confirm('Удалить запись из памяти?')) { await act('/items/' + d.memoryDelete, { method: 'DELETE' }, 'Запись удалена'); return; }
    if (target.hasAttribute('data-memory-sleep')) { await act('/sleep', { method: 'POST' }, 'Сон завершён: память упорядочена'); return; }
    if (target.hasAttribute('data-memory-reset') && await host.confirm('Стереть всю память Миюнэи?')) { await act('', { method: 'DELETE' }, 'Память очищена'); return; }
  });
  panel.addEventListener('change', event => {
    const input = event.target                    ;
    if (input.hasAttribute('data-memory-enabled')) void act('', { method: 'PUT', json: { enabled: input.checked } }, input.checked ? 'Память включена' : 'Память выключена');
    if (input.hasAttribute('data-memory-private')) void act('', { method: 'PUT', json: { private: input.checked } }, input.checked ? 'Приватный режим: разговоры не запоминаются' : 'Приватный режим выключен');
  });
  panel.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target                   ;
    const field = (name        ) => (form.elements.namedItem(name)                           )?.value.trim();
    if (form.classList.contains('memory-add')) {
      const text = field('text');
      if (text && await act('/items', { method: 'POST', json: { kind: tab, text } }, tab === 'rule' ? 'Правило добавлено' : 'Факт добавлен')) panel.querySelector                  ('.memory-add input')?.focus();
      return;
    }
    const id = form.dataset.memorySave;
    if (!id) return;
    const change = tab === 'episode' ? { topic: field('topic'), outcome: field('outcome') } : { text: field('text') };
    if (tab !== 'episode' && !change.text) return host.toast('Запись не может быть пустой');
    editing = '';
    await act('/items/' + id, { method: 'PATCH', json: change }, 'Запись исправлена');
  });
  panel.addEventListener('keydown', event => { if (event.key === 'Escape' && !(event.target               ).closest('.memory-edit')) { event.stopPropagation(); close(); } });
  document.addEventListener('pointerdown', event => {
    const target = event.target               ;
    if (!panel.hidden && !panel.contains(target) && !target.closest('[data-memory-toggle], dialog')) close();
  });

  return {
    toggle() { panel.hidden ? open() : close(); },
    isOpen: () => !panel.hidden,
    refresh,
    load: () => request('').catch(() => null),
  };
}
