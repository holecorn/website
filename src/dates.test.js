import { describe, expect, it } from 'vitest';
import { dateSpan, dropRepeatedYear, sameDay, shortDate } from './dates.js';

// Absolute, so a run in December says the same thing as a run in June — the whole reason
// nothing in here reads Date.now().
const JUL = Date.parse('2025-07-05T12:00:00');
const SEP = Date.parse('2025-09-14T12:00:00');
const DEC = Date.parse('2025-12-28T12:00:00');
const JAN = Date.parse('2026-01-03T12:00:00');

describe('shortDate', () => {
  it('always carries the year', () => {
    expect(shortDate(JUL)).toMatch(/25$/);
    expect(shortDate(JAN)).toMatch(/26$/);
  });

  it('has nothing to say about no date', () => {
    expect(shortDate(null)).toBe('');
    expect(shortDate(0)).toBe('');
  });
});

describe('dateSpan', () => {
  it('writes the year once when both ends are in it', () => {
    const span = dateSpan(JUL, SEP);
    expect(span).toBe(`${new Date(JUL).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${shortDate(SEP)}`);
    // The year is on the line, just not twice.
    expect(span.match(/25/g)).toHaveLength(1);
  });

  it('writes both when a tournament crosses one', () => {
    const span = dateSpan(DEC, JAN);
    expect(span).toBe(`${shortDate(DEC)} – ${shortDate(JAN)}`);
    expect(span).toContain('25');
    expect(span).toContain('26');
  });

  // A small cup is drawn and won in an afternoon, so this is ordinary rather than an edge
  // case — and hours apart within one day still has to collapse.
  it('is the date once when both ends are the same day', () => {
    expect(dateSpan(JUL, JUL)).toBe(shortDate(JUL));
    expect(dateSpan(Date.parse('2025-07-05T09:00:00'), Date.parse('2025-07-05T21:30:00'))).toBe(
      shortDate(JUL),
    );
    expect(dateSpan(JUL, JUL)).not.toContain('–');
  });

  it('falls back to whichever end it has', () => {
    expect(dateSpan(JUL, null)).toBe(shortDate(JUL));
    expect(dateSpan(null, SEP)).toBe(shortDate(SEP));
    expect(dateSpan(null, null)).toBe('');
  });
});

describe('sameDay', () => {
  it('is the calendar day, not the stamp', () => {
    expect(sameDay(Date.parse('2025-07-05T09:00:00'), Date.parse('2025-07-05T21:30:00'))).toBe(true);
    expect(sameDay(Date.parse('2025-07-05T23:59:00'), Date.parse('2025-07-06T00:01:00'))).toBe(false);
    expect(sameDay(JUL, SEP)).toBe(false);
  });
});

describe('dropRepeatedYear', () => {
  it('leaves the year off when the line already carries it', () => {
    expect(dropRepeatedYear(JUL, SEP)).not.toContain('25');
    expect(dropRepeatedYear(JUL, SEP)).toContain('Sept');
  });

  it('keeps it when the two are in different years', () => {
    expect(dropRepeatedYear(DEC, JAN)).toBe(shortDate(JAN));
  });

  // Nothing else is on the line to carry it, so the rule that the year is always shown
  // takes over.
  it('keeps it when there is no earlier date at all', () => {
    expect(dropRepeatedYear(null, SEP)).toBe(shortDate(SEP));
  });
});
