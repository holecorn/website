// Previews what a HUB75 panel would actually show. The digits are the real
// polygons from src/segments.js rasterised onto the panel's pixel grid, and the
// text is a 5x7 bitmap font — the same one a real build would use. Nothing is
// hand-drawn: if a shape survives at this resolution here, it survives on glass.
import { chromium } from 'playwright';
import { SEGMENTS, DIGIT_SEGMENTS } from '../../src/segments.js';
import { FONT, GLYPH_H, ADVANCE } from './font5x7.mjs';

const dir = new URL('../out/', import.meta.url).pathname;
const RATIO = 100 / 180;   // segment digit aspect

function plan(kind, W, H) {
  if (kind === 'stacked') {
    const dh = 26, dw = dh * RATIO, pair = dw * 2 + 2;
    return { W, H, digitH: dh, digitW: dw,
      rows: [{ x: (W - pair) / 2, y: 1 }, { x: (W - pair) / 2, y: H - dh - 1 }],
      mid: { text: null, x: 0, y: 28 }, extent: pair };
  }
  if (kind === 'wide') {
    const dh = 28, dw = dh * RATIO, pair = dw * 2 + 2, gutter = 24;
    const m = (W - pair * 2 - gutter) / 2;
    return { W, H, digitH: dh, digitW: dw,
      rows: [{ x: m, y: (H - dh) / 2 }, { x: W - m - pair, y: (H - dh) / 2 }],
      mid: { y: Math.round((H - GLYPH_H) / 2) }, extent: pair * 2 + gutter };
  }
  const dh = 44, dw = dh * RATIO, pair = dw * 2 + 2, gutter = 20;
  const m = (W - pair * 2 - gutter) / 2;
  return { W, H, digitH: dh, digitW: dw, nameH: GLYPH_H,
    rows: [{ x: m, y: 11 }, { x: W - m - pair, y: 11 }],
    mid: { y: 30 }, extent: pair * 2 + gutter };
}

const LAYOUTS = [
  { id: 'single-64x64', kind: 'stacked', w: 64, h: 64,
    label: '1 module — 64x64 @ P4 = 256 x 256 mm — digits 104 mm' },
  { id: 'wide-128x32', kind: 'wide', w: 128, h: 32,
    label: '2 modules — 128x32 @ P4 = 512 x 128 mm — digits 112 mm' },
  { id: 'big-128x64', kind: 'names', w: 128, h: 64,
    label: '4 modules — 128x64 @ P4 = 512 x 256 mm — digits 176 mm, plus names' },
];

const BLUE_RED = { a: 17, b: 8, round: 7, target: 21, teamA: 'NEIL & PSI',
                   teamB: 'IOTA & ZETA', colorA: '#2f80ed', colorB: '#eb5757' };
const GREEN_YELLOW = { ...BLUE_RED, a: 21, b: 8, round: 8,
                       colorA: '#27ae60', colorB: '#f2c94c' };

const JOBS = [
  ...LAYOUTS.map((l) => ({ layout: l, scene: BLUE_RED })),
  { layout: LAYOUTS[1], scene: GREEN_YELLOW, suffix: '-alt' },
  { layout: LAYOUTS[2], scene: GREEN_YELLOW, suffix: '-alt' },
];

for (const { layout } of JOBS) {
  const p = plan(layout.kind, layout.w, layout.h);
  if (p.extent > layout.w) throw new Error(`${layout.id}: ${p.extent}px wide > ${layout.w}`);
  for (const r of p.rows) {
    if (r.y + p.digitH > layout.h) throw new Error(`${layout.id}: digits overflow height`);
  }
}
console.log('layout checks passed');

const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1400, height: 1400 } });
await page.setContent('<body style="margin:0;background:#0b0e11"></body>');

const shots = await page.evaluate(
  ({ SEGMENTS, DIGIT_SEGMENTS, FONT, ADVANCE, JOBS, PLANS }) => {
    const SCALE = 9, DOT = 3.4, ON = 96;
    const poly = (pts) => pts.split(' ').map((p) => p.split(',').map(Number));

    function digit(c, ch, x, y, h, w, color) {
      c.fillStyle = color;
      for (const name of DIGIT_SEGMENTS[ch] ?? '') {
        c.beginPath();
        poly(SEGMENTS[name]).forEach(([px, py], i) => {
          const cx = x + (px / 100) * w, cy = y + (py / 180) * h;
          if (i) c.lineTo(cx, cy); else c.moveTo(cx, cy);
        });
        c.closePath();
        c.fill();
      }
    }

    // Exact pixels, so glyphs stay crisp through the quantiser.
    function text(c, str, x, y, color) {
      c.fillStyle = color;
      [...str.toUpperCase()].forEach((ch, i) => {
        (FONT[ch] ?? FONT[' ']).forEach((row, ry) => {
          [...row].forEach((bit, rx) => {
            if (bit === '#') c.fillRect(x + i * ADVANCE + rx, y + ry, 1, 1);
          });
        });
      });
    }

    function build(job, p) {
      const { layout, scene } = job;
      const layer = () => {
        const cv = document.createElement('canvas');
        cv.width = layout.w; cv.height = layout.h;
        return cv.getContext('2d');
      };
      const layers = [];

      const sides = [
        { v: scene.a, color: scene.colorA, name: scene.teamA },
        { v: scene.b, color: scene.colorB, name: scene.teamB },
      ];
      const chars = (v) => String(Math.min(Math.max(v, 0), 99)).padStart(2, ' ').split('');

      const w = (str) => str.length * ADVANCE - 1;

      sides.forEach((s, i) => {
        const c = layer();
        const row = p.rows[i];
        let x = row.x;
        for (const ch of chars(s.v)) {
          digit(c, ch, x, row.y, p.digitH, p.digitW, '#fff');
          x += p.digitW + 2;
        }
        if (p.nameH) {
          // Centre the name in its half of the panel, then clamp so a long one
          // is never pushed off the edge.
          const half = layout.w / 2;
          let n = s.name;
          while (w(n) > half - 2 && n.length > 3) n = n.slice(0, -1);
          const nx = Math.round(
            Math.min(Math.max(i * half + (half - w(n)) / 2, 1), layout.w - w(n) - 1),
          );
          text(c, n, nx, 1, '#fff');
        }
        layers.push({ color: s.color, img: c.getImageData(0, 0, layout.w, layout.h) });
      });

      const mc = layer();
      const marker = `R${scene.round}`;
      text(mc, marker, Math.round((layout.w - w(marker)) / 2), p.mid.y, '#fff');
      layers.push({ color: '#8b98a5', img: mc.getImageData(0, 0, layout.w, layout.h) });
      return layers;
    }

    function paint(layers, layout) {
      const out = document.createElement('canvas');
      out.width = layout.w * SCALE; out.height = layout.h * SCALE;
      const g = out.getContext('2d');
      g.fillStyle = '#07090a';
      g.fillRect(0, 0, out.width, out.height);
      for (let y = 0; y < layout.h; y++) {
        for (let x = 0; x < layout.w; x++) {
          const i = (y * layout.w + x) * 4;
          const hit = layers.find((l) => l.img.data[i + 3] > ON);
          g.beginPath();
          g.arc(x * SCALE + SCALE / 2, y * SCALE + SCALE / 2, DOT, 0, Math.PI * 2);
          if (hit) {
            g.shadowColor = hit.color; g.shadowBlur = SCALE * 0.85; g.fillStyle = hit.color;
          } else {
            g.shadowBlur = 0; g.fillStyle = '#15181b';
          }
          g.fill();
        }
      }
      g.shadowBlur = 0;
      g.strokeStyle = 'rgba(255,255,255,0.06)';
      for (let x = 64; x < layout.w; x += 64) {
        g.beginPath(); g.moveTo(x * SCALE, 0); g.lineTo(x * SCALE, out.height); g.stroke();
      }
      for (let y = 32; y < layout.h; y += 32) {
        g.beginPath(); g.moveTo(0, y * SCALE); g.lineTo(out.width, y * SCALE); g.stroke();
      }
      return out;
    }

    return JOBS.map((job, i) => ({
      id: job.layout.id + (job.suffix ?? ''),
      label: job.layout.label,
      data: paint(build(job, PLANS[i]), job.layout).toDataURL('image/png'),
    }));
  },
  { SEGMENTS, DIGIT_SEGMENTS, FONT, ADVANCE,
    JOBS: JOBS.map(({ layout, scene, suffix }) => ({ layout, scene, suffix })),
    PLANS: JOBS.map(({ layout }) => plan(layout.kind, layout.w, layout.h)) },
);

const rows = shots.map((s) => `
  <div style="margin:0 0 24px">
    <div style="font:600 13px system-ui;color:#8b98a5;margin:0 0 7px">${s.label}</div>
    <img src="${s.data}" style="display:block">
  </div>`).join('');
await page.setContent(`<body style="margin:0;padding:24px;background:#0b0e11">${rows}</body>`);
await page.locator('body').screenshot({ path: `${dir}/hub75-preview.png` });
for (const s of shots) {
  await page.setContent(`<body style="margin:0;background:#0b0e11"><img src="${s.data}"></body>`);
  await page.locator('img').screenshot({ path: `${dir}/hub75-${s.id}.png` });
}
await browser.close();
console.log('rendered:', shots.map((s) => s.id).join(', '));
process.exit(0);
