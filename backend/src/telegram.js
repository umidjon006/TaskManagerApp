const crypto = require('crypto');
const { loadActiveTasks, loadHistory, findOwnedTask, currentCompletion, markDone } = require('./tasks');
const { buildReport } = require('./reports');
const { escapeHtml, formatTaskList, dayFocus, dayStatusMessage, allDoneMessage, reportBlock } = require('./messages');

// Domen va HTTPS yo'q — shuning uchun webhook emas, long polling (getUpdates) ishlatiladi.
// Bot serverdan Telegram'ga o'zi murojaat qiladi, tashqaridan hech qanday port ochish shart emas.

const HELP_TEXT = 'Buyruqlar:\n'
  + '/bugun — bugun nima bajarildi, nima qoldi\n'
  + "/vazifalar — barcha bajarilmagan vazifalar\n"
  + '/hisobot — kun va hafta hisoboti\n'
  + "/stop — eslatmalarni o'chirish";

class TelegramError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function createTelegram({ token, pool, tz, apiBase = 'https://api.telegram.org', log = console, fetchImpl = fetch }) {
  if (!token) return { enabled: false, botUsername: null };

  let botUsername = null;
  let offset = 0;
  let running = false;
  let invalidToken = false; // token noto'g'ri bo'lsa bot butunlay o'chadi va sayt buni ko'rsatadi

  async function call(method, params = {}, timeoutMs = 15_000) {
    let res;
    try {
      res = await fetchImpl(`${apiBase}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new TelegramError(`Telegram'ga ulanib bo'lmadi: ${err.message}`, 0);
    }
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw new TelegramError(data.description || `Telegram xatosi ${res.status}`, data.error_code || res.status);
    return data.result;
  }

  function sendMessage(chatId, text, buttons) {
    const params = { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true };
    if (buttons && buttons.length) params.reply_markup = { inline_keyboard: buttons };
    return call('sendMessage', params);
  }

  async function userByChat(chatId) {
    const { rows } = await pool.query(
      'SELECT id, full_name, reminder_min_importance FROM users WHERE telegram_chat_id = $1',
      [String(chatId)],
    );
    return rows[0] || null;
  }

  async function handleStart(chatId, code, now) {
    if (code) {
      const { rows } = await pool.query(
        `SELECT id, full_name FROM users
          WHERE telegram_link_code = $1 AND telegram_link_expires_at > $2`,
        [code, now],
      );
      const user = rows[0];
      if (!user) {
        return sendMessage(chatId, "❌ Ulash kodi noto'g'ri yoki muddati o'tgan. Saytdagi Sozlamalardan yangi havola oling.");
      }
      // Bu chat boshqa hisobga ulangan bo'lsa, avval uni uzamiz (bitta chat — bitta hisob).
      await pool.query('UPDATE users SET telegram_chat_id = NULL WHERE telegram_chat_id = $1 AND id <> $2', [String(chatId), user.id]);
      await pool.query(
        `UPDATE users SET telegram_chat_id = $1, telegram_link_code = NULL,
                telegram_link_expires_at = NULL, last_hourly_reminder_at = NULL
          WHERE id = $2`,
        [String(chatId), user.id],
      );
      return sendMessage(
        chatId,
        `✅ Salom, <b>${escapeHtml(user.full_name)}</b>! Telegram hisobingiz ulandi.\n\n`
          + "Har soatda bugun nima bajarildi va nima qolganini yuborib turaman, kechqurun esa kun yakunini.\n\n"
          + HELP_TEXT,
      );
    }
    const user = await userByChat(chatId);
    if (user) return sendMessage(chatId, `Salom, <b>${escapeHtml(user.full_name)}</b>!\n\n${HELP_TEXT}`);
    return sendMessage(chatId, "Salom! Botni ulash uchun saytga kiring → Sozlamalar → \"Telegramni ulash\" tugmasini bosing.");
  }

  async function withUser(chatId, fn) {
    const user = await userByChat(chatId);
    if (!user) return sendMessage(chatId, 'Avval saytdagi Sozlamalar orqali hisobingizni ulang.');
    return fn(user);
  }

  function handleList(chatId, now) {
    return withUser(chatId, async (user) => {
      const tasks = (await loadActiveTasks(pool, user.id, now, tz)).filter((t) => !t.done);
      if (tasks.length === 0) return sendMessage(chatId, "🎉 Bajarilmagan vazifa yo'q. Zo'r!");
      const { text, buttons } = formatTaskList(tasks, tz, `📋 Bajarilmagan vazifalar (${tasks.length} ta):`, { now });
      return sendMessage(chatId, text, buttons);
    });
  }

  function handleToday(chatId, now) {
    return withUser(chatId, async (user) => {
      const focus = dayFocus(await loadActiveTasks(pool, user.id, now, tz), now, tz, user.reminder_min_importance);
      if (focus.pending.length === 0) {
        return sendMessage(chatId, focus.doneToday.length
          ? allDoneMessage(focus.doneToday.length, focus.today)
          : "Bugun uchun vazifa yo'q. Saytda yangi vazifa qo'shing.");
      }
      const { text, buttons } = dayStatusMessage(focus, now, tz);
      return sendMessage(chatId, text, buttons);
    });
  }

  function handleReport(chatId, now) {
    return withUser(chatId, async (user) => {
      const history = await loadHistory(pool, user.id);
      const day = buildReport({ ...history, period: 'day', now, tz });
      const week = buildReport({ ...history, period: 'week', now, tz });
      const lines = ['📊 <b>Hisobot</b>', '', ...reportBlock(day, 'Bugun', 'kun')];
      if (day.streak) lines.push(`🔥 Ketma-ket ${day.streak} kun hammasi bajarildi`);
      lines.push('', ...reportBlock(week, 'Shu hafta', 'hafta'));
      return sendMessage(chatId, lines.join('\n'));
    });
  }

  async function handleStop(chatId) {
    await pool.query('UPDATE users SET telegram_chat_id = NULL WHERE telegram_chat_id = $1', [String(chatId)]);
    return sendMessage(chatId, "🔕 Eslatmalar o'chirildi. Qayta ulash uchun saytdagi Sozlamalardan foydalaning.");
  }

  async function handleCallback(query, now) {
    const chatId = query.message && query.message.chat && query.message.chat.id;
    const match = /^done:(\d+)$/.exec(query.data || '');
    const answer = (text) => call('answerCallbackQuery', { callback_query_id: query.id, text });

    if (!chatId || !match) return answer("Noma'lum amal");
    const user = await userByChat(chatId);
    if (!user) return answer('Hisob ulanmagan');

    // findOwnedTask user_id bilan tekshiradi — boshqa odamning vazifasini belgilab bo'lmaydi.
    const task = await findOwnedTask(pool, Number(match[1]), user.id);
    if (!task) return answer('Vazifa topilmadi');
    if (await currentCompletion(pool, task, now, tz)) return answer('Bu vazifa allaqachon bajarilgan ✅');

    await markDone(pool, task, now, tz);
    await answer('Bajarildi ✅');
    return sendMessage(chatId, `✅ <b>${escapeHtml(task.title)}</b> — bajarildi. Barakalla!`);
  }

  async function handleUpdate(update, now = new Date()) {
    if (update.callback_query) return handleCallback(update.callback_query, now);
    const message = update.message;
    if (!message || !message.chat || typeof message.text !== 'string') return undefined;
    if (message.chat.type !== 'private') return undefined;

    const [command, arg] = message.text.trim().split(/\s+/);
    const cmd = command.toLowerCase().replace(/@.*$/, '');
    if (cmd === '/start') return handleStart(message.chat.id, arg, now);
    if (cmd === '/bugun' || cmd === '/today') return handleToday(message.chat.id, now);
    if (cmd === '/vazifalar' || cmd === '/tasks') return handleList(message.chat.id, now);
    if (cmd === '/hisobot' || cmd === '/report') return handleReport(message.chat.id, now);
    if (cmd === '/stop') return handleStop(message.chat.id);
    return sendMessage(message.chat.id, HELP_TEXT);
  }

  async function start() {
    running = true;
    while (running) {
      try {
        if (!botUsername) {
          const me = await call('getMe');
          botUsername = me.username;
          await call('deleteWebhook', { drop_pending_updates: false });
          await call('setMyCommands', {
            commands: [
              { command: 'bugun', description: 'Bugun nima bajarildi, nima qoldi' },
              { command: 'vazifalar', description: 'Barcha bajarilmagan vazifalar' },
              { command: 'hisobot', description: 'Kun va hafta hisoboti' },
              { command: 'stop', description: "Eslatmalarni o'chirish" },
            ],
          }).catch(() => {}); // menyu — qo'shimcha qulaylik, xato bo'lsa botni to'xtatmaymiz
          log.log(`Telegram bot @${botUsername} ishga tushdi (long polling)`);
        }
        const updates = await call('getUpdates', {
          offset,
          timeout: 25,
          allowed_updates: ['message', 'callback_query'],
        }, 35_000);
        for (const update of updates) {
          offset = update.update_id + 1;
          try {
            await handleUpdate(update);
          } catch (err) {
            log.error('Telegram xabarini qayta ishlashda xato:', err.message);
          }
        }
      } catch (err) {
        if (!running) break;
        if (err.code === 401 || err.code === 404) {
          log.error("TELEGRAM_BOT_TOKEN noto'g'ri — Telegram eslatmalari o'chirildi. .env ni tekshiring.");
          invalidToken = true;
          running = false;
          break;
        }
        log.error(`Telegram: ${err.message}. 5 soniyadan keyin qayta urinaman.`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  function stop() {
    running = false;
  }

  function newLinkCode() {
    return crypto.randomBytes(8).toString('hex');
  }

  return {
    get enabled() { return !invalidToken; },
    get botUsername() { return botUsername; },
    set botUsername(value) { botUsername = value; }, // testlar uchun
    call,
    sendMessage,
    handleUpdate,
    start,
    stop,
    newLinkCode,
  };
}

module.exports = { createTelegram, TelegramError };
