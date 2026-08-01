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
const CHECKS = [
  'verify-wakelock.mjs',
  'verify-copy-link.mjs',
  'verify-stats.mjs',
  'verify-positions.mjs',
  'verify-tournament.mjs',
  'verify-lanes.mjs',
  'verify-panel.mjs',
];

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

const run = (script) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [join(here, script)], { stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 1));
  });

try {
  await waitForServer();
  let failed = 0;
  for (const script of CHECKS) {
    console.log(`\n--- ${script}`);
    if ((await run(script)) !== 0) failed++;
  }
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
