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
    // Two player slots per team; singles uses only the first.
    players: { a: ['Player 1', 'Player 2'], b: ['Player 1', 'Player 2'] },
    colors: { a: '#2f80ed', b: '#eb5757' },
    mode: 'singles',
    target,
    rounds: [],
    current: { a: emptyPositions(), b: emptyPositions() },
    // Team due to throw first this round; the team that scored last round throws
    // first next, so this updates on endRound and reverts on undoRound.
    nextFirst: 'a',
    winner: null,
  };
}

// Display name for a team: the single player, or both partners in doubles.
export function teamLabel(game, team) {
  const p = game.players[team];
  return game.mode === 'doubles' ? `${p[0]} & ${p[1]}` : p[0];
}

// Set the team due to throw first this round (initial coin toss / correction).
export function setFirst(game, team) {
  return { ...game, nextFirst: team };
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
