// Perk cards (an experimental levels mode): the card catalogue, the gold market between levels and the
// one-use actions the cards play on a board. Pure functions over the word state and the run's perk
// record; the UI chooses targets, shows the pickers and plays the few cards that act on the game
// rather than the board (Fresh Deal, Rewind, Hint, Scout Ahead).
//
// Gold is the turns to spare when a level's goal is reached (Gold Rush doubles it). Each card exists
// once per run, costs 12 to 18 gold, and one card may be played per level. Board effects live in
// state.perk so the engine scores them and undo snapshots carry them.

import { mulberry32, shuffle, hashString, rngNext } from './rng.js';
import { LETTERS, WILD, letterValue, bagTotal, isLocked, lineCellsFree, slideMoves, turnLimit, baseTurnLimit, gridOfState, sizeOf } from './words.js';

export const FAMILIES = { board: 'Board', letters: 'Letters', power: 'Power tiles', scoring: 'Scoring', tempo: 'Tempo', info: 'Information', economy: 'Economy' };
export const MARKET_SIZE = 3;

/**
 * The deck. target tells the UI what the card needs: none (plays at once), tile, pair (two tiles),
 * block (the top-left tile of a 2×2 block), multi (up to three tiles, then Done), line (a tile, then
 * row or column), flick (a flick on a line), word (one of the locked words), market (bought and
 * resolved in the market). turn is the turns the card's action costs on top of the card itself.
 */
export const CARDS = [
  // board
  { id: 'fresh-deal', name: 'Fresh Deal', cost: 14, family: 'board', target: 'none', turn: 0, text: 'Turn 1 only, before any move: a whole new board. The goal is worked out again for the new letters.' },
  { id: 'long-swap', name: 'Long Swap', cost: 14, family: 'board', target: 'pair', turn: 0, text: 'Swap two unlocked tiles in the same row or column, any distance apart. No turn.' },
  { id: 'rotate', name: 'Rotate', cost: 14, family: 'board', target: 'block', turn: 0, text: 'Turn a 2×2 block of unlocked tiles a quarter turn clockwise. No turn.' },
  { id: 'unlock', name: 'Unlock', cost: 14, family: 'board', target: 'tile', turn: 0, text: 'A locked tile can move again. Its word keeps its points; it counts toward the tile bonus again once a new word locks it.' },
  { id: 'long-flick', name: 'Long Flick', cost: 12, family: 'board', target: 'flick', turn: 1, text: 'Flick a row or column and it slides two steps for one turn.' },
  { id: 'letter-trade', name: 'Letter Trade', cost: 16, family: 'board', target: 'pair', turn: 1, text: 'Swap the letters of any two tiles, locked or not. The tiles stay put and keep their locks. One turn.' },
  { id: 'fresh-line', name: 'Fresh Line', cost: 14, family: 'board', target: 'line', turn: 1, text: 'Every unlocked tile in one row or column gets a fresh letter from the bag. One turn.' },
  // letters
  { id: 'big-nudge', name: 'Big Nudge', cost: 14, family: 'letters', target: 'tile', turn: 0, text: 'Nudge one tile up to three letters either way in one go. No turn.' },
  { id: 'pick-letter', name: 'Pick a Letter', cost: 16, family: 'letters', target: 'tile', turn: 0, text: 'Set an unlocked tile to any letter still in the bag; its old letter goes into the bag. No turn.' },
  { id: 'choice-draw', name: 'Choice Draw', cost: 14, family: 'letters', target: 'none', turn: 0, text: 'Your next Draw offers three letters and you keep one. The draw costs its usual turn.' },
  { id: 'exchange', name: 'Exchange', cost: 16, family: 'letters', target: 'multi', turn: 1, text: 'Toss up to three unlocked tiles and draw replacements from the bag, all for one turn.' },
  // power tiles
  { id: 'power-pair', name: 'Power Pair', cost: 16, family: 'power', target: 'none', turn: 0, text: 'Two random unlocked tiles get a Double Letter and a Triple Letter square. The square stays on its cell until a word locks it and pays once.' },
  { id: 'triple-up', name: 'Triple Up', cost: 16, family: 'power', target: 'tile', turn: 0, text: 'Choose an unlocked tile: a Triple Letter square. It stays on the cell until a word locks it and pays once.' },
  { id: 'sticker', name: 'Gold Sticker', cost: 12, family: 'power', target: 'tile', turn: 0, text: 'Choose an unlocked tile: +5 when a word locks that cell. Better than Triple on a vowel.' },
  { id: 'wild-card', name: 'Wild Card', cost: 18, family: 'power', target: 'tile', turn: 0, text: 'Any tile, locked or not, becomes wild at once. No turns, and it does not count against the one wild per board.' },
  // scoring
  { id: 'next-plus10', name: 'Next Word +10', cost: 14, family: 'scoring', target: 'none', turn: 0, text: 'Your next locked word scores 10 more.' },
  { id: 'long-word', name: 'Long Word Bonus', cost: 16, family: 'scoring', target: 'none', turn: 0, text: 'Your next 5- or 6-letter word gets its length bonus twice. Shorter words leave it waiting.' },
  { id: 'encore', name: 'Encore', cost: 14, family: 'scoring', target: 'word', turn: 0, text: 'Pick one of your locked words: its letter points score again.' },
  { id: 'head-start', name: 'Head Start', cost: 14, family: 'scoring', target: 'none', turn: 0, text: 'The tile bonus ladder starts one tile earlier on this board.' },
  { id: 'double-down', name: 'Double Down', cost: 16, family: 'scoring', target: 'none', turn: 0, text: 'Your next locked word scores its letter values twice, up to 15 extra.' },
  { id: 'stretch', name: 'Stretch Bonus', cost: 14, family: 'scoring', target: 'none', turn: 0, text: 'Your next word of 4 or more letters gets the length bonus one rung up: +15 for 4 letters, +30 for 5, +45 for 6. Shorter words leave it waiting.' },
  { id: 'crossroads', name: 'Crossroads', cost: 12, family: 'scoring', target: 'none', turn: 0, text: 'For the rest of this board, every word that reuses a locked tile scores +2.' },
  { id: 'diagonal', name: 'Diagonal Dividend', cost: 12, family: 'scoring', target: 'none', turn: 0, text: 'For the rest of this board, every word on a diagonal scores +5.' },
  // tempo
  { id: 'extra-turn', name: 'Extra Turn', cost: 16, family: 'tempo', target: 'none', turn: 0, text: 'This level has one more turn. Extra turns never earn gold.' },
  { id: 'borrowed-time', name: 'Borrowed Time', cost: 18, family: 'tempo', target: 'none', turn: 0, text: 'This level has two more turns. Extra turns never earn gold.' },
  { id: 'free-move', name: 'Free Move', cost: 12, family: 'tempo', target: 'none', turn: 0, text: 'Your next slide or swap costs no turn.' },
  { id: 'rewind', name: 'Rewind', cost: 12, family: 'tempo', target: 'none', turn: 0, text: 'Take back your last move or lock, once, in a run where undo is otherwise off. Cannot go back past a Draw.' },
  // information
  { id: 'peek', name: 'Peek', cost: 12, family: 'info', target: 'none', turn: 0, text: 'For the rest of this level the Draw button shows the letter the next draw will bring.' },
  { id: 'hint', name: 'Hint', cost: 12, family: 'info', target: 'none', turn: 0, text: 'Lights up the highest-scoring word that can be locked right now.' },
  { id: 'scout-ahead', name: 'Scout Ahead', cost: 12, family: 'info', target: 'market', turn: 0, text: 'In the market: see the next board’s letters before you buy anything else. Used up at once, so it never takes a level’s perk.' },
  // economy
  { id: 'gold-rush', name: 'Gold Rush', cost: 12, family: 'economy', target: 'none', turn: 0, text: 'This level’s spare turns pay double gold. It takes the level’s one perk, so no board boost this level.' },
];

export const CARD_BY_ID = Object.fromEntries(CARDS.map((c) => [c.id, c]));

/** A card's text for a board size: the 6-letter words only a 6×6 board can hold are left out on 5×5. */
export function cardText(card, size = 5) {
  if (size === 6) return card.text;
  if (card.id === 'long-word') return 'Your next 5-letter word gets its length bonus twice. Shorter words leave it waiting.';
  if (card.id === 'stretch') return 'Your next word of 4 or more letters gets the length bonus one rung up: +15 for 4 letters, +30 for 5. Shorter words leave it waiting.';
  return card.text;
}

/** How a scoring line is labelled on the result card and in the words popup. */
export function perkLabel(card) {
  if (card === 'squares') return 'Letter squares';
  return CARD_BY_ID[card] ? CARD_BY_ID[card].name : card;
}

/** The empty per-board perk record (state.perk). */
export function emptyPerk() {
  return { squares: {}, stickers: {}, next: null, crossroads: false, diagonal: false, headStart: false, extraTurns: 0, freeMove: false, choiceDraw: false, peek: false, log: [] };
}

/** A new run's perk record: no gold, every card in a shuffled deck, an empty hand. */
export function newPerkRun(seed) {
  const deck = shuffle(CARDS.map((c) => c.id), mulberry32(hashString(`perks:${seed}`)));
  return { gold: 0, deck, hand: [], used: null, goldRush: false, market: null, nextSeed: null, gained: 0, rng: hashString(`perkrng:${seed}`), levelStart: { gold: 0, hand: [] } };
}

function nextRand(perks) {
  const r = rngNext(perks.rng >>> 0);
  perks.rng = r.state;
  return r.value;
}

/** A level begins: the perk slot is free again and the hand is remembered for a retry of this board. */
export function beginLevel(perks) {
  perks.used = null;
  perks.goldRush = false;
  perks.market = null;
  perks.nextSeed = null;
  perks.gained = 0;
  perks.levelStart = { gold: perks.gold, hand: perks.hand.slice() };
}

/** Gold for passing a level: the turns to spare on the board's own limit, doubled by Gold Rush. */
export function goldForPass(state, perks) {
  const spare = Math.max(0, baseTurnLimit(state) - state.turns);
  return perks && perks.goldRush ? spare * 2 : spare;
}

/** Up to MARKET_SIZE cards from the top of the deck, from different families where the deck allows. */
export function pickOffer(deck, n = MARKET_SIZE) {
  const offer = [];
  const families = new Set();
  for (const id of deck) {
    const c = CARD_BY_ID[id];
    if (!c || families.has(c.family)) continue;
    offer.push(id);
    families.add(c.family);
    if (offer.length === n) break;
  }
  for (const id of deck) {
    if (offer.length === n) break;
    if (!offer.includes(id) && CARD_BY_ID[id]) offer.push(id);
  }
  return offer;
}

/** Open the market: the offer leaves the deck while it is on show; nextSeed fixes the next board so Scout Ahead can show it. */
export function openMarket(perks, nextSeed) {
  if (perks.market) return perks.market;
  const offer = pickOffer(perks.deck);
  perks.deck = perks.deck.filter((id) => !offer.includes(id));
  perks.market = { offer, bought: [], scouted: false };
  perks.nextSeed = nextSeed;
  return perks.market;
}

/** Why a card on offer cannot be bought right now, or '' when it can. */
export function buyBlock(perks, id) {
  const m = perks.market;
  const c = CARD_BY_ID[id];
  if (!m || !c) return 'Not on offer';
  if (m.bought.includes(id)) return 'Bought';
  if (perks.gold < c.cost) return `Needs ${c.cost - perks.gold} more gold`;
  return '';
}

/** Buy a card from the offer: gold goes down, the card joins the hand (Scout Ahead resolves in the market instead). */
export function buyCard(perks, id) {
  const block = buyBlock(perks, id);
  if (block) throw new Error(block);
  const c = CARD_BY_ID[id];
  perks.gold -= c.cost;
  perks.market.bought.push(id);
  if (c.target === 'market') perks.market.scouted = true;
  else perks.hand.push(id);
}

/** Close the market: what was not bought returns to the deck, which is shuffled again. */
export function closeMarket(perks) {
  const m = perks.market;
  if (!m) return;
  for (const id of m.offer) if (!m.bought.includes(id)) perks.deck.push(id);
  shuffle(perks.deck, () => nextRand(perks));
  perks.market = null;
}

// ---------------------------------------------------------------------------
// Playability

const PLUS = (n) => `${n} turn${n === 1 ? '' : 's'}`;

/**
 * Why a card in hand cannot be played now, or '' when it can. ctx: { historyLength } for Rewind.
 * The one-card-per-level rule and "play has stopped" are checked by the caller, which knows the game.
 */
export function playBlock(id, state, ctx = {}) {
  const c = CARD_BY_ID[id];
  if (!c) return 'Unknown card';
  const p = state.perk || emptyPerk();
  const g = gridOfState(state);
  const free = state.board.map((_, i) => i).filter((i) => !isLocked(state, i));
  const turnsLeft = turnLimit(state) - state.turns;
  if (c.turn > turnsLeft) return `Needs ${PLUS(c.turn)} left`;
  switch (id) {
    case 'fresh-deal':
      return state.turns === 0 && state.words.length === 0 && !(ctx.historyLength > 0) ? '' : 'Only before the first move';
    case 'long-swap': {
      const ok = free.some((a) => free.some((b) => b !== a && (g.rowOf(a) === g.rowOf(b) || g.colOf(a) === g.colOf(b))));
      return ok ? '' : 'Needs two unlocked tiles in a line';
    }
    case 'rotate':
      return rotateBlocks(state).length ? '' : 'No 2×2 block of unlocked tiles';
    case 'unlock':
      return state.locked.length ? '' : 'Nothing is locked yet';
    case 'long-flick':
      return ['row', 'col'].some((axis) => Array.from({ length: g.size }, (_, i) => i).some((i) => lineCellsFree(state, axis, i).length >= 3)) ? '' : 'No line with three unlocked tiles';
    case 'letter-trade':
      return state.board.length >= 2 ? '' : 'Needs two tiles';
    case 'fresh-line':
      return bagTotal(state.bag) > 0 && free.length ? '' : 'The bag is empty';
    case 'big-nudge':
      return state.board.some((ch) => ch !== WILD) ? '' : 'Every tile is wild';
    case 'pick-letter':
      return free.length && bagTotal(state.bag) > 0 ? '' : free.length ? 'The bag is empty' : 'No unlocked tile';
    case 'choice-draw':
      return p.choiceDraw ? 'Already armed' : bagTotal(state.bag) > 0 ? '' : 'The bag is empty';
    case 'exchange':
      return free.length && bagTotal(state.bag) > 0 ? '' : free.length ? 'The bag is empty' : 'No unlocked tile';
    case 'power-pair':
      return free.filter((i) => state.board[i] !== WILD && !p.squares[i]).length >= 2 ? '' : 'Needs two unlocked tiles';
    case 'triple-up':
      return free.some((i) => state.board[i] !== WILD && !p.squares[i]) ? '' : 'No unlocked tile to power up';
    case 'sticker':
      return free.some((i) => !p.stickers[i]) ? '' : 'No unlocked tile left';
    case 'wild-card':
      return state.board.some((ch) => ch !== WILD) ? '' : 'Every tile is wild';
    case 'next-plus10':
    case 'long-word':
    case 'double-down':
    case 'stretch':
      return p.next ? 'A word bonus is already waiting' : '';
    case 'encore':
      return state.words.length ? '' : 'No word locked yet';
    case 'head-start':
      return p.headStart ? 'Already in play' : '';
    case 'crossroads':
      return p.crossroads ? 'Already in play' : '';
    case 'diagonal':
      return p.diagonal ? 'Already in play' : '';
    case 'extra-turn':
    case 'borrowed-time':
      return turnsLeft > 0 ? '' : 'The turns are spent';
    case 'free-move':
      return p.freeMove ? 'Already armed' : '';
    case 'rewind':
      return ctx.historyLength > 0 ? '' : 'Nothing to take back';
    case 'peek':
      return p.peek ? 'Already in play' : bagTotal(state.bag) > 0 ? '' : 'The bag is empty';
    case 'hint':
    case 'gold-rush':
      return '';
    case 'scout-ahead':
      return 'Plays in the market';
    default:
      return '';
  }
}

/** The top-left cells of every 2×2 block whose four tiles are unlocked. */
export function rotateBlocks(state) {
  const g = gridOfState(state);
  const out = [];
  for (let r = 0; r + 1 < g.size; r++) {
    for (let c = 0; c + 1 < g.size; c++) {
      const cells = [g.idx(r, c), g.idx(r, c + 1), g.idx(r + 1, c + 1), g.idx(r + 1, c)];
      if (cells.every((i) => !isLocked(state, i))) out.push(g.idx(r, c));
    }
  }
  return out;
}

/** The letters a tile can become with Big Nudge: one to three steps either way, wrapping like a nudge. */
export function bigNudgeOptions(ch) {
  const i = LETTERS.indexOf(ch);
  if (i < 0) return [];
  const out = [];
  for (const d of [-3, -2, -1, 1, 2, 3]) out.push(LETTERS[(i + d + 26) % 26]);
  return out;
}

// ---------------------------------------------------------------------------
// Draws, exactly as the engine draws (so Peek is exact)

function drawOne(bag, rngState) {
  const total = bagTotal(bag);
  if (total <= 0) return null;
  const r = rngNext(rngState);
  let pick = Math.floor(r.value * total);
  for (const ch of LETTERS) {
    if (pick < bag[ch]) return { letter: ch, state: r.state };
    pick -= bag[ch];
  }
  return null;
}

/** The next n letters the bag would give, in order, without touching the state. */
export function peekDraws(state, n = 1) {
  const bag = { ...state.bag };
  let rs = state.rngState >>> 0;
  const out = [];
  for (let k = 0; k < n; k++) {
    const d = drawOne(bag, rs);
    if (!d) break;
    bag[d.letter]--;
    rs = d.state;
    out.push(d.letter);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Board actions

const ACTION_COST = { pswap: 0, rotate: 0, setletter: 0, draw3: 1, unlock: 0, exchange: 1, freshline: 1, slide2: 1, trade: 1, wildcard: 0, squares: 0, sticker: 0, encore: 0, flag: 0, turns: 0 };

/**
 * Apply a perk action; returns the new state (input untouched). Throws on an illegal target.
 *   { type: 'pswap', a, b }              swap two unlocked tiles (Long Swap; the UI keeps them in a line)
 *   { type: 'rotate', cell }             quarter-turn the 2×2 block whose top-left tile is cell
 *   { type: 'setletter', cell, letter, fromBag }   Big Nudge (fromBag false) or Pick a Letter (fromBag true)
 *   { type: 'draw3', cell, pick }        Choice Draw: the next three letters are drawn, pick (0..2) stays
 *   { type: 'unlock', cell }
 *   { type: 'exchange', cells }          up to three unlocked tiles redrawn
 *   { type: 'freshline', axis, index }   every unlocked tile in the line redrawn
 *   { type: 'slide2', axis, index, dir } the line slides two steps
 *   { type: 'trade', a, b }              the letters of any two tiles change places
 *   { type: 'wildcard', cell }
 *   { type: 'squares', cells: [{ cell, mult }] }
 *   { type: 'sticker', cell }
 *   { type: 'encore', index }            the letter points of words[index] again
 *   { type: 'flag', key, value }         next | crossroads | diagonal | headStart | freeMove | choiceDraw | peek
 *   { type: 'turns', n }                 extra turns
 */
export function applyPerkAction(state, action) {
  const g = gridOfState(state);
  const p = state.perk || emptyPerk();
  const cost = ACTION_COST[action.type];
  if (cost === undefined) throw new Error(`Unknown perk action: ${action.type}`);
  if (state.turns + cost > turnLimit(state)) throw new Error('No turns left');
  const next = {
    ...state,
    size: sizeOf(state),
    board: state.board.slice(),
    bag: { ...state.bag },
    locked: state.locked.slice(),
    words: state.words.slice(),
    turns: state.turns + cost,
    perk: { ...p, squares: { ...(p.squares || {}) }, stickers: { ...(p.stickers || {}) }, log: (p.log || []).slice() },
  };
  delete next.lastDraw;
  const inRange = (cell) => Number.isInteger(cell) && cell >= 0 && cell < state.board.length;
  const needFree = (cell) => {
    if (!inRange(cell)) throw new Error('Tile out of range');
    if (isLocked(state, cell)) throw new Error('That tile is locked');
  };
  // draw letters first, give the old ones back after: a tossed letter never comes straight back
  const redraw = (cells) => {
    const drawn = [];
    for (const cell of cells) {
      const d = drawOne(next.bag, next.rngState);
      if (!d) break;
      next.bag[d.letter]--;
      next.rngState = d.state;
      drawn.push({ cell, letter: d.letter });
    }
    if (!drawn.length) throw new Error('The bag is empty');
    for (const { cell, letter } of drawn) {
      const old = next.board[cell];
      next.board[cell] = letter;
      if (old !== WILD) next.bag[old]++;
    }
    return drawn;
  };
  switch (action.type) {
    case 'pswap': {
      needFree(action.a);
      needFree(action.b);
      if (action.a === action.b) throw new Error('Pick two different tiles');
      [next.board[action.a], next.board[action.b]] = [state.board[action.b], state.board[action.a]];
      break;
    }
    case 'rotate': {
      if (!rotateBlocks(state).includes(action.cell)) throw new Error('That block has a locked tile');
      const r = g.rowOf(action.cell);
      const c = g.colOf(action.cell);
      const tl = g.idx(r, c);
      const tr = g.idx(r, c + 1);
      const br = g.idx(r + 1, c + 1);
      const bl = g.idx(r + 1, c);
      next.board[tr] = state.board[tl];
      next.board[br] = state.board[tr];
      next.board[bl] = state.board[br];
      next.board[tl] = state.board[bl];
      break;
    }
    case 'setletter': {
      if (!inRange(action.cell)) throw new Error('Tile out of range');
      if (!LETTERS.includes(action.letter)) throw new Error('Not a letter');
      const old = state.board[action.cell];
      if (action.fromBag) {
        needFree(action.cell);
        if (!(next.bag[action.letter] > 0)) throw new Error(`No ${action.letter} left in the bag`);
        next.bag[action.letter]--;
        if (old !== WILD) next.bag[old]++;
      } else if (old === WILD) throw new Error('A wild tile cannot be nudged');
      else if (!bigNudgeOptions(old).includes(action.letter)) throw new Error('Up to three letters away');
      next.board[action.cell] = action.letter;
      break;
    }
    case 'draw3': {
      if (!inRange(action.cell)) throw new Error('Tile out of range');
      const options = peekDraws(state, 3);
      if (!options.length) throw new Error('The bag is empty');
      if (!(action.pick >= 0 && action.pick < options.length)) throw new Error('Pick one of the letters');
      // the three leave the bag in order (so the draw seed moves on by three), two go back, the old letter goes back
      let rs = state.rngState >>> 0;
      for (let k = 0; k < options.length; k++) {
        const d = drawOne(next.bag, rs);
        next.bag[d.letter]--;
        rs = d.state;
      }
      next.rngState = rs;
      options.forEach((ch, k) => {
        if (k !== action.pick) next.bag[ch]++;
      });
      const old = state.board[action.cell];
      next.board[action.cell] = options[action.pick];
      if (old !== WILD) next.bag[old]++;
      next.lastDraw = { cell: action.cell, drawn: options[action.pick], tossed: old, options };
      next.perk.choiceDraw = false;
      break;
    }
    case 'unlock': {
      if (!inRange(action.cell)) throw new Error('Tile out of range');
      if (!isLocked(state, action.cell)) throw new Error('That tile is not locked');
      next.locked = next.locked.filter((c) => c !== action.cell);
      break;
    }
    case 'exchange': {
      const cells = Array.from(new Set(action.cells || []));
      if (!cells.length || cells.length > 3) throw new Error('Pick one to three tiles');
      for (const c of cells) needFree(c);
      next.lastRedraw = redraw(cells);
      break;
    }
    case 'freshline': {
      if (!g.inRange(action.index) || (action.axis !== 'row' && action.axis !== 'col')) throw new Error('Pick a row or column');
      const cells = lineCellsFree(state, action.axis, action.index);
      if (!cells.length) throw new Error('That line is locked in place');
      next.lastRedraw = redraw(cells);
      break;
    }
    case 'slide2': {
      if (!g.inRange(action.index) || (action.axis !== 'row' && action.axis !== 'col') || Math.abs(action.dir) !== 1) throw new Error('Pick a line to flick');
      if (lineCellsFree(state, action.axis, action.index).length < 3) throw new Error('Needs three unlocked tiles in the line');
      const one = { type: 'slide', axis: action.axis, index: action.index, dir: action.dir };
      const mid = { ...state, board: state.board.slice() };
      for (const m of slideMoves(state, one)) mid.board[m.to] = state.board[m.from];
      for (const m of slideMoves(mid, one)) next.board[m.to] = mid.board[m.from];
      break;
    }
    case 'trade': {
      if (!inRange(action.a) || !inRange(action.b)) throw new Error('Tile out of range');
      if (action.a === action.b) throw new Error('Pick two different tiles');
      [next.board[action.a], next.board[action.b]] = [state.board[action.b], state.board[action.a]];
      break;
    }
    case 'wildcard': {
      if (!inRange(action.cell)) throw new Error('Tile out of range');
      if (state.board[action.cell] === WILD) throw new Error('That tile is already wild');
      next.board[action.cell] = WILD;
      delete next.perk.squares[action.cell]; // a wild scores 0: nothing to multiply
      break;
    }
    case 'squares': {
      for (const { cell, mult } of action.cells || []) {
        needFree(cell);
        if (state.board[cell] === WILD) throw new Error('A wild tile scores 0');
        if (mult !== 2 && mult !== 3) throw new Error('Double or triple');
        next.perk.squares[cell] = mult;
      }
      break;
    }
    case 'sticker': {
      needFree(action.cell);
      next.perk.stickers[action.cell] = (next.perk.stickers[action.cell] || 0) + 5;
      break;
    }
    case 'encore': {
      const wd = state.words[action.index];
      if (!wd) throw new Error('Pick a locked word');
      const pts = encorePoints(wd);
      next.score = state.score + pts;
      next.perkPoints = (state.perkPoints || 0) + pts;
      next.perk.log.push({ card: 'encore', pts, word: wd.word });
      break;
    }
    case 'flag': {
      if (!['next', 'crossroads', 'diagonal', 'headStart', 'freeMove', 'choiceDraw', 'peek'].includes(action.key)) throw new Error('Unknown perk flag');
      next.perk[action.key] = action.value;
      break;
    }
    case 'turns': {
      if (!(action.n >= 1)) throw new Error('How many turns?');
      next.perk.extraTurns = (p.extraTurns || 0) + action.n;
      break;
    }
    default:
      break;
  }
  return next;
}

/** The letter points of a locked word as they were scored (a wild at 0), which is what Encore pays again. */
export function encorePoints(entry) {
  if (entry && typeof entry === 'object') {
    if (typeof entry.letters === 'number') return entry.letters;
    entry = entry.word;
  }
  return String(entry).split('').reduce((a, ch) => a + letterValue(ch), 0);
}

/** Two random unlocked, unpowered, non-wild cells for Power Pair: the first doubles, the second triples. */
export function powerPairCells(state, rand = Math.random) {
  const p = state.perk || emptyPerk();
  const pool = state.board.map((_, i) => i).filter((i) => !isLocked(state, i) && state.board[i] !== WILD && !p.squares[i]);
  if (pool.length < 2) return null;
  const a = pool.splice(Math.floor(rand() * pool.length), 1)[0];
  const b = pool.splice(Math.floor(rand() * pool.length), 1)[0];
  return [{ cell: a, mult: 2 }, { cell: b, mult: 3 }];
}

/** The lines of a perk-run result: every card that paid, summed per card, newest last. */
export function perkSummary(state) {
  const log = (state.perk && state.perk.log) || [];
  const byCard = new Map();
  for (const x of log) byCard.set(x.card, (byCard.get(x.card) || 0) + x.pts);
  return Array.from(byCard, ([card, pts]) => ({ card, label: perkLabel(card), pts }));
}
