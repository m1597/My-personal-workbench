import { useEffect, useState } from 'react'
import type { DockviewApi } from 'dockview-react'

type Size = { group: string; axis: 'width' | 'height'; fraction: number }
type Entry = { groups: string[]; sizes: Size[] }
const key = 'workbench.edgeCollapse.v1'
function readHistory(): Entry[] {
  try {
    const value: Entry[] = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(value)
      ? value.filter(
          (item) =>
            Array.isArray(item?.groups) &&
            item.groups.every((p) => typeof p === 'string') &&
            Array.isArray(item.sizes) &&
            item.sizes.every(
              (s) =>
                s &&
                typeof s.group === 'string' &&
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
      const sash =
        event.target instanceof Element ? event.target.closest('.dv-sash.dv-enabled') : null
      const handles = sash?.parentElement
      const split = handles?.parentElement
      if (!sash || !split || event.button !== 0 || !api) return
      const views = split.querySelectorAll(':scope > .dv-view-container > .dv-view')
      const index = Array.from(handles.children).indexOf(sash)
      if (!views[index] || !views[index + 1]) return
      const box = split.getBoundingClientRect()
      const handle = sash.getBoundingClientRect()
      const horizontal = handle.height > handle.width
      const span = horizontal ? box.width : box.height
      const visible = api.groups.filter((g) => g.api.isVisible && split.contains(g.element))
      // Dockview distributes each sash gap across its siblings before painting their DOM bounds.
      const sizes = Array.from(split.querySelectorAll<HTMLElement>('.dv-sash-container')).flatMap(
        (sashes) => {
          const parent = sashes.parentElement
          if (!parent) return []
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
            const group = visible.find((g) => child.contains(g.element))?.id
            return group
              ? [{ group, axis, fraction: (child.getBoundingClientRect()[axis] + gap) / api[axis] }]
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
        for (const group of hidden) group.api.setVisible(false)
        const groups = hidden.map((g) => g.id)
        setHistory((items) => [
          ...items.filter((item) => !item.groups.some((id) => groups.includes(id))),
          { groups, sizes },
        ])
      }
      const cleanup = () => {
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', cleanup)
      }
      cancelDrag = cleanup
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
    const groups = item.groups.flatMap((id) => api?.getGroup(id) ?? [])
    if (!api || !groups.some((g) => !g.api.isVisible)) return []
    return [
      {
        id: item.groups.join('|'),
        panels: groups.flatMap((g) => g.panels.map((p) => p.id)),
        names: groups
          .flatMap((g) => (g.panels.length ? g.panels.map((p) => p.title) : ['快速开始']))
          .join('、'),
        restore() {
          for (const group of groups) group.api.setVisible(true)
          for (const { group, axis, fraction } of item.sizes)
            api.getGroup(group)?.api.setSize({ [axis]: api[axis] * fraction })
          setHistory((items) => items.filter((i) => i !== item))
        },
      },
    ]
  })
}
