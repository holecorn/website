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
npm run test:firmware # host C++ suites + the glyphs.h drift check (CI runs these)
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
- `src/Stats.jsx` / `src/Stats.css` — the stats screen.
- `src/Board.jsx` — the per-bag scoring lanes and the hole/four-bagger effects.
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
- **CSS media-query ordering:** in `src/App.css`, the responsive tiers
  (`max-height` and the landscape/wide-history queries) live at the **end of the
  file, after the base rules**. They rely on source order to win at equal
  specificity — don't move base rules below them (a bug we already hit once).
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
- **Doubles attribution is `roundIndex % 2`** in `throwerFor`, mirroring
  `activeIdx` in `App.jsx`. If those two ever disagree, every doubles stat is
  silently mis-credited with nothing failing — `stats.test.js` pins it.
- **`id` and `startedAt` live in `App.jsx`, not `scoring.js`**, which stays pure.
  `startedAt` is stamped when **Start game** is pressed rather than at
  `newGame()`, because the setup screen can sit open indefinitely and that time
  isn't part of the match.
- **The archive has its own localStorage key** so `New game` can't clear it, the
  same reasoning as the scoreboard settings. A failed write drops the oldest
  match and retries rather than giving up: a plain try/catch would silently lose
  the game just played, and then every game after it.
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
- **Export/import is the only route off a device** until there's a backend, so
  `verify-stats.mjs` drives the whole round trip rather than just asserting a
  file appears. The unexported count is measured against the newest exported
  `endedAt`, not a match count, so pruning the oldest can't make it go
  backwards.

## External scoreboard

- **Why a cloud broker and not the LAN.** An HTTPS page cannot reach `http://`
  or `ws://` on a private address (mixed content), and iOS has no Web Bluetooth,
  Web Serial or WebUSB. So a hosted MQTT broker is the only transport that works
  from `holecorn.com` on an iPhone. Don't "simplify" this to a direct local
  connection — it will work in dev on localhost and fail in production.
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

The parts worth knowing before touching it:

- **`board_logic.h` is deliberately Arduino-free** so it host-compiles against
  desktop ArduinoJson — `test_board_logic.cpp` is how `MQTT_BUFFER` was sized
  rather than guessed. Keep parsing and digit formatting in there, not the `.ino`.
- **The HUB75 panel is sized against 7m, not "as big as possible."** Spectators
  are across the court or at the boards, so 100mm digits (11.4m) and 9-char
  names clear it — the names marginally; see
  `firmware/hub75/README.md`. Panel *width* buys name length, *height*
  buys digit height; four digits run out of width first, which is why two rows
  are left dark. Don't "use the spare height" — it buys nothing.
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

## Testing

`src/scoring.js` is pure and fully testable; the suite is the safety net for the
rules above. When changing scoring behaviour, update the tests too — and for a
bug fix, add a test that fails without the fix first, and *check that it does*.

The scoreboard's failure paths are covered by `src/scoreboardLink.test.js`, which
drives the transport with a fake MQTT client, because the cases that matter — a
lost acknowledgement, a refused subscription, a half-open socket — are ones a
real broker will not reproduce on demand. `openScoreboardLink` takes an
injectable `connect` for exactly this; production never passes it.

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

`npm run test:firmware` compiles and runs both host C++ suites and checks that
`glyphs.h` still matches `src/segments.js`. One assertion in `test_render.cpp`
is not about rendering at all: `DUTY_CEILING` caps how much of the panel any
scene may light, because the decision to run both panels through the
controller's 5 V terminals depends on it and no electrical test exists to catch
a layout that broke it. That last check is why it is worth
having: the generated header is the app's own digit geometry, so an app-side
change silently stops matching the panel until someone regenerates. These were
manual for a while and drifted twice — a fixture that claimed to be "exactly
what `scoreboardPayload()` produces" but was missing a field, and two characters
`FONT_CHARS` advertised with blank glyphs behind them.

CI runs `npm test`, the build and `npm run test:browser` in one job, and
`npm run test:firmware` in a parallel one. All of them gate the deploy —
including the firmware, even though it doesn't ship with the app, because the
two share a contract and nothing else notices when it breaks.
`verify-winner-flash` is deliberately **not** in that set: it needs a real
broker, and a deploy should not fail because a third party is down.

## Deployment

Push to `main` → `.github/workflows/deploy.yml` runs `npm ci → npm test →
npm run build → deploy` to GitHub Pages. The custom domain is pinned by
`public/CNAME`. No manual steps.
