# Tournaments

Running the family knockout from the app: it holds the field and the draw, says which
ties can be played, and files each tie into the archive tagged, so past tournaments
are readable afterwards and tournament form is separable from everyday form.

Status: **built.** Everything below describes shipped behaviour, except where marked. This
file keeps the decisions and the options that were rejected; the rules a future change has to
respect are in `CLAUDE.md` under **Tournaments**.

Seven things came out differently from the plan, each noted under **How it came out
differently**: several tournaments may run at once; a tie can be put back with `Play something
else`;
the bracket is drawn as columns rather than listed by round; `entrantFaults` refuses a doubles
pair with one half missing; the Play control lives in the bracket box rather than a list above
it; the target is fixed by the draw alongside the mode; and the tournament-scoped stats are a
tab inside the open row rather than a scope on the stats screen.

## Goal

On tournament day nobody keeps the bracket on paper, works out who is on next, or
transcribes results afterwards. A tie is scored exactly the way any game is scored
now; the result advances the bracket and lands in the archive.

## The format

Field of `n`; `p` is the largest power of two at or below `n`.

| | |
| --- | --- |
| play-in ties | `n - p` |
| entrants in the play-in | `2(n - p)` |
| byes straight into the bracket | `2p - n` |
| ties in the whole tournament | `n - 1` |

At `n = 12`: four play-in ties among eight entrants, four byes, eleven ties in all.
At `n = 8` there is no play-in. Then standard single elimination — one game per tie,
losers out.

A competitor is a **side**: one name in singles, two in doubles, the same pair all
tournament. The tournament is singles or doubles throughout, not a mix.

**Who has the harder path is not a choice — it is forced**, which is what makes
generating the bracket safe. By Kraft equality every leaf's depth must satisfy
`Σ 2^-depth = 1`, so for `n = 11` in a tree of depth 4, `x/16 + y/8 = 1` with
`x + y = 11` gives exactly six entrants needing four wins and five needing three.
There is no arrangement of an 11-person bracket that spreads it more evenly. So the
only thing a draw decides is *which* entrants and where the byes sit on the page.

Two byes can be drawn against each other, and this is what makes a bracket look
like it has more preliminaries than it does. In the Hole Corn V sheet, 5v6 and 10v11
are both bye-against-bye: playable immediately, but their winners need three wins
rather than four, so they are one level above the three genuine play-in ties
(1v2, 3v4, 7v8). **Counting first-round ties chronologically gives the wrong
answer** — five rather than three.

## Constraints

- **No backend, and `localStorage` is per browser.** On iOS a home-screen app and a
  Safari tab are separate containers, so **whichever device takes the draw has to
  score every tie** — and since a tournament runs over days or weeks rather than an
  evening, it has to still be that device a fortnight later, in the same browser,
  installed rather than in a tab. See **A tournament runs over days**; this is the
  sharpest risk in the whole feature and it is not a coding problem.
- **A match is archived only on a win, and un-archives when the winning round is
  undone.** Anything *derived* from results inherits that reversibility for free.
  Anything that *duplicates* results has to undo itself by hand.
- **The app models two sides, `a` and `b`.** A field of competitors is the one thing
  here that existing state genuinely cannot stretch to.
- **`Stats` is reachable only from `setup`**, which is what stops the mount-time
  archive effect resurrecting a deleted match. A tournament screen needs the same.
- **`.setup-top` has 0px of slack on the deploy runner's font.** Nothing new goes in
  that row.
- **The LED panel is 128x32.** A bracket does not fit.
- **A guest game cannot be a tournament tie**, and the gate is the `Guests` toggle being
  disabled while a tie is loaded. It used to be that a `casual` game was never archived
  at all; since 2026-08-17 one is filed (counting towards nothing), so if that toggle is
  ever enabled on a tie the record would carry the tournament's id with blank sides —
  `matchBetween` would never match it and the tie would stay playable for ever.

Assumed rather than verified:

- That the format is stable — around a dozen entrants, one game per tie, the field
  settled before the first tie, losers out. Stated from memory, not checked against
  past years.
- Nothing about the archive's ordering. That the final is the last tie played is a
  fact about the root of the tree rather than an assumption — see **The derivation** —
  and it is confirmed by every tournament played so far.

## Options considered

### Do nothing

It happens once a year, the app already scores the games, and a paper bracket takes
half a minute to draw. Everything below competes with the board sensors and the
offline broker for attention.

*Eliminated because:* the archive half compounds. Each year's record is only
capturable at the time, so a year not recorded is lost rather than deferred.

### Infer the tournament from the date

No new state at all: the tournament *is* the matches archived on that date. The
stats screen gains a day view, with the champion as whoever won last. Retroactive,
so every tournament already played would appear immediately, and guest games could
not pollute it because `casual` was never archived. (That last argument has since
expired: a guest game *is* archived now, counting towards nothing, so a day view would
have to exclude them itself.)

*Eliminated because:* tournament-only figures need the app to **know** which ties
were tournament ties. The date is a proxy that is silently wrong the moment one
ordinary game is played that day, and it cannot survive a tournament spread over
two days.

### Tag the tie only; derive everything from tagged results

One field on the record and a sticky setup toggle. No stored field, no stored draw.
This delivers the whole after-the-fact story — the tournament grouped, the champion,
**correct round labels** via the backward walk below, and tournament-scoped stats —
for about a tenth of the work of the chosen option.

*Eliminated because:* it cannot produce the **live** bracket. Mid-tournament you do
not yet know which tie is the final, so it can say nothing about who is on next.
That was wanted for this year's tournament. Kept in the record because it is the
natural fallback if the chosen option overruns: it is a strict subset, so nothing
built for it would be wasted.

### Tag the tie, store the field and the draw, derive the bracket — **chosen**

The draw is taken once and stored, because it is the only part that is not
derivable. Everything else — who is through, who is out, which round a tie belongs
to, who plays next — is computed from the stored draw plus the tagged archived
results, and nothing about the bracket's progress is written down.

*Chosen because:* results stay the single source of truth, so the bracket inherits
the archive's reversibility exactly — undo a winning round, the tie un-archives, the
bracket recomputes with no un-advancing to do. It is the same move `courtPositions`
already makes in deriving every position from `rounds.length`.

### Let the draw be an arbitrary tree, entered or adjusted by hand

The bracket has always been drawn freehand, so the app could hold whatever tree was
drawn rather than computing one — the most faithful option, and the only one that
could reproduce a deliberately unusual shape.

*Eliminated because:* the depth profile is forced (see **The format**), so a
hand-drawn tree cannot be fairer than a generated one — it can only differ in which
entrant sits where, and the draw is random anyway. It was the single largest cost in
the feature and it buys nothing. Confirmed against the Hole Corn V sheet, which turns
out to *be* the canonical bracket for 11.

### A full bracket state machine

A tree in its own key, nodes advanced explicitly as ties finish. Expresses anything
the format might grow: re-draws between rounds, walkovers, best-of-three, a
third-place playoff.

*Eliminated because:* the draw is taken once and it is a clean bracket, so all of
that expressiveness is for cases that do not occur — and it costs two sources of
truth that must agree. Win → undo → re-win would have to un-advance a node, deleting
a match would leave a dangling one, and **a bracket that disagrees with the archive
has no symptom.**

## The derivation

Why results can be the state, and what the stored draw is actually for.

**Round labels are derivable from tagged results alone, without knowing the byes:**

- The last tie chronologically **must** be the final, and this is structural rather
  than conventional: the final is the root, so every other tie lies in one of its two
  subtrees, and it cannot be played until both are complete. There is no schedule that
  puts anything after it.
- The final's two sides are the finalists. Each one's previous tie in that tournament
  is a semifinal. Recurse.
- Every side loses at most once, so the walk terminates and reconstructs the tree
  exactly. A bye shows up as a side whose first tie sits at a shallower depth.

**None of this depends on ties being played in round order, which is the natural place
to doubt it.** Ties are played opportunistically — whoever is present, so long as both
their sides are known — and a structurally later tie routinely goes before an earlier
one elsewhere in the bracket. Two things make the walk immune:

- It reads **one side's own chronology**, never the interleaving between sides. A side
  must win its deeper tie before it can play its shallower one, so a side's ties are
  forced into depth order however the tournament is scheduled.
- The final-is-last property above is a fact about the root, not about scheduling.

So the only ordering the derivation needs is the one physics already guarantees.

**The obvious alternative derivation does not work**, and it is worth recording so it
is not re-proposed: counting ties won so far cannot label rounds, because with byes a
quarter-final between two bye entrants is nil-wins against nil-wins — indistinguishable
from a play-in tie.

**What the walk cannot do is run mid-tournament**, because the final has not been
played yet. That, and only that, is what the stored draw buys.

## Decision

1. **New persistent state under its own key**, `holecorn.tournaments.v1` — the
   archive and scoreboard-settings precedent, so `New game` cannot clear it. A
   tournament holds its id, name, creation stamp, mode, target, the entrants as
   sides, and the draw (play-in pairings and byes). All fixed once taken.
2. **Competitor identity is `sideKey`'s rule, reused** — an unordered, deduped set of
   name keys. Singles and doubles are then one concept and slot order is irrelevant.
   Not reinvented: two definitions of "the same side" is the failure with no symptom.
3. **One new field on the archive record**: the tournament id. `matchRecord` copies
   it from game state, which carries it the way it carries `casual`. `validRecord`
   ignores unknown fields, so it rides through export and import untouched.
4. **A tournament screen, reachable only from `setup`** — the `Stats` rule, for the
   same reason. It takes the draw, shows the bracket filling in, and marks which ties
   are playable. The tournament is **named here**, not on `.setup-top`. An unfinished
   tournament announces itself on `setup` rather than waiting to be looked for,
   because the next session may be a fortnight after the last one.
5. **The draw is random and the app makes it.** Entrants are shuffled into numbered
   positions and the tree is built from the field size, because the paper sheet's
   numbers are draw positions pulled from a hat and nothing more. The shuffle lives in
   the component, not in a pure module — the `TossForFirst` and `drawSplash`
   precedent. Byes are laid out alternating down the page, matching the sheet: purely
   for familiarity, since the depth profile is forced either way.
6. **You pick a tie off the bracket; there is no required order.** Any tie whose two
   sides are both known is playable, and several usually are at once — ties are played
   according to who is present, so a structurally later tie often goes first. That
   makes **"playable" the derived thing** (both sides known) rather than "next" being a
   position in a queue, and it is why the two bye-against-bye ties on the Hole Corn V
   sheet can be played before any of the three genuine play-in ties.
7. **The chosen tie loads with the names locked** and the mode fixed by the
   tournament; `Start` is the only control. A mis-typed tie is then structurally
   impossible rather than merely discouraged.
8. **Bracket progress is derived, never stored.**
9. **Stats gains tournament-scoped figures** alongside the career ones. Ties count in
   ordinary stats exactly as now; the tournament view is a second lens over the same
   records. Built as a **tab inside the open tournament** rather than a scope on the
   stats screen — see **How it came out differently**.
10. **Export carries tournaments as well as matches**, or a re-import loses every
    bracket while appearing to succeed.
11. **Past tournaments are reached by tagging records that are already there**, not by
    importing new ones — the earlier legacy import was transcribed from these very
    brackets, so the ties are in the archive already and only the tournament they
    belong to is missing. A record with no rounds still carries everything the
    derivation needs: the sides, the winner and `endedAt`.
12. **A tournament may carry a champion and no ties.** The first tournament's results
    are lost, and the champions list is the only place that fact can live — exactly the
    reasoning that gives a record `final` when it has no rounds. Read only when there
    are no ties, so it can never contradict a bracket that does exist. Built narrower
    than that — see **How it came out differently**.

### How it came out differently

Each of these was decided after the record was written, and each replaced something the
Decision above specified:

- **Several tournaments may run at once.** A singles cup and a doubles cup in one summer is
  an ordinary thing to want, and nothing in the bracket cares — each derives from its own
  tagged ties. The setup button therefore names the *screen* (`Tournaments`) rather than a
  tournament: it briefly named one and counted the rest, which read badly once a name could be
  32 characters, and it named the **oldest** unfinished one, so a tournament drawn today sat
  behind one from last year that nobody finished.
- **`Play something else` puts a tie back.** Decision 7 locks a tie's names, and with nothing
  else on the screen that left `Start` as the only exit — so a mis-tapped tie had to be played,
  or started and abandoned. Gated on `gameStarted` for the reason `setCasual` is: untagging a
  game with committed rounds would take the tie out of its bracket and leave the record behind.
  - It said `Leave tie` first, which read as withdrawing from the cup — as would
    `Pause tournament`, the other candidate. Neither is what happens: the tie goes straight
    back on the bracket, still playable, and every other tournament is untouched. So the
    label is about the game in front of you and mentions the tournament not at all.
  - **Abandoning a tournament does the same thing to a tie of it that is set up.** There is
    no bracket left to hold the tie, so the game stops being one; without that the setup
    screen kept a banner naming nothing over a lineup locked by a draw that no longer
    existed.
- **The bracket is drawn as columns, not listed by round.** The BBC's knockout layout: one
  column per round, deepest on the left, `‹ ›` paging on a phone. What makes it possible in
  plain CSS is **The perfect tree** below.
- **`entrantFaults` refuses a doubles pair with one half missing.** `sideKeyOf` filters blanks,
  so `['', 'Tau']` looked like a good one-person side: the draw succeeded and the tie it
  produced could never be started, because `lineupFaults` refuses a blank slot and `Start`
  stays off. A side must now have as many people as it has slots.
- **The field is entered by tapping the archive's names, and `Select all` enters the lot.**
  Typing eleven names the app already holds is the real cost of setting a cup up. The chips
  are toggles rather than add buttons so the lit ones double as "who have I got so far", and
  the ordinary field is everybody — so the button that enters everybody is one press and
  tapping off the two who aren't here is two more.
  - **The form opens with no name boxes at all**, and `Add entrant` became `Add new
    entrant`. The two rows it used to open on were rows most draws never type into, and
    they sat between the chips and the button that actually wants them. A box is now for
    somebody the app has never heard of, which is what the label says.
  - **The cup's own name is refused rather than defaulted.** It fell back to the literal
    word "Tournament", which is the guest-game bug in miniature: several cups run at once
    by decision, both lists are just names sorted by date, and the fallback fires exactly
    when you were not paying attention — so two rows reading "Tournament" is a screen you
    cannot read, and the only fix afterwards is to abandon one. It is reported on the same
    gate as a blank entrant, and marks its own field the same way.
  - **A name already in use is refused for the same reason**, compared with `nameKey` so the
    casing it was typed in cannot smuggle a second one past. Refused rather than warned
    about, the setup screen's rule for a repeated lineup: this is a cup about to be drawn
    and costs a keystroke, where a record already filed is history. It is a *form* rule and
    not a storage invariant — a file carrying two of a name still imports, because
    `mergeTournaments` keys on the id and refusing a whole bracket over its decoration is
    the archive's standing rule.
    - **The cost is that an annual cup cannot reuse its name.** "Summer Cup" every year
      becomes "Summer Cup 26", which is what this group does anyway (Hole Corn V, VI). The
      alternative — refusing only against unfinished cups — makes the rule depend on
      something the form cannot show you, and the completed list is where two of a name
      would sit for ever.
  - **So the "needs at least 2 entrants" line had to be gated too.** Every other fault
    waits for a name to be typed, on the reasoning that an untouched form is empty rather
    than at fault; the count was deliberately *not* gated with them, because dropping to
    one entrant is something you did. Opening on nobody makes that arrival state, so the
    count now waits for there to be a field — one row, however blank — and the disabled
    button carries the empty form on its own, which is the same rule as before.
  - **It adds who is missing rather than starting again**, so a newcomer typed into the
    fields survives it and nobody already in is entered twice.
  - **It goes quiet when there is nobody left, rather than flipping to a clear.** A name
    typed into the fields is not a chip, so a clear would either destroy it or leave a
    subset behind, and neither is guessable from the label. Disabled is what `Make the draw`
    already does over an empty form.
  - **One placement rule, shared with the chips**, so one press seats the field exactly as
    tapping down the roster would. Two spellings of where a name lands is the drift with no
    symptom — in doubles it decides who is paired with whom.
- **The Play control is the bracket box itself.** It was briefly a "Ready to play" list above
  the drawing, duplicating boxes the bracket already drew — a screenful of them on a
  64-entrant field, each without the context that makes it worth looking at. The box is the
  button instead, which costs no width and no height; both matter, because the connectors need
  every box the same height and the column is 176px. The bracket opens on the deepest round
  that still has a live tie, which is what replaced the list.
- **The target is fixed by the draw, like the mode.** Left editable at first on the grounds
  that the bracket only reads sides and winner — which is an argument about the mechanism, not
  about whether it is right, and is exactly why a tie played to 12 among ties played to 21
  would leave no trace anywhere.
  - **So the open row says what it is**, beside the tabs. Fixing the target made every score
    in the cup readable against one number, and then nothing on screen carried that number: a
    winning 35 is somebody squeaking over the line to 35 or a rout that overshot a line at 26,
    and neither the bracket's boxes nor the tie log can say which. It sits with the tabs
    rather than in either panel because it is one fact for the whole tournament and both
    panels are full of scores — and on the tabs' own line, so it costs the row no height.
- **The tournament-scoped stats of decision 9 are a tab inside the open row**, with the
  bracket first, rather than a scope selector on the stats screen. See **Where the stats
  went** below for the option that lost and why.
- **A stored champion is read where there is no draw, not merely no ties.** Decision 12's
  rule would admit a tournament holding both a draw and a champion, and that state is worse
  than either half of it: the entrants would be shuffled into pairings nobody played and
  captioned with the real winner — wrong in the one way only the people who were there could
  see. So a recorded result carries no `entrants` at all, and a tournament with them is
  simply a bracket.
- **Who took part is kept beside the result, in `field`, and that reverses an earlier
  decision here.** The first version threw the names away even where they were remembered,
  because `entrants` means the draw everywhere else and a second meaning for the same names
  is the drift this file exists to prevent. What that cost only became visible with the
  series panel: an edition whose sheet is gone contributed its two finalists and nobody
  else, so a player who entered four cups and won none appeared in no table anywhere, and
  every `entered` in the series was short by however many went out early.
  - **The distinction that makes it safe is that `field` is a *set* and `entrants` is a
    *seating*.** A bracket is built from array order — that is the whole of `seatSides` —
    and nothing is ever built from this one. `bracket()` reads it only where there is no
    draw, `recorded` stays true, and no tie, round or pairing comes out of it. A tournament
    carrying both is still simply the bracket, exactly as above.
  - **The view unions it with the two names on the trophy** rather than trusting it whole,
    so a field transcribed without the winner still describes the tournament. `fieldKnown`
    says which of the two the screen is looking at, because "the field was two people" and
    "only the finalists are remembered" are different facts and the panel captions one of
    them.
  - **`mergeTournaments` had to learn it**, for the reason an incoming *draw* beats a local
    result-only copy: remembering the field arrives by the same route — a corrected file,
    re-imported — and local-wins would have swallowed it silently. The rule is now a rank,
    a draw over a field over the trophy alone, rather than a single exception.
  - **Nothing else moved.** `newTournament`, `validTournament`, the storage shape and the
    export envelope are untouched, and a tournament without the key reads exactly as it did.
- **Decision 11's tagging is done by `tools/import-legacy.mjs`, and it reconstructs the
  draw rather than asking for it.** The decision assumed the ties were already in the
  archive and only the tournament was missing, which is true — but `bracket()` seats
  entrants in array order, so the *order* is the pairings and a sheet nobody kept cannot
  supply it. **The Derivation below turns out to be the tool**: the backward walk rebuilds
  the tree from the results, and the entrant order that reproduces it falls out by embedding
  that tree in `bracketShape`'s canonical one. What the walk cannot do is run
  mid-tournament; for a tournament long finished it is exactly the right instrument.
  - **The embedding can fail, and that is reported rather than fudged.** The canonical shape
    fixes which seats hold preliminaries — for six entrants, one in each half — so a sheet
    that put both preliminaries in one half is a different tree and no entrant order
    reproduces it. Relaxing `bracketShape` to accept an arbitrary preliminary layout is the
    obvious follow-up if a real sheet ever hits this, and it has not been needed.
  - **Tagging overwrites a record already imported.** Unedited records tie at 0 in
    `mergeMatches`, so without an `updatedAt` the tag would never arrive for anyone who
    imported their legacy games before tournaments existed. The stamp is the tournament's own
    date, which loses to an edit made in the app — so the app still wins for names, and the
    file wins for everything else.

## The perfect tree

The drawn bracket rests on a property worth stating on its own, because it is what makes the
connectors pure CSS with nothing measured:

**Above the deepest level the bracket is a perfect binary tree.** All the raggedness of an
uneven field lives in the deepest column, where a seat is either a preliminary tie (a box with
two names) or a single entrant who took a bye (a box with one). Every node above that has
exactly two children, so each parent sits exactly between them.

That only holds while the two children are the same *height*, which is why `.tie-sides`
reserves two rows' worth whether or not it holds two. It did not, once: a two-name box came out
68px and a one-name bye 66px, putting every parent a couple of pixels off the point where its
children's connectors meet — invisible in a screenshot and wrong all the same.

## Where the stats went

Decision 9 said the stats screen would gain tournament-scoped figures, which reads as a
scope selector there: `Stats` already derives everything from a `matches` array, so
filtering it once would scope the summary chips, the career table, the rivals list and the
recent matches for almost nothing. That is the cheapest option and it lost.

**Most of that screen is structurally empty when scoped to one cup.** A knockout lets two
sides meet at most once, so every head-to-head row within a tournament is 1–0, and
`RIVAL_MIN_MEETINGS` is 3 — nemesis and dominates can never fire. The recent matches list
becomes the ties, which the bracket already shows. What is left is the chips and a career
table with none of the questions a cup actually raises.

**And the question a cup raises has no career equivalent: how far did each entrant get.**
That is derivable only from the bracket, so it has to be built either way — at which point
the bracket is the natural place to put it, and putting it on a different screen from the
drawing it describes is what made the tab win.

Two things follow that are worth stating, because they are what a change here would argue
with:

- **The competitor is the *entrant*, not the player.** `sideStats` folds by `sideKeyOf`, so
  a doubles pair is one row — the thing the bracket competes by. Folded by name, a fixed
  pair becomes two rows with the same record and half the rounds each, which is noise. The
  career screen keeps folding by name, because there a career is a person.
- **Selecting an entrant lights their route on the bracket, and the selection is not in the
  bracket.** A playable tie's box *is* its Play button, so a tap there is spoken for, and
  making names tappable only in the non-playable boxes puts the control exactly where it is
  least wanted — you cannot then trace either side of the tie you are about to play. The
  table selects; the bracket lights. That also generalises the champion's route to anyone's
  without a special case for the winner.

### Explicitly not doing

- **No bracket on `?display=1` or the LED panel.** Ranked third of three, and 128x32
  cannot hold one.
- **~~No walkovers~~, retirements, best-of-three, third-place playoffs or re-draws**
  between rounds — walkovers are built, see **A tie nobody played**. The rest stand.
- **No mid-tournament change to the field.** A walkover does not change it: it settles
  a tie between the two sides the draw already seated.
- **No bracket state machine**, and nothing about a tie's position stored on its
  record beyond the tournament id.
- **No second route into a live game** — ties are played through `setup`.

## A tie nobody played

The revisit the open questions below predicted, built on 2026-08-17. Somebody drops
out of a cup that runs for weeks, and before this there was **no way to finish the
tournament at all**: the tie stayed playable for ever, the bracket never resolved, the
row sat under In progress and `nextEditions` would not offer next year's name. The only
routes were to fabricate a game — three rounds of tapping four baggers, which puts
invented hole and board counts into a real player's career rates — or to abandon the
cup.

**A walkover is a match record with a winner and no rounds, and that is the whole
change.** The shape is not new: an imported result is a winner with nothing behind it,
and `finalScore` already returns null rather than 0–0 for one, so the tie box draws no
numbers of its own accord. `bracket()` resolves a tie by finding a tagged record between
its two sides, so an awarded tie advances its winner with **nothing new stored** — and
deleting that record puts the tie back, which is the reversibility a played tie already
has. `forfeit: true` on the record is the only addition, and it does two jobs: it tells a
walkover from an imported result, and `counted` in `stats.js` drops it from every fold.

**It counts towards nobody**, which was a choice rather than a consequence. A walkover
*is* a result in a knockout and counting the W–L would have been defensible — the
argument that won is that nobody should gain a win they did not play for, and that the
alternative is indistinguishable from a legacy import in every table. The visible cost is
accepted and is worth knowing: the tournament's own entrant table folds `counted` too, so
somebody who reached a final on a walkover reads as having played nothing on the way,
while the bracket beside it lights their whole route.

**It is on the tournament row, beside `Abandon`.** The setup screen's tie banner was the
other candidate and is cheaper — the tie is already chosen there, so no picker is needed —
and it loses on three counts: you would reach a forfeit *through* picking the tie you are
avoiding, the banner would carry a control on every tie you do play, and it leaves
`game.tournament` pointing at a tie that is now settled. That last one needed answering
anyway: `App.jsx`'s repair effect now clears a tie that has been settled while it sat on
the setup screen, or `Start` would offer to play it a second time and file a second record
for one tie, which `matchBetween` then answers with whichever it finds first.

### Rejected: the beaten opponent takes their place

The other half of the original ask — a lucky loser, where the withdrawing side is replaced
by the last opponent they beat, so the tie gets *played* rather than awarded. Wanted
because a social cup would rather have a game than a walkover.

*Eliminated because:* `entrants` is a **seating** — its order *is* the pairings — so the
name cannot simply be swapped. The withdrawing side also sits in the ties they have
already won, and replacing Rho with Tau makes the quarter-final read Tau v Tau, whose
record then matches nothing; `renameEntrant` already carries a note about exactly that
collapse. So a substitution has to be stored per tie, which is the **full bracket state
machine** eliminated above, and it is a fourth place a name lives — a rename today has to
reach exactly three (match records, the draw, the inactive mark) and would have to reach
this too.

*The no-new-state version was found and is worse.* The substitute is by definition
somebody the withdrawing side beat, so a tie could resolve against anyone seated in the
losing side's own subtree — genuinely derivable, no new state, and it costs the exactness
of the one rule the whole derivation rests on. A record tagged with the tournament and
naming the wrong two people would then resolve a tie it is not, which is the "a bracket
that disagrees with the archive has no symptom" fear aimed at the place it hurts most.
`resolve` would also have to return a winner that is neither seat of the tie it came out
of.

**What to do instead:** somebody who leaves before playing anything is either awarded
their ties as they come up, or the cup is abandoned and drawn again with the field that is
actually there. Replacing them in the draw *is* free where they have played nothing — it
is a seat rename, which `renameEntrant` already does — but only for a name not already in
the field, and it is not worth a control until somebody asks for it twice.

## A tournament runs over days, not an evening

Eleven ties is more than one evening, so a tournament spans several sessions and
sometimes weeks. This is the single most consequential fact about the feature and
almost everything below follows from it.

**It is why the live bracket is worth building at all.** Over one evening you would
remember who is on next; over weeks nobody does, and the paper sheet is currently the
only thing that holds it. So the app has to answer "where are we up to" on being
opened cold, days later — which means an unfinished tournament must be visible from
`setup` without going looking for it.

**It is why the tournament must not be an ambient mode.** A sticky toggle in the
manner of `Guests` would still be lit a fortnight later when somebody starts a
friendly, silently filing it as a tie. Launching each tie from the bracket instead is
what makes that unreachable — see Decision 6. Ordinary games played between ties stay
untagged and the derivation cannot see them.

**It sharpens the one-device constraint into a data-loss risk.** ITP deletes
script-writable storage after seven days of Safari use with no interaction on the
site; a home-screen app is exempt, a plain Safari tab is not. Playing a tie counts as
interaction, so a tournament run over consecutive evenings is safe — but **a gap of
more than seven days between ties, from a Safari tab, takes the tournament and the
archive with it.** `requestPersistence()` already runs at launch and the stats screen
already reports the answer, so the mitigation exists: run a tournament from the
installed app, and check that the archive says it is persisted before the first tie.

### How the imported years are dated

`import-legacy.mjs` stamps local noon plus a minute per game that day, so within one
day the order comes from the order the games were written down. The derivation rests
on the tournament's last tie being the final, so a badly ordered day would give a
bracket that is *wrong* rather than absent.

The source file was transcribed a round per day, counting back from the day of the
final. So ties in one round share a day, rounds are separated by days, and the final
sits alone on the latest one — which makes within-day order irrelevant, because
everything on a day is the same round and a side plays at most one tie per round.

**Treat that as a transcription convention, not as what happened.** The real schedule
was whatever evenings people were free, so a round may have straddled two of them or
two rounds shared one. The day grouping is therefore a useful *check* when tagging a
past tournament — it should agree with the backward walk — but it is not a derivation,
and a future tournament scored through the app will not produce it. **The backward
walk is the only rule that holds for every tournament.**

**The dates are frozen and the ordering is not.** `idFor` hashes the day, the mode,
the names and the score, so changing a date changes the id and a re-import
*duplicates* instead of merging. Reordering lines within a day changes no id, because
the position only feeds `endedAt`. So a within-day correction is safe; a date
correction is not.

**A tournament's own date is its final's date**, not the range its ties span — a
one-line champions list wants one date per year, and the final is the day it was
actually decided.

## Open questions and risks

- **~~Somebody leaving mid-tournament~~** — answered, and the prediction held on both
  counts: it was the thing that forced a revisit, and it came down to "a real record or
  its own concept". A record won. See **A tie nobody played**; the substitute who takes
  their place is the half that would have needed the concept, and is not built.
- **A tie abandoned rather than won leaves nothing archived**, so the bracket shows it
  as still to play. That is correct, but it means "we started that one and gave up" is
  invisible.
- **The one-device constraint** deserves saying out loud before the draw, not on the
  day, because the failure is discovering it at the semifinals a fortnight later. The
  open question is whether the app should *say* so — a line on the tournament screen
  when storage is not persisted, or when the tournament was started in a browser tab.
  Cheap, and it is the only warning that could arrive before the loss rather than
  after.
- **A tournament left unfinished for a year.** The field is stale, the entrants may
  not be around, and it will still be offering ties as playable. **~~What abandoning
  one does to its ties~~** — answered: it is abandoned from the tournament screen behind
  a confirm, and its played ties stay in the archive and keep counting, which the dialog
  says. What follows from that is that **abandoning is not destructive and a re-import
  undoes it**: the draw is the only thing deleted, so a file carrying it brings the whole
  bracket back with its results derived afresh. Tombstones were considered and rejected —
  see `CLAUDE.md`.
- **Seeding from career stats was rejected in favour of a random draw**, so newcomers
  with no history need no rule. If seeding ever returns, that is the question it
  brings back with it.
- **~~The first tournament's results are lost~~** — answered: a champion with no ties is
  built, and it is all Hole Corn I gets. If a sheet ever turns up, the ties go into the
  legacy file under a `tournament` header and the reconstruction **replaces** the recorded
  result on import: the id is the name, so both are the same tournament, and
  `mergeTournaments` lets a draw beat a result-only copy for exactly this. Without that
  rule the upgrade is silent rather than manual — the local copy holds and the ties import
  tagged with an id whose tournament has no bracket to place them in.
- **~~Two tournaments open at once~~** — answered: allowed, see **How it came out
  differently**. Kept because the reasoning is still what a change would argue with.
- **Whether the setup screen's mode toggle should be disabled during a tournament**,
  since the tournament fixes it. Planning detail.

## What the scoreboard shows

The external board and the LED panel say **which tie this is**, and deliberately do not
show the entrants' form.

Form was the obvious thing to reach for, since the pre-game screen already draws it for
an ordinary game, and it is degenerate here rather than merely thin. A knockout only ever
puts unbeaten sides in a playable tie — `reachedBy` marks a side `out` the moment any tie
in its route has a winner that is not them, and an out side is seated in no further ties.
So at the moment the screen goes up both sides have won every tie they have played, the
pips read `WWW` against `WWW`, and the only thing that can differ is their length, by one,
when one side came through a preliminary. The same property rules out an in-tournament
head-to-head: two sides meet at most once in a bracket, which is what `matchBetween` relies
on to find a tie at all.

So a third retained topic, `holecorn/<code>/tie`, carries the cup's name and the round
while the tie has not begun, and is cleared at the first bag the way the lineup is. The
panel gives the whole screen to it; the tablet has room to keep the form table underneath
and caption it. The drawing decisions — why the sides stack, why the fixture spreads at 20
characters and not 21, why there is no first-thrower mark — are in `CLAUDE.md` under **The
tournament fixture card**, and the panel's own numbers are in `firmware/hub75/README.md`.

**The lineup the tablet keeps underneath is scoped to the series now** — see **The form
before a tie is the series'**. That does not reopen the decision above: the panel gives the
whole screen to the fixture card either way, because a 128x32 strip has room for one, and
what the card carries is the round, which no form line can say however it is folded. What
changed is that the tablet's table is worth reading at a tie, where before it was the
career numbers of two people about to play a cup.

Two things fall out that are worth recording:

- **The tie topic is what makes a first tournament visible at all.** The form screen is
  only published when somebody in the roster has played, so a cup of newcomers — round one
  of the first tournament — would have shown nothing. The card does not read the archive.
- **Cycling several screens on a timer was considered and rejected.** Beyond the obvious
  risk that the pre-game window is however long it takes to walk to the boards, a timer
  introduces phase, and phase is in no retained message: two boards would drift apart and
  a reboot would land mid-cycle. The whole-state retained model is what lets a board join
  late with no resync, and it is worth more than a second screen. If one ever earns its
  place it should be a layout id — retained, and chosen.

## Playing the draw out

The draw used to be a result that appeared. It is now an event: `Make the draw` lands on a
ceremony where each press pulls one name out of the hat and the board announces where it
landed. The children who used to pull the names out of a real hat press the button.

**The draw is made and stored whole before a single name is revealed.** The ceremony is a
view over `entrants`, not a second way to build one, and that one decision removes almost
all of the cost:

- No partial-draw state exists anywhere. `newTournament`, `bracket`, `bracketShape`,
  `validTournament` and the storage shape are untouched.
- A reload mid-ceremony lands on the finished bracket, so there is nothing to resume.
- **Always ceremonial, always skippable**, with no toggle and nothing persisted. A setting
  would have bought exactly what `Skip` buys in one press.
- Pre-drawing is indistinguishable from drawing per press — the same distribution, and
  nobody in the garden can tell — so the honesty cost is nil.

`drawSteps` derives the reveal from the stored draw, sharing `seatSides` with `build` so the
ceremony and the bracket cannot come to disagree about where a name landed. Three properties
fall out of `bracketShape`'s seat order that were not obvious and are worth recording:

- **Every pull is one of two shapes, not four.** Either an entrant with nobody to meet yet —
  the first name into a preliminary, or a bye whose sibling seat is still in the hat — or an
  entrant with an opponent, which is a person or the two halves of a preliminary they meet
  the winner of. That last one is the only thing a paper draw says that a finished bracket
  cannot.
- **A waiting entrant always resolves on the very next press.** Preliminaries occupy a
  prefix of each half, so a bye at an even seat is always followed by a bye at its sibling.
- **The draw always ends on a completed pairing.** The last seat index is odd for every
  bracket size, so its sibling is already out. An earlier fear that eleven entrants would
  trail off into three consecutive byes was simply wrong.

One tie is announced by no press at all: the one between two preliminary winners, where
neither side is known while names are still coming out. That is honest rather than missing —
nobody coming out of the hat decides it — and the bracket draws it.

### Two beats, timed by the phone

A press publishes twice: a card with the name withheld, and a beat later the reveal.
`PULL_MS` is 1100. The board animates nothing and knows nothing of the beat; it draws
whichever card it was last told about.

That shape was chosen over animating in `render.h`, and the reasons are worth keeping:

- **The pause is the theatre**, and it is the reasoning `Toss for first` already carries: a
  press that changes nothing visible reads as a dead button.
- **No phase on the wire.** A board joining mid-beat sees "pulling", which is true. Firmware
  animation would have needed an easing curve dumped and compared the way the splash's is —
  the splash proved scenes cannot pin a curve — plus a busiest-frame duty measurement against
  a ceiling `form-worst` already spends 28.5% of.
- **It is deferred rather than designed out.** The card shapes and the topic are identical,
  so animating later is purely "does `render.h` animate between them", with no protocol
  change. Revisit once the panels are on a bench and there is something to judge it against.

### The fourth retained topic

`holecorn/<code>/draw` carries the round, the side just pulled, the opponent as **0, 1 or 2
structured sides**, and the count. Retained and cleared like the lineup and the tie, and
**re-asserted on connect including the clear** — the clear matters more here than anywhere
else, because nothing about starting a game takes this topic down the way the first bag
clears the other two. A card left behind would sit on the board until the next draw a year
later.

- **Undebounced**, like `/layout` and unlike `/lineup` and `/tie`. Those settle for 400 ms
  because renames fire per keystroke; this changes on a button press, and at 400 ms the two
  beats would collapse into one and take the pause with them.
- **No cup name on a card that carries a pull.** Measured in `test_board_logic.cpp`: the worst
  case is 389 bytes of the board's 512, against the lineup's 423 — so `MQTT_BUFFER` is
  untouched. Adding a 32-unit cup name on top lands within 25 bytes of the buffer. `/tie`
  carries the name and has a packet to itself. The opponent travels as sides rather than as
  the words "plays winner of" for the same budget: the board writes them, which is free.
- **The one screen that needs no score message.** A draw happens before any tie is picked and
  before any game exists, so the card is drawn from its own payload alone — no names off
  `teamA`/`teamB`, and **no team colours**, because at the moment a name comes out of the hat
  nobody has been given one. The fixture card structurally cannot do this; it falls through
  to the dashes without a score behind it.
- **Precedence is `draw` > `tie` > `lineup` > score**, extending the chain `boardScreen`
  already answers. Nothing underneath a draw can be about it.
- **The panel draws no progress line and the display does.** The completing card needs all
  four of the panel's rows, and a count that appeared only on the two-row shape would read as
  the panel losing information rather than never having offered it. The count is published
  either way, and `parseDraw` deliberately does not read it — two fields in `DrawState` that
  nothing on the board can show would be worse than the asymmetry.

Like the form screen, the fixture card and the splash, the draw card has no layout id, so
`test-firmware.mjs` carries a fourth standalone assertion that some scene has one.

### The opening card

Between opening the ceremony and the first press the board used to show the last game's
score, which says the board has nothing to do with what everyone is standing around
watching. It now carries the cup's name and the word `DRAW`, and that is the card it holds
longest.

- **It is the cup name *instead of* a round, never as well.** That is what makes it free
  against the budget above: it is the one card with no pull on it, so it cannot be the
  topic's worst case however long the name — measured at 156 bytes against the pull's 389.
  `parseDraw` therefore takes a round **or** a cup where it used to require a round, and
  `render.h` gives the round precedence, so a card carrying both draws as the pull alone.
  `test_render.cpp` asserts that direction rather than leaving the split as a convention of
  the app's.
- **The cup takes the white row and `DRAW` the grey one**, which is the reverse of the tie
  card. Both were rendered and compared: the cup on top reads as a title, and `DRAW` on top
  reads as a label miscategorising the name under it. On this card the fixed word is the
  one that never varies, so it is the one that dims.
- **Two rows in the same place as the drum roll**, so the card does not jump up the panel on
  the first press — it is the same screen with the words replaced.
- **The display keeps one wording for the count**, so the opening card reads `0 of 11 drawn`
  rather than gaining a second phrasing for zero. A format that changes with the card reads
  as two different lines.
- **Nothing extra on it.** A row of `11 ENTRANTS` was available and is the progress-line
  objection again: information that appears only on the short shape reads as the panel
  losing it once the draw starts.

## The series

Hole Corn is played every year and the editions are told apart by a suffix — Hole Corn V,
Hole Corn VI. The app now groups them, so the screen can answer the two questions a single
bracket structurally cannot: **who has won this thing**, and **how has everybody done across
the years**.

It is worth being precise about why those two are missing rather than merely thin. **Where
the stats went** above records that most of the career screen is degenerate when scoped to
one cup — every head-to-head inside a knockout is 1–0, so `RIVAL_MIN_MEETINGS` can never
fire, and every surviving entrant's form is all wins, because a beaten side plays no more
ties. Those are facts about the *format*, so no amount of data fixes them. Across editions
both come back: sides meet again in later years, and a record can have losses in it. And
"how many has she won" has no single-cup equivalent at all.

### Options considered

#### A stored series, with editions created under it

The shape the idea arrived in: create `Hole Corn` once with its target and suffix style,
then create each year's edition under it and have the app allocate the next suffix. The
most explicit option, and the only one that could express a series whose names do not
follow a pattern.

*Eliminated because:* it is a second source of truth about something the names already say,
and the failure mode is the one this file exists to prevent — a stored membership saying one
thing while the names on screen say another, with no symptom. It also cannot be
retroactive: **`recordedTournament` deliberately keeps no field at all**, so Hole Corn I has
nowhere to hang a series id, and every other existing tournament would need backfilling. And
it adds a concept to `validTournament`, `mergeTournaments` and the export envelope — the
three places a new stored field is most expensive, since a merge that drops one is silent.

#### Derived from the name — **chosen**

`seriesKey` strips a trailing edition marker and folds what is left with `nameKey`. Nothing
is stored, so every tournament already drawn groups itself the moment it ships, a recorded
result included; there is no migration, and tuning the rule re-groups everything rather than
needing a repair.

*Chosen because:* the convention it reads is already **forced**. The draw form refuses a
name a tournament already has (see **How it came out differently**), and the note there
records the consequence in as many words — "an annual cup cannot reuse its name … which is
what this group does anyway (Hole Corn V, VI)". So the numbering is not a convention being
introduced for this; it is one the app already requires, now being read.

It is the same move as the rest of the feature: `bracket()` stores the draw and derives
progress, `inactive.js` stores when somebody was marked and derives the rest, and this
stores nothing and derives all of it.

### What the rule is

A whole trailing **word**, with something left in front of it, that is either an **uppercase**
Roman numeral in canonical form or a run of digits. Four details do real work:

- **Uppercase only for the numeral.** Read case-insensitively, `mix` is 1009 and `div` is
  504, so `Hole Corn Mix` would silently become edition 1009 of Hole Corn — wrong in the one
  way only somebody who knew the rule could spot. The cost is that a numeral typed in
  lowercase starts its own series, which is *visible* as two headings. `tournament.test.js`
  pins both directions.
- **Canonical numerals only**, which is why the shape is a strict regex rather than a loop
  that adds letters up. `IIII` parses under a loose rule and so do more real words.
- **A whole word**, so `Hole CornVI` is left alone.
- **Something in front of it**, so a cup actually called `V` is its own series rather than
  the fifth edition of a series with no name.

A number and a year are one case, not two — both step by one, and the style only decides how
the next is written. **A name with no suffix keys to itself**, which gives two behaviours for
free: a one-off is a series of one, so nothing needs a special case, and the common shape
where the first edition went unnumbered (`Summer Cup`, then `Summer Cup II`) groups
correctly.

### The prefill is the other half

Deriving from names means a typo splits a series, so the draw form offers the next edition
by name, with the mode and target the last one was played on. That removes most of the
typing that would cause the split, and it is why no "suffix style" is ever chosen: the style
is whatever last year's was.

It steps past a name already taken, and that is not hypothetical —
`import-legacy.mjs` dates a reconstructed tournament by its **earliest tie**, so a sheet
transcribed years later lands wherever its ties say rather than in numerical order. Without
it a suggestion could fill the form with a name the same form then refuses.

It deliberately does **not** carry the field. Who plays changes year to year, and the roster
chips already enter everybody the app knows in one press.

### The form before a tie is the series'

The payoff the section above was left open for, and now taken: a tie's Form panel counts
that series' ties rather than all of history. `seriesHistory` returns the pool and
`App.jsx` hands it to the panel; nothing new is stored, and `Lineup` is unchanged but for
a heading.

The case for it is the one this section opens with. A career answers "how does she play";
standing at a tie the question is "how does she do at this", and inside one bracket that
has no answer, because every side still standing is unbeaten. **What the scoreboard shows**
rejected in-cup form for exactly that reason. Across editions the objection lifts, and the
two questions the entry left open both settled the same way:

- **It replaces the career numbers rather than sitting beside them.** The panel is already
  five columns on a phone, and a second record per row is the column it can least afford.
- **The board publishes the same pool.** It draws its own version of this panel, and two
  answers to "how has this side gone" a metre apart is a disagreement neither surface can
  resolve. One `formMatches` in `App.jsx` feeds both.

**The LED panel was offered the same figure and turned it down**, which is worth recording
because it is not a space problem and will otherwise read as an obvious gap. The fixture
card has room: a per-side record beside each name fits — 21 characters becomes 17, or 15
beside a two-digit figure — and it costs **no duty at all**, because the record takes its
width out of the name, so a row is still at most 21 glyphs (measured: 15.0% against the
plain card's 13.5%, and *down* 34.9% to 32.7% in an all-glyph worst case). It was built end
to end on 2026-08-05 — payload, `render.h`, the JS mirror, the host scenes — and reverted on
looking at it. Two facts came out of the exercise and are the reason not to rebuild it
blind:

- **There was never a spare row.** The spread card's extra height is `TIE_SPREAD_TOP` plus
  `TIE_SPREAD_GAP` — two gaps around a fixture that already sits on the bottom row — so a
  record drawn there is clipped. A card carrying one has to stack, whatever the names
  measure, which means the card changes shape once a cup has history behind it.
- **Doubles could never have it**, and that decided the shape of the whole thing: an
  entrant is a *side*, so the figure would be a pair's, and this group pairs up by whoever
  is around. Two sides that have never played together both read `0-0`, which is the
  degenerate line the card exists to replace. So it would have been a singles-only line on
  a card whose other three rows are mode-blind.

The third question was not anticipated and is the one worth recording: **what a series with
no history behind it should show.** Falling back to the career numbers when the series is
thin was the obvious answer and is wrong — the basis would then change with the data, so
two lineups reading `12-7` and `1-0` would be counting different things with nothing on
screen to say which, which is precisely the failure this file exists to prevent. So it is
scoped always, and the empty end needed no code at all: the panel already draws nobody with
no matches behind them, so the first tie of a first edition simply has nothing to say and
stays away. The heading (`Form in Hole Corn`) is what makes the basis readable in the case
where it does draw.

### Explicitly not doing

- **No series entity, and so no renaming, deleting or merging one.** Renaming a series is
  renaming its editions, which is a thing the app does not do to a tournament at all.
- **No seeding from a series' record.** The draw is random, which **Open questions** already
  settles; knowing who has won it four times does not change that.

## Where the rules live

This repo has no pull requests — work goes straight to `main` — so the rules a future change
has to respect are in `CLAUDE.md` under **Tournaments**, and this file keeps the decisions and
the alternatives that were rejected. The two deliberately do not repeat each other: *why* the
bracket is derived rather than stored is here; *what breaks* when you change it is there.
