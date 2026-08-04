// How a date is written on screen. Its own module for the reason `nameField.js` is one:
// the stats screen's recent list and the tournament list both need it, and a format
// written down twice is the drift nobody notices — the two would simply disagree.
//
// **The year is always shown, never only on dates outside this one.** Scoping the recent
// list to a player made it span years — a filtered list reads 10 May, 18 Dec, 23 Nov and
// crosses a boundary silently — and a conditional year would make its *absence* the thing
// carrying "this year", which you have to know the rule to read. It would also key the
// rendering off Date.now(), so the same match grows a year in January and any check on the
// text passes by season.
// Pinned, not the device's locale. `.recent-date` is a *measured* 64px — what `30 Sept 25`
// needs, `Sept` being the widest abbreviation en-GB has — so a phone formatting dates any
// other way is a column sized for a format it isn't drawing. It also made every check on
// the text depend on the machine's own locale: `Sept` on a UK Mac, `Sep` on a CI runner,
// which sets `LANG=C.UTF-8` and so resolves to en-US.
const LOCALE = 'en-GB';

export const shortDate = (ms) =>
  ms
    ? new Date(ms).toLocaleDateString(LOCALE, {
        day: 'numeric',
        month: 'short',
        year: '2-digit',
      })
    : '';

// The same date without its year, which only `dateSpan` may use — never on its own, or the
// rule above is broken. Here the year is not absent, it is at the far end of the span.
const dayMonth = (ms) =>
  ms ? new Date(ms).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' }) : '';

const sameYear = (a, b) => new Date(a).getFullYear() === new Date(b).getFullYear();

// The same calendar day locally, which is the comparison that matters — two stamps hours
// apart can still be one afternoon's play. `toDateString` is the whole local day and
// nothing else, and its format never reaches a screen.
export const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

// Two dates as a range: `5 Jul – 14 Sep 25` within one year, `28 Dec 25 – 3 Jan 26` across
// two. Dropping the first year where they match is not the conditional-year trap above —
// nothing is inferred from the omission, because the year is still on the line, and which
// form is drawn depends on the two dates rather than on today.
export function dateSpan(from, to) {
  if (!from || !to) return shortDate(from || to);
  // A range with the same date at both ends is the date, written twice. Small tournaments
  // are played in an afternoon, so this is the ordinary case rather than an edge one.
  if (sameDay(from, to)) return shortDate(to);
  return `${sameYear(from, to) ? dayMonth(from) : shortDate(from)} – ${shortDate(to)}`;
}

// A second date for a line that already carries `earlier`, with the year left off when it
// would only repeat the one already there. Same reasoning as `dateSpan`, and exported in
// place of `dayMonth` so a date with no year on its line cannot be drawn by accident.
export const dropRepeatedYear = (earlier, later) =>
  earlier && later && sameYear(earlier, later) ? dayMonth(later) : shortDate(later);
