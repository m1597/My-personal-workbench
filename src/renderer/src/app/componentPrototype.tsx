import { useEffect, useRef, useState } from 'react'
import type { DockviewApi, IDockviewPanelProps } from 'dockview-react'
import { Button } from '@fluentui/react-components'

type HostState = { mode: string; phase: string; error: string; sessionId: string }
declare global {
  interface Window {
    componentHost?: {
      status(): Promise<HostState>
      open(): Promise<{ ok: boolean; error?: string }>
      bounds(value: { x: number; y: number; width: number; height: number } | null): void
      detach(): Promise<void>
      subscribe(callback: (state: HostState) => void): () => void
    }
  }
}
export function useComponentPrototype(api?: DockviewApi) {
  useEffect(() => {
    const host = window.componentHost
    if (!api || !host) return
    const update = (state: HostState) => {
      if (state.phase === 'attaching') {
        const existing = api.getPanel('component-example')
        if (existing) {
          existing.api.setActive()
          return
        }
        api.addPanel({
          id: 'component-example',
          title: '示例组件',
          component: 'component-slot',
          position: api.getPanel('module-2')
            ? { referencePanel: 'module-2', direction: 'within' }
            : undefined,
        })
      }
    }
    const off = host.subscribe(update)
    void host.status().then(update)
    return off
  }, [api])
}

export function ComponentPrototypeButton() {
  const [message, setMessage] = useState('')
  if (!window.componentHost) return null
  return (
    <Button
      appearance="subtle"
      title={message || '连接独立部署的示例组件'}
      onClick={async () => {
        const result = await window.componentHost?.open()
        setMessage(result?.error ?? '')
      }}
    >
      {message || '示例组件'}
    </Button>
  )
}

export function ComponentSlot({ api }: IDockviewPanelProps) {
  const element = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<HostState>()
  useEffect(() => {
    const host = window.componentHost
    if (!host) return
    let current: HostState | undefined
    const update = (value: HostState) => {
      current = value
      setState(value)
    }
    const off = host.subscribe(update)
    void host.status().then(update)
    let frame = 0
    let previous = ''
    const measure = () => {
      const rect = element.current?.getBoundingClientRect()
      const blocked = document.querySelector(
        '[role="dialog"], [role="menu"], .dv-drop-target-selection',
      )
      const bounds =
        rect &&
        api.isVisible &&
        !blocked &&
        (current?.mode === 'docked' || current?.phase === 'attaching')
          ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          : null
      const encoded = JSON.stringify(bounds)
      if (encoded !== previous) {
        previous = encoded
        host.bounds(bounds)
      }
      frame = requestAnimationFrame(measure)
    }
    frame = requestAnimationFrame(measure)
    return () => {
      cancelAnimationFrame(frame)
      off()
      host.bounds(null)
      if (current?.mode === 'docked' && current.phase === 'ready') void host.detach()
    }
  }, [api])
  return (
    <div
      ref={element}
      style={{ width: '100%', height: '100%', padding: 16, boxSizing: 'border-box' }}
    >
      <p>
        {state?.error ||
          (state?.mode === 'standalone' ? '组件在独立窗口中运行' : '正在连接示例组件')}
      </p>
      <Button onClick={() => void window.componentHost?.open()}>重新连接示例</Button>
    </div>
  )
}
