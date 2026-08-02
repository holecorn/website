import { describe, expect, it } from 'vitest';
import { parseGames } from './import-legacy.mjs';
import { bracket } from '../src/tournament.js';

// The one thing in tools/ with a rule behind it rather than a rendering. Everything here
// is about the half of a transcribed tournament that was never written down — the draw —
// because a draw that comes out wrong has no symptom: the bracket simply shows ties still
// to play, months after the tournament was won.
//
// Greek names, because the family this was written for must not be in a public repo.

const games = (...lines) => parseGames(lines.join('\n'));

// A knockout of four, played in round order.
const FOUR = [
  'tournament Hole Corn IV',
  '2024-09-01  Rho v Tau  21-13',
  '2024-09-01  Sigma v Phi  21-9',
  '2024-09-08  Rho v Sigma  21-17',
];

// Six, so two seats hold a preliminary and two are byes — the shape `bracketShape` puts
// at seats 0 and 2, which is the one an embedding has to find. Deliberately **not** in
// round order: ties are played according to who turns up, and the walk is supposed to
// read one side's own chronology rather than the interleaving between sides.
const SIX = [
  'tournament Hole Corn VI',
  '2024-07-01  Phi v Chi  21-11', // preliminary
  '2024-07-02  Rho v Tau  21-15', // the other preliminary, a day later
  '2024-07-03  Phi v Psi  21-19', // round of four, before the other preliminary's winner plays
  '2024-07-04  Rho v Omega  21-8',
  '2024-07-05  Rho v Phi  21-12',
];

describe('an ordinary file', () => {
  it('is untouched by any of this', () => {
    const { records, tournaments, problems } = games('2024-05-18  Neil v Sigma  21-13');
    expect(problems).toEqual([]);
    expect(tournaments).toEqual([]);
    // Absent, not null: a record outside a tournament keeps the shape it had before
    // tournaments existed, and an unedited one has to tie at 0 in `mergeMatches`.
    expect('tournament' in records[0]).toBe(false);
    expect('updatedAt' in records[0]).toBe(false);
  });
});

describe('a tournament reconstructed from its results', () => {
  it('draws the bracket that was played', () => {
    const { records, tournaments, problems } = games(...FOUR);
    expect(problems).toEqual([]);
    const view = bracket(tournaments[0], records);
    expect(view.played).toBe(view.total);
    expect(view.champion.names).toEqual(['Rho']);
    expect(view.runnerUp.names).toEqual(['Sigma']);
  });

  it('finds the preliminary seats, whatever order the ties were played in', () => {
    const { records, tournaments, problems } = games(...SIX);
    expect(problems).toEqual([]);
    const view = bracket(tournaments[0], records);
    expect(view.entrants).toHaveLength(6);
    expect(view.played).toBe(5);
    expect(view.played).toBe(view.total);
    expect(view.champion.names).toEqual(['Rho']);
    // The two entrants who came through a preliminary are the ones the deepest round
    // seats, and there are two ties there rather than the five a chronological count of
    // "first round" would give.
    expect(view.rounds[0].ties).toHaveLength(2);
  });

  // The canonical shape puts a preliminary at the *first* seat of a pair, and which side
  // of a tie was written down first is an accident of transcription — so a bye written
  // ahead of the entrant who played off needs the two subtrees tried the other way round.
  // Every fixture above happens not to: verified by mutation, dropping the swap passes
  // all of them.
  it('tries both sides of every node, so a bye written first still fits', () => {
    const { records, tournaments, problems } = games(
      'tournament Reversed',
      '2024-07-01  Phi v Chi  21-11',
      '2024-07-02  Rho v Tau  21-15',
      '2024-07-03  Psi v Phi  19-21',
      '2024-07-04  Omega v Rho  8-21',
      '2024-07-05  Rho v Phi  21-12',
    );
    expect(problems).toEqual([]);
    const view = bracket(tournaments[0], records);
    expect(view.played).toBe(view.total);
    expect(view.champion.names).toEqual(['Rho']);
  });

  it('tags every tie and nothing else', () => {
    const { records, tournaments } = games(...FOUR, 'friendlies', '2024-09-09  Rho v Tau  21-4');
    const tagged = records.filter((r) => r.tournament === tournaments[0].id);
    expect(tagged).toHaveLength(3);
    expect(records[3].tournament).toBeUndefined();
  });

  // Without this the tag never lands for anyone who imported their legacy games before
  // tournaments existed — both copies tie at 0 and `mergeMatches` keeps the local one.
  it('stamps a tie so the tag reaches a record already imported untagged', () => {
    const { records, tournaments } = games(...FOUR);
    expect(records.every((r) => r.updatedAt === tournaments[0].createdAt)).toBe(true);
    // In the past, so a name corrected in the app still wins the merge.
    expect(tournaments[0].createdAt).toBeLessThan(Date.now());
  });

  it('dates it from its earliest tie, so the lists sort by when it was played', () => {
    const { records, tournaments } = games(...FOUR);
    expect(tournaments[0].createdAt).toBe(Math.min(...records.map((r) => r.endedAt)));
  });

  it('gives the same ids twice running, so re-importing adds nothing', () => {
    expect(games(...FOUR).tournaments[0].id).toBe(games(...FOUR).tournaments[0].id);
  });
});

describe('what it refuses rather than reconstructing badly', () => {
  const failure = (...lines) => games(...lines).problems.join(' ');

  it('a field that does not add up to a knockout', () => {
    expect(failure(...FOUR, '2024-09-09  Zeta v Iota  21-4')).toMatch(/6 entrants need 5 ties/);
  });

  // The canonical shape alternates preliminaries between the halves, so a sheet that put
  // both of a six-field's preliminaries in one half is a different tree — not a
  // relabelling of this one. Refusing is the honest answer: the alternative is a bracket
  // that draws pairings nobody played.
  it('a bracket whose preliminaries sat where the app would not draw them', () => {
    expect(
      failure(
        'tournament Odd',
        '2024-07-01  Rho v Tau  21-11',
        '2024-07-02  Sigma v Phi  21-15',
        '2024-07-03  Rho v Sigma  21-19',
        '2024-07-04  Chi v Psi  21-8',
        '2024-07-05  Rho v Chi  21-12',
      ),
    ).toMatch(/preliminaries sat where the app would not draw them/);
  });

  it('ties played to different targets', () => {
    expect(failure(...FOUR.slice(0, 3), '2024-09-08  Rho v Sigma  26-17  to 26')).toMatch(
      /played to 21 and 26/,
    );
  });

  it('singles and doubles in one tournament', () => {
    expect(
      failure(
        'tournament Mixed',
        '2024-09-01  Rho v Tau  21-13',
        '2024-09-01  Sigma & Phi v Chi & Psi  21-9',
        '2024-09-08  Rho v Sigma  21-17',
      ),
    ).toMatch(/singles and doubles/);
  });

  it('a header with no ties under it', () => {
    expect(failure('tournament Empty')).toMatch(/no ties under it/);
  });

  it('the same tournament opened twice', () => {
    expect(failure(...FOUR, ...FOUR)).toMatch(/already has a section/);
  });
});

describe('a tournament whose sheet is gone', () => {
  it('is its result and nothing else', () => {
    const { records, tournaments, problems } = games('tournament Hole Corn I  won 2019-08-30 by Rho');
    expect(problems).toEqual([]);
    expect(records).toEqual([]);
    const view = bracket(tournaments[0], []);
    expect(view.recorded).toBe(true);
    expect(view.champion.names).toEqual(['Rho']);
    expect(view.runnerUp).toBeNull();
  });

  it('takes the runner-up where it is remembered, and a pair either side', () => {
    const { tournaments } = games(
      'tournament Hole Corn II  won 2020-08-29 by Rho & Tau beating Sigma & Phi',
    );
    const view = bracket(tournaments[0], []);
    expect(view.champion.names).toEqual(['Rho', 'Tau']);
    expect(view.runnerUp.names).toEqual(['Sigma', 'Phi']);
  });

  it('opens no section, so the games below it are ordinary again', () => {
    const { records } = games(
      'tournament Hole Corn I  won 2019-08-30 by Rho',
      '2024-05-18  Neil v Sigma  21-13',
    );
    expect(records[0].tournament).toBeUndefined();
  });

  it('refuses a date that is not one', () => {
    expect(games('tournament Bad  won 2019-02-31 by Rho').problems.join(' ')).toMatch(
      /is not a date/,
    );
  });
});
