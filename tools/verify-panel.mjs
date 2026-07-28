// The panel emulator (`?panel=1`), driven through the built app.
//
// What the framebuffer contains is not checked here — `npm run test:firmware`
// already holds src/panel.js pixel-identical to the firmware's render.h, which
// is a far stronger assertion than anything a browser could make. This covers
// only the two things that check cannot see: that the querystring still routes
// to the panel rather than falling through to the app, and that panelPaint.js
// puts the framebuffer's light on the canvas at all.
//
// The scene used is the no-state screen, because it needs no broker: an
// unreachable one leaves the board dimmed and showing four dashes, which is
// deterministic and is also the frame most likely to be mistaken for a failure.

import { chromium } from 'playwright';
import { GLYPH_DIGIT_H } from '../src/panelGlyphs.js';
import { PANEL_H, PANEL_W } from '../src/panel.js';

const BASE = 'http://localhost:4173/';
// Refused fast rather than left to time out, so the board settles on "offline".
const OFFLINE = 'broker=wss://127.0.0.1:1/mqtt&code=abc12';
// The dash is segment g, the middle bar of a digit that starts at DIGIT_Y=10.
const DASH_ROWS = [10 + Math.trunc(GLYPH_DIGIT_H / 2) - 1, 10 + Math.trunc(GLYPH_DIGIT_H / 2)];

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

  // Sampled at LED centres, where the dot's own opaque fill wins over any
  // neighbour's halo. Rows far from the dashes have no lit LED within reach, so
  // their centres are the unlit grey.
  const sampled = await page.evaluate(
    ({ panelW, cell: c, dashRows, blankRow }) => {
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
      const scan = (y) => Array.from({ length: panelW }, (_, x) => brightness(x, y));
      return { dash: scan(dashRows[0]), other: scan(blankRow) };
    },
    { panelW: PANEL_W, cell, dashRows: DASH_ROWS, blankRow: 0 },
  );

  const floor = Math.max(...sampled.other);
  const lit = sampled.dash.map((v) => v > floor);
  const litCount = lit.filter(Boolean).length;

  check(
    'the dash row is brighter than a row with nothing on it',
    Math.max(...sampled.dash) > floor,
    `dash ${Math.max(...sampled.dash)} vs blank ${floor}`,
  );

  // Four dashes — two scores of two digits — so four runs of lit LEDs.
  let runs = 0;
  for (let x = 0; x < lit.length; x++) if (lit[x] && !lit[x - 1]) runs++;
  check('four dashes are drawn', runs === 4, `${runs} runs, ${litCount} LEDs`);

  check(
    'and dimmed, because no scorer is connected',
    (await page.locator('.panel-caption').innerText()).includes('offline'),
    await page.locator('.panel-caption').innerText(),
  );
  await page.close();
}

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nall panel emulator checks passed');
process.exit(failures ? 1 : 0);
