# Tournaments

Running the family knockout from the app: it holds the field and the draw, says which
ties can be played, and files each tie into the archive tagged, so past tournaments
are readable afterwards and tournament form is separable from everyday form.

Status: **built.** Everything below describes shipped behaviour, except where marked. This
file keeps the decisions and the options that were rejected; the rules a future change has to
respect are in `CLAUDE.md` under **Tournaments**.

Seven things came out differently from the plan, each noted under **How it came out
differently**: several tournaments may run at once; a tie can be put back with `Leave tie`;
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
- **`casual` games are never archived**, so a guest game cannot be a tournament tie.
  The two are mutually exclusive.

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
not pollute it because `casual` is never archived.

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
    are no ties, so it can never contradict a bracket that does exist.

### How it came out differently

Each of these was decided after the record was written, and each replaced something the
Decision above specified:

- **Several tournaments may run at once.** A singles cup and a doubles cup in one summer is
  an ordinary thing to want, and nothing in the bracket cares — each derives from its own
  tagged ties. The setup button therefore names the *screen* (`Tournaments`) rather than a
  tournament: it briefly named one and counted the rest, which read badly once a name could be
  32 characters, and it named the **oldest** unfinished one, so a tournament drawn today sat
  behind one from last year that nobody finished.
- **`Leave tie` puts a tie back.** Decision 7 locks a tie's names, and with nothing else on
  the screen that left `Start` as the only exit — so a mis-tapped tie had to be played, or
  started and abandoned. Gated on `gameStarted` for the reason `setCasual` is: untagging a game
  with committed rounds would take the tie out of its bracket and leave the record behind.
- **The bracket is drawn as columns, not listed by round.** The BBC's knockout layout: one
  column per round, deepest on the left, `‹ ›` paging on a phone. What makes it possible in
  plain CSS is **The perfect tree** below.
- **`entrantFaults` refuses a doubles pair with one half missing.** `sideKeyOf` filters blanks,
  so `['', 'Tau']` looked like a good one-person side: the draw succeeded and the tie it
  produced could never be started, because `lineupFaults` refuses a blank slot and `Start`
  stays off. A side must now have as many people as it has slots.
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
- **No walkovers, retirements, best-of-three, third-place playoffs or re-draws**
  between rounds.
- **No mid-tournament change to the field.**
- **No bracket state machine**, and nothing about a tie's position stored on its
  record beyond the tournament id.
- **No second route into a live game** — ties are played through `setup`.

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

- **Somebody leaving mid-tournament** is out of scope by decision, and it is the most
  likely thing to force a revisit. A walkover produces no match, so the derivation
  cannot see it at all; it would need either a real record or its own concept.
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
- **The first tournament's results are lost.** A champion with no ties covers the
  champions list, but the bracket itself is gone unless a sheet turns up. Worth asking
  the family before building the import, because the accommodation is only needed if
  nothing survives.
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

## Where the rules live

This repo has no pull requests — work goes straight to `main` — so the rules a future change
has to respect are in `CLAUDE.md` under **Tournaments**, and this file keeps the decisions and
the alternatives that were rejected. The two deliberately do not repeat each other: *why* the
bracket is derived rather than stored is here; *what breaks* when you change it is there.
