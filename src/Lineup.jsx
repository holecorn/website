// What history says about the people about to play. Setup screen only: it is
// something to read in the downtime before a game, and it goes below Start game
// because that button is already off the bottom of a phone's first screen.
//
// The same numbers go to the external scoreboard, which draws its own version of
// this while the lineup topic is retained — see lineupPayload in scoreboard.js.
// Names are typed live, so the career fold is memoised on the records and only
// the per-name lookup runs per keystroke.

import { useMemo } from 'react';
import { FORM_LENGTH, lineupStats, sideRecord } from './stats.js';
import { teamLabel } from './scoring.js';
import './Lineup.css';

const pct = (n) => `${Math.round(n * 100)}%`;

export default function Lineup({ game, colors, matches }) {
  const rows = useMemo(() => lineupStats(matches, game), [matches, game]);
  const record = useMemo(() => sideRecord(matches, game), [matches, game]);

  // Nothing to say about a lineup nobody in it has played before, so the panel
  // stays away entirely rather than showing a grid of dashes.
  if (!rows.some((p) => p.played)) return null;

  return (
    <section className="lineup" aria-label="Form">
      <h2 className="lineup-title">Form</h2>
      {record && (
        <p className="lineup-record">
          <span style={{ color: colors.a }}>{teamLabel(game, 'a')}</span>
          <b>
            {record.a}–{record.b}
          </b>
          <span style={{ color: colors.b }}>{teamLabel(game, 'b')}</span>
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
              <th scope="row" style={{ color: colors[p.team] }}>
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
                    <Form results={p.form} color={colors[p.team]} />
                  </td>
                  <td>{p.ppr.toFixed(1)}</td>
                  <td>{pct(p.holePct)}</td>
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

// Pips rather than "WWLWW": at this size the letters read as one word and the
// run of wins is the thing being looked for. Spelled out for a screen reader,
// which gets nothing from a row of shapes.
function Form({ results, color }) {
  return (
    <span className="lineup-form">
      <span className="lineup-form-text">
        {results.length === 0
          ? 'no matches yet'
          : results.map((won) => (won ? 'won' : 'lost')).join(', ')}
      </span>
      {results.map((won, i) => (
        <span
          key={i}
          className={`lineup-pip${won ? ' is-win' : ''}`}
          style={won ? { background: color } : undefined}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}
