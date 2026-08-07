import { chromium } from 'playwright';

const DISPLAY = 'http://localhost:4173/?display=1';
const APP = 'http://localhost:4173/';
let failures = 0;
const check = (label, cond, detail = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
};

// Replaces the real API with one we can drive: count requests, refuse them, and
// simulate the system taking the lock back.
const MOCK = `
window.__wake = { requests: 0, sentinels: [], autoRelease: false, visibility: 'visible' };
Object.defineProperty(document, 'visibilityState', {
  get: () => window.__wake.visibility, configurable: true,
});
Object.defineProperty(navigator, 'wakeLock', {
  configurable: true,
  value: {
    request: async () => {
      const w = window.__wake;
      w.requests++;
      const s = new EventTarget();
      s.released = false;
      s.release = async () => { s.released = true; s.dispatchEvent(new Event('release')); };
      w.sentinels.push(s);
      if (w.autoRelease) setTimeout(() => s.release(), 0);
      return s;
    },
  },
});
window.__wake.systemRelease = () => {
  const s = window.__wake.sentinels[window.__wake.sentinels.length - 1];
  if (s && !s.released) { s.released = true; s.dispatchEvent(new Event('release')); }
};
`;

const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome' });
const open = async (extra, url = DISPLAY) => {
  const page = await browser.newPage();
  await page.addInitScript(MOCK);
  // Init scripts run in order, so this lands after the mock is installed and
  // survives the navigation — unlike setting the flag then reloading.
  if (extra) await page.addInitScript(extra);
  page.on('pageerror', (e) => { console.log('  PAGE ERROR', e.message); failures++; });
  await page.goto(url);
  return page;
};
const count = (page) => page.evaluate(() => window.__wake.requests);

console.log('acquires on load');
{
  const page = await open();
  await page.waitForTimeout(400);
  check('one request', (await count(page)) === 1, `got ${await count(page)}`);
  await page.close();
}

console.log('re-acquires after the system takes it back');
{
  const page = await open();
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__wake.systemRelease());
  await page.waitForTimeout(300);
  check('not re-requested immediately', (await count(page)) === 1, `got ${await count(page)}`);
  await page.waitForTimeout(1200);
  check('re-requested after the delay', (await count(page)) === 2, `got ${await count(page)}`);
  await page.close();
}

console.log('a system that refuses to hold it degrades to a slow retry, not a spin');
{
  const page = await open('window.__wake.autoRelease = true');
  await page.waitForTimeout(3500);
  const n = await count(page);
  check('rate limited to about one per second', n >= 2 && n <= 6, `${n} requests in 3.5s`);
  await page.close();
}

console.log('does not re-acquire while the page is hidden');
{
  const page = await open();
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    window.__wake.visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    window.__wake.systemRelease();
  });
  await page.waitForTimeout(1500);
  check('stays released while hidden', (await count(page)) === 1, `got ${await count(page)}`);
  await page.evaluate(() => {
    window.__wake.visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(400);
  check('re-acquires on becoming visible', (await count(page)) === 2, `got ${await count(page)}`);
  await page.close();
}

// The scoring phone, which is the screen unlocked most often — roughly once a round.
// Two-sided on purpose: holding it everywhere would keep a phone left on setup or
// reading career stats awake, so the absences are what say the scope is real.
console.log('the scoring phone holds it on the play screen and nowhere else');
{
  const page = await open(undefined, APP);
  await page.waitForTimeout(400);
  check('nothing requested on setup', (await count(page)) === 0, `got ${await count(page)}`);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.waitForTimeout(400);
  check('requested on the play screen', (await count(page)) === 1, `got ${await count(page)}`);
  // Nothing has been thrown, so this is `New game` rather than `Abandon game` and asks
  // nothing. Back on setup the lock has to go, through the effect's own cleanup.
  await page.getByRole('button', { name: 'New game', exact: true }).click();
  await page.waitForTimeout(400);
  // Counted as well as tested: `[].every()` is true, so a phone that never took the
  // lock would pass this while proving nothing — the file's own recorded trap.
  const held = await page.evaluate(() => window.__wake.sentinels.map((s) => s.released));
  check(
    'released on the way back to setup',
    held.length > 0 && held.every((r) => r),
    `${held.filter((r) => r).length} of ${held.length} released`,
  );
  check('and not re-taken there', (await count(page)) === 1, `got ${await count(page)}`);
  await page.close();
}

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nall wake lock checks passed');
process.exit(failures ? 1 : 0);
