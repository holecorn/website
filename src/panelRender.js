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
  FONT_UNKNOWN,
  FONT_H,
  FONT_ROWS,
  FONT_W,
  GLYPH_BIG,
  GLYPH_CHARS,
  GLYPH_MASK,
  GLYPH_SMALL,
} from './panelGlyphs.js';
import { CHAMPION_COLOR } from './scoring.js';
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

// Which mark a side gets: none, the player throwing first, or the other player at
// that end. Singles has no `RULE_NEXT` — there is nobody at that end to tell from the
// thrower — and that is read off the label rather than a mode, which the payload
// deliberately does not carry.
const RULE_NONE = 0;
const RULE_FIRST = 1;
const RULE_NEXT = 2;

const BAG = 5;
const BAG_ADVANCE = BAG + 1;

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

const TIE_ROW_H = FONT_H + 1;
const TIE_LINE_CHARS = idiv(PANEL_W, FONT_ADVANCE);
const TIE_INLINE_CHARS = TIE_LINE_CHARS - 1;
const VERSUS_CHARS = 3;
const TIE_SPREAD_TOP = 2;
const TIE_SPREAD_GAP = 6;
const TIE_CUP_MAX = 97;
const TIE_ROUND_MAX = 33;

const DRAW_ROW_H = FONT_H + 1;
const DRAW_LINE_CHARS = idiv(PANEL_W, FONT_ADVANCE);
const DRAW_PAIR_CHARS = idiv(DRAW_LINE_CHARS - VERSUS_CHARS, 2);
const DRAW_ROUND_MAX = 33;
const DRAW_CUP_MAX = 97;
const DRAW_SIDE_MAX = 100;
const DRAW_OPPONENTS_MAX = 2;

// How long the board shows the wordmark at power-on. Mirrored in hub75.ino, the
// same way ANIM_RENDER_INTERVAL is: the firmware owns the value, this is the copy.
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

// The board's redraw rate while anything is moving — the splash's throws, the win
// celebration and the gleam alike — mirrored from hub75.ino for the same reason SPLASH_MS
// is. The emulator steps its clocks in these increments, so it draws the frames the panel
// draws rather than the ones a 60Hz browser could.
export const ANIM_RENDER_INTERVAL = 25;

export const SPLASH_DOT = 2;
const SPLASH_DOT_X = PANEL_W - SPLASH_DOT;
const SPLASH_DOT_Y = 0;
const CHALK_PCT = 28;

// The no-state screen's status line, and the splash dot's colours — one index, shared,
// because two spellings of it could disagree about which end is which. See render.h for
// why the line is words rather than a second dot, and why the dashes stop reading the
// chosen layout. LINK_TEXT is down with the other codes() literals.
export const LINK_NONE = -1;
export const LINK_NO_WIFI = 0;
export const LINK_NO_BROKER = 1;
export const LINK_NO_SCORER = 2;
export const LINK_STATES = 3;
const LINK_CHARS = 18;
const LINK_TEXT_Y = NAME_Y;
const LINK_COLORS = [
  { r: 0xeb, g: 0x57, b: 0x57 },
  { r: 0xf2, g: 0xc9, b: 0x4c },
  { r: 0x27, g: 0xae, b: 0x60 },
];

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
const DRAW_PULLING = codes('PULLING...');
const DRAW_PLAYS = codes('PLAYS');
const DRAW_PLAYS_WINNER = codes('PLAYS WINNER OF');
const DRAW_TITLE = codes('DRAW');
const LINK_TEXT = ['NO WIFI', 'NO BROKER', 'WAITING FOR SCORER'].map(codes);

// Unknown characters fall back to index 0 — a space in both tables — rather
// than being skipped, so a name the font can't draw still takes up its slots.
function glyphIndex(code) {
  const i = GLYPH_CODES.indexOf(code);
  return i < 0 ? 0 : i;
}

// Mirrors glyphs.h's fontIndex, including the fallback: a character the font has no glyph
// for draws FONT_UNKNOWN rather than a space, so a name in a script the 5x7 font does not
// cover reads as unshowable instead of leaving an empty row. The index comes from the
// generator, so the two cannot disagree about which glyph that is.
function fontIndex(code) {
  const upper = code >= 0x61 && code <= 0x7a ? code - 0x20 : code;
  const i = FONT_CODES.indexOf(upper);
  return i < 0 ? FONT_UNKNOWN : i;
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

// What a won game settles into: a band of white sweeping the winner's digits — see
// render.h, which holds why it replaced a blink. Passed through the digit drawing rather
// than washed over the finished frame, because the panel library gives the firmware no way
// to read a pixel back.
const WIN_GLEAM_MS = 1400;
const WIN_GLEAM_W = 5;
const NO_GLEAM = -WIN_GLEAM_W - 1;
const NO_BAND = { head: NO_GLEAM, top: { r: 0, g: 0, b: 0 } };

function gleamBand(x0, x1, level, phase) {
  const span = x1 - x0 + 1 + WIN_GLEAM_W * 2;
  return {
    head: x0 - WIN_GLEAM_W + idiv(span * (phase % WIN_GLEAM_MS), WIN_GLEAM_MS),
    top: scaled(WHITE, level),
  };
}

function gleamed(base, band, x) {
  const k = WIN_GLEAM_W - (band.head - x);
  if (k <= 0 || k > WIN_GLEAM_W) return base;
  const mix = idiv(255 * k, WIN_GLEAM_W);
  return {
    r: base.r + idiv((band.top.r - base.r) * mix, 255),
    g: base.g + idiv((band.top.g - base.g) * mix, 255),
    b: base.b + idiv((band.top.b - base.b) * mix, 255),
  };
}

function drawTextClipped(fb, bytes, x, y, color, maxChars, clipX, band = NO_BAND) {
  for (let i = 0; i < bytes.length && i < maxChars; i += 1) {
    const rows = FONT_ROWS[fontIndex(bytes[i])];
    for (let ry = 0; ry < FONT_H; ry += 1) {
      for (let rx = 0; rx < FONT_W; rx += 1) {
        const cx = x + i * FONT_ADVANCE + rx;
        if (cx >= clipX) continue;
        if (!(rows[ry] & (1 << rx))) continue;
        px(fb, cx, y + ry, band.head === NO_GLEAM ? color : gleamed(color, band, cx));
      }
    }
  }
}

function drawText(fb, bytes, x, y, color, maxChars) {
  drawTextClipped(fb, bytes, x, y, color, maxChars, PANEL_W);
}

function textWidth(bytes, maxChars) {
  const n = Math.min(bytes.length, maxChars);
  return n ? n * FONT_ADVANCE - 1 : 0;
}

function drawDigit(fb, code, x, y, color, font, band = NO_BAND) {
  const mask = GLYPH_MASK[glyphIndex(code)];
  for (let s = 0; s < 7; s += 1) {
    if (!(mask & (1 << s))) continue;
    for (let ry = 0; ry < font.h; ry += 1) {
      const bits = font.segments[s][ry];
      if (!bits) continue;
      for (let rx = 0; rx < font.w; rx += 1) {
        // >>> 0 because a 17-bit mask shifted left is still safe, but the C++
        // reads these as uint32_t and a bare & would sign-extend past bit 30.
        if (!((bits & (1 << rx)) >>> 0)) continue;
        px(fb, x + rx, y + ry, band.head === NO_GLEAM ? color : gleamed(color, band, x + rx));
      }
    }
  }
}

function drawPair(fb, pair, x, y, color, font, band = NO_BAND) {
  drawDigit(fb, pair[0], x, y, color, font, band);
  drawDigit(fb, pair[1], x + font.w + DIGIT_GAP, y, color, font, band);
}

function drawRule(fb, x0, x1, y, color) {
  for (let x = x0; x < x1; x += 1) px(fb, x, y, color);
}

// Every other pixel. Both score layouts mark the player throwing next as well as the
// one throwing first, and this is the only "hollow" a single row can carry — the
// `score` layout has two spare rows under 30px digits, where an outline needs three.
function drawDashedRule(fb, x0, x1, y, color) {
  for (let x = x0; x < x1; x += 2) px(fb, x, y, color);
}

// A bag, 5x5: filled for the player throwing first and an outline for the other
// player at that end. The form screen has the row to carry one where the score
// layouts do not, and it costs a name character there — see render.h.
function drawBag(fb, x, y, color, filled) {
  for (let dy = 0; dy < BAG; dy += 1) {
    for (let dx = 0; dx < BAG; dx += 1) {
      const edge = dx === 0 || dy === 0 || dx === BAG - 1 || dy === BAG - 1;
      if (filled || edge) px(fb, x + dx, y + dy, color);
    }
  }
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

// parseTie's coercions: the round is what makes a tie a tie, so null for a
// message without one leaves whatever is on screen; the cup's name is optional
// and comes out empty. Bytes rather than strings for the same reason a lineup
// row's name is — a label is cut to what the buffer holds, mid-character if that
// is where the cut falls, and the point of the emulator is to see that.
export function tieState(payload) {
  const round = payload?.r;
  if (typeof round !== 'string' || round === '') return null;
  return {
    set: true,
    cup: labelSlice(payload?.t, TIE_CUP_MAX),
    round: labelSlice(round, TIE_ROUND_MAX),
  };
}

function labelSlice(value, max) {
  const bytes = encoder.encode(typeof value === 'string' ? value : '');
  return bytes.subarray(0, Math.min(bytes.length, max - 1));
}

// parseDraw's coercions. A card is a round or a cup, so a message with neither leaves
// whatever is up; a missing name is the beat before it lands, not an empty one, and a cup
// with no round is the opening card.
//
// `d` and `e` are deliberately not read, because the panel draws no progress line — see
// the draw card geometry in render.h. The emulator shows what the panel shows, so it does
// not hold them either.
export function drawState(payload) {
  const round = typeof payload?.r === 'string' ? payload.r : '';
  const cup = typeof payload?.t === 'string' ? payload.t : '';
  if (round === '' && cup === '') return null;
  const name = typeof payload?.n === 'string' ? payload.n : '';
  const opponents = [];
  for (const side of Array.isArray(payload?.o) ? payload.o : []) {
    if (opponents.length >= DRAW_OPPONENTS_MAX) break;
    if (typeof side !== 'string' || side === '') continue;
    opponents.push(labelSlice(side, DRAW_SIDE_MAX));
  }
  return {
    set: true,
    named: name !== '',
    cup: labelSlice(cup, DRAW_CUP_MAX),
    round: labelSlice(round, DRAW_ROUND_MAX),
    name: labelSlice(name, DRAW_SIDE_MAX),
    opponents,
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

function fitLabelTo(bytes, cap, maxChars) {
  for (let k = TEAM_LABEL_MAX; k >= 1; k -= 1) {
    if (abbreviatedLen(bytes, k) <= maxChars) return writeAbbreviated(bytes, k, cap);
  }
  return writeAbbreviated(bytes, 1, cap);
}

function fitLabel(bytes, cap) {
  return fitLabelTo(bytes, cap, NAME_CHARS);
}

// Null when that half came out empty, which a blank player name does.
function labelPart(fitted, joinAt, which) {
  if (joinAt < 0) return null;
  const start = which === 0 ? 0 : joinAt + 1;
  const len = which === 0 ? joinAt : fitted.length - joinAt - 1;
  return len > 0 ? { start, len } : null;
}

function drawSide(fb, name, joinAt, pair, pairX, regionX, color, band, rule, upPartner) {
  const w = textWidth(name, NAME_CHARS);
  let nx = regionX + idiv(NAME_REGION_W - w, 2);
  if (nx < 0) nx = 0;
  if (nx + w > PANEL_W) nx = PANEL_W - w;
  drawText(fb, name, nx, NAME_Y, color, NAME_CHARS);
  if (rule !== RULE_NONE) {
    let start = 0;
    let len = Math.min(name.length, NAME_CHARS);
    const part = labelPart(name, joinAt, upPartner);
    if (part) {
      start = part.start;
      len = part.len;
    }
    const x0 = nx + start * FONT_ADVANCE;
    const x1 = x0 + len * FONT_ADVANCE - 1;
    if (rule === RULE_FIRST) drawRule(fb, x0, x1, UNDERLINE_Y, color);
    else drawDashedRule(fb, x0, x1, UNDERLINE_Y, color);
  }
  drawPair(fb, pair, pairX, DIGIT_Y, color, GLYPH_SMALL, band);
}

// A pair of names is a doubles game, which is the same test `winVerb` makes and is
// why the payload needs no mode. A casual game reads as singles here whatever the
// mode, correctly: both partners are published as one colour word, so there is no
// second player on the board to mark.
function doublesLabels(s) {
  return splitPair(s.teamA) !== null || splitPair(s.teamB) !== null;
}

// Both score layouts mark the side throwing first, and in doubles the one throwing
// after them from the same end.
function ruleFor(s, side) {
  if (s.winner !== null || s.first === null) return RULE_NONE;
  if (s.first === side) return RULE_FIRST;
  return doublesLabels(s) ? RULE_NEXT : RULE_NONE;
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

function drawFull(fb, s, level, gleamMs) {
  const digits = formatDigits(s.a, s.b);
  const a = fitLabel(s.teamA, NAME_CHARS + 1);
  const b = fitLabel(s.teamB, NAME_CHARS + 1);
  const upPartner = s.round % 2;

  // Once the game is won nobody is throwing, so the rules come off.
  const bandA =
    s.winner === 'a' ? gleamBand(LEFT_X, LEFT_X + PAIR_W - 1, level, gleamMs) : NO_BAND;
  const bandB =
    s.winner === 'b' ? gleamBand(RIGHT_X, RIGHT_X + PAIR_W - 1, level, gleamMs) : NO_BAND;

  drawSide(fb, a.bytes, a.joinAt, digits, LEFT_X, 0, scaled(s.colorA, level),
    bandA, ruleFor(s, 'a'), upPartner);
  drawSide(fb, b.bytes, b.joinAt, digits.subarray(2), RIGHT_X, PANEL_W - NAME_REGION_W,
    scaled(s.colorB, level), bandB, ruleFor(s, 'b'), upPartner);

  const grey = scaled(MARKER_COLOR, level);
  drawText(fb, VERSUS, idiv(PANEL_W - FONT_W, 2), NAME_Y, grey, 1);
  drawMarkers(fb, s, grey, ROUND_Y, TARGET_Y);
}

function drawScore(fb, s, level, gleamMs) {
  const digits = formatDigits(s.a, s.b);
  const colorA = scaled(s.colorA, level);
  const colorB = scaled(s.colorB, level);

  const bandA =
    s.winner === 'a'
      ? gleamBand(SCORE_LEFT_X, SCORE_LEFT_X + SCORE_PAIR_W - 1, level, gleamMs)
      : NO_BAND;
  const bandB =
    s.winner === 'b'
      ? gleamBand(SCORE_RIGHT_X, SCORE_RIGHT_X + SCORE_PAIR_W - 1, level, gleamMs)
      : NO_BAND;

  drawPair(fb, digits, SCORE_LEFT_X, SCORE_DIGIT_Y, colorA, GLYPH_BIG, bandA);
  drawPair(fb, digits.subarray(2), SCORE_RIGHT_X, SCORE_DIGIT_Y, colorB, GLYPH_BIG, bandB);

  // No names here to underline, so the rules go under the digit pairs — and no room
  // for a bag either: DIGITS_BIG is 30 rows of a 32-row panel.
  const ruleA = ruleFor(s, 'a');
  const ruleB = ruleFor(s, 'b');
  if (ruleA !== RULE_NONE) {
    const draw = ruleA === RULE_FIRST ? drawRule : drawDashedRule;
    draw(fb, SCORE_LEFT_X, SCORE_LEFT_X + SCORE_PAIR_W, SCORE_RULE_Y, colorA);
  }
  if (ruleB !== RULE_NONE) {
    const draw = ruleB === RULE_FIRST ? drawRule : drawDashedRule;
    draw(fb, SCORE_RIGHT_X, SCORE_RIGHT_X + SCORE_PAIR_W, SCORE_RULE_Y, colorB);
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
  const half = idiv(l.count, 2);
  // Rows are in slot order, so a slot index is a row index. Nothing to mark on a board
  // that has a roster but no score behind it, which is the one screen that can be drawn
  // without a score message.
  const up = s.round % 2;
  const marked = s.first !== null && s.winner === null;
  const firstRow = marked ? (s.first === 'a' ? 0 : half) + up : -1;
  // A four-row lineup is doubles; a two-row one is the singles case that gets no
  // second mark, the same rule the score layouts read off the label.
  const nextRow = marked && l.count === 4 ? (s.first === 'a' ? half : 0) + up : -1;
  // Reserved on every row or the marked one would be the only name indented. Costs a
  // name character: 11 to 10 on an ordinary roster, 7 to 6 at a three-digit record.
  const indent = marked ? BAG_ADVANCE : 0;
  const nameChars = f.nameChars - (marked ? 1 : 0);

  for (let i = 0; i < l.count && i < LINEUP_MAX; i += 1) {
    const r = l.rows[i];
    const color = i < idiv(l.count, 2) ? colorA : colorB;
    const y = y0 + i * FORM_ROW_H;

    if (i === firstRow) drawBag(fb, 0, y + 1, color, true);
    else if (i === nextRow) drawBag(fb, 0, y + 1, color, false);
    drawText(fb, r.name, indent, y, color, nameChars);
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

function drawTextCentred(fb, bytes, y, color, maxChars) {
  drawText(fb, bytes, idiv(PANEL_W - textWidth(bytes, maxChars), 2), y, color, maxChars);
}

function fitSideTo(bytes, cap, maxChars) {
  if (bytes.length <= maxChars) return bytes.subarray(0, Math.min(bytes.length, cap - 1));
  return fitLabelTo(bytes, cap, maxChars).bytes;
}

function fitTieSide(bytes, cap) {
  return fitSideTo(bytes, cap, TIE_LINE_CHARS);
}

function tieSpreads(s) {
  return s.teamA.length + VERSUS_CHARS + s.teamB.length <= TIE_INLINE_CHARS;
}

function drawVersusRow(fb, left, right, y, colorL, colorR, grey, maxChars) {
  const aLen = left.length;
  const bLen = right.length;
  const chars = aLen + VERSUS_CHARS + bLen;
  const x = idiv(PANEL_W - (chars * FONT_ADVANCE - 1), 2);
  drawText(fb, left, x, y, colorL, maxChars);
  drawText(fb, VERSUS, x + (aLen + 1) * FONT_ADVANCE, y, grey, 1);
  drawText(fb, right, x + (aLen + VERSUS_CHARS) * FONT_ADVANCE, y, colorR, maxChars);
}

function drawTieFixture(fb, s, y, colorA, colorB, grey) {
  drawVersusRow(fb, s.teamA, s.teamB, y, colorA, colorB, grey, TIE_LINE_CHARS);
}

function drawTie(fb, s, t, level) {
  const colorA = scaled(s.colorA, level);
  const colorB = scaled(s.colorB, level);
  const grey = scaled(MARKER_COLOR, level);
  const white = scaled(WHITE, level);

  const spread = tieSpreads(s);
  const top = spread ? TIE_SPREAD_TOP : 0;
  drawTextCentred(fb, t.cup, top, grey, TIE_LINE_CHARS);
  drawTextCentred(fb, t.round, top + TIE_ROW_H, white, TIE_LINE_CHARS);

  if (spread) {
    drawTieFixture(fb, s, top + TIE_ROW_H + FONT_H + TIE_SPREAD_GAP, colorA, colorB, grey);
    return;
  }

  drawTextCentred(fb, fitTieSide(s.teamA, TIE_LINE_CHARS + 1), top + TIE_ROW_H * 2, colorA, TIE_LINE_CHARS);
  drawTextCentred(fb, fitTieSide(s.teamB, TIE_LINE_CHARS + 1), top + TIE_ROW_H * 3, colorB, TIE_LINE_CHARS);
}

function drawDrawCard(fb, d, level) {
  const grey = scaled(MARKER_COLOR, level);
  const white = scaled(WHITE, level);

  if (d.round.length === 0) {
    const top = idiv(PANEL_H - 2 * DRAW_ROW_H, 2);
    drawTextCentred(fb, d.cup, top, white, DRAW_LINE_CHARS);
    drawTextCentred(fb, DRAW_TITLE, top + DRAW_ROW_H, grey, DRAW_LINE_CHARS);
    return;
  }

  const matched = d.named && d.opponents.length > 0;
  const rows = matched ? 4 : 2;
  const y0 = idiv(PANEL_H - rows * DRAW_ROW_H, 2);
  drawTextCentred(fb, d.round, y0, grey, DRAW_LINE_CHARS);

  if (!d.named) {
    drawTextCentred(fb, DRAW_PULLING, y0 + DRAW_ROW_H, white, DRAW_LINE_CHARS);
    return;
  }

  drawTextCentred(
    fb,
    fitSideTo(d.name, DRAW_LINE_CHARS + 1, DRAW_LINE_CHARS),
    y0 + DRAW_ROW_H,
    white,
    DRAW_LINE_CHARS,
  );
  if (!matched) return;

  const viaPreliminary = d.opponents.length > 1;
  drawTextCentred(
    fb,
    viaPreliminary ? DRAW_PLAYS_WINNER : DRAW_PLAYS,
    y0 + DRAW_ROW_H * 2,
    grey,
    DRAW_LINE_CHARS,
  );

  if (!viaPreliminary) {
    drawTextCentred(
      fb,
      fitSideTo(d.opponents[0], DRAW_LINE_CHARS + 1, DRAW_LINE_CHARS),
      y0 + DRAW_ROW_H * 3,
      white,
      DRAW_LINE_CHARS,
    );
    return;
  }

  drawVersusRow(
    fb,
    fitSideTo(d.opponents[0], DRAW_PAIR_CHARS + 1, DRAW_PAIR_CHARS),
    fitSideTo(d.opponents[1], DRAW_PAIR_CHARS + 1, DRAW_PAIR_CHARS),
    y0 + DRAW_ROW_H * 3,
    white,
    white,
    grey,
    DRAW_PAIR_CHARS,
  );
}

// ------------------------------------------------------------------- won --
//
// The celebration and what it settles into, both out of one input — see render.h, which
// owns all of this because it is drawing.
const WIN_BAGS = 4;
const WIN_HOLD_MS = 700;
const WIN_THROWS_MS = (WIN_BAGS - 1) * SPLASH_STAGGER_MS + SPLASH_FLIGHT_MS + SPLASH_SKID_MS;
export const WIN_ANIM_MS = WIN_THROWS_MS + WIN_HOLD_MS;
const WIN_WIPE_MS = 700;
const WIN_ROW_GAP = 4;
const WIN_LINE_CHARS = idiv(PANEL_W, FONT_ADVANCE);
const WIN_VERB_ONE = codes(' WINS');
const WIN_VERB_PAIR = codes(' WIN');

const CHAMPION_ROWS = 3;
const CHAMPION_ROW_GAP = 2;
const CHAMPION_ROW_H = FONT_H + CHAMPION_ROW_GAP;
const CHAMPION_TOP = idiv(
  PANEL_H - (CHAMPION_ROWS * FONT_H + (CHAMPION_ROWS - 1) * CHAMPION_ROW_GAP),
  2,
);
const CHAMPION_WIPE_MS = 380;
const CHAMPION_STAGGER_MS = 300;
const CHAMPION_IN_MS = (CHAMPION_ROWS - 1) * CHAMPION_STAGGER_MS + CHAMPION_WIPE_MS;
const CHAMPION_LINE_CHARS = idiv(PANEL_W, FONT_ADVANCE);
const CHAMPION_ONE = codes('CHAMPION');
const CHAMPION_PAIR = codes('CHAMPIONS');
const CHAMPION_RGB = parseColor(CHAMPION_COLOR);

export function winBagAt(i, x0, w) {
  const x = x0 + i * idiv(w - BAG, WIN_BAGS - 1);
  const dir = i % 2 === 0 ? -1 : 1;
  return { x, dir, from: dir < 0 ? -(x + BAG) : PANEL_W - x };
}

function drawFlyingBag(fb, x, y, color) {
  for (let dy = 0; dy < BAG; dy += 1) {
    for (let dx = 0; dx < BAG; dx += 1) {
      const cx = x + dx;
      const cy = y + dy;
      if (cx < 0 || cy < 0 || cx >= PANEL_W || cy >= PANEL_H) continue;
      px(fb, cx, cy, color);
    }
  }
}

function drawWin(fb, s, level, elapsed) {
  const label = s.winner === 'a' ? s.teamA : s.teamB;
  const color = scaled(s.winner === 'a' ? s.colorA : s.colorB, level);
  const verb = splitPair(label) !== null ? WIN_VERB_PAIR : WIN_VERB_ONE;

  const name = fitSideTo(label, WIN_LINE_CHARS + 1, WIN_LINE_CHARS - verb.length);
  const line = new Uint8Array(WIN_LINE_CHARS);
  let n = 0;
  for (let i = 0; i < name.length && n < WIN_LINE_CHARS; i += 1) line[n++] = name[i];
  for (let i = 0; i < verb.length && n < WIN_LINE_CHARS; i += 1) line[n++] = verb[i];
  const row = line.subarray(0, n);

  const w = textWidth(row, WIN_LINE_CHARS);
  const x0 = idiv(PANEL_W - w, 2);
  const nameY = idiv(PANEL_H - (FONT_H + WIN_ROW_GAP + BAG), 2);
  const clipX = elapsed >= WIN_WIPE_MS ? PANEL_W : x0 + idiv(w * elapsed, WIN_WIPE_MS) + 1;
  drawTextClipped(fb, row, x0, nameY, color, WIN_LINE_CHARS, clipX);

  const bagY = nameY + FONT_H + WIN_ROW_GAP;
  for (let i = 0; i < WIN_BAGS; i += 1) {
    const b = winBagAt(i, x0, w);
    const o = bagFlight(b.from, b.dir, elapsed - i * SPLASH_STAGGER_MS);
    drawFlyingBag(fb, b.x + o.dx, bagY + o.dy, color);
  }
}

function drawChampionRow(fb, bytes, y, color, at, band = NO_BAND) {
  if (at < 0) return;
  const w = textWidth(bytes, CHAMPION_LINE_CHARS);
  const x0 = idiv(PANEL_W - w, 2);
  const clipX = at >= CHAMPION_WIPE_MS ? PANEL_W : x0 + idiv(w * at, CHAMPION_WIPE_MS) + 1;
  drawTextClipped(fb, bytes, x0, y, color, CHAMPION_LINE_CHARS, clipX, band);
}

function drawChampion(fb, s, t, level, elapsed) {
  const label = s.winner === 'a' ? s.teamA : s.teamB;
  const grey = scaled(MARKER_COLOR, level);
  const white = scaled(WHITE, level);
  const gold = scaled(CHAMPION_RGB, level);
  const title = splitPair(label) !== null ? CHAMPION_PAIR : CHAMPION_ONE;

  const name = fitSideTo(label, CHAMPION_LINE_CHARS + 1, CHAMPION_LINE_CHARS);
  const nameW = textWidth(name, CHAMPION_LINE_CHARS);
  const nameX = idiv(PANEL_W - nameW, 2);
  const band =
    elapsed > CHAMPION_IN_MS
      ? gleamBand(nameX, nameX + nameW - 1, level, elapsed - CHAMPION_IN_MS)
      : NO_BAND;

  drawChampionRow(fb, t.cup, CHAMPION_TOP, grey, elapsed);
  drawChampionRow(fb, name, CHAMPION_TOP + CHAMPION_ROW_H, gold, elapsed - CHAMPION_STAGGER_MS, band);
  drawChampionRow(fb, title, CHAMPION_TOP + CHAMPION_ROW_H * 2, white, elapsed - CHAMPION_STAGGER_MS * 2);
}

export function splashThump(board, elapsed) {
  for (let slot = 0; slot < LOGO_LETTERS; slot += 1) {
    const at = splashLandedAt(board, slot);
    if (elapsed >= at && elapsed - at < SPLASH_THUMP_MS) return SPLASH_THUMP;
  }
  return 0;
}

// Shared with the win celebration, the way render.h shares it: one flight, one apex, one
// skid, so the board has a single idea of what a bag does in the air.
export function bagFlight(from, dir, e) {
  if (e <= 0) return { dx: from, dy: 0 };
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

export function splashThrow(rect, dir, board, slot, elapsed) {
  const from = dir < 0 ? -(rect.x1 + 1) : PANEL_W - rect.x0;
  const t = elapsed > 0 ? elapsed : 0;
  return bagFlight(from, dir, t - splashThrownAt(board, slot));
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
  if (connect >= 0 && connect < LINK_STATES) {
    drawBlock(fb, SPLASH_DOT_X, SPLASH_DOT_Y, SPLASH_DOT, SPLASH_DOT, LINK_COLORS[connect]);
  }
}

// Which screen the board is on, given what has arrived. Exported because
// `Panel.jsx` captions the emulator with it: the precedence between a tie, a
// lineup and the two score layouts is a rule, and a caption that re-derived it
// could name a screen the canvas is not drawing — which a mutation proved, since
// the frames differ and the words did not.
//
// render.h has the same chain written out rather than calling anything: the
// firmware draws and never captions, and the pixel check is what holds the two
// together.
export function boardScreen({
  haveState,
  layout = 'full',
  lineup = null,
  tie = null,
  draw = null,
  winner = null,
  winMs = 0,
}) {
  if (draw && draw.set) return 'draw';
  if (tie && tie.set && haveState) {
    // A tie card that is still up when a game is won is a *final* — the topic is cleared
    // at the first bag and only a final republishes it. So the board needs no round to
    // compare against and nothing new on the wire; see tiePayload in scoreboard.js.
    if (winner) return winMs < WIN_ANIM_MS ? 'win' : 'champion';
    return 'tie';
  }
  if (lineup && lineup.count > 0) return 'form';
  if (!haveState) return 'no-state';
  // Below the other two retained topics, which are cleared at the first bag and so cannot
  // be up when a game is won — see renderBoard, where the same chain is written out in
  // C++ because the firmware draws and never captions.
  if (winner && winMs < WIN_ANIM_MS) return 'win';
  return layout === 'score' ? 'score' : 'full';
}

export function renderBoard(
  fb,
  s,
  haveState,
  live,
  winMs,
  layout = 'full',
  lineup = null,
  tie = null,
  draw = null,
  connect = LINK_NONE,
) {
  const level = live ? LEVEL_LIVE : LEVEL_STALE;
  const score = layout === 'score';
  const screen = boardScreen({
    haveState,
    layout,
    lineup,
    tie,
    draw,
    winner: s.winner,
    winMs,
  });

  if (screen === 'draw') {
    drawDrawCard(fb, draw, level);
    return fb;
  }

  if (screen === 'tie') {
    drawTie(fb, s, tie, level);
    return fb;
  }

  if (screen === 'form') {
    drawForm(fb, s, lineup, level);
    return fb;
  }

  if (screen === 'no-state') {
    // The full layout's geometry whatever `layout` says — see the LINK_ block above.
    const grey = scaled(MARKER_COLOR, level);
    const dashes = [DASH, DASH];
    drawPair(fb, dashes, LEFT_X, DIGIT_Y, grey, GLYPH_SMALL);
    drawPair(fb, dashes, RIGHT_X, DIGIT_Y, grey, GLYPH_SMALL);
    if (connect >= 0 && connect < LINK_STATES) {
      drawTextCentred(fb, LINK_TEXT[connect], LINK_TEXT_Y, LINK_COLORS[connect], LINK_CHARS);
    }
    return fb;
  }

  if (screen === 'win') {
    drawWin(fb, s, level, winMs);
    return fb;
  }

  if (screen === 'champion') {
    drawChampion(fb, s, tie, level, winMs - WIN_ANIM_MS);
    return fb;
  }

  const gleamMs = s.winner !== null ? winMs - WIN_ANIM_MS : 0;
  if (score) drawScore(fb, s, level, gleamMs);
  else drawFull(fb, s, level, gleamMs);
  return fb;
}
