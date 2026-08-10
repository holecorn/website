import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const MANIFEST_LINK = /[ \t]*<link[^>]+rel="manifest"[^>]*>\r?\n?/g

// **`/board/` is `index.html` with the manifest link taken out, and that is its entire
// reason to exist.** Add to Home Screen reads a manifest and *replaces* the URL on screen
// with its `start_url`, so a scoreboard added from `/?display=1&…` installed an icon that
// opened the scorer with none of its configuration — and that query string is the only way
// the broker details reach it, since a home-screen web app gets its own storage. Measured
// on an iPad: a page with no manifest keeps the query, one with a manifest does not,
// whatever the manifest says and whenever JS removes the link. So it has to be gone from
// the HTML **as served**, and only for the boards — the scorer keeps its manifest, and with
// it Chrome's install prompt.
//
// A copy of the built page rather than a second source file, so the two cannot drift and
// nothing has to repeat the bundle's hashed asset names.
function boardPage() {
  let outDir = 'dist'
  let root = process.cwd()
  return {
    name: 'holecorn-board-page',
    configResolved(config) {
      outDir = config.build.outDir
      root = config.root
    },
    // The page has to be on disk before workbox globs the built directory, or it is the
    // one navigation with nothing cached behind it — and a board that falls through to
    // the cached `index.html` has the manifest back. Measured: vite-plugin-pwa generates
    // the service worker after every `closeBundle`, so either plugin order gets that, and
    // the service-worker assertion in `verify-panel.mjs` is what notices if it ever stops.
    async closeBundle() {
      const dist = resolve(root, outDir)
      const html = await readFile(join(dist, 'index.html'), 'utf8')
      const stripped = html.replace(MANIFEST_LINK, '')
      // Checked because it silently stops matching if the injected tag is ever spelled
      // differently — and a board page that quietly kept its manifest looks perfect and
      // installs the scorer, which is the fault this whole page exists to fix.
      if (stripped === html) throw new Error('boardPage: no manifest link found in index.html')
      await mkdir(join(dist, 'board'), { recursive: true })
      await writeFile(join(dist, 'board', 'index.html'), stripped)
    },
    // Dev has no dist to copy from, and vite-plugin-pwa injects no manifest there, so this
    // only has to make the path exist — otherwise a display link copied out of the dev
    // server is a 404 on the phone it was copied for.
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!/^\/board\/?(\?|$)/.test(req.url ?? '')) return next()
        const raw = await readFile(resolve(root, 'index.html'), 'utf8')
        const html = await server.transformIndexHtml(req.url, raw, req.originalUrl)
        res.setHeader('Content-Type', 'text/html')
        res.end(html.replace(MANIFEST_LINK, ''))
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    boardPage(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'icon.svg',
        'apple-touch-icon.png',
        'fonts/BebasNeue-Regular.ttf',
      ],
      // The scorer's, and only the scorer's — `boardPage()` above strips the link this
      // injects out of `/board/`. `start_url` stays `/`, which is what the scorer is
      // added from, so nothing here has a query string to lose.
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
        // **What keeps `/board/` from being answered with `index.html`.** Every URL this
        // app opens carries a query, so with workbox's default (utm_ and fbclid only) no
        // navigation ever matches the precache and they all fall through the
        // `NavigationRoute` to the cached `index.html` — which is fine for `/?display=1`
        // and is exactly the bug for `/board/?display=1&…`, since that page differs from
        // `index.html` only by the manifest link the board must not have. Silent, and
        // only from the second visit on, when the service worker has taken over.
        ignoreURLParametersMatching: [/.*/],
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
