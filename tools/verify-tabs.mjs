// Two tabs, one game. The app keeps the whole game in memory and writes it out
// wholesale, so a tab holding a stale copy of it wins simply by writing last —
// and it silently destroys the rounds the other tab has played.
//
// Measured before the fix: a tab left on setup, three rounds played in another
// tab, one keystroke in the stale tab's name field, and storage went from three
// rounds to zero. The playing tab reloaded to an empty setup screen.
//
// None of this is reachable from a unit test. `vitest.config.js` is
// `environment: 'node'` and no test imports a `.jsx`, so the effects that read
// and write `holecorn.game.v3` are only ever exercised in a browser — and only
// a browser has a second tab to be stale in.

import { chromium } from 'playwright';

const URL = 'http://localhost:4173/';
const KEY = 'holecorn.game.v3';

let failures = 0;
const check = (label, cond, detail = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
};

const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome' });

const stored = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), KEY);
const onSetup = (page) => page.locator('.setup').count().then((n) => n === 1);
// The two headline figures are the committed score; the in-round net is `.pending`.
const logged = (page) => page.locator('.scoreboard .score').allInnerTexts().then((s) => s.join('–'));

// Count what each tab writes for the game key, so a tab that adopts another's
// game can be shown to write nothing back — the property that stops two tabs
// echoing each other's state at each other.
const countWrites = (page) =>
  page.addInitScript((key) => {
    window.__writes = 0;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === key) window.__writes += 1;
      return setItem.call(this, k, v);
    };
  }, KEY);

const writes = (page) => page.evaluate(() => window.__writes);

// A tab that was frozen or in the back/forward cache while the writing happened
// never gets the `storage` events. Dropping the registration is how that tab is
// simulated: the events fire, this page is simply not listening for them.
const deafToStorage = (page) =>
  page.addInitScript(() => {
    const add = window.addEventListener.bind(window);
    window.addEventListener = (type, fn, opts) =>
      type === 'storage' ? undefined : add(type, fn, opts);
  });

const newTab = async (context, prepare) => {
  const page = await context.newPage();
  page.on('pageerror', (e) => {
    console.log('  PAGE ERROR', e.message);
    failures++;
  });
  if (prepare) await prepare(page);
  await page.goto(URL);
  await page.waitForSelector('.app');
  return page;
};

// Four on the board against four on the floor: +4 a round, so three rounds stay
// well short of the 21 target and the game is still in progress at the end.
const playRound = async (page, tier = 'board') => {
  const lanes = await page.locator('.lane').all();
  for (let i = 0; i < 4; i += 1) await lanes[i].locator(`.tier-${tier}`).click();
  for (let i = 4; i < 8; i += 1) await lanes[i].locator('.tier-floor').click();
  await page.locator('.end-round').click();
  await page.waitForFunction(() => document.querySelectorAll('.lane input:checked').length === 0);
};

console.log('a stale tab does not overwrite the game the other tab is playing');
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // The stale tab opens *first* and is left on setup, which is the whole point:
  // it holds a copy of the game from before any of the rounds below.
  const stale = await newTab(context, countWrites);
  const playing = await newTab(context);
  check('both tabs opened on the same game', (await stored(stale)).id === (await stored(playing)).id);

  const settled = await writes(stale);
  await playing.getByRole('button', { name: 'Start', exact: true }).click();
  for (let r = 0; r < 3; r += 1) await playRound(playing);
  await stale.waitForTimeout(200);

  check('storage holds the three rounds that were played', (await stored(playing)).rounds.length === 3);
  check(
    'the stale tab followed the game onto the play screen',
    !(await onSetup(stale)) && (await logged(stale)) === '12–0',
  );
  check(
    'and wrote nothing back, so the two tabs do not echo at each other',
    (await writes(stale)) === settled,
    `${(await writes(stale)) - settled} extra write(s)`,
  );

  // The defect was triggered by the stale tab's *next* write, whatever it was — a
  // keystroke in a name field was enough. Now that it has caught up, its own edit
  // carries the three rounds with it. Driven by whichever screen the tab is on so
  // that a broken app reports a failure here rather than timing out on a control
  // it never grew, which would take the rest of the file down with it.
  const edited = await writes(stale);
  if (await onSetup(stale)) await stale.locator('.team-name-input').first().fill('Rho');
  else await stale.locator('.lane').first().locator('.tier-hole').click();
  await stale.waitForTimeout(200);
  check('the once-stale tab wrote something of its own', (await writes(stale)) > edited);
  check(
    'and its write kept the rounds',
    (await stored(stale)).rounds.length === 3,
    `${(await stored(stale)).rounds.length} rounds`,
  );

  await playing.reload();
  await playing.waitForSelector('.app');
  check(
    'and the playing tab reloads to the game, not to setup',
    !(await onSetup(playing)) && (await stored(playing)).rounds.length === 3,
  );
  await context.close();
}

console.log('\na tab that missed the events catches up when it comes back');
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const asleep = await newTab(context, async (page) => {
    await deafToStorage(page);
    await countWrites(page);
  });
  const playing = await newTab(context);

  const settled = await writes(asleep);
  await playing.getByRole('button', { name: 'Start', exact: true }).click();
  for (let r = 0; r < 3; r += 1) await playRound(playing);
  await asleep.waitForTimeout(200);
  check(
    'it is genuinely still stale, so the assertions below can fail',
    await onSetup(asleep),
  );

  await asleep.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await asleep.waitForTimeout(200);
  check('coming back to it adopts the game', !(await onSetup(asleep)));
  check('and that tab writes nothing back either', (await writes(asleep)) === settled);
  await context.close();
}

console.log('\nthe other tab is brought to the win without replaying it');
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const watching = await newTab(context);
  const playing = await newTab(context);

  await playing.getByRole('button', { name: 'Start', exact: true }).click();
  // Four in the hole against four on the floor: +12 a round, so two rounds take it
  // past 21 and the second one wins.
  for (let r = 0; r < 2; r += 1) await playRound(playing, 'hole');
  await watching.waitForTimeout(300);

  check('the tab that played it flashes the callout', (await playing.locator('.callout').count()) === 1);
  check(
    'the other tab shows the win',
    (await watching.locator('.winner-banner').count()) === 1,
  );
  check(
    'but does not replay a round it never saw',
    (await watching.locator('.callout').count()) === 0,
  );
  const archive = await watching.evaluate(() =>
    JSON.parse(localStorage.getItem('holecorn.matches.v1') || '[]'),
  );
  check('and the two tabs file one record between them', archive.length === 1, `${archive.length}`);

  await playing.getByRole('button', { name: 'New game', exact: true }).click();
  await playing.waitForSelector('.setup');
  await watching.waitForTimeout(200);
  check('New game in one tab returns the other to setup', await onSetup(watching));
  await context.close();
}

await browser.close();
if (failures) {
  console.error(`\n${failures} tab check(s) failed`);
  process.exit(1);
}
console.log('\ntab checks passed');
