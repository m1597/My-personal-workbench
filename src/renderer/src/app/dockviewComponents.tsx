import { useState, useEffect, useContext } from 'react'
import type { IDockviewHeaderActionsProps, IDockviewPanelProps } from 'dockview-react'
import { Minimize2, Maximize2, PanelsTopLeft } from 'lucide-react'
import { WorkspaceContext } from './WorkspaceContext'
import { createDefaultLayout } from './workspace'
import { NavigationPanel } from '../modules/NavigationPanel'
import { CanvasPanel } from '../modules/CanvasPanel'
import { Inspector } from '../modules/Inspector'
import { BottomPanel } from '../modules/BottomPanel'

function ModulePanel({ api }: IDockviewPanelProps) {
  switch (api.id) {
    case 'module-1':
      return <NavigationPanel />
    case 'module-2':
      return <CanvasPanel />
    case 'module-3':
      return <Inspector />
    case 'module-4':
      return <BottomPanel />
    default:
      return null
  }
}
export const components = { module: ModulePanel }

export function HeaderActions({ api, containerApi }: IDockviewHeaderActionsProps) {
  const [maximized, setMaximized] = useState(api.isMaximized())
  useEffect(() => {
    const subscription = containerApi.onDidMaximizedGroupChange(() =>
      setMaximized(api.isMaximized()),
    )
    return () => subscription.dispose()
  }, [api, containerApi])
  return (
    <button
      type="button"
      className="icon-button header-action"
      aria-label={maximized ? '还原面板' : '最大化面板'}
      title={maximized ? '还原面板' : '最大化面板'}
      onClick={() => {
        if (api.isMaximized()) api.exitMaximized()
        else api.maximize()
        setMaximized(api.isMaximized())
      }}
    >
      {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
    </button>
  )
}

export function EmptyWorkspace() {
  const { api } = useContext(WorkspaceContext)
  return (
    <div className="empty-workspace">
      <PanelsTopLeft size={40} strokeWidth={1} />
      <h2>留一点空间给新的想法</h2>
      <p>从「窗口」菜单打开模块，或恢复默认布局。</p>
      <button
        type="button"
        className="primary-button"
        onClick={() => api && createDefaultLayout(api)}
      >
        恢复默认布局
      </button>
    </div>
  )
}
