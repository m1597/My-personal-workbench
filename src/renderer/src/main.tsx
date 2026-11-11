import React from 'react'
import { createRoot } from 'react-dom/client'
import { BuiltinWindow } from './app/BuiltinWindow'
import { modules } from './app/moduleRegistry'
import App from './app/App'
import 'dockview-react/dist/styles/dockview.css'
import './styles/tokens.css'
import './styles/global.css'
import './styles/appearance.css'

if (new URLSearchParams(location.search).get('nativeBackdrop') === 'acrylic') {
  document.documentElement.dataset.backdrop = 'acrylic'
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing root element')
const builtin =
  window.builtinWindow &&
  modules.find((item) => item.id === new URLSearchParams(location.search).get('builtin'))
createRoot(root).render(
  <React.StrictMode>{builtin ? <BuiltinWindow id={builtin.id} /> : <App />}</React.StrictMode>,
)
