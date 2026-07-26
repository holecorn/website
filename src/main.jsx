import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import Display from './Display.jsx'

const isDisplay = new URLSearchParams(window.location.search).has('display')

createRoot(document.getElementById('root')).render(
  <StrictMode>{isDisplay ? <Display /> : <App />}</StrictMode>,
)
