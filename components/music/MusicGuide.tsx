import { Button, Popover, PopoverSurface } from '@fluentui/react-components'
import { useLayoutEffect, useState } from 'react'
import './guide.css'

export const guideSteps = [
  {
    page: 'sources',
    target: 'sources',
    title: '导入音乐源',
    text: '从目录选择音源，也可以导入本地文件或链接。',
  },
  {
    page: 'sources',
    target: 'mcp',
    title: '连接你的 Agent',
    text: '按「MCP 连接方法」添加 stdio 服务，便可让 Agent 导入或切换音源。展开该说明还可查看如何授权 Agent 整理本地歌曲。',
  },
  {
    page: 'model',
    target: 'model',
    title: '设置模型 API',
    text: '选择服务商，填写模型 ID 和 API Key 后保存。',
  },
  {
    page: 'audition',
    target: 'recommend',
    title: '写下今天想听什么',
    text: '填歌手名，或写「想听和这首歌风格相似的作品」。留空也可以按已有偏好生成推荐。',
  },
] as const

export function MusicGuide({
  step,
  change,
  close,
}: {
  step: number
  change: (next: number) => void
  close: () => void
}) {
  const item = guideSteps[step]
  const name = item.target
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const target = document.querySelector<HTMLElement>(`[data-guide-anchor="${name}"]`)
    if (!target) return
    target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
    target.dataset.guideActive = 'true'
    setAnchor(target)
    return () => {
      delete target.dataset.guideActive
    }
  }, [name])
  if (!anchor) return null
  const last = step === guideSteps.length - 1
  return (
    <Popover
      open
      inline
      positioning={{
        target: anchor,
        position: name === 'model' || name === 'mcp' ? 'above' : 'below',
        align: 'start',
        strategy: 'fixed',
        offset: 10,
        overflowBoundaryPadding: 10,
        fallbackPositions: ['above-start', 'after', 'before'],
      }}
    >
      <PopoverSurface
        className="music-guide"
        role="complementary"
        aria-label="Music 使用引导"
        onKeyDown={(event) => {
          if (event.key === 'Escape') close()
        }}
      >
        <header>
          <strong>{item.title}</strong>
          <small>
            {step + 1} / {guideSteps.length}
          </small>
        </header>
        <p>{item.text}</p>
        <div className="guide-actions">
          <Button size="small" appearance="subtle" onClick={close}>
            跳过
          </Button>
          {step > 0 && (
            <Button size="small" onClick={() => change(step - 1)}>
              上一步
            </Button>
          )}
          <Button
            size="small"
            appearance="primary"
            onClick={() => (last ? close() : change(step + 1))}
          >
            {last ? '完成' : '下一步'}
          </Button>
        </div>
      </PopoverSurface>
    </Popover>
  )
}
