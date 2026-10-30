// Word game UI: a 5x5 letter grid, 20 turns, lock words to bank points. Fits a portrait phone.
// Everything is played directly on the board with gestures:
//   drag a tile onto a neighbour  -> swap
//   flick a row or column         -> slide (a long drag along the line slides too)
//   press and hold a tile         -> menu: nudge down, nudge up, draw, wild (locked tiles)
//   tap the first and last letter -> lock the word between them
// Modes: levels (a bot sets a goal score per board; pass to advance) and free play (no goal).

import { randomSeed } from './rng.js';
import { ANIM_MS, wait, buildBoardSkeleton, tileIn, tileStep, animateAction, animateMoves, beginMoves, removeGhosts, clearTileEffects } from './board.js';
import {
  dealLetters, createWordState, applyWordAction, findWords, findWordAt, lockWord, parseDictionary, bagTotal, letterValue,
  describeWordCells, wordShareLine, slideMoves, coverageBonusFor, finalScore, shortfallPenalty, nudgeLetter, lineCellsFree,
  turnLimit, gridOfState, WILD, LETTERS, COVERAGE_TARGET, WILD_COST, SIZES, fullCoverTurnBonus, isBoardFull,
} from './words.js';
import { botPlay, goalFor } from './wordbot.js';
import { play } from './sound.js';

const $ = (sel) => document.querySelector(sel);

/** Gesture tuning (CSS pixels, milliseconds, tile widths). */
const LONG_PRESS_MS = 420; // hold this long without moving to open the tile menu
const TAP_SLOP = 8; // movement below this is a tap
const FLICK_VELOCITY = 0.45; // px per ms at release: faster than this along the line is a flick
const SLIDE_TRAVEL = 1.45; // tiles: dragging this far along a line slides it even without a flick
const SWAP_TRAVEL = 0.4; // tiles: minimum travel towards a neighbour to drop onto it
const SWAP_CROSS = 0.7; // tiles: maximum sideways wobble for a drop

export function initWordMode(ctx) {
  const w = {
    dict: null,
    game: null, // { seed, drawSeed, state, mode: 'levels'|'free', level, goal, botScore, prev, undoUsed, replay }
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
  const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  async function ensureDict() {
    if (w.dict) return true;
    try {
      const res = await fetch('data/words.txt', { cache: 'force-cache' });
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
        const { board, bag } = dealLetters(game.seed);
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
      const { board, bag } = dealLetters(game.seed);
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
      const { board, bag } = dealLetters(game.seed);
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
      if (w.game.prev === undefined) w.game.prev = null;
      if (w.game.undoUsed === undefined) w.game.undoUsed = false;
      if (w.game.size === undefined) w.game.size = w.game.state.size || Math.round(Math.sqrt(w.game.state.board.length));
    } else {
      const seed = opts.seed ?? randomSeed();
      const drawSeed = opts.drawSeed ?? randomSeed();
      const size = SIZES.includes(opts.size) ? opts.size : 5;
      const { board, bag } = dealLetters(seed, size);
      w.game = {
        seed,
        drawSeed,
        size,
        state: createWordState(board, bag, drawSeed),
        startedAt: new Date().toISOString(),
        mode: opts.mode || 'free',
        level: opts.level || 1,
        goal: null,
        botScore: null,
        botWords: null,
        prev: null,
        undoUsed: false,
        replay: !!opts.replay,
      };
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
    ctx.showScreen('screen-word');
    ensureBoard(w.game.size);
    $('#w-result').hidden = true;
    $('#w-words-pop').hidden = true;
    $('#screen-word').classList.remove('over');
    $('#w-locked').hidden = false;
    $('#w-strip').hidden = false;
    renderAll();
    if (opts.note) say(opts.note, 'good', 2800);
    else if (opts.replay) say('Replaying this board · not counted in your stats', '', 3000);
    computeGoal(w.game);
    // a board saved in its last moment (full, or a level run out of turns) is scored straight away
    const st = w.game.state;
    if (!goalReached() && (isBoardFull(st) || (st.turns >= turnLimit(st) && isLevels()))) finish(true);
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
    $('#w-turn').textContent = `${Math.min(st.turns + 1, lim)} / ${lim}${w.game.replay ? ' ↻' : ''}`;
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
    undo.disabled = !w.game.prev || w.game.undoUsed;
    undo.title = w.game.undoUsed ? 'Undo already used this game' : !w.game.prev ? 'Nothing to undo (draws cannot be undone)' : 'Undo the last move (once per game)';
    const bagBtn = $('#w-bag-btn');
    bagBtn.hidden = w.over;
    bagBtn.setAttribute('aria-pressed', w.showBag ? 'true' : 'false');
  }

  function renderBoard() {
    const st = w.game.state;
    const { rowOf, colOf } = grid();
    const pendingCells = w.pending ? new Set(w.pending.cells) : null;
    const inert = !canInteract();
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
      t.setAttribute('aria-label', `Row ${rowOf(i) + 1} column ${colOf(i) + 1}: ${st.board[i] === WILD ? 'wild' : st.board[i]}${locked ? ', locked' : ''}`);
    }
    boardEl.classList.toggle('frozen', goalReached() && !w.over);
  }

  function renderBag() {
    const bag = w.game.state.bag;
    const el = $('#w-bag');
    el.hidden = !w.showBag || w.over;
    if (el.hidden) return;
    el.innerHTML = `<div class="bag-title">In the bag: ${bagTotal(bag)} letters</div>`;
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
        if (!canInteract()) return;
        setPending(w.pending && w.pending.key === c.key && w.pending.word === c.word ? null : c);
      });
      el.appendChild(b);
    }
  }

  function renderLocked() {
    const st = w.game.state;
    const el = $('#w-locked');
    const list = st.words.length
      ? `<span class="lw-list">${st.words.map((x) => `<span class="lw">${x.word}<b>${x.score}</b></span>`).join('')}</span>`
      : '<span class="lw-list"><span>No words locked yet</span></span>';
    el.innerHTML = `${list}<span class="lw-count"><b>${st.locked.length}</b>/${st.board.length} tiles</span>`;
    const scroller = el.querySelector('.lw-list');
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
    renderGoalBar();
  }

  function renderGoalBar() {
    const g = w.game;
    const bar = $('#w-goalbar');
    bar.hidden = g.mode !== 'levels';
    if (bar.hidden) return;
    const score = finalScore(g.state);
    $('#w-goalbar-level').textContent = `Level ${g.level}`;
    if (g.goal === null) {
      $('#w-goalbar-text').textContent = 'Goal: computing…';
      $('#w-goalbar-fill').style.width = '0%';
      bar.classList.remove('reached');
      $('#w-advance').hidden = true;
      return;
    }
    const reached = score >= g.goal;
    $('#w-goalbar-text').textContent = `${score} / ${g.goal}`;
    $('#w-goalbar-fill').style.width = `${Math.max(0, Math.min(100, (100 * score) / g.goal))}%`;
    if (reached && !g.goalCelebrated && !w.over) {
      g.goalCelebrated = true;
      persist();
      bar.classList.add('celebrate');
      setTimeout(() => bar.classList.remove('celebrate'), 800);
      play('win');
      renderBoard(); // the goal may have landed from the worker mid-board: grey the tiles out now
    }
    bar.classList.toggle('reached', reached);
    $('#w-advance').hidden = !(reached && !w.over);
    if (reached && !w.over) {
      // play stops here: drop any selection and close the menu
      w.first = null;
      w.pending = null;
      closeMenu();
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
    if (st.turns >= limit()) {
      if (isLevels()) return message('Out of turns.', 'bad');
      return action('Out of turns.', { label: 'Score board', fn: () => finish(false) }, { label: 'Undo', fn: undo, disabled: !g.prev || g.undoUsed });
    }
    if (w.pending) return action(`Lock ${w.pending.word} for ${w.pending.score}?`, { label: 'Lock', fn: () => commitLock(w.pending) }, { label: 'Cancel', fn: () => setPending(null) });
    if (w.first !== null) return message('Now tap the last letter of the word');
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

  function floatAt(cell, text, cls = '') {
    const layer = $('#w-float');
    const tr = tileEl(cell).getBoundingClientRect();
    const wr = wrapEl.getBoundingClientRect();
    const el = document.createElement('span');
    el.className = `float ${cls}`.trim();
    el.textContent = text;
    el.style.left = `${tr.left - wr.left + tr.width / 2}px`;
    el.style.top = `${tr.top - wr.top + tr.height / 2}px`;
    layer.appendChild(el);
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
    if (g.mode === 'menu') return;
    if (!canInteract()) {
      cancelGesture(); // the board changed under the finger (goal reached, board scored)
      return;
    }
    const { dx, dy, axis, dir, travel, cross, index } = geometry(g);
    if (g.mode === 'press') {
      if (Math.hypot(dx, dy) < TAP_SLOP) return;
      clearTimeout(g.timer);
      g.mode = 'drag';
      g.lockedTile = w.game.state.locked.includes(g.cell);
      if (w.first !== null || w.pending) {
        w.first = null;
        w.pending = null;
        renderBoard();
        renderStrip();
      }
      if (!g.lockedTile) tileEl(g.cell).classList.add('dragging');
    }
    if (g.mode === 'line') {
      if (travel >= SLIDE_TRAVEL - 0.35 && axis === g.axis && dir === g.dir) return;
      clearLinePreview(g);
      g.mode = 'drag';
      if (!g.lockedTile) tileEl(g.cell).classList.add('dragging');
    }
    // drag mode: the tile follows the finger; far enough along a line (or past the board's edge) the whole line moves instead
    const br = boardEl.getBoundingClientRect();
    const beyond = axis === 'row' ? (dir === 1 ? g.x - br.right : br.left - g.x) : dir === 1 ? g.y - br.bottom : br.top - g.y;
    if ((travel >= SLIDE_TRAVEL || beyond > 0.3 * g.step) && canSlideLine(axis, index)) {
      const t = tileEl(g.cell);
      t.classList.remove('dragging');
      t.style.transform = '';
      setDropTarget(g, null);
      g.mode = 'line';
      g.hadLine = true;
      g.axis = axis;
      g.dir = dir;
      previewLine(g, axis, index, dir);
      return;
    }
    if (g.lockedTile) return; // a locked tile cannot be dragged anywhere; only its line can slide
    tileEl(g.cell).style.transform = `translate(${dx}px, ${dy}px) scale(1.08)`;
    if (g.hadLine && travel < SWAP_TRAVEL) g.hadLine = false; // back at the start: a fresh drag may swap again
    // after a line preview was shown, pulling back cancels rather than swapping
    const target = !g.hadLine && travel >= SWAP_TRAVEL && cross < SWAP_CROSS ? neighbourIn(g.cell, axis, dir) : null;
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

  function previewLine(g, axis, index, dir) {
    const moves = slideMoves(w.game.state, { type: 'slide', axis, index, dir });
    g.preview = { axis, index, undo: beginMoves(boardEl, moves) };
  }

  function clearLinePreview(g) {
    if (!g.preview) return;
    g.preview.undo();
    g.preview = null;
  }

  /** Signed velocity along the gesture's main axis over the last ~80 ms, in px per ms. */
  function releaseVelocity(g, axis) {
    const s = g.samples;
    const last = s[s.length - 1];
    let first = s.length > 1 ? s[s.length - 2] : last;
    for (let i = s.length - 2; i >= 0; i--) {
      if (last.t - s[i].t > 80) break; // a pause before the fling must not dilute the speed
      first = s[i];
    }
    const dt = last.t - first.t;
    if (dt < 1) return 0;
    return (axis === 'row' ? last.x - first.x : last.y - first.y) / dt;
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
    if (g.mode === 'drag' || g.mode === 'line') snapBack(g);
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
    clearLinePreview(g);
  }

  function onPointerUp(e) {
    const g = endGesture(e);
    if (!g || g.mode === 'menu') return;
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
    const v = releaseVelocity(g, axis);
    const flick = Math.abs(v) >= FLICK_VELOCITY && Math.sign(v) === dir && travel >= 0.2;
    const t = tileEl(g.cell);
    if (g.mode === 'line' || flick || travel >= SLIDE_TRAVEL) {
      if (canSlideLine(axis, index)) {
        if (g.mode !== 'line') setDropTarget(g, null);
        t.classList.remove('dragging');
        if (g.mode !== 'line') t.style.transform = '';
        doAction({ type: 'slide', axis, index, dir }, { previewed: g.mode === 'line' });
      } else {
        snapBack(g);
        shakeCells(grid().lineCells(axis, index));
        play('buzz');
        say('That line is locked in place', 'bad');
      }
      return;
    }
    if (g.hadLine) {
      snapBack(g); // pulled back after seeing the line move: nothing happens
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
    if (!g || g.mode === 'menu') return;
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
    if (!canInteract()) return;
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
    $('#tm-draw-sub').textContent = `draw · ${bagTotal(st.bag)}`;
    menu.querySelector('[data-act="draw"]').disabled = bagTotal(st.bag) === 0;
    menu.querySelector('[data-act="wild"]').hidden = !(locked && !isWild && st.turns + WILD_COST <= limit());
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
    else if (act === 'draw') doAction({ type: 'draw', r, c });
    else if (act === 'wild') doAction({ type: 'wild', r, c });
  }

  // ---------------------------------------------------------------------------
  // Actions

  function snapshotForUndo(state) {
    return JSON.parse(JSON.stringify(state));
  }

  async function doAction(action, { previewed = false } = {}) {
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
    // A draw is random, so it cannot be undone; anything else can (once per game).
    w.game.prev = action.type === 'draw' ? null : snapshotForUndo(before);
    w.game.state = next;
    persist();
    w.first = null;
    w.pending = null;
    w.animating = true;
    play(action.type === 'nudge' ? (action.delta === -1 ? 'nudgeDown' : 'nudge') : action.type);
    if (action.type === 'slide') await (previewed ? wait(ANIM_MS / 2) : animateMoves(boardEl, slideMoves(before, action)));
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
    w.game.prev = snapshotForUndo(w.game.state);
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
      say(bonus ? `Board complete with ${turnLimit(next) - next.turns} turns to spare: +${bonus}!` : 'Board complete!', 'good', 4000);
      finishSoon(1600 + delay);
      return;
    }
    if (next.turns >= turnLimit(next) && isLevels()) finishSoon(500 + delay); // run over: below the goal with no turns left
    // free play: the strip offers Score board / Undo
  }

  function undo() {
    const g = w.game;
    if (!g || w.over || w.animating || !g.prev || g.undoUsed || g.mode === 'levels') return;
    cancelGesture();
    g.state = g.prev;
    g.prev = null;
    g.undoUsed = true;
    persist();
    play('undo');
    w.first = null;
    w.pending = null;
    closeMenu();
    renderAll();
    say('Last move undone', '', 1800);
  }

  // ---------------------------------------------------------------------------
  // End of game

  /** Pass the level now and go straight to the next board (available once the goal is reached). */
  function advanceEarly() {
    const g = w.game;
    if (!g || w.over || w.animating || g.mode !== 'levels' || g.goal === null || finalScore(g.state) < g.goal) return;
    const level = g.level;
    const score = finalScore(g.state);
    finish(true, true);
    start(false, { mode: 'levels', level: level + 1, size: g.size, note: `Level ${level} passed with ${score} · now level ${level + 1}` });
  }

  function finish(auto = false, silent = false) {
    if (w.over) return;
    const g = w.game;
    const st = g.state;
    if (!auto && st.turns < turnLimit(st) && !isBoardFull(st)) return; // no ending early
    ensureGoalNow(g);
    cancelGesture();
    w.over = true;
    w.lastBoard = { seed: g.seed, drawSeed: g.drawSeed, size: g.size };
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
    if (previousOnBoard === undefined || total > previousOnBoard) store.word.boards[boardKey] = total;
    const passed = g.mode === 'levels' && total >= g.goal;
    let isBest = false;
    if (!g.replay) {
      isBest = store.word[bestKey] == null || total > store.word[bestKey];
      if (isBest) store.word[bestKey] = total;
      store.word.gamesPlayed++;
      if (passed) store.word.bestLevel = Math.max(store.word.bestLevel || 0, g.level);
      store.word.history.unshift({
        at: new Date().toISOString(), seed: g.seed, drawSeed: g.drawSeed, size: g.size, score: total, bonus, mode: g.mode, level: g.level, goal: g.goal, passed,
        words: st.words.map((x) => ({ word: x.word, score: x.score })),
      });
      store.word.history = store.word.history.slice(0, 50);
    }
    store.wordGame = null;
    ctx.saveStore(store);
    if (silent) return;

    $('#w-strip').hidden = true;
    $('#w-found-wrap').hidden = true;
    $('#w-bag').hidden = true;
    $('#w-result').hidden = false;
    $('#screen-word').classList.add('over');
    // Score breakdown: words [+ bonus] [+ unused turns] [- penalty] = total
    const tally = $('#w-tally');
    tally.innerHTML = '';
    const item = (label, value, cls = '', asButton = false) => {
      const el = document.createElement(asButton ? 'button' : 'span');
      el.className = `tally-item ${cls}`.trim();
      el.innerHTML = `<span class="lbl">${label}</span><span class="num">${value}</span>`;
      if (asButton) el.type = 'button';
      return el;
    };
    const op = (text) => Object.assign(document.createElement('span'), { className: 'tally-op', textContent: text });
    const wordsBtn = item(`${st.words.length} word${st.words.length === 1 ? '' : 's'}`, String(st.score), '', true);
    wordsBtn.setAttribute('aria-label', 'Show the words you locked');
    wordsBtn.addEventListener('click', showWordsPop);
    tally.appendChild(wordsBtn);
    if (bonus) {
      tally.appendChild(op('+'));
      tally.appendChild(item(`${st.locked.length} tiles`, `+${bonus}`, 'pos'));
    }
    if (turnBonus) {
      tally.appendChild(op('+'));
      tally.appendChild(item(`${turnLimit(st) - st.turns} turns left`, `+${turnBonus}`, 'pos'));
    }
    if (penalty) {
      tally.appendChild(op('−'));
      tally.appendChild(item(`${COVERAGE_TARGET - st.locked.length} tiles short`, `−${penalty}`, 'neg'));
    }
    tally.appendChild(op('='));
    tally.appendChild(Object.assign(document.createElement('span'), { className: 'tally-total', textContent: String(total) }));
    if (st.score + bonus + turnBonus - penalty < 0) tally.appendChild(op('(floored at 0)'));

    let title = g.replay ? 'Replay over' : 'Board scored';
    let line;
    if (g.mode === 'levels') {
      title = passed ? `Level ${g.level} passed!` : `Run over at level ${g.level}`;
      line = passed ? `Goal ${g.goal} reached.` : `${total} of the ${g.goal} needed. ${g.level > 1 ? `You passed ${g.level - 1} level${g.level - 1 === 1 ? '' : 's'}.` : ''}`;
    } else if (g.replay) {
      line = beatBoard ? `Beat your previous best on this board (${previousOnBoard})! Not counted in stats.` : `Best on this board stays ${previousOnBoard}. Not counted in stats.`;
    } else {
      line = isBest ? 'New personal best!' : `Personal best: ${store.word[bestKey]}.`;
    }
    if (g.mode === 'levels' && g.replay) line += ' Replay: not counted.';
    const levelsRun = g.mode === 'levels';
    $('#w-tally').hidden = levelsRun; // no end-of-board summary in a level run
    $('#w-share').hidden = levelsRun;
    play(levelsRun ? (passed ? 'fanfare' : 'fail') : isBoardFull(st) ? 'fanfare' : 'lock');
    $('#w-result-title').textContent = title;
    $('#w-result-best').textContent = line;
    w.shareText = (levelsRun ? `Level ${g.level} ${passed ? 'passed' : 'failed'} · ` : '') + wordShareLine(total, st.words, g.size === 6 ? 'GridLock 6×6' : 'GridLock');
    const showNext = levelsRun && passed && !g.replay;
    $('#w-next').hidden = !showNext;
    $('#w-again').hidden = showNext; // Next level takes its slot
    $('#w-replay').hidden = levelsRun; // replays are a free-play feature
    $('#w-again').textContent = levelsRun ? 'New game' : 'New board';
    $('#w-locked').hidden = true;
    w.nextLevel = passed ? g.level + 1 : 1;
    renderHud();
    renderBoard();
    renderBag();
    renderLocked();
  }

  /** Popup with the score composition as it stands now (tap on the goal bar or the score). */
  function showScorePop() {
    if (!w.game) return;
    const st = w.game.state;
    const bonus = coverageBonusFor(st);
    const turnBonus = fullCoverTurnBonus(st);
    const penalty = shortfallPenalty(st.locked.length);
    const total = finalScore(st);
    const parts = [`<b>${st.words.length} word${st.words.length === 1 ? '' : 's'}</b> ${st.score}`];
    if (bonus) parts.push(`${st.locked.length} tiles <b>+${bonus}</b>`);
    if (turnBonus) parts.push(`${turnLimit(st) - st.turns} turns left <b>+${turnBonus}</b>`);
    if (penalty) parts.push(`${COVERAGE_TARGET - st.locked.length} tile${COVERAGE_TARGET - st.locked.length === 1 ? '' : 's'} short of ${COVERAGE_TARGET} <b>−${penalty}</b>`);
    let html = parts.join(' · ') + ` = <b>${total}</b>`;
    if (w.game.mode === 'levels' && w.game.goal !== null) html += `<br><span style="opacity:.75">Goal ${w.game.goal}: ${total >= w.game.goal ? 'reached' : `${w.game.goal - total} to go`}</span>`;
    if (st.words.length) html += `<br><span style="opacity:.75">${st.words.map((x) => `${x.word} ${x.score}`).join(', ')}</span>`;
    showPop(html);
  }

  let popTimer = null;
  function showPop(html) {
    const pop = $('#w-words-pop');
    pop.innerHTML = html;
    pop.hidden = false;
    clearTimeout(popTimer);
    popTimer = setTimeout(() => (pop.hidden = true), 4500);
  }

  function showWordsPop() {
    const st = w.game.state;
    showPop(st.words.length
      ? st.words.map((x) => `<b>${x.word}</b> ${x.score}`).join(' · ') + ` <span style="opacity:.7">· ${st.locked.length}/${st.board.length} tiles</span>`
      : 'No words were locked.');
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
    if (!$('#w-tilemenu').hidden) closeMenu();
    else if (w.first !== null || w.pending) {
      w.first = null;
      w.pending = null;
      renderBoard();
      renderStrip();
    }
  });
  $('#w-words-pop').addEventListener('click', () => ($('#w-words-pop').hidden = true));
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
  $('#w-share').addEventListener('click', copyShare);
  $('#w-next').addEventListener('click', () => start(false, { mode: 'levels', level: w.nextLevel || 1, size: w.game ? w.game.size : 5 }));
  $('#w-again').addEventListener('click', () => {
    const g = w.game;
    const size = g ? g.size : 5;
    if (g && g.mode === 'levels' && !$('#w-next').hidden) start(false, { mode: 'free', size });
    else if (g && g.mode === 'levels') start(false, { mode: 'levels', level: 1, size });
    else start(false, { mode: 'free', size });
  });
  $('#w-replay').addEventListener('click', () => {
    if (w.lastBoard) start(false, { mode: 'free', seed: w.lastBoard.seed, drawSeed: w.lastBoard.drawSeed, size: w.lastBoard.size, replay: true });
  });
  $('#w-home').addEventListener('click', () => {
    cancelGesture();
    w.game = null;
    ctx.showHome();
  });
  $('#w-quit').addEventListener('click', () => {
    cancelGesture();
    closeMenu();
    flushFinish();
    ctx.showHome();
  });
  $('#w-help').addEventListener('click', ctx.openHelp);
  window.addEventListener('resize', positionMenu);

  return { start, state: w, render: renderAll };
}
