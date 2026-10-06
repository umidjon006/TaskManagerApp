// Eslatmalar jadvali: kelajakdagi eslatmalarni OLDINDAN hisoblaydi. Platforma (5b) natijani
// LocalNotifications.schedule bilan qo'yadi — telefon ilova yopiq bo'lsa ham o'zi ko'rsatadi.
// Vazifa qo'shilganda/o'zgarganda/bajarilganda jadval butunlay qayta hisoblanadi.
//
// Sof funksiya: Date.now() yo'q, "hozir" har doim argument sifatida keladi.
import * as T from './time.js';

// iOS bir vaqtda 64 ta kutayotgan eslatma saqlaydi — 4 tasi zaxira.
const MAX_NOTIFICATIONS = 60;
const MAX_LEAD_MINUTES = 7 * 24 * 60;
const PERIOD_END_HOUR = 18;
const NAMES_IN_BODY = 3;
const MINUTE_MS = 60000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
// Chegaradan oshsa ham shu oraliqdagi eslatmalar turidan qat'i nazar saqlanadi.
const KEEP_ALWAYS_MS = 48 * HOUR_MS;

// Chegaradan oshganda tashlash navbati: qiymati past tur birinchi (yig'malar), period-end — oxirgi.
const DROP_TIER = { morning: 0, evening: 0, deadline: 1, 'period-end': 2 };

// Bir xil vaqtdagi eslatmalar tartibi: avval yig'ma, keyin deadline.
const KIND_ORDER = { morning: 0, 'period-end': 1, evening: 2, deadline: 3 };

// lead_minutes: "60,10,0" → [60, 10, 0]. Bo'sh — deadline eslatmalari o'chiq.
// 0 ham ruxsat ("vaqtida"). Takrorlar olib tashlanadi, kattadan kichikka saralanadi.
function parseLeadMinutes(value) {
  if (value === undefined) return [60, 10, 0];
  const raw = Array.isArray(value) ? value.join(',') : String(value ?? '').trim();
  if (raw === '') return [];
  const list = raw.split(',').map((s) => s.trim());
  if (!list.every((s) => /^\d+$/.test(s) && Number(s) <= MAX_LEAD_MINUTES)) {
    throw new Error(`lead_minutes noto'g'ri: "${value}". Namuna: 60,10,0`);
  }
  return [...new Set(list.map(Number))].sort((a, b) => b - a);
}

// morning_hour: berilmasa — 9; bo'sh — ertalabki yig'ma o'chiq; aks holda 0–23.
function parseMorningHour(value) {
  if (value === undefined) return 9;
  if (value === null || String(value).trim() === '') return null;
  const hour = Number(value);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error(`morning_hour noto'g'ri: "${value}". Namuna: 9`);
  return hour;
}

// Mahalliy sana + soat → UTC lahza. Zona siljishi ikki marta aniqlanadi (DST chegarasi uchun).
function zonedTime(ds, hour, tz) {
  const target = Date.UTC(Number(ds.slice(0, 4)), Number(ds.slice(5, 7)) - 1, Number(ds.slice(8, 10)), hour);
  let guess = target;
  for (let i = 0; i < 2; i += 1) {
    const p = T.localParts(new Date(guess), tz);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += target - shown;
  }
  return guess;
}

function leadText(minutes) {
  if (minutes === 0) return 'Muddati keldi';
  if (minutes % 1440 === 0) return `${minutes / 1440} kun qoldi`;
  if (minutes % 60 === 0) return `${minutes / 60} soat qoldi`;
  return `${minutes} daqiqa qoldi`;
}

function namesList(tasks) {
  const names = tasks.slice(0, NAMES_IN_BODY).map((t) => t.title);
  const rest = tasks.length - names.length;
  return rest > 0 ? `${names.join(', ')} va yana ${rest} ta` : names.join(', ');
}

function byImportance(a, b) {
  if (a.importance !== b.importance) return b.importance - a.importance;
  const da = a.deadline ? Date.parse(a.deadline) : Infinity;
  const db = b.deadline ? Date.parse(b.deadline) : Infinity;
  if (da !== db) return da - db;
  return a.id - b.id;
}

/**
 * tasks — store.listTasks() shaklidagi vazifalar: { id, title, type, importance, deadline, done, deleted_at? }.
 *   done — vazifa `now` paytidagi JORIY davrda bajarilganmi. Keyingi davrlar (ertaga, keyingi hafta)
 *   uchun bajarilmagan deb hisoblanadi: kunlik vazifa bugun bajarilsa, ertangi eslatmalar qoladi.
 * now — Date yoki ISO satr. tz — IANA zona. settings — settings jadvalidagi qiymatlar (satr yoki son).
 * Natija: [{ at, kind, taskId, title, body }], `at` bo'yicha saralangan, ko'pi bilan 60 ta.
 *   taskId — faqat 'deadline' uchun; yig'ma xabarlarda null.
 */
function buildSchedule({ tasks = [], now, tz, settings = {}, horizonDays = 7 }) {
  const nowMs = new Date(now).getTime();
  if (Number.isNaN(nowMs)) throw new Error("buildSchedule: now noto'g'ri");
  T.assertTimeZone(tz);
  const nowDate = new Date(nowMs);
  const endMs = nowMs + horizonDays * DAY_MS;

  const minImportance = Number(settings.reminder_min_importance ?? 1);
  const leads = parseLeadMinutes(settings.lead_minutes);
  const morningHour = parseMorningHour(settings.morning_hour);
  const summaryHour = T.parseSummaryHour(settings.summary_hour === null ? '' : settings.summary_hour);
  const quiet = T.parseQuietHours(settings.quiet_hours);

  const active = tasks
    .filter((t) => !t.deleted_at && t.importance >= minImportance)
    .sort(byImportance);

  // `date` paytidagi davr — joriy davr bo'lsa va vazifa bajarilgan bo'lsa, eslatma kerak emas.
  const doneAt = (task, date) => Boolean(task.done)
    && T.periodKey(task.type, date, tz) === T.periodKey(task.type, nowDate, tz);

  const result = [];
  function push(atMs, kind, taskId, title, body) {
    if (atMs < nowMs || atMs >= endMs) return;
    // Jim soatga tushsa — butunlay tashlanadi, keyinga surilmaydi.
    if (T.isQuietHour(T.localParts(new Date(atMs), tz).hour, quiet)) return;
    result.push({ at: new Date(atMs).toISOString(), kind, taskId, title, body });
  }

  // 1) Deadline: har bir lead_minutes qiymati uchun bittadan.
  for (const task of active) {
    if (!task.deadline) continue;
    const deadlineMs = Date.parse(task.deadline);
    if (doneAt(task, new Date(deadlineMs))) continue;
    const time = T.localParts(new Date(deadlineMs), tz).time;
    for (const lead of leads) {
      const body = lead === 0 ? `Muddati keldi · ${time}` : `${leadText(lead)} · ${time} gacha`;
      push(deadlineMs - lead * MINUTE_MS, 'deadline', task.id, task.title, body);
    }
  }

  // 2) Kunma-kun: ertalabki yig'ma, kechki yakun, davr oxiri.
  //    Yig'maga o'z davrida bajarilmagan vazifa tushadi, agar: deadline'i yo'q (har qanday tur),
  //    deadline'i shu kuni yoki allaqachon o'tib ketgan. Deadline'i kelajakda bo'lganlar
  //    yig'maga tushmaydi — ularga o'z 'deadline' eslatmalari bor.
  //    Deadline'siz vazifalar faqat shu yerda eslatiladi: 10 ta bo'lsa ham bitta xabar.
  //    period-end — qo'shimcha turtki.
  const dueOn = (ds) => {
    const start = new Date(zonedTime(ds, 0, tz));
    return active.filter((t) => !doneAt(t, start)
      && (!t.deadline || T.localDate(t.deadline, tz) <= ds));
  };

  const lastDay = T.localDate(new Date(endMs), tz);
  for (let ds = T.localDate(nowDate, tz); ds <= lastDay; ds = T.addDays(ds, 1)) {
    if (morningHour !== null) {
      const list = dueOn(ds);
      if (list.length) push(zonedTime(ds, morningHour, tz), 'morning', null, 'Bugungi reja', `Bugun ${list.length} ta vazifa: ${namesList(list)}`);
    }
    if (summaryHour !== null) {
      const list = dueOn(ds);
      if (list.length) push(zonedTime(ds, summaryHour, tz), 'evening', null, 'Kun yakuni', `Bajarilmay qoldi ${list.length} ta: ${namesList(list)}`);
    }
    const periods = [];
    if (T.weekdayOf(ds) === 6) periods.push(['haftalik', 'Hafta yakuni', 'Shu hafta']);
    if (T.monthEnd(ds) === ds) periods.push(['oylik', 'Oy yakuni', 'Shu oy']);
    for (const [type, title, label] of periods) {
      const atMs = zonedTime(ds, PERIOD_END_HOUR, tz);
      const list = active.filter((t) => t.type === type && !doneAt(t, new Date(atMs)));
      if (list.length) push(atMs, 'period-end', null, title, `${label} bajarilmagan ${list.length} ta: ${namesList(list)}`);
    }
  }

  return byTime(trim(result, nowMs));
}

function byTime(list) {
  return list.sort((a, b) => a.at.localeCompare(b.at)
    || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    || (a.taskId ?? 0) - (b.taskId ?? 0));
}

// 60 tadan oshsa — qiymati bo'yicha tashlanadi: avval eng uzoqdagi yig'malar, keyin eng uzoqdagi
// deadline'lar, period-end — eng oxirida. Keyingi 48 soatdagilar turidan qat'i nazar qoladi
// (ularning o'zi 60 tadan oshsa — eng yaqinlari).
function trim(list, nowMs) {
  if (list.length <= MAX_NOTIFICATIONS) return list;
  const soonLimit = new Date(nowMs + KEEP_ALWAYS_MS).toISOString();
  const soon = byTime(list.filter((n) => n.at < soonLimit));
  if (soon.length >= MAX_NOTIFICATIONS) return soon.slice(0, MAX_NOTIFICATIONS);
  const later = list
    .filter((n) => n.at >= soonLimit)
    .sort((a, b) => DROP_TIER[b.kind] - DROP_TIER[a.kind] || a.at.localeCompare(b.at));
  return [...soon, ...later.slice(0, MAX_NOTIFICATIONS - soon.length)];
}

export { buildSchedule, parseLeadMinutes, parseMorningHour, zonedTime, MAX_NOTIFICATIONS };
