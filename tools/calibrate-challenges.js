#!/usr/bin/env node
// Challenge calibration: the challenge bot plays each challenge many times (the board fixed, the draws random)
// and the score distribution sets the trophy targets. Prints a table; --write stores the targets in
// js/challenge-targets.js and the distributions (every score) in data/challenge-calibration.json.
//   node tools/calibrate-challenges.js [--games 200] [--id lucky-dip,stamp] [--write] [--threads 4]
//   node tools/calibrate-challenges.js --retarget [--bronze 0.5] [--silver 0.9] [--gold 1.05] [--write]
// Targets: bronze at the bot's median, silver at its 90th percentile, gold 5% above its best run, rounded up
// to a multiple of 5 (the bot is greedy and plays everyday words only, so a planned run can beat it; a
// human misses words it never does). --retarget re-derives the targets from the stored distributions with
// other percentiles (bronze, silver) and a multiplier of the best run (gold), without playing again.
import { readFileSync, writeFileSync } from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { cpus } from 'node:os';
import { parseDictionary } from '../js/words.js';
import { CHALLENGES } from '../js/challenges.js';

const dictText = () => readFileSync(new URL('../data/words.txt', import.meta.url), 'utf8');

if (!isMainThread) {
  const { ids, games } = workerData;
  const [{ challengeState, CHALLENGE_BY_ID }, { botPlayChallenge }, { mulberry32 }] = await Promise.all([import('../js/challenges.js'), import('../js/challengebot.js'), import('../js/rng.js')]);
  const dict = parseDictionary(dictText());
  for (const id of ids) {
    const ch = CHALLENGE_BY_ID[id];
    const rng = mulberry32(12345);
    const scores = [];
    const t0 = Date.now();
    for (let k = 0; k < games; k++) {
      const drawSeed = Math.floor(rng() * 4294967296) >>> 0;
      const r = botPlayChallenge(challengeState(ch, drawSeed), dict, drawSeed ^ 0x9e3779b9);
      scores.push(r.score);
    }
    parentPort.postMessage({ id, scores, ms: Date.now() - t0 });
  }
  parentPort.postMessage({ done: true });
} else {
  const args = process.argv.slice(2);
  const opt = (name, def) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : def;
  };
  const games = Number(opt('games', 200));
  const only = opt('id', null);
  const write = args.includes('--write');
  const retarget = args.includes('--retarget');
  const P_BRONZE = Number(opt('bronze', 0.5));
  const P_SILVER = Number(opt('silver', 0.9));
  const M_GOLD = Number(opt('gold', 1.05));
  const threads = Math.max(1, Math.min(Number(opt('threads', cpus().length)), 16));
  const wanted = only ? only.split(',') : null; // --id a,b,c
  const list = CHALLENGES.filter((c) => !wanted || wanted.includes(c.id));
  const shares = Array.from({ length: Math.min(threads, list.length) }, () => []);
  list.forEach((c, i) => shares[i % shares.length].push(c.id));
  const results = new Map();
  const t0 = Date.now();
  let prev = {};
  try {
    prev = JSON.parse(readFileSync(new URL('../data/challenge-calibration.json', import.meta.url), 'utf8'));
  } catch {
    // first run
  }
  if (retarget) {
    // the stored distributions stand in for a run: every score when they were kept, else the percentiles that were
    for (const c of list) {
      const d = prev[c.id];
      if (!d) continue;
      if (d.scores) results.set(c.id, { id: c.id, scores: d.scores.slice(), ms: 0 });
      else {
        const keys = ['p50', 'p75', 'p90', 'p95', 'p99', 'max'];
        results.set(c.id, { id: c.id, scores: null, summary: d, ms: 0 });
        results.get(c.id).pctOf = (p) => (p >= 1 ? d.max : d[keys.map((k) => [k, k === 'max' ? 1 : Number(k.slice(1)) / 100]).reduce((best, [k, q]) => (Math.abs(q - p) < Math.abs(best[1] - p) ? [k, q] : best), ['p50', 0.5])[0]]);
      }
    }
  } else await Promise.all(shares.map((ids) => new Promise((resolve, reject) => {
    const wk = new Worker(new URL(import.meta.url), { workerData: { ids, games } });
    wk.on('message', (m) => {
      if (m.done) return resolve();
      results.set(m.id, m);
      process.stderr.write(`${m.id} done (${(m.ms / games).toFixed(0)} ms/game)\n`);
    });
    wk.on('error', reject);
  })));
  const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
  const up5 = (x) => Math.ceil(x / 5) * 5;
  const targets = {};
  const calibration = {};
  console.log(retarget ? `targets re-derived from the stored distributions (bronze p${Math.round(P_BRONZE * 100)}, silver p${Math.round(P_SILVER * 100)}, gold best × ${M_GOLD})\n` : `${games} games per challenge, ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
  console.log('challenge'.padEnd(17) + 'mean'.padStart(6) + 'p50'.padStart(6) + 'p75'.padStart(6) + 'p90'.padStart(6) + 'p95'.padStart(6) + 'p99'.padStart(6) + 'max'.padStart(6) + '   bronze silver gold');
  for (const c of list) {
    const r = results.get(c.id);
    if (!r) continue;
    const s = r.scores ? r.scores.slice().sort((a, b) => a - b) : null;
    const q = (p) => (s ? pct(s, p) : r.pctOf(p));
    const max = s ? s[s.length - 1] : r.summary.max;
    const mean = s ? s.reduce((a, b) => a + b, 0) / s.length : r.summary.mean;
    const bronze = up5(q(P_BRONZE));
    const silver = Math.max(bronze + 5, up5(q(P_SILVER)));
    const gold = Math.max(silver + 5, up5(max * M_GOLD));
    targets[c.id] = [bronze, silver, gold];
    calibration[c.id] = s ? { games: s.length, mean: Math.round(mean * 10) / 10, p50: pct(s, 0.5), p75: pct(s, 0.75), p90: pct(s, 0.9), p95: pct(s, 0.95), p99: pct(s, 0.99), max, min: s[0], scores: s } : r.summary;
    console.log(c.id.padEnd(17) + mean.toFixed(0).padStart(6) + String(q(0.5)).padStart(6) + String(q(0.75)).padStart(6) + String(q(0.9)).padStart(6) + String(q(0.95)).padStart(6) + String(q(0.99)).padStart(6) + String(max).padStart(6) + `   ${String(bronze).padStart(6)} ${String(silver).padStart(6)} ${String(gold).padStart(4)}`);
  }
  if (write) {
    const existing = (await import('../js/challenge-targets.js')).TARGETS;
    const merged = { ...existing, ...targets };
    const body = Object.keys(merged).map((id) => `  '${id}': [${merged[id].join(', ')}],`).join('\n');
    writeFileSync(new URL('../js/challenge-targets.js', import.meta.url), `// Trophy thresholds per challenge, as [bronze, silver, gold]. Written by tools/calibrate-challenges.js from the\n// challenge bot's score distribution (see that tool for the percentiles used); edit by hand after play-testing.\nexport const TARGETS = {\n${body}\n};\n`);
    writeFileSync(new URL('../data/challenge-calibration.json', import.meta.url), `${JSON.stringify({ ...prev, ...calibration })}\n`);
    console.log('\nwritten: js/challenge-targets.js, data/challenge-calibration.json');
  }
}
