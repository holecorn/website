// The scoreboard view (`?display=1`): a dumb subscriber that renders whatever
// the last message said. Deliberately shaped like seven-segment digits, since
// this is standing in for the hardware board and should look like it.

import { useEffect, useId, useState } from 'react';
import {
  configComplete,
  configFromSearch,
  loadScoreboardConfig,
  saveScoreboardConfig,
  segmentDigits,
} from './scoreboard.js';
import { winVerb } from './scoring.js';
import { DIGIT_VIEWBOX, SEGMENTS, litSegments } from './segments.js';
import { useScoreboardDisplay } from './useScoreboard.js';
import './Display.css';

// `hollow` is the winner flash: lit segments keep a full-brightness rim and drop
// their interior, so the score stays readable throughout — unlike blanking it.
// The rim is a stroke clipped to its own polygon, because SVG centres strokes and
// an unclipped one would grow the segment enough to close the mitre gaps.
function Digit({ char, hollow }) {
  const lit = litSegments(char);
  const uid = useId().replace(/:/g, '');
  return (
    <svg className="seg-digit" viewBox={DIGIT_VIEWBOX} aria-hidden="true">
      {hollow && (
        <defs>
          {Object.entries(SEGMENTS).map(([name, points]) => (
            <clipPath key={name} id={`${uid}-${name}`}>
              <polygon points={points} />
            </clipPath>
          ))}
        </defs>
      )}
      {Object.entries(SEGMENTS).map(([name, points]) => {
        const on = lit.includes(name);
        if (!on || !hollow) {
          return (
            <polygon
              key={name}
              points={points}
              fill="currentColor"
              className={on ? 'seg on' : 'seg'}
            />
          );
        }
        return (
          <g key={name} clipPath={`url(#${uid}-${name})`} className="seg on">
            <polygon points={points} fill="currentColor" className="seg-fill" />
            <polygon points={points} fill="none" stroke="currentColor" strokeWidth="9" />
          </g>
        );
      })}
    </svg>
  );
}

// The team colour is set as `color` so the segment fill and its glow both pick
// it up through currentColor.
function SegNumber({ value, color, places = 2, label, hollow }) {
  const chars = segmentDigits(value, places);
  return (
    <div
      className="seg-number"
      style={{ color }}
      role="img"
      aria-label={`${label}: ${chars.join('').trim()}`}
    >
      {chars.map((char, i) => (
        <Digit key={i} char={char} hollow={hollow} />
      ))}
    </div>
  );
}

// Alternates the winner's digits between solid and hollow. Skipped outright for
// anyone who has asked for reduced motion — a flashing score is exactly what
// that preference is about.
function useWinnerFlash(winner) {
  const [hollow, setHollow] = useState(false);
  useEffect(() => {
    if (!winner) {
      setHollow(false);
      return undefined;
    }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const id = setInterval(() => setHollow((h) => !h), 500);
    return () => {
      clearInterval(id);
      setHollow(false);
    };
  }, [winner]);
  return hollow;
}

// Browser chrome eats the height the digits want, and there's no way to enter
// fullscreen without a gesture — so the whole board is the button. iOS Safari
// won't fullscreen a non-video element and simply does nothing here.
function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  } else {
    document.documentElement.requestFullscreen?.().catch(() => {});
  }
}

// A tablet propped against a fence is useless if it sleeps mid-game. One request
// isn't enough: the lock is dropped whenever the page is hidden, and the system
// can take it back on its own (low battery), so it has to be re-taken.
function useWakeLock() {
  useEffect(() => {
    if (!navigator.wakeLock) return undefined;

    let sentinel = null;
    let retry = null;
    let stopped = false;
    // Guards the await, not just the result: the retry timer can fire while a
    // visibilitychange request is still in flight, and two requests that both
    // pass a `sentinel === null` check would orphan the first lock.
    let acquiring = false;

    const acquire = async () => {
      if (stopped || acquiring || sentinel || document.visibilityState !== 'visible') return;

      let held;
      acquiring = true;
      try {
        held = await navigator.wakeLock.request('screen');
      } catch {
        // Unsupported or refused outright. The board still works, it just dims,
        // and asking again immediately would only be refused again.
        return;
      } finally {
        acquiring = false;
      }

      if (stopped) {
        held.release().catch(() => {});
        return;
      }
      sentinel = held;

      held.addEventListener('release', () => {
        if (sentinel === held) sentinel = null;
        // Delayed, so a system that won't hold the lock degrades to a slow retry
        // rather than spinning. Hidden pages are filtered out by acquire().
        clearTimeout(retry);
        retry = setTimeout(acquire, 1000);
      });
    };

    acquire();
    document.addEventListener('visibilitychange', acquire);

    return () => {
      stopped = true;
      clearTimeout(retry);
      document.removeEventListener('visibilitychange', acquire);
      sentinel?.release().catch(() => {});
    };
  }, []);
}

export default function Display() {
  const [config] = useState(() => {
    const fromUrl = configFromSearch(window.location.search);
    // Stored under the display's own key: opening a display link in the same
    // browser as the scorer must not overwrite the scorer's game code.
    const merged = { ...loadScoreboardConfig('display'), ...fromUrl };
    // Remember the link's settings so the tablet can be reopened without them.
    if (Object.keys(fromUrl).length > 0) saveScoreboardConfig(merged, 'display');
    return merged;
  });

  useWakeLock();
  const { payload, status, error, senderOnline } = useScoreboardDisplay(config);
  const hollow = useWinnerFlash(payload?.winner ?? null);

  if (!configComplete(config)) {
    return (
      <div className="display display-message">
        <p className="display-title">Scoreboard</p>
        <p>
          Open the display link from the scorer&apos;s phone: <b>External scoreboard</b> on
          the setup screen, then <b>Copy display link</b>.
        </p>
      </div>
    );
  }

  const colorA = payload?.colorA ?? '#2f80ed';
  const colorB = payload?.colorB ?? '#eb5757';
  const stale = status !== 'connected' || !senderOnline;
  const winnerLabel = payload?.winner
    ? (payload.winner === 'a' ? payload.teamA : payload.teamB)
    : '';

  return (
    <div
      className={`display${stale ? ' is-stale' : ''}`}
      onClick={toggleFullscreen}
      title="Tap for fullscreen"
    >
      <div className="display-side">
        <p className="display-team" style={{ color: colorA }}>
          {payload?.teamA ?? 'Team A'}
        </p>
        <SegNumber
          value={payload?.a ?? 0}
          color={colorA}
          label={payload?.teamA ?? 'Team A'}
          hollow={hollow && payload?.winner === 'a'}
        />
      </div>

      <div className="display-middle">
        <span className="display-round">
          {Number.isFinite(payload?.round)
            ? `R${payload.round + (payload.winner ? 0 : 1)}`
            : '—'}
        </span>
        <span className="display-dash" aria-hidden="true" />
        <span className="display-target">
          {Number.isFinite(payload?.target) ? `to ${payload.target}` : ''}
        </span>
      </div>

      <div className="display-side">
        <p className="display-team" style={{ color: colorB }}>
          {payload?.teamB ?? 'Team B'}
        </p>
        <SegNumber
          value={payload?.b ?? 0}
          color={colorB}
          label={payload?.teamB ?? 'Team B'}
          hollow={hollow && payload?.winner === 'b'}
        />
      </div>

      {payload?.winner && (
        <div
          className="display-banner"
          style={{ background: payload.winner === 'a' ? colorA : colorB }}
        >
          {winnerLabel} {winVerb(winnerLabel)}!
        </div>
      )}

      <p className="display-status">
        {status === 'connected'
          ? senderOnline
            ? 'live'
            : 'waiting for the scorer'
          : status === 'connecting'
            ? 'connecting…'
            : (error ?? status)}
      </p>
    </div>
  );
}
