import { useEffect, useRef, useState } from 'react'
import { Button, Input, Dropdown, Option, Combobox } from '@fluentui/react-components'
import type { LocalTrack } from './LibraryPane'
export type Versions = {
  items: { key: string; title: string; artist: string; album: string }[]
  quality: string[]
}
export function DownloadPane({
  tracks,
  refresh,
  preferredQuality = '320k',
}: {
  tracks: LocalTrack[]
  refresh: () => Promise<void>
  preferredQuality?: string
}) {
  const [name, setName] = useState(''),
    [result, setResult] = useState<Versions>(),
    [quality, setQuality] = useState(''),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [filter, setFilter] = useState('')
  const [picked, setPicked] = useState('')
  const hasQuery = Boolean(title.trim() || artist.trim())
  const matching: LocalTrack[] = []
  const keyword = filter.trim().toLocaleLowerCase()
  for (const track of tracks) {
    if ((track.title + ' ' + track.artist).toLocaleLowerCase().includes(keyword))
      matching.push(track)
    if (matching.length >= 50) break
  }
  const host = window.music
  const live = useRef(true)
  async function act(fn: () => Promise<void>) {
    setBusy(true)
    setStatus('')
    try {
      await fn()
    } catch (e) {
      if (live.current) setStatus(String(e).split('Error: ').pop() || '操作失败')
    } finally {
      if (live.current) setBusy(false)
    }
  }
  async function search(query: string | { title: string; artist: string }) {
    setResult(undefined)
    const found = await host.lxSearch(query)
    if (!live.current) return
    setResult(found)
    setQuality(found.quality.includes(preferredQuality) ? preferredQuality : found.quality[0])
    if (!found.items.length) setStatus('没有找到匹配版本')
  }
  useEffect(() => {
    live.current = true
    void host
      .lxInfo()
      .then((value) => {
        if (live.current) setName(value)
      })
      .catch(() => {
        if (live.current) setStatus('无法读取音乐源')
      })
    return () => {
      live.current = false
      void host.lxCancel().catch(() => {})
    }
  }, [])
  return (
    <section className="lx-panel" aria-label="下载音乐">
      {!name && <p>请先到「设置」导入音乐源。</p>}
      <form
        className="download-search"
        onSubmit={(e) => {
          e.preventDefault()
          if (!busy && name && hasQuery)
            void act(() => search(picked || { title: title.trim(), artist: artist.trim() }))
        }}
      >
        {tracks.length > 0 && (
          <label htmlFor="download-library">
            从曲库选择
            <Combobox
              id="download-library"
              inlinePopup
              aria-label="从曲库选择"
              listbox={{ className: 'component-popup' }}
              placeholder="输入歌名或艺人筛选"
              value={filter}
              disabled={busy}
              selectedOptions={picked ? [picked] : []}
              onChange={(e) => {
                setFilter(e.target.value)
                setPicked('')
              }}
              onOptionSelect={(_, data) => {
                const track = matching.find((t) => t.id === data.optionValue)
                if (!track) return
                setPicked(track.id)
                setTitle(track.title)
                setArtist(track.artist)
                setFilter('')
                setResult(undefined)
                setStatus('')
              }}
            >
              {matching.map((t) => (
                <Option key={t.id} value={t.id} text={t.title + ' · ' + t.artist}>
                  {t.title + ' · ' + t.artist}
                </Option>
              ))}
            </Combobox>
          </label>
        )}
        <label htmlFor="download-title">
          歌名
          <Input
            id="download-title"
            aria-label="歌名"
            value={title}
            maxLength={256}
            disabled={busy}
            onChange={(_, data) => {
              setTitle(data.value)
              setPicked('')
              setResult(undefined)
              setStatus('')
            }}
          />
        </label>
        <label htmlFor="download-artist">
          艺人
          <Input
            id="download-artist"
            aria-label="艺人"
            value={artist}
            maxLength={256}
            disabled={busy}
            onChange={(_, data) => {
              setArtist(data.value)
              setPicked('')
              setResult(undefined)
              setStatus('')
            }}
          />
        </label>
        <Button type="submit" appearance="primary" disabled={!name || !hasQuery || busy}>
          查找版本
        </Button>
      </form>
      {busy ? (
        <div role="status">
          正在处理…{' '}
          <Button size="small" onClick={() => void host.lxCancel()}>
            取消
          </Button>
        </div>
      ) : null}
      {result && result.items.length > 0 && (
        <>
          <label htmlFor="lx-quality">
            下载音质{' '}
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
          <ul>
            {result.items.map((item) => (
              <li key={item.key}>
                <div>
                  <strong>{item.title}</strong>
                  <small>{[item.artist, item.album].filter(Boolean).join(' · ')}</small>
                </div>
                <Button
                  disabled={busy}
                  size="small"
                  onClick={() =>
                    void act(async () => {
                      const file = await host.lxDownload(item.key, quality)
                      if (file) {
                        setStatus('已下载并入库 · ' + file)
                        await refresh()
                      }
                    })
                  }
                >
                  下载
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
      {status && <p role="status">{status}</p>}
    </section>
  )
}
