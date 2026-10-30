import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CELLS, idx } from '../js/engine.js';
import {
  dealLetters, createWordState, applyWordAction, findWords, lockWord, scoreWord, nudgeLetter, wordLines, parseDictionary,
  bagTotal, LETTER_COUNTS, WILD, wordShareLine, slideMoves, isPluralPair, findWordAt, coverageBonus, finalScore, shortfallPenalty, WORD_TURNS,
  fullCoverTurnBonus, isBoardFull, projectedScore, turnLimit, TURNS_BY_SIZE,
} from '../js/words.js';

const dict = parseDictionary(readFileSync(new URL('../data/words.txt', import.meta.url), 'utf8'));

function boardFrom(rows) {
  return rows.join('').split('');
}

test('dictionary loads with 3 to 6 letter words only', () => {
  assert.ok(dict.size > 25000);
  for (const w of dict) assert.ok(w.length >= 3 && w.length <= 6 && /^[A-Z]+$/.test(w));
  assert.ok(dict.has('CAT') && dict.has('QUIZ') && dict.has('TONE') && dict.has('LETTER'));
  assert.ok(!dict.has('AA') && !dict.has('LETTERS'));
});

test('deal: 25 letters plus a 73-tile bag, Scrabble distribution, deterministic; 6x6 deals 36 and leaves 62', () => {
  const { board, bag } = dealLetters(1);
  assert.equal(board.length, CELLS);
  assert.equal(bagTotal(bag), 98 - CELLS);
  const counts = {};
  for (const ch of board) counts[ch] = (counts[ch] || 0) + 1;
  for (const [ch, n] of Object.entries(LETTER_COUNTS)) assert.equal((counts[ch] || 0) + bag[ch], n, ch);
  assert.deepEqual(dealLetters(1), { board, bag });
  const six = dealLetters(1, 6);
  assert.equal(six.board.length, 36);
  assert.equal(bagTotal(six.bag), 62);
  assert.deepEqual(six.board.slice(0, 25), board, 'the first 25 letters of a 6x6 deal are the 5x5 deal of the same seed');
});

test('word lines: 5 rows, 5 columns, 10 diagonals of length 3 to 5', () => {
  const lines = wordLines();
  assert.equal(lines.length, 20);
  const lens = lines.slice(10).map((l) => l.length).sort().join('');
  assert.equal(lens, '3333444455');
  assert.deepEqual(lines[10], [idx(2, 0), idx(3, 1), idx(4, 2)]);
  assert.deepEqual(lines[12], [0, 6, 12, 18, 24]);
  assert.deepEqual(lines[17], [4, 8, 12, 16, 20]);
});

test('findWords reads forward and backward on rows, columns and diagonals, scores like Scrabble with length bonus', () => {
  const board = boardFrom(['CATXX', 'XXXXX', 'XXXXX', 'XXXXX', 'XXXXX']);
  const s = createWordState(board, {});
  const words = findWords(s, dict);
  const cat = words.find((w) => w.word === 'CAT');
  assert.ok(cat);
  assert.deepEqual(cat.cells, [0, 1, 2]);
  assert.equal(cat.score, 3 + 1 + 1);
  // backward: TAC is not a word, but reversed lines are tried: put "TAC" and expect CAT read backwards
  const back = createWordState(boardFrom(['TACXX', 'XXXXX', 'XXXXX', 'XXXXX', 'XXXXX']), {});
  const catBack = findWords(back, dict).find((w) => w.word === 'CAT');
  assert.ok(catBack);
  assert.deepEqual(catBack.cells, [2, 1, 0]);
  // column and diagonal
  const col = createWordState(boardFrom(['QXXXX', 'UXXXX', 'IXXXX', 'ZXXXX', 'XXXXX']), {});
  const quiz = findWords(col, dict).find((w) => w.word === 'QUIZ');
  assert.ok(quiz);
  assert.deepEqual(quiz.cells, [0, 5, 10, 15]);
  assert.equal(quiz.score, 10 + 1 + 1 + 10 + 5);
  const diag = createWordState(boardFrom(['XXXXT', 'XXXOX', 'XXNXX', 'XEXXX', 'XXXXX']), {});
  const tone = findWords(diag, dict).find((w) => w.word === 'TONE');
  assert.ok(tone, 'anti-diagonal word');
  assert.deepEqual(tone.cells, [4, 8, 12, 16]);
  const full = createWordState(boardFrom(['HOUSE', 'XXXXX', 'XXXXX', 'XXXXX', 'XXXXX']), {});
  const house = findWords(full, dict).find((w) => w.word === 'HOUSE');
  assert.equal(house.score, 4 + 1 + 1 + 1 + 1 + 15);
  // substrings count too: USE inside HOUSE
  assert.ok(findWords(full, dict).find((w) => w.word === 'USE'));
});

test('locking: tiles stop moving, same cells cannot be locked twice, nudge turns a locked tile wild', () => {
  const board = boardFrom(['CATXX', 'XXXXX', 'XXXXX', 'XXXXX', 'XXXXX']);
  let s = createWordState(board, { A: 1, B: 1 }, 5);
  const cat = findWords(s, dict).find((w) => w.word === 'CAT');
  s = lockWord(s, cat);
  assert.equal(s.score, 5);
  assert.equal(s.turns, 1, 'locking costs a turn');
  assert.deepEqual(s.locked, [0, 1, 2]);
  // locked tiles stay put; the other tiles in the line slide around them
  const slid = applyWordAction(s, { type: 'slide', axis: 'row', index: 0, dir: 1 });
  assert.deepEqual(slid.board.slice(0, 5), ['C', 'A', 'T', 'X', 'X']);
  assert.deepEqual(slideMoves(s, { type: 'slide', axis: 'row', index: 0, dir: 1 }), [{ from: 3, to: 4, wrap: false }, { from: 4, to: 3, wrap: true }]);
  const col = applyWordAction(s, { type: 'slide', axis: 'col', index: 1, dir: 1 });
  assert.equal(col.board[1], 'A', 'locked A stays');
  assert.throws(() => applyWordAction(s, { type: 'swap', r: 0, c: 2, r2: 0, c2: 3 }), /Locked/);
  // a locked tile can be drawn over: it stays locked, only its letter changes
  const drawn = applyWordAction(s, { type: 'draw', r: 0, c: 0 });
  assert.ok(drawn.locked.includes(0));
  assert.ok(drawn.board[0] === 'A' || drawn.board[0] === 'B', 'drawn from the bag');
  assert.equal(drawn.words.length, 1, 'the locked word stays banked');
  const ok = applyWordAction(s, { type: 'slide', axis: 'row', index: 1, dir: 1 });
  assert.equal(ok.turns, 2);
  // the same word cannot be locked again
  const again = findWords(s, dict).find((w) => w.word === 'CAT');
  assert.equal(again.lockable, false);
  assert.match(again.reason, /already locked/);
  assert.throws(() => lockWord(s, again));
  // nudging a locked tile changes its letter normally for one turn; making it wild costs two
  const nudged = applyWordAction(s, { type: 'nudge', r: 0, c: 1, delta: 1 });
  assert.equal(nudged.board[1], 'B');
  assert.equal(nudged.turns, s.turns + 1);
  assert.ok(nudged.locked.includes(1));
  const wild = applyWordAction(s, { type: 'wild', r: 0, c: 1 });
  assert.equal(wild.board[1], WILD);
  assert.equal(wild.turns, s.turns + 2);
  assert.equal(wild.locked.length, 3);
  assert.equal(wild.words.length, 1);
  assert.throws(() => applyWordAction(s, { type: 'wild', r: 0, c: 3 }), /locked/);
  assert.throws(() => applyWordAction(wild, { type: 'wild', r: 0, c: 1 }), /already wild/);
  const found = findWords(wild, dict);
  assert.ok(found.find((w) => w.word === 'COT'), 'wild reads as any letter');
  assert.equal(found.find((w) => w.word === 'COT').score, 3 + 0 + 1, 'wild scores 0');
  // a new word that reuses locked tiles plus a fresh one is lockable (but not the same word twice)
  const cross = createWordState(boardFrom(['CATXX', 'AXXXX', 'RXXXX', 'XXXXX', 'XXXXX']), {});
  let c = lockWord(cross, findWords(cross, dict).find((w) => w.word === 'CAT'));
  const down = findWords(c, dict).find((w) => w.word === 'CAR');
  assert.ok(down.lockable);
  c = lockWord(c, down);
  assert.equal(c.score, 10);
  assert.deepEqual(c.locked.slice().sort((a, b) => a - b), [0, 1, 2, 5, 10]);
});

test('nudge wraps Z to A and A to Z; draw keeps the bag size and never returns the tossed letter that turn', () => {
  assert.equal(nudgeLetter('Z', 1), 'A');
  assert.equal(nudgeLetter('A', -1), 'Z');
  assert.equal(nudgeLetter('M', 1), 'N');
  const board = new Array(CELLS).fill('Q');
  const bag = { A: 3, E: 2 };
  for (let seed = 0; seed < 200; seed++) {
    const s = createWordState(board, bag, seed);
    const n = applyWordAction(s, { type: 'draw', r: 1, c: 1 });
    assert.notEqual(n.board[idx(1, 1)], 'Q');
    assert.equal(bagTotal(n.bag), 5);
    assert.equal(n.bag.Q, 1);
    assert.equal(n.turns, 1);
  }
});

test('scoreWord and share line', () => {
  assert.equal(scoreWord(['Q', 'U', 'I', 'Z', WILD], [0, 1, 2, 3]), 10 + 1 + 1 + 10 + 5);
  assert.equal(wordShareLine(14, [{ word: 'CAT', score: 5 }, { word: 'TONE', score: 9 }]), 'GridLock 14 (CAT 5, TONE 9)');
  assert.equal(wordShareLine(0, []), 'GridLock 0 (no words)');
});

test('a dealt board usually has a few words available', () => {
  let total = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const { board, bag } = dealLetters(seed);
    total += findWords(createWordState(board, bag), dict).length;
  }
  assert.ok(total > 0);
});

test('slide around locked tiles: the tile before a locked last tile wraps; a fully locked line refuses', () => {
  const board = boardFrom(['ABCDE', 'XXXXX', 'XXXXX', 'XXXXX', 'XXXXX']);
  let s = createWordState(board, {});
  s.locked = [4];
  const right = applyWordAction(s, { type: 'slide', axis: 'row', index: 0, dir: 1 });
  assert.deepEqual(right.board.slice(0, 5), ['D', 'A', 'B', 'C', 'E']);
  const left = applyWordAction(s, { type: 'slide', axis: 'row', index: 0, dir: -1 });
  assert.deepEqual(left.board.slice(0, 5), ['B', 'C', 'D', 'A', 'E']);
  s.locked = [1, 3];
  const mid = applyWordAction(s, { type: 'slide', axis: 'row', index: 0, dir: 1 });
  assert.deepEqual(mid.board.slice(0, 5), ['E', 'B', 'A', 'D', 'C']);
  s.locked = [0, 1, 2, 3];
  assert.throws(() => applyWordAction(s, { type: 'slide', axis: 'row', index: 0, dir: 1 }), /Nothing/);
});

test('plural rule: a plural or singular of a locked word cannot be locked', () => {
  assert.ok(isPluralPair('DOOR', 'DOORS'));
  assert.ok(isPluralPair('DOORS', 'DOOR'));
  assert.ok(isPluralPair('BOX', 'BOXES'));
  assert.ok(isPluralPair('CITY', 'CITIES'));
  assert.ok(!isPluralPair('DOOR', 'DOOR'));
  assert.ok(!isPluralPair('CAT', 'COTS'));
  const board = boardFrom(['DOORS', 'XXXXX', 'XXXXX', 'XXXXX', 'XXXXX']);
  let s = createWordState(board, {});
  const doors = findWords(s, dict).find((w) => w.word === 'DOORS');
  const door = findWords(s, dict).find((w) => w.word === 'DOOR');
  assert.ok(doors.lockable && door.lockable);
  s = lockWord(s, door);
  const after = findWords(s, dict).find((w) => w.word === 'DOORS');
  assert.equal(after.lockable, false);
  assert.match(after.reason, /plural/);
  assert.throws(() => lockWord(s, after));
});

test('findWordAt: first and last tap define the word, in either direction', () => {
  const board = boardFrom(['XTACX', 'XXXXX', 'XXXXX', 'XXXXX', 'XXXXX']);
  const s = createWordState(board, {});
  const cat = findWordAt(s, dict, 3, 1);
  assert.equal(cat.word, 'CAT');
  assert.deepEqual(cat.cells, [3, 2, 1]);
  assert.ok(cat.lockable);
  assert.match(findWordAt(s, dict, 1, 3).error, /not in the word list/);
  assert.match(findWordAt(s, dict, 1, 2).error, /at least 3/);
  assert.match(findWordAt(s, dict, 0, 7).error, /row, column or diagonal/);
  assert.match(findWordAt(s, dict, 0, 0).error, /first and last/);
});

test('coverage ladder: +5 per locked tile from the 20th, +30 for all 25, nothing below 20; no penalties', () => {
  assert.equal(coverageBonus(25), 30);
  assert.equal(coverageBonus(24), 25);
  assert.equal(coverageBonus(23), 20);
  assert.equal(coverageBonus(22), 15);
  assert.equal(coverageBonus(21), 10);
  assert.equal(coverageBonus(20), 5);
  assert.equal(coverageBonus(19), 0);
  assert.equal(shortfallPenalty(21), 0);
  assert.equal(shortfallPenalty(0), 0);
  const s = createWordState(new Array(CELLS).fill('A'), {});
  s.score = 30;
  s.locked = new Array(24).fill(0).map((_, i) => i);
  s.turns = WORD_TURNS;
  assert.equal(finalScore(s), 55);
  s.locked = new Array(25).fill(0).map((_, i) => i);
  assert.equal(finalScore(s), 60);
  assert.ok(isBoardFull(s));
  // all 25 locked with turns to spare: +10 per unused turn
  s.turns = 14;
  assert.equal(fullCoverTurnBonus(s), 60);
  assert.equal(finalScore(s), 120);
  s.locked = new Array(24).fill(0).map((_, i) => i);
  assert.equal(fullCoverTurnBonus(s), 0, 'only a full board earns the turn bonus');
  s.locked = new Array(3).fill(0).map((_, i) => i);
  assert.equal(projectedScore(s), 30, 'few tiles: just the word points');
  assert.equal(finalScore(s), 30);
});

test('turn limit: no action or lock once 20 turns are used; wild needs two turns', () => {
  const s = createWordState(boardFrom(['CATXX', 'XXXXX', 'XXXXX', 'XXXXX', 'XXXXX']), {});
  s.turns = WORD_TURNS;
  assert.throws(() => applyWordAction(s, { type: 'slide', axis: 'row', index: 1, dir: 1 }), /No turns/);
  assert.throws(() => lockWord(s, findWords(s, dict).find((w) => w.word === 'CAT')), /No turns/);
  const t = createWordState(boardFrom(['CATXX', 'XXXXX', 'XXXXX', 'XXXXX', 'XXXXX']), {});
  t.locked = [0, 1, 2];
  t.turns = WORD_TURNS - 1;
  assert.throws(() => applyWordAction(t, { type: 'wild', r: 0, c: 0 }), /2 turns/);
  assert.equal(applyWordAction(t, { type: 'nudge', r: 0, c: 0, delta: 1 }).turns, WORD_TURNS);
});

test('6x6: geometry, 25 turns, 6-letter words score +30, the coverage ladder runs from the 29th tile', () => {
  assert.equal(wordLines(6).length, 26, '6 rows, 6 columns, 7 diagonals each way');
  assert.deepEqual(wordLines(6)[15], [0, 7, 14, 21, 28, 35], 'the main diagonal');
  assert.equal(wordLines(6).filter((l) => l.length === 6).length, 14);
  const rows6 = (rs) => rs.join('').split('');
  const s = createWordState(rows6(['LETTER', 'XXXXXX', 'XXXXXX', 'XXXXXX', 'XXXXXX', 'XXXXXX']), {});
  assert.equal(s.size, 6);
  assert.equal(turnLimit(s), 25);
  assert.equal(TURNS_BY_SIZE[5], WORD_TURNS);
  const letter = findWords(s, dict).find((w) => w.word === 'LETTER');
  assert.ok(letter, 'a 6-letter word is found on a 6x6 row');
  assert.deepEqual(letter.cells, [0, 1, 2, 3, 4, 5]);
  assert.equal(letter.score, 6 + 30);
  assert.equal(findWordAt(s, dict, 0, 5).word, 'LETTER');
  // the ladder: +5 per tile from the 29th, +40 for all 36; nothing on 5x5-sized counts
  assert.equal(coverageBonus(36, 6), 40);
  assert.equal(coverageBonus(29, 6), 5);
  assert.equal(coverageBonus(28, 6), 0);
  assert.equal(coverageBonus(25, 6), 0);
  const t = lockWord(s, letter);
  assert.equal(t.turns, 1);
  assert.equal(t.size, 6);
  // a 6x6 row slides with six cells, the locked tiles staying put
  const slid = applyWordAction(t, { type: 'slide', axis: 'row', index: 1, dir: 1 });
  assert.equal(slid.board.length, 36);
  assert.throws(() => applyWordAction(t, { type: 'slide', axis: 'row', index: 0, dir: 1 }), /Nothing/);
  assert.throws(() => applyWordAction(t, { type: 'swap', r: 0, c: 5, r2: 0, c2: 6 }), /out of range/);
  // the full board bonus and turn limit follow the size
  const full = createWordState(new Array(36).fill('A'), {});
  full.score = 10;
  full.locked = Array.from({ length: 36 }, (_, i) => i);
  full.turns = 20;
  assert.ok(isBoardFull(full));
  assert.equal(fullCoverTurnBonus(full), 50, '5 unused turns of 25');
  assert.equal(finalScore(full), 10 + 40 + 50);
  // a 5x5 state never sees 6-letter words even though the dictionary has them
  const five = createWordState(rows6(['LETTE', 'RXXXX', 'XXXXX', 'XXXXX', 'XXXXX']).slice(0, 25), {});
  assert.equal(five.size, 5);
  assert.ok(!findWords(five, dict).some((w) => w.word.length > 5));
});
