// Grid Bid UI: screens, action modes, animations, solution replay, help, share, stats.

import {
  SIZE, idx, rowOf, colOf, BID_MIN, BID_MAX, ROUNDS_PER_GAME,
  evalGoal, bestRegionCells, describeGoal, describeAction, decodeAction, applyBoardAction, deal,
} from './engine.js';
import { ANIM_MS, wait, neighbours, buildBoardSkeleton, tileIn, animateAction, clearTileEffects } from './board.js';
import { initWordMode } from './wordui.js';
import {
  loadStore, saveStore, newGame, currentRound, lockBid, playAction, giveUp, runningTotal, isGameOver, advanceRound,
  summarizeGame, shareLine, recordGame, findPuzzle, defaultStore,
} from './game.js';

const $ = (sel) => document.querySelector(sel);
/** The number game is hidden for now; flip this to bring it back on the home screen. */
const SHOW_NUMBER_GAME = false;
const REPLAY_STEP_MS = 900;

const ui = {
  bank: null,
  store: loadStore(),
  game: null,
  mode: 'slide',
  selected: null, // cell index for swap/nudge/draw
  highlightGoal: null, // 0 | 1 | null
  animating: false,
  replaying: false,
  bidDraft: 8,
  replayBoard: null, // board shown while the reference solution plays
};

// ---------------------------------------------------------------------------
// Boot

async function boot() {
  buildBoardSkeleton($('#board'), makeDiceFace);
  wireEvents();
  $('#opt-numerals').checked = !!ui.store.settings.numerals;
  $('#opt-show-words').checked = !!ui.store.settings.showWords;
  $('#opt-show-words').addEventListener('change', (e) => {
    ui.store.settings.showWords = e.target.checked;
    saveStore(ui.store);
  });
  try {
    const res = await fetch('data/puzzles.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    ui.bank = await res.json();
  } catch (e) {
    showToast(`Could not load the puzzle bank (${e.message}).`, 6000);
    return;
  }
  // Drop a saved game whose puzzles no longer exist in this bank.
  if (ui.store.currentGame && !ui.store.currentGame.rounds.every((r) => findPuzzle(ui.bank, r.puzzleId))) {
    ui.store.currentGame = null;
    saveStore(ui.store);
  }
  ui.word = initWordMode({ store: ui.store, saveStore, showScreen, showHome, showToast, openHelp });
  showHome();
}

// ---------------------------------------------------------------------------
// Screens

function showScreen(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  window.scrollTo(0, 0);
}

function showHome() {
  ui.game = null;
  $('#number-game-buttons').hidden = !SHOW_NUMBER_GAME;
  $('#opt-numerals-row').hidden = !SHOW_NUMBER_GAME;
  $('#btn-continue').hidden = !ui.store.currentGame;
  $('#btn-word-continue').hidden = !ui.store.wordGame;
  const s = ui.store;
  const w = s.word || { gamesPlayed: 0, best: null };
  $('#home-stats').textContent = w.gamesPlayed ? `${w.gamesPlayed} game${w.gamesPlayed === 1 ? '' : 's'} played · best ${w.best}` : '';
  if (SHOW_NUMBER_GAME && s.gamesPlayed) $('#home-stats').textContent += ` · Number game: ${s.gamesPlayed} played, best ${s.bestTotal}`;
  showScreen('screen-home');
}

function startNewGame() {
  ui.game = newGame(ui.bank, ui.store);
  ui.store.currentGame = ui.game;
  saveStore(ui.store);
  showRound();
}

function continueGame() {
  ui.game = ui.store.currentGame;
  showRound();
}

function persist() {
  ui.store.currentGame = ui.game;
  saveStore(ui.store);
}

function puzzleOf(round) {
  return findPuzzle(ui.bank, round.puzzleId);
}

// ---------------------------------------------------------------------------
// Round screen

function showRound() {
  const round = currentRound(ui.game);
  ui.selected = null;
  ui.highlightGoal = null;
  ui.replaying = false;
  ui.replayBoard = null;
  showScreen('screen-round');
  renderHud();
  renderGoals();
  renderBoard();
  renderBag();
  hideNudgePop();
  if (round.status === 'bid') {
    ui.bidDraft = 8;
    renderBid();
    $('#bid-panel').hidden = false;
    $('#action-panel').hidden = true;
    $('#result-panel').hidden = true;
    setBoardMode('inert');
  } else if (round.status === 'play') {
    $('#bid-panel').hidden = true;
    $('#action-panel').hidden = false;
    $('#result-panel').hidden = true;
    setMode(ui.mode || 'slide');
  } else {
    showResult();
  }
}

function renderHud() {
  const round = currentRound(ui.game);
  $('#hud-round').textContent = `${ui.game.index + 1} / ${ROUNDS_PER_GAME}`;
  const turns = round.state.turns;
  $('#hud-turn').textContent = round.bid === null ? `0 / –` : `${turns} / ${round.bid}`;
  $('#hud-score').textContent = String(runningTotal(ui.game));
}

function shownBoard() {
  return ui.replayBoard || currentRound(ui.game).state.board;
}

function renderGoals(board) {
  const round = currentRound(ui.game);
  const p = puzzleOf(round);
  const b = board || shownBoard();
  p.goals.forEach((g, i) => {
    const el = $(`#goal-${i}`);
    const holds = evalGoal(b, g);
    el.classList.toggle('holds', holds);
    el.classList.toggle('highlighted', ui.highlightGoal === i);
    el.querySelector('.goal-text').innerHTML = `${escapeHtml(describeGoal(g))} <small>${holds ? '· holds' : ''}</small>`;
    el.setAttribute('aria-pressed', ui.highlightGoal === i ? 'true' : 'false');
    el.setAttribute('aria-label', `${describeGoal(g)}, ${holds ? 'currently holds' : 'not yet'}`);
  });
}

function renderBid() {
  $('#bid-value').textContent = String(ui.bidDraft);
  $('#bid-minus').disabled = ui.bidDraft <= BID_MIN;
  $('#bid-plus').disabled = ui.bidDraft >= BID_MAX;
}

function tileEl(cell) {
  return tileIn($('#board'), cell);
}

function makeDiceFace() {
  const face = document.createElement('div');
  face.className = 'face';
  for (let k = 0; k < 9; k++) face.appendChild(Object.assign(document.createElement('span'), { className: 'pip' }));
  return face;
}

const applyDiceFace = (tile, value) => setFace(tile.firstElementChild, value);

function setFace(face, value) {
  face.dataset.v = String(value);
  face.classList.toggle('numeral', !!ui.store.settings.numerals);
  face.setAttribute('aria-label', String(value));
  if (ui.store.settings.numerals) {
    let n = face.querySelector('.num');
    if (!n) {
      n = document.createElement('span');
      n.className = 'num';
      face.appendChild(n);
    }
    n.textContent = String(value);
  } else {
    const n = face.querySelector('.num');
    if (n) n.remove();
  }
}

function renderBoard(board) {
  const round = currentRound(ui.game);
  const b = board || shownBoard();
  const p = puzzleOf(round);
  const regionCells = ui.highlightGoal === null ? null : new Set(bestRegionCells(b, p.goals[ui.highlightGoal]));
  for (let i = 0; i < b.length; i++) {
    const t = tileEl(i);
    setFace(t.firstElementChild, b[i]);
    clearTileEffects(t);
    t.classList.toggle('region', !!regionCells && regionCells.has(i));
    t.classList.toggle('selected', ui.selected === i);
    t.setAttribute('aria-label', `Row ${rowOf(i) + 1} column ${colOf(i) + 1}: ${b[i]}`);
  }
  renderTargets();
}

function renderTargets() {
  for (const t of document.querySelectorAll('#board .tile')) t.classList.remove('target');
  if (ui.mode === 'swap' && ui.selected !== null) {
    for (const n of neighbours(ui.selected)) tileEl(n).classList.add('target');
  }
}

function renderBag(bag) {
  const round = currentRound(ui.game);
  const counts = bag || round.state.bag;
  const el = $('#bag');
  el.innerHTML = '';
  counts.forEach((n, i) => {
    const chip = document.createElement('div');
    chip.className = `bag-chip${n === 0 ? ' empty' : ''}`;
    const face = document.createElement('div');
    face.className = 'face small';
    for (let k = 0; k < 9; k++) face.appendChild(Object.assign(document.createElement('span'), { className: 'pip' }));
    setFace(face, i + 1);
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = `×${n}`;
    chip.append(face, count);
    chip.setAttribute('aria-label', `${n} tile${n === 1 ? '' : 's'} of value ${i + 1} in the bag`);
    el.appendChild(chip);
  });
}

function setBoardMode(mode) {
  const board = $('#board');
  board.classList.toggle('mode-slide', mode === 'slide');
  for (const t of board.querySelectorAll('.tile')) t.classList.toggle('inert', mode === 'inert');
}

const MODE_HINTS = {
  slide: 'Tap an arrow to slide that row or column one step. The tile pushed off wraps around.',
  swap: 'Tap a tile, then one of its highlighted neighbours to swap them.',
  nudge: 'Tap a tile, then +1 or −1. 6 wraps to 1 and 1 wraps to 6.',
  draw: 'Tap a tile to replace it with a random tile from the bag. This cannot be undone.',
};

function setMode(mode) {
  ui.mode = mode;
  ui.selected = null;
  hideNudgePop();
  $('#draw-confirm').hidden = true;
  for (const b of document.querySelectorAll('#screen-round .mode')) {
    b.classList.toggle('active', b.dataset.mode === mode);
    b.setAttribute('aria-selected', b.dataset.mode === mode ? 'true' : 'false');
  }
  $('#mode-hint').textContent = MODE_HINTS[mode];
  setBoardMode(mode);
  renderBoard();
}

// ---------------------------------------------------------------------------
// Interaction

function onTileTap(cell) {
  const round = currentRound(ui.game);
  if (round.status !== 'play' || ui.animating || ui.replaying) return;
  if (ui.mode === 'slide') return;
  if (ui.mode === 'swap') {
    if (ui.selected !== null && neighbours(ui.selected).includes(cell)) {
      const a = ui.selected;
      ui.selected = null;
      doAction({ type: 'swap', r: rowOf(a), c: colOf(a), r2: rowOf(cell), c2: colOf(cell) });
      return;
    }
    ui.selected = cell;
    renderBoard();
    return;
  }
  if (ui.mode === 'nudge') {
    ui.selected = cell;
    renderBoard();
    showNudgePop(cell);
    return;
  }
  if (ui.mode === 'draw') {
    ui.selected = cell;
    renderBoard();
    $('#draw-confirm').hidden = false;
    $('#draw-confirm-text').textContent = `Replace the ${round.state.board[cell]} at row ${rowOf(cell) + 1}, column ${colOf(cell) + 1} with a random tile from the bag?`;
  }
}

function showNudgePop(cell) {
  const pop = $('#nudge-pop');
  const tile = tileEl(cell);
  const wrap = $('.board-wrap');
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
  $('#nudge-pop').hidden = true;
}

async function doAction(action) {
  const round = currentRound(ui.game);
  const puzzle = puzzleOf(round);
  if (round.status !== 'play' || ui.animating) return;
  const before = round.state.board.slice();
  let result;
  try {
    result = playAction(round, puzzle, action);
  } catch (e) {
    showToast(e.message);
    return;
  }
  persist();
  hideNudgePop();
  $('#draw-confirm').hidden = true;
  ui.selected = null;
  ui.animating = true;
  await animateAction($('#board'), action, before, result.state.board, applyDiceFace);
  ui.animating = false;
  renderBoard();
  renderBag();
  renderGoals();
  renderHud();
  if (action.type === 'draw' && result.state.lastDraw) {
    const d = result.state.lastDraw;
    showToast(`Drew a ${d.drawn}; the ${d.tossed} went into the bag.`);
  }
  if (result.solved || result.bust) {
    await wait(350);
    showResult();
  }
}

// ---------------------------------------------------------------------------
// Result and replay

function showResult() {
  const round = currentRound(ui.game);
  const p = puzzleOf(round);
  ui.selected = null;
  hideNudgePop();
  setBoardMode('inert');
  $('#bid-panel').hidden = true;
  $('#action-panel').hidden = true;
  $('#result-panel').hidden = false;
  $('#replay-bar').hidden = true;
  const b = round.breakdown;
  $('#result-title').textContent = b.bust ? 'Bust' : round.turns < p.par ? 'Solved: you beat par!' : 'Solved';
  $('#result-par').textContent = String(p.par);
  $('#result-bid').textContent = String(round.bid);
  $('#result-turns').textContent = round.turns === null ? `${round.state.turns}+` : String(round.turns);
  $('#result-score').textContent = String(round.score);
  $('#result-breakdown').textContent = b.bust
    ? `Bust scores 0. Par was ${p.par}; you had bid ${round.bid}.`
    : `Base ${b.base} + Bonus ${b.bonus} = ${b.score}.` + (round.bid > p.par ? ` Each turn bid above par cost 15.` : round.bid < p.par ? ` Bidding under par pays 25 per turn.` : ' You matched par exactly.');
  $('#btn-next').textContent = ui.game.index === ROUNDS_PER_GAME - 1 ? 'See results' : 'Next round';
  $('#btn-solution').disabled = false;
  $('#btn-solution').textContent = 'Show solution';
  renderBoard();
  renderBag();
  renderGoals();
  renderHud();
  persist();
}

async function replaySolution() {
  const round = currentRound(ui.game);
  const p = puzzleOf(round);
  if (ui.replaying) return;
  ui.replaying = true;
  ui.highlightGoal = null;
  const btn = $('#btn-solution');
  btn.disabled = true;
  const bar = $('#replay-bar');
  bar.hidden = false;
  const text = $('#replay-text');
  const board = p.board.slice();
  ui.replayBoard = board;
  renderBoard(board);
  renderGoals(board);
  text.textContent = `Reference solution (${p.par} turns). Starting from the dealt board…`;
  await wait(REPLAY_STEP_MS);
  const actions = p.solution.map(decodeAction);
  for (let k = 0; k < actions.length && ui.replaying; k++) {
    const a = actions[k];
    const before = board.slice();
    applyBoardAction(board, a);
    text.textContent = `${k + 1}/${actions.length}: ${describeAction(a)}`;
    ui.animating = true;
    await animateAction($('#board'), a, before, board, applyDiceFace);
    ui.animating = false;
    if (!ui.replaying) break; // the player moved on mid-replay
    renderBoard(board);
    renderGoals(board);
    await wait(REPLAY_STEP_MS - ANIM_MS);
  }
  if (ui.replaying) text.textContent = `Solution complete: both goals hold after ${p.par} turns. Your final board is shown again below.`;
  await wait(1200);
  ui.replayBoard = null;
  if (!ui.replaying) return;
  ui.replaying = false;
  renderBoard();
  renderGoals();
  btn.disabled = false;
  btn.textContent = 'Replay solution';
}

function nextRound() {
  ui.replaying = false;
  ui.replayBoard = null;
  if (isGameOver(ui.game)) {
    finishGame();
    return;
  }
  advanceRound(ui.game);
  persist();
  showRound();
}

// ---------------------------------------------------------------------------
// Game end, stats, share

function finishGame() {
  const summary = summarizeGame(ui.game, ui.bank);
  const isBest = recordGame(ui.store, summary);
  saveStore(ui.store);
  ui.game = null;
  const tbody = $('#end-table tbody');
  tbody.innerHTML = '';
  summary.rounds.forEach((r, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i + 1}</td><td>${r.bid}</td><td>${r.par}</td><td>${r.bust ? 'bust' : r.turns}</td><td>${r.score}</td>`;
    tbody.appendChild(tr);
  });
  $('#end-total').textContent = String(summary.total);
  $('#end-best').textContent = isBest ? `New personal best!` : `Personal best: ${ui.store.bestTotal}`;
  $('#share-line').textContent = shareLine(summary);
  showScreen('screen-end');
}

async function copyShare() {
  const text = $('#share-line').textContent;
  try {
    if (navigator.share) {
      await navigator.share({ text });
      return;
    }
    await navigator.clipboard.writeText(text);
    showToast('Copied to clipboard.');
  } catch {
    const range = document.createRange();
    range.selectNodeContents($('#share-line'));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    showToast('Select and copy the text above.');
  }
}

function showStats() {
  const s = ui.store;
  const w = s.word || { gamesPlayed: 0, best: null, history: [] };
  const body = $('#stats-body');
  if (!w.gamesPlayed) {
    body.innerHTML = '<p class="hint">No games finished yet.</p>';
  } else {
    const hist = w.history || [];
    const avg = hist.length ? Math.round(hist.reduce((a, g) => a + g.score, 0) / hist.length) : 0;
    const wordsPlayed = hist.reduce((a, g) => a + g.words.length, 0);
    const bestWord = hist.flatMap((g) => g.words).sort((a, b) => b.score - a.score)[0];
    body.innerHTML = `
      <div class="stat-summary">
        <div><span class="hud-label">Games</span><span class="hud-value">${w.gamesPlayed}</span></div>
        <div><span class="hud-label">Best</span><span class="hud-value">${w.best}</span></div>
        <div><span class="hud-label">Average</span><span class="hud-value">${avg}</span></div>
        <div><span class="hud-label">Words locked</span><span class="hud-value">${wordsPlayed}</span></div>
        <div><span class="hud-label">Per game</span><span class="hud-value">${hist.length ? (wordsPlayed / hist.length).toFixed(1) : 0}</span></div>
        <div><span class="hud-label">Best word</span><span class="hud-value">${bestWord ? `${escapeHtml(bestWord.word)} ${bestWord.score}` : '–'}</span></div>
      </div>
      <h3>Recent games</h3>
      <ul class="stat-list">${hist
        .map((g) => `<li><span>${g.score} · ${g.words.length ? g.words.map((x) => escapeHtml(x.word)).join(', ') : 'no words'}</span><span>${new Date(g.at).toLocaleDateString()}</span></li>`)
        .join('')}</ul>
    `;
  }
  showScreen('screen-stats');
}

function resetData() {
  if (!confirm('Erase all Grid Bid data on this device (history, best score, any game in progress)?')) return;
  const fresh = defaultStore();
  for (const k of Object.keys(ui.store)) delete ui.store[k];
  Object.assign(ui.store, fresh);
  saveStore(ui.store);
  $('#opt-numerals').checked = false;
  $('#opt-show-words').checked = false;
  showHome();
}

// ---------------------------------------------------------------------------
// Help and toast

function openHelp() {
  $('#help').hidden = false;
}

function closeHelp() {
  $('#help').hidden = true;
}

let toastTimer = null;
function showToast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ---------------------------------------------------------------------------
// Events

function wireEvents() {
  $('#btn-new-game').addEventListener('click', () => {
    if (ui.store.currentGame && !confirm('Abandon the game in progress and start a new one?')) return;
    startNewGame();
  });
  $('#btn-continue').addEventListener('click', continueGame);
  $('#btn-word').addEventListener('click', () => {
    if (ui.store.wordGame && !confirm('Abandon the word game in progress and start a new one?')) return;
    ui.store.wordGame = null;
    ui.word.start(false);
  });
  $('#btn-word-continue').addEventListener('click', () => ui.word.start(true));
  $('#btn-help-home').addEventListener('click', openHelp);
  $('#btn-help-round').addEventListener('click', openHelp);
  $('#btn-help-close').addEventListener('click', closeHelp);
  $('#help').addEventListener('click', (e) => {
    if (e.target === $('#help')) closeHelp();
  });
  $('#btn-stats').addEventListener('click', showStats);
  $('#btn-stats-back').addEventListener('click', showHome);
  $('#btn-stats-reset').addEventListener('click', resetData);
  $('#opt-numerals').addEventListener('change', (e) => {
    ui.store.settings.numerals = e.target.checked;
    saveStore(ui.store);
    if (ui.game) {
      renderBoard();
      renderBag();
    }
  });

  $('#bid-minus').addEventListener('click', () => {
    ui.bidDraft = Math.max(BID_MIN, ui.bidDraft - 1);
    renderBid();
  });
  $('#bid-plus').addEventListener('click', () => {
    ui.bidDraft = Math.min(BID_MAX, ui.bidDraft + 1);
    renderBid();
  });
  $('#btn-lock').addEventListener('click', () => {
    const round = currentRound(ui.game);
    lockBid(round, ui.bidDraft);
    persist();
    showRound();
  });

  for (const b of document.querySelectorAll('#screen-round .mode')) b.addEventListener('click', () => setMode(b.dataset.mode));

  $('#board').addEventListener('click', (e) => {
    const arrow = e.target.closest('.arrow');
    if (arrow) {
      const round = currentRound(ui.game);
      if (round.status !== 'play' || ui.mode !== 'slide' || ui.animating || ui.replaying) return;
      doAction({ type: 'slide', axis: arrow.dataset.axis, index: Number(arrow.dataset.index), dir: Number(arrow.dataset.dir) });
      return;
    }
    const tile = e.target.closest('.tile');
    if (tile) onTileTap(Number(tile.dataset.cell));
  });

  for (const b of document.querySelectorAll('#screen-round .nudge-btn')) {
    b.addEventListener('click', () => {
      if (ui.selected === null) return;
      const cell = ui.selected;
      doAction({ type: 'nudge', r: rowOf(cell), c: colOf(cell), delta: Number(b.dataset.delta) });
    });
  }
  $('#draw-cancel').addEventListener('click', () => {
    ui.selected = null;
    $('#draw-confirm').hidden = true;
    renderBoard();
  });
  $('#draw-ok').addEventListener('click', () => {
    if (ui.selected === null) return;
    const cell = ui.selected;
    doAction({ type: 'draw', r: rowOf(cell), c: colOf(cell) });
  });
  $('#btn-giveup').addEventListener('click', () => {
    const round = currentRound(ui.game);
    if (round.status !== 'play' || ui.animating) return;
    if (!confirm('Give up this round? It scores 0.')) return;
    giveUp(round, puzzleOf(round));
    persist();
    showResult();
  });

  for (const g of document.querySelectorAll('#screen-round .goal')) {
    g.addEventListener('click', () => {
      const i = Number(g.dataset.goal);
      ui.highlightGoal = ui.highlightGoal === i ? null : i;
      renderGoals();
      renderBoard();
    });
  }

  $('#btn-solution').addEventListener('click', replaySolution);
  $('#btn-next').addEventListener('click', nextRound);
  $('#btn-share').addEventListener('click', copyShare);
  $('#btn-play-again').addEventListener('click', startNewGame);
  $('#btn-home').addEventListener('click', showHome);

  window.addEventListener('resize', () => {
    if (!$('#nudge-pop').hidden && ui.selected !== null) showNudgePop(ui.selected);
  });
}

// Expose a little for debugging and tests in the console.
window.gridBid = { ui, deal };

boot();
