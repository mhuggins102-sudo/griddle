# GridLock

A single-player, portrait-phone word puzzle: a 5x5 grid of letter tiles, 20 turns to slide, swap, nudge and draw them into words, and lock the words in to score. Everything is played with gestures straight on the board. Static HTML/CSS/JS, no framework, no bundler, no server.

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
| `js/board.js` | shared board skeleton (7x7 with arrows, or a plain 5x5) and tile animations |
| `js/grid.js` | board geometry for any size: cells, lines, moves, word lines |
| `js/words.js` | Word mode engine: letter bag, locked tiles, word finding, scoring |
| `js/wordui.js` | Word mode screen: gesture controls (drag, flick, hold, tap-tap), rendering, results |
| `js/tutorial.js` | in-game tutorial: one page per move on a small board of the game's size, animated with the game's own moves |
| `js/wordbot.js` | word bot that plays a board to set the level goal |
| `js/wordbot-worker.js` | runs the bot in a Web Worker |
| `data/words.txt` | 3-to-6-letter word list, most common first: ENABLE pruned of rarities plus modern words (about 20,300); built by `tools/build-words.js` |
| `tools/build-words.js` | rebuilds `data/words.txt` from ENABLE and OpenSubtitles word counts (downloads the sources with curl) |
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
node tools/wordbot-stats.js --seeds 200      # word-mode bot: score distribution, fill rate, goal per level (add --size 6)
```

Every puzzle in the bank is `{ id, seed, board, bag, goals, par, solution, confidence }`. `deal(seed)` reproduces the board and bag; `solution` is the solver's draw-free reference line encoded as short strings (`R2L` slide row 3 left, `C0D` slide column 1 down, `W7-8` swap cells 7 and 8, `N12+` nudge cell 12 up, `D4` draw at cell 4; cells are row-major 0 to 24).

## Word mode

Same board and actions with letters (Scrabble distribution, 98 tiles). Two board sizes, chosen on the home screen: 5x5 (25 dealt, 20 turns, words of 3 to 5 letters) and 6x6 (36 dealt, 25 turns, words of 3 to 6 letters; a 6-letter word earns +30 and the coverage ladder runs from the 29th tile, climbing 1, 3, 5, 7… per tile, to +64 for all 36). The geometry lives in `js/grid.js` and a play state carries its size; `TURNS_BY_SIZE`, `LENGTH_BONUS` and `COVERAGE_LADDER` in `js/words.js` hold the per-size constants. No bidding; the whole screen fits a portrait phone without scrolling.

Controls are gestures on the board, no action buttons: drag a tile onto a neighbour to swap; flick a row or column (a quick swipe) to slide the line one step; press and hold a tile for a menu with nudge down, nudge up, draw and, on a locked tile, wild; tap the first and last letter of a word to lock it (the lock happens at once, no confirmation). The home screen's How to play is the rulebook in eight accordion chapters (the last on the leaderboard); the tutorial opens by itself on the first game ever played on a device (not after a data reset), and the ? button during a game opens it (intro, one page per move with an animated worked example on a 5x5 or 6x6 board, two pages on scoring). A legend under the board names the four gestures; messages (not a word, locked tiles cannot be swapped, out of turns) appear in the same strip instead of toasts. The gesture thresholds are constants at the top of `js/wordui.js` (`LONG_PRESS_MS`, `TAP_SLOP`, `SWAP_TRAVEL`, `SWAP_CROSS`, and the flick-versus-drag line `FLICK_SPEED_AT_ZERO` / `FLICK_SPEED_PER_TILE` / `FLICK_MIN_SPEED`: a movement counts as a flick when its average speed in tiles per second is at least 24 minus 16 times its length in tiles, and never below 4, so a one-tile movement must average 8 tiles per second and a slow crawl of any length is a drag, which swaps with the neighbour in its direction; while the finger is down, the neighbour lights up as soon as the movement averages under 4 tiles per second, which no further distance can turn into a flick, and from then on that release swaps however fast it ends; pausing over the neighbour lowers the average, so a hover confirms a drag too). New game is a run of levels: a bot (`js/wordbot.js`) plays each board first and the goal is a growing share of its banked word points, fill bonuses excluded (50% at level 1, +5 points per level, uncapped: 100% at level 11, 150% at level 21; `GOAL_START_PERCENT`, `GOAL_STEP_PERCENT`); pass to advance, miss and the run ends. Free play is one board with no goal. In free play Undo takes back moves and locks one at a time, as far back as the last draw (a draw cannot be undone); level runs have no undo and no board replay. Any word of 3 to 5 letters along a row, column or diagonal, read either way, can be locked: tap the word's first and last letter. Locking costs one turn and banks Scrabble letter values plus a length bonus (4 letters +5, 5 letters +15). Locked tiles stay put: a line still slides but its locked tiles do not move and the rest slide around them; locked tiles cannot be swapped, but can be nudged to a neighbouring letter for one turn, drawn over, or turned wild for two turns, once per board (`MAX_WILDS`; wild reads as any letter, scores 0). A new word may reuse locked tiles if it adds at least one fresh tile; any listed word goes except an exact repeat, or an inflection of a word already locked on those same tiles (DOOR then DOORS over the same DOOR; `data/words.txt` carries lemmas as `WORD>LEMMA` from a public lemmatization list, with the modern supplement words' lemmas given in `tools/build-words.js`; nothing is guessed from spelling). A different word that contains a locked one (CAR then CARROT) is fine. The game ends after the 20th turn (a board cannot be ended early, except that the moment the level goal is reached play stops and a Next level button moves you on; the header score and level bar show the score as it stands, bonuses included). A board's end opens a result card above the bottom edge (the title with its note, such as the personal best, right-justified beside it; one tile per component, the total as an accent tile at the end of the row in portrait and in the head in landscape: words, tiles, turns left, any shortfall; then the next action, Home, Replay board and Share); the board shrinks if needed so the whole of it stays visible above the sheet, centred in the room left, down to `MIN_BOARD_PX`, past which the sheet is capped and its middle scrolls; the locked-words bar under the header stays. A level passed mid-board opens the same sheet with Next level after a short pause (`PASS_PAUSE_MS`); Home keeps that board saved and the sheet returns on Continue. In landscape on a screen at least 640px wide (tablets, laptops, phones on their side) the screen is two columns: the panel (header, turn track, level bar, the locked words as a list that grows down the panel and scrolls, the gesture legend) on the left and the board, sized by the height, on the right, the pair centred; at the board's end the words fold back into one row and the result card docks under them, or takes the panel's place on a short screen (`dockInPanel`). When a run ends, the final board's score, the level reached and the best level are shown, and that board can be replayed as free play with its goal on show (not counted in stats). Final score = banked words plus a coverage ladder (the locked tiles past the 19th, squared: +1 at 20, +4 at 21 … +36 for all 25, plus 10 per unused turn on a full board); there are no penalties. Locking the 25th tile ends the board immediately. Level goals are rounded up to the nearest 10. Sounds are synthesized with Web Audio (`js/sound.js`), toggle on the home screen. A finished board can be replayed (same letters and draws); replays do not count towards stats but the best score per board is remembered. Constants: `COVERAGE_BONUS`, `FULL_COVER_TURN_BONUS`, `WILD_COST` in `js/words.js`. The bag button in the header shows the letters left in the bag; a settings option lists the words on the board (off by default) and tapping a listed word offers to lock it; a board played with it on is practice (`game.practice`, set at the start or the moment the option is turned on with a board in progress, and never unset): nothing from it reaches the stats, the per-board bests or the leaderboard.

## Leaderboard

Four public top-10 boards, one per board size (5x5, 6x6) and kind (best single-board score, highest level reached), kept in a Supabase project and reached from the home screen's trophy button (left of the gear). The code is `js/leaderboard.js`; the database side is `supabase/schema.sql`; the project URL and public key go in `js/leaderboard-config.js` (empty by default, in which case the sheet says the leaderboard is not set up and nothing is fetched).

How it works: a board that finishes outside a replay or retry is a candidate for the score board, and the end of a level (passed or failed) for the level board of that size. The first time a board finishes with its result on screen (a free-play board, a lost level, or the board that ends a run), a sheet asks for a name: post results under that name, or stay anonymous, in which case nothing ever leaves the device; a level passed with the Next level button is scored silently, so the question waits. The device keeps a random player id with the name; results wait in an outbox (`store.leaderboard.pending`) until the player has a name and the network is there, and go out oldest first (an entry the server refuses with HTTP 400 is dropped; anything else, a network failure, a server error, a missing key or grant, a rate limit, keeps it for the next finish, the next visit to the sheet, or the browser coming back online). The server keeps one row per player and board with the highest value posted, so posting a lower score changes nothing. The sheet marks the player's own row and, when it sits outside the top 10, shows it after a gap with its rank. The name can be changed from the sheet's foot button (`rename_player`, queued and retried like a result); a named player who chooses "Remove my name" is deleted from every board (`remove_player`, also queued until it succeeds) and gets a fresh player id if they join again. Reset device data opens a sheet with a switch: keep the leaderboard name (and player id) through the reset, or forget it, which removes the player's rows and asks again after the next finished game. `bestReached5` / `bestReached6` in the word stats are the highest level reached per size, kept up with what the recent history proves (`seedReached` at boot, `bestReachedBySize`); a save from before the per-size counters only had a global figure across both sizes (`bestReached`, `bestLevel`), which cannot be told apart by size and so is neither shown per size nor posted to a board; the per-size figures catch up as the player plays.

Setting up the Supabase project (as of November 2026):

1. Dashboard → New project: pick the organisation, a name, a generated database password (keep it somewhere, the game never uses it), the region closest to your players, the Free plan. Provisioning takes a minute or two.
2. SQL Editor → New query → paste the whole of `supabase/schema.sql` → Run. It creates the table, the four API functions and one internal helper inside one transaction; the table has row level security on and no policies or grants, so the public key cannot touch it directly, only call the functions. Running it again is harmless.
3. The Connect button at the top of the project (or Project Settings → API Keys) shows the project URL and the publishable key (`sb_publishable_…`; an older project may still list a legacy `anon` key, which also works). Paste both into `js/leaderboard-config.js`, commit, deploy. Never the secret key: it bypasses row level security.
4. Check from a terminal (expect `[]` on a fresh project):

   ```
   curl -X POST 'https://<ref>.supabase.co/rest/v1/rpc/get_leaderboard' -H 'apikey: <publishable key>' -H 'Content-Type: application/json' -d '{"p_size":5,"p_kind":"score"}'
   ```

Things to know: the publishable key is designed to be public, so anyone could script a submission; the functions bound every argument (size, kind, name length, value ceilings) and that is the whole defence, which is fine for a friendly leaderboard. Moderation is the Table Editor: tick `hidden` on a row to take it off the boards, or delete it. Supabase's Security Advisor will flag the four functions as security-definer functions callable by `anon` (lint 0028); that is by design here. A Free project is paused after about a week without database activity; the game then shows "Couldn't reach the leaderboard" until you press Resume in the dashboard (data is kept). The key travels in the `apikey` header only. CORS needs nothing: the hosted API answers any origin.

## Deploy

The site is static. `netlify.toml` publishes the repository root; no build step.
