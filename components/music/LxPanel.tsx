import { useMusicFeedback } from './musicFeedback'
import { PublicPlaylists } from './PublicPlaylists'
import { OnlineSongRow, RowPlay } from './OnlineSongRow'
import { SongCredits } from './SongCredits'
import { useEffect, useRef, useState } from 'react'
import { Button, Dropdown, Option, Tab, TabList } from '@fluentui/react-components'
import { DiscoveryInput } from './DiscoveryInput'
import { guardSearchEnter } from './searchSubmit'
import { X } from 'lucide-react'
import './search.css'
import { formatTime, type Playlist } from './LibraryPane'
export type Versions = {
  items: {
    key: string
    onlineId: string
    localId?: string
    title: string
    artist: string
    artistCredits?: { name: string; id?: string }[]
    album: string
    hasCover?: boolean
    duration?: number
    quality?: string[]
  }[]
  quality: string[]
  partial?: boolean
}
const versionSuffix = /\s*(?:[（(【\[]([^）)】\]]+)[）)】\]]|[-–—]\s*(.+))\s*$/u
function ResultCover({ item }: { item: Versions['items'][number] }) {
  const image = useRef<HTMLImageElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if ((!item.hasCover && !item.localId) || !image.current) return
    let live = true
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      observer.disconnect()
      const cover = item.localId ? window.music.trackCover(item.localId) : Promise.resolve(null)
      void cover
        .then((local) => local || (item.hasCover ? window.music.searchCover(item.key) : null))
        .then((value) => {
          if (live) setUrl(value)
        })
        .catch(() => {})
    })
    observer.observe(image.current)
    return () => {
      live = false
      observer.disconnect()
    }
  }, [item.key, item.hasCover, item.localId])
  return (
    <img
      ref={image}
      className="search-cover"
      src={url || './default-cover.png'}
      alt=""
      onError={url ? () => setUrl(null) : undefined}
    />
  )
}
const versionLabel = /(?:伴奏|现场|現場|翻唱|\blive\b|\bcover\b|\binstrumental\b)/iu
function recordingName(title: string) {
  const suffix = title.match(versionSuffix)
  const label = suffix?.[1] ?? suffix?.[2] ?? ''
  if (!suffix || !versionLabel.test(label)) return <strong>{title}</strong>
  const base = title.slice(0, suffix.index).trim()
  return base ? (
    <strong>
      {base} <span className="search-version">{label}</span>
    </strong>
  ) : (
    <strong>{title}</strong>
  )
}
function groupedVersions(items: Versions['items']) {
  const groups = new Map<string, { title: string; items: Versions['items'] }>()
  const normalize = (value: string) =>
    value.normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ')
  for (const item of items) {
    const suffix = item.title.match(versionSuffix)
    const version = suffix?.[1] ?? suffix?.[2] ?? ''
    const base =
      suffix &&
      /^(?:live\b|studio\b|acoustic\b|remix\b|instrumental\b|remaster(?:ed)?\b|original\b|radio edit\b|现场|現場|录音室|原版|伴奏|不插电|重制)/iu.test(
        version,
      )
        ? item.title.slice(0, suffix.index).trim() || item.title
        : item.title
    const artist = normalize(item.artist)
    const known =
      artist && !/^(?:未知(?:艺人|艺术家|歌手)?|unknown(?: artist)?|n\/a|[-—–]+)$/iu.test(artist)
    const key = known ? JSON.stringify([normalize(base), artist]) : item.key
    const group = groups.get(key) ?? { title: base, items: [] }
    group.items.push(item)
    groups.set(key, group)
  }
  return [...groups.values()].flatMap((group) => {
    const evidence = ['title', 'album', 'duration'].some(
      (field) =>
        new Set(
          group.items
            .map((row) => row[field as 'title' | 'album' | 'duration'])
            .filter(Boolean)
            .map((v) => normalize(String(v)))
            .filter((v) => v !== '未知专辑'),
        ).size > 1,
    )
    return evidence ? [group] : group.items.map((item) => ({ title: item.title, items: [item] }))
  })
}
export function DownloadPane({
  publicMode,
  publicDraft,
  setPublicDraft,
  publicAI,
  togglePublic,
  playlists,
  query,
  setQuery,
  toggle,
  playPublic,
  onPlay,
  onAdd,
  refresh,
  preferredQuality = '320k',
}: {
  publicMode: boolean
  publicDraft: string
  setPublicDraft(value: string): void
  publicAI: boolean
  togglePublic(): void
  query: string
  setQuery(value: string): void
  toggle(): void
  playlists: Playlist[]
  playPublic: (ids: string[]) => Promise<unknown>
  onPlay: (key: string, quality?: string) => Promise<void>
  onAdd: (playlist: string, key: string) => Promise<boolean>
  refresh: () => Promise<void>
  preferredQuality?: string
}) {
  const feedback = useMusicFeedback()
  const [name, setName] = useState(''),
    [result, setResult] = useState<Versions>(),
    [quality, setQuality] = useState(''),
    [status, setStatus] = useState(''),
    [operation, setOperation] = useState<'idle' | 'cancellable' | 'pending'>('idle')
  const busy = operation !== 'idle'
  const [platform, setPlatform] = useState('wy')
  const sourceId = useRef<string | null>(null)
  const [available, setAvailable] = useState<string[]>()
  const platforms = { wy: '网易云音乐', tx: 'QQ 音乐', kg: '酷狗音乐' }
  const unsupported = available && !available.includes(platform)
  const hasQuery = Boolean(query.trim())
  const searchable = hasQuery && query.trim().length <= 256
  const [history, setHistory] = useState<string[]>([])
  const host = window.music
  async function changeHistory(action: 'list' | 'add' | 'remove' | 'clear', word?: string) {
    const words = await host.searchHistory(action, word)
    if (live.current) setHistory(words)
  }
  const live = useRef(true)
  async function act(fn: () => Promise<void>, cancellable = true) {
    setOperation(cancellable ? 'cancellable' : 'pending')
    setStatus('')
    try {
      await fn()
    } catch (e) {
      if (live.current) setStatus(feedback.error(e))
    } finally {
      if (live.current) setOperation('idle')
    }
  }
  async function search(target = platform, keyword = query) {
    setResult(undefined)
    void changeHistory('add', keyword.trim()).catch(() => {})
    const found = await host.lxSearch({ title: keyword.trim(), artist: '' }, target)
    if (!live.current) return
    setResult(found)
    setQuality(found.quality.includes(preferredQuality) ? preferredQuality : found.quality[0])
    if (!found.items.length)
      setStatus(feedback.text('没有找到匹配版本', 'No matching recordings found'))
  }
  useEffect(() => {
    live.current = true
    void host
      .searchHistory()
      .then((words) => {
        if (live.current) setHistory(words)
      })
      .catch(() => {})
    const load = () =>
      void host
        .lxSources()
        .then((data) => {
          if (!live.current) return
          const active = data.installed.find((entry) => entry.id === data.active)
          setName(active?.name ?? '')
          setAvailable(active?.searchPlatforms)
          if (sourceId.current !== data.active) {
            sourceId.current = data.active
            setResult(undefined)
            setStatus('')
          }
        })
        .catch(() => {
          if (live.current) setStatus('无法读取音乐源')
        })
    load()
    const unsubscribe = host.onSourcesChanged(load)
    return () => {
      live.current = false
      unsubscribe()
      void host.lxCancel('search').catch(() => {})
    }
  }, [])
  function versionRow(item: Versions['items'][number]) {
    return (
      <OnlineSongRow
        key={item.key}
        className="search-recording"
        localId={item.localId}
        busy={busy}
        canPlay={item.quality?.length !== 0}
        canDownload={item.quality === undefined || item.quality.includes(quality)}
        play={() => void act(() => onPlay(item.key), false)}
        download={() =>
          void act(async () => {
            const result = await host.lxDownload(item.key, quality, true)
            if (result) {
              const via =
                result.sources.length > 1
                  ? feedback.text(' · 自动换源：', ' · Switched source: ') +
                    result.sources.join(' → ')
                  : ''
              setStatus(
                feedback.text('已下载并入库 · ', 'Downloaded to library · ') + result.file + via,
              )
              if (result.localId)
                setResult(
                  (previous) =>
                    previous && {
                      ...previous,
                      items: previous.items.map((row) =>
                        row.key === item.key ? { ...row, localId: result.localId } : row,
                      ),
                    },
                )
              await refresh()
            }
          })
        }
        add={(id, name) =>
          void act(async () => {
            const added = await onAdd(id, item.key)
            if (live.current) setStatus(feedback.membership(name, added))
          }, false)
        }
      >
        <div className="search-play-cover">
          <ResultCover item={item} />
          <RowPlay
            id={item.onlineId}
            title={item.title}
            disabled={busy || item.quality?.length === 0}
            play={() => void act(() => onPlay(item.key), false)}
          />
        </div>
        <div className="search-track">
          {recordingName(item.title)}
          <small>
            <SongCredits song={item} />
          </small>
        </div>
        <small className="search-duration">
          {item.duration ? formatTime(item.duration) : '时长未知'}
        </small>
      </OnlineSongRow>
    )
  }
  return (
    <section className="lx-panel" aria-label="搜索音乐">
      {publicMode ? (
        <PublicPlaylists
          playlists={playlists}
          play={playPublic}
          refresh={refresh}
          ai={publicAI}
          draft={publicDraft}
          setDraft={setPublicDraft}
          toggleAI={togglePublic}
        />
      ) : (
        <>
          <div className="search-controls" data-query={hasQuery}>
            <form
              className="download-search"
              onKeyDownCapture={guardSearchEnter}
              onSubmit={(e) => {
                e.preventDefault()
                if (!busy && name && searchable && !unsupported) void act(() => search())
              }}
            >
              <DiscoveryInput
                ai={false}
                value={query}
                disabled={busy}
                toggle={toggle}
                edit={(value) => {
                  setQuery(value)
                  setResult(undefined)
                  setStatus('')
                }}
              />
              <Button
                type="submit"
                appearance="primary"
                disabled={!name || !searchable || busy || unsupported}
              >
                搜索
              </Button>
            </form>
            <TabList
              className="search-platforms"
              size="small"
              aria-label="搜索平台"
              selectedValue={platform}
              onTabSelect={(_, data) => {
                const next = String(data.value)
                if (next === platform || busy) return
                setPlatform(next)
                setResult(undefined)
                setStatus('')
                if (name && searchable && (!available || available.includes(next)))
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
            {hasQuery && !searchable && <p>在线搜索关键词最多 256 字。</p>}
            {!name && hasQuery && <p>正在等待可用音乐源，连接网络后会自动检查。</p>}
            {unsupported && (
              <p role="status">
                当前音乐源不支持{platforms[platform as keyof typeof platforms]}
                的搜索和下载，请更换音乐源。
              </p>
            )}
            {history.length > 0 && (
              <section className="search-history" aria-label="最近搜索">
                <header>
                  <h2>最近搜索</h2>
                  <Button
                    disabled={busy}
                    size="small"
                    appearance="subtle"
                    onClick={() => void act(() => changeHistory('clear'), false)}
                  >
                    清空
                  </Button>
                </header>
                <div>
                  {history.map((word) => (
                    <span key={word}>
                      <Button
                        size="small"
                        appearance="subtle"
                        disabled={busy || !name || unsupported}
                        onClick={() => {
                          setQuery(word)
                          void act(() => search(platform, word))
                        }}
                      >
                        {word}
                      </Button>
                      <Button
                        size="small"
                        appearance="subtle"
                        aria-label={'删除搜索词 ' + word}
                        disabled={busy}
                        icon={<X size={13} />}
                        onClick={() => void act(() => changeHistory('remove', word), false)}
                      />
                    </span>
                  ))}
                </div>
              </section>
            )}
          </div>
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
              <div className="search-result-head">
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
                <small>
                  {result.items.length} 个版本
                  {result.partial && ' · 后续结果暂时不可用'}
                </small>
              </div>
              <ul>
                {groupedVersions(result.items).map((group) =>
                  group.items.length === 1 ? (
                    versionRow(group.items[0])
                  ) : (
                    <li className="version-group" key={group.items[0].key}>
                      <details open>
                        <summary>
                          {group.title} · {group.items[0].artist} · {group.items.length} 个版本
                        </summary>
                        <ul>{group.items.map(versionRow)}</ul>
                      </details>
                    </li>
                  ),
                )}
              </ul>
            </>
          )}
          {!busy && status && <p role="status">{status}</p>}
        </>
      )}
    </section>
  )
}
