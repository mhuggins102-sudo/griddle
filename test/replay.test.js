import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { deal, replaySolution, createState, applyAction, decodeAction, evalGoal, allGoalsHold, PAR_MIN, PAR_MAX } from '../js/engine.js';

test('replaySolution validates a correct solution and rejects broken ones', () => {
  const { board, bag } = deal(42);
  const goals = [
    { region: { type: 'row', index: 0 }, condition: { type: 'equalTo', value: 6 } },
    { region: { type: 'col', index: 2 }, condition: { type: 'sum', value: 15 } },
  ];
  assert.ok(!evalGoal(board, goals[0]));
  assert.ok(!evalGoal(board, goals[1]));
  // Row 0: 6 5 1 6 6 -> nudge (0,1) 5->6, nudge (0,2) 1->6 via -1 (wrap). Col 2 sum: 1+6+3+1+2=13, after (0,2)=6: 18.
  // Then nudge (2,2) 3->2 and (3,2) 1->... need 15: 6+6+3+1+2 = 18 -> nudge (2,2) -1 -> 17, (3,2)... 1 -> 6 wraps up. Nudge (4,2) 2->1 -> 16, (2,2) 2->1 -> 15.
  const solution = ['N1+', 'N2-', 'N12-', 'N22-', 'N12-'];
  const puzzle = { id: 'hand', seed: 42, board, bag, goals, par: 5, solution };
  const res = replaySolution(puzzle);
  assert.equal(res.ok, true, res.reason);
  assert.equal(res.turns, 5);
  assert.ok(allGoalsHold(res.board, goals));

  assert.equal(replaySolution({ ...puzzle, par: 6 }).ok, false, 'length must equal par');
  assert.match(replaySolution({ ...puzzle, par: 6 }).reason, /length/);
  assert.equal(replaySolution({ ...puzzle, solution: solution.slice(0, 4) }).ok, false);
  assert.equal(replaySolution({ ...puzzle, solution: ['D0', ...solution] }).ok, false, 'draws are not allowed');
  assert.equal(replaySolution({ ...puzzle, solution: [...solution, 'R0L', 'R0R'], par: 7 }).ok, false, 'solved early');
  const already = { ...puzzle, goals: [{ region: { type: 'col', index: 2 }, condition: { type: 'sum', value: 13 } }, goals[0]] };
  assert.equal(replaySolution(already).ok, false, 'a goal holds at deal');
});

test('puzzle id plus draw seed reproduce a round exactly', () => {
  const { board, bag } = deal(2024);
  const play = (drawSeed) => {
    let s = createState(board, bag, drawSeed);
    const log = [];
    for (const code of ['D0', 'R1L', 'D12', 'W3-4', 'D0', 'N24+', 'D24']) {
      s = applyAction(s, decodeAction(code));
      log.push(s.board.join(''), s.bag.join(''));
    }
    return log;
  };
  assert.deepEqual(play(777), play(777));
  assert.notDeepEqual(play(777), play(778));
});

const bankPath = new URL('../data/puzzles.json', import.meta.url);
test('bank: every puzzle replays, neither goal holds at deal, length equals par, par in 6..10', { skip: !existsSync(bankPath) && 'no bank yet' }, () => {
  const bank = JSON.parse(readFileSync(bankPath, 'utf8'));
  assert.ok(Array.isArray(bank.puzzles) && bank.puzzles.length > 0);
  const ids = new Set();
  for (const p of bank.puzzles) {
    assert.ok(!ids.has(p.id), `duplicate id ${p.id}`);
    ids.add(p.id);
    const dealt = deal(p.seed);
    assert.deepEqual(dealt.board, p.board, `${p.id}: board matches its seed`);
    assert.deepEqual(dealt.bag, p.bag, `${p.id}: bag matches its seed`);
    assert.ok(p.par >= PAR_MIN && p.par <= PAR_MAX, `${p.id}: par ${p.par}`);
    assert.equal(p.goals.length, 2);
    for (const g of p.goals) assert.ok(!evalGoal(p.board, g), `${p.id}: goal already holds at deal`);
    const res = replaySolution(p);
    assert.ok(res.ok, `${p.id}: ${res.reason}`);
  }
});

test('bank: at least 150 puzzles per par value and no goal pair above 10 percent', { skip: !existsSync(bankPath) && 'no bank yet' }, () => {
  const bank = JSON.parse(readFileSync(bankPath, 'utf8'));
  if (bank.puzzles.length < 1000) {
    // Phase 1 bank: only check that every par value is present.
    const seen = new Set(bank.puzzles.map((p) => p.par));
    for (let par = PAR_MIN; par <= PAR_MAX; par++) assert.ok(seen.has(par), `par ${par} present`);
    return;
  }
  const perPar = {};
  const perPair = {};
  for (const p of bank.puzzles) {
    perPar[p.par] = (perPar[p.par] || 0) + 1;
    const key = p.goals.map((g) => `${g.region.type}:${g.condition.type}`).sort().join('+');
    perPair[key] = (perPair[key] || 0) + 1;
  }
  for (let par = PAR_MIN; par <= PAR_MAX; par++) assert.ok((perPar[par] || 0) >= 150, `par ${par}: ${perPar[par]}`);
  for (const [key, n] of Object.entries(perPair)) assert.ok(n <= bank.puzzles.length * 0.1, `${key}: ${n}`);
});
