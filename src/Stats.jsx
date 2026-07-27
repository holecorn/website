import { useMemo, useState } from 'react';
import { totals, teamLabel } from './scoring.js';
import {
  dropMatch,
  loadArchive,
  loadLastExport,
  mergeMatches,
  newestEnd,
  restoreMatch,
  saveArchive,
  saveLastExport,
  unexportedCount,
} from './archive.js';
import { playerStats, headToHead, summary, matchRounds, matchDuration } from './stats.js';
import './Stats.css';

const pct = (v) => `${Math.round(v * 100)}%`;
const one = (v) => v.toFixed(1);
const matchCount = (n) => `${n} match${n === 1 ? '' : 'es'}`;

const shortDate = (ms) =>
  ms ? new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';

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

export default function Stats({ onBack, persisted }) {
  const [matches, setMatches] = useState(loadArchive);
  const [lastExport, setLastExport] = useState(loadLastExport);
  const [notice, setNotice] = useState(null);
  const [deleted, setDeleted] = useState(null);
  // One match open at a time, so a long history doesn't unroll into a wall.
  const [openId, setOpenId] = useState(null);

  const totalsFor = useMemo(() => summary(matches), [matches]);
  const players = useMemo(() => playerStats(matches), [matches]);
  const pairs = useMemo(() => headToHead(matches), [matches]);
  const recent = useMemo(
    () => [...matches].sort((x, y) => (y.endedAt ?? 0) - (x.endedAt ?? 0)).slice(0, 12),
    [matches],
  );
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
            <Chip label="matches" value={totalsFor.matches} />
            <Chip label="rounds" value={totalsFor.rounds} />
            <Chip label="avg rounds" value={one(totalsFor.avgRounds)} />
            <Chip label="avg length" value={minutes(totalsFor.avgDurationMs)} />
            <Chip label="washes" value={totalsFor.washes} />
            <Chip label="four baggers" value={totalsFor.fourBaggers} />
            <Chip label="skunks" value={totalsFor.skunks} />
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
                    <tr key={p.name}>
                      <th scope="row">{p.name}</th>
                      <td>{p.matches}</td>
                      <td>
                        {p.wins}–{p.losses}
                      </td>
                      <td>{p.rounds}</td>
                      <td>{one(p.ppr)}</td>
                      <td>{pct(p.holePct)}</td>
                      <td>{pct(p.inPlayPct)}</td>
                      <td>{p.fourBaggers}</td>
                      <td>{p.bestRound}</td>
                      <td>{p.currentStreak > 1 ? `${p.currentStreak}W` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {pairs.length > 0 && (
            <section className="stats-section">
              <h2>Head to head</h2>
              <ul className="h2h">
                {pairs.map((pair) => (
                  <li key={`${pair.a}-${pair.b}`}>
                    <span className="h2h-name">{pair.a}</span>
                    <span className="h2h-score">
                      {pair.aWins}–{pair.bWins}
                    </span>
                    <span className="h2h-name h2h-right">{pair.b}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="stats-section">
            <h2>Recent matches</h2>
            <ul className="recent">
              {recent.map((m) => {
                const final = totals(m);
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
                          {final.a}–{final.b}
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
                    {open && <MatchRounds id={`rounds-${m.id}`} match={m} />}
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
    </div>
  );
}

// Round-by-round, using the same shorthand as the in-play history (◎ hole,
// ▬ board) so the two read alike.
function MatchRounds({ id, match }) {
  const rounds = matchRounds(match);
  const doubles = match.mode === 'doubles';
  const span = matchDuration(match);
  // Left out rather than shown as a dash when it can't be known — a match saved
  // before start times existed simply doesn't have one.
  const facts = [
    `${rounds.length} round${rounds.length === 1 ? '' : 's'}${span ? ` in ${minutes(span)}` : ''}`,
    `played to ${match.target}`,
    ...(doubles ? ['doubles'] : []),
  ];
  return (
    <div className="match-rounds" id={id}>
      <div className="match-rounds-head">
        <span>Rd</span>
        <span style={{ color: match.colors?.a }}>{teamLabel(match, 'a')}</span>
        <span style={{ color: match.colors?.b }}>{teamLabel(match, 'b')}</span>
        <span>Score</span>
      </div>
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
      <p className="match-rounds-foot">{facts.join(' · ')}</p>
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
