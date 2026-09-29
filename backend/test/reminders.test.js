const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runReminders } = require('../src/reminders');
const { createTelegram } = require('../src/telegram');
const { parseQuietHours } = require('../src/time');
const {
  createMemoryPool, createFakeTelegramApi, createUser, createTask, complete, at, silentLog,
} = require('./helpers');

const TZ = 'Asia/Tashkent';
const quiet = parseQuietHours('23-7');

function setup({ summaryHour = null } = {}) {
  const pool = createMemoryPool();
  const fake = createFakeTelegramApi();
  const telegram = createTelegram({ token: 'TEST', pool, tz: TZ, fetchImpl: fake.fetchImpl, log: silentLog });
  const run = (now) => runReminders({ pool, telegram, tz: TZ, quiet, summaryHour, now, log: silentLog });
  return { pool, fake, run };
}

test('soatlik holat: bugun bajarilganlar va qolganlar, eng muhimi birinchi', async () => {
  const { pool, fake, run } = setup();
  const user = await createUser(pool, { chatId: '555', min: 8 });
  const sport = await createTask(pool, user, { title: 'Sport', type: 'kunlik', importance: 9 });
  const tax = await createTask(pool, user, { title: 'Soliq', type: 'doimiy', importance: 10 });
  await createTask(pool, user, { title: 'Kitob', type: 'kunlik', importance: 4 });
  await createTask(pool, user, { title: 'Past doimiy', type: 'doimiy', importance: 3 });
  await complete(pool, sport, 'D2026-09-29', at('2026-09-29T07:30:00'));

  await run(at('2026-09-29T10:00:00'));
  const msg = fake.sent()[0];
  assert.equal(msg.chat_id, '555');
  assert.match(msg.text, /Bugun, 29-sentabr/);
  assert.match(msg.text, /Bajarildi: <b>1 \/ 3<\/b> \(33%\)/);
  assert.match(msg.text, /Bajarilganlar[\s\S]*Sport/);
  assert.match(msg.text, /Qolganlar[\s\S]*1\. <b>Soliq<\/b> ★10[\s\S]*2\. <b>Kitob<\/b>/);
  assert.doesNotMatch(msg.text, /Past doimiy/, 'muhim emas va muddatsiz — soatlik xabarga kirmaydi');
  assert.deepEqual(msg.reply_markup.inline_keyboard.map((r) => r[0].callback_data), [`done:${tax}`, `done:${sport + 2}`]);

  await run(at('2026-09-29T10:30:00'));
  assert.equal(fake.sent().length, 1, 'soat o\'tmaguncha qayta yubormaydi');
  await run(at('2026-09-29T11:00:00'));
  assert.equal(fake.sent().length, 2);
});

test("hammasi bajarilsa — bir marta tabrik, keyin o'sha kuni jimlik; ertasi kuni kunlik vazifa qaytadi", async () => {
  const { pool, fake, run } = setup();
  const user = await createUser(pool, { chatId: '555' });
  const sport = await createTask(pool, user, { title: 'Sport', type: 'kunlik', importance: 9 });
  await complete(pool, sport, 'D2026-09-29', at('2026-09-29T07:30:00'));

  await run(at('2026-09-29T10:00:00'));
  await run(at('2026-09-29T11:00:00'));
  await run(at('2026-09-29T12:00:00'));
  assert.equal(fake.sent().length, 1);
  assert.match(fake.sent()[0].text, /Barakalla!/);

  await run(at('2026-09-30T09:00:00'));
  assert.equal(fake.sent().length, 2);
  assert.match(fake.sent()[1].text, /Qolganlar[\s\S]*Sport/);
});

test('jim soatlarda soatlik xabar yuborilmaydi', async () => {
  const { pool, fake, run } = setup();
  const user = await createUser(pool, { chatId: '777' });
  await createTask(pool, user, { title: 'Tungi', importance: 10 });
  await run(at('2026-09-29T23:30:00'));
  await run(at('2026-09-30T03:00:00'));
  assert.equal(fake.sent().length, 0);
  await run(at('2026-09-30T07:00:00'));
  assert.equal(fake.sent().length, 1);
});

test('Telegram ulanmagan foydalanuvchiga hech narsa yuborilmaydi', async () => {
  const { pool, fake, run } = setup();
  const user = await createUser(pool, { chatId: null });
  await createTask(pool, user, { title: 'X', importance: 10 });
  await run(at('2026-09-29T10:00:00'));
  assert.equal(fake.sent().length, 0);
});

test("deadline: 1 soat qolganda va muddati o'tganda bir martadan", async () => {
  const { pool, fake, run } = setup();
  const user = await createUser(pool, { chatId: '999', min: 10 });
  await createTask(pool, user, { title: 'Hisobot', importance: 7, deadline: at('2026-09-29T18:00:00') });
  const alerts = () => fake.sent().filter((m) => /soatdan kam|Muddati o'tdi/.test(m.text));

  await run(at('2026-09-29T16:30:00'));
  assert.equal(alerts().length, 0);
  await run(at('2026-09-29T17:10:00'));
  await run(at('2026-09-29T17:20:00'));
  assert.equal(alerts().length, 1);
  assert.match(alerts()[0].text, /1 soatdan kam qoldi/);
  assert.match(alerts()[0].text, /29\.09\.2026 18:00/);

  await run(at('2026-09-29T18:01:00'));
  await run(at('2026-09-29T18:02:00'));
  assert.equal(alerts().length, 2);
  assert.match(alerts()[1].text, /Muddati o'tdi/);
});

test("kun yakuni: 21:00 dan keyin bir marta; yakshanba hafta hisoboti ham qo'shiladi", async () => {
  const { pool, fake, run } = setup({ summaryHour: 21 });
  const user = await createUser(pool, { chatId: '42' });
  const t = await createTask(pool, user, { title: 'Sport', type: 'kunlik', importance: 9, created_at: at('2026-09-28T08:00:00') });
  await complete(pool, t, 'D2026-09-28', at('2026-09-28T08:00:00'));
  await complete(pool, t, 'D2026-09-29', at('2026-09-29T08:00:00'));
  const summaries = () => fake.sent().filter((m) => /Kun yakuni/.test(m.text));

  await run(at('2026-09-29T20:59:00'));
  assert.equal(summaries().length, 0);
  await run(at('2026-09-29T21:00:00'));
  await run(at('2026-09-29T21:30:00'));
  assert.equal(summaries().length, 1);
  assert.match(summaries()[0].text, /Bugun<\/b> — 29-sentabr, seshanba/);
  assert.match(summaries()[0].text, /100%/);
  assert.match(summaries()[0].text, /Ketma-ket 2 kun/);
  assert.doesNotMatch(summaries()[0].text, /Hafta hisoboti/);

  // Yakshanba (4-okt): 30-sen – 3-okt bajarilmagan
  await run(at('2026-10-04T21:05:00'));
  const sunday = summaries()[1];
  assert.match(sunday.text, /Hafta hisoboti<\/b> — 28-sentabr – 4-oktabr/);
  assert.match(sunday.text, /Bajarildi 2 \/ 7/);
  assert.match(sunday.text, /Qolib ketgan: 5 ta/);
});

test("bot bloklangan (403) bo'lsa ulanish uziladi", async () => {
  const pool = createMemoryPool();
  const fetchImpl = async () => ({ status: 403, json: async () => ({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }) });
  const telegram = createTelegram({ token: 'TEST', pool, tz: TZ, fetchImpl, log: silentLog });
  const user = await createUser(pool, { chatId: '123' });
  await createTask(pool, user, { title: 'X', importance: 10 });
  await runReminders({ pool, telegram, tz: TZ, quiet, now: at('2026-09-29T10:00:00'), log: silentLog });
  const { rows } = await pool.query('SELECT telegram_chat_id FROM users WHERE id = $1', [user]);
  assert.equal(rows[0].telegram_chat_id, null);
});

test("HTML belgilar xavfsiz ko'rsatiladi", async () => {
  const { pool, fake, run } = setup();
  const user = await createUser(pool, { chatId: '321' });
  await createTask(pool, user, { title: '<b>a & b</b>', importance: 10 });
  await run(at('2026-09-29T10:00:00'));
  assert.match(fake.sent()[0].text, /&lt;b&gt;a &amp; b&lt;\/b&gt;/);
});
