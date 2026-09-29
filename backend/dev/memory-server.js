// Docker va Postgres'siz lokal namoyish: xotiradagi baza + frontend fayllari bitta portda.
//   cd backend && npm install && npm run dev:memory   →   http://localhost:8080
// Server to'xtasa ma'lumotlar yo'qoladi. Serverda (production) bu fayl ishlatilmaydi.
// ANTHROPIC_API_KEY berilsa AI ham ishlaydi; TELEGRAM_BOT_TOKEN berilsa bot ham ishlaydi.
const path = require('path');
const express = require('express');
const { createApp } = require('../src/app');
const { createAi } = require('../src/ai');
const { createTelegram } = require('../src/telegram');
const { runReminders } = require('../src/reminders');
const { parseQuietHours, parseSummaryHour } = require('../src/time');
const { createMemoryPool } = require('../test/helpers');

const PORT = Number(process.env.PORT) || 8080;
const tz = process.env.APP_TIMEZONE || 'Asia/Tashkent';
const quietHours = parseQuietHours(process.env.QUIET_HOURS === undefined ? '23-7' : process.env.QUIET_HOURS);
const summaryHour = parseSummaryHour(process.env.DAILY_SUMMARY_HOUR);

const pool = createMemoryPool();
const ai = createAi({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.AI_MODEL || 'claude-opus-5-5' });
const telegram = createTelegram({ token: process.env.TELEGRAM_BOT_TOKEN, pool, tz });

const app = createApp({ pool, jwtSecret: 'lokal-demo-kaliti', tz, quietHours, summaryHour, ai, telegram });
app.use(express.static(path.join(__dirname, '..', '..', 'frontend', 'public')));

app.listen(PORT, () => {
  console.log(`Lokal demo: http://localhost:${PORT}  (xotiradagi baza; AI: ${ai.enabled}, Telegram: ${telegram.enabled})`);
});

if (telegram.enabled) {
  telegram.start();
  setInterval(() => runReminders({ pool, telegram, tz, quiet: quietHours, summaryHour }).catch((e) => console.error(e.message)), 60 * 1000);
}
