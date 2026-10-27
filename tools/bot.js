#!/usr/bin/env node
// Greedy bot: plays draw-free with one-ply lookahead on the heuristic, a 10 percent random
// move rate, capped at 12 turns. Used to estimate a human-like turn distribution per par and
// bust rates / expected scores for bid policies of par + 0..3.
//
// Usage: node tools/bot.js [--bank data/puzzles.json] [--games 20] [--random 0.1] [--cap 12] [--lookahead 1|2] [--json]

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { roundScore, CELLS } from '../js/engine.js';
import { mulberry32 } from '../js/rng.js';
import { ACTIONS, INVERSE, applyFast, undoFast, compileGoalCost, compileGoalHolds } from './solver.js';

/**
 * Play one puzzle. Returns the number of turns used, or null when the cap is hit unsolved.
 * opts.lookahead: 1 = pick the best move by h after one move (the plan's bot);
 * 2 = pick the first move of the best two-move sequence, which escapes most one-move plateaus.
 */
export function playBot(puzzle, opts = {}) {
  const randomRate = opts.randomRate ?? 0.1;
  const cap = opts.cap ?? 12;
  const lookahead = opts.lookahead ?? 1;
  const rng = mulberry32(opts.seed ?? 1);
  const b = Uint8Array.from(puzzle.board);
  const costA = compileGoalCost(puzzle.goals[0]);
  const costB = compileGoalCost(puzzle.goals[1]);
  const holdsA = compileGoalHolds(puzzle.goals[0]);
  const holdsB = compileGoalHolds(puzzle.goals[1]);
  const n = ACTIONS.length;
  const keyOf = () => {
    const ca = costA(b);
    const cb = costB(b);
    if (ca === 0 && cb === 0 && !(holdsA(b) && holdsB(b))) return 1; // rotation-aligned but not solved
    return (ca > cb ? ca : cb) * 64 + ca + cb;
  };
  let last = -1;
  for (let turn = 1; turn <= cap; turn++) {
    let choice = -1;
    if (rng() < randomRate) {
      do choice = Math.floor(rng() * n);
      while (choice === (last >= 0 ? INVERSE[last] : -1));
    } else {
      let best = Infinity;
      let ties = 0;
      for (let a = 0; a < n; a++) {
        if (last >= 0 && a === INVERSE[last]) continue;
        applyFast(b, a);
        let key = keyOf();
        if (key === 0) key = -1; // solving now beats everything
        else if (lookahead >= 2) {
          // value of the best two-move sequence starting with a; a solve in two scores just above a solve now
          let sub = key;
          for (let c = 0; c < n; c++) {
            if (c === INVERSE[a]) continue;
            applyFast(b, c);
            const k2 = keyOf();
            if (k2 < sub) sub = k2;
            undoFast(b, c);
          }
          key = sub === 0 ? 0.5 : sub * 2 + 1;
        }
        if (key < best) {
          best = key;
          choice = a;
          ties = 1;
        } else if (key === best) {
          ties++;
          if (rng() * ties < 1) choice = a;
        }
        undoFast(b, a);
      }
    }
    applyFast(b, choice);
    last = choice;
    if (holdsA(b) && holdsB(b)) return turn;
  }
  return null;
}

/** Run the bot over a bank. Returns per-par turn distributions and bid-policy outcomes. */
export function botReport(puzzles, opts = {}) {
  const games = opts.games ?? 20;
  const policies = opts.policies ?? [0, 1, 2, 3];
  const perPar = {};
  for (const p of puzzles) {
    const row = (perPar[p.par] ||= { puzzles: 0, plays: 0, turns: {}, busts: 0, beatPar: 0, policies: {} });
    row.puzzles++;
    for (let g = 0; g < games; g++) {
      const t = playBot(p, { ...opts, seed: (p.seed * 31 + g) >>> 0 });
      row.plays++;
      if (t === null) row.busts++;
      else {
        row.turns[t] = (row.turns[t] || 0) + 1;
        if (t < p.par) row.beatPar++;
      }
      for (const k of policies) {
        const bid = Math.min(12, p.par + k);
        const pol = (row.policies[`par+${k}`] ||= { bid: 0, plays: 0, busts: 0, score: 0 });
        pol.plays++;
        const score = t === null ? 0 : roundScore(bid, p.par, t);
        if (score === 0) pol.busts++;
        pol.score += score;
      }
    }
  }
  for (const row of Object.values(perPar)) {
    for (const pol of Object.values(row.policies)) {
      pol.bustRate = pol.busts / pol.plays;
      pol.expectedScore = pol.score / pol.plays;
      delete pol.bid;
    }
    row.bustRate = row.busts / row.plays;
    const solved = row.plays - row.busts;
    let sum = 0;
    for (const [t, c] of Object.entries(row.turns)) sum += Number(t) * c;
    row.meanTurnsWhenSolved = solved ? sum / solved : null;
  }
  return perPar;
}

export function formatBotReport(perPar) {
  const lines = [];
  const pars = Object.keys(perPar).map(Number).sort((a, b) => a - b);
  lines.push('Bot turn distribution per par (share of plays; "bust" = unsolved at the 12-turn cap)');
  const cols = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  lines.push(['par', 'n', ...cols.map((c) => `T${c}`), 'bust', 'mean'].join('\t'));
  for (const par of pars) {
    const row = perPar[par];
    const pct = (c) => (((row.turns[c] || 0) / row.plays) * 100).toFixed(0);
    lines.push([par, row.plays, ...cols.map(pct), (row.bustRate * 100).toFixed(0), row.meanTurnsWhenSolved ? row.meanTurnsWhenSolved.toFixed(2) : '-'].join('\t'));
  }
  lines.push('');
  lines.push('Bid policies: bust rate and expected round score');
  const polNames = Object.keys(perPar[pars[0]].policies);
  lines.push(['par', ...polNames.flatMap((p) => [`${p} bust%`, `${p} E[score]`])].join('\t'));
  for (const par of pars) {
    const row = perPar[par];
    lines.push([par, ...polNames.flatMap((p) => [(row.policies[p].bustRate * 100).toFixed(0), row.policies[p].expectedScore.toFixed(1)])].join('\t'));
  }
  const all = { plays: 0, policies: {} };
  for (const par of pars) {
    all.plays += perPar[par].plays;
    for (const p of polNames) {
      const a = (all.policies[p] ||= { busts: 0, score: 0 });
      a.busts += perPar[par].policies[p].busts;
      a.score += perPar[par].policies[p].score;
    }
  }
  lines.push(['all', ...polNames.flatMap((p) => [((all.policies[p].busts / all.plays) * 100).toFixed(0), (all.policies[p].score / all.plays).toFixed(1)])].join('\t'));
  return lines.join('\n');
}

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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const bank = JSON.parse(readFileSync(args.bank || 'data/puzzles.json', 'utf8'));
  const report = botReport(bank.puzzles, { games: Number(args.games || 20), randomRate: Number(args.random ?? 0.1), cap: Number(args.cap || 12), lookahead: Number(args.lookahead || 1) });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(formatBotReport(report));
}
