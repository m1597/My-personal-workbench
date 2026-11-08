import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <main className="bootstrap"><span>个人工作台</span><p>工作区已就绪</p></main>
  </React.StrictMode>
)
