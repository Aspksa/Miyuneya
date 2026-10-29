import { readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { atomicWrite } from '../scripts/runtime.mjs';
import type { Workspace } from '../src/model.ts';

// Long-term memory of the assistant, kept in data/memory.json next to the workspace.
// Facts (semantic) and rules (procedural) carry a weight that confirmations raise and time lowers;
// episodes record finished dialogs; the journal shows what was learned, merged and forgotten.
export type MemoryKind = 'fact' | 'rule';
export type MemoryItem = { id: string; kind: MemoryKind; text: string; weight: number; hits: number; created: string; seen: string; pinned: boolean; source: 'user' | 'dialog' | 'sleep'; links: string[] };
export type Episode = { id: string; date: string; topic: string; outcome: string; links: string[]; consolidated: boolean };
export type JournalKind = 'learned' | 'rule' | 'reinforced' | 'weakened' | 'merged' | 'forgot' | 'episode' | 'sleep' | 'edited';
export type JournalEntry = { at: string; kind: JournalKind; text: string };
export type ChatMessage = { role: 'user' | 'assistant'; content: string };
export type Dialog = { id: string; messages: ChatMessage[]; summary: string; updatedAt: string; failures: number };
export type Memory = { version: 1; settings: { enabled: boolean; private: boolean }; items: MemoryItem[]; episodes: Episode[]; journal: JournalEntry[]; lastSleep: string | null; dialogs: Dialog[]; marks: Mark[] };
// The last message already reflected on, so a dialog that continues later is not analysed twice.
type Mark = { id: string; last: string };
type Titles = Map<string, { kind: 'note' | 'task'; title: string }>;

export const LIMITS = { items: 600, episodes: 400, journal: 200, text: 400, dialogs: 5, dialogMessages: 40 };
const FORGET_BELOW = 0.12;
const DAY = 86_400_000;
export const SLEEP_EVERY = 20 * 3_600_000;
export const validDialogId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9-]{8,64}$/.test(value);
// A message is recognised together with the one before it, so two identical short replies do not collide.
export const fingerprint = (messages: ChatMessage[], index = messages.length - 1) => createHash('sha256').update(messages.slice(Math.max(0, index - 1), index + 1).map(m => m.role + '\n' + m.content).join('\n\n')).digest('hex').slice(0, 16);
// Drops the messages up to and including the last one already reflected on.
export function unseen(messages: ChatMessage[], last?: string) {
  if (!last) return messages;
  const index = messages.map((_, i) => fingerprint(messages, i)).lastIndexOf(last);
  return index < 0 ? messages : messages.slice(index + 1);
}
const newId = () => randomUUID().replaceAll('-', '').slice(0, 12);
const clip = (value: unknown, max = LIMITS.text) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const iso = (value: unknown, fallback: string) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : fallback;
const unit = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : fallback;
const ids = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string' && /^[\w-]{1,100}$/.test(v)))].slice(0, 20) : [];
const day = (date: string) => new Date(date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

export const emptyMemory = (): Memory => ({ version: 1, settings: { enabled: true, private: false }, items: [], episodes: [], journal: [], lastSleep: null, dialogs: [], marks: [] });
// Keeps every valid record of a hand-edited or older file instead of rejecting it whole.
export function normalizeMemory(raw: any, now = new Date().toISOString()): Memory {
  if (!raw || typeof raw !== 'object' || raw.version !== 1) throw new Error('Неверный формат памяти');
  const memory = emptyMemory();
  memory.settings = { enabled: raw.settings?.enabled !== false, private: raw.settings?.private === true };
  const seen = new Set<string>();
  const fresh = (id: unknown) => typeof id === 'string' && /^[\w-]{1,100}$/.test(id) && !seen.has(id) && !!seen.add(id);
  for (const item of Array.isArray(raw.items) ? raw.items : []) {
    const text = clip(item?.text);
    if (!text || !fresh(item.id) || (item.kind !== 'fact' && item.kind !== 'rule')) continue;
    memory.items.push({ id: item.id, kind: item.kind, text, weight: unit(item.weight, 0.5), hits: Number.isSafeInteger(item.hits) && item.hits > 0 ? item.hits : 1, created: iso(item.created, now), seen: iso(item.seen, now), pinned: item.pinned === true, source: ['user', 'dialog', 'sleep'].includes(item.source) ? item.source : 'dialog', links: ids(item.links) });
  }
  for (const e of Array.isArray(raw.episodes) ? raw.episodes : []) {
    const topic = clip(e?.topic, 200);
    if (!topic || !fresh(e.id)) continue;
    memory.episodes.push({ id: e.id, date: iso(e.date, now), topic, outcome: clip(e.outcome, 600), links: ids(e.links), consolidated: e.consolidated === true });
  }
  for (const j of Array.isArray(raw.journal) ? raw.journal : []) if (clip(j?.text)) memory.journal.push({ at: iso(j.at, now), kind: j.kind, text: clip(j.text) });
  for (const d of Array.isArray(raw.dialogs) ? raw.dialogs : []) {
    if (!validDialogId(d?.id) || !Array.isArray(d.messages)) continue;
    const messages = d.messages.filter((m: ChatMessage) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string').map((m: ChatMessage) => ({ role: m.role, content: m.content.slice(0, 20_000) })).slice(-LIMITS.dialogMessages);
    if (messages.length) memory.dialogs.push({ id: d.id, messages, summary: clip(d.summary, 6000), updatedAt: iso(d.updatedAt, now), failures: Number.isSafeInteger(d.failures) ? d.failures : 0 });
  }
  for (const m of Array.isArray(raw.marks) ? raw.marks : []) if (validDialogId(m?.id) && typeof m.last === 'string') memory.marks.push({ id: m.id, last: m.last.slice(0, 40) });
  memory.marks = memory.marks.slice(-20);
  memory.items = memory.items.slice(-LIMITS.items); memory.episodes = memory.episodes.slice(-LIMITS.episodes);
  memory.journal = memory.journal.slice(-LIMITS.journal); memory.dialogs = memory.dialogs.slice(-LIMITS.dialogs);
  memory.lastSleep = typeof raw.lastSleep === 'string' && Number.isFinite(Date.parse(raw.lastSleep)) ? raw.lastSleep : null;
  return memory;
}

const STOP = new Set('это что как так для его она они оно мне меня мой моя мои тебя тебе твой ваш вас вам уже ещё еще или если когда где там тут вот был была было были быть есть нет нам наш все всё the and you про при над под без более очень просто тоже чтобы потом сейчас надо можно нужно хочу'.split(' '));
// Crude Russian stemming: the first five letters are enough to match «задачи» with «задач».
export function tokens(text: string) {
  const words = text.toLocaleLowerCase('ru').replaceAll('ё', 'е').match(/[\p{L}\p{N}]+/gu) || [];
  return new Set(words.filter(w => w.length >= 3 && !STOP.has(w)).map(w => w.slice(0, 5)));
}
const overlap = (a: Set<string>, b: Set<string>) => { let n = 0; for (const t of a) if (b.has(t)) n++; return n; };
export function similarity(a: string, b: string) {
  const x = tokens(a), y = tokens(b);
  if (!x.size || !y.size) return a.trim().toLocaleLowerCase('ru') === b.trim().toLocaleLowerCase('ru') ? 1 : 0;
  const shared = overlap(x, y);
  return shared / (x.size + y.size - shared);
}
// Weight fades with a half-life that grows with every confirmation; pinned records never fade.
export function strength(item: MemoryItem, now = Date.now()) {
  if (item.pinned) return 1;
  const age = Math.max(0, now - Date.parse(item.seen)) / DAY;
  const halfLife = (item.kind === 'rule' ? 60 : 30) * (1 + Math.min(item.hits - 1, 6));
  return item.weight * 0.5 ** (age / halfLife);
}
export function journal(memory: Memory, kind: JournalKind, text: string, at = new Date().toISOString()) {
  memory.journal.push({ at, kind, text: clip(text) });
  if (memory.journal.length > LIMITS.journal) memory.journal = memory.journal.slice(-LIMITS.journal);
}
const reinforce = (item: MemoryItem, now: string, step = 0.35) => { item.hits++; item.weight = Math.min(1, item.weight + (1 - item.weight) * step); item.seen = now; };
// Adds a fact or rule, or strengthens the one that already says the same thing.
export function upsert(memory: Memory, kind: MemoryKind, text: string, options: { weight?: number; links?: string[]; source?: MemoryItem['source']; pinned?: boolean; same?: string; now?: string } = {}) {
  const now = options.now || new Date().toISOString();
  const value = clip(text);
  if (!value) return null;
  const same = memory.items.find(i => i.id === options.same && i.kind === kind)
    || memory.items.filter(i => i.kind === kind).map(i => [i, similarity(i.text, value)] as const).filter(([, s]) => s >= 0.6).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (same) {
    reinforce(same, now);
    if (options.pinned) same.pinned = true;
    if (options.links) same.links = [...new Set([...same.links, ...options.links])].slice(0, 20);
    journal(memory, 'reinforced', `Подтвердилось: ${same.text}`, now);
    return { item: same, created: false };
  }
  if (memory.items.length >= LIMITS.items) {
    const weakest = memory.items.filter(i => !i.pinned).sort((a, b) => strength(a) - strength(b))[0];
    if (!weakest) return null;
    memory.items = memory.items.filter(i => i !== weakest);
  }
  const item: MemoryItem = { id: newId(), kind, text: value, weight: options.pinned ? 1 : options.weight ?? 0.5, hits: 1, created: now, seen: now, pinned: !!options.pinned, source: options.source || 'dialog', links: (options.links || []).slice(0, 20) };
  memory.items.push(item);
  journal(memory, kind === 'rule' ? 'rule' : 'learned', `${kind === 'rule' ? 'Новое правило' : 'Узнала'}: ${value}`, now);
  return { item, created: true };
}
const weaken = (memory: Memory, item: MemoryItem, now: string, factor = 0.5) => { item.weight *= factor; item.pinned = false; journal(memory, 'weakened', `Сомневаюсь: ${item.text}`, now); };
// Drops what has faded and keeps the stores within their limits.
export function decay(memory: Memory, now = Date.now()) {
  const at = new Date(now).toISOString();
  for (const item of memory.items.filter(i => strength(i, now) < FORGET_BELOW)) journal(memory, 'forgot', `Забыла: ${item.text}`, at);
  const kept = new Set(memory.items.filter(i => strength(i, now) >= FORGET_BELOW).map(i => i.id));
  memory.items = memory.items.filter(i => kept.has(i.id));
  memory.episodes = memory.episodes.slice(-LIMITS.episodes);
  return memory;
}
function relink(memory: Memory, from: string[], to: string) {
  for (const record of [...memory.items, ...memory.episodes]) if (record.links.some(id => from.includes(id))) record.links = [...new Set(record.links.map(id => from.includes(id) ? to : id))].filter(id => id !== record.id);
}

// «Запомни …» and «забудь …» work directly from the chat.
const COMMAND = /^\s*(?:миюнэя[\s,!.]*)?(?:пожалуйста[\s,]*)?(запомни|забудь)(?:[\s,]+пожалуйста)?[\s,:—-]*(?:(?:о том,? что|что|про|об|о)\s+)?([\s\S]{2,400}?)[\s.!]*$/i;
const RULE_START = /^(всегда|никогда|не\s|пиши|отвечай|называй|обращайся|используй|говори|делай|формулируй|присылай|напоминай|предлагай|добавляй|задачи\s|ответы\s)/i;
export function parseCommand(text: string): { kind: 'remember' | 'forget'; text: string } | null {
  const match = COMMAND.exec(text);
  if (!match) return null;
  const value = match[2].trim();
  return value ? { kind: match[1].toLocaleLowerCase('ru') === 'запомни' ? 'remember' : 'forget', text: value } : null;
}
export const commandKind = (text: string): MemoryKind => RULE_START.test(text.trim()) ? 'rule' : 'fact';
export function forget(memory: Memory, text: string, now = new Date().toISOString()) {
  const query = tokens(text);
  if (!query.size) return [];
  const matches = (value: string) => overlap(query, tokens(value)) / query.size >= 0.6;
  const removed = [...memory.items.filter(i => matches(i.text)).map(i => i.text), ...memory.episodes.filter(e => matches(e.topic + ' ' + e.outcome)).map(e => e.topic)];
  memory.items = memory.items.filter(i => !matches(i.text));
  memory.episodes = memory.episodes.filter(e => !matches(e.topic + ' ' + e.outcome));
  for (const value of removed) journal(memory, 'forgot', `Забыла по просьбе: ${value}`, now);
  return removed;
}

// What the assistant recalls before an answer: every strong rule, plus facts and episodes that match the topic.
export function memoryContext(memory: Memory, query: string, titles: Titles = new Map(), now = Date.now()) {
  if (!memory.settings.enabled) return '';
  const q = tokens(query);
  const live = memory.items.map(item => ({ item, power: strength(item, now) })).filter(x => x.power >= FORGET_BELOW);
  const rules = live.filter(x => x.item.kind === 'rule').sort((a, b) => b.power - a.power);
  const relevance = (text: string) => { const t = tokens(text); return t.size ? overlap(q, t) / Math.sqrt(t.size) : 0; };
  const facts = live.filter(x => x.item.kind === 'fact').map(x => ({ ...x, score: x.power * (0.35 + relevance(x.item.text)) })).sort((a, b) => b.score - a.score);
  const recent = memory.episodes.slice(-3).map(e => e.id);
  const episodes = memory.episodes.map(e => ({ e, score: relevance(e.topic + ' ' + e.outcome) + (recent.includes(e.id) ? 0.3 : 0) })).filter(x => x.score > 0.25).sort((a, b) => b.score - a.score).slice(0, 4);
  const byId = new Map<string, string>([...memory.items.map(i => [i.id, i.text] as [string, string]), ...memory.episodes.map(e => [e.id, `разговор ${day(e.date)}`] as [string, string])]);
  const linked = (links: string[]) => {
    const names = links.map(id => titles.has(id) ? `${titles.get(id)!.kind === 'task' ? 'задача' : 'заметка'} «${titles.get(id)!.title}»` : byId.get(id)).filter(Boolean).slice(0, 4);
    return names.length ? ` (связано: ${names.join('; ')})` : '';
  };
  const lines: string[] = [];
  let budget = 5000;
  const add = (line: string) => { if (line.length > budget) return false; lines.push(line); budget -= line.length + 1; return true; };
  if (rules.length) { add('Как пользователь любит, чтобы ты отвечала и действовала (соблюдай всегда):'); for (const { item } of rules.slice(0, 25)) if (!add('- ' + item.text)) break; }
  const chosen = facts.slice(0, 14);
  if (chosen.length) { add('\nЧто ты знаешь о пользователе (используй к месту, не перечисляй без просьбы):'); for (const { item } of chosen) if (!add('- ' + item.text + linked(item.links))) break; }
  if (episodes.length) { add('\nПрошлые разговоры по теме:'); for (const { e } of episodes) add(`- ${day(e.date)}: ${e.topic}${e.outcome ? ' — ' + e.outcome : ''}${linked(e.links)}`); }
  return lines.length ? 'Твоя долговременная память.\n' + lines.join('\n') : '';
}

// The model answers memory tasks with JSON; tolerate code fences and text around it.
export function parseJson(text: string): any {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}
const list = (value: unknown) => Array.isArray(value) ? value.filter(v => v && typeof v === 'object').slice(0, 30) : [];

export const REFLECT_PROMPT = `Ты модуль памяти помощницы Миюнэи. Разбери законченный разговор и верни только JSON без пояснений:
{"episode":{"topic":"тема в 3–8 словах","outcome":"итог или решение одним предложением","links":["id"]},
"facts":[{"text":"факт о пользователе","same":"id такого же известного факта","conflicts":"id факта, который это опровергает","links":["id"]}],
"rules":[{"text":"как пользователь хочет, чтобы ты отвечала или действовала","same":"id","conflicts":"id"}],
"confirm":["id фактов и правил, которые разговор подтвердил"],
"weaken":["id фактов и правил, которые оказались неверными"]}
Факты: только устойчивое и полезное в будущем — кто пользователь, его предпочтения, привычки, планы, важные обстоятельства. Пиши в третьем лице, коротко, по-русски. Не записывай содержимое заметок, разовые просьбы и общие знания.
Правила: явные просьбы о стиле и порядке работы. Обязательно сделай рефлексию: оцени свои ответы. Если пользователь тебя поправил, переспросил, попросил короче, иначе или по-другому, сформулируй из этого правило.
links — id заметок, задач, фактов и правил из списков ниже, к которым относится запись. Поля same, conflicts и links можно опускать. Если тема пустая (только приветствие), episode равен null. Если запоминать нечего, верни пустые массивы.`;

export const SLEEP_PROMPT = `Ты модуль памяти помощницы Миюнэи. Сейчас «сон»: перечитай новые эпизоды и наведи порядок в памяти. Верни только JSON без пояснений:
{"merge":[{"ids":["id","id"],"text":"объединённая формулировка"}],
"remove":[{"id":"id","reason":"дубль, устарело или противоречит"}],
"update":[{"id":"id","text":"уточнённая формулировка"}],
"rules":[{"text":"правило","episodes":["id","id"]}],
"insights":[{"text":"вывод о пользователе","episodes":["id","id"]}],
"summary":"одно-два предложения о том, что изменилось"}
1. Объедини похожие факты и похожие правила (только одного вида).
2. Убери дубли, устаревшее и то, что противоречит более свежим записям.
3. Если просьба или поведение повторяются в нескольких эпизодах, сделай из этого правило. Пример: три раза просили короткие задачи → правило «Задачи формулировать коротко».
4. Из повторяющихся эпизодов сделай выводы о пользователе (insights) со ссылками на эпизоды.
Записи с пометкой «закреплено» не удаляй и не переписывай. Ничего не выдумывай. Если менять нечего, верни пустые массивы.`;

export const COMPACT_PROMPT = 'Ты сжимаешь начало разговора пользователя с помощницей Миюнэей, чтобы она не теряла нить. Напиши краткое резюме по-русски до 1200 знаков: о чём говорили, что решили, какие просьбы и договорённости остались в силе, открытые вопросы. Только резюме, без вступлений.';

const itemLine = (i: MemoryItem) => `[${i.id}] ${i.text}${i.pinned ? ' (закреплено)' : ''}`;
export function transcript(messages: ChatMessage[], budget = 14_000) {
  const lines: string[] = [];
  for (const m of [...messages].reverse()) {
    const line = `${m.role === 'user' ? 'Пользователь' : 'Миюнэя'}: ${m.content.length > 2000 ? m.content.slice(0, 2000) + '…' : m.content}`;
    if (line.length > budget) break;
    lines.unshift(line); budget -= line.length;
  }
  return lines.join('\n');
}
export function reflectInput(memory: Memory, dialog: Dialog, workspace: Workspace | null) {
  const facts = memory.items.filter(i => i.kind === 'fact').sort((a, b) => strength(b) - strength(a)).slice(0, 80);
  const rules = memory.items.filter(i => i.kind === 'rule').slice(0, 40);
  const entries = workspace ? [...workspace.notes.map(n => `[${n.id}] заметка: ${n.title}`), ...workspace.tasks.filter(t => !t.done).map(t => `[${t.id}] задача: ${t.title}`)].slice(-100) : [];
  return [`Известные факты:\n${facts.map(itemLine).join('\n') || '— нет'}`, `Правила:\n${rules.map(itemLine).join('\n') || '— нет'}`,
    `Заметки и задачи:\n${entries.join('\n') || '— нет доступа или пусто'}`,
    `Разговор ${day(dialog.updatedAt)}:\n${dialog.summary ? 'Начало (кратко): ' + dialog.summary + '\n' : ''}${transcript(dialog.messages)}`].join('\n\n');
}
export function sleepInput(memory: Memory, now = Date.now()) {
  const fresh = memory.episodes.filter(e => !e.consolidated);
  const older = memory.episodes.filter(e => e.consolidated).slice(-30);
  const episode = (e: Episode) => `[${e.id}] ${day(e.date)}: ${e.topic}${e.outcome ? ' — ' + e.outcome : ''}`;
  const item = (i: MemoryItem) => `${itemLine(i)} · сила ${strength(i, now).toFixed(2)}, подтверждений ${i.hits}`;
  return [`Факты:\n${memory.items.filter(i => i.kind === 'fact').map(item).join('\n') || '— нет'}`, `Правила:\n${memory.items.filter(i => i.kind === 'rule').map(item).join('\n') || '— нет'}`,
    `Новые эпизоды:\n${fresh.map(episode).join('\n') || '— нет'}`, `Более ранние эпизоды:\n${older.map(episode).join('\n') || '— нет'}`].join('\n\n').slice(0, 60_000);
}

// Applies the post-dialog reflection: an episode, new or confirmed facts and rules, and weakened mistakes.
export function applyReflection(memory: Memory, result: any, dialog: Dialog, known: Set<string>, now = new Date().toISOString()) {
  if (!result || typeof result !== 'object') return 0;
  const valid = (links: unknown) => ids(links).filter(id => known.has(id) || memory.items.some(i => i.id === id));
  const item = (id: unknown) => memory.items.find(i => i.id === id);
  let changes = 0;
  let episode: Episode | null = null;
  const topic = clip(result.episode?.topic, 200);
  if (topic) {
    episode = { id: newId(), date: dialog.updatedAt, topic, outcome: clip(result.episode.outcome, 600), links: valid(result.episode.links), consolidated: false };
    memory.episodes.push(episode); changes++;
    journal(memory, 'episode', `Разговор: ${topic}`, now);
  }
  for (const kind of ['fact', 'rule'] as const) for (const entry of list(kind === 'fact' ? result.facts : result.rules)) {
    const old = item(entry.conflicts);
    if (old && old.kind === kind) weaken(memory, old, now, 0.4);
    const added = upsert(memory, kind, entry.text, { same: typeof entry.same === 'string' ? entry.same : undefined, links: [...valid(entry.links), ...(episode ? [episode.id] : [])], weight: kind === 'rule' ? 0.6 : 0.5, now });
    if (added) changes++;
  }
  for (const id of ids(result.confirm)) { const found = item(id); if (found) { reinforce(found, now, 0.2); changes++; } }
  for (const id of ids(result.weaken)) { const found = item(id); if (found) { weaken(memory, found, now, 0.6); changes++; } }
  memory.episodes = memory.episodes.slice(-LIMITS.episodes);
  return changes;
}

// Applies the nightly consolidation and then lets weak records fade.
export function applySleep(memory: Memory, result: any, now = Date.now()) {
  const at = new Date(now).toISOString();
  const episodes = new Set(memory.episodes.map(e => e.id));
  const find = (id: unknown) => memory.items.find(i => i.id === id);
  if (result && typeof result === 'object') {
    for (const merge of list(result.merge)) {
      const group = ids(merge.ids).map(find).filter((i): i is MemoryItem => !!i);
      const text = clip(merge.text);
      if (group.length < 2 || !text || group.some(i => i.kind !== group[0].kind)) continue;
      const merged: MemoryItem = { id: newId(), kind: group[0].kind, text, weight: Math.min(1, Math.max(...group.map(i => i.weight)) + 0.1), hits: group.reduce((n, i) => n + i.hits, 0),
        created: group.map(i => i.created).sort()[0], seen: at, pinned: group.some(i => i.pinned), source: 'sleep', links: [...new Set(group.flatMap(i => i.links))].slice(0, 20) };
      memory.items = [...memory.items.filter(i => !group.includes(i)), merged];
      relink(memory, group.map(i => i.id), merged.id);
      journal(memory, 'merged', `Объединила ${group.length}: ${text}`, at);
    }
    for (const entry of list(result.update)) {
      const found = find(entry.id); const text = clip(entry.text);
      if (found && !found.pinned && text && text !== found.text) { journal(memory, 'edited', `Уточнила: ${found.text} → ${text}`, at); found.text = text; }
    }
    for (const entry of list(result.remove)) {
      const found = find(entry.id);
      if (!found || found.pinned) continue;
      memory.items = memory.items.filter(i => i !== found);
      journal(memory, 'forgot', `Убрала: ${found.text}${clip(entry.reason, 80) ? ' (' + clip(entry.reason, 80) + ')' : ''}`, at);
    }
    for (const kind of ['rule', 'fact'] as const) for (const entry of list(kind === 'rule' ? result.rules : result.insights)) {
      const from = ids(entry.episodes).filter(id => episodes.has(id));
      if (from.length < 2) continue;
      upsert(memory, kind, entry.text, { links: from, source: 'sleep', weight: Math.min(0.9, 0.45 + 0.1 * from.length), now: at });
    }
  }
  for (const e of memory.episodes) e.consolidated = true;
  memory.lastSleep = at;
  decay(memory, now);
  journal(memory, 'sleep', 'Сон: ' + (clip(result?.summary, 300) || 'память упорядочена'), at);
  return memory;
}

type Options = { ask(system: string, user: string, timeout?: number): Promise<string>; available(): boolean; workspace(): Workspace | null; idleMs?: number; tickMs?: number };
// Loads data/memory.json and runs the background work: reflection after a dialog goes quiet and a daily sleep when idle.
export async function openMemory(dataDir: string, options: Options) {
  const file = join(dataDir, 'memory.json');
  const idleMs = options.idleMs ?? 10 * 60_000;
  let memory = emptyMemory();
  try { memory = normalizeMemory(JSON.parse(await readFile(file, 'utf8'))); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Keep the unreadable file for the user instead of overwriting it.
      await rename(file, join(dataDir, `memory.broken-${Date.now()}.json`)).catch(() => {});
      console.error('Память помощницы не прочитана: data/memory.json сохранён как memory.broken-*.json, начата новая.');
    }
  }
  let writing = Promise.resolve();
  const save = () => { const next = writing.then(() => atomicWrite(file, JSON.stringify(memory, null, 2))); writing = next.catch(() => {}); return next; };
  let lastActivity = 0;
  let job: { kind: 'reflect' | 'sleep'; done: Promise<unknown> } | null = null;
  let retrySleepAt = 0;
  let closed = false;

  const titles = (): Titles => {
    const data = options.workspace();
    return new Map(data ? [...data.notes.map(n => [n.id, { kind: 'note', title: n.title }] as const), ...data.tasks.map(t => [t.id, { kind: 'task', title: t.title }] as const)] : []);
  };
  function run<T>(kind: 'reflect' | 'sleep', work: () => Promise<T>): Promise<T> {
    if (job) return job.done.catch(() => {}).then(() => run(kind, work));
    const done = work().finally(() => { if (job?.done === done) job = null; });
    job = { kind, done };
    return done;
  }
  async function reflect(id: string) {
    const dialog = memory.dialogs.find(d => d.id === id);
    if (!dialog) return 0;
    const users = dialog.messages.filter(m => m.role === 'user');
    if (!users.length || users.reduce((n, m) => n + m.content.length, 0) < 12) { memory.dialogs = memory.dialogs.filter(d => d !== dialog); await save(); return 0; }
    const snapshot = { ...dialog, messages: [...dialog.messages] };
    let result;
    try { result = parseJson(await options.ask(REFLECT_PROMPT, reflectInput(memory, snapshot, options.workspace()))); }
    catch (e) {
      dialog.failures++;
      if (dialog.failures >= 3) memory.dialogs = memory.dialogs.filter(d => d !== dialog);
      await save(); throw e;
    }
    const known = new Set([...titles().keys(), ...memory.episodes.map(e => e.id)]);
    const changes = applyReflection(memory, result, snapshot, known);
    const last = fingerprint(snapshot.messages);
    memory.marks = [...memory.marks.filter(m => m.id !== id), { id, last }].slice(-20);
    // Messages that arrived while the model was thinking stay for the next reflection.
    const current = memory.dialogs.find(d => d.id === id);
    const rest = current && current.updatedAt !== snapshot.updatedAt ? unseen(current.messages, last) : [];
    if (current && rest.length) current.messages = rest;
    else memory.dialogs = memory.dialogs.filter(d => d.id !== id);
    await save();
    return changes;
  }
  async function sleep() {
    const now = Date.now();
    let result = null;
    if (memory.items.length || memory.episodes.some(e => !e.consolidated)) {
      try { result = parseJson(await options.ask(SLEEP_PROMPT, sleepInput(memory, now), 180_000)); }
      catch (e) { retrySleepAt = Date.now() + 3_600_000; throw e; }
    }
    applySleep(memory, result, Date.now());
    await save();
    return result;
  }
  async function tick(now = Date.now()) {
    if (closed || job || !options.available() || !memory.settings.enabled) return;
    const quiet = memory.dialogs.find(d => now - Date.parse(d.updatedAt) >= idleMs);
    try {
      if (quiet) return void await run('reflect', () => reflect(quiet.id));
      const due = !memory.lastSleep || now - Date.parse(memory.lastSleep) >= SLEEP_EVERY;
      if (now - lastActivity >= idleMs && due && now >= retrySleepAt && memory.episodes.some(e => !e.consolidated)) await run('sleep', sleep);
    } catch (e) { console.error('Фоновая работа памяти не выполнена:', (e as Error).message); }
  }
  const timer = setInterval(() => void tick(), options.tickMs ?? 60_000);
  timer.unref();

  const view = (now = Date.now()) => ({
    enabled: memory.settings.enabled, private: memory.settings.private, available: options.available(), busy: job?.kind ?? null, lastSleep: memory.lastSleep,
    pending: memory.dialogs.length, newEpisodes: memory.episodes.filter(e => !e.consolidated).length,
    items: memory.items.map(i => ({ ...i, strength: Math.round(strength(i, now) * 100) / 100 })).sort((a, b) => b.strength - a.strength),
    episodes: [...memory.episodes].reverse(), journal: [...memory.journal].reverse(),
  });
  return {
    view, tick, save,
    get data() { return memory; },
    get recording() { return memory.settings.enabled && !memory.settings.private; },
    context: (query: string) => memoryContext(memory, query, titles()),
    touch() { lastActivity = Date.now(); },
    // Keeps the latest turns of a dialog until it goes quiet and can be reflected on.
    record(id: string, messages: ChatMessage[], summary: string) {
      lastActivity = Date.now();
      if (!memory.settings.enabled || memory.settings.private) return save();
      const existing = memory.dialogs.find(d => d.id === id);
      const fresh = unseen(messages, memory.marks.find(m => m.id === id)?.last);
      if (!fresh.length) return save();
      const dialog: Dialog = { id, messages: fresh.slice(-LIMITS.dialogMessages), summary: clip(summary, 6000), updatedAt: new Date().toISOString(), failures: existing?.failures ?? 0 };
      memory.dialogs = [...memory.dialogs.filter(d => d.id !== id), dialog].slice(-LIMITS.dialogs);
      return save();
    },
    async remember(text: string) { const added = upsert(memory, commandKind(text), text, { source: 'user', pinned: true }); await save(); return added?.item ?? null; },
    async forget(text: string) { const removed = forget(memory, text); if (removed.length) await save(); return removed; },
    async settings(change: { enabled?: boolean; private?: boolean }) {
      memory.settings = { ...memory.settings, ...change };
      if (memory.settings.private || !memory.settings.enabled) memory.dialogs = [];
      await save();
    },
    async add(kind: MemoryKind, text: string) { const added = upsert(memory, kind, text, { source: 'user', pinned: true }); await save(); return added?.item ?? null; },
    async edit(id: string, change: { text?: string; pinned?: boolean; topic?: string; outcome?: string }) {
      const item = memory.items.find(i => i.id === id);
      const episode = memory.episodes.find(e => e.id === id);
      if (!item && !episode) return false;
      const at = new Date().toISOString();
      if (item) {
        if (change.text !== undefined && clip(change.text) && clip(change.text) !== item.text) { journal(memory, 'edited', `Исправлено вами: ${item.text} → ${clip(change.text)}`, at); item.text = clip(change.text); item.seen = at; item.source = 'user'; }
        if (change.pinned !== undefined) { item.pinned = change.pinned; if (change.pinned) item.weight = 1; item.seen = at; }
      }
      if (episode) {
        if (change.topic !== undefined && clip(change.topic, 200)) episode.topic = clip(change.topic, 200);
        if (change.outcome !== undefined) episode.outcome = clip(change.outcome, 600);
      }
      await save(); return true;
    },
    async remove(id: string) {
      const before = memory.items.length + memory.episodes.length;
      memory.items = memory.items.filter(i => i.id !== id);
      memory.episodes = memory.episodes.filter(e => e.id !== id);
      for (const record of [...memory.items, ...memory.episodes]) record.links = record.links.filter(link => link !== id);
      if (before === memory.items.length + memory.episodes.length) return false;
      await save(); return true;
    },
    async reset() { memory = { ...emptyMemory(), settings: memory.settings }; retrySleepAt = 0; await save(); },
    close: (id: string) => memory.dialogs.some(d => d.id === id) ? run('reflect', () => reflect(id)) : Promise.resolve(0),
    sleepNow: () => run('sleep', sleep),
    exportData: () => ({ ...memory, dialogs: undefined, marks: undefined, exportedAt: new Date().toISOString() }),
    async shutdown() { closed = true; clearInterval(timer); await job?.done.catch(() => {}); await writing; },
  };
}
