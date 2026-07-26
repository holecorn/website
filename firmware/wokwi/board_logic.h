// Kept free of Arduino dependencies so it compiles and runs on a host — that is
// how MQTT_BUFFER was sized rather than guessed. See firmware/wokwi/README.md.
#pragma once

#include <ArduinoJson.h>
#include <stddef.h>

// Mirrors REORDER_WINDOW in src/useScoreboard.js.
static const long long REORDER_WINDOW_MS = 60000;

struct BoardState {
  int a = 0;
  int b = 0;
  int round = 0;
  int target = 0;
  long long v = 0;
  char winner = 0;  // 'a', 'b', or 0 while the game is still live
};

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
  return true;
}
