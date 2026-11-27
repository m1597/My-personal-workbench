import { ChoiceDropdown } from '../../src/renderer/src/app/SharedDropdown'
import { useCallback, useEffect, useState } from 'react'

type Connection = {
  source?: 'default' | 'dedicated'
  id: string
  endpoint: string
  model: string
  protocol: string
  authType?: 'subscription'
  configured: boolean
}
type Snapshot = {
  own: Connection | null
  globalDefault: Connection | null
  reused: boolean
  choices: (Connection & { owners: string })[]
  text: Connection | null
  image: Connection | null
}
type Edit =
  | { mode: 'inherit'; expectedId: string | null }
  | { mode: 'own'; endpoint: string; key?: string; model: string; protocol: string }
  | { mode: 'reuse'; connectionId: string }
declare global {
  interface Window {
    promptConnections: {
      snapshot(): Promise<Snapshot>
      save(value: Edit): Promise<void>
      subscribe(callback: () => void): () => void
    }
  }
}
function useConnections() {
  const [state, setState] = useState<Snapshot>(),
    [failed, setFailed] = useState(false),
    [version, change] = useState(0)
  const refresh = useCallback(() => change((v) => v + 1), [])
  useEffect(() => window.promptConnections.subscribe(refresh), [refresh])
  // biome-ignore lint/correctness/useExhaustiveDependencies: each database notification invalidates the snapshot.
  useEffect(() => {
    let valid = true
    window.promptConnections
      .snapshot()
      .then((value) => {
        if (valid) {
          setState(value)
          setFailed(false)
        }
      })
      .catch(() => {
        if (valid) setFailed(true)
      })
    return () => {
      valid = false
    }
  }, [version])
  return { state, failed, refresh }
}
function status(binding: Connection) {
  if (binding.authType === 'subscription')
    return binding.configured ? 'ChatGPT 订阅已授权' : 'ChatGPT 订阅待授权或选择模型'
  return binding.configured ? '已设置密钥' : '未设置密钥'
}
function Retry({ refresh }: { refresh: () => void }) {
  return (
    <p>
      连接状态暂不可用。
      <button type="button" onClick={refresh}>
        重试
      </button>
    </p>
  )
}
export function ActionConnection({ kind }: { kind: 'image' | 'text' }) {
  const { state, failed, refresh } = useConnections()
  const binding = state?.[kind]
  return (
    <div className="action-connection">
      <strong>执行连接 · 工具集 / {kind === 'image' ? '视觉模型' : '翻译与文本模型'}</strong>
      {failed ? (
        <Retry refresh={refresh} />
      ) : (
        <small>
          {!state
            ? '正在读取连接…'
            : binding
              ? [
                  binding.source === 'default' ? '全局默认' : '专用连接',
                  binding.endpoint,
                  binding.model,
                  status(binding),
                ].join(' · ')
              : '尚未配置，可先固定动作'}
        </small>
      )}
    </div>
  )
}
export function PromptConnectionSettings() {
  const { state, failed, refresh } = useConnections()
  const [notice, say] = useState('')
  return (
    <section aria-label="提示词库连接">
      <h2>提示词库连接</h2>
      {failed ? (
        <Retry refresh={refresh} />
      ) : state ? (
        <ConnectionForm
          key={JSON.stringify([state.own, state.reused])}
          say={say}
          state={state}
          refresh={refresh}
        />
      ) : (
        <p>正在读取连接…</p>
      )}
      <small role="status">{notice}</small>
    </section>
  )
}
function ConnectionForm({
  state,
  refresh,
  say,
}: {
  state: Snapshot
  refresh: () => void
  say: (message: string) => void
}) {
  const { own, choices } = state
  const [source, setSource] = useState(
    !own || own.source === 'default' ? 'inherit' : state.reused ? own.id : '',
  )
  const [endpoint, setEndpoint] = useState(own?.endpoint || '')
  const [model, setModel] = useState(own?.model || ''),
    [key, setKey] = useState(''),
    [busy, setBusy] = useState(false)
  const [protocol, setProtocol] = useState(own?.protocol || 'chat')
  const connection =
    source === 'inherit' ? state.globalDefault : choices.find((c) => c.id === source)
  async function save() {
    setBusy(true)
    say('')
    try {
      if (source === 'inherit')
        await window.promptConnections.save({ mode: 'inherit', expectedId: own?.id || null })
      else if (source) await window.promptConnections.save({ mode: 'reuse', connectionId: source })
      else
        await window.promptConnections.save({
          mode: 'own',
          endpoint: endpoint.trim(),
          model: model.trim(),
          protocol,
          ...(key ? { key } : {}),
        })
      setKey('')
      say('已保存')
      refresh()
    } catch {
      say('保存失败，请检查地址、模型和连接是否仍然可用。')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <p>{own ? status(own) : '尚未配置'} · 本地浏览、编辑、搜索和插入可直接使用。</p>
      <label htmlFor="prompt-source">
        连接来源
        <ChoiceDropdown
          id="prompt-source"
          aria-label="连接来源"
          disabled={busy}
          value={source}
          choices={[
            { value: 'inherit', label: '全局默认' },
            { value: '', label: '单独配置' },
            ...choices.map((c) => ({ value: c.id, label: '复用 · ' + c.owners + ' · ' + c.model })),
          ]}
          onChange={(v) => {
            setSource(v)
            setKey('')
            say('')
          }}
        />
      </label>
      <label>
        服务地址
        <input
          type="url"
          required
          readOnly={!!source}
          disabled={busy}
          value={source ? connection?.endpoint || '' : endpoint}
          onChange={(e) => {
            setEndpoint(e.target.value)
            setKey('')
          }}
        />
      </label>
      {connection?.authType !== 'subscription' && (
        <label>
          API Key
          <input
            type="password"
            autoComplete="off"
            disabled={busy || !!source}
            value={key}
            placeholder={
              (source ? connection?.configured : endpoint === own?.endpoint && own?.configured)
                ? '已设置 · 密钥已遮盖'
                : '尚未设置'
            }
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
      )}
      {connection?.authType !== 'subscription' && (
        <label htmlFor="prompt-protocol">
          协议
          <ChoiceDropdown
            id="prompt-protocol"
            aria-label="协议"
            disabled={busy || !!source}
            value={(source ? connection?.protocol : protocol) || 'chat'}
            onChange={setProtocol}
            choices={[
              { value: 'chat', label: 'Chat Completions' },
              { value: 'responses', label: 'Responses' },
              { value: 'claude', label: 'Anthropic Messages' },
              { value: 'gemini', label: 'Gemini' },
            ]}
          />
        </label>
      )}
      <label>
        适用模型
        <input
          required
          readOnly={!!source}
          disabled={busy}
          value={source ? connection?.model || '' : model}
          onChange={(e) => setModel(e.target.value)}
        />
      </label>
      <button type="submit" disabled={busy || (!!source && source !== 'inherit' && !connection)}>
        保存连接
      </button>
    </form>
  )
}
