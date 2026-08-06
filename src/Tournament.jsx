// The knockout bracket screen: takes the draw, shows the bracket filling in, and
// hands a tie to the scoring screen.
//
// It draws only. Every question about the bracket — who is through, which ties can be
// played, who won — is answered by `bracket()` in tournament.js from the stored draw
// plus the archive, so there is nothing here to keep in step with the results.
//
// Reachable only from `setup`, the same rule `Stats` follows: this screen can delete a
// tournament, and doing that while one of its ties was the live game would leave a
// record pointing at a bracket that no longer exists.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { newMatchId } from './archive.js';
import { DEFAULT_TARGET, MAX_TARGET, clampTarget, nameKey, sideLabel } from './scoring.js';
import { hasRounds, summary } from './stats.js';
import {
  MIN_ENTRANTS,
  bracket,
  bracketTree,
  drawSteps,
  entrantFaults,
  entrantStats,
  groupBySeries,
  lastPlayed,
  levelName,
  newTournament,
  newestFirst,
  nextEditions,
  routeFor,
  seriesStats,
  shuffled,
  tieExtremes,
  tieHistory,
  tieMatches,
} from './tournament.js';
import { NAME_FIELD } from './nameField.js';
import { dateSpan, dropRepeatedYear, sameDay, shortDate } from './dates.js';
import { minutes, one, pct, plural } from './format.js';
import Chip, { Chips } from './Chip.jsx';
import Modal from './Modal.jsx';
import './Tournament.css';

// The same separator the stats screen's headings use, so a join reads alike throughout.
const DOT = ' · ';

// The two halves of an open tournament. The bracket is first and is what a row opens on:
// during a cup that is what you came for, and the numbers matter afterwards — which is
// exactly when the bracket has stopped changing.
const TABS = [
  ['bracket', 'Bracket'],
  ['stats', 'Stats'],
];

// Rounds are drawn deepest-first, so the screen reads the way the paper sheet does:
// the preliminaries at the top, the final at the bottom.
const sideNames = (side) => sideLabel(side.names.filter(Boolean));

// What one seat in the bracket says, which is a side's names once it has one and a plan
// until then. Naming what it is waiting for is most of what a bracket is for — "winner
// of Rho v Tau" is a plan, "—" is not.
//
// Two levels up, the feeder's own sides are unknown too, and recursing there reads as
// "winner of winner of ... v winner of ..." — so it falls back to the feeder's round.
// "winner of a quarter-final" is true and readable where "winner of ? v ?" is neither.
function seatLabel(side, from, ties, rounds) {
  if (side) return sideNames(side);
  const feeder = ties.find((t) => t.id === from);
  if (!feeder) return '—';
  if (feeder.a && feeder.b) return `winner of ${sideNames(feeder.a)} v ${sideNames(feeder.b)}`;
  const round = rounds.find((r) => r.level === feeder.level);
  return `winner of a ${round ? round.name.toLowerCase() : 'earlier tie'}`;
}

// A tie's box. When it can be played, **the box itself is the button** — nothing is added
// beside the names. Two things forced that: every box has to stay the same height or the
// tree's connectors stop lining up (see `bracketTree`), and the column is 176px, so a
// button beside the names would take a third of them. The green border already says which
// boxes are live; the corner marker and the accessible name say what a tap does.
function Tie({ tie, ties, rounds, onRoute, onPlay }) {
  const sides = [
    { side: tie.a, from: tie.fromA, points: tie.score?.a },
    { side: tie.b, from: tie.fromB, points: tie.score?.b },
  ];
  const played = Boolean(tie.match);
  const live = tie.playable && Boolean(onPlay);
  const Box = live ? 'button' : 'div';
  return (
    <Box
      className={`tie${tie.playable ? ' is-playable' : ''}${played ? ' is-played' : ''}${
        onRoute ? ' is-route' : ''
      }`}
      data-level={tie.level}
      {...(live
        ? {
            type: 'button',
            onClick: () => onPlay(tie),
            // The visible word is only a glyph, so the name has to carry who it is for —
            // a bracket of identical markers says nothing on its own.
            'aria-label': `Play ${seatLabel(tie.a, tie.fromA, ties, rounds)} against ${seatLabel(
              tie.b,
              tie.fromB,
              ties,
              rounds,
            )}`,
          }
        : {})}
    >
      <div className="tie-sides">
        {sides.map(({ side, from, points }, i) => (
          <span
            key={i}
            className={`tie-side${
              played && tie.winner && side?.key === tie.winner.key ? ' is-winner' : ''
            }${played && tie.winner && side?.key !== tie.winner.key ? ' is-loser' : ''}${
              side ? '' : ' is-waiting'
            }`}
          >
            <span className="tie-who">{seatLabel(side, from, ties, rounds)}</span>
            {/* Only where there is one. An imported result with no score recorded has
                no number to show, and `finalScore` is null rather than 0–0 for it. */}
            {Number.isFinite(points) && <span className="tie-points">{points}</span>}
          </span>
        ))}
      </div>
      {live && (
        <span className="tie-play" aria-hidden="true">
          ▶
        </span>
      )}
    </Box>
  );
}

// A single entrant who took a bye, drawn as a box of its own in the deepest column —
// which is what the paper sheet does with a lone name.
function Seat({ side, onRoute }) {
  return (
    <div className={`tie is-seat${onRoute ? ' is-route' : ''}`}>
      <div className="tie-sides">
        <span className="tie-side">
          <span className="tie-who">{sideNames(side)}</span>
        </span>
      </div>
    </div>
  );
}

// One node of the drawn bracket: its two children to the left, itself to the right.
// The columns are not laid out — they *emerge*, because every node is drawn this way
// and the tree above the deepest level is perfectly balanced, so each parent lands
// exactly between its two children with nothing measured. The connectors are drawn
// from each child's own centre to the boundary between the pair, which is the point
// the parent's stub arrives at.
function Node({ node, ties, rounds, route, onPlay }) {
  // A bye's seat is on the route too — it is where that entrant came into the bracket,
  // and a lit path that skips it starts in mid-air.
  if (node.seat) return <Seat side={node.seat} onRoute={node.seat?.key === route?.key} />;
  const kids = node.kids.length > 0;
  return (
    <div className={`node${kids ? ' has-kids' : ''}`}>
      {kids && (
        <div className="node-kids">
          {node.kids.map((kid, i) => (
            <div className="node-kid" key={kid.tie?.id ?? `seat${i}`}>
              <Node node={kid} ties={ties} rounds={rounds} route={route} onPlay={onPlay} />
            </div>
          ))}
        </div>
      )}
      <Tie
        tie={node.tie}
        ties={ties}
        rounds={rounds}
        onRoute={Boolean(route?.ids.has(node.tie.id))}
        onPlay={onPlay}
      />
    </div>
  );
}

function Bracket({ view, route, onClearRoute, onPlay }) {
  const tree = useMemo(() => bracketTree(view), [view]);
  const scroller = useRef(null);
  const ticking = useRef(0);
  const settling = useRef(0);
  // Where the arrows are heading. Held apart from `at` because the two answer different
  // questions during a smooth scroll: this is the column asked for, `at` is the column
  // on screen. Collapsing them is what made the heading flicker — see `goTo`.
  const wanted = useRef(0);
  // Which round is in view, and **the scroll position is its only writer**. The name in
  // the bar labels the column you are looking at, so a finger has to move it as well as
  // an arrow.
  // The deepest round that still has a playable tie, or the outermost if none has. With the
  // ready list gone this is what stops a live tie being two pages away on a phone; late in a
  // tournament it is the final, which is exactly where you want to be.
  const startAt = useMemo(() => {
    const i = view.rounds.findIndex((r) => r.ties.some((x) => x.playable));
    return i < 0 ? 0 : i;
  }, [view]);
  const [at, setAt] = useState(startAt);
  useEffect(() => () => {
    cancelAnimationFrame(ticking.current);
    clearTimeout(settling.current);
  }, []);

  // The label alone is not enough: `at` starts at the playable round while the scroller
  // starts at zero, so without this the bar names a round that is not on screen. Instant
  // rather than smooth — this is where the bracket opens, not somewhere it moves to.
  //
  // Above the early return below, because a hook cannot be called conditionally; the guard
  // is inside it instead.
  useLayoutEffect(() => {
    const s = scroller.current;
    const box = s?.querySelector(`[data-level="${view?.rounds?.[startAt]?.level}"]`);
    wanted.current = startAt;
    if (!s || !box) return;
    s.scrollTo({
      left: s.scrollLeft + box.getBoundingClientRect().left - s.getBoundingClientRect().left,
      behavior: 'auto',
    });
    setAt(startAt);
  }, [startAt, view]);

  if (!tree) return null;
  const columns = view.rounds.length;

  // Scrolled to the column rather than by a computed pitch, so the box width and the
  // connector gap stay CSS's business.
  //
  // Measured against the scroller rather than read from `offsetLeft`, which is relative
  // to the nearest *positioned* ancestor — and every `.node-kid` is positioned, because
  // that is what the connectors hang off. `offsetLeft` here is a box's offset inside its
  // own branch, so paging with it lands somewhere arbitrary.
  //
  // It deliberately does **not** set `at`. Doing both made the heading flicker on every
  // press — measured: the destination at 12ms, back to the origin at 27ms when the scroll
  // handler saw the old column still nearest, and the destination again at 110ms once the
  // scroll passed halfway. One writer, and the label simply follows the scroll.
  const goTo = (i) => {
    const next = Math.min(Math.max(i, 0), columns - 1);
    wanted.current = next;
    const box = scroller.current?.querySelector(`[data-level="${view.rounds[next].level}"]`);
    if (!box) return;
    const left =
      scroller.current.scrollLeft +
      box.getBoundingClientRect().left -
      scroller.current.getBoundingClientRect().left;
    scroller.current.scrollTo({ left, behavior: 'smooth' });
  };

  // Whichever column's left edge is nearest the left of the viewport. Read off the boxes
  // rather than a computed pitch, for the same reason `goTo` scrolls to one: the box
  // width and the connector gap stay CSS's business.
  const onScroll = () => {
    if (ticking.current) return;
    ticking.current = requestAnimationFrame(() => {
      ticking.current = 0;
      const s = scroller.current;
      if (!s) return;
      const base = s.getBoundingClientRect().left;
      let best = 0;
      let nearest = Infinity;
      view.rounds.forEach((round, i) => {
        const box = s.querySelector(`[data-level="${round.level}"]`);
        if (!box) return;
        const d = Math.abs(box.getBoundingClientRect().left - base);
        if (d < nearest) {
          nearest = d;
          best = i;
        }
      });
      setAt(best);
      // `wanted` syncs only once the scrolling stops, so a second press lands two columns
      // on rather than re-issuing the first. A smooth scroll keeps firing events, so the
      // timer cannot expire in the middle of one.
      clearTimeout(settling.current);
      settling.current = setTimeout(() => {
        wanted.current = best;
      }, 150);
    });
  };

  return (
    <div className={`bracket${route ? ' has-route' : ''}`}>
      {/* A dimmed bracket says *something* is special without saying what — the lesson
          the shaded nemesis row taught — so whose route is lit is named, and the way to
          put it back is beside the claim rather than on the tab that set it. */}
      {route && (
        <div className="bracket-route">
          <span className="bracket-route-who">
            <span className="result-cap">Route</span>
            {DOT}
            {route.names}
          </span>
          <button type="button" onClick={onClearRoute}>
            Clear
          </button>
        </div>
      )}
      {/* Only drawn where a column fills the screen. On a wide one every round is
          already visible, so stepping between them is a control with nothing to do. */}
      <div className="bracket-paging">
        <span className="bracket-at">{view.rounds[at]?.name}</span>
        {/* Grouped and pinned right, because the label beside them changes width as the
            rounds go by — measured, the arrows slid 73px between Quarter-final and
            Final, which walks the button out from under a thumb tapping it twice. */}
        <div className="bracket-arrows">
          <button
            type="button"
            onClick={() => goTo(wanted.current - 1)}
            disabled={at === 0}
            aria-label="Previous round"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => goTo(wanted.current + 1)}
            disabled={at === columns - 1}
            aria-label="Next round"
          >
            ›
          </button>
        </div>
      </div>
      {/* The headings live inside the scroller, so they move with the boxes they name.
          Outside it they were clipped instead: a bracket wider than its container
          scrolled while its headings stayed put and lost their last column. */}
      <div className="bracket-scroll" ref={scroller} onScroll={onScroll}>
        <div className="bracket-heads" aria-hidden="true">
          {view.rounds.map((round) => (
            <span className="bracket-head" key={round.level}>
              {round.name}
            </span>
          ))}
        </div>
        <Node node={tree} ties={view.ties} rounds={view.rounds} route={route} onPlay={onPlay} />
      </div>
    </div>
  );
}

// How far an entrant got, as the table says it. Three states rather than a round name,
// because a level alone cannot tell "lost the semi-final" from "about to play it" — see
// `reachedBy`. The champion is named rather than levelled: "Final" for the winner and
// "Final" for the runner-up would be true of both and useful about neither.
function reachedLabel(reached, shape) {
  if (reached.status === 'won') return 'Winner';
  if (!reached.level) return '—';
  const round = levelName(reached.level, shape);
  return reached.status === 'in' ? `In the ${round.toLowerCase()}` : round;
}

// A played tie read out winner first, which is how a result is spoken. The bracket's own
// boxes are the other way round — they hold the draw's order, because that is what makes
// a column of them line up with the tree.
function tieResult(tie) {
  const aWon = tie.winner && tie.a && tie.winner.key === tie.a.key;
  return {
    winner: sideNames(aWon ? tie.a : tie.b),
    loser: sideNames(aWon ? tie.b : tie.a),
    // Null for a result imported without a score, the way `finalScore` is.
    score: tie.score && (aWon ? tie.score : { a: tie.score.b, b: tie.score.a }),
  };
}

// One entrant's way through the bracket, from their own point of view. This is the
// "champion's route" generalised: the champion is simply whoever is selected when the
// answer runs to the end, so there is no special case for them.
function Route({ view, subject, route }) {
  return (
    <ol className="route">
      {route.map((tie) => {
        const mine = tie.a?.key === subject.key ? 'a' : 'b';
        const other = mine === 'a' ? 'b' : 'a';
        const opponent = seatLabel(
          tie[other],
          mine === 'a' ? tie.fromB : tie.fromA,
          view.ties,
          view.rounds,
        );
        const score = tie.score && `${tie.score[mine]}–${tie.score[other]}`;
        const won = tie.winner && tie.winner.key === subject.key;
        return (
          <li key={tie.id} className={tie.match ? undefined : 'is-waiting'}>
            <span className="route-round">{levelName(tie.level, view.shape)}</span>
            <span className="route-what">
              {!tie.match && `to play ${opponent}`}
              {tie.match && `${won ? 'beat' : 'lost to'} ${opponent}`}
              {score && ` ${score}`}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// The other half of an open tournament: how it has gone, rather than who is through.
//
// Everything here is derived in `tournament.js` from the view the bracket tab is drawing,
// so the two tabs cannot come to describe different ties — the same reason `lastPlayed`
// counts the bracket's ties rather than every record carrying the id.
function TournamentStats({ view, matches, selected, route, onSelect }) {
  const played = useMemo(() => tieMatches(view, matches), [view, matches]);
  const totalsFor = useMemo(() => summary(played), [played]);
  const rows = useMemo(() => entrantStats(view, matches), [view, matches]);
  const extremes = useMemo(() => tieExtremes(view), [view]);
  const history = useMemo(() => tieHistory(view, matches), [view, matches]);
  const subject = rows.find((r) => r.key === selected) ?? null;

  // **Whether any tie has round detail, not whether any has been played.** A tournament
  // reached by tagging records that were already in the archive is made entirely of
  // imported results, which carry a score and nothing behind it — so every rate would be
  // a dash, and a table of dashes reads as a fault rather than as a limitation. The same
  // trap the career table's `p.rounds > 0` guard exists for, one level up.
  const detail = played.some(hasRounds);

  if (view.played === 0) {
    return (
      <p className="tournament-none">
        Nothing has been played yet. Play a tie from the bracket and the numbers start here.
      </p>
    );
  }

  return (
    <div className="tournament-stats">
      <Chips>
        <Chip
          value={view.played}
          label={`of ${view.total} ${plural(view.total, 'tie', 'ties')}`}
        />
        {detail && (
          <>
            <Chip label={plural(totalsFor.rounds, 'round', 'rounds')} value={totalsFor.rounds} />
            <Chip label="avg rounds" value={one(totalsFor.avgRounds)} />
            <Chip label="avg length" value={minutes(totalsFor.avgDurationMs)} />
            <Chip label={plural(totalsFor.washes, 'wash', 'washes')} value={totalsFor.washes} />
            <Chip
              label={plural(totalsFor.fourBaggers, 'four bagger', 'four baggers')}
              value={totalsFor.fourBaggers}
            />
          </>
        )}
        {/* Kept whether or not there is round detail: a skunk is read off the final score,
            so it is one of the few things an imported result can still say. */}
        <Chip label={plural(totalsFor.skunks, 'skunk', 'skunks')} value={totalsFor.skunks} />
      </Chips>

      <section className="tournament-section">
        <h3>Entrants</h3>
        <div className="stats-scroll">
          <table className="stats-table">
            <thead>
              <tr>
                <th scope="col">Entrant</th>
                <th scope="col">Reached</th>
                <th scope="col" title="Ties played">
                  P
                </th>
                <th scope="col" title="Won–lost">
                  W–L
                </th>
                {detail && (
                  <>
                    <th scope="col" title="Rounds thrown">
                      Rds
                    </th>
                    <th scope="col" title="Raw bag points per round">
                      PPR
                    </th>
                    <th scope="col" title="Bags in the hole">
                      Hole
                    </th>
                    <th scope="col" title="Four baggers">
                      4B
                    </th>
                    <th scope="col" title="Best round">
                      Best
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={r.key === selected ? 'is-selected' : undefined}>
                  <th scope="row">
                    {/* The name is the select target for the reason it is on the career
                        table: it is the only cell always on screen, because the table
                        scrolls sideways and this column is sticky. */}
                    <button
                      className="player-select"
                      aria-pressed={r.key === selected}
                      onClick={() => onSelect(r.key === selected ? null : r.key)}
                    >
                      {sideLabel(r.names)}
                    </button>
                  </th>
                  <td className="entrant-reached">{reachedLabel(r.reached, view.shape)}</td>
                  <td>{r.matches}</td>
                  <td>
                    {r.wins}–{r.losses}
                  </td>
                  {detail && (
                    <>
                      <td>{r.rounds}</td>
                      {/* A rate over no rounds is undefined rather than zero, which is
                          reachable here even where the tournament has detail: an entrant
                          knocked out in a tie that was imported has played and thrown
                          nothing the archive can see. */}
                      <td>{r.rounds > 0 ? one(r.ppr) : '—'}</td>
                      <td>{r.rounds > 0 ? pct(r.holePct) : '—'}</td>
                      <td>{r.fourBaggers}</td>
                      <td>{r.bestRound}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!detail && (
          <p className="tournament-note">
            No round-by-round detail was recorded for these ties, so there are no rates to
            show — only the results.
          </p>
        )}
      </section>

      {subject && (
        <section className="tournament-section">
          <h3>
            {sideLabel(subject.names)}
            <span className="route-sub">
              {DOT}
              {reachedLabel(subject.reached, view.shape).toLowerCase()}
            </span>
          </h3>
          <Route view={view} subject={subject} route={route} />
          <p className="tournament-note">Their route is lit on the bracket.</p>
        </section>
      )}

      {extremes && (
        <section className="tournament-section">
          <h3>Ties worth remembering</h3>
          <ul className="tie-extremes">
            <Extreme label="Biggest win" view={view} found={extremes.widest} />
            {/* Absent rather than repeated where it would name the same tie — with one
                tie played, or with every tie won by the same margin, two headings over
                one result says the opposite of what either of them means. */}
            {extremes.closest && (
              <Extreme label="Closest" view={view} found={extremes.closest} />
            )}
          </ul>
        </section>
      )}

      <section className="tournament-section">
        {/* The order they were played in, which the drawn bracket structurally cannot
            show: it is grouped by round, and ties are played according to who is present,
            so a later round routinely goes before an earlier one elsewhere in the draw. */}
        <h3>As it was played</h3>
        <ul className="tie-log">
          {history.map(({ tie, round, endedAt }) => {
            const result = tieResult(tie);
            return (
              <li key={tie.id}>
                <span className="tie-log-who">
                  {result.winner}
                  {result.score && <b> {result.score.a}–{result.score.b} </b>}
                  {!result.score && ' beat '}
                  {result.loser}
                </span>
                <span className="tie-log-when">
                  {endedAt ? shortDate(endedAt) : 'undated'}
                  {DOT}
                  {round}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function Extreme({ label, view, found }) {
  const result = tieResult(found.tie);
  return (
    <li>
      <span className="result-cap">{label}</span>
      <span className="extreme-what">
        {result.winner} {result.score.a}–{result.score.b} {result.loser}
        <span className="extreme-round">
          {DOT}
          {levelName(found.tie.level, view.shape)}
        </span>
      </span>
    </li>
  );
}

// One row per entrant. In doubles an entrant is a pair, which is one side and one row
// — `sideKeyOf` reads it as a set, so the order the two names are typed in never
// matters, unlike the setup screen's slots where it decides who stands where.
function Entrants({ entrants, mode, faults, knownNames, taken, onChange, onRemove, onAdd }) {
  const faulted = new Map(faults.map((f) => [f.index, f.fault]));
  // Everyone the archive knows, less everyone already entered. `entrantFaults` refuses a
  // repeat, but being refused after typing is correction — dropping the name from the
  // list is prevention, which is the same reason the setup fields offer archived names
  // at all. Folded by `nameKey`, so a different spelling of the same person goes too.
  //
  // One list for every field rather than one per field: a field whose own value is in
  // it has no use for the suggestion, and the alternative is eleven copies of the roster
  // in the DOM.
  const offer = knownNames.filter((name) => !taken.has(nameKey(name)));
  return (
    <div className="entrants">
      {offer.length > 0 && (
        <datalist id="tournament-names">
          {offer.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      )}
      {/* Nothing at all until somebody is in, rather than an empty list: the form opens
          with no rows, and an `<ol>` still carries its own bottom margin. */}
      <ol hidden={entrants.length === 0}>
        {entrants.map((entrant, i) => (
          <li key={i} className={faulted.has(i) ? 'is-faulted' : undefined}>
            <span className="entrant-seed" aria-hidden="true">
              {i + 1}
            </span>
            {(mode === 'doubles' ? [0, 1] : [0]).map((slot) => (
              <input
                key={slot}
                className="entrant-name"
                {...NAME_FIELD}
                value={entrant[slot] ?? ''}
                maxLength={16}
                list={offer.length > 0 ? 'tournament-names' : undefined}
                aria-invalid={faulted.has(i) || undefined}
                aria-label={
                  mode === 'doubles'
                    ? `Entrant ${i + 1}, player ${slot + 1}`
                    : `Entrant ${i + 1}`
                }
                onChange={(e) => onChange(i, slot, e.target.value)}
              />
            ))}
            <button
              type="button"
              className="entrant-drop"
              onClick={() => onRemove(i)}
              aria-label={`Remove entrant ${i + 1}`}
            >
              ×
            </button>
          </li>
        ))}
      </ol>
      {/* "new", because the roster above is how somebody the app already knows gets in.
          A field is for the person it has never heard of. */}
      <button type="button" className="entrant-add" onClick={onAdd}>
        Add new entrant
      </button>
    </div>
  );
}

// Everyone the archive knows, as chips you tap to enter them. Typing eleven names the
// app already holds is the actual cost of setting a tournament up; the fields below stay
// for anyone new, and for correcting a spelling.
//
// A chip is a toggle rather than an add button, so the roster doubles as the answer to
// "who have I got in so far" — the lit ones. Alphabetical rather than most-played,
// because the task is finding one particular person.
function Roster({ knownNames, taken, onToggle, onAll }) {
  if (knownNames.length === 0) return null;
  const missing = knownNames.filter((name) => !taken.has(nameKey(name)));
  return (
    <div className="roster">
      <div className="roster-head">
        <h3>Tap to add</h3>
        {/* Everybody usually plays, so the ordinary field is the whole roster and the
            chips are then eleven taps to say so. Disabled rather than flipped to a
            clear, which is what `Make the draw` does with an empty form: a name typed
            into the fields is not a chip, so a clear either destroys it or leaves a
            subset behind, and neither is guessable from the label. */}
        <button type="button" className="roster-all" disabled={missing.length === 0} onClick={onAll}>
          Select all
        </button>
      </div>
      <div className="roster-chips">
        {knownNames.map((name) => {
          const on = taken.has(nameKey(name));
          return (
            <button
              key={name}
              type="button"
              className={`roster-chip${on ? ' is-on' : ''}`}
              aria-pressed={on}
              onClick={() => onToggle(name)}
            >
              {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Draw({ knownNames, usedNames, suggestions, failed = false, onDrawn, onCancel }) {
  const [name, setName] = useState('');
  const [mode, setMode] = useState('singles');
  const [target, setTarget] = useState(DEFAULT_TARGET);
  // No rows at all to begin with. The roster above enters everybody the app already
  // knows, which is nearly always the field, so two empty boxes on arrival are two boxes
  // most draws never type into — and they sat between the chips and `Add new entrant`,
  // which is the control that actually wants them.
  const [entrants, setEntrants] = useState([]);

  // Only the slots this mode plays. A doubles pair typed and then switched to singles
  // leaves a value in the second slot, and counting it would hold a name out of the
  // roster that nobody is playing.
  const playing = mode === 'doubles' ? [0, 1] : [0];
  const faults = useMemo(
    () => entrantFaults(entrants.map((e) => (mode === 'doubles' ? e : [e[0]]))),
    [entrants, mode],
  );
  const taken = new Set(
    entrants
      .flatMap((e) => playing.map((s) => e[s]))
      .map(nameKey)
      .filter(Boolean),
  );

  // The first empty playing slot, or a new entrant if there is none. Shared by the chips
  // and by `Select all` so the two cannot come to seat people differently — one press of
  // the button has to land the field the eleven taps would have.
  const place = (list, name) => {
    for (let i = 0; i < list.length; i += 1) {
      for (const s of playing) {
        if (!String(list[i][s] ?? '').trim()) {
          return list.map((e, n) => (n === i ? e.map((v, k) => (k === s ? name : v)) : e));
        }
      }
    }
    return [...list, [name, '']];
  };

  // One rule for both modes: a tap puts the name in the first empty playing slot, or
  // starts a new entrant if there is none; a second tap clears their slot and drops the
  // entrant if that empties it. In singles that removes the row, in doubles it leaves
  // the partner with a gap to fill — which is what a pair losing a member means.
  const toggle = (name) => {
    const key = nameKey(name);
    setEntrants((list) => {
      if (list.some((e) => playing.some((s) => nameKey(e[s]) === key))) {
        return list
          .map((e) => e.map((v, s) => (playing.includes(s) && nameKey(v) === key ? '' : v)))
          .filter((e) => playing.some((s) => String(e[s] ?? '').trim()));
      }
      return place(list, name);
    });
  };

  // Roster order, so the field lands where tapping down the chips would have put it. In
  // doubles that pairs people alphabetically, which is arbitrary — but so is any order,
  // and the mode that needs twice as many names typed is the one that can least afford
  // to be left out of this.
  const selectAll = () =>
    setEntrants((list) =>
      knownNames.filter((n) => !taken.has(nameKey(n))).reduce(place, list),
    );
  const enough = entrants.length >= MIN_ENTRANTS;
  // **An untouched form is empty, not at fault.** A blank row is the app's rather than
  // anybody's, so reporting `blank` on it tells you off for not having typed yet — on a
  // screen you reached by pressing `New`, which is the moment you are least in the wrong.
  // So the faults are *reported* only once a name is in, while `faults` itself still
  // holds `Make the draw` off: a disabled button over an empty form explains itself,
  // where red underlines under boxes nobody has reached do not.
  //
  // Derived rather than a `touched` flag, the rule the rest of this module follows. The
  // known difference is that clearing the last name puts it back to quiet — which is the
  // right answer anyway, since you are looking at an empty form again.
  //
  // The count is gated on there being a field at all rather than on a name, because those
  // are different mistakes: dropping to one entrant is something you did, so it is said
  // straight away, but the form now *opens* on nobody and saying so on arrival is the
  // telling-off this whole rule exists to avoid.
  const started = entrants.some((e) => playing.some((s) => String(e[s] ?? '').trim()));
  const reported = started ? faults : [];
  // The cup's own name is refused rather than defaulted. It used to fall back to the
  // literal word "Tournament", which is the guest-game bug in miniature: several cups run
  // at once and both lists are just names, so two of them called "Tournament" is a screen
  // you cannot read — and the fallback fires exactly when you were not paying attention.
  // Reported on the same gate as a blank entrant, since an untouched form is empty rather
  // than at fault, and it is the last field left that `Make the draw` did not care about.
  const unnamed = name.trim() === '';
  const unnamedReported = started && unnamed;
  // And it has to be a name not already in use, for the same reason it has to be a name at
  // all: the lists are the name and a date, so two cups called the same thing cannot be
  // told apart on the screen where you pick one. Refused rather than warned about — this
  // is a cup about to be drawn and costs a keystroke, the setup screen's rule for a
  // repeated lineup rather than the archive editor's for a record already filed.
  //
  // `nameKey` because "Hole Corn VI" and "hole corn vi" are the same cup to a reader. It
  // is the person-identity rule and this is not a person, but it is the same question —
  // how a typed name is compared — and a second spelling of it would be looser or stricter
  // than the one beside it for no reason anybody could see.
  //
  // A form rule, not a storage invariant: a file carrying two of a name still imports,
  // because `mergeTournaments` keys on the id and refusing a whole bracket over its
  // decoration is the archive's standing rule.
  const duplicate = !unnamed && usedNames.some((n) => nameKey(n) === nameKey(name));
  const hint = [
    unnamedReported && 'The tournament needs a name.',
    duplicate && 'There is already a tournament with that name.',
    reported.some((f) => f.fault === 'blank') && 'Everyone entering needs a name.',
    reported.some((f) => f.fault === 'twice') &&
      'Somebody is entered twice. One person cannot be on both sides of a bracket.',
    entrants.length > 0 && !enough && `A tournament needs at least ${MIN_ENTRANTS} entrants.`,
  ].filter(Boolean);

  const draw = () => {
    const sides = entrants.map((e) => (mode === 'doubles' ? e : [e[0]]));
    onDrawn(
      newTournament({
        id: newMatchId(),
        name: name.trim(),
        mode,
        target,
        // Shuffled here rather than inside `newTournament`, so the module stays
        // deterministic and the randomness is one call in one place — the same split
        // `drawSplash` uses for the splash colours.
        entrants: shuffled(sides),
        createdAt: Date.now(),
      }),
    );
  };

  return (
    <div className="draw">
      {/* A cup played every year is the same three answers every year, and the name is the
          one that has to be exactly right — it is what groups the editions, so a typo
          silently starts a new series. Filling it from the last edition is what removes
          most of the typing that would cause that.

          It deliberately does **not** enter the field. Who plays changes year to year, and
          the roster below already enters everybody the app knows in one press.

          A plain chip rather than a toggle, unlike the roster's: this fills three boxes and
          they can all be typed over afterwards, so there is no state for it to be in. */}
      {suggestions.length > 0 && (
        <div className="draw-next">
          <h3>Next edition</h3>
          <div className="roster-chips">
            {suggestions.map((s) => (
              <button
                key={s.key}
                type="button"
                className="roster-chip"
                onClick={() => {
                  setName(s.name);
                  setMode(s.mode);
                  // A cup that survives only as a result has no target, so the form keeps
                  // its own default rather than being handed nothing.
                  if (s.target !== null) setTarget(s.target);
                }}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <label className="draw-name">
        Name
        <input
          {...NAME_FIELD}
          value={name}
          maxLength={32}
          placeholder="Tournament Name"
          aria-invalid={unnamedReported || duplicate || undefined}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className="draw-row">
        <div className="mode-toggle" role="group" aria-label="Tournament mode">
          {['singles', 'doubles'].map((m) => (
            <button key={m} className={mode === m ? 'is-on' : ''} onClick={() => setMode(m)}>
              {m === 'singles' ? 'Singles' : 'Doubles'}
            </button>
          ))}
        </div>
        {/* Clamped through the app's own `clampTarget`, not just bounded by the input's
            attributes: the setup screen caps at MAX_TARGET and this did not, so a
            tournament could store a target of 5000 and `tieSetup` handed it straight to a
            game. A number input's `max` is a hint a keyboard can walk past. */}
        <label className="draw-target">
          Play to
          <input
            type="number"
            inputMode="numeric"
            min="1"
            max={MAX_TARGET}
            value={target}
            onChange={(e) => setTarget(clampTarget(e.target.value, DEFAULT_TARGET))}
          />
        </label>
      </div>
      <Roster knownNames={knownNames} taken={taken} onToggle={toggle} onAll={selectAll} />
      <Entrants
        entrants={entrants}
        mode={mode}
        faults={reported}
        knownNames={knownNames}
        taken={taken}
        onChange={(i, slot, value) =>
          setEntrants((list) =>
            list.map((e, n) => (n === i ? e.map((v, s) => (s === slot ? value : v)) : e)),
          )
        }
        onRemove={(i) => setEntrants((list) => list.filter((_, n) => n !== i))}
        onAdd={() => setEntrants((list) => [...list, ['', '']])}
      />
      {hint.length > 0 && (
        <p className="draw-hint" id="draw-fault">
          {hint.join(' ')}
        </p>
      )}
      {/* The draw is taken once and cannot be re-taken, so it says so before rather
          than asking after — a confirm on a button pressed once a year is a step
          nobody reads. */}
      {/* The count only once there is a field. "0 entrants, so 0 ties" is true of a form
          nobody has touched and says nothing about it; the warning is what the sentence
          is for. Both halves are pluralised, which mattered less when the form opened on
          two rows — a bracket of one tie is now a state you pass through. */}
      <p className="draw-note">
        The draw is random and final.
        {entrants.length > 0 &&
          ` ${entrants.length} ${plural(entrants.length, 'entrant', 'entrants')}, so ${
            entrants.length - 1
          } ${plural(entrants.length - 1, 'tie', 'ties')}.`}
      </p>
      {/* The form stays open with the field intact, because the draw never happened:
          the alternative is the ceremony announcing a random and final draw for a cup
          that is gone on the next load. */}
      {failed && (
        <p className="draw-hint" role="alert">
          There&rsquo;s no room on this phone to store the draw. Export from Stats and
          delete some matches, then try again.
        </p>
      )}
      <button
        className="draw-go"
        disabled={unnamed || duplicate || faults.length > 0 || !enough}
        aria-describedby={hint.length > 0 ? 'draw-fault' : undefined}
        onClick={draw}
      >
        Make the draw
      </button>
      {/* Inside the form rather than beside it, which is what lets it line up: everything
          in this column is capped at `--row-w`, so a button outside it can only be
          centred in the *screen* — which on a wide one is clear of the form altogether. */}
      <button className="draw-cancel" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

// When a tournament happened, as its row says it. A cup runs over weeks, so one date is
// rarely the answer: an unfinished one is asked "is this still going?", which is the draw
// plus how recently a tie was played, and a finished one is asked "when was that?", which
// is the whole span from the draw to the final.
//
// The draw date is also what both lists are sorted by, so an unfinished row leads with it
// — the order on screen is then self-evident rather than something you have to be told.
//
// Null when there is nothing to say, which needs a hand-edited file: `newTournament` has
// always stamped `createdAt`, so a tournament reaches here without one only if a file
// dropped it, and then a bracket with nothing played has no date anywhere. Its row is
// simply shorter, which is better than reserving an empty line on every other row for it.
function whenLine(tournament, view, matches) {
  const drawn = tournament.createdAt;
  const last = lastPlayed(view, matches);
  // A recorded result has one date and it is the final's, so there is no span to draw and
  // no draw to name — see `recordedTournament`.
  if (view.recorded) return drawn ? `Won ${shortDate(drawn)}` : null;
  if (view.done && last) return drawn ? dateSpan(drawn, last) : `Won ${shortDate(last)}`;
  if (!drawn) return last ? `Last played ${shortDate(last)}` : null;
  // Not a span: this one is still running, so the second date is where it has got to
  // rather than where it ended, and a range would say it had finished there. Dropped
  // entirely when the play was the day of the draw, the same redundancy `dateSpan`
  // collapses — "last played" is there to say how long ago, and the draw already has.
  const since = last && !sameDay(drawn, last) ? ` · last played ${dropRepeatedYear(drawn, last)}` : '';
  return `Drawn ${shortDate(drawn)}${since}`;
}

// One tournament, open or shut. Both lists use this: a row with the name and where it got
// to, and everything else behind a tap. A finished bracket is the point of keeping them at
// all, and an unfinished one is 63 ties on a 64-entrant field — neither wants to be
// unrolled on arrival next to five others.
function TournamentRow({ tournament, view, matches, isOpen, onToggle, onPlayTie, onDrop }) {
  const [confirming, setConfirming] = useState(false);
  const [tab, setTab] = useState(TABS[0][0]);
  // Which entrant's route is being traced, as a side key — the `selected` idiom the stats
  // screen uses for a player, and transient in the same way: a scope you set while
  // looking, not a setting. It lives here rather than in either tab because both read it
  // — the table selects and the bracket lights.
  const [selected, setSelected] = useState(null);
  // Back to the bracket on the way out, so a row always opens on the same thing. Opening
  // a different row closes this one, so this covers that too.
  useEffect(() => {
    if (!isOpen) {
      setTab(TABS[0][0]);
      setSelected(null);
    }
  }, [isOpen]);
  const routeTies = useMemo(() => routeFor(view, selected), [view, selected]);
  const route = useMemo(
    () =>
      selected && {
        key: selected,
        ids: new Set(routeTies.map((t) => t.id)),
        names: sideLabel(view.entrants.find((e) => e.key === selected)?.names ?? []),
      },
    [selected, routeTies, view],
  );
  const done = view.done;
  const verb = done ? 'Delete' : 'Abandon';
  const when = whenLine(tournament, view, matches);
  return (
    <li className={isOpen ? 'is-open' : undefined}>
      <button
        type="button"
        className="tournament-row"
        aria-expanded={isOpen}
        onClick={onToggle}
      >
        <span className="tournament-name">{tournament.name}</span>
        {/* A name on its own says nothing about why it is there, so the caption says what
            it is. The unfinished rows carry how far they have got in the same place, which
            is what makes the two lists read as one kind of thing. */}
        {/* Caption and name are one item, so each line right-aligns as a whole and both
            always reach the row's edge. They were briefly two, in a shared caption column,
            which lined `Winner` up with `Runner-up` — but that can only hold the *left* of
            the names together, so the shorter one stopped short of the edge. Butting up to
            the right won; the labels sit where their own line puts them. */}
        {done ? (
          // The label says "Winner"; the model underneath says `champion`, and the class
          // names follow the model. That is not sloppiness — `winner` is already taken by
          // the winner of a single *tie* (`tie.winner`, `.tie-side.is-winner`), and one
          // bracket has ten of those and exactly one champion. Reusing the word in code
          // would blur the two; on screen there is only one of them to confuse.
          <span className="champion-who">
            {/* A real separator, not a margin: without one this reads as "WinnerRho" to
                anything that takes the text rather than the layout. */}
            <span className="result-cap">Winner</span>
            {DOT}
            {sideNames(view.champion)}
          </span>
        ) : (
          <span className="tournament-progress">
            {view.played} of {view.total} ties
          </span>
        )}
        {/* Its own line under the name rather than a third thing on the top one. Measured
            at 393px, inline clips a 24-character name that fits today and leaves the date
            reading as a second status beside `0 of 1 ties`; the caption costs 19px of row
            height instead and clips nothing. */}
        {when && <span className="tournament-when">{when}</span>}
        {/* Under the winner, in the space the second line already opened — a knockout has
            one tie where losing is worth naming, and it is the one the winner's name comes
            out of. Costs no height at all, because the date put the line there. */}
        {done && view.runnerUp && (
          <span className="runner-up-who">
            <span className="result-cap">Runner-up</span>
            {DOT}
            {sideNames(view.runnerUp)}
          </span>
        )}
      </button>
      {isOpen && (
        <>
          {view.recorded ? (
            /* Nothing to draw behind a recorded result — no bracket, no ties, and so no
               rates or routes either. The row still opens, because `Delete` has to live
               somewhere and a file is the only way one of these arrives. */
            <>
              <p className="recorded-note">
                The sheet for this one is gone, so{' '}
                {view.fieldKnown ? 'who took part and how it ended are' : 'only the result is'}{' '}
                kept. There are no ties behind it, and nothing in anybody’s record counts
                towards it.
              </p>
              {/* Who was there, where somebody remembered — the one thing about such a
                  tournament that is not the result, and the reason `field` is stored at
                  all. Names only: there is nothing behind any of them to open, so they
                  are deliberately not the roster's chips, which are a tap affordance. */}
              {view.fieldKnown && (
                <p className="recorded-field">
                  <span className="result-cap">Took part</span>
                  {view.entrants.map((side) => (
                    <span className="recorded-who" key={side.key}>
                      {sideNames(side)}
                    </span>
                  ))}
                </p>
              )}
            </>
          ) : (
            <>
              <div className="tournament-head">
                {/* Real tabs rather than two buttons: the panels are alternative views of one
                    thing, so a roving tabindex and the arrow keys are what a keyboard expects.
                    The lit styling is `.mode-toggle`'s, which is the app's segmented control. */}
                <div className="tournament-tabs" role="tablist" aria-label={`${tournament.name} view`}>
                  {TABS.map(([id, label], i) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      id={`${tournament.id}-tab-${id}`}
                      aria-selected={tab === id}
                      aria-controls={`${tournament.id}-panel-${id}`}
                      tabIndex={tab === id ? 0 : -1}
                      className={tab === id ? 'is-on' : undefined}
                      onClick={() => setTab(id)}
                      onKeyDown={(e) => {
                        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                        if (!step) return;
                        e.preventDefault();
                        const to = (i + step + TABS.length) % TABS.length;
                        setTab(TABS[to][0]);
                        e.currentTarget.parentElement.children[to]?.focus();
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {/* Beside the tabs rather than inside a panel, because both are full of scores
                    and a score cannot be read without this: a winning 35 is somebody squeaking
                    over the line to 35, or a rout that overshot a line at 26, and nothing in a
                    box says which. It is one fact for the whole tournament — fixed at the draw
                    like the mode, see `tieSetup` — so it belongs beside the name rather than
                    repeated in every box, and a line living on one tab would disappear the
                    moment you looked at the other.
                    Worded as the setup screen words it for a tie, so the two agree.
                    Absent where the stored draw has no target, the way the date line is: it
                    takes a hand-edited file, and reserving the space is the worse trade. */}
                {Number.isFinite(tournament.target) && (
                  <span className="tournament-target">Play to {tournament.target}</span>
                )}
              </div>

              {/* Only the chosen panel is drawn, rather than both with one hidden. Hiding
                  would keep the bracket's scroll position, but a `display: none` scroller
                  does not reliably keep it anyway — and coming back to the round with a live
                  tie in it is where the bracket opens in the first place. */}
              <div
                role="tabpanel"
                id={`${tournament.id}-panel-${tab}`}
                aria-labelledby={`${tournament.id}-tab-${tab}`}
                className="tournament-panel"
              >
                {tab === 'bracket' ? (
                  /* A finished bracket gets no `onPlay`: every tie is played, so there is
                     nothing to offer, and `Tie` draws a plain box without a handler. There
                     used to be a "Ready to play" list above this, duplicating boxes the
                     bracket already draws — it cost a screenful on a big field and showed a
                     tie with none of the context that makes it worth looking at. */
                  <Bracket
                    view={view}
                    route={route}
                    onClearRoute={() => setSelected(null)}
                    onPlay={done ? undefined : (x) => onPlayTie(tournament, x)}
                  />
                ) : (
                  <TournamentStats
                    view={view}
                    matches={matches}
                    selected={selected}
                    route={routeTies}
                    onSelect={setSelected}
                  />
                )}
              </div>
            </>
          )}
          <button
            className="tournament-drop"
            onClick={() => setConfirming(true)}
            aria-label={`${verb} ${tournament.name}`}
          >
            {verb}
          </button>
          {/* Confirmed rather than undone, which is the opposite of how a *match* is
              deleted — and deliberately. A match is deleted often enough that a confirm
              would be in the way, so it gets one tap and an undo bar. A tournament is
              deleted about once a year, the button sits directly under the bracket you were
              reading, and there is something worth saying that an undo bar cannot carry:
              the ties are not going anywhere. */}
          {confirming && (
            <Modal onClose={() => setConfirming(false)}>
              <p className="modal-title">
                {verb} {tournament.name}?
              </p>
              <p className="modal-body">
                {/* A recorded result has no bracket to lose and no ties to keep, so both
                    halves of the ordinary sentence would be false. The dialog is here to
                    say what survives, so it has to say something different. */}
                {view.recorded ? 'The result goes, and it is all there is of this one.' : 'The bracket goes.'}{' '}
                {/* Both forms spelled out, noun *and* verb: a suffix rule gets "tie stays"
                    against "ties stay" the wrong way round, which is the same trap the
                    summary chips' labels already carry a note about. */}
                {!view.recorded && view.played === 0 && 'Nothing has been played in it yet.'}
                {view.played === 1 &&
                  "Its 1 played tie stays in your history and still counts towards everyone's record."}
                {view.played > 1 &&
                  `Its ${view.played} played ties stay in your history and still count towards everyone's record.`}
              </p>
              <div className="confirm-actions">
                <button onClick={() => setConfirming(false)}>Cancel</button>
                <button
                  className="confirm-danger"
                  onClick={() => {
                    setConfirming(false);
                    onDrop(tournament);
                  }}
                >
                  {verb}
                </button>
              </div>
            </Modal>
          )}
        </>
      )}
    </li>
  );
}

// ------------------------------------------------------------------ the series --

// One date per edition: the day it was won. A finished bracket's is its final's, a recorded
// result's is the only date it has, and a cup still being played has none to give — which is
// right, because its line says where it has got to instead of naming a winner.
function editionWhen(tournament, view, matches) {
  if (view.recorded) return tournament.createdAt ? shortDate(tournament.createdAt) : null;
  const last = lastPlayed(view, matches);
  return view.done && last ? shortDate(last) : null;
}

// What an edition contributed to the series, in one line. A cup still being played says
// where it has got to in the same words its row in `In progress` uses, so the two agree.
function honoursLine(view) {
  if (view.champion && view.runnerUp) {
    return `${sideNames(view.champion)} beat ${sideNames(view.runnerUp)}`;
  }
  if (view.champion) return sideNames(view.champion);
  return `${view.played} of ${view.total} ${plural(view.total, 'tie', 'ties')} played`;
}

// How far the series runs. Every date it has — each edition's draw and each edition's last
// tie — collapsed to a span, so a series of one afternoon reads as a date and one of six
// years reads as a range. `dateSpan` collapses the ends itself.
function seriesWhen(stats, matches) {
  const stamps = stats.editions
    .flatMap(({ tournament, view }) => [tournament.createdAt, lastPlayed(view, matches)])
    .filter((ms) => Number.isFinite(ms) && ms > 0);
  return stamps.length > 0 ? dateSpan(Math.min(...stamps), Math.max(...stamps)) : null;
}

// What an open series shows: the roll of honour, and how everybody has done across it.
//
// **These are the two questions a single bracket structurally cannot answer**, which is why
// this is worth a section rather than being folded into the Stats tab — see
// `docs/TOURNAMENT.md`. Inside one knockout every head-to-head is 1–0 and every surviving
// entrant's form is all wins, because a beaten side plays no more ties. Across editions
// both mean something again, and "how many has she won" has no single-cup equivalent at all.
function SeriesPanel({ stats, matches }) {
  return (
    <div className="series-stats">
      {/* Two, and deliberately not the throwing figures the Stats tab carries: those are
          about how the games went and are already a tap away inside each edition. These are
          about the series, which is the only thing this panel can say that they cannot.

          **The edition count is not a third chip**, though it was: the row above says it
          already — `4 editions · 10 Jul 21 – 20 Jun 26`, and that line stays on screen while
          the row is open — so the chip was the same fact twice. It also orphaned itself,
          because two chips fill a phone's row exactly and three do not. */}
      <Chips>
        <Chip
          value={stats.champions}
          label={`different ${plural(stats.champions, 'winner', 'winners')}`}
        />
        <Chip value={stats.ties.length} label={plural(stats.ties.length, 'tie', 'ties')} />
      </Chips>

      <section className="tournament-section">
        <h3>Honours</h3>
        {/* One grid for every row rather than a grid per row, so the edition track sizes to
            the widest name across all of them and the results start at one offset — the
            `.ceremony-sheet` and `.field-rows` trick, and for the same reason: a ragged left
            edge down a list reads as broken. */}
        <ol className="honours">
          {stats.editions.map(({ tournament, view }) => {
            const when = editionWhen(tournament, view, matches);
            return (
              <li key={tournament.id}>
                <span className="honours-edition">{tournament.name}</span>
                <span className={`honours-what${view.champion ? '' : ' is-waiting'}`}>
                  {honoursLine(view)}
                  {when && <span className="honours-when">{DOT}{when}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="tournament-section">
        {/* Concrete rather than "Across the series", which is the word the code and the
            section heading use: this is a sentence rather than a label, and what the table
            is actually about is the years. The abstract noun earns its place where a thing
            has to be named and not where a phrase will do. */}
        <h3>Across the years</h3>
        <div className="stats-scroll">
          <table className="stats-table">
            <thead>
              <tr>
                <th scope="col">Entrant</th>
                <th scope="col" title="Editions entered">
                  Editions
                </th>
                <th scope="col" title="Editions won">
                  Titles
                </th>
                {/* Four columns, and the two that are not here were. Both were dropped to
                    fit a phone without abbreviating the headings into `Ed`/`Fin`, and both
                    were saying something already on screen:

                    `P` is exactly wins plus losses, so `W–L` beside it carries it.
                    `Finals` is the honours list immediately above, which names *both*
                    finalists of every edition — on a four-edition series the two are the
                    same four lines. `seriesStats` still derives it, as the tie-break under
                    titles; it is a sort key rather than a column. */}
                <th scope="col" title="Ties won–lost">
                  W–L
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.rows.map((r) => (
                <tr key={r.key}>
                  {/* Plain text, unlike the career and entrant tables: those select
                      something — a player's rivals, an entrant's route — and there is
                      nothing here for a selection to scope. */}
                  <th scope="row">{sideLabel(r.names)}</th>
                  <td>{r.entered}</td>
                  <td>{r.titles}</td>
                  {/* A dash rather than `0–0` for somebody known only from an edition whose
                      sheet is gone: they have played no ties the archive can see, which is
                      not the same as having played none. The `played` flag `lineupStats`
                      draws a first-timer with. */}
                  <td>{r.played ? `${r.wins}–${r.losses}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Only where an edition's field is genuinely unknown. One transcribed with the
            names of everybody who entered counts them all, and saying otherwise would be
            the same fault this caption exists to prevent, pointing the other way. */}
        {stats.unlisted && (
          <p className="tournament-note">
            An edition whose sheet is gone counts only the people it recorded — its winner
            and runner-up, where nobody remembered the rest of the field.
          </p>
        )}
      </section>
    </div>
  );
}

// A series — every edition of a cup played again each year — as a row you open.
//
// **Nothing about it is stored.** `groupBySeries` reads the suffix off the names, so this is
// a *view* over the same tournaments the lists above and below draw, and an edition appears
// in both. That is the point rather than a duplication: the lists answer "what is running"
// and "what has finished", and this answers "who has won this thing".
function SeriesRow({ group, stats, matches, isOpen, onToggle }) {
  // The most recent edition to have been decided, which is what holding a cup means. The
  // editions are newest first, so it is simply the first with a champion.
  const holder = stats.editions.find(({ view }) => view.champion)?.view.champion ?? null;
  const when = seriesWhen(stats, matches);
  const count = `${stats.editions.length} ${plural(stats.editions.length, 'edition', 'editions')}`;
  // The caption carries the count only where the holder has taken the line above it,
  // because otherwise the count is already up there and would be said twice.
  const caption = holder ? [count, when].filter(Boolean).join(DOT) : when;
  return (
    <li className={isOpen ? 'is-open' : undefined}>
      <button type="button" className="tournament-row" aria-expanded={isOpen} onClick={onToggle}>
        <span className="tournament-name">{group.name}</span>
        {/* **Its own classes, sharing the tournament row's rules rather than its class
            names**, and that is not tidiness. `.tournament-progress` means "how far has this
            bracket got" and `.champion-who` means "who won this cup"; a series' versions
            are different facts — how many editions, and who holds it. They are also *queried*
            by name: `verify-tournament.mjs` reads `.tournament-progress` unscoped, so a
            series row carrying one resolves the locator to two elements and ends the run on a
            strict-mode violation in a block that has nothing to do with this. Found by
            mutation, in an existing block 1200 lines above the new ones. The styling is
            shared in `Tournament.css` by adding these to the same rules, so there is one
            declaration and no second thing to keep in step. */}
        {holder ? (
          <span className="series-holder">
            <span className="result-cap">Holder</span>
            {DOT}
            {sideNames(holder)}
          </span>
        ) : (
          <span className="series-count">{count}</span>
        )}
        {caption && <span className="tournament-when">{caption}</span>}
      </button>
      {isOpen && <SeriesPanel stats={stats} matches={matches} />}
    </li>
  );
}

// How long the name is withheld after a press. The same reasoning as `TOSS_MS` in
// App.jsx, and longer than it: a toss is between two names you can already see, where
// this is a name nobody knows yet and the pause is what the children are there for.
//
// It also has to clear `PUBLISH_DEBOUNCE`, which is why the draw topic publishes
// undebounced — at 400ms of settling the two beats would collapse into one.
const PULL_MS = 1100;

// How one pull reads in prose, on the phone and to a screen reader. The panel says the
// same thing in three rows; this is the one place the wording is a sentence.
function stepLine(step) {
  const label = (side) => sideLabel(side.names);
  if (step.opponents.length === 0) return null;
  if (step.opponents.length === 1) return `plays ${label(step.opponents[0])}`;
  return `plays the winner of ${step.opponents.map(label).join(' v ')}`;
}

// The draw played out one name at a time, which is the whole of the ceremony. A **view**
// over a tournament that is already saved whole — `Draw` shuffles and stores it before
// this mounts — so there is no partial-draw state anywhere, nothing here can fail
// halfway, and leaving the screen lands on the finished bracket.
//
// There is no toggle for this. `Make the draw` always comes here and `Skip` is one press,
// which is the same outcome as a setting without anything to remember.
function Ceremony({ tournament, onReveal, onDone }) {
  const steps = useMemo(() => drawSteps(tournament), [tournament]);
  const [at, setAt] = useState(0);
  const [pulling, setPulling] = useState(false);
  const timer = useRef(null);
  const done = at >= steps.length;

  // A pending beat must not land after the screen has gone, the same guard the toss
  // carries: it would reveal a name onto a board that has moved on to a game.
  useEffect(() => () => clearTimeout(timer.current), []);

  // What the board is told. Memoised because the publisher compares by value but the
  // effect below fires on identity, and this screen re-renders on every tick of state.
  const reveal = useMemo(() => {
    if (pulling) return { step: steps[at], drawn: at, total: steps.length, pulling: true };
    // Nothing pulled yet, so the board carries the title card. Without it the screen the
    // draw is taken in front of is still showing the last game's score, which says the
    // board has nothing to do with what everyone is standing around watching.
    if (at === 0) return { cup: tournament.name, drawn: 0, total: steps.length };
    return { step: steps[at - 1], drawn: at, total: steps.length, pulling: false };
  }, [steps, at, pulling, tournament.name]);

  useEffect(() => {
    onReveal(reveal);
  }, [reveal, onReveal]);
  // Taken down however the screen is left — skipped, finished, or Back out of the
  // tournament screen entirely. Nothing about starting a game clears this topic, so a
  // card left retained would sit on the board until the next draw.
  useEffect(() => () => onReveal(null), [onReveal]);

  const pull = () => {
    if (done || pulling) return;
    clearTimeout(timer.current);
    setPulling(true);
    timer.current = setTimeout(() => {
      setPulling(false);
      setAt((n) => n + 1);
    }, PULL_MS);
  };

  const shown = !pulling && at > 0 ? steps[at - 1] : null;
  return (
    <div className="ceremony">
      <h2>{tournament.name}</h2>
      <p className="ceremony-count">
        {at} of {steps.length} drawn
      </p>

      {/* Always in the DOM, so a reveal is announced rather than inserted along with its
          region — the toss result's rule. */}
      <div className={`ceremony-card${pulling ? ' is-pulling' : ''}`} aria-live="polite">
        {pulling && <p className="ceremony-round">{steps[at].round}</p>}
        {pulling && <p className="ceremony-name">Pulling…</p>}
        {shown && <p className="ceremony-round">{shown.round}</p>}
        {shown && <p className="ceremony-name">{sideLabel(shown.side.names)}</p>}
        {shown && stepLine(shown) && <p className="ceremony-versus">{stepLine(shown)}</p>}
        {!pulling && at === 0 && (
          <p className="ceremony-versus">Press to pull the first name out of the hat.</p>
        )}
      </div>

      <div className="ceremony-actions">
        <button type="button" className="ceremony-pull" onClick={done ? onDone : pull} disabled={pulling}>
          {done ? 'See the bracket' : 'Pull a name'}
        </button>
        {!done && (
          <button type="button" className="ceremony-skip" onClick={onDone}>
            Skip
          </button>
        )}
      </div>

      {/* The sheet filling in, which is what a paper draw leaves you looking at. Newest
          first, so the pairing just made sits under the card rather than at the bottom of
          a list you have to scroll to.

          **Pairings, not pulls.** Listing every pull put a row on screen for an entrant
          with nobody to meet yet, and left it reading "—" after the very next press had
          named their opponent — a sheet describing the draw as it was rather than as it
          is. A pull with no opponent is on the card at the time and in a tie a moment
          later, so it is never invisible.

          The tie whose two sides are both preliminary winners is announced by no pull at
          all, and so appears here in no form. That is honest rather than missing: nobody
          coming out of the hat decides it, and the bracket below draws it. */}
      {steps.slice(0, at).some((step) => step.opponents.length > 0) && (
        <ol className="ceremony-sheet">
          {steps
            .slice(0, at)
            .map((step, i) => [step, i])
            .filter(([step]) => step.opponents.length > 0)
            .map(([step, i]) => (
              <li key={i}>
                <span className="ceremony-sheet-round">{step.round}</span>
                <span className="ceremony-sheet-tie">
                  <b>{sideLabel(step.side.names)}</b> {stepLine(step)}
                </span>
              </li>
            ))
            .reverse()}
        </ol>
      )}
    </div>
  );
}

export default function Tournament({
  tournaments,
  matches,
  knownNames,
  onBack,
  onCreate,
  onDrop,
  onPlayTie,
  onReveal,
}) {
  const [drawing, setDrawing] = useState(false);
  // The tournament whose draw is being played out, or null. Held here rather than inside
  // `Ceremony` so the screen can show one thing at a time: the draw form, the ceremony,
  // or the lists.
  const [ceremony, setCeremony] = useState(null);
  // Whether the last draw could not be stored. Held here rather than in `Draw` because
  // only this level calls `onCreate` and so learns the answer.
  const [drawFailed, setDrawFailed] = useState(false);
  // One tournament open at a time, the `openId` idiom the stats screen's match list uses.
  // Nothing is open on arrival: a bracket is up to 63 ties, and the row already says how far
  // it has got, so the list is what you want to land on. Drawing a new one opens it, because
  // that is the one thing you have just asked for.
  const [openId, setOpenId] = useState(null);
  const views = useMemo(
    () =>
      newestFirst(tournaments)
        .map((t) => ({ tournament: t, view: bracket(t, matches) }))
        .filter((x) => x.view),
    [tournaments, matches],
  );
  const open = views.filter((x) => !x.view.done);
  const done = views.filter((x) => x.view.done);
  const toggle = (id) => setOpenId((was) => (was === id ? null : id));
  // Series with more than one edition. A cup played once is already a row in the lists
  // below and a `Series` heading over a single edition of it says nothing — so the section
  // simply is not there until a cup has been played again, which is the year it starts
  // being worth asking who has won it.
  //
  // Keyed with a prefix so one `openId` can hold either kind of row: a series key is a
  // folded name and a tournament id is a random hex, so they could not collide in practice,
  // but one thing open at a time is the screen's rule and this is what keeps it one rule.
  const series = useMemo(
    () =>
      groupBySeries(tournaments)
        .filter((g) => g.editions.length > 1)
        .map((group) => ({ group, stats: seriesStats(group.editions, matches) })),
    [tournaments, matches],
  );
  // What `New` offers as a starting point, computed here because only this screen holds
  // both the tournaments and the archive the "is it finished" filter needs.
  const suggestions = useMemo(() => nextEditions(tournaments, matches), [tournaments, matches]);

  const list = (label, rows) =>
    rows.length > 0 && (
      <section className="tournament-list" key={label}>
        <h2>{label}</h2>
        <ul>
          {rows.map(({ tournament, view }) => (
            <TournamentRow
              key={tournament.id}
              tournament={tournament}
              view={view}
              matches={matches}
              isOpen={openId === tournament.id}
              onToggle={() => toggle(tournament.id)}
              onPlayTie={onPlayTie}
              onDrop={onDrop}
            />
          ))}
        </ul>
      </section>
    );

  return (
    <div className="app tournament-screen">
      <header className="stats-head">
        <button className="stats-back" onClick={onBack}>
          ‹ Back
        </button>
        <h1>Tournaments</h1>
        {/* Up here rather than under the lists: drawing a new one is the reason for coming to
            this screen, and at the foot it sat behind every bracket and champion. Hidden
            while the draw form is open, where Cancel is the way out. */}
        {!drawing && !ceremony && (
          <button
            className="tournament-new"
            onClick={() => setDrawing(true)}
            // `New` visible and the full meaning in the accessible name, which is the same
            // trade `.setup-top` makes by saying `Start` rather than `Start game`: measured,
            // `New tournament` needs 142px and this row has 328px at 360px wide against
            // `‹ Back` at 62 and the heading at 124. WCAG Label in Name is satisfied because
            // the accessible name contains the visible word.
            aria-label="New tournament"
          >
            New
          </button>
        )}
      </header>

      {ceremony ? (
        <Ceremony
          tournament={ceremony}
          onReveal={onReveal}
          onDone={() => {
            // Open the one just drawn: it is the reason for being on this screen.
            setOpenId(ceremony.id);
            setCeremony(null);
          }}
        />
      ) : drawing ? (
        <Draw
          knownNames={knownNames}
          usedNames={tournaments.map((t) => t.name)}
          suggestions={suggestions}
          failed={drawFailed}
          onCancel={() => {
            setDrawFailed(false);
            setDrawing(false);
          }}
          onDrawn={(t) => {
            // Saved whole before a single name is revealed, which is what makes the
            // ceremony a view over stored data rather than a second way to build one —
            // and is why a write that failed has to stop here. `onCreate` used to
            // report success whatever happened, so the ceremony played out, the bracket
            // came up playable, and the cup had never been stored.
            if (!onCreate(t)) {
              setDrawFailed(true);
              return;
            }
            setDrawFailed(false);
            setCeremony(t);
            setDrawing(false);
          }}
        />
      ) : (
        <>
          {views.length === 0 && (
            <p className="tournament-empty">
              No tournaments yet. Enter everyone playing and the app will make the draw.
            </p>
          )}
          {list('In progress', open)}
          {/* Between the two lists rather than at either end: `In progress` is what you came
              to the screen for, and a series is the history lens on everything below it —
              so it reads in the order the questions are asked, "what is on" then "who has
              won this" then "what else has been played". */}
          {series.length > 0 && (
            <section className="tournament-list">
              <h2>Series</h2>
              <ul>
                {series.map(({ group, stats }) => (
                  <SeriesRow
                    key={group.key}
                    group={group}
                    stats={stats}
                    matches={matches}
                    isOpen={openId === `series:${group.key}`}
                    onToggle={() => toggle(`series:${group.key}`)}
                  />
                ))}
              </ul>
            </section>
          )}
          {list('Completed', done)}

        </>
      )}
    </div>
  );
}
