---
paths:
  - "src/archive.js"
  - "src/archive.test.js"
  - "src/stats.js"
  - "src/stats.test.js"
  - "src/Stats.jsx"
  - "src/Stats.css"
  - "src/inactive.js"
  - "src/inactive.test.js"
  - "src/store.js"
  - "src/store.test.js"
  - "src/Chip.jsx"
  - "src/Chip.css"
  - "src/FormPips.jsx"
  - "src/FormPips.css"
  - "src/format.js"
  - "src/dates.js"
  - "src/dates.test.js"
  - "src/Modal.jsx"
  - "tools/import-legacy.mjs"
  - "tools/verify-stats.mjs"
  - "tools/make-sample-archive.mjs"
  - "tools/make-stress-archive.mjs"
---

# The archive, career stats and name editing

Detail behind **Match archive and stats** in the root `CLAUDE.md`, which holds the facts
that reach outside these files. Three subsystems that share a data model: the records
themselves, correcting the names on them, and marking a player inactive.

## Match archive and stats

- **Nothing new is recorded to make the stats work.** `rounds` already held
  every bag's resting tier; the app was simply discarding it at `New game`. So
  don't add fields to game state for a stat before checking whether it is
  already derivable — most are.
- **Only a won match is archived**, and undoing the winning round takes it back
  out. Abandoning a game leaves nothing, because a three-round fragment would
  drag every average around. A `casual` game is never archived however it ends —
  see **Guest games** in `.claude/rules/scoring.md`.
- **The archive is keyed by match id and upserted, not appended.** Win → undo →
  re-win is an ordinary sequence and must leave one record, and a reload of a
  won game re-commits the same one rather than a duplicate. The first `endedAt`
  survives an upsert, so reopening a finished game doesn't move when it
  finished. The effect in `App.jsx` compares against the archived id rather than
  holding a flag, which is what makes all of that idempotent.
- **The stats screen can't be reached with a won game still loaded**, and the
  archive depends on it. `stats` is only reachable from `setup`, and the only
  route from `play` to `setup` is `startNewGame`, which clears the winner; a won
  game restored from storage opens on `play`. So by the time a match can be
  deleted, its game is no longer loaded, and the mount-time archive cannot
  resurrect it. **If Stats ever becomes reachable from the play screen, that
  breaks** — deleting the live match would then undo itself on the next reload,
  and the effect would need to remember the deletion. Checked before adding a
  guard for it, which turned out to protect nothing and to cost the backfill
  below.
- **A won game that was never archived is filed on the next load.** That's the
  retry path when a write failed on a full localStorage, and it is why the
  effect archives on mount rather than only on the transition into won.
- **A match duration needs `matchDuration()`, never a bare subtraction.** A
  record archived before `startedAt` existed — a game already in play when the
  field shipped never passes through **Start game** — has no start stamp, and
  `(endedAt ?? 0) - (startedAt ?? 0)` measured from the epoch and reported
  **32 years**, silently wrecking the average length rather than failing. The
  guard rejects a zero or negative start as well as a missing one, because these
  are `Date.now()` stamps and an imported file can carry a `0`.
- **The expanded match view uses the in-play history's shorthand** (`◎` hole,
  `▬` board) so the two read alike — keep them in step. The one thing it adds is
  the **running score after each round**, which the in-play panel structurally
  can't show because there it is always just the current total. `matchRounds()`
  derives it; the row's own final score is the last round's running score, and
  `verify-stats.mjs` asserts exactly that so the two can't drift.
- **Leaving the game only confirms while a game is unfinished.** It used to ask
  after a win too, which made sense when `New game` destroyed the only trace of the
  match — the archive changed that, so the prompt was guarding something no
  longer at risk, at the moment you are most likely to want the next game. The
  residual cost: a mis-scored winning round can no longer be corrected once you
  have moved on, so `Undo round` has to be used first.
  - **The button says which of the two it is**, reading `Abandon game` in red while
    a game is under way and `New game` once there is nothing left to lose. One
    `abandoning` const in `App.jsx` names it, colours it and decides whether it asks,
    so the three cannot disagree — a red `Abandon game` that goes straight through
    is the failure this shape rules out. It is outlined rather than filled for the
    reason `.tournament-drop` is: the filled red belongs to the dialog that asks.
    **`Abandon` is the app's word for giving up something unfinished** — the
    tournament screen already picks between `Abandon` and `Delete` the same way, so a
    new one of these takes that verb rather than inventing `Discard` or `Quit`.
  - **`verify-stats.mjs` covers it as a pair, and only as a pair.** It clicks the
    button *by name* after a win and again mid-game, so a label stuck either way
    round fails one of the two. Nothing below `App.jsx` can see this.
- **Deleting is one tap plus an undo, not a confirmation.** The undo bar sits
  outside the match list, because deleting the last match empties the list and
  would otherwise take the way back with it. Undo is lost on leaving the screen;
  export is the real backstop.
- **Records carry a `format` stamp.** When the state model becomes an event log
  (planned for when the board sensors land), round-level snapshots need to be
  distinguishable from event streams without guessing at the shape.
- **A record keeps `rounds` in exactly the game's shape**, so `totals()` and the
  other scoring helpers read a record unchanged and `stats.js` never
  reimplements them. Don't "tidy" the record into a different shape.
- **Doubles attribution is `roundIndex % 2`**, defined once in `throwerSlot` and
  read by `throwerFor` and `gameStats`, mirroring `activeIdx` in `App.jsx` (which
  reads `throwingEnd` from `scoring.js`). If those ever disagree, every doubles
  stat is silently mis-credited with nothing failing — `stats.test.js` pins it.
- **In-game stats are the same accumulation as career stats, not a second one.** A
  live game and a record hold `rounds` in the same shape, so `foldRound` folds a
  round for both and `gameStats` adds no counting of its own. `playerStats` can't
  simply be called with the live game: it would count `matches += 1` and push a
  loss for a `winner: null` game, reporting an unfinished game as 0–1.
- **`gameStats` keys by team and slot; `playerStats` keys by name.** Within one
  game the slot *is* the identity — two teams on one name are two different people,
  and name-folding them would merge two rows on the screen you're looking at while
  you play. Across a career, folding by name is the point. Don't unify the two. The
  setup screen no longer builds such a lineup, but an older save or an imported
  record still can, so the rule stays.
- **`id` and `startedAt` live in `App.jsx`, not `scoring.js`**, which stays pure.
  `startedAt` is stamped when **Start game** is pressed rather than at
  `newGame()`, because the setup screen can sit open indefinitely and that time
  isn't part of the match.
- **The archive has its own localStorage key** so `New game` can't clear it, the
  same reasoning as the scoreboard settings.
- **`saveArchive` never deletes to make room, and it reports a refused write** —
  `{ saved, stored }`, the shape `saveTournaments` and `saveInactive` return, where
  `stored` is what storage actually holds so a caller cannot set state from a write
  that did not land.
  - **It used to prune and retry**, dropping `records[0]` and calling that the oldest.
    That is *insertion* order and `mergeMatches` appends, so after an import it
    destroyed this season's games and kept the 2015 ones — the exact opposite of its
    own comment. Silently, since in-memory and stored state stayed in step, and the
    import notice counted the survivors: measured, importing 50 into a near-full 200
    destroyed 49 and reported **"Added 1 match."**
  - **Sorting the prune by `endedAt` was the smaller fix and is still wrong.**
    Measured, Chrome gives this origin 5,242,880 characters and a real match with
    rounds is 1,546, so the archive fills at ~3,400 matches — about 34 years at 100
    games a year. Natural play never reaches it; an oversized import does, in one tap,
    and there deleting local history to fit somebody else's file is the wrong answer
    under any ordering. Saying it didn't fit is the whole feature.
  - **So every caller settles the write.** `App.jsx`'s archive effect only latches
    `archivedId` on `saved`, which keeps the file-it-on-the-next-load retry path;
    `Stats.jsx` routes every refusal through its `notice`.
- **Nor does it overwrite what it could not read, which is the other way a write
  destroys history, and both live in `store.js` now** — one factory over the three keys
  that hold a whole document, because the rule is one rule and a copy per module is how
  two of them come to disagree. `loadArchive` and `saveArchive` are `store.load` and
  `store.save`; `archive.js` keeps its pure half exactly as it was.
  - **The read fails soft and the *write* is what refuses.** `loadArchive` returning
    `[]` for a shape it cannot parse was never the destructive part on its own — the
    damage is the unconditional write that follows it. Measured against a
    `{format: 2, matches: [...300]}` envelope, the shape a later version would
    plausibly write: winning one game took **296,012 characters holding 300 matches to
    990 holding 1**, and a one-match import did that *and* replaced the tournaments and
    the inactive marks, reporting "Added 1 match". Merely opening the app cost nothing.
  - **Absent still means empty, and that separation is the whole guard.** `getItem`
    gives `null` for a key never written and `JSON.parse(null)` is `null` rather than a
    throw, so absent has to be answered *before* the parse — otherwise a first run reads
    as the failure and the phone can never store its first match. `store.test.js` pins
    both directions; the mutation that drops that early return fails only the
    never-stored-one case.
  - **Refusing costs less than writing, which is why it refuses rather than repairing
    or moving the value aside.** A phone stops recording until it updates — which a PWA
    does by itself — where a write costs the history outright, and the game is
    unaffected either way, being under its own key and still playable. A sidecar key
    holding the unreadable value was the alternative and buys nothing: nothing would
    ever read it back.
  - **The refusal carries a `reason`, and the second message is not decoration.** The
    full-archive wording sends you to export and delete, and with an unreadable archive
    the tables on screen are *empty* — that export would be saved as a backup of
    nothing and there is nothing listed to delete. `refusal()` in `Stats.jsx` chooses;
    `verify-recovery.mjs` is the only thing that can see the choice.
  - **An array under the inactive key is as unreadable as a string is.** The marks are a
    plain object and nothing has ever written a list, so `plainObject` is the predicate
    there where the other two take `Array.isArray`.
- **The summary chips take a singular label at exactly one**, and both word forms are
  spelled out rather than derived: "wash" and "match" take `es` while "round" takes `s`,
  so a suffix rule gets one of them wrong. Zero stays plural, as English has it. **The two
  averages stay plural whatever they read** — a decimal is plural, so "1.0 avg rounds" is
  correct and making it agree with the value would be the bug. `verify-stats.mjs` needs
  *two* seeds to cover this: no single match yields both `1 round` and `1 wash`, because a
  wash needs a second round to have anything to wash against.
- **`Stats.css` is separate from `App.css`** because that file's responsive
  tiers have to stay last in source order, so appending base rules there is a
  trap.
- **The archive is per-browser, and on iOS it is not safe by default.** Three
  separate boundaries, all easy to miss:
  - `localStorage` is per-origin per-browser, so two browsers on one phone are
    two histories.
  - On iOS a **home-screen web app does not share storage with Safari** — same
    origin, different container. Scoring sometimes from the icon and sometimes
    from a Safari tab silently builds two archives.
  - **ITP deletes script-writable storage after seven days of Safari use with no
    interaction on the site.** Home-screen apps are exempt (they keep their own
    counter tied to actual use, and WebKit calls first-party deletion in an
    installed app a bug), but a plain Safari tab is not. An occasional game is
    exactly the pattern that trips it.

  So `requestPersistence()` runs at launch and the answer is *shown* on the
  stats screen rather than only requested: WebKit grants by heuristic — chiefly
  whether this is a home-screen app — and never prompts, so without surfacing it
  there is no way to tell a protected archive from one about to be deleted.
  `null` means the browser wouldn't say; don't collapse it into `false`.
- **Import merges by match id and is idempotent.** Re-importing the same file,
  or one that overlaps another device's history, adds nothing. Of two copies of one
  match the more recently *edited* one wins and a tie keeps the local copy, so an
  unedited import can't rewrite local history — see **Editing names** for why that
  is a comparison and not simply "local wins". `validRecord` gates every entry
  because the file came from a picker and could be anything — it checks exactly the
  fields `stats.js` reads without checking.
- **`Start game` sits at the top beside the mode toggle, and that retired a long
  fight over pixels.** It is the one control pressed every game, the names persist
  between games so there is usually nothing to fill in, and **above everything else
  nothing below it can push it off the first screen** — measured, it now clears the
  fold by 682px on a 393x852 iPhone and 529px on a 375x667 SE, in both modes.
  - **So the pre-game form panel's placement is a free choice again.** It used to be
    pinned *below* `Start game` because that button sat near the bottom and anything
    above it cost the one action you take every game. That reasoning is spent; the
    panel stays where it is because that is where you read it while waiting, not
    because it has to.
  - **`verify-stats.mjs` used to assert `Start game` does not move** when the panel
    is hidden. That became true by construction — the button now precedes every
    panel in the DOM — so it was replaced with the property it was always chasing:
    the button is above the fold in both modes with everything present. **A check
    that cannot fail is worse than no check**, because it reads as coverage.
  - For the record, since the numbers took several passes: before this the bottom
    edge sat 26px below the fold in singles and 131px in doubles (141/263 on an SE),
    which came from a court tap hint costing 17px on top of 9/131 and 124/246, which
    came from easing the wordmark's tilt and trimming its viewBox (46px). An earlier
    doubles figure of 135px never reconciled — doubles adds ~122px at *both* widths,
    so it was wrong.
- **The team card is one row per player, and the colours sit beside them.** Both
  facts are about height: the swatches were a horizontal strip on their own line,
  and moving them to a 2x2 grid in a right-hand column took the doubles card from
  140px to 100px and the singles card from 100px to 76px. **2x2 and not a vertical
  strip** because four stacked 20px circles need 98px and two player rows only give
  80px, which would have made the card taller in singles than it was before.
  - **The two board chips share a grid column, which is why they are the same
    width.** `.field-rows` is one grid for both players and `.field-row` is
    `display: contents`, so the chip track sizes to the widest label across both
    rows ("start board"). Sized any other way the two names sit at different offsets,
    which is what it looked like before and reads as broken. It also keeps a row
    element for tests and state to hang off, the same trick `.side-rail` uses.
  - **The cost is name width: the input went 219px to 161px in doubles** (143px on
    an SE), so a name over about 12 characters scrolls inside the field rather than
    being fully visible. Shortening the chips to "start"/"far" buys 35px back and was
    the deliberate trade not taken — the full label explains itself. The names stay
    centred rather than left-aligned: they sit 62px left of the card's centre, but
    the input's underline gives the eye its reference so it reads as intended.
- **`played` is not `matches > 0` for the sake of it.** It distinguishes a genuine
  zero from no history, which is what lets both the panel and the board say "first
  game" rather than reporting somebody as 0% of everything. `lineupPayload` uses the
  same flag to publish nothing at all when *nobody* in the roster has played.
- **`sideRecord` exists because `headToHead` cannot answer the doubles question.**
  H2H credits partners individually, so a doubles matchup reads as four cross-pairs
  when what is actually argued about is whether this pair beats that pair. Sides are
  matched as unordered name *sets*, so the same people count whichever team letter
  and whichever slot order they held at the time — and a *different* pairing of the
  same four people is deliberately a different matchup.
- **`gameStarted` lives in `scoring.js`, not `App.jsx`.** The scoreboard needs it
  too: the form screen is published while it is false, so "the game has begun" has
  to mean one thing to the screen and the board.
- **The archive is held in `App.jsx` state now, not only inside `Stats`.** The form
  panel and the scoreboard publisher both read it and both live above that screen.
  `archiveMatch`/`dropMatch` return the saved list, so the effect sets state from
  what it just wrote rather than re-reading. `Stats` still owns its own copy while
  open — it deletes, restores and imports — and `App` re-reads on the way back;
  without that a deleted match keeps appearing in the form panel until a reload,
  which is what `verify-stats.mjs`'s deletion context covers.
  - **A career rename is the exception and re-reads at once, not on the way back.**
    Every other mutation on that screen only changes the archive, so a stale copy is
    merely old; a rename also reaches the live lineup through the `renamePlayer`
    dispatch, so between the two the app holds a name its archive has never heard of
    — and publishes it to the board as 0-0, "no matches yet", for as long as the
    stats screen stays open. `savePlayerRename` has already written by the time
    `onRenamePlayer` runs, so `loadArchive()` there is the whole fix.
    `verify-form-screen.mjs` is the only place that can hold it: leaving the screen
    hides it, and while `Stats` is open the setup screen's own Form panel isn't
    rendered, so the published lineup is the sole surface the disagreement reaches.
- **A record can carry a result and no rounds, and `final` is the only field that
  buys.** Games played before the app existed are transcribed from a written-down
  score by `tools/import-legacy.mjs`; they have a date, the people and the score.
  - **The score has nowhere else to live, which is the exception that justifies the
    field.** Everything else `stats.js` reports is derivable, but `totals()` sums
    `round.nets`, so a record with no rounds loses the one number it actually has.
    `finalScore()` reads `final` **only when `rounds` is empty**, so it is a
    fallback and never an override — a real record cannot contradict its own detail.
  - **Synthesising a round to carry the score was the obvious alternative and is
    worse.** Rates are per thrown bag, so fabricated tiers would put invented hole
    and board counts into every career figure; one fake round also makes `avgRounds`
    read 1 and PPR read 0.0 over a round that was never thrown. Empty `rounds` is
    the honest shape, and `validRecord` already accepts it — `[].every()` is true —
    so nothing was needed to *store* these.
  - **Three things went wrong quietly rather than loudly**, and all three are the
    same mistake: reading a zero derived from no data as a real zero.
    - `summary` took the loser's total from `totals()`, got 0, and filed **every
      imported match as a skunk**. Hence `finalScore` returning null rather than
      0–0 for a record with neither rounds nor `final`.
    - `avgRounds` divided by every match, so twenty imports beside five real games
      reported a 12-round game as a 2.4-round one. It divides by the matches that
      have rounds.
    - The Form panel, the career table, `?display=1` and the LED panel all keyed
      their rate off "has history", which an imported result has — so somebody with
      a dozen games read **0.0 PPR**. See the next bullet.
  - **The rates of anyone who also plays are untouched, and that is the property
    that makes importing safe at all.** A rate is per round thrown and these add no
    rounds, so an import moves only the win/loss side of a career. `stats.test.js`
    asserts it directly rather than leaving it to be inferred.
  - **Dates only need to be in the right order.** `endedAt` drives `chronological`,
    which is what streaks and form read; the absolute value shows only in Recent
    matches. The script stamps local noon plus a minute per game that day.
  - **Ids are a hash of the line, not random.** `mergeMatches` keys on the id, so
    re-running the script and re-importing has to add nothing. Counted per identical
    match rather than per line, so inserting a game later doesn't renumber the rest
    into new records. No `updatedAt`, so a name fixed on the phone survives a
    re-import.
  - **The unused singles slot is left empty, not filled with `Player 2`.**
    `participants` drops a blank; a default name would collect every singles
    opponent under one phantom career.
  - **A name on both sides is refused by the script**, which is the setup screen's
    rule rather than the archive editor's — the source is a file that can be
    corrected, so it costs a keystroke. See **Nobody can play themselves**.
  - **A name containing `&` or a comma cannot be transcribed, and this is the one
    place left where such a name is misread.** Partners are separated by `[&,]` with
    optional spaces, which is looser than the app's `" & "` — so `Ben&Jerry` splits
    where `sideLabel` would have kept it whole. Deliberately not tightened: that is
    the file format, and it mostly fails loudly, because a side must hold one or two
    names and both sides must hold the same count (`Neil v Ben&Jerry` is refused as
    "1 against 2"). Only a symmetric line slips through — `Alpha&Beta v Gamma, Delta`
    imports as a doubles match of four people. Correct the file.
  - **A draw is refused too, and a null winner is not the tolerant option.**
    `playerStats` credits a loss to whichever side isn't the winner, so a
    winnerless record puts a loss and an `L` against *both* names, while
    `headToHead` and `sideRecord` skip the match entirely — wrong in two
    directions at once. The loser's score is also bounded below the target, since
    the match ends when the first side reaches it; the winner's is not, because a
    round nets up to 12.
- **`tools/fixtures/sample-archive.json` is checked in, and it is generated, not
  written.** `make-sample-archive.mjs` plays the modern half through `scoring.js`
  bag by bag and puts the legacy half through `import-legacy.mjs` — the same rule
  `stats.test.js` follows, so the fixture cannot disagree with the rules it exists
  to exercise. That is also why `parseGames` is exported from `import-legacy.mjs`
  rather than the shape being written out twice.
  - **Seeded and absolutely dated**, so re-running is byte-identical; a checked-in
    file that regenerates differently is a permanent diff. Nothing in it calls
    `Date.now()` or `Math.random()`.
  - **The skill spread is narrow on purpose.** Under cancellation the losing side
    scores nothing in a round it doesn't win, so a wide spread shuts people out at
    a rate nobody would recognise — measured, Neil on 0.34 against 0.14 skunked
    **11 of 78** played games. It is 5 of 105 now.
  - **`Upsilon` stops at the cutover**, which is what gives the career table a row
    that is all record and no rates. Without it nothing in the fixture shows the
    dashes, and they are the thing most likely to regress. He is also the one
    person marked **inactive**, for the same reason: somebody who has stopped is
    who that feature is about, and the mark goes through `markInactive` rather than
    being written out, because a stamp behind the person's last match hides nobody
    and nothing on any screen would look different.
  - **The cup has six editions, and that is the only way to have a series to look
    at** — `seriesKey` reads the names, so a fixture with one cup exercises none of
    it. They deliberately span every shape: two transcribed results (one listing its
    field, one remembering only the winner, so `fieldKnown` is covered both ways), a
    transcribed *sheet* whose ties carry no round detail, two played in the app, and
    one still running. A one-off cup and a second, finished series sit beside them —
    the first is what says the Series section draws only where a name has been used
    twice, and the second is the only thing `nextEditions` will offer a name for.
  - **`src/archive.test.js` holds the committed file to `validRecord`**, because
    the generator only validates at the moment it writes and `mergeMatches` drops
    a bad record *silently* — the fixture would half-import with nothing to say so.
  - **It also asserts no record puts one colour on both teams.** The app's swatches
    make that unreachable by playing, so a fixture showing one would be showing a
    state nobody can get to. See the next bullet for why the *importer* doesn't
    refuse it.
- **`nameSlots` lives in `scoring.js` now, not here.** The live game's `validGame` needs
  the same test, and a second definition would let one of the two accept a lineup the
  other rejects — the same reason `nameKey` is there. `validRecord` is otherwise
  unchanged, and deliberately keeps requiring an id where `validGame` doesn't: a record
  is only ever created with one, whereas a save can predate them. See
  `.claude/rules/scoring.md`.
- **An imported record may carry the same colour on both teams, and that is left
  alone deliberately.** `validRecord` gates the fields `stats.js` reads without
  checking, and colour is not one of them — refusing a whole match over decoration
  would destroy real history, which is the archive's standing rule (the records
  most in need of an edit are the malformed ones). Neither `import-legacy.mjs` nor
  the sample generator can emit one; a clash means a hand-edited file.
  - **Nothing becomes ambiguous, and that is why it needs no fix.** Measured on a
    seeded clash: the Recent row still reads `Neil v Rho`, the expanded table's
    column heads are still `NEIL` and `RHO`, and the columns are positional — the
    colour is never the sole identifier the way it is in a casual game. It just
    looks wrong.
  - **The one genuinely ambiguous case needs two hand edits, not one.** With
    `casual: true` *and* an in-palette clash, `teamLabel` returns the colour name
    for both sides and the match reads `Blue v Blue`. A casual game is never
    archived, so that flag can only arrive by hand. An *off*-palette clash is
    already safe — `playerLabel` falls back to `Team A`/`Team B`.
- **`FormPips` is the one definition of a form line**, drawn by the setup screen's
  Form panel and by the career table. It was private to `Lineup.jsx` until the
  table wanted one, and two copies of "what a run of results looks like" is the
  failure with no symptom. The classes are `form-line-*` and **not** `form-pip`,
  which `Display.css` already owns — `main.jsx` imports `Display` statically, so
  that stylesheet is loaded on this route whether or not the display is on screen.
  - **Only the setup panel passes a colour**, because only it has teams; the
    career table falls back to the stylesheet's default. That prop is the one
    thing sharing the component could silently drop, so `verify-stats.mjs` asserts
    the panel's lit pips carry an inline background.
  - **A short history draws fewer pips, not five padded ones**, right-aligned so
    the newest sits in the same column on every row — the same reasoning
    `drawPips` in `render.h` already carries for the LED panel.
  - **The column costs 71px** and takes the phone's overflow from 235 to 306px.
    It sits straight after `W–L`, which is where it is *reachable*: the table
    scrolls sideways and only `Player`, `P`, `W–L`, `Last 5` and `Rds` are on
    screen at 393px without scrolling.
  - **`Streak` was checked for redundancy and kept.** Pips can only show five, and
    measured on the sample the column is 9 of 11 dashes — but both non-dashes are
    `7W` and `6W`, runs *longer* than the pips can show. It earns its place in
    exactly the case they cannot cover.
- **Head to head is scoped to a selected player, and the unscoped list is gone.**
  It grew as `n(n-1)/2` — 42 rows at the sample's 11 players, and the real family
  game is 12, so up to 66. But volume was the lesser fault: `headToHead` keys a pair
  low-name-first, so a given player sits on the *left* of some rows and the *right*
  of others and you had to check both columns of every row to find yourself. There
  is no usable find-in-page on iOS Safari.
  - **`opponentRecords` is the fix and the flip is the point of it.** It reads
    `headToHead` rather than folding the matches again — one definition of who beat
    whom — and returns every opponent from the subject's own point of view, so a row
    is always `wins`/`losses`. Scoped, the sample goes 42 rows to 10.
  - **The rivals list needs a `W–L` caption where the old one didn't.** The old rows
    bracketed the score between both names, so which way round it read was
    self-evident; with one name, `Sigma 13–18` does not say whose 13 that is.
  - **`dominates` is the same list read from the far end**, so the two can never
    name the same opponent — one needs a positive deficit and the other a negative
    one, and nobody qualifies at zero. Deficit for the same reason: beating somebody
    five times out of thirty is not dominating them.
  - **The recent match list is scoped to the same selection, and that is a fix
    rather than a flourish.** It is hard capped at 12, so anyone outside the newest
    twelve had *no* visible history at all — measured on the sample archive, four
    of eleven players, one of them with **37 matches played**. Selecting them now
    shows their twelve.
    - **`playedIn` decides, not the record's `players` arrays.** It reads the
      mode's roster, the same rule `playerStats` credits by, so a singles record's
      unused second slot does not list a match for somebody who never threw in it.
      One unit test covers exactly that.
    - **It is also why the recent list shows the year, always.** A scoped list
      spans years — Tau's reads `10 May, 18 Dec, 23 Nov` — and crossed a boundary
      silently. Showing it only outside the current year was considered and
      rejected twice over: the meaning would sit in its *absence*, which you have
      to know the rule to read (the same fault as the shaded nemesis row), and the
      width has to be reserved either way or the names step in and out, so the
      conditional version pays the full cost and buys an inconsistent format with
      it. It would also key the text off `Date.now()`, so a match grows a year in
      January and any check on it passes by season.
      - **Measured, it costs one clipped label at 375px** (1 of 12 to 2) and
        nothing at 360 or 320, which already clip. `.recent-date` went 52 to 64px,
        which is what `30 Sept 25` needs — `Sept` is the widest month abbreviation.
        **Which is why `dates.js` pins `en-GB` rather than taking the device's
        locale**: that width is measured against this format, and en-US would draw
        `Sep 30, 25` into a column sized for the other one. It also stopped every
        assertion on the text passing on a UK Mac and failing on a CI runner, which
        sets `LANG=C.UTF-8` — `src/dates.test.js` now spells the strings out.
      - **`verify-stats.mjs`'s fixture spans three years with dates of differing
        width on purpose.** With uniform dates the fixed-width assertion cannot
        fail, because a content-sized column would be uniform too — verified by
        mutation, which is how that was caught after it was written.
    - **The summary chips stay archive-wide on purpose.** They are totals over the
      whole history, and the per-player versions of most of them already sit in the
      career table — scoping them would duplicate it. The ones with no per-player
      equivalent (washes, skunks, average length) would be a new feature rather
      than a scoping of an existing one.
  - **The two are *named* on their rows, not shaded.** A darker row says something
    is special without saying what, and the row has the space for the word. The tag
    is a **sibling** of the name rather than inside it, so a long name ellipsises
    against the tag instead of taking it off the end — which also meant `.h2h-name`
    giving up `flex: 1` and `.h2h-score` taking `margin-left: auto`, or the tags sit
    against the numbers rather than beside the name they describe.
  - **The row tag reads `dominated`, the heading reads `dominates`.** The heading is
    a sentence about the subject; the tag is an adjective about the opponent, and
    `DOMINATES` on their row reads as though they are the one doing it.
  - **`nemesis` is `losses − wins`, not most losses**, and the difference is not
    cosmetic. Raw losses cannot tell "beats me" from "plays me a lot": measured on
    the sample it made Neil — who is in 82% of the matches — the nemesis of **7 of
    the 9** eligible players, and it made **Sigma's nemesis Neil, a matchup Sigma
    leads 18–13**. A positive deficit structurally cannot name somebody you are
    beating. Worst win *rate* was the third candidate and is worse again: it rewards
    tiny samples, so it needs a threshold high enough to exclude newcomers outright.
  - **Every join in the heading is the same `DOT`**, including the one after the
    player's name — that one was a `margin-left` on `.rivals-sub` and read as
    unevenly spaced against the dot beside it, because the heading's
    `letter-spacing: 0.08em` adds to the gap and the sub resets it to 0.
  - **The column captions live inside the bordered box**, in a `.rivals` wrapper
    that carries the border while `.h2h` gives up its own. Outside it they read as a
    stray line floating above an unrelated list.
  - **A tied deficit needs no extra comparator.** With the deficit fixed,
    `losses = (met + deficit) / 2`, so sorting by meetings *is* sorting by losses.
    It looks like a different tie-break from the one specified; it isn't.
  - **Neither is a real state**, not a zero — nobody has the better of them and
    they have the better of nobody. Same distinction `played` draws between a
    genuine zero and no history. One can be absent without the other.
  - **Rename moved out of the table entirely, into that panel.** A pencil in a
    far-right column was the obvious answer and is wrong here: measured, the Players
    table overflows a phone by **198–235px** and the name column is the only cell
    always on screen (`position: sticky`), so a far-right control sits off-screen and
    renaming would mean scrolling the table sideways. Putting rename *in* the panel
    mirrors `Edit names` in the expanded match, and makes the mis-tap it was meant to
    prevent **structurally impossible**: there is no control in the table, so a tap
    can only select. The cost is that rename is a two-step discovery, which is right
    for something done once a year against something done every visit.
  - **The name button carries the cell's padding, not the cell.** Otherwise the tap
    target is the 57x20 the text occupies rather than the 81x40 of the column —
    under the 24px minimum.
  - **Considered and rejected:** expanding the row in place (cheapest, reuses
    `openId` wholesale, but scoping a section elsewhere on the page from an expansion
    buried inside the table is action at a distance, so it is a dead end for the
    per-player stats this exists to enable); a nemesis column in the Players table
    (deep stats belong behind a selection, and that table is already ten columns);
    sorting or thresholding the old list (42 rows to 30, surfaces rivalries, does
    nothing about finding yourself — the obvious cheap fix, so expect it to be
    re-proposed); a persistent "this is me" setting (a new persistent concept, wrong
    on a shared scoring phone, and it cannot answer "how does Sigma get on" — worth
    revisiting only as a *default* for the selection).
  - **Two of `verify-stats.mjs`'s assertions are absences**, because nothing in the
    components would notice either coming back — the unscoped list, and a rename
    control in the table. **They are asserted on the first stats screen the file
    opens, not beside the scoped checks further down**, and that ordering is
    load-bearing: verified by mutation, a rename control restored to the table makes
    `openRename` match two buttons and die on a strict-mode violation, so a run with
    them last ends in a stack trace instead of naming the fault. Both mutations pass
    all 287 unit tests.
- **Export/import is the only route off a device** until there's a backend, so
  `verify-stats.mjs` drives the whole round trip rather than just asserting a
  file appears. The unexported count is measured against the newest exported
  `endedAt`, not a match count, so pruning the oldest can't make it go
  backwards.
  - **Which is why the import input is *clipped*, not hidden.** It is a file input
    inside its label, and under `display: none` it had no box, could not take focus
    even programmatically, and reached the accessibility tree as a bare
    `text: Import JSON` — no role, no name. Measured, `Export as JSON` was the last
    tab stop on the page: Tab from it left the document. So the only route off a
    device was pointer-only, on the screen whose whole subject is not losing the
    history. `.visually-hidden` is the fix, and the same clip serves everywhere else
    in the app.
  - **The label wears the focus ring, and `:has(:focus-visible)` is not fussiness.**
    The input is clipped to 1px, so a ring on it is invisible — a keyboard user would
    be standing on a control with nothing saying so. `:focus-within` would light it
    for a tap too, and a file input keeps focus after one, so the ring would sit
    there afterwards. `outline-color: -webkit-focus-ring-color` follows `outline: auto`
    only to match the Export button beside it: measured, the bare `auto` resolved to
    `currentColor` and drew a 3px white ring next to Chrome's thin blue one. A browser
    that doesn't know the keyword drops that line and keeps the ring.
  - **`getByText` is what let this ship.** The check asserted the *words* Import JSON
    were visible, which they were throughout — the label was always drawn. Every
    assertion here is on the control instead: its role and name, that it is the next
    tab stop after Export, that the ring lands on the label, and that Enter actually
    opens the picker.

## Editing names

- **Rewriting a record's `players` array *is* the reattribution, and that is the
  whole feature.** `throwerFor` credits a round to `players[team][slot]` and
  nothing in `rounds` names anybody, so `setMatchPlayers` and `renamePlayer` in
  `archive.js` touch two arrays and every derived surface — career table, H2H,
  `sideRecord`, the Form panel, the summary chips — recomputes on load. Don't add a
  name index, an id, or a display-name table for this.
  - **An alias map applied at read time was the alternative and is worse.** It
    would keep records as-played, but every reader (`playerStats`, `headToHead`,
    `sideRecord`, `matchRounds`, `lineupStats`) would have to apply it, it needs its
    own syncing, and it cannot express a fix confined to one match. Moving the data
    beat adding a lookup in front of it.
  - **Player *ids* were considered and rejected.** The board and the panel render
    names — 16 UTF-16 units, 8 characters on the LED strip — so telling two Neils
    apart means typing "Neil P" as the display name whatever the identity model is.
    Ids would buy only rename-without-a-sweep, and the sweep is ten lines.
- **Two scopes, and the difference between them is load-bearing.** A per-match edit
  (in the expanded match) must **not** touch the lineup waiting on the setup screen,
  because it is a correction to history; a career rename (from the selected-player
  panel) **must**, or the typo walks straight back into the next game. `verify-stats.mjs`
  asserts both directions, and it is the only thing that can: `renamePlayer` and the
  `renamePlayer` reducer case in `App.jsx` are separately correct however they are
  wired together. Verified by mutation — dropping the `onRenamePlayer` dispatch, and
  adding one to the per-match path, each fail exactly one of those two assertions and
  nothing else.
- **The career rename reaches live game state, which is only safe because `stats` is
  reachable only from `setup`.** The reducer case guards on `gameStarted` anyway,
  because renaming a slot mid-game would move rounds already committed to it. Same
  reasoning as the arrangement controls: the guard is what makes a second caller
  safe, not the current call site.
- **A rename also has to carry the inactive mark**, which is keyed by name — see
  **Marking a player inactive** for why a merge is the case that decides it.
- **And the tournament draw, through `saveEntrantRename`.** A name is stored in exactly
  three places — match records, `entrants`/`champion`/`runnerUp`/`field`, and the
  inactive mark — and a rename that reaches two of them is worse than one that reaches
  none. `bracket()` seats sides from `entrants` and finds each tie by `sideKeyOf`, so the
  moment the archive's spelling moves and the draw's does not, every tie that person
  played stops resolving. Measured on a three-tie cup: `champion: Rho` became `null`,
  `3 of 3` became `1 of 3`, a finished cup reappeared under **In progress**,
  `nextEditions` stopped offering the next name, and the already-played final became
  playable again — replaying it resurrects the dead spelling and leaves two records for
  one tie. `renameEntrant` is the sweep; `.claude/rules/tournament.md` holds why the
  draw cannot simply be derived from the records instead.
  - **`verify-tournament.mjs` is the only thing that can see the wiring.** Both halves
    are pure and unit tested; only the handler in `Stats.jsx` joins them. Verified by
    mutation — dropping the `saveEntrantRename` call fails exactly three assertions in
    that block and nothing else.
  - **A merge inside one cup is the case this makes worse, and it is left alone.** Two
    entrants folding onto one name collapses two seats to one key and that bracket stops
    reading — but it needs two people in one draw to be the same person, which is a draw
    that was already wrong, and the bracket is derived, so renaming back restores it.
- **Renaming onto an existing name is a merge and needs no code**, because
  name-folding already is the identity. What it needs is *saying*: the dialog names
  whose history is about to absorb which, and how many matches, since this screen
  can't split them again. Splitting is the per-match edit, one match at a time.
- **A name on both teams is warned about here, not refused — the opposite of the
  setup screen, and deliberately.** These are records already filed that way, and
  the ones most in need of editing are exactly the ones that would be locked: every
  match played before the setup screen refused the lineup. (The career fold does
  credit those throws to both sides, and the warning says so rather than pretending
  otherwise.) See **Nobody can play themselves** under Domain rules for the other
  half.
- **`nameKey` lives in `scoring.js` now, not `stats.js`.** Three places need the
  identity rule — the career fold, the archive rewrite and the reducer — and two
  definitions of "same person" is the failure that has no symptom. `BOARD_NAME`
  moved for the same reason: the match-edit form labels an archived lineup with it.
  Both follow the `PALETTE` precedent, since a constant exported from a component
  file trips the fast-refresh lint.
- **The doubles edit form captions its two columns**, `aria-hidden` because each
  field's own label already says the board. Without them it is two identical boxes
  and picking the wrong one silently moves half the rounds to the other partner —
  the same trap the setup screen's board chip exists for.
- **Both editors are dialogs, and the per-match one started as a panel inside the
  expanded match.** As a panel its fields ran the width of the screen and read as
  another row of the round table rather than as a form. Two things follow:
  - **`Modal` opens by being mounted**, so the screen owns which record or player is
    being edited and there is no ref to toggle. It is `showModal`, and
    `verify-stats.mjs` asserts `:modal` — which is false both for a `show()` and for
    the form going back inline, and in either case the match list stays live
    underneath *with its delete buttons*.
  - **Neither dismisses on a backdrop click, unlike `App.jsx`'s confirm dialog.**
    Both hold a name that has been typed, and losing it to a stray tap is worse than
    one more press on Cancel. Don't unify the two behaviours.
  - **The fields are 17px because iOS zooms the page on a focus under 16px**, and
    these now sit in a dialog it would then be scrolling around. They started at
    15px inline, where the zoom was merely annoying.
- **`updatedAt`, and why the merge rule had to change with it.** `upsertMatch` keeps
  only the local `endedAt` and takes the incoming body, so `mergeMatches` was
  *last import wins* — this file's claim that "the local copy wins" was only ever
  true of that one field, and `archive.test.js` only asserted it. Once records are
  editable that is a live bug: a stale export re-imported reverts a rename. So a
  record carries `updatedAt` when it is edited, and of two copies of one match the
  newer edit wins with a tie keeping the local one.
  - **Both halves matter.** Unedited records tie at 0 — which is every record the
    app files itself — so an import still can't rewrite local history and stays
    idempotent, while an edit made on either device survives the merge.
  - **Only a record that actually changed is stamped**, so an unrelated match can't
    win a merge it has no claim on.
  - **The rule is in `mergeMatches`, not `upsertMatch`.** `upsertMatch` is the local
    write path (archive on win, restore after an undo) and must keep taking the
    incoming body; a re-win of an edited record can't arise, because the stats screen
    is only reachable once the live game has a different id.
  - **Deletion still does not propagate.** A match deleted on one device comes back
    from the other's export. Tombstones aren't built; export is a snapshot, and this
    is the known limit rather than an oversight.
  - This is the piece any cross-device story needs first, whichever it turns out to
    be — file sharing, a retained archive on the scoreboard broker, or a backend.
- **The setup fields offer archived names** (`datalist`, so an unsupporting browser
  degrades to a plain field). Prevention rather than correction: the fields keep the
  last game's names, so it is a *new* player being typed that goes wrong. Default
  names show up in the list because they are genuinely in the archive — filtering
  them would be a lie about the history.
  - **`NAME_FIELD` in `src/nameField.js` is what stops the browser's own contact
    autofill fighting that list, and it takes all three of its properties to do it.**
    Safari offered the machine's address book on top of the archive's suggestions, on
    macOS and iOS both — two popups, and the useless one wins. Each lever looks
    pointless alone, so **don't tidy any of them away**:
    - `autoComplete: 'off'` — respected by Chrome, and **ignored by Safari**, which
      treats the address book as the user's choice rather than the page's. Easy to
      delete as dead code on that basis; it is not dead in Chrome.
    - **No label may contain the word "name."** Safari's heuristic reads the field's
      label, which is why these say `Team A player` and `Entrant 3`. The singles field
      said `Team A player name` and that alone was enough to trigger it.
    - `name: 'holecorn-slot'` — the heuristic also weighs `name`/`id`, and these had
      neither, so the label was the only thing it had. The value's whole job is to
      match none of `name`, `fname`, `fullname` and the rest.
    - **It does not disable the `datalist`.** Autofill and `<datalist>` are separate
      mechanisms and `list` still binds — worth knowing before "fixing" this by
      removing the attribute. `verify-tournament.mjs` asserts both halves over every
      name field on a screen, so a new one without `NAME_FIELD` fails.
    - **Whether the address book actually stops appearing cannot be checked here**,
      for the same reason the popup below can't: it is native browser UI. Confirmed by
      hand on macOS and iOS Safari, which is the only way there is.
  - **How the list is drawn is the browser's, and nothing about it is ours to style.**
    Neither popup inherits the field's font — both use the system UI font — so the
    field's `700 18px` is not a lever on it, and there is no selector for the items.
    What differs is row height: measured off screenshots of the two at the same scale,
    **Chrome gives ~76px per row and Safari ~44px**, which is why Safari's reads as
    unevenly spaced (the rows are barely taller than the glyphs) and Chrome's reads
    fine. iOS puts its own control above the keyboard and is fine. **Not a bug to
    fix**, and the field's font is not the fix for it.
  - **Chrome also draws a `▾` inside the field, tinted**, because that *does* inherit
    the field's `color`. Safari draws no indicator. Left alone with the rest.
  - **The popup cannot be captured under automation, so don't spend time trying.** It
    is a native window, so Playwright's page screenshots can't see it, and it won't
    open from CDP-synthesised clicks or `ArrowDown` — which leaves driving the real
    cursor through System Events, needing Accessibility permission on top of the
    Screen Recording that `screencapture` already wants. A `screencapture -R` of a
    headed window shows the `▾` but not the list. The measurements above came from
    screenshots taken by hand; ask rather than automate this one.
- **The new markup reuses `.modal` and `.confirm-actions` from `App.css` without
  redeclaring them**, which matters: `Stats.css` is bundled first, so a redeclaration
  would lose at equal specificity — the `.app.stats-screen` trap again. Everything
  else is a new class in `Stats.css`.

## Marking a player inactive

Somebody who has stopped playing keeps every match and every number, and stops being
offered when a lineup or a tournament field is filled in.

- **This is the app's only stored fact about a person, and that is the cost to weigh
  before adding a second.** A player is otherwise a string inside match records and
  nothing else — no id, no profile, no per-player table — which is what lets a rename
  be two array rewrites (see **Editing names**). So `inactive.js` holds one fact and
  no display name; the archive already has the spelling.
  - **The derivable alternative was considered and cannot express this.** "Offer only
    people who played in the last N months" needs no state at all, but this group
    plays seasonally, so somebody back next summer is indistinguishable from somebody
    gone — and it would change what is offered with nothing to set and nothing to see.
- **What is stored is *when* somebody was marked, not that they are.** Being inactive
  is derived: marked, and not seen playing since. That is the whole reason there is no
  second write path — playing again brings them back with nothing to remember, and the
  mark cannot come to disagree with the history beside it.
  - **The bare-set alternative needs a mutation inside the archive effect in
    `App.jsx`**, which is the one place with careful win → undo → re-win idempotency,
    *and* is still stale after an import brings in games played on another phone.
  - **A mark is stamped past the person's last match as well as by the clock**
    (`Math.max(at, since + 1)`). Both are `Date.now()` values, so a slow clock would
    otherwise stamp somebody earlier than the game they just finished and the button
    would do nothing visible — a dead button, not a clock problem, as far as anyone
    pressing it can tell. It is the same reasoning as the toss withholding its result.
  - **`lastSeen` counts the mode's roster, the rule `playedIn` credits by**, so a
    singles record's unused second slot cannot keep a phantom in the group.
- **It hides, it never refuses.** Every name is still accepted if it is typed, so a
  returning player is never locked out of the lineup they are standing in. That is
  what makes the whole feature safe to get wrong — the worst outcome is typing a name
  — and it is why nothing in `lineupFaults` or `entrantFaults` knows about this.
- **The filter is one line in `App.jsx`'s `knownNames` and nowhere else.** That memo is
  what both the setup `datalist` and the entire tournament draw screen offer from, so
  one place decides who gets suggested. **A new surface that offers names must read
  `knownNames`** or it will be the one list still naming people who left.
  - The career table and everything on the stats screen deliberately read the archive
    unfiltered: the point is that the numbers stay.
- **The mark has to move with a career rename**, or it goes on hiding a name nobody
  answers to. **On a merge the surviving name's own state stands** — renaming a
  departed player onto somebody still playing must not retire them, and a mark being
  folded away has no claim on a career that already existed. A plain rename carries
  the *original* stamp rather than restamping: they stopped playing when they stopped
  playing, not when their name was fixed.
  - **`merges` is passed in from the rename dialog**, which has already had to answer
    that question to word itself. Two spellings of "this name already has a career" is
    the drift with no symptom.
- **The export envelope carries it, and the merge takes the newer mark** — the rule
  `mergeMatches` settles an edited record by, because another device may have retired
  somebody since the file was written. **Making somebody active again does not
  propagate**, because it is the *absence* of a mark and an absence cannot outrank
  one; re-importing an old file brings the mark back. Exactly the limit a deleted
  match already has, and for the same reason: an export is a snapshot, not a log.
  - **A file with no `inactive` section reads as nobody marked**, the merge-on-load
    tolerance `readArchiveFile` already applies to `tournaments`. Never a refusal.
  - **Not counted in the import notice**, unlike matches and tournaments: a mark is
    about somebody the archive already knows, so it adds nothing to go and find.
- **The Players table dims the row; it does not tag it.** The name column is sticky and
  the only cell always on screen — pinned at 96px, with names scrolling inside it past
  about 14 characters — so a word in there is width the table cannot spare. What dimming
  cannot do is say *what* is special, the fault the shaded nemesis row had, so the panel
  below says it in words and the row carries it for a reader.
  - **The column is pinned rather than content-sized, and `--name-col` is why.** The
    scroller carries `scroll-snap-type: x proximity` with `scroll-padding-left` set to
    the same custom property, so a resting scroll position is always a column boundary.
    Without it the opaque sticky cell paints over the *left* of whatever column is
    part-scrolled, and a truncated figure is still a valid one: measured at 390px, the
    Hole column read `1%, 8%, 4%, 7%` where the real numbers were `31%, 28%, 34%, 27%` —
    the difference between the best and the worst in the group, with nothing saying the
    value was wrong. An auto width cannot be matched by a CSS length, which is the whole
    reason for the pin; the two must stay one number. `verify-stats.mjs` asserts both
    that no cell straddles the sticky edge after a drag and that the padding equals the
    column, and the first fails on the mutation that drops the snap.
    - **The tournament screen's two tables get it for free**, because they reuse
      `.stats-scroll` and `.stats-table`.
  - **Never fade the `th` itself.** It is the sticky cell, so it carries an opaque
    background, and fading that lets the columns scrolling underneath show through the
    name. `.player-select` inside it fades instead, and `verify-stats.mjs` asserts both
    halves — the button dims *and* the cell stays at opacity 1.
- **The panel's foot row wraps on a phone and that is deliberate.** Two buttons plus
  the count need 328px against the 361px a 393px phone has — 33px, where the longer
  labels this shipped with left 11px, which the deploy runner's wider `system-ui` would
  have eaten. The *inactive* state needs 371px and so wraps below about 440px, and at
  320px both states do. Nothing asserts one line here, so a wrap is 24px of height
  rather than a red deploy — but that is the budget, and it is why the buttons say
  **`Mark inactive`** rather than anything longer.
- **One word — *inactive* — runs through the module, the storage key, the CSS class and
  the button labels.** Two words for one concept is the drift these notes are full of.
- **`verify-stats.mjs` is the only thing that can see any of this**, because it crosses
  three files: `Stats` writes the mark, `App` re-reads it on the way back, and
  `knownNames` is what the two offering screens read. Each is individually correct
  however they are joined up, and a mark written but never read hides nobody with
  nothing on any screen saying so. Verified by mutation — dropping the re-read fails
  exactly the three offering assertions, and dropping the row class fails only the dim.
