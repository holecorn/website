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
import { GLYPH_SMALL } from '../src/panelGlyphs.js';
import { DIGIT_Y, PANEL_H, PANEL_W, SPLASH_DOT, SPLASH_MS } from '../src/panelRender.js';

const BASE = 'http://localhost:4173/';
// Refused fast rather than left to time out, so the board settles on "offline".
const OFFLINE = 'broker=wss://127.0.0.1:1/mqtt&code=abc12';
// The dash is segment g: the middle bar of a digit drawn at DIGIT_Y. Derived
// rather than written out, so moving the digits doesn't leave this sampling a row
// of unlit LEDs and calling it a pass.
const DASH_ROW = DIGIT_Y + Math.trunc(GLYPH_SMALL.h / 2) - 1;

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

// The pixel check proves drawSplash draws the wordmark; it cannot see whether Panel.jsx
// ever puts it on screen, or that it gets out of the way again. Both halves matter: a
// splash that never cleared would hide the score for the whole game.
//
// The clock is installed so the 2.5s cannot expire between loading the page and reading
// the canvas — the assertion would otherwise pass or fail on how warm the preview
// server is. Nothing in this block depends on a timer firing.
console.log('\nthe splash is shown at startup, then clears');
{
  const page = await browser.newPage({ viewport: { width: 1000, height: 400 } });
  await page.clock.install();
  await page.goto(`${BASE}?panel=1&${OFFLINE}`);
  if (!(await appeared(page, '.panel-canvas'))) {
    check('the canvas is on the page', false, 'nothing else in this block can run');
  } else {
    const cell = await cellSize(page);
    // The middle row carries the wordmark and nothing else does at startup; row 0 holds
    // only the connect indicator, in the last SPLASH_DOT columns.
    const [middle, top] = await scanRows(page, cell, [Math.trunc(PANEL_H / 2), 0]);
    const floor = Math.min(...top);
    const dot = top.slice(PANEL_W - SPLASH_DOT).filter((v) => v > floor).length;

    check('the caption says it is starting up', (await page.locator('.panel-caption').innerText()).includes('Starting up'));
    check(
      'the wordmark is lit across the middle of the panel',
      middle.filter((v) => v > floor).length > 20,
      `${middle.filter((v) => v > floor).length} LEDs`,
    );
    check('the connect indicator is lit in the corner', dot === SPLASH_DOT, `${dot} of ${SPLASH_DOT} LEDs`);

    await page.clock.runFor(SPLASH_MS + 100);
    const [middleAfter, topAfter] = await scanRows(page, cell, [Math.trunc(PANEL_H / 2), 0]);
    const floorAfter = Math.min(...topAfter);
    check(
      'the splash clears and the wordmark goes with it',
      middleAfter.filter((v) => v > floorAfter).length === 0,
      `${middleAfter.filter((v) => v > floorAfter).length} LEDs still lit`,
    );
    check(
      'and the indicator is not left behind on the score screen',
      topAfter.slice(PANEL_W - SPLASH_DOT).every((v) => v <= floorAfter),
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

  const [dash, other] = await scanRows(page, cell, [DASH_ROW, 0]);
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
