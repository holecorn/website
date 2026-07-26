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
static const int LEFT_X = 1;
static const int RIGHT_X = PANEL_W - PAIR_W - 1;
static const int NAME_CHARS = (PANEL_W / 2 - 1) / FONT_ADVANCE;
static const int MARKER_Y = DIGIT_Y + (GLYPH_DIGIT_H - FONT_H) / 2;

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

// One team: name centred in its half, score pair below.
template <typename Canvas>
void drawSide(Canvas& c, const char* name, const char* pair, int pairX, int half,
              Rgb color, bool showScore) {
  const int w = textWidth(name, NAME_CHARS);
  int nx = half + (PANEL_W / 2 - w) / 2;
  if (nx < 1) nx = 1;
  if (nx + w > PANEL_W - 1) nx = PANEL_W - 1 - w;
  drawText(c, name, nx, NAME_Y, color, NAME_CHARS);
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

  drawSide(c, s.teamA, digits, LEFT_X, 0, scaled(s.colorA, level),
           !(s.winner == 'a' && !blinkOn));
  drawSide(c, s.teamB, digits + 2, RIGHT_X, PANEL_W / 2, scaled(s.colorB, level),
           !(s.winner == 'b' && !blinkOn));

  if (s.round > 0) {
    char marker[5] = {'R', 0, 0, 0, 0};
    const int r = s.round > 99 ? 99 : s.round;
    if (r >= 10) {
      marker[1] = char('0' + r / 10);
      marker[2] = char('0' + r % 10);
    } else {
      marker[1] = char('0' + r);
    }
    const int w = textWidth(marker, 4);
    drawText(c, marker, (PANEL_W - w) / 2, MARKER_Y, scaled(MARKER_COLOR, level), 4);
  }
}
