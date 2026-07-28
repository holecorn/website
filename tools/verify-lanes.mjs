// The scoring lanes' geometry, measured across real device sizes.
//
// Everything here is a number that no other test defends. The bag is square and
// sized off a tier band; the lane track caps at 72px; `.main` caps at 408px,
// which is the lanes' own width and therefore depends on the intrinsic width of
// the tier-label column — change the label text, the font or the letter-spacing
// and the cap silently stops matching, with nothing to say so.
//
// It also asserts the two responsive tiers never both match. A big phone on its
// side satisfies the wide tier's min-width and the compact tier's max-height at
// once, and when both applied the bag tap target collapsed to 26px.

import { chromium } from 'playwright';

const URL = 'http://localhost:4173/';

// The narrowest a lane may get. Below this the primary tap target of the app is
// smaller than the 44px minimum every touch guideline agrees on.
const MIN_LANE = 44;
const LANE_CAP = 72;

const DEVICES = [
  ['iPhone SE portrait', 375, 667],
  ['iPhone portrait', 390, 844],
  ['small phone portrait', 360, 640],
  ['iPhone landscape', 852, 393],
  ['iPhone Pro Max landscape', 932, 430],
  ['iPad portrait', 820, 1180],
  ['iPad landscape', 1180, 820],
  ['iPad mini landscape', 1024, 768],
  ['desktop', 1600, 1000],
];

let failures = 0;
const check = (label, cond, detail = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
};

const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome' });

async function measure(width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (e) => {
    console.log('  PAGE ERROR', e.message);
    failures++;
  });
  await page.goto(URL);
  await page.waitForSelector('.setup');
  await page.getByRole('button', { name: 'Start game' }).click();
  const m = await page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      return el ? el.getBoundingClientRect() : null;
    };
    const grid = document.querySelector('.lanes-grid');
    const gs = getComputedStyle(grid);
    // Read the real gap: the compact tier uses a different one, and assuming
    // 8px here reports a phantom overflow.
    const gap = parseFloat(gs.columnGap) || 0;
    const tracks = gs.gridTemplateColumns.split(' ').map(parseFloat);
    const used = tracks.reduce((a, b) => a + b, 0) + gap * (tracks.length - 1);
    const card = box('.team-lanes');
    const cardStyle = getComputedStyle(document.querySelector('.team-lanes'));
    const inner =
      card.width -
      parseFloat(cardStyle.paddingLeft) -
      parseFloat(cardStyle.paddingRight) -
      parseFloat(cardStyle.borderLeftWidth) -
      parseFloat(cardStyle.borderRightWidth);
    const token = box('.bag-token');
    const lane = box('.lane');
    const laneEl = document.querySelector('.lane');
    const tokenEl = document.querySelector('.bag-token');
    return {
      lane: Math.round(lane.width * 10) / 10,
      token: { w: Math.round(token.width * 10) / 10, h: Math.round(token.height * 10) / 10 },
      // Auto margins should leave the token centred in its lane.
      offCentre:
        Math.round(
          ((token.left + token.right) / 2 - (lane.left + lane.right) / 2) * 10,
        ) / 10,
      slack: Math.round((inner - used) * 10) / 10,
      main: Math.round(box('.main').width),
      button: Math.round(box('.end-round').width),
      card: Math.round(card.width),
      tierZone: Math.round(box('.tier-zone').width),
      lanesOverflow: grid.scrollWidth > grid.clientWidth + 1,
      // Which tier is in force: the compact one puts the teams side by side.
      scoringRow: getComputedStyle(document.querySelector('.scoring')).flexDirection === 'row',
      appGrid: getComputedStyle(document.querySelector('.app')).display === 'grid',
      railPersistent: !!document.querySelector('.side-rail > .positions'),
      laneEl: laneEl.className,
      tokenEl: tokenEl.className,
    };
  });
  await page.close();
  return m;
}

console.log('the bag token is square and centred, and the lanes never stretch');
for (const [label, w, h] of DEVICES) {
  const m = await measure(w, h);
  const tag = `${label} ${w}x${h}`;
  check(`${tag}: token square`, Math.abs(m.token.w - m.token.h) < 0.6, `${m.token.w}x${m.token.h}`);
  check(`${tag}: token centred`, Math.abs(m.offCentre) < 1.5, `${m.offCentre}px off`);
  check(`${tag}: lane within the cap`, m.lane <= LANE_CAP + 0.6, `${m.lane}px`);
  check(`${tag}: lane above the touch minimum`, m.lane >= MIN_LANE, `${m.lane}px`);
  check(`${tag}: lanes fit the card`, !m.lanesOverflow && m.slack >= -0.6, `slack ${m.slack}px`);
  // Where there is room to spare, the lane must actually reach the cap. This is
  // what holds `.main`'s 408px: the remainder after four 72px lanes and the gaps
  // goes to the `auto` tier-label column, whose width is intrinsic, so widening
  // the labels or changing their font eats into the lanes instead of overflowing
  // anything. Without this the cap degrades silently.
  if (w >= 820 && !m.scoringRow) {
    check(`${tag}: lane reaches the cap`, Math.abs(m.lane - LANE_CAP) < 0.6, `${m.lane}px`);
  }
}

console.log('\nthe card, header and buttons share one width');
for (const [label, w, h] of DEVICES) {
  const m = await measure(w, h);
  // The compact tier is exempt: it puts two cards in a row under a full-width
  // button on purpose.
  if (m.scoringRow) continue;
  check(
    `${label} ${w}x${h}: End round matches the card`,
    Math.abs(m.button - m.card) <= 1,
    `button ${m.button} vs card ${m.card}`,
  );
  check(`${label} ${w}x${h}: no dead space in the card`, m.slack <= 6, `slack ${m.slack}px`);
}

console.log('\nthe wide tier and the compact tier are mutually exclusive');
for (const [label, w, h] of DEVICES) {
  const m = await measure(w, h);
  check(
    `${label} ${w}x${h}: one tier only`,
    !(m.scoringRow && m.appGrid),
    m.scoringRow && m.appGrid ? 'both applied' : m.scoringRow ? 'compact' : m.appGrid ? 'wide' : 'base',
  );
  // The stylesheet decides where the rail's panels go and the component decides
  // whether they exist. If those disagree the panels render unplaced with no
  // toggle to dismiss them.
  check(
    `${label} ${w}x${h}: rail matches the tier`,
    m.railPersistent === m.appGrid,
    `rail ${m.railPersistent} vs wide tier ${m.appGrid}`,
  );
}

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nall lane geometry checks passed');
process.exit(failures ? 1 : 0);
