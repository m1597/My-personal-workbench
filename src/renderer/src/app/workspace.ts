import { addFixturePanels } from '../../../../tests/fixtures/workspace/layout'
import type { DockviewApi } from 'dockview-react'
import { minimumPanelSize, modules, fixtureWorkspace } from './moduleRegistry'
export function openModule(api: DockviewApi, id: string) {
  const module = modules.find((item) => item.id === id)
  if (window.builtinDock && module) {
    void window.builtinDock.open(module.id)
    return
  }
  showDockedModule(api, id)
}
export function showDockedModule(api: DockviewApi, id: string) {
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
  if (fixtureWorkspace) addFixturePanels(api)
}
