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

const root = document.getElementById('root')
if (!root) throw new Error('Missing root element')
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
