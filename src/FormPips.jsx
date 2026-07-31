// A form line — the last few results, oldest first.
//
// Pips rather than "WWLWW": at this size the letters read as one word and the run
// of wins is the thing being looked for. Spelled out for a screen reader, which
// gets nothing from a row of shapes.
//
// Shared by the setup screen's Form panel and the career table rather than drawn
// twice, so the two cannot drift into meaning different things. The classes are
// `form-line-*` and not `form-pip`, which `Display.css` already owns — and
// `main.jsx` imports Display statically, so that stylesheet is loaded on this
// route whether or not the display is on screen.

import './FormPips.css';

export default function FormPips({ results, color }) {
  return (
    <span className="form-line">
      <span className="form-line-spoken">
        {results.length === 0
          ? 'no matches yet'
          : results.map((won) => (won ? 'won' : 'lost')).join(', ')}
      </span>
      {results.map((won, i) => (
        <span
          key={i}
          className={`form-line-pip${won ? ' is-win' : ''}`}
          // A team colour where there is one. The career table has no teams, so
          // the default in the stylesheet stands.
          style={won && color ? { background: color } : undefined}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}
