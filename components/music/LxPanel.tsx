import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input, Dropdown, Option, Combobox } from '@fluentui/react-components'
import type { LocalTrack } from './LibraryPane'
export type Versions = {
  items: { key: string; title: string; artist: string; album: string }[]
  quality: string[]
}
export function LxPanel({
  song,
  close,
  tracks,
  refresh,
}: {
  song?: Pick<LocalTrack, 'id' | 'title'> | null
  tracks?: LocalTrack[]
  close?: () => void
  refresh: () => Promise<void>
}) {
  const [name, setName] = useState(''),
    [result, setResult] = useState<Versions>(),
    [quality, setQuality] = useState(''),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false)
  const [online, setOnline] = useState(false),
    [link, setLink] = useState('')
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [filter, setFilter] = useState('')
  const [picked, setPicked] = useState('')
  const songId = song?.id
  const matching: LocalTrack[] = []
  if (tracks) {
    const keyword = filter.trim().toLocaleLowerCase()
    for (const track of tracks) {
      if ((track.title + ' ' + track.artist).toLocaleLowerCase().includes(keyword))
        matching.push(track)
      if (matching.length >= 50) break
    }
  }
  const host = window.music
  const live = useRef(true)
  const act = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true)
    setStatus('')
    try {
      await fn()
    } catch (e) {
      if (live.current) setStatus(String(e).split('Error: ').pop() || '操作失败')
    } finally {
      if (live.current) setBusy(false)
    }
  }, [])
  const search = useCallback(async (query: string | { title: string; artist: string }) => {
    setResult(undefined)
    const found = await host.lxSearch(query)
    if (!live.current) return
    setResult(found)
    setQuality(found.quality.includes('320k') ? '320k' : found.quality[0])
    if (!found.items.length) setStatus('没有找到匹配版本')
  }, [])
  useEffect(() => {
    live.current = true
    void act(async () => {
      const n = await host.lxInfo()
      if (!live.current) return
      setName(n)
      if (n && songId) await search(songId)
    })
    return () => {
      live.current = false
      void host.lxCancel().catch(() => {})
    }
  }, [songId, act, search])
  function importSource(url?: string) {
    void act(async () => {
      await host.lxImport(url)
      if (!live.current) return
      const active = await host.lxInfo()
      setName(active)
      setResult(undefined)
      setOnline(false)
      setLink('')
      if (songId && active) await search(songId)
    })
  }
  return (
    <section className="lx-panel" aria-label={tracks ? '下载音乐' : '在线版本'}>
      <div className="lx-line">
        <strong>{song ? '查找版本 · ' + song.title : '音乐源'}</strong>
        {close && (
          <Button size="small" onClick={close}>
            关闭
          </Button>
        )}
      </div>
      <div className="lx-line">
        <span>{name || '尚未导入音乐源'}</span>
        <div className="lx-import-actions">
          <Button size="small" disabled={busy} onClick={() => importSource()}>
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
        </div>
      </div>
      {online && (
        <form
          className="lx-import-actions"
          onSubmit={(e) => {
            e.preventDefault()
            importSource(link.trim())
          }}
        >
          <Input
            aria-label="音乐源链接"
            placeholder="粘贴音乐源 JS 直链"
            value={link}
            disabled={busy}
            onChange={(_, d) => setLink(d.value)}
          />
          <Button type="submit" size="small" appearance="primary" disabled={busy || !link.trim()}>
            导入链接
          </Button>
        </form>
      )}
      {tracks && (
        <form
          className="download-search"
          onSubmit={(e) => {
            e.preventDefault()
            if (!busy && name && title.trim())
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
          <Button type="submit" appearance="primary" disabled={!name || !title.trim() || busy}>
            查找版本
          </Button>
        </form>
      )}
      {busy ? (
        <div role="status">
          正在处理…{' '}
          <Button size="small" onClick={() => void host.lxCancel()}>
            取消
          </Button>
        </div>
      ) : (
        songId &&
        !result?.items.length &&
        name && (
          <Button size="small" onClick={() => void act(() => search(songId))}>
            重新搜索
          </Button>
        )
      )}
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

export function DownloadPane({
  tracks,
  refresh,
}: {
  tracks: LocalTrack[]
  refresh: () => Promise<void>
}) {
  return <LxPanel tracks={tracks} refresh={refresh} />
}
