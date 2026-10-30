// Board geometry for any square size: cell indexing, rows and columns, the deterministic move
// list and the lines a word can lie on. Pure and cached per size; Word mode uses this instead of
// the fixed 5x5 constants in engine.js (which the number game still relies on).

export const MIN_WORD = 3;

const cache = new Map();

/** Geometry for an n-by-n board. */
export function gridOf(size) {
  if (cache.has(size)) return cache.get(size);
  const cells = size * size;
  const idx = (r, c) => r * size + c;
  const rowOf = (i) => Math.floor(i / size);
  const colOf = (i) => i % size;
  const inRange = (n) => Number.isInteger(n) && n >= 0 && n < size;
  const lineCells = (axis, index) => {
    const out = new Array(size);
    for (let k = 0; k < size; k++) out[k] = axis === 'row' ? idx(index, k) : idx(k, index);
    return out;
  };
  const neighbours = (cell) => {
    const r = rowOf(cell);
    const c = colOf(cell);
    const out = [];
    if (r > 0) out.push(idx(r - 1, c));
    if (r < size - 1) out.push(idx(r + 1, c));
    if (c > 0) out.push(idx(r, c - 1));
    if (c < size - 1) out.push(idx(r, c + 1));
    return out;
  };
  // The deterministic moves in a fixed order: slides, swaps, nudges (the same order as
  // engine.allActions on 5x5, so the bot's tie-breaks are unchanged there).
  const moves = [];
  for (const axis of ['row', 'col']) {
    for (let i = 0; i < size; i++) for (const dir of [-1, 1]) moves.push({ type: 'slide', axis, index: i, dir });
  }
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (c + 1 < size) moves.push({ type: 'swap', r, c, r2: r, c2: c + 1 });
      if (r + 1 < size) moves.push({ type: 'swap', r, c, r2: r + 1, c2: c });
    }
  }
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) for (const delta of [1, -1]) moves.push({ type: 'nudge', r, c, delta });
  }
  // Every line a word can lie on, in reading order: rows, columns, then all diagonals of 3 or more cells.
  const lines = [];
  for (let i = 0; i < size; i++) lines.push(lineCells('row', i));
  for (let i = 0; i < size; i++) lines.push(lineCells('col', i));
  for (let start = -(size - MIN_WORD); start <= size - MIN_WORD; start++) {
    const line = [];
    for (let r = 0; r < size; r++) {
      const c = r + start;
      if (c >= 0 && c < size) line.push(idx(r, c));
    }
    lines.push(line);
  }
  for (let start = MIN_WORD - 1; start <= 2 * size - 1 - MIN_WORD; start++) {
    const line = [];
    for (let r = 0; r < size; r++) {
      const c = start - r;
      if (c >= 0 && c < size) line.push(idx(r, c));
    }
    lines.push(line);
  }
  const g = { size, cells, idx, rowOf, colOf, inRange, lineCells, neighbours, moves, lines };
  cache.set(size, g);
  return g;
}

/** The size of a board array (25 cells is 5, 36 is 6). */
export function sizeOfBoard(board) {
  return Math.round(Math.sqrt(board.length));
}

/** Geometry for a play state (older saves carry no size; it is read off the board). */
export function gridOfState(state) {
  return gridOf(state.size || sizeOfBoard(state.board));
}
