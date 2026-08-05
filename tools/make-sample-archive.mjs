// Builds tools/fixtures/sample-archive.json — a few years of made-up history to
// import on the stats screen when working on anything that reads the archive.
//
//   node tools/make-sample-archive.mjs
//
// Two halves, because the app has two kinds of record and they behave
// differently everywhere: the older seasons are results transcribed from a
// notebook (a score and no rounds), the recent ones were scored in the app.
//
// The modern half is **played through the real scoring functions** rather than
// written out as blobs, the same rule src/stats.test.js follows: cancellation,
// the first-thrower rule and the target are all applied by scoring.js, so a
// fixture cannot quietly disagree with the rules it is meant to exercise. The
// legacy half goes through tools/import-legacy.mjs for the same reason.
//
// The cup runs to six editions, which is the one part of this that is not simply
// "some history": a series is derived from the names, so the only way to have one to
// look at is to name the tournaments as the group does. Its oldest editions are the
// shapes only a series turns up — a result with a field somebody wrote down, a result
// with nobody but the winner remembered, and a sheet transcribed tie by tie with no
// round detail behind any of it — beside two played in the app and one still running.
//
// Deterministic: a seeded PRNG and fixed dates, so re-running produces no diff.
// Nothing here calls Date.now() or Math.random().

import { writeFileSync, mkdirSync } from 'node:fs';
import { nameKey } from '../src/scoring.js';
import { archiveFile, validRecord } from '../src/archive.js';
import { markInactive } from '../src/inactive.js';
import { finalScore } from '../src/stats.js';
import { bracket, groupBySeries, validTournament } from '../src/tournament.js';
import { parseGames } from './import-legacy.mjs';
import {
  DAY,
  at,
  colours,
  idFor,
  iso,
  pick,
  playMatch as playMatchWith,
  playTournament as playTournamentWith,
  rng,
} from './lib/fixture.mjs';

const OUT = new URL('fixtures/sample-archive.json', import.meta.url).pathname;

// Every name is a Greek letter bar Neil — this is a public repo and the people
// this group actually plays with must not be in it.
const NEIL = 'Neil';

// Where each player tends to put a bag. Only used to make the numbers look like
// somebody threw them: a strong player holes more and floors less, so the career
// table has an order worth reading rather than four identical rows.
// The spread is deliberately narrow. Under cancellation the losing side scores
// nothing in a round it doesn't win outright, so a wide spread produces shutouts
// at a rate nobody would recognise — an earlier pass with Neil on 0.34 against
// 0.14 skunked 11 of 78 played games.
const SKILL = {
  Neil: { hole: 0.3, board: 0.45 },
  Rho: { hole: 0.28, board: 0.45 },
  Sigma: { hole: 0.23, board: 0.44 },
  Tau: { hole: 0.26, board: 0.42 },
  Phi: { hole: 0.21, board: 0.42 },
  Chi: { hole: 0.27, board: 0.46 },
  Psi: { hole: 0.19, board: 0.4 },
  Eta: { hole: 0.22, board: 0.4 },
  Omega: { hole: 0.25, board: 0.43 },
  Omicron: { hole: 0.2, board: 0.42 },
  Upsilon: { hole: 0.22, board: 0.4 },
};


// Sessions from summer 2023 to summer 2026, a few weeks apart and clustered into
// the warmer months — this is played on a seafront. Dates are absolute so the
// file is deterministic, which means they age; bump FIRST/LAST and regenerate.
const FIRST = '2023-06-17';
const LAST = '2026-07-25';

function sessions(r) {
  const out = [];
  let t = at(FIRST, 12);
  const end = at(LAST, 12);
  while (t <= end) {
    const month = new Date(t).getUTCMonth();
    const summer = month >= 3 && month <= 8;
    out.push(t);
    // Roughly fortnightly in season, and a long gap over winter.
    t += (summer ? 10 + Math.floor(r() * 12) : 24 + Math.floor(r() * 40)) * DAY;
  }
  return out;
}


// The shared versions, with this fixture's skill table bound in. See tools/lib/fixture.mjs.
const skillFor = (name) => SKILL[name] ?? SKILL.Psi;
const playMatch = (r, spec) => playMatchWith(r, skillFor, spec);

const r = rng(20260731);
const all = sessions(r);
// The seasons before the app existed. Everything from here on was scored in it.
const cutover = at('2024-08-01', 12);
const legacyDays = all.filter((t) => t < cutover);
const modernDays = all.filter((t) => t >= cutover);

// Who was around when. Newcomers arrive over time, which is what gives the career
// table a spread of match counts instead of everyone on the same number.
const roster = (t) => {
  const who = [NEIL, 'Rho', 'Sigma', 'Tau', 'Phi'];
  // Stops at the cutover, so their whole career is result-only — the row the
  // career table's dashes exist for.
  if (t >= at('2023-09-01', 12) && t < cutover) who.push('Upsilon');
  if (t >= at('2024-09-01', 12)) who.push('Chi', 'Eta');
  if (t >= at('2025-05-01', 12)) who.push('Psi');
  // Omega and Omicron share an initial, which is the pair the board's label
  // shortening has to keep apart.
  if (t >= at('2025-09-01', 12)) who.push('Omega', 'Omicron');
  return who;
};

// Neil is at every session; the rest turn up in twos and threes.
function attendees(t, count) {
  const others = roster(t).filter((n) => n !== NEIL);
  const shuffled = others
    .map((n) => ({ n, k: r() }))
    .sort((x, y) => x.k - y.k)
    .map((x) => x.n);
  // Neil misses the occasional one, so he isn't in literally every match.
  const withNeil = r() < 0.85;
  const names = withNeil ? [NEIL, ...shuffled] : shuffled;
  return names.slice(0, count);
}

const TARGETS = [21, 21, 21, 21, 21, 15, 12];

const legacyLines = [];
for (const t of legacyDays) {
  // Two or three games a session, which is how an afternoon goes.
  for (let g = 0; g < 2 + (r() < 0.45 ? 1 : 0); g += 1) {
    const doubles = r() < 0.4;
    const here = attendees(t, doubles ? 4 : 2);
    if (here.length < (doubles ? 4 : 2)) continue;
    const target = pick(r, TARGETS);
    // A written-down score, so it is invented rather than played: the winner is
    // at or just past the target and the loser somewhere behind.
    const win = target + (r() < 0.25 ? Math.floor(r() * 6) : 0);
    // Rarely a shutout, for the same reason the skill spread is narrow: a
    // uniform draw over the target makes one game in twenty a skunk.
    const lose = r() < 0.04 ? 0 : 1 + Math.floor(r() * (target - 1));
    const flip = r() < 0.5;
    const [x, y] = flip ? [lose, win] : [win, lose];
    const side = (names) => names.join(' & ');
    const teamA = doubles ? side(here.slice(0, 2)) : here[0];
    const teamB = doubles ? side(here.slice(2, 4)) : here[1];
    const to = target === 21 ? '' : `  to ${target}`;
    legacyLines.push(`${iso(t)}  ${teamA} v ${teamB}  ${x}-${y}${to}`);
  }
}

// The editions of the cup that predate the app, written into the same file the
// friendlies are — which is how they would really arrive, and what makes the fixture
// exercise the transcription rules rather than only the shapes they produce.
//
//   I   — the trophy and nothing else, so `fieldKnown` is false and the series table
//         says it is counting only who is remembered.
//   II  — the field somebody wrote down as well, so the row lists who took part and the
//         same table counts everybody who entered that year.
//   III — a sheet that survived, so it has ties and no round detail: the shape that
//         drops the rate columns from a tournament's Stats tab and leaves the margins
//         as the only thing it can say about how the games went.
//
// III is **played through the real bracket and then written back out as lines**, so
// import-legacy.mjs reconstructs the draw from the results the way it would from a real
// sheet. The reconstruction is a rule rather than a rendering, and a fixture that wrote
// the draw down would be asserting nothing about it.
const sheet = playTournamentWith(r, skillFor, {
  id: idFor('holecorn-cup-iii'),
  name: 'Hole Corn III',
  mode: 'singles',
  target: 21,
  from: at('2023-09-06', 18),
  // Everybody who was around that summer, Upsilon included — the series table is where
  // somebody who entered and won nothing has to appear at all.
  entrants: [NEIL, 'Rho', 'Sigma', 'Tau', 'Phi', 'Upsilon'].map((n) => [n]),
}).ties;

legacyLines.push(
  'tournament Hole Corn I  won 2021-08-28 by Rho',
  'tournament Hole Corn II  won 2022-09-03 by Tau beating Rho' +
    '  from Neil, Rho, Sigma, Tau, Phi, Upsilon',
  'tournament Hole Corn III',
  ...sheet.map((tie) => {
    const score = finalScore(tie);
    return `${iso(tie.startedAt)}  ${tie.players.a[0]} v ${tie.players.b[0]}  ${score.a}-${score.b}`;
  }),
);

const parsed = parseGames(legacyLines.join('\n'));
for (const warning of parsed.warnings) console.error(`legacy: ${warning}`);
for (const problem of parsed.problems) console.error(`legacy: ${problem}`);
if (parsed.problems.length) process.exit(1);

// import-legacy.mjs has no basis for choosing colours — the game was never played
// in the app — so it uses the first two swatches for everything. Varied here
// because the point of the fixture is to have something to look at.
const legacy = parsed.records.map((m) => ({ ...m, colors: colours(r) }));

const modern = [];
for (const t of modernDays) {
  for (let g = 0; g < 2 + (r() < 0.5 ? 1 : 0); g += 1) {
    const doubles = r() < 0.45;
    const here = attendees(t, doubles ? 4 : 2);
    if (here.length < (doubles ? 4 : 2)) continue;
    const players = doubles
      ? { a: here.slice(0, 2), b: here.slice(2, 4) }
      : { a: [here[0], ''], b: [here[1], ''] };
    const startedAt = t + g * 2_700_000;
    const record = playMatch(r, {
      id: idFor(`holecorn-sample ${iso(t)} ${g} ${here.join(',')}`),
      startedAt,
      mode: doubles ? 'doubles' : 'singles',
      players,
      colors: colours(r),
      target: pick(r, TARGETS),
    });
    if (record) modern.push(record);
  }
}

// The cups played in the app. One of each thing to look at: a clean power of two with no
// preliminaries, an uneven field that has them, and one still running — which is what
// puts a bracket on the setup screen's button and leaves ties to play.
//
// Three of them are further editions of Hole Corn, so that series spans every shape a
// tournament has; the other two are here for what a *second* series is worth. A cup
// played once is a series of one, so `Boxing Day Cup` is what says the Series section
// draws only where a name has been used twice — and the Shield is the pair that has
// been, with its newest edition finished, which is the only thing `Draw` offers a next
// edition for. Its first edition carries no numeral, the common shape where nobody knew
// there would be a second.
const CUPS = [
  {
    id: idFor('holecorn-boxing-day'),
    name: 'Boxing Day Cup',
    mode: 'singles',
    // Short games in the cold, which is also the fixture's only cup played to anything
    // but 21 — the target is fixed by the draw, so the tie's own screen has to say it.
    target: 15,
    from: at('2024-12-26', 14),
    entrants: [NEIL, 'Rho', 'Sigma', 'Chi', 'Eta'].map((n) => [n]),
  },
  {
    id: idFor('holecorn-cup-iv'),
    name: 'Hole Corn IV',
    mode: 'doubles',
    target: 21,
    from: at('2025-06-14', 18),
    entrants: [
      [NEIL, 'Rho'],
      ['Sigma', 'Tau'],
      ['Phi', 'Chi'],
      ['Eta', 'Psi'],
    ],
  },
  {
    id: idFor('holecorn-cup-v'),
    name: 'Hole Corn V',
    mode: 'singles',
    target: 21,
    from: at('2025-10-04', 18),
    entrants: [NEIL, 'Rho', 'Sigma', 'Tau', 'Phi', 'Chi', 'Eta', 'Psi', 'Omega', 'Omicron'].map(
      (n) => [n],
    ),
  },
  {
    id: idFor('holecorn-shield-i'),
    name: 'Seafront Shield',
    mode: 'singles',
    target: 21,
    from: at('2025-08-16', 17),
    entrants: [NEIL, 'Rho', 'Sigma', 'Tau'].map((n) => [n]),
  },
  {
    id: idFor('holecorn-shield-ii'),
    name: 'Seafront Shield II',
    mode: 'singles',
    target: 21,
    from: at('2026-05-09', 17),
    // Not the same four, because who turns up changes — which is what gives a series
    // table rows with different numbers of editions entered.
    entrants: [NEIL, 'Rho', 'Phi', 'Chi'].map((n) => [n]),
  },
  {
    id: idFor('holecorn-cup-vi'),
    name: 'Hole Corn VI',
    mode: 'singles',
    target: 21,
    from: at('2026-06-20', 18),
    // Left part way through on purpose, so the fixture has a live bracket with ties
    // waiting rather than only finished ones.
    stopAfter: 3,
    entrants: [NEIL, 'Rho', 'Sigma', 'Tau', 'Phi', 'Chi', 'Eta', 'Psi', 'Omega', 'Omicron'].map(
      (n) => [n],
    ),
  },
];

// The transcribed editions first, so the list is not in the order this script happens to
// build it — the screen sorts on `createdAt` anyway, but a file that reads chronologically
// is easier to check by eye.
const tournaments = [...parsed.tournaments];
const tourneyTies = [];
for (const cup of CUPS) {
  const { tournament, ties } = playTournamentWith(r, skillFor, cup);
  const view = bracket(tournament, ties);
  if (!validTournament(tournament)) {
    console.error(`rejected by validTournament: ${tournament.name}`);
    process.exit(1);
  }
  // A cup that was meant to finish and did not is a broken fixture, not a live one.
  if (cup.stopAfter === undefined && !view.done) {
    console.error(`${tournament.name} did not reach a champion (${view.played}/${view.total})`);
    process.exit(1);
  }
  tournaments.push(tournament);
  tourneyTies.push(...ties);
}

const records = [...legacy, ...modern, ...tourneyTies].sort((x, y) => x.endedAt - y.endedAt);
for (const record of records) {
  if (!validRecord(record)) {
    console.error(`rejected by validRecord: ${record.id}`);
    process.exit(1);
  }
}

// Upsilon stopped coming at the cutover, which is already what gives the career table a
// row of dashes — so he is also the person the fixture marks as having left. Through
// `markInactive` rather than written out, because the mark is stamped past the person's
// last match as well as by the clock and a hand-written stamp could sit behind it, where
// nothing on any screen would look any different.
const inactive = markInactive({}, 'Upsilon', records, at('2024-09-15', 12));

mkdirSync(new URL('fixtures/', import.meta.url).pathname, { recursive: true });
// The export envelope rather than a bare list, because a file carrying the ties but not
// the brackets imports without complaint and leaves every tournament pointing at
// nothing. One record per line: pretty-printing puts every bag on its own line and makes
// the diff unreadable, and a single line makes it unreviewable.
const file = archiveFile(records, tournaments, inactive);
writeFileSync(
  OUT,
  `{\n"format": ${file.format},\n"tournaments": [\n${tournaments
    .map((x) => JSON.stringify(x))
    .join(',\n')}\n],\n"inactive": ${JSON.stringify(inactive)},\n"matches": [\n${records
    .map((m) => JSON.stringify(m))
    .join(',\n')}\n]\n}\n`,
);

const people = new Set(
  records.flatMap((m) => [...m.players.a, ...m.players.b].map(nameKey).filter(Boolean)),
);
const rounds = records.reduce((n, m) => n + m.rounds.length, 0);
console.log(
  `${records.length} matches (${legacy.length} result-only, ${modern.length} scored, ` +
    `${tourneyTies.length} tournament ties), ${rounds} rounds, ${people.size} players, ` +
    `${iso(records[0].endedAt)} to ${iso(records[records.length - 1].endedAt)}`,
);
for (const t of tournaments) {
  const view = bracket(t, records);
  const who = view.champion
    ? `won by ${view.champion.names.filter(Boolean).join(' & ')}`
    : 'in progress';
  console.log(
    view.recorded
      ? `  ${t.name}: ${view.entrants.length} entrants known` +
          `${view.fieldKnown ? '' : ' (finalists only)'}, no sheet, ${who}`
      : `  ${t.name}: ${t.entrants.length} entrants, ${view.played}/${view.total} ties, ${who}`,
  );
}
// Said separately because a series is derived from the names, so it is the one thing here
// that a rename in the fixture could silently take apart.
for (const group of groupBySeries(tournaments).filter((g) => g.editions.length > 1)) {
  console.log(`  series ${group.name}: ${group.editions.map((t) => t.name).join(', ')}`);
}
console.log(`  inactive: ${Object.keys(inactive).join(', ') || 'nobody'}`);
