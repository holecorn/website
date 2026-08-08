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
// **And it is asked of both colour schemes now.** `index.css` declares every value as
// `light-dark(light, dark)`, so a single-scheme check would leave half the app unmeasured
// — and it is the half that exists for the harder case: the light scheme is what the app
// wears in the sun, where the figures are worst. Every assertion below runs twice.
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

const SCHEMES = ['light', 'dark'];
const pick = (scheme, light, dark) => (scheme === 'light' ? light : dark);

// `light-dark(a, b)` down to one side of itself, so everything below reads a plain hex.
const forScheme = (value, scheme) =>
  value.replace(/light-dark\(([^,()]+),([^()]+)\)/gi, (_, l, d) => pick(scheme, l, d).trim());

// The custom properties, per scheme, so a rule saying `var(--on-accent)` is checked as the
// colour it resolves to rather than skipped for not being a hex.
const root = /:root\s*\{([^}]*)\}/.exec(sheets.find((s) => s.file === 'index.css').text)[1];
const VARS = Object.fromEntries(
  SCHEMES.map((scheme) => [
    scheme,
    Object.fromEntries(
      [...forScheme(root, scheme).matchAll(/(--[a-z-]+)\s*:\s*(#[0-9a-f]{3,8})/gi)].map((m) => [
        m[1],
        m[2].toLowerCase(),
      ])
    ),
  ])
);

const resolve = (value, scheme) => {
  const v = forScheme(value, scheme);
  // A tint mixed towards `transparent` is not a fill — the panel behind it is what the ink
  // actually lands on, and which panel that is depends on the DOM. Same reason `rgba()` has
  // always fallen through to null here, and the same boundary as a rule that sets only one
  // of the pair. Without this, `color-mix(in srgb, var(--lift) 8%, transparent)` reads as a
  // solid white (or black) fill and two chips report a failure they do not have.
  if (/\btransparent\b/i.test(v)) return null;
  const hex = /#[0-9a-f]{3}(?:[0-9a-f]{3})?\b/i.exec(v);
  if (hex) return hex[0].toLowerCase();
  const named = /var\(\s*(--[a-z-]+)/i.exec(v);
  // `--team-accent` is per element — it derives from a `--team` set in JSX — so no parse
  // can say which of the four it is. The PALETTE assertions below cover it instead.
  return named ? (VARS[scheme][named[1]] ?? null) : null;
};

// `oklch(from var(--team) calc(l * 0.62) c h)`, the one derivation in `index.css` that
// isn't a literal — reimplemented here because it is the thing most worth pinning: the
// light scheme's entire legibility rests on it, and a stylesheet parse cannot evaluate it.
// Checked against what Chrome actually paints, which agrees to within one channel step.
// Read out of the stylesheet, never written down twice — the factor is the whole of the
// light scheme's legibility, and two copies of it is the mirrored-constant drift this
// project keeps finding: a test that agrees with itself while the app does something else.
//
// **Both forms are parsed, not just the one in use.** The obvious version reads only
// `calc(l * K)` and dies at import on anything else, which is the worst way for this to
// fail: the clamp it replaced is a plausible thing for someone to write back, and it took
// the whole file down naming nothing instead of failing the assertion that exists for it.
// Parsing what is actually there means the checks below measure the app rather than an
// assumption, and the clamp then fails the separation floor by name.
const LIGHTNESS = (() => {
  const css = sheets.find((s) => s.file === 'index.css').text;
  const scale = /--team-accent:[^;]*?calc\(\s*l\s*\*\s*([\d.]+)\s*\)/.exec(css);
  if (scale) return { kind: 'scale', k: Number(scale[1]), map: (l) => l * Number(scale[1]) };
  const clamp = /--team-accent:[^;]*?min\(\s*l\s*,\s*([\d.]+)\s*\)/.exec(css);
  if (clamp) return { kind: 'clamp', k: Number(clamp[1]), map: (l) => Math.min(l, Number(clamp[1])) };
  return { kind: 'none', k: NaN, map: (l) => l };
})();
const OK_SCALE = LIGHTNESS.k;
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function scaleLightness(hex, map = LIGHTNESS.map) {
  const [r, g, b] = channels(hex).map((c) => toLinear(c / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = map(0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const [l3, m3, s3] = [
    (L + 0.3963377774 * A + 0.2158037573 * B) ** 3,
    (L - 0.1055613458 * A - 0.0638541728 * B) ** 3,
    (L - 0.0894841775 * A - 1.291485548 * B) ** 3,
  ];
  return (
    '#' +
    [
      4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
      -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
      -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
    ]
      .map((v) => Math.round(Math.min(1, Math.max(0, toSrgb(v))) * 255))
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  );
}

// What a team colour is actually drawn in: itself on the dark scheme, darkened on the light
// one so it can be read against a white panel.
const teamAccent = (hex, scheme) => (scheme === 'light' ? scaleLightness(hex) : hex);

// **How far apart two colours look, which contrast cannot answer.** Contrast is a
// lightness ratio, so two colours may clear 4.5:1 against the page and still be the same
// colour as each other — which is the whole reason the two-channel rule exists, and the
// reason it needs measuring here rather than trusting to a hex looking different in an
// editor. CIEDE2000 over a dichromat simulation is what the project already quotes: red
// against green is 7.5 under deuteranopia, "not a near miss, the same colour".
//
// This exists because the derivation above regressed it and nothing noticed. `min(l, 0.5)`
// was the first form and it flattens all four to one lightness — the only channel a
// red-green dichromat has — taking red against yellow from 17.1 to **3.3**, worse than the
// pair the rule was written for. Scaling instead of clamping keeps the ordering.
const RGB_TO_LMS = [
  [0.31399, 0.63951, 0.04649],
  [0.15537, 0.75789, 0.0867],
  [0.01775, 0.10944, 0.87247],
];
const LMS_TO_RGB = [
  [5.47221206, -4.6419601, 0.16963708],
  [-1.1252419, 2.29317094, -0.1678952],
  [0.02980165, -0.19318073, 1.16364789],
];
// Brettel/Viénot dichromat projections. Tritanopia is left out deliberately: it does not
// confuse red with green or yellow, which is the failure this is about.
const DICHROMAT = {
  deuteranopia: [
    [1, 0, 0],
    [0.9513092, 0, 0.04289],
    [0, 0, 1],
  ],
  protanopia: [
    [0, 1.05118294, -0.05116099],
    [0, 1, 0],
    [0, 0, 1],
  ],
};
const apply = (m, v) => m.map((row) => row.reduce((sum, x, i) => sum + x * v[i], 0));
const clamp01 = (v) => Math.min(1, Math.max(0, v));

function simulate(hex, kind) {
  const linear = channels(hex).map((c) => toLinear(c / 255));
  if (!kind) return linear;
  return apply(LMS_TO_RGB, apply(DICHROMAT[kind], apply(RGB_TO_LMS, linear))).map(clamp01);
}

// Linear sRGB -> CIE Lab (D65).
function toLab(linear) {
  const [r, g, b] = linear;
  const xyz = [
    0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    0.2126729 * r + 0.7151522 * g + 0.072175 * b,
    0.0193339 * r + 0.119192 * g + 0.9503041 * b,
  ];
  const white = [0.95047, 1, 1.08883];
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const [fx, fy, fz] = xyz.map((v, i) => f(v / white[i]));
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function ciede2000([L1, a1, b1], [L2, a2, b2]) {
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;
  const cBar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const [A1, A2] = [(1 + g) * a1, (1 + g) * a2];
  const [C1, C2] = [Math.hypot(A1, b1), Math.hypot(A2, b2)];
  const angle = (x, y) => {
    if (x === 0 && y === 0) return 0;
    const t = Math.atan2(y, x) * deg;
    return t < 0 ? t + 360 : t;
  };
  const [h1, h2] = [angle(A1, b1), angle(A2, b2)];
  const dL = L2 - L1;
  const dC = C2 - C1;
  let dh = 0;
  if (C1 * C2 !== 0) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(C1 * C2) * Math.sin((dh / 2) * rad);
  const Lb = (L1 + L2) / 2;
  const Cb = (C1 + C2) / 2;
  let hb;
  if (C1 * C2 === 0) hb = h1 + h2;
  else {
    hb = Math.abs(h1 - h2) > 180 ? (h1 + h2 + 360) / 2 : (h1 + h2) / 2;
    if (hb >= 360) hb -= 360;
  }
  const T =
    1 -
    0.17 * Math.cos((hb - 30) * rad) +
    0.24 * Math.cos(2 * hb * rad) +
    0.32 * Math.cos((3 * hb + 6) * rad) -
    0.2 * Math.cos((4 * hb - 63) * rad);
  const Sl = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
  const Sc = 1 + 0.045 * Cb;
  const Sh = 1 + 0.015 * Cb * T;
  const Rt =
    -Math.sin(2 * 30 * Math.exp(-(((hb - 275) / 25) ** 2)) * rad) *
    (2 * Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  return Math.sqrt(
    (dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh)
  );
}

const separation = (x, y, kind) => ciede2000(toLab(simulate(x, kind)), toLab(simulate(y, kind)));

const PAIRS = PALETTE.flatMap((a, i) => PALETTE.slice(i + 1).map((b) => [a, b]));

// Every rule that sets both an ink and a fill in one place. A rule that sets only one of
// them is out of scope — what it lands on depends on the DOM, which no parse can know —
// so this covers the case the defect was in: a control that declares its own background
// and its own colour together.
function inkOnFill(text, scheme) {
  const out = [];
  for (const [, sel, decls] of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declared = (prop) => {
      const found = new RegExp(`(^|;)\\s*${prop}\\s*:([^;]+)`, 'i').exec(decls);
      return found ? resolve(found[2], scheme) : null;
    };
    const fill = declared('background') ?? declared('background-color');
    const ink = declared('color');
    if (fill && ink) out.push({ sel: sel.trim().replace(/\s+/g, ' '), fill, ink });
  }
  return out;
}

const cases = SCHEMES.flatMap((scheme) => PALETTE.map((c) => ({ ...c, scheme })));

const PAINTS = ['color', 'background', 'backgroundColor', 'borderColor'];

// A key is only a key where a `{` or a `,` precedes it, which is what tells the two apart:
// in `{ background: color }` the paint is the key, and in `{ '--team': color }` the very
// same word is the *value* and is exactly what this must not flag.
const PAINT_KEY = new RegExp(`[{,]\\s*(${PAINTS.join('|')})\\s*[:,}]`, 'g');

// The paints an inline `style` sets, across every `style={…}` expression in a file.
//
// Three shapes have to be caught and they look nothing alike. `style={{ color: c }}` names
// its key with a colon; `style={{ color }}` — the ES6 shorthand — has no colon at all, and
// a regex written for the first passes the second silently, which is how this check went
// green on the very mutation it exists for. And `style={first ? { … } : undefined}` does
// not begin `style={{`, which is where the one real miss was hiding when this was written.
// So the expression is taken by counting brackets rather than matched, and the keys are
// then found by the delimiter in front of them. Counting is safe over a template literal
// because `${…}` and `calc(…)` are balanced; matching inner `{…}` pairs is not, because
// then the template's own braces are the innermost pair and the object's keys are never
// looked at — the second way this went green when it should not have.
function styleKeys(text) {
  const keys = [];
  for (const m of text.matchAll(/style=\{/g)) {
    let depth = 0;
    let end = m.index + 'style='.length;
    for (; end < text.length; end += 1) {
      if ('{(['.includes(text[end])) depth += 1;
      else if ('})]'.includes(text[end])) {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    for (const key of text.slice(m.index, end + 1).matchAll(PAINT_KEY)) keys.push(key[1]);
  }
  return keys;
}

describe('contrast', () => {
  // The banner takes the winning team's colour, so one ink has to clear all four — which
  // is the whole reason it is a variable rather than #fff at each site. Both halves move
  // together between schemes: the light one darkens the fill and whitens the ink.
  it.each(cases)('$scheme: $name is legible under --on-accent', ({ value, scheme }) => {
    const fill = teamAccent(value, scheme);
    expect(contrast(VARS[scheme]['--on-accent'], fill)).toBeGreaterThanOrEqual(AA);
  });

  // A team colour is text as well as fill: the lane header, the name input, the history
  // cells and the toss line all draw the name in it, at 10-13px.
  it.each(cases)('$scheme: $name is legible as text on --panel and --bg', ({ value, scheme }) => {
    const ink = teamAccent(value, scheme);
    expect(contrast(ink, VARS[scheme]['--panel'])).toBeGreaterThanOrEqual(AA);
    expect(contrast(ink, VARS[scheme]['--bg'])).toBeGreaterThanOrEqual(AA);
  });

  // The three UI accents are read as text far more often than they are filled with — the
  // save warning, the lineup fault, the connected status, the outlined destructive
  // buttons — and none of those rules names a background, so `inkOnFill` cannot see them.
  it.each(SCHEMES.flatMap((s) => ['--go', '--warn', '--caution'].map((v) => ({ s, v }))))(
    '$s: $v is legible as text on --panel and --bg',
    ({ s, v }) => {
      expect(contrast(VARS[s][v], VARS[s]['--panel'])).toBeGreaterThanOrEqual(AA);
      expect(contrast(VARS[s][v], VARS[s]['--bg'])).toBeGreaterThanOrEqual(AA);
    }
  );

  // **No two teams may collapse into one colour, on either scheme.** Asserted as an
  // absolute floor rather than against the dark scheme's own worst, which was the first
  // form and is not reachable: a light page forces every colour *down*, so the lightness
  // range the four can spread over is smaller there and some loss is structural. Measured
  // — dark's worst pair is 7.5, the shipped scale's is 5.5, and matching 7.5 needs a
  // factor around 0.72, which fails the contrast floor two assertions below at 3.4:1.
  //
  // 5 is therefore set where it catches a *collapse* rather than the inherent squeeze.
  // The clamp this replaced measured **2.6** — red against yellow, closer than the
  // red/green pair the two-channel rule was written for.
  const FLOOR = 5;
  it.each(['deuteranopia', 'protanopia'])('no two teams collapse into one colour (%s)', (kind) => {
    const close = SCHEMES.flatMap((scheme) =>
      PAIRS.map(([a, b]) => ({
        scheme,
        pair: `${a.name}/${b.name}`,
        de: separation(teamAccent(a.value, scheme), teamAccent(b.value, scheme), kind),
      }))
    )
      .filter(({ de }) => de < FLOOR)
      .map(({ scheme, pair, de }) => `${scheme} ${pair} is ${de.toFixed(1)}`);
    expect(close).toEqual([]);
  });

  // The other half of why the factor is what it is, and the reason the two assertions have
  // to sit together: separation and legibility pull in opposite directions here. A lighter
  // factor spreads the four further apart (0.68 puts the worst pair at 6.7) and takes them
  // below 4.5:1 on the page; a darker one is legible and squashes them together. So this
  // pins the factor as the *largest* that still clears the floor — the four sit as far
  // apart as legibility allows, and neither bound can be loosened without the other
  // failing.
  it('the light derivation is as light as the contrast floor allows', () => {
    const clears = (factor) =>
      PALETTE.every(({ value }) => {
        const scaled = scaleLightness(value, (l) => l * factor);
        return (
          contrast(scaled, VARS.light['--bg']) >= AA && contrast(scaled, VARS.light['--panel']) >= AA
        );
      });
    expect(LIGHTNESS.kind).toBe('scale');
    expect(clears(OK_SCALE)).toBe(true);
    expect(clears(OK_SCALE + 0.02)).toBe(false);
  });

  // `--muted` is the app's second voice — captions, hints, table headings, the footer —
  // and it is the value a light palette is most easily got wrong at, because grey that
  // reads on near-black is far too pale on near-white.
  it.each(SCHEMES)('%s: --muted is legible on --panel and --bg', (scheme) => {
    expect(contrast(VARS[scheme]['--muted'], VARS[scheme]['--panel'])).toBeGreaterThanOrEqual(AA);
    expect(contrast(VARS[scheme]['--muted'], VARS[scheme]['--bg'])).toBeGreaterThanOrEqual(AA);
  });

  it.each(sheets.flatMap((s) => SCHEMES.map((scheme) => ({ file: s.file, scheme }))))(
    '$scheme: $file: every rule that fills and inks is legible',
    ({ file, scheme }) => {
      const { text } = sheets.find((s) => s.file === file);
      const failing = inkOnFill(text, scheme)
        .filter(({ fill, ink }) => contrast(ink, fill) < AA)
        .map(
          ({ sel, fill, ink }) =>
            `${sel} { ${ink} on ${fill} } is ${contrast(ink, fill).toFixed(2)}:1`
        );
      expect(failing).toEqual([]);
    }
  );

  // The structural half, and the reason the light scheme is reachable at all: **an inline
  // style beats every stylesheet**, so a team colour written straight into `color` or
  // `background` could never be re-derived for a light page — which is exactly how all of
  // this stood before. Every such site hands the raw `PALETTE` value over as `--team` and
  // lets `.team-ink`/`.team-fill` (or the element's own rule) derive from it.
  // `Display.jsx` is exempt: `main.jsx` pins the board to the dark scheme, so its inline
  // colours are the only ones that can never be asked to adapt.
  it('no component paints a colour inline', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.jsx') && f !== 'Display.jsx');
    expect(files.length).toBeGreaterThan(0);
    const inline = files.flatMap((file) =>
      styleKeys(readFileSync(new URL(file, dir), 'utf8')).map(
        (key) => `${file}: style={{ ${key} }}`
      )
    );
    expect(inline).toEqual([]);
  });
});
