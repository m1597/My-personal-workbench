import { Button, Switch } from '@fluentui/react-components'
import { useEffect, useState } from 'react'

type Agent = { id: string; name: string; enabled: boolean; connected: boolean }
const api = window.music as typeof window.music & {
  mcpAgents(): Promise<Agent[]>
  setMcpAgent(id: string, enable: boolean): Promise<void>
}

export function MusicMcpSettings({ script }: { script: string }) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [busy, setBusy] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const [message, setMessage] = useState('')
  const [failure, setFailure] = useState('')
  useEffect(() => {
    let alive = true
    const refresh = () =>
      api
        .mcpAgents()
        .then((rows) => {
          if (alive) setAgents(rows)
        })
        .catch(() => {
          if (alive) setMessage('无法检测本机 Agent')
        })
    void refresh()
    const timer = setInterval(refresh, 3000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])
  async function change(id: string, enabled: boolean) {
    setBusy(true)
    setFailure('')
    try {
      await api.setMcpAgent(id, enabled)
      setAgents(await api.mcpAgents())
      setChoosing(false)
      setMessage(enabled ? '配置已写入，请重启所选 Agent 以连接 Music。' : '已关闭连接配置。')
    } catch (error) {
      setFailure(
        String(error)
          .replace(/^.*?Error: (?=[^:]+$)/, '')
          .trim(),
      )
    } finally {
      setBusy(false)
    }
  }
  const enabled = agents.find((agent) => agent.enabled)
  return (
    <section className="music-mcp-connection">
      <h2>外部 Agent 连接（可选）</h2>
      <Switch
        data-guide-anchor="mcp"
        label="允许本机 Agent 连接 Music"
        checked={Boolean(enabled)}
        disabled={busy || !agents.length}
        onChange={(_, data) => {
          if (enabled) void change(enabled.id, false)
          else if (data.checked && agents.length === 1) void change(agents[0].id, true)
          else setChoosing(true)
        }}
      />
      {choosing && (
        <fieldset>
          <legend>选择要配置的 Agent</legend>
          {agents.map((agent) => (
            <Button key={agent.id} disabled={busy} onClick={() => void change(agent.id, true)}>
              {agent.name}
            </Button>
          ))}
          <Button appearance="subtle" disabled={busy} onClick={() => setChoosing(false)}>
            取消
          </Button>
        </fieldset>
      )}
      <p role="status">
        {enabled
          ? enabled.name + (enabled.connected ? ' · 已连接' : ' · 配置已写入，需重启 Agent')
          : (message ? message + ' ' : '') +
            (agents.length
              ? '已检测到 ' + agents.map((a) => a.name).join('、')
              : '未检测到可自动配置的 Agent。')}
      </p>
      {failure && <p role="alert">{failure}</p>}
      <details>
        <summary>手动配置其他 Agent</summary>
        <code>node "{script}"</code>
        <Button
          size="small"
          disabled={!script}
          onClick={async () => {
            try {
              await api.copyMcpCommand()
              setMessage('已复制启动命令')
            } catch {
              setMessage('复制失败，请手动复制命令')
            }
          }}
        >
          复制启动命令
        </Button>
      </details>
      <h3>可以这样问 Agent</h3>
      <p>保持 Music 运行，在已连接的 Agent 对话中使用以下请求。</p>
      <ul>
        <li>从最近播放找出上一首，把它加入我指定的「通勤」歌单。先告诉我歌名和歌手。</li>
        <li>
          结合这段对话里的视频脚本，按镜头顺序从我的本地曲库选曲，创建「视频初剪」试听歌单，并说明每段的选曲理由。
        </li>
        <li>
          比较「通勤」与「视频初剪」两个歌单，按第一个歌单的顺序列出共有的录音，包括在线引用。
        </li>
      </ul>
      <p>
        Agent
        可读取曲目资料、最近播放和歌单，添加或新建歌单，也可查询及管理音源。这些任务无需授予音乐文件夹权限。
      </p>
    </section>
  )
}
