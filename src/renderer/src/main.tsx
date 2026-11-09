import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import 'dockview-react/dist/styles/dockview.css'
import './styles.css'
import { applyTheme, readTheme } from './theme'

applyTheme(readTheme())

if (new URLSearchParams(location.search).get('nativeBackdrop') === 'acrylic') {
  document.documentElement.dataset.backdrop = 'acrylic'
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
