import { defineConfig } from 'vitest/config'

// Kept separate from vite.config.js so the app plugins (React, PWA) aren't
// loaded for the pure-logic tests.
export default defineConfig({
  test: {
    environment: 'node',
    // `tools/` too, for the one thing in there with a rule behind it rather than a
    // rendering: import-legacy.mjs reconstructs a past tournament's draw from its
    // results, and a draw that comes out wrong shows up as a bracket with ties still
    // to play rather than as an error.
    include: ['src/**/*.test.js', 'tools/**/*.test.js'],
  },
})
