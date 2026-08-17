import { describe, expect, it } from 'vitest';
import {
  MIN_ENTRANTS,
  bracket,
  bracketShape,
  bracketTree,
  drawSteps,
  entrantFaults,
  entrantStats,
  forfeitGame,
  lastPlayed,
  levelName,
  reachedBy,
  routeFor,
  seatLabel,
  tieExtremes,
  tieHistory,
  tieMatches,
  groupBySeries,
  mergeTournaments,
  newTournament,
  newestFirst,
  nextEditionName,
  nextEditions,
  recordedTournament,
  renameEntrant,
  seriesHistory,
  seriesKey,
  seriesStats,
  splitSeriesName,
  removeTournament,
  shufflePairs,
  shuffled,
  sideNames,
  tieLabels,
  tieSetup,
  upsertTournament,
  validTournament,
} from './tournament.js';
// The panel this feeds, folded here rather than in stats.test.js because what is being
// asserted is the *pool* — that a lineage reads back as a record where one cup cannot.
import { lineupStats } from './stats.js';

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
function tie(tournamentId, mode, a, b, winner, final) {
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
    final: final ?? (winner === 'a' ? { a: 21, b: 11 } : { a: 11, b: 21 }),
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

// One line per pull, the way the card reads it, so a sequence can be asserted whole
// rather than field by field.
function sketch(steps) {
  const label = (side) => side.names.join(' & ');
  return steps.map((s) => {
    if (s.opponents.length === 0) return `${s.round}: ${label(s.side)} (waiting)`;
    if (s.opponents.length === 1) return `${s.round}: ${label(s.side)} v ${label(s.opponents[0])}`;
    return `${s.round}: ${label(s.side)} v winner of ${s.opponents.map(label).join(' / ')}`;
  });
}

describe('drawSteps', () => {
  it('reproduces the paper draw for eleven', () => {
    expect(sketch(drawSteps(tournamentOf(ELEVEN)))).toEqual([
      'Preliminary: Rho (waiting)',
      'Preliminary: Tau v Rho',
      'Preliminary: Sigma (waiting)',
      'Preliminary: Phi v Sigma',
      'Quarter-final: Chi (waiting)',
      'Quarter-final: Psi v Chi',
      'Preliminary: Omega (waiting)',
      'Preliminary: Iota v Omega',
      'Quarter-final: Kappa v winner of Omega / Iota',
      'Quarter-final: Zeta (waiting)',
      'Quarter-final: Beta v Zeta',
    ]);
  });

  it('pulls every entrant exactly once, in draw order', () => {
    for (let n = MIN_ENTRANTS; n <= 33; n += 1) {
      const entrants = Array.from({ length: n }, (_, i) => `P${i}`);
      const steps = drawSteps(tournamentOf(entrants));
      expect(steps.map((s) => s.side.names[0])).toEqual(entrants);
    }
  });

  // The property that makes the ceremony bearable: nobody is left looking at a name with
  // no opponent for more than one press.
  it('resolves a waiting entrant on the very next pull', () => {
    for (let n = MIN_ENTRANTS; n <= 33; n += 1) {
      const steps = drawSteps(tournamentOf(Array.from({ length: n }, (_, i) => `P${i}`)));
      steps.forEach((step, i) => {
        if (step.opponents.length > 0) return;
        expect(steps[i + 1]).toBeDefined();
        expect(steps[i + 1].opponents.map((o) => o.key)).toContain(step.side.key);
      });
    }
  });

  // So the draw does not trail off into byes, which is what it looked like it would do.
  it('always ends on a completed pairing', () => {
    for (let n = MIN_ENTRANTS; n <= 33; n += 1) {
      const steps = drawSteps(tournamentOf(Array.from({ length: n }, (_, i) => `P${i}`)));
      expect(steps[steps.length - 1].opponents.length).toBeGreaterThan(0);
    }
  });

  // The one that matters: the ceremony and the bracket must be describing the same draw.
  // Both derive from `entrants`, and `seatSides` is shared, but the two walks could still
  // come to disagree about which tie a name landed in — and nothing on either screen
  // would say so, because the card is gone by the time the bracket is drawn.
  it('announces pairings the bracket goes on to draw', () => {
    for (let n = MIN_ENTRANTS; n <= 33; n += 1) {
      const t = tournamentOf(Array.from({ length: n }, (_, i) => `P${i}`));
      const view = bracket(t);
      const meets = (x, y) =>
        view.ties.some(
          (tie) =>
            tie.level === x.level &&
            ((tie.a?.key === x.side.key && tie.b?.key === y) ||
              (tie.b?.key === x.side.key && tie.a?.key === y)),
        );
      for (const step of drawSteps(t)) {
        if (step.opponents.length === 1) {
          expect(meets(step, step.opponents[0].key)).toBe(true);
        }
        if (step.opponents.length === 2) {
          // The two named are a preliminary, and its winner feeds the tie this entrant
          // is waiting in — so the card's "winner of" is the bracket's connector.
          const below = view.ties.find(
            (tie) =>
              tie.a?.key === step.opponents[0].key && tie.b?.key === step.opponents[1].key,
          );
          expect(below).toBeDefined();
          const above = view.ties.find(
            (tie) => tie.level === step.level && (tie.fromA === below.id || tie.fromB === below.id),
          );
          expect(above).toBeDefined();
          expect([above.a?.key, above.b?.key]).toContain(step.side.key);
        }
      }
    }
  });

  it('never names an opponent nobody has pulled yet', () => {
    for (let n = MIN_ENTRANTS; n <= 33; n += 1) {
      const steps = drawSteps(tournamentOf(Array.from({ length: n }, (_, i) => `P${i}`)));
      const out = new Set();
      for (const step of steps) {
        for (const o of step.opponents) expect(out.has(o.key)).toBe(true);
        out.add(step.side.key);
      }
    }
  });

  // Nobody has a bye when the field is a power of two, so the card must not offer one:
  // every pull there is an ordinary first-round seat.
  it('has no preliminary at a power of two', () => {
    const rounds = drawSteps(tournamentOf(Array.from({ length: 8 }, (_, i) => `P${i}`))).map(
      (s) => s.round,
    );
    expect(new Set(rounds)).toEqual(new Set(['Quarter-final']));
  });

  it('reads a doubles pair as one entrant and one pull', () => {
    const steps = drawSteps(
      tournamentOf([['Rho', 'Tau'], ['Sigma', 'Phi']], 'doubles'),
    );
    expect(sketch(steps)).toEqual([
      'Final: Rho & Tau (waiting)',
      'Final: Sigma & Phi v Rho & Tau',
    ]);
  });

  it('has nothing to reveal for a field too small to draw, or a recorded result', () => {
    expect(drawSteps(tournamentOf(['Rho']))).toEqual([]);
    expect(drawSteps(null)).toEqual([]);
    expect(
      drawSteps(recordedTournament({ id: 'r', name: 'Hole Corn I', createdAt: 1, champion: 'Rho' })),
    ).toEqual([]);
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

  it('names the runner-up as whoever lost the final', () => {
    const t = tournamentOf([['Rho'], ['Tau'], ['Phi'], ['Chi']]);
    let matches = [];
    // Both semi-finals, then Rho takes the final.
    matches = [...matches, tie(t.id, t.mode, ['Rho'], ['Tau'], 'a')];
    matches = [...matches, tie(t.id, t.mode, ['Phi'], ['Chi'], 'b')];
    const final = bracket(t, matches).playable[0];
    matches = [...matches, tie(t.id, t.mode, final.a.names, final.b.names, 'a')];
    const b = bracket(t, matches);
    expect(b.champion.names).toEqual(final.a.names);
    expect(b.runnerUp.names).toEqual(final.b.names);
    // The loser of a semi-final is not a runner-up, so it cannot simply be "somebody who
    // lost" — Tau and one of Phi/Chi also lost, and only the beaten finalist counts.
    expect(b.runnerUp.key).not.toBe(b.champion.key);
    expect([...final.a.names, ...final.b.names]).toContain(b.runnerUp.names[0]);
  });

  it('has no runner-up until the final is played', () => {
    const t = tournamentOf([['Rho'], ['Tau'], ['Phi'], ['Chi']]);
    expect(bracket(t, []).runnerUp).toBeNull();
    const half = [tie(t.id, t.mode, ['Rho'], ['Tau'], 'a')];
    expect(bracket(t, half).runnerUp).toBeNull();
    expect(bracket(t, half).done).toBe(false);
  });

  // Read off the tie's own two sides rather than the record's team letters, which are an
  // accident of which side was entered as A when the tie was started.
  it('finds the runner-up whichever side of the record they were on', () => {
    const t = tournamentOf([['Rho'], ['Tau']]);
    const aWon = [tie(t.id, t.mode, ['Rho'], ['Tau'], 'a')];
    const bWon = [tie(t.id, t.mode, ['Tau'], ['Rho'], 'a')];
    expect(bracket(t, aWon).runnerUp.names).toEqual(['Tau']);
    expect(bracket(t, bWon).runnerUp.names).toEqual(['Rho']);
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

  it('refuses one person drawn into two different pairs', () => {
    // The fault counting sides could not see: these two are not the same pair, so their
    // keys differ and neither is a duplicate of the other. Rho is still one person on
    // both sides of the bracket.
    expect(entrantFaults([['Rho', 'Tau'], ['Rho', 'Sigma']]).map((f) => f.index)).toEqual([0, 1]);
    const three = entrantFaults([['Rho', 'Tau'], ['Rho', 'Sigma'], ['Rho', 'Phi']]);
    expect(three.map((f) => f.index)).toEqual([0, 1, 2]);
    expect(three.every((f) => f.fault === 'twice')).toBe(true);
    // Only the sides that share somebody, and the spelling is compared the way the rest
    // of the app compares a name.
    expect(
      entrantFaults([['Rho', 'Tau'], ['sigma', 'Phi'], ['Omega', ' SIGMA ']]).map((f) => f.index),
    ).toEqual([1, 2]);
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

describe('shufflePairs', () => {
  // Every swap goes to index 0, which is a permutation rather than a rotation and is
  // enough to move a name into a pair it was not in — the whole point of the button.
  const FIRST = () => 0;

  it('re-partners the field rather than reordering the pairs', () => {
    expect(
      shufflePairs(
        [
          ['Rho', 'Tau'],
          ['Sigma', 'Phi'],
        ],
        FIRST,
      ),
    ).toEqual([
      ['Tau', 'Sigma'],
      ['Phi', 'Rho'],
    ]);
  });

  it('keeps everybody exactly once and the field the length it was', () => {
    const pairs = [
      ['Rho', 'Tau'],
      ['Sigma', 'Phi'],
      ['Chi', 'Psi'],
    ];
    const out = shufflePairs(pairs, () => 0.5);
    expect(out.length).toBe(pairs.length);
    expect(out.flat().sort()).toEqual(pairs.flat().sort());
  });

  it('shuffles an empty slot like any other, so a gap moves to another pair', () => {
    expect(
      shufflePairs(
        [
          ['Rho', ''],
          ['Sigma', 'Phi'],
        ],
        FIRST,
      ),
    ).toEqual([
      ['', 'Sigma'],
      ['Phi', 'Rho'],
    ]);
  });

  // Two gaps can land together, which is a row nobody is in. Left to happen rather than
  // dropped: the field keeping its length is what makes the button a rearrangement, and
  // `entrantFaults` already refuses the result in exactly the way it did before.
  it('leaves an entrant empty where two gaps meet, and it is still a fault', () => {
    const out = shufflePairs(
      [
        ['Rho', ''],
        ['', 'Phi'],
      ],
      FIRST,
    );
    expect(out).toEqual([
      ['', ''],
      ['Phi', 'Rho'],
    ]);
    expect(entrantFaults(out).map((f) => f.fault)).toEqual(['blank']);
  });

  it('does not mutate what it was given', () => {
    const pairs = [
      ['Rho', 'Tau'],
      ['Sigma', 'Phi'],
    ];
    shufflePairs(pairs, FIRST);
    expect(pairs).toEqual([
      ['Rho', 'Tau'],
      ['Sigma', 'Phi'],
    ]);
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

describe('forfeitGame', () => {
  it('is the tie, with a winner and no rounds', () => {
    const t = tournamentOf(ELEVEN);
    const first = bracket(t).playable[0];
    const game = forfeitGame(t, first, 'b');
    expect(game.players).toEqual({ a: [first.a.names[0], ''], b: [first.b.names[0], ''] });
    expect(game.tournament).toBe('t1');
    expect(game.mode).toBe('singles');
    expect(game.target).toBe(21);
    expect(game.winner).toBe('b');
    expect(game.forfeit).toBe(true);
    expect(game.rounds).toEqual([]);
  });

  it('fills both slots in doubles, the way a played tie does', () => {
    const t = tournamentOf([['Rho', 'Tau'], ['Sigma', 'Phi']], 'doubles');
    const game = forfeitGame(t, bracket(t).playable[0], 'a');
    expect(game.players).toEqual({ a: ['Rho', 'Tau'], b: ['Sigma', 'Phi'] });
  });

  // The whole point of the shape: nothing new is stored, so the bracket resolves an
  // awarded tie exactly as it resolves a played one and the winner goes through.
  it('advances the winner once it is archived', () => {
    const t = tournamentOf(ELEVEN);
    const first = bracket(t).playable[0];
    const record = { ...forfeitGame(t, first, 'b'), id: 'w1', endedAt: 9 };
    const view = bracket(t, [record]);
    const same = view.ties.find((x) => x.id === first.id);
    expect(same.winner.key).toBe(first.b.key);
    expect(same.playable).toBe(false);
    expect(view.played).toBe(1);
  });

  // `finalScore` is null for a record with neither rounds nor a `final`, which is what
  // keeps a walkover from drawing an invented 0–0 in the tie box.
  it('leaves the tie with no score', () => {
    const t = tournamentOf(ELEVEN);
    const first = bracket(t).playable[0];
    const record = { ...forfeitGame(t, first, 'a'), id: 'w1', endedAt: 9 };
    expect(bracket(t, [record]).ties.find((x) => x.id === first.id).score).toBeNull();
  });

  // Two entrants is the smallest cup there is, so its one tie is the final — and a cup
  // can be won on a walkover, which is the case worth pinning rather than assuming.
  it('can decide a champion', () => {
    const t = tournamentOf(['Rho', 'Tau']);
    const final = bracket(t).playable[0];
    const record = { ...forfeitGame(t, final, 'a'), id: 'w1', endedAt: 9 };
    const view = bracket(t, [record]);
    expect(view.done).toBe(true);
    expect(sideNames(view.champion)).toBe(final.a.names[0]);
    expect(sideNames(view.runnerUp)).toBe(final.b.names[0]);
  });
});

// `done` is what the two lists split on, so un-archiving the final has to move a
// tournament back across that line — the reversibility the whole derived shape is for.
describe('done', () => {
  it('turns over when the final is archived, and back when it is un-archived', () => {
    const t = tournamentOf([['Rho'], ['Tau']]);
    const played = [tie(t.id, 'singles', ['Rho'], ['Tau'], 'a')];
    expect(bracket(t, []).done).toBe(false);
    expect(bracket(t, played).done).toBe(true);
    expect(bracket(t, []).done).toBe(false);
  });
});

// A tournament played before the app existed, whose sheet nobody kept. The result is the
// only thing about it that survives, so it is the only thing stored — the same shape a
// match with no rounds takes when it carries `final` and nothing else.
describe('a recorded result', () => {
  const holecornI = recordedTournament({
    id: 'hc1',
    name: 'Hole Corn I',
    createdAt: 5,
    champion: ['Rho'],
    runnerUp: ['Tau'],
  });

  it('is a finished bracket with nothing in it', () => {
    const view = bracket(holecornI, []);
    expect(view.recorded).toBe(true);
    expect(view.done).toBe(true);
    expect(view.champion.names).toEqual(['Rho']);
    expect(view.runnerUp.names).toEqual(['Tau']);
    // Present and empty rather than absent, so nothing reading a bracket needs a guard
    // of its own. `total` in particular would be -1 from an empty field.
    expect(view).toMatchObject({ ties: [], rounds: [], played: 0, total: 0 });
  });

  // Who took part, where somebody remembers — the whole of the field and not only the two
  // names on the trophy. It is a *set* and never a seating: `recorded` stays true and no
  // bracket is built from it, which is the line `entrants` would otherwise blur.
  it('names everybody it is told took part', () => {
    const withField = recordedTournament({
      ...holecornI,
      field: [['Sigma'], ['Rho'], ['Phi'], ['Tau']],
    });
    const view = bracket(withField, []);
    expect(view.entrants.map((e) => e.names[0])).toEqual(['Sigma', 'Rho', 'Phi', 'Tau']);
    expect(view.fieldKnown).toBe(true);
    expect(view).toMatchObject({ recorded: true, ties: [], played: 0, total: 0 });
  });

  // A field transcribed without the winner in it still describes the whole tournament, so
  // the two are unioned rather than the field being trusted whole. Order holds otherwise:
  // the file's, then whoever it left out.
  it('adds the finalists to a field that forgot them', () => {
    const withField = recordedTournament({ ...holecornI, field: [['Sigma'], ['Phi']] });
    expect(bracket(withField, []).entrants.map((e) => e.names[0])).toEqual([
      'Sigma',
      'Phi',
      'Rho',
      'Tau',
    ]);
  });

  it('takes the same person once, however the field was written', () => {
    const twice = recordedTournament({ ...holecornI, field: [['Rho'], ['rho'], ['Tau']] });
    expect(bracket(twice, []).entrants.map((e) => e.names[0])).toEqual(['Rho', 'Tau']);
  });

  // The finalists are all such an edition can contribute, and `fieldKnown` is what tells
  // that from a field of two — the screen says different things about them.
  it('falls back to the finalists, and says that is what it has done', () => {
    const view = bracket(holecornI, []);
    expect(view.entrants.map((e) => e.names[0])).toEqual(['Rho', 'Tau']);
    expect(view.fieldKnown).toBe(false);
    expect('field' in holecornI).toBe(false);
  });

  it('keeps the runner-up optional, because losing a final is the half people forget', () => {
    const noLoser = recordedTournament({ id: 'hc2', name: 'Hole Corn II', champion: ['Rho'] });
    expect('runnerUp' in noLoser).toBe(false);
    expect(bracket(noLoser, []).runnerUp).toBeNull();
  });

  it('takes a doubles pair as one champion', () => {
    const pairs = recordedTournament({ id: 'hc3', name: 'III', champion: ['Rho', 'Tau'] });
    expect(bracket(pairs, []).champion.names).toEqual(['Rho', 'Tau']);
  });

  it('is done the moment it is read, having no ties to play', () => {
    expect(bracket(holecornI, []).done).toBe(true);
  });

  it('is nothing at all without a champion, the way a bare id always was', () => {
    expect(bracket({ id: 'x', name: 'x' }, [])).toBeNull();
    expect(bracket({ id: 'x', name: 'x', champion: ['', ''] }, [])).toBeNull();
    expect(validTournament({ id: 'x', name: 'x' })).toBe(false);
  });

  it('survives an import, which is the only way one can arrive', () => {
    expect(validTournament(holecornI)).toBe(true);
    expect(mergeTournaments([], [holecornI]).map((t) => t.id)).toEqual(['hc1']);
  });

  // The id is the name, so a sheet turning up years later and being transcribed produces
  // the same tournament. `mergeTournaments` keeps the local copy for everything else, and
  // holding it here is silent rather than merely stubborn: the ties would import tagged
  // with an id whose tournament has no bracket to place them in.
  it('gives way to a real draw of the same tournament, and only that way round', () => {
    const drawn = { ...tournamentOf([['Rho'], ['Tau']]), id: 'hc1', name: 'Hole Corn I' };
    expect(bracket(mergeTournaments([holecornI], [drawn])[0], []).recorded).toBe(false);
    expect(bracket(mergeTournaments([drawn], [holecornI])[0], []).recorded).toBe(false);
  });

  // Remembering who took part arrives by the same route as a sheet does — a corrected file,
  // re-imported — so it has to beat the local copy the same way, or adding the names does
  // nothing at all and says nothing about having done nothing.
  it('gives way to a copy that remembers the field, and only that way round', () => {
    const withField = recordedTournament({ ...holecornI, field: [['Sigma'], ['Phi']] });
    expect(bracket(mergeTournaments([holecornI], [withField])[0], []).fieldKnown).toBe(true);
    expect(bracket(mergeTournaments([withField], [holecornI])[0], []).fieldKnown).toBe(true);
    // And a draw still outranks both, which is the whole of what a field is not.
    const drawn = { ...tournamentOf([['Rho'], ['Tau']]), id: 'hc1', name: 'Hole Corn I' };
    expect(bracket(mergeTournaments([withField], [drawn])[0], []).recorded).toBe(false);
    expect(bracket(mergeTournaments([drawn], [withField])[0], []).recorded).toBe(false);
  });

  // The rule decision 12 in docs/TOURNAMENT.md sets: a stored result may never contradict
  // a bracket. Here that is structural rather than a precedence — a field means a draw, and
  // a draw derives its own champion — so a tournament carrying both is simply the bracket.
  it('is ignored where there is a field to derive from', () => {
    const both = { ...tournamentOf([['Rho'], ['Tau']]), champion: ['Sigma'] };
    expect(bracket(both, []).champion).toBeNull();
    expect(bracket(both, []).recorded).toBe(false);
    const played = [tie(both.id, 'singles', ['Rho'], ['Tau'], 'b')];
    expect(bracket(both, played).champion.names).toEqual(['Tau']);
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

// A career rename rewrites the archive's `players` arrays. Nothing used to rewrite the
// draw, so the spellings parted company and `bracket()` — which seats sides from
// `entrants` and finds a tie by `sideKeyOf` — stopped resolving every tie that person
// played. Silently: a finished cup simply reappeared as in progress.
describe('renameEntrant', () => {
  const four = tournamentOf(['Rho', 'Tau', 'Sigma', 'Phi']);

  const playToTheEnd = (t) => {
    let played = beat([], t, 'Rho');
    played = beat(played, t, 'Sigma');
    return beat(played, t, 'Rho');
  };

  it('keeps a finished cup finished when the champion is renamed', () => {
    const played = playToTheEnd(four);
    const before = bracket(four, played);
    expect(before.done).toBe(true);
    expect(before.champion.names).toEqual(['Rho']);

    const renamed = played.map((m) => ({
      ...m,
      players: {
        a: m.players.a.map((n) => (n === 'Rho' ? 'Rho P' : n)),
        b: m.players.b.map((n) => (n === 'Rho' ? 'Rho P' : n)),
      },
    }));
    const [swept] = renameEntrant([four], 'Rho', 'Rho P');
    const after = bracket(swept, renamed);
    expect(after.done).toBe(true);
    expect(after.champion.names).toEqual(['Rho P']);
    expect(after.playable).toHaveLength(0);
    expect(after.ties.filter((x) => x.match)).toHaveLength(before.ties.filter((x) => x.match).length);
  });

  it('folds case and padding the way the archive rename does', () => {
    const [swept] = renameEntrant([four], ' rho ', 'Rho P');
    expect(swept.entrants.flat()).toContain('Rho P');
  });

  it('rewrites one half of a doubles pair and leaves the partner', () => {
    const pairs = tournamentOf(
      [['Rho', 'Tau'], ['Sigma', 'Phi'], ['Chi', 'Psi'], ['Omega', 'Iota']],
      'doubles',
    );
    const [swept] = renameEntrant([pairs], 'Tau', 'Tau Q');
    expect(swept.entrants).toContainEqual(['Rho', 'Tau Q']);
  });

  it('sweeps a recorded result — champion, runner-up and the field', () => {
    const recorded = recordedTournament({
      id: 't9',
      name: 'Hole Corn I',
      createdAt: 5,
      champion: ['Rho'],
      runnerUp: ['Tau'],
      field: [['Rho'], ['Tau'], ['Sigma']],
    });
    const [swept] = renameEntrant([recorded], 'Rho', 'Rho P');
    expect(swept.champion).toEqual(['Rho P']);
    expect(swept.field).toContainEqual(['Rho P']);
    expect(swept.runnerUp).toEqual(['Tau']);
  });

  it('adds no key a tournament did not have', () => {
    const [swept] = renameEntrant([four], 'Rho', 'Rho P');
    expect('champion' in swept).toBe(false);
    expect('field' in swept).toBe(false);
    expect('runnerUp' in swept).toBe(false);
  });

  it('leaves a tournament the name is not in untouched, object identity included', () => {
    const other = tournamentOf(['Chi', 'Psi', 'Omega', 'Iota']);
    const out = renameEntrant([four, other], 'Chi', 'Chi Z');
    expect(out[0]).toBe(four);
    expect(out[1]).not.toBe(other);
  });

  it('does nothing without both names', () => {
    expect(renameEntrant([four], '', 'Rho P')).toEqual([four]);
    expect(renameEntrant([four], 'Rho', '  ')).toEqual([four]);
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

describe('sideNames', () => {
  it('joins a doubles pair and drops a blank half', () => {
    expect(sideNames({ names: ['Rho'] })).toBe('Rho');
    expect(sideNames({ names: ['Rho', 'Tau'] })).toBe('Rho & Tau');
    // `sideLabel` keeps the blank so `teamLabel` has an empty half to find; the tournament
    // is where it is dropped, so a side of one never reads `Rho & `.
    expect(sideNames({ names: ['Rho', ''] })).toBe('Rho');
  });
});

describe('seatLabel', () => {
  const view = () => bracket(tournamentOf(ELEVEN));
  const label = (tie, side) =>
    side === 'a'
      ? seatLabel(tie.a, tie.fromA, view().ties, view().rounds)
      : seatLabel(tie.b, tie.fromB, view().ties, view().rounds);
  const tieAt = (id) => view().ties.find((x) => x.id === id);

  it('names a side that has one', () => {
    expect(label(tieAt('4.0'), 'a')).toBe('Rho');
    const pairs = bracket(tournamentOf([['Rho', 'Tau'], ['Sigma', 'Phi']], 'doubles'));
    const final = pairs.ties.find((x) => x.level === 1);
    expect(seatLabel(final.a, final.fromA, pairs.ties, pairs.rounds)).toBe('Rho & Tau');
  });

  it('names the pairing an empty seat is waiting on', () => {
    expect(label(tieAt('3.0'), 'a')).toBe('winner of Rho v Tau');
    expect(label(tieAt('2.0'), 'b')).toBe('winner of Chi v Psi');
    // A doubles seat waits on two pairs, so the join has to survive being nested in it.
    const pairs = bracket(
      tournamentOf([['Rho', 'Tau'], ['Sigma', 'Phi'], ['Omega', 'Iota'], ['Kappa', 'Zeta']], 'doubles'),
    );
    const final = pairs.ties.find((x) => x.level === 1);
    expect(seatLabel(final.a, final.fromA, pairs.ties, pairs.rounds)).toBe(
      'winner of Rho & Tau v Sigma & Phi',
    );
  });

  it('falls back to the round two levels up rather than recursing', () => {
    // The feeder's own sides are unknown here, and "winner of winner of ... v winner
    // of ..." is what naming them would read as.
    expect(label(tieAt('2.0'), 'a')).toBe('winner of a quarter-final');
    expect(label(tieAt('1.0'), 'a')).toBe('winner of a semi-final');
    expect(label(tieAt('1.0'), 'b')).toBe('winner of a semi-final');
    expect(view().ties.every((x) => !label(x, 'a').includes('winner of winner'))).toBe(true);
  });

  it('says something for a seat no bracket produces', () => {
    // Both guards below are unreachable from any view `bracket()` builds — every `fromA`
    // names a tie in the same list, and `rounds` always covers every level the ties sit
    // at. They are asserted because the alternative to a guard here is a crash during
    // render, which blanks the app; driven directly because nothing else can reach them.
    const v = view();
    expect(seatLabel(null, 'no.such.tie', v.ties, v.rounds)).toBe('—');
    const feeder = v.ties.find((x) => x.id === '2.0');
    expect(seatLabel(null, feeder.id, v.ties, [])).toBe('winner of an earlier tie');
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

// Everything below is the stats lens rather than the bracket itself: how far each
// entrant got, what their route was, and what the ties say about how it went.

// Play a whole tournament out, always taking the first playable tie and always
// letting the side drawn first win. Deterministic, because `tournamentOf` keeps the
// entrants in the order given and nothing here shuffles.
function playOut(t, score) {
  let matches = [];
  for (;;) {
    const next = bracket(t, matches).playable[0];
    if (!next) return matches;
    matches = [...matches, tie(t.id, t.mode, next.a.names, next.b.names, 'a', score)];
  }
}

describe('routeFor', () => {
  const t = tournamentOf(ELEVEN);

  it('is every tie an entrant appeared in, deepest first', () => {
    const matches = playOut(t);
    const view = bracket(t, matches);
    const route = routeFor(view, view.champion.key);
    const levels = route.map((x) => x.level);
    expect(levels).toEqual([...levels].sort((x, y) => y - x));
    expect(levels[levels.length - 1]).toBe(1);
    expect(route.every((x) => x.winner.key === view.champion.key)).toBe(true);
  });

  it('ends at the tie that knocked them out', () => {
    const matches = playOut(t);
    const view = bracket(t, matches);
    const route = routeFor(view, view.runnerUp.key);
    const last = route[route.length - 1];
    expect(last.level).toBe(1);
    expect(last.winner.key).not.toBe(view.runnerUp.key);
  });

  it('is the one tie ahead of them before anything has been played', () => {
    const view = bracket(t, []);
    expect(routeFor(view, view.entrants[0].key).length).toBe(1);
  });

  it('is empty for somebody who is not in it', () => {
    expect(routeFor(bracket(t, []), 'nobody')).toEqual([]);
    expect(routeFor(null, 'x')).toEqual([]);
  });
});

describe('reachedBy', () => {
  const t = tournamentOf(ELEVEN);

  it('names the champion rather than levelling them, which the runner-up shares', () => {
    const matches = playOut(t);
    const view = bracket(t, matches);
    expect(reachedBy(view, view.champion.key)).toEqual({ status: 'won', level: 1 });
    expect(reachedBy(view, view.runnerUp.key)).toEqual({ status: 'out', level: 1 });
  });

  it('tells being out at a round from waiting to play it', () => {
    const view = bracket(t, []);
    // The three preliminaries are all that can be played at the start, so playing one
    // leaves its loser out at the deepest level while everyone else is still in it.
    const first = view.playable.find((x) => x.level === view.shape.rounds);
    const matches = [tie(t.id, t.mode, first.a.names, first.b.names, 'a')];
    const after = bracket(t, matches);
    expect(reachedBy(after, first.b.key)).toEqual({ status: 'out', level: view.shape.rounds });
    // The winner has moved up a level and is waiting there, at the same round the
    // entrant they beat is now out at — which is the pair a level alone cannot tell apart.
    expect(reachedBy(after, first.a.key)).toEqual({ status: 'in', level: view.shape.rounds - 1 });
  });

  it('puts a bye entrant in at a shallower round than one in a preliminary', () => {
    const view = bracket(t, []);
    const levels = view.entrants.map((e) => reachedBy(view, e.key));
    expect(levels.every((r) => r.status === 'in')).toBe(true);
    expect(levels.filter((r) => r.level === 4).length).toBe(6);
    expect(levels.filter((r) => r.level === 3).length).toBe(5);
  });
});

describe('entrantStats', () => {
  const t = tournamentOf(ELEVEN);

  it('holds a place for every entrant before anything is played', () => {
    const rows = entrantStats(bracket(t, []), []);
    expect(rows.length).toBe(ELEVEN.length);
    expect(rows.every((r) => !r.played)).toBe(true);
    expect(rows.every((r) => r.matches === 0 && r.rounds === 0)).toBe(true);
  });

  it('puts the champion first and the runner-up second', () => {
    const matches = playOut(t);
    const view = bracket(t, matches);
    const rows = entrantStats(view, matches);
    expect(rows[0].names).toEqual(view.champion.names);
    expect(rows[1].names).toEqual(view.runnerUp.names);
  });

  it('orders everyone else by how far they got', () => {
    const matches = playOut(t);
    const view = bracket(t, matches);
    const levels = entrantStats(view, matches)
      .slice(1)
      .map((r) => r.reached.level);
    expect(levels).toEqual([...levels].sort((x, y) => x - y));
  });

  // **The side drawn *second* has to win here**, and that is not arbitrary. With the
  // first winning, the entrant knocked out is Tau, who is alphabetically last among the
  // five left at that level — so the final `localeCompare` tie-break puts them at the
  // bottom anyway and the assertion passes with the alive-before-out rule removed.
  // Verified by mutation, which is how it was caught after it was written.
  it('ranks somebody still in above somebody out at the same round', () => {
    const first = bracket(t, []).playable.find((x) => x.level === 4);
    const matches = [tie(t.id, t.mode, first.a.names, first.b.names, 'b')];
    const rows = entrantStats(bracket(t, matches), matches);
    const at4 = rows.filter((r) => r.reached.level === 4);
    expect(at4[at4.length - 1].names).toEqual(first.a.names);
    expect(at4[at4.length - 1].reached.status).toBe('out');
    expect(at4.slice(0, -1).every((r) => r.reached.status === 'in')).toBe(true);
  });

  it('counts a doubles pair once, as the entrant the bracket competes by', () => {
    const pairs = tournamentOf(
      [
        ['Rho', 'Tau'],
        ['Sigma', 'Phi'],
      ],
      'doubles',
    );
    const matches = playOut(pairs);
    const rows = entrantStats(bracket(pairs, matches), matches);
    expect(rows.length).toBe(2);
    expect(rows[0].names).toEqual(['Rho', 'Tau']);
    expect(rows[0].wins).toBe(1);
  });

  it('reads the entrant a record filed the other way round', () => {
    const pairs = tournamentOf(
      [
        ['Rho', 'Tau'],
        ['Sigma', 'Phi'],
      ],
      'doubles',
    );
    // Slots reversed and the sides swapped, which is what a tie started from the other
    // team letter looks like. `sideKeyOf` has to see through both.
    const matches = [tie(pairs.id, 'doubles', ['Phi', 'Sigma'], ['Tau', 'Rho'], 'b')];
    const rows = entrantStats(bracket(pairs, matches), matches);
    expect(rows.length).toBe(2);
    // Named from the draw, not from the record, so the order is the one that was drawn.
    expect(rows[0].names).toEqual(['Rho', 'Tau']);
    expect(rows[0].wins).toBe(1);
    expect(rows[0].played).toBe(true);
  });
});

describe('tieMatches', () => {
  const t = tournamentOf([['Rho'], ['Tau']]);

  it('is the records the bracket resolved to ties, not everything carrying the id', () => {
    const real = tie(t.id, 'singles', ['Rho'], ['Tau'], 'a');
    // Tagged with the tournament but between two people who are not in it, which is what
    // a hand-edited file or a renamed record can produce.
    const stray = tie(t.id, 'singles', ['Sigma'], ['Phi'], 'a');
    expect(tieMatches(bracket(t, [real, stray]), [real, stray]).map((m) => m.id)).toEqual([
      real.id,
    ]);
  });
});

describe('tieExtremes', () => {
  const four = tournamentOf([['Rho'], ['Tau'], ['Sigma'], ['Phi']]);
  // Rho beats Tau by 17, Sigma beats Phi by 3, Rho beats Sigma by 9. Written out rather
  // than played out, because the margins are the whole point.
  const matches = [
    tie(four.id, 'singles', ['Rho'], ['Tau'], 'a', { a: 21, b: 4 }),
    tie(four.id, 'singles', ['Sigma'], ['Phi'], 'a', { a: 21, b: 18 }),
    tie(four.id, 'singles', ['Rho'], ['Sigma'], 'a', { a: 21, b: 12 }),
  ];

  it('finds both ends of the spread from a score with no rounds behind it', () => {
    const found = tieExtremes(bracket(four, matches));
    expect(found.widest.margin).toBe(17);
    expect(found.widest.tie.a.names).toEqual(['Rho']);
    expect(found.closest.margin).toBe(3);
    expect(found.closest.tie.a.names).toEqual(['Sigma']);
  });

  it('names no closest tie where it would be the same one as the widest', () => {
    const one = [matches[0]];
    const found = tieExtremes(bracket(four, one));
    expect(found.widest.margin).toBe(17);
    expect(found.closest).toBe(null);
  });

  it('is nothing at all until a tie has been played', () => {
    expect(tieExtremes(bracket(four, []))).toBe(null);
    expect(tieExtremes(null)).toBe(null);
  });
});

describe('tieHistory', () => {
  const t = tournamentOf(ELEVEN);

  it('is the ties played, newest first, whatever round they belong to', () => {
    const matches = playOut(t);
    const view = bracket(t, matches);
    const log = tieHistory(view, matches);
    expect(log.length).toBe(view.played);
    const stamps = log.map((x) => x.endedAt);
    expect(stamps).toEqual([...stamps].sort((x, y) => y - x));
    expect(log[0].round).toBe('Final');
    expect(log[log.length - 1].round).toBe('Preliminary');
  });

  it('leaves out the ties nobody has played', () => {
    const first = bracket(t, []).playable[0];
    const matches = [tie(t.id, t.mode, first.a.names, first.b.names, 'a')];
    expect(tieHistory(bracket(t, matches), matches).length).toBe(1);
  });
});

// A cup played again every year, grouped by the suffix on its name. Nothing about a
// lineage is stored, so every one of these is a question about the *names*.
describe('splitSeriesName', () => {
  it('reads a Roman numeral, an integer and a year alike', () => {
    expect(splitSeriesName('Hole Corn VI')).toMatchObject({ series: 'Hole Corn', edition: 6 });
    expect(splitSeriesName('Hole Corn 7')).toMatchObject({ series: 'Hole Corn', edition: 7 });
    expect(splitSeriesName('Hole Corn 2026')).toMatchObject({ series: 'Hole Corn', edition: 2026 });
  });

  it('keeps the style, because that is what the next one is written in', () => {
    expect(splitSeriesName('Hole Corn VI').style).toBe('roman');
    expect(splitSeriesName('Hole Corn 2026').style).toBe('number');
    expect(splitSeriesName('Summer Cup').style).toBe(null);
  });

  // The uppercase rule, and it is not fussiness: read case-insensitively `mix` is 1009
  // and `did` is 501, so a lineage ending in an ordinary word would be split at it.
  it('does not take a lowercase word for a numeral', () => {
    expect(splitSeriesName('The Great Mix').series).toBe('The Great Mix');
    expect(splitSeriesName('What They Did').series).toBe('What They Did');
    expect(splitSeriesName('The Great MIX').edition).toBe(1009);
  });

  it('wants a whole trailing word, not a trailing run of letters', () => {
    expect(splitSeriesName('Hole CornVI').series).toBe('Hole CornVI');
    expect(splitSeriesName('HoleCorn2026').series).toBe('HoleCorn2026');
  });

  // Otherwise a cup called `V` is the fifth edition of a series with no name, and every
  // bare numeral in the list groups together under it.
  it('leaves a name that is nothing but a numeral alone', () => {
    expect(splitSeriesName('V')).toMatchObject({ series: 'V', edition: null });
    expect(splitSeriesName('2026')).toMatchObject({ series: '2026', edition: null });
  });

  it('refuses a numeral written the long way round', () => {
    // Canonical forms only, which is the point of the strict shape: the looser the rule
    // the more ordinary words it swallows.
    expect(splitSeriesName('Hole Corn IIII').series).toBe('Hole Corn IIII');
    expect(splitSeriesName('Hole Corn DIM').series).toBe('Hole Corn DIM');
  });

  it('is unbothered by the spacing it was typed with', () => {
    expect(splitSeriesName('  Hole Corn   VI  ')).toMatchObject({
      series: 'Hole Corn',
      edition: 6,
    });
  });
});

describe('seriesKey', () => {
  it('is the same lineage however the lineage name was cased', () => {
    expect(seriesKey('hole corn VII')).toBe(seriesKey('Hole Corn VI'));
  });

  // The known cost of the uppercase rule, pinned so it is a decision rather than a
  // surprise: a numeral typed in lowercase is not read as one, so the name keys to itself
  // and the edition sits in its own lineage. Visible — two headings — rather than silent,
  // and the alternative is worse: read case-insensitively, `Hole Corn Mix` is edition 1009
  // of Hole Corn, which is wrong in the way only somebody who knew the rule could spot.
  it('does not group an edition whose numeral was typed in lowercase', () => {
    expect(seriesKey('hole corn vii')).not.toBe(seriesKey('Hole Corn VI'));
  });

  it('groups a first edition that was never numbered with the ones that are', () => {
    expect(seriesKey('Summer Cup')).toBe(seriesKey('Summer Cup II'));
  });

  it('keeps two different cups apart', () => {
    expect(seriesKey('Hole Corn VI')).not.toBe(seriesKey('Summer Cup II'));
  });
});

describe('nextEditionName', () => {
  it('steps the suffix in the style the last one used', () => {
    expect(nextEditionName('Hole Corn VI')).toBe('Hole Corn VII');
    expect(nextEditionName('Hole Corn 2026')).toBe('Hole Corn 2027');
    expect(nextEditionName('Hole Corn 8')).toBe('Hole Corn 9');
  });

  it('numbers a cup that never was', () => {
    expect(nextEditionName('Summer Cup')).toBe('Summer Cup II');
  });

  it('carries a Roman numeral over its awkward boundaries', () => {
    expect(nextEditionName('Cup III')).toBe('Cup IV');
    expect(nextEditionName('Cup VIII')).toBe('Cup IX');
    expect(nextEditionName('Cup XXXIX')).toBe('Cup XL');
  });

  // `Draw` refuses a name already in use, so a suggestion landing on one would be a
  // button that fills the form and then holds `Make the draw` off.
  it('steps past a name already taken', () => {
    expect(nextEditionName('Hole Corn VI', ['Hole Corn VII'])).toBe('Hole Corn VIII');
    expect(nextEditionName('Hole Corn VI', ['hole corn vii'])).toBe('Hole Corn VIII');
  });

  it('reads its own output back as the same lineage', () => {
    for (const name of ['Hole Corn V', 'Summer Cup', 'Cup 2026', 'Cup 39']) {
      expect(seriesKey(nextEditionName(name))).toBe(seriesKey(name));
    }
  });
});

const cup = (id, name, entrants, createdAt) =>
  newTournament({
    id,
    name,
    mode: 'singles',
    target: 21,
    entrants: entrants.map((e) => [e]),
    createdAt,
  });

describe('groupBySeries', () => {
  const six = cup('t6', 'Hole Corn VI', ['Rho', 'Tau'], 600);
  const five = cup('t5', 'Hole Corn V', ['Rho', 'Tau'], 500);
  const summer = cup('s1', 'Summer Cup', ['Phi', 'Chi'], 550);

  it('puts every edition of a cup under one lineage', () => {
    const groups = groupBySeries([five, six, summer]);
    expect(groups.map((g) => g.name)).toEqual(['Hole Corn', 'Summer Cup']);
    expect(groups[0].editions.map((t) => t.id)).toEqual(['t6', 't5']);
  });

  // `newestFirst`'s ordering carried through the grouping, so this section reads in the
  // same order as the lists beside it rather than in whatever order the array held.
  it('orders lineages by their newest edition, newest edition first within one', () => {
    const groups = groupBySeries([five, summer, six]);
    expect(groups.map((g) => g.key)).toEqual([seriesKey('Hole Corn'), seriesKey('Summer Cup')]);
  });

  it('takes the lineage name from the most recent spelling', () => {
    const fixed = cup('t7', 'Hole  Corn VII', ['Rho', 'Tau'], 700);
    expect(groupBySeries([five, fixed])[0].name).toBe('Hole  Corn');
  });

  it('is one lineage of one for a cup played once', () => {
    expect(groupBySeries([summer]).map((g) => g.editions.length)).toEqual([1]);
  });

  // A blank name needs a hand-edited file, and grouping every one of them together would
  // invent a lineage out of the fault.
  it('drops a tournament with no name at all', () => {
    expect(groupBySeries([{ ...five, name: '' }])).toEqual([]);
  });
});

describe('seriesStats', () => {
  const six = cup('t6', 'Hole Corn VI', ['Rho', 'Tau'], 600);
  const five = cup('t5', 'Hole Corn V', ['Rho', 'Tau'], 500);
  // Rho won the newer one, Tau the older, so neither column can be right by accident.
  const played = [
    tie('t6', 'singles', ['Rho'], ['Tau'], 'a'),
    tie('t5', 'singles', ['Rho'], ['Tau'], 'b'),
  ];
  const row = (stats, name) => stats.rows.find((r) => r.name === name);

  it('adds up titles, finals and editions across the lineage', () => {
    const stats = seriesStats([six, five], played);
    expect(row(stats, 'Rho')).toMatchObject({ entered: 2, titles: 1, finals: 2 });
    expect(row(stats, 'Tau')).toMatchObject({ entered: 2, titles: 1, finals: 2 });
    expect(stats.decided).toBe(2);
    expect(stats.champions).toBe(2);
  });

  // The thing one cup structurally cannot say: inside a knockout every meeting is 1–0 and
  // every surviving entrant's form is all wins, because a beaten side plays no more ties.
  it('folds the tie record across editions, which one bracket cannot', () => {
    const stats = seriesStats([six, five], played);
    expect(row(stats, 'Rho')).toMatchObject({ matches: 2, wins: 1, losses: 1, played: true });
  });

  it('counts no honours for an edition still being played', () => {
    const seven = cup('t7', 'Hole Corn VII', ['Rho', 'Tau'], 700);
    const stats = seriesStats([seven, six, five], played);
    expect(stats.decided).toBe(2);
    expect(row(stats, 'Rho')).toMatchObject({ entered: 3, titles: 1, finals: 2 });
  });

  // The retroactive half, and the one a stored series id could not have: a recorded result
  // carries nothing but its result and whoever it remembers, so there is nothing on it to
  // have tagged. Here it remembers nobody, which is the shape the finalists stand in for.
  it('counts a recorded result, whose sheet is gone', () => {
    const one = recordedTournament({
      id: 't1',
      name: 'Hole Corn I',
      createdAt: 100,
      champion: ['Sigma'],
      runnerUp: ['Rho'],
    });
    const stats = seriesStats([six, five, one], played);
    expect(row(stats, 'Sigma')).toMatchObject({ entered: 1, titles: 1, finals: 1, played: false });
    expect(row(stats, 'Rho')).toMatchObject({ entered: 3, titles: 1, finals: 3 });
    expect(stats.unlisted).toBe(true);
    expect(stats.champions).toBe(3);
  });

  // The point of storing the field: an entrant who won nothing appears in the series at
  // all, and everybody's `entered` counts the edition rather than skipping it. Without it
  // Phi is in no table anywhere, having played four cups.
  it('counts everybody a recorded edition remembers, not only its finalists', () => {
    const one = recordedTournament({
      id: 't1',
      name: 'Hole Corn I',
      createdAt: 100,
      champion: ['Sigma'],
      runnerUp: ['Rho'],
      field: [['Sigma'], ['Rho'], ['Phi']],
    });
    const stats = seriesStats([six, five, one], played);
    expect(row(stats, 'Phi')).toMatchObject({ entered: 1, titles: 0, finals: 0, played: false });
    expect(row(stats, 'Rho')).toMatchObject({ entered: 3, titles: 1, finals: 3 });
    // Nothing is short, so the caption that says something is must not be drawn.
    expect(stats.unlisted).toBe(false);
  });

  it('leads with the most decorated', () => {
    const four = cup('t4', 'Hole Corn IV', ['Rho', 'Tau'], 400);
    const more = [...played, tie('t4', 'singles', ['Rho'], ['Tau'], 'a')];
    expect(seriesStats([six, five, four], more).rows[0].name).toBe('Rho');
  });

  it('says nothing at all about a lineage that is not there', () => {
    expect(seriesStats([], [])).toMatchObject({ editions: [], rows: [], decided: 0 });
  });
});

describe('seriesHistory', () => {
  const six = cup('t6', 'Hole Corn VI', ['Rho', 'Tau'], 600);
  const five = cup('t5', 'Hole Corn V', ['Rho', 'Tau'], 500);
  const summer = cup('s1', 'Summer Cup', ['Rho', 'Tau'], 550);
  const played = [
    tie('t6', 'singles', ['Rho'], ['Tau'], 'a'),
    tie('t5', 'singles', ['Rho'], ['Tau'], 'b'),
    tie('s1', 'singles', ['Rho'], ['Tau'], 'a'),
    // A friendly, tagged with no tournament at all.
    { ...tie(null, 'singles', ['Rho'], ['Tau'], 'a'), tournament: undefined },
  ];

  it('gathers every tie of the lineage, this edition and the ones before it', () => {
    const history = seriesHistory([six, five, summer], six, played);
    expect(history.name).toBe('Hole Corn');
    expect(history.matches.map((m) => m.tournament).sort()).toEqual(['t5', 't6']);
  });

  // The whole point of scoping to the lineage rather than to the cup in front of you:
  // within one knockout the loser plays no more ties, so every record is 1–0.
  it('reads back as a real record, which one edition cannot', () => {
    const rows = lineupStats(seriesHistory([six, five], six, played).matches, {
      mode: 'singles',
      players: { a: ['Rho', ''], b: ['Tau', ''] },
    });
    expect(rows[0]).toMatchObject({ name: 'Rho', wins: 1, losses: 1, played: true });
  });

  it('leaves another cup and the friendlies out of it', () => {
    const history = seriesHistory([six, five, summer], summer, played);
    expect(history.matches.map((m) => m.tournament)).toEqual(['s1']);
  });

  // Thin rather than absent, and deliberately not a fallback to the career numbers: the
  // panel's own `played` flag is what handles having nothing to say.
  it('is empty for the first tie of a first edition', () => {
    expect(seriesHistory([six], six, []).matches).toEqual([]);
  });

  // A record carrying the id that the bracket cannot place is not a tie of it — the rule
  // `tieMatches` already applies within one tournament, kept across the lineage.
  it('ignores a record tagged with the cup that no tie of it accounts for', () => {
    const stray = tie('t6', 'singles', ['Iota'], ['Kappa'], 'a');
    const history = seriesHistory([six, five], six, [...played, stray]);
    expect(history.matches.map((m) => m.id)).not.toContain(stray.id);
  });

  // Retroactive by the same route the rest of the lineage is: a cup whose sheet is gone
  // has no ties to contribute, and must not take the lineage down with it.
  it('counts a recorded result as an edition with nothing behind it', () => {
    const one = recordedTournament({
      id: 't1',
      name: 'Hole Corn I',
      createdAt: 100,
      champion: ['Sigma'],
    });
    expect(seriesHistory([six, five, one], six, played).matches).toHaveLength(2);
  });

  it('says nothing for a tournament with no name to group by', () => {
    expect(seriesHistory([six], { ...six, name: '  ' }, played)).toBeNull();
  });
});

describe('nextEditions', () => {
  const six = cup('t6', 'Hole Corn VI', ['Rho', 'Tau'], 600);
  const won = [tie('t6', 'singles', ['Rho'], ['Tau'], 'a')];

  it('offers the next name, and the terms the last one was played on', () => {
    expect(nextEditions([six], won)).toEqual([
      {
        key: seriesKey('Hole Corn'),
        name: 'Hole Corn VII',
        after: 'Hole Corn VI',
        mode: 'singles',
        target: 21,
      },
    ]);
  });

  // You do not draw Hole Corn VII while VI is still going, and that filter is most of
  // what keeps the row of chips short.
  it('offers nothing for a lineage still being played', () => {
    expect(nextEditions([six], [])).toEqual([]);
  });

  it('reads a doubles cup back as doubles', () => {
    const pairs = newTournament({
      id: 'd1',
      name: 'Pairs Cup II',
      mode: 'doubles',
      target: 15,
      entrants: [['Rho', 'Tau'], ['Phi', 'Chi']],
      createdAt: 900,
    });
    const done = [tie('d1', 'doubles', ['Rho', 'Tau'], ['Phi', 'Chi'], 'a')];
    expect(nextEditions([pairs], done)[0]).toMatchObject({
      name: 'Pairs Cup III',
      mode: 'doubles',
      target: 15,
    });
  });

  // A recorded result is a finished lineage with no mode and no target, and handing the
  // form an undefined mode is worse than letting it keep its own defaults.
  it('offers a next edition of a cup that only survives as a result', () => {
    const one = recordedTournament({
      id: 'r1',
      name: 'Hole Corn I',
      createdAt: 100,
      champion: ['Sigma'],
    });
    expect(nextEditions([one], [])[0]).toMatchObject({
      name: 'Hole Corn II',
      mode: 'singles',
      target: null,
    });
  });

  it('does not offer a name a tournament already has', () => {
    const seven = cup('t7', 'Hole Corn VII', ['Rho', 'Tau'], 700);
    const both = [...won, tie('t7', 'singles', ['Rho'], ['Tau'], 'a')];
    expect(nextEditions([six, seven], both).map((s) => s.name)).toEqual(['Hole Corn VIII']);
  });
});
