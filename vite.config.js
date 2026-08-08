import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'icon.svg',
        'apple-touch-icon.png',
        'fonts/BebasNeue-Regular.ttf',
      ],
      manifest: {
        name: 'Holecorn',
        short_name: 'Holecorn',
        description: 'Cornhole scorer',
        theme_color: '#0f1419',
        background_color: '#0f1419',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // The MQTT client is precached along with everything else, at ~104kB
        // gzipped per install. It used to be excluded as useless without a
        // network; a self-hosted broker on a signal-less field inverts that —
        // see docs/OFFLINE-SCOREBOARD.md.
        globPatterns: ['**/*.{js,css,html,svg,png,ttf,woff2}'],
      },
    }),
  ],
  build: {
    // **Lightning CSS rewrites `light-dark()` unless it is told not to, and the rewrite is
    // silently one-way.** Left at the default target it compiles every `light-dark(a, b)`
    // into a `--lightningcss-light`/`--lightningcss-dark` pair switched by a
    // `prefers-color-scheme` media query — which still follows the phone, so the app looks
    // exactly right, and which no longer answers to `color-scheme` at all. That is the one
    // thing `main.jsx` needs it to answer to: pinning the board views to the dark scheme
    // stopped working with nothing failing, because a media query does not care what
    // `color-scheme` an element is set to. `tools/verify-schemes.mjs` is what caught it.
    //
    // These are the browsers that support `light-dark()`, and they are not a new floor —
    // `index.css` already derives a team's ink with relative colour syntax
    // (`oklch(from …)`), which Lightning CSS cannot downlevel and simply passes through, so
    // an older browser was already going to lose the team colours entirely. Naming the
    // target makes the floor explicit rather than accidental.
    cssTarget: ['chrome123', 'edge123', 'firefox120', 'safari17.5'],
  },
  server: {
    host: true,
  },
  preview: {
    host: true,
  },
})
