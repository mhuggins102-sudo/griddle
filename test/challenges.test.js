import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyWordAction, findWords, findWordAt, lockWord, parseDictionary, turnLimit, actionCost, moveRefusal, wordRuleReason, bagTotal, WILD, LETTER_VALUES, finalScore,
} from '../js/words.js';
import { CHALLENGES, CHALLENGE_BY_ID, challengeState, dealChallenge, trophyFor, nextTarget, betterTrophy, trophyCount, VOWELS } from '../js/challenges.js';
import { botPlayChallenge } from '../js/challengebot.js';
import { emptyPerk } from '../js/perks.js';

const dict = parseDictionary(readFileSync(new URL('../data/words.txt', import.meta.url), 'utf8'));
const rows = (...r) => r.join('').split('');
const base = (rowsArr, extra = {}) => ({ size: 5, board: rows(...rowsArr), bag: { A: 2, E: 2, S: 2 }, rngState: 7, turns: 0, locked: [], words: [], score: 0, wilds: 0, ...extra });
const lockAt = (st, a, b) => lockWord(st, findWordAt(st, dict, a, b));

test('rules: a turn count of its own, free moves, a move allow-list', () => {
  const st = base(['CATXX', 'DOGXX', 'XXXXX', 'XXXXX', 'XXXXX'], { rules: { turns: 12 } });
  assert.equal(turnLimit(st), 12);
  assert.equal(turnLimit({ ...st, perk: { ...emptyPerk(), extraTurns: 2 } }), 14, 'extra turns still add');
  const free = base(['CATXX', 'DOGXX', 'XXXXX', 'XXXXX', 'XXXXX'], { rules: { turns: 8, freeMoves: true } });
  assert.equal(actionCost({ type: 'swap' }, free), 0);
  assert.equal(actionCost({ type: 'slide' }, free), 0);
  assert.equal(actionCost({ type: 'nudge' }, free), 1, 'a nudge still costs: free nudges would spell anything');
  assert.equal(actionCost({ type: 'draw' }, free), 1, 'a draw still spends a turn');
  assert.equal(actionCost({ type: 'wild' }, free), 2);
  assert.equal(actionCost({ type: 'swap' }, st), 1);
  assert.equal(actionCost({ type: 'swap' }), 1, 'without a state: the plain cost');
  const moved = applyWordAction(free, { type: 'swap', r: 0, c: 3, r2: 0, c2: 4 });
  assert.equal(moved.turns, 0, 'a free swap costs nothing');
  assert.equal(lockAt(moved, 0, 2).turns, 1, 'a lock still costs one');
  const dip = base(['CATXX', 'DOGXX', 'XXXXX', 'XXXXX', 'XXXXX'], { rules: { moves: ['draw'] } });
  assert.match(moveRefusal(dip, 'swap'), /Swaps are off/);
  assert.match(moveRefusal(dip, 'slide'), /Flicks are off/);
  assert.match(moveRefusal(dip, 'nudge'), /Nudges are off/);
  assert.equal(moveRefusal(dip, 'draw'), '');
  assert.throws(() => applyWordAction(dip, { type: 'swap', r: 0, c: 3, r2: 0, c2: 4 }), /Swaps are off in this challenge/);
  assert.throws(() => applyWordAction(dip, { type: 'slide', axis: 'row', index: 4, dir: 1 }), /Flicks are off/);
  assert.equal(applyWordAction(dip, { type: 'draw', r: 4, c: 4 }).turns, 1, 'a draw goes through');
  assert.equal(lockAt(dip, 0, 2).score, 5, 'locking is never a move');
  assert.equal(moveRefusal(base(['CATXX', 'DOGXX', 'XXXXX', 'XXXXX', 'XXXXX']), 'swap'), '', 'no rules: everything allowed');
  const rotor = base(['CATXX', 'DOGXX', 'XXXXX', 'XXXXX', 'XXXXX'], { rules: { moves: [], rotor: true } });
  for (const t of ['swap', 'slide', 'nudge', 'draw', 'wild']) assert.ok(moveRefusal(rotor, t), t);
});

test('word rules: length, direction, lines, the centre, chaining, fresh tiles, double letters', () => {
  // CAT / CATS along the top, TEEN down column 3 through the centre, PEN on the diagonal through the centre, STRAP along the bottom (PARTS backwards)
  const B = ['CATSX', 'XXEPX', 'XXEXX', 'XNNXX', 'STRAP'];
  const with_ = (words) => base(B, { rules: { words } });
  const find = (st, word) => findWords(st, dict).find((w) => w.word === word);
  const cat = (st) => find(st, 'CAT');
  // length
  assert.match(cat(with_({ minLen: 4 })).reason, /4 letters or more/);
  assert.equal(find(with_({ minLen: 4 }), 'CATS').lockable, true);
  assert.match(find(with_({ exactLen: 5 }), 'CATS').reason, /only 5-letter words/);
  assert.equal(find(with_({ exactLen: 5 }), 'STRAP').lockable, true);
  // backward: the bottom row STRAP read right to left is PARTS
  const mirror = with_({ backward: true });
  const parts = find(mirror, 'PARTS');
  assert.ok(parts && parts.lockable, 'PARTS read right to left counts');
  assert.deepEqual(parts.cells, [24, 23, 22, 21, 20]);
  assert.match(find(mirror, 'STRAP').reason, /backwards/);
  assert.match(cat(mirror).reason, /backwards/);
  // lines
  assert.match(cat(with_({ lines: 'diag' })).reason, /diagonal/);
  assert.equal(find(with_({ lines: 'diag' }), 'PEN').lockable, true, 'a diagonal word counts');
  assert.equal(cat(with_({ lines: 'row' })).lockable, true);
  assert.match(find(with_({ lines: 'row' }), 'TEEN').reason, /along a row/);
  assert.equal(find(with_({ lines: 'col' }), 'TEEN').lockable, true);
  assert.match(cat(with_({ lines: 'col' })).reason, /down a column/);
  const edge = with_({ lines: 'edge' });
  assert.equal(cat(edge).lockable, true, 'the top row is an edge');
  assert.equal(find(edge, 'STRAP').lockable, true);
  assert.match(find(edge, 'TEEN').reason, /edge/);
  assert.match(find(edge, 'PEN').reason, /edge/);
  // through the centre (cell 12)
  const bull = with_({ through: 12 });
  assert.match(cat(bull).reason, /centre tile/);
  assert.equal(find(bull, 'TEEN').lockable, true, 'TEEN down column 3 uses the centre');
  assert.equal(find(bull, 'PEN').lockable, true);
  // chain: the first word is free, the next must cross a locked word
  const chain = with_({ chain: true });
  assert.equal(cat(chain).lockable, true);
  const afterCat = lockAt(chain, 0, 2);
  assert.match(find(afterCat, 'STRAP').reason, /cross a locked word/);
  assert.equal(find(afterCat, 'TEEN').lockable, true, 'TEEN reuses the T');
  assert.match(find(afterCat, 'CATS').reason, /with an ending/, 'the ending rule still applies');
  // fresh: no locked tile at all
  const fresh = lockAt(with_({ fresh: true }), 0, 2);
  assert.match(find(fresh, 'TEEN').reason, /no locked tile/);
  assert.equal(find(fresh, 'STRAP').lockable, true);
  // double letters
  const twins = with_({ doubleLetter: true });
  assert.match(cat(twins).reason, /double letter/);
  assert.equal(find(twins, 'TEEN').lockable, true);
  assert.equal(wordRuleReason(base(B), 'CAT', [0, 1, 2]), '', 'no rules, no reason');
});

test('the catalogue: unique ids, every challenge deals a playable board under its own rule', () => {
  assert.equal(CHALLENGES.length, 38);
  assert.equal(new Set(CHALLENGES.map((c) => c.id)).size, 38);
  for (const c of CHALLENGES) {
    assert.ok(c.name && c.tag && c.text, c.id);
    const st = challengeState(c, 99);
    assert.equal(st.board.length, 25, c.id);
    assert.ok(Object.values(st.bag).every((n) => n >= 0), `${c.id}: bag counts`);
    assert.ok(st.board.every((t) => t === WILD || LETTER_VALUES[t]), `${c.id}: letters`);
    assert.equal(st.turns, 0);
    if (c.targets) assert.ok(c.targets[0] < c.targets[1] && c.targets[1] < c.targets[2], `${c.id}: targets climb`);
    const same = challengeState(c, 5);
    assert.deepEqual(same.board, st.board, `${c.id}: the board is fixed`);
    assert.equal(same.rngState, 5, 'the draws follow the draw seed');
  }
  const words = (c) => findWords(challengeState(c, 1), dict).filter((w) => w.lockable);
  assert.ok(words(CHALLENGE_BY_ID.mirror).length > 0 && words(CHALLENGE_BY_ID.mirror).every((w) => w.cells[0] > w.cells[w.cells.length - 1]));
  assert.ok(words(CHALLENGE_BY_ID.slant).length > 0);
});

test('deals: vowels, bags, Qs, wilds, boulders and the locked word', () => {
  const drought = challengeState(CHALLENGE_BY_ID.drought, 1);
  assert.ok(drought.board.every((t) => !VOWELS.includes(t)));
  assert.ok(VOWELS.some((v) => drought.bag[v] > 0), 'the bag still has vowels');
  const dry = challengeState(CHALLENGE_BY_ID['dry-well'], 1);
  assert.ok(VOWELS.every((v) => dry.bag[v] === 0) && bagTotal(dry.bag) > 20);
  const flood = challengeState(CHALLENGE_BY_ID['vowel-flood'], 1);
  assert.ok(Object.entries(flood.bag).every(([ch, n]) => n === 0 || VOWELS.includes(ch)) && bagTotal(flood.bag) > 20);
  const heavy = challengeState(CHALLENGE_BY_ID['heavy-metal'], 1);
  assert.ok(Object.entries(heavy.bag).every(([ch, n]) => n === 0 || LETTER_VALUES[ch] >= 4) && bagTotal(heavy.bag) === 26);
  const penny = challengeState(CHALLENGE_BY_ID['penny-tiles'], 1);
  assert.ok(penny.board.every((t) => LETTER_VALUES[t] === 1) && Object.entries(penny.bag).every(([ch, n]) => n === 0 || LETTER_VALUES[ch] === 1));
  assert.equal(bagTotal(challengeState(CHALLENGE_BY_ID['what-you-see'], 1).bag), 0);
  assert.throws(() => applyWordAction(challengeState(CHALLENGE_BY_ID['what-you-see'], 1), { type: 'draw', r: 0, c: 0 }), /empty/);
  const q = challengeState(CHALLENGE_BY_ID.quandary, 1);
  assert.equal(q.board.filter((t) => t === 'Q').length, 3);
  assert.ok(!q.board.includes('U') && q.bag.U === 0);
  const stamp = challengeState(CHALLENGE_BY_ID.stamp, 1);
  assert.equal(stamp.bag.S, 30);
  assert.equal(bagTotal(stamp.bag), 30);
  const stamped = applyWordAction(stamp, { type: 'draw', r: 0, c: 0 });
  assert.equal(stamped.board[0], 'S');
  assert.equal(bagTotal(stamped.bag), 29, 'the tossed letter does not join a bag of S');
  assert.ok(Object.entries(stamped.bag).every(([ch, n]) => n === 0 || ch === 'S'));
  let fl = flood;
  for (let k = 0; k < 6; k++) fl = applyWordAction(fl, { type: 'draw', r: 0, c: k % 5 });
  assert.ok(Object.entries(fl.bag).every(([ch, n]) => n === 0 || VOWELS.includes(ch)), 'Vowel Flood keeps consonants out of the bag');
  assert.equal(applyWordAction(challengeState(CHALLENGE_BY_ID.blitz, 1), { type: 'draw', r: 0, c: 0 }).bag[challengeState(CHALLENGE_BY_ID.blitz, 1).board[0]], challengeState(CHALLENGE_BY_ID.blitz, 1).bag[challengeState(CHALLENGE_BY_ID.blitz, 1).board[0]] + 1, 'without a bag rule the tossed letter goes back');
  const jokers = challengeState(CHALLENGE_BY_ID['three-jokers'], 1);
  assert.deepEqual([6, 13, 16].map((c) => jokers.board[c]), [WILD, WILD, WILD]);
  assert.ok(findWords(jokers, dict).some((w) => w.cells.includes(6)), 'a word can read through a wild');
  assert.equal(jokers.wilds, 0, 'the player may still make one wild');
  const boulders = challengeState(CHALLENGE_BY_ID.boulders, 1);
  assert.deepEqual(boulders.locked, [1, 8, 12, 16, 23]);
  assert.equal(boulders.words.length, 0);
  assert.throws(() => applyWordAction(boulders, { type: 'swap', r: 0, c: 0, r2: 0, c2: 1 }), /Locked/);
  const build = challengeState(CHALLENGE_BY_ID['build-around'], 1);
  assert.deepEqual(build.board.slice(10, 15), ['W', 'A', 'L', 'T', 'Z']);
  assert.deepEqual(build.locked, [10, 11, 12, 13, 14]);
  assert.equal(build.score, 32);
  assert.equal(build.words[0].word, 'WALTZ');
  assert.equal(finalScore(build), 32);
  assert.ok(findWords(build, dict).every((w) => w.word !== 'WALTZ' || !w.lockable), 'the banked word cannot be locked again');
  const hot = challengeState(CHALLENGE_BY_ID['hot-spots'], 1);
  assert.deepEqual(hot.perk.stickers, { 6: 5, 8: 5, 16: 5, 18: 5 });
  const prem = challengeState(CHALLENGE_BY_ID['premium-squares'], 1);
  assert.equal(prem.perk.squares[0], 3);
  assert.equal(prem.perk.squares[12], 2);
  assert.equal(challengeState(CHALLENGE_BY_ID.clairvoyant, 1).perk.peek, true);
  assert.equal(challengeState(CHALLENGE_BY_ID['pick-of-three'], 1).perk.choiceDraw, true);
  assert.equal(turnLimit(challengeState(CHALLENGE_BY_ID.blitz, 1)), 12);
  assert.equal(turnLimit(challengeState(CHALLENGE_BY_ID.marathon, 1)), 32);
  assert.equal(turnLimit(challengeState(CHALLENGE_BY_ID['eight-words'], 1)), 8);
  const dealt = dealChallenge(CHALLENGE_BY_ID.slant);
  assert.equal(dealt.locked, null);
});

test('a wild read by tapping resolves to a word that can be locked, not merely the most common fit', () => {
  const st = base(['HEL*X', 'XXXXX', 'XXXXX', 'XXXXX', 'XXXXX'], { rules: { words: { doubleLetter: true } } });
  const cand = findWordAt(st, dict, 0, 3);
  assert.equal(cand.word, 'HELL', 'HELP is more common but ruled out');
  assert.equal(cand.lockable, true);
  const plain = base(['HEL*X', 'XXXXX', 'XXXXX', 'XXXXX', 'XXXXX']);
  assert.equal(findWordAt(plain, dict, 0, 3).word, 'HELP', 'without rules the most common fit');
  const afterHelp = lockAt(plain, 0, 3);
  assert.equal(findWordAt(afterHelp, dict, 0, 3).lockable, false, 'the same tiles cannot be locked again as the same word');
});

test('trophies: thresholds, the next target, the better of two, the count', () => {
  const ch = { id: 'x', targets: [100, 150, 200] };
  assert.equal(trophyFor(ch, 99), null);
  assert.equal(trophyFor(ch, 100), 'bronze');
  assert.equal(trophyFor(ch, 199), 'silver');
  assert.equal(trophyFor(ch, 200), 'gold');
  assert.equal(trophyFor({ id: 'y', targets: null }, 500), null, 'no targets yet: no trophy');
  assert.deepEqual(nextTarget(ch, 120), { name: 'silver', value: 150 });
  assert.equal(nextTarget(ch, 250), null);
  assert.equal(betterTrophy('silver', 'gold'), 'gold');
  assert.equal(betterTrophy('bronze', null), 'bronze');
  assert.equal(betterTrophy(null, null), null);
  const word = { challenges: { 'slant-bonus': { best: 10, trophy: 'gold' }, mirror: { best: 5, trophy: 'bronze' }, nothing: { trophy: 'gold' } } };
  assert.deepEqual(trophyCount(word), { gold: 1, silver: 0, bronze: 1, total: 2, of: 38 });
  assert.deepEqual(trophyCount(null), { gold: 0, silver: 0, bronze: 0, total: 0, of: 38 });
});

test('the challenge bot keeps to each challenge\'s rules', () => {
  const play = (id, seed = 3) => botPlayChallenge(challengeState(CHALLENGE_BY_ID[id], seed), dict, seed, { noise: 0 });
  const dip = play('lucky-dip');
  assert.ok(dip.log.every((l) => l.startsWith('lock') || l.startsWith('draw')), dip.log.join(' | '));
  assert.ok(dip.log.some((l) => l.startsWith('draw')), 'it draws');
  const belt = play('conveyor');
  assert.ok(belt.log.every((l) => l.startsWith('lock') || l.includes('"slide"')), belt.log.join(' | '));
  const rotor = play('rotor');
  assert.ok(rotor.log.every((l) => l.startsWith('lock') || l.startsWith('rotate')), rotor.log.join(' | '));
  assert.ok(rotor.score > 0);
  const eight = play('eight-words');
  assert.ok(eight.turnsUsed <= 8 && eight.words.length <= 8);
  const mirror = play('mirror');
  assert.ok(mirror.words.length > 0);
  const three = play('pick-of-three');
  assert.ok(three.log.every((l) => !l.startsWith('draw ')), 'every draw is a pick of three');
  const still = play('what-you-see');
  assert.ok(still.log.every((l) => !l.startsWith('draw')));
  for (const c of CHALLENGES) {
    const r = play(c.id, 11);
    assert.ok(r.score >= 0 && r.turnsUsed <= turnLimit(challengeState(c, 11)), c.id);
  }
});
