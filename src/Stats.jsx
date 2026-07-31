import { useEffect, useMemo, useRef, useState } from 'react';
import { BOARD_NAME, nameKey, teamLabel } from './scoring.js';
import {
  dropMatch,
  loadArchive,
  loadLastExport,
  mergeMatches,
  newestEnd,
  restoreMatch,
  saveArchive,
  saveLastExport,
  saveMatchPlayers,
  savePlayerRename,
  unexportedCount,
} from './archive.js';
import {
  playerStats,
  playedIn,
  opponentRecords,
  nemesis,
  dominates,
  RIVAL_MIN_MEETINGS,
  summary,
  matchRounds,
  matchDuration,
  finalScore,
  hasRounds,
} from './stats.js';
import './Stats.css';

const pct = (v) => `${Math.round(v * 100)}%`;
const one = (v) => v.toFixed(1);
// Both forms spelled out rather than a suffix rule: "wash" and "match" take "es" while
// "round" takes "s", so anything that guesses gets one of them wrong.
const plural = (n, one, many) => (n === 1 ? one : many);
const matchCount = (n) => `${n} ${plural(n, 'match', 'matches')}`;
// One separator for every join in the rivals heading, so the gap after the
// player's name matches the gap between the two rivalries rather than being a
// margin that has to be eyeballed against it.
const DOT = ' · ';

// The year is always shown, never only on dates outside this one. Scoping the
// recent list to a player made it span years — a filtered list reads 10 May, 18
// Dec, 23 Nov and crosses a boundary silently — and a conditional year would make
// its absence the thing carrying "this year", which you have to know the rule to
// read. It would also key the rendering off Date.now(), so the same match grows a
// year in January and any check on the text passes by season.
const shortDate = (ms) =>
  ms
    ? new Date(ms).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: '2-digit',
      })
    : '';

function minutes(ms) {
  if (!ms) return '—';
  const mins = Math.round(ms / 60000);
  if (mins < 1) return '<1m';
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

const DURABILITY = {
  true: 'This browser has agreed to keep your history.',
  false:
    'This browser has not agreed to keep your history. On iOS, Safari clears it after about a week of not opening the site — adding Holecorn to your home screen fixes that. Export in the meantime.',
  null: 'This browser will not say whether it keeps your history, so export from time to time.',
};

export default function Stats({ onBack, persisted, onRenamePlayer }) {
  const [matches, setMatches] = useState(loadArchive);
  const [lastExport, setLastExport] = useState(loadLastExport);
  const [notice, setNotice] = useState(null);
  const [deleted, setDeleted] = useState(null);
  // One match open at a time, so a long history doesn't unroll into a wall.
  const [openId, setOpenId] = useState(null);
  // Both editors are modal, so the screen holds which record or player is being
  // edited and the dialog opens by being mounted.
  const [editing, setEditing] = useState(null);
  const [renaming, setRenaming] = useState(null);
  // Whose stats the screen is showing below the table, or null for nobody. Held
  // as a nameKey rather than a display name so it survives the fold that
  // playerStats already applies, and transient like openId — a scope you set
  // while looking, not a setting.
  const [selected, setSelected] = useState(null);

  const totalsFor = useMemo(() => summary(matches), [matches]);
  const players = useMemo(() => playerStats(matches), [matches]);
  // Resolved from the list rather than held alongside it, so a player who has
  // just lost their last match to a deletion takes the panel with them.
  const subject = players.find((p) => nameKey(p.name) === selected) ?? null;
  const rivals = useMemo(
    () => (subject ? opponentRecords(matches, subject.name) : []),
    [matches, subject],
  );
  const worst = nemesis(rivals);
  const best = dominates(rivals);
  // Scoped to the selected player, and that is not a nicety: the list is capped,
  // so measured on the sample archive four of eleven players appear in none of the
  // twelve newest matches — Tau with 37 played — and had no way to see any of their
  // games at all.
  const recent = useMemo(() => {
    const mine = subject ? matches.filter((m) => playedIn(m, subject.name)) : matches;
    return [...mine].sort((x, y) => (y.endedAt ?? 0) - (x.endedAt ?? 0)).slice(0, 12);
  }, [matches, subject]);
  const pending = unexportedCount(matches, lastExport);

  // One tap deletes and offers an undo, rather than asking first. The undo bar
  // sits outside the match list so deleting the last one doesn't take the way
  // back with it.
  const deleteMatch = (record) => {
    setMatches(dropMatch(record.id));
    setDeleted(record);
    setNotice(null);
    if (openId === record.id) setOpenId(null);
  };

  const undoDelete = () => {
    setMatches(restoreMatch(deleted));
    setDeleted(null);
  };

  // A name that was wrong for one game only — a typo caught after Start game, or
  // the wrong person credited for a doubles end. Confined to that record.
  const saveNames = (id, players) => {
    setMatches(saveMatchPlayers(id, players, Date.now()));
    setEditing(null);
    setNotice(null);
  };

  // The same person under a new name: every match, and the lineup waiting on the
  // setup screen, so the old spelling can't walk straight back into the next
  // game. Safe to touch that lineup because this screen is only reachable from
  // setup, where nothing has been thrown yet.
  const renamePlayer = (from, to) => {
    setMatches(savePlayerRename(from, to, Date.now()));
    onRenamePlayer?.(from, to);
    setRenaming(null);
    setNotice(null);
    // Follow the rename, or the panel closes under whoever is being looked at —
    // and on a merge it follows them into the career they were folded into.
    setSelected(nameKey(to));
  };

  const exportMatches = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(matches, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `holecorn-matches-${stamp}.json`;
    link.click();
    URL.revokeObjectURL(url);
    // Mark what was exported by its newest end time rather than by "now", so
    // the count is right whatever the clock says.
    const mark = newestEnd(matches);
    saveLastExport(mark);
    setLastExport(mark);
    setNotice(null);
  };

  const importMatches = async (event) => {
    const file = event.target.files?.[0];
    // Cleared so picking the same file twice fires the change event again.
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed)) throw new Error('not an export');
      const merged = saveArchive(mergeMatches(loadArchive(), parsed));
      const added = merged.length - matches.length;
      setMatches(merged);
      setNotice(
        added === 0
          ? 'Nothing new — those matches are already here.'
          : `Added ${matchCount(added)}.`,
      );
    } catch {
      setNotice("That file doesn't look like a Holecorn export.");
    }
  };

  return (
    <div className="app stats-screen">
      <header className="stats-head">
        <button className="stats-back" onClick={onBack}>
          ‹ Back
        </button>
        <h1>Stats</h1>
      </header>

      {deleted && (
        <div className="stats-undo">
          <span>
            Deleted {teamLabel(deleted, 'a')} v {teamLabel(deleted, 'b')}.
          </span>
          <button onClick={undoDelete}>Undo</button>
        </div>
      )}

      {matches.length === 0 ? (
        <p className="stats-empty">
          No finished matches yet. Play a game through to the target and it will
          show up here — abandoned games aren&apos;t counted. If you have an
          export from another device, import it below.
        </p>
      ) : (
        <>
          <div className="stat-chips">
            {/* Counts take a singular label at exactly one — zero is plural, as English
                has it. The two averages stay plural whatever they read, because a decimal
                does: "1.0 avg rounds", not "1.0 avg round". */}
            <Chip label={plural(totalsFor.matches, 'match', 'matches')} value={totalsFor.matches} />
            <Chip label={plural(totalsFor.rounds, 'round', 'rounds')} value={totalsFor.rounds} />
            <Chip label="avg rounds" value={one(totalsFor.avgRounds)} />
            <Chip label="avg length" value={minutes(totalsFor.avgDurationMs)} />
            <Chip label={plural(totalsFor.washes, 'wash', 'washes')} value={totalsFor.washes} />
            <Chip
              label={plural(totalsFor.fourBaggers, 'four bagger', 'four baggers')}
              value={totalsFor.fourBaggers}
            />
            <Chip label={plural(totalsFor.skunks, 'skunk', 'skunks')} value={totalsFor.skunks} />
          </div>

          <section className="stats-section">
            <h2>Players</h2>
            <div className="stats-scroll">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th scope="col">Player</th>
                    <th scope="col" title="Matches played">P</th>
                    <th scope="col" title="Won–lost">W–L</th>
                    {/* Next to PPR, which is points over exactly this. */}
                    <th scope="col" title="Rounds thrown">Rds</th>
                    <th scope="col" title="Raw bag points per round">PPR</th>
                    <th scope="col" title="Bags in the hole">Hole</th>
                    <th scope="col" title="Bags on the board or in the hole">In play</th>
                    <th scope="col" title="Four baggers">4B</th>
                    <th scope="col" title="Best round">Best</th>
                    <th scope="col" title="Current win streak">Streak</th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((p) => (
                    <tr
                      key={p.name}
                      className={nameKey(p.name) === selected ? 'is-selected' : undefined}
                    >
                      <th scope="row">
                        {/* The name is the select target because it is the only
                            cell always on screen — the table scrolls sideways by
                            ~200px on a phone and this column is sticky. It is
                            also the *only* control in the table: renaming lives
                            in the panel below, so a mis-tap can only ever select. */}
                        <button
                          className="player-select"
                          onClick={() =>
                            setSelected((s) => (s === nameKey(p.name) ? null : nameKey(p.name)))
                          }
                          aria-pressed={nameKey(p.name) === selected}
                        >
                          {p.name}
                        </button>
                      </th>
                      <td>{p.matches}</td>
                      <td>
                        {p.wins}–{p.losses}
                      </td>
                      <td>{p.rounds}</td>
                      {/* A rate over no rounds is undefined, not zero. Only a
                          career made entirely of imported results reaches this,
                          and 0.0 PPR beside 0 rounds reads as a bad run. */}
                      <td>{p.rounds > 0 ? one(p.ppr) : '—'}</td>
                      <td>{p.rounds > 0 ? pct(p.holePct) : '—'}</td>
                      <td>{p.rounds > 0 ? pct(p.inPlayPct) : '—'}</td>
                      <td>{p.fourBaggers}</td>
                      <td>{p.bestRound}</td>
                      <td>{p.currentStreak > 1 ? `${p.currentStreak}W` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Only for the selected player. The unscoped list of every pair grew
              as n(n-1)/2 — 42 rows at 11 players, and you had to check both
              columns of each to find yourself, because headToHead keys a pair
              low-name-first. `opponentRecords` puts the subject on one side. */}
          {subject && (
            <section className="stats-section">
              <h2>
                {subject.name}
                <span className="rivals-sub">
                  {DOT}
                  {worst || best ? (
                    <>
                      {worst && (
                        <>
                          nemesis <b>{worst.name}</b>
                        </>
                      )}
                      {worst && best && DOT}
                      {best && (
                        <>
                          dominates <b>{best.name}</b>
                        </>
                      )}
                    </>
                  ) : (
                    `no rivalries yet — needs ${RIVAL_MIN_MEETINGS} meetings`
                  )}
                </span>
              </h2>
              {rivals.length > 0 ? (
                /* The captions live inside the bordered box with the rows, or they
                   read as a stray line above an unrelated list. */
                <div className="rivals">
                  {/* The old list bracketed the score between both names, so which
                      way round it read was self-evident. With one name it isn't:
                      "Sigma 13–18" has to say whose 13 that is. */}
                  <div className="rivals-head" aria-hidden="true">
                    <span>Opponent</span>
                    <span>W–L</span>
                  </div>
                  <ul className="h2h">
                    {rivals.map((o) => (
                      <li key={o.name}>
                        <span className="h2h-name">{o.name}</span>
                        {/* Named rather than shaded. A darker row says *something*
                            is special without saying what, and there is room here
                            for the word. "Dominated" describes the opponent, the
                            way "nemesis" does — "dominates" on their row reads as
                            though they are the one doing it. */}
                        {o === worst && <span className="rival-tag">nemesis</span>}
                        {o === best && <span className="rival-tag">dominated</span>}
                        <span className="h2h-score">
                          <span className="h2h-spoken">
                            {o.wins} won, {o.losses} lost against {o.name}
                            {o === worst ? ', their nemesis' : ''}
                            {o === best ? ', whom they dominate' : ''}
                          </span>
                          <span aria-hidden="true">
                            {o.wins}–{o.losses}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="rivals-none">No opponents yet.</p>
              )}
              <p className="rivals-foot">
                <span>
                  {rivals.length} opponent{rivals.length === 1 ? '' : 's'} ·{' '}
                  {rivals.reduce((n, o) => n + o.met, 0)} meetings
                </span>
                <button className="match-edit" onClick={() => setRenaming(subject)}>
                  Rename {subject.name}
                </button>
              </p>
            </section>
          )}

          <section className="stats-section">
            <h2>{subject ? `${subject.name}${DOT}recent matches` : 'Recent matches'}</h2>
            <ul className="recent">
              {recent.map((m) => {
                const final = finalScore(m);
                const open = openId === m.id;
                const label = `${teamLabel(m, 'a')} v ${teamLabel(m, 'b')} on ${shortDate(m.endedAt)}`;
                return (
                  <li key={m.id} className={open ? 'is-open' : ''}>
                    <div className="recent-row">
                      <button
                        className="recent-open"
                        onClick={() => setOpenId(open ? null : m.id)}
                        aria-expanded={open}
                        aria-controls={`rounds-${m.id}`}
                      >
                        <span className="recent-date">{shortDate(m.endedAt)}</span>
                        <span className="recent-teams">
                          <span style={{ color: m.colors?.a }}>{teamLabel(m, 'a')}</span>
                          <span className="recent-v"> v </span>
                          <span style={{ color: m.colors?.b }}>{teamLabel(m, 'b')}</span>
                        </span>
                        <span className="recent-score">
                          {final ? `${final.a}–${final.b}` : '—'}
                        </span>
                        {/* Rotated rather than swapped for ⌃: the two
                            arrowheads are unrelated codepoints and render at
                            different sizes, so the marker jumped on toggle. */}
                        <span className="recent-chevron" aria-hidden="true">
                          ⌄
                        </span>
                      </button>
                      <button
                        className="recent-delete"
                        onClick={() => deleteMatch(m)}
                        aria-label={`Delete ${label}`}
                        title="Delete this match"
                      >
                        ×
                      </button>
                    </div>
                    {open && (
                      <MatchRounds
                        id={`rounds-${m.id}`}
                        match={m}
                        onEdit={() => setEditing(m)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}

      <section className="stats-section">
        <h2>Keeping this history</h2>
        <div className="durability">
          <p className={persisted === true ? 'durability-ok' : 'durability-warn'}>
            {DURABILITY[String(persisted)]}
          </p>
          {pending > 0 && (
            <p className="durability-pending">
              {matchCount(pending)} since your last export.
            </p>
          )}
          <div className="durability-actions">
            <button onClick={exportMatches} disabled={matches.length === 0}>
              Export as JSON
            </button>
            <label className="file-button">
              Import JSON
              <input type="file" accept="application/json,.json" onChange={importMatches} />
            </label>
          </div>
          {notice && <p className="durability-notice">{notice}</p>}
        </div>
      </section>

      {editing && (
        <MatchNames
          match={editing}
          onCancel={() => setEditing(null)}
          onSave={(players) => saveNames(editing.id, players)}
        />
      )}

      {renaming && (
        <RenamePlayer
          player={renaming}
          players={players}
          onCancel={() => setRenaming(null)}
          onSave={(to) => renamePlayer(renaming.name, to)}
        />
      )}
    </div>
  );
}

// Opened by mounting, so the caller keeps the "which thing am I editing" state
// and there is no ref to toggle. Deliberately *not* dismissed by a click on the
// backdrop, the way App.jsx's confirm dialog is: both of these hold a name that
// has been typed, and losing it to a stray tap is worse than one more press on
// Cancel. Escape still closes, through `onClose`.
function Modal({ children, onClose }) {
  const dialog = useRef(null);
  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);
  return (
    <dialog className="modal" ref={dialog} onClose={onClose}>
      {children}
    </dialog>
  );
}

// Renaming everywhere, from the career row that shows the wrong name. This is
// also how two spellings become one person and how a phantom player created by a
// typo is folded back in — renaming onto an existing name is a merge, because
// name-folding is the only identity there is.
function RenamePlayer({ player, players, onCancel, onSave }) {
  const [value, setValue] = useState(player.name);

  const to = value.trim();
  const key = nameKey(to);
  const changed = Boolean(to) && to !== player.name;
  const merges = players.find((p) => p.name !== player.name && nameKey(p.name) === key);

  return (
    <Modal onClose={onCancel}>
      <p className="modal-title">Rename {player.name}</p>
      <p className="modal-body">
        In {matchCount(player.matches)}, and in the lineup for the next game.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (changed) onSave(to);
        }}
      >
        {/* Same 16 as the setup field: it is the cap the scoreboard payload's
            byte budget was measured against. */}
        <input
          className="rename-input"
          value={value}
          maxLength={16}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          aria-label={`New name for ${player.name}`}
        />
        {merges && (
          <p className="rename-note">
            {merges.name} already has {matchCount(merges.matches)}. They&apos;ll be counted
            as one player from now on, and this screen can&apos;t split them again.
          </p>
        )}
        <div className="confirm-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="confirm-primary" disabled={!changed}>
            {merges ? 'Merge' : 'Rename'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// One match's lineup. Slot order is half the fix in doubles and not just
// spelling — `throwerFor` credits a round to a slot — so each row says which
// board that player threw from all game.
function MatchNames({ match, onCancel, onSave }) {
  const doubles = match.mode === 'doubles';
  const slots = doubles ? [0, 1] : [0];
  const [draft, setDraft] = useState(() => ({
    a: match.players.a.slice(),
    b: match.players.b.slice(),
  }));

  const set = (team, i, value) =>
    setDraft((d) => ({ ...d, [team]: d[team].map((n, at) => (at === i ? value : n)) }));
  const keysFor = (team) => slots.map((i) => nameKey(draft[team][i])).filter(Boolean);
  const blank = ['a', 'b'].some((team) => keysFor(team).length < slots.length);
  // One name on both sides of the court is worth saying and not worth refusing:
  // the default doubles lineup is already like that, so blocking it would leave
  // exactly the records most in need of editing uneditable.
  const shared = keysFor('a').filter((k) => keysFor('b').includes(k));

  return (
    <Modal onClose={onCancel}>
      <p className="modal-title">Names in this match</p>
      <p className="modal-body">
        {shortDate(match.endedAt)} · {teamLabel(match, 'a')} v {teamLabel(match, 'b')}
      </p>
      <form
        className="match-names"
        onSubmit={(e) => {
          e.preventDefault();
          if (!blank) {
            onSave({
              a: draft.a.map((n) => String(n ?? '').trim()),
              b: draft.b.map((n) => String(n ?? '').trim()),
            });
          }
        }}
      >
        {/* Which column is which end. Otherwise these are two identical boxes and
            picking the wrong one silently moves half the rounds to the other
            partner. Hidden from a reader — each field's own label says it. */}
        {doubles && (
          <div className="match-name-heads" aria-hidden="true">
            {BOARD_NAME.map((board) => (
              <span key={board}>{board} board</span>
            ))}
          </div>
        )}
        {['a', 'b'].map((team) => (
          <div className="match-name-team" key={team}>
            {slots.map((i) => (
              <input
                key={i}
                className="match-name-input"
                value={draft[team][i] ?? ''}
                maxLength={16}
                style={{ color: match.colors?.[team] }}
                onChange={(e) => set(team, i, e.target.value)}
                aria-label={
                  doubles
                    ? `Team ${team.toUpperCase()} player at the ${BOARD_NAME[i]} board`
                    : `Team ${team.toUpperCase()} player name`
                }
              />
            ))}
          </div>
        ))}
        {shared.length > 0 && (
          <p className="match-names-note">
            One name is on both teams, so those throws count for each side.
          </p>
        )}
        <div className="confirm-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="confirm-primary" disabled={blank}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Round-by-round, using the same shorthand as the in-play history (◎ hole,
// ▬ board) so the two read alike.
function MatchRounds({ id, match, onEdit }) {
  const rounds = matchRounds(match);
  const detailed = hasRounds(match);
  const doubles = match.mode === 'doubles';
  const span = matchDuration(match);
  // Left out rather than shown as a dash when it can't be known — a match saved
  // before start times existed simply doesn't have one.
  const facts = [
    detailed
      ? `${rounds.length} round${rounds.length === 1 ? '' : 's'}${span ? ` in ${minutes(span)}` : ''}`
      : 'result only, no rounds recorded',
    `played to ${match.target}`,
    ...(doubles ? ['doubles'] : []),
  ];
  return (
    <div className="match-rounds" id={id}>
      {/* No column headings over an empty table: for an imported result the
          footer below is the whole of what is known. */}
      {detailed && (
        <div className="match-rounds-head">
          <span>Rd</span>
          <span style={{ color: match.colors?.a }}>{teamLabel(match, 'a')}</span>
          <span style={{ color: match.colors?.b }}>{teamLabel(match, 'b')}</span>
          <span>Score</span>
        </div>
      )}
      {rounds.map((r) => (
        <div className={`match-round${r.wash ? ' is-wash' : ''}`} key={r.n}>
          <span className="mr-n">
            R{r.n}
            {r.wash && <em>wash</em>}
          </span>
          {['a', 'b'].map((team) => (
            <span className="mr-side" key={team}>
              {doubles && <em className="mr-thrower">{r[team].thrower}</em>}
              <span className={r[team].fourBagger ? 'mr-counts is-four' : 'mr-counts'}>
                {r[team].hole}◎ {r[team].board}▬
                <b style={{ color: match.colors?.[team] }}>+{r[team].net}</b>
              </span>
            </span>
          ))}
          <span className="mr-running">
            <span style={{ color: match.colors?.a }}>{r.running.a}</span>
            <span className="recent-v">–</span>
            <span style={{ color: match.colors?.b }}>{r.running.b}</span>
          </span>
        </div>
      ))}
      <p className="match-rounds-foot">
        <span>{facts.join(' · ')}</span>
        <button className="match-edit" onClick={onEdit}>
          Edit names
        </button>
      </p>
    </div>
  );
}

function Chip({ label, value }) {
  return (
    <div className="stat-chip">
      <span className="stat-chip-value">{value}</span>
      <span className="stat-chip-label">{label}</span>
    </div>
  );
}
