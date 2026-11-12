import { fixtureWorkspace } from './moduleRegistry'
import { useState, useEffect, useContext } from 'react'
import type { IDockviewHeaderActionsProps, IDockviewPanelProps } from 'dockview-react'
import { Minimize2, Maximize2, PanelsTopLeft } from 'lucide-react'
import { WorkspaceContext } from './WorkspaceContext'
import { createDefaultLayout } from './workspace'
import { NavigationPanel } from '../../../../tests/fixtures/workspace/NavigationPanel'
import { CanvasPanel } from '../../../../tests/fixtures/workspace/CanvasPanel'
import { Inspector } from '../../../../tests/fixtures/workspace/Inspector'
import { BottomPanel } from '../../../../tests/fixtures/workspace/BottomPanel'
import { ComponentSlot } from './componentPrototype'

function ModulePanel({ api }: IDockviewPanelProps) {
  return <BuiltinContent id={api.id} />
}
export function BuiltinContent({ id }: { id: string }) {
  switch (id) {
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
export const components = { module: ModulePanel, 'component-slot': ComponentSlot }

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
  if (!fixtureWorkspace)
    return (
      <div className="empty-workspace">
        <PanelsTopLeft size={40} strokeWidth={1} />
        <h2>工作区为空</h2>
        <p>{window.musicDock ? '从「窗口 → Music」打开音乐组件。' : '从桌面工作台打开 Music。'}</p>
      </div>
    )
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
