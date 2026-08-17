// The tournament, driven through the built app.
//
// `tournament.js` is pure and unit tested, so this covers only what those tests are
// blind to by construction: that App.jsx wires the bracket to the live game. The one
// this exists for is **reversibility** — undoing a winning round un-archives the tie
// and the bracket recomputes with nothing to un-advance. That is the whole reason the
// bracket derives its progress instead of storing it, and every piece of it is
// individually correct while the wiring between them can still be wrong.
//
// Greek names throughout: this is a public repo and the family must not be in it.

import { chromium } from 'playwright';

const URL = 'http://localhost:4173/';
const PHONE = { width: 393, height: 852 };
const ELEVEN = [
  'Rho',
  'Tau',
  'Sigma',
  'Phi',
  'Chi',
  'Psi',
  'Omega',
  'Iota',
  'Kappa',
  'Zeta',
  'Beta',
];

let failures = 0;
const check = (label, cond, detail = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
};

const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome' });

// Waits that are really assertions have to report rather than throw. A timeout that
// ends the run names nothing and takes every block below it with it — verified by
// mutation, where a dead `Play something else` button killed the run at the third of seven
// blocks. Same lesson as verify-positions.mjs and verify-stats.mjs.
const settles = (fn) => fn().then(() => true, () => false);

// The same rule for *reading* text: a fault hint is absent whenever nothing is at fault,
// which is the ordinary case, and an unbounded read waits out Playwright's 30s default for
// it. `check` evaluates its condition and its detail separately, so a single assertion on
// an absent hint paid it twice — measured, one pair was 60s of this file's 110s. Absence
// here is an answer rather than something to wait for; 2s is 20x the ~50ms a hint takes to
// render, and a bound too short to see a hint that *is* there fails the presence
// assertions above loudly rather than passing this one quietly.
const textOf = (locator, absent = '(no hint)') =>
  locator.innerText({ timeout: 2000 }).catch(() => absent);

// Every draw lands on the ceremony now — `Make the draw` always plays it out, and Skip is
// one press. A check that wants a bracket goes through it, and reports rather than
// throwing for the reason above: a ceremony that stopped appearing would otherwise end the
// run at whichever block drew first and name nothing.
async function skipCeremony(page) {
  if (!(await settles(() => page.waitForSelector('.ceremony', { timeout: 5000 })))) {
    check('the draw lands on the ceremony', false);
    return;
  }
  await page.getByRole('button', { name: 'Skip' }).click();
}

async function open(names = ELEVEN, mode = 'Singles') {
  const page = await browser.newPage({ viewport: PHONE });
  page.on('pageerror', (e) => {
    console.log('  PAGE ERROR', e.message);
    failures++;
  });
  await page.goto(URL);
  await page.waitForSelector('.setup');
  await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
  await page.getByRole('button', { name: 'New tournament' }).click();
  await page.locator('.draw-name input').fill('Hole Corn VI');
  if (mode !== 'Singles') await page.locator('.draw .mode-toggle').getByText(mode).click();
  const fields = mode === 'Singles' ? 1 : 2;
  for (let i = 0; i < names.length / fields; i += 1) {
    await page.getByRole('button', { name: 'Add new entrant' }).click();
  }
  for (const [i, n] of names.entries()) await page.locator('.entrant-name').nth(i).fill(n);
  // Reported rather than thrown, the rule the waits below already follow. Almost every
  // block starts here, so a mutation that leaves the form unsubmittable — a fault gate
  // stuck shut, an extra blank row the field never fills — otherwise ends the whole run
  // on the first block and names nothing.
  if (!(await settles(() => page.locator('.draw-go').click({ timeout: 5000 })))) {
    check('the form the checks are built on can be drawn', false, 'Make the draw stayed off');
    return page;
  }
  await skipCeremony(page);
  // The one just drawn opens itself, so the bracket is on screen without a tap.
  if (!(await settles(() => page.waitForSelector('.bracket-scroll', { timeout: 5000 })))) {
    check('and lands on its bracket', false);
  }
  return page;
}

const game = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('holecorn.game.v3') || 'null'));
const archive = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('holecorn.matches.v1') || '[]'));
const progress = (page) => page.locator('.tournament-progress').innerText();
// A playable tie's box *is* its button, so counting the buttons counts the playable ties —
// and there is exactly one box per tie now that the duplicate "Ready to play" list is gone.
const playable = (page) => page.locator('button.tie').count();
// Playing one means tapping the box. `.tie-play` is only the corner marker inside it.
const playFirst = (page) => page.locator('button.tie').first().click();

// Score the loaded tie to a win for whoever is team A: two rounds of four in the hole.
async function winIt(page) {
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  for (let r = 0; r < 2; r += 1) {
    const lanes = await page.locator('.lane').all();
    for (let i = 0; i < 4; i += 1) await lanes[i].locator('.tier-hole').click();
    for (let i = 4; i < 8; i += 1) await lanes[i].locator('.tier-floor').click();
    await page.locator('.end-round').click();
    await page.waitForFunction(() => document.querySelectorAll('.lane input:checked').length === 0, null, {
      timeout: 5000,
    });
  }
}

// Nothing is open on arrival, so a check that wants to look at a bracket has to open one —
// which is what a person does too.
const backToBracket = async (page) => {
  await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
  await page.waitForSelector('.tournament-list');
  await page.locator('.tournament-row').first().click();
  await page.waitForSelector('.bracket-scroll');
};

console.log('an empty draw form does not tell you off before you have typed');
{
  // `entrantFaults` is pure and unit tested, and it reports an empty row from the moment
  // one exists — correctly, since it is not a person. What only a browser can see is
  // whether the screen *says* so before anybody has typed, which is the one moment you
  // are least in the wrong: you got here by pressing New.
  //
  // **First in the file on purpose**, the way verify-stats.mjs orders its absence
  // assertions. Everything below builds a bracket through `open()`, so a mutation that
  // puts blank rows back on arrival leaves that helper's field short and every later block
  // reading a screen that never arrived — reported now rather than thrown, but still a
  // wall of noise the actual fault is buried in. Run first, it names itself.
  const page = await browser.newPage({ viewport: PHONE });
  page.on('pageerror', (e) => {
    console.log('  PAGE ERROR', e.message);
    failures++;
  });
  await page.goto(URL);
  await page.waitForSelector('.setup');
  await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
  await page.getByRole('button', { name: 'New tournament' }).click();
  if (!(await settles(() => page.waitForSelector('.draw', { timeout: 5000 })))) {
    check('the draw form opens', false);
  } else {
    // The roster is how somebody the app knows gets in, so the form opens on it rather
    // than on boxes most draws never type into.
    check(
      'the form opens with no name boxes at all',
      (await page.locator('.entrant-name').count()) === 0,
      `${await page.locator('.entrant-name').count()} fields`,
    );
    check('nothing is reported on arrival', (await page.locator('.draw-hint').count()) === 0);
    check(
      'and the note says nothing about a field nobody has started',
      (await page.locator('.draw-note').innerText()).trim() === 'The draw is random and final.',
      (await page.locator('.draw-note').innerText()).trim(),
    );
    // Held off all the same. A disabled button over an empty form explains itself, which
    // is what makes the quiet safe rather than merely quieter.
    check('the draw is refused all the same', await page.locator('.draw-go').isDisabled());

    // Asking for a row is something you did, so the count is said at once — the half of
    // the gate that is about the field's size rather than about its names.
    await page.getByRole('button', { name: 'Add new entrant' }).click();
    const alone = await textOf(page.locator('.draw-hint'));
    check('one row in, the count is reported', /at least 2 entrants/i.test(alone), alone);
    check(
      'but neither empty box is, since nobody has typed',
      !/needs a name/i.test(alone),
      alone,
    );
    check(
      'and nothing is marked',
      (await page.locator('.entrants .is-faulted, .draw-name input[aria-invalid]').count()) === 0,
    );

    // And the moment there is somebody, the row with nobody in it is at fault and says so —
    // the half a gate stuck shut would break. The cup's own name is on the same gate, so it
    // is reported here too, and the two are said together rather than one visit each.
    await page.getByRole('button', { name: 'Add new entrant' }).click();
    await page.locator('.entrant-name').first().fill('Rho');
    // Read so it *reports* when there is no hint at all — `innerText` on a locator that
    // matches nothing throws, which ends the run and names nothing. A gate stuck shut is
    // exactly the mutation that would take it, so this is the file's own lesson again.
    const hint = await textOf(page.locator('.draw-hint'));
    check('one name in, the empty row is reported', /Everyone entering needs a name/i.test(hint), hint);
    check('and so is the unnamed cup', /tournament needs a name/i.test(hint), hint);
    check(
      'both boxes at fault are marked, and only those',
      (await page.locator('.entrants .is-faulted').count()) === 1 &&
        (await page.locator('.draw-name input[aria-invalid]').count()) === 1,
      `${await page.locator('.entrants .is-faulted').count()} rows, ${await page
        .locator('.draw-name input[aria-invalid]')
        .count()} name fields`,
    );

    // Naming it clears its own line and leaves the other, so the two are separate rules
    // rather than one message covering whatever is wrong.
    await page.locator('.draw-name input').fill('Hole Corn VI');
    const named = await textOf(page.locator('.draw-hint'));
    check('naming it drops that line', !/tournament needs a name/i.test(named), named);
    check('and leaves the empty row reported', /Everyone entering needs a name/i.test(named), named);
    check(
      'and unmarks the field',
      (await page.locator('.draw-name input[aria-invalid]').count()) === 0,
    );
    check('the draw is still refused', await page.locator('.draw-go').isDisabled());

    // Derived rather than remembered, so an emptied form is quiet again. Asserted because
    // it is the known difference from a `touched` flag rather than an accident.
    await page.locator('.entrant-name').first().fill('');
    check('clearing it goes quiet again', (await page.locator('.draw-hint').count()) === 0);
    // Held off all the same, which is what makes the quiet safe: the two rows are blank
    // whatever the screen has stopped saying about them.
    check('with the draw still refused', await page.locator('.draw-go').isDisabled());
  }
  await page.close();
}

console.log('\nthe draw builds the bracket the paper sheet has');
{
  const page = await open();
  check(
    'four rounds, deepest first',
    JSON.stringify(await page.locator('.bracket-head').allInnerTexts()) ===
      '["Preliminary","Quarter-final","Semi-final","Final"]',
    (await page.locator('.bracket-head').allInnerTexts()).join(', '),
  );
  const perLevel = await page.locator('.bracket .tie[data-level]').evaluateAll((els) => {
    const n = {};
    for (const e of els) n[e.dataset.level] = (n[e.dataset.level] ?? 0) + 1;
    return [4, 3, 2, 1].map((l) => n[l] ?? 0);
  });
  check('three preliminaries, then 4, 2, 1', JSON.stringify(perLevel) === '[3,4,2,1]', `${perLevel}`);
  // Five, not three: the two ties drawn between byes need nobody first, so they are
  // playable from the start despite sitting a level above the preliminaries. Counted
  // by the Play buttons, which live only in the ready list — the drawing is read-only,
  // so a playable tie appears in both and `.is-playable` would count it twice.
  check(
    'five ties are playable at once, not one',
    (await playable(page)) === 5,
    `${await playable(page)}`,
  );
  check('and nothing is played yet', (await progress(page)).trim() === '0 of 10 ties');
  // Every entrant appears in the deepest column exactly once, which is what a name lost
  // or duplicated by the draw would break. Byes get a box of their own there, so the
  // column holds the whole field.
  const seated = await page
    .locator('.bracket .tie[data-level="4"] .tie-who, .bracket .tie.is-seat .tie-who')
    .allInnerTexts();
  check(
    'every entrant is seated exactly once',
    JSON.stringify([...seated].sort()) === JSON.stringify([...ELEVEN].sort()),
    `${seated.length} seated`,
  );
  await page.close();
}

console.log('\nthe draw offers archived names, less the ones already entered');
{
  // Prevention rather than correction: `entrantFaults` refuses a repeat, but being
  // refused after typing it is worse than never being offered it. The archive is seeded
  // straight into storage rather than played, because what is under test is the list.
  const page = await browser.newPage({ viewport: PHONE });
  page.on('pageerror', (e) => {
    console.log('  PAGE ERROR', e.message);
    failures++;
  });
  await page.goto(URL);
  await page.waitForSelector('.setup');
  await page.evaluate(() => {
    const rec = (id, a, b) => ({
      id,
      mode: 'singles',
      players: { a: [a, ''], b: [b, ''] },
      winner: 'a',
      final: { a: 21, b: 9 },
      rounds: [],
      endedAt: 1000,
    });
    localStorage.setItem(
      'holecorn.matches.v1',
      JSON.stringify([rec('m1', 'Rho', 'Tau'), rec('m2', 'Sigma', 'Phi')]),
    );
  });
  await page.reload();
  await page.waitForSelector('.setup');
  await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
  await page.getByRole('button', { name: 'New tournament' }).click();
  for (let i = 0; i < 2; i += 1) {
    await page.getByRole('button', { name: 'Add new entrant' }).click();
  }
  const offered = () =>
    page.locator('#tournament-names option').evaluateAll((o) => o.map((e) => e.value).sort());
  check(
    'it offers everyone the archive knows',
    JSON.stringify(await offered()) === '["Phi","Rho","Sigma","Tau"]',
    JSON.stringify(await offered()),
  );
  await page.locator('.entrant-name').nth(0).fill('Rho');
  check(
    'and drops a name once it is entered',
    JSON.stringify(await offered()) === '["Phi","Sigma","Tau"]',
    JSON.stringify(await offered()),
  );
  // Folded by `nameKey`, so a different spelling of the same person goes with it.
  await page.locator('.entrant-name').nth(1).fill('  sigma ');
  check(
    'however it was spelled',
    JSON.stringify(await offered()) === '["Phi","Tau"]',
    JSON.stringify(await offered()),
  );
  // It has to come back while the field is being retyped, or a name cannot be corrected
  // once it has been picked.
  await page.locator('.entrant-name').nth(0).fill('Rh');
  check(
    'and comes back while that field is being retyped',
    (await offered()).includes('Rho'),
    JSON.stringify(await offered()),
  );
  await page.close();
}

console.log('\nname fields refuse the browser\'s own contact autofill');
{
  // On macOS both Safari and Chrome guess a name field from its label and offer the
  // machine's address book on top of the app's own suggestions — two popups fighting, and
  // the useless one wins. Asserted over *every* name field on the screen rather than a
  // list of selectors, so one added later without `NAME_FIELD` fails here.
  //
  // Whether the contact card actually stops appearing cannot be checked: it is native
  // browser UI, the same reason tools/README.md records that the datalist popup cannot be
  // captured under automation. What is checkable is the attribute — and that `list` still
  // binds, because autofill and `<datalist>` are separate mechanisms and the risk is
  // somebody removing the attribute believing it disabled our own completions.
  const page = await browser.newPage({ viewport: PHONE });
  page.on('pageerror', (e) => {
    console.log('  PAGE ERROR', e.message);
    failures++;
  });
  await page.goto(URL);
  await page.waitForSelector('.setup');
  await page.evaluate((names) => {
    localStorage.setItem(
      'holecorn.matches.v1',
      JSON.stringify(
        names.map((n, i) => ({
          id: `n${i}`,
          mode: 'singles',
          players: { a: [n, ''], b: [names[(i + 1) % names.length], ''] },
          winner: 'a',
          final: { a: 21, b: 9 },
          rounds: [],
          endedAt: 1000 + i,
        })),
      ),
    );
  }, ELEVEN);
  await page.reload();
  await page.waitForSelector('.setup');

  const nameFields = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('input')]
        .filter((e) => !e.type || e.type === 'text')
        // Placeholder as well as `aria-label`, because the tournament's own name field has
        // neither an `aria-label` nor a `list` and so escaped this entirely — the one field
        // on the screen whose visible label is the bare word Safari's heuristic reads.
        .filter(
          (e) =>
            /name|entrant/i.test(
              `${e.getAttribute('aria-label') || ''} ${e.getAttribute('placeholder') || ''}`,
            ) || e.list,
        )
        .map((e) => ({
          label: (e.getAttribute('aria-label') || e.placeholder || e.className).slice(0, 40),
          off: e.getAttribute('autocomplete') === 'off',
          options: e.list ? e.list.options.length : -1,
        })),
    );

  for (const [where, open] of [
    ['the setup lineup', async () => {}],
    [
      'the tournament draw',
      async () => {
        await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
        await page.getByRole('button', { name: 'New tournament' }).click();
        // The form opens on the roster with no boxes, so one has to be asked for before
        // there is a name field on this screen to check at all.
        await page.getByRole('button', { name: 'Add new entrant' }).click();
      },
    ],
  ]) {
    await open();
    const fields = await nameFields();
    const bad = fields.filter((f) => !f.off).map((f) => f.label);
    check(
      `every name field on ${where} refuses it`,
      fields.length > 0 && bad.length === 0,
      bad.length ? bad.join(', ') : `${fields.length} field(s)`,
    );
    const listed = fields.filter((f) => f.options >= 0);
    check(
      `and the archive list still completes ${where}`,
      listed.length > 0 && listed.every((f) => f.options > 0),
      `${listed.length} with a datalist, options ${listed.map((f) => f.options).join('/')}`,
    );
  }
  await page.close();
}

// An empty draw form with the eleven already in the archive, which is what the roster
// draws its chips from.
async function rosterForm() {
  const page = await browser.newPage({ viewport: PHONE });
  page.on('pageerror', (e) => {
    console.log('  PAGE ERROR', e.message);
    failures++;
  });
  await page.goto(URL);
  await page.waitForSelector('.setup');
  await page.evaluate((names) => {
    const recs = names.map((n, i) => ({
      id: `m${i}`,
      mode: 'singles',
      players: { a: [n, ''], b: [names[(i + 1) % names.length], ''] },
      winner: 'a',
      final: { a: 21, b: 9 },
      rounds: [],
      endedAt: 1000 + i,
    }));
    localStorage.setItem('holecorn.matches.v1', JSON.stringify(recs));
  }, ELEVEN);
  await page.reload();
  await page.waitForSelector('.setup');
  await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
  await page.getByRole('button', { name: 'New tournament' }).click();
  return page;
}

const entered = (page) =>
  page.locator('.entrant-name').evaluateAll((e) => e.map((x) => x.value));

console.log('\nthe roster enters people by tapping rather than typing');
{
  // Typing eleven names the app already holds is the real cost of setting a tournament
  // up. The chips are a toggle, so they double as the answer to who is in so far.
  const page = await rosterForm();

  const rows = () => entered(page);
  check('a chip per archived name', (await page.locator('.roster-chip').count()) === 11);
  check('none lit to begin with', (await page.locator('.roster-chip.is-on').count()) === 0);

  for (const name of ELEVEN) await page.getByRole('button', { name, exact: true }).click();
  check(
    'tapping them all enters the field in tap order',
    JSON.stringify(await rows()) === JSON.stringify(ELEVEN),
    JSON.stringify(await rows()),
  );
  check('every chip is lit', (await page.locator('.roster-chip.is-on').count()) === 11);
  // The field costs no typing; the cup's own name still does, and it is the only thing
  // between eleven taps and a bracket.
  const unnamed = await textOf(page.locator('.draw-hint'));
  check(
    'the whole field is in without a keystroke, and only the cup is unnamed',
    (await page.locator('.draw-go').isDisabled()) &&
      /needs a name/i.test(unnamed) &&
      (await page.locator('.entrants .is-faulted').count()) === 0,
    unnamed,
  );
  await page.locator('.draw-name input').fill('Hole Corn VI');
  check('naming it is all that was left', await page.locator('.draw-go').isEnabled());

  // A second tap takes them out again, and the entrant goes with them rather than
  // leaving a blank the draw would refuse.
  await page.getByRole('button', { name: 'Sigma', exact: true }).click();
  const without = await rows();
  check('a second tap removes them', !without.includes('Sigma'), JSON.stringify(without));
  check('taking the entrant with them', without.length === 10, `${without.length} rows`);
  check(
    'and unlighting the chip',
    (await page.locator('.roster-chip.is-on').count()) === 10,
  );
  check('the draw is still ready', await page.locator('.draw-go').isEnabled());

  await page.close();
}

console.log('\nSelect all enters the whole roster in one press');
{
  // Everybody usually plays, so the ordinary field is the roster and the chips are then
  // eleven taps to say so. `place` is shared with the chips, and the property that has to
  // hold is that one press seats the field exactly as tapping down the roster would —
  // nothing below `Draw` can see that, since both callers are inside it.
  const page = await rosterForm();
  const chips = await page.locator('.roster-chip').allInnerTexts();
  const all = page.getByRole('button', { name: 'Select all' });

  await all.click();
  check(
    'one press enters everybody, in chip order',
    JSON.stringify(await entered(page)) === JSON.stringify(chips),
    JSON.stringify(await entered(page)),
  );
  check('every chip is lit', (await page.locator('.roster-chip.is-on').count()) === 11);
  // One press for the field; the cup's own name is the only keystroke left.
  await page.locator('.draw-name input').fill('Hole Corn VI');
  check('and the draw is ready', await page.locator('.draw-go').isEnabled());
  // Not flipped to a clear, so it has to say for itself that there is nobody left.
  check('with nobody left to add, the button goes quiet', await all.isDisabled());

  // It adds who is missing rather than starting again, which is the half that would
  // destroy a name typed into the fields for somebody the archive has never seen.
  await page.getByRole('button', { name: 'Sigma', exact: true }).click();
  check('taking one out offers the button again', await all.isEnabled());
  await page.getByRole('button', { name: 'Add new entrant' }).click();
  await page.locator('.entrant-name').last().fill('Delta');
  await all.click();
  const after = await entered(page);
  check(
    'a newcomer typed in is kept',
    after.filter((n) => n === 'Delta').length === 1,
    JSON.stringify(after),
  );
  check(
    'and nobody already in is entered twice',
    after.length === 12 && new Set(after).size === 12,
    `${after.length} rows, ${new Set(after).size} distinct`,
  );

  await page.close();
}

console.log('\nin doubles a tap fills the next half of a pair');
{
  // One rule for both modes: the first empty *playing* slot. In singles that is always a
  // new entrant, in doubles it is the partner of the last one — so two taps make one
  // side, which is what a doubles entry is.
  const page = await browser.newPage({ viewport: PHONE });
  page.on('pageerror', (e) => {
    console.log('  PAGE ERROR', e.message);
    failures++;
  });
  await page.goto(URL);
  await page.waitForSelector('.setup');
  await page.evaluate((names) => {
    const recs = names.map((n, i) => ({
      id: `d${i}`,
      mode: 'singles',
      players: { a: [n, ''], b: [names[(i + 1) % names.length], ''] },
      winner: 'a',
      final: { a: 21, b: 9 },
      rounds: [],
      endedAt: 1000 + i,
    }));
    localStorage.setItem('holecorn.matches.v1', JSON.stringify(recs));
  }, ['Rho', 'Tau', 'Sigma', 'Phi']);
  await page.reload();
  await page.waitForSelector('.setup');
  await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
  await page.getByRole('button', { name: 'New tournament' }).click();
  await page.locator('.draw .mode-toggle').getByText('Doubles').click();

  const pairs = () =>
    page.locator('.entrants li').evaluateAll((els) =>
      els.map((li) => [...li.querySelectorAll('.entrant-name')].map((i) => i.value)),
    );
  for (const name of ['Rho', 'Tau', 'Sigma', 'Phi']) {
    await page.getByRole('button', { name, exact: true }).click();
  }
  check(
    'four taps make two pairs, not four entrants',
    JSON.stringify(await pairs()) === '[["Rho","Tau"],["Sigma","Phi"]]',
    JSON.stringify(await pairs()),
  );
  check(
    'which is a bracket of one tie, said in the singular',
    (await page.locator('.draw-note').innerText()).includes('2 entrants, so 1 tie.'),
    (await page.locator('.draw-note').innerText()).trim(),
  );
  // Removing half a pair leaves the partner with a gap rather than dropping them both.
  await page.getByRole('button', { name: 'Rho', exact: true }).click();
  check(
    'untapping one leaves their partner behind',
    JSON.stringify(await pairs()) === '[["","Tau"],["Sigma","Phi"]]',
    JSON.stringify(await pairs()),
  );
  check(
    'and the draw waits for the gap to be filled',
    await page.locator('.draw-go').isDisabled(),
  );
  await page.close();
}

console.log('\nShuffle pairs re-partners a doubles field');
{
  // The draw randomises which pairs *meet* and never who is paired with whom — `place`
  // fills the next empty half, so a field entered by tapping is partnered in roster
  // order, which is alphabetical. Nothing below `Draw` can see this: `shufflePairs` is
  // pure and the button, its mode gate and its disabled rule all live in the form.
  //
  // `Math.random` is seeded so the run is reproducible, the same reason `shuffled` takes
  // its randomness as an argument. The assertions are still properties rather than one
  // fixed arrangement, so they do not pin the generator.
  const page = await browser.newPage({ viewport: PHONE });
  page.on('pageerror', (e) => {
    console.log('  PAGE ERROR', e.message);
    failures++;
  });
  await page.addInitScript(() => {
    let s = 42;
    Math.random = () => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s / 2147483648;
    };
  });
  await page.goto(URL);
  await page.waitForSelector('.setup');
  await page.evaluate((names) => {
    const recs = names.map((n, i) => ({
      id: `s${i}`,
      mode: 'singles',
      players: { a: [n, ''], b: [names[(i + 1) % names.length], ''] },
      winner: 'a',
      final: { a: 21, b: 9 },
      rounds: [],
      endedAt: 1000 + i,
    }));
    localStorage.setItem('holecorn.matches.v1', JSON.stringify(recs));
  }, ELEVEN.slice(0, 8));
  await page.reload();
  await page.waitForSelector('.setup');
  await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
  await page.getByRole('button', { name: 'New tournament' }).click();

  const shuffle = page.getByRole('button', { name: 'Shuffle pairs' });
  const pairs = () =>
    page.locator('.entrants li').evaluateAll((els) =>
      els.map((li) => [...li.querySelectorAll('.entrant-name')].map((i) => i.value)),
    );
  // A side is one person in singles, so there is nothing to pair and the button is not
  // there at all — the absent handler is the gate, the rule the court diagram follows.
  check('it is not offered in singles', (await shuffle.count()) === 0);
  await page.locator('.draw .mode-toggle').getByText('Doubles').click();
  check('doubles offers it', (await shuffle.count()) === 1);
  // Quiet rather than gone below two entrants, the answer `Select all` gives an empty
  // form: one pair is one side, and a side reads as a set, so there is nothing a shuffle
  // of it could change.
  check('and it is quiet with nobody in', await shuffle.isDisabled());

  const chips = await page.locator('.roster-chip').allInnerTexts();
  await page.getByRole('button', { name: 'Select all' }).click();
  const before = await pairs();
  check(
    'a full field pairs in roster order, which is what there is to shuffle',
    JSON.stringify(before.flat()) === JSON.stringify(chips),
    JSON.stringify(before),
  );
  check('with a field in, it is offered', await shuffle.isEnabled());

  await shuffle.click();
  const after = await pairs();
  const set = (rows) => JSON.stringify(rows.map((r) => [...r].sort()).sort());
  check(
    'one press re-partners them',
    set(after) !== set(before),
    `${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
  );
  check(
    'without losing anybody or changing the size of the field',
    after.length === before.length &&
      JSON.stringify(after.flat().sort()) === JSON.stringify(before.flat().sort()),
    JSON.stringify(after),
  );
  check(
    'so the draw is still ready but for the name',
    (await page.locator('.entrants .is-faulted').count()) === 0,
  );

  // A gap is a value in the pool like any other, so it travels — which is the half that
  // makes a half-empty pair fixable by shuffling rather than only by retyping.
  // A gap is a value in the pool like any other, so it travels — which is the half that
  // makes a half-empty pair fixable by shuffling rather than only by retyping.
  //
  // **Where it lands over several presses, not merely that it moved once.** Dropping the
  // blanks from the pool and dealing the names back deals a short list, which leaves the
  // gap at the end of the field *every* time — so "it is not where it started" passes on
  // a shuffle that pins it, which is this file's standing failure mode.
  await page.getByRole('button', { name: ELEVEN[0], exact: true }).click();
  const rowOfGap = async () => (await pairs()).findIndex((r) => r.some((v) => v === ''));
  const landed = new Set();
  let intact = true;
  for (let i = 0; i < 8; i += 1) {
    await shuffle.click();
    landed.add(await rowOfGap());
    const rows = await pairs();
    intact &&= rows.length === 4 && rows.flat().filter((v) => v === '').length === 1;
  }
  check(
    'the blank space shuffles like any other, rather than settling at one end',
    landed.size > 1,
    `landed in row(s) ${[...landed].join(', ')}`,
  );
  check('and there is still exactly one of it, in a field of four', intact);
  await page.close();
}

console.log('\nthe header holds New tournament, on one line at every width');
{
  // Drawing one is the reason for coming to this screen, so the button is in the header
  // rather than under the lists, where it sat behind every bracket and champion. That makes
  // this the third thing in a row that must not wrap — the `.setup-top` situation — so it is
  // measured the same way: one line *and* nothing squeezed, because a row that silently
  // shrinks passes an overflow check while being useless.
  //
  // 320px is left out deliberately: `.setup-top` has never fitted there either, and
  // CLAUDE.md records that as not a regression.
  const page = await browser.newPage({ viewport: PHONE });
  page.on('pageerror', (e) => {
    console.log('  PAGE ERROR', e.message);
    failures++;
  });
  await page.goto(URL);
  await page.waitForSelector('.setup');
  await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
  await page.waitForSelector('.tournament-screen');

  for (const width of [430, 393, 375, 360]) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForTimeout(150);
    const row = await page.evaluate(() => {
      const head = document.querySelector('.stats-head');
      const kids = [...head.children];
      const gap = parseFloat(getComputedStyle(head).columnGap) || 0;
      const needed =
        kids.reduce((n, e) => n + e.getBoundingClientRect().width, 0) + (kids.length - 1) * gap;
      return {
        needed: Math.round(needed),
        avail: Math.round(head.clientWidth),
        squeezed: kids.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.className),
        overflow: Math.round(
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      };
    });
    check(
      `the header fits on one line at ${width}px`,
      row.needed <= row.avail && row.overflow === 0,
      `needs ${row.needed}px of ${row.avail}px, page overflow ${row.overflow}px`,
    );
    check(
      `and nothing in it is squeezed at ${width}px`,
      row.squeezed.length === 0,
      row.squeezed.join(' '),
    );
  }
  // Hidden while the draw form is open, where Cancel is the way out — two ways to start a
  // draw from the same screen would be one too many.
  await page.getByRole('button', { name: 'New tournament' }).click();
  await page.waitForSelector('.draw');
  check(
    'and it goes while the draw form is open',
    (await page.locator('.stats-head .tournament-new').count()) === 0,
  );
  await page.close();
}

console.log('\nthe bracket is drawn as columns, one round per column');
{
  // The columns are not laid out — they emerge from every node drawing its children to
  // its left. So the thing to assert is that they *line up*: a level's boxes all share
  // an offset, and the pitch is the same between every pair of columns. Nothing in the
  // components would notice the tree drifting out of column.
  const page = await open();
  const cols = async () =>
    page.locator('.bracket .tie[data-level]').evaluateAll((els) => {
      const s = document.querySelector('.bracket-scroll');
      const base = s.getBoundingClientRect().left - s.scrollLeft;
      const by = {};
      for (const e of els) {
        const x = Math.round(e.getBoundingClientRect().left - base);
        (by[e.dataset.level] ??= new Set()).add(x);
      }
      return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, [...v]]));
    });
  const byLevel = await cols();
  check(
    'every box of a round shares one offset',
    Object.values(byLevel).every((xs) => xs.length === 1),
    JSON.stringify(byLevel),
  );
  const xs = [4, 3, 2, 1].map((l) => byLevel[l][0]);
  const pitches = xs.slice(1).map((x, i) => x - xs[i]);
  check(
    'and the columns are evenly pitched',
    new Set(pitches).size === 1,
    `${xs} -> pitches ${pitches}`,
  );
  await page.close();

  // The headings are a separate row from the boxes, so they can drift out of step with
  // them. Read on a wide viewport, because a phone shows one column and hides the row.
  const wide = await open();
  await wide.setViewportSize({ width: 1180, height: 820 });
  await wide.waitForTimeout(300);
  const aligned = await wide.evaluate(() => {
    const s = document.querySelector('.bracket-scroll');
    const base = s.getBoundingClientRect().left - s.scrollLeft;
    const heads = [...document.querySelectorAll('.bracket-head')].map((e) =>
      Math.round(e.getBoundingClientRect().left - base),
    );
    const boxes = [4, 3, 2, 1].map((l) =>
      Math.round(
        document.querySelector(`.bracket .tie[data-level="${l}"]`).getBoundingClientRect().left -
          base,
      ),
    );
    return { heads, boxes };
  });
  check(
    'each heading sits over its own column',
    JSON.stringify(aligned.heads) === JSON.stringify(aligned.boxes),
    `${aligned.heads} vs ${aligned.boxes}`,
  );
  check(
    'and the whole bracket fits an iPad without scrolling',
    await wide
      .locator('.bracket-scroll')
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
    await wide.locator('.bracket-scroll').evaluate((e) => `${e.scrollWidth} of ${e.clientWidth}`),
  );
  // Where it does not fit, the headings have to go with it. They used to sit outside the
  // scroller and be clipped instead, so scrolling right moved the boxes and left the
  // headings behind — measured at 700px, the last one showed 56px of "Final".
  await wide.setViewportSize({ width: 700, height: 820 });
  await wide.waitForTimeout(300);
  check(
    'and where it does not fit, the headings scroll with it',
    await wide.evaluate(() => {
      const s = document.querySelector('.bracket-scroll');
      const heads = document.querySelector('.bracket-heads');
      return s.scrollWidth > s.clientWidth && heads.getBoundingClientRect().width >= 788;
    }),
    await wide.evaluate(
      () =>
        `heads ${Math.round(document.querySelector('.bracket-heads').getBoundingClientRect().width)}`,
    ),
  );
  await wide.close();
}

console.log('\non a phone one round fills the screen and the arrows step between them');
{
  const page = await open();
  // textContent, not innerText: the heading is uppercased in CSS, so innerText reports
  // PRELIMINARY for a component that wrote Preliminary.
  const at = () => page.locator('.bracket-at').textContent();
  const scrolled = () => page.locator('.bracket-scroll').evaluate((e) => Math.round(e.scrollLeft));
  check('it opens on the deepest round', (await at()).trim() === 'Preliminary', await at());
  check('with nothing scrolled past', (await scrolled()) === 0, `${await scrolled()}`);
  check(
    'and no way back from the first',
    await page.getByRole('button', { name: 'Previous round' }).isDisabled(),
  );
  await page.getByRole('button', { name: 'Next round' }).click();
  await page.waitForTimeout(800);
  check('the next arrow moves a round on', (await at()).trim() === 'Quarter-final', await at());
  check('and scrolls the column into view', (await scrolled()) > 0, `${await scrolled()}`);
  // Two more presses reaches the final, and the arrow stops there.
  for (let i = 0; i < 2; i += 1) {
    await page.getByRole('button', { name: 'Next round' }).click();
    await page.waitForTimeout(500);
  }
  check('the last round is the final', (await at()).trim() === 'Final', await at());
  check(
    'and there is no round after it',
    await page.getByRole('button', { name: 'Next round' }).isDisabled(),
  );

  // A finger has to move the heading as well as an arrow. It shipped tracking only the
  // buttons, so scrolling by hand left the bar naming a round that was off screen.
  const scrollTo = async (x) => {
    await page.locator('.bracket-scroll').evaluate((e, v) => {
      e.scrollLeft = v;
    }, x);
    await page.waitForTimeout(250);
  };
  await scrollTo(0);
  check('scrolling back by hand renames it', (await at()).trim() === 'Preliminary', await at());
  await scrollTo(722);
  check('and forward again', (await at()).trim() === 'Semi-final', await at());
  // Part way between two columns it names the nearer one rather than sticking.
  await scrollTo(1000);
  check('naming the nearer column part way', (await at()).trim() === 'Final', await at());
  await scrollTo(0);
  await page.getByRole('button', { name: 'Next round' }).click();
  await page.waitForTimeout(800);
  check(
    'and the arrows still step from wherever the finger left it',
    (await at()).trim() === 'Quarter-final',
    await at(),
  );

  // The heading may only move once per press, and only forwards. It shipped with two
  // writers — the press set it and the scroll handler then overrode it back to the
  // column being left — so it read destination, origin, destination on every press.
  await scrollTo(0);
  const seen = await page.evaluate(async () => {
    const out = [];
    const el = () => document.querySelector('.bracket-at').textContent;
    out.push(el());
    const obs = new MutationObserver(() => {
      if (out[out.length - 1] !== el()) out.push(el());
    });
    obs.observe(document.querySelector('.bracket-paging'), {
      subtree: true,
      childList: true,
      characterData: true,
    });
    document.querySelectorAll('.bracket-paging button')[1].click();
    await new Promise((r) => setTimeout(r, 1200));
    obs.disconnect();
    return out;
  });
  check(
    'one press changes the heading once, not three times',
    JSON.stringify(seen) === '["Preliminary","Quarter-final"]',
    seen.join(' -> '),
  );

  // Stepping from the column last *asked for* rather than the one on screen, or a second
  // press inside the scroll re-issues the first and the arrows feel stuck.
  await scrollTo(0);
  for (let i = 0; i < 3; i += 1) {
    await page.getByRole('button', { name: 'Next round' }).click();
  }
  await page.waitForTimeout(1400);
  check(
    'three quick presses move three rounds, not one',
    (await at()).trim() === 'Final',
    await at(),
  );

  // The arrows must not move as the label beside them changes width, or the button walks
  // out from under a thumb pressing it twice — measured at 73px of travel between
  // Quarter-final and Final before they were pinned right.
  await scrollTo(0);
  const spots = [];
  for (let i = 0; i < 4; i += 1) {
    spots.push(
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('.bracket-paging button')];
        return `${document.querySelector('.bracket-at').textContent}@${Math.round(
          b[1].getBoundingClientRect().left,
        )}`;
      }),
    );
    if (i < 3) {
      await page.getByRole('button', { name: 'Next round' }).click();
      await page.waitForTimeout(700);
    }
  }
  check(
    'the arrows stay put as the round name changes width',
    new Set(spots.map((s) => s.split('@')[1])).size === 1,
    spots.join(' '),
  );
  await page.close();
}

console.log('\na tie loads locked, and says so');
{
  const page = await open();
  await playFirst(page);
  await page.waitForSelector('.setup');
  const state = await game(page);
  check('the game carries the tournament', Boolean(state.tournament));
  check('never as a guest game', state.casual === false);
  check('the names are text, not fields', (await page.locator('.team-name-input').count()) === 0);
  check('the mode is fixed by the draw', await page.locator('.mode-toggle button').first().isDisabled());
  check('and Guests is off the table', await page.locator('.casual-toggle').isDisabled());
  check(
    'a banner names the tournament and the round',
    /Hole Corn VI · (Preliminary|Quarter-final)/.test(await page.locator('.tie-banner').innerText()),
    (await page.locator('.tie-banner').innerText()).trim(),
  );
  // The toss still works: it moves who opens, which cannot move a tie to other people.
  check('the toss is still offered', await page.locator('.toss').isEnabled());
  // The target is fixed at the draw like the mode is, so a bracket cannot end up with one
  // tie played to 12 among ties played to 21 — which the bracket would not notice, since it
  // reads only the sides and the winner, so nothing would ever say it had happened.
  check('the target is text, not a field', (await page.locator('.target-field').count()) === 0);
  check(
    'and it says what the draw set',
    (await page.locator('.target-fixed').innerText()).trim() === 'Play to 21',
    await page.locator('.target-fixed').innerText(),
  );
  await page.close();
}

console.log('\na tie picked by mistake can be put back');
{
  // Without this the screen has one exit — Start — so backing out of a mis-tapped tie
  // means playing it or abandoning a started game.
  const page = await open();
  await playFirst(page);
  await page.waitForSelector('.tie-banner');
  await page.getByRole('button', { name: 'Play something else' }).click();
  const left = await settles(() =>
    page.waitForSelector('.tie-banner', { state: 'detached', timeout: 3000 }),
  );
  check('pressing it puts the tie back', left, left ? '' : 'the banner never went');
  check('the game is no longer a tie', (await game(page)).tournament === null);
  check('the names are editable again', (await page.locator('.team-name-input').count()) === 2);
  check('the mode is unlocked', !(await page.locator('.mode-toggle button').first().isDisabled()));
  check('and Guests is back', !(await page.locator('.casual-toggle').isDisabled()));
  await backToBracket(page);
  check('the tie is still there, unplayed', (await progress(page)).trim() === '0 of 10 ties');
  await page.close();
}

console.log('\nabandoning a tournament puts back a tie of it');
{
  // The bracket is gone, so nothing is left to say which tie this was or to take it back
  // out of. Left tagged, the setup screen keeps a banner naming no tournament with the
  // names, mode and target locked by a draw that does not exist. Only this can see it:
  // `clearTie` and the deletion are each correct on their own, and nothing joins them up
  // but `App.jsx`.
  const page = await open();
  await playFirst(page);
  await page.waitForSelector('.tie-banner');
  const before = await page.locator('.team-name-static').allInnerTexts();
  await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
  await page.waitForSelector('.tournament-list');
  await page.locator('.tournament-row').first().click();
  await page.locator('.tournament-drop').first().click();
  await page.waitForSelector('.modal');
  await page.locator('.modal').getByRole('button', { name: 'Abandon' }).click();
  await page.getByRole('button', { name: '‹ Back' }).click();
  const gone = await settles(() =>
    page.waitForSelector('.tie-banner', { state: 'detached', timeout: 3000 }),
  );
  check('the banner goes with the bracket', gone, gone ? '' : 'the banner outlived the draw');
  check('and the game is no longer a tie', (await game(page)).tournament === null);
  check('the names are editable again', (await page.locator('.team-name-input').count()) === 2);
  check('the mode is unlocked', !(await page.locator('.mode-toggle button').first().isDisabled()));
  check('and the target is a field again', (await page.locator('.target-field').count()) === 1);
  // `clearTie` keeps the lineup on purpose — two people who were about to play is a
  // reasonable thing to start an ordinary game from, and clearing it destroys something
  // to make a point.
  const after = await page.locator('.team-name-input').evaluateAll((els) =>
    els.map((e) => e.value),
  );
  check(
    'the two who were about to play are still in the lineup',
    after.join('|') === before.join('|'),
    `${after.join('|')} (was ${before.join('|')})`,
  );
  await page.close();
}

console.log('\nthe draw cannot set a target the app would refuse');
{
  // `min`/`max` on a number input are a hint a keyboard walks past, so the value goes
  // through the app's own `clampTarget`. Without it a tournament stored target 5000 and
  // `tieSetup` handed that to a game — a tie needing 5000 points to win.
  const page = await browser.newPage({ viewport: PHONE });
  page.on('pageerror', (e) => {
    console.log('  PAGE ERROR', e.message);
    failures++;
  });
  await page.goto(URL);
  await page.waitForSelector('.setup');
  await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
  await page.getByRole('button', { name: 'New tournament' }).click();
  await page.locator('.draw-name input').fill('Hole Corn VI');
  await page.locator('.draw-target input').fill('5000');
  await page.waitForTimeout(150);
  const shown = await page.locator('.draw-target input').inputValue();
  check('a silly target is clamped as it is typed', Number(shown) === 99, shown);
  for (const [i, n] of ['Rho', 'Tau'].entries()) {
    await page.getByRole('button', { name: 'Add new entrant' }).click();
    await page.locator('.entrant-name').nth(i).fill(n);
  }
  await page.locator('.draw-go').click();
  await skipCeremony(page);
  await page.waitForSelector('.bracket-scroll');
  const stored = await page.evaluate(
    () => JSON.parse(localStorage.getItem('holecorn.tournaments.v1'))[0].target,
  );
  check('and the tournament stores the clamped value', stored === 99, `${stored}`);
  await playFirst(page);
  await page.waitForSelector('.setup');
  check(
    'so a tie is playable rather than needing 5000 points',
    (await page.locator('.target-fixed').innerText()).trim() === 'Play to 99',
    await page.locator('.target-fixed').innerText(),
  );
  await page.close();
}

console.log('\nthe draw is played out a name at a time');
{
  // `drawSteps` is pure and unit tested, and `tournament.test.js` already holds it to the
  // pairings `bracket()` goes on to draw. What only a browser can see is that the screen
  // is playing out **the tournament that was actually saved** — `Draw` shuffles, stores,
  // and hands the same object on, and a re-shuffle anywhere in that chain would announce
  // pairings the bracket never draws with nothing on either screen to say so.
  const page = await browser.newPage({ viewport: PHONE });
  page.on('pageerror', (e) => {
    console.log('  PAGE ERROR', e.message);
    failures++;
  });
  await page.goto(URL);
  await page.waitForSelector('.setup');
  await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
  await page.getByRole('button', { name: 'New tournament' }).click();
  await page.locator('.draw-name input').fill('Hole Corn VI');
  for (let i = 0; i < ELEVEN.length; i += 1) {
    await page.getByRole('button', { name: 'Add new entrant' }).click();
  }
  for (const [i, n] of ELEVEN.entries()) await page.locator('.entrant-name').nth(i).fill(n);
  await page.locator('.draw-go').click();

  const arrived = await settles(() => page.waitForSelector('.ceremony', { timeout: 5000 }));
  check('taking the draw lands on the ceremony, not the bracket', arrived);
  const count = async () => (await page.locator('.ceremony-count').innerText()).toLowerCase();
  check('with nothing pulled yet', (await count()) === '0 of 11 drawn', await count());
  check('and no bracket behind it', (await page.locator('.bracket-scroll').count()) === 0);

  // The pause is the whole point: a press has to change something before the name lands
  // or it reads as a dead button, which is the reasoning `Toss for first` already carries.
  await page.locator('.ceremony-pull').click();
  await page.waitForTimeout(300);
  const held = await page.locator('.ceremony-name').innerText();
  check('the name is withheld for a beat', /pulling/i.test(held), held);
  check('and the button is held with it', await page.locator('.ceremony-pull').isDisabled());

  await page.waitForTimeout(1200);
  check('then the name lands', !/pulling/i.test(await page.locator('.ceremony-name').innerText()));
  check('and the count moves', (await count()) === '1 of 11 drawn', await count());

  // Every name, in the order the screen pulls them.
  const pulled = [await page.locator('.ceremony-name').innerText()];
  for (let i = 1; i < ELEVEN.length; i += 1) {
    await page.locator('.ceremony-pull').click();
    await page.waitForTimeout(1250);
    pulled.push(await page.locator('.ceremony-name').innerText());
  }
  check('the last press ends the draw', (await count()) === '11 of 11 drawn', await count());
  check('everyone came out of the hat exactly once',
    [...pulled].sort().join('|') === [...ELEVEN].sort().join('|'),
    pulled.join(', '));

  // The crossing. `entrants` in draw order *is* the seating, so the order the ceremony
  // pulled them in has to be the order the stored tournament holds — otherwise the card
  // named a draw nobody is about to play.
  const entrants = await page.evaluate(
    () => JSON.parse(localStorage.getItem('holecorn.tournaments.v1'))[0].entrants.flat(),
  );
  check('in the order the tournament was stored in', pulled.join('|') === entrants.join('|'),
    `${pulled.join(', ')} vs ${entrants.join(', ')}`);

  // A finished draw offers the bracket rather than another pull, and the sheet holds the
  // pairings — the ties both sides of which came out of the hat. The tie between two
  // preliminary winners is announced by no pull, so it is not among them.
  check('the button becomes the way on',
    (await page.locator('.ceremony-pull').innerText()) === 'See the bracket');
  check('and the sheet lists the pairings made',
    (await page.locator('.ceremony-sheet li').count()) === 6,
    `${await page.locator('.ceremony-sheet li').count()}`);

  // A row's two cells share one background and round off only their outer corners, so
  // they have to touch — a column gap puts the page through the middle of what is drawn
  // as a single pill, and reads as a separator nobody chose. That is not hypothetical:
  // `.ceremony-sheet` set `gap: 2px` for its rows while it was a flex column, and the
  // gap survived the change to a grid. Neither this nor the caption below is reachable
  // from a unit test, and nothing in the components would notice either coming back.
  const row = await page.$eval('.ceremony-sheet li', (li) => {
    const [round, tie] = li.children;
    const rb = round.getBoundingClientRect();
    const tb = tie.getBoundingClientRect();
    const ink = document.createRange();
    ink.selectNodeContents(round);
    const ib = ink.getBoundingClientRect();
    return { seam: tb.left - rb.right, above: ib.top - rb.top, below: rb.bottom - ib.bottom };
  });
  check('the round and the pairing are one pill', Math.abs(row.seam) < 0.5,
    `${row.seam.toFixed(1)}px between them`);
  // The two cells stretch to the taller, which is always the pairing, so a caption left
  // to flow sits above the middle — and at the very top of a pairing that has wrapped.
  check('with the round centred against it', Math.abs(row.above - row.below) < 1,
    `${row.above.toFixed(1)}px above, ${row.below.toFixed(1)}px below`);

  await page.locator('.ceremony-pull').click();
  const landed = await settles(() => page.waitForSelector('.bracket-scroll', { timeout: 5000 }));
  check('which opens the bracket just drawn', landed);
  await page.close();
}

console.log('\nthe ceremony can be skipped, and the draw stands either way');
{
  // Always ceremonial and always skippable, which is what a toggle would have bought and
  // this does not have to remember. The draw is stored before a single name is revealed,
  // so skipping cannot lose one.
  const page = await open(['Rho', 'Tau', 'Sigma', 'Phi']);
  const entrants = await page.evaluate(
    () => JSON.parse(localStorage.getItem('holecorn.tournaments.v1'))[0].entrants.flat(),
  );
  check('skipping still stores the whole field', entrants.length === 4, entrants.join(', '));
  check('and the bracket is drawn from it',
    (await page.locator('.tie').count()) > 0);
  await page.close();
}

console.log('\nan open tournament says what it was played to, on both tabs');
{
  // A score on either tab is unreadable without it: 26–24 is somebody squeaking over the
  // line in this cup and a blowout in one played to 12, and nothing on the bracket or in
  // the tie log distinguishes them. The target is fixed at the draw, so it is one fact for
  // the whole tournament and sits beside the tabs rather than in either panel — which is
  // the only part of this a browser is needed for.
  //
  // Seeded rather than played, so the target is 26 and the result is the case above.
  const page = await browser.newPage({ viewport: PHONE });
  page.on('pageerror', (e) => {
    console.log('  PAGE ERROR', e.message);
    failures++;
  });
  await page.goto(URL);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem(
      'holecorn.tournaments.v1',
      JSON.stringify([
        {
          format: 1,
          id: 'c1',
          name: 'Hole Corn V',
          createdAt: Date.parse('2026-05-05'),
          mode: 'singles',
          target: 26,
          entrants: [['Rho'], ['Tau'], ['Sigma'], ['Phi']],
        },
      ]),
    );
    localStorage.setItem(
      'holecorn.matches.v1',
      JSON.stringify([
        {
          format: 1,
          id: 'm1',
          tournament: 'c1',
          mode: 'singles',
          players: { a: ['Rho', ''], b: ['Tau', ''] },
          rounds: [],
          final: { a: 26, b: 24 },
          winner: 'a',
          endedAt: Date.parse('2026-05-06'),
        },
      ]),
    );
  });
  await page.reload();
  await page.waitForSelector('.setup');
  await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
  await page.locator('.tournament-row').first().click();
  check(
    'an open row says what its ties are played to',
    await settles(() => page.waitForSelector('.tournament-target', { timeout: 3000 })),
  );
  // Null rather than a throw when the line is not there. Reading it as an assertion means
  // a mutation that removes it must *report*, and `innerText` on nothing ends the run —
  // which is the lesson the rest of this file already carries about bare waits. Verified:
  // scoping the line to the Bracket tab killed every block below before this.
  const text = async () =>
    (await page.locator('.tournament-target').count()) === 0
      ? null
      : (await page.locator('.tournament-target').innerText()).trim();
  // 26 rather than 21, so a line hardcoded to the app's default would fail here. Worded
  // the way the setup screen words it for a tie, so the two screens agree.
  check('and it is the draw\'s target, in the app\'s own words', (await text()) === 'Play to 26', await text());
  // Beside the tabs, not inside a panel: a target that belongs to one tab is a target that
  // disappears the moment you look at the numbers it explains. On the tabs' own line rather
  // than under them, so it costs the open row no height at all.
  //
  // Measured at 360px, the narrowest width the app is held to: 214px of the 302 available on
  // a Mac, and the deploy runner's `system-ui` is wider — the slack is what that is for, and
  // it is the reason this measures the width it needs rather than only that it fits.
  await page.setViewportSize({ width: 360, height: 852 });
  const beside = await page.evaluate(() => {
    const head = document.querySelector('.tournament-head');
    const tabs = document.querySelector('.tournament-tabs').getBoundingClientRect();
    const box = document.querySelector('.tournament-target').getBoundingClientRect();
    const li = head.closest('li');
    const pad = parseFloat(getComputedStyle(li).paddingLeft) * 2;
    return {
      sameLine: Math.abs(box.top - tabs.top) < tabs.height,
      head: Math.round(head.getBoundingClientRect().height),
      tabsH: Math.round(tabs.height),
      needs: Math.round(head.getBoundingClientRect().width),
      has: Math.round(li.getBoundingClientRect().width - pad),
    };
  });
  check(
    'it sits on the tabs\' own line, and costs that line nothing',
    beside.sameLine && beside.head === beside.tabsH,
    JSON.stringify(beside),
  );
  // Needed against available, not overflow: the row has nothing that clips, so a line too
  // wide for a phone spills rather than shrinking and every overflow check passes. Same
  // lesson `verify-lanes.mjs` and `.setup-top` both carry.
  check(
    'and the two of them fit a 360px phone with room to spare',
    beside.needs <= beside.has,
    `${beside.needs}px needed against ${beside.has}px`,
  );
  await page.setViewportSize(PHONE);
  await page.getByRole('tab', { name: 'Stats' }).click();
  check(
    'and it is still there beside the numbers it explains',
    await settles(() => page.waitForSelector('.tournament-stats', { timeout: 3000 })) &&
      (await text()) === 'Play to 26',
    await text(),
  );
  // A stored draw with no target at all takes a hand-edited file — `newTournament` has
  // always stamped one. The line simply goes, the way the date line does.
  await page.evaluate(() => {
    const [t] = JSON.parse(localStorage.getItem('holecorn.tournaments.v1'));
    delete t.target;
    localStorage.setItem('holecorn.tournaments.v1', JSON.stringify([t]));
  });
  await page.reload();
  await page.waitForSelector('.setup');
  await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
  await page.locator('.tournament-row').first().click();
  check(
    'a draw with no target says nothing rather than nothing-to-win',
    (await settles(() => page.waitForSelector('.tournament-tabs', { timeout: 3000 }))) &&
      (await page.locator('.tournament-target').count()) === 0,
    `${await page.locator('.tournament-target').count()} shown`,
  );
  await page.close();
}

console.log('\na won tie advances the bracket, and undoing it takes the tie back out');
{
  // The property the derived design exists for. Nothing is stored about the bracket's
  // progress, so un-archiving the match is the whole of the undo.
  const page = await open();
  await playFirst(page);
  await page.waitForSelector('.setup');
  await winIt(page);
  check('the tie was archived tagged', (await archive(page))[0]?.tournament !== undefined);
  await page.getByRole('button', { name: 'New game' }).click();
  await page.waitForSelector('.setup');
  // Not sticky, unlike `mode` and `casual`. A tournament runs over weeks, so a tie-ness
  // carried across `New game` would still be on a fortnight later and would file the
  // next friendly as a tie — silently, and into somebody else's bracket.
  check('the game after it is not a tie', (await game(page)).tournament === null);
  check('and its names are editable again', (await page.locator('.team-name-input').count()) === 2);
  await backToBracket(page);
  check('the bracket counts it', (await progress(page)).trim() === '1 of 10 ties', await progress(page));
  check('four ties are playable now, not five', (await playable(page)) === 4, `${await playable(page)}`);
  check('and the played tie shows its score', (await page.locator('.tie-points').count()) === 2);
  await page.close();
}

console.log('\nundoing the winning round un-archives the tie and the bracket recomputes');
{
  const page = await open();
  await playFirst(page);
  await page.waitForSelector('.setup');
  await winIt(page);
  check('archived on the win', (await archive(page)).length === 1);
  await page.getByRole('button', { name: 'Undo round' }).click();
  await settles(() =>
    page.waitForFunction(
      () => JSON.parse(localStorage.getItem('holecorn.matches.v1') || '[]').length === 0,
      null,
      { timeout: 5000 },
    ),
  );
  check('un-archived on the undo', (await archive(page)).length === 0);
  // Leaving the game is the only route to the bracket, and the tie is still loaded, so
  // the game has to be put down first. The undo made it unfinished again, so the button
  // is `Abandon game` and asks — it only reads `New game`, and goes straight through,
  // once there is nothing left to lose.
  await page.getByRole('button', { name: 'Abandon game' }).click();
  await page.locator('.modal').getByRole('button', { name: 'Abandon game' }).click();
  await page.waitForSelector('.setup');
  await backToBracket(page);
  check(
    'the bracket has nothing played again',
    (await progress(page)).trim() === '0 of 10 ties',
    await progress(page),
  );
  check('and all five opening ties are playable', (await playable(page)) === 5, `${await playable(page)}`);
  await page.close();
}

console.log('\na tie nobody could play is awarded, and counts towards nothing');
{
  // The one thing a derived bracket structurally could not see: a tie that was never
  // played. A walkover is a record with a winner and no rounds, so the bracket advances
  // off the archive with nothing new stored — and every assertion here is about the
  // wiring, because `forfeitGame` and `counted` are both pure and unit tested.
  const page = await open();
  check(
    'an unfinished bracket offers it',
    (await page.locator('.tournament-award').count()) === 1,
    `${await page.locator('.tournament-award').count()} buttons`,
  );
  await page.locator('.tournament-award').click();
  if (!(await settles(() => page.waitForSelector('.award-list', { timeout: 5000 })))) {
    check('the dialog opens', false);
  }
  // Grouped by round, so the blocks are rounds and not ties: a fresh eleven-entrant draw
  // has five live ties across two rounds — three preliminaries and the two byes that meet.
  // Read off `view.playable` instead, the captions come out in bracket-position order and
  // run Preliminary, Preliminary, Quarter-final, Preliminary.
  const rounds = await page.locator('.award-list > li').count();
  const ties = await page.locator('.award-tie').count();
  check('grouped into a block per round', rounds === 2, `${rounds} blocks`);
  check('holding every live tie', ties === 5, `${ties} ties`);
  // Both sides of every tie, because either of them can be the one who cannot make it —
  // a dialog offering only side a would look right on the bracket and be useless half
  // the time.
  check(
    'and both sides of each, since either can be the one who is out',
    (await page.locator('.award-side').count()) === 10,
    `${await page.locator('.award-side').count()} options`,
  );
  // The captions in the order the bracket reads, deepest first — the property the
  // grouping exists for, and the one a count cannot see. Lower-cased before comparing,
  // because `text-transform` means the rendered text is not the text in the component:
  // this file's standing lesson, met again on the first run.
  const captions = await page.locator('.award-round').allInnerTexts();
  check(
    'with the rounds in bracket order and named once each',
    JSON.stringify(captions.map((c) => c.trim().toLowerCase())) ===
      '["preliminary","quarter-final"]',
    JSON.stringify(captions),
  );
  // Ties are played opportunistically, so a whole round can be live at once — five here,
  // 32 on a 64-entrant field. Measured at 16 entrants before the list was capped, the
  // dialog's content ran to 1232px and `Cancel` sat 400px below the fold behind the title
  // and the body: a dialog you have to scroll to get out of. The **guard comes first**,
  // because with nothing to scroll the reachability assertion passes however the box is
  // sized — this file's standing lesson.
  const box = await page.evaluate(() => {
    const list = document.querySelector('.award-list');
    const cancel = [...document.querySelectorAll('.confirm-actions button')].pop();
    return {
      overflows: list.scrollHeight > list.clientHeight,
      cancelBottom: Math.round(cancel.getBoundingClientRect().bottom),
      viewport: innerHeight,
    };
  });
  check('the ties are what scrolls, rather than the dialog', box.overflows);
  check(
    'so Cancel stays on screen however many are live',
    box.cancelBottom <= box.viewport,
    `Cancel at ${box.cancelBottom} of ${box.viewport}`,
  );
  const sides = page.locator('.award-tie').first().locator('.award-side');
  const nameOf = async (n) =>
    (await sides.nth(n).innerText()).replace(/can.t play/, '').trim();
  const out = await nameOf(0);
  const through = await nameOf(1);
  // Read off the dialog rather than written down: which names land in the first tie is
  // the draw's business, so a fixture that named them would be asserting the shuffle.
  check('each option names a side of that tie', Boolean(out && through && out !== through), `${out} / ${through}`);
  await sides.first().click();
  await settles(() => page.waitForSelector('.award-list', { state: 'detached', timeout: 5000 }));

  check(
    'the bracket counts the tie',
    (await progress(page)).trim() === '1 of 10 ties',
    await progress(page),
  );
  check('with one fewer playable', (await playable(page)) === 4, `${await playable(page)}`);
  // The half that separates it from a played tie, which draws two numbers here: nothing
  // was thrown, so `finalScore` is null and the box has nothing to show.
  check('and no score on it, because nobody threw', (await page.locator('.tie-points').count()) === 0);
  const won = await page.locator('.tie.is-played .tie-side.is-winner').innerText();
  check(
    'the side that could still play goes through',
    won.trim() === through,
    `${won.trim()} through, ${out} was out`,
  );
  const [filed] = await archive(page);
  check('filed as a walkover', filed?.forfeit === true, String(filed?.forfeit));
  check('tagged with the tournament, which is what places it', filed?.tournament !== undefined);
  check('and holding no rounds', filed?.rounds?.length === 0, `${filed?.rounds?.length} rounds`);

  // The other half, and it has to be the same match: it settles a tie *and* counts
  // towards nothing. Neither side can see the other — `counted` is unit tested over
  // records handed to it, and the bracket reads the archive raw — so a screen reading
  // one through the other is invisible from both. The guest-game block in
  // verify-stats.mjs is the same pair, pointed the other way.
  await page.getByRole('button', { name: '‹ Back' }).click();
  await page.waitForSelector('.setup');
  await page.getByRole('button', { name: 'Stats' }).click();
  await page.waitForSelector('.recent');
  check(
    'it is in Recent matches, which is how it is undone',
    (await page.locator('.recent li').count()) === 1,
    `${await page.locator('.recent li').count()} rows`,
  );
  const chip = (await page.locator('.stat-chip').first().innerText()).replace(/\s+/g, ' ').trim();
  check('and the totals still say no matches', chip.toLowerCase() === '0 matches', chip);
  check(
    'nobody has a career from it',
    (await page.locator('.stats-table tbody tr').count()) === 0,
    `${await page.locator('.stats-table tbody tr').count()} rows`,
  );
  await page.locator('.recent-open').click();
  const facts = (await page.locator('.match-rounds-foot').innerText()).replace(/\s+/g, ' ');
  check('opening it says why it is here and not in those numbers', facts.includes('walkover, not counted'), facts);
  // "result only, no rounds recorded" is the imported result's line and would be the
  // second thing on this row saying nobody threw.
  check('and does not read as an imported result as well', !facts.includes('result only'), facts);

  // The claim the dialog makes, checked rather than only made — the rule the tournament's
  // own delete dialog already follows.
  await page.locator('.recent li .match-drop').click();
  await page.locator('.confirm-danger').click();
  await page.getByRole('button', { name: '‹ Back' }).click();
  await page.waitForSelector('.setup');
  await backToBracket(page);
  check(
    'deleting the match puts the tie back on the bracket',
    (await progress(page)).trim() === '0 of 10 ties',
    await progress(page),
  );
  check('playable again', (await playable(page)) === 5, `${await playable(page)}`);
  await page.close();
}

console.log('\nawarding a tie takes it off the setup screen, and a finished cup offers none');
{
  // Two ways of getting a tie you can no longer play, and only `App.jsx` joins them up:
  // the repair effect is the one thing between awarding a tie on this screen and `Start`
  // offering to play it a second time, which would file a second record for one tie.
  const page = await open(['Rho', 'Tau']);
  await playFirst(page);
  await page.waitForSelector('.setup');
  check('the tie is loaded', (await page.locator('.tie-banner').count()) === 1);
  await backToBracket(page);
  await page.locator('.tournament-award').click();
  await page.waitForSelector('.award-list');
  // **Asserted on this cup and not the eleven-entrant one**, which cannot fail: there the
  // list scrolls, and Chrome makes a scroller focusable, so the `ul` takes focus whatever
  // the dialog asks for. One live tie is the case where the first focusable descendant
  // really is an option that settles a tie, and a stray Enter on opening would award it.
  const landed = await page.evaluate(() => document.activeElement?.textContent ?? '');
  check('the dialog opens on Cancel, not on an option', landed === 'Cancel', landed.slice(0, 30));
  await page.locator('.award-side').first().click();
  await settles(() => page.waitForSelector('.award-list', { state: 'detached', timeout: 5000 }));
  // A two-entrant cup is one tie, so awarding it decides the cup — a champion on a
  // walkover, which is the case worth playing out rather than assuming.
  check(
    'the cup is won',
    (await page.locator('.champion-who').count()) === 1,
    `${await page.locator('.champion-who').count()} winners named`,
  );
  check(
    'and a finished bracket offers no more ties to award',
    (await page.locator('.tournament-award').count()) === 0,
  );
  await page.getByRole('button', { name: '‹ Back' }).click();
  await page.waitForSelector('.setup');
  check('the settled tie is off the setup screen', (await page.locator('.tie-banner').count()) === 0);
  check('its names are editable again', (await page.locator('.team-name-input').count()) === 2);
  check('and nothing is left tagged', (await game(page)).tournament === null);
  await page.close();
}

console.log('\na finished tournament keeps its bracket');
{
  // A champions list on its own throws away the one thing the paper sheets were kept
  // for, so the row has to open.
  const page = await open(['Rho', 'Tau']);
  await playFirst(page);
  await page.waitForSelector('.setup');
  await winIt(page);
  await page.getByRole('button', { name: 'New game' }).click();
  // Navigated by hand rather than through `backToBracket`, which opens the first row — this
  // block is about the shut state, so it cannot use a helper that undoes it.
  await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
  await page.waitForSelector('.tournament-list');
  check(
    'it moved under the Completed heading',
    (await page.locator('.tournament-list h2').textContent()) === 'Completed',
    await page.locator('.tournament-list h2').textContent(),
  );
  check('shut, with no bracket on show', (await page.locator('.bracket').count()) === 0);
  check('and nothing left to play', (await playable(page)) === 0);
  const said = (await page.locator('.champion-who').textContent()).replace(/\s+/g, ' ').trim();
  await page.locator('.tournament-row').click();
  check('the row opens the bracket', (await page.locator('.bracket').count()) === 1);
  // A finished row says what the name beside it means, which a bare name does not. Matched
  // against the *bracket's* champion rather than a name written down here: the draw is
  // shuffled, so which of the two ends up as side A — and therefore wins, since `winIt`
  // always wins for A — is random per run. Hardcoding one of them passed by luck once.
  const won = (await page.locator('.bracket .tie-side.is-winner .tie-who').textContent()).trim();
  check('and the row said who won', said === `Winner · ${won}`, `${said} (bracket: ${won})`);
  // The champions list is capped a row at a time, not as a section: capping the section
  // held a bracket opened inside one to 534px on a screen with 1008px to give it, and
  // clipped the third heading mid-word.
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.waitForTimeout(300);
  check(
    'and gives it the width the screen has, not the list cap',
    await page.evaluate(() => {
      const li = document.querySelector('.tournament-list li.is-open');
      const scroll = document.querySelector('.bracket-scroll');
      return li.getBoundingClientRect().width > 560 && scroll.scrollWidth <= scroll.clientWidth;
    }),
    await page.evaluate(() => {
      const li = document.querySelector('.tournament-list li.is-open');
      const s = document.querySelector('.bracket-scroll');
      return `row ${Math.round(li.getBoundingClientRect().width)}, bracket ${s.scrollWidth} of ${s.clientWidth}`;
    }),
  );
  await page.setViewportSize(PHONE);
  await page.waitForTimeout(200);
  check(
    'showing the final and its score',
    (await page.locator('.bracket-head').innerText()) === 'Final' &&
      (await page.locator('.tie-points').count()) === 2,
    await page.locator('.bracket-head').innerText(),
  );
  await page.close();
}

console.log('\nboth lists are rows that open and shut');
{
  // An unfinished bracket is up to 63 ties and a finished one is a whole year, so neither
  // is unrolled on arrival beside the others. The one being played opens by default,
  // because the ties waiting are the reason for being on this screen.
  const page = await open();
  const rows = () =>
    page.evaluate(() => ({
      headings: [...document.querySelectorAll('.tournament-list h2')].map((e) => e.textContent),
      open: [...document.querySelectorAll('.tournament-list > ul > li')].map((li) =>
        li.classList.contains('is-open'),
      ),
      brackets: document.querySelectorAll('.bracket').length,
    }));
  // Drawing one opens it, so leaving and coming back is the only way to see the resting
  // state — and the resting state is the point: a bracket is up to 63 ties.
  const drawn = await rows();
  check('the one just drawn opens itself', drawn.open[0] === true, JSON.stringify(drawn.open));
  await page.getByRole('button', { name: '‹ Back' }).click();
  await page.waitForSelector('.setup');
  await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
  await page.waitForSelector('.tournament-list');
  const shut = await rows();
  check(
    'but arriving at the screen finds everything shut',
    shut.open.every((o) => !o) && shut.brackets === 0,
    JSON.stringify(shut),
  );
  await page.locator('.tournament-row').first().click();
  await page.waitForTimeout(250);
  check('and a tap opens one', (await rows()).brackets === 1);


  await page.close();
}

console.log('\nthe bracket box is the Play button, and it opens where the ties are');
{
  // There used to be a "Ready to play" list above the drawing, duplicating boxes the bracket
  // already draws — a screenful of them on a big field, and each one shown without the
  // context that makes it worth looking at. The box is the button instead, which costs no
  // width and no height: both matter, because every box must stay the same height for the
  // connectors to line up and the column is only 176px wide.
  const page = await open();
  check('no separate list of playable ties', (await page.locator('.ready').count()) === 0);
  check(
    'every playable tie is a button and no other box is',
    (await page.locator('button.tie').count()) === (await page.locator('.tie.is-playable').count()),
    `${await page.locator('button.tie').count()} buttons, ${await page.locator('.tie.is-playable').count()} playable`,
  );
  // A marker rather than a control: absolutely positioned, so it takes nothing from the
  // names beside it.
  const cost = await page.evaluate(() => {
    const box = document.querySelector('button.tie');
    const plain = document.querySelector('div.tie:not(.is-seat)');
    // The *content* width, not the element's. The gutter reserved for the marker is padding
    // inside `.tie-sides`, so its border-box width is identical either way and measuring
    // that reports no cost where there is one.
    const room = (e) => {
      const s = e.querySelector('.tie-sides');
      const cs = getComputedStyle(s);
      return Math.round(s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    };
    return {
      playW: Math.round(box.getBoundingClientRect().width),
      plainW: Math.round(plain.getBoundingClientRect().width),
      playH: Math.round(box.getBoundingClientRect().height),
      plainH: Math.round(plain.getBoundingClientRect().height),
      playSides: room(box),
      plainSides: room(plain),
    };
  });
  check(
    'a playable box is the same size as any other',
    cost.playW === cost.plainW && cost.playH === cost.plainH,
    `${cost.playW}x${cost.playH} vs ${cost.plainW}x${cost.plainH}`,
  );
  // The space available to the names, not the width of the text in them: a box holding
  // "winner of Rho v Tau" renders a wider `.tie-who` than one holding "Phi", so comparing
  // rendered text compares the content rather than the layout. That mistake made this read
  // 45px against 135px and look like a regression.
  //
  // A playable box gives up a gutter for the marker — deliberately, and the trade is worth
  // stating: a marker small enough to need no gutter was too small to see. Bounded here so
  // it cannot quietly grow into the names.
  check(
    'a playable box gives the names only the marker gutter less room',
    cost.plainSides - cost.playSides > 0 && cost.plainSides - cost.playSides <= 24,
    `${cost.playSides}px vs ${cost.plainSides}px`,
  );
  // And the gutter has to be enough: no marker may sit on top of a name, at any length.
  const overlaps = await page.evaluate(
    () =>
      [...document.querySelectorAll('button.tie')].filter((el) => {
        const m = el.querySelector('.tie-play').getBoundingClientRect();
        return [...el.querySelectorAll('.tie-who')].some((w) => {
          const r = w.getBoundingClientRect();
          return r.right > m.left + 0.5 && r.left < m.right;
        });
      }).length,
  );
  check('and no marker sits on top of a name', overlaps === 0, `${overlaps} overlapping`);
  // Centred rather than tucked in a corner, which is where it started and was too small to
  // read against the border it sits inside.
  const centred = await page.evaluate(() => {
    const el = document.querySelector('button.tie');
    const m = el.querySelector('.tie-play').getBoundingClientRect();
    const b = el.getBoundingClientRect();
    return {
      off: Math.abs((m.top + m.bottom) / 2 - (b.top + b.bottom) / 2),
      h: Math.round(m.height),
    };
  });
  check(
    'the marker is centred and big enough to see',
    centred.off < 1.5 && centred.h >= 13,
    `${centred.h}px tall, ${centred.off.toFixed(1)}px off centre`,
  );
  // Every box the same height, which is what the connectors rest on: they run from each
  // child's own centre to the boundary between the pair, and that only meets the parent's
  // stub if the two children are equal. It was silently untrue — a two-name box came out
  // 68px and a one-name bye 66px — so this is asserted over the whole bracket.
  const heights = await page.evaluate(() => [
    ...new Set(
      [...document.querySelectorAll('.bracket .tie')].map((e) =>
        Math.round(e.getBoundingClientRect().height),
      ),
    ),
  ]);
  check('and every box in the bracket is one height', heights.length === 1, `${heights.join(', ')}px`);
  await page.close();
}

console.log('\nand it opens on the round the live ties are in, not the outermost');
{
  // While *any* live tie is in the outermost round, opening at the outermost column with
  // no scroll is the right answer — so every assertion here reads the same whether
  // `startAt` works or is pinned to 0, and the block proves nothing. That is not
  // hypothetical: it used to lean on the sample fixture's Hole Corn VI being 5 of 9
  // played, `stopAfter` in make-sample-archive.mjs moved to 3, a preliminary went live
  // again, and the block started failing while a pinned `startAt` produced byte-identical
  // output. So it now clears the outermost round itself rather than inheriting a premise
  // from a number it does not own.
  const page = await browser.newPage({ viewport: PHONE });
  page.on('pageerror', (e) => {
    console.log('  PAGE ERROR', e.message);
    failures++;
  });
  await page.goto(URL);
  await page.waitForSelector('.setup');
  await page.getByRole('button', { name: 'Stats' }).click();
  await page.setInputFiles('input[type=file]', 'tools/fixtures/sample-archive.json');
  await page.waitForFunction(
    () => JSON.parse(localStorage.getItem('holecorn.matches.v1') || '[]').length > 50,
    null,
    { timeout: 20000 },
  );
  await page.getByRole('button', { name: '‹ Back' }).click();
  await page.waitForSelector('.setup');
  await page.locator('.setup-links button').first().click();
  await page.waitForSelector('.tournament-list');
  // Rows arrive shut, so the bracket has to be opened before there is anything to look at.
  // What is under test is where it opens *to*, not whether it opens.
  await page.locator('.tournament-row').first().click();
  await page.waitForSelector('.bracket-scroll');

  // Play out whatever is still live in the outermost round. `data-level` counts outwards,
  // so the largest is the round the bracket would open at anyway — clearing it is what
  // makes the assertions below able to fail. Reported rather than thrown, the rule every
  // wait in this file follows.
  const outermost = () =>
    page.evaluate(() => {
      const live = [...document.querySelectorAll('button.tie')].map((e) => Number(e.dataset.level));
      return live.length > 0 ? Math.max(...live) : 0;
    });
  const clearing = await outermost();
  for (let guard = 0; (await outermost()) === clearing && guard < 4; guard += 1) {
    await page.locator(`button.tie[data-level="${clearing}"]`).first().click();
    await page.waitForSelector('.setup');
    await winIt(page);
    await page.getByRole('button', { name: 'New game' }).click();
    await page.waitForSelector('.setup');
    await backToBracket(page);
  }
  check(
    'the outermost round is clear, so the assertions below can fail',
    (await outermost()) < clearing,
    `still live at L${await outermost()}`,
  );
  await page.waitForTimeout(300);
  const opened = await page.evaluate(() => {
    const s = document.querySelector('.bracket-scroll');
    const view = s.getBoundingClientRect();
    // *Some* live tie, not the first in DOM order — the tree is drawn children-first, so
    // the first playable box can be a semi-final in the other half of the bracket.
    const live = [...document.querySelectorAll('button.tie')].map((e) => ({
      level: e.dataset.level,
      inView:
        e.getBoundingClientRect().left >= view.left - 1 &&
        e.getBoundingClientRect().right <= view.right + 1,
    }));
    return {
      round: document.querySelector('.bracket-at').textContent,
      scrolled: Math.round(s.scrollLeft),
      inView: live.some((x) => x.inView),
      detail: live.map((x) => `L${x.level}${x.inView ? ' in view' : ''}`).join(', '),
    };
  });
  check(
    'the bar names the round the live ties are in',
    opened.round === 'Quarter-final',
    opened.round,
  );
  // Both halves: naming it is no use if the column is not the one on screen.
  check('and has scrolled to it', opened.scrolled > 0, `${opened.scrolled}px`);
  check('so a live tie is on screen without paging', opened.inView, opened.detail);
  await page.close();
}

console.log('\ndeleting a tournament asks first, and says what it does not take');
{
  // A *match* is deleted with one tap and an undo bar; a tournament asks. The difference is
  // deliberate: a match is deleted often enough that a confirm would be in the way, a
  // tournament about once a year, its button sits directly under the bracket you were
  // reading, and there is a fact worth telling you that an undo bar cannot carry — the ties
  // stay in the archive and keep counting.
  const page = await open();
  // A tie is played first, or both the sentence and the archive assertion below pass
  // vacuously: the message takes its "nothing has been played" branch and there are no ties
  // to check survive. Verified by removing this — the checks stayed green on `0 of 0`.
  await playFirst(page);
  await page.waitForSelector('.setup');
  await winIt(page);
  await page.getByRole('button', { name: 'New game' }).click();
  await backToBracket(page);
  const stored = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('holecorn.tournaments.v1') || '[]').length);
  const drop = page.locator('.tournament-drop').first();
  // Read against `--warn` rather than against a literal hex. The accent is two values now,
  // one per colour scheme, and this file does not pin a scheme — so a literal pins the
  // check to whichever way round Playwright happens to default, which is how this went red
  // on a rule that was working. The property is that the button wears the app's warning
  // accent on both edges, not that it is a particular red.
  const red = await drop.evaluate((e) => {
    const s = getComputedStyle(e);
    const probe = document.createElement('span');
    probe.style.color = 'var(--warn)';
    e.append(probe);
    const warn = getComputedStyle(probe).color;
    probe.remove();
    return { colour: s.color, border: s.borderTopColor, warn };
  });
  check(
    'the button is red',
    red.colour === red.warn && red.border === red.warn,
    `${red.colour} on ${red.border}, --warn is ${red.warn}`,
  );

  await drop.click();
  // Reported rather than awaited bare: with no confirmation at all the tournament is gone on
  // the press and this block used to die here on a timeout, naming nothing — the same fault
  // the waits at the top of this file already carry a note about. Verified by mutation.
  const asked = await settles(() => page.waitForSelector('.modal', { timeout: 3000 }));
  check('pressing it asks rather than deleting', asked, asked ? '' : 'no dialog appeared');
  if (!asked) {
    check('the tournament is still there', (await stored()) === 1, `${await stored()} stored`);
  }
  // `:modal`, not merely present — a `show()` would leave the row and its delete button
  // live underneath, which is the whole thing the dialog is for.
  check(
    'it asks in a real dialog',
    asked && (await page.locator('.modal').evaluate((e) => e.matches(':modal'))),
  );
  check(
    'naming the tournament',
    (await page.locator('.modal-title').textContent()).includes('Hole Corn VI'),
    await page.locator('.modal-title').textContent(),
  );
  check(
    'and saying the ties are not going with it',
    // The exact singular, verb included: `stays?` accepted "1 played tie stay", which is
    // what the message said until this was tightened.
    (await page.locator('.modal-body').textContent()).includes(
      '1 played tie stays in your history and still counts',
    ),
    (await page.locator('.modal-body').textContent()).replace(/\s+/g, ' ').trim(),
  );

  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(200);
  check('Cancel keeps it', (await stored()) === 1, `${await stored()} stored`);

  // No backdrop dismissal, unlike App.jsx's confirm: losing a destructive dialog to a stray
  // tap is worse than one more press on Cancel. Don't unify the two.
  await page.locator('.tournament-drop').first().click();
  await page.waitForSelector('.modal');
  await page
    .locator('.modal')
    .evaluate((d) => d.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await page.waitForTimeout(200);
  check('a backdrop tap does not dismiss it', (await page.locator('.modal').count()) === 1);

  const matchesBefore = await page.evaluate(
    () => JSON.parse(localStorage.getItem('holecorn.matches.v1') || '[]').length,
  );
  await page.locator('.modal').getByRole('button', { name: 'Abandon' }).click();
  await page.waitForTimeout(300);
  check('confirming removes the tournament', (await stored()) === 0, `${await stored()} stored`);
  // The claim the dialog makes has to be true.
  const matchesAfter = await page.evaluate(
    () => JSON.parse(localStorage.getItem('holecorn.matches.v1') || '[]').length,
  );
  check(
    'and leaves every one of its ties in the archive',
    matchesBefore > 0 && matchesAfter === matchesBefore,
    `${matchesAfter} of ${matchesBefore}`,
  );
  await page.close();
}

console.log('\nseveral tournaments can run at once');
{
  // A singles cup and a doubles cup in one summer. Nothing in the bracket cares — each
  // derives from its own tagged ties — so the only thing that can be wrong is the
  // setup button, which used to name `unfinished()[0]` and so hid every other one
  // behind the *oldest*, including one drawn the same day.
  const page = await open(['Rho', 'Tau', 'Sigma', 'Phi']);
  const label = () => page.locator('.setup-links button').first().innerText();
  await page.getByRole('button', { name: '‹ Back' }).click();
  await page.waitForSelector('.setup');
  // The button names the screen rather than a tournament. It carried the name and the
  // progress for a while, which read badly once a name could be 32 characters — measured, it
  // wrapped to two lines at 320px.
  check('the button names the screen', (await label()).trim() === 'Tournaments', await label());

  await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
  await page.getByRole('button', { name: 'New tournament' }).click();

  // Several cups run at once by decision, and both lists show the name and a date, so two
  // of a name is a screen you cannot pick from. Checked here rather than in the arrival
  // block because it needs a tournament to already exist — `open()` drew Hole Corn VI —
  // and because the block goes on to draw a real second one, which is the half that would
  // break if the rule matched too much.
  const nameHint = () => textOf(page.locator('.draw-hint'));
  // The field goes in *first*, so the name is the only thing left wrong. Asserting the
  // button on an empty form would pass on the entrant count whatever the name rule did —
  // this file's own recorded failure, and verified by mutation: dropping `duplicate` from
  // the button's gate passes the whole run when this is checked before the entrants.
  for (const [i, n] of ['Chi', 'Psi', 'Omega', 'Iota'].entries()) {
    await page.getByRole('button', { name: 'Add new entrant' }).click();
    await page.locator('.entrant-name').nth(i).fill(n);
  }
  await page.locator('.draw-name input').fill('Hole Corn VI');
  const taken = await nameHint();
  check('a name already in use is refused', /already a tournament/i.test(taken), taken);
  check('and the field says which box', (await page.locator('.draw-name input[aria-invalid]').count()) === 1);
  check(
    'with the draw held off, and nothing else wrong with the form',
    (await page.locator('.draw-go').isDisabled()) &&
      (await page.locator('.entrants .is-faulted').count()) === 0,
    taken,
  );
  // Compared the way a person's name is, so the case it was typed in cannot smuggle a
  // second one past.
  await page.locator('.draw-name input').fill('  hole corn vi ');
  const recased = await nameHint();
  check('however it was cased or spaced', /already a tournament/i.test(recased), recased);

  await page.locator('.draw-name input').fill('Doubles Cup');
  const own = await nameHint();
  check('a name of its own is not', !/already a tournament/i.test(own), own);
  check('and unmarks the field', (await page.locator('.draw-name input[aria-invalid]').count()) === 0);
  check('so the second draw is ready', await page.locator('.draw-go').isEnabled());
  await page.locator('.draw-go').click();
  await skipCeremony(page);
  await page.waitForSelector('.bracket');
  // Newest first, so the one just drawn heads the list rather than sitting under the
  // one it followed.
  check(
    'a second is not refused, and leads the list',
    (await page.locator('.tournament-name').evaluateAll((els) => els.map((e) => e.textContent))).join(
      ' | ',
    ) === 'Doubles Cup | Hole Corn VI',
    (
      await page.locator('.tournament-name').evaluateAll((els) => els.map((e) => e.textContent))
    ).join(' | '),
  );
  // One open at a time now, so the second replaces the first rather than joining it.
  check('the one just drawn is the one open', (await page.locator('.bracket').count()) === 1);
  await page.getByRole('button', { name: '‹ Back' }).click();
  await page.waitForSelector('.setup');
  check(
    'and still just names it with two running',
    (await label()).trim() === 'Tournaments',
    await label(),
  );
  await page.close();
}

console.log('\nan imported tournament shows up without a reload');
{
  // Import writes both halves to storage from inside the stats screen, so the app has to
  // re-read them on the way back. It re-read the archive and not the tournaments, which
  // left an imported bracket in storage and invisible — no button, no screen — until the
  // page was reloaded. The same staleness the archive already has a rule about.
  const page = await browser.newPage({ viewport: PHONE });
  page.on('pageerror', (e) => {
    console.log('  PAGE ERROR', e.message);
    failures++;
  });
  await page.goto(URL);
  await page.waitForSelector('.setup');
  const file = {
    format: 1,
    tournaments: [
      {
        format: 1,
        id: 'imported-cup',
        name: 'Imported Cup',
        createdAt: 1,
        mode: 'singles',
        target: 21,
        entrants: [['Rho'], ['Tau']],
      },
    ],
    matches: [],
  };
  await page.getByRole('button', { name: 'Stats' }).click();
  await page.setInputFiles('input[type=file]', {
    name: 'sample.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(file)),
  });
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: '‹ Back' }).click();
  await page.waitForSelector('.setup');
  await page.locator('.setup-links button').first().click();
  await page.waitForSelector('.tournament-list');
  check(
    'it is on the tournament screen straight away',
    (await page.locator('.tournament-name').textContent()) === 'Imported Cup',
    await page.locator('.tournament-name').textContent(),
  );
  await page.locator('.tournament-row').click();
  await page.waitForSelector('.bracket-scroll');
  check(
    'and its bracket is there to play',
    (await playable(page)) === 1,
    `${await playable(page)} playable`,
  );
  await page.close();
}

console.log('\nboth lists read newest draw first, whatever order storage holds');
{
  // Seeded straight into storage in an order no sort would produce, because that is the
  // order the app really ends up with: `upsertTournament` appends what is drawn here and
  // `mergeTournaments` appends what a file brings, so an imported bracket lands after
  // every local one whatever its draw date. Nothing below `Tournament.jsx` can see this —
  // `newestFirst` is unit tested and `bracket()` never looks at two tournaments at once.
  const page = await browser.newPage({ viewport: PHONE });
  page.on('pageerror', (e) => {
    console.log('  PAGE ERROR', e.message);
    failures++;
  });
  // **The two names are very different widths, and the two finished cups put the long one
  // on opposite sides.** With `Rho` against `Tau` the result lines come out within a pixel
  // of each other, so an assertion that both reach the right edge passes whatever the
  // alignment does. One cup each way is what makes it bite in both directions — verified by
  // mutation: with only the long *loser*, un-aligning the champion is caught and
  // un-aligning the runner-up is not, because the widest item sets the track either way.
  const LONG = 'AlphaBetaGammaDe';
  const SHORT = 'Tau';
  const cup = (id, name, createdAt, entrants) => ({
    format: 1,
    id,
    name,
    createdAt,
    mode: 'singles',
    target: 21,
    entrants,
  });
  // A tie for a cup is what finishes it, so these two land under Completed.
  //
  // **The second entrant wins, deliberately.** With the first one winning, "the other side
  // of the final" and "side b of the final" name the same person, so a runner-up derived
  // without looking at the winner at all passes — verified by mutation, and it did.
  const won = (id, entrants) => ({
    format: 1,
    id: `m-${id}`,
    tournament: id,
    mode: 'singles',
    players: { a: [entrants[0][0], ''], b: [entrants[1][0], ''] },
    rounds: [],
    final: { a: 13, b: 21 },
    winner: 'b',
    endedAt: 1.7e12,
  });
  const LONG_LOSES = [[LONG], [SHORT]];
  const LONG_WINS = [[SHORT], [LONG]];
  await page.goto(URL);
  await page.evaluate(
    ([tournaments, matches]) => {
      localStorage.clear();
      localStorage.setItem('holecorn.tournaments.v1', JSON.stringify(tournaments));
      localStorage.setItem('holecorn.matches.v1', JSON.stringify(matches));
    },
    [
      [
        cup('mid', 'Middle Cup', 2e12, LONG_LOSES),
        cup('old', 'Oldest Cup', 1e12, LONG_LOSES),
        cup('new', 'Newest Cup', 3e12, LONG_LOSES),
        cup('done-old', 'Old Champion', 1.5e12, LONG_WINS),
        cup('done-new', 'New Champion', 2.5e12, LONG_LOSES),
      ],
      [won('done-old', LONG_WINS), won('done-new', LONG_LOSES)],
    ],
  );
  await page.reload();
  await page.waitForSelector('.setup');
  await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
  await page.waitForSelector('.tournament-list');
  const listed = () =>
    page.locator('.tournament-list').evaluateAll((sections) =>
      sections.map((s) => ({
        heading: s.querySelector('h2').textContent,
        names: [...s.querySelectorAll('.tournament-name')].map((e) => e.textContent),
      })),
    );
  const [progress, completed] = await listed();
  check(
    'In progress runs newest to oldest',
    progress.heading === 'In progress' &&
      progress.names.join(' | ') === 'Newest Cup | Middle Cup | Oldest Cup',
    `${progress.heading}: ${progress.names.join(' | ')}`,
  );
  check(
    'and Completed does too',
    completed.heading === 'Completed' &&
      completed.names.join(' | ') === 'New Champion | Old Champion',
    `${completed.heading}: ${completed.names.join(' | ')}`,
  );

  // Under the winner, in the column the winner is in and on the line the date opened. That
  // placement is the whole point of it — the runner-up reads as belonging to the result
  // above it rather than to the date beside it — and only a browser can see it.
  const beaten = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.tournament-list li')];
    const of = (name) => rows.find((r) => r.textContent.includes(name));
    const geom = (li) => {
      const champ = li.querySelector('.champion-who');
      const runner = li.querySelector('.runner-up-who');
      if (!runner) return { text: null };
      const c = champ.getBoundingClientRect();
      const r = runner.getBoundingClientRect();
      // How far each line falls short of the widest thing on the row's right-hand side —
      // 0 on both when each line reaches the edge, which is the property being asked for.
      const edge = Math.max(c.right, r.right);
      return {
        text: runner.textContent.replace(/\s+/g, ' ').trim(),
        below: Math.round(r.top - c.bottom),
        shortBy: [Math.round(edge - c.right), Math.round(edge - r.right)],
        rowH: Math.round(li.getBoundingClientRect().height),
      };
    };
    return {
      done: geom(of('New Champion')),
      // The same row with the long name on the winning side instead, so the shortfall is
      // measured on the runner-up as well as on the champion.
      reversed: geom(of('Old Champion')),
      running: geom(of('Newest Cup')),
    };
  });
  check(
    'a finished row names who lost the final',
    beaten.done.text === 'Runner-up · AlphaBetaGammaDe',
    JSON.stringify(beaten.done),
  );
  check(
    'directly under the winner',
    beaten.done.below >= 0,
    `below by ${beaten.done.below}px`,
  );
  // Both lines reach the row's right edge, whichever name is longer. A shared caption
  // column was tried and this is what ruled it out: it can only hold the *left* of the two
  // names together, so the shorter one stops short and leaves a gap. Measured on the
  // fixture's own two lines rather than against the card, because the card's padding is
  // not what either is aligned to.
  check(
    'and both lines reach the same right edge, whichever name is longer',
    [...beaten.done.shortBy, ...beaten.reversed.shortBy].every((px) => px <= 1),
    `long loser [${beaten.done.shortBy}], long winner [${beaten.reversed.shortBy}]`,
  );
  // The date already made the row two lines, so this must be free. A third line would show
  // up here and nowhere else.
  check(
    'and costs the row no height, because the date already opened the line',
    beaten.done.rowH === 67,
    `${beaten.done.rowH}px`,
  );
  check(
    'an unfinished row has no runner-up to name',
    beaten.running.text === null,
    JSON.stringify(beaten.running),
  );
  await page.close();
}

console.log('\nevery row says when the tournament happened');
{
  // A cup runs over weeks, so the row carries two facts rather than one, in two shapes:
  // an unfinished one leads with the draw — which is also what both lists are sorted by,
  // so the order explains itself — and a finished one is a span from the draw to the final.
  //
  // Absolute dates, and none of this reads Date.now(): a conditional year would make a
  // check on the text pass by season. See `dates.js`.
  const page = await browser.newPage({ viewport: PHONE });
  page.on('pageerror', (e) => {
    console.log('  PAGE ERROR', e.message);
    failures++;
  });
  // Four entrants where a cup has to survive a tie being played, two where the first tie
  // is the final. Two is not a shortcut here — a two-entrant cup *is* finished after one
  // tie, which is what makes the played-but-unfinished case need its own field.
  const cup = (id, name, createdAt, entrants = [['Rho'], ['Tau']]) => ({
    format: 1,
    id,
    name,
    createdAt,
    mode: 'singles',
    target: 21,
    entrants,
  });
  const won = (id, endedAt) => ({
    format: 1,
    id: `m-${id}`,
    tournament: id,
    mode: 'singles',
    players: { a: ['Rho', ''], b: ['Tau', ''] },
    rounds: [],
    final: { a: 21, b: 13 },
    winner: 'a',
    endedAt,
  });
  await page.goto(URL);
  await page.evaluate(
    ([tournaments, matches]) => {
      localStorage.clear();
      localStorage.setItem('holecorn.tournaments.v1', JSON.stringify(tournaments));
      localStorage.setItem('holecorn.matches.v1', JSON.stringify(matches));
    },
    [
      [
        // A 24-character name, which is what makes the no-clipping check below mean
        // something: it fits at 393px today and an inline date would take it away.
        cup('fresh', 'The Really Long Cup Name', Date.parse('2026-07-28')),
        cup('running', 'Four Entrant Cup', Date.parse('2026-06-02'), [
          ['Rho'],
          ['Tau'],
          ['Phi'],
          ['Chi'],
        ]),
        cup('sameyear', 'Summer Doubles', Date.parse('2025-07-05')),
        cup('crossyear', 'Winter Cup', Date.parse('2025-12-28')),
        cup('oneday', 'Afternoon Cup', Date.parse('2026-05-09T13:00:00')),
        // Drawn and part-played in one afternoon, so its `last played` is redundant the
        // same way the span's second date is. Four entrants, or one tie would finish it.
        cup('onedayopen', 'Half An Afternoon', Date.parse('2026-05-09T13:00:00'), [
          ['Rho'],
          ['Tau'],
          ['Phi'],
          ['Chi'],
        ]),
      ],
      [
        won('sameyear', Date.parse('2025-09-14')),
        won('crossyear', Date.parse('2026-01-03')),
        won('running', Date.parse('2026-07-28')),
        won('oneday', Date.parse('2026-05-09T17:30:00')),
        won('onedayopen', Date.parse('2026-05-09T15:00:00')),
      ],
    ],
  );
  await page.reload();
  await page.waitForSelector('.setup');
  await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
  await page.waitForSelector('.tournament-list');
  const rowFor = (name) =>
    page.locator('.tournament-list li', { hasText: name }).locator('.tournament-row');
  const whenOf = async (name) => (await rowFor(name).locator('.tournament-when').textContent()).trim();

  check(
    'an unfinished cup with nothing played gives the draw date',
    (await whenOf('The Really Long Cup Name')) === 'Drawn 28 Jul 26',
    await whenOf('The Really Long Cup Name'),
  );
  // "Is this one still going?" is the question an unfinished row is actually asked, and
  // the draw date alone cannot answer it.
  check(
    'and gains how recently it was played once a tie is in',
    (await whenOf('Four Entrant Cup')) === 'Drawn 2 Jun 26 · last played 28 Jul',
    await whenOf('Four Entrant Cup'),
  );
  check(
    'a finished cup spans the draw to the final, days and all',
    (await whenOf('Summer Doubles')) === '5 Jul – 14 Sept 25',
    await whenOf('Summer Doubles'),
  );
  // The one case where the year cannot be written once. Nothing else in the fixture would
  // notice the span dropping a year that was doing work.
  check(
    'and carries both years when it crosses one',
    (await whenOf('Winter Cup')) === '28 Dec 25 – 3 Jan 26',
    await whenOf('Winter Cup'),
  );

  // A cup drawn and won in one afternoon, which is the ordinary size of one. Both ends of
  // the span are the same date, and writing it twice with a dash between reads as a fault.
  check(
    'a cup played out in a day is the date once, not a range',
    (await whenOf('Afternoon Cup')) === '9 May 26',
    await whenOf('Afternoon Cup'),
  );
  // The same redundancy on the unfinished shape: the draw date has already said how long
  // ago, so `· last played` adds nothing.
  check(
    'and an unfinished one played the day it was drawn says it once too',
    (await whenOf('Half An Afternoon')) === 'Drawn 9 May 26',
    await whenOf('Half An Afternoon'),
  );

  // The placement, which is the part no unit test can see. Measured, an inline date clips
  // the 24-character name at 393px where it fits today and reads as a second status beside
  // `0 of 1 ties`; on its own line it costs 19px of row height and clips nothing. Asserted
  // as *below the name* rather than by row height, because a taller row is also what a
  // wrapped inline date would give.
  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll('.tournament-row')].map((r) => {
      const name = r.querySelector('.tournament-name');
      const when = r.querySelector('.tournament-when');
      return {
        below: when ? Math.round(when.getBoundingClientRect().top - name.getBoundingClientRect().bottom) : null,
        clipped: [...r.querySelectorAll('.tournament-name, .tournament-when')].filter(
          (n) => n.scrollWidth > n.clientWidth + 0.5,
        ).length,
      };
    }),
  );
  check(
    'the date is on its own line under the name, on every row',
    boxes.length === 6 && boxes.every((b) => b.below !== null && b.below >= 0),
    JSON.stringify(boxes.map((b) => b.below)),
  );
  check(
    'so nothing on the row is clipped, name or date',
    boxes.every((b) => b.clipped === 0),
    JSON.stringify(boxes.map((b) => b.clipped)),
  );
  await page.close();
}

console.log('\nthe stats screen marks which matches were ties');
{
  // The recent list is the tightest thing on that screen: `.recent-teams` is `flex: 1`, so
  // it sits at zero slack by construction and already clips at 393px with long names.
  // Measured, any badge on the row comes straight out of the name — hence a mark inside the
  // row's existing left padding, absolutely positioned, and the detail behind a tap.
  const page = await open();
  await playFirst(page);
  await page.waitForSelector('.setup');
  await winIt(page);
  await page.getByRole('button', { name: 'New game' }).click();
  await page.waitForSelector('.setup');
  // A friendly too, so there is something unmarked to compare against.
  const names = page.locator('.team-name-input');
  await names.nth(0).fill('Kappa');
  await names.nth(1).fill('Zeta');
  await winIt(page);
  await page.getByRole('button', { name: 'New game' }).click();
  await page.waitForSelector('.setup');
  await page.getByRole('button', { name: 'Stats' }).click();
  await page.waitForSelector('.recent');

  const marked = await page.evaluate(() =>
    [...document.querySelectorAll('.recent li')].map((r) => ({
      tie: r.classList.contains('is-tie'),
      teams: r.querySelector('.recent-teams').textContent,
    })),
  );
  check(
    'exactly the tie is marked, and the friendly is not',
    marked.filter((r) => r.tie).length === 1 &&
      marked.some((r) => !r.tie && r.teams.includes('Kappa')),
    marked.map((r) => `${r.tie ? '▌' : ' '}${r.teams}`).join(' | '),
  );
  // A marked row has to say what the mark is — the shaded-nemesis-row lesson. Read through a
  // count first: `textContent()` on a missing element throws, and a mutation that removed the
  // key ended the block instead of naming it. Third time that has bitten in this file.
  const keyText = (await page.locator('.recent-key').count())
    ? (await page.locator('.recent-key').textContent()).trim()
    : null;
  check('and a key says what the mark means', keyText === 'Tournament tie', keyText ?? 'no key drawn');

  // The mark may cost the names nothing, which is the whole reason it is where it is.
  const cost = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.recent li')];
    const tieRow = rows.find((r) => r.classList.contains('is-tie'));
    const plain = rows.find((r) => !r.classList.contains('is-tie'));
    const pad = (r) => getComputedStyle(r.querySelector('.recent-open')).paddingLeft;
    return {
      markPosition: getComputedStyle(tieRow.querySelector('.recent-open'), '::before').position,
      tiePad: pad(tieRow),
      plainPad: pad(plain),
    };
  });
  check(
    'the mark is out of the flow and the padding is untouched',
    cost.markPosition === 'absolute' && cost.tiePad === cost.plainPad,
    `${cost.markPosition}, padding ${cost.tiePad} vs ${cost.plainPad}`,
  );

  // Which tournament and which round is the part a mark cannot carry, so it goes where there
  // is room: the facts line of the expanded match.
  await page.locator('.recent li.is-tie .recent-open').click();
  await page.waitForTimeout(250);
  const facts = (await page.locator('.match-rounds-foot span').first().textContent()).trim();
  check(
    'and opening it names the tournament and the round',
    facts.startsWith('Hole Corn VI · Preliminary'),
    facts,
  );

  // Deleting a tie is the one thing on that screen with a consequence somewhere else: the
  // bracket is derived from the archive, so the tie goes back to being unplayed on a screen
  // the dialog is the last chance to mention. Both directions, because a sentence bolted on
  // unconditionally would read as true here and be a lie on every friendly.
  // Read through a count, this file's standing lesson: `innerText()` on a missing element
  // throws, so a delete that stopped asking would end the run here rather than name it.
  const dialogFor = async (row) => {
    await page.locator(`${row} .match-drop`).click();
    const said = (await page.locator('.modal-body').count())
      ? await page.locator('.modal-body').innerText()
      : null;
    if (said !== null) await page.locator('.modal').getByRole('button', { name: 'Cancel' }).click();
    return said;
  };

  const tieSaid = await dialogFor('.recent li.is-tie');
  check(
    'deleting a tie says the bracket will offer it again',
    Boolean(tieSaid?.includes('Hole Corn VI') && tieSaid.includes('Preliminary') && tieSaid.includes('still to play')),
    tieSaid ?? 'no dialog',
  );

  await page.locator('.recent li:not(.is-tie) .recent-open').click();
  const friendlySaid = await dialogFor('.recent li:not(.is-tie)');
  check(
    'and deleting a friendly claims nothing of the sort',
    friendlySaid !== null && !friendlySaid.includes('still to play'),
    friendlySaid ?? 'no dialog',
  );

  // The claim checked rather than only made, the rule the tournament's own delete dialog
  // already follows.
  await page.getByRole('button', { name: '‹ Back' }).click();
  await page.waitForSelector('.setup');
  await backToBracket(page);
  check('the bracket counts the tie before it goes', (await progress(page)).trim() === '1 of 10 ties');
  await page.getByRole('button', { name: '‹ Back' }).click();
  await page.waitForSelector('.setup');
  await page.getByRole('button', { name: 'Stats' }).click();
  await page.locator('.recent li.is-tie .recent-open').click();
  await page.locator('.recent li.is-tie .match-drop').click();
  await page.locator('.confirm-danger').click();
  await page.getByRole('button', { name: '‹ Back' }).click();
  await page.waitForSelector('.setup');
  await backToBracket(page);
  check(
    'and deleting it really does put it back on the bracket',
    (await progress(page)).trim() === '0 of 10 ties',
    await progress(page),
  );
  await page.close();
}

console.log('\nan ordinary game played alongside a tournament is not a tie');
{
  // The reason the tournament is not an ambient mode: it runs over weeks, and a mode
  // left switched on would file every friendly in between as a tie.
  const page = await open();
  await page.getByRole('button', { name: '‹ Back' }).click();
  await page.waitForSelector('.setup');
  check('setup is not in a tie', (await game(page)).tournament === null);
  const inputs = page.locator('.team-name-input');
  await inputs.nth(0).fill('Omega');
  await inputs.nth(1).fill('Psi');
  await winIt(page);
  const records = await archive(page);
  check('the friendly is archived', records.length === 1);
  check('carrying no tournament at all', records[0].tournament === undefined, `${records[0].tournament}`);
  await page.getByRole('button', { name: 'New game' }).click();
  await backToBracket(page);
  check(
    'and the bracket has not noticed it',
    (await progress(page)).trim() === '0 of 10 ties',
    await progress(page),
  );
  await page.close();
}

console.log('\nthe stats are a tab beside the bracket, and a route crosses between them');
{
  // `entrantStats`, `routeFor` and the rest are pure and unit tested, so nothing here
  // repeats them. What only a browser can see is the **selection crossing the two tabs**:
  // it is held by the row, set by the table and read by the bracket, and each of those
  // three is individually correct however they are wired together. Holding it inside the
  // stats tab instead passes every unit test and lights nothing.
  //
  // Four entrants rather than eleven, so playing the cup out is three ties: a power of two,
  // so there are no bye seats and every lit box is a tie.
  const page = await open(['Rho', 'Tau', 'Sigma', 'Phi']);
  const tab = (name) => page.getByRole('tab', { name });
  const lit = () => page.locator('.tie.is-route').count();

  check('a row opens on the bracket', await settles(() => page.waitForSelector('.bracket-scroll')));
  check(
    'with the Bracket tab selected',
    (await tab('Bracket').getAttribute('aria-selected')) === 'true',
  );
  await tab('Stats').click();
  check(
    'and nothing to count until a tie has been played',
    await settles(() => page.waitForSelector('.tournament-none', { timeout: 3000 })),
  );

  await tab('Bracket').click();
  for (let i = 0; i < 3; i += 1) {
    await playFirst(page);
    await winIt(page);
    await page.getByRole('button', { name: 'New game' }).click();
    await backToBracket(page);
  }

  await tab('Stats').click();
  check('the stats tab draws once there is something in it', await settles(() => page.waitForSelector('.tournament-stats')));
  // The two tabs must be describing the same ties. The row's own header names the champion
  // from `bracket()`; the table's first row names them from `entrantStats`.
  const champion = (await page.locator('.champion-who').textContent()).replace(/^Winner\s*·\s*/, '');
  const top = await page.locator('.stats-table tbody tr').first().evaluate((tr) => ({
    name: tr.querySelector('th button').textContent.trim(),
    reached: tr.querySelector('.entrant-reached').textContent.trim(),
    played: Number(tr.querySelectorAll('td')[1].textContent.trim()),
  }));
  check(
    'and its top row is the champion the row header names',
    top.name === champion.trim() && top.reached === 'Winner',
    `${top.name} / ${top.reached} against ${champion.trim()}`,
  );
  // A cup played through the app has round detail, so the rates are there. The other way
  // round is the block below — both, because either one alone passes with the gate stuck.
  check(
    'a cup played here shows its rates',
    (await page.locator('.stats-table thead th', { hasText: 'PPR' }).count()) === 1,
  );

  await page.locator('.stats-table tbody tr').first().locator('th button').click();
  await tab('Bracket').click();
  check(
    'selecting an entrant lights their route on the other tab',
    await settles(() => page.waitForSelector('.bracket-route', { timeout: 3000 })),
  );
  const caption = (await page.locator('.bracket-route-who').textContent()) ?? '';
  check('the caption names whose route it is', caption.includes(champion.trim()), caption);
  // The lit boxes and the table's own count of their ties have to agree, or the dimming is
  // describing a different route from the one the numbers do.
  check(
    'and lights exactly the ties the table credits them with',
    (await lit()) === top.played && top.played > 0,
    `${await lit()} lit against ${top.played} played`,
  );
  const dimmed = await page.evaluate(() =>
    [...document.querySelectorAll('.tie')]
      .filter((e) => !e.classList.contains('is-route'))
      .map((e) => Number(getComputedStyle(e).opacity)),
  );
  check(
    'everything off the route is faded, and there is something off it',
    dimmed.length > 0 && dimmed.every((o) => o < 1),
    `${dimmed.length} off-route at ${dimmed.join(', ')}`,
  );

  await page.getByRole('button', { name: 'Clear' }).click();
  check('Clear puts the bracket back', (await lit()) === 0, `${await lit()} still lit`);

  // Shut and reopened, a row is back on the bracket with nothing selected — a route is a
  // scope you set while looking, not a setting that outlives the looking.
  await page.locator('.stats-table tbody tr').first().locator('th button').count();
  await tab('Stats').click();
  await page.locator('.stats-table tbody tr').first().locator('th button').click();
  await page.locator('.tournament-row').first().click();
  await page.locator('.tournament-row').first().click();
  check(
    'reopening a row is back on the bracket with no route',
    (await tab('Bracket').getAttribute('aria-selected')) === 'true' && (await lit()) === 0,
    `${await lit()} lit`,
  );
  await page.close();
}

console.log('\na tournament with no round detail shows its results and no rates');
{
  // The case decision 11 of docs/TOURNAMENT.md produces: a past tournament reached by
  // tagging records that were already in the archive, imported from a written-down score.
  // Every rate is unknowable, and a column of dashes reads as a fault rather than as a
  // limitation — so the columns go and the screen says why. Nothing hermetic can see this:
  // `hasRounds` is unit tested and `entrantStats` returns the same rows either way.
  const page = await browser.newPage({ viewport: PHONE });
  page.on('pageerror', (e) => {
    console.log('  PAGE ERROR', e.message);
    failures++;
  });
  await page.goto(URL);
  await page.waitForSelector('.setup');
  const sides = [['Rho'], ['Tau'], ['Sigma'], ['Phi']];
  const record = (id, a, b, final, endedAt) => ({
    format: 1,
    id,
    tournament: 'old-cup',
    mode: 'singles',
    players: { a: [a, ''], b: [b, ''] },
    colors: { a: '#2f80ed', b: '#eb5757' },
    target: 21,
    winner: final.a > final.b ? 'a' : 'b',
    final,
    rounds: [],
    endedAt,
  });
  await page.getByRole('button', { name: 'Stats' }).click();
  await page.setInputFiles('input[type=file]', {
    name: 'old.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        format: 1,
        tournaments: [
          {
            format: 1,
            id: 'old-cup',
            name: 'Hole Corn IV',
            createdAt: 1,
            mode: 'singles',
            target: 21,
            entrants: sides,
          },
        ],
        matches: [
          record('o1', 'Rho', 'Tau', { a: 21, b: 4 }, 1000),
          record('o2', 'Sigma', 'Phi', { a: 21, b: 18 }, 2000),
          record('o3', 'Rho', 'Sigma', { a: 21, b: 12 }, 3000),
        ],
      }),
    ),
  });
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: '‹ Back' }).click();
  await page.waitForSelector('.setup');
  await page.locator('.setup-links button').first().click();
  await page.waitForSelector('.tournament-list');
  await page.locator('.tournament-row').first().click();
  await page.getByRole('tab', { name: 'Stats' }).click();
  check('its stats draw', await settles(() => page.waitForSelector('.tournament-stats')));
  // Compared upper case: the headings are `text-transform`ed, and `allInnerTexts` returns
  // what is drawn rather than what the JSX says.
  const heads = await page.locator('.stats-table thead th').allInnerTexts();
  check(
    'the rate columns are gone, and the result ones are not',
    !heads.includes('PPR') && heads.includes('W–L') && heads.includes('REACHED'),
    heads.join(', '),
  );
  check(
    'and it says why rather than showing a column of dashes',
    (await page.locator('.tournament-note').count()) === 1,
  );
  // Read off the scores, which is the one thing these records do carry, so the pair of them
  // is what the tab has to say about how the games went.
  const extremes = await page.locator('.tie-extremes li').allInnerTexts();
  check(
    'both ends of the spread are named from the scores alone',
    extremes.length === 2 &&
      extremes[0].includes('21–4') &&
      extremes[1].includes('21–18'),
    extremes.join(' | '),
  );
  await page.close();
}

console.log('\na tournament whose sheet is gone');
{
  // The result and nothing else — `recordedTournament`, which only a file can produce.
  // `bracket()` is unit tested, so what is left for a browser is the one thing those
  // tests are blind to: the list drops a tournament whose bracket comes back null, so a
  // shape it cannot read **does not appear at all**. There is no error and no empty row.
  const page = await browser.newPage({ viewport: PHONE });
  page.on('pageerror', (e) => {
    console.log('  PAGE ERROR', e.message);
    failures++;
  });
  await page.goto(URL);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem(
      'holecorn.tournaments.v1',
      JSON.stringify([
        {
          format: 1,
          id: 'hc1',
          name: 'Hole Corn I',
          // 30 August 2019, the only date such a tournament has.
          createdAt: new Date(2019, 7, 30, 12).getTime(),
          champion: ['Rho'],
          runnerUp: ['Tau'],
        },
      ]),
    );
  });
  await page.reload();
  await page.waitForSelector('.setup');
  await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
  check('it is listed at all', await settles(() => page.waitForSelector('.tournament-row')));
  // Upper case: the headings are `text-transform`ed and `allInnerTexts` returns what is
  // drawn rather than what the JSX says. Caught here for the second time in this file.
  const heading = await page.locator('.tournament-list h2').allInnerTexts();
  check('under Completed rather than In progress', heading.join() === 'COMPLETED', heading.join());
  const row = (sel) => page.locator(sel).innerText();
  check('the winner is named', (await row('.champion-who')).includes('Rho'), await row('.champion-who'));
  check(
    'and the runner-up, which is optional but was remembered here',
    (await row('.runner-up-who')).includes('Tau'),
    await row('.runner-up-who'),
  );
  // One date, and it is the final's — so there is no span to draw and no draw to name.
  // `Drawn` is what the unfinished shape says, and it would be claiming a draw nobody took.
  check('the date says it was won, not drawn', (await row('.tournament-when')).startsWith('Won'), await row('.tournament-when'));

  await page.locator('.tournament-row').click();
  check('opening it draws no bracket', (await page.locator('.bracket').count()) === 0);
  check('and no tabs over an empty one', (await page.locator('.tournament-tabs').count()) === 0);
  check(
    'it says what it is instead',
    (await page.locator('.recorded-note').count()) === 1 &&
      (await row('.recorded-note')).includes('only the result'),
  );
  // The other half of the block below: with nobody remembered but the two finalists there
  // is no field to list, and `view.entrants` holds them both — so a list gated on the
  // entrants rather than on `fieldKnown` would draw `Took part · Rho · Tau` here, which
  // reads as the whole of who was there and is a claim nothing in the file made.
  check('and lists no field, because none was recorded', (await page.locator('.recorded-field').count()) === 0);
  // Delete has to be reachable, which is the whole reason the row still opens — and the
  // ordinary dialog would promise that its played ties stay in the archive, which is
  // false here because there are none.
  await page.locator('.tournament-drop').click();
  const said = await page.locator('.modal-body').innerText();
  check('the dialog does not promise ties it has not got', !said.includes('tie'), said);
  await page.locator('.confirm-danger').click();
  check('and it goes', (await page.locator('.tournament-row').count()) === 0);
  await page.close();
}

console.log('\na sheet that is gone but a field that is remembered');
{
  // The same shape with `field` filled in, which is the only thing about such a tournament
  // that is not the result. Its own page and its own fixture rather than a second row in
  // the block above, which queries `.tournament-row` and `.recorded-note` unscoped — the
  // strict-mode trap this file has already been bitten by twice.
  //
  // `storedResult` and `fieldKnown` are unit tested, so what is left for a browser is the
  // crossing: the row draws `view.entrants` rather than the two names it already has in
  // hand. Verified by mutation — listing `[champion, runnerUp]` instead loses Neil and
  // Sigma, and gating the list on `recorded` instead of `fieldKnown` fails the absence
  // assertion in the block above.
  const page = await browser.newPage({ viewport: PHONE });
  page.on('pageerror', (e) => {
    console.log('  PAGE ERROR', e.message);
    failures++;
  });
  await page.goto(URL);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem(
      'holecorn.tournaments.v1',
      JSON.stringify([
        {
          format: 1,
          id: 'hc2',
          name: 'Hole Corn II',
          createdAt: new Date(2020, 7, 29, 12).getTime(),
          champion: ['Rho'],
          runnerUp: ['Tau'],
          // Two who reached the final and two who did not, which is the whole point: the
          // pair with nothing on the trophy are the ones a result-only tournament loses.
          field: [['Neil'], ['Rho'], ['Sigma'], ['Tau']],
        },
      ]),
    );
  });
  await page.reload();
  await page.waitForSelector('.setup');
  await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
  check('it is listed', await settles(() => page.waitForSelector('.tournament-row')));
  await page.locator('.tournament-row').click();
  check('opening it still draws no bracket', (await page.locator('.bracket').count()) === 0);
  const took = await page.locator('.recorded-who').allInnerTexts();
  check(
    'everyone who took part is named, not only the two on the trophy',
    took.join(' ') === 'Neil Rho Sigma Tau',
    took.join(' | '),
  );
  check(
    'and the note says so rather than claiming the result is all there is',
    (await page.locator('.recorded-note').innerText()).includes('who took part'),
    await page.locator('.recorded-note').innerText(),
  );
  await page.close();
}

// The editions of a cup played again each year, grouped. `groupBySeries`, `seriesStats` and
// `nextEditions` are pure and unit tested against exactly these fixtures, so what is left
// for a browser is the wiring: that the screen draws a section at all, that it draws one
// only where there is more than one edition, and — the one this block exists for — that the
// name the draw form is *handed* is a name the draw form will *accept*.
//
// Seeded rather than played: four editions is four draws and eleven ties through the UI,
// and none of that is what is under test.
//
// **Verified by mutation**, and each fails only its own assertions: a suggestion that
// ignores the names already taken (the four prefill checks), a series section that never
// appears (the two that say one does), the holder read off the oldest decided edition rather
// than the newest, honours drawn oldest first, a recorded edition contributing no entrants,
// and the name cell losing its padding.
//
// One mutation is caught somewhere else entirely and is worth knowing about: treating a cup
// played **once** as a series ends the run in an *existing* block a thousand lines above
// this, because every one-tournament fixture then grows a second section and
// `.tournament-list h2` resolves to two elements. That is why the same mutation is done here
// as "no series is ever a section" instead — no other block seeds two editions of one
// series, so raising the threshold touches only these checks. The two directions are
// asserted separately either way: one heading is `Series` and the other `Completed` in the
// same run, so neither can pass by the helper simply always agreeing.
function series() {
  localStorage.clear();
  const cup = (id, name, createdAt) => ({
    format: 1,
    id,
    name,
    createdAt,
    mode: 'singles',
    target: 26,
    entrants: [['Rho'], ['Tau'], ['Sigma'], ['Phi']],
  });
  localStorage.setItem(
    'holecorn.tournaments.v1',
    JSON.stringify([
      // No field at all — the shape a tournament played before the app takes. It is here
      // because a stored series id could never have reached it: `recordedTournament` keeps
      // no field to hang one on, so grouping by name is the only thing that can.
      {
        format: 1,
        id: 'hc1',
        name: 'Hole Corn I',
        createdAt: Date.parse('2021-07-10'),
        // Neither plays in IV or V, deliberately: they are then the only entrants in the
        // series with no ties anywhere behind them, which is the row the dash is for.
        champion: ['Omega'],
        runnerUp: ['Iota'],
      },
      cup('hc4', 'Hole Corn IV', Date.parse('2024-05-02')),
      cup('hc5', 'Hole Corn V', Date.parse('2025-06-06')),
      // A one-off, so the section must not list it: a `Series` heading over a single
      // edition says nothing, and it is already a row in the lists either side.
      cup('sc1', 'Summer Cup', Date.parse('2023-08-01')),
    ]),
  );
  let n = 0;
  const tie = (tournament, a, b, winner, when) => {
    n += 1;
    return {
      format: 1,
      id: `m${n}`,
      tournament,
      mode: 'singles',
      players: { a: [a, ''], b: [b, ''] },
      rounds: [],
      final: winner === 'a' ? { a: 26, b: 13 } : { a: 13, b: 26 },
      winner,
      endedAt: Date.parse(when),
    };
  };
  localStorage.setItem(
    'holecorn.matches.v1',
    JSON.stringify([
      // IV won by Rho, V won by Tau — two different champions, so a column that reported
      // the same name for every edition would show.
      tie('hc4', 'Rho', 'Tau', 'a', '2024-05-02'),
      tie('hc4', 'Sigma', 'Phi', 'a', '2024-05-03'),
      tie('hc4', 'Rho', 'Sigma', 'a', '2024-05-09'),
      tie('hc5', 'Rho', 'Tau', 'b', '2025-06-06'),
      tie('hc5', 'Sigma', 'Phi', 'b', '2025-06-07'),
      tie('hc5', 'Tau', 'Phi', 'a', '2025-06-14'),
      tie('sc1', 'Rho', 'Tau', 'a', '2023-08-01'),
      tie('sc1', 'Sigma', 'Phi', 'a', '2023-08-02'),
      tie('sc1', 'Rho', 'Sigma', 'a', '2023-08-03'),
    ]),
  );
}

async function seeded() {
  const page = await browser.newPage({ viewport: PHONE });
  page.on('pageerror', (e) => {
    console.log('  PAGE ERROR', e.message);
    failures++;
  });
  await page.goto(URL);
  await page.evaluate(series);
  await page.reload();
  await page.waitForSelector('.setup');
  await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
  await page.waitForSelector('.tournament-list');
  return page;
}

// The heading of the section a row sits in, which is the whole of "did it group".
const sectionOf = (page, name) =>
  page.evaluate((wanted) => {
    for (const section of document.querySelectorAll('.tournament-list')) {
      const rows = [...section.querySelectorAll(':scope > ul > li .tournament-name')];
      if (rows.some((r) => r.textContent === wanted)) return section.querySelector('h2')?.textContent;
    }
    return null;
  }, name);

console.log('\nevery edition of a cup is grouped into one series');
{
  const page = await seeded();
  check('a cup played more than once gets a section', (await sectionOf(page, 'Hole Corn')) === 'Series');
  // The absence half, and it needs asserting separately: a filter stuck open puts a
  // one-edition heading over every cup ever played, which looks like a feature rather
  // than a fault. Summer Cup is still *listed* — just not as a series.
  check(
    'a cup played once is not one',
    (await sectionOf(page, 'Summer Cup')) === 'Completed',
    await sectionOf(page, 'Summer Cup'),
  );
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('.tournament-list')]
      .filter((s) => s.querySelector('h2')?.textContent === 'Series')
      .flatMap((s) => [...s.querySelectorAll(':scope > ul > li .tournament-name')])
      .map((r) => r.textContent),
  );
  check('and there is exactly one series here, not one per edition', rows.length === 1, JSON.stringify(rows));

  // The holder is the champion of the newest *decided* edition, which is V and not IV —
  // so reading the oldest, or reading whichever the archive happened to hold first, gives
  // Rho and fails here.
  const shut = await page.locator('.tournament-list').filter({ hasText: 'Series' }).locator('.tournament-row').first();
  const holder = (await shut.locator('.series-holder').innerText()).replace(/\s+/g, ' ');
  check('the row names who holds it', holder === 'HOLDER · Tau', holder);
  const when = await shut.locator('.tournament-when').innerText();
  check('and how many editions it has run to, over what span', when.startsWith('3 editions ·'), when);

  await shut.click();
  check('it opens onto the roll of honour', await settles(() => page.waitForSelector('.honours', { timeout: 3000 })));
  // Newest first, and every edition of the series — including the one with no field,
  // which is the retroactive half of the whole feature.
  const honours = await page.evaluate(() =>
    [...document.querySelectorAll('.honours li')].map((li) => [
      li.querySelector('.honours-edition')?.textContent,
      li.querySelector('.honours-what')?.innerText.replace(/\s+/g, ' '),
    ]),
  );
  check(
    'which is every edition, newest first',
    JSON.stringify(honours.map((h) => h[0])) === JSON.stringify(['Hole Corn V', 'Hole Corn IV', 'Hole Corn I']),
    JSON.stringify(honours.map((h) => h[0])),
  );
  check(
    'and names both finalists of each',
    honours[0][1].startsWith('Tau beat Phi') && honours[2][1].startsWith('Omega beat Iota'),
    JSON.stringify(honours.map((h) => h[1])),
  );

  // The figure one bracket structurally cannot produce: Rho entered three editions across
  // five years. Inside any one of them the number is 1.
  const table = await page.evaluate(() =>
    [...document.querySelectorAll('.series-stats .stats-table tbody tr')].map((tr) =>
      [...tr.children].map((c) => c.innerText.trim()),
    ),
  );
  // Two editions, one of them won, and a tie record of 2–1 spanning two years: two ties
  // won in IV and one lost in V. Every one of those numbers is 1 or 0 inside either
  // bracket on its own, which is the point of the panel.
  const rho = table.find((r) => r[0] === 'Rho');
  check(
    'the table counts a career across the series',
    JSON.stringify(rho) === JSON.stringify(['Rho', '2', '1', '2–1']),
    JSON.stringify(rho),
  );
  // Somebody known only from an edition whose sheet is gone has no ties the archive can
  // see, which is not the same as having played none — `0–0` would be a claim. They are
  // in the table at all only because the champion of a recorded result is remembered.
  const omega = table.find((r) => r[0] === 'Omega');
  check(
    'and does not report a missing sheet as a nil record',
    JSON.stringify(omega) === JSON.stringify(['Omega', '1', '1', '—']),
    JSON.stringify(omega),
  );
  // Hole Corn I here remembers neither its field nor anything but its two finalists, so
  // every `entered` in the table is short by however many entered it and lost early. The
  // caption is what stops that reading as a fact; scoped, because an open tournament row
  // carries a `.tournament-note` of its own.
  check(
    'and captions a count it knows is short',
    (await page.locator('.series-stats .tournament-note').count()) === 1,
  );

  // The table has to fit a phone without sideways scrolling, which is why it carries
  // neither a `P` column nor `Finals`. Measured rather than assumed: the career table
  // deliberately does overflow, so nothing else here would notice this one starting to.
  const spill = await page.evaluate(() => {
    const el = document.querySelector('.series-stats .stats-scroll');
    return el ? el.scrollWidth - el.clientWidth : -1;
  });
  check('and it fits a phone with nothing scrolled off', spill === 0, `${spill}px over`);

  // `.stats-table tbody th` gives its padding up to the `.player-select` button inside it,
  // on the career table. This table has no button — there is nothing here to select — so
  // without a rule putting the padding back the name sits hard against the cell edge.
  // Nothing else would notice: the table still lays out, and every number in it is right.
  const pad = await page.evaluate(() => {
    const th = document.querySelector('.series-stats .stats-table tbody th');
    return th ? parseFloat(getComputedStyle(th).paddingLeft) : -1;
  });
  check('and its names are not jammed against the cell edge', pad >= 8, `${pad}px`);

  // One thing open at a time across the whole screen, which is what the prefixed key in
  // `openId` is for — a series and a tournament sharing one piece of state.
  await page.locator('.tournament-list').filter({ hasText: 'Completed' }).locator('.tournament-row').first().click();
  check('opening a tournament shuts the series', (await page.locator('.honours').count()) === 0);
  await page.close();
}

console.log('\nthe form panel before a tie counts the series, not the career');
{
  // `seriesHistory` is pure and unit tested, and `Lineup` folds whatever pool it is handed
  // — so both are right whichever matches `App.jsx` hands over. This is the crossing, and
  // it is the shape of fault this whole file exists for.
  //
  // The fixture is built so that **every wrong pool gives a different number**, which is
  // what makes the assertion able to fail: Rho is 2–1 across the series (two ties won in
  // IV, one lost in V), 4–1 if the Summer Cup's ties are swept in with them, and 7–1 over
  // the whole archive once three friendlies are counted. A record of 2–1 can only have
  // come from the series.
  //
  // Verified by mutation — handing `Lineup` the archive again fails the two record
  // assertions and **not the heading**, which is right and is why the numbers are checked
  // rather than the caption: the name comes from the derivation and the rows from the
  // pool, so a heading naming the cup proves nothing about what is under it.
  //
  // What this cannot see is the *board's* copy of the same panel, which needs a broker —
  // see `verify-form-screen.mjs`. `App.jsx` hands both surfaces one `formMatches`, so
  // there is nothing there to drift; splitting it into two expressions is what would need
  // a check nothing in CI can run.
  const page = await seeded();
  await page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem('holecorn.tournaments.v1'));
    // A sixth edition, drawn and unplayed, so there is a tie to pick — and no ties of its
    // own, which is also the case that matters: the panel has to reach *back* through the
    // series to have anything to say at all.
    list.push({
      format: 1,
      id: 'hc6',
      name: 'Hole Corn VI',
      createdAt: Date.parse('2026-07-01'),
      mode: 'singles',
      target: 26,
      entrants: [['Rho'], ['Tau'], ['Sigma'], ['Phi']],
    });
    localStorage.setItem('holecorn.tournaments.v1', JSON.stringify(list));
    const matches = JSON.parse(localStorage.getItem('holecorn.matches.v1'));
    // Friendlies, carrying no tournament at all. They are what separate the career from
    // the series, and Rho wins all three so the two records cannot coincide.
    for (const n of [1, 2, 3]) {
      matches.push({
        format: 1,
        id: `f${n}`,
        mode: 'singles',
        players: { a: ['Rho', ''], b: ['Phi', ''] },
        rounds: [],
        final: { a: 26, b: 13 },
        winner: 'a',
        endedAt: Date.parse(`2026-06-0${n}`),
      });
    }
    localStorage.setItem('holecorn.matches.v1', JSON.stringify(matches));
  });
  await page.reload();
  await page.waitForSelector('.setup');
  await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
  await page.locator('.tournament-list').filter({ hasText: 'In progress' }).locator('.tournament-row').first().click();
  if (!(await settles(() => page.waitForSelector('.bracket-scroll', { timeout: 5000 })))) {
    check('the unplayed edition opens on its bracket', false);
  }
  await playFirst(page);
  const panel = await settles(() => page.waitForSelector('.lineup', { timeout: 5000 }));
  check('the tie lands on a setup screen with a form panel', panel);
  // `textContent`, not `innerText`: the heading is uppercased in CSS, and the rendered
  // text would compare against a string nobody wrote.
  const title = panel ? await page.locator('.lineup-title').textContent() : '';
  check('which names the series it is counting', title === 'Form in Hole Corn', title);
  const row = async (name) =>
    page.evaluate((who) => {
      const tr = [...document.querySelectorAll('.lineup-table tbody tr')].find(
        (x) => x.querySelector('.lineup-name')?.textContent === who,
      );
      return tr ? [...tr.querySelectorAll('td')][0]?.textContent : null;
    }, name);
  const rho = panel ? await row('Rho') : null;
  check('and the record is the series’, not the career', rho === '2–1', String(rho));
  // The head-to-head line has to come from the same pool as the rows under it. Rho leads
  // Tau 2–1 over everything and 1–1 within the series, so a line left on the archive shows
  // here even with the table already scoped.
  const record = panel ? (await page.locator('.lineup-record').innerText()).replace(/\s+/g, ' ') : '';
  check('as is the head to head above it', record === 'Rho 1–1 Tau', record);

  // The other direction, and it needs asserting: scoping stuck on would leave an ordinary
  // game reading a cup's history under a heading naming a cup nobody is playing in.
  // `Play something else` puts the same two names back into a friendly, so nothing changes
  // but the tie-ness.
  await page.locator('.tie-leave').click();
  await page.waitForFunction(
    () => document.querySelector('.lineup-title')?.textContent === 'Form',
    null,
    { timeout: 5000 },
  ).catch(() => {});
  check('and an ordinary game goes back to the whole archive', (await row('Rho')) === '7–1', String(await row('Rho')));
  await page.close();
}

console.log('\nthe draw form offers the next edition, and offers one it will accept');
{
  const page = await seeded();
  // A sixth edition already exists and is dated *before* the fifth, so the series' newest
  // edition is still V and the obvious next name is one the form would refuse. That is not
  // contrived: `import-legacy.mjs` dates a reconstructed tournament by its earliest tie, so
  // a sheet transcribed years later lands wherever its ties say rather than in numerical
  // order. **Without it this block's last assertion cannot fail** — the suggestion would
  // never collide, so a step that ignored the names already taken would pass it.
  await page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem('holecorn.tournaments.v1'));
    list.push({
      format: 1,
      id: 'hc6',
      name: 'Hole Corn VI',
      createdAt: Date.parse('2020-01-01'),
      mode: 'singles',
      target: 26,
      entrants: [['Rho'], ['Tau']],
    });
    localStorage.setItem('holecorn.tournaments.v1', JSON.stringify(list));
  });
  await page.reload();
  await page.waitForSelector('.setup');
  await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
  await page.getByRole('button', { name: 'New tournament' }).click();
  await page.waitForSelector('.draw');
  const chips = await page.locator('.draw-next .roster-chip').allInnerTexts();
  // VII rather than VI: V is the newest edition and it is finished, so the step starts
  // there, and VI is taken. `Summer Cup II` is offered too — a cup played once is still a
  // series of one to the form, even though it is not one to the section above.
  check('the next edition is offered by name', chips.includes('Hole Corn VII'), JSON.stringify(chips));

  // Reported rather than thrown, the rule every wait in this file follows. A mutation that
  // changes which name is offered leaves this click matching nothing, and a bare `.click()`
  // then ends the whole run with a stack trace instead of failing the two assertions under
  // it — which is the lesson this file has already recorded three times.
  const tapped = await settles(() =>
    page.locator('.draw-next .roster-chip', { hasText: 'Hole Corn VII' }).click({ timeout: 4000 }),
  );
  check('tapping it names the tournament', tapped && (await page.locator('.draw-name input').inputValue()) === 'Hole Corn VII');
  // The terms come with it. 26 rather than the app's default 21, so a chip that filled
  // only the name would fail here rather than passing by coincidence.
  check(
    'and carries the terms the last one was played on',
    (await page.locator('.draw-target input').inputValue()) === '26',
    await page.locator('.draw-target input').inputValue(),
  );

  // **The assertion this block exists for.** `nextEditions` and the form's duplicate rule
  // are each correct alone, and only their pairing can be wrong: a suggestion that landed
  // on a name already taken would fill three boxes and then leave `Make the draw` off with
  // a red hint, which is a button that breaks the form it is meant to fill in.
  await page.getByRole('button', { name: 'Select all' }).click();
  const off = await page.locator('.draw-go').isDisabled();
  const hint = (await page.locator('.draw-hint').count()) ? await page.locator('.draw-hint').innerText() : '';
  check('and the form accepts the name it was handed', off === false, hint);
  await page.close();
}

// A career rename has to reach the draw as well as the archive. `renameEntrant` and
// `renamePlayer` are each pure and unit tested; only `Stats.jsx`'s handler joins them
// up, and with either half missing the bracket stops finding the ties that person
// played — a finished cup reappears as in progress with a null champion, and the tie
// it has already lost becomes playable again.
{
  console.log('\na career rename carries the draw with it');
  const page = await open(['Rho', 'Tau', 'Sigma', 'Phi']);
  // Three ties: two semi-finals and the final. `New game` is what gets off the won play
  // screen and back to setup, from where the Tournaments button exists.
  for (let i = 0; i < 3; i += 1) {
    if (i > 0) await backToBracket(page);
    await playFirst(page);
    await winIt(page);
    await page.getByRole('button', { name: 'New game' }).click();
    await page.waitForSelector('.setup');
  }
  await backToBracket(page);

  const wonBy = await textOf(page.locator('.champion-who').first(), '');
  check('the cup finishes with a champion', /Rho|Tau|Sigma|Phi/.test(wonBy), wonBy || '(none)');
  const champion = (wonBy.match(/Rho|Tau|Sigma|Phi/) ?? [''])[0];
  const before = await playable(page);
  check('and nothing is left to play', before === 0, `${before} playable`);

  await page.getByRole('button', { name: '‹ Back' }).click();
  await page.getByRole('button', { name: 'Stats', exact: true }).click();
  await page
    .locator('.stats-table tbody tr', { hasText: champion })
    .locator('.player-select')
    .click();
  await page.getByRole('button', { name: `Rename ${champion}`, exact: true }).click();
  await page.locator('.rename-input').fill(`${champion} P`);
  await page.locator('.modal').getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByRole('button', { name: '‹ Back' }).click();
  await backToBracket(page);

  const after = await textOf(page.locator('.champion-who').first(), '');
  check('the cup is still finished afterwards', after.includes(`${champion} P`), after || '(none)');
  check('and no tie has come back to life', (await playable(page)) === 0, `${await playable(page)} playable`);
  check(
    'the draw itself carries the new spelling',
    await page.evaluate((name) => {
      const list = JSON.parse(localStorage.getItem('holecorn.tournaments.v1') || '[]');
      return list.every((t) => !JSON.stringify(t.entrants).includes(`"${name}"`));
    }, champion),
  );
  await page.close();
}

// A draw that cannot be stored must not be announced. `saveTournaments` used to catch
// the quota error and hand the list straight back, and `App.jsx` set React state from
// it — so the ceremony played out, the bracket came up playable, and the cup had never
// existed. Reload and it was gone, with nothing having said so. Nothing below `App.jsx`
// can see this: `saveTournaments` and the screen are each correct on their own.
{
  console.log('\na draw that cannot be stored is refused, not announced');
  const stuck = await browser.newContext();
  await stuck.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function blocked(key, value) {
      if (key === 'holecorn.tournaments.v1') throw new DOMException('quota', 'QuotaExceededError');
      return setItem.call(this, key, value);
    };
  });
  const page = await stuck.newPage({ viewport: PHONE });
  page.on('pageerror', (e) => {
    console.log('  PAGE ERROR', e.message);
    failures++;
  });
  await page.goto(URL);
  await page.waitForSelector('.setup');
  await page.getByRole('button', { name: 'Tournaments', exact: true }).click();
  await page.getByRole('button', { name: 'New tournament' }).click();
  await page.locator('.draw-name input').fill('Quota Cup');
  for (let i = 0; i < 4; i += 1) {
    await page.getByRole('button', { name: 'Add new entrant' }).click();
  }
  for (const [i, n] of ['Rho', 'Tau', 'Sigma', 'Phi'].entries()) {
    await page.locator('.entrant-name').nth(i).fill(n);
  }
  await page.locator('.draw-go').click();
  await page.waitForTimeout(300);

  check('no ceremony is played out for a draw that was not saved', (await page.locator('.ceremony').count()) === 0);
  check('and no bracket is drawn', (await page.locator('.bracket-scroll').count()) === 0);
  check(
    'the form stays open with the field intact',
    (await page.locator('.draw').count()) === 1 &&
      (await page.locator('.entrant-name').nth(0).inputValue()) === 'Rho',
  );
  check(
    'and says why',
    (await page.locator('.draw-hint').count()) > 0 &&
      (await page.locator('.draw-hint').innerText()).includes('no room'),
    (await page.locator('.draw-hint').count()) ? await page.locator('.draw-hint').innerText() : 'no hint',
  );
  const stored = await page.evaluate(() => localStorage.getItem('holecorn.tournaments.v1'));
  check('and nothing was stored', stored === null || JSON.parse(stored).length === 0, String(stored));
  await stuck.close();
}

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nall tournament checks passed');
process.exit(failures ? 1 : 0);
