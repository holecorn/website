// External scoreboard: what gets published, and where. Pure functions plus the
// localStorage read/write for the connection settings.
//
// The scoreboard shows the *logged* score (committed rounds only), not the live
// in-round preview, so a game normally publishes one message per round. Every
// message carries the whole state rather than a delta, which is what lets a
// display that reboots or reconnects mid-game recover with no resync logic.

import { gameStarted, sideLabel, totals, teamLabel } from './scoring.js';
import { PANEL_LAYOUTS } from './panelRender.js';
import { lineupStats } from './stats.js';

// The scorer and the display keep separate copies, so opening a display link in
// the same browser as the scorer cannot overwrite the scorer's game code.
const CONFIG_KEYS = {
  app: 'holecorn.scoreboard.v1',
  display: 'holecorn.scoreboard.display.v1',
};
// Ambiguous characters left out so a code can be read aloud across a garden.
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
// ~25 bits. The code is the only thing keeping strangers off the board when the
// broker takes anonymous connections, so it is sized to be unguessable rather
// than merely unique.
const CODE_LENGTH = 5;

const EMPTY_CONFIG = {
  broker: '',
  username: '',
  password: '',
  // The pair the display link carries instead, when the broker has a read-only
  // account to offer. See `linkCredentials`.
  displayUsername: '',
  displayPassword: '',
  code: '',
  enabled: false,
  layout: 'full',
};

// What each panel arrangement is called on the setup screen. Keyed by the ids in
// panelRender.js, which are the ones published and the ones board_logic.h parses.
export const LAYOUT_LABELS = {
  full: 'Names + score',
  score: 'Score only, bigger',
};

export function normalizeLayout(raw) {
  return PANEL_LAYOUTS.includes(raw) ? raw : PANEL_LAYOUTS[0];
}

export function scoreboardPayload(game) {
  const t = totals(game);
  return {
    a: t.a,
    b: t.b,
    round: game.rounds.length,
    target: game.target,
    first: game.nextFirst,
    teamA: teamLabel(game, 'a'),
    teamB: teamLabel(game, 'b'),
    colorA: game.colors.a,
    colorB: game.colors.b,
    // Omitted while the game is live rather than sent as null. Absent already
    // means "nobody has won" to both consumers — board_logic.h reads a missing
    // key as no winner, and Display.jsx coalesces — so the null was 14 bytes of
    // a budget the worst case spends 74% of.
    ...(game.winner ? { winner: game.winner } : {}),
  };
}

// How many results the panel's form pips show. Mirrors FORM_PIPS in render.h,
// and FORM_LENGTH in stats.js already cuts the list to this.
const LINEUP_FORM = 5;
// Singles and doubles, and nothing else: the board splits rows into teams by
// halving the count, so a length it cannot halve is refused rather than drawn in
// the wrong colours.
const LINEUP_SIZES = [2, 4];

// What the pre-game form screen is drawn from, or null when there is nothing to
// show. Its own retained topic, for the same reasons the layout has one — the
// score payload's worst case already spends 74% of the board's buffer and the
// firmware pins its shape.
//
// Deliberately absent from the score payload *and* not merged into the layout
// topic: presence of a lineup is what tells a board to draw form rather than the
// score, so publishing it and clearing it is the whole trigger. Nothing carries a
// mode or a screen name.
//
// Colours are not repeated here — the board already has them from the score
// message, and two copies could disagree. Names are, because the score payload
// only carries *joined team labels* and these rows are per player.
export function lineupPayload(game, matches) {
  // Only before the first bag. `gameStarted` rather than the setup screen,
  // because the publisher has no screen: this way the board clears itself the
  // moment scoring begins, and comes back if the game is undone to nothing.
  if (gameStarted(game)) return null;
  // A casual game takes no names, so there is no roster to report. Checked
  // explicitly rather than left to the `played` test below: the slots still hold
  // the default names underneath, and those have genuinely been played under, so
  // the board would otherwise show a stranger somebody else's form line.
  if (game.casual) return null;
  const rows = lineupStats(matches ?? [], game);
  // A roster nobody has played under has nothing to report, so the screen stays
  // away entirely rather than showing a table of zeroes.
  if (!rows.some((p) => p.played)) return null;
  if (!LINEUP_SIZES.includes(rows.length)) return null;
  return {
    rows: rows.map((p) => ({
      n: p.name,
      // Three digits, not two. At 99 the board silently drew "99" while the phone and
      // the stats screen showed the real figure — wrong rather than truncated, and
      // reachable at about 100 matches in either column. Both consumers size the record
      // column to what actually arrives, so the extra width costs nothing until someone
      // earns it.
      w: Math.min(p.wins, 999),
      l: Math.min(p.losses, 999),
      // Tenths, so the board formats "7.2" without carrying a float. Omitted
      // rather than sent as 0 when no thrown bags sit behind the record — an
      // imported result, or a newcomer — because 0.0 is a real average and the
      // board has to keep drawing that. Absent means unknown, the same contract
      // `winner` uses in the score payload, and it only ever shortens a packet.
      ...(p.rounds > 0 ? { p: Math.min(Math.round(p.ppr * 10), 999) } : {}),
      // A string rather than a bitmask: the same bytes, and both ends read it
      // without needing to agree on which bit is the oldest result.
      f: p.form
        .slice(-LINEUP_FORM)
        .map((won) => (won ? 'W' : 'L'))
        .join(''),
    })),
  };
}

// The tie a game is, or null when it is an ordinary game. Published while the
// game has not begun and cleared at the first bag, the way the lineup is — so a
// board joining part way through a tie shows the score, not a fixture card for a
// game already under way.
//
// Deliberately carries no names: the two sides are already in the score payload
// as joined labels, and two copies of who is playing could disagree. Nothing here
// is truncated either, because this topic has a packet to itself — the panel cuts
// to what its line holds and the display shows the lot.
export function tiePayload(game, tie) {
  if (gameStarted(game) || !tie) return null;
  return { t: tie.name, r: tie.round };
}

// One pull of the tournament draw, as the board is told it: the round the name landed
// in, who came out of the hat, and who they will meet. Null when no draw is being
// played out, which clears the card the way a null lineup does.
//
// **Two beats per press, both published from here.** The first withholds the name —
// `pulling` — and the second reveals it. Half the theatre of a draw is the pause, and
// the same reasoning already sits behind `Toss for first`: a press that changes nothing
// visible reads as a dead button. The board animates nothing; it draws whichever card it
// was last told about, so there is no phase on the wire and a board joining mid-beat sees
// "pulling", which is true.
//
// **A pull deliberately carries no cup name**, unlike the tie card. Measured on the same
// basis as `test_board_logic.cpp`: the round, a doubles side and a doubles "winner of"
// pair reach ~376 bytes of the board's 512 buffer, and a 32-unit cup name on top puts the
// worst case at ~487 with 25 bytes spare — tighter than the lineup, which is otherwise
// the largest message the board receives. `/tie` already carries the name and has a
// packet to itself.
//
// The opening card is the exception, and it is free: it is the cup's name *instead of* a
// round, on the one card that has no pull to carry, so the topic's worst case is unmoved.
//
// The opponent travels as **structured sides** rather than a worded phrase for the same
// budget: the board writes "PLAYS WINNER OF" itself, which is free, where sending the
// words costs bytes on every message.
export function drawPayload(reveal) {
  if (!reveal) return null;
  const { step, cup, drawn, total, pulling } = reveal;
  // Nothing pulled yet, so the board says what is about to happen. This is the only card
  // that names the cup and the only one that is not about somebody.
  if (!step) return { t: cup, d: drawn, e: total };
  return {
    r: step.round,
    // Absent while the beat is held, the way `winner` is absent while a game is live:
    // there is no name yet, and absent-means-unknown is the contract both consumers
    // already read. It is also what the board keys the drum-roll card off.
    ...(pulling ? {} : { n: sideLabel(step.side.names) }),
    // Absent rather than an empty array when nobody is named yet — one fewer key on the
    // packet whose worst case is the thing being watched. 0, 1 or 2 sides: nobody yet,
    // a person, or the two halves of a preliminary whose winner they meet.
    ...(pulling || step.opponents.length === 0
      ? {}
      : { o: step.opponents.map((s) => sideLabel(s.names)) }),
    d: drawn,
    e: total,
  };
}

// Who a pulled name has drawn, written out. `render.h` composes the same fact from
// `VERSUS_CHARS` and its own words, so this is the *prose* half — the ceremony screen
// says it to the scorer and `?display=1` says it to the room, and the two stood side by
// side during the draw with the sentence written out twice, word for word and asserted
// nowhere. Takes labels rather than sides, because the two callers have different halves:
// the phone holds `step.opponents` as sides and the display receives them already joined.
export function drawMeets(opponents) {
  if (opponents.length === 0) return null;
  if (opponents.length === 1) return `plays ${opponents[0]}`;
  return `plays the winner of ${opponents.join(' v ')}`;
}

// Mirrors parseDraw in board_logic.h: a card is a round or a cup, and everything else is
// optional — a message without a name is the drum roll, one without opponents is an
// entrant still waiting for theirs, and a cup with no round is the opening card.
export function usableDraw(next) {
  const field = (key) => typeof next[key] === 'string' && next[key] !== '';
  return typeof next === 'object' && next !== null && (field('r') || field('t'));
}

// Mirrors parseTie in board_logic.h.
export function usableTie(next) {
  return (
    typeof next === 'object' &&
    next !== null &&
    typeof next.r === 'string' &&
    next.r !== '' &&
    (next.t === undefined || typeof next.t === 'string')
  );
}

// Mirrors parseLineup in board_logic.h. The broker is shared and the code is
// short, so anything could be on the topic.
export function usableLineup(next) {
  return (
    typeof next === 'object' &&
    next !== null &&
    Array.isArray(next.rows) &&
    LINEUP_SIZES.includes(next.rows.length)
  );
}

// `v` is a wall-clock stamp, so only a *plausible* reorder is rejected: a
// delayed QoS 1 retry arrives seconds late, not minutes. A message far older
// than the last is a different phone or a corrected clock, and must be accepted
// — otherwise one publish from a device whose clock is fast pins a future stamp
// into the retained message and every display silently ignores the real score
// until wall-clock catches up.
export const REORDER_WINDOW = 60_000;

// The broker is shared and the game code is short, so anything on the topic
// could be someone else's or malformed. Require the fields the board cannot
// render without, and drop the rest rather than painting NaN.
export function usableState(next) {
  return (
    typeof next === 'object' &&
    next !== null &&
    Number.isFinite(next.a) &&
    Number.isFinite(next.b)
  );
}

export function acceptsUpdate(next, lastV) {
  if (!usableState(next)) return false;
  if (!Number.isFinite(next.v)) return true;
  return !(next.v < lastV && lastV - next.v < REORDER_WINDOW);
}

export function stateTopic(code) {
  return `holecorn/${normalizeCode(code)}/state`;
}

// Retained, and set as the publisher's MQTT will, so a display can tell "score
// is 0-0" from "the phone has gone away".
export function onlineTopic(code) {
  return `holecorn/${normalizeCode(code)}/online`;
}

// Its own retained topic rather than a field in the score payload: the payload's
// worst case already spends 74% of the board's buffer, the firmware pins its
// shape, and a layout is a different fact with a different lifetime — it changes
// when you press a button, not when a round is scored. Retained, so a board that
// reboots recovers the choice the same way it recovers presence, and a change
// takes effect at once rather than waiting for the next round to be committed.
export function layoutTopic(code) {
  return `holecorn/${normalizeCode(code)}/layout`;
}

// Retained like the layout, and **cleared** — published empty — the moment a bag
// is thrown. Its presence is the trigger for the form screen, so clearing it is
// how the board goes back to the score, and a board that reboots mid-setup
// recovers the form screen the same way it recovers presence.
export function lineupTopic(code) {
  return `holecorn/${normalizeCode(code)}/lineup`;
}

// Retained and cleared exactly like the lineup, and for the same reason it is a
// topic rather than a field: a tie is a different fact with a different lifetime
// from a roster or a score. Its own topic also keeps the cup's name out of the
// lineup packet, which at 423 of the board's 512 bytes is the largest message
// the board receives and has no room for a 32-character name.
export function tieTopic(code) {
  return `holecorn/${normalizeCode(code)}/tie`;
}

// Retained and cleared like the lineup and the tie, and a fourth topic for the same
// reason there is a third: a pull of the draw is a different fact with a different
// lifetime again — it changes on a button press, and it exists before any game at all.
//
// **It is the one pre-game topic that does not need a score message behind it.** A draw
// can be taken on a board that has never been sent a game, so the card is drawn from
// this payload alone: no names off `teamA`/`teamB`, and no team colours, because at the
// moment a name comes out of the hat nobody has been given one.
export function drawTopic(code) {
  return `holecorn/${normalizeCode(code)}/draw`;
}

export function normalizeCode(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 16);
}

export function newCode() {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => CODE_ALPHABET[n % CODE_ALPHABET.length]).join('');
}

export function configComplete(config) {
  return Boolean(
    config && String(config.broker ?? '').trim() && normalizeCode(config.code),
  );
}

export function configFromSearch(search) {
  const params = new URLSearchParams(search);
  const picked = {};
  const map = { broker: 'broker', user: 'username', pass: 'password', code: 'code' };
  for (const [param, field] of Object.entries(map)) {
    const value = params.get(param);
    if (value !== null) picked[field] = value;
  }
  return picked;
}

// Which credentials the display link hands out. The scorer's pair publishes; a
// board only ever subscribes, so where the broker offers a read-only account the
// link should carry that instead — `docs/OFFLINE-SCOREBOARD.md` provisions exactly
// that split as `scorer` and `viewer`. Left blank the link keeps carrying the
// scorer's, which is what every setup did before these fields existed.
//
// **All-or-nothing, never field by field.** Falling back per field would take a
// half-filled display pair and put the *scorer's password* into a link the person
// filling those boxes believes they have just locked down — the one outcome this
// exists to prevent. Taken as a unit a half-filled pair is simply refused by the
// broker, which is visible.
export function linkCredentials(config) {
  const username = String(config.displayUsername ?? '');
  const password = String(config.displayPassword ?? '');
  if (username || password) return { username, password };
  return { username: config.username ?? '', password: config.password ?? '' };
}

// A link that opens the display view already configured, so the tablet acting
// as the scoreboard never has to have the broker details typed into it.
//
// **`/board/` and not `/`, so the tablet can keep it on its home screen.** That page is
// `index.html` with the manifest link stripped out (`boardPage()` in `vite.config.js`),
// because Add to Home Screen replaces the URL on screen with the manifest's `start_url` —
// and this query string is the configuration. The path is the only thing that carries: the
// query still says which view, so `/?display=1&…` keeps working for every link already
// copied, it just cannot be installed.
export function displayUrl(origin, config) {
  const params = new URLSearchParams({ display: '1', code: normalizeCode(config.code) });
  if (config.broker) params.set('broker', config.broker);
  const { username, password } = linkCredentials(config);
  if (username) params.set('user', username);
  if (password) params.set('pass', password);
  return `${origin}/board/?${params}`;
}

// Blank-padded rather than zero-padded, the way a real scoreboard reads, and
// clamped because the digits physically cannot show more.
export function segmentDigits(value, places = 2) {
  const max = 10 ** places - 1;
  const n = Number(value);
  const clamped = Math.min(Math.max(Number.isFinite(n) ? Math.trunc(n) : 0, 0), max);
  return String(clamped).padStart(places, ' ').split('');
}

export function loadScoreboardConfig(role = 'app') {
  try {
    const raw = localStorage.getItem(CONFIG_KEYS[role]);
    // Merge over defaults so settings saved before a field existed still load.
    if (raw) return { ...EMPTY_CONFIG, ...JSON.parse(raw) };
  } catch {
    // ignore corrupt settings and start fresh
  }
  return { ...EMPTY_CONFIG };
}

export function saveScoreboardConfig(config, role = 'app') {
  try {
    localStorage.setItem(CONFIG_KEYS[role], JSON.stringify(config));
  } catch {
    // a full or unavailable localStorage must not break scoring
  }
}
