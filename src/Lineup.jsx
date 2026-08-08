// What history says about the people about to play. Setup screen only: it is
// something to read in the downtime before a game, and it goes below Start game
// because that button is already off the bottom of a phone's first screen.
//
// Which history is the caller's to decide: everything archived for an ordinary game, and
// the ties of that series for a tournament tie — see `seriesHistory` in tournament.js for
// why a cup is read against itself. Every number here folds whatever pool it is handed,
// so `series` is only the heading, and it is the one thing that says which pool it was.
//
// The same numbers go to the external scoreboard, which draws its own version of
// this while the lineup topic is retained — see lineupPayload in scoreboard.js.
// Names are typed live, so the career fold is memoised on the records and only
// the per-name lookup runs per keystroke.

import { useMemo } from 'react';
import { FORM_LENGTH, lineupStats, sideRecord } from './stats.js';
import { teamLabel } from './scoring.js';
import { pct } from './format.js';
import FormPips from './FormPips.jsx';
import './Lineup.css';

export default function Lineup({ game, colors, matches, series }) {
  const rows = useMemo(() => lineupStats(matches, game), [matches, game]);
  const record = useMemo(() => sideRecord(matches, game), [matches, game]);

  // Nothing to say about a lineup nobody in it has played before, so the panel
  // stays away entirely rather than showing a grid of dashes.
  if (!rows.some((p) => p.played)) return null;

  const title = series ? `Form in ${series}` : 'Form';

  return (
    // Labelled with the same words the heading carries: an `aria-label` overrides the
    // h2 inside, so the two saying different things would announce the panel as career
    // form while it draws a cup's.
    <section className="lineup" aria-label={title}>
      {/* Named rather than left as "Form" when the pool is a series, because every number
          under it is then a cup record and nothing else on the panel says so. The cup's
          own name and not the word "series": that is the app's word for the grouping, not
          the family's for the trophy. */}
      <h2 className="lineup-title">{title}</h2>
      {record && (
        <p className="lineup-record">
          <span className="team-ink" style={{ '--team': colors.a }}>{teamLabel(game, 'a')}</span>
          <b>
            {record.a}–{record.b}
          </b>
          <span className="team-ink" style={{ '--team': colors.b }}>{teamLabel(game, 'b')}</span>
        </p>
      )}
      <table className="lineup-table">
        <thead>
          <tr>
            <th scope="col">Player</th>
            <th scope="col" title="Won–lost">W–L</th>
            <th scope="col" title={`Last ${FORM_LENGTH} matches, oldest first`}>Last {FORM_LENGTH}</th>
            <th scope="col" title="Raw bag points per round">PPR</th>
            <th scope="col" title="Bags in the hole">Hole</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={`${p.team}${p.slot}`}>
              <th scope="row" className="team-ink" style={{ '--team': colors[p.team] }}>
                <span className="lineup-player">
                  <span className="lineup-name">{p.name}</span>
                  {p.currentStreak > 1 && (
                    <span className="lineup-streak" title="Current win streak">
                      {p.currentStreak}W
                    </span>
                  )}
                </span>
              </th>
              {p.played ? (
                <>
                  <td>
                    {p.wins}–{p.losses}
                  </td>
                  <td>
                    <FormPips results={p.form} color={colors[p.team]} />
                  </td>
                  {/* Rates need thrown bags, and a record made only of
                      imported results has none — a real 0.0 average and no data
                      at all must not read alike. `played` is the wrong test for
                      this: it says they have history, not that it has rounds. */}
                  <td>{p.rounds > 0 ? p.ppr.toFixed(1) : '—'}</td>
                  <td>{p.rounds > 0 ? pct(p.holePct) : '—'}</td>
                </>
              ) : (
                <td className="lineup-first" colSpan={4}>
                  first game
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
