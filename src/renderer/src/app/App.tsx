import { useCallback, useEffect, useState } from 'react'
import { DockviewReact, type DockviewReadyEvent } from 'dockview-react'
import type { ModuleId } from './builtinSession'
import { WorkspaceContext, type WorkspaceState } from './WorkspaceContext'
import { components, HeaderActions, EmptyWorkspace } from './dockviewComponents'
import { ComponentTheme } from './ComponentTheme'
import { WindowMenu } from './WindowMenu'
import { restoreLayout } from './layoutStorage'
import { ComponentDropPreview, MusicPlayerBar, useComponentPrototype } from './componentPrototype'

export default function App() {
  const [theme] = useState(() => ({
    name: 'workbench',
    className: 'dockview-theme-workbench',
    gap: Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--space-8'),
    ),
  }))
  const [workspace, setWorkspace] = useState<WorkspaceState>({ visible: [] })
  const [detached, setDetached] = useState<ModuleId[]>([])
  useComponentPrototype(workspace.api, theme.gap, setDetached)
  useEffect(() => {
    const api = workspace.api
    if (!api) return
    const update = () =>
      setWorkspace({
        api,
        active: api.activePanel?.id,
        visible: api.panels.map((panel) => panel.id),
      })
    const subscriptions = [
      api.onDidAddPanel(update),
      api.onDidRemovePanel(update),
      api.onDidActivePanelChange(update),
    ]
    update()
    return () =>
      subscriptions.forEach((item) => {
        item.dispose()
      })
  }, [workspace.api])
  const onReady = useCallback(
    ({ api }: DockviewReadyEvent) => {
      restoreLayout(api, theme.gap)
      setWorkspace({
        api,
        active: api.activePanel?.id,
        visible: api.panels.map((panel) => panel.id),
      })
    },
    [theme],
  )

  return (
    <ComponentTheme surface="workspace">
      <WorkspaceContext.Provider
        value={{ ...workspace, visible: [...workspace.visible, ...detached] }}
      >
        <div className="workbench">
          <header className="app-header">
            <WindowMenu />
            <ComponentDropPreview />
          </header>
          <main className="docking-area" aria-label="可调整的模块工作区">
            <DockviewReact
              components={components}
              onReady={onReady}
              theme={theme}
              dndStrategy={window.componentHost ? 'pointer' : 'auto'}
              disableFloatingGroups
              rightHeaderActionsComponent={HeaderActions}
              watermarkComponent={EmptyWorkspace}
            />
          </main>
          <MusicPlayerBar />
        </div>
      </WorkspaceContext.Provider>
    </ComponentTheme>
  )
}
