#!/usr/bin/env node
// Challenge calibration: the challenge bot plays each challenge many times (the board fixed, the draws random)
// and the score distribution sets the trophy targets. Prints a table; --write stores the targets in
// js/challenge-targets.js and the distributions in data/challenge-calibration.json.
//   node tools/calibrate-challenges.js [--games 200] [--id lucky-dip] [--write] [--threads 4]
// Targets: bronze at the bot's 75th percentile, silver at its 95th, gold a little above its best run (the bot
// is greedy and plays everyday words only; a planned human run can beat it). Rounded up to a multiple of 5.
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
  const threads = Math.max(1, Math.min(Number(opt('threads', cpus().length)), 16));
  const list = CHALLENGES.filter((c) => !only || c.id === only);
  const shares = Array.from({ length: Math.min(threads, list.length) }, () => []);
  list.forEach((c, i) => shares[i % shares.length].push(c.id));
  const results = new Map();
  const t0 = Date.now();
  await Promise.all(shares.map((ids) => new Promise((resolve, reject) => {
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
  console.log(`${games} games per challenge, ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
  console.log('challenge'.padEnd(17) + 'mean'.padStart(6) + 'p50'.padStart(6) + 'p75'.padStart(6) + 'p90'.padStart(6) + 'p95'.padStart(6) + 'p99'.padStart(6) + 'max'.padStart(6) + '   bronze silver gold');
  for (const c of list) {
    const r = results.get(c.id);
    if (!r) continue;
    const s = r.scores.slice().sort((a, b) => a - b);
    const mean = s.reduce((a, b) => a + b, 0) / s.length;
    const bronze = up5(pct(s, 0.75));
    const silver = Math.max(bronze + 5, up5(pct(s, 0.95)));
    const gold = Math.max(silver + 5, up5(s[s.length - 1] * 1.05));
    targets[c.id] = [bronze, silver, gold];
    calibration[c.id] = { games, mean: Math.round(mean * 10) / 10, p50: pct(s, 0.5), p75: pct(s, 0.75), p90: pct(s, 0.9), p95: pct(s, 0.95), p99: pct(s, 0.99), max: s[s.length - 1], min: s[0] };
    console.log(c.id.padEnd(17) + mean.toFixed(0).padStart(6) + String(pct(s, 0.5)).padStart(6) + String(pct(s, 0.75)).padStart(6) + String(pct(s, 0.9)).padStart(6) + String(pct(s, 0.95)).padStart(6) + String(pct(s, 0.99)).padStart(6) + String(s[s.length - 1]).padStart(6) + `   ${String(bronze).padStart(6)} ${String(silver).padStart(6)} ${String(gold).padStart(4)}`);
  }
  if (write) {
    const existing = (await import('../js/challenge-targets.js')).TARGETS;
    const merged = { ...existing, ...targets };
    const body = Object.keys(merged).map((id) => `  '${id}': [${merged[id].join(', ')}],`).join('\n');
    writeFileSync(new URL('../js/challenge-targets.js', import.meta.url), `// Trophy thresholds per challenge, as [bronze, silver, gold]. Written by tools/calibrate-challenges.js from the\n// challenge bot's score distribution (see that tool for the percentiles used); edit by hand after play-testing.\nexport const TARGETS = {\n${body}\n};\n`);
    let prev = {};
    try {
      prev = JSON.parse(readFileSync(new URL('../data/challenge-calibration.json', import.meta.url), 'utf8'));
    } catch {
      // first run
    }
    writeFileSync(new URL('../data/challenge-calibration.json', import.meta.url), `${JSON.stringify({ ...prev, ...calibration }, null, 1)}\n`);
    console.log('\nwritten: js/challenge-targets.js, data/challenge-calibration.json');
  }
}
