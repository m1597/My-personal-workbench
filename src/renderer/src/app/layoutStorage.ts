import type { DockviewApi, SerializedDockview } from 'dockview-react'
import { minimumPanelSize, modules } from './moduleRegistry'
import { createDefaultLayout } from './workspace'

export const layoutStorageKey = 'workbench.layout'
const formatVersion = 1

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validLayout(value: unknown): value is SerializedDockview {
  if (!record(value) || !record(value.grid) || !record(value.panels)) return false
  const { grid, panels } = value
  if (value.floatingGroups || value.popoutGroups || value.edgeGroups) return false
  if (!['HORIZONTAL', 'VERTICAL'].includes(String(grid.orientation))) return false
  if (![grid.width, grid.height].every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0))
    return false
  const ids = Object.keys(panels)
  if (!ids.every((id) => modules.some((module) => module.id === id))) return false
  if (
    !ids.every((id) => {
      const panel = panels[id]
      return (
        record(panel) &&
        panel.id === id &&
        panel.contentComponent === 'module' &&
        !panel.tabComponent &&
        ['minimumWidth', 'minimumHeight', 'maximumWidth', 'maximumHeight'].every((field) => {
          const size = panel[field]
          return (
            size === undefined || (typeof size === 'number' && Number.isFinite(size) && size >= 0)
          )
        })
      )
    })
  )
    return false
  const seen = new Set<string>()
  const groups = new Set<string>()
  let nodes = 0
  const visit = (node: unknown, depth: number): boolean => {
    if (!record(node) || depth > 16 || ++nodes > 32) return false
    if (
      typeof node.size !== 'number' ||
      !Number.isFinite(node.size) ||
      node.size < 0 ||
      node.visible === false
    )
      return false
    if (node.type === 'branch')
      return Array.isArray(node.data) && node.data.every((child) => visit(child, depth + 1))
    if (node.type !== 'leaf' || !record(node.data)) return false
    const group = node.data
    if (
      typeof group.id !== 'string' ||
      groups.has(group.id) ||
      !Array.isArray(group.views) ||
      group.views.length === 0
    )
      return false
    groups.add(group.id)
    for (const id of group.views) {
      if (typeof id !== 'string' || !ids.includes(id) || seen.has(id)) return false
      seen.add(id)
    }
    return group.activeView === undefined || group.views.includes(group.activeView)
  }
  return (
    record(grid.root) &&
    grid.root.type === 'branch' &&
    visit(grid.root, 0) &&
    seen.size === ids.length &&
    (value.activeGroup === undefined || groups.has(String(value.activeGroup)))
  )
}

// Dockview 8.9.0 serializes visible boxes, but Splitview's descriptor expects
// sizes before distributing its gap. Compensate on read only, never in storage.
// Recheck this adapter when upgrading Dockview (covered by restart geometry tests).
function restoreGapSizes(node: SerializedDockview['grid']['root'], gap: number) {
  if (node.type !== 'branch' || !Array.isArray(node.data)) return
  const visible = node.data.filter((child) => child.visible !== false)
  const share = (gap * Math.max(0, visible.length - 1)) / Math.max(1, visible.length)
  for (const child of node.data) {
    restoreGapSizes(child, gap)
    if (child.visible !== false && child.size !== undefined) child.size += share
  }
}

export function restoreLayout(api: DockviewApi, gap: number) {
  try {
    const raw = localStorage.getItem(layoutStorageKey)
    if (raw) {
      if (raw.length > 100_000) throw new Error('布局数据过大')
      const saved: unknown = JSON.parse(raw)
      if (!record(saved) || saved.version !== formatVersion || !validLayout(saved.layout))
        throw new Error('布局格式、版本或模块不兼容')
      // 8.9.0 writes maximizedNode at runtime although its public grid type omits it.
      Reflect.deleteProperty(saved.layout.grid, 'maximizedNode')
      // Older versions assigned 160 × 110 to every panel reopened from the menu.
      for (const { id } of modules) {
        const panel = saved.layout.panels[id]
        if (panel?.minimumWidth === 160 && panel.minimumHeight === 110)
          Object.assign(panel, minimumPanelSize[id])
      }
      restoreGapSizes(saved.layout.grid.root, gap)
      api.fromJSON(saved.layout)
      return
    }
  } catch {
    console.warn('无法恢复工作区布局，已使用默认布局；可通过“重置布局”重新保存。')
  }
  createDefaultLayout(api)
}

// Attach only after restore/default creation completes. Cleanup never serializes a
// disposed Dockview instance (including React StrictMode's trial mount).
export function trackLayout(api: DockviewApi) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastSaved: string | undefined
  const save = () => {
    clearTimeout(timer)
    try {
      const layout = api.toJSON()
      Reflect.deleteProperty(layout.grid, 'maximizedNode')
      const raw = JSON.stringify({ version: formatVersion, layout })
      if (raw !== lastSaved) {
        localStorage.setItem(layoutStorageKey, raw)
        lastSaved = raw
      }
    } catch {
      console.warn('布局未能保存：请检查应用存储是否可用；当前工作区仍可继续使用。')
    }
  }
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(save, 250)
  }
  const subscription = api.onDidLayoutChange(schedule)
  // Always take a fresh snapshot: Dockview itself coalesces events, so a final
  // completed change can precede the pending layout-change notification.
  window.addEventListener('beforeunload', save)
  schedule()
  return () => {
    clearTimeout(timer)
    subscription.dispose()
    window.removeEventListener('beforeunload', save)
  }
}
