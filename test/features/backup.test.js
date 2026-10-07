import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../../src/platform/node.js';
import { createStore } from '../../src/features/store.js';
import { exportData, importData, parseBackup } from '../../src/features/backup.js';

const SCHEMA_SQL = readFileSync(new URL('../../src/data/schema.sql', import.meta.url), 'utf8');

// Toshkent vaqti (UTC+5) bo'yicha lahza.
const at = (localIso) => new Date(new Date(`${localIso}Z`).getTime() - 5 * 3600 * 1000);
const NOW = at('2026-10-07T15:00:00');

async function freshStore({ db = openDatabase(':memory:') } = {}) {
  const clock = { now: NOW };
  const store = createStore(db, { migrations: [SCHEMA_SQL], clock: () => clock.now });
  await store.init();
  return { store, db, clock };
}

const input = (fields) => ({ title: 'Vazifa', description: '', type: 'doimiy', importance: 5, deadline: null, ...fields });

// Manba: kunlik (3 kun bajarilgan), doimiy deadline'li (bajarilgan), o'chirilgan vazifa, o'zgargan sozlamalar.
async function sourceStore() {
  const s = await freshStore();
  s.clock.now = at('2026-10-05T09:00:00');
  const { task: daily } = await s.store.createTask(input({ title: 'Mashq', type: 'kunlik', importance: 7 }));
  s.clock.now = at('2026-10-05T09:00:01');
  const { task: once } = await s.store.createTask(input({ title: 'Hisobot', description: 'Q3', importance: 9, deadline: at('2026-10-08T18:00:00').toISOString() }));
  s.clock.now = at('2026-10-05T09:00:02');
  const { task: gone } = await s.store.createTask(input({ title: "Eski", type: 'haftalik' }));
  for (const day of ['05', '06', '07']) {
    s.clock.now = at(`2026-10-${day}T20:00:00`);
    await s.store.toggleTask(daily.id);
  }
  await s.store.toggleTask(once.id);
  await s.store.toggleTask(gone.id);
  await s.store.deleteTask(gone.id);
  await s.store.updateSettings({ lead_minutes: '30,0', morning_hour: 8, reminder_min_importance: 6 });
  s.clock.now = NOW;
  return s;
}

// id'larsiz solishtirish: vazifalar created_at bo'yicha, bajarilishlar vazifa created_at'i bilan.
async function snapshot(store) {
  const { settings, tasks, completions } = await store.exportBackup();
  const byId = new Map(tasks.map((t) => [t.id, t.created_at]));
  return {
    settings,
    tasks: tasks.map(({ id, ...rest }) => rest).sort((a, b) => a.created_at.localeCompare(b.created_at)),
    completions: completions.map((c) => `${byId.get(c.task_id)}|${c.period_key}|${c.completed_at}`).sort(),
  };
}

test("exportData: fayl nomi mahalliy sana bilan, shakli { version, exportedAt, settings, tasks, completions }", async () => {
  const { store } = await sourceStore();
  const { filename, json } = await exportData(store, at('2026-10-07T23:30:00')); // UTC'da hali 7-okt, Toshkentda 7-okt
  assert.equal(filename, 'vazifalar-2026-10-07.json');
  assert.equal((await exportData(store, at('2026-10-08T01:00:00'))).filename, 'vazifalar-2026-10-08.json'); // UTC'da 7-okt 20:00
  const data = JSON.parse(json);
  assert.deepEqual(Object.keys(data), ['version', 'exportedAt', 'settings', 'tasks', 'completions']);
  assert.equal(data.version, 1);
  assert.equal(data.tasks.length, 3);
  assert.equal(data.completions.length, 5);
  assert.equal(data.settings.lead_minutes, '30,0');
});

test("eksport → bo'sh store'ga import: hammasi, jumladan sozlamalar va hisobotlar, aynan tiklanadi", async () => {
  const src = await sourceStore();
  const { json } = await exportData(src.store, NOW);
  const dst = await freshStore();
  const result = await importData(dst.store, json, { mode: 'replace' });
  assert.deepEqual(result, { added: { tasks: 3, completions: 5 }, skipped: { tasks: 0, completions: 0 }, errors: [] });
  assert.deepEqual(await snapshot(dst.store), await snapshot(src.store));
  // Bajarilishlar ham ko'chdi — hisobotlar bir xil.
  for (const period of ['day', 'week', 'month']) {
    assert.deepEqual(await dst.store.getReport(period, 0), await src.store.getReport(period, 0), period);
  }
  assert.deepEqual(await dst.store.listTasks(), await src.store.listTasks());
});

test("merge: mavjud vazifalar takrorlanmaydi (o'z faylini qayta import)", async () => {
  const { store } = await sourceStore();
  const before = await snapshot(store);
  const { json } = await exportData(store, NOW);
  const result = await importData(store, json, { mode: 'merge' });
  assert.deepEqual(result.added, { tasks: 0, completions: 0 });
  assert.deepEqual(result.skipped, { tasks: 3, completions: 5 });
  assert.deepEqual(await snapshot(store), before);
});

test("merge: faqat yo'qlari qo'shiladi, mavjudlari va sozlamalar o'zgarmaydi", async () => {
  const src = await sourceStore();
  const dst = await freshStore();
  await importData(dst.store, (await exportData(src.store, NOW)).json, { mode: 'merge' });

  // dst'da: vazifa nomi tahrirlandi, o'zining vazifasi bor, sozlama boshqa.
  const { tasks } = await dst.store.listTasks();
  const mashq = tasks.find((t) => t.title === 'Mashq');
  await dst.store.updateTask(mashq.id, input({ title: 'Ertalabki mashq', type: 'kunlik', importance: 7 }));
  dst.clock.now = at('2026-10-07T16:00:00');
  await dst.store.createTask(input({ title: 'Faqat dst' }));
  await dst.store.updateSettings({ morning_hour: 10 });

  // src'da: yangi vazifa va yangi bajarilish.
  src.clock.now = at('2026-10-07T16:30:00');
  const { task: fresh } = await src.store.createTask(input({ title: 'Yangi', importance: 8 }));
  await src.store.toggleTask(fresh.id);

  const result = await importData(dst.store, (await exportData(src.store, NOW)).json, { mode: 'merge' });
  assert.deepEqual(result.added, { tasks: 1, completions: 1 });
  assert.deepEqual(result.skipped, { tasks: 3, completions: 5 });

  const titles = (await dst.store.listTasks()).tasks.map((t) => t.title).sort();
  assert.deepEqual(titles, ['Ertalabki mashq', 'Faqat dst', 'Hisobot', 'Yangi']); // nom o'zgarishi saqlandi, takror yo'q
  assert.equal((await dst.store.listTasks()).tasks.find((t) => t.title === 'Yangi').done, true);
  assert.equal((await dst.store.getMe()).morning_hour, '10:00'); // merge sozlamalarga tegmaydi
});

test('replace: avval hammasi o\'chiriladi, keyin fayl yuklanadi', async () => {
  const src = await sourceStore();
  const dst = await freshStore();
  const { task: own } = await dst.store.createTask(input({ title: 'Yo\'qoladi' }));
  await dst.store.toggleTask(own.id);
  await dst.store.updateSettings({ timezone: 'Europe/London', quiet_hours: '' });

  await importData(dst.store, (await exportData(src.store, NOW)).json, { mode: 'replace' });
  assert.deepEqual(await snapshot(dst.store), await snapshot(src.store));
  assert.equal((await dst.store.getMe()).timezone, 'Asia/Tashkent'); // store'ning joriy zonasi ham yangilandi
});

test("replace: fayldagi yetishmayotgan sozlamalar standartga, noma'lumlari tashlab ketiladi", async () => {
  const dst = await freshStore();
  await dst.store.updateSettings({ morning_hour: 6 });
  const file = { version: 1, settings: { lead_minutes: '15', theme: 'dark' }, tasks: [], completions: [] };
  const result = await importData(dst.store, JSON.stringify(file), { mode: 'replace' });
  assert.deepEqual(result.errors, ["Noma'lum sozlama tashlab ketildi: theme"]);
  const s = await dst.store.getSettings();
  assert.equal(s.lead_minutes, '15');
  assert.equal(s.morning_hour, '9');
});

test("buzuq fayl: o'zbekcha xato va hech narsa o'zgarmaydi", async () => {
  const { store } = await sourceStore();
  const before = await snapshot(store);
  const good = JSON.parse((await exportData(store, NOW)).json);
  const broken = [
    ['{ bu json emas', /JSON emas/],
    ['[]', /tuzilishi tanilmadi/],
    [{ ...good, tasks: 'yo\'q' }, /vazifalar ro'yxati yo'q/],
    [{ ...good, completions: undefined }, /bajarilishlar ro'yxati yo'q/],
    [{ ...good, tasks: [...good.tasks, { ...good.tasks[0], id: 99, importance: 11 }] }, /4-vazifa — muhimlik/],
    [{ ...good, tasks: [{ ...good.tasks[0], type: 'yillik' }, ...good.tasks.slice(1)] }, /turi noto'g'ri/],
    [{ ...good, tasks: [{ ...good.tasks[0], created_at: 'kecha' }, ...good.tasks.slice(1)] }, /sana noto'g'ri/],
    [{ ...good, tasks: [...good.tasks, { ...good.tasks[0] }] }, /id takrorlangan/],
    [{ ...good, completions: [{ task_id: 999, period_key: 'ONCE', completed_at: NOW.toISOString() }] }, /mavjud bo'lmagan vazifaga/],
    [{ ...good, completions: [{ ...good.completions[0], period_key: 'X1' }] }, /davr kaliti/],
  ];
  for (const [file, message] of broken) {
    for (const mode of ['merge', 'replace']) {
      await assert.rejects(importData(store, typeof file === 'string' ? file : JSON.stringify(file), { mode }), (err) => {
        assert.match(err.message, /^Zaxira fayli noto'g'ri: /);
        assert.match(err.message, message);
        return true;
      });
    }
  }
  // Fayl to'g'ri, lekin sozlama qiymati xato — replace yozishdan oldin to'xtaydi.
  await assert.rejects(importData(store, JSON.stringify({ ...good, settings: { ...good.settings, morning_hour: '25' } }), { mode: 'replace' }), /sozlama noto'g'ri \(morning_hour\)/);
  await assert.rejects(importData(store, JSON.stringify(good), { mode: 'qoshish' }), /Tiklash usuli/);
  assert.deepEqual(await snapshot(store), before);
});

test("yozish o'rtasida xato — tranzaksiya qaytariladi, qisman import yo'q", async () => {
  const src = await sourceStore();
  const { json } = await exportData(src.store, NOW);

  const db = openDatabase(':memory:');
  let failOn = Infinity;
  const flaky = {
    ...db,
    exec: (sql) => db.exec(sql),
    get: (sql, p) => db.get(sql, p),
    all: (sql, p) => db.all(sql, p),
    run: (sql, p) => {
      if (/INSERT OR IGNORE INTO task_completions/.test(sql) && (failOn -= 1) < 0) throw new Error('disk to\'ldi');
      return db.run(sql, p);
    },
  };
  const dst = await freshStore({ db: flaky });
  await dst.store.createTask(input({ title: 'Oldindan bor' }));
  const before = await snapshot(dst.store);

  failOn = 2; // 3-bajarilishda yiqiladi — vazifalar allaqachon yozilgan
  for (const mode of ['merge', 'replace']) {
    await assert.rejects(importData(dst.store, json, { mode }), /disk to'ldi/);
    assert.deepEqual(await snapshot(dst.store), before, mode);
    failOn = 2;
  }
});

test("noma'lum versiya rad etiladi", async () => {
  const { store } = await freshStore();
  const file = (version) => JSON.stringify({ version, settings: {}, tasks: [], completions: [] });
  await assert.rejects(importData(store, file(2), { mode: 'merge' }), /versiya 2 — ilovaning yangiroq versiyasidan/);
  await assert.rejects(importData(store, file(0), { mode: 'merge' }), /versiya noma'lum \(0\)/);
  await assert.rejects(importData(store, file(undefined), { mode: 'merge' }), /versiya noma'lum \(yo'q\)/);
  await assert.rejects(importData(store, file('1'), { mode: 'merge' }), /versiya noma'lum/);
});

test('parseBackup: o\'z natijasini qayta tekshiruvdan o\'tkazadi (idempotent)', async () => {
  const { store } = await sourceStore();
  const parsed = parseBackup((await exportData(store, NOW)).json);
  assert.deepEqual(parseBackup(parsed), parsed);
});
