import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../../src/platform/node.js';
import { migrate } from '../../src/data/db.js';
import * as repo from '../../src/data/repo.js';

const SCHEMA_SQL = readFileSync(new URL('../../src/data/schema.sql', import.meta.url), 'utf8');
const MIGRATIONS = [SCHEMA_SQL];
const TZ = 'Asia/Tashkent';

// Toshkent vaqti (UTC+5) bo'yicha sana: at('2026-09-29T10:00:00') → o'sha lahzaning Date'i.
const at = (localIso) => new Date(new Date(`${localIso}Z`).getTime() - 5 * 3600 * 1000);

// "Hozir": 2026-10-01 (payshanba) 15:00 Toshkent. Hafta: 28-sen (Du) – 4-okt (Ya).
const NOW = at('2026-10-01T15:00:00');

async function freshDb() {
  const db = openDatabase(':memory:');
  await migrate(db, MIGRATIONS);
  return db;
}

const input = (fields) => ({ title: 'Vazifa', description: '', type: 'doimiy', importance: 5, deadline: null, ...fields });

async function stateOf(db, id, now) {
  return (await repo.loadActiveTasks(db, now, TZ)).find((t) => t.id === id);
}

test('migratsiya: user_version = 1, foreign_keys yoqilgan, qayta chaqirish xavfsiz', async () => {
  const db = await freshDb();
  assert.equal((await db.get('PRAGMA user_version')).user_version, 1);
  assert.equal((await db.get('PRAGMA foreign_keys')).foreign_keys, 1);
  await migrate(db, MIGRATIONS);
  assert.equal((await db.get('PRAGMA user_version')).user_version, 1);
});

test('migratsiya: v1 bazaga ikkinchi migratsiya qo\'shilsa, faqat u bajariladi va user_version = 2', async () => {
  const db = await freshDb();
  const task = await repo.createTask(db, input({ title: 'Eski' }), NOW);
  await migrate(db, [...MIGRATIONS, 'CREATE TABLE v2_test (id INTEGER PRIMARY KEY)']);
  assert.equal((await db.get('PRAGMA user_version')).user_version, 2);
  assert.ok(await db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'v2_test'"));
  // v1 qayta bajarilmadi — mavjud ma'lumot joyida.
  assert.equal((await stateOf(db, task.id, NOW)).title, 'Eski');
});

test('migratsiya: ilovadan yangi baza versiyasi rad etiladi', async () => {
  const db = openDatabase(':memory:');
  await db.exec('PRAGMA user_version = 99');
  await assert.rejects(migrate(db, MIGRATIONS), /yangiroq/);
});

test('kunlik: bugun done, ertaga yangi davrda yana pending', async () => {
  const db = await freshDb();
  const task = await repo.createTask(db, input({ type: 'kunlik' }), NOW);
  await repo.markDone(db, task, NOW, TZ);
  assert.equal((await stateOf(db, task.id, NOW)).done, true);
  assert.ok(await repo.currentCompletion(db, task, NOW, TZ));

  const tomorrow = at('2026-10-02T09:00:00');
  assert.equal((await stateOf(db, task.id, tomorrow)).done, false);
  assert.equal(await repo.currentCompletion(db, task, tomorrow, TZ), null);
  // Kechagi bajarilish tarixda qoladi.
  assert.equal((await repo.loadHistory(db)).completions.length, 1);
});

test('haftalik: yakshanbagacha done, dushanbadan pending', async () => {
  const db = await freshDb();
  const task = await repo.createTask(db, input({ type: 'haftalik' }), NOW);
  await repo.markDone(db, task, NOW, TZ);
  assert.equal((await stateOf(db, task.id, at('2026-10-04T23:59:00'))).done, true);
  assert.equal((await stateOf(db, task.id, at('2026-10-05T00:00:00'))).done, false);
});

test('oylik: oy oxirigacha done, keyingi oy pending', async () => {
  const db = await freshDb();
  const task = await repo.createTask(db, input({ type: 'oylik' }), NOW);
  await repo.markDone(db, task, NOW, TZ);
  assert.equal((await stateOf(db, task.id, at('2026-10-31T23:59:00'))).done, true);
  assert.equal((await stateOf(db, task.id, at('2026-11-01T00:00:00'))).done, false);
});

test('markDone ikki marta — bitta yozuv; markUndone o\'chiradi', async () => {
  const db = await freshDb();
  const task = await repo.createTask(db, input({ type: 'kunlik' }), NOW);
  await repo.markDone(db, task, NOW, TZ);
  await repo.markDone(db, task, NOW, TZ);
  assert.equal((await repo.loadHistory(db)).completions.length, 1);
  await repo.markUndone(db, task, NOW, TZ);
  assert.equal((await stateOf(db, task.id, NOW)).done, false);
});

test('softDelete: loadActiveTasks da yo\'q, loadHistory da bor; restore qaytaradi', async () => {
  const db = await freshDb();
  const task = await repo.createTask(db, input({}), NOW);
  await repo.markDone(db, task, NOW, TZ);

  assert.equal(await repo.softDeleteTask(db, task.id, NOW), true);
  assert.equal(await repo.softDeleteTask(db, task.id, NOW), false);
  assert.equal(await stateOf(db, task.id, NOW), undefined);
  assert.equal(await repo.findTask(db, task.id), null);
  assert.ok(await repo.findTask(db, task.id, { includeDeleted: true }));

  const history = await repo.loadHistory(db);
  assert.equal(history.tasks.find((t) => t.id === task.id).deleted_at, NOW.toISOString());
  assert.equal(history.completions.length, 1);

  const restored = await repo.restoreTask(db, task.id);
  assert.equal(restored.deleted_at, null);
  assert.equal((await stateOf(db, task.id, NOW)).done, true);
  assert.equal(await repo.restoreTask(db, 999), null);
});

test('CASCADE: vazifa haqiqiy o\'chsa completions ham ketadi', async () => {
  const db = await freshDb();
  const task = await repo.createTask(db, input({ type: 'kunlik' }), NOW);
  await repo.markDone(db, task, NOW, TZ);
  await db.run('DELETE FROM tasks WHERE id = ?', [task.id]);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM task_completions')).n, 0);
});

test('deadline o\'tgan bo\'lsa overdue=true, bajarilgan bo\'lsa false', async () => {
  const db = await freshDb();
  const late = await repo.createTask(db, input({ deadline: at('2026-10-01T12:00:00').toISOString() }), NOW);
  const future = await repo.createTask(db, input({ deadline: at('2026-10-02T12:00:00').toISOString() }), NOW);
  assert.equal((await stateOf(db, late.id, NOW)).overdue, true);
  assert.equal((await stateOf(db, future.id, NOW)).overdue, false);
  await repo.markDone(db, late, NOW, TZ);
  assert.equal((await stateOf(db, late.id, NOW)).overdue, false);
});

test('updateTask: maydonlar va updated_at yangilanadi; o\'chirilgan vazifa — null', async () => {
  const db = await freshDb();
  const task = await repo.createTask(db, input({}), NOW);
  const later = at('2026-10-01T16:00:00');
  const updated = await repo.updateTask(db, task.id, input({ title: 'Yangi', importance: 9 }), later);
  assert.equal(updated.title, 'Yangi');
  assert.equal(updated.importance, 9);
  assert.equal(updated.created_at, NOW.toISOString());
  assert.equal(updated.updated_at, later.toISOString());

  await repo.softDeleteTask(db, task.id, NOW);
  assert.equal(await repo.updateTask(db, task.id, input({}), later), null);
});

test('loadActiveTasks core/validate saralashidan foydalanadi', async () => {
  const db = await freshDb();
  const low = await repo.createTask(db, input({ importance: 2 }), NOW);
  const high = await repo.createTask(db, input({ importance: 9 }), NOW);
  const doneHigh = await repo.createTask(db, input({ importance: 10 }), NOW);
  await repo.markDone(db, doneHigh, NOW, TZ);
  const ids = (await repo.loadActiveTasks(db, NOW, TZ)).map((t) => t.id);
  assert.deepEqual(ids, [high.id, low.id, doneHigh.id]);
});

test('settings: yozish, ustidan yozish, o\'qish', async () => {
  const db = await freshDb();
  assert.deepEqual(await repo.getSettings(db), {});
  await repo.setSetting(db, 'reminder_min_importance', 8);
  await repo.setSetting(db, 'reminder_min_importance', 7);
  await repo.setSetting(db, 'tz', TZ);
  assert.deepEqual(await repo.getSettings(db), { reminder_min_importance: '7', tz: TZ });
  await assert.rejects(repo.setSetting(db, 'tz', null), TypeError);
});

test('CHECK cheklovlari: noto\'g\'ri tur va muhimlik rad etiladi', async () => {
  const db = await freshDb();
  await assert.rejects(repo.createTask(db, input({ type: 'yillik' }), NOW), /CHECK/);
  await assert.rejects(repo.createTask(db, input({ importance: 11 }), NOW), /CHECK/);
});
