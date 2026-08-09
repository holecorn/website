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

**An assertion that passes for the wrong reason is as common in the unit suites as in
the browser checks**, which the sections below catalogue at length. Four were found and
fixed at once, and they share a shape — the fixture cannot tell the two answers apart:
- **A symmetric fixture.** The form test played seven matches of `W L W L W L W`, where
  the first five and the last five are *the same list*, so `slice(0, 5)` for `slice(-5)`
  survived a test whose name is "keeps only the tail". It is a deliberately lopsided run
  now. **A fixture for an ordering rule has to be asymmetric under it.**
- **A bound the fixture never reaches.** `rows.every((r) => r.w <= 999)` over 120
  matches is true of 120 whether the clamp exists or not, so deleting both `Math.min`
  calls left the suite green. It builds 1,000 wins and reads 999 now.
- **A field the code under test doesn't decide.** `mergeMatches`' tie rule was asserted
  on `endedAt`, which `upsertMatch` keeps from the local copy *whichever* side wins the
  merge — so `>=` for `>` survived. It is read off the players now, which is the half
  the rule actually settles.
- **A boundary tested only at its ends.** `roundComplete` went 8 → 4 → 0 unthrown, so
  `=== 0` for `<= 1` survived — the state that matters, one bag you forgot to score, was
  never in the fixture.

The scoreboard's failure paths are covered by `src/scoreboardLink.test.js`, which
drives the transport with a fake MQTT client, because the cases that matter — a
lost acknowledgement, a refused subscription, a half-open socket — are ones a
real broker will not reproduce on demand. `openScoreboardLink` takes an
injectable `connect` for exactly this; production never passes it.

`src/useScoreboard.test.js` covers the layer above it, and it is the **only file in
this project that needs a DOM** — hence the `// @vitest-environment happy-dom`
docblock and the two devDependencies (`happy-dom`, `@testing-library/react`) that
exist for it alone. `vitest.config.js` stays `environment: 'node'` for everything
else. It was written because that hook had no test and **CI executes none of it**:
every check in `npm run test:browser` runs with the scoreboard off, and the two that
drive a real publisher are deliberately outside that set because they need a broker.
So the five debounce timers, the four JSON dedupes, the five `pending*Ref` replays and
the `{ value }` wrapper were all unexecuted on the path that decides what a board shows
for a whole game.
- **The transport is mocked, not faked at the socket**, because the file above already
  drives the real one. What is left for this one is *when* the hook calls it and with
  what — so `openScoreboardLink` returns a promise the test resolves by hand, which is
  the only way to reach the replay paths at all: everything computed before it resolves
  has nowhere to go but a pending ref.
- **The `{ value }` assertions are the ones that earn the file.** A computed null is an
  instruction — clear the retained topic — and a ref holding the payload cannot tell it
  from "nothing pending yet", so a board reconnecting mid-game sits on the form screen
  while the score moves underneath it. Unwrapping either ref fails only its own test.
- **A layout assertion taken at mount cannot see the press.** The first version asserted
  `sendLayout` after opening the link, which the *replay* answers — so deleting the
  undebounced press survived it. It rerenders with a changed `config.layout` after the
  link is open instead, which is why `config` is a prop with a default rather than a
  constant closed over. Same shape as this file's standing lesson one layer down.
- Seventeen mutations were run and each of the sixteen that changes behaviour is killed
  by the assertion aimed at it — the debounce removed, each of the four dedupes dropped,
  each of the five replays dropped, both `{ value }` wrappers unwrapped, the draw
  debounced, the unknown layout falling back to `full`, the version guard dropped, and a
  null lineup skipped as "nothing to send". The seventeenth is equivalent: dropping the
  `return` after `setSenderOnline` falls through to `msg.payload`, which is `undefined`,
  which `acceptsUpdate` already refuses.

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

`src/shared.test.js` is the third of that kind, and the one with the best evidence behind
it. Six notes across these files say some helper was consolidated because a second copy
would drift — `nameKey` and `sideKeyOf` so the career fold and the bracket agree,
`sideLabel` because four callers join names, `FormPips` and `dates.js` because two copies
of "what this looks like" have no symptom. Prose was holding all six, and it **did not
hold**: `pct` had three identical definitions, so the career table and the setup Form panel
quoted the same percentage through different functions, and `GameStats.jsx` hand-rolled the
plural `format.js` exists to get right. A one-line formatter is easier to retype than to
import and there is no structural fix for that, so `OWNED` names each helper and the module
allowed to declare it. Verified by mutation: putting the local `pct` back fails it and
names both files. Declarations only, so a call site or an import is not a false positive,
and the suites are excluded — a test may spell out whatever value it likes.

`src/css.test.js` is the other one that tests something the app never runs: the cascade in
the stylesheets. Every top-level `@media` block redeclares selectors the base rules already
set, with no extra class to lift it, so it wins **by source order alone** — and a base rule
written below it silently takes that win back, at one viewport size, with nothing failing.
It asserts the property rather than the position the notes used to claim: a base rule may
sit below a tier, it may not redeclare a property that tier sets for the same selector.
**Verified by mutation and not by failing today**, because the invariant does hold — adding
`.history { font-size }` to `App.css`'s landscape tier fails it and names the rule, the
property and the tier; adding `.history { letter-spacing }`, which no base rule sets,
correctly passes. The positional version would have failed on 47 harmless rules and still
not said which one mattered.

**That file now holds a second thing only the stylesheets know: what colour is drawn on
what.** Contrast is invisible from both directions — `environment: 'node'` and nothing
imports a `.jsx`, so no unit test reaches a rendered colour, and a browser check cannot
help either, because a 1.59:1 button renders perfectly and screenshots clean. It asserts
three properties: that `--on-accent` clears 4.5:1 on every `PALETTE` colour, that every
`PALETTE` colour clears it as text on `--panel` and `--bg`, and that no rule setting both
a fill and an ink pairs them under 4.5:1. Verified by mutation, each killed by the
assertion aimed at it and no other — the old blue fails only the text one and names the
figure (4.15), and white ink restored on `.end-round` or `.ceremony-pull` fails only its
own file's rule check, naming the selector, the pair and the ratio.
- **The winner banner needs a fourth assertion, because the first three cannot see it.**
  Its fill is an inline `colors[winner]`, so the stylesheet holds an ink with no
  background beside it — and it is the rule with the worst figure. That one reads the
  filled classes out of `App.jsx` and requires their ink to be `--on-accent`, since a
  class that could be wearing any of four colours cannot pick an ink for one. Elements
  with no text of their own — the swatches, the confetti — declare no `color` and are
  left alone; a *new* text-bearing one that declares none would inherit `--text` and
  slip through, which is the known hole.
- **The fill/ink check is deliberately blind to a rule that sets only one of them.**
  What an ink lands on then depends on the DOM, which no parse can know, so widening it
  would mean guessing. The defect was in controls that declare both together.
- **The board's stale dim is a fifth, and the only one where both colours are the same
  hex.** A segment is 8% of its own colour when off, so how readable a dimmed digit is
  depends on the gap between two shades of one team colour — nothing about `--panel` or
  `--on-accent` can see it, and a stale `22` rendering as `88` screenshots perfectly.
  Two-sided like the light derivation: the dim clears 3:1 and one step deeper does not,
  so the value is pinned as the deepest that stays readable rather than as a preference.
  A sixth assertion holds the *shape* — one `is-stale` rule setting `opacity`, because
  enumerating it per element is what left the win banner bright. Three mutations, each
  killed by its own: the old 0.45 fails the floor at 1.91, a shallower 0.85 fails only
  the lower bound, and going back to `.seg.on` plus `.form-table` fails the shape check
  and the named parse guard. **That guard is load-bearing** — absent, the dim parses as
  `NaN` and every bound fails saying nothing about why.

**That file also asks every contrast question of *both* colour schemes**, since `index.css`
declares each value as `light-dark(light, dark)` and a single-scheme check leaves the half
that exists for the harder case unmeasured. It reimplements the `oklch(from … min(l, 0.5)
c h)` derivation to do it — the one thing in that stylesheet that is not a literal, and the
thing the light scheme's whole legibility rests on. Checked against what Chrome paints,
which agrees to within one channel step. Its fourth assertion changed shape with the
schemes: where it used to require anything *filled* with a team colour from JSX to ink
itself `--on-accent`, it now refuses an inline paint at all, because an inline style beats
every stylesheet and so a painted team colour could never be re-derived for a light page.
**Three shapes had to be caught and two of them slipped through first** — `{ color: c }`
names its key with a colon, `{ color }` is ES6 shorthand with no colon (a regex for the
first passes the second silently), and `style={cond ? { … } : undefined}` does not begin
`style={{`. That third one was a *real* miss sitting in `App.jsx`, found the moment the
check could see it. Matching inner `{…}` pairs fails a fourth way: a value holding a
template literal makes the template's own braces the innermost pair, so the object's keys
are never read. Verified by mutation, each naming its file and its key.

**And a third thing: which of two pieces of text is the smaller one.** One assertion, that
`.casual-note` is no smaller than the `.target` above it — the play screen's `NOT RECORDED`
is the only thing saying a guest game won't be filed and it sat at 10px, the floor of the
scale and the size that column spends on the `PROJECTED` *label*. Nothing renders wrongly at
10px, so no browser check and no component test has anything to fail on. Written as the
relation rather than as `=== 12px` because the relation is the reason, and because the next
thing to touch this is a type-scale pass that would otherwise quietly undo it. Two
mutations, each naming its own fault: back to 10px fails on the comparison, and the
declaration removed fails on the named guard rather than on a bare `NaN`. **`.projection-cap`
is exempt and must stay 10px** — see **The header's centre column** in
`.claude/rules/layout.md` for what it costs every game.

That pass has since happened and the prediction held: the block now also pins the whole
**type scale** — every literal size the stylesheets set, in both spellings, against a list
naming what each step is for. The two assertions sit together deliberately, because one
holds a *relation* between two sizes and the other holds the *set* they may come from, and
neither implies the other: the scale would accept `.casual-note` at 10px, and the relation
would accept both of them at 19px. See **The type scale** in `.claude/rules/layout.md`.

`tools/verify-schemes.mjs` covers what none of that can: whether the light scheme *fires*,
and whether the browser understands the derivation. Both fail silently and in opposite
directions — the app renders perfectly with the light values simply never reached, and an
unsupported `oklch(from …)` makes the whole declaration invalid at parse time, so every
team name inherits `--text` on **both** schemes and the app quietly loses its second
channel while staying perfectly legible. It measures the play screen's mean luminance
(33.6/255 before this existed, 230.7 now), that the two team inks differ from each other
and from the body ink, and a bag against the band it is resting on, which is a gradient
stop against a derived colour and therefore exists only once a browser has resolved both.
- **It also holds the `WASH` tag on an expanded match**, which is the only *text* saying
  nobody scored a round and sat at 9px with `--muted` under `opacity: 0.7`: 2.99:1 on the
  light scheme, 3.67:1 on the dark. It is here rather than in `verify-stats.mjs` because
  the machinery and the two schemes are both here, and the light one is the worse of them.
  Nothing in a stylesheet can see it — the size and the opacity are in different rules and
  the colour is inherited from the cell above — and no other browser check reads a contrast.
  - **Composited rather than sampled, which is the opposite of the bag beside it.** A bag is
    20px of flat colour so a pixel from its middle *is* its colour; 11px text is antialiased
    to 1px stems, so the darkest pixel in a glyph is already part background and the figure
    comes out low by whatever the hinting decided — a check that fails on a font rather than
    on a colour. Both colours still come through `resolve`; only the multiply is local, and
    the alpha is the product up the ancestor chain, so an opacity moved to the row or the
    cell is still caught. Verified: putting the opacity back fails both schemes at exactly
    the figures above, and the alpha-1 case reproduces `--muted`'s own 5.53/6.29.
- **Never parse a computed colour in a browser check.** On the light scheme a derived ink
  serialises as `oklch(0.5 0.164089 256.69)`, and pulling three numbers out of that yields
  `[0.5, 0.164, 256.69]` as if they were channels — which is not a visible failure but a
  worse one: every contrast figure came out plausible, wrong, and green. Colours are
  resolved by painting them into a 1x1 canvas, which also gets the browser's own gamut
  mapping rather than a second implementation of it.
- **The board's opt-out is measured as contrast, not as luminance.** `Display.css` and
  `Panel.css` paint their own near-black as literals, so dropping the `color-scheme` pin in
  `main.jsx` barely moves the mean — a luminance bound passed with the pin deleted. What
  actually breaks is `--text` and `--muted` flipping to near-black *on* that near-black.
- **It is the only thing that can see `build.cssTarget`.** Lightning CSS rewrites
  `light-dark()` into a `prefers-color-scheme` switch at the default target, which still
  follows the phone — so the app looks right — and answers to `color-scheme` not at all.
  Found by this check and now held by it: removing the target fails exactly the two board
  assertions.
- **The bag is read a full second after the tap**, past the 280ms slide *and* the 620ms
  spark burst a hole bag sets off, whose dots land over the token's own centre. At 400ms it
  sampled a spark instead of the bag and the file failed about one run in three.

**Playwright defaults to `colorScheme: 'light'`, so every other browser check now exercises
the light scheme.** That is harmless for the geometry ones and it is why **a check may not
compare a colour against a literal hex**: two did, and both went red on rules that were
working perfectly. They read the variable through a probe element instead. The same lesson
bit once more in `verify-stats.mjs`, where the pip-tint assertion compared a computed
`rgb(…)` against the raw `--text` token — two strings that can never be equal, so the check
could not fail and passed with the team colour dropped entirely. That file's standing rule,
met again: **check what a mutation actually prints.**

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
on `singles leaves the far end empty`. **The header's big figure is a fourth of these,
with a trap of its own**: `verify-tabs`, `verify-recovery` and `verify-stats` all read
that score, and all three read it *after* a commit, where `current` is empty and the
committed and projected figures are the same number — so none of them could tell
`totals` from `totals + roundNets(current)`, which is how the projected value stood as
the biggest thing on the screen. That block reads mid-round with the trailing side four
in the hole, and restoring the projected value fails exactly one of its assertions.
The toss is covered there too, and only *properties* can be —
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
quietly agreeing with a stale fixture.

**That decision had a blind spot, and it was one coherent one.** Several guards in
`stats.js` and `archive.js` exist for records the *UI cannot produce* — one person on
both sides of the court, two teams resolving to one side key, a match with no winner —
and a fixture played through the app structurally cannot reach any of them, so every one
was carefully commented and none was asserted. Measured: the two per-match double-credit
guards, `sideRecord`'s same-side check and `summary`'s winner check all survived being
deleted outright, with 773 tests green. **The fixtures did not have to be hand-written to
fix it**: `newGame` accepts any lineup and the refusal lives above it in `lineupFaults`,
so `singles('Neil', 'neil ', …)` still plays its rounds through the real scoring functions
and only the *lineup* is built by hand. Only `summary`'s winnerless case needs the
hand-built `result()` helper, and that is the shape `tools/import-legacy.mjs` writes
anyway. **So a guard here is not untestable for being unreachable by play** — reach for an
unplayable lineup with real rounds before concluding it is.

**And "the UI cannot produce it" was wrong when it was written, which is the sharper
lesson.** Two of those four were reachable through the app at the time: the match-names
editor *warned* about one name on both teams and saved it anyway, and `renamePlayer`
swept every record with no such check, so merging two spellings of somebody who had faced
themselves filed exactly that record. All four write paths refuse it now — see
**Nobody plays themselves** in `.claude/rules/scoring.md` — so the guards protect records
filed *before* the rule rather than shapes nobody can make. **Before writing "unreachable"
over a guard, find the write paths and check each one**; a comment asserting it is not
evidence, and here two of them were the ones that had never been looked at.

`tools/verify-stats.mjs` covers what the
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

Its delete block covers a gap of a fourth shape: **where a control is**, which no unit
test has an opinion about. Deleting a match now asks from inside the open row, and nothing
in the components would notice the old row-level `×` coming back — so the block asserts the
*shut row's control count* rather than only that the new path works. Four mutations, each
killed by its own assertions: a second button on the row fails the count alone; deleting
without asking fails six; and the tie sentence dropped or said unconditionally each fail
one of the two directions in `verify-tournament.mjs`.
- **The no-confirm mutation ended the run before the block was hardened**, which is this
  file's standing lesson met again in a new way: that mutation deletes on the *first*
  press, so every locator after it is gone and `innerText()` on the absent dialog threw.
  The dialog is read through a count now and the row is reopened rather than assumed open,
  so the mutation names the fault and the eleven checks below it still run.

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

It also holds the two constants that cross the language boundary with **only a comment**
behind them — `REORDER_WINDOW` against `REORDER_WINDOW_MS`, and `PALETTE` against
`SPLASH_PALETTE`. Everything else shared with the firmware is pinned by construction (one
generator run for the glyphs, a source hash for the masks, the framebuffer for all of
`render.h`); these two sit outside all three, in `board_logic.h` and in the sketch itself.
Both comments had already gone stale in the same way, naming the wrong file for the value
they mirror — so the step checks the *value*, since the file reference is the part that
rots. Verified by mutation: a team colour changed on one side fails it and prints both.
**A new mirrored constant goes in `MIRRORED`**; there is no third place to look.

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

**The glyph step puts the tracked files back, and that is not tidiness — without it
the check repaired itself.** It regenerates *over* `glyphs.h` and `src/panelGlyphs.js`
and then diffs, so a stale tree used to go: run 1 FAILED, runs 2 and 3 PASSED, with both
tracked files silently rewritten and nothing having said so. CI never saw it — a fresh
checkout runs this once — so the whole cost fell on whoever ran it locally, and it turns
the standing "don't trust a single failed run, check it's consistent across runs" habit
into a green run plus two uncommitted rewrites. It restores from the snapshot it was
already holding, and the message now says to run the generator rather than to commit a
result it has just undone. **Anything else here that regenerates in place needs the same
restore.** The logo step doesn't: it can't regenerate without a browser, so it compares a
source hash instead.

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

**That file taught the same lessons repeatedly, and they are worth knowing before
adding to it:**

- **Reading text off an element that is *absent* costs 30s, and `check` pays it twice.**
  A fault hint renders only when something is at fault, so the ordinary case is no element
  at all — and `innerText()` waits out Playwright's default before the `.catch()` fallback
  runs. `check(label, cond, detail)` evaluates the condition and the detail separately, so
  one assertion on an absent hint was **60s of that file's 110s**, and it looked like an
  expensive check rather than a stalled one. `textOf` bounds it at 2s, which is 20x what a
  hint takes to render; the presence assertions immediately above use the same helper, so a
  bound too short to see a hint that *is* there fails those loudly rather than passing this
  one quietly. **A new read whose element may legitimately be missing goes through it** —
  the same rule `settles` already applies to waits.
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

`tools/verify-celebration.mjs` covers the win moment, and its subject is a fourth kind of
gap: not a role, not a number and not a value handed to the wrong component, but **what
ends up on top of what, and how many overlays fire at once**. Nothing in the unit suite can
see either half — the effect that decides which overlays fire is in `App.jsx`, and paint
order is invisible to the stylesheets as well as to the tests. See **The celebration paints
behind the result** and **The two big overlays are anchored to different boxes** in
`.claude/rules/layout.md` for the constraints and the numbers.
- **It drives three separate games, and `play()` is what makes that cheap.** A four bagger
  nets 12, so a **target of 12** makes one round a win, a skunk and a four bagger at once —
  where the two rounds to 21 this file used to play leave the *first* round's own
  four-bagger overlay still mounted under the timer patch, which reads as exactly the fault
  being checked. The other two are an ordinary mid-game four bagger and a
  double-four-bagger wash, the only round that says `FOUR BAGGERS!`.
- **The guard for the one-overlay pair is the mid-game four bagger.** With `setFourBagger`
  deleted outright both assertions still pass — the reveal is absent for the right reason
  and the wrong one alike — so the check has to show it is still there on a round that ends
  nothing. Five mutations: restoring the old side-by-side firing fails two, deleting the
  reveal fails **only** the guard, dropping the callout's line fails three, taking the
  outcome's own 72px fails only the width bound, and always using the singular fails only
  the plural. All five pass every unit test, and the CSS one passes all 64 of
  `css.test.js`.
- **It waits for *either* overlay after a commit, not for the expected one.** The lanes
  clearing is the reducer's render and every overlay comes from the effect after it, so
  reading straight off the commit finds nothing at all — but waiting for the one the block
  is about would make the wait the assertion.
- **It reads the stacking through `elementsFromPoint`, which returns topmost first**, over
  a 4px grid across the winning digits' *ink* box — derived from canvas font metrics rather
  than the element box, because `.score` is 56px of line box and the glyphs fill about two
  thirds of it. Hit-testing skips `pointer-events: none` and every piece has it, so the
  check lifts the property for the duration; paint order does not answer to it.
- **It scans every frame of the crossing rather than picking one, and that is not
  thoroughness — it is the only way the file is not flaky.** Each piece's delay, duration,
  drift and rotation are `Math.random()`, so which frame has a piece on the digits differs
  every run: measured, the crossing is roughly 400–800ms of a 1.7s fall and peaks at 6
  pieces. It pauses every animation and steps `currentTime` from 250 to 1000ms, which is
  also why the whole file costs **1.8s across three games** — it never waits on the clock.
- **The confetti's guard is the assertion that earns that pair.** A frame with no piece near the digits
  reports nothing painted over them however the stacking is set up, *including with the
  confetti deleted outright* — so the first check is that the pieces still fall across
  them. Four mutations: the header's `z-index` dropped and the component moved back inside
  `.callout` each fail only the paint-order assertion (all 226–255 samples), deleting the
  confetti fails only the guard, and the duplicate React key passes clean.
- **The celebration's own timers are patched out, not waited through.** It clears itself
  after 1600–2600ms depending on which overlay it is, and a frame that has unmounted cannot
  be measured, so every `setTimeout` of 1000ms or more is dropped before the round is
  committed.
- **It waits on `.confetti-piece`, not on `.winner-banner`, and catches the timeout.** The
  banner comes straight off the reducer and the callout off an effect, so the banner is a
  render early and finds nothing; and with the confetti gone, an uncaught wait ends the run
  in a 30s stack trace instead of letting the guard name the fault — the failure mode
  `verify-tournament.mjs`'s `open()` and `verify-stats.mjs`'s paging block both record.
- **Its `console.error` listener cannot see a React warning.** The checks run against the
  production build, which strips them, so the duplicate-key complaint that the markup split
  produced is loud in `npm run dev` and silent here. Don't read the listener as covering
  it — verified by mutation.

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
`.claude/rules/archive.md`.

**It is also where the display's form-table *layout* is asserted, and nothing in CI
covers that** — the reach that caught the 12em cap, the record never wrapping, the
rotation block, and now the rail under each lane. Not a choice: the table only exists
while a lineup is retained, so nothing hermetic can reach it, and the panel's version is
a canvas drawn by `panelRender.js` instead. **The score screen's middle column is there
for the same reason from the other side**: what it holds is that a board with nothing
retained is laid out the same as one holding a round and a target, which needs a live
message to compare against — see **The middle column reserves its box** in
`.claude/rules/scoreboard.md`. So a layout regression here is caught by
somebody running this file, not by a red deploy — **run it after touching
`Display.css`.** The rotation block is the one that most needs a real iPad rather than
this: Chrome cannot reproduce the Safari track-sizing bug it exists for, so it passes
here whatever happens. Everything either
side of that is covered without a broker: the
payload and the clear in `scoreboard.test.js`, the retain-and-re-assert behaviour
against a fake client in `scoreboardLink.test.js`, and the drawing itself by the
pixel check.
