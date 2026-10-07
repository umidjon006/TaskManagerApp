// Ish vaqtida platforma adapterini tanlash: tabiiy ilova (Android/iOS) — capacitor.js,
// aks holda brauzer — web.js (sql.js + IndexedDB). Dinamik import: telefonda sql.js wasm
// yuklanmaydi, brauzerda esa tabiiy plagin chaqirilmaydi.
// Electron adapteri shu yerga qo'shiladi.
// node.js bu yerga ulanmaydi — u faqat testlar va Electron'ning main jarayoni uchun.
import { Capacitor } from '@capacitor/core';

export async function openDatabase() {
  const adapter = Capacitor.isNativePlatform() ? await import('./capacitor.js') : await import('./web.js');
  return adapter.openDatabase();
}

// Eslatmalar: tabiiy ilovada — capacitor-notifications.js, boshqa joyda — no-op web-notifications.js.
export async function getNotifier() {
  return Capacitor.isNativePlatform()
    ? import('./capacitor-notifications.js')
    : import('./web-notifications.js');
}

// Fayllar (zaxira): tabiiy ilovada — saqlash + ulashish oynasi, brauzerda — yuklab olish.
export async function getFiles() {
  return Capacitor.isNativePlatform()
    ? import('./capacitor-files.js')
    : import('./web-files.js');
}

// Ilova oldingi planga qaytganda. Brauzerda — hech narsa (eslatmalar u yerda yo'q).
export async function onAppResume(callback) {
  if (!Capacitor.isNativePlatform()) return;
  const { App } = await import('@capacitor/app');
  await App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) callback();
  });
}
