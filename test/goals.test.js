import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evalGoal, goalCost, conditionHolds, conditionCost, regionLines, regionsOverlap, regionSize, describeGoal,
  bestRegionCells, idx, CELLS, REGION_TYPES,
} from '../js/engine.js';

/** Board builder: fill with `fill`, then set cells from a map of index -> value. */
function board(fill, cells = {}) {
  const b = new Array(CELLS).fill(fill);
  for (const [i, v] of Object.entries(cells)) b[Number(i)] = v;
  return b;
}

/** Place values along a cell list. */
function place(b, cells, values) {
  cells.forEach((i, k) => (b[i] = values[k]));
  return b;
}

const G = (region, condition) => ({ region, condition });

test('region cell lists have the right sizes, order and membership', () => {
  assert.deepEqual(regionLines({ type: 'row', index: 2 }), [[10, 11, 12, 13, 14]]);
  assert.deepEqual(regionLines({ type: 'col', index: 3 }), [[3, 8, 13, 18, 23]]);
  assert.deepEqual(regionLines({ type: 'diag' }), [[0, 6, 12, 18, 24]]);
  assert.deepEqual(regionLines({ type: 'anti' }), [[4, 8, 12, 16, 20]]);
  assert.equal(regionLines({ type: 'anyRow' }).length, 5);
  assert.equal(regionLines({ type: 'anyCol' }).length, 5);
  assert.equal(regionLines({ type: 'anyLine' }).length, 12);
  assert.deepEqual(regionLines({ type: 'corners' }), [[0, 4, 20, 24]]);
  assert.deepEqual(regionLines({ type: 'plus' }), [[7, 11, 12, 13, 17]]);
  assert.deepEqual(regionLines({ type: 'x' }), [[6, 8, 12, 16, 18]]);
  assert.deepEqual(regionLines({ type: 'block', index: 0 }), [[0, 1, 5, 6]]);
  assert.deepEqual(regionLines({ type: 'block', index: 3 }), [[18, 19, 23, 24]]);
  assert.deepEqual(regionLines({ type: 'center3' }), [[6, 7, 8, 11, 12, 13, 16, 17, 18]]);
  assert.equal(regionSize({ type: 'center3' }), 9);
  assert.equal(regionSize({ type: 'corners' }), 4);
  for (const t of REGION_TYPES) assert.ok(regionLines({ type: t, index: 0 }).length >= 1, t);
});

test('regionsOverlap', () => {
  assert.ok(regionsOverlap({ type: 'row', index: 0 }, { type: 'col', index: 4 }));
  assert.ok(regionsOverlap({ type: 'row', index: 2 }, { type: 'plus' }));
  assert.ok(!regionsOverlap({ type: 'row', index: 0 }, { type: 'plus' }));
  assert.ok(!regionsOverlap({ type: 'block', index: 0 }, { type: 'block', index: 3 }));
  assert.ok(regionsOverlap({ type: 'corners' }, { type: 'diag' }));
  assert.ok(!regionsOverlap({ type: 'corners' }, { type: 'center3' }));
  assert.ok(regionsOverlap({ type: 'anyRow' }, { type: 'corners' }));
  assert.ok(regionsOverlap({ type: 'x' }, { type: 'anti' }));
});

test('allEqual / equalTo: positive and negative', () => {
  const row0 = regionLines({ type: 'row', index: 0 })[0];
  const yes = place(board(1), row0, [4, 4, 4, 4, 4]);
  const no = place(board(1), row0, [4, 4, 3, 4, 4]);
  assert.ok(evalGoal(yes, G({ type: 'row', index: 0 }, { type: 'allEqual' })));
  assert.ok(!evalGoal(no, G({ type: 'row', index: 0 }, { type: 'allEqual' })));
  assert.ok(evalGoal(yes, G({ type: 'row', index: 0 }, { type: 'equalTo', value: 4 })));
  assert.ok(!evalGoal(yes, G({ type: 'row', index: 0 }, { type: 'equalTo', value: 3 })));
  assert.ok(!evalGoal(no, G({ type: 'row', index: 0 }, { type: 'equalTo', value: 4 })));
  assert.equal(goalCost(yes, G({ type: 'row', index: 0 }, { type: 'allEqual' })), 0);
  assert.equal(goalCost(no, G({ type: 'row', index: 0 }, { type: 'allEqual' })), 1);
  assert.equal(goalCost(no, G({ type: 'row', index: 0 }, { type: 'equalTo', value: 3 })), 4);
  // corners
  const c = board(2, { 0: 5, 4: 5, 20: 5, 24: 5 });
  assert.ok(evalGoal(c, G({ type: 'corners' }, { type: 'allEqual' })));
  c[24] = 1;
  assert.ok(!evalGoal(c, G({ type: 'corners' }, { type: 'allEqual' })));
  assert.equal(goalCost(c, G({ type: 'corners' }, { type: 'allEqual' })), 1);
});

test('allDifferent', () => {
  const col2 = regionLines({ type: 'col', index: 2 })[0];
  const yes = place(board(1), col2, [1, 2, 3, 4, 5]);
  const no = place(board(1), col2, [1, 2, 3, 4, 4]);
  const g = G({ type: 'col', index: 2 }, { type: 'allDifferent' });
  assert.ok(evalGoal(yes, g));
  assert.ok(!evalGoal(no, g));
  assert.equal(goalCost(no, g), 1);
  assert.equal(goalCost(place(board(1), col2, [2, 2, 2, 2, 2]), g), 4);
  const blk = G({ type: 'block', index: 1 }, { type: 'allDifferent' });
  assert.ok(evalGoal(board(3, { 3: 1, 4: 2, 8: 3, 9: 4 }), blk));
  assert.ok(!evalGoal(board(3, { 3: 1, 4: 2, 8: 3, 9: 1 }), blk));
});

test('ascending run: rows, columns, both diagonals, both starting values, no wrap', () => {
  const g = (region) => G(region, { type: 'ascending' });
  const row3 = regionLines({ type: 'row', index: 3 })[0];
  assert.ok(evalGoal(place(board(6), row3, [1, 2, 3, 4, 5]), g({ type: 'row', index: 3 })));
  assert.ok(evalGoal(place(board(6), row3, [2, 3, 4, 5, 6]), g({ type: 'row', index: 3 })));
  assert.ok(!evalGoal(place(board(6), row3, [5, 4, 3, 2, 1]), g({ type: 'row', index: 3 })), 'descending is not ascending');
  assert.ok(!evalGoal(place(board(6), row3, [3, 4, 5, 6, 1]), g({ type: 'row', index: 3 })), 'no wrap');
  assert.ok(!evalGoal(place(board(6), row3, [1, 2, 3, 4, 6]), g({ type: 'row', index: 3 })));
  const col1 = regionLines({ type: 'col', index: 1 })[0];
  assert.ok(evalGoal(place(board(6), col1, [1, 2, 3, 4, 5]), g({ type: 'col', index: 1 })), 'top to bottom');
  assert.ok(!evalGoal(place(board(6), col1, [5, 4, 3, 2, 1]), g({ type: 'col', index: 1 })));
  const diag = regionLines({ type: 'diag' })[0];
  assert.ok(evalGoal(place(board(6), diag, [2, 3, 4, 5, 6]), g({ type: 'diag' })), 'top-left to bottom-right');
  assert.ok(!evalGoal(place(board(6), diag, [6, 5, 4, 3, 2]), g({ type: 'diag' })));
  const anti = regionLines({ type: 'anti' })[0];
  const antiBoard = place(board(6), anti, [1, 2, 3, 4, 5]); // (0,4)=1 ... (4,0)=5
  assert.equal(antiBoard[idx(0, 4)], 1);
  assert.equal(antiBoard[idx(4, 0)], 5);
  assert.ok(evalGoal(antiBoard, g({ type: 'anti' })), 'top-right to bottom-left');
  assert.ok(!evalGoal(place(board(6), anti, [5, 4, 3, 2, 1]), g({ type: 'anti' })));
  // cost: a rotated run on a row costs 0 moves... no, costs 1 slide, but the heuristic sees 0 mismatches under rotation
  const rotated = place(board(6), row3, [5, 1, 2, 3, 4]);
  assert.ok(!evalGoal(rotated, g({ type: 'row', index: 3 })));
  assert.equal(goalCost(rotated, g({ type: 'row', index: 3 })), 0 + 0, 'rotation-aligned mismatch count is 0, but goal does not hold');
  assert.equal(goalCost(place(board(6), row3, [1, 2, 3, 4, 6]), g({ type: 'row', index: 3 })), 1);
  // diagonals do not rotate under slides
  assert.equal(goalCost(place(board(6), diag, [5, 1, 2, 3, 4]), g({ type: 'diag' })), 5);
});

test('sum exactly N', () => {
  const g = (region, n) => G(region, { type: 'sum', value: n });
  const row1 = regionLines({ type: 'row', index: 1 })[0];
  assert.ok(evalGoal(place(board(1), row1, [4, 4, 4, 4, 4]), g({ type: 'row', index: 1 }, 20)));
  assert.ok(!evalGoal(place(board(1), row1, [4, 4, 4, 4, 5]), g({ type: 'row', index: 1 }, 20)));
  assert.equal(goalCost(place(board(1), row1, [4, 4, 4, 4, 5]), g({ type: 'row', index: 1 }, 20)), 1);
  assert.equal(goalCost(place(board(1), row1, [1, 1, 1, 1, 1]), g({ type: 'row', index: 1 }, 20)), 3);
  assert.ok(evalGoal(board(3), g({ type: 'center3' }, 27)));
  assert.ok(!evalGoal(board(3), g({ type: 'center3' }, 26)));
  assert.ok(evalGoal(board(2, { 0: 1, 4: 2, 20: 3, 24: 4 }), g({ type: 'corners' }, 10)));
});

test('all even / all odd', () => {
  const plus = regionLines({ type: 'plus' })[0];
  assert.ok(evalGoal(place(board(1), plus, [2, 4, 6, 2, 4]), G({ type: 'plus' }, { type: 'allEven' })));
  assert.ok(!evalGoal(place(board(1), plus, [2, 4, 6, 2, 3]), G({ type: 'plus' }, { type: 'allEven' })));
  assert.equal(goalCost(place(board(1), plus, [2, 4, 6, 2, 3]), G({ type: 'plus' }, { type: 'allEven' })), 1);
  assert.ok(evalGoal(place(board(2), plus, [1, 3, 5, 1, 3]), G({ type: 'plus' }, { type: 'allOdd' })));
  assert.ok(!evalGoal(place(board(2), plus, [1, 3, 5, 1, 4]), G({ type: 'plus' }, { type: 'allOdd' })));
  assert.ok(evalGoal(board(5), G({ type: 'center3' }, { type: 'allOdd' })));
  assert.ok(!evalGoal(board(5, { 12: 2 }), G({ type: 'center3' }, { type: 'allOdd' })));
  assert.ok(evalGoal(board(5, { 12: 2 }), G({ type: 'x' }, { type: 'allOdd' })) === false);
});

test('full house', () => {
  const g = G({ type: 'x' }, { type: 'fullHouse' });
  const x = regionLines({ type: 'x' })[0];
  assert.ok(evalGoal(place(board(1), x, [2, 5, 2, 5, 2]), g));
  assert.ok(!evalGoal(place(board(1), x, [2, 2, 2, 2, 2]), g), 'five of a kind is not a full house');
  assert.ok(!evalGoal(place(board(1), x, [2, 2, 2, 2, 5]), g), 'four and one');
  assert.ok(!evalGoal(place(board(1), x, [2, 2, 5, 5, 6]), g), 'two pairs');
  assert.equal(goalCost(place(board(1), x, [2, 2, 5, 5, 6]), g), 1);
  assert.equal(goalCost(place(board(1), x, [1, 2, 3, 4, 5]), g), 3);
  assert.equal(goalCost(place(board(1), x, [2, 2, 2, 2, 2]), g), 2);
});

test('palindrome', () => {
  const g = (region) => G(region, { type: 'palindrome' });
  const row4 = regionLines({ type: 'row', index: 4 })[0];
  assert.ok(evalGoal(place(board(1), row4, [1, 2, 3, 2, 1]), g({ type: 'row', index: 4 })));
  assert.ok(evalGoal(place(board(1), row4, [4, 4, 4, 4, 4]), g({ type: 'row', index: 4 })));
  assert.ok(!evalGoal(place(board(1), row4, [1, 2, 3, 2, 2]), g({ type: 'row', index: 4 })));
  assert.equal(goalCost(place(board(1), row4, [1, 2, 3, 2, 2]), g({ type: 'row', index: 4 })), 1);
  const anti = regionLines({ type: 'anti' })[0];
  assert.ok(evalGoal(place(board(1), anti, [6, 5, 1, 5, 6]), g({ type: 'anti' })));
  assert.ok(!evalGoal(place(board(1), anti, [6, 5, 1, 5, 2]), g({ type: 'anti' })));
});

test('no V (center 3x3)', () => {
  const g = G({ type: 'center3' }, { type: 'noValue', value: 3 });
  assert.ok(evalGoal(board(3, { 6: 1, 7: 1, 8: 1, 11: 1, 12: 1, 13: 1, 16: 1, 17: 1, 18: 1 }), g), 'threes outside the centre do not matter');
  assert.ok(!evalGoal(board(1, { 12: 3 }), g));
  assert.equal(goalCost(board(1, { 12: 3, 13: 3 }), g), 2);
});

test('any-line regions: hold when at least one qualifying line meets the condition', () => {
  const anyRow = G({ type: 'anyRow' }, { type: 'allEqual' });
  const anyCol = G({ type: 'anyCol' }, { type: 'allEqual' });
  const anyLine = G({ type: 'anyLine' }, { type: 'ascending' });
  const b = board(1);
  // Row 0 all equal: anyRow holds, anyCol does not (columns mix values)
  const mixed = b.map((v, i) => (i % 5) + 1); // each row is 1..5, every column constant
  assert.ok(evalGoal(mixed, G({ type: 'anyRow' }, { type: 'ascending' })));
  assert.ok(evalGoal(mixed, anyCol), 'every column is constant');
  assert.ok(!evalGoal(mixed, anyRow));
  assert.ok(evalGoal(mixed, anyLine), 'rows are ascending');
  const diagOnly = board(6);
  place(diagOnly, regionLines({ type: 'anti' })[0], [1, 2, 3, 4, 5]);
  assert.ok(!evalGoal(diagOnly, G({ type: 'anyRow' }, { type: 'ascending' })));
  assert.ok(!evalGoal(diagOnly, G({ type: 'anyCol' }, { type: 'ascending' })));
  assert.ok(evalGoal(diagOnly, anyLine), 'anti-diagonal counts as a line');
  assert.equal(goalCost(diagOnly, anyLine), 0);
  assert.deepEqual(bestRegionCells(diagOnly, anyLine), regionLines({ type: 'anti' })[0]);
  // cost is the minimum over lines
  const near = new Array(CELLS).fill(0).map((_, i) => ((Math.floor(i / 5) + (i % 5)) % 6) + 1); // no constant column
  place(near, regionLines({ type: 'col', index: 4 })[0], [3, 3, 3, 1, 3]);
  assert.ok(!evalGoal(near, anyCol));
  assert.equal(goalCost(near, anyCol), 1);
  assert.equal(goalCost(board(2), anyCol), 0);
});

test('goalCost is 0 exactly when the goal holds (random boards, every region/condition)', () => {
  const conds = [
    { type: 'allEqual' }, { type: 'equalTo', value: 3 }, { type: 'allDifferent' }, { type: 'ascending' },
    { type: 'sum', value: 15 }, { type: 'allEven' }, { type: 'allOdd' }, { type: 'fullHouse' }, { type: 'palindrome' },
    { type: 'noValue', value: 2 },
  ];
  const regions = [
    { type: 'row', index: 1 }, { type: 'col', index: 4 }, { type: 'diag' }, { type: 'anti' }, { type: 'anyRow' }, { type: 'anyCol' },
    { type: 'anyLine' }, { type: 'corners' }, { type: 'plus' }, { type: 'x' }, { type: 'block', index: 2 }, { type: 'center3' },
  ];
  let seed = 1;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed;
  };
  for (let t = 0; t < 400; t++) {
    // bias toward low-entropy boards so goals sometimes hold
    const palette = 1 + (rnd() % 3);
    const b = new Array(CELLS).fill(0).map(() => 1 + (rnd() % palette) + (rnd() % 2 ? 0 : (rnd() % 6)));
    for (let i = 0; i < CELLS; i++) b[i] = ((b[i] - 1) % 6) + 1;
    for (const region of regions) {
      for (const condition of conds) {
        if (condition.type === 'fullHouse' && regionSize(region) !== 5) continue;
        const g = { region, condition };
        const holds = evalGoal(b, g);
        const cost = goalCost(b, g);
        if (condition.type === 'ascending' || condition.type === 'palindrome') {
          // rotation-aligned cost can be 0 without the goal holding on rows/columns
          if (holds) assert.equal(cost, 0, describeGoal(g));
          else assert.ok(cost >= 0);
        } else {
          assert.equal(cost === 0, holds, `${describeGoal(g)} on ${b.join('')}`);
        }
      }
    }
  }
});

test('conditionCost and conditionHolds agree for direct calls', () => {
  assert.equal(conditionHolds([1, 2, 3, 4, 5], { type: 'ascending' }), true);
  assert.equal(conditionCost([1, 2, 3, 4, 5], { type: 'ascending' }), 0);
  assert.equal(conditionCost([2, 1, 3, 4, 5], { type: 'ascending' }), 2);
  assert.equal(conditionCost([5, 1, 2, 3, 4], { type: 'ascending' }, true), 0);
  assert.equal(conditionCost([5, 1, 2, 3, 4], { type: 'ascending' }, false), 5);
  assert.equal(conditionCost([1, 2, 3, 4], { type: 'sum', value: 20 }), 2);
  assert.equal(conditionCost([1, 1, 1, 1], { type: 'sum', value: 8 }), 1);
});

test('describeGoal reads in plain words', () => {
  assert.equal(describeGoal(G({ type: 'row', index: 2 }, { type: 'allEqual' })), 'Row 3: all the same');
  assert.equal(describeGoal(G({ type: 'col', index: 2 }, { type: 'sum', value: 20 })), 'Column 3: sums to 20');
  assert.equal(describeGoal(G({ type: 'center3' }, { type: 'noValue', value: 4 })), 'Center 3x3: no 4s');
  assert.equal(describeGoal(G({ type: 'block', index: 3 }, { type: 'equalTo', value: 6 })), 'Bottom-right 2x2: all 6s');
  assert.equal(describeGoal(G({ type: 'anyLine' }, { type: 'palindrome' })), 'Any line: palindrome');
});
