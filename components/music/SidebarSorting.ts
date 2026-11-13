import { useRef, useState, type DragEvent } from 'react'

type Group = 'folders' | 'playlists'
type Move = (group: Group, id: string, target: string, after: boolean) => Promise<unknown>
export type SidebarSorting = {
  sidebarOrder?: Record<Group, string[]>
  moveSidebarItem: Move
}

export function orderedSidebarItems<T extends { id: string }>(items: T[], order?: string[]) {
  if (!order?.length) return items
  const byId = new Map(items.map((item) => [item.id, item]))
  const sorted: T[] = []
  for (const id of order) {
    const item = byId.get(id)
    if (item) {
      sorted.push(item)
      byId.delete(id)
    }
  }
  return [...sorted, ...byId.values()]
}

export function useSidebarSorting(move: Move) {
  const source = useRef<{ group: Group; id: string } | null>(null)
  const [marker, setMarker] = useState<{ id: string; after: boolean } | null>(null)
  function clear() {
    source.current = null
    setMarker(null)
  }
  function belowMiddle(event: DragEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return event.clientY >= rect.top + rect.height / 2
  }
  return (group: Group, id: string) => ({
    draggable: true,
    'data-insert': marker?.id === id ? (marker.after ? 'after' : 'before') : undefined,
    onDragStart(event: DragEvent<HTMLButtonElement>) {
      source.current = { group, id }
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('application/x-fitbay-sidebar', id)
      event.stopPropagation()
    },
    onDragOver(event: DragEvent<HTMLButtonElement>) {
      if (source.current?.group !== group || source.current.id === id) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'move'
      const after = belowMiddle(event)
      setMarker((previous) =>
        previous?.id === id && previous.after === after ? previous : { id, after },
      )
    },
    onDragLeave(event: DragEvent<HTMLButtonElement>) {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))
        return
      setMarker((previous) => (previous?.id === id ? null : previous))
    },
    onDrop(event: DragEvent<HTMLButtonElement>) {
      const from = source.current
      if (from?.group !== group || from.id === id) return
      event.preventDefault()
      event.stopPropagation()
      clear()
      void move(group, from.id, id, belowMiddle(event))
    },
    onDragEnd: clear,
  })
}
