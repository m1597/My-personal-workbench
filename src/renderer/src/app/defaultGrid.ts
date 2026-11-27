import type { DockviewApi } from 'dockview-react'

type PanelOptions = Pick<
  Parameters<DockviewApi['addPanel']>[0],
  'id' | 'title' | 'component' | 'minimumWidth' | 'minimumHeight'
>

// Only ordinary opens use this placement. Explicit drop targets belong to Dockview.
export function openInDefaultGrid(api: DockviewApi, options: PanelOptions) {
  if (api.hasMaximizedGroup()) api.exitMaximizedGroup()
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
  const empty = groups.find((group) => !group.panels.length)
  if (empty)
    return api.addPanel({ ...options, position: { referenceGroup: empty, direction: 'within' } })
  if (groups.length === 2 || groups.length === 3) {
    // Split the right column first. The existing left pane keeps its live view and width.
    const target =
      groups.length === 2
        ? groups[1]
        : groups.reduce((largest, group) =>
            group.api.height > largest.api.height ? group : largest,
          )
    const peer = groups.find(
      (g) => g.element.getBoundingClientRect().left !== target.element.getBoundingClientRect().left,
    )
    const before = peer?.element.getBoundingClientRect()
    const targetBox = target.element.getBoundingClientRect()
    const gap = before
      ? Math.max(0, Math.max(before.left, targetBox.left) - Math.min(before.right, targetBox.right))
      : 0
    const panel = api.addPanel({
      ...options,
      position: { referenceGroup: target, direction: 'below' },
    })
    if (peer && before) {
      const correction = before.width - peer.element.getBoundingClientRect().width
      if (Math.abs(correction) >= 1) peer.api.setSize({ width: before.width + gap / 2 })
    }
    return panel
  }
  const grid = groups.slice(0, 4)
  const count = grid.reduce((n, g) => n + g.panels.length, 0)
  const group = grid[count % grid.length]
  return api.addPanel({ ...options, position: { referenceGroup: group, direction: 'within' } })
}
