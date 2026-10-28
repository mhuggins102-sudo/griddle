// Round and game flow plus localStorage persistence. No DOM access; ui.js renders this.

import { createState, applyAction, encodeAction, allGoalsHold, scoreBreakdown, gameScore, BID_MIN, BID_MAX, ROUNDS_PER_GAME } from './engine.js';
import { mulberry32, randomSeed, shuffle } from './rng.js';

export const STORAGE_KEY = 'gridbid.v1';
export const HISTORY_LIMIT = 50;

export function defaultStore() {
  return {
    seen: [],
    gamesPlayed: 0,
    bestTotal: null,
    history: [],
    beatPar: [],
    settings: { numerals: false, showWords: false },
    currentGame: null,
    word: { gamesPlayed: 0, best: null, history: [] },
    wordGame: null,
  };
}

export function loadStore(storage = globalThis.localStorage) {
  try {
    const raw = storage && storage.getItem(STORAGE_KEY);
    if (!raw) return defaultStore();
    const parsed = JSON.parse(raw);
    return { ...defaultStore(), ...parsed, settings: { ...defaultStore().settings, ...(parsed.settings || {}) }, word: { ...defaultStore().word, ...(parsed.word || {}) } };
  } catch {
    return defaultStore();
  }
}

export function saveStore(store, storage = globalThis.localStorage) {
  try {
    if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // storage full or unavailable: the game still plays
  }
}

/** Pick 5 puzzle ids not yet seen on this device, in random order. Resets the seen list when the bank runs low. */
export function pickPuzzleIds(bank, seen, rng = Math.random) {
  const seenSet = new Set(seen);
  let pool = bank.puzzles.filter((p) => !seenSet.has(p.id)).map((p) => p.id);
  if (pool.length < ROUNDS_PER_GAME) pool = bank.puzzles.map((p) => p.id);
  shuffle(pool, rng);
  return pool.slice(0, ROUNDS_PER_GAME);
}

export function findPuzzle(bank, id) {
  return bank.puzzles.find((p) => p.id === id);
}

export function newGame(bank, store) {
  const rng = mulberry32(randomSeed());
  const ids = pickPuzzleIds(bank, store.seen, rng);
  const rounds = ids.map((id) => {
    const p = findPuzzle(bank, id);
    const drawSeed = randomSeed();
    const state = createState(p.board, p.bag, drawSeed);
    return { puzzleId: id, drawSeed, bid: null, state, actions: [], status: 'bid', score: 0, breakdown: null };
  });
  return { startedAt: new Date().toISOString(), rounds, index: 0 };
}

export function currentRound(game) {
  return game.rounds[game.index];
}

export function lockBid(round, bid) {
  if (round.status !== 'bid') throw new Error('Bid already locked');
  if (!Number.isInteger(bid) || bid < BID_MIN || bid > BID_MAX) throw new Error('Bid out of range');
  round.bid = bid;
  round.status = 'play';
}

/**
 * Apply one action to the current round. Returns { state, solved, bust }.
 * The round ends solved when both goals hold, or bust when the turn counter reaches the bid unsolved.
 */
export function playAction(round, puzzle, action) {
  if (round.status !== 'play') throw new Error('Round is not in play');
  const state = applyAction(round.state, action);
  round.state = state;
  round.actions.push(encodeAction(action));
  const solved = allGoalsHold(state.board, puzzle.goals);
  let bust = false;
  if (solved) finishRound(round, puzzle, state.turns);
  else if (state.turns >= round.bid) {
    bust = true;
    finishRound(round, puzzle, state.turns + 1);
  }
  return { state, solved, bust };
}

export function giveUp(round, puzzle) {
  if (round.status !== 'play') throw new Error('Round is not in play');
  finishRound(round, puzzle, round.bid + 1);
}

function finishRound(round, puzzle, turns) {
  const b = scoreBreakdown(round.bid, puzzle.par, turns);
  round.status = b.bust ? 'bust' : 'solved';
  round.turns = b.bust ? null : turns;
  round.score = b.score;
  round.breakdown = b;
}

export function runningTotal(game) {
  return gameScore(game.rounds.map((r) => r.score || 0));
}

export function isGameOver(game) {
  return game.index >= game.rounds.length - 1 && currentRound(game).status !== 'bid' && currentRound(game).status !== 'play';
}

export function advanceRound(game) {
  if (game.index < game.rounds.length - 1) game.index++;
}

/** Summary stored in history and used for the share line. */
export function summarizeGame(game, bank) {
  const rounds = game.rounds.map((r) => {
    const p = findPuzzle(bank, r.puzzleId);
    return { puzzleId: r.puzzleId, drawSeed: r.drawSeed, bid: r.bid, par: p.par, turns: r.turns, score: r.score, bust: r.status === 'bust', actions: r.actions };
  });
  return { at: new Date().toISOString(), total: gameScore(rounds.map((r) => r.score)), rounds };
}

/** "Grid Bid 437 (8/8, 9/8, 7/7, bust, 10/10)" with bid/par per round. */
export function shareLine(summary, title = 'Grid Bid') {
  const parts = summary.rounds.map((r) => (r.bust ? 'bust' : `${r.bid}/${r.par}`));
  return `${title} ${summary.total} (${parts.join(', ')})`;
}

/** Record a finished game into the store (seen ids, counts, best, history, beat-par ids). */
export function recordGame(store, summary) {
  for (const r of summary.rounds) {
    if (!store.seen.includes(r.puzzleId)) store.seen.push(r.puzzleId);
    if (!r.bust && r.turns < r.par && !store.beatPar.includes(r.puzzleId)) store.beatPar.push(r.puzzleId);
  }
  store.gamesPlayed++;
  const isBest = store.bestTotal === null || summary.total > store.bestTotal;
  if (isBest) store.bestTotal = summary.total;
  store.history.unshift({ at: summary.at, total: summary.total, rounds: summary.rounds.map((r) => ({ puzzleId: r.puzzleId, drawSeed: r.drawSeed, bid: r.bid, par: r.par, turns: r.turns, score: r.score, bust: r.bust })) });
  store.history = store.history.slice(0, HISTORY_LIMIT);
  store.currentGame = null;
  return isBest;
}
