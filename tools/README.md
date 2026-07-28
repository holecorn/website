# tools

Verification and preview scripts. Some run in CI; the rest exist because several
decisions in `CLAUDE.md` were made from measurements rather than judgement, and
those measurements should be reproducible.

`test-firmware.mjs` needs only a C++17 compiler. Everything else here drives a
browser and needs Playwright, which is deliberately **not** a project
dependency:

```bash
npm install --no-save playwright
```

No browser download is required locally — the scripts drive your installed Chrome
via `channel: 'chrome'`, and fall back to Playwright's bundled Chromium when `CI`
is set. Output goes to `tools/out/`, which is gitignored.

## What runs automatically

`npm run test:browser` starts a preview server, runs the hermetic checks against
the built app, and stops the server. CI runs it after the build.

Only checks that need **nothing but the app** are in there. `verify-winner-flash`
is deliberately excluded because it drives the display through a real MQTT
broker, and a deploy should not fail because someone else's server is down — run
it by hand after changing the flash. Everything under `panel-preview/` is a
rendering aid with nothing to assert.

| Script | |
| --- | --- |
| `test-firmware.mjs` | Compiles and runs both firmware host C++ suites, and fails if `glyphs.h` no longer matches `src/segments.js`. This is `npm run test:firmware`; CI runs it. Needs a C++17 compiler, not Playwright. |
| `measure-digits.mjs` | Reports seven-segment digit height in **millimetres** across real device sizes. Needs `npm run dev`. |
| `verify-copy-link.mjs` | Checks **Copy display link** puts the link on the clipboard, falls back to a manual-copy dialog when the Clipboard API is missing or refuses (plain http, denied permission), and that the **QR code** rasterises and decodes back to the display link. Needs `npm run preview`. |
| `verify-positions.mjs` | Checks the court diagram and the in-game stats panel: that the court names the same thrower the scoring lanes do (two independent derivations that App.jsx could still cross over), that the phone toggles and the persistent wide-screen column are the same panels, that the rail runs court/stats/history, that the stats follow the live game round by round, and that the four-bagger badge isn't clipped by a long name. Needs `npm run preview`. |
| `verify-lanes.mjs` | Measures the scoring lanes across nine device sizes: the bag token square and centred, the lane track within its 72px cap and above the 44px touch minimum, the card free of dead space with the End round button matching its width, the lane actually *reaching* the cap where there's room (which is what holds `.main`'s 408px against the intrinsic width of the tier labels), and the wide and compact tiers never both matching. Needs `npm run preview`. |
| `verify-wakelock.mjs` | Drives a fake `navigator.wakeLock` to check the display re-acquires the lock after the system reclaims it, and degrades to a slow retry rather than spinning. Needs `npm run preview`. |
| `verify-winner-flash.mjs` | Checks the winner's digits alternate solid/hollow, that only the winning side is affected, and that the flash is skipped under reduced motion. **Manual** — needs `npm run dev` and a reachable MQTT broker. |
| `with-preview.mjs` | Runs the hermetic checks against a preview build, starting and stopping the server. This is `npm run test:browser`. |
| `panel-preview/layouts.mjs` | Renders what a HUB75 LED panel would show, at three module counts. |
| `panel-preview/states.mjs` | The same, for every board state: start, waiting, stale, wash, winner flash, and a `WASH` callout. |
| `panel-preview/font5x7.mjs` | 5x7 bitmap font used by the panel previews. |

## measure-digits

`CLAUDE.md` says to verify digit sizing by measuring rather than by eye. This is
the thing that measures it. It converts rendered pixels to millimetres using each
device's real physical width, and flags any viewport that overflows.

A 4m viewing distance needs roughly 35mm digits; a 10" tablet currently gives 75mm.

## panel-preview

**Exploratory, and superseded for the build itself.** These sized HUB75 RGB LED
matrix panels before one was chosen; the panel actually being built is
`firmware/hub75/`, which has its own host renderer that compiles the firmware's
own `render.h` rather than approximating it in JavaScript. Prefer that for
anything about the real board. Nothing in `src/` depends on these scripts.

They rasterise the **real** polygons from `src/segments.js` onto a panel-sized
pixel grid, then draw each pixel as an LED — so they show genuine quantisation
rather than an impression of it. Two conclusions came out of that and are worth
keeping: a single 64x64 P4 module would be enough for a 4m viewing distance, and
hollowing the digits for the winner flash fails below about 44px but works fine
on a screen, which is why the browser display does it and neither firmware does
— the built panel's digits are 20px.

Note `states.mjs` renders a `WASH` callout that is **not implemented anywhere** —
it was a design option, and is kept only to show what it would look like.
