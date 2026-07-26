// Host-compiles render.h and dumps every board state as a PPM, so the layout
// can be checked before any hardware exists — Wokwi has no HUB75 part, so this
// is the only way to see the panel without owning one.
//
//   cd firmware/hub75
//   clang++ -std=c++17 -Wall -Wextra -I. -I../wokwi -o /tmp/render_test test_render.cpp
//   /tmp/render_test && node preview.mjs
//
// It asserts as well as renders: anything drawn outside the panel is a bug the
// real board would show as wrapped pixels on the wrong module.
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "render.h"

struct Framebuffer {
  uint8_t px_[PANEL_W * PANEL_H * 3] = {0};
  int outOfBounds = 0;

  void px(int x, int y, uint8_t r, uint8_t g, uint8_t b) {
    if (x < 0 || y < 0 || x >= PANEL_W || y >= PANEL_H) {
      outOfBounds++;
      return;
    }
    uint8_t* p = px_ + (y * PANEL_W + x) * 3;
    p[0] = r;
    p[1] = g;
    p[2] = b;
  }

  int lit() const {
    int n = 0;
    for (int i = 0; i < PANEL_W * PANEL_H; i++) {
      const uint8_t* p = px_ + i * 3;
      if (p[0] || p[1] || p[2]) n++;
    }
    return n;
  }

  void write(const std::string& name) const {
    FILE* f = fopen(("out/" + name + ".ppm").c_str(), "wb");
    fprintf(f, "P6\n%d %d\n255\n", PANEL_W, PANEL_H);
    fwrite(px_, 1, sizeof(px_), f);
    fclose(f);
  }
};

static int failures = 0;

static void check(bool ok, const char* what) {
  if (!ok) {
    printf("  FAIL: %s\n", what);
    failures++;
  }
}

static BoardState makeState(int a, int b, int round, const char* ta, const char* tb,
                            char winner = 0) {
  BoardState s;
  s.a = a;
  s.b = b;
  s.round = round;
  s.target = 21;
  s.winner = winner;
  copyLabel(ta, s.teamA);
  copyLabel(tb, s.teamB);
  parseColor("#2f80ed", s.colorA);
  parseColor("#eb5757", s.colorB);
  return s;
}

static Framebuffer shot(const std::string& name, const BoardState& s, bool haveState,
                        bool live, bool blinkOn) {
  Framebuffer fb;
  renderBoard(fb, s, haveState, live, blinkOn);
  fb.write(name);
  check(fb.outOfBounds == 0, (name + ": drew outside the panel").c_str());
  printf("  %-14s %4d lit  (%4.1f%% duty)\n", name.c_str(), fb.lit(),
         100.0 * fb.lit() / (PANEL_W * PANEL_H));
  return fb;
}

int main() {
  printf("layout: %dx%d, digits %dx%d at y=%d, %d name chars/team\n\n", PANEL_W, PANEL_H,
         GLYPH_DIGIT_W, GLYPH_DIGIT_H, DIGIT_Y, NAME_CHARS);

  const BoardState play = makeState(17, 8, 7, "NEIL & PSI", "IOTA & ZETA");
  const BoardState early = makeState(0, 0, 1, "NEIL", "IOTA");
  const BoardState longNames =
      makeState(17, 8, 7, "OMICRON & UPSILON", "EPSILON & MU");
  const BoardState won = makeState(21, 8, 9, "NEIL & PSI", "IOTA & ZETA", 'a');
  const BoardState big = makeState(88, 88, 99, "WWWWWWWWWW", "WWWWWWWWWW");

  shot("play", play, true, true, true);
  shot("early", early, true, true, true);
  shot("long-names", longNames, true, true, true);
  shot("stale", play, true, false, true);
  const Framebuffer noState = shot("no-state", play, false, true, true);
  const Framebuffer winOn = shot("winner-on", won, true, true, true);
  const Framebuffer winOff = shot("winner-off", won, true, true, false);
  shot("worst", big, true, true, true);

  printf("\nchecks\n");
  // segments.js has no dash — the browser never shows one — so the generator
  // synthesises it. An empty glyph here means a blank board before the first
  // message, which reads as broken rather than waiting.
  check(noState.lit() > 0, "no-state must draw dashes, not nothing");
  check(winOff.lit() < winOn.lit(), "winner blink should blank the winning pair");
  // The loser's score and both names must survive the flash, or the board
  // stops being readable for half of every beat.
  check(winOff.lit() > 100, "winner blink blanked too much");

  Framebuffer bounds;
  BoardState overflow = makeState(999, -5, 250, "0123456789ABCDEFGHIJKLMNOPQ", "X");
  renderBoard(bounds, overflow, true, true, true);
  check(bounds.outOfBounds == 0, "out-of-range score/round/name must stay on the panel");

  Rgb c;
  parseColor("#2f80ed", c);
  check(c.r == 0x2f && c.g == 0x80 && c.b == 0xed, "parseColor");
  Rgb white;
  parseColor("not a colour", white);
  check(white.r == 255 && white.g == 255 && white.b == 255, "bad colour falls back to white");

  char label[TEAM_LABEL_MAX];
  copyLabel("OMICRON & UPSILON", label);
  check(strlen(label) == TEAM_LABEL_MAX - 1, "long label truncated at parse");

  check(liveWithGrace(true, 1000, 0), "connected is always live");
  check(!liveWithGrace(false, 1000, 0), "never-connected is not live");
  check(liveWithGrace(false, 20000, 1000), "brief dropout rides out the grace period");
  check(!liveWithGrace(false, 40000, 1000), "a long dropout dims");
  // The wrap is the case a signed comparison would get wrong, and it would show
  // up as a board stuck dim for 49 days.
  check(liveWithGrace(false, 5, 0xFFFFFFF0), "grace survives the millis() wrap");

  printf(failures ? "\n%d FAILED\n" : "\nall checks passed\n", failures);
  return failures ? 1 : 0;
}
