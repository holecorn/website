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
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const CXX = process.env.CXX ?? 'c++';
const ARDUINOJSON = 'v7.4.3';
const JSON_HEADER = resolve(root, 'firmware/hub75/ArduinoJson.h');

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
// src/panel.js quantise the same polygon differently.
const GENERATED = ['firmware/hub75/glyphs.h', 'src/panelGlyphs.js'];

step('the generated glyph tables match src/segments.js', () => {
  const read = () => GENERATED.map((f) => readFileSync(resolve(root, f), 'utf8'));
  const before = read();
  run('node', ['firmware/hub75/generate_glyphs.mjs'], root);
  const stale = GENERATED.filter((_, i) => before[i] !== read()[i]);
  if (stale.length > 0) {
    throw new Error(
      `${stale.join(' and ')} stale — regenerated, commit the result.\n` +
        '   The source is src/segments.js and tools/panel-preview/font5x7.mjs.',
    );
  }
  process.stdout.write(`   ${GENERATED.join(', ')} up to date\n`);
});

const SUITES = [
  { dir: 'firmware/hub75', src: 'test_board_logic.cpp', inc: ['-I.'] },
  // Writes PPMs into out/, so it needs the directory to exist.
  { dir: 'firmware/hub75', src: 'test_render.cpp', inc: ['-I.'], out: true },
];

const ran = {};
for (const suite of SUITES) {
  ran[suite.src] = step(`${suite.dir}/${suite.src}`, () => {
    const cwd = resolve(root, suite.dir);
    if (suite.out) mkdirSync(resolve(cwd, 'out'), { recursive: true });
    // Binary goes to the system temp dir, so running the suite never leaves
    // an untracked build artefact in the repo.
    const bin = resolve(tmpdir(), `holecorn-${suite.src.replace(/\W/g, '-')}`);
    run(CXX, ['-std=c++17', '-Wall', '-Wextra', '-Werror', ...suite.inc, '-o', bin, suite.src], cwd);
    run(bin, [], cwd);
  });
}

// src/panel.js draws the panel in the browser, which makes it a second copy of
// render.h — the shape of thing that quietly drifts until it is lying. So it is
// held to the framebuffer the firmware just produced, byte for byte, over every
// scene test_render.cpp dumped. Reading the two files side by side is not a
// substitute: the divergences that matter are single pixels from a truncating
// division, and they are invisible to review.
const panel = await import('../src/panel.js');

const rgbAt = (buf, i) => `${buf[i * 3]},${buf[i * 3 + 1]},${buf[i * 3 + 2]}`;

function firstDifference(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) if (a[i] !== b[i]) return i;
  return -1;
}

if (!ran['test_render.cpp']) {
  process.stdout.write('\n── src/panel.js matches render.h\n   SKIPPED: the render suite did not run\n');
} else {
  step('src/panel.js matches render.h', () => {
    const dir = resolve(root, 'firmware/hub75/out');
    const scenes = JSON.parse(readFileSync(resolve(dir, 'scenes.json'), 'utf8'));
    const header = `P6\n${panel.PANEL_W} ${panel.PANEL_H}\n255\n`;
    const problems = [];

    // Otherwise an empty manifest reports "0 scenes identical" and passes, which
    // is the one failure mode of a comparison that compares nothing.
    if (scenes.length < 10) {
      throw new Error(`only ${scenes.length} scenes in out/scenes.json — expected every shot()`);
    }

    for (const scene of scenes) {
      const buf = readFileSync(resolve(dir, `${scene.name}.ppm`));
      if (buf.subarray(0, header.length).toString('ascii') !== header) {
        throw new Error(`${scene.name}.ppm is not a ${panel.PANEL_W}x${panel.PANEL_H} P6`);
      }
      const expected = buf.subarray(header.length);
      const fb = panel.createFramebuffer();
      panel.renderBoard(fb, panel.boardState(scene), scene.haveState, scene.live, scene.blinkOn);

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

    if (problems.length > 0) {
      throw new Error(
        `src/panel.js has drifted from firmware/hub75/render.h:\n     ${problems.join('\n     ')}`,
      );
    }
    process.stdout.write(`   ${scenes.length} scenes identical, pixel for pixel\n`);
  });
}

process.stdout.write(failed ? '\nfirmware checks FAILED\n' : '\nfirmware checks passed\n');
process.exit(failed ? 1 : 0);
