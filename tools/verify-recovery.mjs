// A save the app cannot play must land you on setup, not on a blank page.
//
// Measured before the fix, across 43 shapes a `holecorn.game.v3` value can hold:
// 18 of them blanked the app, and **not one recovered**. The crash is during
// render, so the effect that persists game state never runs and the bad value is
// never replaced — every reload blanks again, and there is no screen left to
// clear it from. On a phone that is an app that has to be uninstalled, taking the
// career archive with it.
//
// None of this is reachable from a unit test. `validGame` is pure and
// `scoring.test.js` covers the corpus below shape by shape, but `loadGame` lives
// in `App.jsx` and `vitest.config.js` is `environment: 'node'` with no test
// importing a `.jsx` — so whether the guard is *called* is only ever observable
// in a browser. Deleting the `validGame(merged)` line passes all 595 unit tests.
//
// The check is two-sided on purpose. Rejecting more is not safer: a validator
// that refuses a legitimate save silently deletes a game in progress, and the
// second block is what stops a future failure being "fixed" by widening the
// refusal until the first block passes.

import { chromium } from 'playwright';

const URL = 'http://localhost:4173/';
const KEY = 'holecorn.game.v3';

let failures = 0;
const check = (label, cond, detail = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
};

const round = {
  a: ['hole', 'board', 'floor', 'floor'],
  b: ['board', 'floor', 'floor', 'floor'],
  nets: { a: 3, b: 0 },
  first: 'a',
};
const good = {
  id: 'saved-game',
  players: { a: ['Rho', 'Tau'], b: ['Sigma', 'Phi'] },
  colors: { a: '#2f80ed', b: '#eb5757' },
  mode: 'singles',
  casual: false,
  tournament: null,
  target: 21,
  rounds: [round],
  current: { a: Array(4).fill('unthrown'), b: Array(4).fill('unthrown') },
  nextFirst: 'a',
  startSide: 'left',
  winner: null,
};
const broken = (patch) => ({ ...structuredClone(good), ...patch });

// One per family of crash the probe found, rather than all 18: the same guard
// catches every member, and `scoring.test.js` is where the corpus lives.
const UNPLAYABLE = [
  ['rounds is not an array', broken({ rounds: { 0: round } })],
  ['a round is null', broken({ rounds: [round, null] })],
  ['a round is short of bags', broken({ rounds: [{ ...round, a: ['hole'] }] })],
  ['current is not bags', broken({ current: 'nope' })],
  ['winner names no team', broken({ winner: 'c' })],
  ['nextFirst names no team', broken({ nextFirst: 'z' })],
  ['a player slot holds an object', broken({ players: { a: [{}, 'Tau'], b: ['Sigma', 'Phi'] } })],
  ['colors is null', broken({ colors: null })],
];

const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome' });

const open = async (value) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
  await page.addInitScript(
    ([key, raw]) => localStorage.setItem(key, raw),
    [KEY, typeof value === 'string' ? value : JSON.stringify(value)],
  );
  await page.goto(URL);
  // Bounded and swallowed: a blank page never grows `.app`, and an unbounded wait
  // would end the run in a stack trace instead of naming which shape did it.
  const drew = await page
    .waitForSelector('.app', { timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  return { context, page, errors, drew };
};

console.log('a game the app cannot play falls back to a fresh one');
for (const [label, value] of UNPLAYABLE) {
  const { context, page, errors, drew } = await open(value);
  // Setup, and a *startable* one: falling back to something that renders but whose
  // `Start` is disabled would be a different kind of stuck.
  const startable =
    drew &&
    (await page.locator('.setup').count()) === 1 &&
    (await page.getByRole('button', { name: 'Start', exact: true }).isEnabled());
  check(label, startable && errors.length === 0, drew ? (errors[0] ?? '') : 'blank page');
  await context.close();
}

console.log('\nand a save it can play is still played, not thrown away');
{
  const { context, page, drew } = await open(good);
  check('it opens on the play screen', drew && (await page.locator('.setup').count()) === 0);
  check(
    'with the round that was saved',
    (await page.locator('.logged').innerText()).replace(/\s/g, '') === '3–0',
    (await page.locator('.logged').innerText()).replace(/\s/g, ''),
  );
  await context.close();
}

// The merge over `newGame()` defaults is what lets a save made before a field
// existed keep loading, and a validator asked *before* the merge would refuse
// every one of them. Asked after, absent is never the question.
console.log('\nand a save from before a field existed still loads');
{
  const old = structuredClone(good);
  for (const key of ['id', 'startSide', 'casual', 'tournament']) delete old[key];
  delete old.rounds[0].first;
  const { context, page, drew } = await open(old);
  check(
    'four fields younger than the save',
    drew &&
      (await page.locator('.setup').count()) === 0 &&
      (await page.locator('.logged').innerText()).replace(/\s/g, '') === '3–0',
  );
  check(
    'and it is given an id, so it can be archived',
    await page.evaluate((k) => typeof JSON.parse(localStorage.getItem(k)).id === 'string', KEY),
  );
  await context.close();
}

await browser.close();
if (failures) {
  console.error(`\n${failures} recovery check(s) failed`);
  process.exit(1);
}
console.log('\nrecovery checks passed');
