import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deal, createState, applyAction, inverseAction, allActions, drawActions, encodeAction, decodeAction,
  lineCells, idx, bagTotal, isLegalAction, SIZE, CELLS, BAG_SIZE,
} from '../js/engine.js';

const b = (...vals) => vals;

test('deal: 25 tiles on board, 11 in bag, six of each value overall, deterministic per seed', () => {
  for (const seed of [0, 1, 42, 123456789, 0xffffffff]) {
    const { board, bag } = deal(seed);
    assert.equal(board.length, CELLS);
    assert.equal(bagTotal(bag), BAG_SIZE);
    const counts = new Array(7).fill(0);
    for (const v of board) counts[v]++;
    for (let v = 1; v <= 6; v++) counts[v] += bag[v - 1];
    for (let v = 1; v <= 6; v++) assert.equal(counts[v], 6, `value ${v} count`);
    assert.deepEqual(deal(seed), { board, bag });
  }
  assert.notDeepEqual(deal(1).board, deal(2).board);
});

test('slide wraps correctly in all four directions on all ten lines, and reverse restores', () => {
  const { board, bag } = deal(7);
  for (const axis of ['row', 'col']) {
    for (let index = 0; index < SIZE; index++) {
      for (const dir of [1, -1]) {
        const s0 = createState(board, bag, 1);
        const action = { type: 'slide', axis, index, dir };
        const s1 = applyAction(s0, action);
        const cells = lineCells(axis, index);
        const before = cells.map((i) => s0.board[i]);
        const after = cells.map((i) => s1.board[i]);
        for (let k = 0; k < SIZE; k++) {
          const from = ((k - dir) % SIZE + SIZE) % SIZE; // +1 moves tile k to k+1, wrapping
          assert.equal(after[k], before[from], `${axis} ${index} dir ${dir} cell ${k}`);
        }
        // cells off the line are untouched
        for (let i = 0; i < CELLS; i++) if (!cells.includes(i)) assert.equal(s1.board[i], s0.board[i]);
        assert.equal(s1.turns, 1);
        const s2 = applyAction(s1, inverseAction(action));
        assert.deepEqual(s2.board, s0.board);
        assert.equal(s2.turns, 2);
      }
    }
  }
});

test('slide: explicit wrap examples', () => {
  const board = b(
    1, 2, 3, 4, 5,
    1, 1, 1, 1, 1,
    1, 1, 1, 1, 1,
    1, 1, 1, 1, 1,
    6, 1, 1, 1, 1,
  );
  const bag = [1, 2, 2, 2, 2, 2];
  const right = applyAction(createState(board, bag), { type: 'slide', axis: 'row', index: 0, dir: 1 });
  assert.deepEqual(right.board.slice(0, 5), [5, 1, 2, 3, 4]);
  const left = applyAction(createState(board, bag), { type: 'slide', axis: 'row', index: 0, dir: -1 });
  assert.deepEqual(left.board.slice(0, 5), [2, 3, 4, 5, 1]);
  const down = applyAction(createState(board, bag), { type: 'slide', axis: 'col', index: 0, dir: 1 });
  assert.deepEqual(lineCells('col', 0).map((i) => down.board[i]), [6, 1, 1, 1, 1]);
  const up = applyAction(createState(board, bag), { type: 'slide', axis: 'col', index: 0, dir: -1 });
  assert.deepEqual(lineCells('col', 0).map((i) => up.board[i]), [1, 1, 1, 6, 1]);
});

test('swap accepted only for orthogonal neighbours, rejected otherwise', () => {
  const { board, bag } = deal(3);
  const s0 = createState(board, bag);
  const s1 = applyAction(s0, { type: 'swap', r: 1, c: 1, r2: 1, c2: 2 });
  assert.equal(s1.board[idx(1, 1)], s0.board[idx(1, 2)]);
  assert.equal(s1.board[idx(1, 2)], s0.board[idx(1, 1)]);
  const s2 = applyAction(s1, { type: 'swap', r: 1, c: 2, r2: 1, c2: 1 });
  assert.deepEqual(s2.board, s0.board, 'swap is self-inverse');
  assert.ok(isLegalAction({ type: 'swap', r: 0, c: 0, r2: 1, c2: 0 }));
  assert.ok(isLegalAction({ type: 'swap', r: 4, c: 4, r2: 4, c2: 3 }));
  for (const bad of [
    { type: 'swap', r: 0, c: 0, r2: 1, c2: 1 }, // diagonal
    { type: 'swap', r: 0, c: 0, r2: 0, c2: 2 }, // distance 2
    { type: 'swap', r: 0, c: 0, r2: 0, c2: 4 }, // no wrap-around swaps
    { type: 'swap', r: 2, c: 2, r2: 2, c2: 2 }, // same cell
    { type: 'swap', r: 0, c: 0, r2: -1, c2: 0 }, // off board
    { type: 'swap', r: 4, c: 4, r2: 5, c2: 4 },
  ]) {
    assert.equal(isLegalAction(bad), false, JSON.stringify(bad));
    assert.throws(() => applyAction(s0, bad));
  }
});

test('nudge wraps 6 to 1 and 1 to 6', () => {
  const board = new Array(CELLS).fill(3);
  board[0] = 6;
  board[1] = 1;
  const bag = [5, 6, 0, 6, 6, 5];
  const s0 = createState(board, bag);
  assert.equal(applyAction(s0, { type: 'nudge', r: 0, c: 0, delta: 1 }).board[0], 1);
  assert.equal(applyAction(s0, { type: 'nudge', r: 0, c: 1, delta: -1 }).board[1], 6);
  assert.equal(applyAction(s0, { type: 'nudge', r: 0, c: 0, delta: -1 }).board[0], 5);
  assert.equal(applyAction(s0, { type: 'nudge', r: 0, c: 1, delta: 1 }).board[1], 2);
  assert.equal(applyAction(s0, { type: 'nudge', r: 1, c: 1, delta: 1 }).board[idx(1, 1)], 4);
  const back = applyAction(applyAction(s0, { type: 'nudge', r: 0, c: 0, delta: 1 }), { type: 'nudge', r: 0, c: 0, delta: -1 });
  assert.deepEqual(back.board, board);
  assert.deepEqual(back.bag, bag, 'nudge never touches the bag');
  assert.throws(() => applyAction(s0, { type: 'nudge', r: 0, c: 0, delta: 2 }));
});

test('draw keeps the bag at 11, draws from the bag, and never returns the tossed tile on the same turn', () => {
  // Board full of 6s so the bag has no 6s: a draw can never produce a 6 on the same turn.
  const board = new Array(CELLS).fill(6);
  board[0] = 1; // 25 cells: 24 sixes is impossible with six per value, but the engine does not care about physical consistency here
  const bag = [5, 6, 0, 0, 0, 0];
  for (let seed = 0; seed < 500; seed++) {
    const s0 = createState(board, bag, seed);
    const s1 = applyAction(s0, { type: 'draw', r: 2, c: 2 });
    assert.equal(bagTotal(s1.bag), BAG_SIZE);
    assert.notEqual(s1.board[idx(2, 2)], 6, 'tossed tile cannot come back on the same turn');
    assert.ok(s1.board[idx(2, 2)] === 1 || s1.board[idx(2, 2)] === 2);
    assert.equal(s1.bag[5], 1, 'tossed 6 enters the bag after the draw');
    assert.equal(s1.bag[0] + s1.bag[1], 10);
    assert.equal(s1.turns, 1);
    assert.notEqual(s1.rngState, s0.rngState);
    assert.deepEqual(s1.lastDraw, { cell: idx(2, 2), drawn: s1.board[idx(2, 2)], tossed: 6 });
  }
});

test('draw is uniform over bag tiles and reproducible from the seed', () => {
  const { board, bag } = deal(11);
  const counts = new Array(7).fill(0);
  const N = 6000;
  for (let seed = 0; seed < N; seed++) {
    const s1 = applyAction(createState(board, bag, seed), { type: 'draw', r: 0, c: 0 });
    counts[s1.board[0]]++;
  }
  for (let v = 1; v <= 6; v++) {
    const expected = (bag[v - 1] / BAG_SIZE) * N;
    assert.ok(Math.abs(counts[v] - expected) < 0.2 * N / BAG_SIZE + 30, `value ${v}: ${counts[v]} vs ${expected}`);
  }
  // Same seed, same sequence of draws.
  const seq = (seed) => {
    let s = createState(board, bag, seed);
    const out = [];
    for (let k = 0; k < 10; k++) {
      s = applyAction(s, { type: 'draw', r: k % 5, c: (k * 2) % 5 });
      out.push(s.board.slice());
    }
    return out;
  };
  assert.deepEqual(seq(99), seq(99));
  assert.notDeepEqual(seq(99), seq(100));
});

test('applyAction never mutates its input', () => {
  const { board, bag } = deal(5);
  const s0 = createState(board, bag, 9);
  const snapshot = JSON.stringify(s0);
  for (const a of [...allActions(), ...drawActions()]) applyAction(s0, a);
  assert.equal(JSON.stringify(s0), snapshot);
});

test('exactly 110 deterministic actions and 25 draws; inverses undo; encode/decode round-trips', () => {
  const acts = allActions();
  assert.equal(acts.length, 110);
  assert.equal(acts.filter((a) => a.type === 'slide').length, 20);
  assert.equal(acts.filter((a) => a.type === 'swap').length, 40);
  assert.equal(acts.filter((a) => a.type === 'nudge').length, 50);
  assert.equal(drawActions().length, 25);
  const codes = new Set();
  const { board, bag } = deal(8);
  const s0 = createState(board, bag);
  for (const a of acts) {
    const code = encodeAction(a);
    assert.ok(!codes.has(code), `duplicate code ${code}`);
    codes.add(code);
    assert.deepEqual(decodeAction(code), a);
    const back = applyAction(applyAction(s0, a), inverseAction(a));
    assert.deepEqual(back.board, s0.board, `inverse of ${code}`);
  }
  for (const d of drawActions()) {
    const code = encodeAction(d);
    assert.deepEqual(decodeAction(code), d);
    assert.equal(inverseAction(d), null);
  }
});
