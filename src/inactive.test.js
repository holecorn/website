import { describe, it, expect } from 'vitest';
import {
  activeNames,
  inactiveKeys,
  markActive,
  markInactive,
  mergeInactive,
  renameMark,
} from './inactive.js';

// A minimal record: only the fields `lastSeen` reads. Written out rather than played
// through `scoring.js` the way `stats.test.js` builds its fixtures, because nothing
// here touches a round — the mark is about who, and when, not about how they threw.
function match(players, endedAt, mode = 'singles') {
  return { id: `m${endedAt}`, mode, endedAt, players, rounds: [], winner: 'a' };
}

const RHO_V_TAU = match({ a: ['Rho', 'Player 2'], b: ['Tau', 'Player 4'] }, 1000);

describe('inactiveKeys', () => {
  it('hides somebody marked after their last game', () => {
    const marks = markInactive({}, 'Rho', [RHO_V_TAU], 2000);
    expect([...inactiveKeys(marks, [RHO_V_TAU])]).toEqual(['rho']);
  });

  it('brings them back once they play again, with nothing else written', () => {
    // The whole reason the mark is a timestamp rather than a flag: there is no
    // second write path, so this cannot be forgotten or left stale.
    const marks = markInactive({}, 'Rho', [RHO_V_TAU], 2000);
    const later = match({ a: ['Rho', 'Player 2'], b: ['Tau', 'Player 4'] }, 3000);
    expect(inactiveKeys(marks, [RHO_V_TAU, later]).size).toBe(0);
  });

  it('leaves them hidden when an older game of theirs is imported', () => {
    const marks = markInactive({}, 'Rho', [RHO_V_TAU], 2000);
    const older = match({ a: ['Rho', 'Player 2'], b: ['Tau', 'Player 4'] }, 500);
    expect([...inactiveKeys(marks, [older, RHO_V_TAU])]).toEqual(['rho']);
  });

  it('ignores a singles record second slot, the roster rule playedIn uses', () => {
    // Otherwise the unused default slot keeps a phantom in the group, and marking
    // it would hide a name nobody ever played under.
    const marks = markInactive({}, 'Player 2', [RHO_V_TAU], 2000);
    const played = match({ a: ['Rho', 'Player 2'], b: ['Tau', 'Player 4'] }, 3000);
    expect([...inactiveKeys(marks, [RHO_V_TAU, played])]).toEqual(['player 2']);
  });

  it('counts both partners in doubles', () => {
    const marks = markInactive({}, 'Player 2', [RHO_V_TAU], 2000);
    const doubles = match({ a: ['Rho', 'Player 2'], b: ['Tau', 'Player 4'] }, 3000, 'doubles');
    expect(inactiveKeys(marks, [RHO_V_TAU, doubles]).size).toBe(0);
  });

  it('folds spellings the way nameKey does', () => {
    const marks = markInactive({}, '  rho ', [RHO_V_TAU], 2000);
    expect([...inactiveKeys(marks, [RHO_V_TAU])]).toEqual(['rho']);
  });

  it('survives a record with no players at all', () => {
    const marks = markInactive({}, 'Rho', [RHO_V_TAU], 2000);
    expect(() => inactiveKeys(marks, [{ id: 'x', endedAt: 9000 }])).not.toThrow();
  });
});

describe('markInactive', () => {
  it('stamps past their last match, so the mark always takes effect', () => {
    // Both are Date.now() values. A slow clock would otherwise stamp somebody with a
    // time older than the game they have just played, and the button does nothing.
    const marks = markInactive({}, 'Rho', [match({ a: ['Rho', ''], b: ['Tau', ''] }, 9000)], 2000);
    expect(marks.rho).toBe(9001);
    expect(inactiveKeys(marks, [match({ a: ['Rho', ''], b: ['Tau', ''] }, 9000)]).size).toBe(1);
  });

  it('ignores a blank name', () => {
    expect(markInactive({}, '   ', [], 2000)).toEqual({});
  });
});

describe('markActive', () => {
  it('removes the mark', () => {
    const marks = markInactive({}, 'Rho', [RHO_V_TAU], 2000);
    expect(markActive(marks, 'Rho')).toEqual({});
  });

  it('leaves everybody else alone', () => {
    let marks = markInactive({}, 'Rho', [RHO_V_TAU], 2000);
    marks = markInactive(marks, 'Tau', [RHO_V_TAU], 2000);
    expect(Object.keys(markActive(marks, 'Rho'))).toEqual(['tau']);
  });
});

describe('renameMark', () => {
  it('moves the mark with the person, keeping the original stamp', () => {
    // Restamping would say they stopped playing when their name was corrected.
    const marks = markInactive({}, 'Rho', [RHO_V_TAU], 2000);
    expect(renameMark(marks, 'Rho', 'Rhoda', false)).toEqual({ rhoda: 2000 });
  });

  it('leaves an active player active when a departed one is merged into them', () => {
    // The surviving name's own state stands, or fixing a duplicate silently retires
    // somebody who is still turning up.
    const marks = markInactive({}, 'Rho', [RHO_V_TAU], 2000);
    expect(renameMark(marks, 'Rho', 'Tau', true)).toEqual({});
  });

  it('leaves a departed player departed when an active one is merged into them', () => {
    const marks = markInactive({}, 'Tau', [RHO_V_TAU], 2000);
    expect(renameMark(marks, 'Rho', 'Tau', true)).toEqual({ tau: 2000 });
  });

  it('does nothing for a rename that only changes the spelling', () => {
    const marks = markInactive({}, 'Rho', [RHO_V_TAU], 2000);
    expect(renameMark(marks, 'rho', 'Rho', false)).toEqual({ rho: 2000 });
  });

  it('carries nothing across for a player who was never marked', () => {
    expect(renameMark({}, 'Rho', 'Rhoda', false)).toEqual({});
  });
});

describe('mergeInactive', () => {
  it('is idempotent, so re-importing the same file changes nothing', () => {
    const mine = markInactive({}, 'Rho', [RHO_V_TAU], 2000);
    expect(mergeInactive(mine, mine)).toEqual(mine);
  });

  it('takes the newer mark, the rule mergeMatches settles an edit by', () => {
    expect(mergeInactive({ rho: 2000 }, { rho: 5000 })).toEqual({ rho: 5000 });
    expect(mergeInactive({ rho: 5000 }, { rho: 2000 })).toEqual({ rho: 5000 });
  });

  it('brings in somebody the other device marked', () => {
    expect(mergeInactive({}, { tau: 2000 })).toEqual({ tau: 2000 });
  });

  it('cannot express being made active again, which is the known limit', () => {
    // An absence has nothing to outrank a mark with, so a stale file brings it back.
    // Same shape as a deleted match returning: an export is a snapshot, not a log.
    expect(mergeInactive({}, { rho: 2000 })).toEqual({ rho: 2000 });
  });

  it('drops anything that is not a stamp, since the file came from a picker', () => {
    expect(mergeInactive({}, { rho: 'yesterday', tau: null, '': 5 })).toEqual({});
    expect(mergeInactive({ rho: 1 }, ['nope'])).toEqual({ rho: 1 });
    expect(mergeInactive({ rho: 1 }, null)).toEqual({ rho: 1 });
  });
});

describe('activeNames', () => {
  it('drops the hidden and keeps the order', () => {
    const hidden = inactiveKeys(markInactive({}, 'Rho', [RHO_V_TAU], 2000), [RHO_V_TAU]);
    expect(activeNames(['Neil', 'Rho', 'Tau'], hidden)).toEqual(['Neil', 'Tau']);
  });
});
