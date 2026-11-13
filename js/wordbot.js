// Word-mode bot: plays a board draw-free to set a goal score. Pure functions, runs in Node,
// in a Web Worker, or on the main thread. Works on any board size the engine supports.

import { gridOfState } from './grid.js';
import {
  dealLetters, createWordState, applyWordAction, findWords, lockWord, finalScore, isLocked, isBoardFull, turnLimit,
} from './words.js';

/**
 * The goal for a level is fixed by the level and the board size: 60, 70, 80… on 5x5 and 100, 115, 130… on
 * 6x6. The board is chosen to fit it: the bot plays a few candidate boards and the game keeps the one
 * whose banked word points (fill bonuses excluded) put the goal closest to the level's share of them,
 * 50% at level 1 and 5 points more per level, with no cap. So a level-1 board is one the bot scores
 * about twice the goal on, a level-11 board one the bot just reaches the goal on, and later levels ask
 * for more than the bot banks; the player's coverage and spare-turn bonuses are what carry a run on.
 */
export const GOAL_SCHEDULE = { 5: { start: 60, step: 10 }, 6: { start: 100, step: 15 } };
export const GOAL_START_PERCENT = 50;
export const GOAL_STEP_PERCENT = 5;
export const CANDIDATE_BOARDS = 6; // boards the bot tries for a level before the closest fit is kept
export function goalPercent(level) {
  return GOAL_START_PERCENT + GOAL_STEP_PERCENT * (level - 1);
}

/** The level goal for a board size. */
export function goalFor(level, size = 5) {
  const { start, step } = GOAL_SCHEDULE[size] || GOAL_SCHEDULE[5];
  return start + step * (Math.max(1, level) - 1);
}

/** The bot's banked points a level's board should have, so that the goal is the level's share of them. */
export function targetBotScore(level, size = 5) {
  return (goalFor(level, size) * 100) / goalPercent(level);
}

/** Of several bot results ({ banked, ... }), the one closest to the target, by banked points. */
export function closestToTarget(results, target) {
  let best = null;
  for (const r of results) if (r && (best === null || Math.abs(r.banked - target) < Math.abs(best.banked - target))) best = r;
  return best;
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
