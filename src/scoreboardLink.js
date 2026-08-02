// MQTT transport for the external scoreboard. No React in here.
//
// The app is served over HTTPS, which cannot reach a device on the local
// network (mixed content blocks http:// and ws:// to a LAN address), and iOS
// has no Web Bluetooth, Web Serial or WebUSB. So both ends meet at a broker
// instead: the browser over WSS, firmware over MQTT(S) on the same topic.
//
// That broker does not have to be a hosted one — it has to be reachable over
// WSS with a certificate the phone trusts, which a broker on the LAN can be.
// See docs/OFFLINE-SCOREBOARD.md before concluding this needs the internet.

import { layoutTopic, lineupTopic, onlineTopic, stateTopic, tieTopic } from './scoreboard.js';

const RECONNECT_PERIOD = 4000;
const CONNECT_TIMEOUT = 8000;
// How long to wait for the goodbye publish to be acknowledged before closing
// anyway. See close() for why this can never be left open-ended.
const GOODBYE_TIMEOUT = 1000;
// Presence is re-asserted rather than published once. A session whose socket
// went half-open leaves a will the broker won't fire until keepalive expires,
// by which time a replacement link has already said "online" — so the stale
// will arrives last and dims a perfectly live board. Re-publishing bounds that
// to one interval instead of the rest of the game.
const PRESENCE_INTERVAL = 30000;

async function loadConnect() {
  const mod = await import('mqtt');
  return mod.connect ?? mod.default.connect;
}

function clientId(role) {
  return `holecorn-${role}-${newSuffix()}`;
}

function newSuffix() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => n.toString(16).padStart(2, '0')).join('');
}

// `connect` is injectable so the behaviours below — which are all about failure
// paths a real broker won't reproduce on demand — can be tested against a fake
// client. Production never passes it.
export async function openScoreboardLink({ config, role, onStatus, onMessage, connect }) {
  const mqttConnect = connect ?? (await loadConnect());

  const state = stateTopic(config.code);
  const online = onlineTopic(config.code);
  const layout = layoutTopic(config.code);
  const lineup = lineupTopic(config.code);
  const tie = tieTopic(config.code);
  const publisher = role === 'publisher';

  onStatus('connecting');
  const client = mqttConnect(config.broker.trim(), {
    username: config.username || undefined,
    password: config.password || undefined,
    clientId: clientId(role),
    reconnectPeriod: RECONNECT_PERIOD,
    connectTimeout: CONNECT_TIMEOUT,
    clean: true,
    will: publisher
      ? { topic: online, payload: '0', qos: 1, retain: true }
      : undefined,
  });

  let latest = null;
  let latestLayout = null;
  let latestLineup = null;
  let latestTie = null;
  // Tracked separately from the value, because a computed null — "the game has
  // begun, clear the form screen" — has to be re-asserted on connect and is
  // otherwise indistinguishable from never having been told.
  let lineupSet = false;
  let tieSet = false;
  let closed = false;
  let presence = null;

  // Stamped with a monotonic version so a delayed retry can never overwrite a
  // newer score on the display.
  const send = (payload) => {
    latest = payload;
    if (closed || !client.connected) return;
    client.publish(state, JSON.stringify({ ...payload, v: Date.now() }), {
      qos: 1,
      retain: true,
    });
  };

  // Retained and whole-value, like the score: a display that joins late gets the
  // current layout from the broker with no request-response of its own.
  const sendLayout = (id) => {
    latestLayout = id;
    if (closed || !client.connected) return;
    client.publish(layout, id, { qos: 1, retain: true });
  };

  // Retained like the layout, and an empty payload is meaningful: it *clears* the
  // retained message on the broker, which is how the board leaves the form screen.
  // So a null must still be published, not skipped.
  const sendLineup = (payload) => {
    latestLineup = payload;
    lineupSet = true;
    if (closed || !client.connected) return;
    client.publish(lineup, payload ? JSON.stringify(payload) : '', {
      qos: 1,
      retain: true,
    });
  };

  // Retained and cleared exactly like the lineup, and a null must still be
  // published for the same reason: an empty payload is the only way back to the
  // score, so a retained tie from an earlier session would otherwise leave a board
  // showing a fixture card for a game that finished last week.
  const sendTie = (payload) => {
    latestTie = payload;
    tieSet = true;
    if (closed || !client.connected) return;
    client.publish(tie, payload ? JSON.stringify(payload) : '', {
      qos: 1,
      retain: true,
    });
  };

  client.on('connect', () => {
    if (closed) return;
    onStatus('connected');
    if (publisher) {
      const announce = () => {
        if (!closed && client.connected) {
          client.publish(online, '1', { qos: 1, retain: true });
        }
      };
      announce();
      clearInterval(presence);
      presence = setInterval(announce, PRESENCE_INTERVAL);
      if (latest) send(latest);
      // Re-asserted on every connect for the same reason the score is: the
      // retained value on the broker may predate this session.
      if (latestLayout) sendLayout(latestLayout);
      // Including a null: the retained lineup on the broker may be one this
      // session has already moved past, and leaving it would strand the board on
      // a form screen for the whole game.
      if (lineupSet) sendLineup(latestLineup);
      if (tieSet) sendTie(latestTie);
    } else {
      client.subscribe([state, online, layout, lineup, tie], { qos: 1 }, (err, granted) => {
        // A broker with per-topic permissions refuses the subscription rather
        // than the connection, which would otherwise leave the board sitting on
        // "connected" having never received anything. Granted QoS 128 is a
        // refusal.
        if (closed) return;
        if (err || (granted ?? []).some((g) => g.qos > 2)) {
          onStatus('error', 'broker refused the subscription — check topic permissions');
        }
      });
    }
  });

  client.on('reconnect', () => {
    if (!closed) onStatus('connecting');
  });

  client.on('close', () => {
    if (!closed) onStatus('offline');
  });

  client.on('error', (err) => {
    if (!closed) onStatus('error', err?.message);
  });

  client.on('message', (topic, buf) => {
    if (closed || publisher) return;
    const text = buf.toString();
    if (topic === online) {
      onMessage({ senderOnline: text === '1' });
      return;
    }
    if (topic === layout) {
      onMessage({ layout: text });
      return;
    }
    if (topic === tie) {
      // Empty is the cleared topic, reported as null so the consumer goes back to
      // the score rather than having to parse "" itself — the lineup's rule.
      if (text === '') {
        onMessage({ tie: null });
        return;
      }
      try {
        onMessage({ tie: JSON.parse(text) });
      } catch {
        // Leaves whatever is on screen, as parseTie does.
      }
      return;
    }
    if (topic === lineup) {
      // An empty payload is the cleared topic, reported as null so the consumer
      // goes back to the score rather than having to parse "" itself.
      if (text === '') {
        onMessage({ lineup: null });
        return;
      }
      try {
        onMessage({ lineup: JSON.parse(text) });
      } catch {
        // Leaves whatever is on screen, as parseLineup does.
      }
      return;
    }
    try {
      onMessage({ payload: JSON.parse(text) });
    } catch {
      // ignore anything on the topic that isn't ours
    }
  });

  return {
    send,
    sendLayout,
    sendLineup,
    sendTie,
    close() {
      if (closed) return;
      closed = true;
      clearInterval(presence);

      let ended = false;
      const finish = () => {
        if (ended) return;
        ended = true;
        client.end(true);
      };

      if (publisher && client.connected) {
        // Ending the client must not be conditional on the acknowledgement.
        // `connected` stays true on a half-open socket for up to a keepalive
        // and a half, and mqtt.js does not error pending callbacks while it is
        // set to reconnect — so a lost PUBACK would leave this client alive to
        // reconnect and republish its retained '0' *after* the replacement has
        // published '1', dimming the board for the rest of the game.
        client.publish(online, '0', { qos: 1, retain: true }, finish);
        setTimeout(finish, GOODBYE_TIMEOUT);
      } else {
        finish();
      }
    },
  };
}
