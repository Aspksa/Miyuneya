import { localDateKey } from './calendar.ts';
// The memory menu behind the brain icon: how she grows, what Miyuneya knows, the rules she follows, past dialogs, the knowledge map, her diary and journal.
// Everything lives on the local server in data/memory.json; this panel only shows and edits it.
export type Category = 'personal' | 'work' | 'health' | 'plans' | 'tastes' | 'people' | 'other';
type EvidenceView={source:string;version:string;quote:string;at:string;role:string};
export type MemoryItemView = { evidence?:EvidenceView[]; status?:string; id: string; kind: 'fact' | 'rule'; text: string; strength: number; hits: number; created: string; seen: string; pinned: boolean; source: 'user' | 'dialog' | 'sleep' | 'note' | 'review' | 'thought' | 'logic'; links: string[]; category: Category; until: string | null; expired: boolean; origin: string | null };
export type EpisodeView = { id: string; date: string; topic: string; outcome: string; links: string[]; consolidated: boolean; score: number | null; weak: string };
export type ReminderView = { id: string; about: string; text: string; created: string; fired: string | null };
export type PromiseView = { id: string; text: string; created: string; due: string | null; episode: string | null; done: string | null };
export type ThoughtView = { id: string; at: string; kind: 'hypothesis' | 'idea' | 'reflection' | 'skill'; text: string; links: string[]; seen: boolean };
type Level = { level: number; floor: number; next: number };
export type ThinkingView = { enabled: boolean; intensity: 'low' | 'normal' | 'high'; today: number; perDay: number; next: string };
export type CauseView = { id: string; cause: string; effect: string; confidence: number; evidence: string[]; created: string; hits: number };
export type StepView = { id: string; text: string; parent: string | null; after: string[]; done: string | null };
export type GoalView = { id: string; title: string; created: string; done: string | null; steps: StepView[]; next: string[] };
export type Reasoning = 'pattern' | 'cause' | 'habit' | 'plan' | 'analogy';
export type PredictionView = { verification?:'user'|'evidence'|'legacy'; id: string; text: string; kind: Reasoning; confidence: number; created: string; due: string | null; checked: string | null; outcome: 'right' | 'wrong' | null; note: string };
export type MistakeView = { id: string; at: string; kind: 'calc' | 'assumption' | 'causality' | 'memory' | 'prediction' | 'other'; text: string; fix: string; rule: string | null; origin: string | null };
export type LogicView = Level & { quality?:{sample:number;brier:number|null;independent:boolean}; activity?:{records:number;thoughts:number;hypotheses:number;goals:number}; points: number; name: string; predictions: { made: number; open: number; checked: number; right: number; accuracy: number | null };
  conclusions: { right: number; total: number; share: number | null }; corrections: number; fixed: number; causes: number; goals: number;
  week: { predictions: number; checked: number; right: number; corrections: number }; kinds: { kind: Reasoning; checked: number; right: number }[] };
export type TopicView = { id: string; title: string; area: Category; summary: string; facts: string[]; created: string; updated: string };
export type QuestionView = { id: string; kind: 'gap' | 'conflict'; text: string; entity: string | null; facts: string[]; created: string; asked: number };
export type GrowthView = Level & { xp: number; name: string; logic: LogicView; week: { xp: number; facts: number; rules: number; lessons: number; episodes: number; entities: number; topics: number };
  quality: { average: number | null; reviewed: number; previous: number | null }; skills: (Level & { area: Category; points: number; week: number; facts: number; topics: { id: string; title: string }[] })[] };
export type EntityView = { id: string; name: string; type: 'person' | 'project' | 'place' | 'topic' | 'thing'; about: string; aliases: string[]; degree: number };
export type EdgeView = { from: string; to: string; type: 'related' | 'part_of' | 'blocks' | 'after' | 'decided_in' | 'about' };
export type DiaryView = { id: string; date: string; text: string };
export type JournalView = { at: string; kind: string; text: string };
export type CognitiveView = {
  enabled:boolean;
  summary:{active:number;withEvidence:number;inferred:number;contested:number;expired:number;associations:number};
  associations:{id:string;kind:'direct'|'episode'|'topic'|'entity';state:'recorded'|'candidate';
    left:{id:string;text:string};right:{id:string;text:string};source:{id:string;title:string};observedAt:string}[];
  uncertainties:{id:string;text:string;reason:'inferred'|'contested';updated:string}[];
  questions:{id:string;kind:'gap'|'conflict';text:string;facts:string[]}[];
  generatedAt:string;
};
export type MemoryView = { cognitiveAutonomy?:{
  state:'paused'|'working'|'queued'|'idle';pending:boolean;runs:number;failures:number;lastError:string;
  result:null|{
    generatedAt:string;strategy:'lexical'|'graph';
    metrics:{reviewed:number;verified:number;directLinks:number;candidateLinks:number;
      potentialConflicts:number;retrievalExamples:number;lexicalRecallAt3:number;graphRecallAt3:number};
    candidates:{id:string;left:{id:string;text:string};right:{id:string;text:string};reason:string}[];
    conflicts:{id:string;left:{id:string;text:string};right:{id:string;text:string};reason:string}[];
  };
}; archive?:{active:{facts:number;episodes:number;edges:number};archived:{facts:number;episodes:number;edges:number}}; cognitive?:CognitiveView; history?:{id:string;before:string;after:string;at:string;reason:string}[]; noteProgress?:Record<string,{offset:number}>; enabled: boolean; private: boolean; available: boolean; busy: 'reflect' | 'sleep' | 'think' | null; lastSleep: string | null; pending: number; newEpisodes: number;
  search: 'meaning' | 'words'; searchError: string; indexed: number;
  items: MemoryItemView[]; episodes: EpisodeView[]; entities: EntityView[]; edges: EdgeView[]; diary: DiaryView[]; journal: JournalView[];
  topics: TopicView[]; understanding: { text: string; updated: string } | null; questions: QuestionView[]; growth: GrowthView; reminders: ReminderView[]; promises: PromiseView[]; thoughts: ThoughtView[]; thinking: ThinkingView;
  causes: CauseView[]; goals: GoalView[]; predictions: PredictionView[]; mistakes: MistakeView[] };
export type MemoryHost = {
  toast(message: string): void;
  confirm(title: string): Promise<boolean>;
  entry(id: string): { kind: 'note' | 'task'; title: string } | null;
  openNote(id: string): void;
  changed(view: MemoryView): void;
};
export type Tab = 'growth' | 'plans' | 'thoughts' | 'logic' | 'cognitive' | 'fact' | 'rule' | 'episode' | 'timeline' | 'map' | 'diary' | 'journal';
type Request = RequestInit & { json?: unknown };

export const brainIcon = '<path d="M12 5.4C11.3 4.1 9.6 3.6 8.4 4.3 7 3.9 5.5 5 5.5 6.6 4.1 7.2 3.6 8.9 4.3 10.2c-1 1-.9 2.8.3 3.6-.3 1.6.8 3.1 2.4 3.2.4 1.6 2.2 2.5 3.7 1.8.4.5.8.7 1.3.7Z" class="fill"/><path d="M12 5.4C11.3 4.1 9.6 3.6 8.4 4.3 7 3.9 5.5 5 5.5 6.6 4.1 7.2 3.6 8.9 4.3 10.2c-1 1-.9 2.8.3 3.6-.3 1.6.8 3.1 2.4 3.2.4 1.6 2.2 2.5 3.7 1.8.4.5.8.7 1.3.7Z" class="fill" transform="matrix(-1 0 0 1 24 0)"/><path d="M12 5.4v14.1M12 9.2c-1.3 0-2.2-.8-2.3-2M9.6 12.3c-1.4-.4-2.8.2-3.4 1.4M12 15.6c-1.2 0-2.2-.7-2.5-1.8M12 9.2c1.3 0 2.2-.8 2.3-2M14.4 12.3c1.4-.4 2.8.2 3.4 1.4M12 15.6c1.2 0 2.2-.7 2.5-1.8M6.7 8.9c.6.5 1.4.7 2.1.5M17.3 8.9c-.6.5-1.4.7-2.1.5" class="accent-stroke"/>';
const tabs: [Tab, string][] = [['growth', 'Рост'], ['plans', 'Дела'], ['thoughts', 'Размышления'], ['logic', 'Логика'], ['cognitive', 'Когнитивная'], ['fact', 'Факты'], ['rule', 'Правила'], ['episode', 'Эпизоды'], ['timeline', 'Хронология'], ['map', 'Карта'], ['diary', 'Дневник'], ['journal', 'Журнал']];
// Eleven tabs never fitted the panel and scrolled sideways with nothing to say more were there.
// They are the same eleven views, gathered into four groups by what you came to the memory for.
export type Group = 'now' | 'known' | 'history' | 'growth';
export const groups: [Group, string, Tab[]][] = [
  ['now', 'Сейчас', ['thoughts', 'plans']],
  ['known', 'Знания', ['cognitive', 'fact', 'rule', 'episode', 'map']],
  ['history', 'История', ['timeline', 'diary', 'journal']],
  ['growth', 'Рост', ['growth', 'logic']],
];
// Inside the «Рост» group the overview would repeat the group's own name.
const tabLabel = (key: Tab) => key === 'growth' ? 'Итоги' : tabs.find(([t]) => t === key)![1];
export const groupOf = (key: Tab): Group => groups.find(([, , list]) => list.includes(key))![0];
export const categories: [Category, string][] = [['personal', 'Личное'], ['work', 'Работа'], ['health', 'Здоровье'], ['plans', 'Планы'], ['tastes', 'Вкусы'], ['people', 'Люди'], ['other', 'Другое']];
const categoryName = (c: Category) => categories.find(([key]) => key === c)?.[1] || 'Другое';
const sources: Record<MemoryItemView['source'], string> = { user: 'от вас', dialog: 'из разговора', sleep: 'после сна', note: 'из заметки', review: 'из самооценки', thought: 'из размышлений', logic: 'из журнала ошибок' };
const areaNames: Record<Category, string> = { personal: 'Личное', work: 'Работа', health: 'Здоровье', plans: 'Планы', tastes: 'Вкусы', people: 'Люди', other: 'Разное' };
const entityTypes: Record<EntityView['type'], string> = { person: 'Человек', project: 'Проект', place: 'Место', topic: 'Тема', thing: 'Вещь' };
export const relationNames: Record<EdgeView['type'], string> = { related: 'связано с', part_of: 'часть', blocks: 'мешает', after: 'после', decided_in: 'решено в', about: 'про' };
const journalNames: Record<string, string> = { learned: 'Узнала', rule: 'Правило', reinforced: 'Подтвердилось', weakened: 'Сомнение', merged: 'Объединила', forgot: 'Забыла', episode: 'Эпизод', sleep: 'Сон', edited: 'Правка', entity: 'Карта', review: 'Самооценка', topic: 'Тема', question: 'Вопрос', reminder: 'Напоминание', promise: 'Обещание', thought: 'Размышление', cause: 'Причина', goal: 'Цель', prediction: 'Прогноз', mistake: 'Ошибка' };
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
  let tab: Tab = 'growth';
  let group: Group = 'growth';
  let settings = false;
  let filter: Category | 'all' = 'all';
  let cognitiveQuery='';
  let archiveQuery='';
  let archiveResults:{id:string;kind:string;text:string}[]=[];
  let editing = '';
  // Whoever sets the tab — a link from the chat, a reopen, the map — the group follows it.
  const goTab = (next: Tab) => { tab = next; group = groupOf(next); };
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
  // Provenance: where a record came from, one click away.
  function origin(item: MemoryItemView) {
    const episode = item.origin ? view?.episodes.find(e => e.id === item.origin) : undefined;
    if (episode) return `<button type="button" class="chat-link memory-origin" data-memory-goto="${escape(episode.id)}" data-tab="episode" title="${escape(episode.topic)}">${item.source === 'review' ? 'из самооценки' : item.source === 'sleep' ? 'после сна' : 'из разговора'} ${when(episode.date)} «${escape(short(episode.topic, 32))}»</button>`;
    const entry = item.origin ? host.entry(item.origin) : null;
    if (entry?.kind === 'note') return `<button type="button" class="chat-link memory-origin" data-memory-note="${escape(item.origin!)}">из заметки «${escape(short(entry.title, 32))}»</button>`;
    return sources[item.source];
  }
  function itemRow(item: MemoryItemView) {
    const id = escape(item.id);
    const fact = item.kind === 'fact';
    const body = editing === item.id
      ? `<form class="memory-edit" data-memory-save="${id}"><textarea name="text" maxlength="400" rows="3" aria-label="Текст записи">${escape(item.text)}</textarea>${fact ? `<div class="memory-fields">${categorySelect(item.category)}<label>Актуально до <input type="date" name="until" value="${item.until || ''}"></label></div>` : ''}<div><button class="button primary" type="submit">Сохранить</button><button class="button quiet" type="button" data-memory-cancel>Отмена</button></div></form>`
      : `<p>${fact && item.category !== 'other' ? `<span class="memory-tag">${categoryName(item.category)}</span>` : ''}${escape(item.text)}</p>`;
    const until = item.until ? ` · ${item.expired ? '<em>устарело</em>' : 'до ' + when(item.until)}` : '';
    return `<article class="memory-item ${item.pinned ? 'pinned' : ''} ${item.expired ? 'expired' : ''} ${item.status === 'contested' ? 'contested' : ''}" id="memory-${id}">${body}${item.status ? `<small class="memory-sub">${escape(({active:'Запись с источником или вашим подтверждением',inferred:'Непроверенное предположение',contested:'Есть противоречие — нужно уточнение',superseded:'Предыдущая версия, заменена'} as Record<string,string>)[item.status]||item.status)}</small>`:''}${item.evidence?.length?`<details class="memory-evidence"><summary>Источники: ${item.evidence.length}</summary>${item.evidence.map(e=>`<blockquote>${escape(e.quote)}<footer>${escape(e.source)} · ${when(e.at,true)} · версия ${escape(short(e.version,12))}</footer></blockquote>`).join('')}</details>`:''}${view?.history?.some(h=>h.id===item.id)?`<details class="memory-evidence"><summary>История изменения</summary>${view.history.filter(h=>h.id===item.id).map(h=>`<p>${escape(h.before)} → ${escape(h.after)}<small> · ${when(h.at,true)} · ${escape(h.reason)}</small></p>`).join('')}</details>`:''}<div class="memory-meta"><span class="meter" data-strength="${item.pinned ? 1 : item.strength}" title="Сила памяти ${Math.round(item.strength * 100)}%"><i></i></span><span>${strengthLabel(item)} · упоминаний ${item.hits} · ${origin(item)} · ${when(item.seen)}${until}</span></div>${linkChips([...item.links, ...related(item.id)])}<div class="memory-actions"><button type="button" class="chat-link" data-memory-edit="${id}">Изменить</button><button type="button" class="chat-link" data-memory-pin="${id}" aria-pressed="${item.pinned}">${item.pinned ? 'Открепить' : 'Закрепить'}</button><button type="button" class="chat-link" data-memory-select="${id}">На карте</button><button type="button" class="chat-link danger" data-memory-delete="${id}">Удалить</button></div></article>`;
  }
  const learned = (id: string) => { const ids = (view?.items || []).filter(i => i.origin === id).map(i => i.id); return ids.length ? `<p class="memory-sub">Узнала из этого разговора:</p>${linkChips(ids)}` : ''; };
  function episodeRow(e: EpisodeView) {
    const id = escape(e.id);
    const body = editing === e.id
      ? `<form class="memory-edit" data-memory-save="${id}"><input name="topic" maxlength="200" value="${escape(e.topic)}" aria-label="Тема"><textarea name="outcome" maxlength="600" rows="3" aria-label="Итог">${escape(e.outcome)}</textarea><div><button class="button primary" type="submit">Сохранить</button><button class="button quiet" type="button" data-memory-cancel>Отмена</button></div></form>`
      : `<p><b>${escape(e.topic)}</b>${e.outcome ? '<br>' + escape(e.outcome) : ''}</p>`;
    return `<article class="memory-item" id="memory-${id}">${body}<div class="memory-meta"><span>${when(e.date, true)}${e.score ? ` · самооценка ${e.score} из 5` : ''}${e.consolidated ? '' : ' · <em>ещё не осмыслен во сне</em>'}</span></div>${e.weak ? `<p class="memory-weak">Слабое место: ${escape(e.weak)}</p>` : ''}${linkChips([...e.links, ...related(e.id)])}${learned(e.id)}<div class="memory-actions"><button type="button" class="chat-link" data-memory-edit="${id}">Изменить</button><button type="button" class="chat-link" data-memory-select="${id}">На карте</button><button type="button" class="chat-link danger" data-memory-delete="${id}">Удалить</button></div></article>`;
  }
  // «Дела»: what Miyuneya promised and what she will bring up when the talk turns to a topic.
  function plansHtml(v: MemoryView) {
    const today = localDateKey();
    const save = `<div><button class="button primary" type="submit">Сохранить</button><button class="button quiet" type="button" data-memory-cancel>Отмена</button></div>`;
    const promise = (p: PromiseView) => `<article class="memory-item ${p.done ? 'done' : ''}" id="memory-${escape(p.id)}">${editing === p.id
      ? `<form class="memory-edit" data-memory-save="${escape(p.id)}"><textarea name="text" maxlength="300" rows="2" aria-label="Обещание">${escape(p.text)}</textarea><div class="memory-fields"><label>Срок <input type="date" name="due" value="${p.due || ''}"></label></div>${save}</form>`
      : `<p>${escape(p.text)}</p>`}<div class="memory-meta"><span>${p.done ? 'выполнено ' + when(p.done) : `обещала ${when(p.created)}${p.due ? (p.due < today ? ' · <em>срок прошёл ' + when(p.due) + '</em>' : ' · срок до ' + when(p.due)) : ''}`}</span></div>${p.episode ? linkChips([p.episode]) : ''}<div class="memory-actions">${p.done
      ? `<button type="button" class="chat-link" data-memory-done="${escape(p.id)}" data-value="false">Вернуть</button>`
      : `<button type="button" class="chat-link" data-memory-done="${escape(p.id)}" data-value="true">Выполнено</button><button type="button" class="chat-link" data-memory-edit="${escape(p.id)}">Изменить</button>`}<button type="button" class="chat-link danger" data-memory-delete="${escape(p.id)}">Удалить</button></div></article>`;
    const reminder = (x: ReminderView) => `<article class="memory-item ${x.fired ? 'done' : ''}" id="memory-${escape(x.id)}">${editing === x.id
      ? `<form class="memory-edit" data-memory-save="${escape(x.id)}"><input name="about" maxlength="120" value="${escape(x.about)}" aria-label="Когда речь зайдёт о"><textarea name="text" maxlength="300" rows="2" aria-label="О чём напомнить">${escape(x.text)}</textarea>${save}</form>`
      : `<p><span class="memory-tag">о «${escape(x.about)}»</span>${escape(x.text)}</p>`}<div class="memory-meta"><span>${x.fired ? 'напомнила ' + when(x.fired, true) : 'поставлено ' + when(x.created)}</span></div><div class="memory-actions">${x.fired ? `<button type="button" class="chat-link" data-memory-rearm="${escape(x.id)}">Напомнить ещё раз</button>` : `<button type="button" class="chat-link" data-memory-edit="${escape(x.id)}">Изменить</button>`}<button type="button" class="chat-link danger" data-memory-delete="${escape(x.id)}">Удалить</button></div></article>`;
    const goals = v.goals.filter(g => !g.done), reached = v.goals.filter(g => g.done).slice(0, 10);
    const goalForm = `<form class="memory-goal"><input name="title" maxlength="200" autocomplete="off" placeholder="Цель, например «выучить японский до N4»" aria-label="Новая цель" ${busy || !v.available ? 'disabled' : ''}><button class="button" type="submit" ${busy || !v.available ? 'disabled' : ''}>Разложить на шаги</button></form>`;
    const goalSection = `<section class="growth-section"><h4>Цели и шаги</h4>${goals.length ? goals.map(goalHtml).join('') : `<p class="memory-empty">${v.available ? 'Напишите цель ниже или скажите в чате: «Разложи цель „переезд“ на шаги». Я разложу её на дерево подзадач, отмечу, что от чего зависит и что можно делать уже сейчас.' : 'Подключите cloud.ru, чтобы я могла раскладывать цели на шаги.'}</p>`}${goalForm}${reached.length ? `<details class="memory-done"><summary>Достигнуто: ${reached.length}</summary>${reached.map(goalHtml).join('')}</details>` : ''}</section>`;
    const open = v.promises.filter(p => !p.done), kept = v.promises.filter(p => p.done).slice(0, 10);
    const waiting = v.reminders.filter(x => !x.fired), fired = v.reminders.filter(x => x.fired).slice(0, 10);
    return goalSection + `<section class="growth-section"><h4>Мои обещания</h4>${open.length ? open.map(promise).join('') : '<p class="memory-empty">Открытых обещаний нет. Если я пообещаю что-то проверить или подготовить, это появится здесь, и я закрою его сама.</p>'}${kept.length ? `<details class="memory-done"><summary>Выполнено: ${kept.length}</summary>${kept.map(promise).join('')}</details>` : ''}</section>`
      + `<section class="growth-section"><h4>Напомню, когда речь зайдёт о…</h4>${waiting.length ? waiting.map(reminder).join('') : '<p class="memory-empty">Скажите в чате: «Напомни, когда заговорим о поездке, что нужно купить адаптер», или добавьте ниже.</p>'}<form class="memory-remind"><input name="about" maxlength="120" autocomplete="off" placeholder="Когда речь зайдёт о…" aria-label="Тема" ${busy ? 'disabled' : ''}><input name="text" maxlength="300" autocomplete="off" placeholder="…напомнить, что" aria-label="О чём напомнить" ${busy ? 'disabled' : ''}><button class="button" type="submit" ${busy ? 'disabled' : ''}>Добавить</button></form>${fired.length ? `<details class="memory-done"><summary>Уже напомнила: ${fired.length}</summary>${fired.map(reminder).join('')}</details>` : ''}</section>`;
  }
  // A goal is a tree of steps: smaller steps sit inside bigger ones, «после» shows what a step waits for.
  function goalHtml(g: GoalView) {
    const name = (id: string) => g.steps.find(s => s.id === id)?.text || '';
    const done = g.steps.filter(s => s.done).length;
    const tree = (parent: string | null): string => {
      const kids = g.steps.filter(s => s.parent === parent);
      return kids.length ? `<ul class="goal-tree">${kids.map(s => `<li class="goal-step ${s.done ? 'done' : ''} ${g.next.includes(s.id) ? 'ready' : ''}"><label><input type="checkbox" data-goal="${escape(g.id)}" data-step="${escape(s.id)}" ${s.done ? 'checked' : ''} ${busy ? 'disabled' : ''}><span>${escape(s.text)}</span></label>${g.next.includes(s.id) && !g.done ? '<em>можно сейчас</em>' : ''}${s.after.length ? `<small>после: ${s.after.map(id => escape(short(name(id), 40))).join('; ')}</small>` : ''}${tree(s.id)}</li>`).join('')}</ul>` : '';
    };
    return `<article class="memory-item goal ${g.done ? 'done' : ''}" id="memory-${escape(g.id)}"><p><b>${escape(g.title)}</b></p>${bar(done, 0, g.steps.length)}<div class="memory-meta"><span>${g.done ? 'достигнута ' + when(g.done) : `сделано ${done} из ${g.steps.length} · поставлена ${when(g.created)}`}</span></div>${tree(null)}<div class="memory-actions"><button type="button" class="chat-link danger" data-memory-delete="${escape(g.id)}" data-what="goal">Удалить</button></div></article>`;
  }
  // «Логика»: her predictions and how they came true, cause and effect in the user's life, and the journal of reasoning errors.
  const reasoningNames: Record<Reasoning, string> = { pattern: 'Закономерность', cause: 'Причина и следствие', habit: 'Привычка', plan: 'По планам', analogy: 'Аналогия' };
  const mistakeNames: Record<MistakeView['kind'], string> = { calc: 'Расчёт', assumption: 'Допущение', causality: 'Причинность', memory: 'Память', prediction: 'Прогноз', other: 'Другое' };
  function logicCard(l: LogicView, more = false) {
    const pct = (n: number | null) => n === null ? '—' : n + '%';
    return `<section class="growth-card logic-card"><div class="growth-level"><span class="growth-badge logic">${l.level}</span><div><b>${escape(l.name)}</b><small>Уровень ${l.level} · ${l.points} из ${l.next} очков</small></div>${more ? '<button type="button" class="chat-link" data-memory-tab="logic">Подробнее</button>' : ''}</div>${bar(l.points, l.floor, l.next)}
      <div class="logic-stats"><div><b>${pct(l.predictions.accuracy)}</b><small>прогнозов сбылось${l.predictions.checked ? ` (${l.predictions.right} из ${l.predictions.checked})` : ''}</small></div><div><b>${pct(l.conclusions.share)}</b><small>проверенных исходов${l.conclusions.total ? ` (${l.conclusions.right} из ${l.conclusions.total})` : ''}</small></div><div><b>${l.corrections}</b><small>исправлений${l.fixed ? `, правил из них: ${l.fixed}` : ''}</small></div></div>
      ${l.week.predictions || l.week.checked || l.week.corrections ? `<p class="growth-line">За неделю: ${[l.week.predictions && plural(l.week.predictions, 'прогноз', 'прогноза', 'прогнозов'), l.week.checked && `проверено ${l.week.checked}, сбылось ${l.week.right}`, l.week.corrections && plural(l.week.corrections, 'исправление', 'исправления', 'исправлений')].filter(Boolean).join(' · ')}</p>` : ''}</section>`;
  }
  function logicHtml(v: MemoryView) {
    const l = v.growth.logic;
    const kinds = l.kinds.length ? `<section class="growth-section"><h4>Какие рассуждения мне удаются</h4>${l.kinds.map(k => `<div class="skill"><div class="skill-head"><b>${reasoningNames[k.kind]}</b><span>${Math.round(k.right / k.checked * 100)}%</span><em>${k.right} из ${k.checked}</em></div>${bar(k.right, 0, k.checked)}</div>`).join('')}</section>` : '';
    const prediction = (p: PredictionView) => `<article class="memory-item prediction ${p.outcome || ''}" id="memory-${escape(p.id)}"><p><span class="memory-tag">${reasoningNames[p.kind]} · ${p.confidence}%</span>${escape(p.text)}</p><div class="memory-meta"><span>${p.verification==='legacy'?'Старый результат без подтверждённого источника':p.outcome ? `${p.outcome === 'right' ? '✓ сбылось' : '✗ не сбылось'} · проверено ${when(p.checked!)}${p.note ? ' · ' + escape(p.note) : ''}` : `сделан ${when(p.created)}${p.due ? ' · проверю ' + when(p.due) : ''}`}</span></div><div class="memory-actions">${p.outcome && p.verification!=='legacy' ? '' : `<button type="button" class="chat-link" data-memory-check="${escape(p.id)}" data-value="right">Сбылось</button><button type="button" class="chat-link" data-memory-check="${escape(p.id)}" data-value="wrong">Не сбылось</button>`}<button type="button" class="chat-link danger" data-memory-delete="${escape(p.id)}">Удалить</button></div></article>`;
    const open = v.predictions.filter(p => !p.outcome), checked = v.predictions.filter(p => p.outcome).slice(0, 30);
    const predictions = `<section class="growth-section"><h4>Мои прогнозы</h4><p class="memory-note">Пока вас нет, я тренирую логику: делаю проверяемые прогнозы о ваших делах, а потом сверяю их с тем, что было на самом деле. Вы тоже можете отметить, сбылось ли.</p>${open.length ? open.map(prediction).join('') : '<p class="memory-empty">Открытых прогнозов нет. Они появятся после размышлений.</p>'}${checked.length ? `<details class="memory-done"><summary>Проверено: ${checked.length}</summary>${checked.map(prediction).join('')}</details>` : ''}</section>`;
    const causes = `<section class="growth-section"><h4>Причины и следствия</h4>${v.causes.length ? v.causes.map(c => `<article class="memory-item cause" id="memory-${escape(c.id)}"><p>${escape(c.cause)} <span class="cause-arrow">→</span> ${escape(c.effect)}</p><div class="memory-meta"><span class="meter" data-strength="${c.confidence / 100}" title="Уверенность ${c.confidence}%"><i></i></span><span>оценка модели ${c.confidence}%${c.hits > 1 ? ` · ссылок на источники: ${c.evidence.length}` : ''} · ${when(c.created)}</span></div>${linkChips(c.evidence)}<div class="memory-actions"><button type="button" class="chat-link danger" data-memory-delete="${escape(c.id)}">Удалить</button></div></article>`).join('') : '<p class="memory-empty">Здесь появятся связи из вашей жизни, например «поздние встречи → тяжёлое утро». Это гипотезы: повторение не доказывает причинность.</p>'}</section>`;
    const mistakes = `<section class="growth-section"><h4>Журнал логических ошибок</h4>${v.mistakes.length ? v.mistakes.map(m => `<article class="memory-item mistake" id="memory-${escape(m.id)}"><p><span class="memory-tag">${mistakeNames[m.kind]}</span>${escape(m.text)}</p>${m.fix ? `<p class="memory-fix">Правило: ${m.rule && v.items.some(i => i.id === m.rule) ? `<button type="button" class="chat-link" data-memory-goto="${escape(m.rule)}" data-tab="rule">${escape(m.fix)}</button>` : escape(m.fix)}</p>` : ''}<div class="memory-actions"><small>${when(m.at, true)}</small>${m.origin ? linkChips([m.origin]) : ''}<button type="button" class="chat-link danger" data-memory-delete="${escape(m.id)}">Удалить</button></div></article>`).join('') : '<p class="memory-empty">Ошибок пока не записано. Когда вы поправите мой расчёт или вывод, или прогноз не сбудется, я запишу, в чём ошиблась, и выведу правило, чтобы не повторять.</p>'}</section>`;
    return logicCard(l) + `<p class="memory-note">Размер памяти и число размышлений показывают активность, а не интеллект. Точность основана на ${l.quality?.sample || 0} проверенных прогнозах; внешней независимой оценки здесь нет.${l.quality?.brier!==null&&l.quality?.brier!==undefined?' Ошибка вероятностей Brier: '+l.quality.brier+' (меньше — лучше).':''}</p>` + kinds + predictions + causes + mistakes;
  }
  // «Размышления»: what Miyuneya thought about on her own while the user was away, and how often she may do it.
  const newest = (list: ThoughtView[]) => [...list].sort((a, b) => b.at.localeCompare(a.at));
  const thoughtKinds: Record<ThoughtView['kind'], string> = { hypothesis: 'Догадка', idea: 'Идея', reflection: 'Вывод', skill: 'Навык' };
  const intensities: [ThinkingView['intensity'], string][] = [['low', 'Редко: 2 раза в день'], ['normal', 'Обычно: 4 раза в день'], ['high', 'Часто: 8 раз в день']];
  function thoughtsHtml(v: MemoryView) {
    const t = v.thinking;
    const off = busy || !v.enabled ? 'disabled' : '';
    const limit = t.today >= t.perDay;
    const state = !v.available ? 'Подключите cloud.ru, чтобы я могла размышлять.' : v.private ? 'В приватном режиме я не размышляю.' : !t.enabled ? 'Размышления выключены.'
      : `Сегодня ${t.today} из ${t.perDay}${limit ? ' · на сегодня хватит' : Date.parse(t.next) > Date.now() ? ` · следующий раз не раньше ${when(t.next, true)}` : ' · подумаю, когда вас не будет 20 минут'}`;
    const settings = `<section class="growth-card thinking-card"><p class="growth-line thinking-intro">Когда вас нет рядом, я перечитываю память, строю догадки о вас, ищу пробелы и противоречия, придумываю, чем помочь, и учусь на своих промахах. Каждое размышление — один запрос к cloud.ru.</p>
      <div class="thinking-controls"><label class="switch"><input type="checkbox" data-memory-thinking ${t.enabled ? 'checked' : ''} ${off}><span>Размышлять, пока вас нет</span></label><select data-memory-intensity aria-label="Как часто размышлять" ${off || (t.enabled ? '' : 'disabled')}>${intensities.map(([key, label]) => `<option value="${key}" ${key === t.intensity ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
      <div class="thinking-state"><small>${escape(state)}</small><button type="button" class="button" data-memory-think ${off || (v.available && t.enabled && !limit && !v.private ? '' : 'disabled')}>Подумать сейчас</button></div></section>`;
    if (!v.thoughts.length) return settings + '<p class="memory-empty">Пока я ещё ни о чём не думала. Первые мысли появятся, когда вы отойдёте, а в памяти будет хоть немного о вас.</p>';
    const days = new Map<string, ThoughtView[]>();
    for (const thought of newest(v.thoughts)) { const key = new Date(thought.at).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }); days.set(key, [...(days.get(key) || []), thought]); }
    return settings + [...days].map(([key, list]) => `<section class="timeline-day"><h4>${key}</h4>${list.map(thought => `<article class="memory-item thought ${thought.kind} ${thought.seen ? '' : 'new'}" id="memory-${escape(thought.id)}"><p><span class="memory-tag">${thoughtKinds[thought.kind]}</span>${escape(thought.text)}</p>${linkChips(thought.links)}<div class="memory-actions"><small>${new Date(thought.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</small><button type="button" class="chat-link danger" data-memory-delete="${escape(thought.id)}" data-what="thought">Удалить</button></div></article>`).join('')}</section>`).join('');
  }
  // «Хронология»: the memory laid out by days, newest first.
  function timelineHtml(v: MemoryView) {
    type Event = { at: string; label: string; html: string };
    const goto = (id: string, tab: Tab, text: string) => `<button type="button" class="chat-link" data-memory-goto="${escape(id)}" data-tab="${tab}">${escape(text)}</button>`;
    const events: Event[] = [
      ...v.episodes.map(e => ({ at: e.date, label: 'Разговор', html: goto(e.id, 'episode', e.topic) + (e.outcome ? ` — ${escape(e.outcome)}` : '') })),
      ...v.items.map(i => ({ at: i.created, label: i.kind === 'rule' ? 'Правило' : 'Узнала', html: goto(i.id, i.kind, i.text) })),
      ...v.promises.flatMap(p => [{ at: p.created, label: 'Пообещала', html: escape(p.text) }, ...(p.done ? [{ at: p.done, label: 'Выполнила', html: escape(p.text) }] : [])]),
      ...v.reminders.flatMap(x => [{ at: x.created, label: 'Напоминание', html: `о «${escape(x.about)}»: ${escape(x.text)}` }, ...(x.fired ? [{ at: x.fired, label: 'Напомнила', html: escape(x.text) }] : [])]),
      ...v.topics.map(t => ({ at: t.created, label: 'Тема', html: escape(t.title) })),
      ...v.diary.map(d => ({ at: d.date, label: 'Дневник', html: goto(d.id, 'diary', short(d.text, 90)) })),
      ...v.thoughts.map(t => ({ at: t.at, label: 'Размышляла', html: goto(t.id, 'thoughts', short(t.text, 90)) })),
      ...v.goals.flatMap(g => [{ at: g.created, label: 'Цель', html: goto(g.id, 'plans', g.title) }, ...(g.done ? [{ at: g.done, label: 'Достигнута', html: escape(g.title) }] : [])]),
      ...v.predictions.flatMap(p => [{ at: p.created, label: 'Прогноз', html: goto(p.id, 'logic', short(p.text, 90)) }, ...(p.checked ? [{ at: p.checked, label: p.outcome === 'right' ? 'Сбылось' : 'Не сбылось', html: escape(short(p.text, 90)) }] : [])]),
      ...v.mistakes.map(m => ({ at: m.at, label: 'Ошибка', html: goto(m.id, 'logic', short(m.text, 90)) })),
    ].filter(e => Number.isFinite(Date.parse(e.at))).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200);
    if (!events.length) return '<p class="memory-empty">Здесь по дням появится всё, что было: разговоры, что я узнала, обещала и напомнила.</p>';
    const days = new Map<string, Event[]>();
    for (const e of events) { const key = new Date(e.at).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); days.set(key, [...(days.get(key) || []), e]); }
    return [...days].map(([key, list]) => `<section class="timeline-day"><h4>${key}</h4>${list.map(e => `<div class="timeline-event"><small>${new Date(e.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</small><b>${e.label}</b><span>${e.html}</span></div>`).join('')}</section>`).join('');
  }
  const bar = (value: number, floor: number, next: number) => `<span class="growth-bar" data-progress="${Math.max(0.03, Math.min(1, (value - floor) / Math.max(1, next - floor))).toFixed(3)}"><i></i></span>`;
  const plural = (n: number, one: string, few: string, many: string) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many}`;
  // The growth tab: her level, what she learned this week, skills by area, topics, the understanding they add up to and her questions.
  function growthHtml(v: MemoryView) {
    const g = v.growth;
    const week = [g.week.facts && '+' + plural(g.week.facts, 'факт', 'факта', 'фактов'), g.week.rules && '+' + plural(g.week.rules, 'правило', 'правила', 'правил'), g.week.episodes && plural(g.week.episodes, 'разговор', 'разговора', 'разговоров'), g.week.entities && plural(g.week.entities, 'новое имя', 'новых имени', 'новых имён'), g.week.topics && '+' + plural(g.week.topics, 'тема', 'темы', 'тем')].filter(Boolean).join(' · ');
    const q = g.quality;
    const quality = q.average === null ? '' : `<p class="growth-line">Самооценка ответов за неделю: <b>${q.average.toFixed(1).replace('.', ',')} из 5</b>${q.previous === null ? '' : q.average > q.previous ? ` <span class="up">↑ было ${q.previous.toFixed(1).replace('.', ',')}</span>` : q.average < q.previous ? ` <span class="down">↓ было ${q.previous.toFixed(1).replace('.', ',')}</span>` : ''}${g.week.lessons ? ` · новых навыков: ${g.week.lessons}` : ''}</p>`;
    const level = `<section class="growth-card"><div class="growth-level"><span class="growth-badge">${g.level}</span><div><b>${escape(g.name)}</b><small>Уровень ${g.level} · ${g.xp} из ${g.next} опыта</small></div></div>${bar(g.xp, g.floor, g.next)}<p class="growth-line">${week ? 'За неделю: ' + week + (g.week.xp ? ` · <b>+${g.week.xp} опыта</b>` : '') : 'На этой неделе пока ничего нового. Поговорите со мной, и я буду расти.'}</p>${quality}</section>`;
    const skills = g.skills.length ? `<section class="growth-section"><h4>Навыки по областям</h4>${g.skills.map(s => `<div class="skill"><div class="skill-head"><b>${areaNames[s.area]}</b><span>уровень ${s.level}</span>${s.week ? `<em>+${s.week} за неделю</em>` : ''}</div>${bar(s.points, s.floor, s.next)}<small>${plural(s.facts, 'факт', 'факта', 'фактов')}${s.topics.length ? ' · ' + s.topics.map(t => escape(t.title)).join(', ') : ''}</small></div>`).join('')}</section>` : '';
    const u = v.understanding;
    const understanding = `<section class="growth-section"><h4>Как я вас понимаю</h4>${u ? (editing === 'understanding'
      ? `<form class="memory-edit" data-memory-save="understanding"><textarea name="text" maxlength="1500" rows="5" aria-label="Общее понимание">${escape(u.text)}</textarea><div><button class="button primary" type="submit">Сохранить</button><button class="button quiet" type="button" data-memory-cancel>Отмена</button></div></form>`
      : `<article class="memory-item"><p class="understanding">${escape(u.text)}</p><div class="memory-actions"><button type="button" class="chat-link" data-memory-edit="understanding">Изменить</button><button type="button" class="chat-link danger" data-memory-delete="understanding">Удалить</button><small>обновлено ${when(u.updated)}</small></div></article>`)
      : '<p class="memory-empty">Во время сна я соберу факты в темы, а темы — в общее понимание вас.</p>'}</section>`;
    const topics = v.topics.length ? `<section class="growth-section"><h4>Темы</h4>${[...v.topics].sort((a, b) => b.facts.length - a.facts.length).map(t => `<article class="memory-item" id="memory-${escape(t.id)}">${editing === t.id
      ? `<form class="memory-edit" data-memory-save="${escape(t.id)}"><input name="title" maxlength="80" value="${escape(t.title)}" aria-label="Тема">${categorySelect(t.area)}<textarea name="summary" maxlength="600" rows="3" aria-label="Что я знаю по теме">${escape(t.summary)}</textarea><div><button class="button primary" type="submit">Сохранить</button><button class="button quiet" type="button" data-memory-cancel>Отмена</button></div></form>`
      : `<p><span class="memory-tag">${areaNames[t.area]}</span><b>${escape(t.title)}</b>${t.summary ? '<br>' + escape(t.summary) : ''}</p>`}${linkChips(t.facts)}<div class="memory-actions"><button type="button" class="chat-link" data-memory-edit="${escape(t.id)}">Изменить</button><button type="button" class="chat-link danger" data-memory-delete="${escape(t.id)}">Удалить</button></div></article>`).join('')}</section>` : '';
    const questions = v.questions.length ? `<section class="growth-section"><h4>Хочу у вас спросить</h4>${v.questions.map(question => `<form class="memory-question ${question.kind}" data-question="${escape(question.id)}"><p>${question.kind === 'conflict' ? '<span class="memory-tag">Противоречие</span>' : ''}${escape(question.text)}</p>${question.kind === 'conflict' ? linkChips(question.facts) : ''}<div class="memory-answer"><input name="answer" maxlength="400" autocomplete="off" placeholder="Ваш ответ" aria-label="Ответ на вопрос" ${busy ? 'disabled' : ''}><button class="button" type="submit" ${busy ? 'disabled' : ''}>Ответить</button><button type="button" class="chat-link" data-memory-dismiss="${escape(question.id)}">Не спрашивать</button></div></form>`).join('')}</section>` : '';
    return level + logicCard(g.logic, true) + questions + skills + understanding + topics;
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
  function cognitiveHtml(v: MemoryView){
    const c=v.cognitive;
    if(!c)return '<p class="memory-empty">Когнитивная память пока не готова. Проверьте версию локального сервера.</p>';
    const counts=[
      ['Записанных фактов',c.summary.active],
      ['От вас / с источником',c.summary.withEvidence],
      ['Контекстных связей',c.summary.associations],
      ['Непроверенных',c.summary.inferred+c.summary.contested]
    ];
    const auto=v.cognitiveAutonomy;
    const autoInfo=auto?('<section class="memory-archive"><h3>Фоновый когнитивный процесс</h3>'+
      '<p class="memory-note">Состояние: '+escape(({paused:'Приостановлен',working:'Анализирует',queued:'Ожидает обработки',idle:'Ожидает изменений'} as Record<string,string>)[auto.state]||auto.state)+
      '. Завершено циклов: '+auto.runs+'.</p>'+
      (auto.lastError?'<p class="memory-note">'+escape(auto.lastError)+'</p>':'')+
      (auto.result?'<p class="memory-note">Проверенных записей: '+auto.result.metrics.verified+
      ', явных связей: '+auto.result.metrics.directLinks+
      ', кандидатов: '+auto.result.metrics.candidateLinks+
      ', возможных противоречий: '+auto.result.metrics.potentialConflicts+
      '. Поиск: '+(auto.result.strategy==='graph'?'графовый с проверкой':'лексический')+
      '. Контрольный поиск: '+Math.round(auto.result.metrics.lexicalRecallAt3*100)+'% → '+
      Math.round(auto.result.metrics.graphRecallAt3*100)+'% (приближённая оценка на связях).</p>':'')+
      (auto.result?.candidates.length?'<h4>Кандидаты новых связей</h4>'+auto.result.candidates.slice(0,8).map(a=>
      '<p class="memory-note">'+escape(a.left.text)+' ↔ '+escape(a.right.text)+' <small>Возможная связь — не подтверждена</small></p>').join(''):'')+
      (auto.result?.conflicts.length?'<h4>Нужна проверка</h4>'+auto.result.conflicts.slice(0,6).map(a=>
      '<p class="memory-note">'+escape(a.left.text)+' / '+escape(a.right.text)+' <small>Возможное противоречие</small></p>').join(''):'')+
      '</section>'):'';
    const archiveCount=v.archive?.archived;
    const cards=counts.map(([name,value])=>
      '<div class="cognitive-metric"><strong>'+value+'</strong><span>'+name+'</span></div>').join('');
    const kind: Record<CognitiveView['associations'][number]['kind'],string>={
      direct:'Прямая связь в графе',episode:'Общий эпизод',entity:'Общий объект',topic:'Общая тема'
    };
    const rows=c.associations.slice(0,96).map(a=>{
      const text=[a.left.text,a.right.text,a.source.title].join(' ').toLocaleLowerCase('ru');
      const hidden=cognitiveQuery&&!text.includes(cognitiveQuery.toLocaleLowerCase('ru'))?' hidden':'';
      const status=a.state==='recorded'?'Из записанных фактов':'Требует подтверждения';
      return '<article class="cognitive-pair" data-cognitive-row'+hidden+'>'+
        '<span class="cognitive-kind">'+escape(kind[a.kind])+' · '+status+'</span>'+
        '<div class="cognitive-pair-body">'+
        '<button type="button" class="memory-link" data-memory-goto="'+escape(a.left.id)+'" data-tab="fact">'+escape(a.left.text)+'</button>'+
        '<span aria-hidden="true" class="cognitive-arrow">↔</span>'+
        '<button type="button" class="memory-link" data-memory-goto="'+escape(a.right.id)+'" data-tab="fact">'+escape(a.right.text)+'</button>'+
        '</div><small>'+escape(a.source.title)+'</small></article>';
    }).join('');
    const warnings=c.uncertainties.map(u=>'<div class="cognitive-uncertain"><span>'+
      (u.reason==='contested'?'Противоречие':'Предположение')+
      '</span><button type="button" class="memory-link" data-memory-goto="'+escape(u.id)+'" data-tab="fact">'+escape(u.text)+'</button></div>').join('');
    const questions=c.questions.map(q=>'<p class="cognitive-question">'+escape(q.kind==='conflict'?'Уточнить противоречие: ':'Не хватает данных: ')+escape(q.text)+'</p>').join('');
    return '<div class="cognitive-overview"><h3>Когнитивная память</h3>'+
      '<p class="memory-note">Сопоставляет уже сохранённые факты, эпизоды, темы и граф связей. '+
      'Новые выводы не объявляются истиной автоматически. Совместное упоминание не доказывает причинность.</p>'+
      '<div class="cognitive-metrics">'+cards+'</div>'+autoInfo+ 
      (archiveCount?'<section class="memory-archive"><h3>Долговременный архив</h3>'+ 
      '<p class="memory-note">Сохранено вне активной памяти: фактов и правил — '+archiveCount.facts+', эпизодов — '+archiveCount.episodes+', связей — '+archiveCount.edges+'. Архив хранится локально и используется в ответах по релевантной теме.</p>'+ 
      '<form class="memory-archive-search"><label>Поиск старых записей <input type="search" name="query" maxlength="120" placeholder="Слово или тема" value="'+escape(archiveQuery)+'"></label> <button type="submit" class="button quiet">Найти в архиве</button></form>'+ 
      (archiveQuery?'<div class="memory-archive-results" aria-live="polite">'+(archiveResults.length?archiveResults.map(r=>'<p><b>'+escape(r.kind==='episode'?'Эпизод':r.kind==='rule'?'Правило':'Факт')+':</b> '+escape(r.text)+'</p>').join(''):'<p class="memory-empty">По этому запросу архивных записей не найдено.</p>')+'</div>':'')+'</section>':'')+
      (c.summary.expired?'<p class="memory-note">Неактуальных или заменённых записей: '+c.summary.expired+'. Они не участвуют в контекстном поиске.</p>':'')+
      '<label class="cognitive-filter">Найти связь <input type="search" data-cognitive-search maxlength="120" placeholder="Тема, факт или эпизод" value="'+escape(cognitiveQuery)+'"></label>'+
      '<section class="cognitive-results" aria-label="Связи между записями">'+(rows||'<p class="memory-empty">Пока нет связанных записей. После изучения разговоров и документов здесь появятся связи с источниками.</p>')+'</section>'+
      (warnings?'<h3>Нужно перепроверить</h3>'+warnings:'')+
      (questions?'<h3>Открытые вопросы</h3>'+questions:'')+'</div>';
  }
  function listHtml() {
    if (!view) return '<p class="memory-empty">Загружаю память…</p>';
    if (tab === 'growth') return growthHtml(view);
    if (tab === 'cognitive') return cognitiveHtml(view);
    if (tab === 'plans') return plansHtml(view);
    if (tab === 'thoughts') return thoughtsHtml(view);
    if (tab === 'logic') return logicHtml(view);
    if (tab === 'timeline') return timelineHtml(view);
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
    if (view.busy) return view.busy === 'sleep' ? 'Сейчас сон: перечитываю эпизоды и заметки, навожу порядок…' : view.busy === 'think' ? 'Размышляю о вас…' : 'Разбираю недавний разговор…';
    if (!view.available) return 'Подключите cloud.ru, чтобы память пополнялась сама';
    return `Уровень ${view.growth.level} · сон: ${view.lastSleep ? when(view.lastSleep, true) : 'ещё не было'} · новых эпизодов ${view.newEpisodes} · поиск ${view.search === 'meaning' ? 'по смыслу' : 'по словам'}${view.private ? ' · приватный режим' : ''}`;
  }
  function render() {
    if (panel.hidden) return;
    const count = (t: Tab) => !view || t === 'journal' || t === 'map' || t === 'growth' || t === 'timeline' ? '' : String((t === 'thoughts' ? view.thoughts.filter(x => !x.seen).length : t === 'plans' ? view.promises.filter(p => !p.done).length + view.reminders.filter(x => !x.fired).length + view.goals.filter(g => !g.done).length : t === 'logic' ? view.predictions.filter(p => !p.outcome).length : t === 'cognitive' ? (view.cognitive?.summary.associations || 0) : t === 'episode' ? view.episodes.length : t === 'diary' ? view.diary.length : view.items.filter(i => i.kind === t).length) || '');
    const scroll = panel.querySelector('.memory-list')?.scrollTop || 0;
    const off = !view || busy ? 'disabled' : '';
    panel.classList.toggle('wide', tab === 'map');
    panel.innerHTML = `<header class="memory-head"><span class="memory-mark"><svg viewBox="0 0 24 24" aria-hidden="true">${brainIcon}</svg></span><div><b>Память Миюнэи</b><small>${escape(statusLine())}</small></div><button type="button" class="icon-button ${settings ? 'active' : ''}" data-memory-settings aria-label="Настройки памяти" aria-expanded="${settings}" title="Настройки памяти"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/></svg></button><button type="button" class="icon-button" data-memory-close aria-label="Закрыть память">×</button></header>`
      + (settings ? `<div class="memory-switches"><label class="switch"><input type="checkbox" data-memory-enabled ${view?.enabled ? 'checked' : ''} ${off}><span>Память включена</span></label><label class="switch"><input type="checkbox" data-memory-private ${view?.private ? 'checked' : ''} ${off || (view?.enabled ? '' : 'disabled')}><span>Приватный режим: новые разговоры не запоминаются</span></label><div class="memory-danger"><button type="button" class="button quiet danger" data-memory-reset ${off}>Сбросить память</button><small>Факты, правила, эпизоды и дневник будут стёрты без возврата.</small></div></div>` : '')
      + (view?.searchError && view.available ? `<p class="memory-warn">Поиск по смыслу недоступен, пока ищу по словам. ${escape(view.searchError)}</p>` : '')
      + `<div class="memory-groups" role="tablist">${groups.map(([key, label, list]) => {
        const total = list.reduce((sum, t) => sum + (Number(count(t)) || 0), 0);
        return `<button type="button" role="tab" aria-selected="${group === key}" class="${group === key ? 'active' : ''}" data-memory-group="${key}">${label}${total ? ` <small>${total}</small>` : ''}</button>`;
      }).join('')}</div>`
      + `<div class="memory-tabs" role="tablist">${groups.find(([key]) => key === group)![2].map(key => `<button type="button" role="tab" aria-selected="${tab === key}" class="${tab === key ? 'active' : ''}" data-memory-tab="${key}">${tabLabel(key)}${count(key) ? ` <small>${count(key)}</small>` : ''}</button>`).join('')}</div>`
      + `<div class="memory-list" role="tabpanel">${listHtml()}</div>`
      + (tab === 'fact' || tab === 'rule' ? `<form class="memory-add"><input name="text" maxlength="400" autocomplete="off" placeholder="${tab === 'fact' ? 'Добавить факт, например «работает по утрам»' : 'Добавить правило, например «задачи писать коротко»'}" aria-label="Новая запись" ${off}>${tab === 'fact' ? categorySelect(filter === 'all' ? 'other' : filter) : ''}<button class="button" type="submit" ${off}>Добавить</button></form>` : '')
      + `<footer class="memory-foot"><button type="button" class="button" data-memory-sleep ${off || (view?.available && view.enabled && !view.private ? '' : 'disabled')}>Уснуть сейчас</button><a class="button" href="/api/memory/export" download>Экспорт</a></footer>`;
    for (const meter of panel.querySelectorAll<HTMLElement>('[data-strength]')) meter.style.setProperty('--strength', String(Math.max(0.04, Number(meter.dataset.strength))));
    for (const meter of panel.querySelectorAll<HTMLElement>('[data-progress]')) meter.style.setProperty('--progress', meter.dataset.progress!);
    const list = panel.querySelector('.memory-list'); if (list) list.scrollTop = scroll;
    clearTimeout(poll);
    if (view?.busy) poll = setTimeout(() => void refresh(), 3000);
  }
  async function refresh() {
    try { await request(''); } catch {}
    render();
  }
  // «Пока вас не было, я думала о…»: new thoughts greet the user when they come back.
  const note = document.createElement('aside');
  note.className = 'thought-note'; note.hidden = true; note.setAttribute('role', 'status');
  document.body.append(note);
  let greeted = '';
  function welcome() {
    const fresh = newest((view?.thoughts || []).filter(t => !t.seen));
    if (!fresh.length || !panel.hidden || greeted === fresh[0].id) { if (!fresh.length) note.hidden = true; return; }
    greeted = fresh[0].id;
    note.innerHTML = `<p><b>Пока вас не было, я думала о…</b>${escape(short(fresh[0].text, 180))}${fresh.length > 1 ? `<small>и ещё ${fresh.length - 1}</small>` : ''}</p><div><button type="button" class="button" data-thought-open>Почитать</button><button type="button" class="icon-button" data-thought-close aria-label="Скрыть">×</button></div>`;
    note.hidden = false;
  }
  function markSeen() { note.hidden = true; if (view?.thoughts.some(t => !t.seen)) void request('/thoughts/seen', { method: 'POST' }).then(render).catch(() => {}); }
  note.addEventListener('click', event => {
    const target = (event.target as HTMLElement).closest('button');
    if (target?.hasAttribute('data-thought-open')) { open('thoughts'); markSeen(); }
    if (target?.hasAttribute('data-thought-close')) markSeen();
  });
  // The server thinks while the page sits in the background; look again when the user comes back.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void request('').then(welcome).catch(() => {}); });
  setInterval(() => { if (panel.hidden && document.visibilityState === 'visible') void request('').then(welcome).catch(() => {}); }, 10 * 60_000);
  function open(start?: Tab) { if (start) { goTab(start); editing = ''; } note.hidden = true; panel.hidden = false; render(); void refresh(); panel.querySelector<HTMLElement>('[data-memory-close]')?.focus(); sync(); }
  function close() { if (panel.hidden) return; panel.hidden = true; editing = ''; clearTimeout(poll); sync(); document.querySelector<HTMLElement>('[data-memory-toggle]')?.focus(); }
  const sync = () => document.querySelector('[data-memory-toggle]')?.setAttribute('aria-expanded', String(!panel.hidden));
  function select(id: string) { goTab('map'); selected = id; editing = ''; render(); }

  panel.addEventListener('click', async event => {
    const node = (event.target as Element).closest<SVGGElement>('[data-node]');
    if (node) { selected = selected === node.dataset.node ? '' : node.dataset.node!; editing = ''; render(); return; }
    const target = (event.target as HTMLElement).closest<HTMLElement>('button,a');
    if (!target) return;
    const d = target.dataset;
    if (target.hasAttribute('data-memory-close')) return close();
    if (target.hasAttribute('data-memory-settings')) { settings = !settings; render(); return; }
    // Picking a group opens its first view, unless the current one already belongs to it.
    if (d.memoryGroup) {
      const next = groups.find(([key]) => key === d.memoryGroup)!;
      if (group !== next[0]) { group = next[0]; tab = next[2][0]; }
      editing = ''; render(); panel.querySelector('.memory-list')!.scrollTop = 0; if (tab === 'thoughts') markSeen(); return;
    }
    if (d.memoryTab) { goTab(d.memoryTab as Tab); editing = ''; render(); panel.querySelector('.memory-list')!.scrollTop = 0; if (tab === 'thoughts') markSeen(); return; }
    if (d.memoryFilter) { filter = d.memoryFilter as Category | 'all'; render(); return; }
    if (d.memorySelect) { select(d.memorySelect); return; }
    if (d.memoryEdit) { editing = d.memoryEdit; render(); panel.querySelector<HTMLElement>('.memory-edit textarea, .memory-edit input')?.focus(); return; }
    if (target.hasAttribute('data-memory-cancel')) { editing = ''; render(); return; }
    if (d.memoryNote) { close(); host.openNote(d.memoryNote); return; }
    if (d.memoryGoto) {
      goTab(d.tab as Tab); editing = ''; filter = 'all'; render();
      const row = panel.querySelector<HTMLElement>('#memory-' + CSS.escape(d.memoryGoto));
      row?.scrollIntoView({ block: 'nearest' }); row?.classList.add('flash');
      return;
    }
    if (d.memoryDone) { await act('/items/' + d.memoryDone, { method: 'PATCH', json: { done: d.value === 'true' } }, d.value === 'true' ? 'Отметила как выполненное' : 'Обещание снова открыто'); return; }
    if (d.memoryCheck) { await act('/items/' + d.memoryCheck, { method: 'PATCH', json: { result: d.value } }, d.value === 'right' ? 'Отметила: прогноз сбылся' : 'Отметила: прогноз не сбылся, запишу ошибку'); return; }
    if (d.memoryRearm) { const x = view?.reminders.find(r => r.id === d.memoryRearm); if (x) await act('/items/' + x.id, { method: 'PATCH', json: { text: x.text } }, 'Напомню ещё раз'); return; }
    if (d.memoryDismiss) { await act('/items/' + d.memoryDismiss, { method: 'DELETE' }, 'Больше не спрошу'); return; }
    if (d.memoryUnlink) { await act('/unlink', { method: 'POST', json: { from: selected, to: d.memoryUnlink } }, 'Связь убрана'); return; }
    if (d.memoryPin) { const item = view?.items.find(i => i.id === d.memoryPin); if (item) await act('/items/' + item.id, { method: 'PATCH', json: { pinned: !item.pinned } }, item.pinned ? 'Запись откреплена' : 'Закреплено: эта запись не будет забыта'); return; }
    if (d.memoryDelete && await host.confirm(d.what === 'diary' ? 'Удалить запись дневника?' : d.what === 'thought' ? 'Удалить это размышление?' : d.what === 'goal' ? 'Удалить цель вместе с шагами?' : d.memoryDelete === 'understanding' ? 'Удалить общее понимание? Я соберу его заново во время сна.' : 'Удалить запись из памяти?')) { if (await act('/items/' + d.memoryDelete, { method: 'DELETE' }, d.what === 'diary' ? 'Запись дневника удалена' : 'Запись удалена') && selected === d.memoryDelete) { selected = ''; render(); } return; }
    if (target.hasAttribute('data-memory-think')) { await act('/think', { method: 'POST' }, 'Подумала. Мысли — во вкладке «Размышления»'); return; }
    if (target.hasAttribute('data-memory-sleep')) { await act('/sleep', { method: 'POST' }, 'Сон завершён: память упорядочена'); return; }
    if (target.hasAttribute('data-memory-reset') && await host.confirm('Стереть всю память Миюнэи?')) { await act('', { method: 'DELETE' }, 'Память очищена'); return; }
  });
  panel.addEventListener('keydown', event => {
    const node = (event.target as Element).closest<SVGGElement>('[data-node]');
    if (node && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); selected = node.dataset.node!; render(); panel.querySelector<SVGGElement>(`[data-node="${CSS.escape(selected)}"]`)?.focus(); return; }
    if (event.key === 'Escape' && !(event.target as HTMLElement).closest('.memory-edit')) { event.stopPropagation(); close(); }
  });
  panel.addEventListener('input',event=>{
    const target=event.target as HTMLInputElement;
    if(!target.hasAttribute('data-cognitive-search'))return;
    cognitiveQuery=target.value.slice(0,120);
    for(const row of panel.querySelectorAll<HTMLElement>('[data-cognitive-row]'))
      row.hidden=!!cognitiveQuery&&!row.textContent!.toLocaleLowerCase('ru').includes(cognitiveQuery.toLocaleLowerCase('ru'));
  });
  panel.addEventListener('change', event => {
    const input = event.target as HTMLInputElement;
    if (input.dataset.goal && input.dataset.step) void act('/items/' + input.dataset.goal, { method: 'PATCH', json: { step: input.dataset.step, done: input.checked } }, input.checked ? 'Шаг выполнен' : 'Шаг снова открыт');
    if (input.hasAttribute('data-memory-enabled')) void act('', { method: 'PUT', json: { enabled: input.checked } }, input.checked ? 'Память включена' : 'Память выключена');
    if (input.hasAttribute('data-memory-thinking')) void act('', { method: 'PUT', json: { thinking: input.checked } }, input.checked ? 'Буду размышлять, пока вас нет' : 'Размышления выключены');
    if (input.hasAttribute('data-memory-intensity')) void act('', { method: 'PUT', json: { intensity: input.value } }, 'Частота размышлений изменена');
    if (input.hasAttribute('data-memory-private')) void act('', { method: 'PUT', json: { private: input.checked } }, input.checked ? 'Приватный режим: разговоры не запоминаются' : 'Приватный режим выключен');
  });
  panel.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const field = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | null)?.value.trim();
    if (form.classList.contains('memory-archive-search')) {
      archiveQuery=(field('query')||'').slice(0,120);
      archiveResults=[];
      if(archiveQuery)try{
        const response=await fetch('/api/memory/archive?q='+encodeURIComponent(archiveQuery));
        if(!response.ok)throw Error('Поиск архива недоступен');
        const result=await response.json();
        archiveResults=Array.isArray(result.results)?result.results.map((r:{id:string;kind:string;text:string})=>({id:r.id,kind:r.kind,text:r.text})).slice(0,20):[];
      }catch{host.toast('Не удалось найти записи в архиве. Проверьте сервер.');}
      render();return;
    }
    if (form.classList.contains('memory-add')) {
      const text = field('text');
      if (text && await act('/items', { method: 'POST', json: { kind: tab, text, category: tab === 'fact' ? field('category') : undefined } }, tab === 'rule' ? 'Правило добавлено' : 'Факт добавлен')) panel.querySelector<HTMLInputElement>('.memory-add input')?.focus();
      return;
    }
    if (form.classList.contains('memory-remind')) {
      const about = field('about'), text = field('text');
      if (!about || !text) return host.toast('Укажите тему и о чём напомнить');
      await act('/reminders', { method: 'POST', json: { about, text } }, 'Напомню, когда речь зайдёт об этом');
      return;
    }
    if (form.classList.contains('memory-goal')) {
      const title = field('title');
      if (title) await act('/goals', { method: 'POST', json: { title } }, 'Цель разложена на шаги');
      return;
    }
    if (form.dataset.question) {
      const text = field('answer');
      if (text) await act('/answer', { method: 'POST', json: { id: form.dataset.question, text } }, 'Спасибо, запомнила');
      return;
    }
    const id = form.dataset.memorySave;
    if (!id) return;
    const change = id === 'understanding' ? { text: field('text') }
      : view?.reminders.some(x => x.id === id) ? { about: field('about'), text: field('text') }
      : view?.promises.some(p => p.id === id) ? { text: field('text'), until: field('due') || null }
      : tab === 'growth' ? { title: field('title'), summary: field('summary'), category: field('category') }
      : tab === 'episode' ? { topic: field('topic'), outcome: field('outcome') }
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
    load: () => request('').then(v => { welcome(); return v; }).catch(() => null),
  };
}
