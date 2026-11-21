import { openInDefaultGrid } from './defaultGrid'
import type { Material } from './material'
import { readPreferences, useTranslation } from './preferences'
import { useEffect, useRef, useState } from 'react'
import type { DockviewApi, IDockviewPanelProps } from 'dockview-react'
import { Button } from '@fluentui/react-components'

import { bindBuiltinDock } from './builtinDock'
import { type ModuleId, navigationQuery } from './builtinSession'
import { modules } from './moduleRegistry'
import { applyLayout, switchingLayout, trackLayout } from './layoutStorage'

export type ComponentInventory = {
  installed: boolean
  version?: string
  settingsEntries?: { target: string; name: string; path: string }[]
}
type Region = { id: string; x: number; y: number; width: number; height: number }
type Target = Region & { direction: 'within' | 'left' | 'right' | 'above' | 'below' }
type HostState = {
  keepRunning?: boolean
  mode: string
  presentation?: 'full' | 'bar' | 'background'
  phase: string
  error: string
  sessionId: string
  transfer: number
  dragOver?: Target | null
  placement?: Target | null
}
// Only the slot created or accepted by the layout transaction can acknowledge a drop.
const attachingGroups = new WeakMap<IDockviewPanelProps['api'], string>()
declare global {
  interface Window {
    promptDock?: Window['componentHost']
    musicDock?: NonNullable<Window['componentHost']> & {
      toggleVisibility(): Promise<void>
    }
    componentHost?: {
      keepRunning(value: boolean): Promise<boolean>
      layout(included: boolean): Promise<void>
      toggleVisibility(): Promise<void>
      show(settings: boolean, target?: string): Promise<{ ok: boolean; error?: string }>
      inventory(): Promise<ComponentInventory>
      sampleEnabled?: boolean
      dropZone(value: Region[] | null): void
      setLanguage?(value: 'zh-CN' | 'en'): void
      setMaterial?(value: Material): void
      status(): Promise<HostState>
      stop(): Promise<void>
      close?(): Promise<void>
      restore(): Promise<void>
      open(): Promise<{ ok: boolean; error?: string }>
      confirmedTransfer(id: number): boolean
      bounds(
        value: { x: number; y: number; width: number; height: number } | null,
        id?: number | 'bar',
      ): void
      detach(release?: { x: number; y: number }): Promise<void>
      onActivate(callback: () => void): () => void
      subscribe(callback: (state: HostState) => void): () => void
    }
  }
}
export function useComponentPrototype(
  api: DockviewApi | undefined,
  gap: number,
  onDetached: (ids: ModuleId[]) => void,
) {
  useEffect(() => {
    const host = window.componentHost
    if (!api) return
    const layout = trackLayout(api)
    if (!host) return layout.dispose
    const builtins = bindBuiltinDock(api, layout, gap, onDetached)
    const bind = (host: NonNullable<Window['componentHost']>, panelId: string, title: string) => {
      let last: HostState | undefined
      let finishAttach: ((docked: boolean) => void) | undefined
      const finish = (docked: boolean) => {
        const complete = finishAttach
        if (!complete) return
        finishAttach = undefined
        complete(docked)
        layout.resume()
      }
      // The debounced save may never run again. Flush the authoritative result on unload.
      const beforeUnload = () => {
        if (!finishAttach || !last) return
        finish(host.confirmedTransfer(last.transfer))
        layout.flush()
      }
      window.addEventListener('beforeunload', beforeUnload, true)
      const update = (state: HostState) => {
        const wasDocked = last?.mode === 'docked'
        last = state
        if (state.phase !== 'attaching') finish(state.mode === 'docked')
        const existing = api.getPanel(panelId)
        if (
          existing &&
          ((wasDocked && state.mode === 'standalone') ||
            state.phase === 'unavailable' ||
            (state.presentation && state.presentation !== 'full'))
        ) {
          api.removePanel(existing)
          return
        }
        if (state.phase !== 'attaching' || finishAttach) return
        const hit = state.placement
        if (
          hit &&
          ((hit.id ? !api.getGroup(hit.id) : api.groups.length > 0) ||
            document.querySelector('[role="dialog"], [role="menu"]'))
        )
          return
        layout.pause()
        const before = api.toJSON()
        const source = existing?.group
        const index = existing ? existing.group.panels.indexOf(existing) : undefined
        const target = hit?.id
          ? api.getGroup(hit.id)
          : (source ?? api.getPanel('module-2')?.group ?? api.activeGroup)
        const relocate =
          existing && hit && target && (target !== source || hit.direction !== 'within')
        const originalActive = api.activePanel?.id
        const sourceActive = source?.activePanel?.id
        const targetActive = target?.activePanel?.id
        // Keep an emptied source group until the host confirms the transfer. Its
        // position and size then remain available even if it held only this tab.
        if (relocate) api.removePanel(existing, { removeEmptyGroup: false })
        const slot =
          existing && !relocate
            ? existing
            : !hit
              ? openInDefaultGrid(api, { id: panelId, title, component: 'component-slot' })
              : api.addPanel({
                  id: panelId,
                  title,
                  component: 'component-slot',
                  position: target
                    ? { referenceGroup: target.id, direction: hit?.direction ?? 'within' }
                    : undefined,
                })
        attachingGroups.set(slot.api, slot.group.id)
        slot.api.setActive()
        const provisional = JSON.stringify(api.toJSON())
        finishAttach = (docked) => {
          attachingGroups.delete(slot.api)
          // Removing a split redistributes sibling sizes in Dockview. Reuse the
          // exact pre-transfer layout unless the user edited it during the wait.
          if (!docked && JSON.stringify(api.toJSON()) === provisional) {
            applyLayout(api, before, gap)
            return
          }
          if (!docked && api.getPanel(slot.id) === slot) {
            const active = api.activePanel === slot ? originalActive : api.activePanel?.id
            const restoreTarget = target?.activePanel === slot
            if (!existing) api.removePanel(slot)
            else if (relocate && source && api.getGroup(source.id)) {
              slot.api.moveTo({ group: source, index, position: 'center' })
              if (sourceActive) api.getPanel(sourceActive)?.api.setActive()
            }
            if (restoreTarget && targetActive) api.getPanel(targetActive)?.api.setActive()
            if (active) api.getPanel(active)?.api.setActive()
          }
          if (relocate && source && api.getGroup(source.id) && !source.panels.length)
            api.removeGroup(source)
        }
      }
      const removed = api.onDidRemovePanel((panel) => {
        if (switchingLayout(api)) return
        if (
          panel.id === panelId &&
          last?.mode === 'docked' &&
          last.phase === 'ready' &&
          (!last.presentation || last.presentation === 'full')
        )
          void (host.close ? host.close() : host.detach())
      })
      const offActivate = host.onActivate(() => {
        if (last?.mode === 'docked') {
          const slot =
            api.getPanel(panelId) ??
            openInDefaultGrid(api, { id: panelId, title, component: 'component-slot' })
          slot.api.setActive()
        } else api.getPanel(panelId)?.api.setActive()
      })
      let disposed = false
      const off = host.subscribe(update)
      void host.status().then((state) => {
        if (disposed || last) return
        update(state)
        if (state.phase === 'stopped' && api.getPanel(panelId)) void host.restore()
      })
      return () => {
        disposed = true
        off()
        offActivate()
        removed.dispose()
        window.removeEventListener('beforeunload', beforeUnload, true)
      }
    }
    const offSample = host.sampleEnabled && bind(host, 'component-example', '示例组件')
    const offPrompts =
      window.promptDock &&
      bind(
        window.promptDock,
        'component-prompts',
        readPreferences().language === 'en' ? 'File library' : '文件库',
      )
    const offMusic = window.musicDock && bind(window.musicDock, 'component-music', 'Music')
    let dragging = ''
    let pointer: number | undefined
    const cancel = () => {
      pointer = undefined
      delete document.documentElement.dataset.componentDrag
    }
    const drag = api.onWillDragPanel(({ panel, nativeEvent }) => {
      cancel()
      if (
        !(nativeEvent instanceof PointerEvent) ||
        !(
          panel.id === 'component-prompts' ||
          panel.id === 'component-example' ||
          panel.id === 'component-music' ||
          (builtins && modules.some((item) => item.id === panel.id))
        )
      )
        return
      dragging = panel.id
      pointer = nativeEvent.pointerId
      document.documentElement.dataset.componentDrag = 'true'
      document.documentElement.setPointerCapture(pointer)
    })
    const release = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return
      cancel()
      if (
        event.clientX < 0 ||
        event.clientY < 0 ||
        event.clientX >= innerWidth ||
        event.clientY >= innerHeight
      ) {
        const point = { x: event.clientX, y: event.clientY }
        if (dragging === 'component-example') void host.detach(point)
        else if (dragging === 'component-prompts') void window.promptDock?.detach(point)
        else if (dragging === 'component-music') void window.musicDock?.detach(point)
        else {
          // Keep the captured navigation state stable until the new renderer has mounted.
          const input =
            dragging === 'module-1'
              ? document.querySelector<HTMLInputElement>('[data-testid="module-1"] input')
              : null
          if (input?.readOnly) return
          if (input) input.readOnly = true
          void window.builtinDock?.detach(dragging, point, navigationQuery()).finally(() => {
            if (input) input.readOnly = false
          })
        }
      }
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel()
    }
    window.addEventListener('pointerup', release, true)
    window.addEventListener('pointercancel', cancel, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', cancel)
    let frame = 0
    let previous = ''
    const measure = () => {
      builtins?.report()
      const rect = document.querySelector('.docking-area')?.getBoundingClientRect()
      const blocked = document.querySelector('[role="dialog"], [role="menu"]')
      const region = (id: string, box: DOMRect) => ({
        id,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      })
      const zone =
        !rect || blocked
          ? null
          : api.groups.length
            ? api.groups
                .filter(
                  (group) =>
                    group.element.getClientRects().length && group.element.checkVisibility(),
                )
                .map((group) => region(group.id, group.element.getBoundingClientRect()))
                .filter((r) => r.width && r.height)
            : [region('', rect)]
      const encoded = JSON.stringify(zone)
      if (previous !== encoded) {
        previous = encoded
        host.dropZone(zone)
      }
      frame = requestAnimationFrame(measure)
    }
    frame = requestAnimationFrame(measure)
    return () => {
      if (offSample) offSample()
      offPrompts?.()
      offMusic?.()
      builtins?.dispose()

      layout.dispose()
      drag.dispose()
      window.removeEventListener('pointerup', release, true)
      window.removeEventListener('pointercancel', cancel, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', cancel)
      cancel()

      cancelAnimationFrame(frame)
      host.dropZone(null)
    }
  }, [api, gap, onDetached])
}

export function useMusicHostState(host = window.musicDock as Window['componentHost']) {
  const [state, setState] = useState<HostState>()
  useEffect(() => {
    if (!host) return
    let received = false
    const unsubscribe = host.subscribe((next) => {
      received = true
      setState(next)
    })
    void host.status().then((next) => {
      if (!received) setState(next)
    })
    return () => {
      received = true
      unsubscribe()
    }
  }, [host])
  return state
}

export function useDockedMusicBar() {
  const state = useMusicHostState()
  return state?.phase === 'ready' && state.mode === 'docked' && state.presentation === 'bar'
}
export function MusicPlayerBar() {
  const t = useTranslation()
  const visible = useDockedMusicBar()
  const slot = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!visible) return
    let frame = 0
    let previous = ''
    const measure = () => {
      const rect = slot.current?.getBoundingClientRect()
      const covered =
        document.querySelector('[role="dialog"], [data-component-drag]') ||
        Array.from(document.querySelectorAll('[role="menu"], .component-drop-preview')).some(
          (popup) => {
            const bounds = popup.getBoundingClientRect()
            return rect && bounds.bottom > rect.top && bounds.top < rect.bottom
          },
        )
      const bounds =
        rect && !covered ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null
      const encoded = JSON.stringify(bounds)
      if (previous !== encoded) {
        previous = encoded
        window.musicDock?.bounds(bounds, 'bar')
      }
      frame = requestAnimationFrame(measure)
    }
    measure()
    return () => {
      cancelAnimationFrame(frame)
      window.musicDock?.bounds(null, 'bar')
    }
  }, [visible])
  return visible ? (
    <section
      aria-label={t('Music 播放栏', 'Music player bar')}
      ref={slot}
      style={{ flex: '0 0 40px', position: 'relative' }}
    ></section>
  ) : null
}

export function ComponentDropPreview() {
  const [sampleOver, setOver] = useState<Target | null>(null)
  const [musicOver, setMusicOver] = useState<Target | null>(null)
  const [promptOver, setPromptOver] = useState<Target | null>(null)
  useEffect(
    () => window.promptDock?.subscribe((value) => setPromptOver(value.dragOver ?? null)),
    [],
  )
  const over = promptOver ?? musicOver ?? sampleOver
  useEffect(() => window.componentHost?.subscribe((value) => setOver(value.dragOver ?? null)), [])
  useEffect(() => window.musicDock?.subscribe((value) => setMusicOver(value.dragOver ?? null)), [])
  return (
    over && (
      <div
        className="component-drop-preview"
        data-direction={over.direction}
        style={{ left: over.x, top: over.y, width: over.width, height: over.height }}
      />
    )
  )
}

export function ComponentSlot({ api }: IDockviewPanelProps) {
  const t = useTranslation()
  const element = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<HostState>()
  useEffect(() => {
    const host =
      api.id === 'component-prompts'
        ? window.promptDock
        : api.id === 'component-music'
          ? window.musicDock
          : window.componentHost
    if (!host) return
    let current: HostState | undefined
    let otherPreview: Target | null = null
    const peers = [window.componentHost, window.musicDock, window.promptDock].filter(
      (peer) => peer && peer !== host,
    )
    const previews = new Map<number, Target>()
    const offOthers = peers.map((peer, index) =>
      peer?.subscribe((value) => {
        if (value.dragOver) previews.set(index, value.dragOver)
        else previews.delete(index)
        otherPreview = previews.values().next().value ?? null
      }),
    )
    const update = (value: HostState) => {
      current = value
      setState(value)
    }
    const off = host.subscribe(update)
    void host.status().then((state) => {
      if (!current) update(state)
    })
    let frame = 0
    let previous = ''
    const measure = () => {
      const rect = element.current?.getBoundingClientRect()
      const preview = current?.dragOver ?? otherPreview
      // Native child views paint above DOM even when the preview has a higher z-index.
      const covered =
        rect &&
        preview &&
        rect.left < preview.x + preview.width &&
        rect.right > preview.x &&
        rect.top < preview.y + preview.height &&
        rect.bottom > preview.y
      const menu = document.querySelector('[role="menu"]')?.getBoundingClientRect()
      const menuOverlaps =
        rect &&
        menu &&
        rect.left < menu.right &&
        rect.right > menu.left &&
        rect.top < menu.bottom &&
        rect.bottom > menu.top
      const blocked =
        covered ||
        menuOverlaps ||
        document.querySelector('[role="dialog"], .dv-drop-target-selection, [data-component-drag]')
      const bounds =
        rect &&
        api.isVisible &&
        !blocked &&
        (current?.mode === 'docked' ||
          (current?.phase === 'attaching' && attachingGroups.get(api) === api.group.id))
          ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          : null
      const encoded = JSON.stringify([current?.transfer, bounds])
      if (encoded !== previous) {
        previous = encoded
        host.bounds(bounds, current?.transfer)
      }
      frame = requestAnimationFrame(measure)
    }
    frame = requestAnimationFrame(measure)
    return () => {
      cancelAnimationFrame(frame)
      off()
      for (const unsubscribe of offOthers) unsubscribe?.()
      host.bounds(null)
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
      {!(state?.mode === 'docked' && state.phase === 'ready') && (
        <>
          <p>
            {state?.error ||
              (state?.mode === 'standalone'
                ? t('组件在独立窗口中运行', 'Component is running in a separate window')
                : t('正在连接组件', 'Connecting component'))}
          </p>
          <Button
            onClick={() =>
              void (
                api.id === 'component-prompts'
                  ? window.promptDock
                  : api.id === 'component-music'
                    ? window.musicDock
                    : window.componentHost
              )?.open()
            }
          >
            {api.id === 'component-music'
              ? t('重新连接音乐', 'Reconnect Music')
              : t('重新连接组件', 'Reconnect component')}
          </Button>
        </>
      )}
    </div>
  )
}
