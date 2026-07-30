// Verifies the pre-game form screen end to end over a real broker: that a
// retained lineup puts both consumers on the form screen, that it overrides the
// chosen score layout rather than combining with it, and — the part that would
// otherwise strand a board for a whole game — that clearing the topic puts them
// back on the score.
//
//   npm run dev, then: node tools/verify-form-screen.mjs
//
// Deliberately **not** in `npm run test:browser`, for the same reason
// verify-winner-flash.mjs isn't: it needs a third party, and a deploy should not
// fail because someone else's broker is down. What can be checked without one is:
// the payload and the clear in src/scoreboard.test.js, the retain-and-re-assert
// behaviour against a fake client in src/scoreboardLink.test.js, and the drawing
// itself in `npm run test:firmware`, which holds the panel's framebuffer
// pixel-identical to render.h over six form scenes.

import { chromium } from 'playwright';
import { SPLASH_MS } from '../src/panelRender.js';
import { openScoreboardLink } from '../src/scoreboardLink.js';

const dir = new URL('out/', import.meta.url).pathname;
const code = 'form' + Math.floor(Math.random() * 1e6);
const broker = 'wss://broker.emqx.io:8084/mqtt';
const BASE = 'http://localhost:5173/';

const SCORE = {
  a: 0, b: 0, round: 0, target: 21, first: 'a',
  teamA: 'Neil & Rho', teamB: 'Sigma & Tau',
  colorA: '#2f80ed', colorB: '#eb5757',
};
const ROSTER = {
  rows: [
    { n: 'Neil', w: 6, l: 4, p: 72, f: 'LWLWW' },
    { n: 'Rho', w: 2, l: 2, p: 73, f: 'WLLW' },
    { n: 'Sigma', w: 4, l: 6, p: 60, f: 'WLWLL' },
    { n: 'Tau', w: 2, l: 2, p: 73, f: 'LWWL' },
  ],
};

let failures = 0;
const check = (label, cond, detail = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
};

const link = `broker=${encodeURIComponent(broker)}&code=${code}`;
const pub = await openScoreboardLink({
  config: { broker, username: '', password: '', code },
  role: 'publisher',
  onStatus: () => {},
  onMessage: () => {},
});
await new Promise((r) => setTimeout(r, 2500));
// The score layout, so the override is visible: while the lineup is up neither
// view may show a score at all.
pub.sendLayout('score');
pub.send(SCORE);
pub.sendLineup(ROSTER);
await new Promise((r) => setTimeout(r, 1000));

const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome' });
const errors = [];

// The wait has to outlast the broker round trip *and* the emulator's splash, which covers
// the canvas while the letters are thrown in — derived from SPLASH_MS rather than left as a
// number that happened to be longer than it.
async function open(query, viewport) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}${query}${link}`);
  await page.waitForTimeout(SPLASH_MS + 1500);
  return page;
}

// Lit LEDs on the emulator's canvas, which is the only way to tell the form
// screen from the score screen without reaching into React.
const litRows = (page) =>
  page.evaluate(() => {
    const canvas = document.querySelector('.panel-canvas');
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const d = ctx.getImageData(0, 0, width, height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 120) lit += 1;
    return lit;
  });

console.log('a retained lineup puts ?display=1 on the form screen');
const display = await open('?display=1&', { width: 1280, height: 800 });
{
  const shown = await display.locator('.form-table').count();
  check('the form table is on screen', shown === 1);
  // Compared lowercased: the display uppercases names in CSS, so the rendered
  // text is not what was published.
  const names = await display.locator('.form-name').allInnerTexts();
  check(
    'all four players are listed, team A first',
    names.join(',').toLowerCase() === 'neil,rho,sigma,tau',
    names.join(','),
  );
  const records = await display.locator('.form-record').allInnerTexts();
  check('records are drawn', records[0].replace(/\s/g, '') === '6–4', records[0]);
  const pprs = await display.locator('.form-ppr').allInnerTexts();
  check('PPR is rendered from tenths', pprs[0] === '7.2', pprs[0]);
  const pips = await display.locator('.form-row').first().locator('.form-pip.is-win').count();
  check('a win pip per W in the form string', pips === 3, `${pips} of LWLWW`);
  // The whole point of the override: the scorer chose the score layout and the
  // seven-segment digits must not be on screen at all.
  check('no score digits while the lineup is up', (await display.locator('.seg-digit').count()) === 0);
  await display.screenshot({ path: `${dir}/form-display.png` });
}

console.log('\nand ?panel=1 on the panel form screen');
const panel = await open('?panel=1&', { width: 1000, height: 400 });
const panelFormLit = await litRows(panel);
{
  const caption = await panel.locator('.panel-caption').innerText();
  check('the caption names the form screen, not the layout', caption.includes('Pre-game form'), caption);
  check('and does not claim the score layout is showing', !caption.includes('Score only'), caption);
  check('LEDs are lit', panelFormLit > 0, `${panelFormLit} subpixels`);
  await panel.screenshot({ path: `${dir}/form-panel.png` });
}

// The failure this exists for. An empty retained payload is the only route back;
// if it were skipped as "nothing to send", both views would sit on a form screen
// for the rest of the game while the score moved underneath them.
console.log('\nclearing the topic puts both back on the score');
pub.sendLineup(null);
pub.send({ ...SCORE, a: 7, b: 3, round: 2 });
await new Promise((r) => setTimeout(r, 2000));
{
  check('the display form table is gone', (await display.locator('.form-table').count()) === 0);
  check('and the score digits are back', (await display.locator('.seg-digit').count()) === 4);
  const caption = await panel.locator('.panel-caption').innerText();
  check('the panel caption is back to the layout', caption.includes('Score only'), caption);
  const panelScoreLit = await litRows(panel);
  check('and the panel is drawing something else', panelScoreLit !== panelFormLit,
    `${panelFormLit} lit as form, ${panelScoreLit} as score`);
  await display.screenshot({ path: `${dir}/form-cleared-display.png` });
  await panel.screenshot({ path: `${dir}/form-cleared-panel.png` });
}

// A late joiner has to recover the form screen from the retained message with no
// request of its own — the same property presence and the layout rely on.
console.log('\na display opened after the fact recovers a retained lineup');
pub.sendLineup(ROSTER);
await new Promise((r) => setTimeout(r, 1000));
{
  const late = await open('?display=1&', { width: 1280, height: 800 });
  check('the form screen is there on open', (await late.locator('.form-table').count()) === 1);
  await late.close();
}

// Two properties in tension, both asked for and both easy to regress: the text has
// to be large enough to read across a garden, and a name has to survive whole. They
// trade directly — the name column gets `available - k x font` — so a change that
// looks like a harmless nudge to either buys itself out of the other.
//
// The character bound is the one with a rule behind it: **the panel draws 8**, so a
// tablet that truncated at 8 or fewer would be worse than the LED strip. Nine keeps
// a character of headroom.
//
// Measured against a two-digit record either side, which is the worst case and the
// one that bit: at single digits the columns are narrower and more name fits, so a
// check written against `6-4` would have passed while `12-10` showed one character.
console.log('\nnames survive whole at a size you can read across a garden');
pub.sendLineup({
  rows: [
    { n: 'AlphaBet', w: 12, l: 10, p: 120, f: 'LWLWW' },
    { n: 'BetaGamm', w: 2, l: 2, p: 73, f: 'WLLW' },
    { n: 'GammaDel', w: 4, l: 16, p: 60, f: 'WLWLL' },
    { n: 'DeltaEps', w: 2, l: 2, p: 73, f: 'LWWL' },
  ],
});
await new Promise((r) => setTimeout(r, 1500));
for (const [label, width, height] of [
  ['iPad 13in landscape', 1376, 1032],
  ['iPad 13in portrait', 1032, 1376],
  ['iPad 11in landscape', 1194, 834],
  ['iPad 11in portrait', 834, 1194],
]) {
  const page = await open('?display=1&', { width, height });
  const m = await page.evaluate(() => {
    const t = document.querySelector('.form-table');
    const b = t.getBoundingClientRect();
    return {
      font: parseFloat(getComputedStyle(t).fontSize),
      w: b.width,
      h: b.height,
      // What the flex line allows, which is not `max-width` — `.display` bounds the
      // item at `vw - 4vmin`, whichever is smaller.
      allowedW: Math.min(
        innerWidth * 0.92,
        innerWidth - 4 * (Math.min(innerWidth, innerHeight) / 100),
      ),
      vh: innerHeight,
      clipped: [...document.querySelectorAll('.form-name')].filter(
        (e) => e.scrollWidth > e.clientWidth + 1,
      ).length,
      overflowY: document.documentElement.scrollHeight > innerHeight + 1,
      overflowX: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
  check(
    `${label}: an 8-character name is not truncated beside a 12-10 record`,
    m.clipped === 0,
    `${m.clipped} of 4 cut`,
  );
  check(`${label}: text is large enough to read across a garden`, m.font >= 65, `${m.font}px`);
  // Spans the width whatever the names are, because the slack goes into the column
  // gaps rather than leaving the table centred at its natural size — measured, a
  // short-name roster is 8.51em against ~11.5em available, so without this a third of
  // the screen is margin. This is the assertion that catches losing that.
  check(
    `${label}: reaches the edges`,
    m.w >= m.allowedW - 1,
    `${Math.round(m.w)}px of ${Math.round(m.allowedW)}px`,
  );
  // Landscape is the orientation a propped-up tablet is in, and the one the height
  // term binds on — so it is where filling the height is worth asserting. Portrait is
  // width-bound and deliberately keeps air above and below.
  if (width > height) {
    const fillH = m.h / m.vh;
    check(`${label}: fills the height`, fillH > 0.78, `${Math.round(fillH * 100)}% of ${m.vh}px`);
  }
  check(`${label}: nothing runs off the screen`, !m.overflowY && !m.overflowX);
  await page.screenshot({ path: `${dir}/form-fill-${width}x${height}.png` });
  await page.close();
}

// Turning the tablet must leave the layout where a fresh load in that orientation puts
// it. Reported on an 11" iPad: a 7-character name whole in landscape, cut after
// landscape -> portrait -> landscape.
//
// The cause was `max-width: min(92vw, 13.5em)` making the cap depend on this element's
// own viewport-derived `font-size`; Safari kept the pre-rotation value and capped the
// table at 13.5 x the *portrait* font. Reproduced by pinning that cap, which truncated
// all four names — and fixed by writing the cap in viewport units, which is the same
// number on every device but has nothing to resolve against.
//
// **Chrome never showed it**, so this comparison passes either way here; it is in
// because rotation is something a propped-up tablet actually does and nothing else
// covered it. The property is that rotating is indistinguishable from loading.
console.log('\nrotating is the same as loading in that orientation');
pub.sendLineup({
  rows: [
    { n: 'Upsilon', w: 12, l: 10, p: 120, f: 'LWLWW' },
    { n: 'Upsilon', w: 2, l: 2, p: 73, f: 'WLLW' },
    { n: 'Upsilon', w: 4, l: 16, p: 60, f: 'WLWLL' },
    { n: 'Upsilon', w: 2, l: 2, p: 73, f: 'LWWL' },
  ],
});
await new Promise((r) => setTimeout(r, 1500));
{
  const shape = () =>
    ((t) => ({
      font: Math.round(parseFloat(getComputedStyle(t).fontSize) * 100) / 100,
      maxWidth: Math.round(parseFloat(getComputedStyle(t).maxWidth)),
      width: Math.round(t.getBoundingClientRect().width),
      // The value that actually went stale on iPad: the table stayed full width and
      // only this shrank, to roughly what portrait had resolved it to.
      nameTrack: Math.round(document.querySelector('.form-name').clientWidth),
      cut: [...document.querySelectorAll('.form-name')].filter(
        (e) => e.scrollWidth > e.clientWidth + 1,
      ).length,
    }))(document.querySelector('.form-table'));

  const L = { width: 1194, height: 834 };
  const P = { width: 834, height: 1194 };

  const fresh = await open('?display=1&', L);
  const onLoad = await fresh.evaluate(shape);
  check('a 7-character name is whole on a fresh landscape load', onLoad.cut === 0);

  // Twice, because a stale value could just as well be one rotation behind.
  for (let lap = 1; lap <= 2; lap += 1) {
    await fresh.setViewportSize(P);
    await fresh.waitForTimeout(400);
    await fresh.setViewportSize(L);
    await fresh.waitForTimeout(400);
  }
  const afterRotation = await fresh.evaluate(shape);
  check(
    'and still whole after two trips through portrait',
    afterRotation.cut === 0,
    `${afterRotation.cut} of 4 cut`,
  );
  check(
    'the name column is the width a fresh load gives it',
    afterRotation.nameTrack === onLoad.nameTrack,
    `${afterRotation.nameTrack}px after vs ${onLoad.nameTrack}px on load`,
  );
  check(
    'the cap does not carry over from the other orientation',
    afterRotation.maxWidth === onLoad.maxWidth,
    `${afterRotation.maxWidth}px after vs ${onLoad.maxWidth}px on load`,
  );
  check(
    'and the table is the same width as on load',
    afterRotation.width === onLoad.width && afterRotation.font === onLoad.font,
    `${afterRotation.width}px @${afterRotation.font} vs ${onLoad.width}px @${onLoad.font}`,
  );
  await fresh.screenshot({ path: `${dir}/form-after-rotation.png` });
  await fresh.close();
}

// A record and a rate are single values and must never break across two lines. The
// state that provokes it is a portrait tablet with long names, where the grid is
// pinned at its max-width and the shortfall has to come from somewhere: the en dash
// in "12–10" is a legal break point, so only the name may give. Reported on a real
// 13" iPad in Safari, where the record split after the dash.
console.log('\nrecords and rates never wrap, even with the grid at its max width');
pub.sendLineup({
  rows: [
    { n: 'AlphaBetaGammaDe', w: 12, l: 10, p: 120, f: 'LWLWW' },
    { n: 'BetaGammaDeltaE', w: 2, l: 2, p: 73, f: 'WLLW' },
    { n: 'GammaDeltaEpsil', w: 4, l: 16, p: 60, f: 'WLWLL' },
    { n: 'Tau', w: 2, l: 2, p: 73, f: 'LWWL' },
  ],
});
await new Promise((r) => setTimeout(r, 1500));
for (const [label, width, height] of [
  ['iPad 13in portrait', 1032, 1376],
  ['iPad 11in portrait', 834, 1194],
  ['iPad 13in landscape', 1376, 1032],
]) {
  const page = await open('?display=1&', { width, height });
  const m = await page.evaluate(() => {
    // Distinct line tops, not rect count: getClientRects splits a text node at
    // every break *opportunity*, so counting rects reports a wrap on "6–4" even
    // when it renders on one line.
    const lines = (el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return new Set([...r.getClientRects()].map((b) => Math.round(b.top))).size;
    };
    const most = (sel) => Math.max(...[...document.querySelectorAll(sel)].map(lines));
    const table = document.querySelector('.form-table');
    return {
      record: most('.form-record'),
      ppr: most('.form-ppr'),
      head: most('.form-head > span'),
      pinned: Math.round(table.getBoundingClientRect().width) >= Math.round(window.innerWidth * 0.92),
      nameClipped: [...document.querySelectorAll('.form-name')].some(
        (e) => e.scrollWidth > e.clientWidth + 1,
      ),
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  check(`${label}: the record stays on one line`, m.record === 1, `${m.record} lines`);
  check(`${label}: so does the rate`, m.ppr === 1, `${m.ppr} lines`);
  check(`${label}: and the W–L heading`, m.head === 1, `${m.head} lines`);
  check(`${label}: nothing runs off the side`, m.overflowX === 0, `${m.overflowX}px`);
  // In portrait this roster pins the grid at 92vw, so the name is the column that
  // gives. That is the state the wrap came from — if it stops being pinned, this
  // block has stopped testing anything.
  if (height > width) {
    check(`${label}: the grid is at its limit, so the check is meaningful`, m.pinned);
    check(`${label}: and the name is what gives`, m.nameClipped);
  }
  await page.screenshot({ path: `${dir}/form-long-names-${width}x${height}.png` });
  await page.close();
}

// The one above has no teeth in Chrome and this one does. Chrome cannot be made to
// wrap through the viewport: the font is `vmin`-based and the width budget is
// `vw`-based, so in portrait they scale together and in landscape the budget wins —
// the ratio is always favourable and the name column absorbs the whole shortfall.
// Safari evidently splits the shortfall across the numeric tracks instead. Forcing
// the grid narrower than those tracks reproduces that state in any engine, so this
// is what actually fails if the `nowrap` is removed.
console.log('\nand hold when the grid is forced narrower than its numeric columns');
{
  const page = await open('?display=1&', { width: 1032, height: 1376 });
  await page.addStyleTag({ content: '.form-table{max-width:none!important;width:300px!important}' });
  await page.waitForTimeout(200);
  const m = await page.evaluate(() => {
    const lines = (el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return new Set([...r.getClientRects()].map((b) => Math.round(b.top))).size;
    };
    const most = (sel) => Math.max(...[...document.querySelectorAll(sel)].map(lines));
    return { record: most('.form-record'), ppr: most('.form-ppr'), head: most('.form-head > span') };
  });
  check('the record survives a forced squeeze', m.record === 1, `${m.record} lines`);
  check('so does the rate', m.ppr === 1, `${m.ppr} lines`);
  check('so does the heading', m.head === 1, `${m.head} lines`);
  await page.screenshot({ path: `${dir}/form-forced-squeeze.png` });
  await page.close();
}
// A 0.0 average is a real one and must be drawn; only a 0-0 record suppresses the
// rate. Gating on the rate blanked the row of anyone having a bad run, which reads
// as missing data.
console.log('\na 0.0 average is shown, a newcomer with no record is not');
pub.sendLineup({
  rows: [
    { n: 'Eta', w: 0, l: 5, p: 0, f: 'LLLLL' },
    { n: 'Psi', w: 0, l: 0, p: 0, f: '' },
  ],
});
await new Promise((r) => setTimeout(r, 1500));
{
  const pprs = await display.locator('.form-ppr').allInnerTexts();
  check('the losing player shows 0.0', pprs[0] === '0.0', JSON.stringify(pprs));
  check('and the newcomer shows nothing', pprs[1] === '', JSON.stringify(pprs));
  await display.screenshot({ path: `${dir}/form-zero-rate.png` });
}

// Everything above publishes from a synthetic client. This block is the only one
// that drives the scoring app itself, because the failure it covers lives in the
// wiring between two halves that are each correct: a career rename reaches the
// live lineup at once, but `App` holds its own copy of the archive that `Stats`
// only refreshes on the way out. In between, the board drew the corrected name
// against nobody's history — 0-0, "no matches yet" — and stayed that way for as
// long as the stats screen was open. Nothing hermetic can see it: while `Stats`
// is open the setup screen's own Form panel is not on screen, so the published
// lineup is the only surface the disagreement reaches.
console.log('\na career rename does not publish the new name with an empty record');
{
  const renCode = 'ren' + Math.floor(Math.random() * 1e6);
  const renLink = `broker=${encodeURIComponent(broker)}&code=${renCode}`;
  const board = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  board.on('pageerror', (e) => errors.push(e.message));
  await board.goto(`${BASE}?display=1&${renLink}`);

  const scorer = await browser.newPage({ viewport: { width: 430, height: 932 } });
  scorer.on('pageerror', (e) => errors.push(e.message));
  await scorer.goto(BASE);
  await scorer.evaluate(([renCode, broker]) => {
    const bags = (t) => Array(4).fill(t);
    const round = (a, b, na, nb) => ({ a, b, nets: { a: na, b: nb }, first: 'a' });
    localStorage.clear();
    localStorage.setItem('holecorn.matches.v1', JSON.stringify([{
      format: 1, id: 'r1', startedAt: 1.7e12, endedAt: 1.7e12 + 6e5, mode: 'singles',
      players: { a: ['Rho'], b: ['Phi'] },
      colors: { a: '#27ae60', b: '#f2c94c' }, target: 21, winner: 'a',
      rounds: [
        round(bags('hole'), bags('floor'), 12, 0),
        round(bags('hole'), bags('floor'), 12, 0),
      ],
    }]));
    localStorage.setItem('holecorn.scoreboard.v1', JSON.stringify({
      broker, username: '', password: '', code: renCode, enabled: true, layout: 'full',
    }));
  }, [renCode, broker]);
  await scorer.reload();
  await scorer.waitForSelector('.setup');
  const renNames = scorer.locator('.team-name-input');
  await renNames.nth(0).fill('Rho');
  await renNames.nth(1).fill('Phi');
  await new Promise((r) => setTimeout(r, 5000));

  const rows = () => board.locator('.form-record').allInnerTexts();
  const before = await rows();
  check('the board has the roster before the rename', before[0]?.replace(/\s/g, '') === '1–0',
    JSON.stringify(before));

  await scorer.getByRole('button', { name: 'Stats' }).click();
  await scorer.locator('.stats-table tbody tr', { hasText: 'Rho' }).locator('.player-rename').click();
  await scorer.locator('.rename-input').fill('Rho B');
  await scorer.locator('.modal').getByRole('button', { name: 'Rename' }).click();
  await new Promise((r) => setTimeout(r, 2500));

  // Still on the stats screen. Leaving it re-reads the archive and would hide the
  // bug, so the assertion has to be made here.
  const names = await board.locator('.form-name').allInnerTexts();
  check('the board follows the new spelling', names[0]?.toLowerCase() === 'rho b', names.join(','));
  const after = await rows();
  check(
    'and keeps the history behind it, without leaving the stats screen',
    after[0]?.replace(/\s/g, '') === '1–0',
    JSON.stringify(after),
  );
  await board.screenshot({ path: `${dir}/form-after-rename.png` });
  await board.close();
  await scorer.close();
}

check('no uncaught errors in either view', errors.length === 0, errors.join(' | '));

pub.close();
await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nall form screen checks passed');
console.log(`screenshots -> tools/out/`);
process.exit(failures ? 1 : 0);
