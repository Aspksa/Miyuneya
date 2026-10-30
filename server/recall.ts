import { projectMemory, historicalDate } from './cognition.ts';
import { localDateKey } from '../src/calendar.ts';
import type { Memory, MemoryItem, Episode, Entity, RelationType, Topic, Category, Reminder, Cause, Goal } from './memory.ts';

// Recall: what the assistant remembers before an answer. Records are scored by meaning (embedding vectors from
// cloud.ru), by shared words, by strength and freshness; then the knowledge graph adds what the chosen records lead to.
export type Titles = Map<string, { kind: 'note' | 'task'; title: string }>;
// latest is the user's newest message: time words are read from it alone, while topics come from the recent turns.
export type Recall = { query?: number[]; vector?: (text: string) => number[] | undefined; question?: string; latest?: string; thoughts?: string[] };

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
export const today = (now = Date.now()) => localDateKey(new Date(now));
// A fact with a date limit («переезжает в ноябре») stops being true after that day.
export const expired = (item: Pick<MemoryItem, 'until'>, now = Date.now()) => !!item.until && item.until < today(now);

// The text each record is searched and embedded by.
export const itemText = (i: MemoryItem) => i.text;
export const episodeText = (e: Episode) => e.topic + (e.outcome ? ' — ' + e.outcome : '');
export const entityText = (e: Entity) => [e.name, ...e.aliases].join(', ') + (e.about ? ': ' + e.about : '');
export const topicText = (t: Topic) => t.title + (t.summary ? ': ' + t.summary : '');
export const causeText = (c: Cause) => `${c.cause} → ${c.effect}`;
export const searchTexts = (memory: Memory) => [...memory.items.filter(i=>i.status!=='superseded').map(itemText), ...memory.episodes.map(episodeText), ...memory.entities.map(entityText), ...memory.topics.map(topicText), ...memory.reminders.filter(x => !x.fired).map(x => x.about),
  ...memory.causes.map(causeText), ...memory.goals.filter(g => !g.done).map(g => g.title)];

// Time words in a question («вчера», «на прошлой неделе», «в прошлый вторник», «три дня назад») become a date range.
const NUMBERS: Record<string, number> = { один: 1, одну: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10 };
const WEEKDAYS = ['воскресень', 'понедельник', 'вторник', 'сред', 'четверг', 'пятниц', 'суббот'];
export function timeRange(text: string, now = Date.now()) {
  const t = text.toLocaleLowerCase('ru').replaceAll('ё', 'е');
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const at = (days: number) => { const d = new Date(today); d.setDate(d.getDate() + days); return d.getTime(); };
  const monday = -((today.getDay() + 6) % 7);
  const month = (shift: number) => new Date(today.getFullYear(), today.getMonth() + shift, 1).getTime();
  const range = (from: number, to: number, label: string) => ({ from, to: Math.min(to, now + 1), label });
  let m: RegExpExecArray | null;
  if (/позавчера/.test(t)) return range(at(-2), at(-1), 'позавчера');
  if (/вчера/.test(t)) return range(at(-1), at(0), 'вчера');
  if ((m = /(\d+|один|одну|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять)?\s*(дн[яейь]+|день|недел[июь]+)\s+назад/.exec(t))) {
    const n = m[1] ? Number(m[1]) || NUMBERS[m[1]] : 1;
    return m[2].startsWith('недел') ? range(at(-7 * n - 3), at(-7 * n + 4), m[0]) : range(at(-n - 1), at(-n + 2), m[0]);
  }
  if ((m = /(?:^|[\s,])во?\s+(прошл\S*\s+)?(понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)/.exec(t))) {
    const wanted = WEEKDAYS.findIndex(w => m![2].startsWith(w));
    const back = (today.getDay() - wanted + 7) % 7 || 7;
    return range(at(-back), at(-back + 1), m[0].trim());
  }
  if (/на\s+прошлой\s+неделе|прошлую\s+неделю/.test(t)) return range(at(monday - 7), at(monday), 'на прошлой неделе');
  if (/на\s+этой\s+неделе|эту\s+неделю/.test(t)) return range(at(monday), at(1), 'на этой неделе');
  if (/в\s+прошлом\s+месяце|прошлый\s+месяц/.test(t)) return range(month(-1), month(0), 'в прошлом месяце');
  if (/в\s+этом\s+месяце/.test(t)) return range(month(0), at(1), 'в этом месяце');
  if (/на\s+днях|недавно/.test(t)) return range(at(-3), at(1), 'на днях');
  if (/сегодня/.test(t)) return range(at(0), at(1), 'сегодня');
  return null;
}
export const reminderLine = (x: Pick<Reminder, 'about' | 'text'>) => `Ты обещала напомнить, когда речь зайдёт о «${x.about}». Напомни сейчас, естественно, в начале или в конце ответа: «${x.text}».`;
// Loose stems for a reminder topic, so «о Кате» meets «Катя» and «поездке» meets «поездка».
const stems = (text: string) => new Set((text.toLocaleLowerCase('ru').replaceAll('ё', 'е').match(/[\p{L}\p{N}]+/gu) || []).filter(w => w.length >= 3 && !STOP.has(w)).map(w => w.slice(0, Math.max(3, Math.min(5, w.length - 1)))));
export function reminderDue(reminder: Pick<Reminder, 'about' | 'said'>, query: string, semantic: number | null) {
  const flat = query.replace(/\s+/g, ' ');
  const setNow = !!reminder.said && flat.includes(reminder.said);
  const rest = setNow ? flat.replace(reminder.said, ' ') : flat;
  if (!rest.trim()) return false;
  const about = stems(reminder.about), q = stems(rest);
  const shared = [...about].filter(t => q.has(t)).length;
  if (about.size && shared >= Math.max(1, about.size / 2)) return true;
  // Meaning only counts once the message that set the reminder has left the question.
  return !setNow && semantic !== null && semantic >= 0.55;
}
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

export const nextStepsOf = (goal: Goal) => goal.steps.filter(s => !s.done && s.after.every(id => goal.steps.find(x => x.id === id)?.done) && !goal.steps.some(x => x.parent === s.id && !x.done));
export function memoryContext(memory: Memory, query: string, titles: Titles = new Map(), now = Date.now(), recall: Recall = {}) {
  if (!memory.settings.enabled) return '';
  const historical=/(?:по состоянию на|актуально на)\s+\d{4}-\d{2}-\d{2}/iu.test(recall.latest??query);const asOf=historicalDate(recall.latest??query,today(now));if(asOf!==today(now)){const [y,m,d]=asOf.split('-').map(Number);now=new Date(y,m-1,d,12).getTime();}memory=projectMemory(memory,query,asOf,recall.latest??query);
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
  const live = memory.items.filter(i => i.status!=='superseded' && !expired(i, now)).map(item => ({ item, power: historical&&item.source==='user'&&(item.validFrom||item.validTo||item.until)?Math.max(0.2,strength(item,now)):strength(item, now) })).filter(x => x.power >= FORGET_BELOW);
  const rules = live.filter(x => x.item.kind === 'rule').sort((a, b) => b.power - a.power);
  const facts = live.filter(x => x.item.kind === 'fact').map(x => { const m = match(x.item.text) + (inTopic.has(x.item.id) ? 0.25 : 0); return { ...x, match: m, score: x.power * (0.3 + m) }; }).sort((a, b) => b.score - a.score);
  const recent = memory.episodes.slice(-3).map(e => e.id);
  const range = timeRange(recall.latest ?? query, now);
  const during = (date: string) => !!range && Date.parse(date) >= range.from && Date.parse(date) < range.to;
  const episodes = memory.episodes.map(e => ({ e, score: match(episodeText(e)) + (recent.includes(e.id) ? 0.25 : 0) + (during(e.date) ? 0.6 : 0) })).filter(x => x.score > 0.25).sort((a, b) => b.score - a.score).slice(0, 4);
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
  // Prospective memory: a reminder fires when the talk turns to its topic.
  const due = memory.reminders.filter(x => !x.fired && reminderDue(x, query, semantic(x.about)));
  for (const x of due) add(reminderLine(x));
  if (due.length) add('');
  if (range) {
    const inRange = (date: string) => { const t = Date.parse(date); return t >= range.from && t < range.to; };
    const period = `${new Date(range.from).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}${range.to - range.from > DAY + 1 ? ' — ' + new Date(range.to - 1).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : ''}`;
    const then = [
      ...memory.episodes.filter(e => inRange(e.date)).sort((a, b) => a.date.localeCompare(b.date)).slice(-8).map(e => `- ${day(e.date)}, разговор: ${episodeText(e)}`),
      ...memory.items.filter(i => i.kind === 'fact' && inRange(i.created)).slice(-6).map(i => `- ${day(i.created)} узнала: ${i.text}`),
      ...memory.promises.filter(p => inRange(p.created)).slice(-4).map(p => `- ${day(p.created)} ты пообещала: ${p.text}${p.done ? ' (выполнено)' : ''}`),
    ];
    add(`Сегодня ${new Date(now).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}; пользователь спрашивает про время «${range.label}» (${period}).`);
    if (!then.length) add('В памяти нет записей за это время, так и скажи, если спросят.');
    else if (add('Что было в это время:')) for (const line of then) if (!add(line)) break;
    add('');
  }
  if (memory.understanding) { add('Твоё общее понимание пользователя:'); add('[Сводка модели, может быть устаревшей] '+memory.understanding.text); }
  if (topics.length) { add('\nТемы его жизни, к которым относится разговор:'); for (const { t } of topics) add(`- ${t.title} (${categoryNames[t.area].toLocaleLowerCase('ru')})${t.summary ? ': [сводка модели] ' + t.summary : ''}`); }
  if (rules.length) { add((lines.length ? '\n' : '') + 'Подтверждённые пожелания пользователя (учитывай с текущим запросом):'); for (const { item } of rules.filter(x=>x.item.source==='user'||x.item.evidence?.length).slice(0, 25)) if (!add('- ' + item.text)) break; }
  const known = [...chosen.map(c => c.item), ...pulled];
  if (known.length) { add('\nЧто ты знаешь о пользователе (используй к месту, не перечисляй без просьбы):'); for (const item of known) if (!add('- ' + (item.status==='inferred'?'[непроверенное предположение] ':item.status==='contested'?'[противоречие: уточнить] ':'') + item.text + until(item) + linked(item.links))) break; }
  if (entities.length) { add('\nЛюди, проекты и темы из разговора:'); for (const { e } of entities) add(`- ${e.name} (${entityNames[e.type]})${e.about ? ': ' + e.about : ''}`); }
  if (episodes.length) { add('\nПрошлые разговоры по теме:'); for (const { e } of episodes) add(`- ${day(e.date)}: ${episodeText(e)}${linked(e.links)}`); }
  if (chain.length) { add('\nСвязи по теме (учитывай всю историю вопроса):'); for (const line of chain) add('- ' + line); }
  // Cause and effect from the user's own life support conclusions about him.
  const causes = memory.causes.map(c => ({ c, score: match(causeText(c)) })).filter(x => x.score > 0.3).sort((a, b) => b.score - a.score || b.c.confidence - a.c.confidence).slice(0, 5);
  if (causes.length) { add('\nПредполагаемые связи из памяти (повтор не доказывает причинность; проверяй альтернативные объяснения):'); for (const { c } of causes) add(`- ${causeText(c)} (уверенность ${c.confidence}%)`); }
  const goals = memory.goals.filter(g => !g.done).map(g => ({ g, score: match(g.title + ' ' + g.steps.map(s => s.text).join(' ')) })).sort((a, b) => b.score - a.score).slice(0, 3);
  if (goals.length) {
    add('\nЦели пользователя и что по ним можно делать сейчас (подсказывай следующий шаг, когда разговор об этом):');
    for (const { g } of goals) { const ready = nextStepsOf(g); add(`- ${g.title}: сделано ${g.steps.filter(s => s.done).length} из ${g.steps.length}${ready.length ? '; можно сейчас: ' + ready.slice(0, 3).map(s => s.text).join('; ') : ''}`); }
  }
  const promises = memory.promises.filter(p => !p.done).slice(-8);
  if (promises.length) { add('\nТвои открытые обещания пользователю (выполни, когда будет к месту, и не обещай то же снова):'); for (const p of promises) add(`- ${p.text} (обещала ${day(p.created)}${p.due ? (p.due < today(now) ? '; срок прошёл ' : '; срок до ') + day(p.due) : ''})`); }
  if (recall.thoughts?.length) { add('\nПока пользователя не было, ты размышляла. Если к месту, можешь коротко поделиться одной мыслью («пока вас не было, я думала о…»), но не навязывай:'); for (const t of recall.thoughts) add('- ' + t); }
  if (recall.question) add(`\nПробел в твоей памяти. Если это к месту и не мешает ответу, в конце мягко спроси пользователя: «${recall.question}». Не спрашивай, если разговор о другом срочном деле.`);
  return lines.length ? 'Твоя долговременная память.\n' + lines.join('\n') : '';
}
