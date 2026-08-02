import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openScoreboardLink } from './scoreboardLink.js';

// Every case here is a failure path a real broker won't reproduce on demand: a
// lost acknowledgement, a refused subscription, a half-open socket. They are the
// regressions for defects that reached main once.

function fakeBroker() {
  const handlers = {};
  const published = [];
  let subscribeCb = null;

  const client = {
    connected: false,
    ended: false,
    on(event, cb) {
      (handlers[event] ??= []).push(cb);
    },
    publish(topic, payload, opts, cb) {
      published.push({ topic, payload, opts, ack: cb ?? null });
    },
    subscribe(topics, opts, cb) {
      client.subscribed = topics;
      subscribeCb = cb ?? null;
    },
    end(force) {
      client.ended = true;
      client.endForced = force;
    },
  };

  return {
    client,
    published,
    connect: () => client,
    fire(event, ...args) {
      (handlers[event] ?? []).forEach((h) => h(...args));
    },
    goOnline() {
      client.connected = true;
      this.fire('connect');
    },
    ackSubscribe(granted) {
      subscribeCb?.(null, granted);
    },
    of(topic) {
      return published.filter((p) => p.topic === topic);
    },
  };
}

const CONFIG = { broker: 'wss://example:8884/mqtt', username: '', password: '', code: 'abc12' };
const STATE = 'holecorn/abc12/state';
const ONLINE = 'holecorn/abc12/online';
const LAYOUT = 'holecorn/abc12/layout';
const LINEUP = 'holecorn/abc12/lineup';
const TIE = 'holecorn/abc12/tie';
const PAYLOAD = { a: 3, b: 1 };
const ROSTER = { rows: [{ n: 'Neil', w: 6, l: 4, p: 72, f: 'LWLWW' }, { n: 'Sigma', w: 4, l: 6, p: 60, f: 'WLWLL' }] };

let broker;
const open = (role, opts = {}) =>
  openScoreboardLink({
    config: CONFIG,
    role,
    onStatus: opts.onStatus ?? (() => {}),
    onMessage: opts.onMessage ?? (() => {}),
    connect: broker.connect,
  });

beforeEach(() => {
  vi.useFakeTimers();
  broker = fakeBroker();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('publisher presence', () => {
  it('announces online on connect and keeps re-asserting it', async () => {
    await open('publisher');
    broker.goOnline();
    expect(broker.of(ONLINE).map((p) => p.payload)).toEqual(['1']);

    vi.advanceTimersByTime(30_000);
    vi.advanceTimersByTime(30_000);
    // Re-asserted, because a will left by a half-open session can fire long
    // after a replacement link has already said it is online.
    expect(broker.of(ONLINE).map((p) => p.payload)).toEqual(['1', '1', '1']);
  });

  it('publishes online retained, so a display joining later still sees it', async () => {
    await open('publisher');
    broker.goOnline();
    expect(broker.of(ONLINE)[0].opts).toMatchObject({ retain: true, qos: 1 });
  });

  it('stops re-asserting once closed', async () => {
    const link = await open('publisher');
    broker.goOnline();
    link.close();
    const after = broker.of(ONLINE).length;
    vi.advanceTimersByTime(120_000);
    expect(broker.of(ONLINE)).toHaveLength(after);
  });
});

describe('publisher shutdown', () => {
  it('says goodbye and ends the client', async () => {
    const link = await open('publisher');
    broker.goOnline();
    link.close();

    expect(broker.of(ONLINE).at(-1).payload).toBe('0');
    broker.of(ONLINE).at(-1).ack();
    expect(broker.client.ended).toBe(true);
  });

  it('ends the client even if the goodbye is never acknowledged', async () => {
    // The regression that matters: `connected` stays true on a half-open socket
    // and mqtt.js will not error a pending callback while set to reconnect. A
    // client left alive here reconnects and republishes its retained '0' after
    // the replacement link has said '1', dimming the board for the whole game.
    const link = await open('publisher');
    broker.goOnline();
    link.close();

    expect(broker.client.ended).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(broker.client.ended).toBe(true);
  });

  it('does not end twice when a late acknowledgement arrives', async () => {
    const link = await open('publisher');
    broker.goOnline();
    link.close();
    vi.advanceTimersByTime(1000);
    broker.client.ended = false;
    broker.of(ONLINE).at(-1).ack();
    expect(broker.client.ended).toBe(false);
  });

  it('ends immediately when it never connected', async () => {
    const link = await open('publisher');
    link.close();
    expect(broker.client.ended).toBe(true);
  });
});

describe('publishing state', () => {
  it('holds the latest payload and sends it once connected', async () => {
    const link = await open('publisher');
    link.send(PAYLOAD);
    expect(broker.of(STATE)).toHaveLength(0);

    broker.goOnline();
    expect(JSON.parse(broker.of(STATE)[0].payload)).toMatchObject(PAYLOAD);
    expect(broker.of(STATE)[0].opts).toMatchObject({ retain: true, qos: 1 });
  });

  it('re-sends the latest state after a reconnect', async () => {
    const link = await open('publisher');
    broker.goOnline();
    link.send(PAYLOAD);
    broker.fire('close');
    broker.goOnline();

    const sent = broker.of(STATE).map((p) => JSON.parse(p.payload).a);
    expect(sent).toEqual([3, 3]);
  });

  it('stamps each publish with a version', async () => {
    const link = await open('publisher');
    broker.goOnline();
    link.send(PAYLOAD);
    expect(Number.isFinite(JSON.parse(broker.of(STATE)[0].payload).v)).toBe(true);
  });

  it('ignores sends after close', async () => {
    const link = await open('publisher');
    broker.goOnline();
    link.close();
    link.send(PAYLOAD);
    expect(broker.of(STATE)).toHaveLength(0);
  });
});

describe('display subscription', () => {
  it('surfaces a refused subscription instead of sitting on "connected"', async () => {
    // A broker with per-topic permissions refuses the subscribe, not the
    // connect, which would otherwise leave the board green and silent forever.
    const statuses = [];
    await open('display', { onStatus: (s, m) => statuses.push([s, m]) });
    broker.goOnline();
    broker.ackSubscribe([{ topic: STATE, qos: 128 }]);

    expect(statuses.at(-1)[0]).toBe('error');
    expect(statuses.at(-1)[1]).toMatch(/permission/i);
  });

  it('stays quiet when the subscription is granted', async () => {
    const statuses = [];
    await open('display', { onStatus: (s) => statuses.push(s) });
    broker.goOnline();
    broker.ackSubscribe([{ topic: STATE, qos: 1 }, { topic: ONLINE, qos: 1 }]);
    expect(statuses).not.toContain('error');
  });

  it('routes state and presence to the right handler', async () => {
    const seen = [];
    await open('display', { onMessage: (m) => seen.push(m) });
    broker.goOnline();

    broker.fire('message', STATE, Buffer.from(JSON.stringify(PAYLOAD)));
    broker.fire('message', ONLINE, Buffer.from('1'));
    broker.fire('message', ONLINE, Buffer.from('0'));

    expect(seen).toEqual([
      { payload: PAYLOAD },
      { senderOnline: true },
      { senderOnline: false },
    ]);
  });

  it('drops unparseable messages rather than throwing', async () => {
    const seen = [];
    await open('display', { onMessage: (m) => seen.push(m) });
    broker.goOnline();
    broker.fire('message', STATE, Buffer.from('not json'));
    expect(seen).toEqual([]);
  });

  it('never sets a will — only the publisher owns presence', async () => {
    let opts;
    broker.connect = (_url, o) => {
      opts = o;
      return broker.client;
    };
    await open('display');
    expect(opts.will).toBeUndefined();
  });
});

describe('panel layout', () => {
  it('publishes the layout retained on its own topic, not in the state payload', async () => {
    const link = await open('publisher');
    broker.goOnline();
    link.sendLayout('score');
    const [msg] = broker.of(LAYOUT);
    expect(msg.payload).toBe('score');
    // Retained is what lets a board that boots later pick the choice up without
    // the phone having to republish.
    expect(msg.opts).toMatchObject({ retain: true, qos: 1 });
    // And it must not have ridden along in the score, whose budget is why it has
    // a topic of its own.
    expect(broker.of(STATE)).toHaveLength(0);
  });

  it('holds a layout chosen before the link opened, and re-asserts it on reconnect', async () => {
    const link = await open('publisher');
    link.sendLayout('score');
    expect(broker.of(LAYOUT)).toHaveLength(0);

    broker.goOnline();
    expect(broker.of(LAYOUT).map((m) => m.payload)).toEqual(['score']);

    // A reconnect may find a retained value on the broker from an older session,
    // so the current choice is re-asserted rather than assumed to have survived.
    broker.client.connected = false;
    broker.fire('close');
    broker.goOnline();
    expect(broker.of(LAYOUT).map((m) => m.payload)).toEqual(['score', 'score']);
  });

  it('ignores a layout send after close', async () => {
    const link = await open('publisher');
    broker.goOnline();
    link.close();
    link.sendLayout('score');
    expect(broker.of(LAYOUT)).toHaveLength(0);
  });

  it('subscribes a display to the layout and lineup alongside state and presence', async () => {
    await open('display');
    broker.goOnline();
    expect(broker.client.subscribed).toEqual([STATE, ONLINE, LAYOUT, LINEUP, TIE]);
  });

  it('routes a layout message to its own handler, not the state parser', async () => {
    const seen = [];
    await open('display', { onMessage: (m) => seen.push(m) });
    broker.goOnline();
    broker.fire('message', LAYOUT, Buffer.from('score'));
    broker.fire('message', LAYOUT, Buffer.from('ticker'));
    expect(seen).toEqual([{ layout: 'score' }, { layout: 'ticker' }]);
  });
});

describe('the pre-game lineup', () => {
  it('publishes the roster retained on its own topic', async () => {
    const link = await open('publisher');
    broker.goOnline();
    link.sendLineup(ROSTER);

    const [msg] = broker.of(LINEUP);
    expect(JSON.parse(msg.payload)).toEqual(ROSTER);
    expect(msg.opts).toMatchObject({ retain: true, qos: 1 });
    // Its whole reason for existing: the score payload's budget is already 74%
    // spent in the worst case, so none of this may ride along with it.
    expect(broker.of(STATE)).toHaveLength(0);
  });

  // An empty retained payload is what deletes the retained message on the broker,
  // and it is the only route back to the score screen — so a null has to publish
  // rather than be skipped as "nothing to send".
  it('clears the topic with an empty payload rather than skipping the publish', async () => {
    const link = await open('publisher');
    broker.goOnline();
    link.sendLineup(ROSTER);
    link.sendLineup(null);

    expect(broker.of(LINEUP).map((m) => m.payload)).toEqual([JSON.stringify(ROSTER), '']);
    expect(broker.of(LINEUP)[1].opts).toMatchObject({ retain: true, qos: 1 });
  });

  // The dangerous case: a session that has already moved past setup reconnects and
  // finds a retained roster on the broker from an earlier one. Without re-asserting
  // the clear, the board sits on a form screen for the whole game.
  it('re-asserts a cleared lineup on reconnect, not just a set one', async () => {
    const link = await open('publisher');
    broker.goOnline();
    link.sendLineup(null);
    expect(broker.of(LINEUP).map((m) => m.payload)).toEqual(['']);

    broker.client.connected = false;
    broker.fire('close');
    broker.goOnline();
    expect(broker.of(LINEUP).map((m) => m.payload)).toEqual(['', '']);
  });

  it('says nothing on connect before the publisher has computed one', async () => {
    await open('publisher');
    broker.goOnline();
    expect(broker.of(LINEUP)).toHaveLength(0);
  });

  it('holds a roster sent before the link opened', async () => {
    const link = await open('publisher');
    link.sendLineup(ROSTER);
    expect(broker.of(LINEUP)).toHaveLength(0);
    broker.goOnline();
    expect(broker.of(LINEUP)).toHaveLength(1);
  });

  it('ignores a lineup send after close', async () => {
    const link = await open('publisher');
    broker.goOnline();
    link.close();
    link.sendLineup(ROSTER);
    expect(broker.of(LINEUP)).toHaveLength(0);
  });

  it('reports a cleared topic as null so the display goes back to the score', async () => {
    const seen = [];
    await open('display', { onMessage: (m) => seen.push(m) });
    broker.goOnline();
    broker.fire('message', LINEUP, Buffer.from(JSON.stringify(ROSTER)));
    broker.fire('message', LINEUP, Buffer.from(''));
    expect(seen).toEqual([{ lineup: ROSTER }, { lineup: null }]);
  });

  // Anything could be on a shared broker's topic. Malformed JSON must leave what
  // is on screen rather than being reported as a clear, which would blank the
  // form screen mid-setup.
  it('drops an unparseable lineup instead of reporting it as cleared', async () => {
    const seen = [];
    await open('display', { onMessage: (m) => seen.push(m) });
    broker.goOnline();
    broker.fire('message', LINEUP, Buffer.from('{not json'));
    expect(seen).toEqual([]);
  });
});

describe('the tournament tie', () => {
  const TIE_MSG = { t: 'Hole Corn V', r: 'Semi-final' };

  it('publishes the tie retained on its own topic', async () => {
    const link = await open('publisher');
    broker.goOnline();
    link.sendTie(TIE_MSG);

    const [msg] = broker.of(TIE);
    expect(JSON.parse(msg.payload)).toEqual(TIE_MSG);
    expect(msg.opts).toMatchObject({ retain: true, qos: 1 });
    // Neither of the other two topics carries it: the score payload has no room
    // and the lineup packet is already the largest the board receives.
    expect(broker.of(STATE)).toHaveLength(0);
    expect(broker.of(LINEUP)).toHaveLength(0);
  });

  // The same trap the lineup has, and worse: a tie retained from a cup that
  // finished weeks ago would leave a board naming a fixture nobody is playing.
  it('re-asserts a cleared tie on reconnect, not just a set one', async () => {
    const link = await open('publisher');
    broker.goOnline();
    link.sendTie(null);
    expect(broker.of(TIE).map((m) => m.payload)).toEqual(['']);

    broker.client.connected = false;
    broker.fire('close');
    broker.goOnline();
    expect(broker.of(TIE).map((m) => m.payload)).toEqual(['', '']);
  });

  it('says nothing on connect before the publisher has computed one', async () => {
    await open('publisher');
    broker.goOnline();
    expect(broker.of(TIE)).toHaveLength(0);
  });

  it('holds a tie sent before the link opened', async () => {
    const link = await open('publisher');
    link.sendTie(TIE_MSG);
    expect(broker.of(TIE)).toHaveLength(0);
    broker.goOnline();
    expect(broker.of(TIE)).toHaveLength(1);
  });

  it('ignores a tie send after close', async () => {
    const link = await open('publisher');
    broker.goOnline();
    link.close();
    link.sendTie(TIE_MSG);
    expect(broker.of(TIE)).toHaveLength(0);
  });

  it('reports a cleared topic as null so the display goes back to the score', async () => {
    const seen = [];
    await open('display', { onMessage: (m) => seen.push(m) });
    broker.goOnline();
    broker.fire('message', TIE, Buffer.from(JSON.stringify(TIE_MSG)));
    broker.fire('message', TIE, Buffer.from(''));
    expect(seen).toEqual([{ tie: TIE_MSG }, { tie: null }]);
  });

  it('drops an unparseable tie instead of reporting it as cleared', async () => {
    const seen = [];
    await open('display', { onMessage: (m) => seen.push(m) });
    broker.goOnline();
    broker.fire('message', TIE, Buffer.from('{not json'));
    expect(seen).toEqual([]);
  });
});
