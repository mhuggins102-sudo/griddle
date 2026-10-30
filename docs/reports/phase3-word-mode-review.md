# Phase 3: Word mode review (UI, scoring, goal bot, 6x6)

Decisions taken on 30 October (all implemented on the branch, 6x6 included): the game is now called **GridLock** (the storage key `gridbid.v1` is unchanged so saved progress survives); locking stays immediate on the second tap; the coverage ladder is adopted (`COVERAGE_BONUS = { 20: 5, 21: 10, 22: 15, 23: 20, 24: 25, 25: 30 }`, +10 per unused turn on a full board, wild still two turns, no penalty); level goals are now a share of the bot's banked word points instead of its full score (goal at level 1 about 50, level 14 about 134; `node tools/wordbot-stats.js` prints them); 6x6 will get 25 turns with the ladder proposed at the end of the 6x6 section.

Status: the gesture UI described below is implemented on branch `claude/gesture-ui` (three commits), with the number game untouched behind its flag. The scoring, bot and 6x6 sections are assessments with recommendations; no rule or constant was changed. Simulations were run by analysis agents against the shipped engine; their headline numbers for the shipped bot agree with each other (four independent runs: mean 187 to 191, 89% to 93% full boards, 28% to 29% of the score from bonuses) and can be reproduced with `node tools/wordbot-stats.js --seeds 200`. The variant and 6x6 runs lived in session scratch space and are quoted with their seed counts; treat them as single-run estimates with roughly plus or minus 3 points on a mean of 200 boards.

## UI: gesture controls and visual polish

### What changed

The game screen no longer has an action bar. Every action is a direct gesture on a full-width 5x5 board:

| Action | Gesture | Feedback while you do it |
| --- | --- | --- |
| Swap | Drag a tile onto one of its four neighbours and let go | The tile lifts with a shadow; the neighbour slips into the vacated square with a dashed target ring; a locked neighbour shows a red ring and the tile snaps back with a shake |
| Slide | Flick a row or column, or drag a tile about 1.5 tiles along the line | The whole line shifts one step; the wrapping tile leaves one edge while a ghost copy enters the other (conveyor effect, clipped at the board edge) |
| Nudge, Draw, Wild | Press and hold a tile (420 ms) | A popover shows the two neighbouring letters (so you see exactly what a nudge gives), Draw with the bag count, and Wild (two turns) on a locked tile; tap outside to dismiss |
| Lock | Tap the first letter, then the last letter | First tap: amber ring and "Now tap the last letter of the word" in the strip; second tap locks at once, the tiles pop green and a "+N WORD" label floats up; a non-word shakes and says so, nothing is spent |

Popups removed: "pick an action first", "now tap the last letter" (toast), "locked tile: nudge or wild" hints, the Draw confirmation dialog, the Lock confirmation, "X locked for N", "drew X", "level passed, press Next level", the undo confirm() dialog, and the level-advance toast. Messages that still matter (not a word, locked tiles cannot be swapped, out of turns, board complete) appear in a status strip under the board, in place, for about two seconds. Toasts remain only for load failures.

Home screen: a tile-built logo, a shorter tagline, Continue takes the primary slot when a game is in progress (with level, turn and score as a subtitle), New game and Free play each carry a one-line description, How to play and Stats share a row, stats appear as three small cards once you have played, and the settings are proper switches in a card.

Game screen: a top card with turn, score (tap for the breakdown), a 20-segment turn track that turns red for the last three turns, header icon buttons (undo in free play, bag toggle, help, home), the level bar, and the locked words as green pills. The board sits on a tray and uses the full width (tiles 63 px at 390 px wide, 59 px at 360 px, versus 46 px before). On short screens the board shrinks to keep everything on one screen. Dark mode, reduced motion, 320 px to 430 px widths and the hidden number game were all checked.

### Tuning knobs

All thresholds are constants at the top of `js/wordui.js`:

| Constant | Value | Meaning |
| --- | --- | --- |
| `LONG_PRESS_MS` | 420 | hold time for the tile menu |
| `TAP_SLOP` | 8 px | movement below this is a tap |
| `FLICK_VELOCITY` | 0.45 px/ms | release speed along the line that counts as a flick |
| `SLIDE_TRAVEL` | 1.45 tiles | a drag this far along a line slides it even when slow |
| `SWAP_TRAVEL` | 0.4 tiles | minimum travel towards a neighbour to drop onto it |

If players report accidental slides when they meant to swap, raise `FLICK_VELOCITY`; if flicks are missed, lower it.

### Decisions you may want to revisit

- Locking happens on the second tap with no confirmation. A mis-tap that happens to form a valid word costs a turn. Free play has one undo; level runs have none. Restoring a one-tap confirmation is a small change (the pending-lock path used by the found-words list already exists).
- Draw has no confirmation either: the long-press plus a tap on Draw is the deliberate step. The bag count is shown on the Draw button and the full bag is one tap away in the header.
- Keyboard users can tap-lock (Enter) and open the menu (M), but cannot swap or slide. A keyboard scheme (arrow keys with a modifier) is a possible follow-up.

## Scoring system

### Verdict

- The system is logical and the numbers a player needs (letter values, +5/+15 length bonus, +10 per unused turn on a full board) are legible. The one illegible piece is the 24/25 step: the 25th tile is worth about +36 to +49 points on average (the +25 plus the unused-turn bonus it unlocks), the 24th +10, and the 23rd nothing.
- Do not bring the -10 per tile penalty back. The bot, and every honest simulated player, finishes with 22 or more tiles locked on at least 97% of boards, so the penalty would never touch the bot's goals and would only cut beginners' scores. It also rewarded 3-letter filler over 5-letter words.
- The wild exploit you worried about is not real at the current price. A bot built to abuse wilds (overlapping 5-letter words through wild tiles) banks the most raw word points of any strategy but gives up the fill bonuses and finishes 14 points below the plain bot, losing on 78% of boards. Two turns is exactly the break-even price: at one turn the exploit wins by 20 points; at three turns the wild is dead (used in 18% of games for +0.1). Keep `WILD_COST` at 2 and keep the feature.
- The fill bonuses should not be raised across the board; they are already 29% of a typical bot score. The better change is to spread them: a ladder of +5 per locked tile from the 20th (20: 5, 21: 10, 22: 15, 23: 20, 24: 25, 25: 30) with the +10 per unused turn kept for a full board only.
- Decide one thing deliberately: the endgame is a race to fill. Once 20 tiles are locked, the last five take about 5.6 turns and earn 5.9 points per turn, while every turn saved is worth 10. If late words should still matter, halve `FULL_COVER_TURN_BONUS` to 5, but then raise the wild cost to 3, because the turn bonus is what keeps wild chains unprofitable.

### What the numbers say

Shipped bot, shipped rules (2,000 boards, seeds 1 to 2,000; replicated on 500 other seeds):

| Measure | Value |
| --- | --- |
| Final score mean / median / p10 / p90 | 191 / 192 / 163 / 217 |
| Banked word points mean | 136 |
| Boards with 25 / 24 / 23 / 22 or fewer tiles locked | 92% / 7% / 1% / 0.2% |
| Share of final score: letters / length bonus / fill bonus / unused-turn bonus | 39% / 32% / 12% / 16% |
| Words per board, 3 / 4 / 5-letter mix | 9.1, 25% / 44% / 30% |
| Turns used, boards ending early | 16.8, 88% |

Strategy comparison on the same 200 boards under the current rules, paired against the shipped bot:

| Strategy | Mean score | Banked | Full boards | Versus shipped bot |
| --- | --- | --- | --- | --- |
| Shipped bot | 187 | 135 | 89% | 0 |
| Opportunist (wild when it pays, chases fill) | 183 | 114 | 94% | -4.6 |
| Points only, no fill awareness | 176 | 139 | 56% | -11 |
| 3-letter-word rush, no wild | 175 | 96 | 95% | -12 |
| Wild exploiter (reuses locked letters) | 173 | 164 | 21% | -14 |
| Deliberate chainer (worst case) | 158 | 152 | 14% | -30 |

Levers, measured as "exploiter minus shipped bot" and their side effects:

| Lever | Exploit gap | Side effects |
| --- | --- | --- |
| Current rules | -14 | none |
| Old -10 per tile under 22 | -18 | honest fill-chasers lose 5 to 10 points; exploiter-versus-coverer gap unchanged |
| Bigger fill bonuses (+50 / +25 / +10) | -28 | every score +24, goals +13%, bonus share 36% to 52% |
| Wild costs 3 | -21 | wild effectively removed (used in 18% of games) |
| Wild costs 1 | +21 | the exploit becomes real |

Human-like proxies (the bot restricted to 2,500 to 10,000 common words, or seeing only 30% of moves) finish with 23 or fewer tiles on 13% to 65% of boards, so real players sit exactly where the current bonus pays nothing. Under the ladder the bot's mean rises 6 points (goals +3%) while the casual proxies rise 9 to 14 points, and the expected run length of a casual player grows by about one level.

### Recommendations

1. Replace the step with the ladder: in `js/words.js` set `COVERAGE_BONUS = { 20: 5, 21: 10, 22: 15, 23: 20, 24: 25, 25: 30 }` and keep `FULL_COVER_TURN_BONUS = 10`, `WILD_COST = 2`, `SHORTFALL_PENALTY = 0`. Update the test in `test/words.test.js`, the help table and the README sentence. Trade-off: mild score inflation (bot +6), and the 24-to-25 jump shrinks from +15 to +5 before the turn bonus.
2. Leave the penalty dead and the wild price alone.
3. Only if you want a calmer finish: `FULL_COVER_TURN_BONUS = 5` together with `WILD_COST = 3` or a cap of one wild per board. Expect steadier goals (bot standard deviation 17 instead of 22) and a lower expert ceiling (maximum finish bonus 45 instead of 90).
4. Small legibility wins: show the ladder in the score popup, and mention in the help sheet that Nudge wraps A to Z (the bot manufactures Z, Q, X and J this way on about one lock in six).

### Questions for you

- How many tiles do your playtesters usually have locked at turn 20, and how often do they reach 24 or 25? The right size of a graded bonus depends on where real players land.
- Is the race-to-fill endgame the feel you want, or should the last words still be worth chasing?
- Are overlapping 5-letter words acceptable when paid for honestly (two turns per wild, worth about +2 points to a strong player), or do you want wilds rare by design? A one-wild-per-board cap is simpler than a higher turn cost.

## Goal-setting bot

### Verdict

- The search is set up the way I would expect for a yardstick: one-ply greedy over the 110 deterministic moves, valued by the best word each move makes available, a lock preferred unless a setup move is worth 6 more, a two-ply fallback when nothing works, no draws (random) and no wilds. The constants sit on plateaus: a setup margin of 0 costs 22 points, 3 costs 5, 10 is neutral; fresh-tile value 0 costs 8; dropping the two-ply fallback costs 4; always two-ply gains 6 at 36 times the compute. It is deterministic.
- What I would change is what the bot's score measures. It fills the board on 93% of boards with 3.2 turns to spare, so 29% of its score is fill and unused-turn bonus. The level-14 goal (100% of that, rounded up to tens) exceeds the bot's own word points by 50 or more on 60% of boards and exceeds the bot's own score on 91% of boards. A player of exactly the bot's strength (the same bot with shuffled tie-breaks) passes the level-14 goal only 28% of the time, passes a 70% goal 99.7% of the time, and passes a "100% of the bot's banked words" goal 97% of the time. Level 14 is a wall rather than a summit.
- Two fixes, pick one: base the goal on the bot's banked word points (`result.banked` is already returned, so this is one line in `computeGoal` and `ensureGoalNow`), which makes 100% reachable; or keep the full score and cap the schedule at about 80% with `Math.round` instead of `Math.ceil`.
- The bot leans on a trick most players never discover: nudging a letter inside an already locked word to spell a crossing word. It is worth 11 points per board to the bot and 70% of its compute. Either forbid it for the bot (one line in `legal()`, and three times faster) or teach it in the help sheet.
- The integration had four real bugs, all fixed on this branch: a late worker reply could re-save a finished game and offer a dead Continue; the board did not grey out when the goal landed from the worker; the synchronous fallback at scoring time had no error handling and could strand a level run; the worker cached a failed dictionary fetch forever. The word tie-break now uses code-point order instead of locale collation, so goals are identical on every device.

### What the numbers say

Shipped bot, 1,200 boards:

| Measure | Value |
| --- | --- |
| Score mean / p10 / p90 / min / max | 191 / 165 / 217 / 108 / 249 |
| Banked word points mean | 135 |
| Fill bonus mean, unused-turn bonus mean | 24, 32 |
| Full-board rate, turns used | 93%, 16.8 |
| Goal at level 1 / 5 / 10 / 14 (mean) | 72 / 110 / 158 / 196 |
| Bot reaches the level-1 goal by turn (median) | 8 |
| Run time per board in Node (mean / max) | 0.3 s / 0.9 s |

Pass rate of an equal-strength player by cap percentage: 70% 99.7, 80% 98, 90% 90, 95% 76, 100% 28.

### Recommendations

1. Yardstick: use banked points (`goalFor(level, result.banked)`), or cap at 80% and round to nearest. If bonuses stay in the yardstick, a 4% step per level keeps the ramp spanning about 12 levels.
2. Decide on the locked-tile nudge trick: forbid it for the bot, or document it for players.
3. Consider a smaller common-words dictionary for the bot only, keeping the full list for validating the player's words; the bot currently locks OHIA, WAFF, ZLOTE and the like.
4. Phones without module workers (old Safari and Firefox, some WebViews) run the bot on the main thread; the fallback now yields to paint first, but a chunked bot that plays one turn per frame would remove the freeze entirely.

### Questions for you

- Should a strong player be able to keep passing levels indefinitely, or is the run meant to end for everyone? That decides between "banked-points yardstick, 100% cap" and "full-score yardstick, 80% cap".
- Should the bar include the locked-tile nudge trick?
- Will seeds ever be shared between players (a daily board, challenge links)? If so, strict cross-device determinism matters more.

### Headroom and the level curve (from a second run, 200 boards)

A 3-move beam search beats the shipped bot by 8% on the median board (ratio p10 0.96, p90 1.23), so the bot is an adequate yardstick on a typical board but noisy at the tails: on seed 48 it scored 130 where the beam scored 216. A strong draw-free player modelled by that beam passes levels 1 to 10 essentially always, 87% at level 13 and 73% at level 14 and beyond; two-ply-class play stalls at level 12. Every bot-like strategy, including a deliberately crippled one, passes levels 1 to 8, so the 35% to 60% band is a warm-up and all the difficulty sits in levels 11 to 14. Letting the bot Draw changes nothing (+0.2 points), and "always two-ply" is 11 points worse because it oscillates. Two no-behaviour-change speedups are worth taking: break out of `botPlay` once the 25th tile is locked (the loop otherwise runs a futile 110 by 110 search; halves the mean time), and an allocation-light word scan (about 3 times faster).

## 6x6 grid option

### Verdict

- It works mechanically with small code changes, and the gesture board makes it feasible on a phone: with no arrow ring, six columns give 51 px tiles at 390 px wide and 48 px at 360 px (the old 8-column ring would have given 40 px, below the touch-target guideline).
- Turns are the real decision. With 20 turns the bot fills a 6x6 board only 8% of the time and runs out of turns on 86% of boards, so the completion bonus becomes a rare jackpot. 28 turns (20 scaled by 36/25) reproduces the 5x5 feel almost exactly: 88% full boards, 3.6 turns to spare, 16% of boards using every turn. 24 turns is a genuine "hard mode" where completion is a coin flip (48%).
- 6-letter bonus: letter sums are flat across word lengths (about 8 to 9 points), so the bonus is the whole progression. +30 is the exact quadratic continuation of 0, 5, 15; +25 is the linear one. The bot plays identically either way (1.2 six-letter words per board, on 72% of boards), and +30 costs about 6 points of bot score per board.
- Completion thresholds depend on the turn count: at 28 turns the current two tiers carry over as {36: +25, 35: +10} (paid on 88% and 7% of bot boards, the same frequencies as 25 and 24 on 5x5). At 24 turns add a tier: {36: +25, 35: +15, 34: +5}. At 20 turns the top tier would have to drop to about 31 locked tiles to pay as often as it does on 5x5, which no longer looks like a finished board.

### What the numbers say

6x6 with the bot, ENABLE 3 to 6 letter list, 6-letter bonus 25, 200 boards per row:

| Turns | Mean score | Banked | Full boards | 35 or more | Turns used | Boards using all turns |
| --- | --- | --- | --- | --- | --- | --- |
| 20 | 207 | 203 | 8% | 20% | 19.8 | 86% |
| 24 | 246 | 224 | 48% | 75% | 22.5 (when full) | 51% |
| 26 | 266 | 229 | 71% | 91% | 23.5 (when full) | 30% |
| 28 | 287 | 233 | 88% | 95% | 24.4 (when full) | 16% |
| 5x5, 20 (reference) | 187 | 135 | 89% | 99% | 16.7 (when full) | 15% |

Other facts: 98 tiles minus 36 leaves 62 in the bag, so draws never run dry; the vowel share of a deal is the same as on 5x5 (43%). The bot is 1.3 times slower per board at 20 turns and 3.5 times slower at 28 turns (1.3 s per board in Node, likely 3 to 8 s on a phone), because it searches 156 moves over 26 lines instead of 110 over 20. The shipped `bestMove2` caps its scan at the first 110 moves, which on 6x6 would silently skip 46 nudges; it must use the full move list.

### Recommendations

1. If 6x6 should feel like "5x5 but bigger": 28 turns, `LENGTH_BONUS[6] = 30`, `COVERAGE_BONUS = { 36: 25, 35: 10 }`, `FULL_COVER_TURN_BONUS = 10` (12 keeps the same weight relative to a word's value, but 10 is simpler).
2. If 6x6 should be the hard mode: 24 turns and `{ 36: 25, 35: 15, 34: 5 }`. I would not ship 20 turns unless you accept that completion almost never happens.
3. Dictionary: regenerate `data/words.txt` from ENABLE with 3 to 6 letters (28,743 words, about 182 KB instead of 75 KB); the 5x5 parser already drops 6-letter words, so one file can serve both sizes. The shipped list is exactly ENABLE 3 to 5, so nothing else changes.
4. Code: `SIZE` in `js/engine.js` is a shared constant (the number game and its puzzle bank assume 5), so the word engine needs a per-game size passed through `wordLines`, `lineCells`, `allActions`, `dealLetters` and the UI (the locked-tiles counter, the 20-segment turn track, the CSS grid, `COVERAGE_BONUS` keys, the tests). The bot needs `maxFirst` set to the move count and a time budget; computing the next board's goal while the current one is played would hide the longer run time. Rough effort: two to three days including the dictionary and a goal re-check.

### Coverage ladder for 6x6 at 25 turns (decided: 25 turns)

Same rule shape as 5x5, over the last eight tiles instead of the last six: **+5 per locked tile from the 29th**, so `{ 29: 5, 30: 10, 31: 15, 32: 20, 33: 25, 34: 30, 35: 35, 36: 40 }`, plus +10 per unused turn on a full board. Why 29: on 5x5 the ladder starts at 80% of the board (20 of 25); 80% of 36 is 28.8. Why the top is 40: the 5x5 top (30) scaled by 36/25 is 43, and a round 40 keeps the +5 step. Interpolating the 24- and 26-turn runs, at 25 turns the bot would finish with 36 tiles on about 60% of boards, 35 or more on 83%, 34 or more on 93% and 29 or more on virtually all, so almost every competent board earns something and the last tile is still worth +5 plus the spare-turn bonus. 25 turns itself was not simulated; the two neighbouring turn counts bracket it.

### Questions for you

- Should both sizes share one goal schedule? Goals are a share of the bot's banked points, so they self-calibrate, but the level curve will feel different if 6x6 boards are longer.

## Verification note

An independent numeric re-check of the simulation findings was planned but did not run (the session hit its usage limit). What stands behind the numbers: the baseline agent replicated its own results on a disjoint seed range; three scoring agents and the bot-strength agent independently measured the shipped bot and agree; `tools/wordbot-stats.js` reproduces the baseline from the repository. The strategy variants, wild-cost sweeps, human proxies and 6x6 runs are single runs of 150 to 300 boards each.

## Open questions, collected

1. ~~The name~~ decided: GridLock.
2. ~~Lock without confirmation~~ decided: immediate.
3. ~~Coverage ladder~~ adopted; +10 per unused turn kept.
4. ~~Bot yardstick~~ decided: banked points.
6. Goal schedule raised on 30 October: 50% at level 1 and +4 per level (100% from level 14) instead of 35% and +5, because with the banked-points yardstick the old start let level 1 pass with two or three words on either size (level-1 goals are now about 70 on 5x5 and 120 on 6x6).
5. ~~6x6~~ built: 25 turns, ladder from the 29th tile, +30 for 6-letter words, a 3-to-6-letter dictionary, a board-size choice on the home screen; `js/grid.js` holds the geometry and the 5x5 bot's play is unchanged (identical statistics before and after the refactor). The 6x6 bot takes about 0.55 s per board in Node and fills 45% of boards at 25 turns (20-seed sample), with goals from about 90 at level 1 to 240 at level 14.
