#!/usr/bin/env node
// Phase 2 weight tuning: re-weight (region, condition) combinations from a previous run's
// acceptance statistics so that hard combinations (par 8 to 10) are drawn more often and
// combinations that are almost always too easy are drawn less. Writes the weights into the config.
//
// Usage: node tools/tune.js [--stats data/puzzles-stats.json] [--config tools/config.json] [--min 0.3] [--max 3] [--dry]

import { readFileSync, writeFileSync } from 'node:fs';
import { defaultWeights } from './goals.js';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[a.slice(2)] = next;
        i++;
      } else out[a.slice(2)] = true;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const stats = JSON.parse(readFileSync(args.stats || 'data/puzzles-stats.json', 'utf8'));
const configPath = args.config || 'tools/config.json';
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const lo = Number(args.min ?? 0.3);
const hi = Number(args.max ?? 3);

// Attribute each pair's outcomes to both of its combinations.
const combos = {};
for (const [key, v] of Object.entries(stats.perPair)) {
  let hard = 0;
  let ok = 0;
  for (const [par, n] of Object.entries(v.pars)) {
    const p = Number(par);
    if (p >= 8 && p <= 10) hard += n;
    if (p >= 6 && p <= 10) ok += n;
  }
  for (const combo of key.split('+')) {
    const c = (combos[combo] ||= { attempts: 0, hard: 0, ok: 0 });
    c.attempts += v.attempts;
    c.hard += hard;
    c.ok += ok;
  }
}

// Hardness score with a weak prior toward the global rate, so rarely-tried combos stay near 1.
const totalAttempts = Object.values(combos).reduce((s, c) => s + c.attempts, 0);
const totalHard = Object.values(combos).reduce((s, c) => s + c.hard, 0);
const globalRate = totalHard / Math.max(1, totalAttempts);
const PRIOR = 6;
const raw = {};
for (const key of Object.keys(defaultWeights())) {
  const c = combos[key] || { attempts: 0, hard: 0, ok: 0 };
  raw[key] = (c.hard + PRIOR * globalRate) / (c.attempts + PRIOR);
}
const mean = Object.values(raw).reduce((a, b) => a + b, 0) / Object.keys(raw).length;
const weights = {};
for (const [k, v] of Object.entries(raw)) weights[k] = Number(Math.min(hi, Math.max(lo, v / mean)).toFixed(2));

const rows = Object.entries(weights).sort((a, b) => b[1] - a[1]);
console.log(`global par-8-to-10 rate ${(globalRate * 100).toFixed(1)}% over ${totalAttempts} combo-attempts`);
console.log('combo\tweight\tattempts\thard\tok');
for (const [k, w] of rows) {
  const c = combos[k] || { attempts: 0, hard: 0, ok: 0 };
  console.log(`${k}\t${w}\t${c.attempts}\t${c.hard}\t${c.ok}`);
}
if (!args.dry) {
  config.weights = weights;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`wrote weights to ${configPath}`);
}
