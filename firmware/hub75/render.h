// Arduino-free on purpose, like board_logic.h, so test_render.cpp can compile
// it on the host — there is no HUB75 simulator. Keep it that way.
//
// A Canvas is anything with:  void px(int x, int y, uint8_t r, uint8_t g, uint8_t b)
#pragma once

#include "board_logic.h"
#include "glyphs.h"
#include "logo.h"

static const int PANEL_W = 128;
static const int PANEL_H = 32;

static const int DIGIT_GAP = 2;

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
static const Rgb WHITE_COLOR = {0xff, 0xff, 0xff};

inline Rgb scaled(Rgb c, uint8_t level) {
  return Rgb{uint8_t(c.r * level / 255), uint8_t(c.g * level / 255),
             uint8_t(c.b * level / 255)};
}

// Picks a digit size out of glyphs.h. Both tables are uint32_t rows of
// GLYPH_MAX_H, so one pointer type covers either.
struct DigitFont {
  const uint32_t (*seg)[GLYPH_MAX_H];
  int w;
  int h;
};
static const DigitFont DIGITS_SMALL = {GLYPH_SEGMENT_SMALL, GLYPH_SMALL_W, GLYPH_SMALL_H};
static const DigitFont DIGITS_BIG = {GLYPH_SEGMENT_BIG, GLYPH_BIG_W, GLYPH_BIG_H};

inline int pairWidth(const DigitFont& f) { return f.w * 2 + DIGIT_GAP; }

// ----------------------------------------------------- full layout geometry --
//
// Rows 30-31 stay dark: with a name row above them the digits are width-limited,
// so the spare height buys nothing here. PANEL_SCORE is the layout that spends
// it, by giving up the names.
static const int NAME_Y = 0;
static const int DIGIT_Y = 10;
static const int PAIR_W = GLYPH_SMALL_W * 2 + DIGIT_GAP;

// Reserving a column for the "V" is what costs a name its tenth character. A
// narrower mark that would not was tried: three columns reads as a colon.
static const int VERSUS_PAD = 3;
static const int NAME_REGION_W = (PANEL_W - FONT_W - 2 * VERSUS_PAD) / 2;
static const int NAME_CHARS = NAME_REGION_W / FONT_ADVANCE;

// Centred in their halves would be 20, but that leaves "TO 21" only 5px of
// clearance. 16 buys 9px, for 4px of misalignment under the names — 20mm on a
// 640mm board.
static const int SIDE_MARGIN = 16;
static const int LEFT_X = SIDE_MARGIN;
static const int RIGHT_X = PANEL_W - SIDE_MARGIN - PAIR_W;

static const int ROUND_Y = DIGIT_Y + 2;
static const int TARGET_Y = DIGIT_Y + 11;
static const int UNDERLINE_Y = FONT_H + 1;

// Which mark a side gets. RULE_NEXT is the player throwing after the first one from
// the same end, which only doubles has — in singles there is nobody at that end to
// tell from the thrower, so the second mark would only say the two of them are
// playing. Read off the label having a join, the same test winVerb makes on the app
// side, because the payload deliberately carries no mode.
static const int RULE_NONE = 0;
static const int RULE_FIRST = 1;
static const int RULE_NEXT = 2;

// A cornhole bag, filled for the player throwing first and an outline for the other.
// Only the form screen has a row to spare for one: the full layout would have to put
// it beside the partner who is up, which in doubles is *inside* the label after the
// slash and costs a name character on top ("SIGMA/TAU" came back as "SIGMA/TA"), and
// the score layout has rows 30-31 free where an outline needs three. Both of those
// rule instead. A dim bag is out for the reason a loss pip is a single pixel — an
// unlit-but-not-off LED reads as off — so the two differ in fill, not brightness.
static const int BAG = 5;
static const int BAG_ADVANCE = BAG + 1;

// ---------------------------------------------------- score layout geometry --
//
// No names, so the digits take all 32 rows bar the rule: 30px is 150mm at P5
// against the full layout's 100mm, which is the trade this layout exists to
// offer. Width is not the constraint — two 36px pairs and a 44px middle column
// leave the round and target line where they already were.
static const int SCORE_DIGIT_Y = 0;
static const int SCORE_PAIR_W = GLYPH_BIG_W * 2 + DIGIT_GAP;
static const int SCORE_MARGIN = 6;
static const int SCORE_LEFT_X = SCORE_MARGIN;
static const int SCORE_RIGHT_X = PANEL_W - SCORE_MARGIN - SCORE_PAIR_W;
static const int SCORE_ROUND_Y = 6;
static const int SCORE_TARGET_Y = 17;
// Bottom row, with row 30 left as a gap. Without the names there is nothing to
// underline, so who throws next is ruled under their score instead — dropping it
// would make this a different comparison than names-versus-no-names.
static const int SCORE_RULE_Y = PANEL_H - 1;

// ------------------------------------------------------ form layout geometry --
//
// The pre-game screen, drawn while a lineup is retained on the lineup topic. Four
// rows of 5x7 text is the whole panel — a doubles roster leaves no room for a
// heading, which is why there isn't one. Numbers are right-aligned in their columns
// so the four rows line up whatever the values are.
//
// Read at ~4 m rather than the 7 m the score is sized for: 5x7 at P5 is 35 mm
// against the score's 100 mm. That is the trade this screen makes, and it is the
// right one for something you look at while standing around before a game.
static const int FORM_ROW_H = FONT_H + 1;
static const int FORM_COL_GAP = 3;

static const int FORM_PIPS = 5;
static const int FORM_PIP = 3;
static const int FORM_PIP_PITCH = 4;
static const int FORM_PIPS_W = FORM_PIPS * FORM_PIP_PITCH - 1;
static const int FORM_PIPS_X = PANEL_W - FORM_PIPS_W;

// Buffer sizes, not column widths: "999-999" and "99.9" are the widest the clamps in
// parseLineup permit. A real PPR caps at 12.0 — four bags in the hole every round.
static const int FORM_WL_MAX = 7;
static const int FORM_PPR_MAX = 4;

// ------------------------------------------------- tie card layout geometry --
//
// The fixture card, drawn while a tie is retained on the tie topic. Four rows of
// 5x7 is the whole panel, the same budget the form screen has, but a row here is
// the full width rather than four columns — which is the whole reason the sides
// are stacked instead of drawn either side of a versus mark. Measured: split
// across one row each side gets 9 characters, so a 16-character name lands as
// "ALPHABETA"; stacked it gets 21 and fits whole.
static const int TIE_ROW_H = FONT_H + 1;
static const int TIE_LINE_CHARS = PANEL_W / FONT_ADVANCE;

// The fixture collapses onto one row when both sides fit there *as typed*, which
// frees the fourth row and lets the card breathe. Never by shortening: giving up
// "Neil & Rho" for "NEIL/RHO" to buy air is the wrong way round, so a long pair
// stacks and keeps its ampersand.
//
// One character short of the line, not the whole line. 21 fit, but they run to
// within a pixel of both edges and read as crowding the frame; 20 leaves 4px.
static const int TIE_INLINE_CHARS = TIE_LINE_CHARS - 1;
// The space, the mark and the space between two sides written on one row. Shared with
// the draw card, which puts a preliminary's two entrants either side of the same mark.
static const int VERSUS_CHARS = 3;

// Spread rows sit as one block with the spare height around it, rather than
// spaced evenly: the cup and the round are one thing to read and the fixture is
// another, so the gap goes between them and not inside the heading.
static const int TIE_SPREAD_TOP = 2;
static const int TIE_SPREAD_GAP = 6;

// ------------------------------------------------ draw card layout geometry --
//
// One pull of the tournament draw, drawn while a card is retained on the draw topic.
// Full-width rows like the tie card, for the same reason: a side gets 21 characters,
// which is what lets a doubles pair keep the ampersand it was typed with.
//
// **Two shapes to a pull and not four.** Walking bracketShape's seats, every pull is
// either an entrant with nobody to meet yet — the first name into a preliminary, or a bye
// whose sibling seat is still in the hat — or an entrant with an opponent, which is a
// person or the two halves of a preliminary they meet the winner of. So the card is two
// rows or four, and the block is centred in the panel rather than pinned to the top: a
// two-row card hanging under the round line reads as a screen with its bottom half
// missing.
//
// The opening card is a third shape and is not a pull: a cup with no round, drawn on the
// same two rows in the same place, so pressing the first time replaces the words rather
// than moving the card.
//
// **No team colours.** Every other screen has two sides to tint and this one does not:
// at the moment a name comes out of the hat nobody has been given a colour, and picking
// one would imply an assignment that has not happened. White for who was drawn, grey for
// the words around them.
//
// **No progress count**, though the app publishes one. The completing card needs all
// four rows, so a count could only appear on the two-row shape — and a line that comes
// and goes with the card's shape reads as the panel losing information rather than never
// having offered it. The display has the room and carries it there.
static const int DRAW_ROW_H = FONT_H + 1;
static const int DRAW_LINE_CHARS = PANEL_W / FONT_ADVANCE;
// Two potential opponents share the row with the mark between them, so each gets what
// the score screen's names get. That is the one place the card shortens a side.
static const int DRAW_PAIR_CHARS = (DRAW_LINE_CHARS - VERSUS_CHARS) / 2;
static const char DRAW_PULLING[] = "PULLING...";
static const char DRAW_PLAYS[] = "PLAYS";
static const char DRAW_PLAYS_WINNER[] = "PLAYS WINNER OF";
static const char DRAW_TITLE[] = "DRAW";

// ------------------------------------------------- no-state screen geometry --
//
// The dashes, and a line saying why they are dashes.
//
// Three quite different problems draw the same screen — no WiFi, WiFi but no broker,
// and a broker with no scorer on it — and they have three different fixes: the router,
// the broker, the phone. This is the one screen where telling them apart is worth
// pixels, because it is what the board sits on from switch-on until the app is opened,
// **every session**: the LAN broker deliberately runs without `persistence`
// (docs/OFFLINE-SCOREBOARD.md), so a router reboot leaves nothing retained to recover.
//
// Words rather than the splash's corner dot. The dot is 2px, which leans the whole
// distinction on hue — the one channel the app refuses to let anything stand on alone —
// and this screen is read at arm's length while the kit is being set up, not at 7m. The
// colour is still there as the second channel. The dot also cannot do this job even
// where it is drawn: `RECONNECT_INTERVAL` gates the first MQTT attempt to t=5000ms and
// SPLASH_MS is 5000, so it can never reach its own third state — see CLAUDE.md, where
// firing earlier is rejected because it freezes the splash mid-throw.
//
// LINK_NONE is what a caller passes when it has nothing to say, and the line is then
// simply absent — which is what test_render.cpp's older no-state scenes still ask for.
static const int LINK_NONE = -1;
static const int LINK_NO_WIFI = 0;
static const int LINK_NO_BROKER = 1;
static const int LINK_NO_SCORER = 2;
static const int LINK_STATES = 3;
static const char* const LINK_TEXT[LINK_STATES] = {"NO WIFI", "NO BROKER",
                                                   "WAITING FOR SCORER"};
// The widest of the three, which is 107 of the panel's 128 columns.
static const int LINK_CHARS = 18;
// The full layout's name row, which on this screen has no name in it. That is the whole
// reason the dashes ignore the chosen layout below: PANEL_SCORE gives all 32 rows to
// DIGITS_BIG, and 150mm dashes against 100mm ones is a distinction with nothing behind
// it. The scorer's choice is untouched underneath and returns with the first score.
static const int LINK_TEXT_Y = NAME_Y;

// Three of the app's own team colours, indexed by the state above and shared with the
// splash's dot — one concept, and two spellings of it could disagree about which end is
// which. A randomly coloured wordmark can therefore share a hue with the dot; that stays
// readable because of where it is, not what colour it is.
static const Rgb LINK_COLORS[LINK_STATES] = {
    {0xeb, 0x57, 0x57}, {0xf2, 0xc9, 0x4c}, {0x27, 0xae, 0x60}};

// ---------------------------------------------------- splash layout geometry --
//
// The wordmark, shown while the board comes up. The masks in logo.h are the panel's
// full size, so there is no placement to do.
//
// Not an entry in PANEL_LAYOUTS, for the reason the form screen is not one either: a
// layout is a preference the scorer sets with the Panel button and keeps, and this is
// the first few seconds of a boot. Nothing on the wire selects it.
static const int SPLASH_DOT = 2;
static const int SPLASH_DOT_X = PANEL_W - SPLASH_DOT;
static const int SPLASH_DOT_Y = 0;

// The two boxes the mark draws round its words are two cornhole boards, so the splash
// throws the letters into them: the boxes are up from the first frame and the eight
// letters arrive one at a time, HOLE's from the left and CORN's from the right, the two
// boards taking it in turns the way bags do.
//
// Which letter is thrown when is the sketch's to choose, for the same reason the colour
// pair is — see drawSplash. What lives here is the flight, because the pixel check has
// to own anything that decides where a pixel goes.
static const int SPLASH_BOARDS = 2;
static const int SPLASH_THROWS = SPLASH_BOARDS * LOGO_LETTERS;

// Hand to touchdown.
static const uint32_t SPLASH_FLIGHT_MS = 420;
// How far above its resting line a letter passes at the top of its arc. Six rows is what
// the shallowest letter has above it, so no letter is ever clipped by the top of the
// panel — measured off LOGO_HOLE_LETTERS, where the least headroom is exactly 6.
static const int SPLASH_APEX = 6;
// A bag does not stop dead: it lands short and slides the rest of the way.
static const int SPLASH_SKID = 4;
static const uint32_t SPLASH_SKID_MS = 220;

// The gap between one throw and the next, and it is one flight rather than a number of its
// own: at exactly that spacing a bag touches down as the next is let go, so there is never
// more than one in the air — the one still sliding is already on the board. Every spacing
// from 190ms to 640ms was rendered and compared side by side. At 190 two or three bags are
// in flight at once and it reads as a flurry; at a flight plus its skid each bag has fully
// stopped first, which is a beat too far apart and costs the animation another 1.5s.
// Keeping it derived is what says a change to the flight carries the rhythm with it.
static const uint32_t SPLASH_STAGGER_MS = SPLASH_FLIGHT_MS;
// And the board takes the hit. One row, held long enough to read as a knock rather than
// a wobble — at 5 mm pitch that is 5 mm of a 160 mm panel.
static const int SPLASH_THUMP = 1;
static const uint32_t SPLASH_THUMP_MS = 70;

// Everything is at rest by here, which is what hub75.ino's SPLASH_MS has to outlast.
static const uint32_t SPLASH_ANIM_MS =
    (SPLASH_THROWS - 1) * SPLASH_STAGGER_MS + SPLASH_FLIGHT_MS + SPLASH_SKID_MS;

inline uint32_t splashThrownAt(int board, int slot) {
  return uint32_t(slot * SPLASH_BOARDS + board) * SPLASH_STAGGER_MS;
}
inline uint32_t splashLandedAt(int board, int slot) {
  return splashThrownAt(board, slot) + SPLASH_FLIGHT_MS;
}
// A skidding bag is on the board, so it takes the knock with it.
inline bool splashLanded(int board, int slot, uint32_t elapsed) {
  return elapsed >= splashLandedAt(board, slot);
}

// Read off the clock rather than remembered, so a frame stays a pure function of
// `elapsed` and the pixel check can ask for any moment in any order.
inline int splashThump(int board, uint32_t elapsed) {
  for (int slot = 0; slot < LOGO_LETTERS; slot++) {
    const uint32_t at = splashLandedAt(board, slot);
    if (elapsed >= at && elapsed - at < SPLASH_THUMP_MS) return SPLASH_THUMP;
  }
  return 0;
}

struct SplashOffset {
  int dx, dy;
};

// One throw, of anything, from anywhere: `from` is where it starts relative to where it
// lands, `dir` is the side it comes from (-1 from the left, +1 from the right) and `e` is
// how long ago it left the hand — negative before it was thrown at all. Offsets, not
// positions, so the caller keeps the arithmetic about where the thing belongs.
//
// Horizontally near constant speed, because that is what a thrown thing does and the
// deceleration all belongs in the skid; vertically a parabola, up and back down over the
// flight. Integer throughout so src/panelRender.js can mirror it exactly, and every
// division truncates — the widest product is 4 x apex x flight^2 / 4, which is a million
// and change, so none of it needs 64 bits.
//
// **The splash and the win celebration are thrown by the same arm**, which is why this is
// shared rather than written twice with the same constants: one flight, one apex, one
// skid, so the board has a single idea of what a bag does in the air and a change to it
// carries both. It is also what lets the curve dump in test_render.cpp cover the maths
// once — the win throws contribute their own `from` values to it and nothing else.
inline SplashOffset bagFlight(int from, int dir, int e) {
  if (e <= 0) return {from, 0};
  const uint32_t elapsed = uint32_t(e);
  if (elapsed < SPLASH_FLIGHT_MS) {
    const int travel = dir * SPLASH_SKID - from;
    const int rise = 4 * SPLASH_APEX * e * int(SPLASH_FLIGHT_MS - elapsed);
    return {from + travel * e / int(SPLASH_FLIGHT_MS),
            -(rise / int(SPLASH_FLIGHT_MS * SPLASH_FLIGHT_MS))};
  }

  const uint32_t sliding = elapsed - SPLASH_FLIGHT_MS;
  if (sliding >= SPLASH_SKID_MS) return {0, 0};
  const int left = int(SPLASH_SKID_MS - sliding);
  return {dir * SPLASH_SKID * left * left / int(SPLASH_SKID_MS * SPLASH_SKID_MS), 0};
}

// Where a letter is relative to where it lands.
inline SplashOffset splashThrow(const LogoRect& r, int dir, int board, int slot,
                                uint32_t elapsed) {
  // Just off its own edge, wherever generate_logo.mjs put the letter.
  const int from = dir < 0 ? -(r.x1 + 1) : PANEL_W - r.x0;
  return bagFlight(from, dir, int(elapsed) - int(splashThrownAt(board, slot)));
}

// ------------------------------------------------------------------ won ----
//
// A won game gets a celebration and then a steady state, and the two are different
// animals: the celebration is thrown once and has to know when the win happened, and what
// it settles into runs off a free clock and does not. Both come out of one input —
// `winMs`, how long ago the winner appeared — which is the whole of what renderBoard is
// told about it. Beyond WIN_ANIM_MS the celebration is over and the rest is the gleam's.
//
// The screen is the winner's name with four bags landing under it. The name is what the
// score layout could not say at all: there are no names on it, so who won was carried
// only by which pair of digits blinked.
static const int WIN_BAGS = 4;
// Long enough after the last bag stops to read the row without hurrying.
static const uint32_t WIN_HOLD_MS = 700;
static const uint32_t WIN_THROWS_MS =
    (WIN_BAGS - 1) * SPLASH_STAGGER_MS + SPLASH_FLIGHT_MS + SPLASH_SKID_MS;
static const uint32_t WIN_ANIM_MS = WIN_THROWS_MS + WIN_HOLD_MS;
// The row is written under the first two throws, so the name is whole before the bags
// that underline it have all landed.
static const uint32_t WIN_WIPE_MS = 700;
static const int WIN_ROW_GAP = 4;
static const int WIN_LINE_CHARS = PANEL_W / FONT_ADVANCE;

// "NEIL WINS" but "RHO & TAU WIN", read off the label the way winVerb() does on the app
// side and for the same reason: the payload deliberately carries no `mode`, so a join in
// the string is the only thing that says there are two of them.
static const char WIN_VERB_ONE[] = " WINS";
static const char WIN_VERB_PAIR[] = " WIN";

// Where the i'th bag rests under a row `w` wide starting at `x0`, and which end it is
// thrown from. Shared with the curve dump in test_render.cpp rather than written down
// there, so the check reads the same arithmetic drawWin does — a bag that starts from the
// wrong edge still lands on the right square, so no frame would notice.
struct WinBag {
  int x, dir, from;
};

inline WinBag winBagAt(int i, int x0, int w) {
  const int x = x0 + i * ((w - BAG) / (WIN_BAGS - 1));
  const int dir = i % 2 == 0 ? -1 : 1;
  // Wholly off the edge it comes from, so nothing appears part way in.
  return {x, dir, dir < 0 ? -(x + BAG) : PANEL_W - x};
}

// Which letter's rectangle a pixel falls in, or -1 for the box. The rectangles are
// generated, and generate_logo.mjs checks that no pixel of the box lands in one — which
// is what lets a rectangle stand in for a mask per letter.
inline int splashLetterAt(const LogoRect* letters, int x, int y) {
  for (int i = 0; i < LOGO_LETTERS; i++) {
    const LogoRect& r = letters[i];
    if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) return i;
  }
  return -1;
}

// Logo.jsx tints the wordmark toward white so it reads as chalk rather than as two
// coloured outlines, and a random pair needs that as much as the default one does.
// Rounded rather than truncated, which is the one division in here that does not
// follow the int-truncation rule — it is matching the browser's Math.round.
static const int CHALK_PCT = 28;

inline uint8_t chalked(uint8_t v) {
  return uint8_t(v + ((255 - v) * CHALK_PCT + 50) / 100);
}

inline Rgb chalk(Rgb c) { return Rgb{chalked(c.r), chalked(c.g), chalked(c.b)}; }

// The number columns are sized to **this lineup**, not to the worst case any lineup
// could hold, and the name takes whatever is left. Sizing for the worst case spent 5
// characters on the record even when every row read "6-4"; measured, adapting gives an
// ordinary roster 11 name characters where a fixed layout gave 8, and still fits a
// three-digit record — which is reachable at about 100 matches — by spending them again.
struct FormLayout {
  int wlChars;
  int pprChars;  // 0 when nobody in the lineup has played, so the column is skipped
  int wlRight;
  int pprRight;
  int nameChars;
};

// `clipX` is the exclusive right edge: a column at or past it is not written. That is
// what lets the win screen write its row a column at a time — a character at a time is
// five pixels a step and reads as a stutter at this size.
template <typename Canvas>
void drawTextClipped(Canvas& c, const char* s, int x, int y, Rgb color, int maxChars,
                     int clipX) {
  for (int i = 0; s[i] && i < maxChars; i++) {
    const uint8_t* rows = FONT_ROWS[fontIndex(s[i])];
    for (int ry = 0; ry < FONT_H; ry++) {
      for (int rx = 0; rx < FONT_W; rx++) {
        const int cx = x + i * FONT_ADVANCE + rx;
        if (cx >= clipX) continue;
        if (rows[ry] & (1 << rx)) c.px(cx, y + ry, color.r, color.g, color.b);
      }
    }
  }
}

template <typename Canvas>
void drawText(Canvas& c, const char* s, int x, int y, Rgb color, int maxChars) {
  drawTextClipped(c, s, x, y, color, maxChars, PANEL_W);
}

inline int textWidth(const char* s, int maxChars) {
  int n = 0;
  while (s[n] && n < maxChars) n++;
  return n ? n * FONT_ADVANCE - 1 : 0;
}

// What the board holds once a game is won, for as long as the score stands: a band of
// white sweeping the winner's digits. It replaced a blink, and the two reasons are
// independent. The score never goes dark, so it stays readable for the whole cycle where
// half of every beat used to be blank; and it is a pure function of a free clock, so no
// board has to agree with any other about when the win happened — which a blink got for
// free and a one-shot celebration does not.
//
// White because there is no brighter. The digits are already at LEVEL_LIVE in the team's
// own colour, so the only headroom a lit LED has is the channels it is not using.
static const uint32_t WIN_GLEAM_MS = 1400;
static const int WIN_GLEAM_W = 5;
// Off the left edge by more than the band is wide, so no column is ever inside it.
static const int NO_GLEAM = -WIN_GLEAM_W - 1;

// The leading column of the band and what a column at that edge is lit to. Passed
// through the digit drawing rather than painted over it afterwards, because the panel
// library gives no way to read a pixel back — a wash over the finished frame is a
// browser's move, not this one's.
struct GleamBand {
  int head;
  Rgb top;
};

static const GleamBand NO_BAND = {NO_GLEAM, {0, 0, 0}};

// Travels a band's width past both ends, so it enters and leaves rather than appearing
// and vanishing at the digits' own edges.
inline GleamBand gleamBand(int x0, int x1, uint8_t level, uint32_t phase) {
  const uint32_t span = uint32_t(x1 - x0 + 1 + WIN_GLEAM_W * 2);
  const int head = x0 - WIN_GLEAM_W + int(span * (phase % WIN_GLEAM_MS) / WIN_GLEAM_MS);
  return {head, scaled(WHITE_COLOR, level)};
}

// Full white at the leading edge, back to the team colour by the tail. `top` is already
// scaled to the level the digits are drawn at, so a stale board's gleam dims with them.
inline Rgb gleamed(Rgb base, const GleamBand& band, int x) {
  const int k = WIN_GLEAM_W - (band.head - x);
  if (k <= 0 || k > WIN_GLEAM_W) return base;
  const int mix = 255 * k / WIN_GLEAM_W;
  return Rgb{uint8_t(base.r + (band.top.r - base.r) * mix / 255),
             uint8_t(base.g + (band.top.g - base.g) * mix / 255),
             uint8_t(base.b + (band.top.b - base.b) * mix / 255)};
}

template <typename Canvas>
void drawDigit(Canvas& c, char ch, int x, int y, Rgb color, const DigitFont& f,
               const GleamBand& band = NO_BAND) {
  const uint8_t mask = GLYPH_MASK[glyphIndex(ch)];
  for (int s = 0; s < 7; s++) {
    if (!(mask & (1 << s))) continue;
    for (int ry = 0; ry < f.h; ry++) {
      const uint32_t bits = f.seg[s][ry];
      if (!bits) continue;
      for (int rx = 0; rx < f.w; rx++) {
        if (!(bits & (1u << rx))) continue;
        const Rgb p = band.head == NO_GLEAM ? color : gleamed(color, band, x + rx);
        c.px(x + rx, y + ry, p.r, p.g, p.b);
      }
    }
  }
}

template <typename Canvas>
void drawPair(Canvas& c, const char* pair, int x, int y, Rgb color, const DigitFont& f,
              const GleamBand& band = NO_BAND) {
  drawDigit(c, pair[0], x, y, color, f, band);
  drawDigit(c, pair[1], x + f.w + DIGIT_GAP, y, color, f, band);
}

template <typename Canvas>
void drawRule(Canvas& c, int x0, int x1, int y, Rgb color) {
  for (int x = x0; x < x1; x++) c.px(x, y, color.r, color.g, color.b);
}

// Every other pixel — the only "hollow" one row can carry, which is what the score
// layout has to work with.
template <typename Canvas>
void drawDashedRule(Canvas& c, int x0, int x1, int y, Rgb color) {
  for (int x = x0; x < x1; x += 2) c.px(x, y, color.r, color.g, color.b);
}

template <typename Canvas>
void drawBag(Canvas& c, int x, int y, Rgb color, bool filled) {
  for (int dy = 0; dy < BAG; dy++) {
    for (int dx = 0; dx < BAG; dx++) {
      const bool edge = dx == 0 || dy == 0 || dx == BAG - 1 || dy == BAG - 1;
      if (filled || edge) c.px(x + dx, y + dy, color.r, color.g, color.b);
    }
  }
}

template <typename Canvas>
void drawBlock(Canvas& c, int x, int y, int w, int h, Rgb color) {
  for (int dy = 0; dy < h; dy++)
    for (int dx = 0; dx < w; dx++) c.px(x + dx, y + dy, color.r, color.g, color.b);
}

// `right` is the exclusive right edge of the column.
template <typename Canvas>
void drawTextRight(Canvas& c, const char* s, int right, int y, Rgb color, int maxChars) {
  drawText(c, s, right - textWidth(s, maxChars), y, color, maxChars);
}

// Tenths into "7.2" / "12.0". The panel has no float formatter and would not want
// one; the payload carries tenths for exactly this reason.
inline void formatTenths(int tenths, char* out) {
  const int t = clampInt(tenths, 0, 999);
  const int whole = t / 10;
  int n = 0;
  if (whole >= 10) out[n++] = char('0' + whole / 10);
  out[n++] = char('0' + whole % 10);
  out[n++] = '.';
  out[n++] = char('0' + t % 10);
  out[n] = '\0';
}

// Up to "999-999". The clamp is repeated here rather than trusted from parseLineup,
// because this writes into a fixed buffer and a scene can be built by hand.
inline void formatRecord(int wins, int losses, char* out) {
  int n = 0;
  const auto put = [&](int v) {
    const int c = clampInt(v, 0, 999);
    if (c >= 100) out[n++] = char('0' + c / 100);
    if (c >= 10) out[n++] = char('0' + (c / 10) % 10);
    out[n++] = char('0' + c % 10);
  };
  put(wins);
  out[n++] = '-';
  put(losses);
  out[n] = '\0';
}

// ------------------------------------------------------------ doubles names --
//
// The app's " & " would cost three of the nine characters a team gets here, so
// the panel re-joins with a slash. Two characters back is the difference
// between most pairs fitting whole and being cut.
static const char PAIR_SEPARATOR[] = " & ";  // what arrives
static const int PAIR_SEPARATOR_LEN = 3;
static const char PAIR_JOIN = '/';  // what is drawn
static const int PAIR_JOIN_LEN = 1;

inline int cStrLen(const char* s) {
  int n = 0;
  while (s[n]) n++;
  return n;
}

// False for a singles label, which has nothing to abbreviate.
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

// Measures rather than builds, so fitLabels can search for k cheaply.
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

// Returns the index of the joining slash, or -1 for a singles label. Callers
// need that index rather than searching for it: a player called "N/A" has a
// slash of their own, and re-finding it would treat one name as two.
inline int writeAbbreviated(const char* label, int k, char* dst, int cap) {
  int firstLen;
  const char* second;
  int n = 0;
  int joinAt = -1;
  const auto put = [&](char c) {
    if (n < cap - 1) dst[n++] = c;
  };
  if (!splitPair(label, firstLen, second)) {
    for (int i = 0; label[i] && i < k; i++) put(label[i]);
  } else {
    for (int i = 0; i < firstLen && i < k; i++) put(label[i]);
    joinAt = n;
    put(PAIR_JOIN);
    for (int i = 0; second[i] && i < k; i++) put(second[i]);
  }
  dst[n] = '\0';
  return joinAt;
}

// Each label shortens on its own. One prefix length shared across both teams
// was tried and was wrong: it cut "Lambda" — which fits — to "Lamb" because
// the opposing label was long. Partners within a label do still share one, so
// a shortened pair still looks deliberate.
inline int fitLabelTo(const char* label, char* out, int cap, int maxChars) {
  for (int k = int(TEAM_LABEL_MAX); k >= 1; k--) {
    if (abbreviatedLen(label, k) <= maxChars) return writeAbbreviated(label, k, out, cap);
  }
  // Unreachable for a pair — "A/B" is three characters — but a single name
  // longer than the slot still has to land somewhere.
  return writeAbbreviated(label, 1, out, cap);
}

inline int fitLabel(const char* label, char* out, int cap) {
  return fitLabelTo(label, out, cap, NAME_CHARS);
}

// Span of one half of a fitted label, given where the fit put the join.
// False when that half came out empty, which a blank player name does.
inline bool labelPart(const char* fitted, int joinAt, int which, int& start, int& len) {
  if (joinAt < 0) return false;
  if (which == 0) {
    start = 0;
    len = joinAt;
  } else {
    start = joinAt + 1;
    len = cStrLen(fitted) - joinAt - 1;
  }
  return len > 0;
}

template <typename Canvas>
void drawSide(Canvas& c, const char* name, int joinAt, const char* pair, int pairX,
              int regionX, Rgb color, const GleamBand& band, int rule, int upPartner) {
  const int w = textWidth(name, NAME_CHARS);
  int nx = regionX + (NAME_REGION_W - w) / 2;
  if (nx < 0) nx = 0;
  if (nx + w > PANEL_W) nx = PANEL_W - w;
  drawText(c, name, nx, NAME_Y, color, NAME_CHARS);
  // Ruled rather than flagged with a glyph, which would cost a character. In
  // doubles only the partner who is up: ruling the whole label would say two
  // people are throwing.
  if (rule != RULE_NONE) {
    int start = 0;
    int len = cStrLen(name);
    if (len > NAME_CHARS) len = NAME_CHARS;
    // Falls back to the whole label when the partner's half is empty, so a
    // blank player name loses the name, not the rule.
    int partStart, partLen;
    if (labelPart(name, joinAt, upPartner, partStart, partLen)) {
      start = partStart;
      len = partLen;
    }
    const int x0 = nx + start * FONT_ADVANCE;
    const int x1 = x0 + len * FONT_ADVANCE - 1;  // matches textWidth
    if (rule == RULE_FIRST) drawRule(c, x0, x1, UNDERLINE_Y, color);
    else drawDashedRule(c, x0, x1, UNDERLINE_Y, color);
  }
  drawPair(c, pair, pairX, DIGIT_Y, color, DIGITS_SMALL, band);
}

// The round marker and target line, which both layouts carry — only their rows
// differ. `round` counts rounds *completed*, so the one being played is the next
// one, except once the game is won when there is no next. Display.jsx does the
// same sum; the two must agree, because they render the same retained message
// side by side.
template <typename Canvas>
void drawMarkers(Canvas& c, const BoardState& s, Rgb grey, int roundY, int targetY) {
  {
    int r = s.round + (s.winner ? 0 : 1);
    if (r > 99) r = 99;
    char marker[5] = {'R', 0, 0, 0, 0};
    if (r >= 10) {
      marker[1] = char('0' + r / 10);
      marker[2] = char('0' + r % 10);
    } else {
      marker[1] = char('0' + r);
    }
    drawText(c, marker, (PANEL_W - textWidth(marker, 4)) / 2, roundY, grey, 4);
  }

  if (s.target > 0) {
    // The app caps the target at 99, so two digits is the worst case and
    // "TO 99" is the widest this line ever gets.
    const int t = s.target > 99 ? 99 : s.target;
    char label[8] = {'T', 'O', ' ', 0, 0, 0, 0, 0};
    int n = 3;
    if (t >= 10) label[n++] = char('0' + t / 10);
    label[n++] = char('0' + t % 10);
    drawText(c, label, (PANEL_W - textWidth(label, 8)) / 2, targetY, grey, 8);
  }
}

// Which partner is up, mirroring activeIdx in App.jsx. Derived from the round
// rather than published, because the app derives it the same way.
inline int upPartnerFor(const BoardState& s) { return s.round % 2; }

// A pair of names is a doubles game — the same test winVerb makes on the app side,
// which is why the payload needs no mode. A casual game reads as singles here
// whatever the mode, and correctly: both partners are published as one colour word,
// so there is no second player on the board to mark.
inline bool doublesLabels(const BoardState& s) {
  int firstLen;
  const char* second;
  return splitPair(s.teamA, firstLen, second) || splitPair(s.teamB, firstLen, second);
}

// Both score layouts mark the side throwing first, and in doubles the one throwing
// after them from the same end.
inline int ruleFor(const BoardState& s, char side) {
  if (s.winner != 0 || s.first == 0) return RULE_NONE;
  if (s.first == side) return RULE_FIRST;
  return doublesLabels(s) ? RULE_NEXT : RULE_NONE;
}

// `gleamMs` is how long the celebration has been over, and is only ever read when there
// is a winner — see renderBoard, which is where the two halves of `winMs` are divided.
template <typename Canvas>
void drawFull(Canvas& c, const BoardState& s, uint8_t level, uint32_t gleamMs) {
  char digits[5];
  formatDigits(s.a, s.b, digits);

  char nameA[NAME_CHARS + 1], nameB[NAME_CHARS + 1];
  const int joinA = fitLabel(s.teamA, nameA, NAME_CHARS + 1);
  const int joinB = fitLabel(s.teamB, nameB, NAME_CHARS + 1);
  const int upPartner = upPartnerFor(s);

  const GleamBand bandA =
      s.winner == 'a' ? gleamBand(LEFT_X, LEFT_X + PAIR_W - 1, level, gleamMs) : NO_BAND;
  const GleamBand bandB =
      s.winner == 'b' ? gleamBand(RIGHT_X, RIGHT_X + PAIR_W - 1, level, gleamMs) : NO_BAND;

  // Once the game is won nobody is throwing, so the rules come off.
  drawSide(c, nameA, joinA, digits, LEFT_X, 0, scaled(s.colorA, level), bandA,
           ruleFor(s, 'a'), upPartner);
  drawSide(c, nameB, joinB, digits + 2, RIGHT_X, PANEL_W - NAME_REGION_W,
           scaled(s.colorB, level), bandB, ruleFor(s, 'b'), upPartner);

  const Rgb grey = scaled(MARKER_COLOR, level);

  // Belongs to neither team, so it takes the neutral colour.
  drawText(c, "V", (PANEL_W - FONT_W) / 2, NAME_Y, grey, 1);
  drawMarkers(c, s, grey, ROUND_Y, TARGET_Y);
}

template <typename Canvas>
void drawScore(Canvas& c, const BoardState& s, uint8_t level, uint32_t gleamMs) {
  char digits[5];
  formatDigits(s.a, s.b, digits);

  const Rgb colorA = scaled(s.colorA, level);
  const Rgb colorB = scaled(s.colorB, level);

  const GleamBand bandA =
      s.winner == 'a'
          ? gleamBand(SCORE_LEFT_X, SCORE_LEFT_X + SCORE_PAIR_W - 1, level, gleamMs)
          : NO_BAND;
  const GleamBand bandB =
      s.winner == 'b'
          ? gleamBand(SCORE_RIGHT_X, SCORE_RIGHT_X + SCORE_PAIR_W - 1, level, gleamMs)
          : NO_BAND;

  drawPair(c, digits, SCORE_LEFT_X, SCORE_DIGIT_Y, colorA, DIGITS_BIG, bandA);
  drawPair(c, digits + 2, SCORE_RIGHT_X, SCORE_DIGIT_Y, colorB, DIGITS_BIG, bandB);

  // No names here to underline, so the rules go under the digit pairs — and no room
  // for a bag either: DIGITS_BIG is 30 rows of a 32-row panel.
  const int ruleA = ruleFor(s, 'a');
  const int ruleB = ruleFor(s, 'b');
  if (ruleA == RULE_FIRST) {
    drawRule(c, SCORE_LEFT_X, SCORE_LEFT_X + SCORE_PAIR_W, SCORE_RULE_Y, colorA);
  } else if (ruleA == RULE_NEXT) {
    drawDashedRule(c, SCORE_LEFT_X, SCORE_LEFT_X + SCORE_PAIR_W, SCORE_RULE_Y, colorA);
  }
  if (ruleB == RULE_FIRST) {
    drawRule(c, SCORE_RIGHT_X, SCORE_RIGHT_X + SCORE_PAIR_W, SCORE_RULE_Y, colorB);
  } else if (ruleB == RULE_NEXT) {
    drawDashedRule(c, SCORE_RIGHT_X, SCORE_RIGHT_X + SCORE_PAIR_W, SCORE_RULE_Y, colorB);
  }

  drawMarkers(c, s, scaled(MARKER_COLOR, level), SCORE_ROUND_Y, SCORE_TARGET_Y);
}

// Widest record and widest rate actually present, then the name gets the remainder.
// A record is never narrower than three characters ("0-0"), so a lineup of newcomers
// does not give the name a column it would lose again on the first win.
inline FormLayout formLayout(const LineupState& l) {
  FormLayout f;
  f.wlChars = 3;
  f.pprChars = 0;
  for (int i = 0; i < l.count && i < LINEUP_MAX; i++) {
    char buf[FORM_WL_MAX + 1];
    formatRecord(l.rows[i].wins, l.rows[i].losses, buf);
    const int n = cStrLen(buf);
    if (n > f.wlChars) f.wlChars = n;
    // Only rows with a rate contribute a width, matching what drawForm draws.
    if (hasRate(l.rows[i])) {
      char rate[FORM_PPR_MAX + 1];
      formatTenths(l.rows[i].ppr, rate);
      const int p = cStrLen(rate);
      if (p > f.pprChars) f.pprChars = p;
    }
  }
  f.pprRight = FORM_PIPS_X - FORM_COL_GAP;
  // No rate column at all costs no gap either, rather than leaving a hole.
  const int pprW = f.pprChars > 0 ? f.pprChars * FONT_ADVANCE - 1 + FORM_COL_GAP : 0;
  f.wlRight = f.pprRight - pprW;
  f.nameChars = (f.wlRight - (f.wlChars * FONT_ADVANCE - 1) - FORM_COL_GAP) / FONT_ADVANCE;
  return f;
}

// A win is a filled block, a loss a single centre pixel. Not a dim block: on a
// real panel an unlit-but-not-off LED is indistinguishable from off, so a loss has
// to be drawn as something rather than as a darker something.
//
// Right-aligned within the five slots, so the newest result is in the same column
// on every row even when a player has fewer than five matches.
template <typename Canvas>
void drawPips(Canvas& c, const char* form, int y, Rgb win, Rgb loss) {
  const int n = cStrLen(form) > FORM_PIPS ? FORM_PIPS : cStrLen(form);
  for (int i = 0; i < n; i++) {
    const int x = FORM_PIPS_X + (FORM_PIPS - n + i) * FORM_PIP_PITCH;
    if (form[i] == 'W') drawBlock(c, x, y + 2, FORM_PIP, FORM_PIP, win);
    else c.px(x + 1, y + 3, loss.r, loss.g, loss.b);
  }
}

// Rows are the lineup in lane order — team A's slots then team B's — so the team
// a row belongs to is which half of the list it is in. parseLineup refuses a count
// it cannot halve, which is what makes that safe rather than a guess.
template <typename Canvas>
void drawForm(Canvas& c, const BoardState& s, const LineupState& l, uint8_t level) {
  const Rgb colorA = scaled(s.colorA, level);
  const Rgb colorB = scaled(s.colorB, level);
  const Rgb grey = scaled(MARKER_COLOR, level);
  // Centred, so a singles pair of rows sits in the middle of the panel rather
  // than clinging to the top.
  const int y0 = (PANEL_H - l.count * FORM_ROW_H) / 2;
  const FormLayout f = formLayout(l);

  // Rows are in slot order, so a slot index is a row index. This is the one screen
  // that can be drawn with no score message behind it, and then there is nobody to
  // mark — the lineup topic carries no first thrower and deliberately never will.
  const int half = l.count / 2;
  const int up = upPartnerFor(s);
  const bool marked = s.first != 0 && s.winner == 0;
  const int firstRow = marked ? (s.first == 'a' ? 0 : half) + up : -1;
  // Four rows is doubles; two is the singles case that gets no second mark, the same
  // rule the score layouts read off the label.
  const int nextRow = marked && l.count == 4 ? (s.first == 'a' ? half : 0) + up : -1;
  // Reserved on every row, or the marked one would be the only name indented. The
  // cost is a name character: 11 to 10 on an ordinary roster, 9 to 8 at a two-digit
  // record and 7 to 6 at a three-digit one. Duty is not the constraint it looks like
  // — measured on a dense roster the screen comes out *less* lit with the bags than
  // without (27.4% to 26.9%), because the character given up costs more pixels than
  // two bags add.
  const int indent = marked ? BAG_ADVANCE : 0;
  const int nameChars = f.nameChars - (marked ? 1 : 0);

  for (int i = 0; i < l.count && i < LINEUP_MAX; i++) {
    const LineupRow& r = l.rows[i];
    const Rgb color = i < l.count / 2 ? colorA : colorB;
    const int y = y0 + i * FORM_ROW_H;

    if (i == firstRow) drawBag(c, 0, y + 1, color, true);
    else if (i == nextRow) drawBag(c, 0, y + 1, color, false);
    drawText(c, r.name, indent, y, color, nameChars);

    char record[FORM_WL_MAX + 1];
    formatRecord(r.wins, r.losses, record);
    drawTextRight(c, record, f.wlRight, y, grey, f.wlChars);

    // Empty only where there is no rate to give, never for a rate that happens
    // to be zero: 0.0 PPR is a real average — every bag on the floor — and
    // blanking it reads as missing data rather than a miserable Saturday.
    if (hasRate(r)) {
      char ppr[FORM_PPR_MAX + 1];
      formatTenths(r.ppr, ppr);
      drawTextRight(c, ppr, f.pprRight, y, grey, f.pprChars);
    }

    drawPips(c, r.form, y, color, grey);
  }
}

template <typename Canvas>
void drawTextCentred(Canvas& c, const char* s, int y, Rgb color, int maxChars) {
  drawText(c, s, (PANEL_W - textWidth(s, maxChars)) / 2, y, color, maxChars);
}

// A side written whole, with the ampersand it was typed with, when the row has room —
// which is the one thing a full-width row buys over the score screen's name row — and
// the same slash shortening as a fallback when it does not. Shared by the fixture card
// and the draw card, which need it at two different widths.
inline void fitSideTo(const char* label, char* out, int cap, int maxChars) {
  if (cStrLen(label) <= maxChars) {
    copyInto(label, out, size_t(cap));
    return;
  }
  fitLabelTo(label, out, cap, maxChars);
}

inline void fitTieSide(const char* label, char* out, int cap) {
  fitSideTo(label, out, cap, TIE_LINE_CHARS);
}

// Whether both sides fit on one row with the mark between them. Measured on the
// labels as published, not on the shortened forms: shortening to earn the spread
// would trade a name for a gap.
inline bool tieSpreads(const BoardState& s) {
  return cStrLen(s.teamA) + VERSUS_CHARS + cStrLen(s.teamB) <= TIE_INLINE_CHARS;
}

// Two sides on one row, centred as a single run. Callers pass labels that already fit —
// the fixture card because tieSpreads said so, the draw card because it shortened them —
// so nothing is cut here.
template <typename Canvas>
void drawVersusRow(Canvas& c, const char* left, const char* right, int y, Rgb colorL,
                   Rgb colorR, Rgb grey, int maxChars) {
  const int aLen = cStrLen(left);
  const int bLen = cStrLen(right);
  const int chars = aLen + VERSUS_CHARS + bLen;
  const int x = (PANEL_W - (chars * FONT_ADVANCE - 1)) / 2;
  drawText(c, left, x, y, colorL, maxChars);
  // Belongs to neither side, so it takes the neutral colour — the same rule the
  // full layout's mark follows.
  drawText(c, "V", x + (aLen + 1) * FONT_ADVANCE, y, grey, 1);
  drawText(c, right, x + (aLen + VERSUS_CHARS) * FONT_ADVANCE, y, colorR, maxChars);
}

template <typename Canvas>
void drawTieFixture(Canvas& c, const BoardState& s, int y, Rgb colorA, Rgb colorB, Rgb grey) {
  drawVersusRow(c, s.teamA, s.teamB, y, colorA, colorB, grey, TIE_LINE_CHARS);
}

// Who is playing and what it is, in the two teams' own colours. No versus mark
// when the sides are stacked: the colours are the same two the score screen puts
// either side of one, so a mark between two rows says nothing a row of pixels can
// carry — there is exactly 1px between them, and a rule there reads as an
// underscore stuck to the name.
//
// No first-thrower rule for the same reason, and the score screen carries one a
// few seconds later. Drawing it only in the spread layout, where the room exists,
// was considered and rejected: a marker that appears only when the names are short
// reads as missing information rather than as information never offered.
template <typename Canvas>
void drawTie(Canvas& c, const BoardState& s, const TieState& t, uint8_t level) {
  const Rgb colorA = scaled(s.colorA, level);
  const Rgb colorB = scaled(s.colorB, level);
  const Rgb grey = scaled(MARKER_COLOR, level);
  const Rgb white = scaled(Rgb{0xff, 0xff, 0xff}, level);

  const bool spread = tieSpreads(s);
  // The heading is always two rows, so a cup does not change shape between its
  // own ties: only the fixture adapts, and the mode a tie is played in is fixed
  // by the draw.
  const int top = spread ? TIE_SPREAD_TOP : 0;
  drawTextCentred(c, t.cup, top, grey, TIE_LINE_CHARS);
  drawTextCentred(c, t.round, top + TIE_ROW_H, white, TIE_LINE_CHARS);

  if (spread) {
    drawTieFixture(c, s, top + TIE_ROW_H + FONT_H + TIE_SPREAD_GAP, colorA, colorB, grey);
    return;
  }

  char sideA[TIE_LINE_CHARS + 1], sideB[TIE_LINE_CHARS + 1];
  fitTieSide(s.teamA, sideA, TIE_LINE_CHARS + 1);
  fitTieSide(s.teamB, sideB, TIE_LINE_CHARS + 1);
  drawTextCentred(c, sideA, top + TIE_ROW_H * 2, colorA, TIE_LINE_CHARS);
  drawTextCentred(c, sideB, top + TIE_ROW_H * 3, colorB, TIE_LINE_CHARS);
}

// Where one name landed, and who it will meet. The whole card comes out of the payload —
// see DrawState for why nothing here reads the score message.
//
// A pull's heading is the round rather than the cup's name, which is the opposite of the
// fixture card and is the byte budget rather than a preference: a 32-unit cup name on a
// card that also carries a pull puts the packet within 25 bytes of MQTT_BUFFER. The round
// is the thing that changes pull to pull anyway, and the tie topic names the cup again a
// few minutes later.
//
// **The opening card is the exception, and it costs nothing**: it carries the cup instead
// of a round rather than as well, so the topic's worst case is unmoved. It says what is
// about to happen where every other card says what just did, which is why the cup takes
// the white row and the fixed word takes the grey one — the reverse of the tie card,
// where the round is what varies.
template <typename Canvas>
void drawDrawCard(Canvas& c, const DrawState& d, uint8_t level) {
  const Rgb grey = scaled(MARKER_COLOR, level);
  const Rgb white = scaled(Rgb{0xff, 0xff, 0xff}, level);

  if (d.round[0] == '\0') {
    const int top = (PANEL_H - 2 * DRAW_ROW_H) / 2;
    drawTextCentred(c, d.cup, top, white, DRAW_LINE_CHARS);
    drawTextCentred(c, DRAW_TITLE, top + DRAW_ROW_H, grey, DRAW_LINE_CHARS);
    return;
  }

  const bool matched = d.named && d.opponents > 0;
  const int rows = matched ? 4 : 2;
  const int y0 = (PANEL_H - rows * DRAW_ROW_H) / 2;
  drawTextCentred(c, d.round, y0, grey, DRAW_LINE_CHARS);

  // Nothing to name yet, so the card says the hat is being reached into. Withheld rather
  // than blank: a press that changes nothing on the board reads as a dead button, which
  // is the same reason `Toss for first` holds its result back in the app.
  if (!d.named) {
    drawTextCentred(c, DRAW_PULLING, y0 + DRAW_ROW_H, white, DRAW_LINE_CHARS);
    return;
  }

  char name[DRAW_LINE_CHARS + 1];
  fitSideTo(d.name, name, DRAW_LINE_CHARS + 1, DRAW_LINE_CHARS);
  drawTextCentred(c, name, y0 + DRAW_ROW_H, white, DRAW_LINE_CHARS);
  if (!matched) return;

  const bool viaPreliminary = d.opponents > 1;
  drawTextCentred(c, viaPreliminary ? DRAW_PLAYS_WINNER : DRAW_PLAYS, y0 + DRAW_ROW_H * 2,
                  grey, DRAW_LINE_CHARS);

  if (!viaPreliminary) {
    char opponent[DRAW_LINE_CHARS + 1];
    fitSideTo(d.opponent[0], opponent, DRAW_LINE_CHARS + 1, DRAW_LINE_CHARS);
    drawTextCentred(c, opponent, y0 + DRAW_ROW_H * 3, white, DRAW_LINE_CHARS);
    return;
  }

  // Both halves of the preliminary on the last row. Stacking them would need a fifth row
  // the panel does not have, so this is the one place the card gives up characters.
  char left[DRAW_PAIR_CHARS + 1], right[DRAW_PAIR_CHARS + 1];
  fitSideTo(d.opponent[0], left, DRAW_PAIR_CHARS + 1, DRAW_PAIR_CHARS);
  fitSideTo(d.opponent[1], right, DRAW_PAIR_CHARS + 1, DRAW_PAIR_CHARS);
  drawVersusRow(c, left, right, y0 + DRAW_ROW_H * 3, white, white, grey, DRAW_PAIR_CHARS);
}

// Two pixels to a byte, low nibble first, so a row reads left to right.
inline uint8_t logoLevel(const uint8_t* row, int x) {
  return (row[x >> 1] >> ((x & 1) * 4)) & 0x0f;
}

// Coverage, so the tilted strokes are antialiased rather than staircased — which is the
// one thing a 128x32 panel can do about a diagonal. Truncating like everything else here
// except chalk(), and mirrored by idiv in src/panelRender.js.
inline Rgb covered(Rgb c, uint8_t level) {
  return Rgb{uint8_t(c.r * level / LOGO_LEVELS), uint8_t(c.g * level / LOGO_LEVELS),
             uint8_t(c.b * level / LOGO_LEVELS)};
}

// A bag in flight is drawn where it has got to, so one still off the edge is simply not
// written — the splash's rule, and the same reason: a bag starts outside the panel.
template <typename Canvas>
void drawFlyingBag(Canvas& c, int x, int y, Rgb color) {
  for (int dy = 0; dy < BAG; dy++) {
    for (int dx = 0; dx < BAG; dx++) {
      const int px = x + dx;
      const int py = y + dy;
      if (px < 0 || py < 0 || px >= PANEL_W || py >= PANEL_H) continue;
      c.px(px, py, color.r, color.g, color.b);
    }
  }
}

// The win celebration: the winner's name written a column at a time, with four bags
// thrown in under it. `elapsed` is milliseconds since the winner appeared, and every
// frame is a pure function of it — nothing is remembered between them, the splash's rule
// and for the same reason.
//
// The bags spread to the row's own width rather than sitting in a clump, so they read as
// the rule the panel already draws under a name rather than as four bags that happen to
// be there. They come from alternate ends, which is where the two boards are thrown from.
template <typename Canvas>
void drawWin(Canvas& c, const BoardState& s, uint8_t level, uint32_t elapsed) {
  const char* label = s.winner == 'a' ? s.teamA : s.teamB;
  const Rgb color = scaled(s.winner == 'a' ? s.colorA : s.colorB, level);

  int firstLen;
  const char* second;
  const char* verb = splitPair(label, firstLen, second) ? WIN_VERB_PAIR : WIN_VERB_ONE;
  const int verbLen = cStrLen(verb);

  // The name shortens the way every other oversized label on the panel does, and the verb
  // is never what gives — a row reading "OMICRONZETA/UPSILO WIN" says who won, and one
  // reading "OMICRONZETA/UPSILONXI W" says nothing.
  char name[WIN_LINE_CHARS + 1];
  fitSideTo(label, name, sizeof name, WIN_LINE_CHARS - verbLen);

  char line[WIN_LINE_CHARS + 1];
  int n = 0;
  for (int i = 0; name[i] && n < WIN_LINE_CHARS; i++) line[n++] = name[i];
  for (int i = 0; verb[i] && n < WIN_LINE_CHARS; i++) line[n++] = verb[i];
  line[n] = '\0';

  const int w = textWidth(line, WIN_LINE_CHARS);
  const int x0 = (PANEL_W - w) / 2;
  const int nameY = (PANEL_H - (FONT_H + WIN_ROW_GAP + BAG)) / 2;
  const int clipX =
      elapsed >= WIN_WIPE_MS ? PANEL_W : x0 + int(uint32_t(w) * elapsed / WIN_WIPE_MS) + 1;
  drawTextClipped(c, line, x0, nameY, color, WIN_LINE_CHARS, clipX);

  const int bagY = nameY + FONT_H + WIN_ROW_GAP;
  for (int i = 0; i < WIN_BAGS; i++) {
    const WinBag b = winBagAt(i, x0, w);
    const SplashOffset o =
        bagFlight(b.from, b.dir, int(elapsed) - int(uint32_t(i) * SPLASH_STAGGER_MS));
    drawFlyingBag(c, b.x + o.dx, bagY + o.dy, color);
  }
}

// Clipped on the way out rather than on the way in: a letter is drawn where it has got
// to, so part of one off the edge of the panel is simply not written.
template <typename Canvas>
inline void splashPx(Canvas& c, int x, int y, Rgb color, uint8_t level) {
  if (x < 0 || y < 0 || x >= PANEL_W || y >= PANEL_H) return;
  const Rgb p = covered(color, level);
  c.px(x, y, p.r, p.g, p.b);
}

// One board: its box, then its four letters in the order they were thrown, so the bag
// that landed last is the one on top.
//
// One colour for the whole board, bags included, so what the throws settle into is the
// app's own wordmark and not a version of it. That is what keeps the order a matter of
// timing alone — see drawSplash.
template <typename Canvas>
void drawSplashBoard(Canvas& c, const uint8_t map[LOGO_H][LOGO_STRIDE],
                     const LogoRect* letters, const uint8_t* order, int board, int dir,
                     Rgb color, uint32_t elapsed) {
  const int thump = splashThump(board, elapsed);

  for (int y = 0; y < LOGO_H; y++) {
    for (int x = 0; x < LOGO_W; x++) {
      const uint8_t level = logoLevel(map[y], x);
      if (level == 0 || splashLetterAt(letters, x, y) >= 0) continue;
      splashPx(c, x, y + thump, color, level);
    }
  }

  for (int slot = 0; slot < LOGO_LETTERS; slot++) {
    const LogoRect& r = letters[order[slot]];
    const SplashOffset o = splashThrow(r, dir, board, slot, elapsed);
    const int dy = o.dy + (splashLanded(board, slot, elapsed) ? thump : 0);
    for (int y = r.y0; y <= r.y1; y++) {
      for (int x = r.x0; x <= r.x1; x++) {
        const uint8_t level = logoLevel(map[y], x);
        if (level > 0) splashPx(c, x + o.dx, y + dy, color, level);
      }
    }
  }
}

// The two words are painted from separate coverage maps, so which colour each takes is
// decided here rather than baked into the asset. CORN's board is drawn second because it
// owns the overlap where the two boxes cross, which is the order the SVG paints them in.
//
// `connect` indexes LINK_COLORS, or is LINK_NONE for no indicator at all.
// `elapsed` is milliseconds since the board came up. `order` is which letter each board
// throws at each slot, 0-3 left to right.
//
// The colours, the clock and the order are all arguments and none of them is chosen
// here: the sketch picks the pair and shuffles the two boards, because this file
// host-compiles and the pixel check needs the same inputs to give the same frame.
//
// The order changes the animation and nothing else: a board is one colour, so whatever
// order its bags arrive in they settle into the same frame — the app's wordmark. Both
// halves of that are asserted in test_render.cpp.
template <typename Canvas>
void drawSplash(Canvas& c, Rgb colorA, Rgb colorB, int connect, uint32_t elapsed,
                const uint8_t order[SPLASH_BOARDS][LOGO_LETTERS]) {
  drawSplashBoard(c, LOGO_HOLE, LOGO_HOLE_LETTERS, order[0], 0, -1, chalk(colorA), elapsed);
  drawSplashBoard(c, LOGO_CORN, LOGO_CORN_LETTERS, order[1], 1, +1, chalk(colorB), elapsed);
  if (connect >= 0 && connect < LINK_STATES) {
    drawBlock(c, SPLASH_DOT_X, SPLASH_DOT_Y, SPLASH_DOT, SPLASH_DOT, LINK_COLORS[connect]);
  }
}

// `winMs` is how long ago the winner appeared, and it carries both halves of what a won
// game shows: under WIN_ANIM_MS the celebration owns the whole panel, and after it the
// score comes back with the gleam sweeping the winning pair. It is ignored outright while
// nobody has won. One input rather than two because the second is the first still
// counting — and because only the celebration cares *when*, the gleam only cares that the
// clock is running.
//
// The celebration is what a board that rebooted replays: the stamp is the sketch's own
// millis(), so a board handed a retained message from a finished game celebrates it
// again. Deliberate, and bounded — it settles into the gleam, which is the steady state
// and needs no stamp at all.
//
// A retained lineup wins over both score layouts, and over the no-state dashes:
// it is only ever published before the first bag, so while it is there the score
// is 0-0 and there is nothing to cover up. The scorer's chosen layout is
// untouched underneath and comes back when the lineup is cleared.
//
// A retained tie wins over the lineup in turn, and needs `haveState` where the
// lineup does not: the card is drawn from the two sides in the score message, so
// without one there is nobody to name. Both are cleared at the first bag, so the
// order between them only decides what a tournament shows before it — form, which
// in a knockout is every side unbeaten, or which tie this is.
//
// A retained draw card wins over all of them and needs `haveState` least of all: it is
// published while the names are still being pulled out of a hat, before any tie has been
// picked and before any game exists, so whatever score is retained underneath is last
// week's. Nothing below it can be about the draw, so the order is not a judgement.
//
// `connect` indexes LINK_TEXT and is read by the no-state screen alone. Every other
// screen has something published on it, and there the whole panel dimming already says
// the link went — a second indicator would be repeating it.
template <typename Canvas>
void renderBoard(Canvas& c, const BoardState& s, bool haveState, bool live, uint32_t winMs,
                 PanelLayout layout = PANEL_FULL, const LineupState* lineup = nullptr,
                 const TieState* tie = nullptr, const DrawState* draw = nullptr,
                 int connect = LINK_NONE) {
  const uint8_t level = live ? LEVEL_LIVE : LEVEL_STALE;
  const bool score = layout == PANEL_SCORE;

  if (draw && draw->set) {
    drawDrawCard(c, *draw, level);
    return;
  }

  if (tie && tie->set && haveState) {
    drawTie(c, s, *tie, level);
    return;
  }

  if (lineup && lineup->count > 0) {
    drawForm(c, s, *lineup, level);
    return;
  }

  if (!haveState) {
    // The full layout's geometry whatever `layout` says, so the row the status line
    // needs is free on both — see the no-state section.
    const Rgb grey = scaled(MARKER_COLOR, level);
    const char dashes[3] = {'-', '-', '\0'};
    drawPair(c, dashes, LEFT_X, DIGIT_Y, grey, DIGITS_SMALL);
    drawPair(c, dashes, RIGHT_X, DIGIT_Y, grey, DIGITS_SMALL);
    if (connect >= 0 && connect < LINK_STATES) {
      // Full brightness where the dashes are dim, and that is not an oversight: dim
      // means "nobody is feeding this any more", which is exactly what the dashes are
      // saying and exactly what this line is not. It is the freshest thing on the panel.
      drawTextCentred(c, LINK_TEXT[connect], LINK_TEXT_Y, LINK_COLORS[connect], LINK_CHARS);
    }
    return;
  }

  // Below the three retained topics and above the score. It cannot collide with any of
  // them — all three are cleared at the first bag and a game is won long after that — so
  // the order costs nothing; putting it here is what keeps the draw, the tie and the
  // lineup the only things that can pre-empt a score.
  if (s.winner != 0 && winMs < WIN_ANIM_MS) {
    drawWin(c, s, level, winMs);
    return;
  }

  const uint32_t gleamMs = s.winner != 0 ? winMs - WIN_ANIM_MS : 0;
  if (score) {
    drawScore(c, s, level, gleamMs);
  } else {
    drawFull(c, s, level, gleamMs);
  }
}
