const { TASK_TYPES, currentKeys } = require('./time');

function toIso(value) {
  if (!value) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

// Foydalanuvchidan kelgan vazifa ma'lumotini tekshiradi. Xato bo'lsa { error }, aks holda { value }.
function validateTaskInput(body) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const type = body.type;
  const importance = Number(body.importance);
  const deadlineRaw = body.deadline ? String(body.deadline).trim() : null;

  if (!title) return { error: 'Vazifa nomini kiriting' };
  if (title.length > 200) return { error: 'Vazifa nomi 200 belgidan oshmasin' };
  if (description.length > 2000) return { error: 'Izoh 2000 belgidan oshmasin' };
  if (!TASK_TYPES.includes(type)) return { error: "Turi: doimiy, kunlik, haftalik yoki oylik bo'lsin" };
  if (!Number.isInteger(importance) || importance < 1 || importance > 10) {
    return { error: "Muhimlik 1 dan 10 gacha yulduz bo'lsin" };
  }

  let deadline = null;
  if (deadlineRaw) {
    const parsed = new Date(deadlineRaw);
    if (Number.isNaN(parsed.getTime())) return { error: "Deadline sanasi noto'g'ri" };
    deadline = parsed.toISOString();
  }

  return { value: { title, description, type, importance, deadline } };
}

// completion — shu vazifaning JORIY davrdagi bajarilish yozuvi (yo'q bo'lsa — bajarilmagan).
function publicTask(row, completion, now) {
  const done = Boolean(completion);
  const deadline = toIso(row.deadline);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    type: row.type,
    importance: row.importance,
    deadline,
    completed_at: done ? toIso(completion.completed_at) : null,
    created_at: toIso(row.created_at),
    done,
    overdue: Boolean(deadline && !done && Date.parse(deadline) < now.getTime()),
  };
}

// Saralash: bajarilmaganlar tepada → muhimlik (10★ birinchi) → yaqin deadline → eski vazifa.
function compareTasks(a, b) {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (a.importance !== b.importance) return b.importance - a.importance;
  const da = a.deadline ? Date.parse(a.deadline) : Infinity;
  const db = b.deadline ? Date.parse(b.deadline) : Infinity;
  if (da !== db) return da - db;
  return a.id - b.id;
}

// ---------- Ma'lumotlar bazasi bilan ishlash ----------

// Faol (o'chirilmagan) vazifalar joriy davrdagi holati bilan, saralangan.
async function loadActiveTasks(pool, userId, now, tz) {
  const keys = currentKeys(now, tz);
  const { rows: tasks } = await pool.query(
    'SELECT * FROM tasks WHERE user_id = $1 AND deleted_at IS NULL',
    [userId],
  );
  const { rows: completions } = await pool.query(
    `SELECT c.task_id, c.period_key, c.completed_at
       FROM task_completions c JOIN tasks t ON t.id = c.task_id
      WHERE t.user_id = $1 AND c.period_key IN ($2, $3, $4, $5)`,
    [userId, keys.doimiy, keys.kunlik, keys.haftalik, keys.oylik],
  );
  const byKey = new Map(completions.map((c) => [`${c.task_id}|${c.period_key}`, c]));
  return tasks
    .map((t) => publicTask(t, byKey.get(`${t.id}|${keys[t.type]}`), now))
    .sort(compareTasks);
}

// Hisobotlar uchun: o'chirilganlari bilan birga barcha vazifalar va bajarilishlar tarixi.
async function loadHistory(pool, userId) {
  const { rows: tasks } = await pool.query('SELECT * FROM tasks WHERE user_id = $1', [userId]);
  const { rows: completions } = await pool.query(
    `SELECT c.task_id, c.period_key, c.completed_at
       FROM task_completions c JOIN tasks t ON t.id = c.task_id
      WHERE t.user_id = $1`,
    [userId],
  );
  return { tasks, completions };
}

// user_id sharti — boshqa foydalanuvchining vazifasiga tegib bo'lmaydi (IDOR himoyasi).
async function findOwnedTask(pool, taskId, userId, { includeDeleted = false } = {}) {
  if (!Number.isInteger(taskId) || taskId <= 0) return null;
  const { rows } = await pool.query(
    `SELECT * FROM tasks WHERE id = $1 AND user_id = $2 ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`,
    [taskId, userId],
  );
  return rows[0] || null;
}

async function currentCompletion(pool, task, now, tz) {
  const key = currentKeys(now, tz)[task.type];
  const { rows } = await pool.query(
    'SELECT task_id, period_key, completed_at FROM task_completions WHERE task_id = $1 AND period_key = $2',
    [task.id, key],
  );
  return rows[0] || null;
}

async function markDone(pool, task, now, tz) {
  const key = currentKeys(now, tz)[task.type];
  await pool.query(
    `INSERT INTO task_completions (task_id, period_key, completed_at) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [task.id, key, now],
  );
}

async function markUndone(pool, task, now, tz) {
  const key = currentKeys(now, tz)[task.type];
  await pool.query('DELETE FROM task_completions WHERE task_id = $1 AND period_key = $2', [task.id, key]);
}

module.exports = {
  validateTaskInput,
  publicTask,
  compareTasks,
  toIso,
  loadActiveTasks,
  loadHistory,
  findOwnedTask,
  currentCompletion,
  markDone,
  markUndone,
};
