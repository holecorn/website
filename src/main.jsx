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

// The app follows the phone's Appearance setting, because the phone is held in the sun.
// A board is not: it is propped against a fence, emissive, and drawn on its own near-black
// (`Display.css` sets it literally), so a tablet that happens to be set to Light must not
// take the light palette with it. `color-scheme` is what `light-dark()` resolves against,
// so pinning it here is the whole opt-out — no second set of values anywhere.
if (board) document.documentElement.style.colorScheme = 'dark'

createRoot(document.getElementById('root')).render(<StrictMode>{view}</StrictMode>)
