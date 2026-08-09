// Top-down view of the court: a board flanked by its two pitcher's boxes, both
// ends of it or one. It shows who is standing where and nothing else — who throws first and
// which partner is at which board are set on the name fields, where the players
// are already listed in board order. The one exception is the starting board's
// swap control, because which side of the court a team takes isn't a property of
// a name and so has nowhere to live in the form.

import { courtPositions, otherSide } from './scoring.js';
import './Positions.css';

const END_NAME = ['starting', 'far'];

// The boxes state everything through colour, border style and position, none of
// which survives being read aloud, so the panel carries the arrangement in prose
// as well and hides the drawing from assistive tech. Reading four names in DOM
// order would be worse than useless.
function spoken({ ends, throwingEnd, first }, oneEnd) {
  const at = (end) => ['left', 'right'].map((side) => ({ side, ...ends[end].boxes[side] }));
  const up = at(throwingEnd).filter((box) => box.name);
  const here = END_NAME[throwingEnd];
  const there = END_NAME[1 - throwingEnd];
  const boxes = up.map((box) => `${box.name} in the ${box.side} box`).join(' and ');
  const firstName = up.find((box) => box.team === first)?.name;
  const sentences = [
    oneEnd
      ? `${boxes}, throwing at the board opposite.`
      : `${boxes} at the ${here} board, throwing at the ${there} board.`,
    firstName ? `${firstName} throws first.` : null,
  ];
  if (!oneEnd) {
    const waiting = at(1 - throwingEnd).filter((box) => box.name);
    sentences.push(
      waiting.length > 0
        ? `${waiting.map((box) => box.name).join(' and ')} wait at the ${there} board and throw next round.`
        : `Both walk to the ${there} board after this round.`,
    );
  }
  return sentences.filter(Boolean).join(' ');
}

function Box({ occupant, color, throwing, first }) {
  // aria-hidden sits on each box rather than on the whole court, so the board's
  // swap control can be a real button in an unhidden position.
  if (!occupant) return <div className="pitch-box is-empty" aria-hidden="true" />;
  return (
    <div
      className={`pitch-box${throwing ? ' is-throwing' : ' is-waiting'}${
        first ? ' is-first' : ''
      }`}
      style={{ '--team': color }}
      aria-hidden="true"
    >
      <span className="box-name">{occupant.name}</span>
    </div>
  );
}

function End({ data, place, colors, first, onSwapSides }) {
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
      {/* Empty but for the swap control, so it needs no aria-hidden of its own. */}
      <div className="cornhole-board">
        <span className="board-hole" />
        {onSwapSides && (
          <button
            type="button"
            className="swap-sides"
            aria-label="Swap which side of the court each team takes"
            onClick={onSwapSides}
          >
            ⇄
          </button>
        )}
      </div>
      {box('right')}
    </div>
  );
}

export default function Positions({ game, onSwapSides, setup }) {
  const positions = courtPositions(game);
  const { ends, throwingEnd, first, walks } = positions;
  const colors = game.colors;
  // Before the first round a singles court has nothing to say with two boards:
  // nobody changes box, so which end they start at isn't part of the arrangement
  // and the far one is an empty row. In play the ends alternate, so both stay.
  const oneEnd = setup && game.mode !== 'doubles';
  return (
    <div className="positions">
      <p className="visually-hidden">{spoken(positions, oneEnd)}</p>
      <div className="court">
        {/* Drawn first so a lone singles board has its hole at the top, which is
            where a cornhole board is recognisable. */}
        <End
          data={ends[0]}
          place="near"
          colors={colors}
          first={first}
          // The starting board carries it because startSide names that board.
          onSwapSides={onSwapSides && (() => onSwapSides(otherSide(game.startSide)))}
        />
        {!oneEnd && (
          <>
            <div className="throw-dir" aria-hidden="true">
              {throwingEnd === 0 ? '▼' : '▲'}
            </div>
            <End data={ends[1]} place="far" colors={colors} first={first} />
          </>
        )}
      </div>
      <p className="positions-hint">
        {walks
          ? 'Both players walk to the other board after each round, keeping to their own side.'
          : 'Partners keep their board all game and swap boxes each time they throw.'}
      </p>
    </div>
  );
}
