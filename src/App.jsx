import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import Board from './Board.jsx';
import GameStats from './GameStats.jsx';
import Lineup from './Lineup.jsx';
import Logo from './Logo.jsx';
import Positions from './Positions.jsx';
import ScoreboardSettings from './ScoreboardSettings.jsx';
import Stats from './Stats.jsx';
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
  unthrownCount,
  tierCounts,
  teamLabel,
  winVerb,
} from './scoring.js';
import './App.css';

const STORAGE_KEY = 'holecorn.game.v3';

// A match needs an identity before it can be archived. It lives here rather
// than in scoring.js, which stays pure — an id is not a scoring concern — and
// is added on load as well as on creation, so a game saved without one still
// gets archived.
function identified(game) {
  return game.id ? game : { ...game, id: newMatchId() };
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
      return identified(merged);
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
    case 'setColor':
      return { ...game, colors: { ...game.colors, [action.team]: action.value } };
    case 'setMode':
      return { ...game, mode: action.mode };
    case 'setCasual':
      // Setup only, the same reasoning as the arrangement controls: flipping it
      // after a win would strand a record the archive effect can no longer see to
      // remove, and flipping it mid-game would rename every committed round.
      return gameStarted(game) ? game : { ...game, casual: action.value };
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
  // Held here rather than only inside Stats, because the pre-game form panel and
  // the scoreboard publisher both read it and both live above that screen.
  const [matches, setMatches] = useState(loadArchive);
  const confirmDialog = useRef(null);
  const prevRoundCount = useRef(game.rounds.length);
  const archivedId = useRef(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(game));
  }, [game]);

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
        // and the board have the match the moment it is filed.
        setMatches(archiveMatch(game, Date.now()));
        archivedId.current = game.id;
      }
    } else if (archivedId.current === game.id) {
      setMatches(dropMatch(game.id));
      archivedId.current = null;
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

  const scoreboard = useScoreboardPublisher(game, sbConfig, matches);

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
  const live = { a: t.a + preview.a, b: t.b + preview.b };
  const remaining = unthrownCount(game);
  const complete = roundComplete(game);
  const currentRoundStarted = [...game.current.a, ...game.current.b].some(
    (tier) => tier !== 'unthrown',
  );
  const winnerLabel = game.winner ? teamLabel(game, game.winner) : '';

  const startNewGame = () => {
    const toSetup = () => {
      dispatch({ type: 'newGame' });
      setCallout(null);
      setFourBagger(null);
      setScreen('setup');
    };
    // Only a game still in progress is worth guarding. A won game has nothing
    // left to lose: it is over, and the archive already has it.
    if (gameStarted(game) && !game.winner) {
      setConfirm({
        title: 'Start a new game?',
        body: 'This clears the current game.',
        confirmLabel: 'New game',
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

  // Everyone the archive knows, newest spelling last so it is the one offered —
  // the same rule `playerStats` settles a display name by.
  const knownNames = useMemo(() => {
    const seen = new Map();
    for (const m of [...matches].sort((x, y) => (x.endedAt ?? 0) - (y.endedAt ?? 0))) {
      for (const team of ['a', 'b']) {
        for (const n of m.players?.[team] ?? []) {
          const key = nameKey(n);
          if (key) seen.set(key, String(n).trim());
        }
      }
    }
    return [...seen.values()].sort((x, y) => x.localeCompare(y));
  }, [matches]);

  if (screen === 'stats') {
    // Stats owns its own copy while it is open, because it deletes, restores and
    // imports; re-reading on the way out is what keeps the form panel and the
    // board from reporting matches that have since been deleted.
    return (
      <Stats
        onBack={() => {
          setMatches(loadArchive());
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
        }}
      />
    );
  }

  if (screen === 'setup') {
    const faults = lineupFaults(game);
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
        <TeamsFields
          game={game}
          dispatch={dispatch}
          knownNames={knownNames}
          faults={faults}
          onSetFirst={(team, slot) => dispatch({ type: 'throwFirst', team, slot })}
          onSwapEnds={(team) => dispatch({ type: 'swapEnds', team })}
        />
        <Positions
          game={game}
          onSwapSides={(side) => dispatch({ type: 'setStartSide', side })}
        />
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
        <ScoreboardSettings
          config={sbConfig}
          onChange={setSbConfig}
          status={scoreboard.status}
          error={scoreboard.error}
        />
        {/* Nobody's history to report, and the slots' default names have one that
            isn't theirs — the same trap `lineupPayload` guards on the board. */}
        {!game.casual && <Lineup game={game} colors={game.colors} matches={matches} />}
        <button className="setup-stats" onClick={() => setScreen('stats')}>
          Stats
        </button>
        <Footer />
      </div>
    );
  }

  return (
    <div className="app">
      <div className="main">
      <header className="scoreboard">
        <TeamScore
          players={teamPlayers('a')}
          activeIdx={activeIdx}
          score={live.a}
          color={colors.a}
          winner={game.winner === 'a'}
          first={game.nextFirst === 'a'}
        />
        <div className="center-readout">
          <span className="center-cap">logged</span>
          <div className="logged">
            <span style={{ color: colors.a }}>{t.a}</span>
            <span className="logged-sep">–</span>
            <span style={{ color: colors.b }}>{t.b}</span>
          </div>
          <span className="target">to {game.target}</span>
          {/* The header already reads "Blue" rather than a name, so this only has
              to confirm what that implies — but it does have to be said, because a
              game you meant to record and didn't has no other symptom. */}
          {game.casual && <span className="casual-note">not recorded</span>}
        </div>
        <TeamScore
          players={teamPlayers('b')}
          activeIdx={activeIdx}
          score={live.b}
          color={colors.b}
          winner={game.winner === 'b'}
          first={game.nextFirst === 'b'}
        />
      </header>

      {game.winner && (
        <div className="winner-banner" style={{ background: colors[game.winner] }}>
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
        <button
          className="end-round"
          disabled={!!game.winner || !complete}
          onClick={() => dispatch({ type: 'endRound' })}
        >
          {game.winner || complete
            ? 'End round'
            : `${remaining} bag${remaining === 1 ? '' : 's'} still to place`}
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
        <button onClick={startNewGame}>New game</button>
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
              <ol className="history">
                {game.rounds
                  .map((r, i) => ({ r, n: i + 1 }))
                  .reverse()
                  .map(({ r, n }) => {
                    const ca = tierCounts(r.a);
                    const cb = tierCounts(r.b);
                    return (
                      <li key={n}>
                        <span className="history-round">R{n}</span>
                        <span style={{ color: colors.a }}>
                          {ca.hole}◎ {ca.board}▬ → +{r.nets.a}
                        </span>
                        <span style={{ color: colors.b }}>
                          {cb.hole}◎ {cb.board}▬ → +{r.nets.b}
                        </span>
                      </li>
                    );
                  })}
              </ol>
            )
          : wideLayout && (
              <p className="history-empty">Rounds will appear here.</p>
            )}
      </aside>
      </div>

      <Footer />

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
          {callout.win && (
            <Confetti
              count={callout.confetti}
              colors={[callout.color, '#ffffff']}
            />
          )}
          <span className="callout-text" style={{ color: callout.color }}>
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
function TeamsFields({ game, dispatch, knownNames, faults = [], onSetFirst, onSwapEnds }) {
  const doubles = game.mode === 'doubles';
  const casual = game.casual;
  const slots = doubles && !casual ? [0, 1] : [0];
  // The hint says what is wrong; this says where, because four boxes and one
  // sentence leaves you counting.
  const faulted = new Set(faults.map((f) => `${f.team}${f.slot}`));
  return (
    <div className="teams-fields">
      {/* Names already in the archive. A returning player is picked rather than
          retyped, which is where near-duplicate spellings come from. Ignored
          where datalist is unsupported, leaving a plain field. */}
      {!casual && knownNames.length > 0 && (
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
                        style={
                          first
                            ? { background: game.colors[team], borderColor: game.colors[team] }
                            : undefined
                        }
                        onClick={() => onSetFirst(team, i)}
                        aria-label={`${name} throws first`}
                        aria-pressed={first}
                        title="Throws first"
                      />
                    ) : (
                      <span className="first-bag-spacer" aria-hidden="true" />
                    )}
                    {casual ? (
                      <span
                        className="team-name-static"
                        style={{ color: game.colors[team] }}
                      >
                        {name}
                      </span>
                    ) : (
                      <input
                        className="team-name-input"
                        value={name}
                        maxLength={16}
                        list={knownNames.length > 0 ? 'known-names' : undefined}
                        aria-invalid={fault || undefined}
                        aria-describedby={fault ? 'lineup-fault' : undefined}
                        style={{ color: game.colors[team] }}
                        onChange={(e) =>
                          dispatch({ type: 'rename', team, index: i, name: e.target.value })
                        }
                        aria-label={
                          doubles
                            ? `Team ${team.toUpperCase()} player at the ${here} board`
                            : `Team ${team.toUpperCase()} player name`
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
                  style={{ background: c.value }}
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

function Footer() {
  return (
    <footer className="footer">
      Made with <span className="footer-heart">♥</span>
    </footer>
  );
}

function Confetti({ count, colors }) {
  return (
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{
            left: `${Math.random() * 100}%`,
            width: `${6 + Math.round(Math.random() * 6)}px`,
            height: `${9 + Math.round(Math.random() * 9)}px`,
            background: colors[i % colors.length],
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
                  style={first ? { background: color, borderColor: color } : undefined}
                  aria-hidden="true"
                  title="Throws first"
                />
              ) : (
                <span className="first-bag-spacer" aria-hidden="true" />
              )}
              <span className="team-name" style={{ color }}>
                {name}
              </span>
              {/* The bag is shape and colour only, so the fact it carries has to
                  be said as well. */}
              {active && first && <span className="visually-hidden">throws first</span>}
            </div>
          );
        })}
      </div>
      <div className="score" style={{ color }}>
        {score}
      </div>
    </div>
  );
}
