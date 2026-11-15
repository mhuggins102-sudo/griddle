import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanName, queueResult, bestReachedBySize, bestPerkScore, localBests, listRows, seedReached, defaultIdentity, NAME_MAX } from '../js/leaderboard.js';

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
  // the cut counts characters, not UTF-16 units: no half emoji at the end
  assert.equal(cleanName('😀'.repeat(20)), '😀'.repeat(NAME_MAX));
  assert.equal(cleanName('abcdefghijklmno😀x'), 'abcdefghijklmno😀');
});

test('seedReached brings the per-size counters up to what the history proves, and no further', () => {
  assert.equal(seedReached(undefined), false);
  const word = { bestReached5: 3, history: [{ mode: 'levels', size: 5, level: 6, passed: true }, { mode: 'levels', size: 6, level: 2, passed: false }] };
  assert.equal(seedReached(word), true);
  assert.deepEqual([word.bestReached5, word.bestReached6], [7, 2]);
  assert.equal(seedReached(word), false);
  const ahead = { bestReached5: 9, bestReached6: 0, history: [{ mode: 'levels', size: 5, level: 2, passed: false }] };
  assert.equal(seedReached(ahead), false);
  assert.equal(ahead.bestReached5, 9);
});

test('an old global top level is never attributed to a size', () => {
  // a veteran 5x5 player whose last run was a 6x6 loss: the old 12 is not given to 6x6 (or to 5x5)
  const old = { bestReached: 12, bestLevel: 11, best6: 50, history: [{ mode: 'levels', size: 6, level: 1, passed: false }] };
  assert.equal(seedReached(old), true);
  assert.deepEqual(bestReachedBySize(old), { 5: 0, 6: 1 });
  assert.deepEqual(localBests(old).filter((b) => b.kind === 'level'), [{ size: 6, kind: 'level', perks: false, value: 1 }]);
  assert.deepEqual(defaultIdentity(), { playerId: null, name: null, status: 'unasked', pending: [], removals: [], rename: null });
});

test('localBests lists what the stats know, per size', () => {
  assert.deepEqual(localBests(undefined), []);
  assert.deepEqual(localBests({ best: 0 }), [{ size: 5, kind: 'score', perks: false, value: 0 }]);
  assert.deepEqual(localBests({ best: 140, best6: 210, bestReached5: 3, history: [{ mode: 'levels', size: 6, level: 2, passed: true }] }), [
    { size: 5, kind: 'score', perks: false, value: 140 },
    { size: 6, kind: 'score', perks: false, value: 210 },
    { size: 5, kind: 'level', perks: false, value: 3 },
    { size: 6, kind: 'level', perks: false, value: 3 },
  ]);
});

test('runs with perk cards have boards of their own: score and level per size, kept apart from the plain ones', () => {
  const word = {
    best: 100, bestPerks5: 150, bestReached5: 2, bestReachedPerks6: 4,
    history: [
      { mode: 'levels', size: 5, level: 3, passed: false, perks: true, score: 170 }, // beats the stored perk best, and reaches level 3 with cards
      { mode: 'levels', size: 5, level: 7, passed: true, score: 90 }, // a plain run: level 8 reached, no perk figure moves
      { mode: 'levels', size: 6, level: 1, passed: false, perks: true, score: 60 },
    ],
  };
  assert.deepEqual(bestReachedBySize(word), { 5: 8, 6: 0 });
  assert.deepEqual(bestReachedBySize(word, true), { 5: 3, 6: 4 });
  assert.equal(bestPerkScore(word, 5), 170);
  assert.equal(bestPerkScore(word, 6), 60);
  assert.equal(bestPerkScore({ best: 500 }, 5), null); // a plain best is not a perk best
  assert.equal(bestPerkScore({ bestPerks6: 0 }, 6), 0);
  assert.deepEqual(localBests(word), [
    { size: 5, kind: 'score', perks: false, value: 100 },
    { size: 5, kind: 'score', perks: true, value: 170 },
    { size: 6, kind: 'score', perks: true, value: 60 },
    { size: 5, kind: 'level', perks: false, value: 8 },
    { size: 5, kind: 'level', perks: true, value: 3 },
    { size: 6, kind: 'level', perks: true, value: 4 },
  ]);
  // seeding brings both ladders up
  assert.equal(seedReached(word), true);
  assert.deepEqual([word.bestReached5, word.bestReachedPerks5, word.bestReachedPerks6], [8, 3, 4]);
  assert.equal(seedReached(word), false);
});

test('queueResult keeps one entry per board, the perk boards apart, and reads old entries as plain', () => {
  const pending = [{ size: 5, kind: 'score', value: 40 }]; // from before the perk boards: a plain entry
  assert.equal(queueResult(pending, { size: 5, kind: 'score', value: 30 }), false); // lower: nothing
  assert.equal(queueResult(pending, { size: 5, kind: 'score', perks: true, value: 30 }), true); // another board
  assert.equal(queueResult(pending, { size: 5, kind: 'score', value: 55 }), true); // higher: replaces the plain one
  assert.deepEqual(pending, [
    { size: 5, kind: 'score', perks: false, value: 55 },
    { size: 5, kind: 'score', perks: true, value: 30 },
  ]);
  assert.equal(queueResult(pending, { size: 5, kind: 'level', perks: true, value: 2 }), true);
  assert.equal(queueResult(pending, { size: 5, kind: 'level', perks: true, value: 2 }), false);
  assert.equal(queueResult(pending, null), false);
  assert.equal(queueResult(pending, { size: 5, kind: 'level', value: -1 }), false);
  assert.equal(pending.length, 3);
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
