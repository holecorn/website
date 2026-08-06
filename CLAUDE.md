# CLAUDE.md

Guidance for working in this repo. See `README.md` for the user-facing feature
description; this file covers conventions, gotchas, and how things fit together.

## What this is

Holecorn — a mobile-first PWA for scoring Cornhole (singles and doubles). Pure
client-side React 19 + Vite, no backend. Deployed to GitHub Pages at
`holecorn.com`.

## Where the detail lives

This file holds what is true on every task. The per-subsystem reasoning — the measured
numbers, the rejected alternatives, what each browser check exists to catch — lives in
`.claude/rules/`, scoped by `paths:` frontmatter so a file loads **only when you open a
file it covers**. That is deliberate: the notes are large because the project has that
many hard-won constraints, and loading all of them on every task crowds out the work.

| File | Loads when you open | Holds |
| --- | --- | --- |
| `.claude/rules/scoring.md` | `scoring.js`, `Board.jsx`, `Positions.*`, `Lineup.*`, `GameStats.*` | guest games, lineup faults, the court, the toss |
| `.claude/rules/archive.md` | `archive.js`, `stats.js`, `Stats.*`, `inactive.js` | records, career stats, name editing, inactive players |
| `.claude/rules/tournament.md` | `tournament.js`, `Tournament.*` | the bracket, the draw ceremony, past tournaments |
| `.claude/rules/scoreboard.md` | `scoreboard*`, `panel*`, `Display.*`, `Panel.*`, `segments.js` | the MQTT contract, the five board screens, the emulator |
| `.claude/rules/layout.md` | any `src/*.css`, `Logo.jsx` | lane caps, responsive tiers, the wordmark, the side rail |
| `.claude/rules/testing.md` | any `src/*.test.js`, anything in `tools/` | what each suite and browser check is for |
| `firmware/hub75/CLAUDE.md` | anything in `firmware/hub75/` | the panel, the power budget, the pixel check |

Each section below that has a rule file names it and keeps only the facts that constrain
code **outside** that file's globs — because that is where the rule will not have loaded.
`docs/TOURNAMENT.md` and `docs/OFFLINE-SCOREBOARD.md` hold decisions and alternatives;
`firmware/hub75/README.md` holds the hardware reasoning.

**Adding a note:** put it in the rule file for the subsystem, not here. This file only
grows for something that is true regardless of which file you have open.

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
  draw, plays it out a name at a time, draws the bracket, shows a tournament's own
  stats, and hands a tie to the scoring screen. Draws only.
- `src/Chip.jsx` / `src/Chip.css` — a summary figure with its label, and the grid a
  row of them sits in. Shared by the career screen's totals and a tournament's, the
  way `FormPips` is shared; it was private to `Stats.jsx` until the second caller.
- `src/format.js` — how a number is written on screen (`pct`, `one`, `plural`,
  `minutes`), shared by the two stats screens. Pure, the `dates.js` precedent.
- `src/Modal.jsx` — a dialog that opens by being mounted, shared by the stats and
  tournament screens. Styled by `.modal` in `App.css`, deliberately not redeclared.
- `src/nameField.js` — `NAME_FIELD`, the props every person-name field needs to stop
  the browser's own contact autofill fighting the archive's suggestions.
- `src/inactive.js` — who has stopped playing, and so is no longer offered by the
  name fields. **Stores when they were marked and derives the rest**, the way
  `tournament.js` stores the draw — see `.claude/rules/archive.md`. Pure, plus the
  localStorage wrapper the same split; tested in `src/inactive.test.js`.
- `src/dates.js` — how a date is written on screen, shared by the stats screen's recent
  list and the tournament rows. Pure and framework-free; tested in `src/dates.test.js`.
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
- **`casual` is a guest game: one flag, and the feature is "don't record it".** The group
  invites passers-by in, and a won game with default names *is* archived — folding every
  stranger into one bogus career whose PPR and form drag the chips around.
  **`playerLabel` is the whole implementation**: in casual it returns the team's
  `PALETTE` colour name, so the header, the lanes, the court, the in-game stats, the
  winner banner, `?display=1` and the LED panel all say "Blue" from one place.
  **Anything new that names a player must read `playerLabel`**, or it will be the one
  surface still showing `Player 1`. `players` keeps what was typed, so the toggle is
  reversible. Sticky across `New game`, like `mode`. Never archived, however it ends.
- **Nobody can play themselves and nobody plays nameless, and `lineupFaults` is the whole
  rule.** It returns one entry per slot at fault, `twice` or `blank`, and `Start` is
  disabled while it returns anything. A name is the only identity the app has, so one
  name in two slots is one person on both sides of the court; a blank slot is dropped by
  `participants` and its throws credited to nobody. **Refused, not defaulted** — restoring
  `Player 1` on blur files a stranger under a name nobody chose. Only the slots the mode
  plays, and a guest game has no faults at all. `newGame`'s defaults are numbered across
  the lineup (`a: [1, 3]`, `b: [2, 4]`) so the app cannot open on a lineup it would refuse
  to start — **any new default name has to keep all four distinct.**
- **Bag positions:** `'unthrown' | 'floor' | 'board' | 'hole'`. Bags start
  `unthrown`; once thrown they can move between floor/board/hole but can never
  return to `unthrown` (`setBag` enforces this).
- **First thrower:** the team that scored last round throws first next; unchanged
  on a wash (tie). Derived through `endRound`/`undoRound`, not free-floating.
- **Where people stand is derived, not stored.** `startSide` anchors it and the rest falls
  out of `rounds.length`, so it reverts with `undoRound` for free, the same as the first
  thrower. `courtPositions()` in `scoring.js` owns it.
  - **`rounds.length % 2` is which *end* throws**, not merely which partner is up. In
    doubles the player slot index *is* the end that partner stands at all game, which is
    why slot 0 throws on even rounds. `activeIdx` in `App.jsx` reads `throwingEnd` rather
    than re-deriving the parity, so the lanes and the diagram cannot disagree about who
    is up.
  - **Doubles swaps pitcher's boxes, singles swaps ends.** Different rules — don't
    "unify" them; `scoring.test.js` pins both. Both are how this group plays, not a
    rulebook citation.
  - **The order of the `players` array carries positional meaning**, which is why
    `swapEnds` reorders slots rather than setting a field, and why swapping ends also
    changes who throws first: slot 0 throws even rounds, so the two are the same fact.
  - **The arrangement is adjusted on the name fields, and the court only reports it** —
    and only from setup, structurally: the absent handler is the gate, not a boolean prop.
  - **The pitch boxes are `aria-hidden` and the arrangement is spoken in prose instead**,
    because position, colour and a pseudo-element bag do not survive being read aloud.
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
  - **A second tab re-reads rather than holding on, and that is not politeness.** The
    game is kept whole in memory and written out whole, so the *stale* copy used to win
    by writing last: measured, a tab left on setup plus one keystroke in a name field
    took three committed rounds to zero and reloaded the playing tab to setup. `App.jsx`
    adopts on `storage` and on `visibilitychange` — the second for the tab that was
    frozen or bfcached while the writes happened — and `savedRaw` is what stops two tabs
    writing at each other. **The screen follows the adopted game unconditionally**,
    including off `stats`: that is what keeps `setup` meaning a game that has not
    started, which the setup screen's name fields depend on, since they dispatch the
    unguarded `rename` that would re-credit committed rounds. Safe because the adopting
    tab is by definition not the one being used. `tools/verify-tabs.mjs` holds it.
  - **The archive, the draw and the inactive marks need none of this** — every writer
    re-reads storage first, so a second tab cannot lose an update there. Anything new
    that keeps a whole document in state and writes it back wholesale does.
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

Finished matches, career stats, and the two name editors. **`.claude/rules/archive.md`
holds the detail** and loads with `src/archive.js`, `src/stats.js`, `src/Stats.jsx`,
`src/inactive.js` or their tests.

What constrains code outside those files:

- **Only a won match is archived**, and undoing the winning round takes it back out. A
  `casual` game is never archived however it ends. The effect lives in `App.jsx` and
  compares against the archived id rather than holding a flag, which is what makes
  win -> undo -> re-win idempotent.
- **`stats` is only reachable from `setup`, and the archive depends on it.** If Stats
  ever becomes reachable from the play screen, deleting the live match would undo
  itself on the next reload.
- **`nameKey` and `sideKeyOf` live in `scoring.js`**, not `stats.js` — the career fold,
  the archive rewrite, the head-to-head pairs and the bracket all have to agree, and two
  definitions of "the same person" is the failure with no symptom.
- **Nothing new is recorded to make a stat work.** `rounds` already holds every bag's
  resting tier, so check whether a stat is derivable before adding a field to game state.
- **Rewriting a record's `players` array *is* the reattribution** — no name index, no
  ids, no alias map. A career rename also reaches the live lineup through a
  `renamePlayer` dispatch in `App.jsx`; a per-match fix deliberately must not.
- **A career rename must sweep the tournament draw as well as the archive**, through
  `saveEntrantRename`. `bracket()` seats sides from `entrants` and finds a tie by
  `sideKeyOf`, so a spelling that moves in one and not the other un-plays every tie that
  person played: the cup returns to In progress with a null champion and its final
  offered again. **A name is stored in exactly three places** — match records, the draw,
  and the inactive mark — and a rename has to reach all three.
- **Marking a player inactive stores *when* they were marked, not that they are**, and
  the filter is one line in `App.jsx`'s `knownNames`. **A new surface that offers names
  must read `knownNames`**, or it will be the one list still naming people who left.
- **`.app.stats-screen`, not `.stats-screen`** — `Stats.css` is bundled before
  `App.css`, so the single-class form loses at equal specificity. See Conventions.

## Tournaments

A knockout, drawn once and played over weeks. **`.claude/rules/tournament.md` holds the
detail** and loads with `src/tournament.js`, `src/Tournament.jsx` or
`tools/verify-tournament.mjs`; `docs/TOURNAMENT.md` holds the decisions and the
alternatives that were rejected.

What constrains code outside those files:

- **`tournament.js` stores the draw and derives everything else** — who is through,
  which round a tie belongs to, who won. So undoing a winning round un-archives the tie
  and the bracket recomputes, with nothing to un-advance. **Don't add a round or a
  position to a match record**; the two sides identify the tie.
- **`sideKeyOf` in `scoring.js` is the competitor identity** — an unordered, deduped set
  of name keys, which is what makes singles and fixed doubles pairs one concept.
- **`game.tournament` is deliberately not sticky across `New game`**, unlike `mode` and
  `casual`, or the next friendly is filed silently into somebody's bracket.
- **A cup played every year is grouped by *reading its name*, and nothing about that is
  stored.** `seriesKey` strips a trailing uppercase Roman numeral or year; there is no
  series record and no field on a tournament, so `newTournament`, `validTournament`,
  `mergeTournaments` and the export envelope are untouched. It had to be derived to reach
  a recorded result, which deliberately keeps no field to tag. **A new surface that groups
  or names tournaments must read `seriesKey`**, not a rule of its own.
- **Before a tie the pre-game form counts the series, not the career**, and `App.jsx` is
  where that is decided: `seriesHistory` gives the pool and one `formMatches` const feeds
  both the `Lineup` panel and the scoreboard publisher, so the phone and the board cannot
  disagree. `Lineup` folds whatever pool it is handed and only the heading says which —
  **anything new that reports form has to be told which pool it is drawing**, or it will
  be the one surface still adding up a career at a cup.
- **`.tournament-screen` must stay excluded from the wide tier's grid in `App.css`** —
  the same trap `.stats-screen` carries. Without it the bracket draws in 408px with
  340px reserved for a rail that never renders.

## External scoreboard

The MQTT link to a tablet (`?display=1`), the LED panel emulator (`?panel=1`), and the
payload contract the firmware pins. **`.claude/rules/scoreboard.md` holds the detail**
and loads with any `src/scoreboard*`, `src/panel*`, `src/Display.*`, `src/Panel.*` or
`src/segments.js`; `docs/OFFLINE-SCOREBOARD.md` holds the offline broker plan.

What constrains code outside those files:

- **Messages are whole-state and retained, never deltas.** That plus a monotonic `v`
  stamp is what lets a display reboot, reconnect or join late and recover with no
  resync protocol. It is also what rules out anything with *phase* — a timer, an
  animation, a screen cycle.
- **The payload's shape is a contract with the firmware and the byte budget is tight** —
  the worst case spends 74% of the board's buffer. `scoreboard.test.js` asserts it with
  `toEqual` so a field nothing renders fails rather than quietly shipping. Don't add
  `mode`, court positions, or a `null` winner for symmetry.
- **`PALETTE`, `gameStarted`, `winVerb` and `sideLabel` live in `scoring.js`**, because
  the app and the board both need them and two definitions would let them disagree.
  `sideLabel` collapsing the spaces around an ampersand *inside* a name is what makes
  reading the join exact rather than a guess.
  - **That holds for the game-colour *path*, not for the literal.** `#eb5757` appears
    ~35 times: changing a team colour means `scoring.js` (the palette and `newGame`'s
    default), `Logo.jsx`'s and `Display.jsx`'s defaults, and the firmware's
    `SPLASH_PALETTE` and `SPLASH_CONNECT` — the last mirrored in `panelRender.js`, so
    `test:firmware` catches that one and nothing catches the rest. The reds in
    `App.css`, `Stats.css` and `Tournament.css` are a **UI accent that shares the hex
    by coincidence** and must not move with the team colour.
- **The MQTT chunk is excluded from the PWA precache** (`globIgnores` in
  `vite.config.js`) — useless without a network, and it cost every install ~100kB
  gzipped.
- **A dev server reached by LAN IP is not a secure context**, and that is how the app
  gets tested on a phone. Reach for `crypto.getRandomValues`, never `randomUUID` — an
  unguarded `randomUUID` at startup is a blank page on every phone test.
- **The app's origin must stay `holecorn.com`.** Serving the app from the board over
  `http://` is far less work and costs the career archive: a different origin is a
  different `localStorage`, and with no secure context there is no install, so no ITP
  exemption and no wake lock.

## Firmware

One target: **`firmware/hub75/`** — 2x Waveshare P5 64x32 chained to 128x32, Adafruit
MatrixPortal S3. **`firmware/hub75/CLAUDE.md` holds the constraints** and loads when you
read anything in that directory; `firmware/hub75/README.md` holds the full reasoning.

Two things that reach back into `src/` and so are worth knowing before you get there:

- **`src/panelRender.js` is a second implementation of `render.h`**, held pixel-identical
  by `npm run test:firmware`. Treat them as one thing in two languages — change one and
  the check fails until the other matches. `src/panelGlyphs.js` and `src/panelLogo.js`
  are **generated**; don't hand-edit them.
- **The panel's power budget is asserted, not observed.** `DUTY_CEILING` in
  `test_render.cpp` caps how much of the panel any scene may light, because the decision
  to run both panels through the controller's 5 V terminals depends on it and no
  electrical test would catch a layout that broke it.

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

**`.claude/rules/testing.md` holds the detail** and loads with any `src/*.test.js`,
anything in `tools/`, or the firmware host suites.

- **`src/scoring.js` is pure and fully testable, and the suite is the safety net for the
  rules above.** When changing scoring behaviour, update the tests too — and for a bug
  fix, add a test that fails without the fix first and *check that it does*.
- **The `tools/verify-*.mjs` browser checks exist for the gaps unit tests structurally
  cannot see**, chiefly `App.jsx` handing the right value to the wrong component. Most
  were validated by mutation, and those mutations pass every unit test — so if you
  change what one covers, mutate it rather than trusting a green run.
- **The browser checks take a different branch in CI than locally** (`channel: 'chrome'`
  here, bundled Chromium when `CI` is set), and the runner's `system-ui` is not a Mac's
  — measured, 22px across `.setup-top`, which once turned a row with 10px of slack into
  a failed deploy. **So `act` is the only way to check a layout change**, and a local
  pass says nothing about it.

## Deployment

Push to `main` → `.github/workflows/deploy.yml` runs `npm ci → npm test →
npm run build → deploy` to GitHub Pages. The custom domain is pinned by
`public/CNAME`. No manual steps.
