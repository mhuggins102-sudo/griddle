import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  dealLetters, createWordState, applyWordAction, lockWord, findWordAt, parseDictionary, bagTotal, turnLimit, fullCoverTurnBonus,
  coverageBonusFor, perkExtras, scoreWord, finalScore, WILD, LETTERS,
} from '../js/words.js';
import {
  CARDS, CARD_BY_ID, FAMILIES, emptyPerk, newPerkRun, beginLevel, goldForPass, shopOrder, cardCost,
  playBlock, rotateBlocks, bigNudgeOptions, peekDraws, applyPerkAction, powerPairCells, perkSummary, perkLabel, shopBuyBlock, shopTake,
} from '../js/perks.js';

const dict = parseDictionary(readFileSync(new URL('../data/words.txt', import.meta.url), 'utf8'));

function stateWith(rows, extra = {}) {
  const board = rows.join('').split('');
  const bag = {};
  for (const ch of LETTERS) bag[ch] = 2;
  const st = createWordState(board, bag, 7);
  st.perk = emptyPerk();
  return Object.assign(st, extra);
}
const sum = (bag) => bagTotal(bag);
const lock = (st, first, last) => lockWord(st, findWordAt(st, dict, first, last));

test('catalogue: 29 unique cards priced 3 to 12 averaging about 6, a few cheaper on 6x6, every family represented', () => {
  assert.equal(CARDS.length, 29);
  assert.equal(new Set(CARDS.map((c) => c.id)).size, 29);
  const avg = CARDS.reduce((a, c) => a + c.cost, 0) / CARDS.length;
  assert.ok(avg > 5.3 && avg < 6.2, String(avg));
  assert.equal(CARD_BY_ID['gold-rush'].cost, 3);
  assert.equal(cardCost('long-haul', 5), 8);
  assert.equal(cardCost('long-haul', 6), 5);
  assert.equal(cardCost('pick-letter', 6), 5);
  assert.equal(cardCost('letter-trade', 6), 6);
  assert.equal(cardCost('wild-card', 6), 9, 'no 6x6 price: the 5x5 one');
  assert.equal(cardCost(CARD_BY_ID['head-start']), 3);
  assert.deepEqual([CARD_BY_ID['borrowed-time'].cost, CARD_BY_ID['power-pair'].cost, CARD_BY_ID['short-stack'].cost, CARD_BY_ID.exchange.cost, CARD_BY_ID['fresh-line'].cost, CARD_BY_ID['choice-draw'].cost], [12, 5, 4, 4, 4, 4]);
  for (const id of ['long-swap', 'rotate', 'big-nudge', 'pick-letter', 'wild-card']) assert.equal(CARD_BY_ID[id].turn, 1, `${id} costs a turn`);
  assert.equal(CARD_BY_ID.unlock.turn, 0);
  for (const c of CARDS) {
    assert.ok(c.cost >= 3 && c.cost <= 12, `${c.id} costs ${c.cost}`);
    if (c.cost6 !== undefined) assert.ok(c.cost6 >= 3 && c.cost6 < c.cost, `${c.id} costs ${c.cost6} on 6x6`);
    assert.ok(FAMILIES[c.family], `${c.id} family`);
    assert.ok(c.text.length > 20 && c.name, c.id);
    assert.ok(['none', 'tile', 'pair', 'block', 'multi', 'line', 'flick'].includes(c.target), c.id);
  }
  assert.equal(perkLabel('squares'), 'Letter squares');
  assert.equal(perkLabel('open-field'), 'Open Field');
});

test('a new run: no gold, every card on sale, prices by its board size', () => {
  const run = newPerkRun(6);
  assert.equal(run.size, 6);
  assert.equal(run.gold, 0);
  assert.equal(run.deck.length, 29);
  assert.deepEqual(run.levelStart, { gold: 0, deck: run.deck });
});

test('shop: a card is bought once per run, for its price, and leaves the deck', () => {
  const run = newPerkRun(6);
  assert.match(shopBuyBlock(run, 'fresh-deal'), /Needs 3 more gold/);
  run.gold = 10;
  assert.equal(shopBuyBlock(run, 'fresh-deal'), '');
  shopTake(run, 'fresh-deal');
  assert.equal(run.gold, 7);
  assert.equal(shopBuyBlock(run, 'long-haul'), '', 'Long Haul costs 5 on 6x6');
  shopTake(run, 'long-haul');
  assert.equal(run.gold, 2);
  const five = newPerkRun(5);
  five.gold = 7;
  assert.match(shopBuyBlock(five, 'long-haul'), /Needs 1 more gold/, 'and 8 on 5x5');
  assert.ok(!run.deck.includes('fresh-deal'));
  assert.equal(shopBuyBlock(run, 'fresh-deal'), 'Used');
  assert.throws(() => shopTake(run, 'fresh-deal'), /Used/);
  assert.equal(shopBuyBlock(run, 'nope'), 'Unknown card');
});

test('beginLevel remembers the gold and the shop; gold is the spare turns, extra turns included, doubled by Gold Rush', () => {
  const run = newPerkRun();
  run.gold = 20;
  run.deck = ['hint'];
  run.goldRush = true;
  beginLevel(run);
  assert.equal(run.goldRush, false);
  assert.deepEqual(run.levelStart, { gold: 20, deck: ['hint'] });
  const st = stateWith(['ABCDE', 'FGHIJ', 'KLMNO', 'PQRST', 'UVWXY'], { turns: 14 });
  assert.equal(goldForPass(st, run), 6);
  run.goldRush = true;
  assert.equal(goldForPass(st, run), 12);
  run.goldRush = false;
  st.perk.extraTurns = 2;
  assert.equal(turnLimit(st), 22);
  assert.equal(goldForPass(st, run), 8, 'turns a card added count like any other');
});

test('engine hooks: extra turns count for the full-board bonus, head start capped at the full board', () => {
  const st = stateWith(['CATXX', 'XXXXX', 'XXXXX', 'XXXXX', 'XXXXX']);
  assert.equal(turnLimit(st), 20);
  st.perk.extraTurns = 1;
  assert.equal(turnLimit(st), 21);
  st.locked = Array.from({ length: 25 }, (_, i) => i);
  st.turns = 15;
  assert.equal(fullCoverTurnBonus(st), 60, 'the extra turn is a spare turn like any other');
  st.perk.headStart = true;
  assert.equal(coverageBonusFor(st), 36, 'never past the full board');
  st.locked = Array.from({ length: 19 }, (_, i) => i);
  assert.equal(coverageBonusFor(st), 1, 'the ladder starts a tile early');
});

test('extras: squares pay once, stickers every word, word bonuses wait for a qualifying word, board-wide bonuses add', () => {
  const st = stateWith(['CATXX', 'XRXXX', 'XTXXX', 'XXXXX', 'XXXXX']);
  st.perk.squares = { 0: 3, 1: 2 }; // C x3, A x2
  st.perk.stickers = { 1: 5 };
  st.perk.double = true;
  const ex = perkExtras(st, [0, 1, 2]);
  assert.deepEqual(ex, [{ card: 'squares', pts: 3 * 2 + 1 }, { card: 'sticker', pts: 5 }, { card: 'double-down', pts: 5 }]);
  const locked = lock(st, 0, 2);
  assert.equal(locked.words[0].score, scoreWord(st.board, [0, 1, 2]) + 17);
  assert.deepEqual(locked.words[0].extras, ex);
  assert.equal(locked.perkPoints, 17);
  assert.deepEqual(locked.perk.squares, {}, 'a square pays once');
  assert.deepEqual(locked.perk.stickers, { 1: 5 }, 'a sticker stays');
  assert.equal(locked.perk.double, false, 'spent on the next lock');
  assert.equal(locked.perk.log.length, 3);
  assert.deepEqual(perkSummary(locked).map((x) => [x.card, x.pts]), [['squares', 7], ['sticker', 5], ['double-down', 5]]);
  const again = lock(locked, 1, 11);
  assert.equal(again.words[1].word, 'ART');
  assert.deepEqual(again.words[1].extras, [{ card: 'sticker', pts: 5 }], 'the sticker pays the next word through its cell too');
  // double down is not capped, and can wait alongside a stretch bonus
  const dd = stateWith(['QUIZX', 'XXXXX', 'XXXXX', 'XXXXX', 'XXXXX']);
  dd.perk.double = true;
  dd.perk.stretch = true;
  assert.deepEqual(perkExtras(dd, [0, 1, 2, 3]), [{ card: 'double-down', pts: 22 }, { card: 'stretch', pts: 10 }]);
  // stretch waits for 4 letters and pays one rung up
  const lw = stateWith(['CATSX', 'XXXXX', 'XXXXX', 'XXXXX', 'XXXXX']);
  lw.perk.stretch = true;
  assert.deepEqual(perkExtras(lw, [0, 1, 2]), []);
  const stillWaiting = lock(lw, 0, 2);
  assert.equal(stillWaiting.perk.stretch, true, 'a 3-letter word leaves it waiting');
  assert.deepEqual(perkExtras(lw, [0, 1, 2, 3]), [{ card: 'stretch', pts: 10 }]);
  const five = stateWith(['ZESTY', 'XXXXX', 'XXXXX', 'XXXXX', 'XXXXX']);
  five.perk.stretch = true;
  assert.deepEqual(perkExtras(five, [0, 1, 2, 3, 4]), [{ card: 'stretch', pts: 15 }]);
  five.perk.stretch = false;
  five.perk.longHaul = true;
  assert.deepEqual(perkExtras(five, [0, 1, 2, 3, 4]), [{ card: 'long-haul', pts: 8 }], 'a word the width of the board');
  assert.deepEqual(perkExtras(five, [0, 1, 2]), []);
  // crossroads needs a reused locked tile, open field the opposite, short stack a 3-letter word, diagonal a diagonal
  const cr = stateWith(['CATXX', 'XOXXX', 'XXTXX', 'XXXXX', 'XXXXX']);
  cr.perk.crossroads = true;
  cr.perk.openField = true;
  cr.perk.shortStack = true;
  cr.perk.diagonal = true;
  assert.deepEqual(perkExtras(cr, [0, 1, 2]), [{ card: 'open-field', pts: 4 }, { card: 'short-stack', pts: 3 }]);
  const one = lock(cr, 0, 2);
  assert.deepEqual(perkExtras(one, [0, 6, 12]), [{ card: 'crossroads', pts: 2 }, { card: 'short-stack', pts: 3 }, { card: 'diagonal', pts: 5 }]);
  const four = stateWith(['DOGSX', 'XXXXX', 'XXXXX', 'XXXXX', 'XXXXX']);
  four.perk.shortStack = true;
  assert.deepEqual(perkExtras(four, [0, 1, 2, 3]), [], 'short stack pays 3-letter words only');
});

test('perk actions: long swap, rotate, big nudge, pick a letter, unlock, trade, wild card, squares, sticker, encore, flags, turns', () => {
  const st = stateWith(['CATXX', 'DOGXX', 'XXXXX', 'XXXXX', 'XXXXX']);
  const sw = applyPerkAction(st, { type: 'pswap', a: 0, b: 4 });
  assert.equal(sw.board.join('').slice(0, 5), 'XATXC');
  assert.equal(sw.turns, 1, 'a long swap costs a turn');
  assert.throws(() => applyPerkAction(st, { type: 'pswap', a: 0, b: 0 }), /different/);
  const ro = applyPerkAction(st, { type: 'rotate', cell: 0 });
  assert.equal(ro.board.slice(0, 2).join('') + ro.board.slice(5, 7).join(''), 'DCOA', 'clockwise quarter turn');
  assert.equal(ro.turns, 1);
  const half = applyPerkAction(st, { type: 'rotate', cell: 0, turns: 2 });
  assert.equal(half.board.slice(0, 2).join('') + half.board.slice(5, 7).join(''), 'ODAC', 'half turn');
  const tq = applyPerkAction(st, { type: 'rotate', cell: 0, turns: 3 });
  assert.equal(tq.board.slice(0, 2).join('') + tq.board.slice(5, 7).join(''), 'AOCD', 'three-quarter turn');
  assert.throws(() => applyPerkAction(st, { type: 'rotate', cell: 0, turns: 4 }), /quarter/);
  assert.ok(rotateBlocks(st).includes(0));
  const nu = applyPerkAction(st, { type: 'setletter', cell: 0, letter: 'F' });
  assert.equal(nu.board[0], 'F');
  assert.equal(nu.turns, 1, 'a big nudge costs a turn');
  assert.throws(() => applyPerkAction(st, { type: 'setletter', cell: 0, letter: 'K' }), /three letters/);
  assert.deepEqual(bigNudgeOptions('B'), ['Y', 'Z', 'A', 'C', 'D', 'E']);
  const pk = applyPerkAction(st, { type: 'setletter', cell: 0, letter: 'Q', fromBag: true });
  assert.equal(pk.board[0], 'Q');
  assert.equal(pk.bag.Q, st.bag.Q - 1);
  assert.equal(pk.bag.C, st.bag.C + 1);
  assert.equal(sum(pk.bag), sum(st.bag));
  assert.equal(pk.turns, 1, 'picking a letter costs a turn');
  const lockedSt = lock(st, 0, 2);
  assert.throws(() => applyPerkAction(lockedSt, { type: 'setletter', cell: 0, letter: 'Q', fromBag: true }), /locked/);
  const un = applyPerkAction(lockedSt, { type: 'unlock', cell: 1 });
  assert.deepEqual(un.locked, [0, 2]);
  assert.equal(un.score, lockedSt.score);
  assert.equal(un.words.length, 1);
  assert.equal(un.turns, lockedSt.turns, 'unlock is free');
  const tr = applyPerkAction(lockedSt, { type: 'trade', a: 0, b: 5 });
  assert.equal(tr.board[0], 'D');
  assert.equal(tr.board[5], 'C');
  assert.deepEqual(tr.locked, lockedSt.locked, 'locks stay with the tiles');
  assert.equal(tr.turns, lockedSt.turns + 1);
  const wc = applyPerkAction(lockedSt, { type: 'wildcard', cell: 0 });
  assert.equal(wc.board[0], WILD);
  assert.equal(wc.wilds || 0, 0, 'does not count against the one wild per board');
  assert.equal(wc.turns, lockedSt.turns + 1, 'one turn, not the two of a normal wild');
  const sq = applyPerkAction(st, { type: 'squares', cells: [{ cell: 3, mult: 2 }, { cell: 4, mult: 3 }] });
  assert.deepEqual(sq.perk.squares, { 3: 2, 4: 3 });
  assert.throws(() => applyPerkAction(lockedSt, { type: 'squares', cells: [{ cell: 0, mult: 2 }] }), /locked/);
  const stk = applyPerkAction(st, { type: 'sticker', cell: 3 });
  assert.deepEqual(stk.perk.stickers, { 3: 5 });
  const fl = applyPerkAction(st, { type: 'flag', key: 'double', value: true });
  assert.equal(fl.perk.double, true);
  assert.equal(applyPerkAction(st, { type: 'flag', key: 'shortStack', value: true }).perk.shortStack, true);
  assert.throws(() => applyPerkAction(st, { type: 'flag', key: 'gold', value: 1 }), /Unknown/);
  const tu = applyPerkAction(st, { type: 'turns', n: 2 });
  assert.equal(turnLimit(tu), 22);
  assert.equal(st.perk.extraTurns, 0, 'input untouched');
});

test('perk actions: choice draw, exchange, fresh line and slide2 keep the bag whole and match the engine draws', () => {
  const { board, bag } = dealLetters(11);
  const st = createWordState(board, bag, 99);
  st.perk = emptyPerk();
  const peek = peekDraws(st, 3);
  assert.equal(peek.length, 3);
  assert.equal(applyWordAction(st, { type: 'draw', r: 0, c: 0 }).board[0], peek[0], 'Peek shows exactly the engine draw');
  const d3 = applyPerkAction(st, { type: 'draw3', cell: 0, pick: 1 });
  assert.equal(d3.board[0], peek[1]);
  assert.equal(sum(d3.bag), sum(st.bag));
  assert.equal(d3.turns, 1);
  assert.deepEqual(d3.lastDraw.options, peek);
  assert.notEqual(d3.rngState, st.rngState);
  assert.throws(() => applyPerkAction(st, { type: 'draw3', cell: 0, pick: 5 }), /Pick one/);
  const ex = applyPerkAction(st, { type: 'exchange', cells: [0, 1, 2] });
  assert.equal(sum(ex.bag), sum(st.bag));
  assert.equal(ex.turns, 1);
  assert.equal(ex.lastRedraw.length, 3);
  assert.throws(() => applyPerkAction(st, { type: 'exchange', cells: [0, 1, 2, 3] }), /one to three/);
  const locked = lockWord(st, { word: 'XYZ', cells: [5, 6, 7], key: '5,6,7', score: 1, lockable: true });
  const fl = applyPerkAction(locked, { type: 'freshline', axis: 'row', index: 1 });
  assert.equal(fl.lastRedraw.length, 2, 'only the unlocked tiles of the row');
  assert.equal(fl.board[5], locked.board[5]);
  assert.equal(sum(fl.bag), sum(locked.bag));
  const one = applyWordAction(applyWordAction(locked, { type: 'slide', axis: 'row', index: 2, dir: 1 }), { type: 'slide', axis: 'row', index: 2, dir: 1 });
  const two = applyPerkAction(locked, { type: 'slideN', axis: 'row', index: 2, dir: 1, steps: 2 });
  assert.deepEqual(two.board, one.board);
  assert.equal(two.turns, locked.turns + 1);
  const three = applyPerkAction(locked, { type: 'slideN', axis: 'row', index: 2, dir: 1, steps: 3 });
  assert.deepEqual(three.board, applyWordAction(one, { type: 'slide', axis: 'row', index: 2, dir: 1 }).board, 'three steps are three slides');
  assert.throws(() => applyPerkAction(locked, { type: 'slideN', axis: 'row', index: 2, dir: 1, steps: 5 }), /6 unlocked/);
  assert.throws(() => applyPerkAction(locked, { type: 'slideN', axis: 'row', index: 2, dir: 1, steps: 1 }), /Two steps/);
  assert.throws(() => applyPerkAction(locked, { type: 'slideN', axis: 'row', index: 1, dir: 1, steps: 2 }), /3 unlocked/);
});

test('playability reasons and power pair picks', () => {
  const st = stateWith(['CATXX', 'DOGXX', 'XXXXX', 'XXXXX', 'XXXXX']);
  assert.equal(playBlock('fresh-deal', st, { historyLength: 0 }), '');
  assert.match(playBlock('fresh-deal', st, { historyLength: 1 }), /first move/);
  assert.match(playBlock('unlock', st), /Nothing is locked/);
  assert.match(playBlock('open-field', { ...st, perk: { ...st.perk, openField: true } }), /Already/);
  assert.match(playBlock('rewind', st, { historyLength: 0 }), /Nothing to take back/);
  assert.equal(playBlock('rewind', st, { historyLength: 2 }), '');
  st.perk.stretch = true;
  assert.match(playBlock('stretch', st), /Already waiting/);
  assert.equal(playBlock('double-down', st), '', 'the two bonuses wait independently');
  st.turns = 20;
  assert.match(playBlock('letter-trade', st), /Needs 1 turn left/);
  assert.match(playBlock('extra-turn', st), /spent/);
  assert.equal(playBlock('hint', st), '');
  const pair = powerPairCells(stateWith(['CATXX', 'XXXXX', 'XXXXX', 'XXXXX', 'XXXXX']), () => 0);
  assert.deepEqual(pair, [{ cell: 0, mult: 2 }, { cell: 1, mult: 3 }]);
  const full = stateWith(['CATXX', 'XXXXX', 'XXXXX', 'XXXXX', 'XXXXX'], { locked: Array.from({ length: 24 }, (_, i) => i) });
  assert.equal(powerPairCells(full), null);
  assert.equal(finalScore(st), 0);
});

test('the shop lists the catalogue by family or by price', () => {
  const byType = shopOrder('type');
  const families = Object.keys(FAMILIES);
  for (let i = 1; i < byType.length; i++) {
    const a = byType[i - 1];
    const b = byType[i];
    const fa = families.indexOf(a.family);
    const fb = families.indexOf(b.family);
    assert.ok(fa < fb || (fa === fb && (a.cost < b.cost || (a.cost === b.cost && a.name <= b.name))), `${a.id} before ${b.id}`);
  }
  assert.deepEqual(byType.slice(0, 3).map((c) => c.id), ['fresh-deal', 'unlock', 'fresh-line'], 'within a family: price, then name');
  assert.equal(CARD_BY_ID.unlock.cost, 3);
  const byPrice = shopOrder('price');
  for (let i = 1; i < byPrice.length; i++) assert.ok(byPrice[i - 1].cost < byPrice[i].cost || (byPrice[i - 1].cost === byPrice[i].cost && byPrice[i - 1].name <= byPrice[i].name));
  assert.equal(byPrice[0].cost, 3);
  assert.equal(byPrice[byPrice.length - 1].cost, 12);
  const six = shopOrder('price', 6);
  for (let i = 1; i < six.length; i++) assert.ok(cardCost(six[i - 1], 6) <= cardCost(six[i], 6), 'by the 6x6 price');
  assert.ok(six.findIndex((c) => c.id === 'long-haul') < six.findIndex((c) => c.id === 'double-down'), 'Long Haul is cheap on 6x6');
});
