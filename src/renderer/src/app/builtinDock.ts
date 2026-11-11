import type { DockviewApi } from 'dockview-react'
import { applyLayout, type trackLayout } from './layoutStorage'
import { minimumPanelSize, modules } from './moduleRegistry'
import {
  type DockOffer,
  type ModuleId,
  type ModuleWindows,
  setNavigationQuery,
} from './builtinSession'
import { showDockedModule } from './workspace'

export function bindBuiltinDock(
  api: DockviewApi,
  layout: ReturnType<typeof trackLayout>,
  gap: number,
  onDetached: (ids: ModuleId[]) => void,
) {
  const host = window.builtinDock
  if (!host) return
  let live = true
  let revision = -1
  let detached: ModuleId[] = []
  const pending = new Set<string>()
  const reconcile = () => {
    if (!live) return
    for (const id of detached) {
      const slot = api.getPanel(id)
      if (slot && !pending.has(id)) api.removePanel(slot)
    }
  }
  const state = (value: ModuleWindows) => {
    if (!live || value.revision < revision) return
    revision = value.revision
    if (detached.join() !== value.detached.join()) {
      detached = value.detached
      onDetached(detached)
    }
    reconcile()
  }
  const offState = host.onState(state)
  void host.status().then(state)
  const added = api.onDidAddPanel(() => queueMicrotask(reconcile))
  const offActivate = host.onActivate((id) => showDockedModule(api, id))
  const dock = ({ id, target, token }: DockOffer) => {
    const module = modules.find((item) => item.id === id)
    if (
      !module ||
      pending.has(id) ||
      api.getPanel(id) ||
      (target.id ? !api.getGroup(target.id) : api.groups.length > 0) ||
      document.querySelector('[role="dialog"], [role="menu"]')
    )
      return
    pending.add(id)
    layout.pause()
    const before = api.toJSON()
    try {
      const slot = api.addPanel({
        id,
        title: module.title,
        component: 'module',
        ...minimumPanelSize[id],
        position: target.id
          ? { referenceGroup: target.id, direction: target.direction }
          : undefined,
      })
      const provisional = JSON.stringify(api.toJSON())
      // Keep panel creation and the bounded, in-memory ownership change in one UI turn.
      const result = live && api.getPanel(id) === slot && host.commit(id, token)
      if (result) {
        detached = detached.filter((item) => item !== id)
        onDetached(detached)
        if (id === 'module-1') setNavigationQuery(result.query)
      } else if (live && api.getPanel(id) === slot) {
        if (JSON.stringify(api.toJSON()) === provisional) applyLayout(api, before, gap)
        else api.removePanel(slot)
      }
    } finally {
      pending.delete(id)
      if (live) {
        layout.resume()
        reconcile()
      }
    }
  }
  const offDock = host.onDock((offer) => {
    void dock(offer)
  })
  let previous = ''
  function report() {
    const active = api.activePanel
    const info = {
      visible: modules.filter((item) => api.getPanel(item.id)).map((item) => item.id),
      active: modules.find((item) => item.id === active?.id)?.id,
      width: active?.api.width ?? 0,
      height: active?.api.height ?? 0,
    }
    const key = JSON.stringify(info)
    if (previous !== key) {
      previous = key
      host?.workspace(info)
    }
  }
  return {
    report,
    dispose() {
      live = false
      offState()
      offActivate()
      offDock()
      added.dispose()
    },
  }
}
