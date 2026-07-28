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

// Both panels are fed through the MatrixPortal's 5 V terminals, which only holds
// while the layout stays far from white — see Power in README.md.
static const double DUTY_CEILING = 30.0;
static double worstDuty = 0;

// Every shot() is also described in out/scenes.json, so src/panel.js can be
// rendered against the same inputs and compared byte for byte — see
// tools/test-firmware.mjs. Written from here rather than listed there because a
// scene table maintained in two languages is exactly the drift this is meant to
// catch.
static std::vector<std::string> scenes;

static std::string quoted(const char* s) {
  std::string out = "\"";
  for (int i = 0; s[i]; i++) {
    if (s[i] == '"' || s[i] == '\\') out += '\\';
    out += s[i];
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

static void record(const std::string& name, const BoardState& s, bool haveState, bool live,
                   bool blinkOn) {
  const auto flag = [](bool b) { return std::string(b ? "true" : "false"); };
  scenes.push_back(
      "{\"name\":" + quoted(name.c_str()) + ",\"a\":" + std::to_string(s.a) +
      ",\"b\":" + std::to_string(s.b) + ",\"round\":" + std::to_string(s.round) +
      ",\"target\":" + std::to_string(s.target) + ",\"winner\":" + teamJson(s.winner) +
      ",\"first\":" + teamJson(s.first) + ",\"teamA\":" + quoted(s.teamA) +
      ",\"teamB\":" + quoted(s.teamB) + ",\"colorA\":" + colorJson(s.colorA) +
      ",\"colorB\":" + colorJson(s.colorB) + ",\"haveState\":" + flag(haveState) +
      ",\"live\":" + flag(live) + ",\"blinkOn\":" + flag(blinkOn) + "}");
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
                        bool live, bool blinkOn) {
  Framebuffer fb;
  renderBoard(fb, s, haveState, live, blinkOn);
  fb.write(name);
  record(name, s, haveState, live, blinkOn);
  check(fb.outOfBounds == 0, (name + ": drew outside the panel").c_str());
  const double duty = 100.0 * fb.lit() / (PANEL_W * PANEL_H);
  if (duty > worstDuty) worstDuty = duty;
  printf("  %-14s %4d lit  (%4.1f%% duty)\n", name.c_str(), fb.lit(), duty);
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
  // None of the scenes above sets `first`, so without these two the underline —
  // and which partner it picks — would go uncompared against src/panel.js.
  const BoardState ruledSingle = makeState(12, 7, 5, "Theta", "Nu", 0, 'a');
  const BoardState ruledPair = makeState(9, 6, 5, "Nu & Tau", "Alpha & Phi", 0, 'b');

  shot("play", play, true, true, true);
  shot("early", early, true, true, true);
  shot("long-names", longNames, true, true, true);
  shot("stale", play, true, false, true);
  const Framebuffer noState = shot("no-state", play, false, true, true);
  const Framebuffer winOn = shot("winner-on", won, true, true, true);
  const Framebuffer winOff = shot("winner-off", won, true, true, false);
  shot("worst", big, true, true, true);
  shot("ruled-single", ruledSingle, true, true, true);
  shot("ruled-pair", ruledPair, true, true, true);
  writeScenes();

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
  copyLabel("ABCDEFGHIJKLMNOP & QRSTUVWXYZABCDEF", label);
  check(strlen(label) == 35, "a worst-case doubles label survives parse intact");
  copyLabel("ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQ", label);
  check(strlen(label) == TEAM_LABEL_MAX - 1, "anything longer still truncates");

  char da[NAME_CHARS + 1], db[NAME_CHARS + 1];

  fitLabels("Theta", "Nu", da, db, sizeof da);
  check(!strcmp(da, "Theta") && !strcmp(db, "Nu"), "singles names pass through");

  fitLabels("Nu & Tau", "Theta & Phi", da, db, sizeof da);
  check(!strcmp(da, "Nu/Tau") && !strcmp(db, "Theta/Phi"), "the pair joins with a slash");

  // Nine characters of name fit whole on a slash; " & " would have shortened
  // both of these.
  fitLabels("Alpha & Phi", "Gamma & Chi", da, db, sizeof da);
  check(!strcmp(da, "Alpha/Phi") && !strcmp(db, "Gamma/Chi"),
        "the slash buys back two characters");

  // Both sides shorten by the same amount, so it reads as deliberate.
  fitLabels("Gamma & Alpha", "Delta & Kappa", da, db, sizeof da);
  check(!strcmp(da, "Gamm/Alph") && !strcmp(db, "Delt/Kapp"), "shortens both sides");

  // Two names sharing an initial must not collapse to "H/H".
  fitLabels("Gamma & Kappa", "Omicron & Phi", da, db, sizeof da);
  check(!strcmp(da, "Gamm/Kapp") && !strcmp(db, "Omicr/Phi"),
        "shared initials stay distinguishable");

  // Each label shortens on its own: a name that fits must not be cut because
  // the opposing label is long.
  fitLabels("AlphaBet", "Omicron & Upsilon", da, db, sizeof da);
  check(!strcmp(da, "AlphaBet") && !strcmp(db, "Omic/Upsi"),
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
    check(!evenRound.litRow(UNDERLINE_Y, 0, RIGHT), "the other team stays unruled");

    // Singles has no partner to pick, so the whole name is ruled.
    Framebuffer single;
    renderBoard(single, makeState(9, 6, 5, "Nu", "Alpha", 0, 'b'), true, true, true);
    check(single.litCount(UNDERLINE_Y, RIGHT, PANEL_W) == textWidth("Alpha", NAME_CHARS),
          "singles rules the whole name");
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
