import type { Memory, Category, Reasoning } from './memory.ts';
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

export const LOGIC_LEVELS = ['Наблюдаю', 'Замечаю связи', 'Строю догадки', 'Рассуждаю', 'Предвижу', 'Вижу насквозь'];
const KINDS: Reasoning[] = ['pattern', 'cause', 'habit', 'plan', 'analogy'];
// The logic level: how often her predictions come true, how many of her conclusions held, and how many errors she turned into rules.
export function logic(memory: Memory, now = Date.now()) {
  const recent = (date: string | null) => !!date && Date.parse(date) >= now - 7 * DAY;
  const checked = memory.predictions.filter(p => p.outcome && (p.verification==='user'||p.verification==='evidence')), right = checked.filter(p => p.outcome === 'right');
  // A conclusion is a checked prediction or a cause-and-effect link that came up again.
  const confirmed = 0; // Repeated cause assertions are hypotheses, never checked conclusions.
  const fixed = memory.mistakes.filter(m => m.rule).length;
  const points = right.length * 20; // Practice and volume are reported separately from correctness.
  const level = levelOf(points, 60);
  return {
    activity: { records:memory.items.length, thoughts:memory.thoughts.length, hypotheses:memory.causes.length, goals:memory.goals.length },
    quality:{sample:checked.length,brier:checked.length ? Math.round(checked.reduce((sum,p)=>sum+(p.confidence/100-(p.outcome==='right'?1:0))**2,0)/checked.length*1000)/1000:null, independent:false},
    points, ...level, name: checked.length ? 'Практика проверенных прогнозов' : 'Проверенных результатов пока нет',
    predictions: { made: memory.predictions.length, open: memory.predictions.filter(p=>!p.outcome).length, checked: checked.length, right: right.length, accuracy: checked.length ? Math.round(right.length / checked.length * 100) : null },
    conclusions: { right: right.length + confirmed, total: checked.length + confirmed, share: checked.length + confirmed ? Math.round((right.length + confirmed) / (checked.length + confirmed) * 100) : null },
    corrections: memory.mistakes.length, fixed, causes: memory.causes.length, goals: memory.goals.filter(g => !g.done).length,
    week: { predictions: memory.predictions.filter(p => recent(p.created)).length, checked: checked.filter(p => recent(p.checked)).length, right: right.filter(p => recent(p.checked)).length, corrections: memory.mistakes.filter(m => recent(m.at)).length },
    kinds: KINDS.map(kind => { const done = checked.filter(p => p.kind === kind); return { kind, checked: done.length, right: done.filter(p => p.outcome === 'right').length }; }).filter(k => k.checked),
  };
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
  const reasoning = logic(memory, now);
  xp += reasoning.points;
  const self = levelOf(xp);
  return {
    logic: reasoning, xp, ...self, name: LEVELS[Math.min(self.level, LEVELS.length) - 1],
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
