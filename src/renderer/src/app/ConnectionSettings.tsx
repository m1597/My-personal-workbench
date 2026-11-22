import './connectionSettings.css'
import { useCallback, useEffect, useId, useState } from 'react'
import { ChoiceDropdown } from './SharedDropdown'
import { Button, Input, Checkbox } from '@fluentui/react-components'
type PublicConnection = {
  id: string
  endpoint: string
  model: string
  owners?: string[]
  source?: string
  vision?: boolean
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
  | { inherit: true }
  | { reuse: string; vision?: boolean }
  | {
      endpoint: string
      model: string
      key: string
      protocol: string
      separate: boolean
      vision?: boolean
    }
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
  defaultId,
  saved,
}: {
  row: Row
  choices: PublicConnection[]
  defaultId: string | null
  saved: () => void
}) {
  const prefix = useId()
  const [mode, select] = useState('edit'),
    [endpoint, address] = useState(row.value?.endpoint ?? ''),
    [vision, setVision] = useState(row.value?.vision ?? false),
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
              ? {
                  expectedId,
                  reuse: mode.slice(4),
                  vision: row.use === 'default' ? vision : undefined,
                }
              : {
                  expectedId,
                  endpoint,
                  model,
                  key,
                  protocol,
                  separate: mode === 'private',
                  vision: row.use === 'default' ? vision : undefined,
                },
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
        <ChoiceDropdown
          id={prefix + '-mode'}
          aria-label="连接"
          value={mode}
          onChange={select}
          choices={[
            { value: 'edit', label: row.value ? '编辑当前连接' : '新建连接' },
            ...(row.value ? [{ value: 'private', label: '单独配置' }] : []),
            ...choices
              .filter((c) => c.id !== row.value?.id && (row.use !== 'toolkit.vision' || c.vision))
              .map((c) => ({
                value: 'ref:' + c.id,
                label: '复用 ' + c.owners?.join(' / ') + ' · ' + c.endpoint + ' · ' + c.model,
              })),
          ]}
        />
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
            <ChoiceDropdown
              id={prefix + '-protocol'}
              aria-label="协议"
              value={protocol}
              onChange={setProtocol}
              choices={Object.entries({
                chat: 'Chat Completions',
                responses: 'OpenAI Responses',
                claude: 'Anthropic Messages',
                gemini: 'Gemini',
              }).map(([value, label]) => ({ value, label }))}
            />
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
      {row.use === 'default' && (
        <Checkbox
          label="此连接支持视觉输入"
          checked={vision}
          onChange={(_, d) => setVision(d.checked === true)}
        />
      )}
      {row.use !== 'default' && row.value && (
        <>
          <Button
            disabled={busy || row.value.source === 'default'}
            onClick={async () => {
              if (!row.value) return
              setBusy(true)
              try {
                await window.fitbayConnections?.write(row.use, {
                  expectedId: row.value.id,
                  inherit: true,
                })
                saved()
              } catch {
                status('恢复默认失败，请重试')
              } finally {
                setBusy(false)
              }
            }}
          >
            恢复默认连接
          </Button>
          <Button
            disabled={busy || row.value.source === 'default'}
            onClick={async () => {
              if (!row.value) return
              setBusy(true)
              try {
                await window.fitbayConnections?.write('default', {
                  reuse: row.value.id,
                  expectedId: defaultId,
                  vision: row.use === 'toolkit.vision' || row.value?.vision,
                })
                saved()
              } catch {
                status('设置默认连接失败，请重试')
              } finally {
                setBusy(false)
              }
            }}
          >
            设为默认连接
          </Button>
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
                <td>
                  {r.value?.endpoint ?? '—'}
                  {r.value && r.use !== 'default' && (
                    <small> · {r.value.source === 'default' ? '继承默认' : '专用连接'}</small>
                  )}
                  {!r.value && r.use === 'toolkit.vision' && <small>需要支持视觉的连接</small>}
                </td>
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
          defaultId={data?.rows.find((r) => r.use === 'default')?.value?.id ?? null}
          choices={data?.choices ?? []}
          saved={() => void refresh()}
        />
      ) : (
        <p>暂无可配置组件</p>
      )}
    </section>
  )
}
