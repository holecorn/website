// Top-down view of the court: two boards, each flanked by its two pitcher's
// boxes. Read-only during play; the setup screen passes the handlers that make
// the arrangement adjustable.

import { courtPositions, otherSide } from './scoring.js';
import './Positions.css';

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
  const { ends, throwingEnd, first, walks } = courtPositions(game);
  const colors = game.colors;
  return (
    <div className="positions">
      <div className="court">
        <End data={ends[1]} place="far" colors={colors} first={first} />
        <div className="throw-dir" aria-hidden="true">
          {throwingEnd === 0 ? '▲' : '▼'}
        </div>
        <End data={ends[0]} place="near" colors={colors} first={first} />
      </div>
      <p className="positions-hint">
        {walks
          ? 'Both players walk to the other board after each round, keeping to their own side.'
          : 'Partners keep their board all game and swap boxes each time they throw.'}
      </p>
      {onSwapSides && (
        <div className="positions-actions">
          <button type="button" onClick={() => onSwapSides(otherSide(game.startSide))}>
            Swap sides
          </button>
          {!walks &&
            ['a', 'b'].map((team) => (
              <button
                key={team}
                type="button"
                style={{ color: colors[team] }}
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
