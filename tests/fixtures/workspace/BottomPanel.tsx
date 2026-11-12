import { PanelBottom } from 'lucide-react'
export function BottomPanel() {
  return (
    <section className="bottom-panel" aria-label="模块 4 内容" data-testid="module-4">
      <div className="bottom-panel-top">
        <span>
          <PanelBottom size={14} />
          底部工作区
        </span>
        <span className="subtle-tag">占位模块</span>
      </div>
      <div className="bottom-empty">
        <span className="empty-symbol">
          <PanelBottom size={25} strokeWidth={1.2} />
        </span>
        <div>
          <h2>模块 4</h2>
          <p>这里可以放置时间线、任务或调试面板</p>
        </div>
      </div>
    </section>
  )
}
