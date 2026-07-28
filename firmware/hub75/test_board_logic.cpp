// Host test for board_logic.h. Compiled with clang++ against the
// real ArduinoJson, using payloads captured from the app's publisher.
#include "board_logic.h"

#include <cstdio>
#include <cstring>
#include <string>

static int failures = 0;

#define CHECK(cond)                                                     \
  do {                                                                  \
    if (!(cond)) {                                                      \
      printf("  FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond);          \
      failures++;                                                       \
    }                                                                   \
  } while (0)

static bool parse(const std::string& json, long long lastV, BoardState& out) {
  return parseBoardState(json.c_str(), json.size(), lastV, out);
}

// Exactly what scoreboardPayload() + the link's v stamp produce. Note the
// absent winner: the app omits the key while the game is live rather than
// sending null, so "missing means nobody has won" is a contract, not a
// tolerance.
static const char* REAL =
    "{\"a\":17,\"b\":8,\"round\":6,\"target\":21,\"first\":\"b\","
    "\"teamA\":\"Neil & Psi\",\"teamB\":\"Iota & Zeta\","
    "\"colorA\":\"#2f80ed\",\"colorB\":\"#eb5757\",\"v\":1784926355272}";

static const char* WON =
    "{\"a\":21,\"b\":8,\"round\":7,\"target\":21,\"first\":\"a\","
    "\"teamA\":\"Neil & Psi\",\"teamB\":\"Iota & Zeta\","
    "\"colorA\":\"#2f80ed\",\"colorB\":\"#eb5757\","
    "\"winner\":\"a\",\"v\":1784926355300}";

// What a retained message published before the key was dropped looks like. A
// board can still be handed one of these by the broker.
static const char* LEGACY_NULL_WINNER =
    "{\"a\":17,\"b\":8,\"round\":6,\"target\":21,\"teamA\":\"Neil & Psi\","
    "\"teamB\":\"Iota & Zeta\",\"colorA\":\"#2f80ed\",\"colorB\":\"#eb5757\","
    "\"winner\":null,\"v\":1784926355272}";

int main() {
  printf("parseBoardState\n");
  {
    BoardState s;
    CHECK(parse(REAL, 0, s));
    CHECK(s.a == 17);
    CHECK(s.b == 8);
    CHECK(s.round == 6);
    CHECK(s.target == 21);
    CHECK(s.winner == 0);
    CHECK(s.first == 'b');
    CHECK(strcmp(s.teamA, "Neil & Psi") == 0);
    CHECK(s.colorA.r == 0x2f && s.colorA.g == 0x80 && s.colorA.b == 0xed);
    // The millisecond stamp must survive intact; 32 bits would have wrapped.
    CHECK(s.v == 1784926355272LL);
  }
  {
    BoardState s;
    CHECK(parse(WON, 0, s));
    CHECK(s.winner == 'a');
    CHECK(s.first == 'a');
    CHECK(s.a == 21);
  }
  {
    // An explicit null must read the same as the key being absent, or a
    // retained message from an older publisher would look like a win.
    BoardState s;
    CHECK(parse(LEGACY_NULL_WINNER, 0, s));
    CHECK(s.winner == 0);
    CHECK(s.first == 0);
  }
  {
    // A stale redelivery must be refused so it can't undo a newer score.
    BoardState s;
    CHECK(!parse(REAL, 1784926355300LL, s));
    CHECK(s.a == 0);  // left untouched
  }
  {
    BoardState s;
    CHECK(parse(REAL, 1784926355272LL, s));  // equal stamp still accepted
  }
  {
    BoardState s;
    CHECK(!parse("{\"a\":1}", 0, s));                 // missing b
    CHECK(!parse("not json at all", 0, s));
    CHECK(!parse("", 0, s));
    CHECK(!parse("{\"b\":2,\"round\":1}", 0, s));     // missing a
  }
  {
    // No v stamp: accept, but don't let it clobber the high-water mark.
    BoardState s;
    CHECK(parse("{\"a\":3,\"b\":4}", 999LL, s));
    CHECK(s.v == 0);
    CHECK(s.a == 3 && s.b == 4);
  }
  {
    // Payload is not null-terminated over the wire; length must be respected.
    std::string json(REAL);
    std::string padded = json + "GARBAGE AFTER THE END";
    BoardState s;
    CHECK(parseBoardState(padded.c_str(), json.size(), 0, s));
    CHECK(s.a == 17 && s.b == 8);
  }
  {
    // Sizing MQTT_BUFFER. The app caps each player name at 16 UTF-16 code
    // units, which is 16 bytes of ASCII but 48 bytes of 3-byte BMP characters,
    // so the worst case is far bigger than it first looks. PubSubClient's limit
    // covers the whole packet, so add the topic and headers on top.
    auto payloadFor = [](const std::string& nameA, const std::string& nameB) {
      return "{\"a\":21,\"b\":19,\"round\":14,\"target\":21,\"first\":\"b\",\"teamA\":\"" +
             nameA + " & " + nameA + "\",\"teamB\":\"" + nameB + " & " + nameB +
             "\",\"colorA\":\"#2f80ed\",\"colorB\":\"#eb5757\","
             "\"winner\":\"a\",\"v\":1784926355272}";
    };
    // holecorn/ + 16-char code + /state, its 2 length bytes, a QoS 1 packet id
    // and the fixed header.
    const size_t overhead = 31 + 2 + 2 + 5;

    std::string ascii = payloadFor("Aaaaaaaaaaaaaaaa", "Bbbbbbbbbbbbbbbb");
    std::string wide;
    {
      std::string euros;
      for (int i = 0; i < 16; i++) euros += "€";  // 1 UTF-16 unit, 3 bytes
      CHECK(euros.size() == 48);
      wide = payloadFor(euros, euros);
    }

    BoardState s;
    CHECK(parse(ascii, 0, s));
    CHECK(s.a == 21 && s.b == 19 && s.winner == 'a');
    CHECK(parse(wide, 0, s));
    CHECK(s.a == 21 && s.b == 19);

    printf("  worst ASCII payload: %zu bytes, packet ~%zu (limit 256)\n",
           ascii.size(), ascii.size() + overhead);
    printf("  worst UTF-8 payload: %zu bytes, packet ~%zu\n", wide.size(),
           wide.size() + overhead);

    // ASCII fits under the default, but with little enough headroom that one
    // added field would not...
    CHECK(ascii.size() + overhead < 256);
    CHECK(256 - (ascii.size() + overhead) < 32);
    // ...and any non-ASCII name blows straight through it, which is why the
    // sketch raises the buffer. 512 covers the worst case.
    CHECK(wide.size() + overhead > 256);
    CHECK(wide.size() + overhead < 512);
  }

  printf("formatDigits\n");
  {
    char buf[5];
    formatDigits(17, 8, buf);
    CHECK(strcmp(buf, "17 8") == 0);
    formatDigits(0, 0, buf);
    CHECK(strcmp(buf, " 0 0") == 0);
    formatDigits(21, 19, buf);
    CHECK(strcmp(buf, "2119") == 0);
    formatDigits(5, 12, buf);
    CHECK(strcmp(buf, " 512") == 0);
    formatDigits(100, -3, buf);   // clamped both ways
    CHECK(strcmp(buf, "99 0") == 0);
  }

  printf("parseLayout\n");
  {
    PanelLayout got = PANEL_FULL;
    CHECK(parseLayout("score", 5, got) && got == PANEL_SCORE);
    CHECK(parseLayout("full", 4, got) && got == PANEL_FULL);

    // An id from a newer app must leave the board on whatever it was drawing.
    // Falling back to PANEL_FULL instead would silently override a choice.
    got = PANEL_SCORE;
    CHECK(!parseLayout("ticker", 6, got) && got == PANEL_SCORE);
    CHECK(!parseLayout("", 0, got) && got == PANEL_SCORE);
    CHECK(!parseLayout(nullptr, 4, got) && got == PANEL_SCORE);

    // MQTT payloads are not NUL-terminated, so neither a prefix nor a longer
    // string may match, and only `length` bytes may be read.
    CHECK(!parseLayout("score", 4, got));
    CHECK(!parseLayout("scoreboard", 10, got));
    CHECK(parseLayout("scoreXX", 5, got) && got == PANEL_SCORE);

    // Every id the app can publish has to parse back to its own enum, or the
    // two lists have drifted.
    for (int i = 0; i < PANEL_LAYOUT_COUNT; i++) {
      PanelLayout round = PANEL_FULL;
      CHECK(parseLayout(PANEL_LAYOUT_IDS[i], strlen(PANEL_LAYOUT_IDS[i]), round) &&
            round == PanelLayout(i));
    }
  }

  printf(failures ? "\n%d CHECK(s) FAILED\n" : "\nall checks passed\n", failures);
  return failures ? 1 : 0;
}
