// Finished matches, kept so the app can report career stats. Only a completed
// match becomes a record — abandoning a game part-way leaves nothing behind,
// because a three-round fragment would drag every average around.
//
// A record is a trimmed copy of the game rather than a reference to it. It
// keeps `rounds` in exactly the game's shape, so the scoring helpers work on a
// record unchanged and `stats.js` never has to reimplement them.
//
// Storage follows the scoreboard.js split: the record and list helpers are pure
// and tested, the localStorage read/write is a thin untested wrapper.

import { nameKey } from './scoring.js';

// Its own key, separate from game state, so `New game` can't clear the history.
const STORAGE_KEY = 'holecorn.matches.v1';

const TEAMS = ['a', 'b'];

// Stamped on every record so the switch to an event log can be told apart from
// these round-level snapshots without guessing at the shape.
export const RECORD_FORMAT = 1;

// Deliberately not `crypto.randomUUID()`, which is restricted to secure
// contexts and so is undefined on a dev server reached over plain http by LAN
// IP — the way the app gets tested on a phone. `getRandomValues` carries no
// such restriction, so there is one code path rather than a fallback branch.
export function newMatchId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function matchRecord(game, endedAt) {
  return {
    format: RECORD_FORMAT,
    id: game.id,
    startedAt: game.startedAt,
    endedAt,
    mode: game.mode,
    players: { a: game.players.a.slice(), b: game.players.b.slice() },
    colors: { ...game.colors },
    target: game.target,
    winner: game.winner,
    // Absent on an ordinary game rather than null, the way `winner` is absent while
    // a game is live: `bracket` reads a missing key as "not a tie", so a record that
    // is not part of a tournament keeps exactly the shape it had before tournaments
    // existed. The id is the only thing a tie carries — where it sat in the bracket
    // is derived from its two sides.
    ...(game.tournament ? { tournament: game.tournament } : {}),
    rounds: game.rounds.map((r) => ({
      a: r.a.slice(),
      b: r.b.slice(),
      nets: { ...r.nets },
      first: r.first,
    })),
  };
}

// Replace rather than append, so the win → undo → re-win cycle can commit the
// same match repeatedly and still leave one record. The first endedAt wins:
// reopening a finished game shouldn't move when it finished.
export function upsertMatch(records, record) {
  const i = records.findIndex((m) => m.id === record.id);
  if (i === -1) return [...records, record];
  return records.map((m, n) =>
    n === i ? { ...record, endedAt: m.endedAt ?? record.endedAt } : m,
  );
}

export function removeMatch(records, id) {
  return records.filter((m) => m.id !== id);
}

// When a record was last changed after the fact. Absent means "as played",
// which is every record the app files itself. `mergeMatches` needs it to tell an
// edit from a stale copy of the same match: without it, an export taken before a
// rename silently reverts that rename when it is imported back.
function editStamp(record) {
  return Number.isFinite(record?.updatedAt) ? record.updatedAt : 0;
}

function edited(record, at) {
  return { ...record, updatedAt: at };
}

// Replace one match's lineup — the fix for a name that was already wrong when
// Start game was pressed.
//
// Attribution is positional: `throwerFor` credits a round to
// `players[team][slot]` and nothing in `rounds` names anybody, so rewriting
// these two arrays *is* the reattribution. Slot order therefore matters as much
// as spelling in doubles.
export function setMatchPlayers(records, id, players, at) {
  return records.map((m) =>
    m.id === id
      ? edited({ ...m, players: { a: players.a.slice(), b: players.b.slice() } }, at)
      : m,
  );
}

// Rename one person everywhere they appear. Folded by `nameKey`, so it also
// catches the spellings the career screen was already treating as one player,
// and renaming onto a name that already exists **merges** the two — which is
// what name-folding means, and is the way to fix a typo that invented a phantom
// player.
export function renamePlayer(records, from, to, at) {
  const key = nameKey(from);
  const name = String(to ?? '').trim();
  if (!key || !name) return records;
  return records.map((m) => {
    let hit = false;
    const players = {};
    for (const team of TEAMS) {
      players[team] = (m.players?.[team] ?? []).map((slot) => {
        if (nameKey(slot) !== key) return slot;
        hit = true;
        return name;
      });
    }
    // Only a record that actually changed is stamped, so an unrelated match
    // can't win a merge it has no claim on.
    return hit ? edited({ ...m, players }, at) : m;
  });
}

export function loadArchive() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// There is no quota API worth trusting, so a failed write is the only signal
// that the archive is full. Dropping the oldest match and retrying keeps the
// recent history rather than silently losing the game just played — which is
// what a plain try/catch would do, and it would do it every match from then on.
export function saveArchive(records) {
  for (let keep = records; ; keep = keep.slice(1)) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(keep));
      return keep;
    } catch {
      if (keep.length === 0) return [];
    }
  }
}

export function archiveMatch(game, endedAt) {
  return saveArchive(upsertMatch(loadArchive(), matchRecord(game, endedAt)));
}

export function dropMatch(id) {
  return saveArchive(removeMatch(loadArchive(), id));
}

// Put back a record that was just deleted. The counterpart to dropMatch, so the
// stats screen can offer an undo rather than making deletion final on one tap.
export function restoreMatch(record) {
  return saveArchive(upsertMatch(loadArchive(), record));
}

export function saveMatchPlayers(id, players, at) {
  return saveArchive(setMatchPlayers(loadArchive(), id, players, at));
}

export function savePlayerRename(from, to, at) {
  return saveArchive(renamePlayer(loadArchive(), from, to, at));
}

// A record can arrive from a file the user picked, so nothing about it can be
// assumed. Require the fields stats.js reads without checking, rather than
// letting one stray file break the whole screen.
//
// The *element* types matter as much as the arrays: `nameKey` coerces, so a slot
// holding a number or an object keys truthily and every name-folding read then
// trips over it. An empty slot is still a string, so singles records are unaffected.
function nameSlots(list) {
  return Array.isArray(list) && list.every((n) => typeof n === 'string');
}

export function validRecord(m) {
  return Boolean(
    m &&
      typeof m === 'object' &&
      typeof m.id === 'string' &&
      m.id &&
      m.players &&
      nameSlots(m.players.a) &&
      nameSlots(m.players.b) &&
      Array.isArray(m.rounds) &&
      m.rounds.every(
        (r) =>
          Array.isArray(r?.a) &&
          Array.isArray(r?.b) &&
          Number.isFinite(r?.nets?.a) &&
          Number.isFinite(r?.nets?.b),
      ),
  );
}

// Merge an import into what is already here. The id is the match, so
// re-importing the same file, or importing one that overlaps another device's
// history, adds nothing rather than duplicating everything.
//
// Of two copies of the same match the more recently *edited* one wins, and a tie
// keeps the local copy. Both halves matter: unedited records tie at 0, so an
// import still can't rewrite local history, while a rename made on one device
// survives being merged with a file exported from the other before it.
export function mergeMatches(records, incoming) {
  if (!Array.isArray(incoming)) return records;
  return incoming.filter(validRecord).reduce((acc, record) => {
    const mine = acc.find((m) => m.id === record.id);
    if (mine && editStamp(mine) >= editStamp(record)) return acc;
    return upsertMatch(acc, record);
  }, records);
}

// What an export file holds. It grew an envelope when tournaments arrived, because a
// bare array of matches loses every bracket while appearing to have worked — the ties
// import perfectly and belong to nothing.
export const FILE_FORMAT = 1;

export function archiveFile(matches, tournaments, inactive) {
  return { format: FILE_FORMAT, matches, tournaments, inactive };
}

function marksOrNone(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

// Reads every shape an export has ever had. A file taken before tournaments existed
// is a bare array, and one taken before players could be marked inactive has no
// `inactive` — both have to keep importing, the same merge-on-load tolerance
// `loadGame` uses rather than bumping a key and abandoning what is on people's
// phones. A missing section is the empty one, never a refusal.
export function readArchiveFile(parsed) {
  if (Array.isArray(parsed)) return { matches: parsed, tournaments: [], inactive: {} };
  if (!parsed || typeof parsed !== 'object') return null;
  const { matches, tournaments, inactive } = parsed;
  if (!Array.isArray(matches)) return null;
  return {
    matches,
    tournaments: Array.isArray(tournaments) ? tournaments : [],
    inactive: marksOrNone(inactive),
  };
}

// Matches finished since the last export. Measured against the newest end time
// exported rather than a count, so pruning the oldest can't make it go
// backwards, and it needs no clock of its own.
export function unexportedCount(records, lastExport) {
  return records.filter((m) => (m.endedAt ?? 0) > (lastExport ?? 0)).length;
}

export function newestEnd(records) {
  return records.reduce((max, m) => Math.max(max, m.endedAt ?? 0), 0);
}

const EXPORT_KEY = 'holecorn.matches.exported.v1';

export function loadLastExport() {
  try {
    const n = Number(localStorage.getItem(EXPORT_KEY));
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function saveLastExport(at) {
  try {
    localStorage.setItem(EXPORT_KEY, String(at));
  } catch {
    // an unwritable localStorage must not break the export itself
  }
}

// Ask the browser to keep the archive rather than treat it as a cache. WebKit
// decides by heuristic — chiefly whether this is running as a home-screen app —
// and never prompts, which is why the answer is worth showing and not just
// requesting: a plain Safari tab gets `false`, and ITP clears script-writable
// storage after about a week of browser use without an interaction. `null`
// means the browser wouldn't say either way.
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}
