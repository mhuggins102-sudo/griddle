// The daily grid: one board a day, the same for everyone, 5x5 or 6x6 as the day decides. The day is the
// player's local calendar date (like most daily puzzles), written YYYY-MM-DD; everything about the board is
// hashed from that key, so no server is needed to agree on it. Pure helpers, used by the game, the home
// screen and the leaderboard.

import { hashString } from './rng.js';

/** The key of a calendar day, local time: YYYY-MM-DD. */
export function dailyKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The key some days before or after another (negative for earlier); safe across month ends and clock changes. */
export function shiftDay(key, days) {
  const [y, m, d] = String(key).split('-').map(Number);
  return dailyKey(new Date(y, m - 1, d + days, 12)); // noon, so a daylight-saving jump cannot move the date
}

/** A day's grid: its size (an even chance of 5 or 6), the seed its letters are dealt from and the seed its draws follow. */
export function dailySpec(key) {
  const size = (hashString(`gridlock-daily-size:${key}`) >>> 8) & 1 ? 6 : 5;
  return { key, size, seed: hashString(`gridlock-daily-board:${key}`), drawSeed: hashString(`gridlock-daily-draws:${key}`) };
}

/** True for a well-formed key. */
export function isDailyKey(key) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(key));
}
