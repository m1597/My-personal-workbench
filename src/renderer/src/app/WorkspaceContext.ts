import { createContext } from 'react'
import type { DockviewApi } from 'dockview-react'
export type WorkspaceState = {
  api?: DockviewApi
  firstEntry?: boolean
  active?: string
  visible: string[]
  dimensions?: { width: number; height: number }
}
export const WorkspaceContext = createContext<WorkspaceState>({ visible: [] })
