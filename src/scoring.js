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

// The colours a team can take. Here rather than in App.jsx because the panel
// emulator's splash picks two of them and the setup screen offers all four, so it is
// game data with two readers rather than one screen's list.
//
// Blue is lighter than the #2f80ed it started as. A team colour is also *text* — the
// lane header, the name input, the history cells, the toss line — and at those sizes
// it needs 4.5:1 against `--panel`, where the old value sat at 4.15. #448def is 4.81
// and is the smallest step that clears it. The other three already do. Changing one
// costs a matching edit to SPLASH_PALETTE in hub75.ino, which `npm run test:firmware`
// refuses to let you skip.
export const PALETTE = [
  { name: 'blue', value: '#448def' },
  { name: 'red', value: '#eb5757' },
  { name: 'green', value: '#27ae60' },
  { name: 'yellow', value: '#f2c94c' },
];

// Blue against red, which is what a game opens on and what every surface that can be
// asked to draw a team before there is a game falls back to — `Logo.jsx` with no props,
// `Display.jsx` with no payload yet. Those two held the hexes literally, so a team colour
// changed here left the wordmark and the board's cold-start drawing on the old one.
// Derived from the palette rather than written again for the same reason.
//
// **Not the reds in App.css, Stats.css and Tournament.css.** Those share `#eb5757` by
// coincidence — they are a UI accent, and they must not move when a team colour does.
export const DEFAULT_COLORS = { a: PALETTE[0].value, b: PALETTE[1].value };

export function newGame(target = DEFAULT_TARGET) {
  return {
    // Two player slots per team; singles uses only the first. In doubles the
    // slot index is also the end of the court that player stands at, which is
    // why it is slot 0 that throws on even rounds.
    //
    // Numbered across the lineup rather than within each team, because both
    // teams defaulting to the same two names is a lineup `lineupFaults`
    // refuses — the app would open on a game it would not let you start. The
    // odd/even split is what keeps singles reading "Player 1" against
    // "Player 2", which is the pairing seen most.
    players: { a: ['Player 1', 'Player 3'], b: ['Player 2', 'Player 4'] },
    colors: { ...DEFAULT_COLORS },
    mode: 'singles',
    // A game with guests in it: no names are taken and nothing is recorded. Not
    // a second value of `mode` — it is orthogonal to singles/doubles, and unlike
    // mode it changes nothing about scoring or where people stand.
    casual: false,
    // The tournament this game is a tie in, or null for an ordinary game. Unlike
    // `mode` and `casual` it is deliberately **not** sticky across `New game`: a
    // tournament runs over weeks, so a mode left on would still be on a fortnight
    // later and would file a friendly as a tie. It is set only by picking a tie off
    // the bracket, which is what makes that unreachable.
    tournament: null,
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

const isTeam = (team) => team === 'a' || team === 'b';

// One side's bags for one round. The length matters as much as the tiers: every
// surface indexes four lanes, so a short array draws a lane short of bags and a
// long one silently stops being scoreable by `rawPoints`.
function bagSide(list) {
  return (
    Array.isArray(list) &&
    list.length === BAGS_PER_SIDE &&
    list.every((tier) => Object.hasOwn(TIER_POINTS, tier))
  );
}

// Whether a stored game can actually be played. `loadGame` merges a save over
// `newGame()` before asking, so **absent is not the question** — a save that
// predates a field already has the default by the time this sees it, and the
// merge-on-load tolerance is untouched. What this catches is a field that is
// *present and the wrong shape*, which the merge happily copies over the default.
//
// Measured on the shapes a hand-edited or half-written save can hold: 18 of 43
// blanked the app, and every one of them stayed blank. The crash is during
// render, so the persist effect never runs and the bad value is never replaced —
// there is no reload that recovers, and no screen to clear the game from. That is
// why this refuses the whole game rather than repairing a field: the answer was
// always "start fresh", the `catch` above simply only asked it of JSON that
// wouldn't parse.
//
// The id is deliberately not required. It is added by `identified` *after* this
// runs, so a save from before matches had ids has none yet and must still load.
export function validGame(g) {
  return Boolean(
    g &&
      typeof g === 'object' &&
      nameSlots(g.players?.a) &&
      g.players.a.length === 2 &&
      nameSlots(g.players?.b) &&
      g.players.b.length === 2 &&
      typeof g.colors?.a === 'string' &&
      typeof g.colors?.b === 'string' &&
      (g.mode === 'singles' || g.mode === 'doubles') &&
      typeof g.casual === 'boolean' &&
      (g.tournament === null || typeof g.tournament === 'string') &&
      Number.isFinite(g.target) &&
      g.target >= 1 &&
      // Bounded as well as positive. Every dispatch goes through `clampTarget`, so a
      // live game cannot hold more — the tolerance this used to carry was for a save
      // written before `MAX_TARGET` existed, and there are none of those left.
      g.target <= MAX_TARGET &&
      bagSide(g.current?.a) &&
      bagSide(g.current?.b) &&
      Array.isArray(g.rounds) &&
      g.rounds.every(
        (r) =>
          bagSide(r?.a) &&
          bagSide(r?.b) &&
          Number.isFinite(r?.nets?.a) &&
          Number.isFinite(r?.nets?.b) &&
          // Optional, because rounds predate it and `undoRound` falls back — but a
          // bad one is restored *into* `nextFirst`, so it bricks one undo later.
          (r.first === undefined || isTeam(r.first)),
      ) &&
      isTeam(g.nextFirst) &&
      (g.winner === null || isTeam(g.winner)) &&
      (g.startSide === 'left' || g.startSide === 'right'),
  );
}

export const TEAM_JOIN = ' & ';

// Who a name refers to. Case and padding are folded, so "neil" and "Neil " are
// one person. This is the only identity the app records — which is why renaming
// someone is a sweep over stored names rather than a key change — and it lives
// here so the career fold, the setup fields and the archive rewrite cannot
// disagree about whether two spellings are the same person.
export function nameKey(name) {
  return String(name ?? '').trim().toLowerCase();
}

// A team's player slots. The *element* types matter as much as the array:
// `nameKey` coerces, so a slot holding a number or an object keys truthily and
// every name-folding read then trips over it. An empty slot is still a string,
// so singles records are unaffected.
//
// Here rather than in archive.js because a live game and an archived record are
// the same lineup shape, and `validGame` and `validRecord` disagreeing about what
// a name slot is would let one accept what the other rejects.
export function nameSlots(list) {
  return Array.isArray(list) && list.every((n) => typeof n === 'string');
}

// A side with nobody identifiable on it. Not a real side: `sideRecord` reports no
// matchup for one and a tournament cannot seat one.
export const NO_SIDE = '[]';

// Who a *side* is, the way `nameKey` says who a person is: the set of people on it,
// so the same two players are the same side whichever team letter they held and
// whichever order they were entered in. It takes names rather than a match because a
// tournament's entrants are bare sides that have not played yet — `stats.js` wraps it
// with `rosterFor` for the match-shaped case.
//
// Here rather than in stats.js for the reason `nameKey` is here: the career fold, the
// head-to-head pairs and the bracket all have to agree about what "the same side"
// means, and two definitions of that is the failure with no symptom.
export function sideKeyOf(names) {
  const keys = (names ?? []).map(nameKey).filter(Boolean);
  return JSON.stringify([...new Set(keys)].sort());
}

// Which board a player slot stands at. The slot index *is* the end in doubles,
// so this is the only name those positions have; exported rather than held in
// App.jsx because the stats screen labels an archived lineup with it too.
export const BOARD_NAME = ['start', 'far'];

// The palette entry a team's bags are, titled for display. The swatches disable
// the colour the other team holds, so two teams can never share one and a colour
// name is always an unambiguous label; a value off the palette can only come from
// a hand-edited save, which falls back to the team letter.
function colorName(game, team) {
  const found = PALETTE.find((c) => c.value === game.colors[team]);
  return found
    ? found.name[0].toUpperCase() + found.name.slice(1)
    : `Team ${team.toUpperCase()}`;
}

// What a player slot is called, and the only place a casual game differs from any
// other: nobody's name was taken, so the colour is the identity. Everything that
// names a player has to read it from here or it will be the one surface still
// showing "Player 1".
//
// `players` keeps whatever was typed, so turning casual off brings the names back
// rather than having overwritten them.
export function playerLabel(game, team, slot) {
  return game.casual ? colorName(game, team) : game.players[team][slot];
}

// Why this lineup can't be played, one entry per slot at fault:
//
//   'twice' — a name is the only identity the app has, so one name in two slots
//     is one person on both sides of the court. `playerStats` folds a win and a
//     loss for the same match into one career, `sideRecord` reports no matchup at
//     all, and in doubles somebody is their own partner.
//   'blank' — a nameless slot is not a person either, so `participants` drops it
//     and `playerStats` credits its throws to nobody. The rounds are archived and
//     the numbers go nowhere, which is worse than either being told or losing the
//     match, because nothing says it happened.
//
// Per slot rather than per name because both the button and the fields need this:
// the hint says which name, the fields say which two boxes. Only the slots the
// mode plays, so an unused doubles partner is nobody's problem.
//
// A casual game has no faults to find: every slot is the team's colour, and
// `players` still holds whatever the last real game typed.
export function lineupFaults(game) {
  if (game.casual) return [];
  const slots = [];
  const counts = new Map();
  for (const team of ['a', 'b']) {
    for (const slot of game.mode === 'doubles' ? [0, 1] : [0]) {
      const name = String(game.players[team][slot] ?? '').trim();
      const key = nameKey(name);
      slots.push({ team, slot, name, key });
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  // Which fault reads off the key, not off the count, so two blank slots are two
  // missing names rather than one nameless person entered twice.
  return slots
    .filter(({ key }) => !key || counts.get(key) > 1)
    .map(({ team, slot, name, key }) => ({ team, slot, name, fault: key ? 'twice' : 'blank' }));
}

// `winVerb` and the panel's `splitPair` both tell a pair from one person by looking
// for TEAM_JOIN in the label, so nothing inside a name may look like the join and
// "Ben & Jerry" is written "Ben&Jerry". Labels only: `players` and the archive keep
// the real spelling.
const withoutJoin = (name) => String(name ?? '').replace(/\s*&\s*/g, '&');

// How a side is written as one label, in one place because several callers join names
// and two spellings of the rule above would hold it on some screens and not others.
export function sideLabel(names) {
  return (names ?? []).map(withoutJoin).join(TEAM_JOIN);
}

// The two halves of a joined label, or null when it names one person. `splitPair` in
// render.h does the same over bytes, for a board that shortens each half; this is the
// rule for a screen that draws the label whole. Exact rather than a guess for the same
// reason `winVerb` is: `sideLabel` keeps the join out of the names it joins.
export function splitLabel(label) {
  const text = String(label ?? '');
  const at = text.indexOf(TEAM_JOIN);
  return at < 0 ? null : [text.slice(0, at), text.slice(at + TEAM_JOIN.length)];
}

// Display name for a team: the single player, or both partners in doubles.
export function teamLabel(game, team) {
  // One label per team in casual even in doubles: the colour is the whole
  // identity, so "Blue" rather than "Blue & Blue". `winVerb` keys off TEAM_JOIN
  // being in the label, so a casual pair reads "Blue wins" — which is right for
  // a team name, and is the one place casual diverges from the doubles plural.
  if (game.casual) return playerLabel(game, team, 0);
  const p = game.players[team];
  // Both slots whatever they hold, so a blank partner still leaves the join for
  // `labelPart` to find an empty half in; only the tournament filters blanks.
  return sideLabel(game.mode === 'doubles' ? [p[0], p[1]] : [p[0]]);
}

// "Neil wins" but "Rho & Tau win". Read off the label rather than the mode,
// because the external display only ever receives the label — the scoreboard
// payload is byte-budgeted and carries no mode — and deriving both ends the
// same way is what stops the phone and the board disagreeing. Exact rather than a
// guess, because `sideLabel` keeps the join out of the names it joins.
export function winVerb(label) {
  return String(label ?? '').includes(TEAM_JOIN) ? 'win' : 'wins';
}

// Set the team due to throw first this round (initial coin toss / correction).
export function setFirst(game, team) {
  return { ...game, nextFirst: team };
}

// Which partner stands at which end is the order of the players array, because
// slot 0 throws even rounds. Setup-screen only: committed rounds are attributed
// by slot, so a swap mid-game would silently re-credit them.
export function swapEnds(game, team) {
  const [near, far] = game.players[team];
  return { ...game, players: { ...game.players, [team]: [far, near] } };
}

// Name the player who throws the opening bag. That is two facts rather than one:
// their team leads, and in doubles they have to be standing where slot 0 stands,
// so choosing the far partner swaps the pair's ends. Only meaningful before the
// first round, when the throwing end is 0 — which is also the only screen that
// may reorder slots.
export function throwFirst(game, team, slot) {
  return setFirst(slot === 1 ? swapEnds(game, team) : game, team);
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
        [aSide]: occupied ? { team: 'a', slot, name: playerLabel(game, 'a', slot) } : null,
        [otherSide(aSide)]: occupied
          ? { team: 'b', slot, name: playerLabel(game, 'b', slot) }
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

// Where the game stands after the last committed round, for the play screen's live
// region. Derived from `rounds` rather than remembered from the press, the way
// `.toss-result` is, so undo walks it back and a game adopted from another tab
// describes itself rather than the round this tab last saw.
export function roundReport(game) {
  const n = game.rounds.length;
  if (n === 0) return '';
  const last = game.rounds[n - 1];
  const t = totals(game);
  const scorer = last.nets.a > 0 ? 'a' : last.nets.b > 0 ? 'b' : null;
  const parts = [
    scorer
      ? `Round ${n}: ${teamLabel(game, scorer)} scored ${last.nets[scorer]}.`
      : `Round ${n}: wash.`,
  ];
  // Unnamed on purpose: four in the hole is 12 raw and only another four bagger can
  // match it, so one belongs to the side just named and two can only be the wash.
  const fours = ['a', 'b'].filter((tm) => tierCounts(last[tm]).hole === BAGS_PER_SIDE).length;
  if (fours > 0) parts.push(fours > 1 ? 'Four baggers!' : 'Four bagger!');
  if (game.winner) {
    const won = teamLabel(game, game.winner);
    const lost = game.winner === 'a' ? t.b : t.a;
    parts.push(`${won} ${winVerb(won)}, ${t[game.winner]} to ${lost}.`);
    if (lost === 0) parts.push('Skunk!');
  } else {
    parts.push(`${teamLabel(game, 'a')} ${t.a}, ${teamLabel(game, 'b')} ${t.b}.`);
  }
  return parts.join(' ');
}

// One team's half of a history row, said out loud. The visible cell is `2◎ 2▬ → +0`
// and the two teams' cells are byte-identical on a wash, so before this the row read
// as two anonymous runs of glyph names with the colour — the only thing telling them
// apart — carrying nothing into speech. Names the team rather than leaning on the
// column header, because a header is only reliably announced when someone navigates
// cell by cell, and the row is read straight through far more often than that.
export function roundLine(game, round, team) {
  const c = tierCounts(round[team]);
  const on = [c.hole && `${c.hole} in the hole`, c.board && `${c.board} on the board`].filter(Boolean);
  const net = round.nets[team];
  return `${teamLabel(game, team)}: ${on.length ? on.join(', ') : 'nothing on'}, ${
    net > 0 ? `scored ${net}` : 'no points'
  }.`;
}

// Whether a bag has been thrown yet. Lives here rather than in App.jsx because
// the scoreboard needs it too: the pre-game form screen is published while this
// is false, so "the game has begun" has to mean the same thing to both.
export function gameStarted(game) {
  return (
    game.rounds.length > 0 ||
    [...game.current.a, ...game.current.b].some((tier) => tier !== 'unthrown')
  );
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

// Deliberately not a commit: a bag you forgot to score has to stay visible and
// movable until you end the round yourself. Unchanged when there is nothing to
// place, so the reducer bails rather than re-rendering.
export function restOnFloor(game) {
  if (game.winner || unthrownCount(game) === 0) return game;
  const fill = (positions) => positions.map((t) => (t === 'unthrown' ? 'floor' : t));
  return { ...game, current: { a: fill(game.current.a), b: fill(game.current.b) } };
}
