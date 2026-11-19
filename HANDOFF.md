# Handoff notes (session of 15 Nov 2026, updated 18 Nov)

18 Nov: Rewind steps back through cards played as well as moves and unplays them (gold refunded, card back in
the shop); every card play now leaves a tagged history snapshot and the old `undoFloor` is gone. Hint lights the
best lockable word for the rest of the level. New cards Lock (lock one tile, 5) and Diagonal Swap (corner-to-corner
swaps for the level, 5); Gold Rush costs 5. 31 cards, 86 tests; the perks and shop probes cover the new cards.

Where the work stands, what the two background checks found, and what is left for a later session.
Branch: `claude/gesture-ui` (deployed from there). Everything below is committed and pushed.

## One thing you still have to do yourself

Run the current `supabase/schema.sql` again in the Supabase SQL Editor (paste the whole file). Every
statement checks first, so a rerun only adds what is missing: this time the `daily_leaderboard` table,
`submit_daily` and `get_daily`, and the rename/remove functions learning to cover daily rows. Until it is
run, a daily grid's post sits in the player's outbox and is retried later (the plain score still posts).

## Done this session

- Leaderboard: eight boards (size x perk cards x high score / top level) plus the Daily Grid's per-day
  board; the sheet opens on Daily / Today from the home screen, with Today / Yesterday under Daily.
- Settings: Perk cards first (plain wording), Practice mode ("Unlimited undos; no stats/leaderboard") with
  a "Show available words" sub-switch that is dimmed until practice mode is on, then sounds and appearance.
  The device-data footnote is gone. Old saves that had the word list on count as practice mode on.
- How to play: an opened chapter snaps its title to the top. The tutorial gains a last page on gold and the
  shop when perk cards are on. Mode names: Multi Round (levels), Single Round (one board), Daily Grid.
- Practice mode applies to both rounds: it offers Undo (as far back as the last draw or the last perk card)
  and, with the sub-switch, the word list; the list never shows under a result sheet. No undo otherwise.
- Daily Grid: one board a day for everyone, 5x5 or 6x6 as the day decides (`js/daily.js`), one try; once
  today's is played the button offers yesterday's if it was missed, then waits for tomorrow; a daily given
  up for another game counts as played; the result card's trophy opens that day's leaderboard alone.
- Home: Daily Grid, the size switch, Multi Round, Single Round; no Continue button (the mode with a game
  in progress is highlighted and pressing any mode offers to continue or start over); nothing is
  highlighted when no game is in progress.
- From the two background checks (below), the clear findings were applied in the last commit: "one gold
  coin" restored in chapter 9 (a rename had mangled it), Undo's accessible name, "Wild costs two" in
  chapter 1, chapter 2 and the tutorial, chapter 9 title without "(experimental)", chapter 3's wild
  wording, chapter 7's replay sentence, chapter 8's name-prompt sentence, chapter 9's shop and dimmed-card
  sentences, the tutorial's "Multi Round" and "percentage points" wording, README mode names and function
  count; Undo is refused once a level's goal is reached and while a card is armed, and clears a lit hint;
  `undoFloor` is clamped after Rewind and reset by Fresh Deal; a board saved with its last turn spent is
  scored on resume in every mode; a practice board resumed with the setting off still says it is not
  counted; a reset that keeps the leaderboard name keeps the daily grids played; the rulebook's "Watch the
  tutorial" passes the saved game's mode.

- Word list: the whole of ENABLE (28,743 words of 3 to 6 letters, the public-domain stand-in for the
  Scrabble dictionary) plus the modern supplement is now accepted, in two tiers in `data/words.txt`: the
  common tier first (exactly the old list, most common first), then a `#rare` line and the rest. The bot
  (which sets level goals) and `isCommonWord` use the common tier only, so goals are unchanged; players
  can lock any listed word. Rebuild with `node tools/build-words.js --sources .scratch/dict` (sources are
  downloaded with curl when missing).

## The background checks (all findings now verified)

Two workflows read the rulebook, the tutorial and the daily-grid commit and raised findings; a third
workflow later verified every finding that the first two had left unvoted, with three independent readers
each. Everything that was confirmed has been applied (the last commits on the branch); the rest was refuted.

Applied from the audit and the review: Wild costs two turns (chapters 1 and 2, the tutorial); chapter 1
says Multi Round ends a board the moment the goal is reached; chapter 2 names the Rewind card as the one
way to take a draw back, and the retry's early end; chapter 3's exact-repeat rule applies anywhere, the
ending rule is stated as forms versus words made with a suffix, and Unlock / Letter Trade are pointed
to; chapter 7's replay sentence, chapter 8's name prompt, chapter 9's title, shop, dimmed-card and perks-
tile sentences; the tutorial's Lock, Word points, Filling the board and Perk cards pages; the Hint and
Unlock card texts; the README's stale counts and names. Code: Undo refused after a pass or with a card
armed, undoFloor clamped after Rewind and Fresh Deal, a board saved on its last turn scored on resume, a
practice board resumed with the setting off still marked, a reset keeping the daily grids played, Hint
refunded when nothing can be lit, Fresh Deal carrying over the cards played before the first move, a
stuck daily entry no longer holding the plain outbox entries back, the resume sheet naming the daily's day.

Refuted (leave as is): chapter 1 "unlimited undo", chapter 3 "no abbreviations", chapter 5's board-choice
and retry wording, chapter 6's bag notes, most chapter 7 and 8 additions, chapter 9's "at any time", the
Gold Rush and Power Pair / Triple Up texts, and the claim that practice Undo could step past a draw on a
retry of a perk-run board (undoable() already refuses a draw snapshot).

## How to verify things here

- `npm test` (86 node:test tests).
- Browser probes in `.scratch/*.cjs` (gitignored): start the dev server with `node tools/serve.js 8080`,
  then `node .scratch/<name>.cjs`; they print PASS/FAIL lines and screenshots next to themselves. The ones
  touched this session: leaderboard, tutorial, undo, endscreens, resultshots, round5, perks, search, shop,
  intent, floatclamp, statsshots, settingsshot, passwords, homefit, homegaps.
- `supabase/schema.sql` was verified on a local Postgres 16 as a fresh install, as an upgrade from each
  earlier version, and as a rerun.
