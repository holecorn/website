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
// mutation, where a dead `Leave tie` button killed the run at the third of seven
// blocks. Same lesson as verify-positions.mjs and verify-stats.mjs.
const settles = (fn) => fn().then(() => true, () => false);

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
  for (let i = 2; i < names.length / fields; i += 1) {
    await page.getByRole('button', { name: 'Add entrant' }).click();
  }
  for (const [i, n] of names.entries()) await page.locator('.entrant-name').nth(i).fill(n);
  await page.locator('.draw-go').click();
  // The one just drawn opens itself, so the bracket is on screen without a tap.
  await page.waitForSelector('.bracket-scroll');
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
    await page.waitForFunction(() => document.querySelector('.end-round')?.disabled === true, null, {
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

console.log('the draw builds the bracket the paper sheet has');
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
        .filter((e) => /name|entrant/i.test(e.getAttribute('aria-label') || '') || e.list)
        .map((e) => ({
          label: (e.getAttribute('aria-label') || e.className).slice(0, 40),
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

console.log('\nthe roster enters people by tapping rather than typing');
{
  // Typing eleven names the app already holds is the real cost of setting a tournament
  // up. The chips are a toggle, so they double as the answer to who is in so far.
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

  const rows = () => page.locator('.entrant-name').evaluateAll((e) => e.map((x) => x.value));
  check('a chip per archived name', (await page.locator('.roster-chip').count()) === 11);
  check('none lit to begin with', (await page.locator('.roster-chip.is-on').count()) === 0);

  for (const name of ELEVEN) await page.getByRole('button', { name, exact: true }).click();
  check(
    'tapping them all enters the field in tap order',
    JSON.stringify(await rows()) === JSON.stringify(ELEVEN),
    JSON.stringify(await rows()),
  );
  check('every chip is lit', (await page.locator('.roster-chip.is-on').count()) === 11);
  check(
    'and the draw is ready with no typing at all',
    await page.locator('.draw-go').isEnabled(),
  );

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
  check('which is a bracket of one tie', (await page.locator('.draw-note').innerText()).includes('1 ties') || (await page.locator('.draw-note').innerText()).includes('2 entrants'), (await page.locator('.draw-note').innerText()).trim());
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
  await page.getByRole('button', { name: 'Leave tie' }).click();
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
  await page.locator('.draw-target input').fill('5000');
  await page.waitForTimeout(150);
  const shown = await page.locator('.draw-target input').inputValue();
  check('a silly target is clamped as it is typed', Number(shown) === 99, shown);
  for (const [i, n] of ['Rho', 'Tau'].entries()) {
    await page.locator('.entrant-name').nth(i).fill(n);
  }
  await page.locator('.draw-go').click();
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
  // the game has to be put down first. The undo made it unfinished again, so this is
  // the path that asks first — `New game` only confirms while a game is in progress.
  await page.getByRole('button', { name: 'New game' }).click();
  await page.locator('.modal').getByRole('button', { name: 'New game' }).click();
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
  // A fresh tournament's live ties are in the outermost round, so a fresh one cannot tell
  // this apart from opening at zero — verified by mutation, pinning `startAt` to 0 passed.
  // The sample fixture's Hole Corn VI is 5 of 9 played, so its live ties are a round in.
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
  const red = await drop.evaluate((e) => {
    const s = getComputedStyle(e);
    return { colour: s.color, border: s.borderTopColor };
  });
  check(
    'the button is red',
    red.colour === 'rgb(235, 87, 87)' && red.border === 'rgb(235, 87, 87)',
    `${red.colour} on ${red.border}`,
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
  await page.locator('.draw-name input').fill('Doubles Cup');
  for (const [i, n] of ['Chi', 'Psi', 'Omega', 'Iota'].entries()) {
    if (i > 1) await page.getByRole('button', { name: 'Add entrant' }).click();
    await page.locator('.entrant-name').nth(i).fill(n);
  }
  await page.locator('.draw-go').click();
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
  const cup = (id, name, createdAt) => ({
    format: 1,
    id,
    name,
    createdAt,
    mode: 'singles',
    target: 21,
    entrants: [['Rho'], ['Tau']],
  });
  // A tie for a cup is what finishes it, so these two land under Completed.
  const won = (id) => ({
    format: 1,
    id: `m-${id}`,
    tournament: id,
    mode: 'singles',
    players: { a: ['Rho', ''], b: ['Tau', ''] },
    rounds: [],
    final: { a: 21, b: 13 },
    winner: 'a',
    endedAt: 1.7e12,
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
        cup('mid', 'Middle Cup', 2e12),
        cup('old', 'Oldest Cup', 1e12),
        cup('new', 'Newest Cup', 3e12),
        cup('done-old', 'Old Champion', 1.5e12),
        cup('done-new', 'New Champion', 2.5e12),
      ],
      [won('done-old'), won('done-new')],
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

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nall tournament checks passed');
process.exit(failures ? 1 : 0);
