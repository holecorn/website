// Builds tools/out/stress-archive.json — an absurd amount of history, for finding out
// where the UI stops coping.
//
//   node tools/make-stress-archive.mjs
//
// **Not checked in**, unlike tools/fixtures/sample-archive.json: it runs to megabytes,
// and `tools/out/` is gitignored. Generate it when you want it. The sample is the one
// that has to stay realistic and reviewable; this one exists to be unreasonable.
//
// Played through the real scoring and bracket functions all the same — see
// tools/lib/fixture.mjs — so nothing in here describes a state the app cannot reach.
// Deterministic, so a layout problem found once can be found again.
//
// What it is trying to break, and why each one is here:
//
//   * A 64-entrant bracket. Six rounds, 63 ties, 32 boxes in the deepest column. The
//     round headings reach "Round of 64", which is the longest string the paging bar and
//     the heading row ever hold — and the widest bracket the drawing has to fit.
//   * A 31-entrant bracket, which is the *worst* ragged shape there is: 15 preliminary
//     ties and exactly one bye, so the deepest column is as uneven as it can get.
//   * A 32-pair doubles bracket. Every box holds "Xxx & Yyy", which is the longest label
//     a tie can carry, in the narrowest column.
//   * One left part way through with a great many ties playable at once, which is what
//     the "Ready to play" list has to survive.
//   * **Nine editions of one cup**, which is the only thing that makes the Series section
//     draw at all — every other tournament here is a series of one. The field changes
//     every year, so the across-the-years table is far longer than any single edition,
//     and the roll of honour is nine lines. Two of the editions are transcribed results
//     rather than brackets, one of them listing a field of 40 — the widest "Took part"
//     row there is — and one remembering nobody but the winner, which is what captions
//     the table as counting only who is known. The newest is still being played, so it
//     contributes entrants and ties and no honours.
//   * A second series at the draw form's own 32-character cap, so the next-edition chip
//     is the widest one that can be offered, and four other finished cups besides — the
//     suggestion row caps at three and a fixture that never reaches it cannot show that.
//   * A fifth of the roster marked inactive, chosen as whoever has not played for
//     longest, so the name fields offer a filtered list and the career table has a good
//     many dimmed rows.
//   * ~70 players, so the career table is long and the rivals list has depth.
//   * Names at the app's 16-character cap, two-character names, names sharing initials,
//     one accented (non-ASCII is what pushes the scoreboard payload to its widest), and
//     one containing " & " — the name that would read as a pair if a label were built by
//     joining names raw. Deliberately no non-Latin script: the panel's font cannot draw it
//     at all, so it exercises nothing the accent does not and only makes the board look
//     broken.
//   * Targets of 12 and 30, so there are both very short games and very long ones.
//   * A wide skill spread — the opposite of the sample's deliberately narrow one — so
//     there are plenty of skunks and blowouts for the summary chips and streaks.
//
// It also reports its own size against the localStorage budget, because that is a real
// limit the app hits rather than a hypothetical one: `saveArchive` drops the oldest match
// and retries when a write fails.

import { writeFileSync, mkdirSync } from 'node:fs';
import { nameKey } from '../src/scoring.js';
import { archiveFile, validRecord } from '../src/archive.js';
import { markInactive } from '../src/inactive.js';
import { rosterFor } from '../src/stats.js';
import {
  bracket,
  groupBySeries,
  nextEditions,
  recordedTournament,
  validTournament,
} from '../src/tournament.js';
import { DAY, at, colours, idFor, iso, pick, playMatch, playTournament, rng } from './lib/fixture.mjs';

const OUT = new URL('out/stress-archive.json', import.meta.url).pathname;

// Greek throughout bar Neil: this is a public repo and the people this group actually
// plays with must not be in it. The compounds are self-evidently synthetic, which is the
// same reason the long-name fixtures elsewhere use slices of AlphaBetaGammaDe... rather
// than a plausible name.
const LETTERS = [
  'Alpha',
  'Beta',
  'Gamma',
  'Delta',
  'Epsilon',
  'Zeta',
  'Eta',
  'Theta',
  'Iota',
  'Kappa',
  'Lambda',
  'Mu',
  'Nu',
  'Xi',
  'Omicron',
  'Pi',
  'Rho',
  'Sigma',
  'Tau',
  'Upsilon',
  'Phi',
  'Chi',
  'Psi',
  'Omega',
];

// 16 is the app's own cap on a typed name, so these are the widest anything downstream
// ever has to draw.
const NAME_MAX = 16;
const LONG = 'AlphaBetaGammaDeltaEpsilonZeta';

const ROSTER = [
  'Neil',
  ...LETTERS,
  // At and just under the cap.
  LONG.slice(0, 16),
  LONG.slice(0, 15),
  LONG.slice(4, 20),
  // Sharing an initial, which is the pair the board's label shortening has to keep apart.
  'Omegalpha',
  'Omicronbeta',
  // One accented name, and deliberately no non-Latin script. The panel's 5x7 font has no
  // glyphs beyond uppercase ASCII, so a wholly Greek-script name draws as nothing but the
  // unknown-character dash — which was worth *finding* once and is noise to keep, because
  // nobody is going to type it. An accent is the realistic case and degrades readably:
  // `José` draws as `JOS-`, losing one character rather than the whole name.
  //
  // It still stresses the payload, which is what the non-ASCII was here for: names are
  // capped at 16 UTF-16 units, so an accent costs two of the board's bytes for one
  // character and pushes the packet towards its widest.
  'José',
  // A name that looks like the join. The archive keeps it as typed; `sideLabel` is what
  // stops a label built from it reading as two people, so this is the row that shows a
  // singles player announced and drawn as one.
  'Alpha & Beta',
  // Compounds, to reach a field of 64 without inventing people.
  ...LETTERS.flatMap((a, i) =>
    LETTERS.slice(i + 1, i + 3).map((b) => `${a}${b}`.slice(0, NAME_MAX)),
  ),
].filter((n, i, all) => all.indexOf(n) === i);

const r = rng(20260801);

// Wide on purpose, the opposite of the sample's narrow band: under cancellation a wide
// spread produces shutouts at a rate nobody would recognise, which is exactly what a
// stress fixture wants for the skunk chip and the streak column.
const skill = new Map(
  ROSTER.map((name, i) => [
    name,
    { hole: 0.1 + ((i * 7) % 30) / 100, board: 0.28 + ((i * 11) % 22) / 100 },
  ]),
);
const skillFor = (name) => skill.get(name) ?? { hole: 0.2, board: 0.4 };

const TARGETS = [21, 21, 21, 15, 12, 30];
const FROM = at('2024-01-06', 12);

// ---- Tournaments -----------------------------------------------------------------

const singles = (names) => names.map((n) => [n]);
const pairs = (names) =>
  Array.from({ length: Math.floor(names.length / 2) }, (_, i) => [names[i * 2], names[i * 2 + 1]]);

// Nine editions of one cup, played every August. Every other tournament here is a series
// of one, so this is the only thing that makes the Series section draw — and it is the
// hardest version of it: the field shifts by four names a year, so nine editions of eight
// entrants make a table with far more rows than any single edition has entrants.
const SERIES = 'Nine Editions';
const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
const edition = (n) => `${SERIES} ${NUMERALS[n]}`;
const august = (n) => at(`${2018 + n}-08-11`, 18);

// The two oldest are transcribed results rather than brackets, which is where that shape
// really turns up: the editions with no sheet left are the early ones. `field` is a set
// rather than a seating — nothing is ever drawn from it — so a recorded edition still
// counts everybody towards the series without describing a bracket that was never kept.
const RECORDED = [
  recordedTournament({
    id: idFor('stress-series-1'),
    name: edition(0),
    createdAt: august(0),
    // No runner-up and no field, so `fieldKnown` is false and the series table says it is
    // counting only who is remembered.
    champion: [ROSTER[3]],
  }),
  recordedTournament({
    id: idFor('stress-series-2'),
    name: edition(1),
    createdAt: august(1),
    champion: [ROSTER[5]],
    runnerUp: [ROSTER[9]],
    // Forty, which is the widest Took part row there is — and wide enough to reach the
    // name containing " & ", which reads as a pair if a label is built by joining names.
    field: singles(ROSTER.slice(0, 40)),
  }),
];

const CUPS = [
  ...Array.from({ length: 6 }, (_, i) => ({
    slug: `stress-series-${i + 3}`,
    name: edition(i + 2),
    mode: 'singles',
    target: 21,
    from: august(i + 2),
    entrants: singles(ROSTER.slice(i * 4, i * 4 + 8)),
  })),
  {
    slug: 'stress-series-9',
    name: edition(8),
    mode: 'singles',
    target: 21,
    from: august(8),
    // The newest edition is still being played, so the series contributes its entrants and
    // its ties and no honours — and `Draw` offers no next edition for a series in progress,
    // which is what the two below are here to cover instead.
    stopAfter: 3,
    // Reaches the two names sharing an initial and the one with " & " in it, so a bracket
    // box holds both of the labels that are hard to draw.
    entrants: singles(ROSTER.slice(24, 32)),
  },
  {
    slug: 'stress-trophy-1',
    // 28 characters, so the next edition of it is `... III` at exactly 32 — the draw form's
    // own `maxLength`, and the widest chip the suggestion row can offer. The chip fills the
    // name field, so a suggestion the form would refuse is the failure this stresses.
    name: 'Epsilon Zeta Memorial Trophy',
    mode: 'singles',
    target: 21,
    from: at('2025-02-15', 18),
    entrants: singles(ROSTER.slice(8, 12)),
  },
  {
    slug: 'stress-trophy-2',
    name: 'Epsilon Zeta Memorial Trophy II',
    mode: 'singles',
    target: 21,
    from: at('2026-02-14', 18),
    entrants: singles(ROSTER.slice(10, 14)),
  },
  {
    slug: 'stress-64',
    name: 'Sixty-Four',
    mode: 'singles',
    target: 21,
    from: at('2024-03-02', 18),
    entrants: singles(ROSTER.slice(0, 64)),
  },
  {
    slug: 'stress-31',
    name: 'Ragged Thirty-One',
    mode: 'singles',
    target: 21,
    // 31 is 2p - 1 for p = 16: fifteen preliminary ties and exactly one bye, the most
    // uneven a deepest column can be.
    from: at('2024-09-07', 18),
    entrants: singles(ROSTER.slice(0, 31)),
  },
  {
    slug: 'stress-doubles',
    name: 'Thirty-Two Pairs',
    mode: 'doubles',
    target: 21,
    from: at('2025-04-05', 18),
    entrants: pairs(ROSTER.slice(0, 64)),
  },
  {
    slug: 'stress-live',
    // The long name goes on the *unfinished* one, because the setup screen's button only
    // names a tournament still running — `name · X of Y` on a finished cup is drawn
    // nowhere, so a long name there stresses nothing.
    //
    // Exactly 32 characters, which is the draw form's own `maxLength`. Longer would be
    // testing a name nobody can type, and a fixture showing a state the app cannot reach
    // is the one thing these are not for.
    name: 'AlphaBetaGammaDelta Invitational',
    mode: 'singles',
    target: 21,
    from: at('2026-05-09', 18),
    // Stopped early, and 48 entrants means sixteen preliminaries plus sixteen byes — so a
    // great many ties are playable at once, which is what the Ready to play list has to
    // cope with.
    stopAfter: 6,
    entrants: singles(ROSTER.slice(0, 48)),
  },
  {
    slug: 'stress-tiny',
    name: 'Three',
    mode: 'singles',
    target: 12,
    from: at('2026-06-13', 18),
    entrants: singles(ROSTER.slice(0, 3)),
  },
  {
    slug: 'stress-two',
    name: 'Just The Two Of Us',
    mode: 'singles',
    target: 30,
    from: at('2026-06-27', 18),
    entrants: singles(ROSTER.slice(4, 6)),
  },
];

const tournaments = [...RECORDED];
const tourneyTies = [];
for (const cup of CUPS) {
  const { tournament, ties } = playTournament(r, skillFor, { ...cup, id: idFor(cup.slug) });
  const view = bracket(tournament, ties);
  if (!validTournament(tournament)) {
    console.error(`rejected by validTournament: ${cup.name}`);
    process.exit(1);
  }
  if (cup.stopAfter === undefined && !view.done) {
    console.error(`${cup.name} did not reach a champion (${view.played}/${view.total})`);
    process.exit(1);
  }
  tournaments.push(tournament);
  tourneyTies.push(...ties);
}

// ---- Ordinary games --------------------------------------------------------------

// Enough sessions to give every one of ~70 players a career, a streak and a rivals list.
const ordinary = [];
for (let day = 0; day < 420; day += 1) {
  const t = FROM + day * 2 * DAY;
  for (let g = 0; g < 1 + Math.floor(r() * 3); g += 1) {
    const doubles = r() < 0.4;
    const need = doubles ? 4 : 2;
    const here = [];
    while (here.length < need) {
      const name = pick(r, ROSTER);
      if (!here.includes(name)) here.push(name);
    }
    const record = playMatch(r, skillFor, {
      id: idFor(`holecorn-stress ${day} ${g} ${here.join(',')}`),
      startedAt: t + g * 2_700_000,
      mode: doubles ? 'doubles' : 'singles',
      players: doubles
        ? { a: here.slice(0, 2), b: here.slice(2, 4) }
        : { a: [here[0], ''], b: [here[1], ''] },
      colors: colours(r),
      target: pick(r, TARGETS),
    });
    if (record) ordinary.push(record);
  }
}

const records = [...ordinary, ...tourneyTies].sort((x, y) => x.endedAt - y.endedAt);
for (const record of records) {
  if (!validRecord(record)) {
    console.error(`rejected by validRecord: ${record.id}`);
    process.exit(1);
  }
}

// A fifth of the roster has stopped coming, taken as whoever has gone longest without a
// game rather than at random — a mark on somebody who played last week is a state the app
// can reach but nobody would set, and the point of the pile is the filtered name list and
// the dimmed rows underneath it. Through `markInactive`, so the stamp lands past their
// last match the way the button's does.
const lastSeen = new Map();
for (const match of records) {
  for (const team of ['a', 'b']) {
    for (const name of rosterFor(match, team)) {
      if (match.endedAt > (lastSeen.get(name)?.at ?? 0)) lastSeen.set(name, { at: match.endedAt });
    }
  }
}
const departed = [...lastSeen.entries()]
  .sort((x, y) => x[1].at - y[1].at)
  .slice(0, Math.round(lastSeen.size / 5))
  .map(([name]) => name);
const inactive = departed.reduce(
  (marks, name) => markInactive(marks, name, records, at('2026-07-01', 12)),
  {},
);

mkdirSync(new URL('out/', import.meta.url).pathname, { recursive: true });
const json = `{\n"format": ${archiveFile([], []).format},\n"tournaments": [\n${tournaments
  .map((x) => JSON.stringify(x))
  .join(',\n')}\n],\n"inactive": ${JSON.stringify(inactive)},\n"matches": [\n${records
  .map((m) => JSON.stringify(m))
  .join(',\n')}\n]\n}\n`;
writeFileSync(OUT, json);

const people = new Set(
  records.flatMap((m) => [...m.players.a, ...m.players.b].map(nameKey).filter(Boolean)),
);
const rounds = records.reduce((n, m) => n + m.rounds.length, 0);
console.log(
  `${records.length} matches (${tourneyTies.length} tournament ties), ${rounds} rounds, ` +
    `${people.size} players, ${iso(records[0].endedAt)} to ${iso(records.at(-1).endedAt)}`,
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
      : `  ${t.name}: ${t.entrants.length} entrants, ${view.shape.rounds} rounds, ` +
          `${view.played}/${view.total} ties, ${view.playable.length} playable, ${who}`,
  );
}
for (const group of groupBySeries(tournaments).filter((g) => g.editions.length > 1)) {
  console.log(`  series ${group.name}: ${group.editions.length} editions`);
}
console.log(
  `  next editions offered: ${nextEditions(tournaments, records)
    .map((x) => `${x.name} (${x.name.length})`)
    .join(', ')}`,
);
console.log(`  ${departed.length} of ${lastSeen.size} players marked inactive`);
// localStorage is a real limit rather than a hypothetical one: `saveArchive` drops the
// oldest match and retries when a write fails, so a fixture near the budget is exactly
// where that behaviour becomes visible. Roughly 5MB per origin, counted as characters.
const mb = json.length / 1_048_576;
console.log(
  `\n${mb.toFixed(2)} MB of JSON — about ${Math.round((mb / 5) * 100)}% of a 5MB ` +
    `localStorage budget.\n  ${OUT}`,
);
