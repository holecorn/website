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
import { PALETTE } from './scoring.js';

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

// The second thing only the stylesheets know: what colour is drawn on what. Neither of
// these is reachable from a component test — `vitest.config.js` is `environment: 'node'`
// and nothing imports a `.jsx` — and neither is reachable from a browser check either,
// because a low-contrast button renders perfectly and screenshots clean.
//
// Measured before this existed: white ink on the four fills the app uses came out at
// 2.87:1 on the green, 3.48:1 on the red and **1.59:1** on the yellow, against the 4.5:1
// small text needs — and the winner banner takes the *winner's* colour, so it was the
// yellow figure whenever the yellow team won. The team colours are also text on
// `--panel`, where blue sat at 4.15. `Display.css` had already found the answer for its
// own banner and held it as a literal, which is how the phone and the board came to
// disagree about the same fact.
const AA = 4.5;

const channels = (hex) => {
  const full = hex.length === 4 ? hex.replace(/[0-9a-f]/gi, (c) => c + c) : hex;
  const n = parseInt(full.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// WCAG relative luminance, which is not the same as the channel-mean duty figure
// `DUTY_CEILING` uses on the panel — don't reach for one where the other is meant.
const luminance = (hex) =>
  channels(hex)
    .map((c) => c / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((sum, c, i) => sum + [0.2126, 0.7152, 0.0722][i] * c, 0);

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// The custom properties, so a rule saying `var(--on-accent)` is checked as the colour it
// resolves to rather than skipped for not being a hex.
const root = /:root\s*\{([^}]*)\}/.exec(sheets.find((s) => s.file === 'index.css').text)[1];
const VARS = Object.fromEntries(
  [...root.matchAll(/(--[a-z-]+)\s*:\s*(#[0-9a-f]{3,8})/gi)].map((m) => [m[1], m[2].toLowerCase()])
);

const resolve = (value) => {
  const hex = /#[0-9a-f]{3}(?:[0-9a-f]{3})?\b/i.exec(value);
  if (hex) return hex[0].toLowerCase();
  const named = /var\(\s*(--[a-z-]+)/i.exec(value);
  return named ? VARS[named[1]] : null;
};

// Every rule that sets both an ink and a fill in one place. A rule that sets only one of
// them is out of scope — what it lands on depends on the DOM, which no parse can know —
// so this covers the case the defect was in: a control that declares its own background
// and its own colour together.
function inkOnFill(text) {
  const out = [];
  for (const [, sel, decls] of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declared = (prop) => {
      const found = new RegExp(`(^|;)\\s*${prop}\\s*:([^;]+)`, 'i').exec(decls);
      return found ? resolve(found[2]) : null;
    };
    const fill = declared('background') ?? declared('background-color');
    const ink = declared('color');
    if (fill && ink) out.push({ sel: sel.trim().replace(/\s+/g, ' '), fill, ink });
  }
  return out;
}

describe('contrast', () => {
  // The banner takes the winning team's colour, so one ink has to clear all four — which
  // is the whole reason it is a variable rather than #fff at each site.
  it.each(PALETTE)('$name is legible under --on-accent', ({ value }) => {
    expect(contrast(VARS['--on-accent'], value)).toBeGreaterThanOrEqual(AA);
  });

  // A team colour is text as well as fill: the lane header, the name input, the history
  // cells and the toss line all draw the name in it, at 10-13px.
  it.each(PALETTE)('$name is legible as text on --panel and --bg', ({ value }) => {
    expect(contrast(value, VARS['--panel'])).toBeGreaterThanOrEqual(AA);
    expect(contrast(value, VARS['--bg'])).toBeGreaterThanOrEqual(AA);
  });

  it.each(sheets.map((s) => s.file))('%s: every rule that fills and inks is legible', (file) => {
    const { text } = sheets.find((s) => s.file === file);
    const failing = inkOnFill(text)
      .filter(({ fill, ink }) => contrast(ink, fill) < AA)
      .map(({ sel, fill, ink }) => `${sel} { ${ink} on ${fill} } is ${contrast(ink, fill).toFixed(2)}:1`);
    expect(failing).toEqual([]);
  });

  // The winner banner is the rule with the worst figure and the one nothing above can
  // see: its fill is an inline style off `colors[winner]`, so the stylesheet holds an
  // ink with no background beside it and the pairing exists only at runtime. A class
  // handed a team colour in JSX may therefore take no ink but `--on-accent` — it cannot
  // know which of the four it will be wearing. Elements with no text of their own (the
  // swatches, the confetti) set no `color` and are left alone.
  it('nothing filled with a team colour from JSX inks itself another way', () => {
    const jsx = readFileSync(new URL('App.jsx', dir), 'utf8');
    const filled = [...jsx.matchAll(/className="([a-z-]+)"[^>]*background: (?:game\.)?colors\[/g)].map(
      (m) => m[1]
    );
    expect(filled.length).toBeGreaterThan(0);

    const css = sheets.map((s) => s.text).join('\n');
    const wrong = filled.filter((cls) => {
      const rule = new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`).exec(css);
      const ink = rule && /(^|;)\s*color\s*:([^;]+)/.exec(rule[1]);
      return ink && resolve(ink[2]) !== VARS['--on-accent'];
    });
    expect(wrong).toEqual([]);
  });
});
