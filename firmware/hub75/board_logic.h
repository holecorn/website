// Kept free of Arduino dependencies so it compiles and runs on a host — that is
// how MQTT_BUFFER was sized rather than guessed. See README.md.
#pragma once

#include <ArduinoJson.h>
#include <stddef.h>

// Mirrors REORDER_WINDOW in src/scoreboard.js, and tools/test-firmware.mjs holds the two
// equal — this cited the wrong file for a while with nothing to notice.
static const long long REORDER_WINDOW_MS = 60000;

struct Rgb {
  uint8_t r = 255, g = 255, b = 255;
};

inline int clampInt(int v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : v); }

// Holds a full ASCII doubles label: each name caps at 16 UTF-16 units, joined
// with " & ", so 35 characters. Don't shrink it to "what the panel can
// display" — render.h shortens an oversized label by cutting *both* names,
// which needs the whole thing, and truncating here eats the second player's
// name first.
//
// Non-ASCII names still overrun it: 16 UTF-16 units can be 48 bytes, so a
// label reaches 99 and is cut mid-character. The panel cannot render those
// scripts anyway (see firmware/hub75/README.md), so this is a known limit
// rather than a size to keep chasing.
static const size_t TEAM_LABEL_MAX = 40;

// Which arrangement the panel draws. Published on holecorn/<code>/layout as a
// short id, deliberately **not** carried in the score payload: it is a different
// fact with a different lifetime, the score budget is already 74% spent in the
// worst case, and a separate retained topic means a board that reboots recovers
// the choice the same way it recovers presence.
enum PanelLayout : uint8_t {
  PANEL_FULL = 0,   // names, score, round, target — reads to ~4-9 m
  PANEL_SCORE = 1,  // score only, digits half again as tall
};
static const int PANEL_LAYOUT_COUNT = 2;
static const char* const PANEL_LAYOUT_IDS[PANEL_LAYOUT_COUNT] = {"full", "score"};

// Returns false for anything unrecognised and leaves `out` alone. An id from a
// newer app than this firmware must keep the board drawing whatever it already
// was — blanking it or dropping to a layout nobody chose would both be worse
// than ignoring the message. The payload is an MQTT byte array and is not
// NUL-terminated, hence the length compare.
inline bool parseLayout(const char* payload, size_t length, PanelLayout& out) {
  if (!payload) return false;
  for (int i = 0; i < PANEL_LAYOUT_COUNT; i++) {
    const char* id = PANEL_LAYOUT_IDS[i];
    size_t n = 0;
    while (id[n]) n++;
    if (n != length) continue;
    bool same = true;
    for (size_t j = 0; j < n; j++) {
      if (id[j] != payload[j]) {
        same = false;
        break;
      }
    }
    if (same) {
      out = PanelLayout(i);
      return true;
    }
  }
  return false;
}

// --------------------------------------------------------------- brightness --
//
// The MatrixPortal's own UP and DOWN buttons step through these. A table rather
// than a fixed increment because perceived brightness is roughly logarithmic and
// the library's scaling is unverified (see README), so even steps in the value
// would bunch at the top and do almost nothing at the bottom.
//
// The floor is the value every faint thing on the panel was judged against: at 40
// a pixel below ~40% of full is indistinguishable from off, which is what
// `COVERAGE_FLOOR` and the single-pixel loss pip are calibrated to, and nothing has
// ever been looked at darker than this. The ceiling is what the supply allows —
// 255 puts the worst-case scene at 1.33 A against a port that folds back at 3 A.
static const uint8_t BRIGHTNESS_LEVELS[] = {40, 70, 120, 180, 255};
static const int BRIGHTNESS_LEVEL_COUNT =
    sizeof BRIGHTNESS_LEVELS / sizeof BRIGHTNESS_LEVELS[0];

// Where the board boots, deliberately not remembered across a reboot: brightness
// tracks the light on the day, so the darkest step is as likely to be right as
// whatever was set last session, and it is the one that cannot dazzle.
static const int BRIGHTNESS_DEFAULT_STEP = 0;
static const uint8_t PANEL_BRIGHTNESS = BRIGHTNESS_LEVELS[BRIGHTNESS_DEFAULT_STEP];

// Clamps rather than wrapping, which is the whole reason this is a function.
inline int stepBrightness(int step, int dir) {
  return clampInt(step + dir, 0, BRIGHTNESS_LEVEL_COUNT - 1);
}

// ------------------------------------------------------------- pre-game form --
//
// The lineup arrives on holecorn/<code>/lineup, retained, and is *cleared* when
// the first bag is thrown. Its presence is the whole trigger for the form screen
// — there is no mode field and no third layout id, because a layout is a
// preference the scorer sets and this is a phase of the game.
static const int LINEUP_MAX = 4;
// Same limit copyLabel documents: 16 UTF-16 code units can be 48 bytes of UTF-8.
static const size_t LINEUP_NAME_MAX = 49;
static const int LINEUP_FORM_MAX = 5;

struct LineupRow {
  char name[LINEUP_NAME_MAX] = {0};
  int wins = 0;
  int losses = 0;
  int ppr = -1;                           // tenths, so 72 draws as "7.2"; -1 is unknown
  char form[LINEUP_FORM_MAX + 1] = {0};   // 'W'/'L', oldest first
};

// Whether a row has a rate to draw. Both halves are load-bearing. The app omits
// "p" for a player with no thrown bags behind their record — a result imported
// from a game played before the app existed — and that parses to -1. A lineup
// *retained* from before that change sends 0 instead, and there a 0-0 record is
// the only thing separating a newcomer from a genuine 0.0 average.
inline bool hasRate(const LineupRow& r) { return r.ppr >= 0 && r.wins + r.losses > 0; }

struct LineupState {
  int count = 0;  // 0 means nothing to draw
  LineupRow rows[LINEUP_MAX];
};

// -------------------------------------------------------------- tournament tie --
//
// The tie arrives on holecorn/<code>/tie, retained, and is cleared at the first bag
// exactly as the lineup is. It carries only the cup's name and the round, because
// the two sides are already in the score message as joined labels and two copies of
// who is playing could disagree.
//
// It wins over the form screen rather than sitting beside it: in a knockout both
// sides arrive at a tie unbeaten, so a form line inside a tournament is all wins for
// everyone and says nothing. Which tie this is says something.
//
// The app caps a tournament's name at 32 UTF-16 code units, which is 96 bytes of
// UTF-8. Nothing is truncated on the wire — this topic has its own packet — so the
// buffer is sized for the name rather than for what a panel line can draw.
static const size_t TIE_CUP_MAX = 97;
static const size_t TIE_ROUND_MAX = 33;

struct TieState {
  bool set = false;
  char cup[TIE_CUP_MAX] = {0};
  char round[TIE_ROUND_MAX] = {0};
};

// ------------------------------------------------------------ tournament draw --
//
// One pull of the draw, arriving on holecorn/<code>/draw, retained and cleared exactly
// as the lineup and the tie are. A press publishes two of these a beat apart: the first
// withholds the name, so the board shows a drum roll, and the second reveals it. The
// board animates nothing and knows nothing of the beat — it draws whichever card it was
// last told about, which is what keeps phase off the wire.
//
// **The one screen that needs no score message behind it.** A draw is taken before there
// is a game at all, often on a board that has never been sent one, so everything the card
// says is in this struct: no names off teamA/teamB, and no team colours, because at the
// moment a name comes out of the hat nobody has been given one.
//
// **No card carries both a cup name and a pull**, and that is the byte budget rather
// than a preference: measured in test_board_logic.cpp, a round plus a doubles side plus a
// doubles "winner of" pair with a 32-unit cup name on top lands 25 bytes under
// MQTT_BUFFER — tighter than the lineup, the largest message the board otherwise
// receives. The name rides on the opening card alone, where there is no pull to carry,
// so the topic's worst case is unmoved by it.
static const size_t DRAW_ROUND_MAX = 33;
// The same 32 UTF-16 code units the tie card's cup name is capped at.
static const size_t DRAW_CUP_MAX = 97;
// A whole doubles side: two 16-unit names at up to 3 bytes each, joined with " & ".
// Sized to the label rather than to the 21 characters a panel row draws, for the reason
// TEAM_LABEL_MAX is — shortening cuts *both* names of a pair, which needs the whole
// thing, and truncating here would eat the second name first.
static const size_t DRAW_SIDE_MAX = 100;
// Nobody yet, a person, or the two halves of a preliminary whose winner they meet.
static const int DRAW_OPPONENTS_MAX = 2;

struct DrawState {
  bool set = false;
  bool named = false;  // false is the drum roll: the name is withheld, not empty
  // The opening card and nothing else: a cup with no round is "<CUP> DRAW", which is what
  // stands on the board between opening the ceremony and the first press.
  char cup[DRAW_CUP_MAX] = {0};
  char round[DRAW_ROUND_MAX] = {0};
  char name[DRAW_SIDE_MAX] = {0};
  int opponents = 0;
  char opponent[DRAW_OPPONENTS_MAX][DRAW_SIDE_MAX] = {};
};

struct BoardState {
  int a = 0;
  int b = 0;
  int round = 0;
  int target = 0;
  long long v = 0;
  char winner = 0;  // 'a', 'b', or 0 while the game is still live
  char first = 0;   // team due to throw first this round, or 0 if not published
  char teamA[TEAM_LABEL_MAX] = {0};
  char teamB[TEAM_LABEL_MAX] = {0};
  Rgb colorA;
  Rgb colorB;
};

// "#2f80ed" into a triple. Anything unparseable leaves the default white, so a
// missing or malformed colour shows a readable score rather than a black one.
inline void parseColor(const char* hex, Rgb& out) {
  if (!hex || hex[0] != '#') return;
  uint32_t v = 0;
  for (int i = 1; i <= 6; i++) {
    const char c = hex[i];
    int d;
    if (c >= '0' && c <= '9') d = c - '0';
    else if (c >= 'a' && c <= 'f') d = c - 'a' + 10;
    else if (c >= 'A' && c <= 'F') d = c - 'A' + 10;
    else return;
    v = (v << 4) | uint32_t(d);
  }
  out.r = uint8_t(v >> 16);
  out.g = uint8_t(v >> 8);
  out.b = uint8_t(v);
}

inline void copyInto(const char* src, char* dst, size_t cap) {
  if (!src) { dst[0] = '\0'; return; }
  size_t i = 0;
  for (; src[i] && i < cap - 1; i++) dst[i] = src[i];
  dst[i] = '\0';
}

inline void copyLabel(const char* src, char* dst) { copyInto(src, dst, TEAM_LABEL_MAX); }

// An empty payload is the publisher clearing the topic, and is the *only* way
// back to the score screen — so it succeeds with a count of 0 rather than being
// treated as malformed. Anything else unusable returns false and leaves `out`
// alone, so a stray message on a shared broker cannot wipe a good lineup.
//
// The row count must be exactly a singles or a doubles roster: render.h splits
// rows into teams by halving it, and a length it cannot halve would draw players
// in the wrong colours rather than failing.
inline bool parseLineup(const char* json, size_t length, LineupState& out) {
  if (!json) return false;
  if (length == 0) {
    out.count = 0;
    return true;
  }
  JsonDocument doc;
  if (deserializeJson(doc, json, length)) return false;
  JsonArrayConst rows = doc["rows"];
  if (rows.isNull()) return false;
  const int n = int(rows.size());
  if (n != 2 && n != LINEUP_MAX) return false;

  LineupState next;
  next.count = n;
  for (int i = 0; i < n; i++) {
    JsonObjectConst row = rows[i];
    LineupRow& r = next.rows[i];
    const char* name = row["n"].as<const char*>();
    if (name) {
      size_t j = 0;
      for (; name[j] && j < LINEUP_NAME_MAX - 1; j++) r.name[j] = name[j];
      r.name[j] = '\0';
    }
    r.wins = clampInt(row["w"] | 0, 0, 999);
    r.losses = clampInt(row["l"] | 0, 0, 999);
    // 999 tenths, so the widest it can draw is "99.9" — the four characters the
    // form layout reserves. A real PPR caps at 12.0 (four bags in the hole).
    r.ppr = clampInt(row["p"] | -1, -1, 999);
    const char* form = row["f"].as<const char*>();
    if (form) {
      int j = 0;
      // Anything that isn't a W counts as a loss, the same way an unrecognised
      // team letter reads as "nobody" elsewhere.
      for (; form[j] && j < LINEUP_FORM_MAX; j++) {
        r.form[j] = (form[j] == 'W' || form[j] == 'w') ? 'W' : 'L';
      }
      r.form[j] = '\0';
    }
  }
  out = next;
  return true;
}

// An empty payload clears the tie, exactly as it clears the lineup, and is the
// only way back to the score once a fixture card is up — so it succeeds with
// `set` false rather than being treated as malformed.
//
// The round is what makes a tie a tie, so a message without one is refused and
// leaves `out` alone; the cup's name is optional and simply comes out empty,
// which draws one fewer row rather than failing.
inline bool parseTie(const char* json, size_t length, TieState& out) {
  if (!json) return false;
  if (length == 0) {
    out.set = false;
    return true;
  }
  JsonDocument doc;
  if (deserializeJson(doc, json, length)) return false;
  const char* round = doc["r"].as<const char*>();
  if (!round || round[0] == '\0') return false;

  TieState next;
  next.set = true;
  copyInto(round, next.round, TIE_ROUND_MAX);
  copyInto(doc["t"].as<const char*>(), next.cup, TIE_CUP_MAX);
  out = next;
  return true;
}

// An empty payload clears the card, exactly as it clears the tie — and the clear matters
// more here than anywhere else, because nothing about starting a game takes this topic
// down. A draw is not part of a game, so a card left retained would sit on the board
// through every match until the next draw a year later.
//
// A card is a round or a cup, so a message with neither is refused and leaves `out`
// alone. Everything else is optional and means something by its absence: no "n" is the
// beat before the name lands, and no "o" is an entrant with nobody to meet yet.
//
// A cup with no round is the opening card, which is the one shape that says what is about
// to happen rather than what just did.
//
// The count the app sends as "d" and "e" is deliberately not read. The panel draws no
// progress line — the completing card needs all four of its rows — so parsing it would
// put two fields in this struct that nothing on the board can show. The display reads
// them off the payload instead.
inline bool parseDraw(const char* json, size_t length, DrawState& out) {
  if (!json) return false;
  if (length == 0) {
    out.set = false;
    return true;
  }
  JsonDocument doc;
  if (deserializeJson(doc, json, length)) return false;
  const char* round = doc["r"].as<const char*>();
  const char* cup = doc["t"].as<const char*>();
  const bool haveRound = round && round[0] != '\0';
  const bool haveCup = cup && cup[0] != '\0';
  if (!haveRound && !haveCup) return false;

  DrawState next;
  next.set = true;
  if (haveRound) copyInto(round, next.round, DRAW_ROUND_MAX);
  if (haveCup) copyInto(cup, next.cup, DRAW_CUP_MAX);

  const char* name = doc["n"].as<const char*>();
  next.named = name && name[0] != '\0';
  if (next.named) copyInto(name, next.name, DRAW_SIDE_MAX);

  JsonArrayConst opponents = doc["o"];
  if (!opponents.isNull()) {
    for (JsonVariantConst side : opponents) {
      if (next.opponents >= DRAW_OPPONENTS_MAX) break;
      const char* label = side.as<const char*>();
      if (!label || label[0] == '\0') continue;
      copyInto(label, next.opponent[next.opponents++], DRAW_SIDE_MAX);
    }
  }
  out = next;
  return true;
}

// Blank-padded rather than zero-padded, matching the browser display, and
// clamped because the board physically cannot show three digits.
inline void formatDigits(int a, int b, char out[5]) {
  auto pair = [](int value, char* dst) {
    if (value < 0) value = 0;
    if (value > 99) value = 99;
    dst[0] = value >= 10 ? char('0' + value / 10) : ' ';
    dst[1] = char('0' + value % 10);
  };
  pair(a, out);
  pair(b, out + 2);
  out[4] = '\0';
}

// Returns false — leaving `out` untouched — for anything that isn't a usable
// state message, so a malformed or stale publish never blanks a good score.
// `v` is the publisher's millisecond stamp, so it must be held in 64 bits; a
// 32-bit counter would have overflowed in 1970.
inline bool parseBoardState(const char* json, size_t length, long long lastV,
                            BoardState& out) {
  JsonDocument doc;
  if (deserializeJson(doc, json, length)) return false;
  if (doc["a"].isNull() || doc["b"].isNull()) return false;

  const long long v = doc["v"].isNull() ? 0 : doc["v"].as<long long>();
  // Only a plausible reorder is rejected. A retained redelivery or a QoS 1
  // retry arrives seconds late; a stamp far older than the last means a
  // different phone or a corrected clock, and refusing those would let one
  // publish from a fast clock freeze the board until wall-clock caught up.
  if (v != 0 && v < lastV && lastV - v < REORDER_WINDOW_MS) return false;

  out.a = doc["a"].as<int>();
  out.b = doc["b"].as<int>();
  out.round = doc["round"] | 0;
  out.target = doc["target"] | 0;
  out.v = v;

  const char* winner = doc["winner"].as<const char*>();
  out.winner = (winner && (winner[0] == 'a' || winner[0] == 'b')) ? winner[0] : 0;

  const char* first = doc["first"].as<const char*>();
  out.first = (first && (first[0] == 'a' || first[0] == 'b')) ? first[0] : 0;

  copyLabel(doc["teamA"].as<const char*>(), out.teamA);
  copyLabel(doc["teamB"].as<const char*>(), out.teamB);
  parseColor(doc["colorA"].as<const char*>(), out.colorA);
  parseColor(doc["colorB"].as<const char*>(), out.colorB);
  return true;
}
