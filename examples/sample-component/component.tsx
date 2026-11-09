import { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button, Field, FluentProvider, Input, Select } from '@fluentui/react-components'
import { AppWindow, ArrowUpRight, PanelLeft, Plus } from 'lucide-react'
import { fluentTheme } from '../../src/renderer/src/app/fluentTheme'
import '../../src/renderer/src/styles/tokens.css'
import './style.css'

type State = { mode: string; theme: 'dark' | 'light'; sessionId: string }
declare global {
  interface Window {
    sampleHost: {
      hello(value: { protocol: string }): Promise<State>
      subscribe(callback: (state: State) => void): () => void
      transfer(action: 'attach' | 'detach'): Promise<{ ok: boolean; error?: string }>
    }
  }
}
document.body.dataset.bootId = crypto.randomUUID()
if (new URLSearchParams(location.search).get('nativeBackdrop') === 'acrylic')
  document.documentElement.dataset.material = 'acrylic'
const start = performance.now()
function Sample() {
  const [state, setState] = useState<State>({ mode: 'standalone', theme: 'dark', sessionId: '' })
  const [count, setCount] = useState(0)
  const [note, setNote] = useState('')
  const [queue, setQueue] = useState('示例 A')
  const [elapsed, setElapsed] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const theme = useMemo(() => fluentTheme(state.theme), [state.theme])
  const docked = state.mode === 'docked'
  useEffect(() => {
    const update = (value: State) => {
      document.documentElement.dataset.theme = value.theme
      setState(value)
    }
    const off = window.sampleHost.subscribe(update)
    void window.sampleHost.hello({ protocol: '0.1' }).then(update)
    const timer = setInterval(
      () => setElapsed(Math.floor((performance.now() - start) / 1000)),
      1000,
    )
    return () => {
      off()
      clearInterval(timer)
    }
  }, [])
  const transfer = async () => {
    setBusy(true)
    try {
      const result = await window.sampleHost.transfer(docked ? 'detach' : 'attach')
      setError(result.error ?? '')
    } catch {
      setError('连接失败，请重新尝试。')
    } finally {
      setBusy(false)
    }
  }
  return (
    <FluentProvider theme={theme} className="sample-shell">
      <header className="sample-header">
        <div className="sample-symbol">
          <AppWindow size={22} />
        </div>
        <div>
          <h1>示例组件</h1>
          <span id="mode" className="sample-status">
            {docked ? '已停靠' : '独立窗口'}
          </span>
        </div>
        <Button
          appearance="subtle"
          icon={docked ? <ArrowUpRight size={16} /> : <PanelLeft size={16} />}
          disabled={busy}
          onClick={transfer}
        >
          {docked ? '分离窗口' : '加入工作台'}
        </Button>
      </header>
      <main className="sample-content">
        <h2>工作状态</h2>
        <p className="sample-description">在窗口与工作台之间切换，继续刚才的操作。</p>
        <section className="sample-fields" aria-label="示例状态">
          <Field label="保留输入">
            <Input
              id="note"
              value={note}
              onChange={(_, data) => setNote(data.value)}
              placeholder="输入一些文字，试试拖入与分离"
            />
          </Field>
          <Field label="队列选择">
            <Select id="queue" value={queue} onChange={(_, data) => setQueue(data.value)}>
              <option>示例 A</option>
              <option>示例 B</option>
              <option>示例 C</option>
            </Select>
          </Field>
          <div className="sample-counter">
            <div>
              <span>计数</span>
              <output id="count">{count}</output>
            </div>
            <Button icon={<Plus size={16} />} onClick={() => setCount(count + 1)}>
              增加
            </Button>
          </div>
        </section>
        <p id="error" role="status" className="sample-error">
          {error}
        </p>
        <p className="sample-hint">
          {docked
            ? '拖住面板顶部的手柄，移出工作区即可分离。'
            : '拖动系统标题栏到工作台模块区域，松开即可停靠。'}
        </p>
      </main>
      <footer className="sample-footer">
        <span>
          已运行 <output id="elapsed">{elapsed}</output> 秒
        </span>
        <span>状态验证示例 · 不含播放器</span>
      </footer>
      <details className="sample-details">
        <summary>连接信息</summary>
        <p id="session">会话 {state.sessionId}</p>
      </details>
    </FluentProvider>
  )
}
const root = document.getElementById('root')
if (root) createRoot(root).render(<Sample />)
