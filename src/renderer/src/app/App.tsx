import { useCallback, useEffect, useState } from 'react'
import { DockviewReact, type DockviewReadyEvent } from 'dockview-react'
import { PanelsTopLeft, RotateCcw, MousePointer2, LayoutGrid } from 'lucide-react'
import { createDefaultLayout, openModule } from './workspace'
import { modules, icons } from './moduleRegistry'
import { WorkspaceContext, type WorkspaceState } from './WorkspaceContext'
import { components, HeaderActions, EmptyWorkspace } from './dockviewComponents'
import { Button, FluentProvider } from '@fluentui/react-components'
import { fluentTheme } from './fluentTheme'
import { WindowMenu } from './WindowMenu'
import { HelpDialog } from './HelpDialog'
import { restoreLayout, trackLayout } from './layoutStorage'
import { ComponentPrototypeButton, useComponentPrototype } from './componentPrototype'

export default function App() {
  const [uiTheme] = useState(fluentTheme)
  const [theme] = useState(() => ({
    name: 'workbench',
    className: 'dockview-theme-workbench',
    gap: Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--space-8'),
    ),
  }))
  const [workspace, setWorkspace] = useState<WorkspaceState>({ visible: [] })
  useComponentPrototype(workspace.api)
  useEffect(() => {
    if (workspace.api) return trackLayout(workspace.api)
  }, [workspace.api])
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
    <FluentProvider theme={uiTheme} className="fluent-workbench">
      <WorkspaceContext.Provider value={workspace}>
        <div className="workbench">
          <header className="app-header">
            <div className="brand" title="个人工作台">
              <PanelsTopLeft size={23} strokeWidth={1.4} />
            </div>
            <div className="project-name">
              <strong>个人工作台</strong>
              <span>我的工作空间</span>
            </div>
            <WindowMenu />
            <ComponentPrototypeButton />
            <div className="header-spacer" />
            <div className="workspace-label">
              <span className="accent-dot" />
              本地工作区
            </div>
            <HelpDialog />
            <span className="header-divider" />
            <Button
              appearance="secondary"
              icon={<RotateCcw size={16} />}
              className="workbench-reset"
              onClick={() => workspace.api && createDefaultLayout(workspace.api)}
            >
              重置布局
            </Button>
          </header>
          <div className="workspace-toolbar">
            <span className="workspace-title">
              <LayoutGrid size={14} />
              默认工作区
            </span>
            <span className="toolbar-divider" />
            <span className="toolbar-hint">拖动标签，自由组合工作区</span>
            <div className="header-spacer" />
            <div className="module-shortcuts">
              {modules.map((module, index) => {
                const Icon = icons[index]
                return (
                  <button
                    type="button"
                    key={module.id}
                    className={`icon-button ${workspace.active === module.id ? 'is-active' : ''}`}
                    title={`打开${module.title}`}
                    aria-label={`显示${module.title}`}
                    onClick={() => workspace.api && openModule(workspace.api, module.id)}
                  >
                    <Icon size={16} />
                  </button>
                )
              })}
            </div>
          </div>
          <main className="docking-area" aria-label="可调整的模块工作区">
            <DockviewReact
              components={components}
              onReady={onReady}
              theme={theme}
              disableFloatingGroups
              rightHeaderActionsComponent={HeaderActions}
              watermarkComponent={EmptyWorkspace}
            />
          </main>
          <footer className="statusbar">
            <span>
              <span className="accent-dot" />
              就绪
            </span>
            <span className="status-separator" />
            <span data-testid="panel-count">{workspace.visible.length} 个模块已打开</span>
            <div className="header-spacer" />
            <span className="status-hint">
              <MousePointer2 size={12} />
              拖动标签排列 · 拖动边界缩放
            </span>
            <span className="status-separator" />
            <span>基础框架 v0.1</span>
          </footer>
        </div>
      </WorkspaceContext.Provider>
    </FluentProvider>
  )
}
