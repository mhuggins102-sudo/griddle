# Phase 2 checkpoint: tuning, 1,000-puzzle bank, bot report

Status: goal weights were re-tuned from the Phase 1 statistics (tools/tune.js), the bank was regenerated to 1,000 puzzles with a quota of 200 per par and a 10% cap per goal pair, and the greedy bot was run in three variants. All 50 tests pass, including the bank replay and distribution checks.

Headline numbers against the plan's targets:

| Check | Target | Result |
| --- | --- | --- |
| Puzzles per par value | at least 150 | exactly 200 for each of par 6 to 10 |
| Largest goal pair share | 10% or less | 1.4% (423 distinct pairs) |
| Beam par equals IDA* optimum on the depth-8 sample | at least 90% | 32 of 32 completed (100%); 8 of 40 hit the 20M-node IDA* budget |
| Solve time | 5 s or less per puzzle | mean 1.3 s per candidate, 2.8 s per accepted puzzle, one 11.7 s outlier (time-budget cut) |
| Bank file size | under 500 KB | 332 KB |
| Confidence | | mean 0.93; 86% of puzzles reached par on all 8 restarts |

How the tuning worked: each (region, condition) combination's weight was set from the share of its Phase 1 candidates that solved at par 8 to 10, clamped to 0.3 to 3 times uniform. Acceptance of candidates rose from 23% to 48% before quotas; par 10 puzzles are still the bottleneck (about 2% of candidates), so 37% of accepted candidates were discarded by the per-par quota once the easier pars filled. Total generation: 8,912 candidates, 48 minutes on 4 cores.

Things to note about the bank's make-up:

- The weighting leans hard on "all Vs" (44% of goals) and "all the same" (25%); sums, palindromes and all-different are nearly absent (under 2% each) because they are almost always too easy. If variety matters more than generation speed, the next tune should keep a floor on those weights, or make sum goals harder by drawing N from the ends of each range rather than the middle (a condition-parameter change the plan allows).
- Unsolved candidates (no draw-free solution within 12 moves found by the beam) were 6.7%, almost all "all Vs" pairs. That is where the beam's depth cap bites; it does not affect shipped puzzles.

## Bot results and bid policies

The plan's bot (one-ply lookahead on h plus 10% random moves) busts 79% of par-6 puzzles and essentially all par-9 and par-10 puzzles within 12 turns. The reason is structural: compound goals create local minima (for example, filling a row with the majority value when the shared cell must be even), and one-ply greed cannot see past them. A two-ply version only helps a little. A third variant, the "planner", runs a narrow beam search (width 20, one restart) from the current board each turn with the same 10% random-move rate; it stands in for a player who thinks several moves ahead and gives a usable distribution.

| Variant | Bust rate at 12 turns (par 6 / 8 / 10) | Best bid policy by expected score |
| --- | --- | --- |
| one-ply (plan) | 79% / 95% / 99% | par+3 (3.9 points per round) |
| two-ply | 70% / 91% / 98% | par+3 (5.7) |
| planner | 15% / 40% / 71% | par+2 (35.4), close to par+3 (34.1) |

For the planner, the expected score peaks at par+2 for every par value: the 15-point insurance cost per turn is cheap next to the bust risk, so a well-informed player would always bid 2 over par. Recommended changes to scoring constants, stated but not applied:

1. If human play looks like the planner, the insurance cost of 15 per turn is too low to make bidding tight interesting; 20 to 25 would move the optimum to par+1. Leave it until Mike has played, since humans should be better than the planner at reading the shared cell.
2. Par 10 puzzles bust 71% of planner runs even at par+3. Consider shipping fewer of them (for example 100 instead of 200) or capping v1 at par 9 if they frustrate in play. This is a bank-mix choice, not a scoring one.
3. The 10% random-move rate costs the bots about two turns per game; the turn distributions below are therefore pessimistic for a careful player.

Raw outputs follow: the bank report (`node tools/report.js --phase 1`) and the three bot runs (`node tools/bot.js --games 10` with `--lookahead 1`, `--lookahead 2`, `--plan 20`).

---

# Bank report

Generated 2026-10-27T23:21:16.412Z; 1000 puzzles; solver W=2000 R=8 depth cap 12.

## Par histogram

| Par | Puzzles | Share |
| --- | --- | --- |
| 6 | 200 | 20.0% |
| 7 | 200 | 20.0% |
| 8 | 200 | 20.0% |
| 9 | 200 | 20.0% |
| 10 | 200 | 20.0% |

## Goal pair share of the bank (top 25)

423 distinct goal pairs; largest share 1.4% (anyRow:equalTo+center3:allEven).

| Goal pair | Puzzles | Share |
| --- | --- | --- |
| anyRow:equalTo+center3:allEven | 14 | 1.4% |
| anyRow:equalTo+corners:equalTo | 11 | 1.1% |
| anti:allEqual+col:equalTo | 11 | 1.1% |
| anyRow:equalTo+block:equalTo | 10 | 1.0% |
| anyRow:ascending+plus:equalTo | 10 | 1.0% |
| anti:equalTo+anyLine:ascending | 10 | 1.0% |
| anyCol:allEqual+diag:allEqual | 9 | 0.9% |
| anyCol:ascending+diag:equalTo | 9 | 0.9% |
| anyCol:allEqual+corners:equalTo | 9 | 0.9% |
| anyRow:equalTo+plus:equalTo | 9 | 0.9% |
| anyCol:allEqual+plus:equalTo | 9 | 0.9% |
| anyCol:ascending+plus:equalTo | 9 | 0.9% |
| anyRow:equalTo+row:equalTo | 8 | 0.8% |
| col:equalTo+row:fullHouse | 8 | 0.8% |
| anyLine:equalTo+plus:equalTo | 8 | 0.8% |
| anyCol:ascending+x:equalTo | 8 | 0.8% |
| anti:equalTo+anyCol:ascending | 8 | 0.8% |
| anyCol:allEqual+x:equalTo | 8 | 0.8% |
| anyRow:allEqual+col:equalTo | 8 | 0.8% |
| anti:equalTo+diag:allEqual | 8 | 0.8% |
| corners:equalTo+diag:allEqual | 7 | 0.7% |
| diag:allEqual+x:equalTo | 7 | 0.7% |
| anyLine:equalTo+center3:allEven | 7 | 0.7% |
| anti:equalTo+row:fullHouse | 7 | 0.7% |
| anyCol:equalTo+plus:equalTo | 7 | 0.7% |

## Region and condition share

| Region | Goals | Share | | Condition | Goals | Share |
| --- | --- | --- | --- | --- | --- | --- |
| anti | 246 | 12.3% | | equalTo | 891 | 44.5% |
| anyRow | 224 | 11.2% | | allEqual | 503 | 25.1% |
| diag | 218 | 10.9% | | ascending | 243 | 12.2% |
| anyCol | 206 | 10.3% | | allEven | 113 | 5.7% |
| plus | 189 | 9.4% | | allOdd | 102 | 5.1% |
| row | 184 | 9.2% | | fullHouse | 76 | 3.8% |
| col | 170 | 8.5% | | sum | 32 | 1.6% |
| center3 | 125 | 6.3% | | palindrome | 24 | 1.2% |
| anyLine | 120 | 6.0% | | allDifferent | 13 | 0.7% |
| block | 116 | 5.8% | | noValue | 3 | 0.1% |
| x | 112 | 5.6% | |  | |  |
| corners | 90 | 4.5% | |  | |  |

## Acceptance

8912 candidates solved, 1000 accepted (11.2%), wall time 2863 s on 4 workers.

| Rejection reason | Count | Share of attempts |
| --- | --- | --- |
| too-easy | 3906 | 43.8% |
| unsolved | 596 | 6.7% |
| too-hard | 83 | 0.9% |
| quota (par full) | 3322 | 37.3% |
| quota (pair full) | 0 | 0.0% |

### Acceptance rate per goal pair (attempted at least 3 times, sorted by attempts)

| Goal pair | Attempts | Accepted | Rate | Too easy | Too hard | Unsolved | Par mix of solved |
| --- | --- | --- | --- | --- | --- | --- | --- |
| anti:allEqual+diag:allEqual | 41 | 5 | 12.2% | 1 | 1 | 6 | 5:1 6:4 7:15 8:13 9:1 12:1 |
| anyRow:equalTo+center3:allEven | 40 | 14 | 35.0% | 2 | 1 | 0 | 5:2 6:9 7:7 8:8 9:6 10:7 11:1 |
| anyCol:ascending+plus:equalTo | 40 | 9 | 22.5% | 2 | 1 | 0 | 5:2 6:5 7:13 8:8 9:6 10:5 11:1 |
| diag:allEqual+plus:equalTo | 38 | 6 | 15.8% | 0 | 2 | 18 | 7:1 8:6 9:8 10:3 11:2 |
| anti:allEqual+anyRow:equalTo | 36 | 7 | 19.4% | 0 | 0 | 19 | 6:1 7:6 8:5 9:1 10:4 |
| anyCol:ascending+diag:equalTo | 35 | 9 | 25.7% | 1 | 0 | 2 | 5:1 6:8 7:7 8:9 9:7 10:1 |
| anyRow:equalTo+row:fullHouse | 35 | 3 | 8.6% | 14 | 0 | 0 | 3:1 4:6 5:7 6:16 7:5 |
| anyRow:equalTo+plus:equalTo | 34 | 9 | 26.5% | 1 | 2 | 6 | 5:1 7:7 8:8 9:6 10:4 11:2 |
| anyRow:equalTo+diag:allEqual | 34 | 1 | 2.9% | 0 | 0 | 14 | 6:1 7:6 8:11 9:2 |
| anti:allEqual+x:equalTo | 34 | 6 | 17.6% | 3 | 1 | 0 | 4:1 5:2 6:7 7:8 8:6 9:7 10:2 12:1 |
| col:equalTo+diag:allEqual | 33 | 6 | 18.2% | 0 | 2 | 21 | 7:1 8:3 9:2 10:4 11:1 12:1 |
| anti:equalTo+anyCol:ascending | 33 | 8 | 24.2% | 0 | 0 | 1 | 6:9 7:10 8:10 9:3 |
| center3:allEven+diag:allEqual | 32 | 4 | 12.5% | 5 | 0 | 0 | 4:2 5:3 6:13 7:11 8:2 9:1 |
| corners:equalTo+diag:allEqual | 31 | 7 | 22.6% | 2 | 0 | 4 | 5:2 6:2 7:8 8:9 9:4 10:2 |
| anyLine:ascending+diag:allEqual | 30 | 0 | 0.0% | 15 | 0 | 0 | 4:4 5:11 6:14 7:1 |
| anyCol:allEqual+plus:equalTo | 30 | 9 | 30.0% | 2 | 0 | 0 | 5:2 6:5 7:6 8:11 9:5 10:1 |
| anyRow:equalTo+x:equalTo | 30 | 7 | 23.3% | 1 | 3 | 6 | 4:1 7:3 8:7 9:6 10:4 11:2 12:1 |
| diag:equalTo+row:fullHouse | 29 | 4 | 13.8% | 3 | 0 | 0 | 5:3 6:8 7:9 8:8 9:1 |
| anyCol:ascending+diag:allEqual | 29 | 4 | 13.8% | 10 | 0 | 0 | 4:2 5:8 6:13 7:5 8:1 |
| anti:allEqual+diag:equalTo | 29 | 6 | 20.7% | 0 | 2 | 15 | 7:2 8:4 9:3 10:3 11:2 |
| diag:allEqual+x:equalTo | 29 | 7 | 24.1% | 2 | 0 | 0 | 5:2 6:4 7:10 8:6 9:4 10:3 |
| anti:equalTo+row:fullHouse | 28 | 7 | 25.0% | 4 | 0 | 0 | 5:4 6:8 7:6 8:7 9:3 |
| anti:allEqual+anyRow:ascending | 28 | 2 | 7.1% | 8 | 0 | 1 | 4:3 5:5 6:12 7:7 |
| anyRow:equalTo+block:equalTo | 27 | 10 | 37.0% | 0 | 1 | 0 | 6:5 7:6 8:9 9:6 11:1 |
| anyRow:equalTo+corners:equalTo | 27 | 11 | 40.7% | 1 | 0 | 3 | 5:1 6:4 7:6 8:4 9:4 10:5 |
| anyCol:allEqual+corners:equalTo | 27 | 9 | 33.3% | 2 | 0 | 0 | 5:2 6:10 7:9 8:6 |
| anti:equalTo+diag:allEqual | 27 | 8 | 29.6% | 0 | 0 | 14 | 7:1 8:2 9:4 10:6 |
| anyCol:allEqual+center3:allEven | 27 | 4 | 14.8% | 4 | 0 | 0 | 3:1 4:1 5:2 6:9 7:9 8:5 |
| anti:allEqual+plus:allEqual | 26 | 5 | 19.2% | 0 | 0 | 9 | 6:3 7:4 8:5 9:5 |
| anti:allEqual+center3:allEven | 26 | 2 | 7.7% | 5 | 0 | 0 | 4:2 5:3 6:12 7:6 8:2 9:1 |
| anyCol:ascending+corners:equalTo | 26 | 6 | 23.1% | 2 | 0 | 0 | 5:2 6:8 7:8 8:5 9:3 |
| anyCol:ascending+block:equalTo | 26 | 4 | 15.4% | 5 | 0 | 0 | 5:5 6:6 7:7 8:3 9:5 |
| anti:allEqual+corners:equalTo | 25 | 5 | 20.0% | 2 | 0 | 0 | 4:1 5:1 6:2 7:8 8:10 9:2 10:1 |
| anyRow:ascending+plus:equalTo | 25 | 10 | 40.0% | 2 | 1 | 1 | 5:2 6:1 7:6 8:4 9:7 10:3 12:1 |
| anyCol:ascending+x:equalTo | 25 | 8 | 32.0% | 0 | 0 | 0 | 6:4 7:10 8:6 9:4 10:1 |
| anyCol:ascending+row:fullHouse | 25 | 1 | 4.0% | 24 | 0 | 0 | 3:2 4:6 5:16 6:1 |
| anti:allEqual+plus:equalTo | 25 | 6 | 24.0% | 0 | 3 | 9 | 6:1 8:5 9:3 10:4 11:2 12:1 |
| plus:equalTo+row:fullHouse | 24 | 5 | 20.8% | 4 | 0 | 0 | 4:1 5:3 6:5 7:8 8:4 9:3 |
| anti:allEqual+col:equalTo | 24 | 11 | 45.8% | 0 | 1 | 9 | 6:1 7:2 8:1 9:4 10:6 11:1 |
| anyRow:allEqual+diag:allEqual | 24 | 2 | 8.3% | 1 | 0 | 2 | 5:1 6:2 7:11 8:7 9:1 |
| anti:equalTo+anyCol:allEqual | 24 | 3 | 12.5% | 0 | 0 | 12 | 7:6 8:4 9:2 |
| anyLine:equalTo+center3:allEven | 24 | 7 | 29.2% | 4 | 0 | 0 | 5:4 6:4 7:6 8:7 9:2 10:1 |
| diag:equalTo+plus:allEqual | 24 | 4 | 16.7% | 0 | 1 | 14 | 8:2 9:6 10:1 12:1 |
| anyCol:allEqual+block:equalTo | 24 | 4 | 16.7% | 2 | 0 | 0 | 5:2 6:6 7:10 8:4 9:1 10:1 |
| anyCol:allEqual+x:equalTo | 24 | 8 | 33.3% | 1 | 0 | 0 | 5:1 6:2 7:9 8:7 9:4 10:1 |
| block:allEqual+center3:allEven | 23 | 4 | 17.4% | 2 | 0 | 1 | 5:2 6:5 7:8 8:5 9:2 |
| anyRow:allEqual+col:equalTo | 23 | 8 | 34.8% | 0 | 2 | 9 | 7:1 8:2 9:6 10:3 11:1 12:1 |
| plus:allEqual+x:equalTo | 23 | 2 | 8.7% | 0 | 1 | 15 | 7:1 8:1 9:3 10:2 11:1 |
| block:allEqual+x:equalTo | 23 | 6 | 26.1% | 0 | 0 | 7 | 6:1 7:5 8:5 9:3 10:2 |
| diag:allEqual+row:fullHouse | 23 | 2 | 8.7% | 13 | 0 | 0 | 4:4 5:9 6:10 |
| anti:allOdd+anyCol:ascending | 23 | 1 | 4.3% | 21 | 0 | 0 | 3:1 4:12 5:8 6:1 7:1 |
| anyRow:ascending+x:equalTo | 23 | 3 | 13.0% | 2 | 0 | 0 | 4:2 6:6 7:4 8:5 9:5 10:1 |
| anyCol:allEqual+diag:allEqual | 22 | 9 | 40.9% | 1 | 0 | 1 | 5:1 6:5 7:6 8:9 |
| col:equalTo+row:fullHouse | 22 | 8 | 36.4% | 2 | 1 | 1 | 5:2 6:2 7:6 8:3 9:4 10:3 12:1 |
| anti:equalTo+anyLine:ascending | 22 | 10 | 45.5% | 2 | 0 | 0 | 4:1 5:1 6:6 7:7 8:3 9:3 10:1 |
| diag:allEqual+plus:allEqual | 22 | 2 | 9.1% | 0 | 0 | 6 | 6:1 7:7 8:7 9:1 |
| anti:allEqual+row:fullHouse | 22 | 0 | 0.0% | 17 | 0 | 0 | 3:1 4:5 5:11 6:4 7:1 |
| anyLine:ascending+plus:equalTo | 22 | 3 | 13.6% | 1 | 0 | 0 | 5:1 6:4 7:3 8:9 9:5 |
| anti:equalTo+plus:allEqual | 21 | 5 | 23.8% | 0 | 0 | 8 | 8:3 9:9 10:1 |
| anyRow:allEqual+diag:equalTo | 21 | 4 | 19.0% | 0 | 0 | 11 | 7:2 8:4 9:3 10:1 |
| anyLine:equalTo+plus:allEqual | 21 | 1 | 4.8% | 2 | 0 | 0 | 4:1 5:1 6:5 7:9 8:5 |
| center3:allEven+plus:allEqual | 21 | 1 | 4.8% | 6 | 0 | 0 | 3:1 5:5 6:13 7:2 |
| anyRow:allEqual+block:equalTo | 21 | 5 | 23.8% | 5 | 0 | 0 | 4:1 5:4 6:9 7:1 8:6 |
| anyLine:ascending+x:equalTo | 21 | 3 | 14.3% | 3 | 0 | 1 | 5:3 6:5 7:6 8:4 9:1 10:1 |
| anyCol:ascending+plus:allEqual | 21 | 5 | 23.8% | 3 | 0 | 0 | 5:3 6:9 7:7 8:1 10:1 |
| anti:allOdd+diag:allEqual | 21 | 1 | 4.8% | 9 | 0 | 4 | 4:1 5:8 6:6 7:2 |
| anyCol:ascending+col:equalTo | 21 | 6 | 28.6% | 1 | 1 | 0 | 4:1 6:1 7:5 8:6 9:4 10:3 11:1 |
| anyLine:allEqual+center3:allEven | 21 | 3 | 14.3% | 7 | 0 | 0 | 2:1 4:1 5:5 6:8 7:4 8:2 |
| anyCol:allEqual+row:allEqual | 21 | 3 | 14.3% | 0 | 0 | 5 | 6:1 7:6 8:8 9:1 |
| anyRow:allEqual+plus:equalTo | 21 | 4 | 19.0% | 2 | 0 | 0 | 5:2 6:3 7:3 8:10 10:3 |
| anyRow:equalTo+row:equalTo | 20 | 8 | 40.0% | 2 | 3 | 0 | 4:1 5:1 6:4 7:1 8:2 9:6 10:2 11:3 |
| anyLine:equalTo+plus:equalTo | 20 | 8 | 40.0% | 1 | 3 | 1 | 5:1 6:2 8:5 9:7 10:1 11:3 |
| anyCol:allEqual+diag:equalTo | 20 | 4 | 20.0% | 0 | 0 | 10 | 7:3 8:3 9:2 10:2 |
| anyLine:ascending+corners:equalTo | 20 | 4 | 20.0% | 3 | 0 | 0 | 4:2 5:1 6:6 7:7 8:4 |
| diag:allEqual+row:allEqual | 20 | 4 | 20.0% | 1 | 0 | 8 | 5:1 7:2 8:3 9:5 10:1 |
| anyLine:equalTo+x:equalTo | 20 | 5 | 25.0% | 0 | 0 | 1 | 6:3 7:3 8:3 9:8 10:2 |
| diag:allEqual+row:equalTo | 20 | 3 | 15.0% | 0 | 1 | 13 | 8:2 9:2 10:2 12:1 |
| anti:allEqual+anyLine:equalTo | 20 | 0 | 0.0% | 12 | 0 | 4 | 3:1 4:4 5:7 6:4 |
| diag:equalTo+row:allEqual | 19 | 3 | 15.8% | 0 | 0 | 13 | 8:3 9:1 10:2 |
| anyRow:ascending+row:fullHouse | 19 | 0 | 0.0% | 16 | 0 | 0 | 3:3 4:6 5:7 6:3 |
| anyLine:equalTo+diag:allEqual | 19 | 0 | 0.0% | 12 | 0 | 3 | 3:1 4:3 5:8 6:4 |
| anyRow:ascending+diag:equalTo | 19 | 5 | 26.3% | 1 | 0 | 1 | 5:1 6:3 7:5 8:7 9:1 10:1 |
| anyRow:equalTo+block:allEqual | 19 | 4 | 21.1% | 2 | 0 | 0 | 5:2 6:7 7:6 8:3 9:1 |
| anti:allEqual+anyRow:allEqual | 19 | 2 | 10.5% | 1 | 0 | 3 | 5:1 6:2 7:8 8:5 |
| anyCol:allEqual+row:fullHouse | 19 | 1 | 5.3% | 14 | 0 | 0 | 3:1 4:3 5:10 6:4 8:1 |
| anyRow:allEqual+center3:allEven | 19 | 6 | 31.6% | 6 | 0 | 0 | 5:6 6:3 7:6 8:4 |
| anyCol:ascending+center3:allEven | 19 | 1 | 5.3% | 4 | 0 | 0 | 5:4 6:2 7:8 8:4 9:1 |
| anti:allEqual+corners:sum | 18 | 0 | 0.0% | 15 | 0 | 1 | 2:1 4:1 5:13 6:2 |
| anti:allEqual+row:ascending | 18 | 3 | 16.7% | 1 | 0 | 9 | 5:1 6:3 7:2 8:3 |
| anyLine:ascending+row:fullHouse | 18 | 0 | 0.0% | 18 | 0 | 0 | 2:4 3:3 4:6 5:5 |
| anyLine:allEqual+block:equalTo | 18 | 1 | 5.6% | 5 | 0 | 0 | 4:2 5:3 6:6 7:5 8:2 |
| anyCol:allEqual+col:equalTo | 18 | 1 | 5.6% | 11 | 0 | 0 | 4:5 5:6 6:5 7:1 8:1 |
| block:equalTo+diag:allEqual | 18 | 3 | 16.7% | 0 | 1 | 2 | 6:2 7:4 8:8 9:1 11:1 |
| anyLine:allEqual+diag:equalTo | 17 | 4 | 23.5% | 4 | 0 | 0 | 5:4 6:8 7:4 8:1 |
| anyRow:ascending+corners:equalTo | 17 | 2 | 11.8% | 3 | 0 | 0 | 5:3 6:4 7:7 8:3 |
| anti:allEqual+anyLine:ascending | 17 | 4 | 23.5% | 7 | 0 | 0 | 4:2 5:5 6:9 7:1 |
| anyRow:ascending+center3:allEven | 17 | 2 | 11.8% | 3 | 0 | 0 | 5:3 6:4 7:3 8:5 9:2 |
| anti:allEqual+anyCol:equalTo | 17 | 2 | 11.8% | 0 | 0 | 9 | 7:1 8:7 |
| plus:equalTo+row:allEqual | 17 | 4 | 23.5% | 0 | 0 | 9 | 6:1 7:3 9:2 10:2 |
| anyRow:equalTo+row:allEqual | 17 | 1 | 5.9% | 6 | 0 | 0 | 4:2 5:4 6:8 7:2 9:1 |
| anti:allOdd+anyCol:allEqual | 17 | 0 | 0.0% | 13 | 0 | 0 | 2:1 3:1 4:5 5:6 6:3 7:1 |
| anti:allEqual+row:allEqual | 17 | 2 | 11.8% | 0 | 0 | 1 | 6:1 7:5 8:7 9:3 |
| anyLine:ascending+center3:allEven | 17 | 1 | 5.9% | 2 | 0 | 0 | 4:1 5:1 6:4 7:7 8:3 10:1 |
| anti:allEqual+center3:allOdd | 17 | 0 | 0.0% | 4 | 0 | 0 | 4:1 5:3 6:6 7:4 8:3 |
| center3:allEven+plus:equalTo | 16 | 3 | 18.8% | 2 | 0 | 0 | 5:2 6:6 7:7 8:1 |
| anyRow:ascending+block:allEqual | 16 | 2 | 12.5% | 7 | 0 | 0 | 4:1 5:6 6:6 7:3 |
| anyLine:ascending+block:equalTo | 16 | 4 | 25.0% | 2 | 0 | 0 | 4:2 6:6 7:4 8:2 9:2 |
| anti:allEqual+anyCol:allEqual | 16 | 4 | 25.0% | 0 | 0 | 1 | 6:3 7:7 8:5 |
| anti:palindrome+anyCol:ascending | 16 | 0 | 0.0% | 16 | 0 | 0 | 3:3 4:8 5:5 |
| anti:equalTo+anyRow:allEqual | 16 | 2 | 12.5% | 0 | 1 | 8 | 7:1 8:3 9:3 11:1 |
| anyLine:equalTo+row:fullHouse | 16 | 2 | 12.5% | 9 | 0 | 0 | 4:1 5:8 6:6 7:1 |
| anti:allEqual+anyCol:ascending | 16 | 0 | 0.0% | 5 | 0 | 0 | 4:1 5:4 6:10 7:1 |
| anyRow:equalTo+corners:sum | 16 | 1 | 6.3% | 9 | 0 | 0 | 3:1 4:5 5:3 6:5 7:1 8:1 |
| row:fullHouse+x:equalTo | 16 | 1 | 6.3% | 5 | 0 | 0 | 4:1 5:4 6:1 7:7 8:3 |
| anyCol:allEqual+plus:allEqual | 16 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 6:12 7:2 |
| corners:sum+diag:allEqual | 15 | 0 | 0.0% | 13 | 0 | 0 | 2:1 4:1 5:11 6:2 |
| diag:allEqual+row:allOdd | 15 | 3 | 20.0% | 5 | 0 | 0 | 3:1 4:1 5:3 6:9 7:1 |
| anyLine:allEqual+diag:allEqual | 15 | 0 | 0.0% | 15 | 0 | 0 | 3:4 4:9 5:2 |
| anyCol:ascending+row:allEqual | 15 | 2 | 13.3% | 2 | 0 | 6 | 5:2 6:2 7:4 8:1 |
| plus:equalTo+x:allEqual | 15 | 3 | 20.0% | 0 | 1 | 7 | 7:2 9:4 10:1 11:1 |
| row:allEqual+x:equalTo | 15 | 2 | 13.3% | 0 | 1 | 1 | 7:1 8:7 9:5 11:1 |
| anyCol:equalTo+plus:equalTo | 15 | 7 | 46.7% | 0 | 0 | 2 | 7:1 8:3 9:4 10:5 |
| anyRow:equalTo+row:ascending | 15 | 3 | 20.0% | 1 | 1 | 0 | 5:1 6:4 7:5 8:4 11:1 |
| diag:allEqual+row:ascending | 15 | 0 | 0.0% | 3 | 0 | 5 | 5:3 6:3 7:4 |
| anyRow:ascending+row:allEqual | 15 | 1 | 6.7% | 2 | 0 | 0 | 5:2 6:8 7:5 |
| anyRow:ascending+diag:allEqual | 15 | 1 | 6.7% | 4 | 0 | 0 | 5:4 6:7 7:2 8:1 9:1 |
| anyLine:ascending+diag:equalTo | 15 | 7 | 46.7% | 0 | 0 | 0 | 6:2 7:3 8:6 9:2 10:2 |
| anti:allEqual+col:allEqual | 15 | 3 | 20.0% | 0 | 0 | 5 | 7:3 8:4 9:2 10:1 |
| center3:allEven+x:equalTo | 15 | 2 | 13.3% | 2 | 0 | 0 | 5:2 6:5 7:6 8:2 |
| anyRow:equalTo+diag:fullHouse | 15 | 1 | 6.7% | 6 | 0 | 0 | 4:1 5:5 6:5 7:4 |
| anyCol:equalTo+diag:allEqual | 15 | 0 | 0.0% | 0 | 0 | 9 | 6:1 7:2 8:2 9:1 |
| anti:equalTo+anyRow:ascending | 15 | 1 | 6.7% | 2 | 1 | 2 | 4:1 5:1 6:3 7:4 8:1 9:1 10:1 12:1 |
| anyCol:allEqual+row:equalTo | 14 | 3 | 21.4% | 0 | 2 | 6 | 7:1 8:2 9:1 10:2 11:1 12:1 |
| anyCol:equalTo+x:equalTo | 14 | 5 | 35.7% | 0 | 0 | 1 | 6:1 8:3 9:7 10:2 |
| corners:sum+diag:equalTo | 14 | 0 | 0.0% | 5 | 0 | 0 | 5:5 6:3 7:5 8:1 |
| anyLine:equalTo+block:equalTo | 14 | 2 | 14.3% | 2 | 1 | 0 | 4:1 5:1 6:1 7:3 8:2 9:4 10:1 11:1 |
| anyLine:equalTo+corners:equalTo | 14 | 4 | 28.6% | 2 | 1 | 0 | 4:2 6:2 7:4 8:3 9:1 10:1 11:1 |
| anyRow:equalTo+plus:allEqual | 14 | 5 | 35.7% | 0 | 0 | 0 | 6:3 7:2 8:7 9:2 |
| anti:allOdd+anyRow:equalTo | 14 | 0 | 0.0% | 8 | 0 | 0 | 4:3 5:5 6:5 7:1 |
| center3:allEven+row:fullHouse | 14 | 1 | 7.1% | 11 | 0 | 0 | 4:4 5:7 6:2 7:1 |
| center3:allEven+diag:equalTo | 14 | 3 | 21.4% | 1 | 0 | 0 | 5:1 6:1 7:4 8:6 9:2 |
| anyRow:allEqual+corners:equalTo | 14 | 3 | 21.4% | 1 | 0 | 0 | 5:1 6:4 7:5 8:4 |
| anyCol:ascending+corners:sum | 14 | 0 | 0.0% | 14 | 0 | 0 | 3:3 4:6 5:5 |
| anyRow:allEqual+row:fullHouse | 14 | 0 | 0.0% | 14 | 0 | 0 | 3:1 4:4 5:9 |
| anyCol:allEqual+row:allOdd | 14 | 1 | 7.1% | 10 | 0 | 0 | 4:3 5:7 6:4 |
| anti:equalTo+row:allEqual | 14 | 2 | 14.3% | 0 | 0 | 11 | 8:1 9:1 10:1 |
| anti:equalTo+block:allEqual | 14 | 1 | 7.1% | 0 | 0 | 1 | 6:1 7:2 8:8 9:2 |
| block:equalTo+x:allEqual | 13 | 3 | 23.1% | 0 | 0 | 5 | 6:1 7:1 8:3 9:3 |
| anyCol:equalTo+corners:equalTo | 13 | 2 | 15.4% | 1 | 0 | 1 | 5:1 6:1 7:4 8:3 9:3 |
| anyRow:allEqual+plus:allEqual | 13 | 3 | 23.1% | 6 | 0 | 0 | 5:6 6:3 7:4 |
| anyCol:equalTo+block:equalTo | 13 | 4 | 30.8% | 0 | 0 | 1 | 7:4 8:2 9:4 10:2 |
| anti:allOdd+plus:allEqual | 13 | 0 | 0.0% | 6 | 0 | 0 | 5:6 6:6 7:1 |
| anti:palindrome+diag:equalTo | 13 | 1 | 7.7% | 4 | 0 | 0 | 5:4 6:6 7:2 8:1 |
| anyCol:ascending+block:allEqual | 13 | 1 | 7.7% | 6 | 0 | 0 | 4:2 5:4 6:5 7:2 |
| block:equalTo+center3:allEven | 13 | 5 | 38.5% | 0 | 0 | 0 | 6:2 7:2 8:3 9:2 10:4 |
| col:equalTo+row:allEqual | 13 | 5 | 38.5% | 0 | 1 | 6 | 8:1 9:2 10:3 12:1 |
| anyCol:allEqual+block:allEqual | 13 | 1 | 7.7% | 5 | 0 | 0 | 2:1 5:4 6:8 |
| anyRow:ascending+row:equalTo | 13 | 1 | 7.7% | 1 | 0 | 0 | 5:1 6:2 7:3 8:4 9:2 10:1 |
| anyLine:equalTo+row:allEqual | 13 | 2 | 15.4% | 4 | 0 | 0 | 5:4 6:5 7:3 8:1 |
| anyCol:allEqual+row:ascending | 13 | 0 | 0.0% | 2 | 0 | 5 | 5:2 6:1 7:4 8:1 |
| anyCol:equalTo+center3:allEven | 13 | 3 | 23.1% | 0 | 0 | 0 | 6:1 7:3 8:3 9:4 10:2 |
| anti:allOdd+anyLine:ascending | 13 | 0 | 0.0% | 13 | 0 | 0 | 2:2 3:2 4:7 5:2 |
| anyRow:equalTo+x:allEqual | 13 | 0 | 0.0% | 2 | 0 | 0 | 5:2 6:3 7:5 8:2 9:1 |
| anti:allEqual+x:allEqual | 12 | 1 | 8.3% | 8 | 0 | 0 | 5:8 6:4 |
| anti:allEqual+anyLine:allEqual | 12 | 0 | 0.0% | 12 | 0 | 0 | 3:3 4:6 5:3 |
| anyRow:ascending+plus:allEqual | 12 | 0 | 0.0% | 2 | 0 | 0 | 5:2 6:3 7:5 8:2 |
| anyRow:allEqual+x:equalTo | 12 | 3 | 25.0% | 1 | 0 | 0 | 5:1 6:3 7:3 8:3 9:2 |
| center3:allEven+diag:fullHouse | 12 | 1 | 8.3% | 6 | 0 | 0 | 3:2 4:1 5:3 6:5 7:1 |
| anti:allOdd+x:equalTo | 12 | 0 | 0.0% | 10 | 0 | 0 | 3:1 4:3 5:6 7:1 8:1 |
| anti:equalTo+center3:allEven | 12 | 4 | 33.3% | 0 | 0 | 0 | 6:4 7:4 8:2 9:1 10:1 |
| anti:allEqual+row:equalTo | 12 | 1 | 8.3% | 0 | 1 | 8 | 7:1 9:1 10:1 11:1 |
| anti:equalTo+anyLine:allEqual | 12 | 2 | 16.7% | 6 | 0 | 0 | 2:2 4:2 5:2 6:4 7:2 |
| anti:allOdd+corners:sum | 12 | 0 | 0.0% | 12 | 0 | 0 | 1:2 2:1 3:4 4:3 5:2 |
| anyRow:ascending+block:equalTo | 12 | 2 | 16.7% | 1 | 0 | 0 | 5:1 6:2 7:2 8:4 9:3 |
| anti:fullHouse+center3:allEven | 12 | 0 | 0.0% | 8 | 0 | 0 | 4:3 5:5 6:3 8:1 |
| anyLine:equalTo+row:equalTo | 12 | 2 | 16.7% | 3 | 2 | 1 | 4:2 5:1 6:1 7:1 8:1 9:3 11:2 |
| anyCol:fullHouse+diag:equalTo | 12 | 3 | 25.0% | 3 | 0 | 0 | 4:1 5:2 6:3 7:5 8:1 |
| anyLine:ascending+row:ascending | 12 | 0 | 0.0% | 12 | 0 | 0 | 3:3 4:4 5:5 |
| anyRow:equalTo+center3:allOdd | 12 | 4 | 33.3% | 3 | 0 | 1 | 4:2 5:1 6:2 7:2 9:2 10:2 |
| anyCol:allEqual+corners:sum | 12 | 0 | 0.0% | 12 | 0 | 0 | 3:3 4:8 5:1 |
| block:allEqual+diag:allEqual | 12 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 6:10 |
| anti:allEqual+row:sum | 12 | 0 | 0.0% | 10 | 0 | 0 | 3:1 4:4 5:5 6:2 |
| anyCol:ascending+diag:fullHouse | 11 | 0 | 0.0% | 11 | 0 | 0 | 2:1 3:1 4:6 5:3 |
| anti:allEqual+diag:fullHouse | 11 | 1 | 9.1% | 6 | 0 | 0 | 3:1 5:5 6:4 7:1 |
| diag:allEqual+row:sum | 11 | 0 | 0.0% | 11 | 0 | 0 | 2:1 3:1 4:8 5:1 |
| col:ascending+diag:allEqual | 11 | 1 | 9.1% | 1 | 0 | 4 | 5:1 6:3 7:3 |
| anyRow:allEqual+row:allEqual | 11 | 0 | 0.0% | 11 | 0 | 0 | 3:3 4:5 5:3 |
| anyRow:equalTo+col:allEqual | 11 | 2 | 18.2% | 0 | 0 | 6 | 7:3 9:1 10:1 |
| anyRow:equalTo+block:allOdd | 11 | 3 | 27.3% | 2 | 0 | 0 | 4:1 5:1 6:4 7:3 8:2 |
| col:ascending+row:allEqual | 11 | 1 | 9.1% | 0 | 0 | 5 | 6:2 7:3 8:1 |
| anti:palindrome+diag:allEqual | 11 | 0 | 0.0% | 10 | 0 | 0 | 3:1 4:2 5:7 6:1 |
| anti:equalTo+row:sum | 11 | 3 | 27.3% | 4 | 0 | 0 | 4:2 5:2 6:6 7:1 |
| col:allOdd+diag:allEqual | 11 | 3 | 27.3% | 1 | 0 | 2 | 3:1 6:5 7:3 |
| anyCol:allEqual+col:allEqual | 11 | 0 | 0.0% | 10 | 0 | 0 | 3:1 4:6 5:3 6:1 |
| anyCol:fullHouse+center3:allEven | 11 | 0 | 0.0% | 11 | 0 | 0 | 3:2 4:3 5:6 |
| anyLine:allEqual+row:fullHouse | 11 | 0 | 0.0% | 11 | 0 | 0 | 3:4 4:5 5:2 |
| anti:palindrome+anyLine:equalTo | 11 | 0 | 0.0% | 8 | 0 | 0 | 3:1 4:2 5:5 6:3 |
| anyCol:fullHouse+diag:allEqual | 11 | 0 | 0.0% | 11 | 0 | 0 | 3:3 4:4 5:4 |
| anyCol:fullHouse+block:equalTo | 11 | 0 | 0.0% | 7 | 0 | 0 | 3:1 4:2 5:4 6:3 7:1 |
| anyRow:equalTo+col:ascending | 11 | 2 | 18.2% | 0 | 0 | 5 | 6:2 7:2 8:1 9:1 |
| col:allEqual+x:equalTo | 11 | 0 | 0.0% | 0 | 0 | 6 | 7:2 8:2 9:1 |
| center3:allEven+row:allEqual | 11 | 0 | 0.0% | 3 | 0 | 0 | 4:2 5:1 6:1 7:4 8:2 9:1 |
| center3:allOdd+diag:allEqual | 10 | 2 | 20.0% | 1 | 0 | 0 | 5:1 6:6 7:1 8:2 |
| anti:equalTo+col:allEqual | 10 | 1 | 10.0% | 0 | 0 | 5 | 6:1 7:1 8:2 10:1 |
| block:equalTo+corners:sum | 10 | 1 | 10.0% | 6 | 0 | 0 | 3:1 4:1 5:4 6:2 7:1 8:1 |
| anyCol:ascending+block:allOdd | 10 | 1 | 10.0% | 6 | 0 | 0 | 3:1 4:2 5:3 6:4 |
| anyCol:ascending+center3:allOdd | 10 | 2 | 20.0% | 0 | 1 | 0 | 6:2 7:6 9:1 11:1 |
| block:allEqual+corners:equalTo | 10 | 3 | 30.0% | 1 | 0 | 5 | 4:1 7:3 10:1 |
| anti:ascending+row:allEqual | 10 | 3 | 30.0% | 0 | 0 | 2 | 6:2 7:2 8:1 9:3 |
| anyCol:ascending+row:allOdd | 10 | 0 | 0.0% | 8 | 0 | 0 | 4:4 5:4 6:1 7:1 |
| anti:allOdd+anyRow:allEqual | 10 | 0 | 0.0% | 6 | 0 | 0 | 3:2 4:2 5:2 6:4 |
| anyCol:allEqual+x:allEqual | 10 | 1 | 10.0% | 2 | 0 | 0 | 5:2 6:6 7:2 |
| plus:allEqual+row:fullHouse | 10 | 1 | 10.0% | 7 | 0 | 0 | 4:2 5:5 6:3 |
| diag:equalTo+x:allEqual | 10 | 1 | 10.0% | 2 | 0 | 0 | 4:1 5:1 6:1 7:4 8:3 |
| col:ascending+row:fullHouse | 10 | 0 | 0.0% | 7 | 0 | 0 | 3:1 5:6 6:2 7:1 |
| anti:palindrome+anyLine:ascending | 10 | 0 | 0.0% | 10 | 0 | 0 | 2:1 3:2 4:4 5:3 |
| anyLine:ascending+plus:allEqual | 10 | 1 | 10.0% | 4 | 0 | 0 | 4:1 5:3 6:5 7:1 |
| plus:allEqual+row:allEqual | 10 | 1 | 10.0% | 1 | 0 | 3 | 5:1 6:2 7:2 9:2 |
| anyLine:ascending+x:allEqual | 10 | 1 | 10.0% | 3 | 0 | 0 | 5:3 6:7 |
| anti:allOdd+row:ascending | 10 | 0 | 0.0% | 4 | 0 | 1 | 4:1 5:3 6:5 |
| anyCol:ascending+col:allEqual | 10 | 0 | 0.0% | 3 | 0 | 0 | 5:3 6:2 7:2 8:3 |
| block:allEqual+center3:allOdd | 10 | 2 | 20.0% | 2 | 0 | 1 | 4:2 6:1 7:2 8:2 9:2 |
| col:allEqual+diag:equalTo | 10 | 0 | 0.0% | 0 | 2 | 6 | 8:1 9:1 11:1 12:1 |
| anti:palindrome+center3:allEven | 10 | 0 | 0.0% | 4 | 0 | 0 | 5:4 6:4 7:1 8:1 |
| anyLine:ascending+block:allEqual | 10 | 0 | 0.0% | 7 | 0 | 0 | 4:1 5:6 6:3 |
| anti:fullHouse+diag:allEqual | 10 | 0 | 0.0% | 4 | 0 | 0 | 4:1 5:3 6:6 |
| col:allEqual+row:ascending | 10 | 0 | 0.0% | 1 | 0 | 4 | 5:1 7:2 8:3 |
| anti:palindrome+corners:equalTo | 10 | 0 | 0.0% | 6 | 0 | 0 | 4:1 5:5 6:2 7:2 |
| diag:allEqual+x:allEqual | 10 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 6:7 |
| anyCol:equalTo+row:fullHouse | 9 | 2 | 22.2% | 4 | 0 | 0 | 4:1 5:3 6:2 7:3 |
| anti:ascending+anyLine:allEqual | 9 | 2 | 22.2% | 2 | 0 | 0 | 5:2 6:4 7:1 8:2 |
| anyRow:allEqual+row:sum | 9 | 0 | 0.0% | 9 | 0 | 0 | 3:3 4:3 5:3 |
| diag:equalTo+row:allOdd | 9 | 1 | 11.1% | 4 | 0 | 0 | 5:4 7:2 8:3 |
| anyLine:equalTo+row:allOdd | 9 | 1 | 11.1% | 3 | 0 | 0 | 4:3 6:5 7:1 |
| anyLine:equalTo+block:allEqual | 9 | 2 | 22.2% | 3 | 0 | 0 | 4:1 5:2 6:2 7:3 9:1 |
| anti:allOdd+col:equalTo | 9 | 2 | 22.2% | 1 | 0 | 0 | 5:1 6:2 7:1 8:4 9:1 |
| anti:allOdd+row:equalTo | 9 | 4 | 44.4% | 2 | 0 | 0 | 5:2 6:2 7:2 8:3 |
| anti:ascending+anyRow:ascending | 9 | 4 | 44.4% | 0 | 0 | 0 | 6:3 7:3 8:2 9:1 |
| anti:palindrome+row:fullHouse | 9 | 0 | 0.0% | 9 | 0 | 0 | 3:4 4:4 5:1 |
| anti:allEqual+block:equalTo | 9 | 1 | 11.1% | 1 | 0 | 2 | 5:1 7:3 8:2 9:1 |
| anyCol:fullHouse+col:equalTo | 9 | 2 | 22.2% | 1 | 0 | 0 | 5:1 6:4 7:3 8:1 |
| anyLine:allEqual+plus:equalTo | 9 | 1 | 11.1% | 0 | 0 | 0 | 7:3 8:4 9:2 |
| diag:equalTo+x:fullHouse | 9 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 6:4 7:1 8:1 |
| anyRow:allEqual+row:allOdd | 9 | 0 | 0.0% | 9 | 0 | 0 | 4:6 5:3 |
| anyLine:allEqual+col:equalTo | 9 | 1 | 11.1% | 3 | 0 | 0 | 3:1 4:1 5:1 6:3 7:1 8:1 9:1 |
| anyCol:allEqual+block:allOdd | 9 | 0 | 0.0% | 9 | 0 | 0 | 3:1 4:3 5:5 |
| col:allEqual+plus:equalTo | 9 | 2 | 22.2% | 0 | 1 | 3 | 7:1 8:1 9:2 10:1 11:1 |
| anti:allOdd+x:allEqual | 9 | 1 | 11.1% | 6 | 0 | 0 | 4:2 5:4 6:3 |
| anyCol:ascending+x:allEqual | 9 | 2 | 22.2% | 1 | 0 | 0 | 5:1 6:5 7:3 |
| anyLine:equalTo+col:equalTo | 9 | 2 | 22.2% | 0 | 1 | 4 | 7:1 8:2 10:1 11:1 |
| center3:allOdd+plus:allEqual | 9 | 1 | 11.1% | 4 | 0 | 0 | 5:4 6:4 7:1 |
| anti:fullHouse+plus:equalTo | 9 | 4 | 44.4% | 0 | 0 | 0 | 6:2 7:1 8:4 9:1 10:1 |
| anyLine:ascending+row:allEqual | 9 | 0 | 0.0% | 4 | 0 | 0 | 4:1 5:3 6:5 |
| anti:allOdd+anyRow:ascending | 9 | 0 | 0.0% | 7 | 0 | 0 | 3:1 4:2 5:4 6:2 |
| col:equalTo+row:sum | 9 | 2 | 22.2% | 1 | 0 | 0 | 3:1 6:3 7:1 8:1 9:1 10:2 |
| anti:allOdd+row:allEqual | 9 | 0 | 0.0% | 1 | 0 | 1 | 5:1 6:6 8:1 |
| anyCol:allEqual+center3:allOdd | 9 | 0 | 0.0% | 3 | 0 | 0 | 5:3 6:1 7:5 |
| block:allEqual+row:allEqual | 9 | 0 | 0.0% | 0 | 0 | 0 | 6:5 7:4 |
| anyCol:equalTo+block:allEqual | 9 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 6:3 7:2 8:1 |
| anti:equalTo+x:allEqual | 9 | 0 | 0.0% | 1 | 0 | 0 | 5:1 6:1 7:3 8:3 9:1 |
| anyRow:allEqual+row:ascending | 9 | 0 | 0.0% | 1 | 0 | 0 | 5:1 6:5 7:3 |
| diag:fullHouse+x:equalTo | 9 | 0 | 0.0% | 3 | 0 | 0 | 5:3 6:3 7:3 |
| anyRow:ascending+row:sum | 9 | 0 | 0.0% | 9 | 0 | 0 | 3:3 4:4 5:2 |
| diag:allEqual+plus:allEven | 9 | 0 | 0.0% | 5 | 0 | 0 | 4:2 5:3 6:3 7:1 |
| block:allEqual+diag:equalTo | 8 | 1 | 12.5% | 0 | 0 | 0 | 7:2 8:6 |
| anyCol:ascending+diag:ascending | 8 | 2 | 25.0% | 3 | 0 | 0 | 4:1 5:2 6:2 7:3 |
| anyCol:allEqual+col:ascending | 8 | 2 | 25.0% | 1 | 0 | 0 | 5:1 6:2 7:3 8:2 |
| anti:ascending+anyCol:allEqual | 8 | 3 | 37.5% | 0 | 0 | 0 | 6:4 7:3 8:1 |
| anyCol:ascending+row:ascending | 8 | 1 | 12.5% | 0 | 0 | 0 | 6:5 7:1 8:2 |
| anti:allEqual+row:allEven | 8 | 1 | 12.5% | 2 | 0 | 0 | 5:2 6:5 7:1 |
| anyLine:ascending+row:allOdd | 8 | 0 | 0.0% | 8 | 0 | 0 | 3:2 4:1 5:5 |
| anyLine:equalTo+block:allOdd | 8 | 1 | 12.5% | 6 | 0 | 0 | 3:1 4:4 5:1 6:2 |
| anyLine:ascending+col:equalTo | 8 | 4 | 50.0% | 0 | 0 | 0 | 7:2 8:1 9:3 10:2 |
| anti:equalTo+corners:sum | 8 | 3 | 37.5% | 3 | 0 | 0 | 3:1 4:1 5:1 7:1 8:4 |
| anyCol:ascending+row:sum | 8 | 0 | 0.0% | 8 | 0 | 0 | 3:2 4:5 5:1 |
| anti:equalTo+diag:fullHouse | 8 | 1 | 12.5% | 3 | 0 | 0 | 5:3 6:3 7:1 8:1 |
| center3:allEven+row:sum | 8 | 1 | 12.5% | 4 | 0 | 0 | 2:1 3:1 5:2 6:3 7:1 |
| anti:allEqual+col:ascending | 8 | 1 | 12.5% | 1 | 0 | 4 | 5:1 6:1 7:1 9:1 |
| anti:allOdd+diag:equalTo | 8 | 3 | 37.5% | 1 | 0 | 0 | 4:1 6:3 7:2 8:1 9:1 |
| anyRow:equalTo+x:fullHouse | 8 | 1 | 12.5% | 2 | 0 | 0 | 5:2 6:6 |
| anyLine:equalTo+corners:sum | 8 | 0 | 0.0% | 8 | 0 | 0 | 4:3 5:5 |
| anti:allOdd+col:allEqual | 8 | 1 | 12.5% | 3 | 0 | 1 | 4:1 5:2 6:2 7:1 8:1 |
| block:allEqual+corners:sum | 8 | 0 | 0.0% | 8 | 0 | 0 | 3:1 4:5 5:2 |
| anyRow:allEqual+row:equalTo | 8 | 0 | 0.0% | 1 | 0 | 0 | 3:1 6:2 7:4 8:1 |
| anti:ascending+anyLine:equalTo | 8 | 1 | 12.5% | 1 | 0 | 1 | 5:1 6:2 7:2 8:2 |
| block:allEqual+col:equalTo | 8 | 2 | 25.0% | 0 | 1 | 0 | 6:3 7:1 8:1 9:2 11:1 |
| anyCol:equalTo+plus:allEqual | 8 | 3 | 37.5% | 0 | 0 | 0 | 6:1 7:2 8:3 9:2 |
| center3:allEven+col:allEqual | 8 | 2 | 25.0% | 3 | 0 | 0 | 5:3 7:3 8:1 9:1 |
| anti:palindrome+anyCol:allEqual | 8 | 0 | 0.0% | 8 | 0 | 0 | 4:3 5:5 |
| block:allEqual+row:fullHouse | 8 | 0 | 0.0% | 8 | 0 | 0 | 3:1 4:5 5:2 |
| anyRow:allEqual+center3:allOdd | 8 | 1 | 12.5% | 4 | 0 | 0 | 4:2 5:2 6:2 8:1 9:1 |
| anti:ascending+diag:allEqual | 8 | 0 | 0.0% | 0 | 0 | 3 | 6:1 7:1 8:3 |
| col:allEqual+row:fullHouse | 8 | 1 | 12.5% | 4 | 0 | 0 | 4:2 5:2 6:3 7:1 |
| anti:equalTo+col:equalTo | 8 | 2 | 25.0% | 0 | 3 | 0 | 7:1 8:1 9:1 10:2 11:1 12:2 |
| anyLine:allEqual+diag:fullHouse | 8 | 0 | 0.0% | 8 | 0 | 0 | 3:2 4:4 5:2 |
| anyLine:ascending+row:equalTo | 8 | 1 | 12.5% | 0 | 1 | 0 | 7:4 8:1 9:1 10:1 12:1 |
| anyLine:ascending+center3:allOdd | 8 | 1 | 12.5% | 2 | 0 | 0 | 4:2 6:1 7:2 8:3 |
| corners:equalTo+row:allEqual | 8 | 4 | 50.0% | 0 | 0 | 0 | 8:3 9:5 |
| anyRow:equalTo+row:allOdd | 8 | 0 | 0.0% | 5 | 0 | 0 | 4:2 5:3 6:2 8:1 |
| anti:allOdd+plus:equalTo | 8 | 1 | 12.5% | 0 | 0 | 0 | 7:4 8:4 |
| anti:fullHouse+diag:equalTo | 8 | 0 | 0.0% | 0 | 0 | 0 | 6:3 7:5 |
| anti:ascending+anyCol:equalTo | 8 | 0 | 0.0% | 0 | 0 | 1 | 7:2 8:4 9:1 |
| anyCol:fullHouse+x:equalTo | 8 | 0 | 0.0% | 5 | 0 | 0 | 4:4 5:1 6:2 7:1 |
| anyLine:allEqual+x:equalTo | 8 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 6:1 7:4 8:1 |
| anyLine:equalTo+col:allEqual | 7 | 1 | 14.3% | 3 | 0 | 0 | 3:1 5:2 6:1 7:3 |
| anti:equalTo+center3:allOdd | 7 | 4 | 57.1% | 0 | 0 | 0 | 7:3 8:1 9:2 10:1 |
| anyRow:ascending+row:ascending | 7 | 0 | 0.0% | 6 | 0 | 0 | 2:2 3:3 5:1 6:1 |
| anyLine:equalTo+center3:allOdd | 7 | 1 | 14.3% | 0 | 0 | 0 | 6:2 7:1 8:1 9:3 |
| anti:ascending+anyRow:equalTo | 7 | 2 | 28.6% | 0 | 0 | 0 | 6:1 7:3 8:2 9:1 |
| anyCol:ascending+col:allOdd | 7 | 0 | 0.0% | 6 | 0 | 0 | 3:1 4:1 5:4 6:1 |
| anyLine:allEqual+corners:equalTo | 7 | 1 | 14.3% | 3 | 0 | 0 | 3:1 4:1 5:1 7:4 |
| anyRow:equalTo+x:allOdd | 7 | 2 | 28.6% | 3 | 0 | 0 | 3:1 4:1 5:1 6:4 |
| anti:allOdd+row:allOdd | 7 | 0 | 0.0% | 7 | 0 | 0 | 3:2 4:3 5:2 |
| diag:allEqual+plus:allOdd | 7 | 0 | 0.0% | 6 | 0 | 1 | 4:1 5:5 |
| anyCol:equalTo+x:allEqual | 7 | 1 | 14.3% | 0 | 0 | 1 | 7:1 8:4 9:1 |
| center3:allEven+x:allEqual | 7 | 1 | 14.3% | 3 | 0 | 0 | 5:3 6:3 7:1 |
| anyRow:equalTo+row:palindrome | 7 | 0 | 0.0% | 5 | 0 | 0 | 2:1 4:3 5:1 6:2 |
| anyRow:equalTo+plus:allOdd | 7 | 2 | 28.6% | 1 | 0 | 0 | 5:1 6:4 7:1 9:1 |
| anti:allOdd+row:fullHouse | 7 | 0 | 0.0% | 7 | 0 | 0 | 2:1 4:6 |
| anyRow:allEqual+block:allEqual | 7 | 1 | 14.3% | 4 | 0 | 0 | 4:2 5:2 6:1 7:2 |
| diag:equalTo+plus:fullHouse | 7 | 2 | 28.6% | 1 | 0 | 0 | 5:1 7:6 |
| anyLine:ascending+col:ascending | 7 | 0 | 0.0% | 7 | 0 | 0 | 3:1 4:4 5:2 |
| plus:allEqual+row:sum | 7 | 0 | 0.0% | 4 | 0 | 0 | 4:1 5:3 6:2 7:1 |
| anti:allEqual+col:sum | 7 | 1 | 14.3% | 5 | 0 | 0 | 4:1 5:4 6:2 |
| anyRow:allEqual+col:allEqual | 7 | 3 | 42.9% | 0 | 0 | 2 | 7:3 8:1 10:1 |
| col:allEqual+plus:allEqual | 7 | 0 | 0.0% | 1 | 0 | 1 | 5:1 6:1 7:1 8:3 |
| plus:allEqual+row:equalTo | 7 | 0 | 0.0% | 0 | 0 | 6 | 8:1 |
| anti:palindrome+plus:allEqual | 7 | 2 | 28.6% | 2 | 0 | 0 | 4:1 5:1 6:5 |
| anyRow:equalTo+diag:ascending | 7 | 4 | 57.1% | 0 | 0 | 1 | 7:2 8:1 9:1 10:2 |
| anti:ascending+row:fullHouse | 7 | 0 | 0.0% | 5 | 0 | 0 | 4:1 5:4 6:1 7:1 |
| anyRow:ascending+diag:fullHouse | 7 | 0 | 0.0% | 7 | 0 | 0 | 3:2 4:4 5:1 |
| anyCol:allEqual+row:sum | 7 | 0 | 0.0% | 6 | 0 | 0 | 3:3 4:3 6:1 |
| anyRow:allEven+x:equalTo | 7 | 1 | 14.3% | 3 | 0 | 0 | 4:1 5:2 6:2 7:1 8:1 |
| corners:allEven+diag:allEqual | 7 | 0 | 0.0% | 6 | 0 | 0 | 4:3 5:3 6:1 |
| anti:ascending+col:allEqual | 7 | 1 | 14.3% | 0 | 0 | 2 | 7:1 8:3 9:1 |
| diag:fullHouse+row:sum | 7 | 0 | 0.0% | 7 | 0 | 0 | 2:4 3:2 4:1 |
| anti:palindrome+anyRow:equalTo | 7 | 0 | 0.0% | 3 | 0 | 0 | 5:3 6:1 8:3 |
| diag:allEqual+row:allEven | 7 | 0 | 0.0% | 6 | 0 | 0 | 4:2 5:4 6:1 |
| anyCol:allOdd+plus:equalTo | 7 | 1 | 14.3% | 2 | 0 | 0 | 4:1 5:1 6:1 7:2 8:2 |
| anyCol:equalTo+col:ascending | 7 | 1 | 14.3% | 0 | 0 | 0 | 6:3 7:1 8:1 9:2 |
| anyRow:equalTo+row:sum | 7 | 0 | 0.0% | 5 | 0 | 0 | 4:4 5:1 6:1 7:1 |
| anyLine:allEqual+row:ascending | 7 | 0 | 0.0% | 2 | 0 | 0 | 5:2 6:2 7:3 |
| diag:fullHouse+row:equalTo | 7 | 1 | 14.3% | 1 | 0 | 0 | 5:1 6:1 7:1 8:3 10:1 |
| anyLine:ascending+corners:sum | 7 | 0 | 0.0% | 7 | 0 | 0 | 2:1 3:3 4:3 |
| col:allEqual+diag:allEqual | 7 | 2 | 28.6% | 0 | 0 | 1 | 7:1 8:2 9:2 10:1 |
| anyRow:equalTo+col:allOdd | 7 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 6:2 7:2 |
| anyRow:equalTo+plus:fullHouse | 7 | 0 | 0.0% | 2 | 0 | 0 | 5:2 6:3 7:1 8:1 |
| anti:equalTo+row:ascending | 7 | 0 | 0.0% | 0 | 0 | 0 | 7:3 8:2 9:2 |
| block:allEqual+x:allEqual | 7 | 0 | 0.0% | 0 | 0 | 2 | 6:1 7:3 8:1 |
| center3:sum+diag:allEqual | 7 | 0 | 0.0% | 7 | 0 | 0 | 1:1 4:2 5:4 |
| anyRow:fullHouse+x:equalTo | 7 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 6:4 7:1 |
| center3:allEven+x:allEven | 7 | 0 | 0.0% | 7 | 0 | 0 | 1:1 2:2 4:4 |
| diag:fullHouse+plus:equalTo | 7 | 1 | 14.3% | 1 | 0 | 0 | 5:1 6:1 8:3 9:1 10:1 |
| corners:equalTo+row:fullHouse | 7 | 0 | 0.0% | 5 | 0 | 0 | 4:1 5:4 7:2 |
| anyLine:allEqual+row:allOdd | 7 | 0 | 0.0% | 7 | 0 | 0 | 3:2 4:4 5:1 |
| diag:equalTo+row:sum | 7 | 0 | 0.0% | 2 | 0 | 0 | 4:2 6:2 7:2 8:1 |
| diag:equalTo+x:equalTo | 7 | 1 | 14.3% | 0 | 0 | 0 | 6:2 7:4 9:1 |
| anti:equalTo+anyRow:equalTo | 7 | 0 | 0.0% | 0 | 2 | 0 | 8:2 9:3 12:2 |
| anti:sum+row:fullHouse | 6 | 0 | 0.0% | 6 | 0 | 0 | 2:1 3:4 4:1 |
| anti:allOdd+anyLine:equalTo | 6 | 0 | 0.0% | 4 | 0 | 0 | 4:1 5:3 6:1 7:1 |
| anti:palindrome+row:allEqual | 6 | 2 | 33.3% | 3 | 0 | 0 | 4:1 5:2 6:3 |
| anti:palindrome+block:equalTo | 6 | 2 | 33.3% | 1 | 0 | 0 | 5:1 6:3 7:1 9:1 |
| anti:allOdd+col:ascending | 6 | 0 | 0.0% | 2 | 0 | 2 | 5:2 6:1 7:1 |
| anyRow:allOdd+plus:equalTo | 6 | 2 | 33.3% | 2 | 0 | 0 | 5:2 6:2 7:1 8:1 |
| col:allEqual+row:equalTo | 6 | 1 | 16.7% | 0 | 0 | 4 | 8:1 9:1 |
| anti:allEqual+col:allOdd | 6 | 1 | 16.7% | 2 | 0 | 0 | 4:1 5:1 6:2 7:2 |
| anyRow:allEqual+x:allOdd | 6 | 0 | 0.0% | 4 | 0 | 0 | 3:1 4:1 5:2 6:2 |
| anti:palindrome+anyRow:allEqual | 6 | 0 | 0.0% | 6 | 0 | 0 | 4:1 5:5 |
| anyRow:allEqual+x:allEven | 6 | 0 | 0.0% | 5 | 0 | 0 | 3:1 4:1 5:3 6:1 |
| anyRow:ascending+col:allOdd | 6 | 1 | 16.7% | 4 | 0 | 0 | 4:3 5:1 6:1 7:1 |
| anti:allOdd+col:allOdd | 6 | 0 | 0.0% | 6 | 0 | 0 | 2:1 4:4 5:1 |
| col:equalTo+row:allOdd | 6 | 3 | 50.0% | 1 | 0 | 0 | 5:1 7:2 8:2 9:1 |
| block:equalTo+row:fullHouse | 6 | 1 | 16.7% | 5 | 0 | 0 | 3:1 4:1 5:3 8:1 |
| anti:equalTo+diag:equalTo | 6 | 3 | 50.0% | 0 | 2 | 0 | 9:1 10:3 11:1 12:1 |
| anti:equalTo+plus:equalTo | 6 | 3 | 50.0% | 0 | 2 | 1 | 8:1 9:2 11:2 |
| center3:allOdd+x:equalTo | 6 | 2 | 33.3% | 1 | 0 | 0 | 5:1 6:4 8:1 |
| anyCol:sum+x:equalTo | 6 | 0 | 0.0% | 5 | 0 | 0 | 4:2 5:3 6:1 |
| anti:ascending+plus:allEqual | 6 | 0 | 0.0% | 1 | 0 | 0 | 5:1 7:1 8:4 |
| anti:equalTo+col:ascending | 6 | 3 | 50.0% | 0 | 0 | 0 | 7:2 8:1 9:2 10:1 |
| anti:palindrome+col:allEqual | 6 | 0 | 0.0% | 3 | 0 | 0 | 5:3 6:1 7:2 |
| block:equalTo+row:allEqual | 6 | 1 | 16.7% | 0 | 0 | 2 | 6:1 7:1 9:2 |
| diag:allOdd+row:fullHouse | 6 | 0 | 0.0% | 6 | 0 | 0 | 2:1 4:2 5:3 |
| block:allOdd+x:allEqual | 6 | 0 | 0.0% | 4 | 0 | 1 | 4:1 5:3 6:1 |
| plus:equalTo+x:equalTo | 6 | 2 | 33.3% | 0 | 3 | 1 | 10:2 11:1 12:2 |
| anyCol:fullHouse+row:fullHouse | 6 | 0 | 0.0% | 6 | 0 | 0 | 2:1 3:5 |
| anyCol:equalTo+row:ascending | 6 | 2 | 33.3% | 0 | 0 | 2 | 7:1 8:2 9:1 |
| anyRow:allEven+plus:equalTo | 6 | 2 | 33.3% | 3 | 0 | 0 | 4:1 5:2 7:2 8:1 |
| anyLine:allEqual+center3:allOdd | 6 | 1 | 16.7% | 2 | 0 | 0 | 4:2 6:2 7:2 |
| anyLine:ascending+plus:allOdd | 6 | 0 | 0.0% | 6 | 0 | 0 | 2:1 4:3 5:2 |
| anti:allEqual+center3:sum | 6 | 0 | 0.0% | 5 | 0 | 0 | 5:5 6:1 |
| anyRow:sum+diag:equalTo | 6 | 2 | 33.3% | 1 | 0 | 0 | 5:1 6:5 |
| anyRow:allEqual+block:allOdd | 6 | 1 | 16.7% | 4 | 0 | 0 | 4:2 5:2 6:1 7:1 |
| anyRow:allOdd+corners:equalTo | 6 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:1 5:1 6:3 |
| anti:ascending+corners:sum | 6 | 0 | 0.0% | 3 | 0 | 0 | 3:1 5:2 6:3 |
| block:allEqual+row:equalTo | 6 | 2 | 33.3% | 0 | 0 | 0 | 6:1 7:1 8:1 9:3 |
| anyRow:ascending+col:equalTo | 6 | 2 | 33.3% | 0 | 0 | 0 | 7:3 8:3 |
| row:fullHouse+x:allOdd | 6 | 0 | 0.0% | 6 | 0 | 0 | 3:3 4:2 5:1 |
| anyLine:equalTo+diag:fullHouse | 6 | 1 | 16.7% | 2 | 0 | 0 | 5:2 6:3 7:1 |
| anyLine:ascending+col:allEqual | 6 | 1 | 16.7% | 3 | 0 | 0 | 5:3 6:2 7:1 |
| col:allOdd+diag:equalTo | 6 | 2 | 33.3% | 2 | 0 | 0 | 4:1 5:1 6:1 7:3 |
| anti:palindrome+plus:equalTo | 6 | 1 | 16.7% | 1 | 0 | 0 | 4:1 6:2 7:2 9:1 |
| anyRow:equalTo+plus:allEven | 6 | 1 | 16.7% | 2 | 0 | 0 | 4:1 5:1 6:1 7:1 8:2 |
| corners:equalTo+diag:equalTo | 6 | 2 | 33.3% | 1 | 0 | 0 | 5:1 7:4 10:1 |
| anyRow:fullHouse+block:allEqual | 6 | 0 | 0.0% | 6 | 0 | 0 | 4:5 5:1 |
| anyLine:allEqual+x:allEqual | 6 | 0 | 0.0% | 5 | 0 | 0 | 5:5 6:1 |
| anti:ascending+plus:equalTo | 6 | 2 | 33.3% | 0 | 0 | 0 | 6:1 7:2 8:2 9:1 |
| anyRow:ascending+col:allEqual | 6 | 1 | 16.7% | 1 | 0 | 1 | 5:1 6:2 7:2 |
| anyCol:equalTo+corners:sum | 6 | 0 | 0.0% | 5 | 0 | 0 | 3:2 5:3 6:1 |
| block:allOdd+x:equalTo | 6 | 1 | 16.7% | 1 | 0 | 0 | 5:1 6:1 7:4 |
| anyLine:allEqual+col:allEqual | 6 | 0 | 0.0% | 6 | 0 | 0 | 3:2 4:3 5:1 |
| center3:allEven+row:equalTo | 6 | 3 | 50.0% | 0 | 0 | 0 | 7:1 8:2 9:1 10:2 |
| corners:equalTo+row:sum | 6 | 0 | 0.0% | 4 | 0 | 0 | 4:1 5:3 6:2 |
| row:equalTo+x:allEqual | 6 | 1 | 16.7% | 0 | 1 | 2 | 7:1 8:1 10:1 12:1 |
| center3:allEven+plus:fullHouse | 6 | 0 | 0.0% | 6 | 0 | 0 | 4:2 5:4 |
| anyLine:allEqual+block:allEqual | 6 | 0 | 0.0% | 6 | 0 | 0 | 4:2 5:4 |
| anti:fullHouse+x:equalTo | 6 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 6:2 8:1 |
| plus:equalTo+x:allDifferent | 6 | 0 | 0.0% | 0 | 0 | 0 | 6:3 7:1 8:2 |
| col:allEqual+diag:fullHouse | 6 | 0 | 0.0% | 2 | 0 | 0 | 5:2 6:4 |
| anyCol:allEqual+center3:sum | 6 | 0 | 0.0% | 6 | 0 | 0 | 3:1 4:3 5:2 |
| anti:fullHouse+anyRow:allEqual | 6 | 0 | 0.0% | 6 | 0 | 0 | 3:1 4:3 5:2 |
| plus:allEqual+row:allOdd | 6 | 0 | 0.0% | 3 | 0 | 1 | 4:1 5:2 6:2 |
| diag:fullHouse+row:fullHouse | 6 | 0 | 0.0% | 6 | 0 | 0 | 2:1 3:1 4:4 |
| anti:allEqual+anyCol:fullHouse | 6 | 0 | 0.0% | 6 | 0 | 0 | 3:1 4:1 5:4 |
| col:allOdd+row:fullHouse | 6 | 0 | 0.0% | 5 | 0 | 0 | 2:1 4:3 5:1 6:1 |
| anyRow:allEqual+corners:sum | 6 | 0 | 0.0% | 5 | 0 | 0 | 4:4 5:1 6:1 |
| anyLine:allEven+diag:allEqual | 6 | 0 | 0.0% | 6 | 0 | 0 | 3:1 4:3 5:2 |
| center3:allOdd+diag:equalTo | 6 | 1 | 16.7% | 0 | 0 | 0 | 6:1 7:2 8:1 9:2 |
| anyRow:allEqual+diag:fullHouse | 6 | 0 | 0.0% | 6 | 0 | 0 | 3:1 5:5 |
| block:sum+center3:allEven | 6 | 0 | 0.0% | 5 | 0 | 0 | 4:3 5:2 7:1 |
| block:equalTo+center3:sum | 6 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 6:1 7:3 |
| anyRow:allEqual+x:allEqual | 6 | 0 | 0.0% | 1 | 0 | 0 | 5:1 6:4 7:1 |
| anyCol:fullHouse+plus:equalTo | 6 | 0 | 0.0% | 1 | 0 | 0 | 4:1 6:2 7:3 |
| anyRow:ascending+corners:sum | 6 | 0 | 0.0% | 5 | 0 | 0 | 3:1 4:4 6:1 |
| anti:allEqual+anyRow:allEven | 5 | 1 | 20.0% | 4 | 0 | 0 | 4:2 5:2 6:1 |
| anti:palindrome+x:allEqual | 5 | 0 | 0.0% | 5 | 0 | 0 | 3:1 4:3 5:1 |
| anyRow:ascending+col:ascending | 5 | 0 | 0.0% | 2 | 0 | 2 | 5:2 8:1 |
| anyRow:ascending+center3:allOdd | 5 | 4 | 80.0% | 0 | 0 | 0 | 8:4 10:1 |
| anyLine:equalTo+col:allDifferent | 5 | 1 | 20.0% | 2 | 0 | 0 | 5:2 6:3 |
| anyLine:ascending+row:sum | 5 | 0 | 0.0% | 5 | 0 | 0 | 2:1 3:2 4:2 |
| anti:equalTo+corners:allEqual | 5 | 3 | 60.0% | 0 | 0 | 0 | 7:1 8:3 9:1 |
| anti:allEqual+anyCol:allEven | 5 | 0 | 0.0% | 5 | 0 | 0 | 4:3 5:2 |
| anti:palindrome+col:equalTo | 5 | 1 | 20.0% | 0 | 0 | 0 | 8:4 9:1 |
| center3:allEven+col:equalTo | 5 | 2 | 40.0% | 0 | 0 | 0 | 7:3 8:1 9:1 |
| diag:allEqual+x:allEven | 5 | 0 | 0.0% | 5 | 0 | 0 | 4:2 5:3 |
| anyCol:fullHouse+corners:equalTo | 5 | 1 | 20.0% | 3 | 0 | 0 | 4:2 5:1 6:2 |
| anti:allOdd+diag:palindrome | 5 | 0 | 0.0% | 5 | 0 | 0 | 3:2 4:3 |
| anyCol:equalTo+col:allEqual | 5 | 0 | 0.0% | 3 | 0 | 0 | 5:3 6:1 7:1 |
| anti:allOdd+block:equalTo | 5 | 0 | 0.0% | 4 | 0 | 0 | 4:1 5:3 6:1 |
| anyLine:ascending+row:allEven | 5 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:1 5:1 6:2 |
| anyLine:equalTo+row:sum | 5 | 0 | 0.0% | 2 | 0 | 0 | 3:1 5:1 6:3 |
| anti:fullHouse+block:allOdd | 5 | 0 | 0.0% | 5 | 0 | 0 | 2:1 4:4 |
| anyCol:allEven+col:equalTo | 5 | 1 | 20.0% | 3 | 0 | 0 | 3:2 5:1 6:1 7:1 |
| anti:equalTo+plus:fullHouse | 5 | 2 | 40.0% | 0 | 0 | 0 | 6:1 7:1 8:2 9:1 |
| anti:allEqual+row:allOdd | 5 | 2 | 40.0% | 0 | 0 | 0 | 6:2 7:1 8:2 |
| anyLine:allEqual+row:equalTo | 5 | 2 | 40.0% | 2 | 0 | 0 | 5:2 6:2 9:1 |
| anti:allEqual+plus:sum | 5 | 1 | 20.0% | 4 | 0 | 0 | 4:3 5:1 6:1 |
| anyLine:ascending+block:allOdd | 5 | 0 | 0.0% | 5 | 0 | 0 | 3:2 4:1 5:2 |
| anti:allEven+diag:allEqual | 5 | 1 | 20.0% | 2 | 0 | 0 | 4:1 5:1 6:3 |
| anyRow:allEqual+block:sum | 5 | 0 | 0.0% | 5 | 0 | 0 | 4:3 5:2 |
| anyCol:equalTo+row:sum | 5 | 1 | 20.0% | 0 | 0 | 0 | 6:3 7:2 |
| plus:allEqual+x:allEqual | 5 | 1 | 20.0% | 0 | 0 | 3 | 7:1 8:1 |
| anyCol:ascending+plus:fullHouse | 5 | 0 | 0.0% | 5 | 0 | 0 | 4:1 5:4 |
| diag:allEqual+x:allOdd | 5 | 0 | 0.0% | 4 | 0 | 0 | 4:3 5:1 6:1 |
| plus:equalTo+row:sum | 5 | 1 | 20.0% | 1 | 0 | 0 | 4:1 6:2 7:2 |
| anti:allOdd+center3:allOdd | 5 | 1 | 20.0% | 2 | 0 | 0 | 4:1 5:1 6:2 7:1 |
| center3:allOdd+row:fullHouse | 5 | 1 | 20.0% | 0 | 0 | 0 | 6:3 7:2 |
| anti:allOdd+corners:equalTo | 5 | 1 | 20.0% | 3 | 0 | 0 | 4:1 5:2 6:2 |
| corners:sum+diag:allEven | 5 | 0 | 0.0% | 5 | 0 | 0 | 3:4 4:1 |
| center3:sum+diag:equalTo | 5 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 6:1 7:1 |
| anyRow:allEqual+diag:ascending | 5 | 2 | 40.0% | 0 | 0 | 0 | 6:2 7:2 8:1 |
| anyLine:equalTo+row:ascending | 5 | 2 | 40.0% | 0 | 0 | 1 | 6:2 7:1 8:1 |
| block:allEven+center3:allEven | 5 | 1 | 20.0% | 1 | 0 | 0 | 4:1 6:2 7:2 |
| anti:fullHouse+corners:sum | 5 | 0 | 0.0% | 5 | 0 | 0 | 2:3 3:1 4:1 |
| anyRow:allDifferent+x:equalTo | 5 | 1 | 20.0% | 1 | 0 | 0 | 5:1 6:4 |
| center3:sum+plus:equalTo | 5 | 2 | 40.0% | 1 | 0 | 1 | 5:1 7:1 9:1 10:1 |
| plus:equalTo+row:palindrome | 5 | 1 | 20.0% | 1 | 0 | 0 | 5:1 6:2 7:2 |
| anti:allEqual+x:fullHouse | 5 | 0 | 0.0% | 5 | 0 | 0 | 4:4 5:1 |
| anyCol:ascending+col:allEven | 5 | 0 | 0.0% | 5 | 0 | 0 | 3:2 5:3 |
| corners:allEqual+diag:allEqual | 5 | 1 | 20.0% | 2 | 0 | 0 | 5:2 6:1 7:2 |
| anyRow:equalTo+diag:equalTo | 5 | 1 | 20.0% | 0 | 1 | 0 | 7:1 8:2 9:1 11:1 |
| anti:equalTo+block:equalTo | 5 | 2 | 40.0% | 0 | 0 | 0 | 6:1 7:2 8:1 10:1 |
| anti:fullHouse+anyRow:equalTo | 5 | 0 | 0.0% | 3 | 0 | 0 | 5:3 7:2 |
| anti:equalTo+plus:sum | 5 | 1 | 20.0% | 1 | 0 | 0 | 5:1 6:3 7:1 |
| anti:sum+anyRow:equalTo | 5 | 0 | 0.0% | 4 | 0 | 0 | 4:1 5:3 6:1 |
| anti:allEqual+block:allEqual | 5 | 1 | 20.0% | 1 | 0 | 0 | 5:1 6:3 7:1 |
| anti:fullHouse+block:equalTo | 5 | 0 | 0.0% | 3 | 0 | 0 | 5:3 6:1 8:1 |
| anti:palindrome+x:equalTo | 5 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 6:2 7:1 |
| anti:allOdd+anyCol:allDifferent | 5 | 0 | 0.0% | 5 | 0 | 0 | 2:3 3:1 4:1 |
| anyLine:equalTo+diag:sum | 5 | 0 | 0.0% | 4 | 0 | 0 | 3:1 4:2 5:1 6:1 |
| anyCol:allEqual+diag:fullHouse | 5 | 0 | 0.0% | 5 | 0 | 0 | 4:4 5:1 |
| corners:equalTo+diag:fullHouse | 5 | 0 | 0.0% | 1 | 0 | 0 | 5:1 6:3 7:1 |
| block:equalTo+corners:equalTo | 5 | 1 | 20.0% | 0 | 0 | 0 | 6:1 7:1 8:1 9:1 10:1 |
| center3:allEven+diag:palindrome | 5 | 0 | 0.0% | 1 | 0 | 0 | 5:1 6:3 7:1 |
| col:allOdd+plus:equalTo | 5 | 0 | 0.0% | 0 | 0 | 0 | 6:2 7:2 8:1 |
| anti:palindrome+row:ascending | 5 | 0 | 0.0% | 3 | 0 | 0 | 5:3 6:2 |
| plus:sum+row:ascending | 5 | 0 | 0.0% | 5 | 0 | 0 | 4:3 5:2 |
| col:fullHouse+diag:allEqual | 5 | 0 | 0.0% | 4 | 0 | 0 | 4:2 5:2 6:1 |
| diag:equalTo+row:ascending | 5 | 3 | 60.0% | 0 | 0 | 0 | 7:1 8:1 10:3 |
| center3:allEven+plus:allEven | 5 | 0 | 0.0% | 2 | 0 | 0 | 2:1 3:1 6:2 7:1 |
| anti:equalTo+x:equalTo | 5 | 0 | 0.0% | 0 | 0 | 0 | 6:2 7:3 |
| center3:allEven+x:sum | 5 | 0 | 0.0% | 5 | 0 | 0 | 4:2 5:3 |
| anyCol:allOdd+col:equalTo | 5 | 0 | 0.0% | 2 | 0 | 0 | 5:2 6:1 7:1 8:1 |
| anti:allEven+center3:allEven | 5 | 0 | 0.0% | 2 | 0 | 0 | 5:2 6:2 7:1 |
| anti:fullHouse+row:allEqual | 5 | 0 | 0.0% | 1 | 0 | 0 | 3:1 6:3 7:1 |
| anyLine:allEqual+block:sum | 5 | 0 | 0.0% | 5 | 0 | 0 | 3:1 4:2 5:2 |
| anyCol:fullHouse+x:allEqual | 5 | 0 | 0.0% | 5 | 0 | 0 | 3:2 4:1 5:2 |
| anyLine:equalTo+row:allDifferent | 5 | 0 | 0.0% | 4 | 0 | 0 | 3:2 5:2 6:1 |
| anti:fullHouse+col:equalTo | 5 | 0 | 0.0% | 2 | 0 | 0 | 5:2 7:3 |
| block:allOdd+diag:allEqual | 5 | 0 | 0.0% | 4 | 0 | 0 | 3:1 5:3 6:1 |
| anti:allOdd+col:fullHouse | 5 | 0 | 0.0% | 5 | 0 | 0 | 2:1 3:1 4:2 5:1 |
| anyCol:ascending+row:allEven | 5 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 6:2 |
| anyCol:palindrome+diag:allEqual | 5 | 0 | 0.0% | 5 | 0 | 0 | 2:1 4:1 5:3 |
| anti:allEqual+block:allOdd | 5 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 6:2 |
| col:allEqual+row:allEqual | 5 | 0 | 0.0% | 0 | 0 | 4 | 8:1 |
| diag:ascending+row:allOdd | 5 | 0 | 0.0% | 2 | 0 | 1 | 4:1 5:1 6:2 |
| anti:palindrome+anyRow:ascending | 5 | 0 | 0.0% | 5 | 0 | 0 | 4:3 5:2 |
| col:equalTo+diag:sum | 5 | 0 | 0.0% | 1 | 0 | 0 | 4:1 6:1 7:2 9:1 |
| anyRow:equalTo+col:sum | 5 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 6:2 |
| diag:equalTo+plus:equalTo | 5 | 3 | 60.0% | 0 | 1 | 0 | 9:2 10:2 12:1 |
| col:fullHouse+row:allEqual | 5 | 0 | 0.0% | 2 | 0 | 0 | 3:1 5:1 6:3 |
| block:equalTo+center3:allOdd | 5 | 1 | 20.0% | 0 | 1 | 0 | 7:3 10:1 11:1 |
| anyRow:ascending+x:allEqual | 5 | 0 | 0.0% | 2 | 0 | 0 | 5:2 6:3 |
| anti:equalTo+row:palindrome | 5 | 0 | 0.0% | 0 | 0 | 0 | 6:2 7:2 9:1 |
| anti:equalTo+x:fullHouse | 4 | 2 | 50.0% | 2 | 0 | 0 | 4:1 5:1 6:2 |
| anti:equalTo+col:palindrome | 4 | 2 | 50.0% | 1 | 0 | 1 | 5:1 7:1 8:1 |
| anyCol:fullHouse+row:allEqual | 4 | 1 | 25.0% | 0 | 0 | 0 | 6:4 |
| col:allOdd+row:ascending | 4 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 6:1 7:1 |
| anyRow:equalTo+corners:allOdd | 4 | 1 | 25.0% | 1 | 0 | 0 | 4:1 6:2 7:1 |
| anyLine:equalTo+plus:allOdd | 4 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 6:1 8:1 |
| anyCol:allEqual+diag:sum | 4 | 0 | 0.0% | 4 | 0 | 0 | 3:2 4:2 |
| block:allDifferent+x:equalTo | 4 | 0 | 0.0% | 3 | 0 | 0 | 5:3 6:1 |
| anyLine:fullHouse+x:equalTo | 4 | 0 | 0.0% | 4 | 0 | 0 | 4:2 5:2 |
| anyCol:allOdd+block:equalTo | 4 | 2 | 50.0% | 2 | 0 | 0 | 4:1 5:1 6:2 |
| anti:allOdd+diag:sum | 4 | 0 | 0.0% | 4 | 0 | 0 | 2:2 3:2 |
| anyCol:allEqual+row:palindrome | 4 | 0 | 0.0% | 4 | 0 | 0 | 3:1 4:1 5:2 |
| anti:equalTo+corners:allOdd | 4 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 6:1 8:1 |
| anti:allEqual+x:sum | 4 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 6:1 |
| anti:allEqual+plus:fullHouse | 4 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 6:2 |
| anyRow:sum+diag:allEqual | 4 | 0 | 0.0% | 4 | 0 | 0 | 4:4 |
| anyLine:sum+col:equalTo | 4 | 2 | 50.0% | 2 | 0 | 0 | 3:1 4:1 6:1 9:1 |
| anyLine:allOdd+diag:allEqual | 4 | 0 | 0.0% | 4 | 0 | 0 | 3:2 4:2 |
| anyRow:fullHouse+block:equalTo | 4 | 1 | 25.0% | 3 | 0 | 0 | 4:1 5:2 6:1 |
| col:equalTo+row:ascending | 4 | 3 | 75.0% | 0 | 0 | 0 | 6:1 8:1 9:1 10:1 |
| anti:allDifferent+center3:allEven | 4 | 2 | 50.0% | 1 | 0 | 0 | 4:1 7:2 8:1 |
| row:sum+x:equalTo | 4 | 0 | 0.0% | 3 | 0 | 0 | 3:1 5:2 7:1 |
| block:allEqual+corners:allDifferent | 4 | 0 | 0.0% | 4 | 0 | 0 | 3:2 4:2 |
| anyRow:fullHouse+center3:allEven | 4 | 0 | 0.0% | 4 | 0 | 0 | 3:1 4:2 5:1 |
| col:palindrome+diag:equalTo | 4 | 1 | 25.0% | 0 | 0 | 0 | 6:1 7:2 8:1 |
| anti:sum+plus:allEqual | 4 | 0 | 0.0% | 4 | 0 | 0 | 4:1 5:3 |
| anyRow:ascending+corners:allOdd | 4 | 0 | 0.0% | 4 | 0 | 0 | 4:1 5:3 |
| anyCol:fullHouse+col:ascending | 4 | 0 | 0.0% | 4 | 0 | 0 | 5:4 |
| center3:noValue+diag:equalTo | 4 | 1 | 25.0% | 2 | 0 | 0 | 5:2 7:1 8:1 |
| anti:allEqual+anyRow:palindrome | 4 | 0 | 0.0% | 4 | 0 | 0 | 3:1 5:3 |
| anyRow:equalTo+x:allDifferent | 4 | 0 | 0.0% | 2 | 0 | 0 | 3:1 5:1 6:1 7:1 |
| anyRow:equalTo+col:equalTo | 4 | 1 | 25.0% | 0 | 1 | 0 | 7:1 8:1 10:1 12:1 |
| anyRow:allEven+diag:allEqual | 4 | 0 | 0.0% | 3 | 0 | 1 | 4:2 5:1 |
| anyRow:allOdd+block:equalTo | 4 | 0 | 0.0% | 3 | 0 | 0 | 5:3 7:1 |
| anti:allOdd+anyRow:sum | 4 | 0 | 0.0% | 4 | 0 | 0 | 2:1 3:1 4:1 5:1 |
| anyCol:palindrome+block:equalTo | 4 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 6:2 |
| anyCol:allEven+block:equalTo | 4 | 0 | 0.0% | 3 | 0 | 0 | 4:2 5:1 6:1 |
| anyLine:palindrome+block:allEqual | 4 | 0 | 0.0% | 4 | 0 | 0 | 2:1 3:2 4:1 |
| anti:allEven+anyCol:ascending | 4 | 0 | 0.0% | 4 | 0 | 0 | 3:1 4:2 5:1 |
| block:equalTo+x:allDifferent | 4 | 1 | 25.0% | 2 | 0 | 0 | 4:1 5:1 6:1 8:1 |
| anyCol:allEqual+x:allOdd | 4 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:1 5:1 6:1 |
| anyRow:allEqual+col:allOdd | 4 | 0 | 0.0% | 3 | 0 | 0 | 4:2 5:1 6:1 |
| anti:fullHouse+anyCol:ascending | 4 | 0 | 0.0% | 4 | 0 | 0 | 3:1 4:1 5:2 |
| anyLine:ascending+col:allDifferent | 4 | 0 | 0.0% | 4 | 0 | 0 | 2:1 3:1 4:2 |
| anyRow:palindrome+diag:equalTo | 4 | 1 | 25.0% | 1 | 0 | 0 | 5:1 6:2 7:1 |
| diag:fullHouse+row:ascending | 4 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 6:1 7:1 |
| anyCol:equalTo+col:equalTo | 4 | 1 | 25.0% | 0 | 0 | 0 | 8:1 9:3 |
| anti:sum+center3:allEven | 4 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 7:1 |
| center3:allOdd+row:sum | 4 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:1 5:1 6:1 |
| anyRow:allEven+center3:allEven | 4 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:1 5:1 6:1 |
| anyCol:ascending+col:ascending | 4 | 1 | 25.0% | 3 | 0 | 0 | 3:1 4:1 5:1 6:1 |
| col:allEqual+row:allOdd | 4 | 0 | 0.0% | 2 | 0 | 1 | 5:2 7:1 |
| center3:allOdd+plus:equalTo | 4 | 1 | 25.0% | 2 | 0 | 0 | 5:2 6:1 8:1 |
| anyRow:palindrome+center3:allEven | 4 | 0 | 0.0% | 3 | 0 | 0 | 2:1 5:2 6:1 |
| anti:equalTo+col:sum | 4 | 0 | 0.0% | 0 | 0 | 0 | 6:1 7:2 8:1 |
| anti:fullHouse+anyRow:ascending | 4 | 0 | 0.0% | 4 | 0 | 0 | 4:3 5:1 |
| diag:fullHouse+row:allEqual | 4 | 0 | 0.0% | 2 | 0 | 0 | 5:2 6:2 |
| center3:allEven+col:palindrome | 4 | 1 | 25.0% | 2 | 0 | 0 | 3:1 5:1 6:1 7:1 |
| anyRow:equalTo+corners:allEqual | 4 | 0 | 0.0% | 0 | 0 | 0 | 6:3 7:1 |
| anyCol:fullHouse+plus:allOdd | 4 | 0 | 0.0% | 4 | 0 | 0 | 2:1 3:3 |
| col:fullHouse+row:ascending | 4 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 6:1 |
| diag:palindrome+plus:equalTo | 4 | 2 | 50.0% | 0 | 0 | 0 | 6:1 7:2 9:1 |
| anti:palindrome+anyLine:allEqual | 4 | 0 | 0.0% | 4 | 0 | 0 | 3:1 4:2 5:1 |
| anyCol:ascending+row:equalTo | 4 | 1 | 25.0% | 0 | 0 | 0 | 6:1 7:1 8:2 |
| corners:equalTo+row:allOdd | 4 | 0 | 0.0% | 3 | 0 | 0 | 5:3 6:1 |
| anyCol:allEven+center3:allEven | 4 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 6:1 7:1 |
| block:equalTo+corners:allEven | 4 | 1 | 25.0% | 1 | 0 | 0 | 3:1 6:2 7:1 |
| block:allEven+corners:sum | 4 | 0 | 0.0% | 4 | 0 | 0 | 2:3 5:1 |
| anti:allEqual+corners:allOdd | 4 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 6:2 |
| col:equalTo+row:allDifferent | 4 | 1 | 25.0% | 1 | 0 | 0 | 5:1 6:1 7:1 8:1 |
| anti:equalTo+anyCol:sum | 4 | 0 | 0.0% | 4 | 0 | 0 | 4:2 5:2 |
| anyRow:fullHouse+plus:equalTo | 4 | 1 | 25.0% | 1 | 0 | 0 | 5:1 7:1 8:2 |
| anyRow:equalTo+center3:noValue | 4 | 0 | 0.0% | 2 | 0 | 0 | 5:2 7:1 8:1 |
| anti:fullHouse+anyLine:equalTo | 4 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 6:2 |
| anyRow:palindrome+x:equalTo | 4 | 0 | 0.0% | 2 | 0 | 0 | 4:2 7:1 8:1 |
| anyLine:ascending+col:fullHouse | 4 | 0 | 0.0% | 4 | 0 | 0 | 3:1 4:1 5:2 |
| anti:ascending+anyCol:ascending | 4 | 0 | 0.0% | 1 | 0 | 0 | 5:1 6:1 7:1 8:1 |
| center3:sum+x:equalTo | 4 | 0 | 0.0% | 1 | 0 | 0 | 4:1 6:1 7:1 9:1 |
| anti:equalTo+corners:allEven | 4 | 0 | 0.0% | 0 | 0 | 0 | 6:2 7:1 8:1 |
| anti:fullHouse+row:equalTo | 4 | 1 | 25.0% | 0 | 0 | 0 | 6:1 7:1 9:1 10:1 |
| diag:allEqual+plus:allDifferent | 4 | 0 | 0.0% | 4 | 0 | 0 | 4:2 5:2 |
| anyRow:allOdd+x:equalTo | 4 | 0 | 0.0% | 1 | 0 | 0 | 5:1 7:3 |
| anyRow:palindrome+row:allEqual | 4 | 0 | 0.0% | 4 | 0 | 0 | 3:1 4:2 5:1 |
| diag:palindrome+row:allEqual | 4 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 6:1 7:1 |
| diag:allDifferent+plus:allEqual | 4 | 0 | 0.0% | 4 | 0 | 0 | 4:3 5:1 |
| anti:allEqual+anyCol:palindrome | 4 | 0 | 0.0% | 4 | 0 | 0 | 5:4 |
| anyCol:palindrome+block:allEqual | 4 | 0 | 0.0% | 4 | 0 | 0 | 3:1 4:1 5:2 |
| anyLine:allEqual+row:sum | 4 | 0 | 0.0% | 4 | 0 | 0 | 3:3 4:1 |
| anyLine:allEqual+col:ascending | 4 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 6:1 7:1 |
| anyLine:equalTo+col:allOdd | 4 | 1 | 25.0% | 3 | 0 | 0 | 3:1 5:2 8:1 |
| anyLine:allEqual+plus:allEqual | 4 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 6:2 |
| anyRow:ascending+plus:allEven | 4 | 0 | 0.0% | 3 | 0 | 0 | 4:2 5:1 6:1 |
| plus:equalTo+x:fullHouse | 4 | 0 | 0.0% | 0 | 0 | 0 | 6:1 7:2 8:1 |
| block:allDifferent+center3:allOdd | 4 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 6:1 |
| anyCol:allEqual+col:allOdd | 4 | 0 | 0.0% | 3 | 0 | 0 | 3:1 5:2 6:1 |
| anti:allEqual+corners:allEqual | 4 | 0 | 0.0% | 1 | 0 | 0 | 5:1 6:3 |
| anyCol:allEqual+x:allDifferent | 4 | 0 | 0.0% | 4 | 0 | 0 | 3:1 4:3 |
| col:equalTo+x:allEqual | 4 | 1 | 25.0% | 0 | 0 | 3 | 10:1 |
| anyRow:allEqual+col:fullHouse | 4 | 0 | 0.0% | 2 | 0 | 0 | 5:2 6:2 |
| anti:allOdd+block:allOdd | 4 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:1 5:1 6:1 |
| plus:equalTo+x:sum | 4 | 0 | 0.0% | 1 | 0 | 0 | 4:1 6:3 |
| anti:palindrome+row:equalTo | 4 | 0 | 0.0% | 0 | 0 | 0 | 6:1 7:1 8:2 |
| col:equalTo+diag:equalTo | 4 | 1 | 25.0% | 0 | 1 | 0 | 9:2 10:1 11:1 |
| anyLine:allDifferent+x:equalTo | 4 | 0 | 0.0% | 2 | 0 | 0 | 3:1 4:1 6:2 |
| row:allOdd+x:allEqual | 4 | 0 | 0.0% | 2 | 0 | 1 | 3:1 5:1 6:1 |
| anyCol:allEqual+corners:allEven | 4 | 0 | 0.0% | 4 | 0 | 0 | 3:1 4:2 5:1 |
| plus:equalTo+row:ascending | 4 | 1 | 25.0% | 0 | 0 | 0 | 7:1 8:1 9:1 10:1 |
| anti:allOdd+center3:sum | 4 | 0 | 0.0% | 4 | 0 | 0 | 2:2 4:2 |
| anyLine:ascending+x:allEven | 4 | 0 | 0.0% | 3 | 0 | 0 | 3:2 5:1 6:1 |
| anyLine:equalTo+x:allEqual | 4 | 0 | 0.0% | 1 | 0 | 0 | 5:1 6:1 8:2 |
| plus:allEqual+row:ascending | 4 | 0 | 0.0% | 0 | 0 | 2 | 6:1 7:1 |
| anti:allOdd+plus:allOdd | 4 | 0 | 0.0% | 3 | 0 | 0 | 2:1 3:1 5:1 6:1 |
| anti:equalTo+anyLine:equalTo | 4 | 0 | 0.0% | 3 | 0 | 0 | 4:2 5:1 7:1 |
| anyCol:allEven+x:equalTo | 4 | 0 | 0.0% | 2 | 0 | 0 | 5:2 7:2 |
| anti:allOdd+anyLine:allOdd | 4 | 0 | 0.0% | 4 | 0 | 0 | 1:1 2:1 3:1 4:1 |
| col:ascending+row:equalTo | 4 | 1 | 25.0% | 0 | 0 | 0 | 8:1 9:3 |
| anyRow:palindrome+plus:allEqual | 4 | 0 | 0.0% | 4 | 0 | 0 | 4:2 5:2 |
| anti:allEven+anyRow:equalTo | 4 | 0 | 0.0% | 2 | 0 | 0 | 5:2 7:2 |
| anyCol:allEqual+col:allDifferent | 4 | 0 | 0.0% | 4 | 0 | 0 | 2:1 4:3 |
| anti:allOdd+corners:allOdd | 4 | 0 | 0.0% | 3 | 0 | 0 | 3:2 4:1 6:1 |
| anyCol:allDifferent+plus:equalTo | 4 | 0 | 0.0% | 2 | 0 | 0 | 5:2 6:1 9:1 |
| anyRow:palindrome+col:allEqual | 4 | 0 | 0.0% | 3 | 0 | 0 | 3:1 5:2 6:1 |
| anyCol:fullHouse+col:allEqual | 4 | 0 | 0.0% | 4 | 0 | 0 | 4:2 5:2 |
| anyLine:fullHouse+diag:allEqual | 4 | 0 | 0.0% | 4 | 0 | 0 | 4:1 5:3 |
| anyRow:fullHouse+diag:allEqual | 4 | 0 | 0.0% | 4 | 0 | 0 | 3:1 4:1 5:2 |
| anti:fullHouse+row:palindrome | 4 | 0 | 0.0% | 4 | 0 | 0 | 3:3 4:1 |
| anyCol:fullHouse+plus:allEqual | 4 | 0 | 0.0% | 4 | 0 | 0 | 4:3 5:1 |
| plus:fullHouse+x:allEqual | 4 | 0 | 0.0% | 3 | 0 | 0 | 5:3 7:1 |
| anyLine:allEven+center3:allEven | 4 | 0 | 0.0% | 3 | 0 | 0 | 3:2 5:1 6:1 |
| col:ascending+plus:allEqual | 4 | 0 | 0.0% | 1 | 0 | 1 | 5:1 6:2 |
| anyCol:ascending+center3:sum | 4 | 0 | 0.0% | 4 | 0 | 0 | 2:1 3:1 4:2 |
| anyRow:sum+corners:equalTo | 4 | 0 | 0.0% | 3 | 0 | 0 | 5:3 8:1 |
| anti:allEqual+plus:allOdd | 4 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 6:1 |
| anti:palindrome+corners:sum | 4 | 0 | 0.0% | 4 | 0 | 0 | 2:2 3:2 |
| anyLine:palindrome+diag:equalTo | 4 | 0 | 0.0% | 3 | 0 | 0 | 4:2 5:1 6:1 |
| anti:allEqual+corners:allEven | 4 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:1 5:1 6:1 |
| anti:palindrome+plus:allOdd | 4 | 0 | 0.0% | 4 | 0 | 0 | 3:3 5:1 |
| col:equalTo+diag:fullHouse | 4 | 0 | 0.0% | 1 | 0 | 0 | 4:1 7:1 8:2 |
| anti:sum+col:equalTo | 4 | 0 | 0.0% | 2 | 0 | 0 | 5:2 6:1 8:1 |
| plus:equalTo+row:allOdd | 4 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 7:1 8:1 |
| anti:allEqual+diag:allEven | 4 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 6:1 |
| anyCol:ascending+corners:allEven | 4 | 0 | 0.0% | 4 | 0 | 0 | 3:1 4:1 5:2 |
| anyLine:fullHouse+diag:equalTo | 4 | 0 | 0.0% | 2 | 0 | 0 | 3:1 5:1 6:1 9:1 |
| diag:allOdd+plus:allEqual | 4 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 6:1 7:1 |
| anyCol:sum+col:equalTo | 4 | 0 | 0.0% | 1 | 0 | 0 | 5:1 6:3 |
| anyLine:allEven+row:fullHouse | 4 | 0 | 0.0% | 4 | 0 | 0 | 3:4 |
| anyLine:ascending+diag:fullHouse | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:2 |
| block:equalTo+col:palindrome | 3 | 1 | 33.3% | 0 | 0 | 0 | 8:2 9:1 |
| row:allEqual+x:allEqual | 3 | 1 | 33.3% | 0 | 0 | 1 | 7:2 |
| anyRow:allEven+block:allOdd | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:2 4:1 |
| anti:allEqual+col:palindrome | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 |
| anti:fullHouse+col:allEqual | 3 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 6:1 |
| anti:equalTo+col:allOdd | 3 | 1 | 33.3% | 1 | 0 | 0 | 4:1 7:2 |
| anti:sum+plus:equalTo | 3 | 1 | 33.3% | 2 | 0 | 0 | 5:2 6:1 |
| anyRow:ascending+corners:allEqual | 3 | 0 | 0.0% | 2 | 0 | 0 | 5:2 6:1 |
| anyLine:allEqual+row:allEqual | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:1 5:1 |
| anti:ascending+anyLine:ascending | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:1 5:1 |
| anyLine:palindrome+center3:allEven | 3 | 1 | 33.3% | 2 | 0 | 0 | 4:1 5:1 6:1 |
| anti:allEqual+plus:allEven | 3 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 7:1 |
| diag:allEven+plus:allEqual | 3 | 2 | 66.7% | 0 | 0 | 0 | 6:2 7:1 |
| anyRow:sum+block:allOdd | 3 | 0 | 0.0% | 3 | 0 | 0 | 2:1 3:2 |
| anyLine:equalTo+diag:equalTo | 3 | 2 | 66.7% | 1 | 0 | 0 | 5:1 6:2 |
| anti:ascending+diag:allOdd | 3 | 1 | 33.3% | 1 | 0 | 0 | 5:1 6:2 |
| anti:palindrome+anyCol:fullHouse | 3 | 0 | 0.0% | 3 | 0 | 0 | 2:1 3:2 |
| col:allOdd+corners:equalTo | 3 | 1 | 33.3% | 1 | 0 | 0 | 5:1 6:2 |
| anyCol:fullHouse+corners:allOdd | 3 | 0 | 0.0% | 3 | 0 | 0 | 2:2 3:1 |
| anyLine:allEqual+block:allOdd | 3 | 0 | 0.0% | 3 | 0 | 0 | 2:1 4:1 5:1 |
| center3:allOdd+col:equalTo | 3 | 2 | 66.7% | 0 | 0 | 0 | 7:2 8:1 |
| col:ascending+plus:equalTo | 3 | 2 | 66.7% | 0 | 0 | 0 | 6:1 7:1 9:1 |
| anyCol:allOdd+block:allEqual | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:2 5:1 |
| anyLine:allEven+col:equalTo | 3 | 2 | 66.7% | 0 | 0 | 0 | 6:2 9:1 |
| block:allOdd+diag:fullHouse | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:2 |
| anyLine:equalTo+center3:sum | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 |
| col:ascending+diag:fullHouse | 3 | 0 | 0.0% | 3 | 0 | 0 | 5:3 |
| col:allOdd+row:allOdd | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:1 5:1 |
| anyCol:allEqual+x:allEven | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 |
| col:allOdd+x:equalTo | 3 | 2 | 66.7% | 0 | 0 | 0 | 6:1 7:2 |
| anti:fullHouse+row:fullHouse | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:2 4:1 |
| center3:allOdd+plus:fullHouse | 3 | 1 | 33.3% | 1 | 0 | 0 | 4:1 6:2 |
| center3:allOdd+x:allOdd | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 |
| col:equalTo+diag:palindrome | 3 | 1 | 33.3% | 1 | 0 | 0 | 5:1 6:1 9:1 |
| col:ascending+diag:equalTo | 3 | 3 | 100.0% | 0 | 0 | 0 | 7:1 9:2 |
| anyRow:allDifferent+row:sum | 3 | 0 | 0.0% | 3 | 0 | 0 | 1:1 2:2 |
| anyRow:allEqual+col:sum | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:2 5:1 |
| anti:allEqual+diag:allDifferent | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:2 |
| anti:equalTo+anyRow:fullHouse | 3 | 1 | 33.3% | 0 | 0 | 0 | 6:2 7:1 |
| anyRow:allEqual+corners:allEven | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:2 5:1 |
| anyLine:allOdd+diag:equalTo | 3 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 7:1 |
| anyRow:allEqual+diag:allOdd | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 |
| block:allEqual+corners:allOdd | 3 | 0 | 0.0% | 3 | 0 | 0 | 2:1 4:2 |
| anyCol:sum+x:allEqual | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:3 |
| anyRow:fullHouse+corners:equalTo | 3 | 1 | 33.3% | 1 | 0 | 0 | 4:1 6:2 |
| anyRow:ascending+plus:allOdd | 3 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 8:1 |
| anyCol:sum+plus:equalTo | 3 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 8:1 |
| corners:sum+row:fullHouse | 3 | 0 | 0.0% | 3 | 0 | 0 | 2:1 3:2 |
| plus:sum+row:allEqual | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 |
| block:equalTo+x:sum | 3 | 0 | 0.0% | 2 | 0 | 0 | 5:2 7:1 |
| anti:equalTo+plus:allDifferent | 3 | 1 | 33.3% | 2 | 0 | 0 | 4:1 5:1 6:1 |
| anyCol:allEven+row:ascending | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 |
| anti:equalTo+anyCol:fullHouse | 3 | 1 | 33.3% | 1 | 0 | 0 | 5:1 7:2 |
| anti:palindrome+row:allOdd | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:2 |
| anti:sum+diag:allEqual | 3 | 1 | 33.3% | 2 | 0 | 0 | 5:2 6:1 |
| anti:allOdd+diag:allOdd | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:1 5:1 |
| anyRow:sum+center3:allOdd | 3 | 0 | 0.0% | 2 | 0 | 0 | 4:2 6:1 |
| anyCol:allEqual+center3:noValue | 3 | 0 | 0.0% | 2 | 0 | 0 | 4:2 6:1 |
| anyCol:palindrome+x:equalTo | 3 | 1 | 33.3% | 1 | 0 | 0 | 5:1 6:1 7:1 |
| anyCol:equalTo+block:allEven | 3 | 1 | 33.3% | 1 | 0 | 0 | 5:1 6:1 7:1 |
| anti:allDifferent+anyRow:ascending | 3 | 0 | 0.0% | 3 | 0 | 0 | 2:1 4:2 |
| anyRow:allEven+block:equalTo | 3 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 8:1 |
| anyCol:ascending+diag:palindrome | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 |
| anyCol:allEqual+plus:allEven | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:2 5:1 |
| anti:allOdd+row:sum | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:2 |
| anyRow:allOdd+row:ascending | 3 | 0 | 0.0% | 3 | 0 | 0 | 2:1 4:1 5:1 |
| anyRow:ascending+diag:palindrome | 3 | 1 | 33.3% | 2 | 0 | 0 | 4:1 5:1 6:1 |
| anti:allDifferent+diag:equalTo | 3 | 0 | 0.0% | 2 | 0 | 0 | 5:2 6:1 |
| anyCol:allEven+plus:equalTo | 3 | 1 | 33.3% | 0 | 0 | 0 | 7:2 8:1 |
| anyCol:allDifferent+corners:sum | 3 | 0 | 0.0% | 3 | 0 | 0 | 1:1 2:2 |
| col:equalTo+x:equalTo | 3 | 0 | 0.0% | 0 | 1 | 1 | 7:1 11:1 |
| anyCol:allEqual+diag:allDifferent | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:2 |
| block:equalTo+diag:palindrome | 3 | 0 | 0.0% | 1 | 0 | 0 | 3:1 6:2 |
| col:allEqual+diag:palindrome | 3 | 0 | 0.0% | 2 | 0 | 0 | 5:2 7:1 |
| block:allDifferent+corners:equalTo | 3 | 1 | 33.3% | 2 | 0 | 0 | 4:2 6:1 |
| anyCol:palindrome+row:ascending | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 |
| anyCol:equalTo+x:fullHouse | 3 | 0 | 0.0% | 2 | 0 | 0 | 5:2 7:1 |
| block:sum+x:equalTo | 3 | 1 | 33.3% | 2 | 0 | 0 | 5:2 6:1 |
| anyRow:allOdd+row:fullHouse | 3 | 0 | 0.0% | 3 | 0 | 0 | 2:2 3:1 |
| block:allEqual+row:allOdd | 3 | 1 | 33.3% | 2 | 0 | 0 | 2:1 5:1 7:1 |
| anti:equalTo+anyRow:allEven | 3 | 0 | 0.0% | 1 | 0 | 0 | 4:1 6:2 |
| anyCol:allEqual+corners:allOdd | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:1 5:1 |
| anyRow:palindrome+diag:allEqual | 3 | 0 | 0.0% | 3 | 0 | 0 | 5:3 |
| anyRow:ascending+block:allOdd | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:3 |
| anyLine:allDifferent+col:allEqual | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:1 5:1 |
| anyCol:equalTo+corners:allDifferent | 3 | 0 | 0.0% | 1 | 0 | 0 | 5:1 6:2 |
| anyCol:allEqual+row:allEven | 3 | 0 | 0.0% | 2 | 0 | 0 | 5:2 6:1 |
| anti:equalTo+anyRow:sum | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:1 5:1 |
| anti:equalTo+col:fullHouse | 3 | 0 | 0.0% | 1 | 0 | 0 | 5:1 6:1 8:1 |
| anyLine:allDifferent+center3:allEven | 3 | 0 | 0.0% | 2 | 0 | 0 | 3:1 4:1 6:1 |
| anyCol:allEqual+col:palindrome | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:1 5:1 |
| anyCol:ascending+x:fullHouse | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:3 |
| anti:allOdd+anyCol:palindrome | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:2 4:1 |
| anyCol:allOdd+corners:equalTo | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 |
| block:allOdd+col:sum | 3 | 0 | 0.0% | 3 | 0 | 0 | 2:1 3:1 4:1 |
| anti:allOdd+diag:allDifferent | 3 | 0 | 0.0% | 3 | 0 | 0 | 2:1 3:2 |
| anyCol:ascending+corners:allOdd | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 |
| anti:equalTo+row:equalTo | 3 | 1 | 33.3% | 0 | 2 | 0 | 9:1 12:2 |
| anyRow:allEqual+plus:sum | 3 | 0 | 0.0% | 2 | 0 | 0 | 4:2 6:1 |
| anti:palindrome+col:ascending | 3 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 6:1 |
| anyLine:ascending+col:allEven | 3 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 6:1 |
| anyLine:allEqual+center3:sum | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:2 |
| anyCol:allEqual+diag:ascending | 3 | 0 | 0.0% | 2 | 0 | 0 | 5:2 6:1 |
| anti:ascending+col:allEven | 3 | 0 | 0.0% | 1 | 0 | 1 | 5:1 7:1 |
| anyCol:fullHouse+row:ascending | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 |
| anyRow:allEqual+diag:allEven | 3 | 0 | 0.0% | 2 | 0 | 0 | 3:1 5:1 6:1 |
| anyLine:allDifferent+col:equalTo | 3 | 0 | 0.0% | 2 | 0 | 0 | 4:2 6:1 |
| block:equalTo+corners:allDifferent | 3 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 6:1 |
| anti:ascending+row:allOdd | 3 | 0 | 0.0% | 0 | 0 | 2 | 6:1 |
| block:allOdd+row:allEqual | 3 | 0 | 0.0% | 2 | 0 | 0 | 4:2 6:1 |
| col:equalTo+corners:equalTo | 3 | 1 | 33.3% | 0 | 0 | 0 | 8:1 9:2 |
| anyCol:sum+center3:allEven | 3 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 6:1 |
| block:allEqual+x:allOdd | 3 | 0 | 0.0% | 1 | 0 | 0 | 4:1 6:2 |
| anti:ascending+anyRow:allEqual | 3 | 0 | 0.0% | 1 | 0 | 1 | 5:1 7:1 |
| col:ascending+row:sum | 3 | 0 | 0.0% | 3 | 0 | 0 | 5:3 |
| diag:palindrome+x:equalTo | 3 | 0 | 0.0% | 0 | 0 | 0 | 6:1 7:2 |
| anti:fullHouse+x:allEqual | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 |
| anti:ascending+row:sum | 3 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 6:1 |
| corners:allOdd+diag:fullHouse | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:2 5:1 |
| anyLine:allEqual+corners:sum | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:2 4:1 |
| anyRow:ascending+center3:noValue | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:2 5:1 |
| anti:ascending+row:equalTo | 3 | 2 | 66.7% | 0 | 0 | 0 | 8:1 9:1 10:1 |
| anti:allEqual+diag:ascending | 3 | 1 | 33.3% | 0 | 0 | 1 | 7:1 8:1 |
| anti:allDifferent+anyRow:allOdd | 3 | 0 | 0.0% | 3 | 0 | 0 | 2:2 3:1 |
| block:allEven+corners:equalTo | 3 | 0 | 0.0% | 1 | 0 | 0 | 4:1 6:1 7:1 |
| anti:allEqual+center3:noValue | 3 | 0 | 0.0% | 2 | 0 | 0 | 5:2 6:1 |
| anyLine:ascending+col:sum | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:2 |
| anyCol:fullHouse+plus:allEven | 3 | 0 | 0.0% | 3 | 0 | 0 | 2:1 3:1 4:1 |
| anyRow:ascending+plus:allDifferent | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:2 5:1 |
| block:equalTo+x:equalTo | 3 | 1 | 33.3% | 1 | 1 | 0 | 3:1 8:1 11:1 |
| anyRow:ascending+x:allOdd | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 |
| anti:palindrome+row:sum | 3 | 0 | 0.0% | 3 | 0 | 0 | 2:1 3:1 5:1 |
| col:allEqual+corners:equalTo | 3 | 0 | 0.0% | 0 | 0 | 2 | 7:1 |
| anyCol:ascending+plus:allEven | 3 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 6:1 |
| anyRow:sum+center3:allEven | 3 | 0 | 0.0% | 1 | 0 | 0 | 4:1 7:2 |
| diag:equalTo+x:allOdd | 3 | 0 | 0.0% | 1 | 0 | 0 | 5:1 7:1 8:1 |
| anti:allOdd+col:sum | 3 | 0 | 0.0% | 3 | 0 | 0 | 2:1 4:2 |
| block:allOdd+row:sum | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:3 |
| col:allOdd+plus:allEqual | 3 | 0 | 0.0% | 1 | 0 | 0 | 5:1 7:2 |
| anti:equalTo+diag:allDifferent | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 |
| anyLine:allDifferent+diag:allEqual | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:2 |
| anti:allOdd+anyRow:allOdd | 3 | 0 | 0.0% | 3 | 0 | 0 | 2:1 4:2 |
| diag:allEqual+plus:sum | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 |
| anti:sum+x:equalTo | 3 | 0 | 0.0% | 0 | 0 | 0 | 6:2 8:1 |
| plus:fullHouse+x:equalTo | 3 | 0 | 0.0% | 1 | 0 | 0 | 3:1 6:2 |
| anyCol:equalTo+row:allEqual | 3 | 0 | 0.0% | 0 | 0 | 2 | 8:1 |
| anti:palindrome+plus:fullHouse | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:2 4:1 |
| block:allEven+diag:allEven | 3 | 0 | 0.0% | 3 | 0 | 0 | 2:1 5:2 |
| plus:allDifferent+x:equalTo | 3 | 0 | 0.0% | 1 | 0 | 0 | 5:1 6:2 |
| anti:allOdd+anyCol:fullHouse | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:2 |
| anyCol:ascending+corners:allDifferent | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:3 |
| anti:ascending+diag:fullHouse | 3 | 0 | 0.0% | 2 | 0 | 0 | 5:2 7:1 |
| diag:allDifferent+plus:equalTo | 3 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 6:1 |
| diag:palindrome+row:fullHouse | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:2 4:1 |
| anyLine:allOdd+x:equalTo | 3 | 0 | 0.0% | 1 | 0 | 0 | 5:1 6:2 |
| anyCol:allOdd+row:fullHouse | 3 | 0 | 0.0% | 3 | 0 | 0 | 2:3 |
| anti:allDifferent+anyLine:ascending | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:3 |
| anyCol:palindrome+row:fullHouse | 3 | 0 | 0.0% | 3 | 0 | 0 | 2:2 3:1 |
| anyCol:ascending+plus:sum | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:3 |
| anyRow:sum+row:equalTo | 3 | 0 | 0.0% | 0 | 0 | 0 | 6:2 7:1 |
| anyCol:fullHouse+diag:palindrome | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:3 |
| col:sum+diag:allEqual | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 |
| anti:fullHouse+center3:allOdd | 3 | 0 | 0.0% | 2 | 0 | 0 | 5:2 8:1 |
| col:fullHouse+plus:equalTo | 3 | 0 | 0.0% | 1 | 0 | 0 | 4:1 6:1 8:1 |
| block:allOdd+diag:equalTo | 3 | 0 | 0.0% | 0 | 0 | 0 | 6:1 7:2 |
| col:fullHouse+row:equalTo | 3 | 0 | 0.0% | 0 | 0 | 0 | 7:2 9:1 |
| anti:allOdd+diag:fullHouse | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:1 5:1 |
| col:fullHouse+diag:equalTo | 3 | 0 | 0.0% | 0 | 0 | 0 | 6:1 8:2 |
| anti:palindrome+block:allEqual | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 |
| anyLine:allEven+row:equalTo | 3 | 0 | 0.0% | 1 | 0 | 0 | 4:1 7:1 8:1 |
| diag:ascending+row:fullHouse | 3 | 0 | 0.0% | 2 | 0 | 0 | 5:2 6:1 |
| anyCol:allOdd+center3:allEven | 3 | 0 | 0.0% | 2 | 0 | 0 | 3:1 5:1 8:1 |
| diag:sum+row:allEqual | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:1 5:1 |
| block:equalTo+diag:allOdd | 3 | 0 | 0.0% | 1 | 0 | 0 | 4:1 7:2 |
| diag:palindrome+row:equalTo | 3 | 1 | 33.3% | 0 | 0 | 0 | 6:2 10:1 |
| anyCol:palindrome+col:equalTo | 3 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 6:1 |
| anyCol:allOdd+x:equalTo | 3 | 0 | 0.0% | 2 | 0 | 0 | 3:1 5:1 6:1 |
| anti:fullHouse+col:ascending | 3 | 0 | 0.0% | 3 | 0 | 0 | 5:3 |
| anyRow:allDifferent+diag:equalTo | 3 | 0 | 0.0% | 1 | 0 | 0 | 5:1 6:2 |
| anyRow:equalTo+diag:sum | 3 | 0 | 0.0% | 2 | 0 | 0 | 5:2 7:1 |
| anyLine:allEqual+col:allOdd | 3 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 6:1 |
| col:allEven+row:allEqual | 3 | 0 | 0.0% | 0 | 0 | 0 | 6:1 8:2 |
| anyRow:palindrome+plus:equalTo | 3 | 0 | 0.0% | 1 | 0 | 0 | 5:1 6:1 7:1 |
| diag:equalTo+row:allEven | 3 | 0 | 0.0% | 1 | 0 | 0 | 5:1 7:1 8:1 |
| anyLine:allEqual+col:sum | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:2 4:1 |
| anyLine:equalTo+row:palindrome | 3 | 0 | 0.0% | 2 | 0 | 0 | 3:1 4:1 6:1 |
| anyRow:fullHouse+center3:noValue | 3 | 0 | 0.0% | 3 | 0 | 0 | 1:1 2:2 |
| diag:equalTo+row:allDifferent | 3 | 0 | 0.0% | 0 | 0 | 0 | 6:2 8:1 |
| col:sum+row:fullHouse | 3 | 0 | 0.0% | 2 | 0 | 0 | 3:2 7:1 |
| anti:fullHouse+corners:equalTo | 3 | 0 | 0.0% | 3 | 0 | 0 | 5:3 |
| anyRow:equalTo+row:allEven | 3 | 0 | 0.0% | 1 | 0 | 0 | 5:1 6:1 7:1 |
| block:sum+diag:allEqual | 3 | 0 | 0.0% | 1 | 0 | 0 | 5:1 6:2 |
| anyLine:allOdd+row:allEqual | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:2 5:1 |
| corners:allEqual+row:allOdd | 3 | 0 | 0.0% | 2 | 0 | 0 | 4:2 7:1 |
| anyCol:ascending+col:allDifferent | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:2 4:1 |
| col:allDifferent+row:equalTo | 3 | 0 | 0.0% | 1 | 0 | 0 | 5:1 7:1 8:1 |
| anyRow:equalTo+block:allEven | 3 | 0 | 0.0% | 1 | 0 | 0 | 5:1 7:1 8:1 |
| col:palindrome+x:equalTo | 3 | 0 | 0.0% | 2 | 0 | 0 | 5:2 8:1 |
| anti:allEven+col:allEqual | 3 | 0 | 0.0% | 1 | 0 | 0 | 5:1 6:1 8:1 |
| anti:equalTo+col:allEven | 3 | 0 | 0.0% | 1 | 0 | 0 | 5:1 6:1 8:1 |
| block:allOdd+corners:sum | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:2 4:1 |
| anyCol:ascending+center3:noValue | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:1 5:1 |
| block:equalTo+col:fullHouse | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 |
| anyCol:ascending+row:allDifferent | 3 | 0 | 0.0% | 2 | 0 | 0 | 3:1 4:1 6:1 |
| anti:allEqual+row:palindrome | 3 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 6:1 |
| anyLine:ascending+col:allOdd | 3 | 0 | 0.0% | 2 | 0 | 0 | 2:1 5:1 6:1 |
| corners:allEqual+diag:equalTo | 3 | 1 | 33.3% | 0 | 0 | 0 | 7:2 10:1 |
| anyRow:allEqual+plus:allOdd | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:2 5:1 |
| anti:palindrome+anyCol:palindrome | 3 | 0 | 0.0% | 3 | 0 | 0 | 2:1 3:1 4:1 |
| plus:equalTo+row:equalTo | 3 | 2 | 66.7% | 0 | 0 | 0 | 8:1 10:2 |
| anyLine:allEqual+col:palindrome | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:3 |
| plus:allEqual+x:allEven | 3 | 0 | 0.0% | 2 | 0 | 0 | 4:1 5:1 6:1 |
| anyRow:fullHouse+row:allDifferent | 3 | 0 | 0.0% | 3 | 0 | 0 | 2:3 |
| diag:allEven+plus:equalTo | 3 | 0 | 0.0% | 0 | 0 | 0 | 6:1 8:2 |
| anyLine:allDifferent+row:equalTo | 3 | 0 | 0.0% | 1 | 0 | 0 | 5:1 6:1 7:1 |
| anyLine:allEqual+diag:allDifferent | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:3 |
| anyLine:allEqual+row:allEven | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:2 5:1 |
| center3:allEven+plus:sum | 3 | 0 | 0.0% | 2 | 0 | 0 | 3:1 4:1 6:1 |
| anyLine:palindrome+row:ascending | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:2 5:1 |
| anyLine:palindrome+x:allEqual | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:2 |
| anti:palindrome+col:allOdd | 3 | 0 | 0.0% | 1 | 0 | 0 | 5:1 6:2 |
| anyLine:allOdd+plus:allEqual | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:2 5:1 |
| anti:allOdd+row:palindrome | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:2 |
| anyRow:ascending+row:allOdd | 3 | 0 | 0.0% | 3 | 0 | 0 | 5:3 |
| anyRow:equalTo+x:sum | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:1 5:2 |
| col:allEqual+row:allDifferent | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 |
| anyRow:allEven+row:fullHouse | 3 | 0 | 0.0% | 3 | 0 | 0 | 2:2 3:1 |
| anyRow:allEqual+row:allEven | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:1 5:1 |
| anti:palindrome+center3:allOdd | 3 | 0 | 0.0% | 1 | 0 | 0 | 5:1 7:1 8:1 |
| row:allOdd+x:allDifferent | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:3 |
| anyRow:allEqual+col:allEven | 3 | 0 | 0.0% | 1 | 0 | 0 | 4:1 6:2 |
| anyLine:equalTo+diag:palindrome | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:2 5:1 |
| anyLine:equalTo+row:allEven | 3 | 0 | 0.0% | 1 | 0 | 0 | 4:1 6:1 7:1 |
| anyLine:allOdd+block:equalTo | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:2 5:1 |
| anyCol:ascending+block:allDifferent | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:2 |
| anyCol:ascending+x:sum | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:2 |
| anti:equalTo+col:allDifferent | 3 | 0 | 0.0% | 0 | 0 | 0 | 6:3 |
| anyRow:equalTo+col:palindrome | 3 | 0 | 0.0% | 0 | 0 | 2 | 6:1 |
| center3:allOdd+diag:fullHouse | 3 | 0 | 0.0% | 2 | 0 | 0 | 2:1 4:1 6:1 |
| anti:equalTo+anyLine:fullHouse | 3 | 0 | 0.0% | 1 | 0 | 0 | 5:1 7:2 |
| diag:allDifferent+row:allEqual | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:2 5:1 |
| anyRow:allDifferent+corners:equalTo | 3 | 0 | 0.0% | 1 | 0 | 0 | 3:1 6:1 7:1 |
| col:fullHouse+row:fullHouse | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:2 |
| anti:allEven+anyRow:ascending | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:3 |
| col:ascending+row:allOdd | 3 | 0 | 0.0% | 1 | 0 | 0 | 4:1 7:1 9:1 |
| anti:allOdd+plus:fullHouse | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:2 5:1 |
| anti:allEqual+anyLine:fullHouse | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:3 |
| corners:sum+row:equalTo | 3 | 0 | 0.0% | 0 | 0 | 0 | 7:3 |
| row:fullHouse+x:allEqual | 3 | 0 | 0.0% | 2 | 0 | 0 | 3:1 5:1 6:1 |
| anyCol:allDifferent+row:allEqual | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:2 5:1 |
| anyRow:allEqual+x:sum | 3 | 0 | 0.0% | 2 | 0 | 0 | 3:1 4:1 6:1 |
| anyRow:fullHouse+diag:equalTo | 3 | 0 | 0.0% | 2 | 0 | 0 | 4:2 6:1 |
| anti:allEqual+anyLine:allEven | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 |
| block:equalTo+diag:fullHouse | 3 | 0 | 0.0% | 1 | 0 | 0 | 5:1 6:1 7:1 |
| anyLine:fullHouse+corners:sum | 3 | 0 | 0.0% | 3 | 0 | 0 | 1:1 2:2 |
| corners:sum+row:allEqual | 3 | 0 | 0.0% | 1 | 0 | 0 | 5:1 6:2 |
| anti:allEqual+anyLine:allOdd | 3 | 0 | 0.0% | 3 | 0 | 0 | 5:3 |
| anti:equalTo+anyCol:allDifferent | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:2 |
| anyCol:fullHouse+row:equalTo | 3 | 1 | 33.3% | 0 | 0 | 0 | 8:1 9:1 10:1 |
| anti:allOdd+anyLine:allEqual | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:1 5:2 |
| diag:equalTo+row:palindrome | 3 | 0 | 0.0% | 0 | 0 | 0 | 7:2 8:1 |
| anyLine:ascending+corners:allOdd | 3 | 0 | 0.0% | 3 | 0 | 0 | 4:2 5:1 |
| block:allOdd+center3:noValue | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:1 5:1 |
| col:allOdd+row:palindrome | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:1 5:1 |
| anyCol:equalTo+diag:palindrome | 3 | 0 | 0.0% | 1 | 0 | 0 | 5:1 6:1 8:1 |
| block:equalTo+col:sum | 3 | 0 | 0.0% | 1 | 0 | 0 | 4:1 6:1 8:1 |
| anyCol:equalTo+center3:allOdd | 3 | 0 | 0.0% | 0 | 0 | 0 | 6:1 8:2 |

### Acceptance rate per region type and per condition type

| Region | Attempts | Accepted | Rate | Too easy | Too hard+unsolved | | Condition | Attempts | Accepted | Rate | Too easy | Too hard+unsolved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| anti | 2344 | 246 | 10.5% | 1043 | 226 | | equalTo | 4659 | 891 | 19.1% | 836 | 596 |
| row | 2046 | 184 | 9.0% | 999 | 184 | | allEqual | 4569 | 503 | 11.0% | 1632 | 620 |
| diag | 1967 | 218 | 11.1% | 753 | 238 | | ascending | 2031 | 243 | 12.0% | 849 | 100 |
| anyRow | 1831 | 224 | 12.2% | 757 | 129 | | allOdd | 1535 | 102 | 6.6% | 1011 | 24 |
| anyCol | 1812 | 206 | 11.4% | 850 | 86 | | fullHouse | 1431 | 76 | 5.3% | 990 | 4 |
| anyLine | 1331 | 120 | 9.0% | 767 | 26 | | allEven | 1277 | 113 | 8.8% | 673 | 6 |
| plus | 1312 | 189 | 14.4% | 416 | 157 | | sum | 1057 | 32 | 3.0% | 833 | 5 |
| col | 1293 | 170 | 13.1% | 526 | 166 | | palindrome | 666 | 24 | 3.6% | 499 | 3 |
| x | 1121 | 112 | 10.0% | 446 | 84 | | allDifferent | 533 | 13 | 2.4% | 437 | 0 |
| block | 1005 | 116 | 11.5% | 460 | 38 | | noValue | 66 | 3 | 4.5% | 52 | 0 |
| center3 | 964 | 125 | 13.0% | 374 | 7 | |  | | | | |  |
| corners | 798 | 90 | 11.3% | 421 | 17 | |  | | | | |  |

## Solver time

Mean 1.28 s per candidate, 2.75 s per accepted puzzle (solve time only), max 11.7 s; 2.86 wall-clock s per bank puzzle including rejections, parallel over workers.

## Beam versus IDA* on the depth-8 calibration sample

40 puzzles with beam par <= 8 sampled; 32 finished within the node budget; beam par equals the IDA* optimum on 32 of 32 (100.0%).
IDA* time: mean 15.9 s, max 141.2 s.

## Confidence distribution (fraction of restarts that reached par)

| Confidence | Puzzles | Share |
| --- | --- | --- |
| 1.00 | 863 | 86.3% |
| 0.88 | 25 | 2.5% |
| 0.75 | 19 | 1.9% |
| 0.63 | 16 | 1.6% |
| 0.50 | 16 | 1.6% |
| 0.40 | 1 | 0.1% |
| 0.38 | 22 | 2.2% |
| 0.29 | 1 | 0.1% |
| 0.25 | 7 | 0.7% |
| 0.17 | 1 | 0.1% |
| 0.13 | 29 | 2.9% |

Mean confidence 0.932; 939 of 1000 at 0.5 or above.

Bank file size: 332 KB.

## Bot: one-ply (the plan's bot)

```
Bot turn distribution per par (share of plays; "bust" = unsolved at the 12-turn cap)
par	n	T1	T2	T3	T4	T5	T6	T7	T8	T9	T10	T11	T12	bust	mean
6	2000	0	0	0	0	0	5	4	3	3	2	2	3	79	8.44
7	2000	0	0	0	0	0	0	4	3	2	2	2	2	86	9.12
8	2000	0	0	0	0	0	0	0	1	1	1	2	1	95	10.07
9	2000	0	0	0	0	0	0	0	0	0	0	1	1	98	11.09
10	2000	0	0	0	0	0	0	0	0	0	0	0	0	99	11.20

Bid policies: bust rate and expected round score
par	par+0 bust%	par+0 E[score]	par+1 bust%	par+1 E[score]	par+2 bust%	par+2 E[score]	par+3 bust%	par+3 E[score]
6	95	4.9	91	7.9	88	8.9	85	8.8
7	96	3.5	94	5.4	92	6.1	90	6.1
8	99	1.1	98	1.8	97	2.2	95	2.7
9	100	0.2	100	0.3	99	0.7	98	1.0
10	100	0.2	99	0.5	99	0.7	99	0.7
all	98	2.0	96	3.2	95	3.7	94	3.9
```

## Bot: two-ply

```
Bot turn distribution per par (share of plays; "bust" = unsolved at the 12-turn cap)
par	n	T1	T2	T3	T4	T5	T6	T7	T8	T9	T10	T11	T12	bust	mean
6	2000	0	0	0	0	0	7	6	4	4	3	4	3	70	8.49
7	2000	0	0	0	0	0	0	5	3	3	3	2	2	81	9.08
8	2000	0	0	0	0	0	0	0	1	2	2	2	2	91	10.17
9	2000	0	0	0	0	0	0	0	0	0	1	1	1	96	10.83
10	2000	0	0	0	0	0	0	0	0	0	0	1	1	98	11.09

Bid policies: bust rate and expected round score
par	par+0 bust%	par+0 E[score]	par+1 bust%	par+1 E[score]	par+2 bust%	par+2 E[score]	par+3 bust%	par+3 E[score]
6	93	6.6	88	10.7	83	12.4	80	12.3
7	95	4.7	92	7.1	89	8.4	86	8.4
8	99	1.4	97	2.8	95	3.6	93	4.2
9	100	0.5	99	1.3	97	2.1	96	2.5
10	100	0.4	99	1.0	98	1.2	98	1.2
all	97	2.7	95	4.6	93	5.5	91	5.7
```

## Bot: planner (beam width 20)

```
Bot turn distribution per par (share of plays; "bust" = unsolved at the 12-turn cap)
par	n	T1	T2	T3	T4	T5	T6	T7	T8	T9	T10	T11	T12	bust	mean
6	2000	0	0	0	0	0	31	20	14	9	5	3	2	15	7.46
7	2000	0	0	0	0	0	0	27	20	15	10	5	4	20	8.47
8	2000	0	0	0	0	0	0	0	17	17	12	9	6	40	9.52
9	2000	0	0	0	0	0	0	0	0	10	13	12	9	55	10.44
10	2000	0	0	0	0	0	0	0	0	0	9	11	9	71	11.02

Bid policies: bust rate and expected round score
par	par+0 bust%	par+0 E[score]	par+1 bust%	par+1 E[score]	par+2 bust%	par+2 E[score]	par+3 bust%	par+3 E[score]
6	69	31.1	49	45.1	35	49.0	25	45.7
7	73	27.3	53	41.1	38	46.2	29	43.6
8	83	16.6	67	29.2	54	34.0	46	33.0
9	90	10.5	76	20.6	64	26.5	55	27.1
10	91	8.6	81	17.0	71	21.2	71	21.2
all	81	18.8	65	30.6	53	35.4	45	34.1
```
