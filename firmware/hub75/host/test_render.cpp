// Host-compiles render.h and dumps every board state as a PPM, so the layout
// can be checked before any hardware exists — Wokwi has no HUB75 part, so this
// is the only way to see the panel without owning one.
//
//   cd firmware/hub75 && mkdir -p out
//   clang++ -std=c++17 -Wall -Wextra -I. -o /tmp/render_test test_render.cpp
//   /tmp/render_test && node preview.mjs
//
// It asserts as well as renders: anything drawn outside the panel is a bug the
// real board would show as wrapped pixels on the wrong module.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "render.h"

// Both labels at once, which is all the tests need; renderBoard keeps the join
// indices that fitLabel returns.
static void fitLabels(const char* a, const char* b, char* outA, char* outB, int cap) {
  fitLabel(a, outA, cap);
  fitLabel(b, outB, cap);
}

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

  int litCount(int y, int x0, int x1) const {
    int n = 0;
    for (int x = x0; x < x1; x++) {
      const uint8_t* p = px_ + (y * PANEL_W + x) * 3;
      if (p[0] || p[1] || p[2]) n++;
    }
    return n;
  }

  // Is anything lit on this row, within this span?
  bool litRow(int y, int x0, int x1) const {
    for (int x = x0; x < x1; x++) {
      const uint8_t* p = px_ + (y * PANEL_W + x) * 3;
      if (p[0] || p[1] || p[2]) return true;
    }
    return false;
  }

  // Topmost to bottommost lit row within a column span, inclusive. Used to
  // measure a digit's drawn height off the panel rather than off a constant.
  int litSpan(int x0, int x1) const {
    int top = -1, bottom = -1;
    for (int y = 0; y < PANEL_H; y++) {
      if (litRow(y, x0, x1)) {
        if (top < 0) top = y;
        bottom = y;
      }
    }
    return top < 0 ? 0 : bottom - top + 1;
  }

  int lit() const {
    int n = 0;
    for (int i = 0; i < PANEL_W * PANEL_H; i++) {
      const uint8_t* p = px_ + i * 3;
      if (p[0] || p[1] || p[2]) n++;
    }
    return n;
  }

  // The bottommost lit row within a column span, or -1. This is how the splash's thump is
  // measured: a board that dropped a pixel has to have taken its lowest edge with it.
  int litBottom(int x0, int x1) const {
    for (int y = PANEL_H - 1; y >= 0; y--) {
      if (litRow(y, x0, x1)) return y;
    }
    return -1;
  }

  // Is this exact colour anywhere on the panel? A fully covered pixel is drawn at the
  // colour it was handed, so this is how "both words are in their own colour" is asked.
  bool hasColor(Rgb c) const {
    for (int i = 0; i < PANEL_W * PANEL_H; i++) {
      const uint8_t* p = px_ + i * 3;
      if (p[0] == c.r && p[1] == c.g && p[2] == c.b) return true;
    }
    return false;
  }

  bool litAt(int x, int y) const {
    if (x < 0 || y < 0 || x >= PANEL_W || y >= PANEL_H) return false;
    const uint8_t* p = px_ + (y * PANEL_W + x) * 3;
    return p[0] || p[1] || p[2];
  }

  bool anyLitIn(const LogoRect& r) const {
    for (int y = r.y0; y <= r.y1; y++) {
      if (litRow(y, r.x0, r.x1 + 1)) return true;
    }
    return false;
  }

  // How many different brightnesses are on screen, counted on the strongest channel of
  // each lit pixel. Two means every pixel is either off or full — which is what the
  // splash looked like before it carried coverage, and is indistinguishable from it by
  // any count of lit pixels.
  int intensities() const {
    bool seen[256] = {false};
    for (int i = 0; i < PANEL_W * PANEL_H; i++) {
      const uint8_t* p = px_ + i * 3;
      const uint8_t top = p[0] > p[1] ? (p[0] > p[2] ? p[0] : p[2]) : (p[1] > p[2] ? p[1] : p[2]);
      if (top > 0) seen[top] = true;
    }
    int n = 0;
    for (int v = 1; v < 256; v++) if (seen[v]) n++;
    return n;
  }

  // The faintest lit pixel, again on its strongest channel. 0 when nothing is lit.
  int faintest() const {
    int min = 256;
    for (int i = 0; i < PANEL_W * PANEL_H; i++) {
      const uint8_t* p = px_ + i * 3;
      const uint8_t top = p[0] > p[1] ? (p[0] > p[2] ? p[0] : p[2]) : (p[1] > p[2] ? p[1] : p[2]);
      if (top > 0 && top < min) min = top;
    }
    return min == 256 ? 0 : min;
  }

  void write(const std::string& name) const {
    FILE* f = fopen(("out/" + name + ".ppm").c_str(), "wb");
    if (!f) {
      // out/ is gitignored, so a fresh clone has no such directory and an
      // unchecked fopen segfaults with no clue why.
      printf("  cannot write out/%s.ppm — run `mkdir -p out` first\n", name.c_str());
      exit(1);
    }
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
                            char winner = 0, char first = 0) {
  BoardState s;
  s.a = a;
  s.b = b;
  s.round = round;
  s.target = 21;
  s.winner = winner;
  s.first = first;
  copyLabel(ta, s.teamA);
  copyLabel(tb, s.teamB);
  parseColor("#2f80ed", s.colorA);
  parseColor("#eb5757", s.colorB);
  return s;
}

// Set rather than parsed, so a rendering scene is not also a parse test —
// parseLineup's own clamps and coercions are covered in test_board_logic.cpp.
static void setRow(LineupRow& r, const char* name, int wins, int losses, int ppr,
                   const char* form) {
  snprintf(r.name, sizeof r.name, "%s", name);
  snprintf(r.form, sizeof r.form, "%s", form);
  r.wins = wins;
  r.losses = losses;
  r.ppr = ppr;
}

// Both panels are fed through the MatrixPortal's 5 V terminals, which only holds
// while the layout stays far from white — see Power in README.md.
static const double DUTY_CEILING = 30.0;
static double worstDuty = 0;

// Every shot() is also described in out/scenes.json, so src/panelRender.js can be
// rendered against the same inputs and compared byte for byte — see
// tools/test-firmware.mjs. Written from here rather than listed there because a
// scene table maintained in two languages is exactly the drift this is meant to
// catch.
static std::vector<std::string> scenes;

// Escapes control characters as well as the two JSON specials, so an unprintable
// byte in a label produces a parseable file rather than one that fails on the
// Node side with a byte offset and no scene name.
//
// A byte >= 0x80 is passed through, which is fine for a whole UTF-8 name and
// **not** fine for one copyLabel cut mid-character: that is invalid UTF-8, and
// Node reads the file as UTF-8 and would substitute U+FFFD. So a non-ASCII scene
// cannot be added here without carrying the label as bytes instead. The
// mid-character cut is covered in src/panelRender.test.js instead.
static std::string quoted(const char* s) {
  std::string out = "\"";
  for (int i = 0; s[i]; i++) {
    const unsigned char c = static_cast<unsigned char>(s[i]);
    if (c == '"' || c == '\\') {
      out += '\\';
      out += char(c);
    } else if (c < 0x20) {
      char esc[7];
      snprintf(esc, sizeof esc, "\\u%04x", c);
      out += esc;
    } else {
      out += char(c);
    }
  }
  return out + "\"";
}

static std::string teamJson(char team) {
  return team ? std::string("\"") + team + "\"" : "null";
}

static std::string colorJson(Rgb c) {
  char buf[10];
  snprintf(buf, sizeof buf, "\"#%02x%02x%02x\"", c.r, c.g, c.b);
  return buf;
}

// The lineup as it arrived, so the Node side coerces it through lineupState()
// exactly as the firmware coerced it through parseLineup — the pip and column
// geometry is the part most likely to drift by a pixel.
static std::string lineupJson(const LineupState* l) {
  if (!l || l->count == 0) return "null";
  std::string out = "{\"rows\":[";
  for (int i = 0; i < l->count; i++) {
    if (i) out += ",";
    out += "{\"n\":" + quoted(l->rows[i].name) +
           ",\"w\":" + std::to_string(l->rows[i].wins) +
           ",\"l\":" + std::to_string(l->rows[i].losses) +
           ",\"p\":" + std::to_string(l->rows[i].ppr) +
           ",\"f\":" + quoted(l->rows[i].form) + "}";
  }
  return out + "]}";
}

// `splash` is null for an ordinary scene and the indicator state, the animation clock and
// the throwing order for a splash one, which is what tells tools/test-firmware.mjs which
// renderer to replay it through. The two colours ride in colorA/colorB, so those are the
// only new fields a splash scene needs.
struct SplashScene {
  int connect;
  uint32_t elapsed;
  const uint8_t (*order)[LOGO_LETTERS];
};

static std::string splashJson(const SplashScene* splash) {
  if (!splash) return "null";
  std::string order = "[";
  for (int board = 0; board < SPLASH_BOARDS; board++) {
    order += board ? ",[" : "[";
    for (int slot = 0; slot < LOGO_LETTERS; slot++) {
      order += (slot ? "," : "") + std::to_string(splash->order[board][slot]);
    }
    order += "]";
  }
  order += "]";
  return "{\"connect\":" + std::to_string(splash->connect) +
         ",\"elapsed\":" + std::to_string(splash->elapsed) + ",\"order\":" + order + "}";
}

// The tie as it arrived, so the Node side coerces it through tieState() the way the
// firmware coerced it through parseTie — the same reasoning as lineupJson.
static std::string tieJson(const TieState* t) {
  if (!t || !t->set) return "null";
  return "{\"t\":" + quoted(t->cup) + ",\"r\":" + quoted(t->round) + "}";
}

// The card as it arrived, so the Node side coerces it through drawState() the way the
// firmware coerced it through parseDraw — tieJson's reasoning. The count the app sends
// is absent because DrawState does not hold it: the panel draws no progress line.
static std::string drawJson(const DrawState* d) {
  if (!d || !d->set) return "null";
  std::string out = "{\"r\":" + quoted(d->round);
  if (d->cup[0] != '\0') out += ",\"t\":" + quoted(d->cup);
  if (d->named) out += ",\"n\":" + quoted(d->name);
  if (d->opponents > 0) {
    out += ",\"o\":[";
    for (int i = 0; i < d->opponents; i++) out += (i ? "," : "") + quoted(d->opponent[i]);
    out += "]";
  }
  return out + "}";
}

static void record(const std::string& name, const BoardState& s, bool haveState, bool live,
                   bool blinkOn, PanelLayout layout, const LineupState* lineup,
                   const TieState* tie = nullptr, const SplashScene* splash = nullptr,
                   const DrawState* draw = nullptr) {
  const auto flag = [](bool b) { return std::string(b ? "true" : "false"); };
  scenes.push_back(
      "{\"name\":" + quoted(name.c_str()) +
      ",\"layout\":" + quoted(PANEL_LAYOUT_IDS[layout]) +
      ",\"lineup\":" + lineupJson(lineup) + ",\"tie\":" + tieJson(tie) +
      ",\"draw\":" + drawJson(draw) +
      ",\"a\":" + std::to_string(s.a) +
      ",\"b\":" + std::to_string(s.b) + ",\"round\":" + std::to_string(s.round) +
      ",\"target\":" + std::to_string(s.target) + ",\"winner\":" + teamJson(s.winner) +
      ",\"first\":" + teamJson(s.first) + ",\"teamA\":" + quoted(s.teamA) +
      ",\"teamB\":" + quoted(s.teamB) + ",\"colorA\":" + colorJson(s.colorA) +
      ",\"colorB\":" + colorJson(s.colorB) + ",\"haveState\":" + flag(haveState) +
      ",\"live\":" + flag(live) + ",\"blinkOn\":" + flag(blinkOn) +
      ",\"splash\":" + splashJson(splash) + "}");
}

// Every offset every bag passes through, and both boards' knocks, for
// tools/test-firmware.mjs to compare against src/panelRender.js. A handful of scenes
// cannot do this job: they pin the frames at the times they were dumped, and a flight that
// differs anywhere between them draws an identical frame at each sample. Verified by
// mutation — making the JS skid linear rather than quadratic passes every scene below,
// pixel for pixel, and fails only this. Runs one millisecond past the end, so the settled
// tail is covered too.
//
// Dumped for the identity order, so slot and letter are the same thing here and the curve
// does not depend on a shuffle; that the order is applied at all is a scene's job.
static void writeSplashCurve() {
  FILE* f = fopen("out/splash-curve.json", "wb");
  if (!f) {
    printf("  cannot write out/splash-curve.json — run `mkdir -p out` first\n");
    exit(1);
  }
  fprintf(f, "{\"span\":%u,\"throws\":[", SPLASH_ANIM_MS + 1);
  for (int board = 0; board < SPLASH_BOARDS; board++) {
    for (int slot = 0; slot < LOGO_LETTERS; slot++) {
      const LogoRect& r = board == 0 ? LOGO_HOLE_LETTERS[slot] : LOGO_CORN_LETTERS[slot];
      fprintf(f, "%s[", board || slot ? "," : "");
      for (uint32_t t = 0; t <= SPLASH_ANIM_MS + 1; t++) {
        const SplashOffset o = splashThrow(r, board == 0 ? -1 : 1, board, slot, t);
        fprintf(f, "%s[%d,%d]", t ? "," : "", o.dx, o.dy);
      }
      fprintf(f, "]");
    }
  }
  fprintf(f, "],\"thump\":[");
  for (int board = 0; board < SPLASH_BOARDS; board++) {
    fprintf(f, "%s[", board ? "," : "");
    for (uint32_t t = 0; t <= SPLASH_ANIM_MS + 1; t++) {
      fprintf(f, "%s%d", t ? "," : "", splashThump(board, t));
    }
    fprintf(f, "]");
  }
  fprintf(f, "]}\n");
  fclose(f);
}

static void writeScenes() {
  FILE* f = fopen("out/scenes.json", "wb");
  if (!f) {
    printf("  cannot write out/scenes.json — run `mkdir -p out` first\n");
    exit(1);
  }
  fprintf(f, "[\n");
  for (size_t i = 0; i < scenes.size(); i++) {
    fprintf(f, "  %s%s\n", scenes[i].c_str(), i + 1 < scenes.size() ? "," : "");
  }
  fprintf(f, "]\n");
  fclose(f);
}

static Framebuffer shot(const std::string& name, const BoardState& s, bool haveState,
                        bool live, bool blinkOn, PanelLayout layout = PANEL_FULL,
                        const LineupState* lineup = nullptr, const TieState* tie = nullptr,
                        const DrawState* draw = nullptr) {
  Framebuffer fb;
  renderBoard(fb, s, haveState, live, blinkOn, layout, lineup, tie, draw);
  fb.write(name);
  record(name, s, haveState, live, blinkOn, layout, lineup, tie, nullptr, draw);
  check(fb.outOfBounds == 0, (name + ": drew outside the panel").c_str());
  const double duty = 100.0 * fb.lit() / (PANEL_W * PANEL_H);
  if (duty > worstDuty) worstDuty = duty;
  printf("  %-14s %4d lit  (%4.1f%% duty)\n", name.c_str(), fb.lit(), duty);
  return fb;
}

// Left to right, which the sketch shuffles at power-on. The curve and most of the frames
// are dumped through this one so a scene's letters are where its name says they are.
static const uint8_t SPLASH_IN_ORDER[SPLASH_BOARDS][LOGO_LETTERS] = {{0, 1, 2, 3}, {0, 1, 2, 3}};

// The splash has no layout id and no board state, so it needs its own shot(). The colour
// pair, the clock and the order are arguments here for the same reason they are ones in
// drawSplash: the sketch picks them and this check needs the same inputs twice. `elapsed`
// defaults to the settled frame, which is the one the rest of the assertions are about.
static Framebuffer splashShot(const std::string& name, const char* hexA, const char* hexB,
                              int connect, uint32_t elapsed = SPLASH_ANIM_MS,
                              const uint8_t (*order)[LOGO_LETTERS] = SPLASH_IN_ORDER) {
  BoardState s = makeState(0, 0, 0, "", "");
  parseColor(hexA, s.colorA);
  parseColor(hexB, s.colorB);

  Framebuffer fb;
  drawSplash(fb, s.colorA, s.colorB, connect, elapsed, order);
  fb.write(name);
  const SplashScene scene = {connect, elapsed, order};
  record(name, s, false, true, true, PANEL_FULL, nullptr, nullptr, &scene);
  check(fb.outOfBounds == 0, (name + ": drew outside the panel").c_str());
  const double duty = 100.0 * fb.lit() / (PANEL_W * PANEL_H);
  if (duty > worstDuty) worstDuty = duty;
  printf("  %-14s %4d lit  (%4.1f%% duty)\n", name.c_str(), fb.lit(), duty);
  return fb;
}

int main() {
  printf("panel %dx%d\n", PANEL_W, PANEL_H);
  printf("  full  digits %dx%d at y=%d, %d name chars/team\n", GLYPH_SMALL_W, GLYPH_SMALL_H,
         DIGIT_Y, NAME_CHARS);
  printf("  score digits %dx%d at y=%d, no names\n\n", GLYPH_BIG_W, GLYPH_BIG_H,
         SCORE_DIGIT_Y);

  const BoardState play = makeState(17, 8, 7, "NEIL & PSI", "IOTA & ZETA");
  const BoardState early = makeState(0, 0, 1, "NEIL", "IOTA");
  const BoardState longNames =
      makeState(17, 8, 7, "OMICRONZETA & UPSILONXI", "EPSILONBETA & MU");
  const BoardState won = makeState(21, 8, 9, "NEIL & PSI", "IOTA & ZETA", 'a');
  const BoardState big = makeState(88, 88, 99, "WWWWWWWWWW", "WWWWWWWWWW");
  // None of the scenes above sets `first`, so without these the underline — and
  // which partner it picks — would go uncompared against src/panelRender.js. Both
  // parities are needed: with only the odd round, hard-coding the partner to the
  // second one passes.
  const BoardState ruledSingle = makeState(12, 7, 5, "Theta", "Nu", 0, 'a');
  const BoardState ruledPairOdd = makeState(9, 6, 5, "Nu & Tau", "Alpha & Phi", 0, 'b');
  const BoardState ruledPairEven = makeState(9, 6, 4, "Nu & Tau", "Alpha & Phi", 0, 'b');
  // Out of range on every axis at once, target included — makeState's 21 is
  // under the cap. Recorded as a scene and not merely rendered, because it is
  // the only one that exercises the clamps: without it, deleting either the
  // 0..99 score clamp or the "TO 99" cap in src/panelRender.js passes.
  BoardState overflow = makeState(999, -5, 250, "0123456789ABCDEFGHIJKLMNOPQ", "X");
  overflow.target = 250;

  // A name in a script the 5x7 font has no glyphs for. Every byte of it falls back to
  // FONT_UNKNOWN, so the row reads as a name that cannot be shown rather than as an empty
  // one — before that fallback existed these two lit 13 pixels of the name row against
  // 181 for two Latin names, which looks like a fault rather than a limitation. The bytes
  // are written out because this file is compiled as plain ASCII.
  const BoardState unshowable =
      makeState(12, 7, 5, "\xce\xa9\xce\xbc\xce\xad\xce\xb3\xce\xb1",
                "\xce\xa3\xce\xaf\xce\xb3\xce\xbc\xce\xb1", 0, 'a');
  // Half and half: the Latin part still has to draw normally beside it.
  const BoardState partlyShowable = makeState(12, 7, 5, "Jos\xc3\xa9", "Renee", 0, 'a');

  shot("play", play, true, true, true);
  shot("early", early, true, true, true);
  shot("long-names", longNames, true, true, true);
  const Framebuffer unshown = shot("unshowable-names", unshowable, true, true, true);
  shot("partly-showable-names", partlyShowable, true, true, true);
  shot("stale", play, true, false, true);
  const Framebuffer noState = shot("no-state", play, false, true, true);
  const Framebuffer winOn = shot("winner-on", won, true, true, true);
  const Framebuffer winOff = shot("winner-off", won, true, true, false);
  const Framebuffer worst = shot("worst", big, true, true, true);
  shot("ruled-single", ruledSingle, true, true, true);
  shot("ruled-pair-odd", ruledPairOdd, true, true, true);
  shot("ruled-pair-even", ruledPairEven, true, true, true);
  // shot() asserts nothing is drawn off-panel, which is what this scene is for.
  shot("overflow", overflow, true, true, true);

  // The same states through PANEL_SCORE. `worst` is here for DUTY_CEILING:
  // bigger digits light more of the panel, and the decision to feed both panels
  // through the controller's 5 V terminals rests on no layout approaching white.
  const Framebuffer scorePlay = shot("score-play", ruledSingle, true, true, true, PANEL_SCORE);
  shot("score-early", early, true, true, true, PANEL_SCORE);
  shot("score-stale", play, true, false, true, PANEL_SCORE);
  const Framebuffer scoreNoState = shot("score-no-state", play, false, true, true, PANEL_SCORE);
  const Framebuffer scoreWinOn = shot("score-winner-on", won, true, true, true, PANEL_SCORE);
  const Framebuffer scoreWinOff = shot("score-winner-off", won, true, true, false, PANEL_SCORE);
  const Framebuffer scoreWorst = shot("score-worst", big, true, true, true, PANEL_SCORE);
  shot("score-overflow", overflow, true, true, true, PANEL_SCORE);
  // Doubles through the score layout, where the second mark appears. `ruledSingle`
  // above is the singles counterpart and must stay unmarked on the other side, so
  // the two scenes together are what pin the rule being doubles-only.
  const Framebuffer scorePair =
      shot("score-ruled-pair", ruledPairEven, true, true, true, PANEL_SCORE);
  // Blank names put nothing but digits in the pair columns, which is what lets
  // the two layouts' digit heights be measured off the panel below. A blank
  // player name is a real case anyway — drawSide has a branch for it.
  const BoardState blank = makeState(88, 88, 9, "", "");
  const Framebuffer fullBlank = shot("blank-names", blank, true, true, true);
  const Framebuffer scoreBlank = shot("score-blank-names", blank, true, true, true, PANEL_SCORE);

  // The pre-game form screen. It has no layout id — a retained lineup is what
  // selects it — so the layout-coverage check in tools/test-firmware.mjs cannot
  // see it, and these scenes are the only thing pinning it.
  LineupState singles;
  singles.count = 2;
  setRow(singles.rows[0], "Neil", 6, 4, 72, "LWLWW");
  setRow(singles.rows[1], "Sigma", 4, 6, 60, "WLWLL");

  LineupState doubles;
  doubles.count = 4;
  setRow(doubles.rows[0], "Neil", 6, 4, 72, "LWLWW");
  setRow(doubles.rows[1], "Rho", 2, 2, 73, "WLLW");
  setRow(doubles.rows[2], "Sigma", 4, 6, 60, "WLWLL");
  setRow(doubles.rows[3], "Tau", 2, 2, 73, "LWWL");

  // Everything at its widest at once: eight-character names, two-digit records
  // both sides, a PPR that needs the fourth character, and five results each.
  // This is the scene the column geometry is sized for.
  LineupState formWorst;
  formWorst.count = 4;
  for (int i = 0; i < 4; i++) {
    setRow(formWorst.rows[i], "MWMWMWMWMW", 99, 99, 999, "WWWWW");
  }

  // A player with no history at all — 0-0, no rate, no pips — beside players who
  // have one. The app publishes nothing when *nobody* has played, but one
  // newcomer in a known lineup is an ordinary Saturday.
  LineupState formNew;
  formNew.count = 2;
  setRow(formNew.rows[0], "Neil", 6, 4, 72, "LWLWW");
  setRow(formNew.rows[1], "Psi", 0, 0, 0, "");

  // A player who has played and averages 0.0 — every bag on the floor. Their rate
  // must be *drawn*, not blanked as a newcomer's is: it is a real average, and an
  // empty column reads as missing data.
  LineupState formZero;
  formZero.count = 2;
  setRow(formZero.rows[0], "Neil", 6, 4, 72, "LWLWW");
  setRow(formZero.rows[1], "Eta", 0, 5, 0, "LLLLL");

  // A record with no rate behind it — a match imported from a written-down
  // result, where the app omits "p" and parseLineup gives -1. The record and the
  // pips draw; the rate column is left to the row beside it, which is what makes
  // this different from formZero above.
  LineupState formImported;
  formImported.count = 2;
  setRow(formImported.rows[0], "Neil", 6, 4, -1, "LWLWW");
  setRow(formImported.rows[1], "Sigma", 4, 6, 60, "WLWLL");

  // Nobody with a rate at all, so the column costs no width and the names get it.
  LineupState formNoRates;
  formNoRates.count = 2;
  setRow(formNoRates.rows[0], "Neil", 6, 4, -1, "LWLWW");
  setRow(formNoRates.rows[1], "Sigma", 4, 6, -1, "WLWLL");

  const Framebuffer formS = shot("form-singles", play, true, true, true, PANEL_FULL, &singles);
  const Framebuffer formD = shot("form-doubles", play, true, true, true, PANEL_FULL, &doubles);
  // `play` sets no first thrower, so the two above are the unmarked shape. These carry
  // one — the screen a board actually shows while everyone walks to the boards, which
  // is the whole reason the bags are here rather than only on the score.
  const BoardState formFirst = makeState(0, 0, 0, "Neil & Rho", "Sigma & Tau", 0, 'a');
  const BoardState formFirstSingle = makeState(0, 0, 0, "Neil", "Sigma", 0, 'a');
  const Framebuffer formBagD =
      shot("form-doubles-bags", formFirst, true, true, true, PANEL_FULL, &doubles);
  const Framebuffer formBagS =
      shot("form-singles-bags", formFirstSingle, true, true, true, PANEL_FULL, &singles);
  shot("form-stale", play, true, false, true, PANEL_FULL, &doubles);
  // Under PANEL_SCORE, to show the lineup overrides the layout rather than
  // combining with it.
  shot("form-over-score", play, true, true, true, PANEL_SCORE, &doubles);
  // No state at all: the lineup still wins over the no-state dashes, because it
  // is only ever published before the first bag.
  shot("form-no-state", play, false, true, true, PANEL_FULL, &singles);
  const Framebuffer formW = shot("form-worst", big, true, true, true, PANEL_FULL, &formWorst);
  const Framebuffer formN = shot("form-newcomer", play, true, true, true, PANEL_FULL, &formNew);
  // Past 99 in either column, which arrives at about 100 matches. The record column
  // widens and the name gives up the characters — the trade the adaptive layout makes.
  LineupState formBig;
  formBig.count = 4;
  setRow(formBig.rows[0], "AlphaBet", 120, 87, 120, "WWWWW");
  setRow(formBig.rows[1], "BetaGamm", 999, 999, 999, "WWWWW");
  setRow(formBig.rows[2], "GammaDel", 4, 316, 60, "WLWLL");
  setRow(formBig.rows[3], "DeltaEps", 2, 2, 73, "LWWL");

  const Framebuffer formZ = shot("form-zero-rate", play, true, true, true, PANEL_FULL, &formZero);
  const Framebuffer formB = shot("form-big-record", play, true, true, true, PANEL_FULL, &formBig);
  const Framebuffer formI =
      shot("form-no-rate", play, true, true, true, PANEL_FULL, &formImported);
  const Framebuffer formNR =
      shot("form-no-rates", play, true, true, true, PANEL_FULL, &formNoRates);

  // The fixture card. Like the form screen it has no layout id — a tie is a phase of
  // a tournament, not a preference the scorer sets — so tools/test-firmware.mjs has a
  // separate assertion that some scene carries one.
  const auto tieOf = [](const char* cup, const char* round) {
    TieState t;
    t.set = true;
    copyInto(cup, t.cup, TIE_CUP_MAX);
    copyInto(round, t.round, TIE_ROUND_MAX);
    return t;
  };
  const TieState semi = tieOf("Hole Corn V", "Semi-final");
  const TieState noCup = tieOf("", "Quarter-final");

  // Singles, short names: 12 characters inline, so the fixture takes one row and the
  // card spreads.
  const BoardState tieSingles = makeState(0, 0, 0, "Neil", "Sigma");
  // Doubles as typed: 24 inline, so the two sides stack and keep their ampersands.
  const BoardState tieDoubles = makeState(0, 0, 0, "Neil & Rho", "Sigma & Tau");
  // Exactly TIE_INLINE_CHARS between them, the widest that may spread.
  const BoardState tieFits = makeState(0, 0, 0, "Rho & Tau", "Phi & Xi");
  // One character more, which must stack. The pair pins the threshold at 20 rather
  // than at the 21 a line physically holds: at 21 the row runs to within a pixel of
  // both edges. A mutation to TIE_LINE_CHARS spreads this one and fails.
  const BoardState tieOver = makeState(0, 0, 0, "Rho & Tau", "Phi & Chi");
  // Names at the app's 16-character cap. Singles fits whole on its own row; doubles
  // is past what even a full row holds and falls back to the slash.
  const BoardState tieLongSingles =
      makeState(0, 0, 0, "AlphaBetaGammaDe", "EtaThetaIotaKapp");
  const BoardState tieLongDoubles = makeState(0, 0, 0, "AlphaBetaGammaDe & DeltaEpsilonZeta",
                                              "EtaThetaIotaKapp & LambdaMuNuXiOmic");

  const Framebuffer tieSpread =
      shot("tie-spread", tieSingles, true, true, true, PANEL_FULL, nullptr, &semi);
  const Framebuffer tieStack =
      shot("tie-stacked", tieDoubles, true, true, true, PANEL_FULL, nullptr, &semi);
  const Framebuffer tieAt20 =
      shot("tie-fits-inline", tieFits, true, true, true, PANEL_FULL, nullptr, &semi);
  const Framebuffer tieAt21 =
      shot("tie-over-inline", tieOver, true, true, true, PANEL_FULL, nullptr, &semi);
  shot("tie-long-singles", tieLongSingles, true, true, true, PANEL_FULL, nullptr, &semi);
  const Framebuffer tieLong =
      shot("tie-long-doubles", tieLongDoubles, true, true, true, PANEL_FULL, nullptr, &semi);
  // No cup name — a hand-edited draw, or a tie published by an app that has one and a
  // tournament that does not. The heading loses a row rather than the card failing.
  shot("tie-no-cup", tieSingles, true, true, true, PANEL_FULL, nullptr, &noCup);
  shot("tie-stale", tieDoubles, true, false, true, PANEL_FULL, nullptr, &semi);
  // Under PANEL_SCORE, to show the tie overrides the layout rather than combining.
  shot("tie-over-score", tieDoubles, true, true, true, PANEL_SCORE, nullptr, &semi);
  // A tie and a lineup retained at once, which is the ordinary case: both are cleared
  // at the first bag, and the tie is what a tournament shows before it.
  const Framebuffer tieBeatsForm =
      shot("tie-over-form", tieDoubles, true, true, true, PANEL_FULL, &doubles, &semi);
  // No state, so there are no sides to name. Unlike the lineup, the card cannot stand
  // on its own — it falls through to the dashes rather than drawing a heading over
  // nobody.
  const Framebuffer tieNoState =
      shot("tie-no-state", tieDoubles, false, true, true, PANEL_FULL, nullptr, &semi);

  // The draw card. A third screen with no layout id, so tools/test-firmware.mjs carries a
  // third standalone assertion that some scene has one.
  const auto drawOf = [](const char* round, const char* name, const char* oppA = "",
                         const char* oppB = "") {
    DrawState d;
    d.set = true;
    copyInto(round, d.round, DRAW_ROUND_MAX);
    d.named = name[0] != '\0';
    copyInto(name, d.name, DRAW_SIDE_MAX);
    for (const char* opp : {oppA, oppB}) {
      if (opp[0]) copyInto(opp, d.opponent[d.opponents++], DRAW_SIDE_MAX);
    }
    return d;
  };
  // The beat before a name lands: no "n" at all, which is what makes it a drum roll
  // rather than a nameless reveal.
  const DrawState drawPulling = drawOf("Preliminary", "");
  // A bye whose sibling seat is still in the hat. Resolves on the very next pull, which
  // is why it needs no wording of its own.
  const DrawState drawWaiting = drawOf("Quarter-final", "Chi");
  const DrawState drawPlays = drawOf("Preliminary", "Tau", "Rho");
  // The one thing a paper draw says that a finished bracket cannot.
  const DrawState drawWinnerOf = drawOf("Quarter-final", "Kappa", "Omega", "Iota");
  // Doubles at the app's 16-character cap. On its own row a side gets 21 characters, so
  // this one falls back to the slash; the shot() bounds check is what proves it fits,
  // because an unshortened 35-character label centres to a negative x.
  const DrawState drawLong =
      drawOf("Semi-final", "AlphaBetaGammaDe & DeltaEpsilonZeta", "EtaThetaIotaKapp");
  // Two long sides sharing the last row, which is the one place the card gives up
  // characters — 9 each, the same as the score screen's names.
  const DrawState drawLongPair = drawOf("Final", "Rho", "AlphaBetaGammaDe & DeltaEpsilonZeta",
                                        "EtaThetaIotaKapp & LambdaMuNuXiOmic");
  // The opening card: a cup and no round, which is the one shape that says what is about
  // to happen rather than what just did.
  const auto titleOf = [&drawOf](const char* cup, const char* round = "") {
    DrawState d = drawOf(round, "");
    copyInto(cup, d.cup, DRAW_CUP_MAX);
    return d;
  };
  const DrawState drawTitle = titleOf("Hole Corn VI");
  // Past the 21 characters a row holds, so the cut is drawn rather than assumed. Not
  // shortened the way a side is: a cup is not a pair and has no join to give up.
  const DrawState drawTitleLong = titleOf("AlphaBetaGammaDeltaEpsilonZeta");
  // A round *and* a cup, which the app never sends. The round wins, so a pull can never
  // come out captioned with the cup — the byte budget the whole split rests on.
  const DrawState drawBoth = titleOf("Hole Corn VI", "Preliminary");

  const Framebuffer cardPulling = shot("draw-pulling", tieSingles, true, true, true, PANEL_FULL,
                                       nullptr, nullptr, &drawPulling);
  shot("draw-waiting", tieSingles, true, true, true, PANEL_FULL, nullptr, nullptr, &drawWaiting);
  shot("draw-plays", tieSingles, true, true, true, PANEL_FULL, nullptr, nullptr, &drawPlays);
  const Framebuffer cardWinner = shot("draw-winner-of", tieSingles, true, true, true, PANEL_FULL,
                                      nullptr, nullptr, &drawWinnerOf);
  shot("draw-long-doubles", tieSingles, true, true, true, PANEL_FULL, nullptr, nullptr, &drawLong);
  shot("draw-winner-of-long", tieSingles, true, true, true, PANEL_FULL, nullptr, nullptr,
       &drawLongPair);
  shot("draw-stale", tieSingles, true, false, true, PANEL_FULL, nullptr, nullptr, &drawWinnerOf);
  // Over a tie, over a lineup and over the score layout, so the precedence is drawn rather
  // than only written down in renderBoard.
  const Framebuffer cardOverTie = shot("draw-over-tie", tieDoubles, true, true, true, PANEL_FULL,
                                       &doubles, &semi, &drawWinnerOf);
  shot("draw-over-score", tieDoubles, true, true, true, PANEL_SCORE, nullptr, nullptr,
       &drawWinnerOf);
  // The one the fixture card structurally cannot do: no score message at all. A draw is
  // taken before any game exists, so the card has to stand on its own.
  const Framebuffer cardNoState = shot("draw-no-state", makeState(0, 0, 0, "", ""), false, true,
                                       true, PANEL_FULL, nullptr, nullptr, &drawWinnerOf);

  const Framebuffer cardTitle = shot("draw-title", tieSingles, true, true, true, PANEL_FULL,
                                     nullptr, nullptr, &drawTitle);
  shot("draw-title-long", tieSingles, true, true, true, PANEL_FULL, nullptr, nullptr,
       &drawTitleLong);
  const Framebuffer cardTitleNoState = shot("draw-title-no-state", makeState(0, 0, 0, "", ""),
                                            false, true, true, PANEL_FULL, nullptr, nullptr,
                                            &drawTitle);
  const Framebuffer cardBoth = shot("draw-round-beats-cup", tieSingles, true, true, true,
                                    PANEL_FULL, nullptr, nullptr, &drawBoth);

  // **The card reads nothing but its own payload.** These two differ in every other input
  // there is — a full board state with two doubles labels, a retained tie and a retained
  // lineup against no state at all — and must draw the same pixels. That is what lets the
  // draw happen on a board that has never been sent a game, and no other assertion here
  // would notice a colour or a name leaking in from the score message.
  check(memcmp(cardNoState.px_, cardOverTie.px_, sizeof cardOverTie.px_) == 0,
        "the draw card must not depend on the score message");
  // The same for the opening card, which is the one most often up on a board that has
  // never been sent a game — the draw is taken before there is anything to send.
  check(memcmp(cardTitleNoState.px_, cardTitle.px_, sizeof cardTitle.px_) == 0,
        "the opening draw card must not depend on the score message");

  // A cup rides only on the card with no pull on it, so a card carrying both draws as the
  // pull alone. Without this the split that keeps the packet inside MQTT_BUFFER is a
  // convention of the app's rather than something the board holds to.
  check(memcmp(cardBoth.px_, cardPulling.px_, sizeof cardPulling.px_) == 0,
        "a round must beat a cup on the same draw card");

  // Two rows or four, centred in the panel either way, so a short card does not hang under
  // the round line with the bottom half of the screen empty. Stated as the property rather
  // than against the constant that drew it, the lesson SPLASH_THUMP taught.
  const auto topLit = [](const Framebuffer& fb) {
    for (int y = 0; y < PANEL_H; y++) {
      if (fb.litRow(y, 0, PANEL_W)) return y;
    }
    return PANEL_H;
  };
  check(topLit(cardPulling) > topLit(cardWinner),
        "a two-row draw card must sit lower than a four-row one");
  check(cardPulling.litBottom(0, PANEL_W) < cardWinner.litBottom(0, PANEL_W),
        "a two-row draw card must end higher than a four-row one");
  // The opening card is the same two rows in the same place, so the card does not jump up
  // the panel on the first press — it is the same screen with the words replaced.
  check(topLit(cardTitle) == topLit(cardPulling) &&
            cardTitle.litBottom(0, PANEL_W) == cardPulling.litBottom(0, PANEL_W),
        "the opening draw card must share the two-row geometry");

  // Both potential opponents drawn, either side of the mark. A card that rendered only the
  // first would pass every other check in this block.
  const int oppRow = cardWinner.litBottom(0, PANEL_W) - FONT_H + 1;
  check(cardWinner.litCount(oppRow, 0, PANEL_W / 2) > 0 &&
            cardWinner.litCount(oppRow, PANEL_W / 2, PANEL_W) > 0,
        "a winner-of card must name both halves of the preliminary");

  // The splash. Like the form screen it has no layout id, so tools/test-firmware.mjs
  // has a separate assertion that some scene carries one. Two colour pairs because
  // the pair is random at run time and one pair cannot show that the two words take
  // different masks; three indicator states plus none because the out-of-range branch
  // is what the sketch uses before it knows anything.
  const Framebuffer splashDefault = splashShot("splash-blue-red", "#2f80ed", "#eb5757", 2);
  const Framebuffer splashSwapped = splashShot("splash-red-blue", "#eb5757", "#2f80ed", 2);
  const Framebuffer splashNoWifi = splashShot("splash-no-wifi", "#27ae60", "#f2c94c", 0);
  splashShot("splash-wifi-only", "#f2c94c", "#27ae60", 1);
  const Framebuffer splashBare = splashShot("splash-no-dot", "#2f80ed", "#eb5757", -1);

  // The throws. The frames worth dumping are the one before any bag has been let go, the
  // top of the first arc, the moment after the first landing, one with the boards part
  // filled — and one long after, which is where the animation has to have stopped.
  //
  // No indicator on the arc frame: it is measured by what reaches the panel's top row, and
  // the dot lives there.
  const Framebuffer throwStart = splashShot("splash-throw-start", "#2f80ed", "#eb5757", 2, 0);
  const Framebuffer throwApex =
      splashShot("splash-throw-apex", "#2f80ed", "#eb5757", -1, SPLASH_FLIGHT_MS / 2);
  const Framebuffer throwThump =
      splashShot("splash-throw-thump", "#2f80ed", "#eb5757", 2, SPLASH_FLIGHT_MS + 10);
  // 2500ms: five bags down — three on one board, two on the other — the sixth in the air
  // and two still to be thrown. Derived from nothing on purpose, since a scene is a moment
  // somebody chose to look at, but it does have to be one with the boards part filled and
  // with no knock in progress, so that this frame and the thump frame each say one thing.
  const Framebuffer throwPart = splashShot("splash-throw-part", "#2f80ed", "#eb5757", 2, 2500);
  const Framebuffer throwHeld =
      splashShot("splash-throw-held", "#2f80ed", "#eb5757", 2, SPLASH_ANIM_MS * 10);

  // A different order, settled and part way through. A board is one colour, so the order
  // has to be invisible once everything has landed and visible before that.
  static const uint8_t shuffled[SPLASH_BOARDS][LOGO_LETTERS] = {{2, 0, 3, 1}, {1, 3, 0, 2}};
  const Framebuffer throwShuffled =
      splashShot("splash-throw-shuffled", "#2f80ed", "#eb5757", 2, SPLASH_ANIM_MS, shuffled);
  const Framebuffer throwShuffledMid =
      splashShot("splash-throw-shuffled-mid", "#2f80ed", "#eb5757", 2, 2500, shuffled);

  writeScenes();
  writeSplashCurve();

  printf("\nchecks\n");
  // segments.js has no dash — the browser never shows one — so the generator
  // synthesises it. An empty glyph here means a blank board before the first
  // message, which reads as broken rather than waiting.
  check(noState.lit() > 0, "no-state must draw dashes, not nothing");
  check(winOff.lit() < winOn.lit(), "winner blink should blank the winning pair");
  // The loser's score and both names must survive the flash, or the board
  // stops being readable for half of every beat.
  check(winOff.lit() > 100, "winner blink blanked too much");
  check(worstDuty < DUTY_CEILING, "no scene may approach a white screen — the power design rests on it");

  // The fixture card. The spread and the stack are the same four pieces of text at
  // different rows, so nothing about the *drawing* distinguishes them — what does is
  // whether a band of the panel is empty between the heading and the fixture.
  const auto darkestBand = [](const Framebuffer& fb) {
    int best = 0, run = 0;
    for (int y = 0; y < PANEL_H; y++) {
      run = fb.litRow(y, 0, PANEL_W) ? 0 : run + 1;
      if (run > best) best = run;
    }
    return best;
  };
  // Stacked fills all four rows, so the only gaps are the single pixel between them.
  check(darkestBand(tieStack) <= 1, "a stacked card leaves no room to spare");
  check(darkestBand(tieSpread) >= TIE_SPREAD_GAP,
        "a spread card puts the spare height between the heading and the fixture");
  // The threshold, and the pair is the point: one character decides it. Asserting
  // only that 20 spreads would pass with the limit at the 21 a line physically holds.
  check(darkestBand(tieAt20) >= TIE_SPREAD_GAP, "20 characters of fixture may spread");
  check(darkestBand(tieAt21) <= 1, "21 must not — it would run to the panel's edges");
  // Nobody to name, so the card cannot be drawn at all and the dashes stand.
  check(memcmp(tieNoState.px_, noState.px_, sizeof noState.px_) == 0,
        "a tie with no board state falls through to the no-state dashes");
  check(memcmp(tieBeatsForm.px_, tieStack.px_, sizeof tieStack.px_) == 0,
        "a tie wins over a lineup retained at the same time");
  check(memcmp(tieBeatsForm.px_, formD.px_, sizeof formD.px_) != 0,
        "and is not merely drawing the form screen");
  // The long doubles card still fits, which is what the slash fallback is for.
  check(tieLong.outOfBounds == 0, "a card of 16-character pairs stays on the panel");

  // What a full-width row buys over the score screen's name row, stated as the
  // characters rather than left to the pixels: a pair keeps the ampersand it was
  // typed with, and a 16-character singles name lands whole where fitLabel would
  // have cut it to nine.
  char side[TIE_LINE_CHARS + 1];
  fitTieSide("Neil & Rho", side, sizeof side);
  check(!strcmp(side, "Neil & Rho"), "a pair that fits the row keeps its ampersand");
  fitTieSide("AlphaBetaGammaDe", side, sizeof side);
  check(!strcmp(side, "AlphaBetaGammaDe"), "a name at the app's cap fits a whole row");
  char narrow[NAME_CHARS + 1];
  fitLabel("AlphaBetaGammaDe", narrow, sizeof narrow);
  check(strlen(narrow) < strlen("AlphaBetaGammaDe"),
        "which the score screen's own name row could not do");
  fitTieSide("AlphaBetaGammaDe & DeltaEpsilonZeta", side, sizeof side);
  check(!strcmp(side, "AlphaBetaG/DeltaEpsil"), "a pair too wide for the row still shortens");

  // The splash. logo.h is generated from public/logo.svg by a browser, so the thing
  // worth asserting here is that what came out is usable at all — an empty mask would
  // otherwise ship as a black screen for the first few seconds and read as a dead board.
  check(LOGO_W == PANEL_W && LOGO_H == PANEL_H, "the logo masks must be panel-sized");
  check(splashDefault.lit() > 100, "the splash must draw the wordmark, not nothing");
  // Swapping the pair has to change the frame, which is what proves the two words are
  // separate masks. A generator that put every pixel in one of them would pass every
  // other check here while making the second colour inert.
  check(memcmp(splashDefault.px_, splashSwapped.px_, sizeof splashDefault.px_) != 0,
        "the two words must take their colours independently");
  // And each in its own, which the assertion above cannot see: handing both boards the
  // same colour still changes the frame when the pair is swapped, so it passes. Found by
  // mutation, and it matters more now that a board's letters take the board's colour —
  // one board drawn in the other's is a mark that reads as one word.
  Rgb chalkA, chalkB;
  parseColor("#2f80ed", chalkA);
  parseColor("#eb5757", chalkB);
  check(splashDefault.hasColor(chalk(chalkA)) && splashDefault.hasColor(chalk(chalkB)),
        "and both of the pair must actually reach the panel");
  check(splashNoWifi.lit() == splashDefault.lit(),
        "the indicator state must not change how much is lit");
  // Exactly the dot's worth of extra pixels: both that it is drawn and that it lands
  // on empty panel rather than over the mark.
  check(splashDefault.lit() == splashBare.lit() + SPLASH_DOT * SPLASH_DOT,
        "the indicator must add its own pixels and cover none of the wordmark");
  check(splashDefault.litRow(SPLASH_DOT_Y, SPLASH_DOT_X, PANEL_W),
        "the indicator must be drawn where the constants put it");
  check(!splashBare.litRow(SPLASH_DOT_Y, SPLASH_DOT_X, PANEL_W),
        "an out-of-range connect state must draw no indicator");

  // The throws. Everything here is measured off the frames rather than off splashThrow, so
  // it is about what got drawn: a letter is written where it has got to, and an unguarded
  // write would wrap a bag onto the wrong module or onto the row above.
  //
  // The boards are up from the first frame and every letter's square is empty, which is
  // the pair of assertions a splash that drew the mark settled and merely moved the words
  // around would fail.
  for (int i = 0; i < LOGO_LETTERS; i++) {
    check(!throwStart.anyLitIn(LOGO_HOLE_LETTERS[i]) && !throwStart.anyLitIn(LOGO_CORN_LETTERS[i]),
          "before the first throw every letter must still be off the panel");
    check(splashDefault.anyLitIn(LOGO_HOLE_LETTERS[i]) &&
              splashDefault.anyLitIn(LOGO_CORN_LETTERS[i]),
          "settled, every letter must be on its own square");
  }
  check(throwStart.lit() > SPLASH_DOT * SPLASH_DOT,
        "the two boards must be up before the first bag is thrown");
  check(throwStart.lit() < splashDefault.lit(), "the boards alone must be less than the mark");
  check(throwPart.lit() > throwStart.lit() && throwPart.lit() < splashDefault.lit(),
        "part way through, some bags must have landed and some still be coming");

  // The arc, measured where it can only have come from one: at the top of its flight the
  // first bag is drawn above the board's own top edge, and nothing else on the panel ever
  // reaches that row. A flat throw — the slide this replaced — lights nothing here.
  check(!splashBare.litRow(0, 0, PANEL_W), "settled, nothing may reach the panel's top row");
  check(throwApex.litRow(0, 0, PANEL_W / 2),
        "at the top of its arc a bag must be drawn clear above the board");

  // The knock, and that it is the landing board's alone. HOLE's first bag lands at
  // SPLASH_FLIGHT_MS and CORN's a stagger later, so at this moment one board is down a
  // pixel and the other is not.
  //
  // Where one board's columns end and the other's begin is measured off the maps rather
  // than written down: it is the generator that decides how close the two boxes sit, and a
  // divider that fell inside either of them would put one board's bottom edge in the
  // other's column range and make both of these assertions meaningless.
  int holeRight = 0, cornLeft = PANEL_W;
  for (int y = 0; y < LOGO_H; y++) {
    for (int x = 0; x < LOGO_W; x++) {
      if (logoLevel(LOGO_HOLE[y], x) > 0 && x > holeRight) holeRight = x;
      if (logoLevel(LOGO_CORN[y], x) > 0 && x < cornLeft) cornLeft = x;
    }
  }
  check(holeRight < cornLeft, "the two boards must not share a column, or a knock cannot be told apart");
  const int divide = holeRight + 1;
  // The `> 0` is not redundant with the sum: without it the assertion is written in terms
  // of the constant it is checking, so setting SPLASH_THUMP to 0 satisfies both sides and
  // the knock leaves the animation without a single check noticing. Found by mutation.
  check(SPLASH_THUMP > 0 &&
            throwThump.litBottom(0, divide) == splashDefault.litBottom(0, divide) + SPLASH_THUMP,
        "a landing must knock the board it lands in down a pixel");
  check(throwThump.litBottom(divide, PANEL_W) == splashDefault.litBottom(divide, PANEL_W),
        "and must not knock the other board, which nothing has landed in yet");

  // And the bag resting on it goes down with it, or the two come apart for the 70ms the
  // board is low. Counted against the mask rather than against another frame: every pixel
  // the bag has must be lit at the offset the flight reports plus the knock, so a board
  // that dropped on its own leaves the bottom row of each stroke unaccounted for.
  const LogoRect& firstBag = LOGO_HOLE_LETTERS[SPLASH_IN_ORDER[0][0]];
  const SplashOffset resting = splashThrow(firstBag, -1, 0, 0, SPLASH_FLIGHT_MS + 10);
  int bagPixels = 0, bagDrawn = 0;
  for (int y = firstBag.y0; y <= firstBag.y1; y++) {
    for (int x = firstBag.x0; x <= firstBag.x1; x++) {
      if (logoLevel(LOGO_HOLE[y], x) == 0) continue;
      bagPixels++;
      if (throwThump.litAt(x + resting.dx, y + resting.dy + SPLASH_THUMP)) bagDrawn++;
    }
  }
  check(bagPixels > 0 && bagDrawn == bagPixels,
        "and the bag that landed must go down with it, not hang where it was");

  check(memcmp(splashDefault.px_, throwHeld.px_, sizeof splashDefault.px_) == 0,
        "the throws must finish and then stay finished");

  // The order is what the sketch shuffles, and both halves of what it may change are
  // asserted. It decides the animation and nothing that survives it: a board is one
  // colour, so once every bag is down the frame is the app's wordmark whichever order they
  // arrived in. This is the assertion that would fail if a bag ever took a colour of its
  // own — which is how the first version of this animation worked, and is not what is
  // wanted: the mark the throws settle into has to be the logo, not a variant of it.
  check(memcmp(splashDefault.px_, throwShuffled.px_, sizeof splashDefault.px_) == 0,
        "the order must leave no trace once every bag has landed");
  check(memcmp(throwPart.px_, throwShuffledMid.px_, sizeof throwPart.px_) != 0,
        "but part way through it must decide which bags are already down");

  // The ends of the flight, because nothing above can see them: every frame here is
  // rendered through the same offset, so a bag that settled a pixel off its square would
  // shift the PPMs with it and pass the comparison against them.
  const SplashOffset landed = splashThrow(LOGO_HOLE_LETTERS[0], -1, 0, 0, SPLASH_ANIM_MS);
  const SplashOffset thrown = splashThrow(LOGO_HOLE_LETTERS[0], -1, 0, 0, 0);
  const SplashOffset peak = splashThrow(LOGO_HOLE_LETTERS[0], -1, 0, 0, SPLASH_FLIGHT_MS / 2);
  const SplashOffset touchdown = splashThrow(LOGO_HOLE_LETTERS[0], -1, 0, 0, SPLASH_FLIGHT_MS);
  check(landed.dx == 0 && landed.dy == 0, "a bag must settle where the mask puts it");
  check(thrown.dx == -(LOGO_HOLE_LETTERS[0].x1 + 1) && thrown.dy == 0,
        "and start just off its own edge, not a panel out");
  check(peak.dy == -SPLASH_APEX, "the arc must reach its apex half way through the flight");
  // Stated as short-and-down rather than as SPLASH_SKID, for the reason the knock above
  // is: comparing against the constant lets a skid of zero pass, and then a bag stops dead
  // where it lands with nothing to say so.
  check(touchdown.dx < 0 && touchdown.dy == 0,
        "and touch down short of its square, with the slide still to come");

  // The wordmark is antialiased, which no count of lit pixels can see: a hard-masked
  // asset would satisfy every check above. Its whole purpose is the tilted strokes, and
  // it is the reason the mark fits under DUTY_CEILING at this size at all.
  printf("  splash: %d brightnesses, faintest %d, %d lit\n", splashBare.intensities(),
         splashBare.faintest(), splashBare.lit());
  check(splashBare.intensities() > 8, "the splash must carry coverage, not an on/off mask");
  // Asserted on the asset rather than on this frame, so it does not depend on which
  // colours the scene happened to use. Below ~40% an edge pixel is invisible at
  // PANEL_BRIGHTNESS 40, and keeping the fainter ones put the lit count over the
  // ceiling — measured, 34.6% with no floor. So the bound is load-bearing twice over.
  check(LOGO_MIN_LEVEL * 5 >= LOGO_LEVELS * 2,
        "the coverage floor must keep every splash pixel above ~40% brightness");
  // uint8_t arithmetic, so an unclamped mix would wrap a bright channel to nearly black.
  check(chalked(255) == 255, "the chalk tint must not overflow a full channel");
  check(chalked(0) > 0, "the chalk tint must lift a dark channel");

  // PANEL_SCORE exists to buy digit height by giving up the names, so the thing
  // worth asserting is that it actually does. Anything less and the layout is a
  // worse version of PANEL_FULL with the names deleted.
  check(GLYPH_BIG_H > GLYPH_SMALL_H * 5 / 4, "score digits must be meaningfully taller");
  check(SCORE_DIGIT_Y + GLYPH_BIG_H <= SCORE_RULE_Y, "score digits must clear the rule row");
  // Measured off the framebuffer, not read off the constants: this is the whole
  // claim of the layout, and asserting GLYPH_BIG_H against itself would prove
  // nothing about what got drawn.
  const int fullDigitH = fullBlank.litSpan(LEFT_X, LEFT_X + PAIR_W);
  const int scoreDigitH = scoreBlank.litSpan(SCORE_LEFT_X, SCORE_LEFT_X + SCORE_PAIR_W);
  printf("  digit height on the panel: full %d, score %d\n", fullDigitH, scoreDigitH);
  check(fullDigitH == GLYPH_SMALL_H, "full layout draws its digits at the small size");
  check(scoreDigitH == GLYPH_BIG_H, "score layout draws its digits at the big size");
  check(scoreDigitH * 4 >= fullDigitH * 5, "score digits must be at least 25% taller");
  // Who throws next survives the loss of the names, ruled under their score.
  check(scorePlay.litRow(SCORE_RULE_Y, SCORE_LEFT_X, SCORE_LEFT_X + SCORE_PAIR_W),
        "score layout rules the side due to throw");
  check(!scorePlay.litRow(SCORE_RULE_Y, SCORE_RIGHT_X, SCORE_RIGHT_X + SCORE_PAIR_W),
        "singles leaves the other side of the score layout unruled");
  // Doubles marks the player throwing after them from the same end, and it has to be
  // told from the solid one by *shape* — a dimmer rule would be invisible on a real
  // module, the reason a loss pip is a single pixel. Counted rather than merely lit,
  // or a solid rule on both sides would pass.
  {
    const int solid = scorePair.litCount(SCORE_RULE_Y, SCORE_RIGHT_X,
                                         SCORE_RIGHT_X + SCORE_PAIR_W);
    const int dashed = scorePair.litCount(SCORE_RULE_Y, SCORE_LEFT_X,
                                          SCORE_LEFT_X + SCORE_PAIR_W);
    check(solid == SCORE_PAIR_W, "the throwing side's score rule is solid");
    check(dashed > 0 && dashed * 2 <= solid + 1, "the other end's is dashed, not solid");
  }
  check(scoreWorst.lit() > worst.lit(), "score layout should light more than full — it is bigger");
  check(scoreNoState.lit() > 0, "score no-state must draw dashes, not nothing");
  check(scoreWinOff.lit() < scoreWinOn.lit(), "score winner blink should blank the winning pair");
  check(scoreWinOff.lit() > 100, "score winner blink blanked too much");
  // The middle column has to clear both pairs at this digit width, or the round
  // marker lands on top of a score.
  check(textWidth("TO 99", 8) < SCORE_RIGHT_X - (SCORE_LEFT_X + SCORE_PAIR_W),
        "the score layout's target line clears both pairs");

  // The form screen's number columns are sized to the lineup in front of them, so the
  // assertions are about that adapting rather than about a constant: an ordinary roster
  // must get more name than a punishing one, and the widest case must still not collide.
  const FormLayout lyD = formLayout(doubles);
  const FormLayout lyW = formLayout(formWorst);
  const FormLayout lyB = formLayout(formBig);
  printf("\n  form: %d rows of %d, pips at x=%d\n", PANEL_H / FORM_ROW_H, FORM_ROW_H,
         FORM_PIPS_X);
  printf("  name chars: %d for \"6-4\", %d for \"99-99\", %d for \"120-87\"\n",
         lyD.nameChars, lyW.nameChars, lyB.nameChars);
  check(PANEL_H / FORM_ROW_H >= LINEUP_MAX, "a doubles roster must fit the panel");
  // The point of adapting. A fixed worst-case column gave 8 everywhere.
  check(lyD.nameChars >= 11, "an ordinary record must leave room for a real name");
  check(lyD.nameChars > lyW.nameChars, "a narrower record must buy name characters");
  check(lyW.nameChars > lyB.nameChars, "and a three-digit record must cost them");
  // Six is the floor: the widest record and rate the clamps allow, together.
  check(lyB.nameChars >= 6, "even a three-digit record must leave a readable name");

  // Lit pixels in a column band across one row of the form screen.
  const auto band = [](const Framebuffer& fb, int rowY, int x0, int x1) {
    int n = 0;
    for (int y = rowY; y < rowY + FORM_ROW_H; y++) n += fb.litCount(y, x0, x1);
    return n;
  };

  // Nothing may be drawn in the gap between the name column and the record, on any
  // row, for either the widest two-digit case or the three-digit one. This is what
  // makes adapting safe rather than merely tighter.
  const auto clears = [&](const Framebuffer& fb, const FormLayout& f) {
    int gap = 0;
    for (int i = 0; i < LINEUP_MAX; i++) {
      gap += band(fb, i * FORM_ROW_H, f.nameChars * FONT_ADVANCE,
                  f.wlRight - (f.wlChars * FONT_ADVANCE - 1));
    }
    return gap;
  };
  check(clears(formW, lyW) == 0, "\"99-99\" clears the name column on every row");
  check(clears(formB, lyB) == 0, "\"120-87\" clears it too");
  // Four rows of text must not creep past the last row of the panel.
  check(!formW.litRow(PANEL_H - 1, 0, PANEL_W), "the fourth form row stays on the panel");
  check(!formB.litRow(PANEL_H - 1, 0, PANEL_W), "nor with a three-digit record");
  // Singles centres two rows rather than pinning them to the top.
  check(!formS.litRow(0, 0, PANEL_W), "a singles form screen is centred, not top-aligned");
  check(formD.litRow(0, 0, PANEL_W), "a doubles form screen fills the panel");
  check(formD.lit() > formS.lit(), "four rows light more than two");

  // The bags. This is the screen a board holds while everyone walks to the boards, so
  // it is the one that has to say who is throwing — and the only board screen with a
  // row to spare for a bag rather than a rule.
  {
    const int y0 = (PANEL_H - 4 * FORM_ROW_H) / 2;
    const int y2 = (PANEL_H - 2 * FORM_ROW_H) / 2;
    const auto bag = [&](const Framebuffer& fb, int rowY) {
      return band(fb, rowY, 0, BAG);
    };
    // Filled is BAG*BAG and hollow is its edge, so counting tells them apart where
    // "is something drawn" would pass with two of either.
    check(bag(formBagD, y0) == BAG * BAG, "the first thrower's bag is filled");
    check(bag(formBagD, y0 + 2 * FORM_ROW_H) == BAG * BAG - (BAG - 2) * (BAG - 2),
          "the other end's player gets a hollow one");
    check(bag(formBagD, y0 + FORM_ROW_H) == 0, "the partner waiting at the far end gets none");
    check(bag(formBagD, y0 + 3 * FORM_ROW_H) == 0, "nor theirs");
    // Singles has nobody at that end to tell from the thrower, so only one bag — the
    // same rule the score layouts read off the label, here read off the row count.
    check(bag(formBagS, y2) == BAG * BAG, "singles marks the thrower");
    check(bag(formBagS, y2 + FORM_ROW_H) == 0, "and marks nobody else");
    // The column is reserved on every row, so an unmarked name starts where a marked
    // one does. Without this the marked row is the only one indented.
    check(formBagD.litCount(y0 + 1, 0, BAG_ADVANCE) > 0 &&
              !formBagD.litRow(y0 + FORM_ROW_H + 1, 0, BAG_ADVANCE),
          "an unmarked row leaves the bag column empty");
    const FormLayout lyBag = formLayout(doubles);
    check(band(formBagD, y0 + FORM_ROW_H, 0, BAG_ADVANCE) == 0,
          "and its name starts past the column rather than in it");
    // A board sent a roster but no score has nobody to mark, and then the column
    // costs a character for nothing.
    check(band(formD, y0, 0, BAG_ADVANCE) > 0,
          "with no first thrower the names keep the whole column");
    check(lyBag.nameChars - 1 >= 6, "a bag must still leave a readable name");
  }

  // A newcomer's row is their name and 0-0 and nothing else: no pips, and no rate
  // column claiming 0.0. Two rows, so both are centred and the newcomer is second.
  const FormLayout lyN = formLayout(formNew);
  const int formNY = (PANEL_H - 2 * FORM_ROW_H) / 2;
  const int pprLeft = lyN.pprRight - (lyN.pprChars * FONT_ADVANCE - 1);
  check(band(formN, formNY + FORM_ROW_H, FORM_PIPS_X, PANEL_W) == 0,
        "a player with no matches gets no form pips");
  check(band(formN, formNY + FORM_ROW_H, pprLeft, lyN.pprRight) == 0,
        "a player with no matches gets no PPR");
  check(band(formN, formNY, FORM_PIPS_X, PANEL_W) > 0, "and the row above still has its pips");
  check(band(formN, formNY + FORM_ROW_H, 0, lyN.nameChars * FONT_ADVANCE) > 0,
        "their name is still drawn");

  // The distinction the blank column is *for*. A 0.0 average is a real one, so it
  // is drawn; only a 0-0 record suppresses the rate. Gating on the rate itself
  // blanked this row, which reads as missing data rather than a bad run.
  const FormLayout lyZ = formLayout(formZero);
  const int zeroRateY = formNY + FORM_ROW_H;
  check(band(formZ, zeroRateY, lyZ.pprRight - (lyZ.pprChars * FONT_ADVANCE - 1), lyZ.pprRight) > 0,
        "a played player averaging 0.0 still shows a rate");
  check(band(formZ, zeroRateY, FORM_PIPS_X, PANEL_W) > 0, "and their losing run of pips");

  // The other half of that distinction: a record with no rounds behind it — a
  // match imported from a written-down result — has no rate to give, so the
  // column stays empty while the record and the pips draw as usual. Without this
  // the board reports somebody who has played a dozen games as averaging 0.0.
  const FormLayout lyI = formLayout(formImported);
  check(band(formI, formNY, lyI.pprRight - (lyI.pprChars * FONT_ADVANCE - 1), lyI.pprRight) == 0,
        "a record with no rate behind it shows no PPR");
  check(band(formI, formNY, FORM_PIPS_X, PANEL_W) > 0, "but keeps its form pips");
  check(band(formI, formNY + FORM_ROW_H, lyI.pprRight - (lyI.pprChars * FONT_ADVANCE - 1),
             lyI.pprRight) > 0,
        "and the row that does have one still draws it");
  // With nobody supplying a rate the column costs no width at all, so the names
  // get it — the same trade formLayout makes for a narrower record.
  const FormLayout lyNR = formLayout(formNoRates);
  check(lyNR.pprChars == 0, "no rates anywhere means no rate column");
  check(lyNR.nameChars > lyI.nameChars, "and the names take the width it gives up");
  check(band(formNR, formNY, lyNR.wlRight - (lyNR.wlChars * FONT_ADVANCE - 1), lyNR.wlRight) > 0,
        "and the records still draw");

  Rgb c;
  parseColor("#2f80ed", c);
  check(c.r == 0x2f && c.g == 0x80 && c.b == 0xed, "parseColor");
  Rgb white;
  parseColor("not a colour", white);
  check(white.r == 255 && white.g == 255 && white.b == 255, "bad colour falls back to white");

  // Asserted off the framebuffer rather than against FONT_UNKNOWN, so it proves what got
  // *drawn*: a row of dashes is ink where a row of spaces was not. Compared with the
  // "play" scene's own name row, which draws two ordinary Latin names.
  {
    Framebuffer plain;
    renderBoard(plain, play, true, true, true, PANEL_FULL, nullptr);
    int litUnshown = 0;
    int litPlain = 0;
    for (int y = 0; y < FONT_H; y++) {
      litUnshown += unshown.litCount(y, 0, PANEL_W);
      litPlain += plain.litCount(y, 0, PANEL_W);
    }
    check(litUnshown > 60, "a name the font cannot draw still lights the name row");
    check(litUnshown < litPlain, "but less than a name it can, so the two are not confused");
  }

  char label[TEAM_LABEL_MAX];
  copyLabel("ABCDEFGHIJKLMNOP & QRSTUVWXYZABCDEF", label);
  check(strlen(label) == 35, "a worst-case doubles label survives parse intact");
  copyLabel("ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQ", label);
  check(strlen(label) == TEAM_LABEL_MAX - 1, "anything longer still truncates");

  char da[NAME_CHARS + 1], db[NAME_CHARS + 1];

  fitLabels("Zeta", "Rho", da, db, sizeof da);
  check(!strcmp(da, "Zeta") && !strcmp(db, "Rho"), "singles names pass through");

  fitLabels("Rho & Tau", "Zeta & Phi", da, db, sizeof da);
  check(!strcmp(da, "Rho/Tau") && !strcmp(db, "Zeta/Phi"), "the pair joins with a slash");

  // Nine characters of name fit whole on a slash; " & " would have shortened
  // both of these.
  fitLabels("Alpha & Phi", "Gamma & Chi", da, db, sizeof da);
  check(!strcmp(da, "Alpha/Phi") && !strcmp(db, "Gamma/Chi"),
        "the slash buys back two characters");

  // Both sides shorten by the same amount, so it reads as deliberate.
  fitLabels("Gamma & Alpha", "Delta & Kappa", da, db, sizeof da);
  check(!strcmp(da, "Gamm/Alph") && !strcmp(db, "Delt/Kapp"), "shortens both sides");

  // Two names sharing an initial must not collapse to "O/O". Omega and Omicron are
  // the only pair here that share one, which is why this fixture is not interchangeable
  // with the others.
  fitLabels("Omega & Omicron", "Upsilon & Rho", da, db, sizeof da);
  check(!strcmp(da, "Omeg/Omic") && !strcmp(db, "Upsil/Rho"),
        "shared initials stay distinguishable");

  // Each label shortens on its own: a name that fits must not be cut because
  // the opposing label is long.
  fitLabels("Lambda", "Omicron & Upsilon", da, db, sizeof da);
  check(!strcmp(da, "Lambda") && !strcmp(db, "Omic/Upsi"),
        "one team's long label does not shorten the other");

  fitLabels("ABCDEFGHIJKLMNOP & QRSTUVWXYZABCDEF", "Nu & Tau", da, db, sizeof da);
  check(strlen(da) <= NAME_CHARS && strlen(db) <= NAME_CHARS,
        "worst-case label still fits the slot");

  // The rule sits on its own row between the names and the digits, on the side
  // due to throw, and comes off once the game is won.
  {
    Framebuffer fa, fb2, fw, fnone;
    const BoardState first_a = makeState(12, 7, 5, "Theta", "Nu", 0, 'a');
    const BoardState first_b = makeState(12, 7, 5, "Theta", "Nu", 0, 'b');
    const BoardState wonWhileUp = makeState(21, 7, 9, "Theta", "Nu", 'a', 'a');
    const BoardState unset = makeState(12, 7, 5, "Theta", "Nu");
    renderBoard(fa, first_a, true, true, true);
    renderBoard(fb2, first_b, true, true, true);
    renderBoard(fw, wonWhileUp, true, true, true);
    renderBoard(fnone, unset, true, true, true);

    check(fa.litRow(UNDERLINE_Y, 0, PANEL_W / 2), "team A underlined when A throws");
    check(!fa.litRow(UNDERLINE_Y, PANEL_W / 2, PANEL_W), "only the throwing side is ruled");
    check(fb2.litRow(UNDERLINE_Y, PANEL_W / 2, PANEL_W), "team B underlined when B throws");
    check(!fw.litRow(UNDERLINE_Y, 0, PANEL_W), "no rule once the game is won");
    check(!fnone.litRow(UNDERLINE_Y, 0, PANEL_W),
          "no rule when an older publisher omits first");
    // The rule must not eat into the name or the digits.
    check(UNDERLINE_Y >= FONT_H && UNDERLINE_Y < DIGIT_Y, "rule sits in the gap");
  }

  // In doubles only the partner who is up is ruled, and which one alternates
  // with the round exactly as activeIdx does in App.jsx.
  {
    const int RIGHT = PANEL_W / 2;
    Framebuffer evenRound, oddRound;
    // "Alpha & Phi" fits whole as "Alpha/Phi".
    renderBoard(evenRound, makeState(9, 6, 4, "Nu & Tau", "Alpha & Phi", 0, 'b'), true,
                true, true);
    renderBoard(oddRound, makeState(9, 6, 5, "Nu & Tau", "Alpha & Phi", 0, 'b'), true,
                true, true);

    const int whole = textWidth("Alpha/Phi", NAME_CHARS);
    const int firstPartner = textWidth("Alpha", NAME_CHARS);
    const int secondPartner = textWidth("Phi", NAME_CHARS);

    check(evenRound.litCount(UNDERLINE_Y, RIGHT, PANEL_W) == firstPartner,
          "even round rules the first partner only");
    check(oddRound.litCount(UNDERLINE_Y, RIGHT, PANEL_W) == secondPartner,
          "odd round rules the second partner only");
    check(firstPartner < whole && secondPartner < whole,
          "a doubles rule is never the width of the whole label");
    // The other team's player at that end throws next, so they are ruled too — dashed,
    // and under their own up partner rather than the whole label. "Nu/Tau" on an even
    // round means Nu, so the dashes must sit within Nu's characters and nowhere else.
    const int nuWidth = textWidth("Nu", NAME_CHARS);
    const int dashes = evenRound.litCount(UNDERLINE_Y, 0, RIGHT);
    check(dashes > 0, "the other end's player is ruled as well");
    check(dashes * 2 <= nuWidth + 1, "and dashed rather than solid");
    check(evenRound.litCount(UNDERLINE_Y, 0, RIGHT) ==
              evenRound.litCount(UNDERLINE_Y, 0, RIGHT / 2 + nuWidth),
          "the dashed rule stays under the partner who is up");

    // Singles has no partner to pick, so the whole name is ruled — and nobody at that
    // end to tell from the thrower, so the other side gets nothing at all. Both halves
    // here: the first is what makes the second a real assertion.
    Framebuffer single;
    renderBoard(single, makeState(9, 6, 5, "Nu", "Alpha", 0, 'b'), true, true, true);
    check(single.litCount(UNDERLINE_Y, RIGHT, PANEL_W) == textWidth("Alpha", NAME_CHARS),
          "singles rules the whole name");
    check(!single.litRow(UNDERLINE_Y, 0, RIGHT), "singles has no second mark");
  }

  // The "V" has its own column, so it must clear two full-length names.
  {
    const int widest = textWidth("ABCDEFGHI", NAME_CHARS);
    const int nxA = (NAME_REGION_W - widest) / 2;
    const int nxB = (PANEL_W - NAME_REGION_W) + nxA;
    const int vx = (PANEL_W - FONT_W) / 2;
    check(NAME_CHARS == 9, "the V costs exactly one name character");
    check(nxA + widest <= vx, "the V clears the longest left-hand name");
    check(vx + FONT_W <= nxB, "the V clears the longest right-hand name");
  }

  // "TO 21" is the widest the middle column gets, and it must not touch the
  // digits either side.
  check(textWidth("TO 99", 8) < RIGHT_X - (LEFT_X + PAIR_W),
        "the target line clears both score pairs");

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
