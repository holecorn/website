// The panel emulator (`?panel=1`), driven through the built app.
//
// What the framebuffer contains is not checked here — `npm run test:firmware`
// already holds src/panelRender.js pixel-identical to the firmware's render.h, which
// is a far stronger assertion than anything a browser could make. This covers
// only the two things that check cannot see: that the querystring still routes
// to the panel rather than falling through to the app, and that panelPaint.js
// puts the framebuffer's light on the canvas at all.
//
// The scene used is the no-state screen, because it needs no broker: an
// unreachable one leaves the board dimmed and showing four dashes, which is
// deterministic and is also the frame most likely to be mistaken for a failure.
// That also fixes the layout at the default — the chosen one arrives over MQTT,
// so only the firmware suite compares the alternatives.

import { chromium } from 'playwright';
import { FONT_H, GLYPH_SMALL } from '../src/panelGlyphs.js';
// Which square each letter lands on, so the splash block can ask whether the bags are
// still in the air without knowing the order they were thrown in.
import { LOGO_CORN_LETTERS, LOGO_HOLE_LETTERS } from '../src/panelLogo.js';
import {
  DIGIT_Y,
  PANEL_H,
  PANEL_W,
  SPLASH_ANIM_MS,
  SPLASH_DOT,
  SPLASH_MS,
} from '../src/panelRender.js';

const BASE = 'http://localhost:4173/';
// Refused fast rather than left to time out, so the board settles on "offline".
const OFFLINE = 'broker=wss://127.0.0.1:1/mqtt&code=abc12';
// The dash is segment g: the middle bar of a digit drawn at DIGIT_Y. Derived
// rather than written out, so moving the digits doesn't leave this sampling a row
// of unlit LEDs and calling it a pass.
const DASH_ROW = DIGIT_Y + Math.trunc(GLYPH_SMALL.h / 2) - 1;
// A row through the middle of the 5x7 link line, which sits in the name row. Derived
// the same way and for the same reason: pinned to 0 it would sample the glyphs' top
// edge, where several characters have nothing.
const LINK_ROW = Math.trunc(FONT_H / 2);

let failures = 0;
const check = (label, cond, detail = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
};

const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome' });

// Reported rather than awaited: a routing regression means this selector never
// appears, and waiting on it would time out the whole run instead of saying
// which assertion failed.
const appeared = (page, selector) =>
  page.waitForSelector(selector, { timeout: 5000 }).then(
    () => true,
    () => false,
  );

// Sampled at LED centres, where the dot's own opaque fill wins over any neighbour's
// halo, so a row with nothing on it reads as the unlit grey.
const scanRows = (page, cell, rows) =>
  page.evaluate(
    ({ panelW, cell: c, rows: want }) => {
      const canvas = document.querySelector('.panel-canvas');
      const ctx = canvas.getContext('2d');
      const dpr = canvas.width / (panelW * c);
      const brightness = (x, y) => {
        const d = ctx.getImageData(
          Math.floor((x * c + c / 2) * dpr),
          Math.floor((y * c + c / 2) * dpr),
          1,
          1,
        ).data;
        return d[0] + d[1] + d[2];
      };
      return want.map((y) => Array.from({ length: panelW }, (_, x) => brightness(x, y)));
    },
    { panelW: PANEL_W, cell, rows },
  );

// The whole panel in one read, sampled at LED centres like scanRows. One getImageData
// rather than 4096 of them, because the splash block needs every row to measure where
// the wordmark reaches.
const scanPanel = (page, cell) =>
  page.evaluate(
    ({ panelW, panelH, cell: c }) => {
      const canvas = document.querySelector('.panel-canvas');
      const ctx = canvas.getContext('2d');
      const dpr = canvas.width / (panelW * c);
      const { data, width } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const at = (x, y) => {
        const i = (Math.floor((y * c + c / 2) * dpr) * width + Math.floor((x * c + c / 2) * dpr)) * 4;
        return data[i] + data[i + 1] + data[i + 2];
      };
      return Array.from({ length: panelH }, (_, y) =>
        Array.from({ length: panelW }, (_, x) => at(x, y)),
      );
    },
    { panelW: PANEL_W, panelH: PANEL_H, cell },
  );

// Measured, on the LED-centre samples: an unlit dot reads 72, a bright neighbour's halo
// lifts one to about 95, and the faintest coverage pixel the wordmark carries reads about
// 200. Comparing against the row's own minimum instead is what this replaced — the
// minimum wobbles by a pixel of antialiasing, and when it landed on 71 every unlit LED
// counted as lit, so the old assertion passed on 122 LEDs of noise.
const LIT = 150;

const cellSize = (page) =>
  page.locator('.panel-canvas').evaluate((c) => c.getBoundingClientRect().width / 128);

console.log('?panel=1 routes to the panel, not the app');
{
  const page = await browser.newPage({ viewport: { width: 430, height: 500 } });
  await page.goto(`${BASE}?panel=1`);
  const mounted = await appeared(page, '.panel');
  check('the panel mounted', mounted);
  check('the scoring app is not what loaded', (await page.locator('.setup').count()) === 0);
  check('and it says how to configure it', (await page.locator('.panel-message').count()) === 1);
  if (mounted) {
    // A container narrower than the viewport means the page background shows
    // beside the board, which reads as a broken layout rather than a hint.
    const width = await page.locator('.panel').evaluate((e) => e.getBoundingClientRect().width);
    check('the board fills the viewport', width === 430, `${width}px of 430`);
  }
  await page.close();
}

// Add to Home Screen reads the manifest, so the app's `start_url: '/'` is what a board
// icon opened before this — the scorer, on the tablet propped against the fence. Only a
// browser can see main.jsx swap the link, and the two halves have to be checked together:
// a board manifest that named a `start_url` would install just as cleanly and still throw
// the query string away, which is the broker, the code and the password.
console.log('\nthe board views link a manifest that keeps the query string');
for (const [view, file] of [
  ['panel', 'panel.webmanifest'],
  ['display', 'display.webmanifest'],
]) {
  const page = await browser.newPage();
  await page.goto(`${BASE}?${view}=1&${OFFLINE}`);
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  check(`?${view}=1 links its own manifest`, href === `/${file}`, href ?? 'no manifest link');
  const manifest = href && (await page.evaluate((h) => fetch(h).then((r) => r.json()), href));
  // Absent, not `/?panel=1`: the fallback for a missing start_url is the page that linked
  // the manifest, which is the only route by which the broker details reach a fresh
  // install — a home-screen web app does not get the storage this tab wrote them to.
  check('and names no start_url', Boolean(manifest) && !('start_url' in manifest));
  // Without this iOS adds a Safari bookmark rather than a web app, and the board loses
  // both the fullscreen tap and any chance of the wake lock.
  check('and still installs standalone', manifest && manifest.display === 'standalone');
  await page.close();
}

// The pixel check proves drawSplash draws the wordmark, every offset every bag passes
// through and both boards' knocks; it cannot see whether Panel.jsx ever puts it on screen,
// that it hands over a clock that moves, or that it gets out of the way again. All three
// matter: a splash that never cleared would hide the score for the whole game, and one
// drawn at a fixed elapsed would be a still of an animation that every hermetic check
// would pass.
//
// So this block asks only what a browser can answer. The shape of the flight — the arc,
// where a bag starts, the knock a landing gives the board — is asserted off the
// framebuffer in test_render.cpp, where it belongs; repeating it here would be a check
// that cannot fail.
//
// The clock is installed *and paused* so the animation can be stepped through at chosen
// times rather than caught. Both halves are needed: install() on its own leaves the clock
// ticking with real time — measured, 503ms of it for a 500ms wait — so every frame here
// would land wherever the round trips to the browser happened to leave it. With a 2.5s
// splash and nothing moving that was merely invisible; with an animation the mid-flight
// read drifted to within a couple of pixels of settled.
const CLOCK_START = 1700000000000;
console.log('\nthe splash throws the letters in at startup, then clears');
{
  const page = await browser.newPage({ viewport: { width: 1000, height: 400 } });
  await page.clock.install({ time: CLOCK_START });
  await page.clock.pauseAt(CLOCK_START);
  await page.goto(`${BASE}?panel=1&${OFFLINE}`);
  const MIDDLE = Math.trunc(PANEL_H / 2);
  let cell = 0;
  // React schedules its re-render off a message channel, which the fake clock does not
  // drive, so the frame has to be given a moment of real time to be painted.
  //
  // Rows 2 down, because the connect indicator sits in rows 0-1 and is not part of the
  // mark. How far the lit pixels reach is what says where the two words are: measuring
  // one row cannot, since a row crosses letters wherever the words happen to be.
  const painted = async () => {
    await page.waitForTimeout(100);
    const grid = await scanPanel(page, cell);
    let count = 0;
    let min = PANEL_W;
    let max = -1;
    for (let y = 2; y < PANEL_H; y += 1) {
      for (let x = 0; x < PANEL_W; x += 1) {
        if (grid[y][x] > LIT) {
          count += 1;
          if (x < min) min = x;
          if (x > max) max = x;
        }
      }
    }
    return { count, min, max, grid };
  };
  if (!(await appeared(page, '.panel-canvas'))) {
    check('the canvas is on the page', false, 'nothing else in this block can run');
  } else {
    cell = await cellSize(page);
    check('the caption says it is starting up', (await page.locator('.panel-caption').innerText()).includes('Starting up'));

    // Before the first bag is let go the two boards are up and every letter's square is
    // empty. This is what a splash drawn at a fixed elapsed fails: drawn settled from the
    // first frame, the letters are already in place here.
    const squares = [...LOGO_HOLE_LETTERS, ...LOGO_CORN_LETTERS];
    const filled = (grid) =>
      squares.filter((r) => {
        for (let y = r.y0; y <= r.y1; y += 1) {
          for (let x = r.x0; x <= r.x1; x += 1) if (grid[y][x] > LIT) return true;
        }
        return false;
      }).length;

    const start = await painted();
    check('the two boards are up from the first frame', start.count > 0, `${start.count} LEDs lit`);
    check('and every letter is still to be thrown', filled(start.grid) === 0,
      `${filled(start.grid)} of ${squares.length} squares filled`);
    const dot = start.grid[0].slice(PANEL_W - SPLASH_DOT).filter((v) => v > LIT).length;
    check('the connect indicator is lit in the corner', dot === SPLASH_DOT, `${dot} of ${SPLASH_DOT} LEDs`);

    // Part way through, a bag is in the air — which is measured against the settled frame
    // below rather than by counting: a bag anywhere but on its own square lights LEDs the
    // finished mark leaves dark, and which bag that is depends on a shuffle this check
    // cannot see.
    //
    // 630ms is the top of the second bag's arc — one flight in, plus half of the next — so
    // the first bag has stopped, no knock is in progress, and the only thing off the mark
    // is that one bag, displaced in both axes and well onto the panel. Reading just after
    // a release instead would catch a bag barely clear of its own edge, which is a handful
    // of LEDs and too thin to assert on.
    await page.clock.runFor(630);
    const flying = await painted();

    // And then everything stops on its own square, inside both edges.
    await page.clock.runFor(SPLASH_ANIM_MS);
    const settled = await painted();
    check(
      'the wordmark settles whole, clear of both edges',
      settled.count > flying.count && settled.min > 0 && settled.max < PANEL_W - 1,
      `${settled.count} LEDs against ${flying.count} in flight, columns ${settled.min}-${settled.max}`,
    );
    check('every bag ends up on its own square', filled(settled.grid) === squares.length,
      `${filled(settled.grid)} of ${squares.length}`);

    let airborne = 0;
    for (let y = 2; y < PANEL_H; y += 1) {
      for (let x = 0; x < PANEL_W; x += 1) {
        if (flying.grid[y][x] > LIT && settled.grid[y][x] <= LIT) airborne += 1;
      }
    }
    check(
      'part way through, bags are lighting LEDs the finished mark does not',
      airborne > 0,
      `${airborne} LEDs off the mark`,
    );

    await page.clock.runFor(SPLASH_MS + 100);
    const after = await painted();
    // The middle row, not the whole panel: the no-state dashes the score screen draws
    // are a single rule at DASH_ROW, and they are not the wordmark coming back.
    const stillLit = after.grid[MIDDLE].filter((v) => v > LIT).length;
    check('the splash clears and the wordmark goes with it', stillLit === 0, `${stillLit} LEDs still lit`);
    check(
      'and the indicator is not left behind on the score screen',
      after.grid[0].slice(PANEL_W - SPLASH_DOT).every((v) => v <= LIT),
    );
  }
  await page.close();
}

console.log('\nthe emulator draws the framebuffer onto the canvas');
{
  const page = await browser.newPage({ viewport: { width: 1000, height: 400 } });
  page.on('pageerror', (e) => {
    console.log('  PAGE ERROR', e.message);
    failures++;
  });
  await page.goto(`${BASE}?panel=1&${OFFLINE}`);
  if (!(await appeared(page, '.panel-canvas'))) {
    check('the canvas is on the page', false, 'nothing else in this block can run');
    await page.close();
    await browser.close();
    console.log(`\n${failures} FAILED`);
    process.exit(1);
  }

  const geometry = await page.locator('.panel-canvas').evaluate((c) => ({
    cssWidth: c.getBoundingClientRect().width,
    cssHeight: c.getBoundingClientRect().height,
    pixelWidth: c.width,
  }));
  const cell = geometry.cssWidth / PANEL_W;
  check('the canvas is a whole number of LEDs wide', Number.isInteger(cell), `${cell}px per LED`);
  check(
    'and keeps the panel aspect',
    Math.round(geometry.cssHeight) === Math.round(geometry.cssWidth * (PANEL_H / PANEL_W)),
    `${geometry.cssWidth}x${geometry.cssHeight}`,
  );
  check(
    'and is backed at device resolution',
    geometry.pixelWidth >= geometry.cssWidth,
    `${geometry.pixelWidth} device px`,
  );

  // The splash owns the panel for its first seconds, so waiting it out is what makes
  // the dashes the frame being sampled. Real time here, not a fake clock: the caption
  // poll below needs the reconnect timers to fire.
  await page.waitForFunction(
    () => !document.querySelector('.panel-caption').innerText.includes('Starting up'),
    null,
    { timeout: SPLASH_MS + 5000 },
  );

  // The blank row is the panel's last, not its first: the full layout leaves rows
  // 30-31 dark, and row 0 is where the no-state screen's link line goes. Sampling
  // there made the *status line* the floor, which put the dim dashes under it.
  const [dash, other, link] = await scanRows(page, cell, [DASH_ROW, PANEL_H - 1, LINK_ROW]);
  const floor = Math.max(...other);
  const lit = dash.map((v) => v > floor);
  const litCount = lit.filter(Boolean).length;

  check(
    'the dash row is brighter than a row with nothing on it',
    Math.max(...dash) > floor,
    `dash ${Math.max(...dash)} vs blank ${floor}`,
  );

  // Four dashes — two scores of two digits — so four runs of lit LEDs.
  let runs = 0;
  for (let x = 0; x < lit.length; x++) if (lit[x] && !lit[x - 1]) runs++;
  check('four dashes are drawn', runs === 4, `${runs} runs, ${litCount} LEDs`);

  // The link line, which is the one thing about this screen a browser can see and the
  // pixel check cannot: render.h draws it from an argument, and whether `Panel.jsx`
  // ever passes that argument is a crossing only this reaches.
  const linkLit = link.filter((v) => v > floor).length;
  check('the link line is drawn above the dashes', linkLit > 0, `${linkLit} LEDs lit`);
  check(
    'and is brighter than the stale dashes it explains',
    Math.max(...link) > Math.max(...dash),
    `link ${Math.max(...link)} vs dash ${Math.max(...dash)}`,
  );

  // *Which* state, read off the canvas's own label rather than the pixels — it is the
  // same `connect` the framebuffer was drawn from, and no scan of a 5x7 row can spell.
  //
  // This is the assertion the block exists for now. The broker is unreachable and the
  // machine's network is not, so the answer is "no broker" and it does not move:
  // mqtt.js cycles offline → connecting → error underneath, and a status line that
  // followed the socket's mood flipped between "no network" and "no broker" for the
  // whole run — on the one screen whose job is to say which of those it is. Polled
  // because the cycle is what it must survive, not a state it can be caught before.
  const label = () => page.locator('.panel-canvas').getAttribute('aria-label');
  let wrong = 0;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (!(await label()).includes('no broker')) wrong += 1;
    await page.waitForTimeout(250);
  }
  check(
    'and says "no broker" throughout, never "no network"',
    wrong === 0,
    `${wrong} of 12 samples wrong, last "${await label()}"`,
  );

  // The other branch, which only a browser can reach: the board reads WiFi.status()
  // and the emulator reads navigator.onLine, so taking the context offline is the one
  // way to see the screen a board that never joined the AP would show.
  await page.context().setOffline(true);
  await page.waitForFunction(() => navigator.onLine === false, null, { timeout: 5000 });
  check(
    'and "no network" once the machine really has none',
    (await label()).includes('no network'),
    await label(),
  );
  await page.context().setOffline(false);

  // Polled rather than read once: with an unreachable broker the status cycles
  // offline → connecting → error every RECONNECT_PERIOD, so a single read can
  // land in one of the brief non-offline windows. The frame stays dimmed
  // throughout either way — this is about the caption wording, not the pixels.
  const caption = () => page.locator('.panel-caption').innerText();
  let settled = await caption();
  for (let attempt = 0; attempt < 20 && !settled.includes('offline'); attempt += 1) {
    await page.waitForTimeout(250);
    settled = await caption();
  }
  check('and dimmed, because no scorer is connected', settled.includes('offline'), settled);
  await page.close();
}

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nall panel emulator checks passed');
process.exit(failures ? 1 : 0);
