// Generates the splash screen's wordmark from public/logo.svg, so the panel shows the
// app's own logo rather than a redrawing of it. Run after changing the SVG or the font:
//
//   npm install --no-save playwright
//   node firmware/hub75/generate_logo.mjs
//
// Playwright is needed because the SVG cannot be rasterised any other way: it is set in
// Bebas Neue and drawn through feTurbulence and feDisplacementMap. That is also why the
// result is baked rather than drawn at run time — none of it exists on an ESP32.
//
// Two outputs from one rasterisation, the same discipline as generate_glyphs.mjs: logo.h
// for the firmware and src/panelLogo.js for the browser emulator.
//
// What comes out is a **coverage map per word**, 4 bits per pixel, not a 1-bit mask. Two
// separate words so the splash can paint each in any colour; coverage rather than on/off
// so the tilted strokes are antialiased instead of staircased. Overlapping pixels — the
// two boxes cross where the V meets — go to CORN, because it is second in the SVG's
// document order and so paints over HOLE there.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

const W = 128, H = 32;

// ------------------------------------------------------------------ geometry --
//
// The app's mark is drawn for a 2.8:1 viewBox and the panel is 4:1, so fitting it as
// authored left 39 of 128 columns unused and the letters at 10px, where Bebas Neue's
// condensed R and N run into themselves. Every number here exists to undo that; the
// wordmark on the panel is deliberately not identical to the one in the app.

// 15 degrees is what the app uses. A rotated box is much taller than its content, and on
// 32 rows that height is what caps the scale — 8 keeps the V legible and costs far less.
const ANGLE = 8;
// The app's 7 leaves the letters touching at this size.
const LETTER_SPACING = 14;
// Around the letters, inside their box, in SVG units.
const BOX_PAD = 8;
// Between the two boxes, at their closest corners.
const BOX_GAP = 6;

// Coverage below this is dropped rather than dimmed. Two reasons, and they agree: an edge
// pixel this faint is indistinguishable from off at PANEL_BRIGHTNESS 40, and keeping them
// pushes the lit-pixel count past DUTY_CEILING — measured, 34.6% at floor 0 against the
// 30% cap. At 0.4 the mark is *below* the hard-masked version on both duty measures
// (25.8% vs 27.2% lit) as well as smoother, because the pixels this drops are the ones a
// hard threshold was promoting to full brightness.
const COVERAGE_FLOOR = 0.4;
// 4 bits, two pixels to a byte.
const LEVELS = 15;

const svgPath = resolve(root, 'public/logo.svg');
const ttfPath = resolve(root, 'public/fonts/BebasNeue-Regular.ttf');
const svgSrc = readFileSync(svgPath, 'utf8');
const ttf = readFileSync(ttfPath);

// Hashes both sources, because the raster depends on the font as much as on the geometry.
// tools/test-firmware.mjs compares this instead of re-running the generator — the glyph
// tables' check regenerates and diffs, but that would put a browser in CI's firmware job,
// which has none.
const sourceSha = createHash('sha256')
  .update(readFileSync(svgPath))
  .update(ttf)
  .digest('hex');

// Substituted by pattern rather than by the value the SVG currently holds, so a change to
// the app's own tilt or spacing cannot silently bypass the panel's. Each one is checked,
// because a miss would leave the app's value in place and be visible only as a slightly
// wrong-looking splash.
// Checked on whether the pattern matched, not on whether the text changed: now that the
// app's own tilt is the panel's, these substitutions are no-ops, and a change-detecting
// guard would fail exactly when the two agree.
function substitute(text, what, pattern, replacement) {
  if (!text.match(pattern)) {
    throw new Error(`could not set the ${what} in public/logo.svg — has its markup changed?`);
  }
  return text.replace(pattern, replacement);
}

// The chalk filter is switched off. At 5 mm pitch its grain cannot make texture — a 1-2px
// stroke has no interior for a dither pattern to live in — so all it does is erode and
// wobble the strokes, which fights the antialiasing this generator exists to keep.
let svg = svgSrc.replace(
  /src:url\(\/fonts\/BebasNeue-Regular\.ttf\) format\('truetype'\)/,
  `src:url(data:font/ttf;base64,${ttf.toString('base64')}) format('truetype')`,
);
svg = substitute(svg, 'chalk filter', /\s*filter="url\(#chalk\)"/g, '');
// Sign preserved, so the two words keep tilting opposite ways whatever the source says.
svg = substitute(svg, 'tilt', /rotate\((-?)[\d.]+\)/g, (_, sign) => `rotate(${sign}${ANGLE})`);
svg = substitute(svg, 'letter spacing', /letter-spacing="[\d.]+"/, `letter-spacing="${LETTER_SPACING}"`);

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 600, height: 300 } });

await page.setContent(`<!doctype html><html><body style="margin:0;background:#000">
  <div id="wrap" style="width:${W}px;height:${H}px;display:flex;align-items:center;justify-content:center">
    ${svg.replace('<svg ', '<svg id="mark" ')}
  </div>
  <canvas id="c" width="${W}" height="${H}"></canvas></body></html>`);
await page.evaluate(() => document.fonts.ready);

// Measurement happens at a fixed scale, not at whatever the authored viewBox implies.
// Glyph metrics are hinted against the device size, so getExtentOfChar below returns
// slightly different advances when the source viewBox changes — which fed through the box
// widths into the raster and moved the output by 33 pixels when the app's mark was
// re-tilted, despite the panel fitting to the mark's own bounds either way. Measured, not
// theorised: regenerating with the old viewBox and the new one gave 1061 lit against 1094.
const MEASURE_VIEWBOX = '0 0 440 160';
const MEASURE_WIDTH = 880;
await page.evaluate(({ vb, w }) => {
  const el = document.getElementById('mark');
  el.setAttribute('viewBox', vb);
  el.style.width = `${w}px`;
  el.style.height = 'auto';
}, { vb: MEASURE_VIEWBOX, w: MEASURE_WIDTH });

// Each box is re-centred on its own letters. SVG counts letter-spacing after the final
// glyph as well, and text-anchor="middle" centres that padded width, so widening the
// spacing walks the glyphs left inside a box that never moves — which is what put the H
// on the frame. Per-character extents rather than the text's getBBox(): that returns the
// em box, so padding its height makes the box taller than the caps need and costs a fifth
// of the scale.
const boxWidths = await page.evaluate(({ pad, ls }) => {
  const out = [];
  for (const g of document.querySelectorAll('#mark g > g')) {
    const text = g.querySelector('text');
    const rect = g.querySelector('rect');
    const last = text.textContent.length - 1;
    const a = text.getExtentOfChar(0);
    const z = text.getExtentOfChar(last);
    const left = Math.min(a.x, z.x);
    // The final character's extent still carries the letter-space that follows it.
    const right = Math.max(a.x + a.width, z.x + z.width) - ls;
    const inkW = right - left;
    rect.setAttribute('x', left - pad);
    rect.setAttribute('width', inkW + 2 * pad);
    out.push(inkW + 2 * pad);
  }
  return out;
}, { pad: BOX_PAD, ls: LETTER_SPACING });

// The source puts the two groups 128 units apart, which was the old box width plus a gap.
// A wider box has to push them apart or they collide in the middle; the boxes tilt
// opposite ways, so what closes first is their facing corners.
await page.evaluate(({ boxW, angle, boxH, gap }) => {
  const rad = (angle * Math.PI) / 180;
  const extent = boxW * Math.cos(rad) + boxH * Math.sin(rad);
  const groups = document.querySelectorAll('#mark g > g');
  const firstX = Number(groups[0].getAttribute('transform').match(/translate\((-?[\d.]+)/)[1]);
  const y = groups[1].getAttribute('transform').match(/translate\(-?[\d.]+ (-?[\d.]+)/)[1];
  groups[1].setAttribute('transform', `translate(${firstX + extent + gap} ${y}) rotate(${-angle})`);
}, { boxW: Math.max(...boxWidths), angle: ANGLE, boxH: 48, gap: BOX_GAP });

// Fitted to the mark's own bounds rather than the authored viewBox, which is the whole
// reason the letters can be this size.
const fit = await page.evaluate(() => {
  const el = document.getElementById('mark');
  const b = el.querySelector('g').getBBox();
  const pad = 3;  // half the stroke, which getBBox does not include, plus a pixel
  el.setAttribute('viewBox', `${b.x - pad} ${b.y - pad} ${b.width + 2 * pad} ${b.height + 2 * pad}`);
  const vb = el.getAttribute('viewBox').split(' ').map(Number);
  const scale = Math.min(128 / vb[2], 32 / vb[3]);
  el.style.width = `${vb[2] * scale}px`;
  el.style.height = `${vb[3] * scale}px`;
  return { scale };
});

const shot = await page.locator('#wrap').screenshot();
const rgba = await page.evaluate(async (b64) => {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
}, shot.toString('base64'));
await browser.close();

// The colours the SVG strokes with, so coverage is a ratio against a known full value.
const FULL = { hole: 0xf2, corn: 0xf1 };

// Which word a pixel belongs to is decided by the dominant channel, not by distance to
// those two hexes: a dim antialiased blue is nearer #f18686 than #69a4f2 in plain RGB,
// which files part of HOLE under CORN.
const hole = Array.from({ length: H }, () => new Uint8Array(W / 2));
const corn = Array.from({ length: H }, () => new Uint8Array(W / 2));
const stats = { hole: 0, corn: 0, partial: 0, minLevel: LEVELS };

for (let i = 0; i < W * H; i++) {
  const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
  if (r + g + b === 0) continue;
  const isHole = b > r;
  const cover = Math.min(1, Math.max(r, g, b) / (isHole ? FULL.hole : FULL.corn));
  if (cover < COVERAGE_FLOOR) continue;
  const level = Math.round(cover * LEVELS);
  if (level === 0) continue;

  const x = i % W, y = Math.trunc(i / W);
  const word = isHole ? hole : corn;
  // Low nibble is the even column, so a row reads left to right in both languages.
  word[y][x >> 1] |= level << ((x & 1) * 4);
  stats[isHole ? 'hole' : 'corn']++;
  if (level < LEVELS) stats.partial++;
  if (level < stats.minLevel) stats.minLevel = level;
}

if (stats.hole === 0 || stats.corn === 0) {
  throw new Error(`one word came out empty (HOLE ${stats.hole}, CORN ${stats.corn}) — did the font load?`);
}

const hex8 = (v) => `0x${v.toString(16).padStart(2, '0')}`;
const rowsC = (rows) => rows.map((r) => `  { ${Array.from(r, hex8).join(', ')} },`).join('\n');
const rowsJs = (rows) => rows.map((r) => `  [${Array.from(r, hex8).join(', ')}],`).join('\n');

const banner = `// GENERATED by firmware/hub75/generate_logo.mjs — do not edit.
// Source: public/logo.svg and public/fonts/BebasNeue-Regular.ttf, re-spaced for 128x32
// and rasterised with the chalk filter off.
//
// One coverage map per word, 4 bits per pixel, two pixels to a byte: the low nibble is
// the even column. Coverage of ${LEVELS} is a fully lit pixel; anything below
// ${Math.round(COVERAGE_FLOOR * 100)}% of full was dropped rather than dimmed.`;

const counts = `HOLE ${stats.hole} px, CORN ${stats.corn} px, ${stats.partial} of them part-lit`;

writeFileSync(
  resolve(here, 'logo.h'),
  `${banner}
// ${counts}.
#pragma once

#include <stdint.h>

static const int LOGO_W = ${W};
static const int LOGO_H = ${H};
static const int LOGO_STRIDE = ${W / 2};
static const int LOGO_LEVELS = ${LEVELS};
// The faintest level that survived COVERAGE_FLOOR. Emitted rather than left implicit so
// test_render.cpp can hold the floor to what was actually applied.
static const int LOGO_MIN_LEVEL = ${stats.minLevel};

// sha256 of the two sources above. tools/test-firmware.mjs checks it rather than
// re-running this generator, which needs a browser.
static const char LOGO_SOURCE_SHA[] = "${sourceSha}";

static const uint8_t LOGO_HOLE[LOGO_H][LOGO_STRIDE] = {
${rowsC(hole)}
};

static const uint8_t LOGO_CORN[LOGO_H][LOGO_STRIDE] = {
${rowsC(corn)}
};
`,
);

writeFileSync(
  resolve(root, 'src/panelLogo.js'),
  `${banner}
// ${counts}.

export const LOGO_W = ${W};
export const LOGO_H = ${H};
export const LOGO_STRIDE = ${W / 2};
export const LOGO_LEVELS = ${LEVELS};
export const LOGO_MIN_LEVEL = ${stats.minLevel};

export const LOGO_SOURCE_SHA = '${sourceSha}';

export const LOGO_HOLE = [
${rowsJs(hole)}
];

export const LOGO_CORN = [
${rowsJs(corn)}
];
`,
);

const lit = stats.hole + stats.corn;
process.stdout.write(
  `logo.h and src/panelLogo.js written — ${counts}\n` +
    `  ${lit} of ${W * H} lit (${((100 * lit) / (W * H)).toFixed(1)}% duty), ` +
    `${fit.scale.toFixed(2)} px per SVG unit\n`,
);
