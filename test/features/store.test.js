import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../../src/platform/node.js';
import { createStore, DEFAULT_SETTINGS } from '../../src/features/store.js';

const SCHEMA_SQL = readFileSync(new URL('../../src/data/schema.sql', import.meta.url), 'utf8');
const MIGRATIONS = [SCHEMA_SQL];

// Toshkent vaqti (UTC+5) bo'yicha sana: at('2026-09-29T10:00:00') → o'sha lahzaning Date'i.
const at = (localIso) => new Date(new Date(`${localIso}Z`).getTime() - 5 * 3600 * 1000);

// "Hozir": 2026-10-01 (payshanba) 15:00 Toshkent. Hafta: 28-sen (Du) – 4-okt (Ya).
const NOW = at('2026-10-01T15:00:00');

// clock o'zgaruvchan — "ertaga" kabi holatlarni sinash uchun.
async function freshStore({ db = openDatabase(':memory:'), now = NOW } = {}) {
  const clock = { now };
  const store = createStore(db, { migrations: MIGRATIONS, clock: () => clock.now });
  await store.init();
  return { store, db, clock };
}

const input = (fields) => ({ title: 'Vazifa', description: '', type: 'doimiy', importance: 5, deadline: null, ...fields });

test('init: migratsiya va standart sozlamalar yoziladi', async () => {
  const { db } = await freshStore();
  assert.equal((await db.get('PRAGMA user_version')).user_version, 1);
  const rows = await db.all('SELECT key, value FROM settings ORDER BY key');
  assert.deepEqual(Object.fromEntries(rows.map((r) => [r.key, r.value])), DEFAULT_SETTINGS);
});

test("init: qayta chaqirilsa mavjud sozlamalar ustidan yozilmaydi", async () => {
  const { store, db } = await freshStore();
  await store.updateSettings({ reminder_min_importance: 8 });
  const again = createStore(db, { migrations: MIGRATIONS, clock: () => NOW });
  await again.init();
  assert.equal((await again.getMe()).settings.reminder_min_importance, 8);
});

test('init: sxemasiz chaqirilsa xato', async () => {
  const store = createStore(openDatabase(':memory:'));
  await assert.rejects(store.init(), /sxemasi berilmagan/);
});

test("init'dan oldin chaqirilsa tushunarli xato", async () => {
  const store = createStore(openDatabase(':memory:'), { migrations: MIGRATIONS });
  await assert.rejects(store.listTasks(), /tayyor emas/);
  await assert.rejects(store.createTask(input()), /tayyor emas/);
});

test("listTasks: { tasks } — muhimlik bo'yicha saralangan", async () => {
  const { store } = await freshStore();
  assert.deepEqual(await store.listTasks(), { tasks: [] });
  await store.createTask(input({ title: 'Past', importance: 2 }));
  await store.createTask(input({ title: 'Yuqori', importance: 9 }));
  const { tasks } = await store.listTasks();
  assert.deepEqual(tasks.map((t) => t.title), ['Yuqori', 'Past']);
});

test('createTask: { task } qaytaradi; noto\'g\'ri kiritma — o\'zbekcha xato', async () => {
  const { store } = await freshStore();
  const { task } = await store.createTask(input({ title: '  Hisobot  ', type: 'kunlik', importance: 7 }));
  assert.equal(task.title, 'Hisobot');
  assert.equal(task.type, 'kunlik');
  assert.equal(task.importance, 7);
  assert.equal(task.done, false);
  assert.ok(Number.isInteger(task.id));
  await assert.rejects(store.createTask(input({ title: '' })), { message: 'Vazifa nomini kiriting' });
  await assert.rejects(store.createTask(input({ importance: 11 })), /1 dan 10 gacha/);
  await assert.rejects(store.createTask(undefined), { message: 'Vazifa nomini kiriting' });
});

test("updateTask: maydonlar yangilanadi, bajarilish holati saqlanadi", async () => {
  const { store } = await freshStore();
  const { task } = await store.createTask(input({ title: 'Eski' }));
  await store.toggleTask(task.id);
  const { task: updated } = await store.updateTask(task.id, input({ title: 'Yangi', importance: 9 }));
  assert.equal(updated.title, 'Yangi');
  assert.equal(updated.importance, 9);
  assert.equal(updated.done, true);
  await assert.rejects(store.updateTask(task.id, input({ title: '' })), { message: 'Vazifa nomini kiriting' });
});

test("noto'g'ri id — 'Vazifa topilmadi' (barcha id qabul qiluvchi funksiyalar)", async () => {
  const { store } = await freshStore();
  for (const id of [999, 0, -1, 1.5, '1', null, undefined]) {
    await assert.rejects(store.updateTask(id, input()), { message: 'Vazifa topilmadi' });
    await assert.rejects(store.deleteTask(id), { message: 'Vazifa topilmadi' });
    await assert.rejects(store.restoreTask(id), { message: 'Vazifa topilmadi' });
    await assert.rejects(store.toggleTask(id), { message: 'Vazifa topilmadi' });
  }
});

test("deleteTask: yumshoq o'chirish — ro'yxatdan yo'qoladi, tahrir/toggle/qayta o'chirish mumkin emas", async () => {
  const { store, db } = await freshStore();
  const { task } = await store.createTask(input());
  assert.equal(await store.deleteTask(task.id), undefined);
  assert.deepEqual((await store.listTasks()).tasks, []);
  assert.ok((await db.get('SELECT deleted_at FROM tasks WHERE id = ?', [task.id])).deleted_at);
  await assert.rejects(store.deleteTask(task.id), { message: 'Vazifa topilmadi' });
  await assert.rejects(store.updateTask(task.id, input()), { message: 'Vazifa topilmadi' });
  await assert.rejects(store.toggleTask(task.id), { message: 'Vazifa topilmadi' });
});

test("restoreTask: o'chirilgan vazifa bajarilish holati bilan qaytadi", async () => {
  const { store } = await freshStore();
  const { task } = await store.createTask(input({ title: 'Qaytadi' }));
  await store.toggleTask(task.id);
  await store.deleteTask(task.id);
  const { task: restored } = await store.restoreTask(task.id);
  assert.equal(restored.id, task.id);
  assert.equal(restored.done, true);
  assert.deepEqual((await store.listTasks()).tasks.map((t) => t.id), [task.id]);
});

test('toggleTask: ikki yo\'nalishda — bajarildi ↔ bajarilmadi', async () => {
  const { store } = await freshStore();
  const { task } = await store.createTask(input({ type: 'kunlik' }));
  const first = await store.toggleTask(task.id);
  assert.equal(first.task.done, true);
  assert.equal(first.task.completed_at, NOW.toISOString());
  const second = await store.toggleTask(task.id);
  assert.equal(second.task.done, false);
  assert.equal(second.task.completed_at, null);
  assert.equal((await store.listTasks()).tasks[0].done, false);
});

test('toggleTask: kunlik vazifa ertaga yana bajarilmagan', async () => {
  const { store, clock } = await freshStore();
  const { task } = await store.createTask(input({ type: 'kunlik' }));
  await store.toggleTask(task.id);
  clock.now = at('2026-10-02T09:00:00');
  assert.equal((await store.listTasks()).tasks[0].done, false);
});

test('getReport: day / week / month — core hisobotidan', async () => {
  const { store, clock } = await freshStore({ now: at('2026-09-28T08:00:00') });
  const { task } = await store.createTask(input({ type: 'kunlik' }));
  clock.now = NOW;
  await store.toggleTask(task.id);

  const day = await store.getReport('day', 0);
  assert.equal(day.period, 'day');
  assert.equal(day.range.start, '2026-10-01');
  assert.equal(day.summary.done, 1);

  const week = await store.getReport('week');
  assert.deepEqual([week.period, week.offset, week.range.start, week.range.end], ['week', 0, '2026-09-28', '2026-10-04']);
  assert.equal(week.summary.done, 1);

  const month = await store.getReport('month', -1);
  assert.deepEqual([month.range.start, month.range.end], ['2026-09-01', '2026-09-30']);

  assert.equal((await store.getReport()).period, 'day');
});

test("getReport: noto'g'ri davr yoki offset — xato", async () => {
  const { store } = await freshStore();
  for (const [period, offset] of [['year', 0], ['day', 1], ['day', -121], ['week', 0.5], ['day', '0']]) {
    await assert.rejects(store.getReport(period, offset), { message: "Davr noto'g'ri tanlangan" });
  }
});

test("getMe: user yo'q, telegram ulanmagan, sozlamalar ko'rinish formatida", async () => {
  const { store } = await freshStore();
  assert.deepEqual(await store.getMe(), {
    telegram: { connected: false },
    settings: { reminder_min_importance: 5 },
    quiet_hours: '22:00–07:00',
    summary_hour: '21:00',
    timezone: 'Asia/Tashkent',
  });
});

test('updateSettings: saqlanadi va yangi store ochilganda ham turadi', async () => {
  const { store, db } = await freshStore();
  const me = await store.updateSettings({ reminder_min_importance: '8', quiet_hours: '23-6', summary_hour: 20 });
  assert.equal(me.settings.reminder_min_importance, 8);
  assert.equal(me.quiet_hours, '23:00–06:00');
  assert.equal(me.summary_hour, '20:00');

  const reopened = createStore(db, { migrations: MIGRATIONS, clock: () => NOW });
  await reopened.init();
  assert.deepEqual(await reopened.getMe(), me);
});

test("updateSettings: bo'sh qiymat — o'chiq", async () => {
  const { store } = await freshStore();
  const me = await store.updateSettings({ quiet_hours: '', summary_hour: null });
  assert.equal(me.quiet_hours, null);
  assert.equal(me.summary_hour, null);
});

test('updateSettings: timezone o\'zgarsa davr kalitlari yangi zonada hisoblanadi', async () => {
  // 2026-10-01 21:30 UTC: Toshkentda allaqachon 2-oktabr, Londonda hali 1-oktabr.
  const { store } = await freshStore({ now: new Date('2026-10-01T21:30:00Z') });
  assert.equal((await store.getReport('day')).range.start, '2026-10-02');
  await store.updateSettings({ timezone: 'Europe/London' });
  assert.equal((await store.getMe()).timezone, 'Europe/London');
  assert.equal((await store.getReport('day')).range.start, '2026-10-01');
});

test("updateSettings: noto'g'ri qiymat — xato va hech narsa yozilmaydi", async () => {
  const { store } = await freshStore();
  const before = await store.getMe();
  await assert.rejects(store.updateSettings({ reminder_min_importance: 7, quiet_hours: '25-7' }), /Jim soatlar/);
  await assert.rejects(store.updateSettings({ reminder_min_importance: 0 }), /1 dan 10 gacha/);
  await assert.rejects(store.updateSettings({ summary_hour: 24 }), /0 dan 23 gacha/);
  await assert.rejects(store.updateSettings({ timezone: 'Mars/Olympus' }), /Vaqt zonasi/);
  await assert.rejects(store.updateSettings({ theme: 'dark' }), /Noma'lum sozlama: theme/);
  await assert.rejects(store.updateSettings(null), /Sozlamalar noto'g'ri/);
  assert.deepEqual(await store.getMe(), before);
});
