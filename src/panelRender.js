// The HUB75 panel's framebuffer, in JavaScript: a port of
// firmware/hub75/render.h and the parts of board_logic.h it draws from.
//
// Held to the C++ **pixel for pixel** by `npm run test:firmware`, so changing
// render.h fails this file until it is changed to match, and vice versa. Treat
// the two as one thing in two languages. Why it is allowed to exist at all, and
// what the check does and does not cover, is in firmware/hub75/README.md.
//
// Comments here are sparse on purpose: render.h holds the rationale for the
// layout itself, and a copy of it on this side would be free to drift — the
// pixel check compares framebuffers, not prose. What is commented is what only
// applies to the port.

import {
  FONT_ADVANCE,
  FONT_CHARS,
  FONT_H,
  FONT_ROWS,
  FONT_W,
  GLYPH_CHARS,
  GLYPH_DIGIT_H,
  GLYPH_DIGIT_W,
  GLYPH_MASK,
  GLYPH_SEGMENT,
} from './panelGlyphs.js';

// Truncating, because every one of these is an `int` division in render.h and
// the layout constants depend on the remainder being thrown away. Rounding
// instead shifts real pixels — at LEVEL_STALE, blue 237 scales to 55, not 56.
const idiv = (a, b) => Math.trunc(a / b);

export const PANEL_W = 128;
export const PANEL_H = 32;

const NAME_Y = 0;
export const DIGIT_Y = 10;
const DIGIT_GAP = 2;
const PAIR_W = GLYPH_DIGIT_W * 2 + DIGIT_GAP;
const VERSUS_PAD = 3;
const NAME_REGION_W = idiv(PANEL_W - FONT_W - 2 * VERSUS_PAD, 2);
export const NAME_CHARS = idiv(NAME_REGION_W, FONT_ADVANCE);
const SIDE_MARGIN = 16;
const LEFT_X = SIDE_MARGIN;
const RIGHT_X = PANEL_W - SIDE_MARGIN - PAIR_W;
const ROUND_Y = DIGIT_Y + 2;
const TARGET_Y = DIGIT_Y + 11;
export const UNDERLINE_Y = FONT_H + 1;

const LEVEL_LIVE = 255;
const LEVEL_STALE = 60;
export const LIVE_GRACE_MS = 30000;
// Mirrors WINNER_BLINK in sketch.ino. Not in render.h — `blinkOn` is an input
// there — so nothing checks this one; it is the beat, not the drawing.
export const WINNER_BLINK = 500;

const MARKER_COLOR = { r: 0x9a, g: 0xa7, b: 0xb4 };
const WHITE = { r: 255, g: 255, b: 255 };
export const TEAM_LABEL_MAX = 40;

const SPACE = 0x20;
const AMPERSAND = 0x26;
const SLASH = 0x2f;
const DASH = 0x2d;
const encoder = new TextEncoder();
const codes = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const GLYPH_CODES = codes(GLYPH_CHARS);
const FONT_CODES = codes(FONT_CHARS);
const VERSUS = codes('V');

// Unknown characters fall back to index 0 — a space in both tables — rather
// than being skipped, so a name the font can't draw still takes up its slots.
function glyphIndex(code) {
  const i = GLYPH_CODES.indexOf(code);
  return i < 0 ? 0 : i;
}

function fontIndex(code) {
  const upper = code >= 0x61 && code <= 0x7a ? code - 0x20 : code;
  const i = FONT_CODES.indexOf(upper);
  return i < 0 ? 0 : i;
}

export function createFramebuffer() {
  return {
    w: PANEL_W,
    h: PANEL_H,
    data: new Uint8Array(PANEL_W * PANEL_H * 3),
    outOfBounds: 0,
  };
}

function px(fb, x, y, color) {
  if (x < 0 || y < 0 || x >= fb.w || y >= fb.h) {
    fb.outOfBounds += 1;
    return;
  }
  const o = (y * fb.w + x) * 3;
  fb.data[o] = color.r;
  fb.data[o + 1] = color.g;
  fb.data[o + 2] = color.b;
}

const scaled = (c, level) => ({
  r: idiv(c.r * level, 255),
  g: idiv(c.g * level, 255),
  b: idiv(c.b * level, 255),
});

function drawText(fb, bytes, x, y, color, maxChars) {
  for (let i = 0; i < bytes.length && i < maxChars; i += 1) {
    const rows = FONT_ROWS[fontIndex(bytes[i])];
    for (let ry = 0; ry < FONT_H; ry += 1) {
      for (let rx = 0; rx < FONT_W; rx += 1) {
        if (rows[ry] & (1 << rx)) px(fb, x + i * FONT_ADVANCE + rx, y + ry, color);
      }
    }
  }
}

function textWidth(bytes, maxChars) {
  const n = Math.min(bytes.length, maxChars);
  return n ? n * FONT_ADVANCE - 1 : 0;
}

function drawDigit(fb, code, x, y, color) {
  const mask = GLYPH_MASK[glyphIndex(code)];
  for (let s = 0; s < 7; s += 1) {
    if (!(mask & (1 << s))) continue;
    for (let ry = 0; ry < GLYPH_DIGIT_H; ry += 1) {
      const bits = GLYPH_SEGMENT[s][ry];
      if (!bits) continue;
      for (let rx = 0; rx < GLYPH_DIGIT_W; rx += 1) {
        if (bits & (1 << rx)) px(fb, x + rx, y + ry, color);
      }
    }
  }
}

// ------------------------------------------------------------------ state --
//
// The coercions here are parseBoardState's, not JavaScript's: ArduinoJson hands
// the renderer ints and single chars, so a fractional round or a `winner` of
// "away" has to land the same way on both sides.

// `+ 0` normalises the -0 that Math.trunc returns for -0.5, which a C++ cast to
// int does not produce. Nothing downstream renders it differently, but leaving it
// makes the two sides compare unequal for no reason.
const intOf = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) + 0 : 0;
};

// Only the first character is looked at, as the firmware does, so "away" is
// team 'a' on both sides rather than a winner on one and none on the other.
const teamOf = (v) => {
  const c = typeof v === 'string' ? v[0] : '';
  return c === 'a' || c === 'b' ? c : null;
};

// Bytes, not a string, because UTF-8 is what reaches the board: a name the 5x7
// font has no glyph for draws as spaces, and this cut lands mid-character. Both
// are the firmware's limits, and showing them is the point.
//
// Truncated to what its char buffer holds rather than to what the panel can
// draw — render.h shortens an oversized label by cutting *both* names, which
// needs the whole thing.
export function labelBytes(label) {
  const bytes = encoder.encode(typeof label === 'string' ? label : '');
  return bytes.subarray(0, Math.min(bytes.length, TEAM_LABEL_MAX - 1));
}

// Anything unparseable stays white, so a missing or malformed colour shows a
// readable score rather than a black one.
export function parseColor(hex) {
  if (typeof hex !== 'string' || hex[0] !== '#') return WHITE;
  let v = 0;
  for (let i = 1; i <= 6; i += 1) {
    const c = hex[i];
    let d;
    if (c >= '0' && c <= '9') d = c.charCodeAt(0) - 0x30;
    else if (c >= 'a' && c <= 'f') d = c.charCodeAt(0) - 0x57;
    else if (c >= 'A' && c <= 'F') d = c.charCodeAt(0) - 0x37;
    else return WHITE;
    v = (v << 4) | d;
  }
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

export function boardState(payload) {
  const p = payload ?? {};
  return {
    a: intOf(p.a),
    b: intOf(p.b),
    round: intOf(p.round),
    target: intOf(p.target),
    winner: teamOf(p.winner),
    first: teamOf(p.first),
    teamA: labelBytes(p.teamA),
    teamB: labelBytes(p.teamB),
    colorA: parseColor(p.colorA),
    colorB: parseColor(p.colorB),
  };
}

// Blank-padded rather than zero-padded, and clamped because the board
// physically cannot show three digits.
function formatDigits(a, b) {
  const out = new Uint8Array(4);
  const pair = (value, at) => {
    const v = Math.min(Math.max(value, 0), 99);
    out[at] = v >= 10 ? 0x30 + idiv(v, 10) : SPACE;
    out[at + 1] = 0x30 + (v % 10);
  };
  pair(a, 0);
  pair(b, 2);
  return out;
}

// `lastLive` is when the link was last actually up, or 0 if never. The C++
// relies on unsigned wrap to survive millis() overflowing at ~49 days; these are
// Date.now() stamps, so there is no wrap to survive and a `lastLive` in the
// future simply reads as live.
export function liveWithGrace(connected, now, lastLive) {
  if (connected) return true;
  if (lastLive === 0) return false;
  return now - lastLive < LIVE_GRACE_MS;
}

// What the board would show, given the link. `dimAt` is when to look again, or
// null if the answer cannot change on its own — so a caller schedules one timer
// rather than polling.
//
// The firmware refreshes `lastLive` every pass of loop() while the link is up,
// so **the grace runs from the drop, not from the connect**. A caller that
// stamps `lastLive` when the link arrives instead makes the grace expire mid-
// session and dims the moment the socket goes; `boardLiveness` is pure so that
// is a unit test rather than something you notice on a phone.
export function boardLiveness({ connected, senderOnline, now, lastLive }) {
  // `senderOnline` is the retained presence flag: the firmware ands it in
  // outside the grace, so a scorer that said goodbye dims at once.
  if (!senderOnline) return { live: false, dimAt: null };
  if (connected) return { live: true, dimAt: null };
  if (!liveWithGrace(false, now, lastLive)) return { live: false, dimAt: null };
  return { live: true, dimAt: lastLive + LIVE_GRACE_MS };
}

// --------------------------------------------------------- doubles names --

function splitPair(bytes) {
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === SPACE && bytes[i + 1] === AMPERSAND && bytes[i + 2] === SPACE) {
      return { firstLen: i, second: bytes.subarray(i + 3) };
    }
  }
  return null;
}

function abbreviatedLen(bytes, k) {
  const split = splitPair(bytes);
  if (!split) return Math.min(bytes.length, k);
  return Math.min(split.firstLen, k) + 1 + Math.min(split.second.length, k);
}

// Returns where the slash landed, or -1 for a singles label. Callers must take
// that index rather than re-finding it: a player called "N/A" has one of their own.
function writeAbbreviated(bytes, k, cap) {
  const out = [];
  const put = (c) => {
    if (out.length < cap - 1) out.push(c);
  };
  const split = splitPair(bytes);
  let joinAt = -1;
  if (!split) {
    for (let i = 0; i < bytes.length && i < k; i += 1) put(bytes[i]);
  } else {
    for (let i = 0; i < split.firstLen && i < k; i += 1) put(bytes[i]);
    joinAt = out.length;
    put(SLASH);
    for (let i = 0; i < split.second.length && i < k; i += 1) put(split.second[i]);
  }
  return { bytes: Uint8Array.from(out), joinAt };
}

function fitLabel(bytes, cap) {
  for (let k = TEAM_LABEL_MAX; k >= 1; k -= 1) {
    if (abbreviatedLen(bytes, k) <= NAME_CHARS) return writeAbbreviated(bytes, k, cap);
  }
  return writeAbbreviated(bytes, 1, cap);
}

// Null when that half came out empty, which a blank player name does.
function labelPart(fitted, joinAt, which) {
  if (joinAt < 0) return null;
  const start = which === 0 ? 0 : joinAt + 1;
  const len = which === 0 ? joinAt : fitted.length - joinAt - 1;
  return len > 0 ? { start, len } : null;
}

function drawSide(fb, name, joinAt, pair, pairX, regionX, color, showScore, throwsFirst, upPartner) {
  const w = textWidth(name, NAME_CHARS);
  let nx = regionX + idiv(NAME_REGION_W - w, 2);
  if (nx < 0) nx = 0;
  if (nx + w > PANEL_W) nx = PANEL_W - w;
  drawText(fb, name, nx, NAME_Y, color, NAME_CHARS);
  if (throwsFirst) {
    let start = 0;
    let len = Math.min(name.length, NAME_CHARS);
    const part = labelPart(name, joinAt, upPartner);
    if (part) {
      start = part.start;
      len = part.len;
    }
    const x0 = nx + start * FONT_ADVANCE;
    const x1 = x0 + len * FONT_ADVANCE - 1;
    for (let x = x0; x < x1; x += 1) px(fb, x, UNDERLINE_Y, color);
  }
  if (!showScore) return;
  drawDigit(fb, pair[0], pairX, DIGIT_Y, color);
  drawDigit(fb, pair[1], pairX + GLYPH_DIGIT_W + DIGIT_GAP, DIGIT_Y, color);
}

export function renderBoard(fb, s, haveState, live, blinkOn) {
  const level = live ? LEVEL_LIVE : LEVEL_STALE;
  const grey = scaled(MARKER_COLOR, level);

  if (!haveState) {
    for (let i = 0; i < 2; i += 1) {
      drawDigit(fb, DASH, LEFT_X + i * (GLYPH_DIGIT_W + DIGIT_GAP), DIGIT_Y, grey);
      drawDigit(fb, DASH, RIGHT_X + i * (GLYPH_DIGIT_W + DIGIT_GAP), DIGIT_Y, grey);
    }
    return fb;
  }

  const digits = formatDigits(s.a, s.b);
  const a = fitLabel(s.teamA, NAME_CHARS + 1);
  const b = fitLabel(s.teamB, NAME_CHARS + 1);

  // Which partner is up, mirroring activeIdx in App.jsx. Derived from the round
  // rather than published, because the app derives it the same way.
  const upPartner = s.round % 2;

  // Once the game is won nobody is throwing, so the rule comes off.
  drawSide(fb, a.bytes, a.joinAt, digits, LEFT_X, 0, scaled(s.colorA, level),
    !(s.winner === 'a' && !blinkOn), s.winner === null && s.first === 'a', upPartner);
  drawSide(fb, b.bytes, b.joinAt, digits.subarray(2), RIGHT_X, PANEL_W - NAME_REGION_W,
    scaled(s.colorB, level), !(s.winner === 'b' && !blinkOn),
    s.winner === null && s.first === 'b', upPartner);

  drawText(fb, VERSUS, idiv(PANEL_W - FONT_W, 2), NAME_Y, grey, 1);

  {
    // `round` counts rounds *completed*, so the one being played is the next
    // one — except once the game is won, when there is no next.
    let r = s.round + (s.winner ? 0 : 1);
    if (r > 99) r = 99;
    const marker = [0x52];
    if (r >= 10) marker.push(0x30 + idiv(r, 10), 0x30 + (r % 10));
    else marker.push(0x30 + r);
    drawText(fb, marker, idiv(PANEL_W - textWidth(marker, 4), 2), ROUND_Y, grey, 4);
  }

  if (s.target > 0) {
    // The app caps the target at 99, so "TO 99" is the widest this line gets.
    const t = s.target > 99 ? 99 : s.target;
    const label = [0x54, 0x4f, SPACE];
    if (t >= 10) label.push(0x30 + idiv(t, 10));
    label.push(0x30 + (t % 10));
    drawText(fb, label, idiv(PANEL_W - textWidth(label, 8), 2), TARGET_Y, grey, 8);
  }

  return fb;
}
