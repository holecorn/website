# firmware/hub75

The HUB75 build of the external scoreboard: **2 x Waveshare RGB-Matrix-P5-64x32
chained into one 128x32 canvas**, 640 x 160 mm, driven by an Adafruit
MatrixPortal S3.

**The only firmware target.** A SevSeg build lived alongside this one in
`firmware/wokwi/` until 2026-07-27, kept because Wokwi has no HUB75 part so it
was the only target that could be simulated. It was removed once the two
sketches had diverged far enough that the simulation stopped being
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
side by side run out of width first, which is why the `full` layout leaves rows
30-31 dark: with a name row above them there is nothing to spend the height on.
Spending it means giving up the names, which is the `score` layout below.

## What it shows

At power-on, the wordmark for 5 s while it is thrown together — see the fourth screen
below. Then the `full`
layout; `score` drops the names for taller digits — see Two layouts.

```
   RHO/TAU      V      ALPHA/PHI
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
 |      RHO/TAU     V    |    ALPHA/PHI          |  160 mm
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
         +-------- Y-lead ----+--------|-----+  one lead, splitting to both
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
- **They take crimped spade terminals, not bare wire under the screw**, and the
  supplied lead arrives with them already crimped.
- **One Y-lead feeds both panels, so it is one spade per screw.** The supplied
  lead is fork terminals at the supply end splitting to two VH4 plugs, which is
  exactly this topology — so the second panel's lead is a spare and nothing is
  stacked. That matters more than tidiness: the lug end is the only unprotected
  polarity in the build, and one spade under each screw is one thing to get right
  rather than two things to get right while they slide against each other.
  - **The shared trunk is not a concern at this duty.** It carries both panels —
    ~0.98 A worst case at full brightness, against a 4 A VH4. The vendor's 8 A
    all-white figure is not reachable by a layout of coloured digits on black.
  - **The branch just reaches, with very little slack** — laid out against both
    panels butted side by side, checked 2026-08-03. The stub is sized for panels
    stacked *vertically* (~160 mm between VH4 sockets, not ~320 mm), which is the
    vendor assuming a 320 x 320 arrangement rather than this one. Worth knowing
    generally: **anything else sourced from Waveshare may assume stacking**, and
    lead length is where that surfaces first.
  - **So the lead must be tied to the backer, and this is not tidiness.** With no
    slack, the fork terminals become the strain member — and they sit on the one
    unprotected polarity in the build, over the controller's exposed underside
    pads. A tie close to the split, with the lead approaching the standoffs
    straight rather than round a corner, puts any tug on the tie instead of on a
    spade under an M3 screw. Route it before drilling; a detour spends reach the
    lead does not have.
  - **The spare Y-lead is the fallback, at a price.** Feeding each panel from its
    own lead gives generous slack, but puts two spades back under each screw —
    which is the awkwardness this topology removed. Prefer the tie.
- **One data chain, and a pair of conductors to each panel.** The ribbon carries
  data only. It *does* tie the panels' grounds together, but that is a signal
  reference, not a conductor rated to carry a panel's supply current back, so each
  panel takes its own pair from the Y-lead's split rather than borrowing the
  ribbon's — which the Y-lead honours, since the branches are separate conductors
  all the way to each panel.
- **The controller needs no bracket.** Its 2x10 socket keys straight into panel
  A's HUB75 port, so it hangs off the back of the panel. That is Adafruit's own
  intent and it is why no standoffs appear in the parts list.
  - **Its two M3-threaded posts are not mounting points.** They are the `+5V` and
    `GND` screw terminals either side of the HUB75 socket — already spoken for by
    the panel leads, and live VBUS. Bolting the board down by them would put a
    fastener through the one unprotected polarity in the build.
  - **There are four actual mounting holes**, on a **1.60 x 0.78 inch** rectangle
    (~40.6 x 19.8 mm) read off Adafruit's fab print, which does *not* dimension
    their diameter. Measure one before ordering: 2.5 mm wants M2.5, 3.2 mm wants
    M3. **Nylon**, since the underside carries exposed pads next to a 5 V terminal.
  - **Screwing it down while it is plugged into the panel fights itself.** The
    socket already locates the board, so a standoff height that isn't exactly the
    seated height levers the connector — the panel's rear standoffs and the
    controller's holes are two datums for one part. If it has to be fixed to the
    backer, put a short 2x8 IDC ribbon between the board and panel A first; the
    same connector takes one, and that frees its position. Otherwise leave it
    hanging on the socket and give the USB-C lead a tie for strain relief.
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
| Spade terminals on the panels' power leads | **supplied, already crimped** |
| M3 hardware, panels to the ply | needed; the supplied screws are short |

The 16 AWG silicone and the Wago 222s are not needed after all — this wiring has
nothing to fan out, and no chopped lead to join. They were bought for a design
that ran a 5 V bus from a second bank port, which powering through the controller
made unnecessary.

**What is actually in each panel's bag**, checked against both boxes on
2026-08-03 rather than the vendor listing:

| Item | Used here? |
| --- | --- |
| Power **Y-lead**: fork terminals crimped on, splitting to two VH4 plugs, ferrite beads | **yes** — one lead feeds both panels |
| 16-way grey IDC ribbon, both ends shrouded | **yes** — one of the two chains the panels |
| 4 machine screws with threaded standoffs | maybe — panel mounting; too short for 6 mm ply |
| 16-way rainbow ribbon, IDC one end, Dupont pins the other | **no** — a GPIO breakout for a bare micro; the MatrixPortal keys straight into the HUB75 socket |
| 5.5 x 2.1 mm barrel jack to 2-pin screw terminal | **no**, and see below |

So the fork terminals the assembly assumes are supplied and crimped — nothing to
buy or crimp, and the only thing still to source is M3 hardware long enough to
reach through the ply. Because one Y-lead feeds both panels, the second panel's
bag is entirely spare: a spare Y-lead and a spare grey ribbon, plus both rainbow
ribbons and both barrel adapters unused.

**The barrel-jack adapter is the one part to put back in the bag.** It exists to
bring an external 5 V supply to fork terminals, which is precisely the second
power source this build is designed not to have. It cannot cause the collision on
its own — that needs the forks on the standoffs *and* the adapter energised — but
it means the collision is now a part away rather than unbuildable. See
`How to destroy it`.

## Building the sketch

Arduino IDE or `arduino-cli` with the ESP32 board package; `libraries.txt` has the
libraries, the FQBN, the core version, and the compile figures. **It compiles clean
as of 2026-08-03** — 47% of flash, 24% of global RAM, no warnings even at
`--warnings all`. It has still never run on hardware.

```bash
arduino-cli compile -b esp32:esp32:adafruit_matrixportal_esp32s3 firmware/hub75
```

**Arduino compiles every source file in a sketch folder, and that shapes this
directory.** Until 2026-08-03 neither the IDE nor `arduino-cli` could open it at
all, for two independent reasons — both now fixed by naming and placement rather
than by any build config:

- **`hub75.ino` is named after its folder, and has to stay that way.** Both tools
  take the main sketch file's name from the directory and refuse anything else
  ("main file missing from sketch: .../hub75.ino"). So **renaming the file, or
  renaming the directory on its own, breaks the build** rather than just looking
  untidy. It was `sketch.ino` for the whole of the project before that date.
- **The host suites live in `host/`, and that is load-bearing.** With
  `test_render.cpp` and `test_board_logic.cpp` beside the sketch, Arduino compiled
  both into it and the link failed on two `main()`s. Arduino ignores
  subdirectories other than `src/`, so one level down is the entire fix — and it
  must not be `src/`.
  - **It also un-shadows ArduinoJson**, which is the half you would not have
    noticed. The sketch folder is on the include path, so the vendored
    `ArduinoJson.h` the host suites compile against was satisfying the firmware's
    `#include <ArduinoJson.h>` too — the library was silently absent from
    `Used library`. Harmless while the two versions agree; the day they don't, the
    board ships a different ArduinoJson than the one `test_board_logic.cpp` sized
    `MQTT_BUFFER` against, with nothing to say so. `arduino-cli compile -v` prints
    `Alternatives for ArduinoJson.h` if this is ever worth re-checking.
- **A clean compile is a weak signal here, deliberately.** It proves the code is
  well-formed for this target and nothing more — the pinmap, the driver IC, WiFi
  and MQTT are all still unexercised, which is what `Things that will bite` is for.

**Flash with everything still connected.** The panels stay bolted to the
standoffs; you swap the bank out of the USB-C socket and the laptop in. There is
only one USB-C connector, so as long as the parts on the bench are the ones this
build uses, there is nowhere for a second 5 V source to be.

That was originally written as "something the hardware cannot express", which the
delivered kit no longer supports: **each panel ships a barrel-jack-to-screw-terminal
adapter**, so a 5 V barrel supply now has a ready-made path onto fork terminals.
It takes two deliberate steps rather than one slip, but the guarantee is a
convention now, not a physical impossibility.

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

## Two layouts

Both fit 128x32; the choice arrives on `holecorn/<code>/layout` and is held in
`layout` in `hub75.ino`.

| id | draws | digits | worst-case duty |
| --- | --- | --- | --- |
| `full` | names, score, round, target, rule under whoever throws | 11x20 = **100 mm** | 19.8% |
| `score` | score, round, target, rule under whoever throws | 17x30 = **150 mm** | 23.6% |

The names and the digits compete for the same 32 rows, so dropping the names is
what pays for the extra height — `full` leaves rows 30-31 dark because its digits
are width-limited, and `score` spends them. Both keep the first-thrower rule
(under the name, and under the score respectively), so the comparison is names
against no names rather than against a bare score.

`parseLayout` in `board_logic.h` ignores an id it doesn't know and leaves the
board on what it was already drawing — an app newer than the firmware must not be
able to blank it or drop it to a layout nobody chose.

### A third screen that is not a layout

Before the first bag there is no score, so a retained roster on
`holecorn/<code>/lineup` puts the board on a **form** screen instead: one row per
player with their record, PPR and last five results as pips.

```
NEIL       6-4 7.2  o#o##      <- # a win, o a loss, newest right
RHO        2-2 7.3   #ooo
SIGMA      4-6 6.0  #o#oo
TAU        2-2 7.3   o##o
```

It is **not** an entry in `PANEL_LAYOUT_IDS`, and that is the point. A layout is a
preference the scorer sets and keeps; this is a phase of the game. So
`renderBoard` takes an optional `const LineupState*` and draws form whenever the
count is non-zero — winning over both score layouts and over the no-state dashes,
which is safe because the app only publishes it while no bag has been thrown. An
empty payload clears the topic and is the only route back; `parseLineup` reports
that as `count = 0` rather than refusing it as malformed.

| | value |
| --- | --- |
| rows | 4 (`FORM_ROW_H` = 8, so a doubles roster is the whole panel) |
| name | **11 characters** for an ordinary record, 8 at `99-99`, 6 at `120-87` |
| worst-case duty | **28.5%**, against `DUTY_CEILING`'s 30% |

Three things worth knowing before changing it:

- **The number columns are sized to the lineup on screen**, not to the worst case any
  lineup could hold, and the name takes the remainder — so a roster of `6-4` records
  gets 11 name characters where a fixed layout gave 8. A record past 99 is real (about
  100 matches) and widens the column back down to 6 characters rather than lying about
  the number. `formLayout()` does it; `test_render.cpp` asserts the gap between name and
  record is empty on every row of both the `99-99` and the `120-87` scene.
- **A loss is a single pixel, a win a 3x3 block.** Not a dim block: on a real panel
  an unlit-but-not-off LED is indistinguishable from off.
- **The rate column is empty only for a 0-0 record**, never for a rate of 0.0 —
  that is a real average, and blanking it reads as missing data rather than a bad
  run. `form-zero-rate` in `test_render.cpp` pins it.
- **28.5% leaves almost nothing under the ceiling.** The power case still holds —
  roughly 1.4 A for both panels at full brightness against a bank that folds back at
  3 A — but a fifth row, bigger pips or another column would breach it. Read Power
  below before assuming there is room.

Because the form screen has no layout id, the coverage check in
`tools/test-firmware.mjs` cannot see it through `PANEL_LAYOUTS`, so it separately
refuses to pass unless some scene carries a lineup.

### A fourth screen: a tournament tie

A retained `holecorn/<code>/tie` — the cup's name and the round — puts the board on a
**fixture card** and wins over the form screen, because inside a knockout a form line
says nothing: every side arrives at a tie unbeaten, so the pips read `WWW` against
`WWW`. What changes tie to tie is the round.

```
     HOLE CORN V                        HOLE CORN V
      SEMI-FINAL                          FINAL
     NEIL & RHO
     SIGMA & TAU                     NEIL  V  SIGMA
```

The fixture collapses onto one row when both sides fit there **as typed**, freeing the
fourth row and spreading the card. Never by shortening — buying air by giving up a name
is the wrong way round — so a long pair stacks and keeps its ampersand. The heading is
always two rows, so a cup does not change shape between its own ties.

Like the form screen it is not an entry in `PANEL_LAYOUT_IDS`, so `renderBoard` takes an
optional `const TieState*` and `tools/test-firmware.mjs` carries a third standalone
assertion that some scene has one.

| | value |
| --- | --- |
| rows | 4 stacked, 3 spread (`TIE_ROW_H` = 8) |
| line | **21 characters**; the fixture spreads at **20** or fewer |
| worst-case duty | **22.7%**, against `DUTY_CEILING`'s 30% |

Four things worth knowing before changing it:

- **It carries no names.** The two sides come from the score message, already joined —
  two copies of who is playing could disagree. So unlike the lineup the card needs
  `haveState`: with no score there is nobody to name, and it falls through to the dashes.
- **Stacking is what buys the characters.** Either side of a versus mark each side gets
  9, so a 16-character name lands as `ALPHABETA`. A full row gives 21 and it fits whole.
- **20 and not 21.** A 21-character fixture fits, but runs to within a pixel of both
  edges. `test_render.cpp` pins the threshold with a *pair* of scenes one character
  apart, since asserting only that 20 spreads passes with the limit at 21.
- **No versus mark between stacked sides and no first-thrower rule.** `TIE_ROW_H` is 8
  and `FONT_H` is 7, so anything between two rows is 1px and reads as an underscore
  stuck to the name above it. The colours are the two the score screen already puts
  either side of a `V`, and the score screen rules the opening side moments later.

### And a fifth: the wordmark at power-on

For `SPLASH_MS` (5 s) after `panel->begin()` the board shows the Holecorn
wordmark, in **two of the app's four team colours picked at random each boot**, with
a 2x2 connect indicator in the top-right corner: red for no WiFi, amber for WiFi but
no broker, green once subscribed.

**The mark assembles itself by being thrown there.** The two boxes the wordmark draws
round its words are two cornhole boards, so they are up from the first frame and the
eight letters are thrown into them — HOLE's from the left, CORN's from the right, the
two boards taking it in turns. Each bag arcs up and over, lands a few pixels short of
its square, skids to a stop, and knocks the board it landed in down a pixel. The order
is shuffled per board every boot, so no two boots fill a board the same way.

**`SPLASH_STAGGER_MS` is one flight, not a number of its own.** At exactly that spacing a
bag touches down as the next is let go, so **there is never more than one in the air** —
the one still sliding is already on the board — and the eight arrivals read as eight
throws. Every spacing from 190 to 640 ms was rendered and compared side by side: at 190 ms
two or three bags are in flight at once and it reads as a flurry, and at a flight plus its
skid each bag has fully stopped before the next is thrown, which is a beat too far apart
and costs another 1.5 s of splash. Deriving it is also what makes a change to the flight
carry the rhythm with it.

**Each board keeps one colour, bags included**, so what the throws settle into is the
app's own wordmark rather than a version of it — which makes the shuffle a matter of
timing alone. Colouring each bag by the order it was thrown in was built first and is
what this rules out: every board then ended up with two bags of each colour in a
different arrangement every boot, which is a truer picture of a round and a worse logo.

| | value |
| --- | --- |
| animation | `SPLASH_ANIM_MS` 3.58 s of the 5 s: 8 throws 420 ms apart, each 420 ms of flight and 220 ms of skid |
| flight | 6 rows of arc, 4 px of skid, a 1-row knock held 70 ms |
| duty | **24.6%** settled, against `DUTY_CEILING`'s 30% — 12.4% for the bare boards and 21.3% at the busiest frame between, so the animation never approaches it |
| flash | 4 kB of coverage maps, 2 kB per word, plus **128 bytes** of letter rectangles |
| brightnesses | 18 on screen, faintest 96 of 242 |
| mark | 111 x 28 px of the 128 x 32, against 82 px wide as the app once authored it |
| indicator | 4 px, and it covers none of the mark — asserted, not assumed |

- **Nothing waits for it.** `loop()` owns connection, so WiFi and MQTT come up
  underneath the splash and it costs nothing: without it the board spends those same
  seconds on the no-state dashes. The one ordering that matters is inside `render()` —
  the liveness bookkeeping runs *before* the splash returns, or a link that came up
  during the splash and dropped straight after would have no stamp to run its grace
  period from and the board would dim the moment the splash cleared.
- **It is not a layout id either**, for the form screen's reason: a layout is a
  preference the scorer keeps, and this is the first few seconds of a boot. Nothing on
  the wire selects it, so `tools/test-firmware.mjs` has a second standalone assertion
  that some scene carries a splash.
- **The two colours, the clock and the throwing order are arguments to `drawSplash`, not
  read inside it.** `render.h` host-compiles and the pixel check needs the same inputs to
  produce the same frame, so the randomness lives in `hub75.ino` — `esp_random()`, not
  `random()`, which is seeded identically every boot and would show the same pair every
  time. The second colour index steps past the first over the remaining colours, so it
  cannot repeat it without a retry loop; the order is a Fisher-Yates shuffle per board.
  `elapsed` arrives the same way, from `millis() - splashStart`.
- **A letter is a rectangle, not a mask, and that is the whole reason this costs 128 bytes
  rather than another 16 kB.** `generate_logo.mjs` finds the five connected pieces of each
  word — the box and four letters — and emits the letters' bounding boxes; everything in
  the map outside them is the box. It works only because nothing of the box lands inside a
  letter's rectangle and no two letters' rectangles meet, so **the generator checks both**
  and refuses to write a mark it cannot divide this way. A wider `letter-spacing`, a
  different font or a box drawn closer would be caught there rather than by a letter
  flying off with a slice of frame attached.
- **Bags are written where they have got to, not sampled at an offset.** That is the
  reverse of the slide this replaced, and it has to be: each of the nine pieces on screen
  carries its own offset, so there is no single shift to read the map through. Clipping
  therefore happens on the way out, in `splashPx`.
- **A bag starts just off its own edge, not a panel out.** The rectangles say where each
  letter is, so the distance to the edge is known per letter — which is what keeps the
  first frames from being empty. The slide could not do this: its masks were panel-sized
  and carried their own placement, so its travel had to be `PANEL_W` and the first ~130 ms
  drew nothing.
- **Horizontally near-constant speed, vertically a parabola, then a skid.** The
  deceleration all belongs in the skid, because that is what a bag does: it arrives at
  speed, lands short and slides. `SPLASH_APEX` is 6 rows because that is the least
  headroom any letter has — measured off `LOGO_HOLE_LETTERS`, where the shallowest letter
  starts at row 6 — so a bag at the top of its arc reaches row 0 and no letter is ever
  clipped by the top of the panel. Integer throughout in both languages, and the widest
  product is about a million, so none of it needs 64 bits.
- **The knock is read off the clock, never remembered.** `splashThump` asks whether any of
  a board's bags landed within the last `SPLASH_THUMP_MS`, so a frame stays a pure
  function of `elapsed` and the pixel check can ask for any moment in any order. The bags
  already resting go down with the board; a board that dropped alone would look like its
  bags were floating.
- **The flights and both boards' knocks are pinned millisecond by millisecond, not by the
  scenes.** `test_render.cpp` writes `out/splash-curve.json` — 28,656 offsets and 7,164
  knock samples — and `tools/test-firmware.mjs` compares every one against
  `src/panelRender.js`. Dumped frames cannot do this job and it is worth knowing why
  before trimming it: a flight that differs *between* two sample times draws an identical
  frame at each of them. Verified by mutation — making the JS skid linear rather than
  quadratic passes all 43 scenes pixel for pixel and fails only the curve. Rounding the
  arc's division instead of truncating does fail three scenes, and a 1 ms shift fails the
  apex frame because that one is sampled at the extremum, so **not every timing bug needs
  the curve — only the ones that fall between the frames, which is most of them.**
- **Nothing in a frame can see where a flight ends or starts**, because every frame is
  rendered through the same offsets, so a bag that settled a pixel off its square would
  shift the PPMs with it and still match. Hence the assertions on the ends of the flight,
  and one in `tools/verify-panel.mjs` that the settled mark is clear of both edges.
- **Two of those assertions were written against the constants they check, and passed
  their own mutations.** Setting `SPLASH_THUMP` or `SPLASH_SKID` to 0 removed the knock
  and the skid with nothing failing, because both sides of the comparison moved together.
  They now state the property instead — the board's bottom edge must be *lower* than
  settled, and a bag must touch down *short* of its square. **Anything added here that
  compares a frame against the constant that drew it is worth the same suspicion.**
- **`SPLASH_RENDER_INTERVAL` is 25 ms against `RENDER_INTERVAL`'s 100 ms.** A score
  changes once a round; eight throws need frames, and can have them because rendering does
  not block and there is no traffic to keep up with yet. At 100 ms each flight would be
  four frames. **`?panel=1` steps its clock in the same increments**, so the emulator
  shows the board's cadence rather than the browser's 60 Hz — see `Panel.jsx`, and
  CLAUDE.md for why no check covers that.
- **Whether the animation can stutter on real hardware is untested**, since nothing has
  run on a board. `ensureWifi()` cannot block, and the blocking call —
  `client.connect()` — is reached only once WiFi is up, which typically takes 1-3 s. That
  falls **inside** the 3.58 s of throws now rather than clearing them as the 0.8 s
  slide did, so **a warm reconnect that meets an unreachable broker would freeze the
  animation part-filled** — likelier and more visible the longer the animation runs, and
  the first thing to look at if the mark ever appears half-thrown. It is also the one cost
  of the slower pace worth writing down.
- **The indicator is only on the splash.** Once a score is up, a dropped link is
  already said by the whole panel dimming, so a corner dot would be repeating it. The
  four pixels would fit the `score` layout's margins but not `full`, whose name row
  spans the whole width.
- **The panel's tilt is now the app's too.** It started as a panel-only change: the mark
  was drawn at 15°, a rotated box is far taller than its content, and on 32 rows that
  height is what caps the scale — fitting the mark as authored left 39 of 128 columns
  unused and the letters at 10 px, where Bebas Neue's condensed R and N run into
  themselves. 8° fixed that, and the app then adopted it so the two match; easing the
  tilt also gave the setup screen **13 px** of height back, because the app's viewBox is
  proportioned to the mark. `src/Logo.test.js` pins the tilt and the box together, since
  a shallower tilt with the old viewBox would spend the saving on empty space.
- **What still differs is `letter-spacing`: 14 here against the app's 7.** That one is a
  pixel-crowding fix and only the panel needs it — at the size the app draws the mark
  there is nothing to fix, and 14 would visibly change its proportions. The generator
  also fits to the mark's own bounds rather than the authored viewBox. Letters clear
  their boxes by **5-6 px on both sides**, measured off the rendered pixels.
- **It carries 4-bit coverage, not a 1-bit mask, and that is what makes an 8° tilt
  work.** Antialiasing is the only thing a 128x32 panel can do about a diagonal. It also
  costs nothing: with the floor below, the mark is *fewer* lit pixels than the hard-masked
  version was (24.5% against 27.2%) because the pixels the floor drops are the ones a hard
  threshold was promoting to full brightness.
- **`COVERAGE_FLOOR` is load-bearing twice over.** Below ~40% an edge pixel is
  indistinguishable from off at `PANEL_BRIGHTNESS` 40 — the loss-pip lesson — and keeping
  the fainter ones puts the lit count at **34.6%**, over the ceiling. The generator emits
  the floor it actually applied as `LOGO_MIN_LEVEL` and `test_render.cpp` asserts against
  that rather than re-deriving the fraction, which is how a quantisation rounding at 39.7%
  was caught.
- **The chalk grain is off, and at this size that is not a loss.** A 1-2 px stroke has no
  interior for a dither pattern to live in, so all `feTurbulence` does is erode and wobble
  the strokes — it fights the antialiasing rather than adding texture. Rendered at three
  times the dot size before deciding.
- **It happens to help the power bank start.** The no-state screen is 1.4% duty and
  banks cut out below roughly 50-100 mA (see Power); the splash is 24.6% settled, so the
  board draws several times as much for the first seconds — which is when the bank decides
  whether to stay awake. The throws changed the shape of that and not the conclusion: the
  bare boards are **12.4%**, so the first 0.4 s is about nine times the idle screen rather
  than eighteen, climbing from there and reaching the full figure at 3.58 s. A side effect
  either way, and it does nothing for the idle screen afterwards.
- **Worth knowing if `DUTY_CEILING` is ever revisited:** measured across every scene, the
  lit-pixel count and a per-channel current proxy diverge by about 1.7x, because these
  colours are never white and a blue pixel lights mostly one LED of three. `form-worst` is
  28.5% lit but 16.6% per-channel. The ceiling is therefore conservative, which is the
  right direction for it — but it means an antialiased screen can breach it while drawing
  *less* current than one that passes. This splash respects the check as written rather
  than arguing with it; changing the metric would be its own change, on its own merits.

### The logo is generated too

`logo.h` and `src/panelLogo.js` come from one run of `generate_logo.mjs`, which
rasterises `public/logo.svg` in a headless browser:

```bash
npm install --no-save playwright
node firmware/hub75/generate_logo.mjs
```

A browser is unavoidable here — the SVG is set in Bebas Neue and drawn through
`feTurbulence` and `feDisplacementMap`, none of which exists on an ESP32. That is also
why the result is baked rather than drawn on the board. The chalk filter is switched
off first: at 5 mm pitch its grain quantises to scattered single pixels, which reads as
a fault rather than as texture.

Two coverage maps come out, one per word — 4 bits per pixel, two pixels to a byte, low
nibble first — which is what lets the splash both recolour and antialias them. Which word
a pixel belongs to is decided by the **dominant channel**, not by distance to the two
hexes the SVG hardcodes: a dim antialiased blue is nearer `#f18686` than `#69a4f2` in
plain RGB, which quietly filed a third of HOLE under CORN. Where the two boxes cross, the
pixel goes to CORN, matching the order the SVG paints them in.

Each word also carries **four letter rectangles**, found by connected-component labelling
of the map the generator has just built and numbered left to right. They are found rather
than laid out because the mark is rasterised through a browser: what a letter's pixels are
is only knowable after the fact. Three properties are checked and each is a way the splash
would break rather than fail — exactly five pieces per word, no box pixel inside a letter's
rectangle, and no two rectangles overlapping.

The geometry constants at the top of the generator (`ANGLE`, `LETTER_SPACING`, `BOX_PAD`,
`BOX_GAP`, `COVERAGE_FLOOR`) are the panel's, not the app's, and each has a comment saying
what it costs. Two of them are coupled: widening the spacing makes each box wider than the
128 units the source puts between the two groups, so `BOX_GAP` is applied to a group offset
derived from the box extent rather than to the authored positions. Without that the boxes
overlap in the middle.

**The staleness check works differently from the glyph one.** `glyphs.h` is checked by
regenerating and diffing, which needs no browser; this cannot be, because CI's firmware
job has none. So the generator records a hash of the SVG and the font, and
`tools/test-firmware.mjs` compares that. What it catches is an edited logo with stale
masks committed. What it *cannot* catch is the rasteriser changing under a browser
update — tolerable, because the baked asset is what ships: the panel shows what was
generated, not what Chrome would draw today.

At 5 mm pitch the 5x7 font is **35 mm tall** — this screen reads from a few metres,
not the ~11 m the score does. That is the trade it makes deliberately: it is what
you read standing around before a game.

**A new layout is bounded by `DUTY_CEILING`, not by taste.** `test_render.cpp`
maxes the lit fraction over every scene and fails above 30%, because feeding both
panels through the controller's 5 V terminals depends on the layout staying far
from white and no electrical test would catch a regression. It also asserts the
digit height by *measuring the framebuffer*, not by comparing `GLYPH_BIG_H` with
itself, and `tools/test-firmware.mjs` refuses to pass if a layout has no scenes
to compare.

## Glyphs are generated

`glyphs.h` comes from `src/segments.js` and `tools/panel-preview/font5x7.mjs`,
so the panel's digits are the browser's geometry rather than a redrawing of it.
Rasterising tests each pixel centre against the real polygon, so the header
holds the quantisation the panel will actually show.

Both digit sizes come out of one run, so the two layouts cannot quantise the same
polygon differently. Rows are `uint32_t` because the big digit is 17 columns wide
and would not fit a `uint16_t` — which also caps any future size at 32 columns,
far past what four digits can spend of 128.

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
  and not one of those pins matches the MatrixPortal S3. `hub75.ino` therefore
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
- **Power does not chain *through the ribbon*.** It carries data only, so each
  panel takes its own 5 V through its own VH4 connector — one data chain, two
  power feeds, both branches of the one supplied Y-lead. The VH4's 4 A is the
  panel's rating, not a draw to provision for; see Power for what this layout
  actually pulls.
- **1/16 scan, so no E pin**, and no `VirtualMatrixPanel` remapping. That is the
  reason this panel was chosen over an outdoor 1/8-scan one.
- **`PIN_LIGHTSENSOR A5` in the board's `pins_arduino.h` is a phantom.** The
  ALS-PT19 phototransistor is on the schematic but Adafruit say it *"is NOT part of
  the final design for this board"* — it is not fitted. So the header invites an
  auto-brightness reading off a floating pin, which would look like a working sensor
  giving nonsense. Automatic brightness on this board means adding an external
  sensor on A5 or the STEMMA QT connector, which is why the UP/DOWN buttons are what
  brightness has. The LIS3DH accelerometer at **0x19** (not the default 0x18) *is*
  fitted, and the status NeoPixel on GPIO 4 is real but faces the back of the panel
  once assembled.

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

## Brightness

The MatrixPortal's own **UP** and **DOWN** buttons (GPIO 6 and 7, no pull-ups
fitted, so `INPUT_PULLUP` and active low) step through `BRIGHTNESS_LEVELS` in
`board_logic.h`: **40, 70, 120, 180, 255**, booting at 40. They are the board's
only input, and brightness is the only thing they should ever do — everything else
the panel shows is published state, and a local override would fight the app.

- **A table, not an increment.** Perceived brightness is roughly logarithmic and
  the library's own scaling is unverified, so even steps in the value bunch at the
  top and do nothing at the bottom. Five geometric steps cross the whole range in
  four presses.
- **It clamps at both ends**, which is why `stepBrightness()` is a function in
  `board_logic.h` with a host test rather than arithmetic in the `.ino`. Wrapping
  would put one press between the darkest step and 255.
- **The floor is 40 because that is the only value anything faint was judged
  against.** `COVERAGE_FLOOR` drops splash pixels below ~40% of full precisely
  because at brightness 40 they are indistinguishable from off, and the form
  screen's loss pip is a single pixel. Both get dimmer with the global setting and
  neither has been looked at on hardware. A darker step is a one-entry change to
  the table **after** the pip has been eyeballed at dusk — not before.
- **The ceiling is 255 because the power budget allows it**: the worst-case scene
  is ~0.98 A against a bank that folds back at 3 A. So the full-brightness rows in
  the tables below are no longer hypothetical — they are four presses away, and
  the ~6 h runtime with them.
- **Nothing is remembered across a reboot.** Brightness tracks the light on the
  day, so 40 is as likely to be right as whatever was set last session, and it is
  the step that cannot dazzle. `Preferences` would be the change if that turns out
  to be wrong.
- **No on-screen indicator, deliberately.** The panel is its own readout — you are
  looking at the thing that changed. An indicator would also mean drawing in
  `render.h`, which is pixel-checked against `src/panelRender.js`, for something
  the eye already has. The serial log prints the new value.
- **This is the one part of the sketch a host suite cannot reach**, since it is pin
  reads and a library call. `stepBrightness()` is covered; the wiring is not, so it
  is a first-power-up check like the rest of `setup()`. Presses are also missed
  while `connectMqtt()` is blocking on a dead network — the buttons will feel
  unresponsive until the hotspot is up, which is not a fault.

### The other two buttons are not ours

UP and DOWN are the only inputs this build takes, and the other two on the board
should stay as they are:

- **RESET is not a GPIO.** It pulls the chip's reset line, so there is nothing to
  read — pressing it restarts the sketch. That is worth having as-is: a reset
  replays the splash, whose 2x2 corner indicator distinguishes *no WiFi* from *no
  broker* from *subscribed*. On site, with no serial console and the board on a
  stand, that is the diagnostic, and it is the reason a diagnostics screen is not
  needed. Nothing else about the board is worth a button, because everything else
  it draws is published state.
- **BOOT is readable but should not be read.** It is GPIO 0 by ESP32-S3 convention
  rather than by anything Adafruit document — `pins_arduino.h` defines
  `PIN_BUTTON_UP`/`PIN_BUTTON_DOWN` and no BOOT at all — so it would want metering
  first. Two better reasons not to: it is a strapping pin, so held low across a
  reset the chip comes up in ROM download mode with a dark panel and no clue why,
  which a bank folding back under load makes reachable by accident; and it is the
  way back in when flashing fails, on a controller that will be bolted behind a
  panel.
- **A third control, if one is ever genuinely needed, is a wire.** The GPIO
  breakout strip has six pins free, and none of the HUB75 pinmap, GPIO 6 or GPIO 7
  is among them. Cheaper than borrowing a pin with another job.

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

At the boot brightness of 40 of 255 those fall further, assuming the library's
brightness is linear — which is unverified. None of this has been checked
against hardware, and the buttons mean the board can be sitting anywhere between
40 and 255 (see Brightness).

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
  uses a third of the budget, which is what lets the UP button reach it for
  daylight without revisiting the supply. Booting at 40 is for evening play, not
  for power.
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
things might be, and **both announce themselves without instrumentation** — the
board either starts or it doesn't, and the bank either stays awake through the
idle screen or it doesn't:

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

All of the above is derived, and **first power-up is deliberately not
instrumented.** An inline USB meter was considered and skipped, because it does
not answer the questions that matter here:

- **Inrush is beyond it.** A UM24C-class meter updates at a few Hz; the switch-on
  event is milliseconds. It would read a comfortable steady current either side of
  a spike that trips the bank, so the meter cannot distinguish inrush from the OE
  window from a wiring fault. The fix ladder — 10k pull-up on OE, then lower
  brightness, then a different bank — is the same whatever it displayed.
- **The two real risks are binary.** The board starts or it doesn't; the bank
  holds through the 1.4%-duty idle screen or it cuts out. Both are visible to the
  eye, and the idle fix (charge the scoring phone off the same bank) is free and
  needs no diagnosis first.
- **The ~0.98 A worst case is bounded anyway.** The bank folds back at 3 A, so a
  wrong derivation trips it rather than being unsafe. **Borrow a meter the day the
  bank is swapped for mains** — that removes the fold-back bound and makes these
  derived figures load-bearing for the first time.

Two things the meter cannot answer and only dusk can: whether 40 is dark enough
to play under, which decides if `BRIGHTNESS_LEVELS` needs a step below it, and
whether the five steps read as evenly spaced or bunch at one end.

## Names the panel cannot show

The font is 5x7 ASCII. `fontIndex` maps anything outside it to `FONT_UNKNOWN`, a
dash — one per *byte*, so a name in a non-Latin script draws as a run of dashes
twice as long as the name, still consuming the nine-character budget. A dash
rather than a space because a name that vanishes entirely reads as a fault: two
Greek names lit 13 pixels of the name row against 181 for two Latin ones, and now
light 103. Accented Latin degrades readably — `José` draws as `JOS-`.

`copyLabel` also truncates at 39 **bytes**, which can cut a multi-byte character
in half. The app does not restrict input to ASCII, so this is reachable; it is
accepted rather than fixed, because a Unicode font does not fit either the panel
or the flash.
