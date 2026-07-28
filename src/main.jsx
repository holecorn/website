import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import Display from './Display.jsx'
import Panel from './Panel.jsx'

// `panel` wins over `display` so a copied display link can be turned into the
// panel emulator by appending to it, rather than editing it.
const params = new URLSearchParams(window.location.search)
const view = params.has('panel') ? <Panel /> : params.has('display') ? <Display /> : <App />

createRoot(document.getElementById('root')).render(<StrictMode>{view}</StrictMode>)
