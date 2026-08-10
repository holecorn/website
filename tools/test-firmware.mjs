// Compiles and runs the firmware host tests, and checks that the generated
// header still matches its source.
//
//   npm run test:firmware
//
// These were manual for a while and drifted: test_board_logic.cpp's REAL
// fixture claimed to be "exactly what scoreboardPayload() produces" while
// missing a field, and glyphs.h shipped blank glyphs for two characters that
// FONT_CHARS advertised. Both are the kind of thing only a run catches.
//
// The generated-header check is the reason this is worth having in CI at all:
// glyphs.h comes from src/segments.js, so an app-side change to the digit
// geometry silently stops matching the panel until someone re-runs the
// generator.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const CXX = process.env.CXX ?? 'c++';
const ARDUINOJSON = 'v7.4.3';
const JSON_HEADER = resolve(root, 'firmware/hub75/host/ArduinoJson.h');

let failed = false;

function step(name, fn) {
  process.stdout.write(`\n── ${name}\n`);
  try {
    fn();
    return true;
  } catch (err) {
    failed = true;
    process.stdout.write(`   FAILED: ${err.message}\n`);
    return false;
  }
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${cmd} exited ${r.status ?? 'on a signal'}`);
}

// Gitignored, because it is a 260kB vendored header rather than a dependency.
step('ArduinoJson', () => {
  if (existsSync(JSON_HEADER)) {
    process.stdout.write(`   already present (${ARDUINOJSON} expected)\n`);
    return;
  }
  const url = `https://github.com/bblanchon/ArduinoJson/releases/download/${ARDUINOJSON}/ArduinoJson-${ARDUINOJSON}.h`;
  execFileSync('curl', ['-sfLo', JSON_HEADER, url]);
  process.stdout.write(`   downloaded ${ARDUINOJSON}\n`);
});

// Both outputs, because they come from one run of the generator: the firmware's
// header and the emulator's tables. Checking only one would let the panel and
// src/panelRender.js quantise the same polygon differently.
const GENERATED = ['firmware/hub75/glyphs.h', 'src/panelGlyphs.js'];

// **The tracked files go back exactly as they were, and that is the whole point
// of holding `before`.** The generator writes over them in place, so a check that
// only diffed left a stale tree *repairing itself*: measured, run 1 FAILED and
// runs 2 and 3 PASSED with both tracked files silently rewritten. CI never saw it
// — a fresh checkout runs this once — so the cost fell on whoever ran it locally,
// and it converts the standing "don't trust a single failed run, check it's
// consistent" habit into a green run plus two uncommitted rewrites. Restoring is
// what makes the failure repeat until somebody fixes it.
step('the generated glyph tables match src/segments.js', () => {
  const read = () => GENERATED.map((f) => readFileSync(resolve(root, f), 'utf8'));
  const before = read();
  run('node', ['firmware/hub75/generate_glyphs.mjs'], root);
  const after = read();
  const stale = GENERATED.filter((_, i) => before[i] !== after[i]);
  stale.forEach((f) => writeFileSync(resolve(root, f), before[GENERATED.indexOf(f)]));
  if (stale.length > 0) {
    throw new Error(
      `${stale.join(' and ')} stale — run: node firmware/hub75/generate_glyphs.mjs\n` +
        '   The source is src/segments.js and tools/panel-preview/font5x7.mjs.',
    );
  }
  process.stdout.write(`   ${GENERATED.join(', ')} up to date\n`);
});

// The logo masks cannot be checked the same way. Regenerating them needs a browser —
// the SVG is set in Bebas Neue and drawn through two filter primitives — and this job
// has none, so the generator records a hash of its sources and this compares that.
//
// What it catches is an edited logo or font with stale masks still committed. What it
// cannot catch is the rasteriser itself changing under a browser update, which would
// make a re-run produce different masks from the same sources. That is tolerable
// because the baked asset is what ships: the panel shows what was generated, not what
// Chrome would draw today.
step('the generated logo masks match public/logo.svg', () => {
  const sha = createHash('sha256')
    .update(readFileSync(resolve(root, 'public/logo.svg')))
    .update(readFileSync(resolve(root, 'public/fonts/BebasNeue-Regular.ttf')))
    .digest('hex');
  const header = readFileSync(resolve(root, 'firmware/hub75/logo.h'), 'utf8');
  const js = readFileSync(resolve(root, 'src/panelLogo.js'), 'utf8');
  const stale = [
    ['firmware/hub75/logo.h', header],
    ['src/panelLogo.js', js],
  ].filter(([, text]) => !text.includes(sha));
  if (stale.length > 0) {
    throw new Error(
      `${stale.map(([f]) => f).join(' and ')} were generated from a different logo.\n` +
        '   Run: npm install --no-save playwright && node firmware/hub75/generate_logo.mjs',
    );
  }
  process.stdout.write(`   logo.h and src/panelLogo.js built from ${sha.slice(0, 12)}\n`);
});

// Two values cross the language boundary with **only a comment** holding them together,
// which is the one shape of drift nothing else here can see: the glyphs are generated
// from one run, the masks carry a hash, and everything in render.h is pinned by the pixel
// check — but these two sit outside all three, in board_logic.h and in the sketch itself.
//
// Both comments had already gone stale, in the same way and without a symptom: they named
// the wrong file for the value they mirror (`REORDER_WINDOW` was cited in useScoreboard.js
// and lives in scoreboard.js; `PALETTE` in App.jsx and lives in scoring.js). A comment
// naming a file is the part that rots — so this checks the *value*, and the file reference
// becomes decoration that cannot mislead about anything load-bearing.
//
// Adding a mirrored constant means adding it here. There is no third place to look.
const MIRRORED = [
  {
    what: 'the reorder window',
    // A retained score stamped by a fast clock locks every display out until real time
    // catches up, so both ends have to forgive the same span or one recovers and the
    // other does not.
    js: ['src/scoreboard.js', /export const REORDER_WINDOW = ([\d_]+)/, (m) => m[1].replace(/_/g, '')],
    cpp: ['firmware/hub75/board_logic.h', /REORDER_WINDOW_MS = (\d+)/, (m) => m[1]],
  },
  {
    what: 'the team colours',
    // The splash paints two of the app's four. Nothing else compares them: SPLASH_PALETTE
    // is in the .ino rather than render.h, so the pixel check never reaches it, and a
    // team colour changed on the phone would leave the board booting into the old one.
    js: [
      'src/scoring.js',
      /export const PALETTE = \[([\s\S]*?)\]/,
      (m) => [...m[1].matchAll(/'#([0-9a-f]{6})'/g)].map((x) => x[1]).join(','),
    ],
    cpp: [
      'firmware/hub75/hub75.ino',
      /const Rgb SPLASH_PALETTE\[\] = \{([\s\S]*?)\};/,
      (m) =>
        [...m[1].matchAll(/\{0x([0-9a-f]{2}), 0x([0-9a-f]{2}), 0x([0-9a-f]{2})\}/g)]
          .map((x) => x[1] + x[2] + x[3])
          .join(','),
    ],
  },
];

step('the constants mirrored across the language boundary agree', () => {
  const read = ([file, pattern, take]) => {
    const found = pattern.exec(readFileSync(resolve(root, file), 'utf8'));
    if (!found) throw new Error(`${file} no longer matches ${pattern} — the mirror moved`);
    return take(found);
  };
  for (const { what, js, cpp } of MIRRORED) {
    const [a, b] = [read(js), read(cpp)];
    if (a !== b) {
      throw new Error(`${what}: ${js[0]} has ${a}, ${cpp[0]} has ${b}`);
    }
    process.stdout.write(`   ${what}: ${a}\n`);
  }
});

// The suites sit in host/ rather than beside the sketch because Arduino compiles
// every source file in a sketch folder: two main()s collide at link, and the
// vendored ArduinoJson.h shadows the real 7.4.3 library. Arduino ignores
// subdirectories other than src/, so one level down is the whole fix. They still
// build with firmware/hub75 as the working directory, which is what keeps out/ and
// the -I. onto render.h/board_logic.h where they were.
const SUITES = [
  { dir: 'firmware/hub75', src: 'host/test_board_logic.cpp', inc: ['-I.', '-Ihost'] },
  // Writes PPMs into out/, so it needs the directory to exist.
  { dir: 'firmware/hub75', src: 'host/test_render.cpp', inc: ['-I.', '-Ihost'], out: true },
];

const ran = {};
for (const suite of SUITES) {
  // Keyed on the bare filename, not the path: the lookup below decides whether the
  // pixel check runs or *skips*, so a moved suite would otherwise silently stop
  // comparing framebuffers and still report a pass.
  ran[basename(suite.src)] = step(`${suite.dir}/${suite.src}`, () => {
    const cwd = resolve(root, suite.dir);
    if (suite.out) mkdirSync(resolve(cwd, 'out'), { recursive: true });
    // Binary goes to the system temp dir, so running the suite never leaves
    // an untracked build artefact in the repo.
    const bin = resolve(tmpdir(), `holecorn-${suite.src.replace(/\W/g, '-')}`);
    run(CXX, ['-std=c++17', '-Wall', '-Wextra', '-Werror', ...suite.inc, '-o', bin, suite.src], cwd);
    run(bin, [], cwd);
  });
}

// src/panelRender.js draws the panel in the browser, which makes it a second copy of
// render.h — the shape of thing that quietly drifts until it is lying. So it is
// held to the framebuffer the firmware just produced, byte for byte, over every
// scene test_render.cpp dumped. Reading the two files side by side is not a
// substitute: the divergences that matter are single pixels from a truncating
// division, and they are invisible to review.
const panel = await import('../src/panelRender.js');
// The letter rectangles come from the generated asset, not from the renderer: the curve
// below has to ask about the same letters render.h dumped.
const logo = await import('../src/panelLogo.js');

const rgbAt = (buf, i) => `${buf[i * 3]},${buf[i * 3 + 1]},${buf[i * 3 + 2]}`;

function firstDifference(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) if (a[i] !== b[i]) return i;
  return -1;
}

if (!ran['test_render.cpp']) {
  process.stdout.write('\n── src/panelRender.js matches render.h\n   SKIPPED: the render suite did not run\n');
} else {
  step('src/panelRender.js matches render.h', () => {
    const dir = resolve(root, 'firmware/hub75/out');
    const scenes = JSON.parse(readFileSync(resolve(dir, 'scenes.json'), 'utf8'));
    const header = `P6\n${panel.PANEL_W} ${panel.PANEL_H}\n255\n`;
    const problems = [];

    // Otherwise an empty manifest reports "0 scenes identical" and passes, which
    // is the one failure mode of a comparison that compares nothing.
    if (scenes.length < 10) {
      throw new Error(`only ${scenes.length} scenes in out/scenes.json — expected every shot()`);
    }
    // A layout with no scenes is unpinned, and adding one is exactly when nobody
    // remembers to dump it. This is what makes that a failure rather than a
    // silently narrower check.
    const covered = new Set(scenes.map((s) => s.layout));
    const missing = panel.PANEL_LAYOUTS.filter((id) => !covered.has(id));
    if (missing.length > 0) {
      throw new Error(`no scenes for layout ${missing.join(', ')} — add a shot() for it`);
    }
    // The pre-game form screen has no layout id — a retained lineup selects it —
    // so the check above cannot see it, and without this it would be a whole
    // screen of unpinned second implementation.
    if (!scenes.some((s) => s.lineup)) {
      throw new Error('no scenes carry a lineup — the form screen is unpinned');
    }
    // And the fixture card, which has no layout id either — a retained tie selects it.
    if (!scenes.some((s) => s.tie)) {
      throw new Error('no scenes carry a tie — the fixture card is unpinned');
    }
    // Same again for the splash, which has no layout id either — a boot selects it.
    if (!scenes.some((s) => s.splash !== null)) {
      throw new Error('no scenes carry a splash — the splash screen is unpinned');
    }
    // And the draw card, selected by a retained card on the draw topic. A fourth screen
    // outside PANEL_LAYOUTS, so a fourth assertion of its own.
    if (!scenes.some((s) => s.draw)) {
      throw new Error('no scenes carry a draw card — the draw screen is unpinned');
    }

    for (const scene of scenes) {
      const buf = readFileSync(resolve(dir, `${scene.name}.ppm`));
      if (buf.subarray(0, header.length).toString('ascii') !== header) {
        throw new Error(`${scene.name}.ppm is not a ${panel.PANEL_W}x${panel.PANEL_H} P6`);
      }
      const expected = buf.subarray(header.length);
      const fb = panel.createFramebuffer();
      const state = panel.boardState(scene);
      if (scene.splash !== null) {
        // The splash carries its colour pair in the state's two colours, so it needs no
        // fields of its own beyond the indicator, the clock and the throwing order.
        panel.drawSplash(
          fb,
          state.colorA,
          state.colorB,
          scene.splash.connect,
          scene.splash.elapsed,
          scene.splash.order,
        );
      } else {
        panel.renderBoard(
          fb,
          state,
          scene.haveState,
          scene.live,
          scene.blinkOn,
          scene.layout,
          // Through lineupState() rather than handed over raw, so the JS coercions
          // are compared against parseLineup's and not bypassed.
          scene.lineup ? panel.lineupState(scene.lineup) : null,
          // Same for the tie, through tieState().
          scene.tie ? panel.tieState(scene.tie) : null,
          // And the draw card, through drawState().
          scene.draw ? panel.drawState(scene.draw) : null,
          // The board's link state, which only the no-state screen reads.
          scene.connect,
        );
      }

      if (fb.outOfBounds > 0) {
        problems.push(`${scene.name}: drew ${fb.outOfBounds} px outside the panel`);
      }
      // Reported separately from a pixel difference: a short PPM is a file-shape
      // problem, and naming a coordinate would send you hunting in the renderer.
      if (expected.length !== fb.data.length) {
        problems.push(
          `${scene.name}: PPM holds ${expected.length} bytes, framebuffer ${fb.data.length}`,
        );
        continue;
      }
      const at = firstDifference(expected, fb.data);
      if (at >= 0) {
        const i = Math.trunc(at / 3);
        problems.push(
          `${scene.name}: pixel (${i % panel.PANEL_W},${Math.trunc(i / panel.PANEL_W)}) ` +
            `is rgb(${rgbAt(fb.data, i)}) in JS, rgb(${rgbAt(expected, i)}) in render.h`,
        );
      }
    }

    // Every bag's flight and both boards' knocks, millisecond by millisecond, for the
    // reason writeSplashCurve in test_render.cpp gives: the scenes above cannot pin them.
    // Dumped for the identity order, so a throw's slot and its letter are the same index.
    const curve = JSON.parse(readFileSync(resolve(dir, 'splash-curve.json'), 'utf8'));
    if (curve.throws.length !== panel.SPLASH_THROWS || curve.span < 2) {
      throw new Error(
        `out/splash-curve.json holds ${curve.throws.length} throws over ${curve.span}ms, ` +
          `not ${panel.SPLASH_THROWS}`,
      );
    }
    let offsets = 0;
    curve.throws.forEach((flight, n) => {
      const board = Math.trunc(n / logo.LOGO_LETTERS);
      const slot = n % logo.LOGO_LETTERS;
      const rect = (board === 0 ? logo.LOGO_HOLE_LETTERS : logo.LOGO_CORN_LETTERS)[slot];
      flight.forEach(([dx, dy], t) => {
        offsets += 1;
        const o = panel.splashThrow(rect, board === 0 ? -1 : 1, board, slot, t);
        if (o.dx !== dx || o.dy !== dy) {
          problems.push(
            `board ${board} slot ${slot} at ${t}ms is ${o.dx},${o.dy} in JS, ${dx},${dy} in render.h`,
          );
        }
      });
    });
    curve.thump.forEach((knocks, board) => {
      knocks.forEach((thump, t) => {
        if (panel.splashThump(board, t) !== thump) {
          problems.push(
            `board ${board}'s knock at ${t}ms is ${panel.splashThump(board, t)} in JS, ${thump} in render.h`,
          );
        }
      });
    });

    if (problems.length > 0) {
      throw new Error(
        `src/panelRender.js has drifted from firmware/hub75/render.h:\n     ${problems.slice(0, 8).join('\n     ')}`,
      );
    }
    process.stdout.write(
      `   ${scenes.length} scenes identical, pixel for pixel; ${offsets} splash offsets agree\n`,
    );
  });
}

process.stdout.write(failed ? '\nfirmware checks FAILED\n' : '\nfirmware checks passed\n');
process.exit(failed ? 1 : 0);
