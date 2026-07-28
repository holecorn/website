import { useEffect, useReducer, useRef, useState } from 'react';
import Board from './Board.jsx';
import GameStats from './GameStats.jsx';
import Logo from './Logo.jsx';
import Positions from './Positions.jsx';
import ScoreboardSettings from './ScoreboardSettings.jsx';
import Stats from './Stats.jsx';
import { archiveMatch, dropMatch, newMatchId, requestPersistence } from './archive.js';
import {
  LAYOUT_LABELS,
  loadScoreboardConfig,
  normalizeLayout,
  saveScoreboardConfig,
} from './scoreboard.js';
import { useScoreboardPublisher } from './useScoreboard.js';
import { PANEL_LAYOUTS } from './panelRender.js';
import {
  MAX_TARGET,
  clampTarget,
  newGame,
  setBag,
  setFirst,
  setStartSide,
  courtPositions,
  endRound,
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

const PALETTE = [
  { name: 'blue', value: '#2f80ed' },
  { name: 'red', value: '#eb5757' },
  { name: 'green', value: '#27ae60' },
  { name: 'yellow', value: '#f2c94c' },
];

// A match needs an identity before it can be archived. It lives here rather
// than in scoring.js, which stays pure — an id is not a scoring concern — and
// is added on load as well as on creation, so a game saved without one still
// gets archived.
function identified(game) {
  return game.id ? game : { ...game, id: newMatchId() };
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
          a: [parsed.names.a, 'Player 2'],
          b: [parsed.names.b, 'Player 2'],
        };
      }
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

function gameStarted(game) {
  return (
    game.rounds.length > 0 ||
    [...game.current.a, ...game.current.b].some((tier) => tier !== 'unthrown')
  );
}

function reducer(game, action) {
  switch (action.type) {
    case 'set':
      return setBag(game, action.team, action.index, action.tier);
    case 'setFirst':
      return setFirst(game, action.team);
    case 'setStartSide':
      return setStartSide(game, action.side);
    case 'swapEnds': {
      // Which partner stands at which end is the slot order. Setup-screen only:
      // committed rounds are attributed by slot, so a swap mid-game would
      // re-credit them.
      const [near, far] = game.players[action.team];
      return { ...game, players: { ...game.players, [action.team]: [far, near] } };
    }
    case 'endRound':
      return endRound(game);
    case 'undoRound':
      return undoRound(game);
    case 'rename': {
      const players = game.players[action.team].slice();
      players[action.index] = action.name;
      return { ...game, players: { ...game.players, [action.team]: players } };
    }
    case 'setColor':
      return { ...game, colors: { ...game.colors, [action.team]: action.value } };
    case 'setMode':
      return { ...game, mode: action.mode };
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
  const [editingTeams, setEditingTeams] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [callout, setCallout] = useState(null);
  const [fourBagger, setFourBagger] = useState(null);
  const [targetStr, setTargetStr] = useState(String(game.target));
  const [sbConfig, setSbConfig] = useState(loadScoreboardConfig);
  const [persisted, setPersisted] = useState(null);
  const confirmDialog = useRef(null);
  const editDialog = useRef(null);
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
    if (game.winner) {
      if (archivedId.current !== game.id) {
        archiveMatch(game, Date.now());
        archivedId.current = game.id;
      }
    } else if (archivedId.current === game.id) {
      dropMatch(game.id);
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

  const scoreboard = useScoreboardPublisher(game, sbConfig);

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

  useEffect(() => {
    const dialog = editDialog.current;
    if (!dialog) return;
    if (editingTeams && !dialog.open) dialog.showModal();
    if (!editingTeams && dialog.open) dialog.close();
  }, [editingTeams]);

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
  const teamPlayers = (team) =>
    doubles ? game.players[team] : [game.players[team][0]];
  const laneName = (team) => game.players[team][doubles ? activeIdx : 0];
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

  if (screen === 'stats') {
    return <Stats onBack={() => setScreen('setup')} persisted={persisted} />;
  }

  if (screen === 'setup') {
    return (
      <div className="app setup">
        <Logo className="setup-logo" colorA={game.colors.a} colorB={game.colors.b} />
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
        <TeamsFields game={game} dispatch={dispatch} />
        <Positions
          game={game}
          onSwapSides={(side) => dispatch({ type: 'setStartSide', side })}
          onSwapEnds={(team) => dispatch({ type: 'swapEnds', team })}
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
        <button
          className="end-round"
          onClick={() => {
            dispatch({ type: 'start', at: Date.now() });
            setScreen('play');
          }}
        >
          Start game
        </button>
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
          onEdit={() => setEditingTeams(true)}
          onSetFirst={() => dispatch({ type: 'setFirst', team: 'a' })}
        />
        <div className="center-readout">
          <span className="center-cap">logged</span>
          <div className="logged">
            <span style={{ color: colors.a }}>{t.a}</span>
            <span className="logged-sep">–</span>
            <span style={{ color: colors.b }}>{t.b}</span>
          </div>
          <span className="target">to {game.target}</span>
        </div>
        <TeamScore
          players={teamPlayers('b')}
          activeIdx={activeIdx}
          score={live.b}
          color={colors.b}
          winner={game.winner === 'b'}
          first={game.nextFirst === 'b'}
          onEdit={() => setEditingTeams(true)}
          onSetFirst={() => dispatch({ type: 'setFirst', team: 'b' })}
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
        ref={editDialog}
        className="modal"
        onClose={() => setEditingTeams(false)}
        onClick={(e) => {
          if (e.target === editDialog.current) setEditingTeams(false);
        }}
      >
        <p className="modal-title">Teams</p>
        <TeamsFields game={game} dispatch={dispatch} />
        <div className="confirm-actions">
          <button className="confirm-primary" onClick={() => setEditingTeams(false)}>
            Done
          </button>
        </div>
      </dialog>

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

function TeamsFields({ game, dispatch }) {
  const slots = game.mode === 'doubles' ? [0, 1] : [0];
  return (
    <div className="teams-fields">
      {['a', 'b'].map((team) => {
        const other = team === 'a' ? 'b' : 'a';
        return (
          <div className="team-field" key={team}>
            {slots.map((i) => (
              <input
                key={i}
                className="team-name-input"
                value={game.players[team][i]}
                maxLength={16}
                style={{ color: game.colors[team] }}
                onChange={(e) =>
                  dispatch({ type: 'rename', team, index: i, name: e.target.value })
                }
                aria-label={
                  game.mode === 'doubles'
                    ? `Team ${team.toUpperCase()} player at the ${i === 0 ? 'start' : 'far'} end`
                    : `Team ${team.toUpperCase()} player name`
                }
              />
            ))}
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

function TeamScore({ players, activeIdx, score, color, winner, first, onEdit, onSetFirst }) {
  return (
    <div className={`team-score${winner ? ' is-winner' : ''}`}>
      <div className="names">
        {players.map((name, i) => {
          const active = i === activeIdx;
          const benched = players.length > 1 && !active;
          return (
            <div className={`name-row${benched ? ' benched' : ''}`} key={i}>
              {active ? (
                <button
                  className={`first-bag${first ? ' is-first' : ''}`}
                  style={first ? { background: color, borderColor: color } : undefined}
                  onClick={onSetFirst}
                  aria-label={`${name} throws first`}
                  aria-pressed={first}
                  title="Throws first"
                />
              ) : (
                <span className="first-bag-spacer" aria-hidden="true" />
              )}
              <button className="team-name" style={{ color }} onClick={onEdit}>
                {name}
              </button>
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
