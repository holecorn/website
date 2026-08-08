// Whether a round can be scored without seeing the screen: entering one in the lanes,
// hearing what committing it did, and reading back what the earlier ones came to.
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
//
// The other half: committing the round was silent. Measured across every reachable
// state, the only live region on the play screen was the footer's save warning, which
// is empty unless the phone cannot write — so the score changing, WASH, a four bagger
// and the win were all announced to nobody.
//
// The third: the round history said `R1 2◎ 2▬ → +0 2◎ 2▬ → +0` and nothing else —
// measured from the accessibility tree, one list item, no team named anywhere in it.
// On a wash the two halves are byte-identical, so the only thing telling them apart
// was hue, and red against green is CIEDE2000 4.4 under deuteranopia. Two channels
// failing on one row: nothing to read, and nothing to look at either.

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
// By role rather than by selector, because that is what excludes a region an
// `aria-hidden` ancestor has taken out of the tree — clipped to a pixel is not
// hidden, but hidden from the tree is exactly the failure this file is about. The
// footer's save warning is the app's other live region, and it is outside `.main`.
const report = page.locator('.main').getByRole('status');
// `allInnerTexts` rather than `innerText`, so a region that is missing entirely
// fails the check it belongs to instead of throwing out of the whole file.
const spoken = async () => ((await report.allInnerTexts())[0] ?? '').replace(/\s+/g, ' ').trim();

console.log('the play screen has something that can speak, before it has anything to say');
{
  // Mounted empty rather than mounted on the first commit: a live region inserted
  // along with its content is announced unreliably, so a conditional one would
  // silently swallow round one.
  check('a live region is already in the tree', (await report.count()) === 1, `${await report.count()}`);
  check('and silent', (await spoken()) === '', JSON.stringify(await spoken()));
  const box = (await report.count()) === 1 ? await report.boundingBox() : { width: 0, height: 0 };
  check('and clipped away, not drawn', box.width <= 1 && box.height <= 1, `${box.width}x${box.height}`);
}

console.log('\nevery lane says whose bag it is and which one');
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

// Nine taps a round, and the ones that carry no points cost the same as the ones
// that do — so the button that was a disabled count of what was missing now offers
// to put the rest of them down. Two things have to hold, and neither is reachable
// from a unit test: the press must reach all eight lanes (filling one team is the
// plausible half-fix) and it must not commit, because a bag you forgot to score has
// to stay correctable until you end the round yourself. Its own label is also the
// only announcement the press gets — eight radios changing while focus sits on the
// button is silent — so the name has to change with what the next press will do.
console.log('\nand the bags still on the grass go down in one press');
{
  const tiers = () =>
    page
      .locator('.lane')
      .evaluateAll((els) =>
        els.map((el) => el.querySelector('input:checked')?.getAttribute('aria-label') ?? 'unthrown'),
      );
  const button = page.locator('.end-round');
  const before = await tiers();
  const out = before.filter((t) => t === 'unthrown').length;
  check(
    'the button offers it rather than only counting what is missing',
    (await button.innerText()) === `Remaining ${out} on the floor` && !(await button.isDisabled()),
    `${await button.innerText()}, ${out} unthrown`,
  );
  await button.click();
  const after = await tiers();
  check(
    'one press reaches every lane, and only the empty ones',
    after.join(',') === before.map((t) => (t === 'unthrown' ? 'floor' : t)).join(','),
    `${before.join(' ')} -> ${after.join(' ')}`,
  );
  check(
    'and it has not ended the round',
    (await page.locator('.scoreboard .score').allInnerTexts()).join('-') === '0-0' && (await spoken()) === '',
    `${(await page.locator('.scoreboard .score').allInnerTexts()).join('-')}, ${JSON.stringify(await spoken())}`,
  );
  check(
    'the same button now names the commit, which is what says the press changed',
    (await button.innerText()) === 'End round',
    await button.innerText(),
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
  await page.waitForFunction(() => document.querySelectorAll('.lane input:checked').length === 0);
  check('nothing is left checked', (await page.getByRole('radio', { checked: true }).count()) === 0);
  await lanesOf(0).nth(0).locator('.tier-board').click();
  check(
    'and the same tier can be chosen again',
    (await lanesOf(0).nth(0).getByRole('radio', { checked: true }).count()) === 1,
  );
}

// End round changes the score, clears eight bags and can finish the game, and the
// overlays that show it (`.callout`, `.four-bagger`) are `aria-hidden`. So this region
// is the only report of any of it. The sentence itself is `roundReport`, pinned string
// by string in `scoring.test.js`; what is left for here is that it reaches a live one.
console.log('\nand what the round did is said out loud');
{
  check(
    'the committed round, whose it was and where it leaves the score',
    (await spoken()) === 'Round 1: wash. Rho & Tau 0, Sigma & Phi 0.',
    await spoken(),
  );

  for (let round = 0; round < 2; round += 1) {
    for (let i = 0; i < 4; i += 1) await lanesOf(0).nth(i).locator('.tier-hole').click();
    for (let i = 0; i < 4; i += 1) await lanesOf(1).nth(i).locator('.tier-floor').click();
    await page.locator('.end-round').click();
    await page.waitForFunction(() => document.querySelectorAll('.lane input:checked').length === 0);
  }
  check(
    'the win, which only a banner and an aria-hidden callout showed before',
    (await spoken()) === 'Round 3: Rho & Tau scored 12. Four bagger! Rho & Tau win, 24 to 0. Skunk!',
    await spoken(),
  );
  check('the banner agrees with it', (await page.locator('.winner-banner').innerText()) === 'Rho & Tau win!');
}

// Round 1 above was a wash both sides threw the same way, which is the row the colour
// was carrying alone: the two halves are the same eleven characters. The sentences are
// `roundLine`, pinned in `scoring.test.js`; what is left for here is that they reach the
// tree, that the glyphs do not, and that the heading names the column it sits over.
console.log('\nand the history says whose each half of a row is');
{
  await page.getByRole('button', { name: /^History/ }).click();
  await page.waitForSelector('.history');

  const seen = await page
    .locator('.history tbody tr')
    .last()
    .locator('td [aria-hidden="true"]')
    .allInnerTexts();
  check('the two halves of the wash are the same characters', seen[0] === seen[1] && seen[0] === '0◎ 4▬ → +0', seen.join(' | '));

  const snap = await page.locator('.history').ariaSnapshot();
  const cells = [...snap.matchAll(/\bcell "(.+?)"/g)].map((m) => m[1]);
  check('every cell names its own side and what it did', cells.length === 6, `${cells.length}`);
  check(
    'including the wash, where the characters cannot',
    cells.slice(4).join(' | ') ===
      'Rho & Tau: 4 on the board, no points. | Sigma & Phi: 4 on the board, no points.',
    cells.slice(4).join(' | '),
  );
  // Glyphs, not words: a screen reader gets the Unicode names or nothing, and either
  // way it is read on top of the sentence that already said it.
  check('and the glyphs themselves are out of the tree', !snap.includes('◎'), snap.match(/.*◎.*/)?.[0] ?? '');
  // The heading is the seen half only. In the tree it would be announced against every
  // cell, each of which has already named the side.
  check('the heading is not announced a second time', !snap.includes('columnheader'));

  const head = page.locator('.history thead th');
  check(
    'and it names both sides where they are drawn',
    (await head.allInnerTexts()).join('|') === '|Rho & Tau|Sigma & Phi',
    (await head.allInnerTexts()).join('|'),
  );
  // Read in one pass rather than per element, so a heading that is missing altogether
  // fails these two as well instead of timing out of the whole file.
  const columns = await page.evaluate(() =>
    [1, 2].map((n) => {
      const at = (sel) => document.querySelector(`.history ${sel}:nth-child(${n + 1})`);
      const colour = (el) => (el ? getComputedStyle(el).color : null);
      return [colour(at('thead th')), colour(at('tbody tr td'))];
    }),
  );
  for (const [i, [heading, column]] of columns.entries()) {
    check(
      `heading ${i + 1} is the colour of the column under it`,
      heading !== null && heading === column,
      `${heading} vs ${column}`,
    );
  }
}

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nall lane accessibility checks passed');
process.exit(failures ? 1 : 0);
