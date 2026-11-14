import { useEffect, useState } from 'react'
import { Button, Checkbox, Dropdown, Field, Input, Option } from '@fluentui/react-components'

type CatalogEntry = { id: string; name: string }
type Installed = CatalogEntry & {
  origin: string | null
  disabled?: string
  origins: string[]
  platform: string
  searchPlatforms?: string[]
  platformDetails?: { platform: string; search: string; quality: string[] }[]
  search: string
  musicUrl: boolean
  quality: string[]
  permanentSave: boolean | null
}
export type SourceInventory = {
  configuration: string
  catalog: CatalogEntry[]
  installed: Installed[]
  active: string | null
}

export function MusicSourcesSettings() {
  const host = window.music
  const [data, setData] = useState<SourceInventory>()
  const [online, setOnline] = useState(false)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const active = data?.installed.find((item) => item.id === data.active)
  useEffect(() => {
    let mounted = true
    const refresh = () =>
      void host
        .lxSources()
        .then((value) => {
          if (mounted) setData(value)
        })
        .catch((e) => {
          if (mounted) setStatus(String(e))
        })
    refresh()
    const unsubscribe = host.onSourcesChanged(refresh)
    window.addEventListener('focus', refresh)
    return () => {
      mounted = false
      unsubscribe()
      window.removeEventListener('focus', refresh)
      void host.lxCancel('import').catch(() => {})
    }
  }, [])
  async function run(fn: () => Promise<string> | Promise<void>) {
    setBusy(true)
    setStatus('')
    try {
      const message = await fn()
      setData(await host.lxSources())
      setStatus(message || '')
    } catch (e) {
      setStatus(String(e).split('Error: ').pop() || '操作失败')
    } finally {
      setBusy(false)
    }
  }
  async function direct(url?: string) {
    await run(async () => {
      await host.lxImport(url)
      setOnline(false)
      setLink('')
    })
  }
  return (
    <section className="music-source-settings">
      <h2>音乐源</h2>
      {data?.installed.length ? (
        <Field label="当前音乐源">
          <Dropdown
            inlinePopup
            listbox={{ className: 'component-popup' }}
            value={active?.name || '选择已导入的源'}
            selectedOptions={data.active ? [data.active] : []}
            disabled={busy}
            onOptionSelect={(_, d) => {
              const id = d.optionValue
              if (id) void run(() => host.lxSelectSource(id))
            }}
          >
            {data.installed.map((item) => (
              <Option key={item.id} value={item.id} text={item.name} disabled={!!item.disabled}>
                {item.name}
                {item.disabled ? '（已停用：' + item.disabled + '）' : ''}
              </Option>
            ))}
          </Dropdown>
        </Field>
      ) : (
        <span>尚未导入音乐源</span>
      )}
      {active && (
        <p>
          {(active.platformDetails?.length ? active.platformDetails : [active]).map((p) => (
            <span key={p.platform}>
              {(
                {
                  wy: '网易云音乐',
                  tx: 'QQ 音乐',
                  kg: '酷狗音乐',
                  kw: '酷我音乐',
                  mg: '咪咕音乐',
                } as Record<string, string>
              )[p.platform] ?? p.platform}{' '}
              · {p.search === 'source' ? '源内搜索' : '平台目录搜索'} · {p.quality.join(' / ')}
              <br />
            </span>
          ))}
          {active.permanentSave === true
            ? '声明允许永久保存'
            : active.permanentSave === false
              ? '声明禁止永久保存'
              : '未声明永久保存权限'}
        </p>
      )}
      <div className="settings-buttons">
        <Button size="small" disabled={busy} onClick={() => void direct()}>
          本地导入
        </Button>
        <Button
          size="small"
          disabled={busy}
          aria-expanded={online}
          onClick={() => setOnline(!online)}
        >
          在线导入
        </Button>
        <Button
          size="small"
          data-guide-anchor="sources"
          aria-expanded={catalogOpen}
          onClick={() => setCatalogOpen(!catalogOpen)}
        >
          音源目录
        </Button>
        {busy && (
          <Button size="small" onClick={() => void host.lxCancel('import')}>
            取消音源导入
          </Button>
        )}
      </div>
      {online && (
        <form
          className="settings-buttons"
          onSubmit={(e) => {
            e.preventDefault()
            void direct(link.trim())
          }}
        >
          <Input
            aria-label="音乐源链接"
            value={link}
            placeholder="音乐源 JS 直链"
            onChange={(_, d) => setLink(d.value)}
          />
          <Button type="submit" disabled={busy || !link.trim()}>
            导入链接
          </Button>
        </form>
      )}
      {catalogOpen && (
        <fieldset>
          <legend>pdone / lx-music-source</legend>
          <div className="source-options">
            {data?.catalog.map((entry) => {
              const installed = data.installed.some((item) => item.origins.includes(entry.id))
              return (
                <Checkbox
                  key={entry.id}
                  label={entry.name + (installed ? '（已导入）' : '')}
                  disabled={busy || installed}
                  checked={selected.includes(entry.id)}
                  onChange={(_, d) =>
                    setSelected((ids) =>
                      d.checked ? [...ids, entry.id] : ids.filter((id) => id !== entry.id),
                    )
                  }
                />
              )
            })}
          </div>
          <div className="settings-buttons">
            <Button
              size="small"
              appearance="primary"
              disabled={busy || !selected.length}
              onClick={() =>
                void run(async () => {
                  const result = await host.lxImportSelected(selected)
                  const failed = result.filter((item) => item.error)
                  setSelected(failed.map((item) => item.origin))
                  return [
                    '已导入 ' + (result.length - failed.length) + ' 个源',
                    ...failed.map((item) => item.origin + '：' + item.error),
                  ].join(' · ')
                })
              }
            >
              导入所选
            </Button>
            <Button
              size="small"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await host.lxRefreshCatalog()
                  return '目录已更新'
                })
              }
            >
              刷新目录
            </Button>
          </div>
        </fieldset>
      )}
      {status && <span role="status">{status}</span>}
    </section>
  )
}
