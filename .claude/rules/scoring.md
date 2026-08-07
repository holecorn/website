---
paths:
  - "src/scoring.js"
  - "src/scoring.test.js"
  - "src/Board.jsx"
  - "src/Positions.jsx"
  - "src/Positions.css"
  - "src/Lineup.jsx"
  - "src/Lineup.css"
  - "src/GameStats.jsx"
  - "src/GameStats.css"
  - "tools/verify-positions.mjs"
---

# Scoring, the lineup and the court

Detail behind **Domain rules** in the root `CLAUDE.md`, which holds the rules themselves.

## Guest games (`casual`)

- **`casual` is a guest game, and it is one flag reaching one function.** The group
  plays on the seafront and invites passers-by in, so the problem it solves is not
  typing — names were already optional, every slot comes pre-named and `Start` works
  untouched — it is that a won game with those defaults *is* archived, folding every
  stranger into one bogus career whose PPR and form drag the chips around. So the feature is **don't record it**, and everything else falls out
  of `playerLabel`.
  - **`playerLabel` is the whole implementation.** In casual it returns the team's
    `PALETTE` colour name, so the phone header, the lanes, the court diagram, the
    in-game stats, the winner banner, `?display=1` and the LED panel all say "Blue"
    from one place — **the board and the display needed no change at all**, because
    they only ever receive labels. No payload field, no new topic, no firmware
    change. Anything new that names a player must read it from here or it will be
    the one surface still showing `Player 1`.
  - **`players` is deliberately left holding what was typed.** That is what makes
    the toggle reversible instead of destructive; rewriting the array would lose the
    real lineup the moment a guest wandered over.
  - **Two teams can never share a colour** — the swatches disable the other team's —
    which is what makes a colour name an unambiguous label. A value off the palette
    can only come from a hand-edited save, and falls back to `Team A`/`Team B`.
  - **`teamLabel` gives a casual doubles pair one label, not `Blue & Blue`**, so
    `winVerb` reads it as singular and announces "Blue wins". That is right for a
    team name and is the known cost of keying the verb off `TEAM_JOIN`; it is
    asserted rather than left to be discovered.
  - **`gameStats` folds to one row per team in casual.** "Within one game the slot is
    the identity" doesn't hold when both partners are the same colour word — two rows
    reading "Blue" are worse than one. Note the fold changes too: every round the
    team threw lands in its one row, where the slot-filtered version would give each
    half of them.
  - **`lineupPayload` needs its own explicit casual guard**, and the `played` test is
    not enough: the slots still hold the last names typed, and those genuinely have
    history, so the board would show a stranger somebody else's form line. The setup
    screen's `Lineup` panel is hidden for the same reason.
  - **The name fields go but the swatches stay**, because the colour has become the
    identity — so `TeamsFields` swaps each input for the colour as text and drops the
    board chip (with both partners labelled alike, reordering a pair changes nothing
    observable). The first-thrower bag stays: naming who opens is still useful.
  - **It is sticky across `New game`, like `mode`**, because guests arrive in runs.
    That is only safe because every `New game` lands back on setup with the toggle in
    view — a run of casual games cannot quietly outlast the guests. The reducer case
    is gated on `gameStarted` for the same reason the arrangement controls are:
    flipping it after a win would strand a record the archive effect can no longer
    see to remove.
  - **The play screen says `not recorded`**, and it has to: a game you meant to
    record and didn't has no other symptom. Measured, it costs no layout — the
    header stays 94px and the lanes 61px, because `.center-readout` is shorter than
    the team score blocks either side of it.
  - **The toggle shares `.setup-top` with the mode and `Start`, and that row is the
    tightest space on the screen.** It started as its own row below and cost 58px of
    height for a control that is off almost always. Three things bought the space and
    all three are load-bearing: the button says **`Start`** rather than `Start game`
    (44px), the mode labels carry **10px** of side padding rather than 22px (48px),
    and the row's gap is 8px (4px). Measured, the row needs 302px against the 328px a
    360px Android has and the 343px a 375px SE has. **`Start game` with 22px padding
    overruns the SE by 59px.** At 320px (iPhone 5/SE1) the mode labels clip — they
    did before this change too, at 326px needed against 288px, so that width has
    never fitted and is not a regression.
    - **Every one of those figures is `system-ui` on a Mac, and that is not what the
      deploy runner draws.** Measured under `act`: the same row needs **22px more** on
      Ubuntu's `system-ui` than on SF Pro, which put it 12px over at 360px and left it
      at *exactly* 0px slack on the SE — a red deploy on a layout that looked fine on
      every device to hand. So the row now carries 26px of headroom on a Mac rather
      than 10px, bought from `.start-game`'s side padding (20→16px) and the Guests
      chip's (16→12px). On the runner's own font that is **328px of 328px — it fits
      with nothing spare**, and the 4px of headroom the change was predicted to leave
      there never materialised, because `.start-game` was already being shrunk by the
      flex line so 4px of the 16px was money the row had spent anyway. Fine on any
      real device (302px on SF Pro, and Roboto is narrower still than the runner's
      face), but **the CI figure has no margin**, so the next thing that widens this
      row fails the deploy rather than eating slack.
      **Those two paddings are where any future squeeze comes from**, not the
      mode labels: 10px is the number this row was already cut to once, and it is the
      one the segmented control can least afford. `system-ui` is SF Pro on iOS and
      Roboto on stock Android, so the headroom is not for the runner's sake — it is
      for an OEM skin or a bumped system font size, where the labels would otherwise
      clip on a real phone.
    - **`verify-stats.mjs` asserts the row is one line *and* that nothing in it is
      squeezed**, because one line alone is worthless here: `.start-game` may shrink
      and `.mode-toggle` clips its labels rather than overflowing the document, so
      restoring the 22px padding leaves the row on one line with 0px slack and passes
      both a wrap check and an overflow check. Verified by mutation — it fails only
      the squeeze assertion. Same lesson as `verify-lanes.mjs`. Its failure detail
      reports **needed against available**, because the drawn widths cannot say it:
      once a control is clipping, its box *is* the squeezed size and the slack reads
      0px however far over the row is.
    - **The hint is drawn only while it is on**, so the ordinary case spends nothing;
      it is the one thing the collapsed fields below can't say for themselves.
    - **A third segment inside `.mode-toggle` is still wrong**, even though it would
      be free: guests are orthogonal to singles/doubles and a segmented group reads
      as exclusive. Sitting *beside* the group with the same lit styling is what makes
      that clear — Singles stays lit when Guests comes on, which demonstrates the two
      are independent rather than merely asserting it.
  - **The panel layout is deliberately *not* forced to `score`.** In casual `full`'s
    name row is "BLUE"/"RED" in blue and red, pure redundancy with the digit colours
    — but a layout is a preference the scorer keeps, which is the same rule that
    keeps the form screen out of `PANEL_LAYOUTS`, and driving it from game state
    would mutate persistent config. The Panel button is already in that row.
  - **Per-slot anonymity was considered and rejected.** A mixed game (one of us and a
    guest) is the likely case, and the flag discards both halves — but partial
    records mean `playerStats`, `sideRecord` and `headToHead` all folding over holes.
    The existing route for a mixed game is to play it normally and delete the match
    afterwards.

## A lane is a radio group, and the bag is the option that is checked

- **The three tier zones are native `<input type="radio">`, one group per bag, and that
  is the whole of what makes a round scoreable without seeing the screen.** Measured
  before it, on a doubles game with one bag in the hole and one on the board: **24
  buttons, every one of them named `bag hole` / `bag board` / `bag floor`** — no team,
  no bag number, no lane boundary — and the bag itself a bare `<div>` with no text,
  which Chrome drops from the tree entirely. Four bags in three different states
  announced as twelve identical buttons, so you could not check what you had entered and
  therefore could not find a mistap.
  - **Native radios rather than buttons with `role="radio"`**, which was the obvious
    route and is more machinery for less: the browser then owns the roving tabindex and
    the arrow keys, so the board is **8 tab stops instead of 24** with no keydown handler
    and no tabIndex to compute, and where the bag is resting *is* the `checked` state
    rather than an `aria-checked` the lane would have to mirror and keep in step.
  - **Three options and never a fourth.** `unthrown` is not a place a bag can be put
    back to (`setBag` refuses it), so it is the absence of a checked option — which is
    also what an unthrown bag reads as, correctly. A fourth zone would be the one place
    the lanes broke a rule the rest of the app keeps.
  - **The group is labelled `${name}, bag ${i + 1}` and the zones just `hole`/`board`/
    `floor`**, so arrowing through a lane doesn't re-read the player every time. `name`
    is the *thrower who is up* (`laneName` in `App.jsx`, via `playerLabel`), not the
    team — in doubles it changes hands every round, and `verify-a11y.mjs` reads it off
    `.lanes-team` rather than writing it down so the two cannot drift.
  - **The radios' `name` attribute is what the grouping is**, and dropping it leaves
    every role and label reading correctly while the count goes back to 24. That is why
    the tab-stop number is asserted at all.
  - **`.tier-zone` needs `appearance: none` and `margin: 0`** before an input will fill
    its third of the lane, and the focus ring is declared rather than left to the UA:
    the zones touch, so an outset ring on the middle one is drawn over its neighbours
    and reads as the wrong band being focused.

## `roundReport` is the only thing that says a round happened

- **`End round` changes the score, clears eight bags and can finish the game, and before
  `roundReport` it did all of that silently.** Measured across the play screen: the one
  live region reachable there was the footer's save warning, which is empty unless the
  phone cannot write — so nothing was announced on a fresh board, after eight bags, at a
  four bagger, at WASH/GAME/SKUNK, or after a win. The `.callout` and `.four-bagger`
  overlays are `aria-hidden` and the winner banner is inserted with no live region, which
  is right: they are the *seen* half, and this is the spoken one.
  - **Derived from `rounds`, never remembered from the press**, the same reasoning as
    `.toss-result`. So undo walks the sentence back to the round now standing, and a game
    adopted from another tab describes itself rather than the round this tab last saw —
    neither of which a stored "last announcement" would get right.
  - **In `scoring.js` rather than `App.jsx` because that is what makes it testable.**
    `vitest.config.js` is `environment: 'node'` and no test imports a `.jsx`, so a
    sentence built in the component could only ever be checked in a browser. Pure, so
    `scoring.test.js` pins it string by string; the browser check only has to prove it is
    wired to a live region.
  - **The four bagger is called but not attributed**, which is exact rather than sloppy:
    four in the hole is 12 raw and only another four bagger can match it, so one belongs
    to the side the previous sentence just named and two can only be the wash it named.
  - **The region is always mounted, and empty until there is something to say.** One
    inserted along with its content is announced unreliably — mount it on the first
    commit and round one is the round nobody hears. `verify-a11y.mjs` locates it with
    `getByRole` for the same reason it exists at all: a selector would still find a
    region an `aria-hidden` ancestor had taken out of the tree.

## `roundLine` is how a history row tells the two teams apart

- **The round history failed both channels at once.** Measured from the accessibility
  tree it read `R1 2◎ 2▬ → +0 2◎ 2▬ → +0` — one list item, nobody named in it, and the
  glyphs reaching a screen reader as Unicode names or as nothing. And on a wash the two
  halves are byte-identical, so the only thing telling them apart was hue: red against
  green is CIEDE2000 **4.4** under deuteranopia, which is not a near miss but the same
  colour, and the default blue against red is **1.11:1** in greyscale.
  - **`roundLine` names the team rather than leaning on the column heading.** A heading
    is only reliably announced when someone navigates cell by cell, and a row is read
    straight through far more often than that — which is exactly the reading where two
    identical cells stay ambiguous. So the heading is `aria-hidden` and purely the seen
    half; without that it would be said again against every cell that has already
    named itself.
  - **It leaves out a tier nothing landed on**, because every row has at least one zero
    and a zero read aloud is a word spent saying nothing happened. `nothing on` covers
    the side that put no bags up at all.
  - **The counts and the net are separate clauses on purpose.** Cancellation means a
    side can out-throw the other and still score nothing, which is the row somebody is
    most likely to be checking.
  - **A `<table>`, not the `<ol>` it was.** The heading has to line up with the cells
    under it, and two elements sharing a hand-written `grid-template-columns` is the
    drift that avoids. The heading is `position: sticky` because the wide tier scrolls
    a long game in the rail, and a heading that scrolls away takes the only non-colour
    channel with it.

## Nobody plays themselves, and nobody plays nameless

- **Nobody can play themselves and nobody plays nameless, and `lineupFaults` is the
  whole rule.** It returns one entry per slot at fault, `twice` or `blank`, and
  `Start` is disabled while it returns anything.
  - **`twice`:** a name is the only identity the app has, so one name in two slots is
    one person on both sides of the court — `playerStats` folds a win and a loss for
    the same match into one career, `sideRecord` reports no matchup at all, and in
    doubles somebody is their own partner.
  - **`blank`:** a nameless slot is not a person either, so `participants` drops it
    and `playerStats` credits its throws to nobody. **That is worse than either
    alternative**: the rounds are archived, the numbers go nowhere, and nothing on
    any screen says so. The setup screen was the last door left open on this — the
    match-names editor already disables Save on a blank, `RenamePlayer` needs a
    non-empty name, and the `renamePlayer` reducer bails on one.
    - **Refused rather than defaulted.** Restoring `Player 1` on blur was the
      alternative and it silently files a stranger under a name nobody chose, which
      is the guest-game bug in miniature. Being told costs a keystroke.
  - **Faults are per slot, not per name**, because the button and the fields need
    different halves of the same answer: the hint says which name is doubled, the
    fields say which boxes. A blank has no name to report, and doesn't need one —
    an empty box is visible. That is also why `TeamsFields` no longer matches on
    `nameKey` to decide what to mark.
  - **Both faults are reported together**, one sentence each. A lineup with an empty
    box *and* a repeat is one fix, not two rounds of being told off.
  - **It refuses a repeat where the archive's editor warns about one**, which is not
    an inconsistency: a lineup is about to be played and costs a keystroke to fix,
    whereas a record is history and the ones needing the edit most are exactly the
    clashing ones. Blanks are refused in both places. The two notes point at each
    other; don't unify them.
  - **`newGame`'s defaults are numbered across the lineup, not within each team.**
    `a: [1, 3]`, `b: [2, 4]`, so the app cannot open on a lineup it would refuse to
    start — and singles, the common case, still reads Player 1 against Player 2. Any
    new default name has to keep all four distinct.
  - **`loadGame` renames the slots that still hold an old default**, per slot, so a
    save from when both teams defaulted to `Player 1`/`Player 2` doesn't greet
    somebody with a blocked `Start` over names they never typed. Anything typed is
    left alone, and the rewrite is keyed off the *old* default for that slot rather
    than off the clash, so it can't touch a real name.
  - **Only the slots the mode plays**, so the default partner is neither a repeat nor
    a missing name in singles — and a guest game has no faults at all, since every
    slot is the team's colour and `players` still holds the last real lineup. That
    casual guard is the one a mutation proves: without it the toggle can't rescue a
    repeated lineup.
  - **The hint carries the reason and the fields carry the location.** The
    `.setup-top` row has no room for a longer button label (see the `Start` bullet
    under casual), so the button is `aria-describedby` the hint, and the offending
    inputs take `aria-invalid` and a red underline — four boxes and one sentence
    otherwise leaves you counting. The name keeps its team colour; only the underline
    changes, which is also all an empty field has to be marked by.

## Where people stand

- **Where people stand is derived, not stored** — one field anchors it and the
  rest falls out of `rounds.length`, so it reverts with `undoRound` for free, the
  same as the first thrower. `courtPositions()` owns it:
  - `rounds.length % 2` is **which end throws**, not merely which partner is up.
    In doubles the player slot index *is* the end that partner stands at all
    game, which is why slot 0 throws on even rounds. `activeIdx` in `App.jsx`
    reads `throwingEnd` rather than re-deriving the parity, so the lanes and the
    diagram cannot disagree about who is up.
  - **Doubles swaps pitcher's boxes, singles swaps ends.** The two opponents at a
    board trade boxes each time they throw, and they only throw on alternate
    rounds, so the sides flip every *second* round — the arrangement is a 4-cycle
    on `rounds.length`. In singles nobody changes box at all: both players walk
    down their own side of the court, so only the end moves. Don't "unify" these;
    they are different rules and `scoring.test.js` pins both. **Both are how this
    group plays**, not a rulebook citation — the singles one in particular was a
    choice between two readings of "swap sides" (keep your side of the court, or
    keep the side relative to your target) and this is the first.
  - **A waiting end is drawn where it will throw from next round**, not where
    this round's swap puts it. Using the current round for both ends makes the
    far row flip on odd rounds without those players ever moving, which reads as
    a bug. One test covers exactly this and nothing else does.
  - **The setup screen draws one board in singles and the play screen draws
    two**, and the divergence is the point rather than an oversight. Which end a
    singles pair starts at is not part of the arrangement — nobody changes box, so
    the far row is empty and the throw arrow points at a board that swaps every
    round anyway. What is left to set is which side of the board each player takes,
    and that is one row. In play the lit end alternating *is* the information, so
    both stay. Measured, dropping it takes the panel from 197px to 122px and the
    singles setup screen from 943px to 868px against an 852px iPhone — 91px of
    scroll to 16px, and 154px to 79px on an SE. Doubles is untouched at 197px.
    - **The gate is a `setup` prop, not `gameStarted`.** That is false until the
      first bag, so deriving it from state would open the play screen on one board
      and grow a second row mid-round. It is also not `onSwapSides` being present:
      that handler means "you may adjust", and the two facts only happen to
      coincide today.
    - **`spoken()` drops the end names with the drawing**, or the prose describes
      a court that isn't there. The walk sentence goes too — `.positions-hint`
      already says it in visible text.
  - **`startSide` is the only *new* state, not the only state that holds a
    position.** Which side of the court team A takes can't be derived from
    anything, so it is stored; it survives `New game` like the colours do, and an
    old save without it falls back to `left` through the `loadGame()` merge. The
    other half of the arrangement — which partner is at which end — is the
    **order of the `players` array**, which already existed and now carries
    positional meaning. That is why `swapEnds` reorders slots rather than setting
    a field, and why **swapping ends also changes who throws first**: slot 0
    throws even rounds, so the two are the same fact and cannot be set
    independently.
  - **The arrangement is adjusted on the name fields, and the court only reports
    it.** The fields were already a positional list — the inputs' `aria-label` has
    always said "player at the start board" / "at the far board" — so each row grew
    a bag (`throwFirst`) and a board chip (`swapEnds`), and `Positions` kept only
    the mirror. Controls in the drawing were built first and removed: the boxes are
    26–151px of cramped space, and it cost 22px of name track and a parallel set of
    hidden buttons. **Don't move them back.**
    - **`throwFirst` is two facts, not one.** Naming the opening thrower sets
      `nextFirst` *and*, if that player is the far partner, swaps their pair —
      because slot 0 throws even rounds, per the bullet above. So it is `setFirst`
      composed with `swapEnds`, not a third piece of state. The chip is the other
      half: it reorders a pair *without* changing which team leads, which the bag
      cannot express.
    - **It is only meaningful on setup, where `rounds.length` is 0**, which is what
      makes the throwing end 0 and a slot index mean "the board they stand at".
    - **The chip states the board rather than pointing.** An up/down arrow was the
      obvious control and is wrong: the form lists slot 0 **first** and the court
      draws it **last** (far row on top), so a direction is correct in one place and
      inverted in the other. The visible text is where they stand, and the
      `aria-label` has to contain that text as well as saying what pressing does
      (WCAG Label in Name), hence "Rho at the far board, press to move to the start
      board".
    - **The bag needs the setup gate as much as the chip does**, because a slot-1
      bag is `swapEnds` + `setFirst`, not just `setFirst`.
    - **`Toss for first` is a coin flip on `nextFirst` and nothing else**, because
      the candidates are the two players at the *start* board — in singles the only
      players, in doubles because the slot index *is* the end. Both are slot 0, so
      the toss reuses the existing `throwFirst` action at slot 0: no new state, no
      new function in `scoring.js`, and structurally it cannot reorder a pair. **A
      toss that reached slot 1 would compose `swapEnds`** and silently re-credit
      every committed doubles round, which is why `verify-positions.mjs` asserts the
      four names are unchanged across 30 presses as well as which box lights.
      - **The draw is made in `App.jsx`**, so `scoring.js` stays pure — the same
        rule that has `drawSplash` handed its two colours rather than picking them.
        `Math.random` rather than `getRandomValues`: a coin flip needs no entropy
        guarantee, and `Confetti` already uses it.
      - **The result is withheld for `TOSS_MS` and the draw made on the way back**,
        because **half of all presses land where the bag already was** — a two-way
        toss repeats half the time, and a marker that doesn't move reads as a dead
        button. The pause is what says the coin was thrown, so the press changes
        something whatever the outcome.
        - **Presentational, and one dispatch at the end.** Animating by flipping
          `nextFirst` would be far less code — every surface already renders off it,
          so the bags and the court would move for free — and it is wrong: `first` is
          in the score payload on a **retained** topic behind a 400ms debounce, so a
          600ms flicker publishes a value that was never the result and a board
          rebooting recovers it. Same objection as a retained `fourBagger`.
        - **Faded, not emptied.** `.toss-row` is centre-justified, so removing the
          text slides the button sideways and back on every toss — measured, 44px at
          393px wide. Holding the box costs one shift at the reveal when the two
          names differ in length, which coincides with the answer landing.
        - **Pressing again restarts it rather than stacking timers**, so a mashed
          button settles 500ms after the last press instead of sticking hidden.
        - **The pending toss is cleared on unmount.** The reducer's `throwFirst` is
          gated structurally rather than on `gameStarted`, so a toss still in flight
          when `Start` is pressed would hand the opening throw to the other team.
        - Under `prefers-reduced-motion` the crossfade goes and **the pause stays** —
          withholding the result is a delay, not motion.
      - **The line itself is derived from `nextFirst`, never remembered from the
        press**, so it cannot go stale across `New game` (which resets `nextFirst`
        to `a`) or a rename. The known cost is that renaming the leading player
        retypes it into an `aria-live` region; the region is always in the DOM,
        because one inserted along with its content is announced unreliably.
      - **It is kept in a guest game**, where it reads "Blue throws first" through
        `playerLabel` — somebody still opens, and with strangers playing a toss is
        more use rather than less.
      - **Its own row under the team cards, and the two alternatives are both
        wrong.** `.setup-top` has no width left (see the `Start` bullet under
        casual), and the court reports the arrangement rather than setting it.
        Measured, the row costs **54px** (34px plus the screen's 20px gap) and
        `Start`'s fold clearance is untouched at 682px on a 393x852 iPhone, because
        it precedes the row in the DOM. The row needs 227px of the 328px a 360px
        Android has with an ordinary name, and 300px with a 16-character one — so on
        the deploy runner's wider font the worst case ellipsises the name rather
        than wrapping, which is why `.toss-result` carries `nowrap` and
        `min-width: 0`. At 320px it already ellipsises.
    - **The browser check is what makes any of this safe**, not the unit tests.
      Verified by mutation: pointing a bag at `1 - i` (the partner of the row it sits
      on), and turning the play screen's team name back into a button, both pass all
      220 unit tests and fail only `verify-positions.mjs`. Same blindness `activeIdx`
      has.
  - **The pitch boxes are `aria-hidden`, not the whole court, and the arrangement is
    spoken in prose instead.** Everything the drawing says — who is up, which box,
    which board they're aiming at, who throws first — is position, colour, border
    style and a pseudo-element bag, none of which survives being read aloud, and
    four names read in DOM order are worse than nothing. So `spoken()` builds a
    sentence and the boxes are hidden. `verify-positions.mjs` asserts the sentence
    names the same pair the lit boxes do, so it can't drift into describing a court
    nobody is looking at.
    - **Hiding the boxes rather than `.court` is what lets the mirror be a real
      button.** A focusable button inside an `aria-hidden` subtree has no accessible
      name, which is why the earlier in-court controls needed `tabIndex={-1}` plus a
      parallel set of focus-revealed buttons. Moving `aria-hidden` down one level
      deleted all of that. `.cornhole-board` needs none of its own — it is empty but
      for the control.
    - **The first-thrower marker is a bag on all three surfaces** — `::before` on
      `.pitch-box.is-first`, `.first-bag` on the play header, `.first-bag` on the
      fields — so the shape means one thing wherever it appears. It was a `●` in the
      court until the fields grew one.
  - **Positions are deliberately absent from the scoreboard payload.** A public
    board shows the score; the byte budget is tight and the firmware pins the
    contract. `scoreboard.test.js`'s `toEqual` is what keeps it out.

## The play screen is locked, and the arrangement is setup-only

- **The play screen deals only with scoring. Nothing about who the teams are can
  be changed once a game is under way** — not names, not colours, not who throws
  first. There used to be a team-edit dialog behind the header names and a
  first-thrower toggle on each bag, and both are gone: names and slot order are
  what `throwerFor` and the career stats attribute rounds by, and a mid-game colour
  change republishes to the board. So the header's bag is an **indicator** (it still
  has to be there — after round one it follows whoever scored last) and the name is
  text. `verify-positions.mjs` asserts this as an *absence*, including a list of
  every button the screen may show, because nothing in the components would notice
  a control coming back.
  - **The cost this used to carry is now paid on the stats screen instead.** A typo
    noticed after `Start game` was permanent — `New game` clears the game rather
    than returning to setup with it, so recovery was deleting the match. It is now
    corrected afterwards; see **Editing names** in `.claude/rules/archive.md`. That is the whole reason the
    play screen can stay locked, so don't reopen it here.
  - **`setFirst` survives with no caller of its own.** `throwFirst` composes it, and
    it is the natural way for a test to say "B opens", so the rule stayed in
    `scoring.js` when its reducer case went.
- **The arrangement is only adjustable from setup**, and structurally so:
  `TeamsFields` draws the bag and the board chip only when handed
  `onSetFirst`/`onSwapEnds`, and `Positions` draws the mirror only when handed
  `onSwapSides`. With the edit dialog gone `TeamsFields` has a single call site, so
  the gate now guards against a *second* one being added — which is worth keeping,
  because that is the failure where every doubles stat is silently re-credited and
  nothing fails. Note that a *boolean* prop would be a runtime guard rather than a
  structural one: the absent handler is the gate.

## A save the app cannot play

- **`validGame` is a refusal, not a repair, and that is the whole design.** `loadGame`
  merges a save over `newGame()` and then asks whether the result is playable; if it is
  not, you get a fresh game. Measured across 43 shapes a `holecorn.game.v3` value can
  hold, **18 blanked the app and not one of them recovered** — the crash is during
  render, so the persist effect never runs, the bad value is never rewritten, and there
  is no screen left to clear it from. On a phone that is an uninstall, and the career
  archive goes with it.
  - **Asked *after* the merge and the migrations**, which is what preserves the
    merge-on-load tolerance: a save that predates a field already holds the default by
    the time this sees it, so absent is never the question. Only a field that is
    *present and the wrong shape* — which the merge copies straight over the default —
    can fail. Asked before the merge instead, every save older than today's shape is
    thrown away; that is a mutation, and `verify-recovery.mjs` kills it.
  - **The whole game, not the field.** Repairing per field is more machinery and can
    assemble states that never existed — `rounds` repaired to `[]` beside a `winner` of
    `a` is a game won from nothing. Corruption also arrives wholesale in practice (a
    half-written value, another version's shape), so one bad field is not evidence that
    the rest is sound. The `catch` above already answered "start fresh"; this just asks
    it of a save that parses and won't run.
  - **The id is deliberately not required**, unlike `validRecord`'s: `identified()` adds
    it *after* this runs, so demanding one refuses every save made before matches had
    ids. `identified` now takes a non-string id as no id — an object one reaches the
    archive, where `validRecord` rejects the record on the way out to a file and
    `upsertMatch` can't find it, so the match exists locally and cannot be exported.
  - **A target above `MAX_TARGET` is accepted.** The two-digit cap arrived after the app
    shipped, so a save can legitimately hold one and refusing it deletes a real game.
    Clamping is the input's job, not the loader's.
  - **`nameSlots` moved here from `archive.js`** for the reason `nameKey` is here: a live
    game and an archived record are the same lineup shape, and two definitions of what a
    name slot is would let `validGame` accept what `validRecord` rejects.
  - **Rejecting more is not safer**, which is why `verify-recovery.mjs` checks both
    directions. A validator that refuses a playable save silently deletes a game in
    progress — and that is the tempting way to make a future failure go green.
