import './connectionSettings.css'
import { useCallback, useEffect, useId, useState } from 'react'
import { Button, Input, Select } from '@fluentui/react-components'
type PublicConnection = {
  id: string
  endpoint: string
  model: string
  owners?: string[]
  configured: boolean
  protocol: string
}
type Row = {
  use: string
  component: string
  purpose: string
  migrationPending?: boolean
  value: PublicConnection | null
}
type Snapshot = { rows: Row[]; choices: PublicConnection[] }
type Edit = { expectedId: string | null } & (
  | { reuse: string }
  | { endpoint: string; model: string; key: string; protocol: string; separate: boolean }
)
declare global {
  interface Window {
    fitbayConnections?: {
      snapshot(): Promise<Snapshot>
      write(use: string, input: Edit): Promise<unknown>
    }
  }
}
function Editor({
  row,
  choices,
  saved,
}: {
  row: Row
  choices: PublicConnection[]
  saved: () => void
}) {
  const prefix = useId()
  const [mode, select] = useState('edit'),
    [endpoint, address] = useState(row.value?.endpoint ?? ''),
    [model, setModel] = useState(row.value?.model ?? ''),
    [key, setKey] = useState(''),
    [protocol, setProtocol] = useState(row.value?.protocol ?? 'chat'),
    [busy, setBusy] = useState(false),
    [message, status] = useState('')
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        try {
          const api = window.fitbayConnections
          if (!api) throw Error()
          const expectedId = row.value?.id ?? null
          await api.write(
            row.use,
            mode.startsWith('ref:')
              ? { expectedId, reuse: mode.slice(4) }
              : { expectedId, endpoint, model, key, protocol, separate: mode === 'private' },
          )
          setKey('')
          saved()
          status('已保存')
        } catch {
          status('保存失败，请检查服务地址、模型和系统凭据保护状态。')
        } finally {
          setBusy(false)
        }
      }}
    >
      <h3>
        {row.component} · {row.purpose}
      </h3>
      <label htmlFor={prefix + '-mode'}>
        连接
        <Select id={prefix + '-mode'} value={mode} onChange={(e) => select(e.target.value)}>
          <option value="edit">{row.value ? '编辑当前连接' : '新建连接'}</option>
          {row.value && <option value="private">单独配置</option>}
          {choices
            .filter((c) => c.id !== row.value?.id)
            .map((c) => (
              <option key={c.id} value={'ref:' + c.id}>
                复用 {c.owners?.join(' / ')} · {c.endpoint} · {c.model}
              </option>
            ))}
        </Select>
      </label>
      {!mode.startsWith('ref:') && (
        <>
          <label htmlFor={prefix + '-endpoint'}>
            服务地址
            <Input
              id={prefix + '-endpoint'}
              required
              value={endpoint}
              onChange={(_, d) => address(d.value)}
            />
          </label>
          <label htmlFor={prefix + '-protocol'}>
            协议
            <Select
              id={prefix + '-protocol'}
              value={protocol}
              onChange={(e) => setProtocol(e.target.value)}
            >
              {Object.entries({
                chat: 'Chat Completions',
                responses: 'OpenAI Responses',
                claude: 'Anthropic Messages',
                gemini: 'Gemini',
              }).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </Select>
          </label>
          <label htmlFor={prefix + '-model'}>
            模型
            <Input
              id={prefix + '-model'}
              required
              value={model}
              onChange={(_, d) => setModel(d.value)}
            />
          </label>
          <label htmlFor={prefix + '-key'}>
            API Key
            <Input
              id={prefix + '-key'}
              type="password"
              autoComplete="new-password"
              placeholder={row.value?.configured ? '••••••••' : ''}
              value={key}
              onChange={(_, d) => setKey(d.value)}
            />
          </label>
        </>
      )}
      <Button type="submit" disabled={busy}>
        保存配置
      </Button>
      <p role="status">{message}</p>
    </form>
  )
}
export function ConnectionSettings() {
  const [data, setData] = useState<Snapshot>(),
    [selection, select] = useState(''),
    [error, setError] = useState('')
  const refresh = useCallback(async () => {
    try {
      if (window.fitbayConnections) {
        const next = await window.fitbayConnections.snapshot()
        setData(next)
        setError('')
      }
    } catch {
      setError('读取连接失败')
    }
  }, [])
  useEffect(() => {
    void refresh()
    const id = setInterval(() => void refresh(), 1000)
    return () => clearInterval(id)
  }, [refresh])
  const row = data?.rows.find((r) => r.use === selection) ?? data?.rows[0]
  return (
    <section className="api-connections">
      <div id="setting-4-0">
        <table>
          <thead>
            <tr>
              {['组件', '用途', '连接', '状态'].map((t) => (
                <th key={t}>{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr key={r.use}>
                <td>{r.component}</td>
                <td>
                  <Button
                    appearance={row?.use === r.use ? 'primary' : 'subtle'}
                    onClick={() => select(r.use)}
                  >
                    {r.purpose}
                  </Button>
                </td>
                <td>{r.value?.endpoint ?? '—'}</td>
                <td>
                  {r.migrationPending
                    ? '请在 Music 中恢复连接'
                    : r.value?.configured ||
                        (r.use.startsWith('toolkit.') &&
                          r.value &&
                          ['127.0.0.1', 'localhost', '[::1]'].includes(
                            new URL(r.value.endpoint).hostname,
                          ))
                      ? '已配置'
                      : '待配置'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p role="alert">{error}</p>}
      {row ? (
        <Editor
          key={row.use + JSON.stringify(row.value)}
          row={row}
          choices={data?.choices ?? []}
          saved={() => void refresh()}
        />
      ) : (
        <p>暂无可配置组件</p>
      )}
    </section>
  )
}
