import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanName, queueResult, bestReachedBySize, localBests, listRows, migrateReached, defaultIdentity, NAME_MAX } from '../js/leaderboard.js';

test('cleanName trims, collapses spaces, strips control characters and caps the length', () => {
  assert.equal(cleanName('  Mia   Huggins '), 'Mia Huggins');
  assert.equal(cleanName('a\u0000b\tc'), 'abc'); // control characters, tabs included, are dropped (the server does the same)
  assert.equal(cleanName(''), null);
  assert.equal(cleanName('   '), null);
  assert.equal(cleanName(null), null);
  assert.equal(cleanName('x'.repeat(40)).length, NAME_MAX);
  assert.equal(cleanName('abcdefghijklmno  pq'), 'abcdefghijklmno'); // the cut falls on a space, which is trimmed again
  // invisible characters go, every kind of space becomes one space
  assert.equal(cleanName('\u200b'), null);
  assert.equal(cleanName('A\u200dB\u0085C\u00adD\ufeff'), 'ABCD');
  assert.equal(cleanName('a\u00a0\u3000b\u2028c'), 'a b c');
  assert.equal(cleanName('\u202e evil'), 'evil');
});

test('migrateReached gives an old global top level to one size, once', () => {
  assert.equal(migrateReached(undefined), false);
  const fresh = { bestReached5: 0, bestReached6: 2 };
  assert.equal(migrateReached(fresh), false);
  const old5 = { bestLevel: 7, bestReached: 8, history: [{ mode: 'free', size: 6 }] };
  assert.equal(migrateReached(old5), true);
  assert.deepEqual([old5.bestReached5, old5.bestReached6], [8, 0]);
  const old6 = { bestLevel: 3, history: [{ mode: 'levels', size: 6, level: 2, passed: false }, { mode: 'levels', size: 5, level: 9, passed: true }] };
  assert.equal(migrateReached(old6), true);
  assert.deepEqual([old6.bestReached5, old6.bestReached6], [0, 4]); // the latest run was 6x6; bestLevel 3 passed means 4 reached
  assert.equal(migrateReached(old6), false);
  const never = { gamesPlayed: 3 };
  assert.equal(migrateReached(never), true);
  assert.deepEqual([never.bestReached5, never.bestReached6], [0, 0]);
  assert.deepEqual(defaultIdentity(), { playerId: null, name: null, status: 'unasked', pending: [], removals: [] });
});

test('queueResult keeps one entry per board with the highest value', () => {
  const q = [];
  assert.equal(queueResult(q, { size: 5, kind: 'score', value: 120 }), true);
  assert.equal(queueResult(q, { size: 5, kind: 'score', value: 90 }), false);
  assert.equal(queueResult(q, { size: 5, kind: 'score', value: 150 }), true);
  assert.equal(queueResult(q, { size: 5, kind: 'level', value: 3 }), true);
  assert.equal(queueResult(q, { size: 6, kind: 'score', value: 0 }), true);
  assert.equal(queueResult(q, { size: 6, kind: 'score', value: -1 }), false);
  assert.equal(queueResult(q, null), false);
  assert.deepEqual(q, [
    { size: 5, kind: 'score', value: 150 },
    { size: 5, kind: 'level', value: 3 },
    { size: 6, kind: 'score', value: 0 },
  ]);
});

test('bestReachedBySize reads the per-size counters and the history', () => {
  assert.deepEqual(bestReachedBySize(undefined), { 5: 0, 6: 0 });
  assert.deepEqual(bestReachedBySize({ bestReached5: 4 }), { 5: 4, 6: 0 });
  const word = {
    bestReached6: 2,
    history: [
      { mode: 'levels', size: 5, level: 6, passed: false },
      { mode: 'levels', size: 5, level: 6, passed: true }, // passing level 6 reaches 7
      { mode: 'levels', size: 6, level: 1, passed: false },
      { mode: 'free', size: 6, level: 9, passed: false }, // free play is not a run
      { mode: 'levels', level: 3, passed: false }, // an old entry without a size is a 5x5
    ],
  };
  assert.deepEqual(bestReachedBySize(word), { 5: 7, 6: 2 });
});

test('localBests lists what the stats know, per size', () => {
  assert.deepEqual(localBests(undefined), []);
  assert.deepEqual(localBests({ best: 0 }), [{ size: 5, kind: 'score', value: 0 }]);
  assert.deepEqual(localBests({ best: 140, best6: 210, bestReached5: 3, history: [{ mode: 'levels', size: 6, level: 2, passed: true }] }), [
    { size: 5, kind: 'score', value: 140 },
    { size: 6, kind: 'score', value: 210 },
    { size: 5, kind: 'level', value: 3 },
    { size: 6, kind: 'level', value: 3 },
  ]);
});

test('listRows puts a gap before a player row that sits outside the top 10', () => {
  const top = Array.from({ length: 10 }, (_, i) => ({ rank: i + 1, name: `p${i + 1}`, value: 100 - i, me: false }));
  assert.deepEqual(listRows(top), top);
  const mine = { rank: 37, name: 'me', value: 12, me: true };
  const rows = listRows([...top, mine]);
  assert.equal(rows.length, 12);
  assert.deepEqual(rows[10], { gap: true });
  assert.deepEqual(rows[11], mine);
  // eleventh place straight after tenth: no gap
  const rows11 = listRows([...top, { rank: 11, name: 'me', value: 12, me: true }]);
  assert.equal(rows11.length, 11);
  assert.deepEqual(listRows([]), []);
  assert.deepEqual(listRows(null), []);
});
