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
| `.claude/rules/scoring.md` | `scoring.js`, `Board.jsx`, `Positions.*`, `Lineup.*`, `GameStats.*`, `App.jsx` | guest games, lineup faults, the court, the toss |
| `.claude/rules/archive.md` | `archive.js`, `stats.js`, `Stats.*`, `inactive.js`, `store.js`, `nameField.js`, `App.jsx` | records, career stats, name editing, inactive players, the storage refusals |
| `.claude/rules/tournament.md` | `tournament.js`, `Tournament.*`, `App.jsx` | the bracket, the draw ceremony, past tournaments |
| `.claude/rules/scoreboard.md` | `scoreboard*`, `panel*`, `Display.*`, `Panel.*`, `segments.js`, `main.jsx` | the MQTT contract, the five board screens, the emulator |
| `.claude/rules/layout.md` | any `src/*.css`, `Logo.jsx`, `App.jsx`, `main.jsx`, `css.test.js` | lane caps, responsive tiers, the wordmark, the side rail, the two colour schemes |
| `.claude/rules/testing.md` | any `src/*.test.js`, anything in `tools/`, `App.jsx` | what each suite and browser check is for |
| `firmware/hub75/CLAUDE.md` | anything in `firmware/hub75/` | the panel, the power budget, the pixel check |

Each section below that has a rule file names it and keeps only the facts that constrain
code **outside** that file's globs — because that is where the rule will not have loaded.
`docs/TOURNAMENT.md` and `docs/OFFLINE-SCOREBOARD.md` hold decisions and alternatives;
`firmware/hub75/README.md` holds the hardware reasoning.

**`App.jsx` is in five of those lists on purpose, and it is the exception the scoping
buys nothing on.** It is the app shell: the archive effect, the tournament derivations,
the toss draw, `knownNames`, `wideLayout` and the publisher wiring all live there, so
every subsystem has something to say about it and the six rule files name it 34 times in
prose between them. Scoped to none of them, it opened with no rules at all — the one file
where a change most often breaks something already written down. `scoreboard.md` is the
one left off deliberately: both its mentions are pointers elsewhere (`PALETTE` belongs to
`scoring.js`, the lineup pool to `tournament.md`), and it is the second-largest file.
**The way to make this entry unnecessary is to move code out of `App.jsx`** into modules
the existing globs already cover — not to trim the lists. `src/rules.test.js` holds both
directions: a `src/` file the rules discuss but no glob matches, and a glob that matches
nothing after a rename.

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
  `minutes`). Pure, the `dates.js` precedent. **Import from here rather than writing the
  one-liner**: `pct` had three copies and `GameStats.jsx` hand-rolled the plural that
  `plural` exists for, so two screens quoted the same percentage through different code.
- `src/Modal.jsx` — a dialog that opens by being mounted, shared by the stats and
  tournament screens. Styled by `.modal` in `App.css`, deliberately not redeclared.
- `src/Confetti.jsx` / `src/Confetti.css` — the winner's confetti, dropped by the phone's
  callout and by `?display=1`. Private to `App.jsx` until the board wanted it, the `Chip`
  precedent. **Every size is a multiple of `--piece`**, and `--fall` scales the drop, so
  each surface sets its own: the phone's 6-12px pieces are dust on a board.
- `src/nameField.js` — `NAME_FIELD`, the props every person-name field needs to stop
  the browser's own contact autofill fighting the archive's suggestions.
- `src/inactive.js` — who has stopped playing, and so is no longer offered by the
  name fields. **Stores when they were marked and derives the rest**, the way
  `tournament.js` stores the draw — see `.claude/rules/archive.md`. Also `offerableNames`,
  **the one way to get a list of names to offer**: it derives and filters in a single
  call, so there is no unfiltered half to reach for. Pure, plus the localStorage wrapper
  the same split; tested in `src/inactive.test.js`.
- `src/store.js` — the localStorage end of the three keys above, each of which holds one
  whole JSON document. **Absent and unreadable are different answers** — see
  Conventions. Tested through the three modules in `src/store.test.js`.
- `src/dates.js` — how a date is written on screen, shared by the stats screen's recent
  list and the tournament rows. Pure and framework-free; tested in `src/dates.test.js`.
- `src/Lineup.jsx` / `src/Lineup.css` — the setup screen's pre-game form panel.
  Draws only; `lineupStats()` and `sideRecord()` in `stats.js` derive it.
- `src/GameStats.jsx` / `src/GameStats.css` — the in-game stats panel. Draws only;
  `gameStats()` in `stats.js` derives it.
- `src/Board.jsx` — the per-bag scoring lanes and the hole/four-bagger effects. A lane
  is a **radio group** and the bag's tier is the checked option — see
  `.claude/rules/scoring.md` before turning the zones back into buttons.
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
  scoring phone, `useScoreboardDisplay` for the board). Tested in
  `src/useScoreboard.test.js`, **the one suite that needs a DOM** — it carries its own
  `// @vitest-environment happy-dom` and `vitest.config.js` stays on `node`.
- `src/useWakeLock.js` — keeps a screen awake. Two callers: `?display=1` for the
  whole game, and `App.jsx` for the play screen only. `tools/verify-wakelock.mjs`
  covers both.
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
  - **All four write paths refuse it, so no route reaches a record where one person is
    in two slots.** The setup screen, the archive's match-names editor (which used to
    warn and save anyway), the career rename via `renameClashes`, and `validRecord` on
    import. **Anything new that writes a lineup asks `lineupFaults`** rather than reading
    the rule a second time. The read-side guards in `stats.js` stay for records filed
    before this, and the import refusal costs a record played before it — see
    `.claude/rules/archive.md`.
- **Bag positions:** `'unthrown' | 'floor' | 'board' | 'hole'`. Bags start
  `unthrown`; once thrown they can move between floor/board/hole but can never
  return to `unthrown` (`setBag` enforces this).
- **First thrower:** the team that scored last round throws first next; unchanged
  on a wash (tie). Derived through `endRound`/`undoRound`, not free-floating.
  - **A bag marks it on every surface that has room for one**, filled for the player
    throwing first and hollow for the other player at that end — the setup screen, the
    play header, `?display=1` and the panel's form screen. The panel's two score
    layouts rule the name or the digits instead, because a bag does not fit there; the
    reasons are measured in `.claude/rules/scoreboard.md`. **A dim mark is never the
    other half of the pair** — an unlit LED reads as off — so the two differ in fill.
  - **Singles gets no second mark, and that is read off the label rather than the
    mode.** `splitLabel` finding no join is what says singles, the same test `winVerb`
    makes, so **the scoreboard payload still carries no `mode`**. A casual game reads as
    singles here whatever the mode, correctly: both partners publish as one colour word.
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
  `App.jsx`, and **a callout absorbs a four bagger on the same round** rather than the
  two firing side by side — one overlay to a round, so anything new that celebrates one
  belongs on the callout too.
  - **Those overlays are the seen half, and `roundReport` is the spoken one.** They are
    `aria-hidden` and the winner banner has no live region, so the play screen's one
    `role="status"` region is the only thing that reports a committed round to somebody
    not looking at it. **Anything new that celebrates a round has to be in the sentence
    too**, or it is the one event that still happens silently — see
    `.claude/rules/scoring.md`.

## Conventions & gotchas

- **State persistence:** game state is saved to `localStorage` under
  `STORAGE_KEY` in `App.jsx`. `loadGame()` merges the parsed state over
  `newGame()` defaults so games saved before a field existed still load (and
  migrates the old single-name shape to player slots). Prefer this
  merge-on-load approach over bumping the key.
  - **Then it refuses what it cannot play**, through `validGame` in `scoring.js` — the
    merge fills a field a save predates, but it copies a *present and wrong* one straight
    over the default, and a game that crashes on render blanks the app permanently
    (measured: 18 of 43 shapes, none recovering). **A new field in game state needs a line
    in `validGame`**, or the one save that holds a bad one is a phone that has to be
    reinstalled. Asked after the merge, so absent is never the question — see
    `.claude/rules/scoring.md`.
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
- **Absent and unreadable are different answers, and `store.js` is where that lives.**
  Those three keys used to give the empty value for both and then write regardless, so a
  value this bundle could not parse was overwritten by whatever the app had in hand:
  measured against a plausible `{format: 2, matches: [...]}` envelope, **winning one game
  took 300 matches to 1**, and one import took the cup and the inactive marks with it.
  Reading was never the destructive half. It is a forward-compatibility hazard the
  project walks towards deliberately — merge-on-load rather than a new key puts a newer
  shape under the same name, and the PWA keeps an older bundle running. **A new key that
  holds one whole document goes through `jsonStore`**, or it is the one that still
  overwrites. The game key deliberately does not: it holds this tab's own state, so
  refusing the value on the way *in* (`validGame`) is the recovery.
  - **A refusal now carries a `reason`**, because the advice differs — a full phone is
    told to export and delete, and a phone whose history it cannot read has neither on
    screen to do. `Stats.jsx`'s `refusal()` picks; the footer's warning covers both.
- **The wide tier and the landscape tier must not both match, and the same query is
  written in `App.css` and in `App.jsx` (`wideLayout`).** CSS decides where the rail's
  panels go and JS decides whether they render at all, so the two saying different things
  puts panels on screen with nothing laying them out. Both halves — why the wide tier
  carries `min-height: 451px`, and the 26px lanes a big phone on its side measured before
  it — are in `.claude/rules/layout.md`, which loads with either file.
- **The wordmark's geometry lives in two files, and `src/Logo.test.js` holds them
  together.** `src/Logo.jsx` draws it in the app; `public/logo.svg` is what
  `firmware/hub75/generate_logo.mjs` bakes for the LED panel. They can't be merged — the
  component takes the team colours as props, the generator needs a file to hand a browser —
  so a divergence would leave the panel showing the shape the SVG last held, visible only
  as a splash that looks slightly wrong next to the phone.
  The tilt, the viewBox and the optical centring are each pinned by that test and each
  looks like something to tidy — `.claude/rules/layout.md` holds the measured reason for
  all three, and loads with `Logo.jsx`. **`public/icon.svg` and `public/app-icon.svg` are
  a different mark and stay at 15°**, which is the one fact here no glob would reach.
- **A `@media` tier wins by source order alone, so a base rule below one silently beats
  it** — no error, and only at the size that tier is for (`App.css` collapsed the lanes to
  26px this way once). This was carried as "the tiers live at the end of the file", which
  is a position standing in for the property, and **the position had already drifted**: 47
  base rules sit below a tier across three files and not one of them is named by the tier
  above it. `src/css.test.js` holds the property instead — a base rule may sit below a
  tier, but not redeclare a property that tier sets for the same selector.
  `Positions.css` is its own file for the same reason `Stats.css` is: appending base rules
  to `App.css` is a trap, so a new surface brings its own file and its own tier.
- **The wide tier's grid is asked for by name — `.app.play-screen` — and a new screen
  needs nothing.** It used to be spelled as a list of the screens it *isn't*
  (`.app:not(.setup):not(.stats-screen):not(.tournament-screen)`), which every new screen
  joined by being written: the stats screen took the grid and landed **196px left of
  centre** with 340px held for a rail that never renders, and the tournament screen then
  did the same to its bracket. **So the class in `App.jsx` is what turns the grid on**,
  and a screen that wants the rail asks for it — see `.claude/rules/layout.md`.
- **`.app.stats-screen`, not `.stats-screen`, and that is not tidiness.** All three of its
  declarations (`max-width`, `gap`, `padding-top`) also exist on `.app`, and at equal
  specificity source order decides — which `App.jsx` settles by importing `Stats.jsx`, and
  so `Stats.css`, *before* its own `App.css`. So the single-class form lost all three and
  the screen silently ran at `.app`'s 480px with a 16px gap; its `max-width` was dead code
  from the day it was written. **A new screen with its own file inherits this trap**:
  anything it re-declares from `.app` needs the two-class form.
- **The two team colours are a second channel and never the only one.** Measured, red
  against green is CIEDE2000 **4.4** under deuteranopia — not a near miss, the same
  colour — and the default blue against red is **1.11:1** in greyscale. A name carries
  the meaning nearly everywhere; the round history was the one surface where it did not,
  two byte-identical cells told apart by hue alone. **Anything new that distinguishes the
  teams has to say which is which in text**, and if the visible text is glyphs it needs
  the spoken half too — see `.claude/rules/scoring.md`.
  - **A colour is also a *fill*, and white ink clears none of the four** — measured, 2.87:1
    on the green, 3.48:1 on the red and 1.59:1 on the yellow, against the 4.5:1 small text
    needs. `--on-accent` in `index.css` clears all four and is the only ink an accent fill
    may take, which is what lets the winner banner wear whatever colour won. **A new filled
    control has to use it**, and one filled with a *team* colour wears `.team-fill`, which
    pairs the two — `src/css.test.js` refuses an inline paint outright now. Note the ink
    itself flips: near-black on the dark scheme, white on the light one, because every
    accent darkens to reach the page there. `PALETTE`'s blue is set by the same constraint
    from the other side: a team colour is *text* on `--panel` at 10–13px, which is why it
    is `#448def` rather than the `#2f80ed` it was. See `.claude/rules/layout.md`.
- **The app follows the phone's light/dark setting, and there is no toggle in it.** The
  constraint is sunlight — dark-only measured **33.6/255** mean luminance on the play
  screen, against 228.8 on the light scheme — and the control already exists one swipe
  away, under the brightness slider in Control Centre. Every colour is a single
  `light-dark(light, dark)` in `index.css` and **nothing re-declares a palette anywhere**.
  `.claude/rules/layout.md` holds the measured detail and loads with any stylesheet.
  Three things constrain code it doesn't cover:
  - **A team colour is handed over as `--team` and never as an inline `color` or
    `background`.** An inline style beats every stylesheet, so a painted colour cannot be
    re-derived for a light page — which is how ~25 sites across six components stood
    before. Wear `.team-ink` or `.team-fill`, or read `var(--team-accent)` in the
    element's own rule. `src/css.test.js` refuses a `style={{ … }}` naming a paint at all,
    which is the whole guarantee: `PALETTE` is calibrated for a dark panel and on a light
    one its green is **2.61:1** and its yellow **1.44:1**. The derivation **scales** OKLCH
    lightness and must not clamp it — clamping flattens the four to one lightness, which is
    the channel a red-green dichromat has left, and took red against yellow to **2.6**
    CIEDE2000 under deuteranopia with nothing looking wrong in normal vision.
  - **The UI accents are `--go`, `--warn` and `--caution`**, not the literals they were in
    28 places. They still share hexes with `PALETTE`'s red and green **by coincidence** and
    must not be made to move with them.
  - **`?display=1` and `?panel=1` stay dark**, pinned in `main.jsx`, because a board is
    emissive and sits in the shade. That pin only works while `build.cssTarget` in
    `vite.config.js` names browsers with `light-dark()` — **don't loosen it**: Lightning CSS
    silently rewrites the function into a `prefers-color-scheme` switch that answers to
    nothing, and the app goes on looking right while the board reads blank.
- **Custom domain served from root**, so Vite `base` stays `/`. Don't add a base path.
- **`/board/` is `index.html` with the manifest link stripped, and it is a build step
  because it has to be** — `boardPage()` in `vite.config.js`. Add to Home Screen replaces
  the URL on screen with the manifest's `start_url`, so a scoreboard added from
  `/?display=1&…` installed an icon that opened the scorer with none of the configuration
  that query string carries, and a home-screen web app gets its own storage, so the link is
  the only way it arrives. It must be gone from the HTML **as served**: removing the link
  from `main.jsx` was tried twice and Safari has taken the manifest before a module script
  runs. `index.html`'s three `apple-mobile-web-app-*` tags are what make the icon
  standalone, and `ignoreURLParametersMatching` in the workbox config is what stops the
  service worker answering `/board/` with the cached `index.html`. **Four things that each
  read as tidy-uppable and are not**, in files no rule glob reaches; the measurements and
  the three rejected versions are in `.claude/rules/scoreboard.md`.
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
- **`splitLabel` lives in `scoring.js` beside `sideLabel`**, because dividing a joined
  label is the same fact as building one and the board reads it back: `render.h` and
  `panelRender.js` each have a `splitPair` over bytes for their own shortening, and a
  third spelling on the app side is the drift with no symptom. `shared.test.js` holds it.
- **`nameKey` and `sideKeyOf` live in `scoring.js`**, not `stats.js` — the career fold,
  the archive rewrite, the head-to-head pairs and the bracket all have to agree, and two
  definitions of "the same person" is the failure with no symptom. **That family is
  checked now, not merely written down**: `src/shared.test.js` names each helper that
  exists because a second copy would drift, and the module allowed to declare it. It was
  added because prose had already failed to hold one — `pct` reached three copies.
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
- **Marking a player inactive stores *when* they were marked, not that they are.**
  `offerableNames` in `inactive.js` derives and filters in one call, so a surface that
  offers names cannot get an unfiltered list — there is no export that gives one.
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

## External scoreboard

The MQTT link to a tablet (`?display=1`), the LED panel emulator (`?panel=1`), and the
payload contract the firmware pins. **`.claude/rules/scoreboard.md` holds the detail**
and loads with any `src/scoreboard*`, `src/panel*`, `src/Display.*`, `src/Panel.*` or
`src/segments.js`; `docs/OFFLINE-SCOREBOARD.md` holds the offline broker plan.

What constrains code outside those files:

- **Messages are whole-state and retained, never deltas.** That plus a monotonic `v`
  stamp is what lets a display reboot, reconnect or join late and recover with no
  resync protocol. It is also what rules out anything with *phase* on the **wire** — a
  timer, an animation, a screen cycle. A board may animate off its own clock, and two do:
  the splash, and a won game. **Neither publishes a stamp** — a won game's celebration is
  anchored locally, so a board rebooted onto a retained finished game replays it once and
  settles into the gleam, which needs no anchor at all.
- **The payload's shape is a contract with the firmware and the byte budget is tight** —
  the worst case spends 74% of the board's buffer. `scoreboard.test.js` asserts it with
  `toEqual` so a field nothing renders fails rather than quietly shipping. Don't add
  `mode`, court positions, or a `null` winner for symmetry.
- **A won game gets a celebration and then a gleam, both out of one `winMs`** — how long
  ago the winner appeared, which is the whole of what `renderBoard` is told. The panel
  names the winner (the `score` layout had no names at all, so who won was carried only by
  which pair of digits blinked) and the gleam replaced the blink, so the score never goes
  dark. The display keeps its hollow flash and gains the phone's confetti. **Nothing new is
  on the wire for any of it.** See `.claude/rules/scoreboard.md`.
- **`PALETTE`, `gameStarted`, `winVerb` and `sideLabel` live in `scoring.js`**, because
  the app and the board both need them and two definitions would let them disagree.
  `sideLabel` collapsing the spaces around an ampersand *inside* a name is what makes
  reading the join exact rather than a guess.
  - **A team colour is written once in JS and once in C++, and `test:firmware` holds the
    two equal.** `PALETTE` and `DEFAULT_COLORS` in `scoring.js` are the only literals left
    on the app side — `newGame`, `Logo.jsx` and `Display.jsx` derive their defaults rather
    than repeating the hex, which they used to. The firmware's `SPLASH_PALETTE` is checked
    against `PALETTE` by the mirrored-constants step, and `SPLASH_CONNECT` by the pixel
    check. **The reds in `App.css`, `Stats.css` and `Tournament.css` are a UI accent that
    shares `#eb5757` by coincidence** and must not move with the team colour — which is
    why this is not one variable across the whole app.
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
- **The panel's power budget is asserted, and the assertion is what a measurement cannot
  replace.** `DUTY_CEILING` in `test_render.cpp` caps how much of the panel any scene may
  light, because the decision to run both panels through the controller's 5 V terminals
  depends on it and no electrical test would catch a layout that broke it. The board's
  draw *is* measured now (`1.95 W + 40 W x CIE-duty x brightness/255`, 2026-08-10), which
  changed every watt in the firmware README and no conclusion in it — so don't quote a
  figure from memory, and note **raw lit-pixel duty over-states current by ~2.5x**.

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

**The two publishing steps carry `if: ${{ !env.ACT }}`, so a green `act` run means
everything up to and including `test:browser` passed and nothing about the deploy.**
They fail locally by their nature — `upload-pages-artifact` wants an artifact service
and `deploy-pages` an OIDC token, and act has neither (`--artifact-server-path` gets
past the token and then dies on `ECONNRESET`). Skipping them costs no coverage a local
run ever had. **On the step and never the job**: GitHub does not expose the `env`
context in a job-level `if`, so `if: ${{ !env.ACT }}` on `deploy:` is a parse error
that fails the real deploy — which is why the one-step `deploy` job is gated on its
step instead. `actions/cache` needs no gate; it warns and carries on.
