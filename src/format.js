// How a number is written on screen, shared by the career screen and the tournament
// screen. `src/dates.js` exists for exactly this reason and this is the same rule: two
// copies of "how a duration reads" is the drift with no symptom, and the two screens sit
// beside each other in the same app.
//
// Pure and framework-free, like dates.js. Nothing here reads the clock.

export const pct = (v) => `${Math.round(v * 100)}%`;

// One decimal place, which is how every rate in the app is quoted — PPR on the career
// table, on the setup screen's Form panel and on the LED panel, where it travels as
// tenths precisely so the firmware needs no float formatter.
export const one = (v) => v.toFixed(1);

// Both word forms spelled out rather than derived. A suffix rule gets "wash"/"washes"
// and "round"/"rounds" the wrong way round for one of them, and "match"/"matches" too.
// Singular at exactly one; zero is plural, as English has it.
export const plural = (n, singular, many) => (n === 1 ? singular : many);

// A duration, or a dash where there is none. Zero is not a length — it is a match with
// no `startedAt`, which every result imported from a written-down score has — so it
// reads as unknown rather than as an instantaneous game.
export function minutes(ms) {
  if (!ms) return '—';
  const mins = Math.round(ms / 60000);
  if (mins < 1) return '<1m';
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}
