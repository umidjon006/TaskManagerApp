// Ish vaqtida platforma adapterini tanlash. Hozircha faqat brauzer (sql.js + IndexedDB).
// Capacitor (Android/iOS) va Electron adapterlari shu yerga qo'shiladi.
// node.js bu yerga ulanmaydi — u faqat testlar va Electron'ning main jarayoni uchun.
export { openDatabase } from './web.js';
