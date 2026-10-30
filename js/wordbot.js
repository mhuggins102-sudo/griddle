// Word-mode bot: plays a board draw-free to set a goal score. Pure functions, runs in Node,
// in a Web Worker, or on the main thread. Works on any board size the engine supports.

import { gridOfState } from './grid.js';
import {
  dealLetters, createWordState, applyWordAction, findWords, lockWord, finalScore, isLocked, isBoardFull, turnLimit,
} from './words.js';

/** Goal for a level as a share of the bot's banked word points (its fill bonuses excluded): 35% at level 1, +5% per level, 100% from level 14. */
export const GOAL_START_PERCENT = 35;
export const GOAL_STEP_PERCENT = 5;
export function goalPercent(level) {
  return Math.min(100, GOAL_START_PERCENT + GOAL_STEP_PERCENT * (level - 1));
}

/** The level goal: the percentage of the bot's banked points, rounded up to the nearest 10, at least 10. */
export function goalFor(level, botScore) {
  return Math.max(10, Math.ceil((botScore * goalPercent(level)) / 100 / 10) * 10);
}

function legal(state, g, move) {
  if (move.type === 'slide') return g.lineCells(move.axis, move.index).filter((c) => !isLocked(state, c)).length >= 2;
  if (move.type === 'swap') return !isLocked(state, g.idx(move.r, move.c)) && !isLocked(state, g.idx(move.r2, move.c2));
  return true; // nudge, including a locked tile (its letter changes)
}

/** How much the bot values each newly locked tile (it steers toward the full-board bonuses). */
const FRESH_TILE_VALUE = 4;

/** Value of locking a candidate now: its points plus credit for each newly locked tile. */
function lockValue(state, cand) {
  const fresh = cand.cells.filter((c) => !state.locked.includes(c)).length;
  return cand.score + fresh * FRESH_TILE_VALUE;
}

function bestLockable(state, dict) {
  let best = null;
  let bestValue = -1;
  for (const cand of findWords(state, dict)) {
    if (!cand.lockable) continue;
    const v = lockValue(state, cand);
    if (v > bestValue) {
      bestValue = v;
      best = cand;
    }
  }
  return { cand: best, value: bestValue };
}

/** The best move by the value of the best word it makes available (one ply). */
function bestMove(state, dict, g) {
  let best = null;
  let bestValue = -1;
  for (const move of g.moves) {
    if (!legal(state, g, move)) continue;
    const next = applyWordAction(state, move);
    const { value } = bestLockable(next, dict);
    if (value > bestValue) {
      bestValue = value;
      best = move;
    }
  }
  return { move: best, value: bestValue };
}

/** Two plies: the first move of the best two-move sequence that makes a word available. */
function bestMove2(state, dict, g, maxFirst = g.moves.length) {
  let best = null;
  let bestValue = -1;
  let tried = 0;
  for (const move of g.moves) {
    if (!legal(state, g, move)) continue;
    if (tried++ >= maxFirst) break;
    const next = applyWordAction(state, move);
    const r = bestMove(next, dict, g);
    if (r.value > bestValue) {
      bestValue = r.value;
      best = move;
    }
  }
  return { move: best, value: bestValue };
}

/**
 * Play one board. Returns { score, banked, words, locked, turnsUsed, log }.
 * Strategy: lock the most valuable available word; otherwise make the move that creates the most
 * valuable word (two plies when one is not enough). Never draws, never goes wild.
 */
export function botPlay(board, bag, dict, opts = {}) {
  let state = createWordState(board, bag, 0);
  const g = gridOfState(state);
  const limit = turnLimit(state);
  const log = [];
  const onProgress = opts.onProgress || null;
  while (state.turns < limit) {
    if (isBoardFull(state)) break; // nothing left to lock: keep the unused turns
    const turnsLeft = limit - state.turns;
    const { cand, value } = bestLockable(state, dict);
    if (cand) {
      // With turns to spare, see whether one move sets up a clearly better word first.
      let setup = null;
      if (turnsLeft >= 2) {
        const r = bestMove(state, dict, g);
        if (r.value > value + 6) setup = r.move;
      }
      if (!setup) {
        state = lockWord(state, cand);
        log.push(`lock ${cand.word} ${cand.score}`);
        if (onProgress) onProgress(state);
        continue;
      }
      state = applyWordAction(state, setup);
      log.push(`move ${setup.type}`);
      if (onProgress) onProgress(state);
      continue;
    }
    if (turnsLeft < 2) break; // one turn left and nothing to lock: a move cannot score
    let r = bestMove(state, dict, g);
    if (r.value <= 0 && turnsLeft >= 3) r = bestMove2(state, dict, g);
    if (!r.move) break;
    state = applyWordAction(state, r.move);
    log.push(`move ${r.move.type}`);
    if (onProgress) onProgress(state);
  }
  return { score: finalScore(state), banked: state.score, words: state.words.map((w) => ({ word: w.word, score: w.score })), locked: state.locked.length, turnsUsed: state.turns, log };
}

export function botPlaySeed(seed, dict, opts, size = 5) {
  const { board, bag } = dealLetters(seed, size);
  return botPlay(board, bag, dict, opts);
}
