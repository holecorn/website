// Stats over archived matches, and over the game in progress. Pure like
// scoring.js — no storage, no React — so the numbers are as testable as the
// rules that produce them.
//
// Everything here is derived from `rounds`, which already holds every bag's
// resting tier. Nothing extra had to be recorded to get these; the app was
// simply throwing the data away at `New game`. A live game and an archived
// record hold `rounds` in the same shape, which is why `gameStats` can share the
// per-round accumulation with `playerStats` rather than counting its own.

import {
  BAGS_PER_SIDE,
  nameKey,
  playerLabel,
  rawPoints,
  tierCounts,
  totals,
} from './scoring.js';

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

// Deduplicated, because two slots on one team can carry the same name — the
// default second player is the obvious case — and that must not count as two
// people playing two matches. A blank slot is not a person, so it is dropped
// rather than collected under an empty heading.
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

// How much of the result list a form line shows. The list itself stays internal:
// it grows with every match played and nothing reads more than its tail.
export const FORM_LENGTH = 5;

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
    // Newest last, so a form line reads left to right in play order.
    form: results.slice(-FORM_LENGTH),
  };
}

function chronological(matches) {
  return [...matches].sort((x, y) => (x.endedAt ?? 0) - (y.endedAt ?? 0));
}

// The score a match ended on, or null if it can't be known.
//
// `rounds` is the source wherever there is one, so a record the app filed itself
// can never disagree with its own detail. `final` is for the other kind: a game
// played before any of this existed, imported from a written-down result, which
// has a score and nothing behind it. That is the one number about such a match
// that genuinely isn't derivable — everything else stats.js reports is.
//
// Null rather than 0–0 for a record with neither, because `summary` reads a zero
// here as a skunk and would file every detail-less match as one.
export function finalScore(match) {
  if (match?.rounds?.length) return totals(match);
  const given = match?.final;
  if (!Number.isFinite(given?.a) || !Number.isFinite(given?.b)) return null;
  return { a: given.a, b: given.b };
}

// Whether a match carries its round-by-round detail. What separates the stats
// that need only a result — record, streak, head to head — from the ones that
// need thrown bags.
export function hasRounds(match) {
  return (match?.rounds?.length ?? 0) > 0;
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

// Per-player stats for the game in progress, in lane order.
//
// Keyed by team and slot, not by name the way `playerStats` is: within one game
// the slot *is* the identity, and two teams on one name are two rows, not one.
// The setup screen refuses to start such a lineup, but an older save or an
// imported record can still hold one. Nothing here needs the game to be over, so
// there is no win/loss or streak to report as a spurious zero.
//
// Except in a casual game, where the slot is *not* an identity — both partners
// are only the team's colour — so it folds to one row per team. That is the same
// rule applied to a game that hasn't got slots worth telling apart; two rows
// labelled "Blue" would be worse than one.
export function gameStats(game) {
  const rows = [];
  for (const team of TEAMS) {
    const slots = game.casual ? [0] : rosterFor(game, team).map((_, i) => i);
    for (const slot of slots) {
      const p = blankThrows(String(playerLabel(game, team, slot) ?? '').trim());
      game.rounds.forEach((round, i) => {
        if (game.casual || throwerSlot(game, i) === slot) foldRound(p, round, team);
      });
      rows.push({ team, slot, ...p, ...deriveRates(p) });
    }
  }
  return rows;
}

// The players about to play, with what their history says about them.
//
// Rows are per team and slot, in lane order, the way `gameStats` returns them —
// but the numbers are folded by name out of `playerStats`, because a career is
// the point. Two slots carrying the same name therefore show the same career
// twice, which is what name-folding means and is already true of the career
// screen.
//
// `played` distinguishes a genuine zero from no history at all, so a first-timer
// can be said to be a first-timer instead of being reported as 0% of everything.
export function lineupStats(matches, game) {
  const career = new Map(playerStats(matches).map((p) => [nameKey(p.name), p]));
  const rows = [];
  for (const team of TEAMS) {
    rosterFor(game, team).forEach((name, slot) => {
      const trimmed = String(name ?? '').trim();
      const found = career.get(nameKey(trimmed));
      rows.push({
        team,
        slot,
        ...(found ?? derive(blank(trimmed))),
        name: trimmed,
        played: Boolean(found),
      });
    });
  }
  return rows;
}

const NO_SIDE = '[]';

// One side of a matchup as a name set, so the same people count as the same side
// whichever team letter they held at the time and whichever order they were
// entered in.
function sideKey(match, team) {
  const names = rosterFor(match, team).map(nameKey).filter(Boolean);
  return JSON.stringify([...new Set(names)].sort());
}

// How this exact matchup has gone before, from the current lineup's point of
// view — `{ a, b }` wins, or null if these two sides have never finished a match.
//
// `headToHead` cannot answer this in doubles: it credits partners individually,
// so it reports four cross-pairs where the question actually being asked is
// whether this pair beats that pair. In singles the two agree by construction.
export function sideRecord(matches, game) {
  const here = { a: sideKey(game, 'a'), b: sideKey(game, 'b') };
  // Nothing to report for an unnamed side, or for a lineup that has the same
  // people on both sides of the court.
  if (here.a === NO_SIDE || here.b === NO_SIDE || here.a === here.b) return null;

  const won = { a: 0, b: 0 };
  for (const match of matches) {
    if (!match.winner) continue;
    const was = { a: sideKey(match, 'a'), b: sideKey(match, 'b') };
    if (was.a === here.a && was.b === here.b) won[match.winner] += 1;
    else if (was.a === here.b && was.b === here.a) won[match.winner === 'a' ? 'b' : 'a'] += 1;
  }
  return won.a + won.b === 0 ? null : won;
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

// How many meetings before a one-sided record counts as a rivalry rather than a
// bad afternoon. Exported so the screen can say why somebody has neither yet.
export const RIVAL_MIN_MEETINGS = 3;

// One player's record against everyone they have faced, from *their* point of
// view. Built on headToHead rather than folding the matches again, so there is
// one definition of who beat whom.
//
// The flip is the whole point. headToHead keys a pair low-name-first, so a given
// player is on the left of some rows and the right of others — which on a screen
// means checking both columns of every row to find yourself, and there is no
// usable find-in-page on a phone. Here they are always `wins`/`losses`.
//
// No threshold: this lists everyone. `nemesis` is where the bound belongs.
export function opponentRecords(matches, name) {
  const key = nameKey(name);
  if (!key) return [];
  const out = [];
  for (const pair of headToHead(matches)) {
    const mine = nameKey(pair.a) === key ? 'a' : nameKey(pair.b) === key ? 'b' : null;
    if (!mine) continue;
    const wins = mine === 'a' ? pair.aWins : pair.bWins;
    const losses = mine === 'a' ? pair.bWins : pair.aWins;
    out.push({
      name: mine === 'a' ? pair.b : pair.a,
      wins,
      losses,
      met: wins + losses,
      // Netted, which is what makes it a rivalry measure rather than an
      // attendance one — see `nemesis`.
      deficit: losses - wins,
    });
  }
  return out.sort(
    (x, y) => y.deficit - x.deficit || y.met - x.met || x.name.localeCompare(y.name),
  );
}

// Who has beaten this player most, or null if nobody has beaten them enough to
// count. Reads the sorted list above, so the pick is its first qualifying row.
//
// **Deficit, not raw losses**, and the difference is not cosmetic: raw losses
// cannot tell "beats me" from "plays me a lot", so in a group with one regular it
// returns that regular for nearly everybody — and worse, it can name somebody you
// hold a winning record against. Measured on the sample archive: most-losses made
// Neil the nemesis of 7 of the 9 eligible players, and made Sigma's nemesis Neil,
// a matchup Sigma leads 18–13. A positive deficit cannot do that.
//
// Worst win *rate* was the other candidate and is worse still — it rewards tiny
// samples, so it needs a threshold high enough to exclude newcomers outright.
//
// With the deficit tied, more meetings is the same ordering as more losses
// (losses = (met + deficit) / 2), so the sort above already breaks the tie the
// intended way and there is no extra comparator here.
export function nemesis(records) {
  return records.find((o) => o.met >= RIVAL_MIN_MEETINGS && o.deficit > 0) ?? null;
}

// The other end of the same list: who this player has the better of. Deficit for
// the same reason as `nemesis` — beating somebody five times out of thirty is not
// dominating them — and the list is sorted worst-first, so the most one-sided win
// is at the far end rather than the near one.
//
// The two can never name the same opponent: one needs a positive deficit and the
// other a negative one, and nobody qualifies at zero.
export function dominates(records) {
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const o = records[i];
    if (o.met >= RIVAL_MIN_MEETINGS && o.deficit < 0) return o;
  }
  return null;
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
  let detailed = 0;

  for (const match of matches) {
    rounds += match.rounds.length;
    if (hasRounds(match)) detailed += 1;
    for (const round of match.rounds) {
      if (round.nets.a === 0 && round.nets.b === 0) washes += 1;
      for (const team of TEAMS) {
        if (tierCounts(round[team]).hole === BAGS_PER_SIDE) fourBaggers += 1;
      }
    }
    const final = finalScore(match);
    const loser = match.winner === 'a' ? final?.b : final?.a;
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
    // Over the matches that have rounds, not over all of them: an imported
    // result contributes no rounds, and dividing by it drags the average toward
    // zero rather than reporting how long a game actually runs.
    avgRounds: ratio(rounds, detailed),
    avgDurationMs: ratio(durationMs, timed),
  };
}
