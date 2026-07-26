import { chromium } from 'playwright';
import { openScoreboardLink } from '../src/scoreboardLink.js';

const dir = new URL('out/', import.meta.url).pathname;
const code = 'tab' + Math.floor(Math.random() * 1e6);
const broker = 'wss://broker.emqx.io:8084/mqtt';
const url = `http://localhost:5173/?display=1&broker=${encodeURIComponent(broker)}&code=${code}`;

// CSS viewport and the physical screen size of each real device, so digit
// height can be reported in millimetres rather than pixels.
const DEVICES = [
  { name: 'tablet-10in',  w: 1280, h: 800,  mmW: 215, label: '10" Android tablet' },
  { name: 'ipad-10.9',    w: 1180, h: 820,  mmW: 228, label: 'iPad 10.9"' },
  { name: 'monitor-24in', w: 1920, h: 1080, mmW: 531, label: '24" monitor' },
  { name: 'small-landscape', w: 1024, h: 768, mmW: 197, label: 'small 8" landscape' },
  { name: 'phone-landscape', w: 844, h: 390, mmW: 146, label: 'phone landscape' },
  { name: 'portrait-10in', w: 800, h: 1280, mmW: 134, label: '10" tablet portrait' },
];

const pub = await openScoreboardLink({
  config: { broker, username: '', password: '', code }, role: 'publisher',
  onStatus: () => {}, onMessage: () => {},
});
await new Promise((r) => setTimeout(r, 2500));
pub.send({ a: 17, b: 8, round: 6, target: 21, teamA: 'Neil & Psi', teamB: 'Iota & Zeta',
           colorA: '#2f80ed', colorB: '#eb5757', first: 'a', winner: null });

const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome' });
console.log('device                 digits    name    | at 4m needs ~35mm');
for (const d of DEVICES) {
  const page = await browser.newPage({ viewport: { width: d.w, height: d.h } });
  await page.goto(url);
  await page.waitForTimeout(4500);
  await page.screenshot({ path: `${dir}/${d.name}.png` });
  const m = await page.evaluate(() => ({
    digit: document.querySelector('.seg-digit').getBoundingClientRect().height,
    name: parseFloat(getComputedStyle(document.querySelector('.display-team')).fontSize),
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
    overflowY: document.documentElement.scrollHeight > window.innerHeight,
  }));
  const pxPerMm = d.w / d.mmW;
  const flag = m.overflowX || m.overflowY ? '  ** OVERFLOW **' : '';
  console.log(
    `${d.label.padEnd(20)} ${(m.digit / pxPerMm).toFixed(0).padStart(4)}mm  ` +
    `${(m.name / pxPerMm).toFixed(0).padStart(4)}mm${flag}`);
  await page.close();
}
pub.close();
await browser.close();
process.exit(0);
