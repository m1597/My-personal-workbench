import type { DockviewApi } from 'dockview-react'
import { openInDefaultGrid } from './defaultGrid'
export function openToolkitPanel(api: DockviewApi, title: string) {
  const existing = api.getPanel('component-toolkit')
  if (existing && !existing.group.api.isVisible) existing.group.api.setVisible(true)
  return openInDefaultGrid(api, {
    id: 'component-toolkit',
    title,
    component: 'toolkit',
    minimumWidth: 180,
  })
}
export function ToolkitIcon() {
  return <span className="host-toolkit-icon" aria-hidden="true" />
}
