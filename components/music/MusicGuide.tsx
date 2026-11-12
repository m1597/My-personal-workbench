import { Button } from '@fluentui/react-components'
import { useState } from 'react'
import type { SettingsCategory } from './MusicSettings'
export function MusicGuide({
  script,
  close,
  go,
  recommend,
}: {
  script: string
  close: () => void
  go: (next: SettingsCategory) => void
  recommend: () => void
}) {
  const [step, setStep] = useState(0)
  const [connection, setConnection] = useState(false)
  const titles = ['让 Agent 管理音乐源', '按你的听歌需求推荐', '按需安装音乐插件']
  function visit(action: () => void) {
    close()
    action()
  }
  return (
    <aside className="music-guide" aria-label="Music 使用引导">
      <strong>{titles[step]}</strong>
      <p>
        {
          [
            '打开 Music 后，电脑上的 Agent 可通过 MCP 查看已导入音源、检查能力和切换当前源。',
            '例如「找几首适合雨天散步的民谣」。先配置自己的模型 API 密钥，再到每日推荐生成歌单。',
            '波形试听、标签与封面整理、智能歌单可独立安装。安装后从「扩展」打开。',
          ][step]
        }
      </p>
      {step === 0 && connection && (
        <div>
          本项目的 Codex 已配置 fitbay_music。其他本机客户端用 stdio 启动：
          <code>node "{script}"</code>
        </div>
      )}
      <div className="guide-actions">
        {step === 0 && (
          <>
            <Button size="small" onClick={() => visit(() => go('sources'))}>
              查看音乐源
            </Button>
            <Button size="small" onClick={() => setConnection(!connection)}>
              连接方法
            </Button>
          </>
        )}
        {step === 1 && (
          <>
            <Button size="small" onClick={() => visit(() => go('model'))}>
              配置模型 API
            </Button>
            <Button size="small" onClick={() => visit(recommend)}>
              打开每日推荐
            </Button>
          </>
        )}
        {step === 2 && (
          <Button size="small" onClick={() => visit(() => go('plugins'))}>
            浏览插件
          </Button>
        )}
        {step > 0 && (
          <Button size="small" appearance="subtle" onClick={() => setStep(step - 1)}>
            上一步
          </Button>
        )}
        <Button
          size="small"
          appearance="primary"
          onClick={() => (step === 2 ? close() : setStep(step + 1))}
        >
          {step === 2 ? '完成' : '下一步'}
        </Button>
        {step < 2 && (
          <Button size="small" appearance="subtle" onClick={close}>
            跳过
          </Button>
        )}
      </div>
    </aside>
  )
}
