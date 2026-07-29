// The wordmark's geometry exists twice: src/Logo.jsx draws it in the app, and
// public/logo.svg is what firmware/hub75/generate_logo.mjs bakes for the LED panel. They
// cannot be merged — the component takes the team colours as props, and the generator
// needs a file it can hand to a browser — so this holds them together instead.
//
// Without it the panel would go on showing the shape the SVG last held while the app drew
// a different one, and the only symptom would be that the splash looks slightly wrong
// next to the phone.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

// Attribute names differ between JSX and SVG (strokeWidth vs stroke-width), and so do the
// quotes, so each value is pulled by a pattern that accepts either spelling.
function geometry(source) {
  const all = (re) => [...source.matchAll(re)].map((m) => m[1]);
  const one = (re) => {
    const found = all(re);
    expect(found.length, `expected one match for ${re}`).toBeGreaterThan(0);
    return found[0];
  };
  return {
    viewBox: one(/viewBox="([^"]+)"/g),
    rotations: all(/rotate\((-?[\d.]+)\)/g),
    translations: all(/translate\(([\d.]+ [\d.]+)\)/g),
    fontSize: one(/font-?[sS]ize="?\{?(\d+)/g),
    letterSpacing: one(/letter-?[sS]pacing="?\{?(\d+)/g),
    strokeWidth: all(/stroke-?[wW]idth="?\{?(\d+)/g),
    rects: all(/<rect ([^/>]+)/g).map((attrs) =>
      ['x', 'y', 'width', 'height', 'rx'].map((k) => attrs.match(new RegExp(`${k}="(-?[\\d.]+)"`))?.[1]),
    ),
    texts: all(/<text ([^>]+)/g).map((attrs) =>
      ['x', 'y'].map((k) => attrs.match(new RegExp(`${k}="(-?[\\d.]+)"`))?.[1]),
    ),
  };
}

describe('the wordmark', () => {
  const jsx = geometry(read('./Logo.jsx'));
  const svg = geometry(read('../public/logo.svg'));

  it('is the same shape in Logo.jsx and public/logo.svg', () => {
    expect(jsx).toEqual(svg);
  });

  // The panel needs the shallower tilt to fit 32 rows at a legible size, and the app
  // follows it so the two match. Pinned as a pair rather than as a value: what matters is
  // that the two words lean opposite ways by the same amount.
  it('leans both words by the same angle, in opposite directions', () => {
    const [first, second] = jsx.rotations.map(Number);
    expect(jsx.rotations).toHaveLength(2);
    expect(first).toBe(-second);
    expect(Math.abs(first)).toBeGreaterThan(0);
  });

  // A rotated box is much taller than its content, so the viewBox has to be sized to the
  // tilt or the height saved is spent on empty space instead. Measured, a box trimmed to
  // what the mark paints gives 4.00 at 8 degrees and 3.37 at 15, so 3.8 sits between them:
  // it fails if the tilt is eased without re-deriving the box, and if the box is left loose
  // enough to reintroduce the padding that put 50px above the mark against a 20px rhythm.
  it('has a viewBox proportioned to that angle', () => {
    const [, , w, h] = jsx.viewBox.split(' ').map(Number);
    expect(w / h).toBeGreaterThan(3.8);
  });
});
