import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundScore, scoreBreakdown, gameScore, BID_MIN, BID_MAX, PAR_MIN, PAR_MAX } from '../js/engine.js';

test('worked examples from the build plan', () => {
  const rows = [
    [8, 8, 8, 100],
    [9, 8, 8, 90],
    [10, 8, 8, 77],
    [7, 8, 7, 125],
    [8, 8, 9, 0],
    [12, 8, 12, 40],
    [12, 6, 6, 19],
    [9, 10, 9, 125],
  ];
  for (const [bid, par, turns, score] of rows) assert.equal(roundScore(bid, par, turns), score, `bid ${bid} par ${par} turns ${turns}`);
});

test('bonus by overtricks: 0, 5, 7, 8, 9, 9 and never 15', () => {
  const expected = [0, 5, 7, 8, 9, 9];
  for (let d = 0; d < expected.length; d++) {
    const bid = 8 + d;
    const { bonus } = scoreBreakdown(bid, 8, 8);
    assert.equal(bonus, expected[d], `d=${d}`);
  }
  for (let d = 0; d < 50; d++) assert.ok(Math.floor(10 * (1 - Math.pow(0.5, d))) < 15);
});

test('invariant 1: turns > bid scores 0', () => {
  for (let B = BID_MIN; B <= BID_MAX; B++) for (let P = PAR_MIN; P <= PAR_MAX; P++) for (let T = B + 1; T <= 12; T++) assert.equal(roundScore(B, P, T), 0);
});

test('invariant 2: for fixed par and turns, score strictly decreases as bid increases (while not bust)', () => {
  for (let P = PAR_MIN; P <= PAR_MAX; P++) {
    for (let T = 1; T <= 12; T++) {
      for (let B = Math.max(T, BID_MIN); B < BID_MAX; B++) {
        assert.ok(roundScore(B, P, T) > roundScore(B + 1, P, T), `P=${P} T=${T} B=${B}: ${roundScore(B, P, T)} vs ${roundScore(B + 1, P, T)}`);
      }
    }
  }
});

test('invariant 3: for fixed par and bid, score is non-increasing as turns increase', () => {
  for (let P = PAR_MIN; P <= PAR_MAX; P++) {
    for (let B = BID_MIN; B <= BID_MAX; B++) {
      for (let T = 1; T < 12; T++) assert.ok(roundScore(B, P, T) >= roundScore(B, P, T + 1), `P=${P} B=${B} T=${T}`);
    }
  }
});

test('invariant 4: bonus below 15 for every d in range', () => {
  for (let B = BID_MIN; B <= BID_MAX; B++) for (let P = PAR_MIN; P <= PAR_MAX; P++) for (let T = 1; T <= B; T++) assert.ok(scoreBreakdown(B, P, T).bonus < 15);
});

test('invariant 5: game score is the plain sum of five round scores', () => {
  assert.equal(gameScore([100, 90, 77, 0, 125]), 392);
  assert.equal(gameScore([0, 0, 0, 0, 0]), 0);
  assert.equal(gameScore([roundScore(8, 8, 8), roundScore(9, 8, 8), roundScore(7, 7, 7), roundScore(8, 8, 9), roundScore(10, 10, 10)]), 100 + 90 + 100 + 0 + 100);
});

test('breakdown adds up and matches roundScore', () => {
  for (let B = BID_MIN; B <= BID_MAX; B++) {
    for (let P = PAR_MIN; P <= PAR_MAX; P++) {
      for (let T = 1; T <= 12; T++) {
        const b = scoreBreakdown(B, P, T);
        assert.equal(b.score, roundScore(B, P, T));
        assert.equal(b.bust, T > B);
        if (!b.bust) assert.equal(b.base + b.bonus, b.score);
      }
    }
  }
});
