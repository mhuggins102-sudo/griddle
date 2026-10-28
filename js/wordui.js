// Word mode UI: a 5x5 letter grid, 20 turns, lock words to bank points. Fits a portrait phone.

import { SIZE, idx, rowOf, colOf } from './engine.js';
import { randomSeed } from './rng.js';
import { neighbours, buildBoardSkeleton, tileIn, animateAction, animateMoves, clearTileEffects } from './board.js';
import {
  dealLetters, createWordState, applyWordAction, findWords, findWordAt, lockWord, parseDictionary, bagTotal, letterValue,
  describeWordCells, wordShareLine, slideMoves, coverageBonus, finalScore, WILD, WORD_TURNS, LETTERS,
} from './words.js';

const $ = (sel) => document.querySelector(sel);

export function initWordMode(ctx) {
  const w = {
    dict: null,
    game: null, // { seed, drawSeed, state, startedAt }
    mode: 'slide',
    selected: null, // first tap for swap/nudge/draw/lock
    pending: null, // candidate word awaiting confirmation
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
  const tileEl = (cell) => tileIn(boardEl, cell);
  const showWordsOption = () => !!(ctx.store.settings && ctx.store.settings.showWords);

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
      const drawSeed = randomSeed();
      const { board, bag } = dealLetters(seed);
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
    renderStatus();
  }

  function renderHud() {
    const st = w.game.state;
    $('#w-turn').textContent = `${st.turns} / ${WORD_TURNS}`;
    $('#w-score').textContent = String(st.score);
    $('#w-finish').classList.toggle('btn-primary', st.turns >= WORD_TURNS);
    $('#w-finish').hidden = w.over;
  }

  function renderStatus() {
    const st = w.game.state;
    const el = $('#w-status');
    const done = st.turns >= WORD_TURNS;
    el.hidden = !done || w.over;
    if (done) el.textContent = 'No moves left. Lock any words you can still see, then finish.';
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
      t.classList.toggle('inert', w.over || (outOfMoves && !lockMode));
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
        if (w.over) return;
        setPending(w.pending && w.pending.key === c.key && w.pending.word === c.word ? null : c);
      });
      el.appendChild(b);
    }
  }

  function renderLocked() {
    const st = w.game.state;
    const el = $('#w-locked');
    if (!st.words.length) {
      el.innerHTML = '<span>No words locked yet.</span>';
      return;
    }
    el.innerHTML = st.words.map((x) => `<b>${x.word}</b> ${x.score}`).join(' · ') + ` · ${st.locked.length}/25 tiles locked`;
  }

  function setPending(candidate) {
    w.pending = candidate;
    w.selected = null;
    hideNudgePop();
    $('#w-draw-confirm').hidden = true;
    const confirm = $('#w-lock-confirm');
    confirm.hidden = !candidate;
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
      $('#w-bag').hidden = true; // the confirmation takes the bag's place
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
    const before = w.game.state;
    let next;
    try {
      next = applyWordAction(before, action);
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
    if (action.type === 'slide') await animateMoves(boardEl, slideMoves(before, action));
    else await animateAction(boardEl, action, before.board, next.board, setFace);
    w.animating = false;
    renderAll();
    if (action.type === 'draw' && next.lastDraw) ctx.showToast(`Drew ${next.lastDraw.drawn}; the ${next.lastDraw.tossed === WILD ? 'wild' : next.lastDraw.tossed} went into the bag.`);
    if (next.turns >= WORD_TURNS) {
      setMode('lock');
      ctx.showToast('No moves left. Lock any words you can see, then finish.', 3500);
    }
  }

  function lockPending() {
    if (!w.pending) return;
    const cand = w.pending;
    try {
      w.game.state = lockWord(w.game.state, cand);
    } catch (e) {
      ctx.showToast(e.message);
      setPending(null);
      return;
    }
    w.pending = null;
    $('#w-lock-confirm').hidden = true;
    persist();
    renderAll();
    for (const c of cand.cells) tileEl(c).classList.add('bump');
    ctx.showToast(`${cand.word} locked for ${cand.score}.`);
  }

  function finish() {
    const st = w.game.state;
    const lockable = w.found.filter((c) => c.lockable).length;
    if (st.turns < WORD_TURNS && !confirm(`Finish now with ${WORD_TURNS - st.turns} moves unused?`)) return;
    if (showWordsOption() && lockable && !confirm(`${lockable} word${lockable === 1 ? '' : 's'} on the board ${lockable === 1 ? 'is' : 'are'} not locked yet. Finish anyway?`)) return;
    w.over = true;
    setPending(null);
    const bonus = coverageBonus(st.locked.length);
    const total = finalScore(st);
    const store = ctx.store;
    store.word ||= { gamesPlayed: 0, best: null, history: [] };
    const isBest = store.word.best === null || total > store.word.best;
    if (isBest) store.word.best = total;
    store.word.gamesPlayed++;
    store.word.history.unshift({ at: new Date().toISOString(), seed: w.game.seed, drawSeed: w.game.drawSeed, score: total, bonus, words: st.words.map((x) => ({ word: x.word, score: x.score })) });
    store.word.history = store.word.history.slice(0, 50);
    store.wordGame = null;
    ctx.saveStore(store);
    $('#w-action-panel').hidden = true;
    $('#w-found-wrap').hidden = true;
    $('#w-result').hidden = false;
    $('#w-result-score').textContent = String(total);
    const wordsText = st.words.length ? st.words.map((x) => `${x.word} ${x.score}`).join(', ') : 'No words locked.';
    $('#w-result-words').textContent = bonus ? `${wordsText}. Coverage bonus +${bonus} for locking ${st.locked.length} of 25 tiles.` : `${wordsText} ${st.locked.length} of 25 tiles locked.`;
    $('#w-result-best').textContent = isBest ? 'New personal best!' : `Personal best: ${store.word.best}`;
    $('#w-share-line').textContent = wordShareLine(total, st.words);
    renderHud();
    renderBoard();
    renderBag();
    renderStatus();
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
      if (w.pending) setPending(null);
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
  $('#w-share').addEventListener('click', copyShare);
  $('#w-again').addEventListener('click', () => start(false));
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
