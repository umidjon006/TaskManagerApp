// Eslatmalarni qurilmada jadvallash. Hisob core/schedule.js da, bu yerda faqat oqim:
// ruxsat → store'dan vazifa va sozlamalar → buildSchedule → eski hammasini bekor qilish → yangisini qo'yish.
//
// notifier — platform/ dagi capacitor-notifications.js yoki web-notifications.js (bir xil interfeys).
// Ruxsat bu yerda SO'RALMAYDI — so'rash UI'ning ishi (ui/app.js).
import { buildSchedule } from '../core/schedule.js';

export const SYNC_DEBOUNCE_MS = 500;

// Darhol, debounce'siz. Testlar va debounce ichidan chaqiriladi.
export async function runSync(store, notifier, now = new Date()) {
  if (!(await notifier.isSupported())) return { skipped: true };
  const perms = await notifier.checkPermissions();
  if (perms.notifications !== 'granted') {
    return { skipped: true, permission: perms.notifications, exactAlarm: perms.exactAlarm };
  }
  const [{ tasks }, settings] = await Promise.all([store.listTasks(), store.getSettings()]);
  const items = buildSchedule({ tasks, now, tz: settings.timezone, settings });
  await notifier.ensureChannel();
  // Avval hammasi bekor qilinadi: eskirgan eslatma hech qachon qolib ketmaydi.
  await notifier.cancelAll();
  await notifier.schedule(items);
  return { scheduled: items.length, exactAlarm: perms.exactAlarm };
}

let timer = null;
let waiters = [];
let latest = null;
// Ishlar ketma-ket: oldingi cancelAll/schedule tugamay turib keyingisi boshlanmaydi.
let chain = Promise.resolve();

// Ketma-ket chaqiruvlar (masalan, 5 ta vazifani tez-tez belgilash) bitta ishga birlashadi.
// Oxirgi chaqiruvning argumentlari ishlatiladi. Har bir chaqiruv o'sha yagona ish natijasini oladi.
// now berilmasa — ish boshlangan paytdagi vaqt.
export function syncNotifications(store, notifier, now, { delay = SYNC_DEBOUNCE_MS } = {}) {
  latest = { store, notifier, now };
  clearTimeout(timer);
  return new Promise((resolve, reject) => {
    waiters.push({ resolve, reject });
    timer = setTimeout(() => {
      const batch = waiters;
      const args = latest;
      waiters = [];
      timer = null;
      const job = chain.then(() => runSync(args.store, args.notifier, args.now ?? new Date()));
      chain = job.catch(() => {});
      job.then(
        (result) => batch.forEach((w) => w.resolve(result)),
        (err) => batch.forEach((w) => w.reject(err)),
      );
    }, delay);
  });
}
