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

// Its own key, separate from game state, so `New game` can't clear the history.
const STORAGE_KEY = 'holecorn.matches.v1';

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

// A record can arrive from a file the user picked, so nothing about it can be
// assumed. Require the fields stats.js reads without checking, rather than
// letting one stray file break the whole screen.
export function validRecord(m) {
  return Boolean(
    m &&
      typeof m === 'object' &&
      typeof m.id === 'string' &&
      m.id &&
      m.players &&
      Array.isArray(m.players.a) &&
      Array.isArray(m.players.b) &&
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
export function mergeMatches(records, incoming) {
  if (!Array.isArray(incoming)) return records;
  return incoming
    .filter(validRecord)
    .reduce((acc, record) => upsertMatch(acc, record), records);
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
