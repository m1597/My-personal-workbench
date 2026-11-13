import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Input,
  Dropdown,
  Option,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
  Tab,
  TabList,
} from '@fluentui/react-components'
import type { Playlist } from './LibraryPane'
export type Versions = {
  items: {
    key: string
    title: string
    artist: string
    album: string
    quality?: string[]
  }[]
  quality: string[]
  partial?: boolean
}
export function DownloadPane({
  playlists,
  onPlay,
  onAdd,
  refresh,
  preferredQuality = '320k',
}: {
  playlists: Playlist[]
  onPlay: (key: string, quality: string) => Promise<void>
  onAdd: (playlist: string, key: string) => Promise<void>
  refresh: () => Promise<void>
  preferredQuality?: string
}) {
  const [name, setName] = useState(''),
    [result, setResult] = useState<Versions>(),
    [quality, setQuality] = useState(''),
    [status, setStatus] = useState(''),
    [operation, setOperation] = useState<'idle' | 'cancellable' | 'pending'>('idle')
  const busy = operation !== 'idle'
  const [query, setQuery] = useState('')
  const [platform, setPlatform] = useState('wy')
  const [available, setAvailable] = useState<string[]>()
  const platforms = { wy: '网易云音乐', tx: 'QQ 音乐', kg: '酷狗音乐' }
  const unsupported = available && !available.includes(platform)
  const hasQuery = Boolean(query.trim())
  const host = window.music
  const live = useRef(true)
  async function act(fn: () => Promise<void>, cancellable = true) {
    setOperation(cancellable ? 'cancellable' : 'pending')
    setStatus('')
    try {
      await fn()
    } catch (e) {
      if (live.current) setStatus(String(e).split('Error: ').pop() || '操作失败')
    } finally {
      if (live.current) setOperation('idle')
    }
  }
  async function search(target = platform) {
    setResult(undefined)
    const found = await host.lxSearch({ title: query.trim(), artist: '' }, target)
    if (!live.current) return
    setResult(found)
    setQuality(found.quality.includes(preferredQuality) ? preferredQuality : found.quality[0])
    if (!found.items.length) setStatus('没有找到匹配版本')
  }
  useEffect(() => {
    live.current = true
    const load = () =>
      void host
        .lxSources()
        .then((data) => {
          if (!live.current) return
          const active = data.installed.find((entry) => entry.id === data.active)
          setName(active?.name ?? '')
          setAvailable(active?.searchPlatforms)
          setResult(undefined)
          setStatus('')
        })
        .catch(() => {
          if (live.current) setStatus('无法读取音乐源')
        })
    load()
    const unsubscribe = host.onSourcesChanged(load)
    return () => {
      live.current = false
      unsubscribe()
      void host.lxCancel().catch(() => {})
    }
  }, [])
  return (
    <section className="lx-panel" aria-label="搜索音乐">
      <TabList
        size="small"
        aria-label="搜索平台"
        selectedValue={platform}
        onTabSelect={(_, data) => {
          const next = String(data.value)
          if (next === platform || busy) return
          setPlatform(next)
          setResult(undefined)
          setStatus('')
          if (name && hasQuery && (!available || available.includes(next)))
            void act(() => search(next))
        }}
      >
        <Tab value="wy" disabled={busy}>
          网易云音乐
        </Tab>
        <Tab value="tx" disabled={busy}>
          QQ 音乐
        </Tab>
        <Tab value="kg" disabled={busy}>
          酷狗音乐
        </Tab>
      </TabList>
      {!name && <p>请先到「设置」导入音乐源。</p>}
      {unsupported && (
        <p role="status">
          当前音乐源不支持{platforms[platform as keyof typeof platforms]}
          的搜索和下载，请更换音乐源。
        </p>
      )}
      <form
        className="download-search"
        onSubmit={(e) => {
          e.preventDefault()
          if (!busy && name && hasQuery && !unsupported) void act(() => search())
        }}
      >
        <Input
          aria-label="搜索关键词"
          placeholder="输入歌名、艺人或关键词"
          value={query}
          maxLength={256}
          disabled={busy}
          onChange={(_, data) => {
            setQuery(data.value)
            setResult(undefined)
            setStatus('')
          }}
        />
        <Button
          type="submit"
          appearance="primary"
          disabled={!name || !hasQuery || busy || unsupported}
        >
          搜索
        </Button>
      </form>
      {busy ? (
        <div role="status">
          正在处理…{' '}
          {operation === 'cancellable' && (
            <Button size="small" onClick={() => void host.lxCancel()}>
              取消
            </Button>
          )}
        </div>
      ) : null}
      {result && result.items.length > 0 && (
        <>
          <label htmlFor="lx-quality">
            音质{' '}
            <Dropdown
              inlinePopup
              listbox={{ className: 'component-popup' }}
              id="lx-quality"
              size="small"
              value={quality}
              selectedOptions={[quality]}
              onOptionSelect={(_, data) => {
                if (data.optionValue) setQuality(data.optionValue)
              }}
            >
              {result.quality.map((q) => (
                <Option key={q} value={q}>
                  {q}
                </Option>
              ))}
            </Dropdown>
          </label>
          <small>
            {result.items.length} 个版本
            {result.partial && ' · 后续结果暂时不可用'}
          </small>
          <ul>
            {result.items.map((item) => (
              <li key={item.key}>
                <div>
                  <strong>{item.title}</strong>
                  <small>{[item.artist, item.album].filter(Boolean).join(' · ')}</small>
                </div>
                <div className="search-result-actions">
                  <Button
                    size="small"
                    disabled={
                      busy || (item.quality !== undefined && !item.quality.includes(quality))
                    }
                    onClick={() => void act(() => onPlay(item.key, quality), false)}
                  >
                    播放
                  </Button>
                  <Button
                    disabled={
                      busy || (item.quality !== undefined && !item.quality.includes(quality))
                    }
                    title={
                      item.quality && !item.quality.includes(quality)
                        ? '此版本没有所选音质'
                        : undefined
                    }
                    size="small"
                    onClick={() =>
                      void act(async () => {
                        const result = await host.lxDownload(item.key, quality, true)
                        if (result) {
                          const via =
                            result.sources.length > 1
                              ? ' · 自动换源：' + result.sources.join(' → ')
                              : ''
                          setStatus('已下载并入库 · ' + result.file + via)
                          await refresh()
                        }
                      })
                    }
                  >
                    下载
                  </Button>
                  <Menu>
                    <MenuTrigger disableButtonEnhancement>
                      <Button size="small" disabled={busy}>
                        加入歌单
                      </Button>
                    </MenuTrigger>
                    <MenuPopover className="component-popup">
                      <MenuList>
                        {playlists.length ? (
                          playlists.map((list) => (
                            <MenuItem
                              key={list.id}
                              onClick={() =>
                                void act(async () => {
                                  await onAdd(list.id, item.key)
                                  if (live.current) setStatus('已加入「' + list.name + '」')
                                }, false)
                              }
                            >
                              {list.name}
                            </MenuItem>
                          ))
                        ) : (
                          <MenuItem disabled>请先在本地曲库新建歌单</MenuItem>
                        )}
                      </MenuList>
                    </MenuPopover>
                  </Menu>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {status && <p role="status">{status}</p>}
    </section>
  )
}
