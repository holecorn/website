// The helpers that exist *because* a second copy would drift, and the one check that they
// are still single.
//
// The corpus carries this as prose in six places — `nameKey` and `sideKeyOf` in
// `scoring.js` so the career fold and the bracket agree, `sideLabel` because four callers
// join names, `FormPips` and `dates.js` because two copies of "what this looks like" is
// the drift with no symptom. Every one of those notes is about a *past* consolidation, and
// prose is what was holding them.
//
// It did not hold. `pct` had **three** identical definitions — `format.js`, `Lineup.jsx`
// and `GameStats.jsx` — so the career table and the setup Form panel quoted the same
// player's hole percentage one screen apart through two different functions, and
// `GameStats.jsx` hand-rolled the plural `format.js` exists to get right (its own comment
// warns that a suffix rule gets wash/washes wrong; it was correct only by accident of
// three different suffixes). Nothing failed, because nothing was looking.
//
// A one-line formatter is easier to retype than to import, which is the whole hazard —
// there is no structural fix for it, so this is the check instead. **Adding a helper whose
// second copy would be silent means adding it here.**
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = new URL('./', import.meta.url);

// Where each one is allowed to be declared. The value is the owning module; anywhere else
// is a copy, whether it is exported or local.
const OWNED = {
  pct: 'format.js',
  one: 'format.js',
  plural: 'format.js',
  minutes: 'format.js',
  nameKey: 'scoring.js',
  sideKeyOf: 'scoring.js',
  sideLabel: 'scoring.js',
  splitLabel: 'scoring.js',
  playerLabel: 'scoring.js',
  teamLabel: 'scoring.js',
  winVerb: 'scoring.js',
  seriesKey: 'tournament.js',
  sideNames: 'tournament.js',
  shortDate: 'dates.js',
  dateSpan: 'dates.js',
  drawMeets: 'scoreboard.js',
  offerableNames: 'inactive.js',
};

// Declarations only — `const x =`, `function x`, `let x` — so a call site or an import
// naming the same symbol is not a false positive. Comments are blanked first so the prose
// above, which names most of these, cannot trip it.
const declarations = (text, name) => {
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  const pattern = new RegExp(`(^|[^\\w.$])(?:export\\s+)?(?:const|let|var|function)\\s+${name}\\b`, 'g');
  return [...code.matchAll(pattern)].length;
};

// The app, not the suites: a test may define whatever fixture it likes, and several
// deliberately spell out the value a helper should produce.
const sources = readdirSync(dir)
  .filter((f) => (f.endsWith('.js') || f.endsWith('.jsx')) && !f.endsWith('.test.js'))
  .map((file) => ({ file, text: readFileSync(new URL(file, dir), 'utf8') }));

describe('helpers that must have one definition', () => {
  it.each(Object.entries(OWNED))('%s is declared only in %s', (name, owner) => {
    const where = sources
      .filter(({ text }) => declarations(text, name) > 0)
      .map(({ file }) => file);
    expect(where).toEqual([owner]);
  });
});
