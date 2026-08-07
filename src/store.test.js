// The one rule the archive, the draw and the inactive marks share: **a value this
// bundle cannot read is not a value it may overwrite.** Its own file rather than three
// blocks in three suites, because it is one rule over three keys and a copy per module
// is exactly how two of them would come to disagree.
//
// Driven through the real `loadX`/`saveX` pairs rather than through `jsonStore`
// directly, so it also pins that each module is wired to it — the half a unit test on
// the factory alone would miss.
//
// `archive.test.js` keeps its own quota block. That one is about not *deleting* to make
// room; this is about not overwriting, and they are only neighbours.

import { afterEach, describe, expect, it } from 'vitest';
import { loadArchive, saveArchive } from './archive.js';
import { loadTournaments, saveTournaments } from './tournament.js';
import { loadInactive, saveInactive } from './inactive.js';
import { NO_ROOM, UNREADABLE } from './store.js';

const record = {
  format: 1,
  id: 'm1',
  players: { a: ['Neil', ''], b: ['Sigma', ''] },
  rounds: [{ a: [], b: [], nets: { a: 3, b: 0 } }],
};
const tournament = { id: 'summer-cup', name: 'Summer Cup', entrants: [['Rho'], ['Tau']] };

// One entry per key, so each case below runs three times over the shape that key holds.
const STORES = [
  {
    what: 'the archive',
    key: 'holecorn.matches.v1',
    load: loadArchive,
    save: saveArchive,
    empty: [],
    good: [record],
    write: [record, { ...record, id: 'm2' }],
    // The shape a later version would plausibly write, the way the export file already
    // carries an envelope.
    newer: { format: 2, matches: [record] },
  },
  {
    what: 'the tournaments',
    key: 'holecorn.tournaments.v1',
    load: loadTournaments,
    save: saveTournaments,
    empty: [],
    good: [tournament],
    write: [tournament, { ...tournament, id: 'winter-cup' }],
    newer: { format: 2, tournaments: [tournament] },
  },
  {
    what: 'the inactive marks',
    key: 'holecorn.inactive.v1',
    load: loadInactive,
    save: saveInactive,
    empty: {},
    good: { omicron: 900 },
    write: { omicron: 900, kappa: 950 },
    // An array here is as unreadable as a string is: nothing has ever written one.
    newer: [{ name: 'omicron', at: 900 }],
  },
];

let held;
let accepting;

function storage(initial) {
  held = initial === undefined ? null : JSON.stringify(initial);
  accepting = true;
  globalThis.localStorage = {
    getItem: () => held,
    setItem: (_key, value) => {
      if (!accepting) throw new DOMException('quota', 'QuotaExceededError');
      held = value;
    },
  };
}

afterEach(() => {
  delete globalThis.localStorage;
});

describe.each(STORES)('$what', ({ load, save, empty, good, write, newer }) => {
  it('reads what is stored, and writes over it', () => {
    storage(good);
    expect(load()).toEqual(good);
    const result = save(write);
    expect(result.saved).toBe(true);
    expect(JSON.parse(held)).toEqual(write);
  });

  it('is empty and writable on a phone that has never stored one', () => {
    storage(undefined);
    expect(load()).toEqual(empty);
    expect(save(write).saved).toBe(true);
    expect(JSON.parse(held)).toEqual(write);
  });

  // The measured defect: reading gave the empty value, so the next write went out as if
  // there were nothing to lose. 300 matches became 1 on one won game.
  it('refuses to overwrite a shape a newer version wrote', () => {
    storage(newer);
    const before = held;
    const result = save(write);
    expect(result.saved).toBe(false);
    expect(result.reason).toBe(UNREADABLE);
    expect(held).toBe(before);
  });

  it('refuses to overwrite something that is not JSON at all', () => {
    storage(undefined);
    held = 'half a write';
    const result = save(write);
    expect(result.saved).toBe(false);
    expect(result.reason).toBe(UNREADABLE);
    expect(held).toBe('half a write');
  });

  // Reading was never the destructive half, and it must stay tolerant: the screens draw
  // an empty history rather than crashing, and the notice is what says why.
  it('still reads as empty rather than throwing', () => {
    storage(newer);
    expect(load()).toEqual(empty);
  });

  // The refusal the app already had, kept apart from the new one because the advice
  // differs — a full archive is on screen to export and delete and an unreadable one
  // is not.
  it('reports a full phone as a different refusal', () => {
    storage(good);
    accepting = false;
    const result = save(write);
    expect(result.saved).toBe(false);
    expect(result.reason).toBe(NO_ROOM);
    expect(result.stored).toEqual(good);
  });
});
