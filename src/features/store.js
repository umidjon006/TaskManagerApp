// UI uchun yagona ma'lumot API'si. HTTP yo'q — nomlangan funksiyalar.
// db — platform/ adapteri (run/all/get/exec). Bu fayl SQLite drayverini import qilmaydi,
// shuning uchun Node testlarida ham, telefonda ham bir xil ishlaydi.
//
// Xatolar oddiy Error, xabari o'zbekcha — UI ularni toast'da ko'rsatadi.
import { migrate } from '../data/db.js';
import * as repo from '../data/repo.js';
import { validateTaskInput, publicTask } from '../core/validate.js';
import { buildReport, PERIODS } from '../core/reports.js';
import { assertTimeZone, parseQuietHours, parseSummaryHour } from '../core/time.js';
import { parseLeadMinutes, parseMorningHour } from '../core/schedule.js';

// Saqlash formati server-version'dagi .env bilan bir xil: QUIET_HOURS=23-7, DAILY_SUMMARY_HOUR=21.
// Bo'sh satr — o'chiq (jim soatlar yo'q / kun yakuni yuborilmaydi).
export const DEFAULT_SETTINGS = {
  timezone: 'Asia/Tashkent',
  reminder_min_importance: '5',
  quiet_hours: '22-7',
  summary_hour: '21',
  lead_minutes: '60,10,0',
  morning_hour: '9',
};

const MAX_REPORT_OFFSET = 120;
const pad = (n) => String(n).padStart(2, '0');

function fail(message) {
  throw new Error(message);
}

// Yangi qiymatni tekshiradi va saqlanadigan satrga aylantiradi.
const SETTING_PARSERS = {
  timezone(value) {
    try {
      return assertTimeZone(String(value));
    } catch {
      return fail(`Vaqt zonasi noto'g'ri: ${value}`);
    }
  },
  reminder_min_importance(value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 10) fail("Eslatma chegarasi 1 dan 10 gacha bo'lsin");
    return String(n);
  },
  quiet_hours(value) {
    const raw = value === null ? '' : String(value).trim();
    try {
      parseQuietHours(raw);
    } catch {
      fail("Jim soatlar noto'g'ri. Namuna: 22-7");
    }
    return raw;
  },
  summary_hour(value) {
    const raw = value === null ? '' : String(value).trim();
    try {
      parseSummaryHour(raw);
    } catch {
      fail("Kun yakuni soati 0 dan 23 gacha bo'lsin");
    }
    return raw;
  },
  // "60,10,0" — deadline'dan necha daqiqa oldin eslatish. Bo'sh — deadline eslatmalari o'chiq.
  lead_minutes(value) {
    try {
      return parseLeadMinutes(value === null ? '' : value).join(',');
    } catch {
      return fail("Eslatma daqiqalari noto'g'ri. Namuna: 60,10,0");
    }
  },
  morning_hour(value) {
    const raw = value === null ? '' : String(value).trim();
    try {
      parseMorningHour(raw);
    } catch {
      fail("Ertalabki eslatma soati 0 dan 23 gacha bo'lsin");
    }
    return raw;
  },
};

// migrations — data/db.js migrate() uchun SQL satrlar massivi. schema.sql matnini platformaga mos
// yuklovchi beradi (Vite — '?raw', Node — fs), chunki bu fayl fayl tizimini bilmaydi.
// clock — testlarda vaqtni boshqarish uchun.
export function createStore(db, { migrations, clock = () => new Date() } = {}) {
  let tz = null;

  function zone() {
    if (!tz) fail("Ma'lumotlar bazasi hali tayyor emas");
    return tz;
  }

  async function requireTask(id, opts) {
    const task = await repo.findTask(db, id, opts);
    if (!task) fail('Vazifa topilmadi');
    return task;
  }

  async function taskView(task, now) {
    return publicTask(task, await repo.currentCompletion(db, task, now, zone()), now);
  }

  function validated(input) {
    const { error, value } = validateTaskInput(input || {});
    if (error) fail(error);
    return value;
  }

  return {
    async init() {
      if (!Array.isArray(migrations) || migrations.length === 0) fail("Ma'lumotlar bazasi sxemasi berilmagan");
      await migrate(db, migrations);
      const current = await repo.getSettings(db);
      for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (!(key in current)) await repo.setSetting(db, key, value);
      }
      tz = SETTING_PARSERS.timezone((await repo.getSettings(db)).timezone);
    },

    async listTasks() {
      return { tasks: await repo.loadActiveTasks(db, clock(), zone()) };
    },

    async createTask(input) {
      const value = validated(input);
      const now = clock();
      zone(); // init() chaqirilganini tekshiradi
      const row = await repo.createTask(db, value, now);
      return { task: publicTask(row, null, now) };
    },

    async updateTask(id, input) {
      await requireTask(id);
      const value = validated(input);
      const now = clock();
      const row = await repo.updateTask(db, id, value, now);
      if (!row) fail('Vazifa topilmadi');
      return { task: await taskView(row, now) };
    },

    // Yumshoq o'chirish: ro'yxatdan yo'qoladi, hisobot tarixi saqlanadi, restoreTask bilan qaytadi.
    async deleteTask(id) {
      await requireTask(id);
      await repo.softDeleteTask(db, id, clock());
    },

    async restoreTask(id) {
      await requireTask(id, { includeDeleted: true });
      const row = await repo.restoreTask(db, id);
      return { task: await taskView(row, clock()) };
    },

    // Bajarildi ↔ bajarilmadi — joriy davr kaliti bo'yicha.
    async toggleTask(id) {
      const task = await requireTask(id);
      const now = clock();
      if (await repo.currentCompletion(db, task, now, zone())) await repo.markUndone(db, task, now, tz);
      else await repo.markDone(db, task, now, tz);
      return { task: await taskView(task, now) };
    },

    async getReport(period = 'day', offset = 0) {
      if (!PERIODS.includes(period)) fail("Davr noto'g'ri tanlangan");
      if (!Number.isInteger(offset) || offset > 0 || offset < -MAX_REPORT_OFFSET) fail("Davr noto'g'ri tanlangan");
      const history = await repo.loadHistory(db);
      return buildReport({ ...history, period, offset, now: clock(), tz: zone() });
    },

    // Sozlamalar ko'rinish formatida (UI uchun).
    async getMe() {
      const timezone = zone();
      const s = await repo.getSettings(db);
      const quiet = parseQuietHours(s.quiet_hours);
      const summary = parseSummaryHour(s.summary_hour);
      const morning = parseMorningHour(s.morning_hour);
      return {
        settings: {
          reminder_min_importance: Number(s.reminder_min_importance),
          lead_minutes: parseLeadMinutes(s.lead_minutes),
        },
        quiet_hours: quiet ? `${pad(quiet.start)}:00–${pad(quiet.end)}:00` : null,
        summary_hour: summary === null ? null : `${pad(summary)}:00`,
        morning_hour: morning === null ? null : `${pad(morning)}:00`,
        timezone,
      };
    },

    // Sozlamalar saqlangan (xom satr) ko'rinishida — core/schedule.js buildSchedule() uchun.
    async getSettings() {
      const timezone = zone();
      return { ...(await repo.getSettings(db)), timezone };
    },

    // patch — { reminder_min_importance?, quiet_hours?, summary_hour?, timezone?, lead_minutes?, morning_hour? }.
    // Avval hammasi tekshiriladi, keyin bitta tranzaksiyada yoziladi. Yangilangan getMe() qaytadi.
    async updateSettings(patch) {
      zone();
      if (!patch || typeof patch !== 'object') fail("Sozlamalar noto'g'ri");
      const entries = Object.entries(patch).map(([key, value]) => {
        if (!Object.hasOwn(SETTING_PARSERS, key)) fail(`Noma'lum sozlama: ${key}`);
        return [key, SETTING_PARSERS[key](value)];
      });
      if (entries.length === 0) return this.getMe();

      await db.exec('BEGIN');
      try {
        for (const [key, value] of entries) await repo.setSetting(db, key, value);
        await db.exec('COMMIT');
      } catch (err) {
        await db.exec('ROLLBACK');
        throw err;
      }
      const next = entries.find(([key]) => key === 'timezone');
      if (next) tz = next[1];
      return this.getMe();
    },
  };
}
