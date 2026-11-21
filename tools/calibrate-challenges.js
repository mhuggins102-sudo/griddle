#!/usr/bin/env node
// Challenge calibration: the challenge bot plays each challenge many times (a fresh board and fresh draws each time)
// and the score distribution sets the trophy targets. Prints a table; --write stores the targets in
// js/challenge-targets.js and the distributions (every score) in data/challenge-calibration.json.
//   node tools/calibrate-challenges.js [--games 200] [--vocab 8000] [--id lucky-dip,stamp] [--write] [--threads 4]
//   node tools/calibrate-challenges.js --retarget [--bronze 0.3] [--silver 0.6] [--gold 0.9] [--write]
// Targets: bronze at the bot's 30th percentile, silver at its 60th, gold at its 90th, rounded up to a
// multiple of 5 (a greedy bot that never misses a word outscores most people). --vocab caps the bot's vocabulary at the N most common words (a player may lock any listed
// word; the bot with the whole common tier knows some 20,000, far more than a person sees). --retarget
// re-derives the targets from the stored distributions with other percentiles, without playing again.
// The table also shows how far each twist moved the bot's play: its draws per game, the share of games that
// scored exactly as a plain board on the same seeds would (perk twists only: the boards are the same), and
// the mean against plain play. A twist the bot never uses is one to adjust by hand.
import { readFileSync, writeFileSync } from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { cpus } from 'node:os';
import { parseDictionary } from '../js/words.js';
import { CHALLENGES } from '../js/challenges.js';

const dictText = () => readFileSync(new URL('../data/words.txt', import.meta.url), 'utf8');

if (!isMainThread) {
  const { ids, games, vocab } = workerData;
  const [{ challengeState, CHALLENGE_BY_ID }, { botPlayChallenge }, { mulberry32 }] = await Promise.all([import('../js/challenges.js'), import('../js/challengebot.js'), import('../js/rng.js')]);
  const dict = parseDictionary(dictText());
  if (vocab) dict.common = Math.min(dict.common, vocab); // the bot plays only the N most common words
  const playAll = (ch) => {
    const rng = mulberry32(12345); // the same seeds for every challenge, so plain play on the same boards compares
    const scores = [];
    let draws = 0;
    for (let k = 0; k < games; k++) {
      const seed = Math.floor(rng() * 4294967296) >>> 0;
      const drawSeed = Math.floor(rng() * 4294967296) >>> 0;
      const r = botPlayChallenge(challengeState(ch, seed, drawSeed), dict, drawSeed ^ 0x9e3779b9);
      scores.push(r.score);
      draws += r.log.filter((l) => l.startsWith('draw')).length;
    }
    return { scores, draws: draws / games };
  };
  const plain = playAll({ id: 'plain', size: 5 }).scores; // no twist at all
  for (const id of ids) {
    const ch = CHALLENGE_BY_ID[id];
    const t0 = Date.now();
    const { scores, draws } = playAll(ch);
    const sameBoards = !ch.deal; // a deal rule changes the letters; a perk or a rule leaves the plain board in place
    const same = sameBoards ? scores.filter((s, k) => s === plain[k]).length / games : null;
    const plainMean = plain.reduce((a, b) => a + b, 0) / plain.length;
    parentPort.postMessage({ id, scores, draws, same, plainMean, ms: Date.now() - t0 });
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
  const P_BRONZE = Number(opt('bronze', 0.3));
  const P_SILVER = Number(opt('silver', 0.6));
  const P_GOLD = Number(opt('gold', 0.9));
  const vocab = Number(opt('vocab', 0)) || 0;
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
      if (d.scores) results.set(c.id, { id: c.id, scores: d.scores.slice(), draws: d.draws, same: d.same, plainMean: d.vsPlain === null || d.vsPlain === undefined ? undefined : d.mean - d.vsPlain, ms: 0 }); // the twist's effect is kept as recorded
      else {
        const keys = ['p50', 'p75', 'p90', 'p95', 'p99', 'max'];
        results.set(c.id, { id: c.id, scores: null, summary: d, ms: 0 });
        results.get(c.id).pctOf = (p) => (p >= 1 ? d.max : d[keys.map((k) => [k, k === 'max' ? 1 : Number(k.slice(1)) / 100]).reduce((best, [k, q]) => (Math.abs(q - p) < Math.abs(best[1] - p) ? [k, q] : best), ['p50', 0.5])[0]]);
      }
    }
  } else await Promise.all(shares.map((ids) => new Promise((resolve, reject) => {
    const wk = new Worker(new URL(import.meta.url), { workerData: { ids, games, vocab } });
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
  const pctLabel = `bronze p${Math.round(P_BRONZE * 100)}, silver p${Math.round(P_SILVER * 100)}, gold p${Math.round(P_GOLD * 100)}`;
  console.log(retarget ? `targets re-derived from the stored distributions (${pctLabel})\n` : `${games} games per challenge${vocab ? `, the bot's vocabulary capped at ${vocab} words` : ''}, ${((Date.now() - t0) / 1000).toFixed(0)} s (${pctLabel})\n`);
  console.log('challenge'.padEnd(17) + 'mean'.padStart(6) + 'p50'.padStart(6) + 'p75'.padStart(6) + 'p90'.padStart(6) + 'p95'.padStart(6) + 'p99'.padStart(6) + 'max'.padStart(6) + '   bronze silver gold' + '   draws' + '  same%' + '  vs plain');
  for (const c of list) {
    const r = results.get(c.id);
    if (!r) continue;
    const s = r.scores ? r.scores.slice().sort((a, b) => a - b) : null;
    const q = (p) => (s ? pct(s, p) : r.pctOf(p));
    const max = s ? s[s.length - 1] : r.summary.max;
    const mean = s ? s.reduce((a, b) => a + b, 0) / s.length : r.summary.mean;
    const bronze = up5(q(P_BRONZE));
    const silver = Math.max(bronze + 5, up5(q(P_SILVER)));
    const gold = Math.max(silver + 5, up5(q(P_GOLD)));
    targets[c.id] = [bronze, silver, gold];
    const twist = { draws: r.draws === undefined ? null : Math.round(r.draws * 100) / 100, same: r.same === undefined || r.same === null ? null : Math.round(r.same * 100) / 100, vsPlain: r.plainMean === undefined ? null : Math.round((mean - r.plainMean) * 10) / 10 };
    calibration[c.id] = s ? { games: s.length, vocab: vocab || null, mean: Math.round(mean * 10) / 10, p50: pct(s, 0.5), p75: pct(s, 0.75), p90: pct(s, 0.9), p95: pct(s, 0.95), p99: pct(s, 0.99), max, min: s[0], ...twist, scores: s } : r.summary;
    const fmt = (v, w, suffix = '') => (v === null || v === undefined ? '–'.padStart(w) : `${v}${suffix}`.padStart(w));
    console.log(c.id.padEnd(17) + mean.toFixed(0).padStart(6) + String(q(0.5)).padStart(6) + String(q(0.75)).padStart(6) + String(q(0.9)).padStart(6) + String(q(0.95)).padStart(6) + String(q(0.99)).padStart(6) + String(max).padStart(6) + `   ${String(bronze).padStart(6)} ${String(silver).padStart(6)} ${String(gold).padStart(4)}` + fmt(twist.draws, 8) + fmt(twist.same === null ? null : Math.round(twist.same * 100), 7, '%') + fmt(twist.vsPlain === null ? null : (twist.vsPlain > 0 ? '+' : '') + twist.vsPlain, 10));
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
