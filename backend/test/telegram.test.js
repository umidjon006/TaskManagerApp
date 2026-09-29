const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTelegram } = require('../src/telegram');
const { currentKeys } = require('../src/time');
const {
  createMemoryPool, createFakeTelegramApi, createUser, createTask, complete, silentLog,
} = require('./helpers');

const TZ = 'Asia/Tashkent';

function setup() {
  const pool = createMemoryPool();
  const fake = createFakeTelegramApi();
  const telegram = createTelegram({ token: 'TEST', pool, tz: TZ, fetchImpl: fake.fetchImpl, log: silentLog });
  return { pool, fake, telegram };
}

const msg = (chatId, text) => ({ update_id: 1, message: { chat: { id: chatId, type: 'private' }, text } });

test("/start KOD: to'g'ri kod bilan chat ulanadi, kod bir martalik", async () => {
  const { pool, fake, telegram } = setup();
  const user = await createUser(pool, { name: 'Ravshan', email: 'r@x.uz' });
  const now = new Date();
  await pool.query('UPDATE users SET telegram_link_code = $1, telegram_link_expires_at = $2 WHERE id = $3',
    ['kod123', new Date(now.getTime() + 600000), user]);

  await telegram.handleUpdate(msg(4242, '/start kod123'), now);
  const { rows } = await pool.query('SELECT telegram_chat_id, telegram_link_code FROM users WHERE id = $1', [user]);
  assert.equal(rows[0].telegram_chat_id, '4242');
  assert.equal(rows[0].telegram_link_code, null);
  assert.match(fake.sent()[0].text, /Ravshan/);
  assert.match(fake.sent()[0].text, /\/bugun/);

  await telegram.handleUpdate(msg(5555, '/start kod123'), now);
  assert.match(fake.sent()[1].text, /noto'g'ri yoki muddati o'tgan/);
});

test("/start KOD: muddati o'tgan kod qabul qilinmaydi", async () => {
  const { pool, fake, telegram } = setup();
  const user = await createUser(pool, { email: 'e@x.uz' });
  const now = new Date();
  await pool.query('UPDATE users SET telegram_link_code = $1, telegram_link_expires_at = $2 WHERE id = $3',
    ['eski', new Date(now.getTime() - 1000), user]);
  await telegram.handleUpdate(msg(1, '/start eski'), now);
  const { rows } = await pool.query('SELECT telegram_chat_id FROM users WHERE id = $1', [user]);
  assert.equal(rows[0].telegram_chat_id, null);
  assert.match(fake.sent()[0].text, /muddati o'tgan/);
});

test('bir chat boshqa hisobga ulanganda eski ulanish uziladi', async () => {
  const { pool, telegram } = setup();
  const oldUser = await createUser(pool, { email: 'old@x.uz', chatId: '4242' });
  const newUser = await createUser(pool, { email: 'new@x.uz' });
  const now = new Date();
  await pool.query('UPDATE users SET telegram_link_code = $1, telegram_link_expires_at = $2 WHERE id = $3',
    ['yangi', new Date(now.getTime() + 600000), newUser]);
  await telegram.handleUpdate(msg(4242, '/start yangi'), now);
  const { rows } = await pool.query('SELECT id, telegram_chat_id FROM users ORDER BY id');
  assert.equal(rows.find((r) => r.id === oldUser).telegram_chat_id, null);
  assert.equal(rows.find((r) => r.id === newUser).telegram_chat_id, '4242');
});

test("/vazifalar: bajarilmaganlar muhimlik bo'yicha, tugmalar bilan; o'chirilganlar ko'rinmaydi", async () => {
  const { pool, fake, telegram } = setup();
  const user = await createUser(pool, { chatId: '10' });
  const now = new Date();
  await createTask(pool, user, { title: 'Kichik', importance: 2 });
  await createTask(pool, user, { title: 'Katta', importance: 10 });
  await createTask(pool, user, { title: "O'chirilgan", importance: 10, deleted_at: now });
  const doneId = await createTask(pool, user, { title: 'Tugagan', importance: 9 });
  await complete(pool, doneId, 'ONCE', now);

  await telegram.handleUpdate(msg(10, '/vazifalar'), now);
  const sent = fake.sent()[0];
  assert.match(sent.text, /Bajarilmagan vazifalar \(2 ta\)/);
  assert.ok(sent.text.indexOf('Katta') < sent.text.indexOf('Kichik'));
  assert.doesNotMatch(sent.text, /Tugagan|O'chirilgan/);
  assert.equal(sent.reply_markup.inline_keyboard.length, 2);
});

test('/bugun va /hisobot javob beradi', async () => {
  const { pool, fake, telegram } = setup();
  const user = await createUser(pool, { chatId: '10' });
  const now = new Date();
  await createTask(pool, user, { title: 'Sport', type: 'kunlik', importance: 9, created_at: new Date(now.getTime() - 3 * 86400000) });

  await telegram.handleUpdate(msg(10, '/bugun'), now);
  assert.match(fake.sent()[0].text, /Qolganlar[\s\S]*Sport/);
  await telegram.handleUpdate(msg(10, '/hisobot'), now);
  assert.match(fake.sent()[1].text, /Hisobot[\s\S]*Bugun[\s\S]*Shu hafta/);
});

test("✅ tugmasi: joriy davr uchun bajarilish yoziladi, begona vazifaga tegmaydi", async () => {
  const { pool, fake, telegram } = setup();
  const me = await createUser(pool, { email: 'me@x.uz', chatId: '10' });
  const other = await createUser(pool, { email: 'other@x.uz', chatId: '20' });
  const myTask = await createTask(pool, me, { title: 'Meniki', type: 'kunlik', importance: 9 });
  const otherTask = await createTask(pool, other, { title: 'Begona', importance: 9 });
  const now = new Date();
  const cb = (id, data) => ({ update_id: 2, callback_query: { id, data, message: { chat: { id: 10 } } } });
  const completionsOf = async (id) => (await pool.query('SELECT period_key FROM task_completions WHERE task_id = $1', [id])).rows;

  await telegram.handleUpdate(cb('q1', `done:${otherTask}`), now);
  assert.equal((await completionsOf(otherTask)).length, 0);
  assert.equal(fake.calls.find((c) => c.method === 'answerCallbackQuery').body.text, 'Vazifa topilmadi');

  await telegram.handleUpdate(cb('q2', `done:${myTask}`), now);
  assert.deepEqual((await completionsOf(myTask)).map((r) => r.period_key), [currentKeys(now, TZ).kunlik]);
  assert.match(fake.sent().at(-1).text, /Meniki.*bajarildi/);

  await telegram.handleUpdate(cb('q3', `done:${myTask}`), now);
  assert.match(fake.calls.filter((c) => c.method === 'answerCallbackQuery').at(-1).body.text, /allaqachon/);
  assert.equal((await completionsOf(myTask)).length, 1);
});

test("/stop ulanishni uzadi; guruh xabarlari e'tiborsiz qoldiriladi", async () => {
  const { pool, fake, telegram } = setup();
  const user = await createUser(pool, { chatId: '10' });
  await telegram.handleUpdate({ update_id: 3, message: { chat: { id: 10, type: 'group' }, text: '/stop' } });
  assert.equal(fake.sent().length, 0);
  await telegram.handleUpdate(msg(10, '/stop'));
  const { rows } = await pool.query('SELECT telegram_chat_id FROM users WHERE id = $1', [user]);
  assert.equal(rows[0].telegram_chat_id, null);
});

test("start(): getMe → deleteWebhook → setMyCommands → getUpdates; noto'g'ri token bo'lsa to'xtaydi", async () => {
  const pool = createMemoryPool();
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url.split('/').pop());
    return { status: 401, json: async () => ({ ok: false, error_code: 401, description: 'Unauthorized' }) };
  };
  const telegram = createTelegram({ token: 'BAD', pool, tz: TZ, fetchImpl, log: silentLog });
  assert.equal(telegram.enabled, true);
  await telegram.start(); // 401 bo'lgani uchun darhol qaytishi kerak
  assert.deepEqual(calls, ['getMe']);
  assert.equal(telegram.enabled, false, "noto'g'ri token — sayt botni o'chiq deb ko'rsatadi");

  const fake = createFakeTelegramApi();
  const good = createTelegram({ token: 'OK', pool, tz: TZ, fetchImpl: async (url, opts) => {
    const res = await fake.fetchImpl(url, opts);
    if (url.endsWith('getUpdates')) good.stop();
    return res;
  }, log: silentLog });
  await good.start();
  assert.deepEqual(fake.calls.map((c) => c.method), ['getMe', 'deleteWebhook', 'setMyCommands', 'getUpdates']);
  assert.equal(good.botUsername, 'vazifa_test_bot');
});
