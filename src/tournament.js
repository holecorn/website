// The knockout bracket. Pure and framework-free like scoring.js and stats.js, with
// the localStorage wrapper at the foot of the file the way archive.js splits it.
//
// **The bracket's progress is never stored.** A tournament holds only what cannot be
// derived — its entrants, in the order they came out of the hat — and everything else
// (who is through, who is out, which round a tie belongs to, which ties can be played
// now, who won) is computed from that draw plus the archived matches tagged with the
// tournament's id. So undoing a winning round un-archives the tie and the bracket
// recomputes with nothing to un-advance, and a bracket can never disagree with the
// results behind it. See docs/TOURNAMENT.md for the alternatives this rules out.

import { NO_SIDE, nameKey, sideKeyOf, sideLabel } from './scoring.js';
import { blankStats, finalScore, rosterFor, sideStats } from './stats.js';

// Stamped on every tournament so a later change of shape can be told from this one
// without guessing, the way RECORD_FORMAT does for a match.
export const TOURNAMENT_FORMAT = 1;

// Its own key, separate from both the game and the archive, so `New game` cannot
// clear it and a tournament outlives the ties played in it. The archive and the
// scoreboard settings are split the same way.
const STORAGE_KEY = 'holecorn.tournaments.v1';

// Below two entrants there is no tie to play, so there is no tournament.
export const MIN_ENTRANTS = 2;

// The largest power of two at or below n — the size of the bracket proper, with
// anything above it played off in preliminaries.
function bracketSize(n) {
  let p = 1;
  while (p * 2 <= n) p *= 2;
  return p;
}

// How many entrants enter at each seat of the bracket proper: 1 for a bye, 2 for a
// preliminary tie played off into that seat.
//
// **Which seats get the preliminaries is a free choice, and that is worth knowing
// before changing it.** Kraft equality fixes the depths — for n = 11, exactly six
// entrants must win four ties and five must win three, in every possible arrangement
// — so no layout is fairer than another and the draw is random anyway. This one
// alternates halves, top down, because that reproduces the bracket the family has
// always drawn on paper: for 11 it puts preliminaries at seats 1, 2 and 5, which is
// the Hole Corn V sheet exactly.
export function bracketShape(n) {
  const size = bracketSize(n);
  const seats = new Array(size).fill(1);
  const half = size / 2;
  const next = [0, half];
  for (let i = 0; i < n - size; i += 1) {
    const side = i % 2;
    seats[next[side]] = 2;
    next[side] += 1;
  }
  return { size, seats, rounds: Math.log2(size) + (n > size ? 1 : 0) };
}

// A tie's round, counted so that the final is 1 — which is also how many ties its
// winner still has to win, including this one.
export function roundName(level) {
  if (level === 1) return 'Final';
  if (level === 2) return 'Semi-final';
  if (level === 3) return 'Quarter-final';
  return `Round of ${2 ** level}`;
}

// The deepest level is the preliminary only when the field is not a power of two;
// otherwise it is an ordinary round of the bracket.
export function levelName(level, shape) {
  return level === shape.rounds && shape.rounds > Math.log2(shape.size)
    ? 'Preliminary'
    : roundName(level);
}

// Fisher-Yates, with the source of randomness injected so the draw is reproducible
// under test — the same reason `openScoreboardLink` takes a `connect`. Production
// passes nothing and gets Math.random.
export function shuffled(items, random = Math.random) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// A side is one entrant: one name in singles, two in doubles, held as typed so the
// bracket can show it, and identified by `sideKeyOf` so slot order never matters.
function asSide(names) {
  const list = (Array.isArray(names) ? names : [names]).map((n) => String(n ?? '').trim());
  return { names: list, key: sideKeyOf(list) };
}

// Why this field cannot be drawn, one entry per entrant at fault. The same rules
// `lineupFaults` applies to a lineup, and they have to be the same or the draw succeeds
// and produces a tie that can never be started: `Start` is disabled on exactly these,
// so a bracket holding one is a bracket with a tie nobody can play.
//
//   'blank' — **every** slot of a side must be named, not just one of them. A doubles
//     pair with one half empty is a side of one person who would play two, and it is
//     `lineupFaults` that would eventually refuse it, long after the draw.
//   'twice' — one person in two seats is one person on both sides of the bracket, where
//     `playerStats` folds a win and a loss for the same tie into one career. A pair that
//     is the same person twice is the same fault turned inward: they are their own
//     partner. `sideKeyOf` dedupes, so that one has to be counted rather than keyed.
export function entrantFaults(entrants) {
  const sides = entrants.map((names) => {
    const side = asSide(names);
    return { ...side, people: new Set(side.names.map(nameKey).filter(Boolean)).size };
  });
  const counts = new Map();
  for (const { key } of sides) {
    if (key !== NO_SIDE) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const faultOf = ({ names, key, people }) => {
    if (names.some((n) => !n)) return 'blank';
    if (people < names.length || counts.get(key) > 1) return 'twice';
    return null;
  };
  return sides
    .map((side, index) => ({ index, names: side.names, fault: faultOf(side) }))
    .filter(({ fault }) => fault);
}

export function newTournament({ id, name, mode, target, entrants, createdAt }) {
  return {
    format: TOURNAMENT_FORMAT,
    id,
    name,
    createdAt,
    mode,
    target,
    // In draw order, which is the whole of the stored draw: the seats they fall into
    // follow from `bracketShape`, so there are no pairings or byes to keep as well.
    entrants: entrants.map((e) => asSide(e).names),
  };
}

// The draw as it comes out of the hat: one step per entrant, in pull order, saying where
// that name landed and who it will meet. What the ceremony reads, and what the board is
// told — see docs/TOURNAMENT.md.
//
// A step is derived from the stored draw and nothing else, so the ceremony is a **view**
// over a tournament that is already saved whole. That is what makes it reload-safe with
// no partial-draw state anywhere, and it is why nothing here is stored.
//
// `opponents` is what the card says, and it has exactly three lengths:
//
//   0 — nobody yet. Either the first name into a preliminary, or a bye whose sibling seat
//       is still in the hat. **It always resolves on the very next pull**, because
//       `bracketShape` puts the preliminaries at a prefix of each half, so a bye at an
//       even seat is always followed by a bye at its sibling.
//   1 — a person. Either the second name into a preliminary, or a bye meeting a bye.
//   2 — the two sides of a preliminary already drawn, which the entrant meets the winner
//       of. The one thing a paper draw says that a finished bracket cannot.
//
// The last seat index is odd for every bracket size, so its sibling is always already out
// — **a draw always ends on a completed pairing** rather than trailing off into byes.
export function drawSteps(tournament) {
  const sides = (tournament?.entrants ?? []).map(asSide);
  if (sides.length < MIN_ENTRANTS) return [];
  const shape = bracketShape(sides.length);
  const seats = seatSides(sides, shape);
  // A seat's own tie sits one level above the seats; a preliminary is played off below it.
  // The two coincide for a power-of-two field, which is also the field with no
  // preliminaries, so they never disagree — and `levelName` is what tells the deepest
  // round of a ragged field from an ordinary one.
  const seatLevel = Math.log2(shape.size);
  const steps = [];
  const step = (side, level, opponents) =>
    steps.push({ side, level, round: levelName(level, shape), opponents });

  seats.forEach((seat, index) => {
    if (seat.length === 2) {
      step(seat[0], shape.rounds, []);
      step(seat[1], shape.rounds, [seat[0]]);
      return;
    }
    // The sibling is drawn already only when it sits at the lower index, which is what
    // makes an even seat the one with nobody to name yet.
    const sibling = index ^ 1;
    step(seat[0], seatLevel, sibling < index ? seats[sibling] : []);
  });
  return steps;
}

// A tournament whose sheet is gone, held as its result and nothing else — see
// `storedResult`. There is no way to make one in the app, deliberately: it is a
// transcription of something that happened before it, so it arrives from a file the way
// a match with no rounds does, and nothing here can be played.
//
// `createdAt` is the day it was won rather than the day it was drawn, because that is the
// one date such a tournament has and it is what both lists sort on. The row says `Won` for
// it rather than `Drawn`, so nothing on screen claims a draw that was never taken.
export function recordedTournament({ id, name, createdAt, champion, runnerUp }) {
  return {
    format: TOURNAMENT_FORMAT,
    id,
    name,
    createdAt,
    champion: asSide(champion).names,
    // Absent rather than null when it is not known, the way a record leaves out `winner`
    // while a game is live — the readers all take a missing key as "not known".
    ...(runnerUp ? { runnerUp: asSide(runnerUp).names } : {}),
  };
}

// Which archived match, if any, was this tie. Nothing on a record says where in a
// bracket it sat — the two sides say it, because a knockout lets two sides meet at
// most once, so within one tournament a pair of sides identifies exactly one tie.
function matchBetween(matches, tournamentId, keyA, keyB) {
  for (const match of matches) {
    if (match.tournament !== tournamentId || !match.winner) continue;
    const a = sideKeyOf(rosterFor(match, 'a'));
    const b = sideKeyOf(rosterFor(match, 'b'));
    if ((a === keyA && b === keyB) || (a === keyB && b === keyA)) return match;
  }
  return null;
}

// Which entrants fall into each seat of the bracket proper, in draw order: one for a
// bye, two for a preliminary played off into that seat.
//
// **This walk is the whole reason a name-at-a-time draw needs no new stored state.**
// The array order *is* the seating, so pulling a name and writing it in the next slot
// on the sheet produces exactly the array `newTournament` already stores. `build` and
// `drawSteps` share it rather than each having a copy — two spellings of where an
// entrant sits would let the ceremony announce a pairing the bracket never draws, with
// nothing on either screen to say so.
function seatSides(sides, shape) {
  const seats = [];
  let taken = 0;
  for (const seatSize of shape.seats) {
    seats.push(seatSize === 2 ? [sides[taken++], sides[taken++]] : [sides[taken++]]);
  }
  return seats;
}

// The bracket as a tree. A node either *seats* an entrant, or is a *tie* whose two
// children feed it; either way `side` is who comes out of it, and null on a tie means
// it has not been decided yet.
//
// Ids are positional and derived, never stored — the shape is a function of the field
// size, so they are stable across recomputation without being written down.
function build(sides, shape) {
  let level = seatSides(sides, shape).map((seat) =>
    seat.length === 1
      ? { kind: 'seat', side: seat[0] }
      : { kind: 'tie', children: seat.map((side) => ({ kind: 'seat', side })) },
  );
  while (level.length > 1) {
    const up = [];
    for (let i = 0; i < level.length; i += 2) {
      up.push({ kind: 'tie', children: [level[i], level[i + 1]] });
    }
    level = up;
  }
  return level[0];
}

// Walk the tree bottom-up, resolving each tie against the archive. `level` counts up
// from the final so it can be named, and `half` is which side of the page a tie is
// drawn on, for a bracket that reads like the paper one — null at the final, which
// belongs to neither, and inherited from the root's two children below that.
//
// Post-order, so `out` comes back deepest-first and left-to-right within each level.
//
// Returns `{ side, from }` rather than just the side: `from` is the id of the tie the
// side came out of, so a seat that is still waiting can be drawn as the tie that will
// fill it rather than as a dash. Knowing what you are waiting for is most of what a
// bracket is for.
function resolve(node, matches, tournamentId, level, half, out) {
  if (node.kind === 'seat') return { side: node.side ?? null, from: null };
  const childHalf = (i) => (half === null ? i : half);
  const left = resolve(node.children[0], matches, tournamentId, level + 1, childHalf(0), out);
  const right = resolve(node.children[1], matches, tournamentId, level + 1, childHalf(1), out);
  const { side: a } = left;
  const { side: b } = right;
  const known = Boolean(a && b && a.key !== NO_SIDE && b.key !== NO_SIDE);
  const match = known ? matchBetween(matches, tournamentId, a.key, b.key) : null;
  const winner = match
    ? [a, b].find((side) => side.key === sideKeyOf(rosterFor(match, match.winner))) ?? null
    : null;
  // Oriented to this tie's two sides rather than to the record's team letters, which
  // are an accident of which side happened to be entered as A when the tie was
  // started. Null for an imported result with no score, the way `finalScore` is.
  const played = match ? finalScore(match) : null;
  const score =
    played && sideKeyOf(rosterFor(match, 'a')) === a.key
      ? played
      : played && { a: played.b, b: played.a };
  const tie = {
    id: `${level}.${out.filter((t) => t.level === level).length}`,
    level,
    half,
    a,
    b,
    fromA: left.from,
    fromB: right.from,
    match: match ? match.id : null,
    score: score ?? null,
    winner,
    // Playable is derived, not queued: both sides known and not yet played. Several
    // are usually playable at once, and a structurally later tie routinely goes first
    // — which is why there is no "next tie" anywhere in here.
    playable: known && !match,
  };
  out.push(tie);
  return { side: winner, from: tie.id };
}

// The result `recordedTournament` stored, read back. Stored at all for exactly the reason
// a record with no rounds carries `final`: it is the one thing about such a tournament that
// has nowhere else to live.
//
// **Only where there is no draw**, which is stricter than "no ties played". A field with
// no draw behind it would be shuffled into pairings nobody played and then captioned with
// the real winner — a bracket that is wrong in a way only the people who were there could
// see. So a result is recorded *instead of* a field, not alongside one; a tournament
// carrying both is an ordinary bracket and this is ignored.
function storedResult(tournament) {
  const side = (names) => {
    const s = names ? asSide(names) : null;
    return s && s.key !== NO_SIDE ? s : null;
  };
  const champion = side(tournament?.champion);
  return champion ? { champion, runnerUp: side(tournament.runnerUp) } : null;
}

// Everything the screens need, derived from the stored draw plus the archive.
export function bracket(tournament, matches = []) {
  const sides = (tournament?.entrants ?? []).map(asSide);
  if (sides.length < MIN_ENTRANTS) {
    const result = storedResult(tournament);
    // `recorded` is what the screen keys off to draw the row without a bracket behind it.
    // Every other field is present and empty rather than absent, so a caller reading
    // `ties` or `played` needs no guard of its own.
    if (!result) return null;
    return {
      shape: null,
      entrants: [],
      ties: [],
      rounds: [],
      playable: [],
      ...result,
      played: 0,
      total: 0,
      done: true,
      recorded: true,
    };
  }
  const shape = bracketShape(sides.length);
  const root = build(sides, shape);
  const ties = [];
  const { side: champion } = resolve(root, matches, tournament.id, 1, null, ties);
  const played = ties.filter((t) => t.match).length;
  // Whoever lost the final, which is the one place in a knockout where losing a tie is
  // worth naming. Derived here rather than on the screen for the reason `champion` is:
  // this file answers every question about the bracket and `Tournament.jsx` draws.
  const final = ties.find((t) => t.level === 1);
  const runnerUp =
    (final?.winner && [final.a, final.b].find((s) => s && s.key !== final.winner.key)) || null;
  return {
    shape,
    entrants: sides,
    ties,
    // Deepest first, so a rendered bracket reads left to right the way a drawn one does.
    rounds: Array.from({ length: shape.rounds }, (_, i) => shape.rounds - i).map((level) => ({
      level,
      name: levelName(level, shape),
      ties: ties.filter((t) => t.level === level),
    })),
    playable: ties.filter((t) => t.playable),
    champion,
    runnerUp,
    played,
    total: sides.length - 1,
    done: Boolean(champion),
    recorded: false,
  };
}

// The game a tie is played as: the two sides in their bracket order, the mode and
// target the tournament was created with, and the id that `matchRecord` stamps onto
// the record so the bracket can find it again.
//
// The unused singles slot is left empty rather than defaulted, for the reason
// `import-legacy.mjs` leaves it empty: `participants` drops a blank, where a default
// name would collect every opponent under one phantom player.
export function tieSetup(tournament, tie) {
  const slots = (side) =>
    tournament.mode === 'doubles'
      ? [side.names[0] ?? '', side.names[1] ?? '']
      : [side.names[0] ?? '', ''];
  return {
    mode: tournament.mode,
    target: tournament.target,
    players: { a: slots(tie.a), b: slots(tie.b) },
    tournament: tournament.id,
    // A tie is a recorded game by definition, so it can never be a guest game.
    casual: false,
  };
}

// The bracket as a nested tree for drawing, rather than the flat list.
//
// **Every node here has exactly two children until the deepest level, which is what
// makes a drawn bracket possible in plain CSS.** The raggedness of an uneven field
// lives entirely in the deepest column: a seat there is either a preliminary tie (a
// box with two names) or a single entrant who took a bye (a box with one). Above that
// the tree is a perfect binary tree, so every parent sits exactly between its two
// children and the connectors need no measuring.
//
// A deepest-level tie has no children because its box already shows both entrants —
// drawing them again below it would say the same thing twice.
//
// The root is the final, and the columns fall out of drawing each node as
// [children][itself]: the deepest level lands on the left and the final on the right.
export function bracketTree(view) {
  if (!view) return null;
  const byId = new Map(view.ties.map((t) => [t.id, t]));
  const deepest = view.shape.rounds;
  const node = (tie) => ({
    tie,
    kids:
      tie.level === deepest
        ? []
        : [
            tie.fromA ? node(byId.get(tie.fromA)) : { seat: tie.a },
            tie.fromB ? node(byId.get(tie.fromB)) : { seat: tie.b },
          ],
  });
  const final = view.ties.find((t) => t.level === 1);
  return final ? node(final) : null;
}

// The second lens on a bracket: not who is through, but how it has gone. Everything
// below reads the view `bracket()` already built rather than the archive directly, so
// the numbers and the drawing can only ever be describing the same ties.

// Which archived records are this bracket's ties. Read off the bracket's own ties rather
// than by filtering on the tournament id, for the reason `lastPlayed` does: these numbers
// sit beside `X of Y ties`, and a record carrying the id that the bracket could not place
// would make the two disagree with nothing on screen to say so.
export function tieMatches(view, matches) {
  const ids = new Set((view?.ties ?? []).map((t) => t.match).filter(Boolean));
  return matches.filter((m) => ids.has(m.id));
}

// Every tie a side appears in, deepest first — which is also the order they were played
// in, because a side must win its deeper tie before it can play its shallower one. That
// is the same property the backward walk in docs/TOURNAMENT.md rests on.
export function routeFor(view, key) {
  if (!view || !key) return [];
  return view.ties
    .filter((t) => t.a?.key === key || t.b?.key === key)
    .sort((x, y) => y.level - x.level);
}

// How far an entrant got, as a state and a level rather than a round name. Three states
// and not two, because **out at the semi-final and still in the semi-final are the same
// round and opposite answers** — a level alone cannot tell them apart, and the screen
// needs to say "Semi-final" for one and "In the semi-final" for the other.
export function reachedBy(view, key) {
  if (view?.champion?.key === key) return { status: 'won', level: 1 };
  const route = routeFor(view, key);
  const lost = route.find((t) => t.winner && t.winner.key !== key);
  if (lost) return { status: 'out', level: lost.level };
  // Still in it, so their next tie is the one place in the bracket they hold that has
  // not been played. There can only be one: they are seated in exactly one tie per
  // level, and everything below the unplayed one they have already won.
  const waiting = route.find((t) => !t.match) ?? null;
  return { status: 'in', level: waiting ? waiting.level : null };
}

// How far each got, then — at the same round — the champion, then whoever is still alive
// there, then whoever went out. The status is what separates the champion from the runner
// up, who are both at level 1: giving `won` a depth of its own was tried and is dead code,
// because `reachedBy` only ever returns level 1 with it. Verified by mutation.
const ROUTE_END = { won: 0, in: 1, out: 2 };
const depthOf = (reached) => reached.level ?? Infinity;

// One row per entrant: how far they got, and what the ties they played say about them.
//
// The rows are the **draw's** sides, not the sides the archive happens to hold, so an
// entrant who has not played yet still has a place in the table and the names read in
// the order they were drawn. `played` distinguishes that from a genuine zero, the same
// flag `lineupStats` uses for a first-timer.
export function entrantStats(view, matches) {
  if (!view) return [];
  const rows = new Map(sideStats(tieMatches(view, matches)).map((s) => [s.key, s]));
  return view.entrants
    .map((side) => {
      const found = rows.get(side.key);
      return {
        ...(found ?? blankStats(sideLabel(side.names))),
        key: side.key,
        names: side.names,
        played: Boolean(found),
        reached: reachedBy(view, side.key),
      };
    })
    .sort(
      (x, y) =>
        depthOf(x.reached) - depthOf(y.reached) ||
        ROUTE_END[x.reached.status] - ROUTE_END[y.reached.status] ||
        y.wins - x.wins ||
        sideLabel(x.names).localeCompare(sideLabel(y.names)),
    );
}

// The widest and the narrowest margin among the ties played.
//
// Both read `tie.score`, which `bracket` takes from `finalScore` — so **a result imported
// without round detail still counts**, and that is the point of having them: a tagged
// legacy tournament has no rounds anywhere in it, so every rate on the screen is a dash
// and these two are the only thing the table can say about how the games went.
//
// `closest` is null where it would name the same tie as `widest` — one tie played, or
// every tie won by the same margin. Two headings over one result says the opposite of
// what either of them means.
export function tieExtremes(view) {
  const played = (view?.ties ?? []).filter((t) => t.winner && t.score);
  if (played.length === 0) return null;
  const margin = (t) => Math.abs(t.score.a - t.score.b);
  const widest = played.reduce((best, t) => (margin(t) > margin(best) ? t : best));
  const closest = played.reduce((best, t) => (margin(t) < margin(best) ? t : best));
  return {
    widest: { tie: widest, margin: margin(widest) },
    closest: closest === widest ? null : { tie: closest, margin: margin(closest) },
  };
}

// The ties that have been played, newest first — which is the one thing the drawn
// bracket structurally cannot show. It is grouped by round, and a knockout is played
// opportunistically: whoever is present, so a later round routinely goes before an
// earlier one elsewhere in the draw.
export function tieHistory(view, matches) {
  if (!view) return [];
  const when = new Map(matches.map((m) => [m.id, m.endedAt]));
  return view.ties
    .filter((t) => t.match)
    .map((t) => ({
      tie: t,
      round: levelName(t.level, view.shape),
      endedAt: when.get(t.match) ?? null,
    }))
    .sort((x, y) => (y.endedAt ?? 0) - (x.endedAt ?? 0));
}

// Which tournament tie each archived match was, keyed by the match's id.
//
// Nothing on a record says which tie it was — the bracket works that out from the two sides
// — so this is the only way round for a screen that has a *match* and wants its tournament.
// One bracket per tournament rather than one per match, which is what keeps a list of a
// hundred matches from computing a hundred brackets.
export function tieLabels(tournaments, matches) {
  const out = new Map();
  for (const t of tournaments ?? []) {
    const view = bracket(t, matches);
    if (!view) continue;
    for (const tie of view.ties) {
      if (tie.match) out.set(tie.match, { name: t.name, round: levelName(tie.level, view.shape) });
    }
  }
  return out;
}

// Which tie of a bracket a game is — the live counterpart of `matchBetween`, and
// deliberately the same rule: the two sides say which tie it is, so a game and the
// record it becomes identify the same one and the screen cannot name a different
// round from the bracket.
export function tieFor(view, game) {
  if (!view || !game) return null;
  const a = sideKeyOf(rosterFor(game, 'a'));
  const b = sideKeyOf(rosterFor(game, 'b'));
  return (
    view.ties.find(
      (t) => t.a && t.b && ((t.a.key === a && t.b.key === b) || (t.a.key === b && t.b.key === a)),
    ) ?? null
  );
}

// When a tournament was last played, or null if nothing in it has been. For a finished one
// that is also when it was won, because the final is the last tie there is.
//
// Read off the bracket's own ties rather than off every record carrying the id, so the date
// and the `X of Y ties` beside it on the same row are counting the same ties and cannot
// disagree. A record with no `endedAt` — the shape an imported result can take — contributes
// nothing rather than a zero, which would otherwise date a tournament to 1970.
export function lastPlayed(view, matches) {
  if (!view) return null;
  const played = new Set(view.ties.map((t) => t.match).filter(Boolean));
  const stamps = matches
    .filter((m) => played.has(m.id))
    .map((m) => m.endedAt)
    .filter((ms) => ms > 0);
  return stamps.length > 0 ? Math.max(...stamps) : null;
}

// Newest first — the draw for a bracket, the day it was won for a recorded result, which
// is why `createdAt` carries both. The lists used to render in the order the list happened to hold,
// which is insertion order — locally drawn ones oldest first, imported ones appended
// after every local one whatever their draw date. So the order recorded how a device
// came by its tournaments rather than anything about them, two devices holding the same
// data could disagree, and the one you had just drawn sat at the bottom.
//
// Sorting on `createdAt` makes it a property of the data, the same reason `mergeMatches`
// settles a clash on `updatedAt` rather than on which copy arrived first. A tournament
// from before the field existed, or from a hand-edited file, has none — it sorts last
// rather than first, and `sort` is stable, so those keep the order they were in.
export function newestFirst(tournaments) {
  return [...tournaments].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

// Tournaments with no champion yet. What the setup screen announces, because the
// next session may be a fortnight after the last one and nobody will remember.
export function unfinished(tournaments, matches) {
  return tournaments.filter((t) => !bracket(t, matches)?.done);
}

function hasField(t) {
  return Boolean(
    Array.isArray(t?.entrants) &&
      t.entrants.length >= MIN_ENTRANTS &&
      t.entrants.every((e) => Array.isArray(e)),
  );
}

// A tournament can arrive from a file the user picked, so require the fields the
// bracket reads without checking. `entrants` is what the whole derivation rests on;
// a tournament without a usable field is not repairable, unlike a match.
//
// Or a stored result and no field at all — the shape `storedResult` describes. That is
// the one thing `mergeTournaments` would otherwise drop **silently**, which is the same
// half-import trap `validRecord` and the sample archive already guard against.
export function validTournament(t) {
  return Boolean(
    t &&
      typeof t === 'object' &&
      typeof t.id === 'string' &&
      t.id &&
      (hasField(t) || storedResult(t)),
  );
}

export function upsertTournament(list, t) {
  const i = list.findIndex((x) => x.id === t.id);
  return i === -1 ? [...list, t] : list.map((x, n) => (n === i ? t : x));
}

export function removeTournament(list, id) {
  return list.filter((t) => t.id !== id);
}

// The local copy wins, unlike `mergeMatches`, and for a reason that does not apply
// there: a tournament is fixed the moment it is drawn, so two copies of one id are
// the same draw and there is nothing an incoming copy could be more right about.
// Deleting still does not propagate, the same known limit the archive has.
//
// **A draw is the one thing that can be more right**, because a stored result is what you
// keep when there is no draw — so an incoming field replaces a local result-only copy and
// never the other way round. Without that the upgrade path is silent rather than merely
// manual: a tournament's id is its name, so a sheet turning up years later and being
// transcribed produces the same id, the local result-only copy holds, and the ties import
// tagged with an id whose tournament has no bracket to place them in.
export function mergeTournaments(list, incoming) {
  if (!Array.isArray(incoming)) return list;
  return incoming.filter(validTournament).reduce((acc, t) => {
    const mine = acc.find((x) => x.id === t.id);
    if (mine && !(hasField(t) && !hasField(mine))) return acc;
    return upsertTournament(acc, t);
  }, list);
}

export function loadTournaments() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// No drop-the-oldest retry, unlike `saveArchive`: a tournament is a few hundred bytes
// against a match's rounds, and losing an old bracket to make room for a new one
// would take its ties' meaning with it while leaving them in the archive.
export function saveTournaments(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    return list;
  }
  return list;
}

export function saveTournament(t) {
  return saveTournaments(upsertTournament(loadTournaments(), t));
}

export function dropTournament(id) {
  return saveTournaments(removeTournament(loadTournaments(), id));
}
