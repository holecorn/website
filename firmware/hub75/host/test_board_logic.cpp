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

  // Held past its block so parseDraw can check it is still the largest message the board
  // receives — which is what says MQTT_BUFFER needs no change for a fourth topic.
  size_t worstLineupPacket = 0;

  printf("parseLineup\n");
  {
    // Exactly what lineupPayload() produces for a doubles roster.
    const char* REAL_LINEUP =
        "{\"rows\":["
        "{\"n\":\"Neil\",\"w\":6,\"l\":4,\"p\":72,\"f\":\"LWLWW\"},"
        "{\"n\":\"Rho\",\"w\":2,\"l\":2,\"p\":73,\"f\":\"WLLW\"},"
        "{\"n\":\"Sigma\",\"w\":4,\"l\":6,\"p\":60,\"f\":\"WLWLL\"},"
        "{\"n\":\"Tau\",\"w\":2,\"l\":2,\"p\":73,\"f\":\"LWWL\"}]}";

    LineupState l;
    CHECK(parseLineup(REAL_LINEUP, strlen(REAL_LINEUP), l));
    CHECK(l.count == 4);
    CHECK(strcmp(l.rows[0].name, "Neil") == 0);
    CHECK(l.rows[0].wins == 6 && l.rows[0].losses == 4 && l.rows[0].ppr == 72);
    CHECK(strcmp(l.rows[0].form, "LWLWW") == 0);
    CHECK(strcmp(l.rows[3].name, "Tau") == 0);

    // An empty payload is the publisher clearing the topic when the first bag is
    // thrown, and it is the only route back to the score screen — so it has to
    // succeed rather than be refused as malformed.
    CHECK(parseLineup("", 0, l));
    CHECK(l.count == 0);

    // Anything unusable leaves the lineup alone, so a stray message on a shared
    // broker cannot wipe a good one.
    CHECK(parseLineup(REAL_LINEUP, strlen(REAL_LINEUP), l) && l.count == 4);
    CHECK(!parseLineup("{", 1, l) && l.count == 4);
    CHECK(!parseLineup("{\"rows\":\"nope\"}", 15, l) && l.count == 4);
    CHECK(!parseLineup(nullptr, 4, l) && l.count == 4);
    // A count render.h cannot halve into two teams is refused rather than drawn
    // with somebody in the wrong colour.
    const char* THREE = "{\"rows\":[{\"n\":\"A\"},{\"n\":\"B\"},{\"n\":\"C\"}]}";
    CHECK(!parseLineup(THREE, strlen(THREE), l) && l.count == 4);
    const char* NONE = "{\"rows\":[]}";
    CHECK(!parseLineup(NONE, strlen(NONE), l) && l.count == 4);

    // Missing fields are zeroes, not garbage — except the rate, which is -1,
    // because 0.0 PPR is a real average and has to stay distinguishable from
    // having none.
    const char* SPARSE = "{\"rows\":[{\"n\":\"Psi\"},{\"n\":\"Eta\"}]}";
    CHECK(parseLineup(SPARSE, strlen(SPARSE), l));
    CHECK(l.count == 2 && l.rows[0].wins == 0 && l.rows[0].ppr == -1);
    CHECK(l.rows[0].form[0] == '\0');
    CHECK(!hasRate(l.rows[0]));

    // A record with no rate behind it: a match imported from a written-down
    // result, which has a winner and no rounds. The app omits "p" for it, and
    // the board must draw the record and no rate rather than "0.0".
    const char* IMPORTED =
        "{\"rows\":[{\"n\":\"Neil\",\"w\":6,\"l\":4,\"f\":\"LWLWW\"},"
        "{\"n\":\"Rho\",\"w\":2,\"l\":2,\"p\":73,\"f\":\"WLLW\"}]}";
    CHECK(parseLineup(IMPORTED, strlen(IMPORTED), l));
    CHECK(l.rows[0].wins == 6 && l.rows[0].ppr == -1 && !hasRate(l.rows[0]));
    CHECK(l.rows[1].ppr == 73 && hasRate(l.rows[1]));

    // A lineup retained from before the rate could be omitted sends 0 for a
    // newcomer, so a 0-0 record still has to read as "no rate" on its own — and
    // a real 0.0 average, which comes with a record, still has to draw.
    const char* LEGACY =
        "{\"rows\":[{\"n\":\"Psi\",\"w\":0,\"l\":0,\"p\":0,\"f\":\"\"},"
        "{\"n\":\"Eta\",\"w\":0,\"l\":5,\"p\":0,\"f\":\"LLLLL\"}]}";
    CHECK(parseLineup(LEGACY, strlen(LEGACY), l));
    CHECK(l.rows[0].ppr == 0 && !hasRate(l.rows[0]));
    CHECK(l.rows[1].ppr == 0 && hasRate(l.rows[1]));

    // Clamped to what formatRecord and formatTenths can write into their buffers.
    // Three digits a side, not two: at 99 the board silently drew "99" while the phone
    // showed the real figure, and about 100 matches in either column gets there.
    const char* OVERSIZED =
        "{\"rows\":[{\"n\":\"A\",\"w\":5000,\"l\":-3,\"p\":99999,\"f\":\"WWWWWWWWWW\"},"
        "{\"n\":\"B\",\"w\":0,\"l\":0,\"p\":0,\"f\":\"\"}]}";
    CHECK(parseLineup(OVERSIZED, strlen(OVERSIZED), l));
    CHECK(l.rows[0].wins == 999 && l.rows[0].losses == 0 && l.rows[0].ppr == 999);
    CHECK(strlen(l.rows[0].form) == LINEUP_FORM_MAX);

    // A three-digit record has to survive the trip intact, since that is the whole
    // reason the clamp moved.
    const char* BIG = "{\"rows\":[{\"n\":\"A\",\"w\":120,\"l\":87,\"p\":120,\"f\":\"W\"},{\"n\":\"B\"}]}";
    CHECK(parseLineup(BIG, strlen(BIG), l));
    CHECK(l.rows[0].wins == 120 && l.rows[0].losses == 87);

    // Anything that isn't a W is a loss, the same way an unrecognised team letter
    // reads as nobody elsewhere.
    const char* ODD = "{\"rows\":[{\"n\":\"A\",\"f\":\"WwXL?\"},{\"n\":\"B\"}]}";
    CHECK(parseLineup(ODD, strlen(ODD), l));
    CHECK(strcmp(l.rows[0].form, "WWLLL") == 0);

    // A name too long for its buffer truncates rather than overrunning, the same
    // as copyLabel — and 16 UTF-16 units of 3-byte characters is 48 bytes, which
    // is what the buffer is sized for.
    std::string euro;
    for (int i = 0; i < 16; i++) euro += "€";
    const std::string wideName =
        "{\"rows\":[{\"n\":\"" + euro + "\",\"w\":1,\"l\":1,\"p\":50,\"f\":\"W\"},"
        "{\"n\":\"B\"}]}";
    CHECK(parseLineup(wideName.c_str(), wideName.size(), l));
    CHECK(strlen(l.rows[0].name) == 48);

    // Sizing MQTT_BUFFER for the second topic. The buffer is shared across
    // subscriptions, so the largest single packet is what has to fit — and four
    // non-ASCII names is a bigger message than the score has ever been.
    const size_t overhead = 9 + 16 + 7 + 2 + 2 + 5;  // holecorn/<code>/lineup + headers
    const auto lineupFor = [](const std::string& name) {
      std::string rows;
      for (int i = 0; i < 4; i++) {
        if (i) rows += ",";
        rows += "{\"n\":\"" + name + "\",\"w\":999,\"l\":999,\"p\":999,\"f\":\"WWWWW\"}";
      }
      return "{\"rows\":[" + rows + "]}";
    };
    const std::string asciiL = lineupFor("Aaaaaaaaaaaaaaaa");
    const std::string wideL = lineupFor(euro);
    printf("  worst ASCII lineup: %zu bytes, packet ~%zu\n", asciiL.size(),
           asciiL.size() + overhead);
    printf("  worst UTF-8 lineup: %zu bytes, packet ~%zu\n", wideL.size(),
           wideL.size() + overhead);
    CHECK(parseLineup(asciiL.c_str(), asciiL.size(), l) && l.count == 4);
    CHECK(parseLineup(wideL.c_str(), wideL.size(), l) && l.count == 4);
    // Fits the buffer the sketch already sets, so adding this topic needs no
    // change there — but it is the largest message the board receives, so it is
    // this one and not the score that now bounds MQTT_BUFFER.
    CHECK(wideL.size() + overhead < 512);
    worstLineupPacket = wideL.size() + overhead;
  }

  printf("parseTie\n");
  {
    TieState t;
    CHECK(parseTie("{\"t\":\"Hole Corn V\",\"r\":\"Semi-final\"}", 36, t));
    CHECK(t.set && !strcmp(t.cup, "Hole Corn V") && !strcmp(t.round, "Semi-final"));

    // The clear, which is the only way back to the score once a card is up — so
    // it succeeds rather than being treated as a malformed message.
    CHECK(parseTie("", 0, t));
    CHECK(!t.set);

    // The round is what makes a tie a tie. Without one there is nothing to draw,
    // so this leaves whatever is on screen rather than blanking it — the rule
    // parseLineup and parseLayout both follow.
    TieState keep;
    keep.set = true;
    copyInto("Hole Corn V", keep.cup, TIE_CUP_MAX);
    copyInto("Final", keep.round, TIE_ROUND_MAX);
    CHECK(!parseTie("{\"t\":\"Hole Corn V\"}", 19, keep));
    CHECK(!parseTie("{not json", 9, keep));
    CHECK(keep.set && !strcmp(keep.round, "Final"));

    // A cup with no name still draws: the heading loses a row rather than the
    // card failing, which is what a hand-edited draw would otherwise cost.
    CHECK(parseTie("{\"r\":\"Final\"}", 13, t));
    CHECK(t.set && t.cup[0] == '\0' && !strcmp(t.round, "Final"));

    // Sizing the buffer. The app caps a tournament name at 32 UTF-16 code units,
    // which is 96 bytes of UTF-8, and nothing is cut on the wire because this
    // topic has a packet to itself. Far below the score's, so MQTT_BUFFER is
    // still bounded by the lineup.
    std::string euro;
    for (int i = 0; i < 32; i++) euro += "€";
    const std::string wideTie = "{\"t\":\"" + euro + "\",\"r\":\"Quarter-final\"}";
    CHECK(parseTie(wideTie.c_str(), wideTie.size(), t));
    CHECK(strlen(t.cup) == 96);
    const size_t tieOverhead = 9 + 16 + 4 + 2 + 2 + 5;  // holecorn/<code>/tie + headers
    printf("  worst UTF-8 tie: %zu bytes, packet ~%zu\n", wideTie.size(),
           wideTie.size() + tieOverhead);
    CHECK(wideTie.size() + tieOverhead < 512);
  }

  printf("parseDraw\n");
  {
    DrawState d;
    CHECK(parseDraw("{\"r\":\"Preliminary\",\"n\":\"Tau\",\"o\":[\"Rho\"],\"d\":2,\"e\":11}", 54, d));
    CHECK(d.set && d.named);
    CHECK(!strcmp(d.round, "Preliminary") && !strcmp(d.name, "Tau"));
    CHECK(d.opponents == 1 && !strcmp(d.opponent[0], "Rho"));

    // No "n" is the beat before the name lands, and it has to be told from a name that
    // happens to be empty: the board draws a drum roll for one and would draw a nameless
    // reveal for the other. Absent-means-unknown, the contract `winner` already uses.
    CHECK(parseDraw("{\"r\":\"Preliminary\",\"d\":1,\"e\":11}", 32, d));
    CHECK(d.set && !d.named && d.opponents == 0);

    // An entrant with nobody to meet yet — a bye whose sibling seat is still in the hat.
    CHECK(parseDraw("{\"r\":\"Quarter-final\",\"n\":\"Chi\"}", 31, d));
    CHECK(d.set && d.named && d.opponents == 0);

    // Two, which the card words as "plays winner of". Sent as sides rather than as that
    // phrase because the words cost nothing on the board and bytes on every message.
    CHECK(parseDraw("{\"r\":\"Final\",\"n\":\"Kappa\",\"o\":[\"Omega\",\"Iota\"]}", 46, d));
    CHECK(d.opponents == 2 && !strcmp(d.opponent[1], "Iota"));

    // More than a bracket can produce, so it comes off a shared broker or a hand-edited
    // publish. Taken as far as the card holds rather than refused, since the two that fit
    // are still worth drawing.
    CHECK(parseDraw("{\"r\":\"Final\",\"n\":\"A\",\"o\":[\"B\",\"C\",\"D\"]}", 40, d));
    CHECK(d.opponents == DRAW_OPPONENTS_MAX);

    // Empty clears the card, and it is the only way off it: nothing about starting a game
    // takes this topic down the way the first bag clears the lineup and the tie.
    CHECK(parseDraw("", 0, d));
    CHECK(!d.set);

    // A cup and no round is the opening card, which stands on the board from the moment
    // the ceremony is opened until the first press. No name, so nothing here mistakes it
    // for a pull.
    CHECK(parseDraw("{\"t\":\"Hole Corn VI\",\"d\":0,\"e\":11}", 33, d));
    CHECK(d.set && !d.named && d.opponents == 0);
    CHECK(!strcmp(d.cup, "Hole Corn VI") && d.round[0] == '\0');

    // A card is a round or a cup, so a message with neither leaves whatever is up rather
    // than blanking it — parseTie's rule.
    DrawState keep;
    keep.set = true;
    copyInto("Semi-final", keep.round, DRAW_ROUND_MAX);
    CHECK(!parseDraw("{\"n\":\"Tau\"}", 11, keep));
    CHECK(!parseDraw("{not json", 9, keep));
    CHECK(keep.set && !strcmp(keep.round, "Semi-final"));

    // Sizing the buffer, which is the measurement the whole shape of this payload rests
    // on. Worst case is a doubles field: the side just pulled, plus the two doubles sides
    // of a preliminary they meet the winner of, at the app's 16 UTF-16 units a name and 3
    // UTF-8 bytes a unit. A cup name on top of this lands within 25 bytes of MQTT_BUFFER,
    // which is why a card carrying a pull carries no cup and the tie topic keeps it.
    std::string euro;
    for (int i = 0; i < 16; i++) euro += "€";
    const std::string pair = euro + " & " + euro;
    const std::string wideDraw = "{\"r\":\"Quarter-final\",\"n\":\"" + pair + "\",\"o\":[\"" + pair +
                                 "\",\"" + pair + "\"],\"d\":9,\"e\":11}";
    CHECK(parseDraw(wideDraw.c_str(), wideDraw.size(), d));
    CHECK(strlen(d.name) == 99 && strlen(d.opponent[1]) == 99);
    const size_t drawOverhead = 9 + 16 + 5 + 2 + 2 + 5;  // holecorn/<code>/draw + headers
    printf("  worst UTF-8 draw: %zu bytes, packet ~%zu\n", wideDraw.size(),
           wideDraw.size() + drawOverhead);
    CHECK(wideDraw.size() + drawOverhead < 512);
    // Still bounded by the lineup, so MQTT_BUFFER needs no change. That is the property
    // the structured opponent bought, and it is the one to re-check before adding a field.
    CHECK(wideDraw.size() + drawOverhead < worstLineupPacket);

    // The opening card is where the cup name went, and this is what says it was free: it
    // carries no pull, so it cannot be the topic's worst case however long the name. 32
    // UTF-16 units at 3 bytes each is the app's cap, the same one the tie card measures.
    std::string cup;
    for (int i = 0; i < 32; i++) cup += "€";
    const std::string wideTitle = "{\"t\":\"" + cup + "\",\"d\":0,\"e\":99}";
    CHECK(parseDraw(wideTitle.c_str(), wideTitle.size(), d));
    CHECK(strlen(d.cup) == 96 && !d.named);
    printf("  worst UTF-8 opening card: %zu bytes, packet ~%zu\n", wideTitle.size(),
           wideTitle.size() + drawOverhead);
    CHECK(wideTitle.size() < wideDraw.size());
  }

  printf("stepBrightness\n");
  {
    CHECK(stepBrightness(0, 1) == 1);
    CHECK(stepBrightness(1, -1) == 0);

    // Clamped, not wrapped. One press taking the darkest step to 255 is the bug
    // this shape exists to prevent, and in the dark it is a face full of LEDs.
    CHECK(stepBrightness(0, -1) == 0);
    CHECK(stepBrightness(BRIGHTNESS_LEVEL_COUNT - 1, 1) == BRIGHTNESS_LEVEL_COUNT - 1);

    // Ascending, so every press changes something, and the floor stays at the 40
    // that COVERAGE_FLOOR and the single-pixel loss pip were judged against —
    // nothing on this panel has been looked at darker than that. The top is what
    // the power budget allows: 1.33 A worst case against the port's 3 A.
    for (int i = 1; i < BRIGHTNESS_LEVEL_COUNT; i++)
      CHECK(BRIGHTNESS_LEVELS[i] > BRIGHTNESS_LEVELS[i - 1]);
    CHECK(BRIGHTNESS_LEVELS[0] == 40);
    CHECK(BRIGHTNESS_LEVELS[BRIGHTNESS_LEVEL_COUNT - 1] == 255);
    printf("  %d levels, %d to %d\n", BRIGHTNESS_LEVEL_COUNT, BRIGHTNESS_LEVELS[0],
           BRIGHTNESS_LEVELS[BRIGHTNESS_LEVEL_COUNT - 1]);
  }

  printf(failures ? "\n%d CHECK(s) FAILED\n" : "\nall checks passed\n", failures);
  return failures ? 1 : 0;
}
