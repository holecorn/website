// Stats for the game in progress. A narrower cut than the career screen: only
// what a thrown bag can tell you, since nothing here has a result yet.

import { gameStats, summary } from './stats.js';
import { pct, plural } from './format.js';
import './GameStats.css';

export default function GameStats({ game, colors }) {
  if (game.rounds.length === 0) {
    return (
      <div className="game-stats">
        <p className="game-stats-empty">Stats appear once you commit a round.</p>
      </div>
    );
  }

  const rows = gameStats(game);
  const { rounds, washes, fourBaggers } = summary([game]);

  return (
    <div className="game-stats">
      <table className="game-stats-table">
        <thead>
          <tr>
            <th scope="col">This game</th>
            <th scope="col" title="Rounds thrown">Rds</th>
            <th scope="col" title="Raw bag points per round">PPR</th>
            <th scope="col" title="Bags in the hole">Hole</th>
            <th scope="col" title="Bags on the board or in the hole">In play</th>
            <th scope="col" title="Best round">Best</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={`${p.team}${p.slot}`}>
              <th scope="row" style={{ color: colors[p.team] }}>
                <span className="game-stats-player">
                  <span className="game-stats-name">{p.name}</span>
                  {p.fourBaggers > 0 && (
                    <span className="game-stats-fb" title="Four baggers">
                      {p.fourBaggers}×4B
                    </span>
                  )}
                </span>
              </th>
              <td>{p.rounds}</td>
              <td>{p.ppr.toFixed(1)}</td>
              <td>{pct(p.holePct)}</td>
              <td>{pct(p.inPlayPct)}</td>
              <td>{p.bestRound}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="game-stats-foot">
        {rounds} {plural(rounds, 'round', 'rounds')} · {washes}{' '}
        {plural(washes, 'wash', 'washes')} · {fourBaggers}{' '}
        {plural(fourBaggers, 'four bagger', 'four baggers')}
      </p>
    </div>
  );
}
