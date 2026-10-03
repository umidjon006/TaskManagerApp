// Barcha SQL so'rovlar. db — platform/ adapteri; bu fayl SQLite drayverini to'g'ridan-to'g'ri import qilmaydi.
// Sanalar ISO 8601 UTC satri sifatida yoziladi. Parametrlar — pozitsion '?'.
import { currentKeys } from '../core/time.js';
import { publicTask, compareTasks } from '../core/validate.js';

const iso = (date) => date.toISOString();

// Faol (o'chirilmagan) vazifalar joriy davrdagi holati bilan, saralangan.
export async function loadActiveTasks(db, now, tz) {
  const keys = currentKeys(now, tz);
  const tasks = await db.all('SELECT * FROM tasks WHERE deleted_at IS NULL');
  const completions = await db.all(
    'SELECT task_id, period_key, completed_at FROM task_completions WHERE period_key IN (?, ?, ?, ?)',
    [keys.doimiy, keys.kunlik, keys.haftalik, keys.oylik],
  );
  const byKey = new Map(completions.map((c) => [`${c.task_id}|${c.period_key}`, c]));
  return tasks
    .map((t) => publicTask(t, byKey.get(`${t.id}|${keys[t.type]}`), now))
    .sort(compareTasks);
}

// Hisobotlar uchun: o'chirilganlari bilan birga barcha vazifalar va bajarilishlar tarixi.
export async function loadHistory(db) {
  const tasks = await db.all('SELECT * FROM tasks');
  const completions = await db.all('SELECT task_id, period_key, completed_at FROM task_completions');
  return { tasks, completions };
}

export async function findTask(db, id, { includeDeleted = false } = {}) {
  if (!Number.isInteger(id) || id <= 0) return null;
  const row = await db.get(
    `SELECT * FROM tasks WHERE id = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`,
    [id],
  );
  return row || null;
}

export async function currentCompletion(db, task, now, tz) {
  const key = currentKeys(now, tz)[task.type];
  const row = await db.get(
    'SELECT task_id, period_key, completed_at FROM task_completions WHERE task_id = ? AND period_key = ?',
    [task.id, key],
  );
  return row || null;
}

export async function markDone(db, task, now, tz) {
  const key = currentKeys(now, tz)[task.type];
  await db.run(
    'INSERT OR IGNORE INTO task_completions (task_id, period_key, completed_at) VALUES (?, ?, ?)',
    [task.id, key, iso(now)],
  );
}

export async function markUndone(db, task, now, tz) {
  const key = currentKeys(now, tz)[task.type];
  await db.run('DELETE FROM task_completions WHERE task_id = ? AND period_key = ?', [task.id, key]);
}

// value — validateTaskInput() natijasi. Yangi qatorni qaytaradi.
export async function createTask(db, value, now) {
  const { lastInsertRowid } = await db.run(
    `INSERT INTO tasks (title, description, type, importance, deadline, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [value.title, value.description, value.type, value.importance, value.deadline, iso(now), iso(now)],
  );
  return findTask(db, lastInsertRowid);
}

// O'chirilgan vazifani tahrirlab bo'lmaydi. Topilmasa — null.
export async function updateTask(db, id, value, now) {
  const { changes } = await db.run(
    `UPDATE tasks SET title = ?, description = ?, type = ?, importance = ?, deadline = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL`,
    [value.title, value.description, value.type, value.importance, value.deadline, iso(now), id],
  );
  return changes ? findTask(db, id) : null;
}

// Yumshoq o'chirish: ro'yxatdan yo'qoladi, hisobotlardagi tarix saqlanadi. O'chirildimi — true/false.
export async function softDeleteTask(db, id, now) {
  const { changes } = await db.run(
    'UPDATE tasks SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL',
    [iso(now), id],
  );
  return changes > 0;
}

// Topilmasa — null.
export async function restoreTask(db, id) {
  const { changes } = await db.run('UPDATE tasks SET deleted_at = NULL WHERE id = ?', [id]);
  return changes ? findTask(db, id) : null;
}

// Barcha sozlamalar { key: value } ko'rinishida.
export async function getSettings(db) {
  const rows = await db.all('SELECT key, value FROM settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function setSetting(db, key, value) {
  if (value === null || value === undefined) throw new TypeError(`Sozlama qiymati bo'sh: ${key}`);
  await db.run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    [key, String(value)],
  );
}
