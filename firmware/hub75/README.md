# firmware/hub75

The HUB75 build of the external scoreboard: **2 x Waveshare RGB-Matrix-P5-64x32
chained into one 128x32 canvas**, 640 x 160 mm, driven by an Adafruit
MatrixPortal S3.

Separate from `../wokwi` rather than replacing it, because the two targets
genuinely differ: this one shows team names and colours, and **Wokwi has no
HUB75 part**, so the SevSeg build remains the only one that can be simulated.
`board_logic.h` is shared — the copy here is a symlink.

## Why this size

Measured against the real requirement (7 m worst case, 4 m typical — spectators
across the court or standing at the boards):

| | | reads to |
| --- | --- | --- |
| Digits | 20 px = 100 mm at P5 | 11.4 m |
| Names | 10 chars, 5x7 at 35 mm cap | 8.6 m |

Both clear 7 m with margin, and this was the smallest standard geometry that
did. Panel *width* is what buys name length; panel *height* buys digit height.
Four digits side by side run out of width first, which is why rows 30-31 are
left dark — the spare height would buy nothing.

## Host renderer

There is no simulator, so the layout is checked by compiling `render.h` on the
host and dumping the framebuffer. This is the same code the panel runs, not a
restatement of it.

```bash
cd firmware/hub75
curl -sLo ../wokwi/ArduinoJson.h \
  https://github.com/bblanchon/ArduinoJson/releases/download/v7.4.3/ArduinoJson-v7.4.3.h
mkdir -p out
clang++ -std=c++17 -Wall -Wextra -I. -I../wokwi -o /tmp/render_test test_render.cpp
/tmp/render_test && node preview.mjs
```

`-I../wokwi` is for the desktop `ArduinoJson.h`, which is gitignored. Output
lands in `out/`, also gitignored.

`test_render.cpp` asserts as well as renders: nothing may be drawn outside the
panel (on real hardware that wraps onto the wrong module), the winner flash must
blank the winning pair without blanking the rest, and an out-of-range score,
round or name must stay on the panel.

## Glyphs are generated

`glyphs.h` comes from `src/segments.js` and `tools/panel-preview/font5x7.mjs`,
so the panel's digits are the browser's geometry rather than a redrawing of it.
Rasterising tests each pixel centre against the real polygon, so the header
holds the quantisation the panel will actually show.

```bash
node firmware/hub75/generate_glyphs.mjs
```

Re-run it after changing either source, or after changing `DIGIT_W`/`DIGIT_H` —
which is what you would do to move to a 128x64 panel later.

One divergence worth knowing: the dash shown before any state arrives is
**defined in the generator, not in `segments.js`**. The browser display never
needs one and SevSeg synthesises its own, so this build is the only caller. A
regression test covers it, because an empty dash glyph means a blank board
before the first message, which reads as broken rather than waiting.

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
- **Power does not chain.** The HUB75 ribbon carries data only. Each panel takes
  its own 5 V at up to 4 A through its VH4 connector. One data chain, two power
  feeds.
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

Measured from the host renderer's own framebuffer, so these are duty cycles for
the real layout rather than estimates:

| Scene | Duty | Average at 40 W peak |
| --- | --- | --- |
| Normal play | 10.9% | ~2.0 W |
| Start of game | 7.6% | ~1.5 W |
| Winner flash | 9.3–11.7% | ~1.9 W |
| Worst case (88–88, full names) | 19.0% | ~3.4 W |

At `PANEL_BRIGHTNESS = 40` those drop by roughly 85%, giving well under 1 W in
play. Size the supply and fuse for the 40 W peak regardless.
