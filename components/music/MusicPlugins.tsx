import * as React from 'react'
import * as jsx from 'react/jsx-runtime'
import * as reactDOM from 'react-dom'
import { Button, Checkbox, Dropdown, Input, Option, Tab, TabList } from '@fluentui/react-components'
import { useEffect, useState, type ComponentType } from 'react'
import type { LocalTrack } from './LibraryPane'
import './plugins.css'

export type PluginRow = {
  id: string
  title: string
  description: string
  version: string
  bytes: number
  installed: boolean
  outdated: boolean
}
export type PluginProps = {
  tracks: LocalTrack[]
  activeId?: string
  play: (id: string, queue?: string[]) => void
  audio: HTMLAudioElement | null
  refresh: () => Promise<void>
}
declare global {
  interface Window {
    musicPlugins: {
      list(): Promise<PluginRow[]>
      install(id: string): Promise<boolean>
      remove(id: string): Promise<void>
      call<T = unknown>(id: string, action: string, ...args: unknown[]): Promise<T>
      guide(): Promise<{ seen: boolean; script: string }>
      markGuide(): Promise<void>
    }
  }
}
Object.assign(globalThis, {
  FitBayReact: React,
  FitBayJSX: jsx,
  FitBayReactDOM: reactDOM,
  FitBayFluent: { Button, Checkbox, Dropdown, Input, Option },
})

export function PluginSettings({
  rows,
  reload,
  open,
  guide,
}: {
  rows: PluginRow[]
  reload: () => Promise<void>
  open: (id: string) => void
  guide: () => void
}) {
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  async function run(row: PluginRow, method: 'file' | 'remove') {
    setBusy(row.id)
    setMessage('')
    try {
      if (method === 'remove') await window.musicPlugins.remove(row.id)
      else if (!(await window.musicPlugins.install(row.id))) return
      await reload()
      setMessage(
        method === 'remove'
          ? '已卸载，插件资料已保留。'
          : '已安装。可在「扩展」打开' + row.title + '。',
      )
    } catch (e) {
      setMessage(String(e).split('Error: ').pop() || '操作失败')
    } finally {
      setBusy('')
    }
  }
  return (
    <section>
      <h2>插件</h2>
      {rows.map((row) => (
        <article className="music-plugin-row" key={row.id}>
          <div>
            <strong>{row.title}</strong>
            <p>{row.description}</p>
            <small>
              {row.bytes >= 1048576
                ? (row.bytes / 1048576).toFixed(2) + ' MiB'
                : Math.ceil(row.bytes / 1024) + ' KiB'}{' '}
              · {row.installed ? '已安装' : row.outdated ? '有新版本' : '未安装'}
            </small>
          </div>
          <div className="settings-buttons">
            {row.installed ? (
              <>
                <Button data-guide-anchor="installed-plugin" onClick={() => open(row.id)}>
                  打开
                </Button>
                <Button disabled={!!busy} onClick={() => void run(row, 'remove')}>
                  卸载
                </Button>
              </>
            ) : (
              <>
                <Button
                  data-guide-anchor="plugin"
                  appearance="primary"
                  disabled={!!busy}
                  onClick={() => void run(row, 'file')}
                >
                  {row.outdated ? '选择新版插件文件' : '选择插件文件'}
                </Button>
                {row.outdated && (
                  <Button disabled={!!busy} onClick={() => void run(row, 'remove')}>
                    卸载旧版
                  </Button>
                )}
              </>
            )}
          </div>
        </article>
      ))}
      {busy && <p role="status">正在处理安装包…</p>}
      {message && <p role="status">{message}</p>}
      <Button appearance="subtle" onClick={guide}>
        重新查看使用引导
      </Button>
    </section>
  )
}
export function PluginPage({
  rows,
  selected,
  select,
  ...props
}: PluginProps & { rows: PluginRow[]; selected: string; select: (id: string) => void }) {
  const active = rows.find((r) => r.id === selected && r.installed) ?? rows.find((r) => r.installed)
  const [loaded, setLoaded] = useState<{ id: string; Panel: ComponentType<PluginProps> }>()
  const [error, setError] = useState('')
  const id = active?.id
  useEffect(() => {
    setError('')
    setLoaded(undefined)
    if (!id) return
    let alive = true
    const css = document.createElement('link')
    css.rel = 'stylesheet'
    css.href = 'fitbay-plugin://' + id + '/panel.css'
    const js = document.createElement('script')
    js.src = 'fitbay-plugin://' + id + '/panel.js'
    js.onload = () => {
      const Panel = Reflect.get(globalThis, 'FitBayPlugin_' + id)
      if (alive && typeof Panel === 'function') setLoaded({ id, Panel })
      else if (alive) setError('插件入口无效，请重新安装')
    }
    js.onerror = () => alive && setError('插件未能加载，请重新安装')
    document.head.append(css, js)
    return () => {
      alive = false
      css.remove()
      js.remove()
      Reflect.deleteProperty(globalThis, 'FitBayPlugin_' + id)
    }
  }, [id])
  return (
    <section className="music-extensions">
      <TabList
        size="small"
        aria-label="已安装插件"
        selectedValue={id}
        onTabSelect={(_, d) => select(String(d.value))}
      >
        {rows
          .filter((r) => r.installed)
          .map((r) => (
            <Tab value={r.id} key={r.id}>
              {r.title}
            </Tab>
          ))}
      </TabList>
      {error && <p role="alert">{error}</p>}
      {loaded?.id === id && loaded && <loaded.Panel {...props} />}
    </section>
  )
}
