// Plays a real game through the UI and checks the match archive behaves: one
// record on the winning throw, gone again if that round is undone, and the same
// record (not a second one) when it is re-committed.
//
// The unit tests cover the pure helpers, but not that the effect in App.jsx
// fires on the right transitions — which is the part that would silently either
// lose every match or archive each one twice.

import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = 'http://localhost:4173/';
const KEY = 'holecorn.matches.v1';
const out = join(dirname(fileURLToPath(import.meta.url)), 'out');

let failures = 0;
const check = (label, cond, detail = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
};

const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome' });
const context = await browser.newContext({
  viewport: { width: 430, height: 932 },
  acceptDownloads: true,
});
const page = await context.newPage();
page.on('pageerror', (e) => {
  console.log('  PAGE ERROR', e.message);
  failures++;
});

const archive = () =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), KEY);

// Team a's four bags into the hole, team b's onto the floor: +12 a side.
const playRound = async () => {
  for (const [team, tier] of [[0, 'bag hole'], [1, 'bag floor']]) {
    const lanes = page.locator('.team-lanes').nth(team).locator('.lane');
    for (let i = 0; i < 4; i++) {
      await lanes.nth(i).getByLabel(tier, { exact: true }).click();
    }
  }
  await page.getByRole('button', { name: 'End round' }).click();
};

await page.goto(URL);
await page.evaluate(() => localStorage.clear());
await page.reload();

const names = page.locator('.team-name-input');
await names.nth(0).fill('Neil');
await names.nth(1).fill('Sigma');
await page.getByRole('button', { name: 'Start game' }).click();

// Target 21, so two 12-point rounds finish it.
await playRound();
check('nothing archived mid-match', (await archive()).length === 0);
await playRound();

await page.waitForFunction(
  (key) => JSON.parse(localStorage.getItem(key) || '[]').length === 1,
  KEY,
  { timeout: 3000 },
);
const [won] = await archive();
check('one record on the winning throw', !!won);
check('winner recorded', won?.winner === 'a', won?.winner);
check('rounds captured', won?.rounds?.length === 2, `${won?.rounds?.length} rounds`);
check('names captured', won?.players?.a?.[0] === 'Neil', won?.players?.a?.[0]);
check('start time captured', won?.startedAt > 0);
check('bag tiers captured', won?.rounds?.[0]?.a?.[0] === 'hole');

await page.getByRole('button', { name: 'Undo round' }).click();
await page.waitForFunction(
  (key) => JSON.parse(localStorage.getItem(key) || '[]').length === 0,
  KEY,
  { timeout: 3000 },
);
check('record withdrawn when the winning round is undone', (await archive()).length === 0);

await page.getByRole('button', { name: 'End round' }).click();
await page.waitForFunction(
  (key) => JSON.parse(localStorage.getItem(key) || '[]').length === 1,
  KEY,
  { timeout: 3000 },
);
const [again] = await archive();
check('re-committing restores one record, not two', (await archive()).length === 1);
check('same match id, so it is the same match', again?.id === won?.id);

// A reload must re-commit the same record rather than adding a duplicate.
await page.reload();
await page.waitForTimeout(300);
check('reloading a won game does not duplicate it', (await archive()).length === 1);
check('end time is not moved by the reload', (await archive())[0].endedAt === again.endedAt);

// The confirmation guards a game in progress, not a finished one: a won game
// has nothing left to lose and is already archived.
await page.getByRole('button', { name: 'New game' }).click();
check(
  'a won game starts a new one without asking',
  await page.getByRole('button', { name: 'Start game' }).isVisible(),
);

// Second match, so the stats screen has more than one row of history — and the
// half-played state is what proves the prompt still guards real work.
await page.getByRole('button', { name: 'Start game' }).click();
await playRound();
await page.getByRole('button', { name: 'New game' }).click();
check('a game in progress still asks first', await page.getByText('Start a new game?').isVisible());
await page.getByRole('button', { name: 'Cancel' }).click();
check(
  'cancelling keeps the round already played',
  (await page.evaluate(() => JSON.parse(localStorage.getItem('holecorn.game.v3')).rounds.length)) === 1,
);
await playRound();
await page.waitForFunction(
  (key) => JSON.parse(localStorage.getItem(key) || '[]').length === 2,
  KEY,
  { timeout: 3000 },
);
check('a second match is archived alongside the first', (await archive()).length === 2);

await page.getByRole('button', { name: 'New game' }).click();

// The pre-game form panel, and the one thing about it no unit test can reach:
// that it does not push `Start game` further down. The setup screen already
// overflows every phone — measured, that button's bottom edge sits 55px below the
// fold on a 393x852 iPhone before anything is added — which is the whole reason
// the panel goes below it rather than under the names.
{
  const startBottom = () =>
    page
      .locator('.setup .end-round')
      .evaluate((e) => Math.round(e.getBoundingClientRect().bottom + window.scrollY));

  check('the form panel is on the setup screen', (await page.locator('.lineup').count()) === 1);
  const withPanel = await startBottom();
  await page.addStyleTag({ content: '.lineup{display:none!important}' });
  const withoutPanel = await startBottom();
  check(
    'it does not move Start game',
    withPanel === withoutPanel,
    `${withPanel} with, ${withoutPanel} without`,
  );
  await page.reload();
  await page.waitForSelector('.setup');

  const names = await page.locator('.lineup-table tbody th').allInnerTexts();
  check('both players are listed', names.join(',').includes('Neil'), names.join(','));
  check('nobody is marked a first-timer', (await page.locator('.lineup-first').count()) === 0);

  // Sigma threw every bag on the floor in both matches, so his PPR is genuinely
  // 0.0. That has to be *shown*: a blank there reads as missing data rather than a
  // bad run, and it is the case an emptiness test keyed on the rate itself hides.
  const haydnRow = page.locator('.lineup-table tbody tr', { hasText: 'Sigma' });
  const haydnCells = await haydnRow.locator('td').allInnerTexts();
  check(
    'a player who averages 0.0 shows it rather than a blank',
    haydnCells.includes('0.0'),
    haydnCells.join(' | '),
  );

  // A name nobody has played under must say so rather than report 0% of
  // everything — the `played` flag in lineupStats is what carries that.
  await page.locator('.team-name-input').nth(1).fill('Psi');
  await page.waitForTimeout(250);
  check('an unknown name is marked a first-timer', (await page.locator('.lineup-first').count()) === 1);
  await page.locator('.team-name-input').nth(1).fill('Sigma');
  await page.waitForTimeout(250);
  check(
    'and goes back to a record once the name is known again',
    (await page.locator('.lineup-first').count()) === 0,
  );
}

await page.getByRole('button', { name: 'Stats' }).click();

// Read by column heading, not by position: adding a column shifts every index,
// which makes a positional check assert the wrong column rather than fail. The
// first column is a row header, so the tds line up with the headings after it.
const statsFor = async (target, name) => {
  const headings = (await target.locator('.stats-table thead th').allInnerTexts()).slice(1);
  const values = await target
    .locator('.stats-table tbody tr', { hasText: name })
    .locator('td')
    .allInnerTexts();
  return Object.fromEntries(headings.map((h, i) => [h, values[i]]));
};

const row = page.locator('.stats-table tbody tr', { hasText: 'Neil' });
check('Neil has a row on the stats screen', (await row.count()) === 1);
const neil = await statsFor(page, 'Neil');
check('played two, won two', neil.P === '2' && neil['W–L'] === '2–0', JSON.stringify(neil));
check('threw four rounds across the two matches', neil.RDS === '4', neil.RDS);
check('PPR is 12.0 — four in the hole every round', neil.PPR === '12.0', neil.PPR);
check('hole rate is 100%', neil.HOLE === '100%', neil.HOLE);
check('four four-baggers over four rounds', neil['4B'] === '4', neil['4B']);
check('current streak shows 2W', neil.STREAK === '2W', neil.STREAK);

const sigma = await statsFor(page, 'Sigma');
check('Sigma lost both', sigma['W–L'] === '0–2', sigma['W–L']);
check('Sigma threw the same four rounds', sigma.RDS === '4', sigma.RDS);
check('Sigma threw every bag on the floor', sigma.HOLE === '0%', sigma.HOLE);

check('the unused doubles slot is not listed', !(await page.getByText('Player 2').count()));
check('head to head is shown', (await page.locator('.h2h li').count()) === 1);
check('both matches listed as recent', (await page.locator('.recent li').count()) === 2);

// Expanding a match must agree with the summary row above it — the running
// score on the last round is the final score, by construction.
const firstRow = page.locator('.recent li').first();
await firstRow.locator('.recent-open').click();
const roundRows = firstRow.locator('.match-round');
check('expanding a match lists its rounds', (await roundRows.count()) === 2);
check(
  'the running score ends on the final score',
  (await roundRows.last().locator('.mr-running').innerText()).replace(/\s/g, '') === '24–0',
  await roundRows.last().locator('.mr-running').innerText(),
);
check(
  'a four-bagger round shows four in the hole',
  (await roundRows.first().locator('.mr-counts').first().innerText()).startsWith('4◎'),
);
check('the footer reports the target', await firstRow.getByText('played to 21').isVisible());
check(
  'the footer reports how long the match took',
  /^2 rounds in (<1m|\d+m)/.test(await firstRow.locator('.match-rounds-foot').innerText()),
  await firstRow.locator('.match-rounds-foot').innerText(),
);

// The marker is one glyph rotated, not two glyphs. Measured because the bug it
// replaces was purely dimensional: U+2303 is 11.33px wide against U+2304's
// 7.83px at the same size, so swapping them made the marker jump on toggle.
//
// Measured under reduced motion so the rotation lands instantly. Part-way
// through a rotation the bounding box is legitimately larger — that is what a
// rotating box does — so measuring mid-transition would fail on a correct
// implementation. It also confirms the reduced-motion rule actually applies.
await page.emulateMedia({ reducedMotion: 'reduce' });
const chevron = firstRow.locator('.recent-chevron');
check(
  'the rotation is dropped for reduced motion',
  (await chevron.evaluate((e) => getComputedStyle(e).transitionDuration)) === '0s',
);
const openBox = await chevron.boundingBox();
check(
  'the open marker is rotated, not swapped for another glyph',
  (await chevron.evaluate((e) => getComputedStyle(e).transform)) === 'matrix(-1, 0, 0, -1, 0, 0)',
);
await firstRow.locator('.recent-open').click();
check('clicking again collapses it', (await firstRow.locator('.match-round').count()) === 0);
const shutBox = await chevron.boundingBox();
check(
  'the marker is the same size open and closed',
  openBox.width === shutBox.width && openBox.height === shutBox.height,
  `${openBox.width}x${openBox.height} vs ${shutBox.width}x${shutBox.height}`,
);
await page.emulateMedia({ reducedMotion: null });

// Deleting the match that is still the loaded game is the case worth checking:
// the archive effect used to re-file a won game on mount, so the deletion only
// survived until the next reload.
const recentRows = page.locator('.recent li');
await recentRows.first().locator('.recent-open').click();
check('a match can be open before deleting', (await recentRows.first().locator('.match-round').count()) > 0);
await recentRows.first().locator('.recent-delete').click();
check('deleting the open match closes the detail', (await page.locator('.match-round').count()) === 0);
await page.locator('.stats-undo button').click();
await recentRows.first().locator('.recent-delete').click();
check('deleting removes the match from the list', (await recentRows.count()) === 1);
check('and from storage', (await archive()).length === 1);
check('an undo is offered', await page.locator('.stats-undo').isVisible());

await page.locator('.stats-undo button').click();
check('undo puts it back', (await recentRows.count()) === 2);
check('undo restores it in storage', (await archive()).length === 2);

await recentRows.first().locator('.recent-delete').click();
await page.reload();
await page.getByRole('button', { name: 'Stats' }).click();
check('a deleted match stays deleted across a reload', (await archive()).length === 1);
check('and does not reappear in the list', (await page.locator('.recent li').count()) === 1);

// Put it back so the export round trip below still has two matches to move.
await page.getByRole('button', { name: '‹ Back' }).click();
await page.getByRole('button', { name: 'Start game' }).click();
await playRound();
await playRound();
await page.waitForFunction(
  (key) => JSON.parse(localStorage.getItem(key) || '[]').length === 2,
  KEY,
  { timeout: 3000 },
);
await page.getByRole('button', { name: 'New game' }).click();
await page.getByRole('button', { name: 'Stats' }).click();
check('back to two matches for the export check', (await archive()).length === 2);

// Export, then import the downloaded file back into a browser with an empty
// archive. That round trip is the only route off a device until the app has a
// backend, so it has to actually work rather than merely produce a file.
await mkdir(out, { recursive: true });
await page.screenshot({ path: join(out, 'stats-screen.png'), fullPage: true });
console.log(`  screenshot -> tools/out/stats-screen.png`);

check('export is offered', await page.getByRole('button', { name: 'Export as JSON' }).isEnabled());
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button', { name: 'Export as JSON' }).click(),
]);
const dump = join(out, 'exported-matches.json');
await download.saveAs(dump);
const exported = JSON.parse(await readFile(dump, 'utf8'));
check('export contains both matches', exported.length === 2, `${exported.length}`);
check(
  'the export nudge clears once exported',
  !(await page.getByText('since your last export').count()),
);

const fresh = await context.newPage();
await fresh.goto(URL);
await fresh.evaluate(() => localStorage.clear());
await fresh.reload();
await fresh.getByRole('button', { name: 'Stats' }).click();
check('a fresh device starts empty', await fresh.getByText('No finished matches yet').isVisible());
check('import is offered with nothing to show', await fresh.getByText('Import JSON').isVisible());

await fresh.locator('.file-button input').setInputFiles(dump);
await fresh.waitForSelector('.stats-table');
check('imported matches appear', (await fresh.locator('.recent li').count()) === 2);
const imported = await statsFor(fresh, 'Neil');
check(
  'imported stats match the originals',
  ['P', 'W–L', 'RDS', 'PPR'].every((key) => imported[key] === neil[key]),
  JSON.stringify(imported),
);

// Importing the same file again must not double every match.
await fresh.locator('.file-button input').setInputFiles(dump);
await fresh.getByText('Nothing new').waitFor({ timeout: 3000 });
check('re-importing the same file adds nothing', (await fresh.locator('.recent li').count()) === 2);

const junk = join(out, 'not-an-export.json');
await writeFile(junk, '{"hello":"world"}');
await fresh.locator('.file-button input').setInputFiles(junk);
await fresh.getByText("doesn't look like a Holecorn export").waitFor({ timeout: 3000 });
check('a wrong file is refused without losing the archive', (await fresh.locator('.recent li').count()) === 2);

// Everything above runs on localhost, which counts as a secure context, so it
// cannot catch a secure-context-only API. A dev server reached by LAN IP over
// plain http is not secure, and that is how the app gets tested on a phone:
// `crypto.randomUUID` and `navigator.storage` are both absent there. Simulated
// rather than served on a real IP so it stays deterministic in CI.
// Doubles is the one thing the detail view shows that the summary row can't:
// which partner threw each round. Seeded rather than played, because the point
// is the rendering, and the attribution itself is pinned in stats.test.js.
const dbl = await browser.newContext();
const dblPage = await dbl.newPage();
await dblPage.goto(URL);
await dblPage.evaluate(() => {
  const round = (a, b, na, nb) => ({ a, b, nets: { a: na, b: nb }, first: 'a' });
  const bags = (t) => Array(4).fill(t);
  localStorage.setItem('holecorn.matches.v1', JSON.stringify([{
    format: 1, id: 'd1', startedAt: 1e12, endedAt: 1e12 + 6e5, mode: 'doubles',
    players: { a: ['Rho', 'Tau'], b: ['Phi', 'Chi'] },
    colors: { a: '#27ae60', b: '#f2c94c' }, target: 21, winner: 'a',
    rounds: [
      round(bags('hole'), bags('floor'), 12, 0),
      round(bags('floor'), bags('floor'), 0, 0),
      round(bags('hole'), bags('floor'), 12, 0),
    ],
  }]));
});
await dblPage.reload();
await dblPage.getByRole('button', { name: 'Stats' }).click();
await dblPage.locator('.recent-open').first().click();
const throwers = await dblPage.locator('.match-round .mr-side:nth-child(2) .mr-thrower').allInnerTexts();
check('doubles names the thrower, alternating partners', throwers.join(',') === 'Rho,Tau,Rho', throwers.join(','));
check('a wash round is marked', (await dblPage.locator('.match-round.is-wash').count()) === 1);
check(
  'the wash leaves the running score unchanged',
  (await dblPage.locator('.match-round').nth(1).locator('.mr-running').innerText()).replace(/\s/g, '') === '12–0',
);

// Deleting a match has to reach the form panel, which reads a copy held in
// App.jsx while Stats keeps its own. Nothing below App can catch the two getting
// out of step: the panel would keep reporting a match that is gone until the next
// reload.
{
  const del = await browser.newContext();
  const delPage = await del.newPage();
  await delPage.goto(URL);
  await delPage.evaluate((records) => {
    localStorage.clear();
    localStorage.setItem('holecorn.matches.v1', JSON.stringify(records));
  }, [won]);
  await delPage.reload();
  await delPage.waitForSelector('.setup');
  // The seeded record is Neil v Sigma, and a fresh game defaults to Player 1 —
  // so the names have to be typed for the panel to have anything to show.
  await delPage.locator('.team-name-input').nth(0).fill('Neil');
  await delPage.locator('.team-name-input').nth(1).fill('Sigma');
  await delPage.waitForTimeout(250);
  check('the form panel shows a seeded match', (await delPage.locator('.lineup').count()) === 1);

  await delPage.getByRole('button', { name: 'Stats' }).click();
  await delPage.locator('.recent-delete').first().click();
  await delPage.getByRole('button', { name: '‹ Back' }).click();
  await delPage.waitForTimeout(250);
  check(
    'and is gone as soon as that match is deleted, without a reload',
    (await delPage.locator('.lineup').count()) === 0,
  );
  await del.close();
}

const plain = await browser.newContext();
await plain.addInitScript(() => {
  delete Crypto.prototype.randomUUID;
  Object.defineProperty(navigator, 'storage', { value: undefined });
});
const insecure = await plain.newPage();
const errors = [];
insecure.on('pageerror', (e) => errors.push(e.message));
await insecure.goto(URL);
await insecure.waitForTimeout(400);

// Checked before anything is clicked: the failure here is a blank page, and
// waiting on a button that will never exist would time out the whole run
// instead of reporting.
const rendered = (await insecure.locator('.app').count()) > 0;
check('the app renders without secure-context-only APIs', rendered, errors.join(' | '));
check('no uncaught errors on an insecure origin', errors.length === 0, errors.join(' | '));

if (rendered) {
  await insecure.getByRole('button', { name: 'Start game' }).click();
  check(
    'a match still gets an id',
    await insecure.evaluate(() => {
      const game = JSON.parse(localStorage.getItem('holecorn.game.v3') || '{}');
      return typeof game.id === 'string' && game.id.length > 0;
    }),
  );
  await insecure.getByRole('button', { name: 'New game' }).click();
  await insecure.getByRole('button', { name: 'Stats' }).click();
  check(
    'stats reports unknown persistence rather than claiming it is safe',
    await insecure.getByText('will not say whether it keeps your history').isVisible(),
  );
}

await browser.close();
if (failures) {
  console.error(`\n${failures} stats check(s) failed`);
  process.exit(1);
}
console.log('\nstats checks passed');
