import { describe, it, expect } from 'vitest';
import {
  MAX_TARGET,
  TEAM_JOIN,
  clampTarget,
  emptyPositions,
  lineupFaults,
  rawPoints,
  tierCounts,
  roundNets,
  newGame,
  playerLabel,
  sideLabel,
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
  restOnFloor,
  roundReport,
  roundLine,
  validGame,
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

describe('validGame', () => {
  // The corpus is the one that was measured against a real browser: each rejection
  // below is a save that blanked the app and stayed blank, because the crash is
  // during render so nothing ever writes the bad value back out.
  const played = playRound(newGame(), ['hole', 'board', 'floor', 'floor'], [
    'board',
    'floor',
    'floor',
    'floor',
  ]);

  it('accepts a fresh game and one with rounds played', () => {
    expect(validGame(newGame())).toBe(true);
    expect(validGame(played)).toBe(true);
  });

  it('accepts a game with no id, because identified() adds it afterwards', () => {
    expect(validGame({ ...newGame(), id: undefined })).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string', 'game'],
    ['an array', []],
    ['nothing at all', {}],
  ])('rejects %s', (_label, value) => {
    expect(validGame(value)).toBe(false);
  });

  it.each([
    ['rounds as an object', { rounds: { 0: played.rounds[0] } }],
    ['rounds as a string', { rounds: 'three' }],
    ['rounds as a number', { rounds: 3 }],
    ['a null round', { rounds: [null] }],
    ['a round missing a team', { rounds: [{ a: played.rounds[0].a, nets: { a: 2, b: 0 } }] }],
    ['a round with a short side', { rounds: [{ ...played.rounds[0], a: ['hole'] }] }],
    [
      'a round with an unknown tier',
      { rounds: [{ ...played.rounds[0], a: ['roof', 'floor', 'floor', 'floor'] }] },
    ],
    ['a round with no nets', { rounds: [{ a: played.rounds[0].a, b: played.rounds[0].b }] }],
    ['a round whose first names no team', { rounds: [{ ...played.rounds[0], first: 'z' }] }],
    ['current as a string', { current: 'nope' }],
    ['current as null', { current: null }],
    ['current missing a side', { current: { a: emptyPositions() } }],
    ['current side as a string', { current: { a: 'hole', b: emptyPositions() } }],
    ['current side too short', { current: { a: ['hole'], b: emptyPositions() } }],
    ['winner naming an absent team', { winner: 'c' }],
    ['winner as an object', { winner: {} }],
    ['nextFirst out of range', { nextFirst: 'z' }],
    ['nextFirst as null', { nextFirst: null }],
    ['startSide out of range', { startSide: 'up' }],
    ['players as null', { players: null }],
    ['players missing a team', { players: { a: ['Rho', 'Tau'] } }],
    ['players team as a string', { players: { a: 'Rho', b: ['Sigma', 'Phi'] } }],
    ['an object in a player slot', { players: { a: [{}, 'Tau'], b: ['Sigma', 'Phi'] } }],
    ['a number in a player slot', { players: { a: [7, 'Tau'], b: ['Sigma', 'Phi'] } }],
    ['a team with one slot', { players: { a: ['Rho'], b: ['Sigma', 'Phi'] } }],
    ['colors as null', { colors: null }],
    ['colors as a string', { colors: 'blue' }],
    ['a colour that is not a string', { colors: { a: 0x2f80ed, b: '#eb5757' } }],
    ['mode unknown', { mode: 'triples' }],
    ['casual as a string', { casual: 'yes' }],
    ['tournament as a number', { tournament: 7 }],
    ['target as a string', { target: 'lots' }],
    ['target as zero', { target: 0 }],
  ])('rejects %s', (_label, patch) => {
    expect(validGame({ ...played, ...patch })).toBe(false);
  });

  // A target above the two-digit cap is not corruption: `MAX_TARGET` arrived after
  // the app shipped, so a save can legitimately hold one and refusing it would
  // throw away a game that has always loaded. Clamping is the display's job.
  it('keeps a target from before the two-digit cap', () => {
    expect(validGame({ ...played, target: MAX_TARGET + 1 })).toBe(true);
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

describe('roundReport', () => {
  const ALL_IN = ['hole', 'hole', 'hole', 'hole'];
  const named = (target, over = {}) => ({
    ...newGame(target),
    players: { a: ['Rho', 'Tau'], b: ['Sigma', 'Phi'] },
    ...over,
  });

  it('has nothing to say before the first round is committed', () => {
    expect(roundReport(named())).toBe('');
  });

  it('names the scorer, what they scored and where that leaves both sides', () => {
    const g = playRound(named(), ['hole', 'board', 'floor', 'floor'], ['board', 'floor', 'floor', 'floor']);
    expect(roundReport(g)).toBe('Round 1: Rho scored 3. Rho 3, Sigma 0.');
  });

  it('counts the rounds, not just the last one', () => {
    let g = playRound(named(), ['hole', 'floor', 'floor', 'floor'], emptyPositions());
    g = playRound(g, emptyPositions(), ['board', 'board', 'floor', 'floor']);
    expect(roundReport(g)).toBe('Round 2: Sigma scored 2. Rho 3, Sigma 2.');
  });

  it('says a wash rather than naming a scorer, and still gives the score', () => {
    let g = playRound(named(), ['hole', 'floor', 'floor', 'floor'], emptyPositions());
    g = playRound(g, ['board', 'floor', 'floor', 'floor'], ['board', 'floor', 'floor', 'floor']);
    expect(roundReport(g)).toBe('Round 2: wash. Rho 3, Sigma 0.');
  });

  it('calls a four bagger without naming the side, because the sentence before it has', () => {
    const g = playRound(named(), ALL_IN, emptyPositions());
    expect(roundReport(g)).toBe('Round 1: Rho scored 12. Four bagger! Rho 12, Sigma 0.');
  });

  it('says nothing of the sort for three in the hole', () => {
    const g = playRound(named(), ['hole', 'hole', 'hole', 'floor'], emptyPositions());
    expect(roundReport(g)).toBe('Round 1: Rho scored 9. Rho 9, Sigma 0.');
  });

  it('pluralises when both sides put all four in, which is the only way to wash one', () => {
    const g = playRound(named(), ALL_IN, ALL_IN);
    expect(roundReport(g)).toBe('Round 1: wash. Four baggers! Rho 0, Sigma 0.');
  });

  it('replaces the score line with the result, and takes the plural from the label', () => {
    let g = playRound(named(4, { mode: 'doubles' }), emptyPositions(), ['board', 'floor', 'floor', 'floor']);
    g = playRound(g, ['hole', 'board', 'floor', 'floor'], emptyPositions());
    expect(roundReport(g)).toBe('Round 2: Rho & Tau scored 4. Rho & Tau win, 4 to 1.');
  });

  it('calls a skunk when the loser never scored', () => {
    const g = playRound(named(3), ['hole', 'floor', 'floor', 'floor'], emptyPositions());
    expect(roundReport(g)).toBe('Round 1: Rho scored 3. Rho wins, 3 to 0. Skunk!');
  });

  it('walks back with an undo rather than reporting a round that is no longer played', () => {
    let g = playRound(named(6), ['hole', 'floor', 'floor', 'floor'], emptyPositions());
    g = playRound(g, ['hole', 'floor', 'floor', 'floor'], emptyPositions());
    expect(roundReport(g)).toBe('Round 2: Rho scored 3. Rho wins, 6 to 0. Skunk!');
    expect(roundReport(undoRound(g))).toBe('Round 1: Rho scored 3. Rho 3, Sigma 0.');
  });

  it('says the colour in a guest game, like everything else that names a player', () => {
    const g = playRound(named(21, { casual: true }), ['hole', 'floor', 'floor', 'floor'], emptyPositions());
    expect(roundReport(g)).toBe('Round 1: Blue scored 3. Blue 3, Red 0.');
  });
});

describe('roundLine', () => {
  const named = (over = {}) => ({
    ...newGame(),
    players: { a: ['Rho', 'Tau'], b: ['Sigma', 'Phi'] },
    ...over,
  });
  const line = (game, a, b, team) => roundLine(game, playRound(game, a, b).rounds[0], team);

  it('names the team, because the two halves of a row are otherwise identical', () => {
    const g = named();
    const a = ['hole', 'hole', 'board', 'board'];
    expect(line(g, a, a, 'a')).toBe('Rho: 2 in the hole, 2 on the board, no points.');
    expect(line(g, a, a, 'b')).toBe('Sigma: 2 in the hole, 2 on the board, no points.');
  });

  it('gives the net rather than leaving it to be worked out from the counts', () => {
    const g = named();
    expect(line(g, ['hole', 'hole', 'hole', 'hole'], emptyPositions(), 'a')).toBe(
      'Rho: 4 in the hole, scored 12.',
    );
  });

  // The visible cell shows both counts whatever they are, but a zero read aloud is a
  // word spent saying nothing happened — and every row has at least one.
  it('leaves out a tier nothing landed on', () => {
    const g = named();
    expect(line(g, ['board', 'floor', 'floor', 'floor'], emptyPositions(), 'a')).toBe(
      'Rho: 1 on the board, scored 1.',
    );
  });

  it('says so plainly when a side put nothing on at all', () => {
    const g = named();
    expect(line(g, ['hole', 'floor', 'floor', 'floor'], emptyPositions(), 'b')).toBe(
      'Sigma: nothing on, no points.',
    );
  });

  // Cancellation, so a side can out-throw the other and still score nothing — which is
  // the row a reader is most likely to be checking.
  it('separates what was thrown from what it was worth', () => {
    const g = named();
    expect(line(g, ['hole', 'board', 'floor', 'floor'], ['hole', 'board', 'floor', 'floor'], 'a')).toBe(
      'Rho: 1 in the hole, 1 on the board, no points.',
    );
  });

  it('takes both partners in doubles, so the row names a side rather than a thrower', () => {
    const g = named({ mode: 'doubles' });
    expect(line(g, ['hole', 'floor', 'floor', 'floor'], emptyPositions(), 'a')).toBe(
      'Rho & Tau: 1 in the hole, scored 3.',
    );
  });

  it('says the colour in a guest game, like everything else that names a player', () => {
    const g = named({ casual: true });
    expect(line(g, ['hole', 'floor', 'floor', 'floor'], emptyPositions(), 'a')).toBe(
      'Blue: 1 in the hole, scored 3.',
    );
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

describe('restOnFloor', () => {
  it('places every unthrown bag and leaves the thrown ones where they are', () => {
    let g = place(newGame(), 'a', ['hole', 'board']);
    g = restOnFloor(g);
    expect(g.current.a).toEqual(['hole', 'board', 'floor', 'floor']);
    expect(g.current.b).toEqual(['floor', 'floor', 'floor', 'floor']);
    expect(roundComplete(g)).toBe(true);
  });

  it('does not commit the round', () => {
    const g = restOnFloor(newGame());
    expect(g.rounds).toEqual([]);
    expect(totals(g)).toEqual({ a: 0, b: 0 });
  });

  // Both are the same fact: nothing to place means nothing to do, and the
  // reducer bails on an unchanged state rather than re-rendering.
  it('is the same game when every bag is already placed', () => {
    const g = place(place(newGame(), 'a', ['floor', 'floor', 'floor', 'floor']), 'b', [
      'hole',
      'hole',
      'board',
      'floor',
    ]);
    expect(restOnFloor(g)).toBe(g);
  });

  it('is the same game once it is won', () => {
    const g = { ...newGame(), winner: 'a' };
    expect(restOnFloor(g)).toBe(g);
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

  // A label is all `winVerb` and the panel's `splitPair` get, and both read the join
  // to tell a pair from one person — so a name carrying the join would be one person
  // announced as two, and drawn on the panel as "Ben/Jerry" with half of it ruled as
  // the partner who is up. Any spacing that contains the join has to go, not just
  // the exact form: " & " and "  &  " are both it.
  describe('keeps the join out of the names it joins', () => {
    const singles = (name) => ({
      ...newGame(),
      mode: 'singles',
      players: { a: [name, ''], b: ['Carol', ''] },
    });

    it('collapses an ampersand inside a singles name', () => {
      expect(teamLabel(singles('Ben & Jerry'), 'a')).toBe('Ben&Jerry');
      expect(teamLabel(singles('Ben  &  Jerry'), 'a')).toBe('Ben&Jerry');
      expect(teamLabel(singles('Ben & Jerry & Co'), 'a')).toBe('Ben&Jerry&Co');
    });

    // Left alone where it already reads as one name, which is the point — the rule
    // is about the join, not about the character.
    it('leaves a bare ampersand as typed', () => {
      expect(teamLabel(singles('Ben&Jerry'), 'a')).toBe('Ben&Jerry');
    });

    it('leaves one join in a doubles label whichever partner carries an ampersand', () => {
      const g = {
        ...newGame(),
        mode: 'doubles',
        players: { a: ['Ben & Jerry', 'Tau'], b: ['Carol', 'Dave'] },
      };
      expect(teamLabel(g, 'a')).toBe('Ben&Jerry & Tau');
      expect(teamLabel(g, 'a').split(TEAM_JOIN)).toHaveLength(2);
    });

    // The blank half survives: `labelPart` in render.h rules the whole label when a
    // partner's side of the slash came out empty, and it needs the join to find it.
    it('keeps the join when a partner is blank', () => {
      const g = { ...newGame(), mode: 'doubles', players: { a: ['Rho', ''], b: ['Carol', 'Dave'] } };
      expect(teamLabel(g, 'a')).toBe('Rho & ');
    });
  });
});

describe('sideLabel', () => {
  it('writes one name and a pair', () => {
    expect(sideLabel(['Rho'])).toBe('Rho');
    expect(sideLabel(['Rho', 'Tau'])).toBe('Rho & Tau');
  });

  it('applies the same rule as teamLabel, so the two screens agree', () => {
    expect(sideLabel(['Ben & Jerry', 'Tau'])).toBe('Ben&Jerry & Tau');
  });

  it('does not fall over on a missing list', () => {
    expect(sideLabel(undefined)).toBe('');
  });
});

// A guest game takes no names, so the team's colour is the identity. Everything
// that names a player goes through playerLabel, which is what keeps the phone,
// the court, the display and the LED panel saying the same thing.
describe('casual games', () => {
  const named = {
    ...newGame(),
    mode: 'doubles',
    players: { a: ['Rho', 'Tau'], b: ['Phi', 'Chi'] },
  };
  const casual = { ...named, casual: true };

  it('is off by default', () => {
    expect(newGame().casual).toBe(false);
  });

  it('labels every slot with its team colour', () => {
    expect(playerLabel(casual, 'a', 0)).toBe('Blue');
    expect(playerLabel(casual, 'a', 1)).toBe('Blue');
    expect(playerLabel(casual, 'b', 0)).toBe('Red');
  });

  it('reads the typed name when it is off', () => {
    expect(playerLabel(named, 'a', 1)).toBe('Tau');
  });

  it('follows the colour a team actually holds', () => {
    const swapped = { ...casual, colors: { a: '#27ae60', b: '#f2c94c' } };
    expect(playerLabel(swapped, 'a', 0)).toBe('Green');
    expect(playerLabel(swapped, 'b', 0)).toBe('Yellow');
  });

  it('falls back to the team letter for a colour off the palette', () => {
    const odd = { ...casual, colors: { a: '#123456', b: '#eb5757' } };
    expect(playerLabel(odd, 'a', 0)).toBe('Team A');
  });

  // Leaving `players` untouched is what makes the toggle reversible: turning it
  // off brings the typed names back rather than having overwritten them.
  it('hides the names without overwriting them', () => {
    expect(casual.players).toEqual(named.players);
    expect(playerLabel({ ...casual, casual: false }, 'a', 0)).toBe('Rho');
  });

  it('gives a doubles team one label rather than the pair joined', () => {
    expect(teamLabel(casual, 'a')).toBe('Blue');
    expect(teamLabel(named, 'a')).toBe('Rho & Tau');
  });

  // The known cost of reading the verb off the label rather than the mode: a
  // casual pair is a team name, so it takes the singular.
  it('takes the singular win verb even in doubles', () => {
    expect(`${teamLabel(casual, 'a')} ${winVerb(teamLabel(casual, 'a'))}`).toBe('Blue wins');
  });

  it('names the court boxes by colour too', () => {
    const { ends } = courtPositions(casual);
    expect(ends[0].boxes.left.name).toBe('Blue');
    expect(ends[0].boxes.right.name).toBe('Red');
    expect(ends[1].boxes.left.name).toBe('Blue');
  });

  it('changes nothing about scoring or where people stand', () => {
    expect(courtPositions(casual).throwingEnd).toBe(courtPositions(named).throwingEnd);
    const played = playRound(casual, ['hole', 'floor', 'floor', 'floor'], emptyPositions());
    expect(totals(played)).toEqual({ a: 3, b: 0 });
  });
});

// Nobody can play themselves, and nobody plays nameless. One name in two slots is
// one person on both sides of the court, and the career fold would credit them the
// win and the loss for the same match; a blank slot is credited to nobody at all.
describe('lineupFaults', () => {
  const singles = { ...newGame(), players: { a: ['Rho', 'Tau'], b: ['Phi', 'Chi'] } };
  const doubles = { ...singles, mode: 'doubles' };
  const lineup = (players, extra = {}) => ({ ...doubles, players, ...extra });
  const at = (faults) => faults.map((f) => `${f.team}${f.slot}:${f.fault}`);

  it('passes a lineup of four different people', () => {
    expect(lineupFaults(doubles)).toEqual([]);
  });

  it('passes the defaults, which is the lineup the app opens on', () => {
    expect(lineupFaults(newGame())).toEqual([]);
    expect(lineupFaults({ ...newGame(), mode: 'doubles' })).toEqual([]);
  });

  it('catches one player on both teams, on both of their slots', () => {
    const faults = lineupFaults({ ...singles, players: { a: ['Rho', 'Tau'], b: ['Rho', 'Chi'] } });
    expect(at(faults)).toEqual(['a0:twice', 'b0:twice']);
    expect(faults.map((f) => f.name)).toEqual(['Rho', 'Rho']);
  });

  it('catches someone partnering themselves', () => {
    expect(at(lineupFaults(lineup({ a: ['Rho', 'Rho'], b: ['Phi', 'Chi'] })))).toEqual([
      'a0:twice',
      'a1:twice',
    ]);
  });

  it('folds spelling the same way the career does', () => {
    expect(at(lineupFaults({ ...singles, players: { a: [' rho ', 'Tau'], b: ['Rho', 'Chi'] } })))
      .toEqual(['a0:twice', 'b0:twice']);
  });

  // Singles never reads the second slot, so the default partner sitting on both
  // teams is not a fault until doubles is chosen.
  it('only looks at the slots the mode plays', () => {
    const shared = { ...singles, players: { a: ['Rho', 'Sigma'], b: ['Phi', 'Sigma'] } };
    expect(lineupFaults(shared)).toEqual([]);
    expect(at(lineupFaults({ ...shared, mode: 'doubles' }))).toEqual(['a1:twice', 'b1:twice']);
  });

  it('names both when a whole pair is repeated', () => {
    const faults = lineupFaults(lineup({ a: ['Rho', 'Tau'], b: ['Rho', 'Tau'] }));
    expect(at(faults)).toEqual(['a0:twice', 'a1:twice', 'b0:twice', 'b1:twice']);
    expect([...new Set(faults.map((f) => f.name))]).toEqual(['Rho', 'Tau']);
  });

  it('catches a slot with no name, whitespace included', () => {
    expect(at(lineupFaults(lineup({ a: ['Rho', ''], b: ['Phi', '  '] })))).toEqual([
      'a1:blank',
      'b1:blank',
    ]);
  });

  // Two of them are two missing names, not one name entered twice — a blank is
  // nobody, so there is no person to be on both sides.
  it('does not read two blanks as the same player', () => {
    const faults = lineupFaults(lineup({ a: ['Rho', ''], b: ['Phi', ''] }));
    expect(faults.every((f) => f.fault === 'blank')).toBe(true);
  });

  it('reports a blank and a repeat in the same lineup', () => {
    expect(at(lineupFaults(lineup({ a: ['Rho', ''], b: ['Rho', 'Chi'] })))).toEqual([
      'a0:twice',
      'a1:blank',
      'b0:twice',
    ]);
  });

  // A guest game has nothing to find: every slot is the team's colour, and the
  // slots still hold whatever was typed for the last real game.
  it('has nothing to say about a guest game', () => {
    expect(lineupFaults(lineup({ a: ['Rho', 'Rho'], b: ['', ''] }, { casual: true }))).toEqual([]);
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

  // Exact rather than a guess: the verb can only be read off the string, so it is
  // `teamLabel` keeping the join out of a name that makes the string answerable.
  it('stays singular for a player whose own name has an ampersand', () => {
    const g = { ...newGame(), mode: 'singles', players: { a: ['Ben & Jerry', ''], b: ['Carol', ''] } };
    expect(`${teamLabel(g, 'a')} ${winVerb(teamLabel(g, 'a'))}`).toBe('Ben&Jerry wins');
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
