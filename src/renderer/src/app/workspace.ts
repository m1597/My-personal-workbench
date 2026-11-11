import type { DockviewApi } from 'dockview-react'
import { minimumPanelSize, modules } from './moduleRegistry'
export function openModule(api: DockviewApi, id: string) {
  if (api.hasMaximizedGroup()) api.exitMaximizedGroup()
  const existing = api.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }
  const module = modules.find((item) => item.id === id)
  if (!module) return
  api.addPanel({
    id,
    title: module.title,
    component: 'module',
    ...minimumPanelSize[module.id],
  })
}

export function createDefaultLayout(api: DockviewApi) {
  api.clear()
  api.addPanel({
    id: 'module-2',
    title: '模块 2',
    component: 'module',
    ...minimumPanelSize['module-2'],
  })
  api.addPanel({
    id: 'module-4',
    title: '模块 4',
    component: 'module',
    position: { referencePanel: 'module-2', direction: 'below' },
    initialHeight: Math.max(160, api.height * 0.25),
    ...minimumPanelSize['module-4'],
  })
  api.addPanel({
    id: 'module-1',
    title: '模块 1',
    component: 'module',
    position: { direction: 'left' },
    initialWidth: 230,
    ...minimumPanelSize['module-1'],
  })
  api.addPanel({
    id: 'module-3',
    title: '模块 3',
    component: 'module',
    position: { direction: 'right' },
    initialWidth: 252,
    ...minimumPanelSize['module-3'],
  })
  api.getPanel('module-1')?.api.setSize({ width: 230 })
  api.getPanel('module-3')?.api.setSize({ width: 252 })
  api.getPanel('module-4')?.api.setSize({ height: Math.max(160, api.height * 0.25) })
  api.getPanel('module-2')?.api.setActive()
}
