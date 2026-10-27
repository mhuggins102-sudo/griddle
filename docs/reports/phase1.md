# Phase 1 checkpoint: solver, generator, first bank

Status: tools/generate.js, tools/solver.js, tools/goals.js, tools/report.js and tools/bot.js are in place. A 200-puzzle bank was generated with uniform goal weights (W=2000, R=8, depth cap 12) on a 4-core container, and the whole test suite (42 tests, including the bank replay checks) passes.

Headline numbers against the plan's targets:

| Check | Target | Result |
| --- | --- | --- |
| Beam par equals IDA* optimum on the depth-8 sample | at least 90% | 27 of 28 completed (96.4%); 1 overestimate by 1 (puzzle 0022); 2 of 30 hit the IDA* node budget |
| Solve time per puzzle | 5 s or less | mean 0.53 s per candidate, 1.9 s per accepted puzzle, one 11.5 s outlier (an unsolvable candidate searched to depth 12 across restarts; the time budget now caps restarts at 10 s) |
| Every par value present | yes | 6 to 10 all present, but skewed: 52% par 6, 3% par 10 |
| Bank validity | all | every stored solution replays, neither goal holds at deal, length equals par |
| File size | under 500 KB | 66 KB for 200 puzzles (about 330 KB projected for 1,000) |

Findings that drive Phase 2 tuning:

- 74% of candidates are rejected as too easy (par 5 or less). Sum, all-different and palindrome goals are almost always too easy (6%, 6% and 10% acceptance). All-equal-to-V (66%), all-equal (35%) and ascending-run (32%) carry most of the hard puzzles.
- With uniform weights no pair exceeds 1% of the bank, so the 10% cap is far from binding.
- Confidence is high: 91.5% of puzzles were found at par by all 8 restarts; mean 0.953.
- IDA* with the admissible heuristic (count of region cells that must change; the Center X region halved) is cheap on most puzzles but can take a minute on par-8 ones, so the calibration sample stays at 30.

Deviation from the plan to flag: the bot's one-ply lookahead busts almost every puzzle (see the Phase 2 report), so tools/bot.js gained an optional two-ply mode. The one-ply bot described in the plan remains the default.

The raw report below is the output of `node tools/report.js --phase 1` on this bank.

---

# Bank report

Generated 2026-10-27T22:18:59.109Z; 200 puzzles; solver W=2000 R=8 depth cap 12.

## Par histogram

| Par | Puzzles | Share |
| --- | --- | --- |
| 6 | 105 | 52.5% |
| 7 | 54 | 27.0% |
| 8 | 26 | 13.0% |
| 9 | 9 | 4.5% |
| 10 | 6 | 3.0% |

## Goal pair share of the bank (top 25)

180 distinct goal pairs; largest share 1.0% (anti:ascending+row:allOdd).

| Goal pair | Puzzles | Share |
| --- | --- | --- |
| anti:ascending+row:allOdd | 2 | 1.0% |
| anyLine:equalTo+row:allEqual | 2 | 1.0% |
| anti:equalTo+corners:sum | 2 | 1.0% |
| anyLine:equalTo+corners:equalTo | 2 | 1.0% |
| anti:allEqual+diag:allEven | 2 | 1.0% |
| anyCol:equalTo+diag:fullHouse | 2 | 1.0% |
| row:allEven+x:allEqual | 2 | 1.0% |
| anti:equalTo+x:allEqual | 2 | 1.0% |
| col:allEven+row:allEqual | 2 | 1.0% |
| anyCol:ascending+row:allOdd | 2 | 1.0% |
| anyRow:ascending+plus:equalTo | 2 | 1.0% |
| anyLine:equalTo+center3:allEven | 2 | 1.0% |
| anyCol:ascending+center3:allEven | 2 | 1.0% |
| plus:allEqual+row:allOdd | 2 | 1.0% |
| diag:equalTo+row:fullHouse | 2 | 1.0% |
| center3:allOdd+diag:allEqual | 2 | 1.0% |
| anyRow:equalTo+row:allEven | 2 | 1.0% |
| anti:fullHouse+plus:allEqual | 2 | 1.0% |
| anyLine:ascending+center3:allOdd | 2 | 1.0% |
| anyRow:allOdd+row:equalTo | 2 | 1.0% |
| corners:allOdd+row:allEqual | 1 | 0.5% |
| plus:allEven+row:allEqual | 1 | 0.5% |
| col:fullHouse+row:allEqual | 1 | 0.5% |
| anyRow:palindrome+center3:allEven | 1 | 0.5% |
| row:allEqual+x:allEqual | 1 | 0.5% |

## Region and condition share

| Region | Goals | Share | | Condition | Goals | Share |
| --- | --- | --- | --- | --- | --- | --- |
| row | 52 | 13.0% | | equalTo | 120 | 30.0% |
| anti | 51 | 12.8% | | allEqual | 77 | 19.3% |
| diag | 47 | 11.8% | | allOdd | 50 | 12.5% |
| anyRow | 41 | 10.3% | | ascending | 44 | 11.0% |
| plus | 32 | 8.0% | | allEven | 42 | 10.5% |
| col | 32 | 8.0% | | fullHouse | 27 | 6.8% |
| anyCol | 32 | 8.0% | | palindrome | 15 | 3.8% |
| x | 30 | 7.5% | | sum | 14 | 3.5% |
| center3 | 23 | 5.8% | | allDifferent | 9 | 2.3% |
| anyLine | 23 | 5.8% | | noValue | 2 | 0.5% |
| block | 22 | 5.5% | |  | |  |
| corners | 15 | 3.8% | |  | |  |

## Acceptance

856 candidates solved, 200 accepted (23.4%), wall time 119 s on 4 workers.

| Rejection reason | Count | Share of attempts |
| --- | --- | --- |
| too-easy | 634 | 74.1% |
| unsolved | 17 | 2.0% |
| quota (par full) | 0 | 0.0% |
| quota (pair full) | 0 | 0.0% |

### Acceptance rate per goal pair (attempted at least 3 times, sorted by attempts)

| Goal pair | Attempts | Accepted | Rate | Too easy | Too hard | Unsolved | Par mix of solved |
| --- | --- | --- | --- | --- | --- | --- | --- |
| anyCol:allOdd+diag:palindrome | 3 | 0 | 0.0% | 3 | 0 | 0 | 2:1 3:1 4:1 |
| col:allEven+plus:sum | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:3 |
| block:allEven+x:allEven | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:1 4:1 5:1 |
| col:allOdd+row:allEqual | 3 | 1 | 33.3% | 2 | 0 | 0 | 5:2 6:1 |
| anyLine:ascending+center3:allOdd | 3 | 2 | 66.7% | 1 | 0 | 0 | 5:1 6:1 7:1 |
| anyRow:allEqual+row:sum | 3 | 0 | 0.0% | 3 | 0 | 0 | 3:1 5:2 |

### Acceptance rate per region type and per condition type

| Region | Attempts | Accepted | Rate | Too easy | Too hard+unsolved | | Condition | Attempts | Accepted | Rate | Too easy | Too hard+unsolved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| anti | 204 | 51 | 25.0% | 149 | 2 | | sum | 228 | 14 | 6.1% | 212 | 2 |
| diag | 193 | 47 | 24.4% | 138 | 8 | | allEqual | 223 | 77 | 34.5% | 133 | 10 |
| col | 172 | 32 | 18.6% | 132 | 8 | | allOdd | 222 | 50 | 22.5% | 172 | 0 |
| anyCol | 171 | 32 | 18.7% | 133 | 3 | | allEven | 199 | 42 | 21.1% | 154 | 3 |
| row | 167 | 52 | 31.1% | 110 | 4 | | fullHouse | 193 | 27 | 14.0% | 164 | 1 |
| anyRow | 158 | 41 | 25.9% | 115 | 2 | | equalTo | 181 | 120 | 66.3% | 49 | 9 |
| anyLine | 140 | 23 | 16.4% | 115 | 0 | | allDifferent | 162 | 9 | 5.6% | 152 | 0 |
| x | 123 | 30 | 24.4% | 90 | 3 | | palindrome | 150 | 15 | 10.0% | 135 | 0 |
| plus | 115 | 32 | 27.8% | 81 | 2 | | ascending | 137 | 44 | 32.1% | 83 | 8 |
| block | 98 | 22 | 22.4% | 75 | 0 | | noValue | 17 | 2 | 11.8% | 14 | 1 |
| corners | 94 | 15 | 16.0% | 77 | 1 | |  | | | | |  |
| center3 | 77 | 23 | 29.9% | 53 | 1 | |  | | | | |  |

## Solver time

Mean 0.53 s per candidate, 1.92 s per accepted puzzle (solve time only), max 11.5 s; 0.60 wall-clock s per bank puzzle including rejections, parallel over workers.

## Beam versus IDA* on the depth-8 calibration sample

30 puzzles with beam par <= 8 sampled; 28 finished within the node budget; beam par equals the IDA* optimum on 27 of 28 (96.4%).
Beam overestimated par on: 0022 (beam 8, optimal 7).
IDA* time: mean 7.0 s, max 51.1 s.

## Confidence distribution (fraction of restarts that reached par)

| Confidence | Puzzles | Share |
| --- | --- | --- |
| 1.00 | 183 | 91.5% |
| 0.88 | 2 | 1.0% |
| 0.75 | 4 | 2.0% |
| 0.50 | 1 | 0.5% |
| 0.38 | 4 | 2.0% |
| 0.25 | 1 | 0.5% |
| 0.13 | 5 | 2.5% |

Mean confidence 0.953; 190 of 200 at 0.5 or above.

Bank file size: 66 KB.
