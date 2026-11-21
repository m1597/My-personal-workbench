import type { DockviewApi } from 'dockview-react'

type PanelOptions = Pick<
  Parameters<DockviewApi['addPanel']>[0],
  'id' | 'title' | 'component' | 'minimumWidth' | 'minimumHeight'
>

// Only ordinary opens use this placement. Explicit drop targets belong to Dockview.
export function openInDefaultGrid(api: DockviewApi, options: PanelOptions) {
  const existing = api.getPanel(options.id)
  if (existing) {
    existing.api.setActive()
    return existing
  }
  const groups = api.groups
    .filter((group) => group.api.location.type === 'grid')
    .sort((a, b) => {
      const first = a.element.getBoundingClientRect(),
        second = b.element.getBoundingClientRect()
      return first.top - second.top || first.left - second.left
    })
  if (!groups.length) return api.addPanel(options)
  if (groups.length === 1 && groups[0].panels.length) {
    return api.addPanel({ ...options, position: { referenceGroup: groups[0], direction: 'right' } })
  }
  if (groups.length === 2 && groups.every((group) => group.panels.length)) {
    const left = groups[0],
      right = groups[1]
    const lowerLeft = api.addGroup({ referenceGroup: left, direction: 'below' })
    api.addGroup({ referenceGroup: right, direction: 'below' })
    return api.addPanel({
      ...options,
      position: { referenceGroup: lowerLeft, direction: 'within' },
    })
  }
  const grid = groups.slice(0, 4)
  const count = grid.reduce((n, g) => n + g.panels.length, 0)
  const group = grid.find((g) => !g.panels.length) ?? grid[count % grid.length]
  return api.addPanel({ ...options, position: { referenceGroup: group, direction: 'within' } })
}
