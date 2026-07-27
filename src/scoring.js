// Cornhole cancellation scoring. Pure functions, no React.
//
// Each team throws 4 bags per round. Bags start unthrown (shown greyed on the
// floor) and, once thrown, come to rest in one of three tiers: in the hole
// (3pts), on the board (1pt), or off on the floor (0pts). A thrown bag can move
// between those three tiers (it can be knocked around) but can never return to
// the unthrown state. Each round only the difference between the two teams' raw
// points is scored; the trailing team nets nothing. First to `target` wins.

export const TIER_POINTS = { unthrown: 0, floor: 0, board: 1, hole: 3 };
export const BAGS_PER_SIDE = 4;
export const DEFAULT_TARGET = 21;
// The external scoreboard renders two digits. Capping the target here rather
// than clamping in the display means the phone and the board can never disagree
// about the score.
export const MAX_TARGET = 99;

export function clampTarget(value, fallback = DEFAULT_TARGET) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, MAX_TARGET);
}

export function emptyPositions() {
  return Array(BAGS_PER_SIDE).fill('unthrown');
}

export function rawPoints(positions) {
  return positions.reduce((sum, tier) => sum + TIER_POINTS[tier], 0);
}

export function tierCounts(positions) {
  return positions.reduce(
    (counts, tier) => ({ ...counts, [tier]: counts[tier] + 1 }),
    { unthrown: 0, floor: 0, board: 0, hole: 0 },
  );
}

// Given both teams' bag positions for a round, return each team's net points.
export function roundNets(a, b) {
  const diff = rawPoints(a) - rawPoints(b);
  if (diff > 0) return { a: diff, b: 0 };
  if (diff < 0) return { a: 0, b: -diff };
  return { a: 0, b: 0 };
}

export function newGame(target = DEFAULT_TARGET) {
  return {
    // Two player slots per team; singles uses only the first. In doubles the
    // slot index is also the end of the court that player stands at, which is
    // why it is slot 0 that throws on even rounds.
    players: { a: ['Player 1', 'Player 2'], b: ['Player 1', 'Player 2'] },
    colors: { a: '#2f80ed', b: '#eb5757' },
    mode: 'singles',
    target,
    rounds: [],
    current: { a: emptyPositions(), b: emptyPositions() },
    // Team due to throw first this round; the team that scored last round throws
    // first next, so this updates on endRound and reverts on undoRound.
    nextFirst: 'a',
    // Which side of the court team A starts on — the one thing about where
    // people stand that can't be derived, because it anchors the rest to the
    // real court.
    startSide: 'left',
    winner: null,
  };
}

export const TEAM_JOIN = ' & ';

// Display name for a team: the single player, or both partners in doubles.
export function teamLabel(game, team) {
  const p = game.players[team];
  return game.mode === 'doubles' ? `${p[0]}${TEAM_JOIN}${p[1]}` : p[0];
}

// "Neil wins" but "Rho & Tau win". Read off the label rather than the mode,
// because the external display only ever receives the label — the scoreboard
// payload is byte-budgeted and carries no mode — and deriving both ends the
// same way is what stops the phone and the board disagreeing. The cost is that
// a singles player who puts " & " in their own name gets the plural.
export function winVerb(label) {
  return String(label ?? '').includes(TEAM_JOIN) ? 'win' : 'wins';
}

// Set the team due to throw first this round (initial coin toss / correction).
export function setFirst(game, team) {
  return { ...game, nextFirst: team };
}

export function otherSide(side) {
  return side === 'left' ? 'right' : 'left';
}

export function setStartSide(game, side) {
  return { ...game, startSide: side === 'right' ? 'right' : 'left' };
}

// Which side of the court team A occupies in a given round. Takes a round index
// rather than reading the live game, so a waiting end can be drawn as it will be
// when its turn comes.
function sideOfA(game, round) {
  const start = game.startSide === 'right' ? 'right' : 'left';
  // In doubles the two players at a board trade pitcher's boxes each time they
  // throw, and they only throw on alternate rounds, so the sides flip every
  // second round. In singles nobody changes box: both players walk down their
  // own side of the court and only the end they throw from changes.
  const swapped = game.mode === 'doubles' && Math.floor(round / 2) % 2 === 1;
  return swapped ? otherSide(start) : start;
}

// Derived from rounds.length alone, so it reverts with undoRound the same way
// the first thrower does. End 0 is the end play started from; in doubles it is
// also the slot index of the partner who stands there all game.
export function courtPositions(game) {
  const r = game.rounds.length;
  const throwingEnd = r % 2;
  const doubles = game.mode === 'doubles';
  const ends = [0, 1].map((end) => {
    const throwing = end === throwingEnd;
    // A waiting end shows where those players will stand when they next throw,
    // which is next round. Drawing them in this round's boxes would flip a row
    // that isn't going to move.
    const aSide = sideOfA(game, throwing ? r : r + 1);
    const slot = doubles ? end : 0;
    // In singles both players are at the throwing end, so the other end stands
    // empty until they walk down.
    const occupied = doubles || throwing;
    return {
      end,
      throwing,
      boxes: {
        [aSide]: occupied ? { team: 'a', name: game.players.a[slot] } : null,
        [otherSide(aSide)]: occupied
          ? { team: 'b', name: game.players.b[slot] }
          : null,
      },
    };
  });
  return { throwingEnd, first: game.nextFirst, walks: !doubles, ends };
}

export function totals(game) {
  return game.rounds.reduce(
    (acc, r) => ({ a: acc.a + r.nets.a, b: acc.b + r.nets.b }),
    { a: 0, b: 0 },
  );
}

function checkWinner(game) {
  const t = totals(game);
  if (t.a >= game.target) return 'a';
  if (t.b >= game.target) return 'b';
  return null;
}

// Move one bag (by index) to a tier in the current, uncommitted round. A thrown
// bag can never return to the unthrown state.
export function setBag(game, team, index, tier) {
  if (game.winner || tier === 'unthrown') return game;
  const positions = game.current[team].slice();
  positions[index] = tier;
  return {
    ...game,
    current: { ...game.current, [team]: positions },
  };
}

// Commit the current round, recompute totals, and detect a winner. The round
// keeps each team's per-bag positions so it can be restored by undoRound.
export function endRound(game) {
  if (game.winner) return game;
  const nets = roundNets(game.current.a, game.current.b);
  const round = {
    a: game.current.a.slice(),
    b: game.current.b.slice(),
    nets,
    first: game.nextFirst,
  };
  let nextFirst = game.nextFirst;
  if (nets.a > 0) nextFirst = 'a';
  else if (nets.b > 0) nextFirst = 'b';
  const next = {
    ...game,
    rounds: [...game.rounds, round],
    current: { a: emptyPositions(), b: emptyPositions() },
    nextFirst,
  };
  return { ...next, winner: checkWinner(next) };
}

// Undo the most recent committed round, restoring its bags to the board so it
// can be corrected and re-committed.
export function undoRound(game) {
  if (game.rounds.length === 0) return game;
  const last = game.rounds[game.rounds.length - 1];
  const rounds = game.rounds.slice(0, -1);
  const next = {
    ...game,
    rounds,
    current: { a: last.a.slice(), b: last.b.slice() },
    nextFirst: last.first ?? game.nextFirst,
    winner: null,
  };
  return { ...next, winner: checkWinner(next) };
}

// How many bags across both teams are still unthrown this round.
export function unthrownCount(game) {
  const count = (positions) => positions.filter((t) => t === 'unthrown').length;
  return count(game.current.a) + count(game.current.b);
}

// A round can only be ended once every bag has been classified (floor counts).
export function roundComplete(game) {
  return unthrownCount(game) === 0;
}
