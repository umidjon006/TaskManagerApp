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
