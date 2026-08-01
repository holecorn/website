# CLAUDE.md

Guidance for working in this repo. See `README.md` for the user-facing feature
description; this file covers conventions, gotchas, and how things fit together.

## What this is

Holecorn — a mobile-first PWA for scoring Cornhole (singles and doubles). Pure
client-side React 19 + Vite, no backend. Deployed to GitHub Pages at
`holecorn.com`.

## Commands

```bash
npm run dev      # dev server (http://localhost:5173/)
npm run build    # production build to dist/
npm run preview  # serve the production build (PWA/offline needs HTTPS or localhost)
npm run lint     # oxlint
npm test         # vitest run
npm run test:watch
npm run test:browser  # Playwright checks against a preview build (CI runs these)
npm run test:firmware # host C++ suites + the glyph and panelRender.js drift checks
```

`test:browser` needs `npm install --no-save playwright` first — it is not a
project dependency. It starts and stops its own preview server.

## Layout

- `src/scoring.js` — **the heart of the app**: pure, framework-free scoring
  functions. All game rules live here; keep them pure and well tested.
- `src/scoring.test.js` — Vitest suite for the above. Add/extend tests for any
  rule change (see Testing).
- `src/App.jsx` — app shell, reducer, screen (setup/play/stats) and celebration
  state, localStorage persistence.
- `src/archive.js` — finished matches. Pure record/upsert/remove/rename helpers
  plus the localStorage wrapper, split the same way as `scoreboard.js`.
- `src/stats.js` — career stats over archived matches. Pure, like `scoring.js`;
  tested in `src/stats.test.js`.
- `src/Stats.jsx` / `src/Stats.css` — the career stats screen.
- `src/tournament.js` — the knockout bracket. Pure like `scoring.js`, plus the
  localStorage wrapper the way `archive.js` splits it. **Stores the draw and derives
  the rest** — see **Tournaments**. Tested in `src/tournament.test.js`.
- `src/Tournament.jsx` / `src/Tournament.css` — the tournament screen: takes the
  draw, draws the bracket, hands a tie to the scoring screen. Draws only.
- `src/Modal.jsx` — a dialog that opens by being mounted, shared by the stats and
  tournament screens. Styled by `.modal` in `App.css`, deliberately not redeclared.
- `src/nameField.js` — `NAME_FIELD`, the props every person-name field needs to stop
  the browser's own contact autofill fighting the archive's suggestions.
- `src/Lineup.jsx` / `src/Lineup.css` — the setup screen's pre-game form panel.
  Draws only; `lineupStats()` and `sideRecord()` in `stats.js` derive it.
- `src/GameStats.jsx` / `src/GameStats.css` — the in-game stats panel. Draws only;
  `gameStats()` in `stats.js` derives it.
- `src/Board.jsx` — the per-bag scoring lanes and the hole/four-bagger effects.
- `src/Positions.jsx` / `src/Positions.css` — the court diagram (who stands in
  which pitcher's box this round). `courtPositions()` in `scoring.js` works out the
  arrangement; the only thing this file mutates is which side of the court each
  team takes, and the rest is set on the name fields in `App.jsx`.
- `src/Logo.jsx` — the chalk HOLE/CORN wordmark (tints to the two team colours).
- `src/scoreboard.js` — pure payload/topic/settings helpers for the external
  scoreboard, plus its localStorage read/write. Tested in `src/scoreboard.test.js`.
- `src/scoreboardLink.js` — the MQTT transport. No React; dynamically imports
  `mqtt` so the client is a separate chunk.
- `src/useScoreboard.js` — the React glue (`useScoreboardPublisher` for the
  scoring phone, `useScoreboardDisplay` for the board).
- `src/Display.jsx` / `src/Display.css` — the `?display=1` view, routed in
  `src/main.jsx`. `src/ScoreboardSettings.jsx` is its settings UI on the setup
  screen.
- `src/panelRender.js` — the HUB75 panel's framebuffer and its layouts, a port
  of the firmware's `render.h`. Pure and framework-free; its `renderBoard` is held
  **pixel-identical** to the C++ by `npm run test:firmware`, and the parse-side
  coercions around it by `src/panelRender.test.js`. `src/panelGlyphs.js` and
  `src/panelLogo.js` are generated.
- `src/panelPaint.js` — turns that framebuffer into LEDs on a canvas. No React,
  so a browser check can drive it directly.
- `src/Panel.jsx` / `src/Panel.css` — the `?panel=1` emulator view: the same MQTT
  subscription the display uses, drawn through the two files above.
- `src/segments.js` — seven-segment digit geometry. The mitre rule that stops
  segments overlapping is documented there and locked in by
  `src/segments.test.js`; read the comment before nudging any coordinate.

## Domain rules (easy to get wrong)

- **Cancellation scoring, 4 bags per side per round.** Each round only the
  difference between the two teams' raw points scores; the trailing team nets
  nothing. Hole = 3, board = 1, floor = 0.
- **Doubles does NOT change scoring.** It only adds a second player name per team
  and alternates which partner is "up" each round (`rounds.length % 2`). Colour
  stays per team. This group plays each end as its own 4-bag round — **do not add
  an 8-bags-per-round doubles mode.**
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
- **Bag positions:** `'unthrown' | 'floor' | 'board' | 'hole'`. Bags start
  `unthrown`; once thrown they can move between floor/board/hole but can never
  return to `unthrown` (`setBag` enforces this).
- **First thrower:** the team that scored last round throws first next; unchanged
  on a wash (tie). Derived through `endRound`/`undoRound`, not free-floating.
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
- **Vibration/celebration** (in `Board.jsx`): in-hole bags jitter only while
  *every* thrown bag is in the hole (a four-bagger is alive), from two in the
  hole, ramping at three. The FOUR BAGGER reveal fires at round commit, not on
  the fourth tap. WASH/GAME/SKUNK callouts fire from the round-commit effect in
  `App.jsx`.

## Conventions & gotchas

- **State persistence:** game state is saved to `localStorage` under
  `STORAGE_KEY` in `App.jsx`. `loadGame()` merges the parsed state over
  `newGame()` defaults so games saved before a field existed still load (and
  migrates the old single-name shape to player slots). Prefer this
  merge-on-load approach over bumping the key.
- **Nothing in the scoring lanes stretches, and three caps enforce it.** The bag
  token is square (`aspect-ratio`, sized off the tier band's height, since that's
  the tight dimension), a lane track caps at 72px, and `.main` caps at 408px —
  which is exactly what the lanes need, so the header and buttons can't grow past
  the cards they sit above. **The landscape tier has to lift the `.main` cap**:
  there the two team cards sit side by side, and 408px between them collapses the
  lanes to about 28px. The token is centred with auto margins rather than a
  `translateX`, because the vibrate animation owns `transform`.
- **`tools/verify-lanes.mjs` is what holds all of those numbers**, because none of
  them is reachable from a unit test. The one worth understanding: it asserts the
  lane *reaches* 72px where there's room, not merely that nothing overflows. The
  408px cap spends its remainder on the `auto` tier-label column, so widening
  those labels or changing their font takes it out of the lanes and breaks nothing
  visible — measured, `hole · 3 points` instead of `hole · 3` silently costs 9px
  per lane. Overflow checks pass throughout; only the reaches-the-cap assertion
  fails.
- **The wide tier and the landscape tier must not both match**, which is what the
  wide tier's `min-height: 451px` is for — the exact complement of the landscape
  tier's `max-height: 450px`. A big phone on its side (932x430 on an iPhone Pro
  Max) satisfies `min-width: 900px` *and* `max-height: 450px`, so before the guard
  both applied: the landscape tier put the two cards in a row and the wide tier,
  being later in source order, capped the column they shared. That is the lane
  collapse the point above says the lift prevents — 26px lanes, measured, on a
  phone. **The query is also duplicated in `App.jsx`** (`wideLayout`), because CSS
  decides where the rail's panels go and JS decides whether they render at all;
  they have to say the same thing or the panels appear with nothing laying them
  out and no toggle to dismiss them.
- **The wordmark's geometry lives in two files, and `src/Logo.test.js` holds them
  together.** `src/Logo.jsx` draws it in the app; `public/logo.svg` is what
  `firmware/hub75/generate_logo.mjs` bakes for the LED panel. They can't be merged — the
  component takes the team colours as props, the generator needs a file to hand a browser —
  so a divergence would leave the panel showing the shape the SVG last held, visible only
  as a splash that looks slightly wrong next to the phone.
  - **The tilt and the viewBox are pinned as a pair.** The mark leans 8°, not the 15° it
    was drawn at, and the viewBox is sized to that: a rotated box is much taller than its
    content, so easing the tilt gave the setup screen **13px** of height back. Easing the
    tilt without re-deriving the box spends that on empty space; re-deriving the box
    without the tilt clips the mark. The test fails either way round — measured, a box
    trimmed to the painted mark gives an aspect of 4.00 at 8° and 3.37 at 15°, and the
    bound sits between them.
  - **The viewBox is trimmed to what the mark *paints*, not to `getBBox`.** A `<text>`
    bbox includes the font's descender space, so deriving the box from it left 8.7 units
    of dead space above the mark and 11.0 below — on screen, **50px of gap above the mark
    and 37px below against `.setup`'s 20px rhythm**, since the margins sat on top of it.
    Trimmed, the element is 80px rather than 101px and `.setup-logo` needs no vertical
    margin at all: below the mark you get the flex gap, above it the screen's own
    `padding-top`. Adding margin back, or re-deriving the box from `getBBox`, brings the
    gap back with it.
  - **The text's `x` is an optical centring — don't "correct" it to the box centre.**
    Measured, the original `x=3` had the glyph run within 1.5 units of dead centre (gaps of
    17.4 and 17.8 units for HOLE) and still read as sitting right; `x=1` balances it and
    `x=-1` overshoots into looking left-biased. Two other criteria disagree with the eye
    here and both are wrong: bounding-box centring wants 3.5, and centre-of-mass wants 6.2
    for HOLE against 1.7 for CORN, because `H` is heavy where `L` and `E` are light. The
    panel's copy is centred *geometrically* instead — `generate_logo.mjs` fits each box to
    its own letters, and at 5 mm pitch the quantisation swamps a nudge this size.
  - **`public/icon.svg` and `public/app-icon.svg` are still at 15°**, deliberately. They
    are an abstract pair of filled boxes rather than the wordmark, and changing them means
    re-rasterising three committed PNGs and moving everyone's installed home-screen icon.
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
    corrected afterwards; see **Editing names** below. That is the whole reason the
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
- **The name fields' row is `.field-row`, not `.name-row`, and that is the
  `.app.stats-screen` trap again.** The play screen's header already owns
  `.name-row` further down `App.css`, with a different `gap` and no `width`, so at
  equal specificity source order would have silently won and the fields' rows would
  have run at the header's spacing. Caught before it shipped only because the class
  was grepped; **a new row-shaped surface needs a new class or the two-class form.**
  The `.first-bag` glyph *is* shared on purpose — nothing redeclares it, only
  `.field-row .first-bag::before` adds a target.
- **CSS media-query ordering:** in `src/App.css`, the responsive tiers
  (`max-height` and the landscape/wide-history queries) live at the **end of the
  file, after the base rules**. They rely on source order to win at equal
  specificity — don't move base rules below them (a bug we already hit once).
  `Positions.css` is its own file for the same reason `Stats.css` is: appending
  base rules to `App.css` is a trap, so a new surface brings its own file and its
  own tier at the end of it.
- **The wide tier's grid is the *play* screen's, so it excludes `.stats-screen` as well
  as `.setup`.** The stats screen is an `.app` too, and without the exclusion it took the
  grid: everything landed in the 408px first column while 340px stayed reserved for a rail
  that never renders. Measured on an 11" iPad, that put the content **196px left of
  centre** and squeezed the ten-column career table into a 408px scroller on the widest
  screens there are — while the mostly-empty box was itself perfectly centred, which is
  why it read as a slight offset rather than a broken layout.
- **`.app.stats-screen`, not `.stats-screen`, and that is not tidiness.** All three of its
  declarations (`max-width`, `gap`, `padding-top`) also exist on `.app`, and at equal
  specificity source order decides — which `App.jsx` settles by importing `Stats.jsx`, and
  so `Stats.css`, *before* its own `App.css`. So the single-class form lost all three and
  the screen silently ran at `.app`'s 480px with a 16px gap; its `max-width` was dead code
  from the day it was written. **A new screen with its own file inherits this trap**:
  anything it re-declares from `.app` needs the two-class form.
- **The stats screen caps at 1040px, the same number the play screen's wide tier uses**, so
  it fills an iPad rather than sitting in 237px gutters. It is capped *at all* because the
  components stop reading well well before a monitor's full width — the seven summary chips
  would inflate to 265px each, and a Recent match row would put the score a foot from the
  name. **`.stat-chips` is an auto-fit grid, so whether the seven chips orphan is a
  function of the width available**, and 720px missed fitting all seven by *four pixels*
  (`7 x 92 + 6 x 8 = 692` against 688), stranding SKUNKS on its own row.
- **The durability paragraph is capped separately, in `ch`.** Line length is a property of
  the text, not of the layout: at 1040px it runs to 136 characters against the 45-75 that
  reads comfortably. Don't fold it into the screen width — capping the screen for the sake
  of one paragraph is what kept this screen narrow in the first place.
  `verify-stats.mjs` covers all of the above, and two of those assertions were worthless
  when first written: centring measured `.stats-screen` itself, whose gutters were correct
  throughout, and the prose bound was a pixel threshold looser than the container's own
  padding. Both now measure the drawn sections and the rendered character count.
- **The court and the history are wrapped in one `.side-rail`, which is
  `display: contents` until the wide tier.** They have to be a single grid item:
  placed separately in column 2 they auto-place into *different rows*, and row 1
  is as tall as `.main`, so the history lands level with the footer instead of
  under the court. `contents` is what keeps the wrapper from changing anything on
  a phone — both panels stay direct flex children of `.app`, so they keep its gap
  and `.history-panel:empty` still collapses a hidden history. The rail is capped
  at `100vh - 32px` and the history shrinks and scrolls inside it, rather than the
  history carrying a `max-height` that would have to know the height of the panels
  above it. **The history is last in the rail because it's the panel whose height
  varies with the game**, so it absorbs what the court and the stats leave instead
  of being moved by them — measured down to a squeezed 900x440, the other two keep
  their size and the rail never overflows. That panel is `flex-direction: column`
  rather than the default row: in a row its empty-state paragraph sizes to its
  text and reads as a half-width card next to two full-width ones.
- **Custom domain served from root**, so Vite `base` stays `/` and the PWA
  `scope`/`start_url` are `/`. Don't add a base path.
- **iOS has no Web Vibration API** — the haptic buzz silently no-ops on iPhone
  (installed or not). The visual jitter still works. Not a bug to "fix".
- **A dev server reached by LAN IP is not a secure context**, and that is how
  the app gets tested on a phone. `localhost` and `https://holecorn.com` both
  count as secure; `http://192.168.x.x:5173` does not, so every
  secure-context-only API is simply *undefined* there — measured on a real LAN
  origin: `isSecureContext` false, `crypto.randomUUID` and `navigator.storage`
  both gone. `crypto.getRandomValues` is **not** restricted, which is why
  `newMatchId()` and `newCode()` use it and why there is no fallback branch.
  Reach for `getRandomValues` over `randomUUID`; an unguarded `randomUUID` at
  startup is a blank page on every phone test. `verify-copy-link.mjs` covers the
  same origin for `navigator.clipboard`.

## Match archive and stats

- **Nothing new is recorded to make the stats work.** `rounds` already held
  every bag's resting tier; the app was simply discarding it at `New game`. So
  don't add fields to game state for a stat before checking whether it is
  already derivable — most are.
- **Only a won match is archived**, and undoing the winning round takes it back
  out. Abandoning a game leaves nothing, because a three-round fragment would
  drag every average around. A `casual` game is never archived however it ends —
  see **`casual` is a guest game** under Domain rules.
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
- **`New game` only confirms while a game is unfinished.** It used to ask after
  a win too, which made sense when `New game` destroyed the only trace of the
  match — the archive changed that, so the prompt was guarding something no
  longer at risk, at the moment you are most likely to want the next game. The
  residual cost: a mis-scored winning round can no longer be corrected once you
  have moved on, so `Undo round` has to be used before `New game`.
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
  same reasoning as the scoreboard settings. A failed write drops the oldest
  match and retries rather than giving up: a plain try/catch would silently lose
  the game just played, and then every game after it.
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
    **11 of 78** played games. It is 6 of 124 now.
  - **`Upsilon` stops at the cutover**, which is what gives the career table a row
    that is all record and no rates. Without it nothing in the fixture shows the
    dashes, and they are the thing most likely to regress.
  - **`src/archive.test.js` holds the committed file to `validRecord`**, because
    the generator only validates at the moment it writes and `mergeMatches` drops
    a bad record *silently* — the fixture would half-import with nothing to say so.
  - **It also asserts no record puts one colour on both teams.** The app's swatches
    make that unreachable by playing, so a fixture showing one would be showing a
    state nobody can get to. See the next bullet for why the *importer* doesn't
    refuse it.
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

## Tournaments

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
  - **`Leave tie` is the only exit**, and it has to exist: with the names locked and nothing
    else on the screen, `Start` was the sole way off it. Gated on `gameStarted` for the reason
    `setCasual` is.
  - **`game.tournament` is deliberately not sticky across `New game`**, unlike `mode` and
    `casual`. A tournament runs over weeks, so a tie-ness left on would file the next friendly
    as a tie — silently, into somebody else's bracket. Picking a tie off the bracket is the
    only thing that sets it.
- **`entrantFaults` has to agree with `lineupFaults`**, or the draw succeeds and produces a
  tie nobody can start. It did once: `sideKeyOf` filters blanks, so a doubles pair with one
  half empty read as a good one-person side, the draw took it, and `Start` then stayed off
  for ever. A side needs as many people as it has slots, and every slot named.
- **The record carries only the tournament's id, and only when there is one.** Absent rather
  than null on an ordinary game, the way `winner` is absent while a game is live, so a
  record outside a tournament keeps exactly the shape it had before tournaments existed.
- **Export grew an envelope for this.** A bare array of matches carries the ties but not the
  brackets, so it imports without complaint and leaves every tournament pointing at nothing.
  `readArchiveFile` still accepts a bare array, because that is every file exported before —
  the merge-on-load tolerance, not a bumped key. Import writes tournaments **first**, or a
  tie lands before the bracket it belongs to.
  - **`mergeTournaments` keeps the local copy, the opposite of `mergeMatches`.** A tournament
    is fixed the moment it is drawn, so two copies of one id are the same draw and an incoming
    one cannot be more right. `mergeMatches` needs `updatedAt` because records get edited.
  - **`saveTournaments` has no drop-the-oldest retry**, unlike `saveArchive`: losing a bracket
    to make room would take its ties' meaning with it while leaving the ties in the archive.
- **Deleting a tournament asks, where deleting a match offers an undo.** Deliberately
  opposite: a match is deleted often enough that a confirm is in the way, a tournament about
  once a year, its button sits under the bracket you were reading, and there is a fact an undo
  bar cannot carry — the ties stay in the archive and keep counting. The dialog says so, and
  `verify-tournament.mjs` checks the claim is true rather than only that it is made.
- **`.tournament-screen` must be excluded from the wide tier's grid in `App.css`**, the same
  trap `.stats-screen` already carries. Without it the screen took the play screen's grid: a
  bracket drawing in 408px with 340px reserved for a rail that never renders.
- **The label says "Winner" and the model says `champion`**, deliberately. `winner` is
  already the winner of a single *tie* (`tie.winner`, `.tie-side.is-winner`,
  `.winner-banner`), and one bracket has ten of those and exactly one champion.
- **A tournament runs over weeks, and that is the sharpest risk in the feature.**
  `localStorage` is per browser and a home-screen app is a different container from a Safari
  tab, so whichever device takes the draw must score every tie — and ITP deletes
  script-writable storage after seven days of Safari use without visiting the site, so a gap
  of more than a week between ties in a *tab* takes the archive with it. Not a coding problem;
  `requestPersistence` already runs and the stats screen already reports the answer.

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

## External scoreboard

- **Why a broker and not a direct connection to the board.** An HTTPS page cannot
  reach `http://` or `ws://` on a private address (mixed content), and iOS has no
  Web Bluetooth, Web Serial or WebUSB. So both ends meet at a broker over WSS.
  Don't "simplify" this to a plain local connection — it will work in dev and fail
  in production, because `localhost` is the one LAN address a browser calls secure.
- **The broker does not have to be a hosted one, and the plan is that it won't
  be.** What the transport needs is WSS with a certificate the phone already
  trusts, which a broker on the LAN can have — a travel router holding a Let's
  Encrypt cert for a name that resolves to its own LAN address. That is the route
  to playing with no signal and no third party, and the reasoning that rules out
  the obvious alternatives (an iPhone hotspot, a Pi, an ESP32 terminating TLS) is
  in `docs/OFFLINE-SCOREBOARD.md`. **The one thing not to undo: the app's origin
  must stay `holecorn.com`.** Serving the app from the board over `http://` is far
  less work and costs the career archive — a different origin is a different
  `localStorage`, and with no secure context there is no install, so no ITP
  exemption and no wake lock.
- **Messages are whole-state and retained, never deltas.** That plus a monotonic
  `v` stamp is what lets a display reboot, reconnect or join late and recover
  with no resync protocol. Keep it that way; it's why the display has no logic.
- **`winner` is absent while the game is live, not null.** Both consumers
  already read a missing key as "nobody has won", so the null was 14 bytes of a
  budget the worst case spends 74% of. Don't add it back for symmetry — and
  don't assume absent is a bug, `test_board_logic.cpp` covers both the absent
  and the legacy explicit-null forms, because a retained message published
  before the change can still be handed to a board. Shortening the other keys
  was measured and rejected: names are 192 of the 339 worst-case bytes, so
  packing everything else saves 19% and buys nothing you can spend.
- **Presence is an MQTT will plus a re-assertion.** The publisher sets a will on
  `holecorn/<code>/online` and publishes `1` retained on connect, so the display
  can tell "0–0" from "the phone has gone away" and dim itself. It also
  re-publishes `1` every `PRESENCE_INTERVAL`, which is not redundant: a session
  whose socket went half-open leaves a will the broker won't fire until keepalive
  expires, long after a replacement link has said "online", so the stale will
  lands last. Re-asserting bounds that to one interval rather than the rest of
  the game. Don't "simplify" it back to a single publish on connect.
- **The display shows the logged score only** — never the live in-round preview.
  This was considered and chosen deliberately: under cancellation scoring a
  provisional total swings hard and then collapses (four good bags reads +12
  until the other team answers and it drops to +2), and because bags can be
  tapped in any order it is flatly wrong until both teams' bags are entered. A
  public board is a record, so it moves once a round. The phone keeps the live
  number because that's where the scoring decisions happen. **Don't "fix" this
  by adding a live total to the display.** Publishing is still debounced,
  because renames fire per keystroke.
- **"Neil wins" but "Rho & Tau win", and the display works that out from the
  label.** The payload carries `teamA`/`teamB` already joined and deliberately
  carries no `mode`, so `winVerb()` in `scoring.js` keys off `TEAM_JOIN` being
  present in the string. Both the app and the display call it, which is what
  stops them disagreeing — **don't add a `mode` field to the payload for this**,
  it costs bytes the worst case can't spare and changes a contract the firmware
  tests pin. The known cost is that a singles player who puts " & " in their own
  name gets the plural.
- **The MQTT chunk is excluded from the PWA precache** (`globIgnores` in
  `vite.config.js`) — it's useless without a network, and precaching it cost
  every install ~100kB gzipped.
- **Settings live under their own localStorage keys**, separate from game state,
  so `newGame` can't clear them and a display device can hold config with no game.
  The scorer and the display use *different* keys — opening a display link in the
  same browser as the scorer must not overwrite the scorer's game code.
- **The version guard rejects only a plausible reorder** (`REORDER_WINDOW`, and
  its mirror in `board_logic.h`). `v` is wall-clock, so refusing every older
  stamp meant one publish from a device with a fast clock pinned a future value
  into the retained message and locked every display out until real time caught
  up — while still reading "live", because presence was unaffected.
- **Ending the MQTT client is never conditional on a publish acknowledgement.**
  `connected` stays true on a half-open socket, and mqtt.js won't error pending
  callbacks while set to reconnect, so a lost PUBACK would strand the client to
  reconnect later and republish its retained "offline" *after* its replacement
  said "online" — dimming the board for the rest of the game.
- **The winner flash hollows the digits, it doesn't blank them.** Lit segments
  keep a full-brightness rim and drop their interior to 26%, so the score stays
  readable for the whole flash. The rim is a stroke *clipped to its own polygon* —
  SVG centres strokes, and an unclipped one grows the segment enough to close the
  mitre gaps that `segments.js` works so hard to preserve. Alternatives were
  measured on a simulated LED panel; weighting lit pixels by channel duty, the
  average draw over a flash cycle came out at 0.91x for hollowing, 1.20x for
  flashing to white and 1.64x for reverse video, against 0.77x for blanking.
  Hollowing was the only option that stays readable *and* under 1x. It also
  respects `prefers-reduced-motion` by not flashing at all.
- **The panel blanks the winning pair instead**, because at 20px a 1px rim around
  a 2px stroke leaves nothing to read. That divergence is deliberate, not an
  oversight.
- **Panel layouts travel on their own retained topic**, `holecorn/<code>/layout`,
  carrying an id (`full`, `score`). Not a field in the score payload, and this is
  the same reasoning that keeps `mode` out of it: the worst case already spends
  74% of the board's buffer, `test_board_logic.cpp` and `scoreboard.test.js` pin
  the payload's shape, and a layout is a different fact with a different
  lifetime — it changes on a button press, not when a round is scored. Retained
  means a board that reboots recovers the choice the way it recovers presence,
  and a change lands **at once** rather than waiting for the next commit, which
  matters because a wash publishes nothing.
  - **An unrecognised id keeps whatever is on screen** — `parseLayout` in
    `board_logic.h` leaves its out-param alone and `useScoreboardDisplay` skips
    the `setLayout`. Falling back to `full` instead would let an app newer than
    the firmware silently override a choice, and blanking would be worse. Both
    sides are tested.
  - **The layout is deliberately absent from the display link.** The retained
    topic is the single source; a URL carrying it would let a stale bookmark
    override the live choice on open.
  - **Every layout needs its own scenes, and `test-firmware.mjs` fails without
    them** — it checks the manifest covers every id in `PANEL_LAYOUTS`. Adding a
    layout is exactly when nobody remembers to dump one, and an unpinned layout
    is a second implementation with no check, which is the whole thing
    `src/panelRender.js` is allowed to exist under.
  - **`DUTY_CEILING` is what bounds a new layout, and it is not slack.** Measured:
    the full layout's worst case is 19.8% lit, the score layout's is 23.6%, and
    the cap is 30%. Bigger digits light more panel, so a layout that fills more
    than this has to be checked against the bank rather than waved through — the
    decision to feed both panels through the controller's 5 V terminals rests on
    that number and no electrical test would catch it.
  - **The digit height is asserted off the framebuffer, not off the constant.**
    `test_render.cpp` measures the lit span in the pair column of a
    blank-names scene, so it proves what got *drawn* rather than comparing
    `GLYPH_BIG_H` with itself. A score layout that quietly rendered small digits
    would otherwise pass.
  - **The score layout keeps the first-thrower rule**, moved under the score. Two
    glyph sizes come from **one** `generate_glyphs.mjs` run — 11x20 is 100mm at
    P5 and 17x30 is 150mm — and the tables are `uint32_t` because 17 columns
    won't fit the `uint16_t` the single-size version used.
- **The panel emulator deliberately has neither the wake lock nor the
  fullscreen tap**, both of which `?display=1` has. It is a judging tool you look
  at for a few rounds, and a 128x32 strip is not a scoreboard — so a tablet
  showing it will sleep. Reach for `?display=1` for anything propped against a
  fence. It also **holds its own dropped link live for 30 seconds where the
  display dims at once** (`Display.jsx`'s `stale`): the emulator mirrors the
  board's `liveWithGrace`, and the display answers a different question. Note
  *whose* link — a scorer that goes away publishes `online 0`, and `senderOnline`
  is anded in **outside** the grace, so that dims both views immediately. The
  grace covers the viewing device losing its network, nothing else. Both are
  deliberate; `boardLiveness()` is the pure version, tested in
  `panelRender.test.js` because the grace has to run from the *drop* — stamping it
  at connect made a long session dim the instant the socket went.
- **The grace runs from when the drop is *detected*, and the two ends detect at
  very different speeds.** Nothing can start the clock earlier, but it means the
  emulator can take twice as long as the board to admit a dead link, so don't
  read a slow dim as a bug. mqtt.js times out at 1.5x keepalive counted from the
  last packet *received*, in ticks of keepalive/2 (`KeepaliveManager`), and the
  default keepalive is 60s and is not set explicitly — so detection lands
  **30-90s** after the network dies, depending where in the ping cycle it fell,
  and the panel dims 30s later. PubSubClient 2.8 defaults `MQTT_KEEPALIVE` to
  15s, so the board notices in 15-30s and dims at 45-60s. Passing
  `keepalive: 15` in `openScoreboardLink` would align them, but that is the
  shared transport, so it changes `?display=1` too — deliberately left alone.
  **Chrome also throttles `setTimeout` in a hidden tab**, so a backgrounded
  emulator can hold the last frame past its own grace until you look at it.
- **The display's wake lock is re-acquired, not requested once.** The browser
  drops it whenever the page is hidden, and the system can reclaim it (low
  battery). An outright refusal is not retried — it would only be refused again —
  but a *release* after a successful grab schedules one retry a second later, so a
  system that won't hold the lock degrades to a slow retry instead of spinning.
  Worth knowing before "simplifying" it: on iOS the API works in a Safari tab
  from 16.4, but was **broken in installed home-screen web apps until iOS 18.4**,
  and Low Power Mode forces a 30-second auto-lock that nothing can override.
- **`.seg-digit` height is `min(62vh, 35vw)`, and which term binds depends on
  the aspect ratio** — the crossover is 62/35 = **1.771**. Below that (16:10 and
  4:3 tablets, and phones on their side) `vw` binds, because four digits side by
  side run out of width first; above it (any 16:9 screen, at 1.778) `vh` binds.
  16:9 clears the crossover by well under a percent, so do not assume either
  term is inert — an earlier version of this note claimed `vw` always binds and
  was wrong for every 16:9 display. Verify by measuring, not by eye:
  `node tools/measure-digits.mjs` reports millimetres per device. The sizes are
  chosen against ~35mm for a 4m viewing distance; a 10" tablet gives 75mm and a
  24" monitor 185mm (the latter from the `vh` term). The portrait pair
  (`min(38vh, 45vw)`) has had no equivalent analysis.
- **The display-link QR code is generated locally** (`uqr`, in
  `ScoreboardSettings.jsx`) because the link embeds the broker password — don't
  swap it for a QR web service, and don't move it off-device. The browser check
  in `tools/verify-copy-link.mjs` decodes the rendered QR to prove it scans.
- **The pre-game form screen is chosen by a retained topic being *present*, not by
  a layout id.** `holecorn/<code>/lineup` carries the roster while `gameStarted` is
  false and is published **empty** — which deletes the retained message — the moment
  a bag is thrown. That presence is the whole trigger: no `mode` field, no screen
  name, no third entry in `PANEL_LAYOUTS`.
  - **`form` deliberately is not a layout id.** A layout is a preference the scorer
    sets with the Panel button and keeps; this is a phase of the game. Adding it to
    `PANEL_LAYOUTS` would put it in that button's cycle and let it be chosen
    mid-game, and driving `/layout` from the screen instead would overwrite the
    score layout the scorer picked. So `renderBoard` takes an optional lineup and
    the lineup wins over both score layouts *and* over the no-state dashes — safe
    because it only ever exists before the first bag, when the score is 0–0.
  - **Publishing the clear can never be skipped as "nothing to send".** An empty
    retained payload is the only route back to the score, and `scoreboardLink.js`
    re-asserts it on every connect — including a null — because a retained roster
    from an earlier session would otherwise strand the board on a form screen for
    the whole game while the score moved underneath it. That is why `lineupSet` is
    tracked separately from the value, and why `pendingLineupRef` holds `{ value }`
    rather than the payload: a computed null is an instruction, not an absence.
  - **Undoing the only round does not bring it back**, because `undoRound` restores
    that round's bags to the lanes and a thrown bag can never return to `unthrown`.
    `New game` is the route back. That is the right answer — you undo to correct a
    round, not to go back to standing around — and `scoreboard.test.js` pins it.
  - **Colours and the layout are not repeated in the lineup payload**; names are.
    The board already has the colours from the score message and two copies could
    disagree, but the score payload carries *joined team labels* and these rows are
    per player, so splitting them would break for anyone with " & " in their name.
  - **PPR travels as tenths** so the firmware needs no float formatter; 12.0 (four
    bags in the hole every round) is the widest it gets, which is what makes the
    column four characters. Form travels as a `"LWLWW"` string rather than a
    bitmask: the same bytes, and neither end has to agree which bit is oldest.
  - **`parseLineup` refuses a row count it cannot halve.** `render.h` splits rows
    into teams by halving the count, so 2 or 4 and nothing else — a length like 3
    would draw somebody in the opposing colour rather than fail.
  - **The lineup is now the largest message the board receives**, so it and not the
    score is what bounds `MQTT_BUFFER`. Measured by `test_board_logic.cpp`: worst
    UTF-8 packet ~423 bytes against the score's ~379 and a 512-byte buffer, so no
    change was needed there — but that is the number to check before adding a field.
  - **The panel's number columns are sized to the lineup in front of them, not to the
    worst case any lineup could hold.** A fixed worst case spent 5 characters on the
    record even when every row read `6-4`; measured, adapting gives an ordinary roster
    **11** name characters where fixed gave 8, `99-99` gives 8, and a three-digit
    `120-87` gives 6. `formLayout()` computes it in both languages and
    `test_render.cpp` asserts the ordering (narrower record buys characters, wider
    costs them) plus an empty gap between name and record on every row of both the
    `99-99` and `120-87` scenes — the drawn pixels, not the arithmetic.
  - **A record can exceed 99, and the clamp is 999 for that reason.** At 99 the board
    silently drew `99` while the stats screen and the phone's Form panel showed the
    true figure — wrong rather than truncated, and reachable at about **100 matches in
    either column**, which in doubles arrives at the rate you play rather than the rate
    you win. The bound now sits where `formatRecord` and its buffer sit, and the
    display needed nothing at all: its columns are `max-content`, so it showed the
    truth the moment the payload stopped lying. Worst-case packet went 415 -> 423
    bytes of the 512 buffer.
  - **A loss pip is a single pixel, not a dim block.** On a real panel an
    unlit-but-not-off LED is indistinguishable from off, so a loss has to be drawn
    as *something* rather than as a darker something.
  - **The empty rate column never keys off the rate.** A PPR of 0.0 is a real
    average — every bag on the floor — and blanking it reads as missing data rather
    than a bad run. Gating on `ppr > 0` shipped once and made the board disagree
    with the phone, which shows 0.0. There are two ways to have no rate and
    `hasRate` in `board_logic.h` is where both live, mirrored by `panelRender.js`
    and `Display.jsx`:
    - **`p` is omitted from the row**, which parses to `-1`. That is a record with
      no thrown bags behind it — a match imported from a written-down result, or a
      newcomer. Absent-means-unknown is the contract `winner` already uses, and it
      only ever shortens a packet, so the 423-byte worst case is unmoved.
    - **The record is 0-0**, which is only still needed for a lineup *retained* from
      before the omission existed: it sends `p: 0` for a newcomer, and there the
      record is the sole thing telling that from a real 0.0. Same reasoning as the
      legacy explicit-null `winner`.
    - Four surfaces, four checks: `form-zero-rate` and `form-no-rate` in
      `test_render.cpp`, and one assertion each in `verify-stats.mjs` and
      `verify-form-screen.mjs`. The display one is worth its keep — it divided
      `undefined` by ten and drew **NaN**, which no unit test saw.
  - **`form-worst` measures 28.5% duty against `DUTY_CEILING`'s 30%** — the densest
    screen the panel has, against the full layout's 19.8% and the score layout's
    23.6%. It passes, and the power case still holds (~1.4 A for both panels at full
    brightness against a bank that folds back at 3 A), but **the ceiling is now
    nearly spent**: a fifth row, larger pips or a denser column set would breach it,
    and that check is the only thing standing between a layout change and browning
    out the board.
  - **The display and the panel deliberately show different amounts**, the same way
    the winner flash and the dim grace already diverge. A tablet has room for the
    rates; a 128x32 strip has four rows of 5x7 and nothing else. Don't unify them.
  - **The display's form table is sized by measurement, and every dimension in it is
    `em`** so one `font-size` scales the whole thing and its natural size is a fixed
    multiple of that font — **11.86x wide and 8.40x tall** for four short names. That
    is what makes the fit solvable instead of guessed. `min(7.5vw, 10vh)` follows the
    `.seg-digit` idiom for the same reason: four rows run out of height on a landscape
    screen and four columns run out of width on a portrait one, so a single `vmin`
    term obeys the tighter everywhere and left **46% of the height** unused on an
    iPad. Crossover is 4:3 exactly — an iPad in landscape, where both bind at once.
    Measured after: 84% of the height in landscape, 97% of the width in portrait, at
    56-108px against the 41-59px a `vmin` term gave.
    - **Read the *intrinsic* size, never a rendered one.** `.display` is a flex
      container and bounds the table at `vw - 4vmin` whatever `max-width` says, so a
      rendered width is the clamped figure. Deriving the multiple that way gave 9.9x
      instead of 11.86x and squeezed "Sigma" to two characters — measure with
      `width: max-content` on a viewport larger than the table wants.
    - **Portrait is width-bound and stays that way**, so it keeps air above and below.
      Spreading the rows to fill it would push the eye further along each row for no
      gain; a bigger font would truncate names instead.
    - **The table spans the width** (`width: 100%`) rather than sitting centred at its
      natural size — measured, a short-name roster is 8.51em against ~11.5em available on
      an iPad, so a third of the screen was margin. This costs no characters, which
      growing the font would.
    - **The name track is `1fr` and the numeric ones `max-content`, and that is a bug
      fix rather than a preference.** The name is the only clipped cell
      (`overflow: hidden` + ellipsis), and asking the grid for the `max-content` of a
      clipped element made **Safari on iPad carry the portrait track width back into
      landscape**: a 7-character name that loaded whole came back as "Bern...", with the
      table still at full width and only the track too narrow. A `1fr` track is computed
      from available space, so nothing content-derived can go stale; the numeric cells
      are `nowrap` and never clipped, so measuring them is safe.
      The cost is that the slack all lands in one gap beside the name.
      `justify-content: space-between` over content-sized tracks spread it more evenly
      and is what this rules out — don't put it back without re-testing rotation on a
      real iPad.
    - **`em` on `.form-table` itself was *suspected* of that and was not the cause.**
      `em` there does resolve against the `font-size` the same rule declares, and pinning
      a cap derived from the portrait font reproduced the symptom — but replacing it with
      `--form-size` did not fix anything on the device. The custom property stays because
      the dependency is real and pointless, not because it worked. Worth remembering as a
      plausible-and-wrong diagnosis that a Chrome-only reproduction appeared to confirm.
      **Descendants may use `em` freely** — they refer to a parent's already-resolved
      font-size — so don't purge it from the file over this.
    - **The width cap on the table has to clear the widest iPad.** In landscape the
      available width is `8.76em x aspect`, so an iPad mini at 1.52 wants 13.34em —
      a 12em cap was tried and silently cost the 11" iPad in landscape 4% of its width.
      13.5em is inert on every iPad and bites past about 1.54:1, so a 16:9 monitor gets
      13.5em of the 15.6em it could take. That is on purpose: without a cap the gaps
      keep growing until the row reads as four unrelated things.
    - **Font size trades directly against name characters**, because the name column
      gets `available - k x font`. So the size cannot be chosen alone, and the bound
      that settles it is that **the panel draws 8 characters** — a tablet truncating
      at 8 or fewer would be worse than the LED strip. `8vw/10.5vh` gives 9 with a
      two-digit record either side; `8.25vw/11vh` gives exactly 8 and 11vh is the
      ceiling, since 12vh overflows in landscape.
    - **A two-digit record is the case that matters, and it arrives with use.** The
      W–L column sizes to its widest row, so `12–10` is meaningfully wider than `6–4`
      and steals from the name — this shipped truncating names to **one character**
      once records reached double figures, while every check written against `6–4`
      passed. The condensed numerals and the 0.5em column gap are what bought it
      back: measured, 1 character to 9 in the worst case, 12 at single digits.
    - **`verify-form-screen.mjs` asserts the size and the characters together**, not
      merely that nothing overflows — the `verify-lanes.mjs` lesson, that a layout
      which silently shrinks passes every overflow check while being useless. Both
      assertions fail on the pre-squish spacing and on the old `vmin` sizing
      respectively; the overflow ones pass throughout.
  - **`white-space: nowrap` on the display's numeric cells is load-bearing**, and it
    is the rule `Lineup.css` and `GameStats.css` already carry on their table cells —
    not carrying it across to the grid is how `12–10` came to split after the en
    dash on a 13" iPad. With long names the grid sits **exactly at its 92vw cap**
    (measured: 949px of 949 on a 1032x1376 iPad), so the shortfall has to come from
    somewhere; only the name may give, and it ellipsises. **Chrome cannot reproduce
    this**, which is worth knowing before trusting a green run: the font is
    `vmin`-based and the width budget `vw`-based, so in portrait they scale together
    and in landscape the budget wins — Chrome always takes the whole shortfall from
    the name. `verify-form-screen.mjs` therefore forces the grid narrower than its
    numeric columns, which reproduces the state in any engine; that assertion fails
    with 2 lines when the `nowrap` is removed and the natural-viewport ones do not.
  - **The form screen has no layout id, so the layout-coverage check in
    `test-firmware.mjs` cannot see it** — hence the separate assertion that some
    scene carries a lineup. Without it the whole screen would be unpinned second
    implementation, which is the one thing `src/panelRender.js` is not allowed to be.
- **The splash is a fourth screen and the second with no layout id**, so it has its own
  standalone assertion in `test-firmware.mjs` for the same reason. The wordmark comes
  from `public/logo.svg` and is painted in **two of the four team colours, picked at
  random each boot**, with a 2x2 connect indicator in the corner. 24.6% duty against the
  30% ceiling. **The mark assembles itself by being thrown there**: the wordmark's two
  boxes are two cornhole boards, so they stand from the first frame and the eight letters
  arc in one at a time — HOLE's from the left, CORN's from the right, the boards taking it
  in turns — landing short, skidding to a stop and knocking the board down a pixel.
  `SPLASH_ANIM_MS` is 3.58s of the 5s. The parts that are easy to undo:
  - **`SPLASH_STAGGER_MS` is `SPLASH_FLIGHT_MS`, not a number of its own**, so a bag
    touches down exactly as the next is let go and **there is never more than one in the
    air** — the one still sliding is on the board. Every spacing from 190 to 640ms was
    rendered and compared side by side before choosing: at 190 two or three bags are in
    flight at once and it reads as a flurry, and at a flight plus its skid (640) each bag
    stops before the next is thrown, which is a beat too far apart and costs another 1.5s
    of splash. Derived rather than written down so a change to the flight carries the
    rhythm with it. **The cost either way is that the animation now outlasts a WiFi
    association**, so a warm reconnect meeting a dead broker would freeze it part-filled —
    see the firmware README.
  - **The boards stand still and only the letters are thrown, which is the whole idea.**
    The boxes were already the thing the letters land in, so the alternative — throwing
    each word whole, box and all — reads as two boards being lobbed about. It was built
    and previewed first; don't go back to it.
  - **A letter is a *rectangle*, not a mask, and that is what makes this cost 128 bytes
    instead of another 16 kB.** `generate_logo.mjs` labels the five connected pieces of
    each word and emits the four letters' bounding boxes; the box is everything outside
    them. That only works because **no box pixel lands inside a letter's rectangle and no
    two rectangles meet** — so the generator asserts both and refuses to write a mark it
    cannot divide. Measured on the current mark: 0 clashes, and 4- and 8-connectivity agree
    on all five pieces. A wider `letter-spacing` or a tighter box would fail there rather
    than as a letter flying off with a slice of frame.
  - **The flight is integer functions and a clock argument, and all of it lives in
    `render.h`** — it is drawing, so the pixel check has to own it, unlike `SPLASH_MS`,
    which is the sketch's the way `WINNER_BLINK` is. `elapsed`, the colours *and the
    throwing order* are passed in, so the same inputs still give the same frame.
    - **Bags are written where they have got to, not sampled at an offset** — the reverse
      of the slide, and forced: nine pieces each carry their own offset, so there is no one
      shift to read the maps through. `splashPx` clips on the way out.
    - **A bag starts just off its own edge**, which the rectangles make knowable per
      letter. The slide had to travel `PANEL_W` because its masks were panel-sized, and
      paid for it with ~130ms of empty panel.
    - **`SPLASH_APEX` is 6 because that is the least headroom any letter has**, measured
      off `LOGO_HOLE_LETTERS` — so a bag at the top of its arc reaches row 0 exactly and
      nothing is ever clipped by the panel's top edge. Raising it clips the tops of the
      shallowest letters.
    - **The knock is read off the clock, never remembered**, so a frame is a pure function
      of `elapsed`. The bags already resting go down with the board; a board dropping alone
      looks like its bags are floating, and that has its own assertion because nothing else
      noticed it.
    - **Duty went down, not up.** Every animation frame lights *less* than the settled mark
      — measured, 12.4% for the bare boards and 21.3% at the busiest frame between, against
      24.6% at rest — so this is not a screen `DUTY_CEILING` needed re-checking for. The
      trade is that the first 0.4s is 12.4% rather than the slide's fuller frame, which
      slightly weakens the "it helps the power bank start" side effect in the firmware
      README. Still ~9x the idle screen.
  - **Each board keeps one colour, bags included, and the order is shuffled per board.**
    So the throws vary every boot and **what they settle into does not**: the settled frame
    is byte-identical to the splash before this change, all five scenes of it, which is the
    property to check first if this is ever touched. `test_render.cpp` pins both halves of
    what the order may change — nothing once every bag is down, and which bags are down
    part way through.
    - **Colouring each bag by the order it was thrown in was built first and rejected.**
      It put two bags of each colour on every board in a different arrangement each boot,
      which is a truer picture of a round and a worse logo: the mark the animation resolves
      to has to be the app's, not a variant of it. The scene assertion is the guard — if a
      bag ever takes a colour of its own again, `the order must leave no trace once every
      bag has landed` fails.
  - **The scenes cannot pin an easing curve, and four of them nearly shipped pretending
    to.** A flight that differs *between* two sample times draws an identical frame at each,
    so `test_render.cpp` writes `out/splash-curve.json` — every offset of all eight bags
    plus both boards' knocks — and `test-firmware.mjs` compares the JS against all 28,656
    offsets and 7,164 knock samples. **Don't replace the curve dump with more scenes.**
    Verified by mutation for *this* animation rather than inherited from the slide's: a
    linear skid in the JS instead of a quadratic one passes all 43 scenes pixel for pixel
    and fails only the curve. Two other timing bugs *are* caught by frames — truncation
    turned to rounding fails three scenes, and a 1ms shift fails the apex frame because
    that one is sampled at the extremum — so the note this replaced, which claimed the
    scenes catch nothing, was too strong.
    - **Where a flight *ends* and *starts* is unpinned by any frame**, because every frame
      renders through the same offsets, so a bag settling a pixel off its square shifts the
      PPMs with it and still matches. Hence the assertions on the ends of the flight, and
      the browser check's "clear of both edges".
    - **Two assertions were written against the constants they check and passed their own
      mutations.** `SPLASH_THUMP = 0` and `SPLASH_SKID = 0` each removed a visible part of
      the animation with nothing failing, because both sides of the comparison moved
      together. They now state the property — the board's bottom edge is *lower* than
      settled, a bag touches down *short* of its square. **Anything new here that compares a
      frame against the constant that drew it deserves the same suspicion.**
  - **The emulator steps the clock in `SPLASH_RENDER_INTERVAL`s, not per animation
    frame**, so it draws the frames the board draws: a browser gets through half again as
    many (60Hz against the board's 25ms tick), and how smooth the throws look at the
    board's own rate is the question the emulator exists to answer. Repeating a value is a
    render React drops, so it also repaints only on the ticks.
    - **Nothing checks this, and no cheap check can.** Removing the quantisation fails no
      assertion — verified by mutation. Telling 25ms steps from 16ms ones through the
      canvas needs a count of distinct frames over ~40 clock steps against a threshold
      tuned to Playwright's own rAF period, which is a tool detail. So it is recorded here
      instead: **if you simplify it back to `setElapsed(t)`, the emulator quietly stops
      answering that question.**
  - **`verify-panel.mjs` is the only thing that can see the emulator hand over a moving
    clock**, and it asks *only* what a browser can answer — the shape of the flight is
    asserted off the framebuffer in `test_render.cpp`, and repeating it here would be a
    check that cannot fail. So it reads three things: the boards are up with every letter's
    square still empty, at the top of the second bag's arc it is lighting LEDs the finished
    mark leaves dark (51 of them, measured), and everything ends on its own square. It needed
    two fixes to be able to:
    - **`page.clock.install()` leaves the clock ticking with real time** — measured, 503ms
      of it for a 500ms wait — so the frames landed wherever the round trips left them. The
      old block's comment claimed the opposite and was harmless only because nothing moved.
      It now `pauseAt`s as well, and the mid-animation read went from 2px-from-settled to
      the frame it asks for. **A `runFor` step is not a step unless the clock is paused.**
    - **Brightness is thresholded against a measured constant, not the row's own minimum.**
      That minimum wobbles by a pixel of antialiasing, and when it landed on 71 rather than
      72 every unlit LED counted as lit: the old "lit across the middle" assertion was
      passing on **122 LEDs of noise**. An unlit dot reads 72, a neighbour's halo lifts one
      to ~95, the faintest coverage pixel reads ~200, so the bar is 150.
    - **Nothing there may depend on which letter is where**, because the order is shuffled
      per page load and the check cannot see the shuffle. That is why "bags are in the air"
      is measured as *lit where the settled frame is dark* rather than by looking at a named
      letter, and why the letter rectangles are imported from `panelLogo.js` instead of
      being written down.
  - **The mark is re-spaced for the panel and is not the app's geometry.** Fitted as
    authored it used 82 of 128 columns and the letters came out at 10px, where Bebas
    Neue's condensed R and N run into themselves. `generate_logo.mjs` eases the tilt to 8°,
    widens `letter-spacing` to 14 and fits to the mark's own bounds. Three traps in that,
    all hit once: SVG counts `letter-spacing` after the final glyph and `text-anchor`
    centres the padded width, so widening it walks the glyphs left inside a fixed box (the
    H ended up on the frame); `getBBox()` on a `<text>` returns the em box, so padding its
    *height* costs a fifth of the scale; and a wider box exceeds the 128 units the source
    puts between the two groups, so they collide unless the second group's offset is
    derived from the box extent.
  - **It carries 4-bit coverage, not a 1-bit mask**, because antialiasing is the only
    thing a 128x32 panel can do about a diagonal, and an 8° tilt is all diagonals.
    `COVERAGE_FLOOR` is load-bearing twice: below ~40% an edge pixel is indistinguishable
    from off at `PANEL_BRIGHTNESS` 40, *and* keeping the fainter ones puts the lit count at
    34.6%, over the ceiling. With the floor the mark is **fewer** lit pixels than a hard
    mask (24.5% vs 27.2%) because the dropped pixels are the ones a hard threshold was
    promoting to full brightness. The generator emits the floor it applied as
    `LOGO_MIN_LEVEL` and the test asserts against that, not against the fraction — which is
    how a quantisation landing at 39.7% got caught.
  - **The lit-pixel duty metric and current diverge by ~1.7x**, measured over every scene:
    `form-worst` is 28.5% lit but 16.6% per-channel, because these colours are never white.
    So `DUTY_CEILING` is conservative, and an antialiased screen can breach it while drawing
    less current than one that passes. Don't redefine the metric to make a screen fit — the
    splash respects the check as written. If it is ever revisited, that is its own change.
  - **The chalk filter is off and that is not a loss at this size.** A 1-2px stroke has no
    interior for a dither pattern, so `feTurbulence` only erodes and wobbles the strokes,
    fighting the antialiasing. Checked at 3x dot size, not assumed.
  - **`drawSplash` takes its two colours as arguments and picks nothing.** `render.h`
    has to give the same frame for the same inputs or the pixel check cannot hold it, so
    the randomness lives in `sketch.ino` (`esp_random()`, because `random()` is seeded
    identically every boot and would show the same pair every time) and in `Panel.jsx`
    for the emulator. The picker cannot repeat a colour: the second index steps past the
    first over the remaining ones rather than being redrawn.
  - **`PALETTE` lives in `scoring.js`**, not `App.jsx`, because the splash reads it too
    and a constant exported from a component file trips the fast-refresh lint.
  - **The chalk tint rounds where every other division in `panelRender.js` truncates.**
    It is matching `Logo.jsx`'s `Math.round`, not an `int` division; `+ 50` before
    `/ 100` in the C++ is what keeps the two byte-identical.
  - **The liveness bookkeeping in `render()` runs before the splash returns.** Skipping
    it leaves `lastLive` at 0 for a link that came up during the splash and dropped
    straight after, so the board would dim the instant the splash cleared instead of
    holding its grace period.
  - **The connect indicator is splash-only.** Once a score is up, the whole panel
    dimming already says the link went, so a corner dot repeats it — and `full` has no
    corner to spare, its name row spans the width.
  - **`generate_logo.mjs` needs a browser, so its staleness check doesn't regenerate.**
    The SVG is set in Bebas Neue and drawn through `feTurbulence`, which is also why the
    masks are baked rather than drawn on the board. The glyph tables are checked by
    regenerating and diffing; CI's firmware job has no browser, so instead the generator
    stamps a hash of `public/logo.svg` plus the font into both outputs and
    `test-firmware.mjs` compares it. An edited logo with stale masks fails; a browser
    update that rasterises differently does not, which is deliberate — the baked asset
    is what ships.
  - **The tilt is 8° in both now, but `letter-spacing` is 14 on the panel and 7 in the
    app.** The spacing is a pixel-crowding fix that only the panel needs; at the size the
    app draws the mark it would visibly change its proportions. So don't "finish the job"
    by matching it.
  - **The generator pins the scale it measures text at**, and that is not tidiness. Glyph
    metrics are hinted against the device size, so `getExtentOfChar` returns slightly
    different advances when the *source* viewBox changes — which fed through the box widths
    into the raster and moved the panel's output by 33 lit pixels when the app's mark was
    re-tilted, even though the generator fits to the mark's own bounds either way.
    Measured, not theorised: 1061 lit against 1094. `MEASURE_VIEWBOX` makes it independent.
  - **The generator substitutes by pattern and checks the pattern *matched*, not that the
    text changed.** Both halves matter: string-matching `rotate(15)` silently stopped
    applying the moment the app adopted 8°, and a change-detecting guard fails exactly when
    the two agree — which is now the normal case.
  - **Two coverage maps, one per word, split by dominant channel** — not by distance to
    the two hexes the SVG hardcodes, which filed a third of HOLE under CORN because a dim
    antialiased blue is nearer `#f18686` than `#69a4f2` in plain RGB. The overlap where
    the boxes cross goes to CORN, the order the SVG paints them in.
  - **`verify-panel.mjs` installs a fake clock for the splash block** so the 2.5 s
    cannot expire between loading the page and reading the canvas; the score block waits
    it out on the *real* clock, because its caption poll needs the reconnect timers to
    fire. The pixel check proves the frame is right — only a browser can see whether
    `Panel.jsx` shows it at all and then gets out of the way.
  - **Measured cost: +1.72 kB gzipped** of the main chunk (85.66 → 87.38) and 4 kB of
    flash, on top of what the emulator already costs. Coverage is 0.82 kB of that over a
    1-bit mask. Re-measure rather than assuming — the slide added 0.15 kB (89.54 → 89.69),
    which is what a curve and an offset should cost, and the throws that replaced it added
    0.57 kB (89.70 → 90.27) for eight flights, the knock and a shuffle. On the board they
    are 128 bytes of letter rectangles and no new masks at all.
- ESP32-class hardware is 2.4GHz-only; iPhone hotspots default to 5GHz, so
  **Maximize Compatibility** has to be on. Expect this to be the first thing that
  goes wrong when the hardware board arrives.

## Firmware

One target: **`firmware/hub75/`** — 2x Waveshare P5 64x32 chained to 128x32
(640x160mm), Adafruit MatrixPortal S3, ESP32. Score *and* team names in team
colours. **Wokwi has no HUB75 part**, so it is verified by a host renderer
instead — see `firmware/hub75/README.md`.

A second SevSeg target in `firmware/wokwi/` was removed on 2026-07-27, once the
two `sketch.ino` files had diverged enough that simulating it proved nothing
about what ships. **The cost is that nothing exercises WiFi or MQTT until the
board is on the bench** — the host suites stop at parsing, layout and duty. Don't
reintroduce a second target to get coverage back: a divergent copy reads as
coverage without being it. The full reasoning is in `firmware/hub75/README.md`.

- **`src/panelRender.js` is a second implementation of `render.h`, and the only
  reason that is allowed is the pixel check.** It exists so the panel can be watched in
  a browser during a real game (`?panel=1`), which stills can't show. What keeps
  it from becoming the Wokwi mistake is that `renderBoard` is not maintained by
  inspection:
  `test_render.cpp` writes `out/scenes.json` describing every scene it dumped,
  and `tools/test-firmware.mjs` renders each through `src/panelRender.js` and
  compares framebuffers byte for byte. **Change `render.h` and the JS fails until it is
  changed to match** — so treat them as one thing in two languages, and don't
  "tidy" either alone. The scene list lives in the C++ on purpose; a scene table
  maintained in two languages is exactly the drift being guarded against.
  - **Every division in `src/panelRender.js` truncates**, because these are
    `int` expressions in C++. `scaled()` is the one that bites: at `LEVEL_STALE` the
    blue channel of `#2f80ed` is 55 truncated and 56 rounded, and that single
    pixel fails the check. Verified by mutation, so `idiv` is load-bearing rather
    than stylistic.
  - **Labels are UTF-8 byte arrays, not strings**, because that is what reaches
    the board — so a 40-byte label is cut mid-character and a name outside the 5x7
    font is drawn one `FONT_UNKNOWN` per byte. Don't "fix" either on the JS side
    alone; the limitation is the firmware's and the point is to see it.
    - **A character the font lacks draws a dash, not a space.** It was a space, and
      that was recorded here as deliberate — right while the only cost was
      truncation, wrong once a whole name could vanish: measured, two Greek-script
      names lit **13** pixels of the name row against 181 for two Latin ones, which
      reads as a fault rather than a limitation. Now 103.
    - **A dash, and the alternatives are all worse.** `.` is one pixel and this panel
      is sized to be read at 7m, so nine of them would be invisible — the very
      problem being solved. `/` is taken: `fitLabel` separates a shortened doubles
      pair with it. `'` is two pixels and sits high, reading as punctuation.
    - **`FONT_UNKNOWN` is emitted by `generate_glyphs.mjs`** into both `glyphs.h` and
      `src/panelGlyphs.js`, because `fontIndex` exists twice — generated into the
      header, hand-written in `panelRender.js` — and the pixel check compares them
      byte for byte. Written down twice they could drift.
    - Accented Latin degrades readably where a non-Latin script does not: `José`
      draws as `JOS-`, losing one character rather than the whole name. That is why
      the fixtures carry an accent and deliberately no Greek script.
  - `glyphs.h` and `src/panelGlyphs.js` come from **one run** of
    `generate_glyphs.mjs`, so the emulator can't quantise the polygons
    differently. Both are checked for staleness.
  - **`src/panelPaint.js` is outside the pixel check** — it draws the framebuffer
    as dots, which no framebuffer comparison can see. `tools/verify-panel.mjs`
    covers it, and is the only thing that would notice a blank canvas.
  - The emulator exercises publish → retain → subscribe → this layout over a real
    broker, which the host suites can't. **It still says nothing about WiFi or
    PubSubClient**, so it does not close the gap above.
  - **It ships to everyone**, not behind a lazy boundary: measured, 3.53 kB
    gzipped of the main chunk (79.82 → 83.35) plus 0.19 kB of CSS, against the
    104 kB the mqtt chunk already costs `?panel=1` anyway. Splitting it would
    touch only `?panel=1` — `Display` is a separate route and unaffected — so the
    reason not to is simply that 4 kB doesn't pay for the boundary. Re-measure
    before adding panel-side features rather than assuming it stays small; the
    second glyph size and the score layout together cost 0.66 kB of that.
    **`scoreboard.js` imports `PANEL_LAYOUTS` from `panelRender.js`**, so the
    glyph tables are reachable from `?display=1` too — irrelevant while `Panel`
    is statically imported, but it would defeat a lazy boundary if one were added.

The parts worth knowing before touching it:

- **`board_logic.h` is deliberately Arduino-free** so it host-compiles against
  desktop ArduinoJson — `test_board_logic.cpp` is how `MQTT_BUFFER` was sized
  rather than guessed. Keep parsing and digit formatting in there, not the `.ino`.
- **The HUB75 panel is sized against 7m, not "as big as possible."** Spectators
  are across the court or at the boards, so 100mm digits (11.4m) and 9-char
  names clear it — the names marginally; see
  `firmware/hub75/README.md`. Panel *width* buys name length, *height*
  buys digit height; four digits run out of width first, which is why two rows
  are left dark *in the `full` layout*. Spending that height is what the `score`
  layout does, and the only way to spend it is to give up the names — the two
  compete for the same 32 rows, which is the trade the two layouts exist to offer.
- **`glyphs.h` is generated** from `src/segments.js` by `generate_glyphs.mjs`,
  so the panel's digits are the browser's geometry rather than a redrawing.
  The dash for the no-state screen is defined in the *generator*, not
  `segments.js`, because nothing else needs one.
- **The board's UP and DOWN buttons step brightness, and that is all they may ever
  do.** Everything else the panel shows is published state, so a local override
  would fight the app; brightness is the one setting with no app-side
  representation and no retained topic to disagree with. `BRIGHTNESS_LEVELS` and
  `stepBrightness()` live in `board_logic.h` so the host suite covers them, leaving
  the `.ino` with pin reads and one library call — nothing reaches `render.h`, so
  the pixel check against `src/panelRender.js` is untouched.
  - **The range is 40 to 255 and neither end is arbitrary.** The floor is where
    every faint thing was judged: `COVERAGE_FLOOR` drops splash pixels under ~40%
    of full *because* at brightness 40 they read as off, and a loss pip is one
    pixel. Both dim with the global setting and neither has been seen on hardware,
    so **a darker step waits until the pip has been eyeballed at dusk.** The
    ceiling is the power budget — 0.98 A worst case against a 3 A fold-back — which
    means the README's full-brightness runtime figures are now four presses away
    rather than hypothetical.
  - **It clamps rather than wrapping**, which is the only reason the step is a
    tested function instead of arithmetic: wrapping puts one press between the
    darkest step and 255. Nothing is persisted across a reboot, because brightness
    tracks the light on the day and 40 is the step that cannot dazzle.
  - **No on-screen indicator**: the panel is the readout, and drawing one would put
    it inside the pixel-checked renderer to say what the eye already has.
- **The HUB75 board runs off a USB power bank, so there is no fuse and no supply
  to size.** A 15 W bank is itself the current limit and folds back, so a fuse
  downstream of it protects nothing — the docs said to fuse for the 40 W peak
  back when mains was assumed, and that advice is gone. Overrunning the budget
  trips the bank off rather than being unsafe, and the layout draws a third of it
  even at full brightness, so power does not constrain `PANEL_BRIGHTNESS` either.
  The risks are the opposite of overcurrent: the bank refusing to start under
  switch-on load, and the **1.4%-duty no-state screen** being too quiet to keep it
  awake.
- **One USB-C cable feeds everything, through the controller.** The MatrixPortal's
  two M3 standoffs either side of the HUB75 socket are USB power brought straight
  out, and Adafruit's instruction is to power from USB and hang the matrix off
  them — so there is no 5 V bus, no chopped lead, no lever connectors, no second
  port. **They are outputs only**: never feed 5 V *in*, because anything in the USB
  port at the same time can damage the board, and flashing always puts something
  there — and the casualty may be the laptop, since the standoffs *are* VBUS with
  no diode between. **Back-feeding looks identical to the correct wiring** (same
  screws, same wires, opposite direction) and works until the first flash, which
  is why `firmware/hub75/README.md` has a `How to destroy it` section. They take
  crimped spade terminals, not bare wire under the screw, and the lug end is the
  one place in the build where polarity is unprotected.
- **Two independent bounds are what make that safe, and one of them is fragile.**
  Adafruit say multi-panel builds need their own supply, but that assumes ~4 A per
  panel all-white; the vendor's "≤20 W per panel" is the same all-white figure.
  This layout measures 19.8% duty worst case, so ~0.98 A for both at full
  brightness. That is bound one, and **`test_render.cpp` asserts it** —
  `DUTY_CEILING`, 30% against a 19.8% worst case — rather than leaving it to
  observation, because nothing else would notice a layout change that filled the
  panel. Bound two is that the bank folds back at 3 A, so no fault can pull the
  8 A the panels are rated for. **Swapping the bank for mains removes bound two**,
  and then the panels must be fed directly instead.
- **A brighter panel-side effect is limited by duty x brightness, not duty.** At
  `PANEL_BRIGHTNESS = 40` even an all-white flood is 1.25 A and fits; only high
  duty *and* daylight brightness together exceed the bank. If it ever is needed,
  the answer is not mains and not bulk capacitance (a 50 ms flood would want
  0.5 F) — it is a PD bank with a buck converter, feeding the panels directly.
  **But the retained whole-state message model blocks it first**: an animation is
  an event, a retained `fourBagger` replays on every display reboot, and a four
  bagger is not derivable from the published score under cancellation. Numbers and
  the dead ends are in `firmware/hub75/README.md`.
- **A HUB75 panel does not power up dark**, which is why bound two is load-bearing
  rather than spare. OE is active low, so from power-on until `panel->begin()` the
  outputs are enabled over random shift-register state at full drive with no
  `PANEL_BRIGHTNESS` applied. It is also the likelier reason a bank refuses to
  start the board — likelier than capacitor inrush — and the fix is a 10k pull-up
  on OE, not a bigger bank.
- **Nothing in `loop()` may block, but not for the reason you'd guess.** The
  panel refreshes from DMA in hardware, so blocking would *not* flicker the
  digits — the `millis()` timers are there because a blocking reconnect stalls
  MQTT, which is what makes the board miss a round.
- **PubSubClient's 256-byte default is too small.** ASCII names land ~251 bytes
  including topic and headers and non-ASCII names reach ~379, because the app
  caps names at 16 UTF-16 code units rather than 16 bytes. Oversized messages
  are dropped silently, with no error to notice. `test_board_logic.cpp` is what
  measures this, and `npm run test:firmware` runs it — adding `first` moved the
  ASCII case from ~239 to ~251, which is five bytes under the default. The
  budget is why `src/scoreboard.test.js` asserts the payload with `toEqual`: a
  field nothing renders should fail rather than quietly ship.
- **Free Wokwi projects are public** — no real broker credentials in one.

## Fixture names

**Every player name in a fixture is a Greek letter — Rho, Tau, Sigma, Phi and so on —
and the only real name is Neil, which is deliberate.** This is a public repo, so the
people this group actually plays with must not be in it. Greek rather than the NATO
alphabet because some fixtures need lengths and shapes NATO cannot supply: three-letter
names (`Rho`, `Tau`, `Phi`), and two names **sharing an initial** for the `fitLabel`
test that a doubles pair does not collapse to `O/O` — `Omega`/`Omicron` are the only
pair here that do, so that fixture is not interchangeable with its neighbours.

A few fixtures depend on exact character counts and will fail if a name is swapped for
one of a different length — the `fitLabel` block in `test_render.cpp` pins the shortening
rule by literal expected string, and the rotation check in `verify-form-screen.mjs` wants
a **7-character** name. Long-name fixtures use slices of a synthetic string
(`AlphaBetaGammaDe...`) rather than a plausible name, so the length is self-evident and
nobody has to wonder whether it is somebody real.

## Testing

`src/scoring.js` is pure and fully testable; the suite is the safety net for the
rules above. When changing scoring behaviour, update the tests too — and for a
bug fix, add a test that fails without the fix first, and *check that it does*.

The scoreboard's failure paths are covered by `src/scoreboardLink.test.js`, which
drives the transport with a fake MQTT client, because the cases that matter — a
lost acknowledgement, a refused subscription, a half-open socket — are ones a
real broker will not reproduce on demand. `openScoreboardLink` takes an
injectable `connect` for exactly this; production never passes it.

`tools/verify-positions.mjs` covers the court and in-game stats panels, and the
assertion it exists for is that **the court names the same thrower the scoring
lanes do**. Both sides derive the parity correctly and are unit tested; nothing
below `App.jsx` can catch it handing the wrong one to the wrong component, and
crossing them over passes all 131 unit tests. Checked by inverting `activeIdx`,
which fails that assertion and nothing else. **The arrangement controls are there
for the same reason, and more so now that they sit in a different panel from the
drawing they change**: a bag wired to the partner of its own row, and the setup
handlers reaching the play screen's edit dialog, both pass all 220 unit tests and
fail only here. The toss is covered there too, and only *properties* can be —
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
Firmware above. One assertion in `test_render.cpp`
is not about rendering at all: `DUTY_CEILING` caps how much of the panel any
scene may light, because the decision to run both panels through the
controller's 5 V terminals depends on it and no electrical test exists to catch
a layout that broke it. That last check is why it is worth
having: the generated header is the app's own digit geometry, so an app-side
change silently stops matching the panel until someone regenerates. These were
manual for a while and drifted twice — a fixture that claimed to be "exactly
what `scoreboardPayload()` produces" but was missing a field, and two characters
`FONT_CHARS` advertised with blank glyphs behind them.

`tools/verify-tournament.mjs` covers the tournament, and the block it exists for is
**reversibility**: win a tie, undo the winning round, and the bracket goes back to
nothing played with every opening tie live again. `tournament.js` is pure and unit
tested, so everything here is about the wiring — that a tie loads locked and tagged,
that `New game` clears the tie-ness, that an imported bracket appears without a
reload. Each was verified by mutation.

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
copy of the archive used to be stale in — see **Editing names**. Everything either
side of that is covered without a broker: the
payload and the clear in `scoreboard.test.js`, the retain-and-re-assert behaviour
against a fake client in `scoreboardLink.test.js`, and the drawing itself by the
pixel check.

## Deployment

Push to `main` → `.github/workflows/deploy.yml` runs `npm ci → npm test →
npm run build → deploy` to GitHub Pages. The custom domain is pinned by
`public/CNAME`. No manual steps.
