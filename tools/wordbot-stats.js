#!/usr/bin/env node
// Word-mode bot statistics: plays N boards with the goal-setting bot and prints the score
// distribution, locked-tile histogram, bonus share and the goal per level.
//   node tools/wordbot-stats.js [--seeds 200] [--from 1] [--size 5|6]
import { readFileSync } from 'node:fs';
import { parseDictionary, dealLetters, TURNS_BY_SIZE } from '../js/words.js';
import { botPlay, goalFor } from '../js/wordbot.js';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const count = opt('seeds', 200);
const from = opt('from', 1);
const size = opt('size', 5);
const CELLS = size * size;
const WORD_TURNS = TURNS_BY_SIZE[size];
const dict = parseDictionary(readFileSync(new URL('../data/words.txt', import.meta.url), 'utf8'));

const rows = [];
const t0 = Date.now();
for (let seed = from; seed < from + count; seed++) {
  const { board, bag } = dealLetters(seed, size);
  const r = botPlay(board, bag, dict);
  rows.push({ seed, score: r.score, banked: r.banked, locked: r.locked, turns: r.turnsUsed, words: r.words.length, lengths: r.words.map((w) => w.word.length) });
}
const ms = Date.now() - t0;

const sorted = (k) => rows.map((r) => r[k]).sort((a, b) => a - b);
const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
const line = (label, arr) => console.log(`${label.padEnd(14)} mean ${mean(arr).toFixed(1).padStart(6)}  p10 ${String(pct(arr, 0.1)).padStart(4)}  median ${String(pct(arr, 0.5)).padStart(4)}  p90 ${String(pct(arr, 0.9)).padStart(4)}  min ${String(arr[0]).padStart(4)}  max ${String(arr[arr.length - 1]).padStart(4)}`);

console.log(`${size}x${size}, ${WORD_TURNS} turns: ${count} boards (seeds ${from}..${from + count - 1}), ${(ms / count).toFixed(0)} ms per board\n`);
line('final score', sorted('score'));
line('banked words', sorted('banked'));
line('turns used', sorted('turns'));
line('words locked', sorted('words'));
const bonus = rows.map((r) => r.score - r.banked);
console.log(`bonus share    ${(100 * bonus.reduce((a, b) => a + b, 0) / rows.reduce((a, r) => a + r.score, 0)).toFixed(1)}% of the final score (coverage + unused turns)`);
const hist = {};
for (const r of rows) hist[r.locked] = (hist[r.locked] || 0) + 1;
console.log('locked tiles   ' + Object.keys(hist).sort((a, b) => b - a).map((k) => `${k}: ${(100 * hist[k] / rows.length).toFixed(1)}%`).join('  '));
console.log(`full boards    ${(100 * rows.filter((r) => r.locked === CELLS).length / rows.length).toFixed(1)}%; boards using all ${WORD_TURNS} turns ${(100 * rows.filter((r) => r.turns >= WORD_TURNS).length / rows.length).toFixed(1)}%\n`);
const mix = {};
for (const r of rows) for (const n of r.lengths) mix[n] = (mix[n] || 0) + 1;
const totalWords = rows.reduce((a, r) => a + r.lengths.length, 0);
console.log('word lengths   ' + Object.keys(mix).sort().map((n) => `${n}-letter ${(100 * mix[n] / totalWords).toFixed(0)}% (${(mix[n] / rows.length).toFixed(1)} per board)`).join('  '));
console.log('goal by level  ' + [1, 3, 5, 8, 10, 12, 14].map((L) => `L${L} ${mean(rows.map((r) => goalFor(L, r.banked))).toFixed(0)}`).join('  ') + '   (from banked word points, as the game does)');
