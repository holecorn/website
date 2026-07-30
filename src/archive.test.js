import { describe, it, expect } from 'vitest';
import { newGame, setBag, endRound } from './scoring.js';
import {
  RECORD_FORMAT,
  matchRecord,
  upsertMatch,
  removeMatch,
  renamePlayer,
  setMatchPlayers,
  validRecord,
  mergeMatches,
  unexportedCount,
  newestEnd,
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
