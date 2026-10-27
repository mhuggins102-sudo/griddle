#!/usr/bin/env node
// Prints the Phase 1 (bank quality) and Phase 2 (bot / bid policy) reports from a bank.
//
// Usage: node tools/report.js [--bank data/puzzles.json] [--phase 1|2|all] [--games 20] [--md]

import { readFileSync, existsSync } from 'node:fs';
import { PAR_MIN, PAR_MAX } from '../js/engine.js';
import { pairKey } from './goals.js';
import { botReport, formatBotReport } from './bot.js';

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

const pct = (x) => (x * 100).toFixed(1) + '%';

export function phase1Report(bank, stats) {
  const L = [];
  const puzzles = bank.puzzles;
  L.push(`# Bank report`);
  L.push('');
  L.push(`Generated ${bank.generatedAt}; ${puzzles.length} puzzles; solver W=${bank.config.solver.width} R=${bank.config.solver.restarts} depth cap ${bank.config.solver.maxDepth}.`);
  L.push('');
  L.push('## Par histogram');
  L.push('');
  L.push('| Par | Puzzles | Share |');
  L.push('| --- | --- | --- |');
  const perPar = {};
  for (const p of puzzles) perPar[p.par] = (perPar[p.par] || 0) + 1;
  for (let par = PAR_MIN; par <= PAR_MAX; par++) L.push(`| ${par} | ${perPar[par] || 0} | ${pct((perPar[par] || 0) / puzzles.length)} |`);
  L.push('');

  L.push('## Goal pair share of the bank (top 25)');
  L.push('');
  const share = {};
  for (const p of puzzles) {
    const k = pairKey(p.goals);
    share[k] = (share[k] || 0) + 1;
  }
  const shareRows = Object.entries(share).sort((a, b) => b[1] - a[1]);
  L.push(`${shareRows.length} distinct goal pairs; largest share ${pct(shareRows[0][1] / puzzles.length)} (${shareRows[0][0]}).`);
  L.push('');
  L.push('| Goal pair | Puzzles | Share |');
  L.push('| --- | --- | --- |');
  for (const [k, n] of shareRows.slice(0, 25)) L.push(`| ${k} | ${n} | ${pct(n / puzzles.length)} |`);
  L.push('');

  L.push('## Region and condition share');
  L.push('');
  const regionShare = {};
  const condShare = {};
  for (const p of puzzles) {
    for (const g of p.goals) {
      regionShare[g.region.type] = (regionShare[g.region.type] || 0) + 1;
      condShare[g.condition.type] = (condShare[g.condition.type] || 0) + 1;
    }
  }
  const total2 = puzzles.length * 2;
  L.push('| Region | Goals | Share | | Condition | Goals | Share |');
  L.push('| --- | --- | --- | --- | --- | --- | --- |');
  const rs = Object.entries(regionShare).sort((a, b) => b[1] - a[1]);
  const cs = Object.entries(condShare).sort((a, b) => b[1] - a[1]);
  for (let i = 0; i < Math.max(rs.length, cs.length); i++) {
    const r = rs[i] ? `${rs[i][0]} | ${rs[i][1]} | ${pct(rs[i][1] / total2)}` : ' | | ';
    const c = cs[i] ? `${cs[i][0]} | ${cs[i][1]} | ${pct(cs[i][1] / total2)}` : ' | | ';
    L.push(`| ${r} | | ${c} |`);
  }
  L.push('');

  if (stats) {
    L.push('## Acceptance');
    L.push('');
    L.push(`${stats.attempts} candidates solved, ${stats.accepted} accepted (${pct(stats.accepted / stats.attempts)}), wall time ${stats.elapsedSeconds.toFixed(0)} s on ${stats.workers || 'n'} workers.`);
    L.push('');
    L.push('| Rejection reason | Count | Share of attempts |');
    L.push('| --- | --- | --- |');
    for (const [k, n] of Object.entries(stats.rejected).sort((a, b) => b[1] - a[1])) L.push(`| ${k} | ${n} | ${pct(n / stats.attempts)} |`);
    if (stats.quotaRejected) L.push(`| quota (par full) | ${stats.quotaRejected.par} | ${pct(stats.quotaRejected.par / stats.attempts)} |`);
    if (stats.quotaRejected) L.push(`| quota (pair full) | ${stats.quotaRejected.pair} | ${pct(stats.quotaRejected.pair / stats.attempts)} |`);
    L.push('');
    L.push('### Acceptance rate per goal pair (attempted at least 3 times, sorted by attempts)');
    L.push('');
    L.push('| Goal pair | Attempts | Accepted | Rate | Too easy | Too hard | Unsolved | Par mix of solved |');
    L.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    const rows = Object.entries(stats.perPair).filter(([, v]) => v.attempts >= 3).sort((a, b) => b[1].attempts - a[1].attempts);
    for (const [k, v] of rows) {
      const mix = Object.entries(v.pars).sort((a, b) => Number(a[0]) - Number(b[0])).map(([p, n]) => `${p}:${n}`).join(' ');
      L.push(`| ${k} | ${v.attempts} | ${v.accepted} | ${pct(v.accepted / v.attempts)} | ${v.tooEasy} | ${v.tooHard} | ${v.unsolved} | ${mix} |`);
    }
    L.push('');
    L.push('### Acceptance rate per region type and per condition type');
    L.push('');
    const byRegion = {};
    const byCond = {};
    for (const [k, v] of Object.entries(stats.perPair)) {
      for (const combo of k.split('+')) {
        const [region, cond] = combo.split(':');
        const r = (byRegion[region] ||= { attempts: 0, accepted: 0, tooEasy: 0, tooHard: 0, unsolved: 0 });
        const c = (byCond[cond] ||= { attempts: 0, accepted: 0, tooEasy: 0, tooHard: 0, unsolved: 0 });
        for (const o of [r, c]) {
          o.attempts += v.attempts;
          o.accepted += v.accepted;
          o.tooEasy += v.tooEasy;
          o.tooHard += v.tooHard;
          o.unsolved += v.unsolved;
        }
      }
    }
    L.push('| Region | Attempts | Accepted | Rate | Too easy | Too hard+unsolved | | Condition | Attempts | Accepted | Rate | Too easy | Too hard+unsolved |');
    L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    const rr = Object.entries(byRegion).sort((a, b) => b[1].attempts - a[1].attempts);
    const cc = Object.entries(byCond).sort((a, b) => b[1].attempts - a[1].attempts);
    const fmt = (e) => (e ? `${e[0]} | ${e[1].attempts} | ${e[1].accepted} | ${pct(e[1].accepted / e[1].attempts)} | ${e[1].tooEasy} | ${e[1].tooHard + e[1].unsolved}` : ' | | | | | ');
    for (let i = 0; i < Math.max(rr.length, cc.length); i++) L.push(`| ${fmt(rr[i])} | | ${fmt(cc[i])} |`);
    L.push('');
    L.push('## Solver time');
    L.push('');
    L.push(`Mean ${(stats.msPerAttempt / 1000).toFixed(2)} s per candidate, ${(stats.msPerAcceptedPuzzle / 1000).toFixed(2)} s per accepted puzzle (solve time only), max ${(stats.solveMs.max / 1000).toFixed(1)} s; ${stats.wallSecondsPerBankPuzzle.toFixed(2)} wall-clock s per bank puzzle including rejections, parallel over workers.`);
    L.push('');
    if (stats.calibration) {
      const c = stats.calibration;
      L.push('## Beam versus IDA* on the depth-8 calibration sample');
      L.push('');
      L.push(`${c.sample} puzzles with beam par <= 8 sampled; ${c.complete} finished within the node budget; beam par equals the IDA* optimum on ${c.agree} of ${c.complete} (${c.agreementRate === null ? 'n/a' : pct(c.agreementRate)}).`);
      if (c.overestimates.length) L.push(`Beam overestimated par on: ${c.overestimates.map((o) => `${o.id} (beam ${o.beam}, optimal ${o.ida})`).join(', ')}.`);
      const ms = c.results.filter((r) => r.complete).map((r) => r.ms);
      if (ms.length) L.push(`IDA* time: mean ${(ms.reduce((a, b) => a + b, 0) / ms.length / 1000).toFixed(1)} s, max ${(Math.max(...ms) / 1000).toFixed(1)} s.`);
      L.push('');
    }
  }

  L.push('## Confidence distribution (fraction of restarts that reached par)');
  L.push('');
  const conf = {};
  for (const p of puzzles) {
    const k = p.confidence.toFixed(2);
    conf[k] = (conf[k] || 0) + 1;
  }
  L.push('| Confidence | Puzzles | Share |');
  L.push('| --- | --- | --- |');
  for (const [k, n] of Object.entries(conf).sort((a, b) => Number(b[0]) - Number(a[0]))) L.push(`| ${k} | ${n} | ${pct(n / puzzles.length)} |`);
  const mean = puzzles.reduce((s, p) => s + p.confidence, 0) / puzzles.length;
  L.push('');
  L.push(`Mean confidence ${mean.toFixed(3)}; ${puzzles.filter((p) => p.confidence >= 0.5).length} of ${puzzles.length} at 0.5 or above.`);
  L.push('');
  const bytes = Buffer.byteLength(JSON.stringify(bank));
  L.push(`Bank file size: ${(bytes / 1024).toFixed(0)} KB.`);
  return L.join('\n');
}

export function phase2Report(bank, opts = {}) {
  const L = [];
  L.push('# Bot report');
  L.push('');
  L.push(`Greedy bot (one-ply lookahead on h, ${((opts.randomRate ?? 0.1) * 100).toFixed(0)}% random moves, 12-turn cap), ${opts.games ?? 20} plays per puzzle over ${bank.puzzles.length} puzzles.`);
  L.push('');
  const rep = botReport(bank.puzzles, opts);
  L.push('```');
  L.push(formatBotReport(rep));
  L.push('```');
  return L.join('\n');
}

const isMain = process.argv[1] && new URL(`file://${process.argv[1]}`).pathname.endsWith('report.js');
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const bankPath = args.bank || 'data/puzzles.json';
  const statsPath = bankPath.replace(/\.json$/, '-stats.json');
  const bank = JSON.parse(readFileSync(bankPath, 'utf8'));
  const stats = existsSync(statsPath) ? JSON.parse(readFileSync(statsPath, 'utf8')) : null;
  const phase = args.phase || 'all';
  if (phase === '1' || phase === 'all') console.log(phase1Report(bank, stats));
  if (phase === '2' || phase === 'all') {
    if (phase === 'all') console.log('');
    console.log(phase2Report(bank, { games: Number(args.games || 20), randomRate: Number(args.random ?? 0.1) }));
  }
}
