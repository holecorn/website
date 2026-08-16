// The scoreboard view (`?display=1`): a dumb subscriber that renders whatever
// the last message said. Deliberately shaped like seven-segment digits, since
// this is standing in for the hardware board and should look like it.

import { useEffect, useId, useState } from 'react';
import Confetti from './Confetti.jsx';
import {
  configComplete,
  configFromSearch,
  drawMeets,
  loadScoreboardConfig,
  saveScoreboardConfig,
  segmentDigits,
} from './scoreboard.js';
import { CHAMPION_COLOR, DEFAULT_COLORS, TEAM_JOIN, splitLabel, winVerb } from './scoring.js';
import { DIGIT_VIEWBOX, SEGMENTS, litSegments } from './segments.js';
import { useScoreboardDisplay } from './useScoreboard.js';
import { useWakeLock } from './useWakeLock.js';
import './Display.css';

// How many pieces the board drops. Its own number rather than the phone's 44: the board
// is several times the area at the same piece size, and it has no skunk to know about —
// the payload deliberately carries nothing of the kind.
const BOARD_CONFETTI = 72;

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

// Who throws the next bag, and who throws after them from the same end. A filled bag
// for the first and a hollow one for the other: the phone's `.first-bag` at board
// scale, so the setup screen, the board and the LED panel all mark it the same way.
// The panel's two score layouts rule the name or the digits instead — a bag costs a
// name character there, and the `score` layout has two spare rows where an outline
// needs three — but every screen that can carry a bag carries this one.
//
// **Singles has no second mark.** With one player a side there is nobody at that end
// to tell from the thrower, so a mark on both would only say the two of them are
// playing. Read off the label rather than a `mode` field, the test `winVerb` already
// makes, because the payload deliberately carries no mode.
//
// Named through `role="img"` rather than a `visually-hidden` sibling, which is what
// `SegNumber` already does: a clipped span is still *rendered*, so its words come back
// from `innerText` — inside `.form-name` that put "throws first," in front of every
// name any check or copy-paste reads off the table.
function Bag({ first }) {
  return (
    <span
      className={`thrower${first ? ' is-first' : ''}`}
      role="img"
      aria-label={first ? 'throws first' : 'throws next'}
    />
  );
}

// The gap keeps the name centred over its own digits: the bag is drawn before the
// text, so without it the label sits half a token off. Measured on an 11in iPad,
// 22.5px, which is why it is not left to look after itself.
const BagGap = () => <span className="thrower-gap" aria-hidden="true" />;

// `mark` is 'first', 'next' or null. In doubles the bag goes beside the partner who
// is up rather than the whole label, which is the same half `render.h` underlines.
//
// `balance` is what the score screen needs and the fixture card does not: there the
// label sits over its own digits, so the *text* has to stay centred and a leading bag
// is paid for with a trailing gap. On a card there is nothing underneath, so what
// should look centred is the mark and the name together — a gap there pushes the ink
// half its own width off the card's centre.
function SideName({ label, up, mark, balance = false }) {
  const parts = splitLabel(label);
  if (!parts) {
    if (!mark) return label;
    return (
      <>
        <Bag first={mark === 'first'} />
        {label}
        {balance && <BagGap />}
      </>
    );
  }
  return (
    <>
      {parts.map((text, i) => (
        <span key={i}>
          {i > 0 && TEAM_JOIN}
          {mark && i === up && <Bag first={mark === 'first'} />}
          {text}
        </span>
      ))}
      {/* Only a *leading* bag needs balancing. On an odd round it sits between the two
          names, where it displaces nothing. */}
      {balance && mark && up === 0 && <BagGap />}
    </>
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

  const colorA = payload?.colorA ?? DEFAULT_COLORS.a;
  const colorB = payload?.colorB ?? DEFAULT_COLORS.b;
  const stale = status !== 'connected' || !senderOnline;
  // Which partner is up, the way `upPartnerFor` in render.h and `activeIdx` in App.jsx
  // both derive it — slot 0 throws even rounds, so nothing is published for this.
  const upPartner = (payload?.round ?? 0) % 2;
  const doubles = Boolean(splitLabel(payload?.teamA) || splitLabel(payload?.teamB));
  // Once the game is won nobody is throwing, so the marks come off — the rule the
  // panel's underline already follows.
  const throwerMark = (side) => {
    if (!payload?.first || payload.winner) return null;
    if (payload.first === side) return 'first';
    return doubles ? 'next' : null;
  };
  const winnerColor = payload?.winner === 'b' ? colorB : colorA;
  const winnerLabel = payload?.winner
    ? (payload.winner === 'a' ? payload.teamA : payload.teamB)
    : '';
  // The cup, if this was the final of one. Everything below reads this rather than the
  // round's wording: `tiePayload` only republishes the topic for a final, so its presence
  // beside a winner is the whole of the test — the panel makes the same one.
  const cup = payload?.winner && tie ? tie : null;
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

  // A tie topic standing over a *winner* is a won final, not a fixture — the topic is
  // cleared at the first bag and only a final republishes it (see `tiePayload`). That is
  // the same rule the panel's tie branch follows, and it has to be made here too or the
  // board would draw a fixture card for a game that is over.
  if ((lineup || tie) && !payload?.winner) {
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
          up={upPartner}
          marks={[throwerMark('a'), throwerMark('b')]}
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
      {/* Mounted when the winner appears and keyed on which side won, so it falls once
          rather than on every republished payload — a rename after the win would
          otherwise set it off again. The phone's own celebration, sized for a board:
          `--piece` and `--fall` are set in `Display.css`.
          A won *final* drops its own, gold, on the card in front of this — so this one is
          skipped rather than animating 72 pieces nobody can see. */}
      {payload?.winner && !cup && (
        <Confetti key={payload.winner} count={BOARD_CONFETTI} color={winnerColor} />
      )}

      <div className={`display-side${payload?.winner === 'a' ? ' is-winner' : ''}`}>
        <p className="display-team" style={{ color: colorA }}>
          <SideName
            label={payload?.teamA ?? 'Team A'}
            up={upPartner}
            mark={throwerMark('a')}
            balance
          />
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

      <div className={`display-side${payload?.winner === 'b' ? ' is-winner' : ''}`}>
        <p className="display-team" style={{ color: colorB }}>
          <SideName
            label={payload?.teamB ?? 'Team B'}
            up={upPartner}
            mark={throwerMark('b')}
            balance
          />
        </p>
        <SegNumber
          value={payload?.b ?? 0}
          color={colorB}
          label={payload?.teamB ?? 'Team B'}
          hollow={hollow && payload?.winner === 'b'}
        />
      </div>

      {payload?.winner && (
        <div className="display-banner" style={{ background: cup ? CHAMPION_COLOR : winnerColor }}>
          {cup ? (
            <>
              {winnerLabel} — <span className="champion-cup">{cup.t}</span>{' '}
              {championTitle(winnerLabel)}!
            </>
          ) : (
            `${winnerLabel} ${winVerb(winnerLabel)}!`
          )}
        </div>
      )}

      {/* Keyed like the confetti, so it plays once and a republished payload does not set
          it off again. It holds and then clears itself in CSS rather than on a timer:
          nothing here is on the wire, so there is no state to keep and no phase to
          publish. The panel diverges and keeps its card for good — a 128x32 strip has no
          third thing to show, where a tablet still has the score underneath. */}
      {cup && (
        <ChampionCard
          key={payload.winner}
          cup={cup}
          label={winnerLabel}
          beat={payload.winner === 'a' ? (payload.teamB ?? 'Team B') : (payload.teamA ?? 'Team A')}
          score={payload.winner === 'a' ? [payload.a, payload.b] : [payload.b, payload.a]}
        />
      )}

      <p className="display-status">{statusText}</p>
    </div>
  );
}

// "Rho & Tau champions" but "Neil champion", the test `winVerb` already makes on the same
// label — the payload carries no `mode`, so a join in the string is the only thing saying
// there are two of them.
function championTitle(label) {
  return splitLabel(label) ? 'champions' : 'champion';
}

// What the board gives the whole screen to for a few seconds when a cup is won, before
// handing back to the score under the banner. The champion wears `CHAMPION_COLOR` rather
// than the colour they won the game in, which is the one thing saying this is not just
// another win — the panel's card makes the same swap at the same moment.
function ChampionCard({ cup, label, beat, score }) {
  return (
    <div className="champion-card" style={{ '--champion': CHAMPION_COLOR }}>
      <Confetti count={BOARD_CONFETTI} color={CHAMPION_COLOR} />
      <p className="champion-cup-name">{cup.t}</p>
      <div className="champion-rule" aria-hidden="true" />
      {/* Sized off its own length rather than picked: a champion can be a pair with two
          long names, and a name that wraps or clips is the one thing this screen may not
          do. `--chars` is what lets the width term be written in CSS. */}
      <p className="champion-name" style={{ '--chars': label.length }}>
        {label}
      </p>
      <p className="champion-title">{championTitle(label)}</p>
      {/* Oriented to the champion, never to the payload's team letters — which side was
          entered as A is an accident of setting the game up, and written that way round
          the line reads `24–26` under a champion and says they lost. `bracket()` orients
          a tie's score to its own two sides for exactly this reason. */}
      <p className="champion-round">
        {cup.r} · {score[0]}–{score[1]} v {beat}
      </p>
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
  const meets = drawMeets(opponents);
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

function FormTable({ lineup, tie, sides, colorA, colorB, up, marks }) {
  const rows = lineup?.rows ?? [];
  const half = rows.length / 2;
  // Rows arrive in lane order — team A's slots then team B's — so a slot index is a
  // row index, and the partner who is up is the end play starts from. Pre-game, so
  // `up` is 0 in practice; derived anyway rather than assumed, since the same rule
  // decides it everywhere else.
  const rowFor = (side) => (side === 0 ? 0 : half) + up;
  const marked = (i) => {
    if (marks[0] && i === rowFor(0)) return marks[0];
    if (marks[1] && i === rowFor(1)) return marks[1];
    return null;
  };
  // A board that has been sent a roster but no score has nobody to mark, and there
  // the column would only be an indent on every row.
  const anyMark = marks.some(Boolean);
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
              <SideName label={side} up={up} mark={marks[i]} />
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
              {/* The gap on an unmarked row is what keeps the names in one column;
                  without it a marked row is the only one indented. */}
              {marked(i) ? <Bag first={marked(i) === 'first'} /> : anyMark && <BagGap />}
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
