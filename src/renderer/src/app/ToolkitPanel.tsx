import { useEffect, useRef } from 'react'
import { mountToolkit } from '../../../../components/toolkit/dock-home.js'
import base from '../../../../components/toolkit/style.css?inline'
import tools from '../../../../components/toolkit/home.css?inline'
import './toolkitPanel.css'

export function ToolkitPanel() {
  const container = useRef<HTMLElement>(null)
  useEffect(() => {
    const host = container.current,
      bridge = window.fitbayToolkit
    if (!host || !bridge) return
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = base + tools
    const root = document.createElement('main')
    root.id = 'app'
    shadow.replaceChildren(style, root)
    const dispose = mountToolkit(root, bridge)
    return () => {
      dispose()
      shadow.replaceChildren()
    }
  }, [])
  return <section ref={container} className="toolkit-panel" aria-label="工具集" />
}
