import { useEffect, useRef, useState } from 'react'
import type { DockviewApi, IDockviewPanelProps } from 'dockview-react'
import { GripHorizontal } from 'lucide-react'
import { Button } from '@fluentui/react-components'

type HostState = {
  mode: string
  phase: string
  error: string
  sessionId: string
  dragOver?: boolean
}
declare global {
  interface Window {
    componentHost?: {
      dropZone(value: { x: number; y: number; width: number; height: number } | null): void
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
    let frame = 0
    let previous = ''
    const measure = () => {
      const rect = document.querySelector('.docking-area')?.getBoundingClientRect()
      const blocked = document.querySelector('[role="dialog"], [role="menu"]')
      const zone =
        rect && !blocked ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null
      const encoded = JSON.stringify(zone)
      if (previous !== encoded) {
        previous = encoded
        host.dropZone(zone)
      }
      frame = requestAnimationFrame(measure)
    }
    frame = requestAnimationFrame(measure)
    return () => {
      off()
      cancelAnimationFrame(frame)
      host.dropZone(null)
    }
  }, [api])
}

export function ComponentPrototypeButton() {
  const [message, setMessage] = useState('')
  const [over, setOver] = useState(false)
  useEffect(() => window.componentHost?.subscribe((value) => setOver(!!value.dragOver)), [])
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
      {over ? '松开窗口标题栏以停靠' : message || '示例组件'}
    </Button>
  )
}

export function ComponentSlot({ api }: IDockviewPanelProps) {
  const element = useRef<HTMLDivElement>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)
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
          ? { x: rect.x, y: rect.y + 36, width: rect.width, height: Math.max(0, rect.height - 36) }
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
      style={{
        width: '100%',
        height: '100%',
        padding: '48px 16px 16px',
        boxSizing: 'border-box',
        position: 'relative',
      }}
    >
      <Button
        appearance="subtle"
        icon={<GripHorizontal size={14} />}
        title="拖出工作区后松开以分离；Esc 取消，键盘 Enter 分离"
        aria-label="组件拖出手柄"
        style={{
          height: 36,
          boxSizing: 'border-box',
          border: 0,
          background: 'var(--control)',
          color: 'var(--text)',
          font: 'inherit',
          textAlign: 'left',
          justifyContent: 'flex-start',
          borderRadius: 0,
          fontSize: 'var(--font-size-caption)',
          cursor: 'grab',
          touchAction: 'none',
          userSelect: 'none',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          padding: 8,
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || state?.mode !== 'docked') return
          dragStart.current = { x: event.clientX, y: event.clientY }
          event.currentTarget.focus()
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerUp={(event) => {
          const start = dragStart.current
          dragStart.current = null
          const zone = document.querySelector('.docking-area')?.getBoundingClientRect()
          if (
            start &&
            zone &&
            Math.hypot(event.clientX - start.x, event.clientY - start.y) > 12 &&
            (event.clientX < zone.left ||
              event.clientX >= zone.right ||
              event.clientY < zone.top ||
              event.clientY >= zone.bottom)
          )
            void window.componentHost?.detach()
        }}
        onPointerCancel={() => {
          dragStart.current = null
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') dragStart.current = null
        }}
        onClick={(event) => {
          if (event.detail === 0) void window.componentHost?.detach()
        }}
      >
        拖出以分离
      </Button>
      {!(state?.mode === 'docked' && state.phase === 'ready') && (
        <>
          <p>
            {state?.error ||
              (state?.mode === 'standalone' ? '组件在独立窗口中运行' : '正在连接示例组件')}
          </p>
          <Button onClick={() => void window.componentHost?.open()}>重新连接示例</Button>
        </>
      )}
    </div>
  )
}
