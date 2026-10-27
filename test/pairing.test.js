import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../js/rng.js';
import { regionLines, regionSize, evalGoal, deal } from '../js/engine.js';
import {
  defaultWeights, sampleGoal, samplePair, pairStructurallyValid, pairSatisfiable, completable, concreteSatisfiable, REGION_CONDITIONS, pairKey,
} from '../tools/goals.js';

const G = (region, condition) => ({ region, condition });

test('default weights cover every allowed combination and nothing else', () => {
  const w = defaultWeights();
  let n = 0;
  for (const [region, conds] of Object.entries(REGION_CONDITIONS)) for (const c of conds) {
    n++;
    assert.equal(w[`${region}:${c}`], 1);
  }
  assert.equal(Object.keys(w).length, n);
  assert.ok(!('center3:allEqual' in w));
  assert.ok(!('corners:fullHouse' in w));
  assert.ok(!('plus:ascending' in w));
  assert.ok(!('row:noValue' in w));
});

test('sampleGoal respects weights and parameter ranges', () => {
  const rng = mulberry32(5);
  const weights = { 'row:sum': 1, 'corners:sum': 1, 'center3:sum': 1, 'block:equalTo': 1, 'center3:noValue': 1 };
  for (let i = 0; i < 2000; i++) {
    const g = sampleGoal(rng, weights);
    assert.ok(weights[`${g.region.type}:${g.condition.type}`]);
    if (g.condition.type === 'sum') {
      const n = regionSize(g.region);
      const [lo, hi] = { 4: [8, 20], 5: [10, 25], 9: [20, 40] }[n];
      assert.ok(g.condition.value >= lo && g.condition.value <= hi, `${n}-cell sum ${g.condition.value}`);
    }
    if (g.region.type === 'row') assert.ok(g.region.index >= 0 && g.region.index < 5);
    if (g.region.type === 'block') assert.ok(g.region.index >= 0 && g.region.index < 4);
    if (g.condition.type === 'equalTo' || g.condition.type === 'noValue') assert.ok(g.condition.value >= 1 && g.condition.value <= 6);
  }
  // zero weight never sampled
  const only = { 'row:allEqual': 0, 'col:allEqual': 3 };
  for (let i = 0; i < 100; i++) assert.equal(sampleGoal(rng, only).region.type, 'col');
});

test('structural pairing rules', () => {
  const ok = (a, b) => pairStructurallyValid(a, b);
  assert.ok(ok(G({ type: 'row', index: 0 }, { type: 'allEqual' }), G({ type: 'col', index: 0 }, { type: 'sum', value: 15 })));
  assert.ok(!ok(G({ type: 'row', index: 0 }, { type: 'allEqual' }), G({ type: 'row', index: 2 }, { type: 'sum', value: 15 })), 'disjoint rows');
  assert.ok(!ok(G({ type: 'row', index: 0 }, { type: 'allEqual' }), G({ type: 'row', index: 0 }, { type: 'sum', value: 15 })), 'same region');
  assert.ok(pairStructurallyValid(G({ type: 'row', index: 0 }, { type: 'allEqual' }), G({ type: 'row', index: 0 }, { type: 'sum', value: 15 }), { allowSameRegion: true }));
  assert.ok(!ok(G({ type: 'anyRow' }, { type: 'allEqual' }), G({ type: 'anyCol' }, { type: 'sum', value: 15 })), 'two any-line regions');
  assert.ok(!ok(G({ type: 'center3' }, { type: 'allEven' }), G({ type: 'center3' }, { type: 'sum', value: 30 })), 'two center3');
  assert.ok(ok(G({ type: 'center3' }, { type: 'allEven' }), G({ type: 'anyRow' }, { type: 'sum', value: 15 })));
  assert.ok(!ok(G({ type: 'corners' }, { type: 'allEqual' }), G({ type: 'plus' }, { type: 'allEqual' })), 'corners and plus are disjoint');
});

test('completable with fixed cells', () => {
  const row = regionLines({ type: 'row', index: 0 })[0];
  const fixed = (m) => new Map(Object.entries(m).map(([k, v]) => [Number(k), v]));
  assert.ok(completable(row, { type: 'allEqual' }, fixed({ 0: 3, 4: 3 })));
  assert.ok(!completable(row, { type: 'allEqual' }, fixed({ 0: 3, 4: 2 })));
  assert.ok(completable(row, { type: 'ascending' }, fixed({ 0: 2, 2: 4 })));
  assert.ok(!completable(row, { type: 'ascending' }, fixed({ 0: 2, 2: 5 })));
  assert.ok(!completable(row, { type: 'ascending' }, fixed({ 0: 3 })), 'start 3 would need a 7');
  assert.ok(completable(row, { type: 'sum', value: 10 }, fixed({ 0: 6 })));
  assert.ok(!completable(row, { type: 'sum', value: 9 }, fixed({ 0: 6 })), '6 + four cells >= 10');
  assert.ok(completable(row, { type: 'sum', value: 25 }, fixed({ 0: 1 })));
  assert.ok(!completable(row, { type: 'sum', value: 26 }, fixed({ 0: 1 })));
  assert.ok(completable(row, { type: 'fullHouse' }, fixed({ 0: 1, 1: 1, 2: 1 })));
  assert.ok(!completable(row, { type: 'fullHouse' }, fixed({ 0: 1, 1: 1, 2: 1, 3: 1 })));
  assert.ok(!completable(row, { type: 'fullHouse' }, fixed({ 0: 1, 1: 2, 2: 3 })));
  assert.ok(completable(row, { type: 'palindrome' }, fixed({ 0: 2, 4: 2, 1: 5 })));
  assert.ok(!completable(row, { type: 'palindrome' }, fixed({ 0: 2, 4: 3 })));
  assert.ok(!completable(row, { type: 'allDifferent' }, fixed({ 0: 2, 3: 2 })));
  assert.ok(!completable(regionLines({ type: 'center3' })[0], { type: 'noValue', value: 4 }, fixed({ 12: 4 })));
});

test('joint satisfiability catches conflicting pairs and accepts compatible ones', () => {
  // only three even values exist: Center X all different inside Center 3x3 all even is impossible
  assert.ok(!pairSatisfiable(G({ type: 'center3' }, { type: 'allEven' }), G({ type: 'x' }, { type: 'allDifferent' })));
  assert.ok(pairSatisfiable(G({ type: 'center3' }, { type: 'allEven' }), G({ type: 'x' }, { type: 'allEqual' })));
  // corners all equal vs row 0 ascending: (0,0) and (0,4) must be equal and distinct
  assert.ok(!pairSatisfiable(G({ type: 'corners' }, { type: 'allEqual' }), G({ type: 'row', index: 0 }, { type: 'ascending' })));
  // row all 6s vs column all 1s through the shared cell
  assert.ok(!pairSatisfiable(G({ type: 'row', index: 1 }, { type: 'equalTo', value: 6 }), G({ type: 'col', index: 1 }, { type: 'equalTo', value: 1 })));
  assert.ok(pairSatisfiable(G({ type: 'row', index: 1 }, { type: 'equalTo', value: 6 }), G({ type: 'col', index: 1 }, { type: 'sum', value: 20 })));
  // row all 6s vs column all even is fine; vs column all odd is not
  assert.ok(pairSatisfiable(G({ type: 'row', index: 1 }, { type: 'equalTo', value: 6 }), G({ type: 'col', index: 1 }, { type: 'allEven' })));
  assert.ok(!pairSatisfiable(G({ type: 'row', index: 1 }, { type: 'equalTo', value: 6 }), G({ type: 'col', index: 1 }, { type: 'allOdd' })));
  // sums: row 0 sums to 5 (all ones) vs col 0 sums to 30 (all sixes) conflict at (0,0)
  assert.ok(!pairSatisfiable(G({ type: 'row', index: 0 }, { type: 'sum', value: 5 }), G({ type: 'col', index: 0 }, { type: 'sum', value: 30 })));
  // any-line region paired with a line goal: a 6 in the last column fits an ascending row (2..6) ...
  assert.ok(pairSatisfiable(G({ type: 'anyRow' }, { type: 'ascending' }), G({ type: 'col', index: 4 }, { type: 'equalTo', value: 6 })));
  // ... but a 6 in the middle column would need a 7 and an 8
  assert.ok(!pairSatisfiable(G({ type: 'anyRow' }, { type: 'ascending' }), G({ type: 'col', index: 2 }, { type: 'equalTo', value: 6 })));
  // palindrome on the diagonal with corners all equal: fine
  assert.ok(pairSatisfiable(G({ type: 'diag' }, { type: 'palindrome' }), G({ type: 'corners' }, { type: 'equalTo', value: 2 })));
  // center 3x3 all odd with plus full house: fine (3 odd values)
  assert.ok(pairSatisfiable(G({ type: 'center3' }, { type: 'allOdd' }), G({ type: 'plus' }, { type: 'fullHouse' })));
  // center 3x3 all odd with plus all different: impossible (needs 5 distinct odd values)
  assert.ok(!pairSatisfiable(G({ type: 'center3' }, { type: 'allOdd' }), G({ type: 'plus' }, { type: 'allDifferent' })));
  assert.ok(concreteSatisfiable([0, 1, 2, 3, 4], { type: 'allEqual' }, [0, 5, 10, 15, 20], { type: 'allDifferent' }));
});

test('samplePair only returns valid, satisfiable pairs; pairKey is order independent', () => {
  const rng = mulberry32(99);
  const weights = defaultWeights();
  for (let i = 0; i < 300; i++) {
    const p = samplePair(rng, weights);
    assert.ok(p, 'pair found');
    const [a, b] = p.goals;
    assert.ok(pairStructurallyValid(a, b));
    assert.ok(pairSatisfiable(a, b));
    assert.equal(pairKey([a, b]), pairKey([b, a]));
  }
});

test('a generated-style candidate never has a goal holding at deal when filtered', () => {
  const rng = mulberry32(7);
  const weights = defaultWeights();
  const { board } = deal(7);
  let kept = 0;
  for (let i = 0; i < 100; i++) {
    const p = samplePair(rng, weights);
    if (p.goals.some((g) => evalGoal(board, g))) continue;
    kept++;
  }
  assert.ok(kept > 50);
});
