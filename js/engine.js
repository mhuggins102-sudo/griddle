// GridLock engine: deal, actions, goals, goal cost, scoring.
// Pure functions, no DOM. Shared by the browser UI, the generator, the bot and the tests.

import { mulberry32, rngNext, shuffle } from './rng.js';

export const SIZE = 5;
export const CELLS = SIZE * SIZE;
export const MIN_VALUE = 1;
export const MAX_VALUE = 6;
export const TILES_PER_VALUE = 6;
export const BAG_SIZE = TILES_PER_VALUE * MAX_VALUE - CELLS; // 11
export const BID_MIN = 1;
export const BID_MAX = 12;
export const PAR_MIN = 6;
export const PAR_MAX = 10;
export const ROUNDS_PER_GAME = 5;

export const idx = (r, c) => r * SIZE + c;
export const rowOf = (i) => Math.floor(i / SIZE);
export const colOf = (i) => i % SIZE;

// ---------------------------------------------------------------------------
// Deal

/** Deal 25 tiles from the 36-tile multiset. Returns { board, bag } where bag is counts per value (index 0 = value 1). */
export function deal(seed) {
  const rng = mulberry32(seed);
  const tiles = [];
  for (let v = MIN_VALUE; v <= MAX_VALUE; v++) for (let k = 0; k < TILES_PER_VALUE; k++) tiles.push(v);
  shuffle(tiles, rng);
  const board = tiles.slice(0, CELLS);
  const bag = new Array(MAX_VALUE).fill(0);
  for (let i = CELLS; i < tiles.length; i++) bag[tiles[i] - 1]++;
  return { board, bag };
}

/** Build a play state. drawSeed drives the Draw action's randomness. */
export function createState(board, bag, drawSeed = 0) {
  return { board: board.slice(), bag: bag.slice(), rngState: drawSeed >>> 0, turns: 0 };
}

export function bagTotal(bag) {
  return bag.reduce((a, b) => a + b, 0);
}

// ---------------------------------------------------------------------------
// Actions
//
// slide: { type: 'slide', axis: 'row'|'col', index: 0..4, dir: +1|-1 }  (+1 = right/down, -1 = left/up)
// swap:  { type: 'swap', r, c, r2, c2 }   (orthogonal neighbours only)
// nudge: { type: 'nudge', r, c, delta: +1|-1 }
// draw:  { type: 'draw', r, c }

export function validateAction(action) {
  if (!action || typeof action !== 'object') throw new Error('Action must be an object');
  const inRange = (n) => Number.isInteger(n) && n >= 0 && n < SIZE;
  switch (action.type) {
    case 'slide':
      if (action.axis !== 'row' && action.axis !== 'col') throw new Error('Slide axis must be row or col');
      if (!inRange(action.index)) throw new Error('Slide index out of range');
      if (action.dir !== 1 && action.dir !== -1) throw new Error('Slide dir must be +1 or -1');
      return true;
    case 'swap': {
      if (!inRange(action.r) || !inRange(action.c) || !inRange(action.r2) || !inRange(action.c2)) {
        throw new Error('Swap cell out of range');
      }
      const dist = Math.abs(action.r - action.r2) + Math.abs(action.c - action.c2);
      if (dist !== 1) throw new Error('Swap cells must be orthogonal neighbours');
      return true;
    }
    case 'nudge':
      if (!inRange(action.r) || !inRange(action.c)) throw new Error('Nudge cell out of range');
      if (action.delta !== 1 && action.delta !== -1) throw new Error('Nudge delta must be +1 or -1');
      return true;
    case 'draw':
      if (!inRange(action.r) || !inRange(action.c)) throw new Error('Draw cell out of range');
      return true;
    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
}

export function isLegalAction(action) {
  try {
    validateAction(action);
    return true;
  } catch {
    return false;
  }
}

/** Wrap a value into 1..6. */
export function wrapValue(v) {
  return ((v - MIN_VALUE) % MAX_VALUE + MAX_VALUE) % MAX_VALUE + MIN_VALUE;
}

/** Apply a slide/swap/nudge to a board array in place (any array-like of 25). */
export function applyBoardAction(board, action) {
  switch (action.type) {
    case 'slide': {
      const cells = lineCells(action.axis, action.index);
      if (action.dir === 1) {
        const last = board[cells[SIZE - 1]];
        for (let k = SIZE - 1; k > 0; k--) board[cells[k]] = board[cells[k - 1]];
        board[cells[0]] = last;
      } else {
        const first = board[cells[0]];
        for (let k = 0; k < SIZE - 1; k++) board[cells[k]] = board[cells[k + 1]];
        board[cells[SIZE - 1]] = first;
      }
      return board;
    }
    case 'swap': {
      const a = idx(action.r, action.c);
      const b = idx(action.r2, action.c2);
      const t = board[a];
      board[a] = board[b];
      board[b] = t;
      return board;
    }
    case 'nudge': {
      const a = idx(action.r, action.c);
      board[a] = wrapValue(board[a] + action.delta);
      return board;
    }
    default:
      throw new Error(`applyBoardAction cannot apply ${action.type}`);
  }
}

/** Apply one action to a state and return the new state (the input is not mutated). */
export function applyAction(state, action) {
  validateAction(action);
  const next = { board: state.board.slice(), bag: state.bag.slice(), rngState: state.rngState, turns: state.turns + 1 };
  if (action.type === 'draw') {
    const cell = idx(action.r, action.c);
    const total = bagTotal(next.bag);
    if (total <= 0) throw new Error('Bag is empty');
    const r = rngNext(next.rngState);
    next.rngState = r.state;
    let pick = Math.floor(r.value * total);
    let drawn = -1;
    for (let v = 0; v < MAX_VALUE; v++) {
      if (pick < next.bag[v]) {
        drawn = v;
        break;
      }
      pick -= next.bag[v];
    }
    const tossed = next.board[cell];
    next.bag[drawn]--; // the drawn tile leaves the bag first ...
    next.board[cell] = drawn + 1;
    next.bag[tossed - 1]++; // ... then the tossed tile goes in (Scrabble rule)
    next.lastDraw = { cell, drawn: drawn + 1, tossed };
  } else {
    applyBoardAction(next.board, action);
  }
  return next;
}

/** The inverse of a deterministic action (draw has none). */
export function inverseAction(action) {
  switch (action.type) {
    case 'slide':
      return { ...action, dir: -action.dir };
    case 'swap':
      return { ...action };
    case 'nudge':
      return { ...action, delta: -action.delta };
    default:
      return null;
  }
}

/** The 110 deterministic actions in a fixed order: 20 slides, 40 swaps, 50 nudges. */
export function allActions() {
  const out = [];
  for (const axis of ['row', 'col']) {
    for (let i = 0; i < SIZE; i++) for (const dir of [-1, 1]) out.push({ type: 'slide', axis, index: i, dir });
  }
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (c + 1 < SIZE) out.push({ type: 'swap', r, c, r2: r, c2: c + 1 });
      if (r + 1 < SIZE) out.push({ type: 'swap', r, c, r2: r + 1, c2: c });
    }
  }
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) for (const delta of [1, -1]) out.push({ type: 'nudge', r, c, delta });
  }
  return out;
}

export function drawActions() {
  const out = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) out.push({ type: 'draw', r, c });
  return out;
}

/** Compact string form: R2L, C3U, W7-8, N12+, D4. */
export function encodeAction(a) {
  switch (a.type) {
    case 'slide':
      return (a.axis === 'row' ? 'R' : 'C') + a.index + (a.axis === 'row' ? (a.dir === 1 ? 'R' : 'L') : a.dir === 1 ? 'D' : 'U');
    case 'swap':
      return `W${idx(a.r, a.c)}-${idx(a.r2, a.c2)}`;
    case 'nudge':
      return `N${idx(a.r, a.c)}${a.delta === 1 ? '+' : '-'}`;
    case 'draw':
      return `D${idx(a.r, a.c)}`;
    default:
      throw new Error(`Cannot encode ${a.type}`);
  }
}

export function decodeAction(s) {
  const head = s[0];
  if (head === 'R' || head === 'C') {
    const axis = head === 'R' ? 'row' : 'col';
    const index = Number(s[1]);
    const d = s[2];
    const dir = d === 'R' || d === 'D' ? 1 : -1;
    return { type: 'slide', axis, index, dir };
  }
  if (head === 'W') {
    const [a, b] = s.slice(1).split('-').map(Number);
    return { type: 'swap', r: rowOf(a), c: colOf(a), r2: rowOf(b), c2: colOf(b) };
  }
  if (head === 'N') {
    const cell = Number(s.slice(1, -1));
    return { type: 'nudge', r: rowOf(cell), c: colOf(cell), delta: s.endsWith('+') ? 1 : -1 };
  }
  if (head === 'D') {
    const cell = Number(s.slice(1));
    return { type: 'draw', r: rowOf(cell), c: colOf(cell) };
  }
  throw new Error(`Cannot decode action "${s}"`);
}

/** Human wording for an action, e.g. for the solution replay. */
export function describeAction(a) {
  const cell = (r, c) => `row ${r + 1}, col ${c + 1}`;
  switch (a.type) {
    case 'slide':
      return a.axis === 'row'
        ? `Slide row ${a.index + 1} ${a.dir === 1 ? 'right' : 'left'}`
        : `Slide column ${a.index + 1} ${a.dir === 1 ? 'down' : 'up'}`;
    case 'swap':
      return `Swap (${cell(a.r, a.c)}) with (${cell(a.r2, a.c2)})`;
    case 'nudge':
      return `Nudge (${cell(a.r, a.c)}) ${a.delta === 1 ? '+1' : '-1'}`;
    case 'draw':
      return `Draw at (${cell(a.r, a.c)})`;
    default:
      return '?';
  }
}

// ---------------------------------------------------------------------------
// Regions

/** Cell indices of a row or column in reading order. */
export function lineCells(axis, index) {
  const out = new Array(SIZE);
  for (let k = 0; k < SIZE; k++) out[k] = axis === 'row' ? idx(index, k) : idx(k, index);
  return out;
}

const DIAG = [0, 6, 12, 18, 24]; // top-left to bottom-right
const ANTI = [4, 8, 12, 16, 20]; // top-right to bottom-left
const CORNERS = [0, 4, 20, 24];
const PLUS = [7, 11, 12, 13, 17];
const X = [6, 8, 12, 16, 18];
const BLOCKS = [
  [0, 1, 5, 6], // top-left
  [3, 4, 8, 9], // top-right
  [15, 16, 20, 21], // bottom-left
  [18, 19, 23, 24], // bottom-right
];
const CENTER3 = [6, 7, 8, 11, 12, 13, 16, 17, 18];

export const REGION_TYPES = ['row', 'col', 'diag', 'anti', 'anyRow', 'anyCol', 'anyLine', 'corners', 'plus', 'x', 'block', 'center3'];
export const LINE_REGION_TYPES = new Set(['row', 'col', 'diag', 'anti', 'anyRow', 'anyCol', 'anyLine']);
export const ANY_REGION_TYPES = new Set(['anyRow', 'anyCol', 'anyLine']);

/**
 * Candidate cell lists for a region. Named regions give one list; any-* regions give
 * every qualifying line. Order within a list is the reading order used by Ascending run
 * and Palindrome.
 */
export function regionLines(region) {
  switch (region.type) {
    case 'row':
      return [lineCells('row', region.index)];
    case 'col':
      return [lineCells('col', region.index)];
    case 'diag':
      return [DIAG.slice()];
    case 'anti':
      return [ANTI.slice()];
    case 'anyRow':
      return [0, 1, 2, 3, 4].map((i) => lineCells('row', i));
    case 'anyCol':
      return [0, 1, 2, 3, 4].map((i) => lineCells('col', i));
    case 'anyLine':
      return [...[0, 1, 2, 3, 4].map((i) => lineCells('row', i)), ...[0, 1, 2, 3, 4].map((i) => lineCells('col', i)), DIAG.slice(), ANTI.slice()];
    case 'corners':
      return [CORNERS.slice()];
    case 'plus':
      return [PLUS.slice()];
    case 'x':
      return [X.slice()];
    case 'block':
      return [BLOCKS[region.index].slice()];
    case 'center3':
      return [CENTER3.slice()];
    default:
      throw new Error(`Unknown region type ${region.type}`);
  }
}

/** Number of cells in each candidate line of the region. */
export function regionSize(region) {
  return regionLines(region)[0].length;
}

/** Whether two regions share at least one cell (any candidate line counts). */
export function regionsOverlap(a, b) {
  const sa = new Set(regionLines(a).flat());
  return regionLines(b).flat().some((i) => sa.has(i));
}

/** Whether a region's candidate lines are rows/columns, which Slide rotates cyclically. */
function lineIsSlidable(cells) {
  const r0 = rowOf(cells[0]);
  const c0 = colOf(cells[0]);
  return cells.every((i) => rowOf(i) === r0) || cells.every((i) => colOf(i) === c0);
}

// ---------------------------------------------------------------------------
// Conditions

export const CONDITION_TYPES = ['allEqual', 'equalTo', 'allDifferent', 'ascending', 'sum', 'allEven', 'allOdd', 'fullHouse', 'palindrome', 'noValue'];

function countValues(values) {
  const counts = new Array(MAX_VALUE + 1).fill(0);
  for (const v of values) counts[v]++;
  return counts;
}

/** Does the condition hold on these values (in reading order)? */
export function conditionHolds(values, cond) {
  const n = values.length;
  switch (cond.type) {
    case 'allEqual':
      return values.every((v) => v === values[0]);
    case 'equalTo':
      return values.every((v) => v === cond.value);
    case 'allDifferent':
      return new Set(values).size === n;
    case 'ascending':
      for (let k = 1; k < n; k++) if (values[k] !== values[k - 1] + 1) return false;
      return true;
    case 'sum':
      return values.reduce((a, b) => a + b, 0) === cond.value;
    case 'allEven':
      return values.every((v) => v % 2 === 0);
    case 'allOdd':
      return values.every((v) => v % 2 === 1);
    case 'fullHouse': {
      const counts = countValues(values).filter((c) => c > 0).sort((a, b) => b - a);
      return n === 5 && counts.length === 2 && counts[0] === 3 && counts[1] === 2;
    }
    case 'palindrome':
      for (let k = 0; k < n >> 1; k++) if (values[k] !== values[n - 1 - k]) return false;
      return true;
    case 'noValue':
      return values.every((v) => v !== cond.value);
    default:
      throw new Error(`Unknown condition type ${cond.type}`);
  }
}

/**
 * A lower-bound-ish distance for the condition: the number of cells that must change
 * (under the best alignment). 0 exactly when the condition holds.
 * For rows/columns the order-dependent conditions take the minimum over cyclic rotations,
 * because a single Slide rotates the line.
 */
export function conditionCost(values, cond, slidable = false) {
  const n = values.length;
  switch (cond.type) {
    case 'allEqual': {
      const counts = countValues(values);
      let best = 0;
      for (let v = MIN_VALUE; v <= MAX_VALUE; v++) if (counts[v] > best) best = counts[v];
      return n - best;
    }
    case 'equalTo': {
      let c = 0;
      for (const v of values) if (v !== cond.value) c++;
      return c;
    }
    case 'allDifferent':
      return n - new Set(values).size;
    case 'ascending': {
      let best = n;
      const rotations = slidable ? n : 1;
      for (let rot = 0; rot < rotations; rot++) {
        for (let s = MIN_VALUE; s + n - 1 <= MAX_VALUE; s++) {
          let miss = 0;
          for (let k = 0; k < n; k++) if (values[(k + rot) % n] !== s + k) miss++;
          if (miss < best) best = miss;
        }
      }
      return best;
    }
    case 'sum': {
      const sum = values.reduce((a, b) => a + b, 0);
      return Math.ceil(Math.abs(sum - cond.value) / (MAX_VALUE - MIN_VALUE));
    }
    case 'allEven': {
      let c = 0;
      for (const v of values) if (v % 2 !== 0) c++;
      return c;
    }
    case 'allOdd': {
      let c = 0;
      for (const v of values) if (v % 2 !== 1) c++;
      return c;
    }
    case 'fullHouse': {
      const counts = countValues(values);
      let best = 0;
      for (let a = MIN_VALUE; a <= MAX_VALUE; a++) {
        for (let b = MIN_VALUE; b <= MAX_VALUE; b++) {
          if (a === b) continue;
          const got = Math.min(counts[a], 3) + Math.min(counts[b], 2);
          if (got > best) best = got;
        }
      }
      return n - best;
    }
    case 'palindrome': {
      let best = n;
      const rotations = slidable ? n : 1;
      for (let rot = 0; rot < rotations; rot++) {
        let miss = 0;
        for (let k = 0; k < n >> 1; k++) if (values[(k + rot) % n] !== values[(n - 1 - k + rot) % n]) miss++;
        if (miss < best) best = miss;
      }
      return best;
    }
    case 'noValue': {
      let c = 0;
      for (const v of values) if (v === cond.value) c++;
      return c;
    }
    default:
      throw new Error(`Unknown condition type ${cond.type}`);
  }
}

// ---------------------------------------------------------------------------
// Goals: { region: { type, index? }, condition: { type, value? } }

export function evalGoal(board, goal) {
  for (const cells of regionLines(goal.region)) {
    const values = cells.map((i) => board[i]);
    if (conditionHolds(values, goal.condition)) return true;
  }
  return false;
}

/** Distance-to-goal heuristic, minimised over candidate lines. 0 exactly when the goal holds. */
export function goalCost(board, goal) {
  let best = Infinity;
  for (const cells of regionLines(goal.region)) {
    const values = cells.map((i) => board[i]);
    const c = conditionCost(values, goal.condition, lineIsSlidable(cells));
    if (c < best) best = c;
  }
  return best;
}

/** The candidate line closest to satisfying the goal (for highlighting any-* regions). */
export function bestRegionCells(board, goal) {
  let best = null;
  let bestCost = Infinity;
  for (const cells of regionLines(goal.region)) {
    const values = cells.map((i) => board[i]);
    const c = conditionCost(values, goal.condition, lineIsSlidable(cells));
    if (c < bestCost) {
      bestCost = c;
      best = cells;
    }
  }
  return best;
}

export function allGoalsHold(board, goals) {
  return goals.every((g) => evalGoal(board, g));
}

export function describeRegion(region) {
  switch (region.type) {
    case 'row':
      return `Row ${region.index + 1}`;
    case 'col':
      return `Column ${region.index + 1}`;
    case 'diag':
      return 'Main diagonal';
    case 'anti':
      return 'Anti-diagonal';
    case 'anyRow':
      return 'Any row';
    case 'anyCol':
      return 'Any column';
    case 'anyLine':
      return 'Any line';
    case 'corners':
      return 'Four corners';
    case 'plus':
      return 'Center plus';
    case 'x':
      return 'Center X';
    case 'block':
      return ['Top-left 2x2', 'Top-right 2x2', 'Bottom-left 2x2', 'Bottom-right 2x2'][region.index];
    case 'center3':
      return 'Center 3x3';
    default:
      return region.type;
  }
}

export function describeCondition(cond) {
  switch (cond.type) {
    case 'allEqual':
      return 'all the same';
    case 'equalTo':
      return `all ${cond.value}s`;
    case 'allDifferent':
      return 'all different';
    case 'ascending':
      return 'ascending run';
    case 'sum':
      return `sums to ${cond.value}`;
    case 'allEven':
      return 'all even';
    case 'allOdd':
      return 'all odd';
    case 'fullHouse':
      return 'full house';
    case 'palindrome':
      return 'palindrome';
    case 'noValue':
      return `no ${cond.value}s`;
    default:
      return cond.type;
  }
}

export function describeGoal(goal) {
  return `${describeRegion(goal.region)}: ${describeCondition(goal.condition)}`;
}

// ---------------------------------------------------------------------------
// Scoring

/** Round score from bid B, par P and turns used T. */
export function roundScore(bid, par, turns) {
  if (turns > bid) return 0;
  const m = bid - par;
  const d = bid - turns;
  const base = m < 0 ? 100 + 25 * -m : Math.max(10, 100 - 15 * m);
  const bonus = Math.floor(10 * (1 - Math.pow(0.5, d)));
  return base + bonus;
}

export function scoreBreakdown(bid, par, turns) {
  if (turns > bid) return { bust: true, base: 0, bonus: 0, score: 0 };
  const m = bid - par;
  const d = bid - turns;
  const base = m < 0 ? 100 + 25 * -m : Math.max(10, 100 - 15 * m);
  const bonus = Math.floor(10 * (1 - Math.pow(0.5, d)));
  return { bust: false, base, bonus, score: base + bonus };
}

export function gameScore(roundScores) {
  return roundScores.reduce((a, b) => a + b, 0);
}

// ---------------------------------------------------------------------------
// Replay harness

/**
 * Replay a puzzle's stored solution. Returns { ok, board, turns, reason }.
 * ok is true when the solution is draw-free, every action is legal, both goals hold
 * at the end (and not before the final action), and its length equals par.
 */
export function replaySolution(puzzle) {
  const solution = puzzle.solution.map((a) => (typeof a === 'string' ? decodeAction(a) : a));
  let state = createState(puzzle.board, puzzle.bag, puzzle.seed);
  if (puzzle.goals.some((g) => evalGoal(state.board, g))) return { ok: false, board: state.board, turns: 0, reason: 'a goal already holds at deal' };
  for (let k = 0; k < solution.length; k++) {
    const a = solution[k];
    if (a.type === 'draw') return { ok: false, board: state.board, turns: k, reason: 'solution uses Draw' };
    try {
      state = applyAction(state, a);
    } catch (e) {
      return { ok: false, board: state.board, turns: k, reason: `illegal action: ${e.message}` };
    }
    if (k < solution.length - 1 && allGoalsHold(state.board, puzzle.goals)) {
      return { ok: false, board: state.board, turns: k + 1, reason: `solved early at move ${k + 1}` };
    }
  }
  if (!allGoalsHold(state.board, puzzle.goals)) return { ok: false, board: state.board, turns: state.turns, reason: 'goals do not hold after solution' };
  if (state.turns !== puzzle.par) return { ok: false, board: state.board, turns: state.turns, reason: `length ${state.turns} != par ${puzzle.par}` };
  return { ok: true, board: state.board, turns: state.turns, reason: '' };
}

/** Print a board as five lines of digits. */
export function boardToString(board) {
  const rows = [];
  for (let r = 0; r < SIZE; r++) rows.push(board.slice(r * SIZE, r * SIZE + SIZE).join(' '));
  return rows.join('\n');
}

/** Bag as "1x2 2x1 ..." text. */
export function bagToString(bag) {
  return bag.map((n, i) => `${i + 1}x${n}`).join(' ');
}
