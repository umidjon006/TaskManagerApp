import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../../src/platform/node.js';
import { createStore } from '../../src/features/store.js';
import { runSync, syncNotifications } from '../../src/features/notifications.js';
import * as web from '../../src/platform/web-notifications.js';

const SCHEMA_SQL = readFileSync(new URL('../../src/data/schema.sql', import.meta.url), 'utf8');

// Toshkent vaqti (UTC+5) bo'yicha lahza.
const at = (localIso) => new Date(new Date(`${localIso}Z`).getTime() - 5 * 3600 * 1000);
const NOW = at('2026-10-01T15:00:00');

async function freshStore() {
  const store = createStore(openDatabase(':memory:'), { migrations: [SCHEMA_SQL], clock: () => NOW });
  await store.init();
  return store;
}

// Platform interfeysini yozib boruvchi soxta notifier.
function fakeNotifier({ supported = true, notifications = 'granted', exactAlarm = 'granted' } = {}) {
  const calls = [];
  let scheduled = [];
  return {
    calls,
    get scheduled() { return scheduled; },
    async isSupported() { return supported; },
    async checkPermissions() { calls.push('check'); return { notifications, exactAlarm }; },
    async requestPermissions() { calls.push('request'); return { notifications, exactAlarm }; },
    async ensureChannel() { calls.push('channel'); },
    async cancelAll() { calls.push('cancelAll'); scheduled = []; },
    async schedule(items) { calls.push('schedule'); scheduled = items; },
    async pending() { return scheduled; },
    async openChannelSettings() { return true; },
    async openNotificationSettings() { return true; },
    async openExactAlarmSettings() { return true; },
  };
}

test('web notifier: interfeys bir xil, hammasi no-op', async () => {
  const fake = fakeNotifier();
  for (const key of Object.keys(fake).filter((k) => typeof fake[k] === 'function')) {
    assert.equal(typeof web[key], 'function', key);
  }
  assert.equal(await web.isSupported(), false);
  assert.deepEqual(await web.pending(), []);
  assert.deepEqual(await runSync(await freshStore(), web, NOW), { skipped: true });
});

test("runSync: ruxsat yo'q — hech narsa jadvallanmaydi va ruxsat so'ralmaydi", async () => {
  const store = await freshStore();
  await store.createTask({ title: 'Mashq', type: 'kunlik', importance: 5 });
  for (const state of ['prompt', 'denied']) {
    const notifier = fakeNotifier({ notifications: state });
    const result = await runSync(store, notifier, NOW);
    assert.equal(result.skipped, true);
    assert.equal(result.permission, state);
    assert.deepEqual(notifier.calls, ['check']);
  }
});

test('runSync: kanal → cancelAll → schedule tartibida, buildSchedule natijasi bilan', async () => {
  const store = await freshStore();
  await store.createTask({ title: 'Hisobot', type: 'doimiy', importance: 7, deadline: at('2026-10-02T14:00:00').toISOString() });
  await store.createTask({ title: 'Sport', type: 'kunlik', importance: 6 });
  const notifier = fakeNotifier({ exactAlarm: 'denied' });
  const result = await runSync(store, notifier, NOW);
  assert.deepEqual(notifier.calls, ['check', 'channel', 'cancelAll', 'schedule']);
  assert.equal(result.scheduled, notifier.scheduled.length);
  assert.equal(result.exactAlarm, 'denied');
  assert.ok(notifier.scheduled.some((n) => n.kind === 'deadline' && n.title === 'Hisobot'));
  assert.ok(notifier.scheduled.some((n) => n.kind === 'evening' && n.body.includes('Sport')));
});

test("runSync: store sozlamalari ishlatiladi (lead_minutes, vaqt zonasi)", async () => {
  const store = await freshStore();
  await store.createTask({ title: 'Hisobot', type: 'doimiy', importance: 7, deadline: at('2026-10-02T14:00:00').toISOString() });
  await store.updateSettings({ lead_minutes: '30', morning_hour: '', summary_hour: '' });
  const notifier = fakeNotifier();
  await runSync(store, notifier, NOW);
  // Deadline kunidagi 13:30 eslatma; 2-okt kechki yakun o'chiq.
  assert.deepEqual(notifier.scheduled.filter((n) => n.kind === 'deadline').map((n) => n.at), [at('2026-10-02T13:30:00').toISOString()]);
  assert.equal(notifier.scheduled.filter((n) => n.kind !== 'deadline').length, 0);
});

test('syncNotifications: ketma-ket chaqiruvlar bitta ishga birlashadi', async () => {
  const store = await freshStore();
  await store.createTask({ title: 'Sport', type: 'kunlik', importance: 6 });
  const notifier = fakeNotifier();
  const results = await Promise.all(Array.from({ length: 5 }, () => syncNotifications(store, notifier, NOW, { delay: 20 })));
  assert.equal(notifier.calls.filter((c) => c === 'schedule').length, 1);
  assert.ok(results.every((r) => r === results[0] && r.scheduled > 0));
});

test('syncNotifications: ishlar ustma-ust tushmaydi — cancelAll/schedule juftligi ketma-ket', async () => {
  const store = await freshStore();
  const notifier = fakeNotifier();
  const original = notifier.cancelAll;
  notifier.cancelAll = async () => { await new Promise((r) => setTimeout(r, 30)); return original(); };
  const first = syncNotifications(store, notifier, NOW, { delay: 1 });
  await new Promise((r) => setTimeout(r, 10)); // birinchisi cancelAll ichida
  const second = syncNotifications(store, notifier, NOW, { delay: 1 });
  await Promise.all([first, second]);
  const order = notifier.calls.filter((c) => c === 'cancelAll' || c === 'schedule');
  assert.deepEqual(order, ['cancelAll', 'schedule', 'cancelAll', 'schedule']);
});
