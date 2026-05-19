import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import './styles/animations.css'
import './styles/overlays.css'
import './styles/topbar.css'
import './styles/content.css'
import './styles/sections.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
