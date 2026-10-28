# Grid Bid

A single-player, portrait-phone word puzzle: a 5x5 grid of letter tiles, 20 turns to slide, swap, nudge and draw them into words, and lock the words in to score. Static HTML/CSS/JS, no framework, no bundler, no server.

The original number game (two goals, a bid on turns, a solver-verified puzzle bank) is still in the code but hidden from the home screen; set `SHOW_NUMBER_GAME` to true in `js/ui.js` to bring it back.

## Play locally

```
npm run serve        # http://localhost:8080/
```

Any static file server works; the page fetches `data/puzzles.json` so it needs HTTP rather than `file://`.

## Layout

| Path | Purpose |
| --- | --- |
| `index.html` | single page, loads the modules |
| `css/style.css` | layout, dice faces, highlights, animations |
| `js/engine.js` | deal, actions, goal evaluation, goal cost, scoring; pure, shared with Node |
| `js/rng.js` | seeded RNG (mulberry32), used for deals and draws |
| `js/game.js` | round and game flow, localStorage persistence |
| `js/ui.js` | screens, action modes, replay, help, share, stats |
| `js/board.js` | shared 7x7 board skeleton and tile animations |
| `js/words.js` | Word mode engine: letter bag, locked tiles, word finding, scoring |
| `js/wordui.js` | Word mode screen |
| `data/words.txt` | 3-to-5-letter word list (from the public-domain ENABLE list) |
| `data/puzzles.json` | the shipped bank (`data/puzzles-stats.json` holds generation stats) |
| `tools/generate.js` | goal pairing, beam solver, IDA* calibration, bank writer (parallel over worker threads) |
| `tools/solver.js` | beam search and IDA* on typed-array boards |
| `tools/goals.js` | weighted goal table, pairing rules, joint satisfiability |
| `tools/tune.js` | re-weights the goal table from a previous run's stats |
| `tools/bot.js` | greedy bot for turn-distribution estimates |
| `tools/report.js` | prints the bank and bot reports |
| `tools/deal.js` | deals a seed and prints the board |
| `tools/serve.js` | tiny static server for local play |
| `test/` | node:test suites |
| `docs/reports/` | checkpoint reports |

## Toolchain

```
npm test                                   # engine, goals, scoring, pairing, bank replay
node tools/deal.js 42                      # print a deal
node tools/generate.js --count 1000 --per-par 200 --calibrate 40
node tools/tune.js                         # rewrite tools/config.json weights from data/puzzles-stats.json
node tools/report.js --phase 1             # bank report
node tools/report.js --phase 2 --games 20  # bot report (add --lookahead 2 to tools/bot.js runs for the two-ply bot)
node tools/bot.js --games 10 --lookahead 2
```

Every puzzle in the bank is `{ id, seed, board, bag, goals, par, solution, confidence }`. `deal(seed)` reproduces the board and bag; `solution` is the solver's draw-free reference line encoded as short strings (`R2L` slide row 3 left, `C0D` slide column 1 down, `W7-8` swap cells 7 and 8, `N12+` nudge cell 12 up, `D4` draw at cell 4; cells are row-major 0 to 24).

## Word mode

Same board and actions with letters (Scrabble distribution, 98 tiles, 25 dealt). Twenty turns, no bidding; the whole screen fits a portrait phone without scrolling. Any word of 3 to 5 letters along a row, column or diagonal, read either way, can be locked: choose Lock, tap the word's first and last letter, confirm. Locking costs one turn and banks Scrabble letter values plus a length bonus (4 letters +5, 5 letters +15). Locked tiles stay put: a line still slides but its locked tiles do not move and the rest slide around them; locked tiles cannot be swapped or drawn. A locked tile can be nudged to a neighbouring letter for one turn or turned wild for two turns (wild reads as any letter, scores 0). A new word may reuse locked tiles if it adds at least one fresh tile, but the same word, or a word and its plural (DOOR/DOORS), cannot both be locked. The game ends after the 20th turn. Final score = banked words, minus 10 per locked tile short of 20, plus a coverage bonus (+50 for all 25 tiles, +25 for 24, +10 for 23), floored at 0. Constants: `COVERAGE_BONUS`, `COVERAGE_TARGET`, `SHORTFALL_PENALTY`, `WILD_COST` in `js/words.js`. The bag is shown only in Draw mode; a home-screen option lists the words on the board (off by default).

## Deploy

The site is static. `netlify.toml` publishes the repository root; no build step.
