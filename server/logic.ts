// Strong logic: which questions deserve a reasoning plan and the stronger model, and exact numbers counted by code,
// so sums, percents, dates and deadlines in an answer are never guessed by the model.
const DAY = 86_400_000;

// A question is complex when it asks why, what to choose, how to plan, or to count; long and multi-part questions too.
const HARD = /(?:почему|зачем|из-за\s+чего|отчего|как\s+(?:лучше|быть|сделать|спланировать|выбрать|решить|успеть|распределить|построить)|что\s+(?:лучше|выбрать|делать|будет,?\s+если|если)|стоит\s+ли|сравни|проанализ|анализ|разбер|обоснуй|докажи|посчитай|рассчитай|вычисли|сколько\s+(?:будет|стоит|выйдет|получится|нужно|надо|дней|недель|месяцев|осталось|времени|денег)|спланир|составь\s+план|стратеги|причин|последстви|вывод|логик|вероятн|прогноз|оцени|взвес|плюсы\s+и\s+минусы|за\s+и\s+против|приоритет|разложи|декомпоз)/i;
export function complexity(text: string) {
  const t = text.trim();
  const reasons: string[] = [];
  if (HARD.test(t) && t.length >= 20) reasons.push('нужно рассуждение');
  if (t.length > 500) reasons.push('длинный вопрос');
  if ((t.match(/\?/g) || []).length >= 2 && t.length > 80) reasons.push('несколько вопросов');
  if ((t.match(/\d+(?:[.,]\d+)?/g) || []).length >= 3 && /[-+*/×÷%^]|сколько|итого|сумм/i.test(t)) reasons.push('расчёты');
  return { complex: reasons.length > 0, reasons };
}

// A small calculator without eval: numbers, + - * / ^, percents and parentheses.
// «a + b%» and «a - b%» change a by b percent, as on a pocket calculator; elsewhere b% is b/100.
type Token = { kind: 'num'; value: number; percent: boolean } | { kind: 'op'; value: string };
function lex(expr: string): Token[] | null {
  const out: Token[] = [];
  const s = expr.replace(/[×xхХ]/g, '*').replace(/[÷:]/g, '/').replace(/[−–—]/g, '-').replace(/\*\*/g, '^');
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    const number = /^\d+(?:[  ]\d{3})*(?:[.,]\d+)?/.exec(s.slice(i));
    if (number) {
      i += number[0].length;
      let percent = false;
      while (s[i] === ' ') i++;
      if (s[i] === '%') { percent = true; i++; }
      out.push({ kind: 'num', value: Number(number[0].replace(/[  ]/g, '').replace(',', '.')), percent });
      continue;
    }
    if ('+-*/^()'.includes(c)) { out.push({ kind: 'op', value: c }); i++; continue; }
    return null;
  }
  return out;
}
export function calculate(expr: string): number | null {
  const lexed = lex(expr);
  if (!lexed || !lexed.length || lexed.length > 200) return null;
  const tokens = lexed;
  let at = 0;
  const peek = () => tokens[at];
  const isOp = (value: string) => { const t = peek(); return t?.kind === 'op' && t.value === value; };
  // Each level returns the value and whether it was a bare percent literal.
  function primary(): [number, boolean] {
    const t = tokens[at++];
    if (!t) throw new Error('end');
    if (t.kind === 'num') return [t.percent ? t.value / 100 : t.value, t.percent];
    if (t.value === '(') { const [v] = sum(); if (!isOp(')')) throw new Error('paren'); at++; return [v, false]; }
    if (t.value === '-') { const [v] = power(); return [-v, false]; }
    if (t.value === '+') return power();
    throw new Error('token');
  }
  function power(): [number, boolean] {
    const [base, percent] = primary();
    if (!isOp('^')) return [base, percent];
    at++;
    const [exp] = power();
    return [base ** exp, false];
  }
  function product(): [number, boolean] {
    let [v, percent] = power();
    while (isOp('*') || isOp('/')) {
      const op = (tokens[at++] as { value: string }).value;
      const [r] = power();
      v = op === '*' ? v * r : v / r; percent = false;
    }
    return [v, percent];
  }
  function sum(): [number, boolean] {
    let [v, percent] = product();
    while (isOp('+') || isOp('-')) {
      const op = (tokens[at++] as { value: string }).value;
      const [r, rp] = product();
      const delta = rp ? v * r : r;
      v = op === '+' ? v + delta : v - delta; percent = false;
    }
    return [v, percent];
  }
  try {
    const [value] = sum();
    return at === tokens.length && Number.isFinite(value) ? value : null;
  } catch { return null; }
}
export const formatNumber = (n: number) => Math.abs(n) >= 1e15 ? n.toExponential(6) : n.toLocaleString('ru-RU', { maximumFractionDigits: 6 }).replace(/ /g, ' ');

// Dates are counted in the user's local calendar: midnight to midnight, so a summer-time switch does not shift a day.
const MONTHS = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
const MONTH_WORD = String.raw`(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)`;
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const valid = (d: Date, day: number) => d.getDate() === day ? d : null;
export function parseDate(text: string, now = Date.now()): Date | null {
  const t = text.trim().toLocaleLowerCase('ru');
  const today = midnight(new Date(now));
  if (/^сегодня/.test(t)) return today;
  if (/^завтра/.test(t)) return new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (/^послезавтра/.test(t)) return new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2);
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return valid(new Date(+m[1], +m[2] - 1, +m[3]), +m[3]);
  // Without a year a date means the nearest such day from today on.
  const future = (month: number, day: number, year?: number) => {
    if (year !== undefined) return valid(new Date(year < 100 ? 2000 + year : year, month, day), day);
    const d = valid(new Date(today.getFullYear(), month, day), day);
    return d && d < today ? valid(new Date(today.getFullYear() + 1, month, day), day) : d;
  };
  m = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/.exec(t);
  if (m) return future(+m[2] - 1, +m[1], m[3] ? +m[3] : undefined);
  m = new RegExp(String.raw`^(\d{1,2})\s+(${MONTH_WORD})(?:\s+(\d{4}))?`).exec(t);
  if (m) return future(MONTHS.findIndex(x => m![2].startsWith(x) && (x !== 'ма' || m![2] === 'мая')), +m[1], m[3] ? +m[3] : undefined);
  return null;
}
const DATE = String.raw`(?:\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}(?:\.\d{2,4})?|\d{1,2}\s+${MONTH_WORD}(?:\s+\d{4})?|сегодня|послезавтра|завтра)`;
export const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const dateName = (d: Date) => `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).replace(/\s*г\.$/, '')} (${WEEKDAYS[d.getDay()]})`;
export const daysBetween = (a: Date, b: Date) => Math.round((midnight(b).getTime() - midnight(a).getTime()) / DAY);
export function workdays(a: Date, b: Date) {
  const [from, to] = a <= b ? [midnight(a), midnight(b)] : [midnight(b), midnight(a)];
  let n = 0;
  // Counts the days after the start up to and including the end, like «сколько рабочих дней до пятницы».
  for (let d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1); d <= to; d.setDate(d.getDate() + 1)) if (d.getDay() % 6 !== 0) n++;
  return a <= b ? n : -n;
}
const plural = (n: number, one: string, few: string, many: string) => { const a = Math.abs(n); return `${formatNumber(n)} ${a % 10 === 1 && a % 100 !== 11 ? one : a % 10 >= 2 && a % 10 <= 4 && (a % 100 < 10 || a % 100 >= 20) ? few : many}`; };
const days = (n: number) => plural(n, 'день', 'дня', 'дней');

// A calculation the planner asks for; the code does it and returns one line for the answer.
export type Calc = { op?: unknown; expr?: unknown; from?: unknown; to?: unknown; date?: unknown; days?: unknown };
export function runCalc(calc: Calc, now = Date.now()): string | null {
  const date = (value: unknown) => typeof value === 'string' ? parseDate(value, now) : null;
  if (calc.op === 'math' && typeof calc.expr === 'string' && calc.expr.length <= 300) {
    const value = calculate(calc.expr);
    return value === null ? null : `${calc.expr.trim()} = ${formatNumber(value)}`;
  }
  if (calc.op === 'days' || calc.op === 'workdays') {
    const a = date(calc.from), b = date(calc.to);
    if (!a || !b) return null;
    return calc.op === 'days' ? `От ${dateName(a)} до ${dateName(b)}: ${days(daysBetween(a, b))}` : `Рабочих дней (пн–пт) от ${dateName(a)} до ${dateName(b)}: ${formatNumber(workdays(a, b))}`;
  }
  if (calc.op === 'add') {
    const a = date(calc.date), n = typeof calc.days === 'number' ? calc.days : Number(calc.days);
    if (!a || !Number.isInteger(n) || Math.abs(n) > 100_000) return null;
    return `${dateName(a)} ${n >= 0 ? '+' : '−'} ${days(Math.abs(n))} = ${dateName(new Date(a.getFullYear(), a.getMonth(), a.getDate() + n))}`;
  }
  if (calc.op === 'weekday') { const a = date(calc.date); return a ? `${isoDate(a)} — ${WEEKDAYS[a.getDay()]}` : null; }
  return null;
}

// Calculations the code sees in the message itself, without asking the model: arithmetic, percent of, dates and deadlines.
const NUM = String.raw`\d+(?:[  ]\d{3})*(?:[.,]\d+)?`;
const EXPRESSION = new RegExp(String.raw`[(\s]*-?${NUM}\s*%?[)\s]*(?:(?:[-+*/×÷^]|\s[xх]\s|(?<=\d)[xх](?=\s*\d))[(\s]*-?${NUM}\s*%?[)\s]*)+`, 'g');
export function exactCalcs(text: string, now = Date.now()) {
  const out: string[] = [];
  const t = text.toLocaleLowerCase('ru').replaceAll('ё', 'е');
  const today = midnight(new Date(now));
  for (const m of t.matchAll(new RegExp(String.raw`(${NUM})\s*%\s+от\s+(${NUM})`, 'g'))) {
    const p = calculate(m[1]), base = calculate(m[2]);
    if (p !== null && base !== null) out.push(`${m[1]}% от ${m[2]} = ${formatNumber(base * p / 100)}`);
  }
  // Dates written with dashes or dots are not subtraction or division.
  const masked = t.replace(/\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{2,4}|\d{1,2}:\d{2}|\+?\d[\d\s()-]{9,}\d/g, m => ' '.repeat(m.length));
  for (const m of masked.matchAll(EXPRESSION)) {
    const expr = m[0].trim();
    if (!/[-+*/×÷^xх]/.test(expr.replace(/^-/, '')) || /^\d+\s*-\s*\d+$/.test(expr) && !/\s-\s/.test(expr)) continue;
    const value = calculate(expr);
    if (value !== null && !out.some(line => line.startsWith(expr + ' ='))) out.push(`${expr} = ${formatNumber(value)}`);
  }
  const found = [...t.matchAll(new RegExp(DATE, 'g'))].map(m => parseDate(m[0], now)).filter((d): d is Date => !!d);
  if (/сколько\s+(?:\S+\s+){0,2}(?:рабочих\s+)?(?:дней|день|дня|недел)|через\s+сколько|до\s+(?:дедлайна|срока)|сколько\s+осталось/.test(t) && found.length) {
    const [a, b] = found.length >= 2 ? [found[0], found[1]] : [today, found[0]];
    const n = daysBetween(a, b);
    out.push(`От ${dateName(a)} до ${dateName(b)}: ${days(n)}${Math.abs(n) >= 14 ? ` (≈ ${formatNumber(Math.round(n / 7 * 10) / 10)} нед.)` : ''}`);
    if (/рабоч/.test(t)) out.push(`Из них рабочих (пн–пт): ${formatNumber(workdays(a, b))}`);
  }
  for (const m of t.matchAll(/через\s+(\d+)\s+(дн|день|недел|месяц)/g)) {
    const n = Number(m[1]);
    const d = m[2] === 'месяц' ? new Date(today.getFullYear(), today.getMonth() + n, today.getDate()) : new Date(today.getFullYear(), today.getMonth(), today.getDate() + n * (m[2].startsWith('недел') ? 7 : 1));
    out.push(`Сегодня ${dateName(today)}; через ${m[1]} ${m[2].startsWith('недел') ? 'нед.' : m[2] === 'месяц' ? 'мес.' : 'дн.'} будет ${dateName(d)}`);
  }
  if (/какой\s+(?:это\s+|будет\s+)?день\s+недели|в\s+какой\s+день\s+недели/.test(t)) for (const d of found.slice(0, 3)) out.push(`${isoDate(d)} — ${WEEKDAYS[d.getDay()]}`);
  return out.slice(0, 8);
}

export const PLAN_PROMPT = `Ты — внутренний планировщик рассуждений помощницы Миюнэи. Пользователь задал сложный вопрос. Отвечать ему не нужно: составь скрытый план рассуждения. Верни только JSON без пояснений:
{"steps":["шаг рассуждения"],"hypotheses":[{"text":"возможное объяснение или исход","confidence":60}],"calc":[{"op":"math","expr":"1200*3+15%"}],"check":"главная ловушка"}
steps — 2–6 коротких шагов: что выяснить, что учесть из памяти о пользователе, какие причины и следствия связать, к какому выводу прийти.
hypotheses — только если у вопроса правда несколько возможных объяснений, причин или исходов: 2–3 гипотезы с уверенностью в процентах, в сумме около 100. Иначе пустой массив.
calc — всё, что нужно точно посчитать: суммы, проценты, даты, сроки. Не считай сам — опиши расчёт, его выполнит код. op: math (expr — арифметика: + - * / ^ %, скобки), days (from, to — ГГГГ-ММ-ДД: сколько дней), workdays (from, to: рабочие дни), add (date — ГГГГ-ММ-ДД, days — число: какая дата будет), weekday (date).
check — что легко упустить или перепутать в этом вопросе, одной фразой.`;
export type Plan = { steps: string[]; hypotheses: { text: string; confidence: number }[]; lines: string[]; check: string };
const clip = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
export function readPlan(result: any, now = Date.now()): Plan | null {
  if (!result || typeof result !== 'object') return null;
  const array = (value: unknown) => Array.isArray(value) ? value : [];
  const steps = array(result.steps).map(s => clip(s, 200)).filter(Boolean).slice(0, 6);
  const hypotheses = array(result.hypotheses).map(h => ({ text: clip(h?.text, 200), confidence: (n => Math.round(Math.min(100, Math.max(0, n > 0 && n <= 1 ? n * 100 : n))))(Number(h?.confidence) || 0) })).filter(h => h.text).slice(0, 3);
  const lines = array(result.calc).filter(c => c && typeof c === 'object').slice(0, 8).map(c => runCalc(c, now)).filter((l): l is string => !!l);
  const check = clip(result.check, 200);
  return steps.length || hypotheses.length || lines.length || check ? { steps, hypotheses, lines, check } : null;
}
// What the answering model is told: think step by step, weigh hypotheses, and take numbers from the code.
export const exactLines = (plan: Plan | null, calcs: string[]) => [...new Set([...calcs, ...(plan?.lines || [])])];
export function reasoningBlock(complex: boolean, plan: Plan | null, calcs: string[]) {
  const lines: string[] = [];
  if (complex) {
    lines.push('Вопрос требует рассуждения. Подумай по шагам, проверь каждый вывод, но пользователю дай ясный итог; ход рассуждения показывай, только если он помогает понять ответ.',
      'Если у вопроса несколько возможных объяснений или исходов, назови 2–3 гипотезы с уверенностью в процентах и скажи, что помогло бы различить их. Опирайся на причины и следствия из памяти о пользователе.');
    if (plan?.steps.length) lines.push('Твой скрытый план рассуждения (не пересказывай его как план):', ...plan.steps.map((s, i) => `${i + 1}. ${s}`));
    if (plan?.hypotheses.length) lines.push('Гипотезы, которые стоит взвесить:', ...plan.hypotheses.map(h => `- ${h.text} — ${h.confidence}%`));
    if (plan?.check) lines.push('Проверь перед ответом: ' + plan.check);
  }
  const exact = exactLines(plan, calcs);
  if (exact.length) lines.push('Точные расчёты, сделанные кодом. Используй эти числа как есть и не пересчитывай в уме:', ...exact.map(l => '- ' + l));
  return lines.join('\n');
}

// «Разложи цель …», «разбей на шаги …», «составь план для цели …».
const DECOMPOSE = /(?:разложи|разбей|распиши|декомпозируй|составь\s+(?:мне\s+)?план|спланируй)/i;
export function parseGoal(text: string) {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!DECOMPOSE.test(t) || !/(?:цел[ьиюей]|на\s+(?:шаги|подзадачи|этапы))/i.test(t) || t.length > 300) return null;
  const after = /цел[ьиюей]\s*[:—-]?\s*(.+)$/i.exec(t);
  let title = after ? after[1] : t.replace(new RegExp(String.raw`^.*?${DECOMPOSE.source}\s*(?:мне\s+|пожалуйста\s+)*(?:для\s+)?`, 'i'), '');
  title = title.replace(/^на\s+(?:шаги|подзадачи|этапы)\s*/i, '').replace(/\s*на\s+(?:шаги|подзадачи|этапы).*$/i, '').replace(/^[«"'\s:—-]+|[»"'\s.!?]+$/g, '');
  return title.length >= 3 ? title.slice(0, 200) : null;
}
export const GOAL_PROMPT = `Ты — модуль планирования помощницы Миюнэи. Разложи цель пользователя на дерево подзадач с зависимостями. Верни только JSON без пояснений:
{"title":"цель коротко","steps":[{"id":"s1","text":"подзадача","parent":null,"after":[]},{"id":"s2","text":"подзадача поменьше","parent":"s1","after":[]},{"id":"s3","text":"следующая","parent":null,"after":["s1"]}]}
5–12 подзадач, каждая — конкретное действие в несколько слов. parent — id более крупной подзадачи, в которую входит эта (так получается дерево, не глубже трёх уровней). after — id подзадач, которые нужно закончить раньше (только из уже перечисленных выше, без циклов). Учитывай, что ты знаешь о пользователе. Не выдумывай сроков и фактов.`;
