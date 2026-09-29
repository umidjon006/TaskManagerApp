// Testlar uchun: haqiqiy Postgres o'rniga xotiradagi pg-mem bazasi va soxta Telegram.
const { newDb } = require('pg-mem');
const { SCHEMA_SQL } = require('../src/db');

function createMemoryPool() {
  const db = newDb();
  db.public.none(SCHEMA_SQL);
  const { Pool } = db.adapters.createPg();
  return new Pool();
}

// Telegram API'ga so'rov yubormaydi — yuborilgan xabarlarni massivga yozadi.
function createFakeTelegramApi() {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const method = url.split('/').pop();
    const body = JSON.parse(options.body);
    calls.push({ method, body });
    let result = true;
    if (method === 'getMe') result = { id: 1, is_bot: true, username: 'vazifa_test_bot' };
    if (method === 'sendMessage') result = { message_id: calls.length };
    if (method === 'getUpdates') result = [];
    return { status: 200, json: async () => ({ ok: true, result }) };
  };
  return { calls, fetchImpl, sent: () => calls.filter((c) => c.method === 'sendMessage').map((c) => c.body) };
}

async function createUser(pool, { name = 'Test', email = 'test@example.com', chatId = null, min = 8 } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO users (full_name, email, password_hash, telegram_chat_id, reminder_min_importance)
     VALUES ($1, $2, 'x', $3, $4) RETURNING id`,
    [name, email, chatId, min],
  );
  return rows[0].id;
}

async function createTask(pool, userId, fields) {
  const t = {
    description: '', type: 'doimiy', importance: 5, deadline: null,
    created_at: new Date('2026-01-01T00:00:00Z'), deleted_at: null, ...fields,
  };
  const { rows } = await pool.query(
    `INSERT INTO tasks (user_id, title, description, type, importance, deadline, created_at, deleted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [userId, t.title, t.description, t.type, t.importance, t.deadline, t.created_at, t.deleted_at],
  );
  return rows[0].id;
}

async function complete(pool, taskId, periodKey, completedAt) {
  await pool.query(
    'INSERT INTO task_completions (task_id, period_key, completed_at) VALUES ($1, $2, $3)',
    [taskId, periodKey, completedAt],
  );
}

// Toshkent vaqti (UTC+5) bo'yicha sana: at('2026-09-29T10:00:00') → o'sha lahzaning Date'i.
const at = (localIso) => new Date(new Date(`${localIso}Z`).getTime() - 5 * 3600 * 1000);

const silentLog = { log() {}, error() {} };

module.exports = { createMemoryPool, createFakeTelegramApi, createUser, createTask, complete, at, silentLog };
