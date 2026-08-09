// The two colour schemes, measured — and the one failure mode that is silent in both.
//
// `index.css` declares every colour as `light-dark(light, dark)` and derives a team's ink
// from `--team` with `oklch(from var(--team) calc(l * 0.62) c h)`. `src/css.test.js` checks
// the arithmetic of all of that, and cannot check any of the following:
//
//   - **Whether the light scheme fires at all.** Everything about it lives in one
//     `color-scheme` declaration; the app renders perfectly and screenshots clean with the
//     light values simply never reached. The review that started this measured the play
//     screen's mean luminance at 33.6/255, so that is what this measures back.
//   - **Whether `oklch(from …)` is understood.** If it is not, the whole
//     `color: light-dark(oklch(…), var(--team))` declaration is invalid at parse time,
//     `.team-ink` sets no colour, and every team name silently inherits `--text` — on
//     *both* schemes. Legible, and the app has lost its second channel entirely. No
//     stylesheet parse can see this, because the stylesheet is correct.
//   - **A bag against the band it is resting on.** The band is a gradient stop and the bag
//     a derived colour, so the pair exists only once a browser has resolved both. The
//     light scheme's bands were tuned against this number.
//   - **That the board opts back out.** `main.jsx` pins `?display=1` and `?panel=1` to the
//     dark scheme; nothing below it can tell whether that ran.

import { chromium } from 'playwright';

const URL = 'http://localhost:4173/';

// A large graphic — which a bag is — wants 3:1 against what it sits on.
const GRAPHIC = 3;
// The dark scheme measured 33.6/255 mean luminance with 0.4% of pixels above mid-grey.
// The light scheme has to be a different order of thing, not a shade lighter: this bound
// is far below what it actually reaches (measured ~236) and far above the dark scheme, so
// it fails on the scheme not applying rather than on a palette tweak.
const LIGHT_MEAN = 150;
const DARK_MEAN = 60;

let failures = 0;
const check = (label, cond, detail = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
};

const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome' });

// **Never parse a computed colour here.** On the light scheme the derived team ink
// serialises as `oklch(0.5 0.164089 256.69)`, and reading three numbers out of that gives
// `[0.5, 0.164, 256.69]` as if they were channels — which is not a failure, it is worse:
// every contrast figure below came out plausible and wrong, and all of them passed. So a
// colour is resolved by painting it, which also gets the browser's own gamut mapping for
// free rather than a second implementation of it.
const resolve = (page, css) =>
  page.evaluate((value) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
  }, css);

const lum = (c) =>
  c
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((s, v, i) => s + [0.2126, 0.7152, 0.0722][i] * v, 0);
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const same = (a, b) => a.length === 3 && b.length === 3 && a.every((v, i) => v === b[i]);

// The page's own mean luminance. The screenshot goes back *into* a page to be decoded,
// which is the only way to read a raster here without a PNG dependency.
async function meanLuminance(page) {
  const shot = (await page.screenshot()).toString('base64');
  return page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const { data: px } = ctx.getImageData(0, 0, img.width, img.height);
    let total = 0;
    for (let i = 0; i < px.length; i += 4) {
      total += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    }
    return total / (px.length / 4);
  }, shot);
}

async function playScreen(colorScheme) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme });
  page.on('pageerror', (e) => {
    console.log('  PAGE ERROR', e.message);
    failures++;
  });
  await page.goto(URL);
  await page.waitForSelector('.setup');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.waitForSelector('.team-lanes');
  return page;
}

for (const scheme of ['dark', 'light']) {
  console.log(`\n${scheme} scheme`);
  const page = await playScreen(scheme);

  const mean = await meanLuminance(page);
  check(
    `the play screen is ${scheme === 'light' ? 'light' : 'dark'}`,
    scheme === 'light' ? mean > LIGHT_MEAN : mean < DARK_MEAN,
    `mean luminance ${mean.toFixed(1)}/255`,
  );

  // Both team names, and the body ink to tell them from. Read together in one evaluate,
  // so a missing element fails an assertion rather than timing the file out.
  const inks = await page.evaluate(() => {
    const teams = [...document.querySelectorAll('.scoreboard .team-name')].map(
      (el) => getComputedStyle(el).color,
    );
    return { teams, body: getComputedStyle(document.body).color };
  });
  check('the header names two teams', inks.teams.length === 2, inks.teams.join(' / '));
  const [a, b] = await Promise.all(inks.teams.map((c) => resolve(page, c)));
  const body = await resolve(page, inks.body);
  // The assertion this file exists for. Unsupported relative colour syntax leaves both of
  // these equal to the body ink, which is exactly what a screenshot cannot tell you.
  check(
    'a team colour resolves to something other than the body ink',
    !same(a, body) && !same(b, body),
    `${a} and ${b} against ${body}`,
  );
  check('the two teams are not the same colour', !same(a, b));
  const card = await resolve(
    page,
    await page.locator('.team-lanes').first().evaluate((el) => getComputedStyle(el).backgroundColor),
  );
  check(
    'each team name is legible on the card',
    Math.min(contrast(a, card), contrast(b, card)) >= 4.5,
    `${contrast(a, card).toFixed(2)}:1 and ${contrast(b, card).toFixed(2)}:1`,
  );

  // A bag on every band it can rest on. Both halves are read off the *rendered* lane
  // rather than off properties: the band is a gradient stop, which has no property to
  // read, and the bag's own colour is derived, which is the value that cannot be parsed.
  // Placed rather than assumed, too — an unthrown bag is greyscaled and 35% transparent,
  // so it would measure something else entirely.
  const worst = { ratio: Infinity, where: '' };
  for (const [row, band] of [
    [0, 'hole'],
    [1, 'board'],
    [2, 'floor'],
  ]) {
    await page.locator('.lane').first().locator('input').nth(row).check();
    // Past the 280ms slide *and* the 620ms spark burst a hole bag sets off, whose dots
    // land over the token's own centre — read at 400ms this sampled a spark instead of the
    // bag and the whole file failed at random, one run in three.
    await page.waitForTimeout(1000);
    const box = await page.evaluate(() => {
      const lane = document.querySelector('.lane').getBoundingClientRect();
      const token = document.querySelector('.lane .bag-token').getBoundingClientRect();
      return {
        laneWidth: lane.width,
        laneHeight: lane.height,
        x: token.left + token.width / 2 - lane.left,
        y: token.top + token.height / 2 - lane.top,
      };
    });
    const shot = (await page.locator('.lane').first().screenshot()).toString('base64');
    const [bag, behind] = await page.evaluate(
      async ({ data, at }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${data}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const sx = img.width / at.laneWidth;
        const sy = img.height / at.laneHeight;
        const px = (x, y) => [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data].slice(0, 3);
        // The bag's own centre, and the band beside it at the same height — 3px in from
        // the lane's edge, which the token never reaches.
        return [px(at.x * sx, at.y * sy), px(3, at.y * sy)];
      },
      { data: shot, at: box },
    );
    const ratio = contrast(bag, behind);
    if (ratio < worst.ratio) {
      worst.ratio = ratio;
      worst.where = band;
    }
  }
  check(
    'a bag is distinguishable from the band it rests on',
    worst.ratio >= GRAPHIC,
    `worst ${worst.ratio.toFixed(2)}:1 on the ${worst.where} band`,
  );

  await page.close();
}

// `WASH` on a round in an expanded match, which is the only *text* saying nobody scored it —
// `.is-wash` otherwise dims the running score, and that is opacity alone. It sat at 9px with
// `--muted` under `opacity: 0.7` and measured **2.99:1 on the light scheme** and 3.67:1 on
// the dark. `--muted` itself clears at 5.53/6.29, so the opacity was the whole of it, and
// nothing in a stylesheet can see that: the two declarations are in different rules and the
// colour is inherited from the cell above rather than set here.
//
// **Composited rather than sampled, which is the opposite of the bag above and deliberate.**
// A bag is 20px of flat colour, so a pixel from its middle *is* its colour; 11px text is
// antialiased down to 1px stems, so the darkest pixel inside a glyph is already part
// background and the figure comes out low by however much the hinting decided — a check that
// fails on a font rather than on a colour. `opacity` is one number to read and the blend the
// browser does with it is exact, so both colours still come through `resolve` and only the
// multiply is here. Effective alpha is the product up the ancestor chain, which is what the
// browser composites; an opacity moved to the row or the cell would otherwise be invisible.
console.log('\na wash is legible on both schemes');
for (const scheme of ['dark', 'light']) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
  await page.goto(URL);
  await page.evaluate(() => {
    const round = (a, b, na, nb) => ({ a, b, nets: { a: na, b: nb }, first: 'a' });
    const bags = (t) => Array(4).fill(t);
    localStorage.clear();
    localStorage.setItem(
      'holecorn.matches.v1',
      JSON.stringify([
        {
          format: 1, id: 'w1', startedAt: 1e12, endedAt: 1e12 + 6e5, mode: 'singles',
          players: { a: ['Rho', ''], b: ['Tau', ''] },
          colors: { a: '#27ae60', b: '#f2c94c' }, target: 21, winner: 'a',
          rounds: [
            round(bags('hole'), bags('floor'), 12, 0),
            round(bags('floor'), bags('floor'), 0, 0),
            round(bags('hole'), bags('floor'), 12, 0),
          ],
        },
      ]),
    );
  });
  await page.reload();
  await page.waitForSelector('.setup');
  await page.getByRole('button', { name: 'Stats' }).click();
  await page.locator('.recent-open').first().click();
  const tag = page.locator('.match-round.is-wash .mr-n em');
  check(`${scheme}: the wash round says so in words`, (await tag.count()) === 1);
  if (await tag.count()) {
    const read = await tag.evaluate((el) => {
      let alpha = 1;
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        alpha *= Number(getComputedStyle(n).opacity);
      }
      // The nearest ancestor that actually paints, which is the round table rather than the
      // row — a row with no background of its own would resolve to `rgba(0, 0, 0, 0)`.
      const behind = el.closest('.match-rounds');
      return {
        alpha,
        size: parseFloat(getComputedStyle(el).fontSize),
        ink: getComputedStyle(el).color,
        bg: getComputedStyle(behind).backgroundColor,
      };
    });
    const [ink, bg] = await Promise.all([read.ink, read.bg].map((c) => resolve(page, c)));
    const painted = ink.map((c, i) => Math.round(c * read.alpha + bg[i] * (1 - read.alpha)));
    const ratio = contrast(painted, bg);
    check(
      `${scheme}: and says it legibly`,
      ratio >= 4.5,
      `${ratio.toFixed(2)}:1 at ${read.size}px, alpha ${read.alpha}`,
    );
  }
  await page.close();
}

// The board is emissive and propped against a fence, so it stays dark whatever the tablet
// is set to. Both views, because they are pinned by one line in `main.jsx` and a check on
// only one of them would pass with the other spelt wrong.
//
// **Measured as contrast, not as luminance**, and that is the whole assertion. Both files
// paint their own near-black background as a literal, so dropping the pin barely moves the
// mean — verified by mutation, where a luminance bound passed with the pin deleted. What
// actually breaks is the text: `--text` and `--muted` are the only themed things on these
// screens, so they flip to near-black on a background that stays near-black, and the board
// goes blank while still measuring dark.
console.log('\nthe board ignores a light phone');
for (const [view, root, ink] of [
  ['display', '.display', '.display-title'],
  ['panel', '.panel', '.panel-title'],
]) {
  const page = await browser.newPage({
    viewport: { width: 900, height: 560 },
    colorScheme: 'light',
  });
  await page.goto(`${URL}?${view}=1`);
  const found = await page
    .waitForSelector(ink, { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  check(`?${view}=1 draws ${ink}`, found);
  if (found) {
    const pair = await page.evaluate(
      ([r, i]) => [
        getComputedStyle(document.querySelector(r)).backgroundColor,
        getComputedStyle(document.querySelector(i)).color,
      ],
      [root, ink],
    );
    const [bg, fg] = await Promise.all(pair.map((c) => resolve(page, c)));
    check(
      `?${view}=1 keeps its dark ink`,
      contrast(fg, bg) >= 4.5,
      `${contrast(fg, bg).toFixed(2)}:1, ${fg} on ${bg}`,
    );
  }
  await page.close();
}

await browser.close();
console.log(failures ? `\n${failures} failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
