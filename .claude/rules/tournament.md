---
paths:
  - "src/tournament.js"
  - "src/tournament.test.js"
  - "src/Tournament.jsx"
  - "src/Tournament.css"
  - "tools/verify-tournament.mjs"
  - "docs/TOURNAMENT.md"
---

# Tournaments

Detail behind **Tournaments** in the root `CLAUDE.md`, which holds the facts that reach
outside these files. `docs/TOURNAMENT.md` holds the decisions and the alternatives that
were rejected; this holds what breaks when you change it.

## The bracket, and what it derives

A knockout, drawn once and played over weeks. `docs/TOURNAMENT.md` holds the decisions and
the alternatives that were rejected; this section holds what breaks when you change it.

- **`src/tournament.js` stores the draw and derives everything else.** A tournament holds its
  entrants *in the order they came out of the hat* and nothing about progress. Who is through,
  which round a tie belongs to, which ties can be played, who won — all computed from that
  draw plus the archived matches carrying the tournament's id.
  - **So undoing a winning round un-archives the tie and the bracket recomputes**, with
    nothing to un-advance. That is the whole reason for the shape; a stored tree would need
    the win → undo → re-win cycle to un-advance a node, and a bracket disagreeing with the
    archive **has no symptom**.
  - **Nothing on a record says where in the bracket it sat.** The two *sides* say it, because
    a knockout lets two sides meet at most once, so within one tournament a pair of sides
    identifies exactly one tie. Don't add a round or a position to the record.
  - **`tieLabels` is the way round for a screen holding a match**, and it builds one bracket
    per *tournament* rather than one per match — a hundred matches would otherwise compute a
    hundred brackets.
- **`sideKeyOf` in `scoring.js` is the competitor identity**, and it is why singles and fixed
  doubles pairs are one concept: an unordered, deduped set of name keys, so the same people
  are the same side whichever team letter and slot order they held. It moved out of `stats.js`
  for the reason `nameKey` did — the career fold, the head-to-head pairs and the bracket all
  have to agree, and two definitions of "the same side" is the failure with no symptom.
- **The bracket's shape is forced, which is what makes generating it safe.** Kraft equality
  fixes the depths: for 11 entrants exactly six must win four ties and five must win three, in
  *every* arrangement. So no draw is fairer than another and the only free choice is which
  seats hold the preliminaries. This one alternates halves top-down because that reproduces
  the paper sheet — for 11 it puts them at seats 1, 2 and 5, which is the Hole Corn V sheet
  exactly, and `bracketShape` is pinned to that.
- **Above the deepest level the tree is *perfect*, and the drawn bracket rests on it.** All
  the raggedness of an uneven field is in the deepest column, where a seat is a preliminary
  tie or a lone bye. So every parent has exactly two children and sits exactly between them,
  which is why the connectors are pure CSS with nothing measured.
  - **Every box must be the same height** or that stops being true. `.tie-sides` reserves two
    rows' worth whether or not it holds two — verified by mutation, removing it gives 68px and
    44px. The fixed `line-height` beside it is **not** load-bearing today; it guards a font
    whose natural metrics exceed 22px, which is real given the runner's `system-ui` differs.
  - **A playable box is the button, and that is a width and height decision.** A control
    beside the names would take a third of a 176px column; one below would make the box
    taller. The `▶` is absolutely positioned, and playable boxes reserve a 20px gutter so it
    cannot sit on a long name — measured, names get 287px against 307px, zero overlaps at 16
    characters.
- **A tie's names, mode and target are all fixed by the draw.** The lineup because
  `throwerFor` credits rounds by slot and `bracket` finds a tie by its sides; the mode and
  target because a bracket where one tie was played to 12 among ties played to 21 is not one
  competition — and the bracket would never notice, which is exactly why nothing would say it
  had happened.
  - **So an open row says what it is played to, beside the tabs**, and that placement is the
    whole of it: the target is one fact for the tournament, both panels are full of scores
    that cannot be read without it, and a line belonging to one tab disappears the moment you
    look at the other. `verify-tournament.mjs` is the only thing that can see that — scoping
    it to the Bracket tab passes all 412 unit tests. Worded as the setup screen words a tie
    (`Play to 26`, `.target-fixed`), so the two agree. Measured, it costs the row **no
    height**: `.tournament-head` is only as wide as the tabs and the line, 214px of the 304px
    a 360px phone has and 232px on the deploy runner's own font, so it sits on the tabs' own
    38px line. Drawn only where the stored draw has a target, the way the date line is —
    that needs a hand-edited file, and reserving the space on every other row is worse.
  - **`Play something else` is the only exit**, and it has to exist: with the names locked and
    nothing else on the screen, `Start` was the sole way off it. Gated on `gameStarted` for the
    reason `setCasual` is.
    - **It is worded about the game, not about the cup, and that is the whole point of the
      label.** It said `Leave tie` first, which reads as withdrawing; `Pause tournament` was
      the other candidate and is worse, since it implies a paused state to resume and there
      are none — several cups can run at once and this touches none of them. Nothing about
      the tournament changes: the tie goes straight back on the bracket, playable. The class
      stays `.tie-leave`, tracking `clearTie` rather than the label.
  - **A tie whose tournament is gone is not a tie, and that is repaired on the derivation
    rather than in the delete handler.** Abandoning a cup with one of its ties set up left
    the setup screen with a banner naming *nothing* — `liveTournament` is null, so the
    `?? 'Tournament'` fallback showed — over names, mode and target still locked by a draw
    that no longer existed, with `Play something else` the only way out of a state nobody chose. The
    fix is `App.jsx` dispatching `clearTie` whenever `game.tournament` resolves to no
    tournament.
    - **A line in `onDrop` was the obvious place and covers less.** The effect also rescues
      a game *already* saved in that state, which the delete that stranded it cannot come
      back to fix — and deletion is the only route in today, so a handler would be right
      until it wasn't.
    - **It cannot loop**: `clearTie` returns the same object when it declines, and
      `useReducer` bails out on an unchanged state. When it does fire, `game.tournament`
      goes null and the condition is false.
    - **The archived ties keep their tag**, deliberately, which is not an inconsistency:
      a played tie happened as part of that cup and the dialog promises it stays counting.
      A game that has not been played yet did not.
    - **The delete dialog says nothing about it.** The consequence is on the very next
      screen — the banner gone, the mode unlocked — so it has a symptom, which is the bar
      for that dialog saying anything.
    - **Only `verify-tournament.mjs` can see it**: `clearTie` and `dropTournament` are each
      correct on their own and nothing but `App.jsx` joins them up. Verified by mutation —
      dropping the effect fails exactly that block's six assertions and nothing else.
  - **`game.tournament` is deliberately not sticky across `New game`**, unlike `mode` and
    `casual`. A tournament runs over weeks, so a tie-ness left on would file the next friendly
    as a tie — silently, into somebody else's bracket. Picking a tie off the bracket is the
    only thing that sets it.
- **The roster's chips and `Select all` share one placement rule, `place` in `Draw`.** The
  array order *is* the seating (see `seatSides`), so two spellings of "where does this name
  land" would let one press seat a field the eleven taps would not have — and in doubles
  that decides who is paired with whom, which nothing on the screen says is a decision.
  Verified by mutation: appending instead of sharing it leaves the form's two opening rows
  blank and `Make the draw` off.
  - **It adds who is missing and goes disabled when nobody is left**, rather than flipping
    to a clear. A name typed into the fields is not a chip, so a clear either destroys it or
    leaves a subset behind; disabled is the same answer `Make the draw` gives an empty form.
    Both halves are mutation-checked in `verify-tournament.mjs`, which is the only thing
    that can see any of this — both callers live inside `Draw`.
  - **It is offered in doubles too**, where it pairs people in chip order. That is arbitrary,
    but so is any order, and the mode needing twice as many names typed is the one that can
    least afford to be left out. A wrong pair is two chips off and two on.
  - **The form opens on no rows at all, which moved the count hint's gate.** Every other
    fault waits for a name to be typed; the count deliberately did not, because dropping to
    one entrant is something you did. With nobody there on arrival that stopped being true,
    so it waits for a *row* — `entrants.length > 0` — rather than for a name. Untangling
    those two is the whole change: the blank fault still keys off `started`.
  - **`toggle` no longer restores a blank row when it empties the list**, and `Add entrant`
    is `Add new entrant`, because the roster is how somebody known gets in and a box is for
    somebody the app has never heard of.
  - **The cup's own name is a fault too, where it used to default to the word
    "Tournament".** Several cups run at once and both lists are just names, so the fallback
    produced rows nobody can tell apart — and it fired precisely when you were not looking.
    `Make the draw` is gated on it, the field is marked, and it is *reported* on `started`
    like a blank entrant. That fallback is now unreachable and gone from `draw()`; the
    `?? 'Tournament'` in `App.jsx`'s banner is a **different** one — no tournament at all,
    not an unnamed one — so don't fold them together.
    - **A name already in use is refused too**, keyed by `nameKey` — the person-identity
      rule, reused because it is the same question (how a typed name is compared) and a
      second spelling of it would be looser or stricter than the one beside it for no
      visible reason. Across *both* lists, not just the running ones: the completed list is
      where two of a name would sit for ever. The cost is that an annual cup has to number
      itself, which this group already does.
    - **`Draw` needs `usedNames` for that**, which is the one thing the form takes from
      outside itself. It is a form rule, so nothing in `tournament.js` or `validTournament`
      knows about it and an imported file may still hold two of a name.
    - **The browser check enters the field *before* trying the name**, and that ordering is
      the whole assertion. Checked on an empty form, "the draw is held off" passes on the
      entrant count whatever the name rule does — verified by mutation, which passed the
      entire run until the order was swapped. The file's own recorded failure mode.
    - **It is the one field on that screen the autofill check could not see.** Its filter
      keyed off `aria-label` or a `list`, and this input has neither, so the field whose
      visible label is the bare word Safari's contact heuristic reads was the untested one.
      The filter reads `placeholder` now, which the new `Tournament Name` matches.
  - **The arrival block is first in `verify-tournament.mjs`, and that ordering is
    load-bearing** — the same rule `verify-stats.mjs`'s absence assertions follow. Almost
    every block below builds a bracket through `open()`, which fills a fixed number of rows,
    so putting the blank rows back leaves that field short and buries the real fault under
    every later block. `open()` also reports rather than throwing on `Make the draw` now,
    for the same reason: it used to end the run on the first block with a stack trace.
- **`entrantFaults` has to agree with `lineupFaults`**, or the draw succeeds and produces a
  tie nobody can start. It did once: `sideKeyOf` filters blanks, so a doubles pair with one
  half empty read as a good one-person side, the draw took it, and `Start` then stayed off
  for ever. A side needs as many people as it has slots, and every slot named.
  - **The faults are *reported* only once a name is in, though they are computed from the
    start.** The form opens on two empty rows that are the app's rather than anybody's, so
    on arrival the old version underlined both and said `Everyone entering needs a name.` —
    telling you off for not having typed, on a screen you reached by pressing `New`. The
    setup screen has no equivalent because its slots default to `Player 1`, so it opens with
    nothing at fault.
    - **`Make the draw` is still held off by `faults`, not by what is reported**, which is
      what makes the quiet safe: a disabled button over an empty form explains itself where
      two red boxes nobody has reached do not. Gating the *button* on `reported` would let
      an empty field be drawn into a tie.
    - **Derived from whether any playing slot has a name, not a `touched` flag**, the rule
      the rest of the module follows. The known difference is that clearing the last name
      goes quiet again — which is right, since you are looking at an empty form.
    - **The entrant count is deliberately not gated with it.** Dropping to one entrant is
      something you did, so it is said straight away.
    - **`verify-tournament.mjs` is the only thing that can see any of this** — `entrantFaults`
      is pure and still returns both blanks. Verified by mutation, and it needs *both*
      directions: a gate stuck open fails the three quiet assertions, one stuck shut fails
      the two that check a real blank is still reported.
- **The record carries only the tournament's id, and only when there is one.** Absent rather
  than null on an ordinary game, the way `winner` is absent while a game is live, so a
  record outside a tournament keeps exactly the shape it had before tournaments existed.
- **A tournament may be a stored result and no draw**, which is the shape `recordedTournament`
  makes and the one thing `bracket()` does not derive. The sheet for a tournament played
  before the app is gone, so its ties cannot be in the archive and its bracket cannot be
  computed — and the champions are the only thing left. Exactly the reasoning that gives a
  record `final` when it has no rounds.
  - **Only where there is no field, which is stricter than decision 12 in
    `docs/TOURNAMENT.md` says.** That says "read only when there are no ties", which would
    admit a tournament holding both a field and a stored champion — and a field with no draw
    behind it is shuffled into pairings nobody played and then captioned with the real
    winner, which is a bracket that is wrong in the one way only the people who were there
    could see. So a stored champion is read when `entrants` cannot make a bracket, and a
    tournament carrying both is simply the bracket. `tournament.test.js` pins that direction
    as well as the other.
  - **It may also carry `field`, who took part — and `field` is a *set* where `entrants` is
    a *seating*.** That distinction is the whole of why the two can coexist: array order
    *is* the pairings for `entrants` (see `seatSides`), and nothing is ever built from
    `field`. `bracket()` reads it only where there is no draw, through `storedResult`, and
    `recorded` stays true — so it produces no tie, no round and no bracket. **Don't seat it,
    and don't fold it into `entrants` on a tournament that has a draw.**
    - **The view unions it with the champion and runner-up**, so a field transcribed without
      the winner still describes the whole tournament, and `fieldKnown` says whether the
      entrants are a real field or that fallback. The series panel captions the difference,
      which is why the flag exists rather than a length check.
    - **`mergeTournaments` ranks completeness now** — a draw over a field over the trophy
      alone — rather than carrying one exception. Without that, adding the names to a legacy
      file and re-importing does nothing *and says nothing*, the same silent-hold the draw
      exception was written for.
    - It was left out first and the cost only showed in the series panel: an edition kept
      its two finalists and nobody else, so somebody who entered four cups and won none was
      in no table anywhere. `docs/TOURNAMENT.md` holds the reversal.
  - **`validTournament` had to learn the shape**, because `mergeTournaments` drops what it
    refuses **silently** — the half-import trap `validRecord` and the sample archive already
    carry notes about. A champion-only tournament imported before that change simply never
    appeared.
  - **`createdAt` is the day it was won**, not a draw date it never had. It is what both
    lists sort on, so a recorded year lands among the played ones; the row says `Won` rather
    than `Drawn` so nothing on screen claims a draw that was never taken.
  - **The row still opens, onto a sentence rather than a bracket.** There is nothing behind
    it, but `Delete` lives inside an open row and a file is the only way one of these
    arrives — so a wrong one needs a way out. The delete dialog needs its own wording too:
    the ordinary one promises the played ties stay in your history, and there are none.
  - **The screen drops a tournament whose bracket comes back null**, so a shape `bracket()`
    cannot read does not appear at all — no error, no empty row. That is why
    `verify-tournament.mjs` asserts it is *listed*, which no unit test can see.
- **Past tournaments are imported through `tools/import-legacy.mjs`, and the draw is
  reconstructed rather than transcribed.** `bracket()` seats entrants in array order, so the
  order *is* the pairings, and a sheet nobody kept cannot supply it. The backward walk in
  `docs/TOURNAMENT.md` recovers the tree from the results alone, and `seatEntrants` then
  embeds that tree into `bracketShape`'s canonical one.
  - **It is an embedding, not a relabelling.** The canonical shape fixes which seats hold
    preliminaries, so at every node both orientations of the two subtrees are tried — a bye
    written ahead of the entrant who played off needs the swap, and which side of a tie was
    written down first is an accident of transcription. **Every obvious fixture happens not
    to need it**: verified by mutation, dropping the swap passed all of them until a fixture
    was written for it.
  - **A bracket the canonical shape cannot express is refused.** For six entrants the app
    puts one preliminary in each half, so a sheet that put both in one half is a *different
    tree* rather than a permutation of this one. Refusing says so; the alternative draws
    pairings nobody played.
  - **The reconstruction is checked by running the real `bracket()` over it** and requiring
    every tie placed and the champion the results name. That failure is otherwise silent: a
    tie the bracket cannot place renders as one still to play, months after it was won.
  - **A tie carries `updatedAt` and an ordinary imported game still does not.** Both copies
    tie at 0 otherwise and `mergeMatches` keeps the local one, so the tag would never reach a
    record imported before tournaments existed — which is every legacy record there is. It is
    stamped with the tournament's own date rather than the clock, so the file re-runs
    identically, it beats an untouched local record, and it **loses to a name corrected in
    the app**. Correct a tie's names in the file, not on the phone.
  - **The tournament's id is a hash of its name**, so re-importing lands on the same
    tournament. Renaming one in the file makes a new one and orphans its ties — loud rather
    than silent, because the old bracket then reports every tie missing. It also means a
    sheet turning up for a tournament already recorded as a bare result produces **the same
    id**, which is why `mergeTournaments` lets an incoming draw replace a local result-only
    copy — the one exception to local-wins, and without it that upgrade does nothing at all.
  - **`createdAt` is the earliest tie**, since the draw date is not knowable either. A
    finished row draws a bare span from there to the final, which then reads as when it was
    played.
- **Export grew an envelope for this.** A bare array of matches carries the ties but not the
  brackets, so it imports without complaint and leaves every tournament pointing at nothing.
  `readArchiveFile` still accepts a bare array, because that is every file exported before —
  the merge-on-load tolerance, not a bumped key. Import writes tournaments **first**, or a
  tie lands before the bracket it belongs to.
  - **`mergeTournaments` keeps the local copy, the opposite of `mergeMatches`.** A tournament
    is fixed the moment it is drawn, so two copies of one id are the same draw and an incoming
    one cannot be more right. `mergeMatches` needs `updatedAt` because records get edited.
    **The exception is knowing more**: incoming wins only where it ranks above the local
    copy — a draw over a transcribed field over the trophy alone — because each of those is
    what you keep when the one above it is unavailable. See the recorded-result bullet above.
  - **A deleted tournament is resurrected by a re-import, and it comes back *finished*.**
    Deletion propagates nowhere in this model — the archive's known limit — but here it is
    more surprising than for a match: deleting a bracket deliberately leaves its ties in the
    archive, so the draw returning is enough for `bracket()` to recompute the whole thing,
    champion and all. Only a bracket with nothing played comes back empty. **This is right
    and should not be "fixed" with tombstones**: deleting removes a derived view rather than
    data, and a tombstone suppressing the bracket but not its ties gives the worst state of
    the three — orphan records tagged with an id that resolves to nothing, no `tieLabels`
    entry, and no route back while the file explaining them sits on disk.
  - **So the import notice counts tournaments as well as matches.** That case adds nothing
    to the archive, and reporting only the archive said "Nothing new" at the exact moment a
    whole bracket reappeared — the one thing that changed being the one thing unmentioned.
    Both merges are individually right, so only `verify-stats.mjs` can see it.
  - **Nothing deletes to make room** — not here, and not in `saveArchive` either: losing a
    bracket would take its ties' meaning with it while leaving the ties in the archive.
- **`saveTournaments` returns `{ saved, stored }`, and the draw ceremony depends on it.**
  It used to catch the quota error and hand the list straight back, and `App.jsx` set
  React state from it — so a draw announced as random and final played out, the bracket
  came up playable, and the cup had never been stored. Gone on the next reload, with
  nothing having said so. **`onCreate` and `onDrop` therefore return whether the write got
  through**, and `Tournament` keeps the draw form open with the field intact rather than
  starting the ceremony. Nothing below `App.jsx` can see any of that:
  `verify-tournament.mjs`'s last block is the only cover.
- **Deleting a tournament asks, where deleting a match offers an undo.** Deliberately
  opposite: a match is deleted often enough that a confirm is in the way, a tournament about
  once a year, its button sits under the bracket you were reading, and there is a fact an undo
  bar cannot carry — the ties stay in the archive and keep counting. The dialog says so, and
  `verify-tournament.mjs` checks the claim is true rather than only that it is made.
- **`.tournament-screen` must be excluded from the wide tier's grid in `App.css`**, the same
  trap `.stats-screen` already carries. Without it the screen took the play screen's grid: a
  bracket drawing in 408px with 340px reserved for a rail that never renders.
- **A tournament's own stats are the second tab of an open row, and everything on it is
  derived from the view the bracket tab is drawing.** `tieMatches`, `entrantStats`,
  `routeFor`, `reachedBy`, `tieExtremes` and `tieHistory` all take that view rather than the
  archive, so the two tabs cannot come to describe different ties — the rule `lastPlayed`
  already follows for the date beside `X of Y ties`.
  - **`sideStats` in `stats.js` is the fold, and it is a second *keying* rather than a second
    accumulation.** `foldRound` and `derive` are `playerStats`'s, so an entrant's PPR and a
    player's PPR cannot drift. Both keyings are needed: a career is a person, an entrant is
    whoever entered together, and folded by name a doubles pair becomes two rows with the
    same record and half the rounds each.
  - **`reachedBy` returns a status *and* a level, and three states rather than two.** Out at
    the semi-final and still in it are the same round and opposite answers, so a level alone
    cannot label the column — which is why the screen says `Semi-final` for one and `In the
    semi-final` for the other. The champion is named rather than levelled, because `Final`
    would be true of them and of the runner-up.
    - The sort's `ROUTE_END` is what separates those two, not `depthOf` — giving `won` a depth
      of its own was tried and is dead code, since `reachedBy` only returns level 1 with it.
      **Verified by mutation**, which is the only way that would have shown.
  - **The rate columns are dropped when *no* tie in the tournament has round detail**, not
    dashed per row. Decision 11 in `docs/TOURNAMENT.md` reaches past tournaments by tagging
    records that were already in the archive, and those are imported results — so the whole
    table would be dashes, which reads as a fault rather than as a limitation. `tieExtremes`
    exists for the same case: margins come off `finalScore`, so they are the only thing such
    a cup can say about how the games went. Both directions are checked, because a gate stuck
    either way passes half of it.
  - **The route selection lives on the row, not on either tab**, because the table sets it and
    the bracket reads it. That crossing is the one thing here no unit test can see — holding
    it inside `TournamentStats` lights nothing and passes all 412 of them. `verify-tournament.mjs`
    asserts the lit boxes equal the table's own count of that entrant's ties, so the dimming
    cannot describe a different route from the numbers.
  - **A dimmed bracket is captioned with whose route it is**, the lesson the shaded nemesis row
    taught. The caption sits above `.bracket-paging` rather than in it, because that row is
    hidden on a wide screen and the dimming is not.
  - **The Stats tab's chip row is capped where the career screen's is not.** It can be *two*
    chips long — a cup with no round detail has only its tie count and its skunks — and two
    `1fr` tracks made each of them 483px on a tablet. Seven chips are unaffected, so this is
    a local cap rather than a change to `Chip.css`.
  - **Selection resets when a row shuts**, so a row always opens on the bracket with nothing
    lit: a route is a scope you set while looking, the way the stats screen's `selected` is.
- **The draw is played out a name at a time, and the ceremony is a *view* over a
  tournament that is already saved whole.** `Draw` shuffles and stores before a single name
  is revealed, so `drawSteps` derives the reveal from `entrants` and there is no
  partial-draw state anywhere — nothing in `newTournament`, `bracket`, `bracketShape`,
  `validTournament` or the storage shape changed for this. A reload mid-ceremony lands on
  the finished bracket. `docs/TOURNAMENT.md` holds the decisions; this holds what breaks.
  - **`seatSides` is shared by `build` and `drawSteps` on purpose.** The array order *is*
    the seating, and two spellings of where an entrant sits would let the ceremony announce
    a pairing the bracket never draws — with nothing on either screen to say so, because
    the card is gone by the time the bracket is up. `tournament.test.js` holds the two
    together and `verify-tournament.mjs` holds the *screen* to the tournament actually
    stored, which is the half a re-shuffle in `Draw` would break.
  - **The board is published from before the first press**, so `reveal` is the opening card
    at `at === 0` rather than null. That is the only reveal the screen sends without being
    pressed, and it is what the board holds longest — see **The draw card is a fifth
    screen** under External scoreboard for what it may and may not carry.
  - **Two shapes to a pull, not four** — the opening card above is a third and is not a
    pull — and three properties of `bracketShape`'s seat order that were guessed wrong
    first: an entrant with nobody yet always resolves on the **very next**
    press (preliminaries occupy a prefix of each half); the draw **always ends on a completed
    pairing** (the last seat index is odd, so its sibling is already out); and "gets a bye"
    is only true when the field is not a power of two — `levelName` already draws that
    distinction, so don't add a second rule for it.
  - **Always ceremonial and always skippable, with no toggle.** A setting buys exactly what
    `Skip` buys in one press, and has to be remembered. `Make the draw` always comes here.
  - **The sheet lists pairings, not pulls.** Listing every pull put a row on screen for an
    entrant with nobody to meet, and left it reading `—` after the very next press had named
    their opponent — a sheet describing the draw as it *was*. A pull with no opponent is on
    the card at the time and in a tie a moment later, so it is never invisible.
    - **A sheet row is one pill in two cells, so its column gap must be zero.** The two
      cells share `--panel` and round off only their outer corners, so any gap between
      them puts the page background through the middle of what is drawn as a single
      thing. `.ceremony-sheet` was a flex column with `gap: 2px` for its rows before it
      became a grid, and **the gap survived the change to `display: grid`** — where it
      applies to columns too. Measured, a 2px seam, and it reads as a separator nobody
      chose. `gap: 2px 0` now says which axis it is for.
    - **The round caption is flex-centred, not left to flow.** Both cells stretch to the
      taller, which is always the pairing at 13px against the caption's 11px, so a caption
      in normal flow sits 3.1px above the middle — and at the very *top* of a pairing that
      has wrapped, which a worst-case doubles row does to 9 lines. The 10px inset is on the
      pairing rather than extra padding on the caption for the same reason: a wrapped
      second line starts at the cell edge, so padding the caption holds only the first line
      clear.
    - **Neither is reachable from a unit test and nothing in the components would notice
      either coming back**, so `verify-tournament.mjs` measures the first row. Verified by
      mutation — restoring `gap: 2px` and dropping the centring each fail only their own
      assertion.
  - **Two beats per press, timed by the phone**, `PULL_MS` 1100. The board animates nothing.
    Same reasoning as `Toss for first`: a press that changes nothing visible reads as a dead
    button. **Firmware animation is deferred, not designed out** — the card shapes and the
    topic are identical, so it is purely "does `render.h` animate between them", and it
    would cost a curve dump plus a busiest-frame duty measurement.
  - **The pending beat is cleared on unmount, and so is the card.** Two separate effects:
    one publishes each beat, one publishes `null` on the way out. Without the second the
    board sits on a finished draw until the next one — nothing about starting a game clears
    this topic. Verified by mutation; only `verify-form-screen.mjs` sees it.
- **Both lists are sorted `newestFirst`, and unsorted they were showing import history.**
  The screen used to render the array as stored, which is insertion order: locally drawn
  ones oldest first, and `mergeTournaments` appending imported ones after every local one
  whatever their draw date. So the tournament you had just drawn sat at the *bottom* of
  In progress, a resurrected one jumped to the end, and two devices holding identical data
  could disagree about the order. Sorting on `createdAt` makes it a property of the data —
  the same reason `mergeMatches` settles a clash on `updatedAt` rather than on arrival — and
  it is what that field is *for*: it was written by `newTournament` and read by nothing.
  A tournament without one sorts last and keeps its place, since `sort` is stable.
- **Every row says when, and the two lists say it differently on purpose.** A cup runs over
  weeks, so one date does not answer the question either list is asked. An unfinished row
  leads with the draw — which is also what the lists are sorted by, so the order explains
  itself — and gains `· last played 28 Jul` once a tie is in, because "is this still going?"
  is what you actually want from it. A finished row is the span `5 Jul – 14 Sept 25`, drawn
  to final. `lastPlayed` reads the **bracket's own ties** rather than every record carrying
  the id, so the date and the `X of Y ties` beside it cannot count different things.
  - **A cup that starts and finishes in a day is the date once**, and that is the ordinary
    size of one rather than an edge case — `9 May – 9 May 26` reads as a fault. The same
    collapse applies to the unfinished shape, where play on the day of the draw drops
    `· last played` entirely: the draw date has already said how long ago. **Two separate
    guards**, in `dateSpan` and in `whenLine`, and a mutation of either leaves the other
    passing. `sameDay` is the local calendar day, so an afternoon's play spanning hours
    still collapses.
  - **It is a caption under the name, not a third thing on the top line.** Measured at
    393px, inline clips a 24-character name that fits today (2 names at 320px) and an
    unlabelled date beside `0 of 1 ties` reads as a second status. The caption costs 19px of
    row height — 48px to 67px — and clips nothing. `verify-tournament.mjs` asserts it sits
    *below* the name rather than asserting a row height, because a wrapped inline date
    would give a taller row too.
  - **A tournament with no `createdAt` draws no line at all** and its row is simply shorter.
    That needs a hand-edited file — `newTournament` has always stamped it — and reserving an
    empty caption on every other row to keep them even is the worse trade.
  - **`src/dates.js` exists so the format is written once.** The stats screen's recent list
    had it first; two copies of "how a date looks" is the drift with no symptom. The
    always-show-the-year rule moved with it, and `dateSpan`/`dropRepeatedYear` are the only
    things allowed to omit a year — never from absence carrying meaning, but because the
    year is still on the line at the other end. Neither reads `Date.now()`, so a check on
    the text cannot pass by season. `dayMonth` stays private for that reason.
- **A completed row names the runner-up under the winner, and it costs nothing.** The date
  had already made the row two lines, so the second line's right half was empty — the loser
  of the final is the one place in a knockout where losing is worth naming, and it lands in
  the column the winner is in. `bracket()` derives `runnerUp` beside `champion` for the
  reason everything else is derived there: this screen draws.
  - **The fixture's *second* entrant has to win**, in the browser check and the unit tests
    both. With the first one winning, "the other side of the final" and "side b of the
    final" name the same person, so a runner-up derived without consulting the winner at all
    passes — verified by mutation, and it did pass until the fixture was flipped. Same lesson
    the rest of `verify-tournament.mjs` already carries twice over.
  - **Each line is one grid item ending on the row's right edge, and aligning the two
    *captions* instead was tried and rejected.** Splitting the caption into a third column
    lines `Winner` up with `Runner-up`, but a shared track can only hold the *left* of the
    names together — so whichever name is shorter stops short of the edge and leaves a gap,
    which is the thing that reads as broken. It also cost width: `Winner` in a
    `Runner-up`-wide track took a doubles row's name from 126px to 101px and made the date
    beside the runner-up clip. **Don't re-split it** without re-reading that.
  - **The column is shared with the champion, so the wider of the two sets it.** Usually the
    champion — bolder and 2px larger — but a short winner against a long loser is the
    exception, and there the runner-up costs the tournament name width it had. Measured and
    accepted rather than capped; the numbers are in `Tournament.css`.
  - **The fixture puts the long name on the winning side in one cup and the losing side in
    the other**, because the reach-the-edge assertion is measured against the wider of the
    two lines: with the long name only ever losing, un-aligning the *runner-up* changes
    nothing, since the widest item sets the track whichever way it is justified. Verified by
    mutating each side separately. Two near-equal names — the obvious fixture — make the
    assertion unable to fail at all.
- **The label says "Winner" and the model says `champion`**, deliberately. `winner` is
  already the winner of a single *tie* (`tie.winner`, `.tie-side.is-winner`,
  `.winner-banner`), and one bracket has ten of those and exactly one champion.
- **The board says which tie it is, and it does not say the entrants' form.** See **The
  tournament fixture card** under External scoreboard: in a knockout every side arrives
  at a tie unbeaten, so a form line inside a tournament is all wins for everyone. What
  changes tie to tie is the round, so that is what `holecorn/<code>/tie` carries.
  - **That is about the card, not about the lineup topic beside it.** The roster the
    tablet keeps under the card is scoped to the *series* now (see `seriesHistory`
    below), where it is a real record rather than a column of Ws — but the panel still
    gives the whole screen to the card, and no folding of a form line can say which
    round it is.
    - **The panel was offered the same figure and it was turned down**, so don't
      re-derive it as an obvious gap: a per-side record beside each name on the fixture
      card fits (21 characters becomes 17) and costs no duty, because it takes its width
      out of the name. It was built and reverted on 2026-08-05 — see `docs/TOURNAMENT.md`
      under **The form before a tie is the series'**.
- **A cup played again each year is a *series*, and it is read off the names rather than
  stored.** `seriesKey` strips a trailing edition marker and folds the rest with `nameKey`;
  `groupBySeries` groups on that, `seriesStats` rolls a series up, and `nextEditions` offers
  the next name. **Nothing was added to `newTournament`, `validTournament`,
  `mergeTournaments`, the storage shape or the export envelope**, and that is the whole
  design — see `docs/TOURNAMENT.md` under **The series** for the stored-series option that
  lost.
  - **It had to be derived to be retroactive at all.** `recordedTournament` deliberately
    keeps no field, so Hole Corn I has nowhere to hang a series id — a stored series could
    not have included the one tournament whose honours are the only thing left of it.
  - **The convention it reads is already forced.** `Draw` refuses a name a tournament has,
    so an annual cup has always had to number itself. This reads a rule the app imposes; it
    does not impose a new one.
  - **The numeral must be uppercase, and that is load-bearing.** Read case-insensitively
    `mix` is 1009 and `div` is 504, so `Hole Corn Mix` would silently become edition 1009 of
    Hole Corn. The cost — a numeral typed in lowercase starts its own series — is *visible*
    as two headings, and `tournament.test.js` pins both directions so it is a decision
    rather than a surprise. The regex is strict (canonical numerals only) for the same
    reason: the looser it is, the more ordinary words it swallows.
  - **A name with no suffix keys to itself**, which is doing two jobs: a one-off is a series
    of one so nothing needs a special case, and `Summer Cup` groups with `Summer Cup II`.
  - **`nextEditions` steps past a name already taken**, and that is not hypothetical —
    `import-legacy.mjs` dates a reconstructed tournament by its *earliest tie*, so a sheet
    transcribed years later lands out of numerical order and the obvious next name is one
    `Draw` would then refuse. Dropping the argument gives a chip that fills the form and
    leaves `Make the draw` off; verified by mutation, it fails all four prefill assertions.
  - **`seriesStats` counts honours off `champion`/`runnerUp`, which exist only once a final
    has a winner** — so an edition still being played contributes its entrants and its ties
    and no titles. Reaching a final you have not lost yet is not a result.
  - **A recorded edition contributes whoever it remembers** — its `field` where one was
    transcribed, and its two finalists where none was. So `entered` is who is *known* to
    have been in it, and the caption is gated on `unlisted` rather than on `recorded`: an
    edition that does list its field counts everybody, and captioning it as short would be
    the same fault pointing the other way. Such an entrant's `W–L` is still a dash and not
    `0–0`, the `played` flag `lineupStats` already draws a first-timer with.
  - **`SeriesRow` has its own `.series-holder` and `.series-count`, sharing the tournament
    row's *rules* rather than its class names.** They are different facts — how many
    editions, and who holds the cup — and the names are **queried**: `verify-tournament.mjs`
    reads `.tournament-progress` unscoped, so a series row carrying one resolves the locator
    to two elements and ends the run on a strict-mode violation in a block a thousand lines
    away. Found exactly that way. The same is true of a third section: treating a cup played
    *once* as a series puts a second `.tournament-list h2` on every one-tournament fixture
    and kills the run the same way, which is why the browser check mutates the threshold
    upwards instead.
  - **The Stats-tab table selects and this one does not**, so its name cell is plain text —
    and `.stats-table tbody th` gives its padding up to the `.player-select` button it does
    not have. `.series-stats .stats-table tbody th` puts it back, two classes deep so source
    order cannot decide it. Verified by mutation; nothing else notices, because every number
    in the table is still right.
  - **Neither a `P` column nor a `Finals` column, and both were there.** `P` is exactly wins
    plus losses; `Finals` is the honours list immediately above, which names both finalists
    of every edition. Dropping them is what fits the table on a phone without abbreviating
    the headings — measured, `overflows` 0 at 393px where the career table deliberately
    overflows by 198–235px. `seriesStats` still derives `finals` as the tie-break under
    titles: a sort key, not a column.
    - **That 0 is for ordinary names, and the entrant column is what spends it.**
      Measured on the stress fixture, whose entrants sit at the app's 16-character cap:
      **30px over at 393px and 63px at 360px**, with `W–L` the column that goes off the
      edge. The sample is 0 at 393 and 7px at 360. It scrolls rather than clipping, and
      the name cell is not sticky here — so the trade is a wider name for a `W–L` that
      has to be scrolled to, which is the career table's bargain and is not worth making
      for a table this narrow. Don't read the 0 as headroom.
  - **The pre-game form panel reads the series, and that is `seriesHistory`.** A career
    says how somebody plays; what is argued about at a cup is who wins it, and inside one
    knockout there is no answer — every side still standing is unbeaten, the same fact that
    has the board send a fixture card instead of a form line. So a tie's panel counts that
    series' ties, this edition and the ones before it.
    - **Scoped even where the series is thin, rather than falling back to the career
      numbers.** A basis that changes with the data is the drift with no symptom: two
      lineups reading `12-7` and `1-0` would be counting different things with nothing on
      screen to say which. The empty end needed nothing new — nobody with no ties behind
      them is `played`, so the first tie of a first edition has nothing to report and the
      panel stays away, exactly as it does for a lineup of newcomers.
    - **The heading is the only thing that says which pool it is** (`Form in Hole Corn`),
      because `Lineup` folds whatever it is handed and every number under it looks the
      same either way. `aria-label` carries the same words — it overrides the `h2` inside,
      so the two disagreeing would announce a career while drawing a cup's.
    - **`App.jsx` hands the panel and the scoreboard publisher one `formMatches` const**,
      so the board's copy of this panel cannot come to differ from the phone's. Two
      expressions is what would need a check, and only `verify-form-screen.mjs` — which
      needs a broker and is not in CI — could carry it.
    - **`seriesViews` is shared with `seriesStats`**, so "which ties is this series made
      of" has one answer, and both read each edition's own bracket rather than filtering
      records on the tournament id — `tieMatches`'s rule, kept across the lineage.
    - **`verify-tournament.mjs` is the only thing that can see it**: the derivation is pure
      and the panel folds whatever it is given, so both are correct however `App.jsx` wires
      them. Its fixture makes every wrong pool a different number — 2–1 for the series, 4–1
      if another cup's ties are swept in, 7–1 over the archive. Verified by mutation, which
      fails the record assertions and **not** the heading: the caption comes from the
      derivation and the rows from the pool, so checking the caption proves nothing.
  - **The edition count is not a chip.** The row above says it and stays on screen while the
    row is open, so it was the same fact twice — and three chips orphan one on a phone where
    two fill the row exactly.
- **A tournament runs over weeks, and that is the sharpest risk in the feature.**
  `localStorage` is per browser and a home-screen app is a different container from a Safari
  tab, so whichever device takes the draw must score every tie — and ITP deletes
  script-writable storage after seven days of Safari use without visiting the site, so a gap
  of more than a week between ties in a *tab* takes the archive with it. Not a coding problem;
  `requestPersistence` already runs and the stats screen already reports the answer.
