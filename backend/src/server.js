const { createApp } = require('./app');
const { createPool, migrate, waitForDatabase } = require('./db');
const { createAi } = require('./ai');
const { createTelegram } = require('./telegram');
const { runReminders } = require('./reminders');
const { assertTimeZone, parseQuietHours, parseSummaryHour } = require('./time');

const PORT = Number(process.env.PORT) || 3000;

async function main() {
  // Sozlamalarni ishga tushishdayoq tekshiramiz — xato bo'lsa darhol aniq xabar bilan to'xtaymiz.
  const tz = assertTimeZone(process.env.APP_TIMEZONE || 'Asia/Tashkent');
  const quietHours = parseQuietHours(process.env.QUIET_HOURS === undefined ? '23-7' : process.env.QUIET_HOURS);
  const summaryHour = parseSummaryHour(process.env.DAILY_SUMMARY_HOUR);

  const pool = createPool();
  await waitForDatabase(pool);
  await migrate(pool);
  console.log('Baza tayyor, jadvallar tekshirildi');

  const ai = createAi({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.AI_MODEL || 'claude-opus-5-5' });
  const telegram = createTelegram({ token: process.env.TELEGRAM_BOT_TOKEN, pool, tz });
  console.log(`AI: ${ai.enabled ? 'yoqilgan' : "o'chiq (ANTHROPIC_API_KEY yo'q)"}; `
    + `Telegram: ${telegram.enabled ? 'yoqilgan' : "o'chiq (TELEGRAM_BOT_TOKEN yo'q)"}; zona: ${tz}`);

  const app = createApp({ pool, jwtSecret: process.env.JWT_SECRET, tz, quietHours, summaryHour, ai, telegram });
  const server = app.listen(PORT, '0.0.0.0', () => console.log(`Vazifalar API ${PORT}-portda ishga tushdi`));

  let reminderTimer = null;
  if (telegram.enabled) {
    telegram.start(); // fon rejimida long polling
    let busy = false;
    reminderTimer = setInterval(async () => {
      if (busy) return; // oldingi tekshiruv tugamagan bo'lsa, ustma-ust ishlatmaymiz
      busy = true;
      try {
        await runReminders({ pool, telegram, tz, quiet: quietHours, summaryHour });
      } catch (err) {
        console.error('Eslatmalar tsiklida xato:', err.message);
      } finally {
        busy = false;
      }
    }, 60 * 1000);
  }

  // `docker compose down` SIGTERM yuboradi — ulanishlarni toza yopamiz.
  const shutdown = (signal) => {
    console.log(`${signal} olindi, to'xtatilmoqda...`);
    if (reminderTimer) clearInterval(reminderTimer);
    if (telegram.enabled) telegram.stop();
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Ishga tushirishda xato:', err.message);
  process.exit(1);
});
