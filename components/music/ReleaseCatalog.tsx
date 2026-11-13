import { Button, Dropdown, Option, Input } from '@fluentui/react-components'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { LocalTrack } from './LibraryPane'
import type { Album } from './AlbumBrowser'
import './release-catalog.css'

type Artist = { id: string; name: string; detail: string }
type Edition = { id: string; title: string; artist: string; detail: string }
const labelEdition = (c: Edition) => [c.title, c.artist, c.detail].filter(Boolean).join(' · ')
type ReleaseTrack = {
  position: number | null
  disc: number
  number: string
  title: string
  artist: string
}
type News = { type: string; id: string; title: string; artist: string; date: string }
export interface ReleaseAPI {
  findArtists(term: string): Promise<Artist[]>
  followedArtists(): Promise<Artist[]>
  followArtist(id: string, on: boolean): Promise<Artist[]>
  releaseNews(refresh?: boolean): Promise<News[]>
  newsEditions(id: string): Promise<Edition[]>
  albumEditions(id: string): Promise<Edition[]>
  editionTracks(id: string): Promise<ReleaseTrack[]>
}
const message = (error: unknown) => String(error).split('Error: ').at(-1) || '读取发行资料失败'
function NewsTracks({ group, search }: { group: News; search: (q: string) => void }) {
  const [editions, setEditions] = useState<Edition[]>([])
  const [selected, setSelected] = useState('')
  const [tracks, setTracks] = useState<ReleaseTrack[]>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry starts a fresh request after a failed lookup.
  useEffect(() => {
    let active = true
    setError('')
    void window.music
      .newsEditions(group.id)
      .then((list) => {
        if (!active) return
        setEditions(list)
        setSelected(list[0]?.id ?? '')
        if (!list.length) setError('此发行暂无正式版本资料。')
      })
      .catch((e) => {
        if (active) setError(message(e))
      })
    return () => {
      active = false
    }
  }, [group.id, retry])
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry also reloads the currently selected edition.
  useEffect(() => {
    let active = true
    if (selected) {
      setTracks(undefined)
      setError('')
      void window.music
        .editionTracks(selected)
        .then((list) => {
          if (active) setTracks(list)
        })
        .catch((e) => {
          if (active) setError(message(e))
        })
    }
    return () => {
      active = false
    }
  }, [selected, retry])
  return (
    <div className="release-track-picker">
      {editions.length > 1 && (
        <Dropdown
          inlinePopup
          aria-label="动态发行版本"
          listbox={{ className: 'component-popup' }}
          value={editions.filter((e) => e.id === selected).map(labelEdition)[0] ?? ''}
          selectedOptions={[selected]}
          onOptionSelect={(_, d) => {
            if (d.optionValue) setSelected(d.optionValue)
          }}
        >
          {editions.map((e) => (
            <Option key={e.id} value={e.id} text={labelEdition(e)}>
              {labelEdition(e)}
            </Option>
          ))}
        </Dropdown>
      )}
      {error ? (
        <p role="alert">
          {error}{' '}
          <Button size="small" onClick={() => setRetry((n) => n + 1)}>
            重试
          </Button>
        </p>
      ) : !tracks ? (
        <small role="status">正在读取曲目…</small>
      ) : !tracks.length ? (
        <small>此版本暂无曲目资料。</small>
      ) : (
        <ol>
          {tracks.map((t) => (
            <li key={[t.disc, t.number, t.title].join(':')}>
              <div>
                <strong>
                  {t.disc}.{t.number} {t.title}
                </strong>
                <small>{t.artist}</small>
              </div>
              <Button size="small" onClick={() => search(t.title + ' ' + t.artist)}>
                选择版本播放
              </Button>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
export function ArtistReleases({ search }: { search: (query: string) => void }) {
  const [openGroup, setOpenGroup] = useState('')
  const [followed, setFollowed] = useState<Artist[]>([])
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<Artist[]>()
  const [news, setNews] = useState<News[]>()
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const alive = useRef(true)
  async function act(fn: () => Promise<void>) {
    setBusy(true)
    setStatus('')
    try {
      await fn()
    } catch (error) {
      if (alive.current) setStatus(message(error))
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  async function load(list: Artist[], force = false) {
    if (!alive.current) return
    setFollowed(list)
    const data = list.length ? await window.music.releaseNews(force) : []
    if (alive.current) setNews(data)
  }
  const initialLoad = useEffectEvent(
    () => void act(async () => load(await window.music.followedArtists())),
  )
  useEffect(() => {
    alive.current = true
    initialLoad()
    return () => {
      alive.current = false
    }
  }, [])
  function toggle(id: string, on: boolean) {
    void act(async () => {
      const list = await window.music.followArtist(id, on)
      setNews(undefined)
      await load(list)
    })
  }
  return (
    <section className="music-release-news" aria-label="关注歌手的新发行">
      <header>
        <h2>关注歌手的新发行</h2>
        <Button size="small" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          管理关注
        </Button>
        {!!followed.length && (
          <Button size="small" disabled={busy} onClick={() => void act(() => load(followed, true))}>
            刷新发行
          </Button>
        )}
      </header>
      {expanded && (
        <div className="artist-management">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (query.trim() && !busy)
                void act(async () => {
                  setMatches(await window.music.findArtists(query.trim()))
                })
            }}
          >
            <Input
              aria-label="要关注的歌手"
              maxLength={160}
              value={query}
              placeholder="输入歌手名"
              onChange={(_, d) => {
                setQuery(d.value)
                setMatches(undefined)
              }}
            />
            <Button size="small" type="submit" disabled={busy || !query.trim()}>
              查找歌手
            </Button>
          </form>
          {matches?.length === 0 && <p>没有找到匹配的歌手</p>}
          {matches
            ?.filter((a) => !followed.some((f) => f.id === a.id))
            .map((a) => (
              <div key={a.id}>
                {a.name} <small>{a.detail}</small>{' '}
                <Button size="small" disabled={busy} onClick={() => toggle(a.id, true)}>
                  关注{a.name}
                </Button>
              </div>
            ))}
          {followed.map((a) => (
            <div key={a.id}>
              {a.name} <small>{a.detail}</small>{' '}
              <Button size="small" disabled={busy} onClick={() => toggle(a.id, false)}>
                取消关注{a.name}
              </Button>
            </div>
          ))}
        </div>
      )}
      {busy && <small role="status">正在读取发行资料…</small>}
      {status && <p role="alert">{status}</p>}
      {!busy &&
        !status &&
        (!followed.length ? (
          <p>关注歌手后可在这里查看新发行。</p>
        ) : (
          news?.length === 0 && <p>近 90 天暂无新发行。</p>
        ))}
      {!!news?.length && (
        <ul>
          {news.map((r) => (
            <li key={r.id} className="release-event">
              <div className="release-event-head">
                <div>
                  <strong>{r.title}</strong>
                  <small>
                    {r.artist} · {r.date} · {r.type}
                  </small>
                </div>
                <Button
                  size="small"
                  aria-expanded={openGroup === r.id}
                  onClick={() => setOpenGroup(openGroup === r.id ? '' : r.id)}
                >
                  {openGroup === r.id ? '收起曲目' : '查看曲目'}
                </Button>
              </div>
              {openGroup === r.id && <NewsTracks group={r} search={search} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
const normalize = (v: string) => v.trim().normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ')
function collectedTracks(tracks: ReleaseTrack[], local: LocalTrack[]) {
  const matched = new Set<ReleaseTrack>()
  for (const row of local) {
    if (!row.available) continue
    const options = tracks.filter(
      (t) =>
        normalize(row.title) === normalize(t.title) &&
        normalize(row.artist) === normalize(t.artist) &&
        (row.discNumber == null || row.discNumber === t.disc) &&
        (row.trackNumber == null || row.trackNumber === t.position),
    )
    // An ambiguous file may be a duplicate of an already matched recording.
    if (options.length === 1) matched.add(options[0])
  }
  return matched
}
export function AlbumEditions({
  album,
  local,
  search,
}: {
  album: Album
  local: LocalTrack[]
  search: (query: string) => void
}) {
  const [choices, setChoices] = useState<Edition[]>()
  const [selected, setSelected] = useState('')
  const [tracks, setTracks] = useState<ReleaseTrack[]>()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  async function request(id?: string) {
    setBusy(true)
    setStatus('')
    try {
      if (id) {
        setSelected(id)
        setTracks(undefined)
        setTracks(await window.music.editionTracks(id))
      } else {
        setChoices(await window.music.albumEditions(album.id))
      }
    } catch (error) {
      setStatus(message(error))
    } finally {
      setBusy(false)
    }
  }
  const collected = collectedTracks(tracks ?? [], local)
  return (
    <section className="music-album-editions" aria-label="发行版本曲目">
      <Button size="small" disabled={busy} onClick={() => void request()}>
        查看完整发行曲目
      </Button>
      {busy && <small role="status">正在查询 MusicBrainz…</small>}
      {status && <p role="alert">{status}</p>}
      {choices?.length === 0 && <p>没有找到对应的发行版本。</p>}
      {!!choices?.length && (
        <label htmlFor="album-edition-picker">
          发行版本{' '}
          <Dropdown
            id="album-edition-picker"
            inlinePopup
            aria-label="发行版本"
            className="edition-select"
            listbox={{ className: 'component-popup' }}
            placeholder="选择发行版本"
            value={choices.filter((c) => c.id === selected).map(labelEdition)[0] ?? ''}
            selectedOptions={selected ? [selected] : []}
            disabled={busy}
            onOptionSelect={(_, d) => {
              if (d.optionValue) void request(d.optionValue)
            }}
          >
            {choices.map((c) => (
              <Option key={c.id} value={c.id} text={labelEdition(c)}>
                {labelEdition(c)}
              </Option>
            ))}
          </Dropdown>
        </label>
      )}
      {tracks?.length === 0 && <p>此发行版本暂无曲目资料。</p>}
      {!!tracks?.length && (
        <ol>
          {tracks.map((t) => {
            return (
              <li key={t.disc + ':' + t.number + ':' + t.title}>
                <div>
                  <strong>
                    {t.disc}.{t.number} {t.title}
                  </strong>
                  <small>{t.artist}</small>
                </div>
                {collected.has(t) ? (
                  <small>已收录</small>
                ) : (
                  <Button size="small" onClick={() => search(t.title + ' ' + t.artist)}>
                    搜索缺曲
                  </Button>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
