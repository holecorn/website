// Renders the board's states on the 2-module (128x32) layout, so they can be
// compared side by side. Digits are the real polygons from src/segments.js
// rasterised onto the panel grid; text is the 5x7 bitmap font.
import { chromium } from 'playwright';
import { SEGMENTS, DIGIT_SEGMENTS } from '../../src/segments.js';
import { FONT, ADVANCE } from './font5x7.mjs';

const dir = new URL('../out/', import.meta.url).pathname;
const W = 128, H = 32;
const BLUE = '#2f80ed', RED = '#eb5757';

const STATES = [
  { id: 'start', label: 'Start of game — nothing logged yet',
    score: [0, 0], round: 1 },
  { id: 'waiting', label: 'No message yet — waiting for the scorer, dimmed',
    dashes: true, dim: 0.3, marker: '' },
  { id: 'stale', label: 'Scorer gone or broker down — last score held, dimmed',
    score: [17, 8], round: 7, dim: 0.3 },
  { id: 'wash', label: 'Wash — a round scored nothing, so the board simply does not move',
    score: [17, 8], round: 8 },
  { id: 'win-on', label: 'Game won — winner flash, lit frame',
    score: [21, 8], round: 8 },
  { id: 'win-off', label: 'Game won — winner flash, blank frame',
    score: [21, 8], round: 8, blank: 0 },
  { id: 'full', label: 'Both scores two digits — the fullest the board gets',
    score: [21, 19], round: 14 },
  { id: 'banner', label: 'WASH callout at 3x font — a design option, not currently built',
    banner: 'WASH', bannerColor: '#cfd8e3' },
];

const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1400, height: 1600 } });
await page.setContent('<body style="margin:0;background:#0b0e11"></body>');

const shots = await page.evaluate(
  ({ SEGMENTS, DIGIT_SEGMENTS, FONT, ADVANCE, STATES, W, H, BLUE, RED }) => {
    const SCALE = 9, DOT = 3.4, ON = 96, RATIO = 100 / 180;
    const dh = 28, dw = dh * RATIO, pair = dw * 2 + 2, gutter = 24;
    const margin = (W - pair * 2 - gutter) / 2;
    const poly = (pts) => pts.split(' ').map((p) => p.split(',').map(Number));
    const tw = (s) => (s.length ? s.length * ADVANCE - 1 : 0);

    const ctx = () => {
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      return cv.getContext('2d');
    };

    function digit(c, ch, x, y) {
      // A dash lights the middle segment only, which is what "----" looks like
      // on real seven-segment hardware.
      const lit = ch === '-' ? 'g' : (DIGIT_SEGMENTS[ch] ?? '');
      c.fillStyle = '#fff';
      for (const name of lit) {
        c.beginPath();
        poly(SEGMENTS[name]).forEach(([px, py], i) => {
          const cx = x + (px / 100) * dw, cy = y + (py / 180) * dh;
          if (i) c.lineTo(cx, cy); else c.moveTo(cx, cy);
        });
        c.closePath();
        c.fill();
      }
    }

    // Integer-scaled font blocks, so a 3x callout stays pixel-exact.
    function text(c, str, x, y, k = 1) {
      c.fillStyle = '#fff';
      [...str.toUpperCase()].forEach((ch, i) => {
        (FONT[ch] ?? FONT[' ']).forEach((row, ry) => {
          [...row].forEach((bit, rx) => {
            if (bit === '#') c.fillRect(x + i * ADVANCE * k + rx * k, y + ry * k, k, k);
          });
        });
      });
    }

    // Dimming a HUB75 panel is PWM duty, so the colour scales toward black.
    const dim = (hex, f) => {
      const [r, g, b] = [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * f));
      return `rgb(${r},${g},${b})`;
    };

    function build(st) {
      const f = st.dim ?? 1;
      const layers = [];

      if (st.banner) {
        const c = ctx();
        const k = 3;
        const w = str => str.length * ADVANCE * k - k;
        text(c, st.banner, Math.round((W - w(st.banner)) / 2), Math.round((H - 7 * k) / 2), k);
        layers.push({ color: dim(st.bannerColor, f), img: c.getImageData(0, 0, W, H) });
        return layers;
      }

      [BLUE, RED].forEach((color, side) => {
        if (st.blank === side) return;
        const c = ctx();
        const chars = st.dashes
          ? ['-', '-']
          : String(Math.min(Math.max(st.score[side], 0), 99)).padStart(2, ' ').split('');
        let x = side === 0 ? margin : W - margin - pair;
        const y = (H - dh) / 2;
        for (const ch of chars) {
          digit(c, ch, x, y);
          x += dw + 2;
        }
        layers.push({ color: dim(color, f), img: c.getImageData(0, 0, W, H) });
      });

      const marker = st.marker ?? `R${st.round}`;
      if (marker) {
        const c = ctx();
        text(c, marker, Math.round((W - tw(marker)) / 2), Math.round((H - 7) / 2));
        layers.push({ color: dim('#8b98a5', f), img: c.getImageData(0, 0, W, H) });
      }
      return layers;
    }

    function paint(layers, glow) {
      const out = document.createElement('canvas');
      out.width = W * SCALE; out.height = H * SCALE;
      const g = out.getContext('2d');
      g.fillStyle = '#07090a';
      g.fillRect(0, 0, out.width, out.height);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const hit = layers.find((l) => l.img.data[i + 3] > ON);
          g.beginPath();
          g.arc(x * SCALE + SCALE / 2, y * SCALE + SCALE / 2, DOT, 0, Math.PI * 2);
          if (hit) {
            g.shadowColor = hit.color;
            g.shadowBlur = SCALE * 0.85 * glow;
            g.fillStyle = hit.color;
          } else {
            g.shadowBlur = 0;
            g.fillStyle = '#15181b';
          }
          g.fill();
        }
      }
      g.shadowBlur = 0;
      g.strokeStyle = 'rgba(255,255,255,0.06)';
      g.beginPath(); g.moveTo(64 * SCALE, 0); g.lineTo(64 * SCALE, out.height); g.stroke();
      return out;
    }

    return STATES.map((st) => ({
      id: st.id,
      label: st.label,
      data: paint(build(st), st.dim ? 0.35 : 1).toDataURL('image/png'),
    }));
  },
  { SEGMENTS, DIGIT_SEGMENTS, FONT, ADVANCE, STATES, W, H, BLUE, RED },
);

const rows = shots.map((s) => `
  <div style="margin:0 0 20px">
    <div style="font:600 13px system-ui;color:#8b98a5;margin:0 0 6px">${s.label}</div>
    <img src="${s.data}" style="display:block">
  </div>`).join('');
await page.setContent(`<body style="margin:0;padding:22px;background:#0b0e11">${rows}</body>`);
await page.locator('body').screenshot({ path: `${dir}/hub75-states.png` });
for (const s of shots) {
  await page.setContent(`<body style="margin:0;background:#0b0e11"><img src="${s.data}"></body>`);
  await page.locator('img').screenshot({ path: `${dir}/hub75-state-${s.id}.png` });
}
await browser.close();
console.log('rendered states:', shots.map((s) => s.id).join(', '));
process.exit(0);
