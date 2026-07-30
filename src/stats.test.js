import { describe, it, expect } from 'vitest';
import {
  newGame,
  setBag,
  endRound,
  undoRound,
  courtPositions,
} from './scoring.js';
import { matchRecord, renamePlayer, setMatchPlayers } from './archive.js';
import {
  throwerFor,
  throwerSlot,
  gameStats,
  rosterFor,
  playerStats,
  headToHead,
  lineupStats,
  sideRecord,
  summary,
  matchRounds,
  matchDuration,
} from './stats.js';

const H = 'hole';
const B = 'board';
const F = 'floor';

function place(game, team, tiers) {
  return tiers.reduce((g, tier, i) => setBag(g, team, i, tier), game);
}

function playRound(game, aTiers, bTiers) {
  return endRound(place(place(game, 'a', aTiers), 'b', bTiers));
}

// Build a record the way the app does: play the rounds through the real scoring
// functions, then archive the result. Keeps the fixtures honest — a rule change
// that breaks attribution shows up here rather than in a hand-written blob.
function match({
  id = 'm1',
  mode = 'singles',
  players,
  target = 21,
  rounds = [],
  startedAt = 0,
  endedAt = 1000,
}) {
  let game = { ...newGame(target), id, startedAt, mode, players };
  for (const [a, b] of rounds) game = playRound(game, a, b);
  return matchRecord(game, endedAt);
}

const singles = (a, b, rounds, extra = {}) =>
  match({ players: { a: [a, 'Player 2'], b: [b, 'Player 2'] }, rounds, ...extra });

function find(stats, name) {
  return stats.find((p) => p.name === name);
}

describe('throwerFor', () => {
  const players = { a: ['Rho', 'Tau'], b: ['Phi', 'Chi'] };

  it('always uses the first slot in singles', () => {
    const m = { mode: 'singles', players };
    expect([0, 1, 2, 3].map((i) => throwerFor(m, i, 'a'))).toEqual([
      'Rho',
      'Rho',
      'Rho',
      'Rho',
    ]);
  });

  it('alternates partners every round in doubles', () => {
    const m = { mode: 'doubles', players };
    expect([0, 1, 2, 3].map((i) => throwerFor(m, i, 'a'))).toEqual([
      'Rho',
      'Tau',
      'Rho',
      'Tau',
    ]);
    expect(throwerFor(m, 1, 'b')).toBe('Chi');
  });
});

describe('rosterFor', () => {
  const players = { a: ['Rho', 'Tau'], b: ['Phi', 'Chi'] };

  it('drops the benched slot in singles', () => {
    expect(rosterFor({ mode: 'singles', players }, 'a')).toEqual(['Rho']);
  });

  it('keeps both partners in doubles', () => {
    expect(rosterFor({ mode: 'doubles', players }, 'a')).toEqual(['Rho', 'Tau']);
  });
});

describe('playerStats — singles', () => {
  const m = singles('Neil', 'Sigma', [
    [[H, B, F, F], [B, F, F, F]], // raw 4 v 1 -> net a 3
    [[B, B, F, F], [H, B, F, F]], // raw 2 v 4 -> net b 2
  ]);

  it('counts bags by tier and reports the rates over bags thrown', () => {
    const neil = find(playerStats([m]), 'Neil');
    expect(neil.rounds).toBe(2);
    expect(neil.bags).toBe(8);
    expect(neil.hole).toBe(1);
    expect(neil.board).toBe(3);
    expect(neil.floor).toBe(4);
    expect(neil.holePct).toBeCloseTo(1 / 8);
    expect(neil.inPlayPct).toBeCloseTo(4 / 8);
  });

  it('separates raw PPR from the cancellation-adjusted one', () => {
    const neil = find(playerStats([m]), 'Neil');
    // Raw bag points 4 + 2 over two rounds; only 3 survived cancellation.
    expect(neil.ppr).toBeCloseTo(3);
    expect(neil.netPpr).toBeCloseTo(1.5);
  });

  it('ignores the unused second slot', () => {
    expect(find(playerStats([m]), 'Player 2')).toBeUndefined();
  });
});

describe('playerStats — doubles attribution', () => {
  // Rho throws rounds 0 and 2, Tau throws round 1 — the rule App.jsx uses for
  // `activeIdx`. Giving the partners opposite results makes a mix-up obvious.
  const m = match({
    mode: 'doubles',
    players: { a: ['Rho', 'Tau'], b: ['Phi', 'Chi'] },
    rounds: [
      [[H, H, H, H], [F, F, F, F]],
      [[F, F, F, F], [F, F, F, F]],
      [[H, H, H, H], [F, F, F, F]],
    ],
  });

  it('credits each partner only for the rounds they threw', () => {
    const stats = playerStats([m]);
    const rho = find(stats, 'Rho');
    const tau = find(stats, 'Tau');

    expect(rho.rounds).toBe(2);
    expect(rho.hole).toBe(8);
    expect(rho.ppr).toBeCloseTo(12);
    expect(rho.fourBaggers).toBe(2);
    expect(rho.bestRound).toBe(12);

    expect(tau.rounds).toBe(1);
    expect(tau.floor).toBe(4);
    expect(tau.ppr).toBe(0);
    expect(tau.fourBaggers).toBe(0);
    expect(tau.bestRound).toBe(0);
  });

  it('credits the match result to both partners', () => {
    const stats = playerStats([m]);
    for (const name of ['Rho', 'Tau']) {
      expect(find(stats, name).matches).toBe(1);
      expect(find(stats, name).wins).toBe(1);
    }
    for (const name of ['Phi', 'Chi']) {
      expect(find(stats, name).losses).toBe(1);
      expect(find(stats, name).winPct).toBe(0);
    }
  });

  it('counts a partner named twice as one player in one match', () => {
    const dup = match({
      mode: 'doubles',
      players: { a: ['Rho', 'Rho'], b: ['Phi', 'Chi'] },
      rounds: [[[H, H, H, H], [F, F, F, F]], [[H, H, H, H], [F, F, F, F]]],
    });
    const rho = find(playerStats([dup]), 'Rho');
    expect(rho.matches).toBe(1);
    expect(rho.wins).toBe(1);
    // Still threw both rounds, since each round has exactly one thrower.
    expect(rho.rounds).toBe(2);
  });
});

describe('playerStats — identity', () => {
  it('folds case and padding onto one player, keeping the latest spelling', () => {
    const first = singles('neil', 'Sigma', [[[H, H, H, H], [F, F, F, F]]], {
      id: 'm1',
      endedAt: 1,
    });
    const second = singles(' Neil ', 'Sigma', [[[H, H, H, H], [F, F, F, F]]], {
      id: 'm2',
      endedAt: 2,
    });
    const stats = playerStats([first, second]);
    const neil = find(stats, 'Neil');
    expect(neil.matches).toBe(2);
    expect(stats.filter((p) => p.name.toLowerCase() === 'neil')).toHaveLength(1);
  });

  it('drops players left unnamed', () => {
    const m = singles('Neil', '   ', [[[H, H, H, H], [F, F, F, F]]]);
    expect(playerStats([m]).map((p) => p.name)).toEqual(['Neil']);
  });
});

// The claim the stats screen's editing rests on: nothing in `rounds` names
// anybody, so rewriting a record's lineup moves the throws with it. If it ever
// stops being true, correcting a name would leave the numbers behind under the
// old one.
describe('editing a record reattributes it', () => {
  // Rho throws rounds 0 and 2 and does all the scoring; Tau throws round 1.
  const doubles = match({
    mode: 'doubles',
    players: { a: ['Rho', 'Tau'], b: ['Phi', 'Chi'] },
    rounds: [
      [[H, H, H, H], [F, F, F, F]],
      [[F, F, F, F], [F, F, F, F]],
      [[H, H, H, H], [F, F, F, F]],
    ],
  });

  it('carries a renamed player’s throws and results to the new name', () => {
    const [fixed] = renamePlayer([doubles], 'rho', 'Rho B', 1);
    const stats = playerStats([fixed]);
    expect(find(stats, 'Rho')).toBeUndefined();
    const rho = find(stats, 'Rho B');
    expect(rho.rounds).toBe(2);
    expect(rho.hole).toBe(8);
    expect(rho.wins).toBe(1);
  });

  it('follows slot order, so swapping partners swaps who threw what', () => {
    const [swapped] = setMatchPlayers([doubles], 'm1', { a: ['Tau', 'Rho'], b: ['Phi', 'Chi'] }, 1);
    const stats = playerStats([swapped]);
    expect(find(stats, 'Tau').hole).toBe(8);
    expect(find(stats, 'Rho').hole).toBe(0);
  });

  it('merges a phantom player created by a typo back into one career', () => {
    const rounds = [[[H, H, H, H], [F, F, F, F]]];
    const good = singles('Neil', 'Sigma', rounds, { id: 'm1', endedAt: 1 });
    const typo = singles('Nei', 'Sigma', rounds, { id: 'm2', endedAt: 2 });
    const stats = playerStats(renamePlayer([good, typo], 'Nei', 'Neil', 3));
    expect(stats.filter((p) => p.name === 'Neil')).toHaveLength(1);
    expect(find(stats, 'Neil').matches).toBe(2);
    expect(find(stats, 'Neil').rounds).toBe(2);
  });
});

describe('playerStats — streaks', () => {
  // Neil wins, wins, loses, wins. Longest run is two, current run is one.
  const win = (id, endedAt, winner) =>
    singles(
      'Neil',
      'Sigma',
      winner === 'a'
        ? [[[H, H, H, H], [F, F, F, F]], [[H, H, H, H], [F, F, F, F]]]
        : [[[F, F, F, F], [H, H, H, H]], [[F, F, F, F], [H, H, H, H]]],
      { id, endedAt },
    );

  it('reads streaks in the order the matches finished', () => {
    const played = [
      win('m3', 300, 'b'),
      win('m1', 100, 'a'),
      win('m4', 400, 'a'),
      win('m2', 200, 'a'),
    ];
    const neil = find(playerStats(played), 'Neil');
    expect(neil.wins).toBe(3);
    expect(neil.losses).toBe(1);
    expect(neil.longestStreak).toBe(2);
    expect(neil.currentStreak).toBe(1);
  });
});

describe('headToHead', () => {
  it('tallies each pair regardless of which side they played', () => {
    const a = singles('Neil', 'Sigma', [[[H, H, H, H], [F, F, F, F]], [[H, H, H, H], [F, F, F, F]]], {
      id: 'm1',
      endedAt: 1,
    });
    const b = singles('Sigma', 'Neil', [[[H, H, H, H], [F, F, F, F]], [[H, H, H, H], [F, F, F, F]]], {
      id: 'm2',
      endedAt: 2,
    });
    const [pair] = headToHead([a, b]);
    expect(pair.aWins + pair.bWins).toBe(2);
    // One win each: Neil won the first, Sigma the second from the other side.
    expect(pair.aWins).toBe(1);
    expect(pair.bWins).toBe(1);
  });
});

// A four-bagger win and a whitewash loss, so a result is unambiguous.
const SWEEP = [[[H, H, H, H], [F, F, F, F]], [[H, H, H, H], [F, F, F, F]]];

describe('form', () => {
  it('reads oldest first and keeps only the tail', () => {
    // Seven matches, alternating who wins, so the cut is visible: Neil wins the
    // odd-numbered ones.
    const matches = Array.from({ length: 7 }, (_, i) =>
      i % 2 === 0
        ? singles('Neil', 'Sigma', SWEEP, { id: `m${i}`, endedAt: i + 1 })
        : singles('Sigma', 'Neil', SWEEP, { id: `m${i}`, endedAt: i + 1 }),
    );
    const neil = find(playerStats(matches), 'Neil');
    expect(neil.matches).toBe(7);
    // Results are W L W L W L W; the last five are W L W L W.
    expect(neil.form).toEqual([true, false, true, false, true]);
  });

  it('is shorter than the window for someone with fewer matches', () => {
    const neil = find(playerStats([singles('Neil', 'Sigma', SWEEP)]), 'Neil');
    expect(neil.form).toEqual([true]);
  });
});

describe('lineupStats', () => {
  const played = singles('Neil', 'Sigma', SWEEP);
  const game = (over) => ({ ...newGame(), players: { a: ['Neil', 'P2'], b: ['Sigma', 'P2'] }, ...over });

  it('returns one row per slot in lane order, not one per player with history', () => {
    const rows = lineupStats([played], game());
    expect(rows.map((r) => `${r.team}${r.slot}`)).toEqual(['a0', 'b0']);
    expect(rows.map((r) => r.name)).toEqual(['Neil', 'Sigma']);
  });

  it('carries the career numbers, folded by name', () => {
    const [neil] = lineupStats([played], game());
    expect(neil.wins).toBe(1);
    expect(neil.losses).toBe(0);
    expect(neil.ppr).toBeCloseTo(12);
    expect(neil.played).toBe(true);
  });

  it('counts a match played from the other side of the court', () => {
    const flipped = singles('Sigma', 'Neil', SWEEP, { id: 'm2', endedAt: 2 });
    const [neil] = lineupStats([played, flipped], game());
    // Won the first, lost the second — name-folded across both team letters.
    expect([neil.wins, neil.losses]).toEqual([1, 1]);
  });

  // `played` is the difference between a genuine zero and no history at all, and
  // it is what lets both screens say "first game" instead of reporting 0% of
  // everything.
  it('marks a name with no history rather than reporting zeroes as fact', () => {
    const rows = lineupStats([played], game({ players: { a: ['Neil', 'P2'], b: ['Psi', 'P2'] } }));
    expect(rows[1].played).toBe(false);
    expect(rows[1].name).toBe('Psi');
    expect(rows[1].matches).toBe(0);
    expect(rows[1].form).toEqual([]);
  });

  it('gives four rows in doubles, team A first', () => {
    const rows = lineupStats([], {
      ...newGame(),
      mode: 'doubles',
      players: { a: ['Rho', 'Tau'], b: ['Phi', 'Chi'] },
    });
    expect(rows.map((r) => r.name)).toEqual(['Rho', 'Tau', 'Phi', 'Chi']);
    expect(rows.map((r) => r.team)).toEqual(['a', 'a', 'b', 'b']);
  });

  it('reports the same career twice when two slots share a name', () => {
    const rows = lineupStats([played], game({ players: { a: ['Neil', 'P2'], b: ['neil ', 'P2'] } }));
    // Inherent to folding by name, and already true of the career screen — worth
    // pinning so it is a known consequence rather than a surprise.
    expect(rows[0].wins).toBe(rows[1].wins);
  });
});

describe('sideRecord', () => {
  const game = (over) => ({ ...newGame(), players: { a: ['Neil', 'P2'], b: ['Sigma', 'P2'] }, ...over });

  it('is null when these two have never finished a match', () => {
    expect(sideRecord([], game())).toBeNull();
  });

  it('counts wins from the current lineup point of view, whichever side they were', () => {
    const first = singles('Neil', 'Sigma', SWEEP, { id: 'm1', endedAt: 1 });
    // Same two people, sides swapped, so Sigma wins this one.
    const second = singles('Sigma', 'Neil', SWEEP, { id: 'm2', endedAt: 2 });
    expect(sideRecord([first, second], game())).toEqual({ a: 1, b: 1 });
    // Asking from the other side reports the mirror, not the same object.
    expect(sideRecord([first, second], game({ players: { a: ['Sigma', 'P2'], b: ['Neil', 'P2'] } })))
      .toEqual({ a: 1, b: 1 });
  });

  it('is asymmetric when one side keeps winning', () => {
    const matches = [1, 2, 3].map((n) =>
      singles('Neil', 'Sigma', SWEEP, { id: `m${n}`, endedAt: n }),
    );
    expect(sideRecord(matches, game())).toEqual({ a: 3, b: 0 });
  });

  // The whole reason this exists rather than filtering headToHead: in doubles the
  // question is whether *this pair* beats *that pair*, and headToHead credits
  // partners individually across four cross-pairs.
  it('matches a doubles pairing regardless of partner order', () => {
    const m = match({
      id: 'd1',
      mode: 'doubles',
      players: { a: ['Rho', 'Tau'], b: ['Phi', 'Chi'] },
      rounds: SWEEP,
      endedAt: 1,
    });
    const asPlayed = { ...newGame(), mode: 'doubles', players: { a: ['Rho', 'Tau'], b: ['Phi', 'Chi'] } };
    const reordered = { ...newGame(), mode: 'doubles', players: { a: ['Tau', 'Rho'], b: ['Chi', 'Phi'] } };
    expect(sideRecord([m], asPlayed)).toEqual({ a: 1, b: 0 });
    expect(sideRecord([m], reordered)).toEqual({ a: 1, b: 0 });
  });

  it('does not count a different pairing of the same people', () => {
    const m = match({
      id: 'd1',
      mode: 'doubles',
      players: { a: ['Rho', 'Tau'], b: ['Phi', 'Chi'] },
      rounds: SWEEP,
      endedAt: 1,
    });
    const repartnered = { ...newGame(), mode: 'doubles', players: { a: ['Rho', 'Phi'], b: ['Tau', 'Chi'] } };
    expect(sideRecord([m], repartnered)).toBeNull();
  });

  it('ignores a singles game between people who have only met in doubles', () => {
    const m = match({
      id: 'd1',
      mode: 'doubles',
      players: { a: ['Rho', 'Tau'], b: ['Phi', 'Chi'] },
      rounds: SWEEP,
      endedAt: 1,
    });
    const asSingles = { ...newGame(), players: { a: ['Rho', 'X'], b: ['Phi', 'Y'] } };
    expect(sideRecord([m], asSingles)).toBeNull();
  });

  it('is null when the same person is on both sides', () => {
    const m = singles('Neil', 'Sigma', SWEEP);
    expect(sideRecord([m], game({ players: { a: ['Neil', 'P2'], b: ['Neil', 'P2'] } }))).toBeNull();
  });

  it('is null for a blank side', () => {
    const m = singles('Neil', 'Sigma', SWEEP);
    expect(sideRecord([m], game({ players: { a: ['Neil', 'P2'], b: ['  ', 'P2'] } }))).toBeNull();
  });

  it('ignores an unfinished match', () => {
    const m = { ...singles('Neil', 'Sigma', SWEEP), winner: null };
    expect(sideRecord([m], game())).toBeNull();
  });
});

describe('matchRounds', () => {
  const m = singles('Neil', 'Sigma', [
    [[H, B, F, F], [B, F, F, F]], // raw 4 v 1 -> a +3
    [[B, F, F, F], [H, H, F, F]], // raw 1 v 6 -> b +5
    [[B, F, F, F], [B, F, F, F]], // raw 1 v 1 -> wash
    [[H, H, H, H], [F, F, F, F]], // four-bagger -> a +12
  ]);

  it('carries a running score through the match', () => {
    expect(matchRounds(m).map((r) => `${r.running.a}-${r.running.b}`)).toEqual([
      '3-0',
      '3-5',
      '3-5',
      '15-5',
    ]);
  });

  it('numbers rounds from one and keeps each side’s tiers and net', () => {
    const [first] = matchRounds(m);
    expect(first.n).toBe(1);
    expect(first.a).toMatchObject({ hole: 1, board: 1, floor: 2, net: 3 });
    expect(first.b).toMatchObject({ hole: 0, board: 1, floor: 3, net: 0 });
  });

  it('flags a wash and a four-bagger', () => {
    const rounds = matchRounds(m);
    expect(rounds.map((r) => r.wash)).toEqual([false, false, true, false]);
    expect(rounds.map((r) => r.a.fourBagger)).toEqual([false, false, false, true]);
  });

  it('names the thrower, alternating partners in doubles', () => {
    const doubles = match({
      mode: 'doubles',
      players: { a: ['Rho', 'Tau'], b: ['Phi', 'Chi'] },
      rounds: [
        [[H, H, H, H], [F, F, F, F]],
        [[F, F, F, F], [F, F, F, F]],
        [[H, H, H, H], [F, F, F, F]],
      ],
    });
    expect(matchRounds(doubles).map((r) => r.a.thrower)).toEqual(['Rho', 'Tau', 'Rho']);
    expect(matchRounds(doubles).map((r) => r.b.thrower)).toEqual(['Phi', 'Chi', 'Phi']);
    expect(matchRounds(m).map((r) => r.a.thrower)).toEqual(Array(4).fill('Neil'));
  });

  it('is empty for a match with no rounds', () => {
    expect(matchRounds({ mode: 'singles', players: { a: ['x'], b: ['y'] }, rounds: [] })).toEqual(
      [],
    );
  });
});

describe('matchDuration', () => {
  const played = [[[H, H, H, H], [F, F, F, F]], [[H, H, H, H], [F, F, F, F]]];

  it('measures between the two stamps', () => {
    expect(matchDuration(singles('Neil', 'Sigma', played, {
      startedAt: 1000,
      endedAt: 721000,
    }))).toBe(720000);
  });

  // Stamps are spread over a finished record rather than passed to the helper:
  // a default parameter fires on `undefined`, so `endedAt: undefined` would
  // quietly come back as a number and the absent-stamp cases would test nothing.
  const stamped = (stamps) => ({ ...singles('Neil', 'Sigma', played), ...stamps });
  const span = (stamps) => matchDuration(stamped(stamps));

  // The case that made this a function rather than a subtraction: a game
  // already in play when startedAt shipped never passed through Start game, so
  // it was archived without one and measured from the epoch instead.
  it('is unknown, not 55 years, when the start time is missing', () => {
    expect(span({ startedAt: undefined, endedAt: 1.7e12 })).toBeNull();
    expect(span({ startedAt: null, endedAt: 1.7e12 })).toBeNull();
  });

  it('treats a zero or negative start as missing, not as 1970', () => {
    expect(span({ startedAt: 0, endedAt: 1.7e12 })).toBeNull();
    expect(span({ startedAt: -5, endedAt: 1.7e12 })).toBeNull();
  });

  it('is unknown when the end is absent or the clock went backwards', () => {
    expect(span({ startedAt: 1000, endedAt: undefined })).toBeNull();
    expect(span({ startedAt: 5000, endedAt: 5000 })).toBeNull();
    expect(span({ startedAt: 9000, endedAt: 1000 })).toBeNull();
  });
});

describe('summary', () => {
  it('counts washes, skunks and four-baggers across matches', () => {
    const m = match({
      players: { a: ['Rho', 'x'], b: ['Phi', 'y'] },
      rounds: [
        [[H, H, H, H], [F, F, F, F]], // four-bagger for a
        [[B, F, F, F], [B, F, F, F]], // wash
        [[H, H, H, H], [F, F, F, F]], // four-bagger, takes a to 24
      ],
      startedAt: 1000,
      endedAt: 4000,
    });
    const s = summary([m]);
    expect(s.matches).toBe(1);
    expect(s.rounds).toBe(3);
    expect(s.washes).toBe(1);
    expect(s.fourBaggers).toBe(2);
    expect(s.skunks).toBe(1);
    expect(s.avgRounds).toBe(3);
    expect(s.avgDurationMs).toBe(3000);
  });

  it('averages only the matches it can time, and still counts the rest', () => {
    const played = [[[H, H, H, H], [F, F, F, F]], [[H, H, H, H], [F, F, F, F]]];
    const timed = singles('Neil', 'Sigma', played, {
      id: 'm1',
      startedAt: 1000,
      endedAt: 601000,
    });
    const untimed = {
      ...singles('Neil', 'Sigma', played, { id: 'm2', endedAt: 1.7e12 }),
      startedAt: undefined,
    };
    const s = summary([timed, untimed]);
    expect(s.matches).toBe(2);
    expect(s.avgDurationMs).toBe(600000);
  });

  it('is safe on an empty archive', () => {
    expect(summary([])).toMatchObject({ matches: 0, rounds: 0, avgRounds: 0 });
    expect(playerStats([])).toEqual([]);
    expect(headToHead([])).toEqual([]);
  });
});

// A live game rather than a record: the same rounds, played but not archived.
function livePlay(mode, players, rounds, target = 21) {
  let game = { ...newGame(target), mode, players };
  for (const [a, b] of rounds) game = playRound(game, a, b);
  return game;
}

describe('gameStats', () => {
  const players = { a: ['Rho', 'Tau'], b: ['Phi', 'Chi'] };

  it('reports nothing but zeroes before the first round', () => {
    const rows = gameStats(livePlay('singles', players, []));
    expect(rows.map((r) => [r.team, r.name, r.rounds, r.bags])).toEqual([
      ['a', 'Rho', 0, 0],
      ['b', 'Phi', 0, 0],
    ]);
    // No division blow-ups on an empty game.
    expect(rows.every((r) => r.ppr === 0 && r.holePct === 0)).toBe(true);
  });

  it('is one row per player in lane order, and only the players in play', () => {
    const singlesRows = gameStats(livePlay('singles', players, [[[H, F, F, F], [B, F, F, F]]]));
    expect(singlesRows.map((r) => `${r.team}${r.slot}:${r.name}`)).toEqual(['a0:Rho', 'b0:Phi']);

    const doublesRows = gameStats(livePlay('doubles', players, [[[H, F, F, F], [B, F, F, F]]]));
    expect(doublesRows.map((r) => `${r.team}${r.slot}:${r.name}`)).toEqual([
      'a0:Rho',
      'a1:Tau',
      'b0:Phi',
      'b1:Chi',
    ]);
  });

  it('credits each doubles partner only the rounds they threw', () => {
    // Rho throws rounds 0 and 2 (four in the hole each), Tau round 1 (nothing).
    const game = livePlay('doubles', players, [
      [[H, H, H, H], [F, F, F, F]],
      [[F, F, F, F], [F, F, F, F]],
      [[H, H, H, H], [F, F, F, F]],
    ]);
    const rows = gameStats(game);
    const rho = rows.find((r) => r.name === 'Rho');
    const tau = rows.find((r) => r.name === 'Tau');
    expect([rho.rounds, rho.hole, rho.fourBaggers, rho.bestRound]).toEqual([2, 8, 2, 12]);
    expect([tau.rounds, tau.hole, tau.fourBaggers, tau.bestRound]).toEqual([1, 0, 0, 0]);
    expect(rho.rounds + tau.rounds).toBe(game.rounds.length);
  });

  it('keeps two teams on the same default name as two players', () => {
    const shared = { a: ['Player 1', 'Player 2'], b: ['Player 1', 'Player 2'] };
    const rows = gameStats(livePlay('singles', shared, [[[H, H, F, F], [F, F, F, F]]]));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.hole)).toEqual([2, 0]);
  });

  it('rates count thrown bags, so they mean the same mid-game as over a career', () => {
    const rounds = [[[H, B, F, F], [F, F, F, F]]];
    const live = gameStats(livePlay('singles', players, rounds));
    const career = playerStats([singles('Rho', 'Phi', rounds)]);
    const from = (rows, name) => {
      const r = rows.find((x) => x.name === name);
      return [r.rounds, r.bags, r.hole, r.board, r.rawPoints, r.ppr, r.holePct, r.inPlayPct];
    };
    expect(from(live, 'Rho')).toEqual(from(career, 'Rho'));
  });

  it('reports no win, loss or streak for a game that is not over', () => {
    const rows = gameStats(livePlay('singles', players, [[[H, F, F, F], [F, F, F, F]]]));
    for (const key of ['wins', 'losses', 'matches', 'currentStreak', 'winPct']) {
      expect(rows[0][key]).toBeUndefined();
    }
  });

  it('follows an undone round back down', () => {
    const rounds = [[[H, H, H, H], [F, F, F, F]], [[B, B, F, F], [F, F, F, F]]];
    const game = livePlay('singles', players, rounds);
    const after = gameStats(undoRound(game)).find((r) => r.name === 'Rho');
    expect([after.rounds, after.hole, after.board, after.fourBaggers]).toEqual([1, 4, 0, 1]);
  });
});

describe('the parity in scoring.js and stats.js', () => {
  // `courtPositions` decides who is shown throwing and `throwerSlot` decides who
  // is credited for it. They are the same rule in two modules, and if they drift
  // the diagram names one player while the stats bank the round to the other,
  // with nothing else failing.
  it('agrees on who is throwing, round by round', () => {
    const players = { a: ['Rho', 'Tau'], b: ['Phi', 'Chi'] };
    let game = { ...newGame(), mode: 'doubles', players };
    for (let r = 0; r < 8; r += 1) {
      const { ends, throwingEnd } = courtPositions(game);
      expect(throwingEnd).toBe(throwerSlot(game, r));
      const boxes = ends[throwingEnd].boxes;
      for (const team of ['a', 'b']) {
        const occupant = ['left', 'right']
          .map((side) => boxes[side])
          .find((o) => o.team === team);
        expect(occupant.name).toBe(throwerFor(game, r, team));
      }
      game = playRound(game, [F, F, F, F], [F, F, F, F]);
    }
  });

  it('agrees in singles, where only one slot ever throws', () => {
    const players = { a: ['Rho', 'Tau'], b: ['Phi', 'Chi'] };
    let game = { ...newGame(), mode: 'singles', players };
    for (let r = 0; r < 4; r += 1) {
      const { ends, throwingEnd } = courtPositions(game);
      expect(throwerSlot(game, r)).toBe(0);
      for (const team of ['a', 'b']) {
        const occupant = ['left', 'right']
          .map((side) => ends[throwingEnd].boxes[side])
          .find((o) => o?.team === team);
        expect(occupant.name).toBe(throwerFor(game, r, team));
      }
      game = playRound(game, [F, F, F, F], [F, F, F, F]);
    }
  });
});
