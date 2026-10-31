import type { Memory, MemoryItem } from './memory.ts';
import { expired, overlap, tokens } from './recall.ts';

/**
 * Cognitive memory is a *derived* view of the existing memory graph.
 * It does not create unsupported "facts" or a second data store.
 *
 * Direct = explicitly linked records, shared episode = facts connected to
 * the same saved episode, topic = a model-maintained grouping. Even a direct
 * edge establishes an association in the archive, NOT scientific causation.
 */
export type CognitiveKind = 'direct' | 'episode' | 'topic' | 'entity';
export type CognitiveState = 'recorded' | 'candidate';
export type CognitiveAssociation = {
  id: string;
  kind: CognitiveKind;
  state: CognitiveState;
  left: { id: string; text: string };
  right: { id: string; text: string };
  source: { id: string; title: string };
  observedAt: string;
};
export type CognitiveUncertainty = {
  id: string;
  text: string;
  reason: 'inferred' | 'contested';
  updated: string;
};
export type CognitiveSnapshot = {
  enabled: boolean;
  summary: { active: number; withEvidence: number; inferred: number; contested: number; expired: number; associations: number };
  associations: CognitiveAssociation[];
  uncertainties: CognitiveUncertainty[];
  questions: { id: string; kind: 'gap' | 'conflict'; text: string; facts: string[] }[];
  generatedAt: string;
};

const DAY = 86_400_000;
const idOk = (value: unknown) => typeof value === 'string' && /^[\w-]{1,100}$/.test(value);
const short = (text: string, max = 125) => text.length > max ? text.slice(0, max - 1) + '…' : text;
const active = (item: MemoryItem, now: number) => item.status !== 'superseded' && !expired(item, now);
const recorded = (item: MemoryItem) => item.status === 'active' || (!item.status && item.source === 'user');
const lastSeen = (a: MemoryItem, b: MemoryItem) =>
  a.seen > b.seen ? a.seen : b.seen;

/** Costs are bounded even for maximum-sized historical graphs. */
export function buildCognitiveSnapshot(memory: Memory, now = Date.now()): CognitiveSnapshot {
  const current = memory.items.filter(i => i.kind === 'fact' && active(i, now)).slice(-600);
  const records = new Map(current.map(i => [i.id, i]));
  const known = current.filter(recorded);
  const associations: CognitiveAssociation[] = [];
  const duplicates = new Set<string>();
  const MAX = 96;
  const add = (aId: string, bId: string, kind: CognitiveKind, sourceId: string, title: string) => {
    if (associations.length >= MAX || aId === bId || !idOk(sourceId)) return;
    const a = records.get(aId), b = records.get(bId);
    if (!a || !b) return;
    const [left, right] = a.id < b.id ? [a, b] : [b, a];
    const state = recorded(left) && recorded(right) ? 'recorded' : 'candidate';
    // One row per pair and provenance type; the provenance can be inspected.
    const id = [left.id, right.id, kind, sourceId].join(':');
    if (duplicates.has(id)) return;
    duplicates.add(id);
    associations.push({
      id, kind, state,
      left: { id: left.id, text: short(left.text) },
      right: { id: right.id, text: short(right.text) },
      source: { id: sourceId, title: short(title, 90) },
      observedAt: lastSeen(left, right),
    });
  };

  // Explicit associations: old graph links and typed edges.
  for (const fact of current) {
    for (const link of fact.links.slice(0, 30)) {
      if (records.has(link)) add(fact.id, link, 'direct', fact.id, 'Прямая связь записей');
    }
    if (associations.length >= MAX) break;
  }
  for (const edge of memory.edges.slice(-1500)) {
    if (associations.length >= MAX) break;
    if (records.has(edge.from) && records.has(edge.to))
      add(edge.from, edge.to, 'direct', edge.from, 'Связь графа: ' + edge.type);
  }

  // Episodes are real recorded contexts: co-occurrence does NOT mean causation.
  for (const e of memory.episodes.slice(-400).reverse()) {
    if (associations.length >= MAX) break;
    const linked = current.filter(i => i.origin === e.id || i.links.includes(e.id)).slice(0, 9);
    for (let i = 0; i < linked.length && associations.length < MAX; i++)
      for (let j = i + 1; j < linked.length && associations.length < MAX; j++)
        add(linked[i].id, linked[j].id, 'episode', e.id, 'Эпизод: ' + e.topic);
  }

  // Topics from the existing sleep consolidation are model-created groupings.
  for (const topic of memory.topics.slice(-80).reverse()) {
    if (associations.length >= MAX) break;
    const members = topic.facts.filter(id => records.has(id)).slice(0, 9);
    for (let i = 0; i < members.length && associations.length < MAX; i++)
      for (let j = i + 1; j < members.length && associations.length < MAX; j++)
        add(members[i], members[j], 'topic', topic.id, 'Тема: ' + topic.title);
  }

  // The entity graph supports contextual associations without promoting an
  // automatically extracted entity description to a user-confirmed fact.
  for (const entity of memory.entities.slice(-300)) {
    if (associations.length >= MAX) break;
    const members = memory.edges.filter(e => e.from === entity.id || e.to === entity.id)
      .map(e => e.from === entity.id ? e.to : e.from).filter(id => records.has(id)).slice(0, 8);
    for (let i = 0; i < members.length && associations.length < MAX; i++)
      for (let j = i + 1; j < members.length && associations.length < MAX; j++)
        add(members[i], members[j], 'entity', entity.id, 'Объект: ' + entity.name);
  }

  // Put the strongest provenance first; don't invent numerical probabilities.
  const rank: Record<CognitiveKind, number> = { direct: 0, episode: 1, entity: 2, topic: 3 };
  associations.sort((a, b) => (a.state === b.state ? 0 : a.state === 'recorded' ? -1 : 1)
    || rank[a.kind] - rank[b.kind] || b.observedAt.localeCompare(a.observedAt) || a.id.localeCompare(b.id));

  const uncertainties: CognitiveUncertainty[] = current
    .filter(i => i.status === 'inferred' || i.status === 'contested')
    .sort((a, b) => b.seen.localeCompare(a.seen))
    .slice(0, 30).map(i => ({ id: i.id, text: i.text, reason: i.status === 'contested' ? 'contested' : 'inferred', updated: i.seen }));
  const sourceCount = known.filter(i => i.source === 'user' || (i.evidence || []).length > 0).length;
  return {
    enabled: memory.settings.enabled,
    summary: {
      active: known.length,
      withEvidence: sourceCount,
      inferred: current.filter(i => i.status === 'inferred').length,
      contested: current.filter(i => i.status === 'contested').length,
      expired: memory.items.filter(i => i.kind === 'fact' && (i.status === 'superseded' || expired(i, now))).length,
      associations: associations.length,
    },
    associations,
    uncertainties,
    questions: memory.questions.slice(0, 12).map(q => ({
      id: q.id, kind: q.kind, text: q.text, facts: q.facts.slice(0, 10),
    })),
    generatedAt: new Date(now).toISOString(),
  };
}

/** Relevance-gated, bounded contextual recall. Never presents a derived link as a new fact. */
export function cognitiveContext(memory: Memory, query: string, now = Date.now()) {
  if (!memory.settings.enabled || !query.trim()) return '';
  const q = tokens(query);
  if (!q.size) return '';
  const snapshot = buildCognitiveSnapshot(memory, now);
  const ranked = snapshot.associations.filter(a => a.state === 'recorded')
    .map(a => {
      const left = tokens(a.left.text), right = tokens(a.right.text);
      const match = overlap(q, left) + overlap(q, right);
      return { a, match };
    }).filter(x => x.match > 0)
    .sort((a, b) => b.match - a.match || b.a.observedAt.localeCompare(a.a.observedAt))
    .slice(0, 3);
  if (!ranked.length) return '';
  const distinct = new Set<string>();
  const out: string[] = [
    'Когнитивная память — только связи между уже сохранёнными записями.',
    'Связь или совместное упоминание НЕ доказывает причинность и не создаёт новый подтверждённый факт.',
  ];
  for (const { a } of ranked) {
    const key = [a.left.id, a.right.id].join(':');
    if (distinct.has(key)) continue;
    distinct.add(key);
    const source = a.kind === 'direct' ? 'явная связь' : a.kind === 'episode' ? 'общий эпизод' : a.kind === 'entity' ? 'общий объект' : 'общая тема';
    const line = '- ' + a.left.text + ' ↔ ' + a.right.text + ' (' + source + ': ' + a.source.title + ')';
    if (out.join('\n').length + line.length > 900) break;
    out.push(line);
  }
  return distinct.size ? out.join('\n') : '';
}
