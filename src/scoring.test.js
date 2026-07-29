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
  throwFirst,
  swapEnds,
  setStartSide,
  courtPositions,
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

// Which team is in the left and right box at one end, as team letters.
function order(end) {
  return ['left', 'right'].map((s) => end.boxes[s]?.team ?? '-').join('');
}

function named(mode) {
  return {
    ...newGame(),
    mode,
    players: { a: ['A0', 'A1'], b: ['B0', 'B1'] },
  };
}

// A wash leaves the first thrower alone, so these play out without disturbing
// anything but the round count.
function washRound(game) {
  return playRound(game, ['floor', 'floor', 'floor', 'floor'], [
    'floor',
    'floor',
    'floor',
    'floor',
  ]);
}

describe('courtPositions', () => {
  it('alternates the throwing end every round', () => {
    let game = named('singles');
    for (const expected of [0, 1, 0, 1, 0]) {
      expect(courtPositions(game).throwingEnd).toBe(expected);
      game = washRound(game);
    }
  });

  it('keeps a singles player on the same side all game, and only moves the end', () => {
    let game = named('singles');
    for (let r = 0; r < 4; r += 1) {
      const { ends, throwingEnd } = courtPositions(game);
      expect(order(ends[throwingEnd])).toBe('ab');
      expect(ends[throwingEnd].boxes.left.name).toBe('A0');
      expect(ends[throwingEnd].boxes.right.name).toBe('B0');
      // Nobody is at the other end until they walk down.
      expect(order(ends[1 - throwingEnd])).toBe('--');
      game = washRound(game);
    }
  });

  it('swaps the doubles boxes every second round, on a four-cycle', () => {
    let game = named('doubles');
    for (const expected of ['ab', 'ab', 'ba', 'ba', 'ab', 'ab', 'ba']) {
      const { ends, throwingEnd } = courtPositions(game);
      expect(order(ends[throwingEnd])).toBe(expected);
      game = washRound(game);
    }
  });

  it('draws a waiting doubles end where it will throw from next round', () => {
    let game = named('doubles');
    const waiting = [];
    for (let r = 0; r < 6; r += 1) {
      const { ends, throwingEnd } = courtPositions(game);
      waiting.push({ end: 1 - throwingEnd, order: order(ends[1 - throwingEnd]) });
      game = washRound(game);
      const next = courtPositions(game);
      // The row it showed while waiting is the row it throws from, so no end
      // ever appears to move without its turn coming round.
      expect(order(next.ends[next.throwingEnd])).toBe(waiting[r].order);
    }
  });

  it('keeps each doubles partner at their own end all game', () => {
    let game = named('doubles');
    for (let r = 0; r < 5; r += 1) {
      const { ends } = courtPositions(game);
      for (const end of [0, 1]) {
        const names = ['left', 'right'].map((s) => ends[end].boxes[s].name).sort();
        expect(names).toEqual([`A${end}`, `B${end}`]);
      }
      game = washRound(game);
    }
  });

  it('always puts the two teams in opposite boxes', () => {
    for (const mode of ['singles', 'doubles']) {
      let game = named(mode);
      for (let r = 0; r < 5; r += 1) {
        for (const end of courtPositions(game).ends) {
          expect(order(end)).toMatch(/^(ab|ba|--)$/);
        }
        game = washRound(game);
      }
    }
  });

  it('agrees with the doubles thrower that the rest of the app derives', () => {
    let game = named('doubles');
    for (let r = 0; r < 5; r += 1) {
      const { ends, throwingEnd } = courtPositions(game);
      const up = ['left', 'right'].map((s) => ends[throwingEnd].boxes[s].name);
      // Mirrors activeIdx in App.jsx and throwerFor in stats.js.
      expect(up.sort()).toEqual([`A${r % 2}`, `B${r % 2}`]);
      game = washRound(game);
    }
  });

  it('mirrors the whole court when team A starts on the right', () => {
    const game = setStartSide(named('doubles'), 'right');
    const { ends } = courtPositions(game);
    expect(order(ends[0])).toBe('ba');
    expect(order(ends[1])).toBe('ba');
  });

  it('reverts with an undone round', () => {
    let game = named('doubles');
    const atStart = courtPositions(game);
    game = washRound(washRound(game));
    expect(order(courtPositions(game).ends[0])).not.toBe(order(atStart.ends[0]));
    game = undoRound(undoRound(game));
    expect(courtPositions(game)).toEqual(atStart);
  });

  it('falls back to the left for a game saved before the side existed', () => {
    const game = { ...named('doubles'), startSide: undefined };
    expect(order(courtPositions(game).ends[0])).toBe('ab');
  });

  it('labels each box with the slot its name came from', () => {
    // What lets a tap on the drawing act on the right player without the
    // component re-deriving the doubles slot rule.
    const doubles = courtPositions(named('doubles')).ends;
    expect(doubles.map((end) => end.boxes.left.slot)).toEqual([0, 1]);
    expect(doubles.map((end) => end.boxes.left.name)).toEqual(['A0', 'A1']);
    const singles = courtPositions(named('singles')).ends;
    expect(singles[0].boxes.left.slot).toBe(0);
  });
});

// Which player is up first, as the whole app derives it: the box at the throwing
// end belonging to the team due to lead.
function opener(game) {
  const { ends, throwingEnd, first } = courtPositions(game);
  return ['left', 'right']
    .map((s) => ends[throwingEnd].boxes[s])
    .find((box) => box?.team === first)?.name;
}

describe('throwFirst', () => {
  it('gives the opening bag to whoever is named, from any of the four boxes', () => {
    const game = named('doubles');
    for (const team of ['a', 'b']) {
      for (const slot of [0, 1]) {
        expect(opener(throwFirst(game, team, slot))).toBe(game.players[team][slot]);
      }
    }
  });

  it('rearranges nobody when the partner already at the near end is named', () => {
    const game = named('doubles');
    expect(throwFirst(game, 'b', 0).players).toEqual(game.players);
  });

  it('swaps only the named pair when the far partner is named', () => {
    const g = throwFirst(named('doubles'), 'b', 1);
    expect(g.players.b).toEqual(['B1', 'B0']);
    expect(g.players.a).toEqual(['A0', 'A1']);
  });

  it('keeps the named partner at their new end for the rest of the game', () => {
    // Slot order is a whole-game fact, so the swap has to survive the doubles
    // four-cycle rather than only holding for round one.
    let game = throwFirst(named('doubles'), 'a', 1);
    for (let r = 0; r < 4; r += 1) {
      const { ends } = courtPositions(game);
      expect(['left', 'right'].map((s) => ends[0].boxes[s].name)).toContain('A1');
      game = washRound(game);
    }
  });

  it('is only a change of team in singles, where nobody is at the far end', () => {
    const game = named('singles');
    const g = throwFirst(game, 'b', 0);
    expect(opener(g)).toBe('B0');
    expect(g.players).toEqual(game.players);
  });
});

describe('swapEnds', () => {
  it('reorders one team and leaves the other, and the lead, alone', () => {
    const game = setFirst(named('doubles'), 'b');
    const g = swapEnds(game, 'a');
    expect(g.players.a).toEqual(['A1', 'A0']);
    expect(g.players.b).toEqual(['B0', 'B1']);
    expect(g.nextFirst).toBe('b');
  });
});

describe('setStartSide', () => {
  it('only accepts a side', () => {
    expect(setStartSide(newGame(), 'right').startSide).toBe('right');
    expect(setStartSide(newGame(), 'left').startSide).toBe('left');
    expect(setStartSide(newGame(), 'sideways').startSide).toBe('left');
  });
});
