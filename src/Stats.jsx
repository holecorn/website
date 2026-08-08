import { useMemo, useState } from 'react';
import { BOARD_NAME, nameKey, teamLabel } from './scoring.js';
import {
  dropMatch,
  loadArchive,
  loadLastExport,
  mergeMatches,
  newestEnd,
  saveArchive,
  saveLastExport,
  saveMatchPlayers,
  savePlayerRename,
  unexportedCount,
  archiveFile,
  readArchiveFile,
} from './archive.js';
import {
  loadTournaments,
  tieLabels,
  mergeTournaments,
  saveEntrantRename,
  saveTournaments,
} from './tournament.js';
import {
  playerStats,
  playedIn,
  FORM_LENGTH,
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
import {
  inactiveKeys,
  loadInactive,
  markActive,
  markInactive,
  mergeInactive,
  renameMark,
  saveInactive,
} from './inactive.js';
import { UNREADABLE } from './store.js';
import { NAME_FIELD } from './nameField.js';
import { shortDate } from './dates.js';
import { minutes, one, pct, plural } from './format.js';
import Chip, { Chips } from './Chip.jsx';
import FormPips from './FormPips.jsx';
import Modal from './Modal.jsx';
import './Stats.css';

const matchCount = (n) => `${n} ${plural(n, 'match', 'matches')}`;
const tournamentCount = (n) => `${n} ${plural(n, 'tournament', 'tournaments')}`;
// One page of the recent list. The list is **paged rather than capped**, and that is not a
// browsing nicety: delete, the round-by-round expansion and Edit names all live *inside* a
// row, so a match the list won't draw cannot be opened, corrected or deleted at all.
// Measured on the sample archive, a hard cap of 12 — with the per-player scoping already
// counted — left 86 of 156 matches (55%) with none of the three, the newest five months old.
const RECENT_PER_PAGE = 12;
// One separator for every join in the rivals heading, so the gap after the
// player's name matches the gap between the two rivalries rather than being a
// margin that has to be eyeballed against it.
const DOT = ' · ';

// Said whenever a write on this screen is refused. Every one of them now sets state
// from what storage actually holds and reports the refusal, rather than handing back
// the list it was given — which looked like it had worked until the next reload.
const FULL =
  'There’s no room on this phone, so that didn’t save. Export below, then delete some matches.';

// The other refusal, and it needs its own words rather than reusing the one above: the
// history this cannot read is not *on the screen*, so the empty tables would be exported
// as a backup and there is nothing listed to delete. See `store.js` for what causes it.
const NEWER =
  'This phone’s history was written by a newer version of Holecorn, so nothing here can change it. It hasn’t been lost — close the app and reopen it to update.';

const refusal = (write) => (write.reason === UNREADABLE ? NEWER : FULL);

// Wipe the history and start again. **Development only** — `import.meta.env.DEV` is a
// compile-time constant, so Vite eliminates the whole branch and the built app cannot
// contain this control. That is the point: the archive is the one thing in here with no
// backstop but an export, ITP can already delete it, and a one-tap way to lose every
// game ever played does not belong on a phone people score on.
//
// Reached over a LAN IP on a real phone, which is where the app actually gets tested and
// where devtools are not to hand.
//
// Keyed by prefix rather than by an imported list, so a new key added anywhere is
// cleared without this having to be told about it. The scoreboard's two are kept
// deliberately: a broker URL, user and password are a nuisance to retype, and they are
// not history.
const KEEP = ['holecorn.scoreboard.v1', 'holecorn.scoreboard.display.v1'];

function wipeLocalHistory() {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('holecorn.') && !KEEP.includes(key)) localStorage.removeItem(key);
  }
  // Reloaded rather than setting state back: the game, the archive and the tournaments
  // are held in three places above this screen, and a fresh load is the only thing that
  // is certainly consistent with empty storage.
  window.location.reload();
}

function DevReset() {
  const [armed, setArmed] = useState(false);
  if (!import.meta.env.DEV) return null;
  return (
    <div className="dev-reset">
      <button type="button" onClick={() => (armed ? wipeLocalHistory() : setArmed(true))}>
        {armed ? 'Really wipe everything?' : 'Wipe local history (dev)'}
      </button>
      {armed && (
        <button type="button" onClick={() => setArmed(false)}>
          Cancel
        </button>
      )}
    </div>
  );
}

const DURABILITY = {
  true: 'This browser has agreed to keep your history.',
  false:
    'This browser has not agreed to keep your history. On iOS, Safari clears it after about a week of not opening the site — adding Holecorn to your home screen fixes that. Export in the meantime.',
  null: 'This browser will not say whether it keeps your history, so export from time to time.',
};

export default function Stats({ onBack, persisted, onRenamePlayer }) {
  const [matches, setMatches] = useState(loadArchive);
  // Read alongside the archive, so a match can say which tie it was. Nothing on this
  // screen edits a tournament; import is the one path that writes the list back.
  const [tournaments, setTournaments] = useState(loadTournaments);
  // Owned here while the screen is open, like the two above, because this is the one
  // screen that sets it. App re-reads on the way back.
  const [inactive, setInactive] = useState(loadInactive);
  const [lastExport, setLastExport] = useState(loadLastExport);
  const [notice, setNotice] = useState(null);
  // One match open at a time, so a long history doesn't unroll into a wall.
  const [openId, setOpenId] = useState(null);
  // Both editors are modal, so the screen holds which record or player is being
  // edited and the dialog opens by being mounted.
  const [editing, setEditing] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [dropping, setDropping] = useState(null);
  // Whose stats the screen is showing below the table, or null for nobody. Held
  // as a nameKey rather than a display name so it survives the fold that
  // playerStats already applies, and transient like openId — a scope you set
  // while looking, not a setting.
  const [selected, setSelected] = useState(null);
  // Which page of the recent list. Held as the page asked for and clamped on the way out
  // rather than reset by anything, so deleting the last match on the final page, importing
  // a file and scoping to a player all land somewhere valid with nothing to remember.
  const [page, setPage] = useState(0);

  const totalsFor = useMemo(() => summary(matches), [matches]);
  // Which tie each match was, if any. Keyed by match id, because nothing on a record says
  // where in a bracket it sat — `tieLabels` works it back out from the two sides.
  const ties = useMemo(() => tieLabels(tournaments, matches), [tournaments, matches]);
  const players = useMemo(() => playerStats(matches), [matches]);
  // Who is currently hidden from the name fields. Derived rather than read straight
  // off the marks, so somebody who has played since being marked reads as back —
  // here as well as on the screens that offer them.
  const hidden = useMemo(() => inactiveKeys(inactive, matches), [inactive, matches]);
  // Resolved from the list rather than held alongside it, so a player who has
  // just lost their last match to a deletion takes the panel with them.
  const subject = players.find((p) => nameKey(p.name) === selected) ?? null;
  const rivals = useMemo(
    () => (subject ? opponentRecords(matches, subject.name) : []),
    [matches, subject],
  );
  const worst = nemesis(rivals);
  const best = dominates(rivals);
  // Every match, newest first, scoped to the selected player. Scoping is not a nicety:
  // measured on the sample archive four of eleven players appear in none of the twelve
  // newest matches — Tau with 37 played — so before it they had to be paged to.
  const recent = useMemo(() => {
    const mine = subject ? matches.filter((m) => playedIn(m, subject.name)) : matches;
    return [...mine].sort((x, y) => (y.endedAt ?? 0) - (x.endedAt ?? 0));
  }, [matches, subject]);
  // A page is always in range because it is clamped here rather than reset by whatever
  // shortened the list. `pages` is at least 1, so an empty scope has a page to be on.
  // Clamped at both ends, the way `goTo` in `Tournament.jsx` is, which is what lets the
  // arrows below be `aria-disabled` rather than `disabled`: a press at either end arrives
  // here and is absorbed, so no handler needs to know it was inert.
  const pages = Math.max(1, Math.ceil(recent.length / RECENT_PER_PAGE));
  const at = Math.min(Math.max(page, 0), pages - 1);
  const from = at * RECENT_PER_PAGE;
  const shown = recent.slice(from, from + RECENT_PER_PAGE);
  const pending = unexportedCount(matches, lastExport);

  // One writer for the scope, because the page has to come back to the top with it:
  // clamping keeps page 5 of Tau's history *valid*, and it is still an arbitrary place to
  // land from pressing their name.
  const selectPlayer = (key) => {
    setSelected(key);
    setPage(0);
  };

  // Asked rather than undone, the way a tournament is deleted — and the delete lives
  // inside the open match for the same reason its does. It used to be one tap on the
  // row and an undo bar, which the row had no room for: the bar sat at the top of a
  // screen you have scrolled to the bottom of, so measured it rendered 486px above the
  // viewport and a deletion looked like a row simply vanishing.
  const deleteMatch = (record) => {
    const write = dropMatch(record.id);
    setMatches(write.stored);
    setDropping(null);
    if (!write.saved) return setNotice(refusal(write));
    setNotice(null);
    if (openId === record.id) setOpenId(null);
  };

  // A name that was wrong for one game only — a typo caught after Start game, or
  // the wrong person credited for a doubles end. Confined to that record.
  const saveNames = (id, players) => {
    const write = saveMatchPlayers(id, players, Date.now());
    setMatches(write.stored);
    if (!write.saved) return setNotice(refusal(write));
    setEditing(null);
    setNotice(null);
  };

  // The same person under a new name: every match, and the lineup waiting on the
  // setup screen, so the old spelling can't walk straight back into the next
  // game. Safe to touch that lineup because this screen is only reachable from
  // setup, where nothing has been thrown yet.
  // `merges` comes from the dialog, which has already had to answer that to word
  // itself: two spellings of "this name already has a career" is drift with no symptom.
  const renamePlayer = (from, to, merges) => {
    const write = savePlayerRename(from, to, Date.now());
    setMatches(write.stored);
    if (!write.saved) return setNotice(refusal(write));
    // The draw names people too, and `bracket()` matches a tie by `sideKeyOf` — so a
    // spelling that moves in the archive and not in `entrants`/`champion`/`runnerUp`
    // un-plays every tie this person appeared in, silently. See `renameEntrant`.
    setTournaments(saveEntrantRename(from, to).stored);
    // The mark is keyed by name, so it has to move with the person or it goes on
    // hiding a name nobody answers to. Whether this is a merge decides whose state
    // survives — see `renameMark`.
    setInactive(saveInactive(renameMark(inactive, from, to, merges)).stored);
    onRenamePlayer?.(from, to);
    setRenaming(null);
    setNotice(null);
    // Follow the rename, or the panel closes under whoever is being looked at —
    // and on a merge it follows them into the career they were folded into.
    selectPlayer(nameKey(to));
  };

  // Their matches and every number on this screen are untouched either way; all this
  // decides is whether the lineup fields and the tournament draw go on offering them.
  const setPlaying = (player, playing) => {
    const write = saveInactive(
      playing
        ? markActive(inactive, player.name)
        : markInactive(inactive, player.name, matches, Date.now()),
    );
    setInactive(write.stored);
    setNotice(write.saved ? null : refusal(write));
  };

  const exportMatches = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(archiveFile(matches, loadTournaments(), inactive), null, 2)], {
        type: 'application/json',
      }),
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
      const data = readArchiveFile(JSON.parse(await file.text()));
      if (!data) throw new Error('not an export');
      // Tournaments first: a tie that lands before its bracket does is a match
      // pointing at nothing, and the stats screen would draw it as an ordinary game.
      const tw = saveTournaments(mergeTournaments(loadTournaments(), data.tournaments));
      setTournaments(tw.stored);
      // Not counted in the notice below, unlike the other two: a mark is about
      // somebody the archive already knows, so it adds nothing to find and the
      // Players table says who is out.
      const iw = saveInactive(mergeInactive(loadInactive(), data.inactive));
      setInactive(iw.stored);
      const mw = saveArchive(mergeMatches(loadArchive(), data.matches));
      setMatches(mw.stored);
      // Counted against what storage actually holds, not against the merge that was
      // attempted — which is what made this notice actively wrong when the archive was
      // full: `saveArchive` pruned to fit and `added` was computed over the survivors,
      // so an import that destroyed 49 matches reported "Added 1 match." Nothing prunes
      // now, so the two agree except when a write is refused outright.
      const added = mw.stored.length - matches.length;
      // Counted as well as the matches, because a bracket can arrive without one. A
      // tournament deleted here is resurrected by a re-import — the ties were never
      // deleted, so it comes back with its results intact — and reporting only the
      // archive said "nothing new" at the moment a whole bracket reappeared.
      const addedTournaments = tw.stored.length - tournaments.length;
      // Whichever of the three refused first says why, because the two reasons want
      // opposite things done about them and a file can meet either.
      const refused = [mw, tw, iw].find((w) => !w.saved);
      if (refused) {
        setNotice(
          refused.reason === UNREADABLE
            ? NEWER
            : 'There’s no room on this phone for that file. Nothing was lost — export below, delete some matches, and try again.',
        );
        return;
      }
      setNotice(
        added === 0 && addedTournaments === 0
          ? "Nothing new — it's all already here."
          : `Added ${[
              added > 0 && matchCount(added),
              addedTournaments > 0 && tournamentCount(addedTournaments),
            ]
              .filter(Boolean)
              .join(' and ')}.`,
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

      {matches.length === 0 ? (
        <p className="stats-empty">
          No finished matches yet. Play a game through to the target and it will
          show up here — abandoned games aren&apos;t counted. If you have an
          export from another device, import it below.
        </p>
      ) : (
        <>
          <Chips>
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
          </Chips>

          <section className="stats-section">
            <h2>Players</h2>
            <div className="stats-scroll">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th scope="col">Player</th>
                    <th scope="col" title="Matches played">P</th>
                    <th scope="col" title="Won–lost">W–L</th>
                    <th scope="col" title={`Last ${FORM_LENGTH} matches, oldest first`}>
                      Last {FORM_LENGTH}
                    </th>
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
                      className={[
                        nameKey(p.name) === selected && 'is-selected',
                        // Dimmed rather than tagged: the sticky name column has no
                        // width to give a word. Dimming cannot say *what* is special,
                        // so the panel below does and the row carries it for a reader.
                        hidden.has(nameKey(p.name)) && 'is-inactive',
                      ]
                        .filter(Boolean)
                        .join(' ') || undefined}
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
                            selectPlayer(nameKey(p.name) === selected ? null : nameKey(p.name))
                          }
                          aria-pressed={nameKey(p.name) === selected}
                        >
                          {p.name}
                          {hidden.has(nameKey(p.name)) && (
                            <span className="visually-hidden">, inactive</span>
                          )}
                        </button>
                      </th>
                      <td>{p.matches}</td>
                      <td>
                        {p.wins}–{p.losses}
                      </td>
                      <td>
                        <FormPips results={p.form} />
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
                  {/* The one place the dimmed row is put into words, and the only
                      thing on this screen that says what marking somebody does:
                      every number above stays exactly as it is. */}
                  {hidden.has(nameKey(subject.name)) && (
                    <span className="rivals-inactive">Inactive · </span>
                  )}
                  {rivals.length} opponent{rivals.length === 1 ? '' : 's'} ·{' '}
                  {rivals.reduce((n, o) => n + o.met, 0)} meetings
                </span>
                {/* Beside Rename, and here for the same reason it is: a control in the
                    table would sit off-screen on a phone and turn a mis-tap into a
                    change rather than a selection. */}
                <span className="rivals-buttons">
                  <button
                    className="match-edit"
                    onClick={() => setPlaying(subject, hidden.has(nameKey(subject.name)))}
                  >
                    {hidden.has(nameKey(subject.name)) ? 'Mark active' : 'Mark inactive'}
                  </button>
                  <button className="match-edit" onClick={() => setRenaming(subject)}>
                    Rename {subject.name}
                  </button>
                </span>
              </p>
            </section>
          )}

          <section className="stats-section">
            <h2>{subject ? `${subject.name}${DOT}recent matches` : 'Recent matches'}</h2>
            {/* A marked row has to say what it is, not merely look special — the lesson the
                shaded nemesis row taught. Drawn only when the list actually holds a tie, so
                an archive with no tournaments spends nothing on it. */}
            {shown.some((m) => ties.has(m.id)) && (
              <p className="recent-key">
                <span className="recent-key-mark" aria-hidden="true" />
                Tournament tie
              </p>
            )}
            <ul className="recent">
              {shown.map((m) => {
                const final = finalScore(m);
                const open = openId === m.id;
                return (
                  <li
                    key={m.id}
                    className={`${open ? 'is-open' : ''}${ties.has(m.id) ? ' is-tie' : ''}`}
                  >
                    {/* The row's only control, which is what makes a mis-tap harmless:
                        it used to carry a 34px × six pixels from the chevron, so the
                        destructive target and the one you actually press every visit were
                        neighbours. Delete moved inside, the way rename moved out of the
                        Players table and for the same reason — a tap here can only open. */}
                    <button
                      className="recent-open"
                      onClick={() => setOpenId(open ? null : m.id)}
                      aria-expanded={open}
                      aria-controls={`rounds-${m.id}`}
                    >
                      <span className="recent-date">{shortDate(m.endedAt)}</span>
                      <span className="recent-teams">
                        <span className="team-ink" style={{ '--team': m.colors?.a }}>{teamLabel(m, 'a')}</span>
                        <span className="recent-v"> v </span>
                        <span className="team-ink" style={{ '--team': m.colors?.b }}>{teamLabel(m, 'b')}</span>
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
                    {open && (
                      <MatchRounds
                        id={`rounds-${m.id}`}
                        match={m}
                        tie={ties.get(m.id)}
                        onEdit={() => setEditing(m)}
                        onDelete={() => setDropping(m)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
            {/* Below the list rather than above it, because below is where the cut-off was:
                the twelfth row used to be the end of the archive as far as anything on
                screen said. Stepping reads off `at` rather than `page`, so a press moves
                from the page you are looking at even when the list has shrunk under it. */}
            {pages > 1 && (
              <div className="recent-paging">
                <span className="recent-at">
                  {from + 1}–{from + shown.length} of {recent.length}
                </span>
                {/* **`aria-disabled`, not `disabled`, and that is the whole reason the ends
                    are safe to offer.** A real `disabled` cannot hold focus, so pressing »
                    dropped focus to `BODY` — measured — leaving a keyboard user to Tab from
                    the top of the document, which is the fault the deleted undo bar had. The
                    press still lands and the clamp above absorbs it, so an inert arrow needs
                    no guard of its own.
                    Older and newer rather than previous and next, on all four: the list is in
                    date order, so the direction is the thing worth saying. The ends earn
                    their place because stepping does not scale — measured on the stress
                    fixture, 973 matches is 81 presses of › to reach 2020 and one of » — and
                    the oldest is a named errand, since the full-archive refusal tells you to
                    delete some matches and those are the ones to delete. */}
                <div className="recent-arrows">
                  <button
                    type="button"
                    onClick={() => setPage(0)}
                    aria-disabled={at === 0}
                    aria-label="Newest matches"
                  >
                    «
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage(at - 1)}
                    aria-disabled={at === 0}
                    aria-label="Newer matches"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage(at + 1)}
                    aria-disabled={at === pages - 1}
                    aria-label="Older matches"
                  >
                    ›
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage(pages - 1)}
                    aria-disabled={at === pages - 1}
                    aria-label="Oldest matches"
                  >
                    »
                  </button>
                </div>
              </div>
            )}
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
              <input
                className="visually-hidden"
                type="file"
                accept="application/json,.json"
                onChange={importMatches}
              />
            </label>
          </div>
          {notice && <p className="durability-notice">{notice}</p>}
          <DevReset />
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
          onSave={(to, merges) => renamePlayer(renaming.name, to, merges)}
        />
      )}

      {dropping && (
        <Modal onClose={() => setDropping(null)}>
          <p className="modal-title">
            Delete {teamLabel(dropping, 'a')} v {teamLabel(dropping, 'b')}?
          </p>
          <p className="modal-body">
            Played {shortDate(dropping.endedAt)}. It stops counting towards
            everyone&apos;s record, and there is no undo — an export is the only way
            back.{' '}
            {/* The one thing worth saying that an undo bar could not have carried, the
                same reason the tournament dialog says what survives it: the bracket is
                derived from the archive, so deleting a tie puts it back on the sheet as
                still to play, on a screen this one gives no hint of. */}
            {ties.has(dropping.id) &&
              `${ties.get(dropping.id).name} will show its ${ties.get(dropping.id).round} as still to play.`}
          </p>
          <div className="confirm-actions">
            <button onClick={() => setDropping(null)}>Cancel</button>
            <button className="confirm-danger" onClick={() => deleteMatch(dropping)}>
              Delete
            </button>
          </div>
        </Modal>
      )}
    </div>
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
          if (changed) onSave(to, Boolean(merges));
        }}
      >
        {/* Same 16 as the setup field: it is the cap the scoreboard payload's
            byte budget was measured against. */}
        <input
          className="rename-input"
          {...NAME_FIELD}
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
                className="match-name-input team-ink"
                {...NAME_FIELD}
                value={draft[team][i] ?? ''}
                maxLength={16}
                style={{ '--team': match.colors?.[team] }}
                onChange={(e) => set(team, i, e.target.value)}
                aria-label={
                  doubles
                    ? `Team ${team.toUpperCase()} player at the ${BOARD_NAME[i]} board`
                    : `Team ${team.toUpperCase()} player`
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
function MatchRounds({ id, match, tie, onEdit, onDelete }) {
  const rounds = matchRounds(match);
  const detailed = hasRounds(match);
  const doubles = match.mode === 'doubles';
  const span = matchDuration(match);
  // Left out rather than shown as a dash when it can't be known — a match saved
  // before start times existed simply doesn't have one.
  const facts = [
    // First, because it is the thing that makes this match different from the rest of the
    // list — and the only place the tournament and the round are named.
    ...(tie ? [`${tie.name}${DOT}${tie.round}`] : []),
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
          <span className="team-ink" style={{ '--team': match.colors?.a }}>{teamLabel(match, 'a')}</span>
          <span className="team-ink" style={{ '--team': match.colors?.b }}>{teamLabel(match, 'b')}</span>
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
                <b className="team-ink" style={{ '--team': match.colors?.[team] }}>
                  +{r[team].net}
                </b>
              </span>
            </span>
          ))}
          <span className="mr-running">
            <span className="team-ink" style={{ '--team': match.colors?.a }}>{r.running.a}</span>
            <span className="recent-v">–</span>
            <span className="team-ink" style={{ '--team': match.colors?.b }}>{r.running.b}</span>
          </span>
        </div>
      ))}
      <p className="match-rounds-foot">
        <span>{facts.join(' · ')}</span>
        <button className="match-edit" onClick={onEdit}>
          Edit names
        </button>
        <button className="match-drop" onClick={onDelete}>
          Delete
        </button>
      </p>
    </div>
  );
}

