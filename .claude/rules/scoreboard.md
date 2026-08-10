---
paths:
  - "src/scoreboard.js"
  - "src/scoreboard.test.js"
  - "src/scoreboardLink.js"
  - "src/scoreboardLink.test.js"
  - "src/ScoreboardSettings.jsx"
  - "src/useScoreboard.js"
  - "src/Display.jsx"
  - "src/Display.css"
  - "src/Panel.jsx"
  - "src/Panel.css"
  - "src/main.jsx"
  - "src/panelRender.js"
  - "src/panelRender.test.js"
  - "src/panelPaint.js"
  - "src/panelGlyphs.js"
  - "src/panelLogo.js"
  - "src/segments.js"
  - "src/segments.test.js"
  - "tools/verify-form-screen.mjs"
  - "tools/verify-panel.mjs"
  - "tools/verify-copy-link.mjs"
  - "tools/verify-winner-flash.mjs"
  - "tools/verify-wakelock.mjs"
  - "tools/measure-digits.mjs"
  - "docs/OFFLINE-SCOREBOARD.md"
---

# The external scoreboard

Detail behind **External scoreboard** in the root `CLAUDE.md`, which holds the facts
that reach outside these files. `docs/OFFLINE-SCOREBOARD.md` holds the plan for running
the broker on the LAN.

## The link, the payload and the board screens

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
  tests pin.
  - **What makes reading the string exact rather than a guess is that `sideLabel`
    keeps the join out of the names it joins**, collapsing the spaces around an
    ampersand inside a name so "Ben & Jerry" is written `Ben&Jerry`. Without it a
    singles player called that is announced as a pair *and* — the half nobody had
    noticed — drawn on the panel as `BEN/JERRY`, because `splitPair` in `render.h`
    divides the label to shorten each half and to rule the partner who is up. So the
    underline covered half their own name and **swapped halves every round**, which
    reads as a fault rather than as a quirk. A doubles pair with such a name was
    fooled too, and differently: `winVerb` matches *any* occurrence and `splitPair`
    the *first*, so `"A & B" + "C"` split into `A` / `B & C`.
    - **It is done when a label is built, never when a name is typed.** `players`
      and the archive keep the real spelling, so the lanes, the court, the career
      table and the rename dialog all still say "Ben & Jerry"; only a joined label
      collapses it. Same reason `casual` leaves `players` holding what was typed.
    - **Any spacing containing the join has to go, not just the exact form.**
      `"Ben  &  Jerry"` contains `" & "` and fooled both ends; a bare `Ben&Jerry`
      never did, and is left alone — the rule is about the join, not the character.
    - **`sideLabel` is exported because four callers join names** — `teamLabel`, the
      career fold in `stats.js`, `entrantStats` and the tournament screen — and two
      spellings of it would hold the invariant on some screens and not others. Note
      `teamLabel` passes **both** doubles slots whatever they hold, blank included, so
      a blank partner still leaves the join for `labelPart` to find an empty half in;
      only the tournament filters blanks. `Tournament.jsx`'s own `seatLabel` was
      called `sideLabel` until this collided with it — it labels a bracket *seat*,
      which holds a plan (`winner of a quarter-final`) until it holds a side.
    - **The firmware needs no change and could not carry the fix anyway**: it only
      receives the label. The guarantee is the app's, which is why
      `scoreboard.test.js` pins it at the payload — that is the contract boundary.
      The residue is a message *retained* from before this change, which a board can
      still be handed and will still split; one publish replaces it.
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
- **Who throws next is marked on every board screen, and `first` was always on the
  wire** — `scoreboardPayload` has published it since the first version and only the
  panel read it. The mark is a **bag**: filled for the player throwing first, a hollow
  outline for the other player at that end. It is `.first-bag` on the phone,
  `.thrower` in `Display.css` and `drawBag` in `render.h`, one shape across all four
  surfaces. Nothing new is published for any of it.
  - **The two panel score layouts rule instead, and that divergence is forced rather
    than chosen.** In `score` a bag is physically impossible: `SCORE_DIGIT_Y` is 0 and
    `DIGITS_BIG` is 30 rows of a 32-row panel, so rows 30–31 are all there is and an
    outline needs three. In `full` it would have to sit beside the partner who is up,
    which in doubles is *inside* the label after the slash — rendered, `NEIL/■RHO` —
    and costs a name character on top: `SIGMA/TAU` came back as `SIGMA/TA`. The
    underline already points at that partner for nothing, so it grew a second form
    instead: solid for the first thrower, **dashed** for the other end's player, which
    is the only "hollow" one pixel row can carry. Duty 13.8 → 14.2% (`full`) and
    13.5 → 13.9% (`score`), and no characters either way.
  - **A dim mark is out, and that rule already existed**: an unlit-but-not-off LED is
    indistinguishable from off, which is why a loss pip is a single pixel. So the pair
    differs in *fill*, never in brightness — the one property that survives from a
    13px control down to 5x5 pixels.
  - **Singles gets no second mark**, because there is nobody at that end to tell from
    the thrower and marking both would only say the two of them are playing. Derived
    from the label having no ` & ` — the test `winVerb` already makes, so **the payload
    still carries no `mode`**. `doublesLabels` in `render.h` and `panelRender.js`, and
    `splitLabel` in `scoring.js` on the app side. A *casual* game reads as singles here
    whatever the mode, correctly: both partners are published as one colour word.
  - **The panel's form screen is the one board screen that takes a bag**, and it is the
    screen that most needed one: the lineup topic is cleared at the first bag, so this
    is what a board holds for the whole walk to the boards. It costs **one name
    character on every row** — the column is reserved or the marked rows would be the
    only ones indented — taking 11 to 10 on an ordinary roster, 9 to 8 at `12-10` and 7
    to 6 at `120-87`.
    - **Duty is not the constraint it looks like.** On a sparse roster the screen goes
      14.6 → 15.6% lit, which reads as spending a third of the margin under
      `DUTY_CEILING`; on a *dense* one it goes **27.4 → 26.9%**, because the character
      the column gives up lights more pixels than two bags add. The worst case is the
      dense one, so the ceiling is further away than before, not nearer.
    - **It can be drawn with no score message behind it** — unlike the fixture card,
      which needs `haveState` — and then there is no first thrower to read, so no bags
      and no reserved column. That is the right answer and it is why the indent is
      conditional rather than constant.
  - **On the display the bag is a new column too, and the table had to be re-sized for
    it.** `--form-size` went `min(8vw, 10.5vh)` → `min(7.8vw, 10.2vh)` and the mark is
    `0.4em`, both derived from a sweep rather than nudged: at 8vw even a 0.4em mark cuts
    2 of 4 eight-character names on both portrait iPads, and at 7.5vw the 11in portrait
    falls to 62.6px against the 65px floor. **7.8vw with a 0.4em mark is the only cell in
    that grid that clears both** — 65.1px at the binding case with nothing cut.
    - **The headroom over the panel is gone, and it could not be kept.** The note below
      picks 9 characters because the panel draws 8; with the bag column the panel draws 8
      at `12-10` and the display draws 8, so they are level rather than the display being
      one ahead. Buying the character back needs 7.5vw, which is under the legibility
      floor on an 11in portrait iPad — so this is a bound that ran out, not a preference.
    - **The balancing gap follows a *leading* bag only.** The score screen needs the
      *text* centred over its own digits, so a leading bag is paid for with a trailing
      gap — measured, 22.5px off without it. The fixture card has nothing underneath, so
      what should look centred is the mark and the name together, and a gap there pushes
      the ink **63px** off the card's centre. Hence `balance`, set at the score screen's
      two call sites and nowhere else. On an odd round the bag is *interior* and needs no
      gap at all, on either surface.
    - **The mark is named through `role="img"`, not a `visually-hidden` sibling.** A
      clipped span is still rendered, so its words come back from `innerText` — inside
      `.form-name` that put "throws first," in front of every name read off the table,
      which is how the roster assertion in `verify-form-screen.mjs` found it. `SegNumber`
      already names itself this way.
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
- **`panelPaint.js` writes the framebuffer byte straight into an sRGB canvas, and that is
  right rather than a missed gamma step.** It reads like a bug: `LEVEL_STALE` is 60, and
  60/255 of *duty* is 23.5% of the light where 60/255 of *sRGB* is 4.5% of it, so the
  emulator looks like it overstates the board's dim about 5x. But nothing drives the panel
  at a linear duty. `drawPixelRGB888` runs every channel through `lumConvTab`, the
  library's 16-bit CIE1931 curve, unless `NO_CIE1931` is defined — and it is not, in the
  header or the sketch. Measured against the table shipped with 3.0.12: `lumConvTab[60]`
  is 2593 of 65535, and the panel lights eight bit planes off the top eight bits of that
  (`MASK_OFFSET` is `16 - depth`), so **10 of 255 duty, 3.92%**, against sRGB 60's **4.52%**
  luminance. **1.15x, not 5x**, and in the direction that makes the emulator slightly
  *brighter*.
  - **Per colour it is 0.95x to 1.16x**, which is the figure that matters, because
    `scaled()` dims in the framebuffer and so each channel is mapped from its own already
    scaled byte. Luminance-weighted stale-against-live: the marker grey 0.95, green 0.96,
    red 0.99, blue 1.15, white 1.15, yellow 1.16. `setBrightness8` cannot enter into it —
    brightness is an OE window applied per row, independent of the pixel data, so it moves
    both states together.
  - **What the emulator genuinely cannot show is the banding.** At `LEVEL_STALE` a
    palette colour's channels land on duties of 1, 3 and 8 of 255, so the board has a
    handful of levels there where the canvas has smooth ones. That is a real difference
    and it is the *only* one — so if a stale scene ever needs judging on the hardware, it
    is quantisation to look for, not brightness.
  - **The two curves agree because they are two fits of the same thing** — sRGB's ~2.2
    power and CIE1931's inverse cube root both approximate the eye's response — so this is
    not a coincidence to be re-derived per level. It also means the reverse worry, that a
    real brightness problem would be hidden here, is bounded by the same 1.16x.
  - **Nothing checks it and a check would be worth little.** The fact lives in a
    third-party table and in the browser's own transfer function, so there is nothing on
    this side to assert beyond the line being the line — and the change it guards against
    is a deliberate one someone would make while reading the file, not an accident. The
    firmware README records the same trap from the other side, where the panel's red was
    thought to need a gamma table and did not.
- **How far the display dims is one number on `.display`'s children, and it is pinned as
  the deepest that keeps the digits readable.** A segment is the same hex lit and unlit —
  8% of it when off — so a stale digit's legibility is the gap between two shades of one
  colour, and dimming only `.seg.on` closed that gap instead of shifting it: measured,
  11.29 to **1.90** at the worst colour, where a stale `22` and `88` are the same shape.
  **Re-proportioning the unlit stroke is not the fix** — the `+0.05` flare term in the
  contrast formula dominates once the lit level is that dark, so scaling both by 0.45
  moves the worst colour from 1.90 to 1.98. Depth is the only lever, and 0.7 is where it
  sits because 0.65 measures 2.84 against the 3:1 a digit this size needs. `css.test.js`
  holds both bounds, so neither the dim nor the floor can be loosened alone; the lost
  glow is the second cue, and it costs no legibility.
  - **Enumerated per element it was the win banner that got left out**, at full brightness
    over a board reading "waiting for the scorer". One rule on the children is what makes
    a new element on the board dim by default — the status line is the single exception,
    since it is what says why.
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
- **The wake lock is re-acquired, not requested once, and the hook is `src/useWakeLock.js`
  now** — shared with the scoring phone, which takes it on the play screen only and
  releases it everywhere else (see `.claude/rules/scoring.md`). The display passes no
  argument and so holds it for as long as it is open. The browser
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
- **The middle column reserves its box, because it is the only part of the score screen
  whose size depends on what has arrived.** The scores are two seven-segment digits from
  the first frame, the team names sit inside a side the digits already make wider, and the
  status line is absolute — so the round and the target were the whole of it, and the board
  visibly re-laid itself the moment the first message landed. Measured cold against live on
  an 11in iPad: the column 33.4 -> 55.2px, each score **10.9px outward** (6.3px at 874x402,
  13.2px on a 1080p monitor) and the round **19.9px up** its own column as the empty target
  line opened under it. Portrait moves no digits — the sides are stacked — but the row still
  grew 98.9 -> 163.9px under them.
  - **`min-width: 2.2em` on both lines, and the em is inherited rather than self-declared.**
    `font-size` moved up to `.display-middle` for that: an `em` length on the element that
    declares the `font-size` it resolves against is the shape `--form-size` exists to avoid.
    The bound is `to 99`, since `MAX_TARGET` is 99 — measured **1.89em** on a 1080p monitor
    against **2.18em** at the clamp's 14px floor, where hinting costs proportionally the
    most, so one ratio for the whole clamp has to clear the floor's. `R100` is 1.97em and
    rides under it. The price is that the column is ~7px wider than its content on an iPad,
    which lands in the gap either side and moves the settled layout 3.6px.
  - **The height is `1lh` and needs no measured number**, which is why it is not a second
    `em` figure: it is the line box the filled span takes, so the empty one reserves exactly
    that. `build.cssTarget` names `safari17.5`, well past the 16.4 that unit needs, and
    Lightning CSS passes it through — checked in `dist`.
  - **`verify-form-screen.mjs` holds it, against a *cold* board on a code nothing has ever
    published to**, which is what a display waiting for the scorer is. Both states are
    asserted, or two boards showing the same thing would agree about their layout whatever
    the reservation did. Two mutations, each killed only by its own: the `min-width` removed
    reports 32px cold against 57.7px live, and the `min-height` removed fails the height and
    the round's position. Not in CI, like everything else in that file — **run it after
    touching `Display.css`.**
- **The display-link QR code is generated locally** (`uqr`, in
  `ScoreboardSettings.jsx`) because the link embeds the broker password — don't
  swap it for a QR web service, and don't move it off-device. The browser check
  in `tools/verify-copy-link.mjs` decodes the rendered QR to prove it scans.
- **A board installs from its own manifest, and what that manifest has to do is name no
  `start_url`.** Add to Home Screen reads the manifest rather than the URL on screen, so
  with only the app's manifest on the page a board bookmarked from `?display=1` installed
  an icon that opened the *scorer* — the symptom is the query string vanishing, and it is
  being replaced rather than stripped. Omitted, the spec falls back to the page that
  linked the manifest, which is the link with the broker, the code and the password on it.
  `public/panel.webmanifest` and `public/display.webmanifest` are that, and `main.jsx`
  points the link at whichever view is routing.
  - **The fallback is the feature, not a shortcut around writing a `start_url` out.** A
    home-screen web app gets its own storage container, so the config `Panel.jsx` and
    `Display.jsx` saved while the link was open in Safari is *not there* on first launch
    of the icon. A manifest naming `/?panel=1` would install just as cleanly and open a
    board with nothing to connect to, showing the "open the display link" message.
  - **Two static files and one href, rather than a manifest generated at runtime.** The
    credentials are per-setup, so a baked `start_url` was never available; a `blob:` or
    `data:` manifest carrying the real one is the alternative and is unnecessary once the
    fallback does the work — and Safari's support for those is unverified where the
    fallback is in the spec. The link element is *created* when missing because
    vite-plugin-pwa injects it into the built `index.html` and not into the dev server's.
  - **`display: standalone` is what makes it a web app rather than a Safari bookmark**,
    which the display's fullscreen tap and any chance of the wake lock ride on. The board
    manifests carry their own `name` for the same reason the two views are separate files
    — a home screen holding both wants to tell them apart.
  - **Both halves are held by `verify-panel.mjs`**, because only a browser sees `main.jsx`
    swap the link and a board manifest that grew a `start_url` would install perfectly and
    still throw the credentials away. Verified by mutation: a `start_url` fails only the
    one assertion, and dropping the swap fails the four naming the files.
  - **What no check here can reach is whether WebKit applies that fallback**, and as of
    2026-08-10 it is unconfirmed on the iPad — it is in the manifest processing algorithm
    and the assertions above only prove the manifest is what the page links. The tell is
    the Add to Home Screen sheet showing the query string rather than `holecorn.com/`. **If
    it does not**, the next move is dropping the manifest link outright on the board views:
    iOS then falls back to the legacy `apple-mobile-web-app-capable` path in `index.html`,
    which keeps the URL for certain, at the cost of standing on a deprecated meta tag.
- **The link carries a *second* credential pair when there is one, and `linkCredentials`
  is the whole rule.** A publisher writes and a board only ever subscribes, so the pair
  that goes into a link — copied, shown as a QR, and left in a tablet's `localStorage`
  and its browser history — should be a read-only account. `docs/OFFLINE-SCOREBOARD.md`
  has provisioned `scorer` and `viewer` on the LAN broker since before the app could use
  them; `displayUsername`/`displayPassword` are the app catching up. Blank, the link
  carries the scorer's, which is what every setup did before the fields existed — so
  nothing needed migrating and `configFromSearch` is untouched, because the board still
  receives one `user`/`pass` pair and neither `Display.jsx` nor `Panel.jsx` knows there
  was a choice.
  - **All-or-nothing, never field by field, and that is the security property rather
    than tidiness.** Falling back per field takes a half-filled display pair and puts the
    *scorer's password* into a link the person filling those boxes believes they have
    just locked down — the one outcome the feature exists to prevent. As a unit a
    half-filled pair is merely refused by the broker, which is visible. Neither form
    grants write access, so the fault is the leak and not the connection;
    `scoreboard.test.js` pins it and the per-field mutation fails exactly that one test.
  - **`useScoreboardPublisher` still reads `username`/`password` and must keep to it.**
    The scoring phone is the one thing that needs write, so the new fields are read by
    `displayUrl` and by nothing else — a publisher that picked them up would be a board
    that cannot publish, on a broker where that is the *correct* refusal and so reads as
    an app bug.
  - **The bottom hint names which pair the link in hand carries**, rather than prose
    covering both cases. It is one boolean and it is the only place the choice is visible
    — the fields are two blank boxes either way, and a password field shows nothing.
  - **`verify-copy-link.mjs` seeds both pairs**, so the clipboard and the decoded QR are
    each asserted to carry the viewer's and to contain neither scorer string. That is the
    `App.jsx`-hands-the-wrong-value gap: unit tests cover `linkCredentials`, but only a
    browser sees which fields the settings panel built its link from. Note it ran green
    against a **stale `dist/`** first — `with-preview.mjs` does not build, and CI does it
    in a separate step, so **`npm run build` before `npm run test:browser` locally** or
    the checks silently measure the last bundle.
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
    23.6%. It passes, and the power case still holds (~1.6 A for both panels at full
    brightness against a port that folds back at 3 A — measured model, see the firmware
    `README.md`'s `Power`), but **the ceiling is now
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
    - **So each lane is ruled, and the rule is why the rows are `subgrid` rather than
      `display: contents`.** That slack sits *between* a short name and that name's own
      record: measured, **492px on an 11in iPad in landscape** (472-516 across the four
      rows, 45% of the table's width), 720-746 on a 1920x1080 monitor, 347-378 in
      portrait — and across that run the eye had nothing but a 145px row lane to hold, on
      a board read from the throw line. A hairline under each row is the rail. `contents`
      shares one set of column widths and leaves **no box to paint**, which is the whole
      reason for the change; painting the four cells instead comes out ragged, because
      `align-items: baseline` gives `.form-pips` a 0.4em box against the text cells' 1em,
      so their bottom edges sit at different heights.
      - **It costs 58px of height and not one character.** Measured on an 11in iPad in
        landscape, 707 -> 765px of a 834px viewport, and every track width, every gap and
        every clipped-name count is byte-identical either way. That is the property that
        rules out the alternatives below, all of which are paid for in characters.
      - **Bigger text cannot do this job, and the ceiling is why.** The table's width is
        pinned at 92vw, not by the font, so growing the font only shrinks the run through
        the numeric columns' growth — measured, `8.25vw/11vh` (the documented ceiling)
        buys 4.7% of font and takes the worst row 481 -> 452px, **6%**, for the 9th name
        character, which is the whole margin over the panel's 8. `9vw/12vh` takes 18% off
        the run and **overflows the landscape viewport by 8px**, which is the 12vh the
        sizing note already refuses. And a rail *plus* `8.25vw/11vh` overflows by 4px: it
        is one or the other, not both.
      - **Right-aligning the names was built and measured, and is the other real answer.**
        It closes the run outright — a flat 39-57px, the column gap and nothing else, at
        every viewport and every roster — because it makes the name grow leftwards from
        the numbers and every other cell in the row is right-aligned already. What it
        costs is position: the block then sits right of centre with the slack banked at
        the left edge, a third of a 16:9 monitor's width, and the heading has to follow it
        or read as stranded. Same emptiness, moved out of the rows rather than bridged.
        Not taken — the rail keeps the table balanced and buys the association for height
        instead — but it is one declaration if the height ever becomes the scarcer thing.
      - **A dotted leader is the wrong instrument here** and was rendered before being
        dropped: at 0.045em it is a 0.76mm dot on an 11in iPad, which subtends 0.65 arcmin
        at 4m and so falls under the eye's resolution. It reads well on a desk and
        disappears exactly at the distance the problem is about. A rule is a continuous
        feature and survives it.
      - **Between the rows only.** A rule under the last one reads as a footer rather than
        as the last lane, and the fixture card gets none at all — two centred sides, no
        columns, no run to hold.
      - **`subgrid` is still a grid-structure change on the one element with the Safari
        history above**, even though the track definitions are untouched and so the
        `max-content`-on-a-clipped-cell shape that broke it is not in play. Chrome cannot
        reproduce that bug, so a green local run says nothing: `verify-form-screen.mjs`'s
        rotation block is what would catch it, on a real iPad.
      - **Three assertions in `verify-form-screen.mjs`, read off the painted box rather
        than the declaration** — reverting to `contents` leaves the row no box at all, so
        the widths collapse instead of the CSS failing to parse. Each of the three
        mutations fails exactly one: `contents` reports every rule 1134px short, no border
        reports four widths of 0, and dropping the `:not(:last-child)` reports 2px on the
        last.
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
- **The tournament fixture card is a fourth screen on a third retained topic**, and it
  is what a tournament shows before a tie instead of the form screen.
  `holecorn/<code>/tie` carries the cup's name and the round while `gameStarted` is
  false, and is published **empty** at the first bag exactly as the lineup is.
  - **The lineup the display keeps under the card is the *series'* form, not a career**,
    because `App.jsx` hands `lineupPayload` the same pool the phone's panel folds — see
    **The pre-game form panel reads the series** in `.claude/rules/tournament.md`. Nothing
    on the wire changed for it: the payload is rows of names and numbers whichever matches
    were counted, and the cup is already on screen from the tie topic. It does mean the
    lineup topic is **absent more often at a tie** — a first edition has no ties behind it,
    so nobody is `played` — which is the case the display's "either topic" branch below
    already exists for.
  - **Form is not sparse inside a knockout, it is degenerate.** `reachedBy` marks a side
    `out` the moment any tie in its route has a winner that is not them, and an out side
    is seated in no further ties — so at the moment the screen is published *both* sides
    have won every tie they have played. The pips read `WWW` against `WWW`, and the only
    thing that can differ is their length, by one, when one side came through a
    preliminary. That is the entire information content, and it is why the card replaces
    the form screen rather than sitting beside it.
  - **It carries no names.** The two sides are already in the score payload as joined
    labels, and two copies of who is playing could disagree — the rule that keeps the
    colours out of the lineup payload. So `renderBoard` needs `haveState` for a tie
    where it does not for a lineup: with no score message there is nobody to name, and
    it falls through to the dashes rather than drawing a heading over nothing.
  - **A topic and not a field on the lineup, and the byte budget is why.** A tournament
    name is 32 UTF-16 code units, which is 96 bytes of UTF-8 on top of a lineup packet
    already at 423 of the board's 512 — measured, that lands at 498 with a 16-character
    cap and over the buffer without one. On its own topic it is 162 bytes worst case and
    nothing is truncated on the wire, so the panel cuts to what its row holds and the
    display shows the lot. Same reasoning as `/layout`, and a tie is a different fact
    with a different lifetime again: it changes when a tie is picked off a bracket.
  - **The sides are stacked, not drawn either side of a versus mark, and the reason is
    characters.** Split across one row each side gets 9 — measured, a 16-character name
    lands as `ALPHABETA`. A full-width row gives 21 and it fits whole, which is also
    what lets `fitTieSide` keep the ampersand a pair was typed with rather than always
    collapsing to `NEIL/RHO` the way the score screen's name row must.
  - **The fixture collapses onto one row when both sides fit there as typed**, which
    frees the fourth row and spreads the card. **Never by shortening** — buying air by
    giving up a name is the wrong way round — so a long pair stacks and keeps its
    ampersand. The heading stays two rows either way, so a cup does not change shape
    between its own ties.
    - **The threshold is 20 characters and not the 21 a line physically holds.** 21 fit,
      but they run to within a pixel of both edges and read as crowding the frame; 20
      leaves 4px. `test_render.cpp` pins it with a *pair* of scenes one character apart,
      because asserting only that 20 spreads passes with the limit at 21.
  - **No versus mark between stacked sides and no first-thrower rule, and both are the
    same 1px.** `TIE_ROW_H` is 8 and `FONT_H` is 7, so a rule under a name sits flush
    against the glyphs and reads as an underscore stuck to it rather than a mark beneath
    it. The colours are the same two the score screen puts either side of a `V`, so they
    carry the fixture on their own, and the score screen rules the opening side a few
    seconds later. **Drawing a rule only in the spread layout, where the room exists, was
    considered and rejected**: a marker that appears only when the names are short reads
    as missing information rather than as information never offered.
  - **Cycling screens on a timer was considered and rejected.** The pre-game window is
    however long it takes to walk to the boards, so a board you have to *wait* for is
    worse than one you can read in passing — but the structural objection is the one that
    settles it: the whole message model is retained whole-state, which is what lets a
    board reboot or join late and recover with no resync. A timer introduces **phase**,
    which is in no message, so two boards would drift apart and a reboot would land mid
    cycle. If a second screen ever earns its place it should be a **layout id**, which is
    retained and chosen, not a timer.
  - **The panel gives the whole screen to the card; the display keeps its form table and
    captions it.** A tablet has the room a 128x32 strip does not, the same divergence the
    winner flash and the dim grace already make. The display's pre-game branch therefore
    triggers on *either* topic — a cup whose entrants have never played publishes no
    lineup at all, which is round one of a first tournament, and without that the tablet
    would say nothing about the tie in front of it. There it names the two sides instead.
  - **`boardScreen` is the precedence, asked rather than re-derived.** `Panel.jsx`
    captions the emulator with it, and a caption that worked the chain out for itself
    named a screen the canvas was not drawing — verified by mutation, where reversing the
    order left the words saying "Tournament tie" over a form screen. `render.h` writes the
    chain out instead, because the firmware draws and never captions; the pixel check is
    what holds the two together.
  - **The card has no layout id either**, so `test-firmware.mjs` carries a third
    standalone assertion that some scene has a tie — the form screen's rule, for the same
    reason.
- **The draw card is a fifth screen on a fourth retained topic**, `holecorn/<code>/draw`,
  and it is what the board shows while the names are coming out of the hat. Retained and
  cleared exactly as the lineup and the tie are — see **The draw is played out a name at a
  time** under Tournaments for the app side.
  - **It is the one screen that needs no score message**, where the fixture card falls
    through to the dashes without one. A draw happens before any tie is picked and before
    any game exists, so every word is in its own payload: no names off `teamA`/`teamB`, and
    **no team colours**, because at the moment a name comes out of the hat nobody has been
    given one and inventing one implies an assignment that has not happened. White for who
    was drawn, grey for the words around them. `test_render.cpp` asserts the frame is
    byte-identical with a full board state behind it and with none at all, which is the only
    thing that would notice a colour or a name leaking in from the score.
  - **Precedence is `draw` > `tie` > `lineup` > score.** Nothing underneath a draw can be
    about it, so the order is not a judgement. `Panel.jsx` captions off `boardScreen` rather
    than re-deriving, the rule the tie card already carries.
  - **No cup name on a card that carries a pull, and the opponent travels as structured
    sides.** Measured: 389 bytes worst case of the board's 512, against the lineup's 423 — so
    `MQTT_BUFFER` is untouched, and `test_board_logic.cpp` asserts that ordering rather than
    only the limit. With a 32-unit cup name on top it lands within 25 bytes of the buffer,
    which is tighter than anything else the board receives. Sending the words "plays winner
    of" instead of two sides costs bytes on every message where the board writes them for
    nothing.
  - **The opening card is where the cup name went, and it is free because it carries no
    pull.** A cup *instead of* a round, never as well: measured at 156 bytes worst case, so
    it cannot be the topic's worst case however long the name, and the budget above is
    unmoved. Three things hold that split rather than leaving it a convention of the app's:
    `parseDraw` takes a round **or** a cup where it required a round, `render.h` gives the
    round precedence, and `test_render.cpp` asserts a card carrying both draws as the pull
    alone. **It is the card the board holds longest** — from opening the ceremony to the
    first press — and without it the board sits on last week's score while everyone stands
    around watching the hat.
    - **The cup takes the white row and `DRAW` the grey one, the reverse of the tie card.**
      Both were rendered and compared: the cup on top reads as a title, `DRAW` on top reads
      as a label miscategorising the name under it. Here the fixed word is what never
      varies, so it is what dims — on the tie card that is the cup.
    - **Two rows in the same place as the drum roll**, asserted, so the card does not jump up
      the panel on the first press. It is one screen with the words replaced.
    - **The display keeps the count's one wording**, so this card reads `0 of 11 drawn`
      rather than growing a second phrasing for zero. A row of `11 ENTRANTS` on the panel was
      available and is the progress-line objection again: it would appear only on the short
      shape.
    - **`verify-form-screen.mjs` is the only thing that can see it reach the board**, in the
      block that opens the ceremony before pressing anything — every other assertion drives
      `sendDraw` directly. Verified by mutation: restoring the `at === 0` null fails exactly
      those two assertions and nothing else.
  - **Absent `n` is the beat, not an empty name**, the contract `winner` and the lineup's `p`
    already use — the board draws a drum roll for one and would draw a nameless reveal for
    the other. `parseDraw` keeps `named` for exactly that.
  - **`d` and `e` are published and deliberately not parsed by the firmware.** The panel
    draws no progress line: a completing card needs all four rows, and a count appearing only
    on the two-row shape reads as the panel losing information rather than never having
    offered it. Two fields in `DrawState` that nothing can draw would be worse. The display
    has the room and carries it.
  - **`VERSUS_CHARS` is shared with the fixture card** and `drawVersusRow`/`fitSideTo` are
    the generalised forms of what the tie card had. The draw card is the only caller that
    needs them at a second width — `DRAW_PAIR_CHARS`, 9, the same as the score screen's
    names — because two potential opponents share the last row and stacking them would need
    a fifth row the panel has not got.
  - **No layout id**, like the form screen, the fixture card and the splash, so
    `test-firmware.mjs` carries a fourth standalone assertion that some scene has one.
  - **Measured cost: +1.56 kB gzipped** of the main chunk (100.68 → 102.24) and +0.45 kB
    of CSS, for the whole feature — the ceremony screen, the display card and the
    emulator's half of the panel card. The opening card added **0.14 kB** on top
    (102.24 → 102.38) and nothing measurable in CSS, since it shares the round's rule.
    Duty is **15.5%** across every draw scene and **5.5%** for the opening card, against
    the tie card's 22.7% and `DUTY_CEILING`'s 30%, so this is not a screen the ceiling
    needed re-checking for. Re-measure rather than assuming before adding to it.
- **The no-state dashes carry a line saying *why* they are dashes**, in words: `NO WIFI`,
  `NO BROKER`, `WAITING FOR SCORER`. Three different problems drew the same screen and
  they have three different fixes — the router, the broker, the phone — and this is the
  screen the board sits on from switch-on until the app is opened, **every session**,
  because the LAN broker deliberately runs without `persistence` and a router reboot
  leaves nothing retained to recover. `connectState()` in `hub75.ino` already computed
  all three facts for the splash dot; `renderBoard` takes it as a trailing `connect` and
  no other screen reads it. **All three states confirmed on the panel 2026-08-10** — `NO
  WIFI` with the Beryl off, `NO BROKER` with it up and mosquitto stopped over SSH,
  `WAITING FOR SCORER` once the broker was running, then the score screen when the phone
  published. Stopping mosquitto is the only deliberate way to reach the middle state, so
  it is the reproduction to reach for; a wrong `MQTT_HOST` would need a reflash.
  - **The dot could not have done this job, for two independent reasons.** It is 2px, so
    the whole distinction rests on hue — the channel the app refuses to let anything
    stand on alone — and this screen is read at arm's length while the kit is being set
    up, not at 7m. And `RECONNECT_INTERVAL` gates the first MQTT attempt to t=5000ms
    against `SPLASH_MS`'s 5000, so **the dot can never reach its own third state**; that
    is deliberate and firing earlier would freeze the splash mid-throw, so the words are
    the only place the third state can appear at all. The colour is still there as the
    second channel, which is why `LINK_COLORS` is one array shared with the dot rather
    than a second spelling of the same three states.
  - **The dashes stopped reading the chosen layout**, and that is a deletion rather than
    an exception: `PANEL_SCORE` gives all 32 rows to `DIGITS_BIG`, leaving no row for a
    line, and 150mm dashes against 100mm ones is a distinction with nothing behind it.
    `test_render.cpp` asserts `score-no-state` is byte-identical to `no-state`. The
    scorer's choice is untouched underneath and returns with the first score.
  - **The line is at `LEVEL_LIVE` where the dashes are stale**, asserted through
    `hasColor` rather than off `level`, because scaling it with them is a one-character
    change no count of lit pixels would catch. Dim means "nobody is feeding this any
    more", which is what the dashes say and what this line does not.
  - **Three states, three screens, told apart with the colour thrown away.** The check
    compares lit pixels and not bytes — three identical words in three hues would pass a
    `memcmp`. Duty is 7.6% at the widest, against `DUTY_CEILING`'s 30%, and the whole
    feature cost **+0.14 kB gzipped** of the main chunk with no CSS change.
  - **The emulator asks two questions like the board does, and `navigator.onLine` is the
    first one.** `connectState()` reads `WiFi.status()` and then the MQTT client; a
    browser's equivalent of the first is `navigator.onLine`, which answers the same
    question — is this device attached to a network at all — and is equally silent about
    what is reachable on it. **A failed socket is not a missing network**: mapping
    anything-but-connecting to `LINK_NO_WIFI` shipped first, and because mqtt.js cycles
    offline → connecting → error against an unreachable broker, a laptop that never lost
    its network watched the board flip between `NO WIFI` and `NO BROKER` — the exact
    confusion the line exists to remove, on the screen that removes it. It is tracked
    through the `online`/`offline` events rather than read once, because with the broker
    already unreachable the MQTT status is identical before and after the network goes,
    so nothing else would re-render the line.
  - **`verify-panel.mjs` is the only thing that can see any of this**, since `render.h`
    draws from an argument and whether `Panel.jsx` passes the right one is a crossing no
    framebuffer comparison reaches. It pins **both** branches — `no broker` held across
    12 samples over 3s, which is what makes it an assertion about the state rather than
    about where in the reconnect cycle the read landed, and `no network` under
    `context.setOffline(true)`, the only way to reach the screen a board that never
    joined the AP would show. Read off the canvas's `aria-label`, which is the same
    `connect` the framebuffer was drawn from and something a scan of a 5x7 row cannot
    spell; the pixel assertions above it are what tie that label to what is lit.
    Verified by mutation: the socket-only mapping fails exactly that one assertion, 12
    of 12 samples wrong. Note the fix also moved that file's blank-row sample from row 0
    to row 31 — row 0 is where the line goes, so it had been taking the status line as
    the brightness floor.
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
  - **The lit-pixel duty metric and current diverge by ~2.5x**, because these colours are
    never white *and* the library maps every channel through CIE1931 before it drives the
    LEDs. Measured on a start-of-game screen: 12.6% lit, 7.8% per-channel linear, **5.1%
    after the curve** — so the linear figure this note used to give (~1.7x, `form-worst` at
    28.5% lit against 16.6%) was itself over-stating current by ~1.5x. `DUTY_CEILING` is
    conservative on both counts, and an antialiased screen can breach it while drawing
    less current than one that passes. Don't redefine the metric to make a screen fit — the
    splash respects the check as written. If it is ever revisited, that is its own change.
  - **The chalk filter is off and that is not a loss at this size.** A 1-2px stroke has no
    interior for a dither pattern, so `feTurbulence` only erodes and wobbles the strokes,
    fighting the antialiasing. Checked at 3x dot size, not assumed.
  - **`drawSplash` takes its two colours as arguments and picks nothing.** `render.h`
    has to give the same frame for the same inputs or the pixel check cannot hold it, so
    the randomness lives in `hub75.ino` (`esp_random()`, because `random()` is seeded
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
  - **The connect indicator is splash-only, and the no-state screen says it in words
    instead.** Once a score is up, the whole panel dimming already says the link went, so
    a corner dot repeats it — and `full` has no corner to spare, its name row spans the
    width. The dashes are the exception, below.
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
