// The HUB75 panel, emulated (`?panel=1`): the same MQTT subscription the display
// view uses, drawn through src/panelRender.js — which is held pixel-identical to the
// firmware's render.h by `npm run test:firmware`. So this is what the board will
// show, at the board's resolution, not an impression of it.
//
// It is deliberately not sized to be read across a court; `?display=1` is the
// view for that. This one is 128x32 because the panel is, which is the whole
// point of looking at it.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LAYOUT_LABELS,
  configComplete,
  configFromSearch,
  loadScoreboardConfig,
  saveScoreboardConfig,
} from './scoreboard.js';
import {
  LINK_NO_BROKER,
  LINK_NO_SCORER,
  LINK_NO_WIFI,
  PANEL_H,
  PANEL_W,
  SPLASH_ANIM_MS,
  SPLASH_BOARDS,
  SPLASH_MS,
  SPLASH_RENDER_INTERVAL,
  WINNER_BLINK,
  boardLiveness,
  boardState,
  createFramebuffer,
  drawSplash,
  lineupState,
  parseColor,
  boardScreen,
  drawState,
  renderBoard,
  tieState,
} from './panelRender.js';
// Straight from the generated asset, because how many letters there are to throw is the
// mark's own business rather than the renderer's.
import { LOGO_LETTERS } from './panelLogo.js';
import { PALETTE } from './scoring.js';
import { paintPanel, panelCell } from './panelPaint.js';
import { useScoreboardDisplay } from './useScoreboard.js';
import './Panel.css';

// Physical size of the two chained P5 modules, for the caption.
const PANEL_MM = '640 x 160 mm';

// Only alternates while someone has won — renderBoard ignores the beat
// otherwise, and a permanent interval would re-render for nothing.
function useBlink(winner) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (!winner) {
      setOn(true);
      return undefined;
    }
    const id = setInterval(() => setOn((v) => !v), WINNER_BLINK);
    return () => clearInterval(id);
  }, [winner]);
  return on;
}

// The board holds a dropped link live for a grace period so a patchy hotspot
// doesn't flicker it between bright and dim — reproduced here because when the
// board dims is one of the things worth watching. `boardLiveness` decides;
// this only stamps the clock and schedules the one timer it asks for.
function useBoardLive(connected, senderOnline) {
  const [live, setLive] = useState(false);
  const lastLive = useRef(0);

  useEffect(() => {
    const { live: next, dimAt } = boardLiveness({
      connected,
      senderOnline,
      now: Date.now(),
      lastLive: lastLive.current,
    });
    setLive(next);
    // Stamped as the link goes rather than as it arrives, which is what makes
    // the grace run from the drop. Cleanup is the only place that knows the
    // link was up until now.
    if (connected && senderOnline) return () => {
      lastLive.current = Date.now();
    };
    if (dimAt === null) return undefined;
    const id = setTimeout(() => setLive(false), dimAt - Date.now());
    return () => clearTimeout(id);
  }, [connected, senderOnline]);

  return live;
}

// Two different team colours, the way sketch.ino picks them at power-on. The second
// index steps past the first rather than being redrawn, so it cannot repeat it.
function splashPair() {
  const i = Math.floor(Math.random() * PALETTE.length);
  const j = (i + 1 + Math.floor(Math.random() * (PALETTE.length - 1))) % PALETTE.length;
  return [parseColor(PALETTE[i].value), parseColor(PALETTE[j].value)];
}

// And the order each board's four letters are thrown in, which is the other thing the
// sketch picks: bags land where they land, so no two boots fill a board the same way.
// It changes the animation only — a board is one colour, so the mark they settle into is
// the app's wordmark whichever order they arrived in.
function splashOrders() {
  return Array.from({ length: SPLASH_BOARDS }, () => {
    const order = Array.from({ length: LOGO_LETTERS }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
  });
}

// The board's `connectState()` asks two separate things — `WiFi.status()`, then the MQTT
// client — and the emulator has to ask two as well. `navigator.onLine` is the browser's
// answer to the first: whether this device is attached to a network at all, saying
// nothing about what is reachable on it, which is exactly what `WiFi.status()` does and
// does not tell you. Everything past that is the socket.
//
// **A failed socket is not a missing network**, and reading it as one is what this
// replaces. mqtt.js cycles offline → connecting → error against an unreachable broker,
// so mapping anything-but-connecting to LINK_NO_WIFI made a laptop that never lost its
// network flip between NO WIFI and NO BROKER — the exact confusion the line exists to
// remove, shown on the screen that removes it.
function linkState(status, online) {
  if (!online) return LINK_NO_WIFI;
  return status === 'connected' ? LINK_NO_SCORER : LINK_NO_BROKER;
}

// Tracked rather than read once, because the socket cannot stand in for it: with the
// broker already unreachable the MQTT status is the same before and after the network
// goes away, so nothing else here would re-render the line.
function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

// The same three states in prose, for the canvas's `role="img"` label — the panel's own
// words are drawn pixels and so reach nobody reading the page aloud. Indexed by
// linkState, not written beside it, so the two cannot fall out of step.
const LINK_LABELS = ['no network', 'no broker', 'waiting for the scorer'];

// The board shows the wordmark while WiFi and MQTT come up, so the emulator does too —
// it is the only way to see the splash without the hardware.
//
// `elapsed` is what throws the letters into the two boards, and drawSplash turns it into
// offsets — so the flight is the firmware's and this only holds the clock. Animated until
// everything has landed and then left alone: after that nothing moves until the splash
// goes.
//
// The clock is stepped in SPLASH_RENDER_INTERVALs rather than per animation frame, so
// the emulator draws the frames the board draws. A browser gets through half again as
// many, which would make this smoother here than on the panel — and how smooth the
// throws look at the board's own rate is the question the emulator exists to answer.
// Repeating a value is also a render React drops, so the canvas is repainted only on the
// ticks.
function useSplash() {
  const [showing, setShowing] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    let frame = requestAnimationFrame(function step() {
      const t = Date.now() - start;
      setElapsed(Math.floor(t / SPLASH_RENDER_INTERVAL) * SPLASH_RENDER_INTERVAL);
      if (t < SPLASH_ANIM_MS) frame = requestAnimationFrame(step);
    });
    const id = setTimeout(() => setShowing(false), SPLASH_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(id);
    };
  }, []);
  return { showing, elapsed };
}

function useCell(ref) {
  const [cell, setCell] = useState(4);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      if (el.clientWidth > 0) setCell(panelCell(el.clientWidth));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return cell;
}

export default function Panel() {
  const [config] = useState(() => {
    // The display's key, not its own: appending `&panel=1` to a copied display
    // link must not need the broker details typed in again.
    const fromUrl = configFromSearch(window.location.search);
    const merged = { ...loadScoreboardConfig('display'), ...fromUrl };
    if (Object.keys(fromUrl).length > 0) saveScoreboardConfig(merged, 'display');
    return merged;
  });

  const { payload, status, error, senderOnline, layout, lineup, tie, draw } =
    useScoreboardDisplay(config);
  const blinkOn = useBlink(payload?.winner ?? null);
  const live = useBoardLive(status === 'connected', senderOnline);
  // Coerced through the same function the pixel check drives, so what is drawn
  // here is what parseLineup would have made of the message.
  const drawn = useMemo(() => lineupState(lineup), [lineup]);
  // Same again for the tie, through parseTie's own coercions.
  const drawnTie = useMemo(() => tieState(tie), [tie]);
  // And the draw card, through parseDraw's.
  const drawnCard = useMemo(() => drawState(draw), [draw]);
  // Asked of renderBoard's own rule rather than re-derived, so the caption cannot
  // name a screen the canvas is not drawing.
  const screen = boardScreen({
    haveState: payload !== null,
    layout,
    lineup: drawn,
    tie: drawnTie,
    draw: drawnCard,
  });

  const splash = useSplash();
  const online = useOnline();
  const connect = linkState(status, online);
  const [splashColors] = useState(splashPair);
  const [splashOrder] = useState(splashOrders);

  const frameRef = useRef(null);
  const canvasRef = useRef(null);
  const cell = useCell(frameRef);

  useEffect(() => {
    if (!canvasRef.current) return;
    const fb = createFramebuffer();
    if (splash.showing) {
      drawSplash(fb, splashColors[0], splashColors[1], connect, splash.elapsed, splashOrder);
    } else {
      renderBoard(
        fb,
        boardState(payload),
        payload !== null,
        live,
        blinkOn,
        layout,
        drawn,
        drawnTie,
        drawnCard,
        connect,
      );
    }
    paintPanel(canvasRef.current, fb, cell);
  }, [
    payload,
    live,
    blinkOn,
    cell,
    layout,
    drawn,
    drawnTie,
    drawnCard,
    splash,
    splashColors,
    splashOrder,
    connect,
  ]);

  if (!configComplete(config)) {
    return (
      <div className="panel panel-message">
        <p className="panel-title">Panel emulator</p>
        <p>
          Open the display link from the scorer&apos;s phone — <b>External scoreboard</b> on
          the setup screen, then <b>Copy display link</b> — and add <code>&amp;panel=1</code>{' '}
          to it.
        </p>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-frame" ref={frameRef}>
        <canvas
          ref={canvasRef}
          className="panel-canvas"
          style={{ width: PANEL_W * cell, height: PANEL_H * cell }}
          role="img"
          aria-label={
            splash.showing
              ? 'Panel showing the Holecorn logo while it starts up'
              : screen === 'draw'
                ? draw.r
                  ? `Panel showing the ${draw.r} draw: ` +
                    `${draw.n ?? 'a name being pulled out of the hat'}`
                  : `Panel showing the ${draw.t} draw, about to begin`
                : screen === 'tie'
                  ? `Panel showing ${payload.teamA ?? 'team A'} against ` +
                    `${payload.teamB ?? 'team B'} in the ${tie.r}`
                  : screen === 'form'
                    ? `Panel showing pre-game form for ${drawn.count} players`
                    : screen === 'no-state'
                      ? `Panel showing no score yet: ${LINK_LABELS[connect]}`
                      : `Panel showing ${payload.teamA ?? 'team A'} ${payload.a ?? 0}, ` +
                        `${payload.teamB ?? 'team B'} ${payload.b ?? 0}`
          }
        />
      </div>
      <p className="panel-caption">
        {PANEL_W}x{PANEL_H} · {PANEL_MM} ·{' '}
        {/* The form screen overrides the layout, so naming the layout while it is
            up would describe something not on screen — and the no-state dashes ignore
            it outright, which is why they are named here too. */}
        {splash.showing
          ? 'Starting up'
          : screen === 'draw'
            ? 'Tournament draw'
            : screen === 'tie'
              ? 'Tournament tie'
              : screen === 'form'
                ? 'Pre-game form'
                : screen === 'no-state'
                  ? 'No score yet'
                  : (LAYOUT_LABELS[layout] ?? layout)}{' '}
        ·{' '}
        {status === 'connected'
          ? live
            ? 'live'
            : 'waiting for the scorer — dimmed'
          : status === 'connecting'
            ? 'connecting…'
            : (error ?? status)}
      </p>
    </div>
  );
}
