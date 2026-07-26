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
const PAYLOAD = { a: 3, b: 1 };

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
