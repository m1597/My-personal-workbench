import type { DockviewApi, SerializedDockview } from 'dockview-react'
import { minimumPanelSize, modules, retiredPanelIds, fixtureWorkspace } from './moduleRegistry'
import { readPreferences } from './preferences'
import { createDefaultLayout } from './workspace'

export const layoutStorageKey = 'workbench.layout'
const firstEntryKey = 'workbench.firstEntryPending'
export function firstEntryPending() {
  try {
    if (localStorage.getItem(firstEntryKey) === '1') return true
    if (localStorage.getItem(layoutStorageKey) !== null) return false
    localStorage.setItem(firstEntryKey, '1')
    return true
  } catch {
    return false
  }
}
export function finishFirstEntry() {
  try {
    localStorage.removeItem(firstEntryKey)
  } catch {
    // Keep the current session usable if storage is unavailable.
  }
}
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
  if (
    !ids.every(
      (id) =>
        ['component-example', 'component-music', 'component-prompts'].includes(id) ||
        id === 'component-toolkit' ||
        retiredPanelIds.includes(id),
    )
  )
    return false
  if (
    !ids.every((id) => {
      const panel = panels[id]
      return (
        record(panel) &&
        panel.id === id &&
        panel.contentComponent ===
          (['component-example', 'component-music', 'component-prompts'].includes(id)
            ? 'component-slot'
            : id === 'component-toolkit'
              ? 'toolkit'
              : 'module') &&
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
      (node.visible !== undefined && typeof node.visible !== 'boolean')
    )
      return false
    if (node.type === 'branch')
      return Array.isArray(node.data) && node.data.every((child) => visit(child, depth + 1))
    if (node.type !== 'leaf' || !record(node.data)) return false
    const group = node.data
    if (typeof group.id !== 'string' || groups.has(group.id) || !Array.isArray(group.views))
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

export function applyLayout(api: DockviewApi, layout: SerializedDockview, gap: number) {
  restoreGapSizes(layout.grid.root, gap)
  api.fromJSON(layout, { reuseExistingPanels: true })
}

function retirePlaceholders(layout: SerializedDockview) {
  if (fixtureWorkspace) return
  let firstGroup: string | undefined
  const previousActive = layout.activeGroup
  const keep = (node: SerializedDockview['grid']['root']): boolean => {
    if (Array.isArray(node.data)) {
      node.data = node.data.filter(keep)
      return node.data.length > 0
    }
    const group = node.data
    if (!group.views.length) return true
    group.views = group.views.filter((id) => !retiredPanelIds.includes(id))
    if (group.views.length) firstGroup ??= group.id
    if (!group.views.length && layout.activeGroup === group.id) delete layout.activeGroup
    if (group.activeView && !group.views.includes(group.activeView))
      group.activeView = group.views[0]
    return group.views.length > 0
  }
  keep(layout.grid.root)
  if (previousActive && !layout.activeGroup && firstGroup) layout.activeGroup = firstGroup
  for (const id of retiredPanelIds) delete layout.panels[id]
}
export function captureLayout(api: DockviewApi) {
  const layout = api.toJSON()
  Reflect.deleteProperty(layout.grid, 'maximizedNode')
  if (!fixtureWorkspace && !api.groups.length) return { ...layout, quickStartClosed: true }
  return layout
}

function restoreSnapshot(api: DockviewApi, snapshot: SerializedDockview, gap: number) {
  const layout = structuredClone(snapshot)
  // 8.9.0 writes maximizedNode at runtime although its public grid type omits it.
  Reflect.deleteProperty(layout.grid, 'maximizedNode')
  // Older versions assigned 160 × 110 to every panel reopened from the menu.
  for (const { id } of modules) {
    const panel = layout.panels[id]
    if (panel?.minimumWidth === 160 && panel.minimumHeight === 110)
      Object.assign(panel, minimumPanelSize[id])
  }
  retirePlaceholders(layout)
  const english = readPreferences().language === 'en'
  for (const [id, title] of Object.entries({
    'component-music': 'Music',
    'component-toolkit': english ? 'Toolkit' : '工具集',
    'component-prompts': english ? 'Prompt library' : '提示词库',
  })) {
    if (layout.panels[id]) layout.panels[id].title = title
  }
  applyLayout(api, layout, gap)
  if (!fixtureWorkspace && !api.groups.length && Reflect.get(snapshot, 'quickStartClosed') !== true)
    api.addGroup()
  const slot = api.getPanel('component-example')
  if (slot && !window.componentHost?.sampleEnabled) api.removePanel(slot)
  const toolkit = api.getPanel('component-toolkit')
  if (toolkit) {
    if (!window.fitbayToolkit) api.removePanel(toolkit)
    else
      void window.fitbayToolkit
        .available()
        .then((available) => {
          if (!available && api.getPanel('component-toolkit') === toolkit) api.removePanel(toolkit)
        })
        .catch(() => {})
  }
  const music = api.getPanel('component-music')
  if (music && !window.musicDock) api.removePanel(music)
}

export function currentLayoutName() {
  try {
    return localStorage.getItem('workbench.layoutName') ?? ''
  } catch {
    return ''
  }
}
export function selectLayoutName(name: string) {
  try {
    localStorage.setItem('workbench.layoutName', name)
  } catch {
    /* The layout remains usable. */
  }
  window.dispatchEvent(new Event('fitbay-layout-name'))
}
const startupKey = 'workbench.startup.v1'
export function readStartup() {
  try {
    return localStorage.getItem(startupKey) ?? 'last'
  } catch {
    return 'last'
  }
}
export function writeStartup(value: string) {
  localStorage.setItem(startupKey, value)
}
export function restoreLayout(api: DockviewApi, gap: number) {
  try {
    const startup = readStartup()
    if (startup === 'blank') {
      if (!fixtureWorkspace) api.addGroup()
      selectLayoutName('')
      return
    }
    if (startup.startsWith('named:')) {
      const preset = readPresets().items.find((item) => item.name === startup.slice(6))
      if (preset) {
        selectLayoutName(preset.name)
        return restoreSnapshot(api, preset.layout, gap)
      }
    }
    const raw = localStorage.getItem(layoutStorageKey)
    if (raw) {
      if (raw.length > 100_000) throw new Error('布局数据过大')
      const saved: unknown = JSON.parse(raw)
      if (!record(saved) || saved.version !== formatVersion || !validLayout(saved.layout))
        throw new Error('布局格式、版本或模块不兼容')
      restoreSnapshot(api, saved.layout, gap)
      return
    }
  } catch {
    console.warn('无法恢复工作区布局，已使用默认布局；可从布局菜单还原默认布局。')
  }
  const presets = readPresets()
  const chosen = presets.items.find((item) => item.name === presets.defaultName)
  if (chosen) restoreSnapshot(api, chosen.layout, gap)
  else createDefaultLayout(api)
}

// Attach only after restore/default creation completes. Cleanup never serializes a
// disposed Dockview instance (including React StrictMode's trial mount).
export function trackLayout(api: DockviewApi) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastSaved: string | undefined
  let pauses = 0
  const save = () => {
    clearTimeout(timer)
    if (pauses) return
    try {
      const layout = captureLayout(api)
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
  return {
    flush: save,
    pause() {
      save()
      pauses++
    },
    resume() {
      pauses--
      schedule()
    },
    dispose() {
      clearTimeout(timer)
      subscription.dispose()
      window.removeEventListener('beforeunload', save)
    },
  }
}

type NamedLayout = { name: string; layout: SerializedDockview }
export type LayoutPresets = { items: NamedLayout[]; defaultName?: string }
const presetsKey = 'workbench.layoutPresets'

export function readPresets(): LayoutPresets {
  try {
    const saved = JSON.parse(localStorage.getItem(presetsKey) ?? 'null')
    if (record(saved) && saved.version === 1 && Array.isArray(saved.items)) {
      const items = saved.items.filter(
        (entry): entry is NamedLayout =>
          record(entry) &&
          typeof entry.name === 'string' &&
          !!entry.name.trim() &&
          validLayout(entry.layout),
      )
      return {
        items,
        defaultName: typeof saved.defaultName === 'string' ? saved.defaultName : undefined,
      }
    }
  } catch {
    console.warn('无法读取命名布局。')
  }
  return { items: [] }
}

export function savePresets(presets: LayoutPresets) {
  localStorage.setItem(presetsKey, JSON.stringify({ ...presets, version: 1 }))
}

// Dockview synchronously emits remove events while it reconciles a saved layout.
const switching = new WeakSet<DockviewApi>()
export function switchingLayout(api: DockviewApi) {
  return switching.has(api)
}
export function switchLayout(api: DockviewApi, snapshot?: SerializedDockview, blank = false) {
  const gap = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--space-8'),
  )
  switching.add(api)
  try {
    if (blank) api.clear()
    else if (snapshot) restoreSnapshot(api, snapshot, gap)
    else createDefaultLayout(api)
  } finally {
    switching.delete(api)
  }
  void window.promptDock?.layout(Boolean(api.getPanel('component-prompts')))
  void window.musicDock?.layout(Boolean(api.getPanel('component-music')))
  if (window.componentHost?.sampleEnabled)
    void window.componentHost.layout(Boolean(api.getPanel('component-example')))
}
