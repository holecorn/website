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
  GLYPH_BIG,
  GLYPH_CHARS,
  GLYPH_MASK,
  GLYPH_SMALL,
} from './panelGlyphs.js';
import {
  LOGO_CORN,
  LOGO_CORN_LETTERS,
  LOGO_H,
  LOGO_HOLE,
  LOGO_HOLE_LETTERS,
  LOGO_LETTERS,
  LOGO_LEVELS,
  LOGO_W,
} from './panelLogo.js';

// Truncating, because every one of these is an `int` division in render.h and
// the layout constants depend on the remainder being thrown away. Rounding
// instead shifts real pixels — at LEVEL_STALE, blue 237 scales to 55, not 56.
const idiv = (a, b) => Math.trunc(a / b);

export const PANEL_W = 128;
export const PANEL_H = 32;

const NAME_Y = 0;
export const DIGIT_Y = 10;
const DIGIT_GAP = 2;
const PAIR_W = GLYPH_SMALL.w * 2 + DIGIT_GAP;
const VERSUS_PAD = 3;
const NAME_REGION_W = idiv(PANEL_W - FONT_W - 2 * VERSUS_PAD, 2);
export const NAME_CHARS = idiv(NAME_REGION_W, FONT_ADVANCE);
const SIDE_MARGIN = 16;
const LEFT_X = SIDE_MARGIN;
const RIGHT_X = PANEL_W - SIDE_MARGIN - PAIR_W;
const ROUND_Y = DIGIT_Y + 2;
const TARGET_Y = DIGIT_Y + 11;
export const UNDERLINE_Y = FONT_H + 1;

const SCORE_DIGIT_Y = 0;
const SCORE_PAIR_W = GLYPH_BIG.w * 2 + DIGIT_GAP;
const SCORE_MARGIN = 6;
const SCORE_LEFT_X = SCORE_MARGIN;
const SCORE_RIGHT_X = PANEL_W - SCORE_MARGIN - SCORE_PAIR_W;
const SCORE_ROUND_Y = 6;
const SCORE_TARGET_Y = 17;
const SCORE_RULE_Y = PANEL_H - 1;

const FORM_ROW_H = FONT_H + 1;
const FORM_COL_GAP = 3;
const FORM_PIPS = 5;
const FORM_PIP = 3;
const FORM_PIP_PITCH = 4;
const FORM_PIPS_W = FORM_PIPS * FORM_PIP_PITCH - 1;
const FORM_PIPS_X = PANEL_W - FORM_PIPS_W;
// Buffer widths in render.h; here only the cut lengths matter. The number columns are
// sized per lineup by formLayout, not fixed — see render.h for why.
const FORM_WL_MAX = 7;
const FORM_PPR_MAX = 4;

// How long the board shows the wordmark at power-on. Mirrored in sketch.ino, the
// same way WINNER_BLINK is: the firmware owns the value, this is the emulator's copy.
// The throws are the other way round — they are drawing, so render.h owns them and this
// is the copy the pixel check holds.
export const SPLASH_MS = 5000;
export const SPLASH_BOARDS = 2;
export const SPLASH_THROWS = SPLASH_BOARDS * LOGO_LETTERS;
const SPLASH_FLIGHT_MS = 420;
const SPLASH_APEX = 6;
const SPLASH_SKID = 4;
const SPLASH_SKID_MS = 220;
// One flight, so a bag touches down as the next is let go — see render.h.
const SPLASH_STAGGER_MS = SPLASH_FLIGHT_MS;
const SPLASH_THUMP = 1;
const SPLASH_THUMP_MS = 70;
export const SPLASH_ANIM_MS =
  (SPLASH_THROWS - 1) * SPLASH_STAGGER_MS + SPLASH_FLIGHT_MS + SPLASH_SKID_MS;

// The board's redraw rate while the splash is up, mirrored from sketch.ino for the same
// reason SPLASH_MS is. The emulator steps the animation's clock in these increments, so
// it draws the frames the panel draws rather than the ones a 60Hz browser could.
export const SPLASH_RENDER_INTERVAL = 25;

export const SPLASH_DOT = 2;
const SPLASH_DOT_X = PANEL_W - SPLASH_DOT;
const SPLASH_DOT_Y = 0;
const SPLASH_CONNECT = [
  { r: 0xeb, g: 0x57, b: 0x57 },
  { r: 0xf2, g: 0xc9, b: 0x4c },
  { r: 0x27, g: 0xae, b: 0x60 },
];
export const SPLASH_CONNECT_STATES = SPLASH_CONNECT.length;
const CHALK_PCT = 28;

export const LINEUP_MAX = 4;
const LINEUP_NAME_MAX = 49;
export const LINEUP_FORM_MAX = 5;

// Ids as published on holecorn/<code>/layout. Mirrors PANEL_LAYOUT_IDS in
// board_logic.h; the order is the enum, so don't reorder it. The form screen has
// no id and is deliberately not here: it is chosen by a lineup being retained,
// not by the scorer, so it must not appear in the layout button's cycle.
export const PANEL_LAYOUTS = ['full', 'score'];

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

function drawDigit(fb, code, x, y, color, font) {
  const mask = GLYPH_MASK[glyphIndex(code)];
  for (let s = 0; s < 7; s += 1) {
    if (!(mask & (1 << s))) continue;
    for (let ry = 0; ry < font.h; ry += 1) {
      const bits = font.segments[s][ry];
      if (!bits) continue;
      for (let rx = 0; rx < font.w; rx += 1) {
        // >>> 0 because a 17-bit mask shifted left is still safe, but the C++
        // reads these as uint32_t and a bare & would sign-extend past bit 30.
        if ((bits & (1 << rx)) >>> 0) px(fb, x + rx, y + ry, color);
      }
    }
  }
}

function drawPair(fb, pair, x, y, color, font) {
  drawDigit(fb, pair[0], x, y, color, font);
  drawDigit(fb, pair[1], x + font.w + DIGIT_GAP, y, color, font);
}

function drawRule(fb, x0, x1, y, color) {
  for (let x = x0; x < x1; x += 1) px(fb, x, y, color);
}

function drawBlock(fb, x, y, w, h, color) {
  for (let dy = 0; dy < h; dy += 1) for (let dx = 0; dx < w; dx += 1) px(fb, x + dx, y + dy, color);
}

function drawTextRight(fb, bytes, right, y, color, maxChars) {
  drawText(fb, bytes, right - textWidth(bytes, maxChars), y, color, maxChars);
}

const clampInt = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function formatTenths(tenths) {
  const t = clampInt(tenths, 0, 999);
  const whole = idiv(t, 10);
  const out = [];
  if (whole >= 10) out.push(0x30 + idiv(whole, 10));
  out.push(0x30 + (whole % 10), 0x2e, 0x30 + (t % 10));
  return out;
}

function formatRecord(wins, losses) {
  const out = [];
  const put = (v) => {
    const c = clampInt(v, 0, 999);
    if (c >= 100) out.push(0x30 + idiv(c, 100));
    if (c >= 10) out.push(0x30 + (idiv(c, 10) % 10));
    out.push(0x30 + (c % 10));
  };
  put(wins);
  out.push(DASH);
  put(losses);
  return out;
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

// ArduinoJson's `row["p"] | -1`: a missing key yields the default. Distinct from
// intOf's 0, which here would be a real average rather than an absent one.
const pprOf = (v) => (v === undefined || v === null ? -1 : intOf(v));

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

// The coercions are parseLineup's, not JavaScript's — the clamps, the truncation
// to what a LineupRow holds, and 'W'-or-loss. Null for anything the firmware
// would refuse, so a bad message leaves the score on screen here too.
export function lineupState(payload) {
  const rows = payload?.rows;
  if (!Array.isArray(rows) || (rows.length !== 2 && rows.length !== LINEUP_MAX)) return null;
  return {
    count: rows.length,
    rows: rows.map((row) => {
      const bytes = encoder.encode(typeof row?.n === 'string' ? row.n : '');
      const form = typeof row?.f === 'string' ? row.f : '';
      return {
        name: bytes.subarray(0, Math.min(bytes.length, LINEUP_NAME_MAX - 1)),
        wins: clampInt(intOf(row?.w), 0, 999),
        losses: clampInt(intOf(row?.l), 0, 999),
        ppr: clampInt(pprOf(row?.p), -1, 999),
        form: Uint8Array.from(
          Array.from(form).slice(0, LINEUP_FORM_MAX),
          (c) => (c === 'W' || c === 'w' ? 0x57 : 0x4c),
        ),
      };
    }),
  };
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
    drawRule(fb, x0, x0 + len * FONT_ADVANCE - 1, UNDERLINE_Y, color);
  }
  if (!showScore) return;
  drawPair(fb, pair, pairX, DIGIT_Y, color, GLYPH_SMALL);
}

// The round marker and target line, which both layouts carry — only their rows
// differ.
function drawMarkers(fb, s, grey, roundY, targetY) {
  {
    // `round` counts rounds *completed*, so the one being played is the next
    // one — except once the game is won, when there is no next.
    let r = s.round + (s.winner ? 0 : 1);
    if (r > 99) r = 99;
    const marker = [0x52];
    if (r >= 10) marker.push(0x30 + idiv(r, 10), 0x30 + (r % 10));
    else marker.push(0x30 + r);
    drawText(fb, marker, idiv(PANEL_W - textWidth(marker, 4), 2), roundY, grey, 4);
  }

  if (s.target > 0) {
    // The app caps the target at 99, so "TO 99" is the widest this line gets.
    const t = s.target > 99 ? 99 : s.target;
    const label = [0x54, 0x4f, SPACE];
    if (t >= 10) label.push(0x30 + idiv(t, 10));
    label.push(0x30 + (t % 10));
    drawText(fb, label, idiv(PANEL_W - textWidth(label, 8), 2), targetY, grey, 8);
  }
}

function drawFull(fb, s, level, blinkOn) {
  const digits = formatDigits(s.a, s.b);
  const a = fitLabel(s.teamA, NAME_CHARS + 1);
  const b = fitLabel(s.teamB, NAME_CHARS + 1);
  const upPartner = s.round % 2;

  // Once the game is won nobody is throwing, so the rule comes off.
  drawSide(fb, a.bytes, a.joinAt, digits, LEFT_X, 0, scaled(s.colorA, level),
    !(s.winner === 'a' && !blinkOn), s.winner === null && s.first === 'a', upPartner);
  drawSide(fb, b.bytes, b.joinAt, digits.subarray(2), RIGHT_X, PANEL_W - NAME_REGION_W,
    scaled(s.colorB, level), !(s.winner === 'b' && !blinkOn),
    s.winner === null && s.first === 'b', upPartner);

  const grey = scaled(MARKER_COLOR, level);
  drawText(fb, VERSUS, idiv(PANEL_W - FONT_W, 2), NAME_Y, grey, 1);
  drawMarkers(fb, s, grey, ROUND_Y, TARGET_Y);
}

function drawScore(fb, s, level, blinkOn) {
  const digits = formatDigits(s.a, s.b);
  const colorA = scaled(s.colorA, level);
  const colorB = scaled(s.colorB, level);

  if (!(s.winner === 'a' && !blinkOn)) {
    drawPair(fb, digits, SCORE_LEFT_X, SCORE_DIGIT_Y, colorA, GLYPH_BIG);
  }
  if (!(s.winner === 'b' && !blinkOn)) {
    drawPair(fb, digits.subarray(2), SCORE_RIGHT_X, SCORE_DIGIT_Y, colorB, GLYPH_BIG);
  }

  if (s.winner === null && s.first === 'a') {
    drawRule(fb, SCORE_LEFT_X, SCORE_LEFT_X + SCORE_PAIR_W, SCORE_RULE_Y, colorA);
  }
  if (s.winner === null && s.first === 'b') {
    drawRule(fb, SCORE_RIGHT_X, SCORE_RIGHT_X + SCORE_PAIR_W, SCORE_RULE_Y, colorB);
  }

  drawMarkers(fb, s, scaled(MARKER_COLOR, level), SCORE_ROUND_Y, SCORE_TARGET_Y);
}

function drawPips(fb, form, y, win, loss) {
  const n = Math.min(form.length, FORM_PIPS);
  for (let i = 0; i < n; i += 1) {
    const x = FORM_PIPS_X + (FORM_PIPS - n + i) * FORM_PIP_PITCH;
    if (form[i] === 0x57) drawBlock(fb, x, y + 2, FORM_PIP, FORM_PIP, win);
    else px(fb, x + 1, y + 3, loss);
  }
}

// Mirrors hasRate in board_logic.h, which is where both halves are explained.
const hasRate = (r) => r.ppr >= 0 && r.wins + r.losses > 0;

function formLayout(l) {
  let wlChars = 3;
  let pprChars = 0;
  for (let i = 0; i < l.count && i < LINEUP_MAX; i += 1) {
    const n = Math.min(formatRecord(l.rows[i].wins, l.rows[i].losses).length, FORM_WL_MAX);
    if (n > wlChars) wlChars = n;
    if (hasRate(l.rows[i])) {
      const p = Math.min(formatTenths(l.rows[i].ppr).length, FORM_PPR_MAX);
      if (p > pprChars) pprChars = p;
    }
  }
  const pprRight = FORM_PIPS_X - FORM_COL_GAP;
  const pprW = pprChars > 0 ? pprChars * FONT_ADVANCE - 1 + FORM_COL_GAP : 0;
  const wlRight = pprRight - pprW;
  const nameChars = idiv(wlRight - (wlChars * FONT_ADVANCE - 1) - FORM_COL_GAP, FONT_ADVANCE);
  return { wlChars, pprChars, wlRight, pprRight, nameChars };
}

function drawForm(fb, s, l, level) {
  const colorA = scaled(s.colorA, level);
  const colorB = scaled(s.colorB, level);
  const grey = scaled(MARKER_COLOR, level);
  const y0 = idiv(PANEL_H - l.count * FORM_ROW_H, 2);
  const f = formLayout(l);

  for (let i = 0; i < l.count && i < LINEUP_MAX; i += 1) {
    const r = l.rows[i];
    const color = i < idiv(l.count, 2) ? colorA : colorB;
    const y = y0 + i * FORM_ROW_H;

    drawText(fb, r.name, 0, y, color, f.nameChars);
    drawTextRight(fb, formatRecord(r.wins, r.losses), f.wlRight, y, grey, f.wlChars);
    if (hasRate(r)) {
      drawTextRight(fb, formatTenths(r.ppr), f.pprRight, y, grey, f.pprChars);
    }
    drawPips(fb, r.form, y, color, grey);
  }
}

// Rounds where every other division here truncates, matching render.h's one
// deliberate exception: this is Logo.jsx's Math.round mix, not an int division.
const chalked = (v) => v + idiv((255 - v) * CHALK_PCT + 50, 100);
const chalk = (c) => ({ r: chalked(c.r), g: chalked(c.g), b: chalked(c.b) });

const logoLevel = (row, x) => (row[x >> 1] >> ((x & 1) * 4)) & 0x0f;

const covered = (c, level) => ({
  r: idiv(c.r * level, LOGO_LEVELS),
  g: idiv(c.g * level, LOGO_LEVELS),
  b: idiv(c.b * level, LOGO_LEVELS),
});

const splashThrownAt = (board, slot) => (slot * SPLASH_BOARDS + board) * SPLASH_STAGGER_MS;
const splashLandedAt = (board, slot) => splashThrownAt(board, slot) + SPLASH_FLIGHT_MS;
const splashLanded = (board, slot, elapsed) => elapsed >= splashLandedAt(board, slot);

export function splashThump(board, elapsed) {
  for (let slot = 0; slot < LOGO_LETTERS; slot += 1) {
    const at = splashLandedAt(board, slot);
    if (elapsed >= at && elapsed - at < SPLASH_THUMP_MS) return SPLASH_THUMP;
  }
  return 0;
}

export function splashThrow(rect, dir, board, slot, elapsed) {
  const from = dir < 0 ? -(rect.x1 + 1) : PANEL_W - rect.x0;
  const start = splashThrownAt(board, slot);
  const t = elapsed > 0 ? elapsed : 0;
  if (t <= start) return { dx: from, dy: 0 };

  const e = t - start;
  if (e < SPLASH_FLIGHT_MS) {
    const travel = dir * SPLASH_SKID - from;
    const rise = 4 * SPLASH_APEX * e * (SPLASH_FLIGHT_MS - e);
    return {
      dx: from + idiv(travel * e, SPLASH_FLIGHT_MS),
      dy: -idiv(rise, SPLASH_FLIGHT_MS * SPLASH_FLIGHT_MS),
    };
  }

  const sliding = e - SPLASH_FLIGHT_MS;
  if (sliding >= SPLASH_SKID_MS) return { dx: 0, dy: 0 };
  const left = SPLASH_SKID_MS - sliding;
  return { dx: idiv(dir * SPLASH_SKID * left * left, SPLASH_SKID_MS * SPLASH_SKID_MS), dy: 0 };
}

const splashLetterAt = (letters, x, y) =>
  letters.findIndex((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);

function splashPx(fb, x, y, color, level) {
  if (x < 0 || y < 0 || x >= PANEL_W || y >= PANEL_H) return;
  px(fb, x, y, covered(color, level));
}

function drawSplashBoard(fb, map, letters, order, board, dir, color, elapsed) {
  const thump = splashThump(board, elapsed);

  for (let y = 0; y < LOGO_H; y += 1) {
    for (let x = 0; x < LOGO_W; x += 1) {
      const level = logoLevel(map[y], x);
      if (level === 0 || splashLetterAt(letters, x, y) >= 0) continue;
      splashPx(fb, x, y + thump, color, level);
    }
  }

  for (let slot = 0; slot < LOGO_LETTERS; slot += 1) {
    const r = letters[order[slot]];
    const o = splashThrow(r, dir, board, slot, elapsed);
    const dy = o.dy + (splashLanded(board, slot, elapsed) ? thump : 0);
    for (let y = r.y0; y <= r.y1; y += 1) {
      for (let x = r.x0; x <= r.x1; x += 1) {
        const level = logoLevel(map[y], x);
        if (level > 0) splashPx(fb, x + o.dx, y + dy, color, level);
      }
    }
  }
}

export function drawSplash(fb, colorA, colorB, connect, elapsed, order) {
  drawSplashBoard(fb, LOGO_HOLE, LOGO_HOLE_LETTERS, order[0], 0, -1, chalk(colorA), elapsed);
  drawSplashBoard(fb, LOGO_CORN, LOGO_CORN_LETTERS, order[1], 1, +1, chalk(colorB), elapsed);
  if (connect >= 0 && connect < SPLASH_CONNECT.length) {
    drawBlock(fb, SPLASH_DOT_X, SPLASH_DOT_Y, SPLASH_DOT, SPLASH_DOT, SPLASH_CONNECT[connect]);
  }
}

export function renderBoard(fb, s, haveState, live, blinkOn, layout = 'full', lineup = null) {
  const level = live ? LEVEL_LIVE : LEVEL_STALE;
  const score = layout === 'score';

  if (lineup && lineup.count > 0) {
    drawForm(fb, s, lineup, level);
    return fb;
  }

  if (!haveState) {
    const grey = scaled(MARKER_COLOR, level);
    const font = score ? GLYPH_BIG : GLYPH_SMALL;
    const y = score ? SCORE_DIGIT_Y : DIGIT_Y;
    const dashes = [DASH, DASH];
    drawPair(fb, dashes, score ? SCORE_LEFT_X : LEFT_X, y, grey, font);
    drawPair(fb, dashes, score ? SCORE_RIGHT_X : RIGHT_X, y, grey, font);
    return fb;
  }

  if (score) drawScore(fb, s, level, blinkOn);
  else drawFull(fb, s, level, blinkOn);
  return fb;
}
