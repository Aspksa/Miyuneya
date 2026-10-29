// The memory menu behind the brain icon: what Miyuneya knows, the rules she follows, past dialogs, the knowledge map and her journal.
// Everything lives on the local server in data/memory.json; this panel only shows and edits it.
export type Category = 'personal' | 'work' | 'health' | 'plans' | 'tastes' | 'people' | 'other';
export type MemoryItemView = { id: string; kind: 'fact' | 'rule'; text: string; strength: number; hits: number; created: string; seen: string; pinned: boolean; source: 'user' | 'dialog' | 'sleep' | 'note'; links: string[]; category: Category; until: string | null; expired: boolean };
export type EpisodeView = { id: string; date: string; topic: string; outcome: string; links: string[]; consolidated: boolean };
export type EntityView = { id: string; name: string; type: 'person' | 'project' | 'place' | 'topic' | 'thing'; about: string; aliases: string[]; degree: number };
export type EdgeView = { from: string; to: string; type: 'related' | 'part_of' | 'blocks' | 'after' | 'decided_in' | 'about' };
export type DiaryView = { id: string; date: string; text: string };
export type JournalView = { at: string; kind: string; text: string };
export type MemoryView = { enabled: boolean; private: boolean; available: boolean; busy: 'reflect' | 'sleep' | null; lastSleep: string | null; pending: number; newEpisodes: number;
  search: 'meaning' | 'words'; searchError: string; indexed: number;
  items: MemoryItemView[]; episodes: EpisodeView[]; entities: EntityView[]; edges: EdgeView[]; diary: DiaryView[]; journal: JournalView[] };
export type MemoryHost = {
  toast(message: string): void;
  confirm(title: string): Promise<boolean>;
  entry(id: string): { kind: 'note' | 'task'; title: string } | null;
  openNote(id: string): void;
  changed(view: MemoryView): void;
};
export type Tab = 'fact' | 'rule' | 'episode' | 'map' | 'diary' | 'journal';
type Request = RequestInit & { json?: unknown };

export const brainIcon = '<path d="M12 5.4C11.3 4.1 9.6 3.6 8.4 4.3 7 3.9 5.5 5 5.5 6.6 4.1 7.2 3.6 8.9 4.3 10.2c-1 1-.9 2.8.3 3.6-.3 1.6.8 3.1 2.4 3.2.4 1.6 2.2 2.5 3.7 1.8.4.5.8.7 1.3.7Z" class="fill"/><path d="M12 5.4C11.3 4.1 9.6 3.6 8.4 4.3 7 3.9 5.5 5 5.5 6.6 4.1 7.2 3.6 8.9 4.3 10.2c-1 1-.9 2.8.3 3.6-.3 1.6.8 3.1 2.4 3.2.4 1.6 2.2 2.5 3.7 1.8.4.5.8.7 1.3.7Z" class="fill" transform="matrix(-1 0 0 1 24 0)"/><path d="M12 5.4v14.1M12 9.2c-1.3 0-2.2-.8-2.3-2M9.6 12.3c-1.4-.4-2.8.2-3.4 1.4M12 15.6c-1.2 0-2.2-.7-2.5-1.8M12 9.2c1.3 0 2.2-.8 2.3-2M14.4 12.3c1.4-.4 2.8.2 3.4 1.4M12 15.6c1.2 0 2.2-.7 2.5-1.8M6.7 8.9c.6.5 1.4.7 2.1.5M17.3 8.9c-.6.5-1.4.7-2.1.5" class="accent-stroke"/>';
const tabs: [Tab, string][] = [['fact', 'Факты'], ['rule', 'Правила'], ['episode', 'Эпизоды'], ['map', 'Карта'], ['diary', 'Дневник'], ['journal', 'Журнал']];
export const categories: [Category, string][] = [['personal', 'Личное'], ['work', 'Работа'], ['health', 'Здоровье'], ['plans', 'Планы'], ['tastes', 'Вкусы'], ['people', 'Люди'], ['other', 'Другое']];
const categoryName = (c: Category) => categories.find(([key]) => key === c)?.[1] || 'Другое';
const sources: Record<MemoryItemView['source'], string> = { user: 'от вас', dialog: 'из разговора', sleep: 'после сна', note: 'из заметки' };
const entityTypes: Record<EntityView['type'], string> = { person: 'Человек', project: 'Проект', place: 'Место', topic: 'Тема', thing: 'Вещь' };
export const relationNames: Record<EdgeView['type'], string> = { related: 'связано с', part_of: 'часть', blocks: 'мешает', after: 'после', decided_in: 'решено в', about: 'про' };
const journalNames: Record<string, string> = { learned: 'Узнала', rule: 'Правило', reinforced: 'Подтвердилось', weakened: 'Сомнение', merged: 'Объединила', forgot: 'Забыла', episode: 'Эпизод', sleep: 'Сон', edited: 'Правка', entity: 'Карта' };
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const when = (date: string, time = false) => new Date(date).toLocaleString('ru-RU', time ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'long' });
const short = (text: string, max: number) => text.length > max ? text.slice(0, max - 1) + '…' : text;
export const strengthLabel = (item: Pick<MemoryItemView, 'pinned' | 'strength'>) => item.pinned ? 'закреплено' : item.strength >= 0.7 ? 'уверена' : item.strength >= 0.4 ? 'помню' : 'гаснет';

// The knowledge map: entities, facts, rules and episodes that have connections, plus the notes and tasks they point to.
export type GraphNode = { id: string; kind: 'entity' | 'fact' | 'rule' | 'episode' | 'note' | 'task'; label: string; text: string; x: number; y: number; size: number };
export type GraphEdge = { from: string; to: string; type: EdgeView['type'] };
export function buildGraph(view: Pick<MemoryView, 'items' | 'episodes' | 'entities' | 'edges'>, entry: MemoryHost['entry'], limit = 90) {
  const nodes = new Map<string, Omit<GraphNode, 'x' | 'y' | 'size'>>();
  for (const e of view.entities) nodes.set(e.id, { id: e.id, kind: 'entity', label: e.name, text: `${entityTypes[e.type]}${e.about ? ': ' + e.about : ''}` });
  for (const i of view.items) nodes.set(i.id, { id: i.id, kind: i.kind, label: i.text, text: i.text });
  for (const e of view.episodes) nodes.set(e.id, { id: e.id, kind: 'episode', label: `${when(e.date)}: ${e.topic}`, text: e.outcome ? `${e.topic} — ${e.outcome}` : e.topic });
  const raw: GraphEdge[] = [...view.edges];
  for (const r of [...view.items, ...view.episodes]) for (const link of r.links) raw.push({ from: r.id, to: link, type: 'related' });
  const resolve = (id: string) => {
    if (nodes.has(id)) return true;
    const found = entry(id);
    if (found) nodes.set(id, { id, kind: found.kind, label: found.title, text: (found.kind === 'note' ? 'Заметка: ' : 'Задача: ') + found.title });
    return !!found;
  };
  const edges = raw.filter((e, i) => e.from !== e.to && resolve(e.from) && resolve(e.to) && raw.findIndex(x => (x.from === e.from && x.to === e.to) || (x.from === e.to && x.to === e.from && e.type === 'related')) === i);
  const degree = new Map<string, number>();
  for (const e of edges) for (const id of [e.from, e.to]) degree.set(id, (degree.get(id) || 0) + 1);
  // Only connected records make the map; the most connected come first when it has to be cut.
  const kept = [...nodes.values()].filter(n => degree.has(n.id) || n.kind === 'entity').sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0)).slice(0, limit);
  const ids = new Set(kept.map(n => n.id));
  return { nodes: kept.map(n => ({ ...n, x: 0, y: 0, size: Math.min(16, 6 + 2 * Math.sqrt(degree.get(n.id) || 0)) + (n.kind === 'entity' ? 3 : 0) })), edges: edges.filter(e => ids.has(e.from) && ids.has(e.to)) };
}
// A small deterministic force layout (Fruchterman–Reingold), so the same memory always draws the same map.
export function layoutGraph(graph: { nodes: GraphNode[]; edges: GraphEdge[] }, width = 640, height = 440, rounds = 260) {
  const { nodes, edges } = graph;
  if (!nodes.length) return graph;
  const hash = (text: string) => { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };
  nodes.forEach((n, i) => { const angle = 2 * Math.PI * (i / nodes.length) + hash(n.id); const r = 0.35 + 0.1 * hash(n.id + 'r'); n.x = width / 2 + Math.cos(angle) * width * r; n.y = height / 2 + Math.sin(angle) * height * r; });
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const k = Math.sqrt((width * height) / nodes.length) * 0.8;
  for (let round = 0; round < rounds; round++) {
    const heat = (Math.min(width, height) / 8) * (1 - round / rounds) + 1;
    const dx = new Float64Array(nodes.length), dy = new Float64Array(nodes.length);
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      let x = nodes[i].x - nodes[j].x, y = nodes[i].y - nodes[j].y;
      const d = Math.max(0.01, Math.hypot(x, y)); const f = (k * k) / d;
      x /= d; y /= d; dx[i] += x * f; dy[i] += y * f; dx[j] -= x * f; dy[j] -= y * f;
    }
    for (const e of edges) {
      const a = index.get(e.from)!, b = index.get(e.to)!;
      let x = nodes[a].x - nodes[b].x, y = nodes[a].y - nodes[b].y;
      const d = Math.max(0.01, Math.hypot(x, y)); const f = (d * d) / k;
      x /= d; y /= d; dx[a] -= x * f; dy[a] -= y * f; dx[b] += x * f; dy[b] += y * f;
    }
    nodes.forEach((n, i) => {
      dx[i] += (width / 2 - n.x) * 0.02 * k / 10; dy[i] += (height / 2 - n.y) * 0.02 * k / 10;
      const d = Math.max(0.01, Math.hypot(dx[i], dy[i]));
      n.x = Math.min(width - 30, Math.max(30, n.x + (dx[i] / d) * Math.min(d, heat)));
      n.y = Math.min(height - 24, Math.max(20, n.y + (dy[i] / d) * Math.min(d, heat)));
    });
  }
  return graph;
}

export function mountMemory(host: MemoryHost) {
  const panel = document.createElement('section');
  panel.className = 'memory-panel'; panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Память Миюнэи');
  document.body.append(panel);
  let view: MemoryView | null = null;
  let tab: Tab = 'fact';
  let filter: Category | 'all' = 'all';
  let editing = '';
  let selected = '';
  let busy = false;
  let poll: ReturnType<typeof setTimeout> | undefined;
  let graphKey = ''; let graph: ReturnType<typeof buildGraph> | null = null;

  async function request(path: string, init?: Request) {
    const response = await fetch('/api/memory' + path, init?.json === undefined ? init : { ...init, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.json) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Не удалось обновить память.');
    view = result as MemoryView; host.changed(view);
    return view;
  }
  async function act(path: string, init?: Request, done?: string) {
    if (busy) return false;
    busy = true; render();
    try { await request(path, init); if (done) host.toast(done); return true; }
    catch (e) { host.toast(e instanceof TypeError ? 'Сервер недоступен.' : (e as Error).message); return false; }
    finally { busy = false; render(); }
  }
  function linkChips(links: string[]) {
    const chips = links.map(id => {
      const entry = host.entry(id);
      if (entry) return entry.kind === 'note' ? `<button type="button" class="memory-link" data-memory-note="${escape(id)}">Заметка «${escape(entry.title)}»</button>` : `<span class="memory-link">Задача «${escape(entry.title)}»</span>`;
      const item = view?.items.find(i => i.id === id);
      if (item) return `<button type="button" class="memory-link" data-memory-goto="${escape(id)}" data-tab="${item.kind}">${item.kind === 'rule' ? 'Правило' : 'Факт'}: ${escape(short(item.text, 40))}</button>`;
      const episode = view?.episodes.find(e => e.id === id);
      if (episode) return `<button type="button" class="memory-link" data-memory-goto="${escape(id)}" data-tab="episode">Разговор ${when(episode.date)}</button>`;
      const entity = view?.entities.find(e => e.id === id);
      return entity ? `<button type="button" class="memory-link" data-memory-select="${escape(id)}">${escape(entity.name)}</button>` : '';
    }).filter(Boolean);
    return chips.length ? `<div class="memory-links">${chips.join('')}</div>` : '';
  }
  // Entities and typed relations of a record show next to its plain links.
  const related = (id: string) => (view?.edges || []).filter(e => e.from === id || e.to === id).map(e => e.from === id ? e.to : e.from);
  const categorySelect = (value: Category) => `<select name="category" aria-label="Категория">${categories.map(([key, label]) => `<option value="${key}" ${key === value ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
  function itemRow(item: MemoryItemView) {
    const id = escape(item.id);
    const fact = item.kind === 'fact';
    const body = editing === item.id
      ? `<form class="memory-edit" data-memory-save="${id}"><textarea name="text" maxlength="400" rows="3" aria-label="Текст записи">${escape(item.text)}</textarea>${fact ? `<div class="memory-fields">${categorySelect(item.category)}<label>Актуально до <input type="date" name="until" value="${item.until || ''}"></label></div>` : ''}<div><button class="button primary" type="submit">Сохранить</button><button class="button quiet" type="button" data-memory-cancel>Отмена</button></div></form>`
      : `<p>${fact && item.category !== 'other' ? `<span class="memory-tag">${categoryName(item.category)}</span>` : ''}${escape(item.text)}</p>`;
    const until = item.until ? ` · ${item.expired ? '<em>устарело</em>' : 'до ' + when(item.until)}` : '';
    return `<article class="memory-item ${item.pinned ? 'pinned' : ''} ${item.expired ? 'expired' : ''}" id="memory-${id}">${body}<div class="memory-meta"><span class="meter" data-strength="${item.pinned ? 1 : item.strength}" title="Сила памяти ${Math.round(item.strength * 100)}%"><i></i></span><span>${strengthLabel(item)} · подтверждений ${item.hits} · ${sources[item.source]} · ${when(item.seen)}${until}</span></div>${linkChips([...item.links, ...related(item.id)])}<div class="memory-actions"><button type="button" class="chat-link" data-memory-edit="${id}">Изменить</button><button type="button" class="chat-link" data-memory-pin="${id}" aria-pressed="${item.pinned}">${item.pinned ? 'Открепить' : 'Закрепить'}</button><button type="button" class="chat-link" data-memory-select="${id}">На карте</button><button type="button" class="chat-link danger" data-memory-delete="${id}">Удалить</button></div></article>`;
  }
  function episodeRow(e: EpisodeView) {
    const id = escape(e.id);
    const body = editing === e.id
      ? `<form class="memory-edit" data-memory-save="${id}"><input name="topic" maxlength="200" value="${escape(e.topic)}" aria-label="Тема"><textarea name="outcome" maxlength="600" rows="3" aria-label="Итог">${escape(e.outcome)}</textarea><div><button class="button primary" type="submit">Сохранить</button><button class="button quiet" type="button" data-memory-cancel>Отмена</button></div></form>`
      : `<p><b>${escape(e.topic)}</b>${e.outcome ? '<br>' + escape(e.outcome) : ''}</p>`;
    return `<article class="memory-item" id="memory-${id}">${body}<div class="memory-meta"><span>${when(e.date, true)}${e.consolidated ? '' : ' · <em>ещё не осмыслен во сне</em>'}</span></div>${linkChips([...e.links, ...related(e.id)])}<div class="memory-actions"><button type="button" class="chat-link" data-memory-edit="${id}">Изменить</button><button type="button" class="chat-link" data-memory-select="${id}">На карте</button><button type="button" class="chat-link danger" data-memory-delete="${id}">Удалить</button></div></article>`;
  }
  // Diary entries are written by Miyuneya herself during sleep; the user may correct or delete any of them.
  function diaryRow(e: DiaryView) {
    const id = escape(e.id);
    const body = editing === e.id
      ? `<form class="memory-edit" data-memory-save="${id}"><textarea name="text" maxlength="2000" rows="5" aria-label="Запись дневника">${escape(e.text)}</textarea><div><button class="button primary" type="submit">Сохранить</button><button class="button quiet" type="button" data-memory-cancel>Отмена</button></div></form>`
      : `<p>${escape(e.text)}</p>`;
    return `<article class="memory-item diary-entry" id="memory-${id}"><h3>${new Date(e.date).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h3>${body}<div class="memory-actions"><button type="button" class="chat-link" data-memory-edit="${id}">Изменить</button><button type="button" class="chat-link danger" data-memory-delete="${id}" data-what="diary">Удалить</button></div></article>`;
  }
  function currentGraph() {
    if (!view) return null;
    const key = JSON.stringify([view.items.map(i => i.id + i.links.join()), view.episodes.map(e => e.id + e.links.join()), view.entities.map(e => e.id), view.edges]);
    if (key !== graphKey) { graph = layoutGraph(buildGraph(view, host.entry)); graphKey = key; }
    return graph;
  }
  function mapHtml() {
    const g = currentGraph();
    if (!g || !g.nodes.length) return '<p class="memory-empty">Карта появится, когда Миюнэя узнает о людях, проектах и темах и свяжет их с фактами, разговорами, заметками и задачами.</p>';
    const pos = new Map(g.nodes.map(n => [n.id, n]));
    const near = new Set(selected ? g.edges.flatMap(e => e.from === selected ? [e.to] : e.to === selected ? [e.from] : []) : []);
    const lines = g.edges.map(e => {
      const a = pos.get(e.from)!, b = pos.get(e.to)!; const on = selected && (e.from === selected || e.to === selected);
      return `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" class="edge ${e.type} ${on ? 'on' : selected ? 'dim' : ''}"/>`
        + (on && e.type !== 'related' ? `<text class="edge-label" x="${((a.x + b.x) / 2).toFixed(1)}" y="${((a.y + b.y) / 2 - 3).toFixed(1)}">${relationNames[e.type]}</text>` : '');
    }).join('');
    const dots = g.nodes.map(n => `<g class="node ${n.kind} ${n.id === selected ? 'on' : selected && !near.has(n.id) ? 'dim' : ''}" data-node="${escape(n.id)}" tabindex="0" role="button" aria-label="${escape(n.label)}"><circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.size.toFixed(1)}"/><text x="${n.x.toFixed(1)}" y="${(n.y + n.size + 11).toFixed(1)}">${escape(short(n.label, n.kind === 'entity' ? 22 : 18))}</text></g>`).join('');
    const legend = (['entity', 'fact', 'rule', 'episode', 'note', 'task'] as const).map(k => `<span><i class="dot ${k}"></i>${({ entity: 'люди, проекты, темы', fact: 'факты', rule: 'правила', episode: 'разговоры', note: 'заметки', task: 'задачи' })[k]}</span>`).join('');
    return `<div class="memory-map"><svg viewBox="0 0 640 440" role="img" aria-label="Карта знаний Миюнэи">${lines}${dots}</svg><div class="map-legend">${legend}</div></div>${detailHtml(g)}`;
  }
  function detailHtml(g: ReturnType<typeof buildGraph>) {
    const node = g.nodes.find(n => n.id === selected);
    if (!node) return '<p class="memory-empty">Нажмите на точку, чтобы увидеть её связи.</p>';
    const name = (id: string) => g.nodes.find(n => n.id === id)?.label || 'запись';
    const links = g.edges.filter(e => e.from === node.id || e.to === node.id).map(e => {
      const other = e.from === node.id ? e.to : e.from;
      const [from, to] = e.from === node.id ? [node.label, name(other)] : [name(other), node.label];
      const phrase = `${escape(short(from, 40))} → ${relationNames[e.type]} → ${escape(short(to, 40))}`;
      return `<li><button type="button" class="chat-link" data-memory-select="${escape(other)}">${phrase}</button><button type="button" class="chat-link danger" data-memory-unlink="${escape(other)}" aria-label="Убрать связь">×</button></li>`;
    }).join('');
    const entity = view?.entities.find(e => e.id === node.id);
    const edit = entity && editing === entity.id
      ? `<form class="memory-edit" data-memory-save="${escape(entity.id)}"><input name="name" maxlength="80" value="${escape(entity.name)}" aria-label="Имя"><textarea name="about" maxlength="300" rows="2" aria-label="Кто или что это">${escape(entity.about)}</textarea><div><button class="button primary" type="submit">Сохранить</button><button class="button quiet" type="button" data-memory-cancel>Отмена</button></div></form>` : '';
    const actions = node.kind === 'entity' ? `<button type="button" class="chat-link" data-memory-edit="${escape(node.id)}">Изменить</button><button type="button" class="chat-link danger" data-memory-delete="${escape(node.id)}">Удалить</button>`
      : node.kind === 'note' ? `<button type="button" class="chat-link" data-memory-note="${escape(node.id)}">Открыть заметку</button>`
      : node.kind === 'task' ? '' : `<button type="button" class="chat-link" data-memory-goto="${escape(node.id)}" data-tab="${node.kind}">Открыть запись</button>`;
    return `<div class="map-detail"><b>${escape(node.label)}</b>${node.text && node.text !== node.label ? `<p>${escape(node.text)}</p>` : ''}${edit}${links ? `<ul>${links}</ul>` : ''}<div class="memory-actions">${actions}</div></div>`;
  }
  function listHtml() {
    if (!view) return '<p class="memory-empty">Загружаю память…</p>';
    if (tab === 'map') return mapHtml();
    if (tab === 'diary') return view.diary.length ? '<p class="memory-note">Записи пишет сама Миюнэя после «сна». Любую можно поправить или удалить.</p>' + [...view.diary].sort((a, b) => b.date.localeCompare(a.date)).map(diaryRow).join('') : '<p class="memory-empty">Дневник пока пуст. Каждый раз во время сна Миюнэя записывает сюда, что узнала о вас и что изменила в себе.</p>';
    if (tab === 'journal') return view.journal.length ? view.journal.map(j => `<div class="memory-journal"><small>${when(j.at, true)}</small><b>${journalNames[j.kind] || 'Запись'}</b><span>${escape(j.text)}</span></div>`).join('') : '<p class="memory-empty">Здесь появится история: что Миюнэя узнала, объединила и забыла.</p>';
    if (tab === 'episode') return view.episodes.length ? view.episodes.map(episodeRow).join('') : '<p class="memory-empty">Эпизодов пока нет. После разговора Миюнэя запишет, о чём он был и чем закончился.</p>';
    const all = view.items.filter(i => i.kind === tab);
    const items = tab === 'fact' && filter !== 'all' ? all.filter(i => i.category === filter) : all;
    const chips = tab === 'fact' && all.length ? `<div class="memory-filter" role="group" aria-label="Категории">${[['all', 'Все'] as [string, string], ...categories].filter(([key]) => key === 'all' || all.some(i => i.category === key)).map(([key, label]) => `<button type="button" class="${filter === key ? 'active' : ''}" aria-pressed="${filter === key}" data-memory-filter="${key}">${label}</button>`).join('')}</div>` : '';
    return chips + (items.length ? items.map(itemRow).join('') : `<p class="memory-empty">${tab === 'fact' ? (all.length ? 'В этой категории пока ничего нет.' : 'Фактов пока нет. Миюнэя запоминает ваши предпочтения и обстоятельства из разговоров и заметок, или скажите ей «запомни, что…».') : 'Правил пока нет. Они появляются из ваших просьб и поправок, например «отвечай короче».'}</p>`);
  }
  function statusLine() {
    if (!view) return '';
    if (!view.enabled) return 'Память выключена: Миюнэя ничего не вспоминает и не запоминает';
    if (view.busy) return view.busy === 'sleep' ? 'Сейчас сон: перечитываю эпизоды и заметки, навожу порядок…' : 'Разбираю недавний разговор…';
    if (!view.available) return 'Подключите cloud.ru, чтобы память пополнялась сама';
    return `Сон: ${view.lastSleep ? when(view.lastSleep, true) : 'ещё не было'} · новых эпизодов ${view.newEpisodes} · поиск ${view.search === 'meaning' ? 'по смыслу' : 'по словам'}${view.private ? ' · приватный режим' : ''}`;
  }
  function render() {
    if (panel.hidden) return;
    const count = (t: Tab) => !view || t === 'journal' || t === 'map' ? '' : String(t === 'episode' ? view.episodes.length : t === 'diary' ? view.diary.length : view.items.filter(i => i.kind === t).length);
    const scroll = panel.querySelector('.memory-list')?.scrollTop || 0;
    const off = !view || busy ? 'disabled' : '';
    panel.classList.toggle('wide', tab === 'map');
    panel.innerHTML = `<header class="memory-head"><span class="memory-mark"><svg viewBox="0 0 24 24" aria-hidden="true">${brainIcon}</svg></span><div><b>Память Миюнэи</b><small>${escape(statusLine())}</small></div><button type="button" class="icon-button" data-memory-close aria-label="Закрыть память">×</button></header>`
      + `<div class="memory-switches"><label class="switch"><input type="checkbox" data-memory-enabled ${view?.enabled ? 'checked' : ''} ${off}><span>Память включена</span></label><label class="switch"><input type="checkbox" data-memory-private ${view?.private ? 'checked' : ''} ${off || (view?.enabled ? '' : 'disabled')}><span>Приватный режим: новые разговоры не запоминаются</span></label>${view?.searchError && view.available ? `<p class="memory-warn">Поиск по смыслу недоступен, пока ищу по словам. ${escape(view.searchError)}</p>` : ''}</div>`
      + `<div class="memory-tabs" role="tablist">${tabs.map(([key, label]) => `<button type="button" role="tab" aria-selected="${tab === key}" class="${tab === key ? 'active' : ''}" data-memory-tab="${key}">${label}${count(key) ? ` <small>${count(key)}</small>` : ''}</button>`).join('')}</div>`
      + `<div class="memory-list" role="tabpanel">${listHtml()}</div>`
      + (tab === 'fact' || tab === 'rule' ? `<form class="memory-add"><input name="text" maxlength="400" autocomplete="off" placeholder="${tab === 'fact' ? 'Добавить факт, например «работает по утрам»' : 'Добавить правило, например «задачи писать коротко»'}" aria-label="Новая запись" ${off}>${tab === 'fact' ? categorySelect(filter === 'all' ? 'other' : filter) : ''}<button class="button" type="submit" ${off}>Добавить</button></form>` : '')
      + `<footer class="memory-foot"><button type="button" class="button" data-memory-sleep ${off || (view?.available && view.enabled ? '' : 'disabled')}>Уснуть сейчас</button><a class="button" href="/api/memory/export" download>Экспорт</a><button type="button" class="button quiet danger" data-memory-reset ${off}>Сбросить</button></footer>`;
    for (const meter of panel.querySelectorAll<HTMLElement>('[data-strength]')) meter.style.setProperty('--strength', String(Math.max(0.04, Number(meter.dataset.strength))));
    const list = panel.querySelector('.memory-list'); if (list) list.scrollTop = scroll;
    clearTimeout(poll);
    if (view?.busy) poll = setTimeout(() => void refresh(), 3000);
  }
  async function refresh() {
    try { await request(''); } catch {}
    render();
  }
  function open(start?: Tab) { if (start) { tab = start; editing = ''; } panel.hidden = false; render(); void refresh(); panel.querySelector<HTMLElement>('[data-memory-close]')?.focus(); sync(); }
  function close() { if (panel.hidden) return; panel.hidden = true; editing = ''; clearTimeout(poll); sync(); document.querySelector<HTMLElement>('[data-memory-toggle]')?.focus(); }
  const sync = () => document.querySelector('[data-memory-toggle]')?.setAttribute('aria-expanded', String(!panel.hidden));
  function select(id: string) { tab = 'map'; selected = id; editing = ''; render(); }

  panel.addEventListener('click', async event => {
    const node = (event.target as Element).closest<SVGGElement>('[data-node]');
    if (node) { selected = selected === node.dataset.node ? '' : node.dataset.node!; editing = ''; render(); return; }
    const target = (event.target as HTMLElement).closest<HTMLElement>('button,a');
    if (!target) return;
    const d = target.dataset;
    if (target.hasAttribute('data-memory-close')) return close();
    if (d.memoryTab) { tab = d.memoryTab as Tab; editing = ''; render(); panel.querySelector('.memory-list')!.scrollTop = 0; return; }
    if (d.memoryFilter) { filter = d.memoryFilter as Category | 'all'; render(); return; }
    if (d.memorySelect) { select(d.memorySelect); return; }
    if (d.memoryEdit) { editing = d.memoryEdit; render(); panel.querySelector<HTMLElement>('.memory-edit textarea, .memory-edit input')?.focus(); return; }
    if (target.hasAttribute('data-memory-cancel')) { editing = ''; render(); return; }
    if (d.memoryNote) { close(); host.openNote(d.memoryNote); return; }
    if (d.memoryGoto) {
      tab = d.tab as Tab; editing = ''; filter = 'all'; render();
      const row = panel.querySelector<HTMLElement>('#memory-' + CSS.escape(d.memoryGoto));
      row?.scrollIntoView({ block: 'nearest' }); row?.classList.add('flash');
      return;
    }
    if (d.memoryUnlink) { await act('/unlink', { method: 'POST', json: { from: selected, to: d.memoryUnlink } }, 'Связь убрана'); return; }
    if (d.memoryPin) { const item = view?.items.find(i => i.id === d.memoryPin); if (item) await act('/items/' + item.id, { method: 'PATCH', json: { pinned: !item.pinned } }, item.pinned ? 'Запись откреплена' : 'Закреплено: эта запись не будет забыта'); return; }
    if (d.memoryDelete && await host.confirm(d.what === 'diary' ? 'Удалить запись дневника?' : 'Удалить запись из памяти?')) { if (await act('/items/' + d.memoryDelete, { method: 'DELETE' }, d.what === 'diary' ? 'Запись дневника удалена' : 'Запись удалена') && selected === d.memoryDelete) { selected = ''; render(); } return; }
    if (target.hasAttribute('data-memory-sleep')) { await act('/sleep', { method: 'POST' }, 'Сон завершён: память упорядочена'); return; }
    if (target.hasAttribute('data-memory-reset') && await host.confirm('Стереть всю память Миюнэи?')) { await act('', { method: 'DELETE' }, 'Память очищена'); return; }
  });
  panel.addEventListener('keydown', event => {
    const node = (event.target as Element).closest<SVGGElement>('[data-node]');
    if (node && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); selected = node.dataset.node!; render(); panel.querySelector<SVGGElement>(`[data-node="${CSS.escape(selected)}"]`)?.focus(); return; }
    if (event.key === 'Escape' && !(event.target as HTMLElement).closest('.memory-edit')) { event.stopPropagation(); close(); }
  });
  panel.addEventListener('change', event => {
    const input = event.target as HTMLInputElement;
    if (input.hasAttribute('data-memory-enabled')) void act('', { method: 'PUT', json: { enabled: input.checked } }, input.checked ? 'Память включена' : 'Память выключена');
    if (input.hasAttribute('data-memory-private')) void act('', { method: 'PUT', json: { private: input.checked } }, input.checked ? 'Приватный режим: разговоры не запоминаются' : 'Приватный режим выключен');
  });
  panel.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const field = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | null)?.value.trim();
    if (form.classList.contains('memory-add')) {
      const text = field('text');
      if (text && await act('/items', { method: 'POST', json: { kind: tab, text, category: tab === 'fact' ? field('category') : undefined } }, tab === 'rule' ? 'Правило добавлено' : 'Факт добавлен')) panel.querySelector<HTMLInputElement>('.memory-add input')?.focus();
      return;
    }
    const id = form.dataset.memorySave;
    if (!id) return;
    const change = tab === 'episode' ? { topic: field('topic'), outcome: field('outcome') }
      : tab === 'map' ? { name: field('name'), about: field('about') }
      : { text: field('text'), ...(tab === 'fact' && { category: field('category'), until: field('until') || null }) };
    if ('text' in change && !change.text) return host.toast('Запись не может быть пустой');
    editing = '';
    await act('/items/' + id, { method: 'PATCH', json: change }, 'Запись исправлена');
  });
  document.addEventListener('pointerdown', event => {
    const target = event.target as HTMLElement;
    if (!panel.hidden && !panel.contains(target) && !target.closest('[data-memory-toggle], dialog')) close();
  });

  return {
    toggle() { panel.hidden ? open() : close(); },
    open,
    isOpen: () => !panel.hidden,
    refresh,
    view: () => view,
    act,
    load: () => request('').catch(() => null),
  };
}
