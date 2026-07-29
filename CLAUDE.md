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
- `src/archive.js` — finished matches. Pure record/upsert/remove helpers plus
  the localStorage wrapper, split the same way as `scoreboard.js`.
- `src/stats.js` — career stats over archived matches. Pure, like `scoring.js`;
  tested in `src/stats.test.js`.
- `src/Stats.jsx` / `src/Stats.css` — the career stats screen.
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
  - **The known cost, accepted: a name typo noticed after `Start game` is
    permanent.** Career stats fold by name and a record bakes in the names at
    archive time, so that match reports a phantom player; `New game` clears the
    game rather than returning to setup with it. Recovery is deleting the match or
    export → edit → import. **Renaming on the stats screen is the proper fix and is
    not built yet.**
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
  drag every average around.
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
  game the slot *is* the identity — two teams both on the default "Player 1" are
  two different people, and name-folding them would merge two rows on the screen
  you're looking at while you play. Across a career, folding by name is the point.
  Don't unify the two.
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
  or one that overlaps another device's history, adds nothing. The local copy of
  a match both devices hold wins, so an import can't rewrite local history.
  `validRecord` gates every entry because the file came from a picker and could
  be anything — it checks exactly the fields `stats.js` reads without checking.
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
- **Export/import is the only route off a device** until there's a backend, so
  `verify-stats.mjs` drives the whole round trip rather than just asserting a
  file appears. The unexported count is measured against the newest exported
  `endedAt`, not a match count, so pruning the oldest can't make it go
  backwards.

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
  - **The empty rate column keys off the 0-0 *record*, never off the rate.** A PPR
    of 0.0 is a real average — every bag on the floor — and blanking it reads as
    missing data rather than a bad run. A newcomer is 0-0 by construction, which is
    what tells the two apart without a `played` field on the wire. Gating on
    `ppr > 0` shipped once and made the board disagree with the phone, which shows
    0.0; `form-zero-rate` in `test_render.cpp` and one assertion each in
    `verify-stats.mjs` and `verify-form-screen.mjs` cover the three surfaces.
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
  random each boot**, with a 2x2 connect indicator in the corner. 24.5% duty against the
  30% ceiling. The parts that are easy to undo:
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
    1-bit mask. Re-measure rather than assuming.
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
    the board — so a name outside the 5x7 font renders as spaces and a 40-byte
    label is cut mid-character. Don't "fix" either on the JS side alone; the
    limitation is the firmware's and the point is to see it.
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
- **`diagram.json` is generated** by `generate-diagram.mjs`, which reads the pin
  arrays out of `sketch.ino`. Don't hand-edit the JSON: the two displays share
  seven segment lines, and wiring that silently disagrees with the firmware is
  the likely failure mode.
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
fail only here. It also asserts what the controls' *absence* is worth — no bag or
chip in that dialog — because nothing in `TeamsFields` itself would notice.

`src/stats.test.js` builds its fixtures by playing rounds through the real
scoring functions and archiving the result, rather than hand-writing record
blobs, so a rules change that breaks attribution surfaces there instead of
quietly agreeing with a stale fixture. `tools/verify-stats.mjs` covers what the
unit tests can't: that the effect in `App.jsx` fires on the right transitions.
That is the part which would otherwise either lose every match or file each one
twice, with the pure helpers passing throughout.

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

**The browser checks take a different branch on the runners than they do locally**
— `channel: 'chrome'` here, Playwright's bundled Chromium when `CI` is set — so
passing locally is not evidence they pass in CI. `act` covers that gap for the
`build` and `firmware` jobs; the `deploy` job can't run locally at all. See
`tools/README.md`.

CI runs `npm test`, the build and `npm run test:browser` in one job, and
`npm run test:firmware` in a parallel one. All of them gate the deploy —
including the firmware, even though it doesn't ship with the app, because the
two share a contract and nothing else notices when it breaks.
`verify-winner-flash` and `verify-form-screen` are deliberately **not** in that
set: they need a real broker, and a deploy should not fail because a third party is
down. `verify-form-screen` covers the one thing nothing hermetic can — publish →
retain → subscribe → override the chosen layout → clear → back to the score, on
both `?display=1` and `?panel=1`, plus a display opened late recovering the
retained roster. Everything either side of that is covered without a broker: the
payload and the clear in `scoreboard.test.js`, the retain-and-re-assert behaviour
against a fake client in `scoreboardLink.test.js`, and the drawing itself by the
pixel check.

## Deployment

Push to `main` → `.github/workflows/deploy.yml` runs `npm ci → npm test →
npm run build → deploy` to GitHub Pages. The custom domain is pinned by
`public/CNAME`. No manual steps.
