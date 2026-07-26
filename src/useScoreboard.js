import { useEffect, useMemo, useRef, useState } from 'react';
import { acceptsUpdate, configComplete, scoreboardPayload } from './scoreboard.js';
import { openScoreboardLink } from './scoreboardLink.js';

// Renames fire per keystroke; the score itself only moves once a round.
const PUBLISH_DEBOUNCE = 400;
// Editing the broker URL while publishing would otherwise reconnect per
// keystroke, so wait for typing to stop before touching the connection.
const CONNECT_SETTLE = 800;

// Deliberately seeded with the initial value so a stored config connects at
// once; only later edits wait. Safe to return a fresh object each time because
// callers depend on the primitive fields, not the identity.
function useSettled(value, delay) {
  const [settled, setSettled] = useState(value);
  const json = JSON.stringify(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(JSON.parse(json)), delay);
    return () => clearTimeout(id);
  }, [json, delay]);
  return settled;
}

// Opening the link is async, so every path has to cope with the effect being
// torn down (StrictMode, a settings edit) before the client exists.
function useLink({ config, role, active, onMessage }) {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const linkRef = useRef(null);
  const pendingRef = useRef(null);
  const messageRef = useRef(onMessage);
  messageRef.current = onMessage;

  const { broker, username, password, code } = useSettled(
    {
      broker: config.broker,
      username: config.username,
      password: config.password,
      code: config.code,
    },
    CONNECT_SETTLE,
  );

  useEffect(() => {
    if (!active || !configComplete({ broker, code })) {
      setStatus('idle');
      return undefined;
    }
    let cancelled = false;
    let link = null;
    setError(null);

    openScoreboardLink({
      config: { broker, username, password, code },
      role,
      onStatus: (next, message) => {
        if (cancelled) return;
        setStatus(next);
        if (next === 'error') setError(message ?? 'connection failed');
      },
      onMessage: (msg) => {
        if (!cancelled) messageRef.current?.(msg);
      },
    })
      .then((handle) => {
        link = handle;
        if (cancelled) {
          handle.close();
          return;
        }
        linkRef.current = handle;
        if (pendingRef.current) handle.send(pendingRef.current);
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus('error');
        setError(err?.message ?? 'could not load MQTT client');
      });

    return () => {
      cancelled = true;
      linkRef.current = null;
      link?.close();
    };
  }, [active, role, broker, username, password, code]);

  return { status, error, linkRef, pendingRef };
}

// Publishes the logged score whenever it changes. Fire and forget: nothing here
// blocks the UI, and a broker that is unreachable just leaves a status pill.
export function useScoreboardPublisher(game, config) {
  const active = Boolean(config.enabled);
  const { status, error, linkRef, pendingRef } = useLink({ config, role: 'publisher', active });
  const payload = useMemo(() => scoreboardPayload(game), [game]);
  const sentRef = useRef(null);

  useEffect(() => {
    pendingRef.current = payload;
    const json = JSON.stringify(payload);
    if (json === sentRef.current) return undefined;
    const id = setTimeout(() => {
      sentRef.current = json;
      linkRef.current?.send(payload);
    }, PUBLISH_DEBOUNCE);
    return () => clearTimeout(id);
  }, [payload, linkRef, pendingRef]);

  return { status, error };
}

export function useScoreboardDisplay(config) {
  const [payload, setPayload] = useState(null);
  const [senderOnline, setSenderOnline] = useState(false);
  const versionRef = useRef(-1);

  const { status, error } = useLink({
    config,
    role: 'display',
    active: true,
    onMessage: (msg) => {
      if ('senderOnline' in msg) {
        setSenderOnline(msg.senderOnline);
        return;
      }
      const next = msg.payload;
      if (!acceptsUpdate(next, versionRef.current)) return;
      if (Number.isFinite(next.v)) versionRef.current = next.v;
      setPayload(next);
    },
  });

  return { payload, status, error, senderOnline };
}
