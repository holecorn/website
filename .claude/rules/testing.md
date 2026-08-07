---
paths:
  - "src/*.test.js"
  - "src/App.jsx"
  - "tools/*.mjs"
  - "firmware/hub75/host/test_*.cpp"
---

# Testing

Detail behind **Testing** in the root `CLAUDE.md`, which holds the three facts that
apply whatever you are testing.

## What each suite and check is for

`src/scoring.js` is pure and fully testable; the suite is the safety net for the
rules above. When changing scoring behaviour, update the tests too — and for a
bug fix, add a test that fails without the fix first, and *check that it does*.

The scoreboard's failure paths are covered by `src/scoreboardLink.test.js`, which
drives the transport with a fake MQTT client, because the cases that matter — a
lost acknowledgement, a refused subscription, a half-open socket — are ones a
real broker will not reproduce on demand. `openScoreboardLink` takes an
injectable `connect` for exactly this; production never passes it.

`src/rules.test.js` is the odd one out: it tests the notes rather than the app. A rule
file reaches a reader only through its `paths:` frontmatter, and prose and globs drift
apart in both directions with no symptom either way — the rules simply don't arrive, and
the next change breaks something the project had already written down. So it asserts that
every `src/` file the rules discuss is matched by some rule file's globs, and that every
glob still matches a file. The first found `App.jsx`, `main.jsx` and `nameField.js`
orphaned; the second is the rename guard, and fails on a glob pointed at a name nothing
answers to. It sweeps `src/` only — `tools/*.mjs` and `firmware/hub75/` are covered
wholesale, by this file's own globs and by that directory's `CLAUDE.md`, so nothing new
there can slip through. Where `App.jsx` ended up, and why `scoreboard.md` was left off,
is in the root `CLAUDE.md`.

`tools/verify-positions.mjs` covers the court and in-game stats panels, and the
assertion it exists for is that **the court names the same thrower the scoring
lanes do**. Both sides derive the parity correctly and are unit tested; nothing
below `App.jsx` can catch it handing the wrong one to the wrong component, and
crossing them over passes all 131 unit tests. Checked by inverting `activeIdx`,
which fails that assertion and nothing else. **The arrangement controls are there
for the same reason, and more so now that they sit in a different panel from the
drawing they change**: a bag wired to the partner of its own row, and the setup
handlers reaching the play screen's edit dialog, both pass all 220 unit tests and
fail only here. **Which screen the court is on is the same kind of gap**: nothing
below `App.jsx` can see it, so the `setup` prop passed at neither call site or at
both is invisible to the unit tests either way round. Verified by mutation — each
fails only its own half, the missing prop on the setup assertions and the extra one
on `singles leaves the far end empty`. The toss is covered there too, and only *properties* can be —
the draw is random, so it asserts that both start-board players come up over 20
presses, that no far partner ever does, and that the four names never move. It also
holds the pause: the result faded out inside the window, the marker still where it
was, **and the button not having moved** — that last one is the only thing that
would notice the line being emptied rather than faded. Verified by mutation:
pointing the toss at slot 1, pinning it to team A, reading the line off the other
team, dispatching on the press with no pause, and emptying the line each fail only
their own assertions.
  - **Every wait in that block reports rather than throws**, and the no-pause
    mutation is why: `waitForSelector` on a class that never appears ended the run
    with a stack trace instead of naming the fault. Same lesson as the ordering of
    `verify-stats.mjs`'s absence assertions.
  - **The reveal has to be waited out separately from the class**, which goes at the
    *start* of the fade back — reading opacity on the class detaching measured ~0 and
    failed three runs out of three. The mid-toss read is taken 220ms in for the mirror
    of that reason: at the instant of the press the 150ms transition has gone nowhere,
    so an immediate read says nothing either way and passed and failed at random. It also asserts what the controls' *absence* is worth — no bag or
chip in that dialog — because nothing in `TeamsFields` itself would notice.

`src/stats.test.js` builds its fixtures by playing rounds through the real
scoring functions and archiving the result, rather than hand-writing record
blobs, so a rules change that breaks attribution surfaces there instead of
quietly agreeing with a stale fixture. `tools/verify-stats.mjs` covers what the
unit tests can't: that the effect in `App.jsx` fires on the right transitions.
That is the part which would otherwise either lose every match or file each one
twice, with the pure helpers passing throughout. It covers the same gap for
renaming — that a career rename reaches the setup lineup and a per-match fix does
not — where both halves of each are individually correct and only the wiring
between them can be wrong.

It covers a third such gap for **a match imported with no round detail**, seeded
beside a real one because both have to be true at once. `finalScore` and `summary`
are unit tested, but `Stats.jsx` reading the score off `totals()` instead compiles,
passes all 275 unit tests and puts **0–0** on every imported row — and the same is
true of a rate keyed on `played` rather than on the round count. The skunk
assertion needs the real match to be **24–12 rather than a skunk itself**, or the
chip reads 1 whether the guard is there or not.

It covers **whether the import control exists for anything but a finger**, which is a
gap of a different shape: nothing was wired wrongly, the control was styled out of
existence. A `display: none` file input has no box, cannot take focus and reaches the
accessibility tree as loose text, so the app's only route off a device was pointer-only —
and the check that was supposed to cover it asserted `getByText('Import JSON')`, which was
true the whole time because the *label* was always drawn. **A check on the words is not a
check on the control.** Five mutations, each killed by the assertions aimed at it:
restoring `display: none` fails six, including the upgraded `import is offered`; dropping
the ring rule fails only `the focus ring lands on the visible label`; `:focus-within` for
`:has(:focus-visible)` fails only `but a tap leaves no ring behind`; `tabIndex={-1}` fails
the tab stop, the ring and the picker; and removing the label's text fails the two
name-based ones.
  - **The picker wait is bounded loosely and swallowed, and both halves are
    load-bearing.** A hidden input never opens a chooser, so an unbounded wait ends the
    run in a stack trace two blocks early instead of naming the fault — this file's
    standing lesson. But bounded at 3s it failed **in the CI container and nowhere
    else**, passing in headed Chrome and in bundled headless Chromium locally, so it was
    measuring the runner. 15s bounds a mutation without measuring the machine, and `act`
    is what found this — a local pass said nothing.
  - **Only the *pointer* half waits for a chooser now, and the keyboard half asserts
    that the press lands.** Loosening the bound was the wrong read of the same symptom:
    at 15s the event is not late, it is **absent**. Measured with a capture-phase
    listener, a failing run delivers `Enter` to the focused `input[type=file]` with
    `isTrusted` true and `defaultPrevented` false and no chooser ever follows, so
    nothing about the app differs between a run that passes and one that fails — and it
    is intermittent, 5 of 8 container runs on one tree against 0 of 4 on another that
    could not affect it. A pointer activation opens one every time, which is why that
    half is unchanged. **Don't restore the keyboard chooser wait**; it cannot be made to
    measure the app in that container.
    - It still kills the mutation it exists for. Under `display: none` the input leaves
      the accessibility tree, so Tab skips it and no key reaches it at all — measured,
      that mutation fails the tab stop, this, and the tap, six assertions in total, the
      same count as before the change.

The same is true of the guest-game guard, and both ways round of getting it wrong
are silent: either a stranger is folded into somebody's career, or every real match
quietly stops being filed. So that block plays a casual game to a win and then
**turns the toggle off and plays a real one**, which is what makes the guard the
flag rather than a break in archiving. Verified by mutation: dropping the guard
fails the first, and latching it in a ref — the plausible mistake, since the effect
already keeps `archivedId` that way — fails only the second. Guarding
unconditionally is caught by the checks at the top of the file instead.

The lineup-faults block spends most of its checks on the lineups that must
*start*, not on the ones that must not: a rule that never lets go is the same bug
as one that never bites, and `lineupFaults` is already unit tested. So it covers
the defaults the app opens on, a save written when both teams defaulted alike,
four different people in doubles, and a guest game. Verified by mutation —
dropping the `disabled`, the `casual` guard, the blank fault, the joined hint, the
`loadGame` rewrite and the new defaults each fail only their own assertions.

That run also found an inert line: **whether blanks are counted alongside names
changes nothing**, because which fault a slot gets reads off its key rather than
off the count. The comment there says what the code does instead of implying that
line is the guard — the unit test still pins the rule, since deriving the fault
from the count is a plausible rewrite that would break it.

It also ends by stripping the secure-context-only APIs and reloading, because
**every other browser check runs on `localhost`, which is a secure context** —
so none of them can catch a secure-context regression, and a blank page on a LAN
IP would otherwise only turn up on a phone. The APIs are deleted rather than the
build being served on a real IP, so it stays deterministic in CI. That block
checks the page rendered *before* clicking anything: the failure is a blank page,
and waiting on a button that will never appear times out the whole run instead
of reporting.

`npm run test:firmware` compiles and runs both host C++ suites, checks that
`glyphs.h` and `src/panelGlyphs.js` still match `src/segments.js`, and compares
`src/panelRender.js` against the framebuffers `test_render.cpp` just produced.
That last one is what makes a browser copy of `render.h` safe to have at all — see
`firmware/hub75/CLAUDE.md`. One assertion in `test_render.cpp`
is not about rendering at all: `DUTY_CEILING` caps how much of the panel any
scene may light, because the decision to run both panels through the
controller's 5 V terminals depends on it and no electrical test exists to catch
a layout that broke it. That last check is why it is worth
having: the generated header is the app's own digit geometry, so an app-side
change silently stops matching the panel until someone regenerates. These were
manual for a while and drifted twice — a fixture that claimed to be "exactly
what `scoreboardPayload()` produces" but was missing a field, and two characters
`FONT_CHARS` advertised with blank glyphs behind them.

The fixture card is covered by `verify-form-screen.mjs` rather than there, because it
needs a broker. Everything about *what* it draws is pinned by the pixel check, so what is
left for a browser is the wiring, and the block that matters most is the last one: it
draws a bracket on a phone, taps a tie, and asserts the board names that round and those
two entrants. Every other assertion in the file drives `sendTie` directly and so says
nothing about whether picking a tie ever calls it — a chain of derivations in `App.jsx`
(`liveTournament` → `playingTie` → `publishedTie`) each individually correct however they
are wired together. Verified by mutation: publishing `null` instead fails exactly that
block.
  - **Two of its assertions were written wrong first, both in the file's own known
    ways.** Reading the tie's names off `.team-name-input` gave an *empty* list, because
    a tie's names are locked and render as `.team-name-static` — and `[].every()` is
    true, so it passed. And the panel's card was compared against a lit count measured at
    the top of the file, which by then was a *different* roster, so it differed however
    the precedence went. Both now measure the thing the property is about.

**The draw card is covered there too, and it shares that last block.** The same gap and
the same shape: everything else drives `sendDraw` directly, so the phone's own `Pull` is
pressed inside the bracket block and the board is asked to name the entrant the phone just
pulled — read off the phone rather than written down, because the draw is random and the
check cannot know it. Two mutations were run and each failed only its own assertions:
handing `Tournament` an `onReveal` that does nothing kills the two crossing assertions,
and dropping the clear-on-unmount leaves the card up through the tie that follows. Its
other blocks cover what only a live board can show — the card beating a retained score,
lineup and tie all at once, and standing on a board that has **never** been sent a score,
which the fixture card structurally cannot do.

`tools/verify-tournament.mjs` covers the tournament, and the block it exists for is
**reversibility**: win a tie, undo the winning round, and the bracket goes back to
nothing played with every opening tie live again. `tournament.js` is pure and unit
tested, so everything here is about the wiring — that a tie loads locked and tagged,
that `New game` clears the tie-ness, that an imported bracket appears without a
reload. Each was verified by mutation.

The draw ceremony's block is there for one crossing: `drawSteps` is pure and unit
tested against the pairings `bracket()` draws, so what is left is whether the screen
is playing out **the tournament that was actually saved**. A re-shuffle anywhere
between `Draw` and `Ceremony` would announce pairings the bracket never draws, and by
the time the bracket is up the card is gone — so it asserts the order pulled equals
the order stored. Every draw in that file now goes through `skipCeremony`, which
reports rather than throwing: the first version waited bare on `.bracket-scroll` and a
missed site ended the run at the block that drew first, which is the file's own
recorded lesson happening again.

The Stats tab's block is there for the same kind of gap. The derivations behind it are
pure and unit tested, so it asserts only what crosses a boundary: that selecting an
entrant on one tab lights their route on the other, that the lit boxes agree with the
table's own count of that entrant's ties, and that a cup with no round detail loses its
rate columns while one played through the app keeps them. Verified by mutation — cutting
the route off from the bracket, dropping the reset when a row shuts, and pinning the
detail gate on each fail only their own assertions.

The series blocks cover the same kind of crossing again. `groupBySeries`, `seriesStats`
and `nextEditions` are pure and unit tested against those very fixtures, so the browser
checks assert only what no unit test can reach: that the screen draws a `Series` section at
all, that it draws one only where a cup has been played more than once, and — the one the
block exists for — that **the name the draw form is handed is a name the draw form will
accept**. `nextEditions` and the form's duplicate rule are each correct alone and only their
pairing can be wrong, so the fixture carries a sixth edition dated *before* the fifth;
without it the suggestion never collides and the assertion cannot fail, which is the file's
own recorded habit happening again.

**Two of those mutations landed nowhere near the block under test**, which is worth knowing
before adding a section to that screen: a series row reusing `.tournament-progress`, and a
one-off cup being treated as a series, each end the run on a strict-mode violation in an
*existing* block a thousand lines above — one because the class is queried unscoped, the
other because every one-tournament fixture then grows a second `.tournament-list h2`. The
first was a real defect and is fixed by `.series-holder`/`.series-count`; the second is why
that mutation is done by raising the threshold instead.

**That file taught the same two lessons repeatedly, and they are worth knowing before
adding to it:**

- **A bare `waitForSelector` swallows a mutation.** Three times, a mutation removed
  the thing under test, the wait timed out, and the run *ended* — naming nothing and
  skipping every block below. Waits that are really assertions go through a helper
  that reports instead of throwing.
- **An assertion that passes for the wrong reason is the normal failure mode, not a
  rare one.** Five in this file: two measured `0 of 0` on a fixture with nothing to
  count, two compared rendered text width where the property was about available
  space (`45px vs 135px` looked like a regression and was not), and one ran on a
  fresh tournament whose live ties are in the outermost round anyway, so pinning the
  opening round to zero passed. The habit is reaching for whatever is easiest to
  query rather than the quantity the property is about. **Check what a mutation
  actually prints**, not merely that something failed.

`tools/verify-tabs.mjs` covers the one thing a second tab can be, and no unit test has
one: a stale copy of the game. Measured before the fix — a tab left on setup, three
rounds played in another tab, one keystroke in the stale tab's name field, and storage
went from three rounds to **zero**, with the playing tab reloading to an empty setup
screen. Six mutations were run and each was killed by exactly the assertion aimed at it,
including two that are only visible as *numbers*: dropping the persist effect's
already-saved guard cost 28 extra writes for three rounds of play, and breaking
`upsertMatch` filed the win twice, which is what shows the adopting tab really does
re-archive and that the upsert is what holds it to one record.

- **A tab that is asleep is simulated by dropping the `storage` registration**, not by
  hiding the page. `page.bringToFront()` does not move `document.visibilityState` in
  either browser — measured, no transitions at all — so the `visibilitychange` path is
  driven by dispatching the event on a page that never listened for `storage`. That is
  the honest half: whether a browser fires it on unfreeze is the browser's behaviour,
  but that the app listens for it and catches up is ours, and the mutation kills it.
- **Both tabs must be able to write for the block to mean anything**, so the once-stale
  tab's edit is driven from whichever screen it is on and asserted through the write
  counter. The first version tapped a bag unconditionally; on a broken app the tab is
  still on setup, the click timed out, and the run ended two blocks early — the file's
  own recorded lesson, met on the first mutation.

`tools/verify-recovery.mjs` covers a gap of the same shape one level down: not what a
second tab does to the game, but what an **unplayable** game does to the app. Measured
across 43 shapes a `holecorn.game.v3` value can hold, 18 blanked it and none recovered,
because the crash is during render so the persist effect never runs and the bad value is
never rewritten. `validGame` is pure and `scoring.test.js` holds the corpus shape by
shape; what only a browser can see is whether `loadGame` *calls* it — deleting that one
line passes all 635 unit tests.

- **It is two-sided, and that is the point.** Over-rejection is the failure this kind of
  guard invites: a validator that refuses a playable save silently deletes a game in
  progress, and widening the refusal is the tempting way to make a future failure go
  green. So the file also asserts a good save is still played and that one written before
  four of today's fields existed still loads its rounds. Six mutations, each killed by
  the block aimed at it — and the two over-rejecting ones (demand an id; ask before the
  merge instead of after) are killed *only* by that second half.
- **A blank page has no selector to wait for**, so the `.app` wait is bounded and
  swallowed. Unbounded, the first mutation ends the run in a stack trace instead of
  naming which shape did it — the lesson `verify-tabs.mjs` records above, met again.
- **Falling back is not enough; it has to fall back to something startable.** The check
  requires the setup screen *and* an enabled `Start`, because a fresh game that
  `lineupFaults` refuses would be a different way to be stuck.
- **The mutation harness must restore from a snapshot, not `git checkout`.** HEAD is
  pre-fix while the work is uncommitted, so restoring from git wipes the fix and every
  mutation reports identically — a green-looking harness measuring nothing. Second time
  that has bitten in this series; the other was forgetting to rebuild `dist/`.
- **It also covers the same question one key over: what the app does with *history* it
  cannot read.** Here rather than in a tenth file because it is the same failure with a
  different key. It seeds the archive, the draw and the marks with shapes a newer
  version would plausibly write, loads a won game so the archive effect fires without a
  tap, and requires all three raw values **byte-identical** afterwards — measured before
  the fix, that one game took 300 matches to 1. It asserts the footer *says* so too:
  refusing silently makes a phone that has stopped recording look like one that hasn't.
  - **Two-sided for the same reason the block above it is.** A guard that refuses every
    write passes all four of those assertions while recording nothing ever again, so a
    readable archive must still gain the won game. Four mutations: dropping the guard
    fails the three key assertions, refusing everything fails only the two-sided one,
    and reusing the full-archive wording fails only the notice block. **Treating absent
    as unreadable fails nothing here** and is caught by `store.test.js` instead — a
    phone that has never stored a match has no key to seed.
  - **The notice block is the only thing that can see `refusal()`.** Both messages are
    correct strings and both write paths are correct; only the choice between them can
    be wrong, and the wrong one sends you to export an empty archive and delete matches
    that are not listed.

`tools/verify-a11y.mjs` covers whether a round can be scored without seeing the screen,
which is a gap of the third kind: not a value handed to the wrong component and not a
number, but a **role and a name that only exist in a browser** — `vitest.config.js` is
`environment: 'node'` and nothing imports a `.jsx`, so the entire accessibility tree is
invisible to the unit suite. Before it, the lanes were 24 buttons named `bag hole` /
`bag board` / `bag floor` and the bag's resting tier was not exposed at all.
- **The tab-stop count is the assertion that earns the file.** Every other one — the
  group per bag, its label, the checked option — passes with the radios' `name`
  attribute deleted, at which point there is no grouping and the board is 24 stops
  again. Five mutations: no `name` fails only the count, no group label and no
  `role="radiogroup"` fail the naming block, `checked` pinned false fails four, and a
  label naming the player but not the bag fails only the distinctness assertion.
- **The label is read off `.lanes-team` rather than written down**, because in doubles
  the name on the card changes hands every round and hard-coding one would pass while
  the lanes named the wrong partner.
- **Focus is reset by focusing `document.body`, not by blurring.** The sequential focus
  navigation starting point survives a blur, so Tab resumes from the last thing clicked
  and the walk silently misses every lane before it — measured, 6 stops instead of 8,
  which reads as a failure of the fix rather than of the check.
- **The live region's sentence is checked in `scoring.test.js`, not here.** `roundReport`
  is pure, so ten mutations of it — a wash read as a score, the four bagger dropped or
  called at three in the hole, the plural dropped, the skunk dropped, the round number
  pinned, `playerLabel` for `teamLabel`, the score line kept after a win, a sentence
  before the first round — all die against exact expected strings. What is left for the
  browser is only the wiring: that the region exists on a fresh play screen, is empty,
  is clipped rather than drawn, and holds the report afterwards.
- **It is located `getByRole('status')`, not `.main > [role=status]`.** Measured: with a
  selector, adding `aria-hidden="true"` to the region passes every assertion in the file
  while no screen reader would ever read it. The role query is what fails that.
- **The history block splits the same way**, and for the same reason: `roundLine` is
  pure, so seven mutations of it — naming one partner instead of the side, naming
  nobody, keeping the tiers nothing landed on, calling a zero net a score, swapping the
  two tiers, reading the same side for both cells, and having nothing to say for a side
  that put nothing on — die in `scoring.test.js`. The browser has the wiring and the
  seen half: four mutations of `App.jsx` fail it (the sentences dropped, the glyphs let
  back into the tree, the heading announced as a column header, the heading's two
  colours swapped) and a fifth, the heading deleted outright, fails three checks.
- **The heading's colours are read in one `page.evaluate`, not per element.** Deleting
  the heading altogether then fails those two assertions as well; located separately it
  timed out of the whole file instead — the same crash-rather-than-fail the live
  region's `allInnerTexts` avoids.

**The browser checks take a different branch on the runners than they do locally**
— `channel: 'chrome'` here, Playwright's bundled Chromium when `CI` is set — so
passing locally is not evidence they pass in CI. `act` covers that gap for the
`build` and `firmware` jobs; the `deploy` job can't run locally at all. See
`tools/README.md`.

**The browser binary is the smaller half of that gap; the *fonts* are the bigger
one.** `system-ui` is SF Pro on a Mac and whatever fontconfig picks on the runner,
so every check that measures a text-sized box reads a different number there —
measured, 22px across `.setup-top`, which is what turned a row with 10px of slack
into a failed deploy. Nothing about that is visible from a local run, in either
browser, because both use the Mac's fonts. **So `act` is the only way to check a
layout change, not merely a workflow change** — run it before pushing anything that
moves a width, and treat a local pass as saying nothing. `--with-deps` is kept in
the workflow for the same reason: part of what it installs is those fonts.

CI runs `npm test`, the build and `npm run test:browser` in one job, and
`npm run test:firmware` in a parallel one. All of them gate the deploy —
including the firmware, even though it doesn't ship with the app, because the
two share a contract and nothing else notices when it breaks.
`verify-winner-flash` and `verify-form-screen` are deliberately **not** in that
set: they need a real broker, and a deploy should not fail because a third party is
down. `verify-form-screen` covers the one thing nothing hermetic can — publish →
retain → subscribe → override the chosen layout → clear → back to the score, on
both `?display=1` and `?panel=1`, plus a display opened late recovering the
retained roster. It is also the only place a career rename can be watched reaching
the board while the stats screen is still open, which is the window the app's own
copy of the archive used to be stale in — see **Editing names** in
`.claude/rules/archive.md`. Everything either
side of that is covered without a broker: the
payload and the clear in `scoreboard.test.js`, the retain-and-re-assert behaviour
against a fake client in `scoreboardLink.test.js`, and the drawing itself by the
pixel check.
