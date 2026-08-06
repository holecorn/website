# tools

Verification and preview scripts. Some run in CI; the rest exist because several
decisions in `CLAUDE.md` were made from measurements rather than judgement, and
those measurements should be reproducible.

`test-firmware.mjs` needs only a C++17 compiler. Note that it **regenerates
tracked files as part of the run** — it re-runs `generate_glyphs.mjs` to check
those outputs are current, so a stale `firmware/hub75/glyphs.h` or
`src/panelGlyphs.js` is left rewritten in your working tree along with the
failure. That is the fix, so commit it.

Four scripts need nothing at all:

`import-legacy.mjs` turns a text file of written-down results into an archive
file the stats screen can import, and validates it with the app's own
`validRecord` and `validTournament` rather than copies of them. See **Games
played before the app** in `README.md` for the line format. It is the only script
in here with unit tests (`import-legacy.test.js`, which is why `vitest.config.js`
reaches into `tools/`), because reconstructing a past tournament's draw from its
results is a rule rather than a rendering — and a draw that comes out wrong shows
as a bracket with ties still to play rather than as an error. It refuses to write
one it cannot check: the reconstruction is run through the real `bracket()` and
has to place every tie and produce the champion the results name.

`make-sample-archive.mjs` writes `fixtures/sample-archive.json` — three years of
made-up history to import when working on anything that reads the archive. Both
kinds of record, both modes, all four colours, and one player whose whole career
is result-only. The played games go through `src/scoring.js` bag by bag and the
transcribed ones through `import-legacy.mjs`, so a fixture can't disagree with
the rules it exists to exercise. Seeded and dated absolutely, so re-running
produces no diff; the dates will age, and `FIRST`/`LAST` are where to bump them.
`src/archive.test.js` holds the committed file to `validRecord`, because
`mergeMatches` drops a bad record silently.

It also carries nine tournaments, which is what it takes to have one of each shape
to look at. Six are editions of Hole Corn, because a series is read off the names
and there is no other way to have one: two of those are results transcribed with no
sheet behind them (one listing its field, one remembering only the winner), one is a
sheet whose ties survived with no round detail, two were played in the app, and the
newest is still running. The other three are a one-off cup — a series of one, so the
Series section does not draw for it — and the two editions of a second series, whose
newest is finished, which is the only thing `Draw` offers a next edition for. The
played ones go tie by tie through the real `bracket()`, so a draw and the results it
is derived from cannot disagree, and the transcribed ones go through
`import-legacy.mjs` so the reconstruction is exercised rather than written down.
One player is marked inactive, so the name fields offer a filtered list.

`make-stress-archive.mjs` writes `out/stress-archive.json`, which is the same idea
taken to an unreasonable extreme: ~970 matches, ~10,700 rounds, 77 players and 17
tournaments including a 64-entrant bracket (six rounds, "Round of 64" headings),
the worst possible ragged shape at 31 entrants, 32 doubles pairs, and one left part
way through with 18 ties playable at once. Nine of them are editions of one cup, so
the Series section has a roll of honour nine lines long and a table of 40 entrants —
two of those editions are transcribed results, one listing a field of 40 and one
remembering only the winner. A second series is named at the draw form's 32-character
cap, so the next-edition chip is the widest one that can be offered and the row is
capped at three. A fifth of the roster is marked inactive. Names sit at the app's
16-character cap, in Greek script, and one contains " & " so `winVerb` reads a
singles player as a pair. **Not checked in** — it runs to megabytes and `out/` is
gitignored, so
generate it when you want it. It reports its own size against the 5MB localStorage
budget, which is a limit the app really hits: past it `saveArchive` refuses the write
and reports it rather than deleting history to make room.

Both fixture generators share `lib/fixture.mjs`, which is where the seeded PRNG and
the play-it-through-the-real-functions machinery lives. The sample must regenerate
byte-identically after any change there — that is the check that a change to the
shared code has not quietly moved the committed file.

Everything else here drives a browser and needs Playwright, which is deliberately
**not** a project dependency:

```bash
npm install --no-save playwright
```

No browser download is required locally — the scripts drive your installed Chrome
via `channel: 'chrome'`, and fall back to Playwright's bundled Chromium when `CI`
is set. Output goes to `tools/out/`, which is gitignored.

## Running the workflow locally

[`act`](https://github.com/nektos/act) runs `.github/workflows/deploy.yml` in
Docker, which is worth it before changing the workflow itself:

```bash
brew install act
act --list                                       # parse and show the job graph
act push -j build --container-architecture linux/arm64
act push -j firmware --container-architecture linux/arm64
```

`actions/cache` has no backend under act, so the Playwright browser cache always
misses locally and its effect is only visible on the runners.

**Use `linux/arm64` on Apple Silicon.** The default `linux/amd64` runs under QEMU
and vitest segfaults there, which looks like a test failure and isn't one. The
cost is that local runs no longer match the runners' architecture.

Two jobs run usefully; the third can't:

- `build` runs everything that matters, including `test:browser` against
  Playwright's **bundled Chromium** with `CI` set. That is the branch the checks
  take on the runners and not the one they take locally, so it is the part worth
  having. **It still ends red**, because the final `upload-pages-artifact` step
  fails with `Unable to get the ACTIONS_RUNTIME_TOKEN env variable` — act has no
  artifact service, and every version of `upload-artifact` authenticates against
  one. Read the step results rather than the job's exit code.
- `firmware` runs end to end. `actions/cache` can't reach a cache service and
  warns rather than failing, which is what it does on a cache miss anyway.
- `deploy` **cannot run**: `actions/deploy-pages` needs the Pages API, an OIDC
  id-token and the `github-pages` environment. Only a push tests that.

Also note `act` skips `actions/checkout` by default, so its green tick means
nothing — pass `--no-skip-checkout` to actually exercise it, and expect it to fail
on any commit you haven't pushed, because it fetches the SHA from the remote.

**Seven date checks used to fail in the container and no longer do**, so `act` now
answers the locale question as well as the font one. `dropRepeatedYear` in
`src/dates.test.js` got `Sep` where CLDR gives `Sept`, and the six `every row says
when the tournament happened` checks in `verify-tournament.mjs` came out US-ordered
(`Jul 28, 26` rather than `28 Jul 26`), because `en-GB` fell back — and the first of
those aborted `npm test` before the browser checks ran at all, so a layout change
needed that assertion relaxed locally to reach the part you wanted. Neither is true
now: measured over two runs on 2026-08-06, `catthehacker/ubuntu:act-latest` on Node
24.18.1 gives `30 Sept 26` and resolves `en-GB` properly, and the job is green to
the artifact step.

**If they come back, don't "fix" them to match `act`.** The real runner has always
passed all seven, confirmed against a green deploy. One line says which it is:

```bash
docker run --rm --platform linux/arm64 catthehacker/ubuntu:act-latest \
  node -e "console.log(new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(new Date()))"
```

`Sept` means the container is fine and a date failure is real; `Sep` means it is the
fallback again.

## What runs automatically

`npm run test:browser` starts a preview server, runs the hermetic checks against
the built app, and stops the server. CI runs it after the build.

Only checks that need **nothing but the app** are in there. `verify-winner-flash`
and `verify-form-screen` are deliberately excluded because they drive the display
through a real MQTT broker, and a deploy should not fail because someone else's
server is down — run them by hand after changing the flash or the pre-game form
screen. Everything under `panel-preview/` is a rendering aid with nothing to
assert.

| Script | |
| --- | --- |
| `test-firmware.mjs` | Compiles and runs both firmware host C++ suites, fails if `glyphs.h` or `src/panelGlyphs.js` no longer matches `src/segments.js`, and compares `src/panelRender.js` against the C++ framebuffers pixel for pixel. This is `npm run test:firmware`; CI runs it. Needs a C++17 compiler, not Playwright. |
| `measure-digits.mjs` | Reports seven-segment digit height in **millimetres** across real device sizes. Needs `npm run dev`. |
| `verify-copy-link.mjs` | Checks **Copy display link** puts the link on the clipboard, falls back to a manual-copy dialog when the Clipboard API is missing or refuses (plain http, denied permission), and that the **QR code** rasterises and decodes back to the display link. Needs `npm run preview`. |
| `verify-positions.mjs` | Checks the court diagram and the in-game stats panel: that the court names the same thrower the scoring lanes do (two independent derivations that App.jsx could still cross over), that the phone toggles and the persistent wide-screen column are the same panels, that the rail runs court/stats/history, that the stats follow the live game round by round, and that the four-bagger badge isn't clipped by a long name. Needs `npm run preview`. |
| `verify-lanes.mjs` | Measures the scoring lanes across nine device sizes: the bag token square and centred, the lane track within its 72px cap and above the 44px touch minimum, the card free of dead space with the End round button matching its width, the lane actually *reaching* the cap where there's room (which is what holds `.main`'s 408px against the intrinsic width of the tier labels), and the wide and compact tiers never both matching. Needs `npm run preview`. |
| `verify-tournament.mjs` | The tournament, driven end to end: the draw builds the bracket the paper sheet has, a tie loads locked and tagged, `Play something else` puts it back, abandoning its tournament puts it back too, `Select all` seats the field exactly as tapping every chip would, the form opens on no name boxes and stays quiet about it, a cup with no name or a name already in use is refused, and — the one it exists for — **undoing a winning round un-archives the tie and the bracket recomputes**, since nothing about its progress is stored. Also the drawn bracket's geometry (columns evenly pitched, headings over their own column, every box one height), a ceremony sheet row being one pill with its caption centred in it, the phone's `‹ ›` paging, the delete confirmation, and that name fields refuse contact autofill. Needs `npm run preview`. |
| `verify-panel.mjs` | Checks the `?panel=1` LED-panel emulator: that the querystring still routes there rather than falling through to the scoring app, and that `panelPaint.js` actually puts the framebuffer's light on the canvas — sampled at LED centres, against the no-state screen, which needs no broker. What the framebuffer *contains* is not checked here; `npm run test:firmware` pins that against the firmware far more tightly. Needs `npm run preview`. |
| `verify-wakelock.mjs` | Drives a fake `navigator.wakeLock` to check the display re-acquires the lock after the system reclaims it, and degrades to a slow retry rather than spinning. Needs `npm run preview`. |
| `verify-winner-flash.mjs` | Checks the winner's digits alternate solid/hollow, that only the winning side is affected, and that the flash is skipped under reduced motion. **Manual** — needs `npm run dev` and a reachable MQTT broker. |
| `verify-form-screen.mjs` | Drives the pre-game form screen end to end: a retained lineup puts both `?display=1` and `?panel=1` on it, it overrides the chosen score layout rather than combining with it, clearing the topic puts both back on the score, and a display opened afterwards recovers the retained roster. The clear is the one this exists for — skipped, it would strand a board on a form screen for a whole game. It also checks a 0.0 average is shown while a newcomer's is blank, and that records never wrap — for which it **forces the grid narrower than its numeric columns**, because Chrome cannot reach that state through the viewport and the natural-viewport assertions pass with or without the fix. It also covers the **tournament fixture card** on the third retained topic: that a tie wins over a lineup retained at the same time, that a cup with no roster behind it still names its two sides, that clearing it puts both views back on the score, and — the block it exists for — that drawing a bracket on a phone and tapping a tie puts that round and those entrants on the board. **Manual** — needs `npm run dev` and a reachable MQTT broker. |
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
own `render.h`. Prefer that for anything about the real board.

Don't confuse these with `src/panelRender.js`, which is also JavaScript and is
*not* exploratory: it is a port of `render.h` held pixel-identical to it by
`npm run test:firmware`, and is what `?panel=1` draws. These scripts approximate
a panel that was never built; that one reproduces the one that was.

`font5x7.mjs` is not exploratory either — `generate_glyphs.mjs` reads it to emit
both `firmware/hub75/glyphs.h` and `src/panelGlyphs.js`, so editing it changes
the app and the firmware.

They rasterise the **real** polygons from `src/segments.js` onto a panel-sized
pixel grid, then draw each pixel as an LED — so they show genuine quantisation
rather than an impression of it. Two conclusions came out of that and are worth
keeping: a single 64x64 P4 module would be enough for a 4m viewing distance, and
hollowing the digits for the winner flash fails below about 44px but works fine
on a screen, which is why the browser display does it and neither firmware does
— the built panel's digits are 20px.

Note `states.mjs` renders a `WASH` callout that is **not implemented anywhere** —
it was a design option, and is kept only to show what it would look like.
