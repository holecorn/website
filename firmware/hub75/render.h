// Arduino-free on purpose, like board_logic.h, so test_render.cpp can compile
// it on the host — there is no HUB75 simulator. Keep it that way.
//
// A Canvas is anything with:  void px(int x, int y, uint8_t r, uint8_t g, uint8_t b)
#pragma once

#include "board_logic.h"
#include "glyphs.h"

static const int PANEL_W = 128;
static const int PANEL_H = 32;

static const int DIGIT_GAP = 2;

// Stale scores dim rather than blank, the same choice the browser display
// makes, so a board nobody is feeding never looks authoritative.
static const uint8_t LEVEL_LIVE = 255;
static const uint8_t LEVEL_STALE = 60;

// How long a dropped link still counts as live. Without this the board dims the
// instant its own MQTT socket goes, so a phone hotspot with patchy signal makes
// it flicker between bright and dim every minute. Shorter than a round, so a
// genuinely dead link still dims before the next score would have arrived.
static const uint32_t LIVE_GRACE_MS = 30000;

// `lastLive` is when the link was last actually up, or 0 if never. Unsigned
// arithmetic makes the comparison survive the millis() wrap at ~49 days.
inline bool liveWithGrace(bool connected, uint32_t now, uint32_t lastLive) {
  if (connected) return true;
  if (lastLive == 0) return false;
  return now - lastLive < LIVE_GRACE_MS;
}

static const Rgb MARKER_COLOR = {0x9a, 0xa7, 0xb4};

inline Rgb scaled(Rgb c, uint8_t level) {
  return Rgb{uint8_t(c.r * level / 255), uint8_t(c.g * level / 255),
             uint8_t(c.b * level / 255)};
}

// Picks a digit size out of glyphs.h. Both tables are uint32_t rows of
// GLYPH_MAX_H, so one pointer type covers either.
struct DigitFont {
  const uint32_t (*seg)[GLYPH_MAX_H];
  int w;
  int h;
};
static const DigitFont DIGITS_SMALL = {GLYPH_SEGMENT_SMALL, GLYPH_SMALL_W, GLYPH_SMALL_H};
static const DigitFont DIGITS_BIG = {GLYPH_SEGMENT_BIG, GLYPH_BIG_W, GLYPH_BIG_H};

inline int pairWidth(const DigitFont& f) { return f.w * 2 + DIGIT_GAP; }

// ----------------------------------------------------- full layout geometry --
//
// Rows 30-31 stay dark: with a name row above them the digits are width-limited,
// so the spare height buys nothing here. PANEL_SCORE is the layout that spends
// it, by giving up the names.
static const int NAME_Y = 0;
static const int DIGIT_Y = 10;
static const int PAIR_W = GLYPH_SMALL_W * 2 + DIGIT_GAP;

// Reserving a column for the "V" is what costs a name its tenth character. A
// narrower mark that would not was tried: three columns reads as a colon.
static const int VERSUS_PAD = 3;
static const int NAME_REGION_W = (PANEL_W - FONT_W - 2 * VERSUS_PAD) / 2;
static const int NAME_CHARS = NAME_REGION_W / FONT_ADVANCE;

// Centred in their halves would be 20, but that leaves "TO 21" only 5px of
// clearance. 16 buys 9px, for 4px of misalignment under the names — 20mm on a
// 640mm board.
static const int SIDE_MARGIN = 16;
static const int LEFT_X = SIDE_MARGIN;
static const int RIGHT_X = PANEL_W - SIDE_MARGIN - PAIR_W;

static const int ROUND_Y = DIGIT_Y + 2;
static const int TARGET_Y = DIGIT_Y + 11;
static const int UNDERLINE_Y = FONT_H + 1;

// ---------------------------------------------------- score layout geometry --
//
// No names, so the digits take all 32 rows bar the rule: 30px is 150mm at P5
// against the full layout's 100mm, which is the trade this layout exists to
// offer. Width is not the constraint — two 36px pairs and a 44px middle column
// leave the round and target line where they already were.
static const int SCORE_DIGIT_Y = 0;
static const int SCORE_PAIR_W = GLYPH_BIG_W * 2 + DIGIT_GAP;
static const int SCORE_MARGIN = 6;
static const int SCORE_LEFT_X = SCORE_MARGIN;
static const int SCORE_RIGHT_X = PANEL_W - SCORE_MARGIN - SCORE_PAIR_W;
static const int SCORE_ROUND_Y = 6;
static const int SCORE_TARGET_Y = 17;
// Bottom row, with row 30 left as a gap. Without the names there is nothing to
// underline, so who throws next is ruled under their score instead — dropping it
// would make this a different comparison than names-versus-no-names.
static const int SCORE_RULE_Y = PANEL_H - 1;

// ------------------------------------------------------ form layout geometry --
//
// The pre-game screen, drawn while a lineup is retained on the lineup topic. Four
// rows of 5x7 text is the whole panel — a doubles roster leaves no room for a
// heading, which is why there isn't one. Numbers are right-aligned in their columns
// so the four rows line up whatever the values are.
//
// Read at ~4 m rather than the 7 m the score is sized for: 5x7 at P5 is 35 mm
// against the score's 100 mm. That is the trade this screen makes, and it is the
// right one for something you look at while standing around before a game.
static const int FORM_ROW_H = FONT_H + 1;
static const int FORM_COL_GAP = 3;

static const int FORM_PIPS = 5;
static const int FORM_PIP = 3;
static const int FORM_PIP_PITCH = 4;
static const int FORM_PIPS_W = FORM_PIPS * FORM_PIP_PITCH - 1;
static const int FORM_PIPS_X = PANEL_W - FORM_PIPS_W;

// Buffer sizes, not column widths: "999-999" and "99.9" are the widest the clamps in
// parseLineup permit. A real PPR caps at 12.0 — four bags in the hole every round.
static const int FORM_WL_MAX = 7;
static const int FORM_PPR_MAX = 4;

// The number columns are sized to **this lineup**, not to the worst case any lineup
// could hold, and the name takes whatever is left. Sizing for the worst case spent 5
// characters on the record even when every row read "6-4"; measured, adapting gives an
// ordinary roster 11 name characters where a fixed layout gave 8, and still fits a
// three-digit record — which is reachable at about 100 matches — by spending them again.
struct FormLayout {
  int wlChars;
  int pprChars;  // 0 when nobody in the lineup has played, so the column is skipped
  int wlRight;
  int pprRight;
  int nameChars;
};

template <typename Canvas>
void drawText(Canvas& c, const char* s, int x, int y, Rgb color, int maxChars) {
  for (int i = 0; s[i] && i < maxChars; i++) {
    const uint8_t* rows = FONT_ROWS[fontIndex(s[i])];
    for (int ry = 0; ry < FONT_H; ry++) {
      for (int rx = 0; rx < FONT_W; rx++) {
        if (rows[ry] & (1 << rx)) c.px(x + i * FONT_ADVANCE + rx, y + ry, color.r, color.g, color.b);
      }
    }
  }
}

inline int textWidth(const char* s, int maxChars) {
  int n = 0;
  while (s[n] && n < maxChars) n++;
  return n ? n * FONT_ADVANCE - 1 : 0;
}

template <typename Canvas>
void drawDigit(Canvas& c, char ch, int x, int y, Rgb color, const DigitFont& f) {
  const uint8_t mask = GLYPH_MASK[glyphIndex(ch)];
  for (int s = 0; s < 7; s++) {
    if (!(mask & (1 << s))) continue;
    for (int ry = 0; ry < f.h; ry++) {
      const uint32_t bits = f.seg[s][ry];
      if (!bits) continue;
      for (int rx = 0; rx < f.w; rx++) {
        if (bits & (1u << rx)) c.px(x + rx, y + ry, color.r, color.g, color.b);
      }
    }
  }
}

template <typename Canvas>
void drawPair(Canvas& c, const char* pair, int x, int y, Rgb color, const DigitFont& f) {
  drawDigit(c, pair[0], x, y, color, f);
  drawDigit(c, pair[1], x + f.w + DIGIT_GAP, y, color, f);
}

template <typename Canvas>
void drawRule(Canvas& c, int x0, int x1, int y, Rgb color) {
  for (int x = x0; x < x1; x++) c.px(x, y, color.r, color.g, color.b);
}

template <typename Canvas>
void drawBlock(Canvas& c, int x, int y, int w, int h, Rgb color) {
  for (int dy = 0; dy < h; dy++)
    for (int dx = 0; dx < w; dx++) c.px(x + dx, y + dy, color.r, color.g, color.b);
}

// `right` is the exclusive right edge of the column.
template <typename Canvas>
void drawTextRight(Canvas& c, const char* s, int right, int y, Rgb color, int maxChars) {
  drawText(c, s, right - textWidth(s, maxChars), y, color, maxChars);
}

// Tenths into "7.2" / "12.0". The panel has no float formatter and would not want
// one; the payload carries tenths for exactly this reason.
inline void formatTenths(int tenths, char* out) {
  const int t = clampInt(tenths, 0, 999);
  const int whole = t / 10;
  int n = 0;
  if (whole >= 10) out[n++] = char('0' + whole / 10);
  out[n++] = char('0' + whole % 10);
  out[n++] = '.';
  out[n++] = char('0' + t % 10);
  out[n] = '\0';
}

// Up to "999-999". The clamp is repeated here rather than trusted from parseLineup,
// because this writes into a fixed buffer and a scene can be built by hand.
inline void formatRecord(int wins, int losses, char* out) {
  int n = 0;
  const auto put = [&](int v) {
    const int c = clampInt(v, 0, 999);
    if (c >= 100) out[n++] = char('0' + c / 100);
    if (c >= 10) out[n++] = char('0' + (c / 10) % 10);
    out[n++] = char('0' + c % 10);
  };
  put(wins);
  out[n++] = '-';
  put(losses);
  out[n] = '\0';
}

// ------------------------------------------------------------ doubles names --
//
// The app's " & " would cost three of the nine characters a team gets here, so
// the panel re-joins with a slash. Two characters back is the difference
// between most pairs fitting whole and being cut.
static const char PAIR_SEPARATOR[] = " & ";  // what arrives
static const int PAIR_SEPARATOR_LEN = 3;
static const char PAIR_JOIN = '/';  // what is drawn
static const int PAIR_JOIN_LEN = 1;

inline int cStrLen(const char* s) {
  int n = 0;
  while (s[n]) n++;
  return n;
}

// False for a singles label, which has nothing to abbreviate.
inline bool splitPair(const char* label, int& firstLen, const char*& second) {
  for (int i = 0; label[i]; i++) {
    if (label[i] == ' ' && label[i + 1] == '&' && label[i + 2] == ' ') {
      firstLen = i;
      second = label + i + PAIR_SEPARATOR_LEN;
      return true;
    }
  }
  return false;
}

// Measures rather than builds, so fitLabels can search for k cheaply.
inline int abbreviatedLen(const char* label, int k) {
  int firstLen;
  const char* second;
  if (!splitPair(label, firstLen, second)) {
    const int n = cStrLen(label);
    return n < k ? n : k;
  }
  const int secondLen = cStrLen(second);
  return (firstLen < k ? firstLen : k) + PAIR_JOIN_LEN +
         (secondLen < k ? secondLen : k);
}

// Returns the index of the joining slash, or -1 for a singles label. Callers
// need that index rather than searching for it: a player called "N/A" has a
// slash of their own, and re-finding it would treat one name as two.
inline int writeAbbreviated(const char* label, int k, char* dst, int cap) {
  int firstLen;
  const char* second;
  int n = 0;
  int joinAt = -1;
  const auto put = [&](char c) {
    if (n < cap - 1) dst[n++] = c;
  };
  if (!splitPair(label, firstLen, second)) {
    for (int i = 0; label[i] && i < k; i++) put(label[i]);
  } else {
    for (int i = 0; i < firstLen && i < k; i++) put(label[i]);
    joinAt = n;
    put(PAIR_JOIN);
    for (int i = 0; second[i] && i < k; i++) put(second[i]);
  }
  dst[n] = '\0';
  return joinAt;
}

// Each label shortens on its own. One prefix length shared across both teams
// was tried and was wrong: it cut "Lambda" — which fits — to "Lamb" because
// the opposing label was long. Partners within a label do still share one, so
// a shortened pair still looks deliberate.
inline int fitLabel(const char* label, char* out, int cap) {
  for (int k = int(TEAM_LABEL_MAX); k >= 1; k--) {
    if (abbreviatedLen(label, k) <= NAME_CHARS) return writeAbbreviated(label, k, out, cap);
  }
  // Unreachable for a pair — "A/B" is three characters — but a single name
  // longer than the slot still has to land somewhere.
  return writeAbbreviated(label, 1, out, cap);
}

// Span of one half of a fitted label, given where the fit put the join.
// False when that half came out empty, which a blank player name does.
inline bool labelPart(const char* fitted, int joinAt, int which, int& start, int& len) {
  if (joinAt < 0) return false;
  if (which == 0) {
    start = 0;
    len = joinAt;
  } else {
    start = joinAt + 1;
    len = cStrLen(fitted) - joinAt - 1;
  }
  return len > 0;
}

template <typename Canvas>
void drawSide(Canvas& c, const char* name, int joinAt, const char* pair, int pairX,
              int regionX, Rgb color, bool showScore, bool throwsFirst, int upPartner) {
  const int w = textWidth(name, NAME_CHARS);
  int nx = regionX + (NAME_REGION_W - w) / 2;
  if (nx < 0) nx = 0;
  if (nx + w > PANEL_W) nx = PANEL_W - w;
  drawText(c, name, nx, NAME_Y, color, NAME_CHARS);
  // Ruled rather than flagged with a glyph, which would cost a character. In
  // doubles only the partner who is up: ruling the whole label would say two
  // people are throwing.
  if (throwsFirst) {
    int start = 0;
    int len = cStrLen(name);
    if (len > NAME_CHARS) len = NAME_CHARS;
    // Falls back to the whole label when the partner's half is empty, so a
    // blank player name loses the name, not the rule.
    int partStart, partLen;
    if (labelPart(name, joinAt, upPartner, partStart, partLen)) {
      start = partStart;
      len = partLen;
    }
    const int x0 = nx + start * FONT_ADVANCE;
    const int x1 = x0 + len * FONT_ADVANCE - 1;  // matches textWidth
    drawRule(c, x0, x1, UNDERLINE_Y, color);
  }
  if (!showScore) return;
  drawPair(c, pair, pairX, DIGIT_Y, color, DIGITS_SMALL);
}

// The round marker and target line, which both layouts carry — only their rows
// differ. `round` counts rounds *completed*, so the one being played is the next
// one, except once the game is won when there is no next. Display.jsx does the
// same sum; the two must agree, because they render the same retained message
// side by side.
template <typename Canvas>
void drawMarkers(Canvas& c, const BoardState& s, Rgb grey, int roundY, int targetY) {
  {
    int r = s.round + (s.winner ? 0 : 1);
    if (r > 99) r = 99;
    char marker[5] = {'R', 0, 0, 0, 0};
    if (r >= 10) {
      marker[1] = char('0' + r / 10);
      marker[2] = char('0' + r % 10);
    } else {
      marker[1] = char('0' + r);
    }
    drawText(c, marker, (PANEL_W - textWidth(marker, 4)) / 2, roundY, grey, 4);
  }

  if (s.target > 0) {
    // The app caps the target at 99, so two digits is the worst case and
    // "TO 99" is the widest this line ever gets.
    const int t = s.target > 99 ? 99 : s.target;
    char label[8] = {'T', 'O', ' ', 0, 0, 0, 0, 0};
    int n = 3;
    if (t >= 10) label[n++] = char('0' + t / 10);
    label[n++] = char('0' + t % 10);
    drawText(c, label, (PANEL_W - textWidth(label, 8)) / 2, targetY, grey, 8);
  }
}

// Which partner is up, mirroring activeIdx in App.jsx. Derived from the round
// rather than published, because the app derives it the same way.
inline int upPartnerFor(const BoardState& s) { return s.round % 2; }

template <typename Canvas>
void drawFull(Canvas& c, const BoardState& s, uint8_t level, bool blinkOn) {
  char digits[5];
  formatDigits(s.a, s.b, digits);

  char nameA[NAME_CHARS + 1], nameB[NAME_CHARS + 1];
  const int joinA = fitLabel(s.teamA, nameA, NAME_CHARS + 1);
  const int joinB = fitLabel(s.teamB, nameB, NAME_CHARS + 1);
  const int upPartner = upPartnerFor(s);

  // Once the game is won nobody is throwing, so the rule comes off.
  drawSide(c, nameA, joinA, digits, LEFT_X, 0, scaled(s.colorA, level),
           !(s.winner == 'a' && !blinkOn), s.winner == 0 && s.first == 'a', upPartner);
  drawSide(c, nameB, joinB, digits + 2, RIGHT_X, PANEL_W - NAME_REGION_W,
           scaled(s.colorB, level), !(s.winner == 'b' && !blinkOn),
           s.winner == 0 && s.first == 'b', upPartner);

  const Rgb grey = scaled(MARKER_COLOR, level);

  // Belongs to neither team, so it takes the neutral colour.
  drawText(c, "V", (PANEL_W - FONT_W) / 2, NAME_Y, grey, 1);
  drawMarkers(c, s, grey, ROUND_Y, TARGET_Y);
}

template <typename Canvas>
void drawScore(Canvas& c, const BoardState& s, uint8_t level, bool blinkOn) {
  char digits[5];
  formatDigits(s.a, s.b, digits);

  const Rgb colorA = scaled(s.colorA, level);
  const Rgb colorB = scaled(s.colorB, level);

  if (!(s.winner == 'a' && !blinkOn)) {
    drawPair(c, digits, SCORE_LEFT_X, SCORE_DIGIT_Y, colorA, DIGITS_BIG);
  }
  if (!(s.winner == 'b' && !blinkOn)) {
    drawPair(c, digits + 2, SCORE_RIGHT_X, SCORE_DIGIT_Y, colorB, DIGITS_BIG);
  }

  if (s.winner == 0 && s.first == 'a') {
    drawRule(c, SCORE_LEFT_X, SCORE_LEFT_X + SCORE_PAIR_W, SCORE_RULE_Y, colorA);
  }
  if (s.winner == 0 && s.first == 'b') {
    drawRule(c, SCORE_RIGHT_X, SCORE_RIGHT_X + SCORE_PAIR_W, SCORE_RULE_Y, colorB);
  }

  drawMarkers(c, s, scaled(MARKER_COLOR, level), SCORE_ROUND_Y, SCORE_TARGET_Y);
}

// Widest record and widest rate actually present, then the name gets the remainder.
// A record is never narrower than three characters ("0-0"), so a lineup of newcomers
// does not give the name a column it would lose again on the first win.
inline FormLayout formLayout(const LineupState& l) {
  FormLayout f;
  f.wlChars = 3;
  f.pprChars = 0;
  for (int i = 0; i < l.count && i < LINEUP_MAX; i++) {
    char buf[FORM_WL_MAX + 1];
    formatRecord(l.rows[i].wins, l.rows[i].losses, buf);
    const int n = cStrLen(buf);
    if (n > f.wlChars) f.wlChars = n;
    // Only rows that have played contribute a rate, matching what drawForm draws.
    if (l.rows[i].wins + l.rows[i].losses > 0) {
      char rate[FORM_PPR_MAX + 1];
      formatTenths(l.rows[i].ppr, rate);
      const int p = cStrLen(rate);
      if (p > f.pprChars) f.pprChars = p;
    }
  }
  f.pprRight = FORM_PIPS_X - FORM_COL_GAP;
  // No rate column at all costs no gap either, rather than leaving a hole.
  const int pprW = f.pprChars > 0 ? f.pprChars * FONT_ADVANCE - 1 + FORM_COL_GAP : 0;
  f.wlRight = f.pprRight - pprW;
  f.nameChars = (f.wlRight - (f.wlChars * FONT_ADVANCE - 1) - FORM_COL_GAP) / FONT_ADVANCE;
  return f;
}

// A win is a filled block, a loss a single centre pixel. Not a dim block: on a
// real panel an unlit-but-not-off LED is indistinguishable from off, so a loss has
// to be drawn as something rather than as a darker something.
//
// Right-aligned within the five slots, so the newest result is in the same column
// on every row even when a player has fewer than five matches.
template <typename Canvas>
void drawPips(Canvas& c, const char* form, int y, Rgb win, Rgb loss) {
  const int n = cStrLen(form) > FORM_PIPS ? FORM_PIPS : cStrLen(form);
  for (int i = 0; i < n; i++) {
    const int x = FORM_PIPS_X + (FORM_PIPS - n + i) * FORM_PIP_PITCH;
    if (form[i] == 'W') drawBlock(c, x, y + 2, FORM_PIP, FORM_PIP, win);
    else c.px(x + 1, y + 3, loss.r, loss.g, loss.b);
  }
}

// Rows are the lineup in lane order — team A's slots then team B's — so the team
// a row belongs to is which half of the list it is in. parseLineup refuses a count
// it cannot halve, which is what makes that safe rather than a guess.
template <typename Canvas>
void drawForm(Canvas& c, const BoardState& s, const LineupState& l, uint8_t level) {
  const Rgb colorA = scaled(s.colorA, level);
  const Rgb colorB = scaled(s.colorB, level);
  const Rgb grey = scaled(MARKER_COLOR, level);
  // Centred, so a singles pair of rows sits in the middle of the panel rather
  // than clinging to the top.
  const int y0 = (PANEL_H - l.count * FORM_ROW_H) / 2;
  const FormLayout f = formLayout(l);

  for (int i = 0; i < l.count && i < LINEUP_MAX; i++) {
    const LineupRow& r = l.rows[i];
    const Rgb color = i < l.count / 2 ? colorA : colorB;
    const int y = y0 + i * FORM_ROW_H;

    drawText(c, r.name, 0, y, color, f.nameChars);

    char record[FORM_WL_MAX + 1];
    formatRecord(r.wins, r.losses, record);
    drawTextRight(c, record, f.wlRight, y, grey, f.wlChars);

    // Empty only for somebody with no history at all, never for a rate that
    // happens to be zero: 0.0 PPR is a real average — every bag on the floor —
    // and blanking it reads as missing data rather than a miserable Saturday. A
    // newcomer is 0-0 by construction, which is what tells the two apart.
    if (r.wins + r.losses > 0) {
      char ppr[FORM_PPR_MAX + 1];
      formatTenths(r.ppr, ppr);
      drawTextRight(c, ppr, f.pprRight, y, grey, f.pprChars);
    }

    drawPips(c, r.form, y, color, grey);
  }
}

// `blinkOn` is the winner flash beat. The browser hollows the digits instead,
// which at 20px is illegible — a 1px rim around a 2px stroke leaves nothing —
// so the winning pair blanks on alternate beats.
//
// A retained lineup wins over both score layouts, and over the no-state dashes:
// it is only ever published before the first bag, so while it is there the score
// is 0-0 and there is nothing to cover up. The scorer's chosen layout is
// untouched underneath and comes back when the lineup is cleared.
template <typename Canvas>
void renderBoard(Canvas& c, const BoardState& s, bool haveState, bool live, bool blinkOn,
                 PanelLayout layout = PANEL_FULL, const LineupState* lineup = nullptr) {
  const uint8_t level = live ? LEVEL_LIVE : LEVEL_STALE;
  const bool score = layout == PANEL_SCORE;

  if (lineup && lineup->count > 0) {
    drawForm(c, s, *lineup, level);
    return;
  }

  if (!haveState) {
    const Rgb grey = scaled(MARKER_COLOR, level);
    const DigitFont& f = score ? DIGITS_BIG : DIGITS_SMALL;
    const int y = score ? SCORE_DIGIT_Y : DIGIT_Y;
    const char dashes[3] = {'-', '-', '\0'};
    drawPair(c, dashes, score ? SCORE_LEFT_X : LEFT_X, y, grey, f);
    drawPair(c, dashes, score ? SCORE_RIGHT_X : RIGHT_X, y, grey, f);
    return;
  }

  if (score) {
    drawScore(c, s, level, blinkOn);
  } else {
    drawFull(c, s, level, blinkOn);
  }
}
