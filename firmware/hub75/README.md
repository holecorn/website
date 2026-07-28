# firmware/hub75

The HUB75 build of the external scoreboard: **2 x Waveshare RGB-Matrix-P5-64x32
chained into one 128x32 canvas**, 640 x 160 mm, driven by an Adafruit
MatrixPortal S3.

**The only firmware target.** A SevSeg build lived alongside this one in
`firmware/wokwi/` until 2026-07-27, kept because Wokwi has no HUB75 part so it
was the only target that could be simulated. It was removed once the two
`sketch.ino` files had diverged far enough that the simulation stopped being
evidence: this one gained `ensureWifi()`, a non-blocking `setup()` and
`liveWithGrace()`, and that one still blocked in `setup()` waiting for WiFi. A
green simulator run said nothing about the code that ships, which is worse than
having no simulator, because it reads as coverage. `board_logic.h` and
`test_board_logic.cpp` moved here when it went.

**Nothing now exercises WiFi, MQTT or PubSubClient before the board is on the
bench.** The host suites cover parsing, buffer sizing, layout, bounds, duty and
`liveWithGrace()`; the network stack is first tested at first power-up. That is a
known gap, not an oversight.

The browser emulator (below) narrows it a little and must not be mistaken for
closing it: over a real broker it exercises publish → retain → subscribe →
this layout, so a payload change that breaks the panel shows up without hardware.
It says nothing about the ESP32's WiFi stack or PubSubClient, which are the parts
that will actually fail first.

## Why this size

Sized against 7 m worst case, 4 m typical — spectators are across the court or
standing at the boards.

| | | reads to |
| --- | --- | --- |
| Digits | 20 px = 100 mm at P5 | **11.4 m** |
| Names | 9 chars, 5x7, 35 mm cap | **4–9 m**, model-dependent |

The digit figure uses the ratio this project already anchors on elsewhere —
35 mm read at 4 m, so 1:114 — and clears 7 m comfortably.

**The names do not have one honest number.** By that same 1:114 cap-height
rule a 35 mm glyph reads at 4.0 m, which fails the requirement; by a
pixel-pitch rule (about 2 arcmin per pixel, which is the fairer test for a
bitmap) it reads at 8.6 m, which passes. The truth depends on contrast and on
the fact that 5x7 strokes are 1 px against the digits' 2 px. Treat names as
**marginal at 7 m and fine at 4 m**, and check them on the real panel before
trusting them — this is the one figure here that is a rule of thumb rather
than a measurement.

Panel *width* buys name length; panel *height* buys digit height. Four digits
side by side run out of width first, which is why rows 30-31 are left dark —
the spare height would buy nothing.

## What it shows

```
   NU/TAU      V      ALPHA/PHI
                              ---    <- rule: who throws, and which partner
     17         R9          20
               TO 21
```

- **A "V" separates the two names.** Reserving room for it is why a team gets
  nine characters rather than ten. It draws uppercase because the font is
  uppercase-only — `fontIndex` folds case so a name typed in mixed case renders
  consistently, and adding a lowercase `v` glyph would put a small letter
  inside anyone's name containing one.

- **Names join with `/`, not `" & "`.** The app's separator costs three of the
  nine characters a team gets; a slash costs one, which is the difference
  between most pairs fitting whole and being cut. What still overflows shortens
  *both partners* to the longest prefix that fits — truncating the tail instead
  would take all of the second player's name and none of the first's. Each
  team's label is fitted on its own, so a long name opposite does not shorten a
  short one.
- **The score pairs sit at `SIDE_MARGIN`, not on the edges**, so they line up
  under the names centred above them. Perfectly centred would squeeze the
  middle column; see the constant's comment for the 4px trade.
- **A rule under the name marks who throws first**, and in doubles marks *which
  partner* — `round % 2`, mirroring `activeIdx` in `App.jsx`. Derived rather
  than published, because the app derives it the same way. It comes off once
  the game is won.
- **No in-round bag state.** `CLAUDE.md` explains why the display shows the
  logged score only. Bag positions were considered: they are raw state rather
  than a misleading provisional total, so the reasoning there does not forbid
  them, but they would cost the one-retained-message-per-round model that makes
  a dropout harmless.

## Assembling it

Nothing has been built, so this is the intended shape rather than a record of
one.

```
  FRONT   640 x 160 mm active
 +-----------------------+-----------------------+
 |      NU/TAU     V    |    ALPHA/PHI          |  160 mm
 |        17      R9     |       20              |
 |               TO 21   |                       |
 +-----------------------+-----------------------+
   panel A (left = teamA)  panel B (right = teamB)

  BACK
 +-----------------------+-----------------------+
 |  [IN] <--16p ribbon-- [OUT]     [HUB75 IN]     |
 |                       |              ^         |
 |                       |   +5V--[MatrixPortal]--GND
 |    [VH4 5V]           |    |     [USB-C]  |    |
 +-------^---------------+----|--------|-----|----+
         |                    |        |     |
         +--------------------+--------|-----+  a pair to each panel
                                       |
                                  power bank  (one port, 15 W)
```

- **One cable feeds the whole board.** The MatrixPortal's two M3-threaded
  standoffs, either side of the HUB75 socket, are USB power brought straight out:
  *"power from USB and then connect the matrix power inputs to these terminals"*
  is Adafruit's own instruction. So the bank feeds the controller over an ordinary
  USB-C cable and both panels hang off those terminals. **They are outputs only** —
  never feed 5 V *into* them, because anything in the USB port at the same time
  can damage the board, and flashing always puts something in the USB port.
- **They take crimped spade terminals, not bare wire under the screw.** Each
  panel's supplied lead bolts on, two spades stacked per M3 screw.
- **One data chain, and a pair of conductors to each panel.** The ribbon carries
  data only. It *does* tie the panels' grounds together, but that is a signal
  reference, not a conductor rated to carry a panel's supply current back, so
  each panel takes its own return rather than borrowing the ribbon's.
- **The controller needs no bracket.** Its 2x10 socket keys straight into panel
  A's HUB75 port, so it hangs off the back of the panel.
- **The panels need a backer.** They butt edge to edge and will not stay aligned
  on their own — 6 mm ply at roughly 660 x 180 mm, M3 into the panels' own rear
  mounting holes (not to be confused with the MatrixPortal's power standoffs),
  with the controller and cabling in the depth behind. The seam is the part to
  get right: a 1 mm gap reads at 4 m as a dark column through the "V".
- **Mount it at eye height beside the court.** A speaker-stand flange on the
  backer is fewer parts than a frame and a stand; a ground stake means the board
  is read from below and gets kicked.

Order of work, because none of the firmware has ever run: get **one** panel lit
on the desk and flash it there, so each of the failures in Things that will bite
has only one possible cause. Then add the second panel — if team B lands on the
left, swap which panel the controller is in. Then the backer, then the mount.

### Parts

| | |
| --- | --- |
| 2x Waveshare RGB-Matrix-P5-64x32 (SKU 25848) | bought |
| Adafruit MatrixPortal S3 | bought |
| USB power bank, any that holds 5 V at a few hundred mA | Belkin BoostCharge 10K, to hand |
| A USB-C cable | the one in the bank's box |
| Backer, ~660 x 180 mm of 6 mm ply | offcut; seal it or use exterior ply |
| Spade terminals on the panels' power leads | check the box |
| M3 hardware, panels to the ply | needed |

The 16 AWG silicone and the Wago 222s are not needed after all — this wiring has
nothing to fan out, and no chopped lead to join. They were bought for a design
that ran a 5 V bus from a second bank port, which powering through the controller
made unnecessary.

Each panel ships with its own VH4 power lead and a ~30 cm 16p ribbon, per the
vendor listing — so two panels cover both power feeds and the one chaining
ribbon, with a spare. Worth confirming against the actual box before ordering
anything to fill a gap that is not there.

## Building the sketch

Arduino IDE with the ESP32 board package; see `libraries.txt` for the libraries
and the versions this was written against. Nothing here has been compiled for
the board or run on hardware.

**Flash with everything still connected.** The panels stay bolted to the
standoffs; you swap the bank out of the USB-C socket and the laptop in. There is
only one USB-C connector, so with the panels fed *from* the board rather than
into it there is nowhere for a second 5 V source to be — the collision described
in How to destroy it is not something to remember to avoid, it is something the
hardware cannot express.

The laptop is then paying for the panels: ~185 mA at `PANEL_BRIGHTNESS = 40`,
~980 mA at full brightness. Fine for a USB-C port advertising 3 A, but above the
900 mA a bare USB 3 port guarantees, so a port that cuts out mid-flash is a
budget problem rather than a fault — as is the power-up window, which spikes
harder than any firmware asks for. **Do not fix that by putting the bank on the
standoffs to take the load off**; that is back-feeding, now with a laptop on the
other end. Lower the brightness or use a powered hub.

## Host renderer

There is no simulator, so the layout is checked by compiling `render.h` on the
host and dumping the framebuffer. This is the same code the panel runs, not a
restatement of it.

```bash
npm run test:firmware      # both host suites + the glyphs.h drift check; CI runs this
```

That fetches `ArduinoJson.h` if it is missing and compiles with `-Werror`. To
see the panel rather than just assert on it:

```bash
cd firmware/hub75 && mkdir -p out
clang++ -std=c++17 -Wall -Wextra -I. -o /tmp/render_test test_render.cpp
/tmp/render_test && node preview.mjs
```

The desktop `ArduinoJson.h` sits in this directory and is gitignored, so `-I.`
covers it. Output lands in `out/`, also gitignored.

`test_render.cpp` asserts as well as renders: nothing may be drawn outside the
panel (on real hardware that wraps onto the wrong module), the winner flash must
blank the winning pair without blanking the rest, and an out-of-range score,
round or name must stay on the panel.

Those are stills. To watch the panel follow a **live game**, add `&panel=1` to a
display link and use the browser emulator — `src/panelRender.js`, which
`npm run test:firmware` holds pixel-identical to `render.h` over every scene
`shot()` dumps. See "Emulated in the browser" below.

## Emulated in the browser

`src/panelRender.js` is a JavaScript port of `render.h`, so the panel can be
watched during a real game rather than only rendered as stills. That makes it a second
implementation of working code, which is how the deleted `firmware/wokwi/` target
started going wrong — so it is not maintained by inspection. `test_render.cpp`
writes `out/scenes.json` describing every scene it dumped, and
`tools/test-firmware.mjs` renders each one through `src/panelRender.js` and
compares the framebuffers **byte for byte**. One differing pixel fails CI with the
coordinate and both colours.

The C++ is the source of truth for the scene list, deliberately: a table of
scenes maintained in two languages is the drift the check exists to catch.

**What it pins is `renderBoard`.** Scenes are recorded from an already-parsed
`BoardState`, so the coercions ported from `parseBoardState` — the ones that turn
raw JSON into that struct — are never fed raw JSON by it.
`src/panelRender.test.js` covers that half against what `board_logic.h` does.
The gap was measured, not assumed: before the `overflow` and `ruled-pair-even`
scenes were added, deleting
the 0..99 score clamp, the "TO 99" cap, or the doubles partner parity all passed
the pixel check.

Two things follow from matching C++ that look wrong in JavaScript:

- Every division truncates. The layout constants depend on the remainder being
  thrown away, and `scaled()` dims by integer division — at `LEVEL_STALE` the
  blue channel of `#2f80ed` comes out 55, where rounding would give 56. That one
  pixel is enough to fail the check, which is how it was confirmed to be
  load-bearing.
- Labels are handled as UTF-8 **bytes**, not JavaScript strings, because that is
  what reaches the board. A name the 5x7 font has no glyph for renders as spaces
  and a 40-byte label is cut mid-character — both faithfully, rather than being
  quietly fixed on one side only.

`glyphs.h` and `src/panelGlyphs.js` are emitted by the same run of
`generate_glyphs.mjs`, so the emulator cannot quantise the digit polygons even
slightly differently from the panel.

The canvas drawing is separate, in `src/panelPaint.js`, and is *not* covered by
the pixel check — it is what turns a framebuffer into dots on screen.
`tools/verify-panel.mjs` covers it in the browser.

## Glyphs are generated

`glyphs.h` comes from `src/segments.js` and `tools/panel-preview/font5x7.mjs`,
so the panel's digits are the browser's geometry rather than a redrawing of it.
Rasterising tests each pixel centre against the real polygon, so the header
holds the quantisation the panel will actually show.

```bash
node firmware/hub75/generate_glyphs.mjs
```

Re-run it after changing either source, or after changing `DIGIT_W`/`DIGIT_H` —
which is what you would do to move to a 128x64 panel later. Forgetting is
covered: `npm run test:firmware` regenerates and fails if the committed header
differs, so a change to the browser's digit geometry cannot silently stop
matching the panel.

One divergence worth knowing: the dash shown before any state arrives is
**defined in the generator, not in `segments.js`**. The browser display never
needs one, so the panel is the only caller. A regression test covers it, because
an empty dash glyph means a blank board before the first message, which reads as
broken rather than waiting.

## How to destroy it

`Things that will bite` below is about the board not working. This is about it
not surviving. Ordered by how likely each is in *this* build rather than in
general.

- **Spade terminals on the wrong standoffs.** The only unprotected polarity in
  the whole assembly. The VH4 at the panel end is keyed and cannot go in
  backwards; the lug end has nothing stopping it. Reverse-biasing the driver ICs
  is normally fatal and immediate, for both panels at once. Meter it before every
  power-up until the leads are labelled.
- **Back-feeding the standoffs.** They *are* USB VBUS — Adafruit say power
  "connects directly to these pads", with no diode or fuse between. Feed 5 V in
  and the USB-C connector is energised from outside; plug into a laptop to flash
  and two independent 5 V sources are hard-wired together, relying on the host's
  port protection. **The wiring looks identical to the correct arrangement** —
  same screws, same wires, opposite direction — and it works fine right up until
  the first time you plug in USB, which is what makes it worse than an obvious
  error. The casualty may be the laptop, not the board.
- **Hot-plugging anything.** Ribbon or lugs, with power on. Signals arriving at
  unpowered chips get shunted through ESD diodes not sized for it.
- **A misaligned panel-to-panel ribbon.** The controller's 2x10 socket keys into
  a 2x8 so it cannot be off by one, but the ribbon between the panels has no such
  help if its shroud is unkeyed.
- **M3 screws that are too long.** They bottom out in the panels' rear standoffs
  and crack the PCB, or push into the matrix from behind. Measure the depth
  before choosing screws, and don't over-tighten into thin board.
- **The wrong voltage**, which is currently unreachable — nothing in the build can
  produce anything but 5 V. It only becomes possible the day a PD trigger and buck
  converter appear, and then it is instant and total.

What is already protecting you, which is worth knowing before being too careful:
the bank folds back at 3 A, so a dead short across the rail trips it rather than
cooking a trace; one cable means the panels and controller are never powered
independently; the VH4 is keyed; and ply is non-conductive, so bolting the panels
to it cannot short their rear traces the way a metal backer could.

## Things that will bite

- **The library has no MatrixPortal preset.** `platform_detect.hpp` has no
  `#ifdef` for the board, so it falls through to the generic ESP32-S3 defaults —
  and not one of those pins matches the MatrixPortal S3. `sketch.ino` therefore
  sets the pinmap explicitly, from Adafruit's own Protomatter mapping. Leaving
  it to the defaults gives a dark panel and no error, which is a bad evening.
  Don't "simplify" the pin block away.
- **Driver IC is unpublished.** Waveshare do not state it. If the panel shows
  nothing or garbage on first power-up, uncomment
  `mxconfig.driver = HUB75_I2S_CFG::FM6126A;` in `setup()` before assuming a
  wiring fault.
- **Chain direction.** If the two halves come out swapped — team B on the left —
  that is not a bug, it is which panel the controller is plugged into. Swap the
  ribbon.
- **Power does not chain.** The HUB75 ribbon carries data only, so each panel
  takes its own 5 V through its VH4 connector — one data chain, two power feeds,
  plus the controller. The VH4's 4 A is the panel's rating, not a draw to
  provision for; see Power for what this layout actually pulls.
- **1/16 scan, so no E pin**, and no `VirtualMatrixPanel` remapping. That is the
  reason this panel was chosen over an outdoor 1/8-scan one.

## Spotty signal

The board is fed from a phone hotspot, so the network is expected to vanish and
come back — not just the broker.

- **`setup()` does not wait for WiFi.** `loop()` owns reconnection via
  `ensureWifi()`, so blocking in setup would only hang the board on dashes when
  the hotspot is not up yet. Don't "fix" it back to a blocking wait.
- **MQTT is only attempted when WiFi is up**, rather than retrying against a
  dead network.
- **`liveWithGrace()` holds the last-known-live state for `LIVE_GRACE_MS`.**
  Without it the board dims the instant its own socket drops, so patchy signal
  makes it flicker between bright and dim every minute. The grace is shorter than
  a round, so a genuinely dead link still dims before the next score was due.
  It lives in `render.h`, not the `.ino`, so `test_render.cpp` can cover it —
  including the `millis()` wrap, which a signed comparison would get wrong and
  which would show up as a board stuck dim for 49 days.

Nothing here needs a resync protocol. The app stores every payload in `latest`
*before* checking whether it is connected and republishes on each reconnect, and
messages are retained, so a round scored during a dropout arrives when signal
returns and a rebooting board recovers on its own.

The failure this cannot fix: **an iPhone hotspot switches off when nothing is
connected to it.** If the board is the only client and it drops, the hotspot
sleeps and the board can never get back on. Keep a second device on the hotspot,
or leave the Personal Hotspot settings screen open on the scoring phone.

## Power

Duty is measured by counting lit pixels in the host renderer's own framebuffer,
so it tracks the real layout — re-run `test_render.cpp` after changing it, or
these go stale (they did once already, when the versus mark and target line
were added).

Watts are derived, not measured: `40 W peak x duty x 0.55`, where 0.55 is the
share of a white pixel's three channels that a team colour actually lights
(`#2f80ed` is 0.54, `#eb5757` 0.53). The 40 W is the vendor's 20 W per panel.

| Scene | Duty | Derived average |
| --- | --- | --- |
| Normal play | 12.2% | ~2.7 W |
| Start of game | 9.3% | ~2.0 W |
| Winner flash | 10.4-12.8% | ~2.3-2.8 W |
| Worst case (88-88, full names) | 19.8% | ~4.4 W |

At `PANEL_BRIGHTNESS = 40` of 255 those fall further, assuming the library's
brightness is linear — which is unverified. None of this has been checked
against hardware.

### Running off a power bank

The board is fed from a **USB power bank**, not a mains supply — a Belkin
BoostCharge 10K, which gives **15 W shared across all three ports** (2x USB-A at
12 W, 1x USB-C at 15 W). Nothing depends on that model beyond the 15 W; any bank
that holds 5 V at a few hundred milliamps without shutting down will do, and
capacity is the least interesting of its specs. That one number settles most of
the power design:

- **No fuse.** The bank is the current limit and it folds back rather than
  burning, so a fuse downstream of it protects nothing the source does not
  already protect. This file used to say to fuse for the 40 W peak; that was
  written when a mains brick was the assumption, and it is wrong here.
- **Overrunning the budget trips the bank off, it does not start a fire.** The
  question is whether the board stays up, not whether it is safe — which is why
  the sizing below is about headroom and runtime rather than worst-case peak.
- **The bank does not constrain brightness.** Even at a full 255 the worst case
  uses a third of the budget, so `PANEL_BRIGHTNESS` can be raised for daylight
  without revisiting the supply. It is low for evening play, not for power.
- **One port, one cable, no bare wires.** Everything runs through the controller
  and out of its 5 V terminals (see Assembling it), so nothing here needs a
  chopped lead or a PD trigger board. A second port would buy no current anyway —
  the 15 W is shared across the bank however it is split.

All of it goes through the one USB-C cable. Runtime, against ~30 Wh usable (10,000 mAh at 3.7 V is 37 Wh, less an assumed
20% conversion loss) and a ~0.5 W estimate for the ESP32-S3 with WiFi up:

| | Board total | Current at 5 V | Runtime | Share of 15 W |
| --- | --- | --- | --- | --- |
| Normal play at brightness 40 | ~0.9 W | ~185 mA | ~32 h | 6% |
| Normal play at full brightness | ~3.2 W | ~640 mA | ~9 h | 21% |
| Worst case at full brightness | ~4.9 W | ~980 mA | ~6 h | 33% |

A session is a couple of hours, so runtime is not the constraint either. Two
things might be, and both want an inline USB meter at first power-up:

- **The board may not start at all, and there are two mechanisms.** One is
  inrush: two panels' bulk capacitance charging at switch-on draws far more than
  any running figure, and a bank that latches its over-current protection will
  refuse. The other is worse and more likely — **a HUB75 panel does not power up
  dark.** OE is active low, so until the controller drives it the outputs are
  enabled over shift registers holding whatever random state they came up in, at
  full drive current and before `PANEL_BRIGHTNESS` exists. That window runs from
  power-on to `panel->begin()`, which is an ESP32-S3 boot away. Both look exactly
  like a wiring fault and neither is one. The documented fix for the second is a
  **10k pull-up on OE**, holding the outputs off from the instant power appears —
  earlier than any firmware can. Worth trying before buying a bigger bank.
- **The idle screen may be too quiet to keep the bank awake.** Banks shut down
  below roughly 50-100 mA. The no-state screen is **1.4% duty** — four grey
  dashes — which at brightness 40 is about 12 mA of panel, leaving the whole
  board near 110 mA and most of that the controller. Above the usual cutoff, but
  not by much, and it is the state the board sits in *before the first score* —
  exactly when it gets set up and left alone. If it proves marginal, charge the
  scoring phone from the same bank: that loads the bank, and the phone is the
  hotspot so it is on site anyway. Cheaper than a dummy load.

### Is the vendor's 20 W per panel a problem through the controller?

It is the obvious objection to running everything through the MatrixPortal —
2 x 20 W is 8 A at 5 V, which no USB-C connector should see. It is not a problem
here, for two separate reasons, and the second is the one that actually protects
the board:

| | | | of vendor max | of bank |
| --- | --- | --- | --- | --- |
| Vendor max, both panels | 40 W | 8.00 A | 100% | 267% |
| What the bank will supply | 15 W | 3.00 A | 38% | 100% |
| Our worst case, full brightness | 4.9 W | 0.98 A | 12% | 33% |
| Normal play at brightness 40 | 1.2 W | 0.24 A | 3% | 8% |

- **20 W per panel is an all-white figure**, and this layout is never near white —
  19.8% duty at worst, measured from the renderer's own framebuffer. That is what
  puts the real draw at ~1 A rather than 8 A. `test_render.cpp` **asserts** a 30%
  ceiling across every scene rather than just printing the number, because the
  power design depends on it and nothing else would notice a layout change that
  filled the panel.
- **The bank physically cannot deliver 8 A.** It folds back at 3 A, so even a
  firmware fault that lit every pixel could not pull more than that through the
  connector — and 3 A is within a USB-C receptacle's rating. The current-limited
  source is the protection, which is the same reason there is no fuse. A bright
  screen would brown the board out and reboot it, not damage it. This is not a
  spare bound either: the power-up window above is exactly a case where the panel
  lights arbitrarily at full drive with no firmware in control of it.

So the duty bound keeps it comfortable and the bank's bound keeps it safe. Note
what that argument does *not* survive: a mains supply. Swap the bank for a 5 V/8 A
brick and the second bound disappears, at which point the panels must be fed
directly and the 20 W rating starts to matter.

One thing worth watching on the bench, because it sits outside both bounds:
`setup()` calls `panel->begin()` before `setBrightness8()` and `clearScreen()`, so
there is a brief window where the DMA is scanning an uninitialised framebuffer at
default brightness. If that window shows bright garbage it is also a current
spike. Clearing before setting brightness would shorten it; whether it matters at
all is a question for the meter.

### If a brighter effect is ever wanted

The obvious candidate is a four-bagger flash to match the app's. The limit is
**duty x brightness**, not duty, and there is more room than the 30%
`DUTY_CEILING` suggests — that ceiling protects today's assumptions, not a hard
electrical wall.

| | brightness 40 | 128 | 255 |
| --- | --- | --- | --- |
| Today's worst case, team colour | 0.14 A | 0.44 A | 0.87 A |
| Half the panel, team colour | 0.35 A | 1.10 A | 2.20 A |
| Half the panel, white | 0.63 A | 2.01 A | **4.00 A** |
| All-white flood | 1.25 A | **4.02 A** | **8.00 A** |

Bold exceeds the bank's 3 A. At the current brightness the whole panel could go
white and still draw 1.25 A, so an evening-brightness effect needs nothing new.
Only high duty *and* daylight brightness together break it.

Two dead ends worth not rediscovering:

- **Capacitance cannot ride out a flash.** Even 50 ms of full flood needs 0.5 F
  for a 0.5 V droop, and 500 ms needs 5 F. Supercapacitor territory, not bulk
  electrolytics.
- **Mains is not the answer either.** The ceiling is the USB *5 V rail* at 3 A,
  not the bank's energy. A 65 W PD bank with a 12 V trigger and a 5 V/10 A buck
  supplies the full 8 A and stays portable — but the panels must then be fed
  directly rather than through the controller, which is the second bound above
  disappearing.

**The message model blocks this before the power does.** Payloads are whole-state
and retained, one per round, and an animation is an event: a retained
`fourBagger` would replay on every display reboot. Nor is it derivable from what
is published, because four in the hole is 12 raw points but cancellation makes
the net delta anything. So this needs a protocol decision first.

### What still wants measuring

All of the above is derived. One inline USB meter at first power-up settles the
lot: the running current against the ~0.98 A worst case, whether inrush trips the
bank before the board starts, and whether the idle screen holds it awake.

## Names the panel cannot show

The font is 5x7 ASCII. `fontIndex` maps anything outside it to a space, so a
name in a non-Latin script renders as blank cells that still consume the
nine-character budget — and the rule marking who throws would sit under nothing.
`copyLabel` also truncates at 39 **bytes**, which can cut a multi-byte character
in half. The app does not restrict input to ASCII, so this is reachable; it is
accepted rather than fixed, because a Unicode font does not fit either the panel
or the flash.
