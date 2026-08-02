// Covers the part of src/panelRender.js the firmware drift check structurally cannot.
//
// `npm run test:firmware` compares framebuffers against render.h, which pins
// `renderBoard` hard. But the scenes it compares are recorded from an
// *already-parsed* `BoardState`, so everything that turns a JSON payload into
// one — the coercions ported from board_logic.h's parseBoardState — is never
// exercised by it. Nor is `boardLiveness`, since `live` is an input to a scene
// rather than something a scene derives.
//
// These assert against what board_logic.h does, read from the C++. They are not
// a parity proof the way the pixel check is; they are here so a refactor of the
// unpinned half fails something.

import { describe, expect, it } from 'vitest';
import {
  boardScreen,
  LINEUP_FORM_MAX,
  LIVE_GRACE_MS,
  TEAM_LABEL_MAX,
  boardLiveness,
  boardState,
  labelBytes,
  lineupState,
  liveWithGrace,
  parseColor,
} from './panelRender.js';

const text = (bytes) => new TextDecoder().decode(bytes);

describe('parseColor', () => {
  it('reads a six-digit hex triple in either case', () => {
    expect(parseColor('#2f80ed')).toEqual({ r: 0x2f, g: 0x80, b: 0xed });
    expect(parseColor('#2F80ED')).toEqual({ r: 0x2f, g: 0x80, b: 0xed });
  });

  // board_logic.h leaves the default white rather than failing, so a malformed
  // colour shows a readable score instead of a black one.
  it('falls back to white rather than black', () => {
    for (const bad of ['not a colour', '#12345', '#12345g', '2f80ed', '', null, undefined, 42]) {
      expect(parseColor(bad)).toEqual({ r: 255, g: 255, b: 255 });
    }
  });
});

describe('labelBytes', () => {
  it('encodes as UTF-8, not latin-1', () => {
    expect([...labelBytes('é')]).toEqual([0xc3, 0xa9]);
  });

  // copyLabel fills a char[TEAM_LABEL_MAX] and NUL-terminates, so 39 bytes
  // survive. Truncating at 40 would overrun what the firmware holds.
  it('keeps one byte fewer than the firmware buffer', () => {
    const long = 'A'.repeat(60);
    expect(labelBytes(long)).toHaveLength(TEAM_LABEL_MAX - 1);
  });

  // A known limit rather than a bug: the panel cannot render these scripts
  // anyway. Documented in board_logic.h and firmware/hub75/README.md.
  // 'é' is two bytes, so 39 lands mid-character. Three-byte characters divide
  // into 39 evenly and would cut cleanly, which is not the case worth pinning.
  it('cuts mid-character rather than dropping a whole one', () => {
    const bytes = labelBytes('é'.repeat(25));
    expect(bytes).toHaveLength(39);
    expect(text(bytes).endsWith('�')).toBe(true);
  });

  it('treats a non-string as empty', () => {
    expect(labelBytes(undefined)).toHaveLength(0);
    expect(labelBytes(null)).toHaveLength(0);
    expect(labelBytes(7)).toHaveLength(0);
  });
});

describe('boardState', () => {
  // ArduinoJson hands the renderer ints, so a fractional value truncates rather
  // than reaching the digit formatter as a fraction.
  it('truncates numbers to integers', () => {
    const s = boardState({ a: 7.9, b: -0.5, round: 3.99, target: 21.5 });
    expect([s.a, s.b, s.round, s.target]).toEqual([7, 0, 3, 21]);
  });

  it('reads a missing or unusable number as zero', () => {
    const s = boardState({ a: 'x', b: undefined, round: NaN, target: null });
    expect([s.a, s.b, s.round, s.target]).toEqual([0, 0, 0, 0]);
  });

  // parseBoardState looks at winner[0] only, so both sides must agree that
  // "away" is team 'a' — otherwise one shows a winner and the other doesn't.
  it('takes only the first character of winner and first', () => {
    expect(boardState({ winner: 'a' }).winner).toBe('a');
    expect(boardState({ winner: 'away' }).winner).toBe('a');
    expect(boardState({ first: 'b', winner: 'b' })).toMatchObject({ first: 'b', winner: 'b' });
  });

  // Absent means "nobody has won" — the payload omits the key while the game is
  // live, so this must not become a truthy winner.
  it('reads anything else as no winner', () => {
    for (const v of [undefined, null, '', 'c', 'A', 0, true]) {
      expect(boardState({ winner: v }).winner).toBeNull();
    }
  });

  it('survives a null payload', () => {
    expect(boardState(null)).toMatchObject({ a: 0, b: 0, winner: null, first: null });
  });
});

// The pixel check drives these coercions (test-firmware.mjs feeds every form
// scene through lineupState), but only for rows the C++ already accepted. What it
// cannot reach is what happens to a *rejected* or oversized message, which is the
// half that decides whether a bad publish blanks a good board.
describe('lineupState', () => {
  const row = (over = {}) => ({ n: 'Neil', w: 6, l: 4, p: 72, f: 'LWLWW', ...over });
  const pair = (...rows) => ({ rows });

  it('reads a roster into rows the renderer can draw', () => {
    const l = lineupState(pair(row(), row({ n: 'Sigma', w: 4, l: 6, p: 60, f: 'WLWLL' })));
    expect(l.count).toBe(2);
    expect(text(l.rows[0].name)).toBe('Neil');
    expect(l.rows[0].wins).toBe(6);
    expect(l.rows[0].losses).toBe(4);
    expect(l.rows[0].ppr).toBe(72);
    expect(text(l.rows[0].form)).toBe('LWLWW');
  });

  // parseLineup refuses a count render.h cannot halve into two teams, rather than
  // drawing somebody in the other side's colour.
  it('is null for a count that cannot be split into two sides', () => {
    expect(lineupState(pair(row()))).toBeNull();
    expect(lineupState(pair(row(), row(), row()))).toBeNull();
    expect(lineupState({ rows: [] })).toBeNull();
    expect(lineupState(pair(row(), row(), row(), row(), row()))).toBeNull();
  });

  it('is null for anything that is not a roster', () => {
    for (const bad of [null, undefined, {}, { rows: 'two' }, 5, 'rows']) {
      expect(lineupState(bad)).toBeNull();
    }
  });

  // Clamped to what formatRecord and formatTenths can write, which is three digits a
  // side. Two was the original bound and silently drew "99" for anyone past 99 wins.
  it('clamps the record and the rate to what their columns hold', () => {
    const l = lineupState(pair(row({ w: 5000, l: -3, p: 99999 }), row()));
    expect(l.rows[0].wins).toBe(999);
    expect(l.rows[0].losses).toBe(0);
    expect(l.rows[0].ppr).toBe(999);
  });

  it('carries a three-digit record through intact', () => {
    const l = lineupState(pair(row({ w: 120, l: 87 }), row()));
    expect([l.rows[0].wins, l.rows[0].losses]).toEqual([120, 87]);
  });

  it('cuts the form string to the pips there are', () => {
    const l = lineupState(pair(row({ f: 'WWWWWWWWWW' }), row()));
    expect(l.rows[0].form).toHaveLength(LINEUP_FORM_MAX);
  });

  it('treats anything that is not a W as a loss', () => {
    const l = lineupState(pair(row({ f: 'WwXL?' }), row()));
    expect(text(l.rows[0].form)).toBe('WWLLL');
  });

  it('fills a missing field with zero rather than NaN', () => {
    const l = lineupState({ rows: [{ n: 'Psi' }, { n: 'Eta' }] });
    expect(l.rows[0]).toMatchObject({ wins: 0, losses: 0 });
    expect(l.rows[0].form).toHaveLength(0);
  });

  // The rate is the exception, mirroring `row["p"] | -1` in board_logic.h: 0.0 is
  // a real average, so an omitted rate — a record with no thrown bags behind it —
  // cannot arrive as the same value.
  it('reads a missing rate as -1, not as an average of zero', () => {
    const l = lineupState({ rows: [{ n: 'Psi', w: 6, l: 4 }, { n: 'Eta', w: 0, l: 5, p: 0 }] });
    expect(l.rows[0].ppr).toBe(-1);
    expect(l.rows[1].ppr).toBe(0);
  });

  // A name is UTF-8 bytes because that is what reaches the board, and it is cut
  // to what LineupRow holds — 16 UTF-16 units of 3-byte characters is 48 bytes,
  // so the cut lands exactly at the buffer and can land mid-character.
  it('carries a name as bytes, cut to the row buffer', () => {
    const wide = '€'.repeat(16);
    const l = lineupState(pair(row({ n: wide }), row()));
    expect(l.rows[0].name).toHaveLength(48);
    const longer = lineupState(pair(row({ n: 'A'.repeat(80) }), row()));
    expect(longer.rows[0].name).toHaveLength(48);
  });

  it('takes a missing name as empty rather than failing the row', () => {
    const l = lineupState({ rows: [{ w: 1, l: 1 }, { n: 'Eta' }] });
    expect(l.rows[0].name).toHaveLength(0);
  });
});

describe('liveWithGrace', () => {
  it('is live whenever the link is up', () => {
    expect(liveWithGrace(true, 1000, 0)).toBe(true);
  });

  it('is not live if the link was never up', () => {
    expect(liveWithGrace(false, 1000, 0)).toBe(false);
  });

  it('rides out a dropout shorter than the grace, and dims after it', () => {
    expect(liveWithGrace(false, 1000 + LIVE_GRACE_MS - 1, 1000)).toBe(true);
    expect(liveWithGrace(false, 1000 + LIVE_GRACE_MS, 1000)).toBe(false);
  });
});

describe('boardLiveness', () => {
  const at = (over) => boardLiveness({ connected: true, senderOnline: true, now: 0, lastLive: 0, ...over });

  it('is live and needs no timer while the link is up', () => {
    expect(at({})).toEqual({ live: true, dimAt: null });
  });

  // The firmware ands scorerOnline in outside the grace, so a goodbye dims at
  // once rather than after 30 seconds.
  it('dims at once when the scorer has said goodbye', () => {
    expect(at({ senderOnline: false })).toEqual({ live: false, dimAt: null });
    expect(at({ connected: false, senderOnline: false, lastLive: 1 })).toEqual({
      live: false,
      dimAt: null,
    });
  });

  it('has nothing to hold live if the link was never up', () => {
    expect(at({ connected: false, lastLive: 0 })).toEqual({ live: false, dimAt: null });
  });

  // The bug this function was extracted for: the grace has to run from the drop.
  // Stamping lastLive when the link *arrives* makes a session longer than the
  // grace dim the instant the socket goes.
  it('holds a fresh drop live, and asks to be looked at again', () => {
    const dropped = 10_000;
    expect(at({ connected: false, now: dropped, lastLive: dropped })).toEqual({
      live: true,
      dimAt: dropped + LIVE_GRACE_MS,
    });
  });

  it('dims once the grace has run out', () => {
    expect(at({ connected: false, now: 10_000 + LIVE_GRACE_MS, lastLive: 10_000 })).toEqual({
      live: false,
      dimAt: null,
    });
  });

  // A long healthy session must not shorten the grace: the drop stamp is what
  // matters, not how long the link had been up.
  it('gives a full grace however long the session was', () => {
    const connectedAt = 0;
    const droppedAt = connectedAt + 60 * 60_000;
    expect(at({ connected: false, now: droppedAt, lastLive: droppedAt })).toEqual({
      live: true,
      dimAt: droppedAt + LIVE_GRACE_MS,
    });
  });
});

describe('boardScreen', () => {
  const lineup = { count: 2, rows: [] };
  const tie = { set: true, cup: new Uint8Array(), round: new Uint8Array() };

  // The precedence renderBoard draws by, asked as a question so the emulator's
  // caption can use the same answer instead of re-deriving it.
  it('puts a tie above a lineup retained at the same time', () => {
    expect(boardScreen({ haveState: true, lineup, tie })).toBe('tie');
    expect(boardScreen({ haveState: true, lineup })).toBe('form');
  });

  // Unlike the lineup, the card is drawn from the two sides in the score message,
  // so with no state there is nobody to name and the dashes stand.
  it('needs board state for a tie, where a lineup does not', () => {
    expect(boardScreen({ haveState: false, tie })).toBe('no-state');
    expect(boardScreen({ haveState: false, lineup })).toBe('form');
  });

  it('leaves the scorer’s layout underneath both', () => {
    expect(boardScreen({ haveState: true, layout: 'score', tie })).toBe('tie');
    expect(boardScreen({ haveState: true, layout: 'score' })).toBe('score');
    expect(boardScreen({ haveState: true })).toBe('full');
  });

  it('ignores a cleared tie and an empty lineup', () => {
    expect(boardScreen({ haveState: true, tie: { set: false } })).toBe('full');
    expect(boardScreen({ haveState: true, lineup: { count: 0 } })).toBe('full');
  });
});
