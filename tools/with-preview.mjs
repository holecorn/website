// Runs the hermetic browser checks against a production preview build, starting
// and stopping the server itself so CI needs no orchestration.
//
//   npm run test:browser
//
// Only checks that need nothing but the app belong here. verify-winner-flash is
// deliberately excluded: it drives the display through a real MQTT broker, and a
// deploy should not fail because someone else's server is down.

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 4173;
// Longest first, which is the whole scheduling rule: the wall clock is the longest single
// check, so anything started after it is free and anything started before it is delay.
// Measured on a Mac — tournament 52s, positions 23s, stats 14s, and the remaining seven
// 34s between them.
const CHECKS = [
  'verify-tournament.mjs',
  'verify-positions.mjs',
  'verify-stats.mjs',
  'verify-wakelock.mjs',
  'verify-panel.mjs',
  'verify-lanes.mjs',
  'verify-tabs.mjs',
  'verify-recovery.mjs',
  'verify-copy-link.mjs',
  'verify-a11y.mjs',
  'verify-schemes.mjs',
  // Last because it is the cheapest at ~1s: it freezes the celebration's animations and
  // steps their clock rather than waiting on them.
  'verify-celebration.mjs',
];
// Three, not more. The other ten checks are 72s of work between them, so two workers
// clear them in ~36s while the tournament is still running — the wall clock is floored at
// that 52s whatever this is set to, and every extra browser only adds CPU contention to
// checks that measure rate limits, brightness and text metrics. Measured on a Mac:
// serial 123s, at 3 52s, at 6 **54s** — past the floor it gets slower, not faster.
const CONCURRENCY = Number(process.env.CHECK_CONCURRENCY || 3);

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT)], {
  cwd: join(here, '..'),
  stdio: 'ignore',
});

const stop = () => {
  if (!preview.killed) preview.kill('SIGTERM');
};
process.on('exit', stop);
process.on('SIGINT', () => {
  stop();
  process.exit(130);
});

async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${PORT}/`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`preview server did not start on :${PORT} within ${timeoutMs}ms`);
}

// Output is buffered and printed whole when a check finishes, rather than inherited.
// Interleaving three checks' lines live would make a failure unreadable, and these files
// report a failure as one line among hundreds of `ok`s.
const run = (script) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [join(here, script)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('exit', (code) => {
      process.stdout.write(`\n--- ${script}\n${out}`);
      resolve(code ?? 1);
    });
  });

try {
  await waitForServer();
  let failed = 0;
  const queue = [...CHECKS];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) {
        if ((await run(queue.shift())) !== 0) failed++;
      }
    }),
  );
  stop();
  if (failed) {
    console.error(`\n${failed} browser check(s) failed`);
    process.exit(1);
  }
  console.log('\nbrowser checks passed');
  process.exit(0);
} catch (err) {
  stop();
  console.error(err.message);
  process.exit(1);
}
