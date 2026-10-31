// Step-by-step tutorial: an intro, one page per move and two on scoring, each with a worked example
// on a small board of the game's own size, animated with the game's tile animations and sounds.
// The move's result is outlined once it lands. Pure DOM; opened from the in-game help button.

import { ANIM_MS, wait, buildBoardSkeleton, tileIn, animateAction, beginMoves, removeGhosts, clearTileEffects } from './board.js';
import { createWordState, slideMoves, applyWordAction, letterValue, scoreWord, LENGTH_BONUS, COVERAGE_LADDER, TURNS_BY_SIZE, FULL_COVER_TURN_BONUS, WILD_COST } from './words.js';
import { GOAL_START_PERCENT, GOAL_STEP_PERCENT } from './wordbot.js';
import { play } from './sound.js';

const $ = (sel) => document.querySelector(sel);

/** Worked examples per board size. The word appears on row 1 after the move; cells are its tiles. */
const EXAMPLES = {
  5: {
    slide: { rows: ['TNGKP', 'READB', 'LMSDH', 'OCTRY', 'UEBAN'], action: { type: 'slide', axis: 'row', index: 1, dir: 1 }, word: 'BREAD', cells: [5, 6, 7, 8, 9], note: 'READ with a B stuck on the end. Flick the row right: the B wraps round to the front and the row reads BREAD.' },
    swap: { rows: ['KPDRT', 'STAEK', 'MNLGO', 'HUCIY', 'DBAWS'], action: { type: 'swap', r: 1, c: 2, r2: 1, c2: 3 }, word: 'STEAK', cells: [5, 6, 7, 8, 9], note: 'STAEK is two letters out of order. Drag the A onto the E and they trade places: STEAK.' },
    nudge: { rows: ['MKTLP', 'PRIYE', 'SNDGO', 'CHWAT', 'LUIBR'], action: { type: 'nudge', r: 1, c: 3, delta: 1 }, word: 'PRIZE', cells: [5, 6, 7, 8, 9], note: 'PRIYE is one letter off. Hold the Y and nudge it up: Y becomes Z, worth 10 points, and the row reads PRIZE.' },
    draw: { rows: ['GNTSK', 'WOUSE', 'RLMDP', 'AICHY', 'TEONB'], action: { type: 'draw', r: 1, c: 0 }, drawn: 'H', word: 'HOUSE', cells: [5, 6, 7, 8, 9], note: 'WOUSE needs a different first letter. Hold the W and choose Draw: a random letter from the bag replaces it (the W goes back into the bag). This time the bag gave an H: HOUSE.' },
    lock: { rows: ['TNGKP', 'BREAD', 'LMSDH', 'OCTRY', 'UEBAN'], taps: [5, 9], word: 'BREAD', cells: [5, 6, 7, 8, 9], note: 'Tap the B, then the D. BREAD locks at once: its points are banked and its tiles turn green and never move again.' },
  },
  6: {
    slide: { rows: ['SKPTNL', 'ARROTC', 'DMUGEY', 'IBHWOA', 'NRTEKS', 'LDPMIU'], action: { type: 'slide', axis: 'row', index: 1, dir: 1 }, word: 'CARROT', cells: [6, 7, 8, 9, 10, 11], note: 'ARROTC is CARROT with its C at the wrong end. Flick the row right: the C wraps round to the front.' },
    swap: { rows: ['PLDSKM', 'HONIGN', 'TRWUAE', 'CYBOND', 'SIGEAK', 'MLTRUO'], action: { type: 'swap', r: 1, c: 4, r2: 1, c2: 5 }, word: 'HONING', cells: [6, 7, 8, 9, 10, 11], note: 'HONIGN has its last two letters swapped. Drag the G onto the N and they trade places: HONING.' },
    nudge: { rows: ['TKRMDS', 'PLAYES', 'NGOUIB', 'WHCDAT', 'EORLKY', 'ASNTMI'], action: { type: 'nudge', r: 1, c: 5, delta: -1 }, word: 'PLAYER', cells: [6, 7, 8, 9, 10, 11], note: 'PLAYES is one letter off. Hold the S and nudge it down: S becomes R and the row reads PLAYER.' },
    draw: { rows: ['MBTWKL', 'XARDEN', 'SOUIPC', 'TRYHNA', 'DEGLOS', 'KPAIRU'], action: { type: 'draw', r: 1, c: 0 }, drawn: 'G', word: 'GARDEN', cells: [6, 7, 8, 9, 10, 11], note: 'XARDEN needs a different first letter. Hold the X and choose Draw: a random letter from the bag replaces it (the X goes back into the bag). This time the bag gave a G: GARDEN.' },
    lock: { rows: ['SKPTNL', 'CARROT', 'DMUGEY', 'IBHWOA', 'NRTEKS', 'LDPMIU'], taps: [6, 11], word: 'CARROT', cells: [6, 7, 8, 9, 10, 11], note: 'Tap the C, then the T. CARROT locks at once: its points are banked and its tiles turn green and never move again.' },
  },
};

const rowsToBoard = (rows) => rows.join('').split('');

export function initTutorial() {
  const sheet = $('#tutorial');
  const boardEl = $('#tut-board');
  const wrapEl = boardEl.parentElement;
  let boardSize = 0;
  let pages = [];
  let index = 0;
  let runId = 0;
  let size = 5;

  function makeLetterFace() {
    const face = document.createElement('div');
    face.className = 'face letter';
    face.innerHTML = '<span class="ch"></span><span class="val"></span>';
    return face;
  }
  function setFace(tile, ch) {
    const face = tile.firstElementChild;
    face.querySelector('.ch').textContent = ch;
    face.querySelector('.val').textContent = String(letterValue(ch));
  }
  function ensureBoard(n) {
    if (boardSize === n) return;
    boardSize = n;
    buildBoardSkeleton(boardEl, makeLetterFace, { arrows: false, size: n });
    boardEl.style.setProperty('--n', String(n));
    boardEl.dataset.size = String(n);
    for (const t of boardEl.querySelectorAll('.tile')) {
      t.tabIndex = -1;
      t.classList.add('inert');
    }
  }
  const tileEl = (cell) => tileIn(boardEl, cell);

  /** Draw a board; locked cells go green; outlined cells get the "this is the word" ring. */
  function render(board, { locked = [], outline = [] } = {}) {
    removeGhosts(boardEl);
    $('#tut-float').innerHTML = '';
    board.forEach((ch, i) => {
      const t = tileEl(i);
      clearTileEffects(t);
      t.classList.remove('first-pick', 'demo-tap', 'demo-word', 'selected');
      setFace(t, ch);
      t.classList.toggle('locked', locked.includes(i));
      t.classList.toggle('demo-word', outline.includes(i));
    });
  }

  function outline(cells) {
    for (const c of cells) tileEl(c).classList.add('demo-word');
  }

  function floatAt(cell, text) {
    const tr = tileEl(cell).getBoundingClientRect();
    const wr = wrapEl.getBoundingClientRect();
    const el = document.createElement('span');
    el.className = 'float good';
    el.textContent = text;
    el.style.left = `${tr.left - wr.left + tr.width / 2}px`;
    el.style.top = `${tr.top - wr.top + tr.height / 2}px`;
    $('#tut-float').appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }

  /** Play a page's move on the board; aborts quietly if the page changes or the sheet closes. */
  async function runDemo(page) {
    const run = ++runId;
    const alive = () => run === runId && !sheet.hidden;
    render(rowsToBoard(page.rows), { locked: page.locked || [], outline: page.outline || [] });
    const ex = page.ex;
    if (!ex) return;
    await wait(900);
    if (!alive()) return;
    const before = rowsToBoard(ex.rows);
    const state = createWordState(before, {});
    let after = before;
    if (page.demo === 'lock') {
      for (const cell of ex.taps) {
        const t = tileEl(cell);
        t.classList.add('first-pick', 'demo-tap');
        play('tap');
        await wait(650);
        if (!alive()) return;
      }
      for (const cell of ex.cells) tileEl(cell).classList.remove('first-pick');
      play('lock');
      ex.cells.forEach((c, i) => setTimeout(() => {
        if (alive()) tileEl(c).classList.add('lock-pop', 'locked');
      }, i * 60));
      floatAt(ex.cells[Math.floor(ex.cells.length / 2)], `${ex.word} +${scoreWord(before, ex.cells)}`);
      await wait(600 + ex.cells.length * 60);
      if (!alive()) return;
      render(before, { locked: ex.cells, outline: ex.cells });
      return;
    }
    if (page.demo === 'slide') {
      play('slide');
      beginMoves(boardEl, slideMoves(state, ex.action));
      after = applyWordAction(state, ex.action).board;
      await wait(ANIM_MS + 80);
    } else if (page.demo === 'draw') {
      play('draw');
      after = before.slice();
      after[ex.action.r * size + ex.action.c] = ex.drawn;
      await animateAction(boardEl, ex.action, before, after, setFace);
    } else {
      play(page.demo === 'nudge' ? (ex.action.delta === -1 ? 'nudgeDown' : 'nudge') : page.demo);
      after = applyWordAction(state, ex.action).board;
      await animateAction(boardEl, ex.action, before, after, setFace);
    }
    if (!alive()) return;
    render(after);
    outline(ex.cells);
  }

  function ladderText(n) {
    const ladder = COVERAGE_LADDER[n];
    const keys = Object.keys(ladder).map(Number).sort((a, b) => a - b);
    return keys.map((k) => `${k}: +${ladder[k]}`).join(' · ');
  }

  function buildPages(n, opts) {
    const ex = EXAMPLES[n];
    const turns = TURNS_BY_SIZE[n];
    const cells = n * n;
    const lockEx = ex.lock;
    const lockBoard = rowsToBoard(lockEx.rows);
    const wordPoints = scoreWord(lockBoard, lockEx.cells);
    const letters = lockEx.cells.map((c) => `${lockBoard[c]} ${letterValue(lockBoard[c])}`).join(' + ');
    const lettersSum = lockEx.cells.reduce((a, c) => a + letterValue(lockBoard[c]), 0);
    const firstRung = Math.min(...Object.keys(COVERAGE_LADDER[n]).map(Number));
    const manyLocked = Array.from({ length: cells }, (_, i) => i).filter((i) => i !== 0 && i !== cells - 1 && i !== Math.floor(cells / 2));
    const goalLine = opts.mode === 'levels'
      ? `<p>This is a <strong>level run</strong>: reach the goal score and the level is passed at once${opts.goal ? ` (this board's goal is <strong>${opts.goal}</strong>)` : ''}. Run out of turns below it and the run ends.</p>`
      : '<p>This is <strong>free play</strong>: no goal, just score as much as you can before the turns run out.</p>';
    return [
      {
        title: 'Turns and the goal',
        rows: ex.slide.rows,
        html: `<p>Every move costs <strong>one turn</strong>, and you get <strong>${turns} turns</strong> on this ${n}×${n} board. Words lock in to bank their points.</p>${goalLine}<p>Next: each of the five moves, with a board where it pays off.</p>`,
      },
      { title: 'Slide', demo: 'slide', rows: ex.slide.rows, ex: ex.slide, html: `<p><strong>Flick</strong> a row or column (or drag any of its tiles a long way). The whole line moves one step and the tile pushed off the end wraps round to the start.</p><p>${ex.slide.note}</p>` },
      { title: 'Swap', demo: 'swap', rows: ex.swap.rows, ex: ex.swap, html: `<p><strong>Drag</strong> a tile onto one of its four neighbours and let go to swap them. Locked tiles cannot move.</p><p>${ex.swap.note}</p>` },
      { title: 'Nudge', demo: 'nudge', rows: ex.nudge.rows, ex: ex.nudge, html: `<p><strong>Hold</strong> a tile for a menu, then pick the letter before or after it in the alphabet. A and Z wrap round, so an A is one nudge from a Z.</p><p>${ex.nudge.note}</p>` },
      { title: 'Draw', demo: 'draw', rows: ex.draw.rows, ex: ex.draw, html: `<p><strong>Hold</strong> a tile and choose <em>Draw</em> to swap it for a random letter from the bag. The bag button in the header shows what is left. Draw cannot be undone.</p><p>${ex.draw.note}</p>` },
      { title: 'Lock', demo: 'lock', rows: lockEx.rows, ex: lockEx, html: `<p><strong>Tap</strong> the first letter of a word, then its last. Words run along rows, columns and diagonals, in either direction.</p><p>${lockEx.note} Lines still slide around locked tiles, and a locked tile can still be nudged, drawn over, or made wild for ${WILD_COST} turns. New words may cross locked tiles as long as they add a fresh one.</p>` },
      {
        title: 'Word points',
        rows: lockEx.rows,
        locked: lockEx.cells,
        outline: lockEx.cells,
        html: `<p>A word banks its <strong>letter values</strong> plus a <strong>length bonus</strong>: +${LENGTH_BONUS[4]} for four letters, +${LENGTH_BONUS[5]} for five${n === 6 ? `, +${LENGTH_BONUS[6]} for six` : ''}.</p><p>${lockEx.word}: ${letters} = ${lettersSum}, plus ${LENGTH_BONUS[lockEx.cells.length]} for ${lockEx.cells.length} letters = <strong>${wordPoints}</strong>.</p><p>Values: A E I O U L N S T R 1 · D G 2 · B C M P 3 · F H V W Y 4 · K 5 · J X 8 · Q Z 10 · wild 0.</p>`,
      },
      {
        title: 'Filling the board',
        rows: lockEx.rows,
        locked: manyLocked,
        html: `<p>From the <strong>${firstRung}th locked tile</strong> every tile adds +5 to your score (${ladderText(n)}). Lock all ${cells} with turns to spare and each spare turn adds +${FULL_COVER_TURN_BONUS}. The board here has ${manyLocked.length} locked: +${COVERAGE_LADDER[n][manyLocked.length] || 0}.</p><p>In a level run a bot plays your board first; the goal is a share of the word points it banked, ${GOAL_START_PERCENT}% at level 1 and ${GOAL_STEP_PERCENT} points more each level, with no ceiling. Your fill bonuses count toward it, so crossing words through locked tiles to cover the board is what carries a run.</p>`,
      },
    ];
  }

  function show(i) {
    index = Math.max(0, Math.min(pages.length - 1, i));
    const page = pages[index];
    $('#tut-step').textContent = `${index + 1} of ${pages.length}`;
    $('#tut-title').textContent = page.title;
    $('#tut-text').innerHTML = page.html;
    $('#tut-back').disabled = index === 0;
    $('#tut-next').textContent = index === pages.length - 1 ? 'Done' : 'Next';
    $('#tut-replay').hidden = !page.demo;
    const dots = $('#tut-dots');
    dots.innerHTML = '';
    pages.forEach((_, k) => {
      const d = document.createElement('span');
      if (k === index) d.classList.add('on');
      dots.appendChild(d);
    });
    runDemo(page);
  }

  /** Open the tutorial for a board size; opts: { mode: 'levels'|'free', goal } from the game in play. */
  function open(n, opts = {}) {
    size = TURNS_BY_SIZE[n] ? n : 5;
    ensureBoard(size);
    pages = buildPages(size, opts);
    sheet.hidden = false;
    show(0);
    $('#tut-next').focus();
  }

  function close() {
    runId++;
    sheet.hidden = true;
  }

  $('#tut-close').addEventListener('click', close);
  $('#tut-back').addEventListener('click', () => show(index - 1));
  $('#tut-next').addEventListener('click', () => (index === pages.length - 1 ? close() : show(index + 1)));
  $('#tut-replay').addEventListener('click', () => runDemo(pages[index]));
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) close();
  });
  document.addEventListener('keydown', (e) => {
    if (sheet.hidden) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') show(index + 1);
    else if (e.key === 'ArrowLeft') show(index - 1);
  });

  return { open, close };
}
