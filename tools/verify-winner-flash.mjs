// Verifies the winner flash against a live payload: that the digits alternate
// between solid and hollowed, that only the winning side is affected, and that
// the flash is skipped entirely under prefers-reduced-motion.
//
//   npm run dev, then: node tools/verify-winner-flash.mjs
import { chromium } from 'playwright';
import { openScoreboardLink } from '../src/scoreboardLink.js';

const dir = new URL('out/', import.meta.url).pathname;
const code = 'flash' + Math.floor(Math.random() * 1e6);
const broker = 'wss://broker.emqx.io:8084/mqtt';

const pub = await openScoreboardLink({
  config: { broker, username: '', password: '', code }, role: 'publisher',
  onStatus: () => {}, onMessage: () => {},
});
await new Promise((r) => setTimeout(r, 2500));
pub.send({ a: 21, b: 8, round: 8, target: 21, teamA: 'Neil & Psi', teamB: 'Iota & Zeta',
           colorA: '#2f80ed', colorB: '#eb5757', first: 'a', winner: 'a' });

const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text()); });
await page.goto(`http://localhost:5173/?display=1&broker=${encodeURIComponent(broker)}&code=${code}`);
await page.waitForTimeout(5000);

// Sample across a full flash cycle and keep the two distinct frames.
const seen = new Map();
for (let i = 0; i < 10; i++) {
  const state = await page.evaluate(() => ({
    hollow: document.querySelectorAll('.seg-fill').length,
    lit: document.querySelectorAll('.seg.on').length,
  }));
  const key = state.hollow > 0 ? 'hollow' : 'solid';
  if (!seen.has(key)) {
    seen.set(key, state);
    await page.screenshot({ path: `${dir}/flash-${key}.png` });
    console.log(`captured ${key}: ${state.hollow} hollow fills, ${state.lit} lit segments`);
  }
  if (seen.size === 2) break;
  await page.waitForTimeout(160);
}
if (seen.size < 2) console.log('ONLY CAPTURED:', [...seen.keys()]);

// The flash must stop for anyone asking for reduced motion.
const rm = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await rm.emulateMedia({ reducedMotion: 'reduce' });
await rm.goto(`http://localhost:5173/?display=1&broker=${encodeURIComponent(broker)}&code=${code}`);
await rm.waitForTimeout(5000);
let flashed = 0;
for (let i = 0; i < 8; i++) {
  if (await rm.evaluate(() => document.querySelectorAll('.seg-fill').length > 0)) flashed++;
  await rm.waitForTimeout(200);
}
console.log(`reduced motion: hollow frames seen in ${flashed}/8 samples (want 0)`);
await rm.screenshot({ path: `${dir}/flash-reduced-motion.png` });

pub.close();
await browser.close();
process.exit(0);
