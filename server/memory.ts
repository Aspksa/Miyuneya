import { readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { atomicWrite } from '../scripts/runtime.mjs';
import type { Workspace } from '../src/model.ts';
import { tokens, overlap, similarity, strength, expired, memoryContext, searchTexts, FORGET_BELOW, entityNames, relationNames, categoryNames } from './recall.ts';
import type { Titles } from './recall.ts';
import { growth } from './growth.ts';
export { tokens, similarity, strength, memoryContext } from './recall.ts';

// Long-term memory of the assistant, kept in data/memory.json next to the workspace.
// Facts (semantic) and rules (procedural) carry a weight that confirmations raise and time lowers;
// episodes record finished dialogs; entities and typed edges form the knowledge graph;
// the journal shows what was learned, merged and forgotten, and the diary is written by the assistant herself.
// Facts roll up into topics and topics into one understanding of the user; open questions cover gaps and contradictions.
export type MemoryKind = 'fact' | 'rule';
export type Category = 'personal' | 'work' | 'health' | 'plans' | 'tastes' | 'people' | 'other';
export type MemoryItem = { id: string; kind: MemoryKind; text: string; weight: number; hits: number; created: string; seen: string; pinned: boolean; source: 'user' | 'dialog' | 'sleep' | 'note' | 'review'; links: string[]; category: Category; until: string | null };
// score and weak are the assistant's own review of her answers in that dialog.
export type Episode = { id: string; date: string; topic: string; outcome: string; links: string[]; consolidated: boolean; score: number | null; weak: string };
export type Topic = { id: string; title: string; area: Category; summary: string; facts: string[]; created: string; updated: string };
export type Question = { id: string; kind: 'gap' | 'conflict'; text: string; entity: string | null; facts: string[]; created: string; asked: number; lastAsked: string | null };
export type EntityType = 'person' | 'project' | 'place' | 'topic' | 'thing';
export type Entity = { id: string; name: string; type: EntityType; about: string; aliases: string[]; created: string; seen: string };
export type RelationType = 'related' | 'part_of' | 'blocks' | 'after' | 'decided_in' | 'about';
export type Edge = { from: string; to: string; type: RelationType; created: string };
export type DiaryEntry = { id: string; date: string; text: string };
export type JournalKind = 'learned' | 'rule' | 'reinforced' | 'weakened' | 'merged' | 'forgot' | 'episode' | 'sleep' | 'edited' | 'entity' | 'review' | 'topic' | 'question';
export type JournalEntry = { at: string; kind: JournalKind; text: string };
export type ChatMessage = { role: 'user' | 'assistant'; content: string };
export type Dialog = { id: string; messages: ChatMessage[]; summary: string; updatedAt: string; failures: number; signals: string[] };
export type Memory = { version: 1; settings: { enabled: boolean; private: boolean }; items: MemoryItem[]; episodes: Episode[]; entities: Entity[]; edges: Edge[]; diary: DiaryEntry[];
  topics: Topic[]; understanding: { text: string; updated: string } | null; questions: Question[];
  journal: JournalEntry[]; lastSleep: string | null; notesSeen: string | null; dialogs: Dialog[]; marks: Mark[] };
// The last message already reflected on, so a dialog that continues later is not analysed twice.
type Mark = { id: string; last: string };

export const LIMITS = { items: 600, episodes: 400, entities: 300, edges: 1500, diary: 365, topics: 80, questions: 12, journal: 200, text: 400, dialogs: 5, dialogMessages: 40, signals: 20 };
export const CATEGORIES: Category[] = ['personal', 'work', 'health', 'plans', 'tastes', 'people', 'other'];
const ENTITY_TYPES = Object.keys(entityNames) as EntityType[];
const RELATIONS = Object.keys(relationNames) as RelationType[];
export const SLEEP_EVERY = 20 * 3_600_000;
export const validDialogId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9-]{8,64}$/.test(value);
export const validDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));
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
const ids = (value: unknown, max = 20) => Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string' && /^[\w-]{1,100}$/.test(v)))].slice(0, max) : [];
const score = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.min(5, Math.max(1, Math.round(value))) : null;
const category = (value: unknown): Category => CATEGORIES.includes(value as Category) ? value as Category : 'other';
const day = (date: string) => new Date(date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

export const emptyMemory = (): Memory => ({ version: 1, settings: { enabled: true, private: false }, items: [], episodes: [], entities: [], edges: [], diary: [], topics: [], understanding: null, questions: [], journal: [], lastSleep: null, notesSeen: null, dialogs: [], marks: [] });
// Keeps every valid record of a hand-edited or older file instead of rejecting it whole.
export function normalizeMemory(raw: any, now = new Date().toISOString()): Memory {
  if (!raw || typeof raw !== 'object' || raw.version !== 1) throw new Error('Неверный формат памяти');
  const memory = emptyMemory();
  const array = (value: unknown) => Array.isArray(value) ? value : [];
  memory.settings = { enabled: raw.settings?.enabled !== false, private: raw.settings?.private === true };
  const seen = new Set<string>();
  const fresh = (id: unknown) => typeof id === 'string' && /^[\w-]{1,100}$/.test(id) && !seen.has(id) && !!seen.add(id);
  for (const item of array(raw.items)) {
    const text = clip(item?.text);
    if (!text || !fresh(item.id) || (item.kind !== 'fact' && item.kind !== 'rule')) continue;
    memory.items.push({ id: item.id, kind: item.kind, text, weight: unit(item.weight, 0.5), hits: Number.isSafeInteger(item.hits) && item.hits > 0 ? item.hits : 1, created: iso(item.created, now), seen: iso(item.seen, now), pinned: item.pinned === true,
      source: ['user', 'dialog', 'sleep', 'note', 'review'].includes(item.source) ? item.source : 'dialog', links: ids(item.links), category: category(item.category), until: validDate(item.until) ? item.until : null });
  }
  for (const e of array(raw.episodes)) {
    const topic = clip(e?.topic, 200);
    if (topic && fresh(e.id)) memory.episodes.push({ id: e.id, date: iso(e.date, now), topic, outcome: clip(e.outcome, 600), links: ids(e.links), consolidated: e.consolidated === true, score: score(e.score), weak: clip(e.weak, 300) });
  }
  for (const e of array(raw.entities)) {
    const name = clip(e?.name, 80);
    if (name && fresh(e.id)) memory.entities.push({ id: e.id, name, type: ENTITY_TYPES.includes(e.type) ? e.type : 'topic', about: clip(e.about, 300), aliases: array(e.aliases).map(a => clip(a, 80)).filter(Boolean).slice(0, 5), created: iso(e.created, now), seen: iso(e.seen, now) });
  }
  for (const e of array(raw.edges)) if (typeof e?.from === 'string' && typeof e.to === 'string' && e.from !== e.to && RELATIONS.includes(e.type)) memory.edges.push({ from: e.from.slice(0, 100), to: e.to.slice(0, 100), type: e.type, created: iso(e.created, now) });
  for (const d of array(raw.diary)) { const text = clip(d?.text, 2000); if (text && fresh(d.id)) memory.diary.push({ id: d.id, date: iso(d.date, now), text }); }
  for (const t of array(raw.topics)) { const title = clip(t?.title, 80); if (title && fresh(t.id)) memory.topics.push({ id: t.id, title, area: category(t.area), summary: clip(t.summary, 600), facts: ids(t.facts, 60), created: iso(t.created, now), updated: iso(t.updated, now) }); }
  if (clip(raw.understanding?.text, 1500)) memory.understanding = { text: clip(raw.understanding.text, 1500), updated: iso(raw.understanding.updated, now) };
  for (const q of array(raw.questions)) {
    const text = clip(q?.text, 300);
    if (text && fresh(q.id)) memory.questions.push({ id: q.id, kind: q.kind === 'conflict' ? 'conflict' : 'gap', text, entity: typeof q.entity === 'string' ? q.entity.slice(0, 100) : null, facts: ids(q.facts), created: iso(q.created, now), asked: Number.isSafeInteger(q.asked) && q.asked > 0 ? q.asked : 0, lastAsked: typeof q.lastAsked === 'string' && Number.isFinite(Date.parse(q.lastAsked)) ? q.lastAsked : null });
  }
  for (const j of array(raw.journal)) if (clip(j?.text)) memory.journal.push({ at: iso(j.at, now), kind: j.kind, text: clip(j.text) });
  for (const d of array(raw.dialogs)) {
    if (!validDialogId(d?.id) || !Array.isArray(d.messages)) continue;
    const messages = d.messages.filter((m: ChatMessage) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string').map((m: ChatMessage) => ({ role: m.role, content: m.content.slice(0, 20_000) })).slice(-LIMITS.dialogMessages);
    if (messages.length) memory.dialogs.push({ id: d.id, messages, summary: clip(d.summary, 6000), updatedAt: iso(d.updatedAt, now), failures: Number.isSafeInteger(d.failures) ? d.failures : 0, signals: array(d.signals).map(s => clip(s, 200)).filter(Boolean).slice(-LIMITS.signals) });
  }
  for (const m of array(raw.marks)) if (validDialogId(m?.id) && typeof m.last === 'string') memory.marks.push({ id: m.id, last: m.last.slice(0, 40) });
  memory.marks = memory.marks.slice(-20);
  memory.items = memory.items.slice(-LIMITS.items); memory.episodes = memory.episodes.slice(-LIMITS.episodes); memory.entities = memory.entities.slice(-LIMITS.entities);
  memory.edges = memory.edges.slice(-LIMITS.edges); memory.diary = memory.diary.slice(-LIMITS.diary); memory.topics = memory.topics.slice(-LIMITS.topics); memory.questions = memory.questions.slice(-LIMITS.questions);
  memory.journal = memory.journal.slice(-LIMITS.journal); memory.dialogs = memory.dialogs.slice(-LIMITS.dialogs);
  memory.lastSleep = typeof raw.lastSleep === 'string' && Number.isFinite(Date.parse(raw.lastSleep)) ? raw.lastSleep : null;
  memory.notesSeen = typeof raw.notesSeen === 'string' && Number.isFinite(Date.parse(raw.notesSeen)) ? raw.notesSeen : null;
  return memory;
}

export function journal(memory: Memory, kind: JournalKind, text: string, at = new Date().toISOString()) {
  memory.journal.push({ at, kind, text: clip(text) });
  if (memory.journal.length > LIMITS.journal) memory.journal = memory.journal.slice(-LIMITS.journal);
}
const reinforce = (item: MemoryItem, now: string, step = 0.35) => { item.hits++; item.weight = Math.min(1, item.weight + (1 - item.weight) * step); item.seen = now; };
type UpsertOptions = { weight?: number; links?: string[]; source?: MemoryItem['source']; pinned?: boolean; same?: string; now?: string; category?: unknown; until?: unknown };
// Adds a fact or rule, or strengthens the one that already says the same thing.
export function upsert(memory: Memory, kind: MemoryKind, text: string, options: UpsertOptions = {}) {
  const now = options.now || new Date().toISOString();
  const value = clip(text);
  if (!value) return null;
  const until = validDate(options.until) ? options.until : null;
  const same = memory.items.find(i => i.id === options.same && i.kind === kind)
    || memory.items.filter(i => i.kind === kind).map(i => [i, similarity(i.text, value)] as const).filter(([, s]) => s >= 0.6).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (same) {
    reinforce(same, now);
    if (options.pinned) same.pinned = true;
    if (options.links) same.links = [...new Set([...same.links, ...options.links])].slice(0, 20);
    if (until) same.until = until;
    if (same.category === 'other' && options.category) same.category = category(options.category);
    journal(memory, 'reinforced', `Подтвердилось: ${same.text}`, now);
    return { item: same, created: false };
  }
  if (memory.items.length >= LIMITS.items) {
    const weakest = memory.items.filter(i => !i.pinned).sort((a, b) => strength(a) - strength(b))[0];
    if (!weakest) return null;
    memory.items = memory.items.filter(i => i !== weakest);
  }
  const item: MemoryItem = { id: newId(), kind, text: value, weight: options.pinned ? 1 : options.weight ?? 0.5, hits: 1, created: now, seen: now, pinned: !!options.pinned,
    source: options.source || 'dialog', links: (options.links || []).slice(0, 20), category: kind === 'rule' ? 'other' : category(options.category), until };
  memory.items.push(item);
  journal(memory, kind === 'rule' ? 'rule' : 'learned', `${kind === 'rule' ? 'Новое правило' : 'Узнала'}: ${value}`, now);
  return { item, created: true };
}
const weaken = (memory: Memory, item: MemoryItem, now: string, factor = 0.5) => { item.weight *= factor; item.pinned = false; journal(memory, 'weakened', `Сомневаюсь: ${item.text}`, now); };
// People, projects, places and topics are nodes of their own; the same name never makes a second one.
export function upsertEntity(memory: Memory, name: unknown, type: unknown, about: unknown, now = new Date().toISOString()) {
  const value = clip(name, 80);
  if (!value) return null;
  const lower = value.toLocaleLowerCase('ru');
  const found = memory.entities.find(e => [e.name, ...e.aliases].some(n => n.toLocaleLowerCase('ru') === lower)) || memory.entities.find(e => similarity(e.name, value) >= 0.8);
  if (found) {
    found.seen = now;
    if (clip(about, 300)) found.about = clip(about, 300);
    if (found.name.toLocaleLowerCase('ru') !== lower && !found.aliases.some(a => a.toLocaleLowerCase('ru') === lower) && found.aliases.length < 5) found.aliases.push(value);
    return found;
  }
  if (memory.entities.length >= LIMITS.entities) memory.entities = memory.entities.slice(1);
  const entity: Entity = { id: newId(), name: value, type: ENTITY_TYPES.includes(type as EntityType) ? type as EntityType : 'topic', about: clip(about, 300), aliases: [], created: now, seen: now };
  memory.entities.push(entity);
  journal(memory, 'entity', `Новое в карте: ${value} (${entityNames[entity.type]})`, now);
  return entity;
}
export function addEdge(memory: Memory, from: string, to: string, type: unknown, now = new Date().toISOString()) {
  const kind: RelationType = RELATIONS.includes(type as RelationType) ? type as RelationType : 'related';
  if (!from || !to || from === to) return false;
  if (memory.edges.some(e => (e.from === from && e.to === to && e.type === kind) || (kind === 'related' && e.from === to && e.to === from))) return false;
  memory.edges.push({ from, to, type: kind, created: now });
  if (memory.edges.length > LIMITS.edges) memory.edges = memory.edges.slice(-LIMITS.edges);
  return true;
}
// Drops what has faded or run out of date, and keeps the stores within their limits.
export function decay(memory: Memory, now = Date.now()) {
  const at = new Date(now).toISOString();
  const gone = memory.items.filter(i => !i.pinned && (strength(i, now) < FORGET_BELOW || expired(i, now)));
  for (const item of gone) journal(memory, 'forgot', `${expired(item, now) ? 'Устарело' : 'Забыла'}: ${item.text}`, at);
  memory.items = memory.items.filter(i => !gone.includes(i));
  memory.episodes = memory.episodes.slice(-LIMITS.episodes);
  prune(memory);
  // An entity nothing points to and nobody mentioned for four months is let go.
  const used = new Set(memory.edges.flatMap(e => [e.from, e.to]));
  memory.entities = memory.entities.filter(e => used.has(e.id) || now - Date.parse(e.seen) < 120 * 86_400_000);
  prune(memory);
  return memory;
}
// Removes edges that point at records which no longer exist (notes and tasks live in the workspace and stay).
function prune(memory: Memory) {
  const own = new Set([...memory.items.map(i => i.id), ...memory.episodes.map(e => e.id), ...memory.entities.map(e => e.id)]);
  const mine = (id: string) => own.has(id) || !/^[0-9a-f]{12}$/.test(id);
  memory.edges = memory.edges.filter(e => mine(e.from) && mine(e.to));
  const facts = new Set(memory.items.filter(i => i.kind === 'fact').map(i => i.id));
  for (const topic of memory.topics) topic.facts = topic.facts.filter(id => facts.has(id));
  memory.topics = memory.topics.filter(t => t.facts.length || t.summary);
  memory.questions = memory.questions.filter(q => (!q.entity || own.has(q.entity)) && (q.kind !== 'conflict' || q.facts.filter(id => facts.has(id)).length >= 2));
}
function relink(memory: Memory, from: string[], to: string) {
  for (const record of [...memory.items, ...memory.episodes]) if (record.links.some(id => from.includes(id))) record.links = [...new Set(record.links.map(id => from.includes(id) ? to : id))].filter(id => id !== record.id);
  for (const edge of memory.edges) { if (from.includes(edge.from)) edge.from = to; if (from.includes(edge.to)) edge.to = to; }
  for (const record of [...memory.topics, ...memory.questions]) if (record.facts.some(id => from.includes(id))) record.facts = [...new Set(record.facts.map(id => from.includes(id) ? to : id))];
  memory.edges = memory.edges.filter((e, i, all) => e.from !== e.to && all.findIndex(x => x.from === e.from && x.to === e.to && x.type === e.type) === i);
}

// A question Miyuneya will ask the user: about something unknown, or which of two facts is true now.
export function ask(memory: Memory, kind: Question['kind'], text: unknown, extra: { entity?: string | null; facts?: string[] } = {}, now = new Date().toISOString()) {
  const value = clip(text, 300);
  if (!value || memory.questions.length >= LIMITS.questions) return null;
  if (memory.questions.some(q => similarity(q.text, value) >= 0.5 || (extra.entity && q.entity === extra.entity) || (kind === 'conflict' && q.kind === 'conflict' && extra.facts?.every(id => q.facts.includes(id))))) return null;
  const question: Question = { id: newId(), kind, text: value, entity: extra.entity ?? null, facts: extra.facts ?? [], created: now, asked: 0, lastAsked: null };
  memory.questions.push(question);
  journal(memory, 'question', `${kind === 'conflict' ? 'Хочу уточнить' : 'Хочу спросить'}: ${value}`, now);
  return question;
}
// Gaps the memory can see by itself: someone or something mentioned but never explained.
export function findGaps(memory: Memory, now = new Date().toISOString()) {
  for (const entity of memory.entities) {
    if (entity.about || memory.questions.length >= LIMITS.questions) continue;
    ask(memory, 'gap', `Вы упоминали «${entity.name}». ${entity.type === 'person' ? 'Кто это' : 'Что это'} для вас?`, { entity: entity.id }, now);
  }
}
// The user's answer settles the question: it becomes a fact, explains the entity, and outweighs contradicting facts.
export function answer(memory: Memory, id: string, text: unknown, now = new Date().toISOString(), source: MemoryItem['source'] = 'user') {
  const question = memory.questions.find(q => q.id === id);
  const value = clip(text);
  if (!question || !value) return null;
  const entity = memory.entities.find(e => e.id === question.entity);
  let fact = value;
  if (entity) { if (!entity.about) entity.about = clip(value, 300); entity.seen = now; fact = `${entity.name}: ${value}`; }
  const conflicting = memory.items.filter(i => question.facts.includes(i.id));
  // The fact the answer agrees with is confirmed by the upsert below; the others lose weight.
  for (const old of conflicting) if (!old.pinned && similarity(old.text, fact) < 0.6) weaken(memory, old, now, 0.3);
  const added = upsert(memory, 'fact', fact, { source, weight: source === 'user' ? 0.9 : 0.7, now, category: entity?.type === 'person' ? 'people' : conflicting[0]?.category, links: conflicting.flatMap(i => i.links).slice(0, 10) });
  if (added && entity) addEdge(memory, added.item.id, entity.id, 'about', now);
  memory.questions = memory.questions.filter(q => q !== question);
  journal(memory, 'question', `Узнала из ответа: ${fact}`, now);
  return added?.item ?? null;
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
  prune(memory);
  for (const value of removed) journal(memory, 'forgot', `Забыла по просьбе: ${value}`, now);
  return removed;
}

// The model answers memory tasks with JSON; tolerate code fences and text around it.
export function parseJson(text: string): any {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}
const list = (value: unknown) => Array.isArray(value) ? value.filter(v => v && typeof v === 'object').slice(0, 30) : [];

const SHAPES = `Категории фактов (category): personal — личное, work — работа и учёба, health — здоровье и самочувствие, plans — планы и цели, tastes — вкусы и предпочтения, people — люди вокруг, other — другое.
until — дата ГГГГ-ММ-ДД, после которой факт перестаёт быть верным (например, «уезжает до 15 ноября»); для постоянных фактов не указывай.
Сущности (entities) — люди, проекты, места, темы и вещи, о которых шла речь: type = person, project, place, topic или thing; about — кто или что это, одним предложением.
Связи (relations): from и to — id из списков ниже, имя сущности или слово episode (этот разговор); type = part_of (часть), blocks (мешает), after (после), decided_in (решено в), about (про), related (связано).`;

export const REFLECT_PROMPT = `Ты модуль памяти помощницы Миюнэи. Разбери законченный разговор и верни только JSON без пояснений:
{"episode":{"topic":"тема в 3–8 словах","outcome":"итог или решение одним предложением","links":["id"]},
"entities":[{"name":"имя","type":"person","about":"кто это"}],
"facts":[{"text":"факт о пользователе","category":"work","until":"ГГГГ-ММ-ДД","about":["имя сущности"],"same":"id такого же известного факта","conflicts":"id факта, который это опровергает","links":["id"]}],
"rules":[{"text":"как пользователь хочет, чтобы ты отвечала или действовала","same":"id","conflicts":"id"}],
"relations":[{"from":"id или имя","to":"id или имя","type":"part_of"}],
"confirm":["id фактов и правил, которые разговор подтвердил"],
"weaken":["id фактов и правил, которые оказались неверными"],
"review":{"score":4,"good":"что в твоих ответах получилось","weak":"главное слабое место","lesson":"как действовать в следующий раз"},
"answers":[{"question":"id открытого вопроса","text":"что ты узнала из ответа пользователя"}],
"questions":["вопрос пользователю о пробеле в памяти"]}
Факты: только устойчивое и полезное в будущем — кто пользователь, его предпочтения, привычки, планы, важные обстоятельства. Пиши в третьем лице, коротко, по-русски. Не записывай содержимое заметок, разовые просьбы и общие знания.
Правила: явные просьбы о стиле и порядке работы. Обязательно сделай рефлексию: оцени свои ответы. Если пользователь тебя поправил, переспросил, попросил короче, иначе или по-другому, сформулируй из этого правило.
Самооценка (review): честно оцени свои ответы в этом разговоре от 1 до 5 (5 — пользователь получил то, что хотел, с первого раза). weak — главное слабое место одной фразой, если оно было. lesson — правило-навык для себя на будущее, только если слабое место повторимо, например «Перед длинным ответом уточнять, что именно нужно». Не выдумывай промахов, если всё прошло хорошо.
Открытые вопросы: если пользователь в разговоре ответил на один из них, верни answers. Если в разговоре появилось что-то важное и непонятное (неизвестный человек или проект), можно добавить до двух вопросов в questions.
Учитывай сигналы поведения: отменённая задача или заметка, созданная тобой, — промах (пойми, что было не так); скопированный или сохранённый ответ — удача; переспрос — ответ был непонятен; остановленный ответ — слишком длинно или не о том.
${SHAPES}
links — id заметок, задач, фактов и правил из списков ниже, к которым относится запись. Необязательные поля можно опускать. Если тема пустая (только приветствие), episode равен null. Если запоминать нечего, верни пустые массивы.`;

export const SLEEP_PROMPT = `Ты модуль памяти помощницы Миюнэи. Сейчас «сон»: перечитай новые эпизоды и заметки и наведи порядок в памяти. Верни только JSON без пояснений:
{"merge":[{"ids":["id","id"],"text":"объединённая формулировка"}],
"remove":[{"id":"id","reason":"дубль, устарело или противоречит"}],
"update":[{"id":"id","text":"уточнённая формулировка"}],
"rules":[{"text":"правило","episodes":["id","id"]}],
"insights":[{"text":"вывод о пользователе","category":"work","episodes":["id","id"]}],
"note_facts":[{"text":"факт о пользователе из его заметок","note":"id заметки","category":"plans","until":"ГГГГ-ММ-ДД"}],
"entities":[{"name":"имя","type":"project","about":"что это"}],
"relations":[{"from":"id или имя","to":"id или имя","type":"part_of"}],
"topics":[{"id":"id существующей темы или пусто","title":"тема","area":"work","summary":"что ты знаешь по теме","facts":["id"]}],
"understanding":"общее понимание пользователя",
"conflicts":[{"ids":["id","id"],"question":"вопрос пользователю, что из этого верно сейчас"}],
"questions":["вопрос пользователю о пробеле в памяти"],
"diary":"запись в дневник от первого лица",
"summary":"одно-два предложения о том, что изменилось"}
1. Объедини похожие факты и похожие правила (только одного вида).
2. Убери дубли, устаревшее и то, что противоречит более свежим записям.
3. Если просьба или поведение повторяются в нескольких эпизодах, сделай из этого правило. Пример: три раза просили короткие задачи → правило «Задачи формулировать коротко».
4. Из повторяющихся эпизодов сделай выводы о пользователе (insights) со ссылками на эпизоды.
5. Перечитай новые и изменённые заметки: устойчивые факты о пользователе (планы, привычки, люди, проекты) запиши в note_facts со ссылкой на заметку. Не пересказывай заметки.
6. Свяжи между собой сущности, факты, эпизоды, заметки и задачи (relations), если связь явная.
7. Собери факты в темы (topics) — иерархию памяти. Тема — узкая область жизни пользователя, например «Проект Календарь», «Утренний режим», «Японский язык»; area — категория области; summary — 1–3 предложения о том, что ты знаешь по теме; facts — id фактов этой темы. Существующие темы обновляй по их id, не плоди похожие. Факт входит не больше чем в одну тему.
8. understanding — твоё общее понимание пользователя в 3–6 предложениях, собранное из тем: кто он, что для него важно, как с ним лучше работать. Обнови его, а не пиши заново, если нового мало.
9. Найди противоречащие друг другу факты (conflicts), которые не можешь разрешить сама, и сформулируй мягкий вопрос пользователю, например «Вы писали, что работаете по утрам, а потом — что по вечерам. Как сейчас?». Если более свежий факт явно отменяет старый, просто убери старый через remove.
10. Если в самооценках эпизодов повторяется одно слабое место, сделай из него правило в rules со ссылками на эти эпизоды.
11. Если в памяти есть важные пробелы, добавь до трёх вопросов пользователю (questions). Не спрашивай то, что уже есть в открытых вопросах.
12. Напиши запись в дневник Миюнэи: 2–5 тёплых предложений от первого лица о том, что ты узнала и поняла о пользователе за это время и что изменила в себе. Без выдумок; если нового мало, так и скажи.
${SHAPES}
Записи с пометкой «закреплено» не удаляй, не переписывай и не считай устаревшими в conflicts. Ничего не выдумывай. Если менять нечего, верни пустые массивы.`;

export const COMPACT_PROMPT = 'Ты сжимаешь начало разговора пользователя с помощницей Миюнэей, чтобы она не теряла нить. Напиши краткое резюме по-русски до 1200 знаков: о чём говорили, что решили, какие просьбы и договорённости остались в силе, открытые вопросы. Только резюме, без вступлений.';

const itemLine = (i: MemoryItem) => `[${i.id}] ${i.text}${i.kind === 'fact' && i.category !== 'other' ? ` {${i.category}}` : ''}${i.until ? ` (до ${i.until})` : ''}${i.pinned ? ' (закреплено)' : ''}`;
const entityLine = (e: Entity) => `[${e.id}] ${e.name} — ${entityNames[e.type]}${e.about ? ': ' + e.about : ''}`;
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
    `Сущности:\n${memory.entities.slice(-60).map(entityLine).join('\n') || '— нет'}`,
    `Заметки и задачи:\n${entries.join('\n') || '— нет доступа или пусто'}`,
    `Открытые вопросы к пользователю:\n${memory.questions.map(q => `[${q.id}] ${q.text}`).join('\n') || '— нет'}`,
    `Сигналы поведения пользователя:\n${dialog.signals.map(s => '- ' + s).join('\n') || '— нет'}`,
    `Разговор ${day(dialog.updatedAt)}:\n${dialog.summary ? 'Начало (кратко): ' + dialog.summary + '\n' : ''}${transcript(dialog.messages)}`].join('\n\n');
}
// Notes changed since the previous sleep, newest first, so the assistant also learns from what the user writes.
export function changedNotes(memory: Memory, workspace: Workspace | null) {
  if (!workspace) return [];
  return workspace.notes.filter(n => !memory.notesSeen || n.updatedAt > memory.notesSeen).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 30);
}
export function sleepInput(memory: Memory, workspace: Workspace | null = null, now = Date.now()) {
  const fresh = memory.episodes.filter(e => !e.consolidated);
  const older = memory.episodes.filter(e => e.consolidated).slice(-30);
  const episode = (e: Episode) => `[${e.id}] ${day(e.date)}: ${e.topic}${e.outcome ? ' — ' + e.outcome : ''}${e.score ? ` (самооценка ${e.score}/5${e.weak ? ', слабое место: ' + e.weak : ''})` : ''}`;
  const item = (i: MemoryItem) => `${itemLine(i)} · сила ${strength(i, now).toFixed(2)}, подтверждений ${i.hits}`;
  let budget = 15_000;
  const notes = changedNotes(memory, workspace).map(n => { const body = n.body.length > 600 ? n.body.slice(0, 600) + '…' : n.body; const line = `[${n.id}] ${n.title}${body.trim() ? '\n' + body : ''}`; budget -= line.length; return budget > 0 ? line : ''; }).filter(Boolean);
  const tasks = workspace ? workspace.tasks.filter(t => !t.done).slice(-60).map(t => `[${t.id}] ${t.title}`) : [];
  return [`Факты:\n${memory.items.filter(i => i.kind === 'fact').map(item).join('\n') || '— нет'}`, `Правила:\n${memory.items.filter(i => i.kind === 'rule').map(item).join('\n') || '— нет'}`,
    `Сущности:\n${memory.entities.map(entityLine).join('\n') || '— нет'}`,
    `Новые эпизоды:\n${fresh.map(episode).join('\n') || '— нет'}`, `Более ранние эпизоды:\n${older.map(episode).join('\n') || '— нет'}`,
    `Темы:\n${memory.topics.map(t => `[${t.id}] ${t.title} {${t.area}}: ${t.summary || '—'} (факты: ${t.facts.join(', ') || 'нет'})`).join('\n') || '— нет'}`,
    `Общее понимание пользователя:\n${memory.understanding?.text || '— ещё нет'}`,
    `Открытые вопросы к пользователю:\n${memory.questions.map(q => `[${q.id}] ${q.text}`).join('\n') || '— нет'}`,
    `Новые и изменённые заметки:\n${notes.join('\n\n') || '— нет'}`, `Открытые задачи:\n${tasks.join('\n') || '— нет'}`].join('\n\n').slice(0, 80_000);
}

// Turns «id», «имя сущности» or «episode» from the model into a record id; unknown names are skipped.
function resolver(memory: Memory, known: Set<string>, episode: Episode | null) {
  return (ref: unknown) => {
    if (typeof ref !== 'string' || !ref.trim()) return null;
    if (ref === 'episode') return episode?.id ?? null;
    if (known.has(ref) || memory.items.some(i => i.id === ref) || memory.episodes.some(e => e.id === ref) || memory.entities.some(e => e.id === ref)) return ref;
    const lower = ref.trim().toLocaleLowerCase('ru');
    return memory.entities.find(e => [e.name, ...e.aliases].some(n => n.toLocaleLowerCase('ru') === lower))?.id ?? null;
  };
}
function applyGraph(memory: Memory, result: any, resolve: (ref: unknown) => string | null, now: string) {
  for (const entry of list(result.entities)) upsertEntity(memory, entry.name, entry.type, entry.about, now);
  for (const entry of list(result.relations)) { const from = resolve(entry.from), to = resolve(entry.to); if (from && to) addEdge(memory, from, to, entry.type, now); }
}
// Applies the post-dialog reflection: an episode, entities, new or confirmed facts and rules, relations and weakened mistakes.
export function applyReflection(memory: Memory, result: any, dialog: Dialog, known: Set<string>, now = new Date().toISOString()) {
  if (!result || typeof result !== 'object') return 0;
  const valid = (links: unknown) => ids(links).filter(id => known.has(id) || memory.items.some(i => i.id === id));
  const item = (id: unknown) => memory.items.find(i => i.id === id);
  let changes = 0;
  let episode: Episode | null = null;
  const topic = clip(result.episode?.topic, 200);
  if (topic) {
    episode = { id: newId(), date: dialog.updatedAt, topic, outcome: clip(result.episode.outcome, 600), links: valid(result.episode.links), consolidated: false, score: score(result.review?.score), weak: clip(result.review?.weak, 300) };
    memory.episodes.push(episode); changes++;
    journal(memory, 'episode', `Разговор: ${topic}`, now);
  }
  const resolve = resolver(memory, known, episode);
  for (const entry of list(result.entities)) if (upsertEntity(memory, entry.name, entry.type, entry.about, now)) changes++;
  for (const kind of ['fact', 'rule'] as const) for (const entry of list(kind === 'fact' ? result.facts : result.rules)) {
    const old = item(entry.conflicts);
    if (old && old.kind === kind) weaken(memory, old, now, 0.4);
    const added = upsert(memory, kind, entry.text, { same: typeof entry.same === 'string' ? entry.same : undefined, links: [...valid(entry.links), ...(episode ? [episode.id] : [])], weight: kind === 'rule' ? 0.6 : 0.5, now, category: entry.category, until: entry.until });
    if (!added) continue;
    changes++;
    for (const name of Array.isArray(entry.about) ? entry.about.slice(0, 5) : []) { const target = resolve(name); if (target) addEdge(memory, added.item.id, target, 'about', now); }
  }
  for (const entry of list(result.relations)) { const from = resolve(entry.from), to = resolve(entry.to); if (from && to && addEdge(memory, from, to, entry.type, now)) changes++; }
  for (const id of ids(result.confirm)) { const found = item(id); if (found) { reinforce(found, now, 0.2); changes++; } }
  for (const id of ids(result.weaken)) { const found = item(id); if (found) { weaken(memory, found, now, 0.6); changes++; } }
  // Self-review: a repeatable weak spot becomes a procedural rule, so the next answers avoid it.
  const review = result.review && typeof result.review === 'object' ? result.review : null;
  if (review && score(review.score)) {
    const weak = clip(review.weak, 300);
    journal(memory, 'review', `Самооценка ${score(review.score)}/5${weak ? ' · слабое место: ' + weak : ''}`, now);
    if (upsert(memory, 'rule', review.lesson, { source: 'review', weight: 0.55, links: episode ? [episode.id] : [], now })) changes++;
  }
  for (const entry of list(result.answers)) if (typeof entry.question === 'string' && answer(memory, entry.question, entry.text, now, 'dialog')) changes++;
  for (const text of Array.isArray(result.questions) ? result.questions.slice(0, 2) : []) if (ask(memory, 'gap', text, {}, now)) changes++;
  findGaps(memory, now);
  memory.episodes = memory.episodes.slice(-LIMITS.episodes);
  return changes;
}

// Applies the nightly consolidation, learns from notes, writes the diary and then lets weak records fade.
export function applySleep(memory: Memory, result: any, now = Date.now(), known: Set<string> = new Set()) {
  const at = new Date(now).toISOString();
  const episodes = new Set(memory.episodes.map(e => e.id));
  const renamed = new Map<string, string>();
  const find = (id: unknown) => memory.items.find(i => i.id === (typeof id === 'string' ? renamed.get(id) ?? id : id));
  if (result && typeof result === 'object') {
    for (const merge of list(result.merge)) {
      const group = ids(merge.ids).map(find).filter((i): i is MemoryItem => !!i);
      const text = clip(merge.text);
      if (group.length < 2 || !text || group.some(i => i.kind !== group[0].kind)) continue;
      const merged: MemoryItem = { id: newId(), kind: group[0].kind, text, weight: Math.min(1, Math.max(...group.map(i => i.weight)) + 0.1), hits: group.reduce((n, i) => n + i.hits, 0),
        created: group.map(i => i.created).sort()[0], seen: at, pinned: group.some(i => i.pinned), source: 'sleep', links: [...new Set(group.flatMap(i => i.links))].slice(0, 20),
        category: group.find(i => i.category !== 'other')?.category ?? 'other', until: group.map(i => i.until).filter(Boolean).sort().at(-1) ?? null };
      memory.items = [...memory.items.filter(i => !group.includes(i)), merged];
      relink(memory, group.map(i => i.id), merged.id);
      for (const old of group) renamed.set(old.id, merged.id);
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
      upsert(memory, kind, entry.text, { links: from, source: 'sleep', weight: Math.min(0.9, 0.45 + 0.1 * from.length), now: at, category: entry.category });
    }
    for (const entry of list(result.note_facts)) {
      if (typeof entry.note !== 'string' || !known.has(entry.note)) continue;
      upsert(memory, 'fact', entry.text, { links: [entry.note], source: 'note', weight: 0.45, now: at, category: entry.category, until: entry.until });
    }
    applyGraph(memory, result, resolver(memory, known, null), at);
    applyTopics(memory, result, find, at);
    for (const entry of list(result.conflicts)) {
      const pair = [...new Set(ids(entry.ids).map(id => find(id)).filter((i): i is MemoryItem => !!i && i.kind === 'fact').map(i => i.id))];
      if (pair.length >= 2) ask(memory, 'conflict', entry.question, { facts: pair }, at);
    }
    for (const text of Array.isArray(result.questions) ? result.questions.slice(0, 3) : []) ask(memory, 'gap', text, {}, at);
    const diary = clip(result.diary, 2000);
    if (diary) { memory.diary.push({ id: newId(), date: at, text: diary }); memory.diary = memory.diary.slice(-LIMITS.diary); }
  }
  for (const e of memory.episodes) e.consolidated = true;
  memory.lastSleep = at;
  decay(memory, now);
  findGaps(memory, at);
  journal(memory, 'sleep', 'Сон: ' + (clip(result?.summary, 300) || 'память упорядочена'), at);
  return memory;
}

// Facts roll up into topics, and topics into one understanding of the user.
function applyTopics(memory: Memory, result: any, find: (id: unknown) => MemoryItem | undefined, at: string) {
  for (const entry of list(result.topics)) {
    const title = clip(entry.title, 80);
    const facts = [...new Set(ids(entry.facts, 60).map(id => find(id)).filter((i): i is MemoryItem => !!i && i.kind === 'fact').map(i => i.id))];
    const summary = clip(entry.summary, 600);
    let topic = memory.topics.find(t => t.id === entry.id) || (title ? memory.topics.find(t => similarity(t.title, title) >= 0.6) : undefined);
    if (!topic) {
      if (!title || (!facts.length && !summary) || memory.topics.length >= LIMITS.topics) continue;
      topic = { id: newId(), title, area: category(entry.area), summary, facts: [], created: at, updated: at };
      memory.topics.push(topic);
      journal(memory, 'topic', `Новая тема: ${title}`, at);
    }
    if (title) topic.title = title;
    if (entry.area !== undefined) topic.area = category(entry.area);
    if (summary) topic.summary = summary;
    // A fact belongs to one topic only.
    for (const other of memory.topics) if (other !== topic) other.facts = other.facts.filter(id => !facts.includes(id));
    topic.facts = [...new Set([...topic.facts, ...facts])].slice(0, 60);
    topic.updated = at;
  }
  const understanding = clip(result.understanding, 1500);
  if (understanding) memory.understanding = { text: understanding, updated: at };
}

type Options = {
  ask(system: string, user: string, timeout?: number): Promise<string>;
  embed?(texts: string[], timeout?: number): Promise<number[][]>;
  embedModel?(): string;
  available(): boolean; workspace(): Workspace | null; idleMs?: number; tickMs?: number;
};
type VectorFile = { model: string; vectors: Record<string, number[]> };
// Loads data/memory.json and runs the background work: reflection after a dialog goes quiet, a daily sleep when idle,
// and indexing of every record into meaning vectors kept apart in data/memory-vectors.json.
export async function openMemory(dataDir: string, options: Options) {
  const file = join(dataDir, 'memory.json');
  const vectorFile = join(dataDir, 'memory-vectors.json');
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
  const key = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);
  let vectors = new Map<string, number[]>(); let vectorModel = '';
  try {
    const saved: VectorFile = JSON.parse(await readFile(vectorFile, 'utf8'));
    vectorModel = typeof saved.model === 'string' ? saved.model : '';
    for (const [k, v] of Object.entries(saved.vectors || {})) if (Array.isArray(v) && v.every(n => typeof n === 'number')) vectors.set(k, v);
  } catch {}
  let writing = Promise.resolve();
  const write = (path: string, value: () => unknown) => { const next = writing.then(() => atomicWrite(path, JSON.stringify(value(), null, path === file ? 2 : 0))); writing = next.catch(() => {}); return next; };
  const save = () => write(file, () => memory);
  const saveVectors = () => write(vectorFile, () => ({ model: vectorModel, vectors: Object.fromEntries(vectors) }));
  let lastActivity = 0;
  let job: { kind: 'reflect' | 'sleep'; done: Promise<unknown> } | null = null;
  let retrySleepAt = 0;
  let embedRetryAt = 0; let embedError = '';
  let indexing: Promise<void> | null = null; let reindex = false;
  let closed = false;

  const titles = (): Titles => {
    const data = options.workspace();
    return new Map(data ? [...data.notes.map(n => [n.id, { kind: 'note', title: n.title }] as const), ...data.tasks.map(t => [t.id, { kind: 'task', title: t.title }] as const)] : []);
  };
  const embedReady = () => !!options.embed && !!options.embedModel?.() && options.available() && memory.settings.enabled && Date.now() >= embedRetryAt;
  const embedFailed = (e: unknown) => { embedRetryAt = Date.now() + 30 * 60_000; embedError = (e as Error).message || 'Поиск по смыслу недоступен.'; };
  // Embeds records that have no vector yet; vectors of edited or deleted records are dropped.
  function index() {
    if (indexing) { reindex = true; return indexing; }
    if (closed || !embedReady()) return null;
    indexing = (async () => {
      try {
        const model = options.embedModel!();
        if (model !== vectorModel) { vectors = new Map(); vectorModel = model; }
        const wanted = new Map(searchTexts(memory).map(t => [key(t), t]));
        let changed = false;
        for (const k of [...vectors.keys()]) if (!wanted.has(k)) { vectors.delete(k); changed = true; }
        const missing = [...wanted].filter(([k]) => !vectors.has(k)).map(([, t]) => t).slice(0, 128);
        for (let i = 0; i < missing.length && !closed; i += 32) {
          const chunk = missing.slice(i, i + 32);
          const out = await options.embed!(chunk, 60_000);
          chunk.forEach((text, n) => vectors.set(key(text), out[n].map(x => Math.round(x * 10_000) / 10_000)));
          changed = true;
        }
        embedError = '';
        if (changed) await saveVectors();
      } catch (e) { embedFailed(e); }
      finally { indexing = null; if (reindex) { reindex = false; void index(); } }
    })();
    return indexing;
  }
  function run<T>(kind: 'reflect' | 'sleep', work: () => Promise<T>): Promise<T> {
    if (job) return job.done.catch(() => {}).then(() => run(kind, work));
    const done = work().finally(() => { if (job?.done === done) job = null; void index(); });
    job = { kind, done };
    return done;
  }
  async function reflect(id: string) {
    const dialog = memory.dialogs.find(d => d.id === id);
    if (!dialog) return 0;
    const users = dialog.messages.filter(m => m.role === 'user');
    if (!users.length || users.reduce((n, m) => n + m.content.length, 0) < 12) { memory.dialogs = memory.dialogs.filter(d => d !== dialog); await save(); return 0; }
    const snapshot = { ...dialog, messages: [...dialog.messages], signals: [...dialog.signals] };
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
    // Messages and signals that arrived while the model was thinking stay for the next reflection.
    const current = memory.dialogs.find(d => d.id === id);
    const rest = current && current.updatedAt !== snapshot.updatedAt ? unseen(current.messages, last) : [];
    const signals = current ? current.signals.filter(s => !snapshot.signals.includes(s)) : [];
    if (current && rest.length) { current.messages = rest; current.signals = signals; }
    else memory.dialogs = memory.dialogs.filter(d => d.id !== id);
    await save();
    return changes;
  }
  async function sleep() {
    const now = Date.now();
    const workspace = options.workspace();
    const notes = changedNotes(memory, workspace);
    let result = null;
    if (memory.items.length || memory.episodes.some(e => !e.consolidated) || notes.length) {
      try { result = parseJson(await options.ask(SLEEP_PROMPT, sleepInput(memory, workspace, now), 180_000)); }
      catch (e) { retrySleepAt = Date.now() + 3_600_000; throw e; }
    }
    applySleep(memory, result, Date.now(), new Set([...titles().keys(), ...memory.episodes.map(e => e.id)]));
    if (workspace) memory.notesSeen = new Date(now).toISOString();
    await save();
    return result;
  }
  async function tick(now = Date.now()) {
    if (closed || job || !options.available() || !memory.settings.enabled) return;
    const quiet = memory.dialogs.find(d => now - Date.parse(d.updatedAt) >= idleMs);
    try {
      if (quiet) return void await run('reflect', () => reflect(quiet.id));
      const due = !memory.lastSleep || now - Date.parse(memory.lastSleep) >= SLEEP_EVERY;
      const fresh = memory.episodes.some(e => !e.consolidated) || changedNotes(memory, options.workspace()).length > 0;
      if (now - lastActivity >= idleMs && due && now >= retrySleepAt && fresh) return void await run('sleep', sleep);
      void index();
    } catch (e) { console.error('Фоновая работа памяти не выполнена:', (e as Error).message); }
  }
  const timer = setInterval(() => void tick(), options.tickMs ?? 60_000);
  timer.unref();
  // Edits are indexed right away so the next answer can find them by meaning.
  const changed = async () => { await save(); void index(); };

  const view = (now = Date.now()) => {
    const degree = new Map<string, number>();
    for (const e of memory.edges) for (const id of [e.from, e.to]) degree.set(id, (degree.get(id) || 0) + 1);
    return {
      enabled: memory.settings.enabled, private: memory.settings.private, available: options.available(), busy: job?.kind ?? null, lastSleep: memory.lastSleep,
      pending: memory.dialogs.length, newEpisodes: memory.episodes.filter(e => !e.consolidated).length,
      search: embedReady() && vectors.size ? 'meaning' : 'words', searchError: embedError, indexed: vectors.size,
      items: memory.items.map(i => ({ ...i, strength: Math.round(strength(i, now) * 100) / 100, expired: expired(i, now) })).sort((a, b) => b.strength - a.strength),
      episodes: [...memory.episodes].reverse(), entities: memory.entities.map(e => ({ ...e, degree: degree.get(e.id) || 0 })), edges: memory.edges,
      diary: [...memory.diary].reverse(), journal: [...memory.journal].reverse(),
      topics: memory.topics, understanding: memory.understanding, questions: memory.questions, growth: growth(memory, now),
    };
  };
  return {
    view, tick, save, index,
    get data() { return memory; },
    get recording() { return memory.settings.enabled && !memory.settings.private; },
    // Recall for the next answer: the question is embedded once; records without a vector yet fall back to words.
    async context(query: string) {
      let vector: number[] | undefined;
      if (embedReady() && vectors.size) { try { vector = (await options.embed!([query.slice(0, 4000)], 8000))[0]; } catch (e) { embedFailed(e); } }
      void index();
      // One open question a day at most, three tries each, and never while nothing is being recorded.
      const now = Date.now();
      const question = this.recording && !memory.questions.some(q => q.lastAsked && now - Date.parse(q.lastAsked) < 20 * 3_600_000)
        ? memory.questions.filter(q => q.asked < 3).sort((a, b) => a.asked - b.asked || a.created.localeCompare(b.created))[0] : undefined;
      const context = memoryContext(memory, query, titles(), now, { query: vector, vector: text => vectors.get(key(text)), question: question?.text });
      if (question && context.includes(question.text)) { question.asked++; question.lastAsked = new Date(now).toISOString(); await save(); }
      return context;
    },
    touch() { lastActivity = Date.now(); },
    // Keeps the latest turns of a dialog until it goes quiet and can be reflected on.
    record(id: string, messages: ChatMessage[], summary: string) {
      lastActivity = Date.now();
      if (!memory.settings.enabled || memory.settings.private) return save();
      const existing = memory.dialogs.find(d => d.id === id);
      const fresh = unseen(messages, memory.marks.find(m => m.id === id)?.last);
      if (!fresh.length) return save();
      const signals = [...(existing?.signals || [])];
      // Asking the same thing twice in a row means the previous answer missed.
      const asked = messages.filter(m => m.role === 'user').slice(-2);
      if (asked.length === 2 && similarity(asked[0].content, asked[1].content) >= 0.6) signals.push(`Переспросил почти то же самое: «${clip(asked[1].content, 120)}»`);
      const dialog: Dialog = { id, messages: fresh.slice(-LIMITS.dialogMessages), summary: clip(summary, 6000), updatedAt: new Date().toISOString(), failures: existing?.failures ?? 0, signals: signals.slice(-LIMITS.signals) };
      memory.dialogs = [...memory.dialogs.filter(d => d.id !== id), dialog].slice(-LIMITS.dialogs);
      return save();
    },
    // Implicit feedback from the browser: an undone entry, a copied or saved answer, a stopped answer.
    async signal(id: string, text: string) {
      const dialog = memory.dialogs.find(d => d.id === id);
      if (!dialog || !this.recording) return false;
      dialog.signals = [...dialog.signals, clip(text, 200)].slice(-LIMITS.signals);
      await save(); return true;
    },
    async remember(text: string) { const added = upsert(memory, commandKind(text), text, { source: 'user', pinned: true }); await changed(); return added?.item ?? null; },
    async forget(text: string) { const removed = forget(memory, text); if (removed.length) await changed(); return removed; },
    async settings(change: { enabled?: boolean; private?: boolean }) {
      memory.settings = { ...memory.settings, ...change };
      if (memory.settings.private || !memory.settings.enabled) memory.dialogs = [];
      await save();
    },
    async answer(id: string, text: string) { const added = answer(memory, id, text); if (added) await changed(); return !!added; },
    async add(kind: MemoryKind, text: string, extra: { category?: unknown; until?: unknown } = {}) { const added = upsert(memory, kind, text, { source: 'user', pinned: true, ...extra }); await changed(); return added?.item ?? null; },
    async edit(id: string, change: { text?: string; pinned?: boolean; topic?: string; outcome?: string; category?: string; until?: string | null; name?: string; about?: string; type?: string; title?: string; summary?: string }) {
      if (id === 'understanding') {
        if (!memory.understanding || change.text === undefined || !clip(change.text, 1500)) return false;
        memory.understanding = { text: clip(change.text, 1500), updated: new Date().toISOString() };
        await changed(); return true;
      }
      const topic = memory.topics.find(t => t.id === id);
      if (topic) {
        if (change.title !== undefined && clip(change.title, 80)) topic.title = clip(change.title, 80);
        if (change.summary !== undefined) topic.summary = clip(change.summary, 600);
        if (change.category !== undefined) topic.area = category(change.category);
        topic.updated = new Date().toISOString();
        await changed(); return true;
      }
      const item = memory.items.find(i => i.id === id);
      const episode = memory.episodes.find(e => e.id === id);
      const entity = memory.entities.find(e => e.id === id);
      const entry = memory.diary.find(d => d.id === id);
      if (!item && !episode && !entity && !entry) return false;
      const at = new Date().toISOString();
      if (item) {
        if (change.text !== undefined && clip(change.text) && clip(change.text) !== item.text) { journal(memory, 'edited', `Исправлено вами: ${item.text} → ${clip(change.text)}`, at); item.text = clip(change.text); item.seen = at; item.source = 'user'; }
        if (change.pinned !== undefined) { item.pinned = change.pinned; if (change.pinned) item.weight = 1; item.seen = at; }
        if (change.category !== undefined) item.category = category(change.category);
        if (change.until !== undefined) item.until = validDate(change.until) ? change.until : null;
      }
      if (episode) {
        if (change.topic !== undefined && clip(change.topic, 200)) episode.topic = clip(change.topic, 200);
        if (change.outcome !== undefined) episode.outcome = clip(change.outcome, 600);
      }
      if (entity) {
        if (change.name !== undefined && clip(change.name, 80)) entity.name = clip(change.name, 80);
        if (change.about !== undefined) entity.about = clip(change.about, 300);
        if (ENTITY_TYPES.includes(change.type as EntityType)) entity.type = change.type as EntityType;
      }
      if (entry && change.text !== undefined && clip(change.text, 2000)) entry.text = clip(change.text, 2000);
      await changed(); return true;
    },
    async remove(id: string) {
      if (id === 'understanding') { if (!memory.understanding) return false; memory.understanding = null; await changed(); return true; }
      const count = () => memory.items.length + memory.episodes.length + memory.entities.length + memory.diary.length + memory.topics.length + memory.questions.length;
      const before = count();
      memory.topics = memory.topics.filter(t => t.id !== id);
      memory.questions = memory.questions.filter(q => q.id !== id);
      memory.items = memory.items.filter(i => i.id !== id);
      memory.episodes = memory.episodes.filter(e => e.id !== id);
      memory.entities = memory.entities.filter(e => e.id !== id);
      memory.diary = memory.diary.filter(d => d.id !== id);
      for (const record of [...memory.items, ...memory.episodes]) record.links = record.links.filter(link => link !== id);
      memory.edges = memory.edges.filter(e => e.from !== id && e.to !== id);
      prune(memory);
      if (before === count()) return false;
      await changed(); return true;
    },
    async unlink(from: string, to: string) {
      const before = memory.edges.length;
      memory.edges = memory.edges.filter(e => !((e.from === from && e.to === to) || (e.from === to && e.to === from)));
      let removed = before - memory.edges.length;
      for (const record of [...memory.items, ...memory.episodes]) {
        const other = record.id === from ? to : record.id === to ? from : null;
        if (other && record.links.includes(other)) { record.links = record.links.filter(l => l !== other); removed++; }
      }
      if (removed) await save();
      return removed > 0;
    },
    async reset() { memory = { ...emptyMemory(), settings: memory.settings }; vectors = new Map(); retrySleepAt = 0; await save(); await saveVectors(); },
    close: (id: string) => memory.dialogs.some(d => d.id === id) ? run('reflect', () => reflect(id)) : Promise.resolve(0),
    sleepNow: () => run('sleep', sleep),
    exportData: () => ({ ...memory, dialogs: undefined, marks: undefined, exportedAt: new Date().toISOString() }),
    async shutdown() { closed = true; clearInterval(timer); await job?.done.catch(() => {}); await indexing; await writing; },
  };
}
