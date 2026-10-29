import type { Memory, MemoryItem, Episode, Entity, RelationType, Topic, Category } from './memory.ts';

// Recall: what the assistant remembers before an answer. Records are scored by meaning (embedding vectors from
// cloud.ru), by shared words, by strength and freshness; then the knowledge graph adds what the chosen records lead to.
export type Titles = Map<string, { kind: 'note' | 'task'; title: string }>;
export type Recall = { query?: number[]; vector?: (text: string) => number[] | undefined; question?: string };

export const FORGET_BELOW = 0.12;
const DAY = 86_400_000;
const day = (date: string) => new Date(date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
const STOP = new Set('это что как так для его она они оно мне меня мой моя мои тебя тебе твой ваш вас вам уже ещё еще или если когда где там тут вот был была было были быть есть нет нам наш все всё the and you про при над под без более очень просто тоже чтобы потом сейчас надо можно нужно хочу'.split(' '));
// Crude Russian stemming: the first five letters are enough to match «задачи» with «задач».
export function tokens(text: string) {
  const words = text.toLocaleLowerCase('ru').replaceAll('ё', 'е').match(/[\p{L}\p{N}]+/gu) || [];
  return new Set(words.filter(w => w.length >= 3 && !STOP.has(w)).map(w => w.slice(0, 5)));
}
export const overlap = (a: Set<string>, b: Set<string>) => { let n = 0; for (const t of a) if (b.has(t)) n++; return n; };
export function similarity(a: string, b: string) {
  const x = tokens(a), y = tokens(b);
  if (!x.size || !y.size) return a.trim().toLocaleLowerCase('ru') === b.trim().toLocaleLowerCase('ru') ? 1 : 0;
  const shared = overlap(x, y);
  return shared / (x.size + y.size - shared);
}
export function cosine(a: number[], b: number[]) {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return x && y ? dot / Math.sqrt(x * y) : 0;
}
// Weight fades with a half-life that grows with every confirmation; pinned records never fade.
export function strength(item: MemoryItem, now = Date.now()) {
  if (item.pinned) return 1;
  const age = Math.max(0, now - Date.parse(item.seen)) / DAY;
  const halfLife = (item.kind === 'rule' ? 60 : 30) * (1 + Math.min(item.hits - 1, 6));
  return item.weight * 0.5 ** (age / halfLife);
}
export const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
// A fact with a date limit («переезжает в ноябре») stops being true after that day.
export const expired = (item: Pick<MemoryItem, 'until'>, now = Date.now()) => !!item.until && item.until < today(now);

// The text each record is searched and embedded by.
export const itemText = (i: MemoryItem) => i.text;
export const episodeText = (e: Episode) => e.topic + (e.outcome ? ' — ' + e.outcome : '');
export const entityText = (e: Entity) => [e.name, ...e.aliases].join(', ') + (e.about ? ': ' + e.about : '');
export const topicText = (t: Topic) => t.title + (t.summary ? ': ' + t.summary : '');
export const searchTexts = (memory: Memory) => [...memory.items.map(itemText), ...memory.episodes.map(episodeText), ...memory.entities.map(entityText), ...memory.topics.map(topicText)];
export const categoryNames: Record<Category, string> = { personal: 'Личное', work: 'Работа', health: 'Здоровье', plans: 'Планы', tastes: 'Вкусы', people: 'Люди', other: 'Разное' };

export const relationNames: Record<RelationType, string> = { related: 'связано с', part_of: 'часть', blocks: 'мешает', after: 'после', decided_in: 'решено в', about: 'про' };
export const entityNames: Record<Entity['type'], string> = { person: 'человек', project: 'проект', place: 'место', topic: 'тема', thing: 'вещь' };
const short = (text: string, max = 70) => text.length > max ? text.slice(0, max - 1) + '…' : text;
export function nodeName(memory: Memory, titles: Titles, id: string) {
  const item = memory.items.find(i => i.id === id);
  if (item) return `«${short(item.text)}»`;
  const episode = memory.episodes.find(e => e.id === id);
  if (episode) return `разговор ${day(episode.date)} «${short(episode.topic, 50)}»`;
  const entity = memory.entities.find(e => e.id === id);
  if (entity) return entity.name;
  const entry = titles.get(id);
  return entry ? `${entry.kind === 'task' ? 'задача' : 'заметка'} «${short(entry.title, 50)}»` : null;
}
// Every connection of a record: plain links in both directions and typed relations.
export function neighbours(memory: Memory, id: string) {
  const out: { id: string; type: RelationType; forward: boolean }[] = [];
  for (const record of [...memory.items, ...memory.episodes]) {
    if (record.id === id) for (const link of record.links) out.push({ id: link, type: 'related', forward: true });
    else if (record.links.includes(id)) out.push({ id: record.id, type: 'related', forward: false });
  }
  for (const edge of memory.edges) {
    if (edge.from === id) out.push({ id: edge.to, type: edge.type, forward: true });
    else if (edge.to === id) out.push({ id: edge.from, type: edge.type, forward: false });
  }
  return out;
}

export function memoryContext(memory: Memory, query: string, titles: Titles = new Map(), now = Date.now(), recall: Recall = {}) {
  if (!memory.settings.enabled) return '';
  const q = tokens(query);
  const lexical = (text: string) => { const t = tokens(text); return t.size ? Math.min(1, overlap(q, t) / Math.sqrt(t.size)) : 0; };
  const semantic = (text: string) => {
    const v = recall.query && recall.vector?.(text);
    return v ? Math.min(1, Math.max(0, (cosine(recall.query!, v) - 0.2) / 0.5)) : null;
  };
  // Hybrid: meaning when vectors exist, shared words always (names and dates survive embeddings poorly).
  const match = (text: string) => { const s = semantic(text); return s === null ? lexical(text) : 0.65 * s + 0.35 * lexical(text); };
  // The upper levels of memory come first: matching topics lift their facts.
  const topics = memory.topics.map(t => ({ t, score: match(topicText(t)) })).filter(x => x.score > 0.3).sort((a, b) => b.score - a.score).slice(0, 3);
  const inTopic = new Set(topics.flatMap(x => x.t.facts));
  const live = memory.items.filter(i => !expired(i, now)).map(item => ({ item, power: strength(item, now) })).filter(x => x.power >= FORGET_BELOW);
  const rules = live.filter(x => x.item.kind === 'rule').sort((a, b) => b.power - a.power);
  const facts = live.filter(x => x.item.kind === 'fact').map(x => { const m = match(x.item.text) + (inTopic.has(x.item.id) ? 0.25 : 0); return { ...x, match: m, score: x.power * (0.3 + m) }; }).sort((a, b) => b.score - a.score);
  const recent = memory.episodes.slice(-3).map(e => e.id);
  const episodes = memory.episodes.map(e => ({ e, score: match(episodeText(e)) + (recent.includes(e.id) ? 0.25 : 0) })).filter(x => x.score > 0.25).sort((a, b) => b.score - a.score).slice(0, 4);
  const entities = memory.entities.map(e => ({ e, score: match(entityText(e)) + ([e.name, ...e.aliases].some(name => tokens(name).size && [...tokens(name)].every(t => q.has(t))) ? 0.5 : 0) }))
    .filter(x => x.score > 0.35).sort((a, b) => b.score - a.score).slice(0, 4);
  const chosen = facts.slice(0, 12);
  // Chain recall: from the records that match best, follow the graph two steps out.
  const seeds = [...facts.filter(f => f.match > 0.3).slice(0, 3).map(f => f.item.id), ...episodes.map(x => x.e.id), ...entities.map(x => x.e.id)];
  const chain: string[] = []; const reached = new Set(seeds); const pulled: MemoryItem[] = [];
  let frontier = seeds;
  for (let depth = 0; depth < 2 && chain.length < 10; depth++) {
    const next: string[] = [];
    for (const id of frontier) for (const link of neighbours(memory, id)) {
      const a = nodeName(memory, titles, id), b = nodeName(memory, titles, link.id);
      if (!a || !b) continue;
      const line = link.forward ? `${a} → ${relationNames[link.type]} → ${b}` : `${b} → ${relationNames[link.type]} → ${a}`;
      if (!chain.includes(line) && chain.length < 10) chain.push(line);
      if (reached.has(link.id)) continue;
      reached.add(link.id); next.push(link.id);
      const fact = live.find(x => x.item.id === link.id && x.item.kind === 'fact');
      if (fact && !chosen.some(c => c.item === fact.item) && pulled.length < 4) pulled.push(fact.item);
    }
    frontier = next;
  }
  const linked = (links: string[]) => {
    const names = links.map(id => nodeName(memory, titles, id)).filter(Boolean).slice(0, 4);
    return names.length ? ` (связано: ${names.join('; ')})` : '';
  };
  const until = (i: MemoryItem) => i.until ? ` (актуально до ${day(i.until)})` : '';
  const lines: string[] = [];
  let budget = 6000;
  const add = (line: string) => { if (line.length > budget) return false; lines.push(line); budget -= line.length + 1; return true; };
  if (memory.understanding) { add('Твоё общее понимание пользователя:'); add(memory.understanding.text); }
  if (topics.length) { add('\nТемы его жизни, к которым относится разговор:'); for (const { t } of topics) add(`- ${t.title} (${categoryNames[t.area].toLocaleLowerCase('ru')})${t.summary ? ': ' + t.summary : ''}`); }
  if (rules.length) { add((lines.length ? '\n' : '') + 'Как пользователь любит, чтобы ты отвечала и действовала (соблюдай всегда):'); for (const { item } of rules.slice(0, 25)) if (!add('- ' + item.text)) break; }
  const known = [...chosen.map(c => c.item), ...pulled];
  if (known.length) { add('\nЧто ты знаешь о пользователе (используй к месту, не перечисляй без просьбы):'); for (const item of known) if (!add('- ' + item.text + until(item) + linked(item.links))) break; }
  if (entities.length) { add('\nЛюди, проекты и темы из разговора:'); for (const { e } of entities) add(`- ${e.name} (${entityNames[e.type]})${e.about ? ': ' + e.about : ''}`); }
  if (episodes.length) { add('\nПрошлые разговоры по теме:'); for (const { e } of episodes) add(`- ${day(e.date)}: ${episodeText(e)}${linked(e.links)}`); }
  if (chain.length) { add('\nСвязи по теме (учитывай всю историю вопроса):'); for (const line of chain) add('- ' + line); }
  if (recall.question) add(`\nПробел в твоей памяти. Если это к месту и не мешает ответу, в конце мягко спроси пользователя: «${recall.question}». Не спрашивай, если разговор о другом срочном деле.`);
  return lines.length ? 'Твоя долговременная память.\n' + lines.join('\n') : '';
}
