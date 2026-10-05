// Capacitor adapteri (Android/iOS): @capacitor-community/sqlite'ning tabiiy qismi.
// node.js va sqljs.js bilan bir xil interfeys: run/all/get/exec/close, hammasi Promise.
//
// Plagin paketining JS qismi ataylab import qilinmaydi: u web uchun jeep-sqlite'ni
// lazy-chunk sifatida bandlega tortadi. Brauzerda sql.js ishlaydi, bizga faqat tabiiy
// tomon kerak — shuning uchun plaginni nomi bo'yicha o'zimiz ro'yxatdan o'tkazamiz.
//
// Saqlash: tabiiy SQLite to'g'ridan-to'g'ri qurilmadagi faylga yozadi, har bir avtocommit
// (yoki COMMIT) diskka tushadi. sql.js'dagi kabi flush/saveToStore kerak emas.
//
// Tranzaksiyalar: plagin standart holatda har bir run/execute'ni o'zining BEGIN/COMMIT'iga
// o'raydi. data/db.js va store.js tranzaksiyani o'zi boshqaradi (exec('BEGIN')), shuning
// uchun barcha chaqiruvlarda transaction: false.
import { registerPlugin } from '@capacitor/core';

const CapacitorSQLite = registerPlugin('CapacitorSQLite');

// Diqqat: plagin execute()'da SQL'ni ";\n" bo'yicha bo'ladi va har qatordagi "--" dan
// keyingi qismni kesadi. schema.sql shu tartibga mos: har statement ";" + yangi qator bilan
// tugaydi, satr literallarida "--" yo'q. Migratsiya yozganda shuni hisobga oling.
export async function openDatabase(name = 'vazifalar') {
  // WebView qayta yuklansa, tabiiy tomonda eski ulanish qoladi va createConnection
  // "already exists" deb yiqiladi. JS tomonda ulanish yo'q — tabiiy tomondagilarni yopamiz.
  await CapacitorSQLite.checkConnectionsConsistency({ dbNames: [], openModes: [] });
  await CapacitorSQLite.createConnection({
    database: name, version: 1, encrypted: false, mode: 'no-encryption', readonly: false,
  });
  await CapacitorSQLite.open({ database: name, readonly: false });

  async function query(sql, params = []) {
    const { values = [] } = await CapacitorSQLite.query({ database: name, statement: sql, values: params, readonly: false });
    // iOS birinchi element sifatida ustun nomlarini qaytaradi ({ ios_columns: [...] }).
    return values.filter((row) => !('ios_columns' in row));
  }

  async function exec(sql) {
    await CapacitorSQLite.execute({ database: name, statements: sql, transaction: false, readonly: false });
  }

  // Plagin open() da ham yoqadi, lekin bunga tayanmaymiz: SQLite'da standart holatda o'chiq
  // va o'chiq bo'lsa ON DELETE CASCADE jim ishlamaydi.
  await exec('PRAGMA foreign_keys = ON');
  const [{ foreign_keys: fk } = {}] = await query('PRAGMA foreign_keys');
  if (Number(fk) !== 1) throw new Error('SQLite: foreign_keys yoqilmadi');

  return {
    async run(sql, params = []) {
      const { changes = {} } = await CapacitorSQLite.run({
        database: name, statement: sql, values: params, transaction: false, readonly: false,
      });
      return { lastInsertRowid: Number(changes.lastId), changes: Number(changes.changes) };
    },
    all: query,
    async get(sql, params = []) {
      return (await query(sql, params))[0];
    },
    exec,
    async close() {
      await CapacitorSQLite.close({ database: name, readonly: false });
      await CapacitorSQLite.closeConnection({ database: name, readonly: false });
    },
  };
}
