import { createContext } from 'react'
import type { DockviewApi } from 'dockview-react'
export type WorkspaceState = { api?: DockviewApi; active?: string; visible: string[] }
export const WorkspaceContext = createContext<WorkspaceState>({ visible: [] })
