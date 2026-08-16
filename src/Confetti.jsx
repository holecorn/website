// The winner's confetti. Private to `App.jsx` until the board wanted it, the way `Chip`
// was to `Stats.jsx` and `FormPips` to `Lineup.jsx`.
//
// Alternating the winner's colour with `--text` rather than with white, which was the
// half that stopped working on the light scheme: white confetti over a white page is the
// celebration not happening. Both come from the stylesheet, off the `--team` set here.
//
// **Every dimension is a multiple of `--piece`, and each surface sets its own.** The
// phone's 6-12px pieces are right at arm's length and measure under a millimetre on a
// board propped against a fence — measured, they read as dust. `--fall` does the same for
// the drop: the keyframes travel in `vh`, so the same duration is a faster fall on a
// bigger screen rather than the same one.
import './Confetti.css';

export default function Confetti({ count, color }) {
  return (
    <div className="confetti" aria-hidden="true" style={{ '--team': color }}>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={`confetti-piece${i % 2 ? ' is-pale' : ''}`}
          style={{
            left: `${Math.random() * 100}%`,
            width: `calc(var(--piece) * ${6 + Math.round(Math.random() * 6)} / 10)`,
            height: `calc(var(--piece) * ${9 + Math.round(Math.random() * 9)} / 10)`,
            '--drift': `calc(var(--piece) * ${Math.round((Math.random() * 2 - 1) * 90)} / 10)`,
            '--rot': `${Math.round(Math.random() * 720 - 360)}deg`,
            animationDuration: `calc(var(--fall) * ${1000 + Math.round(Math.random() * 700)}ms)`,
            animationDelay: `calc(var(--fall) * ${Math.round(Math.random() * 150)}ms)`,
          }}
        />
      ))}
    </div>
  );
}
