import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSchedule, parseLeadMinutes, parseMorningHour, zonedTime } from '../../src/core/schedule.js';

const TZ = 'Asia/Tashkent'; // UTC+5

// Toshkent vaqti bo'yicha lahza → ISO UTC satri: L('2026-10-02T09:00') → '2026-10-02T04:00:00.000Z'.
const L = (local) => new Date(new Date(`${local}:00Z`).getTime() - 5 * 3600 * 1000).toISOString();

// "Hozir": 2026-10-01 (payshanba) 15:00 Toshkent. Yakshanba — 4-okt.
const NOW = L('2026-10-01T15:00');

// Jim soatlar alohida testda — qolganlarida aralashmasin.
const SETTINGS = {
  reminder_min_importance: '5',
  quiet_hours: '',
  summary_hour: '21',
  lead_minutes: '60,10,0',
  morning_hour: '9',
};

let nextId = 1;
const task = (fields) => ({ id: nextId++, title: 'Vazifa', type: 'doimiy', importance: 5, deadline: null, done: false, ...fields });

const run = ({ tasks, now = NOW, settings = {}, horizonDays, tz = TZ }) =>
  buildSchedule({ tasks, now, tz, settings: { ...SETTINGS, ...settings }, horizonDays });

const ofKind = (list, kind) => list.filter((n) => n.kind === kind);

test("deadline'li vazifa: 1 soat, 10 daqiqa oldin va vaqtida — 3 ta eslatma", () => {
  const t = task({ title: 'Hisobot', deadline: L('2026-10-02T14:00') });
  const list = ofKind(run({ tasks: [t] }), 'deadline');
  assert.deepEqual(list.map((n) => n.at), [L('2026-10-02T13:00'), L('2026-10-02T13:50'), L('2026-10-02T14:00')]);
  assert.ok(list.every((n) => n.taskId === t.id && n.title === 'Hisobot'));
  assert.deepEqual(list.map((n) => n.body), ['1 soat qoldi · 14:00 gacha', '10 daqiqa qoldi · 14:00 gacha', 'Muddati keldi · 14:00']);
});

test("lead_minutes o'zgarsa, eslatmalar soni va vaqti o'zgaradi", () => {
  const t = task({ deadline: L('2026-10-02T14:00') });
  assert.deepEqual(ofKind(run({ tasks: [t], settings: { lead_minutes: '30' } }), 'deadline').map((n) => n.at), [L('2026-10-02T13:30')]);
  assert.deepEqual(
    ofKind(run({ tasks: [t], settings: { lead_minutes: '5,1440,120' } }), 'deadline').map((n) => n.at),
    [L('2026-10-01T14:00'), L('2026-10-02T12:00'), L('2026-10-02T13:55')].filter((at) => at >= NOW),
  );
  assert.equal(ofKind(run({ tasks: [t], settings: { lead_minutes: '' } }), 'deadline').length, 0);
});

test("bajarilgan vazifaga eslatma yo'q; kunlik vazifa ertadan yana eslatiladi", () => {
  const once = task({ title: 'Bir martalik', deadline: L('2026-10-02T14:00'), done: true });
  assert.deepEqual(run({ tasks: [once] }), []);

  const daily = task({ title: 'Mashq', type: 'kunlik', done: true });
  const evenings = ofKind(run({ tasks: [daily] }), 'evening');
  assert.ok(!evenings.some((n) => n.at === L('2026-10-01T21:00')), 'bugungi yakunda yo\'q');
  assert.ok(evenings.some((n) => n.at === L('2026-10-02T21:00')), 'ertangi yakunda bor');
});

test("muhimligi chegaradan past vazifaga eslatma yo'q", () => {
  const low = task({ importance: 4, type: 'kunlik', deadline: L('2026-10-02T14:00') });
  assert.deepEqual(run({ tasks: [low] }), []);
  assert.ok(run({ tasks: [low], settings: { reminder_min_importance: '4' } }).length > 0);
});

test("o'chirilgan vazifaga eslatma yo'q", () => {
  const t = task({ type: 'kunlik', deadline: L('2026-10-02T14:00'), deleted_at: L('2026-10-01T10:00') });
  assert.deepEqual(run({ tasks: [t] }), []);
});

test('jim soatga tushgan eslatma tashlanadi, keyinga surilmaydi', () => {
  // Jim soat 22–7. Deadline 07:30: 06:30 dagisi jim — tashlanadi, 07:20 va 07:30 qoladi.
  const t = task({ deadline: L('2026-10-02T07:30') });
  const list = run({ tasks: [t], settings: { quiet_hours: '22-7', summary_hour: '', morning_hour: '' } });
  assert.deepEqual(list.map((n) => n.at), [L('2026-10-02T07:20'), L('2026-10-02T07:30')]);

  // Ertalabki yig'ma 6:00 da — jim soat. 7:00 ga surilmaydi, butunlay yo'q.
  const daily = task({ type: 'kunlik' });
  const mornings = ofKind(run({ tasks: [daily], settings: { quiet_hours: '22-7', morning_hour: '6' } }), 'morning');
  assert.deepEqual(mornings, []);
  // Kechki yakun 22:00 da ham jim.
  assert.deepEqual(ofKind(run({ tasks: [daily], settings: { quiet_hours: '22-7', summary_hour: '22' } }), 'evening'), []);
});

test("o'tib ketgan vaqt ro'yxatga tushmaydi", () => {
  // Deadline 15:30 → 14:30 o'tib ketgan; 15:20 va 15:30 qoladi.
  const t = task({ type: 'kunlik', deadline: L('2026-10-01T15:30') });
  const list = run({ tasks: [t] });
  assert.deepEqual(ofKind(list, 'deadline').map((n) => n.at), [L('2026-10-01T15:20'), L('2026-10-01T15:30')]);
  // Bugungi 9:00 o'tdi — birinchi ertalabki yig'ma ertaga.
  assert.equal(ofKind(list, 'morning')[0].at, L('2026-10-02T09:00'));
  assert.ok(list.every((n) => n.at >= NOW));
});

test("deadline'siz vazifalar faqat yig'ma xabarda, alohida emas", () => {
  const a = task({ title: 'Majlis', type: 'kunlik', importance: 9 });
  const b = task({ title: 'Hisobot', type: 'kunlik', importance: 7 });
  const c = task({ title: 'Sport', type: 'kunlik', importance: 6 });
  const d = task({ title: 'Kitob', type: 'kunlik', importance: 5 });
  const list = run({ tasks: [d, c, b, a] });
  assert.ok(list.every((n) => n.taskId === null));
  assert.deepEqual(ofKind(list, 'deadline'), []);
  const morning = ofKind(list, 'morning')[0];
  assert.equal(morning.at, L('2026-10-02T09:00'));
  assert.equal(morning.body, 'Bugun 4 ta vazifa: Majlis, Hisobot, Sport va yana 1 ta');
  // Bir kunga bitta ertalabki va bitta kechki xabar — vazifalar soniga bog'liq emas.
  assert.equal(ofKind(list, 'morning').length, 7);
  assert.equal(ofKind(list, 'evening').length, 7); // 1–7 okt 21:00 (8-okt 21:00 ufqdan tashqarida)
  assert.equal(ofKind(list, 'evening')[0].body, 'Bajarilmay qoldi 4 ta: Majlis, Hisobot, Sport va yana 1 ta');
});

test("yig'ma bo'sh bo'lsa eslatma yaratilmaydi", () => {
  assert.deepEqual(run({ tasks: [] }), []);
  // Hammasi bajarilgan — bugungi 21:00 kechki yakun ufq ichida, lekin yaratilmaydi.
  const list = run({ tasks: [task({ type: 'kunlik', done: true })], horizonDays: 0.3 });
  assert.deepEqual(list, []);
});

test("kelajakdagi deadline'li vazifa yig'mada yo'q — faqat deadline kuni va o'tgandan keyin", () => {
  // Deadline 3 kundan keyin: 4-okt 16:00.
  const t = task({ title: 'Majlis', deadline: L('2026-10-04T16:00') });
  const list = run({ tasks: [t] });
  const digests = list.filter((n) => n.kind === 'morning' || n.kind === 'evening');
  // Bugun va deadline'gacha bo'lgan kunlarda yig'ma yo'q.
  assert.ok(digests.every((n) => n.at >= L('2026-10-04T00:00')));
  assert.equal(ofKind(list, 'evening').find((n) => n.at === L('2026-10-01T21:00')), undefined);
  // Deadline kuni — bor.
  const deadlineDay = ofKind(list, 'morning').find((n) => n.at === L('2026-10-04T09:00'));
  assert.equal(deadlineDay.body, 'Bugun 1 ta vazifa: Majlis');
  assert.ok(ofKind(list, 'evening').some((n) => n.at === L('2026-10-04T21:00')));
  // Muddati o'tgandan keyin bajarilmaguncha — bor.
  assert.ok(ofKind(list, 'morning').some((n) => n.at === L('2026-10-05T09:00')));
  assert.ok(ofKind(list, 'evening').some((n) => n.at === L('2026-10-07T21:00')));
  // O'z deadline eslatmalari joyida.
  assert.equal(ofKind(list, 'deadline').length, 3);
});

for (const type of ['doimiy', 'kunlik', 'haftalik', 'oylik']) {
  test(`deadline'siz ${type} vazifa ertalabki va kechki yig'mada bor`, () => {
    const t = task({ title: 'Qachondir', type });
    const list = run({ tasks: [t] });
    assert.equal(ofKind(list, 'morning')[0].at, L('2026-10-02T09:00'));
    assert.equal(ofKind(list, 'morning')[0].body, 'Bugun 1 ta vazifa: Qachondir');
    assert.equal(ofKind(list, 'evening')[0].at, L('2026-10-01T21:00'));
    assert.deepEqual(ofKind(list, 'deadline'), []);
  });
}

test("deadline'siz 10 ta vazifa — bitta yig'ma xabar, 10 ta emas", () => {
  const tasks = Array.from({ length: 10 }, (_, i) => task({ title: `V${i}`, type: ['doimiy', 'kunlik', 'haftalik', 'oylik'][i % 4] }));
  const list = run({ tasks, horizonDays: 0.3 }); // faqat bugungi 21:00 kechki yakun
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, 'evening');
  assert.equal(list[0].taskId, null);
  assert.equal(list[0].body, 'Bajarilmay qoldi 10 ta: V0, V1, V2 va yana 7 ta');
});

test("yig'mada bajarilgan va muhimligi past vazifa yo'q", () => {
  const tasks = [
    task({ title: 'Ochiq', type: 'doimiy' }),
    task({ title: 'Bajarilgan', type: 'doimiy', done: true }),
    task({ title: 'Haftada bajarilgan', type: 'haftalik', done: true }),
    task({ title: 'Past', type: 'doimiy', importance: 2 }),
  ];
  const morning = ofKind(run({ tasks }), 'morning')[0];
  assert.equal(morning.body, 'Bugun 1 ta vazifa: Ochiq');
  // Haftalik bajarilgani keyingi haftadan yana yig'maga qaytadi (5-okt — dushanba).
  const monday = ofKind(run({ tasks }), 'morning').find((n) => n.at === L('2026-10-05T09:00'));
  assert.equal(monday.body, 'Bugun 2 ta vazifa: Ochiq, Haftada bajarilgan');
});

test('haftalik: yakshanba 18:00 da davr oxiri; bajarilgan hafta tashlanadi', () => {
  const weekly = task({ title: 'Tozalash', type: 'haftalik' });
  const ends = ofKind(run({ tasks: [weekly], horizonDays: 14 }), 'period-end');
  assert.deepEqual(ends.map((n) => n.at), [L('2026-10-04T18:00'), L('2026-10-11T18:00')]);
  assert.equal(ends[0].title, 'Hafta yakuni');
  assert.equal(ends[0].body, 'Shu hafta bajarilmagan 1 ta: Tozalash');

  const doneWeekly = { ...weekly, done: true };
  assert.deepEqual(ofKind(run({ tasks: [doneWeekly], horizonDays: 14 }), 'period-end').map((n) => n.at), [L('2026-10-11T18:00')]);
});

test("oylik: oyning oxirgi kuni 18:00 da davr oxiri", () => {
  const monthly = task({ title: 'Kommunal', type: 'oylik' });
  const ends = ofKind(run({ tasks: [monthly], horizonDays: 31 }), 'period-end');
  assert.deepEqual(ends.map((n) => n.at), [L('2026-10-31T18:00')]);
  assert.equal(ends[0].title, 'Oy yakuni');
  // Oylik vazifa yakshanba (4-okt) davr oxiriga tushmaydi.
  assert.ok(!ofKind(run({ tasks: [monthly] }), 'period-end').length);
});

test("vaqt zonasi: Asia/Tashkent bo'yicha hisoblanadi", () => {
  const daily = task({ type: 'kunlik' });
  // UTC 20:30 = Toshkentda 2-okt 01:30. Birinchi ertalab — 2-okt 09:00 Toshkent = 04:00Z.
  const list = run({ tasks: [daily], now: '2026-10-01T20:30:00.000Z' });
  assert.equal(ofKind(list, 'morning')[0].at, '2026-10-02T04:00:00.000Z');
  assert.equal(ofKind(list, 'evening')[0].at, '2026-10-02T16:00:00.000Z');
  // Boshqa zonada boshqa UTC vaqt.
  const london = run({ tasks: [daily], now: '2026-10-01T20:30:00.000Z', tz: 'Europe/London' });
  assert.equal(ofKind(london, 'morning')[0].at, '2026-10-02T08:00:00.000Z'); // BST, UTC+1
});

test('zonedTime: yozgi vaqtga o\'tish chegarasida ham to\'g\'ri', () => {
  assert.equal(new Date(zonedTime('2026-10-02', 9, TZ)).toISOString(), '2026-10-02T04:00:00.000Z');
  assert.equal(new Date(zonedTime('2026-10-24', 9, 'Europe/London')).toISOString(), '2026-10-24T08:00:00.000Z');
  assert.equal(new Date(zonedTime('2026-10-26', 9, 'Europe/London')).toISOString(), '2026-10-26T09:00:00.000Z');
});

test("60 ta chegara: faqat deadline'lar bo'lsa eng yaqinlari qoladi", () => {
  // 30 ta vazifa, har biri 3 ta eslatma = 90 ta. Deadline'lar 4 soat oraliqda.
  const tasks = Array.from({ length: 30 }, (_, i) => task({
    title: `V${i}`,
    deadline: new Date(Date.parse(NOW) + (i + 2) * 4 * 3600000).toISOString(),
  }));
  const list = run({ tasks, settings: { morning_hour: '', summary_hour: '' } });
  assert.equal(list.length, 60);
  // Saralangan va eng yaqin 20 ta vazifaning hammasi bor, uzoqdagi 10 tasi yo'q.
  assert.deepEqual(list.map((n) => n.at), [...list.map((n) => n.at)].sort());
  const ids = new Set(list.map((n) => n.taskId));
  assert.deepEqual([...ids], tasks.slice(0, 20).map((t) => t.id));
});

test("60 ta chegara: uzoqdagi yig'malar tashlanadi, uzoqdagi period-end qoladi", () => {
  // 31 kun: oylik vazifa har kuni yig'mada (62 ta) + 31-okt period-end + 10 ta deadline (30 ta) = 93 ta.
  const monthly = task({ title: 'Kommunal', type: 'oylik' });
  const withDeadline = Array.from({ length: 10 }, (_, i) => task({
    title: `D${i}`,
    deadline: L(`2026-10-${String(5 + i * 2).padStart(2, '0')}T12:00`),
  }));
  const list = run({ tasks: [monthly, ...withDeadline], horizonDays: 31 });
  assert.equal(list.length, 60);
  assert.deepEqual(list.map((n) => n.at), [...list.map((n) => n.at)].sort());
  // Ufq oxiridagi period-end va barcha deadline'lar qoladi.
  assert.deepEqual(ofKind(list, 'period-end').map((n) => n.at), [L('2026-10-31T18:00')]);
  assert.equal(ofKind(list, 'deadline').length, 30);
  // Yig'malardan eng yaqin 29 tasi qoladi, uzoqdagilari tashlanadi.
  const digests = list.filter((n) => n.kind === 'morning' || n.kind === 'evening');
  assert.equal(digests.length, 29);
  assert.equal(digests[0].at, L('2026-10-01T21:00'));
  assert.ok(digests.every((n) => n.at < L('2026-10-16T00:00')));
});

test("60 ta chegara: keyingi 48 soatdagilar turidan qat'i nazar qoladi", () => {
  // 40 ta deadline'li vazifa 49–88 soatda (120 ta eslatma) + yaqin yig'malar.
  const far = Array.from({ length: 40 }, (_, i) => task({
    title: `F${i}`,
    deadline: new Date(Date.parse(NOW) + (50 + i) * 3600000).toISOString(),
    importance: 4,
  }));
  const daily = task({ title: 'Mashq', type: 'kunlik' });
  const list = run({ tasks: [daily, ...far], settings: { reminder_min_importance: '4' } });
  assert.equal(list.length, 60);
  // 48 soat ichidagi yig'malar: 1-okt 21:00, 2-okt 9:00 va 21:00, 3-okt 9:00 — hammasi bor.
  const soon = list.filter((n) => n.at < L('2026-10-03T15:00')).map((n) => n.at);
  assert.deepEqual(soon, [L('2026-10-01T21:00'), L('2026-10-02T09:00'), L('2026-10-02T21:00'), L('2026-10-03T09:00')]);
  // 48 soatdan keyin yig'malar birinchi tashlanadi — 56 ta joy deadline'larga qoladi.
  assert.equal(list.filter((n) => n.at >= L('2026-10-03T15:00') && n.kind !== 'deadline').length, 0);
  assert.equal(ofKind(list, 'deadline').length, 56);
});

test("natija vaqt bo'yicha saralangan va shakli to'g'ri", () => {
  const tasks = [
    task({ type: 'kunlik' }),
    task({ type: 'haftalik' }),
    task({ deadline: L('2026-10-03T12:00') }),
  ];
  const list = run({ tasks });
  assert.deepEqual(list.map((n) => n.at), [...list.map((n) => n.at)].sort());
  for (const n of list) {
    assert.deepEqual(Object.keys(n), ['at', 'kind', 'taskId', 'title', 'body']);
    assert.match(n.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:00\.000Z$/);
  }
});

test('parseLeadMinutes va parseMorningHour', () => {
  assert.deepEqual(parseLeadMinutes(undefined), [60, 10, 0]);
  assert.deepEqual(parseLeadMinutes('10, 60,0,10'), [60, 10, 0]);
  assert.deepEqual(parseLeadMinutes(''), []);
  for (const bad of ['-5', '1.5', 'abc', '60,,10', '99999']) assert.throws(() => parseLeadMinutes(bad), /lead_minutes/);
  assert.equal(parseMorningHour(undefined), 9);
  assert.equal(parseMorningHour(''), null);
  assert.equal(parseMorningHour('7'), 7);
  for (const bad of ['24', '-1', '8.5', 'x']) assert.throws(() => parseMorningHour(bad), /morning_hour/);
});
