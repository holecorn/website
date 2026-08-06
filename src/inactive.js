// Who is still in the group. Somebody who has stopped playing keeps every match and
// every number they earned — the archive is history and nothing here edits it — but
// stops being offered when a lineup or a tournament field is being filled in.
//
// **This is the app's only stored fact about a person**, and it is deliberately one
// fact. A player is otherwise a string inside match records and nothing else, so
// there is no display name here (the archive holds the spelling), no notes and no
// per-player settings. Pure helpers, with the localStorage wrapper at the foot the
// way archive.js and tournament.js split theirs.
//
// **What is stored is *when* somebody was marked, not that they are inactive.**
// Whether they count as inactive is derived: marked, and not seen playing since. So
// turning up and playing a game brings them back with nothing to remember, and the
// mark cannot come to disagree with the history sitting beside it. The alternative —
// a bare set of names, cleared when a match is filed — needs a mutation inside the
// archive effect's careful idempotency in App.jsx, and is still stale after an
// import brings in games they played on somebody else's phone.
//
// **It hides, it never refuses.** A name typed by hand is accepted exactly as
// before: this filters the suggestions, so a returning player is never locked out of
// the lineup they are standing in.

import { nameKey } from './scoring.js';
import { rosterFor } from './stats.js';

// Its own key, separate from the game, the archive and the tournaments, for the same
// reason theirs are separate: `New game` must not be able to clear it.
const STORAGE_KEY = 'holecorn.inactive.v1';

const TEAMS = ['a', 'b'];

// When each person was last seen playing. Counted over the roster the mode actually
// plays — the rule `playedIn` credits by — so a singles record's unused second slot
// cannot keep a phantom in the group.
function lastSeen(matches) {
  const seen = new Map();
  for (const match of matches ?? []) {
    const at = match?.endedAt ?? 0;
    for (const team of TEAMS) {
      if (!Array.isArray(match?.players?.[team])) continue;
      for (const name of rosterFor(match, team)) {
        const key = nameKey(name);
        if (key && at > (seen.get(key) ?? 0)) seen.set(key, at);
      }
    }
  }
  return seen;
}

// Marked, and not seen since — the derivation the whole feature rests on.
export function inactiveKeys(marks, matches) {
  const seen = lastSeen(matches);
  const out = new Set();
  for (const [key, at] of Object.entries(marks ?? {})) {
    if (Number.isFinite(at) && at > (seen.get(key) ?? 0)) out.add(key);
  }
  return out;
}

// The names still worth offering, in the order they came.
export function activeNames(names, hidden) {
  return names.filter((name) => !hidden.has(nameKey(name)));
}

// Stamped past their last match as well as by the clock. Both are `Date.now()`
// values, so a phone running slow can otherwise mark somebody with a stamp older
// than the game they have just finished — and the button then does nothing visible,
// which reads as broken rather than as a clock being wrong.
export function markInactive(marks, name, matches, at) {
  const key = nameKey(name);
  if (!key) return marks ?? {};
  const since = lastSeen(matches).get(key) ?? 0;
  return { ...marks, [key]: Math.max(at, since + 1) };
}

export function markActive(marks, name) {
  const key = nameKey(name);
  if (!key) return marks ?? {};
  return Object.fromEntries(Object.entries(marks ?? {}).filter(([k]) => k !== key));
}

// Follow a career rename, or the mark comes adrift from the person it is about and
// hides a name nobody uses any more.
//
// **On a merge the surviving name's own state stands.** Renaming a departed player
// onto somebody still playing must not retire them, and a mark being folded away has
// no claim on a career that already existed. A plain rename has no such career, so
// there the mark travels with the stamp it had rather than being restamped — the
// person stopped playing when they stopped playing, not when their name was fixed.
export function renameMark(marks, from, to, merges) {
  const fromKey = nameKey(from);
  const toKey = nameKey(to);
  if (!fromKey || !toKey || fromKey === toKey) return marks ?? {};
  const was = (marks ?? {})[fromKey];
  const rest = markActive(marks, from);
  if (merges || !Number.isFinite(was)) return rest;
  return { ...rest, [toKey]: was };
}

// Merge an import. The newer mark wins, the rule `mergeMatches` settles an edited
// record by: another device may have retired somebody since this file was written.
//
// **Making somebody active again does not propagate**, because it is the *absence*
// of a mark and an absence cannot outrank one — re-importing an old file brings the
// mark back. Exactly the limit a deleted match already has, and for the same reason:
// an export is a snapshot rather than a log.
export function mergeInactive(mine, incoming) {
  const out = { ...(mine ?? {}) };
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return out;
  for (const [key, at] of Object.entries(incoming)) {
    if (!key || !Number.isFinite(at)) continue;
    if (at > (out[key] ?? 0)) out[key] = at;
  }
  return out;
}

export function loadInactive() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// What is in storage now, and whether this write got through — the shape
// `saveArchive` and `saveTournaments` return. It used to swallow the error and
// hand the marks back regardless, so the caller set React state from a write that
// never happened and the person stayed hidden until the next reload brought them
// back. Nothing deletes to make room: this is a handful of keys against a match's
// rounds, so a write that fails has not run out of room for *this*.
export function saveInactive(marks) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(marks));
    return { saved: true, stored: marks };
  } catch {
    return { saved: false, stored: loadInactive() };
  }
}
