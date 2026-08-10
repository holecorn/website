# Firmware

One target: **`firmware/hub75/`** — 2x Waveshare P5 64x32 chained to 128x32
(640x160mm), Adafruit MatrixPortal S3, ESP32. Score *and* team names in team
colours. **Wokwi has no HUB75 part**, so it is verified by a host renderer
instead. Full reasoning for everything here is in `README.md`.

A second SevSeg target in `firmware/wokwi/` was removed on 2026-07-27, once the two
sketches had diverged enough that simulating it proved nothing about what
ships. The cost was that nothing exercised WiFi or MQTT until the board was on the
bench — the host suites stop at parsing, layout and duty. **That gap is now closed
by hardware, not by a test**: first boot on 2026-08-03 connected, subscribed and
recovered the retained state, so the network stack is evidenced but still
unregression-tested. **Don't reintroduce a second target to get coverage back**: a
divergent copy reads as coverage without being it.

Reflashed 2026-08-10 with the no-state link line, and **all three of `connectState()`'s
branches are now evidenced on the panel**: `NO WIFI` with the Beryl off, `NO BROKER` with
the Beryl up and mosquitto stopped, `WAITING FOR SCORER` once it was running, then the
score screen when the phone published. That is the first time the third state has been
seen at all — the splash dot cannot reach it, since `RECONNECT_INTERVAL` gates the first
MQTT attempt to t=5000 ms against `SPLASH_MS`'s 5000.

**Stopping mosquitto over SSH is how the middle state is reproduced**, and it is worth
knowing because nothing else produces "associated but no broker" deliberately — pulling
the router gives the first state and a wrong `MQTT_HOST` needs a reflash to change.

**Serial silence means healthy, not dead.** The firmware prints only on transitions,
so a connected board is quiet for minutes; a 20-second read proves nothing either
way. Tap RESET with the port open when you need a boot sequence.

## `src/panelRender.js` is a second implementation of `render.h`

The only reason that is allowed is the pixel check. It exists so the panel can be
watched in a browser during a real game (`?panel=1`), which stills can't show.

**It paid for itself at first light.** A one-column artefact on the hardware was
identifiable as a *fault* rather than as how the layout looks, because `?panel=1`
could be held next to the panel and shown to be blank there — which is what pinned
it on `clkphase` instead of on a dead edge pixel or the ribbon. Keep it working:
when the panel and the browser disagree, the browser is the reference.
`test_render.cpp` writes `out/scenes.json` describing every scene it dumped, and
`tools/test-firmware.mjs` renders each through `src/panelRender.js` and compares
framebuffers byte for byte. **Change `render.h` and the JS fails until it matches** —
treat them as one thing in two languages and don't "tidy" either alone. The scene
list lives in the C++ on purpose; a scene table maintained in two languages is the
drift being guarded against.

- **Every division in `panelRender.js` truncates**, because these are `int`
  expressions in C++. `idiv` is load-bearing, not stylistic: at `LEVEL_STALE` the
  blue channel of `#2f80ed` is 55 truncated and 56 rounded, and that one pixel fails
  the check.
- **Labels are UTF-8 byte arrays, not strings**, because that is what reaches the
  board — a 40-byte label is cut mid-character and a name outside the 5x7 font draws
  one `FONT_UNKNOWN` per byte. **Don't "fix" either on the JS side alone**; the
  limitation is the firmware's and the point is to see it.
  - **A missing character draws a dash, not a space.** As a space, two Greek-script
    names lit **13** pixels of the name row against 181 for two Latin ones — a whole
    name vanishing reads as a fault rather than a limitation. Now 103.
  - **The alternatives are all worse.** `.` is one pixel and the panel is read at 7m,
    so nine of them are invisible. `/` is taken — `fitLabel` separates a shortened
    doubles pair with it. `'` is two pixels and sits high, reading as punctuation.
  - **`FONT_UNKNOWN` is emitted by `generate_glyphs.mjs`** into both `glyphs.h` and
    `src/panelGlyphs.js`, because `fontIndex` exists twice (generated into the header,
    hand-written in `panelRender.js`). Written down twice they could drift.
  - Accented Latin degrades readably where a non-Latin script does not: `José` draws
    as `JOS-`. That is why the fixtures carry an accent and deliberately no Greek.
- **`glyphs.h` and `src/panelGlyphs.js` come from one run** of `generate_glyphs.mjs`,
  so the emulator can't quantise the polygons differently. Both checked for staleness.
- **`src/panelPaint.js` is outside the pixel check** — it draws the framebuffer as
  dots, which no framebuffer comparison can see. `tools/verify-panel.mjs` covers it,
  and is the only thing that would notice a blank canvas.
- The emulator exercises publish → retain → subscribe over a real broker, which the
  host suites can't. **It still says nothing about WiFi or PubSubClient.**
- **It ships to everyone**, not behind a lazy boundary: 3.53 kB gzipped of the main
  chunk plus 0.19 kB of CSS, against the 104 kB the mqtt chunk already costs
  `?panel=1`. 4 kB doesn't pay for the boundary. **Re-measure before adding
  panel-side features** rather than assuming it stays small — the second glyph size
  and the score layout together cost 0.66 kB of that. Note `scoreboard.js` imports
  `PANEL_LAYOUTS` from `panelRender.js`, so the glyph tables are reachable from
  `?display=1` too — irrelevant while `Panel` is statically imported, but it would
  defeat a lazy boundary if one were added.

## This directory's shape is the build config

Arduino compiles **every** source file in a sketch folder and takes the main file's
name from the folder. Both facts bite here, and both are fixed by placement rather
than by any setting — so the layout is not tidiness and rearranging it breaks the
build. It compiled for the first time on 2026-08-03 (47% flash, 24% RAM, clean at
`--warnings all`); before that neither the IDE nor `arduino-cli` could open it.

- **`hub75.ino` must keep the folder's name.** Renaming either one alone gives
  "main file missing from sketch". It was `sketch.ino` until that date.
- **`mxconfig.driver = FM6126A` is load-bearing, not a fallback.** Confirmed on
  hardware 2026-08-03: this panel is FM6126A, and without the register init it is
  *completely dark*. Deleting that line looks exactly like a dead panel or a wiring
  fault. It pairs with a physical trap — the controller must go in the socket the
  panel's arrow points *away* from — and **the two mask each other**, so a
  single-variable test reads as a failure while the other is still wrong. See
  `Things that will bite` in `README.md` before debugging a dark panel.
- **Credentials live in `secrets.h`, which is gitignored, and nothing may move them
  back.** This repo is public: a `WIFI_PASS` committed once is in the history forever
  whatever the next commit does. `secrets.example.h` is the tracked template and owns
  `USE_TLS` as well, because which broker fields exist depends on it. It has to sit
  beside the sketch, not in `host/`, since the sketch folder is the include path.
  **Don't add a new credential to the sketch for convenience** — the `#error` behind
  `__has_include` is what makes the absence loud, not the presence safe.
  - **Reading `secrets.h` is denied in `.claude/settings.json`, and that is deliberate**:
    a credential read into context is in the transcript and cannot be taken back.
    Nothing needs it — the compiler reads the file, and no task here does. If a build
    fails on a credential, change it in place or read `secrets.example.h` for the shape;
    don't lift the rule. What it cannot cover is the board *printing* one: `subscribed
    to holecorn/<GAME_CODE>/state` puts the code in any serial log, so treat a bench
    code as disposable.
  - **The consequence for debugging: the network is in the binary, so a WiFi change
    needs a reflash.** Editing `secrets.h` and power-cycling changes nothing, and looks
    identical to a network fault. `esptool` saying **"No changed sectors found"** on
    `hub75.ino.bin` proves the edit is already flashed, since the credentials are baked
    in. Also worth knowing before theorising: the radio is **2.4 GHz only** in silicon,
    and `ensureWifi()` logs transitions only — a board that never associated prints
    nothing, so serial silence is not evidence. `README.md`'s `Things that will bite`
    has the debug-level flag that makes the stack name the reason.
- **`host/` holds the two host suites and the vendored `ArduinoJson.h`, and must not
  be `src/`** — Arduino recurses into `src/` and ignores every other subdirectory,
  which is the whole mechanism. Beside the sketch, `test_render.cpp` and
  `test_board_logic.cpp` collide on two `main()`s.
- **`host/` is also what un-shadows ArduinoJson**, which is the half with no symptom:
  the sketch folder is on the include path, so a vendored `ArduinoJson.h` beside the
  sketch satisfies the firmware's own `#include` and the real library drops out of
  `Used library` silently. The board would then ship a different ArduinoJson than the
  one `MQTT_BUFFER` was sized against. `arduino-cli compile -v` prints
  `Alternatives for ArduinoJson.h` to check.
- **`libraries.txt` lists two libraries nothing here references** — Adafruit GFX and
  BusIO, pulled in by the HUB75 library's own header. Library Manager installs them
  silently and `arduino-cli` does not, which is why they went unlisted until the
  first real compile. Don't prune them for looking unused.
- **`arduino-cli upload` does not work on this board, and what it prints sends you the
  wrong way** (2026-08-10). It dies at `Uploading stub flasher...` with *"A fatal error
  occurred: Serial data stream stopped: Possible serial noise or corruption"*, which
  reads as a cable or a wiring fault. It is neither: the chip is on **USB-Serial/JTAG**
  (esptool prints the mode) and the stub flasher is unreliable over it. `--no-stub`
  connects and writes fine. The whole working recipe:
  1. **Hold BOOT, tap RESET, release BOOT.** Nothing else reliably gets it into download
     mode — `--before default-reset`, `usb-reset` and `no-reset` were each tried against
     a board that had stopped answering, and all three gave *"No serial data received"*.
  2. Call **esptool directly**, not `arduino-cli upload` and not the platform's
     `tools/flasher.py`, with `--no-stub --before no-reset --after hard-reset`. Take the
     five images and offsets from `arduino-cli upload -v`, which prints the command it
     would have run.
  3. **Tap RESET afterwards.** `--after hard-reset` toggles RTS and does not bring it out
     of a BOOT-latched download mode, so the board sits there looking like a failed
     flash. It is enumerating as `ESP32 Family Device` at that point; once the sketch is
     running it presents its own TinyUSB identity, `Adafruit MatrixPortal ESP32-S3`, so
     **that name is how you tell the sketch is up** without opening the port.
  - **Bypass `flasher.py` whenever the flash state is unknown.** All it adds is
    `--diff-with`, which skips sectors matching the copies it saved of the last flash —
    so after an interrupted write it can skip sectors that are actually *erased*. It is
    an optimisation, and a full unconditional write of all five images takes 9 seconds.
  - **An interrupted app write is recoverable and never a brick.** One died 0.6% into
    `0x10000` with the partition already erased: the board would not boot, and BOOT+RESET
    plus a full rewrite fixed it. The ROM loader is in mask ROM, so there is no sequence
    here that removes your way back in — the bootloader at `0x0` and the partition table
    at `0x8000` are separate writes and were verified untouched throughout.
  - **The port name is not a signal, and chasing it wasted the most time.** It was read as
    the root cause — `/dev/cu.usbmodem101` had become the MAC-named
    `/dev/cu.usbmodem68EE8FF39B441`, so esptool looked to be writing to a port that had
    gone. Wrong: download mode came up on plain `usbmodem101` the time it worked. **The
    rename is a symptom of the chip resetting**, and either name can appear.
  - **What actually caused the reset was never established.** A long USB-C cable was
    swapped for the 1 m Apple one *and* the board was put into a clean BOOT-latched
    download mode in the same step, so the fix has two variables in it and neither is
    attributable. The app wrote in 6.8 s clean where it had previously died — suggestive
    of a marginal cable, and not evidence. **Don't record a cause here without re-running
    the long cable against a board that is known to be in download mode.**

## The rest, before touching it

- **`board_logic.h` is deliberately Arduino-free** so it host-compiles against desktop
  ArduinoJson — `host/test_board_logic.cpp` is how `MQTT_BUFFER` was sized rather than
  guessed. Keep parsing and digit formatting there, not in the `.ino`.
- **The panel is sized against 7m, not "as big as possible."** 100mm digits (11.4m)
  and 9-char names clear it, the names marginally. Width buys name length, height buys
  digit height; four digits run out of width first, which is why two rows are dark *in
  the `full` layout*. The `score` layout spends that height, and the only way to spend
  it is to give up the names — the two compete for the same 32 rows, which is the trade
  the two layouts exist to offer.
- **`glyphs.h` is generated** from `src/segments.js` by `generate_glyphs.mjs`, so the
  panel's digits are the browser's geometry rather than a redrawing. The dash for the
  no-state screen is defined in the *generator*, because nothing else needs one.
- **The no-state screen ignores the chosen layout**, because it writes the link state
  across the full layout's name row and `PANEL_SCORE` has no row to spare. It is the one
  screen that answers "is the chain up?" before the phone is out, and it is what the
  board shows every session — the LAN broker runs without `persistence`, so a router
  reboot leaves nothing retained. Detail in `.claude/rules/scoreboard.md`.
- **UP and DOWN step brightness, and that is all they may ever do.** Everything else
  the panel shows is published state, so a local override would fight the app;
  brightness is the one setting with no app-side representation and no retained topic
  to disagree with. `BRIGHTNESS_LEVELS` and `stepBrightness()` live in `board_logic.h`
  so the host suite covers them — nothing reaches `render.h`, so the pixel check is
  untouched.
  - **The range is 40 to 255 and neither end is arbitrary.** The floor is where every
    faint thing was judged: `COVERAGE_FLOOR` drops splash pixels under ~40% *because*
    at brightness 40 they read as off, and a loss pip is one pixel. Neither has been
    seen on hardware, so **a darker step waits until the pip has been eyeballed at
    dusk**, and nothing about power argues against one: measured, the board's draw only
    doubles between 40 and 255, because ~1.95 W of it is a constant brightness cannot
    touch. The ceiling is the power budget — 1.33 A worst case against a 3 A fold-back.
  - **It clamps rather than wrapping**, which is the only reason the step is a tested
    function instead of arithmetic: wrapping puts one press between darkest and 255.
    Not persisted across a reboot — brightness tracks the light on the day, and 40 is
    the step that cannot dazzle.
  - **No on-screen indicator for *brightness***: the panel is the readout, and drawing
    one would put it inside the pixel-checked renderer to say what the eye already has.
    Not a general rule against indicators — the no-state screen's link line is one, and
    it earns its place by saying something the eye *cannot* get from the panel.
- **It runs off a battery over USB-C, so there is no fuse and no supply to size.** A
  5 V/3 A port is itself the current limit and folds back, so a fuse downstream protects
  nothing — the docs said to fuse for the 40 W peak back when mains was assumed, and
  **that advice is gone.** Overrunning the budget trips the port rather than being
  unsafe, and the layout measures 44% of it at full brightness, so power does not
  constrain `PANEL_BRIGHTNESS` either. **Feeding the board from an AC outlet through a
  5 V brick is the one change that removes that bound** — easy to do by accident now the
  supply is a station with sockets on it.
- **Board power is `1.95 W + 40 W x CIE-duty x brightness/255`, measured 2026-08-10.**
  Two things a duty-only model gets wrong, both worth knowing before quoting a figure:
  there is a **~1.95 W constant** (the ESP32 plus the panels' own scan) which at boot
  brightness is six times the lit-pixel term, and current follows the **CIE1931** curve
  the library applies, not a linear channel share — so raw `lit%` over-states draw by
  ~2.5x. **Yellow is the expensive team colour** (CIE share 0.49 against green's 0.17),
  so a worst case is drawn in two yellows. Full reasoning in `README.md`'s `Power`.
  - **The constant term is what retired two risks this file used to carry**: the board
    refusing to start under switch-on load (it has started on both supplies since
    2026-08-03), and the 1.4%-duty no-state screen being too quiet to keep the supply
    awake — the board cannot draw under ~390 mA whatever is on screen, against a 100 mA
    cutoff. **The 10k pull-up on OE this used to hold as a last-resort fix is gone
    entirely**: it was for a bright pre-`begin()` window that this panel does not have —
    see the FM6126A note below.
- **One USB-C cable feeds everything, through the controller.** The MatrixPortal's two
  M3 standoffs either side of the HUB75 socket are USB power brought straight out, and
  Adafruit's instruction is to power from USB and hang the matrix off them — so there
  is no 5 V bus, no chopped lead, no lever connectors, no second port.
  - **They are outputs only. Never feed 5 V in.** Anything in the USB port at the same
    time can damage the board, and flashing always puts something there — and the
    casualty may be the laptop, since the standoffs *are* VBUS with no diode between.
  - **Back-feeding looks identical to the correct wiring** (same screws, same wires,
    opposite direction) and works until the first flash. See `How to destroy it` in
    `README.md`. They take crimped spade terminals, not bare wire under the screw, and
    the lug end is the one place in the build where polarity is unprotected.
- **Two independent bounds make that safe, and one is fragile.** Adafruit say
  multi-panel builds need their own supply, but that assumes ~4 A per panel all-white,
  as does the vendor's "≤20 W per panel". This layout measures 11.7% CIE-duty worst
  case, so **1.33 A** for both at full brightness — bound one, asserted by
  `test_render.cpp` as `DUTY_CEILING` (30% of *lit pixels*, a deliberately conservative
  proxy), because nothing else would notice a layout change that filled the panel.
  Bound two is the port folding back at 3 A, so no fault can pull the 8 A the panels are
  rated for. **Swapping USB-C for mains or an AC socket removes bound two**, and then
  the panels must be fed directly.
- **A brighter panel-side effect is limited by duty x brightness, not duty.** At
  `PANEL_BRIGHTNESS = 40` even an all-white flood is 1.64 A and fits; only high duty
  *and* daylight brightness together exceed the port. If it is ever needed the answer
  is a PD bank with a buck converter feeding the panels directly — not mains, and not
  bulk capacitance (a 50 ms flood would want 0.5 F). **But the retained whole-state
  message model blocks it first**: an animation is an event, a retained `fourBagger`
  replays on every display reboot, and a four bagger is not derivable from the
  published score under cancellation.
- **A generic HUB75 panel does not power up dark. This one does** — observed 2026-08-10,
  and it retires a risk this file used to carry. The reasoning was that OE is active low,
  so from power-on until `panel->begin()` the outputs are enabled over random
  shift-register state at full drive with no `PANEL_BRIGHTNESS` applied; that was called
  the likelier reason a bank might refuse to start the board, likelier than capacitor
  inrush, with a 10k pull-up on OE as the fix.
  **It does not apply to this panel, and the reason is already in this file one section
  up:** it is FM6126A, and without the register init it is *completely dark*. So the
  window before `begin()` is not a bright one — no init, no light, whatever OE is doing.
  Seen directly: a board left with an erased app partition, so nothing ever ran, sat
  **blank** rather than showing random full-drive noise, and stayed enumerated on USB
  throughout rather than browning out.
  - **So there is no OE pull-up to consider fitting, pre-emptively or as a first fix.**
    Both places this file recommended one were reasoning from the generic case.
  - **And a flash is a low-current operation, not a high-current one.** The panel is dark
    for all of it, which is the opposite of what was assumed while debugging the failed
    flash above — a brownout theory was built on the panels being at full drive during a
    1 MB erase, and the blank panel is what killed it. Worth remembering before reaching
    for power to explain a flashing fault.
- **Nothing in `loop()` may block, but not for the reason you'd guess.** The panel
  refreshes from DMA in hardware, so blocking would *not* flicker the digits — the
  `millis()` timers are there because a blocking reconnect stalls MQTT, which is what
  makes the board miss a round.
  - **`RECONNECT_INTERVAL` also gates the *first* MQTT attempt, and that is why the
    splash's connect dot can only ever reach amber**: the stamp starts at zero, so the
    attempt lands just after t = 5000 ms, exactly as `SPLASH_MS` expires. It reads like
    an off-by-one worth fixing and is not — firing earlier puts a blocking
    `client.connect()` inside the 3.58 s of splash throws and freezes the mark
    part-thrown. The dot is worth less than the animation, so **read red vs not-red off
    it and nothing more.**
    - **The screen after it is where the link state is actually readable now.** The
      no-state dashes carry `NO WIFI` / `NO BROKER` / `WAITING FOR SCORER` in words, off
      the same `connectState()`, which is the one place the third state can appear —
      see `.claude/rules/scoreboard.md`. So this gate costs nothing that matters, and
      **fixing it is still not worth the splash.**
- **PubSubClient's 256-byte default is too small.** ASCII names land ~251 bytes
  including topic and headers and non-ASCII reach ~379, because the app caps names at
  16 UTF-16 code units rather than 16 bytes. Oversized messages are dropped silently,
  with no error to notice. `test_board_logic.cpp` measures this and
  `npm run test:firmware` runs it. The budget is why `src/scoreboard.test.js` asserts
  the payload with `toEqual`: a field nothing renders should fail rather than quietly
  ship.
- **Free Wokwi projects are public** — no real broker credentials in one.
