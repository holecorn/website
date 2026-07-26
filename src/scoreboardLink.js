// MQTT transport for the external scoreboard. No React in here.
//
// The app is served over HTTPS, which cannot reach a device on the local
// network (mixed content blocks http:// and ws:// to a LAN address), and iOS
// has no Web Bluetooth, Web Serial or WebUSB. So both ends meet at a hosted
// broker instead: the browser over WSS, firmware over MQTTS on the same topic.

import { stateTopic, onlineTopic } from './scoreboard.js';

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
    } else {
      client.subscribe([state, online], { qos: 1 }, (err, granted) => {
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
    try {
      onMessage({ payload: JSON.parse(text) });
    } catch {
      // ignore anything on the topic that isn't ours
    }
  });

  return {
    send,
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
