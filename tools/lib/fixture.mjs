// Shared machinery for the generated fixtures: tools/make-sample-archive.mjs (a
// plausible few years of history, checked in) and tools/make-stress-archive.mjs (an
// absurd amount of it, generated on demand).
//
// The point of extracting it is that both are **played through the real scoring and
// bracket functions** rather than written out as blobs. A fixture assembled by hand can
// quietly disagree with the rules it exists to exercise; one played through `setBag`,
// `endRound` and `bracket()` cannot.
//
// Everything here is deterministic. Nothing calls Date.now() or Math.random(), so a
// checked-in fixture regenerates byte-identically and a stress run is reproducible.

import { createHash } from 'node:crypto';
import { PALETTE, newGame, setBag, endRound } from '../../src/scoring.js';
import { matchRecord } from '../../src/archive.js';
import { bracket, newTournament, shuffled } from '../../src/tournament.js';

export const DAY = 86_400_000;
export const at = (iso, hour) => new Date(`${iso}T00:00:00Z`).getTime() + hour * 3_600_000;
export const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

// mulberry32. A checked-in fixture has to regenerate byte-identically or every run shows
// up as a diff, so the randomness is seeded rather than real.
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = (r, list) => list[Math.floor(r() * list.length)];

// Stable and 32 hex characters, matching what import-legacy.mjs emits: the id is what
// makes importing idempotent, so it must not move between runs, and hashing keeps it
// clear of anything a person might type.
export const idFor = (slug) => createHash('sha256').update(slug).digest('hex').slice(0, 32);

// Two teams can never share a colour — the app's swatches enforce it, so a fixture that
// broke it would be showing something unreachable.
export function colours(r) {
  const a = Math.floor(r() * PALETTE.length);
  let b = Math.floor(r() * (PALETTE.length - 1));
  if (b >= a) b += 1;
  return { a: PALETTE[a].value, b: PALETTE[b].value };
}

export function throwBag(r, skill) {
  const n = r();
  if (n < skill.hole) return 'hole';
  if (n < skill.hole + skill.board) return 'board';
  return 'floor';
}

// One match, played bag by bag through scoring.js. Returns null if it somehow fails to
// finish — cancellation between two evenly matched sides can wash for a long time, and a
// fixture must not depend on that never happening.
export function playMatch(r, skillFor, { id, startedAt, mode, players, colors, target }) {
  let game = {
    ...newGame(target),
    id,
    startedAt,
    mode,
    players: { a: players.a.slice(), b: players.b.slice() },
    colors,
  };
  for (let n = 0; n < 40 && !game.winner; n += 1) {
    // The slot that throws this round, mirroring throwerSlot in stats.js.
    const slot = mode === 'doubles' ? game.rounds.length % 2 : 0;
    for (const team of ['a', 'b']) {
      const skill = skillFor(players[team][slot]);
      for (let bag = 0; bag < 4; bag += 1) {
        game = setBag(game, team, bag, throwBag(r, skill));
      }
    }
    game = endRound(game);
  }
  if (!game.winner) return null;
  // About a minute and a half a round, so "avg length" on the stats screen reads like a
  // game rather than a number nobody chose.
  return matchRecord(game, startedAt + game.rounds.length * 95_000);
}

// A tournament, played tie by tie through the real bracket. The ties are chosen from
// whatever `bracket()` says is playable rather than round by round, which is both how it
// actually goes — you play whoever is present — and the only way to be sure a fixture
// cannot describe a bracket the app would never produce. Nothing about the progress is
// written down: the ties are ordinary records carrying the tournament's id, and the
// bracket falls out of them.
//
// Spread over evenings a few days apart, because eleven ties is more than one evening and
// the app has to hold a tournament across weeks.
export function playTournament(r, skillFor, { id, name, mode, target, entrants, from, stopAfter = Infinity }) {
  const tournament = newTournament({
    id,
    name,
    mode,
    target,
    entrants: shuffled(entrants, r),
    createdAt: from,
  });
  const ties = [];
  const cap = entrants.length * 4 + 16;
  for (let n = 0; n < cap && ties.length < stopAfter; n += 1) {
    const view = bracket(tournament, ties);
    if (!view || view.playable.length === 0) break;
    const tie = pick(r, view.playable);
    const startedAt = from + Math.floor(ties.length / 2) * 3 * DAY + (ties.length % 2) * 5_400_000;
    const record = playMatch(r, skillFor, {
      id: idFor(`holecorn-tournament ${id} ${ties.length} ${n}`),
      startedAt,
      mode,
      players:
        mode === 'doubles'
          ? { a: tie.a.names.slice(0, 2), b: tie.b.names.slice(0, 2) }
          : { a: [tie.a.names[0], ''], b: [tie.b.names[0], ''] },
      colors: colours(r),
      target,
    });
    if (record) ties.push({ ...record, tournament: id });
  }
  return { tournament, ties };
}
