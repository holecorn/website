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
```

`test:browser` needs `npm install --no-save playwright` first — it is not a
project dependency. It starts and stops its own preview server.

## Layout

- `src/scoring.js` — **the heart of the app**: pure, framework-free scoring
  functions. All game rules live here; keep them pure and well tested.
- `src/scoring.test.js` — Vitest suite for the above. Add/extend tests for any
  rule change (see Testing).
- `src/App.jsx` — app shell, reducer, screen (setup/play) and celebration state,
  localStorage persistence.
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

## External scoreboard

- **Why a cloud broker and not the LAN.** An HTTPS page cannot reach `http://`
  or `ws://` on a private address (mixed content), and iOS has no Web Bluetooth,
  Web Serial or WebUSB. So a hosted MQTT broker is the only transport that works
  from `holecorn.com` on an iPhone. Don't "simplify" this to a direct local
  connection — it will work in dev on localhost and fail in production.
- **Messages are whole-state and retained, never deltas.** That plus a monotonic
  `v` stamp is what lets a display reboot, reconnect or join late and recover
  with no resync protocol. Keep it that way; it's why the display has no logic.
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
- **`sketch.ino` blanks instead**, because a seven-segment module can only switch
  whole segments. That divergence is deliberate, not an oversight.
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

Two targets, both ESP32, sharing `board_logic.h` (`firmware/hub75/board_logic.h`
is a symlink). They are not alternatives to pick between — the SevSeg one is the
only one that simulates, and the HUB75 one is the one being built.

- **`firmware/wokwi/`** — seven-segment modules via SevSeg, runnable in the
  Wokwi simulator. Score only.
- **`firmware/hub75/`** — 2x Waveshare P5 64x32 chained to 128x32 (640x160mm),
  Adafruit MatrixPortal S3. Score *and* team names in team colours. **Wokwi has
  no HUB75 part**, so this one is verified by a host renderer instead — see
  `firmware/hub75/README.md`.

The parts worth knowing before touching either:

- **`board_logic.h` is deliberately Arduino-free** so it host-compiles against
  desktop ArduinoJson — `test_board_logic.cpp` is how `MQTT_BUFFER` was sized
  rather than guessed. Keep parsing and digit formatting in there, not the `.ino`.
  It carries team names and colours for the HUB75 build; the SevSeg build simply
  ignores those fields, which is cheaper than two copies of the parser.
- **The HUB75 panel is sized against 7m, not "as big as possible."** Spectators
  are across the court or at the boards, so 100mm digits (11.4m) and 10-char
  names (8.6m) clear it with margin. Panel *width* buys name length, *height*
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
- **Nothing in `loop()` may block.** The digits are software-multiplexed by
  SevSeg, so a blocking reconnect wait shows up as visible flicker — hence the
  `millis()` timers rather than `delay()`.
- **PubSubClient's 256-byte default is too small.** ASCII names land ~251 bytes
  including topic and headers and non-ASCII names reach ~379, because the app
  caps names at 16 UTF-16 code units rather than 16 bytes. Oversized messages
  are dropped silently, with no error to notice. `test_board_logic.cpp` is what
  measures this; **re-run it if the payload changes** — adding `first` moved the
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

CI runs `npm test`, then the build, then `npm run test:browser`. All three gate
the deploy. `verify-winner-flash` is deliberately **not** in that set: it needs a
real broker, and a deploy should not fail because a third party is down.

## Deployment

Push to `main` → `.github/workflows/deploy.yml` runs `npm ci → npm test →
npm run build → deploy` to GitHub Pages. The custom domain is pinned by
`public/CNAME`. No manual steps.
