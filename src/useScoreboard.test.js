// @vitest-environment happy-dom
//
// The React glue between the game and the transport — the one file in this
// subsystem with no test and no CI coverage of any kind. Every browser check in
// `npm run test:browser` runs with the scoreboard **off**, and the two that
// drive a real publisher (`verify-form-screen.mjs`, `verify-winner-flash.mjs`)
// are deliberately outside that set because they need a third party. So the five
// debounce timers, the JSON dedupe, the five `pending*Ref` replays and the
// `{ value }` wrapper were all unexecuted, on the path that decides what a board
// shows for a whole game.
//
// The transport is mocked rather than faked at the socket, because
// `scoreboardLink.test.js` already drives the real one with a fake MQTT client.
// What is left here is exactly what that file cannot see: *when* this hook calls
// it, and with what.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { endRound, newGame, setBag } from './scoring.js';
import { matchRecord } from './archive.js';
import { PANEL_LAYOUTS } from './panelRender.js';
import { openScoreboardLink } from './scoreboardLink.js';
import { useScoreboardDisplay, useScoreboardPublisher } from './useScoreboard.js';

vi.mock('./scoreboardLink.js', () => ({ openScoreboardLink: vi.fn() }));

// Longer than PUBLISH_DEBOUNCE, so "settled" is unambiguous without importing a
// constant the test would then be asserting against itself.
const SETTLED = 500;

const CONFIG = {
  enabled: true,
  broker: 'wss://broker.example/mqtt',
  code: 'k3pqm',
  layout: 'full',
};

function handle() {
  return {
    send: vi.fn(),
    sendLayout: vi.fn(),
    sendLineup: vi.fn(),
    sendTie: vi.fn(),
    sendDraw: vi.fn(),
    close: vi.fn(),
  };
}

// The link opens on a promise the test resolves by hand, which is the only way
// to reach the replay paths: everything the hook computes before that resolves
// has nowhere to go but a pending ref.
function deferredLink() {
  const link = handle();
  let open;
  const opened = new Promise((resolve) => {
    open = () => resolve(link);
  });
  let listener = null;
  openScoreboardLink.mockImplementation(({ onMessage }) => {
    listener = onMessage;
    return opened;
  });
  return { link, open: () => act(() => (open(), opened)), deliver: (msg) => act(() => listener(msg)) };
}

const setup = (over = {}) => ({
  ...newGame(21),
  players: { a: ['Neil', 'P2'], b: ['Sigma', 'P2'] },
  ...over,
});

// One bag thrown, which is what `gameStarted` turns on — and so what clears both
// the form screen and the fixture card.
const started = () => setBag(setup(), 'a', 0, 'hole');

// Played through the real scoring functions, the way every other fixture in this
// project is, so the lineup payload is a real one.
function won(id, endedAt) {
  let game = { ...setup(), id, startedAt: 1 };
  for (let r = 0; r < 2; r += 1) {
    let next = game;
    for (let i = 0; i < 4; i += 1) next = setBag(next, 'a', i, 'hole');
    for (let i = 0; i < 4; i += 1) next = setBag(next, 'b', i, 'floor');
    game = endRound(next);
  }
  return matchRecord(game, endedAt);
}

const ARCHIVE = [won('m1', 1000)];

// `config` is defaulted inside the callback rather than in the initial props,
// because `rerender` replaces the props wholesale and most of these only vary
// the game.
const publisher = (props) =>
  renderHook(
    ({ game, matches, tie, reveal, config = CONFIG }) =>
      useScoreboardPublisher(game, config, matches, tie, reveal),
    { initialProps: { game: setup(), matches: [], tie: null, reveal: null, ...props } },
  );

beforeEach(() => {
  vi.useFakeTimers();
  openScoreboardLink.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useScoreboardPublisher — the score', () => {
  it('waits for the debounce rather than publishing on the render that changed it', async () => {
    const { link, open } = deferredLink();
    const view = publisher();
    await open();
    link.send.mockClear();

    view.rerender({ game: started(), matches: [], tie: null, reveal: null });
    expect(link.send).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(SETTLED));
    expect(link.send).toHaveBeenCalledTimes(1);
  });

  // Renames fire per keystroke, which is the whole reason the debounce is here.
  it('coalesces a burst of changes into one publish of the last one', async () => {
    const { link, open } = deferredLink();
    const view = publisher();
    await open();
    link.send.mockClear();

    for (const name of ['N', 'Ne', 'Nei']) {
      view.rerender({
        game: setup({ players: { a: [name, 'P2'], b: ['Sigma', 'P2'] } }),
        matches: [],
        tie: null,
        reveal: null,
      });
    }
    await act(async () => vi.advanceTimersByTime(SETTLED));
    expect(link.send).toHaveBeenCalledTimes(1);
    expect(link.send.mock.calls[0][0]).toMatchObject({ teamA: 'Nei' });
  });

  // The payload is rebuilt on every render, so identity says nothing — without
  // the JSON compare the board would be handed the same retained bytes over and
  // over for the whole game.
  it('does not republish a payload that only looks new', async () => {
    const { link, open } = deferredLink();
    const view = publisher();
    await open();
    await act(async () => vi.advanceTimersByTime(SETTLED));
    link.send.mockClear();

    view.rerender({ game: setup(), matches: [], tie: null, reveal: null });
    await act(async () => vi.advanceTimersByTime(SETTLED));
    expect(link.send).not.toHaveBeenCalled();
  });

  it('sends what the game had become while the link was still opening', async () => {
    const { link, open } = deferredLink();
    const view = publisher();
    view.rerender({
      game: setup({ players: { a: ['Rho', 'P2'], b: ['Sigma', 'P2'] } }),
      matches: [],
      tie: null,
      reveal: null,
    });
    await act(async () => vi.advanceTimersByTime(SETTLED));
    expect(link.send).not.toHaveBeenCalled();

    await open();
    expect(link.send).toHaveBeenCalledTimes(1);
    expect(link.send.mock.calls[0][0]).toMatchObject({ teamA: 'Rho' });
  });
});

describe('useScoreboardPublisher — the topics that clear', () => {
  const props = (over) => ({ game: setup(), matches: ARCHIVE, tie: null, reveal: null, ...over });

  it('publishes the roster before the first bag and clears it after', async () => {
    const { link, open } = deferredLink();
    const view = publisher(props());
    await open();
    await act(async () => vi.advanceTimersByTime(SETTLED));
    expect(link.sendLineup.mock.calls[0][0]).toMatchObject({
      rows: [{ n: 'Neil' }, { n: 'Sigma' }],
    });
    link.sendLineup.mockClear();

    view.rerender(props({ game: started() }));
    await act(async () => vi.advanceTimersByTime(SETTLED));
    expect(link.sendLineup).toHaveBeenCalledTimes(1);
    expect(link.sendLineup.mock.calls[0][0]).toBeNull();
  });

  // **The `{ value }` wrapper, which is the whole reason those two refs don't
  // hold the payload.** A computed null is an instruction — clear the retained
  // topic — and a ref holding the payload itself cannot tell it from "nothing
  // pending yet", so the replay is skipped and a board that reconnects mid-game
  // sits on the form screen while the score moves underneath it.
  it('replays a cleared roster, because a computed null is an instruction', async () => {
    const { link, open } = deferredLink();
    const view = publisher(props());
    await act(async () => vi.advanceTimersByTime(SETTLED));
    view.rerender(props({ game: started() }));
    await act(async () => vi.advanceTimersByTime(SETTLED));

    await open();
    expect(link.sendLineup).toHaveBeenCalledTimes(1);
    expect(link.sendLineup.mock.calls[0][0]).toBeNull();
  });

  it('replays a cleared fixture card for the same reason', async () => {
    const { link, open } = deferredLink();
    const tie = { name: 'The Cup', round: 'Semi-final' };
    const view = publisher(props({ tie }));
    await act(async () => vi.advanceTimersByTime(SETTLED));
    view.rerender(props({ game: started(), tie }));
    await act(async () => vi.advanceTimersByTime(SETTLED));

    await open();
    expect(link.sendTie).toHaveBeenCalledTimes(1);
    expect(link.sendTie.mock.calls[0][0]).toBeNull();
  });

  // Both are rebuilt whenever `game` changes — which is on every bag — so the
  // JSON compare is what stops the same roster being retained over and over.
  it('does not republish a roster or a card that only looks new', async () => {
    const { link, open } = deferredLink();
    const tie = { name: 'The Cup', round: 'Final' };
    const view = publisher(props({ tie }));
    await open();
    await act(async () => vi.advanceTimersByTime(SETTLED));
    link.sendLineup.mockClear();
    link.sendTie.mockClear();

    view.rerender(props({ tie: { ...tie } }));
    await act(async () => vi.advanceTimersByTime(SETTLED));
    expect(link.sendLineup).not.toHaveBeenCalled();
    expect(link.sendTie).not.toHaveBeenCalled();
  });

  it('publishes the fixture card while the tie has not been started', async () => {
    const { link, open } = deferredLink();
    publisher(props({ tie: { name: 'The Cup', round: 'Final' } }));
    await open();
    await act(async () => vi.advanceTimersByTime(SETTLED));
    expect(link.sendTie).toHaveBeenCalledWith({ t: 'The Cup', r: 'Final' });
  });
});

describe('useScoreboardPublisher — what is deliberately not debounced', () => {
  // On the press and not 400ms later: the point of a separate topic is that the
  // choice lands without waiting for a round, and a wash publishes nothing at
  // all. Asserted on a change made *after* the link is open — the mount alone is
  // answered by the replay below, so it cannot see this at all.
  it('sends a layout change on the press, with nothing to wait for', async () => {
    const { link, open } = deferredLink();
    const view = publisher();
    await open();
    link.sendLayout.mockClear();

    view.rerender({
      game: setup(),
      matches: [],
      tie: null,
      reveal: null,
      config: { ...CONFIG, layout: 'score' },
    });
    expect(link.sendLayout).toHaveBeenCalledWith('score');
  });

  it('replays a layout chosen before the link was open', async () => {
    const { link, open } = deferredLink();
    publisher();
    expect(link.sendLayout).not.toHaveBeenCalled();
    await open();
    expect(link.sendLayout).toHaveBeenCalledWith(PANEL_LAYOUTS[0]);
  });

  // A press publishes two beats a moment apart — the drum roll and the reveal —
  // and half the theatre of a draw is the pause between them. Debounced, the
  // first would be swallowed and the pause with it.
  it('sends both beats of a pull, rather than settling into the second', async () => {
    const { link, open } = deferredLink();
    const step = { round: 'Round 1', side: { names: ['Rho'] }, opponents: [] };
    const view = publisher();
    await open();
    // The mount already cleared the topic, which is a publish of its own.
    link.sendDraw.mockClear();

    view.rerender({
      game: setup(),
      matches: [],
      tie: null,
      reveal: { step, cup: 'The Cup', drawn: 1, total: 4, pulling: true },
    });
    view.rerender({
      game: setup(),
      matches: [],
      tie: null,
      reveal: { step, cup: 'The Cup', drawn: 1, total: 4, pulling: false },
    });
    expect(link.sendDraw).toHaveBeenCalledTimes(2);
    expect(link.sendDraw.mock.calls[0][0]).not.toHaveProperty('n');
    expect(link.sendDraw.mock.calls[1][0]).toMatchObject({ n: 'Rho' });
  });

  // Undebounced is not unguarded: `reveal` is rebuilt on every render of the
  // screen holding it, so without the compare the same card is retained over and
  // over while nobody presses anything.
  it('does not republish a card that only looks new', async () => {
    const { link, open } = deferredLink();
    const reveal = { step: null, cup: 'The Cup', drawn: 0, total: 4 };
    const view = publisher({ reveal });
    await open();
    link.sendDraw.mockClear();

    view.rerender({ game: setup(), matches: [], tie: null, reveal: { ...reveal } });
    expect(link.sendDraw).not.toHaveBeenCalled();
  });

  it('replays a draw card opened before the link was, which is the usual order', async () => {
    const { link, open } = deferredLink();
    publisher({ reveal: { step: null, cup: 'The Cup', drawn: 0, total: 4 } });
    await open();
    expect(link.sendDraw).toHaveBeenCalledWith({ t: 'The Cup', d: 0, e: 4 });
  });
});

describe('useScoreboardDisplay', () => {
  const display = () => renderHook(() => useScoreboardDisplay(CONFIG));

  it('keeps what is on screen when the app names a layout this build has never heard of', async () => {
    const { open, deliver } = deferredLink();
    const view = display();
    await open();
    await deliver({ layout: 'score' });
    expect(view.result.current.layout).toBe('score');
    await deliver({ layout: 'kaleidoscope' });
    expect(view.result.current.layout).toBe('score');
  });

  it('treats a null on the lineup topic as the instruction to clear it', async () => {
    const { open, deliver } = deferredLink();
    const view = display();
    await open();
    const rows = [
      { n: 'Neil', w: 1, l: 0, f: 'W' },
      { n: 'Sigma', w: 0, l: 1, f: 'L' },
    ];
    await deliver({ lineup: { rows } });
    expect(view.result.current.lineup).toEqual({ rows });
    await deliver({ lineup: null });
    expect(view.result.current.lineup).toBeNull();
    // Unusable is not the same answer: it leaves what is up, mirroring parseLineup.
    await deliver({ lineup: { rows } });
    await deliver({ lineup: { rows: [{ n: 'Neil' }] } });
    expect(view.result.current.lineup).toEqual({ rows });
  });

  it('refuses a stale score but accepts one stamped by a slightly fast clock', async () => {
    const { open, deliver } = deferredLink();
    const view = display();
    await open();
    await deliver({ payload: { v: 1000, a: 5, b: 3 } });
    expect(view.result.current.payload).toMatchObject({ a: 5 });
    await deliver({ payload: { v: 100, a: 9, b: 9 } });
    expect(view.result.current.payload).toMatchObject({ a: 5 });
    await deliver({ payload: { v: 1001, a: 7, b: 3 } });
    expect(view.result.current.payload).toMatchObject({ a: 7 });
  });

  it('tracks the scorer going away separately from the score', async () => {
    const { open, deliver } = deferredLink();
    const view = display();
    await open();
    await deliver({ senderOnline: true });
    expect(view.result.current.senderOnline).toBe(true);
    await deliver({ senderOnline: false });
    expect(view.result.current.senderOnline).toBe(false);
    expect(view.result.current.payload).toBeNull();
  });
});
