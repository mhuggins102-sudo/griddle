// Offline solver: beam search (primary) and IDA* (calibration) over the 110 draw-free actions.
// Works on Uint8Array boards for speed. Node only; the browser never solves.

import { allActions, encodeAction, regionLines, conditionCost, rowOf, colOf, SIZE, CELLS, MAX_VALUE } from '../js/engine.js';
import { mulberry32 } from '../js/rng.js';

export const ACTIONS = allActions();
export const ACTION_CODES = ACTIONS.map(encodeAction);
const N_ACTIONS = ACTIONS.length;

/** Inverse index: INVERSE[a] is the action undoing a. */
export const INVERSE = new Int16Array(N_ACTIONS);
{
  const byCode = new Map(ACTION_CODES.map((c, i) => [c, i]));
  ACTIONS.forEach((a, i) => {
    let inv;
    if (a.type === 'slide') inv = { ...a, dir: -a.dir };
    else if (a.type === 'nudge') inv = { ...a, delta: -a.delta };
    else inv = a;
    INVERSE[i] = byCode.get(encodeAction(inv));
  });
}

// Precompiled action tables for in-place apply/undo.
// kind: 0 slide, 1 swap, 2 nudge
const A_KIND = new Int8Array(N_ACTIONS);
const A_CELLS = []; // slide: 5 cells in line order; swap: [a, b]; nudge: [cell]
const A_DIR = new Int8Array(N_ACTIONS);
ACTIONS.forEach((a, i) => {
  if (a.type === 'slide') {
    A_KIND[i] = 0;
    const cells = [];
    for (let k = 0; k < SIZE; k++) cells.push(a.axis === 'row' ? a.index * SIZE + k : k * SIZE + a.index);
    A_CELLS.push(Int8Array.from(cells));
    A_DIR[i] = a.dir;
  } else if (a.type === 'swap') {
    A_KIND[i] = 1;
    A_CELLS.push(Int8Array.from([a.r * SIZE + a.c, a.r2 * SIZE + a.c2]));
  } else {
    A_KIND[i] = 2;
    A_CELLS.push(Int8Array.from([a.r * SIZE + a.c]));
    A_DIR[i] = a.delta;
  }
});

/** Apply action i to board b in place. */
export function applyFast(b, i) {
  const cells = A_CELLS[i];
  switch (A_KIND[i]) {
    case 0: {
      if (A_DIR[i] === 1) {
        const last = b[cells[4]];
        b[cells[4]] = b[cells[3]];
        b[cells[3]] = b[cells[2]];
        b[cells[2]] = b[cells[1]];
        b[cells[1]] = b[cells[0]];
        b[cells[0]] = last;
      } else {
        const first = b[cells[0]];
        b[cells[0]] = b[cells[1]];
        b[cells[1]] = b[cells[2]];
        b[cells[2]] = b[cells[3]];
        b[cells[3]] = b[cells[4]];
        b[cells[4]] = first;
      }
      return;
    }
    case 1: {
      const t = b[cells[0]];
      b[cells[0]] = b[cells[1]];
      b[cells[1]] = t;
      return;
    }
    default: {
      const c = cells[0];
      let v = b[c] + A_DIR[i];
      if (v > MAX_VALUE) v = 1;
      else if (v < 1) v = MAX_VALUE;
      b[c] = v;
    }
  }
}

export function undoFast(b, i) {
  applyFast(b, INVERSE[i]);
}

// ---------------------------------------------------------------------------
// Zobrist hashing (two 32-bit tables combined into one 53-bit-safe number)

const ZOB1 = new Uint32Array(CELLS * (MAX_VALUE + 1));
const ZOB2 = new Uint32Array(CELLS * (MAX_VALUE + 1));
{
  const r = mulberry32(0x5eed1234);
  for (let i = 0; i < ZOB1.length; i++) {
    ZOB1[i] = (r() * 4294967296) >>> 0;
    ZOB2[i] = (r() * 4294967296) >>> 0;
  }
}

export function hashBoard(b) {
  let h1 = 0;
  let h2 = 0;
  for (let i = 0; i < CELLS; i++) {
    const k = i * 7 + b[i];
    h1 ^= ZOB1[k];
    h2 ^= ZOB2[k];
  }
  return (h1 >>> 0) * 2097152 + (h2 >>> 11);
}

// ---------------------------------------------------------------------------
// Goal cost compilation

function lineIsSlidable(cells) {
  const r0 = rowOf(cells[0]);
  const c0 = colOf(cells[0]);
  let row = true;
  let col = true;
  for (const i of cells) {
    if (rowOf(i) !== r0) row = false;
    if (colOf(i) !== c0) col = false;
  }
  return row || col;
}

/**
 * Compile a goal into a fast cost function over Uint8Array boards.
 * With admissible=true the result is a lower bound on the number of actions needed
 * (the Center X region needs a halving because one Slide can replace two of its cells).
 */
export function compileGoalCost(goal, admissible = false) {
  const lines = regionLines(goal.region).map((cells) => ({ cells: Int8Array.from(cells), slidable: lineIsSlidable(cells) }));
  const cond = goal.condition;
  const n = lines[0].cells.length;
  const divisor = admissible && goal.region.type === 'x' ? 2 : 1;
  const counts = new Int32Array(MAX_VALUE + 1);
  const votes = new Int32Array(Math.max(1, (MAX_VALUE - n + 1) * n));

  const lineCost = (b, line) => {
    const cells = line.cells;
    switch (cond.type) {
      case 'allEqual': {
        counts.fill(0);
        for (let k = 0; k < n; k++) counts[b[cells[k]]]++;
        let best = 0;
        for (let v = 1; v <= MAX_VALUE; v++) if (counts[v] > best) best = counts[v];
        return n - best;
      }
      case 'equalTo': {
        let c = 0;
        for (let k = 0; k < n; k++) if (b[cells[k]] !== cond.value) c++;
        return c;
      }
      case 'allDifferent': {
        counts.fill(0);
        let distinct = 0;
        for (let k = 0; k < n; k++) if (counts[b[cells[k]]]++ === 0) distinct++;
        return n - distinct;
      }
      case 'sum': {
        let s = 0;
        for (let k = 0; k < n; k++) s += b[cells[k]];
        const d = s > cond.value ? s - cond.value : cond.value - s;
        return Math.ceil(d / (MAX_VALUE - 1));
      }
      case 'allEven': {
        let c = 0;
        for (let k = 0; k < n; k++) if (b[cells[k]] & 1) c++;
        return c;
      }
      case 'allOdd': {
        let c = 0;
        for (let k = 0; k < n; k++) if (!(b[cells[k]] & 1)) c++;
        return c;
      }
      case 'noValue': {
        let c = 0;
        for (let k = 0; k < n; k++) if (b[cells[k]] === cond.value) c++;
        return c;
      }
      case 'fullHouse': {
        counts.fill(0);
        for (let k = 0; k < n; k++) counts[b[cells[k]]]++;
        // the largest count serves as the triple, the second largest as the pair
        let t1 = 0;
        let t2 = 0;
        for (let v = 1; v <= MAX_VALUE; v++) {
          const c = counts[v];
          if (c > t1) {
            t2 = t1;
            t1 = c;
          } else if (c > t2) t2 = c;
        }
        return n - ((t1 < 3 ? t1 : 3) + (t2 < 2 ? t2 : 2));
      }
      case 'ascending': {
        // Each cell votes for the (rotation, start) alignments it already satisfies;
        // the cost is n minus the best-supported alignment. Rotations only count on rows/cols.
        votes.fill(0);
        const rotations = line.slidable ? n : 1;
        for (let k = 0; k < n; k++) {
          const v = b[cells[k]];
          for (let s = 1; s + n - 1 <= MAX_VALUE; s++) {
            const pos = v - s;
            if (pos < 0 || pos >= n) continue;
            let rot = k - pos;
            if (rot < 0) rot += n;
            if (rot < rotations) votes[(s - 1) * n + rot]++;
          }
        }
        let best = 0;
        for (let i = 0; i < votes.length; i++) if (votes[i] > best) best = votes[i];
        return n - best;
      }
      case 'palindrome': {
        const rotations = line.slidable ? n : 1;
        const half = n >> 1;
        let best = n;
        for (let rot = 0; rot < rotations; rot++) {
          let miss = 0;
          for (let k = 0; k < half && miss < best; k++) {
            let p = k + rot;
            if (p >= n) p -= n;
            let q = n - 1 - k + rot;
            if (q >= n) q -= n;
            if (b[cells[p]] !== b[cells[q]]) miss++;
          }
          if (miss < best) best = miss;
        }
        return best;
      }
      default:
        throw new Error(`Unknown condition ${cond.type}`);
    }
  };

  if (lines.length === 1) {
    const line = lines[0];
    return divisor === 1 ? (b) => lineCost(b, line) : (b) => Math.ceil(lineCost(b, line) / divisor);
  }
  return (b) => {
    let best = Infinity;
    for (const line of lines) {
      const c = lineCost(b, line);
      if (c < best) {
        best = c;
        if (best === 0) break;
      }
    }
    return best;
  };
}

/** Exact goal check on a typed-array board (cost 0 and, for order goals, actually holding). */
export function compileGoalHolds(goal) {
  const cost = compileGoalCost(goal, false);
  const cond = goal.condition;
  if (cond.type !== 'ascending' && cond.type !== 'palindrome') return (b) => cost(b) === 0;
  // rotation-aligned cost can be 0 without the goal holding: check the real condition
  const lines = regionLines(goal.region).map((cells) => Int8Array.from(cells));
  const n = lines[0].length;
  const tmp = new Uint8Array(n);
  return (b) => {
    for (const cells of lines) {
      for (let k = 0; k < n; k++) tmp[k] = b[cells[k]];
      if (conditionCost(tmp, cond, false) === 0) return true;
    }
    return false;
  };
}

// ---------------------------------------------------------------------------
// Beam search

/**
 * Beam search for a short draw-free solution.
 * opts: { width, restarts, maxDepth, seed, timeBudgetMs }
 * Returns { par, solution (codes), confidence, restarts: [len|null], nodes, ms } or par=null when nothing within maxDepth.
 */
export function beamSolve(boardIn, goals, opts = {}) {
  const W = opts.width ?? 2000;
  const R = opts.restarts ?? 8;
  const maxDepth = opts.maxDepth ?? 12;
  const parMax = opts.parMax ?? 10;
  const parMin = opts.parMin ?? 6;
  const t0 = Date.now();
  const root = Uint8Array.from(boardIn);
  const costA = compileGoalCost(goals[0]);
  const costB = compileGoalCost(goals[1]);
  const holdsA = compileGoalHolds(goals[0]);
  const holdsB = compileGoalHolds(goals[1]);
  const rng = mulberry32(opts.seed ?? 1);

  if (holdsA(root) && holdsB(root)) return { par: 0, solution: [], confidence: 1, restarts: [0], nodes: 0, ms: 0 };

  const maxCand = W * N_ACTIONS;
  const candParent = new Int32Array(maxCand);
  const candAct = new Int16Array(maxCand);
  const candKey = new Int32Array(maxCand);
  const candHash = new Float64Array(maxCand);
  const layerBoards = [];
  const layerParent = [];
  const layerAct = [];
  for (let d = 0; d <= maxDepth; d++) {
    layerBoards.push(new Uint8Array(W * CELLS));
    layerParent.push(new Int32Array(W));
    layerAct.push(new Int16Array(W));
  }
  const KEYS = 64 * 64;
  const bucketCount = new Int32Array(KEYS + 1);
  const order = new Int32Array(maxCand);
  const scratch = new Uint8Array(CELLS);
  let nodes = 0;

  const reconstruct = (depth, index) => {
    const path = [];
    let d = depth;
    let i = index;
    while (d > 0) {
      path.push(layerAct[d][i]);
      i = layerParent[d][i];
      d--;
    }
    path.reverse();
    return path.map((a) => ACTION_CODES[a]);
  };

  const runOnce = (depthCap) => {
    const visited = new Set();
    layerBoards[0].set(root, 0);
    layerAct[0][0] = -1;
    let count = 1;
    visited.add(hashBoard(root));
    for (let d = 0; d < depthCap; d++) {
      let nCand = 0;
      const boards = layerBoards[d];
      const lastActs = layerAct[d];
      for (let s = 0; s < count; s++) {
        scratch.set(boards.subarray(s * CELLS, s * CELLS + CELLS));
        const forbid = lastActs[s] >= 0 ? INVERSE[lastActs[s]] : -1;
        for (let a = 0; a < N_ACTIONS; a++) {
          if (a === forbid) continue;
          applyFast(scratch, a);
          nodes++;
          const ca = costA(scratch);
          const cb = costB(scratch);
          if (ca === 0 && cb === 0 && holdsA(scratch) && holdsB(scratch)) {
            // found at depth d+1
            const path = reconstruct(d, s);
            path.push(ACTION_CODES[a]);
            return path;
          }
          const h = ca > cb ? ca : cb;
          candParent[nCand] = s;
          candAct[nCand] = a;
          candKey[nCand] = h * 64 + ca + cb;
          candHash[nCand] = hashBoard(scratch);
          nCand++;
          undoFast(scratch, a);
        }
      }
      // Select the W best by key with random tie-breaking, skipping visited boards.
      bucketCount.fill(0);
      for (let i = 0; i < nCand; i++) bucketCount[candKey[i] + 1]++;
      for (let k = 1; k <= KEYS; k++) bucketCount[k] += bucketCount[k - 1];
      for (let i = 0; i < nCand; i++) order[bucketCount[candKey[i]]++] = i;
      // bucketCount[k] is now the end of bucket k; recompute starts
      let selected = 0;
      let start = 0;
      const next = layerBoards[d + 1];
      for (let k = 0; k < KEYS && selected < W; k++) {
        const end = bucketCount[k];
        if (end === start) continue;
        // partial Fisher-Yates over [start, end)
        for (let p = start; p < end && selected < W; p++) {
          const j = p + Math.floor(rng() * (end - p));
          const t = order[p];
          order[p] = order[j];
          order[j] = t;
          const ci = order[p];
          const hsh = candHash[ci];
          if (visited.has(hsh)) continue;
          visited.add(hsh);
          const parent = candParent[ci];
          const act = candAct[ci];
          const dst = selected * CELLS;
          next.set(boards.subarray(parent * CELLS, parent * CELLS + CELLS), dst);
          const view = next.subarray(dst, dst + CELLS);
          applyFast(view, act);
          layerParent[d + 1][selected] = parent;
          layerAct[d + 1][selected] = act;
          selected++;
        }
        start = end;
      }
      count = selected;
      if (count === 0) return null;
    }
    return null;
  };

  const results = [];
  let best = null;
  let bestPath = null;
  for (let r = 0; r < R; r++) {
    // Restarts only need to reach the current best (to confirm it) or beat it; when the
    // best is above parMax only a solution of parMax or shorter can rescue the puzzle.
    let cap = maxDepth;
    if (best !== null) cap = best > parMax ? parMax : best;
    const path = runOnce(cap);
    results.push(path ? path.length : null);
    if (path && (best === null || path.length < best)) {
      best = path.length;
      bestPath = path;
    }
    if (r === 0) {
      if (best === null) break; // nothing within maxDepth: reject early
      if (best < parMin) break; // already too easy: no restart can make it harder
    }
    if (opts.timeBudgetMs && Date.now() - t0 > opts.timeBudgetMs) break;
  }
  const reached = results.filter((l) => l === best).length;
  return {
    par: best,
    solution: bestPath,
    confidence: best === null ? 0 : reached / results.length,
    restarts: results,
    nodes,
    ms: Date.now() - t0,
  };
}

// ---------------------------------------------------------------------------
// IDA* with an admissible heuristic (calibration only)

/**
 * Returns { length, nodes, complete } where length is the optimal draw-free length (<= maxDepth)
 * or null if none within maxDepth; complete=false when the node budget was exhausted.
 */
export function idaSolve(boardIn, goals, opts = {}) {
  const maxDepth = opts.maxDepth ?? 8;
  const budget = opts.nodeBudget ?? 50_000_000;
  const t0 = Date.now();
  const b = Uint8Array.from(boardIn);
  const costA = compileGoalCost(goals[0], true);
  const costB = compileGoalCost(goals[1], true);
  const holdsA = compileGoalHolds(goals[0]);
  const holdsB = compileGoalHolds(goals[1]);
  const h = () => {
    const a = costA(b);
    const c = costB(b);
    return a > c ? a : c;
  };
  let nodes = 0;
  let exhausted = false;
  const path = [];
  let table = new Map();

  // Returns the minimum f that exceeded the threshold, or -1 when solved.
  const dfs = (g, threshold, lastAct) => {
    const hv = h();
    const f = g + hv;
    if (f > threshold) return f;
    if (hv === 0 && holdsA(b) && holdsB(b)) return -1;
    if (g >= maxDepth) return Infinity;
    nodes++;
    if (nodes > budget) {
      exhausted = true;
      return Infinity;
    }
    const key = hashBoard(b);
    const seen = table.get(key);
    if (seen !== undefined && seen <= g) return Infinity;
    table.set(key, g);
    let min = Infinity;
    const forbid = lastAct >= 0 ? INVERSE[lastAct] : -1;
    for (let a = 0; a < N_ACTIONS; a++) {
      if (a === forbid) continue;
      applyFast(b, a);
      path.push(a);
      const t = dfs(g + 1, threshold, a);
      if (t === -1) return -1;
      path.pop();
      undoFast(b, a);
      if (t < min) min = t;
      if (exhausted) return Infinity;
    }
    return min;
  };

  let threshold = h();
  while (threshold <= maxDepth) {
    table = new Map();
    const t = dfs(0, threshold, -1);
    if (t === -1) return { length: path.length, solution: path.map((a) => ACTION_CODES[a]), nodes, complete: true, ms: Date.now() - t0 };
    if (exhausted) return { length: null, nodes, complete: false, ms: Date.now() - t0 };
    if (t === Infinity) break;
    threshold = t;
  }
  return { length: null, nodes, complete: true, ms: Date.now() - t0 };
}
