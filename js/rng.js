// Seeded random numbers (mulberry32). Pure helpers so a round can be
// replayed exactly from its seed, in the browser and in Node alike.

/** Advance a mulberry32 state by one step. Returns the new state and a float in [0, 1). */
export function rngNext(state) {
  const a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: a >>> 0 };
}

/** Closure-style generator: returns a function yielding floats in [0, 1). */
export function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    const r = rngNext(state);
    state = r.state;
    return r.value;
  };
}

/** Integer in [0, n) from a generator function. */
export function randInt(rng, n) {
  return Math.floor(rng() * n);
}

/** In-place Fisher-Yates shuffle with a generator function. */
export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

/** A fresh 32-bit seed from the host's entropy (used for draw seeds in play). */
export function randomSeed() {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    return buf[0] >>> 0;
  }
  return (Math.random() * 4294967296) >>> 0;
}

/** Deterministic 32-bit hash of a string (FNV-1a), handy for named seeds. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
