// Goal pairing for the generator: the weighted (region, condition) table, sampling,
// structural pairing rules and the joint-satisfiability check.

import { regionLines, regionSize, LINE_REGION_TYPES, ANY_REGION_TYPES, MAX_VALUE, MIN_VALUE } from '../js/engine.js';

export const LINE_CONDITIONS = ['allEqual', 'equalTo', 'allDifferent', 'ascending', 'sum', 'allEven', 'allOdd', 'fullHouse', 'palindrome'];
export const SMALL_CONDITIONS = ['allEqual', 'equalTo', 'allDifferent', 'sum', 'allEven', 'allOdd']; // 4-cell regions
export const FIVE_CONDITIONS = ['allEqual', 'equalTo', 'allDifferent', 'sum', 'allEven', 'allOdd', 'fullHouse']; // plus, X
export const CENTER3_CONDITIONS = ['allEven', 'allOdd', 'sum', 'noValue'];

export const REGION_CONDITIONS = {
  row: LINE_CONDITIONS,
  col: LINE_CONDITIONS,
  diag: LINE_CONDITIONS,
  anti: LINE_CONDITIONS,
  anyRow: LINE_CONDITIONS,
  anyCol: LINE_CONDITIONS,
  anyLine: LINE_CONDITIONS,
  corners: SMALL_CONDITIONS,
  block: SMALL_CONDITIONS,
  plus: FIVE_CONDITIONS,
  x: FIVE_CONDITIONS,
  center3: CENTER3_CONDITIONS,
};

export const DEFAULT_SUM_RANGES = { 4: [8, 20], 5: [10, 25], 9: [20, 40] };

/** Uniform weights for every allowed (region type, condition type) combination. */
export function defaultWeights() {
  const w = {};
  for (const [region, conds] of Object.entries(REGION_CONDITIONS)) for (const c of conds) w[`${region}:${c}`] = 1;
  return w;
}

export function comboKey(goal) {
  return `${goal.region.type}:${goal.condition.type}`;
}

/** Order-independent key for a goal pair, e.g. "col:sum+row:allEqual". */
export function pairKey(goals) {
  return goals.map(comboKey).sort().join('+');
}

/** Sample an integer in [lo, hi] favouring the middle (mean of two uniforms). */
function middleInt(rng, lo, hi) {
  const a = lo + rng() * (hi - lo + 1);
  const b = lo + rng() * (hi - lo + 1);
  return Math.min(hi, Math.max(lo, Math.floor((a + b) / 2)));
}

/** Draw one goal from the weighted table. */
export function sampleGoal(rng, weights, sumRanges = DEFAULT_SUM_RANGES) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  let key = entries[entries.length - 1][0];
  for (const [k, w] of entries) {
    r -= w;
    if (r < 0) {
      key = k;
      break;
    }
  }
  const [regionType, condType] = key.split(':');
  const region = { type: regionType };
  if (regionType === 'row' || regionType === 'col') region.index = Math.floor(rng() * 5);
  if (regionType === 'block') region.index = Math.floor(rng() * 4);
  const condition = { type: condType };
  if (condType === 'equalTo' || condType === 'noValue') condition.value = MIN_VALUE + Math.floor(rng() * MAX_VALUE);
  if (condType === 'sum') {
    const [lo, hi] = sumRanges[regionSize(region)];
    condition.value = middleInt(rng, lo, hi);
  }
  return { region, condition };
}

function sameRegion(a, b) {
  return a.type === b.type && (a.index ?? 0) === (b.index ?? 0);
}

/** Structural rules: overlap, at most one any-line, at most one center3, no identical regions. */
export function pairStructurallyValid(a, b, opts = {}) {
  const allowSameRegion = opts.allowSameRegion ?? false;
  if (!allowSameRegion && sameRegion(a.region, b.region)) return false;
  if (JSON.stringify(a) === JSON.stringify(b)) return false;
  if (ANY_REGION_TYPES.has(a.region.type) && ANY_REGION_TYPES.has(b.region.type)) return false;
  if (a.region.type === 'center3' && b.region.type === 'center3') return false;
  const sa = new Set(regionLines(a.region).flat());
  if (!regionLines(b.region).flat().some((i) => sa.has(i))) return false;
  return true;
}

/** Can `cond` still hold on `cells` when some of them are fixed? fixed: Map cellIndex -> value. */
export function completable(cells, cond, fixed) {
  const n = cells.length;
  const vals = cells.map((i) => (fixed.has(i) ? fixed.get(i) : 0)); // 0 = free
  const fixedVals = vals.filter((v) => v > 0);
  const free = n - fixedVals.length;
  switch (cond.type) {
    case 'allEqual':
      return fixedVals.every((v) => v === fixedVals[0]);
    case 'equalTo':
      return fixedVals.every((v) => v === cond.value);
    case 'allDifferent':
      return new Set(fixedVals).size === fixedVals.length && n <= MAX_VALUE;
    case 'ascending':
      for (let s = MIN_VALUE; s + n - 1 <= MAX_VALUE; s++) {
        if (vals.every((v, k) => v === 0 || v === s + k)) return true;
      }
      return false;
    case 'sum': {
      const f = fixedVals.reduce((a, b) => a + b, 0);
      const need = cond.value - f;
      return need >= free * MIN_VALUE && need <= free * MAX_VALUE;
    }
    case 'allEven':
      return fixedVals.every((v) => v % 2 === 0);
    case 'allOdd':
      return fixedVals.every((v) => v % 2 === 1);
    case 'fullHouse': {
      if (n !== 5) return false;
      const counts = new Map();
      for (const v of fixedVals) counts.set(v, (counts.get(v) || 0) + 1);
      const cs = [...counts.values()].sort((a, b) => b - a);
      if (cs.length > 2) return false;
      if (cs.length === 2) return cs[0] <= 3 && cs[1] <= 2;
      if (cs.length === 1) return cs[0] <= 3;
      return true;
    }
    case 'palindrome':
      for (let k = 0; k < n >> 1; k++) {
        const a = vals[k];
        const b = vals[n - 1 - k];
        if (a && b && a !== b) return false;
      }
      return true;
    case 'noValue':
      return fixedVals.every((v) => v !== cond.value);
    default:
      throw new Error(`Unknown condition ${cond.type}`);
  }
}

const satMemo = new Map();

/** Joint satisfiability of two concrete (cells, condition) goals on their union. */
export function concreteSatisfiable(cellsA, condA, cellsB, condB) {
  const key = `${cellsA.join(',')}|${JSON.stringify(condA)}|${cellsB.join(',')}|${JSON.stringify(condB)}`;
  if (satMemo.has(key)) return satMemo.get(key);
  const setA = new Set(cellsA);
  const shared = cellsB.filter((i) => setA.has(i));
  let result = false;
  if (shared.length === 0) {
    result = completable(cellsA, condA, new Map()) && completable(cellsB, condB, new Map());
  } else {
    const fixed = new Map();
    const k = shared.length;
    const total = Math.pow(MAX_VALUE, k);
    for (let code = 0; code < total && !result; code++) {
      let c = code;
      for (let j = 0; j < k; j++) {
        fixed.set(shared[j], MIN_VALUE + (c % MAX_VALUE));
        c = Math.floor(c / MAX_VALUE);
      }
      if (completable(cellsA, condA, fixed) && completable(cellsB, condB, fixed)) result = true;
    }
  }
  satMemo.set(key, result);
  return result;
}

/** Joint satisfiability of a goal pair (any-* regions try each candidate line). */
export function pairSatisfiable(a, b) {
  for (const cellsA of regionLines(a.region)) {
    for (const cellsB of regionLines(b.region)) {
      if (concreteSatisfiable(cellsA, a.condition, cellsB, b.condition)) return true;
    }
  }
  return false;
}

/**
 * Draw a structurally valid, jointly satisfiable goal pair. Returns { goals, attempts } or null
 * after maxTries. Does not check the board (the generator rejects pairs that already hold).
 */
export function samplePair(rng, weights, opts = {}) {
  const maxTries = opts.maxTries ?? 200;
  const sumRanges = opts.sumRanges ?? DEFAULT_SUM_RANGES;
  for (let t = 1; t <= maxTries; t++) {
    const a = sampleGoal(rng, weights, sumRanges);
    const b = sampleGoal(rng, weights, sumRanges);
    if (!pairStructurallyValid(a, b, opts)) continue;
    if (!pairSatisfiable(a, b)) continue;
    return { goals: [a, b], attempts: t };
  }
  return null;
}

export function isLineRegion(region) {
  return LINE_REGION_TYPES.has(region.type);
}
