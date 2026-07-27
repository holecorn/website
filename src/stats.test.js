import { describe, it, expect } from 'vitest';
import { newGame, setBag, endRound } from './scoring.js';
import { matchRecord } from './archive.js';
import {
  throwerFor,
  rosterFor,
  playerStats,
  headToHead,
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
