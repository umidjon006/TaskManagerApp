const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const {
  validateTaskInput, publicTask, loadActiveTasks, loadHistory, findOwnedTask, currentCompletion, markDone, markUndone,
} = require('./tasks');
const { buildReport, PERIODS } = require('./reports');
const { TASK_TYPES } = require('./time');
const { AiError } = require('./ai');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LINK_CODE_TTL_MS = 15 * 60 * 1000;

function publicUser(row) {
  return { id: row.id, full_name: row.full_name, email: row.email };
}

function clean(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function createApp({
  pool,
  jwtSecret,
  tz = 'Asia/Tashkent',
  quietHours = null,
  summaryHour = 21,
  ai = { enabled: false },
  telegram = { enabled: false, botUsername: null },
  authRateLimit = 20,
  aiRateLimit = 30,
  clock = () => new Date(),
}) {
  if (!jwtSecret) throw new Error('JWT_SECRET berilmagan');

  const app = express();
  // Nginx ortida ishlaymiz: haqiqiy mijoz IP'si X-Forwarded-For sarlavhasida keladi.
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '100kb' }));

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: authRateLimit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: "Juda ko'p urinish. 15 daqiqadan keyin qayta urinib ko'ring." },
  });

  // AI so'rovlari pulli — har bir foydalanuvchiga 15 daqiqada cheklov.
  const aiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: aiRateLimit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `user:${req.userId}`,
    message: { error: "AI so'rovlari limiti tugadi. 15 daqiqadan keyin urinib ko'ring." },
  });

  const signToken = (user) => jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: '30d' });
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  function requireAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Avval tizimga kiring' });
    try {
      req.userId = Number(jwt.verify(token, jwtSecret).sub);
      return next();
    } catch {
      return res.status(401).json({ error: 'Sessiya muddati tugagan, qayta kiring' });
    }
  }

  const ownedTask = (taskId, userId, opts) => findOwnedTask(pool, taskId, userId, opts);

  async function taskResponse(task, now) {
    return publicTask(task, await currentCompletion(pool, task, now, tz), now);
  }

  // ---------- Umumiy ----------

  app.get('/api/health', wrap(async (req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'ok', ai: ai.enabled, telegram: telegram.enabled });
  }));

  // ---------- Autentifikatsiya ----------

  app.post('/api/auth/register', authLimiter, wrap(async (req, res) => {
    const fullName = clean(req.body.full_name, 100);
    const email = clean(req.body.email, 255).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (fullName.length < 2) return res.status(400).json({ error: "Ism kamida 2 ta belgidan iborat bo'lsin" });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Email noto'g'ri formatda" });
    if (password.length < 6) return res.status(400).json({ error: "Parol kamida 6 ta belgidan iborat bo'lsin" });
    if (password.length > 72) return res.status(400).json({ error: '72 belgidan uzun parol qabul qilinmaydi' });

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) return res.status(409).json({ error: "Bu email bilan allaqachon ro'yxatdan o'tilgan" });

    const passwordHash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, full_name, email',
      [fullName, email, passwordHash],
    );
    const user = publicUser(rows[0]);
    res.status(201).json({ token: signToken(user), user });
  }));

  app.post('/api/auth/login', authLimiter, wrap(async (req, res) => {
    const email = clean(req.body.email, 255).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const { rows } = await pool.query('SELECT id, full_name, email, password_hash FROM users WHERE email = $1', [email]);
    const row = rows[0];
    // Email yoki parol — qaysi biri xato ekanini aytmaymiz (hisob mavjudligini oshkor qilmaslik uchun).
    if (!row || !(await bcrypt.compare(password, row.password_hash))) {
      return res.status(401).json({ error: "Email yoki parol noto'g'ri" });
    }
    const user = publicUser(row);
    res.json({ token: signToken(user), user });
  }));

  app.get('/api/me', requireAuth, wrap(async (req, res) => {
    const { rows } = await pool.query(
      'SELECT id, full_name, email, telegram_chat_id, reminder_min_importance FROM users WHERE id = $1',
      [req.userId],
    );
    const row = rows[0];
    if (!row) return res.status(401).json({ error: 'Foydalanuvchi topilmadi' });
    res.json({
      user: publicUser(row),
      settings: { reminder_min_importance: row.reminder_min_importance },
      telegram: {
        enabled: telegram.enabled,
        connected: Boolean(row.telegram_chat_id),
        bot_username: telegram.botUsername || null,
      },
      ai: { enabled: ai.enabled },
      timezone: tz,
      quiet_hours: quietHours
        ? `${String(quietHours.start).padStart(2, '0')}:00–${String(quietHours.end).padStart(2, '0')}:00`
        : null,
      summary_hour: summaryHour === null ? null : `${String(summaryHour).padStart(2, '0')}:00`,
    });
  }));

  app.put('/api/settings', requireAuth, wrap(async (req, res) => {
    const min = Number(req.body.reminder_min_importance);
    if (!Number.isInteger(min) || min < 1 || min > 10) {
      return res.status(400).json({ error: "Eslatma chegarasi 1 dan 10 gacha bo'lsin" });
    }
    await pool.query('UPDATE users SET reminder_min_importance = $1 WHERE id = $2', [min, req.userId]);
    res.json({ settings: { reminder_min_importance: min } });
  }));

  // ---------- Vazifalar ----------

  app.get('/api/tasks', requireAuth, wrap(async (req, res) => {
    const now = clock();
    const all = await loadActiveTasks(pool, req.userId, now, tz);
    const type = req.query.type;
    const tasks = TASK_TYPES.includes(type) ? all.filter((t) => t.type === type) : all;
    const pending = all.filter((t) => !t.done);
    res.json({
      tasks,
      summary: {
        total: all.length,
        pending: pending.length,
        done: all.length - pending.length,
        important_pending: pending.filter((t) => t.importance >= 8).length,
        overdue: pending.filter((t) => t.overdue).length,
      },
    });
  }));

  app.post('/api/tasks', requireAuth, wrap(async (req, res) => {
    const { error, value } = validateTaskInput(req.body);
    if (error) return res.status(400).json({ error });
    const now = clock();
    const { rows } = await pool.query(
      `INSERT INTO tasks (user_id, title, description, type, importance, deadline, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING *`,
      [req.userId, value.title, value.description, value.type, value.importance, value.deadline, now],
    );
    res.status(201).json({ task: publicTask(rows[0], null, now) });
  }));

  app.put('/api/tasks/:id', requireAuth, wrap(async (req, res) => {
    const task = await ownedTask(Number(req.params.id), req.userId);
    if (!task) return res.status(404).json({ error: 'Vazifa topilmadi' });
    const { error, value } = validateTaskInput(req.body);
    if (error) return res.status(400).json({ error });
    const now = clock();
    const { rows } = await pool.query(
      `UPDATE tasks SET title = $1, description = $2, type = $3, importance = $4, deadline = $5, updated_at = $6
        WHERE id = $7 AND user_id = $8 RETURNING *`,
      [value.title, value.description, value.type, value.importance, value.deadline, now, task.id, req.userId],
    );
    res.json({ task: await taskResponse(rows[0], now) });
  }));

  // Bajarildi ↔ bajarilmadi. Har bir bajarilish davr kaliti bilan tarixga yoziladi,
  // shuning uchun takrorlanuvchi vazifa yangi davrda o'zi "bajarilmagan" bo'ladi, hisobotlar esa saqlanadi.
  app.post('/api/tasks/:id/toggle', requireAuth, wrap(async (req, res) => {
    const task = await ownedTask(Number(req.params.id), req.userId);
    if (!task) return res.status(404).json({ error: 'Vazifa topilmadi' });
    const now = clock();
    if (await currentCompletion(pool, task, now, tz)) await markUndone(pool, task, now, tz);
    else await markDone(pool, task, now, tz);
    res.json({ task: await taskResponse(task, now) });
  }));

  // Yumshoq o'chirish: ro'yxatdan yo'qoladi, lekin hisobotlardagi tarix saqlanadi va "Qaytarish" mumkin.
  app.delete('/api/tasks/:id', requireAuth, wrap(async (req, res) => {
    const task = await ownedTask(Number(req.params.id), req.userId);
    if (!task) return res.status(404).json({ error: 'Vazifa topilmadi' });
    await pool.query('UPDATE tasks SET deleted_at = $1 WHERE id = $2 AND user_id = $3', [clock(), task.id, req.userId]);
    res.status(204).end();
  }));

  app.post('/api/tasks/:id/restore', requireAuth, wrap(async (req, res) => {
    const task = await ownedTask(Number(req.params.id), req.userId, { includeDeleted: true });
    if (!task) return res.status(404).json({ error: 'Vazifa topilmadi' });
    const { rows } = await pool.query(
      'UPDATE tasks SET deleted_at = NULL WHERE id = $1 AND user_id = $2 RETURNING *',
      [task.id, req.userId],
    );
    res.json({ task: await taskResponse(rows[0], clock()) });
  }));

  // ---------- Hisobotlar ----------

  app.get('/api/reports', requireAuth, wrap(async (req, res) => {
    const period = PERIODS.includes(req.query.period) ? req.query.period : 'day';
    const offset = Number(req.query.offset || 0);
    if (!Number.isInteger(offset) || offset > 0 || offset < -120) {
      return res.status(400).json({ error: "Davr noto'g'ri tanlangan" });
    }
    const history = await loadHistory(pool, req.userId);
    res.json(buildReport({ ...history, period, offset, now: clock(), tz }));
  }));

  // ---------- AI ----------

  function requireAi(req, res, next) {
    if (!ai.enabled) return res.status(503).json({ error: "AI yoqilmagan: serverdagi .env faylida ANTHROPIC_API_KEY yo'q" });
    return next();
  }

  app.post('/api/ai/suggest', requireAuth, requireAi, aiLimiter, wrap(async (req, res) => {
    const title = clean(req.body.title, 200);
    const description = clean(req.body.description, 2000);
    if (!title) return res.status(400).json({ error: 'Avval vazifa nomini yozing' });
    res.json({ suggestion: await ai.suggest({ title, description }) });
  }));

  app.post('/api/ai/plan', requireAuth, requireAi, aiLimiter, wrap(async (req, res) => {
    const now = clock();
    const pending = (await loadActiveTasks(pool, req.userId, now, tz)).filter((t) => !t.done);
    res.json(await ai.plan({ tasks: pending, now, tz }));
  }));

  // ---------- Telegram ----------

  app.post('/api/telegram/link', requireAuth, wrap(async (req, res) => {
    if (!telegram.enabled) {
      return res.status(503).json({ error: "Telegram bot yoqilmagan: serverdagi .env faylida TELEGRAM_BOT_TOKEN yo'q yoki noto'g'ri" });
    }
    if (!telegram.botUsername) return res.status(503).json({ error: 'Telegram bot hali ishga tushmadi. Bir necha soniyadan keyin urinib ko\'ring.' });
    const code = telegram.newLinkCode();
    const expiresAt = new Date(clock().getTime() + LINK_CODE_TTL_MS);
    await pool.query(
      'UPDATE users SET telegram_link_code = $1, telegram_link_expires_at = $2 WHERE id = $3',
      [code, expiresAt, req.userId],
    );
    res.json({
      code,
      url: `https://t.me/${telegram.botUsername}?start=${code}`,
      bot_username: telegram.botUsername,
      expires_at: expiresAt.toISOString(),
    });
  }));

  app.delete('/api/telegram/link', requireAuth, wrap(async (req, res) => {
    await pool.query(
      'UPDATE users SET telegram_chat_id = NULL, telegram_link_code = NULL, telegram_link_expires_at = NULL WHERE id = $1',
      [req.userId],
    );
    res.status(204).end();
  }));

  // ---------- Xatolar ----------

  app.use('/api', (req, res) => res.status(404).json({ error: "Bunday API manzili yo'q" }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: "JSON noto'g'ri formatda" });
    if (err instanceof AiError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Serverda xatolik yuz berdi' });
  });

  return app;
}

module.exports = { createApp };
