// Turn games written down before the app existed into an archive file the stats
// screen can import.
//
// A record built here has a date, the people and the final score, and no rounds.
// That is a deliberate half-record rather than a lossy one: `rounds` holds every
// bag's resting tier, and inventing tiers to reach a known total would put
// fabricated hole and board counts into every rate on the career screen. So the
// score travels in `final` — the one thing about such a match that genuinely
// isn't derivable — and everything measured off thrown bags leaves these matches
// out. See "Matches with no round detail" in CLAUDE.md.
//
// Ties from a past tournament go in the same file, under a `tournament` header, and
// come out tagged with a bracket the app can draw. See `HEADER` for the syntax and
// `drawOrder` for how a draw nobody wrote down is recovered from the results.
//
//   node tools/import-legacy.mjs games.txt > legacy.json
//
// Then Import on the stats screen. Ids are content-derived, so re-running this
// and re-importing adds nothing; see `idFor`.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { RECORD_FORMAT, archiveFile, validRecord } from '../src/archive.js';
import { DEFAULT_TARGET, PALETTE, nameKey, sideKeyOf } from '../src/scoring.js';
import {
  bracket,
  bracketShape,
  newTournament,
  recordedTournament,
  validTournament,
} from '../src/tournament.js';

// One match per line. Blank lines and `#` comments are skipped, so the file can
// be annotated as it is transcribed.
//
//   2024-05-18  Neil v Sigma  21-13
//   2024-05-18  Neil & Rho v Sigma & Tau  21-9
//   2024-06-02  Neil v Rho  9-15  to 15
//
// Partners are separated by `&` or a comma, sides by ` v ` or ` vs `, and the
// mode follows from how many names a side has. A trailing `to N` gives the
// target where it wasn't 21.
const LINE =
  /^(\d{4})-(\d{2})-(\d{2})\s+(.+?)\s+vs?\s+(.+?)\s+(\d+)\s*[-–]\s*(\d+)(?:\s+to\s+(\d+))?$/;

// A `tournament` line opens a section: every match line below it is one of that
// tournament's ties, until the next `tournament` line or a line reading `friendlies`.
// Ordinary games are what a file holds by default, so nothing has to be said to write
// one — which is also what keeps every file written before this parsing unchanged.
//
//   tournament Hole Corn V
//   2024-09-01  Neil v Sigma  21-13
//   2024-09-01  Rho v Tau     21-9
//   friendlies
//   2024-09-08  Neil v Rho    21-16
//
// A tournament whose sheet is gone carries its result on the header line instead and
// opens no section at all — see `recordedTournament`. The runner-up is optional because
// it is the half people forget, and so is the field, because it is the half nobody wrote
// down. Entrants are separated by commas and a doubles pair by `&`, the way a side is
// written everywhere else in the file:
//
//   tournament Hole Corn I   won 2019-08-30 by Rho
//   tournament Hole Corn II  won 2020-08-29 by Rho beating Tau
//   tournament Hole Corn III won 2021-09-04 by Rho beating Tau from Neil, Rho, Sigma, Tau
//
// The name is lazy so that the optional result is preferred over swallowing it, which is
// what makes a header with no `won` take the whole line as the name. `from` nests inside
// the result for the same reason it reads that way: a tournament with no winner recorded
// has no field to list either, because there is then nothing to hang it on.
const HEADER =
  /^tournament\s+(.+?)(?:\s+won\s+(\d{4})-(\d{2})-(\d{2})\s+by\s+(.+?)(?:\s+beating\s+(.+?))?(?:\s+from\s+(.+?))?)?$/;
const FRIENDLIES = /^friendlies$/;

// The app caps a typed name here, and the board's own limit is smaller still.
const NAME_MAX = 16;

function splitSide(text, where, problems, warnings) {
  const names = text
    .split(/\s*[&,]\s*/)
    .map((n) => n.trim())
    .filter(Boolean);
  if (names.length < 1 || names.length > 2) {
    problems.push(`${where}: a side needs one or two names, got ${names.length}`);
  }
  for (const name of names) {
    if (name.length > NAME_MAX) {
      warnings.push(`${where}: "${name}" is over ${NAME_MAX} characters and will be cut short`);
    }
  }
  return names;
}

// Content-derived rather than random, which is what makes re-running this safe:
// `mergeMatches` keys on the id, so the same line always produces the same match
// and importing twice adds nothing. `seen` disambiguates a day that genuinely
// holds the same fixture and score twice — counted per identical match rather
// than per line, so inserting an unrelated game later doesn't renumber anything
// and turn the whole file into new records.
// The separator is a NUL because a name may contain a space: joined with one,
// `Neil Prosser v Rho` and `Neil v Prosser Rho` canonicalise the same. It was a literal
// NUL in the source until this file grew, which made git call the whole thing binary and
// the diffs unreadable — the escape hashes identically, verified against the ids the
// committed version produced.
function idFor(parts, seen) {
  const canon = parts.join('\0');
  const n = (seen.get(canon) ?? 0) + 1;
  seen.set(canon, n);
  return createHash('sha256').update(`${canon}\0${n}`).digest('hex').slice(0, 32);
}

function parseLine(raw, lineNo, seen, perDay, problems, warnings, tournamentId) {
  const where = `line ${lineNo}`;
  const m = LINE.exec(raw);
  if (!m) {
    problems.push(`${where}: cannot read "${raw}"`);
    return null;
  }
  const [, y, mo, d, aText, bText, aScore, bScore, toTarget] = m;

  const a = splitSide(aText, where, problems, warnings);
  const b = splitSide(bText, where, problems, warnings);
  if (a.length !== b.length) {
    problems.push(`${where}: ${a.length} against ${b.length} — both sides need the same count`);
    return null;
  }

  // Refused rather than warned about, unlike the archive's own name editor: this
  // is a lineup being created from a file that can be corrected, so it is the
  // setup screen's rule that applies. A name on both sides would credit one
  // person a win and a loss for the same match.
  const clash = [...a, ...b].filter((n, i, all) => all.findIndex((o) => nameKey(o) === nameKey(n)) !== i);
  if (clash.length) {
    problems.push(`${where}: "${clash[0]}" appears more than once`);
    return null;
  }

  const scoreA = Number(aScore);
  const scoreB = Number(bScore);
  // A draw is an abandoned game, since the match ends when somebody reaches the
  // target — and the app itself never files one, for the same reason. Refused
  // rather than stored with a null winner, which is not an absence downstream:
  // `playerStats` credits a loss to whichever side isn't the winner, so both
  // players take a loss and an L in their form line, while `headToHead` and
  // `sideRecord` skip the match entirely.
  if (scoreA === scoreB) {
    problems.push(`${where}: ${scoreA}–${scoreB} is a draw, so nobody finished the game`);
    return null;
  }

  const date = new Date(Number(y), Number(mo) - 1, Number(d), 12, 0, 0, 0);
  if (date.getMonth() !== Number(mo) - 1 || date.getDate() !== Number(d)) {
    problems.push(`${where}: ${y}-${mo}-${d} is not a date`);
    return null;
  }
  const day = `${y}-${mo}-${d}`;
  // Streaks and form read the archive in `endedAt` order, so games on one day
  // have to keep the order they were written down in. A minute apart is enough
  // and the times are not shown anywhere.
  const nth = (perDay.get(day) ?? 0) + 1;
  perDay.set(day, nth);

  const target = toTarget ? Number(toTarget) : DEFAULT_TARGET;
  const winnerScore = Math.max(scoreA, scoreB);
  const loserScore = Math.min(scoreA, scoreB);
  // Both sides at the target is not a game that could have been played: only one
  // team scores in a round, so the match ended when the first of them got there
  // and the other could never have gone on. Overshooting is fine for the winner
  // — a round nets up to 12 — which is why only the loser is bounded.
  if (loserScore >= target) {
    problems.push(
      `${where}: ${scoreA}–${scoreB} both reach ${target}, so the game would have ended sooner`,
    );
    return null;
  }
  // Not refused: a game that stopped before anyone got there is a real thing to
  // have written down, and `to N` is how to say so.
  if (winnerScore < target) {
    warnings.push(`${where}: won on ${winnerScore}, short of ${target} — add "to ${winnerScore}"?`);
  }

  const mode = a.length === 2 ? 'doubles' : 'singles';
  // The unused singles slot is left empty rather than filled with a default
  // name: `participants` drops a blank, where "Player 2" would collect every
  // singles opponent under one phantom career.
  const slots = (names) => (mode === 'doubles' ? names : [names[0], '']);

  return {
    format: RECORD_FORMAT,
    id: idFor([day, mode, ...a, ...b, String(scoreA), String(scoreB)], seen),
    endedAt: date.getTime() + (nth - 1) * 60_000,
    mode,
    players: { a: slots(a), b: slots(b) },
    colors: { a: PALETTE[0].value, b: PALETTE[1].value },
    target,
    winner: scoreA > scoreB ? 'a' : 'b',
    // Absent on an ordinary game rather than null, so a record outside a tournament keeps
    // exactly the shape it had before tournaments existed.
    ...(tournamentId ? { tournament: tournamentId } : {}),
    // No rounds, so the score has nowhere else to live. `stats.js` reads this
    // only when `rounds` is empty, so it can never contradict a real game.
    final: { a: scoreA, b: scoreB },
    rounds: [],
    // No `startedAt`: these were not timed, and `matchDuration` already refuses
    // a missing one rather than measuring from the epoch.
    //
    // No `updatedAt` either, so these tie at 0 against anything already on the
    // phone. That keeps the import idempotent and lets a name fixed on the phone
    // survive re-importing this file. A tie gets one — see `stampTies`.
  };
}

// --- Past tournaments -------------------------------------------------------------
//
// The draw is the one thing a transcribed tournament does not have. `bracket()` seats
// entrants in array order, so **the order is the pairings**, and a sheet nobody kept
// cannot supply it.
//
// It does not have to. The backward walk in docs/TOURNAMENT.md rebuilds the tree from
// the results alone: the last tie is the final, each finalist's previous tie is its
// semi-final, and the walk terminates because a side loses at most once. That gives the
// tree that was actually played, and `drawOrder` then says which entrant order makes the
// app draw the same one.

const sideOf = (record, team) => record.players[team].filter(Boolean);
const keyOf = (record, team) => sideKeyOf(sideOf(record, team));

// The tree as played, from the results. Each node is a tie whose two children are the
// ties its sides came out of, or the entrants themselves where they entered.
function playedTree(ties, problems, where) {
  const byTime = [...ties].sort((x, y) => x.endedAt - y.endedAt);
  const used = new Set();
  // The latest tie this side played before the one they are advancing into. It is theirs
  // to advance from, because a side that lost is seated in no further tie — so any earlier
  // tie of theirs is one they won.
  const previous = (key, before) =>
    byTime.findLast(
      (t) => t.endedAt < before && !used.has(t) && (keyOf(t, 'a') === key || keyOf(t, 'b') === key),
    ) ?? null;
  const node = (t) => {
    used.add(t);
    return {
      tie: t,
      kids: [keyOf(t, 'a'), keyOf(t, 'b')].map((key) => {
        const prev = previous(key, t.endedAt);
        return prev ? node(prev) : { seat: key };
      }),
    };
  };
  const root = node(byTime[byTime.length - 1]);
  // A tie the walk never reached is a result that belongs to no bracket — most likely an
  // ordinary game left under the header by mistake, or a side entered twice. Left to be
  // reported rather than quietly dropped, because the bracket would then be missing a tie
  // with nothing on screen to say which.
  if (used.size !== ties.length) {
    problems.push(
      `${where}: ${ties.length - used.size} of ${ties.length} ties are not part of the bracket`,
    );
    return null;
  }
  return root;
}

// Which order the entrants have to be drawn in for `bracketShape` to produce the tree
// above. The canonical shape fixes which seats hold preliminaries — alternating halves,
// top down — so this is an embedding rather than a relabelling: at every node the two
// subtrees are tried both ways round, and a tournament whose preliminaries sat somewhere
// the app would never put them has no order at all. That is reported rather than fudged;
// see `drawOrder`'s caller.
function seatEntrants(root, shape) {
  const fit = (lo, hi, node) => {
    if (hi - lo === 1) {
      const wanted = shape.seats[lo];
      if (wanted === 1) return node.seat ? [[node.seat]] : null;
      if (node.seat || node.kids.some((k) => !k.seat)) return null;
      return [node.kids.map((k) => k.seat)];
    }
    if (node.seat) return null;
    const mid = (lo + hi) / 2;
    for (const [x, y] of [
      [0, 1],
      [1, 0],
    ]) {
      const left = fit(lo, mid, node.kids[x]);
      const right = left && fit(mid, hi, node.kids[y]);
      if (left && right) return [...left, ...right];
    }
    return null;
  };
  const seats = fit(0, shape.size, root);
  return seats ? seats.flat() : null;
}

// The whole reconstruction for one tournament section: its field, its draw order, and the
// checks that say the bracket the app will draw is the tournament that was played.
function drawOrder(block, problems) {
  const { name, ties } = block;
  const where = `tournament "${name}"`;
  const names = new Map();
  for (const t of ties) {
    for (const team of ['a', 'b']) names.set(keyOf(t, team), sideOf(t, team));
  }
  const n = names.size;
  const modes = new Set(ties.map((t) => t.mode));
  const targets = new Set(ties.map((t) => t.target));
  // Both are fixed by the draw in the app, and for the reason a mixed one would be
  // unreadable rather than merely odd: a bracket where one tie was played to 12 among
  // ties played to 21 is not one competition, and no screen could say it had happened.
  //
  // Asked before the field is counted, because a mixed section fails that count too — a
  // doubles tie among singles ones brings four entrants where the bracket wanted two —
  // and "5 entrants need 4 ties" is a true sentence that sends you to the wrong line.
  if (modes.size > 1) {
    problems.push(`${where}: singles and doubles ties in one tournament`);
    return null;
  }
  if (targets.size > 1) {
    problems.push(`${where}: ties played to ${[...targets].sort((x, y) => x - y).join(' and ')}`);
    return null;
  }
  // A knockout of n sides is exactly n - 1 ties. Anything else is a missing tie or an
  // ordinary game filed under the header, and either way the walk below would build a
  // tree that quietly leaves somebody out.
  if (ties.length !== n - 1) {
    problems.push(`${where}: ${n} entrants need ${n - 1} ties, got ${ties.length}`);
    return null;
  }
  const root = playedTree(ties, problems, where);
  const entrants = root && seatEntrants(root, bracketShape(n));
  if (!entrants) {
    if (root) {
      problems.push(
        `${where}: the preliminaries sat where the app would not draw them, so no draw ` +
          'order reproduces this bracket',
      );
    }
    return null;
  }
  const tournament = newTournament({
    id: block.id,
    name,
    mode: [...modes][0],
    target: [...targets][0],
    entrants: entrants.map((key) => names.get(key)),
    // The draw date is not knowable either, so the earliest tie stands in for it. The row
    // draws a finished tournament as a bare span from here to the final, which then reads
    // as when it was played — and both lists sort on it, so the years come out in order.
    createdAt: Math.min(...ties.map((t) => t.endedAt)),
  });
  // The bracket the app will actually draw, against the results that are about to be
  // imported with it. Every tie placed and the right champion is the only thing that says
  // the reconstruction worked — and the failure it guards is silent, because a tie the
  // bracket cannot place simply renders as one still to play.
  const view = bracket(tournament, ties);
  const won = ties.reduce((a, b) => (a.endedAt > b.endedAt ? a : b));
  if (view.played !== view.total) {
    problems.push(`${where}: the bracket places ${view.played} of ${view.total} ties`);
    return null;
  }
  if (view.champion.key !== keyOf(won, won.winner)) {
    problems.push(`${where}: the bracket makes ${view.champion.names.join(' & ')} champion`);
    return null;
  }
  return tournament;
}

// A tie is stamped so that tagging lands on a record already imported untagged. Unedited
// records tie at 0 and `mergeMatches` keeps the local copy, so without this the tag would
// silently never arrive for anyone who imported their legacy games before tournaments
// existed — which is everyone.
//
// The tournament's own date rather than the clock: it re-runs identically, it beats an
// untouched local record, and it **loses to a name corrected in the app**, which is the
// one local edit worth protecting. Correct a tie's names in the file, not on the phone.
function stampTies(tournament, ties) {
  for (const tie of ties) tie.updatedAt = tournament.createdAt;
}

// A tournament's id, derived from its name for the reason a match's is derived from its
// line: `mergeTournaments` keys on it, so re-running this and re-importing has to land on
// the same tournament rather than a second copy of it. Renaming one in the file therefore
// makes a new tournament and orphans the old ties — which is loud, since the old bracket
// then reports every tie missing.
function tournamentId(name) {
  return createHash('sha256').update(`tournament ${name}`).digest('hex').slice(0, 32);
}

// A `tournament` header, which either opens a section of ties or is a whole recorded
// result on its own. Returns the section to file the lines below it under, or null.
function openTournament(head, where, tournaments, named, problems, warnings) {
  const [, name, y, mo, d, champion, runnerUp, field] = head;
  // The id is the name, so a second header of the same name is a second section of one
  // tournament — and only the first would keep its ties. Refused rather than merged: the
  // file is the thing to correct, and a section split in two is a transcription slip.
  if (named.has(name)) {
    problems.push(`${where}: "${name}" already has a section`);
    return null;
  }
  named.add(name);
  if (!y) return { id: tournamentId(name), name, ties: [] };
  const date = new Date(Number(y), Number(mo) - 1, Number(d), 12, 0, 0, 0);
  if (date.getMonth() !== Number(mo) - 1 || date.getDate() !== Number(d)) {
    problems.push(`${where}: ${y}-${mo}-${d} is not a date`);
    return null;
  }
  const side = (text) => text.split(/\s*[&,]\s*/).map((n) => n.trim()).filter(Boolean);
  // Commas separate entrants here where they separate partners in a side, so the two
  // splits are done in that order rather than by one pass over both characters.
  const entered = field
    ? field.split(',').map((entry) => splitSide(entry, where, problems, warnings))
    : [];
  // The winner not being among them is a transcription slip rather than a shape the app
  // has to carry: `storedResult` unions them anyway, so the count still comes out right —
  // but a misspelling would put the same person in the table twice, once with no honours.
  const listed = new Set(entered.map(sideKeyOf));
  for (const [who, names] of [['winner', champion], ['runner-up', runnerUp]]) {
    if (names && entered.length > 0 && !listed.has(sideKeyOf(side(names)))) {
      warnings.push(`${where}: the ${who} is not in the field listed`);
    }
  }
  tournaments.push(
    recordedTournament({
      id: tournamentId(name),
      name,
      createdAt: date.getTime(),
      champion: side(champion),
      runnerUp: runnerUp ? side(runnerUp) : null,
      field: entered,
    }),
  );
  return null;
}

// Exported so tools/make-sample-archive.mjs builds its legacy half through this
// rather than growing a second copy of the record shape — which also means the
// checked-in sample only regenerates if this parser still works.
export function parseGames(text) {
  const problems = [];
  const warnings = [];
  const seen = new Map();
  const perDay = new Map();
  const records = [];
  const tournaments = [];
  const sections = [];
  const named = new Set();
  let section = null;

  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const where = `line ${i + 1}`;
    if (FRIENDLIES.test(line)) {
      section = null;
      return;
    }
    const head = HEADER.exec(line);
    if (head) {
      section = openTournament(head, where, tournaments, named, problems, warnings);
      if (section) sections.push(section);
      return;
    }
    const record = parseLine(line, i + 1, seen, perDay, problems, warnings, section?.id);
    if (!record) return;
    records.push(record);
    if (section) section.ties.push(record);
  });

  for (const block of sections) {
    if (block.ties.length === 0) {
      problems.push(`tournament "${block.name}": no ties under it`);
      continue;
    }
    const tournament = drawOrder(block, problems);
    if (!tournament) continue;
    stampTies(tournament, block.ties);
    tournaments.push(tournament);
  }

  // The app's own gates, not a copy of them: `mergeMatches` and `mergeTournaments` drop
  // anything that fails these, silently, so a file that would half-import is caught here.
  for (const record of records) {
    if (!validRecord(record)) problems.push(`${record.id}: rejected by validRecord`);
  }
  for (const t of tournaments) {
    if (!validTournament(t)) problems.push(`tournament "${t.name}": rejected by validTournament`);
  }
  return { records, tournaments, problems, warnings };
}

// Only when run directly, so importing the parser above costs no argv handling.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file] = process.argv.slice(2);
  if (!file) {
    console.error('usage: node tools/import-legacy.mjs <games.txt> > legacy.json');
    process.exit(2);
  }

  const { records, tournaments, problems, warnings } = parseGames(readFileSync(file, 'utf8'));
  for (const warning of warnings) console.error(`warning: ${warning}`);
  if (problems.length) {
    for (const problem of problems) console.error(`error: ${problem}`);
    console.error(`\n${problems.length} problem(s), nothing written`);
    process.exit(1);
  }

  const people = new Set(
    records.flatMap((r) => [...r.players.a, ...r.players.b].map(nameKey).filter(Boolean)),
  );
  console.error(`${records.length} match(es), ${people.size} player(s)`);
  // Said one at a time rather than counted, because a reconstructed bracket is the part
  // worth reading back: this is the only place the derived draw is ever described, and a
  // tournament that came out with the wrong champion has already failed above.
  for (const t of tournaments) {
    console.error(
      t.entrants
        ? `${t.name}: ${t.entrants.length} entrants, ${t.entrants.length - 1} ties, ` +
            `won by ${bracket(t, records).champion.names.filter(Boolean).join(' & ')}`
        : `${t.name}: ${t.field ? `${t.field.length} entrants, no ties` : 'result only'}, ` +
          `won by ${t.champion.filter(Boolean).join(' & ')}`,
    );
  }
  // The envelope, always — a bare array of matches imports without complaint and leaves
  // every tournament in it pointing at nothing. `readArchiveFile` still reads the old
  // shape, so a file written before this keeps working.
  process.stdout.write(`${JSON.stringify(archiveFile(records, tournaments), null, 2)}\n`);
}
