// The win moment: what paints over what, and how many overlays fire at once.
//
// A round can set off four things together — the winner banner, the round callout, the
// four-bagger reveal, and 70 confetti pieces in the winning team's own colour falling over
// the winning score in that same colour. Two separate faults live in that pile-up and this
// file holds both, because neither is reachable from a unit test: paint order is invisible
// to `css.test.js` as well, and the effect that decides which overlays fire is in
// `App.jsx`, which the node-environment suites cannot import.
//
//   1. The confetti used to be a *child* of `.callout`, so it inherited that overlay's
//      z-index and no z-index anywhere was wrong. Measured at 390x844 on the worst case
//      the app can make: a peak of 34 pieces over the header band, 6 of them on the
//      winning digits' ink box, covering 24.9% of it.
//   2. `.four-bagger` is anchored to a lane card and `.callout` to the viewport, so
//      nothing kept the two apart. Measured at 874x402 they overlapped by 17.1% and took
//      the `R!` off FOUR BAGGER!. The callout carries the words itself now.
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

// One game, played to a given target, with a four bagger for team A and optionally for
// team B as well. A four bagger nets 12, so `target: 12` makes a single round a win, a
// skunk and a four bagger at once — where two rounds to 21 leave the *first* round's own
// four-bagger overlay still mounted under the timer patch, which reads as the fault.
async function play({ width, height, target, bothTeams = false }) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (e) => {
    console.log('  PAGE ERROR', e.message);
    failures++;
  });
  // Runtime errors only. React's own warnings are *not* reachable from here — splitting
  // one keyed overlay into two siblings gave both children the same key, which it
  // complains about loudly in `npm run dev` and not at all in the production build these
  // checks run against. Verified by mutation: putting the duplicate key back passes clean.
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
  await page.locator('.target-field input').fill(String(target));
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.waitForSelector('.lane');

  // The celebration clears itself after 1600–2600ms, and a frame that has been unmounted
  // cannot be measured. Every timer the app sets from here is shorter than that except
  // the ones that end it.
  await page.evaluate(() => {
    const real = window.setTimeout;
    window.setTimeout = (fn, d, ...rest) => (d >= 1000 ? 0 : real(fn, d, ...rest));
  });

  for (const team of bothTeams ? [0, 1] : [0])
    for (let i = 0; i < 4; i += 1)
      await page.locator('.team-lanes').nth(team).locator('.lane').nth(i).locator('.tier-hole').click();
  // Two presses when one side's bags are still out: the first puts them on the floor, the
  // second commits. With both sides thrown the first press already commits.
  await page.locator('.end-round').click();
  if (!bothTeams) await page.locator('.end-round').click();
  await page.waitForFunction(() => document.querySelectorAll('.lane input:checked').length === 0);
  // The lanes clearing is the reducer's render and every overlay comes from the effect
  // after it, so reading straight off the commit lands early and finds nothing at all.
  // Waiting for *either* overlay rather than the expected one is what keeps this a wait
  // and not an assertion; caught, so a round that draws neither is named below instead of
  // ending the run in a 30s timeout.
  await page
    .waitForSelector('.four-text, .callout-text', { timeout: 4000 })
    .catch(() => {});
  return page;
}

// What is on screen once a round has been committed, with the animations frozen at their
// peak so a box is measured at the size it is actually drawn.
const overlays = (page) =>
  page.evaluate(() => {
    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = 300;
    }
    const four = document.querySelector('.callout-four');
    const block = document.querySelector('.callout-text');
    const b = block?.getBoundingClientRect();
    return {
      reveals: document.querySelectorAll('.four-text').length,
      callouts: document.querySelectorAll('.callout-text').length,
      four: four?.textContent ?? null,
      fourLines: four ? four.getClientRects().length : 0,
      outcome: block ? block.lastChild.textContent : null,
      left: b ? Math.round(b.left) : null,
      right: b ? Math.round(b.right) : null,
      viewport: window.innerWidth,
    };
  });

console.log('a four-bagger win is one overlay, and the confetti falls behind the score');
const win = await play({ width: 390, height: 844, target: 12 });
// The banner comes straight off the reducer and the callout off an effect, so waiting on
// the banner lands a render too early and finds no confetti at all. Caught rather than
// left to throw: with the confetti gone this is the first thing to notice, and a 30s
// timeout ending in a stack trace says far less than the guard below does.
await win.waitForSelector('.confetti-piece', { timeout: 4000 }).catch(() => {});

const seen = await win.evaluate(({ from, to, step }) => {
  // Hit-testing skips `pointer-events: none`, and every piece has it. Paint order is
  // unaffected by the property, so lifting it is how the stacking becomes readable.
  const lift = document.createElement('style');
  lift.textContent = '.confetti-piece { pointer-events: auto }';
  document.head.append(lift);

  const scored = document.querySelector('.team-score.is-winner .score');
  const box = scored.getBoundingClientRect();
  // The digits' ink, not the element box: `.score` is 56px of line box and the glyphs
  // fill about two thirds of it, so the box counts whitespace as though it were a score.
  const cv = document.createElement('canvas').getContext('2d');
  const cs = getComputedStyle(scored);
  cv.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const m = cv.measureText(scored.textContent);
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
        if (piece < stack.indexOf(scored)) above++;
      }
    }
    if (onThisFrame > worst.on) worst = { at, on: onThisFrame };
  }
  lift.remove();
  return { onDigits, above, worst, pieces: document.querySelectorAll('.confetti-piece').length };
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

const won = await overlays(win);
check(
  'the four bagger is said on the callout',
  won.four === 'FOUR BAGGER!' && won.outcome === 'SKUNK!',
  `${JSON.stringify(won.four)} over ${JSON.stringify(won.outcome)}`,
);
check(
  'and `.four-bagger` does not fire beside it',
  won.reveals === 0 && won.callouts === 1,
  `${won.reveals} reveals, ${won.callouts} callouts`,
);
await win.close();

// The guard for the pair above: with `.four-bagger` gone altogether they both still pass,
// and the ordinary mid-game four bagger is the only thing that says it is still there.
console.log('\nan ordinary four bagger keeps its own reveal');
const mid = await play({ width: 390, height: 844, target: 21 });
const midway = await overlays(mid);
check(
  'the reveal fires on a round that ends nothing',
  midway.reveals === 1,
  `${midway.reveals} reveals`,
);
check('and no callout goes with it', midway.callouts === 0, `${midway.callouts} callouts`);
await mid.close();

// Two four baggers is the only round that reads FOUR BAGGERS!, and it is also the round
// that used to draw three big texts at once — the wash plus a reveal on each card.
console.log('\na wash carrying two four baggers is still one overlay, at 320px');
const wash = await play({ width: 320, height: 568, target: 21, bothTeams: true });
const washed = await overlays(wash);
check(
  'both are said once, in the plural',
  washed.four === 'FOUR BAGGERS!' && washed.outcome === 'WASH!' && washed.reveals === 0,
  `${JSON.stringify(washed.four)} over ${JSON.stringify(washed.outcome)}, ${washed.reveals} reveals`,
);
// Nothing clips or wraps a callout — `.callout` has no `overflow` and the text no
// `nowrap` — so the widest wording on the narrowest screen is the case to measure.
check(
  'and the block fits the screen at full scale on one line each',
  washed.left >= 0 && washed.right <= washed.viewport && washed.fourLines === 1,
  `${washed.left}–${washed.right} of ${washed.viewport}px, ${washed.fourLines} line(s)`,
);
await wash.close();

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nall good');
process.exit(failures ? 1 : 0);
