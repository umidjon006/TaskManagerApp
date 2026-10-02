import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, periodRange } from '../../src/core/reports.js';

// Toshkent vaqti (UTC+5) bo'yicha sana: at('2026-09-29T10:00:00') → o'sha lahzaning Date'i.
const at = (localIso) => new Date(new Date(`${localIso}Z`).getTime() - 5 * 3600 * 1000);

const TZ = 'Asia/Tashkent';
// "Hozir": 2026-10-01 (payshanba) 15:00 Toshkent. Hafta: 28-sen (Du) – 4-okt (Ya).
const NOW = at('2026-10-01T15:00:00');

let nextId = 1;
function task(fields) {
  return {
    id: nextId++, title: 'T', description: '', type: 'doimiy', importance: 5, deadline: null,
    created_at: at('2026-09-01T09:00:00'), deleted_at: null, ...fields,
  };
}
const done = (t, key, when) => ({ task_id: t.id, period_key: key, completed_at: at(when) });
const report = (tasks, completions, period, offset = 0, now = NOW) => buildReport({ tasks, completions, period, offset, now, tz: TZ });

test('periodRange: kun, hafta, oy va nomlari', () => {
  assert.deepEqual(periodRange('day', '2026-10-01', 0), { start: '2026-10-01', end: '2026-10-01', label: 'Bugun', sublabel: '1-oktabr, payshanba' });
  assert.equal(periodRange('day', '2026-10-01', -1).label, 'Kecha');
  const w = periodRange('week', '2026-10-01', 0);
  assert.deepEqual([w.start, w.end, w.label], ['2026-09-28', '2026-10-04', 'Shu hafta']);
  assert.equal(periodRange('week', '2026-10-01', -1).start, '2026-09-21');
  const m = periodRange('month', '2026-10-01', -1);
  assert.deepEqual([m.start, m.end, m.label, m.sublabel], ['2026-09-01', '2026-09-30', "O'tgan oy", 'Sentabr 2026']);
});

test('kunlik vazifa: haftada har kun uchun bittadan, kelajak kunlar hisoblanmaydi', () => {
  const sport = task({ title: 'Sport', type: 'kunlik', importance: 9 });
  const r = report([sport], [
    done(sport, 'D2026-09-28', '2026-09-28T07:10:00'),
    done(sport, 'D2026-09-30', '2026-09-30T07:05:00'),
  ], 'week');
  // Du ✓, Se ✗ (o'tgan), Ch ✓, Pa (bugun) — kutilmoqda; Ju–Ya — hali kelmagan
  assert.deepEqual(
    { e: r.summary.expected, d: r.summary.done, m: r.summary.missed, p: r.summary.pending, rate: r.summary.rate },
    { e: 4, d: 2, m: 1, p: 1, rate: 50 },
  );
  assert.equal(r.missed[0].due, '2026-09-29');
  assert.equal(r.missed[0].due_label, 'Se, 29-sen');
  assert.equal(r.pending[0].due, '2026-10-01');
  assert.deepEqual(r.activity.map((a) => a.value), [1, 0, 1, 0, 0, 0, 0]);
  assert.deepEqual(r.activity.map((a) => a.future), [false, false, false, false, true, true, true]);
});

test("haftalik vazifa muddati — yakshanba; oylik — oy oxiri; doimiy — deadline kuni", () => {
  const weekly = task({ title: 'Reja', type: 'haftalik', importance: 6 });
  const monthly = task({ title: 'Kommunal', type: 'oylik', importance: 8 });
  const once = task({ title: 'Soliq', type: 'doimiy', importance: 10, deadline: at('2026-09-25T18:00:00') });
  const tasks = [weekly, monthly, once];

  const lastWeek = report(tasks, [done(weekly, 'W2026-09-21', '2026-09-23T10:00:00')], 'week', -1);
  assert.equal(lastWeek.summary.expected, 2, "haftalik (27-sen) + doimiy (25-sen)");
  assert.equal(lastWeek.summary.done, 1);
  assert.equal(lastWeek.missed[0].title, 'Soliq');
  assert.equal(lastWeek.missed[0].importance, 10);

  const sept = report(tasks, [done(monthly, 'M2026-09', '2026-09-05T12:00:00')], 'month', -1);
  // Sentabr: 4 ta haftalik (yakshanbalari 6, 13, 20, 27) + oylik + doimiy = 6
  assert.equal(sept.summary.expected, 6);
  assert.equal(sept.by_type.oylik.done, 1);
  assert.equal(sept.by_type.haftalik.missed, 4);
  assert.equal(sept.by_importance.find((g) => g.key === '10').missed, 1);

  const thisWeek = report(tasks, [], 'week');
  assert.equal(thisWeek.summary.pending, 1, 'shu haftalik vazifa yakshanbagacha kutilmoqda');
  assert.deepEqual(thisWeek.missed.map((o) => `${o.title}@${o.due}`), ['Kommunal@2026-09-30'],
    "sentabr oylik vazifasining muddati (30-sen) shu haftaga tushadi");
});

test("yaratilishidan oldingi va o'chirilgandan keyingi davrlar hisoblanmaydi", () => {
  const newer = task({ title: 'Yangi', type: 'kunlik', created_at: at('2026-09-30T20:00:00') });
  const removed = task({ title: "O'chirilgan", type: 'kunlik', deleted_at: at('2026-09-29T12:00:00') });
  const r = report([newer, removed], [done(removed, 'D2026-09-28', '2026-09-28T08:00:00')], 'week');
  const titles = [...r.missed, ...r.pending, ...r.done].map((o) => `${o.title}@${o.due}`).sort();
  assert.deepEqual(titles, [
    "O'chirilgan@2026-09-28",
    'Yangi@2026-09-30',
    'Yangi@2026-10-01',
  ]);
  assert.equal(r.done[0].deleted, true, "o'chirilgan vazifaning tarixi saqlanadi");
});

test("o'tgan davr bilan solishtirish (delta) va trend uzunligi", () => {
  const t = task({ type: 'kunlik' });
  const completions = [];
  // O'tgan hafta 7 kundan 7 tasi, shu hafta 4 kundan 2 tasi
  for (let d = 21; d <= 27; d += 1) completions.push(done(t, `D2026-09-${d}`, `2026-09-${d}T08:00:00`));
  completions.push(done(t, 'D2026-09-28', '2026-09-28T08:00:00'), done(t, 'D2026-09-29', '2026-09-29T08:00:00'));
  const r = report([t], completions, 'week');
  assert.equal(r.summary.rate, 50);
  assert.equal(r.summary.prev_rate, 100);
  assert.equal(r.summary.delta, -50);
  assert.equal(r.trend.length, 8);
  assert.deepEqual(r.trend.slice(-2).map((p) => [p.rate, p.current]), [[100, false], [50, true]]);
  assert.equal(report([t], completions, 'day').trend.length, 14);
  assert.equal(report([t], completions, 'month').trend.length, 6);
});

test('kunlik faollik soat bo\'yicha va streak', () => {
  const a = task({ type: 'kunlik', created_at: at('2026-09-27T08:00:00') });
  const b = task({ type: 'kunlik', created_at: at('2026-09-27T08:00:00') });
  const completions = [];
  for (const d of ['27', '28', '29', '30']) {
    completions.push(done(a, `D2026-09-${d}`, `2026-09-${d}T09:15:00`), done(b, `D2026-09-${d}`, `2026-09-${d}T14:40:00`));
  }
  completions.push(done(a, 'D2026-10-01', '2026-10-01T09:05:00'));
  const r = report([a, b], completions, 'day');
  assert.equal(r.streak, 4, "bugun hali tugamagan — zanjirni uzmaydi");
  assert.equal(r.summary.rate, 50);
  assert.equal(r.activity.length, 24);
  assert.equal(r.activity[9].value, 1);
  assert.equal(r.activity[16].future, true);
  assert.equal(r.activity[15].future, false);

  completions.push(done(b, 'D2026-10-01', '2026-10-01T10:00:00'));
  assert.equal(report([a, b], completions, 'day').streak, 5);

  const broken = completions.filter((c) => !(c.task_id === b.id && c.period_key === 'D2026-09-29'));
  assert.equal(report([a, b], broken, 'day').streak, 2, '1-okt va 30-sen to\'liq, 29-sentabrda bittasi qolgan — zanjir uziladi');
});

test("kun hisobotida: shu hafta/oy davomida bajarilishi kerak bo'lganlar (upcoming)", () => {
  const weekly = task({ title: 'Haftalik', type: 'haftalik', importance: 7 });
  const monthly = task({ title: 'Oylik', type: 'oylik', importance: 9 });
  const weeklyDone = task({ title: 'Bajarilgan haftalik', type: 'haftalik' });
  const noDeadline = task({ title: 'Muddatsiz', type: 'doimiy', importance: 4 });
  const r = report([weekly, monthly, weeklyDone, noDeadline], [done(weeklyDone, 'W2026-09-28', '2026-09-29T10:00:00')], 'day');
  assert.deepEqual(r.upcoming.map((u) => u.title), ['Oylik', 'Haftalik', 'Muddatsiz']);
  assert.equal(r.summary.expected, 0);
  assert.equal(r.summary.rate, null, "reja bo'lmasa foiz null — 0% deb yolg'on ko'rsatilmaydi");
});

test("noma'lum davr xato beradi", () => {
  assert.throws(() => report([], [], 'year'));
});
