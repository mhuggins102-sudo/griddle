// Word game UI: a 5x5 letter grid, 20 turns, lock words to bank points. Fits a portrait phone.
// Modes: levels (a bot sets a goal score per board; pass to advance) and free play (no goal).

import { SIZE, idx, rowOf, colOf } from './engine.js';
import { randomSeed } from './rng.js';
import { neighbours, buildBoardSkeleton, tileIn, animateAction, animateMoves, clearTileEffects } from './board.js';
import {
  dealLetters, createWordState, applyWordAction, findWords, findWordAt, lockWord, parseDictionary, bagTotal, letterValue,
  describeWordCells, wordShareLine, slideMoves, coverageBonus, finalScore, shortfallPenalty, WILD, WORD_TURNS, LETTERS,
  COVERAGE_TARGET,
} from './words.js';
import { botPlay, goalFor, goalPercent } from './wordbot.js';

const $ = (sel) => document.querySelector(sel);

export function initWordMode(ctx) {
  const w = {
    dict: null,
    game: null, // { seed, drawSeed, state, mode: 'levels'|'free', level, goal, botScore, prev, undoUsed, replay }
    mode: null, // no action preselected
    selected: null,
    pending: null,
    found: [],
    animating: false,
    over: false,
    worker: null,
    workerJob: 0,
  };
  const boardEl = $('#wboard');

  function makeLetterFace() {
    const face = document.createElement('div');
    face.className = 'face letter';
    face.innerHTML = '<span class="ch"></span><span class="val"></span>';
    return face;
  }
  buildBoardSkeleton(boardEl, makeLetterFace);

  function setFace(tile, ch) {
    const face = tile.firstElementChild;
    face.querySelector('.ch').textContent = ch === WILD ? '★' : ch;
    face.querySelector('.val').textContent = ch === WILD ? '' : String(letterValue(ch));
    face.classList.toggle('wild', ch === WILD);
  }
  const tileEl = (cell) => tileIn(boardEl, cell);
  const showWordsOption = () => !!(ctx.store.settings && ctx.store.settings.showWords);
  const isLevels = () => w.game && w.game.mode === 'levels';

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
    ctx.store.wordGame = w.game;
    ctx.saveStore(ctx.store);
  }

  // ---------------------------------------------------------------------------
  // Goal score from the bot (web worker, main-thread fallback)

  function computeGoal(game) {
    if (game.mode !== 'levels' || game.botScore !== null) return;
    const job = ++w.workerJob;
    const apply = (result) => {
      if (w.game !== game || job !== w.workerJob) return;
      game.botScore = result.score;
      game.botWords = result.words.map((x) => x.word);
      game.goal = goalFor(game.level, result.score);
      persist();
      renderLocked();
    };
    const fallback = () => {
      try {
        const { board, bag } = dealLetters(game.seed);
        apply(botPlay(board, bag, w.dict));
      } catch (e) {
        ctx.showToast('Could not compute a goal for this board.');
      }
    };
    if (typeof Worker === 'undefined') return fallback();
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
    const { board, bag } = dealLetters(game.seed);
    const result = botPlay(board, bag, w.dict);
    game.botScore = result.score;
    game.botWords = result.words.map((x) => x.word);
    game.goal = goalFor(game.level, result.score);
  }

  // ---------------------------------------------------------------------------
  // Start / resume

  /**
   * start(true) resumes the saved game. start(false, { mode: 'levels'|'free', level, seed, drawSeed, replay })
   * starts a new board; seed/drawSeed replay a known board.
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
    } else {
      const seed = opts.seed ?? randomSeed();
      const drawSeed = opts.drawSeed ?? randomSeed();
      const { board, bag } = dealLetters(seed);
      w.game = {
        seed,
        drawSeed,
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
      if (opts.replay) ctx.showToast('Replaying this board. Not counted in your stats.', 2500);
    }
    w.over = false;
    w.selected = null;
    w.pending = null;
    w.mode = null;
    ctx.showScreen('screen-word');
    $('#w-result').hidden = true;
    $('#w-action-panel').hidden = false;
    setMode(null);
    renderAll();
    computeGoal(w.game);
  }

  function renderAll() {
    renderHud();
    renderBoard();
    renderBag();
    renderWords();
    renderLocked();
  }

  function renderHud() {
    const st = w.game.state;
    const done = st.turns >= WORD_TURNS;
    $('#w-turn').textContent = `${st.turns} / ${WORD_TURNS}${w.game.replay ? ' ↻' : ''}`;
    $('#w-score').textContent = String(st.score);
    $('#w-finish').classList.toggle('btn-primary', done && !w.over);
    $('#w-finish').hidden = w.over;
    const undo = $('#w-undo');
    undo.hidden = w.over;
    undo.disabled = !w.game.prev || w.game.undoUsed;
    undo.title = w.game.undoUsed ? 'Undo already used this game' : !w.game.prev ? 'Nothing to undo (draws cannot be undone)' : 'Undo the last move (once per game)';
  }

  function renderBoard() {
    const st = w.game.state;
    const pendingCells = w.pending ? new Set(w.pending.cells) : null;
    const outOfMoves = st.turns >= WORD_TURNS;
    const lockMode = w.mode === 'lock';
    for (let i = 0; i < st.board.length; i++) {
      const t = tileEl(i);
      clearTileEffects(t);
      setFace(t, st.board[i]);
      const locked = st.locked.includes(i);
      t.classList.toggle('locked', locked);
      t.classList.toggle('wild', st.board[i] === WILD);
      t.classList.toggle('region', !!pendingCells && pendingCells.has(i));
      t.classList.toggle('selected', w.selected === i && !lockMode);
      t.classList.toggle('first-pick', w.selected === i && lockMode);
      t.classList.toggle('inert', w.over || outOfMoves || w.mode === null);
      t.setAttribute('aria-label', `Row ${rowOf(i) + 1} column ${colOf(i) + 1}: ${st.board[i] === WILD ? 'wild' : st.board[i]}${locked ? ', locked' : ''}`);
    }
    for (const t of boardEl.querySelectorAll('.tile')) t.classList.remove('target');
    if (w.mode === 'swap' && w.selected !== null) {
      for (const n of neighbours(w.selected)) if (!st.locked.includes(n)) tileEl(n).classList.add('target');
    }
    boardEl.classList.toggle('mode-slide', w.mode === 'slide' && !outOfMoves && !w.over);
    for (const a of boardEl.querySelectorAll('.arrow')) {
      const cells = [];
      for (let k = 0; k < SIZE; k++) cells.push(a.dataset.axis === 'row' ? idx(Number(a.dataset.index), k) : idx(k, Number(a.dataset.index)));
      a.disabled = cells.filter((c) => !st.locked.includes(c)).length < 2;
    }
  }

  function renderBag() {
    const bag = w.game.state.bag;
    const el = $('#w-bag');
    el.hidden = w.mode !== 'draw' || w.over;
    el.innerHTML = `<div class="bag-title">Bag: ${bagTotal(bag)} tiles</div>`;
    for (const ch of LETTERS) {
      const chip = document.createElement('span');
      chip.className = `bag-letter${bag[ch] === 0 ? ' empty' : ''}`;
      chip.textContent = `${ch}${bag[ch]}`;
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
      b.setAttribute('aria-label', `${c.word} for ${c.score} points on ${describeWordCells(c.cells)}`);
      b.addEventListener('click', () => {
        if (w.over || st.turns >= WORD_TURNS) return;
        setPending(w.pending && w.pending.key === c.key && w.pending.word === c.word ? null : c);
      });
      el.appendChild(b);
    }
  }

  function renderLocked() {
    const st = w.game.state;
    const g = w.game;
    const parts = [];
    if (g.mode === 'levels') parts.push(`<b>Level ${g.level}</b> · goal ${g.goal === null ? '…' : g.goal}`);
    if (st.words.length) parts.push(st.words.map((x) => `<b>${x.word}</b> ${x.score}`).join(' · '));
    else parts.push('no words yet');
    parts.push(`${st.locked.length}/25 locked`);
    $('#w-locked').innerHTML = parts.join(' · ');
  }

  function setPending(candidate) {
    w.pending = candidate;
    w.selected = null;
    hideNudgePop();
    $('#w-draw-confirm').hidden = true;
    const confirmEl = $('#w-lock-confirm');
    confirmEl.hidden = !candidate;
    if (candidate) $('#w-lock-text').textContent = `Lock ${candidate.word} for ${candidate.score} points? Its tiles will stay put.`;
    renderBoard();
    if (showWordsOption()) renderWords();
  }

  function setMode(mode) {
    w.mode = mode;
    w.selected = null;
    hideNudgePop();
    $('#w-draw-confirm').hidden = true;
    if (w.pending) setPending(null);
    for (const b of document.querySelectorAll('#w-modes .mode')) {
      b.classList.toggle('active', b.dataset.mode === mode);
      b.setAttribute('aria-selected', b.dataset.mode === mode ? 'true' : 'false');
    }
    renderBoard();
    renderBag();
  }

  function canAct() {
    return w.game && !w.over && !w.animating && w.game.state.turns < WORD_TURNS;
  }

  function onTileTap(cell) {
    if (!w.game || w.over || w.animating) return;
    const st = w.game.state;
    if (w.mode === null) {
      ctx.showToast('Pick an action first: Slide, Swap, Nudge, Draw or Lock.', 2000);
      return;
    }
    if (st.turns >= WORD_TURNS) {
      ctx.showToast('No turns left. Press End to score the board.', 2000);
      return;
    }
    if (w.mode === 'lock') {
      if (w.selected === null) {
        w.selected = cell;
        if (w.pending) setPending(null);
        renderBoard();
        ctx.showToast('Now tap the last letter of the word.', 1500);
        return;
      }
      const first = w.selected;
      w.selected = null;
      const cand = findWordAt(st, w.dict, first, cell);
      if (cand.error) {
        ctx.showToast(cand.error, 2600);
        renderBoard();
        return;
      }
      if (!cand.lockable) {
        ctx.showToast(`Cannot lock ${cand.word}: ${cand.reason}.`, 3000);
        renderBoard();
        return;
      }
      setPending(cand);
      return;
    }
    if (!canAct()) return;
    if (w.pending) setPending(null);
    if (w.mode === 'slide') return;
    if (w.mode === 'swap') {
      if (st.locked.includes(cell)) {
        ctx.showToast('That tile is locked.');
        return;
      }
      if (w.selected !== null && neighbours(w.selected).includes(cell)) {
        const a = w.selected;
        w.selected = null;
        doAction({ type: 'swap', r: rowOf(a), c: colOf(a), r2: rowOf(cell), c2: colOf(cell) });
        return;
      }
      w.selected = cell;
      renderBoard();
      return;
    }
    if (w.mode === 'nudge') {
      w.selected = cell;
      renderBoard();
      const locked = st.locked.includes(cell);
      $('#w-wild-btn').hidden = !locked || st.board[cell] === WILD;
      showNudgePop(cell);
      if (locked) ctx.showToast('Locked tile: nudge for 1 turn, or ★ to make it wild for 2 turns.', 2600);
      return;
    }
    if (w.mode === 'draw') {
      if (st.locked.includes(cell)) {
        ctx.showToast('That tile is locked.');
        return;
      }
      w.selected = cell;
      renderBoard();
      $('#w-bag').hidden = true; // the confirmation takes the bag's place
      $('#w-draw-confirm').hidden = false;
      $('#w-draw-text').textContent = `Replace the ${st.board[cell]} at row ${rowOf(cell) + 1}, column ${colOf(cell) + 1} with a random letter from the bag? Draws cannot be undone.`;
    }
  }

  function showNudgePop(cell) {
    const pop = $('#w-nudge-pop');
    const tile = tileEl(cell);
    const wrap = boardEl.parentElement;
    const tr = tile.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    pop.hidden = false;
    const popW = pop.offsetWidth || 120;
    const popH = pop.offsetHeight || 48;
    let left = tr.left - wr.left + tr.width / 2;
    left = Math.max(popW / 2 + 4, Math.min(wr.width - popW / 2 - 4, left));
    let top = tr.top - wr.top - popH - 6;
    if (top < 0) top = tr.bottom - wr.top + 6;
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }

  function hideNudgePop() {
    $('#w-nudge-pop').hidden = true;
  }

  function snapshotForUndo(state) {
    return JSON.parse(JSON.stringify(state));
  }

  async function doAction(action) {
    if (!canAct()) return;
    const before = w.game.state;
    let next;
    try {
      next = applyWordAction(before, action);
    } catch (e) {
      ctx.showToast(e.message);
      return;
    }
    // A draw is random, so it cannot be undone; anything else can (once per game).
    w.game.prev = action.type === 'draw' ? null : snapshotForUndo(before);
    w.game.state = next;
    persist();
    hideNudgePop();
    $('#w-draw-confirm').hidden = true;
    w.selected = null;
    w.animating = true;
    if (action.type === 'slide') await animateMoves(boardEl, slideMoves(before, action));
    else await animateAction(boardEl, action.type === 'wild' ? { ...action, type: 'nudge' } : action, before.board, next.board, setFace);
    w.animating = false;
    renderAll();
    if (action.type === 'draw' && next.lastDraw) ctx.showToast(`Drew ${next.lastDraw.drawn}; the ${next.lastDraw.tossed === WILD ? 'wild' : next.lastDraw.tossed} went into the bag.`);
    if (next.turns >= WORD_TURNS) {
      setMode(null);
      ctx.showToast('No turns left. Press End to score the board (or Undo).', 3500);
    }
  }

  function lockPending() {
    if (!w.pending) return;
    const cand = w.pending;
    let next;
    try {
      next = lockWord(w.game.state, cand);
    } catch (e) {
      ctx.showToast(e.message);
      setPending(null);
      return;
    }
    w.game.prev = snapshotForUndo(w.game.state);
    w.game.state = next;
    w.pending = null;
    $('#w-lock-confirm').hidden = true;
    persist();
    renderAll();
    for (const c of cand.cells) tileEl(c).classList.add('bump');
    ctx.showToast(`${cand.word} locked for ${cand.score}.`);
    if (next.turns >= WORD_TURNS) {
      setMode(null);
      ctx.showToast('No turns left. Press End to score the board (or Undo).', 3500);
    }
  }

  function undo() {
    const g = w.game;
    if (!g || w.over || w.animating || !g.prev || g.undoUsed) return;
    if (!confirm('Undo your last move? You get one undo per game.')) return;
    g.state = g.prev;
    g.prev = null;
    g.undoUsed = true;
    persist();
    w.selected = null;
    setPending(null);
    setMode(null);
    renderAll();
    ctx.showToast('Last move undone.');
  }

  // ---------------------------------------------------------------------------
  // End of game

  function finish() {
    if (w.over) return;
    const g = w.game;
    const st = g.state;
    if (st.turns < WORD_TURNS && !confirm(`End now with ${WORD_TURNS - st.turns} turns unused?`)) return;
    ensureGoalNow(g);
    w.over = true;
    w.lastBoard = { seed: g.seed, drawSeed: g.drawSeed };
    setPending(null);
    hideNudgePop();
    const bonus = coverageBonus(st.locked.length);
    const penalty = shortfallPenalty(st.locked.length);
    const total = finalScore(st);
    const store = ctx.store;
    store.word ||= { gamesPlayed: 0, best: null, history: [] };
    store.word.boards ||= {};
    const boardKey = `${g.seed}:${g.drawSeed}`;
    const previousOnBoard = store.word.boards[boardKey];
    const beatBoard = previousOnBoard !== undefined && total > previousOnBoard;
    if (previousOnBoard === undefined || total > previousOnBoard) store.word.boards[boardKey] = total;
    const passed = g.mode === 'levels' && total >= g.goal;
    let isBest = false;
    if (!g.replay) {
      isBest = store.word.best === null || total > store.word.best;
      if (isBest) store.word.best = total;
      store.word.gamesPlayed++;
      if (passed) store.word.bestLevel = Math.max(store.word.bestLevel || 0, g.level);
      store.word.history.unshift({
        at: new Date().toISOString(), seed: g.seed, drawSeed: g.drawSeed, score: total, bonus, mode: g.mode, level: g.level, goal: g.goal, passed,
        words: st.words.map((x) => ({ word: x.word, score: x.score })),
      });
      store.word.history = store.word.history.slice(0, 50);
    }
    store.wordGame = null;
    ctx.saveStore(store);

    $('#w-action-panel').hidden = true;
    $('#w-found-wrap').hidden = true;
    $('#w-result').hidden = false;
    $('#w-result-score').textContent = String(total);
    const wordsText = st.words.length ? st.words.map((x) => `${x.word} ${x.score}`).join(', ') : 'No words locked';
    let tally = `${wordsText} = ${st.score}. ${st.locked.length} of 25 tiles locked`;
    if (bonus) tally += `: bonus +${bonus}`;
    if (penalty) tally += `: ${COVERAGE_TARGET - st.locked.length} short of ${COVERAGE_TARGET}, penalty −${penalty}`;
    if (st.score + bonus - penalty < 0) tally += ' (score floored at 0)';
    $('#w-result-words').textContent = `${tally}.`;

    let title = g.replay ? 'Replay over' : 'Game over';
    let line;
    if (g.mode === 'levels') {
      title = passed ? `Level ${g.level} passed!` : `Level ${g.level} failed`;
      line = `Goal ${g.goal} (${goalPercent(g.level)}% of the bot's ${g.botScore}${g.botWords ? `: ${g.botWords.join(', ')}` : ''}).`;
      if (!passed) line += ` ${g.goal - total} short.`;
    } else if (g.replay) {
      line = beatBoard ? `Replay: beat your previous best on this board (${previousOnBoard})!` : `Replay: best on this board stays ${previousOnBoard}. Not counted in stats.`;
    } else {
      line = isBest ? 'New personal best!' : `Personal best: ${store.word.best}`;
    }
    if (g.mode === 'levels' && g.replay) line += ' Replay: not counted.';
    $('#w-result h2').textContent = title;
    $('#w-result-best').textContent = line;
    $('#w-share-line').textContent = (g.mode === 'levels' ? `Level ${g.level} ${passed ? 'passed' : 'failed'} · ` : '') + wordShareLine(total, st.words);
    $('#w-next').hidden = !(g.mode === 'levels' && passed && !g.replay);
    $('#w-again').textContent = g.mode === 'levels' && !passed ? 'New game' : g.mode === 'levels' ? 'Free play' : 'New board';
    w.nextLevel = passed ? g.level + 1 : 1;
    renderHud();
    renderBoard();
    renderBag();
    renderLocked();
  }

  async function copyShare() {
    const text = $('#w-share-line').textContent;
    try {
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      ctx.showToast('Copied to clipboard.');
    } catch {
      ctx.showToast('Select and copy the text above.');
    }
  }

  // ---------------------------------------------------------------------------
  // Events

  for (const b of document.querySelectorAll('#w-modes .mode')) {
    b.addEventListener('click', () => setMode(w.mode === b.dataset.mode ? null : b.dataset.mode));
  }
  boardEl.addEventListener('click', (e) => {
    const arrow = e.target.closest('.arrow');
    if (arrow) {
      if (!canAct() || w.mode !== 'slide') return;
      if (w.pending) setPending(null);
      doAction({ type: 'slide', axis: arrow.dataset.axis, index: Number(arrow.dataset.index), dir: Number(arrow.dataset.dir) });
      return;
    }
    const tile = e.target.closest('.tile');
    if (tile) onTileTap(Number(tile.dataset.cell));
  });
  for (const b of document.querySelectorAll('#w-nudge-pop .nudge-btn:not(.wild-btn)')) {
    b.addEventListener('click', () => {
      if (w.selected === null) return;
      const cell = w.selected;
      doAction({ type: 'nudge', r: rowOf(cell), c: colOf(cell), delta: Number(b.dataset.delta) });
    });
  }
  $('#w-wild-btn').addEventListener('click', () => {
    if (w.selected === null) return;
    const cell = w.selected;
    doAction({ type: 'wild', r: rowOf(cell), c: colOf(cell) });
  });
  $('#w-draw-cancel').addEventListener('click', () => {
    w.selected = null;
    $('#w-draw-confirm').hidden = true;
    renderBoard();
    renderBag();
  });
  $('#w-draw-ok').addEventListener('click', () => {
    if (w.selected === null) return;
    const cell = w.selected;
    doAction({ type: 'draw', r: rowOf(cell), c: colOf(cell) });
  });
  $('#w-lock-cancel').addEventListener('click', () => setPending(null));
  $('#w-lock-ok').addEventListener('click', lockPending);
  $('#w-finish').addEventListener('click', finish);
  $('#w-undo').addEventListener('click', undo);
  $('#w-share').addEventListener('click', copyShare);
  $('#w-next').addEventListener('click', () => start(false, { mode: 'levels', level: w.nextLevel || 1 }));
  $('#w-again').addEventListener('click', () => {
    const g = w.game;
    if (g && g.mode === 'levels' && !$('#w-next').hidden) start(false, { mode: 'free' });
    else if (g && g.mode === 'levels') start(false, { mode: 'levels', level: 1 });
    else start(false, { mode: 'free' });
  });
  $('#w-replay').addEventListener('click', () => {
    if (w.lastBoard) start(false, { mode: 'free', seed: w.lastBoard.seed, drawSeed: w.lastBoard.drawSeed, replay: true });
  });
  $('#w-home').addEventListener('click', () => {
    w.game = null;
    ctx.showHome();
  });
  $('#w-quit').addEventListener('click', () => ctx.showHome());
  $('#w-help').addEventListener('click', ctx.openHelp);
  window.addEventListener('resize', () => {
    if (!$('#w-nudge-pop').hidden && w.selected !== null) showNudgePop(w.selected);
  });

  return { start, state: w };
}
