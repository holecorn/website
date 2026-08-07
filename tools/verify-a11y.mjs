// Whether a round can be scored without seeing the screen.
//
// The lanes are the whole app: twelve tap targets per team, and where a bag is
// resting is drawn as the vertical position of a coloured square. Measured before
// the fix, on a doubles game with one bag in the hole and one on the board: **24
// buttons, all named `bag hole` / `bag board` / `bag floor`** — no team, no bag
// number, no lane boundary, and the token itself a bare `<div>` that Chrome drops
// from the tree, so nothing at all reported where any bag was. Four bags in three
// states produced twelve identical announcements. You could not check what you had
// entered, and so could not correct a mistap.
//
// None of it is reachable from a unit test: `vitest.config.js` is
// `environment: 'node'` and no test imports a `.jsx`, so roles and names only
// exist in a browser.
//
// The tab-stop count is here because it is the one number that says the grouping
// is real rather than decorative. Native radios grouped by `name` are what give
// it: drop the attribute and the roles and labels all still read correctly while
// the count goes back to 24.

import { chromium } from 'playwright';

const URL = 'http://localhost:4173/';

let failures = 0;
const check = (label, cond, detail = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
};

const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
page.on('pageerror', (e) => {
  console.log('  PAGE ERROR', e.message);
  failures++;
});

// Doubles, so the lane labels have to name the partner who is actually up rather
// than the team — the two differ every round, and only one of them is right.
await page.goto(URL);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('.setup');
await page.getByRole('button', { name: 'Doubles' }).click();
const fields = page.locator('.team-name-input');
for (const [i, n] of ['Rho', 'Tau', 'Sigma', 'Phi'].entries()) await fields.nth(i).fill(n);
await page.getByRole('button', { name: 'Start', exact: true }).click();
await page.waitForSelector('.lane');

const lanesOf = (team) => page.locator('.team-lanes').nth(team).locator('.lane');

console.log('every lane says whose bag it is and which one');
{
  const groups = page.getByRole('radiogroup');
  check('one group per bag', (await groups.count()) === 8, `${await groups.count()}`);
  for (const team of [0, 1]) {
    // Read from the card's own heading rather than written down here, so the label
    // cannot drift from the name on screen — in doubles that name changes hands
    // every round.
    const up = await page.locator('.lanes-team').nth(team).innerText();
    const names = await lanesOf(team).evaluateAll((els) =>
      els.map((el) => el.getAttribute('aria-label')),
    );
    check(
      `team ${team + 1}: four distinct bags, all named for ${up}`,
      names.join('|') === [1, 2, 3, 4].map((n) => `${up}, bag ${n}`).join('|'),
      names.join(' / '),
    );
  }
}

console.log('\nand where the bag is resting is part of the tree');
{
  await lanesOf(0).nth(0).locator('.tier-hole').click();
  await lanesOf(0).nth(1).locator('.tier-board').click();
  const checked = page.getByRole('radio', { checked: true });
  check('two placed bags, two checked options', (await checked.count()) === 2, `${await checked.count()}`);
  check(
    'named for the tier they are resting on',
    (await checked.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')).join(','))) ===
      'hole,board',
  );
  check(
    'and a bag not yet thrown has none of the three',
    (await lanesOf(0).nth(2).getByRole('radio', { checked: true }).count()) === 0,
  );
  // Three options offered per lane and never a fourth: `unthrown` is not a place a
  // bag can be put back to, and offering it would be a rule the lanes alone broke.
  check('three options in a lane, no way back to unthrown', (await lanesOf(0).nth(2).getByRole('radio').count()) === 3);
}

console.log('\nand a round can be played on the keyboard alone');
{
  // Focus lands on the *checked* option where there is one, which is what makes the
  // grouping worth having: you arrive at the bag where you left it.
  await page.evaluate(() => {
    // Blur alone will not do it — the sequential focus navigation starting point
    // survives a blur, so Tab would resume from the last thing clicked.
    document.body.tabIndex = -1;
    document.body.focus();
  });
  const stops = [];
  for (let i = 0; i < 80; i += 1) {
    await page.keyboard.press('Tab');
    const at = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      // Stamped, because the class alone repeats and a repeat would end the walk
      // early — every lane's tab stop is a `.tier-zone`.
      window.__seen = (window.__seen ?? 0) + 1;
      el.dataset.a11yProbe ??= String(window.__seen);
      return `${el.dataset.a11yProbe}|${el.className}`;
    });
    if (at === null || stops.includes(at)) break;
    stops.push(at);
  }
  const inLanes = stops.filter((s) => s.includes('tier-'));
  check('eight tab stops in the lanes, not twenty-four', inLanes.length === 8, `${inLanes.length}`);
  check(
    'each landing on the option the bag is already on',
    inLanes[0].includes('tier-hole') && inLanes[1].includes('tier-board'),
    inLanes.slice(0, 2).join(' / '),
  );

  const remaining = () => page.locator('.end-round').innerText();
  const was = await remaining();
  await lanesOf(1).nth(0).locator('.tier-hole').focus();
  await page.keyboard.press('ArrowDown');
  check(
    'and an arrow key places the bag rather than only moving focus',
    (await lanesOf(1).nth(0).getByRole('radio', { checked: true }).count()) === 1 &&
      (await remaining()) !== was,
    `${was} -> ${await remaining()}`,
  );
}

// The controlled-radio trap, and the one failure here that would not be a wrong
// announcement but a game that cannot be scored: if the reset left the DOM checked,
// choosing the same tier again fires no change event and the bag is never placed.
// Other checks would catch it, but as `End round` never enabling — a timeout naming
// nothing.
console.log('\nand committing a round clears every choice');
{
  for (const team of [0, 1]) {
    for (let i = 0; i < 4; i += 1) await lanesOf(team).nth(i).locator('.tier-board').click();
  }
  await page.locator('.end-round').click();
  await page.waitForFunction(() => document.querySelector('.end-round')?.disabled === true);
  check('nothing is left checked', (await page.getByRole('radio', { checked: true }).count()) === 0);
  await lanesOf(0).nth(0).locator('.tier-board').click();
  check(
    'and the same tier can be chosen again',
    (await lanesOf(0).nth(0).getByRole('radio', { checked: true }).count()) === 1,
  );
}

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nall lane accessibility checks passed');
process.exit(failures ? 1 : 0);
