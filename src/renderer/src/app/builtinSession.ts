import { useSyncExternalStore } from 'react'
import type { modules } from './moduleRegistry'
export type ModuleId = (typeof modules)[number]['id']
type WorkspaceInfo = { visible: ModuleId[]; active?: ModuleId; width: number; height: number }
export type ModuleWindows = {
  revision: number
  detached: ModuleId[]
  workspace?: WorkspaceInfo
  query?: string
}
type Common = {
  status(): Promise<ModuleWindows>
  open(id: ModuleId): Promise<boolean>
  onState(callback: (state: ModuleWindows) => void): () => void
}
export type DockOffer = {
  id: ModuleId
  token: string
  target: {
    id: string
    direction: 'within' | 'left' | 'right' | 'above' | 'below'
  }
}
declare global {
  interface Window {
    builtinWindow?: Common & { query(value: string): void; mounted(): void }
    builtinDock?: Common & {
      detach(id: string, release: { x: number; y: number }, query: string): Promise<boolean>
      commit(id: ModuleId, token: string): { query: string } | null
      workspace(info: WorkspaceInfo): void
      onDock(callback: (offer: DockOffer) => void): () => void
      onActivate(callback: (id: ModuleId) => void): () => void
    }
  }
}
let query = ''
const listeners = new Set<() => void>()
export const navigationQuery = () => query
export function setNavigationQuery(value: string) {
  query = value
  for (const listener of listeners) listener()
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function useNavigationQuery() {
  return useSyncExternalStore(subscribe, navigationQuery)
}
