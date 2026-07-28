// Top-down view of the court: two boards, each flanked by its two pitcher's
// boxes. Read-only during play; the setup screen passes the handlers that make
// the arrangement adjustable.

import { courtPositions, otherSide } from './scoring.js';
import './Positions.css';

const END_NAME = ['starting', 'far'];

// The diagram states everything through colour, border style and position, none
// of which survives being read aloud, so the panel carries the arrangement in
// prose as well and hides the drawing from assistive tech. Reading four names in
// DOM order would be worse than useless.
function spoken({ ends, throwingEnd, first }) {
  const at = (end) => ['left', 'right'].map((side) => ({ side, ...ends[end].boxes[side] }));
  const up = at(throwingEnd).filter((box) => box.name);
  const here = END_NAME[throwingEnd];
  const there = END_NAME[1 - throwingEnd];
  const boxes = up.map((box) => `${box.name} in the ${box.side} box`).join(' and ');
  const firstName = up.find((box) => box.team === first)?.name;
  const sentences = [
    `${boxes} at the ${here} board, throwing at the ${there} board.`,
    firstName ? `${firstName} throws first.` : null,
  ];
  const waiting = at(1 - throwingEnd).filter((box) => box.name);
  sentences.push(
    waiting.length > 0
      ? `${waiting.map((box) => box.name).join(' and ')} wait at the ${there} board and throw next round.`
      : `Both walk to the ${there} board after this round.`,
  );
  return sentences.filter(Boolean).join(' ');
}

function Box({ occupant, color, throwing, first }) {
  if (!occupant) return <div className="pitch-box is-empty" aria-hidden="true" />;
  return (
    <div
      className={`pitch-box${throwing ? ' is-throwing' : ' is-waiting'}${
        first ? ' is-first' : ''
      }`}
      style={{ '--team': color }}
    >
      <span className="box-name">{occupant.name}</span>
    </div>
  );
}

function End({ data, place, colors, first }) {
  const box = (side) => {
    const occupant = data.boxes[side];
    return (
      <Box
        occupant={occupant}
        color={occupant ? colors[occupant.team] : undefined}
        throwing={data.throwing}
        first={data.throwing && occupant?.team === first}
      />
    );
  };
  return (
    <div className={`court-end at-${place}`}>
      {box('left')}
      <div className="cornhole-board" aria-hidden="true">
        <span className="board-hole" />
      </div>
      {box('right')}
    </div>
  );
}

export default function Positions({ game, onSwapSides, onSwapEnds }) {
  const positions = courtPositions(game);
  const { ends, throwingEnd, first, walks } = positions;
  const colors = game.colors;
  return (
    <div className="positions">
      <p className="visually-hidden">{spoken(positions)}</p>
      <div className="court" aria-hidden="true">
        <End data={ends[1]} place="far" colors={colors} first={first} />
        <div className="throw-dir">{throwingEnd === 0 ? '▲' : '▼'}</div>
        <End data={ends[0]} place="near" colors={colors} first={first} />
      </div>
      <p className="positions-hint">
        {walks
          ? 'Both players walk to the other board after each round, keeping to their own side.'
          : 'Partners keep their board all game and swap boxes each time they throw.'}
      </p>
      {onSwapSides && (
        <div className="positions-actions">
          <button
            type="button"
            aria-label="Swap which side of the court each team takes"
            onClick={() => onSwapSides(otherSide(game.startSide))}
          >
            Swap sides
          </button>
          {!walks &&
            ['a', 'b'].map((team) => (
              <button
                key={team}
                type="button"
                style={{ color: colors[team] }}
                // The visible label is two names and an arrow, which reads as
                // nothing at all. It also changes who throws first, and that is
                // the part nobody expects.
                aria-label={`Swap boards for ${game.players[team][0]} and ${game.players[team][1]}, changing which of them throws first`}
                onClick={() => onSwapEnds(team)}
              >
                {game.players[team][0]} ⇄ {game.players[team][1]}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
