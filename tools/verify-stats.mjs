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
  for (const [team, tier] of [[0, 'hole'], [1, 'floor']]) {
    const lanes = page.locator('.team-lanes').nth(team).locator('.lane');
    for (let i = 0; i < 4; i++) {
      await lanes.nth(i).locator(`.tier-${tier}`).click();
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
// has nothing left to lose and is already archived. The button says which it is
// before you press it, so finding it under this name *is* the first assertion.
await page.getByRole('button', { name: 'New game' }).click();
check(
  'a won game starts a new one without asking',
  await page.getByRole('button', { name: 'Start', exact: true }).isVisible(),
);

// Second match, so the stats screen has more than one row of history — and the
// half-played state is what proves the prompt still guards real work.
await page.getByRole('button', { name: 'Start', exact: true }).click();
await playRound();
await page.getByRole('button', { name: 'Abandon game' }).click();
check('a game in progress still asks first', await page.getByText('Abandon this game?').isVisible());
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
  // Asserted as the colour drawn, not as an inline `background`, which is what it used to
  // read: the pip carries `--team` now and the stylesheet derives the rest, so a check on
  // the style attribute was measuring the mechanism rather than the property — and it went
  // red on a change that kept the tint working perfectly.
  const litPips = page.locator('.lineup-table .form-line-pip.is-win');
  const pipTint = await page.evaluate(() => {
    const pip = document.querySelector('.lineup-table .form-line-pip.is-win');
    // The untinted colour is read off a *probe element*, not off `--text` itself. A custom
    // property's value is the raw token — `light-dark(…)` — where the pip's is a resolved
    // `rgb(…)`, so comparing the two directly can never match however the tint is drawn,
    // and the check passed with the team colour dropped entirely. Verified by mutation.
    const probe = document.createElement('span');
    probe.style.color = 'var(--text)';
    document.body.append(probe);
    const plain = getComputedStyle(probe).color;
    probe.remove();
    return { lit: pip && getComputedStyle(pip).backgroundColor, plain };
  });
  check(
    'the form panel tints its win pips with the team colour',
    (await litPips.count()) > 0 && pipTint.lit && pipTint.lit !== pipTint.plain,
    `${await litPips.count()} lit, ${pipTint.lit} against the untinted ${pipTint.plain}`,
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
//
// The rest of this block is about *where* the delete is. It used to be a 34px × on the
// row itself, six pixels from the chevron you press every visit, and its undo bar
// rendered at the top of a screen you have scrolled to the bottom of — measured 486px
// above the viewport, so a mis-tap looked like a row spontaneously vanishing. Nothing in
// the components would notice either coming back, so the shut row's control count is
// asserted rather than only the new path working.
const recentRows = page.locator('.recent li');
check(
  'a shut row has one control, so a tap on it can only open the match',
  (await recentRows.first().locator('button').count()) === 1,
);
check('no undo bar is left behind', (await page.locator('.stats-undo').count()) === 0);
await recentRows.first().locator('.recent-open').click();
check('a match can be open before deleting', (await recentRows.first().locator('.match-round').count()) > 0);

// The dialog is read through a count first, and the row is reopened rather than assumed
// still open: a delete that skipped the dialog deletes on that first press, so every
// locator below it is gone and the run would end in a stack trace instead of naming the
// fault. Verified — that is exactly what the no-confirm mutation did before this.
const openAndDrop = async () => {
  const row = recentRows.first();
  if ((await row.locator('.match-drop').count()) === 0) await row.locator('.recent-open').click();
  await row.locator('.match-drop').click();
};

await openAndDrop();
const asked = (await page.locator('.modal:modal').count()) === 1;
check('delete asks first, in a modal dialog', asked);
// Naming the match is what makes a mis-tap recoverable now that the undo is gone: the
// dialog is the last point at which the wrong row is still visible as the wrong row.
const title = asked ? await page.locator('.modal-title').innerText() : '';
check('and the dialog names the match it would delete', title.includes('Neil v Sigma'), title || 'no dialog');
if (asked) await page.locator('.modal').getByRole('button', { name: 'Cancel' }).click();
check('cancelling leaves the match in the list', (await recentRows.count()) === 2);
check('and in storage', (await archive()).length === 2);
check('and leaves it open', (await recentRows.first().locator('.match-round').count()) > 0);

await openAndDrop();
if (await page.locator('.confirm-danger').count()) await page.locator('.confirm-danger').click();
check('confirming removes the match from the list', (await recentRows.count()) === 1);
check('and from storage', (await archive()).length === 1);
check('and closes the detail with it', (await page.locator('.match-round').count()) === 0);

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

// Import is a file input inside its label, so how it is hidden decides whether it exists
// at all for anything but a finger. Under `display: none` it reached the accessibility
// tree as a bare `text: Import JSON` and `Export as JSON` was the last tab stop on the
// page — measured, Tab from it left the document. So these assert the control rather than
// the word, which is what the `getByText` check they replace was doing.
const importLabel = page.locator('.file-button');
check(
  'import is a named control, not loose text',
  (await page.getByRole('button', { name: 'Import JSON' }).count()) === 1,
);
await page.getByRole('button', { name: 'Export as JSON' }).focus();
await page.keyboard.press('Tab');
check(
  'and the next tab stop after export',
  await page.evaluate(() => document.activeElement?.type === 'file'),
  await page.evaluate(() => document.activeElement?.tagName ?? 'none'),
);
// The ring has to be on the label: the input itself is clipped to 1px, so its own ring is
// invisible and a keyboard user would be on a control with nothing to say so.
check(
  'the focus ring lands on the visible label',
  (await importLabel.evaluate((el) => getComputedStyle(el).outlineStyle)) !== 'none',
);
// Reachable is not the same as usable — the picker has to actually open without a pointer.
// Bounded and swallowed, because a hidden input simply never opens one, and an unbounded
// wait there ends the whole run in a stack trace instead of naming the fault.
const opensPicker = async (activate) => {
  try {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 15_000 }),
      activate(),
    ]);
    // Dismissed with no file, which `importMatches` returns early on. An unanswered
    // chooser would still be open for the next interaction.
    await chooser.setFiles([]);
    return true;
  } catch {
    return false;
  }
};

// **The keyboard half asserts that the press lands, not that a chooser follows, and that
// is a limit of the container rather than a softening.** Chromium there opens a chooser
// for a pointer activation every time and for a keypress only sometimes — measured with
// a capture-phase listener, the failing runs deliver `Enter` to the focused
// `input[type=file]` with `isTrusted` true and `defaultPrevented` false, and no chooser
// ever arrives. So a wait was measuring the runner, and not by being too short: it was
// already loosened from 3s to 15s once for the same reason, and at 15s the event is not
// late, it is absent. Nothing about the app differs between a passing run and a failing
// one, which is the whole reason this cannot stay as it was.
//
// It still covers the regression the block exists for. Under `display: none` the input
// left the accessibility tree entirely, so Tab skipped it and no key reached it at all —
// which fails the tab stop above *and* this. And the chooser itself is still asserted,
// on the pointer path immediately below.
const dismiss = (chooser) => chooser.setFiles([]);
page.on('filechooser', dismiss);
await page.evaluate(() => {
  window.__enter = null;
  document.addEventListener(
    'keydown',
    (e) => {
      window.__enter = { type: e.target?.type, prevented: e.defaultPrevented };
    },
    { capture: true, once: true },
  );
});
await page.keyboard.press('Enter');
const landed = await page.evaluate(() => window.__enter);
page.off('filechooser', dismiss);
check(
  'and Enter reaches the file input with nothing swallowing it',
  landed?.type === 'file' && landed.prevented === false,
  JSON.stringify(landed),
);
// `:focus-within` would light the ring for a tap too, and the input keeps focus after one,
// so the ring would sit there until something else took it. That is what `:has(:focus-
// visible)` buys, and without this it reads as complication and gets tidied back.
await page.evaluate(() => document.activeElement?.blur());
const tapped = await opensPicker(() => importLabel.click({ position: { x: 40, y: 20 } }));
check(
  'but a tap leaves no ring behind',
  tapped &&
    (await importLabel.evaluate((el) => getComputedStyle(el).outlineStyle)) === 'none' &&
    (await page.evaluate(() => document.activeElement?.type === 'file')),
);

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
check(
  'import is offered with nothing to show',
  await fresh.getByRole('button', { name: 'Import JSON' }).isVisible(),
);

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
  await delPage.locator('.recent-open').first().click();
  await delPage.locator('.match-drop').click();
  await delPage.locator('.confirm-danger').click();
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
    }, {
      // An older, separate match, so the block has a pair who have **never** shared a
      // lineup. Without it every name here has met every other and there is no clean
      // merge left to check — the four in r1 are two partnerships and one fixture.
      // Dated behind r1 so the recent list still opens r1 first.
      format: 1, id: 'r2', startedAt: 1.7e12 - 12e5, endedAt: 1.7e12 - 6e5, mode: 'singles',
      players: { a: ['Sigma', ''], b: ['Omega', ''] },
      colors: { a: '#2f80ed', b: '#eb5757' }, target: 21, winner: 'a',
      rounds: [round(bags('hole'), bags('floor'), 12, 0), round(bags('hole'), bags('floor'), 12, 0)],
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
  // The editor refuses the same lineup the setup screen does, and this is the only
  // thing that can see it: `lineupFaults` is unit tested, and whether the dialog
  // asks it is `.jsx`. It used to *warn* and save anyway, which was the last route
  // to a record with one person on both sides.
  const editSave = renPage.locator('.match-names').getByRole('button', { name: 'Save' });
  await slots.nth(1).fill('Rho');
  check('the match editor refuses one person in two slots', await editSave.isDisabled());
  check(
    'and says which name is doubled',
    (await renPage.locator('.match-names-note').innerText()).includes('Rho'),
    await renPage.locator('.match-names-note').innerText().catch(() => '(no hint)'),
  );
  await slots.nth(1).fill('');
  check('it refuses a blank slot too', await editSave.isDisabled());

  await slots.nth(1).fill('Tau');
  check('and lets a corrected lineup through', await editSave.isEnabled());
  await editSave.click();

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

  // Chi and Phi were **partners** in r1, so folding them makes somebody their own
  // partner — the same `twice` fault, and the other route to a record the rest of
  // this now refuses. `renameClashes` is unit tested; only a browser can see the
  // dialog ask it.
  await openRename(renPage, 'Chi');
  await renPage.locator('.rename-input').fill('Phi');
  const mergeBtn = renPage.locator('.modal').getByRole('button', { name: 'Merge' });
  check('a rename onto somebody they have played is refused', await mergeBtn.isDisabled());
  check(
    'and names the matches in the way',
    (await renPage.locator('.rename-refused').innerText()).includes('1 match'),
    await renPage.locator('.rename-refused').innerText().catch(() => '(no refusal)'),
  );
  await renPage.locator('.modal').getByRole('button', { name: 'Cancel' }).click();

  // The other direction, and it is what stops the rule from simply banning merges:
  // Sigma played only r2, so folding them into Rho puts nobody on both sides.
  await openRename(renPage, 'Sigma');
  await renPage.locator('.rename-input').fill('Rho');
  check('two spellings who never met still merge', await mergeBtn.isEnabled());
  check('a merge is named as a merge', await renPage.getByText('already has 1 match').isVisible());
  check(
    'and no refusal is shown for it',
    (await renPage.locator('.rename-refused').count()) === 0,
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

// Marking somebody as no longer playing. `inactive.js` is pure and unit tested, so
// what is left is entirely wiring, and it crosses three files: Stats writes the mark,
// App re-reads it on the way back, and `knownNames` is what both the setup fields and
// the tournament draw offer from. Each of those is individually correct however they
// are joined up — a mark that is written and never read hides nobody, and nothing on
// any screen says so.
{
  const off = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const offPage = await off.newPage();
  offPage.on('pageerror', (e) => {
    console.log('  PAGE ERROR', e.message);
    failures++;
  });
  const MARKS = 'holecorn.inactive.v1';
  const offered = () =>
    offPage.locator('#known-names option').evaluateAll((os) => os.map((o) => o.value));

  await offPage.goto(URL);
  // Three singles players, so there is somebody to mark, somebody to leave alone, and
  // a third to prove the list is filtered rather than emptied. Rho plays the most
  // recent game, which is what the return-on-play assertion below turns on.
  await offPage.evaluate(() => {
    localStorage.clear();
    const rec = (id, a, b, endedAt) => ({
      format: 1, id, startedAt: endedAt - 6e5, endedAt, mode: 'singles',
      players: { a: [a, ''], b: [b, ''] },
      colors: { a: '#27ae60', b: '#f2c94c' }, target: 21, winner: 'a',
      final: { a: 21, b: 9 }, rounds: [],
    });
    localStorage.setItem('holecorn.matches.v1', JSON.stringify([
      rec('i1', 'Rho', 'Tau', 1.7e12),
      rec('i2', 'Sigma', 'Tau', 1.7e12 + 1e6),
    ]));
  });
  await offPage.reload();
  await offPage.waitForSelector('.setup');
  const before = await offered();
  check(
    'everyone in the archive is offered to begin with',
    ['Rho', 'Sigma', 'Tau'].every((n) => before.includes(n)),
    before.join(','),
  );

  await offPage.getByRole('button', { name: 'Stats' }).click();
  await offPage.locator('.stats-table tbody tr', { hasText: 'Tau' }).locator('.player-select').click();
  const tauRow = offPage.locator('.stats-table tbody tr', { hasText: 'Tau' });
  check(
    'a selected player offers the control',
    await offPage.getByRole('button', { name: 'Mark inactive' }).isVisible(),
  );
  const playedBefore = await tauRow.locator('td').first().innerText();
  await offPage.getByRole('button', { name: 'Mark inactive' }).click();

  // Dimmed rather than tagged, so the sticky name column keeps its width. Read off
  // the button inside the header cell, never the cell: fading the sticky cell's own
  // background lets the columns scrolling under it show through the name.
  const dimmed = await tauRow.locator('.player-select').evaluate((e) =>
    Number(getComputedStyle(e).opacity),
  );
  const solidTh = await tauRow.locator('th').evaluate((e) => Number(getComputedStyle(e).opacity));
  check('the row dims', dimmed < 1, `${dimmed}`);
  check('but the sticky cell itself stays opaque', solidTh === 1, `${solidTh}`);
  check(
    'the panel says so in words, since dimming alone cannot',
    await offPage.locator('.rivals-inactive').isVisible(),
  );
  check(
    'their matches and their numbers are untouched',
    (await tauRow.locator('td').first().innerText()) === playedBefore
      && (await offPage.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]').length, KEY)) === 2,
    playedBefore,
  );
  check(
    'the control now offers the way back',
    await offPage.getByRole('button', { name: 'Mark active' }).isVisible(),
  );

  await offPage.getByRole('button', { name: '‹ Back' }).click();
  await offPage.waitForSelector('.setup');
  const after = await offered();
  check(
    'they stop being offered by the setup fields, without a reload',
    !after.includes('Tau'),
    after.join(','),
  );
  check('and everybody else still is', after.length === 2, after.join(','));

  await offPage.getByRole('button', { name: 'Tournaments', exact: true }).click();
  await offPage.getByRole('button', { name: 'New tournament' }).click();
  const chips = await offPage.locator('.roster-chip').allInnerTexts();
  check(
    'and the tournament roster drops them too, from the same list',
    chips.length === 2 && !chips.includes('Tau'),
    chips.join(','),
  );
  await offPage.getByRole('button', { name: '‹ Back' }).click();
  await offPage.waitForSelector('.setup');

  // The mark is a timestamp rather than a flag precisely so this needs no second
  // write path: playing again is newer than the mark, so they are simply back.
  check('the mark is stored as a stamp, not a flag', await offPage.evaluate((key) => {
    const marks = JSON.parse(localStorage.getItem(key) || '{}');
    return Number.isFinite(marks.tau) && marks.tau > 0;
  }, MARKS));
  await offPage.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('holecorn.matches.v1'));
    all.push({
      format: 1, id: 'i3', startedAt: Date.now() - 6e5, endedAt: Date.now() + 6e5,
      mode: 'singles', players: { a: ['Tau', ''], b: ['Rho', ''] },
      colors: { a: '#27ae60', b: '#f2c94c' }, target: 21, winner: 'a',
      final: { a: 21, b: 9 }, rounds: [],
    });
    localStorage.setItem('holecorn.matches.v1', JSON.stringify(all));
  });
  await offPage.reload();
  await offPage.waitForSelector('.setup');
  const back = await offered();
  check(
    'playing again puts them back with nothing else written',
    back.includes('Tau'),
    back.join(','),
  );
  check(
    'and the mark is still on disk, so it was derived rather than cleared',
    await offPage.evaluate((key) => Boolean(JSON.parse(localStorage.getItem(key) || '{}').tau), MARKS),
  );
  await off.close();
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
      // The score belongs to the matchup and has to stay beside it. `.recent-teams` used
      // to grow, which right-aligned the score into a column that looks tidier and reads
      // down to nothing — `22–8` says nothing until you know which name is first — and put
      // it 789px from the last name at exactly this width. Measured off the *text*: the
      // box is what grows, so reading the box reports no gap however far the score drifts.
      scoreGap: (() => {
        const teams = document.querySelector('.recent-teams');
        const range = document.createRange();
        range.selectNodeContents(teams);
        const ink = range.getBoundingClientRect().right;
        range.detach();
        const score = document.querySelector('.recent-score').getBoundingClientRect();
        return Math.round(score.left - Math.min(ink, teams.getBoundingClientRect().right));
      })(),
      // The slack goes here instead, so the disclosure marker still marks the edge of the
      // row it opens rather than floating mid-row.
      chevronInset: (() => {
        const row = document.querySelector('.recent-open').getBoundingClientRect();
        const chev = document.querySelector('.recent-chevron').getBoundingClientRect();
        return Math.round(row.right - chev.right);
      })(),
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
  // Structural now the grid is `.app.play-screen` rather than a list of exclusions, but
  // this is the screen that taught it, and what it catches is a broad selector coming back.
  check('it does not take the play screen grid', m.display !== 'grid', m.display);
  // `.app` also declares max-width, and Stats.css is bundled first, so the single-class
  // form lost at equal specificity and the screen ran at `.app`'s 480px.
  check('its own max-width wins over .app', m.maxWidth === '1040px', m.maxWidth);
  check('and it uses that width', m.width === 1040, `${m.width}px`);
  check('so the career table need not scroll sideways', !m.tableOverflows);
  check('the seven summary chips fit one row', m.chipRows === 1, `${m.chipRows} rows`);
  check('and the prose stays a readable line length', m.proseChars <= 85, `~${m.proseChars} chars`);
  // The 1040px cap does not fix this and was credited with it for a while — at the cap the
  // row is still 114 characters wide, so the gap has to be closed on the row itself.
  check('a recent row keeps its score beside the matchup', m.scoreGap <= 24, `${m.scoreGap}px away`);
  check('and its marker on the row edge', m.chevronInset <= 20, `${m.chevronInset}px in`);
  await wide.close();
}

// The career table on a phone, where it scrolls sideways by design and the name column
// is sticky and opaque. At any resting offset that is not a column boundary the sticky
// cell paints over the *left* of the next column — so `31%` renders as `1%` and `28%` as
// `8%`, every fragment a plausible hole percentage with nothing saying the value is
// wrong. Scroll snapping is what makes a resting position always a boundary, and only a
// browser can see it: the numbers themselves are right throughout.
{
  const snapCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const snapPage = await snapCtx.newPage();
  await snapPage.goto(URL);
  await snapPage.evaluate((records) => {
    localStorage.clear();
    localStorage.setItem('holecorn.matches.v1', JSON.stringify(records));
  }, [won]);
  await snapPage.reload();
  await snapPage.getByRole('button', { name: 'Stats' }).click();
  await snapPage.waitForSelector('.stats-table');

  const scrolls = await snapPage.evaluate(async () => {
    const s = document.querySelector('.stats-scroll');
    const out = [];
    for (const by of [30, 55, 90, 120, 175, 210]) {
      s.scrollLeft = 0;
      await new Promise((r) => setTimeout(r, 60));
      s.scrollBy({ left: by, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 400));
      const edge = document.querySelector('.stats-table tbody th').getBoundingClientRect().right;
      const cut = [...document.querySelectorAll('.stats-table tbody td')].filter((c) => {
        const r = c.getBoundingClientRect();
        return r.left < edge - 0.5 && r.right > edge + 0.5;
      });
      out.push({ by, at: Math.round(s.scrollLeft), cut: cut.length });
    }
    return out;
  });
  check(
    'the table really does scroll sideways on a phone',
    scrolls.some((x) => x.at > 0),
    JSON.stringify(scrolls),
  );
  check(
    'and no column is left half under the sticky name after a drag',
    scrolls.every((x) => x.cut === 0),
    scrolls.map((x) => `${x.by}->${x.at}:${x.cut}`).join(' '),
  );
  // The pin and the snap padding are one number declared once; if they drift, a rested
  // column sits part-way under the name again and the check above is the only symptom.
  const pinned = await snapPage.evaluate(() => {
    const s = document.querySelector('.stats-scroll');
    return {
      pad: getComputedStyle(s).scrollPaddingLeft,
      col: `${Math.round(
        document.querySelector('.stats-table tbody th').getBoundingClientRect().width,
      )}px`,
    };
  });
  check('the snap padding equals the pinned name column', pinned.pad === pinned.col, JSON.stringify(pinned));
  await snapCtx.close();
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

  // The list shows a page at a time, so a player outside the newest twelve had to be paged
  // to — measured on the sample archive, four of eleven players, one of them with 37
  // matches played. Scoping puts their own history on the first page.
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

// The recent list is paged, and the pager is the only route to most of the archive: delete,
// the round-by-round expansion and Edit names all live *inside* a row, so a match the list
// will not draw cannot be opened, corrected or deleted at all. It used to stop at 12 — and
// measured on the sample archive that left 86 of 156 matches (55%) with none of the three,
// the newest of them five months old, with the per-player scoping above already counted.
// Nothing in the unit suite can see any of this: `Stats.jsx` is the only place the archive
// meets a page.
{
  const pag = await browser.newContext({ viewport: { width: 393, height: 852 } });
  const pp = await pag.newPage();
  pp.on('pageerror', (e) => { console.log('  PAGE ERROR', e.message); failures++; });
  await pp.goto(URL);
  await pp.evaluate(() => {
    localStorage.clear();
    const four = ['hole', 'hole', 'hole', 'hole'];
    const none = ['floor', 'floor', 'floor', 'floor'];
    const beat = (opponent, id, day, rounds) => ({
      format: 1, id, endedAt: Date.UTC(2026, 5, day, 12), mode: 'singles',
      players: { a: ['Neil', ''], b: [opponent, ''] },
      colors: { a: '#2f80ed', b: '#eb5757' }, target: 21, winner: 'a',
      final: { a: 21, b: 11 }, rounds,
    });
    // Fourteen, so the second page holds exactly two — few enough to empty by deleting,
    // which is the only thing that shortens the list under a page that has been paged to.
    // Neil is in all of them and Sigma in exactly the newest twelve, so scoping to one
    // pages and scoping to the other does not.
    localStorage.setItem('holecorn.matches.v1', JSON.stringify([
      ...Array.from({ length: 12 }, (_, i) => beat('Sigma', `new-${i}`, 20 - i, [])),
      // The two oldest, and the only matches either of these two ever played, so an
      // assertion on the row is an assertion about which page is on screen. The first
      // carries a round, because the expansion is one of the three things being reached.
      beat('Upsilon', 'old-a', 3, [{ a: four, b: none, nets: { a: 12, b: 0 }, first: 'a' }]),
      beat('Omicron', 'old-b', 2, []),
    ]));
  });
  await pp.reload();
  await pp.getByRole('button', { name: 'Stats' }).click();
  await pp.waitForSelector('.recent li');

  const newest = pp.getByRole('button', { name: 'Newest matches' });
  const newer = pp.getByRole('button', { name: 'Newer matches' });
  const older = pp.getByRole('button', { name: 'Older matches' });
  const oldest = pp.getByRole('button', { name: 'Oldest matches' });
  const upsilon = pp.locator('.recent-teams', { hasText: 'Upsilon' });
  // Both read through a count first, the way the delete dialog above is: a list with no
  // pager has no range and no arrows either, so reading one straight off ends the run in a
  // 30s timeout instead of naming the fault. Verified — that is exactly what the mutation
  // back to a hard cap of 12 did before this. It is also a state the screen reaches
  // legitimately, once a deletion leaves one page.
  const range = async () =>
    (await pp.locator('.recent-at').count()) ? pp.locator('.recent-at').innerText() : 'no pager';
  // Inert as well as absent, and for the same reason: pressing an arrow at the end of the
  // list moves nothing, so a run that goes on to assert a page turn reports a fault that is
  // its own. Verified — dropping the page reset below left the list on its last page, and
  // pressing for older there failed a later assertion rather than the one at fault.
  const inert = async (arrow) => (await arrow.getAttribute('aria-disabled')) === 'true';
  const press = async (arrow) => {
    if ((await arrow.count()) && !(await inert(arrow))) await arrow.click();
  };
  const focused = () =>
    pp.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName);

  const paged = (await pp.locator('.recent-paging').count()) === 1;
  check('a list longer than a page gets a pager', paged);
  check('the list opens on one page of matches', (await pp.locator('.recent li').count()) === 12);
  // The range is the only thing that says how much history is behind the page. Before it
  // the twelfth row was the end of the archive as far as anything on screen said.
  check('and the range says how much is behind it', (await range()) === '1–12 of 14', await range());
  if (paged) {
    check('with nothing newer to go to', (await inert(newer)) && (await inert(newest)));
  }
  check('a match past the first page is not drawn yet', (await upsilon.count()) === 0);

  await press(older);
  check('paging older reaches the rest of the archive',
    (await pp.locator('.recent li').count()) === 2);
  check('and the range moves with it', (await range()) === '13–14 of 14', await range());
  check('the oldest match is on screen', (await upsilon.count()) === 1);
  if (paged) {
    check('with nothing older to go to', (await inert(older)) && (await inert(oldest)));
  }

  // The three things that live inside a row, which is the whole reason a cap here was not
  // merely a browsing limit. Asserted on a row that only a second page can reach.
  const row = pp.locator('.recent li').first();
  await row.locator('.recent-open').click();
  check('a match on a later page opens round by round',
    (await row.locator('.match-round').count()) === 1);
  check('and offers Edit names',
    (await row.getByRole('button', { name: 'Edit names' }).count()) === 1);
  check('and Delete', (await row.locator('.match-drop').count()) === 1);

  // Stepping does not scale — measured on the stress fixture, 973 matches is 81 presses of
  // the older arrow — and the far end is a named errand, since the full-archive refusal
  // tells you to delete some matches and the ones to delete are the oldest.
  await press(newest);
  check('one press returns to the newest page', (await range()) === '1–12 of 14', await range());
  await press(oldest);
  check('and one reaches the oldest', (await range()) === '13–14 of 14', await range());
  // An arrow that goes inert under the finger is the fault the deleted undo bar had: a real
  // `disabled` cannot hold focus, so pressing » dropped focus to `BODY` and a keyboard user
  // had to Tab from the top of the document to get back. Only the browser can see this.
  check('and pressing an end leaves focus on the arrow rather than dropping it',
    (await focused()) === 'Oldest matches', await focused());

  // Selecting scopes the list, and the page has to come back to the top with it: page 2 of
  // somebody's history is an arbitrary place to land from pressing their name. Neil is in
  // all fourteen, so their scoped list still pages and the range can be read.
  await pp.getByRole('button', { name: 'Neil', exact: true }).click();
  check('scoping to a player starts at their newest matches',
    (await range()) === '1–12 of 14', await range());
  await pp.getByRole('button', { name: 'Neil', exact: true }).click();
  await pp.getByRole('button', { name: 'Sigma', exact: true }).click();
  check('and a history that fits one page has no pager at all',
    (await pp.locator('.recent-paging').count()) === 0);
  await pp.getByRole('button', { name: 'Sigma', exact: true }).click();

  // The page is clamped on the way out rather than reset by whatever shortened the list, so
  // emptying the last page lands on one that has rows. Without it the list draws nothing at
  // all — an archive of 12 matches showing an empty section.
  await press(oldest);
  for (const _ of [0, 1]) {
    const last = pp.locator('.recent li').first();
    if ((await last.locator('.match-drop').count()) === 0) {
      await last.locator('.recent-open').click();
    }
    await last.locator('.match-drop').click();
    await pp.locator('.confirm-danger').click();
  }
  check('emptying the last page falls back to one with matches on it',
    (await pp.locator('.recent li').count()) === 12);
  check('and the pager goes when there is one page left',
    (await pp.locator('.recent-paging').count()) === 0);
  await pag.close();
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
    for (const [team, tier] of [[0, 'hole'], [1, 'floor']]) {
      const lanes = gp.locator('.team-lanes').nth(team).locator('.lane');
      for (let i = 0; i < 4; i++) {
        await lanes.nth(i).locator(`.tier-${tier}`).click();
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

// A localStorage that reads but will not write — Safari's "Block All Cookies", or
// a quota the archive has already filled. The persist effect is the only unguarded
// write there was, and an uncaught throw in a passive effect unmounts the React
// root: the failure is a permanently blank page, on this load and every one after.
// Nothing below App.jsx can see it, and no unit test runs an effect.
//
// Checked before anything is clicked, for the reason the insecure block above is:
// waiting on a button that will never appear times out the run instead of naming
// the fault.
{
  const full = await browser.newContext();
  await full.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function blocked(key, value) {
      if (key === 'holecorn.game.v3') throw new DOMException('quota', 'QuotaExceededError');
      return setItem.call(this, key, value);
    };
  });
  const stuck = await full.newPage();
  const boom = [];
  stuck.on('pageerror', (e) => boom.push(e.message));
  await stuck.goto(URL);
  await stuck.waitForTimeout(400);

  const alive = (await stuck.locator('.app').count()) > 0;
  check('the app renders when the game cannot be saved', alive, boom.join(' | '));
  check('no uncaught error from the failed write', boom.length === 0, boom.join(' | '));

  if (alive) {
    check(
      'and says so, rather than losing the game silently',
      await stuck.locator('.save-warning').first().isVisible(),
      await stuck.locator('.save-warning').first().innerText(),
    );
    // The round that would have blanked the screen: the write fires on every
    // committed round, so this is where a full storage bites mid-game.
    await stuck.getByRole('button', { name: 'Start', exact: true }).click();
    for (const [team, tier] of [[0, 'hole'], [1, 'floor']]) {
      const lanes = stuck.locator('.team-lanes').nth(team).locator('.lane');
      for (let i = 0; i < 4; i++) {
        await lanes.nth(i).locator(`.tier-${tier}`).click();
      }
    }
    await stuck.getByRole('button', { name: 'End round' }).click();
    await stuck.waitForTimeout(200);
    check(
      'and survives the round it would have died on',
      (await stuck.locator('.team-lanes').count()) === 2 && boom.length === 0,
      boom.join(' | '),
    );
    // The two headline figures are the committed score; the in-round net is `.pending`.
    const logged = (await stuck.locator('.scoreboard .score').allInnerTexts()).join('–');
    check('and the round was still scored', logged === '12–0', logged);
  }
  await full.close();
}

await browser.close();
if (failures) {
  console.error(`\n${failures} stats check(s) failed`);
  process.exit(1);
}
console.log('\nstats checks passed');
