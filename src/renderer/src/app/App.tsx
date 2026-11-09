import { useCallback, useEffect, useRef, useState } from 'react'
import { DockviewReact, type DockviewReadyEvent } from 'dockview-react'
import {
  PanelsTopLeft,
  ChevronDown,
  Check,
  Plus,
  RotateCcw,
  MousePointer2,
  HelpCircle,
  X,
  LayoutGrid,
  Sun,
  Moon,
} from 'lucide-react'
import { createDefaultLayout, openModule } from './workspace'
import { modules, icons } from './moduleRegistry'
import { WorkspaceContext, type WorkspaceState } from './WorkspaceContext'
import { components, HeaderActions, EmptyWorkspace } from './dockviewComponents'
import { applyTheme, readTheme } from './theme'
const theme = { name: 'workbench', className: 'dockview-theme-workbench', gap: 8 }

export default function App() {
  const [colorTheme, setColorTheme] = useState(readTheme)
  const [workspace, setWorkspace] = useState<WorkspaceState>({ visible: [] })
  const [menuOpen, setMenuOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const helpRef = useRef<HTMLDialogElement>(null)
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
  useEffect(() => {
    if (!menuOpen) return
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [menuOpen])
  useEffect(() => {
    if (helpOpen) helpRef.current?.showModal()
    else helpRef.current?.close()
  }, [helpOpen])

  const onReady = useCallback(({ api }: DockviewReadyEvent) => {
    createDefaultLayout(api)
    setWorkspace({ api, active: api.activePanel?.id, visible: api.panels.map((panel) => panel.id) })
  }, [])

  return (
    <WorkspaceContext.Provider value={workspace}>
      <div className="workbench">
        <header className="app-header">
          <div className="brand" title="个人工作台">
            <PanelsTopLeft size={23} strokeWidth={1.4} />
          </div>
          <div className="project-name">
            <span>个人工作台</span>
            <strong>我的工作空间</strong>
          </div>
          <div className="menu-anchor" ref={menuRef}>
            <button
              type="button"
              className={`text-button ${menuOpen ? 'is-active' : ''}`}
              aria-expanded={menuOpen}
              aria-controls="window-menu"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              窗口
              <ChevronDown size={12} />
            </button>
            {menuOpen && (
              <div className="dropdown-menu" id="window-menu">
                <div className="menu-title">显示模块</div>
                {modules.map((module) => (
                  <button
                    type="button"
                    key={module.id}
                    onClick={() => {
                      if (workspace.api) openModule(workspace.api, module.id)
                      setMenuOpen(false)
                    }}
                  >
                    <span>{module.title}</span>
                    {workspace.visible.includes(module.id) ? (
                      <Check size={14} />
                    ) : (
                      <Plus size={14} />
                    )}
                  </button>
                ))}
                <div className="menu-divider" />
                <button
                  type="button"
                  onClick={() => {
                    if (workspace.api) createDefaultLayout(workspace.api)
                    setMenuOpen(false)
                  }}
                >
                  <span>重置布局</span>
                  <RotateCcw size={14} />
                </button>
              </div>
            )}
          </div>
          <div className="header-spacer" />
          <div className="workspace-label">
            <span className="accent-dot" />
            本地工作区
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label={colorTheme === 'dark' ? '切换到浅色' : '切换到深色'}
            title={colorTheme === 'dark' ? '切换到浅色' : '切换到深色'}
            onClick={() => {
              const next = colorTheme === 'dark' ? 'light' : 'dark'
              applyTheme(next)
              setColorTheme(next)
            }}
          >
            {colorTheme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="操作帮助"
            title="操作帮助"
            onClick={() => setHelpOpen(true)}
          >
            <HelpCircle size={17} />
          </button>
          <span className="header-divider" />
          <button
            type="button"
            className="reset-button"
            onClick={() => workspace.api && createDefaultLayout(workspace.api)}
          >
            <RotateCcw size={14} />
            重置布局
          </button>
          <div className="avatar" title="个人空间">
            我
          </div>
        </header>
        <div className="workspace-toolbar">
          <span className="workspace-title">
            <LayoutGrid size={14} />
            默认工作区
          </span>
          <span className="toolbar-divider" />
          <span className="toolbar-hint">把工具放到顺手的位置</span>
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
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: Native dialog Escape/onCancel and close button provide keyboard dismissal. */}
        <dialog
          ref={helpRef}
          className="help-dialog"
          onCancel={() => setHelpOpen(false)}
          onClick={(event) => {
            if (event.target === event.currentTarget) setHelpOpen(false)
          }}
        >
          <div className="dialog-heading">
            <h2>让工作区适合你的习惯</h2>
            <button
              type="button"
              className="icon-button"
              aria-label="关闭帮助"
              onClick={() => setHelpOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
          <p>四个模块都是占位面板，你可以先体验布局。</p>
          <dl>
            <dt>移动面板</dt>
            <dd>拖住模块标签，放到高亮区域。</dd>
            <dt>合并标签</dt>
            <dd>将标签拖到另一个面板的标签栏。</dd>
            <dt>调整大小</dt>
            <dd>拖动面板之间的分隔线。</dd>
            <dt>重新打开</dt>
            <dd>点击顶部「窗口」菜单或模块图标。</dd>
            <dt>还原布局</dt>
            <dd>点击右上角「重置布局」。</dd>
          </dl>
        </dialog>
      </div>
    </WorkspaceContext.Provider>
  )
}
