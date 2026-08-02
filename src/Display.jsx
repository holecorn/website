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
  const { payload, status, error, senderOnline, lineup, tie, draw } =
    useScoreboardDisplay(config);
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
  const statusText =
    status === 'connected'
      ? senderOnline
        ? 'live'
        : 'waiting for the scorer'
      : status === 'connecting'
        ? 'connecting…'
        : (error ?? status);

  // Either topic means the game has not begun, so there is no score worth the whole
  // screen. A tie alone still gets this branch: a tournament whose entrants have
  // never played publishes no lineup at all, and round one of a first cup is exactly
  // that — without it the tablet would say nothing about the tie it is watching.
  //
  // Unlike the panel — 128x32 and four rows of 5x7, so the fixture takes the lot —
  // a tablet has room for the rates underneath, so it keeps them. That divergence is
  // deliberate, the same as the winner flash and the dim grace.
  // Above both, the precedence `boardScreen` answers for the panel. A draw is played out
  // before any tie is picked and before any game exists, so whatever is retained beneath
  // it is last week's — and unlike the fixture card this one needs no score message at
  // all, because every word on it is in its own payload.
  //
  // Where the panel gives the card the whole screen, the tablet has the room for the one
  // thing a single card cannot say: how much longer this is going to take. Same
  // divergence the fixture card already makes by keeping the form table.
  if (draw) {
    return (
      <div
        className={`display display-draw${stale ? ' is-stale' : ''}`}
        onClick={toggleFullscreen}
        title="Tap for fullscreen"
      >
        <DrawCard card={draw} />
        <p className="display-status">{statusText}</p>
      </div>
    );
  }

  if (lineup || tie) {
    return (
      <div
        className={`display display-form${stale ? ' is-stale' : ''}`}
        onClick={toggleFullscreen}
        title="Tap for fullscreen"
      >
        <FormTable
          lineup={lineup}
          tie={tie}
          sides={[payload?.teamA ?? 'Team A', payload?.teamB ?? 'Team B']}
          colorA={colorA}
          colorB={colorB}
        />
        <p className="display-status">{statusText}</p>
      </div>
    );
  }

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

      <p className="display-status">{statusText}</p>
    </div>
  );
}

// The pre-game roster. Rows arrive in lane order — team A's slots then team B's —
// so which half a row is in is the team it belongs to; usableLineup refuses a
// count that cannot be halved, which is what makes that safe here too.
// One pull of the draw, in the three shapes the panel draws — the cup before anything has
// been pulled, a name with nobody yet, and a name with an opponent — plus the progress
// line the panel has no row for.
//
// No team colours, matching the panel: at the moment a name comes out of the hat nobody
// has been given one, and picking a colour would imply an assignment that has not
// happened. `n` absent is the beat before the name lands, so it is told from an empty
// name the way `winner` is told from a live game.
function DrawCard({ card }) {
  const opponents = Array.isArray(card.o) ? card.o.filter((s) => typeof s === 'string') : [];
  const meets =
    opponents.length === 0
      ? null
      : opponents.length === 1
        ? `plays ${opponents[0]}`
        : `plays the winner of ${opponents.join(' v ')}`;
  // A cup with no round is the opening card, and the cup takes the row a name takes on
  // every other card — it is what the screen is about until somebody is. The count keeps
  // its one wording rather than gaining a second for "0 of 11": it is the line that ticks
  // up as the draw goes on, and a format that changes with the card reads as two lines.
  const title = !card.r;
  return (
    <div className="draw-card">
      {title ? (
        <>
          <p className="draw-card-name">{card.t}</p>
          <p className="draw-card-title">Draw</p>
        </>
      ) : (
        <>
          <p className="draw-card-round">{card.r}</p>
          <p className="draw-card-name">{card.n ? card.n : 'Pulling…'}</p>
          {card.n && meets && <p className="draw-card-meets">{meets}</p>}
        </>
      )}
      {Number.isFinite(card.e) && card.e > 0 && (
        <p className="draw-card-count">
          {Number.isFinite(card.d) ? card.d : 0} of {card.e} drawn
        </p>
      )}
    </div>
  );
}

function FormTable({ lineup, tie, sides, colorA, colorB }) {
  const rows = lineup?.rows ?? [];
  const half = rows.length / 2;
  return (
    <div className={`form-table${rows.length === 0 ? ' is-card' : ''}`}>
      {/* The tie replaces the title rather than sitting beside it: "Form" is the
          one line here the columns below already say for themselves, so the round
          costs no height at all.
          A tablet keeps the form table underneath, where the panel gives the whole
          screen to the fixture — it has the room, and the two diverging is the same
          call the winner flash and the dim grace already make. */}
      <p className="form-title">
        {tie ? (
          <>
            {tie.t ? <span className="form-cup">{tie.t} · </span> : null}
            <span className="form-tie">{tie.r}</span>
          </>
        ) : (
          'Form'
        )}
      </p>
      {/* With no roster there are no columns to caption, and the two sides stand on
          their own — the panel's fixture card, on a screen that could have held more
          and has nothing to put there. */}
      {rows.length === 0 ? (
        sides.map((side, i) => (
          <div className="form-row" key={i}>
            <span className="form-name form-side" style={{ color: i === 0 ? colorA : colorB }}>
              {side}
            </span>
          </div>
        ))
      ) : (
        <div className="form-head" aria-hidden="true">
          <span />
          <span>W–L</span>
          <span>Last 5</span>
          <span>PPR</span>
        </div>
      )}
      {rows.map((row, i) => {
        const color = i < half ? colorA : colorB;
        const form = typeof row.f === 'string' ? row.f : '';
        const played = (row.w ?? 0) + (row.l ?? 0) > 0;
        // Mirrors hasRate in board_logic.h — both halves, for the reasons given
        // there. An absent `p` reaching toFixed draws NaN.
        const rate = played && Number.isFinite(row.p) ? (row.p / 10).toFixed(1) : '';
        return (
          <div className="form-row" key={i}>
            <span className="form-name" style={{ color }}>
              {row.n}
            </span>
            <span className="form-record">
              {row.w ?? 0}–{row.l ?? 0}
            </span>
            <span className="form-pips">
              {/* Spoken rather than shown: a row of shapes reads as nothing. */}
              <span className="form-spoken">
                {played
                  ? Array.from(form, (c) => (c === 'W' ? 'won' : 'lost')).join(', ')
                  : 'no matches yet'}
              </span>
              {Array.from(form, (c, j) => (
                <span
                  key={j}
                  className={`form-pip${c === 'W' ? ' is-win' : ''}`}
                  style={c === 'W' ? { background: color } : undefined}
                  aria-hidden="true"
                />
              ))}
            </span>
            {/* Tenths on the wire, so the board needs no float formatter. Empty
                only where there is no rate to give — a 0.0 average is a real one
                and has to show, or it reads as missing data. */}
            <span className="form-ppr">{rate}</span>
          </div>
        );
      })}
    </div>
  );
}
