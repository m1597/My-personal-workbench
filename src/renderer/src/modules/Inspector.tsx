import { useContext, useState, useEffect } from 'react'
import { SlidersHorizontal, LayoutGrid, GripVertical, Move, Plus } from 'lucide-react'
import { WorkspaceContext } from '../app/WorkspaceContext'
import { modules } from '../app/moduleRegistry'
export function Inspector() {
  const { api, active, dimensions: external } = useContext(WorkspaceContext)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const selected = modules.find((item) => item.id === active)
  useEffect(() => {
    const panel = active && api?.getPanel(active)
    if (!panel) return
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() =>
        setDimensions({ width: Math.round(panel.api.width), height: Math.round(panel.api.height) }),
      )
    }
    update()
    const subscription = panel.api.onDidDimensionsChange(update)
    return () => {
      subscription.dispose()
      cancelAnimationFrame(frame)
    }
  }, [api, active])
  return (
    <section className="inspector" aria-label="模块 3 内容" data-testid="module-3">
      <div className="section-heading">
        <span>面板信息</span>
        <SlidersHorizontal size={14} />
      </div>
      <div className="inspector-section">
        <span className="field-label">当前模块</span>
        <div className="readonly-field">
          <LayoutGrid size={14} />
          <span>{selected?.title ?? '未选择'}</span>
          <span className="accent-dot" />
        </div>
        <div className="dimension-fields">
          <div>
            <span>W</span>
            <output>{external?.width ?? dimensions.width}</output>
          </div>
          <div>
            <span>H</span>
            <output>{external?.height ?? dimensions.height}</output>
          </div>
        </div>
        <p className="field-hint">内容区域尺寸 · px</p>
      </div>
      <div className="inspector-section">
        <div className="section-heading">
          <span>布局方式</span>
        </div>
        <div className="layout-preview">
          <div />
          <div />
          <div />
          <div />
        </div>
        <p className="field-hint">拖动模块标签可自由分屏或合并。</p>
      </div>
      <div className="inspector-section">
        <div className="section-heading">
          <span>交互提示</span>
        </div>
        <div className="instruction">
          <GripVertical size={15} />
          <span>
            拖动标题<span>移动与停靠</span>
          </span>
        </div>
        <div className="instruction">
          <Move size={15} />
          <span>
            拖动分隔线<span>调整面板大小</span>
          </span>
        </div>
        <div className="instruction">
          <Plus size={15} />
          <span>
            窗口菜单<span>重新打开模块</span>
          </span>
        </div>
      </div>
      <div className="panel-footnote">模块 3 · 辅助面板</div>
    </section>
  )
}
