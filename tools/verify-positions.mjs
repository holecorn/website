// The court diagram and the in-game stats panel, driven through the built app.
//
// `courtPositions()` and `gameStats()` are unit tested, so this covers only what
// they can't: that the panels are wired to the live game, that the phone toggles
// and the persistent wide-screen column are the same panels, and that the court
// and the scoring lanes name the same thrower. That last one is the failure the
// unit tests are blind to by construction — both sides derive the parity
// correctly and App.jsx could still hand the wrong one to the wrong component.

import { chromium } from 'playwright';

const URL = 'http://localhost:4173/';
const PHONE = { width: 390, height: 844 };
const WIDE = { width: 1180, height: 820 };

let failures = 0;
const check = (label, cond, detail = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
};

const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome' });

async function open(
  viewport,
  { mode = 'Doubles', names = ['Rho', 'Tau', 'Cat', 'Dan'], start = true } = {},
) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => {
    console.log('  PAGE ERROR', e.message);
    failures++;
  });
  await page.goto(URL);
  await page.waitForSelector('.setup');
  await page.getByRole('button', { name: mode }).click();
  const inputs = page.locator('.team-name-input');
  for (const [i, name] of names.entries()) await inputs.nth(i).fill(name);
  if (start) await page.getByRole('button', { name: 'Start', exact: true }).click();
  return page;
}

// Place all eight bags and commit. Every bag on the board is a wash, which keeps
// the first thrower still so the rounds stay predictable.
async function playRound(page, aTiers = ['board', 'board', 'board', 'board']) {
  const lanes = await page.locator('.lane').all();
  for (let i = 0; i < 4; i += 1) await lanes[i].locator(`.tier-${aTiers[i]}`).click();
  for (let i = 4; i < 8; i += 1) await lanes[i].locator('.tier-board').click();
  await page.locator('.end-round').click();
  // Committed once the lanes have reset, which disables End round again until
  // every bag of the next round is placed. This used to sleep 2.6s "so the
  // callout can't swallow a later click" — `.callout` is `pointer-events: none`,
  // so it never could, and the sleep was 2.6s per round of nothing.
  await page.waitForFunction(() => document.querySelector('.end-round')?.disabled === true, null, {
    timeout: 5000,
  });
}

const panel = (page) => ({
  court: page.locator('.positions'),
  stats: page.locator('.game-stats'),
  history: page.locator('.history-panel'),
});

console.log('the court names the same thrower as the scoring lanes');
{
  // Two independent derivations meet here: the lane headers come from `activeIdx`
  // in App.jsx, the boxes from `courtPositions`. Four rounds walks a full cycle
  // of the doubles swap.
  const page = await open(WIDE);
  for (let round = 1; round <= 4; round += 1) {
    const lit = await page.locator('.pitch-box.is-throwing').allInnerTexts();
    const laneNames = await page.locator('.lanes-team').allInnerTexts();
    const throwing = lit.map((s) => s.replace(/\s*\d+×4B$/, '').trim()).sort();
    check(
      `round ${round}: court and lanes agree`,
      JSON.stringify(throwing) === JSON.stringify([...laneNames].map((s) => s.trim()).sort()),
      `court ${throwing} vs lanes ${laneNames}`,
    );
    // The drawing is aria-hidden, so the prose is the only version of this a
    // screen reader gets. It has to name the same two people.
    const spoken = (await page.locator('.positions .visually-hidden').innerText()).trim();
    check(
      `round ${round}: the spoken summary names the same pair`,
      throwing.every((name) => spoken.includes(name)),
      spoken,
    );
    if (round < 4) await playRound(page);
  }
  await page.close();
}

console.log('\nthe name fields set the arrangement and the court reports it');
{
  // The controls and the drawing are in different panels now, so nothing below
  // App.jsx can catch a handler wired to the wrong player: a bag pointed at the
  // partner of the row it sits on passes every unit test.
  const page = await open(WIDE, { start: false });
  const court = page.locator('.positions');
  const row = (name) =>
    page.locator('.field-row').filter({ has: page.locator(`.team-name-input[value="${name}"]`) });
  const marked = async () => (await court.locator('.pitch-box.is-first').innerText()).trim();
  const nearNames = () =>
    court.locator('.court-end.at-near .pitch-box:not(.is-empty)').allInnerTexts();

  for (const name of ['Dan', 'Rho', 'Tau', 'Cat']) {
    await row(name).locator('.first-bag').click();
    check(`${name}'s bag gives them the opening throw`, (await marked()) === name, await marked());
  }
  check('and only one box carries it', (await court.locator('.pitch-box.is-first').count()) === 1);

  // The chip swaps the pair without touching who leads, which is the whole
  // reason it exists as well as the bag.
  await row('Rho').locator('.first-bag').click();
  const before = await marked();
  await row('Cat').locator('.end-chip').click();
  check('the chip moves that pair', (await nearNames()).join().includes('Dan'), (await nearNames()).join(', '));
  check('and leaves the lead alone', (await marked()) === before, `${before} -> ${await marked()}`);

  // Mirroring is the court's own control, and the only one left in the drawing.
  const sidesBefore = (await nearNames()).join(', ');
  await court.locator('.swap-sides').click();
  check(
    'the board mirrors the court',
    (await nearNames()).join(', ') !== sidesBefore,
    `${sidesBefore} -> ${(await nearNames()).join(', ')}`,
  );

  // A chip rearranges slots, so it has to survive Start rather than only
  // showing on the setup screen.
  await row('Tau').locator('.first-bag').click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const lanes = (await page.locator('.lanes-team').allInnerTexts()).map((s) => s.trim());
  check('the chosen player is up in the scoring lanes', lanes.includes('Tau'), lanes.join(', '));
  check('the court on the play screen agrees', (await marked()) === 'Tau');
  await page.close();
}

console.log('\nthe play screen deals only with scoring');
{
  // Once a round is committed, nothing about who the teams are may change: names
  // and slot order are what `throwerFor` and the career stats attribute rounds by,
  // and the board is told the colours. So the play screen has no route to any of
  // it — asserted as the absence of controls, which nothing in the components
  // themselves would notice regressing.
  const page = await open(WIDE);
  await playRound(page);
  const header = page.locator('.scoreboard');
  check('no name fields anywhere', (await page.locator('.team-name-input').count()) === 0);
  check('no colour swatches', (await page.locator('.swatch').count()) === 0);
  check('no board chips', (await page.locator('.end-chip').count()) === 0);
  check('no court mirror', (await page.locator('.positions .swap-sides').count()) === 0);
  check(
    'the team names are text, not buttons',
    (await header.locator('button.team-name').count()) === 0 &&
      (await header.locator('.team-name').count()) > 0,
  );
  check(
    'the first-thrower bag is an indicator, not a button',
    (await header.locator('button.first-bag').count()) === 0 &&
      (await header.locator('.first-bag').count()) > 0,
  );
  // Every control on the screen, so a new one has to be added to this list
  // deliberately rather than slipping in. Visible only — the confirm dialog sits
  // in the DOM closed, and its buttons belong to it rather than to this screen.
  const controls = await page.evaluate(() =>
    [...document.querySelectorAll('.app button')]
      .filter((b) => b.checkVisibility())
      .map((b) => b.textContent.trim())
      .filter(Boolean),
  );
  check(
    'and the buttons that remain are all scoring or navigation',
    controls.every((t) => /End round|bags still to place|Undo round|New game|Panel/.test(t)),
    controls.join(' | '),
  );
  // The bag carries its meaning by shape and colour, so it has to be spoken too.
  const spoken = await page.locator('.scoreboard .visually-hidden').allInnerTexts();
  check('with the fact it carries said in words', spoken.join().includes('throws first'), spoken.join(', '));
  await page.close();
}

console.log('\nevery control is a real button, with nothing hidden to stand in for it');
{
  // What the drawing used to need: it was aria-hidden with a parallel set of
  // focus-revealed buttons, because a focusable button in a hidden subtree has no
  // accessible name. The controls left the drawing, so all of that should be gone.
  const page = await open(WIDE, { start: false });
  const a11y = await page.evaluate(() => ({
    courtHidden: document.querySelector('.court').hasAttribute('aria-hidden'),
    boxesHidden: [...document.querySelectorAll('.pitch-box')].every((e) =>
      e.hasAttribute('aria-hidden'),
    ),
    unnamed: [...document.querySelectorAll('.teams-fields button, .positions button')].filter(
      (b) => !(b.getAttribute('aria-label') || b.textContent).trim(),
    ).length,
    unfocusable: [...document.querySelectorAll('.teams-fields button, .positions button')].filter(
      (b) => b.tabIndex < 0,
    ).length,
  }));
  check('the boxes are hidden, not the whole court', !a11y.courtHidden && a11y.boxesHidden);
  check('every control has an accessible name', a11y.unnamed === 0, `${a11y.unnamed} without one`);
  check('and none is skipped by the keyboard', a11y.unfocusable === 0);
  check('with no hidden stand-ins left over', (await page.locator('.first-pick').count()) === 0);
  // The prose is now the only thing that speaks the arrangement, so it has to
  // keep naming the player the bags mark.
  const spoken = (await page.locator('.positions .visually-hidden').innerText()).trim();
  const first = (await page.locator('.pitch-box.is-first').innerText()).trim();
  check(`the spoken summary names ${first} as first`, spoken.includes(`${first} throws first`), spoken);
  await page.close();
}

console.log('\nthe court shows both ends in doubles and only one in singles');
{
  const page = await open(WIDE);
  const occupied = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.court-end')].map(
        (e) => e.querySelectorAll('.pitch-box:not(.is-empty)').length,
      ),
    );
  check('doubles fills all four boxes', JSON.stringify(await occupied()) === '[2,2]');
  await page.close();

  const singles = await open(WIDE, { mode: 'Singles', names: ['Neil', 'Cat'] });
  const counts = await singles.evaluate(() =>
    [...document.querySelectorAll('.court-end')].map(
      (e) => e.querySelectorAll('.pitch-box:not(.is-empty)').length,
    ),
  );
  check(
    'singles leaves the far end empty',
    JSON.stringify(counts) === '[2,0]' || JSON.stringify(counts) === '[0,2]',
    JSON.stringify(counts),
  );
  await singles.close();
}

console.log('\nthe panels are a toggle on a phone and permanent on a wide screen');
{
  const page = await open(PHONE);
  const { court, stats } = panel(page);
  check('court hidden until asked', (await court.count()) === 0);
  check('stats hidden until asked', (await stats.count()) === 0);
  await page.getByRole('button', { name: 'Positions' }).click();
  check('Positions reveals the court', (await court.count()) === 1);
  await page.getByRole('button', { name: 'Game stats' }).click();
  check('Game stats reveals the panel', (await stats.count()) === 1);
  await page.getByRole('button', { name: 'Positions' }).click();
  check('Positions hides it again', (await court.count()) === 0);
  await page.close();

  const wide = await open(WIDE);
  const w = panel(wide);
  check('court is on show without asking', (await w.court.count()) === 1);
  check('stats are on show without asking', (await w.stats.count()) === 1);
  const toggles = await wide.locator('.secondary-controls button').allInnerTexts();
  check(
    'the toggles are gone, not duplicated',
    !toggles.some((t) => /Positions|Game stats|History/.test(t)),
    toggles.join(' | '),
  );
  await wide.close();
}

console.log('\nthe rail runs court, stats, history — history last');
{
  const page = await open(WIDE);
  const order = await page.evaluate(() =>
    [...document.querySelectorAll('.side-rail > *')].map((e) => e.className.split(' ')[0]),
  );
  check(
    'order is court, stats, history',
    JSON.stringify(order) === '["positions","game-stats","history-panel"]',
    order.join(', '),
  );
  const widths = await page.evaluate(() =>
    [...document.querySelectorAll('.positions, .game-stats, .history-panel, .history-empty')].map(
      (e) => Math.round(e.getBoundingClientRect().width),
    ),
  );
  check(
    'every panel fills the rail, including the empty history',
    new Set(widths).size === 1,
    widths.join(', '),
  );
  await page.close();
}

console.log('\nthe stats panel follows the live game');
{
  const page = await open(WIDE);
  check(
    'before the first round it says so rather than showing zeroes',
    (await page.locator('.game-stats-empty').count()) === 1,
  );
  await playRound(page);
  const read = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.game-stats-table tbody tr')].map((tr) => ({
        name: tr.querySelector('.game-stats-name').textContent.trim(),
        rounds: Number(tr.querySelectorAll('td')[0].textContent),
      })),
    );
  const afterOne = await read();
  check(
    'one row per player, in lane order',
    JSON.stringify(afterOne.map((r) => r.name)) === '["Rho","Tau","Cat","Dan"]',
    JSON.stringify(afterOne.map((r) => r.name)),
  );
  check(
    'only the pair who threw are credited a round',
    JSON.stringify(afterOne.map((r) => r.rounds)) === '[1,0,1,0]',
    JSON.stringify(afterOne.map((r) => r.rounds)),
  );
  await playRound(page);
  const afterTwo = await read();
  check(
    'the other pair picks up the second round',
    JSON.stringify(afterTwo.map((r) => r.rounds)) === '[1,1,1,1]',
    JSON.stringify(afterTwo.map((r) => r.rounds)),
  );
  check(
    'rounds credited sum to rounds played',
    afterTwo.reduce((n, r) => n + r.rounds, 0) === 4,
  );
  await page.close();
}

console.log('\nthe four-bagger badge survives a long name');
{
  // The badge is the only place the count appears, and it lives in the one cell
  // that truncates.
  const page = await open(PHONE, { names: ['GammaDeltew Jr.', 'Tau', 'Cat', 'Dan'] });
  await playRound(page, ['hole', 'hole', 'hole', 'hole']);
  await page.getByRole('button', { name: 'Game stats' }).click();
  const badge = await page.evaluate(() => {
    const fb = document.querySelector('.game-stats-fb');
    if (!fb) return null;
    const f = fb.getBoundingClientRect();
    const cell = fb.closest('th').getBoundingClientRect();
    return { text: fb.textContent.trim(), overflow: Math.round(f.right - cell.right), width: f.width };
  });
  check('the badge is rendered', badge !== null, badge?.text ?? 'absent');
  check(
    'and is not clipped out of the cell',
    badge !== null && badge.overflow <= 0 && badge.width > 0,
    badge ? `${badge.overflow}px past the cell edge` : '',
  );
  await page.close();
}

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nall positions and game stats checks passed');
process.exit(failures ? 1 : 0);
