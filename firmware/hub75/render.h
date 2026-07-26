// Layout and drawing for the 128x32 panel (2 x Waveshare P5 64x32 chained).
//
// Arduino-free on purpose, like board_logic.h: test_render.cpp compiles this on
// the host and dumps PNGs, which is how the layout was checked before any
// hardware existed. Keep it that way — the sketch supplies a Canvas and nothing
// else.
//
// A Canvas is anything with:  void px(int x, int y, uint8_t r, uint8_t g, uint8_t b)
#pragma once

#include "board_logic.h"
#include "glyphs.h"

static const int PANEL_W = 128;
static const int PANEL_H = 32;

// Names on top, scores below. Rows 30-31 are left dark: the digits are
// width-limited at this panel size, so the spare height buys nothing.
static const int NAME_Y = 0;
static const int DIGIT_Y = 10;
static const int DIGIT_GAP = 2;
static const int PAIR_W = GLYPH_DIGIT_W * 2 + DIGIT_GAP;

// A "V" separates the two names, so each gets a little under half the panel
// rather than exactly half. That costs one character — nine rather than ten —
// and the abbreviation below absorbs it.
//
// Squeezing the mark into the 5px gap two ten-character names leave was tried
// and abandoned: three columns is all that fits there, and at three columns it
// reads as a colon rather than a letter. The character buys legibility.
//
// It draws uppercase because fontIndex folds case, so a name typed in mixed
// case renders consistently; a lowercase glyph in the font would also appear
// inside any name containing a v.
static const int VERSUS_PAD = 3;
static const int NAME_REGION_W = (PANEL_W - FONT_W - 2 * VERSUS_PAD) / 2;
static const int NAME_CHARS = NAME_REGION_W / FONT_ADVANCE;

// Digits sit just inside centred-in-their-half. Hard against the edges they
// were a long way from the names centred above them, which reads as a mistake.
// Perfectly centred would be x=20, but that leaves "TO 21" only 5px of
// clearance; 16 buys 9px for 4px of misalignment — 20mm on a 640mm board.
static const int SIDE_MARGIN = 16;
static const int LEFT_X = SIDE_MARGIN;
static const int RIGHT_X = PANEL_W - SIDE_MARGIN - PAIR_W;

// The middle column carries two lines, both inside the digits' rows.
static const int ROUND_Y = DIGIT_Y + 2;
static const int TARGET_Y = DIGIT_Y + 11;

// A rule under the name of whoever throws first, in the gap the names and
// digits leave between them.
static const int UNDERLINE_Y = FONT_H + 1;

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
void drawDigit(Canvas& c, char ch, int x, int y, Rgb color) {
  const uint8_t mask = GLYPH_MASK[glyphIndex(ch)];
  for (int s = 0; s < 7; s++) {
    if (!(mask & (1 << s))) continue;
    for (int ry = 0; ry < GLYPH_DIGIT_H; ry++) {
      const uint16_t bits = GLYPH_SEGMENT[s][ry];
      if (!bits) continue;
      for (int rx = 0; rx < GLYPH_DIGIT_W; rx++) {
        if (bits & (1 << rx)) c.px(x + rx, y + ry, color.r, color.g, color.b);
      }
    }
  }
}

// ------------------------------------------------------------ doubles names --
//
// The app joins a doubles pair with " & ", which costs three of the ten
// characters a team gets here. The panel joins with a slash instead: with two
// characters back, most pairs fit whole that otherwise would not.
//
// What still does not fit shortens *both* names to the longest prefix that
// does, rather than truncating the tail — which would leave the first player
// with their whole name and take the second player's. No name comparison is
// needed to keep them apart: a longer prefix separates at least as well as a
// shorter one, so the longest prefix that fits is also the most distinguishable
// available.
static const char PAIR_SEPARATOR[] = " & ";  // what arrives
static const int PAIR_SEPARATOR_LEN = 3;
static const char PAIR_JOIN = '/';  // what is drawn
static const int PAIR_JOIN_LEN = 1;

inline int cStrLen(const char* s) {
  int n = 0;
  while (s[n]) n++;
  return n;
}

// Finds the first " & ". Returns false for a singles label, which has nothing
// to abbreviate.
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

// Width of the label with each name cut to `k`, without building it.
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

inline void writeAbbreviated(const char* label, int k, char* dst, int cap) {
  int firstLen;
  const char* second;
  int n = 0;
  const auto put = [&](char c) {
    if (n < cap - 1) dst[n++] = c;
  };
  if (!splitPair(label, firstLen, second)) {
    for (int i = 0; label[i] && i < k; i++) put(label[i]);
  } else {
    for (int i = 0; i < firstLen && i < k; i++) put(label[i]);
    put(PAIR_JOIN);
    for (int i = 0; second[i] && i < k; i++) put(second[i]);
  }
  dst[n] = '\0';
}

// Character span of one half of a fitted "X/Y" label. False for a singles
// label, which has no halves to pick between.
inline bool labelPart(const char* fitted, int which, int& start, int& len) {
  int slash = -1;
  for (int i = 0; fitted[i]; i++) {
    if (fitted[i] == PAIR_JOIN) {
      slash = i;
      break;
    }
  }
  if (slash < 0) return false;
  if (which == 0) {
    start = 0;
    len = slash;
  } else {
    start = slash + 1;
    len = cStrLen(fitted) - slash - 1;
  }
  return len > 0;
}

// Both sides share one prefix length so the abbreviation looks deliberate
// rather than like two different failures.
inline void fitLabels(const char* a, const char* b, char* outA, char* outB, int cap) {
  for (int k = int(TEAM_LABEL_MAX); k >= 1; k--) {
    if (abbreviatedLen(a, k) <= NAME_CHARS && abbreviatedLen(b, k) <= NAME_CHARS) {
      writeAbbreviated(a, k, outA, cap);
      writeAbbreviated(b, k, outB, cap);
      return;
    }
  }
  // Unreachable for two names — "A & B" is five characters — but a single name
  // longer than the slot still has to land somewhere.
  writeAbbreviated(a, 1, outA, cap);
  writeAbbreviated(b, 1, outB, cap);
}

// One team: name centred in its half, score pair below.
template <typename Canvas>
void drawSide(Canvas& c, const char* name, const char* pair, int pairX, int regionX,
              Rgb color, bool showScore, bool throwsFirst, int upPartner) {
  const int w = textWidth(name, NAME_CHARS);
  int nx = regionX + (NAME_REGION_W - w) / 2;
  if (nx < 0) nx = 0;
  if (nx + w > PANEL_W) nx = PANEL_W - w;
  drawText(c, name, nx, NAME_Y, color, NAME_CHARS);
  // Underlined rather than flagged with a glyph, which would cost a character
  // the name cannot spare. In doubles only the partner who is up is ruled —
  // underlining the whole label would say the wrong thing, since only one of
  // the two is throwing.
  if (throwsFirst) {
    int start = 0;
    int len = cStrLen(name);
    if (len > NAME_CHARS) len = NAME_CHARS;
    labelPart(name, upPartner, start, len);
    const int x0 = nx + start * FONT_ADVANCE;
    const int x1 = x0 + len * FONT_ADVANCE - 1;  // matches textWidth
    for (int x = x0; x < x1; x++) c.px(x, UNDERLINE_Y, color.r, color.g, color.b);
  }
  if (!showScore) return;
  drawDigit(c, pair[0], pairX, DIGIT_Y, color);
  drawDigit(c, pair[1], pairX + GLYPH_DIGIT_W + DIGIT_GAP, DIGIT_Y, color);
}

// `blinkOn` is the winner flash beat. A seven-segment module can only switch
// whole segments, and at 20px the browser's hollowing is illegible, so the
// winning pair blanks on alternate beats — the same compromise sketch.ino
// already makes for the SevSeg build.
template <typename Canvas>
void renderBoard(Canvas& c, const BoardState& s, bool haveState, bool live, bool blinkOn) {
  const uint8_t level = live ? LEVEL_LIVE : LEVEL_STALE;

  if (!haveState) {
    const Rgb grey = scaled(MARKER_COLOR, level);
    for (int i = 0; i < 2; i++) {
      drawDigit(c, '-', LEFT_X + i * (GLYPH_DIGIT_W + DIGIT_GAP), DIGIT_Y, grey);
      drawDigit(c, '-', RIGHT_X + i * (GLYPH_DIGIT_W + DIGIT_GAP), DIGIT_Y, grey);
    }
    return;
  }

  char digits[5];
  formatDigits(s.a, s.b, digits);

  char nameA[NAME_CHARS + 1], nameB[NAME_CHARS + 1];
  fitLabels(s.teamA, s.teamB, nameA, nameB, NAME_CHARS + 1);

  // Which partner is up, mirroring activeIdx in App.jsx. Derived from the round
  // rather than published, because the app derives it the same way.
  const int upPartner = s.round % 2;

  // Once the game is won nobody is throwing, so the rule comes off.
  drawSide(c, nameA, digits, LEFT_X, 0, scaled(s.colorA, level),
           !(s.winner == 'a' && !blinkOn), s.winner == 0 && s.first == 'a', upPartner);
  drawSide(c, nameB, digits + 2, RIGHT_X, PANEL_W - NAME_REGION_W,
           scaled(s.colorB, level), !(s.winner == 'b' && !blinkOn),
           s.winner == 0 && s.first == 'b', upPartner);

  const Rgb grey = scaled(MARKER_COLOR, level);

  // Belongs to neither team, so it takes the neutral colour.
  drawText(c, "V", (PANEL_W - FONT_W) / 2, NAME_Y, grey, 1);

  if (s.round > 0) {
    char marker[5] = {'R', 0, 0, 0, 0};
    const int r = s.round > 99 ? 99 : s.round;
    if (r >= 10) {
      marker[1] = char('0' + r / 10);
      marker[2] = char('0' + r % 10);
    } else {
      marker[1] = char('0' + r);
    }
    drawText(c, marker, (PANEL_W - textWidth(marker, 4)) / 2, ROUND_Y, grey, 4);
  }

  if (s.target > 0) {
    // The app caps the target at 99, so two digits is the worst case and
    // "TO 99" is the widest this line ever gets.
    const int t = s.target > 99 ? 99 : s.target;
    char label[8] = {'T', 'O', ' ', 0, 0, 0, 0, 0};
    int n = 3;
    if (t >= 10) label[n++] = char('0' + t / 10);
    label[n++] = char('0' + t % 10);
    drawText(c, label, (PANEL_W - textWidth(label, 8)) / 2, TARGET_Y, grey, 8);
  }
}
