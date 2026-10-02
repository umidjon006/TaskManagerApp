// Vaqt zonasiga bog'liq hisoblar: "bugun", "shu hafta", "shu oy" foydalanuvchining mahalliy vaqtida.
// Takrorlanuvchi vazifa (kunlik/haftalik/oylik) yangi davr boshlanganda avtomatik "bajarilmagan"ga qaytadi:
// har bir bajarilish davr kaliti (D2026-09-29, W2026-09-28, M2026-09, ONCE) bilan tarixga yoziladi.

const TASK_TYPES = ['doimiy', 'kunlik', 'haftalik', 'oylik'];
const WEEKDAYS = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const formatters = new Map();

function assertTimeZone(tz) {
  // Noto'g'ri zona nomi bo'lsa RangeError tashlaydi — server ishga tushishida erta aniqlanadi.
  new Intl.DateTimeFormat('en-US', { timeZone: tz });
  return tz;
}

function formatterFor(tz) {
  if (!formatters.has(tz)) {
    formatters.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    }));
  }
  return formatters.get(tz);
}

function localParts(date, tz) {
  const parts = Object.fromEntries(formatterFor(tz).formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday], // Dushanba = 0
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function periodKey(type, date, tz) {
  const p = localParts(date, tz);
  switch (type) {
    case 'kunlik':
      return `D${p.date}`;
    case 'haftalik': {
      const monday = new Date(Date.UTC(p.year, p.month - 1, p.day) - p.weekday * 86400000);
      return `W${monday.toISOString().slice(0, 10)}`;
    }
    case 'oylik':
      return `M${p.date.slice(0, 7)}`;
    default:
      return 'ONCE';
  }
}

// "23-7" → soat 23:00 dan 07:00 gacha jim. Bo'sh qiymat — jim soat yo'q.
function parseQuietHours(value) {
  if (!value) return null;
  const match = /^(\d{1,2})-(\d{1,2})$/.exec(String(value).trim());
  if (!match) throw new Error(`QUIET_HOURS noto'g'ri: "${value}". Namuna: 23-7`);
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start > 23 || end > 23) throw new Error(`QUIET_HOURS soatlari 0-23 oralig'ida bo'lsin: "${value}"`);
  return { start, end };
}

// DAILY_SUMMARY_HOUR: berilmasa — 21; bo'sh — kun yakuni o'chiq; aks holda 0–23.
function parseSummaryHour(value) {
  if (value === undefined) return 21;
  if (String(value).trim() === '') return null;
  const hour = Number(value);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error(`DAILY_SUMMARY_HOUR noto'g'ri: "${value}". Namuna: 21`);
  return hour;
}

function isQuietHour(hour, quiet) {
  if (!quiet || quiet.start === quiet.end) return false;
  return quiet.start < quiet.end
    ? hour >= quiet.start && hour < quiet.end
    : hour >= quiet.start || hour < quiet.end;
}

function formatLocal(date, tz) {
  const p = localParts(date, tz);
  return `${p.date.slice(8, 10)}.${p.date.slice(5, 7)}.${p.year} ${p.time}`;
}

// ---------- "YYYY-MM-DD" satrlari bilan ishlash (vaqt zonasidan mustaqil kalendar sanalari) ----------

const DAY_MS = 86400000;
const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const MONTHS_SHORT = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'];
const WEEKDAY_NAMES = ['dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba', 'yakshanba'];
const WEEKDAY_SHORT = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'];

function dayToUtc(ds) {
  return Date.UTC(Number(ds.slice(0, 4)), Number(ds.slice(5, 7)) - 1, Number(ds.slice(8, 10)));
}

function utcToDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function localDate(date, tz) {
  return localParts(date instanceof Date ? date : new Date(date), tz).date;
}

function addDays(ds, n) {
  return utcToDay(dayToUtc(ds) + n * DAY_MS);
}

function weekdayOf(ds) {
  return (new Date(dayToUtc(ds)).getUTCDay() + 6) % 7; // Dushanba = 0
}

function mondayOf(ds) {
  return addDays(ds, -weekdayOf(ds));
}

function monthStart(ds) {
  return `${ds.slice(0, 7)}-01`;
}

function addMonths(ds, n) {
  const d = new Date(dayToUtc(monthStart(ds)));
  d.setUTCMonth(d.getUTCMonth() + n);
  return utcToDay(d.getTime());
}

function monthEnd(ds) {
  return addDays(addMonths(ds, 1), -1);
}

function daysBetween(a, b) {
  return Math.round((dayToUtc(b) - dayToUtc(a)) / DAY_MS);
}

// Joriy davr kalitlari — vazifa turi bo'yicha "hozirgi" davr.
function currentKeys(now, tz) {
  return {
    doimiy: 'ONCE',
    kunlik: periodKey('kunlik', now, tz),
    haftalik: periodKey('haftalik', now, tz),
    oylik: periodKey('oylik', now, tz),
  };
}

function dayLabel(ds) {
  return `${Number(ds.slice(8, 10))}-${MONTHS[Number(ds.slice(5, 7)) - 1]}`;
}

function dayShortLabel(ds) {
  return `${WEEKDAY_SHORT[weekdayOf(ds)]}, ${Number(ds.slice(8, 10))}-${MONTHS_SHORT[Number(ds.slice(5, 7)) - 1]}`;
}

export {
  TASK_TYPES,
  MONTHS,
  MONTHS_SHORT,
  WEEKDAY_NAMES,
  WEEKDAY_SHORT,
  assertTimeZone,
  localParts,
  periodKey,
  parseQuietHours,
  parseSummaryHour,
  isQuietHour,
  formatLocal,
  localDate,
  addDays,
  weekdayOf,
  mondayOf,
  monthStart,
  monthEnd,
  addMonths,
  daysBetween,
  currentKeys,
  dayLabel,
  dayShortLabel,
};
