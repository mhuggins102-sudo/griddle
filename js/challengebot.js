// The challenge bot: plays a challenge board under its rules, to measure what scores it yields and set the
// trophy targets (tools/calibrate-challenges.js). Like the goal-setting bot in wordbot.js it locks the most
// valuable word it can and otherwise makes the move that sets up the best word, but it also draws (judging a
// draw by the average over a few letters the bag could give), picks from three when Choice Draw is on, turns
// blocks when that is the only move, and keeps to the moves a challenge allows. Pure, runs in Node.

import { gridOfState } from './grid.js';
import { applyWordAction, findWords, lockWord, finalScore, isLocked, isBoardFull, turnLimit, isCommonWord, bagTotal, LETTERS, moveRefusal } from './words.js';
import { applyPerkAction, rotateBlocks, peekDraws } from './perks.js';
import { mulberry32 } from './rng.js';

const FRESH_TILE_VALUE = 4; // what a newly locked tile is worth to the bot (it steers toward the full-board bonuses)
const SETUP_MARGIN = 6; // a move is made before a lock only when it sets up a word this much better
const DRAW_SAMPLES = 4; // letters sampled from the bag to judge a draw
const MAX_FREE_MOVES = 8; // under the free-moves rule: moves between locks before the bot stops shuffling
const TWO_PLY_FIRST = 60; // first moves tried in the two-ply search
const NOISE = 0.25; // how often the bot takes one of the three best options instead of the best: the spread of decent play, not one fixed line
const NOISE_TOP = 3;

function lockValue(state, cand) {
  const fresh = cand.cells.filter((c) => !state.locked.includes(c)).length;
  return cand.score + fresh * FRESH_TILE_VALUE;
}

/** The lockable everyday words, best first, each with its value. */
function lockables(state, dict) {
  const out = [];
  for (const cand of findWords(state, dict)) {
    if (!cand.lockable || !isCommonWord(dict, cand.word)) continue;
    out.push({ cand, value: lockValue(state, cand) });
  }
  return out.sort((a, b) => b.value - a.value);
}

/** The most valuable lockable everyday word, and its value. */
export function bestLockable(state, dict) {
  const l = lockables(state, dict);
  return l.length ? l[0] : { cand: null, value: -1 };
}

/** The best of a list sorted best first, or now and then one of the few best (the bot's noise). */
function pickNoisy(sorted, rng, noise) {
  if (!sorted.length) return null;
  if (noise > 0 && sorted.length > 1 && rng() < noise) return sorted[Math.floor(rng() * Math.min(NOISE_TOP, sorted.length))];
  return sorted[0];
}

function legal(state, g, move) {
  if (moveRefusal(state, move.type)) return false;
  if (move.type === 'slide') return g.lineCells(move.axis, move.index).filter((c) => !isLocked(state, c)).length >= 2;
  if (move.type === 'swap') return !isLocked(state, g.idx(move.r, move.c)) && !isLocked(state, g.idx(move.r2, move.c2));
  return true;
}

/** The deterministic moves open now: the engine's slides, swaps and nudges the rules allow, and block turns under the rotor rule. */
function openMoves(state, g) {
  const out = [];
  for (const m of g.moves) if (legal(state, g, m)) out.push({ kind: 'action', move: m, apply: (s) => applyWordAction(s, m) });
  if (state.rules && state.rules.rotor) {
    for (const cell of rotateBlocks(state)) for (const turns of [1, 2, 3]) out.push({ kind: 'rotate', move: { type: 'rotate', cell, turns }, apply: (s) => applyPerkAction(s, { type: 'rotate', cell, turns }) });
  }
  return out;
}

/** One letter the bag could give, weighted by what it holds. */
function sampleLetter(bag, rng) {
  const total = bagTotal(bag);
  let pick = Math.floor(rng() * total);
  for (const ch of LETTERS) {
    if (pick < bag[ch]) return ch;
    pick -= bag[ch];
  }
  return null;
}

/**
 * The draws open now, each valued by what it is likely to set up: with Choice Draw the three letters are known
 * and the best of them counts; otherwise the average over a few letters sampled from the bag.
 */
function openDraws(state, g, dict, rng) {
  if (moveRefusal(state, 'draw') || bagTotal(state.bag) === 0 || state.turns + 1 > turnLimit(state)) return [];
  const out = [];
  const choice = !!(state.rules && state.rules.choiceDraws);
  const options = choice ? peekDraws(state, 3) : null;
  for (let cell = 0; cell < state.board.length; cell++) {
    if (isLocked(state, cell)) continue; // drawing over a locked tile is allowed, but rarely what a player wants
    if (choice) {
      let bestPick = 0;
      let bestValue = -1;
      options.forEach((letter, k) => {
        const after = { ...state, board: state.board.slice(), turns: state.turns + 1 };
        after.board[cell] = letter;
        const v = bestLockable(after, dict).value;
        if (v > bestValue) {
          bestValue = v;
          bestPick = k;
        }
      });
      out.push({ kind: 'draw3', value: bestValue, move: { type: 'draw3', cell, pick: bestPick }, apply: (s) => applyPerkAction(s, { type: 'draw3', cell, pick: bestPick }) });
    } else {
      let sum = 0;
      for (let k = 0; k < DRAW_SAMPLES; k++) {
        const after = { ...state, board: state.board.slice(), turns: state.turns + 1 };
        after.board[cell] = sampleLetter(state.bag, rng);
        sum += Math.max(0, bestLockable(after, dict).value);
      }
      const r = g.rowOf(cell);
      const c = g.colOf(cell);
      out.push({ kind: 'draw', value: sum / DRAW_SAMPLES, move: { type: 'draw', r, c }, apply: (s) => applyWordAction(s, { type: 'draw', r, c }) });
    }
  }
  return out;
}

/** Every step open now (moves and draws) valued by the best word it makes available, best first. */
function valuedSteps(state, g, dict, rng) {
  const out = [];
  for (const step of openMoves(state, g)) out.push({ step, value: bestLockable(step.apply(state), dict).value });
  for (const step of openDraws(state, g, dict, rng)) out.push({ step, value: step.value });
  return out.sort((a, b) => b.value - a.value);
}

/** The best single step (a move or a draw), or with noise one of the few best. */
function bestStep(state, g, dict, rng, noise = 0) {
  const chosen = pickNoisy(valuedSteps(state, g, dict, rng), rng, noise);
  return chosen || { step: null, value: -1 };
}

/** Two plies over the deterministic moves: the first move of the best two-move sequence. */
function bestStep2(state, g, dict, rng) {
  let best = null;
  let bestValue = -1;
  const moves = openMoves(state, g).slice(0, TWO_PLY_FIRST);
  for (const step of moves) {
    const r = bestStep(step.apply(state), g, dict, rng);
    if (r.value > bestValue) {
      bestValue = r.value;
      best = step;
    }
  }
  return { step: best, value: bestValue };
}

/**
 * Play one challenge from its starting state (a draw seed already in it). rngSeed drives the bot's own
 * sampling. Returns { score, banked, words, locked, turnsUsed, log }.
 */
export function botPlayChallenge(start, dict, rngSeed = 1, opts = {}) {
  const rng = mulberry32(rngSeed);
  const noise = opts.noise === undefined ? NOISE : opts.noise;
  let state = start;
  const g = gridOfState(state);
  const free = !!(state.rules && state.rules.freeMoves);
  const log = [];
  let idle = 0; // steps since the last lock (the free-moves rule needs a stop)
  let guard = 0;
  while (state.turns < turnLimit(state) && guard++ < 400) {
    if (isBoardFull(state)) break;
    const turnsLeft = turnLimit(state) - state.turns;
    const { cand, value } = pickNoisy(lockables(state, dict), rng, noise) || { cand: null, value: -1 };
    if (cand) {
      let setup = null;
      if (turnsLeft >= 2 || (free && idle < MAX_FREE_MOVES)) {
        const r = bestStep(state, g, dict, rng, noise);
        if (r.step && r.step.kind !== 'draw' && r.value > value + SETUP_MARGIN && (!free || idle < MAX_FREE_MOVES)) setup = r.step;
      }
      if (!setup) {
        state = lockWord(state, cand);
        log.push(`lock ${cand.word} ${cand.score}`);
        idle = 0;
        continue;
      }
      state = setup.apply(state);
      log.push(`${setup.kind} ${JSON.stringify(setup.move)}`);
      idle++;
      continue;
    }
    if (free && idle >= MAX_FREE_MOVES) break; // shuffled plenty and still nothing to lock
    if (!free && turnsLeft < 2) break; // one turn left and nothing to lock: a move cannot score
    let r = bestStep(state, g, dict, rng, noise);
    if ((!r.step || r.value <= 0) && !free && turnsLeft >= 3) {
      const r2 = bestStep2(state, g, dict, rng);
      if (r2.step && r2.value > r.value) r = r2;
    }
    if (!r.step) break;
    state = r.step.apply(state);
    log.push(`${r.step.kind} ${JSON.stringify(r.step.move)}`);
    idle++;
  }
  return { score: finalScore(state), banked: state.score, words: state.words.map((w) => ({ word: w.word, score: w.score })), locked: state.locked.length, turnsUsed: state.turns, log };
}
