import { describe, it, expect } from 'vitest';
import { newGame, setBag, endRound, setFirst, undoRound } from './scoring.js';
import {
  LAYOUT_LABELS,
  REORDER_WINDOW,
  acceptsUpdate,
  configComplete,
  configFromSearch,
  displayUrl,
  layoutTopic,
  lineupPayload,
  lineupTopic,
  loadScoreboardConfig,
  normalizeCode,
  normalizeLayout,
  onlineTopic,
  scoreboardPayload,
  segmentDigits,
  stateTopic,
  usableLineup,
} from './scoreboard.js';
import { matchRecord } from './archive.js';
import { PANEL_LAYOUTS } from './panelRender.js';

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
      first: 'b',
      teamA: 'Neil & Psi',
      teamB: 'Iota & Zeta',
      colorA: '#2f80ed',
      colorB: '#eb5757',
    });
  });

  // The board and the display only ever receive labels, so a casual game needs no
  // payload field, no new topic and no firmware change to show the colours.
  it('sends the colours as the team labels in a casual game', () => {
    const game = {
      ...newGame(21),
      casual: true,
      mode: 'doubles',
      players: { a: ['Neil', 'Psi'], b: ['Iota', 'Zeta'] },
    };

    expect(scoreboardPayload(game)).toEqual({
      a: 0,
      b: 0,
      round: 0,
      target: 21,
      first: 'a',
      teamA: 'Blue',
      teamB: 'Red',
      colorA: '#2f80ed',
      colorB: '#eb5757',
    });
  });

  // Absent, not null: both consumers already read a missing key as "nobody has
  // won", and the payload sits on a measured byte budget.
  it('leaves the winner out while the game is live', () => {
    const game = newGame(15);
    expect('winner' in scoreboardPayload(game)).toBe(false);
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

describe('panel layout', () => {
  it('has its own retained topic, not a field in the score payload', () => {
    expect(layoutTopic('K3PQM')).toBe('holecorn/k3pqm/layout');
    expect(layoutTopic(' k3 pqm ')).toBe(layoutTopic('k3pqm'));
    // The byte budget is why: a field here would cost every score message.
    expect(scoreboardPayload(newGame())).not.toHaveProperty('layout');
  });

  it('falls back to the first layout for anything unrecognised', () => {
    for (const id of PANEL_LAYOUTS) expect(normalizeLayout(id)).toBe(id);
    for (const bad of ['ticker', '', null, undefined, 0, {}]) {
      expect(normalizeLayout(bad)).toBe(PANEL_LAYOUTS[0]);
    }
  });

  it('defaults a stored config with no layout to the first one', () => {
    expect(normalizeLayout(loadScoreboardConfig('display').layout)).toBe(PANEL_LAYOUTS[0]);
  });

  it('labels every layout, so the UI cannot show a bare id', () => {
    for (const id of PANEL_LAYOUTS) expect(LAYOUT_LABELS[id]).toBeTruthy();
  });
});

describe('the pre-game lineup', () => {
  // Built by playing the rounds, like stats.test.js, so a rules change surfaces
  // here rather than agreeing with a stale blob.
  const won = (a, b, id, endedAt) => {
    let game = { ...newGame(21), id, startedAt: 1, players: { a: [a, 'P2'], b: [b, 'P2'] } };
    for (let r = 0; r < 2; r++) {
      game = endRound(
        throwAll(throwAll(game, 'a', Array(4).fill('hole')), 'b', Array(4).fill('floor')),
      );
    }
    return matchRecord(game, endedAt);
  };
  const archive = [won('Neil', 'Sigma', 'm1', 1)];
  const setup = () => ({ ...newGame(21), players: { a: ['Neil', 'P2'], b: ['Sigma', 'P2'] } });

  it('has its own retained topic, not a field in the score payload', () => {
    expect(lineupTopic('K3PQM')).toBe('holecorn/k3pqm/lineup');
    expect(lineupTopic(' k3 pqm ')).toBe(lineupTopic('k3pqm'));
    expect(scoreboardPayload(newGame())).not.toHaveProperty('rows');
  });

  it('carries per-player rows in lane order and nothing else', () => {
    // toEqual, not toMatchObject: the board's buffer is the reason this topic
    // exists, so a field nothing renders has to fail here rather than ship.
    expect(lineupPayload(setup(), archive)).toEqual({
      rows: [
        { n: 'Neil', w: 1, l: 0, p: 120, f: 'W' },
        { n: 'Sigma', w: 0, l: 1, p: 0, f: 'L' },
      ],
    });
  });

  // Colours are already on the score topic and two copies could disagree; the
  // layout is a separate fact again.
  it('repeats neither the colours nor the layout', () => {
    const [row] = lineupPayload(setup(), archive).rows;
    expect(Object.keys(row).sort()).toEqual(['f', 'l', 'n', 'p', 'w']);
    expect(lineupPayload(setup(), archive)).not.toHaveProperty('layout');
  });

  // Checked explicitly rather than left to the `played` test: the slots still hold
  // whatever names were last typed, and those have history the guests don't.
  it('is null for a casual game whose slots have been played under', () => {
    const guests = { ...setup(), casual: true };
    expect(lineupPayload(setup(), archive)).not.toBeNull();
    expect(lineupPayload(guests, archive)).toBeNull();
  });

  // Null is the instruction to clear the retained message, which is the only way
  // the board leaves the form screen.
  it('is null once a bag has been thrown', () => {
    const started = throwAll(setup(), 'a', ['hole', 'unthrown', 'unthrown', 'unthrown']);
    expect(lineupPayload(started, archive)).toBeNull();
  });

  it('is null once a round has been committed', () => {
    let game = setup();
    game = endRound(throwAll(throwAll(game, 'a', Array(4).fill('floor')), 'b', Array(4).fill('floor')));
    expect(lineupPayload(game, archive)).toBeNull();
  });

  // Undoing the only round does *not* bring the form screen back, because
  // undoRound restores that round's bags to the lanes and a thrown bag can never
  // return to unthrown. Only New game does, which is the right answer: you undo to
  // correct a round, not to go back to standing around.
  it('stays cleared after the only round is undone', () => {
    let game = setup();
    game = endRound(throwAll(throwAll(game, 'a', Array(4).fill('floor')), 'b', Array(4).fill('floor')));
    const undone = undoRound(game);
    expect(undone.rounds).toHaveLength(0);
    expect(lineupPayload(undone, archive)).toBeNull();
    // New game is the route back.
    expect(lineupPayload({ ...newGame(21), players: game.players }, archive)).not.toBeNull();
  });

  it('is null when nobody in the roster has played before', () => {
    expect(lineupPayload(setup(), [])).toBeNull();
    const strangers = { ...setup(), players: { a: ['Psi', 'P2'], b: ['Eta', 'P2'] } };
    expect(lineupPayload(strangers, archive)).toBeNull();
  });

  // No `p` at all for a newcomer: absent means "no rate", which is what keeps a
  // genuine 0.0 average drawable on both consumers.
  it('still publishes when only one of them has played', () => {
    const mixed = { ...setup(), players: { a: ['Neil', 'P2'], b: ['Psi', 'P2'] } };
    expect(lineupPayload(mixed, archive).rows[1]).toEqual({ n: 'Psi', w: 0, l: 0, f: '' });
  });

  // A career made only of imported results — a written-down score with no rounds
  // behind it — has a record and no rate. Sending 0 would put "0.0" on the board
  // for somebody who has played a dozen games.
  it('omits the rate for a record with no rounds behind it', () => {
    const legacy = [
      {
        id: 'old-1',
        endedAt: 1,
        mode: 'singles',
        players: { a: ['Phi', 'P2'], b: ['Neil', 'P4'] },
        winner: 'a',
        final: { a: 21, b: 13 },
        rounds: [],
      },
    ];
    const game = { ...setup(), players: { a: ['Phi', 'P2'], b: ['Neil', 'P4'] } };
    const rows = lineupPayload(game, [...archive, ...legacy]).rows;
    expect(rows[0]).toEqual({ n: 'Phi', w: 1, l: 0, f: 'W' });
    // The opponent has real rounds elsewhere in the archive, so theirs survives.
    expect(rows[1].p).toBeGreaterThan(0);
  });

  it('sends four rows in doubles, team A first', () => {
    const doubles = {
      ...setup(),
      mode: 'doubles',
      players: { a: ['Neil', 'Rho'], b: ['Sigma', 'Tau'] },
    };
    const rows = lineupPayload(doubles, archive).rows;
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.n)).toEqual(['Neil', 'Rho', 'Sigma', 'Tau']);
  });

  // PPR travels as tenths so the firmware needs no float formatter. Four bags in
  // the hole every round is 12.0, which is the widest it can be.
  it('sends PPR as tenths, and the maximum needs four characters', () => {
    const [neil] = lineupPayload(setup(), archive).rows;
    expect(neil.p).toBe(120);
    expect((neil.p / 10).toFixed(1)).toBe('12.0');
  });

  // The cap that moved. At 99 the board drew "99" while the stats screen and the phone's
  // own Form panel showed the true figure — wrong rather than truncated, and reachable at
  // about 100 matches in either column. Both consumers size the record column to what
  // arrives, so three digits cost nothing until someone earns them.
  it('publishes a record past 99 rather than clamping it to 99', () => {
    const many = Array.from({ length: 120 }, (_, i) => won('Neil', 'Sigma', `m${i}`, i + 1));
    const rows = lineupPayload(setup(), many).rows;
    expect(rows[0].w).toBe(120);
    expect(rows[1].l).toBe(120);
    // Still bounded, because formatRecord writes into a fixed buffer.
    expect(lineupPayload(setup(), many).rows.every((r) => r.w <= 999 && r.l <= 999)).toBe(true);
  });

  it('caps the form string at what the panel draws', () => {
    const many = Array.from({ length: 8 }, (_, i) => won('Neil', 'Sigma', `m${i}`, i + 1));
    const [neil] = lineupPayload(setup(), many).rows;
    expect(neil.f).toBe('WWWWW');
  });

  describe('usableLineup', () => {
    it('accepts a singles and a doubles roster', () => {
      expect(usableLineup({ rows: [{}, {}] })).toBe(true);
      expect(usableLineup({ rows: [{}, {}, {}, {}] })).toBe(true);
    });

    // The board splits rows into teams by halving the count, so a length it
    // cannot halve would put somebody in the wrong colour rather than fail.
    it('refuses a count that cannot be split into two sides', () => {
      for (const rows of [[], [{}], [{}, {}, {}], [{}, {}, {}, {}, {}]]) {
        expect(usableLineup({ rows })).toBe(false);
      }
    });

    it('refuses anything that is not a roster', () => {
      for (const bad of [null, undefined, 'rows', 3, {}, { rows: 'two' }]) {
        expect(usableLineup(bad)).toBe(false);
      }
    });
  });
});
