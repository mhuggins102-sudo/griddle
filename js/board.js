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

/** Build the 7x7 grid into boardEl. makeFace() returns the element placed inside each tile. */
export function buildBoardSkeleton(boardEl, makeFace) {
  boardEl.innerHTML = '';
  for (let r = -1; r <= SIZE; r++) {
    for (let c = -1; c <= SIZE; c++) {
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

/** Animate arbitrary tile moves [{ from, to, wrap }] (used by Word mode slides around locked tiles). */
export function animateMoves(boardEl, moves) {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return Promise.resolve();
  const step = tileStep(boardEl);
  for (const m of moves) {
    const t = tileIn(boardEl, m.from);
    const dx = (colOf(m.to) - colOf(m.from)) * step;
    const dy = (rowOf(m.to) - rowOf(m.from)) * step;
    t.classList.add('moving');
    t.style.transform = `translate(${dx}px, ${dy}px)`;
    if (m.wrap) t.style.opacity = '0';
  }
  return wait(ANIM_MS + 30);
}

/** Reset per-tile animation styles and classes (call before re-rendering faces). */
export function clearTileEffects(tileEl) {
  tileEl.style.transform = '';
  tileEl.style.opacity = '';
  tileEl.classList.remove('moving', 'fade', 'bump', 'swap-arc', 'flip', 'flip-down', 'spin', 'lock-pop', 'wild-pop');
}
