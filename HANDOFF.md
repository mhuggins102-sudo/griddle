# Handoff notes (session of 15 Nov 2026)

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

## The two background checks (stopped before every finding was verified)

Both ran as workflows: readers produced findings, then three independent refuters voted on each. All
readers finished; only part of the voting did, so the lists below mark each item as applied, confirmed
(majority voted real, not yet applied), unverified (no or partial vote) or refuted. Treat unverified items
as claims to check against the code before acting.

### Rules audit (How to play chapters and tutorial pages against the code)

Applied: see above.

Unverified, worth doing (text only):
- Chapter 1: "The score counts at the end of the board" is only true of a Single Round; in Multi Round the
  level is passed the moment the score reaches the goal.
- Chapter 2, Draw: "cannot be undone" has one exception, the Rewind card, which takes a draw back and
  rerolls the next letter. Undo paragraph: a retry of the board that ended a run also ends the moment it
  reaches that level's goal.
- Chapter 2 / code: on a retry of a perk-run board a Draw does not clear the undo history (the snapshot is
  kept for Rewind), so practice Undo there can step past a draw; either say so or clear the history on a
  draw whenever the board is not a gold-earning run (`perkRun()` instead of `perks()` in `doAction`).
- Chapter 3: "merely adds an ending" is really "another form of the same word" from the list's lemma
  table (LEAF then LEAVES is refused too; a few odd links such as MATTER after MAT exist); the exact-repeat
  rule applies anywhere on the board, not only on the same tiles; locked tiles can be freed by the Unlock
  card and changed by Letter Trade and Wild Card (chapter 9).
- Chapter 9: "A card's points show as their own line" is one perks tile whose popup lists each card.
- Tutorial, Lock page: nothing says what counts as a word (listed, 3 letters or more) or that a word
  cannot be locked twice; Word points page: three-letter words earn no length bonus; Filling the board
  page: the board kept is the one whose word points come closest to the share (up to six candidates).
- Tutorial, Perk cards page: only the nine move-making cards cost a turn (Fresh Deal, Unlock and the
  power tiles cost none); Tempo is Extra Turn, Borrowed Time and Rewind (no turn added by Rewind); card
  points sit in one perks tile (Head Start works through the tile bonus); the shop is open only while a
  board is in play; a targeted card is refunded if cancelled; gold is only earned in Multi Round.
- Card list (chapter 9): Gold Rush, Power Pair / Triple Up, Fresh Deal, Rewind, Hint, Extra Turn /
  Borrowed Time and Unlock texts were flagged for small omissions (what happens on cancel, timing, whether
  a turn is spent); two of these were refuted, the rest unverified. Check `cardText` in `js/perks.js`.

Refuted (leave as is): chapter 1 "unlimited undo", chapter 3 "no abbreviations", chapter 5's board-choice
and retry wording, chapter 6's bag notes, most chapter 7 and 8 additions, chapter 9's "at any time".

### Review of the daily grid / practice mode commit (4222ab7 and after)

Applied: see above (Undo after a pass, undoFloor after Rewind and Fresh Deal, frozen daily on resume,
reset keeping the daily records, accessible name, tutorial wording, README counts).

Unverified, worth doing:
- Outbox: a daily entry at the head of the outbox that the server refuses with a retryable error (schema
  not yet run) blocks the plain entries behind it until it succeeds. Fix idea: in `flush()`, on a
  non-final failure of a daily entry, carry on with the next non-daily entry in the same pass.
- A daily saved from an earlier day: the resume sheet shows its date and says giving it up counts as that
  day's try; the reviewers suggested a softer prompt for a stale grid (no "counts as played"). Judgment call.
- README still has a few old phrases around "level run" and switch counts; low priority.

Refuted: the stale-daily "presented as today's" claim (the resume sheet already names the day).

## How to verify things here

- `npm test` (82 node:test tests).
- Browser probes in `.scratch/*.cjs` (gitignored): start the dev server with `node tools/serve.js 8080`,
  then `node .scratch/<name>.cjs`; they print PASS/FAIL lines and screenshots next to themselves. The ones
  touched this session: leaderboard, tutorial, undo, endscreens, resultshots, round5, perks, search, shop,
  intent, floatclamp, statsshots, settingsshot, passwords, homefit, homegaps.
- `supabase/schema.sql` was verified on a local Postgres 16 as a fresh install, as an upgrade from each
  earlier version, and as a rerun.
