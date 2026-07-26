// External scoreboard: what gets published, and where. Pure functions plus the
// localStorage read/write for the connection settings.
//
// The scoreboard shows the *logged* score (committed rounds only), not the live
// in-round preview, so a game normally publishes one message per round. Every
// message carries the whole state rather than a delta, which is what lets a
// display that reboots or reconnects mid-game recover with no resync logic.

import { totals, teamLabel } from './scoring.js';

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
};

export function scoreboardPayload(game) {
  const t = totals(game);
  return {
    a: t.a,
    b: t.b,
    round: game.rounds.length,
    target: game.target,
    teamA: teamLabel(game, 'a'),
    teamB: teamLabel(game, 'b'),
    colorA: game.colors.a,
    colorB: game.colors.b,
    winner: game.winner,
  };
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
