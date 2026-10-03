// sql.js adapteri Node'da sinaladi: wasm'ni sql.js o'zi topadi, IndexedDB o'rniga — xotiradagi persist.
// web.js (wasm ?url va IndexedDB) faqat brauzerda ishlaydi va bu yerda sinalmaydi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import initSqlJs from 'sql.js';
import { createSqlJsAdapter } from '../../src/platform/sqljs.js';
import { openDatabase as openNode } from '../../src/platform/node.js';
import { createStore } from '../../src/features/store.js';

const SCHEMA_SQL = readFileSync(new URL('../../src/data/schema.sql', import.meta.url), 'utf8');
const SQL = await initSqlJs();
const NOW = new Date('2026-10-01T10:00:00Z');
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

function memoryPersist() {
  const saves = [];
  return { saves, persist: async (bytes) => { saves.push(bytes); } };
}

test("interfeys node adapteri bilan bir xil: run/all/get/exec natija shakli", async () => {
  const sql = 'CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, n INTEGER)';
  for (const db of [openNode(':memory:'), createSqlJsAdapter(SQL)]) {
    await db.exec(sql);
    assert.deepEqual(await db.run('INSERT INTO t (name, n) VALUES (?, ?)', ['a', 1]), { lastInsertRowid: 1, changes: 1 });
    assert.deepEqual(await db.run('INSERT INTO t (name, n) VALUES (?, ?)', ['b', 2]), { lastInsertRowid: 2, changes: 1 });
    assert.deepEqual(await db.run('UPDATE t SET n = n + 1', []), { lastInsertRowid: 2, changes: 2 });
    assert.deepEqual(await db.all('SELECT name, n FROM t ORDER BY id'), [{ name: 'a', n: 2 }, { name: 'b', n: 3 }]);
    assert.deepEqual(await db.get('SELECT name FROM t WHERE id = ?', [2]), { name: 'b' });
    assert.equal(await db.get('SELECT name FROM t WHERE id = ?', [99]), undefined);
    assert.deepEqual(await db.get('SELECT NULL AS x'), { x: null });
    await db.close();
  }
});

test('debounce: ketma-ket yozuvlar bitta saqlashga birlashadi', async () => {
  const { saves, persist } = memoryPersist();
  const db = createSqlJsAdapter(SQL, { persist, delay: 30 });
  await db.exec('CREATE TABLE t (x)');
  for (let i = 0; i < 5; i += 1) await db.run('INSERT INTO t VALUES (?)', [i]);
  assert.equal(saves.length, 0);
  await tick(80);
  assert.equal(saves.length, 1);
  await db.all('SELECT * FROM t');
  await tick(80);
  assert.equal(saves.length, 1, "o'qish saqlashni chaqirmaydi");
});

test('saqlangan baytlardan tiklanadi', async () => {
  const { saves, persist } = memoryPersist();
  const db = createSqlJsAdapter(SQL, { persist, delay: 10 });
  await db.exec('CREATE TABLE t (x TEXT)');
  await db.run('INSERT INTO t VALUES (?)', ['salom']);
  await db.flush();
  const restored = createSqlJsAdapter(SQL, { bytes: saves.at(-1) });
  assert.deepEqual(await restored.all('SELECT x FROM t'), [{ x: 'salom' }]);
});

test("export'dan keyin foreign_keys yoqiq qoladi (sql.js export bazani qayta ochadi)", async () => {
  const db = createSqlJsAdapter(SQL, { delay: 10 });
  await db.exec('PRAGMA foreign_keys = ON');
  await db.exec('CREATE TABLE t (x)');
  await db.flush();
  assert.equal((await db.get('PRAGMA foreign_keys')).foreign_keys, 1);
});

test('ochiq tranzaksiya ichida saqlanmaydi — COMMIT dan keyin saqlanadi', async () => {
  const { saves, persist } = memoryPersist();
  const db = createSqlJsAdapter(SQL, { persist, delay: 10 });
  await db.exec('CREATE TABLE t (x)');
  await db.flush();
  await db.exec('BEGIN');
  await db.run('INSERT INTO t VALUES (1)');
  await db.flush();
  await tick(40);
  assert.equal(saves.length, 1, 'tranzaksiya ichida export qilinmadi');
  await db.exec('COMMIT');
  await db.flush();
  assert.equal(saves.length, 2);
  const restored = createSqlJsAdapter(SQL, { bytes: saves.at(-1) });
  assert.deepEqual(await restored.all('SELECT x FROM t'), [{ x: 1 }]);
});

test("store sql.js adapterida ham ishlaydi va saqlangandan keyin tiklanadi", async () => {
  const { saves, persist } = memoryPersist();
  const db = createSqlJsAdapter(SQL, { persist, delay: 10 });
  const store = createStore(db, { migrations: [SCHEMA_SQL], clock: () => NOW });
  await store.init();
  const { task } = await store.createTask({ title: 'Brauzerda', type: 'kunlik', importance: 6 });
  await store.toggleTask(task.id);
  await store.updateSettings({ reminder_min_importance: 9 });
  await db.flush();

  const reopened = createStore(createSqlJsAdapter(SQL, { bytes: saves.at(-1) }), { migrations: [SCHEMA_SQL], clock: () => NOW });
  await reopened.init();
  const { tasks } = await reopened.listTasks();
  assert.deepEqual(tasks.map((t) => [t.title, t.done]), [['Brauzerda', true]]);
  assert.equal((await reopened.getMe()).settings.reminder_min_importance, 9);
  assert.equal((await reopened.getReport('day')).summary.done, 1);
});
