import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyKey, shiftDay, dailySpec, isDailyKey, dailyRecords, dailyTarget } from '../js/daily.js';

test('dailyKey is the local calendar date, zero-padded', () => {
  assert.equal(dailyKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(dailyKey(new Date(2026, 10, 15, 0, 0)), '2026-11-15');
  assert.match(dailyKey(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(isDailyKey('2026-11-15'), true);
  assert.equal(isDailyKey('yesterday'), false);
  assert.equal(isDailyKey(null), false);
});

test('shiftDay crosses month and year ends', () => {
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDay('2024-03-01', -1), '2024-02-29');
  assert.equal(shiftDay('2026-01-01', -1), '2025-12-31');
  assert.equal(shiftDay('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDay('2026-11-15', 0), '2026-11-15');
});

test('dailySpec is deterministic, differs by day, and splits sizes about evenly', () => {
  const a = dailySpec('2026-11-15');
  assert.deepEqual(dailySpec('2026-11-15'), a);
  assert.ok([5, 6].includes(a.size));
  assert.ok(a.seed >= 0 && a.seed < 2 ** 32 && a.drawSeed >= 0 && a.drawSeed < 2 ** 32);
  const b = dailySpec('2026-11-16');
  assert.notEqual(a.seed, b.seed);
  assert.notEqual(a.drawSeed, b.drawSeed);
  let sixes = 0;
  let key = '2026-01-01';
  for (let i = 0; i < 365; i++) {
    if (dailySpec(key).size === 6) sixes++;
    key = shiftDay(key, 1);
  }
  assert.ok(sixes > 365 * 0.4 && sixes < 365 * 0.6, `${sixes} of 365 days are 6x6`);
});

test('dailyRecords merges the per-day map with the old single field; dailyTarget offers today, then yesterday, then nothing', () => {
  assert.deepEqual(dailyRecords(undefined), {});
  assert.deepEqual(dailyRecords({ daily: { day: '2026-11-14', size: 5, score: 50 } }), { '2026-11-14': { day: '2026-11-14', size: 5, score: 50 } });
  const word = { daily: { day: '2026-11-13', size: 5, score: 50 }, dailies: { '2026-11-15': { size: 6, score: 44 }, nope: { size: 5, score: 1 } } };
  assert.deepEqual(Object.keys(dailyRecords(word)).sort(), ['2026-11-13', '2026-11-15']);
  assert.equal(dailyTarget({}, '2026-11-15'), '2026-11-15'); // nothing played: today
  assert.equal(dailyTarget(word, '2026-11-15'), '2026-11-14'); // today done, yesterday missed: yesterday
  assert.equal(dailyTarget({ dailies: { '2026-11-15': { score: 1 }, '2026-11-14': { score: null, abandoned: true } } }, '2026-11-15'), null); // both done (one given up): wait
  assert.equal(dailyTarget({ dailies: { '2026-11-14': { score: 9 } } }, '2026-11-15'), '2026-11-15'); // yesterday done, today not: today
});
