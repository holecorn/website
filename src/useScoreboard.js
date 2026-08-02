import { useEffect, useMemo, useRef, useState } from 'react';
import {
  acceptsUpdate,
  configComplete,
  lineupPayload,
  normalizeLayout,
  scoreboardPayload,
  tiePayload,
  usableLineup,
  usableTie,
} from './scoreboard.js';
import { openScoreboardLink } from './scoreboardLink.js';
import { PANEL_LAYOUTS } from './panelRender.js';

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
  const pendingLayoutRef = useRef(null);
  // Holds `{ value }` rather than the payload, because a null lineup is a real
  // instruction — clear the form screen — and has to be told apart from nothing
  // pending yet.
  const pendingLineupRef = useRef(null);
  // Same again for the tie: a null clears the fixture card.
  const pendingTieRef = useRef(null);
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
        if (pendingLayoutRef.current) handle.sendLayout(pendingLayoutRef.current);
        if (pendingLineupRef.current) handle.sendLineup(pendingLineupRef.current.value);
        if (pendingTieRef.current) handle.sendTie(pendingTieRef.current.value);
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

  return { status, error, linkRef, pendingRef, pendingLayoutRef, pendingLineupRef, pendingTieRef };
}

// Publishes the logged score whenever it changes. Fire and forget: nothing here
// blocks the UI, and a broker that is unreachable just leaves a status pill.
export function useScoreboardPublisher(game, config, matches, tie) {
  const active = Boolean(config.enabled);
  const {
    status,
    error,
    linkRef,
    pendingRef,
    pendingLayoutRef,
    pendingLineupRef,
    pendingTieRef,
  } = useLink({
    config,
    role: 'publisher',
    active,
  });
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

  // Not debounced: this changes on a button press, not per keystroke, and the
  // point of a separate topic is that it lands without waiting for a round.
  // pendingLayoutRef covers a press made before the link is open.
  const layout = normalizeLayout(config.layout);
  useEffect(() => {
    pendingLayoutRef.current = layout;
    linkRef.current?.sendLayout(layout);
  }, [layout, linkRef, pendingLayoutRef]);

  // Debounced like the score, because renaming a player rebuilds this per
  // keystroke. Compared as JSON rather than by identity: the payload is rebuilt
  // whenever `game` changes, which is on every bag, and republishing an identical
  // roster would retain the same bytes over and over.
  const lineup = useMemo(() => lineupPayload(game, matches), [game, matches]);
  const sentLineupRef = useRef(undefined);
  useEffect(() => {
    pendingLineupRef.current = { value: lineup };
    const json = JSON.stringify(lineup ?? null);
    if (json === sentLineupRef.current) return undefined;
    const id = setTimeout(() => {
      sentLineupRef.current = json;
      linkRef.current?.sendLineup(lineup);
    }, PUBLISH_DEBOUNCE);
    return () => clearTimeout(id);
  }, [lineup, linkRef, pendingLineupRef]);

  // Debounced like the lineup, and held as `{ value }` for the same reason: a
  // computed null is the instruction to clear the topic, not the absence of one.
  const tiePayloadValue = useMemo(() => tiePayload(game, tie), [game, tie]);
  const sentTieRef = useRef(undefined);
  useEffect(() => {
    pendingTieRef.current = { value: tiePayloadValue };
    const json = JSON.stringify(tiePayloadValue ?? null);
    if (json === sentTieRef.current) return undefined;
    const id = setTimeout(() => {
      sentTieRef.current = json;
      linkRef.current?.sendTie(tiePayloadValue);
    }, PUBLISH_DEBOUNCE);
    return () => clearTimeout(id);
  }, [tiePayloadValue, linkRef, pendingTieRef]);

  return { status, error };
}

export function useScoreboardDisplay(config) {
  const [payload, setPayload] = useState(null);
  const [senderOnline, setSenderOnline] = useState(false);
  const [layout, setLayout] = useState(PANEL_LAYOUTS[0]);
  const [lineup, setLineup] = useState(null);
  const [tie, setTie] = useState(null);
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
      if ('layout' in msg) {
        // An unrecognised id keeps whatever is on screen, mirroring parseLayout
        // in board_logic.h: an app newer than this build must not blank the board
        // or drop it to a layout nobody chose.
        if (PANEL_LAYOUTS.includes(msg.layout)) setLayout(msg.layout);
        return;
      }
      if ('tie' in msg) {
        // Null is the cleared topic. Anything else unusable leaves what is on
        // screen, mirroring parseTie.
        if (msg.tie === null) setTie(null);
        else if (usableTie(msg.tie)) setTie(msg.tie);
        return;
      }
      if ('lineup' in msg) {
        // Null is the cleared topic and means "back to the score". Anything else
        // that isn't usable leaves what is on screen, mirroring parseLineup.
        if (msg.lineup === null) setLineup(null);
        else if (usableLineup(msg.lineup)) setLineup(msg.lineup);
        return;
      }
      const next = msg.payload;
      if (!acceptsUpdate(next, versionRef.current)) return;
      if (Number.isFinite(next.v)) versionRef.current = next.v;
      setPayload(next);
    },
  });

  return { payload, status, error, senderOnline, layout, lineup, tie };
}
