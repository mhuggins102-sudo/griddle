// Word mode engine: letter bag, deal, actions with locked tiles, word finding and scoring.
// Pure functions, no DOM. The dictionary is a Set of upper-case words of 3 to 6 letters.
// Boards are 5x5 (20 turns, words of 3 to 5 letters) or 6x6 (25 turns, words of 3 to 6 letters);
// a state carries its size and every function reads the geometry from it.

import { mulberry32, rngNext, shuffle } from './rng.js';
import { gridOf, gridOfState, sizeOfBoard, MIN_WORD } from './grid.js';

export { MIN_WORD, gridOf, gridOfState };

export const WILD = '*';
/** Bump when data/words.txt changes: it is part of the fetch URL, so browsers never keep a stale list. */
export const DICT_VERSION = '2026-10-30-enable36';
export const SIZES = [5, 6];
export const MAX_WORD = 6;
/** Turns per board size. WORD_TURNS is the 5x5 value, kept for callers that assume it. */
export const TURNS_BY_SIZE = { 5: 20, 6: 25 };
export const WORD_TURNS = TURNS_BY_SIZE[5];
export const LENGTH_BONUS = { 3: 0, 4: 5, 5: 15, 6: 30 };
/**
 * End-of-game coverage ladder by board size: +5 per locked tile over the last stretch of the board
 * (from the 20th of 25, from the 29th of 36), so the whole board earns +30 on 5x5 and +40 on 6x6.
 */
export const COVERAGE_LADDER = {
  5: { 20: 5, 21: 10, 22: 15, 23: 20, 24: 25, 25: 30 },
  6: { 29: 5, 30: 10, 31: 15, 32: 20, 33: 25, 34: 30, 35: 35, 36: 40 },
};
/** The 5x5 ladder, kept under its old name. */
export const COVERAGE_BONUS = COVERAGE_LADDER[5];
/** Penalties were removed: the score is word points plus bonuses only. Kept at 0 so the hooks stay. */
export const COVERAGE_TARGET = 22;
export const SHORTFALL_PENALTY = 0;
/** Turning a locked tile wild costs this many turns. */
export const WILD_COST = 2;
/** Locking every tile with turns to spare earns this much per unused turn. */
export const FULL_COVER_TURN_BONUS = 10;

export function sizeOf(state) {
  return state.size || sizeOfBoard(state.board);
}

export function turnLimit(state) {
  return TURNS_BY_SIZE[sizeOf(state)] || WORD_TURNS;
}

export function coverageBonus(lockedCount, size = 5) {
  return (COVERAGE_LADDER[size] || {})[lockedCount] || 0;
}

export function coverageBonusFor(state) {
  return coverageBonus(state.locked.length, sizeOf(state));
}

export function shortfallPenalty(lockedCount) {
  return lockedCount < COVERAGE_TARGET ? (COVERAGE_TARGET - lockedCount) * SHORTFALL_PENALTY : 0;
}

export function isBoardFull(state) {
  return state.locked.length === state.board.length;
}

export function fullCoverTurnBonus(state) {
  return isBoardFull(state) ? Math.max(0, turnLimit(state) - state.turns) * FULL_COVER_TURN_BONUS : 0;
}

/** The score as it stands now, bonuses included (no penalties, so never negative). */
export function projectedScore(state) {
  return state.score + coverageBonusFor(state) + fullCoverTurnBonus(state) - shortfallPenalty(state.locked.length);
}

/** Final score: the projected score, never below 0. */
export function finalScore(state) {
  return Math.max(0, projectedScore(state));
}

/** Turns an action will consume. */
export function actionCost(action) {
  return action.type === 'wild' ? WILD_COST : 1;
}

/** Scrabble letter values. Wild tiles score 0. */
export const LETTER_VALUES = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3,
  N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
};

/** Scrabble letter distribution without the two blanks (98 tiles). */
export const LETTER_COUNTS = {
  A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9, J: 1, K: 1, L: 4, M: 2,
  N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4, T: 6, U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1,
};

export const LETTERS = Object.keys(LETTER_VALUES);

export function letterValue(ch) {
  return LETTER_VALUES[ch] || 0;
}

/** Deal size*size letters from the 98-tile bag (25 leaves 73, 36 leaves 62). bag is a count per letter. */
export function dealLetters(seed, size = 5) {
  const rng = mulberry32(seed);
  const tiles = [];
  for (const [ch, n] of Object.entries(LETTER_COUNTS)) for (let k = 0; k < n; k++) tiles.push(ch);
  shuffle(tiles, rng);
  const cells = size * size;
  const board = tiles.slice(0, cells);
  const bag = {};
  for (const ch of LETTERS) bag[ch] = 0;
  for (let i = cells; i < tiles.length; i++) bag[tiles[i]]++;
  return { board, bag };
}

export function bagTotal(bag) {
  return Object.values(bag).reduce((a, b) => a + b, 0);
}

/** A word-mode play state. locked: cells that cannot move; wild: locked cells turned wild. */
export function createWordState(board, bag, drawSeed = 0) {
  const full = {};
  for (const ch of LETTERS) full[ch] = bag[ch] || 0;
  return { size: sizeOfBoard(board), board: board.slice(), bag: full, rngState: drawSeed >>> 0, turns: 0, locked: [], words: [], score: 0 };
}

export function isLocked(state, cell) {
  return state.locked.includes(cell);
}

/** The cells of a row or column that are free to slide (not locked), in reading order. */
export function lineCellsFree(state, axis, index) {
  return gridOfState(state).lineCells(axis, index).filter((c) => !isLocked(state, c));
}

/**
 * Throws when the action is illegal: moving a locked tile (slide, swap) or running out of turns.
 * Nudging a locked tile is allowed and changes its letter normally; { type: 'wild' } turns a locked
 * tile wild for WILD_COST turns.
 */
export function validateWordAction(state, action) {
  const g = gridOfState(state);
  const { inRange, idx } = g;
  const limit = turnLimit(state);
  if (state.turns + actionCost(action) > limit) throw new Error(actionCost(action) > 1 ? `That needs ${actionCost(action)} turns` : 'No turns left');
  switch (action.type) {
    case 'slide': {
      if (action.axis !== 'row' && action.axis !== 'col') throw new Error('Slide axis must be row or col');
      if (!inRange(action.index)) throw new Error('Slide index out of range');
      if (action.dir !== 1 && action.dir !== -1) throw new Error('Slide dir must be +1 or -1');
      if (lineCellsFree(state, action.axis, action.index).length < 2) throw new Error('Nothing in that line can slide');
      return true;
    }
    case 'swap': {
      if (![action.r, action.c, action.r2, action.c2].every(inRange)) throw new Error('Swap cell out of range');
      if (Math.abs(action.r - action.r2) + Math.abs(action.c - action.c2) !== 1) throw new Error('Swap cells must be orthogonal neighbours');
      if (isLocked(state, idx(action.r, action.c)) || isLocked(state, idx(action.r2, action.c2))) throw new Error('Locked tiles cannot move');
      return true;
    }
    case 'nudge':
      if (!inRange(action.r) || !inRange(action.c)) throw new Error('Nudge cell out of range');
      if (action.delta !== 1 && action.delta !== -1) throw new Error('Nudge delta must be +1 or -1');
      return true;
    case 'draw':
      if (!inRange(action.r) || !inRange(action.c)) throw new Error('Draw cell out of range');
      return true; // locked tiles may be drawn over: they stay locked, only the letter changes
    case 'wild':
      if (!inRange(action.r) || !inRange(action.c)) throw new Error('Wild cell out of range');
      if (!isLocked(state, idx(action.r, action.c))) throw new Error('Only a locked tile can be made wild');
      if (state.board[idx(action.r, action.c)] === WILD) throw new Error('That tile is already wild');
      return true;
    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
}

export function nudgeLetter(ch, delta) {
  if (ch === WILD) return WILD;
  const i = LETTERS.indexOf(ch);
  return LETTERS[(i + delta + 26) % 26];
}

/** Apply one action; returns the new state (input untouched). */
export function applyWordAction(state, action) {
  validateWordAction(state, action);
  const { idx } = gridOfState(state);
  const next = { ...state, size: sizeOf(state), board: state.board.slice(), bag: { ...state.bag }, locked: state.locked.slice(), words: state.words.slice(), turns: state.turns + actionCost(action) };
  delete next.lastDraw;
  switch (action.type) {
    case 'slide': {
      for (const m of slideMoves(state, action)) next.board[m.to] = state.board[m.from];
      break;
    }
    case 'swap': {
      const a = idx(action.r, action.c);
      const b = idx(action.r2, action.c2);
      const t = next.board[a];
      next.board[a] = next.board[b];
      next.board[b] = t;
      break;
    }
    case 'nudge': {
      const cell = idx(action.r, action.c);
      next.board[cell] = nudgeLetter(next.board[cell], action.delta);
      break;
    }
    case 'wild': {
      next.board[idx(action.r, action.c)] = WILD;
      break;
    }
    case 'draw': {
      const cell = idx(action.r, action.c);
      const total = bagTotal(next.bag);
      if (total <= 0) throw new Error('Bag is empty');
      const r = rngNext(next.rngState);
      next.rngState = r.state;
      let pick = Math.floor(r.value * total);
      let drawn = null;
      for (const ch of LETTERS) {
        if (pick < next.bag[ch]) {
          drawn = ch;
          break;
        }
        pick -= next.bag[ch];
      }
      const tossed = next.board[cell];
      next.bag[drawn]--;
      next.board[cell] = drawn;
      if (tossed !== WILD) next.bag[tossed]++;
      next.lastDraw = { cell, drawn, tossed };
      break;
    }
    default:
      break;
  }
  return next;
}

/**
 * Where each unlocked tile of a line goes when it slides: locked tiles stay put and the others
 * shift one step along the unlocked positions, the last one wrapping to the first.
 * Returns [{ from, to, wrap }].
 */
export function slideMoves(state, action) {
  const free = lineCellsFree(state, action.axis, action.index);
  const n = free.length;
  const moves = [];
  for (let k = 0; k < n; k++) {
    const j = (k + action.dir + n) % n;
    moves.push({ from: free[k], to: free[j], wrap: action.dir === 1 ? k === n - 1 : k === 0 });
  }
  return moves;
}

/** Is one word the plural of the other (DOOR/DOORS, BOX/BOXES, CITY/CITIES)? */
export function isPluralPair(a, b) {
  if (a === b) return false;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  if (long === short + 'S') return true;
  if (long === short + 'ES') return true;
  if (short.endsWith('Y') && long === short.slice(0, -1) + 'IES') return true;
  return false;
}

/** Why a word cannot be locked given the words already locked, or '' when it can. */
export function lockConflict(state, word, cells) {
  const key = cellKey(cells);
  for (const w of state.words) {
    if (w.word === word) return `${word} is already locked`;
    if (isPluralPair(w.word, word)) return `${word} clashes with ${w.word} (singular and plural)`;
    if (w.key === key) return 'those tiles are already locked as a word';
  }
  if (cells.every((c) => state.locked.includes(c))) return 'a new word needs at least one unlocked tile';
  return '';
}

function makeCandidate(state, word, orderedCells) {
  const reason = lockConflict(state, word, orderedCells);
  return { word, cells: orderedCells, score: scoreWord(state.board, orderedCells), key: cellKey(orderedCells), lockable: !reason, reason };
}

/**
 * The word running from one tapped tile to another, if the two are on a common row, column or
 * diagonal 3 to size cells apart. Returns a candidate, or { error } when the span or word is invalid.
 */
export function findWordAt(state, dict, first, last) {
  const { rowOf, colOf, idx } = gridOfState(state);
  if (first === last) return { error: 'Tap the first and last letter of a word.' };
  const dr = rowOf(last) - rowOf(first);
  const dc = colOf(last) - colOf(first);
  const len = Math.max(Math.abs(dr), Math.abs(dc)) + 1;
  if (!(dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc))) return { error: 'Words run along a row, column or diagonal.' };
  if (len < MIN_WORD) return { error: 'Words need at least 3 letters.' };
  const sr = Math.sign(dr);
  const sc = Math.sign(dc);
  const cells = [];
  for (let k = 0; k < len; k++) cells.push(idx(rowOf(first) + sr * k, colOf(first) + sc * k));
  const pattern = cells.map((c) => state.board[c]).join('');
  const matches = matchesForPattern(pattern, dict);
  if (!matches.length) return { error: `${pattern.replace(/\*/g, '?')} is not in the word list.` };
  return makeCandidate(state, matches[0], cells);
}

/** Every line a word can lie on for a board size, in reading order: rows, columns, diagonals of 3 or more cells. */
export function wordLines(size = 5) {
  return gridOf(size).lines;
}

export function cellKey(cells) {
  return cells.slice().sort((a, b) => a - b).join(',');
}

/** Score for a word laid on these cells (wild tiles score 0) plus the length bonus. */
export function scoreWord(board, cells) {
  let s = 0;
  for (const c of cells) s += letterValue(board[c]);
  return s + (LENGTH_BONUS[cells.length] || 0);
}

/** All dictionary words that can be read along a wildcard pattern (letters or WILD). */
function matchesForPattern(pattern, dict) {
  const wilds = [];
  for (let i = 0; i < pattern.length; i++) if (pattern[i] === WILD) wilds.push(i);
  if (wilds.length === 0) return dict.has(pattern) ? [pattern] : [];
  if (wilds.length > 2) return [];
  const out = [];
  const chars = pattern.split('');
  const rec = (k) => {
    if (k === wilds.length) {
      const w = chars.join('');
      if (dict.has(w)) out.push(w);
      return;
    }
    for (const ch of LETTERS) {
      chars[wilds[k]] = ch;
      rec(k + 1);
    }
  };
  rec(0);
  return out;
}

/**
 * Find every word of 3 to size letters readable forward or backward along any line.
 * Returns candidates { word, cells (in the word's reading order), score, key, lockable, reason }.
 * A candidate is lockable when at least one of its cells is not locked yet and no locked word
 * already occupies exactly those cells.
 */
export function findWords(state, dict) {
  const board = state.board;
  const seen = new Set();
  const out = [];
  for (const line of gridOfState(state).lines) {
    for (let start = 0; start < line.length; start++) {
      for (let len = MIN_WORD; start + len <= line.length; len++) {
        const cells = line.slice(start, start + len);
        for (const dir of [1, -1]) {
          const ordered = dir === 1 ? cells : cells.slice().reverse();
          const pattern = ordered.map((c) => board[c]).join('');
          for (const word of matchesForPattern(pattern, dict)) {
            const id = `${word}@${cellKey(cells)}`;
            if (seen.has(id)) continue;
            seen.add(id);
            out.push(makeCandidate(state, word, ordered));
          }
        }
      }
    }
  }
  out.sort((a, b) => b.score - a.score || (a.word < b.word ? -1 : a.word > b.word ? 1 : 0)); // code-point order: the same on every device
  return out;
}

/** Lock a candidate word: its tiles stop moving and its score is banked. Costs one turn. Returns the new state. */
export function lockWord(state, candidate) {
  if (!candidate.lockable) throw new Error(candidate.reason || 'Cannot lock this word');
  if (state.turns >= turnLimit(state)) throw new Error('No turns left');
  const next = { ...state, size: sizeOf(state), locked: state.locked.slice(), words: state.words.slice(), turns: state.turns + 1 };
  for (const c of candidate.cells) if (!next.locked.includes(c)) next.locked.push(c);
  next.words.push({ word: candidate.word, cells: candidate.cells.slice(), key: candidate.key, score: candidate.score });
  next.score = state.score + candidate.score;
  return next;
}

export function describeWordCells(cells, size = 5) {
  const { rowOf, colOf } = gridOf(size);
  const a = cells[0];
  const b = cells[cells.length - 1];
  const dr = Math.sign(rowOf(b) - rowOf(a));
  const dc = Math.sign(colOf(b) - colOf(a));
  let where;
  if (dr === 0) where = `row ${rowOf(a) + 1}`;
  else if (dc === 0) where = `column ${colOf(a) + 1}`;
  else where = 'diagonal';
  return `${where}, from row ${rowOf(a) + 1} col ${colOf(a) + 1}`;
}

/** Parse the shipped word list (one upper-case word per line) into a Set of 3 to 6 letter words. */
export function parseDictionary(text) {
  const dict = new Set();
  for (const line of text.split(/\r?\n/)) {
    const w = line.trim().toUpperCase();
    if (w.length >= MIN_WORD && w.length <= MAX_WORD && /^[A-Z]+$/.test(w)) dict.add(w);
  }
  return dict;
}

/** "GridLock 87 (QUIZ 25, TONE 9, ...)" */
export function wordShareLine(score, words, title = 'GridLock') {
  const parts = words.map((w) => `${w.word} ${w.score}`);
  return `${title} ${score} (${parts.length ? parts.join(', ') : 'no words'})`;
}
