// Eslatmalarni qurilmada jadvallash. Hisob core/schedule.js da, bu yerda faqat oqim:
// ruxsat → store'dan vazifa va sozlamalar → buildSchedule → eski hammasini bekor qilish → yangisini qo'yish.
//
// notifier — platform/ dagi capacitor-notifications.js yoki web-notifications.js (bir xil interfeys).
// Ruxsat bu yerda SO'RALMAYDI — so'rash UI'ning ishi (ui/app.js).
import { buildSchedule } from '../core/schedule.js';

export const SYNC_DEBOUNCE_MS = 500;
// Bitta ish shundan uzoq cho'zilsa — osilib qolgan deb hisoblanadi. Native plagin chaqiruvi hech qachon
// javob bermasa ham navbat abadiy qotib qolmasin: ish xato bilan tugaydi, keyingisi ishlaydi.
export const SYNC_TIMEOUT_MS = 20000;

const STAGE_LABELS = {
  support: 'platforma tekshiruvi',
  permissions: 'ruxsatni tekshirish',
  load: "ma'lumotni o'qish",
  build: 'jadvalni hisoblash',
  channel: 'kanal yaratish',
  cancel: 'eskilarini bekor qilish',
  schedule: 'yangilarini qo\'yish',
};

// Darhol, debounce'siz. Testlar va debounce ichidan chaqiriladi.
// onStage(stage) — har bosqich boshlanishida; osilib qolsa, qayerda qotgani ma'lum bo'ladi.
export async function runSync(store, notifier, now = new Date(), { onStage = () => {} } = {}) {
  onStage('support');
  if (!(await notifier.isSupported())) return { skipped: true };
  onStage('permissions');
  const perms = await notifier.checkPermissions();
  if (perms.notifications !== 'granted') {
    return { skipped: true, permission: perms.notifications, exactAlarm: perms.exactAlarm };
  }
  onStage('load');
  const [{ tasks }, settings] = await Promise.all([store.listTasks(), store.getSettings()]);
  onStage('build');
  const items = buildSchedule({ tasks, now, tz: settings.timezone, settings });
  onStage('channel');
  await notifier.ensureChannel();
  // Avval hammasi bekor qilinadi: eskirgan eslatma hech qachon qolib ketmaydi.
  onStage('cancel');
  await notifier.cancelAll();
  onStage('schedule');
  await notifier.schedule(items);
  return { scheduled: items.length, exactAlarm: perms.exactAlarm };
}

// ---------- Diagnostika ----------
// Release build'da konsol ko'rinmaydi — oxirgi ishlarning holati shu yerda, Sozlamalarda ko'rsatiladi.
const status = {
  runs: 0, // boshlangan ishlar soni
  running: null, // { startedAt, stage } — hozir ketayotgan ish
  lastRunAt: null, // oxirgi ish tugagan payt (har qanday natija)
  lastSuccessAt: null, // oxirgi muvaffaqiyatli jadvallash
  lastResult: null, // runSync natijasi
  lastError: null, // { message, stage, at }
};

export function getSyncStatus() {
  return { ...status, running: status.running && { ...status.running } };
}

function withTimeout(promise, ms, stageOf) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const stage = stageOf();
      reject(new Error(`Eslatmalarni jadvallash javob bermadi (${Math.round(ms / 1000)} s, bosqich: ${STAGE_LABELS[stage] || stage})`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Bitta ish: holat yoziladi, vaqt chegarasi bor. Har qanday natijada running tozalanadi (finally).
async function trackedRun(args, timeoutMs) {
  const run = { startedAt: new Date().toISOString(), stage: null };
  status.runs += 1;
  status.running = run;
  try {
    const result = await withTimeout(
      runSync(args.store, args.notifier, args.now ?? new Date(), { onStage: (s) => { run.stage = s; } }),
      timeoutMs,
      () => run.stage,
    );
    status.lastResult = result;
    if (!result.skipped) {
      status.lastSuccessAt = new Date().toISOString();
      status.lastError = null;
    }
    return result;
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    status.lastError = { message, stage: run.stage, at: new Date().toISOString() };
    throw err;
  } finally {
    status.lastRunAt = new Date().toISOString();
    if (status.running === run) status.running = null;
  }
}

let timer = null;
let waiters = [];
let latest = null;
// Ishlar ketma-ket: oldingi cancelAll/schedule tugamay turib keyingisi boshlanmaydi.
// Oldingi ish xato bilan tugasa yoki vaqt chegarasidan oshsa ham navbat davom etadi.
let chain = Promise.resolve();

// Ketma-ket chaqiruvlar (masalan, 5 ta vazifani tez-tez belgilash) bitta ishga birlashadi.
// Oxirgi chaqiruvning argumentlari ishlatiladi. Har bir chaqiruv o'sha yagona ish natijasini oladi.
// now berilmasa — ish boshlangan paytdagi vaqt.
export function syncNotifications(store, notifier, now, { delay = SYNC_DEBOUNCE_MS, timeout = SYNC_TIMEOUT_MS } = {}) {
  latest = { store, notifier, now };
  clearTimeout(timer);
  return new Promise((resolve, reject) => {
    waiters.push({ resolve, reject });
    timer = setTimeout(() => {
      const batch = waiters;
      const args = latest;
      waiters = [];
      timer = null;
      const job = chain.then(() => trackedRun(args, timeout));
      chain = job.catch(() => {});
      job.then(
        (result) => batch.forEach((w) => w.resolve(result)),
        (err) => batch.forEach((w) => w.reject(err)),
      );
    }, delay);
  });
}
