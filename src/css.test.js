// The cascade in the stylesheets, which nothing else can see.
//
// `App.css`'s responsive tiers and every other top-level `@media` block win at **equal
// specificity by source order alone** — they redeclare the same selectors the base rules
// do, with no extra class to lift them. So a base rule written *below* a tier silently
// beats it, and the symptom is a tier that appears to do nothing: no error, no warning,
// and only at the size that tier is for. `App.css` collapsed the scoring lanes to 26px
// exactly this way once.
//
// CLAUDE.md carried it as "the tiers live at the end of the file, after the base rules",
// which is a *position* standing in for the property. Position had already drifted — 22
// base rules sat below a tier in `App.css`, 18 in `Stats.css`, 7 in `Display.css` — while
// the property itself held, because none of those tiers names any of those selectors.
// Measured: 47 strays, 0 overridden. A positional check would have failed on 47 harmless
// rules and still not have said which one mattered.
//
// So this asserts the property instead: a base rule may sit below a tier, but it may not
// **redeclare a property that tier already sets for the same selector**. That is the
// failure C4 described — a `.history` rule added to the landscape tier, silently beaten by
// the `.history` base rule below it. Verified by mutation rather than by failing today,
// since the invariant currently holds: adding `.history { gap }` to the landscape tier
// fails this and nothing else.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = new URL('./', import.meta.url);

// Comments are blanked rather than removed so a brace inside one cannot move the depth,
// and so offsets still line up with the source.
const decomment = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

// Selector plus the properties it sets. Shorthands are not expanded — `padding` against
// `padding-left` reads as different properties here, which under-reports rather than
// crying wolf, and the case this exists for is a rule copied wholesale into a tier.
const rulesIn = (body) =>
  [...body.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, decls]) => ({
    sel: sel.trim().replace(/\s+/g, ' '),
    props: new Set([...decls.matchAll(/(^|;)\s*(-{0,2}[a-z][-a-z0-9]*)\s*:/g)].map((m) => m[2])),
  }));

// Split a stylesheet into the top-level runs of base rules and the top-level `@media`
// blocks between them, in source order. Nested at-rules inside a block travel with it.
function segments(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  let inMedia = false;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '{') {
      if (depth === 0) {
        const head = text.slice(start, i);
        const at = head.lastIndexOf('@media');
        if (at !== -1 && !head.slice(at).includes('}')) {
          parts.push({ kind: 'base', body: head.slice(0, at) });
          start = start + at;
          inMedia = true;
        }
      }
      depth += 1;
    } else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0 && inMedia) {
        parts.push({ kind: 'media', query: /@media([^{]*)/.exec(text.slice(start))[1].trim() });
        parts[parts.length - 1].body = text.slice(start, i + 1).replace(/^[^{]*\{/, '');
        start = i + 1;
        inMedia = false;
      }
    }
  }
  parts.push({ kind: 'base', body: text.slice(start) });
  return parts;
}

function overrides(text) {
  const parts = segments(text);
  const out = [];
  for (const [i, part] of parts.entries()) {
    if (part.kind !== 'base') continue;
    const above = parts.slice(0, i).filter((p) => p.kind === 'media');
    for (const base of rulesIn(part.body)) {
      for (const tier of above) {
        for (const inTier of rulesIn(tier.body)) {
          if (inTier.sel !== base.sel) continue;
          const shared = [...base.props].filter((p) => inTier.props.has(p));
          if (shared.length) out.push(`${base.sel} { ${shared.join(', ')} } beats @media ${tier.query}`);
        }
      }
    }
  }
  return out;
}

const sheets = readdirSync(dir)
  .filter((name) => name.endsWith('.css'))
  .map((file) => ({ file, text: decomment(readFileSync(new URL(file, dir), 'utf8')) }));

describe('stylesheets', () => {
  it('exist to be checked', () => {
    expect(sheets.length).toBeGreaterThan(0);
  });

  it.each(sheets.map((s) => s.file))('%s: no base rule silently beats a tier above it', (file) => {
    const { text } = sheets.find((s) => s.file === file);
    expect(overrides(text)).toEqual([]);
  });
});
