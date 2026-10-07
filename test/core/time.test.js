import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../src/core/time.js';

const TZ = 'Asia/Tashkent'; // UTC+5

test('localParts: UTC 20:30 Toshkentda ertasi kun 01:30', () => {
  const p = T.localParts(new Date('2026-09-29T20:30:00Z'), TZ);
  assert.equal(p.date, '2026-09-30');
  assert.equal(p.time, '01:30');
  assert.equal(p.weekday, 2); // chorshanba (dushanba = 0)
});

test('periodKey va currentKeys: kunlik, haftalik (dushanbadan), oylik', () => {
  const d = new Date('2026-10-04T10:00:00Z'); // yakshanba, 15:00 Toshkent
  assert.equal(T.periodKey('kunlik', d, TZ), 'D2026-10-04');
  assert.equal(T.periodKey('haftalik', d, TZ), 'W2026-09-28');
  assert.equal(T.periodKey('oylik', d, TZ), 'M2026-10');
  assert.deepEqual(T.currentKeys(d, TZ), { doimiy: 'ONCE', kunlik: 'D2026-10-04', haftalik: 'W2026-09-28', oylik: 'M2026-10' });
  // Yakshanba 23:30 → dushanba 04:30 Toshkent: yangi hafta
  assert.equal(T.periodKey('haftalik', new Date('2026-10-04T23:30:00Z'), TZ), 'W2026-10-05');
});

test('sana satrlari: kun qo\'shish, hafta boshi, oy chegaralari, kabisa yil', () => {
  assert.equal(T.addDays('2026-09-30', 1), '2026-10-01');
  assert.equal(T.addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(T.mondayOf('2026-10-04'), '2026-09-28');
  assert.equal(T.mondayOf('2026-09-28'), '2026-09-28');
  assert.equal(T.weekdayOf('2026-10-04'), 6);
  assert.equal(T.monthEnd('2028-02-10'), '2028-02-29');
  assert.equal(T.monthEnd('2026-02-10'), '2026-02-28');
  assert.equal(T.addMonths('2026-12-15', 1), '2027-01-01');
  assert.equal(T.addMonths('2026-03-31', -1), '2026-02-01');
  assert.equal(T.daysBetween('2026-09-01', '2026-09-30'), 29);
  assert.equal(T.dayLabel('2026-09-29'), '29-sentabr');
  assert.equal(T.dayShortLabel('2026-09-29'), 'Se, 29-sen');
});

test("jim soatlar: 23-7 yarim tundan o'tadi", () => {
  const quiet = T.parseQuietHours('23-7');
  assert.equal(T.isQuietHour(23, quiet), true);
  assert.equal(T.isQuietHour(3, quiet), true);
  assert.equal(T.isQuietHour(7, quiet), false);
  assert.equal(T.isQuietHour(12, quiet), false);
  assert.equal(T.isQuietHour(3, T.parseQuietHours('')), false);
  assert.throws(() => T.parseQuietHours('kechasi'));
  assert.throws(() => T.parseQuietHours('25-7'));
});

test('kun yakuni soati: standart 21, bo\'sh — o\'chiq, noto\'g\'ri — xato', () => {
  assert.equal(T.parseSummaryHour(undefined), 21);
  assert.equal(T.parseSummaryHour(''), null);
  assert.equal(T.parseSummaryHour('20'), 20);
  assert.throws(() => T.parseSummaryHour('25'));
  assert.throws(() => T.parseSummaryHour('kech'));
});

test('formatLocal: DD.MM.YYYY SS:DD', () => {
  assert.equal(T.formatLocal(new Date('2026-09-29T13:05:00Z'), TZ), '29.09.2026 18:05');
});

test("yil yordamchilari: yearStart, yearEnd, addYears", () => {
  assert.equal(T.yearStart('2026-10-07'), '2026-01-01');
  assert.equal(T.yearEnd('2026-10-07'), '2026-12-31');
  assert.equal(T.addYears('2026-10-07', -1), '2025-01-01');
  assert.equal(T.addYears('2026-01-01', 2), '2028-01-01');
  assert.equal(T.monthEnd('2028-02-01'), '2028-02-29'); // kabisa yil
});
