// Shared board DOM helpers: the 7x7 skeleton (tiles plus a ring of slide arrows), tile lookup
// and the per-action animations. Used by the number game (ui.js) and Word mode (wordui.js).

import { SIZE, idx, rowOf, colOf } from './engine.js';

export const ANIM_MS = 200;

export function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function neighbours(cell) {
  const r = rowOf(cell);
  const c = colOf(cell);
  const out = [];
  if (r > 0) out.push(idx(r - 1, c));
  if (r < SIZE - 1) out.push(idx(r + 1, c));
  if (c > 0) out.push(idx(r, c - 1));
  if (c < SIZE - 1) out.push(idx(r, c + 1));
  return out;
}

export function makeArrow(axis, index, dir) {
  const a = document.createElement('button');
  const name = axis === 'row' ? (dir === 1 ? 'right' : 'left') : dir === 1 ? 'down' : 'up';
  a.className = `arrow ${name}`;
  a.dataset.axis = axis;
  a.dataset.index = String(index);
  a.dataset.dir = String(dir);
  a.setAttribute('aria-label', `Slide ${axis === 'row' ? 'row' : 'column'} ${index + 1} ${name}`);
  a.tabIndex = -1;
  return a;
}

/**
 * Build the board into boardEl. makeFace() returns the element placed inside each tile.
 * With arrows (the default) the grid is 7x7: the outer ring holds the slide arrows. With
 * { arrows: false } it is a plain 5x5 of tiles (Word mode slides by gesture instead).
 */
export function buildBoardSkeleton(boardEl, makeFace, { arrows = true } = {}) {
  boardEl.innerHTML = '';
  const lo = arrows ? -1 : 0;
  const hi = arrows ? SIZE : SIZE - 1;
  for (let r = lo; r <= hi; r++) {
    for (let c = lo; c <= hi; c++) {
      const isRowEdge = r === -1 || r === SIZE;
      const isColEdge = c === -1 || c === SIZE;
      if (isRowEdge && isColEdge) {
        const d = document.createElement('div');
        d.className = 'corner';
        boardEl.appendChild(d);
      } else if (isRowEdge) {
        boardEl.appendChild(makeArrow('col', c, r === -1 ? -1 : 1));
      } else if (isColEdge) {
        boardEl.appendChild(makeArrow('row', r, c === -1 ? -1 : 1));
      } else {
        const t = document.createElement('button');
        t.className = 'tile';
        t.dataset.cell = String(idx(r, c));
        t.setAttribute('role', 'gridcell');
        t.appendChild(makeFace());
        boardEl.appendChild(t);
      }
    }
  }
}

export function tileIn(boardEl, cell) {
  return boardEl.querySelector(`.tile[data-cell="${cell}"]`);
}

/** Distance between adjacent tile centres in CSS pixels. */
export function tileStep(boardEl) {
  const a = tileIn(boardEl, 0).getBoundingClientRect();
  const b = tileIn(boardEl, 1).getBoundingClientRect();
  return b.left - a.left;
}

/**
 * Animate one action between two boards. applyFace(tileEl, value) updates a tile's face.
 * Resolves after the animation (at most ~ANIM_MS plus a little); the caller re-renders afterwards.
 */
export function animateAction(boardEl, action, before, after, applyFace) {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return Promise.resolve();
  const step = tileStep(boardEl);
  const tile = (cell) => tileIn(boardEl, cell);
  if (action.type === 'slide') {
    const cells = [];
    for (let k = 0; k < SIZE; k++) cells.push(action.axis === 'row' ? idx(action.index, k) : idx(k, action.index));
    const dx = action.axis === 'row' ? action.dir * step : 0;
    const dy = action.axis === 'col' ? action.dir * step : 0;
    const wrapIndex = action.dir === 1 ? SIZE - 1 : 0;
    cells.forEach((cell, k) => {
      const t = tile(cell);
      t.classList.add('moving');
      t.style.transform = `translate(${dx}px, ${dy}px)`;
      if (k === wrapIndex) t.style.opacity = '0';
    });
    return wait(ANIM_MS + 30);
  }
  if (action.type === 'swap') {
    const a = idx(action.r, action.c);
    const b = idx(action.r2, action.c2);
    const ta = tile(a);
    const tb = tile(b);
    const dx = (colOf(b) - colOf(a)) * step;
    const dy = (rowOf(b) - rowOf(a)) * step;
    ta.classList.add('moving', 'swap-arc');
    tb.classList.add('moving');
    ta.style.transform = `translate(${dx}px, ${dy}px)`;
    tb.style.transform = `translate(${-dx}px, ${-dy}px)`;
    return wait(ANIM_MS + 50);
  }
  if (action.type === 'nudge') {
    const cell = idx(action.r, action.c);
    const t = tile(cell);
    t.classList.add(action.delta === -1 ? 'flip-down' : 'flip');
    setTimeout(() => applyFace(t, after[cell]), ANIM_MS / 2 + 10);
    return wait(ANIM_MS + 50);
  }
  if (action.type === 'draw') {
    const cell = idx(action.r, action.c);
    const t = tile(cell);
    t.classList.add('spin');
    setTimeout(() => applyFace(t, after[cell]), 170);
    return wait(380);
  }
  return Promise.resolve();
}

/**
 * Start showing tile moves [{ from, to, wrap }] (Word mode slides around locked tiles): every tile
 * shifts one step along the line; the wrapping tile slides on out of sight while a ghost copy of it
 * slides in at the other end, like a conveyor. The board clips overflow so the edges look right.
 * Returns a function that undoes the visuals (re-rendering the board does the same).
 */
export function beginMoves(boardEl, moves) {
  const step = tileStep(boardEl);
  const ghosts = [];
  for (const m of moves) {
    const t = tileIn(boardEl, m.from);
    const dc = colOf(m.to) - colOf(m.from);
    const dr = rowOf(m.to) - rowOf(m.from);
    if (!m.wrap) {
      t.classList.add('moving');
      t.style.transform = `translate(${dc * step}px, ${dr * step}px)`;
      continue;
    }
    const sx = -Math.sign(dc); // the slide direction is opposite to the wrap jump
    const sy = -Math.sign(dr);
    t.classList.add('wrapping');
    t.style.transform = `translate(${sx * step}px, ${sy * step}px)`;
    t.style.opacity = '0';
    const dest = tileIn(boardEl, m.to);
    const ghost = t.cloneNode(true);
    ghost.classList.remove('wrapping', 'moving', 'dragging', 'selected', 'first-pick', 'drop-target', 'no-drop', 'inert');
    ghost.classList.add('ghost');
    ghost.removeAttribute('data-cell');
    ghost.removeAttribute('aria-label');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.tabIndex = -1;
    ghost.style.left = `${dest.offsetLeft}px`;
    ghost.style.top = `${dest.offsetTop}px`;
    ghost.style.width = `${dest.offsetWidth}px`;
    ghost.style.height = `${dest.offsetHeight}px`;
    ghost.style.opacity = '';
    ghost.style.transition = 'none';
    ghost.style.transform = `translate(${-sx * step}px, ${-sy * step}px)`;
    boardEl.appendChild(ghost);
    void ghost.offsetWidth; // commit the start position before animating in
    ghost.style.transition = '';
    ghost.style.transform = 'translate(0, 0)';
    ghosts.push(ghost);
  }
  return () => {
    for (const m of moves) {
      const t = tileIn(boardEl, m.from);
      t.classList.remove('moving', 'wrapping');
      t.style.transform = '';
      t.style.opacity = '';
    }
    for (const gh of ghosts) gh.remove();
  };
}

/** Animate tile moves [{ from, to, wrap }]; the caller re-renders afterwards. */
export function animateMoves(boardEl, moves) {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return Promise.resolve();
  beginMoves(boardEl, moves);
  return wait(ANIM_MS + 30);
}

/** Remove any ghost tiles left by a slide animation. */
export function removeGhosts(boardEl) {
  for (const gh of boardEl.querySelectorAll('.tile.ghost')) gh.remove();
}

/** Reset per-tile animation styles and classes (call before re-rendering faces). */
export function clearTileEffects(tileEl) {
  tileEl.style.transform = '';
  tileEl.style.opacity = '';
  tileEl.classList.remove('moving', 'wrapping', 'fade', 'bump', 'swap-arc', 'flip', 'flip-down', 'spin', 'lock-pop', 'wild-pop');
}
