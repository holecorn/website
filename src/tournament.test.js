import { describe, expect, it } from 'vitest';
import {
  MIN_ENTRANTS,
  bracket,
  bracketShape,
  bracketTree,
  entrantFaults,
  lastPlayed,
  levelName,
  mergeTournaments,
  newTournament,
  newestFirst,
  removeTournament,
  shuffled,
  tieLabels,
  tieSetup,
  unfinished,
  upsertTournament,
  validTournament,
} from './tournament.js';

// Eleven singles entrants, which is the field the paper bracket this was designed
// against had. Greek, because the real family must not be in a public repo.
const ELEVEN = [
  'Rho',
  'Tau',
  'Sigma',
  'Phi',
  'Chi',
  'Psi',
  'Omega',
  'Iota',
  'Kappa',
  'Zeta',
  'Beta',
];

function tournamentOf(entrants, mode = 'singles') {
  return newTournament({
    id: 't1',
    name: 'Hole Corn V',
    mode,
    target: 21,
    entrants: entrants.map((e) => (Array.isArray(e) ? e : [e])),
    createdAt: 1,
  });
}

// A finished tie as the archive would hold it: no rounds are needed, because the
// bracket only ever reads the sides and the winner. Deliberately the shape an
// imported legacy record has, so the same fixture covers both.
let stamp = 0;
function tie(tournamentId, mode, a, b, winner) {
  stamp += 1;
  return {
    id: `m${stamp}`,
    tournament: tournamentId,
    mode,
    players: {
      a: mode === 'doubles' ? a : [a[0], ''],
      b: mode === 'doubles' ? b : [b[0], ''],
    },
    winner,
    final: winner === 'a' ? { a: 21, b: 11 } : { a: 11, b: 21 },
    rounds: [],
    endedAt: 1000 + stamp,
  };
}

// Play the given tie by name, whoever the bracket says is in it.
function beat(matches, t, winnerName) {
  const b = bracket(t, matches);
  const found = b.playable.find(
    (x) => x.a.names.includes(winnerName) || x.b.names.includes(winnerName),
  );
  if (!found) throw new Error(`${winnerName} has no playable tie`);
  const side = found.a.names.includes(winnerName) ? 'a' : 'b';
  return [...matches, tie(t.id, t.mode, found.a.names, found.b.names, side)];
}

describe('bracketShape', () => {
  it('plays off the excess and byes the rest', () => {
    // n - p preliminary ties among 2(n - p) entrants, 2p - n byes.
    expect(bracketShape(11)).toMatchObject({ size: 8, rounds: 4 });
    expect(bracketShape(11).seats.filter((s) => s === 2)).toHaveLength(3);
    expect(bracketShape(11).seats.filter((s) => s === 1)).toHaveLength(5);
  });

  it('reproduces the paper bracket for eleven', () => {
    // Preliminaries at seats 1, 2 and 5 as drawn, which is what makes the app's
    // bracket look like the one the family knows. Any arrangement is equally fair.
    expect(bracketShape(11).seats).toEqual([2, 2, 1, 1, 2, 1, 1, 1]);
  });

  it('needs no preliminaries at a power of two', () => {
    expect(bracketShape(8).seats).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect(bracketShape(8).rounds).toBe(3);
    expect(bracketShape(16).rounds).toBe(4);
  });

  it('always totals the field, and never overfills a half', () => {
    for (let n = 2; n <= 40; n += 1) {
      const { seats, size } = bracketShape(n);
      expect(seats).toHaveLength(size);
      expect(seats.reduce((a, b) => a + b, 0)).toBe(n);
      expect(Math.max(...seats)).toBeLessThanOrEqual(2);
    }
  });

  it('spreads the preliminaries across both halves', () => {
    // The whole point of alternating: they do not all land on one side of the page.
    const { seats, size } = bracketShape(12);
    const left = seats.slice(0, size / 2).filter((s) => s === 2).length;
    const right = seats.slice(size / 2).filter((s) => s === 2).length;
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
  });
});

describe('levelName', () => {
  it('names the deepest level a preliminary only when the field is uneven', () => {
    expect(levelName(4, bracketShape(11))).toBe('Preliminary');
    expect(levelName(4, bracketShape(16))).toBe('Round of 16');
  });

  it('counts up from the final', () => {
    const shape = bracketShape(11);
    expect(levelName(1, shape)).toBe('Final');
    expect(levelName(2, shape)).toBe('Semi-final');
    expect(levelName(3, shape)).toBe('Quarter-final');
  });
});

describe('bracket', () => {
  it('is n - 1 ties however the field is shaped', () => {
    for (let n = 2; n <= 33; n += 1) {
      const t = tournamentOf(Array.from({ length: n }, (_, i) => `P${i}`));
      expect(bracket(t).ties).toHaveLength(n - 1);
      expect(bracket(t).total).toBe(n - 1);
    }
  });

  it('refuses a field too small to have a tie in it', () => {
    expect(bracket(tournamentOf(['Rho']))).toBeNull();
    expect(bracket(tournamentOf([]))).toBeNull();
    expect(MIN_ENTRANTS).toBe(2);
  });

  it('forces who has the harder path, whatever the layout', () => {
    // Kraft equality: for 11 in a depth-4 tree, six entrants must win four ties and
    // five must win three. Read off the tree rather than asserted from the formula.
    const b = bracket(tournamentOf(ELEVEN));
    const wins = new Map();
    for (const t of b.ties) {
      for (const side of [t.a, t.b]) {
        if (side) wins.set(side.names[0], t.level);
      }
    }
    const depths = [...wins.values()];
    expect(depths.filter((d) => d === 4)).toHaveLength(6);
    expect(depths.filter((d) => d === 3)).toHaveLength(5);
  });

  it('opens with the preliminaries and the bye-against-bye ties playable', () => {
    const b = bracket(tournamentOf(ELEVEN));
    // Three preliminaries, plus the two ties between byes that need nobody first —
    // which is why counting playable ties is not counting the first round.
    expect(b.playable).toHaveLength(5);
    expect(b.playable.filter((t) => t.level === 4)).toHaveLength(3);
    expect(b.playable.filter((t) => t.level === 3)).toHaveLength(2);
    expect(b.played).toBe(0);
    expect(b.done).toBe(false);
    expect(b.champion).toBeNull();
  });

  it('lets a structurally later tie be played first', () => {
    // Seats 3 and 4 are byes drawn against each other, so their tie is a level above
    // the preliminaries and can still go before any of them.
    const t = tournamentOf(ELEVEN);
    const matches = beat([], t, 'Chi');
    const b = bracket(t, matches);
    expect(b.played).toBe(1);
    expect(b.ties.find((x) => x.level === 3 && x.winner)?.winner.names).toEqual(['Chi']);
    // The three preliminaries are untouched and still waiting.
    expect(b.playable.filter((x) => x.level === 4)).toHaveLength(3);
    // And the tie just played has left the playable set rather than staying in it.
    expect(b.playable).toHaveLength(4);
    expect(b.playable.some((x) => x.match)).toBe(false);
  });

  it('holds a tie shut until both its sides are known', () => {
    const t = tournamentOf(ELEVEN);
    const b = bracket(t);
    const shut = b.ties.filter((x) => !x.playable);
    expect(shut.length).toBeGreaterThan(0);
    for (const x of shut) expect(x.a === null || x.b === null).toBe(true);
  });

  it('advances a winner and finds the champion', () => {
    const t = tournamentOf(ELEVEN);
    let matches = [];
    // Rho wins everything; everyone else's ties are decided by whoever is listed first.
    for (let i = 0; i < 10; i += 1) {
      const b = bracket(t, matches);
      const mine = b.playable.find((x) => x.a.names.includes('Rho') || x.b.names.includes('Rho'));
      if (mine) {
        matches = beat(matches, t, 'Rho');
      } else {
        const other = b.playable[0];
        matches = [...matches, tie(t.id, t.mode, other.a.names, other.b.names, 'a')];
      }
    }
    const b = bracket(t, matches);
    expect(b.played).toBe(10);
    expect(b.done).toBe(true);
    expect(b.champion.names).toEqual(['Rho']);
    expect(b.playable).toHaveLength(0);
  });

  it('un-plays a tie when its match goes, and everything above it with it', () => {
    // The reversibility the derived design exists for: undoing a winning round
    // un-archives the match, and the bracket recomputes with nothing to un-advance.
    const t = tournamentOf(ELEVEN);
    const withTie = beat([], t, 'Chi');
    expect(bracket(t, withTie).played).toBe(1);
    expect(bracket(t, []).played).toBe(0);
    expect(bracket(t, []).playable).toHaveLength(5);
  });

  it('ignores matches belonging to another tournament, or to none', () => {
    const t = tournamentOf(ELEVEN);
    const other = tie('t2', 'singles', ['Rho'], ['Tau'], 'a');
    const friendly = { ...tie('t1', 'singles', ['Rho'], ['Tau'], 'a'), tournament: undefined };
    expect(bracket(t, [other, friendly]).played).toBe(0);
  });

  it('ignores an unfinished match', () => {
    const t = tournamentOf(ELEVEN);
    const abandoned = { ...tie(t.id, 'singles', ['Rho'], ['Tau'], 'a'), winner: null };
    expect(bracket(t, [abandoned]).played).toBe(0);
  });

  it('matches a tie whichever team letter and slot order the sides held', () => {
    // A record's team letters and slot order are an accident of how the tie was
    // started, so the bracket has to read sides as sets — `sideKeyOf`'s whole job.
    const t = tournamentOf([['Rho', 'Tau'], ['Sigma', 'Phi']], 'doubles');
    const swapped = tie(t.id, 'doubles', ['Phi', 'Sigma'], ['Tau', 'Rho'], 'b');
    const b = bracket(t, [swapped]);
    expect(b.done).toBe(true);
    expect(b.champion.key).toBe(bracket(t).entrants[0].key);
  });

  it('groups ties into rounds deepest first', () => {
    const rounds = bracket(tournamentOf(ELEVEN)).rounds;
    expect(rounds.map((r) => r.name)).toEqual([
      'Preliminary',
      'Quarter-final',
      'Semi-final',
      'Final',
    ]);
    expect(rounds.map((r) => r.ties.length)).toEqual([3, 4, 2, 1]);
  });

  it('gives every tie a stable unique id', () => {
    const t = tournamentOf(ELEVEN);
    const ids = (matches) => bracket(t, matches).ties.map((x) => x.id);
    expect(new Set(ids([])).size).toBe(10);
    // Recomputing after a result must not renumber anything, or the screen's keys
    // and any selection made from them move under it.
    expect(ids(beat([], t, 'Chi'))).toEqual(ids([]));
  });

  it('puts the final in neither half and everything else in one', () => {
    const b = bracket(tournamentOf(ELEVEN));
    const final = b.ties.find((x) => x.level === 1);
    expect(final.half).toBeNull();
    expect(b.ties.filter((x) => x.half === 0).length).toBe(5);
    expect(b.ties.filter((x) => x.half === 1).length).toBe(4);
  });
});

describe('entrantFaults', () => {
  it('passes a clean field', () => {
    expect(entrantFaults(ELEVEN.map((n) => [n]))).toEqual([]);
  });

  it('refuses a nameless entrant', () => {
    expect(entrantFaults([['Rho'], ['  ']])).toEqual([{ index: 1, names: [''], fault: 'blank' }]);
  });

  it('refuses one person entered twice, naming both seats', () => {
    const faults = entrantFaults([['Rho'], ['Tau'], ['rho ']]);
    expect(faults.map((f) => f.index)).toEqual([0, 2]);
    expect(faults.every((f) => f.fault === 'twice')).toBe(true);
  });

  it('reads a doubles pair as one side, whichever order', () => {
    expect(entrantFaults([['Rho', 'Tau'], ['Tau', 'Rho']]).map((f) => f.index)).toEqual([0, 1]);
    expect(entrantFaults([['Rho', 'Tau'], ['Sigma', 'Phi']])).toEqual([]);
  });

  it('refuses a pair that is one person twice', () => {
    // They would be their own partner. `sideKeyOf` dedupes, so this cannot be caught by
    // the key — the side has to be counted against the slots it fills.
    expect(entrantFaults([['Rho', 'Rho'], ['Tau', 'Sigma']]).map((f) => f.index)).toEqual([0]);
    expect(entrantFaults([['Rho', 'Rho'], ['Rho']]).map((f) => f.index)).toEqual([0, 1]);
  });

  it('refuses a pair with one half missing, which the draw used to accept', () => {
    // The bug this rule exists for: the draw succeeded and the tie it produced could
    // never be started, because `lineupFaults` refuses a blank slot and `Start` stays
    // off. A side of one in a doubles bracket is a side that would play two.
    expect(entrantFaults([['', 'Tau'], ['Sigma', 'Phi']])).toEqual([
      { index: 0, names: ['', 'Tau'], fault: 'blank' },
    ]);
    expect(entrantFaults([['Rho', ''], ['Sigma', 'Phi']]).map((f) => f.fault)).toEqual(['blank']);
  });
});

describe('shuffled', () => {
  it('keeps every entrant exactly once', () => {
    const out = shuffled(ELEVEN, () => 0.5);
    expect([...out].sort()).toEqual([...ELEVEN].sort());
  });

  it('is reproducible given the same source of randomness', () => {
    const seeded = () => {
      let s = 42;
      return () => {
        s = (s * 1103515245 + 12345) % 2147483648;
        return s / 2147483648;
      };
    };
    expect(shuffled(ELEVEN, seeded())).toEqual(shuffled(ELEVEN, seeded()));
  });

  it('does not mutate what it was given', () => {
    const input = [...ELEVEN];
    shuffled(input, () => 0.9);
    expect(input).toEqual(ELEVEN);
  });
});

describe('tieSetup', () => {
  it('takes the mode, the target and the two sides from the bracket', () => {
    const t = tournamentOf(ELEVEN);
    const first = bracket(t).playable[0];
    const setup = tieSetup(t, first);
    expect(setup).toEqual({
      mode: 'singles',
      target: 21,
      players: { a: [first.a.names[0], ''], b: [first.b.names[0], ''] },
      tournament: 't1',
      casual: false,
    });
  });

  it('fills both slots in doubles', () => {
    const t = tournamentOf([['Rho', 'Tau'], ['Sigma', 'Phi']], 'doubles');
    const setup = tieSetup(t, bracket(t).playable[0]);
    expect(setup.players).toEqual({ a: ['Rho', 'Tau'], b: ['Sigma', 'Phi'] });
    expect(setup.mode).toBe('doubles');
  });

  it('never plays a tie as a guest game, which would not be recorded at all', () => {
    const t = tournamentOf(ELEVEN);
    expect(tieSetup(t, bracket(t).playable[0]).casual).toBe(false);
  });
});

describe('unfinished', () => {
  it('is every tournament without a champion', () => {
    const t = tournamentOf([['Rho'], ['Tau']]);
    expect(unfinished([t], []).map((x) => x.id)).toEqual(['t1']);
    const played = [tie(t.id, 'singles', ['Rho'], ['Tau'], 'a')];
    expect(unfinished([t], played)).toEqual([]);
  });

  it('brings one back when its final is un-archived', () => {
    const t = tournamentOf([['Rho'], ['Tau']]);
    const played = [tie(t.id, 'singles', ['Rho'], ['Tau'], 'a')];
    expect(unfinished([t], played)).toEqual([]);
    expect(unfinished([t], [])).toHaveLength(1);
  });
});

describe('lastPlayed', () => {
  const t = tournamentOf([['Rho'], ['Tau']]);

  it('is nothing until a tie has been played', () => {
    expect(lastPlayed(bracket(t, []), [])).toBe(null);
  });

  it('is the newest tie of the tournament', () => {
    const played = [
      { ...tie(t.id, 'singles', ['Rho'], ['Tau'], 'a'), endedAt: 500 },
    ];
    expect(lastPlayed(bracket(t, played), played)).toBe(500);
  });

  // Read off the bracket's ties, so a record carrying the id that the bracket does not
  // recognise as one of its ties cannot date it.
  it('ignores a match the bracket did not resolve to a tie', () => {
    const real = { ...tie(t.id, 'singles', ['Rho'], ['Tau'], 'a'), endedAt: 500 };
    const stray = {
      ...tie(t.id, 'singles', ['Phi'], ['Chi'], 'a'),
      endedAt: 9000,
    };
    expect(lastPlayed(bracket(t, [real, stray]), [real, stray])).toBe(500);
  });

  // A stamp of 0 is what an imported record can carry, and Math.max would date the
  // tournament to 1970 rather than admitting it does not know.
  it('does not take a missing stamp for a date', () => {
    const undated = { ...tie(t.id, 'singles', ['Rho'], ['Tau'], 'a'), endedAt: 0 };
    expect(lastPlayed(bracket(t, [undated]), [undated])).toBe(null);
  });
});

describe('newestFirst', () => {
  const drawn = (id, createdAt) => ({ id, ...(createdAt === undefined ? {} : { createdAt }) });

  it('puts the newest draw first, whatever order the list held', () => {
    expect(newestFirst([drawn('a', 1), drawn('c', 3), drawn('b', 2)]).map((t) => t.id)).toEqual([
      'c',
      'b',
      'a',
    ]);
  });

  it('leaves the list it was given alone', () => {
    const list = [drawn('a', 1), drawn('b', 2)];
    newestFirst(list);
    expect(list.map((t) => t.id)).toEqual(['a', 'b']);
  });

  // An import appends whatever the file holds, so the order the app sees is the order
  // the tournaments arrived in. Sorting is what stops that showing.
  it('interleaves an imported tournament by its draw date, not by its arrival', () => {
    const local = [drawn('local-new', 30), drawn('local-old', 10)];
    const imported = [drawn('imported', 20)];
    expect(newestFirst([...local, ...imported]).map((t) => t.id)).toEqual([
      'local-new',
      'imported',
      'local-old',
    ]);
  });

  it('sorts one with no draw date last, keeping the order those were in', () => {
    const list = [drawn('none-first'), drawn('none-second'), drawn('dated', 5)];
    expect(newestFirst(list).map((t) => t.id)).toEqual(['dated', 'none-first', 'none-second']);
  });
});

describe('validTournament', () => {
  const good = tournamentOf(ELEVEN);

  it('accepts one the app made', () => {
    expect(validTournament(good)).toBe(true);
  });

  it('refuses anything the bracket would read without checking', () => {
    expect(validTournament(null)).toBe(false);
    expect(validTournament({ ...good, id: '' })).toBe(false);
    expect(validTournament({ ...good, entrants: undefined })).toBe(false);
    expect(validTournament({ ...good, entrants: [['Rho']] })).toBe(false);
    expect(validTournament({ ...good, entrants: ['Rho', 'Tau'] })).toBe(false);
  });
});

describe('mergeTournaments', () => {
  const a = tournamentOf(ELEVEN);
  const b = { ...tournamentOf(ELEVEN), id: 't2' };

  it('adds what is new', () => {
    expect(mergeTournaments([a], [b]).map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('is idempotent', () => {
    expect(mergeTournaments([a], [a])).toEqual([a]);
    expect(mergeTournaments(mergeTournaments([], [a, b]), [a, b])).toHaveLength(2);
  });

  it('keeps the local copy, because a draw cannot be re-taken', () => {
    const rewritten = { ...a, name: 'Something else' };
    expect(mergeTournaments([a], [rewritten])[0].name).toBe('Hole Corn V');
  });

  it('drops one it could not use rather than half-importing it', () => {
    expect(mergeTournaments([], [{ id: 'x' }, b]).map((t) => t.id)).toEqual(['t2']);
    expect(mergeTournaments([a], 'not a list')).toEqual([a]);
  });
});

describe('upsertTournament and removeTournament', () => {
  const a = tournamentOf(ELEVEN);

  it('replaces by id rather than appending', () => {
    const renamed = { ...a, name: 'Hole Corn VI' };
    expect(upsertTournament([a], renamed)).toEqual([renamed]);
  });

  it('removes by id', () => {
    expect(removeTournament([a], 't1')).toEqual([]);
    expect(removeTournament([a], 'nope')).toEqual([a]);
  });
});

describe('what a waiting side is waiting for', () => {
  it('names the tie that will fill an empty seat', () => {
    const t = tournamentOf(ELEVEN);
    const b = bracket(t);
    const waiting = b.ties.find((x) => x.a === null);
    expect(waiting.fromA).not.toBeNull();
    const feeder = b.ties.find((x) => x.id === waiting.fromA);
    expect(feeder.level).toBe(waiting.level + 1);
  });

  it('leaves it null where an entrant sat down directly', () => {
    const t = tournamentOf(ELEVEN);
    const prelim = bracket(t).ties.find((x) => x.level === 4);
    expect(prelim.fromA).toBeNull();
    expect(prelim.fromB).toBeNull();
  });

  it('points at a feeder even once that feeder has been played', () => {
    // The link is structural, so it survives the seat being filled — which is what
    // lets a played tie still show where its winner came from.
    const t = tournamentOf(ELEVEN);
    const b = bracket(t, beat([], t, 'Chi'));
    const above = b.ties.find((x) => x.fromA || x.fromB);
    expect(above.fromA ?? above.fromB).toBeTruthy();
  });
});

describe('a played tie carries its score', () => {
  it('oriented to the bracket, not to the record team letters', () => {
    // The record's a/b are an accident of which side was entered first when the tie was
    // started, so a score read straight off the record is back to front half the time.
    const t = tournamentOf([['Rho'], ['Tau']]);
    const swapped = {
      ...tie(t.id, 'singles', ['Tau'], ['Rho'], 'a'),
      final: { a: 21, b: 13 },
    };
    const final = bracket(t, [swapped]).ties.find((x) => x.level === 1);
    expect(final.a.names).toEqual(['Rho']);
    expect(final.winner.names).toEqual(['Tau']);
    // Rho is side a of the tie and lost 13–21, whichever letter the record gave them.
    expect(final.score).toEqual({ a: 13, b: 21 });
  });

  it('is null for a result imported without one', () => {
    const t = tournamentOf([['Rho'], ['Tau']]);
    const noScore = { ...tie(t.id, 'singles', ['Rho'], ['Tau'], 'a'), final: undefined };
    expect(bracket(t, [noScore]).ties[0].score).toBeNull();
  });

  it('is null on a tie not yet played', () => {
    expect(bracket(tournamentOf(ELEVEN)).ties.every((x) => x.match || x.score === null)).toBe(true);
  });
});

describe('bracketTree', () => {
  const treeOf = (entrants, matches = []) =>
    bracketTree(bracket(tournamentOf(entrants), matches));

  it('is rooted at the final, so the columns run deepest-first to it', () => {
    const root = treeOf(ELEVEN);
    expect(root.tie.level).toBe(1);
    expect(root.kids.map((k) => k.tie.level)).toEqual([2, 2]);
  });

  it('is a perfect binary tree above the deepest level', () => {
    // The property the drawn bracket rests on: every parent has exactly two children,
    // so it sits exactly between them and the connectors need no measuring.
    const walk = (node) => {
      if (node.seat) return;
      expect(node.kids).toHaveLength(node.tie.level === 4 ? 0 : 2);
      node.kids.forEach(walk);
    };
    walk(treeOf(ELEVEN));
  });

  it('puts every entrant in the deepest column exactly once', () => {
    const names = [];
    const walk = (node) => {
      if (node.seat) return names.push(...node.seat.names.filter(Boolean));
      if (node.kids.length === 0) {
        return names.push(...[node.tie.a, node.tie.b].flatMap((s) => s.names.filter(Boolean)));
      }
      node.kids.forEach(walk);
    };
    walk(treeOf(ELEVEN));
    expect([...names].sort()).toEqual([...ELEVEN].sort());
  });

  it('gives a bye its own box beside the tie it waits on', () => {
    // A bye is a seat child rather than a tie child, which is what the paper sheet
    // draws as a lone name in the outer column.
    const kinds = [];
    const walk = (node) => {
      if (node.seat) return kinds.push('seat');
      if (node.kids.length === 0) return kinds.push('tie');
      node.kids.forEach(walk);
    };
    walk(treeOf(ELEVEN));
    expect(kinds.filter((k) => k === 'seat')).toHaveLength(5);
    expect(kinds.filter((k) => k === 'tie')).toHaveLength(3);
  });

  it('is just the final when two entrants play one game', () => {
    const root = treeOf([['Rho'], ['Tau']]);
    expect(root.tie.level).toBe(1);
    expect(root.kids).toEqual([]);
  });

  it('is null with no bracket to draw', () => {
    expect(bracketTree(null)).toBeNull();
  });
});

describe('tieLabels', () => {
  it('names the tournament and round of each played tie', () => {
    const t = tournamentOf(ELEVEN);
    let matches = [];
    for (let i = 0; i < 4; i += 1) {
      const b = bracket(t, matches);
      const next = b.playable[0];
      matches = [...matches, tie(t.id, t.mode, next.a.names, next.b.names, 'a')];
    }
    const labels = tieLabels([t], matches);
    expect(labels.size).toBe(4);
    for (const m of matches) {
      expect(labels.get(m.id)?.name).toBe('Hole Corn V');
      expect(['Preliminary', 'Quarter-final']).toContain(labels.get(m.id)?.round);
    }
  });

  it('leaves out a match that is not a tie', () => {
    const t = tournamentOf([['Rho'], ['Tau']]);
    const played = tie(t.id, 'singles', ['Rho'], ['Tau'], 'a');
    const friendly = { ...tie(t.id, 'singles', ['Sigma'], ['Phi'], 'a'), tournament: undefined };
    const labels = tieLabels([t], [played, friendly]);
    expect(labels.has(played.id)).toBe(true);
    expect(labels.has(friendly.id)).toBe(false);
  });

  it('is empty with no tournaments, however many matches there are', () => {
    const t = tournamentOf([['Rho'], ['Tau']]);
    expect(tieLabels([], [tie(t.id, 'singles', ['Rho'], ['Tau'], 'a')]).size).toBe(0);
    expect(tieLabels(undefined, []).size).toBe(0);
  });

  it('spans several tournaments at once', () => {
    const a = tournamentOf([['Rho'], ['Tau']]);
    const b = { ...tournamentOf([['Sigma'], ['Phi']]), id: 't2', name: 'Other Cup' };
    const played = [
      tie(a.id, 'singles', ['Rho'], ['Tau'], 'a'),
      tie(b.id, 'singles', ['Sigma'], ['Phi'], 'b'),
    ];
    const labels = tieLabels([a, b], played);
    expect(labels.get(played[0].id).name).toBe('Hole Corn V');
    expect(labels.get(played[1].id).name).toBe('Other Cup');
    expect(labels.get(played[1].id).round).toBe('Final');
  });
});
