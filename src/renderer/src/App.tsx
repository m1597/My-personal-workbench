import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type IDockviewPanelProps, type IDockviewHeaderActionsProps } from 'dockview-react'
import { PanelsTopLeft, PanelLeft, PanelRight, PanelBottom, SquareDashed, ChevronDown, ChevronRight, Check, Plus, RotateCcw, Maximize2, Minimize2, GripVertical, MousePointer2, SlidersHorizontal, HelpCircle, X, Search, LayoutGrid, Circle, Move } from 'lucide-react'
import { createDefaultLayout, modules, openModule } from './workspace'
import { Sun, Moon } from 'lucide-react'
import { applyTheme, readTheme } from './theme'

const theme = { name: 'workbench', className: 'dockview-theme-workbench', gap: 8 }
const icons = [PanelLeft, SquareDashed, PanelRight, PanelBottom]
type WorkspaceState = { api?: DockviewApi; active?: string; visible: string[] }
const WorkspaceContext = createContext<WorkspaceState>({ visible: [] })

function ModulePanel({ api }: IDockviewPanelProps) {
  const workspace = useContext(WorkspaceContext)
  const [query, setQuery] = useState('')
  if (api.id === 'module-1') return (
    <section className="module-navigation" aria-label="模块 1 内容" data-testid="module-1">
      <div className="section-heading"><span>工作区模块</span><span className="count">4</span></div>
      <label className="search-field"><Search size={14} /><input aria-label="搜索模块" placeholder="搜索模块…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <div className="module-list">
        {modules.filter((item) => item.title.replaceAll(' ', '').includes(query.replaceAll(' ', ''))).map((item) => {
          const Icon = icons[modules.indexOf(item)]
          const visible = workspace.visible.includes(item.id)
          return <button key={item.id} className={`module-row ${workspace.active === item.id ? 'selected' : ''}`} onClick={() => workspace.api && openModule(workspace.api, item.id)} aria-label={`打开${item.title}`}>
            <ChevronRight size={12} /><Icon size={16} /><span>{item.title}</span><span className={`visibility-dot ${visible ? 'on' : ''}`} title={visible ? '已打开' : '已关闭'} />
          </button>
        })}
        {query && !modules.some((item) => item.title.replaceAll(' ', '').includes(query.replaceAll(' ', ''))) && <p className="search-empty">没有匹配的模块</p>}
      </div>
      <div className="sidebar-note"><PanelsTopLeft size={17} /><strong>你的工作区，自由组合</strong><p>拖动面板标签重新排列。<br />将模块放到顺手的位置。</p></div>
      <div className="panel-footnote"><Circle size={7} fill="currentColor" /> 基础工作区</div>
    </section>
  )
  if (api.id === 'module-2') return (
    <section className="canvas-panel" aria-label="模块 2 内容" data-testid="module-2">
      <div className="canvas-topline"><span>工作区 / 模块 2</span><span>占位画布</span></div>
      <div className="canvas-sheet"><div className="sheet-caption">模块 2</div><SquareDashed size={42} strokeWidth={1} /><h1>从这里开始</h1><p>留给下一步创作的空间</p><span className="canvas-badge">模块 2 · 主工作区</span></div>
      <div className="canvas-tip"><GripVertical size={13} /> 拖动标签移动面板 <span /> 拖动边界调整大小</div>
    </section>
  )
  if (api.id === 'module-3') return <Inspector />
  return (
    <section className="bottom-panel" aria-label="模块 4 内容" data-testid="module-4">
      <div className="bottom-panel-top"><span><PanelBottom size={14} />底部工作区</span><span className="subtle-tag">占位模块</span></div>
      <div className="bottom-empty"><span className="empty-symbol"><PanelBottom size={25} strokeWidth={1.2} /></span><div><h2>模块 4</h2><p>这里可以放置时间线、任务或调试面板</p></div></div>
    </section>
  )
}

function Inspector() {
  const { api, active } = useContext(WorkspaceContext)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const selected = modules.find((item) => item.id === active)
  useEffect(() => {
    const panel = active && api?.getPanel(active)
    if (!panel) return
    let frame = 0
    const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setDimensions({ width: Math.round(panel.api.width), height: Math.round(panel.api.height) })) }
    update()
    const subscription = panel.api.onDidDimensionsChange(update)
    return () => { subscription.dispose(); cancelAnimationFrame(frame) }
  }, [api, active])
  return <section className="inspector" aria-label="模块 3 内容" data-testid="module-3">
    <div className="section-heading"><span>面板信息</span><SlidersHorizontal size={14} /></div>
    <div className="inspector-section"><label>当前模块</label><div className="readonly-field"><LayoutGrid size={14} /><span>{selected?.title ?? '未选择'}</span><span className="accent-dot" /></div>
      <div className="dimension-fields"><div><span>W</span><output>{dimensions.width}</output></div><div><span>H</span><output>{dimensions.height}</output></div></div>
      <p className="field-hint">内容区域尺寸 · px</p></div>
    <div className="inspector-section"><div className="section-heading"><span>布局方式</span></div><div className="layout-preview"><div /><div /><div /><div /></div><p className="field-hint">拖动模块标签可自由分屏或合并。</p></div>
    <div className="inspector-section"><div className="section-heading"><span>交互提示</span></div><div className="instruction"><GripVertical size={15} /><span>拖动标题<span>移动与停靠</span></span></div><div className="instruction"><Move size={15} /><span>拖动分隔线<span>调整面板大小</span></span></div><div className="instruction"><Plus size={15} /><span>窗口菜单<span>重新打开模块</span></span></div></div>
    <div className="panel-footnote">模块 3 · 辅助面板</div>
  </section>
}

function HeaderActions({ api, containerApi }: IDockviewHeaderActionsProps) {
  const [maximized, setMaximized] = useState(api.isMaximized())
  useEffect(() => {
    const subscription = containerApi.onDidMaximizedGroupChange(() => setMaximized(api.isMaximized()))
    return () => subscription.dispose()
  }, [api, containerApi])
  return <button className="icon-button header-action" aria-label={maximized ? '还原面板' : '最大化面板'} title={maximized ? '还原面板' : '最大化面板'} onClick={() => { if (api.isMaximized()) api.exitMaximized(); else api.maximize(); setMaximized(api.isMaximized()) }}>{maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
}

function EmptyWorkspace() {
  const { api } = useContext(WorkspaceContext)
  return <div className="empty-workspace"><PanelsTopLeft size={40} strokeWidth={1} /><h2>留一点空间给新的想法</h2><p>从「窗口」菜单打开模块，或恢复默认布局。</p><button className="primary-button" onClick={() => api && createDefaultLayout(api)}>恢复默认布局</button></div>
}

const components = { module: ModulePanel }

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
    const update = () => setWorkspace({ api, active: api.activePanel?.id, visible: api.panels.map((panel) => panel.id) })
    const subscriptions = [api.onDidAddPanel(update), api.onDidRemovePanel(update), api.onDidActivePanelChange(update)]
    update()
    return () => subscriptions.forEach((item) => item.dispose())
  }, [workspace.api])
  useEffect(() => {
    if (!menuOpen) return
    const close = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [menuOpen])
  useEffect(() => { if (helpOpen) helpRef.current?.showModal(); else helpRef.current?.close() }, [helpOpen])

  const onReady = useCallback(({ api }: DockviewReadyEvent) => {
    createDefaultLayout(api)
    setWorkspace({ api, active: api.activePanel?.id, visible: api.panels.map((panel) => panel.id) })
  }, [])

  return <WorkspaceContext.Provider value={workspace}>
    <div className="workbench">
      <header className="app-header">
        <div className="brand" title="个人工作台"><PanelsTopLeft size={23} strokeWidth={1.4} /></div>
        <div className="project-name"><span>个人工作台</span><strong>我的工作空间</strong></div>
        <div className="menu-anchor" ref={menuRef}><button className={`text-button ${menuOpen ? 'is-active' : ''}`} aria-expanded={menuOpen} aria-controls="window-menu" onClick={() => setMenuOpen(!menuOpen)}>窗口<ChevronDown size={12} /></button>
          {menuOpen && <div className="dropdown-menu" id="window-menu"><div className="menu-title">显示模块</div>{modules.map((module) => <button key={module.id} onClick={() => { if (workspace.api) openModule(workspace.api, module.id); setMenuOpen(false) }}><span>{module.title}</span>{workspace.visible.includes(module.id) ? <Check size={14} /> : <Plus size={14} />}</button>)}<div className="menu-divider" /><button onClick={() => { if (workspace.api) createDefaultLayout(workspace.api); setMenuOpen(false) }}><span>重置布局</span><RotateCcw size={14} /></button></div>}
        </div>
        <div className="header-spacer" />
        <div className="workspace-label"><span className="accent-dot" />本地工作区</div>
        <button className="icon-button" aria-label={colorTheme === 'dark' ? '切换到浅色' : '切换到深色'} title={colorTheme === 'dark' ? '切换到浅色' : '切换到深色'} onClick={() => { const next = colorTheme === 'dark' ? 'light' : 'dark'; applyTheme(next); setColorTheme(next) }}>{colorTheme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
        <button className="icon-button" aria-label="操作帮助" title="操作帮助" onClick={() => setHelpOpen(true)}><HelpCircle size={17} /></button>
        <span className="header-divider" />
        <button className="reset-button" onClick={() => workspace.api && createDefaultLayout(workspace.api)}><RotateCcw size={14} />重置布局</button>
        <div className="avatar" title="个人空间">我</div>
      </header>
      <div className="workspace-toolbar"><span className="workspace-title"><LayoutGrid size={14} />默认工作区</span><span className="toolbar-divider" /><span className="toolbar-hint">把工具放到顺手的位置</span><div className="header-spacer" /><div className="module-shortcuts">{modules.map((module, index) => { const Icon = icons[index]; return <button key={module.id} className={`icon-button ${workspace.active === module.id ? 'is-active' : ''}`} title={`打开${module.title}`} aria-label={`显示${module.title}`} onClick={() => workspace.api && openModule(workspace.api, module.id)}><Icon size={16} /></button> })}</div></div>
      <main className="docking-area" aria-label="可调整的模块工作区"><DockviewReact components={components} onReady={onReady} theme={theme} disableFloatingGroups rightHeaderActionsComponent={HeaderActions} watermarkComponent={EmptyWorkspace} /></main>
      <footer className="statusbar"><span><span className="accent-dot" />就绪</span><span className="status-separator" /><span data-testid="panel-count">{workspace.visible.length} 个模块已打开</span><div className="header-spacer" /><span className="status-hint"><MousePointer2 size={12} />拖动标签排列 · 拖动边界缩放</span><span className="status-separator" /><span>基础框架 v0.1</span></footer>
      <dialog ref={helpRef} className="help-dialog" onCancel={() => setHelpOpen(false)} onClick={(event) => { if (event.target === event.currentTarget) setHelpOpen(false) }}><div className="dialog-heading"><h2>让工作区适合你的习惯</h2><button className="icon-button" aria-label="关闭帮助" onClick={() => setHelpOpen(false)}><X size={18} /></button></div><p>四个模块都是占位面板，你可以先体验布局。</p><dl><dt>移动面板</dt><dd>拖住模块标签，放到高亮区域。</dd><dt>合并标签</dt><dd>将标签拖到另一个面板的标签栏。</dd><dt>调整大小</dt><dd>拖动面板之间的分隔线。</dd><dt>重新打开</dt><dd>点击顶部「窗口」菜单或模块图标。</dd><dt>还原布局</dt><dd>点击右上角「重置布局」。</dd></dl></dialog>
    </div>
  </WorkspaceContext.Provider>
}
