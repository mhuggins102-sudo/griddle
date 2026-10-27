#!/usr/bin/env node
// Puzzle bank generator: deal, pair goals, beam-solve, validate, write data/puzzles.json.
// Parallel over worker_threads. Standard library only.
//
// Usage: node tools/generate.js [--count 200] [--out data/puzzles.json] [--config tools/config.json]
//        [--workers N] [--seed-start 1] [--calibrate 30] [--per-par N] [--max-pair-share 0.1] [--max-attempts N]

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deal, evalGoal, replaySolution } from '../js/engine.js';
import { mulberry32 } from '../js/rng.js';
import { samplePair, pairKey } from './goals.js';
import { beamSolve, idaSolve } from './solver.js';

// ---------------------------------------------------------------------------
// Shared: build one candidate from a seed and solve it

export function buildCandidate(seed, config) {
  const { board, bag } = deal(seed);
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const pairing = { ...config.pairing, sumRanges: config.sumRanges };
  // Resample the pair until neither goal holds at deal (cheap); give up after a few.
  let goals = null;
  let pairTries = 0;
  for (let k = 0; k < 20 && !goals; k++) {
    const p = samplePair(rng, config.weights, pairing);
    if (!p) break;
    pairTries += p.attempts;
    if (p.goals.some((g) => evalGoal(board, g))) continue;
    goals = p.goals;
  }
  if (!goals) return { seed, accepted: false, reason: 'no-pair', ms: 0 };
  const key = pairKey(goals);
  const t0 = Date.now();
  const res = beamSolve(board, goals, { ...config.solver, seed });
  const ms = Date.now() - t0;
  if (res.par === null) return { seed, accepted: false, reason: 'unsolved', pairKey: key, goals, ms, nodes: res.nodes };
  if (res.par < config.solver.parMin) return { seed, accepted: false, reason: 'too-easy', pairKey: key, goals, par: res.par, ms, nodes: res.nodes };
  if (res.par > config.solver.parMax) return { seed, accepted: false, reason: 'too-hard', pairKey: key, goals, par: res.par, ms, nodes: res.nodes };
  const puzzle = { id: null, seed, board, bag, goals, par: res.par, solution: res.solution, confidence: Number(res.confidence.toFixed(3)) };
  const check = replaySolution(puzzle);
  if (!check.ok) return { seed, accepted: false, reason: `replay-failed: ${check.reason}`, pairKey: key, goals, par: res.par, ms };
  return { seed, accepted: true, pairKey: key, puzzle, ms, nodes: res.nodes, restarts: res.restarts };
}

// ---------------------------------------------------------------------------
// Worker

if (!isMainThread) {
  const config = workerData.config;
  parentPort.on('message', (msg) => {
    if (msg.type === 'solve') {
      for (const seed of msg.seeds) parentPort.postMessage({ type: 'result', ...buildCandidate(seed, config) });
      parentPort.postMessage({ type: 'done' });
    } else if (msg.type === 'calibrate') {
      const p = msg.puzzle;
      const r = idaSolve(p.board, p.goals, { maxDepth: msg.maxDepth, nodeBudget: msg.nodeBudget });
      parentPort.postMessage({ type: 'calibrated', id: p.id, beamPar: p.par, ida: r.length, nodes: r.nodes, complete: r.complete, ms: r.ms });
    } else if (msg.type === 'exit') {
      process.exit(0);
    }
  });
}

// ---------------------------------------------------------------------------
// Main

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else out[key] = true;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = args.config || 'tools/config.json';
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const target = Number(args.count || config.bank.target || 200);
  const outPath = args.out || 'data/puzzles.json';
  const statsPath = outPath.replace(/\.json$/, '-stats.json');
  const nWorkers = Number(args.workers || cpus().length);
  const seedStart = Number(args['seed-start'] || 1);
  const calibrateN = Number(args.calibrate ?? 30);
  const perPar = Number(args['per-par'] ?? config.bank.minPerPar ?? 0);
  const maxPairShare = Number(args['max-pair-share'] ?? config.bank.maxPairShare ?? 0.1);
  const maxAttempts = Number(args['max-attempts'] || 0);
  const parMin = config.solver.parMin;
  const parMax = config.solver.parMax;
  const perParCap = perPar > 0 ? Math.max(perPar, Math.ceil(target / (parMax - parMin + 1))) : Infinity;
  const pairCap = Math.max(1, Math.floor(target * maxPairShare));

  const stats = {
    attempts: 0,
    accepted: 0,
    rejected: {},
    perPair: {},
    perPar: {},
    solveMs: { total: 0, accepted: 0, max: 0 },
    nodes: 0,
    confidence: {},
    quotaRejected: { par: 0, pair: 0 },
    workers: nWorkers,
    startedAt: new Date().toISOString(),
  };
  const puzzles = [];
  const tally = (obj, k) => (obj[k] = (obj[k] || 0) + 1);

  const startTime = Date.now();
  console.error(`generate: target ${target}, workers ${nWorkers}, W=${config.solver.width} R=${config.solver.restarts}, per-par cap ${perParCap}, pair cap ${pairCap}`);

  const workers = [];
  for (let i = 0; i < nWorkers; i++) workers.push(new Worker(new URL(import.meta.url), { workerData: { config } }));
  let nextSeed = seedStart;
  const BATCH = 4;
  let stop = false;

  const done = () => puzzles.length >= target || (maxAttempts > 0 && stats.attempts >= maxAttempts);

  await new Promise((resolve) => {
    let idle = 0;
    const feed = (w) => {
      if (stop || done()) {
        idle++;
        if (idle === workers.length) resolve();
        return;
      }
      const seeds = [];
      for (let k = 0; k < BATCH; k++) seeds.push(nextSeed++);
      w.postMessage({ type: 'solve', seeds });
    };
    for (const w of workers) {
      w.on('message', (msg) => {
        if (msg.type === 'done') return feed(w);
        if (msg.type !== 'result') return;
        stats.attempts++;
        stats.solveMs.total += msg.ms;
        stats.nodes += msg.nodes || 0;
        if (msg.ms > stats.solveMs.max) stats.solveMs.max = msg.ms;
        if (msg.pairKey) {
          const pp = (stats.perPair[msg.pairKey] ||= { attempts: 0, accepted: 0, tooEasy: 0, tooHard: 0, unsolved: 0, pars: {} });
          pp.attempts++;
          if (msg.reason === 'too-easy') pp.tooEasy++;
          else if (msg.reason === 'too-hard') pp.tooHard++;
          else if (msg.reason === 'unsolved') pp.unsolved++;
          if (msg.par !== undefined || msg.puzzle) tally(pp.pars, msg.par ?? msg.puzzle.par);
        }
        if (!msg.accepted) {
          tally(stats.rejected, msg.reason.split(':')[0]);
          return;
        }
        const p = msg.puzzle;
        if (done()) return;
        if ((stats.perPar[p.par] || 0) >= perParCap) {
          stats.quotaRejected.par++;
          return;
        }
        const pairCount = puzzles.filter((q) => pairKey(q.goals) === msg.pairKey).length;
        if (pairCount >= pairCap) {
          stats.quotaRejected.pair++;
          return;
        }
        p.id = String(puzzles.length + 1).padStart(4, '0');
        puzzles.push(p);
        stats.accepted++;
        stats.solveMs.accepted += msg.ms;
        stats.perPair[msg.pairKey].accepted++;
        tally(stats.perPar, p.par);
        tally(stats.confidence, p.confidence.toFixed(2));
        if (puzzles.length % 10 === 0 || puzzles.length === target) {
          const el = (Date.now() - startTime) / 1000;
          console.error(`  ${puzzles.length}/${target} accepted of ${stats.attempts} attempts, ${el.toFixed(0)}s, pars ${JSON.stringify(stats.perPar)}`);
        }
      });
      w.on('error', (e) => {
        console.error('worker error', e);
        stop = true;
      });
      feed(w);
    }
  });

  stats.finishedAt = new Date().toISOString();
  stats.elapsedSeconds = (Date.now() - startTime) / 1000;
  stats.msPerAttempt = stats.attempts ? stats.solveMs.total / stats.attempts : 0;
  stats.msPerAcceptedPuzzle = stats.accepted ? stats.solveMs.accepted / stats.accepted : 0;
  stats.wallSecondsPerBankPuzzle = puzzles.length ? stats.elapsedSeconds / puzzles.length : 0;

  // Calibration: IDA* on a sample of accepted puzzles with par <= 8.
  if (calibrateN > 0 && puzzles.length) {
    const sample = puzzles.filter((p) => p.par <= 8).slice(0, calibrateN);
    console.error(`calibrate: IDA* on ${sample.length} puzzles with par <= 8`);
    const results = [];
    await new Promise((resolve) => {
      let next = 0;
      let outstanding = 0;
      const feed = (w) => {
        if (next >= sample.length) {
          if (outstanding === 0) resolve();
          return;
        }
        outstanding++;
        w.postMessage({ type: 'calibrate', puzzle: sample[next++], maxDepth: 8, nodeBudget: Number(args['ida-budget'] || 20_000_000) });
      };
      for (const w of workers) {
        w.removeAllListeners('message');
        w.on('message', (msg) => {
          if (msg.type !== 'calibrated') return;
          outstanding--;
          results.push(msg);
          console.error(`  ${msg.id}: beam ${msg.beamPar} ida ${msg.ida} (${msg.complete ? 'complete' : 'budget exhausted'}, ${(msg.nodes / 1e6).toFixed(1)}M nodes, ${(msg.ms / 1000).toFixed(1)}s)`);
          feed(w);
        });
        feed(w);
      }
      if (sample.length === 0) resolve();
    });
    const complete = results.filter((r) => r.complete);
    const agree = complete.filter((r) => r.ida === r.beamPar).length;
    stats.calibration = {
      sample: results.length,
      complete: complete.length,
      agree,
      agreementRate: complete.length ? agree / complete.length : null,
      overestimates: complete.filter((r) => r.ida !== null && r.ida < r.beamPar).map((r) => ({ id: r.id, beam: r.beamPar, ida: r.ida })),
      results: results.map((r) => ({ id: r.id, beam: r.beamPar, ida: r.ida, complete: r.complete, nodes: r.nodes, ms: r.ms })),
    };
  }

  for (const w of workers) w.postMessage({ type: 'exit' });

  const bank = {
    version: 1,
    generatedAt: new Date().toISOString(),
    config: { solver: config.solver, pairing: config.pairing, sumRanges: config.sumRanges, weights: config.weights, seedStart, count: puzzles.length },
    puzzles,
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(bank));
  writeFileSync(statsPath, JSON.stringify(stats, null, 2));
  const bytes = Buffer.byteLength(JSON.stringify(bank));
  console.error(`wrote ${puzzles.length} puzzles to ${outPath} (${(bytes / 1024).toFixed(0)} KB) and stats to ${statsPath}`);
}

if (isMainThread && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
