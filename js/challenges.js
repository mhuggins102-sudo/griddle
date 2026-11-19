// Challenges: fixed 5x5 boards, each with a twist, played for three trophies (bronze, silver, gold) against
// fixed target scores. The board is always the same (dealt from the challenge's seed) but the draws are random,
// so a challenge can be replayed; there is no undo. A twist is one of: a perk card's effect on for the whole
// board (state.perk flags, squares, stickers), a deal rule (which letters the board and the bag hold, wild
// tiles, locked tiles), or a rule the engine enforces from state.rules (turns, the moves allowed and what
// they cost, which words count). Pure data and helpers, used by the game, the Challenges page and the
// calibration bot.

import { LETTERS, LETTER_COUNTS, LETTER_VALUES, WILD, createWordState, scoreWord, cellKey } from './words.js';
import { emptyPerk } from './perks.js';
import { mulberry32, shuffle, hashString } from './rng.js';
import { TARGETS } from './challenge-targets.js';

export const VOWELS = ['A', 'E', 'I', 'O', 'U'];
const CONSONANTS = LETTERS.filter((ch) => !VOWELS.includes(ch));
const ONE_POINT = LETTERS.filter((ch) => LETTER_VALUES[ch] === 1);

export const TROPHIES = ['bronze', 'silver', 'gold'];
export const TROPHY_NAMES = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };

/**
 * The catalogue. tag is the twist in a line (shown in the list and over the board), text says a little
 * more. rules go into state.rules, perk into state.perk, deal shapes the board and the bag. A seed is hashed
 * from the id unless given. targets come from challenge-targets.js.
 */
const LIST = [
  // a perk card's effect on for the whole board
  { id: 'slant-bonus', name: 'Slant Bonus', tag: 'Every diagonal word scores +5', text: 'Diagonal Dividend is on for the whole board: +5 for every word locked along a diagonal.', perk: { diagonal: true } },
  { id: 'corner-cutter', name: 'Corner Cutter', tag: 'Tiles swap with diagonal neighbours too', text: 'Diagonal Swap is on for the whole board: drag a tile corner to corner as well as sideways.', perk: { diagonalSwap: true } },
  { id: 'open-field', name: 'Open Field', tag: '+4 for every word that uses no locked tile', text: 'Open Field is on for the whole board. Spreading out pays; so does the tile ladder, and the two pull against each other.', perk: { openField: true } },
  { id: 'crossroads', name: 'Crossroads', tag: '+2 for every word that reuses a locked tile', text: 'Crossroads is on for the whole board: weave a crossword and every crossing pays.', perk: { crossroads: true } },
  { id: 'small-change', name: 'Small Change', tag: '+3 for every 3-letter word', text: 'Short Stack is on for the whole board: many quick words against a few long ones.', perk: { shortStack: true } },
  { id: 'long-haul', name: 'Long Haul', tag: '+8 for every 5-letter word', text: 'Long Haul is on for the whole board: a word that spans a whole line pays +8 on top of its length bonus.', perk: { longHaul: true } },
  { id: 'clairvoyant', name: 'Clairvoyant', tag: 'The next draw is always known', text: 'Peek is on for the whole board: the bag panel and the hold menu show the letter the next Draw will bring.', perk: { peek: true } },
  { id: 'pick-of-three', name: 'Pick of Three', tag: 'Every draw offers three letters; keep one', text: 'Choice Draw is on for every Draw: three letters are shown and one stays. A draw still costs its turn.', perk: { choiceDraw: true }, rules: { choiceDraws: true } },
  { id: 'hot-spots', name: 'Hot Spots', tag: '+5 for every word through a marked tile', text: 'Four tiles carry a Gold Sticker from the start: every word through one of them scores +5, every time.', perk: { stickers: { 6: 5, 8: 5, 16: 5, 18: 5 } } },
  { id: 'premium-squares', name: 'Premium Squares', tag: '×3 corners and ×2 squares, each paying once', text: 'Letter squares are laid before play: ×3 in the corners, ×2 in the middle of each side and at the centre. Each pays once, when a word locks its tile.', perk: { squares: { 0: 3, 4: 3, 20: 3, 24: 3, 2: 2, 10: 2, 14: 2, 22: 2, 12: 2 } } },
  { id: 'three-jokers', name: 'Three Jokers', tag: 'Three wild tiles from the start; they score 0', text: 'Three tiles are wild before the first move. A wild fits any word and scores nothing, so the points must come from the letters around it.', deal: { wilds: [6, 12, 18] } },
  { id: 'blitz', name: 'Blitz', tag: '12 turns instead of 20', text: 'Twelve turns. The tile ladder is out of reach, so every lock has to be worth it.', rules: { turns: 12 } },
  { id: 'marathon', name: 'Marathon', tag: '32 turns instead of 20', text: 'Thirty-two turns, and targets that sit near a full board.', rules: { turns: 32 } },
  // the letters and the bag
  { id: 'drought', name: 'Drought', tag: 'No vowels are dealt; the bag has them', text: 'The board is dealt with no A, E, I, O or U. The bag is as usual, so the vowels have to be drawn in.', deal: { boardNot: VOWELS } },
  { id: 'dry-well', name: 'Dry Well', tag: 'The bag holds consonants only', text: 'A normal board, but every Draw brings a consonant.', deal: { bagOnly: CONSONANTS } },
  { id: 'vowel-flood', name: 'Vowel Flood', tag: 'The bag holds vowels only', text: 'A normal board, but every Draw brings an A, E, I, O or U.', deal: { bagOnly: VOWELS } },
  { id: 'heavy-metal', name: 'Heavy Metal', tag: 'The bag holds only letters worth 4 or more', text: 'Every Draw brings an F, H, V, W, Y, K, J, X, Q or Z. Big points, if you can place them.', deal: { bagSet: { F: 3, H: 3, V: 3, W: 3, Y: 3, K: 3, J: 2, X: 2, Q: 2, Z: 2 } } },
  { id: 'penny-tiles', name: 'Penny Tiles', tag: 'Only 1-point letters, on the board and in the bag', text: 'Nothing but A, E, I, O, U, L, N, S, T and R. The points come from word length and the tile ladder.', deal: { boardOnly: ONE_POINT, bagOnly: ONE_POINT } },
  { id: 'what-you-see', name: 'What You See', tag: 'The bag is empty: no draws', text: 'The 25 letters dealt are all you get. Slide, swap and nudge them into words.', deal: { bagEmpty: true } },
  { id: 'quandary', name: 'Quandary', tag: 'Three Qs on the board and no U anywhere', text: 'Three Qs, and not a U on the board or in the bag. QAT, QOPH, FAQIR and TRANQ are in the list.', deal: { qs: 3 } },
  { id: 'stamp', name: 'Stamp', tag: 'Every draw is an S', text: 'The bag holds nothing but S. Plurals everywhere, and a plural cannot be locked over the word it comes from.', deal: { bagSet: { S: 30 } } },
  // which words count
  { id: 'no-shorties', name: 'No Shorties', tag: 'Only words of 4 or more letters count', text: 'Three-letter words cannot be locked.', rules: { words: { minLen: 4 } } },
  { id: 'full-lines', name: 'Full Lines', tag: 'Only 5-letter words count', text: 'A word has to fill its whole row, column or diagonal.', rules: { words: { exactLen: 5 } } },
  { id: 'mirror', name: 'Mirror', tag: 'Only backwards words count', text: 'Words are read right to left along a row, and bottom to top along a column or diagonal.', rules: { words: { backward: true } } },
  { id: 'slant', name: 'Slant', tag: 'Only diagonal words count', text: 'Rows and columns do not count: only the diagonals.', rules: { words: { lines: 'diag' } } },
  { id: 'horizon', name: 'Horizon', tag: 'Only words along a row count', text: 'Columns and diagonals do not count: only the five rows.', rules: { words: { lines: 'row' } } },
  { id: 'downpour', name: 'Downpour', tag: 'Only words down a column count', text: 'Rows and diagonals do not count: only the five columns.', rules: { words: { lines: 'col' } } },
  { id: 'bullseye', name: 'Bullseye', tag: 'Every word must pass through the centre tile', text: 'Four lines cross the centre: its row, its column and the two long diagonals. Every word uses the centre tile.', rules: { words: { through: 12 } } },
  { id: 'perimeter', name: 'Perimeter', tag: 'Only words along the edge of the board count', text: 'A word has to lie along one of the four sides.', rules: { words: { lines: 'edge' } } },
  { id: 'chain-reaction', name: 'Chain Reaction', tag: 'After the first word, every word must cross a locked word', text: 'Like a crossword: every new word reuses at least one locked tile.', rules: { words: { chain: true } } },
  { id: 'fresh-tiles', name: 'Fresh Tiles', tag: 'A word may use no locked tile', text: 'No crossing and no reuse: every word is laid on fresh tiles only.', rules: { words: { fresh: true } } },
  { id: 'twins', name: 'Twins', tag: 'Only words with a double letter count', text: 'BALL, SEEN, TOOTH: a word needs the same letter twice in a row.', rules: { words: { doubleLetter: true } } },
  // the moves and the board
  { id: 'lucky-dip', name: 'Lucky Dip', tag: 'The only moves are Draw and Lock', text: 'No swaps, flicks or nudges: press and hold to draw, tap the ends to lock.', rules: { moves: ['draw'] } },
  { id: 'conveyor', name: 'Conveyor', tag: 'The only moves are flicks, then Lock', text: 'Rows and columns slide; nothing else moves, and nothing is drawn.', rules: { moves: ['slide'] } },
  { id: 'rotor', name: 'Rotor', tag: 'The only move is turning a 2×2 block', text: 'Tap the top-left tile of a block of four unlocked tiles, choose a quarter, half or three-quarter turn, and lock it in. One turn each.', rules: { moves: [], rotor: true } },
  { id: 'eight-words', name: 'Eight Words', tag: 'Swaps, flicks and nudges cost no turn; 8 turns', text: 'Move the letters as much as you like for nothing. Only a Lock, a Draw or a wild spends one of the eight turns.', rules: { turns: 8, freeMoves: true } },
  { id: 'boulders', name: 'Boulders', tag: 'Five tiles are locked from the start', text: 'Five tiles belong to no word and never move; words may still run through them. They count as locked tiles for the ladder.', deal: { boulders: [1, 8, 12, 16, 23] } },
  { id: 'build-around', name: 'Build Around', tag: 'WALTZ is locked across the middle, its points banked', text: 'The middle row starts as the locked word WALTZ, worth 32. Everything else is built through or around it.', deal: { lockedWord: { row: 2, word: 'WALTZ' } } },
];

export const CHALLENGES = LIST.map((c) => ({ size: 5, ...c, seed: c.seed ?? hashString(`gridlock-challenge:${c.id}`), targets: TARGETS[c.id] || null }));
export const CHALLENGE_BY_ID = Object.fromEntries(CHALLENGES.map((c) => [c.id, c]));

/** One weighted draw from a bag (counts per letter), with the generator; null when the bag is empty. Not the engine's draw. */
function takeFromBag(bag, rng, skip = []) {
  const pool = LETTERS.filter((ch) => bag[ch] > 0 && !skip.includes(ch));
  const total = pool.reduce((a, ch) => a + bag[ch], 0);
  if (!total) return null;
  let pick = Math.floor(rng() * total);
  for (const ch of pool) {
    if (pick < bag[ch]) {
      bag[ch]--;
      return ch;
    }
    pick -= bag[ch];
  }
  return null;
}

/**
 * The board and the bag a challenge starts from, dealt from its seed with its deal rule applied, plus any
 * tiles locked (and word banked) before play: { board, bag, locked, words, score }.
 */
export function dealChallenge(ch) {
  const d = ch.deal || {};
  const size = ch.size || 5;
  const cells = size * size;
  const rng = mulberry32(ch.seed >>> 0);
  const tiles = [];
  for (const [letter, n] of Object.entries(LETTER_COUNTS)) for (let k = 0; k < n; k++) tiles.push(letter);
  shuffle(tiles, rng);
  const fits = d.boardOnly ? (t) => d.boardOnly.includes(t) : d.boardNot ? (t) => !d.boardNot.includes(t) : () => true;
  const board = [];
  const rest = [];
  for (const t of tiles) {
    if (board.length < cells && fits(t)) board.push(t);
    else rest.push(t);
  }
  if (board.length < cells) throw new Error(`${ch.id}: not enough tiles for the board`);
  const bag = {};
  for (const letter of LETTERS) bag[letter] = 0;
  for (const t of rest) bag[t]++;
  if (d.bagOnly) for (const letter of LETTERS) if (!d.bagOnly.includes(letter)) bag[letter] = 0;
  if (d.bagEmpty) for (const letter of LETTERS) bag[letter] = 0;
  if (d.bagSet) {
    for (const letter of LETTERS) bag[letter] = 0;
    Object.assign(bag, d.bagSet);
  }
  const giveBack = (cell) => {
    if (board[cell] !== WILD && !d.bagOnly && !d.bagEmpty && !d.bagSet) bag[board[cell]]++;
  };
  if (d.wilds) for (const cell of d.wilds) {
    giveBack(cell);
    board[cell] = WILD;
  }
  if (d.qs) {
    // that many Qs on the board (on cells the seed picks), and no U on the board or in the bag
    const have = board.filter((t) => t === 'Q').length;
    const spots = shuffle(board.map((_, i) => i).filter((i) => board[i] !== 'Q'), rng).slice(0, Math.max(0, d.qs - have));
    for (const cell of spots) {
      giveBack(cell);
      board[cell] = 'Q';
    }
    bag.U = 0;
    for (let i = 0; i < board.length; i++) if (board[i] === 'U') board[i] = takeFromBag(bag, rng, ['U', 'Q']) || 'E';
  }
  let locked = null;
  let words = null;
  let score = 0;
  if (d.lockedWord) {
    const { row, word } = d.lockedWord;
    const line = Array.from({ length: size }, (_, k) => row * size + k);
    line.forEach((cell, k) => {
      giveBack(cell);
      board[cell] = word[k];
      if (bag[word[k]] > 0) bag[word[k]]--;
    });
    locked = line.slice();
    score = scoreWord(board, line);
    words = [{ word, cells: line, key: cellKey(line), score }];
  }
  if (d.boulders) locked = (locked || []).concat(d.boulders.filter((c) => !(locked || []).includes(c)));
  return { board, bag, locked, words, score };
}

/** The play state a challenge starts from: its board and bag, its rules, its perk effects and anything locked before play. drawSeed decides the draws. */
export function challengeState(ch, drawSeed = 0) {
  const { board, bag, locked, words, score } = dealChallenge(ch);
  const state = createWordState(board, bag, drawSeed);
  if (locked) state.locked = locked.slice();
  if (words) state.words = words.map((w) => ({ ...w, cells: w.cells.slice() }));
  state.score = score;
  if (ch.rules) state.rules = JSON.parse(JSON.stringify(ch.rules));
  if (ch.perk) {
    const p = ch.perk;
    state.perk = { ...emptyPerk(), ...p, squares: { ...(p.squares || {}) }, squareCard: {}, stickers: { ...(p.stickers || {}) }, log: [] };
  } else if (ch.rules && ch.rules.rotor) state.perk = emptyPerk(); // the rotation is a perk action; the engine wants a record to write into
  return state;
}

/** The trophy a score earns on a challenge: 'gold', 'silver', 'bronze' or null; null too while the challenge has no targets yet. */
export function trophyFor(ch, score) {
  const t = ch.targets;
  if (!t) return null;
  if (score >= t[2]) return 'gold';
  if (score >= t[1]) return 'silver';
  if (score >= t[0]) return 'bronze';
  return null;
}

/** The next trophy a score has not reached, as { name, value }, or null at gold (or without targets). */
export function nextTarget(ch, score) {
  const t = ch.targets;
  if (!t) return null;
  for (let i = 0; i < 3; i++) if (score < t[i]) return { name: TROPHIES[i], value: t[i] };
  return null;
}

/** Which of two trophies ranks higher (null is lowest). */
export function betterTrophy(a, b) {
  return TROPHIES.indexOf(a) >= TROPHIES.indexOf(b) ? a : b;
}

/** The device's challenge records, id → { best, trophy, plays, at }, from the word stats. */
export function challengeRecords(word) {
  return (word && word.challenges && typeof word.challenges === 'object' && word.challenges) || {};
}

/** How many trophies of each kind the device holds, over the catalogue: { gold, silver, bronze, total, of }. */
export function trophyCount(word) {
  const recs = challengeRecords(word);
  const out = { gold: 0, silver: 0, bronze: 0, total: 0, of: CHALLENGES.length };
  for (const c of CHALLENGES) {
    const t = recs[c.id] && recs[c.id].trophy;
    if (t && out[t] !== undefined) {
      out[t]++;
      out.total++;
    }
  }
  return out;
}
