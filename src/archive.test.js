import { afterEach, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { newGame, setBag, endRound } from './scoring.js';
import { bracket, groupBySeries, nextEditions, validTournament } from './tournament.js';
import { inactiveKeys } from './inactive.js';
import {
  RECORD_FORMAT,
  matchRecord,
  upsertMatch,
  removeMatch,
  renamePlayer,
  setMatchPlayers,
  validRecord,
  saveArchive,
  mergeMatches,
  unexportedCount,
  newestEnd,
  FILE_FORMAT,
  archiveFile,
  readArchiveFile,
} from './archive.js';

function wonGame(id = 'm1') {
  const tiers = ['hole', 'hole', 'hole', 'hole'];
  let game = { ...newGame(21), id, startedAt: 100, mode: 'singles' };
  game = { ...game, players: { a: ['Neil', 'Player 2'], b: ['Sigma', 'Player 2'] } };
  for (let i = 0; i < 2; i += 1) {
    game = tiers.reduce((g, tier, n) => setBag(g, 'a', n, tier), game);
    game = ['floor', 'floor', 'floor', 'floor'].reduce(
      (g, tier, n) => setBag(g, 'b', n, tier),
      game,
    );
    game = endRound(game);
  }
  return game;
}

describe('matchRecord', () => {
  it('stamps the format so a later shape can be told apart', () => {
    expect(matchRecord(wonGame(), 900).format).toBe(RECORD_FORMAT);
  });

  it('keeps rounds in the game shape so the scoring helpers still read them', () => {
    const record = matchRecord(wonGame(), 900);
    expect(record.rounds).toHaveLength(2);
    expect(record.rounds[0]).toMatchObject({
      a: ['hole', 'hole', 'hole', 'hole'],
      nets: { a: 12, b: 0 },
      first: 'a',
    });
    expect(record.winner).toBe('a');
  });

  it('carries no tournament key at all on an ordinary game', () => {
    // Absent rather than null, so a record outside a tournament keeps the shape it
    // had before they existed — `bracket` reads a missing key as "not a tie".
    expect('tournament' in matchRecord(wonGame(), 900)).toBe(false);
  });

  it('stamps the tournament a tie belongs to', () => {
    const game = { ...wonGame(), tournament: 't1' };
    expect(matchRecord(game, 900).tournament).toBe('t1');
  });

  it('copies rather than references, so later play cannot rewrite history', () => {
    const game = wonGame();
    const record = matchRecord(game, 900);
    game.players.a[0] = 'Someone else';
    game.rounds[0].a[0] = 'floor';
    expect(record.players.a[0]).toBe('Neil');
    expect(record.rounds[0].a[0]).toBe('hole');
  });
});

describe('upsertMatch', () => {
  const base = matchRecord(wonGame('m1'), 900);

  it('appends a match it has not seen', () => {
    const other = matchRecord(wonGame('m2'), 950);
    expect(upsertMatch([base], other).map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('replaces in place rather than duplicating on a re-win', () => {
    const again = matchRecord(wonGame('m1'), 2000);
    const out = upsertMatch([base], again);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('m1');
  });

  it('keeps the original end time when a finished match is committed again', () => {
    const again = matchRecord(wonGame('m1'), 2000);
    expect(upsertMatch([base], again)[0].endedAt).toBe(900);
  });

  it('does not mutate the list it was given', () => {
    const records = [base];
    upsertMatch(records, matchRecord(wonGame('m2'), 950));
    expect(records).toHaveLength(1);
  });
});

describe('removeMatch', () => {
  it('drops only the named match', () => {
    const records = [matchRecord(wonGame('m1'), 900), matchRecord(wonGame('m2'), 950)];
    expect(removeMatch(records, 'm1').map((m) => m.id)).toEqual(['m2']);
    expect(removeMatch(records, 'nope')).toHaveLength(2);
  });
});

describe('validRecord', () => {
  const good = matchRecord(wonGame('m1'), 900);

  it('accepts a record the app produced', () => {
    expect(validRecord(good)).toBe(true);
  });

  it('rejects anything that would break the stats screen', () => {
    expect(validRecord(null)).toBe(false);
    expect(validRecord('a string')).toBe(false);
    expect(validRecord({ ...good, id: '' })).toBe(false);
    expect(validRecord({ ...good, rounds: 'not an array' })).toBe(false);
    expect(validRecord({ ...good, players: { a: ['Neil'] } })).toBe(false);
    // A round missing the bag arrays that tierCounts walks.
    expect(validRecord({ ...good, rounds: [{ nets: { a: 1, b: 0 } }] })).toBe(false);
    // Nets that would render as NaN rather than failing.
    expect(validRecord({ ...good, rounds: [{ a: [], b: [], nets: { a: 'x', b: 0 } }] })).toBe(
      false,
    );
  });

  // The elements, not just the arrays: `nameKey` coerces, so a slot holding a
  // number or an object keys truthily and blanks every screen that folds the
  // archive. One such record from an import is unrecoverable without devtools,
  // because the stats screen that could delete it is the first thing to die.
  it('rejects a name slot that is not a string', () => {
    for (const odd of [{}, 7, true, ['a', 'b'], null, undefined]) {
      expect(validRecord({ ...good, players: { a: [odd, ''], b: ['Sigma', ''] } })).toBe(false);
      expect(validRecord({ ...good, players: { a: ['Neil', ''], b: [odd, ''] } })).toBe(false);
    }
  });

  it('still accepts the empty slot a singles record carries', () => {
    expect(validRecord({ ...good, players: { a: ['Neil', ''], b: ['Sigma', ''] } })).toBe(true);
  });
});

// The one storage wrapper worth a unit test, because what it does on a *failed* write
// is a rule rather than plumbing. It used to prune and retry until the write fit, and
// call the survivors "the recent history" — but `slice(1)` is insertion order and
// `mergeMatches` appends, so an import that overflowed destroyed this season's games and
// kept the oldest ones. Silently: the caller set state from the pruned list, so nothing
// on screen ever hinted at it.
describe('saveArchive on a storage that refuses the write', () => {
  const held = [matchRecord(wonGame('m1'), 900), matchRecord(wonGame('m2'), 950)];
  afterEach(() => {
    delete globalThis.localStorage;
  });

  const storage = (accept) => {
    let raw = JSON.stringify(held);
    globalThis.localStorage = {
      getItem: () => raw,
      setItem: (_key, value) => {
        if (!accept) throw new DOMException('quota', 'QuotaExceededError');
        raw = value;
      },
    };
  };

  it('keeps every record rather than deleting to make room', () => {
    storage(false);
    const write = saveArchive([...held, matchRecord(wonGame('m3'), 990)]);
    expect(write.saved).toBe(false);
    // What storage really holds, so the caller's state cannot claim the write landed.
    expect(write.stored.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('reports a write that got through, with what is now stored', () => {
    storage(true);
    const write = saveArchive([...held, matchRecord(wonGame('m3'), 990)]);
    expect(write.saved).toBe(true);
    expect(write.stored.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });
});

describe('setMatchPlayers', () => {
  const records = [matchRecord(wonGame('m1'), 900), matchRecord(wonGame('m2'), 950)];
  const fixed = { a: ['Neil', 'Player 2'], b: ['Sigma Q', 'Player 2'] };

  it('replaces the named match and leaves the rest alone', () => {
    const out = setMatchPlayers(records, 'm1', fixed, 5000);
    expect(out[0].players.b[0]).toBe('Sigma Q');
    expect(out[1].players.b[0]).toBe('Sigma');
  });

  it('stamps the edit, so a stale copy of the match cannot win a merge', () => {
    const out = setMatchPlayers(records, 'm1', fixed, 5000);
    expect(out[0].updatedAt).toBe(5000);
    expect(out[1].updatedAt).toBeUndefined();
  });

  it('leaves the rounds alone — attribution is by slot, not by name', () => {
    const out = setMatchPlayers(records, 'm1', fixed, 5000);
    expect(out[0].rounds).toEqual(records[0].rounds);
  });

  it('copies the lineup it is handed rather than holding on to it', () => {
    const players = { a: ['Neil', 'Player 2'], b: ['Sigma Q', 'Player 2'] };
    const out = setMatchPlayers(records, 'm1', players, 5000);
    players.b[0] = 'Later';
    expect(out[0].players.b[0]).toBe('Sigma Q');
  });

  it('does not mutate the list it was given', () => {
    setMatchPlayers(records, 'm1', fixed, 5000);
    expect(records[0].players.b[0]).toBe('Sigma');
  });
});

describe('renamePlayer', () => {
  const records = [
    matchRecord({ ...wonGame('m1'), players: { a: ['neil ', 'Rho'], b: ['Sigma', 'Tau'] } }, 900),
    matchRecord({ ...wonGame('m2'), players: { a: ['Rho', 'Tau'], b: ['Phi', 'Chi'] } }, 950),
  ];

  it('renames every appearance, folding case and padding the way the career does', () => {
    const out = renamePlayer(records, 'NEIL', 'Neil P', 5000);
    expect(out[0].players.a[0]).toBe('Neil P');
    expect(out[0].updatedAt).toBe(5000);
  });

  it('leaves a match the player never appeared in untouched and unstamped', () => {
    const out = renamePlayer(records, 'neil', 'Neil P', 5000);
    expect(out[1]).toBe(records[1]);
  });

  it('merges onto a name that already exists, because folding is the identity', () => {
    const out = renamePlayer(records, 'Chi', 'Tau', 5000);
    expect(out[1].players.b).toEqual(['Phi', 'Tau']);
    expect(out[1].players.a).toEqual(['Rho', 'Tau']);
  });

  it('renames across both teams and every slot at once', () => {
    const out = renamePlayer(records, 'Tau', 'Tau B', 5000);
    expect(out[0].players.b).toEqual(['Sigma', 'Tau B']);
    expect(out[1].players.a).toEqual(['Rho', 'Tau B']);
  });

  it('ignores a blank name in either direction', () => {
    expect(renamePlayer(records, 'Rho', '   ', 5000)).toBe(records);
    expect(renamePlayer(records, '  ', 'Rho', 5000)).toBe(records);
  });

  it('does not mutate the list it was given', () => {
    renamePlayer(records, 'Rho', 'Rho B', 5000);
    expect(records[1].players.a[0]).toBe('Rho');
  });
});

describe('mergeMatches', () => {
  const mine = [matchRecord(wonGame('m1'), 900)];
  const renamed = (records, at) => renamePlayer(records, 'Sigma', 'Sigma Q', at);

  it('adds matches this device has not seen', () => {
    const theirs = [matchRecord(wonGame('m2'), 950)];
    expect(mergeMatches(mine, theirs).map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('is idempotent, so re-importing the same file changes nothing', () => {
    const once = mergeMatches(mine, [matchRecord(wonGame('m2'), 950)]);
    expect(mergeMatches(once, [matchRecord(wonGame('m2'), 950)])).toHaveLength(2);
  });

  it('keeps the local copy of a match both devices already have', () => {
    const merged = mergeMatches(mine, [matchRecord(wonGame('m1'), 5000)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].endedAt).toBe(900);
  });

  // An export is a snapshot, so the file being imported is routinely older than
  // what is here. Before edits existed either copy would do; now the one that was
  // edited last has to win, whichever side of the transfer it is on.
  it('keeps a local rename when the file predates it', () => {
    const merged = mergeMatches(renamed(mine, 5000), mine);
    expect(merged[0].players.b[0]).toBe('Sigma Q');
  });

  it('takes a rename made on the other device', () => {
    const merged = mergeMatches(mine, renamed(mine, 5000));
    expect(merged[0].players.b[0]).toBe('Sigma Q');
  });

  it('keeps the newer of two renames', () => {
    const merged = mergeMatches(renamed(mine, 5000), renamePlayer(mine, 'Sigma', 'Sigma R', 4000));
    expect(merged[0].players.b[0]).toBe('Sigma Q');
  });

  // The tie is what keeps an import from rewriting local history, and it has to
  // be read off the body: `upsertMatch` keeps the local `endedAt` whichever copy
  // wins, so the assertion above this cannot see the rule at all.
  it('keeps the local copy when neither has been edited', () => {
    const theirs = [{ ...mine[0], players: { ...mine[0].players, b: ['Sigma R', 'Player 2'] } }];
    expect(mergeMatches(mine, theirs)[0].players.b[0]).toBe('Sigma');
  });

  it('keeps the local copy when both were edited at the same moment', () => {
    const merged = mergeMatches(renamed(mine, 5000), renamePlayer(mine, 'Sigma', 'Sigma R', 5000));
    expect(merged[0].players.b[0]).toBe('Sigma Q');
  });

  it('is still idempotent once a match has been edited', () => {
    const edited = renamed(mine, 5000);
    expect(mergeMatches(edited, edited)).toEqual(edited);
  });

  it('skips unusable entries instead of rejecting the whole file', () => {
    const merged = mergeMatches(mine, [null, { id: 'junk' }, matchRecord(wonGame('m2'), 950)]);
    expect(merged.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('ignores a file that is not a list at all', () => {
    expect(mergeMatches(mine, { nope: true })).toBe(mine);
  });
});

describe('unexportedCount', () => {
  const records = [
    matchRecord(wonGame('m1'), 100),
    matchRecord(wonGame('m2'), 200),
    matchRecord(wonGame('m3'), 300),
  ];

  it('counts everything when nothing has been exported', () => {
    expect(unexportedCount(records, 0)).toBe(3);
  });

  it('counts only what finished after the last export', () => {
    expect(unexportedCount(records, 200)).toBe(1);
  });

  it('reaches zero once the newest end time has been exported', () => {
    expect(newestEnd(records)).toBe(300);
    expect(unexportedCount(records, newestEnd(records))).toBe(0);
  });

  it('does not go backwards if the oldest match is pruned away', () => {
    expect(unexportedCount(records.slice(1), 200)).toBe(1);
  });
});

// The checked-in sample archive (tools/fixtures/sample-archive.json), which is
// imported by hand when working on anything that reads history. `mergeMatches`
// drops an invalid record *silently*, so a change to `validRecord` would leave the
// fixture half-importing with nothing to say so — and the generator only validates
// at the moment it writes.
describe('the sample archive fixture', () => {
  const file = readArchiveFile(
    JSON.parse(readFileSync(new URL('../tools/fixtures/sample-archive.json', import.meta.url), 'utf8')),
  );
  const sample = file?.matches ?? [];

  it('is a file the app would import', () => {
    // Read through `readArchiveFile` rather than parsed as an array, because that is
    // what Import does — and a fixture that carried the ties but not the brackets would
    // import without complaint and leave every tournament pointing at nothing.
    expect(file).not.toBeNull();
    expect(sample.length).toBeGreaterThan(0);
    expect(sample.filter((m) => !validRecord(m))).toEqual([]);
  });

  it('carries both kinds of record, which is the point of it', () => {
    expect(sample.some((m) => m.rounds.length > 0)).toBe(true);
    expect(sample.some((m) => m.rounds.length === 0 && m.final)).toBe(true);
  });

  // Not something `validRecord` refuses — a clash is only decoration, and the
  // names carry the identity on every screen a record's colours reach. But the
  // app's swatches make it unreachable by playing, so a fixture that showed one
  // would be showing a state nobody can get to.
  it('never puts one colour on both teams, as the app cannot', () => {
    expect(sample.filter((m) => m.colors.a === m.colors.b)).toEqual([]);
  });

  it('imports whole, and again adds nothing', () => {
    const once = mergeMatches([], sample);
    expect(once).toHaveLength(sample.length);
    expect(mergeMatches(once, sample)).toHaveLength(sample.length);
  });
});

describe('archiveFile and readArchiveFile', () => {
  const match = matchRecord(wonGame(), 900);
  const tournament = { id: 't1', entrants: [['Neil'], ['Sigma']] };

  it('writes an envelope carrying all three', () => {
    expect(archiveFile([match], [tournament], { rho: 900 })).toEqual({
      format: FILE_FORMAT,
      matches: [match],
      tournaments: [tournament],
      inactive: { rho: 900 },
    });
  });

  it('round-trips', () => {
    const parsed = JSON.parse(JSON.stringify(archiveFile([match], [tournament], { rho: 900 })));
    expect(readArchiveFile(parsed)).toEqual({
      matches: [match],
      tournaments: [tournament],
      inactive: { rho: 900 },
    });
  });

  it('still reads an export taken before tournaments existed', () => {
    // A bare array is every file exported so far, and those have to keep importing.
    expect(readArchiveFile([match])).toEqual({ matches: [match], tournaments: [], inactive: {} });
  });

  it('tolerates an envelope missing either of the other two sections', () => {
    expect(readArchiveFile({ matches: [match] })).toEqual({
      matches: [match],
      tournaments: [],
      inactive: {},
    });
    expect(readArchiveFile({ matches: [match], inactive: ['nope'] })).toEqual({
      matches: [match],
      tournaments: [],
      inactive: {},
    });
  });

  it('refuses anything that is not an export', () => {
    expect(readArchiveFile(null)).toBeNull();
    expect(readArchiveFile('nope')).toBeNull();
    expect(readArchiveFile({ tournaments: [] })).toBeNull();
  });
});

// The tournaments in the same fixture. A bracket is derived from the draw plus the ties
// tagged with its id, so the only way it can be wrong is for those two to disagree —
// which no amount of validating either alone would catch.
describe('the sample archive fixture, tournaments', () => {
  const file = readArchiveFile(
    JSON.parse(
      readFileSync(new URL('../tools/fixtures/sample-archive.json', import.meta.url), 'utf8'),
    ),
  );
  const views = file.tournaments.map((t) => ({ t, view: bracket(t, file.matches) }));
  // A transcribed result has no bracket behind it at all, so every assertion about
  // shapes and ties is about the drawn ones. Split here rather than guarded in each.
  const drawn = views.filter((x) => !x.view.recorded);
  const recorded = views.filter((x) => x.view.recorded);

  it('carries some, and every one of them is usable', () => {
    expect(file.tournaments.length).toBeGreaterThan(0);
    expect(file.tournaments.filter((t) => !validTournament(t))).toEqual([]);
    expect(views.filter((x) => !x.view)).toEqual([]);
  });

  it('has every tie matched to a record in the same file', () => {
    // The failure this exists for: a tie whose two sides no record holds is a bracket
    // that can never be finished, and nothing about either half on its own says so.
    for (const { t, view } of drawn) {
      const played = view.ties.filter((x) => x.match).length;
      expect(played, t.name).toBe(view.played);
      expect(view.played, t.name).toBeGreaterThan(0);
    }
  });

  it('has a result with a field remembered and one with only the trophy', () => {
    // The two are captioned differently — a series says it is counting only who is
    // remembered — so a fixture with one of them shows half of it. `fieldKnown` is what
    // tells them apart, and it is derived, so the file itself can only be checked by the
    // `field` that produced it.
    expect(recorded.some((x) => x.view.fieldKnown)).toBe(true);
    expect(recorded.some((x) => !x.view.fieldKnown)).toBe(true);
    const listed = recorded.find((x) => x.view.fieldKnown);
    expect(listed.t.field.length).toBeGreaterThan(2);
    expect(listed.view.entrants.length).toBe(listed.t.field.length);
  });

  it('has a bracket whose ties carry no round detail', () => {
    // A transcribed sheet: the shape that drops the rate columns from a tournament's
    // Stats tab, which is the one place a whole cup of them is the normal case.
    const ties = (view) =>
      view.ties.map((x) => file.matches.find((m) => m.id === x.match)).filter(Boolean);
    const transcribed = (x) =>
      x.view.played > 0 && ties(x.view).every((m) => m.rounds.length === 0);
    expect(drawn.some(transcribed)).toBe(true);
    expect(drawn.some((x) => ties(x.view).some((m) => m.rounds.length > 0))).toBe(true);
  });

  it('has both a finished tournament and one still running', () => {
    // Both states are worth having something to look at, and each is a different screen:
    // a champion with an openable bracket, and a live one with ties to play.
    expect(views.some((x) => x.view.done)).toBe(true);
    expect(views.some((x) => !x.view.done && x.view.playable.length > 0)).toBe(true);
  });

  it('has a field with preliminaries and one without', () => {
    // The two shapes behave differently everywhere — a power of two has no deepest
    // ragged column — so a fixture with only one of them exercises half the layout.
    const rounds = drawn.map((x) => x.view.shape);
    expect(rounds.some((s) => s.rounds > Math.log2(s.size))).toBe(true);
    expect(rounds.some((s) => s.rounds === Math.log2(s.size))).toBe(true);
  });

  it('has a doubles tournament, where an entrant is a pair', () => {
    const pairs = file.tournaments.find((t) => t.mode === 'doubles');
    expect(pairs).toBeDefined();
    expect(pairs.entrants.every((e) => e.length === 2 && e.every(Boolean))).toBe(true);
  });

  it('has a cup played more than once, and one played once', () => {
    // A series is read off the names and stored nowhere, so it is the one thing in the
    // fixture a rename could quietly take apart — and the Series section draws only where
    // a name has been used twice, so both sides of that are worth having.
    const series = groupBySeries(file.tournaments);
    expect(series.some((g) => g.editions.length > 1)).toBe(true);
    expect(series.some((g) => g.editions.length === 1)).toBe(true);
  });

  it('offers a next edition, which needs a finished series', () => {
    // `nextEditions` only offers where the newest edition is done, so a fixture whose
    // every series is still running exercises none of the draw form's prefill.
    expect(nextEditions(file.tournaments, file.matches).length).toBeGreaterThan(0);
  });

  it('marks somebody inactive, and they read as inactive against these matches', () => {
    // The mark is a stamp, and being inactive is derived from it against the archive — so
    // a stamp sitting behind the person's last match is a mark that hides nobody, with
    // nothing on any screen to say so.
    expect(Object.keys(file.inactive)).not.toEqual([]);
    expect([...inactiveKeys(file.inactive, file.matches)]).toEqual(Object.keys(file.inactive));
  });
});
