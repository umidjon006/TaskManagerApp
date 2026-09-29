const { loadActiveTasks, loadHistory } = require('./tasks');
const { buildReport } = require('./reports');
const { localParts, isQuietHour, formatLocal, weekdayOf, monthEnd } = require('./time');
const { escapeHtml, dayFocus, dayStatusMessage, allDoneMessage, summaryMessage } = require('./messages');

// Har daqiqada chaqiriladi. Uch xil xabar:
//  1) Har soatda — BUGUNGI holat: nima bajarildi, nima qoldi (tugmalar bilan).
//     Hammasi bajarilsa — bir marta tabrik va o'sha kuni boshqa soatlik xabar yo'q.
//     Jim soatlarda (QUIET_HOURS, masalan 23-7) yuborilmaydi.
//  2) Deadline'ga 1 soat qolganda va muddati o'tganda — bir martadan.
//  3) Kun yakuni (DAILY_SUMMARY_HOUR, standart 21:00) — kun hisoboti; yakshanba — hafta, oy oxiri — oy hisoboti ham.

const HOUR_MS = 60 * 60 * 1000;
const HOURLY_GAP_MS = HOUR_MS - 30 * 1000; // taymer siljishiga 30 soniya bardosh

async function claim(pool, taskId, kind, key) {
  const { rows } = await pool.query(
    `INSERT INTO reminder_log (task_id, kind, period_key) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING RETURNING task_id`,
    [taskId, kind, key],
  );
  return rows.length > 0;
}

async function unclaim(pool, taskId, kind, key) {
  await pool.query('DELETE FROM reminder_log WHERE task_id = $1 AND kind = $2 AND period_key = $3', [taskId, kind, key]);
}

// Jurnalga yozib, keyin yuboradi; yuborish muvaffaqiyatsiz bo'lsa yozuvni qaytaradi (keyingi daqiqada qayta urinadi).
async function sendOnce(ctx, task, kind, key, text) {
  if (!(await claim(ctx.pool, task.id, kind, key))) return 0;
  try {
    await ctx.telegram.sendMessage(ctx.user.telegram_chat_id, text, [[{ text: '✅ Bajarildi', callback_data: `done:${task.id}` }]]);
    return 1;
  } catch (err) {
    await unclaim(ctx.pool, task.id, kind, key);
    throw err;
  }
}

async function sendDailySummary(ctx) {
  const { pool, telegram, user, tz, now, local } = ctx;
  const history = await loadHistory(pool, user.id);
  const day = buildReport({ ...history, period: 'day', now, tz });
  const week = weekdayOf(local.date) === 6 ? buildReport({ ...history, period: 'week', now, tz }) : null;
  const month = monthEnd(local.date) === local.date ? buildReport({ ...history, period: 'month', now, tz }) : null;
  if (day.summary.expected === 0 && !week && !month) return 0; // aytadigan gap yo'q
  await telegram.sendMessage(user.telegram_chat_id, summaryMessage({ day, week, month }));
  return 1;
}

async function remindUser(ctx) {
  const { pool, telegram, user, tz, quiet, now, local, summaryHour } = ctx;
  const tasks = await loadActiveTasks(pool, user.id, now, tz);
  let sent = 0;

  // 3) Kun yakuni — soatlik xabardan oldin, bir tikda ikkalasi ketmasin.
  let summarySentNow = false;
  if (summaryHour !== null && local.hour >= summaryHour && user.last_summary_on !== local.date) {
    // Avval yuboramiz, keyin belgilaymiz: tarmoq xatosida keyingi daqiqada qayta urinadi.
    const count = await sendDailySummary(ctx);
    await pool.query('UPDATE users SET last_summary_on = $1 WHERE id = $2', [local.date, user.id]);
    if (count > 0) {
      await pool.query('UPDATE users SET last_hourly_reminder_at = $1 WHERE id = $2', [now, user.id]);
      summarySentNow = true;
      sent += count;
    }
  }

  // 1) Soatlik holat
  const last = user.last_hourly_reminder_at ? new Date(user.last_hourly_reminder_at).getTime() : 0;
  if (!summarySentNow && !isQuietHour(local.hour, quiet) && now.getTime() - last >= HOURLY_GAP_MS) {
    const focus = dayFocus(tasks, now, tz, user.reminder_min_importance);
    if (focus.pending.length > 0) {
      const { text, buttons } = dayStatusMessage(focus, now, tz);
      await telegram.sendMessage(user.telegram_chat_id, text, buttons);
      await pool.query('UPDATE users SET last_hourly_reminder_at = $1 WHERE id = $2', [now, user.id]);
      sent += 1;
    } else if (focus.doneToday.length > 0 && user.all_done_notified_on !== local.date) {
      await telegram.sendMessage(user.telegram_chat_id, allDoneMessage(focus.doneToday.length, local.date));
      await pool.query('UPDATE users SET all_done_notified_on = $1, last_hourly_reminder_at = $2 WHERE id = $3', [local.date, now, user.id]);
      sent += 1;
    }
  }

  // 2) Deadline ogohlantirishlari
  for (const task of tasks.filter((t) => !t.done && t.deadline)) {
    const left = Date.parse(task.deadline) - now.getTime();
    const when = formatLocal(new Date(task.deadline), tz);
    if (left <= 0) {
      sent += await sendOnce(ctx, task, 'overdue', task.deadline,
        `⚠️ <b>Muddati o'tdi:</b> ${escapeHtml(task.title)} (★${task.importance})\nDeadline: ${when}`);
    } else if (left <= HOUR_MS) {
      sent += await sendOnce(ctx, task, 'soon', task.deadline,
        `⏳ <b>1 soatdan kam qoldi:</b> ${escapeHtml(task.title)} (★${task.importance})\nDeadline: ${when}`);
    }
  }
  return sent;
}

async function runReminders({ pool, telegram, tz, quiet = null, summaryHour = 21, now = new Date(), log = console }) {
  if (!telegram || !telegram.enabled) return { sent: 0 };
  const local = localParts(now, tz);
  const { rows: users } = await pool.query(
    `SELECT id, full_name, telegram_chat_id, reminder_min_importance, last_hourly_reminder_at,
            all_done_notified_on, last_summary_on
       FROM users WHERE telegram_chat_id IS NOT NULL`,
  );

  let sent = 0;
  for (const user of users) {
    try {
      sent += await remindUser({ pool, telegram, user, tz, quiet, now, local, summaryHour });
    } catch (err) {
      // 403 — foydalanuvchi botni bloklagan; 400 "chat not found" — chat yo'q. Ulanishni uzamiz.
      if (err.code === 403 || (err.code === 400 && /chat not found/i.test(err.message))) {
        await pool.query('UPDATE users SET telegram_chat_id = NULL WHERE id = $1', [user.id]);
        log.log(`Foydalanuvchi #${user.id} botni bloklagan — Telegram uzildi`);
      } else {
        log.error(`Eslatma yuborishda xato (foydalanuvchi #${user.id}):`, err.message);
      }
    }
  }
  return { sent };
}

module.exports = { runReminders };
