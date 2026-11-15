// GridLock UI: screens, action modes, animations, solution replay, help, share, stats.

import {
  SIZE, idx, rowOf, colOf, BID_MIN, BID_MAX, ROUNDS_PER_GAME,
  evalGoal, bestRegionCells, describeGoal, describeAction, decodeAction, applyBoardAction, deal,
} from './engine.js';
import { ANIM_MS, wait, neighbours, buildBoardSkeleton, tileIn, animateAction, clearTileEffects } from './board.js';
import { initWordMode } from './wordui.js';
import { initTutorial } from './tutorial.js';
import { initLeaderboard, bestReachedBySize, seedReached } from './leaderboard.js';
import { dailyKey, shiftDay, dailyRecords, dailyTarget } from './daily.js';
import { openSheet, closeSheet } from './sheet.js';
import { setSoundEnabled, setSoundStyle, audioState } from './sound.js';
import { TURNS_BY_SIZE } from './words.js';
import { CARDS, CARD_BY_ID, FAMILIES, cardText, cardCost } from './perks.js';
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
  $('#opt-practice').checked = !!ui.store.settings.practice;
  $('#opt-show-words').checked = !!ui.store.settings.showWords;
  syncPracticeSub();
  $('#opt-perks').checked = !!ui.store.settings.perks;
  $('#opt-sound').checked = ui.store.settings.sound !== false;
  setSoundEnabled(ui.store.settings.sound !== false);
  if (ui.store.settings.theme === 'wild') ui.store.settings.theme = 'candy'; // the first playful look, before it had a name
  applyTheme(ui.store.settings.theme);
  $('#opt-theme').value = THEMES.includes(ui.store.settings.theme) ? ui.store.settings.theme : 'system';
  $('#opt-theme').addEventListener('change', (e) => {
    ui.store.settings.theme = THEMES.includes(e.target.value) ? e.target.value : 'system';
    applyTheme(ui.store.settings.theme);
    saveStore(ui.store);
  });
  $('#opt-size-6').checked = ui.store.settings.boardSize === 6;
  $('#opt-size-5').checked = ui.store.settings.boardSize !== 6;
  for (const r of document.querySelectorAll('input[name="opt-size"]')) {
    r.addEventListener('change', () => {
      ui.store.settings.boardSize = Number(document.querySelector('input[name="opt-size"]:checked').value);
      saveStore(ui.store);
      if (!ui.store.wordGame && ui.word) ui.word.prefetch(1, boardSize()); // level 1's board is chosen while the player decides
    });
  }
  $('#opt-sound').addEventListener('change', (e) => {
    ui.store.settings.sound = e.target.checked;
    setSoundEnabled(e.target.checked);
    saveStore(ui.store);
  });
  $('#opt-practice').addEventListener('change', (e) => {
    ui.store.settings.practice = e.target.checked;
    if (e.target.checked && ui.store.wordGame && !ui.store.wordGame.practice && ui.store.wordGame.mode !== 'daily') {
      ui.store.wordGame.practice = true; // the board in progress becomes practice, for good
      showHome(); // its button says so
    }
    syncPracticeSub();
    saveStore(ui.store);
  });
  $('#opt-show-words').addEventListener('change', (e) => {
    ui.store.settings.showWords = e.target.checked; // practice mode's word list; nothing else changes
    saveStore(ui.store);
  });
  $('#opt-perks').addEventListener('change', (e) => {
    ui.store.settings.perks = e.target.checked; // new runs only: a run in progress keeps its mode
    saveStore(ui.store);
    showHome();
  });
  // the rules list every perk card from the catalogue, so the two never drift apart
  const perkList = () => { $('#help-perk-cards').innerHTML = CARDS.map((c) => `<li><b>${escapeHtml(c.name)}</b> <span class="perk-cost">◆ ${cardCost(c, boardSize())}</span> · <small>${escapeHtml(FAMILIES[c.family])}</small><br>${escapeHtml(cardText(c, boardSize()))}</li>`).join(''); };
  perkList();
  for (const r of document.querySelectorAll('input[name="opt-size"]')) r.addEventListener('change', perkList);
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
  ui.tutorial = initTutorial();
  seedReached(ui.store.word); // the per-size top levels catch up with the history; the next save keeps it
  ui.leaderboard = initLeaderboard({ store: ui.store, saveStore, showToast, boardSize, perksOn: () => !!ui.store.settings.perks });
  ui.word = initWordMode({ store: ui.store, saveStore, showScreen, showHome, showToast, openHelp, openTutorial: (size, opts) => ui.tutorial.open(size, opts), leaderboard: ui.leaderboard });
  showHome();
}

// ---------------------------------------------------------------------------
// Screens

function showScreen(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  window.scrollTo(0, 0);
}

/** The word-list switch belongs to practice mode: shown only while practice mode is on. */
function syncPracticeSub() {
  const on = !!ui.store.settings.practice;
  $('#opt-show-words-row').hidden = !on;
  $('#opt-show-words').disabled = !on;
}

function showHome() {
  ui.game = null;
  $('#number-game-buttons').hidden = !SHOW_NUMBER_GAME;
  $('#opt-numerals-row').hidden = !SHOW_NUMBER_GAME;
  $('#btn-continue').hidden = !ui.store.currentGame;
  const s = ui.store;
  const g = s.wordGame;
  // the mode with a game in progress takes the primary slot and says so under its name; pressing it offers
  // to continue or start over (no button is primary when nothing is in progress)
  const live = g && g.state ? g.mode : null;
  $('#btn-word').classList.toggle('btn-primary', live === 'levels');
  $('#btn-free').classList.toggle('btn-primary', live === 'free');
  $('#btn-daily').classList.toggle('btn-primary', live === 'daily');
  $('#word-sub').textContent = live === 'levels' ? `${describeSaved(g)} · Continue` : s.settings.perks ? 'Levels with a goal to beat · perk cards' : 'Levels with a goal to beat';
  $('#free-sub').textContent = live === 'free' ? `${describeSaved(g)} · Continue` : 'One board, no goal';
  // the daily grid: today's until it is played (or given up), then yesterday's if that one was missed, then
  // it waits for tomorrow; a daily in progress (today's or yesterday's) carries on from the button
  const today = dailyKey();
  const yday = shiftDay(today, -1);
  const recs = dailyRecords(s.word);
  const target = dailyTarget(s.word, today);
  const inPlay = live === 'daily' && (g.daily === today || g.daily === yday);
  $('#btn-daily').disabled = !target && !inPlay;
  let dailySub;
  if (inPlay) dailySub = `${g.daily === yday ? "Yesterday's grid · " : ''}${describeSaved(g)} • Continue`;
  else if (recs[today]) dailySub = `${recs[today].abandoned ? 'Given up today' : `Today's Score: ${recs[today].score} points`} • ${target ? "Play yesterday's grid" : 'Back tomorrow'}`;
  else dailySub = 'Same for everyone • One try';
  $('#daily-sub').textContent = dailySub;
  showScreen('screen-home'); // the figures live on the Stats screen
  if (!g && ui.word) ui.word.prefetch(1, boardSize()); // a new run's first board is chosen while the player is here
}

const MODE_NAMES = { levels: 'Multi Round', free: 'Single Round', daily: 'Daily Grid' };

/** A saved game in a line: size, where it stands, the score, the gold, practice. */
function describeSaved(g) {
  const size = g.size || Math.round(Math.sqrt(g.state.board.length));
  const lim = (TURNS_BY_SIZE[size] || 20) + ((g.state.perk && g.state.perk.extraTurns) || 0);
  const turn = Math.min((g.state.turns || 0) + 1, lim);
  const perks = g.perks && !g.perks.retry ? ` · ◆ ${g.perks.gold}` : '';
  const where = g.mode === 'levels' ? `Level ${g.level || 1} · ` : g.replay ? 'Replay · ' : '';
  return `${size === 6 ? '6×6 · ' : ''}${where}turn ${turn} of ${lim} · ${g.state.score || 0} points${perks}${g.practice && g.mode !== 'daily' ? ' · practice' : ''}`;
}

/** Start a fresh game of a mode; the saved game, if any, is gone by now. The daily is today's grid, or yesterday's once today's is done. */
function startMode(mode) {
  ui.store.wordGame = null;
  if (mode === 'levels') ui.word.start(false, { mode: 'levels', level: 1, size: boardSize() });
  else if (mode === 'daily') ui.word.start(false, { mode: 'daily', day: dailyTarget(ui.store.word) || dailyKey() });
  else ui.word.start(false, { mode: 'free', size: boardSize() });
}

/** The saved game is given up for another: a daily grid given up counts as the day's one try (it cannot be restarted for a better run). */
function giveUpSaved() {
  const g = ui.store.wordGame;
  if (g && g.mode === 'daily' && g.daily) {
    ui.store.word ||= { gamesPlayed: 0, best: null, history: [] };
    ui.store.word.dailies ||= {};
    ui.store.word.dailies[g.daily] = { size: g.size, score: null, abandoned: true, at: new Date().toISOString() };
  }
  ui.store.wordGame = null;
  saveStore(ui.store);
}

let resumeChoice = null; // the mode the player pressed while a game was saved

/**
 * A mode button was pressed. With nothing saved the game starts; today's daily grid in progress simply
 * carries on (it is one try, never restarted); otherwise a sheet offers to continue the saved game or to
 * start the chosen one instead.
 */
function chooseMode(mode) {
  const g = ui.store.wordGame;
  if (!g || !g.state) return startMode(mode);
  if (mode === 'daily' && g.mode === 'daily' && (g.daily === dailyKey() || g.daily === shiftDay(dailyKey(), -1))) return ui.word.start(true); // a daily in progress is only ever continued
  const saved = MODE_NAMES[g.mode] || 'Game';
  const dailySaved = g.mode === 'daily' && g.daily;
  resumeChoice = mode;
  $('#resume-title').textContent = `${saved} in progress`;
  $('#resume-detail').textContent = describeSaved(g) + (dailySaved && g.daily !== dailyKey() ? ` · ${g.daily}` : '') + (dailySaved ? '. Giving it up counts as that day\'s try.' : '');
  $('#btn-resume-continue').textContent = `Continue ${saved}`;
  const target = dailyTarget(ui.store.word);
  $('#btn-resume-new').textContent = mode === g.mode ? (mode === 'levels' ? 'Start a new run' : mode === 'daily' ? `Start ${target === dailyKey() ? "today's" : "yesterday's"} grid` : 'Start a new board') : `Start ${MODE_NAMES[mode]} instead`;
  openSheet($('#resume'));
}

function closeResume() {
  closeSheet($('#resume'));
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

/** Light, dark, or follow the system (the default). */
const THEMES = ['system', 'light', 'dark', 'candy', 'neon', 'citrus'];
const PLAYFUL = ['candy', 'neon', 'citrus']; // the looks with their own face, bouncier moves and brighter sounds
const THEME_FONTS = {
  candy: 'https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600;700&display=swap',
  neon: 'https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;700;800&display=swap',
  citrus: 'https://fonts.googleapis.com/css2?family=Nunito:wght@500;700;800&display=swap',
};

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'wild') theme = 'candy';
  if (THEMES.includes(theme) && theme !== 'system') root.dataset.theme = theme;
  else delete root.dataset.theme;
  if (THEME_FONTS[theme] && !document.getElementById(`font-${theme}`)) {
    // a playful look's face comes from Google Fonts, fetched only when that look is chosen; without it the system font stands in
    const link = document.createElement('link');
    link.id = `font-${theme}`;
    link.rel = 'stylesheet';
    link.href = THEME_FONTS[theme];
    document.head.appendChild(link);
  }
  setSoundStyle(PLAYFUL.includes(theme) ? 'playful' : 'plain');
}

/** The board size chosen on the home screen (5 unless 6x6 is selected). */
function boardSize() {
  return ui.store.settings.boardSize === 6 ? 6 : 5;
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

// ---------------------------------------------------------------------------
// Stats: the finished boards, filtered by board size and by whether perk cards were on

const stats = { size: 'all', perks: 'all', cardsSort: 'use', recentOpen: false }; // the filter in force

/** The history entries the filter keeps. */
function statsEntries(filter = stats) {
  const hist = (ui.store.word && ui.store.word.history) || [];
  return hist.filter((g) => (filter.size === 'all' || (g.size === 6 ? 6 : 5) === filter.size) && (filter.perks === 'all' || !!g.perks === (filter.perks === 'on')));
}

/** The runs among some entries: boards sharing a run id (older boards, without one, count as a run each). */
function runsOf(entries) {
  const runs = new Map();
  entries.forEach((g, i) => {
    const key = g.runId || `board${i}`;
    if (!runs.has(key)) runs.set(key, []);
    runs.get(key).push(g);
  });
  return Array.from(runs.values());
}

/** The figures for a set of boards; the stored tops (which outlive the history) join in when the filter pins a size and a mode. */
function statsSummary(entries, filter) {
  const w = ui.store.word || {};
  const levels = entries.filter((g) => g.mode === 'levels');
  let top = Math.max(0, ...levels.map((g) => (g.passed ? g.level + 1 : g.level)));
  const sizes = filter.size === 'all' ? [5, 6] : [filter.size];
  const modes = filter.perks === 'all' ? ['', 'Perks'] : [filter.perks === 'on' ? 'Perks' : ''];
  for (const size of sizes) for (const mode of modes) top = Math.max(top, w[`bestReached${mode}${size}`] || 0);
  let best = Math.max(0, ...entries.map((g) => g.score));
  if (filter.perks !== 'on') for (const size of sizes) best = Math.max(best, w[size === 6 ? 'best6' : 'best'] || 0);
  const words = entries.reduce((a, g) => a + g.words.length, 0);
  const bestWord = entries.flatMap((g) => g.words).sort((a, b) => b.score - a.score)[0] || null;
  const perkBoards = entries.filter((g) => g.perks);
  const cardUses = perkBoards.reduce((a, g) => a + ((g.cards && g.cards.length) || 0), 0);
  return {
    games: entries.length,
    best: entries.length || best ? best : null,
    avg: entries.length ? Math.round(entries.reduce((a, g) => a + g.score, 0) / entries.length) : null,
    top: top || null,
    wordsPerGame: entries.length ? (words / entries.length).toFixed(1) : null,
    bestWord,
    perkRuns: runsOf(perkBoards).length,
    cardUses,
  };
}

/** Every card played in some perk boards: the share of runs it was played in and its average points per use. */
function cardRows(entries) {
  const perkBoards = entries.filter((g) => g.perks);
  const runs = runsOf(perkBoards);
  const rows = new Map();
  for (const run of runs) {
    const seen = new Set();
    for (const g of run) for (const c of g.cards || []) {
      const row = rows.get(c.id) || { id: c.id, runs: 0, uses: 0, pts: 0, paid: 0 };
      row.uses++;
      if (c.pts) { row.pts += c.pts; row.paid++; }
      if (!seen.has(c.id)) { seen.add(c.id); row.runs++; }
      rows.set(c.id, row);
    }
  }
  const out = Array.from(rows.values()).filter((r) => CARD_BY_ID[r.id]).map((r) => ({ ...r, name: CARD_BY_ID[r.id].name, share: runs.length ? r.runs / runs.length : 0, avg: r.paid ? r.pts / r.paid : null }));
  if (stats.cardsSort === 'pts') out.sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1) || b.share - a.share || (a.name < b.name ? -1 : 1));
  else out.sort((a, b) => b.share - a.share || (b.avg ?? -1) - (a.avg ?? -1) || (a.name < b.name ? -1 : 1));
  return { rows: out, runs: runs.length, boards: perkBoards.length };
}

const tile = (label, value) => `<div><span class="hud-label">${label}</span><span class="hud-value">${value ?? '–'}</span></div>`;
const seg = (name, value, options, label) => `<div class="seg seg-small" role="radiogroup" aria-label="${label}">${options.map(([v, t]) => `<label><input type="radio" name="${name}" value="${v}"${String(v) === String(value) ? ' checked' : ''}><span>${t}</span></label>`).join('')}</div>`;

/** The summary tiles; the Cards used tile opens the popup when the boards shown include perk runs, and is dimmed otherwise so the sheet keeps its size. */
function tilesHtml(sum, withCards) {
  return `<div class="stat-summary">
    ${tile('Games', sum.games)}
    ${tile('Best', sum.best)}
    ${tile('Average', sum.avg)}
    ${tile('Top level', sum.top)}
    ${tile('Words / game', sum.wordsPerGame)}
    <div><span class="hud-label">Best word</span><span class="hud-value small">${sum.bestWord ? `${escapeHtml(sum.bestWord.word)} ${sum.bestWord.score}` : '–'}</span></div>
    <button type="button" id="stats-cards-open" aria-label="Show the cards used" ${withCards ? '' : 'disabled'}><span class="hud-label">Cards used</span><span class="hud-value">${withCards ? sum.cardUses : '–'}</span></button>
  </div>`;
}

/** The recent boards, folded away until asked for, so the sheet opens at the same size whatever the filter. */
function recentHtml(entries) {
  const rows = entries.slice(0, 40)
    .map((g) => `<li><span>${g.size === 6 ? '6×6 · ' : ''}${g.perks ? '◆ ' : ''}${g.mode === 'levels' ? `L${g.level} ${g.passed ? '✓' : '✗'} ` : g.mode === 'daily' ? 'Daily ' : ''}${g.score}${g.goal ? ` / ${g.goal}` : ''} · ${g.words.length ? g.words.map((x) => escapeHtml(x.word)).join(', ') : 'no words'}</span><span>${new Date(g.at).toLocaleDateString()}</span></li>`)
    .join('');
  return `<details class="stats-recent"${stats.recentOpen ? ' open' : ''}><summary><span>Recent games</span><small>${entries.length ? `${Math.min(entries.length, 40)} of ${entries.length}` : 'none'}</small></summary>${rows ? `<ul class="stat-list">${rows}</ul>` : '<p class="stats-empty">No boards match.</p>'}</details>`;
}

function renderStats() {
  const w = ui.store.word || { gamesPlayed: 0, best: null, history: [] };
  const body = $('#stats-body');
  if (!w.gamesPlayed) {
    body.innerHTML = '<p class="hint">No games finished yet.</p>';
    return;
  }
  const hist = w.history || [];
  const anyPerks = hist.some((g) => g.perks);
  // the filters: board size, then whether perk cards were on (shown once any perk run exists)
  let html = `<div class="stats-filters">${seg('stats-size', stats.size, [['all', 'All sizes'], [5, '5×5'], [6, '6×6']], 'Board size')}${anyPerks ? seg('stats-perks', stats.perks, [['all', 'All games'], ['off', 'No cards'], ['on', 'Perk cards']], 'Perk cards') : ''}</div>`;
  const entries = statsEntries();
  const sum = statsSummary(entries, stats);
  const withCards = stats.perks !== 'off' && entries.some((g) => g.perks);
  html += tilesHtml(sum, withCards);
  html += recentHtml(entries);
  body.innerHTML = html;
  for (const r of body.querySelectorAll('input[name="stats-size"]')) r.addEventListener('change', () => { stats.size = r.value === 'all' ? 'all' : Number(r.value); renderStats(); });
  for (const r of body.querySelectorAll('input[name="stats-perks"]')) r.addEventListener('change', () => { stats.perks = r.value; renderStats(); });
  $('#stats-cards-open').addEventListener('click', openStatsCards);
  const recent = body.querySelector('.stats-recent');
  recent.addEventListener('toggle', () => { stats.recentOpen = recent.open; });
}

function showStats() {
  stats.recentOpen = false; // the list is folded away each time the sheet opens
  renderStats();
  openSheet($('#stats'));
}

/** The popup: every card played in the boards on show. */
function openStatsCards() {
  renderStatsCards();
  $('#stats-cards').hidden = false;
  $('#stats-cards-close').focus();
}

function renderStatsCards() {
  const { rows, runs, boards } = cardRows(statsEntries());
  const size = stats.size === 'all' ? '' : ` on ${stats.size}×${stats.size}`;
  $('#stats-cards-sub').textContent = `${runs} run${runs === 1 ? '' : 's'} with cards${size} · ${boards} board${boards === 1 ? '' : 's'}`;
  const list = $('#stats-cards-list');
  if (!rows.length) {
    list.innerHTML = '<p class="stats-empty">No cards played yet.</p>';
    return;
  }
  list.innerHTML = rows
    .map((r) => `<div class="stats-card"><span class="name">${escapeHtml(r.name)}</span><span class="bar"><i style="width:${Math.round(100 * r.share)}%"></i></span><span class="use">${Math.round(100 * r.share)}% of runs · ${r.uses} use${r.uses === 1 ? '' : 's'}</span><span class="pts${r.avg === null ? ' none' : ''}">${r.avg === null ? '–' : `+${r.avg.toFixed(1)}`}<small>${r.avg === null ? 'no points' : 'per use'}</small></span></div>`)
    .join('');
}

function closeStatsCards() {
  $('#stats-cards').hidden = true;
}

/** The reset sheet: wipe the device, and choose whether the leaderboard name goes with it. */
function openReset() {
  const id = ui.leaderboard.identity();
  $('#reset-forget-row').hidden = id.status === 'unasked';
  $('#reset-forget').checked = false;
  $('#reset-forget-label').textContent = id.status === 'named' ? `Also forget my leaderboard name (${id.name})` : 'Ask me about the leaderboard again';
  $('#reset-forget-sub').textContent = id.status === 'named' ? 'Your entries come off the leaderboard and you’ll be asked for a name after your next game' : 'You chose to stay anonymous';
  closeSheet($('#stats'));
  openSheet($('#reset'));
}

function resetData() {
  const forget = $('#reset-forget').checked;
  const kept = forget ? ui.leaderboard.forgetIdentity() : { ...ui.leaderboard.identity(), pending: [] };
  const fresh = defaultStore();
  fresh.settings.tutorialSeen = true; // a player clearing their data already knows the game
  fresh.leaderboard = kept; // the name and player id stay, or only the removals still owed to the server
  if (!forget && ui.store.word) { // a reset that keeps the name keeps the daily grids played: one try stays one try
    if (ui.store.word.dailies) fresh.word.dailies = ui.store.word.dailies;
    if (ui.store.word.daily) fresh.word.daily = ui.store.word.daily;
  }
  for (const k of Object.keys(ui.store)) delete ui.store[k];
  Object.assign(ui.store, fresh);
  saveStore(ui.store);
  ui.leaderboard.flush();
  $('#opt-numerals').checked = false;
  $('#opt-practice').checked = false;
  $('#opt-show-words').checked = false;
  syncPracticeSub();
  $('#opt-perks').checked = false;
  $('#opt-sound').checked = true;
  $('#opt-size-5').checked = true;
  $('#opt-theme').value = 'system';
  applyTheme('system');
  setSoundEnabled(true);
  closeSheet($('#reset'));
  showHome();
}

// ---------------------------------------------------------------------------
// Help and toast

function openHelp() {
  openSheet($('#help'));
}

function closeHelp() {
  closeSheet($('#help'));
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
  $('#btn-word').addEventListener('click', () => chooseMode('levels'));
  $('#btn-free').addEventListener('click', () => chooseMode('free'));
  $('#btn-daily').addEventListener('click', () => chooseMode('daily'));
  $('#btn-resume-continue').addEventListener('click', () => {
    closeResume();
    ui.word.start(true);
  });
  $('#btn-resume-new').addEventListener('click', () => {
    const mode = resumeChoice;
    closeResume();
    giveUpSaved();
    if (mode) startMode(mode);
  });
  $('#btn-resume-close').addEventListener('click', closeResume);
  $('#resume').addEventListener('click', (e) => {
    if (e.target === $('#resume')) closeResume();
  });
  $('#btn-help-home').addEventListener('click', openHelp);
  $('#btn-help-round').addEventListener('click', openHelp);
  $('#btn-help-close').addEventListener('click', closeHelp);
  $('#btn-help-done').addEventListener('click', closeHelp);
  $('#btn-help-tutorial').addEventListener('click', () => {
    closeHelp();
    const saved = ui.store.wordGame; // the saved game's mode, if any, so page 1 names the right one
    const perks = !!ui.store.settings.perks || !!(saved && saved.perks && !saved.perks.retry); // the perk page when the setting is on, or the saved run has cards
    ui.tutorial.open(boardSize(), saved ? { mode: saved.mode, goal: saved.goal, perks } : { perks });
  });
  // the rules read as chapters: opening one closes the others, and its title snaps to the top of the sheet
  const chapters = document.querySelectorAll('#help .chapter');
  const chapterWrap = $('#help .chapters');
  for (const d of chapters) {
    d.addEventListener('toggle', () => {
      if (!d.open) {
        chapterWrap.style.paddingBottom = '';
        return;
      }
      for (const o of chapters) if (o !== d) o.open = false;
      requestAnimationFrame(() => {
        const sc = $('#help .sheet-scroll');
        // room under the last chapters, just enough for the opened title to reach the top
        let after = 0;
        let seen = false;
        for (const o of chapters) {
          if (o === d) seen = true;
          else if (seen) after += o.offsetHeight;
        }
        chapterWrap.style.paddingBottom = `${Math.max(0, sc.clientHeight - d.offsetHeight - after - 10)}px`;
        const top = d.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 10;
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        sc.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
      });
    });
  }
  $('#btn-settings').addEventListener('click', () => openSheet($('#settings')));
  $('#btn-settings-close').addEventListener('click', () => closeSheet($('#settings')));
  $('#btn-settings-done').addEventListener('click', () => closeSheet($('#settings')));
  $('#settings').addEventListener('click', (e) => {
    if (e.target === $('#settings')) closeSheet($('#settings'));
  });
  $('#btn-stats-close').addEventListener('click', () => closeSheet($('#stats')));
  $('#btn-stats-done').addEventListener('click', () => closeSheet($('#stats')));
  $('#stats').addEventListener('click', (e) => {
    if (e.target === $('#stats')) closeSheet($('#stats'));
  });
  $('#stats-cards-close').addEventListener('click', closeStatsCards);
  $('#stats-cards').addEventListener('click', (e) => {
    if (e.target === $('#stats-cards')) closeStatsCards();
  });
  for (const r of document.querySelectorAll('input[name="stats-cards-sort"]')) r.addEventListener('change', () => { stats.cardsSort = r.value; renderStatsCards(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#stats-cards').hidden) closeStatsCards();
  });
  $('#help').addEventListener('click', (e) => {
    if (e.target === $('#help')) closeHelp();
  });
  $('#btn-stats').addEventListener('click', showStats);
  $('#btn-stats-reset').addEventListener('click', openReset);
  $('#btn-reset-confirm').addEventListener('click', resetData);
  // backing out of a reset returns to Stats, where the player came from
  const cancelReset = () => {
    closeSheet($('#reset'));
    showStats();
  };
  $('#btn-reset-cancel').addEventListener('click', cancelReset);
  $('#btn-reset-close').addEventListener('click', cancelReset);
  $('#reset').addEventListener('click', (e) => {
    if (e.target === $('#reset')) cancelReset();
  });
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
window.gridlock = { ui, deal, audioState, cardIds: () => CARDS.map((c) => c.id) };

boot();
