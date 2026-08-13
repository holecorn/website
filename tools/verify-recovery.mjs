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

// The two headline figures are the committed score; the in-round net is `.pending`.
const logged = (page) => page.locator('.scoreboard .score').allInnerTexts().then((s) => s.join('–'));

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

// Enough of a game to be won, so loading it is enough to make the app write to all
// three history keys without a single tap.
const won = {
  ...structuredClone(good),
  id: 'a-won-game',
  rounds: Array.from({ length: 7 }, () => round),
  winner: 'a',
};

const MATCHES = 'holecorn.matches.v1';
// One envelope apiece, the shape a later version would plausibly write — the export
// file already carries one — plus an array where the marks expect an object.
const UNREADABLE = {
  [MATCHES]: JSON.stringify({ format: 2, matches: [{ id: 'kept' }] }),
  'holecorn.tournaments.v1': JSON.stringify({ format: 2, tournaments: [{ id: 'kept' }] }),
  'holecorn.inactive.v1': JSON.stringify([{ name: 'omicron', at: 900 }]),
};

const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome' });

const open = async (value, alongside = {}) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
  await page.addInitScript(
    (seed) => {
      for (const [key, raw] of Object.entries(seed)) localStorage.setItem(key, raw);
    },
    { ...alongside, [KEY]: typeof value === 'string' ? value : JSON.stringify(value) },
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
    (await logged(page)) === '3–0',
    await logged(page),
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
      (await logged(page)) === '3–0',
  );
  check(
    'and it is given an id, so it can be archived',
    await page.evaluate((k) => typeof JSON.parse(localStorage.getItem(k)).id === 'string', KEY),
  );
  await context.close();
}

// The third way `loadGame` can be over-eager, and the one that actually shipped.
// `migrateDefaults` rewrote any slot whose name matched the pre-2026-07-30 default for
// that *slot index* — `Player 1` at 0, `Player 2` at 1 — on every load rather than once,
// so it could not tell a save from before the defaults moved from a name typed this
// morning. Measured: typing the obvious doubles lineup below and reloading gave
// `a: [Player 1, Player 3], b: [Player 3, Player 4]`, and `lineupFaults` then refused the
// lineup as having Player 3 twice — the app rewriting a name and blaming you for it.
// The migration is gone; this is what stops one coming back.
console.log('\nand the lineup you typed is the lineup you get back');
{
  const typed = {
    ...structuredClone(good),
    id: 'as-typed',
    mode: 'doubles',
    rounds: [],
    players: { a: ['Player 1', 'Player 2'], b: ['Player 3', 'Player 4'] },
  };
  const { context, page, drew } = await open(typed);
  const names = drew
    ? await page.locator('.team-name-input').evaluateAll((els) => els.map((e) => e.value))
    : [];
  const wanted = [...typed.players.a, ...typed.players.b];
  check('all four names survive the reload', names.join() === wanted.join(), names.join(', '));
  // The rewrite's whole cost was here: it produced a lineup the app then refused, so a
  // names assertion alone would not say what it cost you.
  check(
    'and the lineup it made is one Start will take',
    drew && (await page.getByRole('button', { name: 'Start', exact: true }).isEnabled()),
  );
  await context.close();
}

// The other half of the same question, one key over: what the app does with *history*
// it cannot read. Measured before the fix, seeding the archive with a plausible newer
// envelope and doing nothing but winning one game took 296,012 characters holding 300
// matches down to 990 holding 1 — and reading was never what did it, so the damage
// only lands on the first write after a bad read. Here rather than in a tenth check
// because it is the same failure as the block above with a different key: storage the
// bundle cannot understand must cost nothing.
console.log('\nand history it cannot read is left exactly as it found it');
{
  const { context, page, drew } = await open(won, UNREADABLE);
  const after = await page.evaluate(
    (keys) => Object.fromEntries(keys.map((k) => [k, localStorage.getItem(k)])),
    Object.keys(UNREADABLE),
  );
  for (const [key, raw] of Object.entries(UNREADABLE)) {
    check(key.replace('holecorn.', ''), after[key] === raw, `${after[key]?.length ?? 0} chars`);
  }
  // Said, not merely survived. Refusing silently is how the phone that has stopped
  // recording looks identical to the one that is.
  check(
    'and the footer says nothing new will survive',
    drew && (await page.locator('.save-warning').innerText()).includes('won’t save'),
  );
  await context.close();
}

// Two-sided, the same reason the block above the last one is: a guard that refuses
// every write passes all four assertions above while quietly recording nothing ever
// again, and widening the refusal is the tempting way to make a future failure green.
console.log('\nand history it can read is still written to');
{
  const { context, page } = await open(won, { [MATCHES]: '[]' });
  await page.waitForSelector('.winner-banner', { timeout: 15_000 }).catch(() => {});
  const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), MATCHES);
  check('the won game is archived', Array.isArray(stored) && stored.length === 1);
  await context.close();
}

// A refusal has to be *actionable*, and the advice differs by which one it was. The
// full-archive wording sends you to export and delete, and here there is nothing on
// screen to do either to — the tables are empty because the history is unreadable, so
// that export would be saved as a backup of nothing. `refusal()` in `Stats.jsx` is the
// only thing choosing between the two and nothing below it can see the choice.
console.log('\nand it says which refusal it was');
{
  const fresh = { ...structuredClone(good), id: 'not-started', rounds: [] };
  const { context, page } = await open(fresh, UNREADABLE);
  await page.getByRole('button', { name: 'Stats' }).click();
  await page.locator('.file-button input').setInputFiles({
    name: 'holecorn-matches.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 1, matches: [], tournaments: [], inactive: {} })),
  });
  const notice = await page.locator('.durability-notice').first().innerText();
  check('the import notice names the cause', notice.includes('newer version'), notice);
  check('rather than sending you to export and delete', !notice.includes('no room'), notice);
  await context.close();
}

await browser.close();
if (failures) {
  console.error(`\n${failures} recovery check(s) failed`);
  process.exit(1);
}
console.log('\nrecovery checks passed');
