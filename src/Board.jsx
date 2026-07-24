// Per-bag scoring lanes. Each team has one lane per bag; a lane is a vertical
// track with three stops — hole (top, 3pts), board (1pt), floor (0pts). Bags
// start unthrown, shown greyed on the floor, until tapped into play. A thrown
// bag can be moved between stops but can't return to the unthrown state.

import { useState } from 'react';
import { rawPoints } from './scoring.js';

const STOPS_TOP_DOWN = ['hole', 'board', 'floor'];
const ROW = { hole: 0, board: 1, floor: 2, unthrown: 2 };
const SPARK_COUNT = 12;
const BIG_SPARK_COUNT = 28;

// Escalating haptic buzz as a team's bags stack up in the hole; a four-bagger
// gets a celebratory pattern.
const HOLE_HAPTIC = { 1: 25, 2: 40, 3: [30, 30, 60], 4: [0, 60, 40, 60, 40, 180] };

function buzz(count) {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(HOLE_HAPTIC[count] || 30);
  }
}

function sparkStyle(color, i, spread, whiteEvery) {
  const angle = (i / spread.count) * Math.PI * 2 + Math.random() * 0.6;
  const dist = spread.min + Math.random() * spread.range;
  return {
    background: i % whiteEvery === 0 ? '#fff' : color,
    '--tx': `${Math.cos(angle) * dist}px`,
    '--ty': `${Math.sin(angle) * dist}px`,
    animationDelay: `${Math.round(Math.random() * spread.delay)}ms`,
  };
}

function Sparkles({ color }) {
  const spread = { count: SPARK_COUNT, min: 24, range: 20, delay: 40 };
  return (
    <div className="sparkles" aria-hidden="true">
      {Array.from({ length: SPARK_COUNT }, (_, i) => (
        <span key={i} className="spark" style={sparkStyle(color, i, spread, 2)} />
      ))}
    </div>
  );
}

function FourBagger({ color }) {
  const spread = { count: BIG_SPARK_COUNT, min: 60, range: 90, delay: 90 };
  return (
    <div className="four-bagger" aria-hidden="true">
      <div className="four-text">FOUR BAGGER!</div>
      <div className="big-sparkles">
        {Array.from({ length: BIG_SPARK_COUNT }, (_, i) => (
          <span key={i} className="big-spark" style={sparkStyle(color, i, spread, 3)} />
        ))}
      </div>
    </div>
  );
}

// Bags in the hole only vibrate while every thrown bag is in the hole (a
// four-bagger is still alive), from two in the hole and ramping up from there.
function vibration(holeCount, allInHole) {
  if (!allInHole || holeCount < 2) return { amp: 0, dur: 180 };
  if (holeCount >= 4) return { amp: 2.8, dur: 90 };
  if (holeCount === 3) return { amp: 2.2, dur: 120 };
  return { amp: 1, dur: 180 };
}

function Lane({ tier, color, holeCount, vibe, disabled, onSet }) {
  const [burst, setBurst] = useState(0);

  const place = (t) => {
    if (t === 'hole' && tier !== 'hole') {
      setBurst((n) => n + 1);
      buzz(holeCount + 1);
    }
    onSet(t);
  };

  const inHole = tier === 'hole';
  const vibrating = inHole && vibe.amp > 0;
  return (
    <div className="lane">
      {STOPS_TOP_DOWN.map((t) => (
        <button
          key={t}
          className={`tier-zone tier-${t}`}
          disabled={disabled}
          onClick={() => place(t)}
          aria-label={`bag ${t}`}
        />
      ))}
      <div
        className={`bag-token${inHole ? ' in-hole' : ''}${
          vibrating ? ' vibrating' : ''
        }${tier === 'unthrown' ? ' unthrown' : ''}`}
        style={{
          background: color,
          top: `calc(${ROW[tier]} * (100% / 3) + 5px)`,
          '--amp': `${vibe.amp}px`,
          '--vdur': `${vibe.dur}ms`,
        }}
      />
      {burst > 0 && <Sparkles key={burst} color={color} />}
    </div>
  );
}

function TeamLanes({ team, name, positions, color, disabled, onSet, celebrateKey }) {
  const raw = rawPoints(positions);
  const holeCount = positions.filter((t) => t === 'hole').length;
  const thrownCount = positions.filter((t) => t !== 'unthrown').length;
  const allInHole = holeCount > 0 && holeCount === thrownCount;
  const vibe = vibration(holeCount, allInHole);
  return (
    <section className="team-lanes" style={{ '--team': color }}>
      <div className="lanes-header">
        <span className="lanes-team" style={{ color }}>
          {name}
        </span>
        <span className="lanes-raw">
          {raw} pt{raw === 1 ? '' : 's'} this round
        </span>
      </div>
      <div className="lanes-grid">
        <div className="tier-labels">
          <span>hole · 3</span>
          <span>board · 1</span>
          <span>floor · 0</span>
        </div>
        {positions.map((tier, i) => (
          <Lane
            key={i}
            tier={tier}
            color={color}
            holeCount={holeCount}
            vibe={vibe}
            disabled={disabled}
            onSet={(t) => onSet(team, i, t)}
          />
        ))}
      </div>
      {celebrateKey > 0 && <FourBagger key={celebrateKey} color={color} />}
    </section>
  );
}

export default function Board({ names, current, colors, disabled, onSet, fourBagger }) {
  const celebrateKey = (team) =>
    fourBagger && fourBagger.teams.includes(team) ? fourBagger.key : 0;
  return (
    <div className="scoring">
      <TeamLanes
        team="a"
        name={names.a}
        positions={current.a}
        color={colors.a}
        disabled={disabled}
        onSet={onSet}
        celebrateKey={celebrateKey('a')}
      />
      <TeamLanes
        team="b"
        name={names.b}
        positions={current.b}
        color={colors.b}
        disabled={disabled}
        onSet={onSet}
        celebrateKey={celebrateKey('b')}
      />
    </div>
  );
}
