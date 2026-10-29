import type { Memory, Category } from './memory.ts';
import { strength, FORGET_BELOW } from './recall.ts';

// Experience: how much Miyuneya knows about the user and how it grows. Nothing here is stored;
// it is counted from the memory itself, so edits and forgetting show up at once.
const DAY = 86_400_000;
export const LEVELS = ['Знакомство', 'Первые шаги', 'Приятельница', 'Хорошая знакомая', 'Подруга', 'Близкая подруга', 'Родная душа'];
// Experience needed for a level grows quadratically: with step 200 it is 0, 200, 600, 1200, 2000…
const need = (level: number, step: number) => step * (level - 1) * level / 2;
export function levelOf(points: number, step = 200) {
  let level = 1;
  while (points >= need(level + 1, step)) level++;
  return { level, floor: need(level, step), next: need(level + 1, step) };
}

export function growth(memory: Memory, now = Date.now()) {
  const week = now - 7 * DAY, fortnight = now - 14 * DAY;
  const recent = (date: string) => Date.parse(date) >= week;
  const live = memory.items.filter(i => i.pinned || strength(i, now) >= FORGET_BELOW);
  const points = (hits: number, base: number) => base + 4 * (Math.min(hits, 10) - 1);
  // Areas are skills: every fact and topic of an area adds to its level; this week's facts and confirmations show its growth.
  const areas = new Map<Category, { points: number; week: number; facts: number }>();
  const area = (key: Category) => { let a = areas.get(key); if (!a) areas.set(key, a = { points: 0, week: 0, facts: 0 }); return a; };
  let xp = 0, gained = 0;
  for (const item of live) {
    const value = points(item.hits, item.kind === 'rule' ? 12 : 10);
    xp += value;
    const fresh = recent(item.created) ? value : recent(item.seen) && item.hits > 1 ? 4 : 0;
    gained += fresh;
    if (item.kind === 'fact') { const a = area(item.category); a.points += value; a.week += fresh; a.facts++; }
  }
  for (const topic of memory.topics) { const a = area(topic.area); a.points += 15; xp += 15; if (recent(topic.created)) { a.week += 15; gained += 15; } }
  for (const e of memory.episodes) { xp += 5; if (recent(e.date)) gained += 5; }
  for (const e of memory.entities) { xp += 6; if (recent(e.created)) gained += 6; }
  xp += memory.edges.length + (memory.understanding ? 30 : 0);
  const scores = (from: number, to: number) => memory.episodes.filter(e => e.score && Date.parse(e.date) >= from && Date.parse(e.date) < to).map(e => e.score!);
  const average = (list: number[]) => list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length * 10) / 10 : null;
  const thisWeek = scores(week, Infinity), lastWeek = scores(fortnight, week);
  const self = levelOf(xp);
  return {
    xp, ...self, name: LEVELS[Math.min(self.level, LEVELS.length) - 1],
    week: {
      xp: gained,
      facts: memory.items.filter(i => i.kind === 'fact' && recent(i.created)).length,
      rules: memory.items.filter(i => i.kind === 'rule' && recent(i.created)).length,
      lessons: memory.items.filter(i => i.source === 'review' && recent(i.created)).length,
      episodes: memory.episodes.filter(e => recent(e.date)).length,
      entities: memory.entities.filter(e => recent(e.created)).length,
      topics: memory.topics.filter(t => recent(t.created)).length,
    },
    quality: { average: average(thisWeek), reviewed: thisWeek.length, previous: average(lastWeek) },
    skills: [...areas].filter(([, a]) => a.points > 0).map(([key, a]) => ({ area: key, points: a.points, week: a.week, facts: a.facts, ...levelOf(a.points, 40),
      topics: memory.topics.filter(t => t.area === key).map(t => ({ id: t.id, title: t.title })) })).sort((a, b) => b.points - a.points),
  };
}
