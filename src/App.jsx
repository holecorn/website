import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import Board from './Board.jsx';
import GameStats from './GameStats.jsx';
import Lineup from './Lineup.jsx';
import Logo from './Logo.jsx';
import Positions from './Positions.jsx';
import ScoreboardSettings from './ScoreboardSettings.jsx';
import Stats from './Stats.jsx';
import Tournament from './Tournament.jsx';
import {
  archiveMatch,
  dropMatch,
  loadArchive,
  newMatchId,
  requestPersistence,
} from './archive.js';
import {
  LAYOUT_LABELS,
  loadScoreboardConfig,
  normalizeLayout,
  saveScoreboardConfig,
} from './scoreboard.js';
import { useScoreboardPublisher } from './useScoreboard.js';
import { PANEL_LAYOUTS } from './panelRender.js';
import {
  BOARD_NAME,
  MAX_TARGET,
  PALETTE,
  clampTarget,
  lineupFaults,
  nameKey,
  newGame,
  playerLabel,
  restOnFloor,
  setBag,
  throwFirst,
  swapEnds,
  setStartSide,
  courtPositions,
  endRound,
  gameStarted,
  undoRound,
  totals,
  roundNets,
  roundComplete,
  roundReport,
  roundLine,
  unthrownCount,
  tierCounts,
  teamLabel,
  validGame,
  winVerb,
} from './scoring.js';
import {
  bracket,
  dropTournament,
  levelName,
  loadTournaments,
  saveTournament,
  seriesHistory,
  tieFor,
  tieSetup,
} from './tournament.js';
import { loadInactive, offerableNames } from './inactive.js';
import { NAME_FIELD } from './nameField.js';
import { useWakeLock } from './useWakeLock.js';
import './App.css';

const STORAGE_KEY = 'holecorn.game.v3';

// How long the toss withholds its result. Long enough to read as a decision being
// made rather than a flicker, short enough that settling an argument by tossing
// twice doesn't feel gated.
const TOSS_MS = 500;

// A match needs an identity before it can be archived. It lives here rather
// than in scoring.js, which stays pure — an id is not a scoring concern — and
// is added on load as well as on creation, so a game saved without one still
// gets archived.
function identified(game) {
  // A non-string id is no id. It survives to the archive otherwise, where
  // `validRecord` rejects the record on the way out to a file and `upsertMatch`
  // can't find it — a match that exists locally and cannot be exported.
  return typeof game.id === 'string' && game.id ? game : { ...game, id: newMatchId() };
}

// Both teams used to default to Player 1 and Player 2, which `duplicateNames`
// now refuses. Nobody typed those, so a slot still holding one takes the name it
// would have had today; anything typed is left alone.
const OLD_DEFAULTS = ['Player 1', 'Player 2'];

function migrateDefaults(players) {
  const fresh = newGame().players;
  const swap = (team) =>
    players[team].map((name, i) => (name === OLD_DEFAULTS[i] ? fresh[team][i] : name));
  return { a: swap('a'), b: swap('b') };
}

function loadGame() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Merge over defaults so games saved before a field existed still load.
      const merged = { ...newGame(), ...parsed };
      // Migrate the old single-name-per-team shape to player slots.
      if (!parsed.players && parsed.names) {
        merged.players = {
          a: [parsed.names.a, merged.players.a[1]],
          b: [parsed.names.b, merged.players.b[1]],
        };
      }
      merged.players = migrateDefaults(merged.players);
      delete merged.names;
      // Asked after the merge and the migrations, so absent fields have already
      // been filled and only a value that is present and wrong gets here. A game
      // that can't be played blanks the app *permanently* — the crash is during
      // render, so nothing ever writes the bad value back out. See `validGame`.
      if (validGame(merged)) return identified(merged);
    }
  } catch {
    // ignore corrupt state and start fresh
  }
  return identified(newGame());
}

function winBuzz() {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate([0, 70, 50, 70, 50, 220]);
  }
}

function fourBaggerBuzz() {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate([0, 50, 40, 50, 40, 160]);
  }
}

function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

function reducer(game, action) {
  switch (action.type) {
    case 'set':
      return setBag(game, action.team, action.index, action.tier);
    case 'restFloor':
      return restOnFloor(game);
    case 'throwFirst':
      return throwFirst(game, action.team, action.slot);
    case 'setStartSide':
      return setStartSide(game, action.side);
    case 'swapEnds':
      return swapEnds(game, action.team);
    case 'endRound':
      return endRound(game);
    case 'undoRound':
      return undoRound(game);
    case 'rename': {
      const players = game.players[action.team].slice();
      players[action.index] = action.name;
      return { ...game, players: { ...game.players, [action.team]: players } };
    }
    case 'renamePlayer': {
      // Only the lineup waiting on the setup screen, so a corrected spelling
      // doesn't come back with the next game; the caller rewrites the archive.
      // Guarded on the game being unstarted rather than trusted to the caller:
      // renaming a slot mid-game would move rounds already committed to it,
      // since `throwerFor` credits them by slot.
      if (gameStarted(game)) return game;
      const key = nameKey(action.from);
      const to = String(action.to ?? '').trim();
      if (!key || !to) return game;
      const swap = (names) => names.map((n) => (nameKey(n) === key ? to : n));
      return { ...game, players: { a: swap(game.players.a), b: swap(game.players.b) } };
    }
    // What another tab has made of the same game. The caller has already put it
    // through `loadGame`, so an adopted game gets exactly the merge and migration a
    // reload would: adopting *is* the reload, without reloading.
    case 'adopt':
      return action.game;
    case 'setColor':
      return { ...game, colors: { ...game.colors, [action.team]: action.value } };
    case 'setMode':
      return { ...game, mode: action.mode };
    case 'setCasual':
      // Setup only, the same reasoning as the arrangement controls: flipping it
      // after a win would strand a record the archive effect can no longer see to
      // remove, and flipping it mid-game would rename every committed round.
      return gameStarted(game) ? game : { ...game, casual: action.value };
    // Put a tie back and go on playing something else. Only before a bag is thrown,
    // the same gate `setCasual` has and for the same reason: once rounds are committed
    // the game is on its way to the archive, and untagging it there would take the tie
    // out of its bracket while leaving the record behind.
    //
    // The lineup stays. It is two people who were about to play, which is a reasonable
    // thing to start an ordinary game from, and clearing it would be destroying
    // something to make a point.
    case 'clearTie':
      return gameStarted(game) ? game : { ...game, tournament: null };
    case 'setTarget':
      return { ...game, target: action.value };
    case 'start':
      // Timed from pressing Start game, not from `newGame`, which would count
      // however long the setup screen sat open. Idempotent, so reopening a game
      // already in progress doesn't move when it began.
      return game.startedAt ? game : { ...game, startedAt: action.at };
    case 'newGame':
      // Keep the same teams (players, colours, mode, target, where they stand);
      // clear the score.
      return identified({
        ...newGame(game.target),
        players: game.players,
        colors: game.colors,
        mode: game.mode,
        // Carried like the mode, because guests arrive in runs. Safe to make
        // sticky only because every New game lands back on setup with the toggle
        // in view: a run of casual games can't quietly outlast the guests.
        casual: game.casual,
        startSide: game.startSide,
        // `tournament` is deliberately absent from this list, so `newGame()`'s null
        // stands: a tournament runs over weeks, and a tie-ness left switched on would
        // file the next friendly as a tie. The only way to set it is to pick a tie off
        // the bracket.
      });
    // A tie off the bracket: the two sides, the mode and target the tournament was
    // drawn with, and the id `matchRecord` stamps. The names are then fixed for the
    // game, which is what makes a mis-typed tie unreachable rather than discouraged.
    case 'playTie':
      return identified({
        ...newGame(action.setup.target),
        colors: game.colors,
        startSide: game.startSide,
        ...action.setup,
      });
    default:
      return game;
  }
}

export default function App() {
  const [game, dispatch] = useReducer(reducer, undefined, loadGame);
  const [screen, setScreen] = useState(() => (gameStarted(game) ? 'play' : 'setup'));
  const [showHistory, setShowHistory] = useState(false);
  const [showPositions, setShowPositions] = useState(false);
  const [showGameStats, setShowGameStats] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [callout, setCallout] = useState(null);
  const [fourBagger, setFourBagger] = useState(null);
  const [targetStr, setTargetStr] = useState(String(game.target));
  const [sbConfig, setSbConfig] = useState(loadScoreboardConfig);
  const [persisted, setPersisted] = useState(null);
  // Whether the last attempt to save the game got through. See the effect below.
  const [saveFailed, setSaveFailed] = useState(false);
  // Held here rather than only inside Stats, because the pre-game form panel and
  // the scoreboard publisher both read it and both live above that screen.
  const [matches, setMatches] = useState(loadArchive);
  // Held here rather than only inside the tournament screen, because a tie's banner needs
  // the tournament it belongs to and Import writes them from the stats screen.
  const [tournaments, setTournaments] = useState(loadTournaments);
  // Who has stopped playing. Here for the same reason as the two above: it is set on the
  // stats screen and read by the two screens that offer names.
  const [inactive, setInactive] = useState(loadInactive);
  const confirmDialog = useRef(null);
  const prevRoundCount = useRef(game.rounds.length);
  const archivedId = useRef(null);
  // What this tab believes storage holds for the game. Both effects below maintain
  // it, and between them it is what keeps two tabs from writing at each other.
  const savedRaw = useRef(null);

  // Guarded like every other write in the app, and for a sharper reason than the
  // rest: an uncaught throw in a passive effect unmounts the React root, and
  // nothing renders `<App/>` inside a boundary — so a blocked or full
  // localStorage was a permanently blank page rather than a game that doesn't
  // persist. Storage blocked outright (Safari's "Block All Cookies") blanks it on
  // the first load; a full one blanks it at **End round**, taking the round with it.
  //
  // Said out loud rather than swallowed: the game itself is fine, it is all in
  // memory, but a reload will lose it and that has no other symptom.
  useEffect(() => {
    const raw = JSON.stringify(game);
    // Already what this tab put there — writing it again would only wake the other
    // tabs' listeners below, and they would write it straight back.
    if (raw === savedRaw.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, raw);
      savedRaw.current = raw;
      setSaveFailed(false);
    } catch {
      setSaveFailed(true);
    }
  }, [game]);

  // One game, one origin, and a second tab holding its own copy of it. Without this the
  // *stale* copy wins, because it writes last: measured, a tab left on setup from last
  // week plus one keystroke in a name field overwrote three committed rounds with zero,
  // and the tab actually being played reloaded to an empty setup screen. A second tab is
  // ordinary here — iOS Safari keeps them for months and `?display=1` shares the origin.
  //
  // So a tab that did not do the writing re-reads rather than holding on. `storage` is
  // the live signal; `visibilitychange` covers the tab that was frozen or in the
  // back/forward cache while the writes happened and so was never sent them.
  //
  // The screen follows unconditionally, including off `stats`, to keep the invariant the
  // rest of the file leans on: setup means a game that has not started. Lose it and the
  // setup name fields, which dispatch the unguarded `rename`, re-credit committed rounds.
  useEffect(() => {
    const adopt = () => {
      let raw = null;
      try {
        raw = localStorage.getItem(STORAGE_KEY);
      } catch {
        return;
      }
      if (raw === null || raw === savedRaw.current) return;
      savedRaw.current = raw;
      const next = loadGame();
      // No round was committed here, so the callout effect must not replay one: a stale
      // tab catching up five rounds would flash GAME! for a round it never saw.
      prevRoundCount.current = next.rounds.length;
      setTargetStr(String(next.target));
      setScreen(gameStarted(next) ? 'play' : 'setup');
      dispatch({ type: 'adopt', game: next });
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') adopt();
    };
    window.addEventListener('storage', adopt);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('storage', adopt);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // A match joins the archive the moment it is won, and leaves again if the
  // winning round is undone. Comparing against the id rather than a flag keeps
  // it to one write per outcome: a reload re-commits the same record instead of
  // a second copy, and starting a new game is simply a different id.
  useEffect(() => {
    // A casual game is never recorded: no names were taken, so filing it would
    // fold every guest into one career under whatever the slots happen to hold.
    if (game.casual) return;
    if (game.winner) {
      if (archivedId.current !== game.id) {
        // Set from what was just written rather than re-read, so the form panel
        // and the board have the match the moment it is filed. `stored` is what
        // storage actually holds, so a write that failed leaves the panel and the
        // board reporting the history that is really there.
        const write = archiveMatch(game, Date.now());
        setMatches(write.stored);
        // Only latched on a write that got through, so the match is still filed on
        // the next load — the retry path this effect archives on mount for.
        if (write.saved) archivedId.current = game.id;
        else setSaveFailed(true);
      }
    } else if (archivedId.current === game.id) {
      const write = dropMatch(game.id);
      setMatches(write.stored);
      if (write.saved) archivedId.current = null;
      else setSaveFailed(true);
    }
  }, [game]);

  useEffect(() => {
    saveScoreboardConfig(sbConfig);
  }, [sbConfig]);

  // Asked for at launch rather than when the stats screen is opened: the grant
  // is what keeps the archive from being evicted, so it has to be in place
  // before there is anything to lose.
  useEffect(() => {
    let live = true;
    requestPersistence().then((ok) => {
      if (live) setPersisted(ok);
    });
    return () => {
      live = false;
    };
  }, []);

  // The tie this game is. Nothing on the game says which one — the bracket works it
  // out from the two sides — so this is a derivation, and it is memoised because it
  // rebuilds a whole bracket from the archive on a render that happens per bag.
  const liveTournament = useMemo(
    () => tournaments.find((t) => t.id === game.tournament) ?? null,
    [tournaments, game.tournament],
  );
  const liveView = useMemo(
    () => (liveTournament ? bracket(liveTournament, matches) : null),
    [liveTournament, matches],
  );
  const playingTie = useMemo(() => tieFor(liveView, game), [liveView, game]);
  // The history the pre-game form is read against: the whole archive for an ordinary
  // game, and this cup's series for a tie — see `seriesHistory`. Null off a tie, which
  // is what leaves the panel and the board on the career numbers.
  //
  // The panel and the board are handed the *same* pool deliberately. The scoreboard has
  // always drawn its own version of this panel from the same fold, and two answers to
  // "how has this side gone" sitting a metre apart is the disagreement nobody can
  // resolve from either surface.
  const series = useMemo(
    () => (liveTournament ? seriesHistory(tournaments, liveTournament, matches) : null),
    [tournaments, liveTournament, matches],
  );
  const formMatches = series ? series.matches : matches;
  // What the board is told: the cup and the round, and no names — the two sides are
  // already in the score payload as joined labels.
  const publishedTie = useMemo(
    () =>
      liveTournament && playingTie
        ? { name: liveTournament.name, round: levelName(playingTie.level, liveView.shape) }
        : null,
    [liveTournament, playingTie, liveView],
  );
  // A tie of a tournament that is no longer there is not a tie. Abandoning a cup with one
  // of its ties set up otherwise leaves the setup screen banner naming nothing, with the
  // names, mode and target still locked by a draw that no longer exists, and the banner's own
  // button the only way out of a state nobody chose. Written as a repair on the derivation rather
  // than as a line in the drop handler so it also rescues a game *already* saved in that
  // state, which the delete that stranded it cannot come back to fix.
  useEffect(() => {
    if (game.tournament && !liveTournament) dispatch({ type: 'clearTie' });
  }, [game.tournament, liveTournament]);

  // The pull of the tournament draw currently on the board, or null. Held here rather
  // than inside the tournament screen because the publisher lives above it — the same
  // reason the archive does. `setDrawReveal` is handed down directly, so the effect that
  // publishes it is not re-armed on every render of the screen holding it.
  const [drawReveal, setDrawReveal] = useState(null);

  const scoreboard = useScoreboardPublisher(
    game,
    sbConfig,
    formMatches,
    publishedTie,
    drawReveal,
  );

  // Flash a cornhole callout when a round is committed: WASH on a tie, GAME on
  // the winning throw, SKUNK when the loser is left on zero.
  useEffect(() => {
    const count = game.rounds.length;
    if (count > prevRoundCount.current) {
      const last = game.rounds[count - 1];
      const fbTeams = ['a', 'b'].filter((tm) => tierCounts(last[tm]).hole === 4);
      if (fbTeams.length > 0) {
        setFourBagger({ key: count, teams: fbTeams });
        fourBaggerBuzz();
      }
      if (game.winner) {
        const final = totals(game);
        const loserTotal = game.winner === 'a' ? final.b : final.a;
        const skunk = loserTotal === 0;
        setCallout({
          key: count,
          text: skunk ? 'SKUNK!' : 'GAME!',
          color: game.colors[game.winner],
          win: true,
          confetti: skunk ? 70 : 44,
        });
        winBuzz();
      } else if (last.nets.a === 0 && last.nets.b === 0) {
        setCallout({ key: count, text: 'WASH!', color: '#cfd8e3', win: false });
      }
    }
    prevRoundCount.current = count;
  }, [game]);

  // Clear a callout after it has played (win callouts run longer for the
  // confetti). Also handles New game clearing it via setCallout(null).
  useEffect(() => {
    if (!callout) return undefined;
    const id = setTimeout(() => setCallout(null), callout.win ? 2600 : 1800);
    return () => clearTimeout(id);
  }, [callout]);

  useEffect(() => {
    if (!fourBagger) return undefined;
    const id = setTimeout(() => setFourBagger(null), 1600);
    return () => clearTimeout(id);
  }, [fourBagger]);

  useEffect(() => {
    const dialog = confirmDialog.current;
    if (!dialog) return;
    if (confirm && !dialog.open) dialog.showModal();
    if (!confirm && dialog.open) dialog.close();
  }, [confirm]);

  // The lanes only. A phone on setup or reading career stats indoors should sleep like
  // any other page; it is the round-by-round unlocking that this is for.
  useWakeLock(screen === 'play');

  // Must stay identical to the wide tier's query in App.css: this decides whether
  // the rail's panels render at all, and that file decides where they go. The
  // min-height excludes it from short landscape phones, which the compact tier
  // already lays out its own way.
  const wideLayout = useMediaQuery(
    '(min-width: 900px) and (orientation: landscape) and (min-height: 451px)',
  );
  const colors = game.colors;
  const doubles = game.mode === 'doubles';
  // Which partner is up is which end is throwing. Reading it from the same place
  // the court does keeps one definition of the parity, so the lanes and the
  // diagram can't disagree about who is throwing.
  const activeIdx = doubles ? courtPositions(game).throwingEnd : 0;
  // One row per team in casual even in doubles: both partners carry the same colour
  // label, so a second row would be the same word dimmed. Which of them is up is
  // left to the court diagram, which says it by position rather than by name.
  const teamPlayers = (team) =>
    doubles && !game.casual
      ? [0, 1].map((i) => playerLabel(game, team, i))
      : [playerLabel(game, team, 0)];
  const laneName = (team) => playerLabel(game, team, doubles ? activeIdx : 0);
  const t = totals(game);
  const preview = roundNets(game.current.a, game.current.b);
  const remaining = unthrownCount(game);
  const complete = roundComplete(game);
  const currentRoundStarted = [...game.current.a, ...game.current.b].some(
    (tier) => tier !== 'unthrown',
  );
  const winnerLabel = game.winner ? teamLabel(game, game.winner) : '';
  // Only a game still in progress has anything to lose: a won game is over and the
  // archive already has it. One fact, so a button reading `Abandon game` cannot be
  // the one that goes straight through.
  const abandoning = gameStarted(game) && !game.winner;

  const startNewGame = () => {
    const toSetup = () => {
      dispatch({ type: 'newGame' });
      setCallout(null);
      setFourBagger(null);
      setScreen('setup');
    };
    if (abandoning) {
      setConfirm({
        title: 'Abandon this game?',
        body: 'The scores are cleared and nothing is recorded.',
        confirmLabel: 'Abandon game',
        onConfirm: toSetup,
      });
    } else {
      toSetup();
    }
  };

  const undoLastRound = () => {
    if (currentRoundStarted) {
      setConfirm({
        title: 'Undo the last round?',
        body: "The bags you've placed this round will be replaced with the previous round's.",
        confirmLabel: 'Undo round',
        onConfirm: () => dispatch({ type: 'undoRound' }),
      });
    } else {
      dispatch({ type: 'undoRound' });
    }
  };

  // What the setup fields and the whole tournament draw screen offer from. The
  // derivation is `offerableNames` rather than anything of this file's, so the inactive
  // filter cannot be left off by a surface that builds its own list — there is no
  // unfiltered version to build. It only ever removes a *suggestion*: every name is
  // still accepted if it is typed, and playing takes the mark off again.
  const knownNames = useMemo(() => offerableNames(matches, inactive), [matches, inactive]);

  if (screen === 'tournament') {
    // `onCreate` and `onDrop` report whether the write got through, because the screen
    // sets state from the result: a bracket drawn from a write that failed reads as
    // random and final, is playable, and is gone on the next load.
    return (
      <Tournament
        tournaments={tournaments}
        matches={matches}
        knownNames={knownNames}
        onBack={() => setScreen('setup')}
        onCreate={(t) => {
          const write = saveTournament(t);
          setTournaments(write.stored);
          return write.saved;
        }}
        onDrop={(t) => {
          const write = dropTournament(t.id);
          setTournaments(write.stored);
          return write.saved;
        }}
        onReveal={setDrawReveal}
        onPlayTie={(t, tie) => {
          dispatch({ type: 'playTie', setup: tieSetup(t, tie) });
          setScreen('setup');
        }}
      />
    );
  }

  if (screen === 'stats') {
    // Stats owns its own copy while it is open, because it deletes, restores and
    // imports; re-reading on the way out is what keeps the form panel and the
    // board from reporting matches that have since been deleted.
    return (
      <Stats
        onBack={() => {
          // Tournaments and the inactive marks as well as matches: Import writes all
          // three, and anything in storage but not in state is invisible until a
          // reload — a bracket the setup button cannot announce, or somebody still
          // being offered by the fields after being marked as gone.
          setMatches(loadArchive());
          setTournaments(loadTournaments());
          setInactive(loadInactive());
          setScreen('setup');
        }}
        persisted={persisted}
        onRenamePlayer={(from, to) => {
          // Re-read here as well as on the way out, because this is the one
          // mutation that also reaches the live lineup: the slot takes the new
          // name at once, so an archive still holding the old spelling publishes
          // the new name with nobody's history behind it. Stats has already
          // written by the time this runs.
          dispatch({ type: 'renamePlayer', from, to });
          setMatches(loadArchive());
          // The draw is swept too, so a tie set up on the setup screen behind this one
          // would otherwise come back to a banner naming a round the bracket no longer
          // resolves — the same staleness, one derivation further along.
          setTournaments(loadTournaments());
        }}
      />
    );
  }

  if (screen === 'setup') {
    const faults = lineupFaults(game);
    // A tie's lineup and mode come from the bracket, so the setup screen shows them
    // rather than offering them: changing either would re-credit the tie to people who
    // are not in the tournament, and `bracket` would then never find the match.
    const tie = Boolean(game.tournament);
    // One sentence per fault the lineup actually has: which name is doubled is
    // worth saying, which box is empty is not — you can see that.
    const twice = [...new Set(faults.filter((f) => f.fault === 'twice').map((f) => f.name))];
    const hint = [
      twice.length > 0 &&
        `${twice.join(' and ')} ${twice.length === 1 ? 'is' : 'are'} in the lineup twice. Two players need two names.`,
      faults.some((f) => f.fault === 'blank') && 'Everyone playing needs a name.',
    ].filter(Boolean);
    return (
      <div className="app setup">
        <Logo className="setup-logo" colorA={game.colors.a} colorB={game.colors.b} />
        {/* Start sits up here with the mode, not at the foot of the screen: it is
            the one thing pressed every game, the names persist between games so
            there is usually nothing to fill in, and above everything else nothing
            below it can push it off the first screen. Three controls share the row
            and it must not wrap, which is the whole reason the button says "Start"
            and the mode labels carry 12px of side padding — measured, "Start game"
            and the original 22px together overrun a 375px phone by 59px. */}
        <div className="setup-top">
          <div className="mode-toggle" role="group" aria-label="Game mode">
            {['singles', 'doubles'].map((m) => (
              <button
                key={m}
                className={game.mode === m ? 'is-on' : ''}
                disabled={tie}
                onClick={() => dispatch({ type: 'setMode', mode: m })}
              >
                {m === 'singles' ? 'Singles' : 'Doubles'}
              </button>
            ))}
          </div>
          {/* Beside the mode rather than inside it: guests are orthogonal to
              singles/doubles, so a third segment in that group would read as a
              third mode. The label has to say what pressing does and still contain
              the visible word — WCAG Label in Name, as the board chip does. */}
          <button
            type="button"
            className={`casual-toggle${game.casual ? ' is-on' : ''}`}
            disabled={tie}
            onClick={() => dispatch({ type: 'setCasual', value: !game.casual })}
            aria-pressed={game.casual}
            aria-label="Guests: take no names and record nothing"
          >
            Guests
          </button>
          {/* The row has no space for a label that explains itself, so the
              reason sits under it and the button points at it. */}
          <button
            className="start-game"
            disabled={faults.length > 0}
            aria-describedby={faults.length > 0 ? 'lineup-fault' : undefined}
            onClick={() => {
              dispatch({ type: 'start', at: Date.now() });
              setScreen('play');
            }}
          >
            Start
          </button>
        </div>
        {/* Only while it is on, so the ordinary case spends no height on it. The
            collapsed fields below say the colours are the teams; what they can't
            say is that the match won't be filed. */}
        {game.casual && <p className="casual-hint">This game won&rsquo;t be recorded.</p>}
        {hint.length > 0 && (
          <p className="lineup-hint" id="lineup-fault">
            {hint.join(' ')}
          </p>
        )}
        {tie && (
          <p className="tie-banner">
            {liveTournament?.name ?? 'Tournament'}
            {playingTie ? ` · ${levelName(playingTie.level, liveView.shape)}` : ''} — the draw
            sets who plays.{' '}
            {/* The only way out of a tie picked by mistake. Without it the screen has
                one exit, `Start`, so backing out means playing the tie or abandoning a
                started game. Worded about this game rather than about the cup, because
                nothing here touches the cup: the tie goes straight back on the bracket,
                playable, and every other running tournament is unaffected. A label naming
                the tournament reads as withdrawing from it. */}
            <button
              type="button"
              className="tie-leave"
              onClick={() => dispatch({ type: 'clearTie' })}
            >
              Play something else
            </button>
          </p>
        )}
        <TeamsFields
          game={game}
          dispatch={dispatch}
          knownNames={knownNames}
          faults={faults}
          locked={tie}
          onSetFirst={(team, slot) => dispatch({ type: 'throwFirst', team, slot })}
          onSwapEnds={(team) => dispatch({ type: 'swapEnds', team })}
        />
        <TossForFirst game={game} dispatch={dispatch} />
        <Positions
          game={game}
          setup
          onSwapSides={(side) => dispatch({ type: 'setStartSide', side })}
        />
        {/* Text rather than a field on a tie, the way the names are: the target is fixed
            at the draw like the mode is, so every tie in one bracket is played on the same
            terms. The bracket would not notice a tie played to 12 among ties played to 21
            — it reads only the two sides and the winner — which is exactly why nothing
            would ever say it had happened. */}
        {tie ? (
          <p className="target-fixed">Play to {game.target}</p>
        ) : (
        <label className="target-field">
          Play to
          <input
            type="number"
            inputMode="numeric"
            min="1"
            max={MAX_TARGET}
            value={targetStr}
            onChange={(e) => {
              const v = e.target.value;
              setTargetStr(v);
              if (v.trim() !== '') {
                dispatch({ type: 'setTarget', value: clampTarget(v, game.target) });
              }
            }}
            onBlur={() => {
              const clamped = clampTarget(targetStr, game.target);
              setTargetStr(String(clamped));
              if (clamped !== game.target) {
                dispatch({ type: 'setTarget', value: clamped });
              }
            }}
          />
        </label>
        )}
        <ScoreboardSettings
          config={sbConfig}
          onChange={setSbConfig}
          status={scoreboard.status}
          error={scoreboard.error}
        />
        {/* Nobody's history to report, and the slots' default names have one that
            isn't theirs — the same trap `lineupPayload` guards on the board. */}
        {!game.casual && (
          <Lineup
            game={game}
            colors={game.colors}
            matches={formMatches}
            series={series?.name}
          />
        )}
        <div className="setup-links">
          <button className="setup-stats" onClick={() => setScreen('tournament')}>
            Tournaments
          </button>
          <button className="setup-stats" onClick={() => setScreen('stats')}>
            Stats
          </button>
        </div>
        <Footer saveFailed={saveFailed} />
      </div>
    );
  }

  return (
    <div className="app play-screen">
      <div className="main">
      <header className="scoreboard">
        <TeamScore
          players={teamPlayers('a')}
          activeIdx={activeIdx}
          score={t.a}
          color={colors.a}
          winner={game.winner === 'a'}
          first={game.nextFirst === 'a'}
        />
        <div className="center-readout">
          <span className="target">to {game.target}</span>
          {/* Sits under the target, because the pair that answers "does this win
              it?" has to be read against the number it needs. Always mounted and
              hidden rather than dropped, so the column it widens is a fixed width:
              the alternative moved the two team cards 25px on the first bag of
              every round, which took a name from 12 characters to 10 and back. */}
          <div className={`projection${currentRoundStarted ? '' : ' is-idle'}`}>
            {/* Kept to about the width of the pair below it (measured: 64.9px
                against 62.5px for two two-digit scores). Any longer and the
                caption sets this column's width instead, which comes straight out
                of the two names either side — "if it ends now" cost 25px, two
                characters off every name in the header. */}
            <span className="projection-cap">projected</span>
            {/* Two numbers told apart by colour and column is the round history's
                old fault, so each says whose it is for a reader. */}
            <span className="projection-score">
              <span className="team-ink" style={{ '--team': colors.a }}>
                <span className="visually-hidden">{teamLabel(game, 'a')} </span>
                {t.a + preview.a}
              </span>
              <span aria-hidden="true">–</span>
              <span className="team-ink" style={{ '--team': colors.b }}>
                <span className="visually-hidden">{teamLabel(game, 'b')} </span>
                {t.b + preview.b}
              </span>
            </span>
          </div>
          {/* The header already reads "Blue" rather than a name, so this only has
              to confirm what that implies — but it does have to be said, because a
              game you meant to record and didn't has no other symptom. */}
          {game.casual && <span className="casual-note">not recorded</span>}
        </div>
        <TeamScore
          players={teamPlayers('b')}
          activeIdx={activeIdx}
          score={t.b}
          color={colors.b}
          winner={game.winner === 'b'}
          first={game.nextFirst === 'b'}
        />
      </header>

      {/* The overlays that show a committed round are `aria-hidden`, so this is the
          only report of one. Always mounted, because a live region inserted along with
          its content is announced unreliably — the same reason `.toss-result` is. */}
      <p className="visually-hidden" role="status">
        {roundReport(game)}
      </p>

      {game.winner && (
        <div className="winner-banner team-fill" style={{ '--team': colors[game.winner] }}>
          {winnerLabel} {winVerb(winnerLabel)}!
        </div>
      )}

      <Board
        names={{ a: laneName('a'), b: laneName('b') }}
        current={game.current}
        colors={colors}
        disabled={!!game.winner}
        fourBagger={fourBagger}
        onSet={(team, index, tier) =>
          dispatch({ type: 'set', team, index, tier })
        }
      />

      <div className="controls">
        {/* Two actions on one control: filling is reversible by tapping a bag and
            ending the round is not, which is why they are not one press. */}
        <button
          className="end-round"
          disabled={!!game.winner}
          onClick={() => dispatch({ type: complete ? 'endRound' : 'restFloor' })}
        >
          {complete ? 'End round' : `Remaining ${remaining} on the floor`}
        </button>
      </div>

      <div className="secondary-controls">
        <button onClick={undoLastRound} disabled={game.rounds.length === 0}>
          Undo round
        </button>
        {!wideLayout && (
          <button onClick={() => setShowPositions((s) => !s)}>Positions</button>
        )}
        {!wideLayout && (
          <button
            onClick={() => setShowHistory((s) => !s)}
            disabled={game.rounds.length === 0}
          >
            History ({game.rounds.length})
          </button>
        )}
        {!wideLayout && (
          <button onClick={() => setShowGameStats((s) => !s)}>Game stats</button>
        )}
        {sbConfig.enabled && (
          <button
            onClick={() =>
              setSbConfig((c) => ({
                ...c,
                layout:
                  PANEL_LAYOUTS[
                    (PANEL_LAYOUTS.indexOf(normalizeLayout(c.layout)) + 1) % PANEL_LAYOUTS.length
                  ],
              }))
            }
          >
            Panel: {LAYOUT_LABELS[normalizeLayout(sbConfig.layout)]}
          </button>
        )}
        <button className={abandoning ? 'abandon-game' : undefined} onClick={startNewGame}>
          {abandoning ? 'Abandon game' : 'New game'}
        </button>
      </div>
      </div>

      <div className="side-rail">
      {(wideLayout || showPositions) && <Positions game={game} />}

      {(wideLayout || showGameStats) && <GameStats game={game} colors={colors} />}

      {/* Last in the rail: its height varies with the game, so it absorbs what
          the panels above it leave rather than moving them. */}
      <aside className="history-panel">
        {game.rounds.length > 0
          ? (wideLayout || showHistory) && (
              <div className="history">
                <table className="history-table">
                  {/* Named columns are the seen half of the fix: on a wash the two
                      cells are byte-identical, and red against green is CIEDE2000 4.4
                      under deuteranopia — the same colour. `aria-hidden` because each
                      cell names its own team, and a column header announced as well
                      would say it twice. */}
                  <thead aria-hidden="true">
                    <tr>
                      <th />
                      <th className="team-ink" style={{ '--team': colors.a }}>
                        {teamLabel(game, 'a')}
                      </th>
                      <th className="team-ink" style={{ '--team': colors.b }}>
                        {teamLabel(game, 'b')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {game.rounds
                      .map((r, i) => ({ r, n: i + 1 }))
                      .reverse()
                      .map(({ r, n }) => (
                        <tr key={n}>
                          <th scope="row" className="history-round">
                            R{n}
                          </th>
                          {['a', 'b'].map((team) => {
                            const c = tierCounts(r[team]);
                            return (
                              <td key={team} className="team-ink" style={{ '--team': colors[team] }}>
                                {/* Glyphs and a colour, so what they carry has to be
                                    said as well — the same split as `.first-bag`. */}
                                <span aria-hidden="true">
                                  {c.hole}◎ {c.board}▬ → +{r.nets[team]}
                                </span>
                                <span className="visually-hidden">{roundLine(game, r, team)}</span>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )
          : wideLayout && (
              <p className="history-empty">Rounds will appear here.</p>
            )}
      </aside>
      </div>

      <Footer saveFailed={saveFailed} />

      <dialog
        ref={confirmDialog}
        className="modal"
        onClose={() => setConfirm(null)}
        onClick={(e) => {
          if (e.target === confirmDialog.current) setConfirm(null);
        }}
      >
        <p className="modal-title">{confirm?.title}</p>
        <p className="modal-body">{confirm?.body}</p>
        <div className="confirm-actions">
          <button onClick={() => setConfirm(null)}>Cancel</button>
          <button
            className="confirm-danger"
            onClick={() => {
              confirm?.onConfirm();
              setConfirm(null);
            }}
          >
            {confirm?.confirmLabel}
          </button>
        </div>
      </dialog>

      {callout && (
        <div className="callout" key={callout.key} aria-hidden="true">
          {callout.win && <Confetti count={callout.confetti} color={callout.color} />}
          <span className="callout-text team-ink" style={{ '--team': callout.color }}>
            {callout.text}
          </span>
        </div>
      )}
    </div>
  );
}

// The arrangement is adjusted here, on the players it describes, rather than on
// the court — which stays a drawing. `onSetFirst` and `onSwapEnds` are what gate
// it to the setup screen: both reorder slots, and `throwerFor` credits committed
// rounds by slot, so a second caller that passed them would silently re-credit
// every doubles stat.
// A casual game keeps this card — the colour is the team's identity there, so the
// swatches are the only thing on the setup screen that still matters — but the name
// fields become the colour as text and the board chip goes: with both partners
// labelled alike, reordering the pair changes nothing anybody can see.
function TeamsFields({
  game,
  dispatch,
  knownNames,
  faults = [],
  locked = false,
  onSetFirst,
  onSwapEnds,
}) {
  const doubles = game.mode === 'doubles';
  const casual = game.casual;
  // A tie's names come from the draw, so they are shown rather than offered. Only the
  // names: who throws first and which partner is at which board are still the
  // scorer's, and neither can move a tie to different people — `sideKeyOf` reads a
  // side as a set, so reordering a pair leaves the bracket's match unchanged.
  const fixed = casual || locked;
  const slots = doubles && !casual ? [0, 1] : [0];
  // The hint says what is wrong; this says where, because four boxes and one
  // sentence leaves you counting.
  const faulted = new Set(faults.map((f) => `${f.team}${f.slot}`));
  return (
    <div className="teams-fields">
      {/* Names already in the archive. A returning player is picked rather than
          retyped, which is where near-duplicate spellings come from. Ignored
          where datalist is unsupported, leaving a plain field. */}
      {!fixed && knownNames.length > 0 && (
        <datalist id="known-names">
          {knownNames.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      )}
      {['a', 'b'].map((team) => {
        const other = team === 'a' ? 'b' : 'a';
        return (
          <div className="team-field" key={team}>
            <div className="field-rows">
              {slots.map((i) => {
                const name = playerLabel(game, team, i);
                const fault = faulted.has(`${team}${i}`);
                const here = BOARD_NAME[i];
                const there = BOARD_NAME[1 - i];
                const first = game.nextFirst === team && i === 0;
                return (
                  <div className="field-row" key={i}>
                    {onSetFirst ? (
                      <button
                        type="button"
                        className={`first-bag${first ? ' is-first' : ''}`}
                        style={first ? { '--team': game.colors[team] } : undefined}
                        onClick={() => onSetFirst(team, i)}
                        aria-label={`${name} throws first`}
                        aria-pressed={first}
                        title="Throws first"
                      />
                    ) : (
                      <span className="first-bag-spacer" aria-hidden="true" />
                    )}
                    {fixed ? (
                      <span
                        className="team-name-static team-ink"
                        style={{ '--team': game.colors[team] }}
                      >
                        {name}
                      </span>
                    ) : (
                      <input
                        className="team-name-input team-ink"
                        {...NAME_FIELD}
                        value={name}
                        maxLength={16}
                        list={knownNames.length > 0 ? 'known-names' : undefined}
                        aria-invalid={fault || undefined}
                        aria-describedby={fault ? 'lineup-fault' : undefined}
                        style={{ '--team': game.colors[team] }}
                        onChange={(e) =>
                          dispatch({ type: 'rename', team, index: i, name: e.target.value })
                        }
                        aria-label={
                          doubles
                            ? `Team ${team.toUpperCase()} player at the ${here} board`
                            : `Team ${team.toUpperCase()} player`
                        }
                      />
                    )}
                    {onSwapEnds && doubles && !casual ? (
                      <button
                        type="button"
                        className={`end-chip${i === 0 ? ' at-start' : ''}`}
                        onClick={() => onSwapEnds(team)}
                        // The visible text is where they stand; the name has to
                        // contain it and still say what pressing does.
                        aria-label={`${name} at the ${here} board, press to move to the ${there} board`}
                      >
                        {here} board
                      </button>
                    ) : (
                      <span className="first-bag-spacer" aria-hidden="true" />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="swatches">
              {PALETTE.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  className={`swatch${game.colors[team] === c.value ? ' is-selected' : ''}`}
                  style={{ '--team': c.value }}
                  disabled={game.colors[other] === c.value}
                  onClick={() => dispatch({ type: 'setColor', team, value: c.value })}
                  aria-label={`${c.name} bags`}
                  aria-pressed={game.colors[team] === c.value}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Deciding who opens by chance. The candidates are the two players at the start
// board — in singles because they are the only players, in doubles because the
// slot index *is* the end that partner stands at — so both are slot 0, and the
// toss is a coin flip on `nextFirst` that structurally cannot reorder a pair. At
// slot 1 `throwFirst` would compose `swapEnds` and re-credit committed rounds. The
// draw is made here rather than in `scoring.js`, which stays pure.
function TossForFirst({ game, dispatch }) {
  const [tossing, setTossing] = useState(false);
  const timer = useRef(null);
  // A pending toss must not land after the screen has gone: the reducer's
  // `throwFirst` is gated structurally rather than on `gameStarted`, so it would
  // still hand the opening throw to the other team mid-game.
  useEffect(() => () => clearTimeout(timer.current), []);
  // The result is hidden for TOSS_MS and the draw made on the way back, so the
  // press always changes something even when the coin lands where it already was —
  // which is half of all presses. Presentational, and one dispatch at the end:
  // `nextFirst` travels to the board as `first` on a retained topic, so flipping
  // state to animate would publish values that were never the result.
  const toss = () => {
    clearTimeout(timer.current);
    setTossing(true);
    timer.current = setTimeout(() => {
      dispatch({ type: 'throwFirst', team: Math.random() < 0.5 ? 'a' : 'b', slot: 0 });
      setTossing(false);
    }, TOSS_MS);
  };
  // Derived from `nextFirst`, never remembered from the press, so it cannot go
  // stale. The region is always in the DOM, because one inserted along with its
  // content is announced unreliably; the cost is that renaming the leading player
  // retypes it into a live region.
  const opener = String(playerLabel(game, game.nextFirst, 0) ?? '').trim();
  return (
    <div className="toss-row">
      <button type="button" className="toss" onClick={toss}>
        Toss for first
      </button>
      <span className={`toss-result${tossing ? ' is-tossing' : ''}`} aria-live="polite">
        {opener && (
          <>
            <span className="team-ink" style={{ '--team': game.colors[game.nextFirst] }}>
              {opener}
            </span>{' '}
            throws first
          </>
        )}
      </span>
    </div>
  );
}

// Both game screens draw it, which is why the unsaved warning lives here rather
// than being written twice. Always in the DOM as a live region: one inserted
// along with its content is announced unreliably, the same reason `.toss-result`
// is always mounted.
function Footer({ saveFailed = false }) {
  return (
    <footer className="footer">
      <span className="save-warning" role="status">
        {saveFailed && 'This phone won’t save — nothing new will survive a reload.'}
      </span>
      Made with <span className="footer-heart">♥</span>
    </footer>
  );
}

// Alternating the winner's colour with `--text` rather than with white, which was the
// half that stopped working on the light scheme: white confetti over a white page is the
// celebration not happening. Both come from the stylesheet now, off the `--team` set here.
function Confetti({ count, color }) {
  return (
    <div className="confetti" aria-hidden="true" style={{ '--team': color }}>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={`confetti-piece${i % 2 ? ' is-pale' : ''}`}
          style={{
            left: `${Math.random() * 100}%`,
            width: `${6 + Math.round(Math.random() * 6)}px`,
            height: `${9 + Math.round(Math.random() * 9)}px`,
            '--drift': `${Math.round((Math.random() * 2 - 1) * 90)}px`,
            '--rot': `${Math.round(Math.random() * 720 - 360)}deg`,
            animationDuration: `${1000 + Math.round(Math.random() * 700)}ms`,
            animationDelay: `${Math.round(Math.random() * 150)}ms`,
          }}
        />
      ))}
    </div>
  );
}

// Reports, never sets. Nothing about who the teams are or who leads can be
// changed once a game is under way — the play screen deals only with scoring — so
// the bag is an indicator here and the name is text. Both are still needed:
// after round one the bag follows whoever scored last.
// The big number is the *committed* score, and the round in progress is reported
// between the two cards instead. It used to be the other way round: the 56px figure
// was `totals + roundNets(current)`, so four in the hole read "Neil 0 · Sigma 12"
// for a game that was 0–0, with the caption resolving it the smallest text on the
// screen. This also puts the phone back in agreement with `roundReport`,
// `?display=1` and the LED panel, all three of which report committed rounds only.
function TeamScore({ players, activeIdx, score, color, winner, first }) {
  return (
    <div className={`team-score${winner ? ' is-winner' : ''}`}>
      <div className="names">
        {players.map((name, i) => {
          const active = i === activeIdx;
          const benched = players.length > 1 && !active;
          return (
            <div className={`name-row${benched ? ' benched' : ''}`} key={i}>
              {active ? (
                <span
                  className={`first-bag${first ? ' is-first' : ''}`}
                  style={first ? { '--team': color } : undefined}
                  aria-hidden="true"
                  title="Throws first"
                />
              ) : (
                <span className="first-bag-spacer" aria-hidden="true" />
              )}
              <span className="team-name team-ink" style={{ '--team': color }}>
                {name}
              </span>
              {/* The bag is shape and colour only, so the fact it carries has to
                  be said as well. */}
              {active && first && <span className="visually-hidden">throws first</span>}
            </div>
          );
        })}
      </div>
      <div className="score team-ink" style={{ '--team': color }}>
        {score}
      </div>
    </div>
  );
}
