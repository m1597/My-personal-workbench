import { useEffect, useState } from 'react'
import type { DockviewApi } from 'dockview-react'

type Size = { panel: string; axis: 'width' | 'height'; fraction: number }
type Entry = { panels: string[]; sizes: Size[] }
const key = 'workbench.edgeCollapse.v1'
function readHistory(): Entry[] {
  try {
    const value: Entry[] = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(value)
      ? value.filter(
          (item) =>
            Array.isArray(item?.panels) &&
            item.panels.every((p) => typeof p === 'string') &&
            Array.isArray(item.sizes) &&
            item.sizes.every(
              (s) =>
                s &&
                typeof s.panel === 'string' &&
                ['width', 'height'].includes(s.axis) &&
                Number.isFinite(s.fraction),
            ),
        )
      : []
  } catch {
    return []
  }
}

export function useEdgeCollapse(api?: DockviewApi) {
  const [history, setHistory] = useState<Entry[]>(readHistory)
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(history))
    } catch {
      /* Keep the current session usable. */
    }
  }, [history])
  useEffect(() => {
    if (!api) return
    let cancelDrag: (() => void) | undefined
    function start(event: PointerEvent) {
      const sash = event.target instanceof Element && event.target.closest('.dv-sash.dv-enabled')
      const split = sash && sash.parentElement?.parentElement
      if (!sash || !split || event.button !== 0 || !api) return
      const views = split.querySelectorAll(':scope > .dv-view-container > .dv-view')
      const index = Array.from(sash.parentElement!.children).indexOf(sash)
      if (!views[index] || !views[index + 1]) return
      const box = split.getBoundingClientRect()
      const handle = sash.getBoundingClientRect()
      const horizontal = handle.height > handle.width
      const span = horizontal ? box.width : box.height
      const visible = api.groups.filter((g) => g.api.isVisible && split.contains(g.element))
      // Dockview distributes each sash gap across its siblings before painting their DOM bounds.
      const sizes = Array.from(split.querySelectorAll<HTMLElement>('.dv-sash-container')).flatMap(
        (sashes) => {
          const parent = sashes.parentElement!
          const bar = sashes.querySelector('.dv-sash.dv-enabled')?.getBoundingClientRect()
          if (!bar) return []
          const axis: 'width' | 'height' = bar.height > bar.width ? 'width' : 'height'
          const total = parent.getBoundingClientRect()[axis]
          const children = [
            ...parent.querySelectorAll(':scope > .dv-view-container > .dv-view'),
          ].filter((child) => child.getBoundingClientRect()[axis] > 0)
          const gap =
            (total -
              children.reduce((sum, child) => sum + child.getBoundingClientRect()[axis], 0)) /
            children.length
          return children.flatMap((child) => {
            const panel = visible.find((g) => child.contains(g.element))?.panels[0]?.id
            return panel
              ? [{ panel, axis, fraction: (child.getBoundingClientRect()[axis] + gap) / api[axis] }]
              : []
          })
        },
      )
      cancelDrag?.()
      function end(up: PointerEvent) {
        if (up.pointerId !== event.pointerId) return
        cancelDrag?.()
        const pos = horizontal ? up.clientX - box.left : up.clientY - box.top
        const side =
          pos <= 12
            ? [...views].slice(0, index + 1)
            : pos >= span - 12
              ? [...views].slice(index + 1)
              : []
        if (
          !side.length ||
          Math.abs(horizontal ? up.clientX - event.clientX : up.clientY - event.clientY) < 12
        )
          return
        const hidden = visible.filter((group) => side.some((view) => view.contains(group.element)))
        if (!hidden.length || hidden.length === visible.length) return
        hidden.forEach((group) => group.api.setVisible(false))
        const panels = hidden.flatMap((g) => g.panels.map((p) => p.id))
        setHistory((items) => [
          ...items.filter((item) => !item.panels.some((id) => panels.includes(id))),
          { panels, sizes },
        ])
      }
      cancelDrag = () => {
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', cancelDrag!)
      }
      window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', cancelDrag)
    }
    window.addEventListener('pointerdown', start, true)
    return () => {
      cancelDrag?.()
      window.removeEventListener('pointerdown', start, true)
    }
  }, [api])
  return history.flatMap((item) => {
    const panels = item.panels.flatMap((id) => api?.getPanel(id) ?? [])
    if (!api || !panels.some((p) => !p.group.api.isVisible)) return []
    return [
      {
        panels: item.panels,
        names: panels.map((p) => p.title).join('、'),
        restore() {
          for (const group of new Set(panels.map((p) => p.group))) group.api.setVisible(true)
          for (const { panel, axis, fraction } of item.sizes)
            api.getPanel(panel)?.group.api.setSize({ [axis]: api[axis] * fraction })
          setHistory((items) => items.filter((i) => i !== item))
        },
      },
    ]
  })
}
