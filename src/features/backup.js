// Zaxira nusxa: JSON faylga eksport va undan tiklash.
// Fayl qurilmadan chiqadi (Telegram, Drive, email — foydalanuvchi tanlaydi), shuning uchun import
// qilinadigan har bir maydon yozishdan OLDIN tekshiriladi. Yozish — store.importBackup, bitta tranzaksiyada.
import { TASK_TYPES, localDate } from '../core/time.js';

export const BACKUP_VERSION = 1;

const PERIOD_KEY = /^(ONCE|D\d{4}-\d\d-\d\d|W\d{4}-\d\d-\d\d|M\d{4}-\d\d)$/;

function bad(message) {
  throw new Error(`Zaxira fayli noto'g'ri: ${message}`);
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function isoOrNull(value, where) {
  if (value === null || value === undefined || value === '') return null;
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  if (Number.isNaN(ms)) bad(`${where} — sana noto'g'ri`);
  return new Date(ms).toISOString();
}

function isoRequired(value, where) {
  const iso = isoOrNull(value, where);
  if (!iso) bad(`${where} — sana yo'q`);
  return iso;
}

function parseTask(t, i) {
  const where = `${i + 1}-vazifa`;
  if (!isObject(t)) bad(`${where} obyekt emas`);
  if (!Number.isInteger(t.id) || t.id <= 0) bad(`${where} — id yo'q`);
  const title = typeof t.title === 'string' ? t.title.trim() : '';
  if (!title || title.length > 200) bad(`${where} — nomi bo'sh yoki 200 belgidan uzun`);
  const description = t.description ?? '';
  if (typeof description !== 'string' || description.length > 2000) bad(`${where} — izoh noto'g'ri`);
  if (!TASK_TYPES.includes(t.type)) bad(`${where} — turi noto'g'ri (${t.type})`);
  if (!Number.isInteger(t.importance) || t.importance < 1 || t.importance > 10) bad(`${where} — muhimlik 1 dan 10 gacha emas`);
  const createdAt = isoRequired(t.created_at, where);
  return {
    id: t.id,
    title,
    description,
    type: t.type,
    importance: t.importance,
    deadline: isoOrNull(t.deadline, where),
    deleted_at: isoOrNull(t.deleted_at, where),
    created_at: createdAt,
    updated_at: isoOrNull(t.updated_at, where) || createdAt,
  };
}

/**
 * Fayl matni (yoki obyekt) → tekshirilgan ma'lumot. Har qanday xatoda — o'zbekcha Error, hech narsa yozilmaydi.
 * Natija: { version, exportedAt, settings, tasks, completions }.
 */
export function parseBackup(input) {
  let data = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch {
      bad('JSON emas');
    }
  }
  if (!isObject(data)) bad('fayl tuzilishi tanilmadi');
  if (data.version !== BACKUP_VERSION) {
    bad(Number.isInteger(data.version) && data.version > BACKUP_VERSION
      ? `versiya ${data.version} — ilovaning yangiroq versiyasidan. Ilovani yangilang`
      : `versiya noma'lum (${data.version ?? "yo'q"})`);
  }
  if (!Array.isArray(data.tasks)) bad("vazifalar ro'yxati yo'q");
  if (!Array.isArray(data.completions)) bad("bajarilishlar ro'yxati yo'q");
  if (data.settings !== undefined && !isObject(data.settings)) bad("sozlamalar noto'g'ri");

  const tasks = data.tasks.map(parseTask);
  const ids = new Set();
  for (const t of tasks) {
    if (ids.has(t.id)) bad(`vazifa id takrorlangan (${t.id})`);
    ids.add(t.id);
  }
  const completions = data.completions.map((c, i) => {
    const where = `${i + 1}-bajarilish`;
    if (!isObject(c)) bad(`${where} obyekt emas`);
    if (!ids.has(c.task_id)) bad(`${where} — mavjud bo'lmagan vazifaga tegishli`);
    if (typeof c.period_key !== 'string' || !PERIOD_KEY.test(c.period_key)) bad(`${where} — davr kaliti noto'g'ri`);
    return { task_id: c.task_id, period_key: c.period_key, completed_at: isoRequired(c.completed_at, where) };
  });
  const settings = {};
  for (const [key, value] of Object.entries(data.settings || {})) {
    if (typeof value !== 'string' && typeof value !== 'number') bad(`sozlama ${key} noto'g'ri`);
    settings[key] = String(value);
  }
  return { version: data.version, exportedAt: isoOrNull(data.exportedAt, 'exportedAt'), settings, tasks, completions };
}

// → { filename: 'vazifalar-YYYY-MM-DD.json', json }. Sana foydalanuvchi vaqt zonasida.
export async function exportData(store, now = new Date()) {
  const { settings, tasks, completions } = await store.exportBackup();
  const body = {
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    settings,
    tasks: [...tasks].sort((a, b) => a.id - b.id).map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      type: t.type,
      importance: t.importance,
      deadline: t.deadline,
      deleted_at: t.deleted_at,
      created_at: t.created_at,
      updated_at: t.updated_at,
    })),
    completions: [...completions]
      .sort((a, b) => a.task_id - b.task_id || a.period_key.localeCompare(b.period_key))
      .map((c) => ({ task_id: c.task_id, period_key: c.period_key, completed_at: c.completed_at })),
  };
  return {
    filename: `vazifalar-${localDate(now, settings.timezone)}.json`,
    json: JSON.stringify(body, null, 2),
  };
}

// json — fayl matni yoki obyekt (parseBackup natijasi ham bo'ladi — u o'z tekshiruvidan o'tadi).
// → { added, skipped, errors }: added/skipped — { tasks, completions } sonlari;
//   errors — yozishni to'xtatmagan ogohlantirishlar (masalan, noma'lum sozlama tashlab ketildi).
export async function importData(store, json, { mode } = {}) {
  return store.importBackup(parseBackup(json), { mode });
}
