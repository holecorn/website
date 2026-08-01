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

// Renaming is only reachable through the selected-player panel — there is no
// control in the career table — so every route to it selects first.
const openRename = async (page, name) => {
  await page.locator('.stats-table tbody tr', { hasText: name }).locator('.player-select').click();
  await page.getByRole('button', { name: `Rename ${name}`, exact: true }).click();
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
await page.getByRole('button', { name: 'Start', exact: true }).click();

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
  await page.getByRole('button', { name: 'Start', exact: true }).isVisible(),
);

// Second match, so the stats screen has more than one row of history — and the
// half-played state is what proves the prompt still guards real work.
await page.getByRole('button', { name: 'Start', exact: true }).click();
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
// that nothing added to this screen pushes `Start` off the first screenful.
// It used to be measured as "the panel does not move it", which stopped meaning
// anything once the button moved up beside the mode toggle — it now precedes
// every panel in the DOM, so hiding one cannot move it. What is worth holding is
// the property that motivated all of it: the button is reachable without
// scrolling, in both modes, with everything present.
{
  const startVisible = () =>
    page
      .locator('.start-game')
      .evaluate((e) => Math.round(window.innerHeight - e.getBoundingClientRect().bottom));

  check('the form panel is on the setup screen', (await page.locator('.lineup').count()) === 1);
  // Everything after this block plays in whichever mode it was already in, and
  // switching adds a second player slot per team, so put it back.
  const wasOn = await page.locator('.mode-toggle button.is-on').innerText();
  for (const mode of ['Singles', 'Doubles']) {
    await page.getByRole('button', { name: mode }).click();
    const clear = await startVisible();
    check(`Start is above the fold in ${mode.toLowerCase()}`, clear > 0, `${clear}px clear`);
  }
  await page.getByRole('button', { name: wasOn.trim() }).click();
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

  // The form panel and the career table draw their pips with the same component,
  // and only this one hands it a team colour — the career table has no teams, so
  // dropping the prop would go unnoticed there.
  const litPips = page.locator('.lineup-table .form-line-pip.is-win');
  check('the form panel tints its win pips with the team colour',
    (await litPips.count()) > 0
      && (await litPips.first().evaluate((e) => e.style.background)) !== '',
    `${await litPips.count()} lit`);

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

// The career table's form line. Drawn by the same component as the setup screen's
// Form panel, so a drift between them is not possible — what is worth holding here
// is that a row of shapes is not the only thing a reader gets, and that a short
// history draws fewer pips rather than padding to five.
{
  const neil = page.locator('.stats-table tbody tr', { hasText: 'Neil' });
  check('a form line is drawn in the career table',
    (await neil.locator('.form-line-pip').count()) === 2,
    `${await neil.locator('.form-line-pip').count()} pips for two matches`);
  check('and both are wins', (await neil.locator('.form-line-pip.is-win').count()) === 2);
  // Counted before it is read: innerText on a missing element throws and takes the
  // whole run down with a stack trace instead of naming the fault.
  const spoken = neil.locator('.form-line-spoken');
  check('with the results spelled out, since pips read as nothing aloud',
    (await spoken.count()) === 1 && (await spoken.innerText()) === 'won, won',
    `${await spoken.count()} found`);
  const sigma = page.locator('.stats-table tbody tr', { hasText: 'Sigma' });
  check('a losing run draws pips too, just unlit',
    (await sigma.locator('.form-line-pip').count()) === 2
      && (await sigma.locator('.form-line-pip.is-win').count()) === 0);
}
// Two absences, asserted here — on the first stats screen this file opens —
// rather than alongside the scoped checks further down. Both are things nothing
// in the components would notice coming back, and putting them last is worse than
// useless: a rename control restored to the table makes `openRename` match two
// buttons and die on a strict-mode violation, so the run ends in a stack trace
// instead of naming the fault. Verified by mutation, which is how that was found.
check('nothing is scoped until a player is picked', (await page.locator('.h2h').count()) === 0);
check(
  'and there is no way to rename one from the career table',
  (await page.getByRole('button', { name: /^Rename/ }).count()) === 0,
);

// Head to head is scoped to a selected player now, so it has to be asked for.
// Deselected again afterwards, so the rest of this block sees the screen it did
// before.
await page.getByRole('button', { name: 'Neil', exact: true }).click();
check('head to head is shown for the selected player', (await page.locator('.h2h li').count()) === 1);
check(
  'and reads as their record against the opponent',
  (await page.locator('.h2h li').first().innerText()).replace(/\s+/g, ' ').includes('Sigma'),
  await page.locator('.h2h li').first().innerText(),
);
await page.getByRole('button', { name: 'Neil', exact: true }).click();
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
await page.getByRole('button', { name: 'Start', exact: true }).click();
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

// Nothing in this archive is a tournament tie, so the key must not be drawn — it is only
// worth its line when the list actually holds one. The marking itself is covered in
// verify-tournament.mjs, which has a tournament to mark.
check('no tournament key with no tournaments', (await page.locator('.recent-key').count()) === 0);

// The dev-only wipe must not reach a shipped build. It is gated on `import.meta.env.DEV`,
// which Vite eliminates — so this asserts the elimination rather than the gate, because a
// gate that stopped working would look identical in the source. Checked here because
// these run against a production preview; in `npm run dev` the control is present and
// this assertion would rightly fail.
check(
  'the dev wipe is not in the built app',
  (await page.locator('.dev-reset').count()) === 0 &&
    !(await page.getByRole('button', { name: /Wipe local history/ }).count()),
);
check('export is offered', await page.getByRole('button', { name: 'Export as JSON' }).isEnabled());
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button', { name: 'Export as JSON' }).click(),
]);
const dump = join(out, 'exported-matches.json');
await download.saveAs(dump);
const exported = JSON.parse(await readFile(dump, 'utf8'));
check('export contains both matches', exported.matches?.length === 2, `${exported.matches?.length}`);
// The envelope, not a bare array of matches. A file that carries the ties but not the
// brackets imports without complaint and leaves every tournament pointing at nothing,
// which is the failure mode this shape exists to prevent — so it is asserted as a
// *key*, present and a list, rather than by seeding a tournament to fill it.
check(
  'and an envelope with somewhere for the brackets to travel',
  Array.isArray(exported.tournaments),
  JSON.stringify(Object.keys(exported)),
);
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

// A file whose matches are all already here but whose brackets are not. This is the
// shape a re-import takes after a tournament has been deleted — its ties were never
// deleted, so nothing lands in the archive while a whole bracket comes back — and
// counting only the archive reported "nothing new" at exactly that moment. Nothing
// hermetic can see it: `mergeTournaments` and `mergeMatches` are both individually
// right, and only the notice built from the two of them is wrong.
const withCup = join(out, 'exported-with-tournament.json');
await writeFile(
  withCup,
  JSON.stringify({
    ...exported,
    tournaments: [
      {
        format: 1,
        id: 'resurrected',
        name: 'Hole Corn V',
        createdAt: 1.7e12,
        mode: 'singles',
        target: 21,
        entrants: [['Rho'], ['Tau']],
      },
    ],
  }),
);
// The notice is already on screen saying something else, so this waits for the *text*
// to change rather than for the element — and reports rather than throwing, so a
// regression names itself instead of ending the run. Same lesson as the ordering of
// the absence assertions above.
const noticeSettles = async (want) => {
  try {
    await fresh.waitForFunction(
      (text) => document.querySelector('.durability-notice')?.textContent === text,
      want,
      { timeout: 3000 },
    );
  } catch {
    // reported by the check that follows
  }
  return fresh.locator('.durability-notice').textContent();
};

await fresh.locator('.file-button input').setInputFiles(withCup);
const cupNotice = await noticeSettles('Added 1 tournament.');
check(
  'a file that adds only a bracket says so rather than "nothing new"',
  cupNotice === 'Added 1 tournament.',
  cupNotice,
);
check(
  'and adds no matches doing it',
  (await fresh.locator('.recent li').count()) === 2,
  `${await fresh.locator('.recent li').count()}`,
);

// Only now is "nothing new" the truth, and it must not still be talking about matches.
await fresh.locator('.file-button input').setInputFiles(withCup);
const settled = await noticeSettles("Nothing new — it's all already here.");
check('once the bracket is here too, nothing new means nothing at all', !settled.includes('match'), settled);

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

// Correcting a name. The pure helpers are covered in archive.test.js; what only a
// browser can see is that the two scopes stay different — a per-match fix must not
// touch the lineup waiting on the setup screen, and a career rename must, or the
// typo walks straight back into the next game. Neither side of that is reachable
// from a unit test: `renamePlayer` in archive.js and the reducer case in App.jsx
// are separately correct whichever way they are wired together.
{
  const ren = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const renPage = await ren.newPage();
  renPage.on('pageerror', (e) => {
    console.log('  PAGE ERROR', e.message);
    failures++;
  });
  const stored = () => renPage.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), KEY);

  await renPage.goto(URL);
  // Tau entered as "Tua" — the typo this whole feature exists for. Rho throws
  // rounds 0 and 2 and does the scoring, so which name the throws follow is
  // visible rather than inferred.
  await renPage.evaluate(() => {
    const round = (a, b, na, nb) => ({ a, b, nets: { a: na, b: nb }, first: 'a' });
    const bags = (t) => Array(4).fill(t);
    localStorage.clear();
    localStorage.setItem('holecorn.matches.v1', JSON.stringify([{
      format: 1, id: 'r1', startedAt: 1.7e12, endedAt: 1.7e12 + 6e5, mode: 'doubles',
      players: { a: ['Rho', 'Tua'], b: ['Phi', 'Chi'] },
      colors: { a: '#27ae60', b: '#f2c94c' }, target: 21, winner: 'a',
      rounds: [
        round(bags('hole'), bags('floor'), 12, 0),
        round(bags('floor'), bags('floor'), 0, 0),
        round(bags('hole'), bags('floor'), 12, 0),
      ],
    }]));
  });
  await renPage.reload();
  await renPage.waitForSelector('.setup');
  await renPage.getByRole('button', { name: 'Doubles' }).click();
  const renNames = renPage.locator('.team-name-input');
  for (const [i, name] of ['Rho', 'Tua', 'Phi', 'Chi'].entries()) await renNames.nth(i).fill(name);

  // The suggestions are where a near-duplicate spelling gets prevented rather
  // than corrected. Only the wiring is checkable — the dropdown itself is the
  // browser's.
  check(
    'the setup fields are wired to the archive name list',
    (await renNames.nth(0).getAttribute('list')) === 'known-names',
  );
  const offered = await renPage.locator('#known-names option').evaluateAll((os) =>
    os.map((o) => o.value),
  );
  check(
    'everyone in the archive is offered',
    ['Rho', 'Tua', 'Phi', 'Chi'].every((n) => offered.includes(n)),
    offered.join(','),
  );

  await renPage.getByRole('button', { name: 'Stats' }).click();
  const roundsBefore = JSON.stringify((await stored())[0].rounds);

  await renPage.locator('.recent-open').first().click();
  await renPage.getByRole('button', { name: 'Edit names' }).click();
  const slots = renPage.locator('.match-name-input');
  check('doubles offers a field per player', (await slots.count()) === 4);
  // `:modal` is true only for showModal, so this fails both if the form goes back
  // inside the expanded match and if the dialog is merely shown — either way the
  // match list stays live underneath, including its delete buttons.
  check(
    'the editor is modal, so the list behind it cannot be touched',
    await renPage.locator('.match-names').evaluate((f) => f.closest('dialog')?.matches(':modal')),
  );
  check(
    'each field says which board that player threw from',
    (await slots.nth(1).getAttribute('aria-label'))?.includes('far board'),
    await slots.nth(1).getAttribute('aria-label'),
  );
  await slots.nth(1).fill('Tau');
  await renPage.locator('.match-names').getByRole('button', { name: 'Save' }).click();

  const throwers = await renPage
    .locator('.match-round .mr-side:nth-child(2) .mr-thrower')
    .allInnerTexts();
  check(
    'the corrected name is credited with the rounds that slot threw',
    throwers.join(',') === 'Rho,Tau,Rho',
    throwers.join(','),
  );
  const edited = (await stored())[0];
  check('rewriting the lineup leaves the rounds alone', JSON.stringify(edited.rounds) === roundsBefore);
  check('the edit is stamped so a stale export cannot revert it', edited.updatedAt > 0, `${edited.updatedAt}`);
  const tau = await statsFor(renPage, 'Tau');
  check('the career table follows', tau.RDS === '1', JSON.stringify(tau));
  check('and the typo is gone from it', !(await renPage.getByText('Tua').count()));

  // Renaming onto somebody who already has a history is a merge. Said out loud,
  // because it cannot be undone from this screen.
  await openRename(renPage, 'Chi');
  await renPage.locator('.rename-input').fill('Phi');
  check('a merge is named as a merge', await renPage.getByText('already has 1 match').isVisible());
  check(
    'and the button says so too',
    await renPage.locator('.modal').getByRole('button', { name: 'Merge' }).isVisible(),
  );
  await renPage.locator('.modal').getByRole('button', { name: 'Cancel' }).click();

  await openRename(renPage, 'Phi');
  await renPage.locator('.rename-input').fill('Phi B');
  await renPage.locator('.modal').getByRole('button', { name: 'Rename' }).click();
  check('a career rename reaches the record', (await stored())[0].players.b[0] === 'Phi B');
  check('and the career table', (await renPage.locator('.stats-table tbody tr', { hasText: 'Phi B' }).count()) === 1);

  await renPage.getByRole('button', { name: '‹ Back' }).click();
  await renPage.waitForSelector('.setup');
  const after = await renNames.evaluateAll((es) => es.map((e) => e.value));
  check(
    'a career rename also fixes the lineup waiting for the next game',
    after[2] === 'Phi B',
    after.join(','),
  );
  // The other half of the same assertion: the two scopes are different. A fix
  // confined to one match must not quietly rewrite the current lineup.
  check(
    'a per-match fix does not touch that lineup',
    after[1] === 'Tua',
    after.join(','),
  );
  await ren.close();
}

// The stats screen on a wide screen. It is an `.app` too, so it was picking up the
// play screen's wide-tier grid: everything landed in the 408px first column while
// 340px stayed reserved for a rail that never renders, putting the content 196px left
// of centre and squeezing the ten-column career table into a 408px scroller on the
// widest screens there are. Nothing below App.jsx could catch that — both the grid and
// the stats screen were individually correct.
{
  const wide = await browser.newContext({ viewport: { width: 1194, height: 834 } });
  const widePage = await wide.newPage();
  await widePage.goto(URL);
  await widePage.evaluate((records) => {
    localStorage.clear();
    localStorage.setItem('holecorn.matches.v1', JSON.stringify(records));
  }, [won]);
  await widePage.reload();
  await widePage.waitForSelector('.setup');
  await widePage.getByRole('button', { name: 'Stats' }).click();
  await widePage.waitForSelector('.stats-table');
  await widePage.waitForTimeout(200);

  const m = await widePage.evaluate(() => {
    const el = document.querySelector('.stats-screen');
    const box = el.getBoundingClientRect();
    const scroller = document.querySelector('.stats-scroll');
    // Seven chips, and `.stat-chips` is an auto-fit grid — so whether they orphan is a
    // function of the width available, and 720px fell four pixels short of fitting all
    // seven, leaving a lone SKUNKS on its own row.
    const chipTops = new Set(
      [...document.querySelectorAll('.stat-chip')].map((n) => Math.round(n.getBoundingClientRect().top)),
    );
    const prose = document.querySelector('.durability p');
    // Measured on the drawn sections, not on `.stats-screen` itself: under the grid the
    // box was centred at 1040px while everything visible sat in its 408px first column,
    // so the box's own gutters looked fine and the screen still read as shoved left.
    const drawn = [...el.querySelectorAll('.stats-section')].map((n) => n.getBoundingClientRect());
    return {
      display: getComputedStyle(el).display,
      maxWidth: getComputedStyle(el).maxWidth,
      left: Math.round(Math.min(...drawn.map((r) => r.left))),
      right: Math.round(window.innerWidth - Math.max(...drawn.map((r) => r.right))),
      width: Math.round(box.width),
      // The career table scrolls sideways on a phone by design; on a screen this wide
      // it should not have to.
      tableOverflows: scroller.scrollWidth > scroller.clientWidth + 1,
      chipRows: chipTops.size,
      // Characters per line, not pixels: the paragraph is capped independently of the
      // screen because line length is a property of the text, and uncapped at 1040px it
      // runs to ~119 characters against the 45-75 that reads comfortably. Measured by
      // rendering its own text unwrapped, so the figure is for this font and this string
      // rather than an assumed character width — an earlier pixel threshold here was
      // looser than the container's own padding and passed with the cap removed.
      proseChars: (() => {
        const probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap';
        probe.textContent = prose.textContent;
        prose.parentNode.appendChild(probe);
        const charW = probe.getBoundingClientRect().width / prose.textContent.length;
        probe.remove();
        return Math.round(prose.getBoundingClientRect().width / charW);
      })(),
    };
  });
  check('the stats screen is centred', m.left === m.right, `${m.left}px left vs ${m.right}px right`);
  check('it does not take the play screen grid', m.display !== 'grid', m.display);
  // `.app` also declares max-width, and Stats.css is bundled first, so the single-class
  // form lost at equal specificity and the screen ran at `.app`'s 480px.
  check('its own max-width wins over .app', m.maxWidth === '1040px', m.maxWidth);
  check('and it uses that width', m.width === 1040, `${m.width}px`);
  check('so the career table need not scroll sideways', !m.tableOverflows);
  check('the seven summary chips fit one row', m.chipRows === 1, `${m.chipRows} rows`);
  check('and the prose stays a readable line length', m.proseChars <= 85, `~${m.proseChars} chars`);
  await wide.close();
}

// Chip labels at exactly one. Two seeds, because no single match yields both `1 round`
// and `1 wash` — a wash needs a second round to have anything to wash against.
{
  const one = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const onePage = await one.newPage();
  const bags = (h, b) => [
    ...Array(h).fill('hole'), ...Array(b).fill('board'),
    ...Array(4 - h - b).fill('floor'),
  ];
  const round = (a, b, na, nb) => ({ a, b, nets: { a: na, b: nb }, first: 'a' });
  const seed = async (rounds, target) => {
    await onePage.evaluate(({ rs, tg }) => {
      localStorage.clear();
      localStorage.setItem('holecorn.matches.v1', JSON.stringify([{
        format: 1, id: 'p1', startedAt: 1.7e12, endedAt: 1.7e12 + 6e5, mode: 'singles',
        players: { a: ['Neil', 'P2'], b: ['Sigma', 'P2'] },
        colors: { a: '#2f80ed', b: '#eb5757' }, target: tg, winner: 'a', rounds: rs,
      }]));
    }, { rs: rounds, tg: target });
    await onePage.reload();
    await onePage.waitForSelector('.setup');
    await onePage.getByRole('button', { name: 'Stats' }).click();
    await onePage.waitForSelector('.stat-chips');
    return Object.fromEntries(
      await onePage.$$eval('.stat-chip', (chips) =>
        chips.map((c) => [
          c.querySelector('.stat-chip-label').textContent,
          c.querySelector('.stat-chip-value').textContent,
        ])),
    );
  };

  await onePage.goto(URL);
  // One match, two rounds: a wash, then four in the hole to win and leave a skunk.
  const a = await seed([
    round(bags(0, 1), bags(0, 1), 0, 0),
    round(bags(4, 0), bags(0, 0), 12, 0),
  ], 12);
  check('one match reads "match"', a.match === '1', JSON.stringify(Object.keys(a)));
  check('one wash reads "wash"', a.wash === '1');
  check('one skunk reads "skunk"', a.skunk === '1');
  check('one four bagger reads "four bagger"', a['four bagger'] === '1');
  // Two of them, so the plural is not simply hard-coded singular.
  check('two rounds still reads "rounds"', a.rounds === '2', JSON.stringify(a));
  // An average keeps its plural whatever it reads: a decimal is plural in English.
  check('the averages stay plural', 'avg rounds' in a && 'avg length' in a, JSON.stringify(Object.keys(a)));

  // One round, no wash: the singular round and the zero plural in one shot.
  const b = await seed([round(bags(4, 0), bags(0, 0), 12, 0)], 12);
  check('one round reads "round"', b.round === '1', JSON.stringify(Object.keys(b)));
  check('zero washes reads "washes"', b.washes === '0', JSON.stringify(Object.keys(b)));
  await one.close();
}

// Selecting a player scopes the screen to them. Two of these are absences, which
// nothing in the components would notice coming back: the unscoped list of every
// pair, and a rename control in the table. The list grew as n(n-1)/2 — 42 rows at
// 11 players — and rename in the table is what made a mis-tap open a dialog.
{
  const sel = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const sp = await sel.newPage();
  sp.on('pageerror', (e) => { console.log('  PAGE ERROR', e.message); failures++; });
  await sp.goto(URL);
  // Sigma is chosen deliberately: headToHead keys pairs low-name-first, so Sigma
  // sits on the *left* against Tau and on the *right* against Chi and Neil. That
  // split is the thing being fixed, so the fixture has to contain both.
  await sp.evaluate(() => {
    localStorage.clear();
    // Dates deliberately span three years and vary in rendered width — "1 May 24"
    // against "30 Sept 25". Uniform dates make the fixed-width assertion below
    // unfailable, since a content-sized column would then be uniform too.
    const beat = (w, l, id, y, mo, d) => ({
      format: 1, id, endedAt: Date.UTC(y, mo, d, 12), mode: 'singles',
      players: { a: [w, ''], b: [l, ''] },
      colors: { a: '#2f80ed', b: '#eb5757' }, target: 21, winner: 'a',
      final: { a: 21, b: 11 }, rounds: [],
    });
    localStorage.setItem('holecorn.matches.v1', JSON.stringify([
      beat('Sigma', 'Tau', 'a', 2024, 4, 1), beat('Sigma', 'Tau', 'aa', 2024, 8, 30),
      beat('Tau', 'Sigma', 'aaa', 2025, 0, 9), beat('Chi', 'Sigma', 'b', 2025, 2, 15),
      beat('Chi', 'Sigma', 'bb', 2025, 8, 30), beat('Chi', 'Sigma', 'bbb', 2025, 11, 18),
      beat('Neil', 'Sigma', 'c', 2026, 0, 5), beat('Sigma', 'Neil', 'cc', 2026, 3, 2),
      // One match without Sigma in it, or filtering the recent list below is
      // unobservable — every other fixture match has them.
      beat('Chi', 'Tau', 'dddd', 2026, 5, 20),
    ]));
  });
  await sp.reload();
  await sp.getByRole('button', { name: 'Stats' }).click();
  await sp.waitForSelector('.stats-table');

  await sp.getByRole('button', { name: 'Sigma', exact: true }).click();
  await sp.waitForSelector('.h2h');
  const rows = await sp.$$eval('.h2h li', (ls) => ls.map((l) => [
    l.querySelector('.h2h-name').textContent.trim(),
    l.querySelector('.h2h-score').lastElementChild.textContent.trim(),
    l.querySelector('.rival-tag')?.textContent.trim() ?? '',
  ]));
  // Sigma never appears in a row: every row is an opponent, and the score is
  // always Sigma's won–lost. Read off the *other* keying — Chi and Neil — because
  // that is where an unflipped implementation reports the reverse.
  check('the subject is not one of their own rows', !rows.some((r) => r[0] === 'Sigma'),
    JSON.stringify(rows));
  check('a pair keyed with the subject on the left reads their way round',
    JSON.stringify(rows.find((r) => r[0] === 'Tau')?.slice(0, 2)) === '["Tau","2–1"]',
    JSON.stringify(rows));
  check('and so does one keyed with them on the right',
    JSON.stringify(rows.find((r) => r[0] === 'Chi')?.slice(0, 2)) === '["Chi","0–3"]',
    JSON.stringify(rows));
  // Named rather than shaded, and at both ends of the list: Sigma is 0-3 down to
  // Chi and 2-1 up on Tau, over three meetings each.
  check('worst first, and the nemesis is named on its row',
    rows[0][0] === 'Chi' && rows[0][2] === 'nemesis', JSON.stringify(rows));
  check('the one they have the better of is named at the other end',
    rows[rows.length - 1][0] === 'Tau' && rows[rows.length - 1][2] === 'dominated',
    JSON.stringify(rows));
  const heading = await sp.locator('.stats-section').nth(1).locator('h2').innerText();
  check('and both are in the heading', heading.includes('Chi') && heading.includes('Tau'), heading);
  // The captions have to sit inside the bordered box with the rows, or they read
  // as a stray line above an unrelated list.
  check('the column captions are part of the list',
    (await sp.locator('.rivals > .rivals-head + .h2h').count()) === 1);
  // 1–1 against Neil: level is not a rivalry, and this is also the row that would
  // read 1–1 either way round, so it is no use for the flip assertions above.
  check('a level opponent is still listed',
    JSON.stringify(rows.find((r) => r[0] === 'Neil')?.slice(0, 2)) === '["Neil","1–1"]',
    JSON.stringify(rows));

  // The recent list is capped at 12, so a player outside the newest twelve had no
  // visible history at all — measured on the sample archive, four of eleven
  // players, one of them with 37 matches played.
  check('the recent list is scoped to them too',
    (await sp.locator('.recent li').count()) === 8,
    `${await sp.locator('.recent li').count()} rows`);
  check('and its heading says whose it is',
    (await sp.locator('.stats-section').nth(2).locator('h2').innerText()).includes('SIGMA'),
    await sp.locator('.stats-section').nth(2).locator('h2').innerText());
  const teams = await sp.$$eval('.recent-teams', (es) => es.map((e) => e.innerText));
  check('every row is one of their matches', teams.every((t) => t.includes('Sigma')),
    JSON.stringify(teams));

  // Scoping the list is what made it span years, so the year has to be on every
  // row — a filtered list otherwise reads 10 May, 18 Dec, 23 Nov and crosses a
  // boundary silently. Not conditional on the current year: that would put the
  // meaning in its absence and key the text off Date.now().
  const stamps = await sp.$$eval('.recent-date', (es) => es.map((e) => e.textContent.trim()));
  check('every date carries its year', stamps.every((d) => /\b\d{2}$/.test(d)),
    JSON.stringify(stamps));
  // The motivating case: a scoped list really does cross a year boundary.
  check('and the list spans more than one of them',
    new Set(stamps.map((d) => d.slice(-2))).size > 1, JSON.stringify(stamps));
  // The column is fixed width so the names line up down the list instead of
  // stepping in and out with the length of the date.
  const widths = await sp.$$eval('.recent-date', (es) =>
    [...new Set(es.map((e) => Math.round(e.getBoundingClientRect().width)))]);
  check('and the date column is one width for every row', widths.length === 1,
    JSON.stringify(widths));

  await sp.getByRole('button', { name: 'Sigma', exact: true }).click();
  check('picking the same player again clears it', (await sp.locator('.h2h').count()) === 0);
  check('and the recent list is everyone again', (await sp.locator('.recent li').count()) === 9);

  // Nobody has beaten them enough to count — a real state, not a zero.
  await sp.getByRole('button', { name: 'Neil', exact: true }).click();
  await sp.waitForSelector('.rivals-foot');
  check('a player with no qualifying rival either way says so rather than naming one',
    (await sp.locator('.stats-section').nth(1).locator('h2').innerText()).includes('no rivalries yet'),
    await sp.locator('.stats-section').nth(1).locator('h2').innerText());
  check('and neither end of their list is tagged',
    (await sp.locator('.rival-tag').count()) === 0);
  check('but their opponents are still listed', (await sp.locator('.h2h li').count()) === 1);
  await sel.close();
}

// A match imported from a written-down result — a score and no rounds. Every
// screen here reads it correctly or wrongly with nothing in the unit suite
// noticing: reading the score off `totals()` shows 0–0, and reading a rate off
// `played` rather than `rounds` reports somebody's whole career as 0.0 PPR.
// Seeded next to a real match, because both must be true at once.
{
  const legacy = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const lp = await legacy.newPage();
  await lp.goto(URL);
  await lp.evaluate(() => {
    localStorage.clear();
    const four = ['hole', 'hole', 'hole', 'hole'];
    const none = ['floor', 'floor', 'floor', 'floor'];
    const aWins = { a: four, b: none, nets: { a: 12, b: 0 }, first: 'a' };
    const bWins = { a: none, b: four, nets: { a: 0, b: 12 }, first: 'a' };
    localStorage.setItem('holecorn.matches.v1', JSON.stringify([
      // 24–12, deliberately not a skunk, so the chip below reads zero and the
      // guard is what is being measured rather than the real match's own result.
      {
        format: 1, id: 'played', startedAt: 1.7e12, endedAt: 1.7e12 + 6e5, mode: 'singles',
        players: { a: ['Neil', 'P2'], b: ['Sigma', 'P2'] },
        colors: { a: '#2f80ed', b: '#eb5757' }, target: 21, winner: 'a',
        rounds: [aWins, bWins, aWins],
      },
      // Named for the setup screen's own defaults, so the Form panel below draws
      // it without anything having to be typed.
      {
        format: 1, id: 'imported', endedAt: 1.7e12 + 9e5, mode: 'singles',
        players: { a: ['Player 1', ''], b: ['Player 2', ''] },
        colors: { a: '#2f80ed', b: '#eb5757' }, target: 21, winner: 'a',
        final: { a: 21, b: 13 }, rounds: [],
      },
    ]));
  });
  await lp.reload();
  await lp.waitForSelector('.lineup');

  // The Form panel. A record with no thrown bags behind it has no rate to give,
  // and `played` is true for it, so the blank has to come from the round count.
  const formCells = await lp.$$eval('.lineup-table tbody tr:first-child td', (tds) =>
    tds.map((t) => t.textContent.trim()));
  check('an imported result gives a lineup a record', formCells[0] === '1–0', formCells.join('|'));
  check('but no rate to show', formCells[2] === '—' && formCells[3] === '—', formCells.join('|'));

  await lp.getByRole('button', { name: 'Stats' }).click();
  await lp.waitForSelector('.stat-chips');

  const scores = await lp.$$eval('.recent-score', (s) => s.map((e) => e.textContent.trim()));
  check('an imported match shows the score it was given', scores[0] === '21–13', scores.join(' '));
  check('and a played one still shows its own', scores[1] === '24–12', scores.join(' '));

  const chips = Object.fromEntries(
    await lp.$$eval('.stat-chip', (cs) => cs.map((c) => [
      c.querySelector('.stat-chip-label').textContent,
      c.querySelector('.stat-chip-value').textContent,
    ])));
  // A 0–0 fold over no rounds makes the loser's total zero, so without the guard
  // every imported match files itself as a skunk.
  check('an imported match is no skunk', chips.skunks === '0', JSON.stringify(chips));
  // Two matches, two rounds, and the average is over the one that has any.
  check('and is left out of the average', chips['avg rounds'] === '3.0', JSON.stringify(chips));

  // By heading, not by index — adding a column shifts every position and makes a
  // positional check assert the wrong one rather than fail, which is what the
  // `Last 5` column did to these two.
  const imported = await statsFor(lp, 'Player 1');
  const played = await statsFor(lp, 'Neil');
  check('a career of imported results rates nothing', imported.PPR === '—',
    JSON.stringify(imported));
  check('while one with rounds behind it still does', played.PPR === '8.0',
    JSON.stringify(played));

  // Expanding it: no round table to show, and the footer says so rather than
  // reading "0 rounds".
  await lp.locator('.recent-open').first().click();
  await lp.waitForSelector('.match-rounds');
  check('an expanded import says it has no rounds',
    (await lp.locator('.match-rounds-foot span').first().innerText()).includes('no rounds'),
    await lp.locator('.match-rounds-foot span').first().innerText());
  check('and draws no round rows', (await lp.locator('.match-round').count()) === 0);
  await legacy.close();
}

// The setup row holds three controls now, and it must stay on one line at every
// width the app is used at — a second line puts `Start` back below the fold, which
// is the whole thing moving it up here escaped. One line is not enough to assert on
// its own: `.start-game` may shrink and the mode labels clip rather than overflow,
// so a row that silently squeezed itself would pass both a wrap check and a
// document-overflow check. Measured against each control's own natural width
// instead — the verify-lanes lesson. This is what the button saying `Start` and the
// mode's 10px side padding are for: at 22px with `Start game` the row needed 59px
// more than a 375px phone has, and 360px Android is narrower still.
{
  for (const w of [360, 375]) {
    const narrow = await browser.newContext({ viewport: { width: w, height: 667 } });
    const np = await narrow.newPage();
    await np.goto(URL);
    await np.evaluate(() => localStorage.clear());
    await np.reload();
    await np.waitForSelector('.setup');
    for (const mode of ['Singles', 'Doubles']) {
      await np.getByRole('button', { name: mode }).click();
      const r = await np.evaluate(() => {
        const top = document.querySelector('.setup-top');
        const kids = [...top.children];
        const box = (n) => n.getBoundingClientRect();
        const gap = parseFloat(getComputedStyle(top).columnGap);
        return {
          lines: new Set(kids.map((n) => Math.round(box(n).top))).size,
          // scrollWidth past the drawn width is what shrinking looks like when
          // nothing wraps: the label is being cut inside its own button.
          squeezed: kids
            .filter((n) => n.scrollWidth > Math.ceil(box(n).width))
            .map((n) => n.className || n.tagName),
          slack: Math.round(
            box(top).width - kids.reduce((s, n) => s + box(n).width, 0) - gap * (kids.length - 1),
          ),
          // What the row would need if nothing shrank, against what it has. The
          // drawn widths above cannot say this: once a control is clipping, its
          // box is the squeezed size and the slack reads 0 however far over it is.
          avail: Math.round(box(top).width),
          needed: Math.round(
            kids.reduce((s, n) => s + Math.max(n.scrollWidth, box(n).width), 0) +
              gap * (kids.length - 1),
          ),
        };
      });
      const at = `${w}px ${mode.toLowerCase()}`;
      check(`the setup row is one line at ${at}`, r.lines === 1, `${r.slack}px slack`);
      check(
        `and nothing in it is squeezed at ${at}`,
        r.squeezed.length === 0,
        `${r.squeezed.join(' ')}: needs ${r.needed}px of ${r.avail}px`,
      );
    }
    await narrow.close();
  }
}

// Nobody can play themselves, and nobody plays nameless. `lineupFaults` is unit
// tested; what only a browser can see is that Start is really held shut on it —
// and, the half that would go unnoticed, that it opens again for every lineup that
// is fine. A rule that never lets go is the same bug as one that never bites, so
// this block spends most of its checks on the lineups that must start: the defaults
// the app opens on, a save written when both teams defaulted to the same two names,
// and a guest game, whose slots still hold whatever the last real game typed.
{
  const dup = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const dp = await dup.newPage();
  dp.on('pageerror', (e) => {
    console.log('  PAGE ERROR', e.message);
    failures++;
  });
  const start = dp.getByRole('button', { name: 'Start', exact: true });
  const fields = dp.locator('.team-name-input');
  const hint = dp.locator('.lineup-hint');
  const marked = () => dp.locator('.team-name-input[aria-invalid="true"]').count();
  const fill = async (names) => {
    for (const [i, name] of names.entries()) await fields.nth(i).fill(name);
  };

  await dp.goto(URL);
  await dp.evaluate(() => localStorage.clear());
  await dp.reload();
  await dp.waitForSelector('.setup');
  check('the lineup the app opens on can start', await start.isEnabled());

  await fill(['Rho', 'Rho']);
  check('one name on both teams holds Start shut', await start.isDisabled());
  check(
    'and the hint names them',
    (await hint.innerText()).startsWith('Rho is in the lineup twice'),
    await hint.innerText(),
  );
  check('both fields are marked, so it is clear which two', (await marked()) === 2);

  await fields.nth(1).fill('Tau');
  check('a second name lets it start again', await start.isEnabled());
  check('and the hint goes with it', (await hint.count()) === 0);

  // A nameless slot is credited to nobody, so the rounds get archived and the
  // numbers go nowhere. An empty field has only its underline to be marked by.
  await fill(['Rho', '   ']);
  check('an empty name holds Start shut as well', await start.isDisabled());
  check(
    'and the hint asks for one',
    (await hint.innerText()).includes('Everyone playing needs a name'),
    await hint.innerText(),
  );
  check('with only that field marked', (await marked()) === 1);

  await dp.getByRole('button', { name: 'Doubles' }).click();
  await fill(['Rho', 'Rho', 'Phi', 'Chi']);
  check('nor can a player partner themselves', await start.isDisabled());
  await fill(['Rho', '', 'Rho', 'Chi']);
  check(
    'both faults are reported at once rather than one at a time',
    (await hint.innerText()).startsWith('Rho is in the lineup twice') &&
      (await hint.innerText()).endsWith('Everyone playing needs a name.') &&
      (await marked()) === 3,
    `${await hint.innerText()} · ${await marked()} marked`,
  );
  await fill(['Rho', 'Tau', 'Phi', 'Chi']);
  check('four different people in doubles can start', await start.isEnabled());

  await fill(['Rho', 'Tau', 'Rho', 'Tau']);
  check('a whole pair on both sides is refused too', await start.isDisabled());
  await dp.getByRole('button', { name: 'Guests' }).click();
  check('but guests start on it, because the colour is the identity', await start.isEnabled());

  // A save from when both teams defaulted to Player 1 and Player 2 is a lineup the
  // app would now refuse — for names nobody typed. loadGame renames the slots that
  // still hold a default, which no unit test can see: it isn't exported.
  await dp.evaluate(() => {
    localStorage.clear();
    localStorage.setItem(
      'holecorn.game.v3',
      JSON.stringify({ players: { a: ['Player 1', 'Player 2'], b: ['Player 1', 'Player 2'] } }),
    );
  });
  await dp.reload();
  await dp.waitForSelector('.setup');
  check('an old default lineup loads as one that can start', await start.isEnabled());
  check(
    'and reads as two players rather than one twice',
    (await fields.evaluateAll((els) => els.map((e) => e.value).join(','))) === 'Player 1,Player 2',
    await fields.evaluateAll((els) => els.map((e) => e.value).join(',')),
  );
  await dup.close();
}

// A guest game: no names taken and nothing recorded. The labels and the cleared
// lineup are pinned in the unit suites; what only a browser can see is whether the
// archive effect in App.jsx skips the write — and both ways round of getting that
// wrong are silent. Either a stranger is folded into somebody's career, or every
// real match quietly stops being filed. So the toggle is turned back off at the end
// and a real match played, which is what makes the guard the flag rather than a
// break in archiving.
{
  const guest = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const gp = await guest.newPage();
  const stored = () => gp.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), KEY);
  const play = async () => {
    for (const [team, tier] of [[0, 'bag hole'], [1, 'bag floor']]) {
      const lanes = gp.locator('.team-lanes').nth(team).locator('.lane');
      for (let i = 0; i < 4; i++) {
        await lanes.nth(i).getByLabel(tier, { exact: true }).click();
      }
    }
    await gp.getByRole('button', { name: 'End round' }).click();
  };
  const filed = async (n) => {
    try {
      await gp.waitForFunction(
        ({ key, want }) => JSON.parse(localStorage.getItem(key) || '[]').length === want,
        { key: KEY, want: n },
        { timeout: 3000 },
      );
    } catch {
      // reported by the check that follows, rather than killing the run
    }
  };

  await gp.goto(URL);
  await gp.evaluate(() => localStorage.clear());
  await gp.reload();
  await gp.waitForSelector('.setup');
  check('no hint until guests are turned on', (await gp.locator('.casual-hint').count()) === 0);
  await gp.getByRole('button', { name: 'Guests' }).click();
  check('turning them on says the game is not recorded', await gp.locator('.casual-hint').isVisible());

  check('the name fields go', (await gp.locator('.team-name-input').count()) === 0);
  check(
    'the swatches stay, because the colour is the identity now',
    (await gp.locator('.swatch').count()) === 8,
  );
  check(
    'each team is captioned by its colour',
    (await gp.locator('.team-name-static').allInnerTexts()).join(',') === 'Blue,Red',
  );
  // The slots still hold names that have been played under, so a Form panel here
  // would show a guest somebody else's record.
  check('no form panel', (await gp.locator('.lineup').count()) === 0);

  await gp.getByRole('button', { name: 'Start', exact: true }).click();
  check(
    'the play screen names the teams by colour',
    (await gp.locator('.team-name').allInnerTexts()).join(',') === 'Blue,Red',
  );
  check('and says the game is not being recorded', await gp.locator('.casual-note').isVisible());

  await play();
  await play();
  await gp.waitForTimeout(500);
  check('the guest game finished', await gp.locator('.winner-banner').isVisible());
  // winVerb reads the verb off the label, so a colour label is singular whatever
  // the mode — the known cost, asserted rather than left to be discovered.
  check(
    'the winner is announced by colour',
    (await gp.locator('.winner-banner').innerText()).trim() === 'Blue wins!',
    await gp.locator('.winner-banner').innerText(),
  );
  check('a won guest game is not archived', (await stored()).length === 0, `${(await stored()).length} records`);

  await gp.getByRole('button', { name: 'New game' }).click();
  // Sticky, because guests arrive in runs — and safe only because every New game
  // lands back here with the toggle in view.
  check(
    'the toggle is still on for the next guest game',
    (await gp.getByRole('button', { name: 'Guests' }).getAttribute('aria-pressed')) === 'true',
  );

  await gp.getByRole('button', { name: 'Guests' }).click();
  const back = gp.locator('.team-name-input');
  check('turning it off brings the fields back', (await back.count()) === 2);
  await back.nth(0).fill('Neil');
  await back.nth(1).fill('Sigma');
  await gp.getByRole('button', { name: 'Start', exact: true }).click();
  await play();
  await play();
  await filed(1);
  const [real] = await stored();
  check('a real match is filed again', (await stored()).length === 1);
  check('under the names typed for it', real?.players?.a?.[0] === 'Neil', real?.players?.a?.[0]);
  await guest.close();
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
  await insecure.getByRole('button', { name: 'Start', exact: true }).click();
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
