import { SquareDashed, GripVertical } from 'lucide-react'
export function CanvasPanel() {
  return (
    <section className="canvas-panel" aria-label="模块 2 内容" data-testid="module-2">
      <div className="canvas-topline">
        <span>工作区 / 模块 2</span>
        <span>占位画布</span>
      </div>
      <div className="canvas-sheet">
        <div className="sheet-caption">模块 2</div>
        <SquareDashed size={42} strokeWidth={1} />
        <h1>从这里开始</h1>
        <p>留给下一步创作的空间</p>
        <span className="canvas-badge">模块 2 · 主工作区</span>
      </div>
      <div className="canvas-tip">
        <GripVertical size={13} /> 拖动标签移动面板 <span /> 拖动边界调整大小
      </div>
    </section>
  )
}
