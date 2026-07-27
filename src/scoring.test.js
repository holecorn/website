import { describe, it, expect } from 'vitest';
import {
  MAX_TARGET,
  clampTarget,
  emptyPositions,
  rawPoints,
  tierCounts,
  roundNets,
  newGame,
  teamLabel,
  winVerb,
  setFirst,
  totals,
  setBag,
  endRound,
  undoRound,
  unthrownCount,
  roundComplete,
} from './scoring.js';

// Place a whole side's four bags: place(game, 'a', ['hole','board','floor','floor'])
function place(game, team, tiers) {
  return tiers.reduce((g, tier, i) => setBag(g, team, i, tier), game);
}

// Play out a full round from both sides and commit it.
function playRound(game, aTiers, bTiers) {
  return endRound(place(place(game, 'a', aTiers), 'b', bTiers));
}

describe('newGame', () => {
  it('starts empty with sensible defaults', () => {
    const g = newGame();
    expect(g.mode).toBe('singles');
    expect(g.target).toBe(21);
    expect(g.rounds).toEqual([]);
    expect(g.winner).toBeNull();
    expect(g.nextFirst).toBe('a');
    expect(g.current.a).toEqual(['unthrown', 'unthrown', 'unthrown', 'unthrown']);
    expect(g.current.b).toEqual(emptyPositions());
  });

  it('accepts a custom target', () => {
    expect(newGame(11).target).toBe(11);
  });
});

describe('rawPoints', () => {
  it('scores hole 3, board 1, floor/unthrown 0', () => {
    expect(rawPoints(['hole', 'board', 'floor', 'unthrown'])).toBe(4);
    expect(rawPoints(['hole', 'hole', 'hole', 'hole'])).toBe(12);
    expect(rawPoints(emptyPositions())).toBe(0);
  });
});

describe('tierCounts', () => {
  it('tallies each tier', () => {
    expect(tierCounts(['hole', 'hole', 'board', 'floor'])).toEqual({
      unthrown: 0,
      floor: 1,
      board: 1,
      hole: 2,
    });
  });
});

describe('roundNets (cancellation)', () => {
  it('only the leader scores the difference', () => {
    expect(roundNets(['hole', 'board', 'floor', 'floor'], ['board', 'floor', 'floor', 'floor'])).toEqual({ a: 3, b: 0 });
    expect(roundNets(['board', 'floor', 'floor', 'floor'], ['hole', 'board', 'floor', 'floor'])).toEqual({ a: 0, b: 3 });
  });

  it('a tie nets nobody (a wash)', () => {
    expect(roundNets(['hole', 'floor', 'floor', 'floor'], ['board', 'board', 'board', 'floor'])).toEqual({ a: 0, b: 0 });
    expect(roundNets(emptyPositions(), emptyPositions())).toEqual({ a: 0, b: 0 });
  });
});

describe('setBag', () => {
  it('moves a bag and does not mutate the original', () => {
    const g = newGame();
    const g2 = setBag(g, 'a', 0, 'hole');
    expect(g2.current.a[0]).toBe('hole');
    expect(g.current.a[0]).toBe('unthrown');
  });

  it('never returns a thrown bag to the unthrown state', () => {
    let g = setBag(newGame(), 'a', 0, 'board');
    g = setBag(g, 'a', 0, 'unthrown');
    expect(g.current.a[0]).toBe('board');
  });

  it('is a no-op once the game is won', () => {
    const won = playRound(newGame(3), ['hole', 'floor', 'floor', 'floor'], emptyPositions());
    expect(won.winner).toBe('a');
    const after = setBag(won, 'b', 0, 'hole');
    expect(after.current.b[0]).toBe('unthrown');
  });
});

describe('endRound', () => {
  it('commits nets, stores positions + first thrower, and resets the board', () => {
    const g = playRound(newGame(), ['hole', 'board', 'floor', 'floor'], ['board', 'floor', 'floor', 'floor']);
    expect(g.rounds).toHaveLength(1);
    expect(g.rounds[0].nets).toEqual({ a: 3, b: 0 });
    expect(g.rounds[0].a).toEqual(['hole', 'board', 'floor', 'floor']);
    expect(g.rounds[0].first).toBe('a');
    expect(g.current.a).toEqual(emptyPositions());
  });

  it('declares a winner at the target and can skunk', () => {
    const g = playRound(newGame(3), ['hole', 'floor', 'floor', 'floor'], emptyPositions());
    expect(g.winner).toBe('a');
    expect(totals(g)).toEqual({ a: 3, b: 0 });
  });

  it('gives the next first throw to whoever scored', () => {
    let g = setFirst(newGame(), 'b'); // B opens
    g = playRound(g, ['hole', 'floor', 'floor', 'floor'], emptyPositions()); // A scores
    expect(g.nextFirst).toBe('a');
  });

  it('leaves the first thrower unchanged on a wash', () => {
    let g = setFirst(newGame(), 'b');
    g = playRound(g, emptyPositions(), emptyPositions()); // 0-0 wash
    expect(g.nextFirst).toBe('b');
  });
});

describe('undoRound', () => {
  it('restores the board, totals, first thrower and clears a win', () => {
    let g = playRound(newGame(3), ['hole', 'floor', 'floor', 'floor'], emptyPositions());
    expect(g.winner).toBe('a');
    g = undoRound(g);
    expect(g.rounds).toHaveLength(0);
    expect(g.winner).toBeNull();
    expect(totals(g)).toEqual({ a: 0, b: 0 });
    expect(g.current.a).toEqual(['hole', 'floor', 'floor', 'floor']);
    expect(g.nextFirst).toBe('a');
  });

  it('is a no-op with no committed rounds', () => {
    const g = newGame();
    expect(undoRound(g)).toEqual(g);
  });
});

describe('round completeness', () => {
  it('counts unthrown bags across both teams', () => {
    let g = newGame();
    expect(unthrownCount(g)).toBe(8);
    expect(roundComplete(g)).toBe(false);
    g = place(g, 'a', ['hole', 'board', 'floor', 'floor']);
    expect(unthrownCount(g)).toBe(4);
    g = place(g, 'b', ['floor', 'floor', 'floor', 'floor']);
    expect(unthrownCount(g)).toBe(0);
    expect(roundComplete(g)).toBe(true);
  });
});

describe('teamLabel', () => {
  it('is the single player in singles', () => {
    const g = { ...newGame(), mode: 'singles', players: { a: ['Alice', 'Bob'], b: ['Carol', 'Dave'] } };
    expect(teamLabel(g, 'a')).toBe('Alice');
  });

  it('joins both partners in doubles', () => {
    const g = { ...newGame(), mode: 'doubles', players: { a: ['Alice', 'Bob'], b: ['Carol', 'Dave'] } };
    expect(teamLabel(g, 'a')).toBe('Alice & Bob');
  });
});

describe('winVerb', () => {
  const singles = { ...newGame(), mode: 'singles', players: { a: ['Alice', 'Bob'], b: ['Carol', 'Dave'] } };
  const doubles = { ...singles, mode: 'doubles' };

  it('agrees with one name', () => {
    expect(winVerb(teamLabel(singles, 'a'))).toBe('wins');
    expect(`${teamLabel(singles, 'a')} ${winVerb(teamLabel(singles, 'a'))}`).toBe('Alice wins');
  });

  it('agrees with a pair', () => {
    expect(winVerb(teamLabel(doubles, 'a'))).toBe('win');
    expect(`${teamLabel(doubles, 'a')} ${winVerb(teamLabel(doubles, 'a'))}`).toBe(
      'Alice & Bob win',
    );
  });

  // The display gets the joined label out of the payload and never the mode, so
  // it has to reach the same answer from the string alone.
  it('works on a bare label, which is all the external display receives', () => {
    expect(winVerb('Alice & Bob')).toBe('win');
    expect(winVerb('Alice')).toBe('wins');
  });

  it('does not fall over on a missing label', () => {
    expect(winVerb(undefined)).toBe('wins');
    expect(winVerb(null)).toBe('wins');
  });
});

describe('clampTarget', () => {
  it('caps at what two digits can show', () => {
    expect(clampTarget(120)).toBe(MAX_TARGET);
    expect(clampTarget(99)).toBe(99);
    expect(clampTarget(21)).toBe(21);
  });

  it('falls back for values that are not a playable target', () => {
    expect(clampTarget('', 15)).toBe(15);
    expect(clampTarget('abc', 15)).toBe(15);
    expect(clampTarget(0, 15)).toBe(15);
    expect(clampTarget(-3, 15)).toBe(15);
    expect(clampTarget(undefined, 15)).toBe(15);
  });

  it('accepts the digits typed so far while typing', () => {
    expect(clampTarget('2', 21)).toBe(2);
    expect(clampTarget('21', 21)).toBe(21);
  });
});
