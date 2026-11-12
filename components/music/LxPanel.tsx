import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input, Select } from '@fluentui/react-components'
import type { LocalTrack } from './LibraryPane'
export type Versions = {
  items: { key: string; title: string; artist: string; album: string }[]
  quality: string[]
}
export function LxPanel({
  song,
  close,
  refresh,
}: {
  song: Pick<LocalTrack, 'id' | 'title'> | null
  close: () => void
  refresh: () => Promise<void>
}) {
  const [name, setName] = useState(''),
    [result, setResult] = useState<Versions>(),
    [quality, setQuality] = useState(''),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false)
  const [online, setOnline] = useState(false),
    [link, setLink] = useState('')
  const songId = song?.id
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
  const search = useCallback(async () => {
    if (!songId) return
    setResult(undefined)
    const found = await host.lxSearch(songId)
    if (!live.current) return
    setResult(found)
    setQuality(found.quality.includes('320k') ? '320k' : found.quality[0])
    if (!found.items.length) setStatus('没有找到匹配版本')
  }, [songId])
  useEffect(() => {
    live.current = true
    void act(async () => {
      const n = await host.lxInfo()
      if (!live.current) return
      setName(n)
      if (n && songId) await search()
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
      if (song && active) await search()
    })
  }
  return (
    <section className="lx-panel" aria-label="在线版本">
      <div className="lx-line">
        <strong>{song ? '查找版本 · ' + song.title : '音乐源'}</strong>
        <Button size="small" onClick={close}>
          关闭
        </Button>
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
      {busy ? (
        <div role="status">
          正在处理…{' '}
          <Button size="small" onClick={() => void host.lxCancel()}>
            取消
          </Button>
        </div>
      ) : (
        song &&
        !result?.items.length &&
        name && (
          <Button size="small" onClick={() => void act(search)}>
            重新搜索
          </Button>
        )
      )}
      {result && result.items.length > 0 && (
        <>
          <label htmlFor="lx-quality">
            下载音质{' '}
            <Select
              id="lx-quality"
              size="small"
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
            >
              {result.quality.map((q) => (
                <option key={q}>{q}</option>
              ))}
            </Select>
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
