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
  PANEL_H,
  PANEL_W,
  SPLASH_MS,
  WINNER_BLINK,
  boardLiveness,
  boardState,
  createFramebuffer,
  drawSplash,
  lineupState,
  parseColor,
  renderBoard,
} from './panelRender.js';
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

// The board shows the wordmark while WiFi and MQTT come up, so the emulator does too —
// it is the only way to see the splash without the hardware. The indicator reads the
// same three-step progress the board's does; a browser has no WiFi state of its own,
// so a connecting socket stands in for the middle one.
function useSplash(status) {
  const [showing, setShowing] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setShowing(false), SPLASH_MS);
    return () => clearTimeout(id);
  }, []);
  const connect = status === 'connected' ? 2 : status === 'connecting' ? 1 : 0;
  return { showing, connect };
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

  const { payload, status, error, senderOnline, layout, lineup } = useScoreboardDisplay(config);
  const blinkOn = useBlink(payload?.winner ?? null);
  const live = useBoardLive(status === 'connected', senderOnline);
  // Coerced through the same function the pixel check drives, so what is drawn
  // here is what parseLineup would have made of the message.
  const drawn = useMemo(() => lineupState(lineup), [lineup]);

  const splash = useSplash(status);
  const [splashColors] = useState(splashPair);

  const frameRef = useRef(null);
  const canvasRef = useRef(null);
  const cell = useCell(frameRef);

  useEffect(() => {
    if (!canvasRef.current) return;
    const fb = createFramebuffer();
    if (splash.showing) {
      drawSplash(fb, splashColors[0], splashColors[1], splash.connect);
    } else {
      renderBoard(fb, boardState(payload), payload !== null, live, blinkOn, layout, drawn);
    }
    paintPanel(canvasRef.current, fb, cell);
  }, [payload, live, blinkOn, cell, layout, drawn, splash, splashColors]);

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
              : drawn
                ? `Panel showing pre-game form for ${drawn.count} players`
                : payload
                  ? `Panel showing ${payload.teamA ?? 'team A'} ${payload.a ?? 0}, ` +
                    `${payload.teamB ?? 'team B'} ${payload.b ?? 0}`
                  : 'Panel showing no score yet'
          }
        />
      </div>
      <p className="panel-caption">
        {PANEL_W}x{PANEL_H} · {PANEL_MM} ·{' '}
        {/* The form screen overrides the layout, so naming the layout while it is
            up would describe something not on screen. */}
        {splash.showing
          ? 'Starting up'
          : drawn
            ? 'Pre-game form'
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
