// Generates the panel's glyph tables from src/segments.js and the 5x7 font, so
// its digits are the same geometry as the browser display rather than a
// redrawing of it. Run after changing either source:
//
//   node firmware/hub75/generate_glyphs.mjs
//
// Rasterises by testing each pixel centre against the real polygon, so what
// lands in the tables is the quantisation the panel will actually show.
//
// Two outputs, from one rasterisation: glyphs.h for the firmware and
// src/panelGlyphs.js for the browser emulator. Emitting both here is what stops
// the emulator quantising the polygons even slightly differently — a rounding
// difference would show up as a pixel mismatch nobody could explain.
//
// Two digit *sizes*, because the panel layouts trade names for digit height:
// the small one shares the 32 rows with a name row, the big one has them all.
import { writeFileSync } from 'node:fs';
import { SEGMENTS, DIGIT_SEGMENTS } from '../../src/segments.js';
import { FONT, GLYPH_W, GLYPH_H, ADVANCE } from '../../tools/panel-preview/font5x7.mjs';

// The polygons are 100x180, so height drives width: 20 -> 11 and 30 -> 17 are
// both within 2% of that aspect. Anything wider than 32 bits per row would not
// fit the uint32_t the tables are declared as, which caps a digit at 32px wide —
// far past what 128 columns can spend on four of them anyway.
const SIZES = [
  { name: 'SMALL', w: 11, h: 20 },
  { name: 'BIG', w: 17, h: 30 },
];
const VIEW_W = 100, VIEW_H = 180;
const ORDER = 'abcdefg';

const parse = (s) => s.split(' ').map((p) => p.split(',').map(Number));

function inside(poly, x, y) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// One integer per row; bit 0 is the leftmost pixel.
function rasterise(name, W, H) {
  const poly = parse(SEGMENTS[name]);
  const rows = [];
  for (let j = 0; j < H; j++) {
    let bits = 0;
    for (let i = 0; i < W; i++) {
      const x = ((i + 0.5) / W) * VIEW_W;
      const y = ((j + 0.5) / H) * VIEW_H;
      if (inside(poly, x, y)) bits |= 1 << i;
    }
    rows.push(bits);
  }
  return rows;
}

const bitsIn = (rows) => rows.reduce((n, b) => n + b.toString(2).split('1').length - 1, 0);

const fonts = SIZES.map((size) => {
  const segRows = ORDER.split('').map((seg) => rasterise(seg, size.w, size.h));
  return { ...size, segRows, lit: segRows.map(bitsIn) };
});
const MAX_H = Math.max(...SIZES.map((s) => s.h));

// Characters the board can show. The dash shown before any state arrives is
// defined here rather than in segments.js: the browser display has no use for
// one, so the panel is the only caller.
const EXTRA = { '-': 'g' };
const CHARS = ' -0123456789';
const masks = [...CHARS].map((ch) => {
  const segs = EXTRA[ch] ?? DIGIT_SEGMENTS[ch] ?? '';
  let m = 0;
  for (const s of segs) m |= 1 << ORDER.indexOf(s);
  return m;
});
if (!masks[CHARS.indexOf('-')]) throw new Error('dash glyph is empty');

const FONT_CHARS = " &-./'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
// Falling back to FONT[' '] would emit an all-zero glyph, so a character the
// font never had would silently render as a blank that still eats a slot —
// which is exactly what '!' and '.' did before this check existed.
const fontRows = [...FONT_CHARS].map((ch) => {
  const g = FONT[ch];
  if (!g) throw new Error(`FONT_CHARS advertises ${JSON.stringify(ch)}, font5x7 has no glyph`);
  return g.map((row) => [...row].reduce((b, c, i) => (c === '#' ? b | (1 << i) : b), 0));
});

// What a character the font has no glyph for is drawn as. It used to be index 0 — a
// space — so a name in a script the 5x7 font does not cover came out as an empty row and
// read as a fault rather than as a name that cannot be shown. Measured before this: two
// Greek-script names lit 13 pixels of the name row against 181 for two Latin ones.
//
// A dash rather than a new glyph, so the font tables are untouched. Of what the font
// already has, it is the only sensible choice:
//   * `.` is a single pixel and this panel is sized to be read at 7m — a row of nine of
//     them would not be visible at all, which is the problem it is meant to solve.
//   * `/` is taken: `fitLabel` uses it to separate a shortened doubles pair, so a row of
//     them would read as a pair rather than as an unshowable name.
//   * `'` is two pixels and sits high, reading as punctuation rather than a placeholder.
// A dash is five pixels across the middle, so nine of them are an unmistakable bar at any
// distance the board is read from. The cost is that it cannot be told apart from a typed
// hyphen — but a hyphen appears *inside* a name, where a row of nothing but dashes cannot
// be mistaken for one.
//
// Emitted rather than written down twice, because glyphs.h and src/panelRender.js both
// need it and the pixel check compares them byte for byte.
const FONT_UNKNOWN = FONT_CHARS.indexOf('-');
if (FONT_UNKNOWN < 0) throw new Error('FONT_CHARS has no dash to fall back to');

const hex = (n, w) => `0x${n.toString(16).padStart(w, '0')}`;
const hexW = (f) => (f.w > 16 ? 6 : 4);

// Rows past a size's own height are left to C++'s zero-fill and are never read —
// drawDigit loops to the font's own height.
const segmentTable = (f) => `static const uint32_t GLYPH_SEGMENT_${f.name}[7][GLYPH_MAX_H] = {
${f.segRows.map((rows, i) => `  { ${rows.map((r) => hex(r, hexW(f))).join(', ')} },  // ${ORDER[i]}`).join('\n')}
};`;

const out = `// GENERATED by firmware/hub75/generate_glyphs.mjs — do not edit.
// Source: src/segments.js and tools/panel-preview/font5x7.mjs.
#pragma once

#include <stdint.h>

// Seven-segment digits, rasterised from the real polygons at two sizes. One
// uint32_t per row, bit 0 leftmost; rows beyond a size's height are zero.
static const int GLYPH_MAX_H = ${MAX_H};
${fonts
  .map(
    (f) => `// ${f.name}: ${f.w}x${f.h}, lit pixels per segment ${f.lit.join(', ')}.
static const int GLYPH_${f.name}_W = ${f.w};
static const int GLYPH_${f.name}_H = ${f.h};
${segmentTable(f)}`,
  )
  .join('\n\n')}

// Which segments each character lights, indexed by GLYPH_CHARS. Shared by both
// sizes — the mask is which segments, not where they are.
static const char GLYPH_CHARS[] = "${CHARS}";
static const uint8_t GLYPH_MASK[] = { ${masks.map((m) => hex(m, 2)).join(', ')} };

// 5x7 bitmap font. One uint8_t per row, bit 0 leftmost.
static const int FONT_W = ${GLYPH_W};
static const int FONT_H = ${GLYPH_H};
static const int FONT_ADVANCE = ${ADVANCE};
static const char FONT_CHARS[] = "${FONT_CHARS.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}";
static const int FONT_UNKNOWN = ${FONT_UNKNOWN};  // '-', drawn for anything the font lacks
static const uint8_t FONT_ROWS[][${GLYPH_H}] = {
${fontRows.map((rows, i) => `  { ${rows.map((r) => hex(r, 2)).join(', ')} },  // ${FONT_CHARS[i] === ' ' ? 'space' : FONT_CHARS[i]}`).join('\n')}
};

inline int glyphIndex(char c) {
  for (int i = 0; GLYPH_CHARS[i]; i++) if (GLYPH_CHARS[i] == c) return i;
  return 0;
}

// A character the font cannot draw becomes FONT_UNKNOWN, not a space: a name in a script
// this font does not cover would otherwise leave an empty row that reads as a fault.
inline int fontIndex(char c) {
  if (c >= 'a' && c <= 'z') c = char(c - 'a' + 'A');
  for (int i = 0; FONT_CHARS[i]; i++) if (FONT_CHARS[i] == c) return i;
  return FONT_UNKNOWN;
}
`;

// The same tables for src/panelRender.js. Numbers are emitted in decimal rather
// than hex here because nothing reads this by eye — the header above is the one a
// firmware reader opens.
const js = `// GENERATED by firmware/hub75/generate_glyphs.mjs — do not edit.
// Source: src/segments.js and tools/panel-preview/font5x7.mjs.
//
// The firmware's glyphs.h comes out of the same run, so the emulator in
// src/panelRender.js cannot draw a different digit from the panel.

${fonts
  .map(
    (f) => `export const GLYPH_${f.name} = {
  w: ${f.w},
  h: ${f.h},
  segments: [
${f.segRows.map((rows, i) => `    [${rows.join(', ')}], // ${ORDER[i]}`).join('\n')}
  ],
};`,
  )
  .join('\n\n')}

export const GLYPH_CHARS = ${JSON.stringify(CHARS)};
export const GLYPH_MASK = [${masks.join(', ')}];

export const FONT_W = ${GLYPH_W};
export const FONT_H = ${GLYPH_H};
export const FONT_ADVANCE = ${ADVANCE};
export const FONT_CHARS = ${JSON.stringify(FONT_CHARS)};
// Drawn for any character the font has no glyph for. See generate_glyphs.mjs.
export const FONT_UNKNOWN = ${FONT_UNKNOWN};
export const FONT_ROWS = [
${fontRows.map((rows, i) => `  [${rows.join(', ')}], // ${FONT_CHARS[i] === ' ' ? 'space' : FONT_CHARS[i]}`).join('\n')}
];
`;

writeFileSync(new URL('./glyphs.h', import.meta.url), out);
writeFileSync(new URL('../../src/panelGlyphs.js', import.meta.url), js);
console.log(
  `glyphs.h + src/panelGlyphs.js: ${fonts.map((f) => `${f.w}x${f.h}`).join(' and ')} digits, ` +
    `${CHARS.length} masks, ${FONT_CHARS.length} font glyphs`,
);
