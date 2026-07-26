// Kept free of Arduino dependencies so it compiles and runs on a host — that is
// how MQTT_BUFFER was sized rather than guessed. See firmware/wokwi/README.md.
#pragma once

#include <ArduinoJson.h>
#include <stddef.h>

// Mirrors REORDER_WINDOW in src/useScoreboard.js.
static const long long REORDER_WINDOW_MS = 60000;

struct Rgb {
  uint8_t r = 255, g = 255, b = 255;
};

// Holds a full doubles label. The app caps each name at 16 UTF-16 units and
// joins two with " & ", so 35 characters is the worst case and this has room
// for it. Don't shrink it to "what the panel can display": render.h abbreviates
// a label that won't fit by shortening *both* names, which needs the whole
// thing. Truncating here would silently eat the second player's name first.
static const size_t TEAM_LABEL_MAX = 40;

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

inline void copyLabel(const char* src, char* dst) {
  if (!src) { dst[0] = '\0'; return; }
  size_t i = 0;
  for (; src[i] && i < TEAM_LABEL_MAX - 1; i++) dst[i] = src[i];
  dst[i] = '\0';
}

// Two scores into the four characters SevSeg expects. Blank-padded rather than
// zero-padded, matching the browser display, and clamped because the board
// physically cannot show three digits.
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
