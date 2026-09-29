const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { AiError } = require('../src/ai');
const { createMemoryPool, at } = require('./helpers');

let server;
let baseUrl;
let pool;
let clockNow = at('2026-09-29T10:00:00'); // testlar vaqtni o'zi boshqaradi

const fakeAi = {
  enabled: true,
  async suggest({ title }) {
    if (title === 'xato') throw new AiError('AI hozir band', 503);
    return { importance: 9, type: 'kunlik', reason: 'Sinov sababi' };
  },
  async plan({ tasks }) {
    return { text: `Birinchi: ${tasks[0] ? tasks[0].title : "yo'q"}` };
  },
};

const fakeTelegram = { enabled: true, botUsername: 'vazifa_test_bot', newLinkCode: () => 'abc123def456' };

before(async () => {
  pool = createMemoryPool();
  const app = createApp({
    pool, jwtSecret: 'test-secret', authRateLimit: 1000, ai: fakeAi, telegram: fakeTelegram, clock: () => clockNow,
  });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

async function api(method, path, { body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(baseUrl + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

async function register(name, email) {
  const res = await api('POST', '/api/auth/register', { body: { full_name: name, email, password: 'parol123' } });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data.token;
}

const titles = async (token, query = '') => (await api('GET', `/api/tasks${query}`, { token })).data.tasks.map((t) => t.title);

let tokenA;
let tokenB;

test('health', async () => {
  const res = await api('GET', '/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.data.status, 'ok');
});

test("register/login: to'g'ri oqim va xatolar", async () => {
  tokenA = await register('Ravshan', 'Ravshan@Example.uz');
  tokenB = await register('Boshqa', 'boshqa@example.uz');

  assert.equal((await api('POST', '/api/auth/register', { body: { full_name: 'X', email: 'ravshan@example.uz', password: 'parol123' } })).status, 400);
  assert.equal((await api('POST', '/api/auth/register', { body: { full_name: 'Xx', email: 'RAVSHAN@example.uz', password: 'parol123' } })).status, 409);
  assert.equal((await api('POST', '/api/auth/register', { body: { full_name: 'Xx', email: 'yomon', password: 'parol123' } })).status, 400);
  assert.equal((await api('POST', '/api/auth/register', { body: { full_name: 'Xx', email: 'q@q.uz', password: '123' } })).status, 400);

  assert.equal((await api('POST', '/api/auth/login', { body: { email: 'ravshan@example.uz', password: 'parol123' } })).status, 200);
  const bad = await api('POST', '/api/auth/login', { body: { email: 'ravshan@example.uz', password: 'xato' } });
  const unknown = await api('POST', '/api/auth/login', { body: { email: 'yoq@example.uz', password: 'parol123' } });
  assert.equal(bad.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(bad.data.error, unknown.data.error);
});

test('me: sozlamalar, telegram, ai, jim soatlar va kun yakuni', async () => {
  const res = await api('GET', '/api/me', { token: tokenA });
  assert.equal(res.status, 200);
  assert.equal(res.data.user.email, 'ravshan@example.uz');
  assert.equal(res.data.settings.reminder_min_importance, 8);
  assert.deepEqual(res.data.telegram, { enabled: true, connected: false, bot_username: 'vazifa_test_bot' });
  assert.equal(res.data.ai.enabled, true);
  assert.equal(res.data.summary_hour, '21:00');
  assert.equal((await api('GET', '/api/me')).status, 401);
  assert.equal((await api('GET', '/api/me', { token: 'soxta' })).status, 401);
});

test('vazifa validatsiyasi', async () => {
  const base = { title: 'Test', type: 'kunlik', importance: 5 };
  const cases = [
    { ...base, title: '' },
    { ...base, type: 'yillik' },
    { ...base, importance: 0 },
    { ...base, importance: 11 },
    { ...base, importance: 7.5 },
    { ...base, deadline: 'ertaga' },
  ];
  for (const body of cases) {
    const res = await api('POST', '/api/tasks', { token: tokenA, body });
    assert.equal(res.status, 400, `${JSON.stringify(body)} → ${res.status}`);
  }
});

test("saralash: bajarilmagan → ko'p yulduz → yaqin deadline", async () => {
  const create = (body) => api('POST', '/api/tasks', { token: tokenA, body });
  await create({ title: 'Past 3', type: 'doimiy', importance: 3 });
  await create({ title: "O'n yulduz", type: 'doimiy', importance: 10 });
  await create({ title: '7 kechroq', type: 'oylik', importance: 7, deadline: at('2026-10-02T18:00:00').toISOString() });
  await create({ title: '7 tezroq', type: 'haftalik', importance: 7, deadline: at('2026-09-29T18:00:00').toISOString() });
  const created = await create({ title: 'Sport', type: 'kunlik', importance: 9, description: 'Yugurish' });
  assert.equal(created.status, 201);
  assert.equal(created.data.task.done, false);
  assert.equal(created.data.task.remind_time, undefined, "vaqt eslatmasi olib tashlangan");

  assert.deepEqual(await titles(tokenA), ["O'n yulduz", 'Sport', '7 tezroq', '7 kechroq', 'Past 3']);
  const res = await api('GET', '/api/tasks', { token: tokenA });
  assert.equal(res.data.summary.pending, 5);
  assert.equal(res.data.summary.important_pending, 2);
  assert.deepEqual(await titles(tokenA, '?type=kunlik'), ['Sport']);
});

test('toggle: kunlik vazifa bugun bajariladi, ertasi kuni yana ochiladi, tarix saqlanadi', async () => {
  const sport = (await api('GET', '/api/tasks?type=kunlik', { token: tokenA })).data.tasks[0];
  const done = await api('POST', `/api/tasks/${sport.id}/toggle`, { token: tokenA });
  assert.equal(done.data.task.done, true);
  const list = await titles(tokenA);
  assert.equal(list[list.length - 1], 'Sport', 'bajarilgan pastga tushadi');

  clockNow = at('2026-09-30T09:00:00');
  const next = (await api('GET', '/api/tasks?type=kunlik', { token: tokenA })).data.tasks[0];
  assert.equal(next.done, false, 'yangi kun — yangi davr');

  const { rows } = await pool.query('SELECT period_key FROM task_completions WHERE task_id = $1', [sport.id]);
  assert.deepEqual(rows.map((r) => r.period_key), ['D2026-09-29']);

  await api('POST', `/api/tasks/${sport.id}/toggle`, { token: tokenA });
  const undo = await api('POST', `/api/tasks/${sport.id}/toggle`, { token: tokenA });
  assert.equal(undo.data.task.done, false, 'qayta bosilsa bekor qilinadi');
  clockNow = at('2026-09-29T10:00:00');
});

test("muddati o'tgan vazifa belgilanadi", async () => {
  const past = await api('POST', '/api/tasks', {
    token: tokenA,
    body: { title: 'Kechikkan', type: 'doimiy', importance: 6, deadline: at('2026-09-29T08:00:00').toISOString() },
  });
  assert.equal(past.data.task.overdue, true);
});

test("tahrirlash, yumshoq o'chirish va qaytarish (undo)", async () => {
  const created = await api('POST', '/api/tasks', { token: tokenA, body: { title: 'Eski nom', type: 'doimiy', importance: 2 } });
  const id = created.data.task.id;

  const edited = await api('PUT', `/api/tasks/${id}`, {
    token: tokenA,
    body: { title: 'Yangi nom', type: 'oylik', importance: 6, description: 'izoh' },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.task.title, 'Yangi nom');
  assert.equal(edited.data.task.type, 'oylik');
  assert.equal((await api('PUT', `/api/tasks/${id}`, { token: tokenA, body: { title: '', type: 'oylik', importance: 6 } })).status, 400);

  assert.equal((await api('DELETE', `/api/tasks/${id}`, { token: tokenA })).status, 204);
  assert.ok(!(await titles(tokenA)).includes('Yangi nom'));
  assert.equal((await api('DELETE', `/api/tasks/${id}`, { token: tokenA })).status, 404);
  assert.equal((await api('PUT', `/api/tasks/${id}`, { token: tokenA, body: { title: 'x', type: 'oylik', importance: 1 } })).status, 404);

  const restored = await api('POST', `/api/tasks/${id}/restore`, { token: tokenA });
  assert.equal(restored.status, 200);
  assert.ok((await titles(tokenA)).includes('Yangi nom'));
  assert.equal((await api('DELETE', '/api/tasks/abc', { token: tokenA })).status, 404);
});

test("IDOR: boshqa foydalanuvchi vazifasini ko'ra, o'zgartira, o'chira, qaytara olmaydi", async () => {
  const mine = (await api('GET', '/api/tasks', { token: tokenA })).data.tasks[0];
  assert.equal((await api('GET', '/api/tasks', { token: tokenB })).data.tasks.length, 0);
  assert.equal((await api('POST', `/api/tasks/${mine.id}/toggle`, { token: tokenB })).status, 404);
  assert.equal((await api('PUT', `/api/tasks/${mine.id}`, { token: tokenB, body: { title: 'buzish', type: 'doimiy', importance: 1 } })).status, 404);
  assert.equal((await api('DELETE', `/api/tasks/${mine.id}`, { token: tokenB })).status, 404);
  assert.equal((await api('POST', `/api/tasks/${mine.id}/restore`, { token: tokenB })).status, 404);
  const still = (await api('GET', '/api/tasks', { token: tokenA })).data.tasks.find((t) => t.id === mine.id);
  assert.equal(still.title, mine.title);
  const report = await api('GET', '/api/reports?period=week', { token: tokenB });
  assert.equal(report.data.summary.expected, 0, "B hisobotida A ning vazifalari yo'q");
});

test('hisobotlar: kun/hafta/oy, davr tekshiruvi', async () => {
  const day = await api('GET', '/api/reports?period=day', { token: tokenA });
  assert.equal(day.status, 200);
  assert.equal(day.data.range.label, 'Bugun');
  assert.equal(day.data.activity.length, 24);
  assert.ok(day.data.summary.expected >= 1);
  assert.equal(day.data.done.find((o) => o.title === 'Sport').completed_label, '29.09.2026 10:00');

  const week = await api('GET', '/api/reports?period=week', { token: tokenA });
  assert.equal(week.data.activity.length, 7);
  assert.equal(week.data.trend.length, 8);

  const lastMonth = await api('GET', '/api/reports?period=month&offset=-1', { token: tokenA });
  assert.equal(lastMonth.data.range.label, "O'tgan oy");
  assert.equal((await api('GET', '/api/reports?period=week&offset=1', { token: tokenA })).status, 400);
  assert.equal((await api('GET', '/api/reports?period=week&offset=abc', { token: tokenA })).status, 400);
  assert.equal((await api('GET', '/api/reports')).status, 401);
});

test('sozlamalar: eslatma chegarasi', async () => {
  assert.equal((await api('PUT', '/api/settings', { token: tokenA, body: { reminder_min_importance: 11 } })).status, 400);
  const ok = await api('PUT', '/api/settings', { token: tokenA, body: { reminder_min_importance: 9 } });
  assert.equal(ok.status, 200);
  assert.equal((await api('GET', '/api/me', { token: tokenA })).data.settings.reminder_min_importance, 9);
});

test('AI: taklif, reja va xato holati', async () => {
  const s = await api('POST', '/api/ai/suggest', { token: tokenA, body: { title: 'Soliq hisobotini topshirish' } });
  assert.equal(s.status, 200);
  assert.deepEqual(s.data.suggestion, { importance: 9, type: 'kunlik', reason: 'Sinov sababi' });
  assert.equal((await api('POST', '/api/ai/suggest', { token: tokenA, body: { title: '' } })).status, 400);
  const err = await api('POST', '/api/ai/suggest', { token: tokenA, body: { title: 'xato' } });
  assert.equal(err.status, 503);
  assert.equal(err.data.error, 'AI hozir band');
  const plan = await api('POST', '/api/ai/plan', { token: tokenA });
  assert.equal(plan.status, 200);
  assert.match(plan.data.text, /^Birinchi: /);
  assert.equal((await api('POST', '/api/ai/plan')).status, 401);
});

test("AI va Telegram o'chiq bo'lsa 503", async () => {
  const app = createApp({ pool, jwtSecret: 'test-secret' });
  const srv = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const url = `http://127.0.0.1:${srv.address().port}`;
  const headers = { Authorization: `Bearer ${tokenA}` };
  assert.equal((await fetch(`${url}/api/ai/plan`, { method: 'POST', headers })).status, 503);
  assert.equal((await fetch(`${url}/api/telegram/link`, { method: 'POST', headers })).status, 503);
  await new Promise((resolve) => srv.close(resolve));
});

test('Telegram: ulash havolasi va uzish', async () => {
  const res = await api('POST', '/api/telegram/link', { token: tokenA });
  assert.equal(res.status, 200);
  assert.equal(res.data.url, 'https://t.me/vazifa_test_bot?start=abc123def456');
  const { rows } = await pool.query("SELECT telegram_link_code FROM users WHERE email = 'ravshan@example.uz'");
  assert.equal(rows[0].telegram_link_code, 'abc123def456');
  assert.equal((await api('DELETE', '/api/telegram/link', { token: tokenA })).status, 204);
});

test("noma'lum manzil 404, buzuq JSON 400", async () => {
  assert.equal((await api('GET', '/api/yoq')).status, 404);
  const res = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{buzuq' });
  assert.equal(res.status, 400);
});
