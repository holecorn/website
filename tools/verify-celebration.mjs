// The win moment, measured as paint order.
//
// A game ending fires four things at once: the winner banner, the round callout, the
// four-bagger reveal if the winning round was one, and 70 confetti pieces — half of them
// in the winning team's own colour, falling over the winning score in that same colour.
// Measured before this check existed, at 390x844 with the worst case the app can make
// (four in the hole twice, 24–0, so a skunk and a four bagger): a peak of 34 pieces over
// the header band, 6 of them on the winning digits' ink box, covering 24.9% of it.
//
// Nothing in a unit test can see paint order, and nothing in the stylesheets can either:
// the confetti used to be a *child* of `.callout`, so it inherited that overlay's
// z-index and no z-index anywhere was wrong. Both halves — the markup and the number —
// have to be right for the digits to stay on top, which is why this measures the pixels'
// stacking rather than reading either one.
//
//   npm run test:browser  (or a preview on 4173, then node tools/verify-celebration.mjs)

import { chromium } from 'playwright';

const URL = 'http://localhost:4173/';

// The fall is 1000–1700ms with a 0–150ms delay, all per piece and all random, so which
// frame has pieces on the digits differs every run. Scanning the whole crossing and
// aggregating is what keeps that out of the result.
const FROM = 250;
const TO = 1000;
const STEP = 25;

let failures = 0;
const check = (label, cond, detail = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
};

const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => {
  console.log('  PAGE ERROR', e.message);
  failures++;
});
// Runtime errors only. React's own warnings are *not* reachable from here — splitting one
// keyed overlay into two siblings gave both children the same key, which it complains
// about loudly in `npm run dev` and not at all in the production build these checks run
// against. Verified by mutation: putting the duplicate key back passes this file clean.
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  console.log('  CONSOLE ERROR', m.text());
  failures++;
});

await page.goto(URL);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('.setup');
const fields = page.locator('.team-name-input');
await fields.nth(0).fill('Rho');
await fields.nth(1).fill('Sigma');
await page.getByRole('button', { name: 'Start', exact: true }).click();
await page.waitForSelector('.lane');

// The celebration clears itself after 2600ms, and a frame that has been unmounted cannot
// be measured. Every timer the app sets from here is shorter than that except the ones
// that end it.
await page.evaluate(() => {
  const real = window.setTimeout;
  window.setTimeout = (fn, d, ...rest) => (d >= 1000 ? 0 : real(fn, d, ...rest));
});

for (let round = 0; round < 2; round += 1) {
  for (let i = 0; i < 4; i += 1) await page.locator('.team-lanes').nth(0).locator('.lane').nth(i).locator('.tier-hole').click();
  // Two presses: the first puts the other side's four on the floor, the second commits.
  await page.locator('.end-round').click();
  await page.locator('.end-round').click();
  await page.waitForFunction(() => document.querySelectorAll('.lane input:checked').length === 0);
}
// The banner comes straight off the reducer and the callout off an effect, so waiting on
// the banner lands a render too early and finds no confetti at all. Caught rather than
// left to throw: with the confetti gone this is the first thing to notice, and a 30s
// timeout ending in a stack trace says far less than the guard below does.
await page.waitForSelector('.confetti-piece', { timeout: 4000 }).catch(() => {});

console.log('the confetti falls behind the score it is celebrating');
const seen = await page.evaluate(({ from, to, step }) => {
  // Hit-testing skips `pointer-events: none`, and every piece has it. Paint order is
  // unaffected by the property, so lifting it is how the stacking becomes readable.
  const lift = document.createElement('style');
  lift.textContent = '.confetti-piece { pointer-events: auto }';
  document.head.append(lift);

  const win = document.querySelector('.team-score.is-winner .score');
  const box = win.getBoundingClientRect();
  // The digits' ink, not the element box: `.score` is 56px of line box and the glyphs
  // fill about two thirds of it, so the box counts whitespace as though it were a score.
  const cv = document.createElement('canvas').getContext('2d');
  const cs = getComputedStyle(win);
  cv.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const m = cv.measureText(win.textContent);
  const baseline =
    box.top + (box.height - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 +
    m.fontBoundingBoxAscent;
  const ink = {
    left: box.left + (box.width - m.width) / 2,
    top: baseline - m.actualBoundingBoxAscent,
    width: m.width,
    height: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent,
  };

  let onDigits = 0;
  let above = 0;
  let worst = { at: from, on: 0 };
  for (let at = from; at <= to; at += step) {
    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = at;
    }
    let onThisFrame = 0;
    for (let y = ink.top + 2; y < ink.top + ink.height; y += 4) {
      for (let x = ink.left + 2; x < ink.left + ink.width; x += 4) {
        // Topmost first, so an index below the score's is a piece painted over it.
        const stack = document.elementsFromPoint(x, y);
        const piece = stack.findIndex((el) => el.classList.contains('confetti-piece'));
        if (piece < 0) continue;
        onDigits++;
        onThisFrame++;
        if (piece < stack.indexOf(win)) above++;
      }
    }
    if (onThisFrame > worst.on) worst = { at, on: onThisFrame };
  }
  lift.remove();
  return { onDigits, above, worst, pieces: document.querySelectorAll('.confetti-piece').length, ink };
}, { from: FROM, to: TO, step: STEP });

// The guard, and it is the whole reason the assertion below can fail: a frame with no
// piece anywhere near the digits reports nothing painted over them however the stacking
// is set up — including with the confetti deleted outright.
check(
  'the pieces still fall across the digits',
  seen.onDigits > 0,
  `${seen.pieces} pieces, ${seen.onDigits} samples across ${FROM}–${TO}ms, worst frame ${seen.worst.at}ms with ${seen.worst.on}`,
);
check(
  'and not one of them is painted over them',
  seen.above === 0,
  `${seen.above} of ${seen.onDigits} samples have a piece above the score`,
);

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nall good');
process.exit(failures ? 1 : 0);
