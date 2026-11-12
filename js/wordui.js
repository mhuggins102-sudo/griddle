// Word game UI: a 5x5 letter grid, 20 turns, lock words to bank points. Fits a portrait phone.
// Everything is played directly on the board with gestures:
//   drag a tile onto a neighbour  -> swap
//   flick a row or column         -> slide (a long drag along the line slides too)
//   press and hold a tile         -> menu: nudge down, nudge up, draw, wild (locked tiles)
//   tap the first and last letter -> lock the word between them
// Modes: levels (a bot sets a goal score per board; pass to advance) and free play (no goal).

import { randomSeed, hashString } from './rng.js';
import { openSheet, closeSheet } from './sheet.js';
import { buildBoardSkeleton, tileIn, tileStep, animateAction, animateMoves, beginMoves, removeGhosts, clearTileEffects, wait, ANIM_MS } from './board.js';
import {
  CARD_BY_ID, FAMILIES, cardText, emptyPerk, newPerkRun, beginLevel, goldForPass, openMarket, hasMarket, buyBlock, buyCard, closeMarket, playBlock, rotateBlocks,
  rotateRing, bigNudgeOptions, peekDraws, applyPerkAction, powerPairCells, perkSummary, perkLabel, shopOrder, shopBuyBlock, shopTake,
} from './perks.js';
import {
  DICT_VERSION, dealLetters, createWordState, applyWordAction, findWords, findWordAt, lockWord, parseDictionary, bagTotal, letterValue,
  describeWordCells, wordShareLine, slideMoves, coverageBonusFor, finalScore, shortfallPenalty, nudgeLetter, lineCellsFree,
  turnLimit, gridOfState, WILD, LETTERS, COVERAGE_TARGET, WILD_COST, SIZES, fullCoverTurnBonus, isBoardFull,
  COVERAGE_LADDER, MAX_WILDS,
} from './words.js';
import { botPlay, goalFor } from './wordbot.js';
import { play } from './sound.js';

const $ = (sel) => document.querySelector(sel);

/** Gesture tuning (CSS pixels, milliseconds, tile widths). */
const LONG_PRESS_MS = 420; // hold this long without moving to open the tile menu
const TAP_SLOP = 8; // movement below this is a tap
const SWAP_TRAVEL = 0.4; // tiles: minimum travel towards a neighbour to drop onto it
const SWAP_CROSS = 0.7; // tiles: maximum sideways wobble for a drop
/**
 * Flick or drag? Speed decides, read over the whole movement rather than its last instant. A flick is
 * quick and usually longer than a tile; a drag is slow, and a slow drag is always a swap with the
 * neighbour in its direction, however far it goes. The boundary is a line in (distance, average
 * speed): the speed needed to count as a flick falls with distance, FLICK_SPEED_AT_ZERO minus
 * FLICK_SPEED_PER_TILE per tile, but never below FLICK_MIN_SPEED, all in tiles per second. With 24,
 * 16 and 4: half a tile needs 16 tiles/s, one tile 8, and anything longer at least 4, so a slow
 * crawl across two tiles is still a drag. While the finger is down the same numbers decide when the
 * drag is confirmed: once the movement averages under FLICK_MIN_SPEED it is slower than any flick could
 * be, whatever distance it goes on to cover, so the neighbour lights up and that release will swap.
 */
const FLICK_SPEED_AT_ZERO = 24;
const FLICK_SPEED_PER_TILE = 16;
const FLICK_MIN_SPEED = 4;
const FLICK_MIN_TRAVEL = 0.3; // tiles: anything shorter is a wobble, never a flick
const MIN_BOARD_PX = 230; // the board never shrinks below this under the result sheet (about 36px tiles on a 5x5)
const MIN_SHEET_PX = 190; // the sheet keeps at least its head and foot; the middle scrolls
const PASS_PAUSE_MS = 900; // between the goal being reached and the result card, so the last word is seen landing

export function initWordMode(ctx) {
  const w = {
    dict: null,
    game: null, // { seed, drawSeed, size, state, mode: 'levels'|'free', level, goal, botScore, history, replay, retry }
    first: null, // first letter tapped for a lock
    pending: null, // candidate chosen from the found-words list, awaiting Lock
    found: [],
    animating: false,
    over: false,
    showBag: false,
    transient: null, // { text, cls } shown in the strip for a moment
    transientTimer: null,
    gesture: null,
    finishTimer: null, // a deferred end-of-board finish, bound to the game it was scheduled for
    menuCell: null,
    pointerTs: 0,
    worker: null,
    workerJob: 0,
    perk: null, // a card being targeted on the board: { id, picked: [cells] }
    hint: null, // the word lit up by a Hint card: { cells, word, score }
    hintTimer: null,
  };
  const boardEl = $('#wboard');
  const wrapEl = boardEl.parentElement;

  function makeLetterFace() {
    const face = document.createElement('div');
    face.className = 'face letter';
    face.innerHTML = '<span class="ch"></span><span class="val"></span>';
    return face;
  }
  let boardSize = 0;
  /** Build the tile grid for a board size (once per size change). */
  function ensureBoard(size) {
    if (boardSize === size) return;
    boardSize = size;
    buildBoardSkeleton(boardEl, makeLetterFace, { arrows: false, size });
    boardEl.style.setProperty('--n', String(size));
    boardEl.dataset.size = String(size);
  }
  ensureBoard(5);
  const grid = () => gridOfState(w.game.state);
  const limit = () => turnLimit(w.game.state);

  function setFace(tile, ch) {
    const face = tile.firstElementChild;
    face.querySelector('.ch').textContent = ch === WILD ? '★' : ch;
    face.querySelector('.val').textContent = ch === WILD ? '' : String(letterValue(ch));
    face.classList.toggle('wild', ch === WILD);
  }
  const tileEl = (cell) => tileIn(boardEl, cell);
  const showWordsOption = () => !!(ctx.store.settings && ctx.store.settings.showWords);
  const isLevels = () => w.game && w.game.mode === 'levels';
  const perks = () => (w.game && w.game.perks) || null; // the run's perk record (gold, deck, hand), or null
  const perksEnabled = () => !!(ctx.store.settings && ctx.store.settings.perks);
  const perkShopSetting = () => !!(ctx.store.settings && ctx.store.settings.perkMode === 'shop'); // a shop run sells the whole catalogue at any time
  /** A run earning gold and shopping between levels (a retry carries a hand but earns nothing). */
  const perkRun = () => !!(w.game && w.game.perks && !w.game.perks.retry);
  const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  async function ensureDict() {
    if (w.dict) return true;
    try {
      const res = await fetch(`data/words.txt?v=${DICT_VERSION}`); // versioned: a changed list is never served stale
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      w.dict = parseDictionary(await res.text());
      return true;
    } catch (e) {
      ctx.showToast(`Could not load the word list (${e.message}).`, 6000);
      return false;
    }
  }

  function persist() {
    if (w.over) return; // a finished board has already been recorded and cleared from the store
    ctx.store.wordGame = w.game;
    ctx.saveStore(ctx.store);
  }

  // ---------------------------------------------------------------------------
  // Goal score from the bot (web worker, main-thread fallback)

  function computeGoal(game) {
    if (game.mode !== 'levels' || game.botScore !== null) return;
    const job = ++w.workerJob;
    const apply = (result) => {
      // ignore a late reply: the board may have finished (and computed its goal itself) meanwhile
      if (w.game !== game || job !== w.workerJob || w.over || game.botScore !== null) return;
      game.botScore = result.banked; // the yardstick is the bot's word points, not its fill bonuses
      game.botFinal = result.score;
      game.botWords = result.words.map((x) => x.word);
      game.goal = goalFor(game.level, result.banked);
      persist();
      cancelGesture();
      renderAll(); // the goal may already be met: the bar lights up and the board greys out
    };
    const fallback = () => {
      try {
        const { board, bag } = dealLetters(game.seed, game.size);
        apply(botPlay(board, bag, w.dict));
      } catch (e) {
        ctx.showToast('Could not compute a goal for this board.');
      }
    };
    // without a Worker the bot runs on the main thread: let the board paint first
    if (typeof Worker === 'undefined') return void setTimeout(fallback, 0);
    try {
      if (!w.worker) {
        w.worker = new Worker(new URL('./wordbot-worker.js', import.meta.url), { type: 'module' });
        w.worker.onmessage = (e) => {
          const pending = w.pendingJobs && w.pendingJobs.get(e.data.id);
          if (!pending) return;
          w.pendingJobs.delete(e.data.id);
          if (e.data.error) pending.fallback();
          else pending.apply(e.data.result);
        };
        w.worker.onerror = () => {
          const jobs = w.pendingJobs;
          w.pendingJobs = new Map();
          try {
            w.worker.terminate();
          } catch {
            // already gone
          }
          w.worker = null;
          for (const p of jobs.values()) p.fallback();
        };
        w.pendingJobs = new Map();
      }
      const { board, bag } = dealLetters(game.seed, game.size);
      w.pendingJobs.set(job, { apply, fallback });
      w.worker.postMessage({ id: job, board, bag });
    } catch {
      fallback();
    }
  }

  /** Make sure the goal is known before scoring a levels game (synchronous fallback). */
  function ensureGoalNow(game) {
    if (game.mode !== 'levels' || game.botScore !== null) return;
    try {
      const { board, bag } = dealLetters(game.seed, game.size);
      const result = botPlay(board, bag, w.dict);
      game.botScore = result.banked;
      game.botFinal = result.score;
      game.botWords = result.words.map((x) => x.word);
      game.goal = goalFor(game.level, result.banked);
    } catch (e) {
      // the bot failed (it should never: it is pure): do not strand the run on an unscorable board
      game.botScore = 0;
      game.botWords = [];
      game.goal = 10;
      ctx.showToast('Could not compute a goal for this board; the level counts as passed.', 4000);
    }
  }

  // ---------------------------------------------------------------------------
  // Start / resume

  /**
   * start(true) resumes the saved game. start(false, { mode: 'levels'|'free', level, seed, drawSeed, replay, note })
   * starts a new board; seed/drawSeed replay a known board; note is shown briefly under the board.
   */
  async function start(resume, opts = {}) {
    if (!(await ensureDict())) return;
    if (resume && ctx.store.wordGame) {
      w.game = ctx.store.wordGame;
      if (w.game.mode === undefined) w.game.mode = 'free';
      if (w.game.botScore === undefined) w.game.botScore = null;
      if (w.game.goal === undefined) w.game.goal = null;
      if (w.game.history === undefined) w.game.history = w.game.prev && !w.game.undoUsed ? [w.game.prev] : []; // saves from the one-undo days
      if (w.game.retry === undefined) w.game.retry = null;
      if (w.game.size === undefined) w.game.size = w.game.state.size || Math.round(Math.sqrt(w.game.state.board.length));
      if (w.game.practice === undefined) w.game.practice = false;
      if (w.game.perks === undefined) w.game.perks = null;
      if (w.game.perks && !w.game.state.perk) w.game.state.perk = emptyPerk();
      if (showWordsOption()) w.game.practice = true; // once the words have been shown, the board stays practice
    } else {
      const seed = opts.seed ?? randomSeed();
      const drawSeed = opts.drawSeed ?? randomSeed();
      const size = SIZES.includes(opts.size) ? opts.size : 5;
      const { board, bag } = dealLetters(seed, size);
      const state = createWordState(board, bag, drawSeed);
      // perk cards: a new run starts one when the setting is on; the next level carries the run on; a
      // retry of a lost board gets the hand it had going in, but no gold and no market
      let run = null;
      if (opts.perks) run = opts.perks;
      else if ((opts.mode || 'free') === 'levels' && !opts.retry && (opts.level || 1) === 1 && perksEnabled()) run = newPerkRun(seed, { shop: perkShopSetting() });
      else if (opts.retry && opts.retry.perks) {
        const snap = opts.retry.perks;
        run = { gold: snap.gold, hand: snap.hand.slice(), deck: snap.deck ? snap.deck.slice() : [], goldRush: false, market: null, gained: 0, rng: 1, levelStart: { gold: snap.gold, hand: snap.hand.slice() }, retry: true, shop: !!snap.shop };
      }
      if (run) {
        beginLevel(run);
        state.perk = emptyPerk();
      }
      w.game = {
        seed,
        drawSeed,
        size,
        state,
        perks: run,
        startedAt: new Date().toISOString(),
        mode: opts.mode || 'free',
        level: opts.level || 1,
        goal: null,
        botScore: null,
        botWords: null,
        history: [], // states to undo back to; emptied by a draw, since a draw cannot be undone
        replay: !!opts.replay,
        practice: showWordsOption(), // the words on show: a practice board, nothing saved to stats or the leaderboard
        retry: null, // a free-play replay of the board that ended a run: its goal stays on show
      };
      if (opts.retry) {
        // a retry plays like free play, with the lost level's goal shown for the challenge (and the hand a perk run had)
        w.game.retry = { level: opts.retry.level, goal: opts.retry.goal, perks: opts.retry.perks || null };
        w.game.level = opts.retry.level;
        w.game.goal = opts.retry.goal;
        w.game.botScore = opts.retry.botScore ?? 0;
      }
      w.over = false; // before the save: persist() skips a finished board
      persist();
    }
    w.over = false;
    w.first = null;
    w.pending = null;
    w.showBag = false;
    cancelGesture();
    clearTimeout(w.finishTimer);
    w.finishTimer = null;
    clearTransient();
    closeMenu();
    w.perk = null;
    clearHint();
    closePerkPick();
    closeSheet($('#w-market'));
    closeSheet($('#w-handsheet'));
    closeSheet($('#w-shop'));
    ctx.showScreen('screen-word');
    ensureBoard(w.game.size);
    w.wordCount = w.game.state.words.length; // the bar animates only a word locked from here on
    closeTilePop();
    closeSheet($('#w-result'));
    clearTimeout(w.passTimer);
    $('#w-pop').hidden = true;
    $('#screen-word').classList.remove('sheet-up');
    fitBoardAbove(); // the board gets its size back
    $('#screen-word').classList.remove('over');
    $('#w-locked').hidden = false;
    $('#w-strip').hidden = false;
    renderAll();
    if (opts.note) say(opts.note, 'good', 2800);
    else if (opts.retry) say(`Replaying the board that ended your run · goal ${opts.retry.goal} · not counted in stats`, '', 3500);
    else if (opts.replay) say('Replaying this board · not counted in your stats', '', 3000);
    else if (w.game.practice) say('Practice board · words shown · not counted in stats', '', 3500);
    computeGoal(w.game);
    // a board saved in its last moment (full, or a level run out of turns) is scored straight away
    const st = w.game.state;
    if (!goalReached() && (isBoardFull(st) || (st.turns >= turnLimit(st) && isLevels()) || (w.game.retry && finalScore(st) >= w.game.goal))) finish(true);
    // the very first game on this device opens the tutorial once; the ? button brings it back any time
    if (!resume && !ctx.store.settings.tutorialSeen) {
      ctx.store.settings.tutorialSeen = true;
      ctx.saveStore(ctx.store);
      ctx.openTutorial(w.game.size, { mode: w.game.mode, goal: w.game.goal });
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering

  function renderAll() {
    renderHud();
    renderBoard();
    renderBag();
    renderWords();
    renderLocked();
    renderStrip();
  }

  function renderHud() {
    const st = w.game.state;
    const lim = limit();
    // the turn in play; once play has stopped (goal reached, board over) the turns used, so the count does not advance
    const stopped = w.over || (w.game.goal !== null && w.game.mode === 'levels' && finalScore(st) >= w.game.goal);
    $('#w-turn').textContent = `${stopped ? st.turns : Math.min(st.turns + 1, lim)}/${lim}`;
    $('#w-score').textContent = String(finalScore(st));
    const track = $('#w-turntrack');
    if (track.childElementCount !== lim) {
      track.innerHTML = '';
      for (let i = 0; i < lim; i++) track.appendChild(document.createElement('span'));
      track.style.gridTemplateColumns = `repeat(${lim}, 1fr)`;
    }
    const urgent = lim - st.turns <= 3 && !w.over;
    Array.from(track.children).forEach((seg, i) => {
      seg.classList.toggle('spent', i < st.turns);
      seg.classList.toggle('last', urgent && i >= st.turns);
    });
    const undo = $('#w-undo');
    undo.hidden = w.over || isLevels(); // no undo in a level run
    undo.disabled = !w.game.history.length;
    undo.title = w.game.history.length ? 'Undo the last move' : 'Nothing to undo (a draw cannot be undone)';
    const bagBtn = $('#w-bag-btn');
    bagBtn.hidden = w.over;
    bagBtn.setAttribute('aria-pressed', w.showBag ? 'true' : 'false');
    const hand = $('#w-hand');
    const run = perks();
    hand.hidden = !run || w.over;
    if (run && !hand.hidden) {
      // a market run shows its hand behind a card icon; a shop run shows the gold itself, the shop behind it
      const count = $('#w-hand-count');
      const face = $('#w-hand-goldface');
      hand.classList.toggle('shop', !!run.shop);
      face.hidden = !run.shop;
      face.textContent = `◆ ${run.gold}`;
      count.hidden = !!run.shop || !run.hand.length;
      count.textContent = String(run.hand.length);
      hand.setAttribute('aria-label', run.shop ? `Shop: ${run.gold} gold` : `Perk cards: ${run.hand.length} in hand`);
    }
  }

  /** The small badge on a tile with a letter square (×2, ×3) or a sticker (+5); none clears it. */
  function setBadge(tile, text, cls) {
    let b = tile.querySelector('.pbadge');
    if (!text) {
      if (b) b.remove();
      return;
    }
    if (!b) {
      b = document.createElement('span');
      b.setAttribute('aria-hidden', 'true');
      tile.appendChild(b);
    }
    b.className = `pbadge ${cls}`;
    b.textContent = text;
  }

  function renderBoard() {
    const st = w.game.state;
    const { rowOf, colOf } = grid();
    const pendingCells = w.pending ? new Set(w.pending.cells) : null;
    const inert = !canInteract();
    const valid = w.perk ? perkValidCells() : null;
    const pk = st.perk || null;
    removeGhosts(boardEl);
    for (let i = 0; i < st.board.length; i++) {
      const t = tileEl(i);
      clearTileEffects(t);
      t.classList.remove('dragging', 'drop-target', 'no-drop', 'shake');
      setFace(t, st.board[i]);
      const locked = st.locked.includes(i);
      t.classList.toggle('locked', locked);
      t.classList.toggle('wild', st.board[i] === WILD);
      t.classList.toggle('region', !!pendingCells && pendingCells.has(i));
      t.classList.toggle('first-pick', w.first === i);
      t.classList.toggle('inert', inert);
      const sq = pk && pk.squares && pk.squares[i];
      const stick = pk && pk.stickers && pk.stickers[i];
      setBadge(t, sq ? `×${sq}` : stick ? `+${stick}` : '', sq ? `sq${sq}` : 'sticker');
      t.classList.toggle('perk-ok', !!valid && valid.has(i));
      t.classList.toggle('perk-picked', !!w.perk && w.perk.picked.includes(i));
      t.classList.toggle('hinted', !!w.hint && w.hint.cells.includes(i));
      const extra = sq ? `, letter ×${sq}` : stick ? `, +${stick} when locked` : '';
      t.setAttribute('aria-label', `Row ${rowOf(i) + 1} column ${colOf(i) + 1}: ${st.board[i] === WILD ? 'wild' : st.board[i]}${locked ? ', locked' : ''}${extra}`);
    }
    boardEl.classList.toggle('frozen', goalReached() && !w.over);
    boardEl.classList.toggle('targeting', !!w.perk);
  }

  function renderBag() {
    const bag = w.game.state.bag;
    const el = $('#w-bag');
    el.hidden = !w.showBag || w.over;
    if (el.hidden) return;
    const peek = w.game.state.perk && w.game.state.perk.peek ? peekDraws(w.game.state, 1)[0] : null;
    el.innerHTML = `<div class="bag-title">In the bag: ${bagTotal(bag)} letters${peek ? ` · next draw: ${peek}` : ''}</div>`;
    for (const ch of LETTERS) {
      const chip = document.createElement('span');
      chip.className = `bag-letter${bag[ch] === 0 ? ' empty' : ''}`;
      chip.innerHTML = `${ch}<small>${bag[ch]}</small>`;
      chip.setAttribute('aria-label', `${bag[ch]} ${ch}`);
      el.appendChild(chip);
    }
  }

  function renderWords() {
    const st = w.game.state;
    w.found = findWords(st, w.dict);
    const wrap = $('#w-found-wrap');
    wrap.hidden = !showWordsOption() || w.over;
    const el = $('#w-found');
    el.innerHTML = '';
    if (wrap.hidden) return;
    const lockable = w.found.filter((c) => c.lockable);
    if (!lockable.length) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'No new words on the board yet.';
      el.appendChild(p);
    }
    for (const c of lockable.slice(0, 30)) {
      const b = document.createElement('button');
      b.className = `chip${w.pending && w.pending.key === c.key && w.pending.word === c.word ? ' active' : ''}`;
      b.innerHTML = `<span class="chip-word">${c.word}</span><span class="chip-score">${c.score}</span>`;
      b.setAttribute('aria-label', `${c.word} for ${c.score} points on ${describeWordCells(c.cells, grid().size)}`);
      b.addEventListener('click', () => {
        if (!canInteract() || w.perk) return;
        setPending(w.pending && w.pending.key === c.key && w.pending.word === c.word ? null : c);
      });
      el.appendChild(b);
    }
  }

  function renderLocked() {
    const st = w.game.state;
    const el = $('#w-locked');
    // newest first: a fresh word appears at the left and the earlier ones slide right
    const list = st.words.length
      ? `<span class="lw-list">${st.words.slice().reverse().map((x) => `<span class="lw">${x.word}<b>${x.score}</b></span>`).join('')}</span>`
      : '<span class="lw-list"><span>No words locked yet</span></span>';
    el.innerHTML = list;
    const scroller = el.querySelector('.lw-list');
    if (scroller) scroller.scrollLeft = 0;
    const fresh = el.querySelector('.lw');
    if (fresh && st.words.length > (w.wordCount || 0) && w.wordCount !== undefined && scroller.animate) {
      fresh.classList.add('lw-new'); // the new word slides in from the left
      if (getComputedStyle(scroller).flexDirection === 'column') {
        // a list: the earlier words bump down by one row
        const shift = fresh.offsetHeight + 4;
        for (const old of scroller.querySelectorAll('.lw:not(.lw-new)')) old.animate([{ transform: `translateY(-${shift}px)` }, { transform: 'none' }], { duration: 280, easing: 'ease-out' });
      } else {
        // a row: the earlier words bump right by the new one's width
        const shift = fresh.offsetWidth + 6;
        for (const old of scroller.querySelectorAll('.lw:not(.lw-new)')) old.animate([{ transform: `translateX(-${shift}px)` }, { transform: 'none' }], { duration: 280, easing: 'ease-out' });
      }
    }
    w.wordCount = st.words.length;
    renderGoalBar();
  }

  function renderGoalBar() {
    const g = w.game;
    const bar = $('#w-goalbar');
    bar.hidden = !(g.mode === 'levels' || g.retry);
    if (bar.hidden) return;
    const score = finalScore(g.state);
    $('#w-goalbar-level').textContent = g.retry ? `Level ${g.level} · retry` : `Level ${g.level}`;
    const goldEl = $('#w-gold');
    goldEl.hidden = !g.perks || !!g.perks.retry || !!g.perks.shop; // a retry earns nothing; a shop run's gold is on the header button
    if (g.perks) goldEl.textContent = `◆ ${g.perks.gold}`;
    if (g.goal === null) {
      $('#w-goalbar-text').textContent = 'Goal: computing…';
      $('#w-goalbar-fill').style.setProperty('--p', '0');
      bar.classList.remove('reached');
      $('#w-advance').hidden = true;
      return;
    }
    const reached = score >= g.goal;
    $('#w-goalbar-text').textContent = `${score} / ${g.goal}`;
    $('#w-goalbar-fill').style.setProperty('--p', String(Math.max(0, Math.min(1, score / g.goal))));
    if (reached && !g.goalCelebrated && !w.over) {
      g.goalCelebrated = true;
      if (perkRun()) {
        // the level is passed: the turns to spare are banked as gold, once
        g.perks.gained = goldForPass(g.state, g.perks);
        g.perks.gold += g.perks.gained;
        goldEl.textContent = `◆ ${g.perks.gold}`;
        $('#w-hand-goldface').textContent = `◆ ${g.perks.gold}`;
      }
      persist();
      bar.classList.add('celebrate');
      setTimeout(() => bar.classList.remove('celebrate'), 800);
      play('win');
      renderBoard(); // the goal may have landed from the worker mid-board: grey the tiles out now
      if (g.retry) finishSoon(1200); // a retry is won the moment the goal is reached: score it
    }
    bar.classList.toggle('reached', reached);
    $('#w-advance').hidden = true; // Next level lives in the result sheet now
    if (reached && !w.over && g.mode === 'levels') {
      // play stops here: drop any selection, a card being targeted and the menu; the result sheet offers the next level
      w.first = null;
      w.pending = null;
      closeMenu();
      dropTargeting(); // a card being aimed goes back (and its shop price with it)
      // a beat for the last word to land in the list before the result card appears
      clearTimeout(w.passTimer);
      w.passTimer = setTimeout(() => {
        if (w.game === g && !w.over && goalReached()) showPassed();
      }, PASS_PAUSE_MS);
    }
    bar.setAttribute('aria-label', `Level ${g.level}: score ${score} of goal ${g.goal}${reached ? ', goal reached' : ''}`);
  }

  /** The strip under the board: a legend, a transient message, or a pending action. */
  function renderStrip() {
    const legend = $('#w-legend');
    const msg = $('#w-msg');
    const act = $('#w-strip-action');
    const show = (el) => {
      legend.hidden = el !== legend;
      msg.hidden = el !== msg;
      act.hidden = el !== act;
    };
    const message = (text, cls = '') => {
      msg.textContent = text;
      msg.className = `strip-msg ${cls}`.trim();
      show(msg);
    };
    const action = (text, primary, secondary) => {
      $('#w-strip-text').textContent = text;
      const p = $('#w-strip-primary');
      const s = $('#w-strip-secondary');
      p.textContent = primary.label;
      p.onclick = primary.fn;
      p.disabled = !!primary.disabled;
      s.hidden = !secondary;
      if (secondary) {
        s.textContent = secondary.label;
        s.onclick = secondary.fn;
        s.disabled = !!secondary.disabled;
      }
      show(act);
    };
    if (!w.game || w.over) return;
    const g = w.game;
    const st = g.state;
    if (goalReached()) return message(`Level ${g.level} passed! Press Next level to carry on.`, 'good');
    if (w.perk) {
      const t = perkPrompt();
      return action(t.text, t.primary, t.secondary);
    }
    if (w.pending) return action(`Lock ${w.pending.word} for ${w.pending.score}?`, { label: 'Lock', fn: () => commitLock(w.pending) }, { label: 'Cancel', fn: () => setPending(null) });
    if (w.first !== null) return message('Now tap the last letter of the word');
    if (w.hint) return message(`Hint: ${w.hint.word} for ${w.hint.score}`, 'good');
    if (w.transient) return message(w.transient.text, w.transient.cls);
    show(legend);
  }

  function clearTransient() {
    clearTimeout(w.transientTimer);
    w.transientTimer = null;
    w.transient = null;
  }

  /** Show a short message under the board (cls: '', 'good', 'bad'). */
  function say(text, cls = '', ms = 2200) {
    clearTransient();
    w.transient = { text, cls };
    w.transientTimer = setTimeout(() => {
      w.transient = null;
      if (w.game) renderStrip();
    }, ms);
    renderStrip();
  }

  function setPending(candidate) {
    w.pending = candidate;
    w.first = null;
    closeMenu();
    renderBoard();
    renderStrip();
    if (showWordsOption()) renderWords();
  }

  /** In a level run, play stops the moment the goal is reached; Next level is the only way on. */
  function goalReached() {
    const g = w.game;
    return !!g && g.mode === 'levels' && g.goal !== null && finalScore(g.state) >= g.goal;
  }

  function canInteract() {
    return !!w.game && !w.over && !w.animating && !goalReached() && w.game.state.turns < turnLimit(w.game.state);
  }

  // ---------------------------------------------------------------------------
  // Board feedback: floating labels, shakes

  /** How far the label's top edge rises above its anchor, in label heights (see the floatUp keyframes). */
  const FLOAT_RISE = 1.7;
  const FLOAT_MARGIN = 8;

  /** Pop a label over a tile, kept on screen: a wide label on an edge column or a top-row word would otherwise leave the viewport. */
  function floatAt(cell, text, cls = '') {
    const layer = $('#w-float');
    const tr = tileEl(cell).getBoundingClientRect();
    const wr = wrapEl.getBoundingClientRect();
    const el = document.createElement('span');
    el.className = `float ${cls}`.trim();
    el.textContent = text;
    layer.appendChild(el);
    const half = el.offsetWidth / 2;
    const vw = document.documentElement.clientWidth;
    const x = Math.max(FLOAT_MARGIN + half, Math.min(vw - FLOAT_MARGIN - half, tr.left + tr.width / 2));
    const y = Math.max(FLOAT_MARGIN + FLOAT_RISE * el.offsetHeight, tr.top + tr.height / 2);
    el.style.left = `${x - wr.left}px`;
    el.style.top = `${y - wr.top}px`;
    setTimeout(() => el.remove(), 1300);
  }

  function shakeCells(cells) {
    if (reduceMotion()) return;
    for (const c of cells) {
      const t = tileEl(c);
      t.classList.remove('shake');
      void t.offsetWidth; // restart the animation
      t.classList.add('shake');
      setTimeout(() => t.classList.remove('shake'), 400);
    }
  }

  /** Cells from a to b when they share a row, column or diagonal; otherwise null. */
  function spanCells(a, b) {
    const { rowOf, colOf, idx } = grid();
    const dr = rowOf(b) - rowOf(a);
    const dc = colOf(b) - colOf(a);
    if (!(dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc))) return null;
    const len = Math.max(Math.abs(dr), Math.abs(dc)) + 1;
    const cells = [];
    for (let k = 0; k < len; k++) cells.push(idx(rowOf(a) + Math.sign(dr) * k, colOf(a) + Math.sign(dc) * k));
    return cells;
  }

  // ---------------------------------------------------------------------------
  // Tap: lock a word between the first and last letter tapped

  function onTileTap(cell) {
    if (w.perk) return perkTap(cell);
    if (!canInteract()) return;
    if (!$('#w-tilemenu').hidden) closeMenu(); // a tap elsewhere dismisses the menu, like the backdrop
    if (w.pending) setPending(null);
    const st = w.game.state;
    if (w.first === null) {
      w.first = cell;
      play('tap');
      renderBoard();
      renderStrip();
      return;
    }
    if (w.first === cell) {
      w.first = null;
      renderBoard();
      renderStrip();
      return;
    }
    const first = w.first;
    const cand = findWordAt(st, w.dict, first, cell);
    if (cand.error) {
      const span = spanCells(first, cell);
      if (span && span.length >= 3) {
        // in line but not a word: shake it off
        w.first = null;
        renderBoard();
        shakeCells(span);
        play('buzz');
        say(`${span.map((c) => (st.board[c] === WILD ? '?' : st.board[c])).join('')} is not in the word list`, 'bad');
      } else {
        // not in line (or too close): treat the tap as a new first letter
        w.first = cell;
        play('tap');
        renderBoard();
        renderStrip();
      }
      return;
    }
    if (!cand.lockable) {
      w.first = null;
      renderBoard();
      shakeCells(cand.cells);
      play('buzz');
      say(`${cand.word}: ${cand.reason}`, 'bad', 2800);
      return;
    }
    w.first = null;
    commitLock(cand);
  }

  // ---------------------------------------------------------------------------
  // Pointer gestures: drag to swap, flick or long drag to slide, hold for the menu

  function neighbourIn(cell, axis, dir) {
    const { rowOf, colOf, idx, inRange } = grid();
    const r = rowOf(cell) + (axis === 'col' ? dir : 0);
    const c = colOf(cell) + (axis === 'row' ? dir : 0);
    if (!inRange(r) || !inRange(c)) return null;
    return idx(r, c);
  }

  function swapLegal(a, b) {
    const st = w.game.state;
    return !st.locked.includes(a) && !st.locked.includes(b);
  }

  function canSlideLine(axis, index) {
    return lineCellsFree(w.game.state, axis, index).length >= 2;
  }

  function onPointerDown(e) {
    if (w.gesture && performance.now() - w.gesture.t0 > 4000) cancelGesture(); // a release the board never heard
    if (!e.isPrimary || e.button !== 0 || w.gesture) return;
    const tile = e.target.closest('.tile');
    if (tile && w.perk) return perkPointerDown(e, tile);
    if (!tile || !canInteract()) return;
    if (!$('#w-tilemenu').hidden) {
      closeMenu();
      return;
    }
    const cell = Number(tile.dataset.cell);
    const t = performance.now();
    w.gesture = {
      id: e.pointerId,
      cell,
      t0: t,
      x0: e.clientX,
      y0: e.clientY,
      x: e.clientX,
      y: e.clientY,
      samples: [{ t, x: e.clientX, y: e.clientY }],
      mode: 'press', // press | drag | line | menu
      step: tileStep(boardEl) || 60,
      axis: null,
      dir: 0,
      target: null,
      timer: setTimeout(() => openMenuFromGesture(cell), LONG_PRESS_MS),
    };
    try {
      boardEl.setPointerCapture(e.pointerId);
    } catch {
      // capture is best-effort
    }
    e.preventDefault();
  }

  function pushSample(g, e) {
    const t = performance.now();
    g.samples.push({ t, x: e.clientX, y: e.clientY });
    if (g.samples.length > 8) g.samples.shift();
  }

  function geometry(g) {
    const dx = g.x - g.x0;
    const dy = g.y - g.y0;
    const axis = Math.abs(dx) >= Math.abs(dy) ? 'row' : 'col';
    const along = axis === 'row' ? dx : dy;
    const cross = axis === 'row' ? dy : dx;
    const { rowOf, colOf } = grid();
    return { dx, dy, axis, dir: along >= 0 ? 1 : -1, travel: Math.abs(along) / g.step, cross: Math.abs(cross) / g.step, index: axis === 'row' ? rowOf(g.cell) : colOf(g.cell) };
  }

  function onPointerMove(e) {
    const g = w.gesture;
    if (!g || e.pointerId !== g.id) return;
    g.x = e.clientX;
    g.y = e.clientY;
    pushSample(g, e);
    if (g.mode === 'menu' || g.mode === 'perk') return;
    if (!canInteract()) {
      cancelGesture(); // the board changed under the finger (goal reached, board scored)
      return;
    }
    const { dx, dy, axis, dir, travel, cross } = geometry(g);
    if (g.mode === 'press') {
      if (Math.hypot(dx, dy) < TAP_SLOP) return;
      clearTimeout(g.timer);
      g.mode = 'drag';
      g.tDrag = performance.now(); // the movement starts here; time spent holding still before it does not count
      g.lockedTile = w.game.state.locked.includes(g.cell);
      if (w.first !== null || w.pending) {
        w.first = null;
        w.pending = null;
        renderBoard();
        renderStrip();
      }
      if (!g.lockedTile) tileEl(g.cell).classList.add('dragging');
    }
    if (g.lockedTile) return; // a locked tile cannot be dragged anywhere; only a flick moves its line
    // The tile follows the finger. Once the movement is slower than any flick could be (its average
    // speed is under the flick floor, which no further distance can change) the intent is committed: the
    // neighbour in the direction of travel lights up and the release will swap however fast it ends.
    // Pausing over the neighbour lowers the average, so a hover confirms too. Coming back near the start
    // reopens the decision.
    tileEl(g.cell).style.transform = `translate(${dx}px, ${dy}px) scale(1.08)`;
    if (travel < SWAP_TRAVEL) g.intent = null;
    else if (cross < SWAP_CROSS && tilesPerSecond(g, travel) < FLICK_MIN_SPEED) g.intent = 'drag';
    const target = g.intent === 'drag' && cross < SWAP_CROSS ? neighbourIn(g.cell, axis, dir) : null;
    setDropTarget(g, target, axis, dir);
  }

  function setDropTarget(g, cell, axis, dir) {
    if (g.target === cell) return;
    if (g.target !== null) {
      const old = tileEl(g.target);
      old.classList.remove('drop-target', 'no-drop');
      old.style.transform = '';
    }
    g.target = cell;
    if (cell === null) return;
    const t = tileEl(cell);
    if (swapLegal(g.cell, cell)) {
      t.classList.add('drop-target');
      // the neighbour slips into the dragged tile's old place: a preview of the swap
      t.style.transform = axis === 'row' ? `translate(${-dir * g.step}px, 0)` : `translate(0, ${-dir * g.step}px)`;
    } else {
      t.classList.add('no-drop');
    }
  }

  /** Average speed of the movement so far, in tiles per second, counted from the moment the finger started moving. */
  function tilesPerSecond(g, travel) {
    const ms = Math.max(1, performance.now() - (g.tDrag || g.t0));
    return (travel * 1000) / ms;
  }

  /** Was this movement a flick? Its average speed against the distance line above. */
  function isFlick(g, travel) {
    if (travel < FLICK_MIN_TRAVEL) return false;
    return tilesPerSecond(g, travel) >= Math.max(FLICK_MIN_SPEED, FLICK_SPEED_AT_ZERO - FLICK_SPEED_PER_TILE * travel);
  }

  /** Abandon a gesture in flight (the board changed under it, or the screen is leaving). */
  function cancelGesture() {
    const g = w.gesture;
    if (!g) return;
    w.gesture = null;
    clearTimeout(g.timer);
    try {
      boardEl.releasePointerCapture(g.id);
    } catch {
      // nothing captured
    }
    if (g.mode === 'drag') snapBack(g);
  }

  function endGesture(e) {
    const g = w.gesture;
    if (!g || e.pointerId !== g.id) return null;
    w.gesture = null;
    clearTimeout(g.timer);
    try {
      boardEl.releasePointerCapture(e.pointerId);
    } catch {
      // nothing to release
    }
    w.pointerTs = performance.now();
    return g;
  }

  function snapBack(g) {
    const t = tileEl(g.cell);
    t.classList.remove('dragging');
    t.style.transform = '';
    setDropTarget(g, null);
  }

  function onPointerUp(e) {
    const g = endGesture(e);
    if (!g || g.mode === 'menu') return;
    if (g.mode === 'perk') return perkPointerUp(g, e);
    if (!canInteract()) {
      snapBack(g);
      return;
    }
    if (g.mode === 'press') {
      onTileTap(g.cell);
      return;
    }
    g.x = e.clientX;
    g.y = e.clientY;
    pushSample(g, e);
    const { axis, dir, travel, cross, index } = geometry(g);
    const t = tileEl(g.cell);
    if (g.intent !== 'drag' && isFlick(g, travel)) {
      if (canSlideLine(axis, index)) {
        setDropTarget(g, null);
        t.classList.remove('dragging');
        t.style.transform = '';
        doAction({ type: 'slide', axis, index, dir });
      } else {
        snapBack(g);
        shakeCells(grid().lineCells(axis, index));
        play('buzz');
        say('That line is locked in place', 'bad');
      }
      return;
    }
    const target = travel >= SWAP_TRAVEL && cross < SWAP_CROSS ? neighbourIn(g.cell, axis, dir) : null;
    if (target !== null && !g.lockedTile && swapLegal(g.cell, target)) {
      const { rowOf, colOf } = grid();
      t.classList.remove('dragging');
      doAction({ type: 'swap', r: rowOf(g.cell), c: colOf(g.cell), r2: rowOf(target), c2: colOf(target) });
      return;
    }
    snapBack(g);
    if (target !== null) {
      shakeCells([g.cell, target]);
      play('buzz');
      say('Locked tiles cannot be swapped', 'bad');
    }
  }

  function onPointerCancel(e) {
    const g = endGesture(e);
    if (!g || g.mode === 'menu' || g.mode === 'perk') return;
    snapBack(g);
  }

  // ---------------------------------------------------------------------------
  // Long-press menu: nudge down / nudge up / draw / wild

  function openMenuFromGesture(cell) {
    const g = w.gesture;
    if (!g || g.cell !== cell || g.mode !== 'press') return;
    // the gesture is over: the finger may lift over the menu backdrop, where the board never hears it
    w.gesture = null;
    try {
      boardEl.releasePointerCapture(g.id);
    } catch {
      // nothing captured
    }
    w.pointerTs = performance.now();
    openMenu(cell);
  }

  function openMenu(cell) {
    if (!canInteract() || w.perk) return;
    if (w.gesture && w.gesture.mode !== 'menu') cancelGesture(); // opened from the keyboard mid-drag
    const st = w.game.state;
    const ch = st.board[cell];
    const locked = st.locked.includes(cell);
    w.menuCell = cell;
    w.first = null;
    renderBoard();
    renderStrip();
    const menu = $('#w-tilemenu');
    const isWild = ch === WILD;
    menu.querySelector('[data-act="nudge-down"]').hidden = isWild;
    menu.querySelector('[data-act="nudge-up"]').hidden = isWild;
    if (!isWild) {
      $('#tm-prev').textContent = nudgeLetter(ch, -1);
      $('#tm-next').textContent = nudgeLetter(ch, 1);
    }
    menu.querySelector('[data-act="draw"]').disabled = bagTotal(st.bag) === 0;
    const pk = st.perk;
    $('#tm-draw-sub').textContent = pk && pk.choiceDraw ? 'Pick of 3' : pk && pk.peek ? `Draw · ${peekDraws(st, 1)[0] || '?'}` : 'Draw';
    menu.querySelector('[data-act="wild"]').hidden = !(locked && !isWild && st.turns + WILD_COST <= limit() && (st.wilds || 0) < MAX_WILDS);
    menu.hidden = false;
    $('#w-menu-backdrop').hidden = false;
    tileEl(cell).classList.add('selected');
    positionMenu();
    play('tap');
    if (navigator.vibrate) {
      try {
        navigator.vibrate(12);
      } catch {
        // optional
      }
    }
  }

  function positionMenu() {
    const menu = $('#w-tilemenu');
    if (menu.hidden || w.menuCell === null) return;
    const tr = tileEl(w.menuCell).getBoundingClientRect();
    const wr = wrapEl.getBoundingClientRect();
    const mw = menu.offsetWidth || 200;
    const mh = menu.offsetHeight || 72;
    const cx = tr.left - wr.left + tr.width / 2;
    const left = Math.max(mw / 2 + 2, Math.min(wr.width - mw / 2 - 2, cx));
    let top = tr.top - wr.top - mh - 12;
    const below = top < 0;
    if (below) top = tr.bottom - wr.top + 12;
    menu.classList.toggle('below', below);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.setProperty('--caret', `${Math.max(14, Math.min(mw - 14, cx - (left - mw / 2)))}px`);
  }

  function closeMenu() {
    const menu = $('#w-tilemenu');
    if (menu.hidden) return;
    w.pointerTs = performance.now(); // the release that follows is not a tap
    menu.hidden = true;
    $('#w-menu-backdrop').hidden = true;
    if (w.menuCell !== null) tileEl(w.menuCell).classList.remove('selected');
    w.menuCell = null;
  }

  function onMenuAction(act) {
    const cell = w.menuCell;
    closeMenu();
    if (cell === null) return;
    const { rowOf, colOf } = grid();
    const r = rowOf(cell);
    const c = colOf(cell);
    if (act === 'nudge-down') doAction({ type: 'nudge', r, c, delta: -1 });
    else if (act === 'nudge-up') doAction({ type: 'nudge', r, c, delta: 1 });
    else if (act === 'draw') {
      if (w.game.state.perk && w.game.state.perk.choiceDraw) openDraw3(cell); // Choice Draw is armed: three letters, keep one
      else doAction({ type: 'draw', r, c });
    }
    else if (act === 'wild') doAction({ type: 'wild', r, c });
  }

  // ---------------------------------------------------------------------------
  // Actions

  function snapshotForUndo(state) {
    return JSON.parse(JSON.stringify(state));
  }

  async function doAction(action) {
    if (!canInteract()) {
      renderBoard(); // drop any drag or preview visuals
      return;
    }
    const before = w.game.state;
    let next;
    try {
      next = applyWordAction(before, action);
    } catch (e) {
      renderBoard();
      say(e.message, 'bad');
      return;
    }
    clearHint();
    // A draw is random, so free play's undo cannot go back past one; a perk run keeps the snapshot for Rewind,
    // which rerolls the next draw when it takes one back.
    if (action.type !== 'draw') w.game.history.push(snapshotForUndo(before));
    else if (perks()) w.game.history.push(Object.assign(snapshotForUndo(before), { undoneDraw: true }));
    else w.game.history = [];
    w.game.state = next;
    persist();
    w.first = null;
    w.pending = null;
    w.animating = true;
    play(action.type === 'nudge' ? (action.delta === -1 ? 'nudgeDown' : 'nudge') : action.type);
    if (action.type === 'slide') await animateMoves(boardEl, slideMoves(before, action));
    else if (action.type === 'wild') {
      const t = tileEl(grid().idx(action.r, action.c));
      t.classList.add('wild-pop');
      setTimeout(() => setFace(t, WILD), 240);
      await new Promise((r) => setTimeout(r, 520));
    } else await animateAction(boardEl, action, before.board, next.board, setFace);
    w.animating = false;
    renderAll();
    if (action.type === 'draw' && next.lastDraw) {
      const d = next.lastDraw;
      floatAt(d.cell, `${d.tossed === WILD ? '★' : d.tossed} → ${d.drawn}`, 'neutral');
    }
    afterTurn(next, 0);
  }

  function commitLock(cand) {
    if (!cand || !canInteract()) return;
    let next;
    try {
      next = lockWord(w.game.state, cand);
    } catch (e) {
      setPending(null);
      say(e.message, 'bad');
      return;
    }
    clearHint();
    w.game.history.push(snapshotForUndo(w.game.state));
    w.game.state = next;
    w.pending = null;
    w.first = null;
    persist();
    renderAll();
    play('lock');
    const motion = reduceMotion() ? 0 : 60;
    cand.cells.forEach((c, i) => setTimeout(() => tileEl(c).classList.add('lock-pop'), i * motion));
    floatAt(cand.cells[Math.floor(cand.cells.length / 2)], `${cand.word} +${cand.score}`, 'good');
    afterTurn(next, cand.cells.length * motion);
  }

  /** Finish the current board after a short pause for the animations; cancelled if the game changes. */
  function finishSoon(ms) {
    const game = w.game;
    w.animating = true;
    clearTimeout(w.finishTimer);
    w.finishTimer = setTimeout(() => {
      w.finishTimer = null;
      w.animating = false;
      if (w.game === game && !w.over) finish(true);
    }, ms);
  }

  /** Score a board whose end was still pending (used when leaving the screen inside that pause). */
  function flushFinish() {
    if (!w.finishTimer) return;
    clearTimeout(w.finishTimer);
    w.finishTimer = null;
    w.animating = false;
    if (w.game && !w.over) finish(true, true);
  }

  /** What happens once a turn is spent: the level bar takes over, the board fills, or the turns run out. */
  function afterTurn(next, delay) {
    if (goalReached()) return; // the level bar shows Next level
    if (isBoardFull(next)) {
      const bonus = fullCoverTurnBonus(next);
      const spare = Math.max(0, turnLimit(next) - next.turns);
      say(bonus ? `Board complete with ${spare} turn${spare === 1 ? '' : 's'} to spare: +${bonus}!` : 'Board complete!', 'good', 4000);
      finishSoon(1600 + delay);
      return;
    }
    if (next.turns >= turnLimit(next)) finishSoon(500 + delay); // the last turn is spent: score the board
  }

  function undo() {
    const g = w.game;
    if (!g || w.over || w.animating || !g.history.length || g.mode === 'levels') return;
    cancelGesture();
    g.state = g.history.pop();
    persist();
    play('undo');
    w.first = null;
    w.pending = null;
    closeMenu();
    renderAll();
    say(g.history.length ? 'Move undone' : 'Move undone · nothing further back', '', 1800);
  }

  // ---------------------------------------------------------------------------
  // Perk cards: the hand, playing a card, targeting on the board, the pickers, the market

  /** A card is played: it leaves the hand (a shop card already left the deck when it was bought). */
  function spendCard(id) {
    const run = perks();
    if (!run) return;
    const i = run.hand.indexOf(id);
    if (i >= 0) run.hand.splice(i, 1);
    persist();
    renderHud();
  }

  /** Why a card in hand cannot be played right now, or '' when it can. */
  function cardBlock(id) {
    const run = perks();
    const g = w.game;
    if (!run || !g) return 'No run in play';
    if (w.over) return 'The board is over';
    if (w.perk) return `${CARD_BY_ID[w.perk.id] ? CARD_BY_ID[w.perk.id].name : 'A card'} is in play: finish or cancel it first`;
    if (id === 'gold-rush' && run.goldRush) return 'Already in play';
    if (goalReached()) return 'The goal is reached';
    if (w.animating) return 'Wait a moment';
    if (g.state.turns >= turnLimit(g.state)) return 'The turns are spent';
    return playBlock(id, g.state, { historyLength: g.history.length });
  }

  function cardHtml(c, cost, why, button, info = false) {
    const infoBtn = info ? `<button type="button" class="btn mk-info" aria-label="What ${c.name} does">i</button>` : '';
    return `<span class="mk-fam">${FAMILIES[c.family]}</span><span class="mk-name">${c.name}</span><span class="mk-cost">${cost}</span>${infoBtn}<p class="mk-text">${cardText(c, w.game ? w.game.size : 5)}</p><div class="mk-act"><span class="mk-why">${why}</span>${button}</div>`;
  }

  /** A card's full text in a popup above its info button (wide screens hide the text on the market cards). */
  function toggleInfoPop(c, anchor) {
    const pop = $('#w-tilepop');
    if (!pop.hidden && tilePopAnchor === anchor) return closeTilePop();
    openPopAt(`<div class="tp-info"><b>${c.name}</b><p>${cardText(c, w.game ? w.game.size : 5)}</p></div>`, anchor);
    clearTimeout(w.infoPopTimer);
    w.infoPopTimer = setTimeout(() => {
      if (tilePopAnchor === anchor) closeTilePop();
    }, 7000);
  }

  /** The hand sheet: every card bought so far, with Play where it can be played now. */
  function openHand() {
    const run = perks();
    if (!run) return;
    if (run.shop) return openShop();
    closeMenu();
    cancelGesture();
    const sheet = $('#w-handsheet');
    $('#w-hand-gold').textContent = `◆ ${run.gold}`;
    $('#w-hand-gold').hidden = !!run.retry;
    $('#w-hand-sub').textContent = run.retry ? 'Retry: the hand you had going in' : 'Each card is one use';
    const list = $('#w-hand-cards');
    list.innerHTML = '';
    if (!run.hand.length) list.innerHTML = '<p class="mk-empty">No cards in hand. Pass a level and visit the market.</p>';
    for (const id of run.hand) {
      const c = CARD_BY_ID[id];
      if (!c) continue;
      const why = cardBlock(id);
      const el = document.createElement('div');
      el.className = `mk-card${why ? ' cannot' : ''}`;
      el.innerHTML = cardHtml(c, c.turn ? `${c.turn} turn` : 'no turn', why, `<button type="button" class="btn btn-primary btn-small" ${why ? 'disabled' : ''}>Play</button>`);
      el.querySelector('button').addEventListener('click', () => {
        closeSheet(sheet);
        playCard(id);
      });
      list.appendChild(el);
    }
    openSheet(sheet);
  }

  /** Play a card from the hand: cards without a target resolve now; the others arm targeting on the board. */
  function playCard(id, opts = {}) {
    const c = CARD_BY_ID[id];
    const why = c ? cardBlock(id) : 'Unknown card';
    if (why) {
      refund(opts.paid, id);
      return say(why, 'bad');
    }
    const paid = opts.paid || 0;
    cancelGesture();
    closeMenu();
    clearHint();
    w.first = null;
    w.pending = null;
    const g = w.game;
    const st = g.state;
    const flag = (key, value, note) => resolvePerk(id, { type: 'flag', key, value }, note, paid);
    switch (id) {
      case 'fresh-deal':
        return freshDeal();
      case 'choice-draw':
        return flag('choiceDraw', true, 'Choice Draw armed: your next Draw offers three letters');
      case 'power-pair':
        return resolvePerk(id, { type: 'squares', cells: powerPairCells(st) || [] }, 'Power Pair: a Double and a Triple Letter square landed', paid);
      case 'double-down':
        return flag('double', true, 'Double Down: your next word scores its letters twice');
      case 'stretch':
        return flag('stretch', true, 'Stretch Bonus: your next word of 4 or more letters gets the bonus one rung up');
      case 'crossroads':
        return flag('crossroads', true, 'Crossroads: +2 for every word that reuses a locked tile');
      case 'diagonal':
        return flag('diagonal', true, 'Diagonal Dividend: +5 for every diagonal word');
      case 'open-field':
        return flag('openField', true, 'Open Field: +4 for every word that uses no locked tile');
      case 'short-stack':
        return flag('shortStack', true, 'Short Stack: +3 for every 3-letter word');
      case 'long-haul':
        return flag('longHaul', true, `Long Haul: +8 for every ${g.size}-letter word`);
      case 'head-start':
        return flag('headStart', true, 'Head Start: the tile ladder starts a tile early');
      case 'extra-turn':
        return resolvePerk(id, { type: 'turns', n: 1 }, 'One more turn this level', paid);
      case 'borrowed-time':
        return resolvePerk(id, { type: 'turns', n: 2 }, 'Two more turns this level', paid);
      case 'peek':
        return flag('peek', true, `Peek: the next draw brings ${peekDraws(st, 1)[0] || '?'}`);
      case 'rewind':
        return perkRewind();
      case 'hint':
        return showHint();
      case 'gold-rush':
        g.perks.goldRush = true;
        spendCard(id);
        return say('Gold Rush: this level’s spare turns pay double gold', 'good', 3000);
      default:
        break;
    }
    // a card that needs a target: the board lights up the tiles it can take (cancelling refunds a shop price)
    w.perk = { id, picked: [], paid };
    renderBoard();
    renderStrip();
    play('tap');
  }

  /** Resolve a card's board action on the spot: the state moves on, the card is spent, the board redraws. */
  function resolvePerk(id, action, note, paid = 0) {
    const g = w.game;
    let next;
    try {
      next = applyPerkAction(g.state, action);
    } catch (e) {
      refund(paid, id);
      return say(e.message, 'bad');
    }
    g.state = next;
    spendCard(id);
    renderAll();
    if (action.type === 'squares') for (const { cell } of action.cells) tileEl(cell).classList.add('lock-pop');
    play('lock');
    if (note) say(note, 'good', 3200);
  }

  /** Apply a targeted card's action with its animation; the card is spent and targeting ends. opts: { card, keepCard, note }. */
  async function doPerkAction(action, opts = {}) {
    const g = w.game;
    const id = w.perk ? w.perk.id : opts.card;
    const before = g.state;
    let next;
    try {
      next = applyPerkAction(before, action);
    } catch (e) {
      say(e.message, 'bad');
      return false;
    }
    // a redraw is random: Rewind may take it back, and then rerolls the bag's next letter
    const random = action.type === 'draw3' || action.type === 'exchange' || action.type === 'freshline';
    g.history.push(random ? Object.assign(snapshotForUndo(before), { undoneDraw: true }) : snapshotForUndo(before));
    g.state = next;
    w.perk = null;
    if (id && !opts.keepCard) spendCard(id);
    persist();
    w.first = null;
    w.pending = null;
    clearTargeting();
    w.animating = true;
    await animatePerk(action, before, next);
    w.animating = false;
    renderAll();
    if (next.lastDraw) floatAt(next.lastDraw.cell, `${next.lastDraw.tossed === WILD ? '★' : next.lastDraw.tossed} → ${next.lastDraw.drawn}`, 'neutral');
    if (opts.note) say(opts.note, 'good', 3000);
    afterTurn(next, 0);
    return true;
  }

  function clearTargeting() {
    boardEl.classList.remove('targeting');
    for (const t of boardEl.querySelectorAll('.tile')) t.classList.remove('perk-ok', 'perk-picked');
  }

  async function animatePerk(action, before, next) {
    if (reduceMotion()) return;
    const { rowOf, colOf, idx } = grid();
    switch (action.type) {
      case 'pswap':
      case 'trade':
        play('swap');
        await animateAction(boardEl, { type: 'swap', r: rowOf(action.a), c: colOf(action.a), r2: rowOf(action.b), c2: colOf(action.b) }, before.board, next.board, setFace);
        return;
      case 'rotate': {
        // each tile slides straight to where the turn takes it
        const ring = rotateRing(grid(), action.cell);
        const step = tileStep(boardEl) || 60;
        const turns = action.turns || 1;
        ring.forEach((cell, k) => {
          const to = ring[(k + turns) % 4];
          const t = tileEl(cell);
          t.classList.add('moving');
          t.style.transform = `translate(${(colOf(to) - colOf(cell)) * step}px, ${(rowOf(to) - rowOf(cell)) * step}px)`;
        });
        play('swap');
        await wait(ANIM_MS + 60);
        return;
      }
      case 'setletter':
        play('nudge');
        await animateAction(boardEl, { type: 'nudge', r: rowOf(action.cell), c: colOf(action.cell), delta: 1 }, before.board, next.board, setFace);
        return;
      case 'draw3':
        play('draw');
        await animateAction(boardEl, { type: 'draw', r: rowOf(action.cell), c: colOf(action.cell) }, before.board, next.board, setFace);
        return;
      case 'exchange':
      case 'freshline': {
        const cells = (next.lastRedraw || []).map((x) => x.cell);
        for (const cell of cells) tileEl(cell).classList.add('spin');
        setTimeout(() => cells.forEach((cell) => setFace(tileEl(cell), next.board[cell])), 170);
        play('draw');
        await wait(380);
        return;
      }
      case 'slideN': {
        // one slide animation per step, the faces catching up between them
        const one = { type: 'slide', axis: action.axis, index: action.index, dir: action.dir };
        let cur = before;
        for (let k = 0; k < action.steps; k++) {
          const after = { ...cur, board: cur.board.slice() };
          const moves = slideMoves(cur, one);
          for (const m of moves) after.board[m.to] = cur.board[m.from];
          play('slide');
          const reset = beginMoves(boardEl, moves);
          await wait(ANIM_MS + 30);
          if (k < action.steps - 1) {
            reset();
            for (const m of moves) setFace(tileEl(m.to), after.board[m.to]);
          }
          cur = after;
        }
        return;
      }
      case 'wildcard': {
        const t = tileEl(action.cell);
        t.classList.add('wild-pop');
        setTimeout(() => setFace(t, WILD), 240);
        play('wild');
        await wait(520);
        return;
      }
      case 'unlock':
      case 'squares':
      case 'sticker': {
        const cells = action.type === 'squares' ? action.cells.map((x) => x.cell) : [action.cell];
        for (const cell of cells) tileEl(cell).classList.add('lock-pop');
        play('lock');
        await wait(300);
        return;
      }
      default:
    }
  }

  /** The cells a tap may pick for the card being targeted, at its current step. */
  function perkValidCells() {
    const pk = w.perk;
    const set = new Set();
    if (!pk || !w.game) return set;
    const st = w.game.state;
    const g = grid();
    const all = st.board.map((_, i) => i);
    const free = (i) => !st.locked.includes(i);
    const inLine = (a, b) => g.rowOf(a) === g.rowOf(b) || g.colOf(a) === g.colOf(b);
    const sq = (st.perk && st.perk.squares) || {};
    const stk = (st.perk && st.perk.stickers) || {};
    const add = (cells) => cells.forEach((i) => set.add(i));
    switch (pk.id) {
      case 'long-swap':
        if (!pk.picked.length) add(all.filter((a) => free(a) && all.some((b) => b !== a && free(b) && inLine(a, b))));
        else add([pk.picked[0], ...all.filter((b) => b !== pk.picked[0] && free(b) && inLine(pk.picked[0], b))]);
        break;
      case 'letter-trade':
        add(all);
        break;
      case 'rotate':
        add(rotateBlocks(st));
        break;
      case 'unlock':
        add(st.locked);
        break;
      case 'big-nudge':
      case 'wild-card':
        add(all.filter((i) => st.board[i] !== WILD));
        break;
      case 'pick-letter':
        add(all.filter(free));
        break;
      case 'sticker':
        add(all.filter((i) => free(i) && !stk[i]));
        break;
      case 'triple-up':
        add(all.filter((i) => free(i) && st.board[i] !== WILD && !sq[i]));
        break;
      case 'exchange':
        if (pk.picked.length < 3) add(all.filter(free));
        add(pk.picked);
        break;
      case 'fresh-line':
        add(all.filter((i) => lineCellsFree(st, 'row', g.rowOf(i)).length || lineCellsFree(st, 'col', g.colOf(i)).length));
        break;
      case 'long-flick':
        add(all.filter((i) => lineCellsFree(st, 'row', g.rowOf(i)).length >= 3 || lineCellsFree(st, 'col', g.colOf(i)).length >= 3));
        break;
      default:
    }
    return set;
  }

  /** The strip while a card is being targeted: what to do, with Cancel (and Done for Exchange). */
  function perkPrompt() {
    const pk = w.perk;
    const cancel = { label: 'Cancel', fn: cancelPerk };
    const texts = {
      'long-swap': pk.picked.length ? 'Now tap the tile to swap with, in the same row or column' : 'Long Swap: tap the first tile',
      'letter-trade': pk.picked.length ? 'Now tap the tile to trade letters with' : 'Letter Trade: tap the first tile',
      rotate: 'Rotate: tap the top-left tile of a 2×2 block',
      unlock: 'Unlock: tap a locked tile',
      'big-nudge': 'Big Nudge: tap a tile',
      'pick-letter': 'Pick a Letter: tap an unlocked tile',
      'triple-up': 'Triple Up: tap an unlocked tile',
      sticker: 'Gold Sticker: tap an unlocked tile',
      'wild-card': 'Wild Card: tap any tile',
      exchange: `Exchange: tap up to three tiles (${pk.picked.length}/3)`,
      'fresh-line': 'Fresh Line: tap a tile in the row or column',
      'long-flick': 'Long Flick: flick a row or column',
    };
    if (pk.id === 'exchange') return { text: texts.exchange, primary: { label: 'Done', fn: finishExchange, disabled: !pk.picked.length }, secondary: cancel };
    return { text: texts[pk.id] || CARD_BY_ID[pk.id].name, primary: cancel, secondary: null };
  }

  /** Put a card being targeted back in the hand, unspent (a shop price is refunded). */
  function cancelPerk() {
    if (!w.perk) return;
    const { paid, id } = w.perk;
    w.perk = null;
    closePerkPick();
    if (w.game) {
      renderBoard();
      renderStrip();
    }
    if (paid) {
      refund(paid, id);
      say(`Card put back: ${paid} gold refunded`, '', 2200);
    }
  }

  /** Drop targeting without a word (play stopped under it); a shop price goes back. */
  function dropTargeting() {
    if (!w.perk) return;
    const { paid, id } = w.perk;
    w.perk = null;
    closePerkPick();
    clearTargeting();
    refund(paid, id);
  }

  /** A shop purchase that came to nothing: the gold comes back and the card returns to the deck. */
  function refund(amount, id) {
    const run = perks();
    if (!run || !amount) return;
    run.gold += amount;
    if (run.shop && id && !run.deck.includes(id)) run.deck.push(id);
    persist();
    renderHud();
    renderGoalBar();
  }

  // ---- the shop: the whole catalogue, any time, each card played as it is bought ----------------------
  function openShop() {
    const run = perks();
    if (!run) return;
    closeMenu();
    cancelGesture();
    renderShop();
    openSheet($('#w-shop'));
  }

  const wideShop = () => matchMedia('(orientation: landscape) and (min-width: 640px)').matches;

  /**
   * The shop. In portrait the cards sit under family headings that open one at a time, or in one list by
   * price; on a wide screen they are always by price, four to a row. A card the gold cannot buy is only
   * dimmed; one the board cannot take says why; one bought earlier in the run is marked used.
   */
  function renderShop() {
    const run = perks();
    const g = w.game;
    if (!run || !g) return;
    $('#w-shop-gold').textContent = `◆ ${run.gold}`;
    $('#w-shop-sub').textContent = run.retry ? 'Retry: nothing is counted' : 'Each card is one use · plays at once';
    const list = $('#w-shop-cards');
    list.innerHTML = '';
    const byType = !wideShop() && w.shopSort !== 'price';
    list.classList.toggle('by-type', byType);
    const cardEl = (c) => {
      const used = !run.deck.includes(c.id);
      const why = used ? '' : cardBlock(c.id);
      const afford = run.gold >= c.cost;
      const blocked = used || !!why || !afford;
      const el = document.createElement('div');
      el.className = `mk-card${blocked ? ' cannot' : ''}${used ? ' bought' : ''}`;
      el.innerHTML = cardHtml(c, `◆ ${c.cost}`, used ? 'Used' : why, `<button type="button" class="btn btn-primary btn-small mk-buy" ${blocked ? 'disabled' : ''}>Buy</button>`, true);
      el.querySelector('.mk-info').addEventListener('click', (e) => toggleInfoPop(c, e.currentTarget));
      el.querySelector('.mk-buy').addEventListener('click', () => shopBuy(c.id));
      return el;
    };
    if (!byType) {
      for (const c of shopOrder('price')) list.appendChild(cardEl(c));
      return;
    }
    const groups = new Map();
    for (const c of shopOrder('type')) {
      if (!groups.has(c.family)) groups.set(c.family, []);
      groups.get(c.family).push(c);
    }
    if (!groups.has(w.shopGroup)) w.shopGroup = groups.keys().next().value;
    for (const [family, cards] of groups) {
      const d = document.createElement('details');
      d.className = 'shop-group';
      d.open = family === w.shopGroup;
      const left = cards.filter((c) => run.deck.includes(c.id)).length;
      d.innerHTML = `<summary><span>${FAMILIES[family]}</span><small>${left} of ${cards.length} left</small></summary><div class="mk-cards"></div>`;
      const box = d.querySelector('.mk-cards');
      for (const c of cards) box.appendChild(cardEl(c));
      d.addEventListener('toggle', () => {
        if (!d.open) return;
        w.shopGroup = family; // one group open at a time, remembered
        for (const o of list.querySelectorAll('.shop-group')) if (o !== d) o.open = false;
      });
      list.appendChild(d);
    }
  }

  /** Buy a card in the shop: the gold goes and the card leaves the deck for the run; it plays at once. */
  function shopBuy(id) {
    const run = perks();
    const c = CARD_BY_ID[id];
    if (!run || !c) return;
    const block = shopBuyBlock(run, id) || cardBlock(id);
    if (block) return ctx.showToast(block);
    shopTake(run, id);
    persist();
    play('lock');
    renderHud();
    closeSheet($('#w-shop'));
    playCard(id, { paid: c.cost });
  }

  function perkPointerDown(e, tile) {
    const t = performance.now();
    w.gesture = { id: e.pointerId, cell: Number(tile.dataset.cell), t0: t, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, samples: [{ t, x: e.clientX, y: e.clientY }], mode: 'perk', step: tileStep(boardEl) || 60, axis: null, dir: 0, target: null, timer: null };
    try {
      boardEl.setPointerCapture(e.pointerId);
    } catch {
      // capture is best-effort
    }
    e.preventDefault();
  }

  function perkPointerUp(g, e) {
    if (!w.perk) return;
    g.x = e.clientX;
    g.y = e.clientY;
    pushSample(g, e);
    const moved = Math.hypot(g.x - g.x0, g.y - g.y0);
    if (w.perk.id === 'long-flick') {
      const { axis, dir, travel, index } = geometry(g);
      if (travel >= FLICK_MIN_TRAVEL) return perkFlick(axis, index, dir);
      if (moved < TAP_SLOP) say('Flick a row or column, a quick swipe along the line', '');
      return;
    }
    if (moved < TAP_SLOP * 2) perkTap(g.cell);
  }

  /** A tap on the board while a card is being targeted. */
  function perkTap(cell) {
    const pk = w.perk;
    if (!pk || !canInteract()) return;
    const st = w.game.state;
    if (!perkValidCells().has(cell)) {
      shakeCells([cell]);
      play('buzz');
      return;
    }
    const { rowOf, colOf } = grid();
    switch (pk.id) {
      case 'long-swap':
      case 'letter-trade': {
        if (!pk.picked.length) {
          pk.picked = [cell];
          play('tap');
          renderBoard();
          renderStrip();
          return;
        }
        const a = pk.picked[0];
        if (a === cell) {
          pk.picked = [];
          renderBoard();
          renderStrip();
          return;
        }
        doPerkAction(pk.id === 'long-swap' ? { type: 'pswap', a, b: cell } : { type: 'trade', a, b: cell });
        return;
      }
      case 'rotate': {
        const options = [{ label: '¼ turn', wide: true }, { label: '½ turn', wide: true }, { label: '¾ turn', wide: true }];
        openPerkPick({ title: 'Rotate', sub: 'Clockwise, the whole block', options, onPick: (k) => doPerkAction({ type: 'rotate', cell, turns: k + 1 }) });
        return;
      }
      case 'unlock':
        doPerkAction({ type: 'unlock', cell }, { note: 'Unlocked: the tile can move again' });
        return;
      case 'triple-up':
        doPerkAction({ type: 'squares', cells: [{ cell, mult: 3 }] }, { note: 'Triple Letter: pays when a word locks that cell' });
        return;
      case 'sticker':
        doPerkAction({ type: 'sticker', cell }, { note: '+5 for every word that uses that cell' });
        return;
      case 'wild-card':
        doPerkAction({ type: 'wildcard', cell });
        return;
      case 'big-nudge': {
        const ch = st.board[cell];
        const options = bigNudgeOptions(ch);
        openPerkPick({ title: `Big Nudge: ${ch} becomes…`, sub: 'Up to three letters either way', options: options.map((l) => ({ label: l, small: String(letterValue(l)) })), onPick: (k) => doPerkAction({ type: 'setletter', cell, letter: options[k] }) });
        return;
      }
      case 'pick-letter': {
        const old = st.board[cell];
        openPerkPick({ title: 'Pick a Letter', sub: `From the bag; the ${old === WILD ? 'wild' : old} goes back in`, options: LETTERS.map((l) => ({ label: l, small: String(st.bag[l]), disabled: !(st.bag[l] > 0) })), onPick: (k) => doPerkAction({ type: 'setletter', cell, letter: LETTERS[k], fromBag: true }) });
        return;
      }
      case 'exchange': {
        const i = pk.picked.indexOf(cell);
        if (i >= 0) pk.picked.splice(i, 1);
        else if (pk.picked.length < 3) pk.picked.push(cell);
        play('tap');
        renderBoard();
        renderStrip();
        return;
      }
      case 'fresh-line': {
        const r = rowOf(cell);
        const c = colOf(cell);
        const options = [];
        if (lineCellsFree(st, 'row', r).length) options.push({ label: `Row ${r + 1}`, wide: true, axis: 'row', index: r });
        if (lineCellsFree(st, 'col', c).length) options.push({ label: `Column ${c + 1}`, wide: true, axis: 'col', index: c });
        openPerkPick({ title: 'Fresh Line', sub: 'Every unlocked tile in the line gets a new letter', options, onPick: (k) => doPerkAction({ type: 'freshline', axis: options[k].axis, index: options[k].index }) });
        return;
      }
      default:
    }
  }

  function finishExchange() {
    const pk = w.perk;
    if (!pk || pk.id !== 'exchange' || !pk.picked.length) return;
    doPerkAction({ type: 'exchange', cells: pk.picked.slice() });
  }

  /** Long Flick: the flicked line slides two steps or more; with room for more than two the player picks how far. */
  function perkFlick(axis, index, dir) {
    if (!w.perk || w.perk.id !== 'long-flick') return;
    const free = lineCellsFree(w.game.state, axis, index).length;
    if (free < 3) {
      shakeCells(grid().lineCells(axis, index));
      play('buzz');
      say('That line needs three unlocked tiles', 'bad');
      return;
    }
    const most = free - 1; // one more and the line is back where it started
    if (most === 2) return doPerkAction({ type: 'slideN', axis, index, dir, steps: 2 });
    const options = [];
    for (let n = 2; n <= most; n++) options.push({ label: `${n} steps`, wide: true });
    openPerkPick({ title: 'Long Flick', sub: `How far does the ${axis === 'row' ? 'row' : 'column'} slide?`, options, onPick: (k) => doPerkAction({ type: 'slideN', axis, index, dir, steps: k + 2 }) });
  }

  /** A small dialog of choices for the card in play: { title, sub, options: [{ label, small, disabled, wide }], onPick(index) }. */
  let perkPickReturn = null; // where focus goes back to when the picker closes
  function openPerkPick(spec) {
    const dlg = $('#w-perkpick');
    perkPickReturn = document.activeElement && document.activeElement !== document.body ? document.activeElement : $('#w-hand');
    $('#w-perkpick-title').textContent = spec.title;
    const sub = $('#w-perkpick-sub');
    sub.textContent = spec.sub || '';
    sub.hidden = !spec.sub;
    const box = $('#w-perkpick-options');
    box.innerHTML = '';
    spec.options.forEach((o, k) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn perkpick-opt${o.wide ? ' wide' : ''}`;
      b.innerHTML = o.small !== undefined ? `${o.label}<small>${o.small}</small>` : o.label;
      b.disabled = !!o.disabled;
      b.addEventListener('click', () => {
        closePerkPick();
        spec.onPick(k);
      });
      box.appendChild(b);
    });
    dlg.hidden = false;
    const first = box.querySelector('button:not(:disabled)') || $('#w-perkpick-cancel');
    first.focus();
  }

  function closePerkPick() {
    const dlg = $('#w-perkpick');
    if (dlg.hidden) return;
    dlg.hidden = true;
    if (perkPickReturn && perkPickReturn.isConnected && !perkPickReturn.hidden) perkPickReturn.focus();
    perkPickReturn = null;
  }

  // the picker is modal: Tab cycles inside it
  $('#w-perkpick').addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const items = Array.from($('#w-perkpick').querySelectorAll('button:not(:disabled)'));
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    if (e.shiftKey && (i <= 0)) {
      e.preventDefault();
      items[items.length - 1].focus();
    } else if (!e.shiftKey && (i === -1 || i === items.length - 1)) {
      e.preventDefault();
      items[0].focus();
    }
  });

  /** Choice Draw is armed and Draw was chosen on a tile: the next three letters, keep one. */
  function openDraw3(cell) {
    const st = w.game.state;
    const options = peekDraws(st, 3);
    if (!options.length) return say('The bag is empty', 'bad');
    const old = st.board[cell];
    openPerkPick({ title: 'Choice Draw', sub: `Keep one; the ${old === WILD ? 'wild' : old} goes back into the bag`, options: options.map((l) => ({ label: l, small: String(letterValue(l)) })), onPick: (k) => doPerkAction({ type: 'draw3', cell, pick: k }, { keepCard: true }) });
  }

  /** Fresh Deal: a new board from a seed derived from this one; the bot sets the goal again. */
  function freshDeal() {
    const g = w.game;
    const seed = hashString(`${g.seed}:fresh:${g.level}`);
    const { board, bag } = dealLetters(seed, g.size);
    g.seed = seed;
    g.state = createWordState(board, bag, g.drawSeed);
    g.state.perk = emptyPerk();
    g.history = [];
    g.botScore = null;
    g.botFinal = null;
    g.botWords = null;
    g.goal = null;
    g.goalCelebrated = false;
    w.wordCount = 0;
    spendCard('fresh-deal');
    play('draw');
    // the panels update now; the tiles spin and show their new letters halfway through, like a draw
    renderHud();
    renderBag();
    renderWords();
    renderLocked();
    if (reduceMotion()) renderBoard();
    else {
      const tiles = Array.from(boardEl.querySelectorAll('.tile[data-cell]'));
      for (const t of tiles) t.classList.add('spin');
      setTimeout(() => tiles.forEach((t) => setFace(t, g.state.board[Number(t.dataset.cell)])), 170);
      setTimeout(() => {
        if (w.game === g) renderBoard();
      }, 420);
    }
    say('Fresh Deal: a new board; the goal is being worked out', 'good', 3200);
    computeGoal(g);
  }

  /** Rewind: the one take-back a level run allows, bought as a card. */
  function perkRewind() {
    const g = w.game;
    if (!g.history.length) return say('Nothing to take back', 'bad');
    cancelGesture();
    const prev = g.history.pop();
    if (prev.undoneDraw) {
      // the draw is taken back and the bag's next letter is rolled afresh, so it is not simply dealt again
      delete prev.undoneDraw;
      prev.rngState = randomSeed();
    }
    g.state = prev;
    spendCard('rewind');
    w.first = null;
    w.pending = null;
    closeMenu();
    renderAll();
    play('undo');
    say('Rewind: the last move is taken back', 'good', 2500);
  }

  /** Hint: light up the best word that can be locked right now, until the board changes. */
  function showHint() {
    const st = w.game.state;
    const best = findWords(st, w.dict).find((c) => c.lockable);
    spendCard('hint');
    if (!best) return say('Hint: no word can be locked right now', '', 3000);
    w.hint = { cells: best.cells, word: best.word, score: best.score };
    clearTimeout(w.hintTimer);
    w.hintTimer = setTimeout(clearHint, 8000);
    renderBoard();
    renderStrip();
    play('tap');
  }

  function clearHint() {
    clearTimeout(w.hintTimer);
    w.hintTimer = null;
    if (!w.hint) return;
    w.hint = null;
    if (w.game) {
      renderBoard();
      renderStrip();
    }
  }

  /** The market between levels: three cards from the deck for the gold banked so far. */
  function openMarketSheet() {
    const g = w.game;
    const run = perks();
    if (!g || !run) return;
    if (!openMarket(run)) return; // nothing the gold can buy: no market this time
    persist();
    renderMarket();
    closeTilePop();
    closeSheet($('#w-result'));
    openSheet($('#w-market'));
  }

  function renderMarket() {
    const g = w.game;
    const run = g.perks;
    const m = run.market;
    if (!m) return;
    $('#w-market-gold').textContent = `◆ ${run.gold}`;
    $('#w-market-sub').textContent = `Level ${g.level} passed · +${run.gained} gold · before level ${g.level + 1}`;
    const list = $('#w-market-cards');
    list.innerHTML = '';
    if (!m.offer.length) list.innerHTML = '<p class="mk-empty">The deck is empty: every card has been bought.</p>';
    for (const id of m.offer) {
      const c = CARD_BY_ID[id];
      if (!c) continue;
      const why = buyBlock(run, id);
      const bought = m.bought.includes(id);
      const el = document.createElement('div');
      el.className = `mk-card${bought ? ' bought' : why ? ' cannot' : ''}`;
      const note = bought ? 'In your hand' : why.startsWith('Needs') ? '' : why; // short of gold: dimmed is enough
      el.innerHTML = cardHtml(c, bought ? 'Bought' : `◆ ${c.cost}`, note, bought ? '' : `<button type="button" class="btn btn-primary btn-small mk-buy" ${why ? 'disabled' : ''}>Buy</button>`, true);
      el.querySelector('.mk-info').addEventListener('click', (e) => toggleInfoPop(c, e.currentTarget));
      if (bought) {
        list.appendChild(el);
        continue;
      }
      el.querySelector('.mk-buy').addEventListener('click', () => {
        try {
          buyCard(run, id);
        } catch (e) {
          return ctx.showToast(e.message);
        }
        persist();
        play('lock');
        renderMarket();
        renderHud();
      });
      list.appendChild(el);
    }
    $('#w-market-continue').textContent = `Continue to level ${g.level + 1}`;
  }

  // ---------------------------------------------------------------------------
  // End of game

  /** Pass the level now and go straight to the next board (available once the goal is reached). */
  function advanceEarly() {
    const g = w.game;
    if (!g || w.over || w.animating || g.mode !== 'levels' || g.goal === null || finalScore(g.state) < g.goal) return;
    const level = g.level;
    const score = finalScore(g.state);
    finish(true, true, true);
    startNextLevel(level + 1, `Level ${level} passed with ${score} · now level ${level + 1}`);
  }

  /** Start a level of the run that just finished a board; a perk run carries its gold, deck and hand on. */
  function startNextLevel(level, note) {
    const g = w.game;
    const run = g && g.perks && !g.perks.retry ? g.perks : null;
    if (run) closeMarket(run);
    start(false, { mode: 'levels', level, size: g ? g.size : 5, perks: run, note });
  }

  function finish(auto = false, silent = false, advance = false) {
    if (w.over) return;
    const g = w.game;
    const st = g.state;
    if (!auto && st.turns < turnLimit(st) && !isBoardFull(st)) return; // no ending early
    ensureGoalNow(g);
    cancelGesture();
    if (g.perks && !g.perks.retry && g.mode === 'levels' && !advance && finalScore(st) >= g.goal) {
      // A perk run passed on its last move, or the goal landed late: the board waits for Next level like a
      // mid-board pass, so the run (gold, hand, market) stays saved until the next level starts.
      w.pending = null;
      w.first = null;
      closeMenu();
      dropTargeting();
      if (!g.goalCelebrated) {
        g.goalCelebrated = true;
        g.perks.gained = goldForPass(st, g.perks);
        g.perks.gold += g.perks.gained;
      }
      persist();
      if (!silent) {
        renderAll(); // the bar lights up and the board freezes
        showPassed();
      }
      return;
    }
    w.over = true;
    const perkGame = !!(g.perks && !g.perks.retry); // a run with perk cards: its own best level, nothing posted
    const handSnap = perkGame ? { gold: g.perks.levelStart.gold, hand: g.perks.levelStart.hand.slice(), deck: g.perks.deck.slice(), shop: !!g.perks.shop } : g.retry && g.retry.perks ? g.retry.perks : null;
    w.lastBoard = { seed: g.seed, drawSeed: g.drawSeed, size: g.size, retry: g.mode === 'levels' ? { level: g.level, goal: g.goal, botScore: g.botScore, perks: handSnap } : g.retry ? { ...g.retry, botScore: g.botScore } : null };
    w.pending = null;
    w.first = null;
    closeMenu();
    clearTransient();
    const bonus = coverageBonusFor(st);
    const turnBonus = fullCoverTurnBonus(st);
    const penalty = shortfallPenalty(st.locked.length);
    const total = finalScore(st);
    const store = ctx.store;
    const bestKey = g.size === 6 ? 'best6' : 'best'; // a personal best per board size
    store.word ||= { gamesPlayed: 0, best: null, history: [] };
    store.word.boards ||= {};
    const boardKey = `${g.seed}:${g.drawSeed}`;
    const previousOnBoard = store.word.boards[boardKey];
    const beatBoard = previousOnBoard !== undefined && total > previousOnBoard;
    if (!g.practice && !perkGame && (previousOnBoard === undefined || total > previousOnBoard)) store.word.boards[boardKey] = total;
    const passed = g.mode === 'levels' && total >= g.goal;
    let isBest = false;
    if (!g.replay && !g.practice) {
      isBest = !perkGame && (store.word[bestKey] == null || total > store.word[bestKey]);
      if (isBest) store.word[bestKey] = total;
      store.word.gamesPlayed++;
      if (passed && !perkGame) store.word.bestLevel = Math.max(store.word.bestLevel || 0, g.level);
      if (g.mode === 'levels' && perkGame) {
        const key = `bestReachedPerks${g.size}`; // a perk run's own ladder, kept apart from the plain runs
        store.word[key] = Math.max(store.word[key] || 0, passed ? g.level + 1 : g.level);
      } else if (g.mode === 'levels') {
        store.word.bestReached = Math.max(store.word.bestReached || 0, g.level);
        const key = `bestReached${g.size}`; // per board size, for the stats and the leaderboard
        store.word[key] = Math.max(store.word[key] || 0, passed ? g.level + 1 : g.level);
      }
      const entry = {
        at: new Date().toISOString(), seed: g.seed, drawSeed: g.drawSeed, size: g.size, score: total, bonus, mode: g.mode, level: g.level, goal: g.goal, passed,
        words: st.words.map((x) => ({ word: x.word, score: x.score })),
      };
      if (perkGame) entry.perks = true;
      store.word.history.unshift(entry);
      store.word.history = store.word.history.slice(0, 50);
    }
    store.wordGame = null;
    ctx.saveStore(store);
    // the leaderboard hears about every finished board; replays, retries and perk runs never count, and
    // the name question waits for a board whose result is on screen
    if (ctx.leaderboard) ctx.leaderboard.afterBoard({ size: g.size, score: total, levelReached: g.mode === 'levels' && !perkGame ? store.word[`bestReached${g.size}`] : 0, replay: !!g.replay || !!g.practice || perkGame, prompt: !silent });
    if (silent) return;

    $('#w-strip').hidden = true;
    $('#w-found-wrap').hidden = true;
    $('#w-bag').hidden = true;
    $('#screen-word').classList.add('over');

    const levelsRun = g.mode === 'levels';
    let title = 'Final score';
    let line;
    if (levelsRun) {
      const bestReached = Math.max(store.word[perkGame ? `bestReachedPerks${g.size}` : `bestReached${g.size}`] || 0, g.level); // per board size, like Stats and the leaderboard
      title = passed ? `Level ${g.level} passed!` : 'Game over';
      line = passed ? `Goal ${g.goal} reached` : `Reached level ${g.level} · ${perkGame ? 'best with perks' : 'best level'} ${bestReached}`;
    } else if (g.retry) {
      const won = total >= g.goal;
      title = won ? 'Goal reached!' : 'Game over';
      line = `Level ${g.retry.level} retry · Goal ${g.goal} ${won ? 'reached' : 'missed'}`;
    } else if (g.replay) {
      line = `${beatBoard ? `Beat previous best (${previousOnBoard})` : `Short of previous best (${previousOnBoard})`} · (Not counted in stats)`;
    } else {
      const best = store.word[bestKey];
      line = isBest ? 'New personal best!' : total === best ? 'Ties your personal best' : `Personal best: ${best}`;
    }
    if (g.practice) line = `${levelsRun ? (passed ? `Goal ${g.goal} reached` : `Reached level ${g.level}`) + ' · ' : ''}Practice board · not counted in stats`;
    play(levelsRun ? (passed ? 'fanfare' : 'fail') : isBoardFull(st) ? 'fanfare' : 'lock');
    w.shareText = (levelsRun ? `Level ${g.level} ${passed ? 'passed' : 'failed'} · ` : g.retry ? `Level ${g.retry.level} retry · ` : '') + wordShareLine(total, st.words, g.size === 6 ? 'GridLock 6×6' : 'GridLock');
    const showNext = levelsRun && passed && !g.replay;
    w.nextLevel = passed ? g.level + 1 : 1;
    renderHud();
    renderBoard();
    renderBag();
    renderLocked();
    showResult({
      title,
      line,
      rows: scoreRows(st),
      total,
      board: st,
      next: showNext,
      again: !showNext,
      againText: levelsRun || g.retry ? 'New game' : 'New board',
      replay: !(showNext || (g.retry && total >= g.goal)), // a lost board can be retried; a beaten retry cannot
    });
  }

  /** The lines of a score breakdown: words, tiles, unused turns, any penalty. */
  function scoreRows(st) {
    const bonus = coverageBonusFor(st);
    const turnBonus = fullCoverTurnBonus(st);
    const penalty = shortfallPenalty(st.locked.length);
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const perkPts = st.perkPoints || 0;
    const rows = [
      { label: plural(st.words.length, 'word'), value: st.score - perkPts, pop: 'words' },
      { label: plural(st.locked.length, 'tile'), value: bonus, cls: bonus ? 'pos' : '', pop: 'tiles' },
    ];
    if (st.perk && (perkPts || (st.perk.log || []).length)) rows.splice(1, 0, { label: 'perks', value: perkPts, cls: 'pos perk', pop: 'perks' });
    if (turnBonus) rows.push({ label: `${plural(Math.max(0, turnLimit(st) - st.turns), 'turn')} left`, value: turnBonus, cls: 'pos' });
    if (penalty) rows.push({ label: `${plural(COVERAGE_TARGET - st.locked.length, 'tile')} short`, value: -penalty, signed: true, cls: 'neg' });
    return rows;
  }

  /** The level goal is reached mid-board: play stops and the sheet offers the next level (the game stays saved until then). */
  function showPassed() {
    const g = w.game;
    const st = g.state;
    const sheet = $('#w-result');
    if (!sheet.hidden && sheet.dataset.state === 'passed') return;
    const total = finalScore(st);
    const left = Math.max(0, turnLimit(st) - st.turns);
    const gold = perkRun() ? ` · +${g.perks.gained} gold` : '';
    w.shareText = `Level ${g.level} passed · ` + wordShareLine(total, st.words, g.size === 6 ? 'GridLock 6×6' : 'GridLock');
    showResult({
      state: 'passed',
      title: `Level ${g.level} passed!`,
      line: `Goal ${g.goal} reached${left > 0 ? ` · ${left} turn${left === 1 ? '' : 's'} to spare` : ''}${gold}`,
      rows: scoreRows(st),
      total,
      board: st,
      next: true,
      again: false,
      replay: false,
    });
  }

  /** Fill and open the result sheet. data: { state, title, line, rows, total, next, again, againText, replay }. */
  function showResult(data) {
    const sheet = $('#w-result');
    sheet.dataset.state = data.state || 'over';
    $('#w-result-title').textContent = data.title;
    const best = $('#w-result-best');
    best.innerHTML = '';
    String(data.line).split(' · ').forEach((part, i) => { // one part per line, each starting with a capital
      if (i) best.appendChild(Object.assign(document.createElement('span'), { className: 'sep', textContent: ' · ' }));
      best.appendChild(Object.assign(document.createElement('span'), { className: 'rs-line', textContent: part.charAt(0).toUpperCase() + part.slice(1) }));
    });
    $('#w-rs-headtotal').textContent = String(data.total);
    const tally = $('#w-tally');
    tally.innerHTML = '';
    closeTilePop();
    for (const r of data.rows) {
      const el = document.createElement(r.pop ? 'button' : 'div');
      el.className = `rs-tile${r.cls ? ` ${r.cls}` : ''}${r.value === 0 ? ' zero' : ''}`;
      el.innerHTML = `<b>${r.signed && r.value > 0 ? `+${r.value}` : r.value}</b><small>${r.label}</small>`;
      if (r.pop) {
        el.type = 'button';
        el.setAttribute('aria-label', r.pop === 'words' ? 'Show the words and their points' : r.pop === 'perks' ? 'Show the card points' : 'Show the tile bonus ladder');
        el.addEventListener('click', () => toggleTilePop(r.pop, el, data.board));
      }
      tally.appendChild(el);
    }
    const totalTile = document.createElement('div'); // the total as a tile in portrait; landscape shows it in the head instead
    totalTile.className = 'rs-tile total';
    totalTile.innerHTML = `<b>${data.total}</b><small>Total</small>`;
    tally.appendChild(totalTile);
    $('#w-next').hidden = !data.next;
    $('#w-again').hidden = !data.again;
    $('#w-again').textContent = data.againText || 'New board';
    $('#w-replay').hidden = !data.replay;
    $('#screen-word').classList.add('sheet-up');
    openSheet(sheet);
    fitBoardAbove();
  }

  // ---- popups above the result tiles ----------------------------------------------------------------
  let tilePopAnchor = null;

  /** The words with their points (best first), or the tile ladder with this board's row marked. */
  function tilePopHtml(kind, st) {
    if (kind === 'words') {
      if (!st.words.length) return '<div class="tp-empty">No words locked</div>';
      return st.words
        .slice()
        .sort((a, b) => b.score - a.score)
        .map((x) => `<div class="tp-row"><span>${x.word}${x.extras ? `<span class="tp-extra">${x.extras.map((e) => `+${e.pts} ${perkLabel(e.card)}`).join(' · ')}</span>` : ''}</span><b>${x.extras ? x.score - x.extras.reduce((a, e) => a + e.pts, 0) : x.score}</b></div>`)
        .join('');
    }
    if (kind === 'perks') {
      const lines = perkSummary(st);
      if (!lines.length) return '<div class="tp-empty">No card points on this board</div>';
      return lines.map((x) => `<div class="tp-row"><span>${x.label}</span><b>+${x.pts}</b></div>`).join('');
    }
    const ladder = COVERAGE_LADDER[st.size] || {};
    const steps = Object.keys(ladder).map(Number).sort((a, b) => a - b);
    const first = steps[0];
    const lift = st.perk && st.perk.headStart ? 1 : 0; // Head Start counts the ladder a tile early
    const mine = Math.min(st.board.length, st.locked.length + lift);
    const row = (label, bonus, me) => `<tr class="${me ? 'me' : ''}${bonus ? '' : ' zero'}"><td>${label}</td><td>${bonus}</td></tr>`;
    const note = lift ? `<div class="tp-row"><span>Head Start: ${st.locked.length} tiles count as ${mine}</span></div>` : '';
    return `<table><tr><th>Tiles</th><th>Bonus</th></tr>${row(`≤ ${first - 1}`, 0, mine < first)}${steps.map((k) => row(`${k}${k === st.board.length ? ' (all)' : ''}`, ladder[k], mine === k)).join('')}</table>${note}`;
  }

  /** Open the popup directly above its tile, or close it if that tile's popup is already up. */
  function toggleTilePop(kind, anchor, st) {
    const pop = $('#w-tilepop');
    if (!pop.hidden && tilePopAnchor === anchor) {
      closeTilePop();
      return;
    }
    openPopAt(tilePopHtml(kind, st), anchor);
  }

  /** Show html in the popup, centred above an anchor element and kept on screen. */
  function openPopAt(html, anchor) {
    const pop = $('#w-tilepop');
    pop.innerHTML = html;
    pop.hidden = false;
    tilePopAnchor = anchor;
    const a = anchor.getBoundingClientRect();
    const p = pop.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - p.width - 8, a.left + a.width / 2 - p.width / 2));
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(Math.max(8, a.top - p.height - 12))}px`;
    pop.style.setProperty('--arrow-x', `${Math.round(a.left + a.width / 2 - left)}px`);
  }

  function closeTilePop() {
    const pop = $('#w-tilepop');
    pop.hidden = true;
    tilePopAnchor = null;
  }

  /**
   * Beside the board, the result card sits in the panel column under the word row; when there is no room
   * left there (a phone on its side) it takes the whole panel's place instead, so it shows whole.
   */
  function dockInPanel(body) {
    const col = $('.word-hud').getBoundingClientRect();
    const words = $('#w-locked').getBoundingClientRect();
    const bottom = window.innerHeight - 8;
    let top = words.bottom + 10;
    if (bottom - top < 300) top = col.top; // the card needs about 300px to show whole; short of that it takes the panel's place
    Object.assign(body.style, { position: 'fixed', left: `${Math.round(col.left)}px`, width: `${Math.round(col.width)}px`, top: `${Math.round(top)}px`, maxHeight: `${Math.floor(bottom - top)}px` });
  }

  function undock(body) {
    for (const k of ['position', 'left', 'width', 'top']) body.style[k] = '';
  }

  /**
   * The board gives up height so the whole of it shows above the result sheet, down to MIN_BOARD_PX; past
   * that the sheet is capped instead and its middle scrolls, so the board never becomes unreadable.
   */
  function fitBoardAbove() {
    const sheet = $('#w-result');
    const body = sheet.querySelector('.sheet-body');
    const sideBySide = matchMedia('(orientation: landscape) and (min-width: 640px)').matches;
    if (sheet.hidden || sideBySide) { // beside its panel the board keeps its size and the card docks in the panel
      boardEl.style.maxWidth = '';
      body.style.maxHeight = '';
      wrapEl.style.paddingTop = '';
      if (!sheet.hidden && sideBySide) dockInPanel(body);
      else undock(body);
      return;
    }
    undock(body);
    body.style.maxHeight = '';
    const top = wrapEl.getBoundingClientRect().top;
    const gap = 10;
    const inset = parseFloat(getComputedStyle(body).marginBottom) || 0; // the card floats above the bottom edge
    let room = window.innerHeight - body.getBoundingClientRect().height - inset - top - gap;
    if (room < MIN_BOARD_PX) {
      body.style.maxHeight = `${Math.max(MIN_SHEET_PX, window.innerHeight - top - MIN_BOARD_PX - gap - inset)}px`;
      room = window.innerHeight - body.getBoundingClientRect().height - inset - top - gap;
    }
    const width = Math.max(MIN_BOARD_PX, Math.min(wrapEl.clientWidth, Math.floor(room)));
    boardEl.style.maxWidth = `${width}px`;
    // the board sits in the middle of the room left above the sheet instead of leaving a band under it
    wrapEl.style.paddingTop = room > width ? `${Math.floor((room - width) / 2)}px` : '';
  }

  let popTimer = null;
  function showPop(html) {
    const pop = $('#w-pop');
    pop.innerHTML = html;
    pop.hidden = false;
    clearTimeout(popTimer);
    popTimer = setTimeout(() => (pop.hidden = true), 4500);
  }

  /** Popup with the score composition as it stands now (tap on the goal bar or the score). */
  function showScorePop() {
    if (!w.game) return;
    const st = w.game.state;
    const bonus = coverageBonusFor(st);
    const turnBonus = fullCoverTurnBonus(st);
    const penalty = shortfallPenalty(st.locked.length);
    const total = finalScore(st);
    const perkPts = st.perkPoints || 0;
    const parts = [`<b>${st.words.length} word${st.words.length === 1 ? '' : 's'}</b> ${st.score - perkPts}`];
    if (perkPts) parts.push(`perks <b>+${perkPts}</b>`);
    if (bonus) parts.push(`${st.locked.length} tiles <b>+${bonus}</b>`);
    if (turnBonus) parts.push(`${Math.max(0, turnLimit(st) - st.turns)} turns left <b>+${turnBonus}</b>`);
    if (penalty) parts.push(`${COVERAGE_TARGET - st.locked.length} tile${COVERAGE_TARGET - st.locked.length === 1 ? '' : 's'} short of ${COVERAGE_TARGET} <b>−${penalty}</b>`);
    let html = parts.join(' · ') + ` = <b>${total}</b>`;
    if (w.game.mode === 'levels' && w.game.goal !== null) html += `<br><span style="opacity:.75">Goal ${w.game.goal}: ${total >= w.game.goal ? 'reached' : `${w.game.goal - total} to go`}</span>`;
    if (st.words.length) html += `<br><span style="opacity:.75">${st.words.map((x) => `${x.word} ${x.score}`).join(', ')}</span>`;
    showPop(html);
  }

  async function copyShare() {
    const text = w.shareText || '';
    try {
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      ctx.showToast('Copied to clipboard.');
    } catch {
      ctx.showToast('Could not share; the result is in your history.');
    }
  }

  // ---------------------------------------------------------------------------
  // Events

  boardEl.addEventListener('pointerdown', onPointerDown);
  boardEl.addEventListener('pointermove', onPointerMove);
  boardEl.addEventListener('pointerup', onPointerUp);
  boardEl.addEventListener('pointercancel', onPointerCancel);
  boardEl.addEventListener('contextmenu', (e) => e.preventDefault());
  // iOS Safari and Android Chrome start a text selection or callout on a long press unless the touch
  // itself is cancelled; pointer events still arrive, and taps are handled in pointerup, so nothing is lost
  boardEl.addEventListener('touchstart', (e) => {
    if (e.cancelable) e.preventDefault();
  }, { passive: false });
  boardEl.addEventListener('selectstart', (e) => e.preventDefault());
  $('#screen-word').addEventListener('contextmenu', (e) => e.preventDefault());
  // a release that lands outside the board (the menu backdrop, the edge of the screen) still ends the gesture
  window.addEventListener('pointerup', (e) => {
    if (w.gesture && e.pointerId === w.gesture.id) onPointerUp(e);
  });
  window.addEventListener('pointercancel', (e) => {
    if (w.gesture && e.pointerId === w.gesture.id) onPointerCancel(e);
  });
  boardEl.addEventListener('click', (e) => {
    // keyboard activation only: pointer taps are handled in pointerup
    if (performance.now() - w.pointerTs < 600) return;
    if (!$('#w-tilemenu').hidden) return;
    const tile = e.target.closest('.tile');
    if (tile) onTileTap(Number(tile.dataset.cell));
  });
  boardEl.addEventListener('keydown', (e) => {
    // keyboard: Enter/Space taps (native click); M or the context-menu key opens the tile menu
    const tile = e.target.closest('.tile');
    if (!tile) return;
    if (e.key === 'm' || e.key === 'M' || e.key === 'ContextMenu') {
      e.preventDefault();
      if (!w.gesture) openMenu(Number(tile.dataset.cell));
    }
  });
  $('#w-menu-backdrop').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    closeMenu();
  });
  for (const b of document.querySelectorAll('#w-tilemenu .tm-btn')) b.addEventListener('click', () => onMenuAction(b.dataset.act));
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || $('#screen-word').hidden) return;
    if (!$('#w-perkpick').hidden) {
      closePerkPick();
      renderStrip();
    } else if (w.perk) cancelPerk();
    else if (!$('#w-tilemenu').hidden) closeMenu();
    else if (w.first !== null || w.pending) {
      w.first = null;
      w.pending = null;
      renderBoard();
      renderStrip();
    }
  });
  $('#w-goalbar').addEventListener('click', (e) => {
    if (e.target.closest('#w-advance')) return;
    showScorePop();
  });
  $('#w-advance').addEventListener('click', advanceEarly);
  $('#w-score-item').addEventListener('click', showScorePop);
  $('#w-bag-btn').addEventListener('click', () => {
    w.showBag = !w.showBag;
    renderHud();
    renderBag();
  });
  $('#w-undo').addEventListener('click', undo);
  $('#w-pop').addEventListener('click', () => ($('#w-pop').hidden = true));
  $('#w-share').addEventListener('click', copyShare);
  $('#w-next').addEventListener('click', () => {
    // a perk run shops first, when the gold buys anything; the goal reached mid-board is scored when the next level starts
    if (perkRun() && hasMarket(w.game.perks)) openMarketSheet();
    else if (w.game && !w.over) advanceEarly();
    else startNextLevel(w.nextLevel || 1);
  });
  $('#w-market-continue').addEventListener('click', () => {
    closeSheet($('#w-market'));
    if (w.game && !w.over) advanceEarly();
    else startNextLevel(w.nextLevel || 1);
  });
  $('#w-market-home').addEventListener('click', () => {
    closeSheet($('#w-market'));
    closeTilePop();
    if (w.over) w.game = null;
    ctx.showHome(); // the passed board stays saved with its market; Continue brings it back
  });
  $('#w-hand').addEventListener('click', openHand);
  $('#w-shop-close').addEventListener('click', () => closeSheet($('#w-shop')));
  $('#w-shop').addEventListener('click', (e) => {
    if (e.target === $('#w-shop')) closeSheet($('#w-shop'));
  });
  w.shopSort = 'type';
  for (const r of document.querySelectorAll('input[name="shop-sort"]')) {
    r.addEventListener('change', () => {
      w.shopSort = document.querySelector('input[name="shop-sort"]:checked').value;
      renderShop();
    });
  }
  $('#w-hand-close').addEventListener('click', () => closeSheet($('#w-handsheet')));
  $('#w-handsheet').addEventListener('click', (e) => {
    if (e.target === $('#w-handsheet')) closeSheet($('#w-handsheet'));
  });
  $('#w-perkpick-cancel').addEventListener('click', () => {
    closePerkPick();
    renderStrip();
  });
  $('#w-perkpick').addEventListener('click', (e) => {
    if (e.target !== $('#w-perkpick')) return;
    closePerkPick();
    renderStrip();
  });
  /** The card's place depends on the layout settling: place it now, next frame, and once more a moment later. */
  function refit() {
    closeTilePop();
    if ($('#w-result').hidden) return;
    fitBoardAbove();
    requestAnimationFrame(fitBoardAbove);
    clearTimeout(w.refitTimer);
    w.refitTimer = setTimeout(fitBoardAbove, 350);
  }
  window.addEventListener('resize', refit);
  window.addEventListener('resize', () => {
    if (!$('#w-shop').hidden) renderShop();
  });
  window.addEventListener('orientationchange', refit);
  window.addEventListener('pageshow', refit);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refit();
  });
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      if (!$('#w-result').hidden) fitBoardAbove();
    });
    ro.observe($('.word-hud'));
    ro.observe($('#w-locked'));
  }
  document.addEventListener(
    'pointerdown',
    (e) => {
      const pop = $('#w-tilepop');
      if (pop.hidden || pop.contains(e.target) || (tilePopAnchor && tilePopAnchor.contains(e.target))) return;
      closeTilePop(); // a press anywhere else closes the popup and nothing more
    },
    true,
  );
  $('#w-again').addEventListener('click', () => {
    const g = w.game;
    const size = g ? g.size : 5;
    if (g && (g.mode === 'levels' || g.retry)) start(false, { mode: 'levels', level: 1, size });
    else start(false, { mode: 'free', size });
  });
  $('#w-replay').addEventListener('click', () => {
    const b = w.lastBoard;
    if (b) start(false, { mode: 'free', seed: b.seed, drawSeed: b.drawSeed, size: b.size, replay: true, retry: b.retry });
  });
  $('#w-home').addEventListener('click', () => {
    cancelGesture();
    closeTilePop();
    closeSheet($('#w-market'));
    closeSheet($('#w-result'));
    if (w.over) w.game = null; // a passed board waiting for Next level stays saved
    ctx.showHome();
  });
  $('#w-quit').addEventListener('click', () => {
    cancelGesture();
    closeMenu();
    cancelPerk();
    closePerkPick();
    closeSheet($('#w-handsheet'));
    closeSheet($('#w-shop'));
    closeTilePop();
    closeSheet($('#w-result'));
    flushFinish();
    ctx.showHome();
  });
  $('#w-help').addEventListener('click', () => {
    closeMenu();
    const g = w.game;
    ctx.openTutorial(g ? g.size : 5, g ? { mode: g.mode, goal: g.goal } : {});
  });
  window.addEventListener('resize', positionMenu);

  return { start, state: w, render: renderAll };
}
