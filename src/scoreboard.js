// External scoreboard: what gets published, and where. Pure functions plus the
// localStorage read/write for the connection settings.
//
// The scoreboard shows the *logged* score (committed rounds only), not the live
// in-round preview, so a game normally publishes one message per round. Every
// message carries the whole state rather than a delta, which is what lets a
// display that reboots or reconnects mid-game recover with no resync logic.

import { gameStarted, totals, teamLabel } from './scoring.js';
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

// A link that opens the display view already configured, so the tablet acting
// as the scoreboard never has to have the broker details typed into it.
export function displayUrl(origin, config) {
  const params = new URLSearchParams({ display: '1', code: normalizeCode(config.code) });
  if (config.broker) params.set('broker', config.broker);
  if (config.username) params.set('user', config.username);
  if (config.password) params.set('pass', config.password);
  return `${origin}/?${params}`;
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
