// Word mode UI: a 5x5 letter grid, 20 turns, lock words to bank points.

import { SIZE, idx, rowOf, colOf } from './engine.js';
import { randomSeed } from './rng.js';
import { neighbours, buildBoardSkeleton, tileIn, animateAction, clearTileEffects } from './board.js';
import {
  dealLetters, createWordState, applyWordAction, findWords, lockWord, parseDictionary, bagTotal, letterValue,
  describeWordCells, wordShareLine, WILD, WORD_TURNS, LETTERS,
} from './words.js';

const $ = (sel) => document.querySelector(sel);

const MODE_HINTS = {
  slide: 'Tap an arrow to slide that row or column. Lines holding a locked tile cannot slide.',
  swap: 'Tap a tile, then a highlighted neighbour to swap them. Locked tiles stay put.',
  nudge: 'Tap a tile, then +1 or −1 to step it through the alphabet (Z wraps to A). Nudging a locked tile turns it wild.',
  draw: 'Tap a tile to replace it with a random letter from the bag. This cannot be undone.',
};

export function initWordMode(ctx) {
  const w = {
    dict: null,
    game: null, // { seed, drawSeed, state }
    mode: 'slide',
    selected: null,
    pending: null, // candidate word awaiting lock confirmation
    found: [],
    animating: false,
    over: false,
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
  const applyFace = (tile, ch) => setFace(tile, ch);
  const tileEl = (cell) => tileIn(boardEl, cell);

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

  async function start(resume) {
    if (!(await ensureDict())) return;
    if (resume && ctx.store.wordGame) {
      w.game = ctx.store.wordGame;
    } else {
      const seed = randomSeed();
      const { board, bag } = dealLetters(seed);
      const drawSeed = randomSeed();
      w.game = { seed, drawSeed, state: createWordState(board, bag, drawSeed), startedAt: new Date().toISOString() };
      persist();
    }
    w.over = false;
    w.selected = null;
    w.pending = null;
    ctx.showScreen('screen-word');
    $('#w-result').hidden = true;
    $('#w-action-panel').hidden = false;
    setMode('slide');
    renderAll();
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
    $('#w-turn').textContent = `${st.turns} / ${WORD_TURNS}`;
    $('#w-score').textContent = String(st.score);
    const best = ctx.store.word && ctx.store.word.best;
    $('#w-best').textContent = best === null || best === undefined ? '–' : String(best);
    const left = WORD_TURNS - st.turns;
    $('#w-finish').textContent = left > 0 ? `Finish early` : 'Finish';
    $('#w-turns-left').textContent = left > 0 ? `${left} move${left === 1 ? '' : 's'} left` : 'No moves left. Lock any words you see, then finish.';
  }

  function renderBoard() {
    const st = w.game.state;
    const pendingCells = w.pending ? new Set(w.pending.cells) : null;
    const outOfMoves = st.turns >= WORD_TURNS;
    for (let i = 0; i < st.board.length; i++) {
      const t = tileEl(i);
      clearTileEffects(t);
      setFace(t, st.board[i]);
      const locked = st.locked.includes(i);
      t.classList.toggle('locked', locked);
      t.classList.toggle('wild', st.board[i] === WILD);
      t.classList.toggle('region', !!pendingCells && pendingCells.has(i));
      t.classList.toggle('selected', w.selected === i);
      t.classList.toggle('inert', outOfMoves || w.over);
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
      a.disabled = cells.some((c) => st.locked.includes(c));
    }
  }

  function renderBag() {
    const bag = w.game.state.bag;
    const el = $('#w-bag');
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
    const lockable = w.found.filter((c) => c.lockable);
    const el = $('#w-found');
    el.innerHTML = '';
    $('#w-found-count').textContent = lockable.length ? `${lockable.length} to lock` : 'none yet';
    if (!lockable.length) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'Spell a word of 3 to 5 letters along a row, column or diagonal, in either direction, then tap it here to lock it in.';
      el.appendChild(p);
    }
    for (const c of lockable.slice(0, 30)) {
      const b = document.createElement('button');
      b.className = `chip${w.pending && w.pending.key === c.key && w.pending.word === c.word ? ' active' : ''}`;
      b.innerHTML = `<span class="chip-word">${c.word}</span><span class="chip-score">${c.score}</span>`;
      b.setAttribute('aria-label', `${c.word} for ${c.score} points on ${describeWordCells(c.cells)}`);
      b.addEventListener('click', () => {
        w.pending = w.pending && w.pending.key === c.key && w.pending.word === c.word ? null : c;
        w.selected = null;
        hideNudgePop();
        $('#w-draw-confirm').hidden = true;
        renderBoard();
        renderWords();
      });
      el.appendChild(b);
    }
    const confirm = $('#w-lock-confirm');
    confirm.hidden = !w.pending;
    if (w.pending) $('#w-lock-text').textContent = `Lock ${w.pending.word} for ${w.pending.score} points? Its tiles will no longer move.`;
  }

  function renderLocked() {
    const st = w.game.state;
    const el = $('#w-locked-list');
    el.innerHTML = '';
    $('#w-locked').hidden = st.words.length === 0;
    for (const word of st.words) {
      const li = document.createElement('li');
      li.innerHTML = `<span>${word.word}</span><span>${word.score}</span>`;
      el.appendChild(li);
    }
  }

  function setMode(mode) {
    w.mode = mode;
    w.selected = null;
    hideNudgePop();
    $('#w-draw-confirm').hidden = true;
    for (const b of document.querySelectorAll('#w-modes .mode')) {
      b.classList.toggle('active', b.dataset.mode === mode);
      b.setAttribute('aria-selected', b.dataset.mode === mode ? 'true' : 'false');
    }
    $('#w-mode-hint').textContent = MODE_HINTS[mode];
    renderBoard();
  }

  function canAct() {
    return w.game && !w.over && !w.animating && w.game.state.turns < WORD_TURNS;
  }

  function onTileTap(cell) {
    if (!canAct()) return;
    const st = w.game.state;
    if (w.pending) {
      w.pending = null;
      renderWords();
    }
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
      showNudgePop(cell);
      if (st.locked.includes(cell)) ctx.showToast('Nudging a locked tile turns it wild.');
      return;
    }
    if (w.mode === 'draw') {
      if (st.locked.includes(cell)) {
        ctx.showToast('That tile is locked.');
        return;
      }
      w.selected = cell;
      renderBoard();
      $('#w-draw-confirm').hidden = false;
      $('#w-draw-text').textContent = `Replace the ${st.board[cell]} at row ${rowOf(cell) + 1}, column ${colOf(cell) + 1} with a random letter from the bag?`;
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

  async function doAction(action) {
    if (!canAct()) return;
    const before = w.game.state.board.slice();
    let next;
    try {
      next = applyWordAction(w.game.state, action);
    } catch (e) {
      ctx.showToast(e.message);
      return;
    }
    w.game.state = next;
    persist();
    hideNudgePop();
    $('#w-draw-confirm').hidden = true;
    w.selected = null;
    w.animating = true;
    await animateAction(boardEl, action, before, next.board, applyFace);
    w.animating = false;
    renderAll();
    if (action.type === 'draw' && next.lastDraw) ctx.showToast(`Drew ${next.lastDraw.drawn}; the ${next.lastDraw.tossed === WILD ? 'wild' : next.lastDraw.tossed} went into the bag.`);
    if (next.turns >= WORD_TURNS) ctx.showToast('No moves left. Lock any words you can see, then finish.', 3500);
  }

  function lockPending() {
    if (!w.pending) return;
    try {
      w.game.state = lockWord(w.game.state, w.pending);
    } catch (e) {
      ctx.showToast(e.message);
      w.pending = null;
      renderWords();
      return;
    }
    const locked = w.pending;
    w.pending = null;
    persist();
    for (const c of locked.cells) tileEl(c).classList.add('bump');
    renderAll();
    ctx.showToast(`${locked.word} locked for ${locked.score}.`);
  }

  function finish() {
    const st = w.game.state;
    const lockable = w.found.filter((c) => c.lockable).length;
    if (st.turns < WORD_TURNS && !confirm(`Finish now with ${WORD_TURNS - st.turns} moves unused?`)) return;
    if (lockable && !confirm(`${lockable} word${lockable === 1 ? '' : 's'} on the board ${lockable === 1 ? 'is' : 'are'} not locked yet. Finish anyway?`)) return;
    w.over = true;
    const store = ctx.store;
    store.word ||= { gamesPlayed: 0, best: null, history: [] };
    const isBest = store.word.best === null || st.score > store.word.best;
    if (isBest) store.word.best = st.score;
    store.word.gamesPlayed++;
    store.word.history.unshift({ at: new Date().toISOString(), seed: w.game.seed, drawSeed: w.game.drawSeed, score: st.score, words: st.words.map((x) => ({ word: x.word, score: x.score })) });
    store.word.history = store.word.history.slice(0, 50);
    store.wordGame = null;
    ctx.saveStore(store);
    $('#w-action-panel').hidden = true;
    $('#w-result').hidden = false;
    $('#w-result-score').textContent = String(st.score);
    $('#w-result-words').textContent = st.words.length ? st.words.map((x) => `${x.word} ${x.score}`).join(', ') : 'No words locked.';
    $('#w-result-best').textContent = isBest ? 'New personal best!' : `Personal best: ${store.word.best}`;
    $('#w-share-line').textContent = wordShareLine(st.score, st.words);
    renderHud();
    renderBoard();
    window.scrollTo(0, document.body.scrollHeight);
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

  // Events
  for (const b of document.querySelectorAll('#w-modes .mode')) b.addEventListener('click', () => setMode(b.dataset.mode));
  boardEl.addEventListener('click', (e) => {
    const arrow = e.target.closest('.arrow');
    if (arrow) {
      if (!canAct() || w.mode !== 'slide') return;
      if (w.pending) {
        w.pending = null;
        renderWords();
      }
      doAction({ type: 'slide', axis: arrow.dataset.axis, index: Number(arrow.dataset.index), dir: Number(arrow.dataset.dir) });
      return;
    }
    const tile = e.target.closest('.tile');
    if (tile) onTileTap(Number(tile.dataset.cell));
  });
  for (const b of document.querySelectorAll('#w-nudge-pop .nudge-btn')) {
    b.addEventListener('click', () => {
      if (w.selected === null) return;
      const cell = w.selected;
      doAction({ type: 'nudge', r: rowOf(cell), c: colOf(cell), delta: Number(b.dataset.delta) });
    });
  }
  $('#w-draw-cancel').addEventListener('click', () => {
    w.selected = null;
    $('#w-draw-confirm').hidden = true;
    renderBoard();
  });
  $('#w-draw-ok').addEventListener('click', () => {
    if (w.selected === null) return;
    const cell = w.selected;
    doAction({ type: 'draw', r: rowOf(cell), c: colOf(cell) });
  });
  $('#w-lock-cancel').addEventListener('click', () => {
    w.pending = null;
    renderBoard();
    renderWords();
  });
  $('#w-lock-ok').addEventListener('click', lockPending);
  $('#w-finish').addEventListener('click', finish);
  $('#w-share').addEventListener('click', copyShare);
  $('#w-again').addEventListener('click', () => start(false));
  $('#w-home').addEventListener('click', () => {
    w.game = null;
    ctx.showHome();
  });
  $('#w-quit').addEventListener('click', () => {
    ctx.showHome();
  });
  $('#w-help').addEventListener('click', ctx.openHelp);
  window.addEventListener('resize', () => {
    if (!$('#w-nudge-pop').hidden && w.selected !== null) showNudgePop(w.selected);
  });

  return { start, state: w };
}
