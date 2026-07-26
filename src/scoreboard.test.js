import { describe, it, expect } from 'vitest';
import { newGame, setBag, endRound, setFirst } from './scoring.js';
import {
  REORDER_WINDOW,
  acceptsUpdate,
  configComplete,
  configFromSearch,
  displayUrl,
  normalizeCode,
  onlineTopic,
  scoreboardPayload,
  segmentDigits,
  stateTopic,
} from './scoreboard.js';

const throwAll = (game, team, tiers) =>
  tiers.reduce((g, tier, i) => setBag(g, team, i, tier), game);

describe('scoreboardPayload', () => {
  it('reports the logged score, not the in-progress round', () => {
    let game = newGame(21);
    game = throwAll(game, 'a', ['hole', 'board', 'floor', 'floor']);
    game = throwAll(game, 'b', ['floor', 'floor', 'floor', 'floor']);
    game = endRound(game);
    // Half-thrown next round: must not leak into the published score.
    game = setBag(game, 'a', 0, 'hole');

    expect(scoreboardPayload(game)).toMatchObject({ a: 4, b: 0, round: 1 });
  });

  // toEqual, not toMatchObject: the payload sits on a measured byte budget, so
  // a field nothing renders should fail the test rather than quietly ship.
  it('carries only what a display renders', () => {
    let game = newGame(15);
    game = setFirst(game, 'b');
    game.players = { a: ['Neil', 'Psi'], b: ['Iota', 'Zeta'] };
    game.mode = 'doubles';

    expect(scoreboardPayload(game)).toEqual({
      a: 0,
      b: 0,
      round: 0,
      target: 15,
      teamA: 'Neil & Psi',
      teamB: 'Iota & Zeta',
      colorA: '#2f80ed',
      colorB: '#eb5757',
      winner: null,
    });
  });

  it('reports the winner once the target is reached', () => {
    let game = newGame(3);
    game = throwAll(game, 'a', ['hole', 'floor', 'floor', 'floor']);
    game = throwAll(game, 'b', ['floor', 'floor', 'floor', 'floor']);
    game = endRound(game);

    expect(scoreboardPayload(game)).toMatchObject({ a: 3, winner: 'a' });
  });

  it('is stable for unchanged state, so nothing is republished', () => {
    const game = newGame();
    expect(JSON.stringify(scoreboardPayload(game))).toBe(
      JSON.stringify(scoreboardPayload(game)),
    );
  });
});

describe('game codes and topics', () => {
  it('strips anything that would break a topic', () => {
    expect(normalizeCode(' K3/pq M#1 ')).toBe('k3pqm1');
  });

  it('caps the length', () => {
    expect(normalizeCode('a'.repeat(40))).toHaveLength(16);
  });

  it('tolerates missing values', () => {
    expect(normalizeCode(undefined)).toBe('');
    expect(normalizeCode(null)).toBe('');
  });

  it('namespaces state and presence under the code', () => {
    expect(stateTopic('K3pqm')).toBe('holecorn/k3pqm/state');
    expect(onlineTopic('K3pqm')).toBe('holecorn/k3pqm/online');
  });
});

describe('configComplete', () => {
  const base = { broker: 'wss://broker:8884/mqtt', code: 'k3pqm' };

  it('needs a broker and a code', () => {
    expect(configComplete(base)).toBe(true);
    expect(configComplete({ ...base, broker: '   ' })).toBe(false);
    expect(configComplete({ ...base, code: '' })).toBe(false);
    expect(configComplete({ ...base, code: '///' })).toBe(false);
    expect(configComplete(undefined)).toBe(false);
  });
});

describe('segmentDigits', () => {
  it('blank-pads rather than zero-pads', () => {
    expect(segmentDigits(0)).toEqual([' ', '0']);
    expect(segmentDigits(7)).toEqual([' ', '7']);
    expect(segmentDigits(21)).toEqual(['2', '1']);
  });

  it('clamps to what the digits can show', () => {
    expect(segmentDigits(100)).toEqual(['9', '9']);
    expect(segmentDigits(-5)).toEqual([' ', '0']);
    expect(segmentDigits(120, 3)).toEqual(['1', '2', '0']);
  });

  it('falls back to zero for junk from the wire', () => {
    expect(segmentDigits(undefined)).toEqual([' ', '0']);
    expect(segmentDigits('nope')).toEqual([' ', '0']);
  });
});

describe('display link', () => {
  const config = {
    broker: 'wss://abc.hivemq.cloud:8884/mqtt',
    username: 'board',
    password: 'sekrit',
    code: 'k3pqm',
    enabled: true,
  };

  it('round-trips through configFromSearch', () => {
    const url = new URL(displayUrl('https://holecorn.com', config));
    expect(url.searchParams.get('display')).toBe('1');
    expect(configFromSearch(url.search)).toEqual({
      broker: config.broker,
      username: config.username,
      password: config.password,
      code: config.code,
    });
  });

  it('omits credentials that were never set', () => {
    const url = new URL(
      displayUrl('https://holecorn.com', { ...config, username: '', password: '' }),
    );
    expect(url.searchParams.has('user')).toBe(false);
    expect(url.searchParams.has('pass')).toBe(false);
  });

  it('ignores params the link did not carry', () => {
    expect(configFromSearch('?display=1&code=abc')).toEqual({ code: 'abc' });
  });
});

describe('acceptsUpdate', () => {
  const at = (v) => ({ a: 3, b: 1, v });

  it('rejects anything a board could not render', () => {
    expect(acceptsUpdate(null, 0)).toBe(false);
    expect(acceptsUpdate(5, 0)).toBe(false);
    expect(acceptsUpdate('nope', 0)).toBe(false);
    expect(acceptsUpdate({ a: 1 }, 0)).toBe(false);
    expect(acceptsUpdate({ a: 1, b: 'x' }, 0)).toBe(false);
  });

  it('accepts an equal or newer stamp', () => {
    expect(acceptsUpdate(at(1000), 1000)).toBe(true);
    expect(acceptsUpdate(at(2000), 1000)).toBe(true);
  });

  it('rejects a slightly older stamp — a delayed retry', () => {
    expect(acceptsUpdate(at(59_000), 60_000)).toBe(false);
  });

  it('accepts a far older stamp, which means a new clock, not a retry', () => {
    // The regression: rejecting every older stamp let one publish from a device
    // with a fast clock pin a future value into the retained message and freeze
    // every display until wall-clock caught up.
    expect(acceptsUpdate(at(1000), 1000 + REORDER_WINDOW)).toBe(true);
    expect(acceptsUpdate(at(1000), Date.now() + 86_400_000)).toBe(true);
  });

  it('accepts a message with no stamp at all', () => {
    expect(acceptsUpdate({ a: 3, b: 1 }, 99_999)).toBe(true);
  });
});
