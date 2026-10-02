// Hisobotlar: kunlik / haftalik / oylik bajarilish, qolib ketganlar, faollik va o'sish dinamikasi.
//
// Asosiy tushuncha — "bajarilishi kerak bo'lgan holat" (occurrence):
//   kunlik   → har kun uchun bittadan, muddati — o'sha kun;
//   haftalik → har hafta uchun bittadan, muddati — hafta yakshanbasi;
//   oylik    → har oy uchun bittadan, muddati — oyning oxirgi kuni;
//   doimiy   → bitta; muddati — deadline kuni (deadline bo'lmasa, bajarilgan kuni).
// Muddati hisobot oralig'iga tushgan holatlar hisoblanadi. Holat: done | missed | pending.

import * as T from './time.js';

const PERIODS = ['day', 'week', 'month'];
const TREND_LENGTH = { day: 14, week: 8, month: 6 };
const IMPORTANCE_GROUPS = [
  { key: '10', label: '10★', min: 10, max: 10 },
  { key: '8-9', label: '8–9★', min: 8, max: 9 },
  { key: '5-7', label: '5–7★', min: 5, max: 7 },
  { key: '1-4', label: '1–4★', min: 1, max: 4 },
];

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function periodRange(period, today, offset) {
  if (period === 'day') {
    const d = T.addDays(today, offset);
    const name = offset === 0 ? 'Bugun' : offset === -1 ? 'Kecha' : capitalize(T.WEEKDAY_NAMES[T.weekdayOf(d)]);
    return { start: d, end: d, label: name, sublabel: `${T.dayLabel(d)}, ${T.WEEKDAY_NAMES[T.weekdayOf(d)]}` };
  }
  if (period === 'week') {
    const start = T.addDays(T.mondayOf(today), 7 * offset);
    const end = T.addDays(start, 6);
    const name = offset === 0 ? 'Shu hafta' : offset === -1 ? "O'tgan hafta" : `${T.dayLabel(start)} haftasi`;
    return { start, end, label: name, sublabel: `${T.dayLabel(start)} – ${T.dayLabel(end)}` };
  }
  const start = T.addMonths(T.monthStart(today), offset);
  const end = T.monthEnd(start);
  const monthName = capitalize(T.MONTHS[Number(start.slice(5, 7)) - 1]);
  const name = offset === 0 ? 'Shu oy' : offset === -1 ? "O'tgan oy" : monthName;
  return { start, end, label: name, sublabel: `${monthName} ${start.slice(0, 4)}` };
}

function makeContext(tasks, completions, now, tz) {
  const comps = new Map(completions.map((c) => [`${c.task_id}|${c.period_key}`, c]));
  const meta = new Map(tasks.map((t) => [t.id, {
    created: T.localDate(t.created_at, tz),
    deleted: t.deleted_at ? T.localDate(t.deleted_at, tz) : null,
    deadlineDay: t.deadline ? T.localDate(t.deadline, tz) : null,
  }]));
  return { tasks, completions, comps, meta, now, tz, today: T.localDate(now, tz) };
}

function occurrencesFor(task, start, end, ctx) {
  const { today, now, tz, comps } = ctx;
  const { created, deleted, deadlineDay } = ctx.meta.get(task.id);
  const out = [];

  const push = (due, key) => {
    const c = comps.get(`${task.id}|${key}`);
    // Muddatidan oldin o'chirilgan va bajarilmagan vazifa "qolib ketgan" hisoblanmaydi.
    if (!c && deleted && deleted <= due) return;
    let status = 'done';
    if (!c) {
      if (task.type === 'doimiy' && task.deadline) status = new Date(task.deadline) < now ? 'missed' : 'pending';
      else status = due < today ? 'missed' : 'pending';
    }
    out.push({ task, due, key, status, completed_at: c ? c.completed_at : null });
  };

  if (task.type === 'kunlik') {
    const from = start > created ? start : created;
    const to = end < today ? end : today;
    for (let d = from; d <= to; d = T.addDays(d, 1)) push(d, `D${d}`);
  } else if (task.type === 'haftalik') {
    for (let m = T.mondayOf(start); m <= end; m = T.addDays(m, 7)) {
      const sunday = T.addDays(m, 6);
      if (sunday < start || sunday > end || m > today || created > sunday) continue;
      push(sunday, `W${m}`);
    }
  } else if (task.type === 'oylik') {
    for (let f = T.monthStart(start); f <= end; f = T.addMonths(f, 1)) {
      const last = T.monthEnd(f);
      if (last < start || last > end || f > today || created > last) continue;
      push(last, `M${f.slice(0, 7)}`);
    }
  } else {
    const c = comps.get(`${task.id}|ONCE`);
    const due = deadlineDay || (c ? T.localDate(c.completed_at, tz) : null);
    if (due && due >= start && due <= end) push(due, 'ONCE');
  }
  return out;
}

function collect(ctx, start, end) {
  return ctx.tasks.flatMap((t) => occurrencesFor(t, start, end, ctx));
}

function summarize(occs) {
  const done = occs.filter((o) => o.status === 'done').length;
  const missed = occs.filter((o) => o.status === 'missed').length;
  const pending = occs.length - done - missed;
  return {
    expected: occs.length,
    done,
    missed,
    pending,
    rate: occs.length ? Math.round((done / occs.length) * 100) : null,
  };
}

function occurrenceItem(o, tz) {
  return {
    id: o.task.id,
    title: o.task.title,
    importance: o.task.importance,
    type: o.task.type,
    due: o.due,
    due_label: T.dayShortLabel(o.due),
    completed_at: o.completed_at ? new Date(o.completed_at).toISOString() : null,
    completed_label: o.completed_at ? T.formatLocal(new Date(o.completed_at), tz) : null,
    deleted: Boolean(o.task.deleted_at),
  };
}

const byImportance = (a, b) => b.importance - a.importance || (a.due < b.due ? 1 : -1);

// Faollik: shu oraliqda NECHTA vazifa bajarilgan (bajarilgan vaqti bo'yicha).
function activity(ctx, period, range) {
  const { tz, today, now } = ctx;
  const inRange = ctx.completions
    .map((c) => ({ c, parts: T.localParts(new Date(c.completed_at), tz) }))
    .filter(({ parts }) => parts.date >= range.start && parts.date <= range.end);

  if (period === 'day') {
    const nowHour = range.start === today ? T.localParts(now, tz).hour : 23;
    return Array.from({ length: 24 }, (_, h) => ({
      key: String(h),
      label: String(h).padStart(2, '0'),
      value: inRange.filter(({ parts }) => parts.hour === h).length,
      future: range.start > today || (range.start === today && h > nowHour),
    }));
  }
  const days = T.daysBetween(range.start, range.end) + 1;
  return Array.from({ length: days }, (_, i) => {
    const d = T.addDays(range.start, i);
    return {
      key: d,
      label: period === 'week' ? T.WEEKDAY_SHORT[i] : String(Number(d.slice(8, 10))),
      full_label: T.dayShortLabel(d),
      value: inRange.filter(({ parts }) => parts.date === d).length,
      future: d > today,
    };
  });
}

function trend(ctx, period, offset) {
  const points = [];
  for (let i = TREND_LENGTH[period] - 1; i >= 0; i -= 1) {
    const r = periodRange(period, ctx.today, offset - i);
    const s = summarize(collect(ctx, r.start, r.end));
    let label;
    if (period === 'day') label = String(Number(r.start.slice(8, 10)));
    else if (period === 'week') label = `${Number(r.start.slice(8, 10))}-${T.MONTHS_SHORT[Number(r.start.slice(5, 7)) - 1]}`;
    else label = capitalize(T.MONTHS_SHORT[Number(r.start.slice(5, 7)) - 1]);
    points.push({ label, full_label: `${r.label} (${r.sublabel})`, rate: s.rate, done: s.done, expected: s.expected, current: i === 0 });
  }
  return points;
}

// Ketma-ket kunlar: barcha "shu kungi" vazifalar 100% bajarilgan kunlar soni.
// Vazifasi yo'q kunlar zanjirni uzmaydi; bugun hali tugamagan bo'lsa, u ham uzmaydi.
function streak(ctx) {
  if (ctx.tasks.length === 0) return 0;
  const earliest = ctx.tasks.reduce((min, t) => {
    const c = ctx.meta.get(t.id).created;
    return c < min ? c : min;
  }, ctx.today);
  let count = 0;
  for (let d = ctx.today, i = 0; d >= earliest && i < 400; d = T.addDays(d, -1), i += 1) {
    const s = summarize(collect(ctx, d, d));
    if (s.expected === 0) continue;
    if (s.done === s.expected) count += 1;
    else if (d === ctx.today) continue;
    else break;
  }
  return count;
}

// Kun hisobotida: muddati bugun bo'lmagan, lekin joriy hafta/oyda hali bajarilmagan vazifalar.
function upcomingForDay(ctx) {
  const keys = T.currentKeys(ctx.now, ctx.tz);
  return ctx.tasks
    .filter((t) => !t.deleted_at && t.type !== 'kunlik')
    .filter((t) => !ctx.comps.has(`${t.id}|${keys[t.type]}`))
    .filter((t) => {
      const { deadlineDay } = ctx.meta.get(t.id);
      if (t.type === 'doimiy') return !deadlineDay || deadlineDay > ctx.today;
      if (t.type === 'haftalik') return T.addDays(T.mondayOf(ctx.today), 6) !== ctx.today;
      return T.monthEnd(ctx.today) !== ctx.today;
    })
    .sort((a, b) => b.importance - a.importance)
    .map((t) => ({ id: t.id, title: t.title, importance: t.importance, type: t.type }));
}

function buildReport({ tasks, completions, period = 'day', offset = 0, now = new Date(), tz }) {
  if (!PERIODS.includes(period)) throw new Error(`Noma'lum davr: ${period}`);
  const ctx = makeContext(tasks, completions, now, tz);
  const range = periodRange(period, ctx.today, offset);
  const occs = collect(ctx, range.start, range.end);
  const summary = summarize(occs);
  const prevRange = periodRange(period, ctx.today, offset - 1);
  const prev = summarize(collect(ctx, prevRange.start, prevRange.end));

  const byType = Object.fromEntries(T.TASK_TYPES.map((type) => [type, summarize(occs.filter((o) => o.task.type === type))]));
  const importance = IMPORTANCE_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    ...summarize(occs.filter((o) => o.task.importance >= g.min && o.task.importance <= g.max)),
  }));

  return {
    period,
    offset,
    range: { start: range.start, end: range.end, label: range.label, sublabel: range.sublabel },
    is_current: offset === 0,
    summary: {
      ...summary,
      prev_rate: prev.rate,
      delta: summary.rate !== null && prev.rate !== null ? summary.rate - prev.rate : null,
    },
    by_type: byType,
    by_importance: importance,
    activity: activity(ctx, period, range),
    trend: trend(ctx, period, offset),
    streak: offset === 0 ? streak(ctx) : null,
    missed: occs.filter((o) => o.status === 'missed').sort(byImportance).map((o) => occurrenceItem(o, ctx.tz)),
    pending: occs.filter((o) => o.status === 'pending').sort(byImportance).map((o) => occurrenceItem(o, ctx.tz)),
    done: occs.filter((o) => o.status === 'done')
      .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))
      .map((o) => occurrenceItem(o, ctx.tz)),
    upcoming: period === 'day' && offset === 0 ? upcomingForDay(ctx) : [],
  };
}

export { buildReport, periodRange, PERIODS };
