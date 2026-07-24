import { defineConfig } from 'vitest/config'

// Kept separate from vite.config.js so the app plugins (React, PWA) aren't
// loaded for the pure-logic tests.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
})
