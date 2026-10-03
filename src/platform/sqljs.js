// sql.js adapteri — node.js adapteri bilan bir xil interfeys: run/all/get/exec/close, hammasi Promise.
// Brauzerga bog'liq narsa (wasm yo'li, IndexedDB) bu yerda yo'q — ular web.js da. Shuning uchun
// bu faylni Node testlarida ham sinash mumkin.
//
// SQL     — initSqlJs() natijasi.
// bytes   — avval saqlangan baza (Uint8Array) yoki null.
// persist — async (Uint8Array) => void; yozuvlardan keyin debounce bilan chaqiriladi.
//
// Diqqat: sql.js'da db.export() bazani yopib qayta ochadi. Bundan ikki narsa kelib chiqadi:
//  • ulanishga bog'liq PRAGMA'lar standartga qaytadi — foreign_keys ni export'dan keyin tiklaymiz;
//  • ochiq tranzaksiya yo'qoladi — tranzaksiya ichida export qilmaymiz, tugashini kutamiz.

export const SAVE_DELAY_MS = 300;

// Tranzaksiya chegaralarini aniqlash uchun (faqat exec orqali kelganlari — migrate va store shunday qiladi).
const TX_BEGIN = /^\s*BEGIN\b/i;
const TX_END = /^\s*(COMMIT|END|ROLLBACK)\b(?!\s+TO\b)/i;

export function createSqlJsAdapter(SQL, { bytes = null, persist = async () => {}, delay = SAVE_DELAY_MS } = {}) {
  const sqlite = bytes ? new SQL.Database(bytes) : new SQL.Database();
  let inTransaction = false;
  let dirty = false;
  let timer = null;
  let saving = Promise.resolve();

  function query(sql, params) {
    const stmt = sqlite.prepare(sql);
    try {
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  function snapshot() {
    const fk = query('PRAGMA foreign_keys', [])[0].foreign_keys;
    const data = sqlite.export();
    if (fk) sqlite.exec('PRAGMA foreign_keys = ON');
    return data;
  }

  function schedule() {
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
  }

  // Kutilayotgan yozuvni darhol saqlaydi. Tranzaksiya ochiq bo'lsa — keyinga qoldiradi.
  function flush() {
    clearTimeout(timer);
    timer = null;
    if (!dirty) return saving;
    if (inTransaction) { schedule(); return saving; }
    dirty = false;
    const data = snapshot();
    saving = saving.then(() => persist(data)).catch((err) => {
      dirty = true;
      console.error("Bazani saqlab bo'lmadi:", err);
    });
    return saving;
  }

  return {
    async run(sql, params = []) {
      const stmt = sqlite.prepare(sql);
      try {
        stmt.run(params);
      } finally {
        stmt.free();
      }
      const changes = sqlite.getRowsModified();
      const { id } = query('SELECT last_insert_rowid() AS id', [])[0];
      schedule();
      return { lastInsertRowid: Number(id), changes: Number(changes) };
    },
    async all(sql, params = []) {
      return query(sql, params);
    },
    async get(sql, params = []) {
      return query(sql, params)[0];
    },
    async exec(sql) {
      sqlite.exec(sql);
      if (TX_BEGIN.test(sql)) inTransaction = true;
      else if (TX_END.test(sql)) inTransaction = false;
      schedule();
    },
    flush,
    async close() {
      inTransaction = false;
      await flush();
      sqlite.close();
    },
  };
}
