// Career stats over archived matches. Pure like scoring.js — no storage, no
// React — so the numbers are as testable as the rules that produce them.
//
// Everything here is derived from `rounds`, which already holds every bag's
// resting tier. Nothing extra had to be recorded to get these; the app was
// simply throwing the data away at `New game`.

import { BAGS_PER_SIDE, rawPoints, tierCounts, totals } from './scoring.js';

const TEAMS = ['a', 'b'];

// Which player slot threw in a given round. Singles always uses the first slot;
// doubles alternates partners every round, mirroring `activeIdx` in App.jsx and
// `throwingEnd` in scoring.js. Get this wrong and every doubles stat is silently
// mis-credited, so it is defined once and read by everything here.
export function throwerSlot(match, roundIndex) {
  return match.mode === 'doubles' ? roundIndex % 2 : 0;
}

export function throwerFor(match, roundIndex, team) {
  return match.players[team][throwerSlot(match, roundIndex)];
}

export function rosterFor(match, team) {
  return match.mode === 'doubles'
    ? match.players[team]
    : [match.players[team][0]];
}

// Players are identified by name — it is all the app records. Case and padding
// are folded so "neil" and "Neil " are one person. Unnamed slots are dropped
// rather than collected under a blank heading.
function nameKey(name) {
  return String(name ?? '').trim().toLowerCase();
}

// Deduplicated, because two slots on one team can carry the same name — the
// default second player is the obvious case — and that must not count as two
// people playing two matches.
function participants(match, team) {
  const seen = new Set();
  const out = [];
  for (const name of rosterFor(match, team)) {
    const key = nameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, name: name.trim() });
  }
  return out;
}

function ratio(n, d) {
  return d > 0 ? n / d : 0;
}

function trailingWins(results) {
  let n = 0;
  for (let i = results.length - 1; i >= 0 && results[i]; i -= 1) n += 1;
  return n;
}

function longestWins(results) {
  let best = 0;
  let run = 0;
  for (const won of results) {
    run = won ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

// The counters a thrown bag moves. Separate from the match-level ones, because
// an unfinished game has these and no result.
function blankThrows(name) {
  return {
    name,
    rounds: 0,
    bags: 0,
    hole: 0,
    board: 0,
    floor: 0,
    rawPoints: 0,
    netPoints: 0,
    fourBaggers: 0,
    bestRound: 0,
  };
}

function blank(name) {
  return { ...blankThrows(name), matches: 0, wins: 0, losses: 0, results: [] };
}

// Fold one round of one team's bags into a player accumulator. Shared so a live
// game and a finished match can't count the same throw differently.
function foldRound(p, round, team) {
  const counts = tierCounts(round[team]);
  const raw = rawPoints(round[team]);
  p.rounds += 1;
  p.hole += counts.hole;
  p.board += counts.board;
  p.floor += counts.floor;
  // Bags actually thrown. A round committed with bags still unthrown is
  // unreachable through the UI, but counting them would quietly deflate every
  // rate rather than failing.
  p.bags += counts.hole + counts.board + counts.floor;
  p.rawPoints += raw;
  p.netPoints += round.nets[team];
  if (counts.hole === BAGS_PER_SIDE) p.fourBaggers += 1;
  if (raw > p.bestRound) p.bestRound = raw;
}

// The rates that need only thrown bags, so they mean the same thing mid-game as
// they do over a career.
function deriveRates(p) {
  return {
    holePct: ratio(p.hole, p.bags),
    boardPct: ratio(p.board, p.bags),
    floorPct: ratio(p.floor, p.bags),
    // On the board or in it — the rate that tracks "did the bag do anything".
    inPlayPct: ratio(p.hole + p.board, p.bags),
    // PPR is the cornhole standard: raw bag points per round, counted before
    // cancellation. netPpr is what actually reached the scoreboard, and the gap
    // between the two is a measure of who you have been playing.
    ppr: ratio(p.rawPoints, p.rounds),
    netPpr: ratio(p.netPoints, p.rounds),
  };
}

function derive({ results, ...p }) {
  return {
    ...p,
    ...deriveRates(p),
    winPct: ratio(p.wins, p.matches),
    currentStreak: trailingWins(results),
    longestStreak: longestWins(results),
  };
}

function chronological(matches) {
  return [...matches].sort((x, y) => (x.endedAt ?? 0) - (y.endedAt ?? 0));
}

export function playerStats(matches) {
  const acc = new Map();
  // Chronological so streaks read in play order and the display name settles on
  // the most recent spelling.
  for (const match of chronological(matches)) {
    const at = (name) => {
      const key = nameKey(name);
      if (!key) return null;
      const found = acc.get(key);
      if (found) {
        found.name = name.trim();
        return found;
      }
      const made = blank(name.trim());
      acc.set(key, made);
      return made;
    };

    const played = new Set();
    for (const team of TEAMS) {
      for (const { key, name } of participants(match, team)) {
        if (played.has(key)) continue;
        played.add(key);
        const p = at(name);
        p.matches += 1;
        const won = match.winner === team;
        p[won ? 'wins' : 'losses'] += 1;
        p.results.push(won);
      }

      match.rounds.forEach((round, i) => {
        const p = at(throwerFor(match, i, team));
        if (p) foldRound(p, round, team);
      });
    }
  }

  return [...acc.values()]
    .map(derive)
    .sort((x, y) => y.wins - x.wins || y.ppr - x.ppr || x.name.localeCompare(y.name));
}

// Win counts between every pair who have faced each other. Doubles credits both
// partners, so this reads as "was on the winning side", not "out-threw them".
export function headToHead(matches) {
  const pairs = new Map();
  for (const match of chronological(matches)) {
    if (!match.winner) continue;
    for (const left of participants(match, 'a')) {
      for (const right of participants(match, 'b')) {
        if (left.key === right.key) continue;
        const flip = right.key < left.key;
        const lo = flip ? right : left;
        const hi = flip ? left : right;
        // JSON rather than a separator character: any delimiter could also
        // appear inside a name, making "a|b" collide with "a" and "b".
        const id = JSON.stringify([lo.key, hi.key]);
        const entry = pairs.get(id) ?? { a: lo.name, b: hi.name, aWins: 0, bWins: 0 };
        entry.a = lo.name;
        entry.b = hi.name;
        const loWon = match.winner === (flip ? 'b' : 'a');
        entry[loWon ? 'aWins' : 'bWins'] += 1;
        pairs.set(id, entry);
      }
    }
  }
  return [...pairs.values()].sort(
    (x, y) => y.aWins + y.bWins - (x.aWins + x.bWins) || x.a.localeCompare(y.a),
  );
}

// How long a match took, or null if it can't be known. Both stamps are
// required: a match archived before `startedAt` existed — a game already in
// play when the field shipped never passes through Start game — would otherwise
// measure from the epoch and report a duration in decades, which is wrong
// quietly rather than loudly.
export function matchDuration(match) {
  const from = match?.startedAt;
  const to = match?.endedAt;
  // `from > 0` matters as much as the finite check: these are Date.now()
  // stamps, so a zero start is not "1970", it is a record that never had one,
  // and subtracting it measures the age of the epoch instead of the match.
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0) return null;
  return to > from ? to - from : null;
}

// A finished match read back round by round. The running score is the part the
// in-play history can't show — there it is always just the current total — and
// it's what makes a match legible afterwards: whether it was close, where it
// turned, which round the four-bagger landed in.
export function matchRounds(match) {
  const running = { a: 0, b: 0 };
  return match.rounds.map((round, i) => {
    running.a += round.nets.a;
    running.b += round.nets.b;
    const side = (team) => ({
      ...tierCounts(round[team]),
      net: round.nets[team],
      thrower: throwerFor(match, i, team),
      fourBagger: tierCounts(round[team]).hole === BAGS_PER_SIDE,
    });
    return {
      n: i + 1,
      a: side('a'),
      b: side('b'),
      running: { ...running },
      wash: round.nets.a === 0 && round.nets.b === 0,
      first: round.first,
    };
  });
}

export function summary(matches) {
  let rounds = 0;
  let washes = 0;
  let skunks = 0;
  let fourBaggers = 0;
  let durationMs = 0;
  let timed = 0;

  for (const match of matches) {
    rounds += match.rounds.length;
    for (const round of match.rounds) {
      if (round.nets.a === 0 && round.nets.b === 0) washes += 1;
      for (const team of TEAMS) {
        if (tierCounts(round[team]).hole === BAGS_PER_SIDE) fourBaggers += 1;
      }
    }
    // A record keeps `rounds` in the game's shape, so the scoring helpers read
    // it directly rather than this file recounting the totals.
    const final = totals(match);
    const loser = match.winner === 'a' ? final.b : final.a;
    if (match.winner && loser === 0) skunks += 1;
    const span = matchDuration(match);
    if (span !== null) {
      durationMs += span;
      timed += 1;
    }
  }

  return {
    matches: matches.length,
    rounds,
    washes,
    skunks,
    fourBaggers,
    avgRounds: ratio(rounds, matches.length),
    avgDurationMs: ratio(durationMs, timed),
  };
}
