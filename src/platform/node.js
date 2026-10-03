// node:sqlite adapteri (Node testlari va Electron uchun).
// node:sqlite sinxron, lekin interfeys ataylab async: Capacitor SQLite asinxron,
// shuning uchun data/repo.js ikkala platformada o'zgarmasdan ishlaydi.
import { DatabaseSync } from 'node:sqlite';

export function openDatabase(path = ':memory:') {
  const sqlite = new DatabaseSync(path);
  // node:sqlite qatorlarni null-prototype obyekt qilib qaytaradi — oddiy obyektga aylantiramiz.
  const plain = (row) => (row ? { ...row } : row);

  return {
    async run(sql, params = []) {
      const { lastInsertRowid, changes } = sqlite.prepare(sql).run(...params);
      return { lastInsertRowid: Number(lastInsertRowid), changes: Number(changes) };
    },
    async all(sql, params = []) {
      return sqlite.prepare(sql).all(...params).map(plain);
    },
    async get(sql, params = []) {
      return plain(sqlite.prepare(sql).get(...params));
    },
    async exec(sql) {
      sqlite.exec(sql);
    },
    async close() {
      sqlite.close();
    },
  };
}
