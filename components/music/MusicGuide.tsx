import { Button, Popover, PopoverSurface } from '@fluentui/react-components'
import { useLayoutEffect, useState } from 'react'
import './guide.css'

export const guideSteps = [
  {
    page: 'library',
    target: 'import',
    title: '把音乐加入曲库',
    text: '在设置的「本地曲库」添加文件或整个文件夹。导入后回到曲库，便可按歌曲或专辑浏览。',
  },
  {
    page: 'songs',
    target: 'library',
    title: '从曲库播放',
    text: '在曲库搜索歌名或艺人，单击歌名或行内留白播放。单击歌手名或专辑名可以查看详情。',
  },
  {
    page: 'playlists',
    target: 'playlists',
    title: '整理自己的歌单',
    text: '打开歌单导航，用「＋」新建歌单，再到歌曲行的歌单菜单添加。按歌单顺序播放时，队列会沿用列表顺序。',
  },
  {
    page: 'sources',
    target: 'sources',
    title: '检查音乐源',
    text: '在线找歌需要可用音源。在音源目录查看并选用音源，也可以从文件或链接导入。',
  },
  {
    page: 'download',
    target: 'online',
    title: '在线找歌',
    text: '输入歌名、艺人或关键词，按回车搜索。打开结果可试听或选择录音版本下载。',
  },
  {
    page: 'download',
    target: 'ai-toggle',
    title: '切换到 AI 推荐',
    text: '点搜索框右边的星光按钮切换模式。普通找歌可直接使用；要让 AI 推荐，再配置自己的模型。',
  },
  {
    page: 'model',
    target: 'model',
    title: '配置可选的模型',
    text: '在这里选择服务商并保存模型 ID 和 API Key。密钥用于模型请求，可随时回到设置修改。',
  },
  {
    page: 'audition',
    target: 'recommend',
    title: '描述想听的音乐',
    text: '写下歌手、曲风或场景，再设定推荐首数。想参考播放器里的歌曲时，点「以当前歌曲为参考」。',
  },
  {
    page: 'audition',
    target: 'weight',
    title: '调节推荐权重',
    text: '有输入时默认本次要求 80%、本地口味 20%。拉到纯要求会忽略口味；留空则使用已授权的口味。',
  },
  {
    page: 'audition',
    target: 'tasks',
    title: '查看推荐与下载进度',
    text: '生成后在顶栏查看下载任务。成功入库的录音会出现在「歌曲推荐」歌单，期间可以继续普通找歌。',
  },
  {
    page: 'feed',
    target: 'artist',
    title: '关注歌手和查看发行',
    text: '输入名字查找并关注歌手。点头像或名字进入主页，播放作品、打开发行，或查看有共同风格标签的歌手。',
  },
  {
    page: 'songs',
    target: 'playback',
    title: '控制播放与歌词',
    text: '播放栏可切换顺序、调节进度。点封面打开歌词页，点「词」可显示桌面歌词。',
  },
  {
    page: 'plugins',
    target: 'plugins',
    title: '安装和管理插件',
    text: '在插件列表查看用途、版本与安装状态。有下载按钮时可直接安装，也可以选择本地插件包。安装后从「扩展」打开。',
  },
  {
    page: 'mcp',
    target: 'mcp',
    title: '把 Music 连到本机 Agent',
    text: '将启动命令复制到支持 stdio 的本机 Agent，并保持 Music 运行。可先让它列出音源；整理文件前，先核对拟移动或重命名的路径。',
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
    const reveal = () =>
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
    reveal()
    // Source discovery can insert platform details above the target after the guide opens.
    const observer = new ResizeObserver(reveal)
    observer.observe(target.closest('section') ?? target)
    target.dataset.guideActive = 'true'
    setAnchor(target)
    return () => {
      observer.disconnect()
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
        position: name === 'model' ? 'above' : 'below',
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
