import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App'
import 'dockview-react/dist/styles/dockview.css'
import './styles/tokens.css'
import './styles/global.css'
import { applyAppearance, readAppearance } from './app/appearance'
import './styles/appearance.css'
import { applyTheme, readTheme } from './app/theme'

const initialThemeSaved = applyTheme(readTheme())
const initialAppearanceSaved = applyAppearance(readAppearance())

if (new URLSearchParams(location.search).get('nativeBackdrop') === 'acrylic') {
  document.documentElement.dataset.backdrop = 'acrylic'
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing root element')
createRoot(root).render(
  <React.StrictMode>
    <App initialThemeSaved={initialThemeSaved} initialAppearanceSaved={initialAppearanceSaved} />
  </React.StrictMode>,
)
