import jsQR from 'jsqr';
import { chromium } from 'playwright';

const URL = 'http://localhost:4173/';
// A scorer pair *and* a display pair, because the property worth seeing end to end
// is that the copied link and the scanned QR carry the read-only one — the writable
// credentials must not leave the phone. `scoreboard.test.js` covers the fallback and
// the half-filled pair; only a browser can see which pair the settings panel builds
// its link from.
const CONFIG = {
  enabled: false,
  code: 'ab12c',
  broker: 'wss://example.invalid:8884/mqtt',
  username: 'scorer-u',
  password: 'scorer-p',
  displayUsername: 'viewer-u',
  displayPassword: 'viewer-p',
};
// `board/`, because that is the copy of the page with no manifest link in it and so the
// only one that survives being added to a home screen — see `displayUrl`. Written out
// rather than derived, so a link that quietly went back to `/` fails here as well as in
// the unit test.
const LINK = `${URL}board/?display=1&code=ab12c&broker=${encodeURIComponent(CONFIG.broker)}&user=viewer-u&pass=viewer-p`;
const leaksScorer = (link) =>
  link.includes(CONFIG.username) || link.includes(CONFIG.password);

let failures = 0;
const check = (label, cond, detail = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
};

const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome' });

const open = async ({ clipboard, viewport }) => {
  const context = await browser.newContext(viewport ? { viewport } : {});
  if (clipboard === 'granted') {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: URL });
  }
  const page = await context.newPage();
  page.on('pageerror', (e) => { console.log('  PAGE ERROR', e.message); failures++; });
  await page.addInitScript(([key, value]) => {
    localStorage.setItem(key, value);
  }, ['holecorn.scoreboard.v1', JSON.stringify(CONFIG)]);
  if (clipboard === 'missing') {
    // What Safari and Chrome both present on plain http (e.g. a dev server
    // reached by LAN IP): no navigator.clipboard at all.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: undefined });
    });
  }
  if (clipboard === 'refusing') {
    // The API is present but the write is refused (denied permission,
    // iOS Lockdown Mode, an untrusted gesture).
    await page.addInitScript(() => {
      navigator.clipboard.writeText = () =>
        Promise.reject(new DOMException('denied', 'NotAllowedError'));
    });
  }
  await page.goto(URL);
  await page.locator('.scoreboard-settings summary').click();
  return page;
};

const copyButton = (page) => page.getByRole('button', { name: /copy display link|copied/i });

const appears = (locator) =>
  locator.waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false);

console.log('copies the link when the clipboard is available');
{
  const page = await open({ clipboard: 'granted' });
  await copyButton(page).click();
  check('button acknowledges', await appears(page.getByRole('button', { name: 'Copied' })));
  const contents = await page.evaluate(() => navigator.clipboard.readText());
  check('clipboard holds the display link', contents === LINK, contents);
  check('the copied link carries no writable credentials', !leaksScorer(contents));
  check('no fallback dialog', !(await page.locator('.sb-link-dialog').count()));
  await page.context().close();
}

console.log('falls back to a manual-copy dialog when it is not');
{
  const page = await open({ clipboard: 'missing' });
  await copyButton(page).click();
  const dialog = page.locator('.sb-link-dialog');
  const opened = await appears(dialog);
  check('dialog opens', opened);
  if (opened) {
    const input = dialog.locator('input');
    check('dialog shows the display link', (await input.inputValue()) === LINK);
    const selected = await input.evaluate(
      (el) => el.selectionStart === 0 && el.selectionEnd === el.value.length,
    );
    check('link is pre-selected', selected);
    await dialog.getByRole('button', { name: 'Close' }).click();
    const gone = await dialog
      .waitFor({ state: 'detached', timeout: 3000 })
      .then(() => true, () => false);
    check('close dismisses it', gone);
  }
  await page.context().close();
}

console.log('falls back when the clipboard is present but refuses');
{
  const page = await open({ clipboard: 'refusing' });
  await copyButton(page).click();
  check('dialog opens', await appears(page.locator('.sb-link-dialog')));
  await page.context().close();
}

console.log('shows a QR code that decodes to the display link');
{
  const page = await open({ clipboard: 'missing' });
  await page.getByRole('button', { name: 'QR code' }).click();
  const qr = page.locator('.sb-qr svg');
  const shown = await appears(qr);
  check('QR code appears', shown);
  if (shown) {
    // Rasterise the SVG the way a camera would see it, then decode for real —
    // an SVG being present says nothing about whether it scans.
    const image = await qr.evaluate(async (svg) => {
      const size = 400;
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = `data:image/svg+xml;base64,${btoa(new XMLSerializer().serializeToString(svg))}`;
      });
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, size, size);
      const { data, width, height } = ctx.getImageData(0, 0, size, size);
      return { data: Array.from(data), width, height };
    });
    const decoded = jsQR(Uint8ClampedArray.from(image.data), image.width, image.height);
    check('QR decodes to the display link', decoded?.data === LINK, decoded?.data ?? 'no decode');
    check(
      'the scanned link carries no writable credentials',
      Boolean(decoded?.data) && !leaksScorer(decoded.data),
    );
  }
  await page.context().close();
}

console.log('\nthe actions row wraps without one control going ragged');
{
  // Narrow enough that every label has to break. `Open display` is an anchor
  // styled as a button, and only `button` centres its text by default, so this
  // is where the two diverge.
  const page = await open({ clipboard: 'granted', viewport: { width: 320, height: 900 } });
  await page.waitForSelector('.sb-actions a');
  const controls = await page.evaluate(() =>
    [...document.querySelectorAll('.sb-actions button, .sb-actions a')].map((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return {
        label: el.textContent.trim(),
        align: getComputedStyle(el).textAlign,
        lines: range.getClientRects().length,
      };
    }),
  );
  // Without this the check is vacuous: widening the row later would make every
  // label fit on one line and the alignment stop mattering, and it would still
  // pass. Same trap as the lane cap in verify-lanes.
  check(
    'the labels really are wrapping at this width',
    controls.length > 0 && controls.every((c) => c.lines > 1),
    controls.map((c) => `${c.label}=${c.lines}`).join(' '),
  );
  check(
    'buttons and the link agree on alignment',
    new Set(controls.map((c) => c.align)).size === 1,
    controls.map((c) => `${c.label}=${c.align}`).join(' '),
  );
  await page.close();
}

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nall copy link checks passed');
process.exit(failures ? 1 : 0);
