// Covers the part of src/panel.js the firmware drift check structurally cannot.
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
  LIVE_GRACE_MS,
  TEAM_LABEL_MAX,
  boardLiveness,
  boardState,
  labelBytes,
  liveWithGrace,
  parseColor,
} from './panel.js';

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
