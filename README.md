# Grid Bid

A single-player, portrait-phone puzzle. A 5x5 grid of tiles valued 1 to 6, two goals that must hold at the same time, and a bid on how many turns you need. Static HTML/CSS/JS, no framework, no bundler, no server.

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
| `js/ui.js` | screens, action modes, animations, replay, help, share, stats |
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

## Deploy

The site is static. `netlify.toml` publishes the repository root; no build step.
