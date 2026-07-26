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
const JSON_HEADER = resolve(root, 'firmware/wokwi/ArduinoJson.h');

let failed = false;

function step(name, fn) {
  process.stdout.write(`\n── ${name}\n`);
  try {
    fn();
  } catch (err) {
    failed = true;
    process.stdout.write(`   FAILED: ${err.message}\n`);
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

step('glyphs.h matches src/segments.js', () => {
  const before = readFileSync(resolve(root, 'firmware/hub75/glyphs.h'), 'utf8');
  run('node', ['firmware/hub75/generate_glyphs.mjs'], root);
  const after = readFileSync(resolve(root, 'firmware/hub75/glyphs.h'), 'utf8');
  if (before !== after) {
    throw new Error(
      'glyphs.h is stale — it has been regenerated, commit the result.\n' +
        '   Its source is src/segments.js and tools/panel-preview/font5x7.mjs.',
    );
  }
  process.stdout.write('   up to date\n');
});

const SUITES = [
  { dir: 'firmware/wokwi', src: 'test_board_logic.cpp', inc: ['-I.'] },
  // Writes PPMs into out/, so it needs the directory to exist.
  { dir: 'firmware/hub75', src: 'test_render.cpp', inc: ['-I.', '-I../wokwi'], out: true },
];

for (const suite of SUITES) {
  step(`${suite.dir}/${suite.src}`, () => {
    const cwd = resolve(root, suite.dir);
    if (suite.out) mkdirSync(resolve(cwd, 'out'), { recursive: true });
    // Binary goes to the system temp dir, so running the suite never leaves
    // an untracked build artefact in the repo.
    const bin = resolve(tmpdir(), `holecorn-${suite.src.replace(/\W/g, '-')}`);
    run(CXX, ['-std=c++17', '-Wall', '-Wextra', '-Werror', ...suite.inc, '-o', bin, suite.src], cwd);
    run(bin, [], cwd);
  });
}

process.stdout.write(failed ? '\nfirmware checks FAILED\n' : '\nfirmware checks passed\n');
process.exit(failed ? 1 : 0);
