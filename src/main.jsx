import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import Display from './Display.jsx'
import Panel from './Panel.jsx'

// `panel` wins over `display` so a copied display link can be turned into the
// panel emulator by appending to it, rather than editing it.
const params = new URLSearchParams(window.location.search)
const board = params.has('panel') || params.has('display')
const view = params.has('panel') ? <Panel /> : params.has('display') ? <Display /> : <App />

// Add to Home Screen takes the manifest's `start_url`, not the URL on screen, so a board
// bookmarked from `?display=1` installed an icon that opened the scorer. These two name no
// `start_url` at all — which falls back to the page that linked the manifest, query string
// and all. That is the whole fix, and the credentials have to travel with it: a home-screen
// web app gets its own storage, so the settings this tab saved are not there on first open.
if (board) {
  // vite-plugin-pwa injects the link into the built index.html and not into the dev
  // server's, so this has to be able to make one.
  let link = document.querySelector('link[rel="manifest"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'manifest'
    document.head.appendChild(link)
  }
  link.href = params.has('panel') ? '/panel.webmanifest' : '/display.webmanifest'
}

// The app follows the phone's Appearance setting, because the phone is held in the sun.
// A board is not: it is propped against a fence, emissive, and drawn on its own near-black
// (`Display.css` sets it literally), so a tablet that happens to be set to Light must not
// take the light palette with it. `color-scheme` is what `light-dark()` resolves against,
// so pinning it here is the whole opt-out — no second set of values anywhere.
if (board) document.documentElement.style.colorScheme = 'dark'

createRoot(document.getElementById('root')).render(<StrictMode>{view}</StrictMode>)
