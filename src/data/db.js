// Sxema migratsiyasi. Versiya PRAGMA user_version'da saqlanadi.
// db — platform/ adapteri (run/all/get/exec, hammasi async). Bu fayl fayl tizimiga tegmaydi:
// schema.sql matnini platformaga mos yuklovchi beradi (Node — fs, Vite — '?raw' import).
//
// migrations — SQL satrlar massivi: migrations[0] = v1 sxemasi, migrations[1] = v2 va h.k.
// Yangi versiya uchun massiv oxiriga yangi satr qo'shish kifoya. Mavjud elementlar o'zgartirilmaydi.

// Har ulanishda chaqirilishi SHART: foreign_keys ulanishga bog'liq va standart holatda o'chiq.
// O'chiq bo'lsa ON DELETE CASCADE jim ishlamaydi va yetim completions qoladi.
export async function migrate(db, migrations) {
  const target = migrations.length;
  await db.exec('PRAGMA foreign_keys = ON');
  const fk = await db.get('PRAGMA foreign_keys');
  if (!fk || fk.foreign_keys !== 1) throw new Error("SQLite: foreign_keys yoqilmadi");

  const { user_version: version } = await db.get('PRAGMA user_version');
  if (version > target) {
    throw new Error(`Baza versiyasi (${version}) ilovadan yangiroq (${target})`);
  }
  if (version === target) return;

  // user_version = N → migrations[N] dan boshlab qolganlari, hammasi bitta tranzaksiyada.
  await db.exec('BEGIN');
  try {
    for (const sql of migrations.slice(version)) await db.exec(sql);
    await db.exec(`PRAGMA user_version = ${target}`);
    await db.exec('COMMIT');
  } catch (err) {
    await db.exec('ROLLBACK');
    throw err;
  }
}
